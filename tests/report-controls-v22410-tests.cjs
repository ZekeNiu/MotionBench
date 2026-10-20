"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const {context,createFixture}=require("./helpers/longitudinal-fixture.cjs"),c=context(),copy=value=>JSON.parse(JSON.stringify(value));
for(const name of["longitudinal-views","longitudinal-view"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const L=c.RingsideLongitudinal,V=c.RingsideLongitudinalViews,R=c.RingsideReport;
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
const f=createFixture(c,3),historical=JSON.stringify(f.records),baseline=L.build(f.records,f);
const apply=views=>L.build(f.records,{...f,views});
const patch=(views,id,analysis)=>V.patch(views,id,{analysis},baseline.recordIds);
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const specs=html=>[...html.matchAll(/data-longitudinal-chart="([^"]+)"/g)].map(match=>JSON.parse(decode(match[1])));
const facts=model=>JSON.stringify(L.facts(model));
test("absent comparison conditions preserve every existing fact score and fingerprint",()=>{
  const ordinary=apply({}),empty=apply({charts:{"fvp_sj:profile":{analysis:{angle:null}},"sprint_fvp:profile":{analysis:{targetDistanceM:null}},"fvp_sj:elasticity":{analysis:{deltaForcePct:null,deltaVelocityPct:null}}}});
  assert.equal(facts(ordinary),facts(baseline));assert.equal(facts(empty),facts(baseline));
  assert.equal(ordinary.basis,baseline.basis);assert.equal(empty.basis,baseline.basis);assert.equal(JSON.stringify(f.records),historical);
});
test("jump direction and scenario share the existing model while fitted measurements remain unchanged",()=>{
  let views=patch({},"fvp_sj:profile",{angle:30});views=patch(views,"fvp_sj:elasticity",{deltaForcePct:5,deltaVelocityPct:0});
  const model=apply(views);assert.notEqual(model.basis,baseline.basis);assert.notEqual(facts(model),facts(baseline));
  for(let i=0;i<model.periods.length;i++){
    const before=baseline.periods[i].stats.fvp.fvp_sj,after=model.periods[i].stats.fvp.fvp_sj;
    assert.equal(after.analysis.angle,30);assert.notEqual(after.optimum.F0,before.optimum.F0);assert.notEqual(after.scenario.heightCm,before.scenario.heightCm);
    assert.deepEqual(copy(after.current),copy(before.current));assert.deepEqual(copy(after.verticalCurrent),copy(before.verticalCurrent));assert.deepEqual(copy(after.fit),copy(before.fit));
    assert.equal(model.periods[i].record.fvpAnalysis.fvp_sj.deltaForcePct,5);assert.deepEqual(copy(model.periods[i].stats.fvp.fvp_cmj.current),copy(baseline.periods[i].stats.fvp.fvp_cmj.current));
  }
  assert.equal(JSON.stringify(f.records),historical);assert.deepEqual(copy(model.records),copy(baseline.records));
  const html=c.RingsideLongitudinalView.render(model,{views}).details;
  assert.match(html,/data-longitudinal-analysis="angle"/);assert.match(html,/data-longitudinal-scenario-shortcut="force"/);assert.match(html,/30° 倾斜目标/);
});
test("sprint target and scenario recompute both analyses from one profile without changing fitted F0 or V0",()=>{
  let views=patch({},"sprint_fvp:profile",{targetDistanceM:20});views=patch(views,"sprint_fvp:elasticity",{deltaForcePct:5,deltaVelocityPct:3});const model=apply(views);
  for(let i=0;i<model.periods.length;i++){
    const before=baseline.periods[i].stats,after=model.periods[i].stats;
    assert.equal(after.sprintFvp.targetDistanceM,20);assert.equal(after.sprintElasticity.targetDistanceM,20);
    assert.equal(after.sprintFvp.model.F0,before.sprintFvp.model.F0);assert.equal(after.sprintFvp.model.V0,before.sprintFvp.model.V0);
    assert.notEqual(after.sprintFvp.optimum.F0,before.sprintFvp.optimum.F0);assert.ok(after.sprintElasticity.scenario.timeGainPct>0);
    assert.equal(after.sprintElasticity.scenario.deltaForcePct,5);assert.equal(after.sprintElasticity.scenario.deltaVelocityPct,3);
    const modules=model.capability.analyses.filter(item=>item.testId==="sprint_fvp");for(const module of modules)assert.equal(module.periods[i].analysis.targetDistanceM,20);
  }
  assert.equal(JSON.stringify(f.records),historical);assert.notEqual(model.basis,baseline.basis);
});
test("clearing comparison overrides restores each historical period rather than copying latest settings",()=>{
  const fixture=createFixture(c,3);fixture.records[0].fvpAnalysis.fvp_sj.angle=30;fixture.records[1].fvpAnalysis.fvp_sj.deltaForcePct=7;fixture.records[0].sprintFvpAnalysis.targetDistanceM=20;
  const original=L.build(fixture.records,fixture);let views=patch({},"fvp_sj:profile",{angle:90});views=patch(views,"fvp_sj:elasticity",{deltaForcePct:5});views=patch(views,"sprint_fvp:profile",{targetDistanceM:40});
  views=patch(views,"fvp_sj:profile",{angle:null});views=patch(views,"fvp_sj:elasticity",{deltaForcePct:null});views=patch(views,"sprint_fvp:profile",{targetDistanceM:null});
  const restored=L.build(fixture.records,{...fixture,views});assert.equal(facts(restored),facts(original));assert.equal(restored.basis,original.basis);
});
test("analysis contract rejects misplaced malformed and unsafe conditions while preserving legacy extensions",()=>{
  for(const [id,analysis]of[["risk",{angle:30}],["fvp_sj:profile",{targetDistanceM:20}],["sprint_fvp:profile",{angle:30}],["fvp_sj:elasticity",{angle:30}],["fvp_sj:profile",{angle:45}],["sprint_fvp:profile",{targetDistanceM:0}],["fvp_sj:elasticity",{deltaForcePct:-100}],["fvp_sj:elasticity",{deltaForcePct:NaN}],["fvp_sj:elasticity",{deltaVelocityPct:"5"}],["fvp_sj:elasticity",{unexpected:1}]])assert.throws(()=>patch({},id,analysis));
  const views={future:{value:7},charts:{"fvp_sj:profile":{recordIds:[baseline.recordIds[0]],options:{range:"measured"},analysis:{angle:30}},"sprint_fvp:elasticity":{analysis:{deltaVelocityPct:4}}}};
  const normalized=V.normalize(views,baseline.recordIds);assert.deepEqual(copy(V.normalize(JSON.parse(JSON.stringify(normalized)),baseline.recordIds)),views);
  assert.equal(V.patch(normalized,"fvp_sj:profile",{options:{fv:false}},baseline.recordIds).charts["fvp_sj:profile"].analysis.angle,30);
});
test("retired measured-range settings stay in records but never clip personal or comparison profiles",()=>{
  const fixture=createFixture(c,3);fixture.records.forEach(record=>{record.fvpView.fvp_sj.range="measured";record.fvpView.fvp_cmj.range="measured";});const before=JSON.stringify(fixture.records),model=L.build(fixture.records,fixture);
  const views={charts:{"fvp_sj:profile":{options:{range:"measured"}}}},out=c.RingsideLongitudinalView.render(model,{views});
  assert.doesNotMatch(out.details,/data-longitudinal-option="range"|完整剖面/);
  for(const chart of specs(out.details).filter(s=>s.section==="profile")){assert.equal(chart.xRange,undefined);assert.equal(chart.measuredDomains,undefined);assert.ok(chart.series.some(s=>s.points.some(p=>p?.x===0)));}
  const personal=R.renderFVPAnalysis(model.periods[0].report);assert.doesNotMatch(personal,/data-fvp-view="range"|完整剖面/);
  const solved=model.periods[0].stats.fvp.fvp_sj,graph={id:"fvp_sj",valid:true,profiles:[{...solved.current,kind:"current"}],points:solved.points.map(p=>({velocity:p.velocity,force:p.forceRelative,power:p.powerRelative})),band:[]};
  const normalize=svg=>svg.replace(/ringside-fvp-clip-\d+/g,"clip").replace(/ringside-viz-\d+/g,"viz");for(const width of[280,480])for(const print of[false,true])assert.equal(normalize(c.RingsideViz.jumpFvp(graph,{range:"measured"},{width,print})),normalize(c.RingsideViz.jumpFvp(graph,{range:"full"},{width,print})));
  assert.equal(JSON.stringify(fixture.records),before);
});
test("bound number controls reject browser badInput without clearing valid overrides and allow intentional empty input",()=>{
  const listeners=new Map(),panel={dataset:{longitudinalPanel:"fvp_sj:elasticity"}},container={dataset:{longitudinalOwner:"synthetic-owner"},querySelectorAll:()=>[],addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:(type,listener)=>{if(listeners.get(type)===listener)listeners.delete(type);}};
  const originalDisplay=c.RingsideResultDisplay;let views=patch({},"fvp_sj:elasticity",{deltaForcePct:5}),calls=0,validityReports=0;
  const input={dataset:{longitudinalAnalysis:"deltaForcePct"},value:"",validity:{badInput:true},isConnected:true,closest:selector=>selector==="[data-longitudinal-panel]"?panel:null,hasAttribute:attribute=>attribute==="data-longitudinal-analysis",getAttribute:attribute=>attribute==="data-longitudinal-analysis"?"deltaForcePct":null,reportValidity:()=>{validityReports++;return false;}};
  try{
    c.RingsideResultDisplay={layout(){},mount(){}};
    c.RingsideLongitudinalView.mount(container,baseline,{onChange:(id,delta)=>{calls++;views=V.patch(views,id,delta,baseline.recordIds);return true;}});
    const dispatch=listeners.get("change");assert.equal(typeof dispatch,"function");const before=JSON.stringify(views);
    dispatch({target:input});assert.equal(validityReports,1);assert.equal(calls,0);assert.equal(JSON.stringify(views),before);assert.equal(views.charts["fvp_sj:elasticity"].analysis.deltaForcePct,5);
    input.validity.badInput=false;dispatch({target:input});assert.equal(validityReports,1);assert.equal(calls,1);assert.equal(views.charts["fvp_sj:elasticity"].analysis.deltaForcePct,null);
  }finally{c.RingsideResultDisplay=originalDisplay;}
});
console.log(passed+" report control contract checks passed");
