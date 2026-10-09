"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/v212-entry"),channel=process.argv.includes("--edge")?"msedge":"chrome";
fs.mkdirSync(out,{recursive:true});
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,synthetic:true,checks:[],errors:[],images:[],pass:false};
function originalDemo() {
 const vm=require("node:vm"),{execFileSync}=require("node:child_process"),old=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});old.window=old;
 for(const name of ["calc","definitions","tests","model","interventions"])vm.runInContext(execFileSync("git",["show",`v2.11.0:src/ringside-${name}.js`],{cwd:root,encoding:"utf8"}),old);
 return JSON.parse(JSON.stringify(old.RingsideModel.sampleRecord()));
}
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-v212-"));let context,page,recordId;
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS",name);};
 const fill=async(p,value)=>{const el=page.locator(`[data-path="${p}"]`);await el.fill(String(value));};
 async function launch(){context=await chromium.launchPersistentContext(profile,{channel,headless:true,offline:true,viewport:{width:1440,height:1000},acceptDownloads:true});page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",e=>result.errors.push(e.message));page.on("dialog",d=>d.accept());await page.goto(pathToFileURL(file).href);assert.equal(await page.evaluate(()=>App.ready),true);}
 async function shot(name){const target=path.join(out,`${channel}-${name}.png`);await page.screenshot({path:target,fullPage:false});result.images.push({path:path.relative(root,target),sha256:createHash("sha256").update(fs.readFileSync(target)).digest("hex")});}
 try{
  await launch();
  await check("native CPET can be selected when creating a real assessment",async()=>{
   await page.locator('[data-workspace-nav="entry"]').click();await page.locator('[name=creationAthleteMode][value=new]').check();await page.locator('#newAthleteName').fill('2.12模拟验收');await page.locator('#newAthleteSport').fill('田径');await page.locator('#creationNext').click();
   for(const id of ['cpet','cmj','imtp','dj','hop'])await page.locator(`[data-creation-project="${id}"]`).check();await page.locator('#creationMass').fill('70');await page.locator('#creationSubmit').click();await page.waitForFunction(()=>App.getUIState().mode==='entry');recordId=await page.evaluate(()=>App.getState().recordId);
   await page.evaluate(()=>App.openEntry('athlete'));await fill('athlete.age',25);await page.locator('[data-path="athlete.sex"]').selectOption('男');
  });
  await check("CPET real entry uses same-test oxygen ratios and physical unit conversion",async()=>{
   await page.evaluate(()=>App.openEntry('cpet'));await page.locator('[data-path="data.cpet.modality"]').selectOption('treadmill');await page.locator('[data-path="data.cpet.oxygenLabel"]').selectOption('VO2peak');
   for(const [key,value]of Object.entries({vo2:45.4,rer:1.15,peakHr:190}))await fill('data.cpet.'+key,value);
   for(const [key,value]of Object.entries({vo2:27.24,hr:145}))await fill('data.cpet.thresholds.first.'+key,value);
   for(const [key,value]of Object.entries({vo2:36.32,hr:172}))await fill('data.cpet.thresholds.second.'+key,value);
   let values=await page.evaluate(()=>App.stats().values);assert.ok(Math.abs(values.cpet_threshold2_pct-80)<1e-9);assert.equal(values.cpet_vo2_relative,45.4);
   await page.locator('[data-path="data.cpet.vo2Unit"]').selectOption('l/min');assert.ok(Math.abs(Number(await page.locator('[data-path="data.cpet.vo2"]').inputValue())-3.178)<1e-9);assert.ok(Math.abs((await page.evaluate(()=>App.stats().values.cpet_vo2_relative))-45.4)<1e-9);
   await page.locator('[data-path="data.cpet.vo2Unit"]').selectOption('ml/kg/min');await page.evaluate(()=>App.saveNow());
   await page.evaluate(()=>App.showReport());assert.match(await page.locator('[data-capability-card="cardio"]').innerText(),/VO₂peak|VO2peak/);assert.doesNotMatch(await page.locator('[data-capability-card="cardio"]').innerText(),/优先提升/);await shot('cardio');
  });
  await check("CMJ propulsion fields are visible and IMTP names the exact window without overwriting measurements",async()=>{
   await page.evaluate(()=>App.openEntry('cmj'));for(const [key,value]of Object.entries({height:40,force:1800,propulsiveImpulse:400,propulsiveDurationMs:300}))await fill('data.cmj.0.'+key,value);
   assert.equal(await page.locator('[data-path="data.cmj.0.propulsiveDurationMs"]').evaluate(el=>!!el.closest('details:not([open])')),false);
   await page.evaluate(()=>App.openEntry('imtp'));assert.match(await page.locator('[data-cmj-window]').innerText(),/0–300/);
   await page.locator('details.supplement').filter({has:page.locator('[data-path="data.imtp.0.matchedImpulse"]')}).evaluate(el=>el.open=true);
   await fill('data.imtp.0.matchedImpulse',600);await fill('data.imtp.0.matchedDurationMs',300);
   await page.evaluate(()=>App.openEntry('cmj'));await fill('data.cmj.0.propulsiveDurationMs',280);await page.evaluate(()=>App.openEntry('imtp'));
   assert.match(await page.locator('[data-cmj-window]').innerText(),/0–280/);assert.equal(await page.locator('[data-path="data.imtp.0.matchedDurationMs"]').inputValue(),'300');assert.equal(await page.locator('[data-path="data.imtp.0.matchedImpulse"]').inputValue(),'600');
  });
  await check("device stiffness is converted once and Hop stores one device value per complete test",async()=>{
   await page.evaluate(()=>App.openEntry('dj'));for(const [key,value]of Object.entries({height:30,contactTimeMs:200}))await fill('data.dj.0.'+key,value);
   await page.locator('[data-path="data.dj.0.activeStiffnessInputUnit"]').selectOption('N/m');await fill('data.dj.0.activeStiffness',32000);assert.equal(await page.evaluate(()=>App.getState().data.dj[0].activeStiffness),32);
   await page.locator('[data-path="data.dj.0.activeStiffnessInputUnit"]').selectOption('kN/m');assert.equal(await page.locator('[data-path="data.dj.0.activeStiffness"]').inputValue(),'32');
   await page.evaluate(()=>App.openEntry('hop'));await fill('data.hop.summary.rsi',2.1);await fill('data.hop.summary.height',32);await fill('data.hop.summary.activeStiffness',44);await page.locator('[data-path="data.hop.inputMode"]').selectOption('jumps');assert.equal(await page.locator('[data-path="data.hop.summary.activeStiffness"]').inputValue(),'44');
   await page.locator('[data-path="data.hop.inputMode"]').selectOption('summary');await page.evaluate(()=>App.saveNow());
  });
  await check("save refresh and process restart preserve CPET original labels and device stiffness",async()=>{
   await context.close();context=null;await launch();assert.equal(await page.evaluate(()=>App.getState().recordId),recordId);const state=await page.evaluate(()=>App.getState());assert.equal(state.data.cpet.oxygenLabel,'VO2peak');assert.equal(Number(state.data.cpet.thresholds.second.vo2),36.32);assert.equal(Number(state.data.dj[0].activeStiffness),32);assert.equal(Number(state.data.hop.summary.activeStiffness),44);
  });
  await check("single-report export materializes reference and reopens with identical evaluation",async()=>{
   const before=await page.evaluate(()=>App.stats().capabilityCards);const payload=await page.evaluate(()=>App.reportPayload());assert.equal(payload.record.definitions.find(d=>d.id==='cpet_vo2_relative').referenceGroups,undefined);
   const exported=path.join(out,channel+'-report.html');fs.writeFileSync(exported,await page.evaluate(()=>App.exportHTMLString()));const browser=await chromium.launch({channel}),isolated=await browser.newContext({offline:true}),other=await isolated.newPage();await other.goto(pathToFileURL(exported).href);assert.equal(await other.evaluate(()=>App.ready),true);const after=await other.evaluate(()=>App.stats().capabilityCards);assert.deepEqual(after,before);await browser.close();
  });
  await check("whole-library backup restores raw CPET and full reference groups",async()=>{
   await page.evaluate(()=>App.openManagement('backup'));const pending=page.waitForEvent('download');await page.evaluate(()=>App.downloadLibrary());const download=await pending,backup=path.join(out,channel+'-backup.motionbench.jsonl');await download.saveAs(backup);assert.match(fs.readFileSync(backup,'utf8'),/referenceGroups/);
   const browser=await chromium.launch({channel}),isolated=await browser.newContext({offline:true}),other=await isolated.newPage();other.on('dialog',d=>d.accept());await other.goto(pathToFileURL(file).href);assert.equal(await other.evaluate(()=>App.ready),true);await other.evaluate(()=>App.openManagement('backup'));await other.locator('#backupImportMode').selectOption('replace');await other.locator('#importFile').setInputFiles(backup);await other.waitForFunction(id=>App.getState()?.recordId===id,recordId);assert.equal(Number(await other.evaluate(()=>App.getState().data.cpet.vo2)),45.4);assert.ok((await other.evaluate(()=>App.getLibrary().evaluationProfiles.flatMap(p=>p.criteria.definitions).find(d=>d.id==='cpet_vo2_relative').referenceGroups.length))>=28);await browser.close();
  });
  await check("responsive entry and capability cards have no page overflow",async()=>{
   for(const [width,height]of [[1440,1000],[900,900],[390,844]]){await page.setViewportSize({width,height});for(const tab of ['cpet','cmj','imtp','dj','hop']){await page.evaluate(t=>App.openEntry(t),tab);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${tab} ${width}`);}await shot('entry-'+width);await page.evaluate(()=>App.showReport());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await shot('report-'+width);}
  });
  await check("untouched 2.11 demo upgrade is saved before reload and modified demo remains untouched",async()=>{
   const legacy=originalDemo(),expectedNarrative=await page.evaluate(r=>RingsideModel.normalizeRecord(r).narrative,legacy);await page.evaluate(r=>App.importPayload({schema:2,kind:'report',record:r}),legacy);
   const upgraded=await page.evaluate(async()=>({live:App.getState(),stored:await App.getRepository().loadRecord(App.getState().recordId)}));assert.equal(upgraded.live.recordId,legacy.recordId);assert.equal(upgraded.live.demoRevision,2);assert.equal(upgraded.stored.demoRevision,2);assert.equal(Number(upgraded.stored.data.cpet.vo2),62);assert.equal(upgraded.live.narrative.text,expectedNarrative.text);assert.equal(upgraded.live.narrative.html,expectedNarrative.html);
   await page.reload();assert.equal(await page.evaluate(()=>App.ready),true);assert.equal(await page.evaluate(()=>App.getState().demoRevision),2);assert.equal(await page.evaluate(()=>App.stats().capabilityCards.length),4);
   const modified=originalDemo();modified.data.cmj[0].height=99;modified.narrative.text='用户自己的说明';modified.narrative.html='<p>用户自己的说明</p>';modified.narrative.origin='manual';modified.narrative.revision=1;await page.evaluate(r=>App.importPayload({schema:2,kind:'report',record:r}),modified);
   const saved=await page.evaluate(()=>App.getState());assert.equal(saved.demoRevision,undefined);assert.equal(Number(saved.data.cmj[0].height),99);assert.equal(saved.narrative.text,'用户自己的说明');assert.equal(saved.data.cpet.vo2,'');
  });
  await check("synthetic demo displays all four cards with its own training goals",async()=>{
   await page.evaluate(()=>App.importPayload(RingsideModel.recordEnvelope(RingsideModel.sampleRecord())));await page.evaluate(()=>App.showReport());assert.deepEqual(await page.locator('[data-capability-card]').evaluateAll(els=>els.map(el=>el.dataset.capabilityCard)),['strength','reactive','speed','cardio']);assert.equal(await page.locator('[data-overview-metric="srr"]').count(),1);assert.equal(await page.locator('[data-overview-metric="asr"]').count(),0);assert.doesNotMatch(await page.locator('#reportView').innerText(),/跳高|缺项保持空白|录入 CMJ 冲量|录入 IMTP 冲量/);await shot('all-four-demo');
  });
  assert.deepEqual(result.errors,[]);result.pass=true;
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;if(page)await shot('failure').catch(()=>{});}
 finally{if(context)await context.close();fs.writeFileSync(path.join(out,channel+'-results.json'),JSON.stringify(result,null,2));}
})();
