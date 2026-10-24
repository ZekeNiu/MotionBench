"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const {_electron}=require("./playwright.cjs"),{withDeadline,waitForNativeDownload,finishNativeRun,terminateOwnedTemporaryProcess}=require("./native-runner-limits.cjs");
const root=path.resolve(__dirname,"../.."),mode=process.argv[2],receiptPath=process.argv[3],executable=path.resolve(process.env.MOTIONBENCH_EXECUTABLE||"");assert.ok(["export-hang","close-refusal"].includes(mode));assert.ok(receiptPath&&fs.existsSync(executable));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-refinement-native-")),result={pass:false,synthetic:true,mode,profile,errors:[],startedAt:new Date().toISOString()},persist=()=>fs.writeFileSync(receiptPath,JSON.stringify(result,null,2));let electron,page,child;
async function normalClose(){assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);const closed=electron.waitForEvent("close",{timeout:10000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;electron=null;}
(async()=>{
 try{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  electron=await _electron.launch({executablePath:executable,args:["--motionbench-test","--motionbench-data-dir="+profile],cwd:root,env,timeout:30000});child=electron.process();result.ownedProcessId=child.pid;result.ownedSpawnfile=child.spawnfile;page=await electron.firstWindow();await page.waitForFunction(()=>window.App?.ready,null,{timeout:30000});assert.equal(path.resolve(await electron.evaluate(({app})=>app.getPath("userData"))),profile);
  if(mode==="export-hang")await waitForNativeDownload({trigger:()=>page.evaluate(()=>new Promise(()=>{})),read:async()=>null,timeout:1000,label:"Injected renderer export hang"});
  else{await page.evaluate(()=>{App.prepareDesktopClose=async()=>({ok:false,reason:"Synthetic injected close refusal"});});throw Error("Injected assertion before refused normal close");}
 }catch(error){result.errors.push(error.stack||String(error));persist();}
 finally{await finishNativeRun({result,persist,normalClose:electron?normalClose:null,forceTerminate:child?()=>terminateOwnedTemporaryProcess({child,executable,profile}):null},{normalCloseMs:5000,diagnosticMs:1000,forceMs:5000,otherMs:1000});process.exitCode=1;}
})();
