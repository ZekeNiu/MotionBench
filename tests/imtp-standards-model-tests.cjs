"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict"), path = require("node:path");
const ctx = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); ctx.window = ctx;
for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), ctx);
const M = ctx.RingsideModel, E = ctx.RingsideEvaluation, D = ctx.Def, copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log("PASS " + name); } catch (error) { console.error("FAIL " + name); throw error; } }
function near(actual, expected) { assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8, actual + " != " + expected); }
function record() { const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = id === "imtp"); r.data.imtp = []; return r; }
function trial(id, peakForce, force, rfd = "", timeMs = 250, baselineForce = "") { return { id, peakForce, baselineForce, timePoints: [{ id: id + "_point", timeMs, force, rfd }] }; }
function rule(r, kind = "force_pct_peak", timeMs = 250) { return { timeMs, kind, context: E.imtpTimeContext(r), target: kind === "force_pct_peak" ? 90 : 4000, ranges: [], direction: "higher", referenceEnabled: true, source: "用户配置测试标准" }; }
function profile(r, rules) { const p = E.create(r); p.criteria.imtpTimeStandards = rules; return p; }
function point(r, p, time = 250) { return M.stats(p ? E.resolve(r, p) : r).raw.forceTime.timeRows.find(x => x.timeMs === time); }

