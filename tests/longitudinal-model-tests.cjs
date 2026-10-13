"use strict";
const assert = require("node:assert/strict");
const { context, createFixture } = require("./helpers/longitudinal-fixture.cjs"), c = context();
const M = c.RingsideModel, E = c.RingsideEvaluation, L = c.RingsideLongitudinal;
const copy = value => JSON.parse(JSON.stringify(value));
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-8, `${value} != ${expected}`);
const metric = (model, id) => model.projects.flatMap(project => project.metrics).find(row => row.id === id);
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }

test("selection identity and chronology ignore click order while same-day records remain distinct", () => {
  const f = createFixture(c); f.records[1].athlete.date = f.records[0].athlete.date; f.records[0].created = "2026-01-01T03:00:00Z"; f.records[1].created = "2026-01-01T02:00:00Z";
  const a = L.build(f.records, f), b = L.build(f.records.slice().reverse(), f);
  assert.equal(a.key, b.key); assert.equal(a.basis, b.basis); assert.deepEqual(copy(a.recordIds), [f.records[1].recordId, f.records[0].recordId, f.records[2].recordId]);
  assert.notEqual(a.periods[0].label, a.periods[1].label); assert.equal(L.key("a", ["b", "a", "b"]), JSON.stringify(["a", ["a", "b"]]));
});
test("invalid dates foreign athletes and duplicate records cannot enter a comparison", () => {
  const f = createFixture(c); assert.throws(() => L.build([f.records[0]], f));
  for (const date of ["", "2026-02-30", "2026-13-01", "0000-01-01"]) { const records = copy(f.records); records[0].athlete.date = date; assert.throws(() => L.build(records, f)); }
  const records = copy(f.records); records[0].athleteId = "other"; assert.throws(() => L.build(records, f)); assert.throws(() => L.build([f.records[0], f.records[0]], f));
});
test("all periods use latest mode and one profile with their own ages and masses without mutation", () => {
  const f = createFixture(c), before = JSON.stringify(f), options = { athleteId: f.athleteId, profile: f.profile, catalog: f.catalog }, model = L.build(f.records, options);
  assert.equal(model.mode, "mean"); assert.deepEqual(copy(metric(model, "cmj_height").cells.map(cell => cell.value)), [40, 42, 44]);
  assert.deepEqual(copy(model.periods.map(period => period.record.athlete.age)), [25, 26, 26]); assert.deepEqual(copy(model.periods.map(period => period.record.athlete.mass)), [75, 76, 77]);
  assert.ok(model.periods.every(period => period.record.evaluationProfileRevision === f.profile.revision)); assert.equal(JSON.stringify(f), before);
  const best = L.build(f.records, { ...options, mode: "best" }); assert.deepEqual(copy(metric(best, "cmj_height").cells.map(cell => cell.value)), [42, 44, 46]);
  assert.equal(metric(best, "cmj_height").cells[0].statistics.mean, 40); assert.equal(metric(best, "cmj_height").cells[0].statistics.sd, 2);
});
test("overall and recent changes use fixed endpoints and missing periods break connections", () => {
  const f = createFixture(c), full = L.build(f.records, f), row = metric(full, "cmj_height");
  near(row.changes.overall.delta, 4); near(row.changes.overall.percent, 10); near(row.changes.recent.delta, 2); assert.equal(row.changes.overall.improvement, "improved");
  f.records[0].data.cmj = []; let missing = metric(L.build(f.records, f), "cmj_height"); assert.equal(missing.changes.overall.available, false); assert.equal(missing.changes.recent.available, true); assert.equal(missing.cells[1].comparableToPrevious, false);
  f.records[1].data.cmj = []; missing = metric(L.build(f.records, f), "cmj_height"); assert.equal(missing.changes.recent.available, false); assert.equal(missing.cells[2].comparableToPrevious, false);
  assert.equal(metric(L.build(full.records.slice(0, 2), f), "cmj_height").changes.recent, null);
});
test("percentage points ordinal transitions unknown scales and zero baselines use honest quantities", () => {
  const f = createFixture(c), model = L.build(f.records, f), percent = metric(model, "long_pct"), ordinal = metric(model, "fms:0"), unknown = metric(model, "long_unknown");
  assert.equal(percent.changes.overall.kind, "percentage-point"); near(percent.changes.overall.delta, 10); assert.ok(!("percent" in percent.changes.overall));
  assert.equal(ordinal.changes.overall.kind, "ordinal"); assert.ok(!("percent" in ordinal.changes.overall)); assert.ok(!("percent" in unknown.changes.overall));
  f.records[0].data.pushup = { reps: 0, trials: [{ id: "zero", reps: 0 }] }; f.records[2].data.pushup = { reps: 5, trials: [{ id: "five", reps: 5 }] };
  const zero = metric(L.build(f.records, f), "pushup_reps"); near(zero.changes.overall.delta, 5); assert.ok(!("percent" in zero.changes.overall));
  assert.equal(metric(model, "long_time").changes.overall.improvement, "improved");
});
test("protocol and incompatible unit identities suppress changes without hiding observations", () => {
  const f = createFixture(c); f.records[2].protocolIdentities.cmj.version++;
  let row = metric(L.build(f.records, f), "cmj_height"); assert.equal(row.changes.overall.available, false); assert.equal(row.cells[2].value, 44); assert.equal(row.cells[2].comparableToPrevious, false);
  f.records[2].definitions.find(d => d.id === "long_time").unit = "ms";
  row = metric(L.build(f.records, f), "long_time"); assert.equal(row.changes.overall.available, false); assert.equal(row.cells[0].unit, "s"); assert.equal(row.cells[2].unit, "ms");
});
test("disabled evaluation never guesses improvement from a familiar metric name", () => {
  const f = createFixture(c); f.profile.standards.find(rule => rule.metricId === "cmj_height").enabled = false;
  const row = metric(L.build(f.records, f), "cmj_height"); assert.equal(row.changes.overall.available, true); assert.equal(row.changes.overall.improvement, null);
});
test("native derivative units are not relabelled as simple percentage-point changes", () => {
  const f = createFixture(c), row = metric(L.build(f.records, f), "sprint_fvp_drf");
  assert.equal(row.unit, "百分点/(m/s)"); assert.equal(row.changes.overall.kind, "absolute"); assert.ok(!("percent" in row.changes.overall));
});
test("lactate threshold methods and LVP velocity definitions govern comparison eligibility", () => {
  const f = createFixture(c); f.records[2].thresholds.method = "固定4mmol阈值"; f.records[2].lvp.bench.metric = "PV";
  const model = L.build(f.records, f); assert.equal(metric(model, "lt2").changes.overall.available, false);
  assert.equal(metric(model, "lvp:bench:20").changes.overall.available, false);
});
test("known force conversions preserve physical differences and CV in custom repeated data", () => {
  const f = createFixture(c);
  for (const r of f.records) { const d = r.definitions.find(d => d.id === "long_unknown"); d.unit = "N"; d.measurementScale = "ratio"; d.cvEligible = true; }
  f.records[2] = M.changeMetricUnit(f.records[2], "long_unknown", "kgf", "convert");
  const row = metric(L.build(f.records, f), "long_unknown"); assert.equal(row.unit, "kgf"); assert.equal(row.changes.overall.available, true); near(row.changes.overall.delta, 2 / 9.80665); near(row.cells[0].statistics.mean, 50 / 9.80665);
});
test("risk axes contain measured regions only and unknown grades stay null", () => {
  const f = createFixture(c);
  for (const r of f.records) { Object.keys(r.enabled).forEach(id => r.enabled[id] = id === "iso"); r.isoDirectionIds = ["iso_neck_flexion"]; r.data.iso.find(row => row.id === "iso_neck_flexion").center = 120; }
  f.profile.standards.find(rule => rule.directionId === "iso_neck_flexion").reference.enabled = false;
  const model = L.build(f.records, f); assert.deepEqual(copy(model.risk.axes), [{ key: "neck", label: "颈部" }]); assert.equal(model.risk.series[0].values[0], null);
  f.records[2].data.iso.find(row => row.id === "iso_neck_flexion").painCenter = true;
  const painful = L.build(f.records, f); assert.equal(painful.risk.series[2].values[0], 1); assert.equal(painful.risk.series[2].cells[0].pain, true);
});
test("risk grade changes with different test coverage cannot be described as improvement", () => {
  const f = createFixture(c); for (const r of f.records) { Object.keys(r.enabled).forEach(id => r.enabled[id] = id === "iso"); r.isoDirectionIds = ["iso_shoulder_flexion"]; const row = r.data.iso.find(row => row.id === "iso_shoulder_flexion"); row.left = 150; row.right = 150; row.target = 100; }
  f.profile = E.create(f.records.at(-1)); f.records[0].data.iso.find(row => row.id === "iso_shoulder_flexion").painLeft = true;
  f.records[2].isoDirectionIds.push("iso_shoulder_extension"); const extra = f.records[2].data.iso.find(row => row.id === "iso_shoulder_extension"); extra.left = 120; extra.right = 120;
  const model = L.build(f.records, f), row = model.risk.rows.find(row => row.id === "shoulder_l"); assert.ok(row.cells[0].coverageKey !== row.cells[2].coverageKey); assert.equal(row.changes.overall.improvement, null);
});
test("every specialized result and original graph model remains available beside generic metrics", () => {
  const f = createFixture(c), model = L.build(f.records, f), ids = model.projects.map(project => project.id);
  for (const id of ["fms", "iso", "cmj", "sj", "dj", "hop", "cmrj", "imtp", "landmine", "bench", "squat", "deadlift", "mb", "lactate", "cpet", "ift", "mas", "mss", "fvp_sj", "fvp_cmj", "sprint_fvp", "long_generic"]) assert.ok(ids.includes(id), id);
  for (const period of model.periods) { assert.ok(period.stats.fvp.fvp_sj.valid); assert.ok(period.stats.sprintFvp.valid); assert.equal(typeof period.stats.lvpSeries[0].fit.predict, "function"); assert.equal(period.report.projects.find(project => project.id === "long_generic").reportView.kind, "column"); }
  assert.ok(model.capability.cards.length); assert.ok(model.overview.axes.length); assert.ok(!("directions" in model.overview));
  assert.equal(model.projects.find(project => project.id === "landmine").metrics.filter(row => row.id.startsWith("lvp:")).length, 0);
  const imtp = model.projects.find(project => project.id === "imtp").metrics; assert.equal(imtp.filter(row => row.name === "IMTP 100 ms 力" && row.unit === "N").length, 1);
});
test("compact basis tracks measurement mode profile and catalogue but ignores source narrative", () => {
  const f = createFixture(c), a = L.build(f.records, f); assert.ok(a.basis.length < 80); assert.equal(a.fingerprint, a.basis);
  f.records[0].narrative.text = "修改单期正文"; assert.equal(L.build(f.records, f).basis, a.basis);
  f.records[0].data.cmj[0].height++; assert.notEqual(L.build(f.records, f).basis, a.basis);
  const b = L.build(f.records, f).basis; f.profile.revision++; assert.notEqual(L.build(f.records, f).basis, b);
  const d = L.build(f.records, f).basis; f.catalog.revision++; assert.notEqual(L.build(f.records, f).basis, d);
});
test("seven periods preserve chronology fixed endpoints and gaps without counting clicks as dates", () => {
  const f = createFixture(c, 7); f.records[2].data.cmj = []; f.records[4].protocolIdentities.cmj.version++;
  const shuffled = [f.records[4], f.records[0], f.records[6], f.records[2], f.records[5], f.records[1], f.records[3]], model = L.build(shuffled, f), row = metric(model, "cmj_height");
  assert.deepEqual(copy(model.recordIds), f.records.map(record => record.recordId));
  assert.deepEqual(copy(row.cells.map(cell => cell?.comparableToPrevious ?? null)), [false, true, null, false, false, false, true]);
  near(row.changes.overall.delta, 12); near(row.changes.recent.delta, 2);
  assert.equal(row.changes.recent.from.recordId, f.records[5].recordId);
  f.records[0].data.cmj = []; const missing = metric(L.build(f.records, f), "cmj_height");
  assert.equal(missing.changes.overall.available, false); near(missing.changes.recent.delta, 2);
});
test("FVP tables retain fitted optimal and scenario parameters as separate original quantities", () => {
  const f = createFixture(c), model = L.build(f.records, f), first = model.periods[0].stats;
  near(metric(model, "fvp_sj:profile:slope").cells[0].value, first.fvp.fvp_sj.current.slope);
  near(metric(model, "fvp_sj:profile:r2").cells[0].value, first.fvp.fvp_sj.fit.r2);
  near(metric(model, "fvp_sj:optimum:F0").cells[0].value, first.fvp.fvp_sj.optimum.F0);
  near(metric(model, "fvp_sj:elasticity:heightCm").cells[0].value, first.fvp.fvp_sj.verticalCurrent.heightCm);
  near(metric(model, "fvp_sj:elasticity:both1pct").cells[0].value, first.fvp.fvp_sj.elasticity.Fe + first.fvp.fvp_sj.elasticity.ve);
  near(metric(model, "sprint_fvp:elasticity:timeS").cells[0].value, first.sprintElasticity.current.timeS);
  near(metric(model, "sprint_fvp:scenario:ER").cells[0].value, first.sprintElasticity.scenario.elasticity.ER);
  for (const row of model.projects.filter(project => /fvp/.test(project.id)).flatMap(project => project.metrics).filter(row => row.id.includes(":"))) {
    assert.ok(["profile", "elasticity", "scenario"].includes(row.section));
    assert.ok(["profile", "optimum", "model", "scenario"].includes(row.sourceKind));
    assert.ok([null, "unchanged"].includes(row.changes.overall.improvement));
  }
});
test("sprint target-distance and scenario changes affect only their dependent model comparisons", () => {
  const f = createFixture(c); f.records[2].sprintFvpAnalysis.targetDistanceM = 40;
  f.records[2].fvpAnalysis.fvp_sj.deltaForcePct = 10;
  const model = L.build(f.records, f);
  assert.equal(metric(model, "sprint_fvp_f0").changes.overall.available, true);
  for (const id of ["sprint_fvp_imbalance", "sprint_fvp:optimum:F0", "sprint_fvp:elasticity:timeS"]) assert.equal(metric(model, id).changes.overall.available, false, id);
  assert.equal(metric(model, "fvp_sj:elasticity:heightCm").changes.overall.available, true);
  assert.equal(metric(model, "fvp_sj:scenario:heightCm").changes.overall.available, false);
});
test("LVP keeps original regression estimates zones and their measurement definitions", () => {
  const f = createFixture(c), full = L.build(f.records, f), series = full.periods[0].stats.lvpSeries.find(series => series.id === "squat");
  near(metric(full, "lvp-fit:squat:slope").cells[0].value, series.fit.b);
  near(metric(full, "lvp-fit:squat:intercept").cells[0].value, series.fit.a);
  near(metric(full, "lvp-fit:squat:1rm").cells[0].value, series.est.load);
  near(metric(full, "lvp-fit:squat:relative1rm").cells[0].value, series.est.load / 75);
  const zone = series.zoneLoads[0], zoneRow = metric(full, "lvp-zone:squat:" + zone.label + ":loadMin");
  near(zoneRow.cells[0].value, zone.loadMin); assert.equal(zoneRow.cells[0].notes, zone.extrapolated ? "含外推" : "实测范围");
  assert.ok(!("percent" in metric(full, "lvp-fit:squat:slope").changes.overall));
  f.records[2].lvp.squat.metric = "PV"; const changed = L.build(f.records, f);
  assert.equal(metric(changed, "lvp-fit:squat:slope").changes.overall.available, false);
  assert.equal(metric(changed, "lvp-fit:squat:1rm").cells[2], null);
});
test("age reference changes preserve physical delta without claiming improvement", () => {
  const f = createFixture(c), rule = f.profile.standards.find(rule => rule.metricId === "cmj_height");
  rule.referenceGroups = [{ id: "under26", sex: "any", ageMin: 0, ageMax: 26, target: 45, ranges: [], source: "青年" }, { id: "over26", sex: "any", ageMin: 26, ageMax: 100, target: 50, ranges: [], source: "成人" }];
  const row = metric(L.build(f.records, f), "cmj_height"); near(row.changes.overall.delta, 4); assert.equal(row.changes.overall.improvement, null); assert.equal(row.changes.overall.reason, "评价条件不同");
  assert.equal(row.changes.recent.improvement, "improved");
});
test("nonmonotonic assessment intervals do not inherit a residual higher-is-better flag", () => {
  const f = createFixture(c), rule = f.profile.standards.find(rule => rule.metricId === "cmj_height");
  rule.targetEnabled = false; rule.ranges = [{ min: null, max: 39, status: "red", label: "低", includeMax: false }, { min: 39, max: 43, status: "green", label: "适宜", includeMin: true, includeMax: false }, { min: 43, max: null, status: "red", label: "高", includeMin: true }];
  const row = metric(L.build(f.records, f), "cmj_height"); near(row.changes.overall.delta, 4); assert.equal(row.changes.overall.improvement, null);
  rule.targetEnabled = true; rule.target = 45;
  assert.equal(metric(L.build(f.records, f), "cmj_height").changes.overall.improvement, null);
});
test("derived capability context follows every contributing test protocol", () => {
  const f = createFixture(c); f.records[2].protocolIdentities.hop.version++;
  const row = L.build(f.records, f).capability.cards.flatMap(card => card.metrics).find(row => row.id === "rqr");
  assert.ok(row); assert.equal(row.changes.overall.available, false);
});
test("force DSI distinguishes IMTP from a separately entered isometric test", () => {
  const f = createFixture(c); for (const record of f.records) for (const trial of record.data.cmj) trial.force = 1500;
  f.records[2].dsi.source = "manual"; f.records[2].dsi.protocol = "Isometric squat"; f.records[2].dsi.force = 2500;
  const row = L.build(f.records, f).capability.cards.flatMap(card => card.metrics).find(row => row.id === "fdsi");
  assert.ok(row); assert.ok(row.cells[0].value > 0 && row.cells[2].value > 0); assert.equal(row.changes.overall.available, false);
});
test("Hop uses selected complete-test input mode and speed tests retain the recorded method", () => {
  const f = createFixture(c), last = f.records[2];
  last.data.hop.trials[0].inputMode = "summary";
  last.data.hop.trials[0].summary = { height: 35, contactTimeMs: 150, flightTimeMs: 520, rsi: 2.33, flightTimeRatio: 3.47, selectionBasis: "flight_ratio", suppliedCount: 10, validCount: 10, selectedCount: 5 };
  for (const id of ["mas", "mss", "ift"]) last.data[id].method = "改变了测试方法或测量距离";
  const model = L.build(f.records, f);
  for (const id of ["hop_rsi", "mas_speed", "mss_speed", "ift_treadmill"]) {
    const row = metric(model, id); assert.ok(row, id); assert.equal(row.changes.overall.available, false, id); assert.ok(row.cells[2].value > 0, id);
  }
});
test("force-only configuration does not change the identity of CMJ height or RSI-modified", () => {
  const f = createFixture(c); f.records[2].cmjConfig.definition = "net"; f.records[2].cmjConfig.impulseDefinition = "net";
  const model = L.build(f.records, f);
  for (const id of ["cmj_height", "cmj_rsi_modified"]) assert.equal(metric(model, id).changes.overall.available, true, id);
});
test("derived dependency context includes the selected Hop result acquisition method", () => {
  const f = createFixture(c); f.records[2].data.hop.trials[0].inputMode = "summary";
  f.records[2].data.hop.trials[0].summary = { height: 35, contactTimeMs: 150, flightTimeMs: 520, rsi: 2.33, flightTimeRatio: 3.47, selectionBasis: "height_rsi", suppliedCount: 10, validCount: 10, selectedCount: 5 };
  const model = L.build(f.records, f), card = model.capability.cards.flatMap(card => card.metrics).find(row => row.id === "rqr");
  assert.ok(card.cells[0] && card.cells[2]); assert.equal(card.changes.overall.available, false);
  const protocol = card.cells[2].context.protocols.find(item => item.testId === "hop");
  assert.equal(protocol.settings.protocols[0].inputMode, "summary"); assert.equal(protocol.settings.protocols[0].selectionBasis, "height_rsi");
});
test("known IMTP force unit conversion is not blocked by redundant test settings", () => {
  const f = createFixture(c), last = f.records[2]; last.imtpConfig.unit = "kgf"; last.definitions.find(d => d.id === "imtp_peak_force").unit = "kgf";
  for (const trial of last.data.imtp) { trial.peakForce /= 9.80665; trial.baselineForce /= 9.80665; for (const point of trial.timePoints) point.force /= 9.80665; }
  const row = metric(L.build(f.records, f), "imtp_peak_force"); assert.equal(row.changes.overall.available, true); near(row.changes.overall.delta, 300 / 9.80665);
});
test("AI facts carry dates results and honest changes without raw report graphs or invented statistics", () => {
  const f = createFixture(c), model = L.build(f.records, f), facts = L.facts(model), json = JSON.stringify(facts);
  assert.equal(facts.periods.length, 3); assert.ok(facts.projects.find(project => project.id === "cmj").metrics[0].changes.overall.available);
  assert.doesNotMatch(json, /"(?:pValue|cohenD|mdc|sem|effectSize|rawTrials|report|data)"/); assert.doesNotMatch(json, /独立单期人工正文/);
  assert.ok(Buffer.byteLength(json) < 300000); assert.match(facts.resultOrder, /periods/);
  const scenario = facts.projects.find(project => project.id === "sprint_fvp").metrics.find(row => row.id === "sprint_fvp:scenario:timeS");
  assert.equal(scenario.sourceKind, "scenario");
  assert.equal(facts.measurementContexts[scenario.results[0].contextIndex].targetDistanceM, 30);
});
console.log(passed + " longitudinal model checks passed");
