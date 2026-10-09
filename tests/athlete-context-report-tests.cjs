"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto });
context.window = context;
for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`, "utf8"), context);
const M = context.RingsideModel, R = context.RingsideReport;
let passed = 0;
const test = (name, run) => { run(); passed++; console.log("PASS " + name); };
const render = record => R.render(R.build(record));
const appendix = html => html.match(/<details[^>]*id="trials-hop"[\s\S]*?<\/details>/)?.[0] || "";

test("empty selected Hop placeholders produce no result, ability group, chart or appendix", () => {
  for (const mode of ["summary", "jumps"]) {
    const record = M.defaults(); record.data.hop.inputMode = mode;
    const before = JSON.stringify(record), report = R.build(record), html = R.render(report);
    assert.equal(report.stats.validTests.has("hop"), false);
    assert.equal(report.stats.raw.hop.row, null);
    assert.doesNotMatch(html, /detail-hop|trials-hop|<h3>反应力量<\/h3>|data-capability-card="reactive"/);
    assert.equal(JSON.stringify(record), before);
  }
});

test("blank Hop does not join other measured jump results", () => {
  const record = M.defaults(); record.data.cmj[0].height = 30;
  const html = render(record);
  assert.match(html, /data-metric-id="cmj_height"/);
  assert.doesNotMatch(html, /detail-hop|trials-hop|10\/5 Hop Test 连续反应跳/);
});

test("Hop retains partial summary values, whole-test stiffness, explicit counts and notes", () => {
  for (const apply of [
    record => { record.data.hop.summary.height = 25; },
    record => { record.data.hop.summary.activeStiffness = 31; },
    record => { record.data.hop.summary.suppliedCount = 0; },
    record => { record.data.hop.notes = "实际测试备注"; },
    record => { record.data.hop.summary.notes = "设备结果备注"; },
  ]) {
    const record = M.defaults(); apply(record);
    const html = render(record);
    assert.match(html, /detail-hop/);
    assert.match(appendix(html), /完整测试结果 · 共 1 次/);
  }
  const record = M.defaults(); record.data.hop.summary.activeStiffness = 31;
  assert.equal(R.build(record).stats.values.hop_active_stiffness, 31);
  assert.match(render(record), /data-capability-metric="hop_active_stiffness"/);
});

test("Hop retains incomplete process measurements and process notes without inventing RSI", () => {
  for (const apply of [
    row => { row.height = 25; },
    row => { row.contactTimeMs = 200; },
    row => { row.flightTimeMs = 500; },
    row => { row.notes = "尚未完成的跳次"; },
  ]) {
    const record = M.defaults(); record.data.hop.inputMode = "jumps"; apply(record.data.hop.jumps[0]);
    const report = R.build(record), html = R.render(report);
    assert.equal(report.stats.values.hop_rsi, undefined);
    assert.match(appendix(html), /完整测试结果 · 共 1 次/);
    assert.equal(report.record.data.hop.jumps.length, 1);
  }
});

test("blank groups are excluded from whole-test counts without renumbering entered groups", () => {
  const record = M.defaults(), first = M.newHopSet(), blank = M.newHopSet(), third = M.newHopSet();
  first.summary.rsi = 2; third.summary.rsi = 2.4;
  record.data.hop.trials = [first, blank, third];
  const before = JSON.stringify(record), report = R.build(record), html = R.render(report), raw = appendix(html);
  assert.match(raw, /完整测试结果 · 共 2 次/);
  assert.match(raw, /data-label="完整测试"><div class="result-cell">1<\/div>/);
  assert.match(raw, /data-label="完整测试"><div class="result-cell">3<\/div>/);
  assert.ok(raw.includes('data-metric-id="hop-set-' + first.id + '"'));
  assert.ok(raw.includes('data-metric-id="hop-set-' + third.id + '"'));
  assert.ok(!raw.includes('data-metric-id="hop-set-' + blank.id + '"'));
  assert.equal(report.stats.raw.hop.row.rsi, 2.4);
  assert.equal(JSON.stringify(record), before);
});

test("clearing final Hop measurements removes its report while leaving the entry placeholders intact", () => {
  const record = M.defaults(); record.data.hop.summary.rsi = 2;
  assert.match(render(record), /trials-hop/);
  record.data.hop.summary.rsi = "";
  assert.doesNotMatch(render(record), /detail-hop|trials-hop/);
  assert.equal(record.data.hop.jumps.length, 1);
});

test("performance test heading changes without changing stable anchors or category keys", () => {
  const record = M.defaults(); record.data.cmj[0].height = 30;
  const report = R.build(record), html = R.render(report);
  assert.match(html, /id="performanceDetail" open><summary>运动表现测试<span>/);
  assert.match(html, /id="screenDetail" open><summary>损伤风险筛查/);
  assert.equal(report.projects.find(test => test.id === "cmj").category, "performance");
});

console.log(`${passed} athlete context report checks passed`);
