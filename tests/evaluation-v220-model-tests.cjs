"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), modules = ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "interventions"];
const baselineRevision = "416897bd5022fbe3b7205c22b5d82f9078406b07", copy = value => JSON.parse(JSON.stringify(value));
function context(revision) {
  const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
  for (const name of modules) {
    const file = "src/ringside-" + name + ".js";
    vm.runInContext(revision ? execFileSync("git", ["show", revision + ":" + file], { cwd: root, encoding: "utf8" }) : fs.readFileSync(path.join(root, file), "utf8"), c, { filename: file });
  }
  return c;
}
const c = context(), old = context(baselineRevision), M = c.RingsideModel, E = c.RingsideEvaluation;
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
function near(actual, expected) { assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8, actual + " != " + expected); }
function fixture() {
  const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = ["cmj", "sj"].includes(id));
  r.athlete.age = 25; r.athlete.sex = "男"; r.data.cmj = [{ id: "c", height: 40 }]; r.data.sj = [{ id: "s", height: 30 }];
  for (const id of ["cmj_height", "sj_height"]) Object.assign(r.definitions.find(item => item.id === id), { referenceEnabled: true, target: 50 });
  const p = E.create(r); p.aggregations = {};
  for (const id of ["cmj_height", "sj_height"]) Object.assign(rule(p, id), { enabled: true, targetEnabled: true, target: 50, rangesEnabled: false, ranges: [] });
  return { r, p };
}
const rule = (p, id) => p.standards.find(item => item.id === "metric:" + id);
const axis = (r, p, name = "下肢爆发力") => M.stats(E.resolve(r, p)).axes.find(item => item.key === name);
function primary(p, id = "cmj_height", transform) { p.aggregations["ability:下肢爆发力"] = { method: "primary", primary: "metric:" + id, ...(transform ? { scoringVersion: 1, transforms: { ["metric:" + id]: transform } } : {}) }; }
function mean(p, ids = ["cmj_height"], transforms) { p.aggregations["ability:下肢爆发力"] = { method: "mean", members: ids.map(id => "metric:" + id), transforms: transforms || Object.fromEntries(ids.map(id => ["metric:" + id, { kind: "ratio", direction: "higher" }])) }; }
const higher = { kind: "ratio", direction: "higher" };

