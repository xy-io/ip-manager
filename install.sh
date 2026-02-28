#!/bin/bash
# ============================================================
#  IP Address Manager — LXC Install Script
#  Target: Ubuntu 24.04 LXC on Proxmox
#  Serves the built React app via Nginx on port 80
# ============================================================

set -e  # Exit immediately if any command fails

# ── Config ───────────────────────────────────────────────────
REPO_URL="https://github.com/xy-io/ip-manager"
APP_DIR="/opt/ip-manager"
NGINX_SITE="ip-manager"
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
log "Installing dependencies (curl, git, nginx)..."
apt-get install -y -qq curl git nginx
ok "Dependencies installed"

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

# ── 5. Install npm packages ──────────────────────────────────
log "Installing npm packages..."
cd "$APP_DIR"
npm install --silent
ok "npm packages installed"

# ── 6. Build the React app ───────────────────────────────────
log "Building React app (this may take a moment)..."
npm run build --silent
ok "App built — output in $APP_DIR/dist"

# ── 7. Configure Nginx ───────────────────────────────────────
log "Configuring Nginx..."

# Get the container's IP for display at the end
HOST_IP=$(hostname -I | awk '{print $1}')

cat > /etc/nginx/sites-available/$NGINX_SITE <<EOF
server {
    listen 80;
    server_name _;

    root $APP_DIR/dist;
    index index.html;

    # Serve the React SPA — all routes fall back to index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache static assets
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

# Enable site, disable default
ln -sf /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-enabled/$NGINX_SITE
rm -f /etc/nginx/sites-enabled/default

# Test config and reload
nginx -t -q 2>/dev/null || err "Nginx config invalid — check /etc/nginx/sites-available/$NGINX_SITE"
systemctl enable nginx --quiet
systemctl restart nginx
ok "Nginx configured and running"

# ── 8. Create update script ──────────────────────────────────
log "Creating update helper script..."
cat > /usr/local/bin/ip-manager-update <<'UPDATESCRIPT'
#!/bin/bash
echo "Pulling latest changes from GitHub..."
git -C /opt/ip-manager pull
echo "Installing any new packages..."
cd /opt/ip-manager && npm install --silent
echo "Rebuilding app..."
npm run build --silent
echo "Reloading Nginx..."
systemctl reload nginx
echo "Done! IP Manager updated."
UPDATESCRIPT
chmod +x /usr/local/bin/ip-manager-update
ok "Update script created at /usr/local/bin/ip-manager-update"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Installation Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  ${BLUE}App URL:${NC}     http://$HOST_IP"
echo -e "  ${BLUE}App files:${NC}   $APP_DIR"
echo -e "  ${BLUE}Nginx log:${NC}   /var/log/nginx/ip-manager.access.log"
echo ""
echo -e "  To update the app later, run:"
echo -e "  ${YELLOW}  ip-manager-update${NC}"
echo ""
