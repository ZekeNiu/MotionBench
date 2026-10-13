"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "generic-report", "model", "evaluation", "interventions", "viz", "report", "comparison", "comparison-report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const M = c.RingsideModel, G = c.RingsideGenericReport, C = c.RingsideComparison, R = c.RingsideComparisonReport, plain = v => JSON.parse(JSON.stringify(v));
let passed = 0;
const test = (name, run) => { run(); passed++; console.log("PASS " + name); };
const finite = html => assert.doesNotMatch(html, /NaN|Infinity/);
const dates = ["2026-07-01", "2026-07-08", "2026-08-12"];
function fixture({ athletes = 3, periods = 3, missing = false, fms = false, genericKind = "", negative = false } = {}) {
  const list = Array.from({ length: athletes }, (_, index) => ({ id: "a" + index, name: "队员" + (index + 1), profile: {}, records: [] }));
  let catalog;
  list.forEach((a, i) => dates.slice(0, periods).forEach((date, d) => {
    if (missing && i === athletes - 1 && d === periods - 1) return;
    let r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = id === "cmj" || fms && id === "fms");
    r.athlete.name = a.name; r.athlete.date = date; r.athlete.mass = 70; r.athlete.sex = "男";
    r.data.cmj = [{ id: a.id + d + "-1", height: 30 + i * 4 + d * (i + 1) }, { id: a.id + d + "-2", height: 35 + i * 4 + d * (i + 1) }];
    if (fms) r.data.fms.forEach((item, j) => { if (item.bilateral) { item.left = j === 1 && d === 2 ? 1 : 2; item.right = 3; } else item.score = j === 0 && i === 0 ? 0 : 3; item.pain = j === 0 && i === 0; item.notes = "原始动作备注"; });
    if (genericKind) {
      r.customTests.push({ id: "generic_cmp", name: "配对图样", category: "performance", primaryMetricId: "cx", selectionDirection: "higher" }); r.enabled.generic_cmp = true;
      for (const [id, name, unit] of [["cx", "横轴实测", "cm"], ["cy", "纵轴实测", "N"], ["cz", "第三指标", "cm"]]) r.definitions.push({ id, testId: "generic_cmp", name, unit, protocol: "同次配对", direction: "higher", category: "performance", ability: "速度", entryScope: "attempt", measurementScale: "ratio", target: 100, referenceEnabled: true, ranges: [], zeroValid: true });
      r.data.generic_cmp = [{ id: "trial1", metrics: { cx: negative ? -10 : 10, cy: 100, cz: 20 } }, { id: "trial2", metrics: { cx: 20, cy: 50, cz: 40 } }];
      r = M.normalizeRecord(r); catalog = M.mergeCatalog(null, r); catalog.reportViews = { generic_cmp: G.createView(catalog, "generic_cmp", { kind: genericKind, metricIds: ["cx", "cy", "cz"], ...(genericKind === "scatter" ? { xMetricId: "cx", yMetricId: "cy" } : {}) }) };
      G.freezeViews(r, catalog);
      if (genericKind === "radar") {
        const profile = c.RingsideEvaluation.create(r);
        profile.aggregations = { "ability:速度": { method: "mean", members: ["metric:cx", "metric:cy", "metric:cz"], transforms: Object.fromEntries(["cx", "cy", "cz"].map(id => ["metric:" + id, { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 100, score: 100 }] }])) } };
        r = c.RingsideEvaluation.resolve(r, profile);
      }
    }
    r.recordId = a.id + "-" + d; r.athleteId = a.id; a.records.push(r);
  }));
  const input = { athletes: list, catalog: catalog || {} }, selection = { athleteIds: list.map(a => a.id), dates: dates.slice(0, periods), recordChoices: {} };
  const model = C.deriveComparison(input, selection); if (catalog) model.catalog = catalog;
  return model;
}
test("team report draws each athlete while its statistics count athletes once", () => {
  const model = fixture({ periods: 1 }), metric = model.metrics.find(m => m.id === "cmj_height"), html = R.metricChart(model, metric);
  assert.equal(metric.periods[0].n, 3); assert.equal((html.match(/class="viz-point comparison-series"/g) || []).length, 3);
  assert.match(html, /均值 ± 样本 SD/); assert.match(html, /n=3/); assert.match(html, /队员1/); finite(html);
});
test("longitudinal trend uses only the fixed complete cohort and true date intervals", () => {
  const model = fixture({ missing: true }), metric = model.metrics.find(m => m.id === "cmj_height"), html = R.trendChart(model, metric);
  assert.deepEqual(plain(metric.cohortIds), ["a0", "a1"]); assert.match(html, /固定队员 n=2/); assert.doesNotMatch(html, /data-athlete-id="a2"/);
  const markers = [...html.matchAll(/<g class="viz-point comparison-series" data-athlete-id="a0"[^>]*><circle cx="([\d.]+)"/g)].map(m => +m[1]);
  assert.equal(markers.length, 3); assert.ok(Math.abs((markers[1] - markers[0]) / (markers[2] - markers[0]) - 7 / 42) < .001); assert.match(html, /comparison-trend-fit/); finite(html);
});
test("two dates preserve the measured connector without a fitted trend", () => {
  const model = fixture({ periods: 2 }), metric = model.metrics.find(m => m.id === "cmj_height"), html = R.trendChart(model, metric);
  assert.match(html, /实线连接两期实测结果/); assert.doesNotMatch(html, /comparison-trend-fit/); finite(html);
});
test("team longitudinal table reports unchanged independently computed inference", () => {
  const model = fixture(), metric = model.metrics.find(m => m.id === "cmj_height"), before = JSON.stringify(model), views = R.preferences(model), html = R.render(model, views);
  assert.match(html, /Cohen’s dz/); assert.match(html, /Holm p/); assert.match(html, /变化95% CI/); assert.match(html, /单项未校正/);
  assert.ok(html.includes(Number(metric.changes[0].dz.toFixed(3)).toLocaleString("zh-CN"))); assert.equal(JSON.stringify(model), before); finite(html);
});
test("personal longitudinal tables omit team significance and effect sizes", () => {
  const html = R.render(fixture({ athletes: 1 })); assert.match(html, /个人纵向报告/); assert.match(html, /相对基线变化/); assert.doesNotMatch(html, /Cohen’s dz|Holm p/); finite(html);
});
test("switching to personal details retains missing rows and explicit record editing", () => {
  const model = fixture({ missing: true }), views = R.preferences(model); views.projects.cmj.tableMode = "individual";
  const html = R.render(model, views); assert.match(html, /本日没有有效记录/); assert.match(html, /data-comparison-edit-record="a0-0"/); assert.match(html, /data-comparison-highlight="a2"/); finite(html);
});
test("zero and signed values retain valid geometry for all representative chart forms", () => {
  const model = fixture({ periods: 1 }), metric = model.metrics.find(m => m.id === "cmj_height"); metric.observations.forEach((o, i) => o.value = [-10, 0, 20][i]); metric.periods = [{ date: model.dates[0], n: 3, mean: 10 / 3, sd: 15 }];
  for (const kind of ["bar", "column", "target"]) { const html = R.metricChart(model, metric, kind); finite(html); assert.match(html, /：-10/); assert.match(html, /：0/); const widths = [...html.matchAll(/<rect[^>]* width="([\d.-]+)"/g)].map(m => +m[1]); assert.ok(widths.every(v => v >= 0)); }
});
test("missing mean rows never produce invented zero lines", () => {
  const model = fixture({ periods: 1 }), metric = model.metrics.find(m => m.id === "cmj_height"); metric.periods = [{ date: model.dates[0], n: 0, mean: null, sd: null }];
  const html = R.metricChart(model, metric); finite(html); assert.doesNotMatch(html, /class="comparison-mean"/);
});
test("small RSI values retain distinct positioned axis ticks", () => {
  const model = fixture({ periods: 1 }), metric = model.metrics.find(m => m.id === "cmj_height");
  metric.observations.forEach((observation, index) => observation.value = [0.501, 0.505, 0.509][index]); metric.periods = [{ date: model.dates[0], n: 3, mean: .505, sd: .004 }];
  const ticks = [...R.metricChart(model, metric).matchAll(/<text[^>]*class="comparison-y-tick"[^>]*>([^<]+)<\/text>/g)].map(match => Number(match[1]));
  assert.equal(ticks.length, 5); assert.equal(new Set(ticks).size, 5); assert.ok(ticks.every((value, index) => !index || value > ticks[index - 1])); assert.ok(ticks[0] < .501 && ticks[4] > .509);
});
test("negative load velocity slopes keep distinct ticks and never show negative zero", () => {
  const model = fixture({ periods: 1 }), metric = model.metrics.find(m => m.id === "cmj_height");
  metric.observations.forEach((observation, index) => observation.value = [-.0012, -.0008, -.0004][index]); metric.periods = [{ date: model.dates[0], n: 3, mean: -.0008, sd: .0004 }];
  const labels = [...R.metricChart(model, metric).matchAll(/<text[^>]*class="comparison-y-tick"[^>]*>([^<]+)<\/text>/g)].map(match => match[1]), ticks = labels.map(Number);
  assert.equal(ticks.length, 5); assert.equal(new Set(ticks).size, 5); assert.ok(ticks.every(value => value <= 0)); assert.ok(ticks.some(value => value < -.0012)); assert.ok(labels.every(value => value !== "-0"));
});
test("small nonzero changes confidence bounds and distribution values remain visible without changing model data", () => {
  const model = fixture({ periods: 2 }), metric = model.metrics.find(m => m.id === "cmj_height"), views = R.preferences(model);
  metric.periods.forEach(period => { period.mean = -.00084; period.sd = .00084; period.median = -.00084; period.q1 = -.00168; period.q3 = .00084; period.iqr = .00252; });
  metric.changes[0].delta = .00084; metric.changes[0].ciLow = -.00084; metric.changes[0].ciHigh = .00084;
  metric.observations[0].value = .00084; metric.observations[1].value = -.00084; metric.observations[2].value = -0; views.projects.cmj.expanded = true;
  const before = JSON.stringify(model), html = R.render(model, views); assert.match(html, /-0\.00084 ± 0\.00084/); assert.match(html, /\+0\.00084/); assert.match(html, /\[-0\.00084, 0\.00084\]/); assert.doesNotMatch(html, /\[-0, 0\]/); assert.equal(JSON.stringify(model), before);
  views.projects.cmj.tableMode = "individual"; const detail = R.render(model, views); assert.match(detail, /0\.00084/); assert.match(detail, /-0\.00084/); assert.doesNotMatch(detail, />-0<\/td>/);
  metric.periods[0].sd = 1.23e-14; metric.periods[1].sd = 0; const tiny = R.render(model, R.preferences(model)); assert.match(tiny, /1\.23e-14/); assert.match(tiny, /-0\.00084 ± 0</); finite(tiny);
});
test("team screening radar shows each athlete's original ordinal status with one date selected", () => {
  const model = fixture(); model.summary.periods = dates.map((date, index) => ({ date, regions: [{ key: "knee_r", n: 3, redCount: 1, amberCount: 1, greenCount: index === 0 ? 1 : 0, members: ["red", "amber", index === 0 ? "green" : "gray"].map((status, i) => ({ athleteId: "a" + i, recordId: "a" + i + "-" + index, status, tests: [{ name: "原始测试", value: 0, pain: i === 0, notes: "原始备注" }] })) }] }));
  const html = R.body(model); assert.equal((html.match(/<svg /g) || []).length, 1); assert.doesNotMatch(html, /comparison-body-facets|身体区域筛查|comparison-screening-bar|0–100%|占可判定人数/); assert.equal((html.match(/class="viz-region comparison-screening-row/g) || []).length, 3); assert.match(html, /data-screening-date="2026-08-12"/); assert.match(html, /data-status="red" data-value="1"/); assert.match(html, /data-status="amber" data-value="2"/); assert.match(html, /data-status="gray" data-value=""/); assert.match(html, /原始备注/); assert.match(html, /队员1 · 原始测试/); assert.match(html, /data-record-id="a0-2"/); finite(html);
  const unknown = html.match(/<g class="viz-region comparison-screening-row[^>]*data-status="gray"[\s\S]*?<\/g>/)[0]; assert.doesNotMatch(unknown, /comparison-screening-point/);
  const baseline = R.body(model, { views: { screeningDate: dates[0] } }); assert.match(baseline, /data-status="green" data-value="3"/); assert.match(baseline, /data-screening-date="2026-07-01"/); assert.match(baseline, /data-grade="1"/); assert.match(baseline, /data-grade="2"/); assert.match(baseline, /data-grade="3"/);
});
test("personal longitudinal screening retains date facets with a PDF grid override", () => {
  const model = fixture({ athletes: 1 }), html = R.body(model), css = fs.readFileSync(path.join(__dirname, "../src/ringside-comparison.css"), "utf8"); assert.match(html, /comparison-body-facets/); assert.doesNotMatch(html, /comparison-screening-chart/); assert.match(css, /ringside-pdf-document \.comparison-body-facets \{ display:grid!important/); assert.match(css, /screen-layout:has\(\.comparison-body-facets\) \.body-art \{ width:100%!important/);
});
test("actual measured isometric data without an evaluation target stays unknown in team screening", () => {
  const athletes = Array.from({ length: 2 }, (_, index) => { const record = M.defaults(), row = record.data.iso.find(row => row.region === "neck" && !row.paired); Object.keys(record.enabled).forEach(id => record.enabled[id] = id === "iso"); record.isoDirectionIds = [row.id]; row.center = 100 + index; row.target = ""; record.athlete.date = dates[0]; record.recordId = "unrated-" + index; record.athleteId = "unrated-athlete-" + index; return { id: record.athleteId, name: "实测未判定" + index, profile: {}, records: [record] }; });
  const model = C.deriveComparison({ athletes }, { athleteIds: athletes.map(a => a.id), dates: [dates[0]] }), region = Object.values(model.summary.periods[0].regions).find(region => region.key === "neck"), html = R.body(model);
  assert.ok(region, JSON.stringify({ issues: model.issues, entries: model.entries.map(e => ({ record: e.record.data.iso, analyses: e.stats.isoAnalyses, signals: e.stats.signals })) })); assert.equal(region.n, 2); assert.equal(region.redCount + region.amberCount + region.greenCount, 0); assert.match(html, /data-valid-n="0"[^>]*data-measured-n="2"/); assert.match(html, /已测未判定/); assert.doesNotMatch(html, /comparison-screening-point/);
});
test("crowded participant columns use readable number labels and a contained scrolling plot", () => {
  const model = fixture({ athletes: 24, periods: 1 }), metric = model.metrics.find(m => m.id === "cmj_height"), html = R.metricChart(model, metric);
  assert.match(html, /comparison-chart-viewport/); assert.match(html, /队员编号/); assert.ok(html.includes(String(model.athletes.findIndex(a => a.name === "队员24") + 1).padStart(2, "0") + " · 队员24")); assert.match(html, /min-width:1338px/); assert.doesNotMatch(html, /<svg class="comparison-line-key"|(?:x1|x2|cx)="[^"]*,/); finite(html);
});
test("curve means and SD are confined to the model's common measured coordinates", () => {
  const model = fixture({ periods: 1 }), curve = { title: "IMTP", xLabel: "时间 / ms", xUnit: "ms", unit: "N", series: [{ athleteId: "a0", date: model.dates[0], points: [{ x: 100, y: 200 }, { x: 200, y: 500 }], rawPoints: [{ x: 100, y: 200 }, { x: 200, y: 500 }] }, { athleteId: "a1", date: model.dates[0], points: [{ x: 100, y: 300 }, { x: 250, y: 600 }], rawPoints: [{ x: 100, y: 300 }, { x: 250, y: 600 }] }], common: [{ date: model.dates[0], x: 100, n: 2, mean: 250, sd: Math.sqrt(5000) }] };
  const html = R.curveChart(model, curve); assert.equal((html.match(/class="comparison-mean"/g) || []).length, 1); assert.match(html, /100 ms · 均值 250/); assert.doesNotMatch(html, /data-comparison-x="0"/); finite(html);
});
test("model curves preserve fitted lines without relabeling model samples as measured", () => {
  const model = fixture({ periods: 1 }), curve = { title: "弹性响应", fitted: true, unit: "%", xUnit: "%", protocol: { internal: "never rendered" }, series: [{ athleteId: "a0", date: model.dates[0], points: [{ x: 0, y: 0 }, { x: 10, y: 7 }], rawPoints: [] }], common: [] };
  const html = R.curveChart(model, curve); assert.match(html, /<polyline/); assert.doesNotMatch(html, /class="viz-point comparison-series"|\[object Object\]|never rendered|实测/); finite(html);
});
test("generic trial plots preserve raw attempt indices without connecting trials", () => {
  const model = fixture({ periods: 1, genericKind: "trials" }), project = model.projects.find(p => p.id === "generic_cmp"), html = R.render(model);
  const native = R.genericPanels(model, project, project.metrics.map(m => m.key)); assert.equal(native.length, 6); assert.deepEqual(plain(native[0].panel.series[0].points.map(p => p.index)), [1, 2]); assert.match(html, /真实试次编号/); finite(html);
});
test("generic scatter preserves genuine pairs and independent axis units", () => {
  const model = fixture({ periods: 1, genericKind: "scatter" }), project = model.projects.find(p => p.id === "generic_cmp"), native = R.genericPanels(model, project, project.metrics.map(m => m.key)), html = R.render(model);
  assert.deepEqual(plain(native[0].panel.points.map(p => [p.x, p.y])), [[10, 100], [20, 50]]); assert.match(html, /横轴实测 · cm/); assert.match(html, /纵轴实测 · N/); finite(html);
});
test("scatter axis selection preserves chosen ordering and genuine same trial values", () => {
  const model = fixture({ periods: 1, genericKind: "scatter" }), project = model.projects.find(p => p.id === "generic_cmp"), keys = ["cz", "cx"].map(id => project.metrics.find(m => m.id === id).key), native = R.genericPanels(model, project, keys);
  assert.deepEqual(plain(native[0].panel.points.map(p => [p.x, p.y])), [[20, 10], [40, 20]]); assert.equal(native[0].panel.xAxis.id, "cz");
});
test("generic bar column and target styles follow each saved presentation", () => {
  for (const genericKind of ["bar", "column", "target"]) {
    const model = fixture({ periods: 1, genericKind }), html = R.render(model); assert.match(html, /横轴实测/); assert.match(html, /纵轴实测/); assert.match(html, /data-comparison-project="generic_cmp"/); finite(html);
  }
});
test("generic radar retains explicit scores and shows the athlete based mean and SD", () => {
  const model = fixture({ periods: 1, genericKind: "radar" }), html = R.render(model); assert.match(html, /评分雷达/); assert.match(html, /均值 ± 样本 SD/); assert.match(html, /n=3/); finite(html);
});
test("summary distinguishes unique athlete counts from individual transition item counts", () => {
  const model = fixture(), original = model.summary.latest.redCount; model.summary.transitions = [{ athleteId: "a0", toDate: dates[2], state: "new", key: "one" }, { athleteId: "a0", toDate: dates[2], state: "new", key: "two" }, { athleteId: "a1", toDate: dates[1], state: "new", key: "old" }];
  const html = R.summary(model); assert.match(html, /新增 2 项/); assert.match(html, new RegExp(original + '<small> 人'));
});
test("FMS preserves its seven original scoring axes plus sides pain and notes", () => {
  const model = fixture({ fms: true }), html = R.render(model); assert.match(html, /FMS 原动作评分/); assert.match(html, /FMS 原分、左右侧与疼痛记录/); assert.match(html, /原始动作备注/); assert.match(html, /疼痛／清除阳性/);
  const views = R.preferences(model); assert.equal(views.projects.fms.metricKeys.length, 7); assert.ok(model.projects.find(p => p.id === "fms").metrics.every(m => m.continuous === false)); finite(html);
});
test("report preferences remove unknown metrics while preserving chosen table and expansion", () => {
  const model = fixture(), key = model.projects.find(p => p.id === "cmj").metrics[0].key, prefs = R.preferences(model, { projects: { cmj: { metricKeys: [key, "bad"], chartMode: "trend", tableMode: "individual", expanded: true } } });
  assert.deepEqual(plain(prefs.projects.cmj.metricKeys), [key]); assert.equal(prefs.projects.cmj.chartMode, "trend"); assert.equal(prefs.projects.cmj.tableMode, "individual"); assert.equal(prefs.projects.cmj.expanded, true);
});
test("unsafe athlete labels remain escaped throughout report and SVG accessibility", () => {
  const model = fixture({ periods: 1 }); model.athletes[0].name = '<img src=x onerror="attack()">'; const html = R.render(model, {}, { includeSummary: true }); assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img/); finite(html);
});
test("rendering ignores oversized internal fingerprints and does not duplicate source records", () => {
  const model = fixture(); model.fingerprint = "secret-internal-long-json".repeat(1000); const html = R.render(model); assert.doesNotMatch(html, /secret-internal-long-json/); assert.ok(html.length < 300000);
});
test("print CSS retains full table rows and current collapsed state", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/ringside-comparison.css"), "utf8"); assert.match(css, /thead \{ display:table-header-group/); assert.match(css, /comparison-distribution:not\(\[open\]\)/); assert.match(css, /overflow:visible/); assert.match(css, /comparison-chart-panel \{ break-inside:avoid/);
});
console.log(passed + " comparison render model checks passed");
if (process.argv.includes("--browser")) (async () => {
  const { chromium } = require("./helpers/playwright.cjs"), out = path.resolve(__dirname, "../output/playwright/comparison-visual");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const css = ["ringside.css", "ringside-workflow.css", "ringside-report-refinement.css", "ringside-generic-report-ui.css", "ringside-fvp.css", "ringside-comparison.css"].map(name => fs.readFileSync(path.resolve(__dirname, "../src", name), "utf8")).join("\n");
    await page.setContent('<style>' + css + '</style><main id="report" class="wrap"><div id="microCards" class="micro-cards"></div><div class="summary-grid"><article class="card"><div class="card-head"><h3>损伤风险筛查</h3></div><div class="screen-layout"><div id="bodyChart" class="body-art"></div><div id="screenItems" class="screen-items"></div></div></article><article class="card"><div class="card-head"><h3>运动表现概览</h3></div><div class="performance-layout"><div id="radarChart" class="radar"></div><div id="directionMetrics" class="aux-metrics"></div></div></article></div><div id="detailContent"></div></main>');
    for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "generic-report", "model", "evaluation", "interventions", "viz", "report", "comparison", "comparison-report"])
      await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, "../src/ringside-" + name + ".js"), "utf8") });
    const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../output/comparison-demo/团队与纵向模拟资料库.json"), "utf8"));
    await page.evaluate(({ demo, image }) => {
      window.RingsideBodyImage = image;
      const dates = [...new Set(demo.athletes.flatMap(a => a.records.map(r => r.athlete.date)))].sort();
      window.model = RingsideComparison.deriveComparison(demo, { athleteIds: demo.athletes.slice(0, 4).map(a => a.id), dates: dates.slice(0, 3) });
      window.views = RingsideComparisonReport.preferences(model); window.preferenceCalls = 0;
      window.draw = () => {
        const R = RingsideComparisonReport;
        for (const [id, content] of [["microCards", R.summary(model)], ["bodyChart", R.body(model, { views })], ["screenItems", R.screenItems(model, { views })], ["radarChart", R.radar(model)], ["directionMetrics", R.overview(model)], ["detailContent", R.render(model, views)]]) document.getElementById(id).innerHTML = content;
        const options = { model, prefs: views, onPreferences: next => { window.preferenceCalls++; window.views = next; draw(); }, onEditRecord: id => { window.edited = id; }, onBasis: value => { window.basisChange = value; } };
        R.bind(document.getElementById("detailContent"), options); R.bindOverview(document.getElementById("report"), options);
      }; draw();
    }, { demo, image: "data:image/png;base64," + fs.readFileSync(path.resolve(__dirname, "../body-map-front.png")).toString("base64") });
    await page.screenshot({ path: path.join(out, "desktop-summary.png") });
    for (const [id, name] of [["imtp", "imtp"], ["fvp_sj", "fvp"], ["iso", "iso"], ["demo_generic_scatter", "scatter"], ["fms", "fms"]])
      await page.locator("#detail-" + id + " .comparison-chart-panel").first().screenshot({ path: path.join(out, "desktop-" + name + "-chart.png") });
    const layout = await page.evaluate(() => ({ tableDisplay: getComputedStyle(document.querySelector(".comparison-statistics-table")).display, legendHeight: document.querySelector(".radar .comparison-line-key").getBoundingClientRect().height, bodyCount: document.querySelectorAll("#bodyChart .comparison-screening-row").length, bodySVGs: document.querySelectorAll("#bodyChart svg").length, summaryHeight: document.querySelector(".summary-grid").getBoundingClientRect().height }));
    assert.equal(layout.tableDisplay, "table"); assert.ok(layout.legendHeight <= 10); assert.ok(layout.bodyCount > 0); assert.equal(layout.bodySVGs, 1); assert.ok(layout.summaryHeight < 1600);
    await page.locator('#detail-cmj [data-comparison-table-mode="individual"]').click();
    assert.equal(await page.evaluate(() => preferenceCalls), 1); assert.equal(await page.evaluate(() => views.projects.cmj.tableMode), "individual");
    assert.ok(await page.locator("#detail-cmj .comparison-person-row").count() > 0);
    await page.locator('#detail-cmj [data-comparison-chart-mode="trend"]').click();
    await page.locator("#detail-cmj .comparison-chart-panel").first().screenshot({ path: path.join(out, "desktop-trend-chart.png") });
    assert.equal(await page.locator("#detail-cmj .comparison-trend-fit").count(), 3);
    await page.locator("#detail-cmj .comparison-legend-person").first().click();
    assert.ok(await page.locator("#detail-cmj .comparison-highlighted").count() > 0); assert.ok(await page.locator("#detail-cmj .comparison-dimmed").count() > 0);
    await page.locator("#detail-cmj [data-comparison-edit-record]").first().click(); assert.ok(await page.evaluate(() => edited));
    await page.locator('#detail-cmj [data-comparison-picker] > summary').click();
    await page.locator('#detail-cmj input[data-comparison-metric]').first().uncheck();
    assert.equal(await page.locator('#detail-cmj [data-comparison-picker]').evaluate(node => node.open), true);
    await page.locator('#detail-cmj input[data-comparison-metric]').nth(1).uncheck();
    assert.equal(await page.locator('#detail-cmj [data-comparison-picker]').evaluate(node => node.open), true);
    await page.setViewportSize({ width: 430, height: 900 }); await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(out, "mobile-summary.png") });
    await page.locator("#detail-imtp .comparison-chart-panel").first().screenshot({ path: path.join(out, "mobile-imtp-chart.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 430); assert.deepEqual(errors, []);
    const screening = [];
    for (const periods of [1, 3, 6]) {
      await page.evaluate(({ demo, periods }) => { const dates = [...new Set(demo.athletes.flatMap(a => a.records.map(r => r.athlete.date)))].sort(); window.model = RingsideComparison.deriveComparison(demo, { athleteIds: demo.athletes.slice(0, 4).map(a => a.id), dates: dates.slice(0, periods) }); window.views = RingsideComparisonReport.preferences(model); draw(); }, { demo, periods });
      for (const width of [1400, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
        const result = await page.evaluate(() => { const chart = document.querySelector('.comparison-screening-chart'), viewport = chart.querySelector('.comparison-screening-viewport'), rows = [...chart.querySelectorAll('.comparison-screening-row')], svg = chart.querySelector('svg'), cx = +svg.dataset.centerX, cy = +svg.dataset.centerY, radius = +svg.dataset.maxRadius; return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, svgCount: chart.querySelectorAll('svg').length, dates: model.dates, activeDate: chart.dataset.screeningDate, rows: rows.length, viewportWidth: viewport.clientWidth, viewportScrollWidth: viewport.scrollWidth, mismatches: rows.filter(node => { const p = model.summary.periods.find(p => p.date === node.dataset.date), r = Object.values(p.regions).find(r => r.key === node.dataset.region) || { n: 0, members: [] }, assessed = (r.redCount || 0) + (r.amberCount || 0) + (r.greenCount || 0), member = r.members.find(m => m.athleteId === node.dataset.athleteId), grade = { green: 3, amber: 2, red: 1 }[member?.status] ?? null, circle = node.querySelector('.comparison-screening-point'); return +node.dataset.measuredN !== r.n || +node.dataset.assessedN !== assessed || +node.dataset.unknownCount !== model.athletes.length - assessed || (grade === null ? !!circle || node.dataset.value !== '' : !circle || +node.dataset.value !== grade || Math.abs(Math.hypot(+circle.getAttribute('cx') - cx, +circle.getAttribute('cy') - cy) - radius * grade / 3) > .015 || circle.getAttribute('fill') !== RingsideViz.C[member.status]); }).length }; });
        assert.equal(result.pageWidth, width); assert.equal(result.svgCount, 1); assert.equal(result.mismatches, 0); assert.equal(result.dates.length, periods); screening.push(result);
        await page.locator('.summary-grid > .card').first().screenshot({ path: path.join(out, `screening-${periods}-dates-${width}.png`) });
      }
      if (periods > 1) { await page.locator('[data-comparison-screening-date]').first().click(); assert.equal(await page.evaluate(() => views.screeningDate), await page.evaluate(() => model.dates[0])); assert.equal(await page.locator('.comparison-screening-chart').getAttribute('data-screening-date'), await page.evaluate(() => model.dates[0])); }
      await page.locator('#bodyChart .comparison-legend-person').first().click(); const focus = await page.evaluate(() => { const axis = document.querySelector('.comparison-screening-axis'), detail = JSON.parse(axis.dataset.bodyDetail); return { id: views.highlightAthleteId, detail, opacity: document.querySelector('.comparison-screening-series.comparison-highlighted').getAttribute('opacity') }; }); assert.ok(focus.id); assert.equal(focus.opacity, '1'); assert.match(focus.detail.name, /模拟队员/);
    }
    const crowdedScreening = [];
    await page.evaluate(demo => { const dates = [...new Set(demo.athletes.flatMap(a => a.records.map(r => r.athlete.date)))].sort(); window.model = RingsideComparison.deriveComparison(demo, { athleteIds: demo.athletes.map(a => a.id), dates }); window.views = RingsideComparisonReport.preferences(model); window.drawBody = () => { const R = RingsideComparisonReport; document.getElementById('microCards').innerHTML = R.summary(model); document.getElementById('bodyChart').innerHTML = R.body(model, { views }); document.getElementById('screenItems').innerHTML = R.screenItems(model, { views }); R.bindOverview(document.getElementById('report'), { model, prefs: views, onPreferences: next => { window.views = next; drawBody(); } }); }; drawBody(); }, demo);
    for (const width of [1440, 900, 390]) { await page.setViewportSize({ width, height: 1000 }); const check = await page.evaluate(() => { const root = document.querySelector('.comparison-screening-chart'); return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, svgCount: root.querySelectorAll('svg').length, seriesCount: root.querySelectorAll('.comparison-screening-series').length, legendCount: root.querySelectorAll('.comparison-legend-person').length, currentDate: root.dataset.screeningDate }; }); assert.equal(check.pageWidth, width); assert.equal(check.svgCount, 1); assert.equal(check.seriesCount, 24); assert.equal(check.legendCount, 24); crowdedScreening.push(check); await page.locator('.summary-grid > .card').first().screenshot({ path: path.join(out, `screening-24-6-dates-${width}.png`) }); }
    fs.writeFileSync(path.join(out, "render-review.json"), JSON.stringify({ checks: 28, layout, screening, crowdedScreening, errors }, null, 2));
    console.log("28 comparison browser rendering and interaction checks passed; " + out);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