test("percentage means pair force and PF within each trial, without changing PF means", () => {
  const r = record(); r.mode = "mean"; r.data.imtp = [trial("a", 1000, 900), trial("b", 3000, 1500)];
  const before = copy(r), s = M.stats(r), p = point(r);
  near(p.force, 1200); near(p.forcePercent, 70); near(s.raw.forceTime.points[0].percent, 70); near(s.values.imtp_peak_force, 2000);
  assert.deepEqual(copy(r), before);
  r.data.imtp[1].timePoints = []; near(point(r).forcePercent, 90); near(M.forceTime(r).points[0].percent, 90);
  assert.equal(s.raw.forceTime.peakForce, 2000);
});
test("best and mean RFD follow the valid PF representative trials", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 900, 9000), trial("b", 3000, 1500, 1000), trial("no-pf", "", 700, 100000)];
  near(point(r).forcePercent, 50); near(point(r).rfd, 1000);
  r.mode = "mean"; near(point(r).rfd, 5000); near(point(r).forcePercent, 70); assert.equal(point(r).rfdN, 2);
  r.data.imtp = [trial("partial", "", 700, 1234)]; const s = M.stats(r);
  assert.equal(s.raw.forceTime.timeRows.length, 0); assert.equal(s.imtpTimeResults.length, 0);
  assert.equal(s.repetitions[0].attempts[0].values.imtp_rfd250, 1234);
});
test("RFD conversion is curve-only and never creates measured force or force SD", () => {
  const r = record(); r.mode = "mean";
  r.data.imtp = [trial("a", 1000, "", 2000, 250, 100), trial("b", 2000, "", 4000, 250, 100), trial("c", 3000, "", 6000, 250, 100)];
  const s = M.stats(r), p = s.raw.forceTime.timeRows[0], stat = s.repetitions[0].statistics.find(x => x.id === "imtp_f250");
  assert.equal(p.force, null); assert.equal(p.forcePercent, null); assert.equal(stat.n, 0); assert.equal(stat.mean, null);
  near(s.raw.forceTime.points[0].force, 1100); near(s.raw.forceTime.points[0].percent, (60 + 55 + 1600 / 3000 * 100) / 3);
  assert.deepEqual(copy(s.imtpTimeResults.map(x => x.kind)), ["rfd"]);
});
test("measured force overrides conversion while each curve percentage stays paired", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 900, 2000, 250, 100)];
  const f = M.forceTime(r); near(f.points[0].force, 900); near(f.points[0].percent, 90); assert.equal(f.points[0].derived, false);
  assert.ok(f.issues.some(x => x.id.includes("force_rfd_conflict"))); near(f.baselinePercent, 10);
});
test("arbitrary force and RFD standards use separate units and shared evaluation results", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 900, 1000)];
  const forceRule = rule(r); forceRule.ranges = D.parseRanges("<90 | 待提升 | red\n>=90 | 优秀 | green"); forceRule.ranges[1].advantage = true;
  const p = profile(r, [forceRule, rule(r, "rfd")]), raw = copy(r), s = M.stats(E.resolve(r, p)), time = s.raw.forceTime.timeRows[0];
  assert.equal(time.forceEvaluation.label, "优秀"); assert.equal(time.rfdEvaluation.status, "red");
  assert.equal(time.forceStandard.unit, "%PF"); assert.equal(time.rfdStandard.unit, "N/s");
  assert.equal(s.imtpTimeResults[0].value, 900); assert.equal(s.imtpTimeResults[0].evaluationValue, 90);
  assert.ok(s.findings.some(f => f.sources.includes("imtp_rfd250")));
  assert.ok(s.advantages.items.some(x => x.id === "imtp_f250" && x.unit === "%PF"));
  assert.deepEqual(copy(r), raw); assert.equal(s.axes.length, M.stats(r).axes.length);
});
test("percentage grading uses unrounded values and over-PF observations remain ungraded", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 899.99)];
  const standard = rule(r); standard.ranges = D.parseRanges("<90 | 待提升 | red\n>=90 | 优秀 | green"); const p = profile(r, [standard]);
  assert.equal(point(r, p).forceEvaluation.status, "red"); r.data.imtp[0].timePoints[0].force = 1100;
  const result = point(r, p); near(result.forcePercent, 110); assert.equal(result.forceEvaluation.status, "gray");
  assert.match(result.forceEvaluation.label, /超过峰值/); assert.equal(result.force, 1100);
  assert.equal(M.stats(E.resolve(r, p)).imtpTimeResults[0].referenceEnabled, false);
});
test("legacy absolute standards remain until a new time rule explicitly takes over", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 500, 1000, 100)];
  const p = E.create(r), legacy = p.criteria.definitions.find(x => x.id === "imtp_f100");
  Object.assign(legacy, { referenceEnabled: true, target: 400, ranges: [] });
  assert.equal(point(r, p, 100).forceStandard.kind, "force_absolute"); assert.equal(point(r, p, 100).forceEvaluation.status, "green");
  p.criteria.imtpTimeStandards = [rule(r, "force_pct_peak", 100)];
  assert.equal(point(r, p, 100).forceEvaluation.status, "red"); assert.equal(legacy.target, 400);
  p.criteria.imtpTimeStandards[0].referenceEnabled = false;
  assert.equal(point(r, p, 100).forceEvaluation.status, "gray");
  const resolved = E.resolve(r, p); assert.equal(resolved.definitions.find(x => x.id === "imtp_f100").target, null);
  assert.equal(M.stats(resolved).axes.length, 0);
});
test("unit, protocol and force-basis mismatches disable replacement without legacy fallback", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 900, 1000, 100)];
  const p = profile(r, [rule(r, "force_pct_peak", 100)]), legacy = p.criteria.definitions.find(x => x.id === "imtp_f100");
  Object.assign(legacy, { referenceEnabled: true, target: 500, ranges: [] });
  for (const mutate of [x => x.protocolIdentities.imtp.version++, x => x.imtpConfig.definition = "net", x => x.imtpConfig.unit = "kgf"]) {
    const altered = copy(r); mutate(altered); const resolved = E.resolve(altered, p), row = point(altered, p, 100);
    assert.equal(row.forceStandard.matched, false); assert.equal(row.forceEvaluation.status, "gray");
    assert.equal(resolved.definitions.find(x => x.id === "imtp_f100").referenceEnabled, false);
    assert.ok(resolved.evaluationIssues.some(x => x.id === "imtp_f100"));
  }
});
test("direct model consumers cannot revive legacy targets under disabled replacement", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 500, "", 100)];
  Object.assign(r.definitions.find(x => x.id === "imtp_f100"), { referenceEnabled: true, target: 400 });
  r.imtpTimeStandards = [{ ...rule(r, "force_pct_peak", 100), referenceEnabled: false }];
  const s = M.stats(r); assert.equal(s.raw.forceTime.timeRows[0].forceEvaluation.status, "gray"); assert.equal(s.axes.length, 0);
});
test("an existing time metric keeps its explicit ability role using percent units", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 450, "", 100)];
  r.data.imtp[0].timePoints.push({ id: "a_200", timeMs: 200, force: 900, rfd: "" });
  r.axes["ability:早期发力"] = { method: "primary", primary: "imtp_f100" };
  const p = profile(r, [rule(r, "force_pct_peak", 100)]);
  Object.assign(p.criteria.definitions.find(d => d.id === "imtp_f100"), { referenceEnabled: true, target: 400 });
  Object.assign(p.criteria.definitions.find(d => d.id === "imtp_f200"), { referenceEnabled: true, target: 1500 });
  let s = M.stats(E.resolve(r, p)), axis = s.axes.find(a => a.label === "早期发力");
  near(axis.value, 50); assert.equal(axis.defs[0].id, "imtp_f100"); assert.equal(axis.defs[0].unit, "%PF");
  assert.match(axis.tooltip, /45 %PF/); near(s.values.imtp_f100, 450);
  Object.assign(p.criteria.axes["ability:早期发力"],{method:"mean",members:["metric:imtp_f100","metric:imtp_f200"],transforms:{"metric:imtp_f100":{kind:"ratio",direction:"higher"},"metric:imtp_f200":{kind:"ratio",direction:"higher"}}}); axis = M.stats(E.resolve(r, p)).axes.find(a => a.label === "早期发力"); near(axis.value, 55);
  p.criteria.axes["ability:早期发力"].method = "min"; axis = M.stats(E.resolve(r, p)).axes.find(a => a.label === "早期发力"); assert.equal(axis,undefined);
  p.criteria.axes["ability:早期发力"].method = "primary";
  p.criteria.imtpTimeStandards[0].referenceEnabled = false; assert.equal(M.stats(E.resolve(r, p)).axes.some(a => a.label === "早期发力"), false);
  p.criteria.imtpTimeStandards[0].referenceEnabled = true; r.protocolIdentities.imtp.version++;
  assert.equal(M.stats(E.resolve(r, p)).axes.some(a => a.label === "早期发力"), false);
});
test("new arbitrary times do not become default axis representatives or alter PF and DSI", () => {
  const r = M.sampleRecord(); r.data.imtp = [trial("a", 1000, 900)];
  const p = E.create(r); Object.assign(p.criteria.definitions.find(d => d.id === "imtp_peak_force"), { referenceEnabled: true, target: 2000 });
  const before = M.stats(E.resolve(r, p)); p.criteria.imtpTimeStandards = [rule(r)]; const after = M.stats(E.resolve(r, p));
  assert.deepEqual(copy(after.axes), copy(before.axes)); assert.equal(after.values.imtp_peak_force, before.values.imtp_peak_force);
  assert.equal(after.raw.dsi, before.raw.dsi); assert.equal(after.raw.dsiForce, before.raw.dsiForce);
});
test("profile templates, snapshots, copies and restoration preserve time standards and context", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 900)]; const p = profile(r, [rule(r)]), draft = E.template(p);
  draft.imtpTimeStandards[0].target = 95; draft.imtpTimeStandards[0].context.protocol = "must not rewrite conditions";
  const next = { ...copy(p), criteria: E.fromTemplate(draft, p) }; E.validateProfile(next);
  assert.equal(next.criteria.imtpTimeStandards[0].target, 95); assert.equal(next.criteria.imtpTimeStandards[0].context.protocol, r.protocol.imtp);
  next.previous = { criteria: copy(p.criteria), revision: 1, name: p.name }; E.validateProfile(next);
  const frozen = M.normalizeRecord(copy(E.resolve(r, next))); M.validateRecord(frozen);
  assert.equal(point(frozen).forceStandard.target, 95); assert.deepEqual(copy(M.stats(frozen).imtpTimeResults), copy(M.stats(E.resolve(r, next)).imtpTimeResults));
  const restored = E.normalizeProfile(copy(next.previous)); assert.equal(point(r, restored).forceStandard.target, 90);
  assert.equal(E.capture(frozen).imtpTimeStandards[0].matched, undefined);
});
test("effective time-standard changes stale narrative but profile names do not", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 900)]; const p = profile(r, [rule(r)]), basis = M.fingerprint(E.resolve(r, p));
  p.name = "重命名"; p.revision++; assert.equal(M.fingerprint(E.resolve(r, p)), basis);
  p.criteria.imtpTimeStandards[0].target = 95; assert.notEqual(M.fingerprint(E.resolve(r, p)), basis);
});
test("migrating frozen time standards does not change an equivalent narrative fingerprint", () => {
  for (const timeMs of [100, 250]) {
    const r = record(); r.data.imtp = [trial("a", 1000, 900, "", timeMs)];
    if (timeMs === 100) Object.assign(r.definitions.find(d => d.id === "imtp_f100"), { referenceEnabled: true, target: 400 });
    r.imtpTimeStandards = [rule(r, "force_pct_peak", timeMs)];
    const before = M.fingerprint(r), p = E.create(r), resolved = E.resolve(r, p);
    assert.equal(M.fingerprint(resolved), before);
    assert.equal(M.fingerprint({ ...resolved, imtpTimeStandards: [...resolved.imtpTimeStandards].reverse() }), before);
    assert.deepEqual(copy(M.stats(resolved).imtpTimeResults), copy(M.stats(r).imtpTimeResults));
  }
});
test("old profiles default to no new standard and equivalent empty signatures merge", () => {
  const r = record(), p = E.create(r); delete p.criteria.imtpTimeStandards; E.validateProfile(p);
  assert.equal(E.template(p).imtpTimeStandards.length, 0); assert.equal(E.resolve(r, p).imtpTimeStandards.length, 0);
  assert.equal(E.signature(p.criteria), E.signature({ ...p.criteria, imtpTimeStandards: [] }));
  const lib = E.migrate(M.recordEnvelope(r)); delete lib.evaluationProfiles[0].criteria.imtpTimeStandards;
  assert.deepEqual(copy(E.migrate(lib).evaluationProfiles[0].criteria.imtpTimeStandards), []);
});
test("validation rejects malformed, duplicate and dimensionally invalid time standards", () => {
  const r = record();
  for (const mutate of [x => x.timeMs = 0, x => x.timeMs = "250", x => x.kind = "relative_rfd", x => x.target = 101,
    x => x.context.force.unit = "N/s", x => x.context.force.definition = "unknown", x => x.referenceEnabled = "yes",
    x => x.ranges = D.parseRanges(">110 | 高 | green"), x => x.ranges = D.parseRanges("<-1 | 低 | red")]) {
    const invalid = rule(r); mutate(invalid); assert.throws(() => E.validateProfile(profile(r, [invalid])));
  }
  const standard = rule(r); assert.throws(() => E.validateProfile(profile(r, [standard, copy(standard)])));
  const valid = rule(r, "rfd", 250.5); valid.target = 20000; E.validateProfile(profile(r, [valid]));
  const invalidPrevious = profile(r, [rule(r)]); invalidPrevious.previous = { criteria: { imtpTimeStandards: [{ ...rule(r), timeMs: -1 }] } };
  assert.throws(() => E.validateProfile(invalidPrevious));
});
test("test-plan snapshots normalize without mutating history and validate stable IDs", () => {
  const r = record(); r.testPlanSnapshot = { id: "plan_1", name: "季度方案", testIds: ["imtp", "cmj"] };
  const normalized = M.normalizeRecord(r); M.validateRecord(normalized); assert.deepEqual(copy(normalized.testPlanSnapshot), r.testPlanSnapshot);
  normalized.testPlanSnapshot.testIds.push("imtp"); assert.throws(() => M.validateRecord(normalized));
  r.testPlanSnapshot.id = ""; assert.throws(() => M.validateRecord(r));
  delete r.testPlanSnapshot; M.validateRecord(r);
});
test("a shared custom scalar enable switch gates interval and target grades without deleting either setting", () => {
  const r = record(); r.enabled.imtp = false; r.customTests.push({ id: "gate_scalar", name: "自定义测试", category: "performance" }); r.enabled.gate_scalar = true;
  r.definitions.push({ id: "gate_value", testId: "gate_scalar", name: "数值", category: "performance", ability: "自定义能力", direction: "higher", unit: "次", target: 90, referenceEnabled: true, ranges: D.parseRanges("<60 | 预警 | red\n>=60 | 达标 | green"), source: "配置测试", protocol: "" });
  r.customValues.gate_value = { value: 70 }; const p = E.create(r), cfg = p.criteria.definitions.find(d => d.id === "gate_value");
  let rr = E.resolve(r, p), d = rr.definitions.find(d => d.id === cfg.id), s = M.stats(rr); assert.equal(M.evaluation(70, d, rr).status, "green"); near(M.attainment(70, d), 70 / 90 * 100); assert.equal(s.axes[0].status, "green");
  cfg.referenceEnabled = false; const settings = copy(cfg); rr = E.resolve(r, p); d = rr.definitions.find(d => d.id === cfg.id); s = M.stats(rr);
  assert.equal(M.evaluation(70, d, rr).status, "gray"); assert.equal(M.attainment(70, d), null); assert.equal(s.axes.length, 0); assert.equal(s.values.gate_value, 70); assert.equal(d.target, 90); assert.deepEqual(copy(d.ranges), settings.ranges); assert.deepEqual(copy(cfg), settings);
  cfg.referenceEnabled = true; cfg.ranges = []; rr = E.resolve(r, p); d = rr.definitions.find(d => d.id === cfg.id); assert.equal(M.evaluation(70, d, rr).status, "red"); assert.equal(M.stats(rr).axes[0].status, "red");
  cfg.referenceEnabled = false; rr = E.resolve(r, p); d = rr.definitions.find(d => d.id === cfg.id); assert.equal(M.evaluation(70, d, rr).status, "gray"); assert.equal(M.attainment(70, d), null); assert.equal(M.stats(rr).axes.length, 0); assert.equal(d.target, 90);
});

