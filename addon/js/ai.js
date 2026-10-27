/**
 * OpenAI 兼容 Chat Completions 调用。
 * 支持直连与可选本地代理（解决 CORS）；支持 stream SSE；多轮历史。
 */
(function (global) {
  "use strict";

  var STORAGE_KEYS = {
    baseUrl: "WpsExcelAI.apiBaseUrl",
    apiKey: "WpsExcelAI.apiKey",
    model: "WpsExcelAI.model",
    proxyUrl: "WpsExcelAI.proxyUrl",
    useProxy: "WpsExcelAI.useProxy",
    historyTurns: "WpsExcelAI.historyTurns",
    useStream: "WpsExcelAI.useStream"
  };

  var DEFAULTS = {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    proxyUrl: "http://127.0.0.1:8787",
    useProxy: "1",
    historyTurns: "8",
    useStream: "1"
  };

  var SYSTEM_PROMPT =
    "你是 WPS 表格（Excel）中的 AI 助手。用户使用中文提问。\n" +
    "你会收到当前选区与工作表上下文。\n\n" +
    "规则：\n" +
    "1. 若用户需要生成/整理/计算表格数据，请优先返回可直接写入单元格的结构化数据，" +
    "格式任选其一：\n" +
    "   - JSON 二维数组，例如 [[\"姓名\",\"分数\"],[\"张三\",90]]\n" +
    "   - 或 {\"headers\":[...],\"rows\":[[...],...]}\n" +
    "   - 或 CSV / TSV（可用 markdown 代码块包裹）\n" +
    "2. 若用户只是普通问答、解释公式、给建议，用清晰中文回答即可，不必强行表格化。\n" +
    "3. 不要编造用户选区中不存在的业务事实；不确定时请说明假设。\n" +
    "4. 回复简洁，表格数据不要夹杂多余说明；若需说明，把说明放在表格代码块之外。";

  var SETTINGS_API = "http://127.0.0.1:13991/api/settings";

  function storageGet(key, def) {
    if (typeof Util !== "undefined" && Util.storageGet) {
      return Util.storageGet(key, def);
    }
    try {
      var v = localStorage.getItem(key);
      return v == null ? def : v;
    } catch (e) {
      return def;
    }
  }

  function storageSet(key, val) {
    if (typeof Util !== "undefined" && Util.storageSet) {
      Util.storageSet(key, val);
    } else {
      try { localStorage.setItem(key, String(val)); } catch (e) { /* ignore */ }
    }
  }

  function normalizeSettingsObject(raw) {
    raw = raw || {};
    var turns = parseInt(raw.historyTurns, 10);
    if (isNaN(turns) || turns < 1) turns = 8;
    if (turns > 30) turns = 30;
    var useProxy = raw.useProxy;
    if (typeof useProxy === "string") useProxy = useProxy === "1" || useProxy === "true";
    else useProxy = !!useProxy;
    var useStream = raw.useStream;
    if (typeof useStream === "string") useStream = useStream !== "0" && useStream !== "false";
    else if (useStream == null) useStream = true;
    else useStream = !!useStream;
    return {
      baseUrl: (raw.baseUrl || DEFAULTS.baseUrl || "").trim().replace(/\/+$/, "") || DEFAULTS.baseUrl,
      apiKey: raw.apiKey == null ? "" : String(raw.apiKey),
      model: (raw.model || DEFAULTS.model || "").trim() || DEFAULTS.model,
      proxyUrl: (raw.proxyUrl || DEFAULTS.proxyUrl || "").trim().replace(/\/+$/, "") || DEFAULTS.proxyUrl,
      useProxy: useProxy,
      historyTurns: turns,
      useStream: useStream
    };
  }

  function loadSettings() {
    var turns = parseInt(storageGet(STORAGE_KEYS.historyTurns, DEFAULTS.historyTurns), 10);
    if (isNaN(turns) || turns < 1) turns = 8;
    if (turns > 30) turns = 30;
    return {
      baseUrl: storageGet(STORAGE_KEYS.baseUrl, DEFAULTS.baseUrl) || DEFAULTS.baseUrl,
      apiKey: storageGet(STORAGE_KEYS.apiKey, "") || "",
      model: storageGet(STORAGE_KEYS.model, DEFAULTS.model) || DEFAULTS.model,
      proxyUrl: storageGet(STORAGE_KEYS.proxyUrl, DEFAULTS.proxyUrl) || DEFAULTS.proxyUrl,
      useProxy: storageGet(STORAGE_KEYS.useProxy, DEFAULTS.useProxy) === "1",
      historyTurns: turns,
      useStream: storageGet(STORAGE_KEYS.useStream, DEFAULTS.useStream) === "1"
    };
  }

  /** 仅写 localStorage（不碰磁盘 API） */
  function saveSettingsLocal(settings) {
    var s = normalizeSettingsObject(settings);
    storageSet(STORAGE_KEYS.baseUrl, s.baseUrl);
    storageSet(STORAGE_KEYS.apiKey, s.apiKey || "");
    storageSet(STORAGE_KEYS.model, s.model);
    storageSet(STORAGE_KEYS.proxyUrl, s.proxyUrl);
    storageSet(STORAGE_KEYS.useProxy, s.useProxy ? "1" : "0");
    storageSet(STORAGE_KEYS.historyTurns, String(s.historyTurns));
    storageSet(STORAGE_KEYS.useStream, s.useStream !== false ? "1" : "0");
    return s;
  }

  /**
   * 写 localStorage，并异步 POST 到本机 :13991/api/settings（更新加载项后仍保留）。
   * 磁盘失败不挡本地保存；返回 { local:true, disk: Promise<{ok,message}> }。
   */
  function saveSettings(settings) {
    var s = saveSettingsLocal(settings);
    var diskPromise = fetch(SETTINGS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        model: s.model,
        proxyUrl: s.proxyUrl,
        useProxy: s.useProxy,
        historyTurns: s.historyTurns,
        useStream: s.useStream
      })
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (!res.ok || (data && data.ok === false)) {
            return {
              ok: false,
              message: (data && data.error) ? data.error : ("HTTP " + res.status)
            };
          }
          return { ok: true, message: "已保存到本机（更新加载项后仍保留）" };
        });
      })
      .catch(function (err) {
        return {
          ok: false,
          message: (err && err.message) ? err.message : String(err)
        };
      });
    return { local: true, disk: diskPromise, settings: s };
  }

  /**
   * 若 localStorage 的 apiKey 为空，则 GET /api/settings 回填并写回 localStorage。
   * 页面 load 时 async hydrate，填完后再刷新设置表单。
   * @returns {Promise<{hydrated:boolean, settings:object}>}
   */
  function hydrateSettingsFromDisk() {
    var local = loadSettings();
    if (local.apiKey && String(local.apiKey).trim()) {
      return Promise.resolve({ hydrated: false, settings: local, source: "localStorage" });
    }
    return fetch(SETTINGS_API, { method: "GET" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || typeof data !== "object") {
          return { hydrated: false, settings: local, source: "empty" };
        }
        var diskKey = data.apiKey == null ? "" : String(data.apiKey).trim();
        if (!diskKey) {
          return { hydrated: false, settings: local, source: "disk-empty" };
        }
        var merged = normalizeSettingsObject({
          baseUrl: data.baseUrl != null ? data.baseUrl : local.baseUrl,
          apiKey: data.apiKey,
          model: data.model != null ? data.model : local.model,
          proxyUrl: data.proxyUrl != null ? data.proxyUrl : local.proxyUrl,
          useProxy: data.useProxy != null ? data.useProxy : local.useProxy,
          historyTurns: data.historyTurns != null ? data.historyTurns : local.historyTurns,
          useStream: data.useStream != null ? data.useStream : local.useStream
        });
        saveSettingsLocal(merged);
        return { hydrated: true, settings: merged, source: "disk" };
      })
      .catch(function () {
        return { hydrated: false, settings: local, source: "error" };
      });
  }

  function normalizeBaseUrl(url) {
    var u = (url || "").trim().replace(/\/+$/, "");
    if (!u) u = DEFAULTS.baseUrl;
    return u;
  }

  function buildChatUrl(settings) {
    var base = normalizeBaseUrl(settings.baseUrl);
    var path = "/chat/completions";
    if (/\/chat\/completions\/?$/.test(base)) {
      return base;
    }
    if (!/\/v1$/.test(base) && !/\/v1\//.test(base)) {
      base = base + "/v1";
    }
    return base + path;
  }

  /** 将上游/网络错误翻译为更清晰的中文提示 */
  function translateError(status, text, data, settings, networkErr) {
    if (networkErr) {
      var nm = networkErr.message || String(networkErr);
      if (/Failed to fetch|NetworkError|CORS|Load failed|network/i.test(nm)) {
        if (settings && settings.useProxy) {
          return (
            "无法连接本地代理（" + (settings.proxyUrl || "http://127.0.0.1:8787") + "）。\n" +
            "请确认：1) 代理已启动（Mac：LaunchAgent com.wps.excelai.proxy；Windows：计划任务/启动脚本）；" +
            "2) 设置中代理地址正确；3) 用浏览器打开代理 /health 应返回 ok。\n" +
            "原始错误：" + nm
          );
        }
        return (
          "网络请求失败（可能被 CORS 拦截或无法连接上游）。\n" +
          "建议勾选「使用本地代理」并确保代理 :8787 已启动。\n" +
          "原始错误：" + nm
        );
      }
      return nm;
    }

    var apiMsg = "";
    if (data && data.error) {
      if (typeof data.error === "string") apiMsg = data.error;
      else if (data.error.message) apiMsg = data.error.message;
      else apiMsg = JSON.stringify(data.error).slice(0, 200);
    } else if (data && data.message) {
      apiMsg = data.message;
    }

    if (status === 401 || status === 403) {
      return (
        "鉴权失败（HTTP " + status + "）：API Key 无效、过期或无权访问该模型。\n" +
        "请到「设置」检查密钥是否正确、是否与 Base URL 匹配（例如 DeepSeek 须用 DeepSeek 的 Key）。\n" +
        (apiMsg ? "上游信息：" + apiMsg : "")
      );
    }
    if (status === 404) {
      return (
        "接口地址不存在（HTTP 404）。请检查 Base URL（如 https://api.deepseek.com/v1）与模型名。\n" +
        (apiMsg ? "上游信息：" + apiMsg : "")
      );
    }
    if (status === 429) {
      return (
        "请求过于频繁或额度不足（HTTP 429）。请稍后再试，或检查账户余额/限流。\n" +
        (apiMsg ? "上游信息：" + apiMsg : "")
      );
    }
    if (status === 400) {
      return (
        "请求参数错误（HTTP 400）。请检查模型名称是否正确。\n" +
        (apiMsg ? "上游信息：" + apiMsg : (text || "").slice(0, 300))
      );
    }
    if (status >= 500) {
      return (
        "上游服务异常（HTTP " + status + "）。请稍后重试。\n" +
        (apiMsg ? "上游信息：" + apiMsg : (text || "").slice(0, 300))
      );
    }
    var msg = "请求失败 HTTP " + status;
    if (apiMsg) msg += "：" + apiMsg;
    else if (text) msg += "：" + String(text).slice(0, 300);
    return msg;
  }

  function buildMessages(userMessage, contextBlock, history, options) {
    options = options || {};
    var settings = options.settings || loadSettings();
    var messages = [{ role: "system", content: SYSTEM_PROMPT }];
    var turns = settings.historyTurns || 8;
    var hist = Array.isArray(history) ? history.slice(-turns * 2) : [];
    for (var i = 0; i < hist.length; i++) {
      var h = hist[i];
      if (h && (h.role === "user" || h.role === "assistant") && h.content) {
        messages.push({ role: h.role, content: String(h.content) });
      }
    }
    var userContent =
      (contextBlock ? ("工作表上下文：\n" + contextBlock + "\n\n") : "") +
      "用户问题：\n" + userMessage;
    messages.push({ role: "user", content: userContent });
    return messages;
  }

  function prepareFetch(settings, bodyObj) {
    var targetUrl = buildChatUrl(settings);
    var headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + settings.apiKey.trim()
    };
    var fetchUrl = targetUrl;
    var fetchInit = {
      method: "POST",
      headers: headers,
      body: JSON.stringify(bodyObj)
    };
    if (settings.useProxy) {
      var proxy = (settings.proxyUrl || DEFAULTS.proxyUrl).replace(/\/+$/, "");
      fetchUrl = proxy + "/v1/chat/completions";
      fetchInit.headers = {
        "Content-Type": "application/json",
        "X-Target-Base": normalizeBaseUrl(settings.baseUrl),
        Authorization: "Bearer " + settings.apiKey.trim()
      };
    }
    return { fetchUrl: fetchUrl, fetchInit: fetchInit };
  }

  function ensureConfigured(settings) {
    if (!settings.apiKey || !settings.apiKey.trim()) {
      return Promise.reject(new Error("未配置 API Key。请先在「设置」中填写。"));
    }
    if (!settings.model || !settings.model.trim()) {
      return Promise.reject(new Error("未配置模型名称。请先在「设置」中填写，例如 gpt-4o-mini 或 deepseek-chat。"));
    }
    return null;
  }

  /**
   * 非流式聊天。
   * @param {string} userMessage
   * @param {string} contextBlock
   * @param {object} options  { history, temperature, settings }
   * @returns {Promise<{content:string, raw:object}>}
   */
  function chat(userMessage, contextBlock, options) {
    options = options || {};
    var settings = options.settings || loadSettings();
    var bad = ensureConfigured(settings);
    if (bad) return bad;

    var body = {
      model: settings.model.trim(),
      messages: buildMessages(userMessage, contextBlock, options.history, { settings: settings }),
      temperature: options.temperature != null ? options.temperature : 0.3,
      stream: false
    };
    var prep = prepareFetch(settings, body);

    return fetch(prep.fetchUrl, prep.fetchInit)
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) {
            data = { rawText: text };
          }
          if (!res.ok) {
            throw new Error(translateError(res.status, text, data, settings, null));
          }
          var content = "";
          try {
            content = data.choices[0].message.content || "";
          } catch (e2) {
            throw new Error("响应格式异常，未找到 choices[0].message.content。原始：" + text.slice(0, 400));
          }
          return { content: content, raw: data };
        });
      })
      .catch(function (err) {
        if (err && err.message && !/鉴权|未配置|HTTP |代理|网络请求|接口地址|请求过于|请求参数|上游服务|响应格式/.test(err.message)) {
          if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(err.message)) {
            throw new Error(translateError(0, "", null, settings, err));
          }
        }
        throw err;
      });
  }

  /**
   * 解析 SSE 文本块，提取 delta content。
   * 见到 data:[DONE] 或 choices[0].finish_reason 时 ended=true（调用方应结束 pump）。
   * @returns {{ rest: string, ended: boolean }}
   */
  function parseSseChunk(buffer, onDelta) {
    var parts = buffer.split("\n");
    var rest = parts.pop();
    var ended = false;
    for (var i = 0; i < parts.length; i++) {
      var line = parts[i].replace(/\r$/, "");
      if (!line || line.charAt(0) === ":") continue;
      if (line.indexOf("data:") === 0) {
        var payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          ended = true;
          continue;
        }
        try {
          var obj = JSON.parse(payload);
          var delta = "";
          if (obj.choices && obj.choices[0]) {
            var ch0 = obj.choices[0];
            if (ch0.delta && ch0.delta.content) {
              delta = ch0.delta.content;
            } else if (ch0.message && ch0.message.content) {
              delta = ch0.message.content;
            }
            // stop / length / content_filter 等均视为流结束信号
            if (ch0.finish_reason) {
              ended = true;
            }
          }
          if (delta) onDelta(delta);
        } catch (e) { /* ignore partial */ }
      }
    }
    return { rest: rest || "", ended: ended };
  }

  /**
   * 流式聊天。onDelta(textChunk) 边生成边回调。
   * WebView 若不支持 ReadableStream，自动回退到非流式。
   * @returns {Promise<{content:string, raw:object|null, streamed:boolean}>}
   */
  function chatStream(userMessage, contextBlock, options) {
    options = options || {};
    var settings = options.settings || loadSettings();
    var bad = ensureConfigured(settings);
    if (bad) return bad;

    var onDelta = typeof options.onDelta === "function" ? options.onDelta : function () {};
    var body = {
      model: settings.model.trim(),
      messages: buildMessages(userMessage, contextBlock, options.history, { settings: settings }),
      temperature: options.temperature != null ? options.temperature : 0.3,
      stream: true
    };
    var prep = prepareFetch(settings, body);

    return fetch(prep.fetchUrl, prep.fetchInit)
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
            throw new Error(translateError(res.status, text, data, settings, null));
          });
        }

        // 无 body 流：回退
        if (!res.body || typeof res.body.getReader !== "function") {
          return chat(userMessage, contextBlock, {
            history: options.history,
            temperature: options.temperature,
            settings: settings
          }).then(function (r) {
            if (r.content) onDelta(r.content);
            return { content: r.content, raw: r.raw, streamed: false };
          });
        }

        var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";

        function finishNonSse(text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { /* ignore */ }
          if (data && data.choices && data.choices[0] && data.choices[0].message) {
            var c = data.choices[0].message.content || "";
            if (c) onDelta(c);
            return { content: c, raw: data, streamed: false };
          }
          if (text) onDelta(text);
          return { content: text, raw: data, streamed: false };
        }

        // 如果 content-type 明确是 json，读完再解析（勿先 lock reader）
        if (ct.indexOf("application/json") >= 0 && ct.indexOf("event-stream") < 0) {
          return res.text().then(function (text) {
            return finishNonSse(text);
          });
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder("utf-8");
        var buf = "";
        var full = "";
        // WPS WebView / 本地代理可能在 [DONE] 后不关连接；须主动结束，并加空闲安全网。
        var IDLE_END_MS = 2500;

        return new Promise(function (resolve, reject) {
          var settled = false;
          var idleTimer = null;

          function clearIdle() {
            if (idleTimer) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
          }

          function safeCancelReader() {
            try {
              if (reader && typeof reader.cancel === "function") {
                var p = reader.cancel();
                if (p && typeof p.catch === "function") p.catch(function () {});
              }
            } catch (eCancel) { /* ignore */ }
          }

          function settleOk(payload) {
            if (settled) return;
            settled = true;
            clearIdle();
            safeCancelReader();
            resolve(payload);
          }

          function settleErr(err) {
            if (settled) return;
            settled = true;
            clearIdle();
            safeCancelReader();
            reject(err);
          }

          function armIdle() {
            clearIdle();
            // 已有正文且一段时间无新 chunk → 视为流结束（防 WebView 挂死）
            if (!full) return;
            idleTimer = setTimeout(function () {
              settleOk({ content: full, raw: null, streamed: true });
            }, IDLE_END_MS);
          }

          function onDeltaAccum(d) {
            full += d;
            onDelta(d);
          }

          function pump() {
            return reader.read().then(function (result) {
              if (settled) return;
              if (result.done) {
                if (buf.trim()) {
                  if (buf.trim().charAt(0) === "{" && buf.indexOf("data:") < 0) {
                    var nonSse = finishNonSse(buf);
                    full = nonSse.content || full;
                    settleOk(nonSse);
                    return;
                  }
                  parseSseChunk(buf + "\n", onDeltaAccum);
                }
                settleOk({ content: full, raw: null, streamed: true });
                return;
              }
              var chunk = decoder.decode(result.value, { stream: true });
              buf += chunk;
              if (full === "" && buf.indexOf("data:") < 0 && buf.trim().charAt(0) === "{") {
                // keep buffering possible non-SSE JSON
                armIdle();
              } else {
                var parsed = parseSseChunk(buf, onDeltaAccum);
                buf = parsed.rest;
                if (parsed.ended) {
                  settleOk({ content: full, raw: null, streamed: true });
                  return;
                }
                armIdle();
              }
              return pump();
            }).catch(function (err) {
              // 主动 cancel 后 read 可能 reject；已 settle 则忽略
              if (settled) return;
              settleErr(err);
            });
          }

          pump();
        });
      })
      .catch(function (err) {
        if (err && err.message && /Failed to fetch|NetworkError|CORS|Load failed/i.test(err.message)) {
          throw new Error(translateError(0, "", null, settings, err));
        }
        throw err;
      });
  }

  /**
   * 设置页「测试连接」：发一条极短 chat completions。
   * @returns {Promise<{ok:boolean, message:string}>}
   */
  function testConnection() {
    var settings = loadSettings();
    if (!settings.apiKey || !settings.apiKey.trim()) {
      return Promise.resolve({ ok: false, message: "失败：未填写 API Key。" });
    }
    if (!settings.model || !settings.model.trim()) {
      return Promise.resolve({ ok: false, message: "失败：未填写模型名称。" });
    }

    // 先探活代理
    var proxyCheck = Promise.resolve(null);
    if (settings.useProxy) {
      var proxy = (settings.proxyUrl || DEFAULTS.proxyUrl).replace(/\/+$/, "");
      proxyCheck = fetch(proxy + "/health", { method: "GET" })
        .then(function (r) {
          if (!r.ok) throw new Error("代理 /health 返回 HTTP " + r.status);
          return true;
        })
        .catch(function (e) {
          throw new Error(
            "失败：本地代理未开启或无法访问（" + proxy + "）。\n" +
            "请先启动代理（Mac LaunchAgent / Windows 安装脚本），再重试。\n" +
            "细节：" + (e.message || e)
          );
        });
    }

    return proxyCheck
      .then(function () {
        var body = {
          model: settings.model.trim(),
          messages: [
            { role: "user", content: "请只回复：pong" }
          ],
          max_tokens: 16,
          temperature: 0,
          stream: false
        };
        var prep = prepareFetch(settings, body);
        return fetch(prep.fetchUrl, prep.fetchInit).then(function (res) {
          return res.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
            if (!res.ok) {
              return {
                ok: false,
                message: "失败：" + translateError(res.status, text, data, settings, null)
              };
            }
            var content = "";
            try {
              content = (data.choices[0].message.content || "").trim();
            } catch (e2) {
              return { ok: false, message: "失败：响应格式异常。" + text.slice(0, 200) };
            }
            return {
              ok: true,
              message:
                "成功：已连通" +
                (settings.useProxy ? "（经本地代理）" : "（直连）") +
                "，模型「" + settings.model.trim() + "」有响应。\n回复摘要：" +
                (content.slice(0, 80) || "(空)")
            };
          });
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg) && msg.indexOf("失败：") !== 0) {
          msg = translateError(0, "", null, settings, err);
        }
        if (msg.indexOf("失败：") !== 0) msg = "失败：" + msg;
        return { ok: false, message: msg };
      });
  }

  global.AIClient = {
    STORAGE_KEYS: STORAGE_KEYS,
    DEFAULTS: DEFAULTS,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    SETTINGS_API: SETTINGS_API,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    saveSettingsLocal: saveSettingsLocal,
    hydrateSettingsFromDisk: hydrateSettingsFromDisk,
    chat: chat,
    chatStream: chatStream,
    testConnection: testConnection,
    buildChatUrl: buildChatUrl,
    translateError: translateError
  };
})(window);
