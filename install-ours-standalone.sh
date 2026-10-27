#!/bin/bash
# 推荐安装：仅「AI 助手」(WpsExcelAI)，自有 HTTP :13991 + LaunchAgent 登录自启。
# 不依赖、不安装 OfficeAI。Mac 上 et 同一时间大约只加载一个 et 加载项。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ADDON_SRC="$ROOT/addon"
PORT=13991
DEST_NAME="WpsExcelAI_1.0.0"
GLOBAL_JSADDONS="$HOME/Library/Containers/com.kingsoft.wpsoffice.mac.global/Data/.kingsoft/wps/jsaddons"
NORMAL_JSADDONS="$HOME/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons"

err() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }
info() { echo "$*"; }

[ -d "$ADDON_SRC" ] || err "addon/ missing at $ADDON_SRC"
[ -f "$ADDON_SRC/ribbon.xml" ] || err "addon/ribbon.xml missing"
[ -f "$ADDON_SRC/main.js" ] || err "addon/main.js missing"
command -v rsync >/dev/null || err "rsync not found"
command -v python3 >/dev/null || err "python3 not found"
command -v curl >/dev/null || err "curl not found"

PUBLISH_XML="<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<jsplugins>
  <jspluginonline name=\"WpsExcelAI\" type=\"et\" url=\"http://127.0.0.1:${PORT}/\" enable=\"enable\" install=\"null\"/>
</jsplugins>"

ensure_index_html() {
  local dest="$1"
  if [ ! -f "$dest/index.html" ]; then
    cat > "$dest/index.html" <<'HTML'
<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>WpsExcelAI</title>
<script type="text/javascript" src="./main.js"></script>
</head><body></body></html>
HTML
  fi
}

sync_to() {
  local dir="$1"
  local label="$2"
  if ! mkdir -p "$dir" 2>/dev/null; then
    warn "[$label] cannot mkdir $dir (often Full Disk Access / sandbox). Skip."
    return 1
  fi
  if ! touch "$dir/.wps-excelai-write-test" 2>/dev/null; then
    warn "[$label] cannot write $dir (FDA?). Skip."
    return 1
  fi
  rm -f "$dir/.wps-excelai-write-test"

  rm -rf "$dir/$DEST_NAME"
  mkdir -p "$dir/$DEST_NAME"
  rsync -a --delete "$ADDON_SRC/" "$dir/$DEST_NAME/"
  ensure_index_html "$dir/$DEST_NAME"
  # online 模式：publish.xml 仅含我们自己的一条，避免与 OfficeAI et 冲突
  printf '%s\n' "$PUBLISH_XML" > "$dir/publish.xml"
  # also keep a copy as reference
  if [ -d "$ROOT/install" ]; then
    printf '%s\n' "$PUBLISH_XML" > "$ROOT/install/publish-mac-online.xml"
  fi
  info "OK [$label] $dir/publish.xml + $DEST_NAME"
  return 0
}

info "==> sync addon → jsaddons"
synced=0
if sync_to "$GLOBAL_JSADDONS" "global"; then
  synced=1
fi
if sync_to "$NORMAL_JSADDONS" "normal"; then
  synced=1
else
  warn "普通版容器 com.kingsoft.wpsoffice.mac 写入失败属常见（自动化无 FDA）。国际版 global 成功即可；本机「终端」有 FDA 时可再跑本脚本。"
fi
[ "$synced" = "1" ] || err "未能写入任一 jsaddons。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」勾选「终端」后，在本机终端重跑本脚本。"

SERVE_DIR="$GLOBAL_JSADDONS/$DEST_NAME"
[ -f "$SERVE_DIR/ribbon.xml" ] || err "after sync, ribbon.xml still missing at $SERVE_DIR"

# Prefer LaunchAgent over ad-hoc nohup
info "==> install LaunchAgent (login auto-start :${PORT})"
if [ -x "$ROOT/install-launchagent.sh" ]; then
  bash "$ROOT/install-launchagent.sh"
else
  warn "install-launchagent.sh missing; falling back to nohup (not persistent across reboot)"
  LOG="/tmp/wps-excel-ai-http.log"
  PIDFILE="/tmp/wps-excel-ai-http.pid"
  if [ -f "$PIDFILE" ]; then
    old=$(cat "$PIDFILE" || true)
    if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
      kill "$old" 2>/dev/null || true
      sleep 0.5
    fi
    rm -f "$PIDFILE"
  fi
  if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
    sleep 0.3
  fi
  nohup bash "$ROOT/scripts/serve-addon.sh" >"$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 0.8
  code=$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/ribbon.xml" || echo fail)
  [ "$code" = "200" ] || err "server health check failed: $code (log $LOG)"
  info "server http://127.0.0.1:${PORT}/ → $code (pid $(cat "$PIDFILE"); no LaunchAgent)"
fi

# CORS proxy LaunchAgent (:8787) — required for WPS WebView (Failed to fetch without it)
PROXY_PORT=8787
info "==> install CORS proxy LaunchAgent (login auto-start :${PROXY_PORT})"
if [ -x "$ROOT/install-proxy-launchagent.sh" ]; then
  bash "$ROOT/install-proxy-launchagent.sh"
else
  warn "install-proxy-launchagent.sh missing; proxy will not auto-start after reboot"
fi

info "==> health checks"
ribbon_code=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/ribbon.xml" || echo fail)
proxy_code=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PROXY_PORT}/health" || echo fail)
[ "$ribbon_code" = "200" ] || err "static server health failed: ribbon.xml → $ribbon_code"
[ "$proxy_code" = "200" ] || err "proxy health failed: /health → $proxy_code"
info "OK :${PORT}/ribbon.xml → 200 ; :${PROXY_PORT}/health → 200"

info ""
info "完成。请 ⌘Q 完全退出 WPS 后重新打开「表格」，功能区应出现「AI 助手」。"
info "设置页默认勾选「使用本地代理」。若你以前关掉过，请重新勾选并保存；DeepSeek 请用 Base URL https://api.deepseek.com/v1 + 模型 deepseek-chat。"
info "API 配置保存在 ~/Library/Application Support/WpsExcelAI/settings.json（本安装脚本不会删除）。"
info "推荐命令（以后重装/更新）："
info "  bash \"$ROOT/install-ours-standalone.sh\""
