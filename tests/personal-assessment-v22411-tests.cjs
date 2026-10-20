"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "fvp", "sprint-fvp", "sprint-elasticity", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions", "viz", "report", "result-display"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c, { filename: name });
const M = c.RingsideModel, R = c.RingsideReport, D = c.Def;
const only = (...ids) => { const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = ids.includes(id)); return r; };
const detail = (html, id) => html.match(new RegExp('<article[^>]*id="detail-' + id + '"[^>]*>[\\s\\S]*?<\\/article>'))?.[0] || "";
const row = (html, id) => html.match(new RegExp('<tr[^>]*data-metric-id="' + id + '"[^>]*>[\\s\\S]*?<\\/tr>'))?.[0] || "";
let passed = 0; const test = (name, run) => { run(); passed++; console.log("PASS " + name); };

test("personal FMS uses fixed traffic labels without changing score aggregation or pain evidence", () => {
  const r = only("fms");
  r.data.fms.forEach((item, index) => Object.assign(item, { left: 3, right: 3, score: 3, pain: false, notes: "原始备注 " + index }));
  Object.assign(r.data.fms[0], { score: 1 });
  Object.assign(r.data.fms[1], { left: 2, right: 3 });
  Object.assign(r.data.fms[2], { left: 3, right: 3, pain: true });
  Object.assign(r.data.fms[3], { left: "", right: 3 });
  Object.assign(r.data.fms[4], { left: 0, right: 3 });
  const before = JSON.stringify(r), report = R.build(r), html = detail(R.render(report), "fms");
  assert.ok(html);
  const rows = [...html.matchAll(/<tbody>[\s\S]*?<\/tbody>/g)][0][0].match(/<tr>[\s\S]*?<\/tr>/g);
  const expectations = [["amber", "关注"], ["amber", "关注"], ["red", "预警"], [null, null], ["red", "预警"], ["green", "优秀"], ["green", "优秀"]];
  rows.forEach((value, index) => {
    const assessment = value.match(/<td data-label="评价">([\s\S]*?)<\/td>/)[1];
    const [status, label] = expectations[index];
    if (status) { assert.match(assessment, new RegExp('class="pill ' + status + '"')); assert.ok(assessment.includes(label)); }
    else assert.doesNotMatch(assessment, /class="pill/);
    assert.ok(value.includes("原始备注 " + index));
  });
  assert.doesNotMatch(rows.join(""), /未完成动作|代偿完成|符合标准/);
  assert.match(rows[2], /data-label="左／右或单项">3 \/ 3/);
  assert.match(rows[2], /data-label="疼痛">.*pill red/);
  assert.deepEqual(Array.from(report.stats.raw.fms.scores), [1, 2, 0, null, 0, 3, 3]);
  assert.equal(JSON.stringify(r), before);
});

test("lactate omits unclassified and disabled placeholders while preserving measurements and reference definitions", () => {
  for (const enabled of [true, false]) {
    const r = only("lactate"); r.thresholds.method = "manual"; r.thresholds.lt1 = 3.25; r.thresholds.lt2 = 4.25;
    for (const definition of r.definitions.filter(d => d.testId === "lactate")) Object.assign(definition, { referenceEnabled: enabled, targetEnabled: true,
      ranges: D.parseRanges("<3 | 低段 | red\n>=5 | 高段 | green") });
    const before = JSON.stringify(r), report = R.build(r), html = detail(R.render(report), "lactate");
    assert.ok(row(html, "lt1")); assert.match(row(html, "lt1"), /3\.25/); assert.match(row(html, "lt2"), /4\.25/);
    assert.doesNotMatch(html, /class="pill|未分级|未启用评价标准/);
    assert.equal(JSON.stringify(r), before);
    assert.equal(report.projects[0].metrics[0].evaluation.range, null);
  }
});

test("lactate keeps actual custom gray grades regardless of wording and keeps target-only grades", () => {
  for (const label of ["自定灰色参考", "未分级", "未启用评价标准", "未设等级区间"]) {
    const r = only("lactate"); r.thresholds.method = "manual"; r.thresholds.lt1 = 3.25;
    const definition = r.definitions.find(d => d.id === "lt1");
    Object.assign(definition, { referenceEnabled: true, target: 4, ranges: D.parseRanges("3..4 | " + label + " | gray") });
    const before = JSON.stringify(r), html = detail(R.render(R.build(r)), "lactate");
    assert.match(row(html, "lt1"), /class="pill gray"/); assert.ok(row(html, "lt1").includes(label));
    assert.equal(JSON.stringify(r), before);
  }
  const r = only("lactate"); r.thresholds.method = "manual"; r.thresholds.lt1 = 3.25;
  Object.assign(r.definitions.find(d => d.id === "lt1"), { referenceEnabled: true, targetEnabled: true, target: 3.25, ranges: [] });
  const html = detail(R.render(R.build(r)), "lactate"); assert.match(row(html, "lt1"), /class="pill green"/);
});

test("personal projects outside lactate retain their existing unclassified display contract", () => {
  const r = only("pushup"); r.data.pushup.reps = 70;
  const definition = r.definitions.find(d => d.id === "pushup_reps");
  Object.assign(definition, { referenceEnabled: true, ranges: D.parseRanges("<60 | 低段 | red\n>=80 | 高段 | green") });
  const html = detail(R.render(R.build(r)), "pushup"); assert.match(row(html, "pushup_reps"), /class="pill gray"[^>]*>.*未分级/);
});
console.log(passed + " personal assessment v2.24.11 checks passed");
