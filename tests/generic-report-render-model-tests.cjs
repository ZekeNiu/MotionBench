"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "generic-report", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const M = c.RingsideModel, E = c.RingsideEvaluation, G = c.RingsideGenericReport, V = c.RingsideViz, R = c.RingsideReport, copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const test = (name, run) => { run(); passed++; console.log("PASS " + name); };
function fixture() {
  const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = false);
  r.customTests.push({ id: "render_generic", name: "通用图表核验项目", category: "performance", primaryMetricId: "render_x", selectionDirection: "higher" }); r.enabled.render_generic = true;
  for (const [id, name, unit] of [["render_x", "横轴指标", "cm"], ["render_y", "纵轴指标", "N"], ["render_z", "第三指标", "cm"], ["render_memo", "记录指标", "cm"]])
    r.definitions.push({ id, testId: "render_generic", name, unit, protocol: "同次配对", direction: "higher", category: "performance", ability: "速度", ranges: [], target: 100, referenceEnabled: true,
      entryScope: id === "render_memo" ? "record" : "attempt", measurementScale: "ratio", zeroValid: true });
  r.data.render_generic = [{ id: "render_a", metrics: { render_x: 10, render_y: 100, render_z: 30 } }, { id: "render_b", metrics: { render_x: 20, render_y: 50, render_z: 40 } }];
  r.customValues.render_memo = { value: 7, notes: "保留完整右表备注" }; r.narrative.text = "保留人工正文";
  const record = M.normalizeRecord(r), catalog = M.mergeCatalog(null, record);
  return { record, catalog };
}
function reportFor(record, catalog, kind, metricIds, options = {}) {
  catalog.reportViews = { render_generic: G.createView(catalog, "render_generic", { kind, metricIds, ...options }) };
  return R.build(record, { catalog });
}
const svgCount = html => (html.match(/<svg /g) || []).length;
test("a live style creates left chart and right full table while preserving all results and record notes", () => {
  const { record, catalog } = fixture(), before = JSON.stringify(record), fingerprint = M.fingerprint(record), report = reportFor(record, catalog, "bar", ["render_x"]), html = R.render(report);
  assert.match(html, /class="detail-pair generic-detail" data-pdf-pair/); assert.match(html, /chart-wrap adaptive-chart generic-charts/);
  assert.ok(html.indexOf('data-chart-kind="generic"') < html.indexOf('class="detail-data"'));
  for (const id of ["render_x", "render_y", "render_z", "render_memo"]) assert.match(html, new RegExp('data-metric-id="' + id + '"'));
  assert.match(html, /保留完整右表备注/); assert.match(html, /原始试次/); assert.equal(svgCount(html), 1);
  assert.equal(JSON.stringify(record), before); assert.equal(M.fingerprint(record), fingerprint); assert.equal(report.record.narrative.text, "保留人工正文");
});
test("compatible live style changes and explicit disabling keep the raw results unchanged", () => {
  const { record, catalog } = fixture(), before = copy(M.stats(record).values);
  const bar = reportFor(record, catalog, "bar", ["render_x"]); G.freezeViews(record, catalog);
  const columns = reportFor(record, catalog, "column", ["render_z", "render_x"]); assert.equal(columns.projects[0].reportView.kind, "column");
  assert.deepEqual(copy(columns.stats.values), before); assert.deepEqual(copy(bar.stats.values), before);
  const off = reportFor(record, catalog, "none", []), html = R.render(off); assert.equal(off.projects[0].reportView.kind, "none"); assert.equal(svgCount(html), 0); assert.match(html, /保留完整右表备注/);
});
test("raw-value column and bar charts split exact units and never combine cm with N", () => {
  for (const kind of ["bar", "column"]) {
    const { record, catalog } = fixture(), report = reportFor(record, catalog, kind, ["render_y", "render_x", "render_z"]), model = G.buildChart(report, report.projects[0]), html = R.render(report);
    assert.deepEqual(copy(model.panels.map(panel => panel.unit)), ["N", "cm"]); assert.equal(svgCount(html), 2);
    assert.deepEqual(copy(model.panels.map(panel => panel.items.map(item => item.value))), [[50], [20, 40]]);
  }
});
test("trial point charts retain each genuine trial index and measured values", () => {
  const { record, catalog } = fixture(), report = reportFor(record, catalog, "trials", ["render_x", "render_y"]), model = G.buildChart(report, report.projects[0]), html = R.render(report);
  assert.deepEqual(copy(model.panels[0].series[0].points.map(point => [point.index, point.value])), [[1, 10], [2, 20]]);
  assert.equal(svgCount(html), 2); assert.match(html, /第 1 次 · 横轴指标：10 cm/); assert.match(html, /第 2 次 · 纵轴指标：50 N/);
});
test("scatter uses same-trial pairs and labels each axis with its own unit", () => {
  const { record, catalog } = fixture(), report = reportFor(record, catalog, "scatter", [], { xMetricId: "render_x", yMetricId: "render_y" }), model = G.buildChart(report, report.projects[0]), html = R.render(report);
  assert.deepEqual(copy(model.panels[0].points.map(point => [point.x, point.y])), [[10, 100], [20, 50]]);
  assert.match(html, /横轴指标 · cm/); assert.match(html, /纵轴指标 · N/); assert.match(html, /第 2 次 · 横轴指标：20 cm · 纵轴指标：50 N/);
  assert.doesNotMatch(html, /横轴指标：20 cm · 纵轴指标：100 N/);
});
test("target comparison renders only currently applicable target values", () => {
  const { record, catalog } = fixture(), profile = E.create(record), resolved = E.resolve(record, profile);
  const report = reportFor(resolved, catalog, "target", ["render_x", "render_memo"]), model = G.buildChart(report, report.projects[0]);
  assert.equal(model.available, true); assert.deepEqual(copy(model.panels[0].items.map(item => item.target)), [100, 100]);
  assert.match(R.render(report), /虚线：目标/); assert.match(R.render(report), /stroke-dasharray="3 2"/);
});
test("unavailable radar keeps the full table and names the local missing scoring rule", () => {
  const { record, catalog } = fixture(), report = reportFor(record, catalog, "radar", ["render_x", "render_y", "render_z"]), model = G.buildChart(report, report.projects[0]), html = R.render(report);
  assert.equal(model.available, false); assert.equal(svgCount(html), 0); assert.match(html, /generic-chart-unavailable/); assert.match(html, /横轴指标/); assert.match(html, /data-metric-id="render_memo"/);
});
test("radar uses existing explicit single metric scores on a fixed zero to one hundred scale", () => {
  const { record, catalog } = fixture(), profile = E.create(record), ids = ["render_x", "render_y", "render_z"];
  profile.aggregations = { "ability:速度": { method: "mean", members: ids.map(id => "metric:" + id), transforms: Object.fromEntries(ids.map(id => ["metric:" + id, { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 100, score: 100 }] }])) } };
  const report = reportFor(E.resolve(record, profile), catalog, "radar", ids), model = G.buildChart(report, report.projects[0]), html = R.render(report);
  assert.equal(model.available, true); assert.deepEqual(copy(model.panels[0].axes.map(axis => axis.value)), [20, 50, 40]);
  assert.equal(svgCount(html), 1); assert.match(html, /评分范围为 0–100 分/); assert.match(html, /20 分/);
});
test("all-zero and negative raw charts preserve their exact values without invalid SVG coordinates", () => {
  for (const kind of ["bar", "column", "target"]) for (const values of [[0, 0], [-10, 0], [-10, 20]]) {
    const html = V.generic({ kind, available: true, panels: [{ title: "N", unit: "N", items: values.map((value, index) => ({ id: "v" + index, label: "指标" + index, value, target: 0 })) }] }, { width: 290 });
    assert.equal(svgCount(html), 1); assert.doesNotMatch(html, /NaN|Infinity/); values.forEach(value => assert.ok(html.includes("：" + value + " N")));
    const widths = [...html.matchAll(/<rect [^>]*width="([\d.-]+)"/g)].map(match => Number(match[1])); assert.ok(widths.every(width => width >= 0));
  }
});
test("large unit groups paginate as compact chart panels with a shared scale and no duplicated selected metric", () => {
  const items = Array.from({ length: 21 }, (_, index) => ({ id: "many" + index, label: "较长指标名称用于验证连续分图" + index, value: index * 7 }));
  const html = V.generic({ kind: "bar", available: true, panels: [{ title: "N", unit: "N", items }] }, { width: 350 });
  assert.equal(svgCount(html), 4); assert.equal((html.match(/data-pdf-atomic/g) || []).length, 4);
  for (const item of items) assert.equal((html.match(new RegExp('data-generic-metric="' + item.id + '"', "g")) || []).length, 1);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
test("available charts still state omitted selected metrics without adding placeholder values", () => {
  const html = V.generic({ kind: "bar", available: true, reason: "指标乙缺少有效结果", panels: [{ title: "N", unit: "N", items: [{ id: "a", label: "指标甲", value: 5 }] }] });
  assert.match(html, /generic-chart-omissions/); assert.match(html, /指标乙缺少有效结果/); assert.equal((html.match(/data-generic-metric/g) || []).length, 1);
});
console.log(passed + " generic report render model checks passed");
