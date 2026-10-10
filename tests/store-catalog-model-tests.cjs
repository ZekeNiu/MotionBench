"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const ctx = vm.createContext({console, Intl, Blob, TextDecoder, crypto: require("node:crypto").webcrypto}); ctx.window = ctx;
for (const name of ["calc", "fvp", "sprint-fvp", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), ctx);
// Exercise the real synchronous merge without opening IndexedDB or adding a
// production API solely for the tests.
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-store.js"), "utf8")
  .replace("  function validateTestPlans(", "  root.testCatalogMerge = mergeCatalog;\n  function validateTestPlans("), ctx);
const M = ctx.RingsideModel, merge = ctx.testCatalogMerge, copy = x => JSON.parse(JSON.stringify(x));
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
function oldCatalog() {
  const catalog = M.normalizeCatalog(), definition = catalog.definitions.find(d => d.id === "ift_treadmill");
  catalog.tests.find(t => t.id === "ift").name = "30–15 IFT";
  definition.name = "30–15 IFT·跑台改良版终末速度";
  definition.protocol = "跑台改良版：2.222222 m/s 起，每级 +0.138889 m/s，30 秒跑 / 15 秒被动恢复；记录最终完整级与未完成级持续时间。不得套用至折返版。";
  catalog.definitions.find(d => d.id === "ift_shuttle").name = "30–15 折返 VIFT";
  return catalog;
}
test("old shipped VIFT descriptions merge with neutral defaults without a false version conflict", () => {
  for (const reverse of [false, true]) {
    const local = reverse ? oldCatalog() : M.normalizeCatalog(), incoming = reverse ? M.normalizeCatalog() : oldCatalog();
    const before = copy(incoming), localDefinition = copy(local.definitions.find(d => d.id === "ift_treadmill"));
    merge(local, incoming); assert.equal(local.conflicts.length, 0);
    assert.deepEqual(copy(incoming), before);
    assert.deepEqual(copy(local.definitions.find(d => d.id === "ift_treadmill")), localDefinition);
  }
});
test("VIFT catalog comparison preserves measurement differences", () => {
  const mutations = [
    c => c.definitions.find(d => d.id === "ift_treadmill").protocol += " 自定义条件",
    c => c.protocol.ift = "实际测试条件不同",
    c => c.definitions.find(d => d.id === "ift_treadmill").unit = "m/min",
    c => c.definitions.find(d => d.id === "ift_treadmill").name = "自定义终末速度",
    c => c.tests.find(t => t.id === "ift").name = "自定义测试名称",
  ];
  for (const mutate of mutations) {
    const local = M.normalizeCatalog(), incoming = oldCatalog(); mutate(incoming); merge(local, incoming);
    const conflict = local.conflicts.find(c => c.testId === "ift"); assert.ok(conflict); assert.equal(conflict.variants.length, 2);
  }
});
test("legacy evaluation fields do not create measurement catalog conflicts",()=>{
  const local=M.normalizeCatalog(),incoming=oldCatalog(),d=incoming.definitions.find(d=>d.id==="ift_treadmill");
  Object.assign(d,{target:123,referenceEnabled:true,ranges:[{min:0,max:50,label:"Legacy",status:"green"}]});
  merge(local,incoming);assert.equal(local.conflicts.length,0);assert.equal(local.definitions.find(metric=>metric.id===d.id).target,null);
});
test("ability name conflicts and ordered additions remain intact beside the VIFT alias", () => {
  const local = M.normalizeCatalog(), incoming = oldCatalog();
  incoming.abilityGroups.find(g => g.key === "下肢爆发力").name = "导入起跳能力";
  incoming.abilityGroups.push({key:"ability_added",name:"导入新分类"});
  merge(local, incoming); merge(local, incoming);
  assert.equal(local.conflicts.length, 0);
  assert.equal(local.abilityGroups.find(g => g.key === "下肢爆发力").name, "下肢爆发力");
  assert.equal(local.abilityGroupConflicts.filter(c => c.key === "下肢爆发力").length, 1);
  assert.deepEqual(copy(local.abilityGroups.at(-1)), {key:"ability_added",name:"导入新分类"});
});
test("empty historical screen categories match their defaults while custom choices remain conflicts", () => {
  for (const missing of [false, true]) for (const reverse of [false, true]) {
    const current = M.normalizeCatalog(), old = oldCatalog();
    for (const id of ["fms", "iso"]) { const test = old.tests.find(t => t.id === id); if (missing) delete test.primaryAbility; else test.primaryAbility = ""; }
    const local = reverse ? old : current, incoming = reverse ? current : old;
    merge(local, incoming); assert.equal(local.conflicts.length, 0);
  }
  for (const id of ["fms", "iso"]) {
    const local = M.normalizeCatalog(), incoming = oldCatalog(); incoming.tests.find(t => t.id === id).primaryAbility = "用户自定分类";
    merge(local, incoming); assert.deepEqual(copy(local.conflicts.map(c => c.testId)), [id]);
  }
});
const S = ctx.RingsideStore, E = ctx.RingsideEvaluation;
const buildVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")).version;

function syntheticLibrary() {
  const record = M.sampleRecord(); record.athlete.name = "Synthetic backup fixture";
  record.enabled.sprint_fvp = true;
  record.data.sprint_fvp = [{id:"synthetic-sprint",splits:[{distanceM:10,timeS:1.9},{distanceM:20,timeS:3.1},{distanceM:40,timeS:5.3}],sourceMetadata:{fixture:true}}];
  const lib = E.migrate(M.recordEnvelope(record)); lib.version = "2.16.0";
  return lib;
}

