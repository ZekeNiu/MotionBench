"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const context = vm.createContext({ console }); context.window = context;
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-team-selection.js"), "utf8"), context);
const Selection = context.RingsideTeamSelection, copy = value => JSON.parse(JSON.stringify(value));
const window = { kind: "custom", from: "2026-11-01", to: "2026-11-05" };
const record = (recordId, date, extra = {}) => ({ recordId, athlete: { date }, ...extra });
let passed = 0, failed = 0;
function test(name, run) { try { run(); passed++; console.log("PASS " + name); } catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); } }
test("selection uses inclusive date endpoints and preserves the source roster", () => {
  const owner = { records: [record("before", "2026-10-31"), record("first", "2026-11-01"), record("last", "2026-11-05"), record("after", "2026-11-06")] }, before = JSON.stringify(owner);
  assert.deepEqual(copy(Selection.candidates(owner, window).map(item => item.recordId)), ["last", "first"]); assert.equal(JSON.stringify(owner), before);
});
test("unique latest record is preselected while older records stay selectable", () => {
  const owner = { records: [record("old", "2026-11-01"), record("latest", "2026-11-05")] }, result = Selection.resolveSelection(owner, window);
  assert.equal(result.recordId, "latest"); assert.equal(result.ambiguous, false); assert.equal(result.records.length, 2);
});
test("same latest date requires an explicit choice, not ID or creation ordering", () => {
  const owner = { records: [record("z", "2026-11-05", { created: "2026-11-05T10:00:00Z" }), record("a", "2026-11-05", { created: "2026-11-05T11:00:00Z" })] };
  const result = Selection.resolveSelection(owner, window); assert.equal(result.recordId, ""); assert.equal(result.ambiguous, true);
  assert.equal(Selection.resolveSelection(owner, window, "z").recordId, "z"); assert.equal(Selection.resolveSelection(owner, window, "z").ambiguous, false);
});
test("an explicitly selected record remains fixed after a newer record appears", () => {
  const owner = { records: [record("chosen", "2026-11-01"), record("newer", "2026-11-05")] };
  assert.equal(Selection.resolveSelection(owner, window, "chosen").recordId, "chosen");
});
test("ties on older dates do not block a unique latest date", () => {
  const owner = { records: [record("older-a", "2026-11-01"), record("older-b", "2026-11-01"), record("latest", "2026-11-05")] };
  assert.equal(Selection.resolveSelection(owner, window).recordId, "latest");
});
test("missing people and people without an in-range record remain missing", () => {
  for (const owner of [null, { records: [] }, { records: [record("old", "2026-10-31")] }]) {
    const result = Selection.resolveSelection(owner, window); assert.equal(result.recordId, ""); assert.equal(result.records.length, 0); assert.equal(result.ambiguous, false);
  }
});
test("date range changes release an out-of-range prior selection", () => {
  const owner = { records: [record("old", "2026-11-01"), record("new", "2026-11-05")] };
  assert.equal(Selection.resolveSelection(owner, { ...window, from: "2026-11-02" }, "old").recordId, "new");
});
test("empty and one-sided dates expose all matching history while reversed dates remain invalid", () => {
  const owner = {records:[record("old","2026-10-01"),record("a","2026-11-01"),record("later","2026-12-01")]};
  for(const range of [null,{}, {from:"",to:""}])assert.equal(Selection.candidates(owner,range).length,3);
  assert.deepEqual(copy(Selection.candidates(owner,{from:"2026-11-01"}).map(r=>r.recordId)),["later","a"]);
  assert.deepEqual(copy(Selection.candidates(owner,{to:"2026-11-01"}).map(r=>r.recordId)),["a","old"]);
  for(const range of [{from:"2026-11-05",to:"2026-11-01"},{from:"bad"}])assert.equal(Selection.candidates(owner,range).length,0);
});
test("archived and recycle-bin records cannot be silently preselected", () => {
  const owner = { records: [record("valid", "2026-11-01"), record("archived", "2026-11-04", { archived: true }), record("trash", "2026-11-05", { deletedAt: "2026-11-05" })] };
  assert.equal(Selection.resolveSelection(owner, window).recordId, "valid");
});
test("candidate eligibility agrees with the model for sample and deleted flags", () => {
  const owner = { records: [record("valid", "2026-11-01"), record("demo", "2026-11-05", { demo: true }), record("sample", "2026-11-05", { sample: true }), record("deleted", "2026-11-05", { deleted: true })] };
  const result = Selection.resolveSelection(owner, window); assert.equal(result.recordId, "valid"); assert.equal(result.ambiguous, false);
});
test("all members remain available and a late-listed home team appears before other grouped teams", () => {
  const athletes = Array.from({ length: 158 }, (_, i) => ({ id: "person-" + i, name: "合成成员" + i, groupId: i < 128 ? "other" : "home" }));
  const before = JSON.stringify(athletes), groups = [{ id: "other", name: "其他队" }, { id: "home", name: "本队" }];
  const output = Selection.memberGroups(athletes, groups, "home");
  assert.deepEqual(copy(output.map(group => [group.id, group.people.length, group.own])), [["home", 30, true], ["other", 128, false]]);
  assert.equal(output.flatMap(group => group.people).length, 158); assert.equal(output[0].people[0].id, "person-128"); assert.equal(JSON.stringify(athletes), before);
});
test("search only filters grouped display and preserves original roster order and duplicate names", () => {
  const athletes = [{ id: "a-123456", name: "同名", groupId: "a" }, { id: "b-123456", name: "同名", groupId: "b" }, { id: "c", name: "其他", groupId: "" }], before = JSON.stringify(athletes);
  const groups = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }];
  assert.deepEqual(copy(Selection.memberGroups(athletes, groups, "b", "同名").flatMap(group => group.people.map(a => a.id))), ["b-123456", "a-123456"]);
  assert.deepEqual(copy(Selection.memberGroups(athletes, groups, "b", "a-123456").flatMap(group => group.people.map(a => a.id))), ["a-123456"]);
  assert.equal(Selection.memberGroups(athletes, groups, "b").at(-1).id, ""); assert.equal(JSON.stringify(athletes), before);
});

