"use strict";
// Synthetic library in an isolated file origin and browser context; never opens
// the installed application or the daily-use data directory.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const {createHash} = require("node:crypto"), {pathToFileURL} = require("node:url");
const {chromium} = require("./helpers/playwright.cjs"), {createFixture} = require("./helpers/longitudinal-fixture.cjs");
const ROOT = path.resolve(__dirname, ".."), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const source = path.resolve(arg("--source", path.join(ROOT, "MotionBench.html")));
const out = path.resolve(arg("--artifact-dir", path.join(ROOT, "output/release/2.28.1-local/acceptance/navigation-" + channel)));
const pdfRequested = process.argv.includes("--pdf"), hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const outputRelative = path.relative(path.join(ROOT, "output"), out);
assert.ok(outputRelative && !outputRelative.startsWith("..") && !path.isAbsolute(outputRelative));

async function main() {
  fs.mkdirSync(out, {recursive:true});
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-report-navigation-")), isolated = path.join(temporary, "MotionBench.html");
  fs.copyFileSync(source, isolated);
  const receipt = {synthetic:true, isolated:true, channel, sourceHash:hash(source), runnerSha256:hash(__filename),
    fixtureSha256:hash(path.join(__dirname,"helpers/longitudinal-fixture.cjs")), pdfRequested, checks:[], errors:[], artifacts:[], pass:false};
  let browser, context, page, baseline, ids, firstTeam;
  const artifact = (file,kind) => receipt.artifacts.push({path:path.relative(ROOT,file).replaceAll("\\","/"),kind,sha256:hash(file),bytes:fs.statSync(file).size});
  const check = async (name, fn) => {receipt.stage=name;await fn();receipt.checks.push(name);console.log("PASS " + name);};
  const ready = async () => {await page.waitForFunction(()=>window.App?.ready);assert.equal(await page.evaluate(()=>App.ready),true);};
  const owner = () => page.evaluate(() => {
    if(App.getTeam())return {kind:"team",id:App.getTeamDocument().id,basis:App.getTeamDocument().basis};
    if(App.getHorizontal())return {kind:"horizontal",id:App.getHorizontalDocument().id,basis:App.getHorizontalDocument().basis};
    if(App.getLongitudinal())return {kind:"longitudinal",id:App.getLongitudinalDocument().key,basis:App.getLongitudinalDocument().basis};
    return {kind:"single",id:App.getState()?.recordId||null};
  });
  const rawRecords = () => page.evaluate(recordIds=>Promise.all(recordIds.map(id=>App.getRepository().loadRecord(id))),ids.records);
  const personal = () => page.locator("#reportSelection"), team = () => page.locator("#teamReportSelection");
  const setup = async (family,{edit=false}={}) => {
    await page.evaluate(async ({family,edit})=>edit?App.adjustCurrentReport():App.openReportSetup(family,{edit:false}),{family,edit});
    await page.locator("#reportSetupView").waitFor({state:"visible"});
    const state=await page.evaluate(()=>App.getReportSetup());assert.equal(state.family,family);assert.equal(state.intent,edit?"edit":"new");
    assert.equal(await page.locator("#reportView").isVisible(),false);
  };
  const panel = async kind => {const button=personal().locator('[data-selection-toggle="'+kind+'"]');if(await button.getAttribute("aria-expanded")!=="true")await button.click();};
  const mode = async value => {await personal().locator("[data-analysis-mode]").selectOption(value);assert.equal(await personal().locator("[data-analysis-mode]").inputValue(),value);};
  const choosePerson = async (id, query) => {await panel("athletes");await personal().locator("[data-selection-search]").fill(query);await personal().locator('[data-select-athlete="'+id+'"]').check();};
  const chooseRecord = async (athleteId,recordId,checked=true) => {await panel("records");await personal().locator('[data-person="'+athleteId+'"] [data-select-record="'+recordId+'"]').setChecked(checked);};
  const reportMode = async () => {await page.waitForFunction(()=>App.getReportSetup()===null);assert.equal(await page.locator("#reportSetupView").isVisible(),false);assert.equal(await page.locator("#reportView").isVisible(),true);};
  const applyPersonal = async () => {await personal().locator("[data-apply-selection]").click();await reportMode();};
  const teamPanel = async name => {const button=team().locator('[data-team-toggle="'+name+'"]');if(await team().locator('[data-team-panel="'+name+'"]').isHidden())await button.click();};
  const teamDates = async () => {
    await teamPanel("records");
    for(const [field,value] of [["from","2026-11-04"],["to","2026-11-06"]]){const input=team().locator('[data-team-field="'+field+'"]');await input.fill(value);await input.press("Tab");}
  };
  const teamSource = async () => {await team().locator('[data-team-field="groupId"]').selectOption("navigation-team");await teamDates();};
  const shot = async name => {await page.evaluate(()=>document.fonts.ready);const file=path.join(out,name+".png");await page.screenshot({path:file,fullPage:false});artifact(file,"screenshot");};
  const fits = async () => {
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
    const result=await team().locator('button[type="submit"]').evaluate(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,viewport:[innerWidth,innerHeight]};});
    assert.ok(result.top>=0&&result.bottom<=result.viewport[1]+1&&result.left>=0&&result.right<=result.viewport[0]+1,JSON.stringify(result));
  };
  try {
    browser=await chromium.launch({channel,headless:true});context=await browser.newContext({offline:true,locale:"zh-CN",viewport:{width:1440,height:900},reducedMotion:"reduce",acceptDownloads:true});
    page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",error=>receipt.errors.push(error.stack||error.message));page.on("dialog",dialog=>dialog.accept());
    await page.goto(pathToFileURL(isolated).href);await ready();
    await check("isolated 158-person library opens its report with two clear family entries",async()=>{
      ids=await page.evaluate(async factory=>{
        const f=(0,eval)("("+factory+")")(window,3),M=RingsideModel,lib=M.libraryDefaults();lib.schema=3;lib.catalog=f.catalog;
        lib.groups=[{id:"navigation-other",name:"其他合成队"},{id:"navigation-team",name:"目标合成队"}];
        lib.evaluationProfiles=[RingsideEvaluation.serializeProfile(f.profile)];lib.defaultEvaluationProfileId=f.profile.id;
        lib.athletes=Array.from({length:158},(_,i)=>{
          const id="navigation-person-"+i,name=i===0?"导航甲":i===1?"导航乙":i===2?"跨队补选员":i===157?"目标队未测成员":"合成成员"+String(i).padStart(3,"0"),count=i<2?3:i>=128&&i<131?1:0;
          const records=f.records.slice(0,count).map((input,j)=>{const r=structuredClone(input);r.athleteId=id;r.recordId="navigation-record-"+i+"-"+j;r.athlete.name=name;r.athlete.date="2026-11-0"+(j+4);r.evaluationProfileId=f.profile.id;r.demo=false;r.sample=false;for(const key in r.enabled)r.enabled[key]=key==="cmj";r.data.cmj.forEach(row=>row.height+=i%5);return r;});
          return {id,name,profile:{...M.profileFromRecord(records[0]||f.records[0]),name},groupId:i<128?"navigation-other":"navigation-team",archived:false,deletedAt:null,records};
        });
        lib.activeAthleteId=lib.athletes[0].id;lib.activeRecordId=lib.athletes[0].records[0].recordId;await App.importPayload(lib,"replace-library");await App.showReport(false);if(!await App.saveNow())throw Error("synthetic fixture save failed");
        return {a:lib.athletes[0].id,b:lib.athletes[1].id,aRecords:lib.athletes[0].records.map(r=>r.recordId),bRecords:lib.athletes[1].records.map(r=>r.recordId),records:lib.athletes.flatMap(a=>a.records.map(r=>r.recordId))};
      },createFixture.toString());baseline=await rawRecords();await reportMode();
      assert.equal(await page.locator('[data-report-family="personal"]').count(),1);assert.equal(await page.locator('[data-report-family="team"]').count(),1);
      assert.equal(await page.locator("#teamReportDialog").count(),0);assert.equal(await page.evaluate(()=>App.getLibrary().athletes.length),158);
    });
    await check("personal setup preserves the original person then record then View flow and search does not change choices",async()=>{
      await page.locator('[data-report-family="personal"]').click();await page.locator("#reportSetupView").waitFor({state:"visible"});assert.equal(await page.evaluate(()=>App.getReportSetup().family),"personal");assert.equal(await page.locator("#reportView").isVisible(),false);
      await mode("single");await panel("athletes");await personal().locator("[data-selection-group]").selectOption("navigation-other");await choosePerson(ids.a,"导航甲");
      const selected=await page.evaluate(()=>App.getReportSelection().athletes);await personal().locator("[data-selection-search]").fill("导航乙");assert.deepEqual(await page.evaluate(()=>App.getReportSelection().athletes),selected);await personal().locator("[data-selection-search]").fill("");
      await chooseRecord(ids.a,ids.aRecords[0]);await shot("personal-selection");await applyPersonal();assert.equal((await owner()).id,ids.aRecords[0]);
    });
    await check("explicit longitudinal mode keeps its identity while validating source counts",async()=>{
      const previous=await owner();await setup("personal",{edit:true});await mode("longitudinal");assert.equal(await personal().locator("[data-apply-selection]").isDisabled(),true);
      await chooseRecord(ids.a,ids.aRecords[1]);assert.deepEqual(await owner(),previous);assert.equal(await personal().locator("[data-analysis-mode]").inputValue(),"longitudinal");await applyPersonal();
      assert.equal((await owner()).kind,"longitudinal");assert.deepEqual((await page.evaluate(()=>App.getLongitudinalDocument().recordIds)).sort(),ids.aRecords.slice(0,2).sort());
    });
    await check("explicit horizontal mode retains incompatible dates until the user resolves them",async()=>{
      const previous=await owner();await setup("personal",{edit:true});await mode("horizontal");assert.deepEqual((await page.evaluate(()=>App.getReportSelection().athletes[0].recordIds)).sort(),ids.aRecords.slice(0,2).sort());assert.equal(await personal().locator("[data-apply-selection]").isDisabled(),true);
      await choosePerson(ids.b,"导航乙");await chooseRecord(ids.a,ids.aRecords[1],false);await chooseRecord(ids.b,ids.bRecords[0]);assert.deepEqual(await owner(),previous);await applyPersonal();assert.equal((await owner()).kind,"horizontal");
    });
    await check("editing an existing horizontal report preserves its identity and authored narrative",async()=>{
      await page.evaluate(()=>App.openEntry("narrative"));await page.locator("#interpEditor").fill("导航验收人工解读，调整当前配置时保留。");await page.evaluate(()=>App.showReport(false));
      const previous=await page.evaluate(()=>({id:App.getHorizontalDocument().id,narrative:App.getHorizontalDocument().narrative.text}));await setup("personal",{edit:true});
      await personal().locator("[data-selection-settings-toggle]").click();await personal().locator("[data-report-title]").fill("调整当前横向报告");await personal().locator("[data-report-title]").blur();await applyPersonal();
      assert.deepEqual(await page.evaluate(()=>({id:App.getHorizontalDocument().id,narrative:App.getHorizontalDocument().narrative.text})),previous);
    });
    await check("cancelling a different-family setup returns to the original owner and reading position",async()=>{
      await page.evaluate(()=>window.scrollTo({top:320,behavior:"instant"}));const previous=await owner(),scroll=await page.evaluate(()=>scrollY);
      await setup("team");await teamSource();await team().locator("[data-team-cancel]").click();await reportMode();assert.deepEqual(await owner(),previous);await page.waitForFunction(value=>Math.abs(scrollY-value)<3,scroll);
    });
    await check("a late source read cannot replace a newer setup choice",async()=>{
      const previous=await owner();await setup("personal",{edit:true});await chooseRecord(ids.b,ids.bRecords[1]);
      await page.evaluate(()=>{const repo=App.getRepository();window.navigationOriginalRead=repo.loadHorizontalSources.bind(repo);repo.loadHorizontalSources=async options=>{await new Promise(resolve=>window.navigationReleaseRead=resolve);return navigationOriginalRead(options);};});
      await personal().locator("[data-apply-selection]").click();await page.waitForFunction(()=>typeof navigationReleaseRead==="function");
      await page.evaluate(()=>{window.navigationSwitch=App.openReportSetup("team",{edit:false});});await page.evaluate(()=>navigationReleaseRead());await page.evaluate(()=>navigationSwitch);
      await page.waitForFunction(()=>App.getReportSetup()?.family==="team");assert.deepEqual(await owner(),previous);await page.evaluate(()=>{App.getRepository().loadHorizontalSources=navigationOriginalRead;});await page.evaluate(()=>App.cancelReportSetup());await reportMode();
    });
    await check("team grouping and search preserve every selected record and keep actions visible in small windows",async()=>{
      await setup("team");await teamSource();await teamPanel("members");
      assert.equal(await team().locator("[data-team-member-group]").first().getAttribute("data-team-own-group"),"true");assert.equal(await team().locator('[data-team-own-group="true"] [data-team-person]:checked').count(),30);
      const values=await team().locator("[data-team-record]").evaluateAll(nodes=>nodes.map(n=>[n.dataset.teamRecord,n.value]));await team().locator("[data-team-search]").fill("跨队补选员");await team().locator("[data-team-search]").fill("");assert.deepEqual(await team().locator("[data-team-record]").evaluateAll(nodes=>nodes.map(n=>[n.dataset.teamRecord,n.value])),values);
      for(const viewport of [{width:1440,height:900},{width:1366,height:768},{width:390,height:844}]){await page.setViewportSize(viewport);await fits();await teamPanel("records");await fits();await shot("team-setup-"+viewport.width);await teamPanel("members");}
      await page.setViewportSize({width:1440,height:900});
    });
    await check("failed team persistence leaves the previous report and a retryable setup",async()=>{
      const previous=await owner();await page.evaluate(()=>{const repo=App.getRepository();window.navigationOriginalSave=repo.saveTeamReport.bind(repo);repo.saveTeamReport=async()=>{throw Error("合成团队保存失败");};});
      await team().locator('button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#teamReportSelection [data-team-selection-error]')?.classList.contains("field-error")&&!document.querySelector('#teamReportSelection button[type="submit"]')?.disabled);
      assert.equal(await page.evaluate(()=>App.getReportSetup()?.family),"team");assert.deepEqual(await owner(),previous);assert.equal(await page.locator("#reportView").isVisible(),false);
      await page.evaluate(()=>{App.getRepository().saveTeamReport=navigationOriginalSave;});await team().locator('button[type="submit"]').click();await reportMode();assert.equal((await owner()).kind,"team");assert.equal(await page.evaluate(()=>App.getTeam().participants.length),30);
    });
    await check("adjusting a team keeps its document while a new source intent creates another document",async()=>{
      await page.evaluate(()=>App.openEntry("narrative"));await page.locator("#interpEditor").fill("团队导航人工正文。");await page.evaluate(()=>App.showReport(false));
      firstTeam=await page.evaluate(()=>({id:App.getTeamDocument().id,narrative:App.getTeamDocument().narrative.text}));await setup("team",{edit:true});await teamPanel("records");await team().locator('[data-team-field="title"]').fill("当前团队配置已调整");await team().locator('[data-team-field="title"]').blur();await team().locator('button[type="submit"]').click();await reportMode();assert.deepEqual(await page.evaluate(()=>({id:App.getTeamDocument().id,narrative:App.getTeamDocument().narrative.text})),firstTeam);
      await setup("team");await teamSource();await team().locator('button[type="submit"]').click();await reportMode();assert.notEqual(await page.evaluate(()=>App.getTeamDocument().id),firstTeam.id);assert.notEqual(await page.evaluate(()=>App.getTeamDocument().narrative.text),firstTeam.narrative);
    });
    await check("normal reload and saved-report reopen show the report instead of its setup",async()=>{
      const previous=await owner();await page.reload();await ready();await reportMode();assert.deepEqual(await owner(),previous);
      await setup("personal");assert.equal(await page.evaluate(id=>App.restoreSavedReport("team:"+id),firstTeam.id),true);await reportMode();assert.deepEqual(await page.evaluate(()=>({id:App.getTeamDocument().id,narrative:App.getTeamDocument().narrative.text})),firstTeam);await shot("team-report");
    });
    if(pdfRequested)await check("one real PDF export retains all team source rows after navigation",async()=>{
      const pending=page.waitForEvent("download",{timeout:300000});pending.catch(()=>{});await page.evaluate(()=>App.downloadPDF());const download=await pending;assert.equal(await download.failure(),null);const file=path.join(out,"navigation-team.pdf");await download.saveAs(file);assert.ok(fs.statSync(file).size>10000);artifact(file,"pdf");
      receipt.pdfDiagnostics=await page.evaluate(()=>RingsidePDF.lastDiagnostics);assert.equal(receipt.pdfDiagnostics.status,"complete");for(const name of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(receipt.pdfDiagnostics[name],[]);
    });
    await check("all measured source records and the tested build remain unchanged",async()=>{
      assert.deepEqual(await rawRecords(),baseline);assert.equal(hash(source),receipt.sourceHash);assert.equal(hash(isolated),receipt.sourceHash);assert.equal(hash(__filename),receipt.runnerSha256);
    });
    assert.deepEqual(receipt.errors,[]);receipt.pass=true;
  } catch(error) {
    receipt.failure=error.stack||String(error);console.error(receipt.failure);
    if(page){receipt.failureState=await page.evaluate(()=>({setup:App.getReportSetup?.(),selection:App.getReportSelection?.(),toast:document.querySelector("#toast")?.textContent})).catch(()=>null);const file=path.join(out,"failure.png");await page.screenshot({path:file,fullPage:true}).catch(()=>{});if(fs.existsSync(file))artifact(file,"failure-screenshot");}
    process.exitCode=1;
  } finally {
    receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(receipt,null,2));await browser?.close();
  }
  console.log(JSON.stringify({pass:receipt.pass,checks:receipt.checks.length,out}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
