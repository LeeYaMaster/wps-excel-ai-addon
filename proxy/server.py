#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简易本地 CORS 代理（无第三方依赖，Python 3.7+）。
支持非流式与 SSE/chunk 流式转发 OpenAI 兼容 Chat Completions。

用法：
  python3 server.py
默认监听 http://127.0.0.1:8787
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8787


def normalize_base(base: str) -> str:
    u = (base or "").strip().rstrip("/")
    if not u:
        u = "https://api.openai.com/v1"
    if not u.endswith("/v1") and "/v1/" not in u:
        u = u + "/v1"
    return u


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "*")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            body = b'{"ok":true,"stream":true}'
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        body = (
            b"WpsExcelAI local proxy OK\n"
            b"POST /v1/chat/completions with Authorization + X-Target-Base\n"
            b"Supports stream:true (SSE / chunked)\n"
        )
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if self.path.split("?")[0] != "/v1/chat/completions":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        want_stream = False
        try:
            parsed = json.loads(raw.decode("utf-8") or "{}")
            want_stream = bool(parsed.get("stream"))
        except Exception:
            want_stream = False

        base = normalize_base(self.headers.get("X-Target-Base", ""))
        target = base.rstrip("/") + "/chat/completions"
        auth = self.headers.get("Authorization", "")

        req = urllib.request.Request(
            target,
            data=raw,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "text/event-stream" if want_stream else "application/json",
                **({"Authorization": auth} if auth else {}),
            },
        )
        try:
            resp = urllib.request.urlopen(req, timeout=180)
            ct = resp.headers.get("Content-Type", "application/json")
            is_stream = want_stream or "text/event-stream" in (ct or "")

            if is_stream:
                self.send_response(resp.status)
                self._cors()
                self.send_header("Content-Type", ct or "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                # Chunked streaming: omit Content-Length
                self.end_headers()
                try:
                    while True:
                        chunk = resp.read(1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                finally:
                    try:
                        resp.close()
                    except Exception:
                        pass
                return

            data = resp.read()
            self.send_response(resp.status)
            self._cors()
            self.send_header("Content-Type", ct or "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            try:
                resp.close()
            except Exception:
                pass
        except urllib.error.HTTPError as e:
            data = e.read() or json.dumps({"error": {"message": str(e)}}).encode()
            self.send_response(e.code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            data = json.dumps({"error": {"message": "Proxy error: " + str(e)}}).encode()
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        print("[proxy]", self.address_string(), fmt % args)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"WpsExcelAI proxy listening on http://{HOST}:{PORT} (SSE supported)")
    httpd.serve_forever()
