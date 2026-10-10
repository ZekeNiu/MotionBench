"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
global.window=global;global.ExcelJS=require("../vendor/exceljs.min.js");
for(const name of ["calc","fvp","cpet-reference","definitions","tests","model","excel"])vm.runInThisContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"));
const M=RingsideModel,X=RingsideExcel,copy=value=>JSON.parse(JSON.stringify(value));let passed=0;
const catalog=M.normalizeCatalog();
function record(profile={}){const r=M.recordFromCatalog(catalog,{name:"生日测试运动员",...profile},{cmj:true},"2026-10-09");r.evaluationProfileId="evaluation_context";r.data.cmj[0].height=30;return r;}
const owner=r=>({id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]});
const {column}=require("./helpers/excel-template.cjs");
const set=(ws,key,value,row=2)=>{ws.getCell(row,column(ws,key)).value=value;};
async function workbook(records){const exported=await X.createTemplate({records,prefill:true}),book=new ExcelJS.Workbook();await book.xlsx.load(exported.bytes);return{book,exported};}
const parse=book=>book.xlsx.writeBuffer().then(bytes=>X.readTemplate(bytes));
const preview=(parsed,owners,records=[])=>X.preview(parsed,{athletes:owners,catalog,records});
async function test(name,run){await run();passed++;console.log("PASS "+name);}
(async()=>{
 await test("known birthday age is locked while date and missing birthday age remain editable",async()=>{
  const known=record({birthDate:"2000-10-10"}),manual=record();manual.athlete.age=20;
  const {book,exported}=await workbook([known,manual]),ws=book.getWorksheet("本次测试");
  assert.equal(ws.sheetProtection.sheet,true);assert.equal(ws.getCell(2,column(ws,"age")).protection?.locked ?? true,true);
  assert.equal(ws.getCell(2,column(ws,"date")).protection.locked,false);assert.equal(ws.getCell(3,column(ws,"age")).protection.locked,false);
  assert.equal(ws.getCell(2,column(ws,"age")).value,25);assert.match(JSON.stringify(ws.getCell(2,column(ws,"age")).note),/自动计算/);
  if(process.argv.includes("--prepare-native")){const target=path.join(__dirname,"../output/athlete-context-native-test.xlsx");fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(exported.bytes));console.log("Native fixture: "+target);}
 });
 await test("changed test date recalculates birthday age and ignores edited reference age",async()=>{
  const r=record({birthDate:"2000-10-10"}),{book}=await workbook([r]),ws=book.getWorksheet("本次测试");
  set(ws,"date","2026-10-10");set(ws,"age","ignore this reference");
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);
  const reviewed=preview(parsed,[owner(r)]),saved=X.apply(reviewed).records[0];
  assert.equal(saved.athlete.date,"2026-10-10");assert.equal(saved.athlete.age,26);assert.equal(saved.athlete.birthDate,"2000-10-10");
 });
 await test("manual age remains supported for legacy templates without birthday",async()=>{
  const r=record();delete r.athlete.birthDate;r.athlete.age=19;
  const {book}=await workbook([r]);set(book.getWorksheet("本次测试"),"age",21.5);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const saved=X.apply(preview(parsed,[owner(r)])).records[0];assert.equal(saved.athlete.age,21.5);assert.equal(saved.athlete.birthDate,"");
 });
 await test("current owner birthday replaces stale birthday in an older template",async()=>{
  const r=record({birthDate:"2000-10-10"}),{book}=await workbook([r]),latest=owner(r);latest.profile.birthDate="2001-10-09";
  const parsed=await parse(book),reviewed=preview(parsed,[latest]);assert.deepEqual(reviewed.errors,[]);
  const saved=X.apply(reviewed).records[0];assert.equal(saved.athlete.birthDate,"2001-10-09");assert.equal(saved.athlete.age,25);
 });
 await test("existing metadata keep and replace compute age from the adopted date",async()=>{
  const r=record({birthDate:"2000-10-10"}),{book}=await workbook([r]);set(book.getWorksheet("本次测试"),"date","2026-10-10");
  const cmj=book.worksheets.find(ws=>ws.name.endsWith("_CMJ"));set(cmj,"height",35);
  const parsed=await parse(book),reviewed=preview(parsed,[owner(r)],[r]);assert.deepEqual(reviewed.errors,[]);
  const kept=X.apply(reviewed,{[r.recordId]:{projects:{cmj:"replace"},metadata:"keep"}}).records[0];assert.equal(kept.athlete.date,"2026-10-09");assert.equal(kept.athlete.age,25);
  const adopted=X.apply(reviewed,{[r.recordId]:{projects:{cmj:"replace"},metadata:"replace"}}).records[0];assert.equal(adopted.athlete.date,"2026-10-10");assert.equal(adopted.athlete.age,26);
 });
 await test("mixed batch uses each athlete birthday independently",async()=>{
  const a=record({birthDate:"2000-10-09"}),b=record({birthDate:"2000-10-10"}),{book}=await workbook([a,b]);
  const parsed=await parse(book),saved=X.apply(preview(parsed,[owner(a),owner(b)])).records;
  assert.equal(saved.length,2);assert.equal(saved.find(r=>r.athleteId===a.athleteId).athlete.age,26);assert.equal(saved.find(r=>r.athleteId===b.athleteId).athlete.age,25);
 });
 await test("adopted dates before birth or after the next competition fail without modifying inputs",async()=>{
  const r=record({birthDate:"2000-10-09"});r.trainingContext.nextCompetitionDate="2026-10-15";
  const before=copy(r),{book}=await workbook([r]);set(book.getWorksheet("本次测试"),"date","2026-10-16");
  const parsed=await parse(book);assert.ok(parsed.errors.some(error=>/下一场/.test(error.message)));assert.deepEqual(copy(r),before);assert.throws(()=>X.apply(preview(parsed,[owner(r)])),/错误/);
  set(book.getWorksheet("本次测试"),"date","1999-01-01");assert.ok((await parse(book)).errors.some(error=>/生日/.test(error.message)));
 });
 if(process.argv.includes("--verify-native"))await test("native Excel edited and saved workbook returns calculated and manual ages with measurements",async()=>{
  const nativeIndex=process.argv.indexOf("--native-workbook"),target=nativeIndex>=0?path.resolve(process.argv[nativeIndex+1]):path.join(__dirname,"../output/athlete-context-native-filled.xlsx"),bytes=fs.readFileSync(target),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  const ws=book.getWorksheet("本次测试");assert.equal(ws.getCell(2,column(ws,"date")).value,"2026-10-10");assert.equal(ws.getCell(2,column(ws,"age")).value,25);
  assert.equal(ws.getCell(2,column(ws,"age")).protection?.locked ?? true,true);assert.equal(ws.getCell(3,column(ws,"age")).protection.locked,false);
  const parsed=await X.readTemplate(bytes);assert.deepEqual(parsed.errors,[]);const reviewed=preview(parsed,parsed.entries.map(entry=>owner(entry.record))),saved=X.apply(reviewed).records;
  assert.deepEqual(reviewed.errors,[]);assert.equal(saved.length,2);
  const known=saved.find(r=>r.athlete.birthDate),manual=saved.find(r=>!r.athlete.birthDate);
  assert.equal(known.athlete.date,"2026-10-10");assert.equal(known.athlete.age,26);assert.equal(known.data.cmj[0].height,33.5);
  assert.equal(manual.athlete.date,"2026-10-10");assert.equal(manual.athlete.age,21.5);assert.equal(manual.data.cmj[0].height,34.5);
 });
 console.log("PASS "+passed+" athlete context Excel scenarios");
})().catch(error=>{console.error(error);process.exitCode=1;});
