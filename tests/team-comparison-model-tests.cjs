"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const c=require("./helpers/longitudinal-fixture.cjs").context();
for(const name of ["metric-semantics","comparison","horizontal","team"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const M=c.RingsideModel,T=c.RingsideTeam,copy=x=>JSON.parse(JSON.stringify(x));let passed=0;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function record(athleteId,date,value,{meaning="numeric",unit="cm",fms=false}={}){
  const r=M.defaults();r.demo=false;r.athleteId=athleteId;r.recordId=athleteId+"-"+date;r.athlete.name=athleteId;r.athlete.date=date;r.athlete.mass=70;r.athlete.sex="男";r.athlete.birthDate="2000-01-01";
  Object.keys(r.enabled).forEach(key=>r.enabled[key]=fms&&key==="fms");
  if(fms){r.data.fms.forEach(item=>{item.pain=false;if(item.bilateral){item.left=3;item.right=3;}else item.score=3;});r.data.fms[1].left=value;r.data.fms[1].location="knee_l";}
  else{r.customTests.push({id:"comparison_test",name:"比较测试",category:"performance",primaryMetricId:"comparison_value",selectionDirection:"higher"});r.enabled.comparison_test=true;r.definitions.push({id:"comparison_value",testId:"comparison_test",name:"比较读数",unit,category:"performance",entryScope:"attempt",measurementScale:meaning==="ordinal"?"ordinal":"ratio",resultMeaning:meaning,direction:"higher",directionStatus:"confirmed",ranges:[],referenceEnabled:false});r.data.comparison_test=[{id:r.recordId+"-trial",metrics:value===null?{}:{comparison_value:value}}];}
  return M.normalizeRecord(r);
}
const dates=["2026-11-01","2026-11-03","2026-11-05"];
function longitudinal(records,ids,selectedDates=dates.slice(0,2)){
  return {analysisMode:"longitudinal",athleteIds:ids,dates:selectedDates,mode:"best",profileId:"",dateParticipants:selectedDates.map(date=>({date,participants:ids.map(athleteId=>({athleteId,recordId:records.find(r=>r.athleteId===athleteId&&r.athlete.date===date)?.recordId||""}))})),athletes:ids.map(id=>({id,profile:{name:id}})),profile:null};
}
const metric=m=>m.projects.flatMap(p=>p.metrics).find(r=>r.metricId==="comparison_value");
function test(name,run){run();passed++;console.log("PASS "+name);}
test("date means retain all available people while paired changes use only shared endpoints",()=>{
  const records=[record("a",dates[0],20),record("b",dates[0],100),record("a",dates[1],30),record("c",dates[1],40)],before=JSON.stringify(records),m=T.build(records,longitudinal(records,["a","b","c"])),row=metric(m);
  assert.equal(m.people.length,3);assert.deepEqual(copy(row.cells.map(c=>c.n)),[2,2]);near(row.cells[0].value,60);near(row.cells[1].value,35);near(row.pairedChanges.overall.delta,10);assert.equal(row.pairedChanges.overall.n,1);near(row.pairedChanges.overall.fromMean,20);near(row.pairedChanges.overall.toMean,30);
  assert.equal(row.people.find(p=>p.athleteId==="b").cells[1],null);assert.equal(row.people.find(p=>p.athleteId==="c").cells[0],null);assert.equal(m.sourceRecords.length,4);assert.equal(JSON.stringify(records),before);
  assert.equal(row.pairedChanges.overall.improvement,null);assert.equal(T.hasData(m),true);
});
test("an intermediate absence does not exclude a person from first-last comparison",()=>{
  const records=[record("a",dates[0],20),record("b",dates[0],100),record("a",dates[1],30),record("a",dates[2],40),record("b",dates[2],110)],row=metric(T.build(records,longitudinal(records,["a","b"],dates)));
  assert.equal(row.pairedChanges.overall.n,2);near(row.pairedChanges.overall.delta,15);assert.equal(row.pairedChanges.recent.n,1);near(row.pairedChanges.recent.delta,10);assert.equal(row.people[1].cells[1],null);
});
test("empty dates and unmatched endpoints remain absent rather than zero or previous data",()=>{
  const records=[record("a",dates[0],20)],m=T.build(records,longitudinal(records,["a","b"])),row=metric(m);assert.equal(row.cells[1].value,null);assert.equal(row.cells[1].n,0);assert.equal(row.pairedChanges.overall.available,false);assert.equal(row.pairedChanges.overall.n,0);assert.equal(m.periods[1].model.people.length,2);
});
test("date-record mismatch and duplicate dates are rejected",()=>{
  const records=[record("a",dates[0],20)],config=longitudinal(records,["a"]);config.dateParticipants[1].participants[0].recordId=records[0].recordId;assert.throws(()=>T.build(records,config),/日期不一致/);config.dates=[dates[0],dates[0]];assert.throws(()=>T.build(records,config),/不同的有效/);
});
test("compatible length units are compared in one physical unit",()=>{
  const records=[record("a",dates[0],100),record("a",dates[1],2,{unit:"m"})],row=metric(T.build(records,longitudinal(records,["a"])));assert.equal(row.cells.length,2);near(row.cells[0].value,100);near(row.cells[1].value,200);near(row.pairedChanges.overall.delta,100);
});
test("ordinary ordinal observations retain individual transitions without averaged codes",()=>{
  const records=[record("a",dates[0],1,{meaning:"ordinal"}),record("a",dates[1],2,{meaning:"ordinal"})],row=metric(T.build(records,longitudinal(records,["a"])));assert.equal(row.cells[0].value,null);assert.equal(row.pairedChanges.overall.available,false);assert.equal(row.pairedChanges.overall.transitions.length,1);
});
test("category-only reference distributions remain exportable without a fabricated mean",()=>{
  const records=[record("a",dates[0],1,{meaning:"category"}),record("b",dates[0],2,{meaning:"category"})],m=T.build(records,referenceConfiguration());assert.equal(metric(m).cells[0].value,null);assert.equal(metric(m).cells[0].distribution.length,2);assert.equal(T.hasData(m),true);
});
function referenceConfiguration(sampling="period-mean") {return {analysisMode:"horizontal",mode:"best",profileId:"",profile:null,objects:[{id:"ref",label:"参考群体",kind:"reference",reference:{scope:"all",sampling,window:{kind:"all"}}}]};}
test("reference-only comparisons give each person one contribution and freeze every used record",()=>{
  const records=[record("a",dates[0],10),record("a",dates[1],20),record("b",dates[0],40)],m=T.build(records,referenceConfiguration()),row=metric(m);near(row.cells[0].value,27.5);assert.equal(row.cells[0].n,2);assert.equal(m.objects[0].model,null);assert.equal(m.objects[0].referenceModel.projects[0].metrics[0].benchmark.contributors.length,2);assert.equal(m.sourceRecords.length,3);assert.equal(m.risk.flaggedCount,null);assert.equal(T.present(m).presentation.baselineObjectId,"");
});
test("reference screening honors latest best and mean rather than silently forcing latest",()=>{
  const records=[record("a",dates[0],3,{fms:true}),record("a",dates[1],1,{fms:true})];
  for(const [sampling,expected] of [["latest",1],["period-record",3],["period-mean",2]]){const m=T.build(records,referenceConfiguration(sampling)),ref=m.objects[0].referenceModel,row=ref.projects.flatMap(p=>p.metrics).find(r=>r.subjectId==="fms:1");near(row.benchmark.mean,expected);assert.equal(row.benchmark.sampling,sampling);assert.equal(ref.aggregateRiskRegions.knee_l.status,expected===3?"green":"amber");assert.equal(m.objects[0].model,null);}
});
test("team objects have no automatic focus or baseline and an explicit baseline only affects display",()=>{
  const records=[record("a",dates[0],10),record("b",dates[0],40)],config={analysisMode:"horizontal",profile:null,objects:records.map((r,i)=>({id:"team"+i,label:"组"+i,kind:"team",participants:[{athleteId:r.athleteId,recordId:r.recordId}]}))},m=T.build(records,config),before=JSON.stringify(m),shown=T.present(m,{baselineObjectId:"team0",focusObjectId:"team1"});assert.equal(T.present(m).presentation.focusObjectId,"");assert.equal(T.present(m).presentation.baselineObjectId,"");near(metric(shown).differences[1].delta,30);assert.equal(JSON.stringify(m),before);
});
test("display title does not change calculation identity",()=>{
  const records=[record("a",dates[0],10),record("a",dates[1],40)],config=longitudinal(records,["a"]),a=T.build(records,{...config,title:"旧名"}),b=T.build(records,{...config,title:"新名"});assert.equal(a.fingerprint,b.fingerprint);
});
(async()=>{const records=[record("a",dates[0],10),record("a",dates[1],40)],options=longitudinal(records,["a"]),sync=T.build(records,options),asyncResult=await T.buildAsync(records,options,{yieldControl:async()=>{}});assert.deepEqual(copy(asyncResult),copy(sync));passed++;console.log("PASS async comparison uses the same calculation pipeline");assert.equal(await T.buildAsync(records,options,{isCancelled:()=>true}),null);passed++;console.log(passed+" team comparison model checks passed");})().catch(error=>{console.error(error);process.exitCode=1;});
