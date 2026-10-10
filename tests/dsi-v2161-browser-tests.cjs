"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/v2161-dsi"),channel=process.argv.includes("--edge")?"msedge":"chrome";
fs.mkdirSync(out,{recursive:true});
const hash=()=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result={sourceHash:hash(),channel,synthetic:true,checks:[],errors:[],network:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.setDefaultTimeout(15000);page.on("pageerror",e=>result.errors.push(e.message));page.on("dialog",d=>d.accept());page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS "+name);};
 const open=tab=>page.evaluate(t=>App.openEntry(t),tab),fill=(p,v)=>page.locator(`[data-path="${p}"]`).fill(String(v));
 const status=()=>page.locator("[data-dsi-status]").innerText();
 const ready=()=>page.waitForFunction(()=>document.querySelector("[data-dsi-status]")?.dataset.dsiAvailable==="true");
 let baseline;
 async function restore(modify={}) {
   await page.evaluate(async({baseline,modify})=>{
     const r=JSON.parse(JSON.stringify(baseline));
     if(modify.cmj)r.data.cmj=modify.cmj.map((row,i)=>({id:r.data.cmj[i]?.id||crypto.randomUUID(),...row}));
     if(modify.cmjUnit)r.dsi.cmjUnit=modify.cmjUnit;
     if(modify.cmjDefinition)r.cmjConfig.definition=modify.cmjDefinition;
     if(modify.imtpUnit)r.imtpConfig.unit=modify.imtpUnit;
     if(modify.confirmed!==undefined)r.dsi.confirmed=modify.confirmed;
     if(modify.derivedEnabled!==undefined)r.derivedEnabled.fdsi=modify.derivedEnabled;
     await App.importPayload(RingsideModel.recordEnvelope(r));
   },{baseline,modify});
 }
 try{
   await page.goto(pathToFileURL(file).href);assert.equal(await page.evaluate(()=>App.ready),true);
   await check("real CMJ and IMTP entry retains unconfirmed comparison and exposes both force components",async()=>{
     await page.locator('[data-workspace-nav="entry"]').click();await page.locator('[name=creationAthleteMode][value=new]').check();await page.locator('#newAthleteName').fill('DSI 合成验收');await page.locator('#creationNext').click();
     for(const id of ['cmj','imtp'])await page.locator(`[data-creation-project="${id}"]`).check();await page.locator('#creationMass').fill('70');await page.locator('#creationSubmit').click();await page.waitForFunction(()=>App.getUIState().mode==='entry');
     await open('cmj');await fill('data.cmj.0.height',40);await fill('data.cmj.0.force',1500);assert.equal(await page.locator('[data-path="dsi.confirmed"]').isVisible(),true);
     await open('imtp');await fill('data.imtp.0.peakForce',2500);assert.equal(await page.locator('[data-path="dsi.confirmed"]').isVisible(),true);
     await page.waitForFunction(()=>document.querySelector('[data-dsi-components]')?.textContent.replace(/,/g,'').includes('2500'));
     assert.match(await status(),/确认/);assert.match((await page.locator('[data-dsi-components]').innerText()).replace(/,/g,''),/1500.*N.*2500.*N/);assert.equal(await page.evaluate(()=>App.getState().dsi.confirmed),false);assert.equal(await page.evaluate(()=>App.stats().raw.dsi),null);
   });
   await check("confirmation in IMTP calculates DSI and survives save refresh and CMJ navigation",async()=>{
     await page.locator('[data-path="dsi.confirmed"]').check();await ready();assert.match(await status(),/DSI.*0\.600/);assert.equal(await page.evaluate(()=>App.stats().raw.dsi),.6);await page.evaluate(()=>App.saveNow());
     await page.reload();assert.equal(await page.evaluate(()=>App.ready),true);await open('cmj');assert.equal(await page.locator('[data-path="dsi.confirmed"]').isChecked(),true);assert.match(await status(),/0\.600/);
     await page.evaluate(()=>App.showReport());assert.equal(await page.locator('[data-overview-metric="fdsi"]').count(),1);assert.equal(await page.locator('[data-capability-metric="fdsi"]').count(),1);baseline=await page.evaluate(()=>JSON.parse(JSON.stringify(App.getState())));
   });
   await check("changing force measurements refreshes the result without silently clearing an unchanged protocol confirmation",async()=>{
     await open('imtp');await fill('data.imtp.0.peakForce',3000);await page.waitForFunction(()=>document.querySelector('[data-dsi-status]')?.textContent.includes('0.500'));assert.equal(await page.evaluate(()=>App.getState().dsi.confirmed),true);assert.equal(await page.evaluate(()=>App.stats().raw.dsi),.5);
   });
   await check("changing measurement definitions and protocol invalidates the old comparison confirmation",async()=>{
     await restore();await open('imtp');await page.locator('[data-path="imtpConfig.definition"]').selectOption('net');assert.equal(await page.evaluate(()=>App.getState().dsi.confirmed),false);await page.waitForFunction(()=>document.querySelector('[data-dsi-status]')?.textContent.includes('净力'));assert.equal(await page.evaluate(()=>App.stats().raw.dsi),null);
     await page.locator('[data-path="imtpConfig.definition"]').selectOption('gross');await page.locator('[data-path="dsi.confirmed"]').check();await ready();await fill('protocol.imtp','合成测试协议 B');assert.equal(await page.evaluate(()=>App.getState().dsi.confirmed),false);await page.waitForFunction(()=>document.querySelector('[data-dsi-status]')?.textContent.includes('确认'));
   });
   await check("mixed force units remain blocked with the actual N and kgf labels",async()=>{
     await restore({imtpUnit:'kgf'});await open('imtp');assert.equal(await page.evaluate(()=>App.stats().raw.dsi),null);assert.match(await status(),/单位.*N.*kgf|N.*kgf.*单位/);assert.match((await page.locator('[data-dsi-components]').innerText()).replace(/,/g,''),/1500.*N.*2500.*kgf/);
   });
   await check("highest CMJ height without its force explains the missing paired measurement and does not borrow another trial",async()=>{
     await restore({cmj:[{height:40,force:1500},{height:42,force:''}]});await open('cmj');assert.equal(await page.evaluate(()=>App.stats().raw.dsi),null);assert.match(await status(),/代表.*试次.*峰值力|采用.*试次.*峰值力/);assert.equal(await page.evaluate(()=>Number(App.stats().raw.cmj.row.height)),42);assert.equal(await page.evaluate(()=>App.getState().data.cmj[0].force),1500);
   });
   await check("force-only CMJ explains that a height is required to select the representative attempt",async()=>{
     await restore({cmj:[{height:'',force:1500}]});await open('cmj');assert.equal(await page.evaluate(()=>App.stats().raw.dsi),null);assert.match(await status(),/垂直跳跃高度|跳跃高度/);assert.match(await status(),/代表|采用/);
   });
   await check("switching to another isometric source requires a fresh confirmation and uses its entered force",async()=>{
     await restore();await open('cmj');await page.locator('[data-path="dsi.source"]').selectOption('manual');assert.equal(await page.evaluate(()=>App.getState().dsi.confirmed),false);await fill('dsi.force',2000);await fill('dsi.protocol','合成全身等长测试');assert.equal(await page.evaluate(()=>App.stats().raw.dsi),null);await page.locator('[data-path="dsi.confirmed"]').check();await ready();assert.equal(await page.evaluate(()=>App.stats().raw.dsi),.75);assert.match(await status(),/0\.750/);
     await open('imtp');await fill('protocol.imtp','未用于 DSI 的另一协议');assert.equal(await page.evaluate(()=>App.getState().dsi.confirmed),true);assert.equal(await page.evaluate(()=>App.stats().raw.dsi),.75);
   });
   await check("an explicitly disabled DSI explains how to enable it without changing the switch or confirmation",async()=>{
     await restore({derivedEnabled:false});await open('imtp');assert.match(await status(),/未启用/);assert.equal(await page.evaluate(()=>App.getState().derivedEnabled.fdsi),false);assert.equal(await page.evaluate(()=>App.getState().dsi.confirmed),true);
   });
   await check("DSI status stays readable in both entry pages on desktop and mobile with no external requests or page errors",async()=>{
     await restore();for(const width of [1440,390]){await page.setViewportSize({width,height:900});for(const tab of ['cmj','imtp']){await open(tab);const panel=page.locator('[data-dsi-entry]');await panel.scrollIntoViewIfNeeded();assert.equal(await page.locator('[data-dsi-status]').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,tab+' '+width);await page.screenshot({path:path.join(out,channel+'-'+tab+'-entry-'+width+'.png')});}}assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);assert.equal(hash(),result.sourceHash);
   });
   result.pass=true;console.log(result.checks.length+' DSI browser checks passed');
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;await page.screenshot({path:path.join(out,channel+'-failure.png')}).catch(()=>{});}
 finally{await context.close();await browser.close();fs.writeFileSync(path.join(out,channel+(process.argv.includes('--baseline')?'-before':'')+'-results.json'),JSON.stringify(result,null,2));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
