"use strict";
// Diagnostic reproductions, not repaired-behavior acceptance tests. All browser
// profiles, IndexedDB databases, records and exported files are synthetic.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), {createHash} = require("node:crypto");
const {execFileSync} = require("node:child_process"), {pathToFileURL} = require("node:url");
const {chromium} = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname,"..");
function option(name,fallback) {
  const inline = process.argv.find(arg=>arg.startsWith(name+"="));
  if (inline) return inline.slice(name.length+1);
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index+1] || process.argv[index+1].startsWith("--")) throw Error(name+" requires a value");
  return process.argv[index+1];
}
const source = path.resolve(root,option("--source","MotionBench.html"));
const out = path.resolve(root,option("--artifact-dir","output/playwright/storage-repros-v2.17.2"));
const relativeOutput = path.relative(path.join(root,"output/playwright/storage-repros-v2.17.2"),out);
if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) throw Error("Artifacts must stay in output/playwright/storage-repros-v2.17.2");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const hash = data => createHash("sha256").update(data).digest("hex");
const sourceSha256 = hash(fs.readFileSync(source));
const expectedSourceHash = option("--expect-sha",sourceSha256);
assert.equal(sourceSha256,expectedSourceHash,"Unexpected source HTML; do not combine evidence from different builds");
fs.mkdirSync(out,{recursive:true});
const result = {channel,synthetic:true,source:path.relative(root,source).replaceAll("\\","/"),sourceSha256,
  packageVersionAtRun:JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version,
  gitHeadAtRun:execFileSync("git",["--no-optional-locks","rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),
  runnerSha256:hash(fs.readFileSync(__filename)),startedAt:new Date().toISOString(),checks:[],errors:[],network:[],artifacts:[],
  productFixed:false,reproductionSuccess:false};

// Installed only in disposable test pages; no production code is altered.
function installFixtures() {
  window.reproLibrary = label => {
    const record = RingsideModel.sampleRecord();
    record.demo=false;record.recordId="record-"+label;record.athleteId="athlete-"+label;
    record.athlete.name="Synthetic storage "+label;record.athlete.notes="initial-"+label;
    return RingsideEvaluation.migrate(RingsideModel.recordEnvelope(record));
  };
  window.reproView = async(repo=window.reproRepo,generation) => {
    const active=(await repo.meta("active"))?.value||"", previous=(await repo.meta("previous"))?.value||"";
    const selected=generation===undefined?active:generation;
    const athletes=selected?await repo.values("athletes",selected):[], records=selected?await repo.values("records",selected):[];
    const profiles=selected?await repo.values("profiles",selected):[];
    return {instanceGeneration:repo.generation,active,previous,selected,
      athleteIds:athletes.map(a=>a.id).sort(),recordIds:records.map(r=>r.recordId).sort(),profileIds:profiles.map(p=>p.id).sort(),
      counts:{athletes:athletes.length,records:records.length,profiles:profiles.length},
      recordNotes:Object.fromEntries(records.map(r=>[r.recordId,r.athlete.notes])),records};
  };
  window.reproAddAthlete = async label => {
    const lib=await reproRepo.directory(), record=structuredClone(await reproRepo.loadRecord(lib.athletes[0].records[0].recordId));
    record.recordId="record-"+label;record.athleteId="athlete-"+label;record.athlete.name="Synthetic storage "+label;
    record.athlete.notes="committed-"+label;
    const owner=structuredClone(lib.athletes[0]);owner.id=record.athleteId;owner.name=record.athlete.name;owner.records=[record];
    lib.athletes.push(owner);await reproRepo.save(lib,[record]);return {athleteId:owner.id,recordId:record.recordId};
  };
}
function evidenceView(view) {
  const {records,...metadata}=view;
  return {...metadata,recordsSha256:hash(JSON.stringify(records))};
}
function writeArtifact(name,text) {
  const file=path.join(out,channel+"-"+name);fs.writeFileSync(file,text,"utf8");
  result.artifacts.push({path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(fs.readFileSync(file)),bytes:fs.statSync(file).size});
}

(async()=>{
  const browser=await chromium.launch({channel,headless:true});
  async function environment(label) {
    const context=await browser.newContext({offline:true,viewport:{width:1280,height:900}});
    const a=await context.newPage(), b=await context.newPage();
    for(const page of [a,b]) {
      page.setDefaultTimeout(20000);
      page.on("pageerror",error=>result.errors.push({scenario:label,message:error.message}));
      page.on("request",request=>{if(/^https?:/.test(request.url()))result.network.push(request.url());});
      page.on("dialog",dialog=>dialog.accept());
      await page.goto(pathToFileURL(source).href);await page.waitForFunction(()=>!!window.App?.ready);
      assert.equal(await page.evaluate(()=>App.ready),true);await page.evaluate(()=>App.getRepository().flush());
      await page.evaluate(installFixtures);
    }
    const identity=await a.evaluate(()=>window.RingsideBuild?.version||null);
    if(result.buildProducerVersion===undefined)result.buildProducerVersion=identity;
    assert.equal(identity,result.buildProducerVersion);
    const database="/synthetic-storage-concurrency-"+channel+"-"+label;
    await a.evaluate(async database=>{window.reproRepo=await RingsideStore.Repository.open(database);await reproRepo.importLibrary(reproLibrary("base"));},database);
    await b.evaluate(async database=>{window.reproRepo=await RingsideStore.Repository.open(database);},database);
    const before=await a.evaluate(()=>reproView());
    return {a,b,context,database,before};
  }
  async function check(name,kind,run) {
    const env=await environment(name);
    try {
      const details=await run(env);
      result.checks.push({name,kind,status:kind==="control"?"control-passed":"known-unfixed-defect-reproduced",
        expectedDefectReproduced:kind==="reproduction",before:evidenceView(env.before),...details});
      console.log(kind==="control"?"CONTROL PASS":"DEFECT REPRODUCED",name);
    } finally {await env.context.close();}
  }
  async function importBackup(page,text,label) {
    return page.evaluate(async({text,label})=>{
      const target=await RingsideStore.Repository.open("/synthetic-backup-target-"+label);
      const before=target.generation;let accepted=false,error="";
      try{await target.importRows(RingsideStore.fileRows(new Blob([text],{type:"application/x-ndjson"})));accepted=true;}
      catch(e){error=e.message;}
      const after=await reproView(target);target.close();return {accepted,error,generationBefore:before,after};
    },{text,label:channel+"-"+label});
  }
  try {
    await check("normal-backup-roundtrip","control",async({a,before})=>{
      const text=await a.evaluate(async()=>await(await reproRepo.backupBlob()).text());
      const imported=await importBackup(a,text,"normal");assert.equal(imported.accepted,true);
      assert.deepEqual(imported.after.records,before.records);assert.deepEqual(imported.after.athleteIds,before.athleteIds);
      writeArtifact("normal.motionbench.jsonl",text);
      return {importAccepted:true,after:evidenceView(imported.after)};
    });
    await check("normal-merge-and-reversible-restore","control",async({a,before})=>{
      const merged=await a.evaluate(async()=>{await reproRepo.importLibrary(reproLibrary("incoming"),{merge:true});return reproView();});
      assert.deepEqual(merged.recordIds,["record-base","record-incoming"]);
      const restored=await a.evaluate(async()=>{await reproRepo.restorePrevious();return reproView();});
      assert.equal(restored.active,before.active);assert.equal(restored.previous,merged.active);assert.deepEqual(restored.records,before.records);
      const returned=await a.evaluate(async()=>{await reproRepo.restorePrevious();return reproView();});
      assert.equal(returned.active,merged.active);assert.equal(returned.previous,before.active);assert.deepEqual(returned.records,merged.records);
      return {merged:evidenceView(merged),restored:evidenceView(restored),returned:evidenceView(returned)};
    });
    await check("stale-save-is-guarded","control",async({a,b})=>{
      const changed=await b.evaluate(async()=>{await reproRepo.importLibrary(reproLibrary("new-active"));return reproView();});
      const attempt=await a.evaluate(async()=>{let error="";try{const lib=await reproRepo.directory();await reproRepo.save(lib);}catch(e){error=e.message;}return {error,after:await reproView()};});
      assert.ok(attempt.error.includes("资料库"));assert.equal(attempt.after.active,changed.active);
      assert.equal(attempt.after.previous,changed.previous);assert.deepEqual(attempt.after.records,changed.records);
      return {guardObserved:true,error:attempt.error,currentBeforeAttempt:evidenceView(changed),after:evidenceView(attempt.after)};
    });
    await check("backup-after-athletes-concurrent-new-owner","reproduction",async({a,b,before})=>{
      await a.evaluate(()=>{
        const original=reproRepo.batches.bind(reproRepo);window.reproAthletesRead=[];window.reproBarrierReached=false;
        reproRepo.batches=async function*(table,generation,size){
          if(table==="records"){window.reproBarrierReached=true;await new Promise(resolve=>window.releaseReproBarrier=resolve);}
          for await(const batch of original(table,generation,size)) {if(table==="athletes")reproAthletesRead.push(...batch.map(row=>row.id));yield batch;}
        };
        window.reproTask=reproRepo.backupBlob().then(blob=>blob.text());
      });
      await a.waitForFunction(()=>window.reproBarrierReached);
      const alreadyRead=await a.evaluate(()=>reproAthletesRead);assert.deepEqual(alreadyRead.sort(),before.athleteIds);
      const added=await b.evaluate(()=>reproAddAthlete("during-backup"));
      const committed=await b.evaluate(()=>reproView());assert.equal(committed.active,before.active);assert.equal(committed.counts.records,2);
      await a.evaluate(()=>releaseReproBarrier());const text=await a.evaluate(()=>reproTask);
      const rows=text.trim().split(/\r?\n/).map(JSON.parse), athletes=rows.filter(row=>row.type==="athlete").map(row=>row.value.id);
      const records=rows.filter(row=>row.type==="record").map(row=>row.value);
      const missingOwners=records.filter(record=>!athletes.includes(record.athleteId)).map(record=>({recordId:record.recordId,athleteId:record.athleteId}));
      assert.deepEqual(missingOwners,[added]);assert.equal(rows.at(-1).counts.record,2);assert.equal(rows.at(-1).counts.athlete,1);
      const imported=await importBackup(a,text,"racy");assert.equal(imported.accepted,false);
      assert.ok(imported.error.includes("运动员或评价方案不存在"));assert.equal(imported.after.active,imported.generationBefore);
      writeArtifact("inconsistent-backup.motionbench.jsonl",text);
      return {athletesReadBeforeConcurrentCommit:alreadyRead,concurrentCommit:evidenceView(committed),backupCounts:rows.at(-1).counts,
        missingOwners,backupImportAccepted:false,importError:imported.error,importTargetAfter:evidenceView(imported.after),guardObserved:false};
    });
    await check("stale-restore-collapses-active-previous","reproduction",async({a,b,before})=>{
      const current=await b.evaluate(async()=>{await reproRepo.importLibrary(reproLibrary("new-active"));return reproView();});
      assert.equal(current.previous,before.active);assert.notEqual(current.active,before.active);
      const attempt=await a.evaluate(async()=>{let error="";try{await reproRepo.restorePrevious();}catch(e){error=e.message;}return {error,after:await reproView()};});
      assert.equal(attempt.error,"");assert.equal(attempt.after.active,before.active);assert.equal(attempt.after.previous,before.active);
      const stranded=await a.evaluate(generation=>reproView(reproRepo,generation),current.active);
      assert.deepEqual(stranded.records,current.records);
      return {currentBeforeAttempt:evidenceView(current),after:evidenceView(attempt.after),formerActiveStillStored:evidenceView(stranded),guardObserved:false,
        implication:"Former active generation remains stored, but active and previous pointers both select the stale generation."};
    });
    await check("stale-import-replaces-newer-active","reproduction",async({a,b,before})=>{
      const current=await b.evaluate(async()=>{await reproRepo.importLibrary(reproLibrary("new-active"));return reproView();});
      const attempt=await a.evaluate(async()=>{let error="";try{await reproRepo.importLibrary(reproLibrary("incoming"),{merge:true});}catch(e){error=e.message;}return {error,after:await reproView()};});
      assert.equal(attempt.error,"");assert.equal(attempt.after.previous,before.active);assert.notEqual(attempt.after.active,current.active);
      assert.deepEqual(attempt.after.recordIds,["record-base","record-incoming"]);assert.ok(!attempt.after.recordIds.includes("record-new-active"));
      const stranded=await a.evaluate(generation=>reproView(reproRepo,generation),current.active);
      assert.deepEqual(stranded.records,current.records);
      return {currentBeforeAttempt:evidenceView(current),after:evidenceView(attempt.after),newerGenerationStillStored:evidenceView(stranded),guardObserved:false,
        lostFromActiveRecordIds:current.recordIds.filter(id=>!attempt.after.recordIds.includes(id))};
    });
    await check("same-generation-save-lost-from-merged-active","reproduction",async({a,b,before})=>{
      await a.evaluate(()=>{
        const incoming=reproLibrary("incoming");window.reproBarrierReached=false;
        async function*blockedIncoming(){window.reproBarrierReached=true;await new Promise(resolve=>window.releaseReproBarrier=resolve);yield*RingsideStore.libraryRows(incoming);}
        window.reproTask=reproRepo.importRows(blockedIncoming(),{merge:true}).then(value=>({ok:true,value}),error=>({ok:false,error:error.message}));
      });
      await a.waitForFunction(()=>window.reproBarrierReached);
      const committed=await b.evaluate(async()=>{
        const lib=await reproRepo.directory(), record=await reproRepo.loadRecord("record-base"), baseline=JSON.stringify(record);
        record.athlete.notes="B-committed-during-merge";
        await reproRepo.save(lib,[record],{},{expectedRecords:{"record-base":baseline}});return reproView();
      });
      assert.equal(committed.active,before.active);assert.equal(committed.recordNotes["record-base"],"B-committed-during-merge");
      await a.evaluate(()=>releaseReproBarrier());const attempt=await a.evaluate(()=>reproTask);assert.equal(attempt.ok,true);
      const after=await a.evaluate(()=>reproView()), previous=await a.evaluate(generation=>reproView(reproRepo,generation),before.active);
      assert.equal(after.recordNotes["record-base"],before.recordNotes["record-base"]);
      assert.notEqual(after.recordNotes["record-base"],committed.recordNotes["record-base"]);assert.equal(after.previous,before.active);
      assert.equal(previous.recordNotes["record-base"],"B-committed-during-merge");assert.deepEqual(after.recordIds,["record-base","record-incoming"]);
      return {concurrentCommit:evidenceView(committed),after:evidenceView(after),previousStillContainsConcurrentCommit:evidenceView(previous),
        guardObserved:false,activeGenerationWasUnchangedDuringConcurrentSave:true,
        implication:"Checking active generation alone cannot detect a same-generation save made after merge seeding."};
    });
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);
    result.controlCount=result.checks.filter(check=>check.kind==="control").length;
    result.reproducedDefectCount=result.checks.filter(check=>check.kind==="reproduction").length;
    assert.equal(result.controlCount,3);assert.equal(result.reproducedDefectCount,4);
    result.reproductionSuccess=true;
  } catch(error) {result.failure=error.stack;process.exitCode=1;console.error(error.stack);}
  finally {
    result.sourceUnchanged=hash(fs.readFileSync(source))===sourceSha256;
    if(!result.sourceUnchanged){result.reproductionSuccess=false;process.exitCode=1;}
    result.finishedAt=new Date().toISOString();await browser.close();
    fs.writeFileSync(path.join(out,channel+"-results.json"),JSON.stringify(result,null,2)+"\n");
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
