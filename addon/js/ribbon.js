/**
 * 功能区按钮回调。
 */
var TASKPANE_STORAGE_KEY = "WpsExcelAI.taskpaneId";
var DIALOG_PANE_STORAGE_KEY = "WpsExcelAI.dialogPaneId";
var TASKPANE_HTML = "taskpane.html";
var DIALOG_HTML = "dialog.html";
var TASKPANE_TITLE = "AI 助手";
var DIALOG_TITLE = "AI 工作区";
var TASKPANE_WIDTH = 420;
var DIALOG_PANE_WIDTH = 920;
var DIALOG_WIDTH = 1100;
var DIALOG_HEIGHT = 720;
var ADDON_VERSION = "1.2.3";

function OnAddinLoad(ribbonUI) {
  try {
    if (typeof wps !== "undefined") {
      wps.ribbonUI = ribbonUI;
    }
  } catch (e) { /* ignore */ }
  return true;
}

function _resolveUrl(htmlFile) {
  var base = (typeof Util !== "undefined" && Util.GetUrlPath)
    ? Util.GetUrlPath()
    : GetUrlPath();
  return base + "/" + htmlFile;
}

function _createOrShowTaskPane(forceRecreate) {
  if (typeof wps === "undefined" || !wps.CreateTaskPane) {
    alert("WPS API 不可用：无法创建任务窗格。请确认本加载项已在 WPS 表格中正确加载。");
    return false;
  }

  var tsId = null;
  try {
    tsId = wps.PluginStorage.getItem(TASKPANE_STORAGE_KEY);
  } catch (e) { /* ignore */ }

  if (forceRecreate && tsId) {
    try {
      var old = wps.GetTaskPane(tsId);
      if (old) old.Delete();
    } catch (e2) { /* ignore */ }
    try {
      wps.PluginStorage.setItem(TASKPANE_STORAGE_KEY, "");
    } catch (e3) { /* ignore */ }
    tsId = null;
  }

  if (tsId) {
    try {
      var existing = wps.GetTaskPane(tsId);
      if (existing) {
        existing.Visible = true;
        try { existing.Width = TASKPANE_WIDTH; } catch (e4) { /* ignore */ }
        return true;
      }
    } catch (e5) {
      // ID 失效，重新创建
    }
  }

  var url = _resolveUrl(TASKPANE_HTML);
  var pane = wps.CreateTaskPane(url, TASKPANE_TITLE);
  if (!pane) {
    alert("创建任务窗格失败（URL 安全检查未通过或路径无效）：\n" + url);
    return false;
  }

  try {
    pane.DockPosition = (typeof Util !== "undefined")
      ? Util.dockLeftValue()
      : 0;
  } catch (e6) {
    try { pane.DockPosition = 0; } catch (e7) { /* ignore */ }
  }
  try { pane.Width = TASKPANE_WIDTH; } catch (e8) { /* ignore */ }
  pane.Visible = true;

  try {
    wps.PluginStorage.setItem(TASKPANE_STORAGE_KEY, pane.ID);
  } catch (e9) { /* ignore */ }

  return true;
}

/**
 * 打开 Cursor 式 AI 工作区：优先 ShowDialog；Mac 若不可用则退化为加宽任务窗格加载 dialog.html。
 */
