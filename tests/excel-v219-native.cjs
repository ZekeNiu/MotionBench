"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto"),assert=require("node:assert/strict");
global.window=global;global.ExcelJS=require("../vendor/exceljs.min.js");
const modules=["calc","fvp","sprint-fvp","sprint-elasticity","cpet-reference","iso-reference","definitions","tests","scoring","model","evaluation","interventions","acquisition","excel","excel-v3"];
for(const name of modules)vm.runInThisContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"));
const M=RingsideModel,X=RingsideExcel,dir=path.resolve(__dirname,"../output/tests/v219-excel-native"),hash=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const html=path.resolve(__dirname,"../MotionBench.html"),runnerFiles=[__filename,path.join(__dirname,"excel-v219-native.ps1")],runnerHashes=()=>Object.fromEntries(runnerFiles.map(file=>[path.basename(file),hash(file)]));
const hashes=()=>Object.fromEntries(modules.map(name=>[name,hash(path.join(__dirname,"../src/ringside-"+name+".js"))]));
function manifest(book){let value="";book.getWorksheet("_MotionBench").eachRow(row=>value+=row.getCell(2).value);return JSON.parse(value);}
(async()=>{
 if(process.argv.includes("--prepare")){
  fs.mkdirSync(dir,{recursive:true});for(const name of ["evidence.json","excel-run.json"])if(fs.existsSync(path.join(dir,name)))fs.unlinkSync(path.join(dir,name));const catalog=M.normalizeCatalog(),record=M.recordFromCatalog(catalog,{name:"原生 Excel 合同核验",sex:"男",sport:"测试"},{fvp_sj:true,imtp:true,hop:true},"2026-10-11");record.athlete.mass=75;record.athlete.height=180;
  const definition={id:"native_hop_extra",testId:"hop",name:"整次附加指标",unit:"cm",ability:"反应力量",category:"performance",entryScope:"attempt",direction:"higher",target:null,referenceEnabled:false,ranges:[]};catalog.definitions.push(definition);record.definitions.push(definition);
  const exported=await X.createTemplate({records:[record]}),book=new ExcelJS.Workbook();await book.xlsx.load(exported.bytes);const info=manifest(book),writes=[];
  function cell(id,kind,key,value,offset=1){const sheet=info.sheets.find(sheet=>sheet.testId===id),block=sheet.blocks.find(block=>block.kind===kind),column=block.columns.findIndex(col=>col.key===key)+1;assert.ok(column,key);writes.push({sheet:sheet.name,row:block.start+offset,column,value});}
  cell("fvp_sj","parameters","fvpConfig.fvp_sj.distanceCm",35);
  [[0,38],[20,28],[40,22]].forEach(([load,height],i)=>{cell("fvp_sj","attempt","load",load,i+1);cell("fvp_sj","attempt","height",height,i+1);});
  cell("imtp","attempt","peakForce",2500);cell("imtp","attempt","time:100:force",1200);cell("imtp","attempt","time:100:rfd",12000);cell("hop","hop","summary.rsi",2.1);cell("hop","hop","metrics.native_hop_extra",44);
  const imtp=info.sheets.find(sheet=>sheet.testId==="imtp"),block=imtp.blocks.find(block=>block.kind==="attempt");
  const fixture={record,catalog,writes,addColumn:{sheet:imtp.name,table:block.name,header:"350 ms 实测力 N",value:1800},sourceHashes:hashes(),sourceHash:hash(html),runnerHashes:runnerHashes(),input:path.join(dir,"input.xlsx"),output:path.join(dir,"excel-saved.xlsx")};
  fs.writeFileSync(fixture.input,Buffer.from(exported.bytes));fs.writeFileSync(path.join(dir,"fixture.json"),JSON.stringify(fixture,null,2));console.log("Prepared schema3 native Excel fixture");return;
 }
 if(process.argv.includes("--verify")){
  const fixture=JSON.parse(fs.readFileSync(path.join(dir,"fixture.json"),"utf8"));assert.deepEqual(hashes(),fixture.sourceHashes,"Source changed after preparing native fixture");assert.equal(hash(html),fixture.sourceHash,"HTML changed after preparing native fixture");assert.deepEqual(runnerHashes(),fixture.runnerHashes,"Native runners changed after preparing fixture");const excel=JSON.parse(fs.readFileSync(path.join(dir,"excel-run.json"),"utf8").replace(/^\uFEFF/,"")),inputHash=hash(fixture.input),outputHash=hash(fixture.output);assert.equal(excel.inputSha256.toLowerCase(),inputHash);assert.equal(excel.outputSha256.toLowerCase(),outputHash);assert.ok(excel.version);const parsed=await X.readTemplate(fs.readFileSync(fixture.output));assert.deepEqual(parsed.errors,[]);const r=fixture.record,review=X.preview(parsed,{athletes:[{id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]}],catalog:fixture.catalog});assert.deepEqual(review.errors,[]);const result=X.apply(review).records[0];assert.ok(RingsideFVP.solve(result,"fvp_sj").valid);assert.equal(result.data.imtp[0].timePoints.find(point=>point.timeMs===350).force,1800);assert.equal(result.data.imtp[0].timePoints.find(point=>point.timeMs===100).rfd,12000);assert.equal(result.data.hop.trials[0].metrics.native_hop_extra,44);assert.equal(result.data.hop.trials[0].summary.rsi,2.1);
  fs.writeFileSync(path.join(dir,"evidence.json"),JSON.stringify({pass:true,checkedAt:new Date().toISOString(),sourceHash:hash(html),sourceHashes:hashes(),runnerHashes:runnerHashes(),inputSha256:inputHash,outputSha256:outputHash,xlsxSha256:outputHash,excel,check:"Independent Microsoft Excel COM instance: open, fill, add a dynamic IMTP column, save, parse, preview, apply",claims:["FVP distance and load-height calculation","single-sheet IMTP arbitrary added time","Hop complete-test custom measurement"]},null,2));console.log("PASS native Excel schema3 round trip");return;
 }
 throw Error("Use --prepare or --verify");
})().catch(error=>{console.error(error);process.exitCode=1});
