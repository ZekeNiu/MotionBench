"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const crypto = require("node:crypto"), {execFileSync} = require("node:child_process");
const root = path.join(__dirname, ".."), copy = value => JSON.parse(JSON.stringify(value));
const model = vm.createContext({console, Intl, crypto:crypto.webcrypto}); model.window = model;
for (const name of ["calc", "fvp", "sprint-fvp", "cpet-reference", "definitions", "tests", "scoring", "model", "sprint-fvp-entry"])
  vm.runInContext(fs.readFileSync(path.join(root, "src/ringside-" + name + ".js"), "utf8"), model);
const M = model.RingsideModel, T = model.RingsideTests, appRef = process.argv.includes("--app-ref") ? process.argv[process.argv.indexOf("--app-ref") + 1] : null;
const app = appRef ? execFileSync("git", ["show", appRef + ":src/ringside-app.js"], {cwd:root, encoding:"utf8"}) : fs.readFileSync(path.join(root, "src/ringside-app.js"), "utf8");
function section(startMarker, endMarker) {
  const start = app.indexOf(startMarker), end = app.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, "Production function markers remain available"); return app.slice(start, end);
}
function fixture() {
  const record = copy(M.normalizeRecord(M.defaults()));
  record.recordId = "synthetic_entry_controls"; record.athleteId = "synthetic_entry_owner";
  record.athlete.name = "Synthetic entry controls"; record.athlete.mass = 75; record.athlete.height = 180;
  record.enabled.sprint_fvp = true;
  record.data.sprint_fvp = [{id:"synthetic_trial", notes:"Keep original notes", excluded:false, exclusionReason:"", extension:{source:"synthetic"},
    splits:[5, 10, 20, 30].map((distanceM, i) => ({id:"synthetic_split_" + i, distanceM, timeS:model.RingsideSprintFVP.timeAtDistance(distanceM, 9.5, 1.15), extension:"keep"}))}];
  return record;
}
function control(attributes = {}, extra = {}) {
  return {type:"checkbox", tagName:"INPUT", dataset:Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])),
    hasAttribute:name => Object.hasOwn(attributes, name), checked:false, value:"", focus(){this.focused = true;}, ...extra};
}
function harness(record = fixture()) {
  const messages = [], counts = {changes:0, entry:0, report:0}, storage = new Map(); let change;
  const mode = control({}, {type:"select-one", tagName:"SELECT", dataset:{path:"sprintFvpConfig.inputTimeMode"}, value:"interval"});
  const c = vm.createContext({console, Intl, crypto:crypto.webcrypto, Map, Set, JSON, copy, M, T, state:record,
    ui:{mode:"entry"}, entryTab:"sprint_fvp", inputDrafts:{}, draftStorageKey:"synthetic_drafts", undoDeletes:new Map(),
    sessionStorage:{setItem:(key, value) => storage.set(key, value)}, document:{addEventListener:(name, handler) => {if (name === "change") change = handler;}},
    changed:() => {counts.changes++;}, renderEntry:() => {counts.entry++;}, renderReport:() => {counts.report++;},
    reportEditInfo:() => null, refreshCapabilityAnalysis:() => {counts.report++;},
    toast:message => messages.push(message), inputIssue:() => {}, rowFocus:() => {}, forgetInputError:() => {},
    $:() => ({querySelector:() => mode}), uid:() => crypto.randomUUID(),
    setPath:(key, value) => {const parts = key.split("."); let target = record; for (const part of parts.slice(0, -1)) target = target[part] ||= {}; target[parts.at(-1)] = value; counts.changes++;},
  }); c.window = c; c.RingsideSprintFVPEntry = model.RingsideSprintFVPEntry;
  // Use the real App entry/change code; replace only rendering and browser storage boundaries.
  for (const [start, end] of [["  function draftRecordKey(", "  function rememberInputError("], ["  function addRow(", "  function addIso("], ["  function inheritConfiguration(", "  async function createAthlete("], ['  document.addEventListener("change", (e) => {', '  $("interpEditor").addEventListener("paste",']])
    vm.runInContext(section(start, end), c);
  return {c, mode, messages, counts, storage, change:target => change({target})};
}
const times = record => record.data.sprint_fvp.map(row => row.splits.map(split => split.timeS));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
let passed = 0, failed = 0;
function test(name, run) {try {run(); passed++; console.log("PASS " + name);} catch (error) {failed++; console.error("FAIL " + name + "\n" + error.stack);}}

