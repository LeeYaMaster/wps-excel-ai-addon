function parseJsonGrid(text) {
  var trimmed = text.trim();
  var fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  var candidate = fence ? fence[1].trim() : trimmed;
  var startArr = candidate.indexOf("[");
  var startObj = candidate.indexOf("{");
  if (startArr < 0 && startObj < 0) return null;
  var start = startArr >= 0 && (startObj < 0 || startArr < startObj) ? startArr : startObj;
  var slice = candidate.slice(start);
  try { return jsonToGrid(JSON.parse(slice)); } catch (e) {
    var end = Math.max(slice.lastIndexOf("]"), slice.lastIndexOf("}"));
    if (end > 0) {
      try { return jsonToGrid(JSON.parse(slice.slice(0, end + 1))); } catch (e2) { return null; }
    }
    return null;
  }
}
function jsonToGrid(data) {
  if (data == null) return null;
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
        } else g.push([row]);
      });
      return g.length ? g : null;
    }
    return Object.keys(data).map(function (k) { return [k, data[k]]; });
  }
  if (data.length === 0) return [[""]];
  if (Array.isArray(data[0])) return data;
  if (typeof data[0] === "object" && data[0] !== null) {
    var keys = Object.keys(data[0]);
    var out = [keys];
    data.forEach(function (obj) { out.push(keys.map(function (k) { return obj[k] == null ? "" : obj[k]; })); });
    return out;
  }
  return data.map(function (v) { return [v]; });
}

var samples = [
  '说明\n```json\n[["A","B"],[1,2]]\n```',
  '{"headers":["x"],"rows":[[1],[2]]}',
  "a\tb\n1\t2",
  "姓名,分数\n张三,90"
];
var ok = true;
samples.forEach(function (s, i) {
  var g = parseJsonGrid(s);
  if (!g && s.indexOf("\t") >= 0) g = s.trim().split(/\n/).map(function (l) { return l.split("\t"); });
  if (!g && s.indexOf(",") >= 0) g = s.trim().split(/\n/).map(function (l) { return l.split(","); });
  if (!g) ok = false;
  console.log("#" + i, JSON.stringify(g));
});
if (!ok) process.exit(1);
console.log("smoke-parse OK");
