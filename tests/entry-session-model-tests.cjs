"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const c=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});c.window=c;
for(const name of ["calc","cpet-reference","definitions","tests","model","entry-session"])
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const M=c.RingsideModel,S=c.RingsideEntrySession,copy=value=>JSON.parse(JSON.stringify(value));
let passed=0;async function test(name,run){await run();passed++;console.log("PASS "+name);}
function records(count=2){const base=M.defaults();return Array.from({length:count},(_,i)=>({...copy(base),athleteId:"athlete_"+i,recordId:"record_"+i,athlete:{...copy(base.athlete),name:"同名运动员",sport:i?"游泳":"篮球"}}));}
function pendingRecord(){const session=S.create(records(1));return [session,session.records[0]];}
(async()=>{
  await test("session keeps draft object identity and stable per-person IDs without mutating the empty base",()=>{
    const input=records(),session=S.create(input,{origin:{mode:"report"},pendingAthletes:[{id:"athlete_0",name:"同名运动员"}]});
    assert.equal(session.records,input);assert.equal(session.records[0],input[0]);assert.equal(session.savedIds.size,0);
    input[0].data.cmj[0].height=36;assert.equal(session.base.data.cmj[0].height,"");
    assert.equal(S.hasManualData(session,input[0]),true);assert.equal(S.isPending(session,"record_0"),true);
  });
  await test("context protocols units direction choices and blank rows never count as manual measurement",()=>{
    const [session,r]=pendingRecord();r.athlete.mass=78;r.athlete.age=23;r.trainingContext.weeklySessions=4;
    r.data.cpet.modality="cycle";r.data.cpet.oxygenLabel="VO2max";r.data.cpet.vo2Unit="l/min";r.data.cpet.thresholds.first.label="LT1";
    r.data.ift.protocol="treadmill";r.data.ift.method="新的设备";r.data.hop.inputMode="jumps";r.data.hop.summary.selectionBasis="device";
    const row=r.data.iso[0];row.unit="kgf";row.protocol="膝关节 90°";row.target=200;row.position="坐位";row.angle=90;
    r.isoDirectionIds=[];r.data.iso.splice(1);r.data.cmj.push({...copy(r.data.cmj[0]),id:"new_empty_attempt"});
    r.data.imtp[0].timePoints.push({id:"empty_timepoint",timeMs:450,force:"",rfd:""});r.data.cmj[0].metrics={metric_new:""};
    r.customValues={manual_empty:{value:"",notes:""}};r.narrative.text="  ";
    assert.equal(S.hasManualData(session,r),false);
  });
  await test("zero negative pain notes and incomplete trials each retain entered information",()=>{
    const cases=[r=>r.data.fms[0].score=0,r=>r.data.cmj[0].height=0,r=>r.data.cmj[0].metrics.offset=-2.5,
      r=>r.data.iso[0].painCenter=true,r=>r.data.iso[1].trials=[{id:"pain_only",painRight:true,left:"",right:""}],
      r=>r.data.imtp[0].timePoints=[{id:"partial_force",timeMs:150,force:"",rfd:15}],r=>r.data.lactate[0].hr=143,
      r=>r.data.pushup.notes="因疼痛提前结束",r=>r.data.hop.jumps[0].contactTimeMs=180,
      r=>r.narrative.text="已观察到技术动作变化"];
    for(const enter of cases){const [session,r]=pendingRecord();enter(r);assert.equal(S.hasManualData(session,r),true);}
    const [session,r]=pendingRecord();r.data.cmj[0].height=20;assert.equal(S.hasManualData(session,r),true);r.data.cmj[0].height="";
    assert.equal(S.hasManualData(session,r),false);
  });
  await test("custom metric IDs resembling configuration fields remain genuine raw measurements",()=>{
    const [session,r]=pendingRecord();r.data.cmj[0].metrics={unit:0,target:-1};assert.equal(S.hasManualData(session,r),true);
    const [second,custom]=pendingRecord();custom.customValues={protocol:{value:0,notes:""}};assert.equal(S.hasManualData(second,custom),true);
  });
  await test("pending roundtrip restores stable IDs metadata arrays removals and original empty measurement baseline",async()=>{
    const input=records(),session=S.create(input,{origin:{mode:"entry",athleteId:"original"}}),r=input[1];
    r.athlete.mass=72.5;r.trainingContext.equipment="测力台";r.data.cmj=[{id:"same_attempt",height:0,metrics:{offset:-2}}];
    r.data.iso[0].painCenter=true;delete r.protocol.ift;r.narrative.text="待进一步核对";
    const encoded=copy(S.encode(session,r.recordId)),restored=await S.decode(encoded,async()=>{throw Error("未保存草稿不应读取库记录");});
    assert.equal(restored.selectedRecordId,"record_1");assert.deepEqual(copy(restored.records),copy(input));
    assert.equal(restored.savedIds.size,0);assert.equal(S.hasManualData(restored,restored.records[0]),false);
    assert.equal(S.hasManualData(restored,restored.records[1]),true);assert.equal(restored.records[1].data.cmj[0].id,"same_attempt");
  });
  await test("300 empty athlete drafts encode below 5 MB while preserving every target and selection",async()=>{
    const input=records(300),session=S.create(input),encoded=S.encode(session,"record_299"),size=Buffer.byteLength(JSON.stringify(encoded),"utf8");
    assert.ok(size<5*1024*1024,"临时草稿编码超过 5 MB: "+size);assert.equal(encoded.entries.length,300);
    assert.ok(encoded.entries.every(entry=>entry.patch.length===0));
    const restored=await S.decode(copy(encoded),async()=>null);assert.equal(restored.records.length,300);
    assert.equal(restored.selectedRecordId,"record_299");assert.equal(new Set(restored.records.map(r=>r.recordId)).size,300);
    assert.ok(restored.records.every(r=>!S.hasManualData(restored,r)));console.log("EMPTY_BATCH_BYTES "+size);
  });
  await test("saved entries always reload authoritative library records and compact encoding omits their measurements",async()=>{
    const input=records(),session=S.create(input);input[0].data.cmj[0].height=20;S.markSaved(session,"record_0");
    assert.equal(S.isPending(session,"record_0"),false);assert.equal(S.isPending(session,"record_1"),true);
    const encoded=copy(S.encode(session,"record_0"));assert.equal(encoded.entries[0].patch,undefined);
    const stored=copy(input[0]);stored.data.cmj[0].height=44;stored.athlete.mass=90;let calls=[];
    const restored=await S.decode(encoded,async id=>{calls.push(id);return copy(stored);});
    assert.deepEqual(calls,["record_0"]);assert.equal(restored.records[0].data.cmj[0].height,44);
    assert.equal(restored.records[0].athlete.mass,90);assert.equal(S.isPending(restored,"record_0"),false);
  });
  await test("deleted saved records are skipped and never revived from session metadata",async()=>{
    const session=S.create(records());S.markSaved(session,"record_0");
    const restored=await S.decode(copy(S.encode(session,"record_0")),async()=>null);
    assert.deepEqual(copy(restored.missingRecordIds),["record_0"]);assert.equal(restored.records.length,1);
    assert.equal(restored.records[0].recordId,"record_1");assert.equal(restored.selectedRecordId,"record_1");assert.equal(restored.savedIds.size,0);
  });
  await test("refresh during a failed or unfinished second save retains the latest input when the database still matches its baseline",async()=>{
    const input=records(1),session=S.create(input),stored=copy(input[0]);stored.data.cmj[0].height=30;stored.updated="saved_time";
    Object.assign(input[0],copy(stored));S.markSaved(session,input[0].recordId);
    const baseline=copy(stored);delete baseline.updated;input[0].data.cmj[0].height=0;input[0].data.iso[0].painCenter=true;input[0].updated="newer_time";
    const encoded=copy(S.encode(session,input[0].recordId,{dirtyRecords:[{record:input[0],baselineContent:JSON.stringify(baseline)}]}));
    const restored=await S.decode(encoded,async()=>copy(stored));
    assert.equal(restored.records[0].data.cmj[0].height,0);assert.equal(restored.records[0].data.iso[0].painCenter,true);
    assert.equal(S.isPending(restored,input[0].recordId),false);assert.equal(S.hasManualData(restored,restored.records[0]),true);
    assert.deepEqual(copy(restored.conflictRecordIds),[]);
  });
  await test("refresh after the exact dirty save commits tolerates updated timestamps without a false conflict",async()=>{
    const input=records(1),session=S.create(input),stored=copy(input[0]);stored.data.cmj[0].height=30;
    Object.assign(input[0],copy(stored));S.markSaved(session,input[0].recordId);
    const baseline=copy(stored);delete baseline.updated;input[0].data.cmj[0].height=39;
    const encoded=copy(S.encode(session,input[0].recordId,{dirtyRecords:[{record:input[0],baselineContent:JSON.stringify(baseline)}]}));
    const committed=copy(input[0]);committed.updated="database_newer_timestamp";
    const restored=await S.decode(encoded,async()=>committed);assert.equal(restored.records[0].data.cmj[0].height,39);
    assert.deepEqual(copy(restored.conflictRecordIds),[]);
  });
  await test("external changes win over dirty session input and are reported as a conflict",async()=>{
    const input=records(1),session=S.create(input),stored=copy(input[0]);stored.data.cmj[0].height=30;
    Object.assign(input[0],copy(stored));S.markSaved(session,input[0].recordId);
    const baseline=copy(stored);delete baseline.updated;input[0].data.cmj[0].height=39;
    const encoded=copy(S.encode(session,input[0].recordId,{dirtyRecords:[{record:input[0],baselineContent:JSON.stringify(baseline)}]}));
    const external=copy(stored);external.athlete.mass=81;external.data.cmj[0].height=55;
    const restored=await S.decode(encoded,async()=>external);assert.equal(restored.records[0].data.cmj[0].height,55);
    assert.equal(restored.records[0].athlete.mass,81);assert.deepEqual(copy(restored.conflictRecordIds),["record_0"]);
    const oldAPI=copy(S.encode(session));delete oldAPI.dirtyRecords;const old=await S.decode(oldAPI,async()=>external);
    assert.equal(old.records[0].data.cmj[0].height,55);assert.deepEqual(copy(old.conflictRecordIds),[]);
  });
  await test("malformed duplicate targets and unsafe patch paths are rejected without prototype mutation",async()=>{
    const session=S.create(records()),duplicate=copy(S.encode(session));duplicate.entries[1].recordId=duplicate.entries[0].recordId;
    await assert.rejects(()=>S.decode(duplicate,async()=>null),/编号/);
    const unsafe=copy(S.encode(session));unsafe.entries[0].patch=[{path:["__proto__","polluted"],value:true}];
    await assert.rejects(()=>S.decode(unsafe,async()=>null),/字段/);assert.equal({}.polluted,undefined);
    S.markSaved(session,"record_0");await assert.rejects(()=>S.decode(copy(S.encode(session)),async()=>({...copy(session.records[0]),athleteId:"different_owner"})),/不匹配/);
  });
  console.log(passed+" entry session checks passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
