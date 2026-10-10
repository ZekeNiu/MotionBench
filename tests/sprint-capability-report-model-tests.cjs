"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "fvp", "sprint-fvp", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/ringside-${name}.js`), "utf8"), c, { filename: name });
const M = c.RingsideModel, R = c.RingsideReport, V = c.RingsideViz;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
const section = (html, key) => html.match(new RegExp(`<article[^>]*data-capability-direction="${key}"[^>]*>[\\s\\S]*?<\\/article>`))?.[0] || "";
const times = [1.3735406501017202, 2.1031246565401025, 3.3485505747362385, 4.505234882806160, 5.633470563022033];
function fixture() {
  const r = M.sampleRecord(); r.athlete.mass = 75; r.athlete.height = 180; r.enabled.sprint_fvp = true;
  r.data.sprint_fvp = [{ id: "synthetic_sprint", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ distanceM, timeS: times[i] })), excluded: false, notes: "Synthetic validation" }];
  r.views.capabilitySelections = { strength: "fdsi", reactive: "dj_rsi", speed: "sprint_fvp" };
  return r;
}

test("one snapshot yields four single-basis cards and retains the category parameters", () => {
  const r = fixture(), before = JSON.stringify(r), report = R.build(r), html = R.render(report);
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual([...html.matchAll(/data-capability-direction="([^"]+)"/g)].map(m => m[1]), ["strength", "reactive", "speed", "endurance"]);
  for (const key of ["strength", "reactive", "speed", "endurance"]) {
    const card = section(html, key); assert.ok(card); assert.equal((card.match(/data-direction-metric=/g) || []).length, 1);
    assert.equal((card.match(/class="capability-direction-judgment/g) || []).length, 1);
  }
  assert.doesNotMatch(section(html, "endurance"), /<select/);
  const actual = new Set([...html.matchAll(/data-capability-metric="([^"]+)"/g)].map(m => m[1]));
  for (const metric of report.stats.capabilityCards.flatMap(card => card.metrics)) {
    if (metric.id === "idsi") assert.ok(actual.has("idsi_matched") || actual.has("idsi_fixed250")); else assert.ok(actual.has(metric.id), metric.id);
  }
  assert.deepEqual(Array.from(report.diagnostics), []); assert.doesNotMatch(html, /NaN|Infinity|未注册图表渲染器/);
});

test("switching a basis changes one summary while all in-card parameters stay intact", () => {
  const r = fixture(), a = R.renderCapabilityAnalysis(R.build(r));
  r.views.capabilitySelections.strength = "eur"; r.views.capabilitySelections.speed = "srr";
  const b = R.renderCapabilityAnalysis(R.build(r));
  assert.match(section(a, "strength"), /data-direction-metric="fdsi"/); assert.match(section(b, "strength"), /data-direction-metric="eur"/);
  assert.match(section(b, "speed"), /data-direction-metric="srr"/);
  const params = html => [...html.matchAll(/<div data-report-patch="parameters-[^"]+">[\s\S]*?<\/details><\/article>/g)].map(match => match[0]);
  assert.equal(params(a).length, 4); assert.deepEqual(params(a), params(b));
  assert.doesNotMatch(section(b, "strength"), /1\.1|发展 SSC 能力|发展纯向心能力/);
});

test("both iDSI windows have independent full names, values and saved selections", () => {
  const report = R.build(fixture());
  const variants = ["idsi_matched", "idsi_fixed250"].map((id, i) => ({ id, available: true, value: .3 + i * .1, unit: "比值", directionHint: "同口径纵向比较", components: [{ label: "Synthetic impulse", value: 100 + i, unit: "N·s" }] }));
  report.stats.derived.results = variants;
  report.stats.capabilityCards = [{ id: "strength", title: "力量发展方向", metrics: [{ id: "idsi", value: .3, variants, selectedVariant: "idsi_matched" }] }];
  for (const id of ["idsi_matched", "idsi_fixed250"]) {
    report.record.views.capabilitySelections.strength = id; const html = R.renderCapabilityAnalysis(report);
    assert.match(section(html, "strength"), new RegExp(`data-direction-metric="${id}"`));
    assert.match(html, /data-capability-metric="idsi_matched"/); assert.match(html, /data-capability-metric="idsi_fixed250"/);
    assert.match(html, /iDSI · 匹配 CMJ 推进期/); assert.match(html, /iDSI · 固定 0–250 ms/); assert.match(html, /0\.300/); assert.match(html, /0\.400/);
  }
});

test("target distance refreshes the optimum, speed judgment and chart from the same result", () => {
  const r = fixture(), report40 = R.build(r), a = R.renderCapabilityAnalysis(report40);
  r.sprintFvpAnalysis.targetDistanceM = 10; const report10 = R.build(r), b = R.renderCapabilityAnalysis(report10);
  assert.equal(report40.stats.sprintFvp.targetDistanceM, 40); assert.equal(report10.stats.sprintFvp.targetDistanceM, 10);
  assert.notEqual(report40.stats.sprintFvp.optimum.slope, report10.stats.sprintFvp.optimum.slope);
  assert.match(section(a, "speed"), /目标距离 40\.0 m/); assert.match(section(b, "speed"), /目标距离 10\.0 m/);
  assert.match(a, /40\.0 m 最优/); assert.match(b, /10\.0 m 最优/);
  assert.match(a, /RF max[\s\S]*48\.2/); assert.match(a, /DRF[\s\S]*-7\.240/);
  assert.match(a, /相对最优剖面[\s\S]*100% 为最优/); assert.match(a, /sprint-fvp-fit-table/);
  assert.equal((a.match(/data-raw-trials="sprint_fvp"/g) || []).length, 1);
  assert.match(a, /data-raw-trials="sprint_fvp" data-trial-title="冲刺FVP · 原始录入分段"/);
  assert.match(a, /录入时间 s/);
});

test("missing chosen measurements show waiting, while print preserves basis and excludes controls", () => {
  const r = fixture(); r.views.capabilitySelections.strength = "fvp"; r.views.capabilitySelections.reactive = "cmrj_rsi"; r.enabled.cmrj = false;
  const report = R.build(r), html = R.renderCapabilityAnalysis(report), print = R.renderCapabilityAnalysis(report, { print: true });
  assert.match(section(html, "strength"), /待计算/); assert.match(section(html, "reactive"), /待计算/);
  assert.match(print, /data-direction-metric="fvp"/); assert.match(print, /目标冲刺距离 40\.0 m/);
  assert.doesNotMatch(print, /<select|<input|<button|data-sprint-target-form/);
  assert.doesNotMatch(print, /NaN|Infinity/);
});

test("the FVP card follows the selected jump protocol even when that protocol needs review", () => {
  const r = fixture(); r.views.capabilitySelections.strength = "fvp";
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    r.enabled[id] = true; r.fvpConfig[id].distanceCm = 33;
    r.data[id] = [0, 20, 40, 60, 80].map((load, i) => ({ id: id + i, load, height: [33, 27, 22, 14, 10][i] }));
  }
  r.views.fvpProtocol = "fvp_cmj"; r.data.fvp_cmj = r.data.fvp_cmj.slice(0, 2);
  const card = section(R.renderCapabilityAnalysis(R.build(r)), "strength");
  assert.match(card, /CMJ FVP 不平衡性/); assert.match(card, /待计算/); assert.doesNotMatch(card, /SJ FVP 不平衡性/);
});

test("sprint chart labels the sprint model and remains finite at narrow and print widths", () => {
  const report = R.build(fixture()), html = R.renderSprintFVPAnalysis(report);
  assert.match(html, /data-chart-kind="sprintFvp"/); assert.match(html, /aria-label="冲刺FVP"/); assert.doesNotMatch(html, /跳跃 F–V 与 P–V 剖面|实测点/);
  const chartData = { valid: true, profiles: [{ kind: "current", label: "当前冲刺剖面", ...report.stats.sprintFvp.model }, { kind: "optimum", label: "40 m 最优", ...report.stats.sprintFvp.optimum }], points: [], band: [] };
  for (const width of [280, 480]) for (const print of [false, true]) {
    const svg = V.sprintFvp(chartData, {}, { width, print, height: 390 }); assert.doesNotMatch(svg, /NaN|Infinity/); assert.match(svg, /当前冲刺剖面/); assert.match(svg, /40 m 最优/);
  }
});

test("parameter group titles and conclusions remain one heading unit before their first table row", () => {
  const report = R.build(fixture()); report.stats.capabilityCards = [{ id: "cardio", title: "心肺发展方向", conclusion: "优先提高 VT2。", metrics: [{ id: "cpet_vo2_relative", label: "VO₂peak", value: 50, unit: "mL·kg⁻¹·min⁻¹", status: "green", judgment: "原始自定义等级" }] }];
  const before = JSON.stringify(report), html = R.renderCapabilityAnalysis(report, { print: true });
  assert.match(html, /class="capability-parameter-heading"><h3>心肺与阈值参数<\/h3><p class="capability-parameter-conclusion">优先提高 VT2。<\/p><\/div><div class="table-wrap"><table/);
  assert.match(html, /capability-parameter-judgment green/); assert.ok(html.includes(c.Def.assessmentLabel("green"))); assert.doesNotMatch(html, /原始自定义等级/);
  assert.equal(JSON.stringify(report), before);
});
test("four independently folded cards precede both FVP and elasticity regions", () => {
  const r = fixture();
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    r.enabled[id] = true; r.fvpConfig[id].distanceCm = 33;
    r.data[id] = [0, 20, 40, 60, 80].map((load, i) => ({ id: id + i, load, height: [33, 27, 22, 14, 10][i] }));
  }
  r.views.fvpProtocol = "fvp_cmj";
  const report = R.build(r), before = JSON.stringify(r), html = R.renderCapabilityAnalysis(report);
  assert.equal((html.match(/data-capability-region/g) || []).length, 1);
  const cards = html.indexOf('data-capability-analysis');
  const profile = html.indexOf('data-fvp-panel="fvp_cmj"'), elasticity = html.indexOf('data-fvp-elasticity="fvp_cmj"'), sprint = html.indexOf('data-sprint-fvp-panel');
  assert.ok(cards >= 0 && cards < profile && profile < elasticity && elasticity < sprint && sprint < html.indexOf('data-sprint-elasticity-panel'));
  assert.doesNotMatch(html, /trainingAnalysisDetail|能力发展方向与参数|data-pdf-title="能力发展方向/);
  assert.deepEqual([...html.matchAll(/data-capability-parameters="([^"]+)"/g)].map(m => m[1]), ["strength", "reactive", "speed", "endurance"]);
  assert.doesNotMatch(html, /data-capability-parameters="[^"]+" open/);
  assert.equal((html.match(/class="capability-region-heading pdf-group-heading"/g) || []).length, 1);
  for (const key of ["strength", "reactive", "speed", "endurance"]) assert.match(html.slice(cards, profile), new RegExp(`data-capability-direction="${key}"`));
  assert.match(html, /data-fvp-protocol/); assert.match(html, /data-fvp-scenario-form/);
  assert.match(html, /data-raw-trials="fvp_cmj"/); assert.match(html, /data-raw-trials="sprint_fvp"/);
  assert.equal(JSON.stringify(r), before);
});

test("print preparation preserves each card's live fold and both valid jump protocols", () => {
  const r = fixture();
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    r.enabled[id] = true; r.fvpConfig[id].distanceCm = 33;
    r.data[id] = [0, 20, 40, 60, 80].map((load, i) => ({ id: id + i, load, height: [33, 27, 22, 14, 10][i] }));
  }
  r.views.fvpProtocol = "fvp_cmj";
  const before = JSON.stringify(r); let html = "", replacements = 0;
  const cards = ["strength", "reactive", "speed", "endurance"].map((key, i) => ({ dataset: { capabilityParameters: key }, open: i === 1 }));
  const printed = cards.map(card => ({ dataset: card.dataset, open: false }));
  const region = { querySelectorAll: () => cards,
    set outerHTML(value) { html = value; replacements++; printed.forEach(card => { card.open = false; }); } };
  const clone = { querySelector: selector => selector === "[data-capability-region]" ? region : null, querySelectorAll: () => printed };
  for (let i = 0; i < 2; i++) {
    R.prepareFVPPrint(clone, r);
    assert.deepEqual(printed.map(card => card.open), [false, true, false, false]);
    assert.equal((html.match(/data-capability-region/g) || []).length, 1);
    assert.doesNotMatch(html, /trainingAnalysisDetail/);
    assert.deepEqual([...html.matchAll(/data-chart-kind="([^"]+)"/g)].map(match => match[1]), ["jumpFvp", "jumpElasticity", "jumpFvp", "jumpElasticity", "sprintFvp", "sprintElasticity"]);
    assert.doesNotMatch(html, /<select|<input|<button|data-sprint-target-form/);
  }
  assert.equal(replacements, 2); assert.equal(JSON.stringify(r), before);
  R.prepareFVPPrint({ querySelector: () => null }, r); assert.equal(replacements, 2);
});

test("independent regions keep existing empty and disabled measurement gates", () => {
  const r = fixture(); r.enabled.sprint_fvp = false; r.enabled.fvp_sj = true; r.data.fvp_sj = [];
  const html = R.renderCapabilityAnalysis(R.build(r));
  assert.match(html, /data-capability-region/); assert.match(html, /data-capability-analysis/);
  assert.doesNotMatch(html, /class="capability-plot-region"|data-fvp-panel=|data-fvp-elasticity=|data-sprint-fvp-panel/);
});
console.log(`${passed} sprint and capability report checks passed`);
