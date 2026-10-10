"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
global.window = global; global.ExcelJS = require("../vendor/exceljs.min.js");
for (const name of ["calc", "sprint-fvp", "fvp", "cpet-reference", "definitions", "tests", "model", "evaluation", "interventions", "excel", "entry-session", "sprint-fvp-entry"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"));
const M = RingsideModel, X = RingsideExcel, F = RingsideSprintFVP, S = RingsideEntrySession, E = RingsideSprintFVPEntry;
const {manifest, column} = require("./helpers/excel-template.cjs"), copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log("PASS " + name); }
function seed() {
  const catalog = M.normalizeCatalog(); catalog.tests.find(test => test.id === "sprint_fvp").disabled = false;
  const record = M.recordFromCatalog(catalog, {name:"Synthetic Sprint Excel", sport:"测试", sex:"男"}, {sprint_fvp:true, cmj:true}, "2026-10-10");
  record.athlete.mass = 75; record.athlete.height = 180; record.athlete.age = 25;
  return {record, catalog};
}
function fill(record, interval = false) {
  const distances = [5,10,20,30,40], times = distances.map(distance => F.timeAtDistance(distance, 9.5, 1.15));
  record.sprintFvpConfig = {...F.defaultsConfig(), device:"Synthetic gates A", heightCm:182, inputTimeMode:interval ? "interval" : "cumulative", temperatureC:18, pressureHpa:995, timeCorrectionS:0, windMps:0};
  record.sprintFvpAnalysis.targetDistanceM = 60;
  record.views.capabilitySelections = {strength:"idsi_fixed250", reactive:"hop_rsi", speed:"srr"};
  record.data.sprint_fvp = [
    {id:"synthetic_fast",splits:distances.map((distanceM,i) => ({distanceM,timeS:interval ? times[i] - (times[i-1] || 0) : times[i]})),excluded:false,exclusionReason:"",notes:'完整试次 "A" & <合成>'},
    {id:"synthetic_excluded",splits:distances.map((distanceM,i) => ({distanceM,timeS:interval ? times[i] - (times[i-1] || 0) + .02 : times[i] + .02 * (i+1)})),excluded:true,exclusionReason:"合成异常试次",notes:"保留原始分段"},
  ];
  record.data.cmj = [{id:"synthetic_cmj",height:42,notes:"原有项目"}];
  return record;
}
async function workbook(record, prefill = true, schema = 2) {
  const exported = await X.createTemplate({records:[record], prefill, schema}), book = new ExcelJS.Workbook();
  await book.xlsx.load(exported.bytes); return {book, exported};
}
function sprintSheet(book) { const info = manifest(book); return info.schema === 2 ? book.getWorksheet(info.sheets.find(sheet => sheet.kind === "sprintSplits").name) : book.worksheets.find(sheet => /分段计时冲刺/.test(sheet.name)); }
const set = (sheet, row, key, value) => {sheet.getCell(row,column(sheet,key)).value=value;};
const parse = book => book.xlsx.writeBuffer().then(bytes => X.readTemplate(bytes));
function review(parsed, record, catalog, existing = []) {
  return X.preview(parsed, {athletes:[{id:record.athleteId,name:record.athlete.name,profile:M.profileFromRecord(record),records:[]}],records:existing,catalog});
}
function decisions(preview) {return Object.fromEntries(preview.entries.map(entry => [entry.recordId,{metadata:"replace",settings:"replace",projects:Object.fromEntries(entry.projects.map(project => [project.id,"replace"]))}]));}
const trialData = rows => rows.map(({splits,excluded,exclusionReason,notes}) => ({splits:splits.map(({id,...raw})=>raw),excluded,exclusionReason,notes}));
function verify(actual, expected) {
  assert.deepEqual(trialData(actual.data.sprint_fvp),trialData(expected.data.sprint_fvp));
  assert.deepEqual(actual.sprintFvpConfig,expected.sprintFvpConfig); assert.deepEqual(actual.sprintFvpAnalysis,expected.sprintFvpAnalysis);
  assert.deepEqual(actual.views.capabilitySelections,expected.views.capabilitySelections);
  const before=F.solve(expected),after=F.solve(actual);assert.equal(before.valid,true);assert.equal(after.valid,true);
  for(const key of ["F0","V0","Pmax","RFmax","DRF"]) assert.ok(Math.abs(before.model[key]-after.model[key])<1e-10,key);
  assert.equal(after.selected.index,0);assert.equal(after.targetDistanceM,60);assert.equal(actual.data.cmj[0].height,42);
}
(async () => {
  await test("cumulative and interval actual XLSX preserve complete trials, exclusions, all settings and calculations",async()=>{
    for(const interval of [false,true]) {const {record,catalog}=seed();fill(record,interval);const {exported}=await workbook(record);const parsed=await X.readTemplate(exported.bytes);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog),actual=X.apply(preview,decisions(preview)).records[0];verify(actual,record);}
  });
  await test("blank distance scaffold and protocol settings create no measured record",async()=>{
    const {record,catalog}=seed(),{book}=await workbook(record,false),ws=sprintSheet(book);assert.equal(ws.rowCount-1,12);
    const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog);assert.equal(preview.entries[0].projects.find(project=>project.id==="sprint_fvp").newCount,0);assert.equal(X.apply(preview).records.length,0);
  });
  await test("default four-split workbook imports a valid profile without deleting a scaffold row",async()=>{
    const {record,catalog}=seed(),{book}=await workbook(record,false),ws=sprintSheet(book);
    for(let index=0;index<4;index++) {const distance=ws.getCell(index+2,column(ws,"distanceM")).value;set(ws,index+2,"timeS",F.timeAtDistance(distance,9.5,1.15));}
    const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog),actual=X.apply(preview).records[0];
    assert.deepEqual(actual.data.sprint_fvp[0].splits.map(split=>split.distanceM),[5,10,20,30]);assert.equal(F.solve(actual).valid,true);
    assert.ok(actual.data.sprint_fvp[0].splits.every(split=>split.id));
  });
  await test("explicit negative reaction-time correction survives XLSX without changing raw cumulative times",async()=>{
    const {record,catalog}=seed();fill(record);record.sprintFvpConfig.timingStart="start_signal";record.sprintFvpConfig.startConvention="start_signal";record.sprintFvpConfig.timeCorrectionS=-.2;
    record.data.sprint_fvp.forEach(trial=>trial.splits.forEach(split=>{split.timeS+=.2;}));
    const {exported}=await workbook(record),parsed=await X.readTemplate(exported.bytes);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog);verify(X.apply(preview,decisions(preview)).records[0],record);
  });
  await test("future method and sampling metadata are preserved by XLSX and remain unavailable for calculation",async()=>{
    const {record,catalog}=seed();fill(record);Object.assign(record.sprintFvpConfig,{methodVersion:"future-method-v99",sampleStepS:.02,rfAfterS:.55,samplingWindow:"future_window"});
    const {book}=await workbook(record),info=manifest(book),conditions=book.getWorksheet(info.sheets.find(sheet=>sheet.kind==="settings").name);
    const keys=Array.from({length:conditions.rowCount-1},(_,i)=>conditions.getCell(i+2,column(conditions,"fieldId")).value);
    for(const key of ["methodVersion","sampleStepS","rfAfterS","samplingWindow"])assert.ok(keys.includes("sprintFvpConfig."+key));
    const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog),actual=X.apply(preview,decisions(preview)).records[0];
    assert.deepEqual(actual.sprintFvpConfig,record.sprintFvpConfig);assert.deepEqual(trialData(actual.data.sprint_fvp),trialData(record.data.sprint_fvp));assert.equal(F.solve(actual).valid,false);
  });
  await test("partial measured trial retains unmeasured split distances while blank reserve trials disappear",async()=>{
    const {record,catalog}=seed();fill(record);record.data.sprint_fvp[0].splits[2].timeS="";
    const {book}=await workbook(record),parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog),actual=X.apply(preview,decisions(preview)).records[0];assert.deepEqual(trialData(actual.data.sprint_fvp),trialData(record.data.sprint_fvp));
  });
  await test("row and column reordering retain trial identities and ordinal split order",async()=>{
    const {record,catalog}=seed();fill(record);const {book}=await workbook(record),ws=sprintSheet(book),spec=manifest(book).sheets.find(sheet=>sheet.name===ws.name);
    const rows=Array.from({length:ws.rowCount-1},(_,i)=>spec.columns.map((_,col)=>ws.getCell(i+2,col+1).value));rows.reverse();rows.forEach(row=>row.reverse());ws.removeTable(spec.tableName);ws.addTable({name:spec.tableName,ref:"A1",headerRow:true,totalsRow:false,columns:[...spec.columns].reverse().map(column=>({name:column.header})),rows});
    const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog);verify(X.apply(preview,decisions(preview)).records[0],record);
  });
  await test("legacy schema1 XLSX also preserves sprint settings and raw split inputs",async()=>{
    const {record,catalog}=seed();fill(record);const {exported}=await workbook(record,true,1),parsed=await X.readTemplate(exported.bytes);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog);verify(X.apply(preview,decisions(preview)).records[0],record);
  });
  await test("duplicate split numbers, incompatible metadata and formula inputs fail at their cells",async()=>{
    const {record}=seed();fill(record);const {book}=await workbook(record),ws=sprintSheet(book);
    set(ws,3,"split",1);set(ws,4,"notes","冲突备注");set(ws,5,"timeS",{formula:"1+2",result:3});const parsed=await parse(book);
    assert.ok(parsed.errors.some(error=>error.sheet===ws.name&&error.address===ws.getCell(3,column(ws,"split")).address&&/重复/.test(error.message)));
    assert.ok(parsed.errors.some(error=>error.sheet===ws.name&&error.address===ws.getCell(4,column(ws,"notes")).address&&/一致/.test(error.message)));
    assert.ok(parsed.errors.some(error=>error.sheet===ws.name&&error.address===ws.getCell(5,column(ws,"timeS")).address&&/公式/.test(error.message)));
  });
  await test("sprint entry session ignores distances and setup but retains raw time drafts including zero",()=>{
    const {record}=seed(),session=S.create([record]),changed=copy(record);changed.data.sprint_fvp=[E.defaultTrial()];changed.sprintFvpConfig.inputTimeMode="interval";changed.sprintFvpAnalysis.targetDistanceM=60;assert.equal(S.hasManualData(session,changed),false);
    changed.data.sprint_fvp[0].splits[0].timeS=0;assert.equal(S.hasManualData(session,changed),true);changed.data.sprint_fvp[0].splits[0].timeS=" ";assert.equal(S.hasManualData(session,changed),false);
  });
  await test("legacy custom project named sprint_fvp retains scalar fields and avoids the native split contract",async()=>{
    const {record,catalog}=seed();record.customTests=[{id:"sprint_fvp",name:"历史自定义冲刺",category:"performance",primaryAbility:"最大速度",legacyCustom:true}];
    record.projectSnapshots=record.projectSnapshots.map(test=>test.id==="sprint_fvp"?{...test,legacyCustom:true}:test);
    record.definitions=record.definitions.filter(definition=>definition.testId!=="sprint_fvp");record.definitions.push({id:"legacy_sprint",testId:"sprint_fvp",name:"历史指标",unit:"s",ability:"最大速度",category:"performance",direction:"lower",target:null,referenceEnabled:false,ranges:[],entryScope:"attempt",legacyManual:true});
    record.data.sprint_fvp=[{id:"legacy_synthetic",metrics:{legacy_sprint:4.2},notes:"保留历史数据"}];assert.equal(RingsideTests.isNative(record,"sprint_fvp"),false);
    const {book}=await workbook(record),info=manifest(book),ws=book.getWorksheet(info.sheets.find(sheet=>sheet.testId==="sprint_fvp"&&sheet.kind==="attempt").name);assert.equal(ws.getCell(2,column(ws,"metrics.legacy_sprint")).value,4.2);
    set(ws,2,"metrics.legacy_sprint",4.1);const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const preview=review(parsed,record,catalog,[copy(record)]);assert.deepEqual(preview.errors,[]);const actual=X.apply(preview,decisions(preview)).records[0];assert.equal(actual.data.sprint_fvp[0].metrics.legacy_sprint,4.1);assert.equal(actual.data.sprint_fvp[0].notes,"保留历史数据");
  });
  await test("entry shares form helpers and displays mechanical model numbers, modes and target",()=>{
    const {record}=seed();fill(record);const helpers={input:(key,value)=>`<input data-path="${key}" value="${String(value).replace(/"/g,"&quot;")}">`,select:(key,value)=>`<select data-path="${key}" value="${value}"></select>`,check:(key,value)=>`<input type="checkbox" data-path="${key}" ${value?"checked":""}>`,field:(label,control)=>`<label>${label}${control}</label>`,table:(heads,rows)=>`<table>${heads.join("")}${rows.flat().join("")}</table>`};
    const html=E.render(record,helpers);assert.ok(html.includes('data-path="data.sprint_fvp.0.splits.0.timeS"'));assert.ok(html.includes('data-path="sprintFvpConfig.timingStart"'));assert.ok(html.includes('data-path="sprintFvpAnalysis.targetDistanceM"'));assert.ok(html.includes("App.addSprintSplit(0)"));assert.ok(/Pmax \d+\.\d+ W\/kg/.test(html));assert.ok(html.includes("试次 1"));
  });
  console.log(passed + " sprint Excel/entry checks passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
