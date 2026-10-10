"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict"),path=require("node:path");
const ctx=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});ctx.window=ctx;
for(const name of ["calc","fvp","cpet-reference","iso-reference","definitions","tests","scoring", "model","evaluation"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),ctx);
const M=ctx.RingsideModel,copy=x=>JSON.parse(JSON.stringify(x));let passed=0;
const test=(label,fn)=>{fn();passed++;console.log("PASS "+label);};
const derived=(r,id)=>M.stats(r).derived.results.find(x=>x.id===id);
const card=(r,id)=>M.stats(r).capabilityCards.find(x=>x.id===id);
function jumps(){const r=M.defaults();r.enabled.cmj=r.enabled.sj=true;r.data.sj=[{id:"sj",height:40}];r.data.cmj=[{id:"cmj",height:44,force:1200}];return r;}
function speeds(){const r=M.defaults();r.enabled.mas=r.enabled.mss=true;r.data.mas.speed=5;r.data.mss.speed=8.5;for(const id of ["mas_speed","mss_speed"])r.definitions.find(x=>x.id===id).referenceEnabled=false;return r;}
test("EUR preserves source values without an unsupported universal 1.1 direction threshold",()=>{
 const r=jumps();for(const height of [43.99999,44,44.00001]){r.data.cmj[0].height=height;const value=derived(r,"eur");assert.equal(value.value,height/40);assert.match(value.directionHint,/单凭 EUR 高低不能确定训练优先级/);assert.doesNotMatch(value.directionHint,/发展 SSC|发展纯向心/);}
});
test("FMS normalization only removes irrelevant empty side fields and preserves every entered score",()=>{
 const r=M.defaults(),single=r.data.fms.find(x=>x.name==="深蹲");Object.assign(single,{score:2,left:0,right:1,l:"",r:null,notes:"保留原始分数"});const next=M.normalizeRecord(copy(r)),row=next.data.fms.find(x=>x.name==="深蹲");assert.equal(row.score,2);assert.equal(row.left,0);assert.equal(row.right,1);assert.equal(row.notes,"保留原始分数");assert.equal(Object.hasOwn(row,"l"),false);assert.equal(Object.hasOwn(row,"r"),false);assert.equal(ctx.Calc.fms([row]).scores[0],2);
});
test("DSI includes both .60 and .80 in parallel development",()=>{
 const r=jumps();Object.assign(r.dsi,{source:"manual",force:2000,unit:"N",confirmed:true});r.cmjConfig.definition="gross";r.dsi.definition="gross";
 for(const [force,expected] of [[1199.999,"发展弹道与快速力量"],[1200,"并行发展最大力量与快速力量"],[1600,"并行发展最大力量与快速力量"],[1600.001,"发展最大力量"]]){r.data.cmj[0].force=force;assert.equal(derived(r,"fdsi").directionHint,expected);}
});
test("MSS and MAS goals take precedence over SRR structural typing",()=>{
 const r=speeds(),mss=r.definitions.find(x=>x.id==="mss_speed"),mas=r.definitions.find(x=>x.id==="mas_speed");
 Object.assign(mss,{referenceEnabled:true,target:9});Object.assign(mas,{referenceEnabled:true,target:5});assert.equal(card(r,"speed").conclusion,"优先发展冲刺速度（MSS）。");
 mas.target=6;assert.equal(card(r,"speed").conclusion,"并行发展冲刺速度（MSS）与有氧速度（MAS）。");mss.target=8;assert.equal(card(r,"speed").conclusion,"优先发展有氧速度（MAS）。");mas.target=5;assert.match(card(r,"speed").conclusion,/均?已达到/);
 assert.equal(derived(r,"srr").directionHint,card(r,"speed").conclusion);assert.equal(card(r,"speed").metrics.find(x=>x.id==="mas_speed").attainment,100);
});
test("SRR fallback preserves 1.7 and 1.8 boundaries and ignores unusable goals",()=>{
 const r=speeds();for(const [ratio,label] of [[1.699,"耐力型结构 · 速度储备相对较小"],[1.7,"混合型结构 · 速度储备居中"],[1.8,"混合型结构 · 速度储备居中"],[1.801,"速度型结构 · 速度储备相对较大"]]){r.data.mss.speed=ratio*5;assert.equal(card(r,"speed").conclusion,label);}
 Object.assign(r.definitions.find(x=>x.id==="mss_speed"),{referenceEnabled:true,target:0});assert.equal(card(r,"speed").conclusion,"速度型结构 · 速度储备相对较大");
});
test("partial and inconsistent speed measurements remain visible",()=>{
 const r=speeds();r.enabled.mas=false;let c=card(r,"speed");assert.equal(c.metrics.length,1);assert.equal(c.metrics[0].label,"MSS");r.enabled.mas=true;r.data.mss.speed=4;c=card(r,"speed");assert.match(c.conclusion,/核对/);assert.equal(c.metrics.filter(x=>["MSS","MAS"].includes(x.label)).length,2);assert.ok(!c.metrics.some(x=>x.id==="srr"));
});
test("partial CPET retains an independently usable oxygen goal",()=>{
 const r=M.defaults();r.enabled.cpet=true;r.data.cpet={...M.cpetDefaults(),vo2:50,vo2Unit:"ml/kg/min"};Object.assign(r.definitions.find(x=>x.id==="cpet_vo2_relative"),{referenceEnabled:true,target:60});r.definitions.find(x=>x.id==="cpet_threshold2_pct").target=null;assert.equal(card(r,"cardio").conclusion,"优先提高 VO₂peak。");assert.equal(card(r,"cardio").targets.length,1);
});
test("SJ and CMJ response flags preserve all eight independent combinations",()=>{
 for(let mask=0;mask<8;mask++){const r=M.defaults();for(const [i,key] of ["responseForce","responseVelocity","responseBoth"].entries()){r.fvpView.fvp_sj[key]=!!(mask&(1<<i));r.fvpView.fvp_cmj[key]=!!((7-mask)&(1<<i));}const next=M.normalizeRecord(copy(r));M.validateRecord(next);for(const id of ["fvp_sj","fvp_cmj"])for(const key of ["responseForce","responseVelocity","responseBoth"])assert.equal(next.fvpView[id][key],r.fvpView[id][key]);}
 const old=M.defaults();for(const id of ["fvp_sj","fvp_cmj"])for(const key of ["responseForce","responseVelocity","responseBoth"])delete old.fvpView[id][key];const next=M.normalizeRecord(old);assert.equal(next.fvpView.fvp_sj.responseBoth,true);const bad=copy(next);bad.fvpView.fvp_cmj.responseBoth="false";assert.throws(()=>M.validateRecord(bad),/图层/);
});
console.log(`${passed} direction model checks passed`);
