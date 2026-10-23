"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { context, createFixture } = require("./helpers/longitudinal-fixture.cjs"), c = context();
for (const name of ["metric-semantics", "comparison", "horizontal"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const M = c.RingsideModel, H = c.RingsideHorizontal, S = c.RingsideMetricSemantics;
const copy = x => JSON.parse(JSON.stringify(x));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function record(person, id, date, values, options = {}) {
  const r = M.defaults(); r.demo = false; r.athleteId = person; r.recordId = id; r.athlete.name = person;
  r.athlete.date = date; r.athlete.sex = "男"; r.athlete.birthDate = "2000-01-01"; r.mode = "mean";
  Object.keys(r.enabled).forEach(key => r.enabled[key] = false);
  r.customTests.push({ id: "arbitrary", name: "没有固定专项名称", category: "performance", primaryMetricId: "value", selectionDirection: "higher" });
  r.enabled.arbitrary = true; r.protocol.arbitrary = "一致协议";
  for (const [id, meaning, direction] of [["value", "numeric", "higher"], ["neutral", "numeric", "none"], ["grade", "ordinal", "higher"]]) r.definitions.push({ id, testId: "arbitrary", name: id, unit: "u", entryScope: "attempt", category: "performance", ability: "", protocol: "一致指标协议", ranges: [], referenceEnabled: false, direction, directionStatus: "confirmed", resultMeaning: meaning, measurementScale: meaning === "ordinal" ? "ordinal" : "ratio" });
  r.data.arbitrary = values.map((value, i) => ({ id: id + "_" + i, metrics: { value, ...(options.missingNeutral ? {} : { neutral: options.neutral ?? value }), grade: options.grade ?? 2 } }));
  return M.normalizeRecord(r);
}
function build(records, extra = {}) {
  const ids = [...new Set(records.map(r => r.athleteId))];
  return H.build(records, { participants: ids.slice(0, 2).map(athleteId => ({ athleteId, recordId: records.find(r => r.athleteId === athleteId).recordId })),
    athletes: ids.map(id => ({ id, profile: { name: id, sex: "男", sportId: "sport" } })),
    references: [{ id: "all", label: "全库", scope: "all", sex: "男", sampling: "latest" }], window: { kind: "all", from: null, to: null }, mode: "mean", ...extra });
}
const metric = (model, id) => model.references[0].projects.flatMap(p => p.metrics).find(row => row.metricId === id);
test("ordinary unknown-scale legacy values may average without confirming an automatic direction", () => {
  const d = S.normalize({ id: "user", testId: "x", direction: "higher", ratioEligible: false }, { legacy: true });
  assert.equal(d.direction, "higher"); assert.equal(d.resultMeaning, "numeric"); assert.equal(S.resolve(d).direction, "unconfirmed");
});
test("per-person weighting never pools trials or all historic records", () => {
  const records = [record("a", "a1", "2026-01-01", [10, 10, 10]), record("a", "a2", "2026-02-01", [20]), record("b", "b1", "2026-01-01", [40])];
  const before = JSON.stringify(records), result = metric(build(records), "value");
  near(result.benchmark.mean, 30); assert.equal(result.benchmark.n, 2); assert.equal(JSON.stringify(records), before);
});
test("window and tested age filter before most recent selection", () => {
  const records = [record("a", "a1", "2025-12-01", [10]), record("a", "a2", "2026-02-01", [100]), record("b", "b1", "2025-12-02", [30])];
  const model = build(records, { references: [{ id: "all", scope: "all", ageMin: 25, ageMax: 25, sampling: "latest" }] });
  near(metric(model, "value").benchmark.mean, 20);
  const bounded = build(records, { window: { kind: "custom", from: "2025-12-01", to: "2025-12-31" } });
  near(metric(bounded, "value").benchmark.mean, 20);
});
test("latest project missing companion is not filled from an older test", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("a", "a2", "2026-02-01", [20], { missingNeutral: true }), record("b", "b1", "2026-01-01", [40])];
  const result = metric(build(records), "neutral"); assert.equal(result.benchmark.n, 1); near(result.benchmark.mean, 40);
  records[1].definitions = records[1].definitions.filter(d => d.id !== "neutral");
  assert.equal(metric(build(records), "neutral").benchmark.n, 1);
});
test("period records and neutral recent fallback are labeled and use independent people", () => {
  const records = [record("a", "a1", "2026-01-01", [50], { neutral: 5 }), record("a", "a2", "2026-02-01", [20], { neutral: 9 }), record("b", "b1", "2026-01-01", [40], { neutral: 11 })];
  const model = build(records, { references: [{ id: "all", scope: "all", sampling: "period-record" }] });
  near(metric(model, "value").benchmark.mean, 45); near(metric(model, "neutral").benchmark.mean, 10);
  assert.equal(metric(model, "neutral").benchmark.sampling, "latest"); assert.equal(metric(model, "neutral").benchmark.best, null);
});
test("ordinal observations keep distribution and no arithmetic mean", () => {
  const result = metric(build([record("a", "a1", "2026-01-01", [10], { grade: 1 }), record("b", "b1", "2026-01-01", [20], { grade: 3 })]), "grade").benchmark;
  assert.equal(result.mean, null); assert.deepEqual(copy(result.distribution.map(x => [x.value, x.count])), [[1, 1], [3, 1]]);
});
test("category codes never acquire arithmetic differences or a numerical best", () => {
  const records = [record("a", "a1", "2026-01-01", [1]), record("b", "b1", "2026-01-01", [3])];
  records.forEach(r => r.definitions.find(d => d.id === "value").resultMeaning = "category");
  const row = metric(build(records), "value"); assert.equal(row.benchmark.mean, null); assert.equal(row.benchmark.best, null); assert.ok(row.differences.every(d => !d.available));
});
test("same-day ordering and tied best sources are deterministic", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("a", "a2", "2026-01-01", [40]), record("b", "b1", "2026-01-01", [40])];
  records[1].created = "2026-01-01T12:00:00Z"; records[0].created = "2026-01-01T11:00:00Z";
  const a = metric(build(records), "value").benchmark, b = metric(build(records.slice().reverse()), "value").benchmark;
  assert.deepEqual(copy(a.contributors), copy(b.contributors)); assert.equal(a.bestSources.length, 2);
});
test("demo records are excluded while archived athlete records remain eligible", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("b", "b1", "2026-01-01", [30]), record("demo", "d1", "2026-01-01", [100])]; records[2].demo = true;
  const model = build(records, { athletes: [{ id: "a", profile: { sex: "男" } }, { id: "b", archived: true, profile: { sex: "男" } }, { id: "demo", profile: { sex: "男" } }] });
  near(metric(model, "value").benchmark.mean, 20);
});
test("recycle-bin records and profiles cannot contribute", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("b", "b1", "2026-01-01", [30]), record("b", "b2", "2026-02-01", [100])]; records[2].deletedAt = "2026-02-02";
  near(metric(build(records), "value").benchmark.mean, 20);
  assert.equal(metric(build(records, { participants: [{ athleteId: "a", recordId: "a1" }], athletes: [{ id: "a", profile: { sex: "男" } }, { id: "b", deletedAt: "2026-02-02", profile: { sex: "男" } }] }), "value").benchmark.n, 1);
  assert.throws(() => build(records, { participants: [{ athleteId: "b", recordId: "b2" }] }));
});
test("protocol filtering precedes latest selection and direct mismatches remain separate", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("a", "a2", "2026-02-01", [100]), record("b", "b1", "2026-01-01", [30])];
  records[1].protocol.arbitrary = "另一套协议"; delete records[1].protocolIdentities.arbitrary;
  near(metric(build(records), "value").benchmark.mean, 20);
  const model = build(records, { participants: [{ athleteId: "a", recordId: "a2" }, { athleteId: "b", recordId: "b1" }] });
  const rows = model.projects.flatMap(p => p.metrics).filter(row => row.metricId === "value");
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.cells.filter(Boolean).length === 1));
});
test("current classifications use stable IDs while contributor ages retain measurement dates", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("b", "b1", "2026-01-01", [30])];
  records[0].athlete.sportId = "old";
  const model = build(records, { athletes: [{ id: "a", groupId: "team", profile: { sex: "女", sportId: "new", subdivisionId: "sub" } }, { id: "b", groupId: "team", profile: { sex: "男", sportId: "new" } }], references: [{ id: "ref", scope: "sport", sportId: "new", subdivisionId: "sub", sex: "女", ageMin: 26, ageMax: 26 }] });
  assert.equal(metric(model, "value").benchmark.n, 1); near(metric(model, "value").benchmark.mean, 10);
});
test("participant colors stay stable through ordering and frozen model remains plain JSON", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("b", "b1", "2026-01-01", [30])], first = build(records), second = build(records.slice().reverse());
  for (const person of first.participants) assert.equal(person.color, second.participants.find(p => p.athleteId === person.athleteId).color);
  assert.equal(JSON.stringify(first), JSON.stringify(copy(first))); records[0].data.arbitrary[0].metrics.value = 999; assert.equal(first.participants[0].record.data.arbitrary[0].metrics.value, 10);
});
test("equal-peer evidence does not silently choose the first person as its baseline", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("b", "b1", "2026-01-01", [30])], model = build(records, { perspective: "peers", references: [] });
  assert.ok(model.projects.flatMap(p => p.metrics).every(row => row.differences.every(d => !d.available)));
});
test("canonical direction is independent of the active historical evaluation scheme", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("a", "a2", "2026-02-01", [50]), record("b", "b1", "2026-01-01", [30])];
  const profile = c.RingsideEvaluation.create(records[0]); const rule = profile.standards.find(r => r.metricId === "value"); rule.direction = "lower"; rule.enabled = true; rule.targetEnabled = true; rule.target = 100;
  const model = build(records, { profile, references: [{ id: "all", scope: "all", sampling: "period-record" }] });
  near(metric(model, "value").benchmark.mean, 40); assert.equal(metric(model, "value").direction, "higher");
});
test("compatible force units share the current catalog direction without relabeling raw sources", () => {
  const records = [record("a", "a1", "2026-01-01", [10]), record("b", "b1", "2026-01-01", [30])];
  for (const r of records) r.definitions.find(d => d.id === "value").unit = "N";
  const converted = M.changeMetricUnit(records[1], "value", "kgf", "convert"); records[1] = converted;
  const catalog = M.mergeCatalog(null, records[0]); catalog.definitions.find(d => d.id === "value").direction = "lower";
  const row = metric(build(records, { catalog }), "value"); near(row.benchmark.mean, 20); near(row.benchmark.best, 10); assert.equal(row.direction, "lower");
  assert.equal(row.cells[1].rawUnit, "kgf");
});
test("new standards inherit the metric and neutral metrics cannot enable target-ratio scoring", () => {
  const r = record("a", "a1", "2026-01-01", [10]), E = c.RingsideEvaluation, profile = E.create(r), subjects = E.ruleSubjects(r, profile);
  profile.standards = profile.standards.filter(rule => rule.metricId !== "neutral");
  const subject = subjects.find(s => s.metricId === "neutral"), rule = E.ensureStandard(profile, subject);
  assert.equal(subject.performanceDirection.direction, "none"); assert.equal(rule.directionSource, "metric"); assert.equal(rule.direction, "none"); E.validateProfile(profile, r);
  rule.targetEnabled = true; rule.target = 5; assert.throws(() => E.validateProfile(profile, r));
});
test("legacy absent directions retain their historical higher target while explicit neutral does not", () => {
  const r = record("a", "a1", "2026-01-01", [10]), definition = copy(r.definitions.find(d => d.id === "value")); delete definition.direction;
  Object.assign(definition, { target: 20, referenceEnabled: true });
  const create = d => c.RingsideEvaluation.normalizeProfile({ id: "legacy", name: "旧方案", revision: 1, criteria: { definitions: [d], iso: [], balance: [], rules: copy(r.rules), axes: {}, lvp: {} } }, r).standards[0];
  assert.equal(create(definition).direction, "higher"); assert.equal(create(definition).targetEnabled, true);
  assert.equal(create({ ...definition, direction: "none" }).targetEnabled, false);
});
test("direction binding preserves legacy rules unless explicitly adopted and reviews conflicts", () => {
  const r = record("a", "a1", "2026-01-01", [10]), E = c.RingsideEvaluation, profile = E.create(r), catalog = M.mergeCatalog(null, r);
  const rule = profile.standards.find(s => s.metricId === "value"); rule.direction = "lower";
  const original = JSON.stringify(profile), untouched = E.bindMetricDirections(profile, catalog);
  assert.equal(untouched.standards.find(s => s.metricId === "value").direction, "lower");
  assert.equal(E.bindMetricDirections(profile, catalog, { adoptLegacy: true }).standards.find(s => s.metricId === "value").direction, "higher");
  assert.equal(E.reviewDirections(catalog, [profile]).conflicts.find(x => x.metricId === "value").profileDirection, "lower"); assert.equal(JSON.stringify(profile), original);
});
test("native parameter direction metadata does not rewrite historical raw definitions", () => {
  const definition = c.RingsideTests.extraDefinitions().find(d => d.id === "fvp_sj_f0");
  assert.equal(definition.direction, "higher"); assert.equal(S.resolve(definition).direction, "none"); assert.equal(S.normalize(definition, { legacy: true }).direction, "higher");
});
test("FVP uses each athlete's own propulsion distance and averages independently solved scalars", () => {
  const fixture = createFixture(c, 2), records = fixture.records;
  records.forEach((r, i) => { r.athleteId = "person" + i; r.fvpConfig.fvp_sj.distanceCm = 30 + i * 10; });
  const model = build(records), row = metric(model, "fvp_sj_f0");
  assert.equal(row.benchmark.n, 2); near(row.benchmark.mean, row.cells.reduce((sum, cell) => sum + cell.value, 0) / 2); assert.equal(row.benchmark.best, null);
  assert.equal(row.benchmark.contributors.map(x => Object.values(x.subjectInputs)[0]).join(","), "30,40");
  assert.ok(!model.references[0].fvp); assert.equal(model.participants.length, 2);
  assert.equal(model.capability.cards.find(card => card.id === "strength").metrics.find(row => row.metricId === "fvp_sj_fe").benchmark.n, 2);
});
test("derived ratios average each person's result and latest missing dependencies are not backfilled", () => {
  const fixture = createFixture(c, 3), records = fixture.records;
  records[0].athleteId = "a"; records[1].athleteId = "b"; records[2].athleteId = "a";
  records[0].data.cmj.forEach(row => row.height = 40); records[0].data.sj.forEach(row => row.height = 20);
  records[1].data.cmj.forEach(row => row.height = 30); records[1].data.sj.forEach(row => row.height = 10);
  let model = build(records.slice(0, 2));
  const derived = model => model.capability.cards.find(card => card.id === "strength").metrics.find(row => row.metricId === "eur");
  near(derived(model).benchmark.mean, 2.5);
  records[2].data.sj = []; model = build(records);
  assert.equal(derived(model).benchmark.n, 1); near(derived(model).benchmark.mean, 3);
});
test("structured ISO FMS IMTP and LVP results declare directions at their producer", () => {
  const fixture = createFixture(c, 2), records = fixture.records; records.forEach((r, i) => { r.athleteId = "person" + i; });
  const subject = c.RingsideEvaluation.ruleSubjects(records[0]).find(s => s.id === "imtp-time:force_pct_peak:100"); c.RingsideEvaluation.ensureStandard(fixture.profile, subject);
  const model = build(records, { profile: fixture.profile }), rows = model.projects.flatMap(p => p.metrics);
  const iso = rows.find(row => row.testId === "iso" && row.section === "force" && row.benchmark.n);
  assert.equal(iso.direction, "higher"); assert.ok(iso.benchmark.best !== null);
  const fms = rows.find(row => row.testId === "fms" && row.benchmark.n); assert.equal(fms.meaning, "ordinal"); assert.equal(fms.aggregation.mean, true); assert.ok(fms.benchmark.mean !== null); assert.ok(fms.benchmark.best !== null);
  const imtp = rows.find(row => row.testId === "imtp" && row.unit === "%PF" && row.benchmark.n); assert.equal(imtp.direction, "higher"); assert.ok(imtp.benchmark.best !== null);
  const estimated = rows.find(row => row.id.startsWith("lvp-fit:") && row.id.endsWith(":1rm")); assert.equal(estimated.direction, "higher"); assert.ok(estimated.benchmark.best !== null); assert.equal(estimated.sourceKind, "model");
  assert.ok(rows.filter(row => row.section === "balance" || row.section === "asymmetry").every(row => row.benchmark.best === null));
});
test("larger populations retain equal person weighting and compact auditable contributions", () => {
  const records = Array.from({ length: 60 }, (_, i) => record("population_" + i, "test_" + i, "2026-01-01", Array.from({ length: i % 5 + 1 }, () => i + 1)));
  records.push(record("population_0", "test_latest", "2026-02-01", [101]));
  const model = build(records, { references: Array.from({ length: 4 }, (_, i) => ({ id: "reference" + i, scope: "all", label: "参照" + i })) });
  for (const reference of model.references) {
    const b = reference.projects.flatMap(p => p.metrics).find(row => row.metricId === "value").benchmark;
    assert.equal(b.n, 60); near(b.mean, (60 * 61 / 2 + 100) / 60);
    assert.ok(b.contributors.every(item => !Object.hasOwn(item, "rawTrials") && item.sourceFingerprint && item.profile.testedAge === 26));
    assert.equal(b.contributors.filter(item => item.athleteId === "population_0").length, 1);
  }
});
console.log(`${passed} horizontal model checks passed`);
