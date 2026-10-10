"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); context.window = context;
["ringside-calc.js", "ringside-fvp.js", "ringside-sprint-fvp.js", "ringside-sources.js", "ringside-cpet-reference.js", "ringside-definitions.js", "ringside-tests.js", "ringside-scoring.js", "ringside-model.js"].forEach(name =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", name), "utf8"), context, { filename: name }));
const F = context.RingsideSprintFVP, M = context.RingsideModel, T = context.RingsideTests;
const json = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, eps = 1e-8) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
// Synthetic standing acceleration, independently solved and cached for Vmax=9,
// tau=1.2. No athlete data or user-workbook files are used by this suite.
const times = [1.3735406501017202, 2.1031246565401025, 3.3485505747362385, 4.505234882806160, 5.633470563022033];
function fixture() {
  const r = M.defaults(); r.athlete.mass = 75; r.athlete.height = 180; r.enabled.sprint_fvp = true;
  r.data.sprint_fvp = [{ id: "sprint_synthetic", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ distanceM, timeS: times[i] })), notes: "合成验证", excluded: false, exclusionReason: "" }];
  return r;
}
test("nonlinear distance fit recovers independent synthetic acceleration", () => {
  const s = F.solve(fixture()); assert.equal(s.valid, true); near(s.fit.vmax, 9); near(s.fit.tau, 1.2); assert.ok(s.fit.rmseM < 1e-8);
  assert.equal(s.window.stepS, .1); assert.equal(s.model.sampleCount, 56); assert.equal(s.model.rfSampleCount, 53);
  assert.equal(s.samples[3].timeS, .4); assert.equal(s.model.units.RFmax, "ratio"); assert.equal(s.model.units.DRF, "百分点/(m/s)");
});
test("no-drag force regression recovers Newtonian identities exactly", () => {
  const m = F.mechanics({ vmax: 9, tau: 1.2 }, 75, 0, 0, 5.6);
  assert.equal(m.valid, true); near(m.F0, 9 / 1.2); near(m.V0, 9); near(m.slope, -1 / 1.2); near(m.Pmax, 9 * 9 / 1.2 / 4);
  near(m.F0Absolute, 75 * 9 / 1.2); near(m.PmaxAbsolute, 75 * 9 * 9 / 1.2 / 4); near(m.r2, 1);
  const forceAtFirstQualified = 9 / 1.2 * Math.exp(-.4 / 1.2);
  near(m.RFmax, forceAtFirstQualified / Math.hypot(forceAtFirstQualified, 9.81));
  assert.ok(m.rfIntercept > m.RFmax); assert.ok(m.DRF < 0);
});
test("hPa conversion keeps standard density and drag dimensions", () => {
  const standard = F.airResistance(75, 1.8, 0, 1013.25); near(standard.density, 1.293);
  const lowPressure = F.airResistance(75, 1.8, 30, 998); near(lowPressure.density, 1.293 * (998 / 1013.25) * 273 / 303);
  const incorrectlyAsTorr = F.airResistance(75, 1.8, 30, 998 * 1013.25 / 760);
  near(incorrectlyAsTorr.density / lowPressure.density, 1013.25 / 760);
  assert.ok(standard.frontalArea > 0 && standard.K > 0); near(standard.K, .5 * standard.density * standard.frontalArea * .9);
});
test("interval input and fixed correction are applied once without rewriting raw times", () => {
  const cumulative = fixture(), intervals = fixture(); intervals.sprintFvpConfig.inputTimeMode = "interval";
  intervals.sprintFvpConfig.timeCorrectionS = .2; intervals.sprintFvpConfig.timingStart = "gate_crossing";
  intervals.data.sprint_fvp[0].splits.forEach((p, i) => { p.timeS = i ? times[i] - times[i - 1] : times[0] - .2; });
  const before = JSON.stringify(intervals), a = F.solve(cumulative), b = F.solve(intervals);
  assert.equal(b.valid, true); near(a.model.F0, b.model.F0); near(a.fit.tau, b.fit.tau); assert.equal(JSON.stringify(intervals), before);
  assert.ok(intervals.data.sprint_fvp[0].splits[1].timeS < intervals.data.sprint_fvp[0].splits[0].timeS);
});
test("explicit spatial origin converts local distances to rest-origin distances", () => {
  const r = fixture(); r.sprintFvpConfig.positionStartM = .5; r.data.sprint_fvp[0].splits.forEach(p => { p.distanceM -= .5; });
  const s = F.solve(r); near(s.fit.vmax, 9); near(s.fit.tau, 1.2); assert.equal(r.data.sprint_fvp[0].splits[0].distanceM, 4.5);
});
test("timing-gate start requires an explicit determined correction", () => {
  const r = fixture(); r.sprintFvpConfig.timingStart = "gate_crossing";
  const s = F.solve(r); assert.equal(s.valid, false); assert.match(s.reason, /时间修正/);
});
test("legacy startConvention remains explicit when timingStart is absent", () => {
  const r = fixture(); delete r.sprintFvpConfig.timingStart; r.sprintFvpConfig.startConvention = "gate_crossing";
  const restored = M.normalizeRecord(json(r)); assert.equal(restored.sprintFvpConfig.timingStart, "gate_crossing");
  assert.equal(F.solve(restored).valid, false); assert.equal(F.solve(r).valid, false);
});
test("start-signal reaction time uses explicit negative correction", () => {
  const r = fixture(); r.sprintFvpConfig.timingStart = "start_signal"; r.sprintFvpConfig.timeCorrectionS = -.15;
  r.data.sprint_fvp[0].splits.forEach(p => { p.timeS += .15; }); const s = F.solve(r);
  assert.equal(s.valid, true); near(s.fit.tau, 1.2); near(s.fit.vmax, 9);
  r.sprintFvpConfig.timeCorrectionS = .15; assert.equal(F.solve(r).valid, false);
});
test("partial, repeated and out-of-order splits remain reviewable", () => {
  const mutations = [r => { r.data.sprint_fvp[0].splits[1].timeS = ""; }, r => { r.data.sprint_fvp[0].splits[1].timeS = times[0]; },
    r => { r.data.sprint_fvp[0].splits[1].distanceM = 4; }, r => { r.data.sprint_fvp[0].splits = r.data.sprint_fvp[0].splits.slice(0, 3); }];
  mutations.forEach(fn => { const r = fixture(); fn(r); const s = F.solve(r); assert.equal(s.valid, false); assert.equal(s.status, "review"); assert.equal(s.trials.length, 1); });
});
test("fastest complete same-distance trial wins and excluded fast trials do not", () => {
  const r = fixture(), slow = json(r.data.sprint_fvp[0]), fast = json(slow), excluded = json(slow);
  slow.id = "slow"; slow.splits.forEach(p => { p.timeS *= 1.1; }); fast.id = "fast"; excluded.id = "excluded"; excluded.excluded = true;
  excluded.splits.forEach(p => { p.timeS *= .8; }); r.data.sprint_fvp = [slow, excluded, fast];
  const s = F.solve(r); assert.equal(s.selectedTrialId, "fast"); assert.equal(s.trials.filter(t => t.selected).length, 1);
  assert.equal(s.trials[1].eligible, false); assert.equal(s.points.length, 5);
});
test("different terminal distances select longest protocol and never splice trials", () => {
  const r = fixture(), short = json(r.data.sprint_fvp[0]); short.id = "short30"; short.splits.pop(); short.splits.forEach(p => { p.timeS *= .9; });
  r.data.sprint_fvp.unshift(short); assert.equal(F.solve(r).selectedTrialId, "sprint_synthetic");
});
test("sprint optimum conserves power and returns distance exactly", () => {
  const s = F.solve(fixture()), o = s.optimum; assert.equal(o.valid, true); near(o.F0 * o.V0 / 4, s.model.Pmax);
  near(F.distanceAt(o.timeS, o.vmax, o.tau), 40); assert.ok(o.slope < -.03 && o.slope > -1.9);
  assert.ok(F.performance(o.Pmax, o.slope * .99, o.relativeDrag, 40).timeS >= o.timeS);
  assert.ok(F.performance(o.Pmax, o.slope * 1.01, o.relativeDrag, 40).timeS >= o.timeS);
});
test("target distance changes optimum and imbalance while measured profile stays identical", () => {
  const r = fixture(), a = F.solve(r); r.sprintFvpAnalysis.targetDistanceM = 10; const b = F.solve(r);
  near(a.model.F0, b.model.F0); assert.ok(b.optimum.slope < a.optimum.slope); assert.notEqual(a.imbalancePct, b.imbalancePct);
  assert.equal(b.targetDistanceM, 10); assert.equal(b.optimum.withinStudySimulation, true); assert.equal(a.optimum.withinStudySimulation, false);
});
test("wind adjusts measured mechanics and withholds unsupported optimum classification", () => {
  const r = fixture(), calm = F.solve(r); r.sprintFvpConfig.windMps = 2; const windy = F.solve(r);
  assert.equal(windy.valid, true); assert.notEqual(windy.model.Pmax, calm.model.Pmax);
  assert.equal(windy.optimum, null); assert.equal(windy.imbalance, null); assert.match(windy.optimumReason, /无风/);
});
test("imbalance directions use slope ratio with no invented severity bins", () => {
  assert.equal(F.imbalance(-.4, -.8).direction, "force"); assert.equal(F.imbalance(-1.2, -.8).direction, "velocity");
  assert.equal(F.imbalance(-.8, -.8).direction, "balanced"); near(F.imbalance(-.4, -.8).profilePct, 50);
  assert.equal(F.imbalance(-.4, -.8).severity, undefined);
});
test("numerical boundaries do not produce false optimum or unbounded sample arrays", () => {
  assert.equal(F.optimum(20, .001, .003).valid, false);
  assert.equal(F.mechanics({ vmax: 9, tau: 1.2 }, 75, .3, 0, 1e20).valid, false);
  assert.equal(F.timeAtDistance(-1, 9, 1.2), null); assert.equal(F.performance(Infinity, -.5, .003, 30), null);
});
test("paper and public-workbook sampling windows are explicitly different", () => {
  const fit = { vmax: 9, tau: 1.2 }, K = F.airResistance(75, 1.8, 20, 1013.25).K;
  const paper = F.mechanics(fit, 75, K, 0, times[4]);
  const workbookWindow = F.mechanics(fit, 75, K, 0, 6, { stepS: .01, rfAfterS: .5 });
  assert.equal(workbookWindow.sampleCount, 600); assert.equal(workbookWindow.rfSampleCount, 550);
  assert.ok(paper.RFmax > workbookWindow.RFmax); assert.notEqual(paper.DRF, workbookWindow.DRF);
  const hpa = F.airResistance(75, 1.8, 20, 998), torrMistake = F.airResistance(75, 1.8, 20, 998 * 1013.25 / 760);
  const hpaModel = F.mechanics(fit, 75, hpa.K, 0, times[4]), torrModel = F.mechanics(fit, 75, torrMistake.K, 0, times[4]);
  const metrics = model => ({ F0: model.F0, V0: model.V0, Pmax: model.Pmax, RFmax: model.RFmax, RFmaxPct: 100 * model.RFmax, DRF: model.DRF });
  const comparison = { fixture: { source: "synthetic, not user workbook verification", massKg: 75, heightCm: 180, temperatureC: 20, pressureHpa: 1013.25, windMps: 0, vmaxMps: 9, tauS: 1.2, terminalDistanceM: 40, terminalTimeS: times[4] },
    paper: { stepS: .1, rfCondition: "t > 0.3 s", rfFirstSampleS: .4, endTimeS: times[4], ...metrics(paper) },
    publicWorkbookWindow: { stepS: .01, rfCondition: "t >= 0.51 s", rfFirstSampleS: .51, endTimeS: 6, ...metrics(workbookWindow) },
    pressureComparison: { input: 998, temperatureC: 20, correctedHpa: { densityKgM3: hpa.density, ...metrics(hpaModel) }, misreadAsTorr: { densityKgM3: torrMistake.density, ...metrics(torrModel) } } };
  const resultDir = path.join(__dirname, "../output/tests"); fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, "sprint-window-comparison.json"), JSON.stringify(comparison, null, 2));
  console.log("WINDOW_COMPARISON " + JSON.stringify(comparison));
});
test("record defaults and native registry keep sprint disabled", () => {
  const r = M.defaults(); assert.equal(r.enabled.sprint_fvp, false); assert.equal(r.sprintFvpVersion, 1);
  assert.equal(T.isNative(r, "sprint_fvp"), true); assert.equal(T.snapshots(r).find(t => t.id === "sprint_fvp").measurementVersion, 1);
});
test("stats publishes canonical units and selected record progress", () => {
  const r = fixture(), s = M.stats(r); assert.equal(s.validTests.has("sprint_fvp"), true);
  near(s.values.sprint_fvp_f0, s.sprintFvp.model.F0); near(s.values.sprint_fvp_rfmax, s.sprintFvp.model.RFmax * 100);
  near(s.values.sprint_fvp_drf, s.sprintFvp.model.DRF); assert.match(M.recordProgressDetail(r, "sprint_fvp", s).detail, /40 m/);
  r.enabled.sprint_fvp = false; const disabled = M.stats(r); assert.equal(disabled.validTests.has("sprint_fvp"), false); assert.equal(disabled.values.sprint_fvp_f0, undefined);
});
test("JSON serialization and normalize preserve raw inputs, analysis and unknown metadata", () => {
  const r = fixture(); r.data.sprint_fvp[0].sourceMetadata = { imported: "synthetic" }; r.sprintFvpAnalysis.targetDistanceM = 20;
  r.sprintFvpConfig.timeCorrectionS = .1; const restored = M.normalizeRecord(json(r)); M.validateRecord(restored);
  assert.equal(restored.data.sprint_fvp[0].sourceMetadata.imported, "synthetic"); assert.equal(restored.data.sprint_fvp[0].splits[0].timeS, times[0]);
  assert.equal(restored.sprintFvpAnalysis.targetDistanceM, 20); assert.equal(restored.sprintFvpConfig.timeCorrectionS, .1);
  assert.equal(restored.sprintFvpConfig.methodVersion, F.METHOD_VERSION); assert.equal(restored.sprintFvpConfig.sampleStepS, .1);
  assert.equal(restored.sprintFvpConfig.rfAfterS, .3); assert.equal(restored.sprintFvpConfig.samplingWindow, "terminal_time");
});
test("saved capability choices and both iDSI windows round-trip with option validation", () => {
  const r = fixture(); r.views.capabilitySelections = { strength: "idsi_fixed250", reactive: "hop_rsi", speed: "srr" };
  r.views.idsiWindow = "idsi_fixed250"; const restored = M.normalizeRecord(json(r)); M.validateRecord(restored);
  assert.deepEqual(json(restored.views.capabilitySelections), json(r.views.capabilitySelections));
  restored.views.capabilitySelections.strength = "invented_standard"; assert.throws(() => M.validateRecord(restored), /指标选项/);
});
test("unrecognized saved method versions keep raw data without silently recomputing", () => {
  const r = fixture(); r.sprintFvpConfig.methodVersion = "future-method-v2"; const restored = M.normalizeRecord(json(r)); M.validateRecord(restored);
  assert.equal(F.solve(restored).valid, false); assert.equal(restored.sprintFvpConfig.methodVersion, "future-method-v2");
  assert.equal(restored.data.sprint_fvp[0].splits[0].timeS, times[0]);
});
test("legacy same-name custom data and metric remain unconverted and inactive", () => {
  const old = M.defaults(); delete old.sprintFvpVersion; delete old.enabled.sprint_fvp;
  old.projectSnapshots = T.snapshots(old).filter(t => t.id !== "sprint_fvp");
  old.projectSnapshots.push({ id: "sprint_fvp", name: "旧自定义冲刺", category: "performance", primaryAbility: "速度" });
  old.data.sprint_fvp = { importedValues: [1, 2, 3], notes: "原样保留" };
  old.customValues.sprint_fvp_f0 = { value: 42, notes: "历史自定义指标" };
  const before = json(old.data.sprint_fvp), restored = M.normalizeRecord(old);
  assert.deepEqual(json(restored.data.sprint_fvp), before); assert.equal(restored.enabled.sprint_fvp, false);
  assert.equal(T.isNative(restored, "sprint_fvp"), false); assert.equal(M.sprintFvpAnalysis(restored), null);
  assert.equal(restored.customValues.sprint_fvp_f0.value, 42); assert.equal(restored.definitions.find(d => d.id === "sprint_fvp_f0").legacyManual, true);
});
test("catalog retains a historical custom sprint definition instead of replacing it", () => {
  const old = M.libraryDefaults().catalog; delete old.sprintFvpVersion;
  const test = old.tests.find(t => t.id === "sprint_fvp"); delete test.measurementVersion; test.name = "历史自定义冲刺";
  const metric = old.definitions.find(d => d.id === "sprint_fvp_f0"); metric.name = "历史手工参数";
  const restored = M.normalizeCatalog(json(old)); assert.equal(T.isNative(restored, "sprint_fvp"), false);
  assert.equal(restored.tests.find(t => t.id === "sprint_fvp").name, "历史自定义冲刺");
  assert.equal(restored.definitions.find(d => d.id === "sprint_fvp_f0").name, "历史手工参数");
  assert.equal(restored.definitions.find(d => d.id === "sprint_fvp_f0").legacyManual, true);
});
test("pre-sprint native records gain a disabled empty module without stale prose", () => {
  const old = M.normalizeRecord(M.defaults()); delete old.sprintFvpVersion; delete old.enabled.sprint_fvp; delete old.data.sprint_fvp;
  delete old.sprintFvpConfig; delete old.sprintFvpAnalysis; delete old.protocol.sprint_fvp;
  old.projectSnapshots = T.snapshots(old).filter(t => t.id !== "sprint_fvp"); old.definitions = old.definitions.filter(d => d.testId !== "sprint_fvp");
  const before = M.fingerprint(old), restored = M.normalizeRecord(json(old)); assert.equal(restored.enabled.sprint_fvp, false);
  assert.equal(M.fingerprint(restored), before); assert.deepEqual(json(restored.data.sprint_fvp), []);
});
test("validation rejects duplicate explicit split identifiers within one trial", () => {
  const r = fixture(); r.data.sprint_fvp[0].splits[0].id = "same_split"; r.data.sprint_fvp[0].splits[1].id = "same_split";
  assert.throws(() => M.validateRecord(r), /ID/);
});
test("validation rejects unsafe explicit split identifiers", () => {
  ["split.1", "split 1", "", null, 0, "__proto__", "prototype", "constructor"].forEach(id => {
    const r = fixture(); r.data.sprint_fvp[0].splits[0].id = id;
    assert.throws(() => M.validateRecord(r), /ID/, `unsafe split id ${JSON.stringify(id)}`);
  });
});
test("legacy missing split IDs normalize stably without replacing raw inputs or method metadata", () => {
  const r = fixture(); r.data.sprint_fvp[0].splits[0].id = "sprint_split_1";
  r.data.sprint_fvp[0].splits[0].sourceMetadata = { imported: "synthetic" };
  r.sprintFvpConfig.sampleStepS = .01; r.sprintFvpConfig.rfAfterS = .5;
  const raw = json(r.data.sprint_fvp[0].splits), config = json(r.sprintFvpConfig);
  M.validateRecord(r);
  const restored = M.normalizeRecord(json(r)), again = M.normalizeRecord(json(restored)), splits = restored.data.sprint_fvp[0].splits;
  M.validateRecord(restored); assert.equal(new Set(splits.map(split => split.id)).size, splits.length);
  assert.ok(splits.every(split => typeof split.id === "string" && /^[A-Za-z0-9_-]+$/.test(split.id)));
  assert.deepEqual(json(again.data.sprint_fvp[0].splits), json(splits));
  assert.deepEqual(json(splits.map(split => { const copy = { ...split }; delete copy.id; return copy; })), raw.map(split => { delete split.id; return split; }));
  assert.deepEqual(json(restored.sprintFvpConfig), config);
});
test("separate trials may reuse explicit split identifiers", () => {
  const r = fixture(); r.data.sprint_fvp[0].splits.forEach((split, i) => { split.id = `split_${i}`; });
  const second = json(r.data.sprint_fvp[0]); second.id = "sprint_synthetic_second"; r.data.sprint_fvp.push(second);
  assert.doesNotThrow(() => M.validateRecord(r));
});
test("technical split IDs do not change calculations or measurement fingerprint", () => {
  const r = M.normalizeRecord(fixture()), before = json(r), fingerprint = M.fingerprint(r), expected = F.solve(r);
  r.data.sprint_fvp[0].splits.forEach((split, i) => { split.id = `replacement_${i}`; }); M.validateRecord(r);
  const actual = F.solve(r); assert.equal(M.fingerprint(r), fingerprint);
  const actualFit = json(actual.fit), expectedFit = json(expected.fit);
  [actualFit, expectedFit].forEach(fit => fit.points.forEach(point => { delete point.id; }));
  assert.deepEqual(actualFit, expectedFit); assert.deepEqual(json(actual.model), json(expected.model));
  assert.deepEqual(json(r.data.sprint_fvp[0].splits.map(({ distanceM, timeS }) => ({ distanceM, timeS }))), before.data.sprint_fvp[0].splits.map(({ distanceM, timeS }) => ({ distanceM, timeS })));
});
test("validation rejects malformed native split payloads and duplicate trial identifiers", () => {
  const mutations = [r => { r.data.sprint_fvp[0].splits[0].timeS = "not-time"; }, r => { r.data.sprint_fvp[0].splits = {}; },
    r => { r.data.sprint_fvp.push(json(r.data.sprint_fvp[0])); }, r => { r.sprintFvpConfig.pressureHpa = "NaN"; }];
  mutations.forEach(fn => { const r = fixture(); fn(r); assert.throws(() => M.validateRecord(r)); });
  assert.match(M.validateField(fixture(), "sprintFvpConfig.pressureHpa", -1), /大于 0/);
});
console.log(`${passed} sprint FVP model checks passed`);
