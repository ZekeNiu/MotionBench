"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),ROOT=path.resolve(__dirname,".."),arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const channel=process.argv.includes("--edge")?"msedge":"chrome",source=path.resolve(arg("--source",path.join(ROOT,"MotionBench.html"))),out=path.resolve(arg("--artifact-dir",path.join(ROOT,"output/release/2.29.0-local/acceptance/title-transaction-"+channel))),hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fixture(){
  const M=RingsideModel,record=M.defaults();Object.assign(record,{athleteId:"title-a",recordId:"title-a-early",demo:false});Object.assign(record.athlete,{name:"标题事务合成甲",sex:"男",birthDate:"2000-01-01",date:"2026-11-01",mass:70});Object.keys(record.enabled).forEach(id=>record.enabled[id]=id==="cmj");record.data.cmj=[{id:"jump-1",height:20,rsiModified:.5}];
  const lib=RingsideEvaluation.migrate(M.recordEnvelope(record)),copy=value=>JSON.parse(JSON.stringify(value));
  for(const [suffix,date,height] of[["middle","2026-11-05",30],["late","2026-11-09",40]]){const next=copy(lib.athletes[0].records[0]);next.recordId="title-a-"+suffix;next.athlete.date=date;next.data.cmj[0].height=height;lib.athletes[0].records.push(next);}
  const other=copy(lib.athletes[0]);other.id="title-b";other.name=other.profile.name="标题事务合成乙";other.records=[copy(other.records[0])];other.records[0].athleteId=other.id;other.records[0].recordId="title-b-early";other.records[0].athlete.name=other.name;other.records[0].data.cmj[0].height=50;lib.athletes.push(other);lib.activeAthleteId="title-a";lib.activeRecordId="title-a-early";for(const athlete of lib.athletes)for(const record of athlete.records)M.applyAge(record);return lib;
}
function current(){
  const document=App.getTeamDocument()||App.getHorizontalDocument()||App.getLongitudinalDocument()||App.getState();
  return {kind:App.getTeam()?"team":App.getHorizontal()?"horizontal":App.getLongitudinal()?"longitudinal":"single",id:document.id||document.key||document.recordId,identity:document.views?.reportIdentity||document.id||document.key||document.recordId,created:document.created,basis:document.basis||null,recordId:App.getState()?.recordId,title:document.views?.reportTitle||null,narrative:{text:document.narrative?.text,html:document.narrative?.html,revision:document.narrative?.revision,origin:document.narrative?.origin},display:window.document.getElementById("reportTitle").textContent};
}
async function main(){
  fs.mkdirSync(out,{recursive:true});const isolated=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-title-transaction-")),"MotionBench.html");fs.copyFileSync(source,isolated);
  const receipt={synthetic:true,isolated:true,channel,sourceHash:hash(source),runnerSha256:hash(__filename),checks:[],errors:[],cases:[],sourceUnchanged:false,pass:false},browser=await chromium.launch({channel,headless:true});
  try{
    for(const kind of["team","horizontal","longitudinal","single"]){
      const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}}),page=await context.newPage(),entry={kind,pass:false};receipt.cases.push(entry);page.on("pageerror",error=>receipt.errors.push(error.stack||error.message));
      try{
        await page.goto(pathToFileURL(isolated).href);await page.waitForFunction(()=>window.App?.ready);await page.evaluate(async factory=>{await App.importPayload((0,eval)("("+factory+")")(),"replace-library");await App.showReport(false);},fixture.toString());
        await page.evaluate(async kind=>{
          const participants=[{athleteId:"title-a",recordId:"title-a-early"},{athleteId:"title-b",recordId:"title-b-early"}];
          if(kind==="team")await App.selectTeam({analysisMode:"single",participants,window:{kind:"all",from:"",to:""},mode:"best",profileId:""});
          else if(kind==="horizontal")await App.selectHorizontal({participants,references:[],perspective:"peers",mode:"best",profileId:""});
          else if(kind==="longitudinal")await App.selectRecords(["title-a-early","title-a-middle"]);
          await App.openEntry("narrative");
        },kind);
        await page.locator("#interpEditor").fill(kind+" 原报告人工正文");await page.evaluate(()=>App.showReport(false));
        const family=kind==="team"?"team":"personal",titleSelector=(kind==="team"?"#teamReportSelection":"#reportSelection")+" [data-report-title]",oldTitle=kind+" 原报告名称",newTitle=kind+" 改来源后的名称";
        await page.evaluate(family=>App.openReportSetup(family,{edit:true,step:4}),family);if(kind==="single")assert.equal(await page.locator("#reportSelection [data-profile]").count(),0);await page.locator(titleSelector).fill(oldTitle);await page.locator(titleSelector).blur();assert.equal(await page.evaluate(()=>App.reportWorkflowNext()),true);assert.equal(await page.evaluate(()=>App.saveNow()),true);
        const before=await page.evaluate(current),recordsBefore=await page.evaluate(()=>Promise.all(App.getLibrary().athletes.flatMap(a=>a.records.map(r=>App.getRepository().loadRecord(r.recordId)))));
        const prepare=async()=>{
          await page.evaluate(family=>App.openReportSetup(family,{edit:true,step:3}),family);
          if(kind==="team")await page.locator('[data-team-record="title-a"]').selectOption("title-a-late");
          else{
            if(kind==="longitudinal")await page.locator('[data-select-record="title-a-middle"]').uncheck();
            await page.locator('[data-select-record="title-a-late"]').check();
          }
          assert.equal(await page.evaluate(()=>App.reportWorkflowNext()),true);
          await page.locator(titleSelector).fill(newTitle);await page.locator(titleSelector).blur();
        };
        await prepare();
        await page.evaluate(newTitle=>{
          const repository=App.getRepository(),originals={};window.__titleRejected=0;
          const requested=value=>!!value&&typeof value==="object"&&(value.views?.reportTitle===newTitle||Object.values(value).some(requested));
          for(const name of["saveTeamReport","saveHorizontalReport","saveRecords","save"]){if(typeof repository[name]!=="function")continue;const original=repository[name].bind(repository);originals[name]=original;repository[name]=async(...args)=>{if(args.some(requested)){window.__titleRejected++;throw Error("synthetic report title transaction failure");}return original(...args);};}
          window.__restoreTitleWrites=()=>Object.assign(repository,originals);
        },newTitle);
        assert.equal(await page.evaluate(()=>App.reportWorkflowNext()),false);assert.ok(await page.evaluate(()=>window.__titleRejected>0),"The rejected write must contain the requested report title");
        assert.deepEqual(await page.evaluate(current),before,"A failed source/title transaction changed the active report");assert.deepEqual(await page.evaluate(()=>Promise.all(App.getLibrary().athletes.flatMap(a=>a.records.map(r=>App.getRepository().loadRecord(r.recordId))))),recordsBefore,"A failed report transaction changed source records");
        assert.equal(await page.evaluate(()=>App.getReportSetup().busy),false);assert.equal(await page.locator(titleSelector).inputValue(),newTitle);
        await page.evaluate(()=>App.cancelReportSetup());assert.deepEqual(await page.evaluate(current),before,"Cancel did not return to the original report");await page.evaluate(()=>window.__restoreTitleWrites());
        await prepare();assert.equal(await page.evaluate(()=>App.reportWorkflowNext()),true);assert.equal(await page.evaluate(()=>App.saveNow()),true);const after=await page.evaluate(current);assert.equal(after.kind,kind);assert.equal(after.title,newTitle);assert.equal(after.display,newTitle);
        if(kind==="team"||kind==="horizontal"){assert.equal(after.id,before.id);assert.deepEqual(after.narrative,before.narrative);assert.notEqual(after.basis,before.basis);}
        else if(kind==="longitudinal"){assert.notEqual(after.id,before.id);assert.equal(after.identity,before.identity);assert.equal(after.created,before.created);assert.deepEqual(after.narrative,before.narrative);assert.deepEqual(await page.evaluate(()=>App.getLongitudinalDocument().recordIds),["title-a-early","title-a-late"]);assert.equal(await page.evaluate(()=>App.getLibrary().longitudinalReports.length),1);}
        else assert.equal(after.recordId,"title-a-late");
        const recordsAfter=await page.evaluate(()=>Promise.all(App.getLibrary().athletes.flatMap(a=>a.records.map(r=>App.getRepository().loadRecord(r.recordId))))),expected=structuredClone(recordsBefore);
        if(kind==="single"){const index=expected.findIndex(r=>r.recordId==="title-a-late");expected[index].views.reportTitle=newTitle;expected[index].updated=recordsAfter[index].updated;}
        assert.deepEqual(recordsAfter,expected,"Report title changed a source name, measurement or narrative");
        await page.reload();await page.waitForFunction(()=>window.App?.ready);const reopened=await page.evaluate(current);assert.equal(reopened.id,after.id);assert.equal(reopened.identity,after.identity);assert.deepEqual(reopened.narrative,after.narrative);assert.equal(reopened.title,newTitle);assert.equal(reopened.display,newTitle);
        entry.pass=true;receipt.checks.push(kind+" source and report name save atomically, cancellation preserves the owner and retry survives reload");console.log("PASS "+receipt.checks.at(-1));
      }catch(error){entry.failure=error.stack||String(error);console.error(entry.failure);await page.screenshot({path:path.join(out,kind+"-failure.png"),fullPage:true}).catch(()=>{});}finally{await context.close();}
    }
    assert.equal(receipt.cases.every(entry=>entry.pass),true,"Some report title transactions failed");assert.deepEqual(receipt.errors,[]);receipt.sourceUnchanged=hash(source)===receipt.sourceHash&&hash(isolated)===receipt.sourceHash&&hash(__filename)===receipt.runnerSha256;assert.equal(receipt.sourceUnchanged,true);receipt.pass=true;
  }finally{fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(receipt,null,2));await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
