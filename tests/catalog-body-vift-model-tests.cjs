"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); context.window = context;
for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "model", "evaluation", "interventions"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), context);
const M = context.RingsideModel, T = context.RingsideTests, E = context.RingsideEvaluation, D = context.Def;
const copy = value => JSON.parse(JSON.stringify(value));
let count = 0;
function test(name, fn) { try { fn(); count++; console.log("PASS " + name); } catch (error) { console.error("FAIL " + name); throw error; } }
function near(actual, expected) { assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8, actual + " != " + expected); }
function record(...enabled) { const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = enabled.includes(id)); return r; }
const legacyProtocol = "跑台改良版：8 km/h 起，每级 +0.5 km/h，30 秒跑 / 15 秒被动恢复；记录最终完整级与未完成级持续时间。不得套用至折返版。";
const convertedProtocol = "跑台改良版：2.222222 m/s 起，每级 +0.138889 m/s，30 秒跑 / 15 秒被动恢复；记录最终完整级与未完成级持续时间。不得套用至折返版。";

test("legacy ability text is the stable key and screen projects receive editable categories", () => {
  const catalog = M.normalizeCatalog();
  assert.equal(T.describe(catalog).find(t => t.id === "fms").primaryAbility, "动作筛查");
  assert.equal(T.describe(catalog).find(t => t.id === "iso").primaryAbility, "等长力量");
  assert.equal(T.abilityLabel(catalog, "下肢爆发力"), "下肢爆发力");
  assert.ok(catalog.abilityGroups.some(g => g.key === "下肢爆发力"));
  assert.equal(M.validateCatalog(catalog), true);
});
test("primary classification is independent of metric abilities and works for empty projects", () => {
  const catalog = M.normalizeCatalog();
  catalog.abilityGroups.unshift({ key: "ability_custom", name: "身体控制" });
  catalog.tests.find(t => t.id === "cmj").primaryAbility = "ability_custom";
  catalog.tests.push({ id: "new_empty", name: "待配置项目", category: "performance", primaryAbility: "ability_custom", disabled: true });
  const normalized = M.normalizeCatalog(catalog), projects = T.describe(normalized);
  assert.equal(projects.find(t => t.id === "cmj").primaryAbility, "ability_custom");
  assert.equal(projects.find(t => t.id === "cmj").primaryAbilityLabel, "身体控制");
  assert.equal(normalized.definitions.find(d => d.id === "cmj_height").ability, "下肢爆发力");
  assert.equal(projects.find(t => t.id === "new_empty").disabled, true);
  assert.equal(projects.find(t => t.id === "new_empty").primaryAbility, "ability_custom");
  assert.equal(T.groups(projects.filter(p => p.category === "performance"))[0].key, "ability_custom");
});
test("renaming and ordering only affect newly captured ability snapshots", () => {
  const catalog = M.normalizeCatalog(), r = M.recordFromCatalog(catalog, {}, { cmj: true, mas: true });
  r.data.cmj[0].height = 40; r.data.mas.speed = 4;
  const before = M.fingerprint(r), snapshot = copy(r.abilityGroupSnapshot), criteria = E.signature(E.capture(r));
  catalog.abilityGroups.find(g => g.key === "下肢爆发力").name = "起跳爆发力";
  catalog.abilityGroups.reverse();
  const next = M.recordFromCatalog(catalog, {}, { cmj: true });
  assert.equal(T.abilityLabel(r, "下肢爆发力"), "下肢爆发力");
  assert.equal(T.abilityLabel(next, "下肢爆发力"), "起跳爆发力");
  assert.deepEqual(copy(r.abilityGroupSnapshot), snapshot);
  assert.equal(M.fingerprint(r), before);
  assert.equal(E.signature(E.capture(r)), criteria);
  assert.deepEqual(copy(M.normalizeRecord(r).abilityGroupSnapshot), snapshot);
  const envelope = M.recordEnvelope(r); envelope.record.abilityGroupSnapshot[0].name = "仅副本";
  assert.deepEqual(copy(r.abilityGroupSnapshot), snapshot);
});
test("old records do not acquire a current catalog snapshot or rewritten old project names", () => {
  const r = M.normalizeRecord(M.sampleRecord()); delete r.abilityGroupSnapshot;
  r.projectSnapshots.find(t => t.id === "ift").name = "30–15 IFT";
  r.projectSnapshots.find(t => t.id === "fms").primaryAbility = "";
  r.definitions.find(d => d.id === "ift_treadmill").name = "30–15 IFT·跑台改良版终末速度";
  r.definitions.find(d => d.id === "ift_treadmill").protocol = convertedProtocol;
  const before = M.fingerprint(r), normalized = M.normalizeRecord(r);
  assert.equal(Object.hasOwn(normalized, "abilityGroupSnapshot"), false);
  assert.equal(M.fingerprint(normalized), before);
  assert.equal(T.describe(normalized).find(t => t.id === "ift").name, "30-15VIFT");
  assert.equal(T.metricName(normalized.definitions.find(d => d.id === "ift_treadmill")), "30-15VIFT");
});
test("axis keys and ability scoring survive a renamed display label", () => {
  const r = record("cmj"); r.data.cmj[0].height = 40;
  r.definitions.find(d => d.id === "cmj_height").referenceEnabled = true;
  r.axes[T.axisKey("下肢爆发力")] = { method: "primary", primary: "cmj_height" };
  const original = M.stats(r).axes.find(a => a.key === "下肢爆发力");
  r.abilityGroupSnapshot = [{ key: "下肢爆发力", name: "起跳能力" }];
  const updated = M.stats(r).axes.find(a => a.key === "下肢爆发力");
  near(updated.value, original.value); assert.equal(updated.label, "起跳能力");
  assert.equal(updated.defs[0].id, original.defs[0].id);
  assert.equal(Object.keys(r.axes)[0], "ability:下肢爆发力");
  const demo = M.sampleRecord(), before = M.stats(demo), fingerprint = M.fingerprint(demo);
  demo.abilityGroupSnapshot = T.abilityGroups(demo).map(group => ({ key: group.key, name: "更名·" + group.name })).reverse();
  const after = M.stats(demo), axisFacts = s => s.axes.map(a => ({ key: a.key, value: a.value, status: a.status, metrics: a.defs.map(d => d.id) })).sort((a,b) => a.key.localeCompare(b.key));
  const findingFacts = s => s.findings.map(f => ({ id: f.id, ability: f.ability || "", status: f.status, region: f.region || "", sources: f.sources }));
  assert.deepEqual(copy(axisFacts(after)), copy(axisFacts(before)));
  assert.deepEqual(copy(findingFacts(after)), copy(findingFacts(before)));
  assert.deepEqual(copy(after.signals.regions), copy(before.signals.regions));
  assert.equal(M.fingerprint(demo), fingerprint);
});
test("ability metadata accepts legacy omissions and rejects malformed groups or conflicts", () => {
  const catalog = M.normalizeCatalog(); delete catalog.abilityGroups; delete catalog.abilityGroupConflicts;
  assert.equal(M.validateCatalog(catalog), true);
  catalog.abilityGroupConflicts = [{ key: "下肢爆发力", localName: "本地", incomingName: "导入" }];
  assert.deepEqual(copy(M.normalizeCatalog(catalog).abilityGroupConflicts), copy(catalog.abilityGroupConflicts));
  for (const groups of [null, {}, [{ key: "x", name: "" }], [{ key: "x", name: "A" }, { key: "x", name: "B" }]]) {
    const invalid = copy(catalog); invalid.abilityGroups = groups;
    assert.throws(() => M.validateCatalog(invalid)); assert.throws(() => M.normalizeCatalog(invalid));
    const r = record(); r.abilityGroupSnapshot = groups; assert.throws(() => M.validateRecord(r));
  }
  catalog.abilityGroupConflicts[0].incomingName = 1; assert.throws(() => M.validateCatalog(catalog));
});
test("record catalog merges retain imported custom group names and record same-key conflicts once", () => {
  const r = record(); r.customTests.push({ id: "custom_test", name: "新项目", category: "performance", primaryAbility: "ability_custom" });
  r.enabled.custom_test = true;
  r.definitions.push({ id: "custom_metric", testId: "custom_test", name: "数值", ability: "ability_custom", category: "performance", direction: "higher", unit: "次", target: null, referenceEnabled: false, ranges: [] });
  r.abilityGroupSnapshot = [{ key: "ability_custom", name: "自定义能力" }, { key: "下肢爆发力", name: "导入名称" }];
  const catalog = M.mergeCatalog(M.normalizeCatalog(), r);
  assert.equal(T.abilityLabel(catalog, "ability_custom"), "自定义能力");
  assert.equal(T.abilityLabel(catalog, "下肢爆发力"), "下肢爆发力");
  assert.equal(catalog.abilityGroupConflicts.filter(c => c.key === "下肢爆发力").length, 1);
  assert.deepEqual(copy(M.mergeCatalog(catalog, r).abilityGroupConflicts), copy(catalog.abilityGroupConflicts));
  const lib = M.normalizeLibrary(M.recordEnvelope(r));
  assert.deepEqual(copy(M.normalizeLibrary(lib)), copy(lib));
  assert.equal(T.abilityLabel(lib.athletes[0].records[0], "下肢爆发力"), "导入名称");
});
test("new VIFT records use the existing target metric while old missing bindings remain shuttle", () => {
  const r = M.recordFromCatalog(null, {}, { ift: true });
  assert.equal(r.data.ift.protocol, "treadmill"); assert.equal(r.data.ift.method, "");
  r.data.ift.speed = 6; assert.equal(M.stats(r).values.ift_treadmill, 6);
  const old = record("ift"); delete old.data.ift.protocol; old.data.ift.speed = 6;
  const normalized = M.normalizeRecord(old); assert.equal(normalized.data.ift.protocol, "shuttle");
  assert.equal(M.stats(normalized).values.ift_shuttle, 6);
  assert.equal(Object.hasOwn(normalized.data.ift, "method"), false);
});
test("VIFT names and descriptions change without changing any shipped threshold", () => {
  const d = M.defaults().definitions.find(d => d.id === "ift_treadmill");
  assert.equal(d.name, "30-15VIFT"); assert.equal(d.protocol, "30-15VIFT"); near(d.target, 23.5 / 3.6);
  near(d.ranges[0].max, 19.5 / 3.6); near(d.ranges[1].min, 20 / 3.6); near(d.ranges[1].max, 21.5 / 3.6);
  near(d.ranges[2].min, 22 / 3.6); near(d.ranges[2].max, 23 / 3.6); near(d.ranges[3].min, 23.5 / 3.6);
  assert.equal(d.referenceEnabled, false);
  assert.equal(D.viftProtocol("ift_shuttle", legacyProtocol), legacyProtocol);
});
test("exact old built-in VIFT descriptions match the neutral description in both directions", () => {
  for (const oldText of [legacyProtocol, convertedProtocol]) for (const reverse of [false, true]) {
    const r = record("ift"), d = r.definitions.find(d => d.id === "ift_treadmill");
    d.referenceEnabled = true; const p = E.create(r), rule = p.criteria.definitions.find(d => d.id === "ift_treadmill");
    (reverse ? d : rule.context)[reverse ? "protocol" : "metricProtocol"] = oldText;
    const effective = E.resolve(r, p).definitions.find(d => d.id === "ift_treadmill");
    assert.equal(effective.referenceEnabled, true); near(effective.target, 23.5 / 3.6);
  }
});
test("VIFT aliases never relax unit, record protocol, custom descriptions or metric IDs", () => {
  const r = record("ift"); r.data.ift.speed = 6; r.data.ift.protocol = "treadmill";
  r.definitions.find(d => d.id === "ift_treadmill").referenceEnabled = true;
  const profile = E.create(r);
  for (const mutate of [d => d.unit = "km/h", d => d.context.protocol = "另一个实际条件", d => d.context.metricProtocol = legacyProtocol + " 自定义"]) {
    const p = copy(profile), d = p.criteria.definitions.find(d => d.id === "ift_treadmill"); mutate(d); if (d.unit === "km/h") d.context.unit = "km/h";
    assert.equal(E.resolve(r, p).definitions.find(d => d.id === "ift_treadmill").referenceEnabled, false);
  }
  const onlyShuttle = copy(profile); onlyShuttle.criteria.definitions = onlyShuttle.criteria.definitions.filter(d => d.id !== "ift_treadmill");
  assert.equal(E.resolve(r, onlyShuttle).definitions.find(d => d.id === "ift_treadmill").target, null);
});
test("independent VIFT method survives repeated projections and export without selecting a standard", () => {
  const r = record("ift"); r.data.ift.method = "自填方法，不按旧名称推断";
  r.data.ift.trials = [{ id: "ift_a", speed: 5, unit: "m/s" }, { id: "ift_b", speed: 6, unit: "m/s" }];
  const profile = E.create(r), signature = E.signature(profile.criteria);
  for (const mode of ["best", "mean"]) {
    r.mode = mode; const normalized = M.normalizeRecord(M.recordEnvelope(r).record), s = M.stats(E.resolve(normalized, profile));
    assert.equal(s.representativeData.ift.method, r.data.ift.method);
    assert.equal(s.values.ift_treadmill, undefined); near(s.values.ift_shuttle, mode === "best" ? 6 : 5.5);
  }
  assert.equal(E.signature(E.capture(r)), signature);
  const invalid = copy(r); invalid.data.ift.method = 42; assert.throws(() => M.validateRecord(invalid));
});
test("body details use representative iso values, sides, asymmetry, target and missing directions", () => {
  const r = record("iso"), row = r.data.iso.find(x => x.region === "shoulder" && x.directionCode === "externalRotation");
  row.target = 120; row.notes = "方向备注";
  row.trials = [{ id: "a", left: 100, right: 150, notes: "第一试次" }, { id: "b", left: 200, right: 250, notes: "第二试次" }];
  let s = M.stats(r), detail = s.signals.regions.shoulder_l.tests.find(t => t.id === row.id + "_L");
  near(detail.value, 200); near(detail.asym, 20); near(detail.target, 120); assert.equal(detail.side, "L");
  assert.match(detail.notes, /方向备注/); assert.match(detail.notes, /第二试次/); assert.doesNotMatch(detail.notes, /第一试次/);
  assert.ok(s.signals.regions.shoulder_l.tests.some(t => t.missing));
  r.mode = "mean"; s = M.stats(r); detail = s.signals.regions.shoulder_l.tests.find(t => t.id === row.id + "_L");
  near(detail.value, 150); near(detail.asym, 25); assert.match(detail.notes, /第一试次/);
  const neck = s.signals.regions.neck.tests.find(t => t.side === "C"); assert.ok(neck && neck.missing);
});
test("body iso pain with a missing value remains visible and preserves grading", () => {
  const r = record("iso"), row = r.data.iso.find(x => x.region === "knee" && x.directionCode === "extension");
  row.left = ""; row.painLeft = true;
  const s = M.stats(r), region = s.signals.regions.knee_l, detail = region.tests.find(t => t.id === row.id + "_L");
  assert.equal(detail.missing, true); assert.equal(detail.pain, true); assert.equal(detail.status, "red");
  assert.equal(region.status, "red"); assert.ok(s.findings.some(f => f.region === "knee_l" && f.status === "red"));
});
test("body balances include measured and unavailable sides with their actual reasons", () => {
  const r = record("iso"), flex = r.data.iso.find(x => x.region === "knee" && x.directionCode === "flexion"), ext = r.data.iso.find(x => x.region === "knee" && x.directionCode === "extension");
  flex.left = 100; ext.left = 200; flex.right = 80; ext.right = "";
  const s = M.stats(r), left = s.signals.regions.knee_l.tests.find(t => t.id === "balance_knee_H_Q_L"), right = s.signals.regions.knee_r.tests.find(t => t.id === "balance_knee_H_Q_R");
  near(left.value, .5); assert.equal(left.unit, "比值"); assert.equal(left.missing, false);
  assert.equal(right.missing, true); assert.match(right.notes, /分母缺测/);
});
test("FMS details require an explicit region and retain bilateral raw scores and missing scores", () => {
  const r = record("fms"); r.data.fms[0].score = 2;
  assert.deepEqual(copy(M.stats(r).signals.regions), {});
  r.data.fms[1].location = "hip_l"; r.data.fms[1].left = 2; r.data.fms[1].right = 3; r.data.fms[1].notes = "观察备注";
  r.data.fms[2].location = "hip_l";
  const tests = M.stats(r).signals.regions.hip_l.tests;
  assert.equal(tests.length, 2); assert.equal(tests[0].side, "L"); assert.equal(tests[0].value, 2);
  assert.match(tests[0].notes, /左侧 2 \/ 右侧 3/); assert.match(tests[0].notes, /观察备注/);
  assert.equal(tests[1].missing, true); assert.equal(tests[0].target, null);
});
test("explicit custom screen regions include measured and missing results without changing findings", () => {
  const r = record(); r.customTests.push({ id: "reach", name: "上肢筛查", category: "screen" }); r.enabled.reach = true;
  for (const [id, region] of [["reach_l", "shoulder_l"], ["reach_r", "shoulder_r"]]) r.definitions.push({ id, testId: "reach", name: "活动度", category: "screen", ability: "活动控制", region, unit: "度", direction: "higher", target: 100, referenceEnabled: true, ranges: D.parseRanges("<100 | 受限 | red\n>=100 | 达标 | green") });
  r.customValues.reach_l = { value: 80, notes: "原始备注" };
  const before = JSON.stringify(r), s = M.stats(r), left = s.signals.regions.shoulder_l.tests[0], right = s.signals.regions.shoulder_r.tests[0];
  assert.equal(left.testName, "上肢筛查"); assert.equal(left.value, 80); assert.equal(left.label, "受限"); assert.equal(left.notes, "原始备注");
  assert.equal(right.missing, true); assert.equal(right.status, "gray");
  assert.equal(s.findings.filter(f => f.category === "screen").length, 1); assert.equal(JSON.stringify(r), before);
});
test("VIFT display adapters preserve independent custom names and context conditions", () => {
  const definition = { id: "ift_treadmill", name: "30–15 IFT·跑台改良版终末速度", protocol: convertedProtocol };
  const before = copy(definition); assert.equal(T.metricName(definition), "30-15VIFT"); assert.equal(T.metricProtocol(definition), "30-15VIFT");
  assert.deepEqual(definition, before);
  definition.name = "队内终末速度"; definition.context = { protocol: "自行填写的条件", metricProtocol: convertedProtocol };
  assert.equal(T.metricName(definition), "队内终末速度"); assert.equal(T.metricProtocol(definition), "自行填写的条件；30-15VIFT");
});
console.log(count + " catalog/body/VIFT model checks passed");
