"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), modules = ["calc", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions", "viz", "report"];
const context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); context.window = context;
for (const name of modules) vm.runInContext(fs.readFileSync(path.join(root, `src/ringside-${name}.js`), "utf8"), context);
const M = context.RingsideModel, R = context.RingsideReport, V = context.RingsideViz;
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
const groups = [["cmj", "sj"], ["dj"], ["mas", "mss"], ["cpet"]];
function fixture(count) {
  const record = M.sampleRecord(), enabled = new Set(groups.slice(0, count).flat());
  for (const id of Object.keys(record.enabled)) record.enabled[id] = enabled.has(id);
  record.views.capabilitySelections = { strength: "eur", reactive: "dj_rsi", speed: "srr" };
  return record;
}
test("zero through four categories render only data-bearing cards and expose the actual count", () => {
  for (let count = 0; count <= 4; count++) {
    const report = R.build(fixture(count)), html = R.renderCapabilityAnalysis(report);
    assert.equal((html.match(/data-capability-direction=/g) || []).length, count);
    if (count) assert.ok(html.includes(`data-capability-count="${count}"`));
    else assert.equal(html, "");
  }
});
test("an explicit unavailable FVP basis keeps a category with valid EUR parameters", () => {
  const record = fixture(1); record.views.capabilitySelections.strength = "fvp";
  const html = R.renderCapabilityAnalysis(R.build(record));
  assert.match(html, /data-capability-direction="strength"/);
  assert.match(html, /data-direction-metric="fvp"/);
  assert.match(html, /待计算/);
  assert.match(html, /data-capability-metric="eur"/);
});
test("action titles use h4 while capability bands retain h3 and test IDs remain intact", () => {
  const record = M.sampleRecord(), html = R.render(R.build(record));
  assert.match(html, /class="quality-heading"><h3>/);
  assert.match(html, /class="test-title"><div><h4>跳跃测试<\/h4>/);
  assert.doesNotMatch(html, /class="test-title">(?:<div>)?<h3>/);
  assert.match(html, /data-test-ids="cmj sj dj hop cmrj"/);
});
test("status fallback colors equal the existing evaluation CSS tokens", () => {
  const css = fs.readFileSync(path.join(root, "src/ringside.css"), "utf8");
  for (const status of ["red", "amber", "green", "gray"]) {
    const value = css.match(new RegExp(`--${status}:\\s*(#[a-f0-9]+);`))[1];
    assert.equal(V.C[status], value, status);
  }
});
test("SVG status attributes resolve the evaluation stylesheet rather than duplicate its palette", () => {
  const palette = { "--red": "#a11223", "--amber": "#bb8822", "--green": "#12754a", "--gray": "#747474" };
  const themed = vm.createContext({ document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: key => palette[key] || "" }) }); themed.window = themed;
  vm.runInContext(fs.readFileSync(path.join(root, "src/ringside-definitions.js"), "utf8"), themed);
  vm.runInContext(fs.readFileSync(path.join(root, "src/ringside-viz.js"), "utf8"), themed);
  for (const status of ["red", "amber", "green", "gray"]) assert.equal(themed.RingsideViz.C[status], palette["--" + status]);
  const html = themed.RingsideViz.body({ shoulder_l: { status: "amber", hasMeasured: true } });
  assert.match(html, /fill="#bb8822"/); assert.doesNotMatch(html, /fill="var\(/);
});
test("all chart widths use ID-based short jump names while full names remain accessible", () => {
  const names = { cmj: "CMJ 完整展示名称", sj: "SJ 完整展示名称", dj: "DJ 下落跳", hop: "10/5 Hop Test 连续反应跳", cmrj: "CMRJ 反向反弹跳" };
  for (const width of [240, 320, 479, 480, 487, 600, 740]) {
    const html = V.jumpBars(Object.entries(names).map(([id, label]) => ({ id, label, value: 35, rsi: 1.8 })), { width });
    for (const [id, label] of Object.entries(names)) {
      assert.ok(html.includes(`data-jump-label="${id}" aria-label="${label}"`));
      assert.ok(html.includes(`${label} · 垂直跳跃高度`));
    }
    assert.equal((html.match(/data-jump-label=/g) || []).length, 5);
  }
});
console.log(`${passed} layout model checks passed`);
