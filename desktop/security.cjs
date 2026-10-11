"use strict";
const path = require("node:path");
const APP_ORIGIN = "motionbench://app";
const APP_URL = APP_ORIGIN + "/MotionBench.html";
// The existing offline UI uses inline event handlers. Keep those compatible,
// while denying remote scripts, eval, remote connections and embedded objects.
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob: about:; object-src 'none'; base-uri 'none'; form-action 'none'";
function isAppURL(value) {
  try { const u = new URL(value); return u.protocol === "motionbench:" && u.hostname === "app" && !u.port && !u.username && !u.password; }
  catch { return false; }
}
function externalURL(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
function safeFilename(value) {
  let name = path.basename(String(value || "MotionBench-export").replace(/\\/g, "/"))
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/[ .]+$/, "");
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "MotionBench_" + (name || "export");
  // Keep the type suffix when shortening imported names, so Windows retains
  // its file association and the native dialog can offer the correct filter.
  const extension = path.extname(name);
  const suffix = extension.length <= 20 ? extension : "";
  const stem = name.slice(0, name.length - suffix.length);
  name = stem.slice(0, 180 - suffix.length).replace(/[\uD800-\uDBFF]$/, "") + suffix;
  return name;
}
function exportFilters(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  const types = { pdf: "PDF 报告", xlsx: "Excel 工作簿", jsonl: "MotionBench 完整备份", json: "JSON 数据", html: "HTML 报告" };
  return types[ext] ? [{ name: types[ext], extensions: [ext] }] : [];
}
module.exports = { APP_ORIGIN, APP_URL, CSP, isAppURL, externalURL, safeFilename, exportFilters };
