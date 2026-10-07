"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto");
const {chromium}=require("./helpers/playwright.cjs"),root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),channel=process.argv.includes("--edge")?"msedge":"chrome",out=path.join(root,"output/playwright/v211");
fs.mkdirSync(out,{recursive:true});
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,checks:[],errors:[],layouts:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce",acceptDownloads:true}),page=await context.newPage();
 page.on("pageerror",error=>result.errors.push(error.message));page.on("dialog",dialog=>dialog.accept());page.setDefaultTimeout(15000);
 const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS",name);};
 try{
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>App.ready);
  await page.evaluate(async()=>{
   const r=RingsideModel.sampleRecord();r.athlete.name="跳跃与训练方向验收";r.mode="best";
   r.enabled=Object.fromEntries(Object.keys(r.enabled).map(id=>[id,["cmj","sj","dj","hop","cmrj","imtp"].includes(id)]));
   r.data.dj=[{id:"dj-check",height:30,contactTimeMs:150,flightTimeMs:495,dropHeightCm:30,notes:"DJ原始备注",metrics:{}}];
   r.data.cmrj=[{id:"cmrj-check",firstHeight:30,firstTimeToTakeoffMs:300,height:25,contactTimeMs:125,flightTimeMs:450,notes:"CMRJ原始备注",metrics:{}}];
   r.data.hop={inputMode:"jumps",summary:{height:99,rsi:9,selectionBasis:"unknown"},jumps:[10,20,30,40,50,60].map((height,i)=>({id:"hop-"+i,height,contactTimeMs:100,flightTimeMs:300+i*20,notes:i===0?"保留未选跳次":""})),notes:"Hop整组备注"};
   await App.importPayload(RingsideModel.recordEnvelope(r));App.showReport();
  });
  await check("sidebar order and category labels share the same left edge",async()=>{
   const actual=await page.evaluate(()=>{const n=document.querySelector("#globalNav"),buttons=[...n.querySelectorAll("[data-workspace-nav]")].map(el=>el.dataset.workspaceNav);return{buttons,offsets:[...n.querySelectorAll(".nav-label")].map(label=>{const b=label.nextElementSibling;return(label.getBoundingClientRect().x+parseFloat(getComputedStyle(label).paddingLeft))-(b.getBoundingClientRect().x+parseFloat(getComputedStyle(b).paddingLeft));})};});
   assert.ok(actual.buttons.indexOf("teams")<actual.buttons.indexOf("athletes"));assert.ok(actual.offsets.every(offset=>Math.abs(offset)<1));
  });
  await check("search debounce preserves an open native dropdown and full options",async()=>{
   await page.evaluate(()=>App.openManagement("athletes"));
   await page.evaluate(()=>{const q=document.querySelector('[data-manager-filter="q"]');q.value="";q.dispatchEvent(new Event("input",{bubbles:true}));window.__select=document.querySelector('[data-manager-filter="status"]');__select.focus();});
   await page.keyboard.press("Alt+ArrowDown");assert.equal(await page.locator('[data-manager-filter="status"]').evaluate(el=>el.matches(":open")),true);await page.waitForTimeout(250);
   const after=await page.evaluate(()=>({same:__select.isConnected,open:__select.matches(":open"),count:__select.options.length}));assert.deepEqual(after,{same:true,open:true,count:4});
   await page.keyboard.press("Escape");await page.keyboard.press("ArrowDown");assert.equal(await page.locator('[data-manager-filter="status"]').inputValue(),"archived");await page.keyboard.press("ArrowDown");assert.equal(await page.locator('[data-manager-filter="status"]').inputValue(),"trash");assert.equal(await page.evaluate(()=>__select.isConnected),true);
  });
  await check("derived library is separate from physical test projects and retains toggles",async()=>{
   await page.evaluate(()=>App.openManagement("metrics"));await page.locator('[data-manager-filter="ability"]').selectOption("training-analysis");
   assert.equal(await page.locator('[data-metric-ability="training-analysis"]').count(),1);assert.equal(await page.locator('[data-metric-project]').count(),0);
   assert.ok(await page.locator('[data-derived-definition]').count()>=8);assert.equal(await page.locator('[data-metric-ability="training-analysis"] table.metric-library-table').count(),1);assert.doesNotMatch(await page.locator('[data-metric-ability="training-analysis"]').innerText(),/跳高/);await page.locator('[data-manager-action="derived-toggle"][data-id="eur"]').click();assert.equal(await page.evaluate(()=>App.getLibrary().catalog.derivedEnabled.eur),false);await page.locator('[data-manager-action="derived-toggle"][data-id="eur"]').click();assert.equal(await page.evaluate(()=>App.getLibrary().catalog.derivedEnabled.eur),true);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,channel+'-derived-library.png')});await page.setViewportSize({width:1440,height:1000});
  });
  await check("leaving a search input does not replace a result button during its click",async()=>{
   await page.evaluate(()=>App.openManagement("records"));await page.locator('[data-manager-filter="q"]').fill("跳跃与训练方向验收");await page.waitForTimeout(180);
   await page.locator('[data-manager-action="entry"]').first().click();await page.waitForFunction(()=>App.getUIState().mode==="entry");await page.evaluate(()=>App.showReport());
  });
  await page.evaluate(()=>App.showReport());
  await check("all five jump heights and three RSI dots match the same report values",async()=>{
   assert.equal(await page.locator('[data-jump-series="height"]').count(),5);assert.equal(await page.locator('[data-jump-series="rsi"]').count(),3);
   const values=await page.evaluate(()=>({hop:App.stats().raw.hop.row,dj:App.stats().values.dj_rsi,cmrj:App.stats().values.cmrj_rsi,diagnostics:RingsideReport.build(App.getState()).diagnostics}));
   assert.equal(values.hop.height,40);assert.equal(values.hop.rsi,4);assert.equal(values.dj,2);assert.equal(values.cmrj,2);assert.deepEqual(values.diagnostics,[]);
   assert.match(await page.locator('[data-metric-id="hop_rsi"]').first().textContent(),/4\.00/);assert.match(await page.locator('#trials-hop').textContent(),/录入 6 跳 · 有效 6 跳 · 选取 5 跳/);assert.match(await page.locator('#trials-hop').textContent(),/保留未选跳次/);
   assert.equal(await page.locator('#trainingAnalysisDetail [data-derived-result="eur"]').count(),1);assert.equal(await page.locator('.jump-detail .detail-data tbody tr').count(),8);assert.doesNotMatch(await page.locator('.jump-detail .detail-data').innerText(),/触地时间|腾空时间|推进期冲量|首跳/);
   assert.doesNotMatch(await page.locator('#trainingAnalysisDetail').innerText(),/跳高|待补充分析|结合.*分析/);assert.equal(await page.locator('#trainingAnalysisDetail .note,#trainingAnalysisDetail small,#trainingAnalysisDetail a').count(),0);
  });
  await check("charts use one tooltip mechanism with accessible labels after sustained hover",async()=>{
   assert.equal(await page.locator('#reportView svg title').count(),0);
   const point=page.locator('[data-jump-series="rsi"]').first();await point.hover();await page.waitForTimeout(1400);assert.equal(await page.locator('#tooltip').isVisible(),true);assert.match(await page.locator('#tooltip').innerText(),/RSI/);assert.ok(await point.getAttribute("aria-label"));
   await page.keyboard.press("Escape");assert.equal(await page.locator('#tooltip').isVisible(),false);await point.focus();assert.equal(await page.locator('#tooltip').isVisible(),true);await page.keyboard.press("Escape");
  });
  await check("jump report and derived cards fit desktop and mobile",async()=>{
   await page.locator('#toast').waitFor({state:"hidden"});await page.locator('body').click({position:{x:380,y:70}});
   for(const width of [1440,900,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(120);const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,jumpSmallestFont:Math.min(...[...document.querySelectorAll('.jump-detail svg text')].map(node=>parseFloat(getComputedStyle(node).fontSize)*node.getScreenCTM().a))}));assert.equal(geometry.overflow,false);assert.ok(geometry.jumpSmallestFont>=9.5,JSON.stringify(geometry));if(width===1440){const alignment=await page.evaluate(()=>{const pair=document.querySelector('.jump-detail'),chart=pair.querySelector('.chart-wrap').getBoundingClientRect(),data=pair.querySelector('.detail-data').getBoundingClientRect(),imtp=document.querySelector('.imtp-detail .detail-data').getBoundingClientRect();return{sideBySide:data.left>=chart.right,topDifference:Math.abs(chart.top-data.top),tableLeftDifference:Math.abs(data.left-imtp.left)};});assert.ok(alignment.sideBySide);assert.ok(alignment.topDifference<1);assert.ok(alignment.tableLeftDifference<1);geometry.alignment=alignment;}result.layouts.push(geometry);await page.locator('.jump-detail').screenshot({path:path.join(out,channel+"-jumps-"+width+".png")});await page.locator('#trainingAnalysisDetail').screenshot({path:path.join(out,channel+"-derived-"+width+".png")});}
  });
  await check("reload preserves raw Hop source values and derived defaults",async()=>{
   await page.locator('[aria-label="iDSI 时间窗口"]').selectOption('idsi_fixed250');await page.evaluate(()=>App.saveNow());await page.reload();await page.waitForFunction(()=>App.ready);assert.equal(await page.evaluate(()=>App.getState().data.hop.summary.height),99);assert.equal(await page.evaluate(()=>App.getState().data.hop.jumps.length),6);assert.equal(await page.evaluate(()=>App.getLibrary().catalog.derivedEnabled.eur),true);assert.equal(await page.locator('[aria-label="iDSI 时间窗口"]').inputValue(),'idsi_fixed250');await page.locator('[aria-label="iDSI 时间窗口"]').selectOption('idsi_matched');
  });
  if(process.argv.includes("--pdf"))await check("actual PDF includes all jump values and derived cards without clipping or state changes",async()=>{
   await page.setViewportSize({width:1440,height:1000});await page.evaluate(async()=>{const r=App.getState();r.data.hop.jumps=Array.from({length:42},(_,i)=>({id:"long-hop-"+i,height:20+i/4,contactTimeMs:150,flightTimeMs:380+i,notes:"长原始记录第"+(i+1)+"跳：保留所有已选与未选测量"}));r.data.cmj.forEach(row=>Object.assign(row,{propulsiveImpulse:200,propulsiveDurationMs:300}));r.data.imtp.forEach(row=>Object.assign(row,{impulse250:300,matchedImpulse:400,matchedDurationMs:300}));r.dsi.confirmed=true;r.impulseConfig.confirmed=true;await App.saveNow();App.renderReport();window.__pdfPages=[];const original=html2canvas;window.html2canvas=async(node,options)=>{const body=node.querySelector('.ringside-pdf-content'),rect=body.getBoundingClientRect();__pdfPages.push({text:body.textContent,jumpPairs:[...body.querySelectorAll('.jump-detail')].map(pair=>{const chart=pair.firstElementChild.getBoundingClientRect(),data=pair.lastElementChild.getBoundingClientRect();return{chartRight:chart.right,dataLeft:data.left,dataWidth:data.width,sideBySide:data.left>=chart.right};}),overflow:[...body.children].filter(child=>child.getBoundingClientRect().bottom>rect.bottom+.75).map(child=>child.className)});return original(node,options);};});
   assert.equal(await page.locator('[data-derived-result="idsi_matched"]').count(),1);assert.equal(await page.locator('[data-derived-result="idsi_fixed250"]').count(),0);await page.locator('[aria-label="iDSI 时间窗口"]').selectOption('idsi_fixed250');assert.equal(await page.locator('[data-derived-result="idsi_fixed250"]').count(),1);await page.locator('[aria-label="iDSI 时间窗口"]').selectOption('idsi_matched');
   const before=await page.evaluate(()=>JSON.stringify(App.getState()));const pending=page.waitForEvent("download",{timeout:180000});await page.evaluate(()=>App.downloadPDF());const download=await pending;await download.saveAs(path.join(out,channel+"-report.pdf"));await page.waitForFunction(()=>RingsidePDF.lastDiagnostics?.status==="complete");
   const after=await page.evaluate(()=>({record:JSON.stringify(App.getState()),pages:__pdfPages,diagnostics:RingsidePDF.lastDiagnostics}));assert.equal(after.record,before);assert.ok(after.pages.every(p=>p.overflow.length===0));const pairs=after.pages.flatMap(p=>p.jumpPairs);assert.ok(pairs.length>=1);assert.ok(pairs.every(p=>p.sideBySide&&Math.abs(p.dataLeft-pairs[0].dataLeft)<1&&Math.abs(p.dataWidth-pairs[0].dataWidth)<1));for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(after.diagnostics[key],[]);const allText=after.pages.map(p=>p.text).join("\n");assert.match(allText,/训练方向分析/);assert.match(allText,/长原始记录第42跳/);assert.match(allText,/iDSI/);result.pdf=after;
  });
  assert.deepEqual(result.errors,[]);result.pass=true;
 }catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;await page.screenshot({path:path.join(out,channel+"-failure.png"),fullPage:true}).catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,channel+"-interaction.json"),JSON.stringify(result,null,2));await context.close();await browser.close();}
})();
