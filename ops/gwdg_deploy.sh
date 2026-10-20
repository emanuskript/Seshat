#!/usr/bin/env bash
# ============================================================================
# Seshat – production deploy for Ubuntu 22.04/24.04
#
# Usage:
#   sudo APP_HOST=your.host.example bash ops/gwdg_deploy.sh
#
# What it does (idempotent – safe to re-run):
#   1. Fixes the nodejs-vs-npm APT conflict (NodeSource ships its own npm)
#   2. Installs system packages (git, nginx, python3, tesseract, postgresql)
#   3. Installs Node 20 via NodeSource (if not already present)
#   4. Clones / updates the repo
#   5. Builds the Vue frontend
#   6. Sets up PostgreSQL DB + runs Prisma migrations
#   7. Configures systemd units for Node API + Python ML backend
#   8. Writes an Nginx site config (reverse-proxy + static frontend)
# ============================================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: run this system deployment script as root (for example with sudo)." >&2
  exit 1
fi

APP_NAME="${APP_NAME:-seshat}"
APP_ROOT="${APP_ROOT:-/opt/${APP_NAME}}"
REPO_URL="${REPO_URL:-https://github.com/emanuskript/Seshat.git}"
BRANCH="${BRANCH:-main}"
SERVICE_USER="${SERVICE_USER:-seshat}"
SERVICE_GROUP="${SERVICE_GROUP:-seshat}"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}}"
CONFIG_DIR="${CONFIG_DIR:-/etc/${APP_NAME}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"

