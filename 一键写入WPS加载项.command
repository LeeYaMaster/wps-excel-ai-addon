#!/bin/bash
# 双击运行：安装「AI 助手」独立版（:13991 + LaunchAgent）
cd "$(dirname "$0")"
bash ./install-ours-standalone.sh
echo
read -n 1 -s -r -p "按任意键关闭…"
