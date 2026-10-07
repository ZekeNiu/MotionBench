"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),source=path.join(root,"Ringside_Boxing_Assessment.html"),out=path.join(root,"output/playwright/repeat-columns"),demo=path.join(root,"output/demo"),pdfOut=path.join(root,"output/pdf");
const sha=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex"); fs.mkdirSync(out,{recursive:true});
const evidence={sourceHash:sha(source),checks:[],layouts:[],images:[],downloads:[],errors:[],network:[],pass:false};
const screensOnly=process.argv.includes("--screens-only");let browser,page;
async function sidebar(){await page.waitForTimeout(200);if(await page.locator('#sidebar').evaluate(n=>n.inert))await page.locator('#sidebarToggle').click();}
async function save(){await sidebar();await page.locator('#sidebar button[onclick="App.saveMenu()"]').click();}
async function entry(id){await sidebar();await page.locator('#editButton').click();await sidebar();await page.locator(`#entryNav button[data-entry-tab="${id}"]`).click();}
async function input(key,value){const n=page.locator(`[data-path="${key}"]`);await n.fill(String(value));await n.press('Tab');}
async function report(){await page.locator('#workspaceBack').click();await page.waitForTimeout(220);}
async function shot(selector,name){await page.locator(selector).evaluate(n=>scrollTo({top:n.getBoundingClientRect().top+scrollY-85,behavior:'instant'}));await page.waitForTimeout(150);const p=path.join(out,name+'.png');await page.screenshot({path:p});evidence.images.push({path:path.relative(root,p),sha256:sha(p)});}
async function check(name,fn){await fn();evidence.checks.push(name);console.log('PASS '+name);}
(async()=>{
 browser=await chromium.launch({channel:'chrome'});const ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});page=await ctx.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>evidence.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))evidence.network.push(r.url());});page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(source).href);await page.waitForFunction(()=>window.App?.getState);await save();await page.locator('#importFile').setInputFiles(path.join(root,'examples/three-trials.json'));await page.waitForFunction(()=>App.getState().recordId==='demo-triples-20261007');if(await page.locator('#saveModal').isVisible())await page.locator('#saveModal button.close').click();await page.evaluate(()=>App.showReport());await page.locator('#toast').waitFor({state:'hidden'});
  await check('all-71-statistics-in-existing-result-rows',async()=>{
   assert.equal(await page.locator('#detailContent .repeat-statistics,#detailContent .repeat-stat-table').count(),0);
   assert.equal(await page.locator('#detailContent [data-repeat-stat]').count(),71);
   assert.equal(await page.locator('#detail-iso .iso-results [data-repeat-stat]').count(),24);
   assert.equal(await page.locator('#detail-imtp [data-repeat-stat]').count(),8);
   assert.doesNotMatch(await page.locator('#detail-iso').innerText(),/中线/);
   assert.doesNotMatch(await page.locator('#detail-imtp').innerText(),/力来源|有效次数 力\/RFD/);
   assert.equal(await page.locator('#detailContent .repeat-panel table.with-repeat-columns').count(),0);
  });
  for(const width of [1920,1440,1280,900,390]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);
   const shape=await page.locator('#detail-iso [data-chart-kind="isoRadar"] svg').evaluate(n=>{const r=n.getBoundingClientRect(),v=n.viewBox.baseVal;return {height:r.height,width:r.width,viewHeight:v.height,labelsOutside:[...n.querySelectorAll('text')].filter(t=>{const b=t.getBBox();return b.x<-.5||b.y<-.5||b.x+b.width>v.width+.5||b.y+b.height>v.height+.5;}).map(t=>t.textContent)};});
   const layout=await page.evaluate(()=>({noOverflow:document.documentElement.scrollWidth<=innerWidth,tableOverflow:[...document.querySelectorAll('#detailContent .with-repeat-columns')].filter(t=>t.scrollWidth>t.clientWidth+2).map(t=>t.className),fullIsoWidth:document.querySelector('#detail-iso .iso-results').getBoundingClientRect().width}));
   evidence.layouts.push({viewport:width,...shape,...layout});assert.ok(layout.noOverflow);assert.deepEqual(shape.labelsOutside,[]);assert.deepEqual(layout.tableOverflow,[]);
   if([1440,390].includes(width))for(const [sel,name] of [['#detail-iso','iso-chart'],['#detail-iso .iso-results','iso-table'],['#detail-imtp','imtp'],['#detail-cmj','jumps'],['#lvp-upper','lvp'],['#detail-custom_change_direction','custom']])await shot(sel,name+'-'+width);
  }
  evidence.checks.push('five-width-readable-result-columns-and-unclipped-radar');
  if(screensOnly){evidence.pass=true;return;}
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(200);
  await check('best-mean-changes-results-with-identical-statistics',async()=>{
   const before=await page.locator('#detailContent .repeat-stat-value').allTextContents();
   for(const mode of ['mean','best']){await page.locator('#aggMode').selectOption(mode);await page.waitForTimeout(150);assert.deepEqual(await page.locator('#detailContent .repeat-stat-value').allTextContents(),before);assert.equal(await page.evaluate(()=>App.stats().values.cmj_height),mode==='best'?42:40);assert.doesNotMatch(await page.locator('#detailContent').innerText(),/最佳试次|试次均值|最佳试跳/);}
  });
  await check('isometric-nearby-add-fourth-edit-delete-undo-and-refresh',async()=>{
   await entry('iso');const row=page.locator('#entryContent table').first().locator('tbody tr').first();await row.getByRole('button',{name:/新增试次/}).click();assert.equal(await page.evaluate(()=>App.getState().data.iso[0].trials.length),4);
   await input('data.iso.0.trials.3.center',200);await report();assert.equal(await page.evaluate(()=>App.stats().repetitions.find(g=>g.directionId==='iso_neck_flexion').statistics[0].n),4);
   await entry('iso');await page.locator("button[onclick=\"App.removeRepeat('iso',3,0)\"]").click();await page.getByRole('button',{name:'撤销删除',exact:true}).click();assert.equal(await page.evaluate(()=>Number(App.getState().data.iso[0].trials[3].center)),200);
   await page.locator("button[onclick=\"App.removeRepeat('iso',3,0)\"]").click();await report();await page.reload();await page.waitForFunction(()=>window.App?.getState);assert.equal(await page.evaluate(()=>App.getState().data.iso[0].trials.length),3);
  });
  await check('IMTP-add-fourth-edit-delete-undo-and-refresh',async()=>{
   await entry('imtp');assert.equal(await page.locator('#entryContent .imtp-attempt').count(),3);await page.locator('#entryContent').getByRole('button',{name:'＋ 新增试次',exact:true}).first().click();await input('data.imtp.3.peakForce',2900);await report();assert.equal(await page.evaluate(()=>App.stats().repetitions.find(g=>g.testId==='imtp').statistics[0].n),4);
   await entry('imtp');await page.getByRole('button',{name:'删除试次 4',exact:true}).click();await page.getByRole('button',{name:'撤销删除',exact:true}).click();assert.equal(await page.evaluate(()=>Number(App.getState().data.imtp[3].peakForce)),2900);await page.getByRole('button',{name:'删除试次 4',exact:true}).click();await report();await page.reload();await page.waitForFunction(()=>window.App?.getState);assert.equal(await page.evaluate(()=>App.getState().data.imtp.length),3);
  });
  await check('raw-details-default-collapsed-and-do-not-stretch-chart',async()=>{
   assert.equal(await page.locator('#trials-iso').getAttribute('open'),null);const h=(await page.locator('#detail-iso svg').boundingBox()).height;await page.locator('#trials-iso summary').click();assert.equal((await page.locator('#detail-iso svg').boundingBox()).height,h);await page.locator('#trials-iso summary').click();
  });
  await check('updated-editable-demo-and-JSON-restored',async()=>{
   for(const [label,name] of [['保存当前可编辑 HTML 报告','Ringside_三次重复演示.html'],['导出当前报告 JSON','三次重复演示.json']]){await save();const wait=page.waitForEvent('download');await page.locator('#saveModal').getByRole('button',{name:label,exact:true}).click();const download=await wait,p=path.join(demo,name);await download.saveAs(p);evidence.downloads.push({path:path.relative(root,p),sha256:sha(p)});if(await page.locator('#saveModal').isVisible())await page.locator('#saveModal button.close').click();}
   const clean=await browser.newContext({offline:true}),p=await clean.newPage();await p.goto(pathToFileURL(path.join(demo,'Ringside_三次重复演示.html')).href);await p.waitForFunction(()=>window.App?.getState);assert.equal(await p.evaluate(()=>App.stats().repetitions.filter(g=>g.attempts.length===3).length),56);assert.equal(await p.locator('[data-repeat-stat]').count(),71);await clean.close();
  });
  await check('real-PDF-button-full-statistics-and-raw-appendix',async()=>{
   await page.evaluate(()=>{window.__columnPages=[];const render=html2canvas;window.html2canvas=async(n,o)=>{window.__columnPages.push({text:n.innerText,stats:n.querySelectorAll('[data-repeat-stat]').length,tables:[...n.querySelectorAll('table')].map(t=>({headers:t.tHead?.innerText,rows:t.tBodies[0]?.rows.length}))});return render(n,o);};});
   await save();const wait=Promise.race([page.waitForEvent('download',{timeout:180000}),page.waitForFunction(()=>RingsidePDF.lastDiagnostics?.status==='failed',null,{timeout:180000}).then(async()=>{throw Error((await page.evaluate(()=>RingsidePDF.lastDiagnostics)).error);})]);await page.locator('#pdfButton').click();const file=await wait,p=path.join(pdfOut,'repeat-columns.pdf');await file.saveAs(p);await page.waitForFunction(()=>!document.querySelector('#pdfButton').disabled);
   const data=await page.evaluate(()=>({diagnostics:RingsidePDF.lastDiagnostics,pages:__columnPages}));assert.equal(data.diagnostics.status,'complete');for(const key of ['missingRows','duplicateRows','changedRows','missingCharts','duplicateCharts'])assert.deepEqual(data.diagnostics[key],[]);assert.equal(data.pages.reduce((n,p)=>n+p.stats,0),71);const text=data.pages.map(p=>p.text).join('\n');assert.ok(text.includes('附录 · 原始试次'));assert.doesNotMatch(text,/力来源|有效次数 力\/RFD|试次统计|最佳试次|试次均值/);
   fs.writeFileSync(path.join(pdfOut,'columns-download-verification.json'),JSON.stringify({sourceHash:evidence.sourceHash,cases:[{id:'repeat-columns',pass:true,...data,pdfSha256:sha(p)}]},null,2));evidence.pdf={path:path.relative(root,p),sha256:sha(p),pages:data.pages.length};
  });
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.network,[]);evidence.pass=true;
 }catch(e){evidence.failure=e.stack;console.error(e.stack);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,screensOnly?'screens.json':'review.json'),JSON.stringify(evidence,null,2));await browser.close();console.log('RESULT '+evidence.pass);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
