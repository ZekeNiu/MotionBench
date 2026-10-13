"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, Blob, TextDecoder, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "generic-report", "model", "evaluation", "interventions"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-store.js"), "utf8").replace("  function validateTestPlans(", "  root.testCatalogMerge = mergeCatalog;\n  function validateTestPlans("), c);
const M = c.RingsideModel, E = c.RingsideEvaluation, G = c.RingsideGenericReport, copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const test = (name, run) => { run(); passed++; console.log("PASS " + name); };
function fixture() {
  const r = M.defaults();
  r.enabled = Object.fromEntries(Object.keys(r.enabled).map(id => [id, false]));
  r.customTests.push({ id: "generic_pair", name: "配对试次项目", category: "performance", primaryMetricId: "x", selectionDirection: "higher" });
  r.enabled.generic_pair = true;
  for (const [id, name, unit] of [["x", "横轴成绩", "cm"], ["y", "纵轴成绩", "N"], ["z", "另一成绩", "cm"], ["memo", "记录层成绩", "cm"]])
    r.definitions.push({ id, testId: "generic_pair", name, unit, protocol: "同一试次", direction: "higher", category: "performance", ability: "速度", ranges: [], target: 100, referenceEnabled: true,
      entryScope: id === "memo" ? "record" : "attempt", measurementScale: "ratio", zeroValid: true });
  r.data.generic_pair = [{ id: "a", metrics: { x: 10, y: 100, z: 30 } }, { id: "b", metrics: { x: 20, y: 50, z: 40 } }];
  r.customValues.memo = { value: 7, notes: "完整备注" };
  const record = M.normalizeRecord(r), catalog = M.mergeCatalog(null, record);
  return { record, catalog };
}
function chart(record, kind, metricIds, options = {}) {
  const view = G.createView(record, "generic_pair", { kind, metricIds, ...options });
  return G.buildChart({ record, stats: M.stats(record) }, { id: "generic_pair", reportView: view });
}
test("unconfigured old catalogues and records retain schema and table-only presentation", () => {
  const { record, catalog } = fixture();
  assert.equal(catalog.reportViews, undefined); assert.equal(record.views.genericReports, undefined);
  assert.equal(G.resolveView(record, "generic_pair", catalog).kind, "none");
  assert.equal(M.normalizeRecord(record).schema, 2); assert.equal(M.normalizeCatalog(catalog).revision, catalog.revision);
});
test("style configuration and freezing do not alter raw measurements scoring narrative or AI basis", () => {
  const { record, catalog } = fixture(); record.narrative.text = "人工训练正文";
  const basis = M.fingerprint(record), raw = copy(record.data), scores = copy(M.stats(record).axes), definitions = copy(record.definitions);
  catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "bar", metricIds: ["x", "memo"] }) };
  const r = G.freezeViews(M.normalizeRecord(record), catalog);
  assert.equal(M.fingerprint(r), basis); assert.deepEqual(copy(r.data), raw); assert.deepEqual(copy(r.definitions), definitions);
  assert.deepEqual(copy(M.stats(r).axes), scores); assert.equal(r.narrative.text, "人工训练正文");
  assert.equal(M.normalizeRecord(r).views.genericReports.generic_pair.kind, "bar");
});
test("existing record reads use latest compatible catalogue style without any writes", () => {
  const { record, catalog } = fixture();
  record.views.genericReports = { generic_pair: G.createView(record, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
  catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "column", metricIds: ["z", "x"] }) };
  const before = JSON.stringify(record); const resolved = G.resolveView(record, "generic_pair", catalog);
  assert.equal(resolved.kind, "column"); assert.deepEqual(copy(resolved.metricIds), ["z", "x"]); assert.equal(JSON.stringify(record), before);
  resolved.metricIds.reverse(); assert.deepEqual(copy(catalog.reportViews.generic_pair.metricIds), ["z", "x"]);
});
test("explicit none wins over frozen graphs even after protocol or unit drift", () => {
  const { record, catalog } = fixture();
  record.views.genericReports = { generic_pair: G.createView(record, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
  catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "none" }) };
  catalog.reportViews.generic_pair.binding.projectProtocol.version++;
  assert.equal(G.resolveView(record, "generic_pair", catalog).kind, "none");
});
test("unit entry scope project identity and metric protocol changes fall back to the record snapshot", () => {
  for (const mutate of [view => view.binding.metrics[0].unit = "m", view => view.binding.metrics[0].entryScope = "record", view => view.binding.metrics[0].protocolIdentity.version++, view => view.binding.projectProtocol.version++]) {
    const { record, catalog } = fixture();
    record.views.genericReports = { generic_pair: G.createView(record, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
    catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "column", metricIds: ["x"] }) };
    mutate(catalog.reportViews.generic_pair); assert.equal(G.resolveView(record, "generic_pair", catalog).kind, "bar");
    delete record.views.genericReports; assert.equal(G.resolveView(record, "generic_pair", catalog).kind, "none");
  }
});
test("unknown IDs malformed shape and undeclared fields are rejected during import validation and normalization", () => {
  for (const mutate of [view => view.kind = "unknown", view => view.future = true, view => view.binding.metrics[0].future = 1, view => view.metricIds.push("unknown"), view => view.binding.projectProtocol.version = 0]) {
    const { record, catalog } = fixture(); catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
    mutate(catalog.reportViews.generic_pair); assert.throws(() => M.validateCatalog(catalog)); assert.throws(() => M.normalizeCatalog(catalog));
    record.views.genericReports = copy(catalog.reportViews); assert.throws(() => M.validateRecord(record)); assert.throws(() => M.normalizeRecord(record));
  }
});
test("graph import rejects unsafe keys identifiers and prototype pollution before merging", () => {
  const { record, catalog } = fixture(), view = G.createView(record, "generic_pair", { kind: "bar", metricIds: ["x"] });
  for (const id of ["__proto__", "constructor", "prototype", "unsafe id", "metric:x", "<svg>"]) {
    const invalid = copy(view); invalid.binding.projectProtocol.id = id;
    assert.throws(() => G.validateViews({ generic_pair: invalid }, record));
  }
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}'); assert.throws(() => G.validateViews(polluted, record));
  const extra = copy(view); extra.binding.metrics[0] = JSON.parse(JSON.stringify(extra.binding.metrics[0]).replace(/}$/, ',"__proto__":{"polluted":true}}'));
  assert.throws(() => G.validateViews({ generic_pair: extra }, record));
  assert.equal({}.polluted, undefined); assert.equal(catalog.reportViews, undefined);
});
test("new records freeze configuration with exact measurement signatures", () => {
  const { catalog } = fixture(); catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "column", metricIds: ["x", "z"] }) };
  const created = M.recordFromCatalog(catalog, {}, { generic_pair: true });
  assert.equal(created.views.genericReports.generic_pair.kind, "column"); assert.ok(G.compatible(created.views.genericReports.generic_pair, created, "generic_pair"));
});
test("owned export copies freeze the current style while original old fallback stays intact", () => {
  const { record, catalog } = fixture();
  record.views.genericReports = { generic_pair: G.createView(record, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
  catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "column", metricIds: ["x"] }) };
  const exported = G.freezeViews(copy(record), catalog); assert.equal(G.resolveView(exported, "generic_pair").kind, "column");
  assert.equal(record.views.genericReports.generic_pair.kind, "bar");
});
test("bar and column use representative values ordered and split by exact units", () => {
  const { record } = fixture();
  for (const kind of ["bar", "column"]) {
    const result = chart(record, kind, ["z", "y", "x", "memo"]);
    assert.equal(result.available, true); assert.deepEqual(copy(result.panels.map(p => p.unit)), ["cm", "N"]);
    assert.deepEqual(copy(result.panels[0].items.map(i => [i.id, i.value])), [["z", 40], ["x", 20], ["memo", 7]]);
    assert.equal(result.panels[1].items[0].value, 50);
  }
});
test("raw charts preserve true zero and negative numeric data", () => {
  const { record } = fixture(); record.data.generic_pair[1].metrics.x = 0; record.data.generic_pair[0].metrics.x = -5;
  const bars = chart(record, "bar", ["x"]); assert.equal(bars.panels[0].items[0].value, 0);
  const trials = chart(record, "trials", ["x"]); assert.deepEqual(copy(trials.panels[0].series[0].points.map(p => p.value)), [-5, 0]);
});
test("trial points retain actual trial indices and omit missing observations without filling zero", () => {
  const { record } = fixture(); record.data.generic_pair.push({ id: "c", metrics: { x: "", y: 60 } }, { id: "d", metrics: { x: 0, y: 0 } });
  const result = chart(record, "trials", ["x", "y"]);
  assert.deepEqual(copy(result.panels[0].series[0].points.map(p => [p.index, p.value])), [[1, 10], [2, 20], [4, 0]]);
  assert.deepEqual(copy(result.panels.map(p => p.unit)), ["cm", "N"]);
  assert.throws(() => G.createView(record, "generic_pair", { kind: "trials", metricIds: ["memo"] }));
  record.data.generic_pair.forEach(row => row.metrics.y = "");
  assert.match(chart(record, "trials", ["x", "y"]).reason, /纵轴成绩.*没有有效试次/);
});
test("scatter plots pair same-trial X/Y and never splice independent representative results", () => {
  const { record } = fixture(); const result = chart(record, "scatter", [], { xMetricId: "x", yMetricId: "y" });
  assert.deepEqual(copy(result.panels[0].points.map(p => [p.x, p.y])), [[10, 100], [20, 50]]);
  assert.equal(result.panels[0].xAxis.unit, "cm"); assert.equal(result.panels[0].yAxis.unit, "N");
  assert.ok(!result.panels[0].points.some(p => p.x === 20 && p.y === 100));
  record.data.generic_pair = [{ id: "a", metrics: { x: 10 } }, { id: "b", metrics: { y: 50 } }];
  assert.equal(chart(record, "scatter", [], { xMetricId: "x", yMetricId: "y" }).available, false);
});
test("target comparisons use effective current scheme targets and explain inapplicability", () => {
  const { record } = fixture(); const p = E.create(record);
  Object.assign(p.standards.find(rule => rule.metricId === "x"), { enabled: true, targetEnabled: true, target: 25 });
  Object.assign(p.standards.find(rule => rule.metricId === "y"), { enabled: false });
  const resolved = E.resolve(record, p), result = chart(resolved, "target", ["x", "y"]);
  assert.equal(result.available, true); assert.equal(result.panels[0].items[0].target, 25); assert.match(result.reason, /纵轴成绩/);
  resolved.evaluationStandards.find(rule => rule.metricId === "x").targetApplicable = false;
  assert.equal(chart(resolved, "target", ["x"]).available, false);
});
function scoringFixture() {
  const { record } = fixture(), p = E.create(record), members = ["x", "y", "z", "memo"].map(id => "metric:" + id);
  p.aggregations = { "ability:速度": { method: "mean", members, transforms: Object.fromEntries(members.map(id => [id, { kind: "ratio", direction: "higher" }])) } };
  for (const id of ["x", "y", "z", "memo"]) Object.assign(p.standards.find(rule => rule.metricId === id), { enabled: true, targetEnabled: true, target: 100 });
  return E.resolve(record, p);
}
test("single-member scoring survives missing mean siblings but retains configured member eligibility", () => {
  const record = scoringFixture(); record.customValues.memo.value = "";
  const computed = M.stats(record); assert.equal(computed.axes.length, 0);
  assert.equal(M.metricScore(record, "x", computed).score, 20); assert.equal(M.metricScore(record, "memo", computed).valid, false);
  const cfg = c.RingsideTests.axisConfig(record, "速度"); cfg.members = cfg.members.filter(id => id !== "metric:x");
  assert.equal(M.metricScore(record, "x").valid, false);
});
test("radar uses existing explicit 0–100 rules independently of incomplete ability aggregate", () => {
  const record = scoringFixture(); record.customValues.memo.value = "";
  const result = chart(record, "radar", ["x", "y", "z"]);
  assert.equal(result.available, true); assert.deepEqual(copy(result.panels[0].axes.map(axis => axis.value)), [20, 50, 40]);
  const baseline = M.stats(record); assert.equal(baseline.axes.length, 0);
  record.data.generic_pair[1].metrics.z = ""; assert.equal(chart(record, "radar", ["x", "y", "z"]).available, false);
  assert.match(chart(record, "radar", ["x", "y", "z"]).reason, /另一成绩.*缺少/);
});
test("radar rejects missing explicit scoring target applicability and invalid axis counts", () => {
  const { record } = fixture(); assert.match(chart(record, "radar", ["x", "y", "z"]).reason, /未配置/);
  assert.throws(() => G.createView(record, "generic_pair", { kind: "radar", metricIds: ["x", "y"] }));
  const scored = scoringFixture(); scored.evaluationStandards.find(rule => rule.metricId === "x").applicable = false;
  assert.equal(chart(scored, "radar", ["x", "y", "z"]).available, false);
});
test("single metric anchors and score tables exactly match the existing primary scores", () => {
  for (const transform of [{ kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 40, score: 100 }] },
      { kind: "table", ranges: [{ min: 0, max: 20, includeMax: true, score: 62 }, { min: 20, max: null, includeMin: false, score: 90 }] }]) {
    const { record } = fixture(), p = E.create(record);
    p.aggregations = { "ability:速度": { method: "primary", primary: "metric:x", scoringVersion: 1, transforms: { "metric:x": transform } } };
    Object.assign(p.standards.find(rule => rule.metricId === "x"), { enabled: true, targetEnabled: false });
    const resolved = E.resolve(record, p), computed = M.stats(resolved), single = M.metricScore(resolved, "x", computed);
    assert.equal(single.valid, true); assert.equal(single.score, computed.axes[0].value);
  }
});
test("backup merge keeps explicit local styles including none and imports missing compatible styles", () => {
  for (const localKind of ["none", "bar"]) {
    const { catalog } = fixture(), incoming = copy(catalog);
    catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: localKind, metricIds: ["x"] }) };
    incoming.reportViews = { generic_pair: G.createView(incoming, "generic_pair", { kind: "column", metricIds: ["x"] }) };
    c.testCatalogMerge(catalog, incoming); assert.equal(catalog.reportViews.generic_pair.kind, localKind);
  }
  const { catalog } = fixture(), incoming = copy(catalog);
  incoming.reportViews = { generic_pair: G.createView(incoming, "generic_pair", { kind: "column", metricIds: ["x"] }) };
  const before = JSON.stringify(incoming); c.testCatalogMerge(catalog, incoming); assert.equal(catalog.reportViews.generic_pair.kind, "column"); assert.equal(JSON.stringify(incoming), before);
});
test("backup merge adds new compatible projects but does not apply a mismatched imported graph", () => {
  const { catalog: incoming } = fixture(), local = M.normalizeCatalog();
  incoming.reportViews = { generic_pair: G.createView(incoming, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
  c.testCatalogMerge(local, incoming); assert.equal(local.reportViews.generic_pair.kind, "bar");
  const { catalog } = fixture(), mismatch = copy(catalog);
  mismatch.reportViews = { generic_pair: G.createView(mismatch, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
  mismatch.reportViews.generic_pair.binding.metrics[0].unit = "m";
  c.testCatalogMerge(catalog, mismatch); assert.equal(catalog.reportViews, undefined);
});
test("single-report catalogue discovery never promotes frozen fallback into shared configuration", () => {
  const { record } = fixture(); record.views.genericReports = { generic_pair: G.createView(record, "generic_pair", { kind: "bar", metricIds: ["x"] }) };
  assert.equal(M.mergeCatalog(null, record).reportViews, undefined);
});
function memoryRepository() {
  const tables = new Map(), table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
  const key = (name, row) => name === "meta" ? row.id : JSON.stringify([row.generation, row.id]);
  const repo = new c.RingsideStore.Repository({ transaction() {
    const tx = { objectStore(name) { return {
      put(row) { table(name).set(key(name, row), copy(row)); },
      get(id) { const request = {}; queueMicrotask(() => { request.result = table(name).get(name === "meta" ? id : JSON.stringify(id)); request.onsuccess?.(); }); return request; },
    }; } }; queueMicrotask(() => tx.oncomplete?.()); return tx;
  } });
  repo.meta = async id => table("meta").get(id);
  repo.get = async (name, id, generation = repo.generation) => table(name).get(JSON.stringify([generation, id]))?.value;
  repo.values = async (name, generation = repo.generation) => [...table(name).values()].filter(row => row.generation === generation).map(row => row.value);
  repo.batches = async function *(name, generation = repo.generation) { yield await repo.values(name, generation); };
  return repo;
}
async function backupTests() {
  const { record, catalog } = fixture();
  catalog.reportViews = { generic_pair: G.createView(catalog, "generic_pair", { kind: "bar", metricIds: ["x", "y"] }) };
  G.freezeViews(record, catalog);
  const lib = E.migrate(M.recordEnvelope(record, null, catalog)), expectedViews = copy(lib.catalog.reportViews), expectedRecordViews = copy(lib.athletes[0].records[0].views.genericReports);
  const repo = memoryRepository(); await repo.importLibrary(lib);
  const blob = await repo.backupBlob(), rows = [];
  for await (const row of c.RingsideStore.fileRows(blob)) rows.push(row);
  assert.deepEqual(copy(rows.find(row => row.type === "config").value.catalog.reportViews), expectedViews);
  assert.deepEqual(copy(rows.find(row => row.type === "record").value.views.genericReports), expectedRecordViews);
  const restored = memoryRepository(); await restored.importRows(c.RingsideStore.fileRows(blob));
  const roundTrip = await restored.exportLibrary(); assert.deepEqual(copy(roundTrip.catalog.reportViews), expectedViews);
  assert.deepEqual(copy(roundTrip.athletes[0].records[0].views.genericReports), expectedRecordViews);
  passed++; console.log("PASS production JSONL backup and restore retain both catalogue style and frozen record fallback");
  const originalGeneration = repo.generation, original = await repo.exportLibrary(), originalConfig = copy(original.catalog);
  const bad = copy(rows); bad.find(row => row.type === "config").value.catalog.reportViews.generic_pair.kind = "unsupported";
  const invalidBlob = new Blob([bad.map(row => JSON.stringify(row)).join("\n") + "\n"]);
  await assert.rejects(repo.importRows(c.RingsideStore.fileRows(invalidBlob)));
  assert.equal(repo.generation, originalGeneration); assert.deepEqual(copy((await repo.exportLibrary()).catalog), originalConfig);
  passed++; console.log("PASS malformed graph backup rejection leaves the active library generation and data unchanged");
  console.log(passed + " generic report model checks passed");
}
backupTests().catch(error => { console.error(error); process.exitCode = 1; });
