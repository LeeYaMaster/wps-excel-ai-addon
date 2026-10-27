#!/bin/bash
# Manual foreground server (prefer LaunchAgent via install-launchagent.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=13991
# Free port if something else holds it (not for use under launchd)
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT in use; stopping listeners…" >&2
  lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 0.3
fi
exec bash "$ROOT/scripts/serve-addon.sh"
