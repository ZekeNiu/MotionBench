"use strict";
// Actual offline browser workflows and downloads, isolated synthetic data only.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome";
const opt=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const source=path.resolve(root,opt("--source","MotionBench.html"));
const out=path.resolve(root,opt("--artifact-dir","output/playwright/dual-elasticity-2.18.0/final"));
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fixtureFile=path.join(__dirname,"fixtures/three-fvp-regions.json"),fixture=JSON.parse(fs.readFileSync(fixtureFile));
assert.equal(fixture.synthetic,true);fs.mkdirSync(out,{recursive:true});
const result={channel,synthetic:true,sourceSha256:hash(source),runnerSha256:hash(__filename),fixtureSha256:hash(fixtureFile),startedAt:new Date().toISOString(),checks:[],failures:[],errors:[],network:[],layouts:[],pdfs:[],artifacts:[]};
const artifact=(file,kind)=>result.artifacts.push({path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file),bytes:fs.statSync(file).size,kind});
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),contexts=[];
 const newPage=async file=>{const c=await browser.newContext({offline:true,acceptDownloads:true,reducedMotion:"reduce",viewport:{width:1440,height:1000}});contexts.push(c);const p=await c.newPage();p.setDefaultTimeout(20000);p.on("pageerror",e=>result.errors.push(e.message));p.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});p.on("dialog",d=>d.accept());await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>!!window.App?.ready);assert.equal(await p.evaluate(()=>App.ready),true);return p;};
 let page;
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS",name);};
 const load=async options=>{
   await page.evaluate(async({fixture,options})=>{
     const payload=structuredClone(fixture.library),r=payload.athletes[0].records[0],s=fixture.currentSprint;
     r.sprintFvpVersion=s.sprintFvpVersion;r.enabled.sprint_fvp=s.enabled;r.data.sprint_fvp=s.data;r.sprintFvpConfig=s.config;r.sprintFvpAnalysis=s.analysis;
     r.views.fvpProtocol=options?.protocol || "fvp_sj";
     if(options?.invalidCmj)r.data.fvp_cmj=[{...r.data.fvp_cmj[0],height:""}];
     if(options?.rawInvalid)r.data.fvp_sj.push({...r.data.fvp_sj[0],id:"raw-zero-distance",distanceCm:0,notes:"EXPLICIT ZERO DISTANCE"});
     await App.importPayload(payload,"replace-library");await App.showReport(false);
   },{fixture,options});
 };
 const current=()=>page.evaluate(()=>App.getState());
 const save=async()=>assert.equal(await page.evaluate(()=>App.saveNow()),true);
 const jump=key=>page.locator(`[data-fvp-scenario="${key}"]`),sprint=key=>page.locator(`[data-sprint-scenario="${key}"]`);
 const download=async(name,action)=>{const pending=page.waitForEvent("download",{timeout:240000});await action();const dl=await pending;assert.equal(await dl.failure(),null);const file=path.join(out,channel+"-"+name);await dl.saveAs(file);artifact(file,"download");return file;};
 const fields=r=>({fvpAnalysis:r.fvpAnalysis,sprintFvpAnalysis:r.sprintFvpAnalysis,fvpView:r.fvpView,sprintFvpView:r.sprintFvpView,capabilityExpanded:r.views.capabilityExpanded,capabilitySelections:r.views.capabilitySelections,protocol:r.views.fvpProtocol});
 try {
  page=await newPage(source);await load();
  await check("four cards own independent folded parameters and graphs follow approved order",async()=>{
    assert.equal(await page.locator("#trainingAnalysisDetail").count(),0);
    assert.deepEqual(await page.locator("[data-capability-parameters]").evaluateAll(nodes=>nodes.map(n=>[n.dataset.capabilityParameters,n.open])),[["strength",false],["reactive",false],["speed",false],["endurance",false]]);
    const kinds=await page.locator("[data-capability-region] [data-chart-kind]").evaluateAll(nodes=>nodes.map(n=>n.dataset.chartKind));
    assert.deepEqual(kinds,["jumpFvp","jumpElasticity","sprintFvp","sprintElasticity"]);
    await page.locator('[data-capability-parameters="strength"] > summary').click();
    assert.equal((await current()).views.capabilityExpanded.strength,true);
    assert.equal(await page.locator('[data-capability-parameters="speed"]').evaluate(n=>n.open),false);
  });
  await check("elasticity bases update card summaries and keep all category parameters",async()=>{
    const raw=await page.locator('[data-capability-parameters="strength"]').textContent();
    await page.locator('[data-capability-selection="strength"]').selectOption("jump_elasticity");
    await page.locator('[data-capability-selection="speed"]').selectOption("sprint_elasticity");
    assert.equal(await page.locator('[data-capability-parameters="strength"]').textContent(),raw);
    const facts=await page.evaluate(()=>App.facts());assert.ok(facts.sprintFVPElasticity.valid);
    assert.ok(facts.selectedCapabilityDirections.some(d=>d.metricId==="jump_elasticity"));
  });
  await check("jump autosave preserves controls and the next click changes curve on first attempt",async()=>{
    await page.evaluate(()=>{window.__clickTrace=[];for(const type of ["pointerdown","mousedown","focusout","click","change"])document.addEventListener(type,e=>{if(e.target.closest("[data-fvp-elasticity]"))__clickTrace.push({type,tag:e.target.tagName,view:e.target.dataset.fvpView,scenario:e.target.dataset.fvpScenario,checked:e.target.checked,connected:e.target.isConnected,force:App.getState().fvpAnalysis.fvp_sj.deltaForcePct});},true);});
    await jump("deltaForcePct").evaluate(n=>{window.__fieldNode=n;});
    await jump("deltaForcePct").fill("7");
    await page.locator('[data-fvp-view="responseForce"]').uncheck();
    const r=await current();assert.equal(r.fvpAnalysis.fvp_sj.deltaForcePct,7);assert.equal(r.fvpView.fvp_sj.responseForce,false);
    assert.equal(await jump("deltaForcePct").evaluate(n=>n===window.__fieldNode),true);
    await jump("deltaVelocityPct").fill("3");await jump("deltaVelocityPct").press("Enter");assert.equal((await current()).fvpAnalysis.fvp_sj.deltaVelocityPct,3);
  });
  await check("sprint scenario and target autosave including zero and empty follow distance",async()=>{
    await sprint("deltaForcePct").fill("5");await sprint("deltaForcePct").press("Enter");
    await sprint("deltaVelocityPct").fill("-3");await sprint("deltaVelocityPct").press("Tab");
    const target=page.locator("[data-sprint-target-distance]");await target.fill("15");await target.press("Enter");
    let r=await current();assert.equal(r.sprintFvpAnalysis.targetDistanceM,15);assert.equal(r.sprintFvpAnalysis.deltaForcePct,5);assert.equal(r.sprintFvpAnalysis.deltaVelocityPct,-3);
    await sprint("deltaForcePct").fill("0");await sprint("deltaForcePct").press("Enter");
    await target.fill("");await target.press("Enter");r=await current();assert.equal(r.sprintFvpAnalysis.targetDistanceM,"");assert.equal(r.sprintFvpAnalysis.deltaForcePct,0);
    assert.equal(await page.evaluate(()=>App.stats().sprintElasticity.targetDistanceM),fixture.currentSprint.data[0].splits.at(-1).distanceM);
  });
  await check("empty scenario stays an isolated draft across view and protocol switches and blocks export",async()=>{
    const before=await current(),previous=before.fvpAnalysis.fvp_sj.deltaForcePct;await jump("deltaForcePct").fill("");await jump("deltaForcePct").press("Tab");
    assert.equal(await jump("deltaForcePct").getAttribute("aria-invalid"),"true");assert.equal((await current()).fvpAnalysis.fvp_sj.deltaForcePct,previous);
    await page.locator('[data-fvp-view="elasticityView"]').selectOption("constraint");assert.equal(await jump("deltaForcePct").inputValue(),"");
    await page.locator("[data-fvp-protocol]").selectOption("fvp_cmj");assert.equal(await jump("deltaForcePct").inputValue(),String(before.fvpAnalysis.fvp_cmj.deltaForcePct));
    await page.locator("[data-fvp-protocol]").selectOption("fvp_sj");assert.equal(await jump("deltaForcePct").inputValue(),"");
    await save();await page.reload();await page.waitForFunction(()=>!!window.App?.ready);assert.equal(await jump("deltaForcePct").inputValue(),"");assert.equal(await jump("deltaForcePct").getAttribute("aria-invalid"),"true");
    const exported=await page.evaluate(()=>{try{App.reportPayload();return {allowed:true};}catch(e){return {allowed:false,message:e.message};}});assert.equal(exported.allowed,false);
    assert.equal(await jump("deltaForcePct").evaluate(n=>document.activeElement===n),true);
    await jump("deltaForcePct").fill("0");await jump("deltaForcePct").press("Enter");
  });
  await check("illegal target and physical jump scenario keep previous valid settings",async()=>{
    const r=await current(),target=page.locator("[data-sprint-target-distance]");await target.fill("-2");await target.press("Enter");assert.equal(await target.getAttribute("aria-invalid"),"true");assert.equal((await current()).sprintFvpAnalysis.targetDistanceM,r.sprintFvpAnalysis.targetDistanceM);
    await target.fill("20");await target.press("Enter");
    await jump("deltaForcePct").fill("-99");await jump("deltaForcePct").press("Enter");assert.equal(await jump("deltaForcePct").getAttribute("aria-invalid"),"true");assert.equal((await current()).fvpAnalysis.fvp_sj.deltaForcePct,0);
    await jump("deltaForcePct").fill("6");await jump("deltaForcePct").press("Enter");
  });
  await check("both graph views and card expansion persist after refresh; display edits preserve AI basis",async()=>{
    const before=await page.evaluate(()=>App.recordBasis());
    await page.locator('[data-fvp-view="elasticityView"]').selectOption("constraint");await page.locator('[data-sprint-elasticity-view]').selectOption("distance");
    await page.locator('[data-capability-parameters="speed"] > summary').click();assert.equal(await page.evaluate(()=>App.recordBasis()),before);
    const expected=fields(await current());await save();await page.reload();await page.waitForFunction(()=>!!window.App?.ready);await page.evaluate(()=>App.showReport(false));
    assert.deepEqual(fields(await current()),expected);assert.equal(await page.locator('[data-capability-parameters="speed"]').evaluate(n=>n.open),true);
    assert.ok(await page.locator('[data-chart-kind="sprintElasticityDistance"] svg').count());
  });
  await check("visible valid edit is committed before JSON and HTML snapshot exports",async()=>{
    await sprint("deltaForcePct").fill("8");const jsonFile=await download("report.json",()=>page.evaluate(()=>App.downloadJSON()));
    const json=JSON.parse(fs.readFileSync(jsonFile));assert.equal(json.record.sprintFvpAnalysis.deltaForcePct,8);const expected=fields(await current());
    const html=await download("report.html",()=>page.evaluate(()=>App.downloadHTML())),other=await newPage(html);assert.deepEqual(fields(await other.evaluate(()=>App.getState())),expected);
    await page.evaluate(payload=>App.importPayload(payload),json);assert.deepEqual(fields(await current()),expected);
  });
  await check("JSONL backup and actual Excel bytes roundtrip new scientific and display fields",async()=>{
    const active=await current(),expected=fields(active);const backup=await download("backup.motionbench.jsonl",()=>page.evaluate(()=>App.downloadLibrary()));
    const restored=await newPage(source);await restored.evaluate(()=>App.openManagement("backup"));await restored.locator("#backupImportMode").selectOption("replace");await restored.locator("#importFile").setInputFiles(backup);
    await restored.waitForFunction(id=>App.getState()?.recordId===id,active.recordId);
    assert.deepEqual(fields(await restored.evaluate(()=>App.getState())),expected);await restored.close();
    const excel=await page.evaluate(async()=>{
      const r=structuredClone(App.getState()),{bytes}=await RingsideExcel.createTemplate({records:[r],prefill:true});const parsed=await RingsideExcel.readTemplate(bytes);
      const preview=RingsideExcel.preview(parsed,{athletes:App.getLibrary().athletes,catalog:App.getLibrary().catalog,records:[r]});
      if(parsed.errors.length || preview.errors.length)return{errors:parsed.errors,previewErrors:preview.errors};
      const imported=RingsideExcel.apply(preview,{[r.recordId]:{projects:Object.fromEntries(preview.entries[0].projects.map(p=>[p.id,"replace"])),settings:"replace",metadata:"replace"}});
      return {errors:parsed.errors,previewErrors:preview.errors,record:imported.records[0],bytes:Array.from(new Uint8Array(bytes))};
    });assert.deepEqual(excel.errors,[]);assert.deepEqual(excel.previewErrors,[]);assert.deepEqual(fields(excel.record),expected);
    const file=path.join(out,channel+"-settings.xlsx");fs.writeFileSync(file,Buffer.from(excel.bytes));artifact(file,"exceljs-roundtrip");
  });
  await check("save failure is visible, blocks downloads and allows retry",async()=>{
    await page.evaluate(()=>{const repo=App.getRepository();window.__originalSave=repo.save;repo.save=async()=>{throw Error("synthetic save failure");};});
    await sprint("deltaForcePct").fill("9");await sprint("deltaForcePct").press("Enter");assert.equal(await page.evaluate(()=>App.saveNow()),false);
    assert.match(await page.locator("#saveStatus").textContent(),/保存失败/);
    let downloaded=false;const track=()=>downloaded=true;page.on("download",track);await page.evaluate(()=>App.downloadJSON());await page.waitForTimeout(300);page.off("download",track);assert.equal(downloaded,false);
    await page.evaluate(()=>{App.getRepository().save=window.__originalSave;});await save();
  });
  await check("JSON and HTML exports freeze the saved click-time snapshot while later edits stay editable",async()=>{
    for(const kind of ["JSON","HTML"]){
      await sprint("deltaForcePct").fill("6");
      const pending=page.waitForEvent("download",{timeout:30000});
      await page.evaluate(kind=>{const repo=App.getRepository();window.__raceOriginal=repo.save;window.__raceCalls=0;window.__raceGate=new Promise(resolve=>window.__releaseRace=resolve);repo.save=async function(...args){if(++window.__raceCalls===1)await window.__raceGate;return window.__raceOriginal.apply(this,args);};window.__raceExport=App["download"+kind]();},kind);
      await page.waitForFunction(()=>window.__raceCalls===1);await sprint("deltaForcePct").fill("9");await page.evaluate(()=>window.__releaseRace());
      const dl=await pending,file=path.join(out,channel+"-race."+kind.toLowerCase().replace("json","json").replace("html","html"));await dl.saveAs(file);artifact(file,"concurrent-export");
      const payload=kind==="JSON"?JSON.parse(fs.readFileSync(file)):JSON.parse(fs.readFileSync(file,"utf8").match(/<script[^>]*id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
      assert.equal(payload.record.sprintFvpAnalysis.deltaForcePct,6);assert.equal(await sprint("deltaForcePct").inputValue(),"9");
      assert.equal(await page.evaluate(async()=>{const r=await App.getRepository().loadRecord(App.getState().recordId);return r.sprintFvpAnalysis.deltaForcePct;}),6);
      assert.equal(await page.evaluate(()=>window.__raceCalls),1);await page.evaluate(()=>{App.getRepository().save=window.__raceOriginal;});
      await sprint("deltaForcePct").press("Enter");await save();
    }
  });
  await check("unfinished report drafts are isolated across records and restored on return",async()=>{
    const first=await current(),second=await page.evaluate(id=>App.getLibrary().athletes.find(a=>a.id===App.getState().athleteId).records.find(r=>r.recordId!==id)?.recordId,first.recordId);assert.ok(second);
    await sprint("deltaForcePct").fill("");
    await page.evaluate(id=>App.selectRecord(id),second);assert.notEqual(await sprint("deltaForcePct").inputValue(),"");
    await page.evaluate(id=>App.selectRecord(id),first.recordId);assert.equal(await sprint("deltaForcePct").inputValue(),"");assert.equal(await sprint("deltaForcePct").getAttribute("aria-invalid"),"true");
    await sprint("deltaForcePct").fill(String(first.sprintFvpAnalysis.deltaForcePct));await sprint("deltaForcePct").press("Enter");await save();
  });
  await check("shared protocol fallback honors valid alternatives and explicit invalid selection",async()=>{
    await load({invalidCmj:true,protocol:"fvp_cmj"});assert.equal(await page.locator("[data-fvp-protocol]").inputValue(),"fvp_cmj");
    assert.equal(await page.evaluate(()=>RingsideModel.resolveJumpFvpProtocol(App.getState(),App.stats())),"fvp_cmj");
    await page.evaluate(()=>{App.getState().views.fvpProtocol="auto";App.renderReport();});assert.equal(await page.locator("[data-fvp-protocol]").inputValue(),"fvp_sj");
  });
  await check("explicit invalid raw push distance is shown without fallback replacement",async()=>{
    await load();await page.evaluate(()=>{const r=App.getState();r.data.fvp_sj.push({...r.data.fvp_sj[0],id:"raw-zero-distance",distanceCm:0,notes:"EXPLICIT ZERO DISTANCE"});App.renderReport();});
    const raw=page.locator('[data-raw-trials="fvp_sj"]');await raw.evaluate(n=>n.open=true);
    const row=raw.locator("tr").filter({hasText:"EXPLICIT ZERO DISTANCE"});assert.ok(await row.count());assert.equal(await row.locator('[data-label="蹬伸距离 cm"]').textContent(),"0.0");assert.match(await row.textContent(),/需要正推进距离/);
    await page.evaluate(()=>App.getState().data.fvp_sj.pop());await save();
  });
  await check("Chrome or Edge layouts at 1440 1280 900 390 have readable cards and graphs without overflow",async()=>{
    await load();for(const width of [1440,1280,900,390]){
      await page.setViewportSize({width,height:1000});await page.waitForTimeout(180);
      const layout=await page.evaluate(()=>{
        const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
        return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,cards:[...document.querySelectorAll("[data-capability-parameters]")].map(n=>box(n.closest("article"))),charts:[...document.querySelectorAll("[data-capability-region] [data-chart-kind]")].map(n=>({kind:n.dataset.chartKind,...box(n),svg:n.querySelector("svg")?.getAttribute("viewBox"),invalid:/NaN|Infinity/.test(n.innerHTML)}))};
      });assert.equal(layout.overflow,false);assert.equal(layout.charts.length,4);for(const chart of layout.charts){assert.ok(chart.width>200);assert.equal(chart.invalid,false);}
      if(width===390)assert.ok(Math.abs(layout.cards[0].x-layout.cards[1].x)<2);else assert.ok(layout.cards[1].x>layout.cards[0].x+100);
      result.layouts.push(layout);await page.locator("[data-capability-analysis]").evaluate(n=>scrollTo({top:scrollY+n.getBoundingClientRect().top-90,behavior:"instant"}));const file=path.join(out,`${channel}-${width}-cards.png`);await page.screenshot({path:file,animations:"disabled"});artifact(file,"viewport-screenshot");
      const full=path.join(out,`${channel}-${width}-cards-full.png`);await page.locator("[data-capability-analysis]").screenshot({path:full,animations:"disabled"});artifact(full,"full-cards-screenshot");
      for(const kind of ["jumpElasticity","sprintElasticity"]){await page.locator(`[data-chart-kind="${kind}"]`).scrollIntoViewIfNeeded();const f=path.join(out,`${channel}-${width}-${kind}.png`);await page.screenshot({path:f,animations:"disabled"});artifact(f,"viewport-screenshot");}
    }await page.setViewportSize({width:1440,height:1000});
  });
  if(process.argv.includes("--pdf")) {
    for(const scenario of [{name:"closed-response",open:[],jump:"response",sprint:"response"},{name:"partial-constraint",open:["strength","speed"],jump:"constraint",sprint:"distance"},{name:"all-response",open:["strength","reactive","speed","endurance"],jump:"response",sprint:"response"}]) {
      await check("actual PDF follows card expansion and selected graph views: "+scenario.name,async()=>{
        await load();for(const key of scenario.open)await page.locator(`[data-capability-parameters="${key}"] > summary`).click();
        await page.locator('[data-fvp-view="elasticityView"]').selectOption(scenario.jump);await page.locator('[data-sprint-elasticity-view]').selectOption(scenario.sprint);
        await page.evaluate(()=>{window.__pdfPages=[];window.__realCanvas=window.html2canvas;window.html2canvas=async(node,options)=>{const content=node.querySelector(".ringside-pdf-content"),box=content.getBoundingClientRect();window.__pdfPages.push({text:node.innerText,parameterKeys:[...node.querySelectorAll("[data-capability-parameter-table]")].map(n=>n.dataset.capabilityParameterTable),charts:[...node.querySelectorAll("[data-chart-kind]")].map(n=>({kind:n.dataset.chartKind,view:n.dataset.elasticityView,text:n.textContent,images:[...n.querySelectorAll("img[data-pdf-chart]")].map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight}))})),overflow:[...content.children].filter(n=>n.getBoundingClientRect().bottom>box.bottom+.7).map(n=>n.className)});return __realCanvas(node,options);};});
        const file=await download(scenario.name+".pdf",()=>page.evaluate(()=>App.downloadPDF()));
        const evidence=await page.evaluate(()=>({diagnostics:RingsidePDF.lastDiagnostics,pages:__pdfPages}));await page.evaluate(()=>window.html2canvas=__realCanvas);
        result.pdfs.push({scenario,file:path.relative(root,file),sha256:hash(file),...evidence});
        assert.equal(evidence.diagnostics.status,"complete");for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(evidence.diagnostics[key],[],key);
        assert.ok(evidence.pages.every(p=>!p.overflow.length));
        const parameters=[...new Set(evidence.pages.flatMap(p=>p.parameterKeys))].sort();assert.deepEqual(parameters,[...scenario.open].sort());
        const charts=evidence.pages.flatMap(p=>p.charts);for(const kind of ["jumpFvp","jumpElasticity","sprintFvp","sprintElasticity"])assert.ok(charts.some(c=>c.kind.startsWith(kind)));
        for(const chart of charts.filter(c=>/Elasticity|Fvp/.test(c.kind)))assert.ok(chart.images.every(i=>i.complete&&i.width>0&&i.height>0));
      });
    }
  }
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);
 }catch(e){result.failures.push({error:e.stack});console.error(e.stack);if(page){result.failureState=await page.evaluate(()=>({trace:window.__clickTrace,recordId:App.getState()?.recordId,fields:App.getState()?.fvpAnalysis,sprint:App.getState()?.sprintFvpAnalysis,view:App.getState()?.fvpView,drafts:sessionStorage.getItem("ringside-input-drafts-v1:"+location.pathname),save:document.getElementById("saveStatus")?.textContent})).catch(()=>null);const f=path.join(out,channel+"-failure.png");await page.screenshot({path:f}).catch(()=>{});if(fs.existsSync(f))artifact(f,"failure-screenshot");}}
 finally{result.sourceUnchanged=hash(source)===result.sourceSha256;result.finishedAt=new Date().toISOString();result.pass=!result.failures.length&&!result.errors.length&&!result.network.length&&result.sourceUnchanged;fs.writeFileSync(path.join(out,channel+"-results.json"),JSON.stringify(result,null,2));for(const c of contexts)await c.close();await browser.close();if(!result.pass)process.exitCode=1;}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
