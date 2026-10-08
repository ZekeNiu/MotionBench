"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto });
context.window = context;
for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`, "utf8"), context);
const M = context.RingsideModel, R = context.RingsideReport, E = context.RingsideEvaluation, D = context.Def;
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
function imtp(rows, mode = "best") {
  const record = M.defaults(); record.mode = mode; record.athlete.mass = 80;
  record.enabled = Object.fromEntries(Object.keys(record.enabled).map(id => [id, id === "imtp"]));
  record.data.imtp = rows.map((row, index) => ({ id: "trial_" + index, ...row,
    timePoints: (row.timePoints || []).map((point, i) => ({ id: "point_" + index + "_" + i, ...point })) }));
  return record;
}
const body = report => R.render(report).match(/<article class="test-block" id="detail-imtp"[\s\S]*?<\/article>/)?.[0] || "";
const primary = report => body(report).split('<div class="repeat-panel"')[0];
const row = (html, id) => html.match(new RegExp('<tr data-metric-id="' + id + '">[\\s\\S]*?</tr>'))?.[0] || "";
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} != ${expected}`);

test("first summary card uses the test snapshot and preserves three assessment cards", () => {
  const record = M.defaults(); Object.assign(record.athlete, { name: "王<明>", sport: "拳击", age: 21, mass: 72.5, sex: "男" });
  const before = JSON.stringify(record), html = R.summary(R.build(record));
  assert.match(html, /^<article class="micro-card athlete-summary">/);
  for (const text of ["运动员信息", "王&lt;明&gt;", "拳击", "21 岁", "72.5 kg", "重点关注", "关注", "优势"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<article /g) || []).length, 4);
  assert.doesNotMatch(html, /测试情况概述/);
  assert.equal(JSON.stringify(record), before);
});

