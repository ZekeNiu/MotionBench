"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/cpet-reference"),channel=process.argv.includes("--edge")?"msedge":"chrome";
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,checks:[],errors:[],network:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce"}),page=await context.newPage();page.setDefaultTimeout(12000);
 page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});page.on("dialog",d=>d.accept());
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS",name);};
 const click=(action,id)=>page.locator(`[data-manager-action="${action}"]${id!==undefined?`[data-id="${id}"]`:""}`).first().click();
 const control=field=>page.locator(`[data-profile-path="${field}"]`),save=async()=>{await click("profile-review");await page.locator("#managementModal").waitFor({state:"visible"});await page.locator('#managementForm [type="submit"]').click();await page.locator("#managementModal").waitFor({state:"hidden"});};
 let profileId,athleteId,recordIds,index,base,originalData;
 const open=async id=>{await page.evaluate(()=>App.openManagement("profiles"));await click("profile-edit",id||profileId);await page.locator("#profileMetricSelect").selectOption("cpet_vo2_relative");};
 try{
  fs.mkdirSync(out,{recursive:true});await page.goto(pathToFileURL(file).href);await page.evaluate(()=>App.ready);
  ({profileId,athleteId,recordIds,index,originalData}=await page.evaluate(async()=>{
   const r=RingsideModel.defaults();Object.assign(r.athlete,{name:"心肺分层测试",sex:"男",age:25,mass:70});Object.keys(r.enabled).forEach(k=>r.enabled[k]=k==="cpet");Object.assign(r.data.cpet,{modality:"treadmill",vo2:45.4,vo2Unit:"ml/kg/min",rer:1.1});
   await App.importPayload(RingsideModel.recordEnvelope(r));const library=await App.libraryPayload(),athlete=library.athletes[0],first=athlete.records[0],second=JSON.parse(JSON.stringify(first));second.recordId=crypto.randomUUID();second.title="未提供 RER 的关联记录";second.data.cpet.rer="";athlete.records.push(second);await App.importPayload(library,"replace-library");
   return{profileId:first.evaluationProfileId,athleteId:athlete.id,recordIds:[first.recordId,second.recordId],index:library.evaluationProfiles.find(p=>p.id===first.evaluationProfileId).criteria.definitions.findIndex(d=>d.id==="cpet_vo2_relative"),originalData:JSON.stringify(athlete.records.map(r=>r.data))};
  }));base="definitions."+index;
  await check("FRIEND opens as 28 structured rows and duplicate applicability is blocked",async()=>{
   await open();assert.equal(await page.locator("[data-reference-group]").count(),28);await click("profile-group-copy",index+":0");assert.equal(await page.locator("[data-reference-group]").count(),29);await click("profile-review");assert.match(await page.locator("#profileEditorError").innerText(),/重叠/);assert.equal(await page.locator("#managementModal").isVisible(),false);await click("profile-group-delete",index+":1");
  });
  await check("numeric group and interval editing supports a separate under-20 training target",async()=>{
   await control(base+".target").fill("50");await click("profile-group-add",String(index));const p=base+".referenceGroups.28";
   await control(p+".sex").selectOption("male");await control(p+".mode").selectOption("treadmill");await control(p+".ageMin").fill("18");await control(p+".ageMax").fill("20");await control(p+".target").fill("60");await control(p+".source").fill("青年专项训练目标 · 测试用自定义方案");
   await click("profile-group-range-add",index+":28");await control(p+".ranges.0.max").fill("40");await control(p+".ranges.0.label").fill("低于测试界值");
   await click("profile-group-range-add",index+":28");await control(p+".ranges.1.min").fill("40");await control(p+".ranges.1.label").fill("达到测试界值");
   const firstId=await page.locator("[data-reference-group]").first().getAttribute("data-reference-group");await click("profile-group-select",firstId);
   await control(base+".referenceGroups.0.ranges.10.min").fill("44");await click("profile-review");assert.match(await page.locator("#profileEditorError").innerText(),/区间重叠/);
   await control(base+".referenceGroups.0.ranges.10.min").fill("46");await control(base+".referenceGroups.0.ranges.9.max").fill("46");
   await click("profile-review");assert.match(await page.locator("#managementFields").innerText(),/2 条关联记录/);assert.match(await page.locator("#managementFields").innerText(),/分层标准/);assert.match(await page.locator("#managementFields").innerText(),/用户调整/);await page.locator('#managementForm [type="submit"]').click();await page.locator("#managementModal").waitFor({state:"hidden"});
  });
  await check("saved scheme re-evaluates linked records and RER never disables an independent target",async()=>{
   const data=await page.evaluate(async({profileId,recordIds})=>{const profile=App.getLibrary().evaluationProfiles.find(p=>p.id===profileId),records=await Promise.all(recordIds.map(id=>App.getRepository().loadRecord(id)));return{raw:JSON.stringify(records.map(r=>r.data)),results:records.map(r=>{const d=RingsideEvaluation.resolve(r,profile).definitions.find(d=>d.id==="cpet_vo2_relative");return{target:d.target,enabled:d.referenceEnabled,label:RingsideModel.grade(45.4,d).label,ranges:d.ranges.length};}),groups:profile.criteria.definitions.find(d=>d.id==="cpet_vo2_relative").referenceGroups.length};},{profileId,recordIds});
   assert.equal(data.raw,originalData);assert.equal(data.groups,29);assert.equal(data.results[0].label,"P45–P50");assert.equal(data.results[1].ranges,0);assert.equal(data.results[1].target,50);assert.equal(data.results[1].enabled,true);
   await page.reload();await page.evaluate(()=>App.ready);await open();assert.equal(await page.locator("[data-reference-group]").count(),29);assert.equal(await control(base+".target").inputValue(),"50");await click("profile-close");
  });
  await check("copied schemes own separate grouped targets and edits do not alter the original",async()=>{
   await click("profile-copy",profileId);await page.locator("#profileName").fill("心肺标准副本");await page.locator("#profileMetricSelect").selectOption("cpet_vo2_relative");await control(base+".referenceGroups.0.target").fill("65");await save();
   const data=await page.evaluate(id=>{const lib=App.getLibrary(),a=lib.evaluationProfiles.find(p=>p.id===id),b=lib.evaluationProfiles.find(p=>p.name==="心肺标准副本"),d=p=>p.criteria.definitions.find(d=>d.id==="cpet_vo2_relative");return{old:d(a).referenceGroups[0].target??null,copy:d(b).referenceGroups[0].target,count:d(b).referenceGroups.length};},profileId);assert.equal(data.old,null);assert.equal(data.copy,65);assert.equal(data.count,29);
  });
  await check("group removal is previewed and persists without affecting other groups",async()=>{
   await open();await click("profile-group-delete",index+":28");await click("profile-review");assert.match(await page.locator("#managementFields").innerText(),/青年专项训练目标/);assert.match(await page.locator("#managementFields").innerText(),/未包含/);await page.locator('#managementForm [type="submit"]').click();await page.locator("#managementModal").waitFor({state:"hidden"});
   assert.equal(await page.evaluate(id=>App.getLibrary().evaluationProfiles.find(p=>p.id===id).criteria.definitions.find(d=>d.id==="cpet_vo2_relative").referenceGroups.length,profileId),28);
  });
  await check("structured reference editor stays within desktop and mobile page width",async()=>{
   await open();for(const [width,height]of [[1440,1000],[390,844]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const geometry=await page.evaluate(()=>({rowHeight:document.querySelector(".reference-groups-table tbody tr").getBoundingClientRect().height,pageHeight:document.documentElement.scrollHeight}));assert.ok(geometry.rowHeight<160,"group rows must stay compact");result.geometry??=[];result.geometry.push({width,...geometry});await page.screenshot({path:path.join(out,`${channel}-groups-${width}.png`),fullPage:true});await page.evaluate(()=>document.querySelector(".reference-groups-table").scrollIntoView({block:"start"}));await page.screenshot({path:path.join(out,`${channel}-groups-${width}-viewport.png`)});}
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;await page.screenshot({path:path.join(out,channel+"-failure.png"),fullPage:true}).catch(()=>{});}
 finally{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,channel+"-reference-browser.json"),JSON.stringify(result,null,2));await browser.close();}
})();
