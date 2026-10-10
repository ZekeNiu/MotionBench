"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const c=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});c.window=c;
for(const name of ["calc","fvp","cpet-reference","iso-reference","definitions","tests","model","evaluation","interventions","viz","report"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const M=c.RingsideModel,E=c.RingsideEvaluation,I=c.RingsideIsoReferences,R=c.RingsideReport,copy=v=>JSON.parse(JSON.stringify(v));
let passed=0;const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function test(name,fn){try{fn();passed++;console.log("PASS "+name);}catch(error){console.error("FAIL "+name+"\n"+error.stack);process.exit(1);}}
const row=(r,region,code)=>r.data.iso.find(x=>x.region===region&&x.directionCode===code);
function athlete(sex="男",age=25,mass=70){const r=M.defaults();Object.assign(r.athlete,{sex,age,mass,dominantHand:"右手"});return r;}
function useReference(r,region,code){const x=row(r,region,code);x.reference=I.defaultReference(x);return x;}
function legacyPair(r,region="shoulder",ranges=[]){const p=r.balancePairs.find(x=>x.id===region+"_IR_ER");delete p.ratioConvention;p.label="IR:ER";p.numeratorId=row(r,region,"internalRotation").id;p.denominatorId=row(r,region,"externalRotation").id;p.ranges=copy(ranges);return p;}

test("fixed neck references use Table 2 means for each sex side and existing trial mode",()=>{
 const r=athlete(),x=useReference(r,"neck","lateralFlexion");near(M.effectiveIsoTarget(r,x,"L").target,136.5);near(M.effectiveIsoTarget(r,x,"R").target,136);
 r.mode="mean";near(M.effectiveIsoTarget(r,x,"L").target,127.4);r.athlete.sex="女";near(M.effectiveIsoTarget(r,x,"L").target,78.9);near(M.effectiveIsoTarget(r,x,"R").target,80.1);
 const extension=useReference(r,"neck","extension");near(M.effectiveIsoTarget(r,extension).target,129.4);r.mode="best";near(M.effectiveIsoTarget(r,extension).target,138.8);
});
test("Bradley 90 degree shoulder force means map hand dominance without confusing ER0",()=>{
 const r=athlete("女",35,60),ir=useReference(r,"shoulder","internalRotation"),er=useReference(r,"shoulder","externalRotation");
 near(M.effectiveIsoTarget(r,ir,"R").target,70.8);near(M.effectiveIsoTarget(r,ir,"L").target,69.6);near(M.effectiveIsoTarget(r,er,"R").target,55.2);near(M.effectiveIsoTarget(r,er,"L").target,54.6);
 r.athlete.dominantHand="左手";near(M.effectiveIsoTarget(r,ir,"L").target,70.8);r.athlete.dominantHand="未注明";near(M.effectiveIsoTarget(r,ir,"R").target,69.6);
});
test("Bohannon body weight percentages convert using gravity with decade and sex selection",()=>{
 const r=athlete(),x=useReference(r,"elbow","flexion");near(M.effectiveIsoTarget(r,x,"R").target,36.4/100*70*9.80665);near(M.effectiveIsoTarget(r,x,"L").target,35.5/100*70*9.80665);
 r.athlete.age=30;near(M.effectiveIsoTarget(r,x,"R").target,34.6/100*70*9.80665);r.athlete.sex="女";near(M.effectiveIsoTarget(r,x,"R").target,25.7/100*70*9.80665);
});
test("leg references deliberately use ND without inventing preferred foot",()=>{
 const r=athlete(),x=useReference(r,"hip","flexion");near(M.effectiveIsoTarget(r,x,"L").target,26.5/100*70*9.80665);near(M.effectiveIsoTarget(r,x,"R").target,26.5/100*70*9.80665);
 r.athlete.dominantHand="左手";near(M.effectiveIsoTarget(r,x,"R").target,26.5/100*70*9.80665);
});
test("manual targets override references while kgf and relative force conversion preserve dimensions",()=>{
 const r=athlete(),x=useReference(r,"shoulder","internalRotation");x.target=999;r.athlete.mass="";near(M.effectiveIsoTarget(r,x,"L").target,999);assert.equal(M.effectiveIsoTarget(r,x,"L").kind,"manual");
 x.target="";r.athlete.mass=70;x.unit="kgf";near(M.effectiveIsoTarget(r,x,"R").target,1.43*70/9.80665);x.unit="N/kg";near(M.effectiveIsoTarget(r,x,"R").target,1.43);
});
test("missing demographics mass and torque units never receive guessed literature targets",()=>{
 const r=athlete(),x=useReference(r,"shoulder","abduction");
 for(const change of [r=>r.athlete.sex="未注明",r=>r.athlete.age="",r=>r.athlete.mass="",r=>r.athlete.age=60,r=>x.unit="Nm"]){const prior=copy(r.athlete),unit=x.unit;change(r);assert.equal(M.effectiveIsoTarget(r,x,"L").target,null);r.athlete=prior;x.unit=unit;}
 const neck=useReference(r,"neck","flexion");r.athlete.age=36;assert.equal(M.effectiveIsoTarget(r,neck).target,null);r.athlete.age=18;near(M.effectiveIsoTarget(r,neck).target,147.3);
});
test("measured forces without any usable target stay gray measured rather than meeting a target",()=>{
 const r=athlete(),x=row(r,"shoulder","abduction");x.left=x.right=100;r.isoDirectionIds=[x.id];
 let a=M.stats(r).isoAnalyses[0];assert.equal(a.sides[0].status,"gray");assert.equal(a.sides[0].label,"已测");x.reference=I.defaultReference(x);
 for(const field of ["sex","age","mass"]){const saved=r.athlete[field];r.athlete[field]="";a=M.stats(r).isoAnalyses[0];assert.equal(a.sides[0].target,null);assert.equal(a.sides[0].status,"gray");assert.equal(a.sides[0].label,"已测");assert.equal(a.sides[0].referenceComparison,null);r.athlete[field]=saved;}
 x.reference=null;x.left=10;x.right=100;a=M.stats(r).isoAnalyses[0];assert.equal(a.sides[0].status,"red");assert.equal(a.sides[1].status,"gray");x.left=x.right=100;x.painLeft=true;a=M.stats(r).isoAnalyses[0];assert.equal(a.sides[0].status,"red");assert.equal(a.sides[1].label,"已测");
});
test("relative reference overflow cannot produce an infinite displayed target",()=>{
 const r=athlete(),x=useReference(r,"shoulder","abduction");x.reference.groups[0].values.DOM=1e308;const target=M.effectiveIsoTarget(r,x,"R");assert.equal(target.target,null);assert.equal(target.matched,false);assert.match(target.reason,/范围/);
});
test("literature single targets use short amber green grades and retain pain and asymmetry severity",()=>{
 const r=athlete(),x=useReference(r,"shoulder","abduction");x.left=10;x.right=10;
 let a=M.stats(r).isoAnalyses.find(v=>v.id===x.id);assert.equal(a.sides[0].status,"amber");assert.equal(a.sides[0].label,"关注");assert.equal(a.sides[0].referenceComparison.label,"关注");assert.equal(a.sides[0].referenceComparison.status,"amber");
 x.painLeft=true;x.right=30;a=M.stats(r).isoAnalyses.find(v=>v.id===x.id);assert.equal(a.sides[0].status,"red");assert.ok(a.sides[0].reasons.includes("疼痛"));assert.ok(a.sides[0].reasons.some(s=>s.includes("双侧差异")));
 x.painLeft=false;x.left=x.right=152.6;a=M.stats(r).isoAnalyses.find(v=>v.id===x.id);assert.equal(a.sides[0].status,"green");assert.equal(a.sides[0].label,"达标");assert.equal(a.sides[0].referenceComparison.label,"达标");assert.equal(a.sides[0].referenceComparison.status,"green");
 x.left=x.right=160;a=M.stats(r).isoAnalyses.find(v=>v.id===x.id);assert.equal(a.sides[0].status,"green");
});
test("manual single targets never invent a red cutoff but pain and severe asymmetry still do",()=>{
 const r=athlete(),x=row(r,"shoulder","abduction");x.target=200;
 for(const value of [0,1,100,199.99]){x.left=x.right=value;const a=M.stats(r).isoAnalyses.find(v=>v.id===x.id);assert.equal(a.sides[0].status,"amber");assert.equal(a.sides[0].label,"关注");assert.equal(a.sides[0].targetKind,"manual");}
 for(const value of [200,201]){x.left=x.right=value;const a=M.stats(r).isoAnalyses.find(v=>v.id===x.id);assert.equal(a.sides[0].status,"green");assert.equal(a.sides[0].label,"达标");}
 x.left=x.right="";assert.equal(M.stats(r).isoAnalyses.find(v=>v.id===x.id).sides[0].status,"gray");x.left=x.right=200;x.painLeft=true;assert.equal(M.stats(r).isoAnalyses.find(v=>v.id===x.id).sides[0].status,"red");
 x.painLeft=false;x.left=10;x.right=100;const s=M.stats(r),a=s.isoAnalyses.find(v=>v.id===x.id);assert.equal(a.sides[0].status,"red");assert.equal(a.sides[0].label,"预警");assert.equal(a.sides[1].status,"amber");assert.ok(a.sides[0].reasons.some(v=>v.includes("双侧差异")));assert.equal(s.signals.regions.shoulder_l.tests.find(v=>v.id===x.id+"_L").label,"预警");
});
test("only measured targets whose grades changed add the new interpretation basis",()=>{
 const r=M.normalizeRecord(athlete()),x=row(r,"shoulder","abduction");r.isoDirectionIds=[x.id];x.target=200;
 assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);x.left=x.right=200;assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);x.left=x.right=170;assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);
 x.left=x.right=100;assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,"single-target-amber-green-v1");x.target="";assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);
 x.reference=I.defaultReference(x);assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,"single-target-amber-green-v1");r.athlete.mass="";assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);r.athlete.mass=70;r.enabled.iso=false;assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);
});
test("trial-only interpretation basis follows the same best or mean iso projection as reported grades",()=>{
 const r=M.normalizeRecord(athlete()),x=row(r,"shoulder","abduction");r.isoDirectionIds=[x.id];x.target=200;x.trials=[{id:"a",left:100,right:100},{id:"b",left:170,right:170}];const before=copy(r.data);
 assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);r.mode="mean";assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,"single-target-amber-green-v1");const a=M.stats(r).isoAnalyses[0];near(a.sides[0].value,135);assert.equal(a.sides[0].status,"amber");assert.deepEqual(copy(r.data),before);
 x.target="";x.reference=I.defaultReference(x);r.mode="best";assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,"single-target-amber-green-v1");x.trials=[];assert.equal(JSON.parse(M.fingerprint(r)).isoEvaluationBasis,undefined);
});
test("per-side references propagate through radar body details and rendered targets",()=>{
 const r=athlete(),x=useReference(r,"shoulder","internalRotation");x.left=50;x.right=60;r.isoDirectionIds=[x.id];
 const s=M.stats(r),a=s.isoAnalyses[0];near(a.sides[0].target,98);near(a.sides[1].target,100.1);
 near(M.isoRadar(s.isoAnalyses,r).axes.find(v=>v.id==="shoulder").strength,(50/98+60/100.1)/2*100);
 near(s.signals.regions.shoulder_l.tests.find(v=>v.id===x.id+"_L").target,98);
 const body=s.signals.regions.shoulder_l.tests.find(v=>v.id===x.id+"_L");assert.equal(body.status,a.sides[0].status);assert.equal(body.label,a.sides[0].label);const html=R.render(R.build(r));assert.match(html,/参考目标/);assert.match(html,/98/);assert.match(html,/100\.1/);
});
test("shoulder and hip built-in ratios really compute ER over IR with zero numerator valid",()=>{
 const r=athlete();for(const region of ["shoulder","hip"]){Object.assign(row(r,region,"internalRotation"),{left:200,right:0});Object.assign(row(r,region,"externalRotation"),{left:100,right:100});}
 let s=M.stats(r);for(const region of ["shoulder","hip"]){const p=s.balanceResults.find(v=>v.id===region+"_IR_ER");assert.equal(p.label,"ER:IR");near(p.left,.5);assert.equal(p.right,null);}
 row(r,"shoulder","externalRotation").left=0;near(M.stats(r).balanceResults.find(v=>v.id==="shoulder_IR_ER").left,0);
});
test("legacy IR ER range migration reverses bounds endpoint inclusion and contexts idempotently",()=>{
 const r=athlete(),p=legacyPair(r,"shoulder",[{min:1,max:2,includeMin:false,includeMax:true,status:"amber",label:"旧区间"}]);p.contexts=[{name:"IR"},{name:"ER"}];p.referenceEnabled=true;
 const n=M.normalizeRecord(r),q=n.balancePairs.find(v=>v.id===p.id);assert.equal(q.numeratorId,row(r,"shoulder","externalRotation").id);assert.deepEqual(copy(q.contexts),[{name:"ER"},{name:"IR"}]);
 assert.deepEqual(copy(q.ranges),[{min:.5,max:1,includeMin:true,includeMax:false,status:"amber",label:"旧区间"}]);assert.equal(M.grade(.5,q).status,"amber");assert.equal(M.grade(1,q).status,"gray");assert.deepEqual(copy(M.normalizeRecord(n)),copy(n));
});
test("open IR ER boundaries preserve the positive-domain reciprocal at zero and infinity",()=>{
 const r=athlete(),p=legacyPair(r,"hip",[{min:0,max:2,includeMin:true,includeMax:false,status:"green",label:"低段"},{min:2,max:null,includeMin:true,status:"amber",label:"高段"}]);p.referenceEnabled=true;
 const q=M.normalizeRecord(r).balancePairs.find(v=>v.id===p.id);assert.equal(M.grade(.5,q).label,"高段");assert.equal(M.grade(1,q).label,"低段");assert.equal(M.grade(0,q).status,"gray");assert.equal(q.ranges[0].includeMin,false);
});
test("unconvertible old ratio rules preserve an original copy and disable evaluation",()=>{
 const r=athlete(),p=legacyPair(r,"shoulder",[{min:-1,max:2,status:"red",label:"无效旧界限"}]);p.referenceEnabled=true;p.source="旧手工来源";
 const n=M.normalizeRecord(r),q=n.balancePairs.find(v=>v.id===p.id);assert.equal(q.referenceEnabled,false);assert.equal(q.ranges.length,0);assert.match(q.ratioMigrationIssue,/无法取倒数/);assert.deepEqual(copy(q.ratioMigrationOriginal),copy(p));assert.deepEqual(copy(M.normalizeRecord(n)),copy(n));
});
test("custom pair definitions using built-in IDs are preserved without forced inversion",()=>{
 const r=athlete(),p=legacyPair(r);p.numeratorId=row(r,"shoulder","flexion").id;const before=copy(p);assert.equal(M.migrateBalancePair(p,r.data.iso),false);assert.deepEqual(copy(p),before);
});
test("reciprocal migration never pretends an old ratio mean is the mean of reciprocals",()=>{
 const r=athlete(),p=legacyPair(r);p.reference=I.defaultBalanceReference(M.defaults().balancePairs.find(v=>v.id==="shoulder_IR_ER"));p.reference.source="旧 IR:ER 均值";
 const n=M.normalizeRecord(r),q=n.balancePairs.find(v=>v.id===p.id);assert.equal(q.reference.enabled,false);assert.match(q.ratioMigrationIssue,/均值不能直接换算/);assert.deepEqual(copy(q.ratioMigrationOriginal),copy(p));assert.deepEqual(copy(M.normalizeRecord(n)),copy(n));
});
test("Bradley shoulder balance averages remain descriptive without inventing cutoffs",()=>{
 const r=athlete("女",25),p=r.balancePairs.find(v=>v.id==="shoulder_IR_ER");p.reference=I.defaultBalanceReference(p);Object.assign(row(r,"shoulder","internalRotation"),{left:100,right:100});Object.assign(row(r,"shoulder","externalRotation"),{left:50,right:50});
 const q=M.stats(r).balanceResults.find(v=>v.id===p.id);near(q.results[0].referenceTarget,.86);near(q.results[1].referenceTarget,.81);assert.equal(q.results[0].status,"gray");assert.equal(q.results[0].referenceComparison.relation,"below");assert.equal(q.results[0].referenceComparison.label,"参考");assert.equal(q.results[0].referenceComparison.status,"gray");
 row(r,"shoulder","externalRotation").left=86;let next=M.stats(r).balanceResults.find(v=>v.id===p.id);assert.equal(next.results[0].referenceComparison.relation,"equal");assert.equal(next.results[0].status,"gray");row(r,"shoulder","externalRotation").left=100;next=M.stats(r).balanceResults.find(v=>v.id===p.id);assert.equal(next.results[0].referenceComparison.relation,"above");assert.equal(next.results[0].status,"gray");
 r.athlete.age=30;near(M.stats(r).balanceResults.find(v=>v.id===p.id).results[0].referenceTarget,.81);
});
test("ungraded joint balance tooltips explain mean references while enabled intervals remain authoritative",()=>{
 const r=athlete(),p=r.balancePairs.find(v=>v.id==="shoulder_IR_ER");p.reference=I.defaultBalanceReference(p);const ir=row(r,"shoulder","internalRotation"),er=row(r,"shoulder","externalRotation");ir.left=200;er.left=160;
 const before=JSON.stringify(r),basis=M.fingerprint(r);let s=M.stats(r),q=s.balanceResults.find(v=>v.id===p.id).results[0],body=s.signals.regions.shoulder_l.tests.find(t=>t.id==="balance_"+p.id+"_L");assert.equal(q.value,.8);assert.equal(q.status,"gray");assert.match(q.evaluationReason,/文献均值仅作参考/);assert.match(body.notes,/尚未设置分级区间/);assert.equal(JSON.stringify(r),before);assert.equal(M.fingerprint(r),basis);
 p.referenceEnabled=true;p.ranges=[{min:.7,max:.9,includeMin:true,includeMax:true,status:"green",label:"原方案范围"}];s=M.stats(r);q=s.balanceResults.find(v=>v.id===p.id).results[0];assert.equal(q.status,"green");assert.equal(q.label,"原方案范围");assert.equal(q.evaluationReason,"");assert.equal(s.signals.regions.shoulder_l.status,"green");assert.equal(s.signals.regions.shoulder_l.label,"达标");assert.equal(p.ranges[0].label,"原方案范围");
 p.referenceEnabled=false;ir.protocol="A";er.protocol="B";s=M.stats(r);q=s.balanceResults.find(v=>v.id===p.id).results[0];assert.equal(q.value,null);assert.equal(q.status,"gray");assert.equal(q.reason,"测量协议不同");assert.equal(q.evaluationReason,"");
});
test("a one-time shared scheme seed fills only blanks and excludes demo-only profiles",()=>{
 const r=athlete(),p={id:"p",name:"现方案",revision:1,updated:"old",criteria:E.capture(r),builtinStandardsVersion:1},demo=copy(p);demo.id="demo";demo.name="示例";
 p.criteria.iso.find(v=>v.id==="iso_shoulder_abduction").target=321;
 const lib={evaluationProfiles:[p,demo],athletes:[{records:[{evaluationProfileId:"p",demo:false},{evaluationProfileId:"demo",demo:true}]}]};
 assert.equal(E.upgradeLibraryProfiles(lib),true);assert.equal(p.criteria.iso.find(v=>v.id==="iso_shoulder_abduction").reference,undefined);assert.equal(p.criteria.iso.find(v=>v.id==="iso_neck_flexion").reference.groups[0].values.C,147.3);assert.ok(!demo.criteria.iso.some(v=>v.reference));
 assert.equal(p.revision,2);const selected=p.criteria.iso.find(v=>v.id==="iso_neck_flexion");selected.reference=null;assert.equal(E.upgradeLibraryProfiles(lib),false);assert.equal(selected.reference,null);
});
test("capture editor roundtrip shared resolution and exports preserve reference edits but no raw overrides",()=>{
 const r=athlete(),p=E.create(r);assert.equal(p.isoReferencesVersion,1);const draft=E.template(p),x=row(draft,"shoulder","abduction");x.reference.groups[0].values.DOM=3;
 const before=copy(r.data);p.criteria=E.fromTemplate(draft,p);E.validateProfile(p);const resolved=E.resolve(r,p);near(M.effectiveIsoTarget(resolved,row(resolved,"shoulder","abduction"),"R").target,210);assert.deepEqual(copy(r.data),before);
 const envelope=M.recordEnvelope(resolved,p);assert.equal(envelope.profile.criteria.iso.find(v=>v.id===x.id).reference.groups[0].values.DOM,3);const imported=E.migrate({schema:3,kind:"athlete-library",evaluationProfiles:[p],athletes:[{id:r.athleteId,records:[{...r,evaluationProfileId:p.id}]}]});assert.equal(imported.evaluationProfiles[0].criteria.iso.find(v=>v.id===x.id).reference.groups[0].values.DOM,3);
});
test("measurement condition mismatches disable reference targets as well as manual targets",()=>{
 const r=athlete(),p=E.create(r),x=row(r,"shoulder","abduction");x.protocol="另一协议";const out=E.resolve(r,p),value=row(out,"shoulder","abduction");assert.equal(value.reference,undefined);assert.equal(M.effectiveIsoTarget(out,value,"L").target,null);
});
test("standalone materialization and real import preserve deliberately blank shared targets",()=>{
 const r=M.normalizeRecord(athlete()),p=E.create(r),rule=p.criteria.iso.find(v=>v.id==="iso_shoulder_abduction");rule.target="";delete rule.reference;
 const resolved=E.resolve(r,p),basis=M.fingerprint(resolved),standalone=E.materialize(resolved);const target=standalone.data.iso.find(v=>v.id===rule.id);assert.equal(target.reference,null);assert.equal(M.fingerprint(standalone),basis);
 const imported=E.migrate(M.recordEnvelope(standalone)),next=E.resolve(imported.athletes[0].records[0],imported.evaluationProfiles[0]),value=next.data.iso.find(v=>v.id===rule.id);assert.equal(M.effectiveIsoTarget(next,value,"L").target,null);assert.equal(value.reference,null);assert.equal(M.fingerprint(next),basis);
});
test("standalone exports preserve manual precedence and each existing literature table",()=>{
 const r=M.normalizeRecord(athlete()),p=E.create(r),rule=p.criteria.iso.find(v=>v.id==="iso_shoulder_abduction");rule.target=444;
 const before=E.resolve(r,p),source=copy(before.data.iso.find(v=>v.id==="iso_neck_flexion").reference),standalone=E.materialize(before),imported=E.migrate(M.recordEnvelope(standalone)),next=E.resolve(imported.athletes[0].records[0],imported.evaluationProfiles[0]);
 near(M.effectiveIsoTarget(next,next.data.iso.find(v=>v.id===rule.id),"L").target,444);assert.equal(M.effectiveIsoTarget(next,next.data.iso.find(v=>v.id===rule.id),"L").kind,"manual");assert.deepEqual(copy(next.data.iso.find(v=>v.id==="iso_neck_flexion").reference),source);assert.equal(M.fingerprint(next),M.fingerprint(before));
});
test("a cleared descriptive ratio reference also remains absent after a standalone import",()=>{
 const r=M.normalizeRecord(athlete()),p=E.create(r),rule=p.criteria.balance.find(v=>v.id==="shoulder_IR_ER");delete rule.reference;const before=E.resolve(r,p),standalone=E.materialize(before);assert.equal(standalone.balancePairs.find(v=>v.id===rule.id).reference,null);assert.equal(M.fingerprint(standalone),M.fingerprint(before));
 const imported=E.migrate(M.recordEnvelope(standalone)),next=E.resolve(imported.athletes[0].records[0],imported.evaluationProfiles[0]);assert.equal(next.balancePairs.find(v=>v.id===rule.id).reference,null);assert.equal(M.fingerprint(next),M.fingerprint(before));
});
test("reference validation rejects ambiguous populations negative means and invalid bases",()=>{
 const ref=I.defaultReference(row(athlete(),"shoulder","abduction"));for(const change of [x=>x.basis="Nm/kg",x=>x.groups[0].values.DOM=-1,x=>x.groups.push(copy(x.groups[0])),x=>x.groups[0].ageMax=10]){const next=copy(ref);change(next);assert.throws(()=>I.validateReference(next));}
 const overlap=copy(ref);overlap.groups.push({...copy(overlap.groups[0]),ageMin:30});assert.throws(()=>I.validateReference(overlap),/重叠/);
});
test("legacy scalar FMS pollution is removed without losing zero score pain notes or completion",()=>{
 const r=athlete();Object.assign(r.data.fms[0],{score:2,left:"",right:"",notes:"保留"});Object.assign(r.data.fms[5],{score:3,left:"",right:""});const n=M.normalizeRecord(r),f=M.stats(n).raw.fms;assert.equal(f.items[0].score,2);assert.equal(f.items[5].score,3);assert.equal(n.data.fms[0].notes,"保留");assert.equal(n.data.fms[0].left,undefined);
 n.data.fms[0].score=0;n.data.fms[5].pain=true;const zero=M.stats(M.normalizeRecord(n)).raw.fms;assert.equal(zero.items[0].value,0);assert.equal(zero.items[5].value,0);assert.equal(zero.items[5].score,3);assert.equal(zero.completed,2);
});
test("factory direction aliases migrate code and text while custom labels stay authored",()=>{
 const r=athlete(),x=row(r,"trunk","rotation");delete x.directionCode;x.direction="旋转（左向 / 右向）";let n=M.normalizeRecord(r);assert.equal(row(n,"trunk","rotation").direction,"旋转");
 const authored=row(n,"trunk","rotation");authored.direction="个人旋转方向";assert.equal(row(M.normalizeRecord(n),"trunk","rotation").direction,"个人旋转方向");assert.deepEqual(copy(M.normalizeRecord(n)),copy(n));
});
test("body region grades include FMS and ignore measured ungraded results when a grade exists",()=>{
 const r=athlete();Object.keys(r.enabled).forEach(id=>r.enabled[id]=["iso","fms"].includes(id));const f=r.data.fms[5];f.location="trunk";f.score=3;
 const before=JSON.stringify(r),basis=M.fingerprint(r);let s=M.stats(r);assert.equal(s.signals.regions.trunk.tests.find(t=>t.testId==="fms").status,"green");assert.equal(s.signals.regions.trunk.tests.find(t=>t.testId==="fms").label,"完成");assert.equal(s.signals.regions.trunk.status,"green");assert.equal(s.signals.regions.trunk.label,"达标");assert.equal(JSON.stringify(r),before);assert.equal(M.fingerprint(r),basis);
 const trunk=row(r,"trunk","flexion");trunk.target=100;trunk.center=120;f.score=2;s=M.stats(r);assert.equal(s.signals.regions.trunk.status,"amber");f.pain=true;s=M.stats(r);assert.equal(s.signals.regions.trunk.status,"red");
 const partial=r.data.fms[1],hip=row(r,"hip","abduction");partial.location="hip_l";partial.left=3;partial.right="";hip.target=400;hip.left=hip.right=450;s=M.stats(r);assert.equal(s.signals.regions.hip_l.status,"green");assert.equal(s.signals.regions.hip_l.tests.find(t=>t.testId==="fms").value,null);
 hip.target="";hip.reference=null;s=M.stats(r);assert.equal(s.signals.regions.hip_l.hasMeasured,true);assert.equal(s.signals.regions.hip_l.status,"gray");partial.left="";hip.left=hip.right="";s=M.stats(r);assert.equal(s.signals.regions.hip_l.hasMeasured,false);assert.equal(s.signals.regions.hip_l.status,"gray");
});
test("body measurement presence distinguishes zero pain and trial results from configured placeholders",()=>{
 const r=athlete(),x=row(r,"shoulder","abduction");r.isoDirectionIds=[x.id];x.target=200;x.notes="仅配置说明";
 let before=JSON.stringify(r),basis=M.fingerprint(r),s=M.stats(r);assert.equal(s.signals.regions.shoulder_l.hasMeasured,false);assert.equal(s.signals.regions.shoulder_r.hasMeasured,false);assert.ok(s.signals.regions.shoulder_l.tests.every(t=>t.hasMeasured===false));assert.equal(JSON.stringify(r),before);assert.equal(M.fingerprint(r),basis);
 x.target="";x.left=0;s=M.stats(r);let t=s.signals.regions.shoulder_l.tests.find(t=>t.id===x.id+"_L");assert.equal(t.value,0);assert.equal(t.hasMeasured,true);assert.equal(t.status,"gray");assert.equal(s.signals.regions.shoulder_l.hasMeasured,true);assert.equal(s.signals.regions.shoulder_r.hasMeasured,false);
 x.left="";x.painRight=true;s=M.stats(r);t=s.signals.regions.shoulder_r.tests.find(t=>t.id===x.id+"_R");assert.equal(t.value,null);assert.equal(t.pain,true);assert.equal(t.hasMeasured,true);assert.equal(t.status,"red");assert.equal(s.signals.regions.shoulder_l.hasMeasured,false);
 x.painRight=false;x.trials=[{id:"measured-zero",left:0,right:""}];before=JSON.stringify(r);basis=M.fingerprint(r);s=M.stats(r);assert.equal(s.signals.regions.shoulder_l.hasMeasured,true);assert.equal(s.signals.regions.shoulder_r.hasMeasured,false);assert.equal(JSON.stringify(r),before);assert.equal(M.fingerprint(r),basis);
});
test("partial bilateral FMS retains a measured body region without inventing a completed score",()=>{
 const r=athlete();Object.keys(r.enabled).forEach(id=>r.enabled[id]=id==="fms");const x=r.data.fms[1];x.location="hip_l";x.left=2;x.right="";
 const before=JSON.stringify(r),basis=M.fingerprint(r);let s=M.stats(r),t=s.signals.regions.hip_l.tests[0];assert.equal(t.value,null);assert.equal(t.missing,true);assert.equal(t.hasMeasured,true);assert.equal(t.status,"gray");assert.equal(s.raw.fms.completed,0);assert.equal(s.signals.regions.hip_l.hasMeasured,true);assert.equal(JSON.stringify(r),before);assert.equal(M.fingerprint(r),basis);
 x.left=4;s=M.stats(r);assert.equal(s.signals.regions.hip_l.hasMeasured,false);x.left="";x.right=0;s=M.stats(r);assert.equal(s.signals.regions.hip_l.hasMeasured,true);assert.equal(s.signals.regions.hip_l.tests[0].value,null);
 x.right="";x.notes="仅备注";s=M.stats(r);assert.equal(s.signals.regions.hip_l.hasMeasured,false);x.pain=true;s=M.stats(r);assert.equal(s.signals.regions.hip_l.hasMeasured,true);assert.equal(s.signals.regions.hip_l.tests[0].value,0);
 const scalar=r.data.fms[0];scalar.location="neck";scalar.score=0;s=M.stats(r);assert.equal(s.signals.regions.neck.hasMeasured,true);assert.equal(s.signals.regions.neck.tests[0].value,0);
});
test("custom screen zero counts as a body measurement while empty target configuration does not",()=>{
 const r=athlete();Object.keys(r.enabled).forEach(id=>r.enabled[id]=false);r.customTests.push({id:"reach_zero",name:"活动度",category:"screen"});r.enabled.reach_zero=true;
 r.definitions.push({id:"reach_zero_l",testId:"reach_zero",name:"活动度",category:"screen",ability:"控制",region:"elbow_l",unit:"度",direction:"higher",target:100,referenceEnabled:true,ranges:[]});
 let s=M.stats(r);assert.equal(s.signals.regions.elbow_l.hasMeasured,false);r.customValues.reach_zero_l={value:0};const before=JSON.stringify(r),basis=M.fingerprint(r);s=M.stats(r);assert.equal(s.signals.regions.elbow_l.hasMeasured,true);assert.equal(s.signals.regions.elbow_l.tests[0].value,0);assert.equal(s.signals.regions.elbow_l.tests[0].hasMeasured,true);assert.equal(JSON.stringify(r),before);assert.equal(M.fingerprint(r),basis);
});
console.log(passed+" isometric reference model checks passed");
