"use strict";
// Each scenario has two real pages in ONE isolated context: one IndexedDB,
// separate sessionStorage/App/Repository instances, and synthetic measurements.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),source=path.join(root,"MotionBench.html");
const channel=process.argv.includes("--edge")?"msedge":"chrome";
const expectVulnerable=process.argv.includes("--expect-vulnerable");
const artifactIndex=process.argv.indexOf("--artifact-dir");
const artifactArg=process.argv.find(arg=>arg.startsWith("--artifact-dir="))?.slice(15);
const artifactDir=artifactArg||(artifactIndex>=0?process.argv[artifactIndex+1]:"");
if(artifactIndex>=0&&(!artifactDir||artifactDir.startsWith("--")))throw Error("--artifact-dir requires a directory");
const artifactRoot=path.join(root,"output/playwright");
const out=artifactDir?path.resolve(root,artifactDir):path.join(artifactRoot,"entry-concurrency-2.17.2",expectVulnerable?"v1-baseline":"final");
const relative=path.relative(artifactRoot,out);
if(!relative||relative.startsWith("..")||path.isAbsolute(relative))throw Error("Artifacts must stay within output/playwright");
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result={channel,sourceHash:hash(source),synthetic:true,expectVulnerable,checks:[],scenarios:[],errors:[],network:[],artifacts:[],pass:false};
fs.mkdirSync(out,{recursive:true});
const relativePath=file=>path.relative(root,file).replaceAll("\\","/");
const artifact=(file,kind)=>result.artifacts.push({path:relativePath(file),sha256:hash(file),kind});
const sessionData=page=>page.evaluate(()=>JSON.parse(sessionStorage.getItem("ringside-entry-session-v1:"+location.pathname)||"null"));
const currentHeight=page=>page.evaluate(()=>Number(App.getState().data.cmj[0].height));
const storedHeight=(page,id)=>page.evaluate(async id=>Number((await App.getRepository().loadRecord(id)).data.cmj[0].height),id);
const ready=async page=>{await page.waitForFunction(()=>!!window.App?.ready);assert.equal(await page.evaluate(()=>App.ready),true);};
const fill=(page,value)=>page.locator('[data-path="data.cmj.0.height"]').fill(String(value));
const save=page=>page.evaluate(()=>App.saveNow());
const status=page=>page.locator("#saveStatus").innerText();
const dirtyHeight=payload=>Number(payload.dirtyRecords?.[0]?.record?.data?.cmj?.[0]?.height);
(async()=>{
 const browser=await chromium.launch({channel,headless:true});
 const contexts=[];
 let lastPage;
 const newPair=async(name,withSession=true)=>{
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce",acceptDownloads:true});contexts.push(context);
  const observe=page=>{page.setDefaultTimeout(20000);page.on("pageerror",error=>result.errors.push(error.message));page.on("dialog",dialog=>dialog.accept());page.on("request",request=>{if(/^https?:/.test(request.url()))result.network.push(request.url());});};
  const a=await context.newPage();observe(a);lastPage=a;await a.goto(pathToFileURL(source).href);await ready(a);
  await a.evaluate(()=>App.importPayload(RingsideModel.libraryDefaults(),"replace-library"));
  let id,athleteId;
  if(withSession){
   athleteId=await a.evaluate(()=>App.createAthlete("双窗口并发验证（合成数据）"));
   await a.evaluate(()=>App.startDataEntry());
   await a.locator(`[data-creation-athlete="${athleteId}"]`).check();
   await a.locator("#creationNext").click();await a.locator("#creationTestStep").waitFor({state:"visible"});
   await a.locator('#creationProjects [data-picker-project="cmj"]').check();await a.locator("#creationSubmit").click();
   await a.waitForFunction(()=>App.getUIState().mode==="entry");
   id=await a.evaluate(()=>App.getState().recordId);await fill(a,30);assert.equal(await save(a),true);
   const payload=await sessionData(a);assert.ok(payload.savedIds.includes(id));
  }else{
   const ids=await a.evaluate(async()=>{const r=RingsideModel.sampleRecord();r.demo=false;r.recordId="normal-concurrency-record";r.athleteId="normal-concurrency-athlete";r.athlete.name="普通保存并发验证（合成数据）";r.data.cmj[0].height=30;await App.importPayload(RingsideModel.recordEnvelope(r));return {id:r.recordId,athleteId:r.athleteId};});
   ({id,athleteId}=ids);await a.evaluate(()=>App.openEntry("cmj"));assert.equal(await save(a),true);assert.equal(await sessionData(a),null);
  }
  const b=await context.newPage();observe(b);await b.goto(pathToFileURL(source).href);await ready(b);await b.evaluate(()=>App.openEntry("cmj"));
  const identity=await Promise.all([a,b].map(page=>page.evaluate(()=>({pathname:location.pathname,name:App.getRepository().db.name,generation:App.getRepository().generation,recordId:App.getState().recordId}))));
  assert.deepEqual(identity[0],identity[1]);assert.equal(identity[0].recordId,id);assert.equal(await storedHeight(b,id),30);
  const independence=await a.evaluate(()=>{sessionStorage.setItem("synthetic-page-a-only","yes");return true;});assert.equal(independence,true);assert.equal(await b.evaluate(()=>sessionStorage.getItem("synthetic-page-a-only")),null);
  return {a,b,id,athleteId,name,identity};
 };
 const screenshot=async(page,name)=>{const file=path.join(out,`${channel}-${name}.png`);await page.screenshot({path:file,fullPage:true,animations:"disabled"});artifact(file,"screenshot");};
 const backup=async(page,name)=>{const pending=page.waitForEvent("download");await page.evaluate(()=>App.downloadJSON());const download=await pending,file=path.join(out,`${channel}-${name}.json`);assert.equal(await download.failure(),null);await download.saveAs(file);artifact(file,"unsaved-record-copy");const payload=JSON.parse(fs.readFileSync(file,"utf8"));return {path:relativePath(file),sha256:hash(file),record:payload.record};};
 const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS",name);};
 try{
  if(process.argv.includes("--ordinary-only")){
   assert.ok(process.argv.includes("--observe-ordinary"),"--ordinary-only requires --observe-ordinary");
   const pair=await newPair("ordinary-record",false),{a,b,id}=pair;
   await fill(b,70);assert.equal(await save(b),true);assert.equal(await storedHeight(a,id),70);
   await fill(a,75);const saved=await save(a),stored=await storedHeight(b,id);assert.equal(await currentHeight(a),75);
   const copy=await backup(a,"ordinary-record-local-copy");assert.equal(Number(copy.record.data.cmj[0].height),75);
   result.ordinaryPersistenceObservation={name:pair.name,identity:pair.identity,saveReturn:saved,expectedStoredHeight:70,actualStoredHeight:stored,staleOverwriteObserved:saved&&stored===75,localHeight:75,saveStatus:await status(a),localCopy:{path:copy.path,sha256:copy.sha256,height:75}};
   result.observationOnly=true;await screenshot(a,"ordinary-record-observation");
   if(expectVulnerable){assert.equal(saved,true);assert.equal(stored,75);result.baselineReproduced=true;result.assertionThatWouldFail="ordinary A save must return false and preserve B's committed height 70";}
   assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);assert.equal(hash(source),result.sourceHash);result.sourceUnchanged=true;result.pass=true;
   console.log("OBSERVED",JSON.stringify(result.ordinaryPersistenceObservation));return;
  }
  await check(expectVulnerable?"baseline reproduces stale restored-session overwrite (expected vulnerable behavior)":"restored dirty saved session rejects another page's committed change and retains local input",async()=>{
   const pair=await newPair("restored-session"),{a,b,id}=pair;
   await a.evaluate(()=>{App.getRepository().save=()=>Promise.reject(Error("synthetic initial disk failure"));});
   await fill(a,39);assert.equal(await save(a),false);assert.equal(await storedHeight(a,id),30);assert.equal(dirtyHeight(await sessionData(a)),39);
   await a.reload();await ready(a);assert.equal(await currentHeight(a),39);assert.equal(await a.locator('[data-path="data.cmj.0.height"]').inputValue(),"39");
   await fill(b,55);assert.equal(await save(b),true);assert.equal(await storedHeight(a,id),55);
   await fill(a,41);const saved=await save(a);const trace={name:pair.name,identity:pair.identity,restoredDirtyHeight:39,externalHeight:55,saveReturn:saved,storedHeight:await storedHeight(b,id),localHeight:await currentHeight(a),saveStatus:await status(a),session:await sessionData(a)};result.scenarios.push(trace);await screenshot(a,"restored-session-after-save");
   if(expectVulnerable){assert.equal(saved,true);assert.equal(trace.storedHeight,41);result.baselineReproduced=true;result.assertionThatWouldFail="A save must return false and preserve B's committed height 55";return;}
   assert.equal(saved,false);assert.equal(trace.storedHeight,55);assert.equal(trace.localHeight,41);assert.equal(dirtyHeight(trace.session),41);assert.match(trace.saveStatus,/保存失败/);
   // The existing single-record export retains current input even when full-library
   // export and navigation are blocked by a failed save. Then the user explicitly
   // reloads this page; session reconciliation opens the authoritative record.
   const copy=await backup(a,"restored-session-local-copy");assert.equal(Number(copy.record.data.cmj[0].height),41);trace.localCopy={path:copy.path,sha256:copy.sha256,height:41};
   await a.reload();await ready(a);assert.equal(await currentHeight(a),55);assert.equal(await storedHeight(b,id),55);
   trace.reopenNotice=await a.locator("#toast").innerText();assert.match(trace.reopenNotice,/其他页面修改.*最新(?:数据|内容)/);trace.explicitReopenHeight=55;
   await fill(a,56);assert.equal(await save(a),true);assert.equal(await storedHeight(b,id),56);trace.normalSaveAfterReopen=true;
  });
  if(!expectVulnerable){
   await check("queued session saves compare committed baseline inside the transaction and keep the latest dirty edit",async()=>{
    const pair=await newPair("queued-session"),{a,b,id}=pair;
    await a.evaluate(()=>{const repository=App.getRepository();window.__concurrencySave=repository.save.bind(repository);window.__gateReached=false;const gate=new Promise(resolve=>window.__releaseConcurrencyGate=resolve);let held=false;repository.save=async(...args)=>{if(!held){held=true;window.__gateReached=true;await gate;}return __concurrencySave(...args);};});
    await fill(a,40);await a.evaluate(()=>{window.__firstSave=App.saveNow();});await a.waitForFunction(()=>__gateReached);
    await fill(b,60);assert.equal(await save(b),true);assert.equal(await storedHeight(a,id),60);
    await fill(a,42);await a.evaluate(()=>{window.__secondSave=App.saveNow();});
    const returns=await a.evaluate(async()=>{__releaseConcurrencyGate();return Promise.all([__firstSave,__secondSave]);});
    assert.deepEqual(returns,[false,false]);assert.equal(await save(a),false);assert.equal(await storedHeight(b,id),60);assert.equal(await currentHeight(a),42);
    const payload=await sessionData(a);assert.equal(dirtyHeight(payload),42);
    const trace={name:pair.name,identity:pair.identity,returns,storedHeight:60,localHeight:42,dirtyHeight:dirtyHeight(payload),saveStatus:await status(a),session:payload};result.scenarios.push(trace);await screenshot(a,"queued-session-failure");
    const copy=await backup(a,"queued-session-local-copy");assert.equal(Number(copy.record.data.cmj[0].height),42);trace.localCopy={path:copy.path,sha256:copy.sha256,height:42};
   });
   await check("ordinary record saves reject stale writes and preserve a local copy before explicit reopening",async()=>{
    const pair=await newPair("ordinary-record",false),{a,b,id}=pair;
    await fill(b,70);assert.equal(await save(b),true);assert.equal(await storedHeight(a,id),70);
    await fill(a,75);const saved=await save(a),stored=await storedHeight(b,id);assert.equal(await currentHeight(a),75);
    assert.equal(saved,false);assert.equal(stored,70);assert.match(await status(a),/保存失败/);
    const copy=await backup(a,"ordinary-record-local-copy");assert.equal(Number(copy.record.data.cmj[0].height),75);
    const trace={name:pair.name,identity:pair.identity,saveReturn:saved,storedHeight:stored,localHeight:75,saveStatus:await status(a),localCopy:{path:copy.path,sha256:copy.sha256,height:75}};result.scenarios.push(trace);await screenshot(a,"ordinary-record-failure");
    await a.reload();await ready(a);assert.equal(await currentHeight(a),70);assert.equal(await storedHeight(b,id),70);trace.explicitReopenHeight=70;
    await a.evaluate(()=>App.openEntry("cmj"));await fill(a,71);assert.equal(await save(a),true);assert.equal(await storedHeight(b,id),71);trace.normalSaveAfterReopen=true;
   });
   await check("a queued failed storage write preserves the latest edit for a later successful retry",async()=>{
    const pair=await newPair("failed-then-retry"),{a,b,id}=pair;
    await a.evaluate(()=>{const repository=App.getRepository();window.__concurrencySave=repository.save.bind(repository);window.__gateReached=false;const gate=new Promise(resolve=>window.__releaseConcurrencyGate=resolve);let first=true;repository.save=async(...args)=>{if(first){first=false;window.__gateReached=true;await gate;throw Error("synthetic first queued storage failure");}throw Error("synthetic queued storage failure");};});
    await fill(a,80);await a.evaluate(()=>{window.__firstSave=App.saveNow();});await a.waitForFunction(()=>__gateReached);
    await fill(a,82);await a.evaluate(()=>{window.__secondSave=App.saveNow();});const returns=await a.evaluate(async()=>{__releaseConcurrencyGate();return Promise.all([__firstSave,__secondSave]);});assert.deepEqual(returns,[false,false]);
    assert.equal(await currentHeight(a),82);assert.equal(dirtyHeight(await sessionData(a)),82);assert.equal(await storedHeight(b,id),30);
    await a.evaluate(()=>{App.getRepository().save=__concurrencySave;});assert.equal(await save(a),true);assert.equal(await storedHeight(b,id),82);assert.equal((await sessionData(a)).dirtyRecords?.length||0,0);
    result.scenarios.push({name:pair.name,identity:pair.identity,returns,dirtyHeightAfterFailure:82,storedHeightAfterFailure:30,retryStoredHeight:82,retryClearedDirty:true});
   });
  }
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);assert.equal(hash(source),result.sourceHash);result.sourceUnchanged=true;result.pass=true;
 }catch(error){result.failure=error.stack;process.exitCode=1;console.error(error);if(lastPage)await screenshot(lastPage,"failure").catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,`${channel}-results.json`),JSON.stringify(result,null,2));for(const context of contexts)await context.close();await browser.close();}
})();
