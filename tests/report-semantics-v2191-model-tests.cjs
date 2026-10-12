"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/tests/v2191-semantics");
const modules = ["calc", "fvp", "sprint-fvp", "sprint-elasticity", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions"];
function context(revision) {
  const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
  for (const name of modules) {
    const file = "src/ringside-" + name + ".js";
    vm.runInContext(revision ? execFileSync("git", ["show", revision + ":" + file], { cwd: root, encoding: "utf8" }) : fs.readFileSync(path.join(root, file), "utf8"), c, { filename: file });
  }
  return c;
}
const c = context(), M = c.RingsideModel, copy = value => JSON.parse(JSON.stringify(value));
const checks = [], evidence = [], digest = file => createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
function test(name, fn) { fn(); checks.push(name); console.log("PASS " + name); }
function near(actual, expected) { assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9, actual + " != " + expected); }
function only(...ids) { const r = M.defaults(); Object.keys(r.enabled).forEach(id => r.enabled[id] = ids.includes(id)); return r; }
function eurRecord(height = 44) {
  const r = only("cmj", "sj"); r.data.cmj = [{ id: "c", height }]; r.data.sj = [{ id: "s", height: 40 }]; r.views.capabilitySelections.strength = "eur"; return r;
}
const derived = (r, id) => M.stats(r).derived.results.find(item => item.id === id);
const direction = (r, id) => M.capabilityDirections(r).find(item => item.id === id);
function jumpProfile(r, id = "fvp_sj") {
  r.enabled[id] = true; r.athlete.mass = 72; r.fvpConfig[id].distanceCm = 33;
  r.data[id] = [0, 20, 40, 60, 80].map((load, i) => ({ id: id + i, load, height: [33, 27, 22, 14, 10][i] }));
}
function sprintProfile(r) {
  r.enabled.sprint_fvp = true; r.athlete.mass = 75; r.athlete.height = 180;
  const times = [1.3735406501017202, 2.1031246565401025, 3.3485505747362385, 4.50523488280616, 5.633470563022033];
  r.data.sprint_fvp = [{ id: "sprint", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ distanceM, timeS: times[i] })) }];
}

