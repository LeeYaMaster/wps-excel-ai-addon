/**
 * WPS 表格读写：选区上下文采集、解析 AI 结果、写入单元格。
 */
(function (global) {
  "use strict";

  function app() {
    if (typeof Util !== "undefined" && Util.getApp) return Util.getApp();
    if (typeof wps !== "undefined" && wps.Application) return wps.Application;
    if (typeof Application !== "undefined") return Application;
    return null;
  }

  function ensureApp() {
    var a = app();
    if (!a) {
      throw new Error("WPS API 不可用：未检测到 Application。请在 WPS 表格中打开本面板。");
    }
    return a;
  }

  /** Value2 可能是标量 / 1D / 2D（COM 风格） */
  function normalizeToGrid(value2) {
    if (value2 === null || value2 === undefined) return [[""]];
    if (typeof value2 !== "object") return [[value2]];

    // 已是二维数组（JS）
    if (Array.isArray(value2)) {
      if (value2.length === 0) return [[""]];
      if (!Array.isArray(value2[0])) return [value2.map(function (c) { return c == null ? "" : c; })];
      return value2.map(function (row) {
        if (!Array.isArray(row)) return [row == null ? "" : row];
        return row.map(function (c) { return c == null ? "" : c; });
      });
    }

    // COM SafeArray 风格：可能有 .toArray 或 VB 风格下标从 1 开始
    try {
      if (typeof value2.toArray === "function") {
        return normalizeToGrid(value2.toArray());
      }
    } catch (e) { /* ignore */ }

    // 尝试按 Rows/Columns 属性逐格读（兜底）
    return [[String(value2)]];
  }

  function gridToTsv(grid, maxRows, maxCols) {
    maxRows = maxRows || 40;
    maxCols = maxCols || 20;
    var rows = [];
    var rCount = Math.min(grid.length, maxRows);
    for (var r = 0; r < rCount; r++) {
      var row = grid[r] || [];
      var cCount = Math.min(row.length, maxCols);
      var cells = [];
      for (var c = 0; c < cCount; c++) {
        var v = row[c];
        cells.push(v == null ? "" : String(v).replace(/\t/g, " ").replace(/\r?\n/g, " "));
      }
      rows.push(cells.join("\t"));
    }
    var truncated = grid.length > maxRows || (grid[0] && grid[0].length > maxCols);
    return { text: rows.join("\n"), truncated: truncated, rows: grid.length, cols: (grid[0] ? grid[0].length : 0) };
  }

  function getSelectionContext() {
    var a = ensureApp();
    var sheet = a.ActiveSheet;
    if (!sheet) {
      throw new Error("当前没有活动工作表。请先打开一个工作簿。");
    }

    var sheetName = "";
    try { sheetName = sheet.Name; } catch (e) { sheetName = "(未知)"; }

    var workbookName = "";
    try {
      if (a.ActiveWorkbook) workbookName = a.ActiveWorkbook.Name;
    } catch (e2) { /* ignore */ }

    var sel = a.Selection;
    var address = "";
    var rowCount = 1;
    var colCount = 1;
    var grid = [[""]];
    var activeAddress = "";

    try {
      if (sel && sel.Address) address = sel.Address();
      else if (sel && sel.Address !== undefined) address = String(sel.Address);
    } catch (e3) {
      try { address = String(sel.Address); } catch (e4) { address = ""; }
    }

    try {
      rowCount = sel.Rows.Count;
      colCount = sel.Columns.Count;
    } catch (e5) { /* ignore */ }

    try {
      grid = normalizeToGrid(sel.Value2);
    } catch (e6) {
      grid = [[""]];
    }

    try {
      if (a.ActiveCell) {
        activeAddress = a.ActiveCell.Address ? a.ActiveCell.Address() : String(a.ActiveCell.Address);
      }
    } catch (e7) {
      try { activeAddress = String(a.ActiveCell.Address); } catch (e8) { activeAddress = ""; }
    }

    // 附近已用区域摘要（尽量取 UsedRange，失败则跳过）
    var usedSummary = "";
    try {
      var used = sheet.UsedRange;
      if (used) {
        var uAddr = "";
        try { uAddr = used.Address(); } catch (e9) { uAddr = String(used.Address || ""); }
        var uRows = used.Rows.Count;
        var uCols = used.Columns.Count;
        var sampleGrid = normalizeToGrid(used.Value2);
        var sample = gridToTsv(sampleGrid, 8, 8);
        usedSummary =
          "已用区域: " + uAddr + " (" + uRows + "行 x " + uCols + "列)\n" +
          "左上角抽样:\n" + sample.text +
          (sample.truncated ? "\n...(抽样已截断)" : "");
      }
    } catch (e10) {
      usedSummary = "(无法读取 UsedRange)";
    }

    var selTsv = gridToTsv(grid, 50, 30);

    return {
      workbookName: workbookName,
      sheetName: sheetName,
      selectionAddress: address,
      activeCellAddress: activeAddress,
      rowCount: rowCount,
      colCount: colCount,
      valuesTsv: selTsv.text,
      valuesTruncated: selTsv.truncated,
      usedSummary: usedSummary,
      grid: grid
    };
  }

  function contextToPromptBlock(ctx) {
    return [
      "【当前工作簿】" + (ctx.workbookName || ""),
      "【当前工作表】" + (ctx.sheetName || ""),
      "【选区地址】" + (ctx.selectionAddress || "") + " (" + ctx.rowCount + "行 x " + ctx.colCount + "列)",
      "【活动单元格】" + (ctx.activeCellAddress || ""),
      "【选区内容 TSV】",
      ctx.valuesTsv || "(空)",
      ctx.valuesTruncated ? "(选区内容已截断)" : "",
      "【工作表摘要】",
      ctx.usedSummary || ""
    ].filter(Boolean).join("\n");
  }

  // ---------- 解析 AI 返回为二维网格 ----------

  function parseJsonGrid(text) {
    var trimmed = text.trim();
    // 提取 ```json ... ``` 或裸 JSON
    var fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    var candidate = fence ? fence[1].trim() : trimmed;

    // 找第一个 [ 或 {
    var startArr = candidate.indexOf("[");
    var startObj = candidate.indexOf("{");
    if (startArr < 0 && startObj < 0) return null;

    var start = -1;
    if (startArr >= 0 && (startObj < 0 || startArr < startObj)) start = startArr;
    else start = startObj;

    var slice = candidate.slice(start);
    try {
      var data = JSON.parse(slice);
      return jsonToGrid(data);
    } catch (e) {
      // 尝试截到最后一个 ] 或 }
      var endArr = slice.lastIndexOf("]");
      var endObj = slice.lastIndexOf("}");
      var end = Math.max(endArr, endObj);
      if (end > 0) {
        try {
          return jsonToGrid(JSON.parse(slice.slice(0, end + 1)));
        } catch (e2) {
          return null;
        }
      }
      return null;
    }
  }

  function jsonToGrid(data) {
    if (data == null) return null;
    if (typeof data !== "object") return [[data]];

    // { headers: [], rows: [] } 或 { data: [[]] }
    if (!Array.isArray(data)) {
      if (Array.isArray(data.data)) return jsonToGrid(data.data);
      if (Array.isArray(data.rows)) {
        var g = [];
        if (Array.isArray(data.headers)) g.push(data.headers.slice());
        data.rows.forEach(function (row) {
          if (Array.isArray(row)) g.push(row.slice());
          else if (row && typeof row === "object") {
            var keys = data.headers || Object.keys(row);
            g.push(keys.map(function (k) { return row[k] == null ? "" : row[k]; }));
          } else {
            g.push([row]);
          }
        });
        return g.length ? g : null;
      }
      // 普通对象 -> 两列 key/value
      return Object.keys(data).map(function (k) { return [k, data[k]]; });
    }

    if (data.length === 0) return [[""]];
    if (Array.isArray(data[0])) {
      return data.map(function (row) {
        return Array.isArray(row)
          ? row.map(function (c) { return c == null ? "" : c; })
          : [row];
      });
    }
    if (typeof data[0] === "object" && data[0] !== null) {
      var keys = Object.keys(data[0]);
      var out = [keys];
      data.forEach(function (obj) {
        out.push(keys.map(function (k) { return obj[k] == null ? "" : obj[k]; }));
      });
      return out;
    }
    // 一维数组 -> 单列
    return data.map(function (v) { return [v == null ? "" : v]; });
  }

  function parseDelimited(text, delimiter) {
    var lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    // 去掉围栏
    if (lines[0] && /^```/.test(lines[0].trim())) lines.shift();
    if (lines.length && /^```/.test(lines[lines.length - 1].trim())) lines.pop();

    var grid = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // 跳过纯空行过多时保留空行占位？保留
      if (delimiter === "\t") {
        grid.push(line.split("\t"));
      } else {
        grid.push(parseCsvLine(line));
      }
    }
    // 去掉首尾全空
    while (grid.length && grid[0].every(function (c) { return String(c).trim() === ""; })) grid.shift();
    while (grid.length && grid[grid.length - 1].every(function (c) { return String(c).trim() === ""; })) grid.pop();
    return grid.length ? grid : null;
  }

  function parseCsvLine(line) {
    var result = [];
    var cur = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") {
          result.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    result.push(cur);
    return result;
  }

  /**
   * 从 AI 完整回复中提取可写入网格。
   * 优先：JSON → TSV → CSV → 按行单列。
   */
  function extractGridFromResponse(text) {
    if (!text || !String(text).trim()) return null;
    var raw = String(text);

    var fromJson = parseJsonGrid(raw);
    if (fromJson && fromJson.length) return fromJson;

    // 围栏内 csv/tsv
    var fenceMatch = raw.match(/```(?:csv|tsv|text)?\s*([\s\S]*?)```/i);
    var body = fenceMatch ? fenceMatch[1].trim() : raw.trim();

    if (body.indexOf("\t") >= 0) {
      var tsv = parseDelimited(body, "\t");
      if (tsv && tsv.length && (tsv.length > 1 || tsv[0].length > 1)) return tsv;
    }

    // 多行且含逗号，当作 CSV
    var lines = body.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
    if (lines.length >= 1 && lines.some(function (l) { return l.indexOf(",") >= 0; })) {
      var csv = parseDelimited(body, ",");
      if (csv && csv.length) return csv;
    }

    // 纯多行文本 -> 单列
    if (lines.length > 1) {
      return lines.map(function (l) { return [l]; });
    }

    // 单行也允许写入
    if (body.trim()) return [[body.trim()]];
    return null;
  }

  function colIndexToLetter(index) {
    // 1-based
    var s = "";
    var n = index;
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s || "A";
  }

  function writeGridToRange(range, grid, mode) {
    // mode: 'fit' = 按 grid 尺寸扩写；'clip' = 仅写入选区大小
    var targetRows = range.Rows.Count;
    var targetCols = range.Columns.Count;
    var srcRows = grid.length;
    var srcCols = 0;
    for (var i = 0; i < grid.length; i++) {
      if (grid[i].length > srcCols) srcCols = grid[i].length;
    }
    if (srcCols === 0) srcCols = 1;

    var rows = mode === "clip" ? Math.min(srcRows, targetRows) : srcRows;
    var cols = mode === "clip" ? Math.min(srcCols, targetCols) : srcCols;

    // 构造严格二维数组
    var out = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        var v = (grid[r] && grid[r][c] !== undefined) ? grid[r][c] : "";
        row.push(v);
      }
      out.push(row);
    }

    if (mode === "fit" && (rows !== targetRows || cols !== targetCols)) {
      // 从 range 左上角扩出目标区域
      var startCell = range.Item ? range.Item(1, 1) : range.Cells.Item(1, 1);
      var startRow = startCell.Row;
      var startCol = startCell.Column;
      var a = ensureApp();
      var sheet = a.ActiveSheet;
      var endAddr =
        colIndexToLetter(startCol + cols - 1) + String(startRow + rows - 1);
      var startAddr = colIndexToLetter(startCol) + String(startRow);
      var dest = sheet.Range(startAddr + ":" + endAddr);
      dest.Value2 = out;
      return { address: startAddr + ":" + endAddr, rows: rows, cols: cols };
    }

    // clip 或尺寸刚好：直接写 Value2
    // 单格时 WPS 有时要标量
    if (rows === 1 && cols === 1) {
      range.Value2 = out[0][0];
    } else {
      range.Value2 = out;
    }
    var addr = "";
    try { addr = range.Address(); } catch (e) { addr = ""; }
    return { address: addr, rows: rows, cols: cols };
  }

  /**
   * @param {string} mode  selected | active | replace | newsheet
   * @param {any[][]} grid
   */
  function applyGrid(mode, grid) {
    if (!grid || !grid.length) {
      throw new Error("没有可写入的表格数据。请确认 AI 返回了 CSV/TSV/JSON 表格，或使用「整段文本写入」。");
    }
    var a = ensureApp();
    var sheet = a.ActiveSheet;
    if (!sheet) throw new Error("没有活动工作表。");

    if (mode === "newsheet") {
      var sheets = a.ActiveWorkbook.Sheets;
      var newSheet;
      try {
        // After:= 活动表
        newSheet = sheets.Add(undefined, sheet);
      } catch (e) {
        try {
          newSheet = sheets.Add();
        } catch (e2) {
          throw new Error("创建新工作表失败：" + (e2.message || e2));
        }
      }
      try {
        var baseName = "AI结果";
        var name = baseName;
        var n = 1;
        // 简单避重名
        while (n < 50) {
          try {
            sheets.Item(name);
            n++;
            name = baseName + n;
          } catch (notFound) {
            break;
          }
        }
        newSheet.Name = name;
      } catch (e3) { /* 命名失败可忽略 */ }

      var rows = grid.length;
      var cols = 1;
      grid.forEach(function (r) { if (r.length > cols) cols = r.length; });
      var endAddr = colIndexToLetter(cols) + String(rows);
      var dest = newSheet.Range("A1:" + endAddr);
      var out = [];
      for (var r = 0; r < rows; r++) {
        var row = [];
        for (var c = 0; c < cols; c++) {
          row.push(grid[r] && grid[r][c] !== undefined ? grid[r][c] : "");
        }
        out.push(row);
      }
      if (rows === 1 && cols === 1) dest.Value2 = out[0][0];
      else dest.Value2 = out;
      try { newSheet.Activate(); } catch (e4) { /* ignore */ }
      return { address: "A1:" + endAddr, sheet: newSheet.Name, rows: rows, cols: cols };
    }

    if (mode === "active") {
      var cell = a.ActiveCell;
      if (!cell) throw new Error("没有活动单元格。");
      return writeGridToRange(cell, grid, "fit");
    }

    if (mode === "replace") {
      var sel = a.Selection;
      if (!sel) throw new Error("没有选区。");
      return writeGridToRange(sel, grid, "clip");
    }

    // selected：写入选区，若 grid 更大则从选区左上角扩展
    var selection = a.Selection;
    if (!selection) throw new Error("没有选区。");
    return writeGridToRange(selection, grid, "fit");
  }

  /** 将纯文本按单列写入 */
  function applyPlainText(mode, text) {
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    var grid = lines.map(function (l) { return [l]; });
    return applyGrid(mode, grid);
  }


  /**
   * 读取写入目标区域当前值，与将写入网格对比。
   * @returns {{summary:string, changed:number, same:number, added:number, details:Array, targetAddress:string}}
   */
  /**
   * 读取写入目标区域当前值，与将写入网格对比。
   * @param {string} mode
   * @param {any[][]} grid
   * @param {{maxDetail?:number, includeSame?:boolean, truncate?:number}|number} [options]
   *        兼容旧调用：第三参若为 number 则当作 maxDetail。
   * @returns {{summary:string, changed:number, same:number, added:number, details:Array, targetAddress:string, startRow:number, startCol:number, rows:number, cols:number}}
   */
  function diffAgainstTarget(mode, grid, options) {
    if (!grid || !grid.length) {
      throw new Error("没有可对比的表格数据。");
    }
    var opts = {};
    if (typeof options === "number") {
      opts = { maxDetail: options };
    } else if (options && typeof options === "object") {
      opts = options;
    }
    var maxDetail = opts.maxDetail != null ? opts.maxDetail : 40;
    var includeSame = !!opts.includeSame;
    var truncate = opts.truncate != null ? opts.truncate : 0; // 0 = 不截断（写入需要完整值）

    var a = ensureApp();
    var srcRows = grid.length;
    var srcCols = 0;
    for (var i = 0; i < grid.length; i++) {
      if (grid[i].length > srcCols) srcCols = grid[i].length;
    }
    if (srcCols === 0) srcCols = 1;

    var current = [];
    var targetAddress = "";
    var sheetName = "";
    var startRow = 1;
    var startCol = 1;

    if (mode === "newsheet") {
      var detailsNew = [];
      if (maxDetail > 0) {
        for (var nr = 0; nr < srcRows && detailsNew.length < maxDetail; nr++) {
          for (var nc = 0; nc < srcCols && detailsNew.length < maxDetail; nc++) {
            var nv0 = grid[nr] && grid[nr][nc] !== undefined ? grid[nr][nc] : "";
            var ns0 = nv0 == null ? "" : String(nv0);
            detailsNew.push({
              address: colIndexToLetter(1 + nc) + String(1 + nr),
              from: "",
              to: ns0,
              kind: "新增",
              row: nr,
              col: nc
            });
          }
        }
      }
      return {
        summary: "将新建工作表并写入 " + srcRows + "×" + srcCols + "（目标区域当前为空）。",
        changed: 0,
        same: 0,
        added: srcRows * srcCols,
        details: detailsNew,
        targetAddress: "新工作表!A1",
        sheetName: "(新)",
        startRow: 1,
        startCol: 1,
        rows: srcRows,
        cols: srcCols
      };
    }

    try {
      sheetName = a.ActiveSheet ? a.ActiveSheet.Name : "";
    } catch (e0) { sheetName = ""; }

    var clip = mode === "replace";

    try {
      if (mode === "active") {
        var cell = a.ActiveCell;
        startRow = cell.Row;
        startCol = cell.Column;
        targetAddress = colIndexToLetter(startCol) + startRow + ":" +
          colIndexToLetter(startCol + srcCols - 1) + (startRow + srcRows - 1);
        var dest = a.ActiveSheet.Range(targetAddress);
        current = normalizeToGrid(dest.Value2);
      } else {
        var sel = a.Selection;
        var tl = sel.Item ? sel.Item(1, 1) : sel.Cells.Item(1, 1);
        startRow = tl.Row;
        startCol = tl.Column;
        var tRows = clip ? Math.min(srcRows, sel.Rows.Count) : srcRows;
        var tCols = clip ? Math.min(srcCols, sel.Columns.Count) : srcCols;
        targetAddress = colIndexToLetter(startCol) + startRow + ":" +
          colIndexToLetter(startCol + tCols - 1) + (startRow + tRows - 1);
        var dest2 = a.ActiveSheet.Range(targetAddress);
        current = normalizeToGrid(dest2.Value2);
        srcRows = tRows;
        srcCols = tCols;
      }
    } catch (e) {
      return {
        summary: "无法读取目标区域当前值（" + (e.message || e) + "）。仍可写入，但无 diff。",
        changed: -1,
        same: 0,
        added: 0,
        details: [],
        targetAddress: targetAddress || "(未知)",
        sheetName: sheetName,
        startRow: startRow,
        startCol: startCol,
        rows: srcRows,
        cols: srcCols
      };
    }

    var changed = 0;
    var same = 0;
    var added = 0;
    var details = [];

    function maybeTrunc(s) {
      if (!truncate || truncate <= 0) return s;
      return s.length > truncate ? s.slice(0, truncate) : s;
    }

    for (var r = 0; r < srcRows; r++) {
      for (var c = 0; c < srcCols; c++) {
        var nv = grid[r] && grid[r][c] !== undefined ? grid[r][c] : "";
        var ov = current[r] && current[r][c] !== undefined ? current[r][c] : "";
        var ns = nv == null ? "" : String(nv);
        var os = ov == null ? "" : String(ov);
        var addr = colIndexToLetter(startCol + c) + String(startRow + r);
        var kind;
        if (os === "" && ns !== "") {
          added++;
          kind = "新增";
        } else if (ns !== os) {
          changed++;
          kind = "修改";
        } else {
          same++;
          kind = "不变";
        }
        var want =
          (kind === "不变" && includeSame) ||
          (kind !== "不变");
        if (want && details.length < maxDetail) {
          details.push({
            address: addr,
            from: maybeTrunc(os),
            to: maybeTrunc(ns),
            kind: kind,
            row: r,
            col: c
          });
        }
      }
    }

    var summary =
      "目标 " + (sheetName ? ("「" + sheetName + "」") : "") + targetAddress +
      "：修改 " + changed + " 格，新增 " + added + " 格，不变 " + same + " 格" +
      "（将写入 " + srcRows + "×" + srcCols + "）。";
    if (details.length >= maxDetail && (changed + added + (includeSame ? same : 0)) > maxDetail) {
      summary += " 明细仅列前 " + maxDetail + " 条。";
    }

    return {
      summary: summary,
      changed: changed,
      same: same,
      added: added,
      details: details,
      targetAddress: targetAddress,
      sheetName: sheetName,
      startRow: startRow,
      startCol: startCol,
      rows: srcRows,
      cols: srcCols
    };
  }

  /**
   * 仅写入勾选的单元格（按地址）。不会整表覆盖未勾选格。
   * @param {Array<{address:string, value:any}>} changes
   */
  function applySelectedCells(changes) {
    var a = ensureApp();
    var sheet = a.ActiveSheet;
    if (!sheet) throw new Error("没有活动工作表。");
    if (!changes || !changes.length) {
      throw new Error("没有勾选任何单元格。请先勾选要写入的变更。");
    }
    var written = 0;
    var failed = [];
    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i];
      if (!ch || !ch.address) continue;
      try {
        var range = sheet.Range(String(ch.address));
        var val = ch.value == null ? "" : ch.value;
        range.Value2 = val;
        written++;
      } catch (e) {
        failed.push(String(ch.address) + ": " + (e.message || e));
      }
    }
    if (written === 0) {
      throw new Error(
        "未能写入任何单元格。" +
        (failed.length ? " 原因：" + failed.slice(0, 3).join("; ") : "")
      );
    }
    return {
      written: written,
      failed: failed,
      address: changes.length === 1 ? changes[0].address : (written + " 个单元格")
    };
  }

  /**
   * 按网格 + 地址掩码写入：仅写入 addressSet 中的格子。
   * @param {string} mode selected|active|replace（newsheet 请用 applyGrid）
   * @param {any[][]} grid
   * @param {Object|string[]|Set} addressSet 地址集合或 {A1:true,...}
   */
  function applyGridWithMask(mode, grid, addressSet) {
    if (!grid || !grid.length) {
      throw new Error("没有可写入的表格数据。");
    }
    if (mode === "newsheet") {
      throw new Error("按勾选写入不支持「新工作表」模式，请改用整表写入或先建表再逐格应用。");
    }
    var set = {};
    if (addressSet) {
      if (typeof addressSet.has === "function" && typeof addressSet.forEach === "function") {
        addressSet.forEach(function (addr) { set[String(addr).toUpperCase()] = true; });
      } else if (Array.isArray(addressSet)) {
        for (var i = 0; i < addressSet.length; i++) {
          set[String(addressSet[i]).toUpperCase()] = true;
        }
      } else if (typeof addressSet === "object") {
        Object.keys(addressSet).forEach(function (k) {
          if (addressSet[k]) set[String(k).toUpperCase()] = true;
        });
      }
    }
    var keys = Object.keys(set);
    if (!keys.length) {
      throw new Error("掩码为空：没有勾选任何单元格。");
    }

    var diff = diffAgainstTarget(mode, grid, { maxDetail: 100000, includeSame: true });
    var changes = [];
    for (var d = 0; d < diff.details.length; d++) {
      var item = diff.details[d];
      var addrKey = String(item.address).toUpperCase();
      // 去掉可能的 $ 
      addrKey = addrKey.replace(/\$/g, "");
      var bare = String(item.address).replace(/\$/g, "");
      if (set[addrKey] || set[bare.toUpperCase()] || set[item.address]) {
        changes.push({ address: bare, value: item.to });
      }
    }
    // 若 diff 因某种原因没覆盖，按 startRow/Col 直接算
    if (!changes.length) {
      var startRow = diff.startRow || 1;
      var startCol = diff.startCol || 1;
      var rows = diff.rows || grid.length;
      var cols = diff.cols || 1;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var addr = colIndexToLetter(startCol + c) + String(startRow + r);
          if (set[addr.toUpperCase()]) {
            var v = grid[r] && grid[r][c] !== undefined ? grid[r][c] : "";
            changes.push({ address: addr, value: v });
          }
        }
      }
    }
    return applySelectedCells(changes);
  }

  function formatDiffForConfirm(diff) {
    if (!diff) return "";
    var lines = [diff.summary || ""];
    if (diff.details && diff.details.length) {
      lines.push("变更明细：");
      for (var i = 0; i < Math.min(diff.details.length, 15); i++) {
        var d = diff.details[i];
        function short(v) {
          var s = JSON.stringify(v == null ? "" : v);
          return s.length > 48 ? s.slice(0, 45) + "..." : s;
        }
        if (d.kind === "新增") {
          lines.push("  " + d.address + " ← " + short(d.to));
        } else {
          lines.push("  " + d.address + ": " + short(d.from) + " → " + short(d.to));
        }
      }
    }
    return lines.join("\n");
  }

  /** 按自然语言条件尽量本地高亮选区（包含关键字 / 数值比较简易规则） */
  function highlightSelectionByHint(hint) {
    var a = ensureApp();
    var sel = a.Selection;
    if (!sel) throw new Error("没有选区。");
    var grid = normalizeToGrid(sel.Value2);
    var rows = sel.Rows.Count;
    var cols = sel.Columns.Count;
    var tl = sel.Item ? sel.Item(1, 1) : sel.Cells.Item(1, 1);
    var startRow = tl.Row;
    var startCol = tl.Column;

    var h = String(hint || "").trim();
    if (!h) throw new Error("请提供筛选/高亮条件。");

    // 解析简易规则
    var rule = null;
    var m;
    if ((m = h.match(/(?:包含|含有|含)\s*[「"']?(.+?)[」"']?\s*$/))) {
      rule = { type: "contains", value: m[1] };
    } else if ((m = h.match(/(?:等于|=)\s*[「"']?(.+?)[」"']?\s*$/))) {
      rule = { type: "eq", value: m[1] };
    } else if ((m = h.match(/(?:大于|>)\s*(-?\d+(?:\.\d+)?)/))) {
      rule = { type: "gt", value: parseFloat(m[1]) };
    } else if ((m = h.match(/(?:小于|<)\s*(-?\d+(?:\.\d+)?)/))) {
      rule = { type: "lt", value: parseFloat(m[1]) };
    } else if ((m = h.match(/(?:大于等于|>=)\s*(-?\d+(?:\.\d+)?)/))) {
      rule = { type: "gte", value: parseFloat(m[1]) };
    } else if ((m = h.match(/(?:小于等于|<=)\s*(-?\d+(?:\.\d+)?)/))) {
      rule = { type: "lte", value: parseFloat(m[1]) };
    } else {
      // 默认：单元格文本包含整句关键字
      rule = { type: "contains", value: h };
    }

    function matchCell(val) {
      var s = val == null ? "" : String(val);
      var n = parseFloat(s);
      switch (rule.type) {
        case "contains": return s.indexOf(rule.value) >= 0;
        case "eq": return s === rule.value || (!isNaN(n) && n === parseFloat(rule.value));
        case "gt": return !isNaN(n) && n > rule.value;
        case "lt": return !isNaN(n) && n < rule.value;
        case "gte": return !isNaN(n) && n >= rule.value;
        case "lte": return !isNaN(n) && n <= rule.value;
        default: return false;
      }
    }

    // 清除选区内原有填充（浅色）
    try {
      sel.Interior.ColorIndex = -4142; // xlNone
    } catch (e1) {
      try { sel.Interior.Color = 16777215; } catch (e2) { /* ignore */ }
    }

    var hit = 0;
    var highlightColor = 65535; // yellow approx in BGR? WPS often uses RGB long
    // Excel Color: BGR. Yellow = 0x00FFFF -> 65535
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var v = grid[r] && grid[r][c] !== undefined ? grid[r][c] : "";
        if (matchCell(v)) {
          hit++;
          try {
            var cell = a.ActiveSheet.Cells.Item(startRow + r, startCol + c);
            cell.Interior.Color = highlightColor;
          } catch (e3) { /* ignore single cell */ }
        }
      }
    }
    return { matched: hit, total: rows * cols, rule: rule };
  }

  /** 清空选区填充色 */
  function clearSelectionHighlight() {
    var a = ensureApp();
    var sel = a.Selection;
    if (!sel) throw new Error("没有选区。");
    try {
      sel.Interior.ColorIndex = -4142;
    } catch (e) {
      try { sel.Interior.Color = 16777215; } catch (e2) {
        throw new Error("清除高亮失败：" + (e2.message || e2));
      }
    }
    return true;
  }


  global.ExcelBridge = {
    getSelectionContext: getSelectionContext,
    contextToPromptBlock: contextToPromptBlock,
    extractGridFromResponse: extractGridFromResponse,
    applyGrid: applyGrid,
    applyPlainText: applyPlainText,
    applySelectedCells: applySelectedCells,
    applyGridWithMask: applyGridWithMask,
    normalizeToGrid: normalizeToGrid,
    colIndexToLetter: colIndexToLetter,
    diffAgainstTarget: diffAgainstTarget,
    formatDiffForConfirm: formatDiffForConfirm,
    highlightSelectionByHint: highlightSelectionByHint,
    clearSelectionHighlight: clearSelectionHighlight
  };
})(window);
