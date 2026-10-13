"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { loadComparisonContext } = require("./helpers/comparison-fixtures.cjs"), c = loadComparisonContext(), M = c.RingsideModel, C = c.RingsideComparison;
const plain = value => JSON.parse(JSON.stringify(value)), size = value => Buffer.byteLength(JSON.stringify(value), "utf8"), digest = value => crypto.createHash("sha256").update(value).digest("hex");
const controllerPath = path.resolve(__dirname, "../src/ringside-comparison-controller.js"), controllerSource = fs.readFileSync(controllerPath, "utf8"), controllerHash = digest(controllerSource);
c.location = { pathname: "/comparison-facts-test" };
assert.ok(controllerSource.includes("Object.assign(api,{select,"), "controller fixture binding must be explicit");
vm.runInContext(controllerSource.replace("Object.assign(api,{select,", "api.__testSetModel = value => { model=value; selection=copy(value.selection); };\n    Object.assign(api,{select,"), c);
function controller(model, library) { const api = c.RingsideComparisonController.create({ library: () => library }); api.__testSetModel(model); return api; }
function fixture() {
  const dates = ["2026-04-01", "2026-04-19", "2026-06-07"];
  const athletes = Array.from({ length: 3 }, (_, index) => ({ id: "athlete" + index, name: "模拟事实队员" + index, profile: {}, groupId: "group", records: dates.flatMap((date, period) => {
    if (index === 2 && period === 2) return [];
    const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = ["cmj", "sj", "fms"].includes(id));
    r.recordId = "record" + index + "_" + period; r.athleteId = "athlete" + index; r.athlete.date = date; r.athlete.name = "模拟事实队员" + index; r.athlete.mass = 70;
    r.data.cmj = [{ id: "cmj", height: 30 + index * 3 + period * 4 }]; r.data.sj = [{ id: "sj", height: 25 + index * 2 + period * 2 }];
    r.data.fms.forEach((item, i) => { item.pain = i === 0 && index === 0 && period === 0; if (item.bilateral) { item.left = 2; item.right = 3; } else item.score = item.pain ? 0 : 2; item.notes = "保留原动作备注"; });
    return [r];
  }) }));
  const library = { athletes, groups: [{ id: "group", name: "事实模拟队伍" }], catalog: M.normalizeCatalog(), evaluationProfiles: [] };
  const selection = { groupId: "group", athleteIds: athletes.map(a => a.id), dates, recordChoices: Object.fromEntries(athletes.map(a => [a.id, Object.fromEntries(dates.map(date => [date, a.records.find(r => r.athlete.date === date)?.recordId || ""]))])) };
  const model = C.deriveComparison(library, selection);
  model.metrics[0].observations[0].notes = "人工核对备注\n第二行";
  model.summary.transitions.push({ athleteId: athletes[0].id, fromDate: dates[0], toDate: dates[1], key: "advantage:controlled-false", title: "优势状态类型核验", from: false, to: true, state: "entered", reason: "" });
  return { model, library };
}
function decodeObservation(facts, metric, row) {
  const v = Object.fromEntries(facts.indexing.observationColumns.map((key, i) => [key, row[i] ?? null]));
  return { athleteId: facts.athletes[v.athleteIndex].id, date: facts.dates[v.dateIndex], recordId: facts.indexing.selectedRecordIds[v.athleteIndex][v.dateIndex] || "", value: v.value, reason: facts.indexing.reasons[v.reasonIndex],
    ...(v.pain !== null ? { pain: v.pain } : {}), ...(v.statusIndex !== null ? { status: facts.indexing.statuses[v.statusIndex] } : {}), ...(v.notes !== null ? { notes: v.notes } : {}) };
}
function decodeTransition(facts, row) {
  const v = Object.fromEntries(facts.summary.transitionColumns.map((key, i) => [key, row[i]]));
  return { athleteId: facts.athletes[v.athleteIndex].id, fromDate: facts.dates[v.fromDateIndex], toDate: facts.dates[v.toDateIndex], key: facts.indexing.transitionSubjects[v.subjectIndex], title: facts.indexing.transitionTitles[v.titleIndex], from: facts.indexing.statuses[v.fromStatusIndex], to: facts.indexing.statuses[v.toStatusIndex], state: v.state, reason: facts.indexing.reasons[v.reasonIndex] };
}
let passed = 0; function test(name, run) { run(); passed++; console.log("PASS " + name); }
const { model, library } = fixture(), facts = plain(controller(model, library).facts());
test("every indexed observation round trips athlete date record value missingness pain status and multiline notes", () => {
  assert.equal(facts.metrics.length, model.metrics.length);
  facts.metrics.forEach((metric, i) => { assert.equal(metric.observations.length, model.metrics[i].observations.length); metric.observations.forEach(row => { const decoded = decodeObservation(facts, metric, row), original = model.metrics[i].observations.find(o => o.athleteId === decoded.athleteId && o.date === decoded.date); assert.deepEqual(decoded, plain(original)); }); });
});
test("boolean advantage transitions preserve false separately from absent or textual statuses", () => {
  const at = model.summary.transitions.findIndex(t => t.key === "advantage:controlled-false"), decoded = decodeTransition(facts, facts.summary.transitions[at]);
  assert.equal(decoded.from, false); assert.equal(decoded.to, true); assert.deepEqual(decoded, plain(model.summary.transitions[at]));
});
test("every state transition round trips its subject title baseline current state and reason", () => {
  assert.equal(facts.summary.transitions.length, model.summary.transitions.length); facts.summary.transitions.forEach((row, i) => assert.deepEqual(decodeTransition(facts, row), plain(model.summary.transitions[i])));
});
test("packing preserves zero pain and missing rows while omitting only null trailing columns", () => {
  assert.ok(facts.metrics.some(m => m.observations.some(row => decodeObservation(facts, m, row).value === 0 && decodeObservation(facts, m, row).pain === true)));
  assert.ok(facts.metrics.some(m => m.observations.some(row => decodeObservation(facts, m, row).recordId === "" && decodeObservation(facts, m, row).value === null)));
  assert.ok(facts.metrics.some(m => m.observations.some(row => decodeObservation(facts, m, row).notes === "人工核对备注\n第二行")));
});
test("short metric IDs retain complete scientific identities fixed cohorts periods changes and trends", () => {
  const scalar = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item === null || ["string", "number", "boolean"].includes(typeof item)));
  facts.metrics.forEach((m, i) => { const original = model.metrics[i]; assert.equal(m.key, "metric-" + i); assert.deepEqual(m.identity, plain(original.identity)); assert.deepEqual(m.cohortAthleteIndices.map(index => facts.athletes[index].id), plain(original.cohortIds));
    assert.deepEqual(m.changes, plain(original.changes.map(scalar))); assert.deepEqual(m.periods, plain(original.periods.map(p => ({ ...scalar(p), ...(p.distribution ? { distribution: p.distribution } : {}) })))); assert.deepEqual(m.trend.points, plain(original.trend.points.map(scalar))); });
});
test("AI facts keep each athlete's current context directions and complete executable prescriptions", () => {
  assert.equal(facts.athletes.length, library.athletes.length); assert.equal(facts.trainingDirections.length, model.capabilities.length);
  facts.athletes.forEach(a => { const entries = model.entries.filter(e => e.athleteId === a.id), last = entries.at(-1); assert.deepEqual(a.testContext, plain(last.record.athlete)); assert.deepEqual(a.trainingContext, plain(last.record.trainingContext)); assert.deepEqual(a.directions, plain(entries.map(e => ({ date: e.date, directions: e.directions })))); });
  facts.existingIndividualPlans.forEach(plan => { const entry = model.entries.find(e => e.athleteId === plan.athleteId && e.date === model.dates.at(-1)), reference = c.RingsideInterventions.build(entry.record, entry.stats); assert.deepEqual(plan.execution, plain(reference.execution)); assert.deepEqual(plan.context, plain(reference.context)); });
});
console.log(passed + " comparison controller facts checks passed");
if (process.argv.includes("--full")) {
  const fullLibrary = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../output/comparison-demo/团队与纵向模拟资料库.json"), "utf8"));
  const ids = fullLibrary.athletes.map(a => a.id), dates = [...new Set(fullLibrary.athletes.flatMap(a => a.records.map(r => r.athlete.date)))].sort();
  const selection = { groupId: fullLibrary.groups[0].id, athleteIds: ids, dates, recordChoices: Object.fromEntries(fullLibrary.athletes.map(a => [a.id, Object.fromEntries(dates.map(d => [d, a.records.find(r => r.athlete.date === d)?.recordId || ""]))])), basis: { strength: "jump_elasticity", reactive: "dj_rsi", speed: "sprint_elasticity", jumpProtocol: "fvp_sj" } };
  console.log("Full fixture deriving " + ids.length + " people × " + dates.length + " dates");
  const fullModel = C.deriveComparison(fullLibrary, selection), fullFacts = plain(controller(fullModel, fullLibrary).facts());
  let observationCount = 0, transitionCount = 0;
  fullFacts.metrics.forEach((metric, i) => metric.observations.forEach((row, j) => { assert.deepEqual(decodeObservation(fullFacts, metric, row), plain(fullModel.metrics[i].observations[j])); observationCount++; }));
  fullFacts.summary.transitions.forEach((row, i) => { assert.deepEqual(decodeTransition(fullFacts, row), plain(fullModel.summary.transitions[i])); transitionCount++; });
  const body = { model: "synthetic-model", messages: [{ role: "user", content: "生成解读\n" + JSON.stringify(fullFacts) }], max_tokens: 8000 }, factsBytes = size(fullFacts), requestBytes = size(body);
  const sizeReport = { controllerSha256: controllerHash, factsBytes, requestBytes, metrics: fullModel.metrics.length, fields: Object.fromEntries(Object.entries(fullFacts).map(([k, v]) => [k, size(v)])), summaryFields: Object.fromEntries(Object.entries(fullFacts.summary).map(([k, v]) => [k, size(v)])) };
  console.log("FULL SIZE " + JSON.stringify(sizeReport));
  const out = path.resolve(__dirname, "../output/playwright/v223/ai-facts-diagnostic"); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "controller-size-current.json"), JSON.stringify(sizeReport, null, 2));
  assert.ok(requestBytes < 8 * 1024 * 1024, "facts must fit the existing desktop AI request limit");
  const report = { controllerSha256: controllerHash, fixtureSha256: digest(JSON.stringify(fullLibrary)), testSha256: digest(fs.readFileSync(__filename)), factsVersion: fullFacts.factsVersion, people: ids.length, dates: dates.length, records: fullModel.entries.length, metrics: fullModel.metrics.length, factsBytes, requestBytes, fields: Object.fromEntries(Object.entries(fullFacts).map(([k, v]) => [k, size(v)])), exactRoundTrip: { observations: observationCount, transitions: transitionCount }, sourceUnchanged: digest(fs.readFileSync(controllerPath, "utf8")) === controllerHash };
  assert.equal(report.sourceUnchanged, true, "controller changed during verification");
  fs.writeFileSync(path.join(out, "controller-full-proof.json"), JSON.stringify(report, null, 2));
  console.log("FULL " + JSON.stringify(report));
}
