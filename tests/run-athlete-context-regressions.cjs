"use strict";
const fs=require("node:fs"),path=require("node:path"),{spawn}=require("node:child_process"),{createHash}=require("node:crypto");
const root=path.resolve(__dirname,".."),hash=()=>createHash("sha256").update(fs.readFileSync(path.join(root,"MotionBench.html"))).digest("hex");
const result={sourceHash:hash(),suites:[],pass:false};
const jobs=[];
for(const channel of ["chrome","msedge"])for(const [name,directory,suffix] of [["management-browser-tests.cjs","management","workflow"],["unified-entry-browser-tests.cjs","unified-entry","results"],["refinement-workflow-browser-tests.cjs","refinement","workflow"]])jobs.push({name,channel,report:`output/playwright/${directory}/${channel}-${suffix}.json`});
jobs.push({name:"ai-narrative-browser-tests.cjs",report:"output/ai/narrative-flow.json"});
async function run(job){
 const args=[path.join(__dirname,job.name),...(job.channel==="msedge"?["--edge"]:[])];
 const output=await new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:root}),chunks=[],errors=[];child.stdout.on("data",data=>chunks.push(data));child.stderr.on("data",data=>errors.push(data));child.on("error",error=>resolve({exitCode:1,stderr:error.message}));child.on("close",exitCode=>resolve({exitCode,stdout:Buffer.concat(chunks).toString(),stderr:Buffer.concat(errors).toString()}));});
 const evidence=JSON.parse(fs.readFileSync(path.join(root,job.report),"utf8"));
 const item={...job,...output,checksPassed:evidence.checks.length,pass:output.exitCode===0&&evidence.sourceHash===result.sourceHash&&!evidence.errors.length&&evidence.pass!==false};result.suites.push(item);console.log(`${item.pass?"PASS":"FAIL"} ${job.name} ${job.channel||"simulated AI"}: ${item.checksPassed} checks`);
}
(async()=>{for(let i=0;i<jobs.length;i+=2)await Promise.all(jobs.slice(i,i+2).map(run));result.pass=result.suites.every(suite=>suite.pass)&&hash()===result.sourceHash;fs.mkdirSync(path.join(root,"output/tests"),{recursive:true});fs.writeFileSync(path.join(root,"output/tests/v215-browser-regression.json"),JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
