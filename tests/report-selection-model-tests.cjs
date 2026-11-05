"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const context=vm.createContext({console,Date});context.window=context;
context.RingsideLongitudinalStore={validDate:date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(new Date(date).getTime())};
for(const name of ["report-selection","horizontal-setup"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),context);
const S=context.RingsideReportSelection,copy=v=>JSON.parse(JSON.stringify(v)),tests=[];
const test=(name,run)=>tests.push([name,run]);
test("new athlete requires an explicit record even when exactly one is available",()=>{const s=S.state();s.athlete("a",true);assert.equal(s.status(),"missing-record");assert.deepEqual(copy(s.get().athletes),[{athleteId:"a",recordIds:[]}]);s.record("a","r1",true);assert.equal(s.status(),"ready");});
test("adding a second athlete preserves all longitudinal dates until a horizontal choice is made",()=>{const s=S.state({athletes:[{athleteId:"a",recordIds:["r1","r2"]}]});s.athlete("b",true);s.record("b","b1",true);assert.equal(s.status(),"choose-one");assert.deepEqual(copy(s.get().athletes[0].recordIds),["r1","r2"]);s.record("a","r1",true);assert.equal(s.status(),"ready");assert.deepEqual(copy(s.get().athletes[0].recordIds),["r1"]);s.athlete("b",false);assert.deepEqual(copy(s.get().athletes[0].recordIds),["r1","r2"]);});
test("adding and removing a group restores longitudinal selection without replacing dates",()=>{const s=S.state({athletes:[{athleteId:"a",recordIds:["old","new"]}]});s.reference({id:"g"});assert.equal(s.status(),"choose-one");s.record("a","old",true);assert.equal(s.status(),"ready");s.removeReference("g");assert.deepEqual(copy(s.get().athletes[0].recordIds),["old","new"]);});
test("a group is a valid standalone object and removal returns to empty",()=>{const s=S.state();s.reference({id:"g"});assert.equal(s.status(),"ready");s.removeReference("g");assert.equal(s.status(),"empty");});
test("selection order does not manufacture duplicate people or records",()=>{const s=S.state();s.athlete("a",true);s.athlete("a",true);s.record("a","r",true);s.record("a","r",true);assert.equal(s.get().athletes.length,1);assert.equal(s.get().athletes[0].recordIds.length,1);});
test("snapshot cannot mutate selection state",()=>{const s=S.state({athletes:[{athleteId:"a",recordIds:["r"]}]});s.get().athletes[0].recordIds.push("changed");assert.equal(s.get().athletes[0].recordIds.length,1);});
test("opening another report clears only the prior report's temporary longitudinal history",()=>{const s=S.state({athletes:[{athleteId:"a",recordIds:["r1","r2"]}]});s.athlete("b",true);s.record("a","r1",true);s.replace({athletes:[{athleteId:"a",recordIds:["r3"]}]});s.athlete("b",true);s.athlete("b",false);assert.deepEqual(copy(s.get().athletes[0].recordIds),["r3"]);});
test("inclusive seven-day window resolves across month and year boundaries",()=>{assert.deepEqual(copy(context.RingsideHorizontalSetup.dateWindow("recent7","","","2026-01-03")),{kind:"recent7",from:"2025-12-28",to:"2026-01-03"});});
test("14/30/90 days are inclusive and year selection is frozen",()=>{for(const days of [14,30,90]){const w=context.RingsideHorizontalSetup.dateWindow("recent"+days,"","","2026-10-24");assert.equal((new Date(w.to)-new Date(w.from))/86400000+1,days);}const w=context.RingsideHorizontalSetup.dateWindow("recent12","","","2026-10-24");assert.equal(w.from,"2025-10-24");assert.equal(w.to,"2026-10-24");});
test("explicit single analysis never changes with participant or reference counts",()=>{
  const s=S.state({analysisMode:"single",athletes:[{athleteId:"a",recordIds:["r1"]}]});
  s.athlete("b",true);s.record("b","b1",true);assert.equal(s.get().analysisMode,"single");assert.equal(s.status(),"choose-athlete");
  s.reference({id:"g"});assert.equal(s.status(),"references-not-supported");assert.equal(s.get().analysisMode,"single");
  s.athlete("b",false);s.removeReference("g");assert.equal(s.status(),"ready");
});
test("explicit longitudinal analysis requires one person and at least two records",()=>{
  const s=S.state({analysisMode:"longitudinal",athletes:[{athleteId:"a",recordIds:["r1"]}]});assert.equal(s.status(),"choose-many");
  s.record("a","r2",true);assert.equal(s.status(),"ready");s.record("a","r1",false);assert.equal(s.status(),"choose-many");assert.equal(s.get().analysisMode,"longitudinal");
  s.athlete("b",true);assert.equal(s.status(),"choose-athlete");
});
test("explicit horizontal analysis permits standalone cohorts but never a lone unreferenced athlete",()=>{
  const s=S.state({analysisMode:"horizontal",athletes:[{athleteId:"a",recordIds:["r1"]}]});assert.equal(s.status(),"missing-comparison");
  s.athlete("b",true);assert.equal(s.status(),"missing-record");s.record("b","b1",true);assert.equal(s.status(),"ready");
  s.reference({id:"g"});s.athlete("a",false);s.athlete("b",false);assert.equal(s.status(),"ready");assert.equal(s.get().analysisMode,"horizontal");
  s.removeReference("g");assert.equal(s.status(),"empty");
});
test("analysis switches preserve every source and require explicit removal of incompatible records",()=>{
  const s=S.state({analysisMode:"longitudinal",mode:"mean",athletes:[{athleteId:"a",recordIds:["r1","r2"]}]});
  s.analysisMode("single");assert.deepEqual(copy(s.get().athletes[0].recordIds),["r1","r2"]);assert.equal(s.status(),"choose-one");
  s.record("a","r2",false);assert.equal(s.status(),"ready");s.analysisMode("longitudinal");assert.deepEqual(copy(s.get().athletes[0].recordIds),["r1"]);assert.equal(s.status(),"choose-many");
  s.analysisMode("horizontal");s.reference({id:"g"});s.analysisMode("single");assert.equal(s.get().references.length,1);assert.equal(s.status(),"references-not-supported");
  assert.equal(s.get().mode,"mean");assert.equal(s.analysisMode("mean"),false);assert.equal(s.get().analysisMode,"single");
});

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function selectorHarness(extra={}){
  const nodes=new Map(),node={innerHTML:"",querySelectorAll:()=>[],querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{focus(){},addEventListener(){},setSelectionRange(){}});return nodes.get(selector);}};
  context.document={activeElement:null,addEventListener(){},getElementById:()=>null};
  context.RingsideClassifications={normalize:()=>({sports:[],subdivisions:[],ageBands:[]}),resolve:()=>({sportName:""})};
  let current={athleteId:"a",recordId:"r1",mode:"mean",evaluationProfileId:""},currentIdentity="personal:r1";
  const calls=[],library={defaultEvaluationProfileId:"default-profile",athletes:[{id:"a",name:"甲",records:[{recordId:"r1",athlete:{date:"2026-11-01"}},{recordId:"r2",athlete:{date:"2026-11-02"}}]}],groups:[],evaluationProfiles:[]};
  const host={library:()=>library,element:()=>node,current:()=>current,identity:()=>currentIdentity,reportId:()=>"existing-report",
    cancelPending:()=>calls.push("cancelPending"),onCancel:()=>calls.push("onCancel"),select:async(value,options)=>{calls.push({value:copy(value),options});return true;},onApplied:async()=>calls.push("onApplied"),...extra};
  return {ui:S.create(host),node,nodes,calls,host,setCurrent:value=>{current=value;currentIdentity="personal:"+value.recordId;},changeMode:value=>node.querySelector("[data-analysis-mode]").onchange({target:{value}})};
}
test("new selector sessions start empty in single mode and revert to their own baseline",async()=>{
  const h=selectorHarness();h.ui.begin({intent:"new"});assert.equal(h.ui.state().analysisMode,"single");assert.deepEqual(copy(h.ui.state().athletes),[]);assert.equal(await h.ui.apply(),false);
  h.changeMode("longitudinal");h.setCurrent({athleteId:"b",recordId:"another"});h.ui.render();assert.equal(h.ui.state().analysisMode,"longitudinal");
  h.ui.reset();assert.equal(h.ui.state().analysisMode,"single");assert.deepEqual(copy(h.ui.state().athletes),[]);assert.equal(h.calls.includes("onCancel"),false);
  assert.equal(h.ui.desktopCloseStatus().unsaved,false);assert.match(h.node.innerHTML,/data-analysis-mode/);assert.doesNotMatch(h.node.innerHTML,/data-create-team|data-edit-team/);
});
test("edit selector sessions seed actual longitudinal sources and preserve the selected representation mode",()=>{
  const h=selectorHarness({longitudinal:()=>({athleteId:"a",recordIds:["r1","r2"]})});h.ui.begin({intent:"edit"});
  assert.equal(h.ui.state().analysisMode,"longitudinal");assert.equal(h.ui.state().mode,"mean");assert.deepEqual(copy(h.ui.state().athletes[0].recordIds),["r1","r2"]);
  h.changeMode("single");assert.equal(h.ui.desktopCloseStatus().unsaved,true);assert.match(h.node.innerHTML,/已保留多条测试记录/);assert.match(h.node.innerHTML,/data-apply-selection disabled/);
  h.ui.reset();assert.equal(h.ui.state().analysisMode,"longitudinal");assert.equal(h.ui.desktopCloseStatus().unsaved,false);
});
test("editing a saved horizontal configuration retains its report type when its sources are currently incompatible",async()=>{
  const h=selectorHarness({configuration:()=>({participants:[{athleteId:"a",recordId:"r1"}],references:[],mode:"mean"})});
  h.ui.begin({intent:"edit"});assert.equal(h.ui.state().analysisMode,"horizontal");assert.equal(h.ui.state().mode,"mean");assert.equal(await h.ui.apply(),false);
  assert.match(h.node.innerHTML,/横向比较需要至少两名运动员/);assert.deepEqual(copy(h.ui.state().athletes),[{athleteId:"a",recordIds:["r1"]}]);
});
test("editing longitudinal reports uses their own mode and evaluation choice instead of the personal anchor",()=>{
  for(const profileId of ["","long-profile"]){
    const h=selectorHarness({longitudinal:()=>({athleteId:"a",recordIds:["r1","r2"],mode:"best",evaluationProfileId:profileId})});
    h.ui.begin({intent:"edit"});assert.equal(h.ui.state().mode,"best");assert.equal(h.ui.state().profileId,profileId);
  }
});
test("apply passes explicit analysis mode and report identity then awaits completion callback",async()=>{
  const pending=deferred(),h=selectorHarness({onApplied:()=>pending.promise});h.ui.begin({intent:"edit",configuration:{reportId:"chosen-report",participants:[{athleteId:"a",recordId:"r1"}]},analysisMode:"single"});
  let settled=false;const task=h.ui.apply().then(value=>{settled=true;return value;});await tick();
  const call=h.calls.find(value=>value?.options);assert.equal(call.value.analysisMode,"single");assert.equal(call.options.analysisMode,"single");assert.equal(call.options.reportId,"chosen-report");assert.equal(call.options.isCurrent(),true);
  assert.equal(settled,false);assert.equal(h.ui.isPending(),true);pending.resolve();assert.equal(await task,true);assert.equal(h.ui.isPending(),false);
});
test("new sessions never inherit an existing report identity",async()=>{
  const h=selectorHarness();h.ui.begin({intent:"new",analysisMode:"horizontal"});
  assert.equal(h.ui.state().analysisMode,"horizontal");assert.deepEqual(copy(h.ui.state().references),[]);assert.equal(await h.ui.apply(),false);
  h.ui.edit({athletes:[{athleteId:"a",recordIds:["r1"]}],analysisMode:"single"});assert.equal(await h.ui.apply(),true);assert.equal(h.calls.find(call=>call?.options).options.reportId,"existing-report");
});
test("programmatic cancellation invalidates an in-flight request without invoking host callbacks",async()=>{
  const pending=deferred(),h=selectorHarness({select:(value,options)=>{h.calls.push({value,options});return pending.promise;}});
  h.ui.begin({intent:"edit"});const task=h.ui.apply(),call=h.calls.find(value=>value?.options),before=h.calls.length;h.ui.cancel();
  assert.equal(h.calls.length,before);assert.equal(call.options.isCurrent(),false);assert.equal(h.ui.desktopCloseStatus().unsaved,false);
  h.ui.begin({intent:"new",analysisMode:"horizontal"});pending.resolve(true);assert.equal(await task,false);assert.equal(h.ui.state().analysisMode,"horizontal");assert.deepEqual(copy(h.ui.state().athletes),[]);assert.equal(h.calls.includes("onApplied"),false);
});
test("the cancel button delegates navigation to the host while revert remains in the selection session",()=>{
  const h=selectorHarness();h.ui.begin({intent:"edit"});h.node.querySelector("[data-cancel-selection]").onclick();assert.equal(h.calls.at(-1),"onCancel");
  h.changeMode("longitudinal");h.node.querySelector("[data-revert-selection]").onclick();assert.equal(h.ui.state().analysisMode,"single");assert.equal(h.calls.filter(call=>call==="onCancel").length,1);
});
(async()=>{let passed=0;for(const[name,run]of tests){await run();passed++;console.log("PASS "+name);}console.log(passed+" report selection checks passed");})().catch(error=>{console.error(error);process.exitCode=1;});
