"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "interventions", "viz", "report"]) vm.runInContext(fs.readFileSync(path.join(root, "src/ringside-" + name + ".js"), "utf8"), c);
const M = c.RingsideModel, E = c.RingsideEvaluation, R = c.RingsideReport, V = c.RingsideViz;
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
function fixture() {
  const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = ["cmj", "sj"].includes(id)); r.data.cmj = [{ id: "c", height: 40 }]; r.data.sj = [{ id: "s", height: 30 }];
  const p = E.create(r); p.aggregations = { "ability:下肢爆发力": { method: "primary", primary: "metric:cmj_height", scoringVersion: 1, transforms: { "metric:cmj_height": { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] } } } };
  Object.assign(p.standards.find(rule => rule.metricId === "cmj_height"), { enabled: true, targetEnabled: true, target: 50, rangesEnabled: true, ranges: [{ min: 0, max: null, status: "green", label: "用户等级" }] });
  return { r, p };
}
test("primary conversion and raw metric grade remain correct after the calculation details API is removed", () => {
  const { r, p } = fixture(), report = R.build(E.resolve(r, p)), html = R.render(report);
  assert.equal(report.stats.axes[0].value, 50); assert.equal(report.stats.axes[0].scores[0], 50);
  const measured = report.stats.evaluationResults.find(item => item.metricId === "cmj_height");
  assert.equal(measured.value, 40); assert.equal(measured.grade.label, "用户等级");
  assert.equal(R.abilityDetails, undefined); assert.doesNotMatch(html, /ability-score-details|data-ability-score|查看能力评分的计算/);
});
test("mean scoring keeps all fixed member scores and the neutral grade without a calculation module", () => {
  const { r, p } = fixture(); p.aggregations["ability:下肢爆发力"] = { method: "mean", members: ["metric:cmj_height", "metric:sj_height"], transforms: { "metric:cmj_height": { kind: "ratio", direction: "higher" }, "metric:sj_height": { kind: "ratio", direction: "higher" } } };
  Object.assign(p.standards.find(rule => rule.metricId === "sj_height"), { enabled: true, targetEnabled: true, target: 60 });
  const report = R.build(E.resolve(r, p)); assert.equal(report.stats.axes[0].value, 65); assert.equal(report.stats.axes[0].status, "gray");
  assert.deepEqual(JSON.parse(JSON.stringify(report.stats.axes[0].scores)), [80, 50]);
  assert.doesNotMatch(R.render(report), /ability-score-details|data-ability-score|平均贡献/);
});
test("disabled or unconfigured ability emits neither score graph values nor calculation details", () => {
  const { r, p } = fixture(); p.aggregations = {}; const report = R.build(E.resolve(r, p)); assert.equal(report.stats.axes.length, 0); assert.doesNotMatch(R.render(report), /ability-score-details|data-ability-score/);
});
test("both radar and compact ability list use points while raw scientific percentages remain intact", () => {
  const items = ["力量", "速度", "耐力"].map((label, i) => ({ label, value: 50 + i, status: "green", tooltip: "原始成绩" }));
  const radar = V.radar(items), list = V.radar(items.slice(0, 1)); assert.match(radar, /50 分 \/ 100/); assert.match(radar, /50 分 \/ 100 · 原始成绩/); assert.match(list, /50 分 \/ 100/);
  assert.match(V.asymInline(12, "L"), /12%/);
});
test("capability analysis uses a common summary then h3 group and subordinate h4 card hierarchy", () => {
  const { r, p } = fixture(), html = R.renderCapabilityAnalysis(R.build(E.resolve(r, p)));
  assert.match(html, /<summary>能力结构分析<span>/); assert.match(html, /<div class="quality-heading"><h3>发展方向<\/h3><\/div>/); assert.match(html, /class="capability-card-summary"><h4>/); assert.match(html, /class="capability-parameter-heading"><h5>/);
  assert.equal((html.match(/<h3>/g) || []).length, 1); assert.doesNotMatch(html, /capability-region-heading pdf-group-heading/);
});
test("each independent parameter fold remains record-controlled in both web and print renders", () => {
  const { r, p } = fixture(); r.views.capabilityExpanded.strength = true;
  for (const print of [false, true]) { const html = R.renderCapabilityAnalysis(R.build(E.resolve(r, p)), { print }); assert.match(html, /data-capability-parameters="strength" open/); assert.doesNotMatch(html, /data-capability-parameters="reactive" open/); }
});
test("source and PDF headings keep the common theme roles and normal sixteen-pixel type", () => {
  const css = fs.readFileSync(path.join(root, "src/ringside-report-refinement.css"), "utf8"), pdf = fs.readFileSync(path.join(root, "src/ringside-pdf.js"), "utf8");
  assert.match(css, /\.quality-heading \{[^}]*background:#f7f9fc/); assert.match(css, /\.quality-heading h3 \{[^}]*font-size:16px[^}]*color:#45546a/);
  assert.match(pdf, /\.quality-heading h3\{[^}]*font-size:16px!important[^}]*color:\$\{PDF_COLORS\.ink\}!important/);
  assert.doesNotMatch(css, /ability-score-details|abilityScoreDetails/);
});
test("report scoring and heading rendering do not change the raw data stable IDs or manual narrative", () => {
  const { r, p } = fixture(); r.narrative.text = "完整人工正文"; const before = JSON.stringify(r), report = R.build(E.resolve(r, p));
  R.render(report); R.renderCapabilityAnalysis(report); assert.equal(JSON.stringify(r), before); assert.equal(report.record.narrative.text, "完整人工正文");
});
console.log(passed + " report v2.20 model checks passed");
