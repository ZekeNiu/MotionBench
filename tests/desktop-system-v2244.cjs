"use strict";
// Freeze the original-library capture independently of later 2.24.4 UI checks.
// Other stages live in a separate producer; no stage edits measurement records.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {_electron}=require("./helpers/playwright.cjs"),base=require("./desktop-system-v2243.cjs");
const ROOT=path.resolve(__dirname,".."),SOURCE=path.join(ROOT,"MotionBench.html");
const CHECKPOINT=String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261017-system-before-2.24.4`;
const MANIFEST_SHA="dfa6227ac5fedad87074f7b36ba54b663dbecd6eb06724ed1b18884c1c6fc566";
const DEPENDENCIES=["tests/desktop-system-v2243.cjs","tests/desktop-system-v2242.cjs","tests/helpers/playwright.cjs"];
const CHECKS={baseline:["Verified backed-up 2.24.3 runtime and complete fresh real-system profile copy","Captured every original record calculation narrative and comparison document","Existing four-record selection preserves the complete original library","Native save barrier preserves every original field and full comparison model","Native application closes normally with unchanged producers and no renderer or network errors"]};
/* VERIFY_CHECKS {"baseline":["Verified backed-up 2.24.3 runtime and complete fresh real-system profile copy","Captured every original record calculation narrative and comparison document","Existing four-record selection preserves the complete original library","Native save barrier preserves every original field and full comparison model","Native application closes normally with unchanged producers and no renderer or network errors"]} VERIFY_CHECKS */
const hash=value=>crypto.createHash("sha256").update(value).digest("hex"),fileHash=file=>hash(fs.readFileSync(file));
const readJSON=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const arg=key=>{const index=process.argv.indexOf(key);return index<0?null:process.argv[index+1];};
const norm=value=>path.resolve(String(value).replace(/^\\\\\?\\/,"")).toLowerCase();
function saveSnapshot(directory,name,value,result){const file=path.join(directory,name);fs.writeFileSync(file,JSON.stringify(value,null,2));const sha256=fileHash(file);result.snapshots.push({file,sha256});return sha256;}
function stamp(value,original,start,end){if(value===original)return;const number=Date.parse(value);assert.ok(Number.isFinite(number)&&number>=Date.parse(start)&&number<=Date.parse(end),"Comparison metadata timestamp must belong to this actual launch window");assert.equal(new Date(number).toISOString(),value);}
function checkMetadata(actual,original,sample,start,end){
 const previous=original.library.longitudinalReports.find(doc=>doc.key===sample.documentKey),stored=actual.library.longitudinalReports.find(doc=>doc.key===sample.documentKey);
 stamp(stored.updated,previous.updated,start,end);if(actual.activeComparison)stamp(actual.activeComparison.document.updated,previous.updated,start,end);
}
async function selectExisting(page,sample){
 if(await page.evaluate(id=>App.getState()?.athleteId!==id,sample.athleteId))assert.equal(await page.evaluate(id=>App.selectAthlete(id),sample.athleteId),true);
 const ids=await page.evaluate(()=>App.getLongitudinal()?.recordIds||[]);if(JSON.stringify([...ids].sort())!==JSON.stringify([...sample.recordIds].sort()))assert.equal(await page.evaluate(ids=>App.selectRecords(ids),sample.recordIds),true);
 assert.equal(await page.evaluate(()=>App.showReport(true)),"report");await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(await page.locator("#recordChoices [data-record-choice]:checked").evaluateAll(nodes=>nodes.map(node=>node.dataset.recordChoice).sort()),[...sample.recordIds].sort());
}
async function close(session,result){
 assert.equal((await session.page.evaluate(()=>App.prepareDesktopClose())).ok,true);
 const closed=session.electron.waitForEvent("close",{timeout:60000});await session.electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;
 result.closeEvidence={method:"BrowserWindow.close",exited:true};result.normalClose=true;
}
async function baseline(){
 const checkpoint=path.resolve(arg("--checkpoint")||CHECKPOINT);assert.equal(norm(checkpoint),norm(CHECKPOINT));assert.equal(fileHash(path.join(checkpoint,"manifest.json")),MANIFEST_SHA);
 const backup=base.verifyBackup(checkpoint),profile=path.join(checkpoint,"system-baseline-profile"),executable=path.join(checkpoint,"program/MotionBench.exe"),archive=path.join(checkpoint,"program/resources/app.asar"),directory=path.join(checkpoint,"verification/baseline");
 fs.mkdirSync(directory,{recursive:true});assert.ok(!fs.existsSync(path.join(directory,"receipt.json")),"Preserve previous stage evidence before rerunning");
 const runtime=hash(require("@electron/asar").extractFile(archive,path.normalize("MotionBench.html")));
 const result={kind:"existing-data-display-preservation",mode:"baseline",pass:false,checks:[],errors:[],network:[],snapshots:[],artifacts:[],normalClose:false,pdfRequested:false,actualProfile:false,normalStartup:false,startedAt:new Date().toISOString(),runnerSha256:fileHash(__filename),dependencyHashes:Object.fromEntries(DEPENDENCIES.map(file=>[file,fileHash(path.join(ROOT,file))])),sourceHash:runtime,runtimeHtmlSha256:runtime,workspaceSourceHash:fileHash(SOURCE),executablePath:executable,executableSha256:fileHash(executable),archivePath:archive,archiveSha256:fileHash(archive),profilePath:profile,backupManifest:backup.file,backupManifestSha256:backup.sha256};
 let session;const stage=value=>{result.stage=value;console.log("baseline: "+value);};
 try{
  result.profileCopy=base.verifyFreshProfile(profile,backup);result.launchArgs=["--motionbench-test","--motionbench-data-dir="+profile];const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.MOTIONBENCH_TEST_EXPORT_DIR;
  stage("Opening verified original-profile copy");result.launchStartedAt=new Date().toISOString();const electron=await _electron.launch({executablePath:executable,args:result.launchArgs,cwd:ROOT,env,timeout:60000});session={electron,context:electron.context(),page:await electron.firstWindow()};
  Object.assign(result,await electron.evaluate(({app,session,BrowserWindow})=>({userDataPath:app.getPath("userData"),sessionDataPath:app.getPath("sessionData"),defaultSession:BrowserWindow.getAllWindows()[0].webContents.session===session.defaultSession})));
  assert.equal(norm(result.userDataPath),norm(profile));assert.equal(norm(result.sessionDataPath),norm(profile));assert.equal(result.defaultSession,true);
  const page=session.page;page.setDefaultTimeout(30000);page.on("pageerror",error=>result.errors.push(error.stack));page.on("request",request=>{if(/^https?:/.test(request.url()))result.network.push(request.url());});page.on("dialog",dialog=>dialog.dismiss());await session.context.setOffline(true);
  await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});assert.equal(await page.evaluate(()=>App.ready),true);
  result.version=await page.evaluate(()=>MotionBenchDesktop.version);assert.equal(result.version,"2.24.3-desktop.1");result.originURL=page.url();assert.equal(result.originURL,"motionbench://app/MotionBench.html");result.databaseName=await page.evaluate(()=>App.getRepository().db.name);assert.equal(result.databaseName,"motionbench-v3:/MotionBench.html");result.checks.push(CHECKS.baseline[0]);
  stage("Capturing complete raw library and all single-report calculations");const startup=await base.snapshot(page),sample=base.example(startup.library);result.example=sample;result.counts={athletes:startup.library.athletes.length,records:startup.reports.length};result.startupSnapshotSha256=saveSnapshot(directory,"startup-snapshot.json",startup,result);result.checks.push(CHECKS.baseline[1]);
  await base.protect(page,startup.library,sample);await selectExisting(page,sample);const selected=await base.snapshot(page);base.compareLibrary(selected,startup,sample);checkMetadata(selected,startup,sample,result.launchStartedAt,new Date().toISOString());assert.equal(selected.activeComparison?.document.key,sample.documentKey);result.selectedSnapshotSha256=saveSnapshot(directory,"selected-snapshot.json",selected,result);result.selectionPreservedData=true;result.checks.push(CHECKS.baseline[2]);
  stage("Verifying the normal save barrier");assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);const final=await base.snapshot(page);base.compareSnapshots(final,selected,sample);base.compareLibrary(final,startup,sample);checkMetadata(final,startup,sample,result.launchStartedAt,new Date().toISOString());result.snapshotSha256=saveSnapshot(directory,"snapshot.json",final,result);result.guard=await page.evaluate(()=>__preservation2243);assert.deepEqual(result.guard.blocked,[]);assert.ok(result.guard.writes>0);result.originalPreserved=result.afterSaveUnchanged=true;result.checks.push(CHECKS.baseline[3]);
  stage("Closing the original application normally");await close(session,result);session=null;assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);assert.equal(fileHash(SOURCE),result.workspaceSourceHash);assert.equal(fileHash(__filename),result.runnerSha256);assert.equal(fileHash(executable),result.executableSha256);assert.equal(fileHash(archive),result.archiveSha256);for(const[file,digest]of Object.entries(result.dependencyHashes))assert.equal(fileHash(path.join(ROOT,file)),digest);result.checks.push(CHECKS.baseline[4]);assert.deepEqual(result.checks,CHECKS.baseline);result.pass=true;
 }catch(error){result.failure=error.stack;result.failureState=await session?.page.evaluate(()=>({guard:window.__preservation2243||null,status:document.getElementById("saveStatus")?.textContent,toast:document.getElementById("toast")?.textContent})).catch(()=>null);process.exitCode=1;console.error("Baseline verification failed; see private receipt.");}
 finally{if(session)try{await close(session,result);}catch(error){result.closeFailure=String(error);}result.completedAt=new Date().toISOString();result.sourceUnchanged=fileHash(SOURCE)===result.workspaceSourceHash;result.runnerUnchanged=fileHash(__filename)===result.runnerSha256;result.artifactUnchanged=fileHash(executable)===result.executableSha256&&fileHash(archive)===result.archiveSha256;result.dependenciesUnchanged=Object.entries(result.dependencyHashes).every(([file,digest])=>fileHash(path.join(ROOT,file))===digest);fs.writeFileSync(path.join(directory,"receipt.json"),JSON.stringify(result,null,2));console.log(JSON.stringify({mode:"baseline",pass:result.pass,checks:result.checks.length,normalClose:result.normalClose,counts:result.counts}));}
}
module.exports={CHECKS,CHECKPOINT,MANIFEST_SHA,DEPENDENCIES,ROOT,SOURCE,hash,fileHash,readJSON,arg,norm,saveSnapshot,stamp,checkMetadata,selectExisting,base};
if(require.main===module){const mode=process.argv[2];(mode==="baseline"?baseline():require("./helpers/desktop-system-v2244-stages.cjs").main(mode)).catch(error=>{console.error(error.stack);process.exitCode=1;});}
