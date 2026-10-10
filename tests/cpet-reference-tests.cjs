"use strict";
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),assert=require("node:assert/strict");
const ctx=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});ctx.window=ctx;
for(const name of ["calc", "fvp","cpet-reference","definitions","tests","scoring", "model","evaluation"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),ctx);
const M=ctx.RingsideModel,E=ctx.RingsideEvaluation,R=ctx.RingsideReferences,json=x=>JSON.parse(JSON.stringify(x));let passed=0;
function test(name,fn){try{fn();passed++;console.log("PASS "+name);}catch(error){console.error("FAIL "+name+"\n"+error.stack);process.exitCode=1;}}
function fixture(){const r=M.defaults();r.athlete.age=25;r.athlete.sex="男";r.athlete.mass=70;r.enabled.cpet=true;Object.assign(r.data.cpet,{modality:"treadmill",vo2:45.4,vo2Unit:"ml/kg/min",rer:1.1});return r;}
test("fixed author reference contains 28 independently cloned P5–P95 tables",()=>{
 const groups=R.cpetReferenceGroups();assert.equal(groups.length,28);R.validateReferenceGroups(groups);
 for(const g of groups){assert.equal(g.ranges.length,20);assert.equal(g.minPeakRER,1.1);assert.equal(g.sourceId,"friend-2022-rer110");assert.equal(g.ranges[0].label,"低于 P5");assert.equal(g.ranges.at(-1).label,"P95 及以上");}
 const rows=groups.filter(g=>g.ageMin===20),mid=g=>g.ranges.find(r=>r.label==="P50–P55").min;
 assert.deepEqual(json(rows.map(mid)),[45.4,35.6,43.6,31.4]);groups[0].ranges[0].max=1;assert.equal(R.cpetReferenceGroups()[0].ranges[0].max,24.8);
});
test("reference matching requires age sex modality and eligible RER without extrapolation",()=>{
 const r=fixture(),g=R.cpetReferenceGroups();assert.equal(R.matchReferenceGroup(r,g).eligible,true);
 for(const age of [18,19.99,90,100,""]){r.athlete.age=age;assert.equal(R.matchReferenceGroup(r,g).group,null);}
 r.athlete.age=29.999;assert.equal(R.matchReferenceGroup(r,g).group.ageMin,20);r.athlete.age=30;assert.equal(R.matchReferenceGroup(r,g).group.ageMin,30);
 r.athlete.sex="未注明";assert.equal(R.matchReferenceGroup(r,g).group,null);r.athlete.sex="女";r.data.cpet.modality="";assert.equal(R.matchReferenceGroup(r,g).group,null);
 r.data.cpet.modality="cycle";for(const rer of ["",1.0999]){r.data.cpet.rer=rer;assert.equal(R.matchReferenceGroup(r,g).eligible,false);}r.data.cpet.rer=1.1;assert.equal(R.matchReferenceGroup(r,g).eligible,true);
});
test("exact percentile cutpoints belong to the next interval with no shared-boundary ambiguity",()=>{
 const r=fixture(),d=E.resolve(r,E.create(r)).definitions.find(d=>d.id==="cpet_vo2_relative");
 assert.equal(M.grade(45.4,d).label,"P50–P55");assert.equal(M.grade(24.8,d).label,"P5–P10");assert.equal(M.grade(62.1,d).label,"P95 及以上");assert.equal(M.grade(24.7,d).label,"低于 P5");assert.equal(M.grade(45.4,d).status,"gray");
});
test("RER eligibility only gates ranges while an enabled independent target remains usable",()=>{
 const r=fixture(),p=E.create(r),rule=p.criteria.definitions.find(d=>d.id==="cpet_vo2_relative");rule.target=50;r.data.cpet.rer="";
 const d=E.resolve(r,p).definitions.find(d=>d.id===rule.id);assert.equal(d.ranges.length,0);assert.equal(d.target,50);assert.equal(d.referenceEnabled,true);assert.equal(d.referenceMatch.eligible,false);assert.equal(M.attainment(45,d),90);
 const group=rule.referenceGroups.find(g=>g.sex==="male"&&g.mode==="treadmill"&&g.ageMin===20);group.target=55;assert.equal(E.resolve(r,p).definitions.find(d=>d.id===rule.id).target,55);
 group.target=null;assert.equal(E.resolve(r,p).definitions.find(d=>d.id===rule.id).target,50);r.athlete.age=18;assert.equal(E.resolve(r,p).definitions.find(d=>d.id===rule.id).target,50);
});
test("same scheme revision re-evaluates both linked records without modifying measurement data",()=>{
 const a=fixture(),b=json(a),before=JSON.stringify([a.data,b.data]),p=E.create(a),rule=p.criteria.definitions.find(d=>d.id==="cpet_vo2_relative");
 const group=rule.referenceGroups.find(g=>g.sex==="male"&&g.mode==="treadmill"&&g.ageMin===20),i=group.ranges.findIndex(r=>r.label==="P50–P55");group.ranges[i].min=46;group.ranges[i-1].max=46;
 for(const r of [a,b])assert.equal(M.grade(45.4,E.resolve(r,p).definitions.find(d=>d.id===rule.id)).label,"P45–P50");assert.equal(JSON.stringify([a.data,b.data]),before);
});
test("table validation rejects selector overlaps invalid endpoints and overlapping ranges",()=>{
 const group=R.cpetReferenceGroups()[0];for(const mutation of [g=>{g.ageMax=g.ageMin;},g=>{g.target=-1;},g=>{g.ranges[1].min=g.ranges[0].max-1;},g=>{g.ranges[0].max=NaN;}]){const g=json(group);mutation(g);assert.throws(()=>R.validateReferenceGroups([g]));}
 assert.throws(()=>R.validateReferenceGroups([group,{...json(group),id:"copy"}]));assert.throws(()=>R.validateReferenceGroups(null));
 const second={...json(group),id:"adjacent",ageMin:30,ageMax:40};assert.equal(R.validateReferenceGroups([group,second]),true);
});
test("profile validation and editor roundtrip retain all source groups",()=>{
 const p=E.create(fixture());E.validateProfile(p);const c=E.fromTemplate(E.template(p),p);assert.deepEqual(json(c.definitions.find(d=>d.id==="cpet_vo2_relative").referenceGroups),json(p.criteria.definitions.find(d=>d.id==="cpet_vo2_relative").referenceGroups));
 c.definitions.find(d=>d.id==="cpet_vo2_relative").referenceGroups[0].ageMin=-1;assert.throws(()=>E.validateProfile({...p,criteria:c}));
});
test("single-record materialization copies only currently effective standards",()=>{
 const r=fixture(),p=E.create(r),before=JSON.stringify(r),out=E.materialize(r,p),d=out.definitions.find(d=>d.id==="cpet_vo2_relative");assert.equal(d.referenceGroups,undefined);assert.equal(d.ranges.length,20);assert.equal(M.grade(45.4,d).label,"P50–P55");assert.equal(JSON.stringify(r),before);M.validateRecord(out);
});
test("old empty factory RSI upgrades while user-edited standards survive",()=>{
 const r=fixture(),old={id:"legacy_factory",name:"旧工厂方案",revision:1,criteria:E.capture(r),isoReferencesVersion:1},d=old.criteria.definitions.find(d=>d.id==="dj_rsi"),custom=old.criteria.definitions.find(d=>d.id==="hop_rsi");Object.assign(d,{target:null,ranges:[],referenceEnabled:false,source:"用户配置评价标准",protocol:"使用实际测试协议与匹配评价标准"});custom.target=7;custom.source="我的标准";
 old.criteria.definitions=old.criteria.definitions.filter(d=>d.testId!=="cpet");const lib={evaluationProfiles:[old]};assert.equal(E.upgradeLibraryProfiles(lib),true);const p=lib.evaluationProfiles[0];assert.equal(p.formatVersion,2);assert.equal(p.standards.find(d=>d.id==="metric:dj_rsi").enabled,true);assert.equal(p.standards.find(d=>d.id==="metric:hop_rsi").target,7);assert.equal(p.standards.find(d=>d.id==="metric:hop_rsi").source,"我的标准");assert.equal(p.standards.find(d=>d.id==="metric:cpet_vo2_relative").referenceGroups.length,28);assert.equal(p.previous.standards.find(d=>d.id==="metric:dj_rsi").enabled,false);const rev=p.revision;assert.equal(E.upgradeLibraryProfiles(lib),false);assert.equal(p.revision,rev);E.validateProfile(p);p.standards=[];assert.equal(E.upgradeLibraryProfiles(lib),false);assert.equal(p.standards.length,0);
});
test("paired DJ/Hop standards require both measurement protocols to match",()=>{
 const r=fixture();r.enabled.dj=true;r.enabled.hop=true;r.protocol.dj="45 cm three-trial mean";r.protocol.hop="ten jumps best five FT/CT";
 const d=r.definitions.find(d=>d.id==="rqr");assert.ok(d);d.referenceEnabled=true;d.ranges=[{min:1,max:null,label:"自定义标准",status:"green"}];const p=E.create(r);
 assert.equal(E.resolve(r,p).definitions.find(d=>d.id==="rqr").referenceEnabled,true);assert.equal(E.template(p).protocol.hop,r.protocol.hop);
 r.protocol.hop="five-jump mean";r.protocolIdentities.hop.version++;const resolved=E.resolve(r,p).definitions.find(d=>d.id==="rqr");assert.equal(resolved.referenceEnabled,false);assert.equal(resolved.ranges.length,0);
});
test("precise factory aliases migrate independently of grades and preserve custom and rollback text",()=>{
 const r=fixture(),p={id:"legacy_alias",name:"旧方案",revision:1,criteria:E.capture(r),isoReferencesVersion:1,builtinStandardsVersion:1};
 const d=p.criteria.definitions.find(d=>d.id==="cmj_height");d.name="CMJ 跳高";d.protocol=ctx.Def.factoryText(d.id,"protocol",d.protocol,true);d.context.metricProtocol=d.protocol;d.target=77;
 const dj=p.criteria.definitions.find(d=>d.id==="dj_height");dj.context.protocol=ctx.Def.factoryText("dj","testProtocol",dj.context.protocol,true);dj.target=44;dj.referenceEnabled=true;
 const custom=p.criteria.definitions.find(d=>d.id==="sj_height");custom.name="SJ 跳高（队内命名）";
 const manual=p.criteria.definitions.find(d=>d.id==="hop_height");manual.legacyManual=true;manual.name="HOP 反弹跳高";
 p.previous={name:p.name,criteria:json(p.criteria),revision:p.revision,updated:p.updated};const previous=JSON.stringify(p.previous),revision=p.revision;
 assert.equal(E.resolve(r,p).definitions.find(d=>d.id==="dj_height").target,44);
 const lib={evaluationProfiles:[p]};assert.equal(E.upgradeLibraryProfiles(lib),true);assert.equal(d.name,"CMJ 垂直跳跃高度");assert.equal(d.protocol.includes("跳高"),false);assert.equal(d.target,77);assert.equal(p.revision,revision);assert.equal(JSON.stringify(p.previous),previous);assert.equal(custom.name,"SJ 跳高（队内命名）");assert.equal(manual.name,"HOP 反弹跳高");
 assert.equal(E.template({...p,criteria:p.previous.criteria}).definitions.find(d=>d.id==="cmj_height").name,M.defaults().definitions.find(d=>d.id==="cmj_height").name);assert.equal(JSON.stringify(p.previous),previous);assert.equal(E.upgradeLibraryProfiles(lib),false);
 assert.equal(lib.evaluationProfiles[0].previous.standards.find(d=>d.id==="metric:cmj_height").target,77);assert.equal(JSON.stringify(lib.evaluationProfiles[0]).includes('"criteria":'),false);
});
console.log(passed+" CPET reference and shared-standard checks passed");
