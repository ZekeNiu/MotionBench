"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "model", "evaluation"]) vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`, "utf8"), c);
const M = c.RingsideModel, T = c.RingsideTests, E = c.RingsideEvaluation;
const copy = (x) => JSON.parse(JSON.stringify(x)), near = (a,b) => assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
let passed=0; const test=(name,fn)=>{fn();passed++;console.log("PASS "+name);};
const result=(r,id)=>M.stats(r).derived.results.find(d=>d.id===id);
function populated(){ const r=M.defaults(); r.data.cmj=[{id:"c",height:40,force:1500,propulsiveImpulse:300,propulsiveDurationMs:200}];r.data.sj=[{id:"s",height:32}];r.data.imtp=[{id:"i",peakForce:2500,impulse250:400,matchedImpulse:350,matchedDurationMs:200}];r.dsi.confirmed=true;r.impulseConfig.confirmed=true;return r; }
function hops(values){ return {...M.newHopSet(),id:"h",inputMode:"jumps",jumps:values.map((x,i)=>({id:"j"+i,height:x[0],contactTimeMs:x[1],flightTimeMs:x[2]??"",notes:""}))}; }

test("reactive jump RSI converts cm/ms correctly and selects a whole best attempt",()=>{
  const r=M.defaults();r.data.dj=[{id:"a",height:40,contactTimeMs:250,flightTimeMs:500},{id:"b",height:36,contactTimeMs:180,flightTimeMs:450}];
  const s=M.stats(r);near(s.values.dj_rsi,2);near(s.values.dj_height,36);near(s.values.dj_flight_time_ratio,2.5);assert.equal(s.raw.dj.selectedIds[0],"b");
  r.data.dj[1].flightTimeMs="";assert.equal(M.stats(r).values.dj_flight_time_ratio,undefined);
});
test("CMRJ separates first CMJ RSI-modified from rebound RSI",()=>{
  const r=M.defaults();r.data.cmrj=[{id:"a",firstHeight:40,firstTimeToTakeoffMs:500,height:30,contactTimeMs:150}];
  const s=M.stats(r);near(s.values.cmrj_first_rsi_modified,.8);near(s.values.cmrj_rsi,2);near(s.values.cmrj_first_height,40);
});
test("Hop uses mean individual RSI, retains invalid rows, and counts actual selected jumps",()=>{
  const set=hops([[20,100,400],[60,300,600],["",200,400],[30,0,400]]), summary=M.hopSetSummary(set);
  near(summary.row.rsi,2);near(summary.row.height,40);near(summary.row.contactTimeMs,200);assert.equal(summary.counts.supplied,4);assert.equal(summary.counts.valid,2);assert.equal(summary.counts.selected,2);assert.equal(summary.jumps.length,4);assert.equal(summary.jumps[2].selected,false);
  const unequal=M.hopSetSummary(hops([[20,100],[60,200]]));near(unequal.row.rsi,2.5);assert.notEqual(unequal.row.rsi,unequal.row.height*10/unequal.row.contactTimeMs);
});
test("Hop stable top five never takes independent maxima and preserves every raw jump",()=>{
  const set=hops([[20,100],[30,100],[30,100],[50,100],[40,100],[30,100],[30,100]]), before=JSON.stringify(set), h=M.hopSetSummary(set);
  assert.deepEqual(copy(h.selectedIds),["j3","j4","j1","j2","j5"]);assert.equal(h.jumps.length,7);assert.equal(JSON.stringify(set),before);near(h.row.height,36);
});
test("direct Hop summary never derives RSI or FT/CT from averaged height and time",()=>{
  const h=M.newHopSet();Object.assign(h.summary,{height:40,contactTimeMs:200,flightTimeMs:500});const s=M.hopSetSummary(h);
  assert.equal(s.row.rsi,null);assert.equal(s.row.flightTimeRatio,null);assert.equal(s.counts.selected,null);
  h.summary.rsi=1.9;h.summary.selectedCount=4;near(M.hopSetSummary(h).row.rsi,1.9);
});
test("repeated Hop test sets are independent observations, never within-set jump cycles",()=>{
  const r=M.defaults();r.data.hop=hops([[20,100],[30,100],[40,100],[50,100]]);
  let g=M.stats(r).repetitions.find(g=>g.testId==="hop");assert.equal(g.statistics.find(x=>x.id==="hop_rsi").n,1);
  const rows=M.ensureRepeatRows(r,"hop");assert.equal(rows.length,1);assert.equal(rows[0].jumps.length,4);
  rows.push({...hops([[60,100]]),id:"h2"},{...hops([[80,100]]),id:"h3"});r.mode="mean";
  g=M.stats(r).repetitions.find(g=>g.testId==="hop");assert.equal(g.statistics.find(x=>x.id==="hop_rsi").n,3);near(M.stats(r).values.hop_rsi,(3.5+6+8)/3);
  r.data.hop.trials=[];assert.equal(M.stats(r).values.hop_rsi,undefined);
});
test("EUR and gain use representative source values without fake paired trial statistics",()=>{
  const r=populated();near(result(r,"eur").value,1.25);near(result(r,"gain").value,25);
  r.mode="mean";r.data.cmj.push({id:"c2",height:60});near(result(r,"eur").value,50/32);
  assert.ok(!M.stats(r).repetitions.some(g=>g.testId==="eur"));assert.ok(!r.definitions.some(d=>d.ability==="训练方向分析"));
});
test("fDSI requires confirmed comparable force definitions and explicit source force",()=>{
  const r=populated();near(result(r,"fdsi").value,.6);assert.match(result(r,"fdsi").directionHint,/结合/);
  r.dsi.confirmed=false;assert.equal(result(r,"fdsi").available,false);r.dsi.confirmed=true;r.cmjConfig.definition="net";assert.equal(result(r,"fdsi").value,null);
  r.cmjConfig.definition="gross";r.data.cmj[0].force=1400;assert.match(result(r,"fdsi").directionHint,/弹道/);r.data.cmj[0].force=2100;assert.match(result(r,"fdsi").directionHint,/最大力量/);
});
test("iDSI uses full propulsion impulse and each specified denominator window",()=>{
  const r=populated();near(result(r,"idsi_matched").value,300/350);near(result(r,"idsi_fixed250").value,.75);
  r.data.cmj[0].force=9999;near(result(r,"idsi_fixed250").value,.75);
  r.data.imtp[0].matchedDurationMs=250;assert.equal(result(r,"idsi_matched").value,null);near(result(r,"idsi_fixed250").value,.75);
});
test("iDSI rejects unconfirmed or mixed impulse basis and never estimates missing impulse",()=>{
  const r=populated();r.impulseConfig.confirmed=false;assert.equal(result(r,"idsi_fixed250").value,null);r.impulseConfig.confirmed=true;r.imtpConfig.impulseDefinition="net";assert.equal(result(r,"idsi_fixed250").value,null);
  r.imtpConfig.impulseDefinition="gross";delete r.data.cmj[0].propulsiveImpulse;assert.equal(result(r,"idsi_fixed250").value,null);
});
test("mean iDSI requires complete source impulses and rejects unequal windows hidden by a mean",()=>{
  const r=populated();r.mode="mean";r.data.imtp=[{id:"i1",peakForce:2000,matchedImpulse:300,matchedDurationMs:150,impulse250:400},{id:"i2",peakForce:3000,matchedImpulse:400,matchedDurationMs:250,impulse250:500}];
  assert.equal(result(r,"idsi_matched").value,null);near(result(r,"idsi_fixed250").value,300/450);
  r.data.imtp[0].matchedDurationMs=200;r.data.imtp[1].matchedDurationMs=200;near(result(r,"idsi_matched").value,300/350);
  delete r.data.imtp[1].matchedImpulse;assert.equal(result(r,"idsi_matched").value,null);
});
test("Hop RQR selection ranks FT/CT independently of the chart height/contact RSI",()=>{
  const r=M.defaults();r.mode="mean";r.data.dj=[0,1,2].map(i=>({id:"d"+i,height:30,contactTimeMs:200,flightTimeMs:400,dropHeightCm:45}));
  r.data.hop=hops(Array.from({length:10},(_,i)=>[100-i*5,100,100+i*100]));
  const s=M.stats(r), h=s.raw.hop.sets[0], d=result(r,"rqr");
  assert.deepEqual(copy(h.selectedIds),["j0","j1","j2","j3","j4"]);assert.deepEqual(copy(h.rqr.selectedIds),["j9","j8","j7","j6","j5"]);near(d.value,2/8);assert.equal(d.protocolMatch,true);
  r.data.hop.jumps[0].flightTimeMs="";assert.equal(result(r,"rqr").protocolMatch,false);assert.ok(result(r,"rqr").available);
});
test("RQR does not substitute h/CT RSI or inferred flight time",()=>{
  const r=M.defaults();r.data.dj=[{id:"d",height:40,contactTimeMs:200}];r.data.hop=hops([[20,100]]);assert.equal(result(r,"rqr").value,null);
});
test("derived controls are independent of physical tests, scoring, and source statistics",()=>{
  const r=populated(), before=M.stats(r);r.derivedEnabled.eur=false;const after=M.stats(r);
  assert.equal(after.derived.results.some(d=>d.id==="eur"),false);assert.deepEqual(copy(after.axes),copy(before.axes));assert.deepEqual(copy(after.repetitions),copy(before.repetitions));
  const cat=M.normalizeCatalog();cat.derivedEnabled.gain=false;const created=M.recordFromCatalog(cat,{}, {cmj:true,sj:true});assert.equal(created.derivedEnabled.gain,false);
});
test("ASR and SRR use MSS and MAS units, preserving inconsistent data for review",()=>{
  const r=M.defaults();r.data.mas.speed=18;r.data.mas.unit="km/h";r.data.mss.speed=9;near(result(r,"asr").value,4);near(result(r,"srr").value,1.8);
  r.data.mss.speed=4;near(result(r,"asr").value,-1);assert.match(result(r,"srr").directionHint,/核对/);
});
test("historical migration preserves identity and manual narrative, disables absent new tests",()=>{
  const old=M.defaults();for(const id of ["dj","hop","cmrj"]){delete old.data[id];delete old.enabled[id];}delete old.derivedEnabled;delete old.impulseConfig;
  old.definitions=old.definitions.filter(d=>!["dj","hop","cmrj"].includes(d.testId)&&!/propulsive_|matched_|impulse250/.test(d.id));old.narrative.summary="手动分析";
  const r=M.normalizeRecord(old);assert.equal(r.recordId,old.recordId);assert.equal(r.narrative.summary,"手动分析");assert.equal(r.enabled.dj,false);assert.equal(r.enabled.hop,false);assert.equal(r.enabled.cmrj,false);M.validateRecord(r);
});
test("old peak-force evaluation contexts remain valid when impulse basis is added or changed",()=>{
  const r=populated();delete r.cmjConfig.impulseDefinition;delete r.imtpConfig.impulseDefinition;const p=E.create(r);
  const normalized=M.normalizeRecord(r);normalized.cmjConfig.impulseDefinition="net";normalized.imtpConfig.impulseDefinition="net";
  const resolved=E.resolve(normalized,p);assert.ok(!resolved.evaluationIssues.some(x=>x.id==="imtp_peak_force"||x.id==="cmj_peak_force"));
});
test("new fields validate numeric values, repeat IDs and count ordering",()=>{
  const r=populated();assert.ok(M.validateField(r,"data.dj.0.contactTimeMs",0));assert.ok(M.validateField(r,"data.hop.trials.0.summary.selectedCount",1.5));assert.ok(M.validateField(r,"data.imtp.0.matchedDurationMs",-1));
  r.data.hop=hops([[20,100],[30,100]]);r.data.hop.jumps[1].id=r.data.hop.jumps[0].id;assert.throws(()=>M.validateRecord(r),/ID/);
  r.data.hop=M.newHopSet();Object.assign(r.data.hop.summary,{suppliedCount:4,validCount:5});assert.throws(()=>M.validateRecord(r),/跳数/);
});
test("historical custom reactive test IDs remain scalar with values and definitions intact",()=>{
  const old=M.defaults();delete old.derivedEnabled;delete old.impulseConfig;old.customTests=[{id:"dj",name:"自定义旧测试",category:"performance"}];
  old.projectSnapshots=old.projectSnapshots?.filter(t=>t.id!=="dj");old.definitions=old.definitions.filter(d=>d.testId!=="dj");old.definitions.push({id:"dj_height",testId:"dj",name:"旧次数",unit:"次",direction:"higher",ranges:[],category:"performance",ability:"自定义",entryScope:"attempt"});old.data.dj=[{id:"legacy",metrics:{dj_height:17}}];
  const r=M.normalizeRecord(old);assert.equal(T.describe(r).find(t=>t.id==="dj").renderer,"scalar");assert.equal(T.describe(r).find(t=>t.id==="dj").name,"自定义旧测试");near(M.stats(r).values.dj_height,17);assert.equal(M.stats(r).raw.dj,undefined);M.validateRecord(r);
});
test("catalog upgrade preserves conflicting old custom test IDs without adding native metrics",()=>{
  const cat=M.normalizeCatalog();delete cat.derivedEnabled;cat.tests=cat.tests.filter(t=>t.id!=="hop");cat.tests.push({id:"hop",name:"旧连续测试",category:"performance"});cat.definitions=cat.definitions.filter(d=>d.testId!=="hop");cat.definitions.push({id:"custom_hop_score",testId:"hop",name:"评分",unit:"分",direction:"higher",ranges:[],category:"performance",ability:"自定义",entryScope:"attempt"});
  const upgraded=M.normalizeCatalog(cat);assert.equal(T.describe(upgraded).find(t=>t.id==="hop").renderer,"scalar");assert.equal(upgraded.definitions.filter(d=>d.testId==="hop").length,1);const r=M.recordFromCatalog(upgraded,{}, {hop:true});M.validateRecord(r);assert.equal(T.describe(r).find(t=>t.id==="hop").renderer,"scalar");
});
test("2.10 source fixtures retain measurements, scoring, manual text and narrative fingerprints",()=>{
  const {execFileSync}=require("node:child_process"), old=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});old.window=old;
  for(const name of ["calc","definitions","tests","model","interventions"]) vm.runInContext(execFileSync("git",["show",`v2.10.0:src/ringside-${name}.js`],{encoding:"utf8"}),old);
  for(const source of [old.RingsideModel.defaults(),old.RingsideModel.sampleRecord()].map(old.RingsideModel.normalizeRecord)) {
    source.narrative.summary="保留的手动分析";const before=old.RingsideModel.stats(source), baseline=old.RingsideModel.fingerprint(source), r=M.normalizeRecord(copy(source)), after=M.stats(r);
    const expectedAxes=copy(before.axes);for(const axis of expectedAxes)for(const definition of axis.defs){definition.name=c.Def.factoryText(definition.id,"name",definition.name);definition.protocol=c.Def.factoryText(definition.id,"protocol",definition.protocol);}
    assert.deepEqual(copy(after.values),copy(before.values));assert.deepEqual(copy(after.axes),expectedAxes);assert.deepEqual(copy(after.findings),copy(before.findings));assert.equal(r.narrative.summary,"保留的手动分析");
    if(M.fingerprint(r)!==baseline){const a=JSON.parse(M.fingerprint(r)),b=JSON.parse(baseline);for(const key of Object.keys(a))assert.deepEqual(a[key],b[key],"fingerprint differs at "+key);}
    assert.equal(M.fingerprint(r)===baseline,true,"fingerprint retains exact serialized order");
    r.derivedEnabled.eur=false;assert.notEqual(M.fingerprint(r),baseline);r.derivedEnabled.eur=true;
    r.data.cmj[0].propulsiveImpulse=345;assert.notEqual(M.fingerprint(r),baseline);
  }
});
console.log(`${passed} derived jump model checks passed`);
