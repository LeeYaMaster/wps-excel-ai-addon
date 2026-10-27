#!/bin/bash
# Install / reload user LaunchAgent so WpsExcelAI HTTP (:13991) starts at login.
# ProgramArguments: python3 + addon-server.py under Application Support
# (LaunchAgent cannot exec files under ~/Desktop due to macOS TCC).
# Serves static files + GET/POST /api/settings → settings.json (never deleted by install).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.wps.excelai.server"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SERVE_DIR="$HOME/Library/Containers/com.kingsoft.wpsoffice.mac.global/Data/.kingsoft/wps/jsaddons/WpsExcelAI_1.0.0"
SUPPORT_DIR="$HOME/Library/Application Support/WpsExcelAI"
SERVER_SCRIPT="$SUPPORT_DIR/addon-server.py"
SRC_SERVER="$ROOT/scripts/addon-server.py"
LOG_DIR="$HOME/Library/Logs/WpsExcelAI"
PORT=13991
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

err() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "$*"; }

[ -d "$SERVE_DIR" ] || err "addon not installed at $SERVE_DIR — run install-ours-standalone.sh first"
[ -f "$SERVE_DIR/ribbon.xml" ] || err "ribbon.xml missing in $SERVE_DIR"
[ -f "$SRC_SERVER" ] || err "server source missing: $SRC_SERVER"

if [ -x /usr/bin/python3 ]; then
  PYTHON=/usr/bin/python3
else
  PYTHON="$(command -v python3)" || err "python3 not found"
fi
"$PYTHON" -c "import http.server" 2>/dev/null || err "$PYTHON cannot import http.server"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$SUPPORT_DIR"
# Do NOT remove settings.json — install must preserve user API config
mkdir -p "$ROOT/logs" 2>/dev/null || true

cp "$SRC_SERVER" "$SERVER_SCRIPT"
chmod 755 "$SERVER_SCRIPT"
info "installed $SERVER_SCRIPT (settings.json preserved if present)"

# Stop ad-hoc nohup / stray listeners so LaunchAgent can bind :13991
if [ -f /tmp/wps-excel-ai-http.pid ]; then
  old="$(cat /tmp/wps-excel-ai-http.pid 2>/dev/null || true)"
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 0.3
  fi
  rm -f /tmp/wps-excel-ai-http.pid
fi

# Unload existing agent first
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ -f "$PLIST_DEST" ]; then
  launchctl bootout "$DOMAIN" "$PLIST_DEST" 2>/dev/null || true
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi
sleep 0.2

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 0.4
fi

OUT_LOG="$LOG_DIR/server.out.log"
ERR_LOG="$LOG_DIR/server.err.log"

cat > "$PLIST_DEST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON}</string>
    <string>${SERVER_SCRIPT}</string>
    <string>${SERVE_DIR}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WPS_EXCELAI_SERVE_DIR</key>
    <string>${SERVE_DIR}</string>
    <key>WPS_EXCELAI_PORT</key>
    <string>${PORT}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${SUPPORT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>
</dict>
</plist>
PLIST

info "wrote $PLIST_DEST (python → $SERVER_SCRIPT → $SERVE_DIR)"

if ! launchctl bootstrap "$DOMAIN" "$PLIST_DEST"; then
  err "launchctl bootstrap failed for $PLIST_DEST"
fi
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || true

ok=0
code=000
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  code="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/ribbon.xml" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    ok=1
    break
  fi
  sleep 0.4
done

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  info "LaunchAgent loaded: $LABEL"
elif launchctl list | grep -q "$LABEL"; then
  info "LaunchAgent listed: $LABEL"
else
  err "LaunchAgent $LABEL not visible in launchctl after bootstrap"
fi

if [ "$ok" != "1" ]; then
  echo "--- launchctl print (tail) ---" >&2
  launchctl print "$DOMAIN/$LABEL" 2>&1 | head -50 >&2 || true
  echo "--- last stderr ---" >&2
  tail -n 40 "$ERR_LOG" 2>/dev/null >&2 || true
  err "http://127.0.0.1:${PORT}/ribbon.xml did not return 200 (got ${code:-unknown}). Check $ERR_LOG"
fi

# smoke settings API
api_code="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/settings" 2>/dev/null || echo 000)"
[ "$api_code" = "200" ] || err "/api/settings GET failed: $api_code"
info "OK http://127.0.0.1:${PORT}/ribbon.xml → 200 ; /api/settings → 200"
info "settings file: $SUPPORT_DIR/settings.json (install never deletes this)"
info "logs: $OUT_LOG / $ERR_LOG"
