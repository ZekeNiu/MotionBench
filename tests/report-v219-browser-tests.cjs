"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),source=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/v2.19.0/scoring-report"),channel=process.argv.includes("--edge")?"msedge":"chrome";
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out,{recursive:true});
const result={channel,sourceHash:hash(source),runnerSha256:hash(__filename),checks:[],errors:[],network:[],artifacts:[],pdfs:[],synthetic:true};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),contexts=[];
 const open=async file=>{const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});contexts.push(context);const page=await context.newPage();page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});page.on("dialog",d=>d.accept());await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.App?.ready);return page;};
 const artifact=(file,kind)=>result.artifacts.push({path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file),kind});
 const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS "+name);};
 let page;
 try{
  page=await open(source);
  await page.evaluate(async()=>{
   const r=RingsideModel.defaults();r.demo=false;r.athlete.name="平均分核验";r.athlete.mass=70;r.athlete.sex="男";
   Object.keys(r.enabled).forEach(k=>r.enabled[k]=["cmj","sj"].includes(k));r.data.cmj=[{id:"mean_cmj",height:40}];r.data.sj=[{id:"mean_sj",height:30}];r.narrative.text="本次人工解读需原样保留。";
   for(const id of ["cmj_height","sj_height"])Object.assign(r.definitions.find(d=>d.id===id),{referenceEnabled:true,target:50});
   const p=RingsideEvaluation.create(r,"固定成员平均方案");p.aggregations={"ability:下肢爆发力":{method:"mean",members:["metric:cmj_height","metric:sj_height"],transforms:{"metric:cmj_height":{kind:"ratio",direction:"higher"},"metric:sj_height":{kind:"ratio",direction:"higher"}}}};
   for(const [id,target] of [["cmj_height",50],["sj_height",60]])Object.assign(p.standards.find(s=>s.id==="metric:"+id),{enabled:true,targetEnabled:true,rangesEnabled:false,target,ranges:[]});
   await App.importPayload(RingsideModel.recordEnvelope(RingsideEvaluation.materialize(r,p),p),"replace-library");await App.showReport(false);
  });
  const projection=async p=>p.evaluate(()=>({axes:App.stats().axes.map(a=>({key:a.key,value:a.value,status:a.status,members:a.members,scores:a.scores})),results:App.stats().evaluationResults.filter(v=>["cmj_height","sj_height"].includes(v.metricId)),facts:App.facts().capabilities,narrative:App.getState().narrative.text}));
  let baseline;
  await check("report radar breakdown and AI facts use the same fixed-member scores",async()=>{
   baseline=await projection(page);assert.equal(baseline.axes.length,1);assert.equal(baseline.axes[0].value,65);assert.equal(baseline.axes[0].status,"gray");assert.deepEqual(baseline.axes[0].scores,[80,50]);assert.deepEqual(baseline.facts[0].memberScores,[80,50]);
   assert.match(await page.locator('.ability-comparison').innerText(),/能力评分/);assert.match(await page.locator('.ability-comparison').innerText(),/65 \/ 100/);
   await page.locator('.ability-score-details > summary').click();const text=await page.locator('[data-ability-score]').innerText();for(const value of ["65.0","80.0","50.0","40.0","25.0"])assert.ok(text.includes(value),value);assert.ok(baseline.results.every(r=>r.scoreContributions.length===1));
  });
  await check("average composition remains readable on desktop and narrow screens",async()=>{
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('.ability-score-details').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const file=path.join(out,channel+"-mean-"+width+".png");await page.screenshot({path:file});artifact(file,"screenshot");}
   await page.setViewportSize({width:1440,height:1000});
  });
  const download=async kind=>{const event=page.waitForEvent("download",{timeout:240000});await page.evaluate(kind=>App["download"+kind](),kind);const dl=await event;assert.equal(await dl.failure(),null);const file=path.join(out,channel+"-mean."+kind.toLowerCase());await dl.saveAs(file);artifact(file,"download");return file;};
  await check("JSON HTML and refresh preserve scores and the manual narrative",async()=>{
   for(const kind of ["JSON","HTML"]){const file=await download(kind);let restored;
    if(kind==="HTML")restored=await open(file);else{restored=await open(source);await restored.evaluate(async payload=>{await App.importPayload(payload,"replace-library");await App.showReport(false);},JSON.parse(fs.readFileSync(file)));}
    assert.deepEqual(await projection(restored),baseline);await restored.close();
   }
   await page.reload();await page.waitForFunction(()=>window.App?.ready);assert.deepEqual(await projection(page),baseline);
  });
  if(process.argv.includes("--pdf"))await check("actual PDF includes the exact mean membership scores and contributions",async()=>{
   await page.evaluate(()=>{window.__meanPdf=[];window.__realCanvas=window.html2canvas;window.html2canvas=async(node,options)=>{__meanPdf.push({text:node.innerText,rows:[...node.querySelectorAll('[data-ability-score] tr')].map(r=>r.innerText)});return __realCanvas(node,options);};});
   const file=await download("PDF"),evidence=await page.evaluate(()=>({diagnostics:RingsidePDF.lastDiagnostics,pages:__meanPdf}));
   assert.equal(evidence.diagnostics.status,"complete");for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(evidence.diagnostics[key],[]);
   const text=evidence.pages.map(p=>p.text).join("\n");assert.ok(text.includes("2 个固定成员等权平均"));assert.ok(text.includes("65.0"));assert.ok(text.includes("平均贡献"));result.pdfs.push({file:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file),...evidence});
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);
 }catch(e){result.failure=e.stack;console.error(e.stack);if(page){const file=path.join(out,channel+"-failure.png");await page.screenshot({path:file}).catch(()=>{});if(fs.existsSync(file))artifact(file,"failure");}}
 finally{result.sourceUnchanged=hash(source)===result.sourceHash;result.pass=!result.failure&&!result.errors.length&&!result.network.length&&result.sourceUnchanged;fs.writeFileSync(path.join(out,channel+".json"),JSON.stringify(result,null,2));await Promise.all(contexts.map(c=>c.close()));await browser.close();if(!result.pass)process.exitCode=1;}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