test("IMTP uses one ordered table and removes unrecorded time-point types", () => {
  const record = imtp([{ peakForce: 2000, timePoints: [{ timeMs: 250, rfd: 4000 }, { timeMs: 100, force: 750 }] }]);
  const html = primary(R.build(record));
  assert.equal((html.match(/<table\b/g) || []).length, 1);
  const ids = [...html.matchAll(/<tr data-metric-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, ["imtp_peak_force", "imtp_relative_force", "imtp_f100", "imtp_rfd250"]);
  assert.ok(row(html, "imtp_rfd250").includes("4,000.00"));
  assert.equal(row(html, "imtp_f250"), ""); assert.equal(row(html, "imtp_rfd100"), "");
  assert.doesNotMatch(html, /class="imtp-time-results/);
});

test("RFD conversion remains in the chart while only recorded RFD and PF enter the table", () => {
  const report = R.build(imtp([{ peakForce: 2000, baselineForce: 100, timePoints: [{ timeMs: 100, rfd: 4000 }] }]));
  const html = primary(report);
  assert.ok(row(html, "imtp_peak_force")); assert.ok(row(html, "imtp_relative_force")); assert.ok(row(html, "imtp_rfd100"));
  assert.equal(row(html, "imtp_f100"), "");
  assert.match(html, /data-force-n="500"[^>]*data-derived="true"/);
});

test("RFD follows the PF representative trial and missing PF remains only in raw details", () => {
  const record = imtp([
    { peakForce: 2000, timePoints: [{ timeMs: 250, rfd: 9000 }] },
    { peakForce: 3000, timePoints: [{ timeMs: 250, rfd: 4000 }] },
    { timePoints: [{ timeMs: 250, rfd: 12000 }] },
  ]);
  assert.ok(row(primary(R.build(record)), "imtp_rfd250").includes("4,000.00"));
  record.mode = "mean";
  assert.ok(row(primary(R.build(record)), "imtp_rfd250").includes("6,500.00"));
  const partial = R.build(imtp([{ timePoints: [{ timeMs: 250, rfd: 4321 }] }]));
  assert.doesNotMatch(primary(partial), /data-metric-id="imtp_rfd250"/);
  assert.match(body(partial), /4,321/);
});

test("table, standards and percentage chart share within-trial percentages", () => {
  const record = imtp([
    { peakForce: 1000, timePoints: [{ timeMs: 250, force: 900 }] },
    { peakForce: 3000, timePoints: [{ timeMs: 250, force: 1500 }] },
  ], "mean");
  const profile = E.create(record);
  profile.criteria.imtpTimeStandards = [{ timeMs: 250, kind: "force_pct_peak", context: E.imtpTimeContext(record),
    target: 70, ranges: D.parseRanges("<70 | 待提升 | red\n>=70 | 达标 | green"), direction: "higher", referenceEnabled: true, source: "本次验收标准" }];
  const report = R.build(E.resolve(record, profile)), point = report.stats.raw.forceTime.timeRows[0];
  near(point.forcePercent, 70); near(point.force, 1200);
  const html = primary(report), forceRow = row(html, "imtp_f250");
  assert.match(forceRow, /1,200.00/); assert.match(forceRow, /占峰值力 70.0%/); assert.match(forceRow, /达标/); assert.match(forceRow, /70.00 %/);
  assert.match(html, /data-force-percent="70"/);
  record.data.imtp[1].timePoints = [];
  const missing = R.build(E.resolve(record, profile)); near(missing.stats.raw.forceTime.timeRows[0].forcePercent, 90);
  assert.match(primary(missing), /data-force-percent="90"/);
});

test("repeat statistics retain the three-valid-values gate with no n text", () => {
  for (const count of [1, 2, 3, 4]) {
    const record = imtp(Array.from({ length: count }, (_, i) => ({ peakForce: 2000 + i * 100, timePoints: [{ timeMs: 100, force: 700 + i * 10 }] })));
    const report = R.build(record), html = primary(report);
    assert.equal(html.includes("均值 ± SD"), count >= 3);
    assert.doesNotMatch(html, /\bn=\d/);
    assert.equal((html.match(/data-repeat-stat=/g) || []).length, count >= 3 ? 3 : 0);
  }
});

test("custom IMTP metrics are last in the same table, without duplicated supplemental tables", () => {
  const record = imtp([{ peakForce: 2000, timePoints: [{ timeMs: 250, force: 900 }] }]);
  record.definitions.push({ id: "imtp_custom_note_value", testId: "imtp", name: "自定测量", unit: "cm", category: "performance", ability: "最大力量", direction: "higher", ranges: [], target: null, referenceEnabled: false });
  record.customValues.imtp_custom_note_value = { value: 12, notes: "教练备注保留" };
  const html = primary(R.build(record));
  assert.equal((html.match(/<table\b/g) || []).length, 1);
  assert.ok(html.indexOf('data-metric-id="imtp_custom_note_value"') > html.indexOf('data-metric-id="imtp_f250"'));
  assert.match(html, /教练备注保留/);
});

test("long raw IMTP trials split at time points and retain metadata and notes once", () => {
  const record = imtp([{ peakForce: 2000, notes: "原始备注唯一标记", timePoints: Array.from({ length: 30 }, (_, i) => ({ timeMs: 25.5 + i * 25, force: 500 + i * 20 })) },
    { peakForce: 2200, timePoints: [{ timeMs: 25.5, rfd: 4321 }] }]);
  const raw = body(R.build(record)).split('<div class="repeat-panel"')[1];
  assert.equal((raw.match(/<tbody>[\s\S]*?<\/tbody>/)[0].match(/<tr\b/g) || []).length, 31);
  assert.equal((raw.match(/原始备注唯一标记/g) || []).length, 1);
  assert.match(raw, /25.5 ms/); assert.match(raw, /750.5 ms/);
  assert.match(raw, /4,321.00 N\/s/);
});

function speedRecord() { const record = M.defaults(); record.data.mas.speed = 4; record.data.mss.speed = 8; Object.assign(record.data.ift, { speed: 5, protocol: "shuttle" }); return record; }
const trainingRow = (html, id) => html.match(new RegExp('<tr data-row-id="hiit-' + id + '"[^>]*>[\\s\\S]*?</tr>'))?.[0] || "";
test("HIIT has complete approved goal combinations, timings and retained work-rest examples", () => {
  const report = R.build(speedRecord()), html = R.render(report);
  const expected = {
    long: ["有氧能力＋无氧能力", "有氧能力＋无氧能力＋神经肌肉刺激"],
    short: ["有氧能力", "有氧能力＋神经肌肉刺激", "有氧能力＋无氧能力", "有氧能力＋无氧能力＋神经肌肉刺激"],
    rst: ["有氧能力＋无氧能力＋神经肌肉刺激", "无氧能力＋神经肌肉刺激"],
    sit: ["无氧能力＋神经肌肉刺激"],
    game: ["有氧能力＋神经肌肉刺激", "有氧能力＋无氧能力", "有氧能力＋无氧能力＋神经肌肉刺激"],
  };
  for (const [id, goals] of Object.entries(expected)) {
    const content = trainingRow(html, id);
    assert.deepEqual([...content.matchAll(/class="speed-goal">([^<]+)<\/span>/g)].map(match => match[1]), goals);
    assert.doesNotMatch(content, /可含|随规则|无氧糖酵解|有氧刺激随方案/);
  }
  assert.equal(report.speedReference.rows.find(item => item.id === "rst").targets, "④⑤");
  for (const id of ["sit", "game"]) {
    assert.match(trainingRow(html, id), /data-label="恢复方式与速度">被动恢复<\/td>/);
    assert.doesNotMatch(trainingRow(html, id), /0（被动恢复）/);
  }
  assert.match(trainingRow(html, "game"), /全力以赴/);
  assert.match(trainingRow(html, "long"), /主动2–4分钟[\s\S]*被动1–3分钟/);
  assert.equal((html.match(/实测最大冲刺速度（MSS）/g) || []).length, 2);
  assert.match(html, /做功∶休息示例/); assert.match(html, /30秒／4分钟/);
});

test("MAS and VIFT percentages stay visible when their personal speed is missing", () => {
  for (const protocol of ["shuttle", "treadmill"]) {
    const record = speedRecord(); record.data.ift.protocol = protocol;
    record.data.ift.speed = "";
    const html = R.render(R.build(record)), long = trainingRow(html, "long"), short = trainingRow(html, "short");
    assert.match(long, /最大有氧速度（MAS）的95–105%/); assert.match(long, /30-15VIFT的80–90%/);
    assert.match(short, /30-15VIFT的90–105%/);
    assert.match(long, /30-15VIFT的≤45%/);
    assert.doesNotMatch(long, /data-speed-basis="vift"/);
    assert.match(long, /3.80–4.20 m\/s/);
  }
  const record = speedRecord(); record.data.mas.speed = "";
  const long = trainingRow(R.render(R.build(record)), "long");
  assert.match(long, /最大有氧速度（MAS）的95–105%/);
  assert.doesNotMatch(long, /data-speed-basis="mas"/);
  assert.match(long, /4.00–4.50 m\/s/);
});

console.log(`${passed} report refinement model checks passed`);
