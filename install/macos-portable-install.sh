#!/bin/bash
# 可分享安装：把加载项与代理装到 ~/Library/Application Support/WpsExcelAI
# 不依赖 Desktop（避免 LaunchAgent TCC）。可从任意解压目录运行。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# dist 包：脚本与 addon/ 同级；仓库：脚本在 install/ 下
if [ -f "$SCRIPT_DIR/addon/ribbon.xml" ]; then
  ROOT="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../addon/ribbon.xml" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "ERROR: cannot locate addon/ near $SCRIPT_DIR" >&2
  exit 1
fi

ADDON_SRC="$ROOT/addon"
PROXY_SRC="$ROOT/proxy/server.py"
SUPPORT="$HOME/Library/Application Support/WpsExcelAI"
ADDON_SUPPORT="$SUPPORT/addon"
PORT=13991
PROXY_PORT=8787
DEST_NAME="WpsExcelAI_1.0.0"
GLOBAL_JSADDONS="$HOME/Library/Containers/com.kingsoft.wpsoffice.mac.global/Data/.kingsoft/wps/jsaddons"
NORMAL_JSADDONS="$HOME/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons"
LABEL_SERVER="com.wps.excelai.server"
LABEL_PROXY="com.wps.excelai.proxy"
LOG_DIR="$HOME/Library/Logs/WpsExcelAI"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

err() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }
info() { echo "$*"; }

[ -d "$ADDON_SRC" ] || err "addon/ missing at $ADDON_SRC"
[ -f "$ADDON_SRC/ribbon.xml" ] || err "ribbon.xml missing"
[ -f "$PROXY_SRC" ] || err "proxy/server.py missing"
command -v rsync >/dev/null || err "rsync not found"
command -v curl >/dev/null || err "curl not found"
if [ -x /usr/bin/python3 ]; then PYTHON=/usr/bin/python3
else PYTHON="$(command -v python3)" || err "python3 not found"; fi

mkdir -p "$SUPPORT" "$ADDON_SUPPORT" "$LOG_DIR" "$HOME/Library/LaunchAgents"

info "==> install files → $SUPPORT"
# rsync only touches addon/；settings.json 在 SUPPORT 根目录，不会被删
rsync -a --delete "$ADDON_SRC/" "$ADDON_SUPPORT/"
cp "$PROXY_SRC" "$SUPPORT/proxy-server.py"
chmod 755 "$SUPPORT/proxy-server.py"
SERVER_SRC=""
if [ -f "$ROOT/scripts/addon-server.py" ]; then
  SERVER_SRC="$ROOT/scripts/addon-server.py"
elif [ -f "$ROOT/addon-server.py" ]; then
  SERVER_SRC="$ROOT/addon-server.py"
fi
[ -n "$SERVER_SRC" ] || err "addon-server.py missing (expected $ROOT/scripts/addon-server.py)"
cp "$SERVER_SRC" "$SUPPORT/addon-server.py"
chmod 755 "$SUPPORT/addon-server.py"
info "preserved settings.json if present: $SUPPORT/settings.json"

# ensure index.html for online mode
if [ ! -f "$ADDON_SUPPORT/index.html" ]; then
  cat > "$ADDON_SUPPORT/index.html" <<'HTML'
<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>WpsExcelAI</title>
<script type="text/javascript" src="./main.js"></script>
</head><body></body></html>
HTML
fi

PUBLISH_XML="<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<jsplugins>
  <jspluginonline name=\"WpsExcelAI\" type=\"et\" url=\"http://127.0.0.1:${PORT}/\" enable=\"enable\" install=\"null\"/>
</jsplugins>"

sync_jsaddons() {
  local dir="$1" label="$2"
  if ! mkdir -p "$dir" 2>/dev/null; then
    warn "[$label] cannot mkdir $dir"; return 1
  fi
  if ! touch "$dir/.wps-excelai-write-test" 2>/dev/null; then
    warn "[$label] cannot write $dir"; return 1
  fi
  rm -f "$dir/.wps-excelai-write-test"
  rm -rf "$dir/$DEST_NAME"
  mkdir -p "$dir/$DEST_NAME"
  rsync -a --delete "$ADDON_SUPPORT/" "$dir/$DEST_NAME/"
  printf '%s\n' "$PUBLISH_XML" > "$dir/publish.xml"
  info "OK [$label] $dir"
  return 0
}

