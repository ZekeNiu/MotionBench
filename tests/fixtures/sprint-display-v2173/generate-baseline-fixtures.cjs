"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const repo=path.resolve(__dirname,"../../.."),ref="7dfee7c4",sha=value=>crypto.createHash("sha256").update(value).digest("hex");
// ExcelJS must share the JavaScript realm of the actual baseline arrays.
const ctx=global;ctx.window=ctx;ctx.ExcelJS=require(path.join(repo,"vendor/exceljs.min.js"));
const hashes={};
for(const name of ["calc","sprint-fvp","fvp","cpet-reference","definitions","tests","model","evaluation","interventions","excel"]){
  const file="src/ringside-"+name+".js",read=spawnSync("git",["show",ref+":"+file],{cwd:repo});
  if(read.status!==0)throw Error(read.stderr.toString());hashes[file]=sha(read.stdout);vm.runInThisContext(read.stdout.toString("utf8"),{filename:file});
}
(async()=>{
  const M=ctx.RingsideModel,F=ctx.RingsideSprintFVP,X=ctx.RingsideExcel,catalog=M.normalizeCatalog();catalog.tests.find(test=>test.id==="sprint_fvp").disabled=false;
  const record=M.recordFromCatalog(catalog,{name:"Synthetic legacy sprint workbook",sport:"Synthetic",sex:"男"},{sprint_fvp:true},"2026-10-10");
  record.athlete.mass=75;record.athlete.height=180;record.athlete.age=25;record.sprintFvpAnalysis.targetDistanceM=60;
  record.data.sprint_fvp=[{id:"synthetic_legacy_sprint",splits:[5,10,20,30,40].map(distanceM=>({distanceM,timeS:F.timeAtDistance(distanceM,9.5,1.15)})),excluded:false,exclusionReason:"",notes:"Synthetic baseline fixture"}];
  M.validateRecord(record);const outputs=[];
  for(const schema of [1,2]){
    const exported=await X.createTemplate({records:[record],prefill:true,schema}),bytes=Buffer.from(exported.bytes),name="baseline-sprint-schema"+schema+".xlsx";fs.writeFileSync(path.join(__dirname,name),bytes);
    const book=new ctx.ExcelJS.Workbook();await book.xlsx.load(bytes);const parsed=await X.readTemplate(bytes);if(parsed.errors.length||parsed.entries.length!==1)throw Error("Actual baseline XLSX reread failed: "+JSON.stringify(parsed.errors));outputs.push({name,schema,bytes:bytes.length,sha256:sha(bytes),baselineReadPassed:true,worksheets:book.worksheets.map(sheet=>sheet.name)});
  }
  const library=ctx.RingsideEvaluation.migrate(M.recordEnvelope(record));
  fs.writeFileSync(path.join(__dirname,"baseline-sprint-library.json"),JSON.stringify(library,null,2)+"\n");
  const proof={baselineRef:ref,sourceHashes:hashes,syntheticOnly:true,producer:"Actual git baseline modules executed in a VM with the unchanged bundled ExcelJS",rawProjectName:record.projectSnapshots.find(test=>test.id==="sprint_fvp").name,viewFieldPresent:Object.hasOwn(record,"sprintFvpView"),targetDistanceM:record.sprintFvpAnalysis.targetDistanceM,outputs};
  fs.writeFileSync(path.join(__dirname,"baseline-fixtures.json"),JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify(proof));
})().catch(error=>{console.error(error);process.exitCode=1;});
