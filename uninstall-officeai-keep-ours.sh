#!/bin/bash
# 卸载 OfficeAI.Chat，并立刻重装「AI 助手」独立版（:13991）。
# 注意：若你已用官方方式卸过 OfficeAI，通常不必再跑本脚本；直接：
#   bash "$(dirname "$0")/install-ours-standalone.sh"
# 官方卸载会删 publish.xml 与 ~/.officeai.chat，因此卸完后必须重装我们的配置。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "将卸载 OfficeAI.Chat（若仍在），并立刻重装「AI 助手」（不依赖 OfficeAI）。"
echo "官方卸载脚本会删 publish.xml 和 ~/.officeai.chat，随后本脚本会写回我们的配置。"
echo

OFFICIAL="/Library/Application Support/OfficeAIChat/plugin/uninstall-permanent-mac.sh"
if [ -f "$OFFICIAL" ]; then
  bash "$OFFICIAL" || true
else
  echo "未找到官方卸载脚本（OfficeAI 可能已卸）。跳过官方卸载，直接重装「AI 助手」…"
  LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.officeai.chat.server.plist"
  if [ -f "$LAUNCH_AGENT" ]; then
    launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT" 2>/dev/null || true
    launchctl unload "$LAUNCH_AGENT" 2>/dev/null || true
    rm -f "$LAUNCH_AGENT"
  fi
  pkill -9 -f "serve-permanent" 2>/dev/null || true
  pkill -9 -f "officeai.chat/tools/proxy-server" 2>/dev/null || true
fi

echo
echo "正在重装「AI 助手」独立版…"
bash "$ROOT/install-ours-standalone.sh"
echo
echo "完成。⌘Q 退出 WPS 后重开表格即可。"
