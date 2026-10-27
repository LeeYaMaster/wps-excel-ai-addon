#!/bin/bash
# 产出可分享的 macOS / Windows 安装包到 dist/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
STAGE_MAC="$DIST/WpsExcelAI-macOS"
STAGE_WIN="$DIST/WpsExcelAI-Windows"
VER="1.2.3"

rm -rf "$STAGE_MAC" "$STAGE_WIN"
mkdir -p "$STAGE_MAC/addon" "$STAGE_MAC/proxy" "$STAGE_WIN/addon" "$STAGE_WIN/proxy" "$STAGE_WIN/install"

echo "==> stage macOS"
rsync -a --delete "$ROOT/addon/" "$STAGE_MAC/addon/"
cp "$ROOT/proxy/server.py" "$STAGE_MAC/proxy/server.py"
mkdir -p "$STAGE_MAC/scripts"
cp "$ROOT/scripts/addon-server.py" "$STAGE_MAC/scripts/addon-server.py"
cp "$ROOT/scripts/addon-server.py" "$STAGE_MAC/addon-server.py"
cp "$ROOT/install/macos-portable-install.sh" "$STAGE_MAC/macos-portable-install.sh"
cp "$ROOT/install/安装-macOS.command" "$STAGE_MAC/安装-macOS.command"
cp "$ROOT/install/README-分发说明.txt" "$STAGE_MAC/README-发给别人怎么用.txt"
chmod +x "$STAGE_MAC/macos-portable-install.sh" "$STAGE_MAC/安装-macOS.command"

# short README inside package
cat > "$STAGE_MAC/先读我.txt" <<EOF
WpsExcelAI ${VER} — macOS 安装包
1. 双击「安装-macOS.command」
2. 若 macOS 拦截：右键该文件 → 打开 → 仍要打开
3. 验证：终端执行
   curl -sI http://127.0.0.1:13991/ribbon.xml
   curl -s  http://127.0.0.1:8787/health
4. ⌘Q 退出 WPS，重开表格 → 功能区「AI 助手」
5. 设置里填写你自己的 API Key（包内无密钥）
EOF

echo "==> stage Windows"
rsync -a --delete "$ROOT/addon/" "$STAGE_WIN/addon/"
cp "$ROOT/proxy/server.py" "$STAGE_WIN/proxy/server.py"
mkdir -p "$STAGE_WIN/scripts"
cp "$ROOT/scripts/addon-server.py" "$STAGE_WIN/scripts/addon-server.py"
cp "$ROOT/scripts/addon-server.py" "$STAGE_WIN/addon-server.py"
cp "$ROOT/install/install-windows.ps1" "$STAGE_WIN/install-windows.ps1"
cp "$ROOT/install/install.bat" "$STAGE_WIN/install.bat"
cp "$ROOT/install/publish.xml" "$STAGE_WIN/publish.xml"
cp "$ROOT/install/README-分发说明.txt" "$STAGE_WIN/README-发给别人怎么用.txt"
cat > "$STAGE_WIN/先读我.txt" <<EOF
WpsExcelAI ${VER} — Windows 安装包
1. 双击 install.bat（或 PowerShell: .\install-windows.ps1）
2. 建议已安装 Python 3 并勾选 PATH（用于 CORS 代理 :8787）
3. 验证：浏览器打开 http://127.0.0.1:8787/health
4. 完全退出并重启 WPS 表格 → 「AI 助手」
5. 设置里填写你自己的 API Key
EOF

echo "==> zip"
rm -f "$DIST/WpsExcelAI-macOS.zip" "$DIST/WpsExcelAI-Windows.zip"
( cd "$DIST" && zip -r -q "WpsExcelAI-macOS.zip" "WpsExcelAI-macOS" )
( cd "$DIST" && zip -r -q "WpsExcelAI-Windows.zip" "WpsExcelAI-Windows" )

# combined share bundle
rm -rf "$DIST/WpsExcelAI-分享包"
mkdir -p "$DIST/WpsExcelAI-分享包"
cp "$DIST/WpsExcelAI-macOS.zip" "$DIST/WpsExcelAI-Windows.zip" "$DIST/WpsExcelAI-分享包/"
cp "$ROOT/install/README-分发说明.txt" "$DIST/WpsExcelAI-分享包/先读我-发给别人哪个文件.txt"
rm -f "$DIST/WpsExcelAI-分享包.zip"
( cd "$DIST" && zip -r -q "WpsExcelAI-分享包.zip" "WpsExcelAI-分享包" )

echo ""
echo "产出："
echo "  $DIST/WpsExcelAI-macOS.zip          ← 只给 Mac 用户"
echo "  $DIST/WpsExcelAI-Windows.zip       ← 只给 Windows 用户"
echo "  $DIST/WpsExcelAI-分享包.zip        ← 两个都给（推荐发给别人这一个）"
ls -lh "$DIST"/*.zip
