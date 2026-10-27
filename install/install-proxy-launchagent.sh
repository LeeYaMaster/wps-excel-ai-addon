#!/bin/bash
# Install / reload user LaunchAgent so WpsExcelAI CORS proxy (:8787) starts at login.
# ProgramArguments: /usr/bin/python3 + script under ~/Library/Application Support
# (LaunchAgent cannot exec files under ~/Desktop due to macOS TCC).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.wps.excelai.proxy"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SUPPORT_DIR="$HOME/Library/Application Support/WpsExcelAI"
PROXY_SCRIPT="$SUPPORT_DIR/proxy-server.py"
SRC_PROXY="$ROOT/proxy/server.py"
LOG_DIR="$HOME/Library/Logs/WpsExcelAI"
PORT=8787
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

err() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "$*"; }

[ -f "$SRC_PROXY" ] || err "proxy source missing: $SRC_PROXY"

if [ -x /usr/bin/python3 ]; then
  PYTHON=/usr/bin/python3
else
  PYTHON="$(command -v python3)" || err "python3 not found"
fi
"$PYTHON" -c "import http.server, urllib.request" 2>/dev/null || err "$PYTHON missing http.server/urllib"

mkdir -p "$HOME/Library/LaunchAgents" "$SUPPORT_DIR" "$LOG_DIR"
mkdir -p "$ROOT/logs" 2>/dev/null || true

# Install script outside Desktop so launchd/TCC can execute it
cp "$SRC_PROXY" "$PROXY_SCRIPT"
chmod 755 "$PROXY_SCRIPT"
info "installed $PROXY_SCRIPT"

# Stop ad-hoc nohup / stray listeners so LaunchAgent can bind :8787
if [ -f /tmp/wps-excel-ai-proxy.pid ]; then
  old="$(cat /tmp/wps-excel-ai-proxy.pid 2>/dev/null || true)"
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 0.3
  fi
  rm -f /tmp/wps-excel-ai-proxy.pid
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

OUT_LOG="$LOG_DIR/proxy.out.log"
ERR_LOG="$LOG_DIR/proxy.err.log"

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
    <string>${PROXY_SCRIPT}</string>
  </array>
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

info "wrote $PLIST_DEST (python → $PROXY_SCRIPT on :${PORT})"

if ! launchctl bootstrap "$DOMAIN" "$PLIST_DEST"; then
  err "launchctl bootstrap failed for $PLIST_DEST"
fi
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || true

ok=0
code=000
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  code="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo 000)"
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
  err "http://127.0.0.1:${PORT}/health did not return 200 (got ${code:-unknown}). Check $ERR_LOG"
fi

info "OK http://127.0.0.1:${PORT}/health → 200"
info "logs: $OUT_LOG / $ERR_LOG"
