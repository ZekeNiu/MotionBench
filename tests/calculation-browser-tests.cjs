"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{execFileSync}=require("node:child_process");
const {chromium}=require("./helpers/playwright.cjs"),{fixture,context:calculationContext}=require("./helpers/calculation-fixture.cjs");
const root=path.resolve(__dirname,".."),arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const channel=process.argv.includes("--edge")?"msedge":"chrome",source=path.resolve(root,arg("--source","MotionBench.html"));
const out=path.resolve(root,arg("--artifact-dir","output/playwright/calculation-browser/"+channel)),pdf=process.argv.includes("--pdf");
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out,{recursive:true});const isolated=path.join(out,"isolated.html");fs.copyFileSync(source,isolated);
const receipt={synthetic:true,channel,sourceHash:hash(isolated),runnerSha256:hash(__filename),fixtureSha256:hash(path.join(__dirname,"helpers/calculation-fixture.cjs")),pdfRequested:pdf,checks:[],errors:[],artifacts:[],pdf:[],pass:false};
let browser,page,activeContext;
const artifact=(file,kind)=>receipt.artifacts.push({path:path.relative(root,file).replaceAll("\\","/"),kind,sha256:hash(file),bytes:fs.statSync(file).size});
async function check(name,run){await run();receipt.checks.push(name);console.log("PASS "+name);}
async function settle(){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});}
async function screenshot(name,selector){await settle();const file=path.join(out,name+".png");if(selector)await page.locator(selector).screenshot({path:file,animations:"disabled"});else await page.screenshot({path:file,animations:"disabled"});artifact(file,"screenshot");}
async function seed(){
  await activeContext?.close();activeContext=await browser.newContext({offline:true,locale:"zh-CN",viewport:{width:1440,height:1000},reducedMotion:"reduce",acceptDownloads:true});page=await activeContext.newPage();page.setDefaultTimeout(20000);
  page.on("pageerror",e=>receipt.errors.push(e.stack||e.message));page.on("dialog",d=>d.accept());await page.addInitScript({content:"window.makeCalculationFixture="+fixture.toString()});await page.goto(pathToFileURL(isolated).href);await page.evaluate(()=>App.ready);
  await page.evaluate(async()=>{
    const M=RingsideModel,G=RingsideGenericReport,base=makeCalculationFixture(window),lib=M.libraryDefaults();
    base.definitions.push({...structuredClone(base.definitions.find(d=>d.id==="calc_turn_time")),id:"calc_extra",name:"Synthetic additional result",entryScope:"record",unit:"次"});base.customValues.calc_extra={value:42,notes:"Synthetic additional result"};
    const make=(person,index,time,missing=false)=>{
      const r=structuredClone(base);r.recordId="calc_record_"+person+"_"+index;r.athleteId="calc_person_"+person;
      r.athlete.name="Synthetic calculation "+person;r.athlete.date=index===0?"2026-02-01":index===1?"2026-03-01":"2026-04-01";
      r.athlete.sex="男";r.created="2026-01-01T00:00:00.000Z";r.evaluationProfileId="synthetic_evaluation";
      r.data.calc_turn=[{id:"turn",metrics:{calc_turn_time:time}}];if(missing)r.data.calc_run=[];
      r.views.genericReports={calc_run:G.createView(r,"calc_run",{kind:"bar",metricIds:["calc_total"]}),calc_turn:G.createView(r,"calc_turn",{kind:"bar",metricIds:["calc_deficit"]})};
      if(person==="empty")r.customValues.calc_extra={value:"",notes:""};
      r.narrative.text="Synthetic calculation report.";r.narrative.html=M.textToHTML(r.narrative.text);r.narrative.origin="manual";
      return M.normalizeRecord(r);
    };
    const records=[make("a",0,4),make("a",1,3),make("a",2,4,true),make("b",0,7),make("missing",0,50,true),make("zero",0,3),make("negative",0,2),make("empty",0,null,true)];
    lib.catalog=M.mergeCatalog(null,records[0]);lib.catalog.reportViews||={};lib.catalog.reportViews.calc_run=G.createView(lib.catalog,"calc_run",{kind:"bar",metricIds:["calc_total"]});lib.catalog.reportViews.calc_turn=G.createView(lib.catalog,"calc_turn",{kind:"bar",metricIds:["calc_deficit"]});const profile=RingsideEvaluation.create(records[0],"Synthetic evaluation");profile.id="synthetic_evaluation";
    lib.evaluationProfiles=[profile];lib.defaultEvaluationProfileId=profile.id;
    lib.athletes=[...new Set(records.map(r=>r.athleteId))].map(id=>{const owned=records.filter(r=>r.athleteId===id);return{id,name:owned[0].athlete.name,profile:M.profileFromRecord(owned[0]),records:owned};});
    lib.testPlans=[{id:"synthetic_calculation_plan",name:"Synthetic calculation plan",testIds:["calc_run","calc_turn"],isoDirectionIds:[],defaultEvaluationProfileId:profile.id,disabled:false,calculationBindings:structuredClone(base.calculationBindings)}];
    lib.activeAthleteId="calc_person_a";lib.activeRecordId="calc_record_a_0";lib.schema=3;
    await App.importPayload(lib,"replace-library");await App.showReport(false);
    window.calculationPeople=lib.athletes.map(a=>({athleteId:a.id,recordId:a.records[0].recordId}));
  });await settle();
}
async function personal(id){await page.evaluate(async id=>{await App.selectAthlete(id.split("calc_record_")[1].split("_")[0]?"calc_person_"+id.split("calc_record_")[1].split("_")[0]:"calc_person_a");await App.selectRecords([id]);await App.showReport(false);},id);await settle();}
async function horizontal(groupOnly=false){
  const okay=await page.evaluate(groupOnly=>App.selectHorizontal({title:"Synthetic COD comparison",perspective:"peers",participants:groupOnly?[]:calculationPeople,mode:"best",profileId:"synthetic_evaluation",window:{kind:"all"},references:[{id:"cohort",label:"Synthetic paired cohort",scope:"all",sampling:"latest",window:{kind:"custom",from:"2026-02-01",to:"2026-02-01"}}]}),groupOnly);
  assert.equal(okay,true);await settle();
}
async function arrangement(selector,chartSelector,tableSelector,layout){
  const box=await page.locator(selector).evaluate((node,{chartSelector,tableSelector})=>{
    const c=node.querySelector(chartSelector),t=node.querySelector(tableSelector);if(!c||!t)return{missing:true,html:node.outerHTML.slice(0,400)};
    const a=c.getBoundingClientRect(),b=t.getBoundingClientRect();return{chart:{top:a.top,bottom:a.bottom,left:a.left,right:a.right,width:a.width},table:{top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width}};
  },{chartSelector,tableSelector});assert.ok(!box.missing,JSON.stringify(box));assert.ok(box.chart.width>0&&box.table.width>0);
  if(layout==="side")assert.ok(box.chart.right<=box.table.left+1,JSON.stringify(box));else assert.ok(box.chart.bottom<=box.table.top+1,JSON.stringify(box));
  return box;
}
async function exportPDF(name,kind){
  await page.evaluate(()=>{
    window.__calculationCanvas=window.html2canvas;window.__calculationPDFPages=[];
    window.html2canvas=async(node,options)=>{const body=node.querySelector(".ringside-pdf-content"),box=body.getBoundingClientRect();
      __calculationPDFPages.push({text:body.textContent,rows:[...body.querySelectorAll("tbody>tr")].map(row=>[...row.cells].map(c=>c.textContent.trim())),overflow:[...body.children].filter(child=>child.getBoundingClientRect().bottom>box.bottom+1).map(n=>n.className),charts:[...body.querySelectorAll("img[data-pdf-chart-index]")].map(n=>({width:n.width,height:n.height,naturalWidth:n.naturalWidth,naturalHeight:n.naturalHeight}))});
      return __calculationCanvas(node,options);};
  });
  const download=page.waitForEvent("download",{timeout:180000});download.catch(()=>{});
  await page.evaluate(()=>App.downloadPDF());const item=await download;assert.equal(await item.failure(),null);
  const file=path.join(out,name+".pdf");await item.saveAs(file);artifact(file,"pdf");
  const evidence=await page.evaluate(()=>{window.html2canvas=window.__calculationCanvas;return{diagnostics:RingsidePDF.lastDiagnostics,pages:window.__calculationPDFPages,stages:document.querySelectorAll(".ringside-pdf-stage").length};});
  assert.equal(evidence.diagnostics.status,"complete");assert.equal(evidence.stages,0);
  for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(evidence.diagnostics[key],[],key);
  assert.ok(evidence.pages.every(p=>p.overflow.length===0));assert.ok(evidence.pages.flatMap(p=>p.charts).every(c=>c.width>0&&c.height>0&&c.naturalWidth>0&&c.naturalHeight>0));
  const text=evidence.pages.map(p=>p.text).join("");assert.match(text,/calc_deficit/);assert.match(text,/calc_turn_time|变向时间/);assert.match(text,/直线参照/);assert.doesNotMatch(text,/NaN|Infinity/);
  const evidenceFile=path.join(out,name+"-capture.json");fs.writeFileSync(evidenceFile,JSON.stringify(evidence,null,2));artifact(evidenceFile,"pdf-capture");
  const rendering=JSON.parse(execFileSync("python",["-X","utf8","-c","import json,sys,pymupdf; from pathlib import Path; d=pymupdf.open(sys.argv[1]); p=Path(sys.argv[2]); images=[]\nfor i in range(len(d)):\n f=p/('page-'+str(i+1)+'.png'); d[i].get_pixmap(matrix=pymupdf.Matrix(1.15,1.15)).save(f); images.append(str(f))\nprint(json.dumps({'pages':len(d),'images':images}))",file,path.join(out,name)],{encoding:"utf8"}));
  rendering.images.forEach(file=>artifact(file,"rendered-pdf-page"));receipt.pdf.push({name,kind,pages:rendering.pages,diagnostics:evidence.diagnostics});
}
(async()=>{
  browser=await chromium.launch({channel,headless:true});await seed();
  await check("new-metric UI persists sum and COD calculation definitions",async()=>{
    for(const kind of ["sum","cod-deficit"]){const testId=kind==="sum"?"calc_run":"calc_turn",name="Synthetic UI "+kind;
      await page.evaluate(testId=>App.openCatalogItem("new-metric",testId),testId);await page.locator("#catalogMetricName").fill(name);await page.locator("#catalogUnit").fill("s");await page.locator("#catalogPerformanceDirection").selectOption("lower");await page.locator("#calculationKind").selectOption(kind);
      if(kind==="sum"){for(const id of ["calc_segment_a","calc_segment_b"])await page.locator(`[data-calculation-input][value="${id}"]`).check();await page.locator("#calculationDistance").fill("20");}
      else{await page.locator("#calculationTime").selectOption("calc_turn_time");await page.locator("#calculationReferenceDistance").fill("20");}
      if(kind==="sum"){const boxes=await page.locator("[data-calculation-input]").evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height};}));assert.ok(boxes.every(b=>b.width===16&&b.height===16),JSON.stringify(boxes));}
      await screenshot("calculation-editor-"+kind,"#catalogModal .modal");
      await page.locator('#catalogForm [type="submit"]').click();await page.locator("#catalogModal").waitFor({state:"hidden"});
      const d=await page.evaluate(name=>App.getLibrary().catalog.definitions.find(d=>d.name===name),name);assert.equal(d.calculation.kind,kind);assert.equal(d.unit,"s");assert.equal(d.entryScope,kind==="sum"?"attempt":"record");
    }await screenshot("calculation-editor-saved");
  });
  await check("calculated entry outputs update immediately when raw timing inputs change",async()=>{
    await page.evaluate(()=>App.openEntry("calc_run"));await page.locator('#entryContent input[data-path*="calc_segment_a"]').first().fill("2.5");await page.locator('#entryContent input[data-path*="calc_segment_b"]').first().fill("1.5");
    await page.waitForFunction(()=>parseFloat(document.querySelector("#entryContent .calculation-readonly output").textContent)===4,{},{timeout:2000});
    await page.evaluate(()=>App.openEntry("calc_turn"));await page.locator('#entryContent input[data-path*="calc_turn_time"]').first().fill("5");await page.waitForFunction(()=>parseFloat(document.querySelector("#entryContent .calculation-readonly output").textContent)===1,{},{timeout:2000});
  });
  await seed();
  await check("plan binding saves reopens reloads and freezes into a newly created record",async()=>{
    await page.evaluate(()=>App.openManagement("plans"));await page.locator('[data-manager-action="plan-edit"][data-id="synthetic_calculation_plan"]').click();const binding=page.locator('[data-calculation-binding="calc_deficit"]');
    await binding.selectOption("");await page.locator('[data-manager-action="plan-save"]').click();await page.locator("#testPlanName").waitFor({state:"detached"});
    await page.locator('[data-manager-action="plan-edit"][data-id="synthetic_calculation_plan"]').click();assert.equal(await binding.inputValue(),"");await binding.selectOption("calc_total");await page.locator('[data-manager-action="plan-save"]').click();await page.locator("#testPlanName").waitFor({state:"detached"});await page.reload();await page.evaluate(()=>App.ready);
    await page.evaluate(()=>App.openManagement("plans"));await page.locator('[data-manager-action="plan-edit"][data-id="synthetic_calculation_plan"]').click();assert.equal(await binding.inputValue(),"calc_total");await screenshot("plan-binding");await page.locator('[data-manager-action="plan-close"]').click();
    await page.evaluate(()=>App.startDataEntry());for(const node of await page.locator('[data-creation-athlete]:checked').all())await node.uncheck();await page.locator('[data-creation-athlete="calc_person_a"]').check();await page.locator("#creationNext").click();await page.locator("#creationTestPlan").selectOption("synthetic_calculation_plan");await page.locator("#creationDate").fill("2026-05-01");await page.locator("#creationSubmit").click();await page.locator("#entryView").waitFor({state:"visible"});
    await page.locator('#entryContent input[data-path*="calc_segment_a"]').first().fill("2");await page.locator('#entryContent input[data-path*="calc_segment_b"]').first().fill("1");
    await page.evaluate(()=>App.saveNow());const persisted=await page.evaluate(async()=>{const r=App.getState(),saved=await App.getRepository().loadRecord(r.recordId);return{binding:saved.calculationBindings,snapshot:saved.testPlanSnapshot.calculationBindings};});assert.equal(persisted.binding.calc_deficit.metricId,"calc_total");assert.deepEqual(persisted.snapshot,persisted.binding);
  });
  await seed();
  await check("entry fields and downloaded Excel accept raw timing inputs only",async()=>{
    for(const testId of ["calc_run","calc_turn"]){await page.evaluate(testId=>App.openEntry(testId),testId);const paths=await page.locator("#entryContent input[data-path],#entryContent select[data-path]").evaluateAll(nodes=>nodes.map(n=>n.dataset.path));assert.ok(paths.length>0);assert.ok(paths.every(p=>!p.includes("calc_total")&&!p.includes("calc_deficit")),JSON.stringify(paths));assert.ok(await page.locator("#entryContent .calculation-readonly output").count()>0);const style=await page.locator("#entryContent .calculation-readonly output").first().evaluate(n=>({size:getComputedStyle(n).fontSize,color:getComputedStyle(n).color}));assert.deepEqual(style,{size:"14px",color:"rgb(48, 54, 61)"});await screenshot("entry-"+testId);}
    const download=page.waitForEvent("download");download.catch(()=>{});await page.locator('[data-entry-excel-action="download"]').click();const item=await download;const file=path.join(out,"raw-timing-template.xlsx");await item.saveAs(file);artifact(file,"excel");const c=calculationContext(),book=new c.ExcelJS.Workbook();await book.xlsx.load(new (require("node:vm").runInContext("Uint8Array",c))(fs.readFileSync(file)));let metadata="";book.getWorksheet("_MotionBench").eachRow(row=>metadata+=row.getCell(2).value);const manifest=JSON.parse(metadata);assert.equal(book.getWorksheet("计算结果"),undefined);assert.ok(manifest.sheets.flatMap(s=>s.blocks.flatMap(b=>b.columns)).every(col=>!col.key.includes("calc_total")&&!col.key.includes("calc_deficit")));
  });
  await seed();
  await check("personal COD uses its original left-chart right-table card and one complete source row",async()=>{
    const box=await arrangement("#detail-calc_turn",".generic-detail>.chart-wrap",".generic-detail>.detail-data","side");receipt.personalLayout=box;assert.equal(await page.locator("#detail-calc_turn table.cod-results").count(),1);assert.equal(await page.locator('#detail-calc_turn tr[data-metric-id="calc_deficit"]').count(),1);
    const values=await page.locator("#detail-calc_turn table.cod-results tbody tr").evaluateAll(rows=>rows.map(row=>Number(row.cells[1].textContent)));assert.deepEqual(values,[4,3,1]);assert.match(await page.locator('#detail-calc_turn .generic-detail>.detail-data tr[data-metric-id="calc_extra"]').textContent(),/42/);const charts=await page.locator("#detail-calc_turn [data-chart-input]").first().evaluate(n=>JSON.parse(n.dataset.chartInput)[0]);assert.deepEqual(charts.panels.flatMap(p=>p.items.map(i=>i.id)),["calc_deficit"]);await screenshot("personal-cod","#detail-calc_turn");
    if(pdf){fs.mkdirSync(path.join(out,"personal"),{recursive:true});await exportPDF("personal","side");}
  });
  await check("zero negative and missing COD results keep the same chart meaning and source values",async()=>{
    for(const [recordId,value]of [["calc_record_zero_0",0],["calc_record_negative_0",-1],["calc_record_missing_0",null]]){await personal(recordId);const model=await page.locator("#detail-calc_turn [data-chart-input]").first().evaluate(n=>JSON.parse(n.dataset.chartInput)[0]);assert.equal(model.kind,"bar");assert.equal(model.available,value!==null);if(value===null){assert.equal(await page.locator("#detail-calc_turn .generic-chart-unavailable").count(),1);const rows=await page.locator("#detail-calc_turn table.cod-results tbody tr").evaluateAll(nodes=>nodes.map(row=>[...row.cells].map(c=>c.textContent)));assert.equal(Number(rows[0][1]),50);assert.equal(rows[1][1],"—");assert.equal(rows[2][1],"—");assert.doesNotMatch(rows[2][0],/缺少|尚未绑定|本次记录/);assert.equal(model.reason,"");assert.equal(await page.locator("#detail-calc_turn svg").count(),0);}else assert.equal(model.panels[0].items[0].value,value);await screenshot("personal-"+(value===null?"missing":value===0?"zero":"negative"),"#detail-calc_turn");}
  });
  await seed();
  await check("longitudinal COD charts stay above complete source and missing-result table rows",async()=>{
    assert.equal(await page.evaluate(()=>App.selectRecords(["calc_record_a_0","calc_record_a_1","calc_record_a_2"])),true);await settle();receipt.longitudinalLayout=await arrangement("#detail-calc_turn",".longitudinal-figures",".detail-data","stack");
    const model=await page.evaluate(()=>App.getLongitudinal().projects.find(p=>p.id==="calc_turn").metrics);const row=model.find(r=>r.metricId==="calc_deficit");assert.deepEqual(row.cells.map(c=>c?.value),[1,0,null]);assert.ok(model.some(r=>r.name.includes("直线参照")));assert.match(await page.locator("#detail-calc_turn").textContent(),/参照/);await screenshot("longitudinal-cod","#detail-calc_turn");
    const graph=await page.locator("#detail-calc_turn [data-longitudinal-chart]").first().evaluate(node=>JSON.parse(node.dataset.longitudinalChart));assert.equal(graph.kind,"cod-trend");assert.equal(await page.locator("#detail-calc_turn [data-cod-point]").count(),2);assert.doesNotMatch(await page.locator("#detail-calc_turn").textContent(),/缺少有效直线参照时间/);
    if(pdf){fs.mkdirSync(path.join(out,"longitudinal"),{recursive:true});await exportPDF("longitudinal","stack");}
  });
  await check("horizontal COD aggregates valid individual pairs and keeps charts above tables",async()=>{
    await horizontal();receipt.horizontalLayout=await arrangement("#horizontal-cohort-calc_turn",".horizontal-figures",".horizontal-table","stack");const row=await page.evaluate(()=>App.getHorizontal().references[0].projects.find(p=>p.id==="calc_turn").metrics.find(r=>r.metricId==="calc_deficit"));assert.equal(row.benchmark.n,4);assert.equal(row.benchmark.mean,1);assert.equal(row.cells[2].value,null);await screenshot("horizontal-cod","#horizontal-cohort-calc_turn");
    if(pdf){fs.mkdirSync(path.join(out,"horizontal"),{recursive:true});await exportPDF("horizontal","stack");}
  });
  await check("group-only COD stays stacked while unrelated original generic cards retain their pairing",async()=>{
    await horizontal(true);receipt.groupLayout=await arrangement("#horizontal-cohort-calc_turn",".horizontal-figures",".horizontal-table","stack");await arrangement("#horizontal-cohort-calc_run",".detail-pair>.chart-wrap",".detail-pair>.detail-data","side");await screenshot("group-only-cod","#horizontal-cohort-calc_turn");
  });
  await seed();
  await check("COD editor exposes only its real dedicated visualization toggle and preserves the full result table",async()=>{
    await page.evaluate(()=>App.openCatalogItem("edit","calc_turn"));await page.locator("[data-generic-cod]").waitFor({state:"visible"});assert.equal(await page.locator("#genericReportKind").isVisible(),false);assert.equal(await page.locator("[data-generic-metrics]").isVisible(),false);assert.match(await page.locator("[data-generic-cod]").textContent(),/变向赤字专用图/);await page.locator(".generic-report-editor").scrollIntoViewIfNeeded();await screenshot("cod-dedicated-editor","#catalogModal .modal");
    await page.locator("#genericReportEnabled").uncheck();await page.locator('#catalogForm [type="submit"]').click();await page.locator("#catalogModal").waitFor({state:"hidden"});await page.evaluate(()=>App.showReport(false));assert.equal(await page.locator("#detail-calc_turn [data-chart-input]").count(),0);assert.equal(await page.locator("#detail-calc_turn table.cod-results").count(),1);assert.match(await page.locator("#detail-calc_turn").textContent(),/42/);
    await page.evaluate(()=>App.openCatalogItem("edit","calc_turn"));await page.locator("#genericReportEnabled").check();await page.locator('#catalogForm [type="submit"]').click();await page.locator("#catalogModal").waitFor({state:"hidden"});await page.evaluate(()=>App.showReport(false));assert.equal(await page.locator("#detail-calc_turn [data-chart-input]").count(),1);
  });
  await check("a wholly unmeasured COD does not create a report block",async()=>{await personal("calc_record_empty_0");assert.equal(await page.locator("#detail-calc_turn").count(),0);});
  assert.deepEqual(receipt.errors,[]);if(pdf)assert.equal(receipt.pdf.length,3);assert.equal(hash(isolated),receipt.sourceHash);receipt.pass=true;
})().catch(async error=>{receipt.failure=error.stack||String(error);console.error(receipt.failure);if(page&&!page.isClosed()){const file=path.join(out,"failure.png");await page.screenshot({path:file}).catch(()=>{});if(fs.existsSync(file))artifact(file,"failure-screenshot");}}).finally(async()=>{
  receipt.finished=new Date().toISOString();fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(receipt,null,2));await browser?.close();if(!receipt.pass)process.exitCode=1;
});
