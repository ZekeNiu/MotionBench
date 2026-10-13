"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), child = require("node:child_process");
const { loadComparisonContext, demoRecord } = require("./helpers/comparison-fixtures.cjs"), c = loadComparisonContext(), M = c.RingsideModel, C = c.RingsideComparison;
const json = value => JSON.parse(JSON.stringify(value)), near = (actual, expected, tolerance = 1e-9) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
let passed = 0; const test = (name, run) => { run(); passed++; console.log("PASS " + name); };
function fixture(count = 4, dates = ["2026-01-01", "2026-01-16", "2026-03-02"]) {
  const athletes = Array.from({ length: count }, (_, i) => ({ id: "a" + i, name: "合成队员" + i, profile: {}, groupId: "g", records: dates.map((date, period) => {
    const r = M.defaults(); r.athleteId = "a" + i; r.recordId = "r" + i + "_" + period; r.athlete.name = "合成队员" + i; r.athlete.date = date;
    r.enabled = Object.fromEntries(Object.keys(r.enabled).map(id => [id, id === "cmj"]));
    r.data.cmj = [{ id: "trial1", height: 20 + i * 2 + period * (i + 1), force: 1200 + i * 50 }, { id: "trial2", height: 19 + i * 2 + period * (i + 1), force: 1100 + i * 50 }];
    return r;
  }) }));
  return { library: { athletes, groups: [{ id: "g", name: "合成队伍" }], catalog: M.normalizeCatalog(), evaluationProfiles: [] },
    selection: { groupId: "g", athleteIds: athletes.map(a => a.id), dates, recordChoices: {}, basis: { strength: "eur", reactive: "dj_rsi", speed: "srr", jumpProtocol: "fvp_sj" } } };
}
const derive = ({ library, selection }) => C.deriveComparison(C.readComparisonInputs(library, selection));
test("sample SD, R type-7 quantiles and CV agree with independent arithmetic", () => {
  const s = C.descriptive([1, 2, 3, 4, 5], true); near(s.mean, 3); near(s.sd, Math.sqrt(2.5)); near(s.median, 3); near(s.q1, 2); near(s.q3, 4); near(s.iqr, 2); near(s.cv, Math.sqrt(2.5) / 3 * 100);
  const two = C.descriptive([1, 2], true); near(two.sd, Math.sqrt(.5)); near(two.q1, 1.25); near(two.q3, 1.75);
  assert.equal(C.descriptive([0, 0], true).cv, null); assert.equal(C.descriptive([-1, 2], true).cv, null); assert.equal(C.descriptive(["", "not a number", null]).n, 0);
});
test("Student-t tails and inversion match exact small-df identities and published critical values", () => {
  near(C.studentP(1, 1), .5); near(C.studentP(Math.sqrt(2), 2), 1 - 1 / Math.sqrt(2)); near(C.studentP(0, 20), 1);
  near(C.criticalT(1), 12.706204736432095, 1e-8); near(C.criticalT(2), 4.302652729696142, 1e-8); near(C.criticalT(10), 2.2281388519649385, 1e-8);
});
test("paired changes, confidence interval and Cohen's dz use across-athlete difference SD", () => {
  const s = C.paired([10, 12, 14, 16], [11, 14, 17, 20], { allowPercent: true, unit: "cm" });
  near(s.delta, 2.5); near(s.sdChange, Math.sqrt(5 / 3)); near(s.t, 2.5 / (Math.sqrt(5 / 3) / 2)); near(s.dz, 2.5 / Math.sqrt(5 / 3)); near(s.percentChange, 2.5 / 13 * 100);
  near(s.ciLow, 2.5 - 3.182446305284263 * Math.sqrt(5 / 3) / 2, 1e-8); near(s.ciHigh, 2.5 + 3.182446305284263 * Math.sqrt(5 / 3) / 2, 1e-8);
});
test("zero variance, one person and ordinal data preserve deltas without inventing inference", () => {
  for (const result of [C.paired([1], [2]), C.paired([1, 2], [2, 3]), C.paired([1, 2], [1, 2]), C.paired([1, 2], [2, 4], { continuous: false })]) {
    assert.equal(result.p, null); assert.equal(result.dz, null); assert.equal(result.ciLow, null); assert.ok(result.reason);
  }
  const result = C.paired([0, 0], [2, 3], { allowPercent: true }); assert.equal(result.percentChange, null); near(result.delta, 2.5);
  assert.equal(C.paired([40, 50], [45, 58], { unit: "%" }).deltaUnit, "百分点");
});
test("Holm is monotone, includes nonestimable planned comparisons and retains original order", () => {
  assert.deepEqual(json(C.holm([.01, .04, .03])), [.03, .06, .06]);
  assert.deepEqual(json(C.holm([.01, null, .04], 3)), [.03, null, .08]);
  assert.deepEqual(json(C.holm([.9, .8, 1])), [1, 1, 1]);
});
test("trend uses actual elapsed dates and needs at least three dates", () => {
  const result = C.trend([{ date: "2026-01-01", mean: 10, n: 3 }, { date: "2026-01-16", mean: 11.5, n: 3 }, { date: "2026-03-02", mean: 16, n: 3 }]);
  near(result.slopePerDay, .1); near(result.slopePer30Days, 3); near(result.r2, 1); assert.equal(C.trend(result.points.slice(0, 2).map(point => ({ ...point, mean: point.value }))).available, false);
});
test("date sorting and resolved record bindings are deterministic and readers remain pure", () => {
  const f = fixture(), before = JSON.stringify(f.library); f.selection.dates.reverse();
  const input = C.readComparisonInputs(f.library, f.selection); assert.deepEqual(json(input.dates), ["2026-01-01", "2026-01-16", "2026-03-02"]); assert.equal(input.selection.recordChoices.a0["2026-01-16"], "r0_1"); assert.equal(input.ready, true);
  derive(f); assert.equal(JSON.stringify(f.library), before);
});
test("same-date duplicate records must be chosen explicitly and invalid bindings are rejected", () => {
  const f = fixture(); const extra = json(f.library.athletes[0].records[0]); extra.recordId = "repeat"; f.library.athletes[0].records.push(extra);
  const input = C.readComparisonInputs(f.library, f.selection); assert.equal(input.ready, false); assert.equal(input.issues.find(item => item.athleteId === "a0").kind, "ambiguous-record");
  f.selection.recordChoices.a0 = { "2026-01-01": "repeat" }; assert.equal(C.readComparisonInputs(f.library, f.selection).ready, true);
  f.selection.recordChoices.a0["2026-01-01"] = "r1_0"; assert.equal(C.readComparisonInputs(f.library, f.selection).ready, false);
});
test("one representative value per athlete; extra trials never inflate team n", () => {
  const f = fixture(); f.selection.dates = [f.selection.dates[0]];
  f.library.athletes[0].records[0].data.cmj.push({ id: "third", height: 18 });
  const metric = derive(f).metrics.find(item => item.id === "cmj_height"); assert.equal(metric.periods[0].n, 4); near(metric.periods[0].mean, 23); near(metric.periods[0].sd, Math.sqrt(20 / 3));
});
test("an explicit recorded CV preference is respected for ratio measurements", () => {
  const f = fixture(); f.selection.dates = [f.selection.dates[0]];
  for (const athlete of f.library.athletes) athlete.records[0].definitions.find(d => d.id === "cmj_height").cvEligible = false;
  assert.equal(derive(f).metrics.find(item => item.id === "cmj_height").periods[0].cv, null);
  for (const athlete of f.library.athletes) athlete.records[0].definitions.find(d => d.id === "cmj_height").cvEligible = true;
  assert.ok(derive(f).metrics.find(item => item.id === "cmj_height").periods[0].cv > 0);
});
test("fixed complete cohort applies across all selected dates including plotted means", () => {
  const f = fixture(); f.library.athletes[1].records[1].data.cmj = [];
  const metric = derive(f).metrics.find(item => item.id === "cmj_height"); assert.deepEqual(json(metric.cohortIds), ["a0", "a2", "a3"]);
  assert.deepEqual(json(metric.periods.map(period => period.n)), [3, 3, 3]); assert.equal(metric.changes[0].n, 3); near(metric.periods[0].mean, (20 + 24 + 26) / 3);
  assert.equal(metric.observations.filter(item => item.athleteId === "a1").length, 3);
});
test("units, protocol and aggregation policy cannot silently merge", () => {
  const f = fixture(2); f.library.athletes[0].records[1].protocol.cmj = "不同摆臂条件"; f.library.athletes[0].records[1].protocolIdentities.cmj = M.protocolIdentity("test:cmj", "不同摆臂条件");
  const models = derive(f).metrics.filter(item => item.id === "cmj_height"); assert.equal(models.length, 2); assert.deepEqual(json(models.map(item => item.cohortIds.length).sort()), [0, 1]);
  const g = fixture(2); g.library.athletes[1].records[1].mode = "mean"; assert.equal(derive(g).metrics.filter(item => item.id === "cmj_height").length, 2);
});
test("each missing or incompatible cell preserves its actual record link and precise reason", () => {
  const f = fixture(4), dates = f.selection.dates;
  f.library.athletes[0].records[1].protocol.cmj = "不同摆臂条件"; f.library.athletes[0].records[1].protocolIdentities.cmj = M.protocolIdentity("test:cmj", "不同摆臂条件");
  f.library.athletes[1].records[1].definitions.find(d => d.id === "cmj_height").unit = "mm";
  f.library.athletes[2].records[1].mode = "mean";
  f.library.athletes[3].records.pop();
  const metric = derive(f).metrics.find(item => item.id === "cmj_height" && item.identity.aggregation === "best" && item.identity.unit === "cm" && item.observations.some(item => item.athleteId === "a0" && item.date === dates[0] && item.value === 20));
  const cell = (id, date) => metric.observations.find(item => item.athleteId === id && item.date === date);
  assert.equal(cell("a0", dates[0]).reason, "");
  assert.match(cell("a0", dates[1]).reason, /协议|条件/); assert.equal(cell("a0", dates[1]).recordId, "r0_1"); assert.equal(cell("a0", dates[1]).value, null);
  assert.match(cell("a1", dates[1]).reason, /单位不一致.*mm/); assert.equal(cell("a1", dates[1]).recordId, "r1_1");
  assert.match(cell("a2", dates[1]).reason, /取值口径不一致.*mean/); assert.equal(cell("a2", dates[1]).recordId, "r2_1");
  assert.equal(cell("a3", dates[2]).recordId, ""); assert.match(cell("a3", dates[2]).reason, /本日没有有效记录/);
  f.library.athletes[0].records[0].enabled.cmj = false;
  const disabled = derive(f).metrics.find(item => item.key === metric.key).observations.find(item => item.athleteId === "a0" && item.date === dates[0]);
  assert.equal(disabled.reason, "本记录未测此指标"); assert.equal(disabled.recordId, "r0_0");
});
test("negative time changes retain sign while improvement is labelled separately", () => {
  const f = fixture(2); for (const athlete of f.library.athletes) for (const [index, record] of athlete.records.entries()) {
    record.definitions.push({ id: "time", testId: "cmj", name: "时间", unit: "s", category: "performance", ability: "速度", direction: "lower", entryScope: "record", legacyManual: true, measurementScale: "ratio", ranges: [], referenceEnabled: false }); record.customValues.time = { value: 4 - index * .2 };
  }
  const metric = derive(f).metrics.find(item => item.id === "time"); near(metric.changes[0].delta, -.2); assert.equal(metric.changes[0].improvement, "improved"); assert.ok(metric.changes[0].percentChange < 0);
});
test("single athlete longitudinal never reports team paired significance or dz", () => {
  const f = fixture(1), model = derive(f); assert.equal(model.kind, "personal-longitudinal"); assert.equal(model.statistics.comparisonCount, 0);
  for (const metric of model.metrics) for (const change of metric.changes) { assert.equal(change.p, null); assert.equal(change.pAdjusted, null); assert.equal(change.dz, null); }
});
test("all report comparisons share one Holm family independent of presentation", () => {
  const f = fixture(), first = derive(f); f.library.catalog.reportViews = {}; const second = derive(f);
  assert.deepEqual(json(first.metrics.map(metric => metric.changes)), json(second.metrics.map(metric => metric.changes)));
  const pairs = first.metrics.flatMap(metric => metric.changes).filter(change => change.p !== null); assert.ok(pairs.length > 0); pairs.forEach(change => assert.ok(change.pAdjusted >= change.p));
});
test("missing dates remain on team roster and cannot imply a resolved concern", () => {
  const f = fixture(2); f.library.athletes[0].records[0].definitions.find(d => d.id === "cmj_height").referenceEnabled = true;
  f.library.athletes[0].records[0].definitions.find(d => d.id === "cmj_height").ranges = [{ min: 0, max: 100, status: "red", label: "需改善" }];
  f.library.athletes[0].records.pop(); const model = derive(f); assert.equal(model.summary.latest.selectedCount, 2); assert.equal(model.summary.latest.resultCount, 1);
  const transition = model.summary.transitions.find(item => item.athleteId === "a0" && item.toDate === "2026-03-02" && item.key.startsWith("metric:cmj_height")); assert.equal(transition.state, "unknown");
});
test("summary counts each athlete once for each status even with multiple findings", () => {
  const f = fixture(2); f.selection.dates = [f.selection.dates[0]];
  for (const athlete of f.library.athletes) { const record = athlete.records[0]; for (const id of ["cmj_height", "cmj_peak_force"]) { const d = record.definitions.find(d => d.id === id); d.referenceEnabled = true; d.ranges = [{ min: 0, max: null, status: "red", label: "需改善" }]; } }
  assert.equal(derive(f).summary.latest.redCount, 2);
});
test("stable content digest matches standard UTF-8 SHA256 and stays compact", () => {
  for (const text of ["", "abc", "团队测试🏅", "x".repeat(1000)]) assert.equal(C.hash(text), "sha256:" + crypto.createHash("sha256").update(text).digest("hex"));
  const f = fixture(), first = derive(f); assert.equal(first.fingerprint.length, 71); f.library.athletes[0].records[0].data.cmj[0].height += .1; assert.notEqual(derive(f).fingerprint, first.fingerprint);
});
test("complex protocol extraction preserves FMS side scores/pain and IMTP units/timepoints", () => {
  const record = demoRecord(c, 0, 0), library = { athletes: [{ id: record.athleteId, name: record.athlete.name, records: [record] }], catalog: M.mergeCatalog(null, record), evaluationProfiles: [] };
  const model = C.deriveComparison(C.readComparisonInputs(library, { athleteIds: [record.athleteId], dates: [record.athlete.date] }));
  assert.ok(model.metrics.some(metric => metric.id === "imtp_f50" && metric.unit === "N" && metric.identity.timeMs === 50));
  assert.ok(model.metrics.some(metric => metric.id === "imtp_f50_pct_peak" && metric.unit === "%PF"));
  const fms = model.metrics.filter(metric => metric.testId === "fms"); assert.ok(fms.some(metric => metric.identity.side === "L")); assert.ok(fms.every(metric => metric.continuous === false));
  assert.ok(model.curves.some(curve => curve.kind === "elasticity_constraint")); assert.ok(model.curves.some(curve => curve.kind === "elasticity_constraint_er"));
  assert.equal(model.projects.filter(project => project.id.startsWith("demo_generic")).length, 6);
});
test("complex curve means share supported coordinates and never turn disjoint lactate data into means", () => {
  const r = demoRecord(c, 0, 0), second = json(r); second.athleteId = "other"; second.recordId = "other_record"; second.athlete.mass = 80; second.fvpConfig.fvp_sj.distanceCm = 40; second.data.lactate.forEach(point => { point.speed += .1; });
  const library = { athletes: [{ id: r.athleteId, name: r.athlete.name, records: [r] }, { id: "other", name: "另一合成队员", records: [second] }], catalog: M.mergeCatalog(null, r), evaluationProfiles: [] };
  const model = C.deriveComparison(C.readComparisonInputs(library, { athleteIds: [r.athleteId, "other"], dates: [r.athlete.date] }));
  const fv = model.curves.find(curve => curve.testId === "fvp_sj" && curve.kind === "fv"); assert.equal(fv.series.length, 2); assert.ok(fv.common.every(point => point.n === 2));
  const low = Math.max(...fv.series.map(series => series.supportedMin)), high = Math.min(...fv.series.map(series => series.supportedMax)); assert.ok(fv.common.every(point => point.x >= low - 1e-9 && point.x <= high + 1e-9));
  assert.equal(model.curves.find(curve => curve.kind === "lactate").common.length, 0);
});
test("each capability applies one explicitly selected basis to each athlete/date", () => {
  const f = fixture(), model = derive(f); assert.ok(model.entries.every(entry => entry.directions.find(direction => direction.id === "strength").metricId === "eur"));
  assert.equal(model.capabilities.find(card => card.id === "strength").basis, "eur");
});
test("capability distributions and parameters retain the full-history fixed cohort", () => {
  const f = fixture(3);
  for (const athlete of f.library.athletes) for (const record of athlete.records) { record.enabled.sj = true; record.data.sj = [{ id: "sj", height: 18 }]; }
  f.library.athletes[1].records[1].data.sj = [];
  const card = derive(f).capabilities.find(card => card.id === "strength"); assert.deepEqual(json(card.cohortIds), ["a0", "a2"]);
  assert.deepEqual(json(card.periods.map(period => period.n)), [2, 2, 2]); assert.deepEqual(json(card.periods.map(period => period.availableCount)), [3, 2, 3]);
  assert.ok(card.periods.every(period => period.parameters.find(parameter => parameter.id === "eur").n === 2));
  assert.ok(card.transitions.filter(item => item.athleteId === "a1").every(item => item.state === "unknown"));
});
test("a missing middle measurement prevents a baseline-to-last status or advantage inference", () => {
  const f = fixture(2);
  for (const athlete of f.library.athletes) for (const record of athlete.records) {
    const d = record.definitions.find(d => d.id === "cmj_height"); d.referenceEnabled = true; d.ranges = [{ min: 0, max: 22, includeMax: false, status: "red", label: "需改善" }, { min: 22, max: null, status: "green", label: "优势", advantage: true }];
  }
  f.library.athletes[0].records[1].data.cmj = [];
  const model = derive(f), status = model.summary.transitions.find(item => item.athleteId === "a0" && item.toDate === "2026-03-02" && item.key.startsWith("metric:cmj_height"));
  assert.equal(status.state, "unknown");
  const advantage = model.summary.transitions.find(item => item.athleteId === "a0" && item.toDate === "2026-03-02" && item.key === "advantage:cmj_height"); assert.equal(advantage.state, "unknown");
});
test("IMTP curve means use a complete fixed cohort at each actual measurement time", () => {
  const f = fixture(3);
  for (const athlete of f.library.athletes) for (const record of athlete.records) {
    record.enabled.imtp = true; record.data.imtp = [{ id: "force", peakForce: 2000, timePoints: [{ id: "t100", timeMs: 100, force: 1000 }, { id: "t200", timeMs: 200, force: 1500 }] }];
  }
  f.library.athletes[1].records[1].data.imtp[0].timePoints.shift();
  const model = derive(f), curve = model.curves.find(curve => curve.testId === "imtp" && curve.kind === "force"), t100 = curve.common.filter(point => point.x === 100), t200 = curve.common.filter(point => point.x === 200);
  assert.deepEqual(json(t100.map(point => point.n)), [2, 2, 2]); assert.deepEqual(json(t200.map(point => point.n)), [3, 3, 3]);
  assert.ok(t100.every(point => !point.athleteIds.includes("a1")));
});
// Optional independent oracle available in the Windows development environment.
test("Student t, CI, paired dz and Holm match scipy/reference arithmetic on independent cases", () => {
  const code = "import json,numpy as np; from scipy import stats; cases=[([1,2,3],[2,5,5]),([10,11,12,13,14],[9,13,11,17,15]),([0,2,4,6],[1,1,6,9])]; result=[]\nfor a,b in cases:\n d=np.array(b,dtype=float)-np.array(a,dtype=float);n=len(d);mean=float(np.mean(d));sd=float(np.std(d,ddof=1));se=sd/n**.5;t=mean/se;crit=float(stats.t.ppf(.975,n-1));result.append(dict(delta=mean,sd=sd,t=t,p=float(stats.t.sf(abs(t),n-1)*2),dz=mean/sd,low=mean-crit*se,high=mean+crit*se))\nprint(json.dumps(result))";
  const reference = child.spawnSync("python", ["-c", code], { encoding: "utf8" });
  assert.equal(reference.status, 0, reference.stderr); const results = JSON.parse(reference.stdout), cases = [[[1,2,3],[2,5,5]],[[10,11,12,13,14],[9,13,11,17,15]],[[0,2,4,6],[1,1,6,9]]];
  results.forEach((expected, index) => { const actual = C.paired(...cases[index]); for (const [key, field] of [["delta","delta"],["sd","sdChange"],["t","t"],["p","p"],["dz","dz"],["low","ciLow"],["high","ciHigh"]]) near(actual[field], expected[key], 1e-8); });
});
(async () => {
  const asyncTest = async (name, run) => { await run(); passed++; console.log("PASS " + name); };
  const isolated = () => {
    const context = loadComparisonContext(); context.setTimeout = setTimeout;
    let calls = 0; const original = context.RingsideModel.stats;
    context.RingsideModel.stats = (...args) => { calls++; return original(...args); };
    return { C: context.RingsideComparison, calls: () => calls };
  };
  await asyncTest("async derivation yields progress, exactly matches sync results and reuses prepared statistics", async () => {
    const isolatedContext = isolated(), f = fixture(), inputs = isolatedContext.C.readComparisonInputs(f.library, f.selection), source = JSON.stringify(inputs), progress = [];
    const model = await isolatedContext.C.deriveComparisonAsync(inputs, { onProgress: value => progress.push(json(value)), isCurrent: () => true });
    assert.equal(isolatedContext.calls(), 12); assert.equal(progress[0].current, 0); assert.equal(progress[progress.length - 1].phase, "comparison"); assert.equal(progress[progress.length - 1].current, 12);
    const sync = isolatedContext.C.deriveComparison(inputs); assert.equal(isolatedContext.calls(), 12); assert.deepEqual(json(model), json(sync)); assert.equal(JSON.stringify(inputs), source);
    const repeated = await isolatedContext.C.deriveComparisonAsync(inputs); assert.equal(isolatedContext.calls(), 12); assert.deepEqual(json(repeated), json(sync));
  });
  await asyncTest("async derivation can be cancelled before work and while browser events run between batches", async () => {
    const isolatedContext = isolated(), f = fixture(8), inputs = isolatedContext.C.readComparisonInputs(f.library, f.selection);
    await assert.rejects(isolatedContext.C.deriveComparisonAsync(inputs, { isCurrent: () => false }), error => error.name === "AbortError"); assert.equal(isolatedContext.calls(), 0);
    let current = true, eventObserved = false;
    await assert.rejects(isolatedContext.C.deriveComparisonAsync(inputs, {
      isCurrent: () => current,
      onProgress: value => { if (value.current === 4) setTimeout(() => { current = false; eventObserved = true; }, 0); }
    }), error => error.name === "AbortError");
    assert.equal(eventObserved, true); assert.equal(isolatedContext.calls(), 4);
  });
  await asyncTest("cancellation remains responsive during metric aggregation after all records are prepared", async () => {
    const isolatedContext = isolated(), f = fixture(4), inputs = isolatedContext.C.readComparisonInputs(f.library, f.selection);
    let current = true, aggregateStageReached = false;
    await assert.rejects(isolatedContext.C.deriveComparisonAsync(inputs, {
      isCurrent: () => current,
      onProgress: value => { if (value.stage === "metric-statistics") { aggregateStageReached = true; setTimeout(() => { current = false; }, 0); } }
    }), error => error.name === "AbortError");
    assert.equal(aggregateStageReached, true); assert.equal(isolatedContext.calls(), 12);
    const model = await isolatedContext.C.deriveComparisonAsync(inputs); assert.equal(model.ready, true); assert.equal(isolatedContext.calls(), 12);
  });
  await asyncTest("full-record cache keys invalidate raw measurements, units, view semantics and unified report basis", async () => {
    const isolatedContext = isolated(), f = fixture(2), initial = await isolatedContext.C.deriveComparisonAsync(isolatedContext.C.readComparisonInputs(f.library, f.selection));
    assert.equal(isolatedContext.calls(), 6);
    f.library.athletes[0].records[0].data.cmj[0].height += 1;
    const changed = await isolatedContext.C.deriveComparisonAsync(isolatedContext.C.readComparisonInputs(f.library, f.selection)); assert.equal(isolatedContext.calls(), 7); assert.notEqual(changed.fingerprint, initial.fingerprint);
    f.library.athletes[0].records[0].definitions.find(d => d.id === "cmj_height").unit = "mm";
    await isolatedContext.C.deriveComparisonAsync(isolatedContext.C.readComparisonInputs(f.library, f.selection)); assert.equal(isolatedContext.calls(), 8);
    f.library.athletes[0].records[0].views.idsiWindow = "idsi_fixed250";
    await isolatedContext.C.deriveComparisonAsync(isolatedContext.C.readComparisonInputs(f.library, f.selection)); assert.equal(isolatedContext.calls(), 9);
    f.selection.basis.strength = "fdsi";
    const newBasis = await isolatedContext.C.deriveComparisonAsync(isolatedContext.C.readComparisonInputs(f.library, f.selection)); assert.equal(isolatedContext.calls(), 15);
    assert.ok(newBasis.entries.every(entry => entry.directions.find(direction => direction.id === "strength").metricId === "fdsi"));
  });
  await asyncTest("mutating returned results cannot poison later cached calculations", async () => {
    const isolatedContext = isolated(), f = fixture(2), inputs = isolatedContext.C.readComparisonInputs(f.library, f.selection), first = await isolatedContext.C.deriveComparisonAsync(inputs);
    first.entries[0].stats.values.cmj_height = -999; first.entries[0].stats.validTests.clear(); first.entries[0].stats.representativeData.cmj[0].height = -999;
    first.entries[0].extracted.find(item => item.id === "cmj_height").value = -999;
    const second = await isolatedContext.C.deriveComparisonAsync(inputs); assert.equal(isolatedContext.calls(), 6); assert.equal(second.entries[0].stats.values.cmj_height, 20); assert.ok(second.entries[0].stats.validTests.has("cmj"));
    assert.equal(second.entries[0].extracted.find(item => item.id === "cmj_height").value, 20);
    const complex = demoRecord(c, 0, 0), complexInput = isolatedContext.C.readComparisonInputs({ athletes: [{ id: complex.athleteId, name: complex.athlete.name, records: [complex] }], evaluationProfiles: [] }, { athleteIds: [complex.athleteId], dates: [complex.athlete.date] });
    const firstComplex = await isolatedContext.C.deriveComparisonAsync(complexInput), fit = firstComplex.entries[0].stats.lvpSeries.find(item => item.id === "squat").fit, expected = fit.predict(50);
    fit.a = -999; fit.b = -999;
    const secondComplex = await isolatedContext.C.deriveComparisonAsync(complexInput), nextFit = secondComplex.entries[0].stats.lvpSeries.find(item => item.id === "squat").fit;
    near(nextFit.predict(50), expected); assert.ok(nextFit.a > 0);
  });
  await asyncTest("160-record bound does not recompute larger async batches and evicts older cache entries", async () => {
    const isolatedContext = isolated(), f = fixture(1, ["2026-01-01"]), record = f.library.athletes[0].records[0], entries = Array.from({ length: 161 }, (_, index) => {
      const r = json(record); r.recordId = "bound_" + index; r.athleteId = "bound_athlete_" + index; r.data.cmj[0].height = 20 + index;
      return { athleteId: r.athleteId, date: "2026-01-01", recordId: r.recordId, record: r, evaluationProfile: null };
    });
    const inputs = { version: 1, selection: { ...f.selection, athleteIds: entries.map(entry => entry.athleteId) }, athletes: entries.map(entry => ({ id: entry.athleteId, name: "合成队员", profile: {} })), dates: f.selection.dates, entries, issues: [], ready: true, catalog: f.library.catalog };
    await isolatedContext.C.deriveComparisonAsync(inputs); assert.equal(isolatedContext.calls(), 161);
    isolatedContext.C.deriveComparison({ ...inputs, entries: [entries[160]] }); assert.equal(isolatedContext.calls(), 161);
    isolatedContext.C.deriveComparison({ ...inputs, entries: [entries[0]] }); assert.equal(isolatedContext.calls(), 162);
  });
  console.log(`${passed} comparison model checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
