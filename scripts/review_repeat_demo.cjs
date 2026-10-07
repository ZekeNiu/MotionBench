"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("../tests/helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/demo"),shots=path.join(root,"output/playwright/repeat-demo"),pdfOut=path.join(root,"output/pdf");
const source=path.join(root,"Ringside_Boxing_Assessment.html"),baseline=path.join(root,"output/backups/repeat-visual-20261007/Ringside_Boxing_Assessment.html"),fixture=path.join(out,"三次重复演示.json");
const sha=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");fs.mkdirSync(shots,{recursive:true});
const result={sourceHash:sha(source),baselineHash:sha(baseline),layouts:[],checks:[],images:[],downloads:[],errors:[],network:[],pass:false};
let browser,page;
async function sidebar(){await page.waitForTimeout(250);if(await page.locator("#sidebar").evaluate(n=>n.inert))await page.locator("#sidebarToggle").click();}
async function save(){await sidebar();await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();}
async function photo(selector,name){await page.locator(selector).evaluate(n=>scrollTo({top:n.getBoundingClientRect().top+scrollY-85,behavior:"instant"}));await page.waitForTimeout(180);const p=path.join(shots,name+".png");await page.screenshot({path:p});result.images.push({path:path.relative(root,p),sha256:sha(p)});}
(async()=>{
 browser=await chromium.launch({channel:"chrome"});
 try{
  let baselineResults;
  for(const [version,file] of [["before",baseline],["after",source]]){
   const ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000},locale:"zh-CN",timezoneId:"Asia/Shanghai"});page=await ctx.newPage();page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});
   await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.App?.getState);await save();await page.locator("#importFile").setInputFiles(fixture);await page.waitForFunction(()=>App.getState().recordId==="demo-triples-20261007");
   if(await page.locator("#saveModal").isVisible())await page.locator("#saveModal button.close").click();await page.evaluate(()=>App.showReport());await page.locator("#toast").waitFor({state:"hidden"});await page.waitForTimeout(400);
   const calculated=await page.evaluate(()=>({values:App.stats().values,stats:App.stats().repetitions.map(g=>g.statistics)}));
   if(version==="before")baselineResults=calculated;else assert.deepEqual(calculated,baselineResults);
   for(const width of [1920,1440,1280,900,390]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);
    const geo=await page.locator('#detail-iso [data-chart-kind="isoRadar"] svg').evaluate(svg=>{const b=svg.getBoundingClientRect(),v=svg.viewBox.baseVal;return {height:b.height,figureWidth:b.width,viewHeight:v.height,labelsOutside:[...svg.querySelectorAll("text")].filter(t=>{const p=t.getBBox();return p.x<-.5||p.y<-.5||p.x+p.width>v.width+.5||p.y+p.height>v.height+.5;}).map(t=>t.textContent)};});
    result.layouts.push({version,width,...geo,noOverflow:await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)});
    if(version==="after"){assert.ok(geo.height<result.layouts.find(x=>x.version==="before"&&x.width===width).height*.92);assert.deepEqual(geo.labelsOutside,[]);assert.ok(result.layouts.at(-1).noOverflow);}
    if([1440,390].includes(width)){await photo("#detail-iso",version+"-iso-"+width);if(version==="after")for(const [selector,name] of [["#detail-cmj","jumps"],["#detail-imtp","imtp"],["#lvp-upper","lvp"],["#detail-custom_change_direction","custom"]])await photo(selector,"after-"+name+"-"+width);}
   }
   if(version==="before"){await ctx.close();continue;}
   result.checks.push("five-width-smaller-isometric-plot-unclipped","same-input-results-unchanged");
   await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(300);
   for(const mode of ["mean","best"]){await page.locator("#aggMode").selectOption(mode);await page.waitForTimeout(200);assert.doesNotMatch(await page.locator("#detailContent").innerText(),/最佳试次|最佳试跳|试次均值|按最高跳高/);assert.equal(await page.evaluate(()=>App.stats().values.cmj_height),mode==="best"?42:40);}
   assert.equal(await page.locator('#aggMode option').count(),2);result.checks.push("aggregation-control-kept-no-mode-hints-in-results");
   const h=await page.locator('#detail-iso svg').boundingBox();await page.locator("#trials-iso summary").click();assert.equal((await page.locator('#detail-iso svg').boundingBox()).height,h.height);await page.locator("#trials-iso summary").click();result.checks.push("raw-expansion-does-not-stretch-plot");
   for(const [label,name] of [["保存当前可编辑 HTML 报告","Ringside_三次重复演示.html"],["导出当前报告 JSON","三次重复演示.json"]]){await save();const wait=page.waitForEvent("download");await page.locator("#saveModal").getByRole("button",{name:label,exact:true}).click();const file=await wait,p=path.join(out,name);await file.saveAs(p);result.downloads.push({path:path.relative(root,p),sha256:sha(p)});if(await page.locator("#saveModal").isVisible())await page.locator("#saveModal button.close").click();}
   const restore=await browser.newContext({offline:true}),restored=await restore.newPage();await restored.goto(pathToFileURL(path.join(out,"Ringside_三次重复演示.html")).href);await restored.waitForFunction(()=>window.App?.getState);assert.equal(await restored.evaluate(()=>App.getState().recordId),"demo-triples-20261007");assert.equal(await restored.evaluate(()=>App.stats().repetitions.filter(g=>g.attempts.length===3).length),56);await restore.close();result.checks.push("editable-demo-export-restores-all-groups");
   await page.evaluate(()=>{window.__demoPages=[];const render=html2canvas;window.html2canvas=async(n,o)=>{const iso=[...n.querySelectorAll('[data-chart-kind="isoRadar"] img')].map(x=>({w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height}));window.__demoPages.push({text:n.innerText,iso});return render(n,o);};});
   await save();const wait=Promise.race([page.waitForEvent("download",{timeout:180000}),page.waitForFunction(()=>RingsidePDF.lastDiagnostics?.status==="failed",null,{timeout:180000}).then(async()=>{throw Error((await page.evaluate(()=>RingsidePDF.lastDiagnostics)).error);})]);await page.locator("#pdfButton").click();const pdf=await wait,pdfPath=path.join(pdfOut,"repeat-demo.pdf");await pdf.saveAs(pdfPath);await page.waitForFunction(()=>!document.querySelector("#pdfButton").disabled);
   const data=await page.evaluate(()=>({diagnostics:RingsidePDF.lastDiagnostics,pages:__demoPages}));assert.equal(data.diagnostics.status,"complete");for(const k of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(data.diagnostics[k],[]);
   const text=data.pages.map(p=>p.text).join("\n");assert.doesNotMatch(text,/最佳试次|最佳试跳|试次均值|按最高跳高/);assert.ok(text.includes("附录 · 原始试次"));assert.ok(text.includes("三次重复演示（模拟数据）"));
   fs.writeFileSync(path.join(pdfOut,"demo-download-verification.json"),JSON.stringify({sourceHash:result.sourceHash,cases:[{id:"repeat-demo",pass:true,...data,pdfSha256:sha(pdfPath)}]},null,2));result.pdf={path:path.relative(root,pdfPath),sha256:sha(pdfPath),pages:data.pages.length};result.checks.push("actual-pdf-download-no-mode-hints-and-complete-appendix");
   await ctx.close();
  }
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;console.log("PASS demo: 56 triple groups, 5 widths, preserved calculations, editable HTML and "+result.pdf.pages+" PDF pages");
 }catch(e){result.failure=e.stack;console.error(e.stack);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(shots,"review.json"),JSON.stringify(result,null,2));await browser?.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