test("IMTP peak force extensions retain raw force and standards while a disabled target contributes no grade or axis", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 700)]; const p = E.create(r), cfg = p.criteria.definitions.find(d => d.id === "imtp_peak_force"); assert.equal(D.builtins.some(d => d.id === cfg.id), false);
  Object.assign(cfg, { target: 1500, referenceEnabled: true, ranges: D.parseRanges("<900 | 预警 | red\n>=900 | 达标 | green") });
  let rr = E.resolve(r, p), d = rr.definitions.find(d => d.id === cfg.id), s = M.stats(rr); assert.equal(M.evaluation(s.values.imtp_peak_force, d, rr).status, "green"); near(M.attainment(1000, d), 1000 / 1500 * 100); assert.equal(s.axes[0].status, "green");
  cfg.referenceEnabled = false; const settings = copy(cfg); rr = E.resolve(r, p); d = rr.definitions.find(d => d.id === cfg.id); s = M.stats(rr); assert.equal(M.evaluation(1000, d, rr).status, "gray"); assert.equal(M.attainment(1000, d), null); assert.equal(s.axes.length, 0); assert.equal(s.values.imtp_peak_force, 1000); assert.equal(s.raw.forceTime.timeRows[0].forcePercent, 70); assert.equal(d.target, 1500); assert.deepEqual(copy(d.ranges), settings.ranges); assert.deepEqual(copy(cfg), settings);
  cfg.referenceEnabled = true; cfg.ranges = []; rr = E.resolve(r, p); d = rr.definitions.find(d => d.id === cfg.id); assert.equal(M.evaluation(1000, d, rr).status, "red"); assert.equal(M.stats(rr).axes[0].status, "red");
});

