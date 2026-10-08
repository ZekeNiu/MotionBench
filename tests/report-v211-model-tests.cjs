"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict");
const context=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});context.window=context;
for(const name of ["calc", "fvp","definitions","tests","model","evaluation","interventions","viz","report"])vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`,"utf8"),context);
const M=context.RingsideModel,R=context.RingsideReport;
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
function fixture(){
 const r=M.defaults();r.enabled=Object.fromEntries(Object.keys(r.enabled).map(id=>[id,["cmj","sj","dj","hop","cmrj"].includes(id)]));
 r.data.cmj=[{id:"cmj",height:40,force:1500}];r.data.sj=[{id:"sj",height:35}];r.data.dj=[{id:"dj",height:30,contactTimeMs:150,flightTimeMs:495,dropHeightCm:30}];
 r.data.cmrj=[{id:"cmrj",firstHeight:30,firstTimeToTakeoffMs:300,height:25,contactTimeMs:125,flightTimeMs:450}];
 r.data.hop={id:"hop-set",inputMode:"jumps",summary:{height:99,rsi:9,selectionBasis:"unknown"},jumps:[10,20,30,40,50,60].map((height,i)=>({id:"jump"+i,height,contactTimeMs:100,flightTimeMs:300+i*20,notes:i===0?"未选原始跳次":""})),notes:"原始整组备注"};return r;
}
test("five jump projects share a complete table and separate height and RSI chart units",()=>{
 const report=R.build(fixture()),html=R.render(report);assert.deepEqual(Array.from(report.diagnostics),[]);
 assert.equal((html.match(/data-jump-series="height"/g)||[]).length,5);assert.equal((html.match(/data-jump-series="rsi"/g)||[]).length,3);
 for(const id of ["dj_rsi","hop_rsi","cmrj_rsi","cmrj_height","dj_height","hop_height"])assert.match(html,new RegExp(`data-metric-id="${id}"`));
 for(const id of ["cmrj_first_height","cmrj_first_rsi_modified","dj_drop_height","hop_contact_time","cmj_propulsive_impulse"])assert.doesNotMatch(html,new RegExp(`data-metric-id="${id}"`));
 assert.doesNotMatch(html,/<title/);
});
test("Hop appendix has one result per complete test while raw hops stay in saved data",()=>{
 const report=R.build(fixture()),html=R.render(report);assert.equal(report.stats.raw.hop.row.height,40);assert.equal(report.stats.raw.hop.row.rsi,4);
 assert.doesNotMatch(html,/逐跳记录|录入 6 跳|未选原始跳次|hop-raw-table/);assert.match(html,/原始整组备注/);
 assert.equal((html.match(/data-metric-id="hop-set-/g)||[]).length,1);assert.equal(report.record.data.hop.jumps.length,6);assert.equal(report.record.data.hop.jumps[0].notes,"未选原始跳次");
 const group=report.stats.repetitions.find(g=>g.testId==="hop");assert.ok(group);assert.ok(group.statistics.every(metric=>metric.n<=1));assert.doesNotMatch(html,/均值 ± SD/);
});
test("three independent Hop sets enable statistics while preserving every set",()=>{
 const r=fixture(),set=JSON.parse(JSON.stringify(r.data.hop));r.data.hop.trials=[0,1,2].map(i=>({...JSON.parse(JSON.stringify(set)),id:"set"+i}));
 const report=R.build(r),html=R.render(report),group=report.stats.repetitions.find(g=>g.testId==="hop");
 assert.equal(group.statistics.find(metric=>metric.id==="hop_rsi").n,3);assert.match(html,/均值 ± SD/);assert.match(html,/完整测试结果 · 共 3 次/);assert.equal((html.match(/data-metric-id="hop-set-/g)||[]).length,3);
});
test("capability cards render measured data before judgments and hide invalid metrics and empty cards",()=>{
 const report=R.build(fixture());report.stats.capabilityCards=[{id:"strength",title:"力量发展方向",metrics:[{id:"fdsi",label:"DSI",unit:"比值",value:.6,judgment:"最大力量与快速力量结合",status:"gray",components:[{label:"CMJ 推进期峰值力",value:1500,unit:"N"},{label:"等长峰值力",value:2500,unit:"N"}]},{id:"eur",label:"EUR",value:null}]},{id:"reactive",title:"反应力量水平",metrics:[]}];
 const html=R.render(report),card=html.slice(html.indexOf('data-capability-card="strength"'));
 assert.match(card,/0\.600/);assert.match(card,/2,500\.0/);assert.ok(card.indexOf("0.600")<card.indexOf("最大力量与快速力量结合"));assert.ok(card.indexOf("最大力量与快速力量结合")<card.indexOf("组成数据"));
 assert.doesNotMatch(card,/data-capability-metric="eur"|data-capability-card="reactive"|录入 CMJ 冲量|录入 IMTP 冲量|derived-sources|derived-formula/);
});
test("iDSI retains the selected valid time window without missing-data entry actions",()=>{
 const report=R.build(fixture()),variants=[{id:"idsi_matched",available:true,value:.5},{id:"idsi_fixed250",available:true,value:2/3}];
 for(const selected of variants){report.stats.capabilityCards=[{id:"strength",title:"力量发展方向",metrics:[{id:"idsi",label:"iDSI 冲量比",value:selected.value,unit:"比值",selectedVariant:selected.id,variants}]}];const html=R.render(report);assert.match(html,new RegExp(`data-derived-result="${selected.id}"`));assert.match(html,new RegExp(`value="${selected.id}" selected`));assert.match(html,/aria-label="iDSI 时间窗口"/);assert.doesNotMatch(html,/录入 CMJ 冲量|录入 IMTP 冲量/);}
});
test("four capability groups retain only the supported cardio synthesis",()=>{
 const report=R.build(fixture());report.stats.capabilityCards=["strength","reactive","speed","cardio"].map((id,i)=>({id,title:["力量发展方向","反应力量水平","速度耐力类型","心肺发展方向"][i],metrics:[{id:id+"_metric",label:id,value:i+1,unit:"%"}],conclusion:id==="cardio"?"优先发展第二阈值":"不应产生综合训练结论"}));
 const html=R.render(report);assert.equal((html.match(/data-capability-card=/g)||[]).length,4);assert.equal((html.match(/class="capability-row"/g)||[]).length,2);assert.match(html,/能力结构分析/);assert.match(html,/优先发展第二阈值/);assert.doesNotMatch(html,/不应产生综合训练结论/);
 report.stats.capabilityCards=[];assert.doesNotMatch(R.render(report),/id="trainingAnalysisDetail"/);
});
test("native CPET renders original oxygen and threshold labels without a fallback",()=>{
 const r=fixture();r.enabled.cpet=true;r.athlete.mass=70;r.data.cpet={modality:"treadmill",oxygenLabel:"VO2max",vo2:50,vo2Unit:"ml/kg/min",peakHr:185,rer:1.12,thresholds:{first:{label:"GET",vo2:30,vo2Unit:"ml/kg/min",hr:140},second:{label:"RCP",vo2:40,vo2Unit:"ml/kg/min",hr:169}}};
 const report=R.build(r),html=R.render(report);assert.deepEqual(Array.from(report.diagnostics),[]);assert.match(html,/VO₂max · 相对摄氧量/);assert.match(html,/GET摄氧量占比|GET 摄氧量占比/);assert.match(html,/RCP摄氧量占比|RCP 摄氧量占比/);assert.match(html,/RER 1\.12/);assert.doesNotMatch(html,/图形暂不可用/);
});
test("CPET independent oxygen and HR standards survive missing peak and percentage grouping",()=>{
 for(const withPeak of [false,true]){
  const r=M.defaults();r.enabled.cpet=true;r.athlete.mass=70;r.data.cpet={modality:"treadmill",oxygenLabel:"VO2peak",vo2:withPeak?50:"",vo2Unit:"ml/kg/min",thresholds:{first:{label:"VT1",vo2:30,vo2Unit:"ml/kg/min",hr:140}}};
  for(const [id,label]of [["cpet_threshold1_vo2_relative","摄氧量自定义等级"],["cpet_threshold1_hr","心率自定义等级"]])Object.assign(r.definitions.find(d=>d.id===id),{referenceEnabled:true,target:null,ranges:[{min:0,max:null,includeMin:true,includeMax:true,status:"green",label}]});
  const report=R.build(r),card=report.stats.capabilityCards.find(c=>c.id==="cardio"),primary=card.metrics.find(m=>m.id===(withPeak?"cpet_threshold1_pct":"cpet_threshold1_vo2_relative")),html=R.render(report).split('data-capability-card="cardio"')[1];
  assert.ok(primary);assert.match(html,/摄氧量自定义等级/);assert.match(html,/心率自定义等级/);assert.match(html,/140\.0[\s\S]*capability-component-judgment green[\s\S]*心率自定义等级/);
  if(withPeak){assert.equal(primary.components.find(c=>c.id==="cpet_threshold1_vo2_relative").judgment,"摄氧量自定义等级");assert.match(html,/30\.0[\s\S]*capability-component-judgment green[\s\S]*摄氧量自定义等级/);}
  else{assert.equal(primary.judgment,"摄氧量自定义等级");assert.equal(primary.value,30);assert.equal(card.metrics.some(m=>m.id==="cpet_vo2_relative"),false);}
  for(const d of r.definitions)if(d.id.startsWith("cpet_")){d.referenceEnabled=false;d.ranges=[];d.target=null;}
  const ungraded=R.render(R.build(r)).split('data-capability-card="cardio"')[1];assert.doesNotMatch(ungraded,/capability-component-judgment|capability-judgment|自定义等级/);
 }
});
test("recorded IMTP impulses remain in its results table and retain true repeat statistics",()=>{
 const r=fixture();r.enabled.imtp=true;r.data.imtp=[0,1,2].map(i=>({id:"impulse"+i,peakForce:2800+i*50,impulse250:300+i*10,matchedImpulse:400+i*10,matchedDurationMs:300}));
 const html=R.render(R.build(r));for(const id of ["imtp_impulse250","imtp_matched_impulse","imtp_matched_duration"])assert.match(html,new RegExp(`data-metric-id="${id}"`));
 assert.match(html,/data-repeat-stat="imtp_impulse250"/);
});
console.log(`${passed} report v2.11 checks passed`);
