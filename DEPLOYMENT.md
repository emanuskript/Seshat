# Seshat production deployment

Seshat has three deployable application layers: a compiled Vue SPA, a Node.js
collaboration/WebSocket API backed by PostgreSQL, and a Python image-analysis
API. All three should share one HTTPS origin through Nginx or an upstream proxy.

## Supported target and capacity

- Ubuntu 22.04 or 24.04, x86-64.
- Node.js 20 or 22 (20 LTS recommended), Python 3.10+, PostgreSQL,
  Tesseract, systemd, and Nginx.
- Start with 4 CPU cores, 8 GiB RAM, and 20 GiB free disk. PDF rasterization and
  image analysis are CPU/RAM intensive; size from representative manuscripts.
- Public DNS and TCP 80/443. PostgreSQL (5432), Node (3001), and Python (5001)
  remain loopback-only.

## Automated Ubuntu deployment

Before running the script:

1. Point the DNS name to the server.
2. Arrange TLS at Nginx or a trusted upstream proxy.
3. Allow only 80/443 at the host/cloud firewall.
4. Back up an existing PostgreSQL database and `/etc/seshat` on upgrades.

Then run from this repository, or let the script clone its verified default
repository into `/opt/seshat/app`:

```bash
sudo APP_HOST=seshat.example.org \
  PUBLIC_ORIGIN=https://seshat.example.org \
  bash ops/gwdg_deploy.sh
```

The script installs packages, uses a dedicated `seshat` service account,
creates PostgreSQL credentials under `/etc/seshat`, builds the SPA, applies
committed Prisma migrations, writes hardened systemd units, configures only the
Seshat Nginx site, enables runtime cleanup and daily database backup timers, and
fails on unsuccessful host-local deployment checks. The public-origin check is
advisory by default because TLS termination, split DNS, and network hairpinning
can live outside the host. Set `REQUIRE_EXTERNAL_REACHABILITY=1` to make that
check fatal. The script refuses to overwrite a dirty server checkout and only
fast-forwards the selected branch.

It does not change firewall rules, issue certificates, remove Caddy, or clear
unrelated Nginx sites. If a stale Cloudsmith Caddy APT source alone breaks
`apt-get update`, that source is moved to a named backup because Seshat uses
Nginx; the installed Caddy package/configuration is untouched.

Important optional settings:

```text
APP_ROOT=/opt/seshat
DATA_DIR=/var/lib/seshat
CONFIG_DIR=/etc/seshat
BACKUP_DIR=/var/backups/seshat
REQUIRE_EXTERNAL_REACHABILITY=0
DISABLE_CONFLICTING_NGINX_SITES=1
SESSION_RETENTION_DAYS=90
SESHAT_JOB_TTL_SECONDS=21600
SESHAT_MAX_UPLOAD_BYTES=62914560
SESHAT_EXPORT_IMAGE_MAX_BYTES=83886080
SESHAT_MAX_PDF_PAGES=100
SESHAT_MAX_IMAGE_PIXELS=80000000
SESHAT_MAX_IMAGE_DIM=6000
ML_WORKERS=2
ML_THREADS=2
```

Do not raise worker or image limits without measuring peak memory. Gunicorn has
a 600-second request timeout because analysis is synchronous.

The deployment owns the exact hostname supplied in `APP_HOST`. By default, an
older enabled Nginx site declaring that same hostname is moved to
`/etc/nginx/sites-disabled-by-seshat/` before the generated Seshat site is
enabled. The move is recoverable and prevents Nginx from silently serving a
stale frontend. Set `DISABLE_CONFLICTING_NGINX_SITES=0` to stop instead and
resolve any conflict manually.

## Database migration and capability links

The collaboration server now stores only SHA-256 hashes of random session
access tokens. A token is returned once when a session is created and is kept
in the share URL fragment and browser local storage; fragments are not sent to
the HTTP server. REST writes and WebSocket joins require the bearer token.

Migration `20261012000000_add_session_access_tokens` deliberately assigns new
unknown hashes to pre-existing sessions. Existing unauthenticated share URLs
therefore stop working after migration. This is a security boundary change:
announce it, back up first, apply with `npx prisma migrate deploy`, and create
new share links after deployment. Never replace production migrations with
`prisma db push`.

Manual backup and restore checks:

```bash
sudo systemctl start seshat-backup.service
sudo systemctl status seshat-backup.service --no-pager
sudo ls -lh /var/backups/seshat
pg_restore --list /var/backups/seshat/seshat-YYYYMMDDTHHMMSSZ.dump >/dev/null
```

Daily dumps have 14-day retention by default. Copy backups off-host and perform
a real restore drill to a separate database.

## Manual deployment contract

If the script cannot be used, preserve the same boundaries:

1. Build the frontend with `npm ci && npm test && npm run lint && npm run build`.
2. Serve `dist/` as static files with an SPA fallback and no write permission
   for the web worker.
3. In `server/`, run `npm ci`, set `NODE_ENV=production`, loopback `HOST`, an
   exact HTTPS `CORS_ORIGIN`, and a least-privilege `DATABASE_URL`; run
   `npx prisma generate && npx prisma migrate deploy` before starting Node.
4. Install `python-backend/requirements.txt` in a venv and run `app:app` with
   Gunicorn, never Flask's development server. Set `SESHAT_ENV=production`, an
   exact `SESHAT_CORS_ORIGINS`, external `SESHAT_DATA_DIR`, and bounded limits.
5. Proxy `/api/` and `/ws` to Node, `/ml/` to Python, and everything else to
   the static SPA. Forward WebSocket upgrade headers.
6. Run periodic cleanup for `SESHAT_DATA_DIR` and database/off-host backups.

## Verification and operations

```bash
curl -fsS https://seshat.example.org/ | grep '<div id="app"'
curl -fsS https://seshat.example.org/health
curl -fsS https://seshat.example.org/ml/health
sudo systemctl status seshat-node seshat-ml seshat-backup.timer seshat-cleanup.timer
sudo journalctl -u seshat-node -n 200 --no-pager
sudo journalctl -u seshat-ml -n 200 --no-pager
sudo nginx -t
```

Then test: one direct image, one PDF near expected page dimensions, one IIIF v2
manifest, one IIIF v3 manifest, session creation, a copied share URL in another
browser, a collaborative annotation update, and export. Health endpoints alone
do not exercise image processing, IIIF CORS, PostgreSQL writes, or WebSockets.

## Enforced safeguards and limitations

- Explicit production CORS and WebSocket Origin checks; request/message rate
  and payload limits; database-aware health checks.
- Capability tokens protect session reads, writes, versions, and WebSockets.
- Export-image fetching rejects credentials, fragments, non-HTTP schemes,
  unusual ports, private/non-routable resolved addresses, SVG, redirects to
  unsafe hosts, and oversized responses. Egress firewall policy remains the
  strongest defense and should deny private/metadata networks for the service.
- Upload, image-pixel, PDF-page, export, retention, and WebSocket bounds.
- Runtime files are ephemeral and expire; collaboration state is PostgreSQL.
- The service has no user-account/role system. Anyone holding a complete share
  link has the session capability, so links must be treated as secrets.
