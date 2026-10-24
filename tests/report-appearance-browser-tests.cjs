"use strict";
// Isolated synthetic profiles. This never opens the installed user application.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),{createFixture}=require("./helpers/longitudinal-fixture.cjs");
const ROOT=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome",source=path.join(ROOT,"MotionBench.html"),out=path.join(ROOT,"output/playwright/report-appearance",channel);
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const receipt={synthetic:true,channel,sourceHash:sha(source),runnerSha256:sha(__filename),checks:[],errors:[],artifacts:[],pass:false};
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce"}),page=await context.newPage();
 page.setDefaultTimeout(20000);page.on("pageerror",error=>receipt.errors.push(error.stack||error.message));
 const check=async(name,run)=>{await run();receipt.checks.push(name);console.log("PASS "+name);};
 const ready=async p=>{await p.waitForFunction(()=>window.App?.ready);assert.equal(await p.evaluate(()=>App.ready),true);};
 const download=async(kind,name)=>{
  const duration=180000,start=Date.now(),awaited=page.waitForEvent("download",{timeout:duration});awaited.catch(()=>{});
  let timer;try{
   const operation=(async()=>{await page.evaluate(kind=>App["download"+kind](),kind);const item=await awaited;assert.equal(await item.failure(),null);const target=path.join(out,name);await item.saveAs(target);return target;})();
   return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(kind+" exceeded shared export/download deadline")),Math.max(1,duration-(Date.now()-start)));})]);
  }finally{clearTimeout(timer);}
 };
 let ids,rawBefore;
 try{
  await page.goto(pathToFileURL(source).href);await ready(page);
  await check("approved appearance loads and personal jump variables retain readable independent roles",async()=>{
   ids=await page.evaluate(async factory=>{
    const f=(0,eval)("("+factory+")")(window,17),M=RingsideModel,lib=M.libraryDefaults();lib.schema=3;lib.catalog=f.catalog;lib.evaluationProfiles=[RingsideEvaluation.serializeProfile(f.profile)];lib.defaultEvaluationProfileId=f.profile.id;
    const enabled=new Set(["cmj","sj","iso","imtp","fvp_sj"]);
    f.records.forEach((r,i)=>{r.title="合成测试记录 "+(i+1);r.evaluationProfileId=f.profile.id;for(const id of Object.keys(r.enabled))r.enabled[id]=enabled.has(id);r.data.long_generic?.forEach(row=>row.metrics.long_time=12-i*.1);});
    f.records[1].athlete.date=f.records[0].athlete.date;f.records[15].athlete.date=f.records[16].athlete.date;
    lib.athletes=[{id:f.athleteId,name:f.records[0].athlete.name,profile:M.profileFromRecord(f.records[0]),records:f.records}];lib.activeAthleteId=f.athleteId;lib.activeRecordId=f.records[0].recordId;
    await App.importPayload(lib,"replace-library");await App.showReport(false);await App.saveNow();return f.records.map(r=>r.recordId);
   },createFixture.toString());
   rawBefore=await page.evaluate(async()=>Promise.all(App.getLibrary().athletes.flatMap(a=>a.records.map(r=>App.getRepository().loadRecord(r.recordId)))));
   assert.equal(await page.locator('#reportView').getAttribute('data-report-appearance'),"ink-teal-history-v1");
   const roles=await page.locator('[data-jump-series="height"] rect').evaluateAll(nodes=>nodes.map(n=>[n.closest('[data-jump-test]').dataset.jumpTest,n.getAttribute('fill')]));
   assert.ok(roles.some(([id,color])=>id==="cmj"&&color==="#066c64"));assert.ok(roles.some(([id,color])=>id==="sj"&&color==="#458f86"));
   await page.locator('#reportView').screenshot({path:path.join(out,'personal.png')});
  });
  await check("seventeen records retain immutable facts and latest natural-day emphasis without date dash recycling",async()=>{
   assert.equal(await page.evaluate(ids=>App.selectRecords(ids),ids),true);
   const result=await page.evaluate(()=>{
    const model=App.getLongitudinal(),before=JSON.stringify(RingsideLongitudinal.facts(model)),view=RingsideReportAppearance.project(model),facts=JSON.stringify(RingsideLongitudinal.facts(model));
    const entries=Object.values(view.appearance.byRecord),last=model.periods.map(p=>p.date).sort().at(-1);
    return{count:view.periods.length,before,facts,basis:model.basis,viewBasis:view.basis,entries,last,colors:entries.map(e=>e.color),oldColors:model.periods.map(p=>p.color)};
   });
   assert.equal(result.count,17);assert.equal(result.before,result.facts);assert.equal(result.basis,result.viewBasis);assert.notDeepEqual(result.colors,result.oldColors);
   assert.ok(new Set(result.colors).size>8);assert.equal(result.entries.filter(e=>e.latest).length,2);assert.ok(result.entries.filter(e=>e.latest).every(e=>e.color==="#014e47"&&e.strokeWidth===2.6));
   const rendered=await page.locator('[data-longitudinal-series]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.longitudinalSeries,color:node.getAttribute('stroke'),width:Number(node.getAttribute('stroke-width'))})));
   for(const id of ids.slice(15)){const lines=rendered.filter(line=>line.id===id||line.id.startsWith(id+":"));assert.ok(lines.length>0,"latest day must have actual rendered lines: "+id);assert.ok(lines.every(line=>line.color==="#014e47"&&line.width===2.6));}
   const doc=await page.evaluate(()=>App.getLongitudinalDocument());assert.ok(doc);receipt.longitudinalBasis=result.basis;
  });
  await check("same-day records share date color and expose title plus unique record identification",async()=>{
   const info=await page.evaluate(ids=>{const model=RingsideReportAppearance.project(App.getLongitudinal()),a=model.appearance.byRecord[ids[0]],b=model.appearance.byRecord[ids[1]],latest=ids.slice(15).map(id=>model.appearance.byRecord[id]);return{a,b,latest};},ids);
   assert.equal(info.a.color,info.b.color);assert.notEqual(info.a.label,info.b.label);assert.match(info.a.label,/合成测试记录/);assert.match(info.b.label,/合成测试记录/);
   assert.ok(info.latest.every(entry=>entry.latest&&entry.color==="#014e47"&&entry.strokeWidth===2.6));assert.notEqual(info.latest[0].label,info.latest[1].label);
  });
  await check("three-date report and narrow viewport preserve all data without document overflow",async()=>{
   assert.equal(await page.evaluate(ids=>App.selectRecords([ids[0],ids[8],ids[16]]),ids),true);
   await page.locator('#reportNarrativeButton').click();await page.waitForFunction(()=>App.getUIState().mode==="entry");
   await page.locator('#interpEditor').fill("合成纵向人工正文：保留三个测试日期与全部测量结果。");await page.locator('#workspaceBack').click();assert.equal(await page.evaluate(()=>App.saveNow()),true);
   assert.equal(await page.evaluate(()=>App.getLongitudinalDocument().narrative.text),"合成纵向人工正文：保留三个测试日期与全部测量结果。");
   await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);
   await page.locator('#reportView').screenshot({path:path.join(out,'longitudinal-narrow.png')});await page.setViewportSize({width:1440,height:1000});
   await page.locator('#reportView').screenshot({path:path.join(out,'longitudinal.png')});
   const now=await page.evaluate(async()=>Promise.all(App.getLibrary().athletes.flatMap(a=>a.records.map(r=>App.getRepository().loadRecord(r.recordId)))));
   const measurementProjection=records=>records.map(r=>({recordId:r.recordId,athlete:r.athlete,data:r.data,enabled:r.enabled,narrative:r.narrative}));assert.deepEqual(measurementProjection(now),measurementProjection(rawBefore));
  });
  await check("offline HTML reopens with the same full-report date mapping and manual text",async()=>{
   const expected=await page.evaluate(()=>{const v=RingsideReportAppearance.project(App.getLongitudinal());return{colors:v.periods.map(p=>p.color),basis:v.basis,narrative:App.getLongitudinalDocument().narrative};});
   const file=await download("HTML","longitudinal.html"),reopened=await context.newPage();reopened.on("pageerror",error=>receipt.errors.push(error.stack||error.message));
   await reopened.goto(pathToFileURL(file).href);await ready(reopened);
   const actual=await reopened.evaluate(()=>{const v=RingsideReportAppearance.project(App.getLongitudinal());return{colors:v.periods.map(p=>p.color),basis:v.basis,narrative:App.getLongitudinalDocument().narrative};});assert.deepEqual(actual,expected);await reopened.close();
  });
  await check("actual PDF redraw carries theme to each captured page without mutating report facts",async()=>{
   const before=await page.evaluate(()=>JSON.stringify({model:RingsideLongitudinal.facts(App.getLongitudinal()),doc:App.getLongitudinalDocument()}));
   const raw=await page.evaluate(async()=>Promise.all(App.getLibrary().athletes.flatMap(a=>a.records.map(r=>App.getRepository().loadRecord(r.recordId)))));
   await page.evaluate(()=>{window.__appearancePDFPages=[];const original=window.html2canvas;window.html2canvas=async function(node,...args){if(node.classList?.contains('ringside-pdf-page')){const style=getComputedStyle(node);window.__appearancePDFPages.push({theme:node.dataset.reportAppearance,ink:style.getPropertyValue('--report-appearance-ink').trim(),foreground:style.color,headings:[...node.querySelectorAll('.quality-heading,.pdf-group-heading')].map(heading=>({background:getComputedStyle(heading).backgroundColor,ink:getComputedStyle(heading.querySelector('h3')||heading).color})),numbers:[...node.querySelectorAll('.section-number')].map(number=>({foreground:getComputedStyle(number).color,background:getComputedStyle(number).backgroundColor}))});}return original.call(this,node,...args);};});
   const file=await download("PDF","longitudinal.pdf"),diagnostics=await page.evaluate(()=>RingsidePDF.lastDiagnostics),pages=await page.evaluate(()=>window.__appearancePDFPages);
   assert.equal(diagnostics.status,"complete");assert.ok(pages.length>0);assert.ok(pages.every(p=>p.theme==="ink-teal-history-v1"&&p.ink==="#213836"));
   assert.equal(diagnostics.pageCount,pages.length);assert.ok(diagnostics.sourceChartCount>0);assert.equal(diagnostics.chartCount,diagnostics.sourceChartCount);assert.equal(diagnostics.renderedRowCount,diagnostics.rowCount);
   for(const key of["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(diagnostics[key],[],key);
   assert.ok(pages.every(p=>p.foreground==="rgb(33, 56, 54)"));
   const headings=pages.flatMap(p=>p.headings),numbers=pages.flatMap(p=>p.numbers);assert.ok(headings.length>0);assert.ok(numbers.length>0);
   assert.ok(headings.every(heading=>heading.background==="rgb(246, 249, 248)"&&heading.ink==="rgb(33, 56, 54)"));
   assert.ok(numbers.every(number=>number.foreground==="rgb(6, 108, 100)"&&number.background==="rgb(246, 249, 248)"));
   assert.equal(await page.evaluate(()=>JSON.stringify({model:RingsideLongitudinal.facts(App.getLongitudinal()),doc:App.getLongitudinalDocument()})),before);
   assert.deepEqual(await page.evaluate(async()=>Promise.all(App.getLibrary().athletes.flatMap(a=>a.records.map(r=>App.getRepository().loadRecord(r.recordId))))),raw);
   receipt.pdf={file:path.relative(ROOT,file),sha256:sha(file),pages:pages.length,themePages:pages,diagnostics};
  });
  assert.deepEqual(receipt.errors,[]);receipt.pass=true;
 }catch(error){receipt.failure=error.stack||String(error);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
 finally{
  receipt.finished=new Date().toISOString();receipt.sourceUnchanged=sha(source)===receipt.sourceHash;
  receipt.pass=receipt.pass&&receipt.sourceUnchanged;
  for(const name of fs.readdirSync(out)){const f=path.join(out,name);if(/\.(png|pdf|html)$/.test(name))receipt.artifacts.push({file:path.relative(ROOT,f),sha256:sha(f)});}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(receipt,null,2));await browser.close();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
