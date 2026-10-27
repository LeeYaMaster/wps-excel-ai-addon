#!/bin/bash
# DEPRECATED (2026-10-26): 曾同时写入 OfficeAI(:3889) + WpsExcelAI(:13991)。
# Mac WPS 表格(et) 同一时间大约只加载一个 et 加载项；双挂无意义且易冲突。
# 请改用：
#   bash "$(dirname "$0")/install-ours-standalone.sh"
set -euo pipefail
echo "DEPRECATED: install-both-containers.sh 已过时。转发到 install-ours-standalone.sh …" >&2
exec bash "$(cd "$(dirname "$0")" && pwd)/install-ours-standalone.sh"
