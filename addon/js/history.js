/**
 * 本地会话历史：PluginStorage / localStorage。
 */
(function (global) {
  "use strict";

  var KEY = "WpsExcelAI.sessions";
  var MAX_SESSIONS = 40;

  function _getRaw() {
    if (typeof Util !== "undefined" && Util.storageGet) {
      return Util.storageGet(KEY, "[]");
    }
    try {
      return localStorage.getItem(KEY) || "[]";
    } catch (e) {
      return "[]";
    }
  }

  function _setRaw(s) {
    if (typeof Util !== "undefined" && Util.storageSet) {
      Util.storageSet(KEY, s);
    } else {
      try { localStorage.setItem(KEY, s); } catch (e) { /* ignore */ }
    }
  }

  function listSessions() {
    try {
      var arr = JSON.parse(_getRaw() || "[]");
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch (e) {
      return [];
    }
  }

  function saveSessions(arr) {
    if (!Array.isArray(arr)) arr = [];
    if (arr.length > MAX_SESSIONS) arr = arr.slice(0, MAX_SESSIONS);
    _setRaw(JSON.stringify(arr));
  }

  function upsertSession(session) {
    if (!session || !session.id) return;
    var list = listSessions();
    var found = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === session.id) { found = i; break; }
    }
    session.updatedAt = Date.now();
    if (!session.createdAt) session.createdAt = session.updatedAt;
    if (found >= 0) list[found] = session;
    else list.unshift(session);
    // 按更新时间倒序
    list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    saveSessions(list);
    return session;
  }

  function getSession(id) {
    var list = listSessions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function deleteSession(id) {
    var list = listSessions().filter(function (s) { return s.id !== id; });
    saveSessions(list);
  }

  function newSessionId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function exportMarkdown(session) {
    var lines = [];
    lines.push("# " + (session.title || "会话") );
    lines.push("");
    lines.push("- 创建：" + (session.createdAt ? new Date(session.createdAt).toLocaleString() : ""));
    lines.push("- 更新：" + (session.updatedAt ? new Date(session.updatedAt).toLocaleString() : ""));
    lines.push("");
    var msgs = session.messages || [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      lines.push("## " + (m.role === "user" ? "我" : "AI"));
      lines.push("");
      lines.push(m.content || "");
      lines.push("");
    }
    return lines.join("\n");
  }

  function exportJson(session) {
    return JSON.stringify(session, null, 2);
  }

  function downloadText(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        try { document.body.removeChild(a); } catch (e2) {}
      }, 500);
      return true;
    } catch (e) {
      // 回退：复制到剪贴板或弹窗
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
          return "clipboard";
        }
      } catch (e2) { /* ignore */ }
      throw new Error("无法下载文件（环境限制）。内容已尝试复制；或手动从弹窗复制。");
    }
  }

  global.SessionHistory = {
    KEY: KEY,
    listSessions: listSessions,
    upsertSession: upsertSession,
    getSession: getSession,
    deleteSession: deleteSession,
    newSessionId: newSessionId,
    exportMarkdown: exportMarkdown,
    exportJson: exportJson,
    downloadText: downloadText
  };
})(window);