test("four and six segment buttons append blank trials without replacing existing measurements", () => {
  const h = harness(), before = copy(h.c.state.data.sprint_fvp[0]);
  h.c.addRow("sprint_fvp", -1, "four"); h.c.addRow("sprint_fvp", -1, "six");
  const rows = copy(h.c.state.data.sprint_fvp);
  assert.deepEqual(rows[0], before); assert.deepEqual(rows[1].splits.map(split => split.distanceM), [5, 10, 20, 30]);
  assert.deepEqual(rows[2].splits.map(split => split.distanceM), [5, 10, 15, 20, 25, 30]);
  assert.ok(rows.slice(1).every(row => row.splits.every(split => split.timeS === "" && split.id)));
  assert.equal(new Set(rows.flatMap(row => row.splits.map(split => split.id))).size, 14);
});
test("unknown template cannot mutate the record or schedule a save", () => {
  const h = harness(), before = copy(h.c.state); h.c.addRow("sprint_fvp", -1, "unknown");
  assert.deepEqual(copy(h.c.state), before); assert.equal(h.counts.changes, 0);
});
test("mode change atomically converts every trial and keeps the physical profile", () => {
  const record = fixture(), second = copy(record.data.sprint_fvp[0]); second.id = "synthetic_excluded"; second.excluded = true;
  record.data.sprint_fvp.push(second); const h = harness(record), before = copy(record), solved = M.sprintFvpAnalysis(record);
  h.change(h.mode); assert.equal(record.sprintFvpConfig.inputTimeMode, "interval");
  record.data.sprint_fvp.forEach((row, i) => row.splits.forEach((split, j) => near(split.timeS, before.data.sprint_fvp[i].splits[j].timeS - (j ? before.data.sprint_fvp[i].splits[j - 1].timeS : 0))));
  const interval = M.sprintFvpAnalysis(record); assert.equal(interval.valid, true); near(interval.model.F0, solved.model.F0); near(interval.model.Pmax, solved.model.Pmax);
  h.mode.value = "cumulative"; h.change(h.mode); record.data.sprint_fvp.forEach((row, i) => row.splits.forEach((split, j) => near(split.timeS, before.data.sprint_fvp[i].splits[j].timeS)));
  assert.equal(record.data.sprint_fvp[1].excluded, true); assert.equal(record.data.sprint_fvp[0].extension.source, "synthetic");
  assert.equal(h.counts.changes, 2); assert.equal(h.mode.focused, true);
});
test("missing intermediate time rejects conversion without changing raw values or mode", () => {
  const record = fixture(); record.data.sprint_fvp[0].splits[1].timeS = "";
  const h = harness(record), before = copy(record); h.change(h.mode);
  assert.deepEqual(copy(record), before); assert.equal(h.mode.value, "cumulative"); assert.equal(h.counts.changes, 0); assert.ok(h.messages.length);
});
test("unapplied stable split drafts reject conversion and remain available", () => {
  const h = harness(), key = h.c.stablePath("data.sprint_fvp.0.splits.1.timeS"), before = copy(h.c.state);
  h.c.inputDrafts[h.c.draftRecordKey()] = {[key]:{value:"invalid", message:"Synthetic invalid input", mode:"entry", tab:"sprint_fvp"}};
  h.change(h.mode); assert.deepEqual(copy(h.c.state), before); assert.equal(h.mode.value, "cumulative");
  assert.equal(h.c.draftsFor()[key].value, "invalid"); assert.equal(h.counts.changes, 0); assert.ok(h.messages[0].includes("标红"));
});
test("successful mode change ends sprint split deletion undo before old times can return", () => {
  const h = harness(); h.c.undoDeletes.set(h.c.state.recordId, {type:"sprint-split", test:0, item:{timeS:2}});
  h.change(h.mode); assert.equal(h.c.undoDeletes.has(h.c.state.recordId), false); assert.equal(h.c.state.sprintFvpConfig.inputTimeMode, "interval");
});
test("successful mode change ends whole sprint trial undo while preserving other project undo", () => {
  const h = harness(); h.c.undoDeletes.set(h.c.state.recordId, {type:"row", test:"sprint_fvp", item:{splits:[{timeS:2}]}});
  h.change(h.mode); assert.equal(h.c.undoDeletes.has(h.c.state.recordId), false);
  const other = {type:"row", test:"cmj", item:{height:40}}; h.c.undoDeletes.set(h.c.state.recordId, other);
  h.mode.value = "cumulative"; h.change(h.mode); assert.equal(h.c.undoDeletes.get(h.c.state.recordId), other);
});
test("rejected and unchanged modes preserve deletion undo", () => {
  const h = harness(), undo = {type:"sprint-split", test:0, item:{timeS:2}};
  h.c.undoDeletes.set(h.c.state.recordId, undo); h.mode.value = "cumulative"; h.change(h.mode);
  assert.equal(h.c.undoDeletes.get(h.c.state.recordId), undo);
  h.c.state.data.sprint_fvp[0].splits[1].timeS = ""; h.mode.value = "interval"; h.change(h.mode);
  assert.equal(h.c.undoDeletes.get(h.c.state.recordId), undo);
});
test("legacy no-view records get defaults while changing exactly one parameter", () => {
  const h = harness(); delete h.c.state.sprintFvpView;
  h.change(control({"data-sprint-fvp-metric":"RFmax"}));
  const view = h.c.state.sprintFvpView; assert.equal(view.metrics.RFmax, false); assert.equal(view.metrics.F0, true);
  assert.equal(view.fv, true); assert.equal(view.pv, true); assert.equal(view.optimum, true); assert.equal(view.confidence, false);
});
test("curve changes preserve metric selection and unknown method metadata", () => {
  const h = harness(); h.c.state.sprintFvpView = {...M.sprintFvpViewDefaults(), extension:{future:"keep"}, confidenceMethodVersion:"future-method", metrics:{...M.sprintFvpViewDefaults().metrics, RFmax:false, futureMetric:false}};
  h.change(control({"data-sprint-fvp-view":"optimum"}));
  const view = h.c.state.sprintFvpView; assert.equal(view.optimum, false); assert.equal(view.metrics.RFmax, false);
  assert.equal(view.metrics.futureMetric, false); assert.equal(view.confidenceMethodVersion, "future-method"); assert.equal(view.extension.future, "keep");
  h.change(control({"data-sprint-fvp-view":"confidence"}, {checked:true})); assert.equal(h.c.state.sprintFvpView.confidence, true);
});
test("unsupported display hooks and legacy custom ID collisions cannot alter state", () => {
  const h = harness(), before = copy(h.c.state);
  h.change(control({"data-sprint-fvp-view":"range"})); h.change(control({"data-sprint-fvp-metric":"__proto__"}));
  assert.deepEqual(copy(h.c.state), before); assert.equal(h.counts.changes, 0);
  h.c.state.customTests.push({id:"sprint_fvp", name:"My custom test"}); const custom = copy(h.c.state);
  h.change(control({"data-sprint-fvp-view":"fv"})); assert.deepEqual(copy(h.c.state), custom);
});
test("new assessment inherits independent display configuration without copying measurements", () => {
  const h = harness(), next = copy(M.defaults()); h.c.state.sprintFvpView.metrics.DRF = false; h.c.state.sprintFvpView.optimum = false;
  h.c.inheritConfiguration(next, h.c.state);
  assert.equal(next.sprintFvpView.metrics.DRF, false); assert.equal(next.sprintFvpView.optimum, false);
  assert.notEqual(next.sprintFvpView, h.c.state.sprintFvpView); assert.equal(next.data.sprint_fvp.length, 0);
});
function entryForm(record) {
  const fields = new Map(), html = model.RingsideSprintFVPEntry.render(record, {
    input:(key, value, options = {}) => {fields.set(key, {value, options}); return `<input data-path="${key}">`;},
    select:(key, value) => `<select data-path="${key}" value="${value}"></select>`, check:() => "",
    field:(label, input) => `<label class="field"><span>${label}</span>${input}</label>`, table:() => "",
  }); return {fields, html};
}
test("main height field exposes the effective historical override and its snapshot source", () => {
  const record = fixture(); record.sprintFvpConfig.heightCm = 190;
  const before = copy(record), form = entryForm(record), advanced = form.html.indexOf("data-sprint-fvp-entry-settings");
  assert.equal(form.fields.get("sprintFvpConfig.heightCm").value, 190);
  assert.equal(form.fields.get("sprintFvpConfig.heightCm").options.placeholder, "180");
  assert.ok(form.html.indexOf("计算覆盖值") < advanced); assert.ok(form.html.indexOf('data-path="sprintFvpConfig.heightCm"') < advanced);
  assert.deepEqual(copy(record), before);
});
test("empty new assessment fields do not invent body mass or height", () => {
  const record = copy(M.defaults()), form = entryForm(record);
  assert.equal(form.fields.get("athlete.mass").value, ""); assert.equal(form.fields.get("sprintFvpConfig.heightCm").value, "");
  assert.equal(record.athlete.height, ""); assert.equal(record.athlete.mass, ""); assert.ok(form.html.includes("沿用本次记录"));
});
test("live height source label follows edits without replacing input controls", () => {
  const record = fixture(), label = {textContent:""}, input = {closest:() => ({querySelector:() => label})}, feedback = {innerHTML:""};
  const container = {querySelector:selector => selector.includes("heightCm") ? input : feedback};
  record.sprintFvpConfig.heightCm = 188; model.RingsideSprintFVPEntry.update(record, container); assert.ok(label.textContent.includes("计算覆盖值"));
  record.sprintFvpConfig.heightCm = ""; model.RingsideSprintFVPEntry.update(record, container); assert.ok(label.textContent.includes("沿用本次记录"));
  assert.ok(feedback.innerHTML.includes("冲刺FVP")); assert.equal(record.athlete.height, 180);
});
console.log(JSON.stringify({appRef, appSha256:crypto.createHash("sha256").update(app).digest("hex"), passed, failed}));
console.log(passed + " sprint FVP entry control checks passed; " + failed + " failed"); if (failed) process.exitCode = 1;
