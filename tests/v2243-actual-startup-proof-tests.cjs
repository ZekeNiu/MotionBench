"use strict";
// Offline negative cases against archived evidence; never launches the desktop.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const ROOT=path.resolve(__dirname,".."),base=require("./desktop-system-v2243.cjs"),actual=require("./desktop-system-v2243-actual.cjs"),P=require("./helpers/v2243-example-preservation.cjs");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"")),hash=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const priorDirectory=path.join(base.CHECKPOINT,"verification/installed-startup-time-failure"),original=read(path.join(base.CHECKPOINT,"verification/baseline/snapshot.json")),plan=read(path.join(ROOT,"output/implementation-2.24.3/example-additions-plan.json"));
const evidence={snapshot:read(path.join(priorDirectory,"startup-snapshot.json")),receipt:read(path.join(priorDirectory,"receipt.json")),launch:read(path.join(priorDirectory,"native-launch.json")),original,plan};
const result={kind:"actual-startup-proof-negative-cases",pass:false,checks:[],errors:[],nativeLaunch:false,runnerSha256:hash(__filename),producerSha256:hash(path.join(__dirname,"desktop-system-v2243-actual.cjs")),frozenCandidateProducerSha256:hash(path.join(__dirname,"desktop-system-v2243-supplement.cjs")),planSha256:hash(path.join(ROOT,"output/implementation-2.24.3/example-additions-plan.json")),priorReceiptSha256:hash(path.join(priorDirectory,"receipt.json"))};
const check=(name,fn)=>{fn();result.checks.push(name);},rejectPrior=(name,edit)=>check(name,()=>{const input=P.clone(evidence);edit(input);assert.throws(()=>actual.provePriorStartup(input));});
try {
 const prior=actual.provePriorStartup(evidence);check("Archived actual launch proves only the exact three-view startup transition",()=>assert.equal(prior.document.revision,P.sample(original.library,plan).document.revision+1));
 const launch={requestedAt:new Date(Date.parse(prior.window.end)+10000).toISOString()},startedAt=new Date(Date.parse(launch.requestedAt)+2000).toISOString(),end=new Date(Date.parse(startedAt)+4000).toISOString();
 const continuation=()=>({snapshot:P.clone(evidence.snapshot),original,plan,prior,launch,startedAt,end}),setTime=(input,storedTime,activeTime=storedTime)=>{P.sample(input.snapshot.library,plan).document.updated=storedTime;input.snapshot.activeComparison.document.updated=activeTime;};
 check("Unchanged proved predecessor retains its exact prior timestamp",()=>actual.startupContinuation(continuation()));
 check("A verified new launch may update metadata before the new runner starts",()=>{const input=continuation();setTime(input,new Date(Date.parse(launch.requestedAt)+500).toISOString());actual.startupContinuation(input);});
 check("Stored predecessor plus later active launch timestamp is accepted",()=>{const input=continuation();setTime(input,prior.document.updated,new Date(Date.parse(launch.requestedAt)+700).toISOString());actual.startupContinuation(input);});
 rejectPrior("Prior original record mutation is rejected",input=>{input.snapshot.library.athletes[0].records[0].title="changed";});
 rejectPrior("Prior single-report change is rejected",input=>{input.snapshot.reports[0].basis="changed";});
 rejectPrior("Prior comparison narrative mutation is rejected",input=>{P.sample(input.snapshot.library,plan).document.narrative.text="changed";});
 rejectPrior("Prior unexplained revision increment is rejected",input=>{P.sample(input.snapshot.library,plan).document.revision++;});
 rejectPrior("Prior extra disclosure key is rejected",input=>{P.sample(input.snapshot.library,plan).document.views.detailOpen["longitudinal-raw-cpet"]=false;});
 rejectPrior("Prior basis mutation is rejected",input=>{P.sample(input.snapshot.library,plan).document.basis="changed";});
 rejectPrior("Prior timestamp before the recorded Explorer launch is rejected",input=>{input.launch.requestedAt=input.snapshot.activeComparison.document.updated;input.launch.requestedAt=new Date(Date.parse(input.launch.requestedAt)+1).toISOString();});
 rejectPrior("A purported successful prior run is rejected",input=>{input.receipt.pass=true;});
 rejectPrior("A prior partial supplementation receipt is rejected",input=>{input.receipt.supplement={normalFormEntry:true};});
 const rejectCurrent=(name,edit)=>check(name,()=>{const input=continuation();edit(input);assert.throws(()=>actual.startupContinuation(input));});
 rejectCurrent("A new timestamp in the unproved interval between launches is rejected",input=>setTime(input,new Date(Date.parse(prior.window.end)+1).toISOString()));
 rejectCurrent("A timestamp after the captured startup window is rejected",input=>setTime(input,new Date(Date.parse(end)+1).toISOString()));
 rejectCurrent("A copied old timestamp with changed narrative is rejected",input=>{P.sample(input.snapshot.library,plan).document.narrative.html="changed";});
 rejectCurrent("A launch revision increment without a disclosure change is rejected",input=>{P.sample(input.snapshot.library,plan).document.revision++;});
 rejectCurrent("A second startup disclosure change is rejected",input=>{P.sample(input.snapshot.library,plan).document.views.detailOpen["longitudinal-raw-fvp_sj"]=false;});
 rejectCurrent("Original record.updated remains exact during startup",input=>{input.snapshot.library.athletes[0].records[0].updated=startedAt;});
 rejectCurrent("An altered active calculation basis is rejected",input=>{input.snapshot.activeComparison.model.basis="changed";});
 const candidate=read(path.join(base.CHECKPOINT,"verification/candidate/snapshot.json")),record=P.clone(P.sample(candidate.library,plan).owner.records.find(record=>record.recordId===plan.recordIds[0]));
 const originalRecord=P.sample(original.library,plan).owner.records.find(item=>item.recordId===record.recordId),options={final:true,generatedIds:{},reservedIds:P.allIds(original.library),timestampRange:{start:startedAt,end}};
 check("New record edits within this runner operation window are accepted",()=>{record.updated=startedAt;P.verifyRecord(record,originalRecord,plan.records[0],options);});
 check("Record.updated cannot borrow the earlier Explorer startup window",()=>{record.updated=new Date(Date.parse(startedAt)-1).toISOString();assert.throws(()=>P.verifyRecord(record,originalRecord,plan.records[0],options));});
 result.pass=true;
} catch(error){result.errors.push(error.stack);process.exitCode=1;}
result.producerUnchanged=result.producerSha256===hash(path.join(__dirname,"desktop-system-v2243-actual.cjs"));
const file=path.join(ROOT,"output/implementation-2.24.3/actual-startup-proof-tests.json");fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,errors:result.errors,receipt:file}));

