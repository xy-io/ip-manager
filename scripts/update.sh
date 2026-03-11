#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# IP Manager — update script
# Lives in the repo so changes land automatically on the next git pull.
# Called by the thin wrapper at /usr/local/bin/ip-manager-update.
# ─────────────────────────────────────────────────────────────────────────────
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo "Pulling latest changes from GitHub..."
git -C /opt/ip-manager pull
ok "Repository up to date"

# ── 2. System dependencies ────────────────────────────────────────────────────
echo ""
echo "Ensuring system dependencies are installed..."
apt-get install -y -qq arp-scan fping libcap2-bin 2>/dev/null || true

ARPSCAN_BIN=$(which arp-scan 2>/dev/null || echo "")
if [ -n "$ARPSCAN_BIN" ]; then
  setcap cap_net_raw+ep "$ARPSCAN_BIN" 2>/dev/null && ok "arp-scan: CAP_NET_RAW granted" || warn "arp-scan: setcap failed (non-fatal)"
else
  warn "arp-scan not found — ARP scan will fall back to kernel ARP cache"
fi

FPING_BIN=$(which fping 2>/dev/null || echo "")
if [ -n "$FPING_BIN" ]; then
  setcap cap_net_raw+ep "$FPING_BIN" 2>/dev/null && ok "fping: CAP_NET_RAW granted" || warn "fping: setcap failed (non-fatal)"
else
  warn "fping not found — ping/reachability badges will not work"
fi

# ── 3. Refresh the /usr/local/bin wrapper (self-update) ──────────────────────
# Rewrites the thin wrapper so future calls also use the latest script.
cat > /usr/local/bin/ip-manager-update <<'WRAPPER'
#!/bin/bash
exec bash /opt/ip-manager/scripts/update.sh "$@"
WRAPPER
chmod +x /usr/local/bin/ip-manager-update
ok "Update wrapper refreshed"

# ── 4. Frontend dependencies & build ─────────────────────────────────────────
echo ""
echo "Installing frontend packages..."
cd /opt/ip-manager
rm -rf node_modules package-lock.json
npm install 2>&1 | grep -E "^npm (error|warn)|ERR!" || true

echo "Rebuilding React app..."
npm run build 2>&1 || { err "React build failed"; exit 1; }
[ -f /opt/ip-manager/dist/index.html ] || { err "dist/index.html missing after build"; exit 1; }
ok "React app built"

# ── 5. API server dependencies ────────────────────────────────────────────────
echo ""
echo "Installing API server packages..."
cd /opt/ip-manager/server
npm install 2>&1 | grep -E "^npm (error|warn)|ERR!" || true
ok "Server packages installed"

# ── 6. Permissions & credentials file ────────────────────────────────────────
echo ""
echo "Setting permissions..."
chown -R www-data:www-data /opt/ip-manager/server
touch /opt/ip-manager/server/credentials.env
chown www-data:www-data /opt/ip-manager/server/credentials.env
chmod 600 /opt/ip-manager/server/credentials.env
ok "Permissions set"

# ── 7. Restart service ────────────────────────────────────────────────────────
echo ""
echo "Restarting API server..."
systemctl restart ip-manager-api
ok "ip-manager-api restarted"

# ── 8. Nginx no-cache patch (idempotent) ──────────────────────────────────────
if ! grep -q "no-store" /etc/nginx/sites-available/ip-manager 2>/dev/null; then
  echo "Patching Nginx config (index.html no-cache)..."
  sed -i 's|location / {|location = /index.html {\n        try_files $uri =404;\n        add_header Cache-Control "no-store, no-cache, must-revalidate";\n        add_header Pragma "no-cache";\n    }\n\n    location / {|' /etc/nginx/sites-available/ip-manager
fi
systemctl reload nginx
ok "Nginx reloaded"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  IP Manager updated successfully. Data unchanged.${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
