"use strict";
// Normal-startup verification. Preserve raw snapshots; normalize only the new
// example comparison document's top-level rebuild timestamp when comparing it.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {_electron}=require('./helpers/playwright.cjs');
const root=path.resolve(__dirname,'..'),mode='reopened';
const base=String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.1`;
const exampleDates=['2026-09-01','2026-09-15','2026-09-29','2026-10-13'];
const executable=String.raw`D:\Application\Strength&Conditioning\MotionBench\MotionBench.exe`;
const profile=path.join(process.env.APPDATA,'MotionBench Desktop'),out=path.join(base,'verification',mode);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
function core(library,baseline){
 const value=structuredClone(library);
 for(const key of ['version','updated','activeAthleteId','activeRecordId','longitudinalReports'])delete value[key];
 if(baseline)value.athletes=value.athletes.filter(owner=>baseline.athletes.some(original=>original.id===owner.id));
 for(const owner of value.athletes){delete owner.updated;for(const record of owner.records)delete record.updated;}
 return canonical(value);
}
function documentSnapshot(document,exampleAthleteId,documentKey){const value=structuredClone(document);if(value?.athleteId===exampleAthleteId&&value.key===documentKey)delete value.updated;return value;}
function documentsSnapshot(documents,exampleAthleteId,documentKey){return canonical((documents||[]).map(document=>documentSnapshot(document,exampleAthleteId,documentKey)));}
function activeSnapshot(active,exampleAthleteId,documentKey){const value=structuredClone(active);if(value?.document)value.document=documentSnapshot(value.document,exampleAthleteId,documentKey);return canonical(value);}
async function main(){
 fs.mkdirSync(out,{recursive:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result={mode,pass:false,checks:[],errors:[],runnerSha256:hash(__filename),actualProfile:true,normalStartup:true,allowExamples:true,executablePath:path.resolve(executable),profilePath:path.resolve(profile),executableSha256:hash(executable)};let electron;
 try{
  electron=await _electron.launch({executablePath:executable,args:[],cwd:root,env,timeout:60000});
  const page=await electron.firstWindow();page.on('pageerror',error=>result.errors.push(error.message));await electron.context().setOffline(true);await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});
  result.userDataPath=path.resolve(await electron.evaluate(({app})=>app.getPath('userData')));assert.equal(result.userDataPath,path.resolve(profile));
  result.version=await page.evaluate(()=>MotionBenchDesktop.version);assert.equal(result.version,'2.24.1-desktop.1');
  const archive=path.join(path.dirname(executable),'resources/app.asar'),asar=require('@electron/asar');
  result.archiveSha256=hash(archive);result.runtimeHtmlSha256=crypto.createHash('sha256').update(asar.extractFile(archive,path.normalize('MotionBench.html'))).digest('hex');assert.equal(result.runtimeHtmlSha256,hash(path.join(root,'MotionBench.html')));
  const snapshot=await page.evaluate(async()=>{
   const library=await App.getRepository().exportLibrary(),reports=[];
   for(const athlete of library.athletes)for(const record of athlete.records){const effective=RingsideEvaluation.resolve(record,library.evaluationProfiles.find(p=>p.id===record.evaluationProfileId)),stats=RingsideModel.stats(effective);reports.push({recordId:record.recordId,values:stats.values,axes:stats.axes,evaluationResults:stats.evaluationResults,basis:RingsideModel.fingerprint(effective),narrative:record.narrative});}
   const model=App.getLongitudinal();
   const activeComparison=model?{athleteId:model.athleteId,recordIds:model.periods.map(period=>period.id),dates:model.periods.map(period=>period.date),improved:model.changeSummary?.improved.length,declined:model.changeSummary?.declined.length,document:App.getLongitudinalDocument()}:null;
   return{library,reports,activeComparison};
  });
  const snapshotFile=path.join(out,'snapshot.json');fs.writeFileSync(snapshotFile,JSON.stringify(snapshot,null,2));result.snapshotSha256=hash(snapshotFile);
  result.athletes=snapshot.library.athletes.length;result.records=snapshot.reports.length;
  const baselineFile=path.join(base,'verification/baseline/snapshot.json'),baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));result.baselineSha256=hash(baselineFile);
  const originalIds=new Set(baseline.library.athletes.map(owner=>owner.id)),originalOwners=snapshot.library.athletes.filter(owner=>originalIds.has(owner.id));
  assert.deepEqual(core(snapshot.library,baseline.library),core(baseline.library),'Every original raw record and shared library definition preserved');
  assert.deepEqual(canonical(originalOwners.flatMap(owner=>owner.records)),canonical(baseline.library.athletes.flatMap(owner=>owner.records)),'Complete original records including timestamps preserved');
  assert.deepEqual(canonical(snapshot.reports.filter(r=>baseline.reports.some(original=>original.recordId===r.recordId))),canonical(baseline.reports),'Every original single-report result and body preserved');
  assert.deepEqual(canonical((snapshot.library.longitudinalReports||[]).filter(doc=>originalIds.has(doc.athleteId))),canonical(baseline.library.longitudinalReports||[]),'Original comparison documents preserved');
  result.checks.push('Every original record, shared definition and manual body preserved','Every original single-report result and comparison narrative preserved');
  const extra=snapshot.library.athletes.filter(owner=>!originalIds.has(owner.id));assert.equal(extra.length,1);
  assert.equal(result.athletes,baseline.library.athletes.length+1);assert.equal(result.records,baseline.reports.length+4);
  const owner=extra[0];assert.equal(owner.profile.name,'示例运动员｜纵向比较（合成）');assert.equal(owner.records.length,4);assert.ok(owner.records.every(record=>record.athleteId===owner.id));assert.deepEqual(owner.records.map(record=>record.athlete.date).sort(),exampleDates);
  result.exampleAthleteId=owner.id;result.exampleRecordIds=owner.records.map(record=>record.recordId);assert.equal(new Set(result.exampleRecordIds).size,4);
  const comparison=snapshot.activeComparison;assert.ok(comparison);assert.equal(comparison.athleteId,owner.id);assert.deepEqual([...comparison.recordIds].sort(),[...result.exampleRecordIds].sort());assert.deepEqual(comparison.dates,exampleDates);assert.ok(comparison.improved>0);assert.ok(comparison.declined>0);
  assert.ok(comparison.document?.narrative?.text?.trim());assert.ok(owner.records.every(record=>record.narrative?.text?.trim()));
  result.checks.push('Requested four-date synthetic athlete restores active comparison with improvements and declines');
  const savedFile=path.join(base,'verification/examples/snapshot.json'),saved=JSON.parse(fs.readFileSync(savedFile,'utf8'));result.examplesSha256=hash(savedFile);
  assert.deepEqual(core(snapshot.library),core(saved.library),'Reopened example raw data and single-record bodies preserved');
  assert.deepEqual(canonical(snapshot.library.athletes.flatMap(athlete=>athlete.records)),canonical(saved.library.athletes.flatMap(athlete=>athlete.records)),'Reopened complete records including timestamps preserved');
  assert.deepEqual(canonical(snapshot.reports),canonical(saved.reports),'Reopened example calculations preserved');
  const documentKey=saved.activeComparison.document.key;
  assert.deepEqual(documentsSnapshot(snapshot.library.longitudinalReports,owner.id,documentKey),documentsSnapshot(saved.library.longitudinalReports,owner.id,documentKey),'Reopened comparison documents and bodies preserved');
  assert.deepEqual(activeSnapshot(snapshot.activeComparison,owner.id,documentKey),activeSnapshot(saved.activeComparison,owner.id,documentKey),'Reopened active comparison preserved');
  result.checks.push('Normal restart preserves saved example measurements single bodies comparison body and active dates');
  assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);
  const closed=electron.waitForEvent('close',{timeout:60000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;
  assert.deepEqual(result.errors,[]);assert.equal(hash(executable),result.executableSha256);assert.equal(hash(archive),result.archiveSha256);assert.equal(hash(__filename),result.runnerSha256);
  result.artifactUnchanged=true;result.checks.push('Native save barrier and normal window close passed');result.pass=true;
 }catch(error){result.failure=error.message;process.exitCode=1;console.error('Private normal-restart verification failed; inspect external receipt.');}
 finally{await electron?.close().catch(()=>{});fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({mode,pass:result.pass,athletes:result.athletes,records:result.records,checks:result.checks.length}));}
}
module.exports={documentSnapshot,documentsSnapshot,activeSnapshot,core};
if(require.main===module)main();
