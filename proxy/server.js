/**
 * 简易本地代理：转发 OpenAI 兼容 Chat Completions，解决 WPS 内嵌浏览器 CORS。
 * 支持 stream:true SSE/chunk 透传。
 *
 * 用法：
 *   cd proxy && npm install && npm start
 */
"use strict";

const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "4mb" }));

app.get("/", function (_req, res) {
  res.type("text").send(
    "WpsExcelAI local proxy OK\n" +
      "POST /v1/chat/completions with Authorization + X-Target-Base\n" +
      "Supports stream:true (SSE / chunked)\n"
  );
});

app.get("/health", function (_req, res) {
  res.json({ ok: true, stream: true });
});

function normalizeBase(base) {
  let u = String(base || "").trim().replace(/\/+$/, "");
  if (!u) u = "https://api.openai.com/v1";
  if (!/\/v1$/i.test(u) && !/\/v1\//i.test(u)) {
    u = u + "/v1";
  }
  return u;
}

function forward(req, res, targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    res.status(400).json({ error: { message: "Invalid target URL: " + targetUrl } });
    return;
  }

  const lib = parsed.protocol === "http:" ? http : https;
  const wantStream = !!(req.body && req.body.stream);
  const body = JSON.stringify(req.body || {});
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    Accept: wantStream ? "text/event-stream" : "application/json"
  };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  const upstream = lib.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: headers,
      timeout: 180000
    },
    function (upRes) {
      const ct = upRes.headers["content-type"] || "application/json";
      const isStream = wantStream || String(ct).indexOf("text/event-stream") >= 0;
      res.status(upRes.statusCode || 502);
      res.setHeader("Content-Type", ct);
      if (isStream) {
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        upRes.pipe(res);
        return;
      }
      const chunks = [];
      upRes.on("data", function (c) { chunks.push(c); });
      upRes.on("end", function () {
        res.send(Buffer.concat(chunks));
      });
    }
  );

  upstream.on("timeout", function () {
    upstream.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: { message: "Upstream timeout" } });
    }
  });

  upstream.on("error", function (err) {
    if (!res.headersSent) {
      res.status(502).json({
        error: { message: "Proxy upstream error: " + (err.message || err) }
      });
    }
  });

  upstream.write(body);
  upstream.end();
}

app.post("/v1/chat/completions", function (req, res) {
  const base = normalizeBase(req.headers["x-target-base"] || process.env.TARGET_BASE);
  const target = base.replace(/\/+$/, "") + "/chat/completions";
  console.log("[proxy]", new Date().toISOString(), "->", target, req.body && req.body.stream ? "(stream)" : "");
  forward(req, res, target);
});

app.post("/proxy", function (req, res) {
  const target = req.query.target;
  if (!target) {
    res.status(400).json({ error: { message: "Missing ?target=" } });
    return;
  }
  forward(req, res, String(target));
});

app.listen(PORT, "127.0.0.1", function () {
  console.log("WpsExcelAI proxy listening on http://127.0.0.1:" + PORT + " (SSE supported)");
});
