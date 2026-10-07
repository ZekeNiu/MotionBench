"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto");
const{chromium}=require("./helpers/playwright.cjs"),root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/management");
fs.mkdirSync(out,{recursive:true});const channel=process.argv.includes("--edge")?"msedge":"chrome";
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,checks:[],errors:[],network:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel}),context=await browser.newContext({offline:true,viewport:{width:1440,height:960},reducedMotion:"reduce",acceptDownloads:true});let page=await context.newPage();
 page.setDefaultTimeout(10000);page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});page.on("dialog",d=>d.accept());
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS",name);};
 const click=(action,id)=>page.locator(`[data-manager-action="${action}"]${id?`[data-id="${id}"]`:""}`).first().click();
 const manage=async(tab="athletes")=>{await page.evaluate(t=>App.openManagement(t),tab);};
 const saveForm=async()=>{await page.locator('#managementForm [type="submit"]').click();await page.locator("#managementModal").waitFor({state:"hidden"});};
 try{
  await page.goto(pathToFileURL(file).href);assert.equal(await page.evaluate(()=>App.ready),true);
  await check("fresh library remains empty and management has independent context",async()=>{
   assert.equal(await page.evaluate(()=>App.getState()),null);await manage();assert.equal(await page.locator("#athleteSelect").isVisible(),false);assert.equal(await page.locator("#editButton").isVisible(),false);
   await click("new-athlete");await page.locator('#managementForm [name="name"]').fill("运动员甲");await page.locator('#managementForm [name="sport"]').fill("篮球");await saveForm();
   const a=await page.evaluate(()=>App.getLibrary().athletes[0]);assert.equal(a.records.length,0);assert.equal(await page.evaluate(()=>App.getState()),null);
  });
  const athleteId=await page.evaluate(()=>App.getLibrary().athletes[0].id);
  await check("team creation and bulk movement are persisted",async()=>{
   await click("groups");await page.locator('#managementForm [name="name"]').fill("青年一队");await saveForm();
   await page.locator(`[data-manager-select="${athleteId}"]`).check();await click("batch-group");await page.locator('#managementForm [name="value"]').selectOption({label:"青年一队"});await saveForm();
   assert.ok(await page.evaluate(()=>App.getLibrary().athletes[0].groupId));
  });
  await check("new test uses explicit profile and enters selected project",async()=>{
   await click("new-record",athleteId);await page.locator("#newAthleteModal").waitFor({state:"visible"});assert.equal(await page.locator("#creationEvaluationProfile option").count(),1);await page.locator('[data-creation-project="cmj"]').check();
   await page.locator("#creationSubmit").click();await page.waitForFunction(()=>App.getUIState().mode==="entry");assert.equal(await page.locator("#entryProjectTitle").textContent(),"CMJ");
   await page.locator('[data-path="data.cmj.0.height"]').fill("42");await page.evaluate(()=>App.saveNow());await page.locator('.entry-footer button[onclick="App.showReport()"] ').click();
   assert.equal(await page.evaluate(()=>App.stats().values.cmj_height),42);
  });
  const recordId=await page.evaluate(()=>App.getState().recordId);
  await check("browsing and creating another athlete does not switch the report",async()=>{
   await manage();await click("new-athlete");await page.locator('#managementForm [name="name"]').fill("运动员甲");await saveForm();
   await page.locator('[data-manager-filter="q"]').fill("不存在");await page.waitForTimeout(150);assert.equal(await page.locator("[data-managed-id]").count(),0);
   assert.equal(await page.evaluate(()=>App.getState().recordId),recordId);await page.locator('[data-manager-filter="q"]').fill("");await page.waitForTimeout(150);
  });
  await check("record editing returns to management without losing filters",async()=>{
   await manage("records");await page.locator('[data-manager-filter="q"]').fill("运动员甲");await page.waitForTimeout(150);await click("entry",recordId);await page.waitForFunction(()=>App.getUIState().mode==="entry");
   await page.locator("#workspaceBack").click();await page.waitForFunction(()=>App.getUIState().mode==="management");assert.equal(await page.locator('[data-manager-filter="q"]').inputValue(),"运动员甲");
  });
  await check("profile publication updates computed standards without touching original measurements",async()=>{
   const before=await page.evaluate(()=>JSON.stringify(App.getState().data));await manage("profiles");const id=await page.evaluate(()=>App.getState().evaluationProfileId);await click("profile-edit",id);
   await page.locator("#profileMetricSelect").selectOption("cmj_height");await page.locator('[data-profile-path$=".target"]').fill("80");await click("profile-review");
   assert.match(await page.locator("#managementFields").innerText(),/80/);await saveForm();
   assert.equal(await page.evaluate(()=>App.effectiveRecord().definitions.find(d=>d.id==="cmj_height").target),80);assert.equal(await page.evaluate(()=>JSON.stringify(App.getState().data)),before);
   assert.equal(await page.evaluate(()=>App.getState().definitions.find(d=>d.id==="cmj_height").target),50);
  });
  await check("all profile editor sections open and historical resolution stays deterministic",async()=>{
   const id=await page.evaluate(()=>App.getState().evaluationProfileId);await click("profile-edit",id);
   for(const tab of ["rules","axes","iso","balance","lvp","definitions"]){await click("profile-tab",tab);assert.ok(await page.locator("#profileEditorFields").innerText());}
   await click("profile-close");await click("profile-copy",id);await page.locator("#profileName").fill("专项乙方案");await click("profile-review");await saveForm();
   assert.equal(await page.evaluate(()=>App.getLibrary().evaluationProfiles.length),2);
  });
  await check("archive and trash preserve and restore IDs and ownership",async()=>{
   await manage();await page.locator(`[data-manager-select="${athleteId}"]`).check();await click("archive");await page.waitForFunction(id=>App.getLibrary().athletes.find(a=>a.id===id)?.archived,athleteId);
   await page.locator('[data-manager-filter="status"]').selectOption("archived");assert.equal(await page.locator("[data-managed-id]").count(),1);
   await page.locator(`[data-manager-select="${athleteId}"]`).check();await click("unarchive");await page.waitForFunction(id=>!App.getLibrary().athletes.find(a=>a.id===id)?.archived,athleteId);
   await page.locator('[data-manager-filter="status"]').selectOption("active");await page.locator(`[data-manager-select="${athleteId}"]`).check();await click("trash");
   await page.waitForFunction(id=>!!App.getLibrary().athletes.find(a=>a.id===id)?.deletedAt&&App.getState()===null,athleteId);assert.equal(await page.evaluate(()=>App.getState()),null);
   await page.locator('[data-manager-filter="status"]').selectOption("trash");await click("restore",athleteId);await page.waitForFunction(id=>!App.getLibrary().athletes.find(a=>a.id===id)?.deletedAt,athleteId);
   assert.equal(await page.evaluate(id=>App.getLibrary().athletes.find(a=>a.id===id).records[0].recordId,athleteId),recordId);
   await page.evaluate(({a,r})=>App.openManagedRecord(a,r),{a:athleteId,r:recordId});assert.equal(await page.evaluate(()=>App.stats().values.cmj_height),42);
  });
  await check("reload loads summary directory and selected record from IndexedDB",async()=>{
   await page.reload();assert.equal(await page.evaluate(()=>App.ready),true);assert.equal(await page.evaluate(()=>App.getState().recordId),recordId);
   assert.equal(await page.evaluate(()=>App.getLibrary().athletes.find(a=>a.records.length).records[0]._summary),true);
   assert.equal(await page.evaluate(()=>App.effectiveRecord().definitions.find(d=>d.id==="cmj_height").target),80);
  });
  let backupPath;
  await check("real full-backup button downloads a complete versioned stream",async()=>{
   await manage("backup");const pending=page.waitForEvent("download");await page.getByRole("button",{name:"导出完整备份",exact:true}).click();const download=await pending;
   backupPath=path.join(out,channel+"-roundtrip.motionbench.jsonl");await download.saveAs(backupPath);const rows=fs.readFileSync(backupPath,"utf8").trim().split("\n").map(JSON.parse);assert.equal(rows.at(-1).type,"end");assert.equal(rows.at(-1).counts.record,1);assert.equal(rows.at(-1).counts.athlete,2);
  });
  await check("truncated import cannot replace the active library",async()=>{
   const unchanged=await page.evaluate(async()=>{const repository=App.getRepository(),before=repository.generation,blob=await repository.backupBlob(),text=await blob.text(),bad=new File([text.slice(0,text.lastIndexOf('{"type":"end"'))],"bad.jsonl");try{await repository.importRows(RingsideStore.fileRows(bad));return false;}catch(e){return before===repository.generation;}});assert.equal(unchanged,true);
  });
  await check("backup roundtrip in a clean browser retains empty athletes and current evaluation",async()=>{
   const fresh=await browser.newContext({offline:true});const p=await fresh.newPage();await p.goto(pathToFileURL(file).href);await p.evaluate(()=>App.ready);await p.evaluate(()=>App.openManagement("backup"));
   await p.locator('#backupImportMode').selectOption("replace");p.on("dialog",d=>d.accept());await p.locator('#importFile').setInputFiles(backupPath);await p.waitForFunction(()=>App.getLibrary().athletes.length===2);
   assert.equal(await p.evaluate(()=>App.getLibrary().athletes.filter(a=>a.records.length===0).length),1);assert.equal(await p.evaluate(()=>App.effectiveRecord().definitions.find(d=>d.id==="cmj_height").target),80);await fresh.close();
  });
  await check("same-ID different profile import creates a separate scheme",async()=>{
   const result=await page.evaluate(async()=>{const before=App.effectiveRecord().definitions.find(d=>d.id==="cmj_height").target;const all=await App.libraryPayload();all.athletes=all.athletes.filter(a=>a.records.length);const a=all.athletes[0],r=a.records[0];r.recordId=crypto.randomUUID();a.records=[r];all.activeRecordId=r.recordId;all.evaluationProfiles.find(p=>p.id===r.evaluationProfileId).criteria.definitions.find(d=>d.id==="cmj_height").target=200;
    await App.importPayload(all);const imported=App.effectiveRecord().definitions.find(d=>d.id==="cmj_height").target;const old=await App.getRepository().loadRecord(all.athletes[0].records[0].recordId);return{before,imported,profiles:App.getLibrary().evaluationProfiles.length};});
   assert.equal(result.before,80);assert.equal(result.imported,200);assert.equal(result.profiles,3);
  });
  await check("all management views fit desktop, low window, tablet and mobile",async()=>{
   for(const [width,height]of [[1440,960],[1366,768],[900,800],[390,844],[844,390]]){
    await page.setViewportSize({width,height});
    for(const tab of ["athletes","records","catalog","metrics","profiles","backup"]){await manage(tab);await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width} ${tab}`);}
    await manage("athletes");await page.screenshot({path:path.join(out,`${channel}-athletes-${width}.png`)});
   }
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;await page.screenshot({path:path.join(out,channel+"-failure.png")}).catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,channel+"-workflow.json"),JSON.stringify(result,null,2));await context.close();await browser.close();}
})();
