"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { context: modelContext } = require("./helpers/longitudinal-fixture.cjs"), M = modelContext().RingsideModel;
const app = fs.readFileSync(path.join(__dirname, "../src/ringside-app.js"), "utf8");
const start = app.search(/^  async function switchRecord\(/m), next = app.indexOf("  async function selectAthlete(", start);
assert.ok(start >= 0 && next > start, "production switchRecord must be available");
const productionSwitch = app.slice(start, next), copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function record(id, athleteId) {
  const value = M.defaults(); value.demo = false; value.recordId = id; value.athleteId = athleteId;
  Object.assign(value.athlete, { name: athleteId, date: "2026-11-06", birthDate: "2000-01-01", sex: "男" });
  M.applyAge(value); return copy(M.normalizeRecord(value));
}
function harness(flag, { fail = false } = {}) {
  const previous = record("previous-record", "previous-athlete"), incoming = record("incoming-record", "incoming-athlete");
  const athlete = { id: incoming.athleteId, records: [copy(incoming)] }, commit = deferred(), started = deferred(), calls = [], status = { textContent: "" };
  let storedRecord=copy(incoming),owner = "team:previous-owner", savedSelection = { activeAthleteId: previous.athleteId, activeRecordId: previous.recordId };
  const c = vm.createContext({ console, M, state: copy(previous), library: { ...savedSelection, athletes: [{ id: previous.athleteId, records: [copy(previous)] }, athlete] },
    reportSetup: flag === "reportSetup" ? { family: "personal", intent: "edit" } : null, selectionSequence: 0,
    ui: { mode: flag === "reportSetup" ? "report-setup" : "report", reportScroll: 37, detailOpen: { previous: true }, records: { [incoming.recordId]: { reportScroll: 88, detailOpen: { incoming: true } } }, lastViewed: { [previous.athleteId]: previous.recordId } },
    entryTab: "previous-tab", isoFilter: "previous-filter", reportDirty: false, document: { activeElement: null }, $: () => status,
    reports: { cancelPending: () => calls.push("cancelPending"), clear: () => { calls.push("clearOwner"); owner = ""; } },
    reportEditInfo: () => null, commitReportControl: () => { throw Error("no pending editor control in this fixture"); },
    captureReportUI: () => calls.push("captureReportUI"), saveEditor: () => calls.push("saveEditor"), leaveEntrySession: async () => calls.push("leaveEntrySession"),
    upgradeDemo: () => ({ changed: false }), cancelJob: () => calls.push("cancelJob"),
    rememberRecordBaseline: () => calls.push("rememberRecordBaseline"), orderedEntryProjects: () => [],
    renderReport: () => calls.push("renderReport"), renderEntry: () => calls.push("renderEntry"), renderWorkspace: () => calls.push("renderWorkspace"), closeMobileSidebar: () => calls.push("closeSidebar"),
    discardReportSetup: () => { throw Error("prepared selections must keep their active setup until completion"); },
  });
  c.window = c; c.copy=copy;c.RingsideReportTitle={defaultTitle:"损伤风险筛查与运动表现测试报告"};c.scrollTo = () => calls.push("scrollTo");
  c.persist = async options => {
    calls.push({ type: "persist", options: copy(options) });
    savedSelection = { activeAthleteId: c.library.activeAthleteId, activeRecordId: c.library.activeRecordId }; return true;
  };
  c.repository = {
    loadRecord: async id => { assert.equal(id, incoming.recordId); return copy(storedRecord); },
    saveRecords: async (records, checks, options) => {
      if(records.length){assert.equal(records.length,1);assert.equal(checks.expectedRecords[incoming.recordId],JSON.stringify(storedRecord));}
      else assert.deepEqual(copy(checks), {});
      if(!options){storedRecord=copy(records[0]);calls.push("titleRollback");return;}
      assert.deepEqual(copy(options.selection), { activeAthleteId: incoming.athleteId, activeRecordId: incoming.recordId });
      calls.push("selectionStarted"); started.resolve(); await commit.promise;
      if (fail) throw Error("synthetic selection commit failed");
      if(records.length)storedRecord=copy(records[0]);savedSelection = copy(options.selection); calls.push("selectionCommitted");
    },
  };
  vm.runInContext(productionSwitch + "\nglobalThis.switchRecordUnderTest=switchRecord;", c);
  return { c, incoming, previous, calls, status, commit, started, saved: () => copy(savedSelection),stored:()=>copy(storedRecord),
    snapshot: () => copy({ state: c.state, activeAthleteId: c.library.activeAthleteId, activeRecordId: c.library.activeRecordId, owner, ui: c.ui, entryTab: c.entryTab, isoFilter: c.isoFilter, reportDirty: c.reportDirty, reportSetup: c.reportSetup }),
    run: (options = {}) => c.switchRecordUnderTest(athlete, incoming, { [flag]: true, ...options }),
  };
}
const tests = [], test = (name, fn) => tests.push([name, fn]);
for (const flag of ["reportSetup", "longitudinal", "horizontal", "team"]) {
  test(flag + " selection failure preserves the record, active IDs, owner and UI", async () => {
    const h = harness(flag, { fail: true }), before = h.snapshot(), saved = h.saved(), task = h.run();
    const rejection = assert.rejects(task, /synthetic selection commit failed/);
    await h.started.promise; assert.deepEqual(h.snapshot(), before); h.commit.resolve(); await rejection;
    assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.saved(), saved);
    assert.match(h.status.textContent, /保存失败/); assert.equal(h.calls.includes("renderReport"), false); assert.equal(h.calls.includes("clearOwner"), false);
  });
  test(flag + " selection invalidated during commit never adopts the new record", async () => {
    const h = harness(flag), before = h.snapshot(), saved = h.saved(); let current = true;
    const task = h.run({ isCurrent: () => current }); await h.started.promise; assert.deepEqual(h.snapshot(), before);
    current = false; h.commit.resolve(); assert.equal(await task, false);
    assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.saved(), saved);
    const persists = h.calls.filter(call => call?.type === "persist"); assert.equal(persists.length, 2); assert.equal(persists[1].options.readOnlyRecord, true);
    assert.equal(h.calls.includes("renderReport"), false); assert.equal(h.calls.includes("clearOwner"), false);
  });
  test(flag + " selection adopts only after a successful commit and does not save twice", async () => {
    const h = harness(flag), before = h.snapshot(), task = h.run(); await h.started.promise;
    assert.deepEqual(h.snapshot(), before); assert.equal(h.calls.includes("cancelJob"), false); assert.equal(h.calls.includes("rememberRecordBaseline"), false);
    h.commit.resolve(); assert.equal(await task, true); const after = h.snapshot();
    assert.equal(after.state.recordId, h.incoming.recordId); assert.equal(after.activeAthleteId, h.incoming.athleteId); assert.equal(after.activeRecordId, h.incoming.recordId);
    assert.deepEqual(h.saved(), { activeAthleteId: h.incoming.athleteId, activeRecordId: h.incoming.recordId });
    assert.equal(after.owner, flag === "reportSetup" ? "" : before.owner); assert.equal(after.ui.mode, "report"); assert.equal(after.ui.reportScroll, 88); assert.deepEqual(after.ui.detailOpen, { incoming: true });
    assert.equal(h.calls.filter(call => call?.type === "persist").length, 1);
    assert.ok(h.calls.indexOf("selectionCommitted") < h.calls.indexOf("cancelJob")); assert.ok(h.calls.indexOf("selectionCommitted") < h.calls.indexOf("renderReport"));
  });
}
test("single report title and selected record commit together before owner adoption",async()=>{
  const h=harness("reportSetup"),before=h.snapshot(),task=h.run({reportTitle:"新报告名称"});await h.started.promise;assert.deepEqual(h.snapshot(),before);assert.equal(h.stored().views?.reportTitle,undefined);
  h.commit.resolve();assert.equal(await task,true);assert.equal(h.snapshot().state.views.reportTitle,"新报告名称");assert.equal(h.stored().views.reportTitle,"新报告名称");assert.equal(h.stored().title,h.incoming.title);
});
test("single report title save failure retains the old owner, record and report name",async()=>{
  const h=harness("reportSetup",{fail:true}),before=h.snapshot(),task=h.run({reportTitle:"保存失败的新名称"}),failed=assert.rejects(task,/synthetic selection commit failed/);await h.started.promise;h.commit.resolve();await failed;
  assert.deepEqual(h.snapshot(),before);assert.deepEqual(h.stored(),h.incoming);
});
test("canceling a single report selection rolls back its committed display title",async()=>{
  const h=harness("reportSetup"),before=h.snapshot();let current=true;const task=h.run({reportTitle:"已取消的新名称",isCurrent:()=>current});await h.started.promise;current=false;h.commit.resolve();assert.equal(await task,false);
  assert.deepEqual(h.snapshot(),before);assert.deepEqual(h.stored(),h.incoming);assert.ok(h.calls.includes("titleRollback"));
});
(async () => { for (const [name, run] of tests) { await run(); console.log("PASS " + name); } console.log(tests.length + " report navigation state checks passed"); })().catch(error => { console.error(error); process.exitCode = 1; });
