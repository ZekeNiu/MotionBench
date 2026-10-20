"use strict";
const assert = require("node:assert/strict");
const { context } = require("./helpers/longitudinal-fixture.cjs");
const env = context(), D = env.RingsideResultDisplay, M = env.RingsideModel;

// Build display inputs directly so each assertion identifies the grading rule
// under test. Expected colors come from declared examples or the production
// evaluator, rather than another implementation of the projection algorithm.
function reference({ method = "primary", direction = "higher", target = 50, ranges = [],
  transform = { kind: "ratio", direction }, thresholds = { scoreAmber: 80, scoreGreen: 100 }, meanRanges } = {}) {
  const definition = { id: "overview_reference", testId: "custom", ability: "合成能力", referenceEnabled: true,
    measurementScale: "ratio", target, targetEnabled: true, direction, ranges };
  const subjectId = "metric:" + definition.id;
  const record = { evaluationProfileFormat: 2, rules: thresholds, axes: { "合成能力": {
    method, primary: subjectId, scoringVersion: 1, transforms: { [subjectId]: transform }, ranges: meanRanges
  } } };
  const axis = { key: "合成能力", method, members: [subjectId], defs: [definition], transforms: { [subjectId]: transform } };
  const before = JSON.stringify([axis, record]), result = D.abilityReference(axis, record);
  assert.equal(JSON.stringify([axis, record]), before, "display reference must preserve its inputs");
  return { result, record, definition };
}
const at = (result, score) => result?.ranges.filter(range =>
  (range.min == null || score > range.min || score === range.min && range.includeMin) &&
  (range.max == null || score < range.max || score === range.max && range.includeMax)) || [];
const primaryRanges = [
  { min: 0, max: 35, includeMax: false, status: "red", label: "原始低区" },
  { min: 35, max: 50, includeMax: false, status: "amber", label: "原始中区" },
  { min: 50, max: 80, status: "green", label: "原始高区" }
];
let passed = 0, failed = 0;
function test(name, check) {
  try { check(); passed++; console.log("PASS " + name); }
  catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); }
}

test("higher target ratio uses saved 60/90 thresholds and a singleton 100 edge", () => {
  const { result } = reference({ thresholds: { scoreAmber: 60, scoreGreen: 90 } });
  assert.equal(at(result, 59)[0].status, "red");
  assert.equal(at(result, 60)[0].status, "amber");
  assert.equal(at(result, 90)[0].status, "green");
  assert.equal(at(result, 100)[0].status, "green");
  assert.ok(result.ranges.some(range => range.min === 100 && range.max === 100));
});
test("lower target ratio retains its original grade and reliable 100 edge", () => {
  const { result } = reference({ direction: "lower", target: 8 });
  assert.equal(at(result, 79)[0].status, "red");
  assert.equal(at(result, 80)[0].status, "amber");
  assert.equal(at(result, 100)[0].status, "green");
  assert.equal(at(result, 99)[0].status, "amber", "100-only green must not become a visible green interval");
});
test("primary measurement ranges map to scores while ambiguous saturation stays empty", () => {
  const { result } = reference({ ranges: primaryRanges });
  assert.equal(at(result, 69)[0].status, "red");
  assert.equal(at(result, 70)[0].status, "amber");
  assert.equal(at(result, 99)[0].status, "amber");
  assert.equal(at(result, 100).length, 0, "100 represents both amber and green measurements");
});
test("zero target without grade ranges cannot manufacture a standard", () => {
  assert.equal(reference({ target: 0 }).result, null);
});
test("mean ability uses its independently configured score ranges", () => {
  const { result } = reference({ method: "mean", meanRanges: [
    { min: 0, max: 40, includeMax: false, status: "red", label: "弱" },
    { min: 40, max: 75, includeMax: false, status: "amber", label: "中" },
    { min: 75, max: 100, status: "green", label: "强" }
  ] });
  assert.equal(at(result, 39)[0].status, "red");
  assert.equal(at(result, 40)[0].status, "amber");
  assert.equal(at(result, 75)[0].status, "green");
});
test("mean ability without grade ranges remains unclassified", () => {
  assert.equal(reference({ method: "mean" }).result, null);
});
test("linear anchors support actual measurement ranges without a positive target", () => {
  const { result } = reference({ target: 0, ranges: [
    { min: -20, max: 0, includeMax: false, status: "red", label: "低" },
    { min: 0, max: 20, status: "green", label: "高" }
  ], transform: { kind: "anchors", shape: "higher", points: [{ value: -20, score: 0 }, { value: 20, score: 100 }] } });
  assert.equal(at(result, 49)[0].status, "red");
  assert.equal(at(result, 50)[0].status, "green");
});
test("piecewise anchors preserve exact transformed measurement boundaries", () => {
  const { result } = reference({ ranges: primaryRanges, transform: { kind: "anchors", shape: "higher", points: [
    { value: 0, score: 0 }, { value: 35, score: 30 }, { value: 50, score: 80 }, { value: 80, score: 100 }
  ] } });
  assert.equal(at(result, 29)[0].status, "red");
  assert.equal(at(result, 30)[0].status, "amber");
  assert.equal(at(result, 80)[0].status, "green");
});
test("lower anchors retain the source grade direction", () => {
  const { result } = reference({ direction: "lower", ranges: [
    { min: 0, max: 5, includeMax: false, status: "green", label: "快" },
    { min: 5, max: 10, includeMax: false, status: "amber", label: "中" },
    { min: 10, max: 20, status: "red", label: "慢" }
  ], transform: { kind: "anchors", shape: "lower", points: [{ value: 0, score: 100 }, { value: 20, score: 0 }] } });
  assert.equal(at(result, 25)[0].status, "red");
  assert.equal(at(result, 60)[0].status, "amber");
  assert.equal(at(result, 90)[0].status, "green");
});
test("an internal anchor plateau has no fabricated unique endpoint grade", () => {
  const { result } = reference({ ranges: primaryRanges, transform: { kind: "anchors", shape: "higher", points: [
    { value: 0, score: 0 }, { value: 30, score: 50 }, { value: 60, score: 50 }, { value: 80, score: 100 }
  ] } });
  assert.equal(at(result, 50).length, 0);
  assert.ok(result.ranges.length, "uniquely invertible neighboring intervals remain available");
});
test("discrete tables and nonmonotone suitable-range scores stay conservative", () => {
  assert.equal(reference({ transform: { kind: "table", ranges: [{ min: 0, max: 100, score: 50 }] } }).result, null);
  assert.equal(reference({ transform: { kind: "anchors", shape: "range", points: [
    { value: 0, score: 0 }, { value: 10, score: 100 }, { value: 20, score: 100 }, { value: 30, score: 0 }
  ] } }).result, null);
});
test("198 higher and lower score coordinates agree with the production evaluator", () => {
  for (const direction of ["higher", "lower"]) {
    const { result, record, definition } = reference({ direction });
    for (let score = 1; score < 100; score++) {
      const measurement = direction === "lower" ? definition.target * 100 / score : definition.target * score / 100;
      assert.equal(at(result, score)[0].status, M.evaluation(measurement, definition, record).status, direction + " score " + score);
    }
  }
});
console.log(`${passed} overview reference checks passed; ${failed} failed`);
if (failed) process.exitCode = 1;
