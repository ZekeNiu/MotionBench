"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict");
const context=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});context.window=context;
for(const name of ["calc","definitions","tests","model","evaluation","interventions","viz","report"])vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`,"utf8"),context);
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
 for(const id of ["dj_rsi","hop_rsi","cmrj_rsi","cmrj_first_height","cmrj_first_rsi_modified","dj_drop_height"])assert.match(html,new RegExp(`data-metric-id="${id}"`));
 assert.doesNotMatch(html,/<title/);
});
test("Hop details retain excluded hops and counts without inventing independent repeats",()=>{
 const report=R.build(fixture()),html=R.render(report);assert.equal(report.stats.raw.hop.row.height,40);assert.equal(report.stats.raw.hop.row.rsi,4);
 assert.match(html,/录入 6 跳 · 有效 6 跳 · 选取 5 跳/);assert.match(html,/未选原始跳次/);assert.match(html,/原始整组备注/);
 const group=report.stats.repetitions.find(g=>g.testId==="hop");assert.ok(group);assert.ok(group.statistics.every(metric=>metric.n<=1));assert.doesNotMatch(html,/均值 ± SD/);
});
test("three independent Hop sets enable statistics while preserving every set",()=>{
 const r=fixture(),set=JSON.parse(JSON.stringify(r.data.hop));r.data.hop.trials=[0,1,2].map(i=>({...JSON.parse(JSON.stringify(set)),id:"set"+i}));
 const report=R.build(r),html=R.render(report),group=report.stats.repetitions.find(g=>g.testId==="hop");
 assert.equal(group.statistics.find(metric=>metric.id==="hop_rsi").n,3);assert.match(html,/均值 ± SD/);assert.match(html,/3 组测试及逐跳记录/);
});
test("derived presentation shows components, unavailable reasons, and inclusive fDSI middle band",()=>{
 for(const value of [.59,.6,.8,.81]){
  const report=R.build(fixture());report.derived={results:[{id:"fdsi",name:"DSI / fDSI",unit:"比值",value,available:true,formula:"CMJ PF / IMTP PF",components:[{label:"CMJ PF",value:1500,unit:"N"},{label:"IMTP PF",value:2500,unit:"N"}],protocol:"净力",directionHint:"结合力量与跳跃结果",sourceIds:[]},{id:"eur",name:"EUR",available:false,value:null,reason:"SJ 缺测"}]};
  const html=R.render(report);assert.match(html,/CMJ PF/);assert.match(html,/2,500\.000/);assert.match(html,/SJ 缺测/);
  const current=html.match(/<span class="current" aria-current="true">([^<]+)/)?.[1];assert.equal(current,value<.6?"＜0.60":value>.8?"＞0.80":"0.60–0.80");
 }
});
test("EUR combines gain without duplicating speed analysis and gain survives its own enabled state",()=>{
 const r=fixture(),report=R.build(r),html=R.render(report);assert.match(html,/data-derived-associated="gain"/);assert.doesNotMatch(html,/data-derived-result="(?:gain|asr|srr)"/);
 r.derivedEnabled.eur=false;assert.match(R.render(R.build(r)),/data-derived-result="gain"/);
});
test("recorded IMTP impulses remain in its results table and retain true repeat statistics",()=>{
 const r=fixture();r.enabled.imtp=true;r.data.imtp=[0,1,2].map(i=>({id:"impulse"+i,peakForce:2800+i*50,impulse250:300+i*10,matchedImpulse:400+i*10,matchedDurationMs:300}));
 const html=R.render(R.build(r));for(const id of ["imtp_impulse250","imtp_matched_impulse","imtp_matched_duration"])assert.match(html,new RegExp(`data-metric-id="${id}"`));
 assert.match(html,/data-repeat-stat="imtp_impulse250"/);
});
console.log(`${passed} report v2.11 checks passed`);
