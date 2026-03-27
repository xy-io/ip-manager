#!/bin/bash
# ============================================================
#  IP Address Manager — Update Script
#  Usage:
#    Terminal:  sudo bash /opt/ip-manager/scripts/update.sh
#    Alias:     ip-manager-update
#    In-app:    triggered via Settings → Updates (runs as root via sudoers)
#
#  With --api-mode stdout emits structured events the browser parses
#  for a live progress bar.  Without it, normal coloured output.
# ============================================================

APP_DIR="/opt/ip-manager"
SERVICE="ip-manager-api"
RESULT_FILE="$APP_DIR/server/.update-result.json"
API_MODE=false

for arg in "$@"; do [ "$arg" = "--api-mode" ] && API_MODE=true; done

# ── Colours (terminal only) ───────────────────────────────────
if [ "$API_MODE" = false ]; then
  G="\033[0;32m" B="\033[0;34m" Y="\033[1;33m" R="\033[0;31m" N="\033[0m"
else
  G="" B="" Y="" R="" N=""
fi

STEP_N=0; STEP_TOTAL=5

step()    { STEP_N=$((STEP_N+1))
            [ "$API_MODE" = true ] && echo "STEP:${STEP_N}:${STEP_TOTAL}:$1" \
                                   || echo -e "${B}[$STEP_N/$STEP_TOTAL]${N} $1"; }
log()     { [ "$API_MODE" = true ] && echo "LOG:$1"           || echo "  $1"; }
succeed() { [ "$API_MODE" = true ] && echo "OK:$1"            || echo -e "${G}✓ $1${N}"; }
fail_out(){ [ "$API_MODE" = true ] && echo "FAIL:$1"          || echo -e "${R}✗ $1${N}"; }

# ── Write persistent result so UI can read it after restart ──
write_result() {
  local status="$1" msg="$2" log="$3" ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  msg=$(printf '%s' "$msg" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "\"$msg\"")
  log=$(printf '%s' "$log" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "\"\"")
  printf '{"status":"%s","message":%s,"log":%s,"timestamp":"%s"}\n' \
    "$status" "$msg" "$log" "$ts" > "$RESULT_FILE"
  chown www-data:www-data "$RESULT_FILE" 2>/dev/null || true
}

# ── Root check ────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${R}[ERROR]${N} Run as root: sudo bash $0"; exit 1
fi

# ── Save rollback point ───────────────────────────────────────
ROLLBACK_HASH=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo "")
ERROR_LOG=""

rollback() {
  local reason="$1"
  [ "$API_MODE" = true ] && echo "ROLLBACK:Rolling back to previous version…" \
                         || echo -e "${Y}[ROLLBACK]${N} Reverting to $ROLLBACK_HASH…"
  if [ -n "$ROLLBACK_HASH" ]; then
    git -C "$APP_DIR" reset --hard "$ROLLBACK_HASH" >/dev/null 2>&1
    ERROR_LOG+="[reset] Reverted to $ROLLBACK_HASH\n"
    cd "$APP_DIR" && npm ci --quiet >/dev/null 2>&1 && ERROR_LOG+="[npm] Frontend deps restored\n"
    npm run build >/dev/null 2>&1               && ERROR_LOG+="[build] Previous build restored\n"
    cd "$APP_DIR/server" && npm ci --quiet >/dev/null 2>&1 && ERROR_LOG+="[npm] Server deps restored\n"
  fi
  write_result "failed" "$reason" "$(printf '%b' "$ERROR_LOG")"
  [ "$API_MODE" = true ] && echo "ROLLBACK_DONE:Rolled back — restarting old version…" \
                         || echo -e "${Y}[ROLLBACK]${N} Done. Restarting…"
  systemctl restart "$SERVICE" || true
  exit 1
}

# ── Step 1: git pull ──────────────────────────────────────────
step "Fetching latest code"
PULL_OUT=$(git -C "$APP_DIR" pull 2>&1); PULL_EXIT=$?
log "$PULL_OUT"
if [ $PULL_EXIT -ne 0 ]; then
  fail_out "git pull failed"; ERROR_LOG="git pull failed:\n$PULL_OUT\n"
  rollback "git pull failed"
fi
succeed "Code updated"

# ── Step 2: npm install (frontend) ────────────────────────────
step "Installing frontend dependencies"
cd "$APP_DIR"
# Remove node_modules and package-lock.json before installing.
# This ensures platform-specific optional packages (e.g. rollup native
# binaries) are resolved for the current OS/arch rather than whatever
# platform generated the committed lockfile.
rm -rf node_modules package-lock.json
NPM_OUT=$(npm install 2>&1); NPM_EXIT=$?
log "$(echo "$NPM_OUT" | tail -3)"
if [ $NPM_EXIT -ne 0 ]; then
  fail_out "npm install failed"; ERROR_LOG="npm install failed:\n$NPM_OUT\n"
  rollback "npm install failed"
fi
succeed "Frontend dependencies ready"

# ── Step 3: build ─────────────────────────────────────────────
step "Building app"
BUILD_OUT=$(npm run build 2>&1); BUILD_EXIT=$?
log "$(echo "$BUILD_OUT" | grep -E 'built in|error' | head -3)"
if [ $BUILD_EXIT -ne 0 ]; then
  fail_out "Build failed"; ERROR_LOG="Build failed:\n$BUILD_OUT\n"
  rollback "Build failed"
fi
succeed "App built"

# ── Step 4: npm install (server) ──────────────────────────────
step "Updating server packages"
cd "$APP_DIR/server"
SRV_OUT=$(npm install 2>&1); SRV_EXIT=$?
log "$(echo "$SRV_OUT" | tail -3)"
if [ $SRV_EXIT -ne 0 ]; then
  fail_out "Server npm install failed"; ERROR_LOG="Server npm install failed:\n$SRV_OUT\n"
  rollback "Server npm install failed"
fi
succeed "Server packages ready"

# ── Step 5: restart ───────────────────────────────────────────
step "Restarting service"
write_result "success" "Update complete" ""
[ "$API_MODE" = true ] && echo "RESTARTING:Service restarting — reconnecting shortly…" \
                       || echo -e "${B}Restarting ${SERVICE}…${N}"
systemctl restart "$SERVICE"
succeed "Service restarted"

[ "$API_MODE" = false ] && echo -e "\n${G}Update complete!${N}\n"
