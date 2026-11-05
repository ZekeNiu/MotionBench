"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const {context, createFixture} = require("./helpers/longitudinal-fixture.cjs");
const c = context(), copy = value => JSON.parse(JSON.stringify(value));
for (const name of ["longitudinal-views", "longitudinal-store", "longitudinal-controller"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const source = createFixture(c, 4), tests = [], test = (name, run) => tests.push([name, run]);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
async function until(predicate) { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(setImmediate); } throw Error("Expected controller checkpoint was not reached"); }
function fixture() {
  const records = copy(source.records); records.forEach(record => { record.evaluationProfileId = ""; });
  let library = {schema:3, kind:"athlete-library", catalog:copy(source.catalog), evaluationProfiles:[], defaultEvaluationProfileId:"",
    athletes:[{id:source.athleteId, name:"Synthetic navigation athlete", records}], activeAthleteId:source.athleteId,
    activeRecordId:records[0].recordId, longitudinalReports:[]};
  let state = records[0], durable = [], saveHook = () => true, switchHook = () => true, controller, activations = 0;
  const calls = [], switches = [], errors = [];
  c.document = {addEventListener(){}, getElementById(){return null;}};
  const host = {library:()=>library, state:()=>state, repository:()=>({loadRecord:async id=>copy(records.find(record=>record.recordId===id))}),
    saveEditor(){}, prepareAnchor(){}, cancelAI(){}, render(){}, remember(){}, restoreView(){}, activate(){activations++;}, error(message){errors.push(message);},
    async save(options = {}) {
      const call = {number:calls.length+1, options:copy(options), snapshot:copy(library.longitudinalReports)}; calls.push(call);
      const result = await saveHook(call);
      if (result === true || result?.commit) durable = call.snapshot;
      return result === true;
    },
    async switchRecord(athlete, record, options = {}) {
      switches.push({recordId:record?.recordId, options});
      // The ordinary app path cancels controller work before loading/saving.
      if (!options.longitudinal) controller.cancelPending();
      if (options.isCurrent && !options.isCurrent()) return false;
      const result = await switchHook({athlete, record, options});
      if (!result || options.isCurrent && !options.isCurrent()) return result;
      state = record; library.activeRecordId = record.recordId;
      if (!options.longitudinal) controller.clear();
      return true;
    }};
  controller = c.RingsideLongitudinalController.create(host);
  return {controller, host, records, calls, switches, errors, ids:records.map(record=>record.recordId), library:()=>library, state:()=>state,
    saved:()=>copy(durable), activations:()=>activations, saveWith(fn){saveHook=fn;}, switchWith(fn){switchHook=fn;}, replaceLibrary(value){library=value;}};
}
async function activeFixture() {
  const f = fixture(); assert.equal(await f.controller.select(f.ids.slice(0,2)), true);
  f.controller.setNarrative({...copy(f.controller.narrative()), text:"Original independent report", html:"<p>Original independent report</p>"});
  f.controller.setViews({reportScroll:37, future:{preserved:true}}); await f.host.save(); return f;
}
function ownerSnapshot(f) { return {owner:f.controller.owner(), document:copy(f.controller.document()), selection:copy(f.controller.selection()), recordId:f.state().recordId}; }
function assertOwner(f, before) {
  assert.equal(f.controller.owner(), before.owner); assert.deepEqual(copy(f.controller.document()), before.document);
  assert.deepEqual(copy(f.controller.selection()), before.selection); assert.equal(f.state().recordId, before.recordId);
}

test("successful selection durably adopts its document without mutating source records", async () => {
  const f=fixture(), before=JSON.stringify(f.records);
  assert.equal(await f.controller.select(f.ids.slice(0,2)), true);
  assert.equal(f.controller.active(), true); assert.equal(f.activations(), 1);
  assert.deepEqual(f.saved(), copy(f.library().longitudinalReports)); assert.equal(f.saved().length, 1);
  assert.equal(JSON.stringify(f.records), before);
});

test("failed initial save leaves the active owner and library untouched", async () => {
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(); f.saveWith(()=>false);
  assert.equal(await f.controller.select(f.ids.slice(2)), false); assertOwner(f,before);
  assert.deepEqual(copy(f.library().longitudinalReports),documents); assert.deepEqual(f.saved(),documents); assert.equal(f.controller.isLoading(),false);
});

for (const result of [false, {commit:true}]) test("failed document save restores prior documents"+(result ? " after a partial repository commit" : " before commit"), async () => {
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(), start=f.calls.length;
  f.saveWith(call=>call.number===start+2 ? result : true);
  assert.equal(await f.controller.select(f.ids.slice(2)),false); assertOwner(f,before);
  assert.deepEqual(copy(f.library().longitudinalReports),documents); assert.deepEqual(f.saved(),documents);
  assert.equal(f.calls.at(-1).options.readOnlyRecord,true); assert.equal(f.controller.isLoading(),false);
});

for (const method of ["cancelPending","clear"]) test(method+" retracts a staged document immediately and repairs a late committed snapshot", async () => {
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(), start=f.calls.length, gate=deferred();
  f.saveWith(call=>call.number===start+2 ? gate.promise : true);
  const task=f.controller.select(f.ids.slice(2)); await until(()=>f.calls.length===start+2);
  assert.equal(f.library().longitudinalReports.length,2); f.controller[method]();
  assert.deepEqual(copy(f.library().longitudinalReports),documents); gate.resolve(true); assert.equal(await task,false);
  assert.deepEqual(f.saved(),documents); assert.equal(f.activations(),1); assert.equal(f.controller.isLoading(),false);
  if(method==="cancelPending") assertOwner(f,before); else assert.equal(f.controller.document(),null);
});

test("a canceled same-key rebuild restores the exact prior narrative, views, mode and basis", async () => {
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(), start=f.calls.length, gate=deferred();
  f.saveWith(call=>call.number===start+2 ? gate.promise : true);
  const task=f.controller.select(f.ids.slice(0,2),{mode:before.document.mode==="best"?"mean":"best"});
  await until(()=>f.calls.length===start+2); f.controller.cancelPending(); gate.resolve(true); assert.equal(await task,false);
  assertOwner(f,before); assert.deepEqual(f.saved(),documents);
});

test("rollback preserves a later legitimate edit to the same report", async () => {
  const f=await activeFixture(), start=f.calls.length, gate=deferred(); f.saveWith(call=>call.number===start+2 ? gate.promise : true);
  const task=f.controller.select(f.ids.slice(0,2),{mode:"mean"}); await until(()=>f.calls.length===start+2);
  f.controller.setNarrative({...copy(f.controller.narrative()),text:"Later independent edit",html:"<p>Later independent edit</p>"});
  const edited=copy(f.library().longitudinalReports); f.controller.cancelPending(); gate.resolve(true); assert.equal(await task,false);
  assert.deepEqual(copy(f.library().longitudinalReports),edited); assert.deepEqual(f.saved(),edited);
  assert.equal(f.controller.narrative().text,"Later independent edit");
});

test("an older canceled request cannot remove or adopt over a later successful request", async () => {
  const f=await activeFixture(), start=f.calls.length, gate=deferred(); f.saveWith(call=>call.number===start+2 ? gate.promise : true);
  const old=f.controller.select(f.ids.slice(2)); await until(()=>f.calls.length===start+2);
  const latest=f.controller.select([f.ids[0],f.ids[3]]); assert.equal(await latest,true);
  const owner=ownerSnapshot(f), documents=copy(f.library().longitudinalReports); gate.resolve(true); assert.equal(await old,false);
  assertOwner(f,owner); assert.deepEqual(f.saved(),documents); assert.equal(f.library().longitudinalReports.length,2);
});

test("external navigation invalidation rolls back the document without adopting the anchor", async () => {
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(), start=f.calls.length, gate=deferred(); let current=true;
  f.saveWith(call=>call.number===start+2 ? gate.promise : true);
  const task=f.controller.select(f.ids.slice(2),{isCurrent:()=>current}); await until(()=>f.calls.length===start+2);
  current=false; gate.resolve(true); assert.equal(await task,false); assertOwner(f,before); assert.deepEqual(f.saved(),documents);
});

test("failed anchor switch retracts an already saved new document and retains the old owner", async () => {
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(); f.switchWith(()=>false);
  assert.equal(await f.controller.select(f.ids.slice(2)),false); assertOwner(f,before); assert.deepEqual(f.saved(),documents);
});

for(const result of [false,undefined]) test("single-record switch returning "+String(result)+" preserves the active comparison",async()=>{
  const f=await activeFixture(), before=ownerSnapshot(f); f.switchWith(()=>result);
  assert.equal(await f.controller.select([f.ids[0]]),false); assertOwner(f,before); assert.equal(f.controller.isLoading(),false);
});

test("successful ordinary switching tolerates the host invalidating the controller sequence",async()=>{
  const f=await activeFixture(); assert.equal(await f.controller.select([f.ids[0]],{isCurrent:()=>true}),true);
  assert.equal(f.state().recordId,f.ids[0]); assert.equal(f.controller.document(),null); assert.equal(f.controller.active(),false);
});

test("a rejected document write is rethrown after restoring the prior saved documents",async()=>{
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(), start=f.calls.length;
  f.saveWith(call=>{if(call.number===start+2)throw Error("Synthetic repository rejection");return true;});
  await assert.rejects(f.controller.select(f.ids.slice(2)),/Synthetic repository rejection/); assertOwner(f,before);
  assert.deepEqual(f.saved(),documents); assert.deepEqual(copy(f.library().longitudinalReports),documents); assert.equal(f.controller.isLoading(),false);
});

test("rollback persistence failure is surfaced while retaining the prior owner in memory",async()=>{
  const f=await activeFixture(), before=ownerSnapshot(f), documents=f.saved(), start=f.calls.length;
  f.saveWith(call=>call.number===start+2 ? {commit:true} : call.number===start+3 ? false : true);
  await assert.rejects(f.controller.select(f.ids.slice(2)),/撤回未完成选择的保存失败/); assertOwner(f,before);
  assert.deepEqual(copy(f.library().longitudinalReports),documents); assert.equal(f.controller.isLoading(),false);
  assert.equal(f.saved().length,2,"failed cleanup must not be represented as durably repaired");
});

test("canceling work from a replaced library never saves into the replacement generation",async()=>{
  const f=await activeFixture(), original=f.library(), documents=f.saved(), start=f.calls.length, gate=deferred();
  f.saveWith(call=>call.number===start+2 ? gate.promise : true);
  const task=f.controller.select(f.ids.slice(2)); await until(()=>f.calls.length===start+2);
  const replacement=copy(original);replacement.longitudinalReports=[];f.replaceLibrary(replacement);f.controller.cancelPending();
  gate.resolve(true);assert.equal(await task,false);assert.deepEqual(copy(original.longitudinalReports),documents);
  assert.deepEqual(replacement.longitudinalReports,[]);assert.equal(f.calls.length,start+2);
});

(async()=>{for(const[name,run]of tests){await run();console.log("PASS "+name);}console.log(tests.length+" longitudinal navigation state tests passed");})().catch(error=>{console.error(error);process.exitCode=1;});