test("legacy IMTP disabled time targets keep the table and ability radar consistently ungraded", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 500, "", 100)]; const p = E.create(r), cfg = p.criteria.definitions.find(d => d.id === "imtp_f100"); Object.assign(cfg, { target: 400, referenceEnabled: true, ranges: [] });
  let s = M.stats(E.resolve(r, p)); assert.equal(s.raw.forceTime.timeRows[0].forceEvaluation.status, "green"); assert.equal(s.axes.find(a => a.key === "早期发力").status, "green");
  cfg.referenceEnabled = false; s = M.stats(E.resolve(r, p)); assert.equal(s.raw.forceTime.timeRows[0].forceEvaluation.status, "gray"); assert.equal(s.axes.some(a => a.key === "早期发力"), false); assert.equal(s.values.imtp_f100, 500); assert.equal(s.raw.forceTime.timeRows[0].forcePercent, 50); assert.equal(cfg.target, 400);
  cfg.referenceEnabled = true; s = M.stats(E.resolve(r, p)); assert.equal(s.raw.forceTime.timeRows[0].forceEvaluation.status, "green"); assert.equal(s.axes.find(a => a.key === "早期发力").value, 100);
});

test("new percent of peak force standards retain their strict enable guard and physical percentages", () => {
  const r = record(); r.data.imtp = [trial("a", 1000, 450, "", 100)]; const cfg = rule(r, "force_pct_peak", 100), p = profile(r, [cfg]);
  let rr = E.resolve(r, p), s = M.stats(rr); assert.equal(s.raw.forceTime.timeRows[0].forceEvaluation.status, "red"); assert.equal(s.axes.find(a => a.key === "早期发力").status, "red");
  cfg.referenceEnabled = false; rr = E.resolve(r, p); s = M.stats(rr); const row = s.raw.forceTime.timeRows[0]; assert.equal(row.forceEvaluation.status, "gray"); assert.equal(row.forcePercent, 45); assert.equal(row.force, 450); assert.equal(M.evaluation(45, row.forceStandard, rr).status, "gray"); assert.equal(M.attainment(45, row.forceStandard), null); assert.equal(s.axes.some(a => a.key === "早期发力"), false); assert.equal(cfg.target, 90);
  cfg.referenceEnabled = true; s = M.stats(E.resolve(r, p)); assert.equal(s.raw.forceTime.timeRows[0].forceEvaluation.status, "red"); near(s.axes.find(a => a.key === "早期发力").value, 50);
});

