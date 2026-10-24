"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),{createFixture}=require("./helpers/longitudinal-fixture.cjs"),{selectionUI}=require("./helpers/report-selection-ui.cjs");
const ROOT=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome",index=process.argv.indexOf("--source"),source=path.resolve(index>=0?process.argv[index+1]:path.join(ROOT,"MotionBench.html"));
const OUT=path.join(ROOT,"output/playwright/report-selection-edge-cases"),hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex"),objectHash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function main(){
  fs.mkdirSync(OUT,{recursive:true});const receiptPath=path.join(OUT,"result-"+channel+".json");
  if(fs.existsSync(receiptPath))fs.copyFileSync(receiptPath,path.join(OUT,"result-"+channel+"-before-"+Date.now()+".json"));
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-selection-edges-")),isolated=path.join(temporary,"MotionBench.html");fs.copyFileSync(source,isolated);
  const receipt={synthetic:true,isolated:true,channel,sourceHash:hash(source),runnerSha256:hash(__filename),selectionUiHelperSha256:hash(path.join(__dirname,"helpers/report-selection-ui.cjs")),checks:[],errors:[],artifacts:[],pass:false,startedAt:new Date().toISOString()};
  let browser,page,ids,baseline;
  const check=async(name,run)=>{receipt.stage=name;await run();receipt.checks.push(name);console.log("PASS "+name);};
  const rawRecords=()=>page.evaluate(recordIds=>Promise.all(recordIds.map(id=>App.getRepository().loadRecord(id))),ids.allRecords);
  const current=()=>page.evaluate(()=>({recordId:App.getState()?.recordId,athleteId:App.getState()?.athleteId,longitudinal:App.getLongitudinal()?.fingerprint||null,horizontal:App.getHorizontal()?.fingerprint||null}));
  const draft=()=>page.evaluate(()=>App.getReportSelection());
  const screenshot=async name=>{await page.locator("#toast").waitFor({state:"hidden"});await page.evaluate(()=>document.fonts.ready);const file=path.join(OUT,channel+"-"+name+".png");await page.screenshot({path:file,fullPage:false});receipt.artifacts.push({file:path.relative(ROOT,file).replaceAll("\\","/"),sha256:hash(file),bytes:fs.statSync(file).size});};
  try{
    assert.equal(hash(isolated),receipt.sourceHash);browser=await chromium.launch({channel,headless:true});const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce"});page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",error=>receipt.errors.push(error.stack||error.message));
    await page.goto(pathToFileURL(isolated).href);await page.waitForFunction(()=>window.App?.ready);const u=selectionUI(page);
    const revert=async()=>{await page.locator("[data-revert-selection]").click();assert.equal(await page.locator("[data-revert-selection]").isDisabled(),true);};
    const applyRecord=async recordId=>{await u.apply();await page.waitForFunction(id=>App.getState()?.recordId===id&&document.querySelector("#reportSelection [data-revert-selection]")?.disabled===true,recordId);};
    await check("isolated library contains empty single-record same-day archived and deleted cases",async()=>{
      ids=await page.evaluate(async factory=>{
        const f=(0,eval)("("+factory+")")(window,1),M=RingsideModel,lib=M.libraryDefaults(),deletedAt="2026-06-01T00:00:00.000Z";
        const record=(athleteId,recordId,name,date,title,flags={})=>{const r=structuredClone(f.records[0]);Object.assign(r,{athleteId,recordId,title,evaluationProfileId:f.profile.id,...flags});Object.assign(r.athlete,{name,date});M.applyAge(r);Object.keys(r.enabled).forEach(key=>{r.enabled[key]=key==="cmj";});r.narrative={...r.narrative,text:"原始正文 "+recordId,html:"<p>原始正文 "+recordId+"</p>"};r.data.cmj.forEach((row,i)=>{row.notes="原始试次 "+recordId+"-"+i;});return r;};
        const owner=(id,name,records,flags={})=>({id,name,profile:{...M.profileFromRecord(records[0]||f.records[0]),name},archived:false,deletedAt:null,records,...flags});
        const same="edge-same-day",one="edge-one-record-owner",empty="edge-empty-owner",archived="edge-archived-owner",deleted="edge-deleted-owner";
        lib.schema=3;lib.catalog=f.catalog;lib.evaluationProfiles=[RingsideEvaluation.serializeProfile(f.profile)];lib.defaultEvaluationProfileId=f.profile.id;
        lib.athletes=[owner(same,"同日记录队员",[
          record(same,"edge-same-day-000001","同日记录队员","2026-05-01","同日第一条"),record(same,"edge-same-day-000002","同日记录队员","2026-05-01","同日第二条"),
          record(same,"edge-record-archived","同日记录队员","2026-05-02","已归档测试",{archived:true}),record(same,"edge-record-deleted","同日记录队员","2026-05-03","已删除测试",{deletedAt})
        ]),owner(one,"单记录队员",[record(one,"edge-only-record-000001","单记录队员","2026-04-03","唯一记录")]),owner(empty,"尚无记录队员",[]),
          owner(archived,"已归档队员",[record(archived,"edge-owner-archived-record","已归档队员","2026-04-01","归档档案记录")],{archived:true}),
          owner(deleted,"已删除队员",[record(deleted,"edge-owner-deleted-record","已删除队员","2026-04-02","删除档案记录",{deletedAt})],{deletedAt})];
        lib.activeAthleteId=same;lib.activeRecordId=lib.athletes[0].records[0].recordId;await App.importPayload(lib,"replace-library");await App.showReport(false);const saved=await App.saveNow();if(!saved)throw Error("fixture did not save");
        return{same,one,empty,archived,deleted,sameRecords:lib.athletes[0].records.slice(0,2).map(r=>r.recordId),hiddenRecords:lib.athletes[0].records.slice(2).map(r=>r.recordId),onlyRecord:lib.athletes[1].records[0].recordId,allRecords:lib.athletes.flatMap(a=>a.records.map(r=>r.recordId))};
      },createFixture.toString());baseline=await rawRecords();assert.equal(baseline.length,7);assert.ok(baseline.every(Boolean));receipt.originalRecordsSha256=objectHash(baseline);assert.equal((await current()).recordId,ids.sameRecords[0]);
    });
    await check("archived and deleted athletes are retained in storage and excluded from object choices",async()=>{
      await u.open("athletes");const visible=await page.locator("[data-select-athlete]").evaluateAll(nodes=>nodes.map(n=>n.dataset.selectAthlete));assert.deepEqual(visible.sort(),[ids.same,ids.one,ids.empty].sort());
      const flags=await page.evaluate(ids=>({archived:App.getLibrary().athletes.find(a=>a.id===ids.archived)?.archived,deleted:App.getLibrary().athletes.find(a=>a.id===ids.deleted)?.deletedAt}),ids);assert.equal(flags.archived,true);assert.ok(flags.deleted);
    });
    await check("an athlete with no records has an empty date list and disabled View report",async()=>{
      const before=await current();await u.removeAthlete(ids.same);await u.chooseAthlete(ids.empty);await u.open("records");assert.equal(await page.locator("[data-person] [data-select-record]").count(),0);assert.match(await page.locator("[data-person] .empty").innerText(),/尚无测试记录/);assert.equal(await page.locator("[data-apply-selection]").isDisabled(),true);assert.deepEqual((await draft()).athletes,[{athleteId:ids.empty,recordIds:[]}]);assert.deepEqual(await current(),before);await revert();
    });
    await check("a newly selected athlete never autochooses its sole record",async()=>{
      const before=await current();await u.removeAthlete(ids.same);await u.chooseAthlete(ids.one);await u.open("records");const only=page.locator('[data-select-record="'+ids.onlyRecord+'"]');assert.equal(await only.count(),1);assert.equal(await only.isChecked(),false);assert.deepEqual((await draft()).athletes,[{athleteId:ids.one,recordIds:[]}]);assert.equal(await page.locator("[data-apply-selection]").isDisabled(),true);assert.deepEqual(await current(),before);await u.chooseRecord(ids.one,ids.onlyRecord);await applyRecord(ids.onlyRecord);
    });
    await check("same-day distinct record IDs are individually selectable and archived or deleted records stay excluded",async()=>{
      const before=await current();await u.removeAthlete(ids.one);await u.chooseAthlete(ids.same);await u.open("records");const list=page.locator('[data-person="'+ids.same+'"]');assert.deepEqual(await list.locator("[data-select-record]").evaluateAll(nodes=>nodes.map(n=>n.dataset.selectRecord)),ids.sameRecords);
      for(const id of ids.hiddenRecords)assert.equal(await list.locator('[data-select-record="'+id+'"]').count(),0);
      assert.equal(await list.locator("label").filter({hasText:"2026-05-01"}).count(),2);assert.deepEqual((await draft()).athletes[0].recordIds,[]);
      await u.chooseRecord(ids.same,ids.sameRecords[0]);assert.deepEqual((await draft()).athletes[0].recordIds,[ids.sameRecords[0]]);await u.chooseRecord(ids.same,ids.sameRecords[1]);assert.deepEqual((await draft()).athletes[0].recordIds,ids.sameRecords);assert.deepEqual(await current(),before);
      await u.chooseRecord(ids.same,ids.sameRecords[1],false);await applyRecord(ids.sameRecords[0]);await u.chooseRecord(ids.same,ids.sameRecords[0],false);await u.chooseRecord(ids.same,ids.sameRecords[1]);await applyRecord(ids.sameRecords[1]);assert.equal((await current()).longitudinal,null);
    });
    await check("collapse outside click and Escape each preserve unapplied record choices",async()=>{
      const before=await current();await u.chooseRecord(ids.same,ids.sameRecords[0]);const pending=await draft();assert.equal(pending.athletes[0].recordIds.length,2);
      await page.locator('[data-selection-panel="records"] [data-selection-close]').click();assert.equal(await page.locator('[data-selection-panel="records"]').isVisible(),false);assert.deepEqual(await draft(),pending);assert.deepEqual(await current(),before);
      await u.open("records");await page.locator("#athleteMeta").click();assert.equal(await page.locator('[data-selection-panel="records"]').isVisible(),false);assert.deepEqual(await draft(),pending);assert.deepEqual(await current(),before);
      await u.open("records");await page.keyboard.press("Escape");assert.equal(await page.locator('[data-selection-panel="records"]').isVisible(),false);assert.equal(await page.locator('[data-selection-toggle="records"]').evaluate(n=>n===document.activeElement),true);assert.deepEqual(await draft(),pending);assert.deepEqual(await current(),before);
    });
    await check("revert discards pending dates and restores exactly the currently displayed report",async()=>{
      const before=await current();assert.equal(await page.locator("[data-revert-selection]").isDisabled(),false);await revert();assert.deepEqual((await draft()).athletes,[{athleteId:ids.same,recordIds:[ids.sameRecords[1]]}]);assert.deepEqual(await current(),before);assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);
    });
    await check("clean desktop and narrow selectors and cohort dialog fit the viewport without changing the report",async()=>{
      const before=await current(),selection=await draft();for(const width of[1440,390]){await page.setViewportSize({width,height:width===1440?1000:844});await page.keyboard.press("Escape");await page.waitForFunction(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);await screenshot("collapsed-"+width);await u.open("records");await screenshot("same-day-records-"+width);const modal=await u.openReference();const bounds=await modal.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1);await screenshot("cohort-dialog-"+width);await modal.locator("[data-reference-cancel]").last().click();await page.keyboard.press("Escape");assert.deepEqual(await draft(),selection);assert.deepEqual(await current(),before);}
    });
    await check("all original record content flags protocols and narratives remain exact",async()=>{
      assert.equal(await page.evaluate(()=>App.saveNow()),true);const final=await rawRecords();assert.deepEqual(final,baseline);receipt.finalOriginalRecordsSha256=objectHash(final);assert.equal(receipt.finalOriginalRecordsSha256,receipt.originalRecordsSha256);assert.equal(hash(source),receipt.sourceHash);assert.equal(hash(isolated),receipt.sourceHash);assert.equal(hash(__filename),receipt.runnerSha256);
    });
    assert.deepEqual(receipt.errors,[]);receipt.pass=true;
  }catch(error){receipt.failure=error.stack||String(error);if(page){receipt.failureState=await page.evaluate(()=>({selection:App.getReportSelection(),currentRecordId:App.getState()?.recordId,status:document.querySelector("#reportSelection .selection-status")?.textContent,toast:document.querySelector("#toast")?.textContent})).catch(()=>null);await page.screenshot({path:path.join(OUT,channel+"-failure.png"),fullPage:true}).catch(()=>{});}throw error;}
  finally{receipt.finishedAt=new Date().toISOString();fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));await browser?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
