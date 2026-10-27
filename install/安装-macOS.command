#!/bin/bash
cd "$(dirname "$0")"
# Prefer portable installer beside this file (dist layout) or ../install/
if [ -f "./macos-portable-install.sh" ]; then
  bash "./macos-portable-install.sh"
elif [ -f "./install/macos-portable-install.sh" ]; then
  bash "./install/macos-portable-install.sh"
else
  echo "找不到 macos-portable-install.sh" >&2
  read -r _
  exit 1
fi
echo ""
echo "按回车关闭…"
read -r _
