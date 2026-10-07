"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {pathToFileURL}=require("node:url"),{createHash}=require("node:crypto");
const {chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/playwright/repeats"),source=path.join(root,"Ringside_Boxing_Assessment.html");
fs.mkdirSync(out,{recursive:true});
const digest=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const result={sourceHash:digest(source),checks:[],errors:[],network:[],images:[],layouts:[],downloads:[],pass:false};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let browser,page;
async function check(name,fn){await fn();result.checks.push(name);console.log("PASS "+name);}
async function sidebar(){await page.waitForTimeout(250);if(await page.locator("#sidebar").evaluate(el=>el.inert || el.getBoundingClientRect().right<=0)){await page.locator("#sidebarToggle").click();await page.waitForTimeout(250);}}
async function entry(id){await sidebar();if(await page.locator("#editButton").isVisible())await page.locator("#editButton").click();await sidebar();await page.locator(`#entryNav button[onclick*="'${id}'"]`).click();}
async function set(p,v){const el=page.locator(`[data-path="${p}"]`);await el.fill(String(v));await el.press("Tab");}
async function report(){if(await page.locator("#workspaceBack").isVisible())await page.locator("#workspaceBack").click();await page.waitForTimeout(220);}
async function photo(label){const p=path.join(out,label+".png");await page.screenshot({path:p});result.images.push({path:path.relative(root,p),sha256:digest(p)});}
async function saveMenu(){await sidebar();await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();}
(async()=>{
 browser=await chromium.launch();const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},locale:"zh-CN",timezoneId:"Asia/Shanghai",acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(10000);
 page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});page.on("dialog",d=>d.accept());
 try{
  await page.goto(pathToFileURL(source).href);await page.waitForFunction(()=>window.App?.getState);
  let projectId,metrics;
  await check("create custom multi-metric test through catalog",async()=>{
   await page.locator('[data-settings-open="catalog"]').click();
   await page.locator("#settingsContent").getByRole("button",{name:/新增测试项目$/}).click();
   await page.locator("#catalogTestName").fill("重复测量核验");await page.locator("#catalogMetricName").fill("用时");await page.locator("#catalogUnit").fill("s");await page.locator("#catalogAbility").fill("速度");await page.locator("#catalogDirection").selectOption("lower");await page.locator("#catalogCVEligible").check();
   assert.equal(await page.locator("#catalogEntryScope").inputValue(),"attempt");await page.locator('#catalogForm button[type="submit"]').click();
   projectId=await page.evaluate(()=>App.getLibrary().catalog.tests.find(t=>t.name==="重复测量核验").id);
   await page.locator(`[data-catalog-test="${projectId}"]`).getByRole("button",{name:"新增指标",exact:true}).click();
   await page.locator("#catalogMetricName").fill("配套力量");await page.locator("#catalogUnit").fill("N");await page.locator("#catalogAbility").fill("速度");await page.locator("#catalogCVEligible").check();assert.equal(await page.locator("#catalogEntryScope").inputValue(),"attempt");await page.locator('#catalogForm button[type="submit"]').click();
   metrics=await page.evaluate(id=>App.getLibrary().catalog.definitions.filter(d=>d.testId===id),projectId);assert.equal(metrics.length,2);
  });
  await check("create athlete and choose repeat-enabled projects",async()=>{
   await page.locator('#sidebar button[onclick="App.openNewAthlete()"] ').click();await page.locator("#newAthleteName").fill("重复测量验收");await page.locator("#creationNext").click();
   for(const id of [projectId,"iso","cmj","sj","imtp","bench","landmine","mb","pushup","mas","mss","ift","fms","lactate"])await page.locator(`#creationProjects input[value="${id}"]`).check();
   await page.locator("#creationSubmit").click();await page.waitForFunction(()=>App.getUIState().mode==="entry");await entry(projectId);
  });
  await check("enter repeated custom values and select one best attempt",async()=>{
   for(let i=0;i<3;i++){if(i)await page.locator(".repeat-entry").getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set(`data.${projectId}.${i}.metrics.${metrics[0].id}`,[12,10,10][i]);await set(`data.${projectId}.${i}.metrics.${metrics[1].id}`,[100,80,120][i]);}
   const values=await page.evaluate(()=>App.stats().values);near(values[metrics[0].id],10);near(values[metrics[1].id],80);
   await report();assert.equal(await page.locator(`#detail-${projectId} [data-repeat-stat]`).count(),2);assert.equal(await page.locator(`#trials-${projectId}`).getAttribute("open"),null);
   const stats=await page.locator(`#detail-${projectId} .repeat-stat-value`).allTextContents();await page.locator("#aggMode").selectOption("mean");assert.deepEqual(await page.locator(`#detail-${projectId} .repeat-stat-value`).allTextContents(),stats);near(await page.evaluate(id=>App.stats().values[id],metrics[1].id),100);
   await page.reload();await page.waitForFunction(()=>window.App?.getState);near(await page.evaluate(id=>App.stats().values[id],metrics[1].id),100);
  });
  await check("nested invalid drafts survive deletion, undo and reload",async()=>{
   await entry("pushup");await set("data.pushup.reps",10);await page.locator("#entryContent").getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set("data.pushup.trials.1.reps",1.5);
   await page.locator('.repeat-entry button[onclick*="removeRepeat(\'pushup\',0,"]').click();
   assert.equal(await page.locator('[data-path="data.pushup.trials.0.reps"]').inputValue(),"1.5");
   await page.locator('[onclick="App.undoDelete()"]').click();assert.equal(await page.locator('[data-path="data.pushup.trials.1.reps"]').inputValue(),"1.5");
   await page.reload();await page.waitForFunction(()=>window.App?.getState);await entry("pushup");assert.equal(await page.locator('[data-path="data.pushup.trials.1.reps"]').inputValue(),"1.5");
   await set("data.pushup.trials.1.reps",11);await page.locator(".repeat-entry").getByRole("button",{name:"＋ 新增试次",exact:true}).click();await set("data.pushup.trials.2.reps",13);near(await page.evaluate(()=>App.stats().values.pushup_reps),34/3);
  });
  await check("isometric trials, pain and all-trial unit conversion",async()=>{
   await entry("iso");const index=await page.evaluate(()=>App.getState().data.iso.findIndex(r=>r.paired));
   await set(`data.iso.${index}.left`,100);await set(`data.iso.${index}.right`,130);
   await page.locator(`[onclick="App.addRepeat('iso',${index})"]`).click();
   for(let i=1;i<3;i++){if(i===2)await page.locator(`[onclick="App.addRepeat('iso',${index})"]`).click();await set(`data.iso.${index}.trials.${i}.left`,100+i*10);await set(`data.iso.${index}.trials.${i}.right`,130-i*10);}
   await page.locator(`[data-path="data.iso.${index}.trials.0.painLeft"]`).check();
   await page.locator(`[data-path="data.iso.${index}.unit"]`).selectOption("kgf");await page.locator("#unitConvertButton").click();
   near(await page.evaluate(i=>App.getState().data.iso[i].trials[2].left,index),120/9.80665);
   assert.ok(await page.evaluate(i=>App.stats().isoAnalyses[i].sides[0].pain,index));
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
  await check("catalog primary metric and conversion update every stored attempt",async()=>{
   await sidebar();await page.locator('[data-settings-open="catalog"]').click();
   const card=page.locator(`[data-catalog-test="${projectId}"]`);
   await card.getByRole("button",{name:"编辑项目",exact:true}).click();await page.locator("#catalogPrimaryMetric").selectOption(metrics[1].id);await page.locator('#catalogForm button[type="submit"]').click();
   await card.getByRole("button",{name:"更新本次定义",exact:true}).click();await report();await page.locator("#aggMode").selectOption("best");
   near(await page.evaluate(id=>App.stats().values[id],metrics[1].id),120);assert.equal(await page.evaluate(id=>App.getState().projectSnapshots.find(t=>t.id===id).primaryMetricId,projectId),metrics[1].id);
   const before=await page.evaluate(id=>App.stats().repetitions.find(g=>g.testId===id).statistics[1].cv,projectId);
   await sidebar();await page.locator('[data-settings-open="record"]').click();await page.locator("#settingsTabs button[onclick*=\"'definitions'\"]").click();await page.locator('select[aria-label="本次评价指标"]').selectOption(metrics[1].id);
   const unit=page.locator(`[data-metric-unit="${metrics[1].id}"]`);await unit.fill("kgf");await unit.press("Tab");await page.locator("#unitConvertButton").click();
   near(await page.evaluate(({p,m})=>App.getState().data[p][2].metrics[m],{p:projectId,m:metrics[1].id}),120/9.80665);
   near(await page.evaluate(id=>App.stats().repetitions.find(g=>g.testId===id).statistics[1].cv,projectId),before);await report();await page.locator("#aggMode").selectOption("mean");
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
   for(const [label,name] of [["导出当前报告 JSON","record.json"],["保存当前可编辑 HTML 报告","record.html"]]){
    await saveMenu();const wait=page.waitForEvent("download");await page.locator("#saveModal").getByRole("button",{name:label,exact:true}).click();const dl=await wait,p=path.join(out,name);await dl.saveAs(p);result.downloads.push({path:path.relative(root,p),sha256:digest(p)});
    if(await page.locator("#saveModal").isVisible())await page.locator("#saveModal").getByRole("button",{name:"关闭保存",exact:true}).click();
   }
   for(const filename of ["record.html","record.json"]){
    const restored=await browser.newContext({offline:true});const p=await restored.newPage();await p.goto(pathToFileURL(filename.endsWith("html")?path.join(out,filename):source).href);await p.waitForFunction(()=>window.App?.getState);
    if(filename.endsWith("json")){await p.locator('#sidebar button[onclick="App.saveMenu()"] ').click();await p.locator("#importFile").setInputFiles(path.join(out,filename));await p.waitForFunction(()=>App.getState().athlete.name==="重复测量验收");}
    near(await p.evaluate(()=>App.stats().values.pushup_reps),34/3);assert.equal(await p.evaluate(id=>App.getState().data[id].length,projectId),3);assert.equal(await p.evaluate(()=>RingsideModel.validateRecord(App.getState())),true);await restored.close();
   }
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
 }catch(e){result.failure=e.stack;console.error(e.stack);process.exitCode=1;await photo("failure").catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,"review.json"),JSON.stringify(result,null,2));await browser.close();}
})();
