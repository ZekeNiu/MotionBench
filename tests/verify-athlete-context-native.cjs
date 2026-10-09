"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname,".."), destination = path.join(root,"output/excel-native/athlete-context-results.json");
const inputs = ["MotionBench.html", "Ringside_Boxing_Assessment.html", "src/ringside-calc.js", "src/ringside-fvp.js", "src/ringside-cpet-reference.js", "src/ringside-definitions.js", "src/ringside-tests.js", "src/ringside-model.js", "src/ringside-excel.js", "vendor/exceljs.min.js", "tests/athlete-context-excel-tests.cjs", "tests/athlete-context-native.ps1", "tests/verify-athlete-context-native.cjs"];
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex");
const snapshot = () => Object.fromEntries(inputs.map(file=>[file,digest(file)]));
const checksFrom = output => output.split(/\r?\n/).filter(line=>/^PASS [^\d]/.test(line)).map(line=>line.slice(5));
const evidence = {created:new Date().toISOString(),pass:false,syntheticDataOnly:true,actualMicrosoftExcel:false,checks:[],steps:[]};
try {
  evidence.inputHashes = snapshot(); evidence.sourceHash = evidence.inputHashes["MotionBench.html"];
  if(evidence.sourceHash !== evidence.inputHashes["Ringside_Boxing_Assessment.html"])throw Error("The two standalone HTML artifacts differ");
  const html=fs.readFileSync(path.join(root,"MotionBench.html"),"utf8").replace(/\r\n/g,"\n");
  evidence.embeddedSourceChecks=inputs.filter(file=>file.startsWith("src/")||file==="vendor/exceljs.min.js").map(file=>{
    const source=fs.readFileSync(path.join(root,file),"utf8").replace(/\r\n/g,"\n").replaceAll("</script","<\\/script");
    return {file,sha256:evidence.inputHashes[file],embeddedExactly:html.includes("<script>\n"+source+"\n</script>")};
  });
  if(evidence.embeddedSourceChecks.some(check=>!check.embeddedExactly))throw Error("The source tested by the parser is not embedded exactly in the artifact");
  const tasks = [
    {name:"prepare", executable:process.execPath,args:["tests/athlete-context-excel-tests.cjs","--prepare-native"]},
    {name:"native-edit-and-save", executable:"powershell.exe",args:["-NoProfile","-ExecutionPolicy","Bypass","-File","tests/athlete-context-native.ps1"]},
    {name:"verify", executable:process.execPath,args:["tests/athlete-context-excel-tests.cjs","--verify-native"]},
  ];
  for(const task of tasks){
    if(task.name==="verify")task.args.push("--native-workbook",evidence.nativeExcel.Output);
    const result=spawnSync(task.executable,task.args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
    const output=(result.stdout||"")+(result.stderr||""), checks=checksFrom(output);
    evidence.steps.push({name:task.name,command:path.basename(task.executable)+" "+task.args.join(" "),exitCode:result.status,checks,output});
    if(result.error||result.status!==0)throw Error(task.name+" failed: "+(result.error?.message||output.trim()));
    if(task.name==="native-edit-and-save"){
      const line=output.split(/\r?\n/).find(line=>line.startsWith("{"));evidence.nativeExcel=JSON.parse(line||"null");
      if(!evidence.nativeExcel?.Saved||!evidence.nativeExcel?.AgeReferenceEditBlocked)throw Error("Microsoft Excel did not save or protect the age reference");
      if(path.dirname(path.resolve(evidence.nativeExcel.Output)).toLowerCase()!==path.join(root,"output").toLowerCase())throw Error("Native output is outside the workspace output directory");
      evidence.actualMicrosoftExcel=true;
    }
  }
  const prepare=evidence.steps.find(step=>step.name==="prepare"),verify=evidence.steps.find(step=>step.name==="verify");
  if(prepare.checks.length!==7||verify.checks.length!==8)throw Error("Unexpected focused Excel scenario count");
  evidence.checks=[...new Set([...prepare.checks,...verify.checks])];evidence.uniqueExcelScenarioCount=evidence.checks.length;
  evidence.outputFiles=["output/athlete-context-native-test.xlsx",path.relative(root,evidence.nativeExcel.Output).replaceAll("\\","/")].map(file=>({file,sha256:digest(file),bytes:fs.statSync(path.join(root,file)).size}));
  evidence.finalInputHashes=snapshot();evidence.inputsUnchanged=inputs.every(file=>evidence.inputHashes[file]===evidence.finalInputHashes[file]);
  if(!evidence.inputsUnchanged)throw Error("Artifact, source, or test inputs changed during native verification");
  evidence.pass=true;
}catch(error){evidence.error=error.stack||error.message;process.exitCode=1;}
finally{
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({pass:evidence.pass,sourceHash:evidence.sourceHash,uniqueExcelScenarioCount:evidence.uniqueExcelScenarioCount,actualMicrosoftExcel:evidence.actualMicrosoftExcel,excelVersion:evidence.nativeExcel?.ExcelVersion,evidence:path.relative(root,destination).replaceAll("\\","/"),error:evidence.error}));
}
