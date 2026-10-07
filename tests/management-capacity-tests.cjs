"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),readline=require("node:readline"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto");
const{chromium}=require("./helpers/playwright.cjs"),root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/management");
fs.mkdirSync(out,{recursive:true});const channel=process.argv.includes("--edge")?"msedge":"chrome";
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,synthetic:true,athletes:300,records:3000,timings:{},pass:false,errors:[]};
async function recordHash(file){const hash=createHash("sha256");let count=0;const stream=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});for await(const line of stream){const row=JSON.parse(line);if(row.type==="record"){hash.update(JSON.stringify(row.value));count++;}}return{sha256:hash.digest("hex"),count};}
(async()=>{
 const browser=await chromium.launch({channel}),context=await browser.newContext({offline:true,viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:"reduce"});let page=await context.newPage();page.on("pageerror",e=>result.errors.push(e.message));page.setDefaultTimeout(20000);
 try{
  await page.goto(pathToFileURL(file).href);await page.evaluate(()=>App.ready);
  result.timings.seedMs=await page.evaluate(async()=>{
   const M=RingsideModel,E=RingsideEvaluation,repository=App.getRepository(),base=M.normalizeRecord(M.sampleRecord()),profile=E.create(base,"容量验收方案（模拟）"),catalog=M.libraryDefaults().catalog,start=performance.now();
   profile.criteria.imtpTimeStandards=[{timeMs:250,kind:"force_pct_peak",context:E.imtpTimeContext(base),target:80,ranges:[],direction:"higher",referenceEnabled:true,source:"容量验收自定规则"}];
   catalog.abilityGroups=[{key:"capacity_ability",name:"容量验收新增能力"},...RingsideTests.abilityGroups(catalog).map(group=>group.key==="最大力量"?{...group,name:"目录力量新名称"}:group)];
   base.abilityGroupSnapshot=[{key:"capacity_ability",name:"本次新增能力快照"},...RingsideTests.abilityGroups(base)];
   base.data.ift.method="容量验收记录方法";
   async function* rows(){
    yield{type:"header",format:"motionbench-backup",schema:3};
    yield{type:"config",value:{schema:3,kind:"athlete-library",catalog,testPlans:[{id:"capacity_plan",name:"容量验收组合",testIds:["imtp","cmj","mas"],defaultEvaluationProfileId:profile.id,disabled:false}],defaultEvaluationProfileId:profile.id,activeAthleteId:"capacity_000",activeRecordId:"record_0000",updated:new Date().toISOString()}};
    for(let g=0;g<10;g++)yield{type:"group",value:{id:"team_"+g,name:"模拟队伍 "+g}};
    yield{type:"profile",value:profile};
    for(let a=0;a<300;a++)yield{type:"athlete",value:{id:"capacity_"+String(a).padStart(3,"0"),name:"模拟运动员 "+String(a).padStart(3,"0"),profile:{name:"模拟运动员 "+String(a).padStart(3,"0"),sport:a%2?"篮球":"足球",sex:"未注明",dominantHand:"未注明",sportLevel:""},groupId:"team_"+(a%10),sample:false,archived:false,deletedAt:null}};
    for(let i=0;i<3000;i++){const r=JSON.parse(JSON.stringify(base)),a=Math.floor(i/10);r.recordId="record_"+String(i).padStart(4,"0");r.athleteId="capacity_"+String(a).padStart(3,"0");r.athlete.name="模拟运动员 "+String(a).padStart(3,"0");r.athlete.date="2026-10-"+String(i%10+1).padStart(2,"0");r.athlete.sport=a%2?"篮球":"足球";r.evaluationProfileId=profile.id;r.testPlanSnapshot={id:"capacity_plan",name:"容量验收组合",testIds:["imtp","cmj","mas"]};r.data.imtp[0].timePoints.push({id:"capacity_point",timeMs:250,force:1000,rfd:""});r.data.cmj[0].height=30+i/1000;r.title="模拟复测 "+(i%10+1);yield{type:"record",value:r};}
    yield{type:"end",counts:{athlete:300,record:3000,group:10,profile:1,config:1}};
   }
   await repository.importRows(rows());return performance.now()-start;
  });console.log("PASS seeded",channel,Math.round(result.timings.seedMs),"ms");
  result.timings.startupMs=[];
  for(let i=0;i<3;i++){const start=Date.now();await page.reload();assert.equal(await page.evaluate(()=>App.ready),true);await page.evaluate(()=>App.openManagement());result.timings.startupMs.push(Date.now()-start);}
  assert.equal(await page.evaluate(()=>App.getLibrary().testPlans[0].id),"capacity_plan");assert.equal(await page.evaluate(()=>App.getLibrary().evaluationProfiles[0].criteria.imtpTimeStandards[0].timeMs),250);assert.equal(await page.evaluate(()=>App.getLibrary().athletes.length),300);assert.equal(await page.evaluate(()=>App.getLibrary().athletes.reduce((n,a)=>n+a.records.length,0)),3000);
  assert.equal(await page.evaluate(()=>App.getLibrary().athletes.every(a=>a.records.every(r=>r._summary&&!r.data))),true);
  assert.deepEqual(await page.evaluate(()=>App.getLibrary().catalog.abilityGroups[0]),{key:"capacity_ability",name:"容量验收新增能力"});
  result.timings.searchMs=[];
  for(const text of ["模拟运动员 299","模拟运动员 150","模拟运动员 001"]){const start=Date.now();await page.locator('[data-manager-filter="q"]').fill(text);await page.waitForFunction(t=>document.querySelectorAll('[data-managed-id]').length===1&&document.querySelector('[data-managed-id]')?.innerText.includes(t),text,{polling:10});result.timings.searchMs.push(Date.now()-start);}
  result.timings.openMs=await page.evaluate(async()=>{const start=performance.now();await App.openManagedRecord("capacity_299","record_2999");return performance.now()-start;});
  assert.equal(await page.evaluate(()=>App.getState().abilityGroupSnapshot[0].name),"本次新增能力快照");assert.equal(await page.evaluate(()=>App.getState().data.ift.method),"容量验收记录方法");
  result.timings.saveMs=await page.evaluate(async()=>{const start=performance.now();App.getState().athlete.notes="3000 条记录保存验收（模拟）";if(!await App.saveNow())throw Error("save failed");return performance.now()-start;});
  console.log("TIMINGS",JSON.stringify(result.timings));
  assert.ok(Math.max(...result.timings.startupMs)<=3000,"startup exceeds 3 seconds");assert.ok(Math.max(...result.timings.searchMs)<=300,"search exceeds 300 ms");assert.ok(result.timings.openMs<=1000,"record open exceeds 1 second");assert.ok(result.timings.saveMs<=1000,"save exceeds 1 second");
  const backup=path.join(out,channel+"-capacity.motionbench.jsonl");let start=Date.now();const pending=page.waitForEvent("download",{timeout:180000});await page.evaluate(()=>{App.openManagement("backup");});await page.getByRole("button",{name:"导出完整备份",exact:true}).click();const download=await pending;await download.saveAs(backup);result.timings.backupMs=Date.now()-start;result.backupBytes=fs.statSync(backup).size;result.before=await recordHash(backup);
  assert.ok(result.backupBytes>50*1024*1024,"capacity fixture must exceed the old import limit");assert.equal(result.before.count,3000);console.log("PASS backup",channel,result.backupBytes,"bytes");
  const recoveredContext=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:960}}),recovered=await recoveredContext.newPage();
  recovered.on("pageerror",e=>result.errors.push(e.message));recovered.on("dialog",d=>d.accept());await recovered.goto(pathToFileURL(file).href);await recovered.evaluate(()=>App.ready);await recovered.evaluate(()=>App.openManagement("backup"));await recovered.locator('#backupImportMode').selectOption("replace");
  start=Date.now();await recovered.locator('#importFile').setInputFiles(backup);await recovered.waitForFunction(()=>App.getLibrary().athletes.reduce((n,a)=>n+a.records.length,0)===3000,null,{timeout:180000});result.timings.restoreMs=Date.now()-start;
  assert.equal(await recovered.evaluate(()=>App.getLibrary().testPlans[0].id),"capacity_plan");assert.equal(await recovered.evaluate(()=>App.getLibrary().evaluationProfiles[0].criteria.imtpTimeStandards[0].timeMs),250);assert.equal(await recovered.evaluate(()=>App.getState().athlete.notes),"3000 条记录保存验收（模拟）");
  await recovered.reload();assert.equal(await recovered.evaluate(()=>App.ready),true);assert.equal(await recovered.evaluate(()=>App.getLibrary().athletes.length),300);
  assert.deepEqual(await recovered.evaluate(()=>App.getLibrary().catalog.abilityGroups[0]),{key:"capacity_ability",name:"容量验收新增能力"});assert.equal(await recovered.evaluate(()=>App.getState().abilityGroupSnapshot[0].name),"本次新增能力快照");assert.equal(await recovered.evaluate(()=>App.getState().data.ift.method),"容量验收记录方法");result.abilityExtensionRoundtrip=true;
  await recovered.evaluate(()=>App.openManagement("backup"));const again=recovered.waitForEvent("download",{timeout:180000});await recovered.getByRole("button",{name:"导出完整备份",exact:true}).click();const restoredDownload=await again,restored=path.join(out,channel+"-capacity-restored.motionbench.jsonl");await restoredDownload.saveAs(restored);result.after=await recordHash(restored);assert.deepEqual(result.after,result.before);
  await recovered.screenshot({path:path.join(out,channel+"-capacity-restored.png")});await recoveredContext.close();
  assert.deepEqual(result.errors,[]);result.pass=true;console.log("PASS 300 athletes, 3000 records, exact backup roundtrip",channel);
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;await page.screenshot({path:path.join(out,channel+"-capacity-failure.png")}).catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,channel+"-capacity.json"),JSON.stringify(result,null,2));await context.close();await browser.close();}
})();
