"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const {context, createFixture} = require("./helpers/longitudinal-fixture.cjs");
const c = context(), copy = value => JSON.parse(JSON.stringify(value));
for (const name of ["longitudinal-views", "longitudinal-store", "longitudinal-controller"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const V = c.RingsideLongitudinalViews, S = c.RingsideLongitudinalStore, tests = [];
const test = (name, run) => tests.push([name, run]);
test("display patches preserve scroll, disclosures, unknown extensions and other figures", () => {
  const input = {reportScroll:319, detailOpen:{screenDetail:true}, future:{value:7}, charts:{imtp:{options:{yAxis:"force"}, futureChart:true}}}, before = JSON.stringify(input);
  const result = V.patch(input, "fvp_sj:profile", {recordIds:["r2"], options:{fv:false}, metrics:{F0:false}}, ["r1", "r2"]);
  assert.equal(JSON.stringify(input), before); assert.deepEqual(copy(result.future), {value:7});
  assert.equal(result.reportScroll, 319); assert.equal(result.detailOpen.screenDetail, true); assert.equal(result.charts.imtp.futureChart, true);
  assert.equal(result.charts["fvp_sj:profile"].metrics.F0, false);
});
test("partial option and metric edits retain prior choices", () => {
  const one = V.patch({}, "sprint_fvp:profile", {options:{fv:false, pv:true}, metrics:{F0:false}}, ["r1", "r2"]);
  const two = V.patch(one, "sprint_fvp:profile", {options:{confidence:true}, metrics:{V0:false}}, ["r1", "r2"]);
  assert.deepEqual(copy(two.charts["sprint_fvp:profile"].options), {fv:false, pv:true, confidence:true});
  assert.deepEqual(copy(two.charts["sprint_fvp:profile"].metrics), {F0:false, V0:false});
});
test("each figure defaults to all dates and keeps its own selected record IDs", () => {
  const ids = ["r3", "r1", "r2"], state = V.patch({}, "risk", {recordIds:["r2", "r3"]}, ids);
  assert.deepEqual(copy(V.selected(state, "risk", ids)), ["r3", "r2"]);
  assert.deepEqual(copy(V.selected(state, "overview", ids)), ids);
  const one = V.patch(state, "overview", {recordIds:["r1"]}, ids);
  assert.deepEqual(copy(V.selected(one, "overview", ids)), ["r1"]);
  assert.deepEqual(copy(V.selected(one, "risk", ids)), ["r3", "r2"]);
});
test("same-day record identity never merges dates or uses titles as identity", () => {
  const periods = [{id:"same-day-a", date:"2026-10-01"}, {id:"same-day-b", date:"2026-10-01"}];
  const state = V.patch({}, "imtp", {recordIds:[periods[1].id]}, periods.map(p => p.id));
  assert.deepEqual(copy(V.selected(state, "imtp", periods.map(p => p.id))), ["same-day-b"]);
});
test("empty, duplicate, foreign and malformed date selections are rejected", () => {
  for (const recordIds of [[], ["r1", "r1"], ["other"], "r1", [null]]) assert.throws(() => V.patch({}, "risk", {recordIds}, ["r1", "r2"]));
});
test("only display controls may be changed through the display patch interface", () => {
  for (const options of [{angle:30}, {targetDistanceM:20}, {deltaForcePct:5}, {fv:1}, {range:"invalid"}, {yAxis:"raw"}, {selected:["bench", "bench"]}]) assert.throws(() => V.patch({}, "x", {options}, ["r1", "r2"]));
  assert.throws(() => V.patch({}, "x", {narrative:{text:"changed"}}, ["r1", "r2"]));
});
test("unsafe nested objects and non-JSON settings cannot enter display storage", () => {
  for (const input of [JSON.parse('{"charts":{"__proto__":{}}}'), {charts:{x:{options:{pv:NaN}}}}, {charts:{x:{metrics:{F0:"false"}}}}, {unknown:undefined}]) assert.throws(() => V.normalize(input, ["r1", "r2"]));
  assert.throws(() => V.patch({}, "__proto__", {options:{fv:true}}, ["r1", "r2"]));
});
test("normalized stored future display fields survive round trips", () => {
  const value = {future:7, charts:{"generic:custom:metric":{futureChart:{version:2}, options:{futureOption:"value"}, metrics:{"metric-with-unicode-力量":true}}}};
  assert.deepEqual(copy(V.normalize(value, ["r1", "r2"])), value);
});
async function fixture() {
  const f = createFixture(c, 3); f.records.forEach(record => { record.evaluationProfileId = f.profile.id; });
  const library = {schema:3, kind:"athlete-library", version:"2.24.4", catalog:f.catalog, evaluationProfiles:[f.profile], defaultEvaluationProfileId:f.profile.id,
    athletes:[{id:f.athleteId, name:f.records[0].athlete.name, profile:copy(f.records[0].athlete), records:f.records}], activeAthleteId:f.athleteId, activeRecordId:f.records.at(-1).recordId};
  let state = f.records.at(-1), deferred = false, calls = [], savedDocuments = [], callback, renderedViews, controller;
  const errors = [], elements = new Map();
  c.document = {addEventListener(){}, activeElement:null, getElementById(id) {
    if (["recordChoices", "recordChoiceLabel"].includes(id)) return null;
    if (!elements.has(id)) elements.set(id, {dataset:{}, querySelector:()=>({}), querySelectorAll:()=>[]});
    return elements.get(id);
  }};
  c.RingsideLongitudinalView = {render(model, options){renderedViews = copy(options.views);return {};}, mount(container, model, options){callback = options.onChange;}};
  const host = {state:()=>state, library:()=>library, repository:()=>({loadRecord:async id => copy(f.records.find(r => r.recordId === id))}), saveEditor(){}, cancelAI(){}, remember(){}, render(){}, renderDisplay(){}, error:message=>errors.push(message),
    switchRecord:async (owner, record)=>{state=record;return true;}, save:(options={})=>{const pending=controller.pendingDisplaySave();if(pending&&!options.longitudinalDisplay)return pending.then(()=>host.save(options));const snapshot=copy(library.longitudinalReports || []);if(!deferred){savedDocuments=snapshot;return Promise.resolve(true);}return new Promise(resolve=>calls.push({snapshot, finish(success){if(success)savedDocuments=snapshot;resolve(success);}}));}};
  controller = c.RingsideLongitudinalController.create(host);
  assert.equal(await controller.select(f.records.map(r=>r.recordId)), true);
  return {f, library, controller, host, errors, elements, startDeferred(){deferred=true;}, calls, saved:()=>savedDocuments, callback:()=>callback, rendered:()=>renderedViews};
}
test("controller passes isolated document views and a change callback to the view", async () => {
  const f = await fixture();f.controller.render();assert.equal(typeof f.callback(), "function");
  assert.deepEqual(f.rendered(), copy(f.controller.document().views));
});
test("view changes preserve the entire source library records, model, AI facts, basis and narrative", async () => {
  const f = await fixture(), c = f.controller, before = {records:JSON.stringify(f.library.athletes), model:JSON.stringify(c.model()), basis:c.basis(), facts:JSON.stringify(c.facts()), narrative:JSON.stringify(c.narrative()), selection:JSON.stringify(c.selection())};
  assert.equal(await c.updateChartView("imtp", {recordIds:[f.f.records[1].recordId], options:{yAxis:"force"}}), true);
  assert.equal(JSON.stringify(f.library.athletes), before.records);assert.equal(JSON.stringify(c.model()), before.model);
  assert.equal(c.basis(), before.basis);assert.equal(JSON.stringify(c.facts()), before.facts);assert.equal(JSON.stringify(c.narrative()), before.narrative);assert.equal(JSON.stringify(c.selection()), before.selection);
  assert.equal(f.saved()[0].views.charts.imtp.options.yAxis, "force");
});
test("ordinary UI capture cannot erase saved chart settings or unknown view fields", async () => {
  const f = await fixture(), c = f.controller;
  c.setViews({future:{mode:2}});await c.updateChartView("imtp", {options:{yAxis:"force"}});
  c.setViews({reportScroll:319, detailOpen:{screenDetail:true}});
  assert.equal(c.document().views.charts.imtp.options.yAxis, "force");assert.equal(c.document().views.future.mode, 2);
});
test("failed saves restore the prior chart choices and retain independent narrative and disclosure edits", async () => {
  const f = await fixture(), c = f.controller;await c.updateChartView("imtp", {options:{yAxis:"force"}});f.startDeferred();
  const task = c.updateChartView("imtp", {options:{yAxis:"percent"}});
  assert.equal(c.isLoading(), true);c.setNarrative({...copy(c.narrative()), text:"New independent coach text", html:"<p>New independent coach text</p>"});c.setViews({detailOpen:{screenDetail:false}});
  f.calls[0].finish(false);assert.equal(await task, false);
  assert.equal(c.document().views.charts.imtp.options.yAxis, "force");assert.equal(c.document().views.detailOpen.screenDetail, false);
  assert.equal(c.narrative().text, "New independent coach text");assert.equal(c.isLoading(), false);
});
test("rapid date and layer edits combine, and an older failure never rolls back a newer successful change", async () => {
  const f = await fixture(), c = f.controller;f.startDeferred();
  const a = c.updateChartView("risk", {recordIds:[f.f.records[0].recordId]});
  const b = c.updateChartView("imtp", {options:{yAxis:"force"}});
  f.calls[0].finish(false);await a;assert.equal(c.document().views.charts.imtp.options.yAxis, "force");
  f.calls[1].finish(true);assert.equal(await b, true);
  assert.deepEqual(copy(c.document().views.charts.risk.recordIds), [f.f.records[0].recordId]);assert.equal(f.saved()[0].views.charts.imtp.options.yAxis, "force");
});
test("a later failed edit rolls back to the last successful pending edit", async () => {
  const f = await fixture(), c = f.controller;f.startDeferred();
  const a = c.updateChartView("imtp", {options:{yAxis:"force"}}), b = c.updateChartView("imtp", {options:{yAxis:"percent"}});
  f.calls[0].finish(true);await a;f.calls[1].finish(false);await b;
  assert.equal(c.document().views.charts.imtp.options.yAxis, "force");
});
test("all failed pending edits restore the original absent chart configuration", async () => {
  const f = await fixture(), c = f.controller;f.startDeferred();
  const a = c.updateChartView("imtp", {options:{yAxis:"force"}}), b = c.updateChartView("risk", {recordIds:[f.f.records[1].recordId]});
  f.calls[0].finish(false);await a;f.calls[1].finish(false);await b;assert.equal(c.document().views.charts, undefined);
});
test("a rolled-back date selection can be retried and exported after a successful save", async () => {
  const f = await fixture(), c = f.controller;f.startDeferred();
  const delta = {recordIds:[f.f.records[2].recordId]}, first = c.updateChartView("risk", delta);
  f.calls[0].finish(false);assert.equal(await first, false);assert.equal(c.document().views.charts, undefined);
  const retry = c.updateChartView("risk", delta);f.calls[1].finish(true);assert.equal(await retry, true);
  assert.deepEqual(copy(c.payload().library.longitudinalReports[0].views.charts.risk.recordIds), delta.recordIds);
});
test("rejected empty-date toggles do not invalidate a pending save rollback", async () => {
  const f = await fixture(), c = f.controller;f.startDeferred();
  const a = c.updateChartView("risk", {recordIds:[f.f.records[1].recordId]});
  assert.equal(await c.updateChartView("risk", {recordIds:[]}), false);f.calls[0].finish(false);await a;assert.equal(c.document().views.charts, undefined);
});
test("a completed save from a cleared comparison cannot recreate its active document", async () => {
  const f = await fixture(), c = f.controller;f.startDeferred();const task = c.updateChartView("imtp", {options:{yAxis:"force"}});c.clear();f.calls[0].finish(false);await task;
  assert.equal(c.active(), false);assert.equal(c.document(), null);assert.equal(c.isLoading(), false);
  assert.equal(c.pendingDisplaySave(), null);
});
test("ordinary saves capture only rolled-back charts while retaining later narrative and disclosure edits", async () => {
  const f=await fixture(), c=f.controller;await c.updateChartView("imtp",{options:{yAxis:"percent"}});f.startDeferred();
  const change=c.updateChartView("imtp",{options:{yAxis:"force"}}), ordinary=f.host.save();
  c.setNarrative({...copy(c.narrative()),text:"Later legitimate narrative",html:"<p>Later legitimate narrative</p>"});c.setViews({detailOpen:{screenDetail:false}});
  assert.equal(f.calls.length,1,"ordinary persistence must not snapshot uncommitted choices");
  f.calls[0].finish(false);assert.equal(await change,false);await Promise.resolve();
  assert.equal(f.calls.length,2);const snapshot=f.calls[1].snapshot[0];
  assert.equal(snapshot.views.charts.imtp.options.yAxis,"percent");assert.equal(snapshot.narrative.text,"Later legitimate narrative");assert.equal(snapshot.views.detailOpen.screenDetail,false);
  f.calls[1].finish(true);assert.equal(await ordinary,true);assert.deepEqual(f.saved()[0],copy(c.document()));assert.equal(c.pendingDisplaySave(),null);
});
test("ordinary saves wait for all rapid display changes and preserve the final successful choice", async () => {
  const f=await fixture(), c=f.controller;f.startDeferred();
  const first=c.updateChartView("risk",{recordIds:[f.f.records[0].recordId]}), ordinary=f.host.save(), second=c.updateChartView("imtp",{options:{yAxis:"force"}});
  assert.equal(f.calls.length,2);f.calls[0].finish(false);await first;assert.equal(f.calls.length,2);assert.ok(c.pendingDisplaySave());
  f.calls[1].finish(true);await second;await Promise.resolve();assert.equal(f.calls.length,3);
  assert.deepEqual(f.calls[2].snapshot[0].views,copy(c.document().views));f.calls[2].finish(true);await ordinary;assert.equal(c.pendingDisplaySave(),null);
});
test("multiple failed display saves release ordinary persistence with the original chart configuration", async () => {
  const f=await fixture(), c=f.controller;f.startDeferred();
  const first=c.updateChartView("risk",{recordIds:[f.f.records[0].recordId]}), second=c.updateChartView("imtp",{options:{yAxis:"force"}}), ordinary=f.host.save();
  f.calls[0].finish(false);await first;assert.equal(f.calls.length,2);f.calls[1].finish(false);await second;await Promise.resolve();
  assert.equal(f.calls[2].snapshot[0].views.charts,undefined);f.calls[2].finish(true);await ordinary;assert.equal(c.pendingDisplaySave(),null);
});
test("clearing an owner releases waiting ordinary saves after its in-flight display write settles", async () => {
  const f=await fixture(), c=f.controller;f.startDeferred();const change=c.updateChartView("imtp",{options:{yAxis:"force"}}), ordinary=f.host.save();c.clear();
  assert.ok(c.pendingDisplaySave());f.calls[0].finish(false);await change;await Promise.resolve();assert.equal(f.calls.length,2);f.calls[1].finish(true);await ordinary;
  assert.equal(c.document(),null);assert.equal(c.pendingDisplaySave(),null);assert.equal(c.isLoading(),false);
});
test("selected-record export retains all original records and independent chart choices", async () => {
  const f = await fixture(), c = f.controller;await c.updateChartView("risk", {recordIds:[f.f.records[1].recordId]});
  const payload=c.payload();assert.equal(payload.library.athletes[0].records.length,3);assert.equal(payload.selection.recordIds.length,3);
  assert.deepEqual(copy(payload.library.longitudinalReports[0].views.charts.risk.recordIds),[f.f.records[1].recordId]);
  assert.deepEqual(copy(payload.library.athletes[0].records).sort((a,b)=>a.recordId.localeCompare(b.recordId)),copy(f.f.records).sort((a,b)=>a.recordId.localeCompare(b.recordId)));
});
test("import remaps every per-figure record ID including archived document versions", async () => {
  const f=await fixture(), c=f.controller;await c.updateChartView("risk",{recordIds:[f.f.records[1].recordId]});
  const doc=copy(c.document()), recordMap=Object.fromEntries(f.f.records.map((r,i)=>[r.recordId,"mapped-"+i])), mapped=S.remap({...doc,importedVersions:[doc]},{recordMap});
  assert.deepEqual(copy(mapped.views.charts.risk.recordIds),["mapped-1"]);assert.deepEqual(copy(mapped.importedVersions[0].views.charts.risk.recordIds),["mapped-1"]);
});
test("comparison analysis changes model facts and basis while display changes and source records stay independent", async () => {
  const f=await fixture(), controller=f.controller, original=JSON.stringify(f.library.athletes), originalBasis=controller.basis(), originalFacts=JSON.stringify(controller.facts());
  assert.equal(await controller.updateChartView("fvp_sj:profile",{analysis:{angle:30}}),true);
  assert.notEqual(controller.basis(),originalBasis);assert.notEqual(JSON.stringify(controller.facts()),originalFacts);assert.equal(controller.document().basis,controller.basis());
  const changedBasis=controller.basis(), changedModel=JSON.stringify(controller.model());
  await controller.updateChartView("fvp_sj:profile",{recordIds:[f.f.records[0].recordId],options:{fv:false}});
  assert.equal(controller.basis(),changedBasis);assert.equal(JSON.stringify(controller.model()),changedModel);assert.equal(JSON.stringify(f.library.athletes),original);
  const exported=controller.payload();assert.equal(exported.library.longitudinalReports[0].views.charts["fvp_sj:profile"].analysis.angle,30);
  assert.deepEqual(copy(exported.library.athletes[0].records).sort((a,b)=>a.recordId.localeCompare(b.recordId)),copy(f.f.records).sort((a,b)=>a.recordId.localeCompare(b.recordId)));
  await controller.refresh();assert.equal(controller.basis(),changedBasis);assert.equal(JSON.stringify(controller.facts()),JSON.stringify(c.RingsideLongitudinal.facts(controller.model())));
  assert.deepEqual(copy(controller.document().views.charts["fvp_sj:profile"].recordIds),[f.f.records[0].recordId]);
  await controller.updateChartView("fvp_sj:profile",{analysis:{angle:null}});assert.equal(controller.basis(),originalBasis);assert.equal(JSON.stringify(controller.facts()),originalFacts);
});
test("failed analysis writes restore model basis and absent settings without losing later narrative", async () => {
  const f=await fixture(), controller=f.controller, basis=controller.basis(), facts=JSON.stringify(controller.facts()), original=JSON.stringify(f.library.athletes);f.startDeferred();
  const task=controller.updateChartView("sprint_fvp:profile",{analysis:{targetDistanceM:20}});assert.notEqual(controller.basis(),basis);
  controller.setNarrative({...copy(controller.narrative()),text:"Later preserved text",html:"<p>Later preserved text</p>"});controller.setViews({detailOpen:{screenDetail:false}});
  f.calls[0].finish(false);assert.equal(await task,false);assert.equal(controller.basis(),basis);assert.equal(controller.document().basis,basis);assert.equal(JSON.stringify(controller.facts()),facts);
  assert.equal(controller.document().views.charts,undefined);assert.equal(controller.narrative().text,"Later preserved text");assert.equal(controller.document().views.detailOpen.screenDetail,false);assert.equal(JSON.stringify(f.library.athletes),original);assert.equal(controller.pendingDisplaySave(),null);
});
test("rapid mixed analysis failures restore the last saved common conditions and keep chart dates", async () => {
  const f=await fixture(), controller=f.controller;await controller.updateChartView("fvp_sj:profile",{recordIds:[f.f.records[1].recordId]});f.startDeferred();
  const first=controller.updateChartView("fvp_sj:profile",{analysis:{angle:30}}), changed=controller.basis();
  const second=controller.updateChartView("fvp_sj:elasticity",{analysis:{deltaForcePct:5}});assert.notEqual(controller.basis(),changed);
  f.calls[0].finish(true);await first;f.calls[1].finish(false);await second;
  assert.equal(controller.basis(),changed);assert.equal(controller.document().basis,changed);assert.equal(controller.document().views.charts["fvp_sj:profile"].analysis.angle,30);assert.equal(controller.document().views.charts["fvp_sj:elasticity"],undefined);
  assert.deepEqual(copy(controller.document().views.charts["fvp_sj:profile"].recordIds),[f.f.records[1].recordId]);assert.equal(controller.model().periods[0].record.fvpAnalysis.fvp_sj.deltaForcePct,f.f.records[0].fvpAnalysis.fvp_sj.deltaForcePct);
});
test("invalid comparison conditions are rejected before model document or source data changes", async () => {
  const f=await fixture(), controller=f.controller, before={model:JSON.stringify(controller.model()),document:JSON.stringify(controller.document()),records:JSON.stringify(f.library.athletes)};
  assert.equal(await controller.updateChartView("sprint_fvp:profile",{analysis:{targetDistanceM:0}}),false);assert.equal(await controller.updateChartView("fvp_sj:elasticity",{analysis:{deltaForcePct:-100}}),false);
  assert.equal(JSON.stringify(controller.model()),before.model);assert.equal(JSON.stringify(controller.document()),before.document);assert.equal(JSON.stringify(f.library.athletes),before.records);assert.equal(f.errors.length,2);
});
(async()=>{for(const [name,run]of tests){await run();console.log("PASS "+name);}console.log(tests.length+" longitudinal display state checks passed");})().catch(error=>{console.error(error);process.exitCode=1;});
