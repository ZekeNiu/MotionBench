"use strict";
// Original library snapshots stay in the external, private checkpoint.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {_electron}=require('./helpers/playwright.cjs');
const root=path.resolve(__dirname,'..'),mode=process.argv[2];
const base=String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.1`;
const exampleDates=['2026-09-01','2026-09-15','2026-09-29','2026-10-13'];
if(!['baseline','candidate','installed','examples','reopened'].includes(mode))throw Error('Specify verification mode');
const actual=['installed','examples','reopened'].includes(mode),allowExamples=['examples','reopened'].includes(mode)||process.argv.includes('--with-examples');
const executable=path.join(mode==='candidate'?path.join(root,'dist-desktop/win-unpacked'):String.raw`D:\Application\Strength&Conditioning\MotionBench`,'MotionBench.exe');
const profile=actual?path.join(process.env.APPDATA,'MotionBench Desktop'):path.join(base,mode+'-profile');
const out=path.join(base,'verification',mode);fs.mkdirSync(out,{recursive:true});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
function core(library,baseline){
 const value=structuredClone(library);
 for(const key of ['version','updated','activeAthleteId','activeRecordId','longitudinalReports'])delete value[key];
 if(baseline)value.athletes=value.athletes.filter(owner=>baseline.athletes.some(original=>original.id===owner.id));
 for(const owner of value.athletes){delete owner.updated;for(const record of owner.records)delete record.updated;}
 return canonical(value);
}
async function main(){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const args=mode==='reopened'?[]:['--motionbench-test','--motionbench-data-dir='+profile];
 const result={mode,pass:false,checks:[],errors:[],runnerSha256:hash(__filename),actualProfile:actual,normalStartup:!args.length,allowExamples,executablePath:path.resolve(executable),profilePath:path.resolve(profile),executableSha256:hash(executable)};let electron;
 try{
  electron=await _electron.launch({executablePath:executable,args,cwd:root,env,timeout:60000});
  const page=await electron.firstWindow();page.on('pageerror',error=>result.errors.push(error.message));await electron.context().setOffline(true);await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});
  result.userDataPath=path.resolve(await electron.evaluate(({app})=>app.getPath('userData')));assert.equal(result.userDataPath,path.resolve(profile));
  result.version=await page.evaluate(()=>MotionBenchDesktop.version);assert.equal(result.version,mode==='baseline'?'2.24.0-desktop.1':'2.24.1-desktop.1');
  const archive=path.join(path.dirname(executable),'resources/app.asar'),asar=require('@electron/asar');
  result.archiveSha256=hash(archive);result.runtimeHtmlSha256=crypto.createHash('sha256').update(asar.extractFile(archive,path.normalize('MotionBench.html'))).digest('hex');
  if(mode!=='baseline')assert.equal(result.runtimeHtmlSha256,hash(path.join(root,'MotionBench.html')));
  const snapshot=await page.evaluate(async()=>{
   const library=await App.getRepository().exportLibrary(),reports=[];
   for(const athlete of library.athletes)for(const record of athlete.records){const effective=RingsideEvaluation.resolve(record,library.evaluationProfiles.find(p=>p.id===record.evaluationProfileId)),stats=RingsideModel.stats(effective);reports.push({recordId:record.recordId,values:stats.values,axes:stats.axes,evaluationResults:stats.evaluationResults,basis:RingsideModel.fingerprint(effective),narrative:record.narrative});}
   const model=App.getLongitudinal();
   const activeComparison=model?{athleteId:model.athleteId,recordIds:model.periods.map(period=>period.id),dates:model.periods.map(period=>period.date),improved:model.changeSummary?.improved.length,declined:model.changeSummary?.declined.length,document:App.getLongitudinalDocument()}:null;
   return{library,reports,activeComparison};
  });
  const snapshotFile=path.join(out,'snapshot.json');fs.writeFileSync(snapshotFile,JSON.stringify(snapshot,null,2));result.snapshotSha256=hash(snapshotFile);
  result.athletes=snapshot.library.athletes.length;result.records=snapshot.reports.length;
  if(mode==='baseline')result.checks.push('Captured current installed original library and single-report results');
  else{
   const baselineFile=path.join(base,'verification/baseline/snapshot.json'),baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));result.baselineSha256=hash(baselineFile);
   assert.deepEqual(core(snapshot.library,baseline.library),core(baseline.library),'Every original raw record and shared library definition preserved');
   assert.deepEqual(canonical(snapshot.reports.filter(r=>baseline.reports.some(original=>original.recordId===r.recordId))),canonical(baseline.reports),'Every original single-report result and body preserved');
   const originalIds=new Set(baseline.library.athletes.map(owner=>owner.id));
   assert.deepEqual(canonical((snapshot.library.longitudinalReports||[]).filter(doc=>originalIds.has(doc.athleteId))),canonical(baseline.library.longitudinalReports||[]),'Original comparison documents preserved');
   result.checks.push('Every original record, shared definition and manual body preserved','Every original single-report result and comparison narrative preserved');
   const extra=snapshot.library.athletes.filter(owner=>!baseline.library.athletes.some(original=>original.id===owner.id));
   assert.equal(extra.length,allowExamples?1:0,'Only the requested synthetic athlete may be added');
   assert.equal(result.athletes,baseline.library.athletes.length+(allowExamples?1:0));assert.equal(result.records,baseline.reports.length+(allowExamples?4:0));
   if(allowExamples){
    assert.equal(extra[0].profile.name,'示例运动员｜纵向比较（合成）');assert.equal(extra[0].records.length,4);
    assert.ok(extra[0].records.every(record=>record.athleteId===extra[0].id));
    assert.deepEqual(extra[0].records.map(record=>record.athlete.date).sort(),exampleDates);
    result.exampleAthleteId=extra[0].id;result.exampleRecordIds=extra[0].records.map(record=>record.recordId);
    assert.equal(new Set(result.exampleRecordIds).size,4);
    const comparison=snapshot.activeComparison;
    assert.ok(comparison);assert.equal(comparison.athleteId,extra[0].id);assert.deepEqual([...comparison.recordIds].sort(),[...result.exampleRecordIds].sort());assert.deepEqual(comparison.dates,exampleDates);assert.ok(comparison.improved>0);assert.ok(comparison.declined>0);
    assert.ok(comparison.document?.narrative?.text?.trim());assert.ok(extra[0].records.every(record=>record.narrative?.text?.trim()));
    result.checks.push('Requested four-date synthetic athlete restores active comparison with improvements and declines');
   }
   if(mode==='reopened'){
    const savedFile=path.join(base,'verification/examples/snapshot.json'),saved=JSON.parse(fs.readFileSync(savedFile,'utf8'));result.examplesSha256=hash(savedFile);
    assert.deepEqual(core(snapshot.library),core(saved.library),'Reopened example raw data and single-record bodies preserved');
    assert.deepEqual(canonical(snapshot.reports),canonical(saved.reports),'Reopened example calculations preserved');
    assert.deepEqual(canonical(snapshot.library.longitudinalReports||[]),canonical(saved.library.longitudinalReports||[]),'Reopened comparison documents and bodies preserved');
    assert.deepEqual(canonical(snapshot.activeComparison),canonical(saved.activeComparison),'Reopened active comparison preserved');
    result.checks.push('Normal restart preserves saved example measurements single bodies comparison body and active dates');
   }
  }
  assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);
  const closed=electron.waitForEvent('close',{timeout:60000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;
  assert.deepEqual(result.errors,[]);assert.equal(hash(executable),result.executableSha256);assert.equal(hash(archive),result.archiveSha256);assert.equal(hash(__filename),result.runnerSha256);
  result.artifactUnchanged=true;result.checks.push('Native save barrier and normal window close passed');result.pass=true;
 }catch(error){result.failure=error.message;process.exitCode=1;console.error('Private preservation verification failed; inspect external receipt.');}
 finally{await electron?.close().catch(()=>{});fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({mode,pass:result.pass,athletes:result.athletes,records:result.records,checks:result.checks.length}));}
}
main();
