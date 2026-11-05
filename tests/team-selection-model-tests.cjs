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
test("missing or reversed date windows cannot preselect a record", () => {
  const owner = { records: [record("a", "2026-11-01")] };
  for (const dateRange of [null, {}, { from: "2026-11-01" }, { from: "2026-11-05", to: "2026-11-01" }]) assert.equal(Selection.candidates(owner, dateRange).length, 0);
});
test("archived and recycle-bin records cannot be silently preselected", () => {
  const owner = { records: [record("valid", "2026-11-01"), record("archived", "2026-11-04", { archived: true }), record("trash", "2026-11-05", { deletedAt: "2026-11-05" })] };
  assert.equal(Selection.resolveSelection(owner, window).recordId, "valid");
});
test("candidate eligibility agrees with the model for sample and deleted flags", () => {
  const owner = { records: [record("valid", "2026-11-01"), record("demo", "2026-11-05", { demo: true }), record("sample", "2026-11-05", { sample: true }), record("deleted", "2026-11-05", { deleted: true })] };
  const result = Selection.resolveSelection(owner, window); assert.equal(result.recordId, "valid"); assert.equal(result.ambiguous, false);
});
console.log(`${passed} team selection model checks passed; ${failed} failed`); if (failed) process.exitCode = 1;
