"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { context } = require("./helpers/longitudinal-fixture.cjs"), c = context();
for (const name of ["metric-semantics", "comparison", "team"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const M = c.RingsideModel, E = c.RingsideEvaluation, Team = c.RingsideTeam, copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function record(id, value, options = {}) {
  const r = M.defaults(); r.demo = false; r.athleteId = id; r.recordId = id + "-record"; r.athlete.name = id;
  r.athlete.date = "2026-11-01"; r.athlete.sex = "男"; r.athlete.birthDate = "2000-01-01"; r.mode = "best";
  Object.keys(r.enabled).forEach(key => r.enabled[key] = false);
  r.customTests.push({ id: "team_test", name: "团队测试", category: "performance", primaryMetricId: "team_value", selectionDirection: "higher" });
  r.enabled.team_test = true;
  r.definitions.push({ id: "team_value", testId: "team_test", name: "团队读数", unit: options.unit || "cm", category: "performance", ability: options.ability || "",
    entryScope: "attempt", measurementScale: options.meaning === "ordinal" ? "ordinal" : "ratio", resultMeaning: options.meaning || "numeric", direction: options.direction || "higher", directionStatus: options.directionStatus || "confirmed", ranges: [], referenceEnabled: false });
  r.data.team_test = (Array.isArray(value) ? value : [value]).map((v, index) => ({ id: id + "-trial-" + index, metrics: v === null ? {} : { team_value: v } }));
  return M.normalizeRecord(r);
}
function options(records, extra = {}) {
  return { participants: records.map(r => ({ athleteId: r.athleteId, recordId: r.recordId })), athletes: records.map(r => ({ id: r.athleteId, profile: { name: r.athlete.name }, groupId: "team" })),
    window: { kind: "custom", from: "2026-11-01", to: "2026-11-30" }, mode: "best", profile: null, ...extra };
}
const build = (records, extra = {}) => Team.build(records, options(records, extra));
const metric = (model, id = "team_value") => model.projects.flatMap(project => project.metrics).find(row => row.metricId === id);
test("fixed selected records keep missing participants and never use another day", () => {
  const a = record("a", 10), old = record("b", 99); old.athlete.date = "2026-10-01";
  const model = Team.build([a, old], options([a], { participants: [{ athleteId: "a", recordId: a.recordId }, { athleteId: "b", recordId: "" }] }));
  assert.equal(model.people.length, 2); assert.equal(model.people[1].record, null); assert.equal(metric(model).cells[1], null);
  assert.equal(model.summary.recorded, 1); assert.equal(model.summary.missing, 1);
});
test("missing selections, duplicate people, wrong owners and date ranges are rejected", () => {
  const a = record("a", 10);
  assert.throws(() => build([a], { participants: [{ athleteId: "a", recordId: "missing" }] }), /不存在/);
  assert.throws(() => build([a], { participants: [{ athleteId: "b", recordId: a.recordId }] }), /不匹配/);
  assert.throws(() => build([a], { participants: [{ athleteId: "a", recordId: a.recordId }, { athleteId: "a", recordId: "" }] }), /不重复/);
  assert.throws(() => build([a], { window: { from: "2026-11-02", to: "2026-11-30" } }), /范围/);
  a.deletedAt = "2026-11-02"; assert.throws(() => build([a]), /回收站/);
});
test("ranking uses original precision and competition ties with stable roster order", () => {
  const model = build([record("a", 10.004), record("b", 10.004), record("c", 10.003), record("d", null)]), row = metric(model);
  assert.deepEqual(copy(row.ranking.map(item => [item.name, item.rank])), [["a", 1], ["b", 1], ["c", 3], ["d", null]]);
});
test("confirmed lower direction ranks smaller first without a grading profile", () => {
  const model = build([record("a", 4, { direction: "lower" }), record("b", 3, { direction: "lower" })]);
  assert.deepEqual(copy(metric(model).ranking.map(item => [item.name, item.rank])), [["b", 1], ["a", 2]]);
  assert.equal(model.overview.axes.length, 0);
});
test("unconfirmed direction sorts values but never creates performance ranks", () => {
  const row = metric(build([record("a", 5, { directionStatus: "unconfirmed" }), record("b", 7, { directionStatus: "unconfirmed" })]));
  assert.equal(row.rankable, false); assert.deepEqual(copy(row.ranking.map(item => item.rank)), [null, null]); assert.equal(row.ranking[0].name, "b");
});
test("genuine zero and negative values remain in tables and chart statistics", () => {
  const row = metric(build([record("a", 0), record("b", -5), record("c", 2)]));
  assert.equal(row.statistics.n, 3); near(row.statistics.mean, -1); assert.equal(row.statistics.min, -5);
});
test("every person contributes one representative and complete companion metric union is retained", () => {
  const a = record("a", [10, 20, 30]), b = record("b", [40]);
  b.definitions.push({ ...copy(b.definitions.find(d => d.id === "team_value")), id: "companion", name: "伴随指标" }); b.data.team_test[0].metrics.companion = 70;
  const best = build([a, b]), mean = build([a, b], { mode: "mean" });
  near(metric(best).statistics.mean, 35); near(metric(mean).statistics.mean, 30);
  assert.equal(metric(best, "companion").cells[0], null); assert.equal(metric(best, "companion").cells[1].value, 70);
});

test("unobserved automatic balance ratios are omitted while measured forces remain", () => {
  const a = record("a", 10); a.enabled.iso = true;
  const knee = a.data.iso.find(row => row.id === "iso_knee_extension"); knee.left = 500; knee.right = 600;
  const model = build([a]), iso = model.projects.find(project => project.id === "iso");
  assert.ok(iso.metrics.some(row => row.section === "force" && row.statistics.n === 1));
  assert.equal(iso.metrics.some(row => row.section === "balance"), false);
});

test("a balance ratio measured for one person keeps the entire roster including missing people", () => {
  const a = record("a", 10), b = record("b", 20);
  for (const r of [a, b]) { r.enabled.iso = true; const knee = r.data.iso.find(row => row.id === "iso_knee_extension"); knee.left = 500; knee.right = 600; }
  const flexion = b.data.iso.find(row => row.id === "iso_knee_flexion"); flexion.left = 250;
  const model = build([a, b]), rows = model.projects.find(project => project.id === "iso").metrics.filter(row => row.section === "balance");
  assert.equal(rows.length, 1); assert.equal(rows[0].statistics.n, 1); assert.equal(rows[0].cells.length, 2);
  assert.equal(rows[0].cells[0].value, null); near(rows[0].cells[1].value, .5);
});
test("compatible units normalize while retaining original units and values", () => {
  const a = record("a", 100, { unit: "N" }), b = record("b", 20, { unit: "kgf" }), row = metric(build([a, b]));
  assert.equal(row.statistics.n, 2); near(row.cells[1].value, 20 * 9.80665); assert.equal(row.cells[1].rawValue, 20); assert.equal(row.cells[1].rawUnit, "kgf");
});
test("incompatible measurement units split the metric without comparing people", () => {
  const model = build([record("a", 10, { unit: "cm" }), record("b", 20, { unit: "N" })]);
  const rows = model.projects[0].metrics.filter(row => row.metricId === "team_value"); assert.equal(rows.length, 2); assert.ok(rows.every(row => row.statistics.n === 1));
  assert.notEqual(rows[0].id, rows[1].id);
});
test("team length, time, mass and speed conversions require matching physical dimensions", () => {
  for (const [from, to, expected] of [["m", "cm", 100], ["ms", "s", .001], ["g", "kg", .001], ["km/h", "m/s", 1 / 3.6], ["kN", "N", 1000]]) near(Team.unitFactor(from, to), expected);
  assert.equal(Team.unitFactor("cm", "ms"), null); assert.equal(Team.unitFactor("%", ""), null);
  const length = metric(build([record("a", 100, { unit: "cm" }), record("b", 2, { unit: "m" })]));
  assert.equal(length.statistics.n, 2); near(length.cells[1].value, 200); assert.equal(length.cells[1].rawUnit, "m"); assert.equal(length.cells[1].rawValue, 2);
  const time = metric(build([record("a", 1000, { unit: "ms", direction: "lower" }), record("b", 2, { unit: "s", direction: "lower" })]));
  assert.equal(time.statistics.n, 2); near(time.cells[1].value, 2000); assert.equal(time.ranking[0].athleteId, "a");
});
test("equivalent unit-adapted scoring points retain a common ability definition", () => {
  const a = record("a", 100, { unit: "cm", ability: "专项能力" }), b = record("b", 2, { unit: "m", ability: "专项能力" }), profile = E.create(a);
  const rule = profile.standards.find(item => item.metricId === "team_value"); Object.assign(rule, { enabled: true, targetEnabled: true, target: 200, rangesEnabled: false, ranges: [] });
  profile.aggregations = { "ability:专项能力": { method: "primary", primary: "metric:team_value", scoringVersion: 1, transforms: { "metric:team_value": { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 200, score: 100 }] } } } };
  const before = JSON.stringify(profile), model = build([a, b], { profile });
  assert.equal(model.overview.axes[0].n, 2); near(model.overview.axes[0].value, 75); assert.equal(JSON.stringify(profile), before);
  assert.equal(model.overview.axes[0].cells[1].evidence[0].unit, "m"); assert.equal(metric(model).cells[1].rawValue, 2);
});
test("common-unit displays keep complete original-unit evaluation evidence", () => {
  const a = record("a", 100, { unit: "cm", ability: "专项能力" }), b = record("b", .5, { unit: "m", ability: "专项能力" }), profile = E.create(a);
  const rule = profile.standards.find(item => item.metricId === "team_value"); Object.assign(rule, { enabled: true, targetEnabled: true, target: 200, rangesEnabled: false, ranges: [] });
  profile.aggregations = { "ability:专项能力": { method: "primary", primary: "metric:team_value", scoringVersion: 1, transforms: { "metric:team_value": { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 200, score: 100 }] } } } };
  const model = build([a, b], { profile }), cell = metric(model).cells[1], evidence = cell.evaluation;
  assert.equal(cell.value, 50); assert.equal(cell.unit, "cm"); assert.equal(cell.assessment.target, 200);
  assert.equal(evidence.value, .5); assert.equal(evidence.unit, "m"); assert.equal(evidence.target, 2);
  assert.equal(evidence.scoreContributions[0].transform.points[1].value, 2); assert.equal(evidence.scoreContributions[0].score, 25);
  const fact = Team.facts(model).projects.find(project => project.id === "team_test").metrics[0].cells[1];
  assert.equal(fact.evaluation.value, .5); assert.equal(fact.evaluation.unit, "m");
});
test("unit adaptation never hides different force definitions", () => {
  const a = cmj("a", 40), b = cmj("b", 50); a.imtpConfig.definition = "gross"; b.imtpConfig.definition = "net";
  for (const r of [a, b]) { r.enabled.imtp = true; r.data.imtp = [{ id: r.athleteId + "imtp", peakForce: 1000 }]; }
  const model = build([a, b]), force = model.projects.flatMap(project => project.metrics).filter(row => row.metricId === "imtp_peak_force");
  assert.equal(force.length, 2); assert.ok(force.every(row => row.statistics.n === 1));
  assert.equal(metric(model, "cmj_height").statistics.n, 2);
});
test("ordinal values have ranks and frequency counts but no continuous statistics", () => {
  const model = build([record("a", 1, { meaning: "ordinal" }), record("b", 3, { meaning: "ordinal" })]), row = metric(model);
  assert.equal(row.statistics.mean, null); assert.equal(row.statistics.q1, null); assert.equal(row.statistics.boxAvailable, false);
  assert.equal(Team.chart(model, "team_test", { kind: "box" }).kind, "column");
  assert.equal(Team.chart(model, "team_test", { kind: "dot" }).kind, "dot"); assert.equal(row.ranking[0].rank, 1);
});
test("category codes only produce counts and never performance ranks or means", () => {
  const model = build([record("a", 1, { meaning: "category" }), record("b", 1, { meaning: "category" }), record("c", 2, { meaning: "category" })]), chart = Team.chart(model, "team_test", { kind: "histogram" });
  assert.equal(chart.kind, "distribution"); assert.equal(chart.rankable, false); assert.equal(chart.statistics.mean, null); assert.deepEqual(copy(chart.bins.map(bin => bin.count)), [2, 1]);
});
test("box statistics use type 7 quartiles and actual observed whiskers", () => {
  const stat = Team.statistics([0, 1, 2, 3, 4, 100]); near(stat.q1, 1.25); near(stat.median, 2.5); near(stat.q3, 3.75);
  assert.equal(stat.lowerWhisker, 0); assert.equal(stat.upperWhisker, 4); assert.deepEqual(copy(stat.outliers), [100]);
  assert.equal(Team.statistics([1, 2]).boxAvailable, false);
});
test("histogram uses Sturges and exact edges are assigned once, including maximum", () => {
  const bins = Team.histogram([0, 1, 2, 3, 4].map((value, index) => ({ athleteId: String(index), value })));
  assert.equal(bins.length, 4); assert.deepEqual(copy(bins.map(bin => bin.count)), [1, 1, 1, 2]);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 5); assert.equal(bins.at(-1).lastInclusive, true);
  const equal = Team.histogram([{ value: 0 }, { value: 0 }]); assert.equal(equal.length, 1); assert.equal(equal[0].count, 2);
});
function cmj(id, height) {
  const r = record(id, null); r.enabled.team_test = false; r.enabled.cmj = true; r.data.cmj = [{ id: id + "cmj", height, rsiModified: .4 }]; return r;
}
function cmjProfile(r) {
  const profile = E.create(r, "团队统一方案"), rule = profile.standards.find(item => item.metricId === "cmj_height");
  Object.assign(rule, { enabled: true, targetEnabled: true, target: 50, rangesEnabled: false, ranges: [] });
  profile.aggregations = { "ability:下肢爆发力": { method: "primary", primary: "metric:cmj_height" } }; return profile;
}
test("CMJ defaults to height and team averages individual scores after clipping", () => {
  const a = cmj("a", 60), b = cmj("b", 40), profile = cmjProfile(a), model = build([a, b], { profile });
  assert.equal(model.projects.find(project => project.id === "cmj").defaultMetricId, "cmj_height");
  near(model.overview.axes[0].value, 90); assert.equal(model.overview.axes[0].n, 2);
  assert.deepEqual(copy(model.overview.series.map(series => series.values[0])), [90, 100, 80]);
});
test("unified profile overrides old axis configuration without mutating sources", () => {
  const a = cmj("a", 40), b = cmj("b", 30); b.axes = { "ability:下肢爆发力": { method: "primary", primary: "metric:cmj_rsi_modified" } };
  const before = JSON.stringify([a, b]), model = build([a, b], { profile: cmjProfile(a) });
  near(model.overview.axes[0].value, 70); assert.equal(JSON.stringify([a, b]), before); assert.equal(JSON.stringify(model), JSON.stringify(copy(model)));
});
test("same-label ability with historical changed metric membership stays missing", () => {
  const a = cmj("a", 40), b = cmj("b", 30); b.definitions.find(d => d.id === "cmj_height").ability = "另一个能力";
  const model = build([a, b], { profile: cmjProfile(a) }); assert.equal(model.overview.axes[0].n, 1); near(model.overview.axes[0].value, 80); assert.equal(model.overview.series[2].values[0], null);
});
test("no evaluation scheme cannot reuse historical scores", () => {
  const a = cmj("a", 40); a.axes = { "ability:下肢爆发力": { method: "primary", primary: "metric:cmj_height" } };
  const d = a.definitions.find(item => item.id === "cmj_height"); d.target = 50; d.referenceEnabled = true;
  const model = build([a], { profile: null }); assert.equal(model.overview.axes.length, 0); assert.equal(metric(model, "cmj_height").cells[0].value, 40);
});
test("age and sex group targets are applied per athlete before averaging", () => {
  const a = cmj("a", 40), b = cmj("b", 40), profile = cmjProfile(a); b.athlete.sex = "女";
  profile.standards.find(item => item.metricId === "cmj_height").referenceGroups = [
    { id: "male", sex: "male", ageMin: 20, ageMax: 30, target: 50, ranges: [] }, { id: "female", sex: "female", ageMin: 20, ageMax: 30, target: 40, ranges: [] }];
  const model = build([a, b], { profile }); near(model.overview.axes[0].value, 90); assert.equal(model.overview.axes[0].cells[1].evidence[0].reference.groupId, "female");
});
test("unmatched demographic grade may still use its enabled independent target", () => {
  const a = cmj("a", 40), profile = cmjProfile(a); a.athlete.birthDate = "2010-01-01";
  profile.standards.find(item => item.metricId === "cmj_height").referenceGroups = [{ id: "adult", sex: "male", ageMin: 20, ageMax: 30, target: 60, ranges: [] }];
  const model = build([a], { profile }); near(model.overview.axes[0].value, 80); assert.equal(model.overview.axes[0].n, 1);
});
test("risk merges both sides and multiple tests into one athlete per region", () => {
  const a = record("a", 10); a.enabled.iso = true;
  const shoulder = a.data.iso.filter(row => row.region === "shoulder").slice(0, 2); a.isoDirectionIds = shoulder.map(row => row.id);
  shoulder.forEach(row => { row.left = 100; row.right = 100; row.painLeft = true; row.painRight = true; });
  const model = build([a]), region = model.risk.regions.find(item => item.id === "shoulder");
  assert.equal(region.flaggedCount, 1); assert.equal(region.redCount, 1); assert.equal(region.measuredCount, 1); assert.equal(region.members.length, 1);
  assert.deepEqual(copy(region.members[0].sides).sort(), ["L", "R"]); assert.equal(model.risk.flaggedCount, 1);
  assert.equal(model.risk.regions.find(item => item.id === "knee").value, null); assert.equal(model.risk.max, 1);
});
test("unlocalized FMS is retained and pain-only data count as measured", () => {
  const a = record("a", 10); a.enabled.fms = true; a.data.fms[0].score = 0; a.data.fms[0].pain = true; a.data.fms[0].location = "";
  const model = build([a]); assert.equal(model.risk.unlocalized.length, 1); assert.equal(model.risk.flaggedCount, 1); assert.equal(model.summary.screened, 1);
});
test("measured regions without a usable grade are unknown rather than zero concerns", () => {
  const a = record("a", 10); a.enabled.iso = true;
  const row = a.data.iso.find(item => item.region === "shoulder"); a.isoDirectionIds = [row.id]; row.left = 100; row.right = 100;
  const region = build([a]).risk.regions.find(item => item.id === "shoulder");
  assert.equal(region.measuredCount, 1); assert.equal(region.assessedCount, 0); assert.equal(region.value, null);
});
test("frozen snapshots and facts remain unchanged after source edits", () => {
  const a = record("a", 10), model = build([a]), fingerprint = model.fingerprint, facts = Team.facts(model);
  a.data.team_test[0].metrics.team_value = 100; assert.equal(metric(model).cells[0].value, 10); assert.equal(model.people[0].record.data.team_test[0].metrics.team_value, 10);
  assert.equal(model.fingerprint, fingerprint); assert.equal(facts.people[0].record, undefined); assert.notEqual(build([a]).fingerprint, fingerprint);
  assert.match(Team.localText(model), /报告 1 人/); assert.match(Team.localText(model), /团队读数/); assert.doesNotMatch(Team.localText(model), /训练方向/);
});
test("an all-missing roster keeps every athlete without zero-valued results", () => {
  const model = Team.build([], { participants: [{ athleteId: "a", recordId: "" }, { athleteId: "b", recordId: "" }] });
  assert.equal(model.people.length, 2); assert.equal(model.projects.length, 0); assert.equal(model.summary.recorded, 0);
  assert.ok(model.risk.regions.every(region => region.value === null)); assert.match(Team.localText(model), /尚无筛查数据/);
});
test("100-person reports retain all people and rank only one value per athlete", () => {
  const records = Array.from({ length: 100 }, (_, index) => record("person_" + index, [index, index + 1]));
  const before = JSON.stringify(records), model = build(records), row = metric(model);
  assert.equal(model.people.length, 100); assert.equal(row.statistics.n, 100); assert.equal(row.ranking.length, 100);
  assert.equal(row.ranking[0].value, 100); assert.equal(row.ranking.at(-1).value, 1); assert.equal(JSON.stringify(records), before);
});
(async () => {
  const records = [record("a", 10), record("b", 20)], expected = build(records), progress = [];
  const result = await Team.buildAsync(records, options(records), { batchSize: 1, yieldControl: async () => {}, onProgress: value => progress.push(value.prepared) });
  assert.deepEqual(copy(result), copy(expected)); assert.deepEqual(progress, [0, 1, 2]); passed++; console.log("PASS async and synchronous builds agree with bounded preparation");
  let cancel = false; const cancelled = await Team.buildAsync(records, options(records), { batchSize: 1, yieldControl: async () => {}, onProgress: ({ prepared }) => { if (prepared === 1) cancel = true; }, isCancelled: () => cancel });
  assert.equal(cancelled, null); passed++; console.log("PASS cancellation never delivers a partial snapshot");
  console.log(`${passed} team model checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
