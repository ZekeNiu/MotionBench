"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),vm=require("node:vm"),crypto=require("node:crypto");
const {execFileSync}=require("node:child_process"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),source=path.join(root,"MotionBench.html"),channel=process.argv.includes("--edge")?"msedge":"chrome";
const out=path.join(root,"output/playwright/v2.19.0/storage");fs.mkdirSync(out,{recursive:true});
const hash=value=>crypto.createHash("sha256").update(value).digest("hex"),sourceHash=hash(fs.readFileSync(source));
const result={channel,sourceHash,runnerSha256:hash(fs.readFileSync(__filename)),synthetic:true,checks:[],errors:[],network:[]};
function legacyLibrary(){
  const c=vm.createContext({console,Intl,crypto:crypto.webcrypto});c.window=c;
  for(const name of ["calc","fvp","sprint-fvp","sprint-elasticity","cpet-reference","iso-reference","definitions","tests","model","evaluation","interventions"])
    vm.runInContext(execFileSync("git",["show","rollback-v2.18.0-local-before-management-20261011:src/ringside-"+name+".js"],{cwd:root,encoding:"utf8",maxBuffer:10*1024*1024}),c);
  const r=c.RingsideModel.sampleRecord();r.demo=false;r.athlete.name="Synthetic upgrade";r.narrative.text="保留手写解读";
  return JSON.parse(JSON.stringify(c.RingsideEvaluation.migrate(c.RingsideModel.recordEnvelope(r))));
}
(async()=>{
  const browser=await chromium.launch({channel,headless:true});
  try{
    const context=await browser.newContext({offline:true}),page=await context.newPage();
    page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});
    page.on("dialog",dialog=>dialog.accept());await page.goto(pathToFileURL(source).href);await page.waitForFunction(()=>window.App?.ready);
    const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS "+name);};
    await check("first metadata edit after import compares exact stored configuration",async()=>{
      const value=await page.evaluate(async()=>{const repo=await RingsideStore.Repository.open("/synthetic-219-first-edit");await repo.importLibrary(RingsideEvaluation.migrate(RingsideModel.libraryDefaults()));const next=await repo.directory(),expected=repo.metadataHashes.get("config:library");next.groups.push({id:"first",name:"first edit"});await repo.save(next,[],{},{expectedConfig:expected});const saved=await repo.values("groups");repo.close();return saved;});
      assert.equal(value[0].name,"first edit");
    });
    await check("management save failure leaves memory and IndexedDB unchanged",async()=>{
      const value=await page.evaluate(async()=>{
        const repo=App.getRepository(),before=JSON.stringify(App.getLibrary()),stored=JSON.stringify(await repo.directory()),save=repo.save.bind(repo);
        repo.save=()=>Promise.reject(Error("Synthetic storage failure"));let error="";
        try{await App.commitLibraryChange(candidate=>{candidate.groups.push({id:"synthetic-failed",name:"Should not commit"});});}catch(e){error=e.message;}finally{repo.save=save;}
        return{error,memory:JSON.stringify(App.getLibrary())===before,database:JSON.stringify(await repo.directory())===stored};
      });assert.match(value.error,/Synthetic|保存/);assert.equal(value.memory,true);assert.equal(value.database,true);
    });
    await check("group updates reject stale metadata without partial writes",async()=>{
      const value=await page.evaluate(async()=>{
        const R=RingsideStore.Repository,repo=await R.open("/synthetic-219-groups"),lib=RingsideEvaluation.migrate(RingsideModel.libraryDefaults());lib.groups.push({id:"team",name:"initial"});await repo.importLibrary(lib);
        const other=await R.open("/synthetic-219-groups"),stale=await other.directory(),current=await repo.directory(),expected=JSON.stringify(stale.groups[0]);current.groups[0].name="first";await repo.save(current);
        stale.groups[0].name="stale";stale.groups.push({id:"extra",name:"must roll back"});let error="";
        try{await other.save(stale,[],{},{expectedGroups:{team:expected}});}catch(e){error=e.message;}
        const groups=await repo.values("groups");repo.close();other.close();return{error,groups};
      });assert.match(value.error,/其他页面/);assert.deepEqual(value.groups,[{id:"team",name:"first"}]);
    });
    await check("transaction write failure rolls back every metadata table",async()=>{
      const value=await page.evaluate(async()=>{
        const repo=await RingsideStore.Repository.open("/synthetic-219-abort"),lib=RingsideEvaluation.migrate(RingsideModel.libraryDefaults());await repo.importLibrary(lib);const next=await repo.directory(),before=JSON.stringify(await repo.directory()),put=IDBObjectStore.prototype.put;next.groups.push({id:"team",name:"candidate"});next.evaluationProfiles[0].name="candidate";
        IDBObjectStore.prototype.put=function(...args){if(this.name==="profiles")throw Error("Synthetic quota failure");return put.apply(this,args);};let error="";
        try{await repo.save(next);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
        const unchanged=JSON.stringify(await repo.directory())===before;repo.close();return{error,unchanged};
      });assert.match(value.error,/quota/);assert.equal(value.unchanged,true);
    });
    await check("merging equal rules preserves distinct scheme revisions and their complete history",async()=>{
      const value=await page.evaluate(async()=>{
        const repo=await RingsideStore.Repository.open("/synthetic-219-profile-merge"),E=RingsideEvaluation,M=RingsideModel,original=E.migrate(M.recordEnvelope(M.sampleRecord()));await repo.importLibrary(original);
        const incoming=JSON.parse(JSON.stringify(original)),p=incoming.evaluationProfiles[0],prior=E.serializeProfile(p);p.revision=2;p.name="完整发布历史";p.disabled=true;p.releases=[prior];
        await repo.importLibrary(incoming,{merge:true});const saved=await repo.exportLibrary();repo.close();return{original:original.evaluationProfiles[0],imported:p,profiles:saved.evaluationProfiles,records:saved.athletes.flatMap(a=>a.records)};
      });
      assert.equal(value.profiles.length,2);const imported=value.profiles.find(p=>p.id!==value.original.id);assert.equal(imported.revision,2);assert.equal(imported.disabled,true);assert.deepEqual(imported.releases,value.imported.releases);assert.ok(value.records.some(r=>r.evaluationProfileId===imported.id));
    });
    const old=legacyLibrary();
    await check("upgrade preserves exact raw generation and exports restorable old backup",async()=>{
      const value=await page.evaluate(async old=>{
        const repo=await RingsideStore.Repository.open("/synthetic-219-upgrade"),generation="raw-218",tx=repo.db.transaction(["meta","config","profiles","athletes","groups","records","recordIndex"],"readwrite");
        const put=(table,id,value)=>tx.objectStore(table).put({generation,id,value});const config={...old};delete config.athletes;delete config.groups;delete config.evaluationProfiles;put("config","library",config);
        for(const p of old.evaluationProfiles)put("profiles",p.id,p);for(const g of old.groups)put("groups",g.id,g);
        for(const a of old.athletes){const{records,...metadata}=a;put("athletes",a.id,metadata);for(const r of records){put("records",r.recordId,r);put("recordIndex",r.recordId,RingsideStore.summary(r));}}
        tx.objectStore("meta").put({id:"active",value:generation});await new Promise((res,rej)=>{tx.oncomplete=res;tx.onabort=()=>rej(tx.error);});repo.generation=generation;
        const report=await repo.upgradeMeasurementContract(),newGeneration=repo.generation,first=await repo.loadRecord(old.athletes[0].records[0].recordId);
        const rawRecord=await repo.get("records",first.recordId,generation),rawProfiles=await repo.values("profiles",generation),backup=await (await repo.upgradeBackupBlob()).text();
        const idempotent=await repo.upgradeMeasurementContract();await repo.importLibrary(RingsideEvaluation.migrate(RingsideModel.libraryDefaults()));await repo.importLibrary(RingsideEvaluation.migrate(RingsideModel.libraryDefaults()));
        const retained=!!await repo.get("config","library",generation);await repo.restoreUpgradeCheckpoint();const restored=repo.generation===generation&&JSON.stringify(await repo.values("profiles"))===JSON.stringify(old.evaluationProfiles);repo.close();return{report,changed:newGeneration!==generation,rawRecord,rawProfiles,backup,first,idempotent,retained,restored};
      },old);
      assert.equal(value.changed,true);assert.equal(value.idempotent,null);assert.equal(value.retained,true);assert.equal(value.restored,true);assert.deepEqual(value.rawRecord,old.athletes[0].records[0]);assert.deepEqual(value.rawProfiles,old.evaluationProfiles);
      assert.equal(value.first.narrative.text,old.athletes[0].records[0].narrative.text);
      const measurements=structuredClone(value.first.data);for(const row of measurements.iso){assert.equal(row.protocolIdentity.version,1);delete row.protocolIdentity;}
      assert.deepEqual(measurements,old.athletes[0].records[0].data);
      const rows=value.backup.trim().split("\n").map(JSON.parse);assert.deepEqual(rows.find(r=>r.type==="record").value,old.athletes[0].records[0]);assert.deepEqual(rows.find(r=>r.type==="profile").value,old.evaluationProfiles[0]);
      fs.writeFileSync(path.join(out,channel+"-migration-report.json"),JSON.stringify(value.report,null,2));fs.writeFileSync(path.join(out,channel+"-raw-upgrade-backup.jsonl"),value.backup);
    });
    await check("import generation switch rejects another page's concurrent write",async()=>{
      const value=await page.evaluate(async()=>{
        const R=RingsideStore.Repository,repo=await R.open("/synthetic-219-import-race"),lib=RingsideEvaluation.migrate(RingsideModel.libraryDefaults());await repo.importLibrary(lib);const initial=repo.generation,other=await R.open("/synthetic-219-import-race");
        async function* rows(){let wrote=false;for await(const row of RingsideStore.libraryRows(lib)){if(!wrote&&row.type==="profile"){wrote=true;const latest=await other.directory();latest.groups.push({id:"concurrent",name:"survives"});await other.save(latest);}yield row;}}
        let error="";try{await repo.importRows(rows());}catch(e){error=e.message;}const active=(await repo.meta("active")).value,groups=await repo.values("groups",active);repo.close();other.close();return{error,same:active===initial,groups};
      });assert.match(value.error,/其他页面/);assert.equal(value.same,true);assert.equal(value.groups[0].name,"survives");
    });
    await check("rollback followed by another upgrade retains and exports the post-upgrade recovery copy",async()=>{
      const value=await page.evaluate(async()=>{
        const repo=await RingsideStore.Repository.open("/synthetic-219-upgrade");await repo.upgradeMeasurementContract();
        const lib=await repo.directory();lib.groups.push({id:"after_upgrade",name:"升级后新增资料"});await repo.save(lib);const retained=repo.generation;
        await repo.restoreUpgradeCheckpoint();await repo.upgradeMeasurementContract();await repo.importLibrary(RingsideEvaluation.migrate(RingsideModel.libraryDefaults()));
        const groups=await repo.values("groups",retained),backup=await(await repo.rollbackRecoveryBackupBlob()).text();repo.close();return{groups,backup};
      });assert.ok(value.groups.some(g=>g.id==="after_upgrade"));assert.ok(value.backup.trim().split("\n").map(JSON.parse).some(r=>r.type==="group"&&r.value.id==="after_upgrade"));
    });
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
  }finally{await browser.close();result.sourceUnchanged=hash(fs.readFileSync(source))===sourceHash;fs.writeFileSync(path.join(out,channel+".json"),JSON.stringify(result,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
