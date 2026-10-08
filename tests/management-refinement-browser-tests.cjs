"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/management-refinement"),channel=process.argv.includes("--edge")?"msedge":process.env.BROWSER_CHANNEL||"chrome",result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,checks:[],errors:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",e=>result.errors.push(e.message));const acceptDialog=d=>d.accept();page.on("dialog",acceptDialog);
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS",name);};
 const click=(name,id)=>page.locator(`[data-manager-action="${name}"]${id?`[data-id="${id}"]`:""}`).first().click(),manage=tab=>page.evaluate(t=>App.openManagement(t),tab),save=async()=>{await page.locator('#managementForm [type="submit"]').click();await page.locator("#managementModal").waitFor({state:"hidden"});};
 let owner,profileId,alternateId,recordId,teamId,planId;
 try{
  fs.mkdirSync(out,{recursive:true});await page.goto(pathToFileURL(file).href);await page.evaluate(()=>App.ready);
  ({owner,profileId,alternateId,recordId}=await page.evaluate(async()=>{
   await App.importPayload(RingsideModel.recordEnvelope(RingsideModel.sampleRecord()));const library=await App.libraryPayload(),a=library.athletes[0],r=a.records[0];
   library.groups=[{id:"team_original",name:"原队伍"}];a.groupId="team_original";
   library.athletes.push({id:"empty_alpha",name:"同名运动员",profile:{name:"同名运动员",sport:"田径",sex:"未注明",dominantHand:"未注明",sportLevel:""},groupId:"",archived:false,deletedAt:null,records:[]});
   const alternate=JSON.parse(JSON.stringify(library.evaluationProfiles[0]));alternate.id="evaluation_alternate";alternate.name="对照评价方案";alternate.criteria.definitions.find(d=>d.id==="cmj_height").target=80;alternate.criteria.definitions=alternate.criteria.definitions.filter(d=>d.id!=="sj_height");alternate.criteria.iso.find(r=>r.id==="iso_neck_flexion").protocol="不同测量协议";alternate.criteria.lvp.bench.metric="PV";library.evaluationProfiles.push(alternate);
   await App.importPayload(library,"replace-library");return{owner:a.id,profileId:r.evaluationProfileId,alternateId:alternate.id,recordId:r.recordId};
  }));
  await check("teams are independent and member transfers preserve athlete and record ownership",async()=>{
   await manage("teams");await click("group-new");await page.locator('#managementForm [name="name"]').fill("测试二队");await save();teamId=await page.evaluate(()=>App.getLibrary().groups.find(g=>g.name==="测试二队").id);
   await click("team-add",teamId);await page.locator('#teamMemberSearch').fill("同名运动员");assert.equal(await page.locator('[data-team-candidate]:visible').count(),1);await page.locator('[name="athleteIds"][value="empty_alpha"]').check();await page.locator('#teamMemberSearch').fill("");await page.locator(`[name="athleteIds"][value="${owner}"]`).check();await save();
   await click("team-open",teamId);assert.equal(await page.locator('[data-team-member]').count(),2);assert.equal(await page.evaluate(id=>App.getLibrary().athletes.find(a=>a.id===id).groupId,owner),teamId);
   await click("team-transfer",owner);await page.locator('[name="groupId"]').selectOption("team_original");await save();assert.equal(await page.locator('[data-team-member]').count(),1);
   await click("team-remove","empty_alpha");assert.equal(await page.evaluate(()=>App.getLibrary().athletes.find(a=>a.id==="empty_alpha").groupId),"");
   await click("team-close");await click("group-delete","team_original");assert.equal(await page.evaluate(id=>App.getLibrary().athletes.find(a=>a.id===id).groupId,owner),"");assert.equal(await page.evaluate(id=>App.getRepository().loadRecord(id).then(r=>r.athleteId),recordId),owner);
  });
  await check("named test plans persist ordered projects and support copy disable and delete",async()=>{
   await manage("plans");await click("plan-new");await page.locator('#testPlanName').fill("力量测试组合");await page.locator('#testPlanProfile').selectOption(alternateId);
   for(const id of ["cmj","imtp"])await page.locator(`[data-plan-project-choice="${id}"]`).check();await page.locator('.picker-order summary').click();await page.locator('[data-picker-action="up"][data-picker-id="imtp"]').click();await click("plan-save");
   const plan=await page.evaluate(()=>App.getLibrary().testPlans.find(p=>p.name==="力量测试组合"));planId=plan.id;assert.deepEqual(plan.testIds,["imtp","cmj"]);assert.equal(plan.defaultEvaluationProfileId,alternateId);
   await page.reload();await page.evaluate(()=>App.ready);await manage("plans");assert.deepEqual(await page.evaluate(id=>App.getLibrary().testPlans.find(p=>p.id===id).testIds,planId),["imtp","cmj"]);
   await click("plan-copy",planId);await click("plan-save");const copy=await page.evaluate(()=>App.getLibrary().testPlans.find(p=>p.name==="力量测试组合 副本"));assert.notEqual(copy.id,planId);await click("plan-toggle",copy.id);await page.locator(`[data-test-plan="${copy.id}"] .pill`).waitFor();assert.equal(await page.evaluate(id=>App.getLibrary().testPlans.find(p=>p.id===id).disabled,copy.id),true);await click("plan-delete",copy.id);await page.locator(`[data-test-plan="${copy.id}"]`).waitFor({state:"hidden"});assert.equal(await page.locator('[data-test-plan]').count(),1);
  });
  await check("isometric plan choices save explicit directions and legacy plans retain their original 22 directions",async()=>{
   await manage("plans");await click("plan-new");await page.locator('#testPlanName').fill("关节测试组合");await page.locator('[data-plan-project-choice="iso"]').check();
   assert.equal(await page.locator('[data-picker-iso]:checked').count(),0);await click("plan-save");assert.match(await page.locator('#testPlanError').innerText(),/至少选择一个等长力量测试方向/);
   for(const id of ["iso_neck_flexion","iso_hip_extension"])await page.locator(`[data-picker-iso="${id}"]`).check();await click("plan-save");
   const saved=await page.evaluate(()=>App.getLibrary().testPlans.find(p=>p.name==="关节测试组合"));assert.deepEqual(saved.isoDirectionIds,["iso_neck_flexion","iso_hip_extension"]);
   await click("plan-edit",saved.id);assert.equal(await page.locator('[data-picker-iso]:checked').count(),2);await page.locator('[data-plan-project-choice="cmj"]').check();assert.equal(await page.locator('#testPlanName').inputValue(),"关节测试组合");await click("plan-close");assert.deepEqual(await page.evaluate(id=>App.getLibrary().testPlans.find(p=>p.id===id).testIds,saved.id),["iso"]);
   await page.evaluate(async()=>{const lib=App.getLibrary();lib.testPlans.push({id:"plan_legacy_picker",name:"旧关节方案",testIds:["iso"],defaultEvaluationProfileId:lib.defaultEvaluationProfileId,disabled:false});await App.saveLibraryChanges();RingsideManagement.render();});
   await click("plan-edit","plan_legacy_picker");assert.equal(await page.locator('[data-picker-iso]:checked').count(),22);await page.locator('[data-plan-project-choice="cmj"]').check();await click("plan-save");assert.equal(await page.evaluate(()=>App.getLibrary().testPlans.find(p=>p.id==="plan_legacy_picker").isoDirectionIds.length),22);
   await click("plan-delete",saved.id);await click("plan-delete","plan_legacy_picker");
  });
  await check("metric library keeps each project in one ability table and selects standards without assigning the report",async()=>{
   await manage("metrics");assert.equal(await page.locator('[data-metric-project="imtp"]').count(),1);assert.equal(await page.locator('[data-metric-project="cmj"]').count(),1);assert.ok(await page.locator('[data-metric-ability]').count()>3);
   const neck=page.locator('[data-library-metric="iso_neck_flexion"]');assert.doesNotMatch(await neck.innerText(),/（中线）|左\s*\/\s*右/);assert.match(await neck.innerText(),/单值测量/);assert.match(await page.locator('[data-library-metric="iso_neck_rotation"]').innerText(),/双侧测量/);
   await page.locator('#metricEvaluationProfile').selectOption(alternateId);assert.equal(await page.evaluate(()=>App.getState().evaluationProfileId),profileId);assert.match(await page.locator('[data-library-metric="cmj_height"]').innerText(),/80/);
   await click("standard-edit","cmj_height");assert.equal(await page.locator('#profileName').inputValue(),"对照评价方案");assert.equal(await page.locator('#profileMetricSelect').inputValue(),"cmj_height");await page.locator('[data-profile-path$=".target"]').fill("85");assert.equal(await page.evaluate(id=>App.getLibrary().evaluationProfiles.find(p=>p.id===id).criteria.definitions.find(d=>d.id==="cmj_height").target,alternateId),80);
   await click("profile-review");assert.match(await page.locator('#managementFields').innerText(),/0 条关联记录/);await save();assert.equal(await page.locator('#metricEvaluationProfile').inputValue(),alternateId);assert.match(await page.locator('[data-library-metric="cmj_height"]').innerText(),/85/);assert.equal(await page.evaluate(()=>App.getState().evaluationProfileId),profileId);
  });
  await check("unconfigured metric starts with blank standards and unsaved profile drafts survive navigation and cancelled dismissal",async()=>{
   assert.match(await page.locator('[data-library-metric="sj_height"]').innerText(),/未设置评价标准/);assert.match(await page.locator('[data-library-metric="iso_neck_flexion"]').innerText(),/不匹配/);assert.match(await page.locator('[data-library-metric="lvp_bench"]').innerText(),/不匹配/);
   await click("standard-edit","sj_height");assert.equal(await page.locator('[data-profile-path$=".target"]').inputValue(),"");assert.equal(await page.locator('[data-profile-ranges]').inputValue(),"");assert.equal(await page.locator('[data-profile-path$=".referenceEnabled"]').isChecked(),false);await page.locator('[data-profile-path$=".target"]').fill("55");
   await manage("teams");await manage("profiles");assert.equal(await page.locator('[data-profile-path$=".target"]').inputValue(),"55");page.off("dialog",acceptDialog);page.once("dialog",d=>d.dismiss());await click("profile-close");assert.equal(await page.locator('[data-profile-path$=".target"]').inputValue(),"55");page.on("dialog",acceptDialog);await click("profile-close");assert.equal(await page.evaluate(id=>App.getLibrary().evaluationProfiles.find(p=>p.id===id).criteria.definitions.some(d=>d.id==="sj_height"),alternateId),false);
  });
  await check("fixed scoring and dedicated isometric targets open their relevant editors",async()=>{
   await click("standard-fms");assert.match(await page.locator('#managementFields').innerText(),/0–3 分/);await save();await click("standard-iso","iso_neck_flexion");assert.equal(await page.locator('[data-manager-action="profile-tab"][aria-current="page"]').getAttribute("data-id"),"iso");assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-standard-key]')?.dataset.standardKey),"iso_neck_flexion");await click("profile-close");
   await click("standard-lvp","bench");assert.equal(await page.locator('[data-manager-action="profile-tab"][aria-current="page"]').getAttribute("data-id"),"lvp");await click("profile-close");
  });
  await check("legacy IMTP N standards require an explicit switch and arbitrary time standards save as profile drafts",async()=>{
   const before=await page.evaluate(id=>JSON.stringify(App.getLibrary().evaluationProfiles.find(p=>p.id===id).criteria.definitions.find(d=>d.id==="imtp_f100")),alternateId);
   await click("standard-time","force_pct_peak:100");await click("profile-time-create","force_pct_peak:100");assert.equal(await page.locator('[data-profile-path$=".target"]').inputValue(),"");assert.equal(await page.locator('[data-profile-ranges]').inputValue(),"");assert.equal(await page.evaluate(id=>App.getLibrary().evaluationProfiles.find(p=>p.id===id).criteria.imtpTimeStandards?.length||0,alternateId),0);
   await page.locator('[data-profile-path$=".target"]').fill("50");await click("profile-review");await save();assert.equal(await page.evaluate(id=>JSON.stringify(App.getLibrary().evaluationProfiles.find(p=>p.id===id).criteria.definitions.find(d=>d.id==="imtp_f100")),alternateId),before);
   await click("standard-time-new");await page.locator('[name="timeMs"]').fill("150");await page.locator('[name="kind"]').selectOption("rfd");await save();assert.equal(await page.locator('#imtpStandardSelect').inputValue(),"rfd:150");await page.locator('[data-profile-path$=".target"]').fill("2500");await click("profile-review");await save();
   const rules=await page.evaluate(id=>App.getLibrary().evaluationProfiles.find(p=>p.id===id).criteria.imtpTimeStandards,alternateId);assert.equal(rules.find(r=>r.kind==="force_pct_peak"&&r.timeMs===100).target,50);assert.equal(rules.find(r=>r.kind==="rfd"&&r.timeMs===150).target,2500);assert.equal(await page.locator('[data-library-metric="rfd:150"]').count(),1);
  });
  await check("management pages fit desktop low window and phone without horizontal page overflow",async()=>{
   for(const [width,height]of [[1440,960],[1024,640],[390,844]]){await page.setViewportSize({width,height});for(const tab of ["teams","plans","metrics","profiles"]){await manage(tab);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width} ${tab}`);}await manage("metrics");await page.evaluate(()=>scrollTo({top:0,behavior:"instant"}));await page.screenshot({path:path.join(out,`${channel}-metrics-${width}.png`),fullPage:true});await page.screenshot({path:path.join(out,`${channel}-metrics-${width}-viewport.png`)});}
  });
  assert.deepEqual(result.errors,[]);assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"),result.sourceHash);result.pass=true;
 }catch(error){result.error=error.stack;process.exitCode=1;console.error(error);await page.screenshot({path:path.join(out,channel+"-failure.png"),fullPage:true}).catch(()=>{});}
 finally{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,channel+"-browser.json"),JSON.stringify(result,null,2));await browser.close();}
})();
