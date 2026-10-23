"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { context, createFixture } = require("./helpers/longitudinal-fixture.cjs"), c = context();
for (const name of ["metric-semantics", "comparison", "horizontal", "horizontal-setup"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const H = c.RingsideHorizontal, M = c.RingsideModel, E = c.RingsideEvaluation, copy = value => JSON.parse(JSON.stringify(value));
let count = 0;
const test = (name, run) => { run(); count++; console.log("PASS " + name); };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function sample(person, id, date, height) {
  const record = M.defaults(); record.demo = false; record.athleteId = person; record.recordId = id; record.athlete.name = person; record.athlete.date = date;
  record.athlete.sex = "男"; record.athlete.birthDate = "2000-01-01"; record.athlete.mass = 70;
  Object.keys(record.enabled).forEach(key => { record.enabled[key] = key === "cmj"; });
  record.data.cmj = [{ id: id + "-trial", height, rsiModified: .5 }];
  return M.normalizeRecord(record);
}
function build(records, extra = {}) {
  const profile = E.create(records[0], "统一测试标准"), rule = profile.standards.find(item => item.metricId === "cmj_height");
  rule.enabled = true; rule.target = 50; rule.targetEnabled = true; rule.rangesEnabled = false; rule.ranges = [];
  profile.aggregations["ability:下肢爆发力"] = { method: "primary", primary: "metric:cmj_height" };
  return H.build(records, { participants: [], references: [{ id: "all", label: "全组", scope: "all", sampling: "latest", window: { kind: "all" } }], profile, mode: "mean", ...extra });
}
const row = (model, reference = "all", metric = "cmj_height") => model.references.find(item => item.id === reference).projects.flatMap(project => project.metrics).find(item => item.metricId === metric);
test("a configured common standard does not block a window with no observations", () => {
  const records = [sample("a", "a1", "2026-01-01", 10), sample("b", "b1", "2026-01-01", 40)], standard = row(build(records)).benchmark.resolvedStandard;
  const result = build(records, { participants: [{ athleteId: "a", recordId: "a1" }], references: [{ id: "all", scope: "all", sampling: "latest", window: { kind: "custom", from: "2026-02-01", to: "2026-02-02" }, evaluationOverrides: { cmj_height: { standard } } }] });
  assert.equal(result.evaluationConflicts.length, 0); assert.equal(row(result).benchmark.n, 0); assert.equal(row(result).benchmark.mean, null); assert.equal(row(result).benchmark.evaluationState, "missing");
  assert.deepEqual(copy(result.references[0].spec.evaluationOverrides.cmj_height.standard), copy(standard));
});
test("period means give every athlete one vote and preserve all source records: 27.5", () => {
  const records = [sample("a", "a1", "2026-01-01", 10), sample("a", "a2", "2026-02-01", 20), sample("b", "b1", "2026-01-01", 40)];
  const before = JSON.stringify(records), result = row(build(records, { references: [{ id: "all", scope: "all", sampling: "period-mean", window: { kind: "all" } }] })).benchmark;
  near(result.mean, 27.5); assert.equal(result.n, 2); assert.deepEqual(copy(result.contributors.map(person => person.value)), [15, 40]);
  assert.deepEqual(copy(result.contributors[0].sources.map(source => source.recordId)), ["a1", "a2"]); assert.equal(result.contributors[0].statistics, null);
  assert.equal(result.contributors[0].recordId, undefined); assert.equal(result.contributors[0].date, undefined); assert.equal(result.contributors[0].recordCount, 2);
  assert.deepEqual(copy(result.contributors[0].dateRange), { from: "2026-01-01", to: "2026-02-01" });
  for (const source of result.contributors[0].sources) for (const key of ["mode", "context", "subjectInputs", "statistics", "testedAge", "sourceKind", "resolvedStandard"]) assert.ok(Object.hasOwn(source, key), key);
  assert.equal(result.bestSources[0].sources[0].recordId, "b1");
  assert.equal(JSON.stringify(records), before);
});
test("each saved group owns its fixed date window", () => {
  const records = [sample("a", "a1", "2026-01-01", 10), sample("a", "a2", "2026-02-01", 50), sample("b", "b1", "2026-01-01", 30)];
  const model = build(records, { window: { kind: "all" }, references: [{ id: "jan", scope: "all", window: { kind: "custom", from: "2026-01-01", to: "2026-01-31" } }, { id: "feb", scope: "all", window: { kind: "custom", from: "2026-02-01", to: "2026-02-28" } }] });
  near(row(model, "jan").benchmark.mean, 20); near(row(model, "feb").benchmark.mean, 50); assert.equal(row(model, "feb").benchmark.n, 1);
});
test("home date presets reach the model with fixed endpoints and correct inclusive membership", () => {
  const records = [sample("a", "a", "2026-09-01", 10), sample("b", "b", "2026-10-23", 40), sample("c", "c", "2026-10-24", 80)];
  for (const days of [7, 14, 30, 90]) {
    const window = c.RingsideHorizontalSetup.dateWindow("recent" + days, "", "", "2026-10-24"), before = JSON.stringify(window);
    const result = build(records, { references: [{ id: "all", scope: "all", window }] }), reference = result.references[0];
    assert.equal(reference.spec.window.kind, "recent" + days); assert.equal(reference.spec.window.from, window.from); assert.equal(reference.spec.window.to, "2026-10-24");
    assert.equal((new Date(window.to) - new Date(window.from)) / 86400000 + 1, days); assert.equal(row(result).benchmark.n, days === 90 ? 3 : 2);
    near(row(result).benchmark.mean, days === 90 ? 130 / 3 : 60); assert.equal(JSON.stringify(window), before);
    assert.deepEqual(copy(H.normalizeWindow(reference.spec.window)), copy(reference.spec.window));
  }
});
test("group-only discovers actual projects and evaluates aggregate values: 100 not 90", () => {
  const model = build([sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)]), result = row(model);
  assert.equal(model.participants.length, 0); assert.ok(model.projects.some(project => project.id === "cmj")); near(result.benchmark.mean, 60);
  assert.equal(result.benchmark.assessment.status, "green"); const ability = model.references[0].overview.rows.find(item => item.subjectId === "下肢爆发力");
  near(ability.benchmark.score, 100); assert.notEqual(ability.benchmark.score, 90); assert.equal(ability.benchmark.contributors[0].value, null);
  assert.ok(ability.benchmark.contributors[0].sources.some(source => source.metricId === "cmj_height" && source.value === 40));
});
test("FMS averages complete per-person bilateral action scores without rounding original entries", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)];
  records.forEach((record, index) => { record.enabled.cmj = false; record.enabled.fms = true; record.data.fms.forEach(item => { item.pain = false; if (item.bilateral) { item.left = 3; item.right = 3; } else item.score = 3; }); record.data.fms[1].left = index ? 3 : 1; record.data.fms[1].right = index ? 2 : 3; record.data.fms[1].location = "knee_l"; });
  const model = build(records), fms = row(model, "all", "fms:1"); near(fms.benchmark.mean, 1.5); assert.equal(fms.measurementScale, "ordinal"); assert.equal(fms.benchmark.best, 2); assert.equal(fms.benchmark.assessment.status, "amber");
  assert.equal(c.Calc.fms([{ score: 1.5 }]).scores[0], null);
  assert.equal(model.references[0].aggregateRiskRegions.knee_l.status, "amber");
  assert.ok(model.references[0].aggregateFigures.fms[0].series[0].values.includes(1.5));
});
test("FMS opposite bilateral scores retain individual minima and explicit pain remains zero", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)];
  records.forEach((record, index) => { record.enabled.cmj = false; record.enabled.fms = true; record.data.fms[1].left = index ? 3 : 1; record.data.fms[1].right = index ? 1 : 3; record.data.fms[1].location = "knee_l"; });
  const opposite = build(records); near(row(opposite, "all", "fms:1").benchmark.mean, 1);
  records.forEach(record => { record.data.fms[1].left = 3; record.data.fms[1].right = 3; record.data.fms[1].pain = true; });
  const painful = build(records), fms = row(painful, "all", "fms:1"); near(fms.benchmark.mean, 0); assert.equal(fms.benchmark.assessment.status, "red"); assert.equal(painful.references[0].aggregateRiskRegions.knee_l.status, "red");
  assert.ok(fms.benchmark.contributors.every(person => person.sources[0].value === 0)); assert.equal(records[0].data.fms[1].left, 3);
});
test("group ISO preserves three sections and individual ratios while retaining an unlocalized joint risk", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)];
  records.forEach((record, index) => { record.enabled.cmj = false; record.enabled.iso = true; record.isoDirectionIds = ["iso_knee_extension", "iso_knee_flexion"];
    for (const direction of record.data.iso) if (record.isoDirectionIds.includes(direction.id)) { direction.target = 20; direction.reference = null; direction.left = direction.id.endsWith("flexion") ? 30 : index ? 50 : 100; direction.right = direction.id.endsWith("flexion") ? 30 : index ? 100 : 50; }
  });
  const model = build(records, { profile: E.create(records[0], "统一关节标准") }), metrics = model.references[0].projects.find(project => project.id === "iso").metrics;
  for (const section of ["force", "asymmetry", "balance"]) assert.ok(metrics.some(item => item.section === section));
  const balance = metrics.find(item => item.section === "balance" && item.context.side === "L"), asym = metrics.find(item => item.section === "asymmetry" && item.directionId === "iso_knee_extension");
  near(balance.benchmark.mean, .45); assert.notEqual(balance.benchmark.mean, 30 / 75); near(asym.benchmark.mean, 50);
  assert.deepEqual(copy(balance.benchmark.contributors.map(person => person.sources[0].value)), [.3, .6]);
  assert.equal(model.references[0].aggregateRiskRegions.knee.status, "red"); assert.equal(model.references[0].aggregateRiskRegions.knee_l.status, "green"); assert.equal(model.references[0].aggregateRiskRegions.knee_r.status, "green");
  assert.equal(model.references[0].risk.rows.find(item => item.subjectId === "knee").benchmark.contributors.length, 2);
  assert.ok(model.references[0].risk.benchmark.values.every(value => value === null || [1, 2, 3].includes(value)));
});
test("derived ratios are computed on each real record before within-person means", () => {
  const fixture = createFixture(c, 3); fixture.records.forEach((record, index) => { record.athleteId = index < 2 ? "a" : "b"; Object.keys(record.enabled).forEach(key => { record.enabled[key] = ["cmj", "sj"].includes(key); }); record.data.cmj.forEach(item => { item.height = [40, 60, 30][index]; }); record.data.sj.forEach(item => { item.height = [20, 20, 10][index]; }); });
  const model = build(fixture.records, { profile: fixture.profile, catalog: fixture.catalog, references: [{ id: "all", scope: "all", sampling: "period-mean", window: { kind: "all" } }] });
  const eur = model.references[0].capability.cards.flatMap(card => card.metrics).find(item => item.metricId === "eur"); near(eur.benchmark.mean, 2.75); assert.equal(eur.benchmark.contributors[0].sources.length, 2);
});
test("group ISO never merges a direction from incompatible protocols into one radar value", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)];
  records.forEach((record, index) => { record.enabled.cmj = false; record.enabled.iso = true; record.isoDirectionIds = ["iso_knee_extension"];
    const direction = record.data.iso.find(item => item.id === "iso_knee_extension"); direction.left = 50 + index * 25; direction.right = 100; direction.target = 20; direction.reference = null;
    direction.protocol = "不同关节角度 " + index; direction.protocolIdentity = M.protocolIdentity("iso:" + direction.id, direction.protocol);
  });
  const model = build(records, { profile: null }), group = model.references[0], forces = group.projects.find(project => project.id === "iso").metrics.filter(item => item.section === "force");
  assert.equal(forces.length, 4); assert.ok(forces.every(item => item.benchmark.n === 1)); assert.equal(group.aggregateFigures.iso, undefined);
});
test("focus presentation never resamples and explicit best is the same baseline in facts", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)], model = build(records, { participants: records.map(record => ({ athleteId: record.athleteId, recordId: record.recordId })) }), before = JSON.stringify(model);
  const views = { focus: { kind: "athlete", id: "b" }, baseline: { kind: "reference", id: "all", statistic: "best" } }, shown = H.present(model, views), metric = row(shown);
  assert.equal(shown.participants[0].athleteId, "b"); assert.deepEqual(copy(metric.cells.map(cell => cell.value)), [80, 40]); near(metric.differences[1].delta, -40); near(metric.differences[1].referenceValue, 80);
  const fact = H.facts(model, views).references[0].projects.flatMap(project => project.metrics).find(item => item.id === metric.id); assert.deepEqual(copy(fact.differences), copy(metric.differences)); assert.equal(JSON.stringify(model), before);
  const none = H.present(model, { baseline: { kind: "none" } }); assert.ok(row(none).differences.every(difference => difference.available === false));
});
test("different effective standards require an explicit frozen override", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)]; records[1].athlete.sex = "女";
  const profile = E.create(records[0], "分层目标"), rule = profile.standards.find(item => item.metricId === "cmj_height");
  rule.referenceGroups = [{ id: "men", sex: "male", ageMin: null, ageMax: null, mode: "any", target: 50, ranges: [], source: "固定标准" }, { id: "women", sex: "female", ageMin: null, ageMax: null, mode: "any", target: 40, ranges: [], source: "固定标准" }]; rule.enabled = true; rule.targetEnabled = true; rule.rangesEnabled = false;
  const model = build(records, { profile }), conflict = model.evaluationConflicts.find(item => item.metricKey === "cmj_height"); assert.ok(conflict); assert.equal(row(model).benchmark.evaluationState, "conflict");
  const candidate = conflict.candidates.find(item => item.standard.target === 50), resolved = build(records, { profile, references: [{ id: "all", scope: "all", window: { kind: "all" }, evaluationOverrides: { cmj_height: { standard: candidate.standard } } }] });
  assert.equal(row(resolved).benchmark.evaluationConflict, null); assert.equal(row(resolved).benchmark.assessment.status, "green"); near(row(resolved).benchmark.mean, 60);
  const custom = { ...candidate.standard, target: 100, configured: true, configurationVersion: 1 }, withStandard = standard => build(records, { profile, references: [{ id: "all", scope: "all", window: { kind: "all" }, evaluationOverrides: { cmj_height: { standard, name: "群体共同标准" } } }] });
  assert.equal(row(withStandard(custom)).benchmark.assessment.status, "red");
  const ranged = { ...custom, direction: "none", targetEnabled: false, ranges: [{ min: 50, max: null, includeMin: true, label: "共同达标区间", status: "green" }] };
  assert.equal(row(withStandard(ranged)).benchmark.assessment.status, "green");
  assert.ok(row(withStandard({ ...ranged, target: -1 })).benchmark.evaluationConflict);
  assert.ok(row(withStandard({ ...ranged, ranges: [...ranged.ranges, { min: 55, max: 90, label: "重叠区间", status: "amber" }] })).benchmark.evaluationConflict);
});
test("partly applicable standards require a shared choice while wholly unconfigured rules do not block", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)]; records[1].athlete.sex = "女";
  const profile = E.create(records[0], "限定标准"), rule = profile.standards.find(item => item.metricId === "cmj_height"); rule.enabled = true; rule.target = 50; rule.targetEnabled = true; rule.rangesEnabled = false; rule.conditions = { sex: "male" };
  const model = build(records, { profile }); assert.ok(model.evaluationConflicts.some(item => item.metricKey === "cmj_height")); assert.equal(row(model).benchmark.assessment.status, "gray");
  rule.enabled = false; assert.equal(build(records, { profile }).evaluationConflicts.length, 0);
});
test("default focus and baseline match selected objects and narrative uses the current reference", () => {
  const records = [sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)], participants = [{ athleteId: "a", recordId: "a" }];
  const model = build(records, { participants }), shown = H.present(model);
  assert.deepEqual(copy(shown.presentation.focus), { kind: "athlete", id: "a" }); assert.deepEqual(copy(shown.presentation.baseline), { kind: "reference", id: "all", statistic: "mean" });
  const group = H.present(build(records)); assert.deepEqual(copy(group.presentation.focus), { kind: "reference", id: "all" }); assert.equal(group.presentation.baseline.kind, "none");
  const several = build(records, { participants, references: [{ id: "first", label: "第一群体", scope: "all" }, { id: "second", label: "第二群体", scope: "all" }] });
  const restored = H.present(several, { activeReferenceId: "second", focus: { kind: "reference", id: "first" } }); assert.deepEqual(copy(restored.presentation.focus), { kind: "athlete", id: "a" });
  const groups = build(records, { references: several.references.map(reference => reference.spec) }), groupRestored = H.present(groups, { activeReferenceId: "second", focus: { kind: "reference", id: "first" } }); assert.equal(groupRestored.presentation.focus.id, "second"); assert.equal(groupRestored.summary.focusLabel, "第二群体");
  const text = H.localText(several, { activeReferenceId: "second" }); assert.ok(text.includes("a · 2026-01-01 · 横向比较")); assert.ok(text.includes("第二群体")); assert.ok(!text.includes("第一群体"));
});
test("legacy snapshots project existing frozen values without live reads", () => {
  const model = build([sample("a", "a", "2026-01-01", 40), sample("b", "b", "2026-01-01", 80)]); model.version = 1;
  const frozen = JSON.stringify(model), projected = H.present(model, { baseline: { kind: "none" } }); assert.equal(row(projected).benchmark.mean, 60); assert.equal(JSON.stringify(model), frozen);
});
console.log(`${count} representative horizontal model checks passed`);
