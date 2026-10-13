"use strict";
// All business snapshots stay in the user's private rollback directory.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {_electron}=require("../tests/helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),checkpoint="D:\\Application\\Strength&Conditioning\\MotionBench-backups\\20261013-before-2.23.0";
const privateRoot=path.join(checkpoint,"verification"),mode=process.argv[2]||"baseline";
if(!["baseline","candidate","installed","reopened"].includes(mode))throw Error("Unknown private verification mode");
fs.mkdirSync(privateRoot,{recursive:true});
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const canonical=value=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?"["+value.map(canonical).join(",")+"]":"{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}";
const baselineFile=path.join(privateRoot,"original-business.json");
function streamCopy(source,target){fs.mkdirSync(target,{recursive:true});for(const item of fs.readdirSync(source,{withFileTypes:true})){const from=path.join(source,item.name),to=path.join(target,item.name);if(item.isDirectory())streamCopy(from,to);else if(item.isFile())fs.writeFileSync(to,fs.readFileSync(from));}}
function verifyExisting(before,after){
  const checks={athletes:0,records:0,profiles:0,groups:0,projects:0,metrics:0};
  for(const kind of["evaluationProfiles","groups"]){for(const item of before[kind]){const next=after[kind].find(value=>value.id===item.id);assert.equal(canonical(next),canonical(item),"Existing "+kind+" changed");checks[kind==="groups"?"groups":"profiles"]++;}}
  for(const athlete of before.athletes){const current=after.athletes.find(value=>value.id===athlete.id);assert.ok(current,"Existing athlete missing");const metadata=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=="records"));assert.equal(canonical(metadata(current)),canonical(metadata(athlete)),"Existing athlete metadata changed");checks.athletes++;for(const record of athlete.records){assert.equal(canonical(current.records.find(value=>value.recordId===record.recordId)),canonical(record),"Existing measurement record changed");checks.records++;}}
  for(const key of["tests","definitions"]){for(const item of before.catalog[key]){assert.equal(canonical(after.catalog[key].find(value=>value.id===item.id)),canonical(item),"Existing catalog definition changed");checks[key==="tests"?"projects":"metrics"]++;}}
  for(const [id,value]of Object.entries(before.catalog.reportViews||{}))assert.equal(canonical(after.catalog.reportViews?.[id]),canonical(value),"Existing chart setting changed");
  for(const plan of before.testPlans||[])assert.equal(canonical(after.testPlans.find(value=>value.id===plan.id)),canonical(plan),"Existing test plan changed");
  assert.equal(after.defaultEvaluationProfileId,before.defaultEvaluationProfileId,"Default evaluation scheme changed");
  return checks;
}
(async()=>{
  const actualData=["installed","reopened"].includes(mode);
  const profile=actualData?path.join(process.env.APPDATA,"MotionBench Desktop"):path.join(privateRoot,mode+"-profile-"+crypto.randomUUID());
  if(!actualData)streamCopy(path.join(checkpoint,"userdata"),profile);
  const executable=mode==="baseline"?path.join(checkpoint,"program","MotionBench.exe"):mode==="candidate"?path.join(root,"dist-desktop/win-unpacked/MotionBench.exe"):"D:\\Application\\Strength&Conditioning\\MotionBench\\MotionBench.exe";
  const env={...process.env,MOTIONBENCH_TEST_EXPORT_DIR:path.join(privateRoot,"exports")};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const evidence={mode,actualData,testArguments:mode!=="reopened",runnerSha256:hash(fs.readFileSync(__filename)),pass:false,checks:[],executableSha256:hash(fs.readFileSync(executable)),archiveSha256:hash(fs.readFileSync(path.join(path.dirname(executable),"resources/app.asar")))};
  try{
    app=await _electron.launch({executablePath:executable,args:mode==="reopened"?[]:["--motionbench-data-dir="+profile,"--motionbench-test"],env,timeout:120000});
    assert.equal(await app.evaluate(({app})=>app.getPath("userData")),profile,"Unexpected native data directory");
    evidence.version=await app.evaluate(({app})=>app.getVersion());
    const page=await app.firstWindow();await page.waitForFunction(()=>window.App?.ready,{},{timeout:120000});assert.equal(await page.evaluate(()=>App.ready),true);
    const before=await page.evaluate(()=>App.getRepository().exportLibrary());
    evidence.libraryDigest=hash(Buffer.from(canonical(before)));
    if(mode==="baseline"){
      assert.ok(!fs.existsSync(baselineFile),"Original business snapshot already exists");fs.writeFileSync(baselineFile,JSON.stringify(before));
      evidence.originalCounts={athletes:before.athletes.length,records:before.athletes.reduce((n,a)=>n+a.records.length,0),profiles:before.evaluationProfiles.length};
      evidence.originalBusinessSha256=hash(Buffer.from(canonical(before)));evidence.checks.push("Verified original private baseline captured on copied user profile");
    }else{
      const baseline=JSON.parse(fs.readFileSync(baselineFile));evidence.preservation=verifyExisting(baseline,before);evidence.checks.push("All original raw records profiles groups catalog and chart settings preserved");
      evidence.baselineSha256=hash(fs.readFileSync(baselineFile));
      if(mode==="reopened"){
        const demo=JSON.parse(fs.readFileSync(path.join(root,"output/comparison-demo/团队与纵向模拟资料库.json"))),ids=new Set(demo.athletes.map(a=>a.id));
        assert.equal(before.athletes.filter(a=>ids.has(a.id)).length,24);
        assert.equal(before.athletes.filter(a=>ids.has(a.id)).flatMap(a=>a.records).length,144);
        assert.ok(before.groups.some(g=>g.id===demo.groups[0].id));
        for(const doc of demo.comparisonReports)assert.ok(before.comparisonReports.some(d=>d.id===doc.id));
        const current=await page.evaluate(()=>({kind:App.getComparison()?.kind,n:App.getComparison()?.athletes.length,ready:App.getComparison()?.ready}));
        assert.equal(current.kind,"team");assert.equal(current.n,24);assert.equal(current.ready,true);
        evidence.syntheticReport=current;evidence.checks.push("Normal reopen without test arguments retains 24 athletes 144 records and all three preset reports");
      }
      if(mode==="candidate"||process.argv.includes("--insert-demo")){
        const demo=JSON.parse(fs.readFileSync(path.join(root,"output/comparison-demo/团队与纵向模拟资料库.json")));
        await page.evaluate(async value=>{await App.importPayload(value,"merge");},demo);
        const after=await page.evaluate(()=>App.getRepository().exportLibrary());evidence.preservationAfterDemo=verifyExisting(baseline,after);
        const ids=new Set(demo.athletes.map(value=>value.id));assert.equal(after.athletes.filter(a=>ids.has(a.id)).length,24);
        assert.equal(after.athletes.filter(a=>ids.has(a.id)).reduce((n,a)=>n+a.records.length,0),144);
        evidence.checks.push("24 synthetic athletes and 144 records inserted while retaining every original entity");
        if(mode==="candidate"){
          await page.evaluate(async value=>{await App.importPayload(value,"merge");},demo);
          const repeated=await page.evaluate(()=>App.getRepository().exportLibrary());
          assert.equal(repeated.athletes.filter(a=>ids.has(a.id)).reduce((n,a)=>n+a.records.length,0),144);verifyExisting(baseline,repeated);
          evidence.checks.push("Synthetic insertion is idempotent on a copied original library");
        }
        const report=demo.comparisonReports.find(value=>value.selection.dates.length===1&&value.selection.athleteIds.length>1);
        assert.equal(await page.evaluate(value=>App.selectComparison(value),report.selection),true);
        const view=await page.evaluate(()=>({ready:App.getComparison().ready,kind:App.getComparison().kind,n:App.getComparison().athletes.length,metrics:App.getComparison().metrics.length}));
        assert.equal(view.ready,true);assert.equal(view.n,24);assert.equal(view.kind,"team");evidence.syntheticReport=view;
        assert.equal(await page.evaluate(()=>App.saveNow()),true);evidence.checks.push("Actual native team report opens with all 24 synthetic athletes");
      }
    }
    assert.equal((await page.evaluate(()=>App.prepareDesktopClose({discardSettings:true}))).ok,true);evidence.checks.push("Native save and close barrier succeeds");evidence.pass=true;
  }finally{
    if(app)await app.close();fs.writeFileSync(path.join(privateRoot,mode+"-verification.json"),JSON.stringify(evidence,null,2));
  }
  console.log(JSON.stringify({mode,pass:evidence.pass,checks:evidence.checks.length,preservation:evidence.preservation||evidence.originalCounts,privateEvidenceDirectory:privateRoot}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
