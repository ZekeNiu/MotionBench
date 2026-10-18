"use strict";
// Synthetic browser-only evidence. No desktop process or real profile is opened.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),{createFixture}=require("./helpers/longitudinal-fixture.cjs");
const ROOT=path.resolve(__dirname,".."),SOURCE=path.join(ROOT,"MotionBench.html"),channel=process.argv.includes("--edge")?"msedge":"chrome";
const arg=key=>{const i=process.argv.indexOf(key);return i<0?null:process.argv[i+1];},OUT=path.resolve(ROOT,arg("--artifact-dir")||`output/playwright/v2244/longitudinal-controls/${channel}`);
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex"),copy=value=>JSON.parse(JSON.stringify(value));
const MODULES=["src/ringside-longitudinal-views.js","src/ringside-longitudinal-store.js","src/ringside-longitudinal-controller.js","src/ringside-longitudinal-view.js","src/ringside-longitudinal.js","src/ringside-app.js","src/ringside-pdf.js"];
const METRICS=["F0","V0","Pmax","F0Absolute","PmaxAbsolute","slope","RFmax","DRF","Vmax","endVelocity","Vopt"];
async function main(){
  assert.ok(path.relative(path.join(ROOT,"output"),OUT)&&!path.relative(path.join(ROOT,"output"),OUT).startsWith(".."));fs.mkdirSync(OUT,{recursive:true});
  const result={synthetic:true,channel,sourceHash:hash(SOURCE),runnerSha256:hash(__filename),fixtureSha256:hash(path.join(__dirname,"helpers/longitudinal-fixture.cjs")),moduleHashes:Object.fromEntries(MODULES.map(f=>[f,hash(path.join(ROOT,f))])),checks:[],errors:[],network:[],artifacts:[],pass:false,startedAt:new Date().toISOString()};
  let browser,context,page,f,baseline;
  const artifact=file=>result.artifacts.push({file:path.relative(ROOT,file).replaceAll("\\","/"),sha256:hash(file),bytes:fs.statSync(file).size});
  const watch=p=>{p.setDefaultTimeout(30000);p.on("pageerror",error=>result.errors.push(error.stack||error.message));p.on("request",request=>{if(/^https?:/.test(request.url()))result.network.push(request.url());});p.on("dialog",dialog=>dialog.accept());};
  const ready=async p=>{await p.waitForFunction(()=>window.App?.ready);assert.equal(await p.evaluate(()=>App.ready),true);};
  const settle=async()=>{assert.equal(await page.evaluate(()=>App.saveNow()),true);await page.waitForFunction(()=>!document.getElementById("saveStatus").textContent.includes("正在保存"));};
  const check=async(name,run)=>{result.stage=name;console.log("START "+name);await run();result.checks.push(name);console.log("PASS "+name);};
  const panel=id=>page.locator(`[data-longitudinal-panel=${JSON.stringify(id)}]`).first();
  async function reveal(locator){
    const selectors=await locator.evaluate(node=>{document.querySelectorAll("[data-controls-test-reveal]").forEach(el=>el.removeAttribute("data-controls-test-reveal"));const ids=[];for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==="DETAILS"&&!p.open){p.dataset.controlsTestReveal="r"+ids.length;ids.push(p.dataset.controlsTestReveal);}return ids.reverse();});
    for(const id of selectors)await page.locator(`[data-controls-test-reveal="${id}"] > summary`).click();
  }
  async function control(id,attribute,key,value){const locator=panel(id).locator(`[${attribute}=${JSON.stringify(key)}]`);await reveal(locator);if(await locator.evaluate(n=>n.tagName)==="SELECT")await locator.selectOption(value);else await locator.setChecked(value);await settle();}
  async function dates(id,wanted){
    const inputs=panel(id).locator("[data-longitudinal-chart-date]");assert.equal(await inputs.count(),f.ids.length);
    for(const recordId of wanted){const input=panel(id).locator(`[data-longitudinal-chart-date=${JSON.stringify(recordId)}]`);await reveal(input);if(!await input.isChecked())await input.check();}
    for(const recordId of f.ids.filter(id=>!wanted.includes(id))){const input=panel(id).locator(`[data-longitudinal-chart-date=${JSON.stringify(recordId)}]`);await reveal(input);if(await input.isChecked())await input.uncheck();}
    await settle();assert.deepEqual((await panel(id).locator("[data-longitudinal-chart-date]:checked").evaluateAll(nodes=>nodes.map(n=>n.dataset.longitudinalChartDate))).sort(),[...wanted].sort());
  }
  const specs=id=>panel(id).locator("[data-longitudinal-chart]").evaluateAll(nodes=>nodes.map(node=>JSON.parse(node.dataset.longitudinalChart)));
  const tables=()=>page.locator("[data-longitudinal-table]").evaluateAll(nodes=>nodes.map(node=>node.dataset.longitudinalTable));
  const snapshot=()=>page.evaluate(async()=>{
    const digest=async value=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,"0")).join("");
    const lib=await App.getRepository().exportLibrary(),model=App.getLongitudinal(),doc=App.getLongitudinalDocument();
    return {records:await digest(lib.athletes),shared:await digest({catalog:lib.catalog,evaluationProfiles:lib.evaluationProfiles,defaultEvaluationProfileId:lib.defaultEvaluationProfileId,groups:lib.groups,testPlans:lib.testPlans}),model:await digest(model),basis:model?.basis,facts:await digest(model?RingsideLongitudinal.facts(model):null),narrative:await digest(doc?.narrative),previousNarrative:await digest(doc?.previousNarrative||null),recordIds:model?.recordIds,body:document.getElementById("narrativeView").innerText,stale:document.getElementById("interpState").innerText};
  });
  const invariant=async()=>assert.deepEqual(await snapshot(),baseline,"Display changes must preserve full records/model/facts/body and AI evidence");
  async function download(kind,name="comparison"){
    const extension=kind==="Library"?"motionbench.jsonl":kind.toLowerCase(),file=path.join(OUT,name+"."+extension),pending=page.waitForEvent("download",{timeout:900000});pending.catch(()=>{});
    await page.evaluate(kind=>App["download"+kind](),kind);const saved=await pending;assert.equal(await saved.failure(),null);await saved.saveAs(file);artifact(file);return file;
  }
  async function seed(count=4,minimal=false){
    return page.evaluate(async({factory,count,minimal})=>{
      const f=(0,eval)("("+factory+")")(window,count),M=RingsideModel,lib=M.libraryDefaults();
      f.records.forEach((r,i)=>{r.title="控件验收 "+(i+1);r.evaluationProfileId=f.profile.id;r.narrative.html=M.textToHTML(r.narrative.text);if(minimal)for(const key of Object.keys(r.enabled))r.enabled[key]=key==="cmj";});
      if(!minimal){f.records[1].athlete.date=f.records[0].athlete.date;f.records[1].created="2026-01-01T01:00:00.000Z";f.records[2].enabled.fms=false;f.records[2].enabled.imtp=false;f.records.forEach(r=>{r.sprintFvpView.confidence=false;r.sprintFvpView.metrics.Vopt=false;});}
      lib.catalog=f.catalog;lib.evaluationProfiles=[f.profile];lib.defaultEvaluationProfileId=f.profile.id;
      lib.athletes=[{id:f.athleteId,name:f.records[0].athlete.name,profile:M.profileFromRecord(f.records[0]),groupId:"",records:f.records,archived:false,deletedAt:null}];
      const other=structuredClone(f.records[0]);other.recordId="controls-other-record";other.athleteId="controls-other-athlete";other.athlete.name="另一名控件验收队员";other.narrative.text="另一名队员独立正文";other.narrative.html=M.textToHTML(other.narrative.text);
      lib.athletes.push({id:other.athleteId,name:other.athlete.name,profile:M.profileFromRecord(other),groupId:"",records:[other],archived:false,deletedAt:null});
      lib.activeAthleteId=f.athleteId;lib.activeRecordId=f.records[0].recordId;await App.importPayload(lib,"replace-library");await App.showReport(false);
      return{ids:f.records.map(r=>r.recordId),athleteId:f.athleteId,other:{athleteId:other.athleteId,recordId:other.recordId,name:other.athlete.name}};
    },{factory:createFixture.toString(),count,minimal});
  }
  try{
    browser=await chromium.launch({channel});context=await browser.newContext({viewport:{width:1440,height:1000},offline:true});page=await context.newPage();watch(page);await page.goto(pathToFileURL(SOURCE).href);await ready(page);
    await check("isolated four-period fixture enters comparison through real record checkboxes",async()=>{
      f=await seed();await page.locator("#recordChoiceLabel").click();
      for(const id of f.ids.slice(1)){await page.locator(`[data-record-choice=${JSON.stringify(id)}]`).check();await page.waitForFunction(id=>App.getLongitudinal()?.recordIds.includes(id),id);await settle();}
      await page.locator("#recordChoiceLabel").click();await page.evaluate(()=>App.openEntry("narrative"));await page.locator("#interpEditor").fill("比较控件验收：本段人工正文和依据在纯显示切换时应保持。" );await page.locator("#workspaceBack").click();await settle();
      baseline=await snapshot();assert.deepEqual(baseline.recordIds,f.ids);assert.doesNotMatch(baseline.stale,/待复核/);
      for(const id of["risk","overview","fms","imtp","fvp_sj:profile","fvp_cmj:profile","sprint_fvp:profile","sprint_fvp:elasticity","lvp:upper"])assert.equal(await panel(id).count(),1,id);
    });
    await check("risk and overview dates are independent and same-day records retain distinct identities",async()=>{
      const before=await tables(),labels=await panel("risk").locator("[data-longitudinal-chart-date]").evaluateAll(nodes=>nodes.map(n=>n.parentElement.textContent));assert.notEqual(labels[0],labels[1]);
      await dates("risk",[f.ids[0]]);await dates("overview",[f.ids[1],f.ids[3]]);
      assert.deepEqual((await specs("risk"))[0].series.map(s=>s.recordId||s.id),[f.ids[0]]);
      assert.deepEqual((await specs("overview"))[0].series.map(s=>s.recordId||s.id),[f.ids[1],f.ids[3]]);
      assert.equal(await panel("risk").locator("[data-longitudinal-chart-date]:checked").isDisabled(),true);
      assert.deepEqual(await tables(),before);await invariant();
    });
    await check("missing FMS and IMTP dates remain selectable and show no invented zero result",async()=>{
      const before=await tables();for(const id of["fms","imtp"]){await dates(id,[f.ids[2]]);assert.match(await panel(id).innerText(),/暂无可显示|未测|缺测/);assert.equal((await specs(id)).length,0);await dates(id,[f.ids[0],f.ids[3]]);assert.ok((await specs(id)).length);}
      assert.deepEqual(await tables(),before);await invariant();
    });
    await check("every remaining plotted module filters its own dates while all result tables retain the homepage set",async()=>{
      const before=await tables(),tested=new Set(["risk","overview","fms","imtp"]),ids=await page.locator("[data-longitudinal-panel]").evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.longitudinalPanel))]);
      for(const id of ids.filter(id=>!tested.has(id))){await dates(id,[f.ids[3]]);for(const chart of await specs(id)){const ids=[...new Set((chart.series||[]).map(s=>s.recordId||s.id).concat((chart.periods||[]).map(p=>p.id)))];assert.ok(ids.length&&ids.every(id=>id===f.ids[3]),id+" contains a hidden record");}}
      assert.deepEqual(await tables(),before);await invariant();result.dateFilteredChartIds=ids;
    });
    await check("jump FVP layers confidence and measured range respond without altering any comparison result",async()=>{
      for(const id of["fvp_sj:profile","fvp_cmj:profile"]){
        await control(id,"data-longitudinal-option","fv",false);assert.ok((await specs(id))[0].series.every(s=>!s.label.includes("F–V")));
        await control(id,"data-longitudinal-option","fv",true);await control(id,"data-longitudinal-option","pv",false);assert.ok((await specs(id))[0].series.every(s=>!s.label.includes("P–V")&&!s.label.includes("Pmax")));
        await control(id,"data-longitudinal-option","pv",true);await control(id,"data-longitudinal-option","confidence",false);assert.ok((await specs(id))[0].series.every(s=>!s.band?.length));
        await control(id,"data-longitudinal-option","confidence",true);assert.ok((await specs(id))[0].series.some(s=>s.band?.length));
        await control(id,"data-longitudinal-option","range","measured");assert.ok((await specs(id))[0].xRange?.min>0);await control(id,"data-longitudinal-option","range","full");
        for(const key of["points","optimum","comparison"]){await control(id,"data-longitudinal-option",key,false);await control(id,"data-longitudinal-option",key,true);}await control(id,"data-longitudinal-option","comparison",false);
      }await invariant();
    });
    await check("sprint confidence can be enabled independently of saved single-record settings and all eleven metrics restore",async()=>{
      const id="sprint_fvp:profile",inputs=page.locator("#detail-sprint_fvp [data-longitudinal-metric]");assert.deepEqual((await inputs.evaluateAll(nodes=>nodes.map(n=>n.dataset.longitudinalMetric))).sort(),[...METRICS].sort());
      await control(id,"data-longitudinal-option","confidence",true);assert.ok((await specs(id))[0].series.some(s=>s.band?.length),"confidence must be computed even when all saved single records disabled it");
      const rows=()=>page.locator("#detail-sprint_fvp tr[data-metric-id]").evaluateAll(nodes=>nodes.map(n=>n.dataset.metricId));
      for(const key of METRICS){const input=page.locator(`#detail-sprint_fvp [data-longitudinal-metric=${JSON.stringify(key)}]`);await reveal(input);await input.uncheck();await settle();}
      const hidden=await rows();assert.ok(!hidden.some(id=>/sprint_fvp_(?:f0|v0|pmax|rfmax|drf)(?::|$)|sprint_fvp:(?:profile|optimum):(?:F0|V0|Pmax|F0Absolute|PmaxAbsolute|slope|RFmax|DRF|Vmax|endVelocity|Vopt)(?::|$)/.test(id)));
      for(const key of METRICS){const input=page.locator(`#detail-sprint_fvp [data-longitudinal-metric=${JSON.stringify(key)}]`);await reveal(input);await input.check();await settle();}
      assert.ok((await rows()).some(id=>id.includes("profile:Vopt")),"a metric hidden in every original single report must be recoverable");
      await control(id,"data-longitudinal-option","confidence",false);await invariant();
    });
    await check("both elasticity views and every response layer remain independently selectable",async()=>{
      for(const id of["fvp_sj:elasticity","fvp_cmj:elasticity","sprint_fvp:elasticity"]){
        for(const key of["responseForce","responseVelocity","responseBoth"])await control(id,"data-longitudinal-option",key,false);
        assert.equal((await specs(id)).length,0);
        for(const key of["responseForce","responseVelocity","responseBoth"])await control(id,"data-longitudinal-option",key,true);
        const kind=id.startsWith("sprint")?"distance":"constraint";await control(id,"data-longitudinal-option","elasticityView",kind);assert.match((await specs(id))[0].xLabel,kind==="distance"?/距离/:/ER/);
        await control(id,"data-longitudinal-option","elasticityView","response");assert.match((await specs(id))[0].xLabel,/参数改变/);
      }await invariant();
    });
    await check("IMTP units and LVP actions points confidence and estimates update only the selected chart",async()=>{
      await control("imtp","data-longitudinal-option","yAxis","force");assert.equal((await specs("imtp"))[0].yLabel,"力 · N");await control("imtp","data-longitudinal-option","yAxis","percent");assert.match((await specs("imtp"))[0].yLabel,/%/);
      for(const id of["lvp:upper","lvp:lower"]){if(!await panel(id).count())continue;const actions=await panel(id).locator("[data-longitudinal-action]").evaluateAll(nodes=>nodes.map(n=>n.dataset.longitudinalAction));assert.ok(actions.length);
        for(const action of actions)await control(id,"data-longitudinal-action",action,false);assert.equal((await specs(id)).length,0);
        for(const action of actions)await control(id,"data-longitudinal-action",action,true);assert.ok((await specs(id))[0].series.length);
        for(const key of["showPoints","showBand","showEstimate"]){await control(id,"data-longitudinal-option",key,false);assert.equal((await specs(id))[0].options[key],false);await control(id,"data-longitudinal-option",key,true);}
      }await invariant();
    });
    await check("a real IndexedDB write failure rolls chart controls back and the same UI action retries successfully",async()=>{
      const previous=await page.evaluate(()=>App.getLongitudinalDocument().views.charts?.imtp?.options?.yAxis||"percent");assert.equal(previous,"percent");
      await page.evaluate(()=>{const original=IDBObjectStore.prototype.put,repo=App.getRepository(),saveRecords=repo.saveRecords.bind(repo);window.__chartFailure={fired:false,events:[]};const log=(kind,extra={})=>__chartFailure.events.push({kind,time:performance.now(),memory:App.getLongitudinalDocument()?.views.charts?.imtp?.options?.yAxis,...extra});repo.saveRecords=async(...args)=>{log("saveRecords:start",{axis:args[2]?.longitudinalReports?.find(d=>d.key===App.getLongitudinalDocument()?.key)?.views?.charts?.imtp?.options?.yAxis});try{const result=await saveRecords(...args);log("saveRecords:success");return result;}catch(error){log("saveRecords:failure",{error:error.message});throw error;}};document.addEventListener("toggle",event=>log("toggle",{id:event.target.id,connected:event.target.isConnected,open:event.target.open}),true);IDBObjectStore.prototype.put=function(value,...args){if(this.name==="config"){const axis=value?.value?.longitudinalReports?.find(d=>d.key===App.getLongitudinalDocument()?.key)?.views?.charts?.imtp?.options?.yAxis;log("config:put",{axis});if(!__chartFailure.fired&&axis==="force"){__chartFailure.fired=true;throw new DOMException("Synthetic display transaction failure","QuotaExceededError");}}return original.call(this,value,...args);};window.__restoreChartFailure=()=>{IDBObjectStore.prototype.put=original;repo.saveRecords=saveRecords;};});
      const input=panel("imtp").locator('[data-longitudinal-option="yAxis"]');await reveal(input);await input.selectOption("force");
      await page.waitForFunction(()=>__chartFailure.fired&&App.getLongitudinalDocument().views.charts?.imtp?.options?.yAxis==="percent");assert.equal(await input.inputValue(),"percent");
      assert.equal(await page.evaluate(async()=>{const lib=await App.getRepository().directory(),key=App.getLongitudinalDocument().key;return lib.longitudinalReports.find(d=>d.key===key).views.charts.imtp.options.yAxis;}),"percent");
      result.saveFailureEvidence=await page.evaluate(()=>__chartFailure);await page.evaluate(()=>__restoreChartFailure());
      await control("imtp","data-longitudinal-option","yAxis","force");await invariant();
    });
    await check("rapid date clicks merge while storage waits and switching athlete cannot move the old display into a new owner",async()=>{
      await dates("risk",f.ids);await page.evaluate(()=>{const repo=App.getRepository(),original=repo.saveRecords.bind(repo);let release;const gate=new Promise(done=>release=done);window.__chartGate={entered:false,release:()=>{repo.saveRecords=original;release();}};repo.saveRecords=async(...args)=>{if(!__chartGate.entered&&args[2]?.longitudinalReports){__chartGate.entered=true;await gate;}return original(...args);};});
      for(const id of[f.ids[1],f.ids[2]]){const input=panel("risk").locator(`[data-longitudinal-chart-date=${JSON.stringify(id)}]`);await reveal(input);await input.uncheck();}
      await page.waitForFunction(()=>__chartGate.entered);await page.locator("#reportAthleteSearch").fill(f.other.name);await page.locator(`[data-athlete-choice=${JSON.stringify(f.other.athleteId)}]`).click();
      await page.evaluate(()=>__chartGate.release());await page.waitForFunction(id=>App.getState()?.athleteId===id&&App.getLongitudinal()===null,f.other.athleteId);await settle();assert.equal(await page.locator("[data-longitudinal-panel]").count(),0);assert.match(await page.locator("#narrativeView").innerText(),/另一名队员独立正文/);
      await page.locator("#reportAthleteSearch").fill("纵向验收合成队员");await page.locator(`[data-athlete-choice=${JSON.stringify(f.athleteId)}]`).click();await page.evaluate(ids=>App.selectRecords(ids),f.ids);await settle();
      assert.deepEqual((await panel("risk").locator("[data-longitudinal-chart-date]:checked").evaluateAll(nodes=>nodes.map(n=>n.dataset.longitudinalChartDate))).sort(),[f.ids[0],f.ids[3]].sort());await invariant();
    });
    await check("reload and downloaded JSON HTML preserve graph choices while exporting every homepage record",async()=>{
      const expected=await page.evaluate(()=>App.getLongitudinalDocument().views.charts);await page.reload();await ready(page);await settle();assert.deepEqual(await page.evaluate(()=>App.getLongitudinalDocument().views.charts),expected);await invariant();
      const jsonFile=await download("JSON"),htmlFile=await download("HTML"),payload=JSON.parse(fs.readFileSync(jsonFile,"utf8"));assert.deepEqual(payload.selection.recordIds,f.ids);assert.equal(payload.library.athletes[0].records.length,f.ids.length);assert.deepEqual(payload.library.longitudinalReports[0].views.charts,expected);
      const otherContext=await browser.newContext({viewport:{width:1440,height:1000},offline:true}),extra=await otherContext.newPage();watch(extra);await extra.goto(pathToFileURL(htmlFile).href);await ready(extra);assert.deepEqual(await extra.evaluate(()=>App.getLongitudinalDocument().views.charts),expected);assert.deepEqual(await extra.evaluate(()=>App.getLongitudinal().recordIds),f.ids);assert.equal(await extra.locator("#narrativeView").innerText(),baseline.body);await otherContext.close();
      result.exportedSelection=payload.selection;result.exportedChartViews=expected;
    });
    await check("actual PDF print layout contains chosen chart dates and the complete comparison table dates",async()=>{
      const chosen={risk:[f.ids[0]],overview:[f.ids[1],f.ids[3]],fms:[f.ids[0]],"fvp_sj:profile":[f.ids[3]]};for(const[id,ids]of Object.entries(chosen))await dates(id,ids);
      await page.evaluate(()=>{const original=RingsideLongitudinalView.layout;RingsideLongitudinalView.layout=function(container,options){const returned=original(container,options);if(options?.print)window.__controlsPrint={charts:[...container.querySelectorAll("[data-longitudinal-chart]")].map(n=>JSON.parse(n.dataset.longitudinalChart)),tables:[...container.querySelectorAll("[data-longitudinal-table]")].map(n=>JSON.parse(n.dataset.longitudinalTable)),controls:container.querySelectorAll("[data-longitudinal-option],[data-longitudinal-chart-date]").length};return returned;};});
      const file=await download("PDF");assert.equal(fs.readFileSync(file).subarray(0,5).toString(),"%PDF-");const proof=await page.evaluate(()=>({print:__controlsPrint,diagnostics:RingsidePDF.lastDiagnostics}));assert.equal(proof.diagnostics.status,"complete");assert.equal(proof.print.controls,0);
      for(const[id,ids]of Object.entries(chosen)){const chart=proof.print.charts.find(s=>s.chartId===id);assert.ok(chart,id+" actual print chart");const actual=[...new Set((chart.series||[]).map(s=>s.recordId||s.id).concat((chart.periods||[]).map(p=>p.id)))];assert.deepEqual(actual.sort(),[...ids].sort());}
      assert.ok(proof.print.tables.length);for(const table of proof.print.tables)assert.deepEqual(table.periods.map(p=>p.id),f.ids);result.pdfDiagnostics=proof.diagnostics;result.pdfDisplayEvidence={selected:chosen,chartCount:proof.print.charts.length,tableCount:proof.print.tables.length,controlsRemoved:proof.print.controls===0};await invariant();
      const image=path.join(OUT,"controls-overview.png");await page.screenshot({path:image,fullPage:false});artifact(image);
    });
    await check("complete backup restores chart choices and conflict import remaps only referenced record identities",async()=>{
      const expected=await page.evaluate(()=>App.getLongitudinalDocument().views.charts),backup=await download("Library","comparison-complete");
      await page.evaluate(async text=>App.importBackup(new File([text],"synthetic.motionbench.jsonl"),false),fs.readFileSync(backup,"utf8"));await page.evaluate(()=>App.showReport(false));await page.evaluate(ids=>App.selectRecords(ids),f.ids);await settle();assert.deepEqual(await page.evaluate(()=>App.getLongitudinalDocument().views.charts),expected);await invariant();
      const file=await download("JSON","comparison-for-remap"),payload=JSON.parse(fs.readFileSync(file,"utf8"));payload.library.athletes[0].records.find(r=>r.recordId===f.ids[0]).athlete.notes="Explicit distinct synthetic import for ID remapping";
      const mapped=await page.evaluate(payload=>App.importPayload(payload,"merge"),payload);assert.ok(mapped.recordMap[f.ids[0]]);assert.notEqual(mapped.recordMap[f.ids[0]],f.ids[0]);
      const views=await page.evaluate(()=>App.getLongitudinalDocument().views.charts),mappedIds=ids=>ids.map(id=>mapped.recordMap[id]||id).sort();for(const[id,config]of Object.entries(expected))if(config.recordIds)assert.deepEqual([...views[id].recordIds].sort(),mappedIds(config.recordIds));
      result.remap={originalRecordId:f.ids[0],mappedRecordId:mapped.recordMap[f.ids[0]],chartIds:Object.keys(expected)};
    });
    await check("nine-date selection remains independent and restores a one-date graph after reload",async()=>{
      f=await seed(9,true);assert.equal(await page.evaluate(ids=>App.selectRecords(ids),f.ids),true);await settle();baseline=await snapshot();const before=await tables();
      await dates("overview",[f.ids[8]]);assert.equal(await panel("overview").locator("[data-longitudinal-chart-date]").count(),9);assert.equal(await panel("overview").locator("[data-longitudinal-chart-date]:checked").isDisabled(),true);assert.deepEqual(await tables(),before);await invariant();
      await page.reload();await ready(page);await settle();assert.deepEqual(await page.evaluate(()=>App.getLongitudinal().recordIds),f.ids);assert.deepEqual(await panel("overview").locator("[data-longitudinal-chart-date]:checked").evaluateAll(nodes=>nodes.map(n=>n.dataset.longitudinalChartDate)),[f.ids[8]]);await invariant();
      const image=path.join(OUT,"nine-dates.png");await page.screenshot({path:image,fullPage:false});artifact(image);
    });
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
  }catch(error){result.failure=error.stack;result.failureState=await page?.evaluate(()=>({save:document.getElementById("saveStatus")?.textContent,toast:document.getElementById("toast")?.textContent,selection:App.getLongitudinal()?.recordIds,views:App.getLongitudinalDocument()?.views})).catch(()=>null);result.saveFailureEvidence=await page?.evaluate(()=>window.__chartFailure||null).catch(()=>null);process.exitCode=1;console.error(error.stack);
  }finally{if(page&&!page.isClosed())try{assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);}catch(error){result.closeFailure=String(error);result.pass=false;process.exitCode=1;}await context?.close();await browser?.close();result.completedAt=new Date().toISOString();result.sourceUnchanged=hash(SOURCE)===result.sourceHash;result.runnerUnchanged=hash(__filename)===result.runnerSha256;result.modulesUnchanged=Object.entries(result.moduleHashes).every(([file,digest])=>hash(path.join(ROOT,file))===digest);if(!result.sourceUnchanged||!result.runnerUnchanged||!result.modulesUnchanged){result.pass=false;process.exitCode=1;}fs.writeFileSync(path.join(OUT,"results.json"),JSON.stringify(result,null,2));console.log(JSON.stringify({channel,pass:result.pass,checks:result.checks.length,stage:result.stage}));}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
