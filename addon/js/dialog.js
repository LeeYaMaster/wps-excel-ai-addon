/**
 * AI 工作区（对话框）：对话 + 逐格同意/拒绝。
 */
(function () {
  "use strict";

  var state = {
    lastContent: "",
    lastGrid: null,
    lastDiff: null,
    context: null,
    sending: false,
    messages: [],
    sessionId: null,
    streamingEl: null,
    hideSame: true,
    rows: [] // { address, from, to, kind, checked }
  };

  var CHIPS = {
    formula_gen: { prompt: "根据当前选区的表头与样例数据，生成可用的 Excel/WPS 公式（给出公式文本与简要说明）。若需写入，请把公式列表整理成一列。" },
    clean: { prompt: "请清洗当前选区数据：去首尾空格、统一日期/数字格式、去除明显异常字符，输出清洗后的完整表格（JSON 或 CSV）。" },
    pivot: { prompt: "请对当前选区做分类汇总（类似透视）：识别合适的分组列与数值列，输出汇总表（含表头，JSON 或 CSV）。" },
    table: { prompt: "请把当前选区整理成规范二维表（补齐表头、对齐列、去除空行），只输出表格 JSON 或 CSV。" },
    fill_blank: { prompt: "请合理补全当前选区中的空值（可依据同列模式或上下文），输出补全后的完整表格（JSON 或 CSV），并在说明中标注哪些是推断值。" },
    fake: { prompt: "请根据当前选区表头（若无表头请先假设常见列）生成 10 行中文假数据，输出 JSON 或 CSV 表格。" }
  };

  function $(id) { return document.getElementById(id); }

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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureSession() {
    if (!state.sessionId && typeof SessionHistory !== "undefined") {
      state.sessionId = SessionHistory.newSessionId();
      state._createdAt = Date.now();
    }
  }

  function persistSession() {
    if (typeof SessionHistory === "undefined") return;
    ensureSession();
    var title = "工作区会话";
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
    if (opts.streaming) state.streamingEl = body;
    return body;
  }

  function updateStreamingBubble(fullText) {
    if (state.streamingEl) {
      state.streamingEl.textContent = fullText;
      $("chatHistory").scrollTop = $("chatHistory").scrollHeight;
    }
  }

  function refreshContext() {
    clearStatus();
    try {
      var ctx = ExcelBridge.getSelectionContext();
      state.context = ctx;
      $("ctxMeta").textContent = (ctx.sheetName || "表") + " · " + (ctx.selectionAddress || "-");
      $("ctxBrief").textContent =
        (ctx.rowCount || "?") + "×" + (ctx.colCount || "?") +
        (ctx.workbookName ? (" · " + ctx.workbookName) : "");
      showStatus("success", "已刷新选区上下文。");
    } catch (e) {
      state.context = null;
      $("ctxMeta").textContent = "读取失败";
      $("ctxBrief").textContent = e.message || String(e);
      showStatus("error", e.message || String(e));
    }
  }

  function writeMode() {
    return ($("writeMode").value || "selected");
  }

  function rebuildDiffFromGrid() {
    if (!state.lastGrid || !state.lastGrid.length) {
      state.lastDiff = null;
      state.rows = [];
      renderDiffRows();
      $("diffSummary").textContent = "尚无解析表格。";
      return;
    }
    try {
      var diff = ExcelBridge.diffAgainstTarget(writeMode(), state.lastGrid, {
        maxDetail: 5000,
        includeSame: true,
        truncate: 0
      });
      state.lastDiff = diff;
      state.rows = (diff.details || []).map(function (d) {
        var kind = d.kind || "修改";
        return {
          address: String(d.address || "").replace(/\$/g, ""),
          from: d.from == null ? "" : String(d.from),
          to: d.to == null ? "" : String(d.to),
          kind: kind,
          checked: kind === "修改" || kind === "新增"
        };
      });
      $("diffSummary").textContent = diff.summary || "";
      renderDiffRows();
    } catch (e) {
      showStatus("warn", "diff 失败：" + (e.message || e));
      $("diffSummary").textContent = "diff 失败：" + (e.message || e);
    }
  }

  function renderDiffRows() {
    var body = $("diffBody");
    body.innerHTML = "";
    if (!state.rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="6">尚无变更。发送问题后，解析出的表格会与当前表对比并列在此处。</td></tr>';
      updateSelCount();
      return;
    }
    var visible = 0;
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      var hide = state.hideSame && row.kind === "不变";
      var tr = document.createElement("tr");
      tr.className = "row-" + row.kind + (hide ? " row-hidden" : "");
      tr.setAttribute("data-idx", String(i));
      if (!hide) visible++;

      var tdCheck = document.createElement("td");
      tdCheck.className = "col-check";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!row.checked;
      cb.disabled = hide;
      cb.setAttribute("data-idx", String(i));
      tdCheck.appendChild(cb);

      var tdAddr = document.createElement("td");
      tdAddr.className = "col-addr";
      tdAddr.textContent = row.address;

      var tdKind = document.createElement("td");
      tdKind.className = "col-kind kind-" + row.kind;
      tdKind.textContent = row.kind;

      var tdFrom = document.createElement("td");
      tdFrom.className = "col-from";
      var spanFrom = document.createElement("span");
      spanFrom.className = "val-from";
      spanFrom.textContent = row.from === "" ? "(空)" : row.from;
      tdFrom.appendChild(spanFrom);

      var tdArrow = document.createElement("td");
      tdArrow.className = "col-arrow";
      tdArrow.textContent = "→";

      var tdTo = document.createElement("td");
      tdTo.className = "col-to";
      var spanTo = document.createElement("span");
      spanTo.className = "val-to";
      spanTo.textContent = row.to === "" ? "(空)" : row.to;
      tdTo.appendChild(spanTo);

      tr.appendChild(tdCheck);
      tr.appendChild(tdAddr);
      tr.appendChild(tdKind);
      tr.appendChild(tdFrom);
      tr.appendChild(tdArrow);
      tr.appendChild(tdTo);
      body.appendChild(tr);
    }
    if (visible === 0) {
      body.innerHTML = '<tr class="empty-row"><td colspan="6">没有可显示的变更（可能全部为「不变」，可点「隐藏不变」切换）。</td></tr>';
    }
    updateSelCount();
  }

  function updateSelCount() {
    var n = 0;
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].checked) n++;
    }
    $("selCount").textContent = "已选 " + n + " / " + state.rows.length + " 格";
  }

  function afterPreview(content) {
    state.lastContent = content || "";
    state.lastGrid = null;
    try {
      var grid = ExcelBridge.extractGridFromResponse(content);
      state.lastGrid = grid;
      if (grid && grid.length) {
        rebuildDiffFromGrid();
        showStatus("success", "已解析表格并生成逐格 diff，请勾选后点「应用已选」。");
      } else {
        state.rows = [];
        state.lastDiff = null;
        renderDiffRows();
        $("diffSummary").textContent =
          "未解析到单元格变更（可能是说明/条件格式指引，右侧无需勾选）。" +
          "说明类回复请按对话区操作；条件格式填充色暂不自动写入。若需改数值请让 AI 返回 CSV/JSON 表格。";
        showStatus("warn", "未解析到单元格数值变更（说明类回复，右侧无需勾选）。");
      }
    } catch (e) {
      showStatus("error", e.message || String(e));
    }
  }

  function setSending(on) {
    state.sending = on;
    var btn = $("btnSend");
    btn.disabled = on;
    btn.innerHTML = on ? '<span class="spinner"></span>请求中…' : "发送";
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
      showStatus("error", "未配置 API Key，请点右上角「设置」。");
      openSettings(true);
      return;
    }

    var includeCtx = $("chkIncludeCtx").checked;
    var ctxBlock = "";
    if (includeCtx) {
      try {
        state.context = ExcelBridge.getSelectionContext();
        $("ctxMeta").textContent = (state.context.sheetName || "表") + " · " + (state.context.selectionAddress || "-");
        ctxBlock = ExcelBridge.contextToPromptBlock(state.context);
      } catch (e) {
        showStatus("warn", "读取选区失败，将仅发送问题：" + (e.message || e));
      }
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
    var req = settings.useStream
      ? AIClient.chatStream(text, ctxBlock, {
          history: historyForApi,
          onDelta: function (chunk) {
            accumulated += chunk;
            updateStreamingBubble(accumulated);
          }
        })
      : AIClient.chat(text, ctxBlock, { history: historyForApi });

    req
      .then(function (result) {
        var content = result.content || accumulated || "";
        updateStreamingBubble(content);
        state.streamingEl = null;
        state.messages.push({ role: "assistant", content: content });
        persistSession();
        $("userInput").value = "";
        try {
          afterPreview(content);
        } catch (previewErr) {
          showStatus("error", "预览处理失败：" + (previewErr.message || previewErr));
        }
      })
      .catch(function (err) {
        state.streamingEl = null;
        showStatus("error", err.message || String(err));
        appendBubble("assistant", "（请求失败）\n" + (err.message || err));
        persistSession();
      })
      .then(function () {
        // 可靠 finally：无论 then/catch/afterPreview 抛错都复位发送态
        setSending(false);
        var el = $("status");
        if (el && /正在流式请求 AI|正在请求 AI/.test(el.textContent || "")) {
          clearStatus();
        }
      });
  }

  function applySelected() {
    clearStatus();
    var changes = [];
    for (var i = 0; i < state.rows.length; i++) {
      var r = state.rows[i];
      if (r.checked) {
        changes.push({ address: r.address, value: r.to });
      }
    }
    if (!changes.length) {
      showStatus("warn", "未勾选任何单元格。");
      return;
    }
    if (!window.confirm(
      "确认将已选 " + changes.length + " 个单元格写入当前工作表？\n" +
      "未勾选的格子不会被改动。可用 WPS 撤销。"
    )) {
      return;
    }
    try {
      var result = ExcelBridge.applySelectedCells(changes);
      showStatus(
        "success",
        "已写入 " + result.written + " 格" +
        (result.failed && result.failed.length ? ("；失败 " + result.failed.length) : "") +
        "。"
      );
      // 重算 diff，勾选应变为「不变」
      rebuildDiffFromGrid();
    } catch (e) {
      showStatus("error", e.message || String(e));
    }
  }

  function setChecks(predicate) {
    for (var i = 0; i < state.rows.length; i++) {
      state.rows[i].checked = !!predicate(state.rows[i]);
    }
    renderDiffRows();
  }

  function openSettings(show) {
    var el = $("settingsOverlay");
    if (show) {
      var s = AIClient.loadSettings();
      $("apiBaseUrl").value = s.baseUrl;
      $("apiKey").value = s.apiKey;
      $("apiModel").value = s.model;
      $("proxyUrl").value = s.proxyUrl;
      $("useProxy").checked = !!s.useProxy;
      $("useStream").checked = s.useStream !== false;
      el.classList.remove("hidden");
      el.setAttribute("aria-hidden", "false");
    } else {
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
    }
  }

  function saveSettings() {
    var result = AIClient.saveSettings({
      baseUrl: $("apiBaseUrl").value,
      apiKey: $("apiKey").value,
      model: $("apiModel").value,
      proxyUrl: $("proxyUrl").value,
      useProxy: $("useProxy").checked,
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
              "）。请确认 :13991 服务已启动。"
          );
        } else {
          showStatus("success", "已保存到本机（更新加载项后仍保留）");
        }
      });
    }
  }

  function onTestConn() {
    saveSettings();
    var box = $("testConnResult");
    box.classList.remove("hidden", "ok", "fail");
    box.textContent = "正在测试…";
    AIClient.testConnection().then(function (r) {
      box.textContent = r.message;
      box.classList.add(r.ok ? "ok" : "fail");
    });
  }

  function newChat() {
    if (state.messages.length && !window.confirm("开始新会话？")) return;
    if (state.messages.length) persistSession();
    if (typeof SessionHistory !== "undefined") {
      state.sessionId = SessionHistory.newSessionId();
    }
    state._createdAt = Date.now();
    state.messages = [];
    $("chatHistory").innerHTML = "";
    state.lastContent = "";
    state.lastGrid = null;
    state.lastDiff = null;
    state.rows = [];
    renderDiffRows();
    $("diffSummary").textContent = "等待 AI 生成表格…";
    showStatus("info", "已开始新会话。");
  }

  function bind() {
    $("btnRefreshCtx").addEventListener("click", refreshContext);
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
      var def = CHIPS[btn.getAttribute("data-chip")];
      if (!def) return;
      $("userInput").value = def.prompt;
      $("userInput").focus();
      try {
        refreshContext();
        $("chkIncludeCtx").checked = true;
      } catch (err) { /* ignore */ }
    });

    $("btnSelectChanges").addEventListener("click", function () {
      setChecks(function (r) { return r.kind === "修改" || r.kind === "新增"; });
    });
    $("btnSelectAll").addEventListener("click", function () {
      setChecks(function () { return true; });
    });
    $("btnSelectNone").addEventListener("click", function () {
      setChecks(function () { return false; });
    });
    $("btnHideSame").addEventListener("click", function () {
      state.hideSame = !state.hideSame;
      $("btnHideSame").setAttribute("data-on", state.hideSame ? "1" : "0");
      $("btnHideSame").textContent = state.hideSame ? "隐藏不变" : "显示不变";
      renderDiffRows();
    });
    $("btnApplySelected").addEventListener("click", applySelected);
    $("btnRebuildDiff").addEventListener("click", function () {
      rebuildDiffFromGrid();
      showStatus("info", "已按当前选区与写入目标重算 diff。");
    });
    $("writeMode").addEventListener("change", function () {
      if (state.lastGrid) rebuildDiffFromGrid();
    });

    $("diffBody").addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.matches("input[type=checkbox][data-idx]")) {
        var idx = parseInt(t.getAttribute("data-idx"), 10);
        if (!isNaN(idx) && state.rows[idx]) {
          state.rows[idx].checked = !!t.checked;
          updateSelCount();
        }
      }
    });
    $("chkHeader").addEventListener("change", function () {
      var on = $("chkHeader").checked;
      for (var i = 0; i < state.rows.length; i++) {
        if (state.hideSame && state.rows[i].kind === "不变") continue;
        state.rows[i].checked = on;
      }
      renderDiffRows();
    });

    $("btnOpenSettings").addEventListener("click", function () { openSettings(true); });
    $("btnCloseSettings").addEventListener("click", function () { openSettings(false); });
    $("btnSaveSettings").addEventListener("click", function () {
      saveSettings();
      openSettings(false);
    });
    $("btnTestConn").addEventListener("click", onTestConn);
    $("settingsOverlay").addEventListener("click", function (e) {
      if (e.target === $("settingsOverlay")) openSettings(false);
    });
  }

  function init() {
    bind();
    ensureSession();
    if (typeof AIClient !== "undefined" && AIClient.hydrateSettingsFromDisk) {
      AIClient.hydrateSettingsFromDisk().then(function (r) {
        if (r && r.hydrated) {
          showStatus("info", "已从本机恢复 API 配置。");
        }
      });
    }
    if (typeof Util !== "undefined" && !Util.isWpsAvailable()) {
      showStatus("warn", "未检测到 WPS API。请从功能区「打开 AI 工作区」进入。");
    } else {
      try { refreshContext(); } catch (e) { /* ignore */ }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
