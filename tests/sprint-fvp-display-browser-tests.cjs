"use strict";
// Compiled production HTML, actual downloads, isolated synthetic profiles only.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{execFileSync}=require("node:child_process");
const {chromium}=require("./helpers/playwright.cjs"),ExcelJS=require("../vendor/exceljs.min.js");
const {manifest,columns,firstRow}=require("./helpers/excel-template.cjs");
const root=path.resolve(__dirname,"..");
const option=(name,fallback)=>{const arg=process.argv.find(a=>a.startsWith(name+"="));if(arg)return arg.slice(name.length+1);const i=process.argv.indexOf(name);if(i<0)return fallback;if(!process.argv[i+1]||process.argv[i+1].startsWith("--"))throw Error(name+" requires a value");return process.argv[i+1];};
const source=path.resolve(root,option("--source","MotionBench.html")),channel=process.argv.includes("--edge")?"msedge":"chrome";
const out=path.resolve(root,option("--artifact-dir","output/playwright/sprint-display-2.17.5/final"));
const relative=path.relative(path.join(root,"output/playwright/sprint-display-2.17.5"),out);
if(relative.startsWith("..")||path.isAbsolute(relative))throw Error("Use the independent sprint-display-2.17.5 artifact namespace");
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const specFile=path.join(root,"tests/fixtures/sprint-display-spec.json"),spec=JSON.parse(fs.readFileSync(specFile,"utf8"));
assert.equal(spec.synthetic,true);assert.equal(hash(path.join(root,spec.baseFixture)),spec.baseFixtureSha256);
for(const fixture of spec.legacyExcel)assert.equal(hash(path.join(root,fixture.path)),fixture.sha256);
const sourceHash=hash(source);assert.equal(sourceHash,option("--expect-sha",sourceHash));
const curveKeys=["fv","pv","optimum"],metricKeys=["F0","V0","Pmax","F0Absolute","PmaxAbsolute","slope","RFmax","DRF","Vmax","endVelocity","Vopt"];
const checkRegistry=["legacy missing display fields use defaults without changing measured history","4/6 templates append empty trials without replacing existing data","free split editing and mode conversion preserve timing and isolate undo","invalid drafts and incomplete trials reject mode changes atomically","flexible positive distances fit without old distance thresholds","curve switches independently control current and optimal artwork","all eleven parameter switches independently control displayed rows","confidence uses real split n and df and leaves point estimates unchanged","unavailable and future confidence methods expose reasons","target distance and display choices survive save reload and reopening","1440 and 390 preserve three graph regions and independent card folding","JSON and JSONL downloads restore all sprint display and scientific fields","editable HTML restores display choices and selected artwork offline","current Excel settings preserve nondefault display and raw data","legacy schema1 and schema2 Excel files migrate without altering measurements",...(process.argv.includes("--pdf")?["actual PDF uses selected curves rows and confidence metadata"]:[])];
const result={channel,synthetic:true,sourceHash,packageVersion:JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version,
  runnerSha256:hash(__filename),helperSha256:{playwright:hash(path.join(__dirname,"helpers/playwright.cjs")),excelTemplate:hash(path.join(__dirname,"helpers/excel-template.cjs"))},
  fixtureHashes:[{path:path.relative(root,specFile).replaceAll("\\","/"),sha256:hash(specFile)},{path:spec.baseFixture,sha256:hash(path.join(root,spec.baseFixture))},
    ...spec.legacyExcel,...["baseline-fixtures.json","baseline-sprint-library.json"].map(name=>({path:"tests/fixtures/sprint-display-v2173/"+name,sha256:hash(path.join(root,"tests/fixtures/sprint-display-v2173",name))}))],gitHeadAtRun:execFileSync("git",["--no-optional-locks","rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),
  startedAt:new Date().toISOString(),checkRegistry,checks:[],failures:[],errors:[],network:[],artifacts:[],layouts:[],pass:false};
fs.mkdirSync(out,{recursive:true});
const artifact=(file,kind)=>{const data={path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file),bytes:fs.statSync(file).size,kind};result.artifacts.push(data);return data;};
const write=(name,data)=>{const file=path.join(out,channel+"-"+name);fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");artifact(file,"synthetic-json");return file;};
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
const exact=(a,b,label)=>assert.ok(JSON.stringify(canonical(a))===JSON.stringify(canonical(b)),label);
const subset=r=>({raw:r.data.sprint_fvp,config:r.sprintFvpConfig,analysis:r.sprintFvpAnalysis,view:r.sprintFvpView,selections:r.views.capabilitySelections});
const trialMeasurements=rows=>rows.map(({id,splits,...trial})=>({...trial,splits:splits.map(({id,...split})=>split)}));
const scientificSubset=r=>({...subset(r),raw:trialMeasurements(r.data.sprint_fvp)});
let canonicalMain=null;
function modelTime(distance){let lo=0,hi=20;for(let i=0;i<80;i++){const t=(lo+hi)/2;if(9*(t+1.2*(Math.exp(-t/1.2)-1))<distance)lo=t;else hi=t;}return(lo+hi)/2;}
function makeRecord(suffix="") {
  if(!suffix&&canonicalMain)return structuredClone(canonicalMain);
  const base=JSON.parse(fs.readFileSync(path.join(root,spec.baseFixture),"utf8")).library.athletes[0].records[0];
  const r=structuredClone(base);r.demo=false;r.recordId=spec.recordId+suffix;r.athleteId=spec.athleteId+suffix;
  r.athlete.name="Synthetic sprint display"+suffix;r.athlete.mass=spec.massKg;r.athlete.height=spec.heightCm;
  r.sprintFvpVersion=1;r.enabled.sprint_fvp=true;
  r.sprintFvpConfig={heightCm:"",temperatureC:20,pressureHpa:1013.25,windMps:0,device:"Synthetic timing fixture",startConvention:"first_propulsive_action",timingStart:"first_propulsive_action",inputTimeMode:"cumulative",timeCorrectionS:0,positionStartM:0,methodVersion:"samozino-2016-splits-v1",sampleStepS:.1,rfAfterS:.3,samplingWindow:"terminal_time"};
  r.sprintFvpAnalysis={targetDistanceM:""};delete r.sprintFvpView;
  r.data.sprint_fvp=[{id:"display-trial"+suffix,splits:spec.splits.map((s,i)=>({id:"display-split-"+i+suffix,...s})),excluded:false,exclusionReason:"",notes:"Six independent synthetic timing observations"}];
  r.views.capabilitySelections={strength:"fvp",reactive:"dj_rsi",speed:"sprint_fvp"};return r;
}
(async()=>{
  const browser=await chromium.launch({channel,headless:true}),contexts=[];
  const observe=p=>{p.setDefaultTimeout(20000);p.on("pageerror",e=>result.errors.push(e.message));p.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});p.on("dialog",d=>d.accept());};
  const ready=async p=>{await p.waitForFunction(()=>window.App?.ready);assert.equal(await p.evaluate(()=>App.ready),true);};
  const newPage=async()=>{const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000},reducedMotion:"reduce"});contexts.push(context);const p=await context.newPage();observe(p);await p.goto(pathToFileURL(source).href);await ready(p);return p;};
  let page,expected;
  const state=()=>page.evaluate(()=>App.getState());
  const solve=()=>page.evaluate(()=>RingsideSprintFVP.solve(App.getState()));
  const physics=()=>page.evaluate(()=>({solve:RingsideSprintFVP.solve(App.getState()),directions:RingsideModel.capabilityDirections(App.getState(),App.stats()),raw:App.getState().data.sprint_fvp,config:App.getState().sprintFvpConfig,analysis:App.getState().sprintFvpAnalysis}));
  const save=async()=>assert.equal(await page.evaluate(()=>App.saveNow()),true);
  const load=async r=>{await page.evaluate(r=>App.importPayload(RingsideModel.recordEnvelope(r)),r);await page.evaluate(()=>App.showReport());};
  const selector=key=>page.locator(`[data-path="${key}"]`);
  const openSettings=async()=>{const node=page.locator("[data-sprint-fvp-display-settings]");if(!await node.evaluate(n=>n.open))await node.locator("summary").click();assert.equal(await node.evaluate(n=>n.open),true);};
  const setView=async values=>{for(const [key,value]of Object.entries(values)){const input=page.locator(`[data-sprint-fvp-view="${key}"]`);if(await input.isChecked()!==value)await input.setChecked(value);}};
  const setMetrics=async enabled=>{await openSettings();for(const key of metricKeys){const input=page.locator(`[data-sprint-fvp-metric="${key}"]`),value=enabled.includes(key);if(await input.isChecked()!==value)await input.setChecked(value);}};
  const metricRows=()=>page.locator("[data-sprint-fvp-panel] .sprint-fvp-result-table tr[data-metric-id]").evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.metricId,text:n.innerText,cells:[...n.cells].map(c=>c.innerText)})));
  const artwork=()=>page.locator('[data-sprint-fvp-panel] [data-chart-kind="sprintFvp"] svg').evaluate(node=>({title:node.getAttribute("aria-label"),text:node.textContent,description:node.querySelector("desc")?.textContent||"",polylines:node.querySelectorAll("polyline").length,optimalLines:node.querySelectorAll('[stroke-dasharray="7 5"]').length,bands:[...node.querySelectorAll("[data-sprint-fvp-confidence-band]")].map(n=>n.dataset.sprintFvpConfidenceBand),invalid:/NaN|Infinity/.test(node.outerHTML)}));
  const ci=()=>page.locator("[data-sprint-fvp-confidence-status]").evaluate(n=>({available:n.dataset.confidenceAvailable==="true",version:n.dataset.confidenceVersion,n:Number(n.dataset.confidenceN),df:Number(n.dataset.confidenceDf),metadata:JSON.parse(n.dataset.sprintFvpConfidenceMeta),text:n.innerText}));
  const download=async(name,trigger)=>{const pending=page.waitForEvent("download",{timeout:240000});await trigger();const dl=await pending;assert.equal(await dl.failure(),null);const file=path.join(out,channel+"-"+name);await dl.saveAs(file);artifact(file,"download");return file;};
  const shot=async(name,locator)=>{
    await page.waitForFunction(()=>!document.body.hasAttribute("aria-busy")&&(!document.querySelector("#toast")||getComputedStyle(document.querySelector("#toast")).display==="none")&&!/失败|校验|正在/.test(document.querySelector("#saveStatus")?.textContent||""));
    const original=page.viewportSize(),box=await locator.boundingBox();assert.ok(box&&box.width>0&&box.height>0);
    await page.setViewportSize({width:original.width,height:Math.max(original.height,Math.ceil(box.height)+180)});
    await locator.evaluate(n=>scrollTo(0,n.getBoundingClientRect().top+scrollY-90));
    const file=path.join(out,channel+"-"+name+".png");try{await locator.screenshot({path:file,animations:"disabled"});}finally{await page.setViewportSize(original);}return artifact(file,"screenshot");
  };
  const check=async(name,run)=>{assert.equal(name,checkRegistry[result.checks.length]);await run();result.checks.push(name);console.log("PASS",name);};
  async function importExcel(file) {
    await page.evaluate(()=>App.openEntry("sprint_fvp"));await page.getByRole("button",{name:"导入 Excel 文件",exact:true}).click();
    await page.locator("#excelFile").setInputFiles(file);await page.waitForFunction(()=>!RingsideExcelFlow.isBusy());
    assert.equal(await page.locator("#excelConfirm").isDisabled(),false);
    await page.locator('[data-excel-project="sprint_fvp"]').selectOption("replace");
    await page.locator("#excelConfirm").click();
    await page.waitForFunction(()=>!RingsideExcelFlow.isBusy()&&(!document.querySelector("#excelModal").classList.contains("show")||document.querySelector("#excelContent [role='status']")||!document.querySelector("#excelError").hidden));
    assert.equal(await page.locator("#excelError").isVisible(),false,await page.locator("#excelError").innerText());
    if(await page.locator("#excelModal").isVisible()){const status=await page.locator("#excelContent [role='status']").innerText();assert.match(status,/导入完成/);(result.excelImports||=[]).push({file:path.basename(file),status});await page.locator("#excelFooter").getByRole("button",{name:"完成",exact:true}).click();}
    await page.locator("#excelModal").waitFor({state:"hidden"});await save();
  }
  try {
    page=await newPage();result.buildProducerVersion=await page.evaluate(()=>window.RingsideBuild?.version);
    await check(checkRegistry[0],async()=>{
      const r=makeRecord();await load(r);const s=await state();assert.equal((await solve()).valid,true);
      exact(s.data.sprint_fvp,r.data.sprint_fvp,"History raw timing unchanged");assert.deepEqual(s.sprintFvpView,await page.evaluate(()=>RingsideModel.sprintFvpViewDefaults()));
      assert.equal(s.sprintFvpView.confidence,false);assert.equal(await page.locator("[data-sprint-fvp-panel] h3").innerText(),"冲刺FVP");
      assert.deepEqual((await metricRows()).map(r=>r.id),metricKeys);const graph=await artwork();assert.equal(graph.polylines,4);assert.deepEqual(graph.bands,[]);
      await save();await page.reload();await ready(page);await page.evaluate(()=>App.showReport());exact((await state()).data.sprint_fvp,r.data.sprint_fvp,"Reload preserves measured history");
      const beforeExcel=await state();await page.evaluate(()=>App.openEntry("sprint_fvp"));
      const template=await download("history-normalization.xlsx",()=>page.getByRole("button",{name:"下载 Excel 模板",exact:true}).click());
      await selector("data.sprint_fvp.0.splits.0.timeS").fill(String(Number(beforeExcel.data.sprint_fvp[0].splits[0].timeS)+.001));await save();await importExcel(template);
      const afterExcel=await state();exact(scientificSubset(afterExcel),scientificSubset(beforeExcel),"Real Excel replacement preserves every measurement and setting");
      assert.equal(afterExcel.recordId,beforeExcel.recordId);assert.equal(afterExcel.athleteId,beforeExcel.athleteId);
      result.excelInternalIdentity={recordIdPreserved:true,athleteIdPreserved:true,measurementFieldsExactlyPreserved:true,before:beforeExcel.data.sprint_fvp,after:afterExcel.data.sprint_fvp,contract:"Existing Excel attempt/split positions reconstruct internal trial/split ids; JSON and JSONL retain full ids."};
      canonicalMain=afterExcel;await page.evaluate(()=>App.showReport());
    });
    await check(checkRegistry[1],async()=>{
      await load(makeRecord("-entry"));await page.evaluate(()=>App.openEntry("sprint_fvp"));
      const original=(await state()).data.sprint_fvp[0];
      assert.equal(await page.locator("[data-sprint-fvp-entry-settings]").evaluate(n=>n.open),false);
      assert.equal(await selector("sprintFvpConfig.heightCm").getAttribute("placeholder"),"180");assert.equal(await selector("sprintFvpConfig.heightCm").inputValue(),"");
      assert.equal((await state()).sprintFvpConfig.timeCorrectionS,0);assert.equal((await state()).sprintFvpAnalysis.targetDistanceM,"");
      for(const template of ["four","six"])await page.locator(`[data-sprint-fvp-template="${template}"]`).click();
      const rows=(await state()).data.sprint_fvp;exact(rows[0],original,"Templates append without replacing existing trials");
      assert.deepEqual(rows[1].splits.map(s=>s.distanceM),[5,10,20,30]);assert.deepEqual(rows[2].splits.map(s=>s.distanceM),[5,10,15,20,25,30]);assert.ok(rows.slice(1).every(r=>r.splits.every(s=>s.timeS==="")));
      assert.equal(new Set(rows.flatMap(r=>r.splits.map(s=>s.id))).size,16);result.entryTemplates={four:rows[1],six:rows[2],existingPreserved:true};
    });
    await check(checkRegistry[2],async()=>{
      await page.locator('[onclick="App.addSprintSplit(0)"]').click();await selector("data.sprint_fvp.0.splits.6.distanceM").fill("35.5");await selector("data.sprint_fvp.0.splits.6.timeS").fill(String(modelTime(35.5)));
      assert.equal((await solve()).valid,true);assert.equal((await solve()).targetDistanceM,35.5);
      await page.locator('[onclick="App.removeSprintSplit(0,1)"]').click();
      const before=await state(),modelBefore=(await solve()).model;
      await selector("sprintFvpConfig.inputTimeMode").selectOption("interval");let after=await state();assert.equal(after.sprintFvpConfig.inputTimeMode,"interval");
      for(let i=0;i<before.data.sprint_fvp.length;i++)for(let j=0;j<before.data.sprint_fvp[i].splits.length;j++) {
        const old=before.data.sprint_fvp[i].splits[j],now=after.data.sprint_fvp[i].splits[j];assert.equal(now.id,old.id);assert.equal(now.distanceM,old.distanceM);
        if(old.timeS==="")assert.equal(now.timeS,"");else assert.ok(Math.abs(now.timeS-(old.timeS-(before.data.sprint_fvp[i].splits[j-1]?.timeS||0)))<1e-12);
      }
      await page.evaluate(()=>App.undoDelete());exact((await state()).data.sprint_fvp,after.data.sprint_fvp,"Old sprint-mode undo removed");
      const cmj=(await state()).data.cmj;await page.evaluate(()=>App.removeRow("cmj",0));
      await selector("sprintFvpConfig.inputTimeMode").selectOption("cumulative");await page.evaluate(()=>App.undoDelete());exact((await state()).data.cmj,cmj,"Unrelated most recent CMJ undo retained");after=await state();
      for(const key of ["F0","V0","Pmax","RFmax","DRF"])assert.ok(Math.abs((await solve()).model[key]-modelBefore[key])<1e-8*Math.max(1,Math.abs(modelBefore[key])),key);
      for(let i=0;i<before.data.sprint_fvp[0].splits.length;i++)assert.ok(Math.abs(after.data.sprint_fvp[0].splits[i].timeS-before.data.sprint_fvp[0].splits[i].timeS)<1e-12);
      result.modeConversion={atomic:true,identitiesPreserved:true,pointEstimatePreserved:true,onlySprintUndoCleared:true};
    });
    await check(checkRegistry[3],async()=>{
      let before=await state();const original=before.data.sprint_fvp[0].splits[0].timeS;
      await selector("data.sprint_fvp.0.splits.0.timeS").fill("-1");assert.equal(await selector("data.sprint_fvp.0.splits.0.timeS").getAttribute("aria-invalid"),"true");
      await selector("sprintFvpConfig.inputTimeMode").selectOption("interval");exact((await state()).data.sprint_fvp,before.data.sprint_fvp,"Invalid draft did not convert any trial");assert.equal((await state()).sprintFvpConfig.inputTimeMode,"cumulative");assert.equal(await selector("sprintFvpConfig.inputTimeMode").inputValue(),"cumulative");
      await selector("data.sprint_fvp.0.splits.0.timeS").fill(String(original));await selector("data.sprint_fvp.2.splits.2.timeS").fill("2");before=await state();
      await selector("sprintFvpConfig.inputTimeMode").selectOption("interval");exact((await state()).data.sprint_fvp,before.data.sprint_fvp,"Incomplete trial did not partly convert another trial");assert.equal((await state()).sprintFvpConfig.inputTimeMode,"cumulative");
      await selector("data.sprint_fvp.2.splits.2.timeS").fill("");await save();
    });
    await check(checkRegistry[4],async()=>{
      const cases=[[5,10,15,20],[5,10,20,30],[5,10,20,40],[3,8,17,26],[2.5,7.75,13.2,20.5],[12,18,24,30]];result.distanceCases=[];
      for(const [i,distances]of cases.entries()) {
        const r=makeRecord("-distance-"+i);r.data.sprint_fvp[0].splits=distances.map((distanceM,index)=>({id:"distance-"+index,distanceM,timeS:modelTime(distanceM)}));await load(r);
        const solved=await solve();assert.equal(solved.valid,true,JSON.stringify({distances,reason:solved.reason}));assert.equal(solved.targetDistanceM,distances.at(-1));
        assert.ok(Math.abs(solved.fit.vmax-9)<1e-4&&Math.abs(solved.fit.tau-1.2)<1e-4);result.distanceCases.push({distances,valid:solved.valid,targetDistanceM:solved.targetDistanceM,fit:solved.fit});
      }
      await load(makeRecord());
    });
    await check(checkRegistry[5],async()=>{
      const before=await physics();result.curveCases=[];
      for(let bits=0;bits<8;bits++) {
        const selected={fv:!!(bits&1),pv:!!(bits&2),optimum:!!(bits&4)};await setView({...selected,confidence:false});const graph=await artwork();
        assert.equal(graph.polylines,(Number(selected.fv)+Number(selected.pv))*(selected.optimum?2:1));assert.equal(graph.invalid,false);assert.equal(graph.title,"冲刺FVP");
        assert.equal(graph.optimalLines>0,selected.optimum&&(selected.fv||selected.pv));
        if(!selected.fv&&!selected.pv)assert.ok(graph.text.includes("勾选 F–V 或 P–V 查看曲线"));
        exact(await physics(),before,"Display switches do not affect physics or capability direction");result.curveCases.push({selected,artwork:graph});
      }
      await setView({fv:true,pv:true,optimum:true});
    });
    await check(checkRegistry[6],async()=>{
      const before=await physics();result.metricCases=[];
      for(const key of metricKeys) {await setMetrics([key]);const rows=await metricRows();assert.deepEqual(rows.map(r=>r.id),[key]);exact(await physics(),before,"Metric switches leave all scientific results unchanged");result.metricCases.push({key,rows});}
      await setMetrics([]);assert.equal(await page.locator("[data-sprint-fvp-metrics-empty]").count(),1);assert.equal((await metricRows()).length,0);assert.equal(await page.locator("[data-sprint-fvp-panel] .fvp-core-judgment").count(),1);
      await setView({fv:false,pv:false,optimum:false});await save();await shot("all-off-1440",page.locator("[data-sprint-fvp-panel]"));exact(await physics(),before,"All off preserves model, distance optimum and direction");
      await setView({fv:true,pv:true,optimum:true});await setMetrics(metricKeys);
    });
    await check(checkRegistry[7],async()=>{
      const before=await physics();assert.equal((await state()).sprintFvpView.confidence,false);await setView({confidence:true});
      const status=await ci();assert.equal(status.available,true,status.text);assert.equal(status.version,spec.confidence.methodVersion);assert.equal(status.n,6);assert.equal(status.df,4);assert.equal(status.metadata.level,.95);assert.equal(status.metadata.currentCurveOnly,true);
      assert.ok((await solve()).model.samples.length!==status.n,"Derived mechanics samples are not the CI observation count");
      assert.deepEqual((await artwork()).bands,["fv","pv"]);await setView({optimum:false});assert.deepEqual((await artwork()).bands,["fv","pv"]);
      await setView({pv:false});assert.deepEqual((await artwork()).bands,["fv"]);await setView({fv:false,pv:true});assert.deepEqual((await artwork()).bands,["pv"]);
      exact(await physics(),before,"Approximate CI never changes point estimates or direction");
      assert.equal((await state()).sprintFvpView.n,undefined);assert.equal((await state()).sprintFvpView.df,undefined);result.confidence=status;
      const selected=await state(),four=makeRecord("-four-observations");
      const times=[1.1,2,3.2,4.8],distances=[3.4313064535804343,9.184996726013072,18.801223830767842,32.582781108942285];
      four.data.sprint_fvp[0].splits=times.map((timeS,i)=>({id:"ci-four-"+i,timeS,distanceM:distances[i]}));
      await load(four);const fourBefore=await physics();await setView({confidence:true});const fourStatus=await ci();
      assert.equal(fourStatus.available,true,fourStatus.text);assert.equal(fourStatus.n,4);assert.equal(fourStatus.df,2);
      assert.ok(Math.abs(fourStatus.metadata.tCritical-4.30265273)<1e-6);exact(await physics(),fourBefore,"Four split CI leaves all point estimates unchanged");
      result.confidenceCases=[status,fourStatus];await load(selected);
      await setView({fv:true,pv:false,optimum:false,confidence:true});await setMetrics(["F0","Pmax","RFmax","DRF","Vopt"]);
    });
    await check(checkRegistry[8],async()=>{
      const selected=await state();let r=makeRecord("-unavailable");r.data.sprint_fvp[0].splits.forEach(s=>s.timeS="");await load(r);await setView({confidence:true});let status=await ci();assert.equal(status.available,false);assert.ok(status.metadata.reason||status.text);assert.deepEqual((await artwork()).bands,[]);result.confidenceUnavailable=[status];
      r=makeRecord("-future-ci");r.sprintFvpView={...selected.sprintFvpView,confidenceMethodVersion:"synthetic-future-ci-version"};await load(r);status=await ci();assert.equal(status.available,false);assert.equal((await state()).sprintFvpView.confidenceMethodVersion,"synthetic-future-ci-version");assert.deepEqual((await artwork()).bands,[]);
      result.confidenceUnavailable.push(status);await load(selected);
    });
    await check(checkRegistry[9],async()=>{
      const before=await solve();await page.locator("[data-sprint-target-distance]").fill("10.5");await page.locator("[data-sprint-target-form]").evaluate(n=>n.requestSubmit());await save();
      const solved=await solve();assert.equal(solved.targetDistanceM,10.5);exact(solved.model,before.model,"Target changes optimum, not measured mechanics");assert.equal(solved.optimum.valid,true);
      const active=await state();expected=subset(active);result.savedRecordId=active.recordId;result.savedAthleteId=active.athleteId;write("expected.json",expected);result.saved=expected;await page.reload();await ready(page);await page.evaluate(()=>App.showReport());exact(subset(await state()),expected,"Reload keeps display settings");assert.equal((await state()).recordId,result.savedRecordId);
      await page.evaluate(()=>App.openEntry("sprint_fvp"));assert.equal(Number(await selector("sprintFvpAnalysis.targetDistanceM").inputValue()),10.5);await page.evaluate(()=>App.showReport());
      exact(subset(await state()),expected,"Reopen keeps scientific and display choices");assert.equal(await page.locator('[data-sprint-fvp-view="confidence"]').isChecked(),true);
    });
    await check(checkRegistry[10],async()=>{
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});await page.evaluate(()=>App.showReport());
        const layout=await page.locator("[data-capability-region]").evaluate(n=>({width:innerWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,order:[...n.querySelectorAll("[data-fvp-panel],[data-fvp-elasticity],[data-sprint-fvp-panel]")].map(n=>n.hasAttribute("data-fvp-panel")?"jump":n.hasAttribute("data-fvp-elasticity")?"elastic":"sprint")}));
        assert.equal(layout.pageOverflow,false);assert.deepEqual(layout.order,["jump","elastic","sprint"]);result.layouts.push(layout);
        await save();await shot("regions-"+width,page.locator("[data-capability-region]"));await shot("sprint-"+width,page.locator("[data-sprint-fvp-panel]"));
        await page.locator("#trainingAnalysisDetail > summary").click();assert.equal(await page.locator("#trainingAnalysisDetail").evaluate(n=>n.open),false);
        for(const selector of ["[data-fvp-panel]","[data-fvp-elasticity]","[data-sprint-fvp-panel]"])assert.equal(await page.locator(selector).evaluate(n=>{for(let p=n;p;p=p.parentElement)if(p.tagName==="DETAILS"&&!p.open)return false;return n.getBoundingClientRect().width>0;}),true);
        await shot("folded-"+width,page.locator("[data-capability-region]"));await page.locator("#trainingAnalysisDetail > summary").click();
      }
      await page.setViewportSize({width:1440,height:1000});exact(subset(await state()),expected,"Layout and folding never alter settings");
    });
    await check(checkRegistry[11],async()=>{
      const record=await download("record.json",()=>page.evaluate(()=>App.downloadJSON())),backup=await download("backup.motionbench.jsonl",()=>page.evaluate(()=>App.downloadLibrary()));
      const exported=JSON.parse(fs.readFileSync(record,"utf8")).record;assert.equal(exported.recordId,result.savedRecordId);assert.equal(exported.athleteId,result.savedAthleteId);exact(subset(exported),expected,"JSON view/raw roundtrip");const rows=fs.readFileSync(backup,"utf8").trim().split(/\r?\n/).map(JSON.parse);
      assert.equal(rows[0].schema,3);const config=rows.find(r=>r.type==="config").value;assert.equal(config.version,result.buildProducerVersion);assert.equal(config.activeRecordId,result.savedRecordId);assert.equal(config.activeAthleteId,result.savedAthleteId);
      const savedRows=rows.filter(r=>r.type==="record"&&r.value.recordId===result.savedRecordId);assert.equal(savedRows.length,1);assert.equal(savedRows[0].value.athleteId,result.savedAthleteId);exact(subset(savedRows[0].value),expected,"JSONL preserves display and scientific fields for the actual active record");
      for(const file of [record,backup]) {const p=await newPage();await p.evaluate(()=>App.openManagement("backup"));await p.locator("#backupImportMode").selectOption("replace");await p.locator("#importFile").setInputFiles(file);await p.waitForFunction(id=>App.getState()?.recordId===id,result.savedRecordId);await p.reload();await ready(p);const restored=await p.evaluate(()=>App.getState());assert.equal(restored.recordId,result.savedRecordId);assert.equal(restored.athleteId,result.savedAthleteId);exact(subset(restored),expected,"Actual UI import restores saved view");await p.close();}
    });
    await check(checkRegistry[12],async()=>{
      const file=await download("report.html",()=>page.evaluate(()=>App.downloadHTML())),context=await browser.newContext({offline:true});contexts.push(context);const p=await context.newPage();observe(p);await p.goto(pathToFileURL(file).href);await ready(p);await p.evaluate(()=>App.showReport());exact(subset(await p.evaluate(()=>App.getState())),expected,"Editable HTML restores saved display");assert.equal(await p.locator('[data-sprint-fvp-view="confidence"]').isChecked(),true);assert.equal(await p.locator('[data-sprint-fvp-panel] [data-sprint-fvp-confidence-band="fv"]').count(),1);await p.close();
    });
    await check(checkRegistry[13],async()=>{
      await page.evaluate(()=>App.openEntry("sprint_fvp"));const template=await download("template.xlsx",()=>page.getByRole("button",{name:"下载 Excel 模板",exact:true}).click());
      const book=new ExcelJS.Workbook();await book.xlsx.load(fs.readFileSync(template));const info=manifest(book),settings=info.sheets.find(s=>s.kind==="settings");assert.ok(settings,"Shared settings sheet is present");
      const settingsSheet=book.getWorksheet(settings.name),settingsColumns=columns(settingsSheet),displaySettings={};
      settingsSheet.eachRow((row,index)=>{if(index>=firstRow(settingsSheet)&&row.getCell(settingsColumns.testId).value==="sprint_fvp")displaySettings[row.getCell(settingsColumns.fieldId).value]=row.getCell(settingsColumns.value).value;});
      for(const key of [...curveKeys,"confidence"])assert.equal(displaySettings["sprintFvpView."+key],expected.view[key]?"是":"否","Excel display "+key);
      for(const key of metricKeys)assert.equal(displaySettings["sprintFvpView.metrics."+key],expected.view.metrics[key]?"是":"否","Excel metric "+key);
      assert.equal(displaySettings["sprintFvpView.confidenceMethodVersion"],expected.view.confidenceMethodVersion);assert.equal(Number(displaySettings["sprintFvpView.confidenceLevel"]),.95);
      result.excelDisplaySettings=displaySettings;
      const specSheet=info.sheets.find(s=>s.testId==="sprint_fvp"&&s.kind==="sprintSplits");assert.ok(specSheet);const ws=book.getWorksheet(specSheet.name),cc=columns(ws),row=firstRow(ws),value=ws.getCell(row,cc.timeS).value;assert.ok(Number(value)>0);
      ws.getCell(row,cc.timeS).value=Number(value);const filled=path.join(out,channel+"-filled.xlsx");fs.writeFileSync(filled,Buffer.from(await book.xlsx.writeBuffer()));artifact(filled,"synthetic-excel-roundtrip");
      await selector("data.sprint_fvp.0.splits.0.timeS").fill(String(Number(value)+.001));await save();
      await importExcel(filled);await page.reload();await ready(page);await page.evaluate(()=>App.showReport());exact(subset(await state()),expected,"Excel preserves scientific and nondefault display settings");
    });
    await check(checkRegistry[14],async()=>{
      const saved=await state(),legacyFile=path.join(root,"tests/fixtures/sprint-display-v2173/baseline-sprint-library.json"),legacy=JSON.parse(fs.readFileSync(legacyFile,"utf8"));
      result.legacyExcel=[];
      for(const fixture of spec.legacyExcel) {
        const file=path.join(root,fixture.path);assert.equal(hash(file),fixture.sha256);await page.evaluate(lib=>App.importPayload(lib,"replace-library"),legacy);
        const before=await state();await importExcel(file);await page.reload();await ready(page);await page.evaluate(()=>App.showReport());const after=await state();
        exact(trialMeasurements(after.data.sprint_fvp),trialMeasurements(before.data.sprint_fvp),"Legacy Excel keeps every raw timing and trial metadata field");assert.equal(after.recordId,before.recordId);assert.equal(after.athleteId,before.athleteId);exact(after.sprintFvpConfig,before.sprintFvpConfig,"Legacy Excel keeps method metadata");exact(after.sprintFvpAnalysis,before.sprintFvpAnalysis,"Legacy Excel keeps target");assert.equal(after.sprintFvpAnalysis.targetDistanceM,60);assert.equal((await solve()).valid,true);
        assert.deepEqual(after.sprintFvpView,await page.evaluate(()=>RingsideModel.sprintFvpViewDefaults()));assert.equal(await page.locator("[data-sprint-fvp-panel] h3").innerText(),"冲刺FVP");
        await setView({fv:true,pv:false,optimum:false,confidence:true});await setMetrics(["F0","Pmax","RFmax","DRF","Vopt"]);await save();const nondefault=subset(await state());
        await page.evaluate(()=>App.openEntry("sprint_fvp"));await selector("data.sprint_fvp.0.splits.0.timeS").fill(String(Number(nondefault.raw[0].splits[0].timeS)+.001));await save();
        await importExcel(file);await page.reload();await ready(page);await page.evaluate(()=>App.showReport());const final=await state();exact(scientificSubset(final),{...nondefault,raw:trialMeasurements(nondefault.raw)},"Missing legacy Excel display namespace preserves existing nondefault choices and all measurement fields");assert.equal(final.recordId,after.recordId);assert.equal(final.athleteId,after.athleteId);
        result.legacyExcel.push({path:fixture.path,sha256:fixture.sha256,saved:subset(after),nondefaultPreserved:subset(final),recordIdPreserved:true,athleteIdPreserved:true,measurementFieldsExactlyPreserved:true,internalIdentityBefore:after.data.sprint_fvp,internalIdentityAfter:final.data.sprint_fvp});
      }
      await load(saved);exact(subset(await state()),expected,"Restore original nondefault test cohort after legacy checks");
    });
    if(process.argv.includes("--pdf"))await check(checkRegistry[15],async()=>{
      await save();const before=await state(),screenRows=await metricRows(),status=await ci(),graph=await artwork();
      await page.evaluate(()=>{window.__displayPdfPages=[];window.__displayCanvas=html2canvas;window.html2canvas=async(node,options)=>{
        const content=node.querySelector(".ringside-pdf-content"),box=content.getBoundingClientRect();
        window.__displayPdfPages.push({text:node.innerText,charts:[...node.querySelectorAll("[data-chart-kind]")].map(n=>({kind:n.dataset.chartKind,input:n.dataset.chartInput,images:[...n.querySelectorAll("img[data-pdf-chart]")].map(i=>({complete:i.complete,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight}))})),sprintRows:[...node.querySelectorAll(".sprint-fvp-result-table tr[data-metric-id]")].map(n=>({id:n.dataset.metricId,text:n.innerText,cells:[...n.cells].map(c=>c.innerText)})),confidence:[...node.querySelectorAll("[data-sprint-fvp-confidence-status]")].map(n=>({n:Number(n.dataset.confidenceN),df:Number(n.dataset.confidenceDf),metadata:JSON.parse(n.dataset.sprintFvpConfidenceMeta),text:n.innerText})),controls:node.querySelectorAll("[data-sprint-fvp-view],[data-sprint-fvp-metric]").length,overflow:[...content.children].filter(n=>n.getBoundingClientRect().bottom>box.bottom+.8).map(n=>n.className)});
        return __displayCanvas(node,options);};});
      await page.locator("#reportExportMenu").evaluate(n=>n.open=true);const file=await download("report.pdf",()=>page.locator("#reportExportMenu [data-pdf-action]").click());
      const captured=await page.evaluate(()=>{html2canvas=__displayCanvas;return{pages:__displayPdfPages,diagnostics:RingsidePDF.lastDiagnostics};});
      exact(await state(),before,"PDF preparation leaves saved record unchanged");assert.equal(captured.diagnostics.status,"complete");for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(captured.diagnostics[key],[],key);assert.ok(captured.diagnostics.textChecks.every(x=>x.exact));
      assert.ok(captured.pages.every(p=>!p.overflow.length&&p.controls===0));exact(captured.pages.flatMap(p=>p.sprintRows),screenRows,"PDF contains only selected parameter rows and their actual values");
      const pdfCi=captured.pages.flatMap(p=>p.confidence);assert.equal(pdfCi.length,1);assert.equal(pdfCi[0].n,6);assert.equal(pdfCi[0].df,4);exact(pdfCi[0].metadata,status.metadata,"PDF confidence metadata matches screen");
      const charts=captured.pages.flatMap(p=>p.charts),sprint=charts.filter(c=>c.kind==="sprintFvp");assert.equal(sprint.length,1);const chartInput=JSON.parse(sprint[0].input);exact(chartInput[1],expected.view,"PDF chart rerender uses stored display flags");
      for(const chart of charts)for(const image of chart.images)assert.ok(image.complete&&image.width>0&&image.height>0&&image.naturalWidth>0&&image.naturalHeight>0);
      result.pdf={path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file),screenArtwork:graph,screenConfidence:status,...captured};
    });
    assert.deepEqual(result.checks,checkRegistry);assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
  } catch(error) {result.failures.push({message:error.message,stack:error.stack});console.error(error.stack);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,channel+"-failure.png"),fullPage:true}).then(()=>artifact(path.join(out,channel+"-failure.png"),"failure-screenshot")).catch(()=>{});}
  finally {result.sourceUnchanged=hash(source)===sourceHash;result.runnerUnchanged=hash(__filename)===result.runnerSha256;if(!result.sourceUnchanged||!result.runnerUnchanged){result.pass=false;process.exitCode=1;}result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,channel+"-results.json"),JSON.stringify(result,null,2)+"\n");await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
