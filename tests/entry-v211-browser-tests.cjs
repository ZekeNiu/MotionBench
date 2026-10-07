"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/v211-entry"),channel=process.argv.includes("--edge")?"msedge":"chrome";
fs.mkdirSync(out,{recursive:true});
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,synthetic:true,checks:[],errors:[],images:[],pass:false};
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-v211-"));let context,page,recordId;
 async function launch(){context=await chromium.launchPersistentContext(profile,{channel,headless:true,offline:true,viewport:{width:1440,height:1000},acceptDownloads:true});page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",error=>result.errors.push(error.message));page.on("dialog",dialog=>dialog.accept());await page.goto(pathToFileURL(file).href);assert.equal(await page.evaluate(()=>App.ready),true);}
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS",name);};
 const fill=async(p,value)=>{const control=page.locator(`[data-path="${p}"]`);if(!await control.isVisible()){await control.evaluate(el=>{for(let a=el.parentElement;a;a=a.parentElement)if(a.tagName==="DETAILS")a.open=true;});}await control.fill(String(value));};
 const shot=async(name)=>{const target=path.join(out,`${channel}-${name}.png`);await page.mouse.move(1400,0);await page.screenshot({path:target,fullPage:false});result.images.push({path:path.relative(root,target).replaceAll("\\","/"),sha256:createHash("sha256").update(fs.readFileSync(target)).digest("hex")});};
 try{
  await launch();
  await check("create assessment using new catalog tests without selecting derived formulas as actions",async()=>{
   await page.locator('[data-workspace-nav="entry"]').click();await page.locator('[name=creationAthleteMode][value=new]').check();await page.locator('#newAthleteName').fill('2.11验收模拟运动员');await page.locator('#newAthleteSport').fill('篮球');await page.locator('#creationNext').click();
   for(const id of ['cmj','sj','dj','hop','cmrj','imtp'])await page.locator(`[data-creation-project="${id}"]`).check();
   assert.equal(await page.locator('[data-creation-project="eur"]').count(),0);await page.locator('#creationMass').fill('80');await page.locator('#creationSubmit').click();await page.waitForFunction(()=>App.getUIState().mode==='entry');recordId=await page.evaluate(()=>App.getState().recordId);
  });
  await check("CMJ SJ and IMTP fields produce EUR fDSI and both iDSI variants",async()=>{
   await page.evaluate(()=>App.entry('cmj'));for(const [key,v]of Object.entries({height:42,force:1800,propulsiveImpulse:200,propulsiveDurationMs:300}))await fill('data.cmj.0.'+key,v);await page.locator('[data-path="dsi.confirmed"]').check();await page.locator('[data-path="impulseConfig.confirmed"]').check();
   await page.evaluate(()=>App.entry('sj'));await fill('data.sj.0.height',35);
   await page.evaluate(()=>App.entry('imtp'));for(const [key,v]of Object.entries({peakForce:3000,impulse250:300,matchedImpulse:400,matchedDurationMs:300}))await fill('data.imtp.0.'+key,v);await page.evaluate(()=>App.saveNow());
   const d=await page.evaluate(()=>({raw:App.stats().raw,derived:App.stats().derived}));assert.ok(Math.abs(d.raw.eur-1.2)<1e-10);assert.ok(Math.abs(d.raw.dsi-.6)<1e-10);assert.equal(d.derived.results.find(x=>x.id==='idsi_matched').value,.5);assert.ok(Math.abs(d.derived.results.find(x=>x.id==='idsi_fixed250').value-2/3)<1e-10);
   await fill('data.imtp.0.matchedDurationMs',250);assert.equal(await page.evaluate(()=>App.stats().derived.results.find(x=>x.id==='idsi_matched').value),null);await fill('data.imtp.0.matchedDurationMs',300);
  });
  await check("DJ and CMRJ entry distinguish first takeoff from rebound RSI",async()=>{
   await page.evaluate(()=>App.entry('dj'));for(const [key,v]of Object.entries({height:30,contactTimeMs:200,flightTimeMs:500,dropHeightCm:45}))await fill('data.dj.0.'+key,v);
   await page.evaluate(()=>App.entry('cmrj'));for(const [key,v]of Object.entries({firstHeight:40,firstTimeToTakeoffMs:800,height:20,contactTimeMs:180,flightTimeMs:400}))await fill('data.cmrj.0.'+key,v);
   const v=await page.evaluate(()=>App.stats().values);assert.equal(v.dj_rsi,1.5);assert.ok(Math.abs(v.cmrj_rsi-20/18)<1e-10);assert.equal(v.cmrj_first_rsi_modified,.5);
  });
  await check("Hop six entered jumps select highest five and retain inactive device summary",async()=>{
   await page.evaluate(()=>App.entry('hop'));await fill('data.hop.summary.rsi',4.2);await fill('data.hop.summary.height',99);await page.locator('[data-path="data.hop.inputMode"]').selectOption('jumps');await page.evaluate(()=>App.addHopJump(0,5));
   for(let i=0;i<6;i++){await fill(`data.hop.jumps.${i}.height`,10*(i+1));await fill(`data.hop.jumps.${i}.contactTimeMs`,200);await fill(`data.hop.jumps.${i}.flightTimeMs`,400+i*20);}
   await page.waitForTimeout(250);let s=await page.evaluate(()=>RingsideModel.hopSetSummary(App.getState().data.hop));assert.deepEqual(s.counts,{supplied:6,valid:6,selected:5});assert.equal(s.row.height,40);assert.equal(s.row.rsi,2);assert.equal(await page.locator('[data-hop-selected="0:0"]').innerText(),'—');assert.equal(await page.locator('[data-hop-selected="0:5"]').innerText(),'采用');await shot('hop-selected');
   await page.locator('[data-path="data.hop.inputMode"]').selectOption('summary');assert.equal(await page.locator('[data-path="data.hop.summary.rsi"]').inputValue(),'4.2');assert.equal(await page.evaluate(()=>App.stats().values.hop_rsi),4.2);await page.locator('[data-path="data.hop.inputMode"]').selectOption('jumps');assert.equal(await page.locator('[data-path="data.hop.jumps.5.height"]').inputValue(),'60');
   const repeats=await page.evaluate(()=>App.stats().repetitions.filter(r=>r.testId==='hop'));assert.ok(repeats.every(r=>Object.values(r.statistics).every(s=>s.n<=1)));
  });
  await check("Hop independent sets persist raw data and produce actual repeat statistics",async()=>{
   await page.evaluate(()=>App.addHopSet());for(const [key,v]of Object.entries({rsi:2.5,height:45,contactTimeMs:180}))await fill('data.hop.trials.1.summary.'+key,v);
   await page.evaluate(()=>App.addHopSet());for(const [key,v]of Object.entries({rsi:3,height:48,contactTimeMs:160}))await fill('data.hop.trials.2.summary.'+key,v);
   assert.equal(await page.evaluate(()=>App.getState().data.hop.trials[0].jumps.length),6);await page.evaluate(()=>App.changeMode('mean'));const value=await page.evaluate(()=>App.stats().values.hop_rsi);assert.equal(value,2.5);await page.evaluate(()=>App.saveNow());
  });
  await check("five height bars three RSI dots and shared derived facts",async()=>{
   await page.evaluate(()=>App.showReport());assert.equal(await page.locator('[data-jump-series="height"]').count(),5);assert.equal(await page.locator('[data-jump-series="rsi"]').count(),3);assert.match(await page.locator('#reportTitle').innerText(),/筛查报告$/);assert.equal(await page.locator('[data-derived-result="fdsi"]').count(),1);assert.match(await page.locator('[data-derived-result="fdsi"]').innerText(),/结合/);const facts=await page.evaluate(()=>App.facts());assert.equal(facts.derived.analysis.results.find(x=>x.id==='idsi_matched').value,.5);await shot('report');
  });
  await check("single HTML export and JSONL backup preserve new input modes and computations",async()=>{
   const payload=await page.evaluate(()=>App.libraryPayload());const record=payload.athletes.flatMap(a=>a.records).find(r=>r.recordId===recordId);assert.equal(record.data.hop.trials[0].jumps.length,6);assert.equal(record.data.hop.trials[0].summary.rsi,'4.2');
   const html=await page.evaluate(()=>App.exportHTMLString()),target=path.join(out,channel+'-assessment.html');fs.writeFileSync(target,html);const other=await chromium.launch({channel}),isolated=await other.newContext({offline:true}),opened=await isolated.newPage();await opened.goto(pathToFileURL(target).href);assert.equal(await opened.evaluate(()=>App.ready),true);assert.equal(await opened.evaluate(()=>App.getState().data.hop.trials.length),3);assert.equal(await opened.evaluate(()=>App.stats().values.hop_rsi),2.5);await other.close();
   await page.evaluate(()=>App.openManagement('backup'));const pending=page.waitForEvent('download');await page.evaluate(()=>App.downloadLibrary());const download=await pending,backup=path.join(out,channel+'-backup.motionbench.jsonl');await download.saveAs(backup);assert.ok(fs.readFileSync(backup,'utf8').includes('matchedDurationMs'));result.backup=path.relative(root,backup).replaceAll('\\','/');
   const restoreBrowser=await chromium.launch({channel}),restoreContext=await restoreBrowser.newContext({offline:true}),restored=await restoreContext.newPage();restored.on('dialog',d=>d.accept());await restored.goto(pathToFileURL(file).href);await restored.evaluate(()=>App.ready);await restored.evaluate(()=>App.openManagement('backup'));await restored.locator('#backupImportMode').selectOption('replace');await restored.locator('#importFile').setInputFiles(backup);await restored.waitForFunction(()=>App.getState()?.data?.hop?.trials?.length===3);assert.equal(await restored.evaluate(()=>App.stats().values.hop_rsi),2.5);assert.equal(await restored.evaluate(()=>App.stats().derived.results.find(x=>x.id==='idsi_matched').value),.5);assert.equal(await restored.evaluate(()=>App.getState().data.hop.trials[0].summary.rsi),'4.2');await restoreBrowser.close();result.backupRestored=true;
  });
  await check("browser process restart preserves all new measurements",async()=>{
   await context.close();context=null;await launch();assert.equal(await page.evaluate(()=>App.getState().recordId),recordId);assert.equal(await page.evaluate(()=>App.getState().data.hop.trials.length),3);assert.equal(await page.evaluate(()=>App.stats().derived.results.find(x=>x.id==='idsi_matched').value),.5);
  });
  await check("references without record dependency and entry responsive at desktop tablet phone",async()=>{
   await page.evaluate(()=>App.openSettings('references'));assert.equal(await page.locator('#settingsTitle').innerText(),'参考资料与方法');assert.doesNotMatch(await page.locator('#settingsContent').innerText(),/第22章表22\.2。原表空档/);assert.ok(await page.locator('#settingsContent a[href]').count()>=8);
   for(const [width,height]of [[1440,640],[900,900],[390,844]]){await page.setViewportSize({width,height});for(const tab of ['hop','cmrj','cmj','imtp']){await page.evaluate(t=>App.openEntry(t),tab);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${tab} width${width}`);}await shot('entry-'+width);await page.evaluate(()=>App.showReport());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
  });
  assert.deepEqual(result.errors,[]);result.pass=true;
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;if(page)await shot('failure').catch(()=>{});}
 finally{if(context)await context.close();fs.writeFileSync(path.join(out,channel+'-results.json'),JSON.stringify(result,null,2));}
})();
