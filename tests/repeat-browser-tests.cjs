"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {pathToFileURL}=require("node:url"),{createHash}=require("node:crypto");
const {chromium}=require("./helpers/playwright.cjs");
const {artifactDirectory,ready,showReport,downloadFromReport,emptyRecord}=require("./helpers/pdf-browser.cjs");
const root=path.resolve(__dirname,".."),out=artifactDirectory(root,"output/pdf/v2.17.2-work/repeat-fixture"),source=path.join(root,"MotionBench.html");
fs.mkdirSync(out,{recursive:true});
const digest=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const result={sourceHash:digest(source),checks:[],errors:[],network:[],images:[],layouts:[],downloads:[],pass:false};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let browser,page;
async function check(name,fn){await fn();result.checks.push(name);console.log("PASS "+name);}
async function sidebar(){await page.waitForTimeout(250);if(await page.locator("#sidebar").evaluate(el=>el.inert || el.getBoundingClientRect().right<=0)){await page.locator("#sidebarToggle").click();await page.waitForTimeout(250);}}
async function entry(id){await page.evaluate(id=>App.openEntry(id),id);await page.locator(`#entryNav [data-entry-tab="${id}"]`).waitFor({state:"visible"});}
async function set(p,v){const el=page.locator(`[data-path="${p}"]`);await el.fill(String(v));await el.press("Tab");}
async function report(){await showReport(page);}
async function photo(label){const p=path.join(out,label+".png");await page.screenshot({path:p});result.images.push({path:path.relative(root,p),sha256:digest(p)});}
async function manage(){await page.evaluate(()=>App.openManagement("metrics"));}
async function saveCatalog(){await page.locator('#catalogForm [type="submit"]').click();await page.locator('#catalogModal').waitFor({state:"hidden"});}
(async()=>{
 browser=await chromium.launch({channel:"chrome",headless:true});const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},locale:"zh-CN",timezoneId:"Asia/Shanghai",acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(15000);
 page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});page.on("dialog",d=>d.accept());
 try{
  await page.goto(pathToFileURL(source).href);await ready(page);
  await page.evaluate(()=>App.importPayload(RingsideModel.libraryDefaults(),"replace-library"));
  result.setupRecord=await emptyRecord(page,"repeat-setup-synthetic");
  let projectId,metrics;
  await check("create custom multi-metric test through catalog",async()=>{
   await manage();await page.locator('.management-heading [data-manager-action="new-test"]').click();
   const ability=await page.evaluate(()=>RingsideTests.describe(App.getLibrary().catalog).find(t=>t.id==="mss").primaryAbility);
   await page.locator("#catalogTestName").fill("重复测量核验");await page.locator("#catalogMetricName").fill("用时");await page.locator("#catalogUnit").fill("s");await page.locator("#catalogAbility").selectOption(ability);await page.locator("#catalogPrimaryAbility").selectOption(ability);await page.locator("#catalogCVEligible").check();
   assert.equal(await page.locator("#catalogEntryScope").inputValue(),"attempt");await saveCatalog();
   projectId=await page.evaluate(()=>App.getLibrary().catalog.tests.find(t=>t.name==="重复测量核验").id);
   await page.locator(`[data-manager-action="new-metric"][data-id="${projectId}"]`).click();
   await page.locator("#catalogMetricName").fill("配套力量");await page.locator("#catalogUnit").fill("N");await page.locator("#catalogAbility").selectOption(ability);await page.locator("#catalogCVEligible").check();assert.equal(await page.locator("#catalogEntryScope").inputValue(),"attempt");await saveCatalog();
   metrics=await page.evaluate(id=>App.getLibrary().catalog.definitions.filter(d=>d.testId===id),projectId);assert.equal(metrics.length,2);
   await page.locator('#metricEvaluationProfile').selectOption(await page.evaluate(()=>App.getLibrary().defaultEvaluationProfileId));
   await page.locator(`[data-manager-action="standard-edit"][data-id="${metrics[0].id}"]`).click();
   await page.locator('[data-profile-path$=".direction"]').selectOption("lower");await page.locator('[data-manager-action="profile-review"]').click();await page.locator('#managementForm [type="submit"]').click();await page.locator('#managementModal').waitFor({state:"hidden"});
  });
  await check("create athlete and choose repeat-enabled projects",async()=>{
   await page.evaluate(()=>App.startDataEntry());await page.locator('[name="creationAthleteMode"][value="new"]').check();await page.locator("#newAthleteName").fill("重复测量验收");await page.locator("#creationNext").click();
   for(const id of [projectId,"iso","cmj","sj","imtp","bench","landmine","mb","pushup","mas","mss","ift","fms","lactate"])await page.locator(`#creationProjects [data-creation-project="${id}"]`).check();
   const paired=await page.evaluate(()=>RingsideModel.isoRows().find(row=>row.paired).id);await page.locator(`[data-picker-iso="${paired}"]`).check();
   await page.locator("#creationSubmit").click();await page.waitForFunction(()=>App.getUIState().mode==="entry");await entry(projectId);
  });
  await check("enter repeated custom values and select one best attempt",async()=>{
   for(let i=0;i<3;i++){if(i)await page.locator(".repeat-entry").getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set(`data.${projectId}.${i}.metrics.${metrics[0].id}`,[12,10,10][i]);await set(`data.${projectId}.${i}.metrics.${metrics[1].id}`,[100,80,120][i]);}
   const values=await page.evaluate(()=>App.stats().values);near(values[metrics[0].id],10);near(values[metrics[1].id],80);
   await report();assert.equal(await page.locator(`#detail-${projectId} [data-repeat-stat]`).count(),2);assert.equal(await page.locator(`#trials-${projectId}`).getAttribute("open"),null);
   const stats=await page.locator(`#detail-${projectId} .repeat-stat-value`).allTextContents();await page.locator("#aggMode").selectOption("mean");assert.deepEqual(await page.locator(`#detail-${projectId} .repeat-stat-value`).allTextContents(),stats);near(await page.evaluate(id=>App.stats().values[id],metrics[1].id),100);
   assert.equal(await page.evaluate(()=>App.saveNow()),true);await page.reload();await ready(page);near(await page.evaluate(id=>App.stats().values[id],metrics[1].id),100);
  });
  await check("nested invalid drafts survive deletion, undo and reload",async()=>{
   await entry("pushup");await set("data.pushup.reps",10);await page.locator("#entryContent").getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set("data.pushup.trials.1.reps",1.5);
   await page.locator('.repeat-entry button[onclick*="removeRepeat(\'pushup\',0,"]').click();
   assert.equal(await page.locator('[data-path="data.pushup.trials.0.reps"]').inputValue(),"1.5");
   await page.locator('[onclick="App.undoDelete()"]').click();assert.equal(await page.locator('[data-path="data.pushup.trials.1.reps"]').inputValue(),"1.5");
   await page.reload();await ready(page);await entry("pushup");assert.equal(await page.locator('[data-path="data.pushup.trials.1.reps"]').inputValue(),"1.5");
   await set("data.pushup.trials.1.reps",11);await page.locator(".repeat-entry").getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set("data.pushup.trials.2.reps",13);near(await page.evaluate(()=>App.stats().values.pushup_reps),34/3);
  });
  await check("isometric trials, pain and all-trial unit conversion",async()=>{
   await entry("iso");const index=await page.evaluate(()=>App.getState().data.iso.findIndex(r=>r.paired));
   await set(`data.iso.${index}.left`,100);await set(`data.iso.${index}.right`,130);
   await page.locator(`[aria-label][onclick="App.addRepeat('iso',${index})"]`).click();
   for(let i=1;i<3;i++){if(i===2)await page.locator(`[aria-label][onclick="App.addRepeat('iso',${index})"]`).click();await set(`data.iso.${index}.trials.${i}.left`,100+i*10);await set(`data.iso.${index}.trials.${i}.right`,130-i*10);}
   await page.locator(`[data-path="data.iso.${index}.trials.0.painLeft"]`).check();
   await page.locator(`[data-path="data.iso.${index}.unit"]`).selectOption("kgf");await page.locator("#unitConvertButton").click();
   near(await page.evaluate(i=>App.getState().data.iso[i].trials[2].left,index),120/9.80665);
   assert.ok(await page.evaluate(i=>App.stats().isoAnalyses.find(row=>row.id===App.getState().data.iso[i].id).sides[0].pain,index));
  });
  await check("LVP same-load addition and regression point count",async()=>{
   await entry("bench");await set("data.bench.0.load",40);await set("data.bench.0.velocity",.8);
   for(let i=1;i<3;i++){await page.locator('[onclick="App.addRow(\'bench\',0)"]').click();await set(`data.bench.${i}.velocity`,.8+i*.1);}
   await page.getByRole("button",{name:"＋ 新增负荷",exact:true}).click();await set("data.bench.3.load",60);await set("data.bench.3.velocity",.6);
   await page.getByRole("button",{name:"＋ 新增负荷",exact:true}).click();await set("data.bench.4.load",80);await set("data.bench.4.velocity",.4);
   const points=await page.evaluate(()=>App.stats().lvpSeries.find(x=>x.id==="bench").points);assert.equal(points.length,3);near(points[0].velocity,.9);
  });
  await check("jumps retain fixed plot height when raw details expand",async()=>{
   await entry("cmj");for(let i=0;i<3;i++){if(i)await page.getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set(`data.cmj.${i}.height`,38+i*2);}
   await report();assert.match(await page.locator('#detail-cmj [data-repeat-stat="cmj_height"]').innerText(),/40\.00 ± 2\.00/);
   const before=await page.locator("#detail-cmj .chart-wrap").boundingBox();
   await page.locator("#trials-cmj summary").click();assert.ok(await page.locator("#trials-cmj").getAttribute("open")!==null);
   near((await page.locator("#detail-cmj .chart-wrap").boundingBox()).height,before.height);await page.locator("#trials-cmj summary").click();
  });
  await check("catalog primary metric and conversion preserve every attempt via public API and legacy configuration renderer",async()=>{
   await manage();await page.locator(`[data-manager-action="catalog-edit"][data-id="${projectId}"]`).click();await page.locator("#catalogPrimaryMetric").selectOption(metrics[1].id);await saveCatalog();
   // Existing records keep their snapshots. This compatibility API and renderer
   // remain covered without claiming their old configuration entry is visible.
   await page.evaluate(id=>App.applyCatalogProject(id),projectId);await report();await page.locator("#aggMode").selectOption("best");
   near(await page.evaluate(id=>App.stats().values[id],metrics[1].id),120);assert.equal(await page.evaluate(id=>App.getState().projectSnapshots.find(t=>t.id===id).primaryMetricId,projectId),metrics[1].id);
   const before=await page.evaluate(id=>App.stats().repetitions.find(g=>g.testId===id).statistics[1].cv,projectId);
   await page.evaluate(id=>{App.openSettings("ai");App.settings("definitions");App.selectDef(id);},metrics[1].id);
   const unit=page.locator(`[data-metric-unit="${metrics[1].id}"]`);await unit.fill("kgf");await unit.press("Tab");await page.locator("#unitConvertButton").click();
   near(await page.evaluate(({p,m})=>App.getState().data[p][2].metrics[m],{p:projectId,m:metrics[1].id}),120/9.80665);
   near(await page.evaluate(id=>App.stats().repetitions.find(g=>g.testId===id).statistics[1].cv,projectId),before);await page.evaluate(()=>App.close("settingsModal"));await report();await page.locator("#aggMode").selectOption("mean");result.legacyConfigurationRenderer=true;
  });
  await check("optional MAS MSS and IFT trials share their parent protocol",async()=>{
   for(const id of ["mas","mss","ift"]){await entry(id);const base=id==="mss"?8:5;await set(`data.${id}.speed`,base);await page.getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set(`data.${id}.trials.1.speed`,base+.5);await page.getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set(`data.${id}.trials.2.speed`,base+1);
    near(await page.evaluate(t=>App.stats().repetitions.find(g=>g.testId===t).statistics[0].mean,id),base+.5);
   }await report();
  });
  await check("mobile trial editing and expanded raw records retain labeled fields",async()=>{
   await page.setViewportSize({width:390,height:1000});await entry(projectId);await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await photo("mobile-custom-entry");await report();
   await page.locator(`#trials-${projectId} summary`).click();await page.locator(`#trials-${projectId}`).scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await photo("mobile-custom-raw");await page.locator(`#trials-${projectId} summary`).click();
  });
  await check("responsive report and raw tables",async()=>{
   await page.waitForTimeout(3100);
   for(const width of [1920,1440,1280,900,390]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));result.layouts.push({width,noOverflow:true});
    if([1440,390].includes(width))for(const selector of ["#detail-cmj","#detail-iso","#lvp-upper",`#detail-${projectId}`]){await page.locator(selector).evaluate(n=>window.scrollTo({top:n.getBoundingClientRect().top+scrollY-90,behavior:"instant"}));await page.waitForTimeout(80);await photo(selector.slice(1)+"-"+width);}
   }
  });
  await check("download JSON and editable HTML, then restore in isolation",async()=>{
   await page.setViewportSize({width:1440,height:1000});
   assert.equal(await page.evaluate(()=>App.saveNow()),true);await report();result.recordId=await page.evaluate(()=>App.getState().recordId);
   for(const [action,name] of [["downloadJSON","record.json"],["downloadHTML","record.html"]]){
    const dl=await downloadFromReport(page,action),p=path.join(out,name);await dl.saveAs(p);result.downloads.push({path:path.relative(root,p),sha256:digest(p)});
   }
   for(const filename of ["record.html","record.json"]){
    const restored=await browser.newContext({offline:true});const p=await restored.newPage();p.on("pageerror",e=>result.errors.push(e.message));await p.goto(pathToFileURL(filename.endsWith("html")?path.join(out,filename):source).href);await ready(p);
    if(filename.endsWith("json")){await p.evaluate(()=>App.openManagement("backup"));await p.locator("#importFile").setInputFiles(path.join(out,filename));await p.waitForFunction(id=>App.getState()?.recordId===id,result.recordId);}
    near(await p.evaluate(()=>App.stats().values.pushup_reps),34/3);assert.equal(await p.evaluate(id=>App.getState().data[id].length,projectId),3);assert.equal(await p.evaluate(()=>RingsideModel.validateRecord(App.getState())),true);await restored.close();
   }
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
 }catch(e){result.failure=e.stack;console.error(e.stack);process.exitCode=1;await photo("failure").catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,"review.json"),JSON.stringify(result,null,2));await browser.close();}
})();