test("measured disabled extension targets invalidate only the obsolete grading basis and preserve handwritten advice", () => {
  const r = record(); r.data.imtp = [trial("measured", 1000, 450, "", 100)];
  const p = E.create(r), cfg = p.criteria.definitions.find(d => d.id === "imtp_peak_force"); Object.assign(cfg, { referenceEnabled: false, target: 1500, ranges: [] });
  const effective = E.resolve(r, p), current = M.fingerprint(effective), legacy = JSON.parse(current);
  assert.equal(legacy.evaluationSwitchBasis, "disabled-extension-standards-v1"); delete legacy.evaluationSwitchBasis;
  r.narrative = { html: "<p>教练手写建议原文</p>", text: "教练手写建议原文", origin: "手写", revision: 3, basis: JSON.stringify(legacy) };
  const resolved = E.resolve(r, p), normalized = M.normalizeRecord(resolved);
  assert.notEqual(M.fingerprint(resolved), r.narrative.basis);
  for (const field of ["html", "text", "origin", "revision", "basis"]) assert.equal(normalized.narrative[field], r.narrative[field], field);
  assert.deepEqual(copy(resolved.data), copy(r.data));
  const now = JSON.parse(M.fingerprint(resolved)); delete now.evaluationSwitchBasis; assert.deepEqual(now, legacy);
});

