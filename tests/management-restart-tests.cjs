"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/management"),result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),pass:false,cases:[]};
(async()=>{
 for(const channel of ["chrome","msedge"]){
  const directory=fs.mkdtempSync(path.join(out,channel+"-restart-")),row={channel,pass:false,errors:[]};let context;
  async function launch(){context=await chromium.launchPersistentContext(directory,{channel,headless:true,offline:true,viewport:{width:1440,height:960}});const page=context.pages()[0]||await context.newPage();page.on("pageerror",e=>row.errors.push(e.message));page.on("dialog",d=>d.accept());const start=Date.now();await page.goto(pathToFileURL(file).href);assert.equal(await page.evaluate(()=>App.ready),true);return{page,readyMs:Date.now()-start};}
  try{
   let {page}=await launch();await page.evaluate(()=>App.openManagement("backup"));await page.locator('#backupImportMode').selectOption("replace");await page.locator('#importFile').setInputFiles(path.join(out,channel+"-capacity.motionbench.jsonl"));await page.waitForFunction(()=>App.getLibrary().athletes.reduce((n,a)=>n+a.records.length,0)===3000,null,{timeout:60000});
   await page.evaluate(async()=>{App.getState().athlete.notes="独立浏览器进程重启验收（模拟）";if(!await App.saveNow())throw Error("save failed");});await context.close();context=null;
   const start=Date.now(),restarted=await launch();page=restarted.page;row.processRestartMs=Date.now()-start;row.listReadyMs=restarted.readyMs;
   const data=await page.evaluate(()=>({athletes:App.getLibrary().athletes.length,records:App.getLibrary().athletes.reduce((n,a)=>n+a.records.length,0),groups:App.getLibrary().groups.length,profiles:App.getLibrary().evaluationProfiles.length,note:App.getState().athlete.notes}));
   assert.equal(data.athletes,300);assert.equal(data.records,3000);assert.equal(data.groups,10);assert.equal(data.profiles,1);assert.equal(data.note,"独立浏览器进程重启验收（模拟）");assert.ok(row.listReadyMs<=3000);assert.deepEqual(row.errors,[]);row.pass=true;console.log("PASS",channel,"separate browser process restart",row.processRestartMs,"ms; library ready",row.listReadyMs,"ms");
  }catch(error){row.failure=error.stack;console.error(error.stack);process.exitCode=1;}finally{if(context)await context.close();result.cases.push(row);}
 }
 result.pass=result.cases.every(c=>c.pass);fs.writeFileSync(path.join(out,"restart.json"),JSON.stringify(result,null,2));
})();
