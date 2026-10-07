"use strict";
// Explicitly simulated, reusable display data; never writes a user's browser library.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/demo");
const context=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});context.window=context;
for(const name of ["calc","definitions","tests","model","interventions"])vm.runInContext(fs.readFileSync(path.join(root,`src/ringside-${name}.js`),"utf8"),context);
const M=context.RingsideModel,r=M.sampleRecord(),round=x=>Math.round(x*1000)/1000;
r.athleteId="demo-triples-athlete";r.recordId="demo-triples-20261007";r.mode="best";
Object.assign(r.athlete,{name:"三次重复演示（模拟数据）",date:"2026-10-07",notes:"本记录全部为模拟数据，用于查看重复测量报告效果。"});
r.trainingContext={experienceYears:3,weeklySessions:2,equipment:"杠铃、哑铃、药球、跑道",weeklySchedule:"周一、周四体能；周二、周五专项（演示）"};
r.data.cmj=[38,40,42].map((height,i)=>({id:"demo-cmj-"+i,height,force:[1680,1745,1800][i],rsiModified:[.40,.42,.45][i],landingPeakForce:[2450,2540,2620][i],notes:i===2?"动作完成稳定":""}));
r.data.sj=[34,35.5,36.2].map((height,i)=>({id:"demo-sj-"+i,height,force:[1600,1620,1650][i],rsiModified:[.31,.32,.34][i],landingPeakForce:[2370,2390,2450][i]}));
r.data.imtp=[2700,2820,2790].map((peakForce,i)=>({id:"demo-imtp-"+i,peakForce,baselineForce:100,peakTimeMs:450+i*10,timePoints:[100,200,300].map((timeMs,j)=>{const force=[[850,900,870],[1550,1640,1590],[2150,2270,2210]][j][i];return {id:`demo-imtp-${i}-${timeMs}`,timeMs,force,rfd:(force-100)*1000/timeMs};})}));
const iso={neck:{flexion:[192,200],extension:[248,260],lateralFlexion:[154,166,170]},shoulder:{internalRotation:[252,267,280],externalRotation:[183,205,210]},hip:{flexion:[392,414,430],extension:[506,523,540],abduction:[310,322,340],adduction:[346,361,380]},knee:{extension:[545,568,600],flexion:[314,337,360]},ankle:{dorsiflexion:[190,214,220],plantarflexion:[670,706,740]}};
for(const row of r.data.iso){const base=iso[row.region]?.[row.directionCode];if(!base)continue;row.target=base.at(-1);row.notes="同一固定姿势，组间充分休息";row.trials=[.97,1.02,1].map((factor,i)=>({id:row.id+"-demo-"+i,...(row.paired?{left:round(base[0]*factor),right:round(base[1]*[.98,1.01,1][i])}:{center:round(base[0]*factor)}),notes:""}));}
for(const id of ["bench","squat","deadlift","landmine"]){r.data[id]=r.data[id].flatMap((row,index)=>[-.03,.01,.02].map((delta,i)=>({...row,id:`demo-${id}-${index}-${i}`,velocity:round(row.velocity+delta),notes:""})));}
r.data.mb=["D","ND"].flatMap(side=>(side==="D"?[11.2,11.7,11.5]:[10.2,10.6,10.4]).map((distance,i)=>({id:`demo-ball-${side}-${i}`,side,distance})));
r.data.pushup={...r.data.pushup,trials:[64,66,65].map((reps,i)=>({id:"demo-pushup-"+i,reps}))};
for(const [id,values] of [["mas",[4.7,4.8,4.75]],["mss",[8.2,8.35,8.3]],["ift",[5.9,6,6.1]]])r.data[id]={...r.data[id],...(id==="ift"?{protocol:"shuttle",partial:""}:{}),trials:values.map((speed,i)=>({id:`demo-${id}-${i}`,speed,unit:"m/s"}))};
const testId="custom_change_direction";
r.customTests.push({id:testId,name:"三点变向跑",category:"performance",primaryMetricId:"demo_time"});r.enabled[testId]=true;
for(const [id,name,unit,direction,cvEligible,values] of [["demo_time","完成时间","s","lower",true,[6.38,6.22,6.31]],["demo_steps","触地次数","次","lower",true,[15,14,15]],["demo_quality","动作评分","分","higher",false,[8,9,8]]]){
 r.definitions.push({id,testId,name,unit,direction,cvEligible,entryScope:"attempt",category:"performance",ability:"变向能力",ranges:[],target:null,referenceEnabled:false});
 r.data[testId] ||= [0,1,2].map(i=>({id:"demo-agility-"+i,metrics:{},notes:""}));r.data[testId].forEach((row,i)=>row.metrics[id]=values[i]);
}
r.protocol[testId]="同一距离、转向路线与计时方法";
const normalized=M.normalizeRecord(r);
normalized.narrative={text:"本报告为模拟数据演示，用于查看各测试的三次重复结果、统计与原始记录。",html:"<p>本报告为模拟数据演示，用于查看各测试的三次重复结果、统计与原始记录。</p>",origin:"manual",revision:1,basis:M.fingerprint(normalized)};
M.validateRecord(normalized);
const s=M.stats(normalized),groups=s.repetitions.filter(g=>g.attempts.length);
assert.ok(groups.length>30);assert.ok(groups.every(g=>g.attempts.length===3));assert.ok(groups.every(g=>g.statistics.every(m=>m.n===3)));
assert.equal(s.values.cmj_height,42);assert.equal(s.values.demo_time,6.22);
const old=M.stats({...normalized,mode:"mean"});assert.equal(old.values.cmj_height,40);assert.deepEqual(groups.map(g=>g.statistics),old.repetitions.filter(g=>g.attempts.length).map(g=>g.statistics));
fs.mkdirSync(out,{recursive:true});
const file=path.join(out,"三次重复演示.json");fs.writeFileSync(file,JSON.stringify({schema:2,kind:"report",record:normalized},null,2));
fs.writeFileSync(path.join(out,"data-summary.json"),JSON.stringify({simulated:true,recordId:normalized.recordId,tests:[...new Set(groups.map(g=>g.testId))],groups:groups.length,statistics:groups.reduce((n,g)=>n+g.statistics.length,0),observations:groups.reduce((n,g)=>n+g.attempts.length,0)},null,2));
console.log("Created simulated data:",groups.length,"groups, each with exactly 3 valid attempts",file);
