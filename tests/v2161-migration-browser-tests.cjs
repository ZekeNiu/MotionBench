"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict"),{execFileSync}=require("node:child_process"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),channel=process.argv.includes("--edge")?"msedge":"chrome",out=path.join(root,"output/playwright/v2161-migration");fs.mkdirSync(out,{recursive:true});
const hash=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex"),copy=x=>JSON.parse(JSON.stringify(x));
const old=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});old.window=old;
for(const n of ["calc","fvp","cpet-reference","definitions","tests","model","evaluation"])vm.runInContext(execFileSync("git",["show",`rollback-v2.15.0-20261009:src/ringside-${n}.js`],{encoding:"utf8"}),old);
const r=old.RingsideModel.defaults();r.athlete.name="迁移验收";r.athlete.age=30;r.athlete.sex="男";r.athlete.mass=70;r.athlete.dominantHand="右手";r.narrative.html="<p>保留手写建议</p>";
r.data.iso.find(x=>x.id==="iso_shoulder_internalRotation").left=100;r.data.iso.find(x=>x.id==="iso_shoulder_externalRotation").left=50;r.data.iso.find(x=>x.id==="iso_shoulder_abduction").target=777;r.data.iso.find(x=>x.id==="iso_neck_flexion").center=100;
for(const row of r.data.fms){if(row.bilateral){row.left=row.right=2;}else{row.score=2;row.left=row.right="";}}
const pair=r.balancePairs.find(x=>x.id==="shoulder_IR_ER");pair.referenceEnabled=true;pair.ranges=old.Def.parseRanges("(1..2] | 原区间 | green");
const fixture=copy(old.RingsideEvaluation.migrate(r));fixture.evaluationProfiles[0].builtinStandardsVersion=1;
const another=copy(fixture.evaluationProfiles[0]);another.id="evaluation_unlinked";another.name="未关联的普通方案";
const demo=copy(fixture.evaluationProfiles[0]);demo.id="evaluation_demo";demo.name="示例方案";demo.demo=true;
fixture.evaluationProfiles.push(another,demo);
const result={sourceHash:hash(file),channel,synthetic:true,checks:[],errors:[],network:[],artifacts:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on("pageerror",e=>result.errors.push(e.message));page.on("dialog",d=>d.accept());page.on("request",req=>{if(/^https?:/.test(req.url()))result.network.push(req.url());});
 const ready=async()=>{await page.waitForFunction(()=>!!App.ready);assert.equal(await page.evaluate(()=>App.ready),true);};
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log("PASS "+name);};
 try{
  await page.goto(pathToFileURL(file).href);await ready();
  await check("load persisted 2.15 library and migrate all ordinary profiles once",async()=>{
   await page.evaluate(async lib=>App.getRepository().importLibrary(lib,{merge:false}),fixture);await page.reload();await ready();
   const profiles=await page.evaluate(()=>App.getRepository().values("profiles"));
   for(const profile of profiles.filter(p=>!p.demo)){assert.equal(profile.isoReferencesVersion,1);assert.ok(profile.criteria.iso.find(x=>x.id==="iso_neck_flexion").reference);assert.equal(profile.criteria.iso.find(x=>x.id==="iso_shoulder_abduction").target,777);assert.equal(profile.criteria.iso.find(x=>x.id==="iso_shoulder_abduction").reference,undefined);}
   assert.equal(profiles.find(p=>p.demo).criteria.iso.find(x=>x.id==="iso_neck_flexion").reference,undefined);assert.equal(profiles.length,3);
  });
  await check("ER:IR, reciprocal interval and polluted single-item FMS recompute after reload",async()=>{
   const stats=await page.evaluate(()=>{const r=App.getState(),p=App.getLibrary().evaluationProfiles.find(p=>p.id===r.evaluationProfileId),effective=RingsideEvaluation.resolve(r,p);const s=RingsideModel.stats(effective);return{balance:s.balanceResults.find(x=>x.id==="shoulder_IR_ER"),pair:effective.balancePairs.find(x=>x.id==="shoulder_IR_ER"),fms:Calc.fms(r.data.fms),fmsRows:r.data.fms,narrative:r.narrative.html,iso:s.isoAnalyses.find(x=>x.id==="iso_neck_flexion")};});
   assert.equal(stats.balance.results.find(x=>x.side==="L").value,.5);assert.equal(stats.pair.numeratorId,"iso_shoulder_externalRotation");assert.equal(stats.pair.denominatorId,"iso_shoulder_internalRotation");assert.equal(stats.pair.ranges[0].min,.5);assert.equal(stats.pair.ranges[0].max,1);assert.equal(stats.pair.ranges[0].includeMin,true);assert.equal(stats.pair.ranges[0].includeMax,false);
   assert.equal(stats.fms.total,14);assert.equal(stats.fms.completed,7);assert.ok(stats.fmsRows.filter(x=>!x.bilateral).every(x=>!Object.hasOwn(x,"left")&&!Object.hasOwn(x,"right")));assert.equal(stats.narrative,"<p>保留手写建议</p>");assert.ok(stats.iso.sides[0].target>0);assert.equal(stats.iso.sides[0].status,"amber");assert.equal(stats.iso.sides[0].referenceComparison.label,"关注");
  });
  await check("edit a literature group through management and reevaluate historical raw data",async()=>{
   const raw=await page.evaluate(()=>App.getState().data.iso.map(x=>[x.id,x.left,x.right,x.center]));
   await page.evaluate(()=>{App.openManagement("profiles");RingsideManagement.viewProfile(App.getState().evaluationProfileId);});
   await page.locator('[data-manager-action="profile-tab"][data-id="iso"]').click();
   const block=page.locator('[data-standard-key="iso_neck_flexion"]');await block.locator("summary").click();
   await block.locator('[data-profile-path$="reference.groups.0.values.C"]').fill("321");
   await page.locator('[data-manager-action="profile-review"]').click();await page.locator('#managementForm [type="submit"]').click();await page.locator("#managementModal").waitFor({state:"hidden"});
   await page.evaluate(()=>App.showReport());const data=await page.evaluate(()=>{const r=App.getState(),p=App.getLibrary().evaluationProfiles.find(p=>p.id===r.evaluationProfileId),e=RingsideEvaluation.resolve(r,p),row=e.data.iso.find(x=>x.id==="iso_neck_flexion");return{target:RingsideModel.effectiveIsoTarget(e,row).target,source:row.reference.source,raw:r.data.iso.map(x=>[x.id,x.left,x.right,x.center])};});assert.equal(data.target,321);assert.match(data.source,/用户调整/);assert.deepEqual(data.raw,raw);
  });
  await check("clear a seeded reference and preserve the deliberate blank on repeat loading",async()=>{
   await page.evaluate(async()=>{const repo=App.getRepository(),lib=await repo.directory();for(const p of lib.evaluationProfiles.filter(p=>!p.demo))p.criteria.iso.find(x=>x.id==="iso_neck_flexion").reference=null;await repo.save(lib);});
   await page.reload();await ready();const first=await page.evaluate(()=>App.getRepository().values("profiles"));await page.reload();await ready();const second=await page.evaluate(()=>App.getRepository().values("profiles"));assert.deepEqual(second,first);assert.ok(second.filter(p=>!p.demo).every(p=>p.criteria.iso.find(x=>x.id==="iso_neck_flexion").reference===null));
  });
  await check("profile compare-and-save rejects a concurrent modification without overwriting it",async()=>{
   const stale=await page.evaluate(async()=>{const lib=await App.getRepository().directory(),p=lib.evaluationProfiles.find(p=>!p.demo);return{lib,id:p.id,encoded:JSON.stringify(p)};});
   const other=await context.newPage();other.on("pageerror",e=>result.errors.push(e.message));other.on("request",req=>{if(/^https?:/.test(req.url()))result.network.push(req.url());});await other.goto(pathToFileURL(file).href);await other.waitForFunction(()=>!!App.ready);
   await other.evaluate(async id=>{const repo=App.getRepository(),lib=await repo.directory();lib.evaluationProfiles.find(x=>x.id===id).name="另一页面已经修改";await repo.save(lib);},stale.id);await other.close();
   const outcome=await page.evaluate(async({lib,id,encoded})=>{const repo=App.getRepository();lib.evaluationProfiles.find(x=>x.id===id).name="过时升级候选";let rejected=false;try{await repo.save(lib,[],{}, {expectedProfiles:{[id]:encoded}});}catch(e){rejected=/其他页面修改|过期/.test(e.message);}return{rejected,stored:(await repo.values("profiles")).find(x=>x.id===id).name};},stale);assert.deepEqual(outcome,{rejected:true,stored:"另一页面已经修改"});await page.reload();await ready();
  });
  await check("backup restores edited references, ER:IR and every raw measurement exactly",async()=>{
   const before=await page.evaluate(()=>App.libraryPayload()),backupText=await page.evaluate(async()=>{const blob=await App.getRepository().backupBlob();return blob.text();});const backup=path.join(out,channel+"-backup.jsonl");fs.writeFileSync(backup,backupText);result.artifacts.push({path:path.relative(root,backup).replaceAll("\\","/"),sha256:hash(backup)});
   await page.evaluate(async text=>{const rows=text.trim().split(/\r?\n/).map(JSON.parse);await App.getRepository().importRows((async function*(){for(const row of rows)yield row;})(),{merge:false});},backupText);await page.reload();await ready();const after=await page.evaluate(()=>App.libraryPayload());assert.deepEqual(after.athletes,before.athletes);assert.deepEqual(after.evaluationProfiles,before.evaluationProfiles);
  });
  await check("standalone HTML removes every other athlete's hidden setup fields",async()=>{
   const sanitized=await page.evaluate(()=>{document.querySelector("#creationContextPerson").innerHTML='<option value="other-athlete-private-id">另一位运动员</option>';document.querySelector("#creationBodyFields").innerHTML='<input value="其他运动员的身体资料"><textarea>其他运动员的训练安排</textarea>';return App.exportHTMLString();});
   for(const privateValue of ["other-athlete-private-id","另一位运动员","其他运动员的身体资料","其他运动员的训练安排"])assert.equal(sanitized.includes(privateValue),false);
  });
  assert.equal(result.errors.length,0);assert.equal(result.network.length,0);assert.equal(hash(file),result.sourceHash);result.pass=true;
 }finally{fs.writeFileSync(path.join(out,channel+"-results.json"),JSON.stringify(result,null,2));await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