function _openAiWorkspace(forceRecreate) {
  var url = _resolveUrl(DIALOG_HTML);

  // 1) Application.ShowDialog / wps.ShowDialog
  try {
    var app = null;
    if (typeof wps !== "undefined" && wps.Application) app = wps.Application;
    else if (typeof Application !== "undefined") app = Application;

    var showDialogFn = null;
    if (typeof wps !== "undefined" && typeof wps.ShowDialog === "function") {
      showDialogFn = function () {
        return wps.ShowDialog(url, DIALOG_TITLE, DIALOG_WIDTH, DIALOG_HEIGHT, false);
      };
    } else if (app && typeof app.ShowDialog === "function") {
      showDialogFn = function () {
        return app.ShowDialog(url, DIALOG_TITLE, DIALOG_WIDTH, DIALOG_HEIGHT, false);
      };
    }

    if (showDialogFn) {
      var ok = showDialogFn();
      if (ok !== false) {
        try { wps.PluginStorage.setItem("WpsExcelAI.lastWorkspace", "dialog"); } catch (e0) {}
        return true;
      }
    }
  } catch (eShow) {
    // fall through to taskpane
  }

  // 2) 宽任务窗格兜底（Mac 部分版本 ShowDialog 受限）
  if (typeof wps === "undefined" || !wps.CreateTaskPane) {
    alert(
      "无法打开 AI 工作区。\n" +
      "当前环境不支持 ShowDialog，且无法创建任务窗格。\n" +
      "请确认在 WPS 表格中加载本插件。"
    );
    return false;
  }

  var tsId = null;
  try {
    tsId = wps.PluginStorage.getItem(DIALOG_PANE_STORAGE_KEY);
  } catch (e) { /* ignore */ }

  if (forceRecreate && tsId) {
    try {
      var old = wps.GetTaskPane(tsId);
      if (old) old.Delete();
    } catch (e2) { /* ignore */ }
    try { wps.PluginStorage.setItem(DIALOG_PANE_STORAGE_KEY, ""); } catch (e3) {}
    tsId = null;
  }

  if (tsId) {
    try {
      var existing = wps.GetTaskPane(tsId);
      if (existing) {
        existing.Visible = true;
        try { existing.Width = DIALOG_PANE_WIDTH; } catch (e4) {}
        return true;
      }
    } catch (e5) {}
  }

  var pane = wps.CreateTaskPane(url, DIALOG_TITLE);
  if (!pane) {
    alert("创建 AI 工作区失败：\n" + url);
    return false;
  }
  try {
    // 尽量右侧停靠，给对话+diff 更宽空间
    var dockRight =
      (typeof Util !== "undefined" && Util.safeGetEnum
        ? null
        : null);
    try {
      if (typeof wps !== "undefined" && wps.Enum && wps.Enum.JSKsoEnum_msoCTPDockPositionRight != null) {
        pane.DockPosition = wps.Enum.JSKsoEnum_msoCTPDockPositionRight;
      } else if (typeof Application !== "undefined" && Application.Enum) {
        pane.DockPosition = Application.Enum.JSKsoEnum_msoCTPDockPositionRight;
      } else {
        pane.DockPosition = 2; // 常见 Right = 2
      }
    } catch (eDock) {
      try { pane.DockPosition = 2; } catch (eDock2) {}
    }
  } catch (e6) {}
  try { pane.Width = DIALOG_PANE_WIDTH; } catch (e8) {}
  pane.Visible = true;
  try {
    wps.PluginStorage.setItem(DIALOG_PANE_STORAGE_KEY, pane.ID);
    wps.PluginStorage.setItem("WpsExcelAI.lastWorkspace", "pane");
  } catch (e9) {}
  return true;
}

function OnOpenTaskPane(control) {
  _createOrShowTaskPane(false);
  return true;
}

function OnOpenAiWorkspace(control) {
  _openAiWorkspace(false);
  return true;
}

function OnRefreshTaskPane(control) {
  _createOrShowTaskPane(true);
  return true;
}

function OnAbout(control) {
  alert(
    "WPS Excel AI 助手  v" + ADDON_VERSION + "\n\n" +
    "产品路径：侧栏轻对话 → AI 工作区逐格同意写入。\n" +
    "功能区「打开 AI 工作区」为写入主路径；侧栏不再提供整表写入。\n" +
    "写入前不会自动改表；应用已选仅写入勾选单元格。\n\n" +
    "若 Mac 上独立对话框 API 不可用，会自动用加宽任务窗格打开同一页面。\n\n" +
    "支持 OpenAI 兼容接口（OpenAI / DeepSeek / 本地模型等）。"
  );
  return true;
}

function GetImage(control) {
  return "images/1x20.png";
}

function OnGetEnabled(control) {
  return true;
}

function OnGetVisible(control) {
  return true;
}

// 供侧栏按钮调用
function OpenAiWorkspaceFromPane() {
  return _openAiWorkspace(false);
}
