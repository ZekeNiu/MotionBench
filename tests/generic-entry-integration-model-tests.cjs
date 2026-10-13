"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "generic-report", "model", "evaluation"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
// Run the production entry installer directly, replacing only its UI guards.
// This protects the actual record/snapshot transfer without opening user data.
const app = fs.readFileSync(path.join(__dirname, "../src/ringside-app.js"), "utf8"), start = app.indexOf("  function installCatalogProject("), end = app.indexOf("  function orderedEntryProjects(", start);
assert.ok(start >= 0 && end > start);
vm.runInContext("const M=RingsideModel,T=RingsideTests,copy=v=>JSON.parse(JSON.stringify(v));var state,library;let blocked=false,scopeConflict=false;const projectBlocked=()=>blocked,catalogScopeConflict=()=>scopeConflict;" + app.slice(start, end) + "\n globalThis.installProject=installCatalogProject;", c);
const M = c.RingsideModel, G = c.RingsideGenericReport, copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const test = (name, run) => { run(); passed++; console.log("PASS " + name); };
function fixture() {
  const catalogue = M.normalizeCatalog(), id = "entry_generic", metricId = "entry_generic_force";
  catalogue.tests.push({ id, name: "独立通用试次", category: "performance", primaryMetricId: metricId, selectionDirection: "higher" });
  catalogue.protocol[id] = "原测量方法"; catalogue.protocolIdentities[id] = { id: "protocol_project_entry_generic", version: 1 };
  catalogue.definitions.push({ id: metricId, testId: id, name: "试次力", category: "performance", ability: "速度", unit: "N", direction: "higher", ranges: [], target: null,
    referenceEnabled: false, entryScope: "attempt", protocol: "指标方法", protocolIdentity: { id: "protocol_metric_entry_force", version: 1 } });
  catalogue.reportViews = { [id]: G.createView(catalogue, id, { kind: "bar", metricIds: [metricId] }) };
  const record = M.recordFromCatalog(catalogue, { name: "Synthetic entry record" }, { [id]: true });
  record.data[id] = [{ id: "trial1", metrics: { [metricId]: 100 } }, { id: "trial2", metrics: { [metricId]: 120 } }];
  record.narrative.text = "人工正文";
  return { catalogue, record, id, metricId };
}
function expose(record, catalogue) {
  c.state = record; c.library = { catalog: catalogue, athletes: [{ records: [copy(record)] }] };
  vm.runInContext("blocked=false;scopeConflict=false;", c);
}
test("first inclusion copies generated project protocol identity and produces a compatible current chart", () => {
  const { catalogue, record, id } = fixture(); record.catalogAppliedTests = []; delete record.protocolIdentities[id]; delete record.views.genericReports[id];
  expose(record, catalogue); assert.equal(c.installProject(id), true);
  assert.deepEqual(copy(record.protocolIdentities[id]), copy(catalogue.protocolIdentities[id]));
  assert.equal(G.resolveView(record, id, catalogue).kind, "bar");
  assert.equal(record.views.genericReports[id].kind, "bar"); assert.equal(G.resolveView(record, id).kind, "bar");
  assert.equal(M.normalizeRecord(record).protocolIdentities[id].id, "protocol_project_entry_generic");
});
test("explicit current-record update copies changed measurement identity without rewriting other records", () => {
  const { catalogue, record, id, metricId } = fixture(), raw = copy(record.data), frozenHistory = copy(record);
  catalogue.protocol[id] = "后续的新方法"; catalogue.protocolIdentities[id].version = 2;
  catalogue.definitions.find(d => d.id === metricId).protocolIdentity.version = 2;
  catalogue.reportViews[id] = G.createView(catalogue, id, { kind: "column", metricIds: [metricId] });
  expose(record, catalogue); const historyBefore = JSON.stringify(c.library.athletes);
  assert.equal(c.installProject(id, true), true);
  assert.equal(record.protocolIdentities[id].version, 2); assert.equal(record.definitions.find(d => d.id === metricId).protocolIdentity.version, 2);
  assert.equal(G.resolveView(record, id, catalogue).kind, "column"); assert.deepEqual(copy(record.data), raw);
  assert.equal(G.resolveView(record, id).kind, "column");
  assert.equal(record.narrative.text, "人工正文"); assert.equal(JSON.stringify(c.library.athletes), historyBefore);
  assert.equal(frozenHistory.protocolIdentities[id].version, 1);
});
test("changing the representative metric explicitly takes effect before save and survives reopening", () => {
  const { catalogue, record, id, metricId } = fixture(), secondaryId = "entry_generic_secondary";
  const second = { ...copy(catalogue.definitions.find(d => d.id === metricId)), id: secondaryId, name: "另一试次力", protocolIdentity: { id: "protocol_metric_entry_secondary", version: 1 } };
  catalogue.definitions.push(copy(second)); record.definitions.push(copy(second));
  record.data[id][0].metrics[secondaryId] = 100;
  record.data[id][1].metrics[secondaryId] = 50;
  const originalRaw = copy(record.data);
  const currentProject = catalogue.tests.find(test => test.id === id);
  currentProject.primaryMetricId = secondaryId; currentProject.selectionDirection = "lower";
  currentProject.name = "明确更新后的项目名称"; currentProject.primaryAbility = "上肢爆发力";
  expose(record, catalogue); assert.equal(c.installProject(id, true), true);
  // Match the existing caller's post-install custom-project update as well.
  Object.assign(record.customTests.find(test => test.id === id), copy(catalogue.tests.find(test => test.id === id)));
  const snapshot = record.projectSnapshots.find(test => test.id === id), custom = record.customTests.find(test => test.id === id);
  for (const key of ["primaryMetricId", "selectionDirection", "primaryAbility", "name"]) {
    assert.equal(snapshot[key], currentProject[key]); assert.equal(custom[key], currentProject[key]);
  }
  const stats = M.stats(record), reopened = M.normalizeRecord(record);
  assert.equal(stats.values[metricId], 120); assert.equal(stats.values[secondaryId], 50);
  assert.deepEqual(copy(stats.repetitions.find(group => group.testId === id).selectedIds), ["trial2"]);
  for (const key of ["primaryMetricId", "selectionDirection", "primaryAbility", "name"]) assert.equal(reopened.projectSnapshots.find(test => test.id === id)[key], currentProject[key]);
  assert.deepEqual(copy(M.stats(reopened).values), copy(stats.values));
  assert.equal(M.fingerprint(reopened), M.fingerprint(record));
  assert.deepEqual(copy(record.data), originalRaw); assert.deepEqual(copy(reopened.data), originalRaw);
});
test("re-entering an already-installed project preserves historical definitions identity and frozen view", () => {
  const { catalogue, record, id, metricId } = fixture(), before = { protocol: record.protocol[id], identity: copy(record.protocolIdentities[id]), definition: copy(record.definitions.find(d => d.id === metricId)), raw: copy(record.data), views: copy(record.views) };
  catalogue.protocol[id] = "当前项目库另一个方法"; catalogue.protocolIdentities[id].version++;
  catalogue.definitions.find(d => d.id === metricId).protocolIdentity.version++;
  catalogue.reportViews[id] = G.createView(catalogue, id, { kind: "column", metricIds: [metricId] });
  expose(record, catalogue); assert.equal(c.installProject(id), true);
  assert.deepEqual(copy(record.protocolIdentities[id]), before.identity); assert.equal(record.protocol[id], before.protocol);
  assert.deepEqual(copy(record.definitions.find(d => d.id === metricId)), before.definition); assert.deepEqual(copy(record.data), before.raw); assert.deepEqual(copy(record.views), before.views);
  assert.equal(G.resolveView(record, id, catalogue).kind, "bar");
});
test("blocked first inclusion and incompatible entry-level updates fail before touching the record", () => {
  for (const guard of ["blocked", "scopeConflict"]) {
    const { catalogue, record, id } = fixture(); record.catalogAppliedTests = [];
    expose(record, catalogue); vm.runInContext(guard + "=true;", c);
    const before = JSON.stringify(record); assert.equal(c.installProject(id), false); assert.equal(JSON.stringify(record), before);
  }
});
console.log(passed + " generic entry integration model checks passed");
