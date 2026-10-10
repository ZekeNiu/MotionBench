"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); context.window = context;
for (const name of ["calc", "fvp", "sprint-fvp", "cpet-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`, "utf8"), context);
const M = context.RingsideModel, R = context.RingsideReport, V = context.RingsideViz, T = context.RingsideTests;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
const row = (html, id) => html.match(new RegExp('<tr data-row-id="hiit-' + id + '"[^>]*>[\\s\\S]*?</tr>'))?.[0] || "";
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function speedRecord(protocol = "shuttle") {
  const r = M.defaults(); r.data.mas.speed = 4; r.data.mss.speed = 8;
  Object.assign(r.data.ift, { speed: 18, unit: "km/h", protocol, partial: 12.5, method: "" }); return r;
}

test("both historical VIFT protocols use converted measured speed without modifying facts", () => {
  for (const protocol of ["shuttle", "treadmill"]) {
    const r = speedRecord(protocol), before = JSON.stringify(r), report = R.build(r), ref = report.speedReference;
    const value = (id, basis, field) => ref.rows.find(x => x.id === id)[field].find(x => x.basis === basis).values;
    assert.deepEqual(Array.from(value("long", "vift", "workSpeeds")), [4, 4.5]);
    assert.deepEqual(Array.from(value("short", "vift", "workSpeeds")), [4.5, 5.25]);
    near(value("rst", "vift", "recoverySpeeds")[0], 2.25);
    assert.equal(ref.metrics.find(x => x.testId === "ift").id, protocol === "treadmill" ? "ift_treadmill" : "ift_shuttle");
    const html = R.render(report);
    assert.match(html, /30-15VIFT/); assert.match(html, /未完成级 12\.5 秒/);
    assert.doesNotMatch(html, /折返版|跑台改良版|适用边界|不适用于|30[–-]15\s?IFT/);
    assert.equal(JSON.stringify(r), before);
  }
});

test("VIFT methods are optional escaped free text and never inferred from protocol", () => {
  for (const method of ["", "教练自定跑台方法", '<img src=x onerror="alert(1)">']) {
    const r = speedRecord("treadmill"); r.data.ift.method = method;
    const html = R.render(R.build(r));
    assert.doesNotMatch(html, /跑台改良版|折返版|<img src=x/);
    if (method) assert.ok(html.includes(method.startsWith("<") ? "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" : method));
  }
});

test("all missing-speed combinations retain available references for both VIFT protocols", () => {
  for (const protocol of ["shuttle", "treadmill"]) for (let mask = 0; mask < 8; mask++) {
    const r = speedRecord(protocol); r.data.mas.speed = mask & 1 ? 4 : ""; r.data.mss.speed = mask & 2 ? 8 : ""; r.data.ift.speed = mask & 4 ? 18 : "";
    const ref = R.build(r).speedReference;
    assert.equal(ref.available, !!mask);
    for (const format of ref.rows.filter(x => x.mas)) {
      assert.equal(format.workSpeeds.some(x => x.basis === "mas"), !!(mask & 1));
      assert.equal(format.workSpeeds.some(x => x.basis === "vift"), !!(mask & 4));
    }
    assert.equal(ref.srr !== null, (mask & 3) === 3);
  }
});

test("recovery alternatives and sourced RST examples remain explicit in every format", () => {
  const report = R.build(speedRecord()), html = R.render(report);
  assert.match(html, /<th scope="col">做功∶休息示例<\/th>/);
  assert.doesNotMatch(html, /做功∶休息参考/);
  for (const id of ["long", "short", "rst"]) {
    const text = row(html, id);
    assert.equal((text.match(/class="speed-recovery-option"/g) || []).length, 2);
    assert.match(text, /主动恢复[\s\S]*≤2\.40 m\/s[\s\S]*≤2\.25 m\/s[\s\S]*被动恢复/);
  }
  assert.match(row(html, "long"), /主动2–4分钟[\s\S]*被动1–3分钟/);
  assert.match(row(html, "short"), /主动10–60秒[\s\S]*被动10–60秒/);
  assert.match(row(html, "rst"), /主动15–60秒[\s\S]*被动15–60秒/);
  for (const id of ["sit", "game"]) assert.match(row(html, id), /data-label="恢复方式与速度">被动恢复<\/td>/);
  const ratios = report.speedReference.rows.find(x => x.id === "rst").ratios;
  assert.deepEqual(Array.from(ratios, x => [x.work, x.rest]), [[5, 20], [5, 15], [5, 30]]);
  for (const x of ratios.slice(1)) {
    assert.equal(x.recovery, "被动恢复");
    assert.match(report.speedReference.sources.find(s => s.id === x.sourceId).url, /10\.1371\/journal\.pone\.0171462/);
  }
  assert.match(row(html, "rst"), />1:3<[^]*?5秒／15秒[^]*?被动恢复/);
  assert.match(row(html, "rst"), />1:6<[^]*?5秒／30秒[^]*?被动恢复/);
});

test("every builtin project uses its captured display name without altering metrics or formulas", () => {
  const r = M.sampleRecord(); r.enabled = Object.fromEntries(T.builtins.map(test => [test.id, true]));
  // This test promises a measured result for every built-in project. The
  // legacy demonstration record intentionally has no newly added jump data.
  r.data.dj=[{id:"name-dj",height:30,contactTimeMs:150}];
  r.data.cmrj=[{id:"name-cmrj",firstHeight:35,height:25,contactTimeMs:125}];
  r.data.hop={id:"name-hop",inputMode:"summary",summary:{height:25,rsi:2,selectionBasis:"height_rsi"},jumps:[]};
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    r.fvpConfig[id].distanceCm = 33;
    r.data[id] = [0,20,40].map((load,index) => ({ id:"name_" + id + "_" + index, load, height:[33,27,22][index], excluded:false }));
  }
  // Synthetic standing acceleration: Vmax = 9 m/s, tau = 1.2 s.
  // The fixture is explicit because ordinary demonstration records have no sprint FVP data.
  r.athlete.height = 180;
  const sprintTimes = [1.3735406501017202, 2.1031246565401025, 3.3485505747362385, 4.505234882806160, 5.633470563022033];
  r.data.sprint_fvp = [{ id: "name_synthetic_sprint", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ distanceM, timeS: sprintTimes[i] })), excluded: false }];
  const before = R.build(r);
  r.projectSnapshots = T.snapshots(r).map(test => ({ ...test, name: "本次名称_" + test.id }));
  const report = R.build(r), html = R.render(report);
  for (const test of T.builtins) assert.ok(html.includes("本次名称_" + test.id), test.id + " missing captured display name");
  for (const id of ["fms", "iso", "imtp", "lactate"]) assert.ok(html.includes('<h3>本次名称_' + id + '</h3>'), id + " title");
  for (const id of ["mas", "mss", "ift"]) assert.ok(html.includes('data-speed-metric="' + id + '" class="viz-point" data-tooltip="本次名称_' + id), id + " chart");
  assert.ok(html.includes("本次名称_landmine R")); assert.ok(html.includes("本次名称_landmine L"));
  assert.deepEqual(JSON.parse(JSON.stringify(report.stats.values)), JSON.parse(JSON.stringify(before.stats.values)));
  assert.deepEqual(JSON.parse(JSON.stringify(report.speedReference.rows)), JSON.parse(JSON.stringify(before.speedReference.rows)));
  const legacy = speedRecord(); legacy.projectSnapshots = T.snapshots(legacy).map(test => test.id === "ift" ? { ...test, name: "30–15 IFT" } : test);
  assert.match(R.render(R.build(legacy)), /<h3>MAS \/ MSS \/ 30-15VIFT<\/h3>/);
  const escaped = V.speed({ mas: 4, labels: { mas: '<img src=x onerror="alert(1)">' } });
  assert.doesNotMatch(escaped, /<img|onerror="alert/); assert.match(escaped, /&lt;img/);
});

