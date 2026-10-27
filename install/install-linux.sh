#!/usr/bin/env bash
# 将加载项安装到当前用户 WPS jsaddons 目录（Linux）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADDON_SRC="$ROOT/addon"
PUBLISH_SRC="$ROOT/install/publish.xml"
DEST_ROOT="${HOME}/.local/share/Kingsoft/wps/jsaddons"
DEST_ADDON="${DEST_ROOT}/WpsExcelAI_1.0.0"

mkdir -p "$DEST_ROOT"
rm -rf "$DEST_ADDON"
cp -a "$ADDON_SRC" "$DEST_ADDON"
echo "已复制加载项 -> $DEST_ADDON"

PUBLISH_DEST="${DEST_ROOT}/publish.xml"
PLUGIN_LINE='<jsplugin name="WpsExcelAI" type="et" version="1.0.0" url="file://" enable="enable_dev" />'

if [[ ! -f "$PUBLISH_DEST" ]]; then
  cp "$PUBLISH_SRC" "$PUBLISH_DEST"
  echo "已写入 publish.xml"
elif ! grep -q 'name="WpsExcelAI"' "$PUBLISH_DEST"; then
  if grep -q '</jsplugins>' "$PUBLISH_DEST"; then
    sed -i "s#</jsplugins>#  ${PLUGIN_LINE}\n</jsplugins>#" "$PUBLISH_DEST"
    echo "已向现有 publish.xml 追加 WpsExcelAI"
  else
    echo "警告: publish.xml 格式异常，请手动合并。参考: $PUBLISH_SRC"
  fi
else
  echo "publish.xml 中已存在 WpsExcelAI 条目"
fi

echo
echo "安装完成。请完全退出并重启 WPS 表格，然后打开「AI 助手」选项卡。"
