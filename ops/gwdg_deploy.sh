#!/usr/bin/env bash
# ============================================================================
# QuillApp – single-script deploy for Ubuntu 22.04
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

APP_NAME="${APP_NAME:-quillapp}"
APP_ROOT="${APP_ROOT:-/opt/${APP_NAME}}"
REPO_URL="${REPO_URL:-https://github.com/emanuskript/QuillApp.git}"
BRANCH="${BRANCH:-main}"

APP_HOST="${APP_HOST:-}"
if [[ -z "${APP_HOST}" ]]; then
  echo "ERROR: APP_HOST is required (e.g. APP_HOST=v021067.vm.gwdguser.de)"
  exit 1
fi

NODE_PORT="${NODE_PORT:-3001}"
PY_PORT="${PY_PORT:-5001}"
DB_NAME="${DB_NAME:-quillapp}"
DB_USER="${DB_USER:-quillapp}"

# Persist DB password so re-runs reuse the same credentials.
DB_PASS_FILE="${APP_ROOT}/.db_pass"
if [[ -z "${DB_PASS:-}" ]]; then
  if [[ -f "${DB_PASS_FILE}" ]]; then
    DB_PASS="$(cat "${DB_PASS_FILE}")"
  else
    DB_PASS="quillapp_$(head -c12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"
    mkdir -p "${APP_ROOT}"
    echo "${DB_PASS}" > "${DB_PASS_FILE}"
    chmod 600 "${DB_PASS_FILE}"
  fi
fi

REPO_DIR="${APP_ROOT}/app"
FRONTEND_DIR="${REPO_DIR}"
NODE_DIR="${REPO_DIR}/server"
PY_DIR="${REPO_DIR}/python-backend"

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
# 1. Fix APT – nuke the Ubuntu "npm" package that conflicts with NodeSource
# ############################################################################
fix_apt() {
  log "Repairing APT (nodejs/npm conflict workaround)"

  # Un-hold both packages so we can manipulate them
  apt-mark unhold nodejs npm 2>/dev/null || true

  # If dpkg itself is mid-configure, finish that first
  dpkg --configure -a 2>/dev/null || true

  # Force-remove the Ubuntu npm package at the dpkg level.
  # This works even when apt-get refuses because of the conflict.
  if dpkg -l npm 2>/dev/null | grep -qE '^(ii|iF|iU|rc)'; then
    log "Removing Ubuntu npm package (conflicts with NodeSource nodejs)"
    dpkg --remove --force-remove-reinstreq npm 2>/dev/null || true
    dpkg --purge  npm 2>/dev/null || true
  fi

  # Also purge every leftover "node-*" Ubuntu package that npm pulled in,
  # because they can shadow modules bundled inside NodeSource nodejs.
  apt-get remove -y --purge 'node-*' 2>/dev/null || true

  # Clean up
  apt-get autoremove -y --purge 2>/dev/null || true
  apt-get -f install -y || true
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
    postgresql postgresql-contrib
}

# ############################################################################
# 3. Install Node 20 via NodeSource (idempotent)
# ############################################################################
install_node() {
  if command -v node &>/dev/null && node -v | grep -qE '^v(1[89]|2[0-9])\.'; then
    log "Node already present: $(node -v)  npm $(npm -v)"
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
    sed -i "/^local.*all.*all/i host    ${DB_NAME}    ${DB_USER}    127.0.0.1/32    md5" "${pg_hba}"
    sed -i "/^local.*all.*all/i local   ${DB_NAME}    ${DB_USER}                    md5" "${pg_hba}"
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
    rm -rf "${REPO_DIR}"
    git clone --branch "${BRANCH}" "${REPO_URL}" "${REPO_DIR}"
  else
    git -C "${REPO_DIR}" fetch --prune origin
    git -C "${REPO_DIR}" reset --hard "origin/${BRANCH}"
  fi
  git -C "${REPO_DIR}" submodule update --init --recursive || true
}

# ############################################################################
# 6. Build frontend
# ############################################################################
build_frontend() {
  log "Building frontend"

  tee "${FRONTEND_DIR}/.env.production.local" >/dev/null <<EOF
VUE_APP_API_URL=http://${APP_HOST}
VUE_APP_WS_URL=ws://${APP_HOST}
VUE_APP_ML_URL=http://${APP_HOST}/ml
VUE_APP_PHAROSIGHT_API_BASE=http://${APP_HOST}/ml
EOF

  cd "${FRONTEND_DIR}"
  npm ci --unsafe-perm
  npm run build

  # Inject window.__PHAROSIGHT_API_BASE__ so the ML backend uses our local
  # /ml proxy instead of the public HF Spaces endpoint.
  local idx="${FRONTEND_DIR}/dist/index.html"
  if [[ -f "${idx}" ]] && ! grep -q '__PHAROSIGHT_API_BASE__' "${idx}"; then
    sed -i 's|</head>|<script>window.__PHAROSIGHT_API_BASE__="http://'"${APP_HOST}"'/ml";</script></head>|' "${idx}"
  fi
}

