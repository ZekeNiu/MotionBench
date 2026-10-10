"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict"),path=require("node:path");
const c=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});c.window=c;
for(const name of ["calc", "fvp","cpet-reference","definitions","tests","model","evaluation","store","interventions","viz","report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const M=c.RingsideModel,E=c.RingsideEvaluation,R=c.RingsideReport,V=c.RingsideViz,S=c.RingsideStore,copy=x=>JSON.parse(JSON.stringify(x));
let passed=0;function test(name,run){run();passed++;console.log("PASS "+name);}
const isoOnly=()=>{const r=M.defaults();r.enabled=Object.fromEntries(Object.keys(r.enabled).map(id=>[id,id==="iso"]));return r;};
const row=(r,id)=>r.data.iso.find(row=>row.id===id);

test("catalog contains 42 stable directions across ten regions and preserves original 22 IDs",()=>{
  assert.equal(M.isoRows().length,42);assert.equal(Object.keys(M.REG).length,10);
  assert.equal(M.legacyIsoDirectionIds().length,22);assert.equal(new Set(M.isoRows().map(r=>r.id)).size,42);
  assert.deepEqual(copy(Object.fromEntries(Object.keys(M.REG).map(key=>[key,M.isoRows().filter(row=>row.region===key).length]))),{neck:4,trunk:4,shoulder:8,scapula:4,elbow:2,forearm:2,wrist:4,hip:6,knee:4,ankle:4});
  assert.ok(M.isoRows().every(row=>row.target===""));
});
test("old records keep their original rows and five axes while selecting a new direction appends only that row",()=>{
  const r=isoOnly();r.data.iso=r.data.iso.filter(row=>M.legacyIsoDirectionIds().includes(row.id));
  const old=copy(r),n=M.normalizeRecord(r);assert.equal(n.isoDirectionIds,undefined);assert.equal(n.data.iso.length,22);
  assert.equal(R.build(n).isoRadar.axes.length,5);assert.deepEqual(copy(M.selectedIsoRows(n)),old.data.iso);
  M.setIsoDirectionSelection(n,["iso_elbow_flexion"]);assert.equal(n.data.iso.length,23);assert.equal(row(n,"iso_elbow_flexion").target,"");
  assert.equal(M.selectedIsoRows(n)[0].id,"iso_elbow_flexion");assert.equal(r.data.iso.length,22);
});
test("deselection preserves every raw trial but removes its measurements pain progress and ratio from derived results",()=>{
  const r=isoOnly(),ir=row(r,"iso_shoulder_internalRotation"),er=row(r,"iso_shoulder_externalRotation");
  ir.trials=[{id:"a",left:100,right:130,painLeft:true},{id:"b",left:120,right:140},{id:"c",left:110,right:120}];
  Object.assign(er,{left:90,right:110,target:100});const raw=JSON.stringify(ir);
  M.setIsoDirectionSelection(r,[er.id]);const s=M.stats(r);
  assert.deepEqual(copy(s.isoAnalyses.map(x=>x.id)),[er.id]);assert.ok(s.repetitions.every(x=>x.directionId!==ir.id));
  assert.ok(!s.balanceResults.some(x=>x.id==="shoulder_IR_ER"));assert.ok(!s.findings.some(x=>x.detail.includes("疼痛")));
  assert.match(M.recordProgressDetail(r,"iso",s).detail,/方向 1\/1/);assert.equal(JSON.stringify(ir),raw);
  M.setIsoDirectionSelection(r,[ir.id,er.id]);assert.equal(JSON.stringify(ir),raw);assert.equal(M.stats(r).isoAnalyses[0].sides[0].pain,true);
});
test("zero missing sides and pain-only measurements retain independent semantics",()=>{
  const r=isoOnly();M.setIsoDirectionSelection(r,["iso_wrist_flexion","iso_forearm_pronation"]);
  row(r,"iso_wrist_flexion").left=0;row(r,"iso_forearm_pronation").painRight=true;
  const s=M.stats(r),w=s.isoAnalyses[0];assert.equal(w.left,0);assert.equal(w.right,null);assert.equal(w.asym,null);
  assert.equal(s.raw.iso.length,2);assert.match(M.recordProgressDetail(r,"iso",s).detail,/方向 1\/2/);
  assert.equal(s.signals.regions.forearm_r.status,"red");assert.equal(R.build(r).isoRadar.axes[0].strength,null);
});
test("selected repetitions retain mean SD and CV and use stable row IDs",()=>{
  const r=isoOnly();M.setIsoDirectionSelection(r,["iso_wrist_extension"]);r.mode="mean";
  row(r,"iso_wrist_extension").trials=[98,100,102].map((v,i)=>({id:"w"+i,left:v,right:v+10}));
  const s=M.stats(r),g=s.repetitions.find(g=>g.side==="left");assert.equal(g.statistics[0].n,3);assert.equal(g.statistics[0].mean,100);assert.equal(g.statistics[0].sd,2);assert.equal(g.statistics[0].cv,2);
  assert.equal(s.isoAnalyses[0].left,100);assert.match(R.render(R.build(r)),/均值 ± SD/);
});
test("neck and trunk labels mean movement direction and body payloads use central regions",()=>{
  const r=isoOnly();M.setIsoDirectionSelection(r,["iso_trunk_rotation","iso_neck_lateralFlexion"]);
  Object.assign(row(r,"iso_trunk_rotation"),{left:80,right:100,target:100});Object.assign(row(r,"iso_neck_lateralFlexion"),{left:40,right:50});
  const s=M.stats(r),regions=s.signals.regions;assert.ok(regions.trunk);assert.ok(!regions.trunk_l);assert.ok(!regions.trunk_r);
  assert.ok(regions.trunk.tests.some(t=>t.sideLabel==="L"));assert.match(R.render(R.build(r)),/左侧更弱/);
  assert.match(V.body(regions),/data-region="trunk"/);assert.match(V.bodyTooltip({...regions.trunk,name:"躯干"}),/L/);
});
test("plots use selected regions with sparse and ten-region horizontal fallback instead of direction axes",()=>{
  const r=isoOnly();for(const n of [0,1,2,3,8,9,10]){
    const regions=Object.keys(M.REG).slice(0,n);M.setIsoDirectionSelection(r,regions.map(region=>r.data.iso.find(row=>row.region===region).id));
    const report=R.build(r),html=V.isoRadar(report.isoRadar);assert.equal(report.isoRadar.axes.length,n);assert.ok(!/NaN|Infinity/.test(html));
    if(n===0)assert.match(html,/等待数据/);else assert.match(html,n<3||n>8?/部位力量与对称性/:/关节力量与对称性/);
  }
});
test("new body hotspots preserve separate shoulder scapular forearm and wrist identities",()=>{
  const keys=["trunk","scapula_l","scapula_r","elbow_l","elbow_r","forearm_l","forearm_r","wrist_l","wrist_r"];
  assert.doesNotMatch(V.body({}),/data-region=/);
  const html=V.body(Object.fromEntries(keys.map(key=>[key,{status:"gray",tests:[{value:1,missing:false}]}])));
  for(const key of keys)assert.ok(html.includes('data-region="'+key+'"'));
});
test("selection survives record normalization snapshot and backup validation and rejects unknown duplicate IDs",()=>{
  const r=isoOnly();M.setIsoDirectionSelection(r,["iso_elbow_flexion"]);r.testPlanSnapshot={id:"plan_a",name:"上肢",testIds:["iso"],isoDirectionIds:["iso_elbow_flexion"]};
  M.validateRecord(r);assert.deepEqual(copy(M.normalizeRecord(copy(r)).isoDirectionIds),["iso_elbow_flexion"]);
  for(const ids of [["missing"],["iso_elbow_flexion","iso_elbow_flexion"],null]){const bad=copy(r);bad.isoDirectionIds=ids;assert.throws(()=>M.validateRecord(bad),/方向/);}
  const plan={id:"plan_a",name:"上肢",testIds:["iso"],defaultEvaluationProfileId:"profile_a",isoDirectionIds:["iso_elbow_flexion"]};
  S.validateTestPlans([plan],M.normalizeCatalog());assert.throws(()=>S.validateTestPlans([{...plan,isoDirectionIds:[]}],M.normalizeCatalog()),/方向/);
  S.validateTestPlans([{...plan,isoDirectionIds:undefined}],M.normalizeCatalog());
});
test("selection changes narrative fingerprint and preserves existing custom directions",()=>{
  const r=isoOnly(),custom={...copy(r.data.iso[0]),id:"custom_direction",direction:"自定义",directionCode:"custom_test"};r.data.iso.push(custom);
  const before=M.fingerprint(r);M.setIsoDirectionSelection(r,[custom.id]);assert.notEqual(M.fingerprint(r),before);assert.equal(M.selectedIsoRows(r)[0],custom);
  assert.ok(M.isoDirectionCatalog(r).some(row=>row.id===custom.id));M.setIsoDirectionSelection(r,[]);assert.equal(M.stats(r).isoAnalyses.length,0);assert.ok(r.data.iso.includes(custom));
});
test("unselected protocol mismatch does not create a current evaluation issue and new directions inherit no target",()=>{
  const r=isoOnly();
  const lib=E.migrate(M.recordEnvelope(r)),profile=lib.evaluationProfiles[0];
  row(r,"iso_shoulder_externalRotation").unit="kgf";M.setIsoDirectionSelection(r,["iso_wrist_extension"]);
  const resolved=E.resolve(r,profile);assert.ok(!resolved.evaluationIssues.some(x=>x.id==="iso_shoulder_externalRotation"));assert.equal(row(resolved,"iso_wrist_extension").target,"");
});
test("unknown new directions do not receive fabricated generic exercise prescriptions",()=>{
  const r=isoOnly();M.setIsoDirectionSelection(r,["iso_wrist_extension"]);Object.assign(row(r,"iso_wrist_extension"),{left:20,right:50,target:100});
  const text=M.localText(r);assert.ok(!text.includes("伸展轻阻力等长"));assert.match(text,/复核本方向/);
});
console.log(passed+" isometric selection model checks passed");