test("unrounded EUR and gain share the approved greater-than rule at both sides and equality", () => {
  for (const [height, expected] of [[43.99999, "需要强调利用 SSC 的能力"], [44, "需要强调利用 SSC 的能力"], [44.00001, "需要强调向心能力"]]) {
    const r = eurRecord(height), before = JSON.stringify(r), s = M.stats(r);
    const eur = s.derived.results.find(item => item.id === "eur"), gain = s.derived.results.find(item => item.id === "gain");
    assert.equal(eur.value, height / 40); near(gain.value, (height / 40 - 1) * 100);
    assert.equal(eur.directionHint, expected); assert.equal(gain.directionHint, expected);
    assert.equal(eur.directionRuleId, "eur-height-1.1-v1"); assert.equal(gain.directionRuleId, eur.directionRuleId);
    assert.equal(s.capabilityCards.find(card => card.id === "strength").metrics.find(item => item.id === "eur").judgment, expected);
    assert.equal(M.capabilityDirections(r, s).find(item => item.id === "strength").judgment, expected);
    assert.equal(eur.value.toFixed(3), "1.100"); assert.equal(JSON.stringify(r), before);
    evidence.push({ height, sjHeight: 40, eur: eur.value, gain: gain.value, judgment: expected });
  }
});
test("best and mean modes retain their representative measurements and judge the resulting EUR", () => {
  const r = eurRecord(); r.data.cmj.push({ id: "c2", height: 40 }); r.data.sj.push({ id: "s2", height: 42 });
  r.mode = "best"; near(derived(r, "eur").value, 44 / 42); assert.equal(derived(r, "eur").directionHint, "需要强调利用 SSC 的能力");
  r.mode = "mean"; near(derived(r, "eur").value, 42 / 41); assert.equal(derived(r, "gain").directionHint, derived(r, "eur").directionHint);
});
test("gain remains meaningful when the EUR display is disabled and missing heights create no direction", () => {
  const r = eurRecord(45); r.derivedEnabled.eur = false;
  assert.equal(derived(r, "eur"), undefined); assert.equal(derived(r, "gain").directionHint, "需要强调向心能力");
  r.data.sj = []; const gain = derived(r, "gain"); assert.equal(gain.available, false); assert.equal(gain.value, null); assert.equal(gain.directionHint, ""); assert.match(gain.reason, /CMJ.*SJ/);
});
test("unrelated editable grades cannot replace the fixed EUR training direction", () => {
  const r = eurRecord(45); r.definitions.push({ id: "eur", testId: "cmj", name: "其他等级", unit: "比值", referenceEnabled: true, ranges: [{ min: null, max: null, label: "另一评级", status: "green" }] });
  assert.equal(direction(r, "strength").judgment, "需要强调向心能力");
});
test("direction basis carries the stable rule identity while measurement fingerprints remain unchanged", () => {
  const r = eurRecord(), fingerprint = M.fingerprint(r), basis = JSON.parse(M.capabilityDirectionsBasis(r));
  assert.deepEqual(copy(basis.directionRules), { eur: M.eurDirectionRuleId });
  const old = copy(basis); delete old.directionRules; assert.notEqual(JSON.stringify(old), M.capabilityDirectionsBasis(r));
  const before = M.capabilityDirectionsBasis(r); r.views.radar = !r.views.radar;
  assert.equal(M.capabilityDirectionsBasis(r), before); assert.equal(M.fingerprint(r), fingerprint);
  r.narrative = { ...r.narrative, origin: "manual", text: "人工分析保留", html: "<p>人工分析保留</p>" };
  assert.equal(M.normalizeRecord(copy(r)).narrative.text, "人工分析保留");
});
test("all sixteen data combinations expose exactly the categories that contain valid parameters", () => {
  const keys = ["strength", "reactive", "speed", "endurance"];
  for (let mask = 0; mask < 16; mask++) {
    const r = only();
    if (mask & 1) { r.enabled.cmj = r.enabled.sj = true; r.data.cmj = [{ id: "c", height: 44 }]; r.data.sj = [{ id: "s", height: 40 }]; }
    if (mask & 2) { r.enabled.dj = true; r.data.dj = [{ ...M.newJumpAttempt("dj"), activeStiffness: 29 }]; }
    if (mask & 4) { r.enabled.mss = true; r.data.mss.speed = 8.5; }
    if (mask & 8) { r.enabled.cpet = true; r.data.cpet.vo2 = 50; }
    const before = JSON.stringify(r), directions = M.capabilityDirections(r);
    for (const [i, key] of keys.entries()) assert.equal(directions.find(item => item.id === key).hasData, !!(mask & (1 << i)), mask + "/" + key);
    assert.equal(JSON.stringify(r), before); evidence.push({ mask, categories: directions.filter(item => item.hasData).map(item => item.id) });
  }
});
test("an explicitly missing selected metric preserves a card with other valid parameters", () => {
  const r = eurRecord(); r.views.capabilitySelections.strength = "fvp";
  const item = direction(r, "strength"); assert.equal(item.hasData, true); assert.equal(item.metricId, "fvp"); assert.equal(item.value, null); assert.equal(item.judgment, "待计算");
});
test("independent Active Stiffness and partial MSS keep their groups without fabricating selected RSI or SRR", () => {
  const r = only("hop", "mss"), h = M.newHopSet(); h.inputMode = "jumps"; h.summary.activeStiffness = 31; r.data.hop = { trials: [h] }; r.data.mss.speed = 8.5;
  r.views.capabilitySelections = { strength: "fvp", reactive: "dj_rsi", speed: "srr" };
  for (const key of ["reactive", "speed"]) { const item = direction(r, key); assert.equal(item.hasData, true); assert.equal(item.value, null); assert.equal(item.judgment, "待计算"); }
});
test("partial CPET endpoints and lactate-only data independently keep the endurance card", () => {
  for (const fill of [r => r.data.cpet.peakHr = 180, r => r.data.cpet.thresholds.first.speed = 3.5]) {
    const r = only("cpet"); r.data.cpet.modality = "treadmill"; fill(r); const item = direction(r, "endurance"); assert.equal(item.hasData, true); assert.ok(Number.isFinite(item.value));
  }
  const r = only("lactate"); r.thresholds.lt1 = 3.5; assert.equal(direction(r, "endurance").hasData, true);
});
test("valid FVP profiles retain their groups while partial inputs are not valid category data", () => {
  const jump = only(); jumpProfile(jump); assert.equal(M.stats(jump).fvp.fvp_sj.valid, true); assert.equal(direction(jump, "strength").hasData, true);
  jump.views.fvpProtocol = "fvp_cmj"; jump.views.capabilitySelections.strength = "fvp";
  assert.equal(direction(jump, "strength").hasData, true);
  const sprint = only(); sprintProfile(sprint); assert.equal(M.stats(sprint).sprintFvp.valid, true); assert.equal(direction(sprint, "speed").hasData, true);
  sprint.data.sprint_fvp[0].splits = sprint.data.sprint_fvp[0].splits.slice(0, 1); assert.equal(direction(sprint, "speed").hasData, false);
  jump.data.fvp_sj = jump.data.fvp_sj.slice(0, 2); assert.equal(direction(jump, "strength").hasData, false);
});
test("disabled valid data and notes-only drafts do not retain empty cards", () => {
  const r = eurRecord(45); r.enabled.cmj = r.enabled.sj = false;
  assert.equal(M.capabilityDirections(r).some(item => item.hasData), false);
  r.enabled.fvp_sj = true; r.data.fvp_sj = [{ id: "note", notes: "测试记录备注" }];
  assert.equal(direction(r, "strength").hasData, false);
});
test("fDSI boundaries and independently matched iDSI windows retain their calculations", () => {
  const r = eurRecord(); Object.assign(r.dsi, { source: "manual", force: 2000, unit: "N", definition: "gross", confirmed: true });
  for (const [force, expected] of [[1199.999, "发展弹道与快速力量"], [1200, "并行发展最大力量与快速力量"], [1600, "并行发展最大力量与快速力量"], [1600.001, "发展最大力量"]]) {
    r.data.cmj[0].force = force; assert.equal(derived(r, "fdsi").directionHint, expected); near(derived(r, "fdsi").value, force / 2000);
  }
  r.enabled.imtp = true; Object.assign(r.data.cmj[0], { propulsiveImpulse: 300, propulsiveDurationMs: 200 });
  r.data.imtp = [{ id: "i", peakForce: 2500, matchedImpulse: 350, matchedDurationMs: 200, impulse250: 400 }]; r.impulseConfig.confirmed = true;
  near(derived(r, "idsi_matched").value, 300 / 350); near(derived(r, "idsi_fixed250").value, .75);
  assert.equal(derived(r, "idsi_matched").directionHint, "CMJ 完整推进期冲量为 IMTP 匹配时窗冲量的 85.7%。");
  assert.equal(derived(r, "idsi_fixed250").directionHint, "CMJ 完整推进期冲量为 IMTP 0–250 ms 冲量的 75%。");
  r.data.imtp[0].matchedDurationMs = 250; assert.equal(derived(r, "idsi_matched").available, false); near(derived(r, "idsi_fixed250").value, .75);
  assert.match(derived(r, "idsi_matched").reason, /时窗/); assert.equal(derived(r, "idsi_matched").directionHint, "");
});
test("RQR retains its independent FT/CT ranking and concrete difference result", () => {
  const r = only("dj", "hop"); r.mode = "mean";
  r.data.dj = [0, 1, 2].map(i => ({ id: "d" + i, height: 30, contactTimeMs: 200, flightTimeMs: 400, dropHeightCm: 45 }));
  const h = M.newHopSet(); h.inputMode = "jumps"; h.jumps = Array.from({ length: 10 }, (_, i) => ({ id: "h" + i, height: 100 - i * 5, contactTimeMs: 100, flightTimeMs: 100 + i * 100 })); r.data.hop = { trials: [h] };
  const item = derived(r, "rqr"); near(item.value, .25); assert.equal(item.protocolMatch, true); assert.equal(item.directionHint, "DJ 腾空／触地时间比较 Hop 低 75.0%。");
});
test("SRR boundaries and independent MSS and MAS goals retain the existing training direction", () => {
  const r = only("mss", "mas"); r.data.mas.speed = 5;
  for (const id of ["mss_speed", "mas_speed"]) r.definitions.find(item => item.id === id).referenceEnabled = false;
  for (const [ratio, expected] of [[1.699, "耐力型结构 · 速度储备相对较小"], [1.7, "混合型结构 · 速度储备居中"], [1.8, "混合型结构 · 速度储备居中"], [1.801, "速度型结构 · 速度储备相对较大"]]) {
    r.data.mss.speed = 5 * ratio; assert.equal(derived(r, "srr").directionHint, expected);
  }
  Object.assign(r.definitions.find(item => item.id === "mss_speed"), { referenceEnabled: true, target: 10 });
  assert.equal(derived(r, "srr").directionHint, "优先发展冲刺速度（MSS）。");
  r.data.mss.speed = 4; assert.match(derived(r, "srr").directionHint, /MSS 低于 MAS/);
});
test("unset references state their real status while valid CPET targets remain actionable", () => {
  const r = only("dj", "cpet"); r.data.dj = [{ id: "dj", height: 30, contactTimeMs: 200 }]; r.views.capabilitySelections.reactive = "dj_rsi";
  r.definitions.find(item => item.id === "dj_rsi").referenceEnabled = false; assert.equal(direction(r, "reactive").judgment, "已测量 · 未设置评价标准");
  r.data.cpet.vo2 = 50; for (const item of r.definitions.filter(item => item.testId === "cpet")) item.referenceEnabled = false;
  assert.equal(direction(r, "endurance").judgment, "已测量 · 未设置适用目标");
  Object.assign(r.definitions.find(item => item.id === "cpet_vo2_relative"), { referenceEnabled: true, referenceMode: "standard", target: 60 });
  assert.equal(direction(r, "endurance").judgment, "优先提高 VO₂peak。");
});
test("local guidance uses actual FMS progression and never invents a maintenance conclusion from ungraded data", () => {
  const r = only("fms"); r.data.fms[0].score = 2;
  assert.match(M.localText(r), /以无代偿完成原测试动作为进阶条件/); assert.doesNotMatch(M.localText(r), /评分本身不能|由教练据此/);
  const raw = only("imtp"); raw.data.imtp = [{ id: "i", peakForce: 1500 }]; raw.definitions.forEach(item => { item.referenceEnabled = false; item.target = ""; });
  const text = M.localText(raw); assert.match(text, /先完成已测项目评价，再安排训练重点/);
  assert.doesNotMatch(text, /维持已有训练安排|将上述练习|当前没有明确触发评价/);
});
test("the revised fixture preserves every original scientific value and declares the approved wording override", () => {
  const originalFile = "tests/fixtures/capability-direction-values-v2175.json", original = JSON.parse(fs.readFileSync(path.join(root, originalFile), "utf8"));
  const approved = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/capability-direction-values-v2191.json"), "utf8"));
  assert.equal(approved.approvedJudgmentPolicy.numericBaselineSha256, digest(originalFile)); assert.equal(approved.approvedJudgmentPolicy.eurRuleId, M.eurDirectionRuleId);
  const scientific = fixture => fixture.cases.map(item => ({ name: item.name, directions: item.directions.map(({ judgment, ...metric }) => metric) }));
  assert.deepEqual(scientific(approved), scientific(original));
});
test("all numerical measurements, scores and FVP response values match the published 2.19.0 model", () => {
  const previous = context("v2.19.0").RingsideModel;
  const r = M.sampleRecord(); jumpProfile(r, "fvp_sj"); jumpProfile(r, "fvp_cmj"); sprintProfile(r);
  function numbers(value) {
    if (typeof value === "number") return value;
    if (Array.isArray(value)) return value.map(numbers);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, numbers(item)]).filter(([, item]) => item !== undefined));
    return undefined;
  }
  const a = numbers(copy(previous.stats(copy(r)))), b = numbers(copy(M.stats(copy(r)))); assert.deepEqual(b, a);
  evidence.push({ scientificBaseline: "v2.19.0", numericalProjectionEqual: true });
});

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "model-results.json"), JSON.stringify({ synthetic: true, externalAIRequested: false, sourceHashes: Object.fromEntries(modules.map(name => ["src/ringside-" + name + ".js", digest("src/ringside-" + name + ".js")])), testSha256: digest("tests/report-semantics-v2191-model-tests.cjs"), ruleId: M.eurDirectionRuleId, checksPassed: checks.length, checks, evidence }, null, 2));
console.log(checks.length + " report semantics 2.19.1 model checks passed");
