"use strict";
// Private baseline/candidate/installed verification. All record snapshots stay in
// the explicit external checkpoint directory; stdout contains counts only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {_electron}=require('./helpers/playwright.cjs');
const root=path.resolve(__dirname,'..'),mode=process.argv[2],base=process.argv[3];
if(!['baseline','candidate','installed','reopened'].includes(mode)||!base||!path.isAbsolute(base))throw Error('Specify mode and absolute checkpoint directory');
const installed=String.raw`D:\Application\Strength&Conditioning\MotionBench`,candidate=path.join(root,'dist-desktop/win-unpacked');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));
const profile=mode==='baseline'||mode==='candidate'?path.join(base,mode+'-profile'):path.join(process.env.APPDATA,'MotionBench Desktop');
if(['baseline','candidate'].includes(mode)&&!fs.existsSync(profile))throw Error('Prepare verified profile copy before running');
const executable=path.join(mode==='candidate'?candidate:installed,'MotionBench.exe'),out=path.join(base,'verification',mode);fs.mkdirSync(out,{recursive:true});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
function core(library){const value=structuredClone(library);delete value.version;delete value.updated;delete value.activeAthleteId;delete value.activeRecordId;delete value.longitudinalReports;for(const athlete of value.athletes){delete athlete.updated;for(const record of athlete.records){delete record.updated;}}return canonical(value);}
async function main(){
 const env={...process.env,MOTIONBENCH_TEST_EXPORT_DIR:out};delete env.ELECTRON_RUN_AS_NODE;
 const args=mode==='reopened'?[]:['--motionbench-test','--motionbench-data-dir='+profile];
 const receipt={mode,checks:[],pass:false,runnerSha256:fileHash(__filename),actualData:['installed','reopened'].includes(mode),testArguments:args.length>0};
 let electron;
 try{
  electron=await _electron.launch({executablePath:executable,args,cwd:root,env,timeout:60000});
  await electron.context().setOffline(true);const page=await electron.firstWindow();await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});assert.equal(await page.evaluate(()=>App.ready),true);
  assert.equal(path.resolve(await electron.evaluate(({app})=>app.getPath('userData'))),path.resolve(profile));
  receipt.version=await page.evaluate(()=>MotionBenchDesktop.version);assert.equal(receipt.version,mode==='baseline'?'2.22.0-desktop.1':'2.24.0-desktop.1');
  const archive=path.join(path.dirname(executable),'resources/app.asar'),asar=require('../node_modules/@electron/asar');
  receipt.archiveSha256=fileHash(archive);receipt.runtimeHtmlSha256=hash(asar.extractFile(archive,path.normalize('MotionBench.html')));
  if(mode!=='baseline')assert.equal(receipt.runtimeHtmlSha256,fileHash(path.join(root,'MotionBench.html')));
  const snapshot=await page.evaluate(async()=>{
   const library=await App.getRepository().exportLibrary(),reports=[];
   for(const athlete of library.athletes)for(const record of athlete.records){
    const effective=RingsideEvaluation.resolve(record,library.evaluationProfiles.find(p=>p.id===record.evaluationProfileId)),stats=RingsideModel.stats(effective);
    reports.push({recordId:record.recordId,values:stats.values,axes:stats.axes,evaluationResults:stats.evaluationResults,basis:RingsideModel.fingerprint(effective),narrative:record.narrative});
   }
   return{library,reports};
  });
  const file=path.join(out,'snapshot.json');fs.writeFileSync(file,JSON.stringify(snapshot,null,2));receipt.snapshotSha256=fileHash(file);
  receipt.athletes=snapshot.library.athletes.length;receipt.records=snapshot.reports.length;
  if(mode!=='baseline'){
   const baselineFile=path.join(base,'verification/baseline/snapshot.json'),baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));receipt.baselineSha256=fileHash(baselineFile);
   assert.deepEqual(core(snapshot.library),core(baseline.library),'Original library remains unchanged');
   assert.deepEqual(canonical(snapshot.reports),canonical(baseline.reports),'Every original report result/reference/body/basis remains unchanged');
   receipt.checks.push('All original records, IDs, contexts, measurements, definitions, schemes, catalogue, groups and manual narratives preserved','Every original report value, score, reference and analysis basis preserved');
  }else receipt.checks.push('Captured complete original library and all single-report results from installed 2.22.0');
  if(mode==='candidate'){
   const owner=snapshot.library.athletes.find(a=>!a.archived&&!a.deletedAt&&a.records.filter(r=>!r.archived&&!r.deletedAt&&/^\d{4}-\d{2}-\d{2}$/.test(r.athlete.date)).length>=2);
   assert.ok(owner,'Existing athlete with repeated records');const ids=owner.records.filter(r=>!r.archived&&!r.deletedAt&&/^\d{4}-\d{2}-\d{2}$/.test(r.athlete.date)).slice(0,3).map(r=>r.recordId);
   await page.evaluate(async({aid,ids})=>{await App.openManagedRecord(aid,ids[0]);await App.selectRecords(ids);},{aid:owner.id,ids});
   assert.equal(await page.evaluate(()=>App.getLongitudinal()?.periods.length),ids.length);
   const after=await page.evaluate(()=>App.getRepository().exportLibrary());assert.deepEqual(core(after),core(snapshot.library),'Comparison did not modify original library records');
   receipt.checks.push('Longitudinal comparison of existing records on protected copy preserves full original library');
   await page.evaluate(async({aid,rid})=>{await App.openManagedRecord(aid,rid);},{aid:snapshot.library.activeAthleteId,rid:snapshot.library.activeRecordId});
  }
  assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);
  const closed=electron.waitForEvent('close',{timeout:60000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;
  receipt.checks.push(mode==='reopened'?'Normal startup without test flags and normal close on original user profile passed':'Save barrier and normal native window close passed');receipt.pass=true;
 }catch(error){receipt.failure=error.message;process.exitCode=1;console.error('Private preservation check failed; inspect external receipt.');}
 finally{await electron?.close().catch(()=>{});fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({mode,pass:receipt.pass,version:receipt.version,athletes:receipt.athletes,records:receipt.records,checks:receipt.checks.length}));}
}
main();
