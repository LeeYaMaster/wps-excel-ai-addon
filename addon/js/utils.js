/**
 * 通用工具：路径、PluginStorage、枚举兼容。
 */
(function (global) {
  "use strict";

  function GetUrlPath() {
    var e = document.location.toString();
    e = decodeURI(e);
    if (e.indexOf("/") !== -1) {
      e = e.substring(0, e.lastIndexOf("/"));
    }
    return e;
  }

  function GetAddonRootPath() {
    // 兼容 file:// 与 http://127.0.0.1 调试模式
    return GetUrlPath();
  }

  function safeGetEnum(path, fallback) {
    try {
      var cur = global.wps || global;
      var parts = path.split(".");
      for (var i = 0; i < parts.length; i++) {
        if (cur == null) return fallback;
        cur = cur[parts[i]];
      }
      return cur != null ? cur : fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** 左侧停靠：官方枚举优先，失败回退数值 0 */
  function dockLeftValue() {
    return (
      safeGetEnum("Enum.JSKsoEnum_msoCTPDockPositionLeft", null) ||
      safeGetEnum("Application.Enum.JSKsoEnum_msoCTPDockPositionLeft", null) ||
      0
    );
  }

  function storageGet(key, defaultValue) {
    try {
      if (global.wps && wps.PluginStorage) {
        var v = wps.PluginStorage.getItem(key);
        if (v === undefined || v === null || v === "") return defaultValue;
        return v;
      }
    } catch (e) { /* ignore */ }
    try {
      var ls = localStorage.getItem(key);
      if (ls === null || ls === undefined) return defaultValue;
      return ls;
    } catch (e2) {
      return defaultValue;
    }
  }

  function storageSet(key, value) {
    try {
      if (global.wps && wps.PluginStorage) {
        wps.PluginStorage.setItem(key, value);
      }
    } catch (e) { /* ignore */ }
    try {
      localStorage.setItem(key, String(value));
    } catch (e2) { /* ignore */ }
  }

  function isWpsAvailable() {
    try {
      return !!(global.wps && (wps.Application || global.Application));
    } catch (e) {
      return false;
    }
  }

  function getApp() {
    if (global.wps && wps.Application) return wps.Application;
    if (global.Application) return global.Application;
    return null;
  }

  global.Util = {
    GetUrlPath: GetUrlPath,
    GetAddonRootPath: GetAddonRootPath,
    dockLeftValue: dockLeftValue,
    storageGet: storageGet,
    storageSet: storageSet,
    isWpsAvailable: isWpsAvailable,
    getApp: getApp
  };

  // 兼容官方示例中的全局函数名
  global.GetUrlPath = GetUrlPath;
})(window);
