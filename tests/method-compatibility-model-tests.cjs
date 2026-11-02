"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { context, createFixture } = require("./helpers/longitudinal-fixture.cjs");
const c = context(), M = c.RingsideModel, E = c.RingsideEvaluation, G = c.RingsideGenericReport;
const copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
test("new records, catalogues, standards and chart bindings do not create method identities", () => {
  const r = M.defaults(), catalog = M.normalizeCatalog();
  assert.ok(!Object.keys(r.protocolIdentities || {}).length);
  assert.ok(r.definitions.every(d => !d.protocolIdentity));
  assert.ok(!Object.keys(catalog.protocolIdentities || {}).length);
  const p = E.create(r);
  assert.doesNotMatch(JSON.stringify(p.standards), /protocolIdentity|metricProtocolIdentity|projectProtocolIdentity/);
  const f = createFixture(c), view = G.createView(f.records[0], "long_generic", { kind: "bar", metricIds: ["long_time"] });
  assert.doesNotMatch(JSON.stringify(view.binding), /projectProtocol|protocolIdentity/);
});
test("legacy identities and description changes do not reject standards or alter mathematical context", () => {
  const r = M.sampleRecord(); M.stampProtocolIdentities(r);
  const p = E.create(r), before = E.resolve(r, p), next = copy(r);
  Object.values(next.protocolIdentities).forEach(identity => { identity.id += "_legacy"; identity.version = 7; });
  next.definitions.forEach(d => { if (d.protocolIdentity) d.protocolIdentity.version = 9; d.protocol += " revised wording"; });
  next.data.iso.forEach(row => { row.protocol = "another description"; row.protocolIdentity.version = 3; });
  Object.keys(next.protocol).forEach(id => next.protocol[id] = "description correction");
  const after = E.resolve(next, p);
  assert.deepEqual(copy(after.definitions.map(d => [d.id, d.target, d.referenceEnabled])), copy(before.definitions.map(d => [d.id, d.target, d.referenceEnabled])));
  assert.deepEqual(copy(after.data.iso.map(d => [d.id, d.target, d.reference])), copy(before.data.iso.map(d => [d.id, d.target, d.reference])));
  assert.equal(E.contextSignature(E.measurementContext(r, r.definitions.find(d => d.id === "cmj_height"))), E.contextSignature(E.measurementContext(next, next.definitions.find(d => d.id === "cmj_height"))));
  next.cmjConfig.definition = next.cmjConfig.definition === "net" ? "gross" : "net";
  assert.notEqual(E.contextSignature(E.measurementContext(r, r.definitions.find(d => d.id === "cmj_peak_force"))), E.contextSignature(E.measurementContext(next, next.definitions.find(d => d.id === "cmj_peak_force"))));
  assert.equal(M.normalizeRecord(next).protocolIdentities.cmj.version, 7);
});
test("method metadata no longer splits longitudinal observations, while true result definitions still do", () => {
  const f = createFixture(c); f.records.forEach(M.stampProtocolIdentities);
  f.records[1].protocolIdentities.cmj.version = 8;
  f.records[1].protocol.cmj = "video or equipment notes";
  let row = c.RingsideLongitudinal.build(f.records, f).projects.find(p => p.id === "cmj").metrics.find(r => r.id === "cmj_height");
  assert.equal(new Set(row.cells.filter(Boolean).map(cell => cell.contextKey)).size, 1);
  f.records.forEach(record => record.data.cmj.forEach(row => row.force = 1500));
  f.records[1].cmjConfig.definition = "net";
  row = c.RingsideLongitudinal.build(f.records, f).projects.find(p => p.id === "cmj").metrics.find(r => r.id === "cmj_peak_force");
  assert.ok(row); assert.equal(new Set(row.cells.filter(Boolean).map(cell => cell.contextKey)).size, 2);
  assert.equal(row.cells[1].comparableToPrevious, false);
});
test("catalogue imports ignore methods but retain real definition conflicts", () => {
  const f = createFixture(c), catalog = M.normalizeCatalog(f.catalog), r = copy(f.records[0]);
  M.stampProtocolIdentities(r); r.protocolIdentities.long_generic.version = 8;
  r.protocol.long_generic = "different notes";
  r.definitions.filter(d => d.testId === "long_generic").forEach(d => { d.protocol = "different text"; d.protocolIdentity.version = 5; });
  assert.equal(M.mergeCatalog(catalog, r).conflicts.filter(x => !x.resolved).length, 0);
  r.definitions.find(d => d.id === "long_time").unit = "kg";
  assert.ok(M.mergeCatalog(catalog, r).conflicts.some(x => !x.resolved && x.testId === "long_generic"));
});
test("identity-only fingerprint changes keep the prior narrative basis usable", () => {
  const r = M.sampleRecord(); M.stampProtocolIdentities(r);
  const baseline = M.fingerprint(r); r.protocolIdentities.cmj.version = 4; r.definitions[0].protocolIdentity.version = 6;
  assert.equal(M.fingerprint(r), baseline);
  const priorBasis = JSON.parse(baseline); priorBasis.protocolVersions = copy(r.protocolIdentities);
  priorBasis.definitions[0].protocolIdentity = { id: "legacy_metric", version: 9 };
  assert.equal(M.fingerprintMatchesExceptAge(JSON.stringify(priorBasis), r), true);
  r.data.cmj[0].height++;
  assert.equal(M.fingerprintMatchesExceptAge(JSON.stringify(priorBasis), r), false);
});
test("old chart bindings remain usable across versions but units and entry scope still guard charts", () => {
  const f = createFixture(c), r = f.records[0], view = G.createView(r, "long_generic", { kind: "bar", metricIds: ["long_time"] });
  view.binding.projectProtocol = { id: "different_legacy_project", version: 17 };
  view.binding.metrics[0].protocolIdentity = { id: "different_legacy_metric", version: 29 };
  assert.equal(G.compatible(view, r, "long_generic"), true);
  view.binding.metrics[0].unit = "kg"; assert.equal(G.compatible(view, r, "long_generic"), false);
  view.binding.metrics[0].unit = "s"; view.binding.metrics[0].entryScope = "record";
  assert.equal(G.compatible(view, r, "long_generic"), false);
});
test("obsolete method-only catalogue conflicts resolve without erasing their preserved variants", () => {
  const f = createFixture(c), catalog = M.normalizeCatalog(f.catalog), test = catalog.tests.find(t => t.id === "long_generic");
  const original = { test: copy(test), definitions: copy(catalog.definitions.filter(d => d.testId === test.id)), protocol: "notes", source: "old" };
  const incoming = copy(original); incoming.protocol = "different notes"; incoming.protocolIdentity = { id: "legacy", version: 14 };
  incoming.definitions.forEach(d => { d.protocol = "another description"; d.protocolIdentity = { id: "old_" + d.id, version: 18 }; });
  catalog.conflicts.push({ id: test.id, testId: test.id, name: test.name, resolved: false, variants: [original, incoming] });
  const normalized = M.normalizeCatalog(catalog), conflict = normalized.conflicts.find(c => c.testId === test.id);
  assert.equal(conflict.resolved, true); assert.equal(conflict.variants.length, 2);
  catalog.conflicts[0].variants[1].definitions[0].unit = "kg";
  assert.equal(M.normalizeCatalog(catalog).conflicts[0].resolved, false);
});
test("mathematical and storage format versions are not treated as legacy method identities", () => {
  const value = { calculation: { version: 1, kind: "sum", inputMetricIds: ["a", "b"] }, measurementVersion: 1, measurementPolicyVersion: 1, methodVersion: "solver-v1", revision: 4 };
  assert.deepEqual(copy(M.measurementCompatibility(value, { protocolText: true })), value);
});
test("project and metric forms no longer expose method version controls", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/ringside-app.js"), "utf8");
  assert.doesNotMatch(app, /catalogProjectMethodChanged|catalogMetricMethodChanged|catalogProtocolVersion|catalogMetricProtocolVersion/);
});
console.log("Passed " + passed + " method compatibility model tests");
