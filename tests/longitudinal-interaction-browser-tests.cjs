"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), {createHash} = require("node:crypto"), {pathToFileURL} = require("node:url");
const {chromium} = require("./helpers/playwright.cjs"), {createFixture} = require("./helpers/longitudinal-fixture.cjs");
const root = path.resolve(__dirname, ".."), source = path.join(root, "MotionBench.html"), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.resolve(root, process.argv.includes("--artifact-dir") ? process.argv[process.argv.indexOf("--artifact-dir") + 1] : `output/playwright/v224/longitudinal-interaction/${channel}`);
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function main() {
  fs.mkdirSync(out, {recursive:true});
  const result = {synthetic:true, channel, sourceHash:hash(source), runnerSha256:hash(__filename), fixtureSha256:hash(path.join(__dirname,"helpers/longitudinal-fixture.cjs")), checks:[], errors:[], artifacts:[], pass:false};
  let browser, context, page, fixture;
  const artifact = file => result.artifacts.push({file:path.relative(root,file).replaceAll("\\","/"), sha256:hash(file)});
  const check = async (name, run) => {await run();result.checks.push(name);console.log("PASS " + name);};
  const ready = async () => {await page.waitForFunction(() => window.App?.ready);assert.equal(await page.evaluate(() => App.ready),true);};
  const seed = async (count, variant = "normal", prefix = "A") => {
    fixture = await page.evaluate(async ({factory,count,variant,prefix}) => {
      const f = (0,eval)("("+factory+")")(window,count), M=RingsideModel, lib=M.libraryDefaults();
      f.athleteId = "interaction-athlete-" + prefix;
      f.records.forEach((record,index) => {
        record.athleteId=f.athleteId;record.recordId=prefix+"-period-"+String(index+1).padStart(2,"0");
        record.athlete.name="交互验收合成队员 "+prefix;record.title="合成测试 "+String(index+1);
        // Keep the interaction fixture small; the report suite covers all project renderers.
        for(const id of Object.keys(record.enabled))record.enabled[id]=id==="cmj";
        record.evaluationProfileId=f.profile.id;record.narrative.html=M.textToHTML(record.narrative.text);
      });
      if(variant==="dates") {
        f.records[1].athlete.date=f.records[0].athlete.date;
        f.records[1].created="2026-01-01T01:00:00.000Z";f.records[1].title="同日第二次测试";
      }
      lib.catalog=f.catalog;lib.evaluationProfiles=[f.profile];lib.defaultEvaluationProfileId=f.profile.id;
      lib.athletes=[{id:f.athleteId,name:f.records[0].athlete.name,profile:M.profileFromRecord(f.records[0]),groupId:"",records:f.records,archived:false,deletedAt:null}];
      let other=null;
      if(variant==="two-athletes") {
        const record=JSON.parse(JSON.stringify(f.records[0]));record.athleteId="interaction-athlete-other";record.recordId="other-athlete-period";record.athlete.name="另一名合成队员";
        M.applyAge(record);
        record.narrative.text="独立单期人工正文：另一名队员。";record.narrative.html=M.textToHTML(record.narrative.text);
        lib.athletes.push({id:record.athleteId,name:record.athlete.name,profile:M.profileFromRecord(record),groupId:"",records:[record],archived:false,deletedAt:null});
        other={athleteId:record.athleteId,recordId:record.recordId,name:record.athlete.name};
      }
      lib.activeAthleteId=f.athleteId;lib.activeRecordId=f.records[0].recordId;
      await App.importPayload(lib,"replace-library");await App.showReport(false);
      if(variant==="dates") {
        // Normal import correctly rejects undated records. Seed one damaged historical
        // row directly in this isolated database to exercise the picker guard itself.
        const repo=App.getRepository(),id=f.records.at(-1).recordId;
        const record=await repo.loadRecord(id),index=await repo.get("recordIndex",id);
        record.athlete.date="";index.athlete.date="";
        const tx=repo.db.transaction(["records","recordIndex"],"readwrite");
        const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
        tx.objectStore("records").put({generation:repo.generation,id,value:record});tx.objectStore("recordIndex").put({generation:repo.generation,id,value:index});await done;
        await App.loadDirectory(false);App.renderSelectors();f.records.at(-1).athlete.date="";
      }
      return {athleteId:f.athleteId,ids:f.records.map(r=>r.recordId),dates:f.records.map(r=>r.athlete.date),other};
    }, {factory:createFixture.toString(),count,variant,prefix});
    fixture.baseline=await storedRecords(fixture.ids);
    return fixture;
  };
  const start = async (count, variant="normal", prefix="A") => {
    await context?.close();context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(25000);
    page.on("pageerror",error=>result.errors.push(error.message));page.on("dialog",dialog=>dialog.accept());
    await page.goto(pathToFileURL(source).href);await ready();return seed(count,variant,prefix);
  };
  const storedRecords = ids => page.evaluate(async ids => Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids);
  const checkedIds = () => page.locator("[data-record-choice]:checked").evaluateAll(nodes=>nodes.map(node=>node.dataset.recordChoice).sort());
  const picker = async () => {if(!await page.locator("#recordChoiceMenu").evaluate(node=>node.open))await page.locator("#recordChoiceLabel").click();};
  const choose = async (id, selected=true) => {await picker();await page.locator(`[data-record-choice="${id}"]`).setChecked(selected);};
  const settled = async ids => {
    await page.waitForFunction(ids => {
      const model=App.getLongitudinal();
      return model?.periods.length===ids.length && model.periods.map(p=>p.id).sort().join("|")===ids.slice().sort().join("|") && document.getElementById("recordContext").textContent.includes(ids.length+" 次") && !document.getElementById("saveStatus").textContent.includes("正在保存");
    },ids);
    assert.deepEqual(await checkedIds(),ids.slice().sort());
  };
  const closePicker = () => page.evaluate(()=>{document.getElementById("recordChoiceMenu").open=false;});
  const body = async text => {
    await closePicker();await page.locator('button[onclick="App.openEntry(\'narrative\')"]').click();
    await page.locator("#interpEditor").fill(text);await page.locator("#workspaceBack").click();
    await page.waitForFunction(text=>document.getElementById("narrativeView").innerText.includes(text),text);
    assert.equal(await page.evaluate(()=>App.saveNow()),true);
  };
  const manage = async tab => {
    await closePicker();
    // Open the existing workspace navigation, then choose the existing management tab.
    const button=page.locator(`[data-workspace-nav="${tab}"]`);
    if(!await button.isVisible())await page.locator("#sidebarToggle").click();
    await button.click();
    await page.waitForFunction(()=>App.getUIState().mode==="management");
  };
  const managerAction = async (action,id) => {
    const button=page.locator(`[data-manager-action="${action}"]${id?`[data-id="${id}"]`:""}`).first();
    if(!await button.isVisible())await button.locator("xpath=ancestor::details[1]").locator("summary").first().click();
    await button.click();
  };
  const expectSingle = async expectedAthlete => {
    await page.waitForFunction(expectedAthlete=>App.getState()?.athleteId===expectedAthlete && App.getLongitudinal()===null && !document.getElementById("reportView").dataset.longitudinal && document.querySelectorAll("[data-record-choice]:checked").length===1 && document.querySelector("[data-record-choice]:checked").dataset.recordChoice===App.getState().recordId && !document.getElementById("saveStatus").textContent.includes("正在保存"),expectedAthlete);
    assert.equal(await page.locator("#reportView").getAttribute("data-longitudinal"),null);
    assert.equal((await checkedIds()).length,1);
    assert.match(await page.locator("#narrativeView").innerText(),/独立单期人工正文/);
  };
  try {
    browser=await chromium.launch({channel});
    await check("failed comparison-document transaction retains the old selection and body; checkbox retry succeeds",async()=>{
      const f=await start(3);await choose(f.ids[1]);await settled(f.ids.slice(0,2));await body("故障重试前的独立比较正文。");
      const prior=await page.evaluate(()=>({fingerprint:App.getLongitudinal().fingerprint,document:App.getLongitudinalDocument()}));
      await page.evaluate(()=>{
        const original=IDBObjectStore.prototype.put;
        window.__comparisonFailure={fired:false};
        IDBObjectStore.prototype.put=function(value,...args){
          if(this.name==="config"&&value?.value?.longitudinalReports?.some(doc=>doc.recordIds.length===3)){
            IDBObjectStore.prototype.put=original;window.__comparisonFailure.fired=true;
            throw new DOMException("Synthetic comparison save failure","QuotaExceededError");
          }
          return original.call(this,value,...args);
        };
      });
      await choose(f.ids[2]);
      await page.waitForFunction(()=>window.__comparisonFailure.fired&&document.getElementById("saveStatus").textContent.includes("保存失败")&&document.querySelectorAll("[data-record-choice]:checked").length===2);
      assert.equal(await page.evaluate(()=>App.getLongitudinal().fingerprint),prior.fingerprint);
      assert.equal(await page.evaluate(()=>App.getLongitudinalDocument().narrative.text),prior.document.narrative.text);
      assert.match(await page.locator("#narrativeView").innerText(),/故障重试前的独立比较正文/);
      const directory=await page.evaluate(()=>App.getRepository().directory());
      assert.ok(directory.longitudinalReports.some(doc=>doc.key===prior.document.key));assert.equal(directory.longitudinalReports.some(doc=>doc.recordIds.length===3),false);
      assert.deepEqual(await checkedIds(),f.ids.slice(0,2).sort());
      await choose(f.ids[2]);await settled(f.ids);await choose(f.ids[2],false);await settled(f.ids.slice(0,2));
      assert.match(await page.locator("#narrativeView").innerText(),/故障重试前的独立比较正文/);
      assert.deepEqual(await storedRecords(f.ids),f.baseline);
    });
    await check("rapid checkbox add/remove while record loads wait produces exactly the final selection",async()=>{
      const f=await start(4);
      await page.evaluate(()=>{
        const repo=App.getRepository(),original=repo.loadRecord.bind(repo);
        let release;window.__comparisonGate={entered:0,release:()=>release()};
        const gate=new Promise(resolve=>{release=resolve;});
        repo.loadRecord=async function(id){window.__comparisonGate.entered++;await gate;return original(id);};
        window.__comparisonGate.restore=()=>{repo.loadRecord=original;};
      });
      await choose(f.ids[1]);await page.waitForFunction(()=>window.__comparisonGate.entered>0);
      await choose(f.ids[2]);await choose(f.ids[1],false);await choose(f.ids[3]);
      const expected=[f.ids[0],f.ids[2],f.ids[3]];assert.deepEqual(await checkedIds(),expected.slice().sort());
      await page.evaluate(()=>{window.__comparisonGate.release();window.__comparisonGate.restore();});await settled(expected);
      await page.reload();await ready();await settled(expected);assert.deepEqual(await storedRecords(f.ids),f.baseline);
    });
    await check("choosing another athlete cancels delayed comparison loads without reviving the former owner",async()=>{
      const f=await start(3,"two-athletes");await choose(f.ids[1]);await settled(f.ids.slice(0,2));await body("原队员独立比较正文，不得进入另一名队员。");
      const otherBaseline=(await storedRecords([f.other.recordId]))[0];
      await page.evaluate(ids=>{
        const repo=App.getRepository(),original=repo.loadRecord.bind(repo);let release;
        window.__athleteGate={entered:0,finished:0,release:()=>release()};const gate=new Promise(resolve=>{release=resolve;});
        repo.loadRecord=async function(id){
          if(!ids.includes(id))return original(id);
          window.__athleteGate.entered++;await gate;
          try{return await original(id);}finally{window.__athleteGate.finished++;}
        };
        window.__athleteGate.restore=()=>{repo.loadRecord=original;};
      },f.ids);
      await choose(f.ids[2]);await page.waitForFunction(()=>window.__athleteGate.entered>0);await closePicker();
      await page.locator("#reportAthleteSearch").fill(f.other.name);await page.locator(`[data-athlete-choice="${f.other.athleteId}"]`).click();
      await expectSingle(f.other.athleteId);assert.match(await page.locator("#narrativeView").innerText(),/另一名队员/);
      await page.evaluate(()=>{window.__athleteGate.release();window.__athleteGate.restore();});
      await page.waitForFunction(()=>window.__athleteGate.finished===window.__athleteGate.entered);
      await expectSingle(f.other.athleteId);assert.deepEqual(await checkedIds(),[f.other.recordId]);
      await page.reload();await ready();await expectSingle(f.other.athleteId);
      assert.match(await page.locator("#narrativeView").innerText(),/另一名队员/);assert.deepEqual(await storedRecords(f.ids),f.baseline);
      assert.deepEqual((await storedRecords([f.other.recordId]))[0],otherBaseline);
    });
    await check("same-day tests remain distinct and a missing-date checkbox leaves the current report unchanged",async()=>{
      const f=await start(4,"dates");await choose(f.ids[1]);await settled(f.ids.slice(0,2));await body("同日两次测量各自保留。");
      const before=await page.evaluate(()=>({fingerprint:App.getLongitudinal().fingerprint,document:App.getLongitudinalDocument()}));
      const periods=await page.evaluate(()=>App.getLongitudinal().periods.map(p=>({id:p.id,date:p.date,label:p.label})));
      assert.equal(periods[0].date,periods[1].date);assert.notEqual(periods[0].id,periods[1].id);assert.notEqual(periods[0].label,periods[1].label);
      for(const p of periods)assert.ok((await page.locator(".longitudinal-results thead").first().innerText()).includes(p.label));
      await picker();await page.locator(`[data-record-choice="${f.ids[3]}"]`).click();
      await page.waitForFunction(()=>document.body.innerText.includes("有效测试日期")&&!document.querySelector('[data-record-choice="A-period-04"]').checked);
      assert.deepEqual(await checkedIds(),f.ids.slice(0,2).sort());assert.equal(await page.evaluate(()=>App.getLongitudinal().fingerprint),before.fingerprint);
      assert.deepEqual(await page.evaluate(()=>App.getLongitudinalDocument()),before.document);
      assert.deepEqual(await storedRecords(f.ids),f.baseline);
    });
    for(const count of [6,12])await check(`${count} selected dates remain complete in the visible tables, responsive page and reopened report`,async()=>{
      const f=await start(count);
      for(let i=1;i<f.ids.length;i++){await choose(f.ids[i]);await settled(f.ids.slice(0,i+1));}
      await body(`${count}期独立比较正文。`);
      const columns=await page.locator(".longitudinal-results").first().locator("thead th").allTextContents();
      for(const date of f.dates)assert.ok(columns.some(value=>value.includes(date)),date+" visible in table header");
      for(const id of f.ids)assert.ok(await page.locator(`.longitudinal-results td[data-record-id="${id}"]`).count(),id+" table cells rendered");
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
        await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+2);
        if(width<1100)await page.waitForFunction(()=>document.getElementById("workspace").getBoundingClientRect().left<1);
        const file=path.join(out,`${count}-periods-${width}.png`);await page.screenshot({path:file,animations:"disabled"});artifact(file);
      }
      await page.setViewportSize({width:1440,height:1000});await page.reload();await ready();await settled(f.ids);
      assert.match(await page.locator("#narrativeView").innerText(),new RegExp(count+"期独立比较正文"));
      assert.deepEqual(await storedRecords(f.ids),f.baseline);
    });
    await check("UI full-backup replacement and restore-previous clear the former comparison selection",async()=>{
      const a=await start(2,"normal","restoreA");await choose(a.ids[1]);await settled(a.ids);await body("资料库A的比较正文。");
      await manage("backup");const downloaded=page.waitForEvent("download");await page.locator('button[onclick="App.downloadLibrary()"]').first().click();
      const download=await downloaded,file=path.join(out,"interaction-A.motionbench.jsonl");assert.equal(await download.failure(),null);await download.saveAs(file);artifact(file);
      const b=await seed(2,"normal","restoreB");await choose(b.ids[1]);await settled(b.ids);await body("资料库B的比较正文。");
      await manage("backup");await page.locator("#backupImportMode").selectOption("replace");await page.locator("#importFile").setInputFiles(file);
      await page.waitForFunction(id=>App.getLibrary().athletes.some(a=>a.id===id)&&!App.getLongitudinal(),a.athleteId);
      await page.locator("#workspaceBack").click();await expectSingle(a.athleteId);
      assert.equal(await page.locator(`[data-record-choice="${b.ids[0]}"]`).count(),0);
      for(const id of a.ids)if(!(await checkedIds()).includes(id))await choose(id);
      await settled(a.ids);assert.match(await page.locator("#narrativeView").innerText(),/资料库A的比较正文/);
      await manage("backup");await managerAction("restore-library");
      await page.waitForFunction(id=>App.getLibrary().athletes.some(a=>a.id===id)&&!App.getLongitudinal(),b.athleteId);
      await page.locator("#workspaceBack").click();await expectSingle(b.athleteId);
      assert.equal(await page.locator(`[data-record-choice="${a.ids[0]}"]`).count(),0);
      await page.reload();await ready();await expectSingle(b.athleteId);
      for(const id of b.ids)if(!(await checkedIds()).includes(id))await choose(id);
      await settled(b.ids);assert.match(await page.locator("#narrativeView").innerText(),/资料库B的比较正文/);
    });
    await check("moving a selected record to trash clears the comparison on returning and on reload",async()=>{
      const f=await start(3);for(let i=1;i<3;i++){await choose(f.ids[i]);await settled(f.ids.slice(0,i+1));}await body("删除筛选前的比较正文。");
      const docKey=await page.evaluate(()=>App.getLongitudinalDocument().key);
      await manage("records");await managerAction("trash",f.ids[0]);
      await page.waitForFunction(id=>!!App.getLibrary().athletes.flatMap(a=>a.records).find(r=>r.recordId===id)?.deletedAt,f.ids[0]);
      await page.locator("#workspaceBack").click();await expectSingle(f.athleteId);
      assert.equal(await page.locator(`[data-record-choice="${f.ids[0]}"]`).count(),0);
      assert.equal(await page.evaluate(key=>App.getLibrary().longitudinalReports.some(doc=>doc.key===key),docKey),true);
      await page.reload();await ready();await expectSingle(f.athleteId);
      assert.equal(await page.locator(`[data-record-choice="${f.ids[0]}"]`).count(),0);
    });
    assert.deepEqual(result.errors,[]);assert.equal(hash(source),result.sourceHash);result.pass=true;
  } catch(error) {
    result.failure=error.stack;result.ui=await page?.evaluate(()=>({mode:App.getUIState(),recordId:App.getState()?.recordId,comparison:App.getLongitudinal()?.periods.map(p=>p.id),checked:[...document.querySelectorAll("[data-record-choice]:checked")].map(node=>node.dataset.recordChoice),save:document.getElementById("saveStatus").textContent,body:document.getElementById("narrativeView").innerText})).catch(()=>null);
    console.error(error.stack);console.error(result.ui);process.exitCode=1;
  } finally {
    result.sourceUnchanged=hash(source)===result.sourceHash;fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));await browser?.close();
  }
}
main();
