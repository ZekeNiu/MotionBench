"use strict";
const assert = require("node:assert/strict");
const {APP_URL,CSP,isAppURL,externalURL,safeFilename,exportFilters} = require("../desktop/security.cjs");
assert.ok(isAppURL(APP_URL));
for(const url of ["file:///etc/passwd","https://app/MotionBench.html","motionbench://app.evil/x","motionbench://user@app/x","motionbench://app:999/x","javascript:alert(1)"])assert.equal(isAppURL(url),false,url);
assert.equal(externalURL("https://example.org/paper"),"https://example.org/paper");
for(const url of ["file:///C:/Windows/System32/cmd.exe","https://user:password@example.org","http://example.org","javascript:alert(1)","ms-settings:privacy"])assert.equal(externalURL(url),null,url);
assert.equal(safeFilename("../../report.pdf"),"report.pdf");
assert.equal(safeFilename("..\\..\\report.pdf"),"report.pdf");
assert.equal(safeFilename("CON.pdf"),"MotionBench_CON.pdf");
assert.equal(safeFilename("a<b>.pdf"),"a_b_.pdf");
for (const extension of ["pdf", "xlsx", "jsonl", "html"]) {
  const shortened = safeFilename("MotionBench_" + "测".repeat(180) + "_2026-10-11_r12345." + extension);
  assert.ok(shortened.length <= 180, "the native filename remains bounded");
  assert.ok(shortened.endsWith("." + extension), "long imported names retain the " + extension + " type suffix");
  assert.deepEqual(exportFilters(shortened)[0].extensions, [extension], "the correct native file filter survives shortening");
}
assert.ok(!/[\uD800-\uDBFF]$/.test(safeFilename("😀".repeat(120) + ".xlsx").slice(0, -5)), "shortening does not split a surrogate pair");
assert.deepEqual(exportFilters("backup.motionbench.jsonl"),[{name:"MotionBench 完整备份",extensions:["jsonl"]}]);
assert.ok(CSP.includes("connect-src 'self'"));
assert.ok(!CSP.includes("unsafe-eval"));
console.log("Desktop URL, external-link and export-path boundary checks passed");
