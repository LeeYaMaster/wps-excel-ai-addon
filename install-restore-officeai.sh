#!/bin/bash
# DEPRECATED (2026-10-26): OfficeAI.Chat 已卸载；本脚本曾把 publish.xml 指回 :3889（OfficeAI）。
# 勿再运行——会破坏当前仅 WpsExcelAI(:13991) 的可用配置。
# 若只想重装「AI 助手」，请改用：
#   bash "$(dirname "$0")/install-ours-standalone.sh"
set -euo pipefail
echo "DEPRECATED: install-restore-officeai.sh 已过时（OfficeAI :3889 不再使用）。" >&2
echo "请改用: bash \"$(cd "$(dirname "$0")" && pwd)/install-ours-standalone.sh\"" >&2
exit 1
