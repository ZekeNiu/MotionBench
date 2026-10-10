"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),mode=process.argv[2],directory=path.resolve(process.argv[3]||path.join(root,"output/excel-v216-native"));
global.window=global;global.ExcelJS=require("../vendor/exceljs.min.js");
for(const name of ["calc","fvp","cpet-reference","definitions","tests","model","evaluation","interventions","excel"])vm.runInThisContext(fs.readFileSync(path.join(root,"src/ringside-"+name+".js"),"utf8"));
const M=RingsideModel,X=RingsideExcel,{manifest}=require("./helpers/excel-template.cjs"),hash=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function seed(id){const r=M.recordFromCatalog(M.normalizeCatalog(),{name:"Native Excel 同名运动员",sport:"拳击",birthDate:"2000-01-01"},{[id]:true},"2026-10-09");r.athlete.mass=75;r.fvpConfig.fvp_cmj.distanceCm=35;return r;}
async function prepare(){
 fs.mkdirSync(directory,{recursive:true});const cases=[];
 const definitions=[
  {name:"single-lvp-next-row",operation:"nextRow",testId:"squat",values:[{recordIndex:0,load:80,velocity:.5}]},
  {name:"single-fvp-next-row",operation:"nextRow",testId:"fvp_cmj",values:[{recordIndex:0,load:0,height:38}]},
  {name:"single-lvp-insert-sort",operation:"insertSort",testId:"squat",values:[{recordIndex:0,load:40,velocity:.8},{recordIndex:0,load:20,velocity:1.1}]},
  {name:"batch-lvp-add-sort",operation:"addSort",testId:"squat",people:2,values:[{recordIndex:1,load:65,velocity:.65},{recordIndex:0,load:20,velocity:1.1}]},
  {name:"batch-lvp-paste-beyond-reserve",operation:"paste",testId:"squat",people:2,values:[{recordIndex:0,load:75,velocity:.55},{recordIndex:1,load:45,velocity:.85},{recordIndex:0,load:35,velocity:.95}]},
  {name:"legacy-single-lvp-next-row",operation:"nextRow",testId:"squat",schema:1,values:[{recordIndex:0,load:90,velocity:.4}]},
  {name:"batch-missing-identity",operation:"missingIdentity",testId:"squat",people:2,values:[{recordIndex:0,load:60,velocity:.7}],expectedError:"未指定"},
  {name:"copied-measured-duplicate",operation:"duplicate",testId:"squat",values:[{recordIndex:0,load:50,velocity:.75}],expectedError:"编号重复"},
  {name:"seven-fms-actions",operation:"fms",testId:"fms",values:[]},
 ];
 for(const definition of definitions){const records=Array.from({length:definition.people||1},()=>seed(definition.testId)),evaluationProfile=RingsideEvaluation.create(records[0],"原生 Excel 验收方案");for(const record of records)record.evaluationProfileId=evaluationProfile.id;const exported=await X.createTemplate({records,schema:definition.schema||2}),book=new ExcelJS.Workbook();await book.xlsx.load(exported.bytes);const info=manifest(book),spec=info.schema===2?info.sheets.find(s=>s.testId===definition.testId):null,sheetName=spec?.name||book.worksheets.find(s=>/^\d+_/.test(s.name)).name,input=path.join(directory,definition.name+"-input.xlsx"),output=path.join(directory,definition.name+"-saved.xlsx");fs.writeFileSync(input,Buffer.from(exported.bytes));cases.push({...definition,records,evaluationProfile,input,output,sheetName,tableName:spec?.tableName||null,inputSha256:hash(input)});}
 const fixture={schema:1,directory,sourceHash:hash(path.join(root,"MotionBench.html")),moduleSha256:hash(path.join(root,"src/ringside-excel.js")),cases};fs.writeFileSync(path.join(directory,"fixture.json"),JSON.stringify(fixture,null,2));console.log("Prepared "+cases.length+" synthetic native Excel cases: "+directory);
}
async function verify(){
 const fixture=JSON.parse(fs.readFileSync(path.join(directory,"fixture.json"),"utf8")),native=JSON.parse(fs.readFileSync(path.join(directory,"native-result.json"),"utf8"));assert.equal(native.savedAll,true);assert.equal(hash(path.join(root,"src/ringside-excel.js")),fixture.moduleSha256);
 const checks=[];
 for(const test of fixture.cases){assert.equal(hash(test.input),test.inputSha256,"Original synthetic input changed: "+test.name);const bytes=fs.readFileSync(test.output),parsed=await X.readTemplate(bytes);
  if(test.expectedError){assert.ok(parsed.errors.some(error=>error.message.includes(test.expectedError)),test.name);checks.push({name:test.name,pass:true,expectedBlockingError:test.expectedError,errors:parsed.errors});}
  else {assert.deepEqual(parsed.errors,[],test.name);const review=X.preview(parsed,{athletes:test.records.map(r=>({id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]})),catalog:M.normalizeCatalog()});assert.deepEqual(review.errors,[],test.name);const actual=X.apply(review).records;
   if(test.operation==="fms"){assert.equal(Calc.fms(actual[0].data.fms).completed,7);assert.equal(Calc.fms(actual[0].data.fms).total,12);}
   else for(const [index,record]of test.records.entries()){const expected=test.values.filter(value=>value.recordIndex===index),saved=actual.find(r=>r.athleteId===record.athleteId);if(!expected.length){assert.equal(saved,undefined);continue;}assert.equal(saved.data[test.testId].length,expected.length,test.name);for(const value of expected)assert.ok(saved.data[test.testId].some(row=>row.load===value.load&&row[test.testId==="fvp_cmj"?"height":"velocity"]===value[test.testId==="fvp_cmj"?"height":"velocity"]),test.name);}
   checks.push({name:test.name,pass:true,recordCounts:actual.map(r=>({athleteId:r.athleteId,count:test.testId==="fms"?7:r.data[test.testId].length}))});}
  const check=checks[checks.length-1];check.workbookSha256=hash(test.output);check.inputSha256=hash(test.input);check.workbook=test.output;console.log("PASS "+test.name);
 }
 const evidence={pass:true,sourceHash:fixture.sourceHash,moduleSha256:fixture.moduleSha256,actualMicrosoftExcel:true,checkedAt:new Date().toISOString(),native,checks};fs.mkdirSync(path.join(root,"output/tests"),{recursive:true});fs.writeFileSync(path.join(root,"output/tests/v216-excel-native-results.json"),JSON.stringify(evidence,null,2));console.log("Verified "+checks.length+" native Excel scenarios");
}
function combine(){
 const sourceHash=hash(path.join(root,"MotionBench.html")),native=JSON.parse(fs.readFileSync(path.join(root,"output/tests/v216-excel-native-results.json"))),product=["chrome","msedge"].map(channel=>JSON.parse(fs.readFileSync(path.join(root,"output/tests/v216-excel-native-"+channel+".json"))));
 assert.equal(native.pass,true);assert.equal(native.moduleSha256,hash(path.join(root,"src/ringside-excel.js")));assert.ok(product.every(check=>check.pass&&check.sourceHash===sourceHash&&check.excelModuleSha256===native.moduleSha256));
 for(const check of native.checks)for(const browser of product)assert.equal(browser.checks.find(item=>item.name===check.name).workbookSha256,check.workbookSha256);
 const evidence={pass:true,sourceHash,excelModuleSha256:native.moduleSha256,nativeGenerationSourceHash:native.sourceHash,actualMicrosoftExcel:true,uniqueNativeWorkbookScenarios:native.checks.length,productBrowserScenarios:product.reduce((count,item)=>count+item.checks.length,0),keyboardEntryAutoExpansionTested:false,methodBoundary:"Native COM next-row writes are recorded separately from Excel ListRows.Add, Table.Sort and Range.Value2. Both browser channels upload these same saved files, confirm through product UI, and verify persisted records after refresh.",native,product,checkedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(root,"output/tests/v216-excel-native-workflow-results.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify({pass:true,sourceHash,nativeScenarios:evidence.uniqueNativeWorkbookScenarios,productScenarios:evidence.productBrowserScenarios}));
}
(mode==="--prepare"?prepare():mode==="--verify"?verify():mode==="--combine"?Promise.resolve().then(combine):Promise.reject(Error("Use --prepare, --verify or --combine followed by the synthetic fixture directory"))).catch(error=>{console.error(error);process.exitCode=1;});
