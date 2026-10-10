"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
global.window=global;global.ExcelJS=require("../vendor/exceljs.min.js");
for(const name of ["calc","fvp","sprint-fvp","sprint-elasticity","sources","cpet-reference","definitions","tests","model","evaluation","interventions","excel"])vm.runInThisContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"));
const M=RingsideModel,F=RingsideFVP,S=RingsideSprintFVP,E=RingsideSprintElasticity,T=RingsideTests,X=RingsideExcel;
const {manifest,column}=require("./helpers/excel-template.cjs"),copy=value=>JSON.parse(JSON.stringify(value));
// Workbook-assigned row IDs and its empty manual-metric holder carry no measurement.
const rawData=value=>Array.isArray(value)?value.map(rawData):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key,item])=>key!=="id"&&!(key==="metrics"&&item&&Object.keys(item).length===0)).map(([key,item])=>[key,rawData(item)])):value;
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
let passed=0;async function test(name,run){await run();passed++;console.log("PASS "+name);}
function fixture(){
  const r=M.recordFromCatalog(M.normalizeCatalog(),{name:"Synthetic dual elasticity",sex:"男",sport:"测试"},{fvp_sj:true,fvp_cmj:true,sprint_fvp:true},"2026-10-11");
  r.athlete.mass=75;r.athlete.height=180;r.athlete.age=25;
  for(const id of ["fvp_sj","fvp_cmj"]){r.fvpConfig[id].distanceCm=35;r.data[id]=[0,20,40,60].map((load,i)=>({id:id+"_"+i,load,height:[38,29,21,15][i]}));}
  r.data.sprint_fvp=[{id:"synthetic_sprint",splits:[5,10,20,30,40].map((distanceM,i)=>({id:"split_"+i,distanceM,timeS:S.timeAtDistance(distanceM,9.5,1.15)})),excluded:false,notes:"Synthetic only"}];
  r.sprintFvpAnalysis.targetDistanceM=30;return M.normalizeRecord(r);
}
function settingsSheet(book){const spec=manifest(book).sheets?.find(sheet=>sheet.kind==="settings");return book.getWorksheet(spec?.name||"测试条件");}
function setSetting(book,key,value){const ws=settingsSheet(book);for(let i=2;i<=ws.rowCount;i++)if(ws.getCell(i,column(ws,"fieldId")).value===key){ws.getCell(i,column(ws,"value")).value=value;return;}throw Error("Missing "+key);}
async function workbook(r,schema=2){const out=await X.createTemplate({records:[r],prefill:true,schema}),book=new ExcelJS.Workbook();await book.xlsx.load(out.bytes);return book;}
function review(parsed,r,existing=[]){return X.preview(parsed,{athletes:[{id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]}],records:existing,catalog:M.normalizeCatalog()});}
const decisions=preview=>Object.fromEntries(preview.entries.map(entry=>[entry.recordId,{metadata:"replace",settings:"replace",projects:Object.fromEntries(entry.projects.map(project=>[project.id,"replace"]))}]));
(async()=>{
  await test("additive defaults preserve legacy measurement fingerprint and remain independently mutable",()=>{
    const r=fixture(),legacy=copy(r);for(const key of ["deltaForcePct","deltaVelocityPct","elasticityMethodVersion"])delete legacy.sprintFvpAnalysis[key];delete legacy.views.capabilityExpanded;for(const id of F.ids)delete legacy.fvpView[id].elasticityView;
    const reopened=M.normalizeRecord(legacy);assert.equal(M.fingerprint(legacy),M.fingerprint(reopened));assert.deepEqual(reopened.views.capabilityExpanded,{strength:false,reactive:false,speed:false,endurance:false});assert.equal(reopened.sprintFvpAnalysis.elasticityMethodVersion,E.METHOD_VERSION);
    for(const id of F.ids)assert.equal(reopened.fvpView[id].elasticityView,"response");assert.equal(reopened.sprintFvpView.elasticityView,"response");
    reopened.views.capabilityExpanded.strength=true;assert.equal(M.defaults().views.capabilityExpanded.strength,false);
  });
  await test("shared protocol resolver honors explicit partial data and otherwise prefers a valid protocol",()=>{
    const r=fixture();r.data.fvp_sj=r.data.fvp_sj.slice(0,2);delete r.views.fvpProtocol;let stats=M.stats(r);assert.equal(M.resolveJumpFvpProtocol(r,stats),"fvp_cmj");
    r.views.capabilitySelections.strength="jump_elasticity";let card=M.capabilityDirections(r,stats)[0];assert.equal(card.context.protocol,"fvp_cmj");near(card.value,stats.fvp.fvp_cmj.elasticity.ER);
    r.views.fvpProtocol="fvp_sj";stats=M.stats(r);card=M.capabilityDirections(r,stats)[0];assert.equal(M.resolveJumpFvpProtocol(r,stats),"fvp_sj");assert.equal(card.value,null);assert.equal(card.context.protocol,"fvp_sj");
    r.views.fvpProtocol="auto";assert.equal(M.resolveJumpFvpProtocol(r,stats),"fvp_cmj");r.enabled.fvp_cmj=false;assert.equal(M.resolveJumpFvpProtocol(r,M.stats(r)),"fvp_sj");r.data.fvp_sj=[];assert.equal(M.resolveJumpFvpProtocol(r,M.stats(r)),null);
  });
  await test("elasticity selections bind resolved jump protocol while view changes leave AI evidence stable",()=>{
    const r=fixture();r.views.capabilitySelections.strength="jump_elasticity";r.views.capabilitySelections.speed="sprint_elasticity";r.views.fvpProtocol="fvp_sj";
    const stats=M.stats(r),basis=M.capabilityDirectionsBasis(r,stats),fingerprint=M.fingerprint(r);assert.ok(stats.sprintElasticity.valid,stats.sprintElasticity.reason);
    const cards=M.capabilityDirections(r,stats);near(cards[0].value,stats.fvp.fvp_sj.elasticity.ER);near(cards[2].value,stats.sprintElasticity.elasticity.ER);assert.equal(cards[0].context.angle,90);assert.equal(cards[2].context.targetDistanceM,30);
    r.views.capabilityExpanded.strength=true;r.fvpView.fvp_sj.elasticityView="constraint";r.sprintFvpView.elasticityView="distance";r.sprintFvpView.responseForce=false;r.views.fvpProtocol="auto";
    assert.equal(M.fingerprint(r),fingerprint);assert.equal(M.capabilityDirectionsBasis(r),basis);r.views.fvpProtocol="fvp_cmj";assert.notEqual(M.capabilityDirectionsBasis(r),basis);
    r.sprintFvpAnalysis.deltaForcePct=5;assert.notEqual(M.fingerprint(r),fingerprint);r.sprintFvpAnalysis.deltaForcePct=0;r.sprintFvpAnalysis.elasticityMethodVersion="future-v2";assert.notEqual(M.fingerprint(r),fingerprint);
  });
  await test("fixed-height ER EN constraint retains height and distinguishes balanced from lowest EN",()=>{
    const r=fixture(),s=F.solve(r,"fvp_sj"),c=s.elasticityConstraint;assert.ok(c.valid);near(c.heightCm,s.current.heightCm);near(c.current.ER,s.elasticity.ER);near(c.balance.ER,1);
    const h=c.heightCm/100,d=s.model.distance;near(c.valley.ER,2*h/(d+h));
    for(const p of c.points){near(F.performance(p.F0,p.V0,d).heightCm,c.heightCm);near(p.ER,p.Fe/p.ve);near(p.EN,Math.hypot(p.Fe,p.ve));assert.ok(p.EN>=c.valley.EN-1e-10);}
    assert.ok(c.valley.EN<=c.balance.EN);r.fvpAnalysis.fvp_sj.angle=30;assert.deepEqual(F.solve(r,"fvp_sj").elasticityConstraint,c);
  });
  await test("current sprint elasticity remains independent of old optimum and finite gain scenarios",()=>{
    const r=fixture(),old=S.solve(r),s=M.stats(r);assert.ok(s.sprintElasticity.valid);assert.deepEqual(s.sprintFvp.model,old.model);assert.deepEqual(s.sprintFvp.optimum,old.optimum);
    r.sprintFvpAnalysis.deltaForcePct=7;r.sprintFvpAnalysis.deltaVelocityPct=3;const next=M.stats(r);assert.ok(next.sprintElasticity.scenario.valid);assert.ok(next.sprintElasticity.scenario.timeS<next.sprintElasticity.current.timeS);assert.deepEqual(next.sprintFvp.model,old.model);
    assert.ok(next.capabilityCards.find(card=>card.id==="strength").metrics.some(metric=>metric.id==="fvp_cmj_er"));assert.ok(next.capabilityCards.find(card=>card.id==="speed").metrics.some(metric=>metric.id==="sprint_elasticity_en"));
  });
  await test("empty scenario input is invalid while missing historical fields and zero remain supported",()=>{
    for(const path of ["fvpAnalysis.fvp_sj.deltaForcePct","fvpAnalysis.fvp_cmj.deltaVelocityPct","sprintFvpAnalysis.deltaForcePct","sprintFvpAnalysis.deltaVelocityPct"]){const r=fixture();for(const value of ["",null," ",-100,-101])assert.ok(M.validateField(r,path,value),path+" "+value);assert.equal(M.validateField(r,path,0),"");assert.equal(M.validateField(r,path,undefined),"");}
    const invalid=[r=>r.views.capabilityExpanded.strength="false",r=>r.fvpView.fvp_sj.elasticityView="distance",r=>r.sprintFvpView.elasticityView="constraint",r=>r.sprintFvpAnalysis.deltaForcePct="",r=>r.fvpAnalysis.fvp_sj.deltaForcePct=null];
    for(const change of invalid){const r=fixture();change(r);assert.throws(()=>M.validateRecord(r));}
    const legacy=fixture();delete legacy.sprintFvpAnalysis.deltaForcePct;delete legacy.fvpAnalysis.fvp_sj.deltaVelocityPct;assert.doesNotThrow(()=>M.validateRecord(legacy));assert.equal(M.normalizeRecord(legacy).sprintFvpAnalysis.deltaForcePct,0);
  });
  await test("future elasticity method and wind retain classic results while withholding elasticity",()=>{
    const r=fixture(),raw=copy(r.data.sprint_fvp);r.sprintFvpAnalysis.elasticityMethodVersion="future-v9";let s=M.stats(r);assert.ok(s.sprintFvp.valid);assert.equal(s.sprintElasticity.valid,false);assert.match(s.sprintElasticity.reason,/方法版本/);assert.deepEqual(r.data.sprint_fvp,raw);
    r.sprintFvpAnalysis.elasticityMethodVersion=E.METHOD_VERSION;r.sprintFvpConfig.windMps=1;s=M.stats(r);assert.ok(s.sprintFvp.valid);assert.equal(s.sprintElasticity.valid,false);assert.match(s.sprintElasticity.reason,/风/);
  });
  await test("factory aliases change entry and export names without rewriting snapshots or custom names",()=>{
    const r=fixture(),before=copy(r.projectSnapshots);for(const id of F.ids){const protocol=id==="fvp_cmj"?"CMJ":"SJ",builtin=T.builtins.find(t=>t.id===id);assert.equal(T.describe(r).find(t=>t.id===id).name,`跳跃FVP · ${protocol}`);assert.equal(T.displayName({...builtin,name:"Custom protocol name"},r),"Custom protocol name");assert.equal(T.displayName({...builtin,legacyCustom:true},r),builtin.name);}
    assert.deepEqual(T.snapshots(r),before);
  });
  await test("both XLSX schemas preserve scenarios views expansion selection protocol and raw data",async()=>{
    for(const schema of [1,2]){const r=fixture();r.views.fvpProtocol="fvp_cmj";r.views.capabilitySelections.strength="jump_elasticity";r.views.capabilitySelections.speed="sprint_elasticity";r.views.capabilityExpanded={strength:true,reactive:false,speed:true,endurance:true};r.fvpView.fvp_sj.elasticityView="constraint";r.sprintFvpView.elasticityView="distance";r.sprintFvpView.responseForce=false;r.sprintFvpAnalysis.deltaForcePct=7;r.sprintFvpAnalysis.deltaVelocityPct=3;
      const book=await workbook(r,schema),parsed=await X.readTemplate(await book.xlsx.writeBuffer());assert.deepEqual(parsed.errors,[]);const p=review(parsed,r),actual=X.apply(p,decisions(p)).records[0];assert.deepEqual(actual.sprintFvpAnalysis,r.sprintFvpAnalysis);assert.deepEqual(actual.sprintFvpView,r.sprintFvpView);for(const id of F.ids)assert.deepEqual(actual.fvpView[id],r.fvpView[id]);for(const id of [...F.ids,"sprint_fvp"])assert.deepEqual(rawData(actual.data[id]),rawData(r.data[id]));assert.deepEqual(actual.views.capabilitySelections,r.views.capabilitySelections);assert.deepEqual(actual.views.capabilityExpanded,r.views.capabilityExpanded);assert.equal(actual.views.fvpProtocol,"fvp_cmj");near(M.stats(actual).sprintElasticity.scenario.timeS,M.stats(r).sprintElasticity.scenario.timeS);
      const ws=settingsSheet(book),strengthRow=Array.from({length:ws.rowCount-1},(_,i)=>i+2).find(i=>ws.getCell(i,column(ws,"fieldId")).value==="views.capabilitySelections.strength");assert.ok(String(ws.getCell(strengthRow,column(ws,"choices")).value).includes("跳跃FVP弹性框架"));
    }
  });
  await test("XLSX reports cleared scenario at its cell and allows explicit auto protocol",async()=>{
    const r=fixture(),book=await workbook(r);setSetting(book,"sprintFvpAnalysis.deltaForcePct","");const ws=settingsSheet(book),row=Array.from({length:ws.rowCount-1},(_,i)=>i+2).find(i=>ws.getCell(i,column(ws,"fieldId")).value==="sprintFvpAnalysis.deltaForcePct"),address=ws.getCell(row,column(ws,"value")).address;
    const parsed=await X.readTemplate(await book.xlsx.writeBuffer());assert.ok(parsed.errors.some(e=>e.address===address&&/变化百分比/.test(e.message)));
    setSetting(book,"sprintFvpAnalysis.deltaForcePct",0);setSetting(book,"views.fvpProtocol","自动选择有效协议");const good=await X.readTemplate(await book.xlsx.writeBuffer());assert.deepEqual(good.errors,[]);const p=review(good,r),actual=X.apply(p,decisions(p)).records[0];assert.equal(actual.views.fvpProtocol,"auto");assert.equal(M.resolveJumpFvpProtocol(actual,M.stats(actual)),"fvp_sj");
  });
  await test("actual historical XLSX schemas preserve new existing settings that were never supplied",async()=>{
    const directory=path.join(__dirname,"fixtures/sprint-display-v2173"),library=JSON.parse(fs.readFileSync(path.join(directory,"baseline-sprint-library.json"),"utf8")),baseline=library.athletes[0].records[0];
    for(const schema of [1,2]){const r=M.normalizeRecord(copy(baseline));r.data.sprint_fvp[0].splits[0].timeS+=.01;Object.assign(r.sprintFvpAnalysis,{deltaForcePct:7,deltaVelocityPct:3});Object.assign(r.sprintFvpView,{elasticityView:"distance",responseForce:false,responseVelocity:false,responseBoth:false});r.views.capabilityExpanded={strength:true,reactive:true,speed:true,endurance:true};
      const parsed=await X.readTemplate(fs.readFileSync(path.join(directory,`baseline-sprint-schema${schema}.xlsx`)));assert.deepEqual(parsed.errors,[]);for(const key of ["deltaForcePct","deltaVelocityPct","elasticityMethodVersion"])assert.equal(parsed.entries[0].record.sprintFvpAnalysis[key],undefined);
      const p=X.preview(parsed,{athletes:[{id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]}],records:[r],catalog:copy(library.catalog)});assert.deepEqual(p.errors,[]);assert.ok(p.entries[0].projects.find(project=>project.id==="sprint_fvp").conditionChanges.every(item=>!/^sprintFvpAnalysis\.(delta|elasticity)/.test(item.field)));
      const actual=X.apply(p,decisions(p)).records[0];assert.deepEqual(actual.sprintFvpAnalysis,r.sprintFvpAnalysis);assert.deepEqual(actual.sprintFvpView,r.sprintFvpView);assert.deepEqual(actual.views.capabilityExpanded,r.views.capabilityExpanded);
    }
  });
  console.log(passed+" dual elasticity model/Excel checks passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
