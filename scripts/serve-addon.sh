#!/bin/bash
# WpsExcelAI local HTTP server for jspluginonline (port 13991).
# Serves static addon files + GET/POST /api/settings (persists to Application Support).
# LaunchAgent copies scripts/addon-server.py → ~/Library/Application Support/WpsExcelAI/
# (macOS TCC blocks LaunchAgent from executing scripts under ~/Desktop).
set -euo pipefail
DEST_NAME="WpsExcelAI_1.0.0"
PORT=13991
SERVE_DIR="${WPS_EXCELAI_SERVE_DIR:-$HOME/Library/Containers/com.kingsoft.wpsoffice.mac.global/Data/.kingsoft/wps/jsaddons/$DEST_NAME}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PY="${WPS_EXCELAI_SERVER_PY:-}"
if [ -z "$SERVER_PY" ]; then
  SUPPORT_PY="$HOME/Library/Application Support/WpsExcelAI/addon-server.py"
  if [ -f "$SUPPORT_PY" ]; then
    SERVER_PY="$SUPPORT_PY"
  else
    SERVER_PY="$ROOT/scripts/addon-server.py"
  fi
fi

if [ ! -d "$SERVE_DIR" ]; then
  echo "ERROR: serve dir missing: $SERVE_DIR" >&2
  exit 1
fi
if [ ! -f "$SERVE_DIR/ribbon.xml" ]; then
  echo "ERROR: ribbon.xml missing in $SERVE_DIR" >&2
  exit 1
fi
if [ ! -f "$SERVER_PY" ]; then
  echo "ERROR: addon-server.py missing: $SERVER_PY" >&2
  exit 1
fi

PYTHON="${WPS_EXCELAI_PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if [ -x /usr/bin/python3 ]; then
    PYTHON=/usr/bin/python3
  else
    PYTHON="$(command -v python3)"
  fi
fi
if [ -z "$PYTHON" ] || [ ! -x "$PYTHON" ]; then
  echo "ERROR: python3 not found" >&2
  exit 1
fi

export WPS_EXCELAI_SERVE_DIR="$SERVE_DIR"
export WPS_EXCELAI_PORT="$PORT"
exec "$PYTHON" "$SERVER_PY" "$SERVE_DIR"