test("v2 absent and explicit disabled abilities do not inherit the legacy automatic representative", () => {
  const { r, p } = fixture(); assert.equal(axis(r, p), undefined);
  p.aggregations["ability:下肢爆发力"] = { method: "disabled" }; assert.equal(axis(r, p), undefined);
  assert.ok(M.stats(r).axes.length); // The unlinked legacy model remains compatible.
});
test("primary and single-member mean share the same legal target-ratio result and score metadata", () => {
  const { r, p } = fixture(); primary(p); const a = axis(r, p); near(a.value, 80); assert.equal(a.scoreUnit, "分"); assert.equal(a.scoreMax, 100);
  mean(p); const b = axis(r, p); near(b.value, a.value); assert.deepEqual(copy(b.scores), copy(a.scores));
});
test("a primary accepts score anchors without requiring an active target", () => {
  const { r, p } = fixture(); Object.assign(rule(p, "cmj_height"), { targetEnabled: false, target: null });
  primary(p, "cmj_height", { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] });
  assert.ok(E.validateProfile(p)); near(axis(r, p).value, 50);
  mean(p, ["cmj_height"], p.aggregations["ability:下肢爆发力"].transforms); near(axis(r, p).value, 50);
});
test("primary score-table endpoints and genuine gaps match single-member means", () => {
  const { r, p } = fixture(), transform = { kind: "table", ranges: [{ min: 0, max: 40, includeMax: false, score: 20 }, { min: 40, max: 50, score: 70 }, { min: 60, max: null, score: 100 }] };
  for (const [value, expected] of [[39, 20], [40, 70], [50, 70], [55, null], [60, 100]]) {
    r.data.cmj[0].height = value; primary(p, "cmj_height", transform); const a = axis(r, p);
    if (expected === null) assert.equal(a, undefined); else near(a.value, expected);
    mean(p, ["cmj_height"], { "metric:cmj_height": transform }); const b = axis(r, p);
    if (expected === null) assert.equal(b, undefined); else near(b.value, expected);
  }
});
test("primary optimal-range anchors have the same interpolation and saturation as means", () => {
  const { r, p } = fixture(), transform = { kind: "anchors", shape: "range", points: [{ value: 10, score: 0 }, { value: 20, score: 100 }, { value: 40, score: 100 }, { value: 50, score: 0 }] };
  for (const [value, expected] of [[5, 0], [15, 50], [30, 100], [45, 50], [55, 0]]) { r.data.cmj[0].height = value; primary(p, "cmj_height", transform); near(axis(r, p).value, expected); }
});
test("primary retains the chosen metric grade even when the explicit ability score differs", () => {
  const { r, p } = fixture(); Object.assign(rule(p, "cmj_height"), { rangesEnabled: true, ranges: [{ min: 0, max: null, label: "用户等级", status: "green" }] });
  primary(p, "cmj_height", { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] });
  const s = M.stats(E.resolve(r, p)); near(s.axes[0].value, 50); assert.equal(s.axes[0].status, "green");
  assert.equal(s.evaluationResults.find(item => item.metricId === "cmj_height").grade.label, "用户等级");
});
test("mean still uses fixed members, equal weights and only its own explicit grading bands", () => {
  const { r, p } = fixture(); rule(p, "sj_height").target = 60; mean(p, ["cmj_height", "sj_height"]);
  near(axis(r, p).value, 65); assert.equal(axis(r, p).status, "gray");
  p.aggregations["ability:下肢爆发力"].ranges = [{ min: 60, max: 100, label: "用户平均等级", status: "green" }]; assert.equal(axis(r, p).status, "green");
  r.data.sj = []; assert.equal(axis(r, p), undefined);
});
test("missing disabled inapplicable or incompatible primary results never select another measured metric", () => {
  for (const fail of [(r, p) => r.data.cmj = [], (r, p) => rule(p, "cmj_height").enabled = false, (r, p) => rule(p, "cmj_height").conditions = { sex: "female" }, (r, p) => r.protocolIdentities.cmj.version++]) {
    const { r, p } = fixture(); primary(p); fail(r, p); assert.equal(axis(r, p), undefined);
  }
});
function custom(scale = "ordinal", value = 2, zeroValid = false) {
  const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = false); r.enabled.rating = true;
  r.customTests.push({ id: "rating", name: "合成等级", category: "performance", primaryMetricId: "rating_score", selectionDirection: "higher" });
  r.definitions.push({ id: "rating_score", testId: "rating", name: "合成等级", unit: "等级", ability: "速度", category: "performance", entryScope: "record", direction: "higher", target: 3, referenceEnabled: true, ranges: [], protocol: "合成测量", measurementScale: scale, ratioEligible: scale === "ratio", zeroValid });
  r.customValues.rating_score = { value, notes: "保留原始数据" };
  const normalized = M.normalizeRecord(r), p = E.create(normalized); p.aggregations = { "ability:速度": { method: "primary", primary: "metric:rating_score" } }; return { r: normalized, p };
}
test("ordinal and unknown scales cannot bypass ratio validity through a primary", () => {
  for (const scale of ["ordinal", "unknown"]) { const { r, p } = custom(scale); assert.equal(axis(r, p, "速度"), undefined); assert.equal(r.customValues.rating_score.value, 2); }
});
test("ordinal score tables are supported while ordinal continuous anchors remain invalid", () => {
  const { r, p } = custom(); p.aggregations["ability:速度"].scoringVersion = 1; p.aggregations["ability:速度"].transforms = { "metric:rating_score": { kind: "table", ranges: [{ min: 2, max: 2, score: 70 }] } }; near(axis(r, p, "速度").value, 70);
  p.aggregations["ability:速度"].transforms["metric:rating_score"] = { kind: "anchors", shape: "higher", points: [{ value: 1, score: 0 }, { value: 3, score: 100 }] }; assert.equal(axis(r, p, "速度"), undefined);
});
test("primary ratio checks zero-domain lower direction and clipping through the same scorer", () => {
  for (const [value, zeroValid, direction, expected] of [[0, false, "higher", null], [0, true, "higher", 0], [0, true, "lower", 100], [6, true, "lower", 50], [6, true, "higher", 100], [-1, true, "higher", null]]) {
    const { r, p } = custom("ratio", value, zeroValid); rule(p, "rating_score").direction = direction; const a = axis(r, p, "速度");
    if (expected === null) assert.equal(a, undefined); else near(a.value, expected);
  }
});
test("primary score contribution exposes the actual transform including lower-direction ratios", () => {
  const { r, p } = fixture(); primary(p, "cmj_height", { kind: "ratio", direction: "lower" });
  const result = M.stats(E.resolve(r, p)).evaluationResults.find(item => item.metricId === "cmj_height");
  near(result.scoreContributions[0].score, 100); assert.equal(result.scoreContributions[0].transform.direction, "lower");
});
test("an invalid explicit primary conversion is rejected before publishing", () => {
  const { p } = fixture(); primary(p, "cmj_height", { kind: "anchors", shape: "higher", points: [] }); assert.throws(() => E.validateProfile(p));
  for (const value of [null, false, {}]) { p.aggregations["ability:下肢爆发力"].transforms["metric:cmj_height"] = value; assert.throws(() => E.validateProfile(p)); }
});
test("adding then removing all demographic groups restores the configured general grading bands", () => {
  const { r, p } = fixture(); const d = rule(p, "cmj_height"); Object.assign(d, { rangesEnabled: true, ranges: [{ min: 0, max: 50, includeMax: false, label: "原通用等级", status: "red" }] });
  const result = () => M.stats(E.resolve(r, p)).evaluationResults.find(item => item.metricId === "cmj_height");
  assert.equal(result().grade.label, "原通用等级"); d.referenceGroups = [{ id: "group", sex: "male", ageMin: 20, ageMax: 30, ranges: [{ min: 0, max: null, label: "分层等级", status: "green" }] }]; assert.equal(result().grade.label, "分层等级");
  d.referenceGroups = []; assert.equal(result().grade.label, "原通用等级"); assert.equal(result().rangesApplicable, true);
});
test("demographic ages use inclusive lower exclusive upper and retain true unmatched groups", () => {
  const { r, p } = fixture(); const d = rule(p, "cmj_height"); d.referenceGroups = [{ id: "group", sex: "male", ageMin: 20, ageMax: 30, ranges: [{ min: 0, max: null, label: "分层等级", status: "green" }] }]; d.rangesEnabled = true;
  for (const [age, matched] of [[20, true], [29, true], [30, false]]) { r.athlete.age = age; const resolved = E.resolve(r, p).definitions.find(item => item.id === "cmj_height"); assert.equal(resolved.referenceMatch.eligible, matched); }
});
test("valid implicit old primary and explicit equivalent ratio retain the historical narrative fingerprint", () => {
  const { r, p } = fixture(); primary(p); const baseline = old.RingsideModel.fingerprint(old.RingsideEvaluation.resolve(copy(r), copy(p)));
  assert.equal(M.fingerprint(E.resolve(r, p)), baseline); p.aggregations["ability:下肢爆发力"].scoringVersion = 1; p.aggregations["ability:下肢爆发力"].transforms = { "metric:cmj_height": higher }; assert.equal(M.fingerprint(E.resolve(r, p)), baseline);
});
test("old primary ignores leftover mean transforms until its scoring version is explicitly enabled", () => {
  const { r, p } = fixture(); primary(p); p.aggregations["ability:下肢爆发力"].transforms = { "metric:cmj_height": { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] } };
  near(axis(r, p).value, 80); const baseline = old.RingsideModel.fingerprint(old.RingsideEvaluation.resolve(copy(r), copy(p))); assert.equal(M.fingerprint(E.resolve(r, p)), baseline);
  p.aggregations["ability:下肢爆发力"].scoringVersion = 1; near(axis(r, p).value, 50); assert.notEqual(M.fingerprint(E.resolve(r, p)), baseline);
});
test("primary anchor and table changes are never erased as default representative settings", () => {
  const { r, p } = fixture(); primary(p); const initial = M.fingerprint(E.resolve(r, p));
  primary(p, "cmj_height", { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] }); const anchors = M.fingerprint(E.resolve(r, p)); assert.notEqual(anchors, initial);
  p.aggregations["ability:下肢爆发力"].transforms["metric:cmj_height"].points[1].value = 100; assert.notEqual(M.fingerprint(E.resolve(r, p)), anchors);
  primary(p, "cmj_height", { kind: "table", ranges: [{ min: 0, max: null, score: 70 }] }); assert.notEqual(M.fingerprint(E.resolve(r, p)), anchors);
});
test("removing a previously implicit v2 ability changes the stale narrative basis", () => {
  const { r, p } = fixture(); const baseline = old.RingsideModel.fingerprint(old.RingsideEvaluation.resolve(copy(r), copy(p))); assert.notEqual(M.fingerprint(E.resolve(r, p)), baseline);
});
test("names report folds and manual narrative remain outside the scoring basis", () => {
  const { r, p } = fixture(); primary(p); const before = M.fingerprint(E.resolve(r, p)), raw = JSON.stringify(r.data);
  p.name = "只更改名称"; r.views.capabilityExpanded.strength = true; r.narrative.text = "人工正文完整保留";
  assert.equal(M.fingerprint(E.resolve(r, p)), before); assert.equal(JSON.stringify(r.data), raw); assert.equal(M.normalizeRecord(copy(r)).narrative.text, "人工正文完整保留");
});
test("ISO literature references targets grades ratios and directions remain byte-equivalent to the baseline", () => {
  const r = M.defaults(); r.enabled.iso = true; r.athlete.age = 25; r.athlete.sex = "男"; r.athlete.mass = 80; r.athlete.dominantHand = "右";
  const p = E.create(r); const iso = p.standards.find(item => item.kind === "iso" && item.reference), row = r.data.iso.find(item => item.id === iso.directionId); row.left = 10; row.right = 10;
  const current = M.stats(E.resolve(r, p)), prior = old.RingsideModel.stats(old.RingsideEvaluation.resolve(copy(r), copy(p)));
  assert.deepEqual(copy(current.isoAnalyses), copy(prior.isoAnalyses)); assert.deepEqual(copy(current.balanceResults), copy(prior.balanceResults)); assert.deepEqual(copy(current.evaluationResults.filter(item => item.kind === "iso" || item.kind === "balance")), copy(prior.evaluationResults.filter(item => item.kind === "iso" || item.kind === "balance")));
});
test("primary transforms shared rules releases IDs and raw measurements survive standalone export and import", () => {
  const { r, p } = fixture(); primary(p, "cmj_height", { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] });
  p.releases = [E.serializeProfile(p)]; p.revision = 2; const raw = JSON.stringify(r.data), expected = axis(r, p).value, lib = E.migrate(M.recordEnvelope(r, p));
  assert.equal(lib.evaluationProfiles[0].id, p.id); assert.equal(lib.evaluationProfiles[0].releases.length, 1); near(axis(lib.athletes[0].records[0], lib.evaluationProfiles[0]).value, expected); assert.equal(JSON.stringify(r.data), raw);
});
test("arbitrary IMTP primary anchors use the same percent-of-peak result as a single-member mean", () => {
  const { r, p } = fixture(); r.enabled.imtp = true; r.data.imtp = [{ id: "imtp", peakForce: 1000, timePoints: [{ id: "t", timeMs: 175, force: 500, rfd: 2000 }] }];
  const subject = E.ruleSubjects(r).find(item => item.id === "imtp-time:force_pct_peak:175"), standard = E.ensureStandard(p, subject); Object.assign(standard, { targetEnabled: true, target: 100 });
  const transform = { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 100, score: 100 }] };
  p.aggregations["ability:早期发力"] = { method: "primary", primary: subject.id, scoringVersion: 1, transforms: { [subject.id]: transform } };
  near(axis(r, p, "早期发力").value, 50); const result = M.stats(E.resolve(r, p)).evaluationResults.find(item => item.subjectId === subject.id); assert.equal(result.unit, "%PF"); near(result.rawValue, 500); assert.equal(result.scoreContributions[0].transform.kind, "anchors");
  const basis = M.fingerprint(E.resolve(r, p)); p.aggregations["ability:早期发力"].transforms[subject.id].points[1].value = 200; assert.notEqual(M.fingerprint(E.resolve(r, p)), basis); near(axis(r, p, "早期发力").value, 25);
  p.aggregations["ability:早期发力"].method = "mean"; p.aggregations["ability:早期发力"].members = [subject.id]; near(axis(r, p, "早期发力").value, 25);
});
test("shared primary anchors adapt compatible force units without changing scheme raw data or scores", () => {
  const { r, p } = custom("ratio"); r.definitions.find(item => item.id === "rating_score").unit = "N";
  const scheme = E.create(r); scheme.aggregations = { "ability:速度": { method: "primary", primary: "metric:rating_score", scoringVersion: 1, transforms: { "metric:rating_score": { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 4, score: 100 }] } } } };
  const before = JSON.stringify(scheme), converted = M.changeMetricUnit(r, "rating_score", "kgf", "convert"); near(axis(r, scheme, "速度").value, 50); near(axis(converted, scheme, "速度").value, 50); assert.equal(JSON.stringify(scheme), before); assert.equal(r.customValues.rating_score.value, 2);
});
test("legacy in-process criteria editing preserves the explicitly enabled primary transform", () => {
  const { r, p } = fixture(); primary(p, "cmj_height", { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] });
  near(axis(r, p).value, 50); p.criteria.definitions.find(item => item.id === "cmj_height").target = 100;
  near(axis(r, p).value, 50); assert.equal(E.serializeProfile(p).aggregations["ability:下肢爆发力"].scoringVersion, 1);
  assert.equal(E.serializeProfile(p).aggregations["ability:下肢爆发力"].transforms["metric:cmj_height"].kind, "anchors");
});
console.log(passed + " evaluation v2.20 model checks passed");
