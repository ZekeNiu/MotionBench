"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/capability-directions-2172");
fs.mkdirSync(out, { recursive: true });
const appSource = fs.readFileSync(path.join(root, "src/ringside-app.js"), "utf8");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto, flushReportEdits:()=>{} }); c.window = c;
for (const name of ["calc", "fvp", "sprint-fvp", "sprint-elasticity", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(path.join(root, `src/ringside-${name}.js`), "utf8"), c, { filename: name });
const M = c.RingsideModel, R = c.RingsideReport;
const json = value => JSON.parse(JSON.stringify(value));
const section = (html, key) => html.match(new RegExp(`<article[^>]*data-capability-direction="${key}"[^>]*>[\\s\\S]*?<\\/article>`))?.[0] || "";
function appFunction(name, next) {
  const marker = functionName => new RegExp(`^  (?:async )?function ${functionName}\\(`, "m");
  const start = appSource.search(marker(name)), tail = appSource.slice(start + 1), following = tail.search(marker(next)), end = start + 1 + following;
  assert.ok(start >= 0 && end > start, name); return appSource.slice(start, end);
}
// Execute the actual App.facts implementation with its real effective-record
// resolver; only state/library and browser-independent utility bindings are mocked.
vm.runInContext("const M=window.RingsideModel,T=window.RingsideTests,N=Calc.num; const copy=x=>JSON.parse(JSON.stringify(x)); const positive=x=>N(x)!==null&&Number(x)>0;" +
  appFunction("effectiveRecord", "upgradeDemo") + appFunction("facts", "preview") + "const App={facts,recordBasis};", c);
const App = vm.runInContext("App", c);
function linkState(record){c.state=record;const profile=c.RingsideEvaluation.create(record);c.state.evaluationProfileId=profile.id;c.library={evaluationProfiles:[profile]};}
function fixture() {
  const r = M.sampleRecord(); r.views.capabilitySelections = { strength: "fdsi", reactive: "dj_rsi", speed: "srr" }; return r;
}
function directionScenarios() {
  const cases = [];
  const append = (name, record) => {
    cases.push({ name, record: json(record) });
  };
  for (const [key, ids] of Object.entries({ strength:["fvp","fdsi","idsi_matched","idsi_fixed250","eur"], reactive:["dj_rsi","hop_rsi","cmrj_rsi"], speed:["sprint_fvp","srr"] }))
    for (const id of ids) { const r = fixture(); r.views.capabilitySelections[key] = id; append(key + ":" + id, r); }
  const fallback = fixture(); delete fallback.views.capabilitySelections; append("implicit-fallback", fallback);
  for (const status of ["red","amber","green","gray"]) {
    const r = fixture(), d = r.definitions.find(item => item.id === "dj_rsi");
    Object.assign(d, { referenceEnabled: status !== "gray", ranges: status === "gray" ? [] : [{ min:null,max:null,label:"原始自定义等级",status }] });
    append("reactive-grade:" + status, r);
  }
  const jump = fixture(); jump.views.capabilitySelections.strength = "fvp";
  for (const id of ["fvp_sj","fvp_cmj"]) { jump.enabled[id] = true; jump.fvpConfig[id].distanceCm = 33; jump.data[id] = [0,20,40,60,80].map((load,i)=>({ id:id+i,load,height:[33,27,22,14,10][i] })); }
  jump.views.fvpProtocol = "fvp_cmj"; append("fvp-cmj-valid", jump); jump.data.fvp_cmj = jump.data.fvp_cmj.slice(0,2); append("fvp-cmj-review", jump);
  const sprint = fixture(); sprint.views.capabilitySelections.speed = "sprint_fvp"; sprint.athlete.mass = 75; sprint.athlete.height = 180; sprint.enabled.sprint_fvp = true;
  const times = [1.3735406501017202,2.1031246565401025,3.3485505747362385,4.50523488280616,5.633470563022033];
  sprint.data.sprint_fvp = [{ id:"reference_synthetic_sprint",splits:[5,10,20,30,40].map((distanceM,i)=>({distanceM,timeS:times[i]})) }]; append("sprint-40m",sprint);
  sprint.sprintFvpAnalysis.targetDistanceM = 10; append("sprint-10m",sprint);
  return cases;
}
let passed = 0;
const checks = [];
function test(name, run) { run(); passed++; checks.push(name); console.log("PASS " + name); }
const hash = value => createHash("sha256").update(value).digest("hex");
test("actual App.facts changes its selected basis when strength switches DSI to EUR", () => {
  linkState(fixture());
  const before = App.facts(), beforeBasis = App.recordBasis(), beforeHtml = section(R.renderCapabilityAnalysis(R.build(c.state)), "strength");
  c.state.views.capabilitySelections.strength = "eur";
  const after = App.facts(), afterBasis = App.recordBasis(), afterHtml = section(R.renderCapabilityAnalysis(R.build(c.state)), "strength");
  const evidence = { synthetic: true, externalAIRequested: false, sourceHash: hash(appSource), factsChanged: JSON.stringify(before) !== JSON.stringify(after),
    globalFingerprintChanged: beforeBasis !== afterBasis, screenChanged: beforeHtml !== afterHtml,
    beforeSelected: before.selectedCapabilityDirections || null, afterSelected: after.selectedCapabilityDirections || null,
    beforeCapabilityAnalysis: before.capabilityAnalysis, afterCapabilityAnalysis: after.capabilityAnalysis };
  fs.writeFileSync(path.join(out, process.argv.includes("--red") ? "red-facts-reproduction.json" : "green-facts-reproduction.json"), JSON.stringify(evidence, null, 2));
  assert.notEqual(beforeHtml, afterHtml, "the real report renderer already follows the selector");
  assert.ok(JSON.stringify(before) !== JSON.stringify(after), "actual App.facts must include the selected direction basis");
  assert.equal(beforeBasis, afterBasis, "selection remains separate from the measurement fingerprint");
  assert.deepEqual(json(before.capabilityAnalysis), json(after.capabilityAnalysis), "full original AI capability analysis must remain intact");
});
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/capability-direction-values-v2175.json"), "utf8"));
test("all 19 pre-change direction scenarios preserve scientific values in redesigned screen and PDF cards", () => {
  const results = [];
  const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  for (const example of directionScenarios()) {
    const expected = baseline.cases.find(item => item.name === example.name);
    assert.ok(expected, `captured pre-change scenario ${example.name}`);
    const report = R.build(example.record);
    const actual=M.capabilityDirections(report.record,report.stats).map(({id,metricId,value,unit,status,judgment,digits})=>({id,metricId,value,unit,status,judgment,digits}));
    assert.deepEqual(json(actual),expected.directions,example.name+" independent baseline values");
    for (const [mode, options] of [["screen", {}], ["print", { print: true }]]) {
      const html = R.renderCapabilityAnalysis(report, options);
      for (const metric of expected.directions) {
        const block=section(html,metric.id),formatted=metric.value===null?"—":Number(metric.value).toLocaleString("zh-CN",{minimumFractionDigits:metric.digits,maximumFractionDigits:metric.digits});
        assert.ok(block.includes(`data-direction-metric="${metric.metricId}"`),`${example.name}/${mode}/${metric.id} selected basis`);
        assert.equal(block.match(/class="capability-direction-judgment [^"]*">([\s\S]*?)<\/p>/)?.[1],escape(metric.judgment),`${example.name}/${mode}/${metric.id} judgment`);
        assert.equal(block.match(/class="capability-direction-value">([\s\S]*?)<\/p>/)?.[1],formatted+(metric.unit&&metric.unit!=="比值"?` <small>${escape(metric.unit)}</small>`:""),`${example.name}/${mode}/${metric.id} value and unit`);
        assert.ok(block.includes(`data-capability-parameters="${metric.id}"`),`${example.name}/${mode}/${metric.id} parameter disclosure`);
      }
    }
    results.push({ name: example.name, screen: true, print: true });
  }
  fs.writeFileSync(path.join(out, "screen-print-equivalence.json"), JSON.stringify({ synthetic: true, baselineRef:baseline.baselineRef,baselineSourceHashes:baseline.baselineSourceHashes, scenarios: results }, null, 2));
});
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
test("shared projection and registry are pure and all selected metrics match actual App.facts", () => {
  assert.ok(Object.isFrozen(M.capabilityDirectionOptions));
  for (const options of Object.values(M.capabilityDirectionOptions)) assert.ok(Object.isFrozen(options) && options.every(Object.isFrozen));
  for (const [key, options] of Object.entries(M.capabilityDirectionOptions)) for (const [id] of options) {
    const record = fixture(); record.views.capabilitySelections[key] = id;
    const stats = M.stats(record), original = JSON.stringify({ record, stats });
    freeze(record); freeze(stats);
    const directions = M.capabilityDirections(record, stats);
    assert.equal(directions.find(item => item.id === key).metricId, id);
    assert.equal(JSON.stringify({ record, stats }), original);
    linkState(json(record));
    assert.deepEqual(json(App.facts().selectedCapabilityDirections), json(directions));
  }
});
test("implicit fallback and explicit missing metric selections retain the existing behavior", () => {
  const record = fixture(); delete record.views.capabilitySelections;
  const fallback = M.capabilityDirections(record);
  assert.equal(fallback.find(item => item.id === "strength").metricId, "fdsi");
  assert.equal(fallback.find(item => item.id === "speed").metricId, "srr");
  record.views.capabilitySelections = { strength: "fvp", reactive: "cmrj_rsi", speed: "sprint_fvp" };
  record.enabled.cmrj = false;
  for (const item of M.capabilityDirections(record).filter(item => item.id !== "endurance")) {
    assert.equal(item.metricId, record.views.capabilitySelections[item.id]);
    assert.equal(item.value, null); assert.equal(item.judgment, "待计算");
  }
});
test("narrow direction basis binds effective metric identities and selected jump protocol", () => {
  const record = fixture(), original = M.capabilityDirectionsBasis(record), measured = M.fingerprint(record);
  record.views.capabilitySelections.strength = "eur";
  assert.notEqual(M.capabilityDirectionsBasis(record), original); assert.equal(M.fingerprint(record), measured);
  record.views.fvpProtocol = "fvp_cmj";
  assert.equal(M.capabilityDirectionsBasis(record), M.capabilityDirectionsBasis({ ...record, views: { ...record.views, fvpProtocol: "fvp_sj" } }));
  record.views.capabilitySelections.strength = "fvp";
  for(const id of ["fvp_sj","fvp_cmj"]){record.enabled[id]=true;record.fvpConfig[id].distanceCm=33;record.data[id]=[0,20,40].map((load,i)=>({id:id+i,load,height:[33,27,22][i]}));}
  assert.notEqual(M.capabilityDirectionsBasis(record), M.capabilityDirectionsBasis({ ...record, views: { ...record.views, fvpProtocol: "fvp_sj" } }));
  const before = M.capabilityDirectionsBasis(record), beforeMeasurement = M.fingerprint(record);
  Object.assign(record.views, { fvp:false, radar:false, forceTime:false });
  assert.equal(M.capabilityDirectionsBasis(record), before); assert.equal(M.fingerprint(record), beforeMeasurement);
});
test("effective iDSI window is bound independently of display flags", () => {
  const record = fixture(), stats = M.stats(record), strength = stats.capabilityCards.find(card => card.id === "strength");
  strength.metrics.push({ id:"idsi", selectedVariant:"idsi_matched",value:.2 });
  const matched = M.capabilityDirectionsBasis(record, stats);
  strength.metrics.find(metric => metric.id === "idsi").selectedVariant = "idsi_fixed250";
  assert.notEqual(M.capabilityDirectionsBasis(record, stats), matched);
});
test("sprint optimum target distance already changes the global measurement fingerprint", () => {
  const record = fixture(), before = M.fingerprint(record), directionBasis = M.capabilityDirectionsBasis(record);
  record.sprintFvpAnalysis.targetDistanceM = 20;
  assert.notEqual(M.fingerprint(record), before);
  assert.equal(M.capabilityDirectionsBasis(record), directionBasis);
});

// Use actual App.ai, draft gates, apply, editor and status functions. The request
// transport, DOM and PDF page measurement are deterministic local mocks.
const snapshotStart = appSource.indexOf("  const snapshot = () =>"), snapshotEnd = appSource.indexOf("  function effectiveRecord(", snapshotStart);
const transitions = [], requests = [], nodes = {};
const element = id => nodes[id] ||= { textContent:"",innerHTML:"",innerText:"",className:"",classList:{ remove(){} },style:{},setAttribute(){},inert:false };
Object.assign(c, { AbortController, state: fixture(), library:{ evaluationProfiles:[] }, job:null,jobSequence:0,pendingAI:null,
  model:"synthetic-model", ui:{ sidebarCollapsed:false }, key:"", document:{ fonts:{ready:Promise.resolve()},activeElement:null,body:{style:{}},querySelector:()=>null },
  $:element, now:()=>"2026-10-10T12:00:00.000Z", persist:()=>{c.persisted++;}, persisted:0,
  configuredAI:async()=>({ model:"synthetic-model" }),saveEditor:()=>{},openSettings:()=>{},
  isNarrativeView:()=>true,isAIView:()=>true,renderAIStatus:()=>{},focusContentTitle:()=>{},
  matchMedia:()=>({matches:false}),confirm:()=>{c.confirmations++;return true;},confirmations:0,
  modal:()=>{c.modals++;},modals:0,toast:message=>{c.toasts.push(message);},toasts:[],
  changed:()=>{},safeAIError:error=>error.message,
  setAIStatus:(kind,title,detail)=>{c.status={kind,title,detail};transitions.push({kind,title,detail});},
  request:(_path,payload)=>{ requests.push(json(payload));return c.requestResult; },
});
c.RingsidePDF = { measureNarrative:()=>{c.measurements++;return 1;} }; c.measurements=0;
vm.runInContext(appSource.slice(snapshotStart,snapshotEnd) + appFunction("currentMatches","sampleRecord") +
  appFunction("renderNarrativeStatus","saveEditor") + appFunction("updateEditor","format") +
  appFunction("preview","safeAIError") + appFunction("reviewAIDraft","baseURL") + appFunction("ai","copyAIFacts") +
  "const AI={ai,preview,showAIDraft,applyAI,reviewAIDraft,renderNarrativeStatus,updateEditor,currentMatches,snapshot,capabilityDirectionsBasis};", c);
const AI = vm.runInContext("AI", c), response = { choices:[{message:{content:"合成测试：根据选中的能力指标安排训练，并在下一周期复测。"},finish_reason:"stop"}] };
function deferred() { let resolve; const promise = new Promise(done => {resolve=done;});return {promise,resolve}; }
function reset() {
  linkState(fixture()); c.state.narrative.text="原始人工正文"; c.state.narrative.html="<p>原始人工正文</p>";
  c.state.narrative.basis=App.recordBasis(); c.state.narrative.origin="manual";
  c.state.previousNarrative={text:"更早的正文"}; c.job=null;c.pendingAI=null;c.status=null;c.persisted=0;c.confirmations=0;c.modals=0;c.measurements=0;c.toasts=[];
  c.document.fonts.ready=Promise.resolve(); c.requestResult=Promise.resolve(response); requests.length=0;
}
async function until(predicate) { for (let i=0;i<30;i++) {if(predicate())return;await Promise.resolve();} assert.ok(predicate(),"mock did not reach awaited state"); }
async function asyncTest(name, run) { await run();passed++;checks.push(name);console.log("PASS " + name); }
async function main() {
  await asyncTest("actual AI request includes identical selected directions and preserves full capability analysis",async()=>{
    reset(); const facts=App.facts(); await AI.ai();
    const sent=JSON.parse(requests[0].messages[1].content.slice(requests[0].messages[1].content.indexOf("{")));
    assert.deepEqual(sent.selectedCapabilityDirections,json(facts.selectedCapabilityDirections));
    assert.deepEqual(sent.capabilityAnalysis,json(facts.capabilityAnalysis));
    assert.equal(c.status.kind,"ready");assert.equal(c.pendingAI.capabilityDirectionsBasis,AI.capabilityDirectionsBasis());
    assert.equal(c.state.narrative.text,"原始人工正文");
  });
  await asyncTest("changing selection during actual in-flight AI leaves original narratives and reports a visible error",async()=>{
    reset(); const wait=deferred();c.requestResult=wait.promise;const before=JSON.stringify([c.state.narrative,c.state.previousNarrative]);
    const running=AI.ai();await until(()=>requests.length===1);const identity=AI.snapshot();c.state.views.capabilitySelections.strength="eur";
    assert.equal(AI.currentMatches(identity),true,"identity gate must let catch report same-record basis changes");
    wait.resolve(response);await running;
    assert.equal(c.status.kind,"error");assert.match(c.status.detail,/能力分析依据已更新/);
    assert.equal(c.pendingAI,null);assert.equal(c.measurements,0);assert.equal(JSON.stringify([c.state.narrative,c.state.previousNarrative]),before);
  });
  await asyncTest("changing selection while fonts are loading rejects before PDF measurement or another request",async()=>{
    reset();const fonts=deferred();c.document.fonts.ready=fonts.promise;const running=AI.ai();await until(()=>requests.length===1);
    await Promise.resolve();await Promise.resolve();c.state.views.capabilitySelections.speed="sprint_fvp";
    fonts.resolve();await running;assert.equal(c.status.kind,"error");assert.equal(c.measurements,0);assert.equal(requests.length,1);assert.equal(c.pendingAI,null);
  });
  await asyncTest("ready draft review and direct show reject a changed selection",async()=>{
    for (const gate of ["reviewAIDraft","showAIDraft"]) {
      reset();await AI.ai();c.state.views.capabilitySelections.strength="eur";const modals=c.modals;AI[gate]();
      assert.equal(c.pendingAI,null,gate);assert.equal(c.status.kind,"error",gate);assert.equal(c.modals,modals,gate);assert.equal(c.state.narrative.text,"原始人工正文");
    }
  });
  await asyncTest("applying a stale ready draft refuses before replacement confirmation or persistence",async()=>{
    reset();await AI.ai();c.state.views.capabilitySelections.reactive="hop_rsi";c.state.narrative.revision++;
    const before=JSON.stringify([c.state.narrative,c.state.previousNarrative]);AI.applyAI();
    assert.match(c.toasts.at(-1),/能力分析依据已更新/);assert.equal(c.confirmations,0);assert.equal(c.persisted,0);
    assert.equal(JSON.stringify([c.state.narrative,c.state.previousNarrative]),before);
  });
  await asyncTest("pure chart view switches keep in-flight and ready drafts applicable",async()=>{
    reset();const wait=deferred();c.requestResult=wait.promise;const running=AI.ai();await until(()=>requests.length===1);
    Object.assign(c.state.views,{radar:false,forceTime:false,fvp:false});wait.resolve(response);await running;
    assert.equal(c.status.kind,"ready");AI.applyAI();assert.equal(c.persisted,1);assert.equal(c.status.kind,"applied");assert.equal(c.state.narrative.origin,"AI");
  });
  await asyncTest("applied new narrative persists its narrow basis and marks a later selection change for review",async()=>{
    reset();await AI.ai();AI.applyAI();const saved=json(c.state.narrative);
    assert.equal(saved.capabilityDirectionsBasis,AI.capabilityDirectionsBasis());
    assert.equal(M.normalizeRecord(json(c.state)).narrative.capabilityDirectionsBasis,saved.capabilityDirectionsBasis);
    c.state.views.capabilitySelections.strength="eur";AI.renderNarrativeStatus();assert.equal(nodes.interpState.textContent,"分析依据已更新 · 待复核");
  });
  await asyncTest("legacy narratives and age-only corrections retain the existing exception",async()=>{
    reset();const ageBasis=App.recordBasis();c.state.athlete.age=Number(c.state.athlete.age)+1;
    assert.equal(M.fingerprintMatchesExceptAge(ageBasis,c.state),true);AI.renderNarrativeStatus();assert.equal(nodes.interpState.textContent,"已填写");
    c.state.views.capabilitySelections.strength="eur";AI.renderNarrativeStatus();assert.equal(nodes.interpState.textContent,"已填写");
    reset();await AI.ai();AI.applyAI();const newBasis=c.state.narrative.capabilityDirectionsBasis;c.state.athlete.age=Number(c.state.athlete.age)+1;
    assert.equal(AI.capabilityDirectionsBasis(),newBasis);AI.renderNarrativeStatus();assert.equal(nodes.interpState.textContent,"AI稿");
  });
  await asyncTest("different-record identity still prevents in-flight output and suppresses stale catch errors",async()=>{
    reset();const wait=deferred();c.requestResult=wait.promise;const running=AI.ai();await until(()=>requests.length===1);
    const identity=AI.snapshot();c.state.recordId="different-synthetic-record";assert.equal(AI.currentMatches(identity),false);wait.resolve(response);await running;
    assert.equal(c.pendingAI,null);assert.equal(c.status.kind,"running");assert.equal(c.state.narrative.text,"原始人工正文");
  });
  await asyncTest("manual editing refreshes new selection binding while legacy narratives stay compatible",async()=>{
    reset();await AI.ai();AI.applyAI();c.state.views.capabilitySelections.strength="eur";nodes.interpEditor.innerHTML="<p>重新审阅后的人工正文</p>";nodes.interpEditor.innerText="重新审阅后的人工正文";
    AI.updateEditor();assert.equal(c.state.narrative.capabilityDirectionsBasis,AI.capabilityDirectionsBasis());assert.equal(c.state.narrative.origin,"manual");
    reset();AI.updateEditor();assert.equal(c.state.narrative.capabilityDirectionsBasis,undefined);
  });
  console.log(`${passed} capability direction model checks passed`);
  fs.writeFileSync(path.join(out,"ai-mock-transitions.json"),JSON.stringify({synthetic:true,externalAIRequested:false,transitions},null,2));
  fs.writeFileSync(path.join(out, "model-results.json"), JSON.stringify({ checks, passed, synthetic: true, externalAIRequested: false }, null, 2));
}
main().catch(error=>{fs.writeFileSync(path.join(out,"failure.json"),JSON.stringify({message:error.message,stack:error.stack,checks,passed},null,2));console.error(error);process.exitCode=1;});