# ############################################################################
# 7. Setup Node backend
# ############################################################################
setup_node_backend() {
  log "Setting up Node backend"
  cd "${NODE_DIR}"
  npm ci --unsafe-perm

  # Write Node .env with DATABASE_URL
  tee "${NODE_DIR}/.env" >/dev/null <<EOF
PORT=${NODE_PORT}
NODE_ENV=production
CORS_ORIGIN=http://${APP_HOST}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public
EOF

  # Generate Prisma client + apply migrations
  npx prisma generate
  npx prisma migrate deploy || npx prisma db push --accept-data-loss

  tee "/etc/systemd/system/${APP_NAME}-node.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} Node API
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=${NODE_DIR}
EnvironmentFile=${NODE_DIR}/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=2

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

  tee "/etc/systemd/system/${APP_NAME}-ml.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} Python ML (Flask)
After=network.target

[Service]
Type=simple
WorkingDirectory=${PY_DIR}
Environment=PORT=${PY_PORT}
Environment=FLASK_DEBUG=0
ExecStart=${APP_ROOT}/venv/bin/python app.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
}

# ############################################################################
# 9. Nginx
# ############################################################################
setup_nginx() {
  log "Configuring Nginx"

  # ── Remove ALL old configs to avoid "conflicting server name" warnings ──
  # This ensures only our single config exists. Without this, old leftover
  # configs (from previous runs or manual edits) cause duplicate server
  # blocks → nginx picks the wrong one → white page.
  rm -f /etc/nginx/sites-enabled/*
  rm -f /etc/nginx/sites-available/${APP_NAME}* 2>/dev/null || true

  # Verify dist directory exists before writing config
  if [[ ! -f "${FRONTEND_DIR}/dist/index.html" ]]; then
    echo "FATAL: ${FRONTEND_DIR}/dist/index.html not found – frontend build failed?" >&2
    exit 1
  fi

  tee "/etc/nginx/sites-available/${APP_NAME}.conf" >/dev/null <<'NGINXEOF'
server {
  listen 80 default_server;
  server_name %%APP_HOST%%;

  client_max_body_size 75m;

  root %%FRONTEND_DIR%%/dist;
  index index.html;

  # Avoid stale frontend JS after redeploy
  location = /index.html {
    add_header Cache-Control "no-store";
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /index.html;
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
# 10. Firewall – open HTTP (port 80)
# ############################################################################
open_firewall() {
  log "Opening firewall for HTTP traffic"

  # ufw (Ubuntu's default firewall)
  if command -v ufw &>/dev/null; then
    ufw allow 80/tcp   2>/dev/null || true
    ufw allow 443/tcp  2>/dev/null || true
    ufw allow 'Nginx Full' 2>/dev/null || true
    # Make sure ufw doesn't block us even if it's inactive
    if ufw status | grep -q "inactive"; then
      log "  ufw is inactive – no firewall blocking"
    else
      log "  ufw rules updated"
      ufw reload 2>/dev/null || true
    fi
  fi

  # iptables fallback (in case ufw isn't managing it)
  if command -v iptables &>/dev/null; then
    # Only add rules if they don't already exist
    iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || \
      iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
  fi
}

# ############################################################################
# 11. Start everything
# ############################################################################
start_services() {
  log "Starting services"
  systemctl daemon-reload
  systemctl enable "${APP_NAME}-node.service" "${APP_NAME}-ml.service" nginx postgresql
  systemctl restart "${APP_NAME}-node.service" "${APP_NAME}-ml.service" nginx

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
  body="$(curl -sf http://127.0.0.1/ 2>/dev/null || true)"
  if echo "${body}" | grep -q '<div id="app"'; then
    log "  ✓ Nginx serves frontend HTML"
  else
    warn "  ✗ Nginx is NOT serving frontend HTML (white page?)"
    warn "    → Check: ls -la ${FRONTEND_DIR}/dist/index.html"
    warn "    → Check: cat /etc/nginx/sites-enabled/${APP_NAME}.conf | head -5"
    ok=false
  fi

  # Check Nginx proxies /api → Node
  if curl -sf http://127.0.0.1/health 2>/dev/null | grep -q '"ok"'; then
    log "  ✓ Nginx → Node proxy works (/health)"
  else
    warn "  ✗ Nginx → Node proxy not working"
    ok=false
  fi

  # Check external access via APP_HOST
  if curl -sf --max-time 5 "http://${APP_HOST}/" 2>/dev/null | grep -q '<div id="app"'; then
    log "  ✓ External access works (http://${APP_HOST}/)"
  else
    warn "  ✗ Cannot reach http://${APP_HOST}/ from this machine"
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
    warn "Some checks failed – see warnings above"
  fi
}

# ############################################################################
# Main
# ############################################################################
fix_apt
install_apt
install_node
setup_postgres
clone_or_update
build_frontend
setup_node_backend
setup_python_backend
setup_nginx
open_firewall
start_services
verify_deploy

echo
log "DONE"
echo "Frontend:   http://${APP_HOST}/"
echo "Node API:   http://${APP_HOST}/api/health"
echo "Node WS:    ws://${APP_HOST}/ws"
echo "Python ML:  http://${APP_HOST}/ml/health"
echo
echo "Credentials saved in: ${NODE_DIR}/.env"
echo
echo "Logs:"
echo "  journalctl -u ${APP_NAME}-node.service -n 200 --no-pager"
echo "  journalctl -u ${APP_NAME}-ml.service   -n 200 --no-pager"
echo "  tail -n 200 /var/log/nginx/error.log"