test("body region payload and accessible text retain every test, side, target and missing result", () => {
  const tests = Array.from({ length: 24 }, (_, i) => ({ id: "t" + i, testName: "各方位等长力量", name: "方向" + i,
    side: i % 2 ? "L" : "C", value: i ? 100 + i : null, unit: "N", target: 150, status: "amber", label: "关注", missing: !i,
    asym: i === 1 ? 18.5 : null, pain: i === 1, notes: i === 23 ? "最后一条备注完整保留" : "" }));
  const region = { status: "amber", label: "关注", tests }, html = V.body({ neck: region });
  const group = html.match(/<g class="viz-region" data-region="neck"[\s\S]*?<\/g>/)[0];
  const payload = group.match(/data-body-detail="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const decoded = JSON.parse(payload);
  assert.equal(decoded.tests.length, 24); assert.equal(decoded.name, "颈部"); assert.equal(decoded.key, "neck");
  assert.match(group, /方向23[^]*最后一条备注完整保留/); assert.match(group, /中线：未测/);
  assert.match(group, /左侧：101 N · 参考目标 150 N · 关注 · 双侧差异 18\.5% · 疼痛/);
  assert.doesNotMatch(group, /<title>/);
  assert.match(group, /r="24"[^>]*class="viz-hotspot"/);
  const popover = V.bodyTooltip(decoded);
  assert.equal((popover.match(/<li>/g) || []).length, 24); assert.match(popover, /最后一条备注完整保留/);
  assert.match(popover, /未测/); assert.match(popover, /参考目标 150 N/);
});

test("body tooltip escapes untrusted fields and green display uses the approved label", () => {
  const evil = '<img src=x onerror="alert(1)">', region = { name: evil, status: 'red" onclick="alert(1)', label: evil,
    tests: [{ name: evil, testName: evil, side: evil, value: 0, unit: evil, target: 1, label: evil, notes: evil }] };
  const html = V.bodyTooltip(region);
  assert.doesNotMatch(html, /<img|onclick="alert|onerror="alert/);
  assert.match(html, /&lt;img/); assert.match(html, /class="pill gray"/); assert.match(html, /0 &lt;img/);
  const green = V.body({ neck: { status: "green", label: "已测", hasMeasured: true } });
  assert.match(green, /aria-label="颈部：达标"/);
  assert.match(V.bodyTooltip({ status: "green", label: "已测" }), />达标<\/span>/);
  assert.match(V.bodyTooltip({ status:"gray",label:"部位名",tests:[{value:0,missing:false}] }), />已测<\/span>/);
  assert.match(V.bodyTooltip({ status:"gray",label:"部位名",tests:[{value:null,missing:true}] }), />未测<\/span>/);
});

test("report labels follow the record ability snapshot without changing stable group or metric keys", () => {
  const r = M.defaults(); r.data.imtp = [{ id: "trial", peakForce: 2000, timePoints: [] }];
  r.abilityGroupSnapshot = [{ key: "最大力量", name: "力量能力 · 本次名称" }];
  const report = R.build(r), html = R.render(report);
  assert.match(html, /力量能力 · 本次名称/);
  assert.ok(html.includes('id="' + T.groupId("最大力量") + '"'));
  assert.ok(html.includes('data-metric-id="imtp_peak_force"'));
  assert.equal(report.projects.find(x => x.id === "imtp").primaryAbility, "最大力量");
});

test("IMTP keeps its shared pair layout with every measured metric and three-trial statistic", () => {
  for (const count of [1, 3]) {
    const r = M.defaults(); r.athlete.mass = 72.5;
    r.data.imtp = Array.from({ length: count }, (_, i) => ({ id: "layout-" + i, peakForce: 2000 + i * 100,
      timePoints: [{ timeMs: 100, force: 500 + i * 20, rfd: 5000 + i * 200 }, { timeMs: 200, force: 1000 + i * 40, rfd: 5000 + i * 200 }] }));
    const report = R.build(r), html = R.render(report);
    assert.match(html, /class="detail-pair imtp-detail" data-pdf-pair/);
    assert.doesNotMatch(html, /imtp-detail wide-results/);
    for (const id of ["imtp_peak_force", "imtp_relative_force", "imtp_f100", "imtp_rfd100", "imtp_f200", "imtp_rfd200"])
      assert.ok(html.includes('data-metric-id="' + id + '"'));
    assert.equal(html.includes('class="imtp-results with-repeat-columns"'), count === 3);
    if (count === 3) { assert.match(html, /均值 ± SD/); assert.match(html, /<th scope="col">CV<\/th>/); }
  }
});

console.log(`${passed} report 2.10 model checks passed`);
