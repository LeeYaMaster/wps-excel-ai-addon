/**
 * 任务窗格 UI：轻对话 + 选区状态；写入主路径在 AI 工作区。
 */
(function () {
  "use strict";

  var state = {
    lastContent: "",
    lastGrid: null,
    context: null,
    sending: false,
    messages: [],
    sessionId: null,
    streamingEl: null,
    lastSelKey: "",
    ctxPollTimer: null
  };

  var CHIPS = {
    formula_gen: {
      prompt: "根据当前选区的表头与样例数据，生成可用的 Excel/WPS 公式（给出公式文本与简要说明）。若需写入，请把公式列表整理成一列。",
      local: false
    },
    formula_explain: {
      prompt: "请解释当前选区中的公式含义、引用关系与计算逻辑，用中文分点说明。",
      local: false
    },
    clean: {
      prompt: "请清洗当前选区数据：去首尾空格、统一日期/数字格式、去除明显异常字符，输出清洗后的完整表格（JSON 或 CSV）。",
      local: false
    },
    pivot: {
      prompt: "请对当前选区做分类汇总（类似透视）：识别合适的分组列与数值列，输出汇总表（含表头，JSON 或 CSV）。",
      local: false
    },
    filter_hl: {
      prompt: "请根据条件高亮：",
      local: "filter_hl",
      placeholder: "例如：包含「北京」 或 大于 100"
    },
    table: {
      prompt: "请把当前选区整理成规范二维表（补齐表头、对齐列、去除空行），只输出表格 JSON 或 CSV。",
      local: false
    },
    fill_blank: {
      prompt: "请合理补全当前选区中的空值（可依据同列模式或上下文），输出补全后的完整表格（JSON 或 CSV），并在说明中标注哪些是推断值。",
      local: false
    },
    fake: {
      prompt: "请根据当前选区表头（若无表头请先假设常见列）生成 10 行中文假数据，输出 JSON 或 CSV 表格。",
      local: false
    },
    clear_hl: {
      prompt: "",
      local: "clear_hl"
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showStatus(type, message) {
    var el = $("status");
    if (!el) return;
    el.className = "status show " + (type || "info");
    el.textContent = message || "";
  }

  function clearStatus() {
    var el = $("status");
    if (!el) return;
    el.className = "status";
    el.textContent = "";
  }

  function switchTab(name) {
    $("pageChat").classList.toggle("hidden", name !== "chat");
    $("pageSettings").classList.toggle("hidden", name !== "settings");
    $("pageHistory").classList.toggle("hidden", name !== "history");
    $("tabChat").classList.toggle("active", name === "chat");
    $("tabSettings").classList.toggle("active", name === "settings");
    $("tabHistory").classList.toggle("active", name === "history");
    if (name === "history") renderHistoryList();
    if (name === "chat") refreshContextQuietPoll();
  }

  function ensureSession() {
    if (!state.sessionId) {
      state.sessionId = SessionHistory.newSessionId();
    }
  }

  function persistSession() {
    ensureSession();
    var title = "新会话";
    for (var i = 0; i < state.messages.length; i++) {
      if (state.messages[i].role === "user" && state.messages[i].content) {
        title = String(state.messages[i].content).slice(0, 36);
        break;
      }
    }
    SessionHistory.upsertSession({
      id: state.sessionId,
      title: title,
      messages: state.messages.slice(),
      createdAt: state._createdAt || Date.now(),
      updatedAt: Date.now()
    });
    if (!state._createdAt) state._createdAt = Date.now();
  }

  function appendBubble(role, text, opts) {
    opts = opts || {};
    var box = $("chatHistory");
    var div = document.createElement("div");
    div.className = "bubble " + role;
    var meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = role === "user" ? "我" : "AI";
    var body = document.createElement("div");
    body.className = "bubble-body";
    body.textContent = text;
    div.appendChild(meta);
    div.appendChild(body);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    if (opts.streaming) {
      state.streamingEl = body;
    }
    return body;
  }

  function updateStreamingBubble(fullText) {
    if (state.streamingEl) {
      state.streamingEl.textContent = fullText;
      var box = $("chatHistory");
      box.scrollTop = box.scrollHeight;
    }
  }

  /** 仅更新内存预览状态（侧栏不再展示大预览面板） */
  function rememberReply(content) {
    state.lastContent = content || "";
    state.lastGrid = null;
    if (!content) return;
    try {
      state.lastGrid = ExcelBridge.extractGridFromResponse(content);
    } catch (e) {
      state.lastGrid = null;
    }
  }

  function formatSelStatus(ctx) {
    if (!ctx) return "选区：未读取";
    var addr = ctx.selectionAddress || "-";
    var dim = "";
    if (ctx.rowCount && ctx.colCount) {
      dim = " · " + ctx.rowCount + "×" + ctx.colCount;
    }
    var sheet = ctx.sheetName ? (" @" + ctx.sheetName) : "";
    return "已带上 " + addr + dim + sheet;
  }

  function selKey(ctx) {
    if (!ctx) return "";
    return (ctx.sheetName || "") + "|" + (ctx.selectionAddress || "") + "|" +
      (ctx.rowCount || 0) + "x" + (ctx.colCount || 0);
  }

  function setCtxStatus(text, ok) {
    var el = $("ctxStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("sel-status-err", ok === false);
  }

  function refreshContext(opts) {
    opts = opts || {};
    try {
      if (typeof ExcelBridge === "undefined") {
        throw new Error("Excel 模块未加载。");
      }
      var ctx = ExcelBridge.getSelectionContext();
      state.context = ctx;
      var key = selKey(ctx);
      var changed = key !== state.lastSelKey;
      state.lastSelKey = key;
      setCtxStatus(formatSelStatus(ctx), true);
      if (opts.notify && changed) {
        showStatus("success", "已更新选区上下文。");
      }
      return ctx;
    } catch (e) {
      state.context = null;
      state.lastSelKey = "";
      setCtxStatus("选区：读取失败", false);
      if (opts.notify) showStatus("error", e.message || String(e));
      return null;
    }
  }

  function refreshContextQuietPoll() {
    refreshContext({ notify: false });
  }

  function startCtxPolling() {
    if (state.ctxPollTimer) return;
    state.ctxPollTimer = setInterval(function () {
      if ($("pageChat") && !$("pageChat").classList.contains("hidden") && !state.sending) {
        try {
          if (typeof ExcelBridge === "undefined") return;
          var ctx = ExcelBridge.getSelectionContext();
          var key = selKey(ctx);
          if (key !== state.lastSelKey) {
            state.context = ctx;
            state.lastSelKey = key;
            setCtxStatus(formatSelStatus(ctx), true);
          }
        } catch (e) { /* ignore poll errors */ }
      }
    }, 1500);
  }

  function loadSettingsToForm() {
    var s = AIClient.loadSettings();
    $("apiBaseUrl").value = s.baseUrl;
    $("apiKey").value = s.apiKey;
    $("apiModel").value = s.model;
    $("proxyUrl").value = s.proxyUrl;
    $("useProxy").checked = !!s.useProxy;
    $("historyTurns").value = s.historyTurns || 8;
    $("useStream").checked = s.useStream !== false;
  }

  function saveSettingsFromForm() {
    var result = AIClient.saveSettings({
      baseUrl: $("apiBaseUrl").value,
      apiKey: $("apiKey").value,
      model: $("apiModel").value,
      proxyUrl: $("proxyUrl").value,
      useProxy: $("useProxy").checked,
      historyTurns: $("historyTurns").value,
      useStream: $("useStream").checked
    });
    showStatus("success", "已保存到本机（更新加载项后仍保留）");
    if (result && result.disk && typeof result.disk.then === "function") {
      result.disk.then(function (r) {
        if (!r || !r.ok) {
          showStatus(
            "warn",
            "已保存到浏览器本地；本机磁盘同步失败（" +
              ((r && r.message) || "未知") +
              "）。更新加载项后可能需重填，请确认 :13991 服务已启动。"
          );
        } else {
          showStatus("success", "已保存到本机（更新加载项后仍保留）");
        }
      });
    }
  }

  function resetSettings() {
    $("apiBaseUrl").value = AIClient.DEFAULTS.baseUrl;
    $("apiKey").value = "";
    $("apiModel").value = AIClient.DEFAULTS.model;
    $("proxyUrl").value = AIClient.DEFAULTS.proxyUrl;
    $("useProxy").checked = true;
    $("historyTurns").value = AIClient.DEFAULTS.historyTurns || "8";
    $("useStream").checked = true;
    saveSettingsFromForm();
    showStatus("info", "已恢复默认（API Key 已清空；默认启用本地代理与流式）。");
  }

  function onTestConn() {
    saveSettingsFromForm();
    var box = $("testConnResult");
    box.classList.remove("hidden", "ok", "fail");
    box.textContent = "正在测试连接…";
    showStatus("info", "正在测试连接…");
    AIClient.testConnection().then(function (r) {
      box.textContent = r.message;
      box.classList.add(r.ok ? "ok" : "fail");
      showStatus(r.ok ? "success" : "error", r.ok ? "连接成功。" : "连接失败，见下方说明。");
    });
  }

  function setSending(on) {
    state.sending = on;
    var btn = $("btnSend");
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spinner"></span>请求中…'
      : "发送";
  }

  function openWorkspace() {
    try {
      if (typeof OpenAiWorkspaceFromPane === "function") {
        OpenAiWorkspaceFromPane();
        showStatus("success", "已打开 AI 工作区。");
        return;
      }
      var base = (typeof Util !== "undefined" && Util.GetUrlPath) ? Util.GetUrlPath() : "";
      var url = base + "/dialog.html";
      var opened = false;
      try {
        if (typeof wps !== "undefined" && typeof wps.ShowDialog === "function") {
          wps.ShowDialog(url, "AI 工作区", 1100, 720, false);
          opened = true;
        }
      } catch (e1) {}
      if (!opened) {
        try {
          var app = (typeof wps !== "undefined" && wps.Application) ? wps.Application : (typeof Application !== "undefined" ? Application : null);
          if (app && typeof app.ShowDialog === "function") {
            app.ShowDialog(url, "AI 工作区", 1100, 720, false);
            opened = true;
          }
        } catch (e2) {}
      }
      if (!opened && typeof wps !== "undefined" && wps.CreateTaskPane) {
        var pane = wps.CreateTaskPane(url, "AI 工作区");
        if (pane) {
          try { pane.DockPosition = 2; } catch (e3) {}
          try { pane.Width = 920; } catch (e4) {}
          pane.Visible = true;
          opened = true;
        }
      }
      if (!opened) {
        showStatus("warn", "无法弹出工作区，请用功能区「打开 AI 工作区」。");
      } else {
        showStatus("success", "已打开 AI 工作区。");
      }
    } catch (e) {
      showStatus("error", e.message || String(e));
    }
  }

  function onSend() {
    if (state.sending) return;
    clearStatus();

    var text = ($("userInput").value || "").trim();
    if (!text) {
      showStatus("warn", "请先输入问题。");
      return;
    }

    var settings = AIClient.loadSettings();
    if (!settings.apiKey) {
      showStatus("error", "未配置 API Key，请到「设置」填写。");
      switchTab("settings");
      return;
    }

    // 默认始终附带选区上下文
    var ctxBlock = "";
    try {
      state.context = ExcelBridge.getSelectionContext();
      state.lastSelKey = selKey(state.context);
      setCtxStatus(formatSelStatus(state.context), true);
      ctxBlock = ExcelBridge.contextToPromptBlock(state.context);
    } catch (e) {
      showStatus("warn", "读取选区失败，将仅发送问题：" + (e.message || e));
    }

    ensureSession();
    appendBubble("user", text);
    var historyForApi = state.messages.slice();
    state.messages.push({ role: "user", content: text });

    setSending(true);
    showStatus("info", settings.useStream ? "正在流式请求 AI…" : "正在请求 AI…");
    state.streamingEl = null;
    appendBubble("assistant", settings.useStream ? "" : "…", { streaming: true });

    var accumulated = "";
    var req;
    if (settings.useStream) {
      req = AIClient.chatStream(text, ctxBlock, {
        history: historyForApi,
        onDelta: function (chunk) {
          accumulated += chunk;
          updateStreamingBubble(accumulated);
        }
      });
    } else {
      req = AIClient.chat(text, ctxBlock, { history: historyForApi });
    }

    req
      .then(function (result) {
        var content = result.content || accumulated || "";
        updateStreamingBubble(content);
        state.streamingEl = null;
        state.messages.push({ role: "assistant", content: content });
        persistSession();
        rememberReply(content);
        $("userInput").value = "";
        var tip = "已收到回复。";
        if (state.lastGrid && state.lastGrid.length) {
          tip += " 如需写入，请打开 AI 工作区逐格同意。";
        }
        showStatus("success", tip);
      })
      .catch(function (err) {
        state.streamingEl = null;
        showStatus("error", err.message || String(err));
        appendBubble("assistant", "（请求失败）\n" + (err.message || err));
        persistSession();
      })
      .then(function () {
        setSending(false);
      });
  }

  function onChip(name) {
    var def = CHIPS[name];
    if (!def) return;
    clearStatus();

    if (def.local === "clear_hl") {
      try {
        ExcelBridge.clearSelectionHighlight();
        showStatus("success", "已清除选区填充高亮。");
      } catch (e) {
        showStatus("error", e.message || String(e));
      }
      return;
    }

    if (def.local === "filter_hl") {
      var hint = window.prompt(
        "本地高亮条件（包含「关键字」/ 等于… / 大于 数字 等）。\n取消则改为预填 AI 提示词。",
        "包含 "
      );
      if (hint === null) {
        $("userInput").value = def.prompt;
        $("userInput").focus();
        return;
      }
      if (!String(hint).trim()) {
        showStatus("warn", "条件为空。");
        return;
      }
      try {
        try { refreshContext({ notify: false }); } catch (e0) {}
        var r = ExcelBridge.highlightSelectionByHint(hint);
        showStatus(
          "success",
          "本地高亮完成：匹配 " + r.matched + " / " + r.total +
          " 格（规则 " + r.rule.type + "）。"
        );
      } catch (e) {
        showStatus("error", e.message || String(e));
        $("userInput").value = def.prompt + hint;
      }
      return;
    }

    $("userInput").value = def.prompt;
    $("userInput").focus();
    try { refreshContext({ notify: false }); } catch (e2) {}
    showStatus("info", "已预填提示词，确认后发送。");
  }

  function newChat() {
    if (state.messages.length && !window.confirm("开始新会话？当前对话会保留在「历史」中。")) {
      return;
    }
    if (state.messages.length) persistSession();
    state.sessionId = SessionHistory.newSessionId();
    state._createdAt = Date.now();
    state.messages = [];
    $("chatHistory").innerHTML = "";
    rememberReply("");
    showStatus("info", "已开始新会话。");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderHistoryList() {
    var box = $("historyList");
    var list = SessionHistory.listSessions();
    if (!list.length) {
      box.innerHTML = "<div class=\"hint\">暂无历史会话。</div>";
      return;
    }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var t = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "";
      html +=
        '<div class="history-item" data-id="' + escapeHtml(s.id) + '">' +
        '<div class="history-title">' + escapeHtml(s.title || "会话") + "</div>" +
        '<div class="history-meta">' + escapeHtml(t) + " · " +
        ((s.messages && s.messages.length) || 0) + " 条</div>" +
        '<div class="history-actions">' +
        '<button type="button" class="btn" data-act="load">打开</button>' +
        '<button type="button" class="btn" data-act="md">导出 MD</button>' +
        '<button type="button" class="btn" data-act="json">导出 JSON</button>' +
        '<button type="button" class="btn btn-danger" data-act="del">删除</button>' +
        "</div></div>";
    }
    box.innerHTML = html;
  }

  function onHistoryClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var item = btn.closest(".history-item");
    if (!item) return;
    var id = item.getAttribute("data-id");
    var act = btn.getAttribute("data-act");
    var session = SessionHistory.getSession(id);
    if (!session) {
      showStatus("warn", "会话不存在。");
      renderHistoryList();
      return;
    }
    if (act === "load") {
      state.sessionId = session.id;
      state._createdAt = session.createdAt || Date.now();
      state.messages = (session.messages || []).slice();
      $("chatHistory").innerHTML = "";
      for (var i = 0; i < state.messages.length; i++) {
        appendBubble(state.messages[i].role, state.messages[i].content);
      }
      var lastAsst = "";
      for (var j = state.messages.length - 1; j >= 0; j--) {
        if (state.messages[j].role === "assistant") {
          lastAsst = state.messages[j].content;
          break;
        }
      }
      rememberReply(lastAsst);
      switchTab("chat");
      showStatus("success", "已打开历史会话。写入请用 AI 工作区。");
    } else if (act === "md") {
      try {
        var md = SessionHistory.exportMarkdown(session);
        var r = SessionHistory.downloadText((session.title || "session").slice(0, 20) + ".md", md, "text/markdown");
        showStatus("success", r === "clipboard" ? "已复制 Markdown 到剪贴板。" : "已导出 Markdown。");
      } catch (e1) {
        window.alert(SessionHistory.exportMarkdown(session));
        showStatus("warn", e1.message || String(e1));
      }
    } else if (act === "json") {
      try {
        var js = SessionHistory.exportJson(session);
        var r2 = SessionHistory.downloadText((session.title || "session").slice(0, 20) + ".json", js, "application/json");
        showStatus("success", r2 === "clipboard" ? "已复制 JSON 到剪贴板。" : "已导出 JSON。");
      } catch (e2) {
        window.alert(SessionHistory.exportJson(session));
        showStatus("warn", e2.message || String(e2));
      }
    } else if (act === "del") {
      if (!window.confirm("删除该会话？")) return;
      SessionHistory.deleteSession(id);
      if (state.sessionId === id) {
        state.sessionId = SessionHistory.newSessionId();
        state._createdAt = Date.now();
        state.messages = [];
        $("chatHistory").innerHTML = "";
        rememberReply("");
      }
      renderHistoryList();
      showStatus("info", "已删除。");
    }
  }

  function bind() {
    $("tabChat").addEventListener("click", function () { switchTab("chat"); });
    $("tabSettings").addEventListener("click", function () { switchTab("settings"); });
    $("tabHistory").addEventListener("click", function () { switchTab("history"); });

    if ($("btnOpenWorkspace")) {
      $("btnOpenWorkspace").addEventListener("click", openWorkspace);
    }
    if ($("btnOpenWorkspaceTip")) {
      $("btnOpenWorkspaceTip").addEventListener("click", openWorkspace);
    }
    $("btnSend").addEventListener("click", onSend);
    $("btnNewChat").addEventListener("click", newChat);
    $("userInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSend();
      }
    });

    $("chipRow").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-chip]");
      if (!btn) return;
      onChip(btn.getAttribute("data-chip"));
    });

    $("btnSaveSettings").addEventListener("click", saveSettingsFromForm);
    $("btnResetSettings").addEventListener("click", resetSettings);
    $("btnTestConn").addEventListener("click", onTestConn);
    $("btnRefreshHistory").addEventListener("click", renderHistoryList);
    $("historyList").addEventListener("click", onHistoryClick);

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshContextQuietPoll();
    });
    window.addEventListener("focus", function () {
      refreshContextQuietPoll();
    });
  }

  function init() {
    bind();
    loadSettingsToForm();
    ensureSession();
    state._createdAt = Date.now();

    if (typeof AIClient !== "undefined" && AIClient.hydrateSettingsFromDisk) {
      AIClient.hydrateSettingsFromDisk().then(function (r) {
        if (r && r.hydrated) {
          loadSettingsToForm();
          showStatus("info", "已从本机恢复 API 配置。");
        }
      });
    }

    if (typeof Util !== "undefined" && !Util.isWpsAvailable()) {
      showStatus(
        "warn",
        "当前未检测到 WPS API。写入与选区需在 WPS 表格任务窗格中使用。"
      );
      setCtxStatus("选区：WPS API 不可用", false);
    } else {
      try {
        refreshContext({ notify: false });
      } catch (e) {
        showStatus("warn", e.message || String(e));
      }
      startCtxPolling();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
