#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WpsExcelAI local static + settings API server (port 13991).
Serves addon files and persists API settings to Application Support / APPDATA.

Usage:
  WPS_EXCELAI_SERVE_DIR=/path/to/addon python3 addon-server.py
  python3 addon-server.py /path/to/addon
  python3 addon-server.py   # cwd or default jsaddons path

Settings file:
  macOS: ~/Library/Application Support/WpsExcelAI/settings.json
  Windows: %APPDATA%\\WpsExcelAI\\settings.json
"""
from __future__ import annotations

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("WPS_EXCELAI_PORT", "13991"))

SETTINGS_KEYS = (
    "baseUrl",
    "apiKey",
    "model",
    "proxyUrl",
    "useProxy",
    "historyTurns",
    "useStream",
)


def settings_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "WpsExcelAI"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(appdata) / "WpsExcelAI"
    # Linux / other: XDG or ~/.local/share
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / "WpsExcelAI"
    return Path.home() / ".local" / "share" / "WpsExcelAI"


def settings_path() -> Path:
    return settings_dir() / "settings.json"


def resolve_serve_dir() -> Path:
    env = os.environ.get("WPS_EXCELAI_SERVE_DIR", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        return Path(sys.argv[1]).expanduser().resolve()
    # default: global WPS jsaddons (macOS)
    default = (
        Path.home()
        / "Library"
        / "Containers"
        / "com.kingsoft.wpsoffice.mac.global"
        / "Data"
        / ".kingsoft"
        / "wps"
        / "jsaddons"
        / "WpsExcelAI_1.0.0"
    )
    if default.is_dir():
        return default.resolve()
    return Path.cwd().resolve()


def read_settings() -> Dict[str, Any]:
    path = settings_path()
    if not path.is_file():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def write_settings(body: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in SETTINGS_KEYS:
        if key in body:
            out[key] = body[key]
    # merge with existing so partial POSTs don't wipe other keys
    merged = read_settings()
    merged.update(out)
    # only keep known keys
    cleaned = {k: merged[k] for k in SETTINGS_KEYS if k in merged}
    d = settings_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = settings_path()
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)
    return cleaned


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def _json(self, code: int, obj: Any) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/settings" or path == "/api/settings/":
            self._json(200, read_settings())
            return
        if path == "/api/health" or path == "/api/health/":
            self._json(
                200,
                {
                    "ok": True,
                    "serveDir": str(Path.cwd()),
                    "settingsPath": str(settings_path()),
                },
            )
            return
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/api/settings" and path != "/api/settings/":
            self.send_error(404, "Not Found")
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(body, dict):
                raise ValueError("body must be a JSON object")
        except Exception as e:
            self._json(400, {"ok": False, "error": "invalid JSON: " + str(e)})
            return
        try:
            saved = write_settings(body)
            self._json(200, {"ok": True, "settings": saved})
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)})

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    serve = resolve_serve_dir()
    if not serve.is_dir():
        sys.stderr.write("ERROR: serve dir missing: %s\n" % serve)
        sys.exit(1)
    os.chdir(str(serve))
    # ensure settings dir exists (do not create empty settings.json)
    settings_dir().mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        "WpsExcelAI addon server http://%s:%s/  serve=%s  settings=%s"
        % (HOST, PORT, serve, settings_path()),
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)


if __name__ == "__main__":
    main()
