"use strict";
// Business snapshots and copied profiles remain in the private rollback directory.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {_electron}=require("../tests/helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),installed="D:\\Application\\Strength&Conditioning\\MotionBench",oldCheckpoint="D:\\Application\\Strength&Conditioning\\MotionBench-backups\\20261013-before-2.23.0";
const privateRoot="D:\\Application\\Strength&Conditioning\\MotionBench-backups\\20261013-before-2.23.1",mode=process.argv[2];
assert.ok(["before","candidate","installed","reopened"].includes(mode));
fs.mkdirSync(privateRoot,{recursive:true});
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex"),fileHash=file=>hash(fs.readFileSync(file));
const canonical=value=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?"["+value.map(canonical).join(",")+"]":"{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}";
const baselineFile=path.join(privateRoot,"current-business.json"),savedData=path.join(privateRoot,"userdata"),actualData=path.join(process.env.APPDATA,"MotionBench Desktop");
function copyTree(source,target,entries=[],relative=""){
  fs.mkdirSync(target,{recursive:true});
  for(const item of fs.readdirSync(source,{withFileTypes:true})){
    const from=path.join(source,item.name),to=path.join(target,item.name),rel=path.join(relative,item.name);
    if(item.isDirectory())copyTree(from,to,entries,rel);
    else if(item.isFile()){const bytes=fs.readFileSync(from);fs.writeFileSync(to,bytes);assert.equal(fileHash(to),hash(bytes));entries.push({relative:rel,length:bytes.length,sha256:hash(bytes)});}
  }
  return entries;
}
function verifyPreserved(before,after){
  const counts={athletes:0,records:0,profiles:0,groups:0,projects:0,metrics:0,reportBodies:0};
  for(const [key,countKey]of [["evaluationProfiles","profiles"],["groups","groups"],["testPlans",null]])for(const item of before[key]||[]){assert.equal(canonical(after[key]?.find(row=>row.id===item.id)),canonical(item),"Existing "+key+" changed");if(countKey)counts[countKey]++;}
  for(const athlete of before.athletes){
    const next=after.athletes.find(a=>a.id===athlete.id),metadata=a=>Object.fromEntries(Object.entries(a).filter(([key])=>key!=="records"));
    assert.ok(next);assert.equal(canonical(metadata(next)),canonical(metadata(athlete)),"Athlete metadata changed");counts.athletes++;
    assert.equal(next.records.length,athlete.records.length,"Record count changed");
    for(const record of athlete.records){assert.equal(canonical(next.records.find(r=>r.recordId===record.recordId)),canonical(record),"Raw record or its narrative changed");counts.records++;}
  }
  assert.equal(after.athletes.length,before.athletes.length,"Unrequested athletes added");
  for(const [key,countKey]of[["tests","projects"],["definitions","metrics"]])for(const item of before.catalog[key]){assert.equal(canonical(after.catalog[key].find(row=>row.id===item.id)),canonical(item),"Catalog changed");counts[countKey]++;}
  assert.equal(canonical(after.catalog.reportViews),canonical(before.catalog.reportViews),"Single-report preferences changed");
  assert.equal(after.defaultEvaluationProfileId,before.defaultEvaluationProfileId,"Default evaluation scheme changed");
  for(const doc of before.comparisonReports||[]){
    const next=after.comparisonReports?.find(row=>row.id===doc.id);assert.ok(next,"Saved report disappeared");
    for(const key of["text","html"])assert.equal(next.narrative?.[key],doc.narrative?.[key],"Existing manual report body changed");
    assert.equal(canonical(next.revisions),canonical(doc.revisions),"Saved report revisions changed");
    if(doc.selection.athleteIds.length!==1)assert.equal(canonical(next),canonical(doc),"Legacy team report backup changed");
    counts.reportBodies++;
  }
  return counts;
}
(async()=>{
  if(mode==="before"){
    assert.ok(!fs.existsSync(baselineFile),"Current private baseline already exists");
    const entries=copyTree(actualData,savedData);
    fs.writeFileSync(path.join(privateRoot,"userdata-manifest.json"),JSON.stringify({complete:true,sourceVersion:"2.23.0-desktop.1",files:entries},null,2));
    for(const name of["ai-settings.dat","desktop-preferences.json"]){const file=path.join(actualData,name);if(fs.existsSync(file))assert.equal(fileHash(file),fileHash(path.join(savedData,name)));}
  }
  const actual=["installed","reopened"].includes(mode),profile=actual?actualData:path.join(privateRoot,mode+"-profile-"+crypto.randomUUID());
  if(!actual)copyTree(savedData,profile);
  const executable=mode==="candidate"?path.join(root,"dist-desktop/win-unpacked/MotionBench.exe"):path.join(installed,"MotionBench.exe");
  const evidence={mode,actualData:actual,testArguments:mode!=="reopened",runnerSha256:fileHash(__filename),pass:false,checks:[],executableSha256:fileHash(executable),archiveSha256:fileHash(path.join(path.dirname(executable),"resources/app.asar"))};
  let app;
  try{
    const env={...process.env,MOTIONBENCH_TEST_EXPORT_DIR:path.join(privateRoot,"exports")};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:executable,args:mode==="reopened"?[]:["--motionbench-data-dir="+profile,"--motionbench-test"],env,timeout:120000});
    assert.equal(await app.evaluate(({app})=>app.getPath("userData")),profile);evidence.version=await app.evaluate(({app})=>app.getVersion());
    const page=await app.firstWindow();await page.waitForFunction(()=>window.App?.ready,{},{timeout:120000});assert.equal(await page.evaluate(()=>App.ready),true);
    const before=await page.evaluate(()=>App.getRepository().exportLibrary());
    evidence.libraryDigest=hash(Buffer.from(canonical(before)));
    if(mode==="before"){
      assert.equal(evidence.version,"2.23.0-desktop.1");
      const original=JSON.parse(fs.readFileSync(path.join(oldCheckpoint,"verification/original-business.json")));
      // Original verification accepts additional synthetic people; current preservation is exact.
      for(const athlete of original.athletes){const row=before.athletes.find(a=>a.id===athlete.id);assert.equal(canonical(row),canonical(athlete));}
      for(const item of original.evaluationProfiles)assert.equal(canonical(before.evaluationProfiles.find(p=>p.id===item.id)),canonical(item));
      fs.writeFileSync(baselineFile,JSON.stringify(before));evidence.baselineSha256=fileHash(baselineFile);
      evidence.counts={athletes:before.athletes.length,records:before.athletes.flatMap(a=>a.records).length,profiles:before.evaluationProfiles.length,reportBodies:before.comparisonReports?.length||0};
      assert.equal(evidence.counts.athletes,26);assert.equal(evidence.counts.records,146);
      evidence.checks.push("Full current library and userdata privately backed up; original business entities unchanged");
    }else{
      assert.equal(evidence.version,"2.23.1-desktop.1");
      const baseline=JSON.parse(fs.readFileSync(baselineFile));evidence.baselineSha256=fileHash(baselineFile);evidence.preservation=verifyPreserved(baseline,before);
      evidence.checks.push("Every current athlete raw record scheme group catalog setting and manual body preserved");
      assert.deepEqual(await page.evaluate(()=>({all:typeof App.selectAllReportAthletes,multi:typeof App.toggleReportAthlete})),{all:"undefined",multi:"undefined"});
      const oldTeam=baseline.comparisonReports.find(doc=>doc.selection.athleteIds.length>1);assert.ok(oldTeam);
      if(mode==="candidate")assert.equal(await page.evaluate(()=>App.getComparison()?.kind||null),null,"Legacy team cache restored as active report");
      if(mode!=="reopened"){
        assert.equal(await page.evaluate(selection=>App.selectComparison(selection),oldTeam.selection),false);
        const personal=baseline.comparisonReports.find(doc=>doc.selection.athleteIds.length===1&&doc.selection.dates.length===6);assert.ok(personal);
        assert.equal(await page.evaluate(selection=>App.selectComparison(selection),personal.selection),true);
      }
      const report=await page.evaluate(()=>({ready:App.getComparison()?.ready,kind:App.getComparison()?.kind,people:App.getComparison()?.athletes.length,dates:App.getComparison()?.dates.length}));
      assert.deepEqual(report,{ready:true,kind:"personal-longitudinal",people:1,dates:6});evidence.personalReport=report;
      assert.equal(await page.locator('#bodyChart .comparison-screening-chart svg[viewBox]').count(),1);
      assert.equal(await page.locator('#bodyChart [data-body-region]').count(),0);
      const overview=page.locator('.card').filter({has:page.locator('h3',{hasText:'运动表现概览'})});assert.doesNotMatch(await overview.innerText(),/训练方向|判断依据|分组/);
      evidence.checks.push("Personal six-date report has one risk radar and capability-only performance overview; team inputs rejected");
      assert.equal(await page.evaluate(()=>App.saveNow()),true);
      const after=await page.evaluate(()=>App.getRepository().exportLibrary());evidence.preservationAfterSave=verifyPreserved(baseline,after);
      for(const name of["ai-settings.dat","desktop-preferences.json"]){const saved=path.join(savedData,name),current=path.join(actualData,name);assert.equal(fs.existsSync(saved),fs.existsSync(current));if(fs.existsSync(saved))assert.equal(fileHash(saved),fileHash(current));}
      evidence.checks.push(mode==="reopened"?"Normal restart without test flags restores personal selection with all current data":"Personal selection saved without changing any raw data or existing manual body");
    }
    assert.equal((await page.evaluate(()=>App.prepareDesktopClose({discardSettings:true}))).ok,true);evidence.checks.push("Native save and close barrier succeeds");evidence.pass=true;
  }finally{
    if(app)await app.close();fs.writeFileSync(path.join(privateRoot,mode+"-verification.json"),JSON.stringify(evidence,null,2));
  }
  console.log(JSON.stringify({mode,pass:evidence.pass,checks:evidence.checks.length,preservation:evidence.preservation||evidence.counts,privateEvidenceDirectory:privateRoot}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