// Only the database transaction boundary is replaced. The production import
// validation, generation switch, backup serialization and JSONL parser all run.
function memoryRepository() {
  const tables = new Map();
  const table = name => { if (!tables.has(name)) tables.set(name,new Map()); return tables.get(name); };
  const key = (name,row) => name === "meta" ? row.id : JSON.stringify([row.generation,row.id]);
  const repo = new S.Repository({transaction() {
    const tx = {objectStore(name) { return {
      put(row) { table(name).set(key(name,row),copy(row)); },
      get(id) {const request={};queueMicrotask(()=>{request.result=table(name).get(name==="meta"?id:JSON.stringify(id));request.onsuccess?.();});return request;},
    }; }};
    queueMicrotask(() => tx.oncomplete?.()); return tx;
  }});
  repo.meta = async id => table("meta").get(id);
  repo.get = async (name,id,generation=repo.generation) => table(name).get(JSON.stringify([generation,id]))?.value;
  repo.values = async (name,generation=repo.generation) => [...table(name).values()].filter(row=>row.generation===generation).map(row=>row.value);
  repo.batches = async function *(name,generation=repo.generation) { yield await repo.values(name,generation); };
  return repo;
}

async function decodedRows(blob) {
  const rows = []; for await (const row of S.fileRows(blob)) rows.push(row); return rows;
}
async function libraryBackup(lib) {
  const rows = []; for await (const row of S.libraryRows(lib)) rows.push(row);
  return new Blob([rows.map(row=>JSON.stringify(row)).join("\n")+"\n"],{type:"application/x-ndjson"});
}
async function backupTests() {
  ctx.RingsideBuild = Object.freeze({version:buildVersion});
  const lib = syntheticLibrary(), before = copy(lib), record = copy(lib.athletes[0].records[0]);
  const repo = memoryRepository(); await repo.importRows(S.fileRows(await libraryBackup(lib)));
  const rows = await decodedRows(await repo.backupBlob());
  const config = rows.find(row=>row.type==="config").value;
  assert.equal(config.version,buildVersion);
  assert.equal(rows[0].schema,3); assert.equal(config.schema,3);
  const expectedConfig = {schema:3,kind:"athlete-library",catalog:copy(before.catalog),testPlans:copy(before.testPlans||[]),
    defaultEvaluationProfileId:before.defaultEvaluationProfileId,activeAthleteId:before.activeAthleteId||"",activeRecordId:before.activeRecordId||"",updated:before.updated};
  const actualConfig = copy(config); delete actualConfig.version;
  assert.deepEqual(actualConfig,expectedConfig);
  assert.deepEqual(copy(rows.find(row=>row.type==="record").value),record);
  assert.deepEqual(copy(lib),before);
  assert.equal(record.sprintFvpVersion,1);
  assert.equal(rows.find(row=>row.type==="record").value.sprintFvpConfig.methodVersion,record.sprintFvpConfig.methodVersion);
  passed++; console.log("PASS JSONL backup uses the build producer version and preserves schemas, methods and all record fields");

  delete ctx.RingsideBuild;
  const future = syntheticLibrary(); future.version = "9.0.0-future";
  const futureRows = await decodedRows(await libraryBackup(future));
  assert.equal(futureRows.find(row=>row.type==="config").value.version,"9.0.0-future");
  delete future.version;
  const unknownRows = await decodedRows(await libraryBackup(future));
  assert.equal(Object.hasOwn(unknownRows.find(row=>row.type==="config").value,"version"),false);
  passed++; console.log("PASS source-only export preserves an existing future producer and leaves an unknown producer unspecified");

  const old = syntheticLibrary(), oldRecord = old.athletes[0].records[0];
  delete oldRecord.sprintFvpVersion; delete oldRecord.enabled.sprint_fvp; delete oldRecord.data.sprint_fvp;
  delete oldRecord.sprintFvpConfig; delete oldRecord.sprintFvpAnalysis; delete oldRecord.protocol.sprint_fvp;
  oldRecord.projectSnapshots = oldRecord.projectSnapshots.filter(test=>test.id!=="sprint_fvp");
  oldRecord.definitions = oldRecord.definitions.filter(definition=>definition.testId!=="sprint_fvp");
  const legacyBlob = await libraryBackup(old), legacyRecord = copy(oldRecord);
  ctx.RingsideBuild = Object.freeze({version:buildVersion});
  const restoredRepo = memoryRepository(), result = await restoredRepo.importRows(S.fileRows(legacyBlob));
  assert.equal(result.added,1); assert.equal(result.skipped,0);
  const restored = await restoredRepo.exportLibrary();
  assert.equal(restored.version,"2.16.0");
  assert.deepEqual(copy(restored.athletes[0].records[0]),legacyRecord);
  const currentRows = await decodedRows(await libraryBackup(restored));
  assert.equal(currentRows.find(row=>row.type==="config").value.version,buildVersion);
  assert.deepEqual(copy(currentRows.find(row=>row.type==="record").value),legacyRecord);
  assert.deepEqual(rows.at(-1).counts,currentRows.at(-1).counts);
  passed++; console.log("PASS a schema-3 legacy producer backup imports without rewriting records and its next export records the current producer");
  console.log(passed + " store catalog model checks passed");
}
backupTests().catch(error=>{console.error(error);process.exitCode=1;});
