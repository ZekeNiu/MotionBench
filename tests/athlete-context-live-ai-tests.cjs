"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/ai/athlete-context"),url=process.env.MOTIONBENCH_LIVE_URL||"http://127.0.0.1:8875/MotionBench.html";
fs.mkdirSync(out,{recursive:true});
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),transport:"shipped Windows launcher and saved DPAPI configuration",live:true,ran:false,pass:false,cases:[],errors:[],qualityReviewed:false};
(async()=>{
 const browser=await chromium.launch({channel:"chrome"}),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",error=>result.errors.push(error.message));page.on("dialog",dialog=>dialog.accept());
 // This harness may only read existing launcher configuration. Credentials and
 // request headers never enter the evidence or a browser profile on disk.
 await page.route("**/api/ai-settings",async route=>{const body=route.request().postDataJSON();if(body.action!=="status")return route.abort("blockedbyclient");await route.continue();});
 let current=null;
 page.on("request",request=>{if(!current||!request.url().endsWith("/api/relay"))return;const body=request.postDataJSON();if(body.path!=="/chat/completions")return;const user=body.payload.messages.find(message=>message.role==="user");current.facts=JSON.parse(user.content.slice(user.content.indexOf("\n")+1));current.requestCount=(current.requestCount||0)+1;});
 try{
  await page.goto(url);assert.equal(await page.evaluate(()=>App.ready),true);assert.equal(await page.evaluate(()=>!!window.MotionBenchLocal),true);
  const status=await page.evaluate(()=>RingsideAISettings.status());result.configuration={hasKey:status.hasKey,model:status.model,state:status.state,revision:status.revision};
  if(!status.hasKey||!status.model){result.unrunReason="现有 Windows DPAPI 配置缺少已保存密钥或模型；未修改配置，未发起模型请求。";console.log("UNRUN: saved launcher configuration is incomplete");return;}
  result.ran=true;
  await page.evaluate(async()=>{const M=RingsideModel,lib=await App.libraryPayload(),profile=M.profileFromRecord({name:"AI背景对照（模拟）",sex:"女",sport:"拳击",birthDate:"2000-10-10",experienceYears:"3",injuryHistory:"既往左膝损伤，目前状态见本次记录"}),record=M.recordFromCatalog(lib.catalog,profile,{cmj:true,imtp:true},"2026-10-10");record.athleteId="context-live-athlete";record.recordId="context-live-record";record.athlete.mass=65;M.applyAge(record,profile.birthDate);record.data.cmj=[{id:"context-cmj",height:28}];record.data.imtp=[{id:"context-imtp",peakForce:1950,timePoints:[]}];record.evaluationProfileId=lib.defaultEvaluationProfileId;record.trainingContext={...record.trainingContext,experienceYears:"3",equipment:"杠铃、哑铃、药球",weeklySessions:"2",weeklySchedule:"周一、周四体能，周二、周五拳击专项"};lib.athletes=[{id:record.athleteId,name:profile.name,profile,groupId:"",sample:false,archived:false,deletedAt:null,records:[record]}];lib.activeAthleteId=record.athleteId;lib.activeRecordId=record.recordId;await App.importPayload(lib,"replace-library");});
  const baseline=await page.evaluate(()=>JSON.stringify(App.getState().data));
  for(const scenario of [{id:"pain-close-competition",injury:"左膝负重下蹲疼痛，深屈膝动作会加重症状",previous:"2026-10-08",next:"2026-10-12",expected:{daysSincePrevious:2,daysUntilNext:2}},{id:"recovered-distant-competition",injury:"当前无疼痛，无已知训练限制",previous:"2026-09-05",next:"2026-11-21",expected:{daysSincePrevious:35,daysUntilNext:42}}]){
   const item={id:scenario.id,pass:false};result.cases.push(item);current=item;
   await page.evaluate(()=>App.openEntry("athlete"));await page.locator('[data-path="athlete.injury"]').fill(scenario.injury);await page.locator('[data-path="trainingContext.previousCompetitionDate"]').fill(scenario.previous);await page.locator('[data-path="trainingContext.nextCompetitionDate"]').fill(scenario.next);await page.locator('[data-path="trainingContext.nextCompetitionDate"]').dispatchEvent("change");assert.equal(await page.evaluate(()=>App.saveNow()),true);assert.equal(await page.evaluate(()=>JSON.stringify(App.getState().data)),baseline);
   await page.evaluate(()=>App.openEntry("narrative"));const before=await page.evaluate(()=>App.getState().narrative.text),start=Date.now();await page.locator("[data-ai-generate]").click();
   await page.waitForFunction(()=>document.querySelector("#previewModal").classList.contains("show")||document.querySelector("#aiProgress").dataset.state==="error",null,{timeout:640000});item.elapsedMs=Date.now()-start;
   assert.equal(await page.locator("#previewModal").isVisible(),true,await page.locator("#aiProgressDetail").textContent());assert.equal(await page.evaluate(()=>App.getState().narrative.text),before);assert.equal(item.facts.athlete.injury,scenario.injury);assert.deepEqual(item.facts.competition,scenario.expected);assert.equal(JSON.stringify(item.facts).includes("2000-10-10"),false);assert.equal("birthDate" in item.facts.athlete,false);
   item.previewText=await page.locator("#aiPreview").innerText();assert.ok(item.previewText.trim());await page.locator("#applyDraftButton").click();assert.equal(await page.evaluate(()=>App.getState().narrative.text),item.previewText);item.applied=true;item.pass=true;fs.writeFileSync(path.join(out,item.id+".md"),item.previewText);await page.screenshot({path:path.join(out,item.id+".png"),fullPage:true});console.log("PASS live workflow:",item.id);
  }
  current=null;assert.equal(result.cases[0].previewText===result.cases[1].previewText,false);assert.deepEqual(result.errors,[]);result.pass=true;
 }catch(error){result.failure=error.message;console.error("Live context check failed:",error.message);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));await browser.close();}
})();
