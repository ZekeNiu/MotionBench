"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const {chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome",out=path.resolve(process.argv.includes("--artifact-dir")?process.argv[process.argv.indexOf("--artifact-dir")+1]:path.join(root,"output/release/2.29.0-local/acceptance/workflow-selection-"+channel)),hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files=["ringside.css","ringside-workflow.css","ringside-report-selection.js","ringside-team-selection.js","ringside-horizontal-setup.js","ringside-classifications.js","ringside-report-selection.css","ringside-team-selection.css"];
async function main(){
  fs.mkdirSync(out,{recursive:true});const result={synthetic:true,isolated:true,channel,runnerSha256:hash(__filename),sources:Object.fromEntries([...files.map(file=>["src/"+file,hash(path.join(root,"src",file))]),["tests/helpers/playwright.cjs",hash(path.join(__dirname,"helpers/playwright.cjs"))]]),checks:[],errors:[],pass:false};let browser,page;
  const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS "+name);};
  try{
    browser=await chromium.launch({channel,headless:true});page=await browser.newPage({viewport:{width:1440,height:900},locale:"zh-CN"});page.on("pageerror",error=>result.errors.push(error.stack||error.message));
    await page.setContent('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><main id="fixture" class="report-selection-unified operation-ui" style="max-width:1120px;margin:30px auto;padding:24px"></main></body></html>');
    for(const file of files.filter(file=>file.endsWith(".css")))await page.addStyleTag({path:path.join(root,"src",file)});
    for(const file of ["ringside-classifications.js","ringside-horizontal-setup.js","ringside-report-selection.js","ringside-team-selection.js"])await page.addScriptTag({path:path.join(root,"src",file)});
    await page.evaluate(()=>{
      window.RingsideLongitudinalStore={validDate:value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))};
      const record=(recordId,date)=>({recordId,athlete:{date},title:recordId});
      window.fixtureLibrary={groups:[{id:"g1",name:"一队"},{id:"g2",name:"二队"}],classifications:{},evaluationProfiles:[],defaultEvaluationProfileId:"",athletes:[{id:"a",name:"同名",groupId:"g1",profile:{name:"同名"},records:[record("a-old","2026-11-01"),record("a-new","2026-11-05"),record("a-tie","2026-11-05")]},{id:"b",name:"同名",groupId:"g2",profile:{name:"同名"},records:[record("b-old","2026-11-01")]},{id:"missing",name:"未测队员",groupId:"g1",profile:{name:"未测队员"},records:[]}]};
      window.submitted=[];window.fixtureHost={library:()=>fixtureLibrary,element:()=>document.getElementById("fixture"),select:async(value)=>{submitted.push(structuredClone(value));return true;}};
      window.teamSelector=RingsideTeamSelection.create(fixtureHost);window.singleConfig={groupId:"g1",participants:[{athleteId:"a",recordId:"a-old"},{athleteId:"missing",recordId:""}],window:{kind:"custom",from:"",to:""},mode:"best",profileId:"",title:"原记录标题"};
    });
    await check("team step opens its full content, exposes all undated history and preserves an old explicit source",async()=>{
      await page.evaluate(()=>teamSelector.open(singleConfig,{step:3}));assert.equal(await page.locator('[data-team-panel="records"]').isVisible(),true);assert.equal(await page.locator('.team-selection-actions').isVisible(),false);
      assert.equal(await page.locator('[data-team-record="a"] option').count(),4);assert.equal(await page.locator('[data-team-record="a"]').inputValue(),"a-old");
      await page.locator('[data-team-field="to"]').fill("2026-12-01");await page.locator('[data-team-field="to"]').blur();assert.equal(await page.locator('[data-team-record="a"]').inputValue(),"a-old");
      await page.locator('[data-team-field="from"]').fill("2026-11-02");await page.locator('[data-team-field="from"]').blur();assert.equal(await page.locator('[data-team-record="a"]').inputValue(),"");assert.equal(await page.locator('[data-team-record="a"] option').count(),3);
    });
    await check("longitudinal selects real dates with explicit same-day sources and missing roster members",async()=>{
      await page.evaluate(()=>teamSelector.open({...singleConfig,analysisMode:"longitudinal"},{step:3}));for(const date of["2026-11-01","2026-11-05"])await page.locator('[data-team-select-date="'+date+'"]').check();
      assert.equal(await page.evaluate(()=>teamSelector.validateStep(3).valid),false);await page.locator('[data-team-date="2026-11-05"][data-team-record="a"]').selectOption("a-tie");assert.equal(await page.evaluate(()=>teamSelector.validateStep(3).valid),true);
      const state=await page.evaluate(()=>teamSelector.state());assert.deepEqual(state.athleteIds,["a","missing"]);assert.equal(state.dateParticipants[1].participants[0].recordId,"a-tie");assert.equal(state.dateParticipants[1].participants[1].recordId,"");
      await page.evaluate(()=>teamSelector.setStep(4));await page.locator('[data-report-title]').fill("本次纵向报告");await page.locator('[data-report-title]').blur();assert.equal(await page.evaluate(()=>teamSelector.state().title),"原记录标题");assert.equal(await page.evaluate(()=>teamSelector.apply()),true);assert.equal(await page.evaluate(()=>submitted.at(-1).reportTitle),"本次纵向报告");
    });
    await check("horizontal begins empty and adds actual teams or a current custom member group without a main object",async()=>{
      await page.evaluate(()=>teamSelector.open({...singleConfig,analysisMode:"horizontal",objects:[]},{step:2}));assert.equal(await page.locator('.team-object').count(),0);assert.equal(await page.evaluate(()=>teamSelector.validateStep(2).valid),false);
      await page.locator('[data-team-add-group]').selectOption("g1");await page.locator('[data-team-add-group]').selectOption("g2");assert.equal(await page.locator('.team-object').count(),2);assert.equal(await page.evaluate(()=>teamSelector.validateStep(2).valid),true);
      await page.locator('[data-team-add-custom]').click();await page.locator('[data-team-object-label]').fill("临时成员");await page.locator('[data-team-object-label]').blur();await page.locator('[data-team-person="b"]').check();assert.equal(await page.evaluate(()=>teamSelector.state().objects.at(-1).participants[0].athleteId),"b");assert.equal(await page.evaluate(()=>teamSelector.state().objects.some(object=>object.focus)),false);
    });
    await check("standalone references use the shared complete editor and all three sampling methods",async()=>{
      await page.evaluate(()=>teamSelector.open({...singleConfig,analysisMode:"horizontal",participants:[],objects:[]},{step:2}));
      for(const sampling of["latest","period-record","period-mean"]){await page.locator('[data-team-add-reference]').click();const dialog=page.locator('#teamReportReferenceDialog');await dialog.locator('[data-reference-field="label"]').fill(sampling);await dialog.locator('[data-reference-field="window.kind"]').selectOption("all");await dialog.locator('[data-reference-field="sampling"]').selectOption(sampling);await dialog.locator('[data-reference-confirm]').click();await dialog.waitFor({state:"hidden"});}
      assert.deepEqual(await page.evaluate(()=>teamSelector.state().objects.map(object=>object.reference.sampling)),["latest","period-record","period-mean"]);assert.equal(await page.evaluate(()=>teamSelector.validateStep(2).valid),true);assert.equal(await page.evaluate(()=>teamSelector.validateStep(3).valid),true);
      assert.equal(await page.evaluate(()=>teamSelector.state().objects.some(object=>object.kind==="team")),false);
    });
    await check("reference evaluation conflicts update that exact object with a chosen common standard",async()=>{
      await page.evaluate(()=>{const referenceId=teamSelector.state().objects[1].id;teamSelector.showConflicts([{referenceId,metricKey:"jump",name:"跳高",unit:"cm",candidates:[{standard:{kind:"metric",subjectId:"jump",unit:"cm",target:40,enabled:true,applicable:true,revision:1,ranges:[]}}]}]);});
      const dialog=page.locator('#teamReportReferenceDialog');await dialog.locator('[data-standard-choice]').selectOption("0");await dialog.locator('[data-reference-confirm]').click();await dialog.waitFor({state:"hidden"});assert.equal(await page.evaluate(()=>teamSelector.state().objects[1].reference.evaluationOverrides.jump.standard.target),40);
      await page.evaluate(()=>teamSelector.setStep(4));assert.equal(await page.evaluate(()=>teamSelector.apply()),true);assert.equal(await page.evaluate(()=>submitted.at(-1).objects[1].reference.evaluationOverrides.jump.standard.target),40);
    });
    await check("team standard conflicts edit only the existing object and unknown conflicts never create a reference",async()=>{
      await page.evaluate(()=>teamSelector.open({...singleConfig,analysisMode:"horizontal",objects:[{id:"team-one",kind:"team",label:"原团队一",participants:[{athleteId:"a",recordId:"a-old"}]},{id:"team-two",kind:"team",label:"原团队二",participants:[{athleteId:"b",recordId:"b-old"}]}]},{step:4}));
      const before=await page.evaluate(()=>teamSelector.state().objects);
      assert.equal(await page.evaluate(()=>teamSelector.showConflicts([{referenceId:"team-one",metricKey:"jump",name:"跳高",unit:"cm",candidates:[{standard:{kind:"metric",subjectId:"jump",unit:"cm",target:40,enabled:true,applicable:true,revision:1,ranges:[]}}]}])),true);
      const dialog=page.locator('#teamReportStandardsDialog');assert.match(await dialog.locator('h2').innerText(),/原团队一.*统一评价标准/);assert.equal(await dialog.locator('[data-reference-field]').count(),0);await dialog.locator('[data-standard-choice]').selectOption("0");await dialog.locator('[data-reference-confirm]').click();await dialog.waitFor({state:"hidden"});
      const after=await page.evaluate(()=>teamSelector.state().objects);assert.equal(after[0].evaluationOverrides.jump.standard.target,40);assert.deepEqual(after.map(({evaluationOverrides,...object})=>object),before);assert.equal(await page.evaluate(()=>teamSelector.showConflicts([{referenceId:"removed-team",metricKey:"jump",candidates:[]}])),false);assert.equal(await page.locator('dialog[open]').count(),0);
    });
    await check("personal steps retain selection and offer an independent name even for a single record",async()=>{
      await page.evaluate(()=>{teamSelector.cancel();window.personalSelector=RingsideReportSelection.create({...fixtureHost,current:()=>({athleteId:"a",recordId:"a-old",evaluationProfileId:"",views:{reportTitle:"已有报告名"}})});personalSelector.begin({intent:"edit",step:2});});
      assert.equal(await page.locator('[data-selection-panel="athletes"]').isVisible(),true);assert.equal(await page.locator('.selection-row').isVisible(),false);await page.evaluate(()=>personalSelector.setStep(3));assert.equal(await page.locator('[data-select-record="a-old"]').isChecked(),true);
      await page.evaluate(()=>personalSelector.setStep(4));assert.equal(await page.locator('[data-report-title]').inputValue(),"已有报告名");assert.equal(await page.locator("[data-profile]").count(),0);await page.locator('[data-report-title]').fill("个人新报告名");await page.locator('[data-report-title]').blur();assert.equal(await page.evaluate(()=>personalSelector.validateStep(4).valid),true);assert.equal(await page.evaluate(()=>personalSelector.state().reportTitle),"个人新报告名");
      for(const width of[1440,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'review-'+width+'.png')});}
    });
    assert.deepEqual(result.errors,[]);for(const [file,value] of Object.entries(result.sources))assert.equal(hash(path.join(root,file)),value);assert.equal(hash(__filename),result.runnerSha256);result.sourceUnchanged=true;result.pass=true;
  }catch(error){result.failure=error.stack||String(error);console.error(result.failure);if(page)await page.screenshot({path:path.join(out,"failure.png"),fullPage:true}).catch(()=>{});process.exitCode=1;}finally{fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));await browser?.close();}
}
main();
