"use strict";
// Isolated synthetic evidence only: never attach to a desktop or user profile.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),{createFixture}=require("./helpers/longitudinal-fixture.cjs");
const ROOT=path.resolve(__dirname,".."),arg=key=>{const i=process.argv.indexOf(key);return i<0?null:process.argv[i+1];};
const SOURCE=path.resolve(ROOT,arg("--source")||"MotionBench.html"),OUT=path.resolve(ROOT,arg("--artifact-dir")||"output/implementation-2.24.10/focused");
const channel=process.argv.includes("--edge")?"msedge":"chrome",hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main(){
 fs.mkdirSync(OUT,{recursive:true});
 const result={synthetic:true,channel,sourceHash:hash(SOURCE),runnerSha256:hash(__filename),checks:[],errors:[],artifacts:[],pass:false,startedAt:new Date().toISOString()};
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},offline:true,locale:"zh-CN",timezoneId:"Asia/Shanghai"});
 let page=await context.newPage(),ids,measurementsBefore,baseline,currentBefore;
 const watch=p=>{p.setDefaultTimeout(30000);p.on("pageerror",error=>result.errors.push(error.stack||error.message));p.on("dialog",dialog=>dialog.accept());};watch(page);
 const artifact=file=>result.artifacts.push({file:path.relative(ROOT,file).replaceAll("\\","/"),sha256:hash(file),bytes:fs.statSync(file).size});
 const ready=async p=>{await p.waitForFunction(()=>window.App?.ready);assert.equal(await p.evaluate(()=>App.ready),true);};
 const settle=async()=>{assert.equal(await page.evaluate(()=>App.saveNow()),true);await page.waitForFunction(()=>!document.getElementById("saveStatus").textContent.includes("正在保存"));};
 const check=async(name,run)=>{result.stage=name;console.log("START "+name);await run();result.checks.push(name);console.log("PASS "+name);};
 const panel=id=>page.locator(`[data-longitudinal-panel=${JSON.stringify(id)}]`).first();
 const specs=id=>panel(id).locator("[data-longitudinal-chart]").evaluateAll(nodes=>nodes.map(n=>JSON.parse(n.dataset.longitudinalChart)));
 const curve=id=>panel(id).locator("[data-longitudinal-chart]").evaluate(n=>JSON.stringify(JSON.parse(n.dataset.longitudinalChart).series));
 const table=id=>panel(id).evaluate(n=>n.closest(".detail-pair").querySelector("table").textContent);
 async function reveal(locator){
  const keys=await locator.evaluate(node=>{const keys=[];for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==="DETAILS"&&!p.open){p.dataset.focusedReveal="r"+keys.length;keys.push(p.dataset.focusedReveal);}return keys.reverse();});
  for(const key of keys)await page.locator(`[data-focused-reveal="${key}"] > summary`).click();
 }
 async function analysis(id,key,value){const input=panel(id).locator(`[data-longitudinal-analysis="${key}"]`);await reveal(input);if(await input.evaluate(n=>n.tagName)==="SELECT")await input.selectOption(String(value));else{await input.fill(String(value));await input.press("Tab");}await settle();}
 const select=async chosen=>{assert.equal(await page.evaluate(chosen=>App.selectRecords(chosen),chosen),true);await page.evaluate(()=>App.showReport(false));await settle();};
 async function snapshot(){return page.evaluate(async()=>{
  const digest=async value=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const lib=await App.getRepository().exportLibrary(),m=App.getLongitudinal(),d=App.getLongitudinalDocument();
  const measured=structuredClone(lib.athletes);for(const athlete of measured)for(const record of athlete.records){delete record.narrative;delete record.previousNarrative;delete record.updated;}
  return{records:await digest(lib.athletes),measurements:await digest(measured),shared:await digest({catalog:lib.catalog,evaluationProfiles:lib.evaluationProfiles,groups:lib.groups,testPlans:lib.testPlans}),
   basis:m?.basis,facts:await digest(App.facts()),body:d?.narrative?.text||App.getState().narrative.text,charts:d?.views?.charts||{},narrative:d?.narrative,
   current:m?.periods.map(p=>({jump:p.stats.fvp.fvp_sj.current,sprint:Object.fromEntries(["F0","V0","Pmax","slope"].map(k=>[k,p.stats.sprintFvp.model[k]]))})),periods:m?.periods.map(p=>({id:p.id,angle:p.record.fvpAnalysis.fvp_sj.angle,distance:p.record.sprintFvpAnalysis.targetDistanceM,jumpScenario:p.stats.fvp.fvp_sj.scenario,sprintScenario:p.stats.sprintElasticity.scenario})),
   stale:document.getElementById("interpState").textContent};
 });}
 const invariant=async()=>{const now=await snapshot();assert.equal(now.records,baseline.records,"every source record, saved condition and personal body remains exact");assert.equal(now.shared,baseline.shared);assert.equal(now.measurements,measurementsBefore);assert.deepEqual(now.current,currentBefore,"measured F0/V0/Pmax stay unchanged");assert.equal(now.body,baseline.body);return now;};
 async function download(kind,name){const file=path.join(OUT,name+"."+kind.toLowerCase()),pending=page.waitForEvent("download",{timeout:120000});pending.catch(()=>{});await page.evaluate(kind=>App["download"+kind](),kind);const item=await pending;assert.equal(await item.failure(),null);await item.saveAs(file);artifact(file);return file;}
 async function editBody(text){await page.locator("#reportNarrativeButton").click();await page.waitForFunction(()=>App.getUIState().mode==="entry");await page.locator("#interpEditor").fill(text);await page.locator("#workspaceBack").click();await settle();assert.equal(await page.locator("#narrativeView").innerText(),text);}
 const noRange=async()=>assert.equal(await page.locator('[data-fvp-view="range"],[data-longitudinal-option="range"],[data-action="fvp-range"]').count(),0);
 try{
  await page.goto(pathToFileURL(SOURCE).href);await ready(page);
  await check("personal empty interpretation is silent and both report actions are accessible 34px icons",async()=>{
   ids=await page.evaluate(async factory=>{
    const f=(0,eval)("("+factory+")")(window,2),M=RingsideModel,lib=M.libraryDefaults();
    f.records.forEach((r,i)=>{Object.keys(r.enabled).forEach(id=>r.enabled[id]=["fvp_sj","sprint_fvp"].includes(id));r.views.fvpProtocol="fvp_sj";r.evaluationProfileId=f.profile.id;r.narrative={text:"",html:"",origin:"manual",revision:0,basis:""};
     Object.assign(r.fvpAnalysis.fvp_sj,{angle:i?30:90,deltaForcePct:i?4:2,deltaVelocityPct:i?2:1});r.fvpView.fvp_sj.range="measured";Object.assign(r.sprintFvpAnalysis,{targetDistanceM:i?30:20,deltaForcePct:i?3:1,deltaVelocityPct:i?2:0});r.sprintFvpView.confidence=false;M.applyAge(r);});
    lib.catalog=f.catalog;lib.evaluationProfiles=[f.profile];lib.defaultEvaluationProfileId=f.profile.id;lib.athletes=[{id:f.athleteId,name:f.records[0].athlete.name,profile:M.profileFromRecord(f.records[0]),groupId:"",records:f.records,archived:false,deletedAt:null}];lib.activeAthleteId=f.athleteId;lib.activeRecordId=f.records[0].recordId;
    await App.importPayload(lib,"replace-library");await App.showReport(false);return f.records.map(r=>r.recordId);
   },createFixture.toString());await settle();measurementsBefore=(await snapshot()).measurements;
   assert.equal(await page.locator("#interpState").isVisible(),false);assert.equal(await page.locator("#narrativeView").innerText(),"");assert.doesNotMatch(await page.locator("#interpretation").innerText(),/尚未填写/);
   const edit=page.getByRole("button",{name:"编辑解读",exact:true});assert.equal(await edit.count(),1);assert.equal(await edit.textContent(),"");assert.equal(await edit.getAttribute("title"),"编辑解读");assert.equal(await edit.locator('svg[aria-hidden="true"]').count(),1);
   const sizes=await page.locator("#reportNarrativeButton,#reportAIButton").evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return[b.width,b.height];}));assert.deepEqual(sizes,[[34,34],[34,34]]);
   const file=path.join(OUT,"personal-empty-desktop.png");await page.locator("#interpretation").screenshot({path:file});artifact(file);
  });
  await check("personal icon edits its own body and literal coach prose survives save and reload",async()=>{
   await editBody("个人人工正文：尚未填写在这里是教练原文，应完整保留。");await page.reload();await ready(page);assert.equal(await page.evaluate(()=>App.getLongitudinal()),null);
   assert.equal(await page.locator("#narrativeView").innerText(),"个人人工正文：尚未填写在这里是教练原文，应完整保留。");assert.equal(await page.locator("#interpState").isVisible(),true);assert.equal((await snapshot()).measurements,measurementsBefore);
  });
  await check("legacy measured-range records show complete profiles without any range switch",async()=>{
   await noRange();const proof=await page.locator('[data-fvp-panel="fvp_sj"] [data-chart-kind="jumpFvp"]').evaluate(node=>{
    const[data,options]=JSON.parse(node.dataset.chartInput),canonical=text=>text.replace(/ringside-fvp-clip-\d+/g,"ringside-fvp-clip-id").replace(/ringside-viz-\d+/g,"ringside-viz-id");
    return{legacy:App.getState().fvpView.fvp_sj.range,same:canonical(RingsideViz.jumpFvp(data,{...options,range:"measured"}))===canonical(RingsideViz.jumpFvp(data,{...options,range:"full"})),points:data.points.length};
   });assert.equal(proof.legacy,"measured");assert.equal(proof.same,true);assert.ok(proof.points>=3);result.legacyRange=proof;
  });
  await check("comparison empty body is silent and icon edits only the independent comparison document",async()=>{
   const sourcesBefore=(await snapshot()).records;await select(ids);await noRange();assert.equal(await page.locator("#interpState").isVisible(),false);assert.equal(await page.locator("#narrativeView").innerText(),"");assert.doesNotMatch(await page.locator("#interpretation").innerText(),/尚未填写/);
   await editBody("纵向人工正文：尚未填写是原稿中的文字，保留并在分析条件变化后复核。");assert.equal((await snapshot()).records,sourcesBefore);
   await page.reload();await ready(page);assert.equal(await page.evaluate(()=>App.getLongitudinal().periods.length),2);assert.match(await page.locator("#narrativeView").innerText(),/纵向人工正文：尚未填写/);
   await page.evaluate(()=>{const d=App.getLongitudinalDocument();d.views.charts||={};d.views.charts["fvp_sj:profile"]={options:{range:"measured"}};App.showReport(false);});await settle();
   baseline=await snapshot();currentBefore=baseline.current;assert.equal(baseline.records,sourcesBefore);assert.equal(baseline.measurements,measurementsBefore);
  });
  await check("comparison conditions initially inherit each saved period and legacy clipping is ignored",async()=>{
   await noRange();for(const[id,key]of[["fvp_sj:profile","angle"],["sprint_fvp:profile","targetDistanceM"],["fvp_sj:elasticity","deltaForcePct"],["sprint_fvp:elasticity","deltaVelocityPct"]])assert.equal(await panel(id).locator(`[data-longitudinal-analysis="${key}"]`).inputValue(),"");
   assert.deepEqual(baseline.periods.map(p=>p.angle),[90,30]);assert.deepEqual(baseline.periods.map(p=>p.distance),[20,30]);assert.doesNotMatch(baseline.stale,/待复核/);
   const spec=(await specs("fvp_sj:profile"))[0];assert.ok(!spec.xRange||spec.xRange.min===0);for(const series of spec.series.filter(s=>s.label.includes("剖面")&&s.label.endsWith("F–V"))){assert.equal(series.points[0].x,0);assert.ok(Math.abs(series.points.at(-1).y)<1e-10);}
   const independent=await page.evaluate(()=>{const m=App.getLongitudinal(),d=App.getLongitudinalDocument(),built=RingsideLongitudinal.build(m.records,{athleteId:m.athleteId,mode:m.mode,profile:d.profileSnapshot,catalog:App.getLibrary().catalog});return built.basis===m.basis;});assert.equal(independent,true);await invariant();
  });
  await check("jump target direction updates optimum curve results facts and review without touching measurements",async()=>{
   const beforeCurve=await curve("fvp_sj:profile"),beforeTable=await table("fvp_sj:profile");await analysis("fvp_sj:profile","angle",30);const now=await invariant();
   assert.notEqual(await curve("fvp_sj:profile"),beforeCurve);assert.notEqual(await table("fvp_sj:profile"),beforeTable);assert.notEqual(now.facts,baseline.facts);assert.notEqual(now.basis,baseline.basis);assert.match(now.stale,/数据已更新 · 待复核/);assert.ok(now.periods.every(p=>p.angle===30));
  });
  await check("sprint target distance updates optimum and both related analyses under one saved comparison condition",async()=>{
   const before=await snapshot(),beforeCurve=await curve("sprint_fvp:profile"),beforeTable=await table("sprint_fvp:profile");await analysis("sprint_fvp:profile","targetDistanceM",10);const now=await invariant();
   assert.notEqual(await curve("sprint_fvp:profile"),beforeCurve);assert.notEqual(await table("sprint_fvp:profile"),beforeTable);assert.notEqual(now.facts,before.facts);assert.ok(now.periods.every(p=>p.distance===10));
   assert.equal(await page.evaluate(()=>App.getLongitudinal().capability.analyses.filter(a=>a.testId==="sprint_fvp").every(a=>a.periods.every(p=>p.analysis.targetDistanceM===10))),true);
  });
  await check("jump scenario inputs and reusable shortcuts update predictions while retaining the response curves",async()=>{
   const before=await snapshot(),beforeCurve=await curve("fvp_sj:elasticity"),beforeTable=await table("fvp_sj:elasticity");await analysis("fvp_sj:elasticity","deltaForcePct",8);await analysis("fvp_sj:elasticity","deltaVelocityPct",-2);let now=await invariant();
   assert.notEqual(await table("fvp_sj:elasticity"),beforeTable);assert.notEqual(now.facts,before.facts);assert.equal(await curve("fvp_sj:elasticity"),beforeCurve,"selected scenario must not redefine the full sensitivity sweep");
   for(const[key,force,velocity]of[["force",5,0],["velocity",0,5],["both",5,5]]){const button=panel("fvp_sj:elasticity").locator(`[data-longitudinal-scenario-shortcut="${key}"]`);await reveal(button);await button.click();await settle();const analysis=await page.evaluate(()=>App.getLongitudinalDocument().views.charts["fvp_sj:elasticity"].analysis);assert.equal(analysis.deltaForcePct,force);assert.equal(analysis.deltaVelocityPct,velocity);await invariant();}
  });
  await check("sprint scenario updates facts and scenario results while keeping saved source conditions and prose",async()=>{
   const before=await snapshot(),beforeTable=await table("sprint_fvp:elasticity"),beforeCurve=await curve("sprint_fvp:elasticity");await analysis("sprint_fvp:elasticity","deltaForcePct",7);await analysis("sprint_fvp:elasticity","deltaVelocityPct",3);const now=await invariant();
   assert.notEqual(await table("sprint_fvp:elasticity"),beforeTable);assert.notEqual(now.facts,before.facts);assert.equal(await curve("sprint_fvp:elasticity"),beforeCurve);assert.match(now.stale,/待复核/);
  });
  await check("analysis conditions and separate body survive refresh JSON reimport and editable HTML",async()=>{
   await settle();const expected=await snapshot();await page.reload();await ready(page);const reloaded=await invariant();for(const key of["basis","facts","charts","narrative"])assert.deepEqual(reloaded[key],expected[key],key);
   const jsonFile=await download("JSON","comparison-conditions"),htmlFile=await download("HTML","comparison-conditions"),payload=JSON.parse(fs.readFileSync(jsonFile,"utf8"));assert.equal(payload.kind,"longitudinal-report");
   const main=page;page=await context.newPage();watch(page);await page.goto(pathToFileURL(htmlFile).href);await ready(page);let restored=await invariant();for(const key of["basis","facts","charts","narrative"])assert.deepEqual(restored[key],expected[key],"HTML "+key);await noRange();
   await page.locator("#reportNarrativeButton").click();assert.equal(await page.locator("#interpEditor").innerText(),baseline.body);await page.locator("#workspaceBack").click();await page.close();page=main;
   await page.evaluate(async payload=>{await App.importPayload(payload,"replace-library");await App.showReport(false);},payload);await settle();restored=await invariant();for(const key of["basis","facts","charts","narrative"])assert.deepEqual(restored[key],expected[key],"JSON "+key);
  });
  await check("desktop and narrow layouts retain readable condition controls without page overflow",async()=>{
   await reveal(panel("fvp_sj:profile").locator('[data-longitudinal-analysis="angle"]'));
   for(const[width,height,name]of[[1440,1000,"desktop"],[390,900,"mobile"]]){await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==="running"&&a.effect?.getTiming().iterations!==Infinity));await page.evaluate(()=>RingsideLongitudinalView.layout(document.getElementById("reportView")));result.layout||={};result.layout[name]=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("body *")].map(n=>{const b=n.getBoundingClientRect();return{tag:n.tagName,id:n.id,classes:n.className?.baseVal??n.className,left:b.left,right:b.right,width:b.width};}).filter(b=>b.width>0&&(b.left<-.5||b.right>innerWidth+.5)).slice(0,60)}));assert.ok(result.layout[name].scrollWidth<=width+2,JSON.stringify(result.layout[name]));
    for(const id of["fvp_sj:profile","fvp_sj:elasticity","sprint_fvp:profile"]){const file=path.join(OUT,id.replaceAll(":","-")+"-"+name+".png");await reveal(panel(id).locator("[data-longitudinal-analysis]").first());await panel(id).screenshot({path:file});artifact(file);}
    const file=path.join(OUT,"interpretation-"+name+".png");await page.locator("#interpretation").screenshot({path:file});artifact(file);
   }await page.setViewportSize({width:1440,height:1000});await invariant();
  });
  if(!process.argv.includes("--skip-pdf"))await check("real focused PDF preserves full charts results and source state within five pages",async()=>{
   const data=await page.evaluate(async()=>{
    const m=App.getLongitudinal(),source=document.createElement("section");source.dataset.longitudinal="true";source.id="focusedPDFSource";
    for(const id of["fvp_sj:profile","fvp_sj:elasticity"]){const title=document.createElement("h3");title.textContent=id.endsWith("profile")?"跳跃FVP · SJ":"跳跃FVP弹性框架 · SJ";source.append(title,document.querySelector(`[data-longitudinal-panel="${id}"]`).closest(".detail-pair").cloneNode(true));}document.body.append(source);
    const before=source.outerHTML,actual=html2canvas,capture=[];window.html2canvas=async(node,options)=>{const body=node.querySelector(".ringside-pdf-content"),box=body.getBoundingClientRect();capture.push({controls:node.querySelectorAll("button,input,select,textarea,.no-print").length,charts:node.querySelectorAll("img[data-pdf-chart]").length,overflow:[...body.children].filter(n=>n.getBoundingClientRect().bottom>box.bottom+.8).map(n=>n.className),text:node.textContent});return actual(node,options);};
    try{const snapshot={...m.periods.at(-1).record,longitudinal:true,longitudinalDateRange:m.periods[0].date+" — "+m.periods.at(-1).date},blob=await RingsidePDF.build(snapshot,source),bytes=new Uint8Array(await blob.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return{pdf:btoa(binary),capture,diagnostics:RingsidePDF.lastDiagnostics,unchanged:source.outerHTML===before};}finally{window.html2canvas=actual;source.remove();}
   });assert.equal(data.unchanged,true);assert.equal(data.diagnostics.status,"complete");assert.ok(data.diagnostics.pageCount>=1&&data.diagnostics.pageCount<=5);assert.ok(data.capture.reduce((sum,p)=>sum+p.charts,0)>=2);for(const p of data.capture){assert.equal(p.controls,0);assert.deepEqual(p.overflow,[]);}for(const key of["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(data.diagnostics[key],[]);
   const file=path.join(OUT,"comparison-fvp-elasticity.pdf");fs.writeFileSync(file,Buffer.from(data.pdf,"base64"));artifact(file);result.pdf={capture:data.capture,diagnostics:data.diagnostics};await invariant();
  });
  assert.deepEqual(result.errors,[]);assert.equal(hash(SOURCE),result.sourceHash);assert.equal(hash(__filename),result.runnerSha256);result.pass=true;
 }catch(error){result.errors.push(error.stack||String(error));throw error;}finally{result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,"results.json"),JSON.stringify(result,null,2));await browser.close();}
 console.log(`${result.checks.length} focused report-control checks passed (${channel})`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
