"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict"),path=require("node:path");
const ctx=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});ctx.window=ctx;
for(const name of ["calc","definitions","tests","model","evaluation","interventions","report"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),ctx);
const M=ctx.RingsideModel,E=ctx.RingsideEvaluation,json=x=>JSON.parse(JSON.stringify(x));let passed=0;
function test(name,fn){try{fn();passed++;console.log("PASS "+name);}catch(e){console.error("FAIL "+name+"\n"+String(e.stack).slice(0,2200));process.exit(1);}}
test("migrated sample resolves byte-identical calculation and analysis basis",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),l=E.migrate(M.recordEnvelope(r)),p=l.evaluationProfiles[0],resolved=E.resolve(l.athletes[0].records[0],p);
 assert.deepEqual(json(M.stats(resolved)),json(M.stats(r)));assert.equal(M.fingerprint(resolved),M.fingerprint(r));E.validateProfile(p);
});
test("identical criteria merge while different targets and protocols stay distinct",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),s=json(r),t=json(r);s.recordId="second";t.recordId="third";t.definitions[0].target=123;
 const lib={...M.libraryDefaults(),athletes:[{id:r.athleteId,name:"A",records:[r,s,t]}],activeAthleteId:r.athleteId,activeRecordId:r.recordId};
 const migrated=E.migrate(lib);assert.equal(migrated.evaluationProfiles.length,2);assert.equal(migrated.athletes[0].records[0].evaluationProfileId,migrated.athletes[0].records[1].evaluationProfileId);
 const altered=json(r);altered.protocol.cmj+=" other";assert.notEqual(E.signature(E.capture(r)),E.signature(E.capture(altered)));
});
test("updating a shared scheme changes only linked evaluation and never raw input",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),before=json(r),p=E.create(r);p.criteria.definitions.find(d=>d.id==="cmj_height").target=100;
 const next=E.resolve(r,p);assert.equal(next.definitions.find(d=>d.id==="cmj_height").target,100);assert.deepEqual(json(r),before);assert.notEqual(M.fingerprint(next),M.fingerprint(r));
});
test("names and revisions alone do not stale narrative",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),p=E.create(r),basis=M.fingerprint(E.resolve(r,p));p.name="renamed";p.revision++;
 assert.equal(M.fingerprint(E.resolve(r,p)),basis);
});
test("force, unit and protocol incompatibility disables grading without relabelling measurements",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),p=E.create(r);r.cmjConfig.definition="net";r.protocol.mas="different";
 const v=E.resolve(r,p);assert.equal(v.cmjConfig.definition,"net");assert.equal(v.definitions.find(d=>d.id==="cmj_height").referenceEnabled,false);assert.equal(v.definitions.find(d=>d.testId==="mas").target,null);
});
test("isometric targets follow schemes but protocol changes never reuse old targets",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),p=E.create(r);p.criteria.iso[0].target=999;const id=p.criteria.iso[0].id;
 assert.equal(E.resolve(r,p).data.iso.find(x=>x.id===id).target,999);r.protocol.iso="new protocol";
 assert.equal(E.resolve(r,p).data.iso.find(x=>x.id===id).target,"");
});
test("LVP parameters never change recorded velocity definitions",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),p=E.create(r);p.criteria.lvp.bench.mvt=.2;p.criteria.lvp.bench.metric="PV";
 const v=E.resolve(r,p);assert.equal(v.lvp.bench.metric,r.lvp.bench.metric);assert.equal(v.lvp.bench.mvt,"");assert.deepEqual(json(v.data.bench),json(r.data.bench));
});
test("empty athletes and an empty library do not acquire fabricated records",()=>{
 const raw={...M.libraryDefaults(),athletes:[{id:"empty",name:"Empty",profile:{name:"Empty"},records:[]}]};
 const l=E.migrate(raw);assert.equal(l.athletes[0].records.length,0);assert.equal(l.evaluationProfiles.length,1);assert.equal(E.migrate(M.libraryDefaults()).athletes.length,0);
});
test("profile editor roundtrip preserves effective calculation and rejects bad rules",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),p=E.create(r),draft=E.template(p);p.criteria=E.fromTemplate(draft,p);E.validateProfile(p);
 assert.deepEqual(json(M.stats(E.resolve(r,p))),json(M.stats(r)));p.criteria.rules.asymAmber=90;p.criteria.rules.asymRed=10;assert.throws(()=>E.validateProfile(p));
});
test("disabled or missing metric criteria cannot silently inherit local overrides",()=>{
 const r=M.normalizeRecord(M.sampleRecord()),p=E.create(r);p.criteria.definitions=p.criteria.definitions.filter(d=>d.id!=="cmj_height");
 const v=E.resolve(r,p);assert.equal(v.definitions.find(d=>d.id==="cmj_height").target,null);assert.equal(v.definitions.find(d=>d.id==="cmj_height").referenceEnabled,false);
});
console.log(passed+" management model checks passed");
