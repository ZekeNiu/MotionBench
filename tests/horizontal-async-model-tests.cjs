"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {context,createFixture}=require("./helpers/longitudinal-fixture.cjs"),c=context();c.setTimeout=setTimeout;
for(const name of ["metric-semantics","comparison","horizontal"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const H=c.RingsideHorizontal,M=c.RingsideModel,copy=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(resolve=>setTimeout(resolve,0));
function options(records,references=3){const people=[...new Set(records.map(r=>r.athleteId))];return {mode:"mean",window:{kind:"all"},participants:people.slice(0,2).map(athleteId=>({athleteId,recordId:records.find(r=>r.athleteId===athleteId).recordId})),athletes:people.map(id=>({id,profile:{name:id,sex:"男"}})),references:Array.from({length:references},(_,i)=>({id:"ref"+i,scope:"all",sex:"男",sampling:i%2?"period-record":"latest"}))};}
function simpleRecords(count=11){return Array.from({length:count},(_,i)=>{const r=M.defaults();r.athleteId="person"+Math.floor(i/2);r.recordId="record"+i;r.demo=false;r.athlete.name=r.athleteId;r.athlete.sex="男";r.athlete.birthDate="2000-01-01";r.athlete.date=i%2?"2026-02-01":"2026-01-01";Object.keys(r.enabled).forEach(key=>r.enabled[key]=key==="cmj");r.data.cmj=[{id:"trial"+i,height:30+i,rsiModified:0.4}];return r;});}
const tests=[],test=(name,fn)=>tests.push([name,fn]);
test("cooperative and synchronous builds preserve every value and fingerprint across native projects",async()=>{
  const f=createFixture(c,2);f.records.forEach((r,i)=>{r.athleteId="full"+i;});const settings={...options(f.records),profile:f.profile,catalog:f.catalog},before=JSON.stringify({records:f.records,settings});
  const expected=H.build(f.records,settings),progress=[];let yields=0;
  const actual=await H.buildAsync(f.records,settings,{batchSize:1,yieldControl:async()=>{yields++;await turn();},onProgress:step=>progress.push(step.prepared)});
  assert.deepEqual(copy(actual),copy(expected));assert.ok(yields>=2);assert.equal(progress.at(-1),2);assert.equal(JSON.stringify({records:f.records,settings}),before);
});
test("all reference groups reuse exactly one prepared observation per eligible record",async()=>{
  const records=simpleRecords(),settings=options(records,12),original=c.RingsideComparison.prepareRecord,counts=new Map();
  c.RingsideComparison.prepareRecord=(source,...args)=>{counts.set(source.recordId,(counts.get(source.recordId)||0)+1);return original(source,...args);};
  try{const checkpoints=[];const model=await H.buildAsync(records,settings,{batchSize:3,yieldControl:turn,onProgress:value=>checkpoints.push(value.prepared)});
    assert.equal(counts.size,records.length);assert.ok([...counts.values()].every(n=>n===1));assert.equal(model.references.length,12);
    assert.equal(checkpoints.at(-1),records.length);assert.ok(checkpoints.length>=4);for(let i=1;i<checkpoints.length;i++)assert.ok(checkpoints[i]-checkpoints[i-1]<=3);
    assert.ok(model.references.every(ref=>ref.projects.flatMap(p=>p.metrics).find(row=>row.metricId==="cmj_height").benchmark.n===6));
  }finally{c.RingsideComparison.prepareRecord=original;}
});
test("default yielding lets pending event-loop work run before the snapshot completes",async()=>{
  const records=simpleRecords(5);let eventRan=false;const pending=new Promise(resolve=>setTimeout(()=>{eventRan=true;resolve();},0));
  const result=await H.buildAsync(records,options(records),{batchSize:2});assert.equal(eventRan,true);assert.ok(result.fingerprint);await pending;
});
test("pre-cancelled builds return no snapshot and prepare no observations",async()=>{
  const records=simpleRecords(3),original=c.RingsideComparison.prepareRecord;let prepared=0;c.RingsideComparison.prepareRecord=(...args)=>{prepared++;return original(...args);};
  try{assert.equal(await H.buildAsync(records,options(records),{isCancelled:()=>true}),null);assert.equal(prepared,0);}finally{c.RingsideComparison.prepareRecord=original;}
});
test("cancellation at a batch boundary returns no partial snapshot and stops further preparation",async()=>{
  const records=simpleRecords(9),settings=options(records),before=JSON.stringify(records),original=c.RingsideComparison.prepareRecord;let prepared=0,cancelled=false;
  c.RingsideComparison.prepareRecord=(...args)=>{prepared++;return original(...args);};
  try{const result=await H.buildAsync(records,settings,{batchSize:2,isCancelled:()=>cancelled,yieldControl:async()=>{if(prepared>=2)cancelled=true;await turn();}});
    assert.equal(result,null);assert.equal(prepared,2);assert.equal(JSON.stringify(records),before);
  }finally{c.RingsideComparison.prepareRecord=original;}
});
test("cooperative validation reports the same invalid participant error as synchronous build",async()=>{
  const records=simpleRecords(2),settings={...options(records),participants:[]};let expected;try{H.build(records,settings);}catch(error){expected=error.message;}
  assert.ok(expected);await assert.rejects(H.buildAsync(records,settings),error=>error.message===expected);
});
(async()=>{let passed=0;for(const[name,fn]of tests){await fn();passed++;console.log("PASS "+name);}console.log(passed+" horizontal cooperative model checks passed");})().catch(error=>{console.error(error);process.exitCode=1;});
