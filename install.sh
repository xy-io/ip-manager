#!/bin/bash
# ============================================================
#  IP Address Manager — LXC Install Script
#  Target: Ubuntu 24.04 LXC on Proxmox
#  - React frontend served by Nginx on port 80
#  - SQLite API server (Node/Express) on 127.0.0.1:3001
#  - Nginx proxies /api/ to the API server
# ============================================================

set -e  # Exit immediately if any command fails

# ── Config ───────────────────────────────────────────────────
REPO_URL="https://github.com/xy-io/ip-manager"
APP_DIR="/opt/ip-manager"
NGINX_SITE="ip-manager"
SERVICE_NAME="ip-manager-api"
NODE_VERSION="20"   # LTS

# ── Colours ──────────────────────────────────────────────────
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

log()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Root check ───────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Please run as root:  sudo bash install.sh"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   IP Address Manager — Installer${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# ── 1. System update ─────────────────────────────────────────
log "Updating package lists..."
apt-get update -qq
ok "Package lists updated"

# ── 2. Install dependencies ──────────────────────────────────
# build-essential is needed to compile better-sqlite3 native bindings
log "Installing dependencies (curl, git, nginx, build-essential, arp-scan, fping)..."
apt-get install -y -qq curl git nginx build-essential python3 arp-scan fping libcap2-bin
ok "Dependencies installed"

# Grant arp-scan + fping the raw socket capability they need to send raw packets.
# The service runs as www-data (non-root); without setcap both tools fail silently.
log "Granting arp-scan raw socket capability (CAP_NET_RAW)..."
ARPSCAN_BIN=$(which arp-scan 2>/dev/null || echo "")
if [ -n "$ARPSCAN_BIN" ]; then
  setcap cap_net_raw+ep "$ARPSCAN_BIN"
  ok "arp-scan can now run without root (setcap cap_net_raw+ep $ARPSCAN_BIN)"
else
  warn "arp-scan not found in PATH — skipping setcap. ARP scan will fall back to kernel ARP cache."
fi

log "Granting fping raw socket capability (CAP_NET_RAW)..."
FPING_BIN=$(which fping 2>/dev/null || echo "")
if [ -n "$FPING_BIN" ]; then
  setcap cap_net_raw+ep "$FPING_BIN"
  ok "fping can now run without root (setcap cap_net_raw+ep $FPING_BIN)"
else
  warn "fping not found in PATH — ping/reachability checks will not work."
fi

# ── 3. Install Node.js ───────────────────────────────────────
if command -v node &>/dev/null; then
  CURRENT_NODE=$(node --version)
  ok "Node.js already installed ($CURRENT_NODE) — skipping"
else
  log "Installing Node.js $NODE_VERSION LTS..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - &>/dev/null
  apt-get install -y -qq nodejs
  ok "Node.js $(node --version) installed"
fi

# ── 4. Clone / update repo ───────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  log "Repository already exists — pulling latest changes..."
  git -C "$APP_DIR" pull --quiet
  ok "Repository updated"
else
  log "Cloning repository from $REPO_URL..."
  git clone --quiet "$REPO_URL" "$APP_DIR"
  ok "Repository cloned to $APP_DIR"
fi

# Remove marketing site — development-only, not needed on the server
rm -rf "$APP_DIR/marketing"

# ── 5. Install frontend npm packages & build ─────────────────
log "Installing frontend npm packages..."
cd "$APP_DIR"
rm -rf node_modules package-lock.json
npm install 2>&1 | grep -E "error|warn|ERR" || true
ok "Frontend packages installed"

log "Building React app (this may take a moment)..."
npm run build 2>&1 || err "React build failed — check output above"

# Verify the build actually produced output
[ -f "$APP_DIR/dist/index.html" ] || err "Build appeared to succeed but dist/index.html is missing"
[ -d "$APP_DIR/dist/assets" ]     || err "Build appeared to succeed but dist/assets/ is missing"
ok "App built — output in $APP_DIR/dist"

# ── 6. Install API server packages ───────────────────────────
log "Installing API server packages (Express + better-sqlite3)..."
cd "$APP_DIR/server"
npm install 2>&1 | grep -E "error|warn|ERR" || true
ok "API server packages installed"

# ── 6a. Set permissions so www-data can write the database and credentials ───
log "Setting permissions on server directory..."
chown -R www-data:www-data "$APP_DIR/server"
# Pre-create credentials.env so www-data can write to it later (changing
# an existing file doesn't require directory write permission, but creating
# a new file does — so we create it now as root while we still can).
touch "$APP_DIR/server/credentials.env"
chown www-data:www-data "$APP_DIR/server/credentials.env"
chmod 600 "$APP_DIR/server/credentials.env"
ok "Permissions set — server directory and credentials.env owned by www-data"

# ── 7. Create systemd service for the API ────────────────────
log "Creating systemd service for the API server..."

cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=IP Address Manager — SQLite API
Documentation=https://github.com/xy-io/ip-manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$APP_DIR/server
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME} --quiet
systemctl restart ${SERVICE_NAME}

# ── Verify API started successfully ──────────────────────────
sleep 2
if systemctl is-active --quiet ${SERVICE_NAME}; then
  ok "API service created and started (${SERVICE_NAME})"
else
  err "API service failed to start — run: journalctl -u ${SERVICE_NAME} -n 30 --no-pager"
fi

# ── 8. Configure Nginx ───────────────────────────────────────
log "Configuring Nginx..."

HOST_IP=$(hostname -I | awk '{print $1}')

cat > /etc/nginx/sites-available/$NGINX_SITE <<EOF
server {
    listen 80;
    server_name _;

    root $APP_DIR/dist;
    index index.html;

    # Proxy /api/ requests to the Node API server
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 30s;
    }

    # index.html — never cache so browsers always get the latest entry point
    location = /index.html {
        try_files \$uri =404;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        add_header Pragma "no-cache";
    }

    # Serve the React SPA — all other routes fall back to index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Hashed static assets (JS/CSS) — safe to cache forever
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    access_log /var/log/nginx/ip-manager.access.log;
    error_log  /var/log/nginx/ip-manager.error.log;
}
EOF

ln -sf /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-enabled/$NGINX_SITE
rm -f /etc/nginx/sites-enabled/default

nginx -t -q 2>/dev/null || err "Nginx config invalid — check /etc/nginx/sites-available/$NGINX_SITE"
systemctl enable nginx --quiet
systemctl restart nginx
ok "Nginx configured and running"

# ── 9. Create update wrapper ──────────────────────────────────
# The real update logic lives in scripts/update.sh inside the repo so it
# stays current after every git pull. The wrapper here is intentionally
# minimal — it never needs to change.
log "Creating update wrapper at /usr/local/bin/ip-manager-update..."
cat > /usr/local/bin/ip-manager-update <<'WRAPPER'
#!/bin/bash
exec bash /opt/ip-manager/scripts/update.sh "$@"
WRAPPER
chmod +x /usr/local/bin/ip-manager-update
ok "Update wrapper created — logic lives in scripts/update.sh (always current)"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Installation Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  ${BLUE}App URL:${NC}      http://$HOST_IP"
echo -e "  ${BLUE}App files:${NC}    $APP_DIR"
echo -e "  ${BLUE}Database:${NC}     $APP_DIR/server/ip-manager.db"
echo -e "  ${BLUE}API logs:${NC}     journalctl -u ip-manager-api -f"
echo -e "  ${BLUE}Nginx log:${NC}    /var/log/nginx/ip-manager.access.log"
echo ""
echo -e "  To update the app later, run:"
echo -e "  ${YELLOW}  ip-manager-update${NC}"
echo ""