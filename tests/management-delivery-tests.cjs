"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),{extensionFixture}=require("./helpers/core-fixtures.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/pdf");fs.mkdirSync(out,{recursive:true});
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),started:new Date().toISOString(),cases:[],pass:false};
const cases=[{id:"management-chrome-sample",channel:"chrome",width:1440},{id:"management-edge-sample",channel:"msedge",width:1440},{id:"management-mobile",channel:"chrome",width:390},{id:"management-extended",channel:"chrome",width:1440,extended:true},{id:"management-retry",channel:"chrome",width:1440,retry:true}];
(async()=>{
 for(const config of cases){
  const browser=await chromium.launch({channel:config.channel}),context=await browser.newContext({offline:true,viewport:{width:config.width,height:960},acceptDownloads:true,reducedMotion:"reduce"}),page=await context.newPage(),check={...config,pass:false,errors:[],network:[]};
  page.on("pageerror",e=>check.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))check.network.push(r.url());});
  try{
   await page.clock.setFixedTime(new Date("2026-10-07T08:00:00Z"));
   if(config.extended)await page.addInitScript(record=>localStorage.setItem("ringside-library-v2:"+location.pathname,JSON.stringify(record)),extensionFixture({pdf:true}));
   await page.goto(pathToFileURL(file).href);assert.equal(await page.evaluate(()=>App.ready),true);
   if(!config.extended)await page.evaluate(()=>App.importPayload(RingsideModel.recordEnvelope(RingsideModel.sampleRecord())));
   await page.evaluate(async()=>{const r=App.getState();r.athlete.name="管理中心导出验收（模拟）";const profile=App.getLibrary().evaluationProfiles.find(p=>p.id===r.evaluationProfileId);profile.name="报告验收共用方案";profile.criteria.definitions.find(d=>d.id==="cmj_height").target=80;await App.saveNow();await App.saveLibraryChanges();App.showReport();});
   assert.equal(await page.evaluate(()=>App.stats().values.cmj_height),await page.evaluate(()=>RingsideModel.stats(App.effectiveRecord()).values.cmj_height));
   await page.evaluate(()=>{const original=RingsideReport.layoutCharts;window.__printFigures=[];RingsideReport.layoutCharts=(container,opts)=>{original(container,opts);if(opts?.print)window.__printFigures=[...container.querySelectorAll("[data-chart-kind]")].map(node=>{const svg=node.querySelector("svg"),box=svg.viewBox.baseVal;return{kind:node.dataset.chartKind,outside:[...svg.querySelectorAll("text")].filter(t=>{const b=t.getBBox();return b.x<-.5||b.y<-.5||b.x+b.width>box.width+.5||b.y+b.height>box.height+.5;}).map(t=>t.textContent)};});};const render=RingsidePDF.build;RingsidePDF.build=async function(record,...args){window.__pdfTarget=record.definitions.find(d=>d.id==="cmj_height").target;return render.call(this,record,...args);};});
   let downloads=0;page.on("download",()=>downloads++);
   const button=page.locator('#reportActions [data-pdf-action]');
   if(config.retry){
    await page.evaluate(()=>{window.__renderer=html2canvas;window.html2canvas=async()=>{throw Error("验收模拟绘制失败");};});await page.locator("#reportExportMenu summary").click();await button.click();await page.waitForFunction(()=>RingsidePDF.lastDiagnostics?.status==="failed"&&!document.querySelector('#reportActions [data-pdf-action]').disabled);
    assert.equal(downloads,0);assert.equal(await page.locator('.ringside-pdf-stage').count(),0);assert.equal(await page.locator('#pdfProgress').isVisible(),false);await page.evaluate(()=>{window.html2canvas=__renderer;});check.failureRecovered=true;
   }
   const started=Date.now(),pending=page.waitForEvent("download",{timeout:120000});await page.locator("#reportExportMenu summary").click();await button.click();const download=await pending;await download.saveAs(path.join(out,config.id+".pdf"));await page.waitForFunction(()=>!document.querySelector('#reportActions [data-pdf-action]').disabled);
   check.elapsedMs=Date.now()-started;check.diagnostics=await page.evaluate(()=>RingsidePDF.lastDiagnostics);check.figures=await page.evaluate(()=>__printFigures);check.pdfTarget=await page.evaluate(()=>__pdfTarget);
   assert.equal(check.pdfTarget,80);assert.equal(downloads,1);assert.ok(check.diagnostics.pageCount>=2);assert.equal(await page.locator('.ringside-pdf-stage').count(),0);assert.ok(check.figures.every(f=>!f.outside.length),JSON.stringify(check.figures));assert.deepEqual(check.errors,[]);assert.deepEqual(check.network,[]);check.pass=true;console.log("PASS",config.id,check.diagnostics.pageCount,"pages",check.elapsedMs,"ms");
  }catch(error){check.failure=error.stack;console.error(error.stack);process.exitCode=1;}
  finally{result.cases.push(check);fs.writeFileSync(path.join(out,"management-download-verification.json"),JSON.stringify(result,null,2));await context.close();await browser.close();}
 }
 result.pass=result.cases.every(c=>c.pass);fs.writeFileSync(path.join(out,"management-download-verification.json"),JSON.stringify(result,null,2));
})();
