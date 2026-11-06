"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),root=path.resolve(__dirname,".."),arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const channel=process.argv.includes("--edge")?"msedge":"chrome",source=path.resolve(arg("--source",path.join(root,"MotionBench.html"))),out=path.resolve(arg("--artifact-dir",path.join(root,"output/release/2.29.1-local/acceptance/step-navigation-"+channel))),hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fixture(){
  const M=RingsideModel,record=M.defaults();Object.assign(record,{athleteId:"step-a",recordId:"step-a-old",demo:false});Object.assign(record.athlete,{name:"步骤合成甲",date:"2026-11-01",sex:"男",mass:70});Object.keys(record.enabled).forEach(id=>record.enabled[id]=id==="cmj");record.data.cmj=[{id:"jump-1",height:20,rsiModified:.5}];
  const lib=RingsideEvaluation.migrate(M.recordEnvelope(record)),other=JSON.parse(JSON.stringify(lib.athletes[0]));other.id="step-b";other.name=other.profile.name="步骤合成乙";other.records[0].athleteId=other.id;other.records[0].recordId="step-b-old";other.records[0].athlete.name=other.name;lib.athletes.push(other);return lib;
}
async function main(){
  fs.mkdirSync(out,{recursive:true});const isolated=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-step-navigation-")),"MotionBench.html");fs.copyFileSync(source,isolated);
  const result={synthetic:true,isolated:true,channel,sourceHash:hash(source),runnerSha256:hash(__filename),checks:[],errors:[],pass:false},browser=await chromium.launch({channel,headless:true});
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}}),page=await context.newPage();page.on("pageerror",error=>result.errors.push(error.stack||error.message));
  const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS "+name);};
  try{
    await page.goto(pathToFileURL(isolated).href);await page.waitForFunction(()=>window.App?.ready);await page.evaluate(async factory=>{await App.importPayload((0,eval)("("+factory+")")(),"replace-library");await App.showReport(false);},fixture.toString());
    await page.locator('[data-workspace-nav="entry"]').click();
    await check("Entry headings enforce existing athlete and project validation without creating records",async()=>{
      await page.locator('#creationSteps [data-entry-step="4"]').click();assert.equal(await page.locator("#creationSelectStep").isVisible(),true);assert.match(await page.locator("#creationError").innerText(),/请选择/);
      await page.locator('[data-creation-athlete="step-a"]').check();await page.locator('[data-creation-athlete="step-b"]').check();await page.locator('#creationSteps [data-entry-step="2"]').click();
      for(const input of await page.locator('#creationProjects input[type="checkbox"]:checked').all())await input.uncheck();
      await page.locator('#creationSteps [data-entry-step="3"]').click();assert.equal(await page.locator("#creationTestStep").isVisible(),true);assert.match(await page.locator("#creationError").innerText(),/至少选择/);
      assert.equal(await page.evaluate(()=>App.getLibrary().athletes.reduce((n,a)=>n+a.records.length,0)),2);
    });
    await check("Entry headings reuse back and start actions while retaining the current setup",async()=>{
      await page.locator('#creationProjects input[value="cmj"]').check();await page.locator("#creationDate").fill("2026-11-06");await page.locator("#creationDate").blur();
      await page.locator('#creationSteps [data-entry-step="1"]').click();assert.equal(await page.locator('#creationAthletes input:checked').count(),2);
      await page.locator('#creationSteps [data-entry-step="2"]').click();assert.equal(await page.locator("#creationDate").inputValue(),"2026-11-06");assert.equal(await page.locator('#creationProjects input[value="cmj"]').isChecked(),true);
      await page.locator('#creationSteps [data-entry-step="3"]').click();await page.waitForFunction(()=>App.getUIState().mode==="entry");assert.equal(await page.locator('#entrySteps [aria-current="step"]').getAttribute("data-entry-step"),"3");
    });
    await check("Entry heading jumps retain each athlete's measurements and never change the roster",async()=>{
      const first=await page.evaluate(()=>App.getState().recordId),options=await page.locator("#entryAthleteSelect option").evaluateAll(nodes=>nodes.map(node=>node.value));assert.equal(options.length,2);
      const height=page.locator('#entryContent input[data-path^="data.cmj."][data-path$=".height"]').first();await height.fill("35");await height.blur();
      await page.locator('#entrySteps [data-entry-step="4"]').click();await page.waitForFunction(()=>App.getUIState().entryTab==="review");
      await page.locator('#entrySteps [data-entry-step="1"]').click();assert.equal(await page.evaluate(()=>App.getUIState().entryTab),"athlete");assert.equal(await page.locator("#entryAthleteSelect").inputValue(),first);
      await page.locator("#entryAthleteSelect").selectOption(options.find(id=>id!==first));await page.locator('#entrySteps [data-entry-step="3"]').click();await height.fill("41");await height.blur();
      await page.locator('#entrySteps [data-entry-step="2"]').click();assert.equal(await page.evaluate(()=>App.getUIState().entryTab),"plan");
      await page.locator('#entrySteps [data-entry-step="1"]').click();await page.locator("#entryAthleteSelect").selectOption(first);await page.locator('#entrySteps [data-entry-step="3"]').click();assert.equal(await height.inputValue(),"35");
      assert.deepEqual(await page.locator("#entryAthleteSelect option").evaluateAll(nodes=>nodes.map(node=>node.value)),options);
      await page.setViewportSize({width:800,height:900});await page.screenshot({path:path.join(out,"entry-steps-narrow.png")});assert.equal(await page.locator("#entrySteps").evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.setViewportSize({width:1440,height:1000});
    });
    await check("Report headings navigate draft configuration with keyboard access and never submit on review",async()=>{
      await page.locator('[data-workspace-nav="reports"]').click();await page.waitForFunction(()=>App.getReportSetup()?.step===1);
      await page.locator('#reportSetupSteps [data-report-step="4"]').click();assert.equal(await page.evaluate(()=>App.getReportSetup().step),4);assert.equal(await page.locator("#reportSetupView").isVisible(),true);
      const original=await page.locator('#reportSelection [data-report-title]').inputValue();await page.locator('#reportSelection [data-report-title]').fill("步骤导航报告标题");await page.locator('#reportSelection [data-report-title]').blur();
      await page.locator('#reportSetupSteps [data-report-step="2"]').click();const review=page.locator('#reportSetupSteps [data-report-step="4"]');await review.focus();await page.keyboard.press("Enter");assert.equal(await page.locator('#reportSelection [data-report-title]').inputValue(),"步骤导航报告标题");
      await page.locator('#reportSetupView button[onclick="App.cancelReportSetup()"]').click();assert.equal(await page.locator("#reportTitle").innerText(),original);assert.equal(await page.locator("#reportSetupView").isVisible(),false);
    });
    assert.deepEqual(result.errors,[]);assert.equal(hash(source),result.sourceHash);result.sourceUnchanged=true;result.pass=true;
  }catch(error){result.failure=error.stack||String(error);await page.screenshot({path:path.join(out,"failure.png"),fullPage:true}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
