"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),copy=value=>JSON.parse(JSON.stringify(value));
const modules=["calc","fvp","sprint-fvp","sprint-elasticity","sources","cpet-reference","iso-reference","definitions","tests","scoring","model","acquisition","evaluation","interventions","store","generic-viz","preset-sources","presets","viz","report","excel","excel-v3"];
function context(revision){
  const c=vm.createContext({console,Intl,Blob,TextDecoder,TextEncoder,Buffer,setTimeout,clearTimeout,crypto:require("node:crypto").webcrypto});c.window=c;
  if(!revision)vm.runInContext(fs.readFileSync(path.join(root,"vendor/exceljs.min.js"),"utf8"),c,{filename:"vendor/exceljs.min.js"});
  for(const name of modules){
    if(revision&&["generic-viz","preset-sources","presets","viz","report","excel","excel-v3","acquisition","store"].includes(name))continue;
    const file="src/ringside-"+name+".js";
    vm.runInContext(revision?execFileSync("git",["show",revision+":"+file],{cwd:root,encoding:"utf8"}):fs.readFileSync(path.join(root,file),"utf8"),c,{filename:file});
  }
  return c;
}
const c=context(),old=context("329ca4799eeb9366f015b1bced4cec9dfed9f7ef"),M=c.RingsideModel,E=c.RingsideEvaluation,P=c.RingsidePresets,T=c.RingsideTests;
let passed=0;const checks=[];
async function test(name,fn){await fn();passed++;checks.push(name);console.log("PASS "+name);}
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-8,a+" != "+b);
function existingLibrary(){
  const r=old.RingsideModel.sampleRecord();r.demo=false;r.recordId="presets-old-record";r.athleteId="presets-old-athlete";
  r.athlete.name="Synthetic preserved";r.narrative={...r.narrative,html:"<p>Original manual prose must remain exact.</p>",plain:"Original manual prose must remain exact."};
  const lib=old.RingsideEvaluation.migrate(old.RingsideModel.recordEnvelope(r));
  lib.catalog.tests[0].name="Original project name";lib.evaluationProfiles[0].name="Original user scheme";
  return copy(lib);
}
const allIds=P.list().map(item=>item.id);
function addedLibrary(){return P.apply(existingLibrary(),allIds).library;}
function record(ids,library=addedLibrary()){
  const r=M.recordFromCatalog(library.catalog,{name:"Synthetic preset athlete",sex:"男",sport:"测试"},Object.fromEntries(ids.map(id=>[id,true])),"2026-10-13");
  r.athlete.age=25;r.recordId="presets-new-record";r.athleteId="presets-new-athlete";return r;
}
const definition=(r,id)=>r.definitions.find(d=>d.id===id);
function trial(r,id,rows){r.data[id]=rows.map((metrics,i)=>({id:id+"_trial_"+i,metrics,notes:"Raw attempt "+(i+1)}));}
function profileRule(r,id){const p=E.create(r,"Synthetic rule");p.aggregations={};const s=E.ruleSubjects(r).find(s=>s.id==="metric:"+id),rule=E.ensureStandard(p,s);Object.assign(rule,{enabled:true,targetEnabled:false,rangesEnabled:true,ranges:[{min:null,max:null,label:"Synthetic grade",status:"green"}]});return p;}
(async()=>{
  await test("catalog offers twelve genuinely separate scalar projects and four explicitly named student schemes",()=>{
    const items=P.list();assert.equal(items.length,16);assert.equal(items.filter(x=>x.kind==="project").length,12);assert.equal(items.filter(x=>x.kind==="profile").length,4);
    assert.equal(new Set(items.map(x=>x.id)).size,16);for(const item of items.filter(x=>x.kind==="project"))assert.equal(T.registry.has(item.id),false);
    assert.ok(items.filter(x=>x.kind==="profile").every(x=>/男生|女生/.test(x.name)&&/大一\/大二|大三\/大四/.test(x.name)&&/单项/.test(x.name)));
  });
  await test("preview is pure and reports twelve projects fourteen measurements and four schemes",()=>{
    const lib=existingLibrary(),before=copy(lib),p=P.preview(lib,allIds);assert.deepEqual(copy(lib),before);assert.equal(p.additions.tests.length,12);assert.equal(p.additions.definitions.length,14);assert.equal(p.additions.profiles.length,4);assert.deepEqual(copy(p.conflicts),[]);
  });
  await test("published student boundary fixtures retain verified units and explicit sex-year columns",()=>{
    // MOE 2014 tables reproduced by HNUST, physical pages 22, 23, 24–25.
    // Endurance table is min:sec; these independent fixtures convert to seconds.
    assert.deepEqual(copy(c.RingsidePresetSources.studentThresholds()),{
      male_y12:{sprint50:[6.9,7.1,9.1],longJump:[263,248,208],run:[3*60+27,3*60+42,4*60+32]},
      male_y34:{sprint50:[6.8,7.0,9.0],longJump:[265,250,210],run:[3*60+25,3*60+40,4*60+30]},
      female_y12:{sprint50:[7.7,8.3,10.3],longJump:[195,181,151],run:[3*60+30,3*60+44,4*60+34]},
      female_y34:{sprint50:[7.6,8.2,10.2],longJump:[196,182,152],run:[3*60+28,3*60+42,4*60+32]},
    });
    assert.ok(P.list().every(item=>item.sourceIds.every(id=>c.RingsidePresetSources.get(id))));
    assert.equal(c.RingsidePresetSources.get("ace-t-test").year,null);
  });
  await test("additive apply preserves every old project metric protocol scheme record identity and manual narrative",()=>{
    const lib=existingLibrary(),before=copy(lib),result=P.apply(lib,allIds),next=result.library;assert.deepEqual(copy(lib),before);
    for(const key of ["tests","definitions"])for(const item of before.catalog[key])assert.deepEqual(copy(next.catalog[key].find(x=>x.id===item.id)),item);
    for(const key of ["protocol","protocolIdentities"])for(const [id,value]of Object.entries(before.catalog[key]))assert.deepEqual(copy(next.catalog[key][id]),value);
    for(const p of before.evaluationProfiles)assert.deepEqual(copy(next.evaluationProfiles.find(x=>x.id===p.id)),p);
    assert.deepEqual(copy(next.athletes),before.athletes);assert.equal(next.defaultEvaluationProfileId,before.defaultEvaluationProfileId);
    assert.equal(next.catalog.revision,before.catalog.revision+1);assert.deepEqual(Object.keys(result.manifest).sort(),["dependencyTestIds","metricIds","profileIds","testIds"]);
  });
  await test("reapplying presets is idempotent and never overwrites subsequent user edits",()=>{
    const lib=addedLibrary();lib.catalog.tests.find(t=>t.id==="preset_handgrip").name="User grip";lib.evaluationProfiles.find(p=>p.id==="preset_student_2014_male_y12").standards[0].ranges[0].label="User grade";
    const before=copy(lib),r=P.apply(lib,allIds);assert.deepEqual(copy(r.library),before);assert.equal(r.manifest.testIds.length+r.manifest.metricIds.length+r.manifest.profileIds.length,0);
  });
  await test("selecting only a student scheme exposes and adds its three dependencies",()=>{
    const p=P.preview(existingLibrary(),["preset_student_2014_female_y34"]);assert.equal(p.additions.tests.length,3);assert.equal(p.additions.profiles.length,1);assert.equal(p.manifest.dependencyTestIds.length,3);
    assert.ok(p.manifest.testIds.includes("preset_run_800m"));assert.ok(!p.manifest.testIds.includes("preset_run_1000m"));
  });
  await test("metric ID collisions are explicit and an attempted application leaves the input intact",()=>{
    const lib=existingLibrary(),d=copy(P.preview(lib,["preset_handgrip"]).additions.definitions[0]);d.testId="cmj";lib.catalog.definitions.push(d);const before=copy(lib);
    assert.ok(P.preview(lib,["preset_handgrip"]).conflicts.length);assert.throws(()=>P.apply(lib,["preset_handgrip"]));assert.deepEqual(copy(lib),before);
  });
  await test("capacity violations fail before applying any additions",()=>{
    const lib=existingLibrary();while(lib.catalog.tests.length<75)lib.catalog.tests.push({id:"synthetic_"+lib.catalog.tests.length,name:"Capacity",category:"performance"});
    const before=copy(lib);assert.ok(P.preview(lib,["preset_sprint_10m"]).conflicts.some(x=>x.id==="catalog-capacity"));assert.throws(()=>P.apply(lib,["preset_sprint_10m"]));assert.deepEqual(copy(lib),before);
  });
  await test("new projects use the established attempts adapter and retain snapshot metadata",()=>{
    const lib=addedLibrary(),r=record(P.list().filter(x=>x.kind==="project").map(x=>x.id),lib);assert.equal(M.validateRecord(r),true);
    for(const id of allIds.filter(id=>!id.startsWith("preset_student"))){const descriptor=T.describe(r).find(t=>t.id===id);assert.equal(descriptor.renderer,"scalar");assert.equal(descriptor.repeatPolicy.kind,"attempt");assert.ok(descriptor.definitions.every(d=>d.entryScope==="attempt"));assert.deepEqual(copy(T.snapshots(r).find(t=>t.id===id).visualization),copy(lib.catalog.tests.find(t=>t.id===id).visualization));}
  });
  await test("handgrip selects each side's genuine maximum and records different selected attempts",()=>{
    const r=record(["preset_handgrip"]);trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50},{preset_handgrip_left_force:42}]);const before=copy(r),s=M.stats(r);
    near(s.values.preset_handgrip_left_force,45);near(s.values.preset_handgrip_right_force,50);
    const groups=s.repetitions.filter(g=>g.testId==="preset_handgrip");assert.equal(groups.length,2);assert.notEqual(groups[0].selectedIds[0],groups[1].selectedIds[0]);assert.deepEqual(copy(r),before);
  });
  await test("independent means use each side's valid attempts and CV retains its three-value requirement",()=>{
    const r=record(["preset_handgrip"]);r.mode="mean";trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50},{preset_handgrip_left_force:42}]);const s=M.stats(r);
    near(s.values.preset_handgrip_left_force,39);near(s.values.preset_handgrip_right_force,35);
    const groups=s.repetitions.filter(g=>g.testId==="preset_handgrip");assert.equal(groups[0].statistics[0].n,3);assert.equal(groups[1].statistics[0].n,2);assert.ok(Number.isFinite(groups[0].statistics[0].cv));
    const html=c.RingsideReport.render(c.RingsideReport.build(r));assert.match(html,/data-repeat-stat="preset_handgrip_left_force"/);assert.doesNotMatch(html,/data-repeat-stat="preset_handgrip_right_force"/);
  });
  await test("505 independently selects the shorter valid time for each turning foot",()=>{
    const r=record(["preset_cod_505"]);trial(r,"preset_cod_505",[{preset_cod_505_left_time:2.4,preset_cod_505_right_time:2.0},{preset_cod_505_left_time:2.1,preset_cod_505_right_time:2.3}]);const s=M.stats(r);near(s.values.preset_cod_505_left_time,2.1);near(s.values.preset_cod_505_right_time,2.0);
  });
  await test("grading direction cannot overwrite explicitly declared independent measurement selection",()=>{
    const r=record(["preset_handgrip"]);trial(r,"preset_handgrip",[{preset_handgrip_left_force:45},{preset_handgrip_left_force:30}]);const p=profileRule(r,"preset_handgrip_left_force");p.standards.find(s=>s.metricId==="preset_handgrip_left_force").direction="lower";
    near(M.stats(E.resolve(r,p)).values.preset_handgrip_left_force,45);
  });
  await test("changing independent selection direction invalidates the old rule while preserving raw observations",()=>{
    const r=record(["preset_handgrip"]);trial(r,"preset_handgrip",[{preset_handgrip_left_force:45},{preset_handgrip_left_force:30}]);const p=profileRule(r,"preset_handgrip_left_force"),raw=copy(r.data),basis=M.fingerprint(r);
    definition(r,"preset_handgrip_left_force").selectionDirection="lower";const out=E.resolve(r,p);near(M.stats(out).values.preset_handgrip_left_force,30);assert.equal(definition(out,"preset_handgrip_left_force").referenceEnabled,false);assert.notEqual(M.fingerprint(r),basis);assert.deepEqual(copy(r.data),raw);
  });
  await test("changing whole-trial versus independent selection alters the true measurement contract",()=>{
    const r=record(["preset_handgrip"]);trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50}]);const p=profileRule(r,"preset_handgrip_right_force"),basis=M.fingerprint(r);
    for(const list of [r.customTests,r.projectSnapshots])list.find(t=>t.id==="preset_handgrip").metricSelection="trial";
    const out=E.resolve(r,p);near(M.stats(out).values.preset_handgrip_right_force,20);assert.equal(definition(out,"preset_handgrip_right_force").referenceEnabled,false);assert.notEqual(M.fingerprint(r),basis);
  });
  await test("whole-trial ignores inactive individual directions and an explicit default remains equivalent",()=>{
    const r=record(["preset_handgrip"]);for(const list of [r.customTests,r.projectSnapshots]){const project=list.find(t=>t.id==="preset_handgrip");delete project.metricSelection;}
    trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50}]);const p=profileRule(r,"preset_handgrip_right_force"),basis=M.fingerprint(r),before=E.measurementContext(r,definition(r,"preset_handgrip_right_force"));
    definition(r,"preset_handgrip_right_force").selectionDirection="lower";for(const list of [r.customTests,r.projectSnapshots])list.find(t=>t.id==="preset_handgrip").metricSelection="trial";
    assert.equal(M.fingerprint(r),basis);assert.deepEqual(copy(E.measurementContext(r,definition(r,"preset_handgrip_right_force"))),copy(before));const out=E.resolve(r,p);assert.equal(definition(out,"preset_handgrip_right_force").referenceEnabled,true);near(M.stats(out).values.preset_handgrip_right_force,20);
  });
  await test("active whole-trial primary and direction changes affect selected data matching and narrative basis",()=>{
    for(const change of [project=>project.primaryMetricId="preset_handgrip_right_force",project=>project.selectionDirection="lower"]){const r=record(["preset_handgrip"]);for(const list of [r.customTests,r.projectSnapshots])list.find(t=>t.id==="preset_handgrip").metricSelection="trial";
      trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50}]);const p=profileRule(r,"preset_handgrip_right_force"),basis=M.fingerprint(r);for(const list of [r.customTests,r.projectSnapshots])change(list.find(t=>t.id==="preset_handgrip"));
      const out=E.resolve(r,p);near(M.stats(out).values.preset_handgrip_right_force,50);assert.equal(definition(out,"preset_handgrip_right_force").referenceEnabled,false);assert.notEqual(M.fingerprint(r),basis);}
  });
  await test("an old non-default whole-trial primary cannot return to a default using its earlier protocol standard",()=>{
    const r=record(["preset_handgrip"]);for(const list of [r.customTests,r.projectSnapshots]){const project=list.find(t=>t.id==="preset_handgrip");delete project.metricSelection;project.primaryMetricId="preset_handgrip_right_force";}
    trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50}]);r.narrative={...r.narrative,html:"<p>Original measurement review remains stored.</p>",text:"Original measurement review remains stored."};const p=profileRule(r,"preset_handgrip_right_force"),historical=copy(r),basis=M.fingerprint(r),resolvedData=copy(E.resolve(r,p).data);near(M.stats(r).values.preset_handgrip_right_force,50);
    for(const list of [r.customTests,r.projectSnapshots])Object.assign(list.find(t=>t.id==="preset_handgrip"),{metricSelection:"trial",primaryMetricId:"preset_handgrip_left_force"});r.protocolIdentities.preset_handgrip.version++;
    const out=E.resolve(r,p);near(M.stats(out).values.preset_handgrip_right_force,20);assert.equal(definition(out,"preset_handgrip_right_force").referenceEnabled,false);assert.notEqual(M.fingerprint(r),basis);assert.deepEqual(copy(out.data),resolvedData);assert.deepEqual(copy(r.data),historical.data);assert.deepEqual(copy(out.narrative),historical.narrative);
    const oldRecord=M.normalizeRecord(historical);near(M.stats(oldRecord).values.preset_handgrip_right_force,50);assert.equal(definition(E.resolve(oldRecord,p),"preset_handgrip_right_force").referenceEnabled,true);assert.deepEqual(copy(oldRecord.data),historical.data);assert.deepEqual(copy(oldRecord.narrative),historical.narrative);
  });
  await test("independent mode ignores the inactive whole-trial primary and direction",()=>{
    const r=record(["preset_handgrip"]);trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50}]);const p=profileRule(r,"preset_handgrip_right_force"),basis=M.fingerprint(r),before=E.measurementContext(r,definition(r,"preset_handgrip_right_force"));
    for(const list of [r.customTests,r.projectSnapshots])Object.assign(list.find(t=>t.id==="preset_handgrip"),{primaryMetricId:"preset_handgrip_right_force",selectionDirection:"lower"});
    assert.equal(M.fingerprint(r),basis);assert.deepEqual(copy(E.measurementContext(r,definition(r,"preset_handgrip_right_force"))),copy(before));const out=E.resolve(r,p);assert.equal(definition(out,"preset_handgrip_right_force").referenceEnabled,true);near(M.stats(out).values.preset_handgrip_right_force,50);
  });
  await test("all official sex and university-year tables have exact inclusive 90 80 and 60 boundaries",()=>{
    const lib=addedLibrary(),data=c.RingsidePresetSources.studentThresholds();
    for(const p of lib.evaluationProfiles.filter(p=>p.id.startsWith("preset_student"))){
      const key=p.id.replace("preset_student_2014_",""),item=P.list().find(x=>x.id===p.id),r=record(item.testIds,lib);r.athlete.sex=key.startsWith("male")?"男":"女";
      for(const [id,bounds]of [[item.testIds[0],data[key].sprint50],[item.testIds[1],data[key].longJump],[item.testIds[2],data[key].run]]){
        const metric=r.definitions.find(d=>d.testId===id),higher=id.includes("long_jump");
        for(const [i,label]of ["优秀","良好","及格"].entries()){trial(r,id,[{[metric.id]:bounds[i]}]);const out=E.resolve(r,p);assert.equal(M.evaluation(M.stats(out).values[metric.id],definition(out,metric.id),out).label,label);}
        trial(r,id,[{[metric.id]:bounds[2]+(higher?-0.01:0.01)}]);const out=E.resolve(r,p);assert.equal(M.evaluation(M.stats(out).values[metric.id],definition(out,metric.id),out).label,"不及格");
      }
    }
  });
  await test("unknown or wrong sex never receives an official student grade",()=>{
    const lib=addedLibrary(),p=lib.evaluationProfiles.find(p=>p.id==="preset_student_2014_male_y12"),r=record(["preset_sprint_50m"],lib);trial(r,"preset_sprint_50m",[{preset_sprint_50m_time:6.9}]);
    for(const sex of ["未注明","女"]){r.athlete.sex=sex;const out=E.resolve(r,p);assert.equal(definition(out,"preset_sprint_50m_time").referenceEnabled,false);assert.equal(M.evaluation(6.9,definition(out,"preset_sprint_50m_time"),out).status,"gray");}
  });
  await test("student schemes do not grade a global mean as a formal best-mode single-item result",()=>{
    const lib=addedLibrary(),p=lib.evaluationProfiles.find(p=>p.id==="preset_student_2014_male_y12"),r=record(["preset_sprint_50m"],lib);r.mode="mean";trial(r,"preset_sprint_50m",[{preset_sprint_50m_time:6.9},{preset_sprint_50m_time:7.3}]);const out=E.resolve(r,p);near(M.stats(out).values.preset_sprint_50m_time,7.1);assert.equal(definition(out,"preset_sprint_50m_time").referenceEnabled,false);
  });
  await test("university year is an explicit scheme choice and never guessed from age",()=>{
    const lib=addedLibrary(),r=record(["preset_sprint_50m"],lib);trial(r,"preset_sprint_50m",[{preset_sprint_50m_time:6.9}]);
    for(const age of [18,25,40]){r.athlete.age=age;for(const [id,label]of [["preset_student_2014_male_y12","优秀"],["preset_student_2014_male_y34","良好"]]){const out=E.resolve(r,lib.evaluationProfiles.find(p=>p.id===id));assert.equal(M.evaluation(6.9,definition(out,"preset_sprint_50m_time"),out).label,label);}}
  });
  await test("official rules cannot migrate to another distance unit or changed protocol identity",()=>{
    const lib=addedLibrary(),p=lib.evaluationProfiles.find(p=>p.id==="preset_student_2014_male_y12");
    for(const change of [r=>definition(r,"preset_sprint_50m_time").unit="ms",r=>r.protocolIdentities.preset_sprint_50m.version++]){const r=record(["preset_sprint_50m"],lib);trial(r,"preset_sprint_50m",[{preset_sprint_50m_time:6.9}]);change(r);assert.equal(definition(E.resolve(r,p),"preset_sprint_50m_time").referenceEnabled,false);}
    assert.ok(p.standards.every(rule=>rule.targetEnabled===false));assert.deepEqual(copy(p.aggregations),{});
  });
  await test("adding a scheme preserves an existing edited preset protocol and rejects its unmatched grade",()=>{
    const first=P.apply(existingLibrary(),["preset_sprint_50m"]).library,project=first.catalog.tests.find(t=>t.id==="preset_sprint_50m");project.name="Edited formal project";first.catalog.protocol.preset_sprint_50m="Synthetic changed timing trigger";first.catalog.protocolIdentities.preset_sprint_50m.version++;
    const before=copy(first.catalog),out=P.apply(first,["preset_student_2014_male_y12"]).library;assert.deepEqual(copy(out.catalog.tests.find(t=>t.id===project.id)),copy(project));assert.equal(out.catalog.protocol[project.id],before.protocol[project.id]);const r=record([project.id],out);trial(r,project.id,[{preset_sprint_50m_time:6.9}]);assert.equal(definition(E.resolve(r,out.evaluationProfiles.find(p=>p.id==="preset_student_2014_male_y12")),"preset_sprint_50m_time").referenceEnabled,false);
  });
  await test("non-positive preset distances times loads and forces remain raw but invalid for aggregation",()=>{
    for(const id of ["preset_sprint_10m","preset_standing_long_jump","preset_squat_1rm","preset_handgrip"]){const r=record([id]),d=r.definitions.find(d=>d.testId===id);trial(r,id,[{[d.id]:0},{[d.id]:-2}]);const raw=copy(r.data);for(const [i,row]of r.data[id].entries())assert.ok(M.validateField(r,`data.${id}.${i}.metrics.${d.id}`,row.metrics[d.id]));assert.equal(M.recordProgressDetail(r,id).status,"review");assert.equal(M.stats(r).values[d.id],undefined);assert.deepEqual(copy(r.data),raw);}
  });
  await test("ordinary signed custom measurements retain their earlier negative-value semantics",()=>{
    const r=record(["preset_sprint_10m"]),d=definition(r,"preset_sprint_10m_time");delete d.valueMinimum;delete d.zeroValid;d.name="Signed reach";d.direction="higher";d.selectionDirection="higher";for(const list of [r.customTests,r.projectSnapshots])list.find(t=>t.id===d.testId).selectionDirection="higher";
    trial(r,d.testId,[{[d.id]:-12},{[d.id]:-8}]);near(M.stats(r).values[d.id],-8);for(const [i,row]of r.data[d.testId].entries())assert.equal(M.validateField(r,`data.${d.testId}.${i}.metrics.${d.id}`,row.metrics[d.id]),"");
  });
  await test("presentation-only graph edits survive normalization and leave analysis fingerprints unchanged",()=>{
    const r=record(["preset_handgrip"]),basis=M.fingerprint(r),raw=copy(r.data);for(const list of [r.customTests,r.projectSnapshots])list.find(t=>t.id==="preset_handgrip").visualization={version:1,enabled:false,kind:"target",metricIds:[]};
    assert.equal(M.fingerprint(r),basis);const out=M.normalizeRecord(r);assert.deepEqual(copy(out.projectSnapshots.find(t=>t.id==="preset_handgrip").visualization),{version:1,enabled:false,kind:"target",metricIds:[]});assert.deepEqual(copy(out.data),raw);
  });
  await test("pre-existing libraries are not silently seeded or scientifically changed on hydration",()=>{
    const lib=existingLibrary(),before=old.RingsideEvaluation.migrate(copy(lib)),after=E.migrate(copy(lib));assert.deepEqual(copy(after),copy(before));
    const r=lib.athletes[0].records[0];assert.equal(M.fingerprint(r),old.RingsideModel.fingerprint(r));assert.deepEqual(copy(M.stats(r)),copy(old.RingsideModel.stats(r)));assert.ok(!after.catalog.tests.some(t=>t.id.startsWith("preset_")));
  });
  await test("shared catalog normalization remains idempotent after explicit additions",()=>{
    const lib=addedLibrary(),normalized=M.normalizeCatalog(lib.catalog);assert.equal(normalized.tests.filter(t=>t.id.startsWith("preset_")).length,12);assert.deepEqual(copy(M.normalizeCatalog(normalized)),copy(normalized));for(const d of normalized.definitions.filter(d=>d.id.startsWith("preset_"))){assert.equal(d.selectionDirection,d.direction);assert.equal(d.valueMinimum,0);}
  });
  await test("report projects expose actual same-path generic values and genuine left-right metadata",()=>{
    const r=record(["preset_handgrip"]);trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50}]);const report=c.RingsideReport.build(r),project=report.projects.find(p=>p.id==="preset_handgrip");
    near(project.metrics.find(m=>m.side==="left").value,45);near(project.metrics.find(m=>m.side==="right").value,50);assert.equal(project.metrics[0].pairId,project.metrics[1].pairId);assert.ok(report.genericVisuals.preset_handgrip.enabled);
  });
  await test("real Excel generation and parsing retain scalar attempts sides selection and raw units",async()=>{
    const lib=addedLibrary(),r=record(["preset_handgrip","preset_sprint_10m"],lib);r.evaluationProfileId="synthetic_excel";trial(r,"preset_handgrip",[{preset_handgrip_left_force:45,preset_handgrip_right_force:20},{preset_handgrip_left_force:30,preset_handgrip_right_force:50}]);trial(r,"preset_sprint_10m",[{preset_sprint_10m_time:1.9}]);
    const exported=await c.RingsideExcel.createTemplate({records:[r],prefill:true,schema:3});assert.ok(exported.bytes.length>1000);const parsed=await c.RingsideExcel.readTemplate(exported.bytes);assert.deepEqual(copy(parsed.errors),[]);const restored=parsed.entries[0].record;
    const measurements=rows=>copy(rows.map(({id,...row})=>row));assert.deepEqual(measurements(restored.data.preset_handgrip),measurements(r.data.preset_handgrip));assert.deepEqual(measurements(restored.data.preset_sprint_10m),measurements(r.data.preset_sprint_10m));assert.equal(restored.customTests.find(t=>t.id==="preset_handgrip").metricSelection,"independent");assert.equal(definition(restored,"preset_handgrip_left_force").unit,"kgf");near(M.stats(restored).values.preset_handgrip_left_force,45);near(M.stats(restored).values.preset_handgrip_right_force,50);
    const raw=copy(r),review=c.RingsideExcel.preview(parsed,{athletes:[{id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]}],catalog:lib.catalog,records:[r]});assert.deepEqual(copy(review.errors),[]);assert.ok(review.entries[0].projects.every(p=>p.identical&&p.defaultAction==="keep"));assert.equal(c.RingsideExcel.apply(review).records.length,0);assert.deepEqual(copy(r),raw);
  });
  await test("JSONL configuration and raw-record backup roundtrip persist explicit additions",async()=>{
    const lib=addedLibrary(),rows=[];for await(const row of c.RingsideStore.libraryRows(lib))rows.push(copy(row));const config=rows.find(r=>r.type==="config").value;
    assert.equal(config.catalog.tests.filter(t=>t.id.startsWith("preset_")).length,12);assert.equal(rows.filter(r=>r.type==="profile").length,lib.evaluationProfiles.length);
    const decoded=[];const blob=new Blob([rows.map(row=>JSON.stringify(row)).join("\n")+"\n"],{type:"application/x-ndjson"});for await(const row of c.RingsideStore.fileRows(blob))decoded.push(copy(row));
    assert.deepEqual(decoded,rows);assert.deepEqual(decoded.filter(r=>r.type==="record").map(r=>r.value),copy(lib.athletes.flatMap(a=>a.records)));
  });
  await test("the real repository hydrators read explicit catalog additions and old records from stored entities",async()=>{
    for(const lib of [existingLibrary(),addedLibrary()]){const store=c.RingsideStore,tables=new Map([["config",[store.configuration(lib)]],["athletes",lib.athletes.map(store.athleteMetadata)],["recordIndex",lib.athletes.flatMap(a=>a.records.map(store.summary))],["records",lib.athletes.flatMap(a=>a.records)],["groups",lib.groups],["profiles",lib.evaluationProfiles]]),repo=new store.Repository(null);repo.generation="synthetic-preset-generation";
      repo.get=async(table,id)=>copy(table==="config"?tables.get(table)[0]:tables.get(table).find(value=>(value.id||value.recordId)===id));repo.values=async table=>copy(tables.get(table));repo.versionState=async()=>({active:repo.generation,previous:"",revision:"synthetic-stable"});repo.batches=async function*(table){yield copy(tables.get(table));};
      const directory=await repo.directory();assert.deepEqual(copy(directory.catalog),copy(lib.catalog));assert.equal(directory.catalog.tests.filter(t=>t.id.startsWith("preset_")).length,lib.catalog.tests.filter(t=>t.id.startsWith("preset_")).length);assert.ok(repo.metadataHashes.get("config:library"));const hydrated=await repo.createLibrary();assert.deepEqual(copy(hydrated.catalog),copy(lib.catalog));assert.deepEqual(copy(hydrated.athletes),copy(lib.athletes));assert.deepEqual(copy(hydrated.evaluationProfiles),copy(lib.evaluationProfiles));
    }
  });
  console.log(passed+" preset catalog and measurement-contract model checks passed");
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
