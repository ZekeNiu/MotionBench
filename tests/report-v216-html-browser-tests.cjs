"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),source=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/report-v216");
const channel=process.argv.includes("--edge")?"msedge":"chrome",hash=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const evidence={channel,sourceHash:hash(source),synthetic:true,checks:[],errors:[],network:[],artifacts:[],pass:false};fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}}),page=await context.newPage();let reopened;
 const listen=p=>{p.on("pageerror",error=>evidence.errors.push(error.message));p.on("request",request=>{if(/^https?:/.test(request.url()))evidence.network.push(request.url());});p.on("dialog",dialog=>dialog.accept());};listen(page);
 const ready=async p=>{await p.waitForFunction(()=>!!window.App?.ready);assert.equal(await p.evaluate(()=>App.ready),true);};
 const snapshot=p=>p.evaluate(()=>{
   const state=App.getState(),r=RingsideEvaluation.materialize(state,App.getLibrary().evaluationProfiles.find(profile=>profile.id===state.evaluationProfileId)),s=App.stats();return{views:r.fvpView,overview:document.querySelector("#directionMetrics").innerText,
     bodyMarkers:[...document.querySelectorAll("#bodyChart .viz-region")].map(node=>({key:node.dataset.region,hasMeasured:JSON.parse(node.dataset.bodyDetail).hasMeasured})),
     references:s.isoAnalyses.map(row=>({id:row.id,sides:row.sides.map(side=>({side:side.side,target:side.target,targetKind:side.targetKind,comparison:side.referenceComparison,source:side.referenceSource}))})),
     raw:r.data,definitions:r.definitions.filter(definition=>definition.isoReference||definition.reference),pairs:r.balancePairs};
 });
 try{
  await page.goto(pathToFileURL(source).href);await ready(page);
  await page.evaluate(async()=>{
   await App.importPayload(RingsideModel.libraryDefaults(),"replace-library");const r=RingsideModel.sampleRecord();
   r.demo=false;r.recordId="v216-independent-html";r.athleteId="v216-independent-athlete";r.athlete.name="2.16 独立报告验收（模拟）";r.athlete.birthDate="1996-01-01";r.athlete.mass=72;r.athlete.dominantHand="右手";
   for(const [id,left,right] of [["iso_shoulder_internalRotation",358,242],["iso_hip_internalRotation",400,410],["iso_hip_externalRotation",280,320]]){
    const row=r.data.iso.find(item=>item.id===id);Object.assign(row,{left,right});if(Array.isArray(r.isoDirectionIds)&&!r.isoDirectionIds.includes(id))r.isoDirectionIds.push(id);
   }
   for(const row of r.data.iso.filter(item=>["shoulder","hip"].includes(item.region)&&[item.left,item.right].some(value=>RingsideModel.positive(value)!==null)))row.trials=[0,1,2].map(index=>({id:`${row.id}-trial-${index}`,left:row.left===""?"":Number(row.left)+index,right:row.right===""?"":Number(row.right)+index,painLeft:false,painRight:false}));
   const pair=r.balancePairs.find(item=>item.id==="shoulder_IR_ER");pair.reference=RingsideIsoReferences.defaultBalanceReference(pair);pair.ranges=Def.parseRanges("<0.6 | 模拟严重 | red\n[0.6..0.85) | 模拟关注 | amber\n>=0.85 | 模拟达标 | green");pair.referenceEnabled=true;pair.confirmed=true;pair.source="模拟验收区间（用于验证分级显示）";
   for(const id of ["fvp_sj","fvp_cmj"]){r.enabled[id]=true;r.fvpConfig[id].distanceCm=33;r.data[id]=[0,20,40,60,80].map((load,index)=>({id:`${id}-${index}`,load,height:[33,27,22,14,10][index],notes:"保留原始记录"}));}
   Object.assign(r.fvpView.fvp_sj,{responseForce:false,responseVelocity:false,responseBoth:true});Object.assign(r.fvpView.fvp_cmj,{responseForce:true,responseVelocity:false,responseBoth:false});r.fvpAnalysis.fvp_cmj.angle=30;
   await App.importPayload(RingsideModel.recordEnvelope(r));await App.showReport();
  });
  assert.equal(await page.evaluate(()=>App.saveNow()),true);const before=await snapshot(page);
  assert.ok(before.references.some(row=>row.sides.some(side=>side.targetKind==="reference"&&side.target>0)),"fixture must include an effective literature reference");
  assert.ok(before.bodyMarkers.length>0);assert.ok(before.bodyMarkers.every(region=>region.hasMeasured===true));
  await page.locator("#reportExportMenu").evaluate(node=>node.open=true);const pending=page.waitForEvent("download");
  await page.locator("#reportExportMenu").getByRole("button",{name:"本次测试 HTML（可编辑）",exact:true}).click();
  const download=await pending,file=path.join(out,`${channel}-independent-report.html`);assert.equal(await download.failure(),null);await download.saveAs(file);
  const html=fs.readFileSync(file,"utf8");assert.match(html,/id="embedded-data"/);assert.ok(html.length>1000000);
  evidence.html={path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file)};evidence.artifacts.push({...evidence.html,bytes:fs.statSync(file).size});
  evidence.checks.push("actual editable HTML is downloaded with embedded record data");
  reopened=await browser.newContext({offline:true,viewport:{width:1440,height:1000}});const standalone=await reopened.newPage();listen(standalone);
  await standalone.goto(pathToFileURL(file).href);await ready(standalone);await standalone.evaluate(()=>App.showReport());
  const after=await snapshot(standalone);assert.deepEqual(after,before);
  assert.equal(await standalone.locator('[data-fvp-view="responseForce"]').isChecked(),false);assert.equal(await standalone.locator('[data-fvp-view="responseBoth"]').isChecked(),true);
  await standalone.locator("[data-fvp-protocol]").selectOption("fvp_cmj");assert.equal(await standalone.locator('[data-fvp-view="responseForce"]').isChecked(),true);assert.equal(await standalone.locator('[data-fvp-view="responseBoth"]').isChecked(),false);
  assert.equal(await standalone.locator("#directionMetrics [data-overview-metric]").count(),7);
  evidence.checks.push("downloaded file opens offline in fresh storage and preserves both curve choices, overview, raw data and effective references");
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.network,[]);evidence.pass=true;
 }catch(error){evidence.failure=error.stack;console.error(error.stack);process.exitCode=1;}
 finally{evidence.sourceUnchanged=hash(source)===evidence.sourceHash;if(!evidence.sourceUnchanged){evidence.pass=false;process.exitCode=1;}fs.writeFileSync(path.join(out,`${channel}-html-results.json`),JSON.stringify(evidence,null,2));if(reopened)await reopened.close();await context.close();await browser.close();console.log(JSON.stringify({channel,pass:evidence.pass,checks:evidence.checks.length}));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
