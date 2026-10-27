#!/bin/bash
# DEPRECATED (2026-10-26): 曾用于「保留 OfficeAI 的 wps/wpp/pdf，et 只挂我们的」测试（仍依赖 :3889）。
# OfficeAI 已卸；请改用独立安装：
#   bash "$(dirname "$0")/install-ours-standalone.sh"
set -euo pipefail
echo "DEPRECATED: install-test-only-ours.sh 已过时。转发到 install-ours-standalone.sh …" >&2
exec bash "$(cd "$(dirname "$0")" && pwd)/install-ours-standalone.sh"
