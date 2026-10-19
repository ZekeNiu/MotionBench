"use strict";
// Reopened-library verification (normal startup refreshes only document.updated): immutable physical backup, compact complete report
// digests, and the unchanged 2.24.4 display-write guard. No fixture is imported.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {_electron,chromium}=require('./helpers/playwright.cjs'),P=require('./helpers/v2244-display-preservation.cjs'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),mode=process.argv[2],arg=key=>{const i=process.argv.indexOf(key);return i<0?null:process.argv[i+1];};
assert.ok(['baseline','candidate','installed','reopened'].includes(mode));
const base=String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261019-system-before-2.24.5`,installed=String.raw`D:\Application\Strength&Conditioning\MotionBench`,directory=path.join(base,'verification',mode);
fs.mkdirSync(directory,{recursive:true});assert.ok(!fs.existsSync(path.join(directory,'receipt.json')),'Preserve every previous receipt');
const hash=value=>createHash('sha256').update(value).digest('hex'),fileHash=file=>hash(fs.readFileSync(file)),read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const physical=['installed','reopened'].includes(mode),executable=path.join(mode==='candidate'?path.join(root,'dist-desktop/win-unpacked'):mode==='baseline'?path.join(base,'program'):installed,'MotionBench.exe'),archive=path.join(path.dirname(executable),'resources/app.asar');
const result={mode,pass:false,checks:[],errors:[],startedAt:new Date().toISOString(),runnerSha256:fileHash(__filename),guardSha256:fileHash(path.join(__dirname,'helpers/v2244-display-preservation.cjs')),manifestSha256:fileHash(path.join(base,'manifest.json')),executableSha256:fileHash(executable),archiveSha256:fileHash(archive),runtimeHtmlSha256:hash(asar.extractFile(archive,path.normalize('MotionBench.html'))),sourceHash:fileHash(path.join(root,'MotionBench.html')),actualProfile:physical};
assert.equal(result.guardSha256,'cf0f3ca402aebbaf9fdefa7eb2e48eab489eea139d6387e2ccd3ed3013681f02');
async function snapshot(page){return page.evaluate(async source=>{
 const proof=(0,eval)('('+source+')')(),digest=async value=>{const wire=JSON.parse(JSON.stringify(value,(_key,item)=>item instanceof Set?{type:'Set',values:[...item]}:item instanceof Map?{type:'Map',entries:[...item]}:item));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof.canonical(wire))))).map(n=>n.toString(16).padStart(2,'0')).join('');};
 const library=await App.getRepository().exportLibrary(),reports=[];
 for(const owner of library.athletes)for(const record of owner.records){const effective=RingsideEvaluation.resolve(record,library.evaluationProfiles.find(p=>p.id===record.evaluationProfileId));reports.push({recordId:record.recordId,sha256:await digest(RingsideReport.build(effective,{catalog:library.catalog}))});}
 const model=App.getLongitudinal(),active=model?{athleteId:model.athleteId,recordIds:model.periods.map(p=>p.id),dates:model.periods.map(p=>p.date),modelSha256:await digest(model),document:App.getLongitudinalDocument()}:null;
 return{library,reports,active};
 },P.createProof.toString());}
function protectedState(actual,reference,sample,document){
 P.library(actual.library,reference.library,sample,document);P.same(actual.reports,reference.reports,'Complete original single-report calculations changed');
 P.same(actual.active&&{...actual.active,document:null},reference.active&&{...reference.active,document:null},'Complete original comparison calculation or selection changed');
}
async function main(){
 let electron,browser,page,latestGuard,pid;
 try{
  if(physical){
   const receipt=read(arg('--launch-receipt'));assert.equal(receipt.method,'ShellWindows.FindWindowSW(8,1).Document.Application.ShellExecute');assert.equal(receipt.targetPath.toLowerCase(),executable.toLowerCase());assert.equal(receipt.targetSha256,result.executableSha256);assert.equal(receipt.windowStyle,'Normal');
   const probe=read(arg('--physical-before'));assert.equal(probe.parentName.toLowerCase(),'explorer.exe');assert.equal(probe.profile,String.raw`C:\Users\ZekeNiu\AppData\Roaming\MotionBench Desktop`);assert.ok(probe.resolvedFiles.every(f=>f.physical.toLowerCase().startsWith(('\\\\?\\'+probe.profile+'\\').toLowerCase())));result.launchReceiptSha256=fileHash(arg('--launch-receipt'));result.physicalProbeSha256=fileHash(arg('--physical-before'));
   browser=await chromium.connectOverCDP('http://127.0.0.1:'+arg('--cdp-port'));page=browser.contexts()[0].pages().find(p=>p.url().startsWith('motionbench://'));assert.ok(page);
   const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process -Filter \"name='MotionBench.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"],{encoding:'utf8'}));const inventory=Array.isArray(processes)?processes:[processes],parent=inventory.find(p=>p.CommandLine?.includes('--remote-debugging-port='+arg('--cdp-port'))&&!p.CommandLine.includes('--type='));assert.ok(parent);pid=parent.ProcessId;result.processId=pid;
   const renderer=inventory.find(p=>p.ParentProcessId===pid&&p.CommandLine?.includes('--type=renderer')),profile=renderer?.CommandLine.match(/--user-data-dir="([^"]+)"/)?.[1];assert.ok(profile);assert.equal(path.resolve(profile),path.resolve(probe.profile));result.profilePath=profile;
   execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class MB225Min{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);}';[MB225Min]::ShowWindow((Get-Process -Id ${pid}).MainWindowHandle,6)|Out-Null`]);
  }else{
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;electron=await _electron.launch({executablePath:executable,args:['--motionbench-test','--motionbench-data-dir='+path.join(base,'system-'+mode+'-profile')],cwd:root,env,timeout:60000});page=await electron.firstWindow();result.profilePath=await electron.evaluate(({app})=>app.getPath('userData'));assert.equal(path.resolve(result.profilePath),path.join(base,'system-'+mode+'-profile'));
   await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.hide();w.webContents.setBackgroundThrottling(false);});
  }
  page.on('pageerror',error=>result.errors.push(error.message));await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});result.versions=await page.evaluate(()=>({desktop:MotionBenchDesktop.version,web:MotionBenchDesktop.webVersion,build:RingsideBuild.version}));assert.equal(result.versions.desktop,mode==='baseline'?'2.24.4-desktop.1':'2.24.5-desktop.1');
  if(mode!=='baseline')assert.equal(result.runtimeHtmlSha256,result.sourceHash);result.checks.push('Exact native runtime version and packaged source identity');
  const before=await snapshot(page);assert.ok(before.active,'The existing comparison must reopen normally');const sample={athleteId:before.active.athleteId,documentKey:before.active.document.key,recordIds:before.active.recordIds,dates:before.active.dates},initial=before.active.document;
  result.counts={athletes:before.library.athletes.length,records:before.reports.length};result.sample=sample;
  if(mode!=='baseline'){
   const reference=read(path.join(base,'verification','baseline','snapshot.json'));protectedState(before,reference,sample,P.document(before.library,sample));
   const current=P.clone(initial),original=reference.active.document;for(const key of ['views','revision','updated'])current[key]=P.clone(original[key]);P.same(current,original,'Comparison body or basis changed');P.same(initial.views,original.views,'Original chart options dates metrics disclosure or scroll changed');
   if(mode==='reopened'){
    const saved=read(path.join(base,'verification','installed','snapshot.json')).active.document,restored=P.clone(initial),launch=read(arg('--launch-receipt'));
    P.timestamp(initial.updated,saved.updated,{start:launch.requestedAt,end:new Date().toISOString()});restored.updated=saved.updated;P.same(restored,saved,'Normal reopen changed a protected saved document field');
    result.startupTimestamp={previous:saved.updated,current:initial.updated,launchStartedAt:launch.requestedAt};
   }
   result.checks.push('Every original raw record timestamp narrative scheme catalog and complete report/comparison digest preserved');
   const ui=await page.evaluate(()=>({unset:[...document.querySelectorAll('#reportView .longitudinal-assessment')].filter(n=>['未设置评价','未启用评价标准','未设等级区间','未启用标准'].includes(n.textContent.trim())).length,mini:document.querySelectorAll('#reportView .longitudinal-fms-change').length,summary:!!document.querySelector('#reportView [data-change-direction="improved"] .micro-value.green')&&!!document.querySelector('#reportView [data-change-direction="declined"] .micro-value.red'),balance:document.querySelector('#reportView [data-iso-section="balance"]')?.textContent}));assert.equal(ui.unset,0);assert.ok(ui.mini>0&&ui.summary);assert.ok(ui.balance?.includes('关节平衡'));result.ui=ui;result.checks.push('New assessment labels summary colors FMS mini charts and joint balance render on original saved comparison');
  }
  await page.exposeFunction('__recordCloseGuard225',value=>{latestGuard=JSON.parse(value);fs.appendFileSync(path.join(directory,'close-guard.jsonl'),value+'\n');});
  await P.installGuard(page,before.library,sample,initial,result.startedAt);
  await page.evaluate(()=>{const put=RingsideLongitudinalStore.put;RingsideLongitudinalStore.put=(...args)=>{try{return put(...args);}finally{window.__recordCloseGuard225(JSON.stringify(__displayPreservation2244)).catch(()=>{});}};});
  assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);const after=await snapshot(page);latestGuard=await page.evaluate(()=>__displayPreservation2244);assert.deepEqual(latestGuard.blocked,[]);protectedState(after,before,sample,latestGuard.expectedDocument);result.checks.push('Unchanged strict guard proves normal save preserves full original library and calculations');
  if(electron){const closing=electron.waitForEvent('close',{timeout:60000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closing;electron=null;}
  else{execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-Process -Id ${pid};if(-not $p.CloseMainWindow()){throw 'Normal close rejected'};if(-not $p.WaitForExit(60000)){throw 'Normal close timed out'}`],{timeout:70000});await browser.close();browser=null;}
  result.normalClose=true;assert.deepEqual(latestGuard.blocked,[]);P.replay(latestGuard,initial,P.document(before.library,sample),sample,{start:result.startedAt,end:new Date().toISOString()},()=>{throw Error('Display actions are not part of this test');},true);
  after.library.longitudinalReports[after.library.longitudinalReports.findIndex(d=>d.key===sample.documentKey)]=P.clone(latestGuard.expectedDocument);after.active.document=P.clone(latestGuard.expectedDocument);
  fs.writeFileSync(path.join(directory,'snapshot.json'),JSON.stringify(after));result.snapshotSha256=fileHash(path.join(directory,'snapshot.json'));result.guard=latestGuard;result.checks.push('Normal native close with exact guard replay and saved document reference');
  assert.deepEqual(result.errors,[]);assert.equal(fileHash(__filename),result.runnerSha256);assert.equal(fileHash(archive),result.archiveSha256);assert.equal(fileHash(path.join(root,'MotionBench.html')),result.sourceHash);result.pass=true;
 }catch(error){result.failure=error.stack;console.error('Private verification failed; inspect checkpoint receipt.');process.exitCode=1;}
 finally{if(electron)await electron.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});result.completedAt=new Date().toISOString();fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({mode,pass:result.pass,checks:result.checks.length,counts:result.counts,normalClose:result.normalClose}));}
}
main();