context.document = { activeElement: null, createElement() { throw Error("The embedded team selector must not create a modal"); } };
context.RingsideLongitudinalStore = { validDate: value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(overrides = {}) {
  const library = { groups: [{ id: "a", name: "甲队" }, { id: "b", name: "乙队" }], defaultEvaluationProfileId: "p", evaluationProfiles: [{ id: "p", name: "方案" }], athletes: [
    { id: "a-123456", name: "同名", groupId: "a", records: [record("ra", "2026-11-01"), record("ra-new", "2026-11-05")] },
    { id: "b-123456", name: "同名", groupId: "b", records: [record("rb", "2026-11-01")] },
    { id: "missing", name: "未测", groupId: "a", records: [] }
  ] };
  const controls = { cancel: {}, search: {}, form: {}, content: { scrollTop: 0 },
    fields: Object.fromEntries(["groupId", "from", "to", "mode", "profileId", "title"].map(key => [key, { dataset: { teamField: key }, value: "" }])),
    people: Object.fromEntries(library.athletes.map(a => [a.id, { dataset: { teamPerson: a.id }, checked: true }])),
    records: Object.fromEntries(library.athletes.map(a => [a.id, { dataset: { teamRecord: a.id }, value: "" }])),
    remove: Object.fromEntries(library.athletes.map(a => [a.id, { dataset: { teamRemove: a.id } }])) };
  const node = { innerHTML: "", contains: () => false,
    querySelector(selector) { return selector === "form" ? controls.form : selector === "[data-team-search]" ? controls.search : selector === ".team-selection-content" ? controls.content : null; },
    querySelectorAll(selector) { return selector === "[data-team-cancel]" ? [controls.cancel] : selector === "[data-team-field]" ? Object.values(controls.fields) : selector === "[data-team-person]" ? Object.values(controls.people) : selector === "[data-team-record]" ? Object.values(controls.records) : selector === "[data-team-remove]" ? Object.values(controls.remove) : []; } };
  const calls = { selected: [], applied: 0, cancelled: 0 };
  const api = Selection.create({ library: () => library, element: () => node,
    beforeOpen() { throw Error("The host owns its save-before-open barrier"); },
    select: async (value, options) => { calls.selected.push({ value, options }); return true; },
    onApplied: () => { calls.applied++; }, onCancel: () => { calls.cancelled++; }, ...overrides });
  return { api, node, controls, library, calls };
}
const configuration = extra => ({ groupId: "a", title: "", participants: [{ athleteId: "a-123456", recordId: "ra" }, { athleteId: "missing", recordId: "" }], window: { ...window }, mode: "best", profileId: "p", ...extra });
async function asyncTest(name, run) { try { await run(); passed++; console.log("PASS " + name); } catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); } }
(async () => {
  await asyncTest("open mounts in the main host with complete identifiers and a visible validation status", async () => {
    const { api, node } = harness(); assert.equal(await api.open(), true);
    assert.match(node.innerHTML, /<form novalidate class="team-selection-form"/); assert.doesNotMatch(node.innerHTML, /<dialog|modal-head|modal-foot/);
    assert.match(node.innerHTML, /data-team-selection-error/); assert.match(node.innerHTML, /请至少选择一名运动员/);
    assert.match(node.innerHTML, /编号 a-123456/); assert.match(node.innerHTML, /编号 b-123456/); assert.equal(api.isOpen(), true);
    assert.deepEqual(copy(api.desktopCloseStatus()), { busy: false, dirty: true }); api.cancel(); assert.equal(node.innerHTML, "");
  });
  await asyncTest("search and unchecking a member preserve fixed records and remaining row order", async () => {
    const { api, controls, node } = harness(), input = configuration(), before = JSON.stringify(input); await api.open(input);
    const opened=copy(api.state()); controls.search.oninput({ target: { value: "乙" } }); assert.deepEqual(copy(api.state()), opened);
    controls.search.oninput({ target: { value: "" } });
    const order = ["a-123456", "missing", "b-123456"].map(id => node.innerHTML.indexOf('data-team-person="' + id + '"'));
    controls.people["a-123456"].checked = false; controls.people["a-123456"].onchange();
    assert.deepEqual(copy(api.state().participants), [{ athleteId: "missing", recordId: "" }]);
    const nextOrder = ["a-123456", "missing", "b-123456"].map(id => node.innerHTML.indexOf('data-team-person="' + id + '"'));
    assert.ok(order[0] < order[1] && order[1] < order[2] && nextOrder[0] < nextOrder[1] && nextOrder[1] < nextOrder[2]);
    assert.equal(JSON.stringify(input), before);
  });
  await asyncTest("editing keeps report identity, explicit old record, representative mode and profile", async () => {
    const { api, calls } = harness(); await api.open(configuration({ mode: "mean", title: "自定名称", titleAuto:false, profileId: "" }), { reportId: "existing-report" });
    assert.equal(await api.apply(), true); assert.equal(calls.selected[0].options.reportId, "existing-report");
    assert.equal(calls.selected[0].value.participants[0].recordId, "ra"); assert.equal(calls.selected[0].value.mode, "mean"); assert.equal(calls.selected[0].value.profileId, "");
    assert.equal(calls.selected[0].value.reportTitle, "自定名称"); assert.equal(calls.applied, 1); assert.equal(calls.cancelled, 0); assert.equal(api.isOpen(), false);
  });
  await asyncTest("changing dates still resets representatives and adding a member uses that date range", async () => {
    const { api, controls } = harness(); await api.open(configuration());
    controls.fields.from.value = "2026-11-02"; controls.fields.from.onchange();
    assert.equal(api.state().participants[0].recordId, "ra-new");
    controls.people["b-123456"].checked = true; controls.people["b-123456"].onchange();
    assert.equal(api.state().participants.find(p => p.athleteId === "b-123456").recordId, "");
  });
  await asyncTest("empty dates allow submission while ambiguous records need a choice and unmeasured members stay valid", async () => {
    const { api, calls, library } = harness(); await api.open(configuration({ window: { kind: "custom", from: "", to: "" } }));
    assert.equal(await api.apply(), true); assert.equal(calls.selected.length, 1);
    library.athletes[0].records.push(record("same-day", "2026-11-05")); await api.open(configuration({ participants: [{ athleteId: "a-123456", recordId: "" }] }));
    assert.equal(await api.apply(), false); assert.equal(calls.selected.length, 1);
    await api.open(configuration({ participants: [{ athleteId: "missing", recordId: "" }] })); assert.equal(await api.apply(), true);
    assert.deepEqual(copy(calls.selected.at(-1).value.participants), [{ athleteId: "missing", recordId: "" }]);
  });
  await asyncTest("root cancellation invalidates a busy select without invoking callbacks or clearing a new draft", async () => {
    const wait = deferred(); let guard, applied = 0, cancelled = 0;
    const { api, node } = harness({ select: (_value, options) => { guard = options.isCurrent; return wait.promise; }, onApplied: () => { applied++; }, onCancel: () => { cancelled++; } });
    await api.open(configuration()); const pending = api.apply(); assert.equal(api.desktopCloseStatus().busy, true); assert.equal(guard(), true);
    assert.equal(api.cancel(), true); assert.equal(guard(), false); assert.equal(node.innerHTML, "");
    await api.open(configuration({ title: "新草稿" })); wait.resolve(true); assert.equal(await pending, false);
    assert.equal(api.state().title, "新草稿"); assert.equal(applied, 0); assert.equal(cancelled, 0); assert.equal(api.desktopCloseStatus().busy, false);
  });
  await asyncTest("a stale rejected request cannot change a newer request's busy state or error", async () => {
    const first = deferred(), second = deferred(); let count = 0;
    const { api, node } = harness({ select: () => ++count === 1 ? first.promise : second.promise });
    await api.open(configuration()); const old = api.apply(); await api.open(configuration({ title: "第二草稿" })); const current = api.apply();
    first.reject(Error("stale failure must stay hidden")); assert.equal(await old, false); assert.equal(api.desktopCloseStatus().busy, true); assert.doesNotMatch(node.innerHTML, /stale failure/);
    second.resolve(false); assert.equal(await current, false); assert.equal(api.desktopCloseStatus().busy, false); assert.equal(api.state().title, "第二草稿"); assert.match(node.innerHTML, /报告尚未生成/);
  });
  await asyncTest("awaiting onApplied never clears a draft opened during the host transition", async () => {
    const transition = deferred(), entered = deferred();
    const { api } = harness({ onApplied: () => { entered.resolve(); return transition.promise; } });
    await api.open(configuration()); const pending = api.apply(); await entered.promise; assert.equal(api.isOpen(), true);
    await api.open(configuration({ title: "后开的草稿" })); transition.resolve(); await pending;
    assert.equal(api.state().title, "后开的草稿"); assert.equal(api.desktopCloseStatus().busy, false);
  });
  await asyncTest("user cancellation remains available while busy and calls its host exactly once", async () => {
    const wait = deferred(), { api, controls, calls } = harness({ select: () => wait.promise });
    await api.open(configuration()); const pending = api.apply(); await controls.cancel.onclick();
    assert.equal(calls.cancelled, 1); assert.equal(api.isOpen(), false); assert.equal(api.desktopCloseStatus().busy, false);
    wait.resolve(true); assert.equal(await pending, false); assert.equal(calls.applied, 0); assert.equal(calls.cancelled, 1);
  });
  await asyncTest("widening the date range preserves an explicit in-range record",async()=>{
    const {api,controls}=harness();await api.open(configuration());controls.fields.to.value="2026-12-01";controls.fields.to.onchange();assert.equal(api.state().participants[0].recordId,"ra");
  });
  await asyncTest("workflow validates objects independently from records and retains its draft across steps",async()=>{
    const {api}=harness();await api.open(configuration({participants:[{athleteId:"a-123456",recordId:""}]}),{step:2});assert.equal(api.getStep(),2);assert.equal(api.validateStep(2).valid,true);assert.equal(api.validateStep(3).valid,false);const before=copy(api.state());api.setStep(4);assert.deepEqual(copy(api.state()),before);assert.equal(api.getStep(),4);
  });
  await asyncTest("longitudinal selection fixes the roster and creates explicit missing cells per actual date",async()=>{
    const {api}=harness();await api.open(configuration({analysisMode:"longitudinal",athleteIds:["a-123456","missing"],dates:["2026-11-01","2026-11-05"],dateParticipants:[]}),{step:3});const d=api.state();assert.deepEqual(copy(d.athleteIds),["a-123456","missing"]);assert.deepEqual(copy(d.dateParticipants),[{date:"2026-11-01",participants:[{athleteId:"a-123456",recordId:"ra"},{athleteId:"missing",recordId:""}]},{date:"2026-11-05",participants:[{athleteId:"a-123456",recordId:"ra-new"},{athleteId:"missing",recordId:""}]}]);assert.equal(api.validateStep(3).valid,true);
  });
  await asyncTest("longitudinal same-day duplicates remain unresolved until an explicit source is supplied",async()=>{
    const {api,library}=harness();library.athletes[0].records.push(record("second","2026-11-05"));await api.open(configuration({analysisMode:"longitudinal",dates:["2026-11-01","2026-11-05"]}),{step:3});assert.equal(api.validateStep(3).valid,false);assert.equal(api.state().dateParticipants[1].participants[0].recordId,"");
  });
  await asyncTest("horizontal starts without invented objects and accepts a standalone reference",async()=>{
    const {api}=harness();await api.open(configuration({analysisMode:"horizontal",objects:[]}),{step:2});assert.equal(api.validateStep(2).valid,false);assert.deepEqual(copy(api.state().objects),[]);await api.open(configuration({analysisMode:"horizontal",participants:[],objects:[{id:"ref",kind:"reference",label:"群体",reference:{id:"ref",sampling:"period-mean",window:{kind:"all",from:"",to:""}}}]}),{step:2});assert.equal(api.validateStep(2).valid,true);assert.equal(api.validateStep(3).valid,true);
  });
  await asyncTest("horizontal teams keep separate per-person choices and require a real comparison",async()=>{
    const {api}=harness(),object={id:"one",kind:"team",label:"甲",participants:[{athleteId:"a-123456",recordId:"ra"}]};await api.open(configuration({analysisMode:"horizontal",objects:[object]}),{step:2});assert.equal(api.validateStep(2).valid,false);await api.open(configuration({analysisMode:"horizontal",objects:[object,{id:"two",kind:"team",label:"乙",participants:[{athleteId:"b-123456",recordId:"rb"}]}]}),{step:3});assert.equal(api.validateStep(3).valid,true);assert.deepEqual(copy(api.state().objects[0]),object);
  });
  await asyncTest("report naming is independent of the source configuration title",async()=>{
    const {api,controls}=harness();await api.open(configuration({title:"原记录名称"}),{step:4});controls.fields.title.value="团队新报告";controls.fields.title.onchange();assert.equal(api.state().title,"原记录名称");assert.equal(api.state().reportTitle,"团队新报告");
  });
  console.log(`${passed} team selection model checks passed; ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
