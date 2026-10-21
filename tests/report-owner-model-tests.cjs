"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = name => fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8");
const app = source("app"), copy = value => JSON.parse(JSON.stringify(value));
function appFunction(name, next) {
  const start = app.search(new RegExp("^  (?:async )?function " + name + "\\(", "m"));
  const end = app.slice(start + 1).search(new RegExp("^  (?:async )?function " + next + "\\(", "m")) + start + 1;
  assert.ok(start >= 0 && end > start, "production function " + name + " exists");
  return app.slice(start, end);
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness({ actualPersist = false } = {}) {
  const documents = Object.fromEntries(["personal", "longitudinal", "horizontal"].map(kind => [kind, { narrative: { text:kind + " original", html:"<p>" + kind + " original</p>", revision:0 }, basis:kind + "-basis" }]));
  let selected = "personal";
  const calls = [], nodes = {}, node = id => nodes[id] ||= { innerHTML:"", innerText:"", textContent:"", style:{}, classList:{remove(){}}, inert:false };
  const controller = kind => ({
    active:() => selected === kind, document:() => documents[kind], owner:() => selected === kind ? kind + ":same-anchor" : "", basis:() => documents[kind].basis,
    facts:() => ({kind}), payload:() => ({kind}), setNarrative:value => { documents[kind].narrative = copy(value); calls.push(["narrative", kind]); },
    setViews:value => { documents[kind].views = copy(value); }, render:() => kind, edit:() => kind, changeMode:value => calls.push(["mode",kind,value]),
    isLoading:() => false, pendingDisplaySave:() => null, clear:() => {calls.push(["clear",kind]);if(selected===kind)selected="personal";}, cancelPending:() => calls.push(["cancel",kind]),
    model:() => kind === "horizontal" ? {projects:[{metrics:[{cells:[{value:12}]}]}]} : {periods:[{stats:{validTests:new Set(["synthetic-test"])}}]},
  });
  const c = vm.createContext({console, AbortController, setTimeout, copy, now:() => "2026-10-21T00:00:00Z", $:node,
    state:{...documents.personal, athleteId:"same-athlete",recordId:"same-record"}, library:{evaluationProfiles:[]},
    M:{sanitizeHTML:value=>value, textToHTML:value=>"<p>"+value+"</p>", htmlToText:value=>value.replace(/<[^>]*>/g,""), fingerprint:record=>record.basis, capabilityDirectionsBasis:record=>record.basis, stats:()=>({raw:{eur:null},validTests:new Set(["synthetic-test"])})},
    N:value=>value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value),
    RingsideEvaluation:{resolve:record=>record}, RingsideInterventions:{systemPrompt:"test prompt",validateAI:text=>text}, RingsidePDF:{measureNarrative:()=>1},
    document:{fonts:{ready:Promise.resolve()},body:{style:{}},querySelector:()=>null}, matchMedia:()=>({matches:false}),ui:{sidebarCollapsed:false},
    job:null,jobSequence:0,pendingAI:null,model:"synthetic", configuredAI:async()=>({model:"synthetic"}),
    saveEditor:()=>{},isNarrativeView:()=>false,renderNarrativeStatus:()=>{},focusContentTitle:()=>{},openSettings:()=>{},safeAIError:error=>error.message,
    persist:()=>{calls.push(["persist",selected]);return Promise.resolve(true);},changed:()=>calls.push(["changed",selected]),
    confirm:()=>{calls.push(["confirm",selected]);return true;},toast:text=>calls.push(["toast",text]),setAIStatus:(...args)=>calls.push(["status",...args]),
    request:async()=>({choices:[{message:{content:"synthetic AI text"},finish_reason:"stop"}]}),showAIDraft:()=>{},
  });
  c.window = c;c.RingsideModel=c.M;
  documents.personal = c.state;
  c.horizontal = controller("horizontal"); c.longitudinal = controller("longitudinal");
  vm.runInContext(source("report-owner"), c);
  c.reports = c.RingsideReportOwner.create({controllers:[c.horizontal,c.longitudinal],state:()=>c.state});
  c.narrativeOwner = () => c.reports.document();
  c.facts = () => c.reports.active() ? c.reports.facts() : {kind:"personal"};
  const snapshot = app.slice(app.indexOf("  const snapshot = () =>"), app.indexOf("  function effectiveRecord("));
  vm.runInContext(snapshot + appFunction("effectiveRecord", "upgradeDemo") + appFunction("currentMatches", "sampleRecord") +
    appFunction("updateEditor", "format") + appFunction("preview", "showAIDraft") + appFunction("applyAI", "safeAIError") + appFunction("ai", "copyAIFacts") +
    "globalThis.API={snapshot,currentMatches,updateEditor,applyAI,ai,recordBasis,capabilityDirectionsBasis};", c);
  if (actualPersist) { c.library=null;c.repository=null;vm.runInContext(appFunction("persist","persistSessionRecord"), c); }
  return {c,documents,calls,node,select:kind=>{selected=kind;},draft:text=>({text,html:"<p>"+text+"</p>",origin:"AI",...c.API.snapshot(),capabilityDirectionsBasis:c.API.capabilityDirectionsBasis()})};
}
const tests = [], test = (name, fn) => tests.push([name,fn]);
test("real owner dispatcher routes personal, longitudinal and horizontal documents without changing the common anchor", () => {
  const h=harness(),{c}=h;
  for(const kind of ["personal","longitudinal","horizontal"]){
    h.select(kind);assert.equal(c.reports.document(),h.documents[kind]);assert.equal(c.API.snapshot().reportOwner,kind==="personal"?"":kind+":same-anchor");
    assert.equal(c.API.recordBasis(),kind+"-basis");assert.equal(c.state.recordId,"same-record");
    assert.equal(c.API.snapshot().recordId,kind==="personal"?"same-record":undefined);
    if(kind!=="personal"){assert.equal(c.reports.payload().kind,kind);assert.equal(c.reports.facts().kind,kind);}
  }
});
test("actual manual edits update only the active report narrative and preserve the other two bodies", () => {
  const h=harness();
  for(const kind of ["personal","longitudinal","horizontal"]){
    h.select(kind);const before=copy(h.documents);h.node("interpEditor").innerHTML="<p>edited "+kind+"</p>";h.node("interpEditor").innerText="edited "+kind;h.c.API.updateEditor();
    assert.equal(h.documents[kind].narrative.text,"edited "+kind);assert.equal(h.documents[kind].narrative.revision,1);
    for(const other of Object.keys(h.documents).filter(value=>value!==kind))assert.deepEqual(copy(h.documents[other]),before[other]);
  }
});
test("actual AI application preserves the correct previous narrative for each report owner", () => {
  const h=harness();
  for(const kind of ["personal","longitudinal","horizontal"]){
    h.select(kind);const before=copy(h.documents),body="applied "+kind;h.c.pendingAI=h.draft(body);h.c.API.applyAI();
    assert.equal(h.documents[kind].narrative.text,body);assert.deepEqual(copy(h.documents[kind].previousNarrative),before[kind].narrative);
    for(const other of Object.keys(h.documents).filter(value=>value!==kind))assert.deepEqual(copy(h.documents[other]),before[other]);
  }
});
test("ready drafts cannot cross any pair of report owners even with the same athlete and record ids", () => {
  const h=harness();
  for(const from of Object.keys(h.documents))for(const to of Object.keys(h.documents).filter(kind=>kind!==from)){
    h.select(from);h.c.pendingAI=h.draft(from+" pending");h.select(to);const before=copy(h.documents),count=h.calls.length;
    assert.equal(h.c.API.currentMatches(h.c.pendingAI),false);h.c.API.applyAI();assert.deepEqual(copy(h.documents),before);
    assert.deepEqual(h.calls.slice(count).map(call=>call[0]),["toast"]);
  }
});
test("actual in-flight AI cannot create or apply a draft after any report owner switch", async () => {
  for(const from of ["personal","longitudinal","horizontal"])for(const to of ["personal","longitudinal","horizontal"].filter(kind=>kind!==from)){
    const h=harness(),reply=deferred();h.select(from);h.c.request=()=>reply.promise;const before=copy(h.documents),task=h.c.API.ai();await turn();assert.ok(h.c.job);
    h.select(to);reply.resolve({choices:[{message:{content:"late response"},finish_reason:"stop"}]});await task;
    assert.equal(h.c.pendingAI,null);assert.equal(h.c.job,null);assert.deepEqual(copy(h.documents),before);assert.equal(h.calls.some(call=>call[0]==="status"&&call[1]==="ready"),false);
  }
});
test("actual AI rechecks report ownership while configuration and fonts are pending", async () => {
  for(const phase of ["configuration","fonts"]){
    const h=harness(),pending=deferred();h.select("horizontal");let requests=0;h.c.request=async()=>{requests++;return {choices:[{message:{content:"text"},finish_reason:"stop"}]};};
    if(phase==="configuration")h.c.configuredAI=()=>pending.promise;else h.c.document.fonts.ready=pending.promise;
    const task=h.c.API.ai();await turn();h.select("longitudinal");pending.resolve({model:"synthetic"});await task;
    assert.equal(h.c.pendingAI,null);assert.equal(requests,phase==="configuration"?0:1);
  }
});
test("actual AI creates drafts bound to each owner's basis and uses the matching facts", async () => {
  for(const kind of ["personal","longitudinal","horizontal"]){
    const h=harness();h.select(kind);let payload;h.c.request=async(_url,value)=>{payload=value;return {choices:[{message:{content:kind+" answer"},finish_reason:"stop"}]};};
    await h.c.API.ai();assert.equal(h.c.pendingAI.reportOwner,kind==="personal"?"":kind+":same-anchor");assert.equal(h.c.pendingAI.basis,kind+"-basis");
    assert.ok(payload.messages[1].content.includes(JSON.stringify({kind})));assert.equal(h.documents[kind].narrative.text,kind+" original");
  }
});
test("a frozen horizontal report remains editable and AI-applicable without a personal source record",async()=>{
  const h=harness(),{c}=h;h.select("horizontal");c.state=null;
  c.M.stats=()=>{throw Error("personal statistics must not be requested");};c.RingsideEvaluation.resolve=()=>{throw Error("personal record must not be resolved");};
  assert.equal(c.reports.hasContent(),true);const binding=c.API.snapshot();assert.equal(binding.reportOwner,"horizontal:same-anchor");assert.equal(binding.recordId,undefined);assert.equal(c.API.currentMatches(binding),true);
  h.node("interpEditor").innerHTML="<p>frozen manual edit</p>";h.node("interpEditor").innerText="frozen manual edit";c.API.updateEditor();assert.equal(h.documents.horizontal.narrative.text,"frozen manual edit");
  await c.API.ai();assert.ok(c.pendingAI);assert.equal(c.pendingAI.reportOwner,"horizontal:same-anchor");c.API.applyAI();assert.equal(h.documents.horizontal.narrative.text,"synthetic AI text");
  assert.equal(h.documents.horizontal.previousNarrative.text,"frozen manual edit");assert.equal(h.documents.personal.narrative.text,"personal original");
  c.reports.clear();assert.equal(c.reports.hasContent(),false);assert.equal(c.reports.active(),false);assert.equal(c.reports.document(),null);assert.equal(c.API.currentMatches(binding),false);
});
test("an in-flight frozen-report draft survives removal of its source record but still binds its document",async()=>{
  const h=harness(),{c}=h,reply=deferred();h.select("horizontal");c.request=()=>reply.promise;
  const task=c.API.ai();await turn();c.state=null;reply.resolve({choices:[{message:{content:"independent frozen draft"},finish_reason:"stop"}]});await task;
  assert.equal(c.pendingAI.text,"independent frozen draft");assert.equal(c.API.currentMatches(c.pendingAI),true);c.API.applyAI();assert.equal(h.documents.horizontal.narrative.text,"independent frozen draft");
  h.select("personal");assert.equal(c.reports.hasContent(),false);assert.equal(c.API.currentMatches({reportOwner:"",athleteId:"same-athlete",recordId:"same-record"}),false);
});
test("ordinary App persistence waits for pending displays in both controllers even when inactive", async () => {
  const h=harness({actualPersist:true}),one=deferred(),two=deferred();
  h.c.horizontal.pendingDisplaySave=()=>one.promise;h.c.longitudinal.pendingDisplaySave=()=>two.promise;let settled=false;
  const save=h.c.persist().then(result=>{settled=true;return result;});await turn();assert.equal(settled,false);
  h.c.horizontal.pendingDisplaySave=()=>null;one.resolve();await turn();assert.equal(settled,false);
  h.c.longitudinal.pendingDisplaySave=()=>null;two.resolve();assert.equal(await save,false);assert.equal(settled,true);
});
test("rejected display persistence does not silently continue an ordinary App save", async () => {
  const h=harness({actualPersist:true}),pending=deferred();h.c.horizontal.pendingDisplaySave=()=>pending.promise;
  const check=assert.rejects(h.c.persist(),/synthetic display failure/);pending.reject(Error("synthetic display failure"));await check;
});
async function realHorizontalFixture() {
  const h=harness(),{c}=h;vm.runInContext(source("horizontal-store"),c);vm.runInContext(source("horizontal-controller"),c);
  let block=null,fail=false,onRender=()=>{};
  const d={version:1,id:"ownership-test",configuration:{participants:[{athleteId:"same-athlete",recordId:"same-record"}],focusAthleteId:"same-athlete"},snapshot:{participants:[{record:c.state}],fingerprint:"frozen"},narrative:{text:"original",html:"<p>original</p>"},views:{},basis:"frozen",revision:1};
  const host={library:()=>({athletes:[]}),repository:()=>({getHorizontalReport:async()=>copy(d),saveHorizontalReport:async value=>{if(block)await block;if(fail)throw Error("synthetic display failure");return {...copy(value),revision:value.revision+1};}}),
    save:async()=>true,render:()=>onRender(),remember:()=>{},error:()=>{}};
  const horizontal=c.RingsideHorizontalController.create(host);await horizontal.restore({id:d.id});
  const reports=c.RingsideReportOwner.create({controllers:[horizontal,c.longitudinal],state:()=>c.state});
  return {...h,horizontal,reports,setBlock:value=>{block=value;},setFail:value=>{fail=value;},onRender:fn=>{onRender=fn;}};
}
test("real horizontal display barrier is visible before rendering can request an ordinary save", async () => {
  const f=await realHorizontalFixture(),pending=deferred();f.setBlock(pending.promise);let duringRender;
  f.onRender(()=>{duringRender=f.reports.pendingDisplaySave();});const task=f.horizontal.updateViews({activeReferenceId:"new-reference"});
  try{assert.ok(duringRender&&typeof duringRender.then==="function","display barrier must exist before optimistic rendering");}finally{pending.resolve();await task;}
  assert.equal(f.reports.pendingDisplaySave(),null);
});
test("real horizontal display failure releases ordinary saves only after rollback and retains later narrative", async () => {
  const f=await realHorizontalFixture(),pending=deferred();f.setBlock(pending.promise);f.setFail(true);
  const task=f.horizontal.updateViews({activeReferenceId:"new-reference"}),barrier=f.reports.pendingDisplaySave();assert.ok(barrier);
  f.horizontal.setNarrative({text:"later text",html:"<p>later text</p>"});let atRelease;
  const waiting=barrier.then(()=>{atRelease=copy(f.horizontal.document());});pending.resolve();assert.equal(await task,false);await waiting;
  assert.equal(atRelease.views.activeReferenceId,undefined);assert.equal(atRelease.narrative.text,"later text");assert.equal(f.reports.pendingDisplaySave(),null);
});
test("clearing a horizontal owner keeps the outstanding display save barrier until settlement", async () => {
  const f=await realHorizontalFixture(),pending=deferred();f.setBlock(pending.promise);const task=f.horizontal.updateViews({activeReferenceId:"new-reference"});
  f.horizontal.clear();assert.equal(f.reports.active(),false);assert.ok(f.reports.pendingDisplaySave());pending.resolve();await task;
  assert.equal(f.reports.pendingDisplaySave(),null);assert.equal(f.horizontal.document(),null);
});
(async()=>{let passed=0;for(const[name,fn]of tests){await fn();passed++;console.log("PASS "+name);}console.log(passed+" report owner checks passed");})().catch(error=>{console.error(error);process.exitCode=1;});
