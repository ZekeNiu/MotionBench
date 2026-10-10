"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); context.window = context;
for (const name of ["calc", "fvp", "sprint-fvp", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/ringside-${name}.js`), "utf8"), context, { filename: name });
const M = context.RingsideModel, T = context.RingsideTests, R = context.RingsideReport, V = context.RingsideViz;
const metricKeys = ["F0", "V0", "Pmax", "F0Absolute", "PmaxAbsolute", "slope", "RFmax", "DRF", "Vmax", "endVelocity", "Vopt"];
const times = [1.3735406501017202, 2.1031246565401025, 3.3485505747362385, 4.505234882806160, 5.633470563022033];
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const record = M.sampleRecord(); record.athlete.mass = 75; record.athlete.height = 180; record.enabled.sprint_fvp = true;
  record.data.sprint_fvp = [{ id: "synthetic_display_sprint", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ distanceM, timeS: times[i] })), excluded: false, notes: "Synthetic display validation" }];
  record.views.capabilitySelections.speed = "sprint_fvp";
  return record;
}
const render = (record, print = false) => R.renderSprintFVPAnalysis(R.build(record), { print });
const resultTable = html => html.match(/<table class="fvp-result-table sprint-fvp-result-table">[\s\S]*?<\/table>/)?.[0] || "";
const resultKeys = html => [...resultTable(html).matchAll(/data-metric-id="([^"]+)"/g)].map(match => match[1]);
const resultRow = (html, key) => resultTable(html).match(new RegExp(`<tr data-metric-id="${key}">[\\s\\S]*?<\\/tr>`))?.[0];
const svg = html => html.match(/<svg[\s\S]*?<\/svg>/)?.[0] || "";
function chartInput(html) {
  const escaped = html.match(/data-chart-input="([^"]+)"/)?.[1];
  return JSON.parse(escaped.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
}

test("historical defaults display one sprint name while captured custom names and raw facts remain intact", () => {
  for (const name of ["分段计时冲刺 F–V/P–V 剖面", "分段计时冲刺 F–V/P–V", "冲刺FVP", '教练自定冲刺 "<测评>"']) {
    const record = fixture(); record.projectSnapshots = T.snapshots(record).map(project => project.id === "sprint_fvp" ? { ...project, name } : project);
    const before = JSON.stringify(record), html = render(record);
    assert.equal(JSON.stringify(record), before);
    assert.equal(record.projectSnapshots.find(project => project.id === "sprint_fvp").name, name);
    assert.match(html, /aria-label="冲刺FVP"/);
    if (name.startsWith("教练")) {
      assert.match(html, /<h3>教练自定冲刺 &quot;&lt;测评&gt;&quot;<\/h3>/);
      assert.match(html, /data-trial-title="教练自定冲刺 &quot;&lt;测评&gt;&quot; · 原始录入分段"/);
    } else {
      assert.match(html, /<h3>冲刺FVP<\/h3>/);
      assert.match(html, /data-trial-title="冲刺FVP · 原始录入分段"/);
      assert.doesNotMatch(html, /分段计时冲刺 F–V\/P–V/);
    }
  }
});

test("missing display settings retain all three checked controls and eleven parameter rows", () => {
  const record = fixture(); delete record.sprintFvpView;
  const html = render(record);
  assert.deepEqual(resultKeys(html), metricKeys);
  assert.deepEqual([...html.matchAll(/data-sprint-fvp-view="([^"]+)" checked/g)].map(match => match[1]), ["fv", "pv", "optimum"]);
  assert.match(html, /data-sprint-fvp-view="confidence">95%拟合置信区间（近似）/);
  assert.doesNotMatch(html, /data-sprint-fvp-confidence-status|data-sprint-fvp-confidence-band/);
  assert.deepEqual([...html.matchAll(/data-sprint-fvp-metric="([^"]+)" checked/g)].map(match => match[1]), metricKeys);
  assert.match(html, /id="sprintFvpDisplaySettings" data-sprint-fvp-display-settings><summary>显示参数<\/summary>/);
  assert.equal((svg(html).match(/<polyline /g) || []).length, 4);
  assert.match(html, /目标冲刺距离 40\.0 m · 跟随当前测试末段/);
});

test("each metric checkbox removes only its corresponding row without changing calculations or other rows", () => {
  const baseline = fixture(), baselineReport = R.build(baseline), baselineHtml = render(baseline);
  for (const key of metricKeys) {
    const record = plain(baseline); record.sprintFvpView = { metrics: { [key]: false } };
    const before = JSON.stringify(record), report = R.build(record), html = R.renderSprintFVPAnalysis(report);
    assert.equal(JSON.stringify(record), before);
    assert.deepEqual(plain(report.stats.sprintFvp), plain(baselineReport.stats.sprintFvp));
    assert.deepEqual(plain(report.stats.values), plain(baselineReport.stats.values));
    assert.deepEqual(resultKeys(html), metricKeys.filter(id => id !== key));
    for (const visible of metricKeys.filter(id => id !== key)) assert.equal(resultRow(html, visible), resultRow(baselineHtml, visible));
    assert.match(html, new RegExp(`data-sprint-fvp-metric="${key}">`));
    assert.match(html, /拟合残差、测试条件与方法|相对最优剖面/);
  }
});

test("the three plot toggles control geometry and legend independently from the optimal column and judgment", () => {
  const record = fixture(), baseline = resultTable(render(record));
  for (const fv of [false, true]) for (const pv of [false, true]) for (const optimum of [false, true]) {
    record.sprintFvpView = { fv, pv, optimum };
    const html = render(record), drawing = svg(html), curveCount = (drawing.match(/<polyline /g) || []).length;
    assert.equal(curveCount, (Number(fv) + Number(pv)) * (optimum ? 2 : 1));
    assert.equal(resultTable(html), baseline);
    assert.match(html, /相对最优剖面|目标冲刺距离 40\.0 m/);
    assert.doesNotMatch(html, /NaN|Infinity/);
    if (!fv && !pv) {
      assert.match(drawing, /aria-label="冲刺FVP"/); assert.match(drawing, /勾选 F–V 或 P–V 查看曲线/);
      assert.doesNotMatch(drawing, /跳跃|40\.0 m 最优|当前冲刺剖面|stroke-dasharray="7 5"|虚线/);
    } else {
      assert.match(drawing, /当前冲刺剖面/);
      if (optimum) assert.match(drawing, /40\.0 m 最优|虚线为/);
      else assert.doesNotMatch(drawing, /40\.0 m 最优|stroke-dasharray="7 5"|虚线/);
      if (!fv) assert.doesNotMatch(drawing, /力 F · N\/kg|F–V读取力坐标/);
      if (!pv) assert.doesNotMatch(drawing, /功率 P · W\/kg|P–V读取功率坐标/);
    }
  }
});

test("unavailable optimum never advertises an optimal line or legend", () => {
  const report = R.build(fixture()); report.stats.sprintFvp.optimum = null;
  const drawing = svg(R.renderSprintFVPAnalysis(report));
  assert.equal((drawing.match(/<polyline /g) || []).length, 2);
  assert.doesNotMatch(drawing, /虚线|40\.0 m 最优|stroke-dasharray="7 5"/);
});

test("screen and print preserve the same selected geometry, rows and target distance with no print controls", () => {
  const record = fixture(); record.sprintFvpView = { fv: false, pv: true, optimum: false, metrics: { F0Absolute: false, RFmax: false, Vopt: false } }; record.sprintFvpAnalysis.targetDistanceM = 20;
  const screen = render(record), print = render(record, true);
  assert.equal(resultTable(print), resultTable(screen));
  assert.deepEqual(chartInput(print), chartInput(screen));
  assert.match(print, /目标冲刺距离 20\.0 m · 专项目标/);
  assert.doesNotMatch(print, /<input|<button|data-sprint-fvp-view|data-sprint-fvp-metric|sprintFvpDisplaySettings/);
  const [data, options] = chartInput(print);
  for (const width of [280, 447.03125, 480]) {
    const drawing = V.sprintFvp(data, options, { width, print: true, height: 390 });
    assert.equal((drawing.match(/<polyline /g) || []).length, 1);
    assert.doesNotMatch(drawing, /NaN|Infinity|虚线|20\.0 m 最优/);
  }
});

test("hiding all parameters leaves explicit empty state, fit details, target and direction available", () => {
  const record = fixture(); record.sprintFvpView = { metrics: Object.fromEntries(metricKeys.map(key => [key, false])) };
  const html = render(record), capability = R.renderCapabilityAnalysis(R.build(record));
  assert.deepEqual(resultKeys(html), []); assert.match(html, /data-sprint-fvp-metrics-empty>已隐藏全部显示参数/);
  assert.match(html, /相对最优剖面|sprint-fvp-fit-table|目标冲刺距离 40\.0 m/);
  assert.match(capability, /data-direction-metric="sprint_fvp"/);
  assert.equal((svg(html).match(/<polyline /g) || []).length, 4);
});

test("sprint display changes preserve jump geometry and keep cards before the four analysis regions", () => {
  const record = fixture(); record.enabled.fvp_sj = true; record.fvpConfig.fvp_sj.distanceCm = 33;
  record.data.fvp_sj = [0, 20, 40, 60, 80].map((load, i) => ({ id: "synthetic_display_jump_" + i, load, height: [33, 27, 22, 14, 10][i] }));
  const original = R.renderFVPAnalysis(R.build(record));
  record.sprintFvpView = { fv: false, pv: false, optimum: false, metrics: { F0: false } };
  // SVG and clip identifiers are unique per call; geometry and content must match.
  const withoutClipIds = html => html.replace(/ringside-fvp-clip-\d+/g, "ringside-fvp-clip").replace(/ringside-viz-\d+/g, "ringside-viz");
  assert.equal(withoutClipIds(R.renderFVPAnalysis(R.build(record))), withoutClipIds(original));
  const html = R.renderCapabilityAnalysis(R.build(record)), cards = html.indexOf('data-capability-analysis');
  const indices = ["jumpFvp", "jumpElasticity", "sprintFvp"].map(kind => html.indexOf(`data-chart-kind="${kind}"`));
  assert.ok(indices.every(index => index > cards)); assert.ok(indices[0] < indices[1] && indices[1] < indices[2]);
  assert.ok(indices[2] < html.indexOf('data-chart-kind="sprintElasticity"')); assert.doesNotMatch(html, /trainingAnalysisDetail/);
});

function noisyFixture() {
  const record = fixture(), times = [1.3735406501017202, 2.1031246565401025, 2.744459320513764, 3.3485505747362385, 4.505234882806160, 5.633470563022033];
  record.data.sprint_fvp[0].splits = [5, 10, 15, 20, 30, 40].map((distanceM, i) => ({ distanceM, timeS: times[i] + [0.012, -0.008, 0.009, -0.006, 0.01, -0.007][i] }));
  record.sprintFvpView = { confidence: true };
  return record;
}

test("optional intervals bind actual split count, method and point estimates to the report snapshot and print", () => {
  const record = noisyFixture(), before = JSON.stringify(record), report = R.build(record), confidence = report.sprintFvpConfidence;
  assert.equal(JSON.stringify(record), before); assert.equal(confidence.available, true);
  assert.equal(confidence.metadata.version, "sprint-fvp-pointwise-delta-v1"); assert.equal(confidence.metadata.level, .95);
  assert.equal(confidence.metadata.n, 6); assert.equal(confidence.metadata.df, 4); assert.equal(confidence.metadata.currentCurveOnly, true);
  assert.equal(confidence.band.length, 49); assert.ok(confidence.band.some(point => point.high > point.low));
  const screen = R.renderSprintFVPAnalysis(report), print = R.renderSprintFVPAnalysis(report, { print: true });
  assert.deepEqual(chartInput(screen), chartInput(print)); assert.deepEqual(chartInput(screen)[0].confidence, plain(confidence.metadata));
  assert.match(screen, /data-confidence-available="true" data-confidence-version="sprint-fvp-pointwise-delta-v1" data-confidence-n="6" data-confidence-df="4"/);
  assert.match(print, /95%逐点拟合置信区间（近似） · 当前剖面 · n=6 · df=4/);
  assert.match(print, /data-sprint-fvp-confidence-method|位置残差独立且同方差|不是同时置信带或预测区间/);
  assert.doesNotMatch(print, /data-sprint-fvp-view|<input/);
  const offRecord = plain(record); offRecord.sprintFvpView.confidence = false;
  const offReport = R.build(offRecord), off = R.renderSprintFVPAnalysis(offReport);
  assert.equal(offReport.sprintFvpConfidence, null);
  assert.equal(resultTable(screen), resultTable(off)); assert.deepEqual(plain(report.stats.sprintFvp), plain(offReport.stats.sprintFvp));
});

test("only selected current curves receive interval polygons and hidden optimum changes no interval", () => {
  const record = noisyFixture();
  for (const fv of [false, true]) for (const pv of [false, true]) for (const optimum of [false, true]) {
    record.sprintFvpView = { confidence: true, fv, pv, optimum };
    const drawing = svg(render(record));
    assert.deepEqual([...drawing.matchAll(/data-sprint-fvp-confidence-band="([^"]+)"/g)].map(match => match[1]), [fv ? "fv" : null, pv ? "pv" : null].filter(Boolean));
    assert.equal((drawing.match(/<polyline /g) || []).length, (Number(fv) + Number(pv)) * (optimum ? 2 : 1));
    assert.doesNotMatch(drawing, /NaN|Infinity|data-sprint-fvp-confidence-band="optimum"/);
    if (fv || pv) assert.match(drawing, /只覆盖模型机械采样的速度范围/);
    else assert.doesNotMatch(drawing, /阴影|95%拟合区间（近似）/);
  }
});

test("unsupported saved interval declarations show a reason and preserve saved values without silently changing the method", () => {
  for (const declaration of [{ confidenceMethodVersion: "future-method" }, { confidenceLevel: .9 }]) {
    const record = noisyFixture(); Object.assign(record.sprintFvpView, declaration); const before = JSON.stringify(record), report = R.build(record), html = R.renderSprintFVPAnalysis(report);
    assert.equal(JSON.stringify(record), before); assert.equal(report.sprintFvpConfidence.available, false);
    assert.equal(report.sprintFvpConfidence.metadata.available, false); assert.deepEqual(plain(report.sprintFvpConfidence.band), []);
    assert.match(html, /当前保存的置信区间方法或置信水平暂不支持/);
    assert.doesNotMatch(svg(html), /data-sprint-fvp-confidence-band|阴影/);
  }
});

test("interval unavailability retains point curves and gives the same short reason in screen and print", () => {
  const report = R.build(noisyFixture()); report.stats.sprintFvp.fit.points = report.stats.sprintFvp.fit.points.slice(0, 2); report.stats.sprintFvp.fit.n = 2;
  report.sprintFvpConfidence = context.RingsideSprintFVPConfidence.evaluate(report.stats.sprintFvp, { count: 49 });
  assert.equal(report.sprintFvpConfidence.available, false);
  for (const print of [false, true]) {
    const html = R.renderSprintFVPAnalysis(report, { print });
    assert.match(html, /data-confidence-available="false"/); assert.ok(html.includes(report.sprintFvpConfidence.reason));
    assert.equal((svg(html).match(/<polyline /g) || []).length, 4); assert.doesNotMatch(svg(html), /data-sprint-fvp-confidence-band|阴影/);
  }
});

test("wide negative interval bounds remain inside the sprint axes without clipping bounds to zero", () => {
  const report = R.build(noisyFixture()), [data, options] = chartInput(R.renderSprintFVPAnalysis(report));
  data.band = [{ x: -2, low: -20, high: 30, powerLow: -100, powerHigh: 90 }, { x: 15, low: -10, high: 60, powerLow: -80, powerHigh: 250 }];
  for (const width of [280, 480]) {
    const drawing = V.sprintFvp(data, options, { width, height: 390, print: true });
    assert.doesNotMatch(drawing, /NaN|Infinity/);
    const rect = drawing.match(/<clipPath[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
    assert.ok(rect); const [left, top, span, height] = rect.slice(1).map(Number);
    for (const polygon of drawing.matchAll(/data-sprint-fvp-confidence-band="(?:fv|pv)" points="([^"]+)"/g)) {
      for (const pair of polygon[1].split(" ")) {
        const [x, y] = pair.split(",").map(Number);
        assert.ok(x >= left - .02 && x <= left + span + .02, `interval x ${x} outside axis`);
        assert.ok(y >= top - .02 && y <= top + height + .02, `interval y ${y} outside axis`);
      }
    }
    assert.match(drawing, /-20|-10|-100/);
  }
});

console.log(`\n${passed} sprint FVP display report checks passed.`);