info "==> sync → WPS jsaddons"
synced=0
sync_jsaddons "$GLOBAL_JSADDONS" "global" && synced=1 || true
sync_jsaddons "$NORMAL_JSADDONS" "normal" && synced=1 || true
[ "$synced" = "1" ] || err "未能写入 jsaddons。请在「隐私与安全性 → 完全磁盘访问权限」勾选「终端」后重试。"

SERVE_DIR="$GLOBAL_JSADDONS/$DEST_NAME"
[ -f "$SERVE_DIR/ribbon.xml" ] || SERVE_DIR="$ADDON_SUPPORT"

# LaunchAgents
bootout() {
  local label="$1" plist="$2"
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  if [ -f "$plist" ]; then
    launchctl bootout "$DOMAIN" "$plist" 2>/dev/null || true
    launchctl unload "$plist" 2>/dev/null || true
  fi
}

info "==> LaunchAgent static :$PORT"
PLIST_S="$HOME/Library/LaunchAgents/${LABEL_SERVER}.plist"
bootout "$LABEL_SERVER" "$PLIST_S"
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 0.3
fi
# Prefer jsaddons copy if present
if [ -f "$GLOBAL_JSADDONS/$DEST_NAME/ribbon.xml" ]; then
  SERVE_DIR="$GLOBAL_JSADDONS/$DEST_NAME"
fi
cat > "$PLIST_S" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL_SERVER}</string>
  <key>ProgramArguments</key><array>
    <string>${PYTHON}</string>
    <string>${SUPPORT}/addon-server.py</string>
    <string>${SERVE_DIR}</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>WPS_EXCELAI_SERVE_DIR</key><string>${SERVE_DIR}</string>
    <key>WPS_EXCELAI_PORT</key><string>${PORT}</string>
  </dict>
  <key>WorkingDirectory</key><string>${SUPPORT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_DIR}/server.out.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/server.err.log</string>
</dict></plist>
PLIST
launchctl bootstrap "$DOMAIN" "$PLIST_S"
launchctl enable "$DOMAIN/$LABEL_SERVER" 2>/dev/null || true
launchctl kickstart -k "$DOMAIN/$LABEL_SERVER" 2>/dev/null || true

info "==> LaunchAgent proxy :$PROXY_PORT"
PLIST_P="$HOME/Library/LaunchAgents/${LABEL_PROXY}.plist"
bootout "$LABEL_PROXY" "$PLIST_P"
if lsof -tiTCP:"$PROXY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -tiTCP:"$PROXY_PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 0.3
fi
cat > "$PLIST_P" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL_PROXY}</string>
  <key>ProgramArguments</key><array>
    <string>${PYTHON}</string><string>${SUPPORT}/proxy-server.py</string>
  </array>
  <key>WorkingDirectory</key><string>${SUPPORT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_DIR}/proxy.out.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/proxy.err.log</string>
</dict></plist>
PLIST
launchctl bootstrap "$DOMAIN" "$PLIST_P"
launchctl enable "$DOMAIN/$LABEL_PROXY" 2>/dev/null || true
launchctl kickstart -k "$DOMAIN/$LABEL_PROXY" 2>/dev/null || true

info "==> health"
ok_r=0; ok_p=0
for i in $(seq 1 20); do
  c=$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/ribbon.xml" 2>/dev/null || echo 000)
  [ "$c" = "200" ] && ok_r=1 && break
  sleep 0.3
done
for i in $(seq 1 20); do
  c=$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PROXY_PORT}/health" 2>/dev/null || echo 000)
  [ "$c" = "200" ] && ok_p=1 && break
  sleep 0.3
done
[ "$ok_r" = "1" ] || err "ribbon.xml health failed — see $LOG_DIR/server.err.log"
[ "$ok_p" = "1" ] || err "proxy health failed — see $LOG_DIR/proxy.err.log"

info ""
info "安装成功。"
info "验证：curl -sI http://127.0.0.1:${PORT}/ribbon.xml  与  curl -s http://127.0.0.1:${PROXY_PORT}/health"
info "请 ⌘Q 完全退出 WPS 后重新打开「表格」，功能区应出现「AI 助手」。"
info "在侧栏「设置」填写 API Key；默认走本地代理。"
