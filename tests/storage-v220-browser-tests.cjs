"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome",modules=process.argv.includes("--modules");
function option(name,fallback){const inline=process.argv.find(arg=>arg.startsWith(name+"="));if(inline)return inline.slice(name.length+1);const index=process.argv.indexOf(name);if(index<0)return fallback;if(!process.argv[index+1]||process.argv[index+1].startsWith("--"))throw Error(name+" requires a value");return process.argv[index+1];}
const out=path.resolve(root,option("--artifact-dir",modules?"output/playwright/v220/storage-modules":"output/playwright/v220/storage")),relative=path.relative(path.join(root,"output"),out);
if(!relative||relative.startsWith("..")||path.isAbsolute(relative))throw Error("Artifacts must stay in a subdirectory of output");
fs.mkdirSync(out,{recursive:true});
const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
const names=["calc","fvp","sprint-fvp","sprint-elasticity","sprint-fvp-confidence","sources","cpet-reference","iso-reference","definitions","tests","scoring","model","acquisition","evaluation","store","interventions"];
const moduleSources=Object.fromEntries(names.map(name=>["src/ringside-"+name+".js",fs.readFileSync(path.join(root,"src/ringside-"+name+".js"),"utf8")]));
const source=path.resolve(root,option("--source","MotionBench.html"));
const result={channel,synthetic:true,mode:modules?"source-modules":"product-html",sourceHash:digest(modules?Object.values(moduleSources).join("\n"):fs.readFileSync(source)),runnerSha256:digest(fs.readFileSync(__filename)),moduleHashes:Object.fromEntries(Object.entries(moduleSources).map(([file,text])=>[file,digest(text)])),checks:[],errors:[],network:[],pass:false};
const shell=path.join(out,"synthetic-storage-shell.html");
if(modules)fs.writeFileSync(shell,"<!doctype html><html><head><meta charset=\"utf-8\"></head><body>Isolated synthetic storage test</body></html>");
function fixtures(){
  window.storageFixture=label=>{const record=RingsideModel.sampleRecord();record.demo=false;record.recordId="record-"+label;record.athleteId="athlete-"+label;record.athlete.name="Synthetic storage "+label;record.athlete.notes="initial-"+label;return RingsideEvaluation.migrate(RingsideModel.recordEnvelope(record));};
  window.storageView=async(repo,generation=repo.generation)=>({version:await repo.versionState(),config:await repo.get("config","library",generation),athletes:await repo.values("athletes",generation),records:await repo.values("records",generation),profiles:await repo.values("profiles",generation)});
  window.storageError=async operation=>{try{await operation();return "";}catch(error){return error.message;}};
  window.storageInsert=async(repo,label)=>{const lib=await repo.directory(),record=structuredClone(await repo.loadRecord(lib.athletes[0].records[0].recordId));record.recordId="record-"+label;record.athleteId="athlete-"+label;record.athlete.name="Synthetic storage "+label;const owner=structuredClone(lib.athletes[0]);owner.id=record.athleteId;owner.name=record.athlete.name;owner.profile.name=record.athlete.name;return repo.saveRecords([record],{expectedRecords:{[record.recordId]:"null"}},{newAthletes:[owner]});};
}
function evidence(value,key=""){
  if(value===null||typeof value!=="object")return value;
  if(key==="config")return{sha256:digest(JSON.stringify(value)),activeAthleteId:value.activeAthleteId,activeRecordId:value.activeRecordId,defaultEvaluationProfileId:value.defaultEvaluationProfileId,testPlans:(value.testPlans||[]).map(plan=>({id:plan.id,name:plan.name}))};
  if(key==="records")return value.map(record=>({recordId:record.recordId,athleteId:record.athleteId,dataSha256:digest(JSON.stringify(record.data)),narrativeSha256:digest(JSON.stringify(record.narrative)),firstCmjHeight:record.data.cmj?.[0]?.height}));
  if(key==="profiles")return value.map(profile=>({id:profile.id,revision:profile.revision,sha256:digest(JSON.stringify(profile))}));
  if(key==="athletes")return value.map(owner=>({id:owner.id,name:owner.name,injuryHistory:owner.profile?.injuryHistory,sha256:digest(JSON.stringify(owner))}));
  if(key==="record")return{recordId:value.recordId,dataSha256:digest(JSON.stringify(value.data)),firstCmjHeight:value.data.cmj?.[0]?.height};
  if(Array.isArray(value))return value.map(item=>evidence(item));
  return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,evidence(item,name)]));
}
(async()=>{
  const browser=await chromium.launch({channel,headless:true});
  try{
    async function environment(label){
      const context=await browser.newContext({offline:true}),a=await context.newPage(),b=await context.newPage();
      for(const page of[a,b]){
        page.setDefaultTimeout(15000);page.on("pageerror",error=>result.errors.push({label,error:error.message}));page.on("request",request=>{if(/^https?:/.test(request.url()))result.network.push(request.url());});page.on("dialog",dialog=>dialog.accept());
        await page.goto(pathToFileURL(modules?shell:source).href);
        if(modules){await page.addScriptTag({content:"window.RingsideBuild=Object.freeze({version:"+JSON.stringify(require("../package.json").version)+"});"});for(const text of Object.values(moduleSources))await page.addScriptTag({content:text});}
        else assert.equal(await page.evaluate(()=>App.ready),true);
        await page.evaluate(fixtures);assert.equal(await page.evaluate(()=>typeof RingsideStore.Repository.prototype.saveRecords),"function");
      }
      const database="/synthetic-storage-v220-"+channel+"-"+label;
      await a.evaluate(async database=>{window.repo=await RingsideStore.Repository.open(database);await repo.importLibrary(storageFixture("base"));await repo.directory();},database);
      await b.evaluate(async database=>{window.repo=await RingsideStore.Repository.open(database);await repo.directory();},database);
      return{context,a,b,database};
    }
    async function check(name,run){const env=await environment(name.replace(/[^a-z0-9]+/gi,"-"));try{const details=await run(env);result.checks.push({name,details:evidence(details)});console.log("PASS "+name);}finally{await env.context.close();}}
    await check("ordinary record save preserves another page's shared plan and athlete changes",async({a,b})=>{
      const original=await a.evaluate(async()=>{window.original=await repo.loadRecord("record-base");return storageView(repo);});
      await b.evaluate(async()=>{const lib=await repo.directory(),expectedConfig=repo.metadataHashes.get("config:library"),owner=lib.athletes[0];lib.testPlans.push({id:"concurrent-plan",name:"Synthetic concurrent plan",testIds:["cmj"],defaultEvaluationProfileId:lib.defaultEvaluationProfileId,disabled:false});owner.profile.injuryHistory="Synthetic new profile note";await repo.save(lib,[],{},{expectedConfig,expectedAthletes:{[owner.id]:repo.metadataHashes.get("athletes:"+owner.id)}});});
      const value=await a.evaluate(async()=>{const record=structuredClone(original);record.data.cmj[0].height=52;await repo.saveRecords([record],{expectedRecords:{[record.recordId]:JSON.stringify(original)}},{selection:{activeAthleteId:record.athleteId,activeRecordId:record.recordId}});const after=await storageView(repo),oldConfig=JSON.parse(repo.metadataHashes.get("config:library"));return{after,baselinePlans:oldConfig.testPlans};});
      assert.equal(value.after.config.testPlans.length,1);assert.equal(value.after.athletes[0].profile.injuryHistory,"Synthetic new profile note");assert.equal(Number(value.after.records[0].data.cmj[0].height),52);assert.deepEqual(value.baselinePlans,[]);assert.deepEqual(original.config.testPlans,[]);return value;
    });
    await check("fresh ordinary save advances its own management configuration baseline",async({a})=>{
      const value=await a.evaluate(async()=>{const record=await repo.loadRecord("record-base"),changed=structuredClone(record);changed.data.cmj[0].height=53;await repo.saveRecords([changed],{expectedRecords:{[changed.recordId]:JSON.stringify(record)}},{selection:{activeAthleteId:changed.athleteId,activeRecordId:changed.recordId}});const expectedConfig=repo.metadataHashes.get("config:library"),lib=await repo.directory();lib.groups.push({id:"fresh-group",name:"Synthetic fresh management"});await repo.save(lib,[],{},{expectedConfig});return{groups:await repo.values("groups"),record:await repo.loadRecord("record-base")};});
      assert.equal(value.groups[0].id,"fresh-group");assert.equal(Number(value.record.data.cmj[0].height),53);return value;
    });
    await check("stale management save rejects after a safe record-only save",async({a,b})=>{
      await a.evaluate(async()=>{window.staleLibrary=await repo.directory();window.original=await repo.loadRecord("record-base");});
      await b.evaluate(async()=>{const lib=await repo.directory();lib.testPlans.push({id:"new-plan",name:"Synthetic new plan",testIds:["cmj"],defaultEvaluationProfileId:lib.defaultEvaluationProfileId});await repo.save(lib,[],{},{expectedConfig:repo.metadataHashes.get("config:library")});});
      const value=await a.evaluate(async()=>{const changed=structuredClone(original);changed.data.cmj[0].height=54;await repo.saveRecords([changed],{expectedRecords:{[changed.recordId]:JSON.stringify(original)}});staleLibrary.groups.push({id:"stale-group",name:"Must not commit"});const error=await storageError(()=>repo.save(staleLibrary,[],{},{expectedConfig:repo.metadataHashes.get("config:library")}));return{error,after:await storageView(repo),groups:await repo.values("groups")};});
      assert.match(value.error,/其他页面/);assert.equal(value.after.config.testPlans.length,1);assert.equal(value.groups.length,0);assert.equal(Number(value.after.records[0].data.cmj[0].height),54);return value;
    });
    await check("record comparison rejects another page's newer measurement without partial writes",async({a,b})=>{
      await a.evaluate(async()=>window.original=await repo.loadRecord("record-base"));
      await b.evaluate(async()=>{const original=await repo.loadRecord("record-base"),changed=structuredClone(original);changed.data.cmj[0].height=70;await repo.saveRecords([changed],{expectedRecords:{[changed.recordId]:JSON.stringify(original)}});});
      const value=await a.evaluate(async()=>{const before=await storageView(repo),changed=structuredClone(original);changed.data.cmj[0].height=75;const error=await storageError(()=>repo.saveRecords([changed],{expectedRecords:{[changed.recordId]:JSON.stringify(original)}},{selection:{activeAthleteId:"",activeRecordId:""}}));return{error,before,after:await storageView(repo),localHeight:changed.data.cmj[0].height};});
      assert.match(value.error,/其他页面/);assert.deepEqual(value.after,value.before);assert.equal(value.localHeight,75);return value;
    });
    await check("new athlete and first real record save atomically without writing stale metadata",async({a,b})=>{
      await b.evaluate(async()=>{const lib=await repo.directory();lib.groups.push({id:"external-group",name:"Synthetic external group"});await repo.save(lib,[],{},{expectedConfig:repo.metadataHashes.get("config:library")});});
      const value=await a.evaluate(async()=>{await storageInsert(repo,"new-owner");return{view:await storageView(repo),groups:await repo.values("groups"),hash:repo.metadataHashes.get("athletes:athlete-new-owner")};});
      assert.equal(value.view.athletes.length,2);assert.equal(value.view.records.length,2);assert.equal(value.groups[0].id,"external-group");assert.ok(value.hash);return value;
    });
    await check("failed record insertion leaves neither the new athlete nor a partial record",async({a})=>{
      const value=await a.evaluate(async()=>{const before=await storageView(repo),original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value){if(this.name==="recordIndex"&&value.id==="record-failed-owner")throw Error("Synthetic index write failure");return original.call(this,value);};let error;try{error=await storageError(()=>storageInsert(repo,"failed-owner"));}finally{IDBObjectStore.prototype.put=original;}return{error,before,after:await storageView(repo)};});
      assert.match(value.error,/Synthetic/);assert.deepEqual(value.after,value.before);return value;
    });
    await check("a newly archived athlete cannot receive a first record while existing records retain their edit behavior",async({a,b})=>{
      await a.evaluate(async()=>window.original=await repo.loadRecord("record-base"));
      await b.evaluate(async()=>{const lib=await repo.directory(),owner=lib.athletes[0],expectedAthletes={[owner.id]:JSON.stringify(RingsideStore.athleteMetadata(owner))};owner.archived=true;await repo.save(lib,[],{},{expectedAthletes});});
      const value=await a.evaluate(async()=>{const before=await storageView(repo),created={...structuredClone(original),recordId:"record-after-archive"},error=await storageError(()=>repo.saveRecords([created],{expectedRecords:{[created.recordId]:"null"}})),afterRejected=await storageView(repo),existing=structuredClone(original);existing.data.cmj[0].height=62;await repo.saveRecords([existing],{expectedRecords:{[existing.recordId]:JSON.stringify(original)}});return{error,before,afterRejected,after:await storageView(repo)};});
      assert.match(value.error,/归档/);assert.deepEqual(value.afterRejected,value.before);assert.equal(value.after.records.length,1);assert.equal(Number(value.after.records[0].data.cmj[0].height),62);assert.equal(value.after.athletes[0].archived,true);return value;
    });
    for(const kind of ["athlete","record"])await check("empty ordinary save cannot select a "+kind+" moved to the recycle bin by another page",async({a,b})=>{
      await b.evaluate(async kind=>{const lib=await repo.directory(),record=await repo.loadRecord("record-base"),records=[],checks={expectedConfig:repo.metadataHashes.get("config:library")};lib.activeAthleteId="";lib.activeRecordId="";if(kind==="athlete"){const owner=lib.athletes[0];checks.expectedAthletes={[owner.id]:JSON.stringify(RingsideStore.athleteMetadata(owner))};owner.deletedAt=new Date().toISOString();}else{checks.expectedRecords={[record.recordId]:JSON.stringify(record)};record.deletedAt=new Date().toISOString();records.push(record);}await repo.save(lib,records,{},checks);},kind);
      const value=await a.evaluate(async()=>{const before=await storageView(repo),error=await storageError(()=>repo.saveRecords([],{}, {selection:{activeAthleteId:"athlete-base",activeRecordId:"record-base"}}));return{error,before,after:await storageView(repo)};});assert.match(value.error,/已不存在/);assert.deepEqual(value.after,value.before);assert.equal(value.after.config.activeRecordId,"");return value;
    });
    await check("normal previous-library restore returns G2 to G1 and back to G2",async({a})=>{
      const value=await a.evaluate(async()=>{const first=await storageView(repo);await repo.importLibrary(storageFixture("second"));const second=await storageView(repo);await repo.restorePrevious();const restored=await storageView(repo);await repo.restorePrevious();const returned=await storageView(repo);return{first,second,restored,returned};});
      assert.equal(value.restored.version.active,value.first.version.active);assert.equal(value.restored.version.previous,value.second.version.active);assert.deepEqual(value.restored.records,value.first.records);assert.equal(value.returned.version.active,value.second.version.active);assert.equal(value.returned.version.previous,value.first.version.active);assert.deepEqual(value.returned.records,value.second.records);return value;
    });
    await check("old page restore rejects a switched generation and preserves both pointers",async({a,b})=>{
      await b.evaluate(()=>repo.importLibrary(storageFixture("new-active")));
      const value=await a.evaluate(async()=>{const before=await repo.versionState(),error=await storageError(()=>repo.restorePrevious());return{error,before,after:await repo.versionState(),records:await repo.values("records",before.active)};});
      assert.match(value.error,/其他页面/);assert.deepEqual(value.after,value.before);assert.equal(value.records[0].recordId,"record-new-active");return value;
    });
    await check("restore and obsolete cleanup interleaving cannot delete the active library",async({a,b,database})=>{
      await a.evaluate(async()=>{window.firstGeneration=repo.generation;await repo.importLibrary(storageFixture("second"));});
      await b.evaluate(async database=>{repo.close();window.repo=await RingsideStore.Repository.open(database);const original=repo.restorePointers.bind(repo);repo.restorePointers=async(...args)=>{window.restoreReached=true;await new Promise(resolve=>window.releaseRestore=resolve);return original(...args);};window.restoreTask=storageError(()=>repo.restorePrevious());},database);
      await b.waitForFunction(()=>window.restoreReached);
      await a.evaluate(()=>{const original=repo.discardGeneration.bind(repo);repo.discardGeneration=async generation=>{window.cleanupReached=true;await new Promise(resolve=>window.releaseCleanup=resolve);return original(generation);};window.importTask=repo.importLibrary(storageFixture("third"));});
      await a.waitForFunction(()=>window.cleanupReached);await b.evaluate(()=>releaseRestore());const error=await b.evaluate(()=>restoreTask);assert.match(error,/其他页面/);await a.evaluate(()=>releaseCleanup());await a.evaluate(()=>importTask);
      const value=await a.evaluate(async()=>({view:await storageView(repo),oldConfig:await repo.get("config","library",firstGeneration)}));
      assert.equal(value.view.records[0].recordId,"record-third");assert.ok(value.view.config);return{error,...value};
    });
    await check("restore rejects a same-generation write between its snapshot and pointer transaction",async({a,b,database})=>{
      await a.evaluate(()=>repo.importLibrary(storageFixture("second")));
      await b.evaluate(async database=>{repo.close();window.repo=await RingsideStore.Repository.open(database);const original=repo.restorePointers.bind(repo);repo.restorePointers=async(...args)=>{window.restoreReached=true;await new Promise(resolve=>window.releaseRestore=resolve);return original(...args);};window.restoreTask=storageError(()=>repo.restorePrevious());},database);
      await b.waitForFunction(()=>window.restoreReached);await a.evaluate(async()=>{const original=await repo.loadRecord("record-second"),changed=structuredClone(original);changed.data.cmj[0].height=61;await repo.saveRecords([changed],{expectedRecords:{[changed.recordId]:JSON.stringify(original)}});});
      const before=await a.evaluate(()=>storageView(repo));await b.evaluate(()=>releaseRestore());const error=await b.evaluate(()=>restoreTask),after=await a.evaluate(()=>storageView(repo));assert.match(error,/其他页面/);assert.deepEqual(after,before);assert.equal(Number(after.records[0].data.cmj[0].height),61);return{error,after};
    });
    await check("cleanup protects actual active previous and all upgrade checkpoint generations",async({a,b,database})=>{
      await a.evaluate(async()=>{window.first=repo.generation;await repo.importLibrary(storageFixture("second"));window.second=repo.generation;let tx=repo.db.transaction("meta","readwrite");tx.objectStore("meta").put({id:"upgrade-2.19.0",value:{generation:first,upgradedGeneration:second,rollbackGenerations:[]}});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});await repo.importLibrary(storageFixture("third"));window.third=repo.generation;tx=repo.db.transaction("meta","readwrite");tx.objectStore("meta").put({id:"upgrade-2.19.0",value:{generation:first,upgradedGeneration:second,rollbackGenerations:[{generation:third}]}});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});await repo.importLibrary(storageFixture("fourth"));window.fourth=repo.generation;await repo.importLibrary(storageFixture("fifth"));window.fifth=repo.generation;});
      const generations=await a.evaluate(()=>({first,second,third,fourth,fifth}));
      const value=await b.evaluate(async({generations,database})=>{const before=await repo.versionState(),attempts={};for(const [label,generation]of Object.entries(generations))attempts[label]={deleted:await repo.discardGeneration(generation),config:!!await repo.get("config","library",generation)};const fresh=await RingsideStore.Repository.open(database);const view=await storageView(fresh);fresh.close();return{before,after:await repo.versionState(),attempts,view};},{generations,database});
      assert.deepEqual(value.before,value.after);for(const item of Object.values(value.attempts)){assert.equal(item.deleted,false);assert.equal(item.config,true);}assert.equal(value.view.records[0].recordId,"record-fifth");return value;
    });
    await check("invalid staged import clears only its candidate and preserves current generations",async({a})=>{
      const value=await a.evaluate(async()=>{const before=await storageView(repo);async function* broken(){const lib=storageFixture("invalid"),original=lib.athletes[0].records[0];lib.athletes[0].records=Array.from({length:45},(_,i)=>({...structuredClone(original),recordId:"invalid-staged-"+i}));let count=0;for await(const row of RingsideStore.libraryRows(lib)){yield row;if(++count===43)throw Error("Synthetic broken backup");}}const error=await storageError(()=>repo.importRows(broken())),all=await new Promise((resolve,reject)=>{const request=repo.db.transaction("config").objectStore("config").getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return{error,before,after:await storageView(repo),configGenerations:all.map(row=>row.generation)};});
      assert.match(value.error,/Synthetic/);assert.deepEqual(value.after,value.before);assert.deepEqual(value.configGenerations,[value.before.version.active]);return value;
    });
    await check("backup rejects an athlete and record inserted after its athlete batch",async({a,b})=>{
      await a.evaluate(()=>{const original=repo.batches.bind(repo);repo.batches=async function*(table,...args){if(table==="records"){window.backupReached=true;await new Promise(resolve=>window.releaseBackup=resolve);}yield*original(table,...args);};window.backupTask=storageError(async()=>{window.backupBlob=await repo.backupBlob();});});
      await a.waitForFunction(()=>window.backupReached);await b.evaluate(()=>storageInsert(repo,"during-backup"));await a.evaluate(()=>releaseBackup());
      const value=await a.evaluate(async()=>({error:await backupTask,blobCreated:!!window.backupBlob,view:await storageView(repo)}));
      assert.match(value.error,/读取期间/);assert.equal(value.blobCreated,false);assert.equal(value.view.records.length,2);return value;
    });
    await check("backup rejects a generation switch during record batches",async({a,b})=>{
      await a.evaluate(()=>{const original=repo.batches.bind(repo);repo.batches=async function*(table,...args){if(table==="records"){window.backupReached=true;await new Promise(resolve=>window.releaseBackup=resolve);}yield*original(table,...args);};window.backupTask=storageError(async()=>{window.backupBlob=await repo.backupBlob();});});
      await a.waitForFunction(()=>window.backupReached);await b.evaluate(()=>repo.importLibrary(storageFixture("backup-switch")));await a.evaluate(()=>releaseBackup());
      const value=await a.evaluate(async()=>({error:await backupTask,blobCreated:!!window.backupBlob,version:await repo.versionState()}));assert.match(value.error,/读取期间/);assert.equal(value.blobCreated,false);return value;
    });
    await check("backup rejects a shared evaluation scheme edited after its profile batch",async({a,b})=>{
      await a.evaluate(()=>{const original=repo.batches.bind(repo);repo.batches=async function*(table,...args){if(table==="athletes"){window.backupReached=true;await new Promise(resolve=>window.releaseBackup=resolve);}yield*original(table,...args);};window.backupTask=storageError(async()=>{window.backupBlob=await repo.backupBlob();});});
      await a.waitForFunction(()=>window.backupReached);await b.evaluate(async()=>{const lib=await repo.directory(),profile=lib.evaluationProfiles[0],expectedProfiles={[profile.id]:JSON.stringify(profile)};profile.name="Synthetic changed evaluation scheme";await repo.save(lib,[],{},{expectedProfiles});});await a.evaluate(()=>releaseBackup());
      const value=await a.evaluate(async()=>({error:await backupTask,blobCreated:!!window.backupBlob}));assert.match(value.error,/读取期间/);assert.equal(value.blobCreated,false);return value;
    });
    await check("whole-library legacy export rejects shared configuration drift",async({a,b})=>{
      await a.evaluate(()=>{const original=repo.batches.bind(repo);repo.batches=async function*(table,...args){if(table==="records"){window.exportReached=true;await new Promise(resolve=>window.releaseExport=resolve);}yield*original(table,...args);};window.exportTask=storageError(async()=>{window.exportedLibrary=await repo.exportLibrary();});});
      await a.waitForFunction(()=>window.exportReached);await b.evaluate(async()=>{const lib=await repo.directory();lib.groups.push({id:"during-export",name:"Synthetic concurrent export change"});await repo.save(lib,[],{},{expectedConfig:repo.metadataHashes.get("config:library")});});await a.evaluate(()=>releaseExport());const value=await a.evaluate(async()=>({error:await exportTask,libraryCreated:!!window.exportedLibrary}));assert.match(value.error,/读取期间/);assert.equal(value.libraryCreated,false);return value;
    });
    await check("stable JSONL backup roundtrip preserves every original measurement and narrative",async({a})=>{
      const value=await a.evaluate(async()=>{const before=await storageView(repo),text=await(await repo.backupBlob()).text(),target=await RingsideStore.Repository.open("/synthetic-v220-backup-roundtrip");await target.importRows(RingsideStore.fileRows(new Blob([text])));const after=await storageView(target);target.close();return{before,after,text};});
      assert.deepEqual(value.after.records,value.before.records);assert.deepEqual(value.after.athletes,value.before.athletes);assert.deepEqual(value.after.profiles,value.before.profiles);fs.writeFileSync(path.join(out,channel+"-roundtrip.motionbench.jsonl"),value.text);return{records:value.after.records.length,athletes:value.after.athletes.length};
    });
    await check("upgrade-checkpoint previous restore runs without a nested queue deadlock",async({a})=>{
      const value=await a.evaluate(async()=>{const first=await storageView(repo);await repo.importLibrary(storageFixture("post-upgrade"));const second=repo.generation,tx=repo.db.transaction("meta","readwrite");tx.objectStore("meta").put({id:"upgrade-2.19.0",value:{generation:first.version.active,upgradedGeneration:second,rollbackGenerations:[]}});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});await repo.restorePrevious();return{first,second,restored:await storageView(repo)};});
      assert.notEqual(value.restored.version.active,value.first.version.active);assert.notEqual(value.restored.version.active,value.second);assert.deepEqual(value.restored.records[0].data,value.first.records[0].data);assert.equal(value.restored.records[0].narrative.text,value.first.records[0].narrative.text);return value;
    });
    if(!modules)await check("real App ordinary CMJ save preserves another page's newly created test plan",async({a,b})=>{
      await a.evaluate(()=>{App.openEntry("cmj");return App.saveNow();});await b.evaluate(()=>{App.openManagement("plans");return App.saveNow();});await b.locator('[data-manager-action="plan-new"]').click();await b.locator("#testPlanName").fill("Synthetic concurrent UI plan");await b.locator('[data-picker-project="cmj"]').check();await b.locator('[data-manager-action="plan-save"]').click();await b.waitForFunction(()=>App.getLibrary().testPlans.some(plan=>plan.name==="Synthetic concurrent UI plan"));
      await a.locator('[data-path="data.cmj.0.height"]').fill("52");await a.locator('[data-path="data.cmj.0.height"]').press("Tab");assert.equal(await a.evaluate(()=>App.saveNow()),true);const value=await a.evaluate(async()=>({plans:(await App.getRepository().get("config","library")).testPlans,height:(await App.getRepository().loadRecord(App.getState().recordId)).data.cmj[0].height}));assert.ok(value.plans.some(plan=>plan.name==="Synthetic concurrent UI plan"));assert.equal(Number(value.height),52);return value;
    });
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
  }finally{
    await browser.close();result.sourceUnchanged=modules?Object.entries(moduleSources).every(([file,text])=>fs.readFileSync(path.join(root,file),"utf8")===text):digest(fs.readFileSync(source))===result.sourceHash;
    if(!result.sourceUnchanged){result.pass=false;process.exitCode=1;result.failure="Source changed during verification";}
    fs.writeFileSync(path.join(out,channel+".json"),JSON.stringify(result,null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
