"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); context.window = context;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "longitudinal-store", "store"]) vm.runInContext(fs.readFileSync(path.join(root, "src/ringside-" + name + ".js"), "utf8"), context);
const M = context.RingsideModel, E = context.RingsideEvaluation, L = context.RingsideLongitudinalStore, plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
function fixture() {
  const record = M.defaults(); record.recordId = "r1"; record.athleteId = "a1"; record.athlete.name = "Synthetic"; record.athlete.date = "2026-01-01";
  const library = E.migrate(M.recordEnvelope(record)), second = plain(library.athletes[0].records[0]); second.recordId = "r2"; second.athlete.date = "2026-02-01"; library.athletes[0].records.push(second);
  const document = L.normalize({ athleteId: "a1", recordIds: ["r2", "r1"], mode: "mean", evaluationProfileId: library.defaultEvaluationProfileId, profileSnapshot: library.evaluationProfiles[0], views: { highlightRecordId: "r2" }, narrative: { text: "Coach original", revision: 2, basis: "original-basis" }, previousNarrative: { text: "Previous coach text" }, basis: "current-basis" });
  return { library, document };
}
test("standalone and longitudinal exports carry stable classification dependencies", () => {
  const { library, document } = fixture();library.classifications={version:1,sports:[{id:"sport_one",name:"当前专项名称",subdivisionLabel:"用户自定"}],subdivisions:[{id:"detail_one",sportId:"sport_one",name:"细分名称"}],ageBands:[]};
  Object.assign(library.athletes[0].profile,{sport:"原专项名称",sportId:"sport_one",subdivisionId:"detail_one"});const before=JSON.stringify(library);
  const output=L.exportLibrary(library,document,library.athletes[0].records);assert.deepEqual(plain(output.classifications),plain(library.classifications));assert.equal(output.athletes[0].profile.sportId,"sport_one");
  const report=M.recordEnvelope(library.athletes[0].records[0],library.athletes[0].profile,library.catalog,library.classifications),normalized=E.migrate(report);assert.deepEqual(plain(normalized.classifications),plain(library.classifications));assert.equal(normalized.athletes[0].profile.subdivisionId,"detail_one");assert.equal(JSON.stringify(library),before);
});
test("document key is order independent and cannot collide across athletes or ID sets", () => {
  assert.equal(L.key("a1", ["r2", "r1"]), L.key("a1", ["r1", "r2"])); assert.notEqual(L.key("a1", ["r1", "r2"]), L.key("a2", ["r1", "r2"]));
  assert.throws(() => L.key("__proto__", ["r1", "r2"])); assert.throws(() => L.normalize({ athleteId: "a1", recordIds: ["r1", "r1"] }));
});
test("put/get clone documents without changing measurements or per-record narrative", () => {
  const { library, document } = fixture(), prior = JSON.stringify(library.athletes);
  L.put(library, document); const loaded = L.get(library, "a1", ["r1", "r2"]); loaded.narrative.text = "Unpersisted";
  assert.equal(library.longitudinalReports[0].narrative.text, "Coach original"); assert.equal(JSON.stringify(library.athletes), prior);
});
test("valid date and one-owner checks reject invalid or unrelated records", () => {
  const { library, document } = fixture(); library.athletes[0].records[1].athlete.date = "2026-02-30"; assert.throws(() => L.put(library, document), /日期/);
  library.athletes[0].records[1].athlete.date = "2026-01-01"; L.put(library, document);
  library.athletes[0].records[1].athleteId = "a2"; assert.throws(() => L.put(library, document), /不存在/);
});
test("archived records remain backup-valid but cannot start a new active comparison", () => {
  const { library, document } = fixture(); library.athletes[0].records[1].archived = true;
  assert.equal(L.validateReferences(document, library), true); assert.throws(() => L.put(library, document), /不可用/);
});
test("malformed document trees and nested import archives are rejected", () => {
  const { document } = fixture(); assert.throws(() => L.normalize({ ...document, views: { number: Infinity } }), /无效/);
  assert.throws(() => L.normalize(JSON.parse('{"athleteId":"a1","recordIds":["r1","r2"],"views":{"__proto__":{}}}')), /不安全/);
  assert.throws(() => L.normalize({ ...document, importedVersions: [{ ...document, importedVersions: [document] }] }), /历史/);
  assert.throws(() => L.normalize({ ...document, importedVersions: [{ ...document, key:undefined, athleteId:"a2" }] }), /历史/);
});
test("all document identity references and archived versions remap on import", () => {
  const { document } = fixture(), oldProfile = document.evaluationProfileId;
  const mapped = L.remap({ ...document, importedVersions: [document] }, { athleteMap: { a1: "a9" }, recordMap: { r1: "r9", r2: "r8" }, profileMap: { [oldProfile]: "p9" } });
  assert.equal(mapped.athleteId, "a9"); assert.deepEqual(plain(mapped.recordIds), ["r8", "r9"]); assert.equal(mapped.key, L.key("a9", ["r8", "r9"]));
  assert.equal(mapped.evaluationProfileId, "p9"); assert.equal(mapped.profileSnapshot.id, "p9"); assert.equal(mapped.views.highlightRecordId, "r8"); assert.equal(mapped.importedVersions[0].views.highlightRecordId, "r8");
});
test("same-selection import retains local current and previous bodies with flat deduplicated incoming archives", () => {
  const { document } = fixture(), incoming = L.normalize({ ...document, narrative: { text: "Imported coach text", revision: 7 } });
  const once = L.merge([document], [incoming]), twice = L.merge(once, [incoming]);
  assert.equal(twice[0].narrative.text, "Coach original"); assert.equal(twice[0].previousNarrative.text, "Previous coach text"); assert.equal(twice[0].importedVersions.length, 1); assert.equal(twice[0].importedVersions[0].narrative.text, "Imported coach text");
});
test("comparison export includes only selected real records, athlete and referenced profiles", () => {
  const { library, document } = fixture(), original = JSON.stringify(library), extra = plain(library.athletes[0].records[0]); extra.recordId = "r3"; library.athletes[0].records.push(extra);
  const other = plain(library.athletes[0]); other.id = "a2"; other.records = []; library.athletes.push(other);
  const unrelated = E.create(M.defaults(), "Unrelated"); library.evaluationProfiles.push(unrelated);
  const exported = L.exportLibrary(library, document, library.athletes[0].records);
  assert.equal(exported.athletes.length, 1); assert.equal(exported.athletes[0].records.length, 2); assert.equal(exported.evaluationProfiles.length, 1); assert.equal(exported.longitudinalReports[0].narrative.text, "Coach original");
  assert.throws(() => L.exportLibrary(library, document, []), /完整记录/); assert.notEqual(JSON.stringify(library), original); assert.equal(library.athletes[0].records.length, 3);
});
test("configuration preserves optional documents and ignores withdrawn comparisonReports", () => {
  const { library, document } = fixture(); library.comparisonReports = [{ narrative: "Old withdrawn" }];
  assert.equal(context.RingsideStore.configuration(library).longitudinalReports, undefined);
  L.put(library, document); const config = context.RingsideStore.configuration(library); assert.equal(config.longitudinalReports.length, 1); assert.equal(config.comparisonReports, undefined);
});
test("legacy library normalization retains and validates additive longitudinal documents", () => {
  const { library, document } = fixture(); L.put(library, document); const legacy = { ...library, schema: 2 };
  const normalized = M.normalizeLibrary(legacy); assert.equal(normalized.longitudinalReports[0].narrative.text, "Coach original");
  legacy.longitudinalReports[0].recordIds = ["r1", "missing"]; delete legacy.longitudinalReports[0].key; assert.throws(() => M.normalizeLibrary(legacy), /不存在/);
});
test("historical comparison retains deleted evaluation scheme through matching snapshot and self-contained export", () => {
  const { library, document } = fixture(), replacement = E.create(M.defaults(), "Replacement live scheme");
  library.evaluationProfiles = [replacement]; library.defaultEvaluationProfileId = replacement.id; library.athletes[0].records.forEach(record=>record.evaluationProfileId=replacement.id);
  assert.equal(L.validateReferences(document, library), true);
  const exported = L.exportLibrary(library, document, library.athletes[0].records);
  assert.equal(exported.evaluationProfiles.length, 2); assert.ok(exported.evaluationProfiles.some(profile=>profile.id===document.profileSnapshot.id));
  assert.throws(()=>L.normalize({...document,evaluationProfileId:"different-id"}),/快照/);
});
console.log(`${passed} longitudinal storage model checks passed`);
