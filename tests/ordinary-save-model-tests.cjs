"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const content=record=>{const value=copy(record);delete value.updated;return JSON.stringify(value);};
const model=vm.createContext({console,Intl,crypto:crypto.webcrypto});model.window=model;
for(const name of ["calc","fvp","sprint-fvp","cpet-reference","definitions","tests","scoring", "model"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),model);
const M=model.RingsideModel,app=fs.readFileSync(path.join(__dirname,"../src/ringside-app.js"),"utf8"),tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function fixture(){const record=copy(M.normalizeRecord(M.defaults()));record.recordId="synthetic_ordinary_record";record.athleteId="synthetic_ordinary_owner";record.athlete.name="Synthetic ordinary save";record.athlete.mass=75;record.athlete.height=180;record.data.cmj[0].height=30;record.updated="2026-10-10T01:00:00.000Z";return record;}
function external(baseline,height){const record=copy(baseline);record.data.cmj[0].height=height;record.updated="2026-10-10T03:00:00.000Z";return record;}
function harness(baseline){
  let stored=copy(baseline),loadHook=null,saveHook=null;const loads=[],saves=[],status={textContent:""},record=baseline||fixture();
  const library={...copy(M.libraryDefaults()),evaluationProfiles:[],groups:[],activeRecordId:record.recordId,activeAthleteId:record.athleteId,athletes:[{id:record.athleteId,records:[{recordId:record.recordId}]}]};
  library.catalog=copy(M.normalizeCatalog(library.catalog));
  const c=vm.createContext({console,Intl,crypto:crypto.webcrypto,Map,Set,JSON,Promise,copy,clearTimeout,
    now:()=>"2026-10-10T02:00:00.000Z",recordBaselines:new Map(),recordStorageBaselines:new Map(),queuedRecords:new Map(),entryPersistQueue:Promise.resolve(),
    pendingSaves:0,saveSequence:0,saveTimer:null,storageFailed:false,libraryTransferActive:false,entrySession:null,state:null,reportDirty:false,
    T:model.RingsideTests,M,$:()=>status,refreshEntryChrome:()=>{},upgradeDemo:()=>({changed:false}),library,
    repository:{directory:async()=>copy(library),
      loadRecord:async id=>{const value=copy(stored);loads.push(id);if(loadHook)await loadHook(value,loads.length);return value;},
      save:async(next,records,removals,checks)=>{
        const snapshots=copy(records);saves.push({snapshots,checks:copy(checks)});if(saveHook)await saveHook(snapshots,saves.length);
        for(const snapshot of snapshots){const expected=checks?.expectedRecords?.[snapshot.recordId];if(expected!==undefined&&expected!==JSON.stringify(stored??null))throw Error("Synthetic transaction conflict");stored=copy(snapshot);}
      },
    },
  });c.window=c;c.RingsideStore={summary:value=>({recordId:value.recordId,athleteId:value.athleteId})};c.RingsideEvaluation={upgradeLibraryProfiles:()=>false};
  // Production load/baseline/persist code runs against synthetic storage and DOM boundaries.
  for(const[startMarker,endMarker]of [["  function recordContent(record) {","  function draftRecordKey("],["  async function loadDirectory(","  async function saveLibraryChanges("],["  function persist(","  function persistSessionRecord("]]){
    const start=app.indexOf(startMarker),end=app.indexOf(endMarker,start+startMarker.length);assert.ok(start>=0&&end>start);vm.runInContext(app.slice(start,end),c);
  }
  return{c,loads,saves,status,getStored:()=>copy(stored),setStored:value=>{stored=copy(value);},setLoadHook:hook=>{loadHook=hook;},setSaveHook:hook=>{saveHook=hook;},commits:()=>saves.flatMap(call=>call.snapshots)};
}
async function open(h,height=39){await h.c.loadDirectory(false);h.c.state.data.cmj[0].height=height;return h.c.state;}
let passed=0,failed=0;async function test(name,run){try{await run();passed++;console.log("PASS "+name);}catch(error){failed++;console.error("FAIL "+name+"\n"+error.stack);}}
(async()=>{
  await test("ordinary stale save rejects an external edit and keeps local dirty values",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);h.setStored(external(baseline,70));h.c.state.data.cmj[0].height=75;
    assert.equal(await h.c.persist(),false);assert.equal(h.getStored().data.cmj[0].height,70);assert.equal(h.c.state.data.cmj[0].height,75);assert.equal(h.c.recordBaselines.get(baseline.recordId),content(baseline));assert.equal(h.c.storageFailed,true);
  });
  await test("deleted ordinary records cannot be recreated from stale state",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);h.setStored(null);assert.equal(await h.c.persist(),false);assert.equal(h.getStored(),null);assert.equal(h.c.state.data.cmj[0].height,39);
  });
  await test("first ordinary record write requires absence and guards the null snapshot",async()=>{
    const baseline=fixture(),h=harness(null);h.c.state=copy(baseline);h.c.state.data.cmj[0].height=40;assert.equal(await h.c.persist(),true);
    assert.equal(h.saves[0].checks.expectedRecords[baseline.recordId],"null");assert.equal(h.getStored().data.cmj[0].height,40);assert.equal(h.c.recordStorageBaselines.get(baseline.recordId),content(h.getStored()));
  });
  await test("unknown existing record without a read baseline is never overwritten",async()=>{
    const baseline=fixture(),h=harness(external(baseline,70));h.c.state=copy(baseline);h.c.state.data.cmj[0].height=75;
    assert.equal(await h.c.persist(),false);assert.equal(h.getStored().data.cmj[0].height,70);assert.equal(h.c.recordBaselines.has(baseline.recordId),false);
  });
  await test("legacy raw reads stay separate from normalized display and preserve original times",async()=>{
    const baseline=fixture();baseline.enabled.sprint_fvp=true;baseline.data.sprint_fvp=[{id:"synthetic_sprint",splits:[5,10,20,30].map(distanceM=>({distanceM,timeS:model.RingsideSprintFVP.timeAtDistance(distanceM,9.5,1.15)})),excluded:false,exclusionReason:"",notes:"Synthetic legacy"}];
    const h=harness(baseline);await open(h);assert.ok(h.c.state.data.sprint_fvp[0].splits.every(split=>split.id));assert.notEqual(content(h.c.state),content(baseline));assert.equal(h.c.recordStorageBaselines.get(baseline.recordId),content(baseline));
    assert.equal(await h.c.persist(),true);assert.equal(h.saves[0].checks.expectedRecords[baseline.recordId],JSON.stringify(baseline));assert.deepEqual(h.getStored().data.sprint_fvp[0].splits.map(split=>split.timeS),baseline.data.sprint_fvp[0].splits.map(split=>split.timeS));
  });
  await test("updated-only changes use the complete current raw snapshot for the transaction guard",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);const current=copy(baseline);current.updated="2026-10-10T04:00:00.000Z";h.setStored(current);
    assert.equal(await h.c.persist(),true);assert.equal(h.saves[0].checks.expectedRecords[baseline.recordId],JSON.stringify(current));assert.equal(h.getStored().data.cmj[0].height,39);
  });
  await test("changes between the guard read and write abort the whole ordinary save",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);h.setSaveHook(()=>{h.setStored(external(baseline,70));});
    assert.equal(await h.c.persist(),false);assert.equal(h.getStored().data.cmj[0].height,70);assert.equal(h.c.recordBaselines.get(baseline.recordId),content(baseline));assert.equal(h.c.state.data.cmj[0].height,39);
  });
  await test("queued ordinary snapshots stay ordered while input changes during the guard read",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);const gate=deferred();let delayed=false;h.setLoadHook(async()=>{if(!delayed){delayed=true;await gate.promise;}});
    const first=h.c.persist();await tick();h.c.state.data.cmj[0].height=40;const second=h.c.persist();gate.resolve();assert.deepEqual(await Promise.all([first,second]),[true,true]);
    assert.deepEqual(h.commits().map(record=>record.data.cmj[0].height),[39,40]);assert.equal(h.c.state.data.cmj[0].height,40);assert.equal(h.getStored().data.cmj[0].height,40);assert.equal(h.c.recordStorageBaselines.get(baseline.recordId),content(h.getStored()));
  });
  await test("a repeated queued value retries a failed record write instead of claiming an empty save",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);const gate=deferred();h.setSaveHook(async(snapshots,count)=>{if(count===1){await gate.promise;throw Error("Synthetic disk failure");}});
    const first=h.c.persist();await tick();const second=h.c.persist();gate.resolve();assert.deepEqual(await Promise.all([first,second]),[false,true]);assert.equal(h.getStored().data.cmj[0].height,39);assert.equal(h.commits().length,2);
    assert.equal(h.c.recordBaselines.get(baseline.recordId),content(h.getStored()));assert.equal(h.c.storageFailed,false);
  });
  await test("queued retries after external conflict all fail without advancing the baseline",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);h.setStored(external(baseline,70));const first=h.c.persist(),second=h.c.persist();
    assert.deepEqual(await Promise.all([first,second]),[false,false]);assert.equal(h.getStored().data.cmj[0].height,70);assert.equal(h.c.state.data.cmj[0].height,39);assert.equal(h.c.recordBaselines.get(baseline.recordId),content(baseline));assert.equal(h.c.storageFailed,true);assert.ok(!h.status.textContent.includes("已保存"));
  });
  await test("failed ordinary writes can be retried with the same raw baseline",async()=>{
    const baseline=fixture(),h=harness(baseline);await open(h);h.setSaveHook(()=>{throw Error("Synthetic disk failure");});assert.equal(await h.c.persist(),false);
    assert.equal(h.c.recordStorageBaselines.get(baseline.recordId),content(baseline));assert.equal(h.getStored().data.cmj[0].height,30);h.setSaveHook(null);assert.equal(await h.c.persist(),true);assert.equal(h.getStored().data.cmj[0].height,39);
  });
  await test("metadata-only saves do not rewrite the record or change its confirmed baseline",async()=>{
    const baseline=fixture(),h=harness(baseline);await h.c.loadDirectory(false);assert.equal(await h.c.persist(),true);assert.equal(h.commits().length,0);assert.equal(h.getStored().updated,baseline.updated);assert.equal(h.c.recordStorageBaselines.get(baseline.recordId),content(baseline));
  });
  console.log(passed+" ordinary save checks passed; "+failed+" failed");if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
