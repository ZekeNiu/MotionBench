"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
global.window=global;global.ExcelJS=require("../vendor/exceljs.min.js");
for(const name of ["calc","sprint-fvp","fvp","cpet-reference","definitions","tests","scoring", "model","evaluation","interventions","excel"])vm.runInThisContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"));
// Expose the existing catalog merge only in this test VM; IndexedDB is not mocked as a browser validation.
vm.runInThisContext(fs.readFileSync(path.join(__dirname,"../src/ringside-store.js"),"utf8").replace("  function validateTestPlans(","  root.testSprintCatalogMerge=mergeCatalog;\n  function validateTestPlans("));
const M=RingsideModel,T=RingsideTests,F=RingsideSprintFVP,X=RingsideExcel,E=RingsideEvaluation,S=RingsideStore;
const {manifest,column,firstRow}=require("./helpers/excel-template.cjs"),copy=value=>JSON.parse(JSON.stringify(value)),sha=value=>crypto.createHash("sha256").update(value).digest("hex");
const fixtureDir=path.join(__dirname,"fixtures/sprint-display-v2173"),library=JSON.parse(fs.readFileSync(path.join(fixtureDir,"baseline-sprint-library.json"),"utf8")),legacy=library.athletes[0].records[0],proof=JSON.parse(fs.readFileSync(path.join(fixtureDir,"baseline-fixtures.json"),"utf8"));
const metricKeys=["F0","V0","Pmax","F0Absolute","PmaxAbsolute","slope","RFmax","DRF","Vmax","endVelocity","Vopt"];
let passed=0;const results=[],pointComparisons=[];
async function test(name,run){await run();passed++;results.push({name,passed:true});console.log("PASS "+name);}
const record=()=>M.normalizeRecord(copy(legacy));
function choice(){return M.normalizeSprintFvpView({fv:false,pv:true,optimum:false,confidence:true,metrics:{F0:false,RFmax:false,Vopt:false},future:{retain:"display-only"}});}
function physicalProjection(solved){const {samples,...model}=solved.model;return {fit:solved.fit,model,optimum:solved.optimum,imbalance:solved.imbalance,atmosphere:solved.atmosphere,heightCm:solved.heightCm,mass:solved.mass,targetDistanceM:solved.targetDistanceM,window:solved.window,samplesSha256:sha(JSON.stringify(solved.samples)),curveSha256:sha(JSON.stringify(solved.curve)),optimalCurveSha256:sha(JSON.stringify(solved.optimalCurve??null))};}
function review(parsed,r,existing=[]){return X.preview(parsed,{athletes:[{id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]}],records:existing,catalog:copy(library.catalog)});}
function decisions(preview){return Object.fromEntries(preview.entries.map(entry=>[entry.recordId,{metadata:"replace",settings:"replace",projects:Object.fromEntries(entry.projects.map(project=>[project.id,"replace"]))}]));}
// Excel assigns its own technical row IDs; compare persisted measurement and trial metadata separately from those IDs.
function trialData(rows){return rows.map(({id,splits,...trial})=>({...trial,splits:splits.map(({id,...split})=>split)}));}
async function bookFrom(bytes){const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);return book;}
const parse=book=>book.xlsx.writeBuffer().then(bytes=>X.readTemplate(bytes));
function converted(r,result){assert.equal(result.ok,true,result.reason);return {...r,data:{...r.data,sprint_fvp:result.trials},sprintFvpConfig:{...r.sprintFvpConfig,inputTimeMode:result.inputTimeMode}};}
function sampled(distances){const r=record();r.sprintFvpAnalysis.targetDistanceM="";r.data.sprint_fvp=[{id:"synthetic_free_splits",splits:distances.map((distanceM,i)=>({id:"synthetic_split_"+i,distanceM,timeS:F.timeAtDistance(distanceM,9.5,1.15)})),excluded:false,notes:"Synthetic only"}];return r;}
(async()=>{
  await test("display defaults independently enable three curves and eleven parameters with CI off",()=>{
    const a=M.sprintFvpViewDefaults(),b=M.sprintFvpViewDefaults();assert.deepEqual(Object.keys(a.metrics),metricKeys);assert.equal(new Set(M.sprintFvpMetricKeys).size,11);
    for(const key of ["fv","pv","optimum"])assert.equal(a[key],true);assert.equal(a.confidence,false);assert.equal(a.confidenceMethodVersion,"sprint-fvp-pointwise-delta-v1");assert.equal(a.confidenceLevel,.95);assert.ok(Object.values(a.metrics).every(value=>value===true));a.metrics.F0=false;assert.equal(b.metrics.F0,true);
  });
  await test("historical records gain display defaults without changing raw measurement or timing settings",()=>{
    assert.equal(Object.hasOwn(legacy,"sprintFvpView"),false);const r=record();assert.deepEqual(r.sprintFvpView,M.sprintFvpViewDefaults());assert.deepEqual(trialData(r.data.sprint_fvp),trialData(legacy.data.sprint_fvp));
    for(const key of ["recordId","athleteId","enabled","sprintFvpConfig"])assert.deepEqual(r[key],legacy[key],key);
    assert.deepEqual(r.projectSnapshots.map(({selectionDirection,...project})=>project),legacy.projectSnapshots);
    assert.deepEqual(r.sprintFvpAnalysis,{...legacy.sprintFvpAnalysis,deltaForcePct:0,deltaVelocityPct:0,elasticityMethodVersion:"li-2026-sprint-elasticity-forward1-v1"});
    assert.equal(M.fingerprint(r),M.fingerprint(legacy));
  });
  await test("false-only normalization preserves unknown fields and future CI declarations idempotently",()=>{
    const raw={fv:false,pv:0,optimum:null,confidence:true,confidenceMethodVersion:"future-v9",confidenceLevel:.9,metrics:{F0:false,V0:null,extra:{keep:1}},extra:{keep:2}};
    const actual=M.normalizeSprintFvpView(raw);assert.equal(actual.fv,false);assert.equal(actual.pv,true);assert.equal(actual.optimum,true);assert.equal(actual.metrics.F0,false);assert.equal(actual.metrics.V0,true);assert.deepEqual(actual.metrics.extra,{keep:1});assert.deepEqual(actual.extra,{keep:2});assert.equal(actual.confidenceMethodVersion,"future-v9");assert.equal(actual.confidenceLevel,.9);assert.deepEqual(M.normalizeSprintFvpView(actual),actual);assert.equal(M.normalizeSprintFvpView({confidence:1}).confidence,false);
  });
  await test("native persisted view rejects malformed known types while preserving valid unknown extensions",()=>{
    const good=record();good.sprintFvpView=choice();assert.doesNotThrow(()=>M.validateRecord(good));
    const invalid=[[],{fv:"false"},{confidence:1},{metrics:[]},{metrics:{DRF:0}},{confidenceMethodVersion:1},{confidenceLevel:0},{confidenceLevel:1},{confidenceLevel:"invalid"}];
    for(const view of invalid){const r=record();r.sprintFvpView=view;assert.throws(()=>M.validateRecord(r),undefined,JSON.stringify(view));}
  });
  await test("public alias keeps raw builtin, catalog, snapshots and user custom names unchanged",()=>{
    const builtin=T.builtins.find(test=>test.id==="sprint_fvp"),raw=copy(builtin),r=record();assert.equal(T.displayName(builtin,r),"冲刺FVP");assert.equal(T.describe(r).find(test=>test.id===builtin.id).name,"冲刺FVP");assert.deepEqual(builtin,raw);
    assert.equal(T.snapshots(r).find(test=>test.id===builtin.id).name,legacy.projectSnapshots.find(test=>test.id===builtin.id).name);assert.equal(T.snapshots(library.catalog).find(test=>test.id===builtin.id).name,library.catalog.tests.find(test=>test.id===builtin.id).name);
    assert.equal(T.displayName({...builtin,name:"My custom sprint"},r),"My custom sprint");assert.equal(T.displayName({...builtin,legacyCustom:true},r),builtin.name);const custom=copy(r);custom.customTests=[{...builtin,legacyCustom:true}];assert.equal(T.displayName(builtin,custom),builtin.name);assert.equal(T.describe(custom).find(test=>test.id===builtin.id).renderer,"scalar");
  });
  await test("actual historical catalog merges with current defaults without a false sprint name conflict",()=>{
    for(const reverse of [false,true]){const old=copy(library.catalog),current=M.normalizeCatalog();const local=reverse?old:current,incoming=reverse?current:old,before=copy(incoming);testSprintCatalogMerge(local,incoming);assert.equal(local.conflicts.length,0);assert.deepEqual(incoming,before);assert.equal(local.tests.find(test=>test.id==="sprint_fvp").name,T.builtins.find(test=>test.id==="sprint_fvp").name);}
  });
  await test("display choices preserve measurement fingerprint, selected-direction basis and physical estimates",()=>{
    const r=record(),before=M.fingerprint(r),basis=M.capabilityDirectionsBasis(r),physical=physicalProjection(F.solve(r)),snapshot=copy(r.projectSnapshots);r.sprintFvpView=choice();assert.equal(M.fingerprint(r),before);assert.equal(M.capabilityDirectionsBasis(r),basis);assert.deepEqual(physicalProjection(F.solve(r)),physical);const reopened=M.normalizeRecord(copy(r));assert.equal(M.fingerprint(reopened),before);assert.deepEqual(reopened.projectSnapshots,snapshot);assert.deepEqual(reopened.sprintFvpView,r.sprintFvpView);
  });
  await test("record envelope, evaluation materialization and JSONL serialization preserve display choices",async()=>{
    const r=record();r.sprintFvpView=choice();const reopened=M.normalizeRecord(JSON.parse(JSON.stringify(M.recordEnvelope(r))).record);assert.deepEqual(reopened.sprintFvpView,r.sprintFvpView);assert.deepEqual(E.materialize(reopened).sprintFvpView,r.sprintFvpView);
    const lib=E.migrate(M.recordEnvelope(r)),rows=[];for await(const row of S.libraryRows(lib))rows.push(row);const text=rows.map(row=>JSON.stringify(row)).join("\n"),decoded=[];for await(const row of S.fileRows(new Blob([text+"\n"])))decoded.push(row);assert.deepEqual(decoded.find(row=>row.type==="record").value.sprintFvpView,r.sprintFvpView);assert.deepEqual(M.normalizeRecord(decoded.find(row=>row.type==="record").value).sprintFvpView,r.sprintFvpView);
  });
  await test("all trial timing conversions are atomic and preserve physical times, exclusions and metadata",()=>{
    const r=record();r.data.sprint_fvp.push({...copy(r.data.sprint_fvp[0]),id:"synthetic_excluded",excluded:true,exclusionReason:"Synthetic",future:{keep:1}});r.sprintFvpConfig.timeCorrectionS=.1;r.sprintFvpConfig.positionStartM=1;
    const before=copy(r),interval=converted(r,M.convertSprintTimeMode(r,"interval")),back=converted(interval,M.convertSprintTimeMode(interval,"cumulative"));assert.deepEqual(r,before);assert.equal(interval.data.sprint_fvp[0].splits[1].timeS,before.data.sprint_fvp[0].splits[1].timeS-before.data.sprint_fvp[0].splits[0].timeS);
    back.data.sprint_fvp.forEach((trial,i)=>{assert.deepEqual({...trial,splits:undefined},{...before.data.sprint_fvp[i],splits:undefined});trial.splits.forEach((split,j)=>{assert.ok(Math.abs(split.timeS-before.data.sprint_fvp[i].splits[j].timeS)<1e-12);assert.equal(split.distanceM,before.data.sprint_fvp[i].splits[j].distanceM);assert.equal(split.id,before.data.sprint_fvp[i].splits[j].id);});});
    assert.deepEqual(interval.sprintFvpConfig,{...before.sprintFvpConfig,inputTimeMode:"interval"});const a=F.solve(r),b=F.solve(interval);assert.equal(a.valid,true);assert.equal(b.valid,true);for(const key of ["F0","V0","Pmax","RFmax","DRF"])assert.ok(Math.abs(a.model[key]-b.model[key])<1e-10,key);
  });
  await test("empty trials and complete timed prefixes with trailing blanks safely change mode",()=>{
    const r=record();r.data.sprint_fvp[0].splits.push({id:"blank_last",distanceM:50,timeS:"",future:{retain:true}});r.data.sprint_fvp.push({id:"empty_trial",splits:[{distanceM:"",timeS:""},{distanceM:10,timeS:null}],notes:"Empty"});const before=copy(r),result=M.convertSprintTimeMode(r,"interval");assert.equal(result.ok,true);assert.deepEqual(result.trials[1],before.data.sprint_fvp[1]);assert.deepEqual(result.trials[0].splits.at(-1),before.data.sprint_fvp[0].splits.at(-1));assert.deepEqual(r,before);
    const same=M.convertSprintTimeMode(r,"cumulative");assert.equal(same.ok,true);assert.deepEqual(same.trials,r.data.sprint_fvp);assert.notEqual(same.trials,r.data.sprint_fvp);
  });
  await test("gaps and invalid values reject the entire timing conversion without reinterpreting any trial",()=>{
    const mutations=[r=>r.data.sprint_fvp[0].splits[0].timeS="",r=>r.data.sprint_fvp[0].splits[2].timeS="",r=>r.data.sprint_fvp[0].splits[2].timeS=0,r=>r.data.sprint_fvp[0].splits[2].timeS="bad",r=>r.data.sprint_fvp[0].splits[2].timeS=1,r=>r.data.sprint_fvp[0].splits[2].distanceM=4,r=>r.data.sprint_fvp[0].splits[2].timeS=Infinity];
    for(const mutate of mutations){const r=record();r.data.sprint_fvp.push({...copy(r.data.sprint_fvp[0]),id:"late_invalid"});mutate(r);const before=structuredClone(r),result=M.convertSprintTimeMode(r,"interval");assert.equal(result.ok,false);assert.ok(result.reason);assert.deepEqual(r,before);}
    const r=record();r.data.sprint_fvp.push({id:"late_invalid",splits:[{distanceM:5,timeS:0}]});assert.equal(M.convertSprintTimeMode(r,"interval").ok,false);assert.equal(M.convertSprintTimeMode(r,"unknown").ok,false);
  });
  await test("free four-or-more split profiles at 20, 30 and 40 m retain identifiable finite fits",()=>{
    for(const distances of [[5,10,15,20],[5,10,20,30],[5,10,20,40],[2,7,19,32],[15,20,30,40]]){const solved=F.solve(sampled(distances));assert.equal(solved.valid,true,JSON.stringify({distances,reason:solved.reason}));assert.ok(Math.abs(solved.fit.vmax-9.5)<1e-4);assert.ok(Math.abs(solved.fit.tau-1.15)<1e-4);assert.equal(solved.targetDistanceM,distances.at(-1));assert.ok(Number.isFinite(solved.model.Pmax));}
  });
  await test("three splits and invalid monotonic times still fail with an explicit reason",()=>{
    for(const r of [sampled([20,30,40]),sampled([5,10,20,30])]){if(r.data.sprint_fvp[0].splits.length===4)r.data.sprint_fvp[0].splits[2].timeS=r.data.sprint_fvp[0].splits[1].timeS;const solved=F.solve(r);assert.equal(solved.valid,false);assert.ok(solved.reason);}
  });
  await test("actual baseline point-estimate oracle remains exact for standard, uneven, wind and height override cases",()=>{
    const oracle=JSON.parse(fs.readFileSync(path.join(fixtureDir,"baseline-point-oracle.json"),"utf8"));assert.equal(oracle.baselineRef,"7dfee7c4");assert.equal(oracle.cases.length,4);assert.equal(oracle.syntheticOnly,true);
    for(const item of oracle.cases){const solved=F.solve(item.record),actual=physicalProjection(solved);assert.equal(solved.valid,true,item.name);assert.deepEqual(actual,item.expected,item.name);pointComparisons.push({name:item.name,exact:true,baseline:item.expected,actual});}
  });
  await test("new actual XLSX schema 1 and 2 roundtrip curves, all metrics and future display metadata",async()=>{
    for(const schema of [1,2]){const r=record();r.sprintFvpView={...choice(),confidenceMethodVersion:"future-display-ci",confidenceLevel:.9,metrics:{...choice().metrics,futureMetric:{keep:1}}};const exported=await X.createTemplate({records:[r],prefill:true,schema}),book=await bookFrom(exported.bytes);assert.ok(book.worksheets.some(sheet=>sheet.name.includes("冲刺FVP")));const parsed=await X.readTemplate(exported.bytes);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,r);assert.deepEqual(preview.errors,[]);const actual=X.apply(preview,decisions(preview)).records[0];assert.deepEqual(actual.sprintFvpView,r.sprintFvpView);assert.deepEqual(trialData(actual.data.sprint_fvp),trialData(r.data.sprint_fvp));assert.equal(actual.sprintFvpAnalysis.targetDistanceM,60);}
  });
  await test("XLSX display setting rows are independently editable and missing old views export safe defaults",async()=>{
    const r=copy(legacy),exported=await X.createTemplate({records:[r],prefill:true}),book=await bookFrom(exported.bytes),info=manifest(book),sheet=book.getWorksheet(info.sheets.find(spec=>spec.kind==="settings").name),rows=new Map();
    for(let row=firstRow(sheet);row<=sheet.rowCount;row++)rows.set(sheet.getCell(row,column(sheet,"fieldId")).value,row);
    for(const key of ["fv","pv","optimum","confidence",...metricKeys.map(key=>"metrics."+key)]){const row=rows.get("sprintFvpView."+key);assert.ok(row,key);assert.notEqual(sheet.getCell(row,column(sheet,"value")).value,"");}
    sheet.getCell(rows.get("sprintFvpView.fv"),column(sheet,"value")).value=false;sheet.getCell(rows.get("sprintFvpView.metrics.DRF"),column(sheet,"value")).value=false;const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,r),actual=X.apply(preview,decisions(preview)).records[0];assert.equal(actual.sprintFvpView.fv,false);assert.equal(actual.sprintFvpView.metrics.DRF,false);assert.equal(actual.sprintFvpView.optimum,true);assert.equal(actual.sprintFvpView.confidence,false);
  });
  await test("actual historical schema 1 and 2 XLSX fixtures retain raw inputs and adopt display defaults on new records",async()=>{
    assert.equal(proof.baselineRef,"7dfee7c4");assert.equal(proof.syntheticOnly,true);assert.equal(proof.viewFieldPresent,false);
    for(const output of proof.outputs){const bytes=fs.readFileSync(path.join(fixtureDir,output.name));assert.equal(sha(bytes),output.sha256);assert.equal(bytes.length,output.bytes);const parsed=await X.readTemplate(bytes);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.entries[0].record.sprintFvpView,undefined);const preview=review(parsed,legacy);assert.deepEqual(preview.errors,[]);const actual=X.apply(preview,decisions(preview)).records[0];assert.deepEqual(actual.sprintFvpView,M.sprintFvpViewDefaults());assert.deepEqual(trialData(actual.data.sprint_fvp),trialData(legacy.data.sprint_fvp));assert.deepEqual(actual.sprintFvpConfig,legacy.sprintFvpConfig);assert.equal(actual.sprintFvpAnalysis.targetDistanceM,60);assert.equal(T.describe(actual).find(test=>test.id==="sprint_fvp").name,"冲刺FVP");}
  });
  await test("old XLSX without view settings preserves an existing nondefault view during actual measurement replacement",async()=>{
    for(const output of proof.outputs){const existing=record();existing.sprintFvpView=choice();existing.data.sprint_fvp[0].splits[0].timeS+=.01;const parsed=await X.readTemplate(fs.readFileSync(path.join(fixtureDir,output.name))),preview=review(parsed,existing,[existing]);assert.deepEqual(preview.errors,[]);assert.ok(preview.entries[0].projects.find(project=>project.id==="sprint_fvp").conditionChanges.every(change=>!String(change.field).startsWith("sprintFvpView.")));const actual=X.apply(preview,decisions(preview)).records[0];assert.ok(actual);assert.deepEqual(actual.sprintFvpView,existing.sprintFvpView);assert.deepEqual(trialData(actual.data.sprint_fvp),trialData(legacy.data.sprint_fvp));}
  });
  await test("historical schema 1 rejects simultaneous old and current project sheet names",async()=>{
    const book=await bookFrom(fs.readFileSync(path.join(fixtureDir,"baseline-sprint-schema1.xlsx"))),current=await bookFrom((await X.createTemplate({records:[record()],prefill:true,schema:1})).bytes),newName=current.worksheets.find(sheet=>sheet.name.includes("冲刺FVP")).name;book.addWorksheet(newName);const parsed=await parse(book);assert.ok(parsed.errors.length>0);assert.ok(parsed.errors.some(error=>/多个|重复|歧义/.test(error.message)));
  });
  const out=path.join(__dirname,"../output/tests/v2.17.5-sprint-view"),suiteSha256=sha(fs.readFileSync(__filename)),sources=Object.fromEntries(["model","tests","excel","sprint-fvp","store"].map(name=>["src/ringside-"+name+".js",sha(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js")))]));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"model-test-results.json"),JSON.stringify({suite:path.basename(__filename),suiteSha256,syntheticOnly:true,passed,results,fixtureHashes:proof.outputs.map(output=>({name:output.name,sha256:output.sha256})),sources},null,2)+"\n");
  const oracle=JSON.parse(fs.readFileSync(path.join(fixtureDir,"baseline-point-oracle.json"),"utf8"));fs.writeFileSync(path.join(out,"point-estimate-baseline-comparison.json"),JSON.stringify({baselineRef:oracle.baselineRef,syntheticOnly:true,suiteSha256,baselineSources:oracle.sourceHashes,currentSources:sources,exactCases:pointComparisons.length,cases:pointComparisons},null,2)+"\n");console.log(passed+" sprint display/model/legacy Excel checks passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
