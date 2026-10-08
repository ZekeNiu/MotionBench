"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createHash}=require('node:crypto'),{chromium}=require('./helpers/playwright.cjs');
const root=path.resolve(__dirname,'..'),file=path.join(root,'MotionBench.html'),out=path.join(root,'output/playwright/fvp');
const channel=process.argv.includes('--edge')?'msedge':'chrome',hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result={sourceHash:hash(file),channel,synthetic:true,checks:[],errors:[],network:[],images:[],layouts:[],pdfs:[],pass:false};
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel,headless:true});
 const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});page.on('dialog',d=>d.accept());
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log('PASS',name);};
 const ready=async()=>{await page.waitForFunction(()=>!!App.ready);assert.equal(await page.evaluate(()=>App.ready),true);};
 const input=key=>page.locator(`[data-path="${key}"]`);
 const recordCount=()=>page.evaluate(()=>App.getLibrary().athletes.reduce((n,a)=>n+a.records.length,0));
 const save=async()=>{assert.equal(await page.evaluate(()=>App.saveNow()),true);};
 const artifact=(p,extra={})=>({path:path.relative(root,p).replaceAll('\\','/'),sha256:hash(p),...extra});
 const shot=async(name,selector='#trainingAnalysisDetail')=>{
  if(await page.locator(selector).count())await page.locator(selector).evaluate(n=>scrollTo({top:scrollY+n.getBoundingClientRect().top-75,behavior:'instant'}));
  await page.mouse.move(0,0);await page.waitForTimeout(100);
  const p=path.join(out,`${channel}-${name}.png`);await page.screenshot({path:p});result.images.push(artifact(p));
 };
 const solved=()=>page.evaluate(()=>RingsideFVP.solve(App.getState(),App.getState().views.fvpProtocol||'fvp_sj'));
 const loadFixture=async({both=false,legacy=false,dense=false}={})=>page.evaluate(async opts=>{
  const r=opts.legacy?RingsideModel.sampleRecord():RingsideModel.defaults();
  r.recordId='fvp-acceptance-'+(opts.legacy?'legacy':'only');r.athleteId='fvp-acceptance-athlete';
  r.athlete.name='FVP 图表验收（模拟数据）';r.athlete.mass=72;
  if(!opts.legacy)for(const key of Object.keys(r.enabled))r.enabled[key]=false;
  for(const id of opts.both?['fvp_sj','fvp_cmj']:['fvp_sj']){
   r.enabled[id]=true;r.fvpConfig[id]={device:'跳垫验收',method:'腾空时间',posture:id==='fvp_sj'?'静止蹲深':'固定蹲深反向跳',distanceCm:33,distanceSource:'髋高差实测'};
   r.data[id]=[0,20,40,60,80].flatMap((load,i)=>Array.from({length:opts.dense?3:1},(_,j)=>({id:id+'-'+i+'-'+j,load,height:[33,27,22,14,10][i]+(id==='fvp_cmj'?2:0)-j*.2,distanceCm:'',notes:'负荷试次 '+i+'-'+j,excluded:false,exclusionReason:''})));
  }
  if(opts.both){r.fvpAnalysis.fvp_cmj.angle=30;r.fvpView.fvp_cmj.pv=false;}
  r.views.fvpProtocol='fvp_sj';await App.importPayload(RingsideModel.recordEnvelope(r));await App.showReport();return r.recordId;
 },{both,legacy,dense});
 async function pdf(name,{snapshotRace=false}={}){
  await page.evaluate(()=>{
   window.__fvpPages=[];window.__fvpCanvas=window.html2canvas;
   window.html2canvas=async(node,options)=>{
    const content=node.querySelector('.ringside-pdf-content'),bounds=content.getBoundingClientRect();
    window.__fvpPages.push({text:node.innerText,charts:[...node.querySelectorAll('[data-chart-kind]')].map(n=>({kind:n.dataset.chartKind,svg:n.querySelectorAll('svg').length})),rows:[...node.querySelectorAll('tr[data-row-id]')].map(n=>n.dataset.rowId),overflow:[...content.children].filter(n=>n.getBoundingClientRect().bottom>bounds.bottom+.7).map(n=>n.className)});
    return window.__fvpCanvas(node,options);
   };
  });
  const before=await page.evaluate(()=>JSON.stringify(App.getState()));
  await page.locator('#reportExportMenu').evaluate(n=>n.open=true);
  const pending=page.waitForEvent('download',{timeout:180000});
  await page.locator('#reportExportMenu').getByRole('button',{name:'报告 PDF',exact:true}).click();
  if(snapshotRace)await page.evaluate(()=>{App.getState().fvpAnalysis.fvp_cmj.angle=90;App.getState().fvpAnalysis.fvp_cmj.deltaForcePct=25;});
  const download=await pending,p=path.join(out,`${channel}-${name}.pdf`);assert.equal(await download.failure(),null);await download.saveAs(p);
  const captured=await page.evaluate(()=>({diagnostics:RingsidePDF.lastDiagnostics,pages:window.__fvpPages,state:JSON.stringify(App.getState())}));
  assert.equal(captured.diagnostics.status,'complete');
  for(const key of ['missingRows','duplicateRows','changedRows','missingCharts','duplicateCharts'])assert.deepEqual(captured.diagnostics[key],[],key);
  assert.ok(captured.pages.every(p=>!p.overflow.length));assert.ok(fs.statSync(p).size>15000);
  if(!snapshotRace)assert.equal(captured.state,before);
  result.pdfs.push(artifact(p,{name,diagnostics:captured.diagnostics,pages:captured.pages}));
  await page.evaluate(()=>{window.html2canvas=window.__fvpCanvas;});return captured;
 }
 try{
  await page.goto(pathToFileURL(file).href);await ready();
  await check('new SJ and CMJ protocols are selectable while historical records leave them disabled',async()=>{
   const data=await page.evaluate(()=>{const d=RingsideModel.defaults();return{tests:RingsideTests.describe(d).filter(t=>t.id.startsWith('fvp_')).map(t=>t.id),enabled:[d.enabled.fvp_sj,d.enabled.fvp_cmj]};});
   assert.deepEqual(data.tests,['fvp_sj','fvp_cmj']);assert.deepEqual(data.enabled,[false,false]);
  });
  let people;
  await check('single and multi-athlete entry share native FVP projects and stable pending record IDs',async()=>{
   people=await page.evaluate(async()=>[await App.createAthlete('FVP 手动甲（模拟）'),await App.createAthlete('FVP 手动乙（模拟）')]);
   await page.evaluate(()=>App.startDataEntry());
   for(const id of people)await page.locator(`[data-creation-athlete="${id}"]`).check();
   await page.locator('#creationNext').click();
   await page.locator('[data-picker-project="fvp_sj"]').check();await page.locator('[data-picker-project="fvp_cmj"]').check();
   await page.locator('#creationSubmit').click();await page.waitForFunction(()=>App.getUIState().mode==='entry');
   assert.equal(await recordCount(),0);await page.evaluate(()=>App.entry('fvp_sj'));
  });
  await check('protocol-only edits, blank loads and template download do not create empty records',async()=>{
   await input('fvpConfig.fvp_sj.device').fill('手动跳垫');await input('fvpConfig.fvp_sj.method').fill('腾空时间');
   await input('fvpConfig.fvp_sj.distanceCm').fill('33');await input('fvpConfig.fvp_sj.distanceSource').fill('髋高差实测');
   if(!await input('data.fvp_sj.0.load').count())await page.evaluate(()=>App.addRow('fvp_sj'));
   await input('data.fvp_sj.0.load').fill('0');await save();assert.equal(await recordCount(),0);
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Excel 模板',exact:true}).click();const d=await pending;await d.saveAs(path.join(out,channel+'-entry-template.xlsx'));assert.equal(await recordCount(),0);
  });
  await check('manual load and complete-trial entry compute only after three distinct valid loads',async()=>{
   await page.evaluate(()=>App.entry('athlete'));await input('athlete.mass').fill('72');await page.evaluate(()=>App.entry('fvp_sj'));
   await input('data.fvp_sj.0.height').fill('33');await save();assert.equal(await recordCount(),1);
   for(let i=1;i<5;i++){if(!await input(`data.fvp_sj.${i}.load`).count())await page.evaluate(()=>App.addRow('fvp_sj'));await input(`data.fvp_sj.${i}.load`).fill(String(i*20));await input(`data.fvp_sj.${i}.height`).fill(String([33,27,22,14,10][i]));if(i===1)assert.equal(await page.evaluate(()=>RingsideFVP.solve(App.getState(),'fvp_sj').valid),false);}
   await save();assert.equal(await page.evaluate(()=>RingsideFVP.solve(App.getState(),'fvp_sj').valid),true);
   assert.match(await page.locator('[data-fvp-entry-feedback="fvp_sj"]').innerText(),/力量端/);
  });
  await check('trial exclusions retain reasons and per-trial distance overrides the common value',async()=>{
   await page.evaluate(()=>App.addRow('fvp_sj',0));await input('data.fvp_sj.5.height').fill('34');await input('data.fvp_sj.5.distanceCm').fill('34');
   await input('data.fvp_sj.5.excluded').check();await input('data.fvp_sj.5.exclusionReason').fill('未保持起始姿势');await save();
   assert.equal(await page.evaluate(()=>App.getState().data.fvp_sj[5].exclusionReason),'未保持起始姿势');
   await input('data.fvp_sj.5.excluded').uncheck();await save();assert.equal(await page.evaluate(()=>App.getState().data.fvp_sj[5].distanceCm),'34');
   await page.evaluate(()=>App.showReport());
  });
  await loadFixture({both:true});
  await check('FVP-only record renders FVP then response before older capability cards',async()=>{
   assert.equal(await page.locator('#trainingAnalysisDetail').count(),1);
   const kinds=await page.locator('#trainingAnalysisDetail [data-chart-kind]').evaluateAll(ns=>ns.map(n=>n.dataset.chartKind));
   assert.ok(kinds[0].toLowerCase().includes('fvp'));assert.ok(kinds.length>=2);
   assert.match(await page.locator('#trainingAnalysisDetail').innerText(),/Imbalance.*25\.86%.*力量端/s);
  });
  await check('90° and 30° switch only selected optimum and imbalance while vertical response stays identical',async()=>{
   const before=await solved();await page.locator('[data-fvp-angle]').selectOption('30');const after=await solved();
   assert.match(await page.locator('#trainingAnalysisDetail').innerText(),/7\.22%/);
   assert.deepEqual(after.model,before.model);assert.deepEqual(after.elasticity,before.elasticity);
   assert.doesNotMatch(await page.locator('#trainingAnalysisDetail').innerText(),/切回垂直|平缓.*%|F₀略低|V₀略高/);
  });
  await check('view controls are independent and preserve the analysis fingerprint',async()=>{
   const basis=await page.evaluate(()=>App.recordBasis());
   for(const fv of [false,true])for(const pv of [false,true]){
    await page.locator('[data-fvp-view="fv"]').setChecked(fv);await page.locator('[data-fvp-view="pv"]').setChecked(pv);
    if(!fv&&!pv)assert.match(await page.locator('#trainingAnalysisDetail').innerText(),/选择.*曲线/);
    assert.equal(await page.evaluate(()=>App.recordBasis()),basis);
   }
   for(const key of ['points','optimum','comparison','confidence']){await page.locator(`[data-fvp-view="${key}"]`).uncheck();await page.locator(`[data-fvp-view="${key}"]`).check();}
   await page.locator('[data-fvp-view="range"]').selectOption('measured');await page.locator('[data-fvp-view="range"]').selectOption('full');
   assert.equal(await page.evaluate(()=>App.recordBasis()),basis);
  });
  await check('load points and table rows link hover, keyboard pin, resize and Escape',async()=>{
   const point=page.locator('.viz-point[data-fvp-load="20"]').first();await point.hover();
   assert.ok(await page.locator('[data-fvp-load="20"].is-fvp-highlighted').count()>0);
   await point.focus();await point.press('Enter');assert.equal(await page.evaluate(()=>App.getState().fvpView.fvp_sj.pinnedLoad),20);
   await page.setViewportSize({width:1280,height:1000});await page.waitForTimeout(180);
   assert.ok(await page.locator('[data-fvp-load="20"].is-fvp-pinned').count()>0);
   await page.locator('.viz-point[data-fvp-load="20"]').first().focus();await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>App.getState().fvpView.fvp_sj.pinnedLoad),null);
   if(!await page.locator('.fvp-load-details').evaluate(n=>n.open))await page.locator('.fvp-load-details summary').click();
   const row=page.locator('.fvp-load-table tr[data-fvp-load="40"]');await row.click();
   assert.equal(await page.evaluate(()=>App.getState().fvpView.fvp_sj.pinnedLoad),40);
   await save();await page.setViewportSize({width:1440,height:1000});
  });
  await check('touch tapping a point pins the same measured load',async()=>{
   const touch=await browser.newContext({offline:true,hasTouch:true,isMobile:true,viewport:{width:390,height:844}}),touchPage=await touch.newPage();
   touchPage.on('pageerror',e=>result.errors.push(e.message));await touchPage.goto(pathToFileURL(file).href);await touchPage.evaluate(()=>App.ready);
   const record=await page.evaluate(()=>RingsideModel.recordEnvelope(App.getState()));await touchPage.evaluate(async r=>{await App.importPayload(r);await App.showReport();},record);
   await touchPage.locator('.viz-point[data-fvp-load="60"]').first().tap();
   assert.equal(await touchPage.evaluate(()=>App.getState().fvpView.fvp_sj.pinnedLoad),60);await touch.close();
  });
  await check('scenario input previews immediately and commits only on submit, updating analysis basis',async()=>{
   const basis=await page.evaluate(()=>App.recordBasis());
   const f=page.locator('[data-fvp-scenario="deltaForcePct"]');await f.fill('5');
   assert.equal(await page.evaluate(()=>App.getState().fvpAnalysis.fvp_sj.deltaForcePct),0);assert.equal(await page.evaluate(()=>App.recordBasis()),basis);
   assert.equal(await f.inputValue(),'5');assert.match(await page.locator('#trainingAnalysisDetail').innerText(),/情景|预测高度/);
   await page.locator('[data-fvp-scenario-form] button[type="submit"]').click();
   assert.equal(await page.evaluate(()=>App.getState().fvpAnalysis.fvp_sj.deltaForcePct),5);assert.notEqual(await page.evaluate(()=>App.recordBasis()),basis);
   await page.locator('[data-fvp-shortcut="velocity"]').click();assert.equal(await page.evaluate(()=>App.getState().fvpAnalysis.fvp_sj.deltaForcePct),0);assert.equal(await page.evaluate(()=>App.getState().fvpAnalysis.fvp_sj.deltaVelocityPct),5);
   await page.locator('[data-fvp-shortcut="both"]').click();assert.equal(await page.evaluate(()=>App.getState().fvpAnalysis.fvp_sj.deltaForcePct),5);
   await page.locator('[data-fvp-scenario="deltaForcePct"]').fill('-5');await page.locator('[data-fvp-scenario-form]').evaluate(n=>n.requestSubmit());await save();
  });
  await check('protocol switch keeps each target, scenario and plot preference independent after reload',async()=>{
   await page.locator('[data-fvp-protocol]').selectOption('fvp_cmj');assert.equal(await page.locator('[data-fvp-angle]').inputValue(),'30');assert.equal(await page.locator('[data-fvp-view="pv"]').isChecked(),false);
   await page.locator('[data-fvp-shortcut="force"]').click();await save();await page.reload();await ready();await page.evaluate(()=>App.showReport());
   assert.equal(await page.locator('[data-fvp-protocol]').inputValue(),'fvp_cmj');assert.equal(await page.locator('[data-fvp-scenario="deltaForcePct"]').inputValue(),'5');
   await page.locator('[data-fvp-protocol]').selectOption('fvp_sj');assert.equal(await page.locator('[data-fvp-scenario="deltaForcePct"]').inputValue(),'-5');
  });
  await check('AI facts use the same selected target, scenario and raw trials as the report',async()=>{
   const values=await page.evaluate(()=>({facts:App.facts().jumpFVP,stats:App.stats().fvp}));assert.deepEqual(values.facts,JSON.parse(JSON.stringify(values.stats)));
   assert.ok(values.facts.fvp_sj.valid);assert.ok(values.facts.fvp_cmj.valid);
  });
  await check('responsive chart/table panels preserve axes and avoid document overflow',async()=>{
   for(const width of [1440,1280,900,390]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(180);
    const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,svgs:[...document.querySelectorAll('#trainingAnalysisDetail svg')].map(s=>({width:s.getBoundingClientRect().width,height:s.getBoundingClientRect().height,text:s.textContent}))}));
    assert.equal(geometry.overflow,false);assert.ok(geometry.svgs.every(s=>s.width>100&&s.height>100));result.layouts.push(geometry);await shot('layout-'+width);
   }
   await page.setViewportSize({width:1440,height:1000});
  });
  await check('actual PDF expands SJ and CMJ with their saved target and visible curves',async()=>{
   const captured=await pdf('both-protocols');const text=captured.pages.map(p=>p.text).join('\n');
   assert.match(text,/SJ/);assert.match(text,/CMJ/);assert.match(text,/90°|30°/);assert.match(text,/垂直跳表现响应/);
   assert.ok(captured.pages.flatMap(p=>p.charts).filter(c=>c.kind.toLowerCase().includes('fvp')).length>=2);
  });
  await check('PDF keeps the export snapshot when source assumptions change during rendering',async()=>{
   const captured=await pdf('snapshot-race',{snapshotRace:true});assert.match(captured.pages.map(p=>p.text).join('\n'),/30°/);
  });
  await loadFixture({both:true,legacy:true,dense:true});
  await check('existing four cards, radars and manual narrative coexist with FVP without lost data',async()=>{
   assert.equal(await page.locator('[data-capability-card]').count(),4);assert.equal(await page.locator('#radarChart svg').count(),1);
   const before=await page.evaluate(()=>({text:App.getState().narrative.text,metrics:App.stats().capabilityCards.flatMap(c=>c.metrics.map(m=>m.id))}));
   const dom=await page.locator('[data-capability-metric]').evaluateAll(ns=>ns.map(n=>n.dataset.capabilityMetric));assert.deepEqual(dom,before.metrics);
   assert.equal(await page.evaluate(()=>App.getState().narrative.text),before.text);await shot('complete-report');
   await pdf('complete-report');
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;await shot('failure').catch(()=>{});}
 finally{result.sourceUnchanged=hash(file)===result.sourceHash;if(!result.sourceUnchanged){result.pass=false;process.exitCode=1;}fs.writeFileSync(path.join(out,channel+'-results.json'),JSON.stringify(result,null,2));await context.close();await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