APP_HOST="${APP_HOST:-}"
if [[ ! "${APP_HOST}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "ERROR: APP_HOST must be a DNS hostname (e.g. APP_HOST=v021067.vm.gwdguser.de)." >&2
  exit 1
fi

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://${APP_HOST}}"
if [[ ! "${PUBLIC_ORIGIN}" =~ ^https?://[^/]+$ ]]; then
  echo "ERROR: PUBLIC_ORIGIN must be one http(s) origin without a trailing path." >&2
  exit 1
fi
WS_ORIGIN="${PUBLIC_ORIGIN/https:/wss:}"
WS_ORIGIN="${WS_ORIGIN/http:/ws:}"

NODE_PORT="${NODE_PORT:-3001}"
PY_PORT="${PY_PORT:-5001}"
DB_NAME="${DB_NAME:-seshat}"
DB_USER="${DB_USER:-seshat}"

if [[ ! "${NODE_PORT}" =~ ^[0-9]+$ ]] || (( NODE_PORT < 1 || NODE_PORT > 65535 )) \
  || [[ ! "${PY_PORT}" =~ ^[0-9]+$ ]] || (( PY_PORT < 1 || PY_PORT > 65535 )); then
  echo "ERROR: NODE_PORT and PY_PORT must be integers from 1 through 65535." >&2
  exit 1
fi

if [[ ! "${DB_NAME}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] \
  || [[ ! "${DB_USER}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "ERROR: DB_NAME and DB_USER must be safe PostgreSQL identifiers." >&2
  exit 1
fi

# Persist DB password so re-runs reuse the same credentials.
mkdir -p "${CONFIG_DIR}"
chmod 0750 "${CONFIG_DIR}"
DB_PASS_FILE="${CONFIG_DIR}/db-password"
if [[ -z "${DB_PASS:-}" ]]; then
  if [[ -f "${DB_PASS_FILE}" ]]; then
    DB_PASS="$(cat "${DB_PASS_FILE}")"
  else
    DB_PASS="$(openssl rand -hex 24)"
    echo "${DB_PASS}" > "${DB_PASS_FILE}"
    chmod 600 "${DB_PASS_FILE}"
  fi
fi

if [[ ! "${DB_PASS}" =~ ^[a-zA-Z0-9._-]{24,128}$ ]]; then
  echo "ERROR: DB_PASS must be 24-128 characters using letters, numbers, dot, underscore, or hyphen." >&2
  exit 1
fi

REPO_DIR="${APP_ROOT}/app"
FRONTEND_DIR="${REPO_DIR}"
NODE_DIR="${REPO_DIR}/server"
PY_DIR="${REPO_DIR}/python-backend"
NODE_ENV_FILE="${CONFIG_DIR}/node.env"
ML_ENV_FILE="${CONFIG_DIR}/ml.env"

# ---- helpers ---------------------------------------------------------------
log()  { echo "==> $*"; }
warn() { echo "WARN: $*" >&2; }

CADDY_APT_MARKER="dl.cloudsmith.io/public/caddy"

disable_broken_caddy_apt_source() {
  local source_file disabled_file
  local disabled_count=0

  # Seshat is served by Nginx. A stale or quota-blocked Caddy repository must
  # not prevent unrelated packages from being installed. Keep each source as a
  # recoverable backup and leave an already-installed Caddy package untouched.
  for source_file in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [[ -f "${source_file}" ]] || continue
    if ! grep -Fq "${CADDY_APT_MARKER}" "${source_file}"; then
      continue
    fi

    disabled_file="${source_file}.disabled-by-seshat"
    if [[ -e "${disabled_file}" ]]; then
      disabled_file="${disabled_file}.${BASHPID}"
    fi
    mv -- "${source_file}" "${disabled_file}"
    warn "Disabled failing Caddy APT source: ${source_file}"
    warn "Restore it later from: ${disabled_file}"
    disabled_count=$((disabled_count + 1))
  done

  # Handle the uncommon case where Caddy was added directly to sources.list.
  if [[ -f /etc/apt/sources.list ]] \
    && grep -F "${CADDY_APT_MARKER}" /etc/apt/sources.list | grep -Eq '^[[:space:]]*deb'; then
    if [[ ! -f /etc/apt/sources.list.before-seshat-caddy-disable ]]; then
      cp -a /etc/apt/sources.list /etc/apt/sources.list.before-seshat-caddy-disable
    fi
    sed -i "\|${CADDY_APT_MARKER}| { /^[[:space:]]*#/! s|^|# disabled by Seshat deployment: |; }" \
      /etc/apt/sources.list
    warn "Disabled the failing Caddy entry in /etc/apt/sources.list"
    warn "Original saved at /etc/apt/sources.list.before-seshat-caddy-disable"
    disabled_count=$((disabled_count + 1))
  fi

  (( disabled_count > 0 ))
}

apt_update_with_recovery() {
  local apt_log
  apt_log="$(mktemp /tmp/seshat-apt-update.XXXXXX)"

  if apt-get update -y 2>&1 | tee "${apt_log}"; then
    rm -f "${apt_log}"
    return 0
  fi

  if grep -Fq "${CADDY_APT_MARKER}" "${apt_log}"; then
    warn "APT update failed because the Cloudsmith Caddy repository is unavailable."
    if disable_broken_caddy_apt_source; then
      rm -f "${apt_log}"
      log "Retrying APT update without the unused Caddy repository"
      apt-get update -y
      return 0
    fi
  fi

  warn "APT update failed for a reason that could not be repaired automatically."
  rm -f "${apt_log}"
  return 1
}

# ############################################################################
# 1. Repair only an actual npm/NodeSource package conflict
# ############################################################################
fix_apt() {
  log "Checking APT state"
  dpkg --configure -a
  apt_update_with_recovery
}

# ############################################################################
# 2. Install system packages (never list "npm" here!)
# ############################################################################
install_apt() {
  log "Installing OS deps"
  apt-get install -y \
    git curl ca-certificates gnupg lsb-release \
    nginx \
    python3-venv python3-pip \
    tesseract-ocr \
    postgresql postgresql-client postgresql-contrib
}

ensure_service_user() {
  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin \
      --user-group "${SERVICE_USER}"
  fi
  SERVICE_GROUP="$(id -gn "${SERVICE_USER}")"
  chown root:"${SERVICE_GROUP}" "${CONFIG_DIR}"
  install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" \
    "${DATA_DIR}" "${DATA_DIR}/static/jobs" "${DATA_DIR}/uploads" "${BACKUP_DIR}"
}

# ############################################################################
# 3. Install Node 20 via NodeSource (idempotent)
# ############################################################################
install_node() {
  if command -v node &>/dev/null; then
    if node -v | grep -qE '^v(20|22)\.'; then
      log "Node already present: $(node -v)  npm $(npm -v)"
    else
      echo "FATAL: unsupported Node.js $(node -v); install Node.js 20 LTS before deployment." >&2
      exit 1
    fi
  else
    log "Installing NodeSource Node.js 20.x"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  # Final sanity check
  if ! command -v npm &>/dev/null; then
    echo "FATAL: npm not found after nodejs install" >&2; exit 1
  fi
  log "node $(node -v)  npm $(npm -v)"
}

# ############################################################################
# 4. PostgreSQL – create role + database (idempotent)
# ############################################################################
setup_postgres() {
  log "Setting up PostgreSQL database '${DB_NAME}'"
  systemctl start postgresql || true
  systemctl enable postgresql || true

  # Create user if missing
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';"
  fi

  # Always sync the password (covers re-runs where DB_PASS was regenerated)
  sudo -u postgres psql -c "ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';" 2>/dev/null || true

  # Ensure password auth is enabled for local connections (peer auth won't work for our app)
  local pg_hba
  pg_hba="$(sudo -u postgres psql -tAc "SHOW hba_file")"
  if [[ -f "${pg_hba}" ]] && ! grep -q "${DB_USER}" "${pg_hba}"; then
    # Insert a line BEFORE the first "local.*all.*all" rule
    sed -i "/^local.*all.*all/i host    ${DB_NAME}    ${DB_USER}    127.0.0.1/32    scram-sha-256" "${pg_hba}"
    systemctl reload postgresql
  fi

  # Create database if missing
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
  fi

  # Grant
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>/dev/null || true

  # Save password file (in case it wasn't saved yet)
  echo "${DB_PASS}" > "${DB_PASS_FILE}"
  chmod 600 "${DB_PASS_FILE}"

  # Verify the connection works before proceeding
  if ! PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT 1" &>/dev/null; then
    echo "FATAL: Cannot connect to PostgreSQL as ${DB_USER}@localhost/${DB_NAME}" >&2
    echo "  Check pg_hba.conf and password. Password is in: ${DB_PASS_FILE}" >&2
    exit 1
  fi
  log "PostgreSQL connection verified OK"
}

# ############################################################################
# 5. Clone / update repo
# ############################################################################
clone_or_update() {
  log "Clone/update repo"
  mkdir -p "${APP_ROOT}"
  if [[ ! -d "${REPO_DIR}/.git" ]]; then
    if [[ -e "${REPO_DIR}" ]]; then
      echo "FATAL: ${REPO_DIR} exists but is not a Git checkout; move it explicitly before deploying." >&2
      exit 1
    fi
    git clone --branch "${BRANCH}" "${REPO_URL}" "${REPO_DIR}"
  else
    if ! git -C "${REPO_DIR}" diff --quiet \
      || ! git -C "${REPO_DIR}" diff --cached --quiet \
      || [[ -n "$(git -C "${REPO_DIR}" ls-files --others --exclude-standard)" ]]; then
      echo "FATAL: ${REPO_DIR} has local changes. Commit or preserve them before deployment." >&2
      exit 1
    fi
    git -C "${REPO_DIR}" fetch --prune origin
    git -C "${REPO_DIR}" checkout "${BRANCH}"
    git -C "${REPO_DIR}" merge --ff-only "origin/${BRANCH}"
  fi
  git -C "${REPO_DIR}" submodule update --init --recursive
}

# ############################################################################
# 6. Build frontend
# ############################################################################
build_frontend() {
  log "Building frontend"

  tee "${FRONTEND_DIR}/.env.production.local" >/dev/null <<EOF
VUE_APP_API_URL=${PUBLIC_ORIGIN}
VUE_APP_WS_URL=${WS_ORIGIN}
VUE_APP_ML_URL=${PUBLIC_ORIGIN}/ml
VUE_APP_PHAROSIGHT_API_BASE=${PUBLIC_ORIGIN}/ml
EOF

  cd "${FRONTEND_DIR}"
  npm ci --unsafe-perm
  npm audit --omit=dev --audit-level=high
  npm run build
  rm -rf "${FRONTEND_DIR}/node_modules"

}

# ############################################################################
# 7. Setup Node backend
# ############################################################################
setup_node_backend() {
  log "Setting up Node backend"
  cd "${NODE_DIR}"
  npm ci --unsafe-perm
  npm audit --omit=dev --audit-level=high

  local database_url
  database_url="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"

  tee "${NODE_ENV_FILE}" >/dev/null <<EOF
PORT=${NODE_PORT}
HOST=127.0.0.1
NODE_ENV=production
CORS_ORIGIN=${PUBLIC_ORIGIN}
DATABASE_URL=${database_url}
SESSION_RETENTION_DAYS=${SESSION_RETENTION_DAYS:-90}
EOF
  chown root:"${SERVICE_GROUP}" "${NODE_ENV_FILE}"
  chmod 0640 "${NODE_ENV_FILE}"

  # systemd reads NODE_ENV_FILE when the service starts, but the Prisma CLI
  # runs during deployment and does not read arbitrary EnvironmentFile files.
  # Pass the same URL explicitly so schema validation and migrations can run.
  DATABASE_URL="${database_url}" npx prisma generate
  DATABASE_URL="${database_url}" npx prisma migrate deploy
  npm prune --omit=dev

  tee "/etc/systemd/system/${APP_NAME}-node.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} Node API
After=network.target postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${NODE_DIR}
EnvironmentFile=${NODE_ENV_FILE}
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
}

# ############################################################################
# 8. Setup Python ML backend
# ############################################################################
setup_python_backend() {
  log "Setting up Python ML backend"

  python3 -m venv "${APP_ROOT}/venv"
  "${APP_ROOT}/venv/bin/pip" install --upgrade pip

  cd "${PY_DIR}"
  "${APP_ROOT}/venv/bin/pip" install -r requirements.txt

  tee "${ML_ENV_FILE}" >/dev/null <<EOF
PORT=${PY_PORT}
SESHAT_ENV=production
SESHAT_CORS_ORIGINS=${PUBLIC_ORIGIN}
SESHAT_DATA_DIR=${DATA_DIR}
SESHAT_JOB_TTL_SECONDS=${SESHAT_JOB_TTL_SECONDS:-21600}
SESHAT_MAX_UPLOAD_BYTES=${SESHAT_MAX_UPLOAD_BYTES:-62914560}
SESHAT_EXPORT_IMAGE_MAX_BYTES=${SESHAT_EXPORT_IMAGE_MAX_BYTES:-83886080}
SESHAT_MAX_PDF_PAGES=${SESHAT_MAX_PDF_PAGES:-100}
SESHAT_MAX_IMAGE_PIXELS=${SESHAT_MAX_IMAGE_PIXELS:-80000000}
SESHAT_MAX_IMAGE_DIM=${SESHAT_MAX_IMAGE_DIM:-6000}
PYTHONDONTWRITEBYTECODE=1
EOF
  chown root:"${SERVICE_GROUP}" "${ML_ENV_FILE}"
  chmod 0640 "${ML_ENV_FILE}"

  tee "/etc/systemd/system/${APP_NAME}-ml.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} Python ML (Flask)
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${PY_DIR}
EnvironmentFile=${ML_ENV_FILE}
ExecStart=${APP_ROOT}/venv/bin/gunicorn --bind 127.0.0.1:${PY_PORT} --workers ${ML_WORKERS:-2} --threads ${ML_THREADS:-2} --timeout 600 --graceful-timeout 30 --access-logfile - --error-logfile - app:app
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=${DATA_DIR}
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
}

setup_maintenance_timers() {
  log "Configuring runtime cleanup and PostgreSQL backups"

  tee "${CONFIG_DIR}/backup.env" >/dev/null <<EOF
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=${DB_NAME}
PGUSER=${DB_USER}
PGPASSWORD=${DB_PASS}
EOF
  chown root:"${SERVICE_GROUP}" "${CONFIG_DIR}/backup.env"
  chmod 0640 "${CONFIG_DIR}/backup.env"

  tee "/usr/local/sbin/${APP_NAME}-db-backup" >/dev/null <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
stamp="\$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR}/${APP_NAME}-\${stamp}.dump"
/usr/bin/pg_dump --format=custom --file="\${target}"
/usr/bin/find "${BACKUP_DIR}" -maxdepth 1 -type f -name '${APP_NAME}-*.dump' -mtime +${BACKUP_RETENTION_DAYS:-14} -delete
EOF
  chown root:"${SERVICE_GROUP}" "/usr/local/sbin/${APP_NAME}-db-backup"
  chmod 0750 "/usr/local/sbin/${APP_NAME}-db-backup"

  tee "/etc/systemd/system/${APP_NAME}-backup.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} PostgreSQL backup
After=postgresql.service

[Service]
Type=oneshot
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
EnvironmentFile=${CONFIG_DIR}/backup.env
ExecStart=/usr/local/sbin/${APP_NAME}-db-backup
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${BACKUP_DIR}
UMask=0077
EOF

  tee "/etc/systemd/system/${APP_NAME}-backup.timer" >/dev/null <<EOF
[Unit]
Description=Daily ${APP_NAME} PostgreSQL backup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
EOF

  tee "/etc/systemd/system/${APP_NAME}-cleanup.service" >/dev/null <<EOF
[Unit]
Description=Remove expired ${APP_NAME} runtime files

[Service]
Type=oneshot
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
EnvironmentFile=${ML_ENV_FILE}
ExecStart=${APP_ROOT}/venv/bin/python ${PY_DIR}/cleanup_runtime.py
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
UMask=0077
EOF

  tee "/etc/systemd/system/${APP_NAME}-cleanup.timer" >/dev/null <<EOF
[Unit]
Description=Periodic ${APP_NAME} runtime cleanup

[Timer]
OnBootSec=10m
OnUnitActiveSec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

# ############################################################################
# 9. Nginx
# ############################################################################
setup_nginx() {
  log "Configuring Nginx"

  # Verify dist directory exists before writing config
  if [[ ! -f "${FRONTEND_DIR}/dist/index.html" ]]; then
    echo "FATAL: ${FRONTEND_DIR}/dist/index.html not found – frontend build failed?" >&2
    exit 1
  fi

  tee "/etc/nginx/sites-available/${APP_NAME}.conf" >/dev/null <<'NGINXEOF'
server {
  listen 80;
  listen [::]:80;
  server_name %%APP_HOST%%;

  client_max_body_size 75m;
  server_tokens off;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; connect-src 'self' https: http: wss: ws:; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https: http:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:" always;

  root %%FRONTEND_DIR%%/dist;
  index index.html;

  # Avoid stale frontend JS after redeploy
  location = /index.html {
    add_header Cache-Control "no-store";
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; connect-src 'self' https: http: wss: ws:; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https: http:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:" always;
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(?:js|css|png|jpg|jpeg|gif|webp|ico|woff2?)$ {
    expires 7d;
    add_header Cache-Control "public, immutable";
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; connect-src 'self' https: http: wss: ws:; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https: http:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:" always;
    try_files $uri =404;
  }

  # ---- Node API ----
  location = /health {
    proxy_pass http://127.0.0.1:%%NODE_PORT%%/health;
  }

  location = /api/health {
    proxy_pass http://127.0.0.1:%%NODE_PORT%%/health;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:%%NODE_PORT%%;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # ---- WebSocket ----
  location /ws {
    proxy_pass http://127.0.0.1:%%NODE_PORT%%;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_read_timeout  3600;
    proxy_send_timeout  3600;
  }

  # ---- Python ML backend ----
  location /ml/ {
    client_max_body_size   75m;
    proxy_pass             http://127.0.0.1:%%PY_PORT%%/;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout     600;
    proxy_send_timeout     600;
    proxy_request_buffering off;
    proxy_buffering         off;
  }
}
NGINXEOF

  sed -i "s|%%APP_HOST%%|${APP_HOST}|g"         "/etc/nginx/sites-available/${APP_NAME}.conf"
  sed -i "s|%%FRONTEND_DIR%%|${FRONTEND_DIR}|g" "/etc/nginx/sites-available/${APP_NAME}.conf"
  sed -i "s|%%NODE_PORT%%|${NODE_PORT}|g"       "/etc/nginx/sites-available/${APP_NAME}.conf"
  sed -i "s|%%PY_PORT%%|${PY_PORT}|g"           "/etc/nginx/sites-available/${APP_NAME}.conf"

  ln -sf "/etc/nginx/sites-available/${APP_NAME}.conf" "/etc/nginx/sites-enabled/${APP_NAME}.conf"
  nginx -t
}

# ############################################################################
# 10. Start everything
# ############################################################################
start_services() {
  log "Starting services"
  systemctl daemon-reload
  systemctl enable "${APP_NAME}-node.service" "${APP_NAME}-ml.service" \
    "${APP_NAME}-backup.timer" "${APP_NAME}-cleanup.timer" nginx postgresql
  systemctl restart "${APP_NAME}-node.service" "${APP_NAME}-ml.service" nginx
  systemctl restart "${APP_NAME}-backup.timer" "${APP_NAME}-cleanup.timer"

  # Fail the deployment if the first backup cannot be created.
  systemctl start "${APP_NAME}-backup.service"

  # Give services a moment to come up
  sleep 3
}

# ############################################################################
# 11. Post-deploy verification
# ############################################################################
verify_deploy() {
  log "Verifying deployment…"
  local ok=true

  # Check Node API health
  if curl -sf http://127.0.0.1:${NODE_PORT}/health >/dev/null 2>&1; then
    log "  ✓ Node API healthy (port ${NODE_PORT})"
  else
    warn "  ✗ Node API not responding on port ${NODE_PORT}"
    warn "    → journalctl -u ${APP_NAME}-node.service -n 50 --no-pager"
    ok=false
  fi

  # Check Python ML health
  if curl -sf http://127.0.0.1:${PY_PORT}/health >/dev/null 2>&1; then
    log "  ✓ Python ML healthy (port ${PY_PORT})"
  else
    warn "  ✗ Python ML not responding on port ${PY_PORT}"
    warn "    → journalctl -u ${APP_NAME}-ml.service -n 50 --no-pager"
    ok=false
  fi

  # Check Nginx serves the frontend (not a white/empty page)
  local body
  body="$(curl -sf -H "Host: ${APP_HOST}" http://127.0.0.1/ 2>/dev/null || true)"
  if echo "${body}" | grep -q '<div id="app"'; then
    log "  ✓ Nginx serves frontend HTML"
  else
    warn "  ✗ Nginx is NOT serving frontend HTML (white page?)"
    warn "    → Check: ls -la ${FRONTEND_DIR}/dist/index.html"
    warn "    → Check: cat /etc/nginx/sites-enabled/${APP_NAME}.conf | head -5"
    ok=false
  fi

  # Check Nginx proxies /api → Node
  if curl -sf -H "Host: ${APP_HOST}" http://127.0.0.1/health 2>/dev/null | grep -q '"ok"'; then
    log "  ✓ Nginx → Node proxy works (/health)"
  else
    warn "  ✗ Nginx → Node proxy not working"
    ok=false
  fi

  # Check external access via APP_HOST
  if curl -sf --max-time 8 "${PUBLIC_ORIGIN}/" 2>/dev/null | grep -q '<div id="app"'; then
    log "  ✓ External access works (${PUBLIC_ORIGIN}/)"
  else
    warn "  ✗ Cannot reach ${PUBLIC_ORIGIN}/ from this machine"
    warn "    Possible causes:"
    warn "    1. Firewall: run 'ufw status' and 'iptables -L -n | grep 80'"
    warn "    2. DNS: verify '${APP_HOST}' resolves correctly"
    warn "    3. Cloud/GWDG security group: port 80 may need to be opened in the web console"
    warn "    4. Browser cache: try Ctrl+Shift+R or incognito window"
    ok=false
  fi

  if [[ "${ok}" == "true" ]]; then
    log "All checks passed!"
  else
    warn "Deployment verification failed – see warnings above"
    return 1
  fi
}

# ############################################################################
# Main
# ############################################################################
fix_apt
install_apt
install_node
ensure_service_user
setup_postgres
clone_or_update
build_frontend
setup_node_backend
setup_python_backend
setup_maintenance_timers
setup_nginx
start_services
verify_deploy

echo
log "DONE"
echo "Frontend:   ${PUBLIC_ORIGIN}/"
echo "Node API:   ${PUBLIC_ORIGIN}/api/health"
echo "Node WS:    ${WS_ORIGIN}/ws"
echo "Python ML:  ${PUBLIC_ORIGIN}/ml/health"
echo
echo "Secrets are root-readable under: ${CONFIG_DIR}"
echo "Database backups: ${BACKUP_DIR} (daily, ${BACKUP_RETENTION_DAYS:-14}-day retention)"
echo "TLS must terminate at an upstream proxy or be configured in nginx for ${PUBLIC_ORIGIN}."
echo
echo "Logs:"
echo "  journalctl -u ${APP_NAME}-node.service -n 200 --no-pager"
echo "  journalctl -u ${APP_NAME}-ml.service   -n 200 --no-pager"
echo "  tail -n 200 /var/log/nginx/error.log"
