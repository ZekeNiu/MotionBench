"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const content=record=>{const value=copy(record);delete value.updated;return JSON.stringify(value);};
const model=vm.createContext({console,Intl,crypto:crypto.webcrypto});model.window=model;
for(const name of ["calc","fvp","sprint-fvp","cpet-reference","definitions","tests","model"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),model);
const M=model.RingsideModel,app=fs.readFileSync(path.join(__dirname,"../src/ringside-app.js"),"utf8");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function fixture(){const record=copy(M.normalizeRecord(M.defaults()));record.recordId="synthetic_session_record";record.athleteId="synthetic_session_owner";record.athlete.name="Synthetic session";record.athlete.mass=75;record.athlete.height=180;record.data.cmj[0].height=30;record.updated="2026-10-10T01:00:00.000Z";return record;}
function harness(baseline){
  let stored=copy(baseline),loadHook=null,saveHook=null;const storage=new Map(),loads=[],saves=[],status={textContent:""},messages=[];
  const record=baseline||fixture();
  const c=vm.createContext({console,Intl,crypto:crypto.webcrypto,Map,Set,JSON,Promise,copy,now:()=>"2026-10-10T02:00:00.000Z",recordContent:content,
    recordBaselines:new Map(),entryPersistQueue:Promise.resolve(),pendingSaves:0,storageFailed:false,entrySessionStorageFailed:false,
    entrySession:null,state:null,entrySessionKey:"synthetic_session",T:model.RingsideTests,M,$:()=>status,toast:message=>messages.push(message),refreshEntryChrome:()=>{},ui:{},
    library:{athletes:[{id:record.athleteId,records:[{recordId:record.recordId}]}]},
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    repository:{
      loadRecord:async id=>{const value=copy(stored);loads.push(id);if(loadHook)await loadHook(value,loads.length);return value;},
      save:async(next,records,removals,checks)=>{
        const snapshot=copy(records[0]);saves.push({snapshot,checks:copy(checks)});if(saveHook)await saveHook(snapshot,saves.length);
        const expected=checks?.expectedRecords?.[snapshot.recordId];
        if(expected!==undefined&&expected!==JSON.stringify(stored??null))throw Error("Synthetic transaction conflict");
        stored=snapshot;
      },
    },
  });c.window=c;c.RingsideStore={summary:value=>({recordId:value.recordId,athleteId:value.athleteId})};
  for(const name of ["entry-session","sprint-fvp"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
  // Execute production restore/save functions, replacing only storage and DOM boundaries.
  for(const [startMarker,endMarker]of [["  function saveEntrySession() {","  async function leaveEntrySession() {"],["  function persistSessionRecord(record) {","  function changed(render = true) {"]]){
    const start=app.indexOf(startMarker),end=app.indexOf(endMarker,start+startMarker.length);assert.ok(start>=0&&end>start);vm.runInContext(app.slice(start,end),c);
  }
  return{c,storage,loads,saves,status,messages,getStored:()=>copy(stored),setStored:value=>{stored=copy(value);},setLoadHook:hook=>{loadHook=hook;},setSaveHook:hook=>{saveHook=hook;}};
}
async function restore(h,baseline,height=39){
  const draft=copy(baseline);draft.data.cmj[0].height=height;
  const session=h.c.RingsideEntrySession.create([draft]);h.c.RingsideEntrySession.markSaved(session,draft.recordId);
  h.storage.set("synthetic_session",JSON.stringify(h.c.RingsideEntrySession.encode(session,draft.recordId,{dirtyRecords:[{record:draft,baselineContent:content(baseline)}]})));
  await h.c.restoreEntrySession();return h.c.state;
}
function pending(h,baseline,height=40){const record=copy(baseline),session=h.c.RingsideEntrySession.create([record]);record.data.cmj[0].height=height;h.c.entrySession=session;h.c.state=record;return record;}
function external(baseline,height){const record=copy(baseline);record.data.cmj[0].height=height;record.updated="2026-10-10T03:00:00.000Z";return record;}
let passed=0,failed=0;async function test(name,run){try{await run();passed++;console.log("PASS "+name);}catch(error){failed++;console.error("FAIL "+name+"\n"+error.stack);}}
(async()=>{
  await test("restore captures its baseline from the same single read used by decode",async()=>{
    const baseline=fixture(),h=harness(baseline);h.setLoadHook((value,count)=>{if(count===1)h.setStored(external(baseline,55));});
    await restore(h,baseline);assert.equal(h.loads.length,1);assert.equal(h.c.state.data.cmj[0].height,39);assert.equal(h.c.recordBaselines.get(baseline.recordId),content(baseline));
  });
  await test("saved session rejects external changes while retaining dirty state and encoded draft",async()=>{
    const baseline=fixture(),h=harness(baseline);await restore(h,baseline);h.setStored(external(baseline,55));h.c.state.data.cmj[0].height=40;
    assert.equal(await h.c.persistSessionRecord(h.c.state),false);assert.equal(h.getStored().data.cmj[0].height,55);assert.equal(h.c.state.data.cmj[0].height,40);
    assert.equal(h.c.recordBaselines.get(baseline.recordId),content(baseline));assert.equal(h.c.entrySession.savedIds.has(baseline.recordId),true);
    assert.equal(JSON.parse(h.storage.get("synthetic_session")).dirtyRecords[0].record.data.cmj[0].height,40);assert.equal(h.c.storageFailed,true);
  });
  await test("pending first save requires the record to be absent",async()=>{
    const baseline=fixture(),h=harness(external(baseline,55)),record=pending(h,baseline);
    assert.equal(await h.c.persistSessionRecord(record),false);assert.equal(h.getStored().data.cmj[0].height,55);assert.equal(record.data.cmj[0].height,40);
    assert.equal(h.c.entrySession.savedIds.size,0);assert.equal(h.c.recordBaselines.has(record.recordId),false);assert.ok(h.storage.has("synthetic_session"));
  });
  await test("pending save guards null and becomes saved only after successful commit",async()=>{
    const baseline=fixture(),h=harness(null),record=pending(h,baseline);assert.equal(await h.c.persistSessionRecord(record),true);
    assert.equal(h.saves[0].checks.expectedRecords[record.recordId],"null");assert.equal(h.getStored().data.cmj[0].height,40);assert.equal(h.c.entrySession.savedIds.has(record.recordId),true);
  });
  await test("guard contains the complete freshly read snapshot including an updated-only change",async()=>{
    const baseline=fixture(),h=harness(baseline);await restore(h,baseline);const current=copy(baseline);current.updated="2026-10-10T04:00:00.000Z";h.setStored(current);
    assert.equal(await h.c.persistSessionRecord(h.c.state),true);assert.equal(h.saves[0].checks.expectedRecords[baseline.recordId],JSON.stringify(current));assert.equal(h.getStored().data.cmj[0].height,39);
  });
  await test("transaction guard catches changes between the read and write",async()=>{
    const baseline=fixture(),h=harness(baseline);await restore(h,baseline);h.setSaveHook(()=>{h.setStored(external(baseline,55));});
    assert.equal(await h.c.persistSessionRecord(h.c.state),false);assert.equal(h.getStored().data.cmj[0].height,55);assert.equal(h.c.state.data.cmj[0].height,39);assert.equal(h.c.recordBaselines.get(baseline.recordId),content(baseline));
  });
  await test("queued edits preserve the in-flight snapshot and save the newest values next",async()=>{
    const baseline=fixture(),h=harness(baseline);await restore(h,baseline);const gate=deferred();let delayed=false;
    h.setLoadHook(async()=>{if(!delayed){delayed=true;await gate.promise;}});
    const first=h.c.persistSessionRecord(h.c.state);await tick();h.c.state.data.cmj[0].height=40;const second=h.c.persistSessionRecord(h.c.state);gate.resolve();
    assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.deepEqual(h.saves.map(call=>call.snapshot.data.cmj[0].height),[39,40]);
    assert.equal(h.c.state.data.cmj[0].height,40);assert.equal(h.getStored().data.cmj[0].height,40);assert.equal(h.c.recordBaselines.get(baseline.recordId),content(h.getStored()));
  });
  await test("failed save leaves its baseline unchanged and can be retried",async()=>{
    const baseline=fixture(),h=harness(baseline);await restore(h,baseline);h.setSaveHook((snapshot,count)=>{if(count===1)throw Error("Synthetic disk failure");});
    assert.equal(await h.c.persistSessionRecord(h.c.state),false);assert.equal(h.getStored().data.cmj[0].height,30);assert.equal(h.c.recordBaselines.get(baseline.recordId),content(baseline));assert.equal(h.c.state.data.cmj[0].height,39);
    assert.equal(await h.c.persistSessionRecord(h.c.state),true);assert.equal(h.getStored().data.cmj[0].height,39);assert.equal(h.c.storageFailed,false);
  });
  await test("retry after a failed save still rejects an external edit",async()=>{
    const baseline=fixture(),h=harness(baseline);await restore(h,baseline);h.setSaveHook(()=>{throw Error("Synthetic disk failure");});assert.equal(await h.c.persistSessionRecord(h.c.state),false);
    h.setSaveHook(null);h.setStored(external(baseline,55));assert.equal(await h.c.persistSessionRecord(h.c.state),false);assert.equal(h.getStored().data.cmj[0].height,55);assert.equal(h.c.state.data.cmj[0].height,39);
  });
  await test("a deleted saved record cannot be revived by session autosave",async()=>{
    const baseline=fixture(),h=harness(baseline);await restore(h,baseline);h.setStored(null);assert.equal(await h.c.persistSessionRecord(h.c.state),false);
    assert.equal(h.getStored(),null);assert.equal(h.c.state.data.cmj[0].height,39);assert.equal(h.c.entrySession.savedIds.has(baseline.recordId),true);
  });
  await test("legacy split normalization does not invalidate the actual stored baseline",async()=>{
    const baseline=fixture();baseline.enabled.sprint_fvp=true;baseline.data.sprint_fvp=[{id:"synthetic_sprint",splits:[5,10,20,30].map(distanceM=>({distanceM,timeS:model.RingsideSprintFVP.timeAtDistance(distanceM,9.5,1.15)})),excluded:false,exclusionReason:"",notes:"Synthetic legacy"}];
    const h=harness(baseline);await restore(h,baseline);assert.ok(h.c.state.data.sprint_fvp[0].splits.every(split=>split.id));assert.equal(await h.c.persistSessionRecord(h.c.state),true);
    assert.equal(h.saves[0].checks.expectedRecords[baseline.recordId],JSON.stringify(baseline));assert.deepEqual(h.getStored().data.sprint_fvp[0].splits.map(split=>split.timeS),baseline.data.sprint_fvp[0].splits.map(split=>split.timeS));
  });
  await test("legacy normalized session still rejects a real raw split change",async()=>{
    const baseline=fixture();baseline.enabled.sprint_fvp=true;baseline.data.sprint_fvp=[{id:"synthetic_sprint",splits:[5,10,20,30].map(distanceM=>({distanceM,timeS:model.RingsideSprintFVP.timeAtDistance(distanceM,9.5,1.15)})),excluded:false,exclusionReason:"",notes:"Synthetic legacy"}];
    const h=harness(baseline);await restore(h,baseline);const changed=copy(baseline);changed.data.sprint_fvp[0].splits[1].timeS+=.1;h.setStored(changed);
    assert.equal(await h.c.persistSessionRecord(h.c.state),false);assert.equal(h.getStored().data.sprint_fvp[0].splits[1].timeS,changed.data.sprint_fvp[0].splits[1].timeS);
  });
  await test("an exact in-flight dirty save committed before reload becomes the new baseline",async()=>{
    const baseline=fixture(),h=harness(baseline),committed=external(baseline,39);h.setStored(committed);await restore(h,baseline);
    assert.equal(h.c.recordBaselines.get(baseline.recordId),content(committed));h.c.state.data.cmj[0].height=40;assert.equal(await h.c.persistSessionRecord(h.c.state),true);
    assert.equal(h.saves[0].checks.expectedRecords[baseline.recordId],JSON.stringify(committed));assert.equal(h.getStored().data.cmj[0].height,40);
  });
  console.log(passed+" entry session save checks passed; "+failed+" failed");if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
