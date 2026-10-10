"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict"),path=require("node:path"),{execFileSync}=require("node:child_process");
const ctx=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});ctx.window=ctx;
for(const name of ["calc", "fvp","cpet-reference","definitions","tests","model","evaluation","interventions"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),ctx);
const M=ctx.RingsideModel,E=ctx.RingsideEvaluation,copy=x=>JSON.parse(JSON.stringify(x));let passed=0;
const near=(a,b)=>assert.ok(a!==null&&Math.abs(a-b)<1e-8,`${a} != ${b}`);
const card=(r,id)=>M.stats(r).capabilityCards.find(c=>c.id===id), metric=(r,id)=>M.stats(r).capabilityCards.flatMap(c=>c.metrics).find(m=>m.id===id);
const test=(name,fn)=>{fn();passed++;console.log("PASS "+name);};
function cpet(){const r=M.defaults();r.enabled.cpet=true;r.athlete.mass=70;r.data.cpet={...M.cpetDefaults(),modality:"treadmill",vo2:60,peakHr:190,rer:1.15};return r;}
test("native CPET is selectable, retains labels and validates explicit units",()=>{
 const r=cpet();M.validateRecord(r);assert.equal(ctx.RingsideTests.describe(r).find(t=>t.id==="cpet").renderer,"cpet");assert.equal(M.normalizeCatalog().tests.find(t=>t.id==="cpet").measurementVersion,1);
 const oldCatalog=M.normalizeCatalog();delete oldCatalog.capabilityVersion;oldCatalog.tests=oldCatalog.tests.filter(t=>t.id!=="cpet");oldCatalog.definitions=oldCatalog.definitions.filter(d=>d.testId!=="cpet"&&!d.id.endsWith("_active_stiffness")&&d.id!=="rqr");const once=M.normalizeCatalog(oldCatalog),twice=M.normalizeCatalog(once);assert.equal(twice.definitions.find(d=>d.id==="cpet_vo2_relative").legacyManual,undefined);assert.equal(twice.capabilityVersion,1);
 for(const [path,value] of [["data.cpet.vo2",0],["data.cpet.rer",-1],["data.cpet.thresholds.first.hr","wrong"]])assert.ok(M.validateField(r,path,value));
 const bad=copy(r);bad.data.cpet.vo2Unit="estimated";assert.throws(()=>M.validateRecord(bad),/CPET/);
});
test("CPET conversion uses body mass, and equal absolute units need no mass for ratios",()=>{
 const r=cpet();r.data.cpet.vo2=4.2;r.data.cpet.vo2Unit="l/min";Object.assign(r.data.cpet.thresholds.second,{label:"LT2",vo2:3.5,vo2Unit:"l/min",hr:170});
 near(M.stats(r).values.cpet_vo2_relative,60);near(M.stats(r).values.cpet_threshold2_pct,100*3.5/4.2);assert.match(metric(r,"cpet_threshold2_pct").label,/LT2/);
 r.athlete.mass="";assert.equal(M.stats(r).values.cpet_vo2_relative,undefined);near(M.stats(r).values.cpet_threshold2_pct,100*3.5/4.2);assert.equal(metric(r,"cpet_vo2_absolute").label,"VO₂peak");
 r.data.cpet.thresholds.second.vo2Unit="ml/kg/min";assert.equal(M.stats(r).values.cpet_threshold2_pct,undefined);
});
test("heart rate, speed and power never infer oxygen consumption",()=>{
 const r=cpet();r.data.cpet.vo2="";Object.assign(r.data.cpet.thresholds.second,{hr:175,speed:4.8});
 const s=M.stats(r);assert.equal(s.values.cpet_vo2_relative,undefined);assert.equal(s.values.cpet_threshold2_pct,undefined);assert.equal(card(r,"cardio").conclusion,"");assert.equal(metric(r,"cpet_peak_hr").value,190);assert.equal(metric(r,"cpet_threshold2_hr").value,175);
 r.data.cpet.modality="cycle";r.data.cpet.thresholds.second.power=250;assert.equal(M.stats(r).values.cpet_threshold2_speed,undefined);assert.equal(M.stats(r).values.cpet_threshold2_power,250);
});
test("impossible threshold order and above-peak values do not yield percentage judgments",()=>{
 const r=cpet();r.data.cpet.thresholds.first.vo2=52;r.data.cpet.thresholds.second.vo2=50;assert.equal(M.stats(r).values.cpet_threshold2_pct,undefined);assert.ok(M.stats(r).qualityIssues.some(i=>i.id==="cpet_threshold_order"));
 r.data.cpet.thresholds.first.vo2="";r.data.cpet.thresholds.second.vo2=61;assert.equal(M.stats(r).values.cpet_threshold2_pct,undefined);assert.ok(M.stats(r).qualityIssues.some(i=>i.id==="cpet_threshold2_above_peak"));
});
test("cardio four branches use explicit targets and original threshold label",()=>{
 const r=cpet();r.definitions.find(d=>d.id==="cpet_vo2_relative").target=60;Object.assign(r.definitions.find(d=>d.id==="cpet_threshold2_pct"),{referenceEnabled:true,target:85});r.data.cpet.thresholds.second.label="LT2";
 for(const [peak,pct,expected] of [[50,90,"优先提高 VO₂peak。"],[65,80,"优先提高 LT2。"],[50,80,"同步提高 VO₂peak 与 LT2。"],[65,90,"均达到"]]){r.data.cpet.vo2=peak;r.data.cpet.thresholds.second.vo2=peak*pct/100;assert.ok(card(r,"cardio").conclusion.includes(expected));}
 r.data.cpet.rer=1;const resolved=E.resolve(r,E.create(r));assert.match(card(resolved,"cardio").conclusion,/均达到/);r.definitions.find(d=>d.id==="cpet_threshold2_pct").target=null;assert.equal(card(r,"cardio").conclusion,"VO₂peak 均达到当前目标，保持并巩固。");
});
test("partial CPET and percentage components retain their independent configured judgments",()=>{
 const r=cpet();r.data.cpet.vo2="";Object.assign(r.data.cpet.thresholds.first,{vo2:40,hr:145,speed:3.5});
 const configure=id=>Object.assign(r.definitions.find(d=>d.id===id),{referenceEnabled:true,ranges:ctx.Def.parseRanges(">=0 | 独立评价 | green")});
 configure("cpet_threshold1_vo2_relative");configure("cpet_threshold1_hr");configure("cpet_threshold1_speed");
 let m=metric(r,"cpet_threshold1_vo2_relative");assert.equal(m.judgment,"独立评价");assert.equal(m.components.find(c=>c.id==="cpet_threshold1_hr").judgment,"独立评价");assert.equal(m.components.find(c=>c.id==="cpet_threshold1_speed").status,"green");assert.equal(card(r,"cardio").conclusion,"");
 r.data.cpet.vo2=60;configure("cpet_peak_hr");configure("cpet_vo2_absolute");configure("cpet_threshold1_vo2_absolute");m=metric(r,"cpet_threshold1_pct");assert.equal(m.judgment,"");assert.equal(m.components.find(c=>c.id==="cpet_threshold1_vo2_relative").judgment,"独立评价");assert.equal(m.components.find(c=>c.id==="cpet_threshold1_vo2_absolute").judgment,"独立评价");assert.equal(metric(r,"cpet_vo2_relative").components.find(c=>c.id==="cpet_peak_hr").judgment,"独立评价");assert.equal(metric(r,"cpet_vo2_relative").components.find(c=>c.id==="cpet_vo2_absolute").judgment,"独立评价");
 r.data.cpet.modality="cycle";r.data.cpet.thresholds.first.power=200;configure("cpet_threshold1_power");m=metric(r,"cpet_threshold1_pct");assert.equal(m.components.find(c=>c.id==="cpet_threshold1_power").judgment,"独立评价");assert.equal(m.components.some(c=>c.id==="cpet_threshold1_speed"),false);
 r.definitions.find(d=>d.id==="cpet_threshold1_hr").referenceEnabled=false;assert.equal(metric(r,"cpet_threshold1_pct").components.find(c=>c.id==="cpet_threshold1_hr").judgment,"");
});
test("all approved RSI boundaries are explicit and nonoverlapping",()=>{
 for(const id of ["dj_rsi","hop_rsi","cmrj_rsi"]){const d=M.defaults().definitions.find(d=>d.id===id);for(const [n,label] of [[1.49,"较差"],[1.5,"中等"],[1.9999,"中等"],[2,"良好"],[2.5,"良好"],[2.5001,"优秀"]])assert.equal(M.grade(n,d).label,label);}
 for(const id of ["cmj_rsi_modified","sj_rsi_modified","cmrj_first_rsi_modified"]){const d=M.defaults().definitions.find(d=>d.id===id);for(const [n,label] of [[.3499,"较差"],[.35,"一般"],[.4999,"一般"],[.5,"良好"],[.65,"良好"],[.6501,"优秀"]])assert.equal(M.grade(n,d).label,label);}
});
test("device Active Stiffness is usable by itself and Hop keeps one whole-set result",()=>{
 const r=M.defaults();r.enabled.dj=r.enabled.hop=r.enabled.cmrj=true;r.data.dj=[{...M.newJumpAttempt("dj"),activeStiffness:29}];r.data.cmrj=[{...M.newJumpAttempt("cmrj"),activeStiffness:28}];const h=M.newHopSet();h.inputMode="jumps";h.summary.activeStiffness=31;h.jumps=[{id:"jump",height:20,contactTimeMs:100,activeStiffness:900}];r.data.hop={trials:[h]};
 assert.equal(metric(r,"dj_active_stiffness").value,29);assert.equal(metric(r,"cmrj_active_stiffness").value,28);assert.equal(metric(r,"hop_active_stiffness").value,31);assert.equal(metric(r,"hop_active_stiffness").judgment,"");
 h.jumps=[];r.data.hop={trials:[h]};assert.equal(metric(r,"hop_active_stiffness").value,31);
});
test("independent RSI-modified can be reported without a rebound or optional height",()=>{
 const r=M.defaults();r.enabled.cmj=r.enabled.cmrj=true;r.data.cmj=[{...M.newJumpAttempt("cmj"),rsiModified:.55}];r.data.cmrj=[{...M.newJumpAttempt("cmrj"),firstHeight:36,firstTimeToTakeoffMs:600}];assert.equal(metric(r,"cmj_rsi_modified").value,.55);near(metric(r,"cmrj_first_rsi_modified").value,.6);assert.equal(metric(r,"cmrj_rsi"),undefined);
});
test("cards hide absent data, preserve lactate-only speeds and suppress inconsistent speed typing",()=>{
 const r=M.defaults();assert.equal(M.stats(r).capabilityCards.length,0);r.enabled.lactate=true;r.thresholds.lt1=3.5;r.thresholds.lt2=4.5;assert.equal(metric(r,"lt1").value,3.5);assert.equal(metric(r,"lt2").value,4.5);
 r.enabled.mas=r.enabled.mss=true;r.data.mas.speed=5;r.data.mss.speed=4;assert.equal(card(r,"speed").metrics.length,2);assert.match(card(r,"speed").conclusion,/核对/);assert.ok(M.stats(r).qualityIssues.some(i=>i.id==="asr_inconsistent"));
 for(const [ratio,label] of [[1.69,"耐力型"],[1.7,"混合型"],[1.8,"混合型"],[1.81,"速度型"]]){r.data.mss.speed=5*ratio;assert.equal(metric(r,"srr").judgment,label);}
});
test("iDSI displays an available window without mutating saved preference",()=>{
 const r=M.sampleRecord();r.views.idsiWindow="idsi_matched";r.data.imtp[0].matchedImpulse="";assert.equal(metric(r,"idsi").selectedVariant,"idsi_fixed250");assert.equal(r.views.idsiWindow,"idsi_matched");r.data.imtp[0].impulse250="";assert.equal(metric(r,"idsi"),undefined);
});
test("factory demo migration fills four cards and protects IDs, measurements and handwritten text",()=>{
 const old=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});old.window=old;for(const n of ["calc","definitions","tests","model","interventions"])vm.runInContext(execFileSync("git",["show",`v2.11.0:src/ringside-${n}.js`],{encoding:"utf8"}),old);
 const original=copy(old.RingsideModel.sampleRecord()),up=M.upgradeOriginalDemo(original);assert.equal(up.changed,true);assert.equal(up.record.recordId,original.recordId);assert.equal(up.record.athleteId,original.athleteId);assert.deepEqual(copy(up.record.data.cmj.map(r=>[r.id,r.height,r.force])),original.data.cmj.map(r=>[r.id,r.height,r.force]));assert.equal(M.stats(up.record).capabilityCards.length,4);assert.equal(M.upgradeOriginalDemo(up.record).changed,false);M.validateRecord(up.record);
 for(const change of [r=>r.data.cmj[0].height++,r=>r.athlete.mass++,r=>r.narrative.html="手写",r=>r.narrative.summary="手写",r=>r.enabled.cmj=false,r=>r.protocol.cmj+="改",r=>r.definitions.find(d=>d.id==="cmj_height").target=100]){const r=copy(original);change(r);assert.equal(M.upgradeOriginalDemo(r).changed,false);}
 const normalized=M.normalizeRecord(original),profile=E.create(normalized);assert.equal(M.upgradeOriginalDemo(normalized,profile).changed,true);profile.criteria.definitions.find(d=>d.id==="cmj_height").target=100;assert.equal(M.upgradeOriginalDemo(normalized,profile).changed,false);
 const r=M.sampleRecord();assert.equal(M.stats(r).capabilityCards.length,4);near(M.stats(r).raw.eur,44.2/40.8);assert.equal(r.athlete.mass,68.5);assert.equal(M.stats(r).cardio.id,"cardio");
});
test("historical custom CPET IDs and colliding metric IDs stay manual scalar data",()=>{
 const old=M.defaults();delete old.capabilityVersion;delete old.data.cpet;old.customTests=[{id:"cpet",name:"旧自定义心肺测试",category:"performance"}];old.enabled.cpet=true;old.definitions=old.definitions.filter(d=>d.testId!=="cpet");old.definitions.push({id:"cpet_vo2_relative",testId:"cpet",name:"旧评分",unit:"分",direction:"higher",ranges:[],category:"performance",ability:"自定义",entryScope:"attempt"});old.data.cpet=[{id:"oldtrial",metrics:{cpet_vo2_relative:17}}];
 const r=M.normalizeRecord(old);assert.equal(ctx.RingsideTests.describe(r).find(t=>t.id==="cpet").renderer,"scalar");assert.equal(M.stats(r).raw.cpet,undefined);assert.equal(M.stats(r).values.cpet_vo2_relative,17);assert.equal(r.definitions.filter(d=>d.testId==="cpet").length,1);M.validateRecord(r);
 const cat=M.normalizeCatalog();delete cat.capabilityVersion;cat.tests=cat.tests.filter(t=>t.id!=="cpet");cat.tests.push({id:"cpet",name:"旧自定义心肺测试",category:"performance"});cat.definitions=copy(old.definitions);const migrated=M.normalizeCatalog(cat);assert.equal(ctx.RingsideTests.describe(migrated).find(t=>t.id==="cpet").renderer,"scalar");assert.equal(migrated.definitions.filter(d=>d.testId==="cpet").length,1);
});
test("exact factory jump wording migrates without changing historical fingerprints or authored text",()=>{
 for(const tag of ["v2.10.0","v2.11.0"]){
  const old=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});old.window=old;for(const n of ["calc","definitions","tests","model","interventions"])vm.runInContext(execFileSync("git",["show",`${tag}:src/ringside-${n}.js`],{encoding:"utf8"}),old);
  const original=copy(old.RingsideModel.normalizeRecord(old.RingsideModel.sampleRecord())),basis=old.RingsideModel.fingerprint(original),r=M.normalizeRecord(original);
  assert.equal(M.fingerprint(r),basis);assert.ok(r.definitions.every(d=>!String(d.name||"").includes("跳高")&&!String(d.protocol||"").includes("跳高")));assert.ok(!Object.values(r.protocol).some(p=>p.includes("跳高")));
  const catalog=M.normalizeCatalog({tests:copy(original.projectSnapshots),definitions:copy(original.definitions),protocol:copy(original.protocol),...(original.derivedEnabled?{derivedEnabled:copy(original.derivedEnabled)}:{})});assert.ok(catalog.definitions.every(d=>!String(d.name||"").includes("跳高")&&!String(d.protocol||"").includes("跳高")));assert.ok(!Object.values(catalog.protocol).some(p=>p.includes("跳高")));
  const authored=copy(original);Object.assign(authored.definitions.find(d=>d.id==="cmj_height"),{name:"个人跳高备注",protocol:"自己填写的跳高协议"});authored.protocol.dj="个人设备的跳高说明";const result=M.normalizeRecord(authored);assert.equal(result.definitions.find(d=>d.id==="cmj_height").name,"个人跳高备注");assert.equal(result.definitions.find(d=>d.id==="cmj_height").protocol,"自己填写的跳高协议");assert.equal(result.protocol.dj,"个人设备的跳高说明");
 }
 assert.equal(ctx.Def.factoryText("other_metric","name","DJ 反弹跳高"),"DJ 反弹跳高");assert.equal(ctx.Def.factoryText("dj_height","name","DJ 反弹跳高 自定义"),"DJ 反弹跳高 自定义");
});
console.log(`${passed} capability and CPET model checks passed`);

