"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{execFile}=require("node:child_process");

async function withDeadline(operation,timeout,label){
  const controller=new AbortController();let timer;
  try{return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();const error=Error(label+" exceeded "+timeout+" ms");error.code="NATIVE_STEP_TIMEOUT";reject(error);},timeout);})]);}
  finally{clearTimeout(timer);}
}

async function waitForNativeDownload({trigger,read,timeout=60000,poll=100,label="Native download"}){
  return withDeadline(async signal=>{
    // The renderer may never resolve its export promise. It shares the same
    // deadline as native download completion instead of delaying that clock.
    await trigger();
    while(!signal.aborted){const item=await read();if(item)return item;await new Promise(resolve=>setTimeout(resolve,poll));}
    throw Error(label+" was cancelled");
  },timeout,label);
}

function requireOwnedTemporaryProcess({child,executable,profile,temporaryRoot=os.tmpdir()}){
  const resolved=path.resolve(profile),root=fs.realpathSync(temporaryRoot),actual=fs.realpathSync(resolved),relative=path.relative(root,actual);
  if(!relative||relative.startsWith("..")||path.isAbsolute(relative)||path.dirname(actual)!==root||!/^motionbench-refinement-native-[^\\/]+$/.test(path.basename(actual))||actual!==resolved)throw Error("Refusing to terminate a process outside the owned temporary profile");
  const equal=(left,right)=>process.platform==="win32"?path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase():path.resolve(left)===path.resolve(right);
  let args=child?.spawnargs,launchOwned=child?.spawnfile&&equal(child.spawnfile,executable);
  // Playwright uses cmd.exe for Windows executable paths requiring shell
  // quoting. Accept only its fully quoted, exact test command in that wrapper.
  const commandShell=path.join(process.env.WINDIR||"C:\\Windows","System32","cmd.exe");
  if(!launchOwned&&process.platform==="win32"&&child?.spawnfile&&equal(child.spawnfile,commandShell)&&Array.isArray(args)&&args.length===5&&args.slice(1,4).map(value=>value.toLowerCase()).join(" ")==="/d /s /c"){
    const command=args[4],inner=command.startsWith('"')&&command.endsWith('"')?command.slice(1,-1):"",tokens=[...inner.matchAll(/"([^"\r\n]*)"/g)].map(match=>match[1]);
    if(tokens.length>=3&&!inner.replace(/"[^"\r\n]*"/g,"").trim()&&equal(tokens[0],executable)&&tokens.every(value=>!/[!%\r\n]/.test(value))&&tokens.slice(1).every(value=>value==="--motionbench-test"||value==="--motionbench-data-dir="+resolved||/^--(?:inspect|remote-debugging-port)=\d+$/.test(value))){args=tokens;launchOwned=true;}
  }
  if(!child||!Number.isInteger(child.pid)||child.pid<=0||!launchOwned||!Array.isArray(args)||!equal(args[0],executable)||!args.includes("--motionbench-test")||!args.includes("--motionbench-data-dir="+resolved))throw Error("Refusing to terminate a process without the exact owned test launch identity");
  return child;
}

async function terminateOwnedTemporaryProcess(ownership,killTree){
  const child=requireOwnedTemporaryProcess(ownership);
  if(child.exitCode!==null||child.signalCode!==null)return false;
  if(killTree)await killTree(child.pid);
  else if(process.platform==="win32")await new Promise((resolve,reject)=>execFile("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{timeout:4000,windowsHide:true},error=>error&&child.exitCode===null?reject(error):resolve()));
  else child.kill("SIGKILL");
  return true;
}

async function finishNativeRun({result,persist,diagnostics,normalClose,forceTerminate,closeOtherResources},{diagnosticMs=5000,normalCloseMs=10000,forceMs=5000,otherMs=5000}={}){
  const record=(stage,error)=>{result.pass=false;(result.cleanupErrors||=[]).push({stage,error:error.stack||String(error)});};
  // A failure receipt survives even if renderer diagnostics or cleanup hang.
  persist();
  if(diagnostics)try{await withDeadline(diagnostics,diagnosticMs,"Native failure diagnostics");}catch(error){record("diagnostics",error);}finally{persist();}
  if(normalClose)try{await withDeadline(normalClose,normalCloseMs,"Native normal close");}catch(error){record("normal-close",error);persist();if(forceTerminate)try{result.forcedOwnedTemporaryTermination=await withDeadline(forceTerminate,forceMs,"Owned temporary process termination");}catch(forceError){record("owned-temporary-termination",forceError);}}
  if(closeOtherResources)try{await withDeadline(closeOtherResources,otherMs,"Native browser cleanup");}catch(error){record("browser-cleanup",error);}
  result.finishedAt=new Date().toISOString();persist();
}

module.exports={withDeadline,waitForNativeDownload,requireOwnedTemporaryProcess,terminateOwnedTemporaryProcess,finishNativeRun};
