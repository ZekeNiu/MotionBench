"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const context=vm.createContext({console,Intl,crypto:crypto.webcrypto});context.window=context;
for(const name of ["calc","fvp","sprint-fvp","cpet-reference","definitions","tests","scoring", "model","sprint-fvp-entry"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),context);
const M=context.RingsideModel,F=context.RingsideSprintFVP,E=context.RingsideSprintFVPEntry,copy=value=>JSON.parse(JSON.stringify(value));
const app=fs.readFileSync(path.join(__dirname,"../src/ringside-app.js"),"utf8");let passed=0;
function test(name,run){run();passed++;console.log("PASS "+name);}
function fixture(){const record=M.defaults();record.athlete.mass=75;record.athlete.height=180;record.enabled.sprint_fvp=true;record.data.sprint_fvp=[{id:"synthetic_trial",splits:[5,10,20,30].map(distanceM=>({distanceM,timeS:F.timeAtDistance(distanceM,9.5,1.15)})),excluded:false,exclusionReason:"",notes:"Synthetic usability"}];return record;}
function appDraftHarness(record){
  const harness=vm.createContext({console,RingsideModel:M,sessionStorage:{setItem(){}},inputDraftStorageFailed:false,T:context.RingsideTests});
  harness.draftStorage=harness.sessionStorage;
  vm.runInContext(`let state=${JSON.stringify(record)};const inputDrafts={};const undoDeletes=new Map();const copy=x=>JSON.parse(JSON.stringify(x));const draftStorageKey='synthetic-drafts';const persist=()=>{};const renderEntry=()=>{};const changed=()=>{};const toast=()=>{};const rowFocus=()=>{};let reportDirty=false;`,harness);
  // Exercise the application's actual path, migration, deletion and undo code.
  for(const [name,next]of [["draftRecordKey","stablePath"],["stablePath","resolveDraftPath"],["resolveDraftPath","draftsFor"],["draftsFor","saveDrafts"],["saveDrafts","rememberInputError"],["rememberDeletion","removeRow"],["undoDelete","requestMetricUnit"]]){
    const start=app.indexOf("  function "+name+"("),end=app.indexOf("  function "+next+"(",start+1);assert.ok(start>=0&&end>start,name);vm.runInContext(app.slice(start,end),harness);
  }
  const start=app.indexOf("    removeSprintSplit("),end=app.indexOf("    addHopJump,",start);assert.ok(start>=0&&end>start);vm.runInContext("const App={"+app.slice(start,end)+"};",harness);
  return harness;
}
test("new four-split entry calculates immediately and preserves existing five-split records",()=>{
  const record=fixture();record.data.sprint_fvp=[E.defaultTrial()];record.data.sprint_fvp[0].splits.forEach(split=>{split.timeS=F.timeAtDistance(split.distanceM,9.5,1.15);});
  assert.deepEqual(copy(record.data.sprint_fvp[0].splits.map(split=>split.distanceM)),[5,10,20,30]);assert.equal(F.solve(record).valid,true);
  const old=fixture();old.data.sprint_fvp[0].splits.push({distanceM:40,timeS:F.timeAtDistance(40,9.5,1.15)});const normalized=M.normalizeRecord(copy(old));assert.deepEqual(copy(normalized.data.sprint_fvp[0].splits.map(split=>split.distanceM)),[5,10,20,30,40]);
});
test("legacy split normalization keeps raw data, existing IDs and narrative fingerprint stable",()=>{
  const record=M.normalizeRecord(copy(fixture()));record.data.sprint_fvp[0].splits.forEach(split=>{delete split.id;});
  const raw=JSON.stringify(record.data.sprint_fvp),basis=M.fingerprint(record),normalized=M.normalizeRecord(copy(record));
  assert.equal(JSON.stringify(record.data.sprint_fvp),raw);assert.equal(M.fingerprint(normalized),basis);
  assert.ok(normalized.data.sprint_fvp[0].splits.every(split=>split.id));assert.deepEqual(M.normalizeRecord(copy(normalized)).data.sprint_fvp,normalized.data.sprint_fvp);
  const mixed=copy(record);mixed.data.sprint_fvp[0].splits[1].id="sprint_split_0";const ids=F.normalizeTrials(mixed.data.sprint_fvp)[0].splits.map(split=>split.id);assert.equal(ids[1],"sprint_split_0");assert.equal(new Set(ids).size,ids.length);
});
test("legacy indexed draft stays on the same segment through preceding deletion, deletion of itself and undo",()=>{
  const record=M.normalizeRecord(copy(fixture())),harness=appDraftHarness(record),splitId=record.data.sprint_fvp[0].splits[1].id;
  const result=vm.runInContext(`(()=>{const oldKey='data.sprint_fvp.@synthetic_trial.splits.1.timeS';inputDrafts[draftRecordKey()]={[oldKey]:{value:'bad input',message:'Invalid number'}};const rawBefore=state.data.sprint_fvp[0].splits.map(split=>split.timeS);App.removeSprintSplit(0,0);const key=Object.keys(draftsFor())[0];const afterDelete={key,path:resolveDraftPath(key),distance:state.data.sprint_fvp[0].splits[0].distanceM};undoDelete();const afterUndo={path:resolveDraftPath(key),distance:state.data.sprint_fvp[0].splits[1].distanceM,times:state.data.sprint_fvp[0].splits.map(split=>split.timeS)};App.removeSprintSplit(0,1);const draftsWhileRemoved=Object.keys(draftsFor()).length;undoDelete();return{oldKey,afterDelete,afterUndo,draftsWhileRemoved,restoredValue:draftsFor()[key].value,restoredPath:resolveDraftPath(key),rawBefore};})()`,harness);
  assert.equal(result.afterDelete.key,"data.sprint_fvp.@synthetic_trial.splits.@"+splitId+".timeS");assert.equal(result.afterDelete.path,"data.sprint_fvp.0.splits.0.timeS");assert.equal(result.afterDelete.distance,10);
  assert.equal(result.afterUndo.path,"data.sprint_fvp.0.splits.1.timeS");assert.equal(result.afterUndo.distance,10);assert.deepEqual(result.afterUndo.times,result.rawBefore);
  assert.equal(result.draftsWhileRemoved,0);assert.equal(result.restoredValue,"bad input");assert.equal(result.restoredPath,"data.sprint_fvp.0.splits.1.timeS");
});
test("10.5 metre target uses the same value in saved analysis, model and entry feedback",()=>{
  const record=fixture();record.sprintFvpAnalysis.targetDistanceM=10.5;assert.equal(F.solve(record).targetDistanceM,10.5);assert.ok(E.feedback(record).includes("10.5 m"));assert.ok(!E.feedback(record).includes("11 m"));assert.equal(record.sprintFvpAnalysis.targetDistanceM,10.5);
});
console.log(passed+" sprint usability model checks passed");