test("unmeasured disabled or already enabled extension targets retain their historical grading basis", () => {
  const r = record(), p = E.create(r), cfg = p.criteria.definitions.find(d => d.id === "imtp_peak_force");
  Object.assign(cfg, { referenceEnabled: false, target: 1500 }); assert.equal(Object.hasOwn(JSON.parse(M.fingerprint(E.resolve(r, p))), "evaluationSwitchBasis"), false);
  r.data.imtp = [trial("measured", 1000, 450)]; cfg.referenceEnabled = true;
  assert.equal(Object.hasOwn(JSON.parse(M.fingerprint(E.resolve(r, p))), "evaluationSwitchBasis"), false);
  cfg.referenceEnabled = false; cfg.target = null; assert.equal(Object.hasOwn(JSON.parse(M.fingerprint(E.resolve(r, p))), "evaluationSwitchBasis"), false);
  r.enabled.imtp = false; cfg.target = 1500; assert.equal(Object.hasOwn(JSON.parse(M.fingerprint(E.resolve(r, p))), "evaluationSwitchBasis"), false);
});

test("a disabled percent replacement with its existing strict guard does not acquire an unrelated extension basis", () => {
  const r = record(); r.data.imtp = [trial("measured", 1000, 450, "", 100)];
  const cfg = { ...rule(r, "force_pct_peak", 100), referenceEnabled: false }, p = profile(r, [cfg]);
  assert.equal(Object.hasOwn(JSON.parse(M.fingerprint(E.resolve(r, p))), "evaluationSwitchBasis"), false);
  assert.equal(point(r, p, 100).forceEvaluation.status, "gray");
});

console.log(passed + " IMTP standards model checks passed");
