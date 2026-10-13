"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome",modules=process.argv.includes("--modules");
function option(name,fallback){const inline=process.argv.find(arg=>arg.startsWith(name+"="));if(inline)return inline.slice(name.length+1);const index=process.argv.indexOf(name);if(index<0)return fallback;const value=process.argv[index+1];if(!value||value.startsWith("--"))throw Error(name+" requires a value");return value;}
const out=path.resolve(root,option("--artifact-dir","output/playwright/v223/comparison-storage")),relative=path.relative(path.join(root,"output"),out);
if(!relative||relative.startsWith("..")||path.isAbsolute(relative))throw Error("Artifacts must stay in an output subdirectory");
fs.mkdirSync(out,{recursive:true});
const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
const names=["calc","fvp","sprint-fvp","sprint-elasticity","sprint-fvp-confidence","sources","cpet-reference","iso-reference","definitions","tests","scoring","generic-report","model","acquisition","evaluation","store","interventions"];
const moduleSources=Object.fromEntries(names.map(name=>["src/ringside-"+name+".js",fs.readFileSync(path.join(root,"src/ringside-"+name+".js"),"utf8")]));
const source=path.resolve(root,option("--source","MotionBench.html")),shell=path.join(out,"comparison-storage-shell.html");
if(modules)fs.writeFileSync(shell,'<!doctype html><html><head><meta charset="utf-8"></head><body>Isolated comparison storage acceptance</body></html>');
const result={channel,synthetic:true,mode:modules?"source-modules":"product-html",sourceHash:digest(modules?Object.values(moduleSources).join("\n"):fs.readFileSync(source)),runnerSha256:digest(fs.readFileSync(__filename)),checks:[],errors:[],network:[],pass:false};
function fixtures(){
  window.comparisonFixture=()=>{
    const record=RingsideModel.sampleRecord();record.demo=false;record.athlete.date="2026-09-01";record.recordId="comparison-record-a-0";record.athleteId="comparison-athlete-a";record.athlete.name="Synthetic comparison A";
    const library=RingsideEvaluation.migrate(RingsideModel.recordEnvelope(record)),owner=library.athletes[0],second=structuredClone(owner);
    library.groups=[{id:"comparison-team",name:"Synthetic comparison team"}];owner.groupId="comparison-team";second.id="comparison-athlete-b";second.name="Synthetic comparison B";second.profile.name=second.name;
    for(const [index,athlete]of [owner,second].entries())athlete.records=["2026-09-01","2026-09-19"].map((date,day)=>{const value=structuredClone(record);value.athleteId=athlete.id;value.recordId="comparison-record-"+(index?"b":"a")+"-"+day;value.athlete.date=date;value.athlete.name=athlete.name;value.data.cmj[0].height=35+index*5+day*3;value.evaluationProfileId=library.defaultEvaluationProfileId;value.narrative.text="Synthetic original record narrative "+value.recordId;return value;});
    library.athletes=[owner,second];library.activeAthleteId=owner.id;library.activeRecordId=owner.records[0].recordId;return library;
  };
  window.comparisonSelection=()=>({groupId:"comparison-team",athleteIds:["comparison-athlete-a","comparison-athlete-b"],dates:["2026-09-01","2026-09-19"],recordChoices:{"comparison-athlete-a":{"2026-09-01":"comparison-record-a-0","2026-09-19":"comparison-record-a-1"},"comparison-athlete-b":{"2026-09-01":"comparison-record-b-0","2026-09-19":"comparison-record-b-1"}},basis:{strength:"imtp",reactive:"rsi"}});
  window.comparisonDocument=(text="Synthetic comparison narrative")=>({id:"comparison-report-example",selection:comparisonSelection(),views:{cmj:{mode:"trend",table:"summary",metrics:["cmj_h"]}},narrative:{text,source:"manual"},revisions:[{text:"Synthetic earlier comparison narrative",created:"2026-10-01T00:00:00Z"}],inputFingerprint:"synthetic-input-fingerprint",created:"2026-10-01T00:00:00Z",updated:"2026-10-02T00:00:00Z"});
  window.comparisonError=async operation=>{try{await operation();return "";}catch(error){return error.message;}};
  window.comparisonView=async repository=>({state:await repository.versionState(),config:await repository.get("config","library"),records:await repository.values("records"),athletes:await repository.values("athletes"),profiles:await repository.values("profiles")});
}
(async()=>{
  const browser=await chromium.launch({channel,headless:true});
  try{
    async function environment(label){
      const context=await browser.newContext({offline:true}),a=await context.newPage(),b=await context.newPage();
      for(const page of[a,b]){
        page.setDefaultTimeout(15000);page.on("pageerror",error=>result.errors.push({label,error:error.message}));page.on("request",request=>{if(/^https?:/.test(request.url()))result.network.push(request.url());});page.on("dialog",dialog=>dialog.accept());
        await page.goto(pathToFileURL(modules?shell:source).href);
        if(modules){await page.addScriptTag({content:"window.RingsideBuild=Object.freeze({version:"+JSON.stringify(require("../package.json").version)+"});"});for(const text of Object.values(moduleSources))await page.addScriptTag({content:text});}else{await page.waitForFunction(()=>!!window.App?.ready);assert.equal(await page.evaluate(()=>App.ready),true);}
        await page.evaluate(fixtures);assert.equal(await page.evaluate(()=>typeof RingsideStore.Repository.prototype.readComparisonInputs),"function");
      }
      const database="/synthetic-v223-comparison-storage-"+channel+"-"+label;
      await a.evaluate(async database=>{window.repo=await RingsideStore.Repository.open(database);await repo.importLibrary(comparisonFixture());await repo.directory();},database);
      await b.evaluate(async database=>{window.repo=await RingsideStore.Repository.open(database);await repo.directory();},database);
      return{context,a,b,database};
    }
    async function check(name,run){const env=await environment(name.replace(/[^a-z0-9]+/gi,"-"));try{const details=await run(env);result.checks.push({name,details});console.log("PASS "+name);}finally{await env.context.close();}}
    await check("stable inputs contain complete original records and shared evaluation configuration",async({a})=>{
      const value=await a.evaluate(async()=>{const before=await comparisonView(repo),inputs=await repo.readComparisonInputs(comparisonSelection());inputs.records[0].data.cmj[0].height=999;return{before,libraryRecords:inputs.library.athletes.flatMap(owner=>owner.records),recordCount:inputs.records.length,config:inputs.config,expectedConfig:inputs.expectedConfig,after:await comparisonView(repo)};});
      assert.equal(value.recordCount,4);assert.equal(value.libraryRecords.length,4);assert.deepEqual(value.after,value.before);assert.equal(value.expectedConfig,JSON.stringify(value.config));assert.equal(value.config.schema,3);return{records:value.recordCount};
    });
    await check("same day alternatives remain available without silently choosing a retest",async({a})=>{
      const value=await a.evaluate(async()=>{const old=await repo.loadRecord("comparison-record-a-0"),retest={...structuredClone(old),recordId:"comparison-record-a-retest"};await repo.saveRecords([retest],{expectedRecords:{[retest.recordId]:"null"}});const selection=comparisonSelection();delete selection.recordChoices[old.athleteId][old.athlete.date];const inputs=await repo.readComparisonInputs(selection);return{count:inputs.records.filter(record=>record.athleteId===old.athleteId&&record.athlete.date===old.athlete.date).length,choices:inputs.selection.recordChoices};});assert.equal(value.count,2);assert.equal(value.choices["comparison-athlete-a"]["2026-09-01"],undefined);return value;
    });
    await check("comparison save changes only configuration and advances its own CAS guard",async({a})=>{
      const value=await a.evaluate(async()=>{const before=await comparisonView(repo),inputs=await repo.readComparisonInputs(comparisonSelection()),saved=await repo.saveComparisonReport(comparisonDocument(),inputs.expectedConfig),after=await comparisonView(repo);return{before,after,saved,hash:repo.metadataHashes.get("config:library")};});
      for(const key of["records","athletes","profiles"])assert.deepEqual(value.after[key],value.before[key]);assert.equal(value.after.config.comparisonReports.length,1);assert.deepEqual(value.after.config.comparisonReports[0],value.saved.document);assert.equal(value.saved.expectedConfig,JSON.stringify(value.saved.config));assert.equal(value.hash,value.saved.expectedConfig);return{reports:1,unchangedRecords:value.after.records.length};
    });
    await check("a stale comparison save cannot overwrite another page's document",async({a,b})=>{
      await a.evaluate(async()=>window.inputs=await repo.readComparisonInputs(comparisonSelection()));
      await b.evaluate(async()=>{const inputs=await repo.readComparisonInputs(comparisonSelection());await repo.saveComparisonReport(comparisonDocument("Synthetic other page text"),inputs.expectedConfig);});
      const value=await a.evaluate(async()=>{const before=await comparisonView(repo),document=comparisonDocument("Synthetic unsaved local text"),error=await comparisonError(()=>repo.saveComparisonReport(document,inputs.expectedConfig));return{error,before,after:await comparisonView(repo),local:document.narrative.text};});assert.match(value.error,/其他页面/);assert.deepEqual(value.after,value.before);assert.match(value.local,/unsaved local/);return{error:value.error,preserved:value.after.config.comparisonReports[0].narrative.text};
    });
    await check("record writes retain independently saved comparison documents",async({a,b})=>{
      await b.evaluate(async()=>{const input=await repo.readComparisonInputs(comparisonSelection());await repo.saveComparisonReport(comparisonDocument(),input.expectedConfig);});
      const value=await a.evaluate(async()=>{const original=await repo.loadRecord("comparison-record-a-0"),changed=structuredClone(original);changed.data.cmj[0].height=56;await repo.saveRecords([changed],{expectedRecords:{[original.recordId]:JSON.stringify(original)}});return comparisonView(repo);});assert.equal(value.config.comparisonReports[0].narrative.text,"Synthetic comparison narrative");assert.equal(value.records.find(record=>record.recordId==="comparison-record-a-0").data.cmj[0].height,56);return{reports:value.config.comparisonReports.length};
    });
    await check("comparison reading rejects a concurrent measurement modification",async({a,b})=>{
      await a.evaluate(()=>{const original=repo.get.bind(repo);repo.get=async(table,...args)=>{if(table==="records"&&!window.readReached){window.readReached=true;await new Promise(resolve=>window.releaseRead=resolve);}return original(table,...args);};window.readTask=comparisonError(()=>repo.readComparisonInputs(comparisonSelection()));});
      await a.waitForFunction(()=>window.readReached);await b.evaluate(async()=>{const original=await repo.loadRecord("comparison-record-a-0"),changed=structuredClone(original);changed.data.cmj[0].height=58;await repo.saveRecords([changed],{expectedRecords:{[original.recordId]:JSON.stringify(original)}});});await a.evaluate(()=>releaseRead());const error=await a.evaluate(()=>readTask);assert.match(error,/读取期间/);return{error};
    });
    await check("comparison CAS rejects a switched library generation",async({a,b})=>{
      await a.evaluate(async()=>window.inputs=await repo.readComparisonInputs(comparisonSelection()));await b.evaluate(()=>repo.importLibrary(comparisonFixture()));const error=await a.evaluate(()=>comparisonError(()=>repo.saveComparisonReport(comparisonDocument(),inputs.expectedConfig)));assert.match(error,/切换/);return{error};
    });
    await check("invalid explicit ownership or date leaves configuration and records untouched",async({a})=>{
      const value=await a.evaluate(async()=>{const input=await repo.readComparisonInputs(comparisonSelection()),before=await comparisonView(repo),document=comparisonDocument();document.selection.recordChoices["comparison-athlete-a"]["2026-09-01"]="comparison-record-b-0";const error=await comparisonError(()=>repo.saveComparisonReport(document,input.expectedConfig));return{error,before,after:await comparisonView(repo)};});assert.match(value.error,/记录/);assert.deepEqual(value.after,value.before);return{error:value.error};
    });
    await check("backup roundtrip and library export preserve comparison revisions and raw narratives",async({a})=>{
      const value=await a.evaluate(async()=>{const input=await repo.readComparisonInputs(comparisonSelection());await repo.saveComparisonReport(comparisonDocument(),input.expectedConfig);const before=await comparisonView(repo),text=await(await repo.backupBlob()).text(),target=await RingsideStore.Repository.open("/synthetic-comparison-roundtrip-"+crypto.randomUUID());await target.importRows(RingsideStore.fileRows(new Blob([text])));const after=await comparisonView(target),library=await target.exportLibrary();target.close();return{before,after,library};});assert.deepEqual(value.after.config.comparisonReports,value.before.config.comparisonReports);assert.deepEqual(value.after.records,value.before.records);assert.deepEqual(value.library.comparisonReports,value.before.config.comparisonReports);return{reports:value.library.comparisonReports.length,revisions:value.library.comparisonReports[0].revisions.length};
    });
    await check("merge preserves both texts and remaps conflicting record and report references",async({a})=>{
      const value=await a.evaluate(async()=>{const input=await repo.readComparisonInputs(comparisonSelection());await repo.saveComparisonReport(comparisonDocument("Synthetic local document"),input.expectedConfig);const incoming=await repo.exportLibrary();incoming.athletes[0].records[0].data.cmj[0].height=71;incoming.comparisonReports[0].narrative.text="Synthetic imported document";const merged=await repo.importLibrary(incoming,{merge:true}),library=await repo.exportLibrary();return{merged,library};});const documents=value.library.comparisonReports;assert.equal(documents.length,2);assert.equal(documents[0].narrative.text,"Synthetic local document");assert.equal(documents[1].narrative.text,"Synthetic imported document");assert.notEqual(documents[0].id,documents[1].id);assert.equal(documents[1].selection.recordChoices["comparison-athlete-a"]["2026-09-01"],value.merged.recordMap["comparison-record-a-0"]);assert.equal(documents[1].needsReview,true);assert.equal(value.merged.comparisonReportMap["comparison-report-example"],documents[1].id);return{reports:documents.length,records:value.library.athletes.flatMap(owner=>owner.records).length};
    });
    await check("identical report merge is idempotent",async({a})=>{
      const value=await a.evaluate(async()=>{const input=await repo.readComparisonInputs(comparisonSelection());await repo.saveComparisonReport(comparisonDocument(),input.expectedConfig);const incoming=await repo.exportLibrary();await repo.importLibrary(incoming,{merge:true});return repo.exportLibrary();});assert.equal(value.comparisonReports.length,1);assert.equal(value.athletes.flatMap(owner=>owner.records).length,4);return{reports:1};
    });
    await check("a removed historical record does not erase a saved comparison body or invalidate backup",async({a})=>{
      const value=await a.evaluate(async()=>{const input=await repo.readComparisonInputs(comparisonSelection());await repo.saveComparisonReport(comparisonDocument(),input.expectedConfig);const library=await repo.directory();await repo.save(library,[],{records:["comparison-record-a-0"]},{expectedConfig:repo.metadataHashes.get("config:library")});const text=await(await repo.backupBlob()).text(),target=await RingsideStore.Repository.open("/synthetic-comparison-missing-history-"+crypto.randomUUID());await target.importRows(RingsideStore.fileRows(new Blob([text])));const restored=await target.exportLibrary();target.close();return restored;});assert.equal(value.comparisonReports[0].narrative.text,"Synthetic comparison narrative");assert.equal(value.athletes.flatMap(owner=>owner.records).length,3);assert.equal(value.comparisonReports[0].selection.recordChoices["comparison-athlete-a"]["2026-09-01"],"comparison-record-a-0");return{records:3,preservedBody:true};
    });
    await check("legacy libraries remain readable without a comparison field",async({a})=>{
      const value=await a.evaluate(async()=>({config:await repo.get("config","library"),library:await repo.exportLibrary()}));assert.equal(Object.hasOwn(value.config,"comparisonReports"),false);assert.equal(Object.hasOwn(value.library,"comparisonReports"),false);return{schema:value.config.schema};
    });
    await check("comparison envelope restores complete measurements plus independent report body",async({a})=>{
      const value=await a.evaluate(async()=>{const library=await repo.exportLibrary(),report=comparisonDocument(),envelope={kind:"comparison-report",schema:1,library,report,statistics:{multipleComparisons:"Holm"}},converted=RingsideStore.comparisonEnvelopeLibrary(envelope),target=await RingsideStore.Repository.open("/synthetic-comparison-envelope-"+crypto.randomUUID());await target.importLibrary(converted);const restored=await target.exportLibrary();target.close();return{library,report,restored};});assert.deepEqual(value.restored.athletes,value.library.athletes);assert.equal(value.restored.comparisonReports[0].narrative.text,value.report.narrative.text);assert.deepEqual(value.restored.comparisonReports[0].revisions,value.report.revisions);return{records:value.restored.athletes.flatMap(owner=>owner.records).length};
    });
    await check("invalid documents and malformed envelopes are rejected before writes",async({a})=>{
      const value=await a.evaluate(async()=>{const before=await comparisonView(repo),errors=[];for(const change of[document=>document.id="__proto__",document=>document.selection.dates=["2026-02-30"],document=>document.selection.athleteIds.push(document.selection.athleteIds[0]),document=>document.narrative={text:42},document=>document.views=JSON.parse('{"__proto__":{"polluted":true}}')]){const document=comparisonDocument();change(document);errors.push(await comparisonError(()=>repo.saveComparisonReport(document,JSON.stringify(before.config))));}const library=await repo.exportLibrary(),report=comparisonDocument();delete library.athletes[0].records[0];library.athletes[0].records=library.athletes[0].records.filter(Boolean);errors.push(await comparisonError(()=>RingsideStore.comparisonEnvelopeLibrary({kind:"comparison-report",schema:1,library,report})));return{errors,before,after:await comparisonView(repo),polluted:Object.prototype.polluted||null};});assert.ok(value.errors.every(Boolean));assert.deepEqual(value.after,value.before);assert.equal(value.polluted,null);return{rejected:value.errors.length};
    });
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
  }finally{
    await browser.close();result.sourceUnchanged=modules?Object.entries(moduleSources).every(([file,text])=>fs.readFileSync(path.join(root,file),"utf8")===text):digest(fs.readFileSync(source))===result.sourceHash;
    if(!result.sourceUnchanged){result.pass=false;process.exitCode=1;result.failure="Source changed during verification";}
    fs.writeFileSync(path.join(out,channel+".json"),JSON.stringify(result,null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
