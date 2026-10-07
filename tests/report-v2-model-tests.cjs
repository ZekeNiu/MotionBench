"use strict";
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const c = vm.createContext({
  console,
  Intl,
  crypto: require("node:crypto").webcrypto,
});
c.window = c;
for (const name of [
  "calc",
  "definitions",
  "tests",
  "model",
  "interventions",
  "viz",
  "report",
])
  vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`, "utf8"), c);
const M = c.RingsideModel,
  R = c.RingsideReport,
  T = c.RingsideTests;
let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log("PASS " + name);
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("joint radar normalizes each direction before equal averaging and retains provenance", () => {
  const r = M.defaults();
  r.data.iso = [
    {
      id: "one",
      region: "shoulder",
      direction: "外旋",
      paired: true,
      left: 60,
      right: 100,
      target: 100,
      unit: "N",
    },
    {
      id: "two",
      region: "shoulder",
      direction: "内旋",
      paired: true,
      left: 10,
      right: 10,
      target: 10,
      unit: "kgf",
    },
    {
      id: "missing",
      region: "hip",
      direction: "外展",
      paired: true,
      left: 100,
      right: "",
      target: 100,
      unit: "N",
    },
    {
      id: "mid",
      region: "neck",
      direction: "屈曲",
      paired: false,
      center: 200,
      target: 100,
      unit: "N",
      painCenter: true,
    },
  ];
  const s = M.stats(r),
    axes = M.isoRadar(s.isoAnalyses).axes;
  const shoulder = axes.find((x) => x.id === "shoulder");
  near(shoulder.strength, 90);
  near(shoulder.symmetry, 80);
  assert.equal(shoulder.strengthSources.length, 2);
  assert.equal(axes.find((x) => x.id === "hip").strength, null);
  const neck = axes.find((x) => x.id === "neck");
  near(neck.strength, 200);
  assert.equal(neck.symmetry, null);
  assert.equal(neck.pain, true);
  assert.equal(M.isoRadar(s.isoAnalyses).max, 200);
});
test("best jump retains one attempt; means carry metric counts and no landing force enters DSI", () => {
  const r = M.defaults();
  r.data.cmj = [
    {
      id: "a",
      height: 40,
      force: 1000,
      rsiModified: 0.5,
      landingPeakForce: 3000,
    },
    {
      id: "b",
      height: 50,
      force: 1200,
      rsiModified: "",
      landingPeakForce: 2800,
    },
  ];
  let s = M.stats(r);
  near(s.values.cmj_peak_force, 1200);
  assert.equal(s.values.cmj_rsi_modified, undefined);
  near(s.values.cmj_landing_peak_force, 2800);
  r.mode = "mean";
  s = M.stats(r);
  near(s.values.cmj_rsi_modified, 0.5);
  assert.equal(s.raw.cmj.counts.rsiModified, 1);
  r.data.sj = [{ id: "partial", height: "", force: 900 }];
  s = M.stats(r);
  assert.ok(s.validTests.has("sj"));
});
test("attempt metric conversion, historical snapshot and training context are preserved", () => {
  const r = M.defaults();
  r.definitions.push({
    id: "metric_extra",
    testId: "cmj",
    name: "附加力",
    unit: "N",
    ability: "爆发力",
    direction: "higher",
    category: "performance",
    entryScope: "attempt",
    referenceEnabled: false,
    target: 98.0665,
    ranges: [],
  });
  r.data.cmj = [{ id: "one", height: 40, metrics: { metric_extra: 98.0665 } }];
  const converted = M.changeMetricUnit(r, "metric_extra", "kgf", "convert");
  near(converted.data.cmj[0].metrics.metric_extra, 10);
  near(M.stats(converted).values.metric_extra, 10);
  near(r.data.cmj[0].metrics.metric_extra, 98.0665);
  const before = M.fingerprint(r);
  r.trainingContext.weeklySessions = 2;
  assert.notEqual(M.fingerprint(r), before);
  const restored = M.normalizeRecord(JSON.parse(JSON.stringify(converted)));
  near(restored.data.cmj[0].metrics.metric_extra, 10);
  M.validateRecord(restored);
});
test("partial heart-rate stages remain data and invalid balances remain visible", () => {
  const r = M.sampleRecord();
  r.data.lactate = [{ id: "hr", speed: 3, lactate: "", hr: 150, unit: "m/s" }];
  const s = M.stats(r);
  assert.equal(s.raw.lactate.length, 1);
  const html = R.render(R.build(r));
  assert.match(html, /关节平衡/);
  assert.match(html, /缺测/);
  const iso = html.match(/<article[^>]+id="detail-iso"[\s\S]*?<\/article>/)[0];
  assert.equal((iso.match(/<table/g) || []).length, 1);
  assert.match(iso, /<th\b[^>]*>关节平衡<\/th>/);
  const pair = r.balancePairs.find(
    (b) => b.region === "shoulder" && b.label === "IR:ER",
  );
  assert.ok(pair);
  pair.confirmed = true;
  Object.assign(
    r.data.iso.find((row) => row.id === pair.numeratorId),
    { left: 108.5, right: 108.5 },
  );
  Object.assign(
    r.data.iso.find((row) => row.id === pair.denominatorId),
    { left: 217, right: 217 },
  );
  const withValidBalance = R.render(R.build(r));
  assert.equal(
    (
      withValidBalance.match(
        new RegExp('data-balance-id="' + pair.id + '"', "g"),
      ) || []
    ).length,
    1,
  );
  assert.match(withValidBalance, /L · 0\.50/);
  assert.match(withValidBalance, /R · 0\.50/);
});
test("legacy per-attempt speed converts values and standards once without mutating the source", () => {
  const r = M.defaults();
  r.definitions.push({
    id: "attempt_speed",
    testId: "cmj",
    name: "速度",
    unit: "km/h",
    ability: "爆发力",
    direction: "higher",
    category: "performance",
    entryScope: "attempt",
    referenceEnabled: false,
    target: 18,
    ranges: [],
  });
  r.data.cmj = [{ id: "jump", height: 40, metrics: { attempt_speed: 14.4 } }];
  const before = JSON.stringify(r);
  near(M.stats(r).values.attempt_speed, 4);
  assert.equal(JSON.stringify(r), before);
  const once = M.normalizeRecord(r),
    twice = M.normalizeRecord(once);
  near(once.data.cmj[0].metrics.attempt_speed, 4);
  near(twice.data.cmj[0].metrics.attempt_speed, 4);
  near(twice.definitions.find((d) => d.id === "attempt_speed").target, 5);
});
test("AI accepts independent Markdown and local offline dosage remains deterministic", () => {
  const r = M.defaults(), I = c.RingsideInterventions;
  r.data.cmj[0].height = 20;
  r.definitions.find((d) => d.id === "cmj_height").referenceEnabled = true;
  const before = I.text(I.build(r));
  const narrative = "## 综合判断\n结合当前力量与跳跃表现安排两项重点。\n\n- 分腿蹲：每侧3组6次，RPE 6，组间休息2分钟；周一安排，周四先观察恢复。\n- 连续两次动作稳定且次日无症状，再增加一组。";
  assert.equal(I.validateAI(narrative), narrative);
  assert.equal(I.text(I.build(r)), before);
  assert.throws(() => I.validateAI(JSON.stringify({ priorityIds: [], actions: [] })), /数据对象/);
  assert.throws(() => I.validateAI("   "), /正文/);
  assert.throws(() => I.validateAI("<script>alert(1)</script>"), /正文|代码/);
  r.trainingContext.weeklySessions = 1;
  assert.ok(I.build(r).items.flatMap((i) => i.actions).every((a) => a.weekly === 1));
});

test("IMTP keeps RFD-only times, per-field means and incomplete trials", () => {
  const r = M.defaults();
  r.data.imtp = [
    {
      id: "one",
      peakForce: 2000,
      timePoints: [{ id: "t", timeMs: 150, force: "", rfd: 4321 }],
    },
    {
      id: "two",
      peakForce: 3000,
      timePoints: [{ id: "u", timeMs: 150, force: 1600, rfd: 6000 }],
    },
  ];
  r.mode = "mean";
  const f = M.forceTime(r);
  near(f.timeRows[0].rfd, 5160.5);
  assert.equal(f.timeRows[0].rfdN, 2);
  assert.equal(f.timeRows[0].forceN, 1);
  r.mode = "best";
  r.data.imtp.pop();
  const html = R.render(R.build(r));
  assert.match(html, /4,321/);
  assert.match(html, /150/);
  r.data.imtp[0].peakForce = "";
  assert.ok(M.stats(r).validTests.has("imtp"));
  assert.match(R.render(R.build(r)), /4,321/);
});
test("specialized render failures retain raw partial attempts and other sections", () => {
  const r = M.sampleRecord();
  r.data.cmj = [{ id: "partial", height: "", force: 987.65 }];
  const old = c.RingsideViz.jumpBars;
  c.RingsideViz.jumpBars = () => {
    throw Error("injected jump");
  };
  let report = R.build(r),
    html = R.render(report);
  c.RingsideViz.jumpBars = old;
  assert.match(html, /987.65/);
  assert.match(html, /detail-fms/);
  assert.equal(report.diagnostics.length, 1);
  const lvp = c.RingsideViz.lvp;
  c.RingsideViz.lvp = () => {
    throw Error("injected LVP");
  };
  report = R.build(r);
  html = R.render(report);
  c.RingsideViz.lvp = lvp;
  assert.match(html, /detail-bench/);
  assert.match(html, /负荷/);
  assert.match(html, /detail-fms/);
  assert.ok(report.diagnostics.length);
});
test("jump unit descriptors follow the stored takeoff unit without changing DSI", () => {
  const r = M.defaults();
  r.dsi.cmjUnit = "kgf";
  r.data.cmj = [{ id: "a", height: 40, force: 100, landingPeakForce: 2000 }];
  assert.equal(
    T.attemptFields(r, "cmj").find((f) => f.key === "force").unit,
    "kgf",
  );
  assert.equal(
    R.build(r)
      .projects.find((p) => p.id === "cmj")
      .metrics.find((d) => d.id === "cmj_peak_force").unit,
    "kgf",
  );
  assert.equal(
    T.attemptFields(r, "cmj").find((f) => f.key === "landingPeakForce").unit,
    "N",
  );
});
test("both radar series fill measured areas without bridging missing joints", () => {
  const r = M.defaults();
  r.data.iso = ["neck", "shoulder", "hip", "knee", "ankle"].map(
    (region, i) => ({
      id: "fill" + i,
      region,
      direction: "测试",
      paired: true,
      left: 80 + i * 5,
      right: 100,
      target: 90,
      unit: "N",
    }),
  );
  let html = c.RingsideViz.isoRadar(M.isoRadar(M.stats(r).isoAnalyses));
  assert.equal((html.match(/class="radar-fill"/g) || []).length, 2);
  assert.match(html, /fill-opacity="0.14"/);
  assert.match(html, /fill-opacity="0.22"/);
  r.data.iso[2].left = "";
  html = c.RingsideViz.isoRadar(M.isoRadar(M.stats(r).isoAnalyses));
  assert.equal((html.match(/class="radar-fill"/g) || []).length, 6);
});
test("FMS pain region also gates matching isometric and balance prescriptions", () => {
  const r = M.sampleRecord();
  r.data.fms[0].pain = true;
  r.data.fms[0].location = "shoulder_l";
  let plan = c.RingsideInterventions.build(r);
  assert.ok(!plan.items.some((i) => i.id === "iso_shoulder"));
  r.data.fms[0].location = "";
  plan = c.RingsideInterventions.build(r);
  assert.ok(!plan.items.some((i) => i.id.startsWith("iso_")));
});
const reportCell = (html, id, label) => {
  const row = html.match(new RegExp('<tr data-row-id="' + id + '"[^>]*>([\\s\\S]*?)</tr>'))?.[1];
  assert.ok(row, 'missing row ' + id);
  return row.match(new RegExp('<td data-label="' + label + '">([\\s\\S]*?)</td>'))?.[1];
};
test("isometric empty evaluations and balances are plain dashes while valid sides and pain survive", () => {
  const r = M.defaults(),
    ir = r.data.iso.find(x => x.region === 'shoulder' && x.directionCode === 'internalRotation'),
    er = r.data.iso.find(x => x.region === 'shoulder' && x.directionCode === 'externalRotation');
  Object.assign(ir, { left: 200, right: '', target: '' });
  let html = R.render(R.build(r));
  assert.equal(reportCell(html, ir.id, '评价'), undefined, 'omit the column when no row has an evaluation');
  assert.equal(reportCell(html, ir.id, '关节平衡'), '-');
  Object.assign(ir, { target: 200, painRight: true });
  html = R.render(R.build(r));
  assert.match(reportCell(html, ir.id, '评价'), /L · 达到目标/);
  assert.match(reportCell(html, ir.id, '评价'), /R · 疼痛/);
  Object.assign(er, { left: 100, right: '' });
  html = R.render(R.build(r));
  const balance = reportCell(html, ir.id, '关节平衡');
  assert.match(balance, /L · 2\.00/);
  assert.match(balance, /R · -/);
  assert.doesNotMatch(balance, /缺测|待输入|尚未确认/);
  assert.equal((html.match(/data-balance-id="shoulder_IR_ER"/g) || []).length, 1);
  r.balancePairs.find(x => x.id === 'shoulder_IR_ER').confirmed = false;
  assert.equal(reportCell(R.render(R.build(r)), ir.id, '关节平衡'), '-');
});
test("isometric radar has neutral grid lines and retains point provenance without direction-count labels", () => {
  const r = M.sampleRecord();
  const html = c.RingsideViz.isoRadar(M.isoRadar(M.stats(r).isoAnalyses));
  const grids = [...html.matchAll(/<polygon[^>]*fill="none"[^>]*>/g)].map(x => x[0]);
  assert.ok(grids.length >= 4);
  assert.ok(grids.every(x => x.includes('stroke="#e5ebf3"') && !x.includes('stroke-width="1.5"')));
  assert.doesNotMatch(html, />力量 \d|>对称 \d/);
  assert.match(html, /data-tooltip="肩 · /);
  assert.match(html, /data-radar-series="strength"/);
  assert.match(html, /data-radar-series="symmetry"/);
});
test("speed report supports all missing subsets in fixed MAS MSS VIFT order without changing data or ability ownership", () => {
  for (let mask = 0; mask < 8; mask++) {
    const r = M.defaults();
    Object.assign(r.data.mas, { speed: mask & 1 ? 5 : '', method: 'MAS方法' });
    Object.assign(r.data.mss, { speed: mask & 2 ? 8 : '', method: 'MSS方法' });
    Object.assign(r.data.ift, { speed: mask & 4 ? 6 : '', protocol: 'shuttle', partial: 12 });
    const original = JSON.stringify(r), report = R.build(r), html = R.render(report);
    assert.equal(JSON.stringify(r), original);
    assert.equal(report.projects.find(x => x.id === 'ift').primaryAbility, '间歇耐力');
    assert.equal(report.projects.find(x => x.id === 'mas').primaryAbility, '有氧代谢能力');
    const bars = [...html.matchAll(/data-speed-metric="([^"]+)"/g)].map(x => x[1]);
    assert.deepEqual(bars, ['mas', 'mss', 'ift'].filter((_, i) => mask & (1 << i)));
    assert.equal(html.includes('data-speed-asr'), (mask & 3) === 3);
    if (mask) {
      assert.ok(html.includes('id="' + T.groupId('速度与储备') + '"'));
      assert.equal((html.match(/class="detail-pair speed-detail"/g) || []).length, 1);
    }
    if (mask & 4) {
      assert.match(html, /折返版/);
      assert.match(html, /未完成级 12 秒/);
      assert.doesNotMatch(html, /data-metric-id="ift_treadmill"/);
    }
    assert.equal(report.diagnostics.length, 0);
  }
});
test("custom IFT results survive missing native speed without an empty chart or duplicate metric", () => {
  const r = M.defaults();
  r.definitions.push({ id: 'ift_custom', testId: 'ift', name: 'IFT附加指标', unit: '次', ability: '间歇耐力', category: 'performance', target: 20, ranges: [], referenceEnabled: false });
  r.customValues.ift_custom = { value: 12 };
  const html = R.render(R.build(r));
  assert.match(html, /30–15 IFT/);
  assert.equal((html.match(/data-metric-id="ift_custom"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-speed-metric|速度表现等待录入/);
});
test("speed units and IFT protocols remain independent; invalid or zero ASR never corrupts measured bars", () => {
  const r = M.defaults();
  Object.assign(r.data.mas, { speed: 18, unit: 'km/h' });
  Object.assign(r.data.mss, { speed: 5, unit: 'm/s' });
  Object.assign(r.data.ift, { speed: 21.6, unit: 'km/h', protocol: 'treadmill', partial: 12.5 });
  let report = R.build(r), html = R.render(report);
  near(report.stats.values.mas_speed, 5);
  near(report.stats.values.ift_treadmill, 6);
  assert.match(html, /ASR 0\.00 m\/s/);
  assert.match(html, /跑台改良版/);
  assert.match(html, /未完成级 12\.5 秒/);
  assert.doesNotMatch(html, /data-metric-id="ift_shuttle"/);
  r.data.mss.speed = 4;
  html = R.render(R.build(r));
  assert.doesNotMatch(html, /data-speed-asr/);
  assert.match(html, /MSS低于MAS/);
  assert.equal((html.match(/data-speed-metric=/g) || []).length, 3);
  r.enabled.mas = false;
  html = R.render(R.build(r));
  assert.doesNotMatch(html, /data-speed-metric="mas"|data-speed-asr/);
});
test("strength endurance uses traffic-light wording while retaining reference colors, boundaries and other labels", () => {
  const r = M.sampleRecord(), def = r.definitions.find(x => x.id === 'pushup_reps');
  const originalRanges = JSON.stringify(def.ranges);
  for (const [value, status, label] of [[59,'red','重点关注'],[60,'amber','关注'],[66,'amber','关注'],[70,'gray','未分级'],[75,'green','正常'],[80,'green','正常'],[81,'green','正常']]) {
    r.data.pushup.reps = value;
    const report = R.build(r), metric = report.projects.find(x => x.id === 'pushup').metrics[0];
    assert.equal(metric.evaluation.status, status);
    const row = R.render(report).match(/<tr data-metric-id="pushup_reps">([\s\S]*?)<\/tr>/)?.[1];
    assert.ok(row?.includes('>' + label + '</span>'));
    assert.equal(metric.evaluation.label, M.evaluation(value, def, r).label);
    assert.equal(metric.target, 80);
    assert.equal(metric.evaluation.status, M.evaluation(value, def, r).status);
    for (const project of report.projects.filter(x => x.id !== 'pushup')) {
      for (const metric of project.metrics) assert.equal(metric.evaluation.label, M.evaluation(metric.value, metric, r).label);
    }
  }
  assert.equal(JSON.stringify(def.ranges), originalRanges);
});
const speedSample = () => {
  const r = M.defaults();
  r.data.mas.speed = 4; r.data.mss.speed = 8;
  Object.assign(r.data.ift, { speed: 5, protocol: 'shuttle', partial: 12.5 });
  for (const [id, target] of [['mas_speed', 4], ['mss_speed', 8]])
    Object.assign(r.definitions.find(d => d.id === id), { target, referenceEnabled: true });
  return r;
};
test('speed reference matches the approved numerical example without changing stored data or shared facts', () => {
  const r = speedSample(), original = JSON.stringify(r), before = M.stats(r), report = R.build(r), ref = report.speedReference;
  near(ref.asr, 4); near(ref.srr, 2); near(ref.sprintSpeed, 8);
  assert.equal(ref.athleteType, '速度型');
  const row = (id) => ref.rows.find(x => x.id === id);
  const values = (id, basis, recovery = false) => Array.from(row(id)[recovery ? 'recoverySpeeds' : 'workSpeeds'].find(x => x.basis === basis).values);
  assert.deepEqual(values('long', 'mas'), [3.8, 4.2]);
  assert.deepEqual(values('short', 'mas'), [4, 4.8]);
  assert.deepEqual(values('long', 'vift'), [4, 4.5]);
  assert.deepEqual(values('short', 'vift'), [4.5, 5.25]);
  assert.deepEqual(values('rst', 'mas', true), [2.4]);
  assert.deepEqual(values('rst', 'vift', true), [2.25]);
  assert.equal(ref.profile, undefined); assert.equal(ref.mas80, undefined);
  R.render(report);
  assert.equal(JSON.stringify(r), original);
  assert.equal(JSON.stringify(report.stats), JSON.stringify(before));
  for (const project of report.projects) for (const metric of project.metrics)
    assert.equal(JSON.stringify(metric.evaluation), JSON.stringify(M.evaluation(metric.value, metric, r)));
});
test('five training formats preserve source targets and display Chinese goals, sourced paired ratios and measured MSS', () => {
  const report = R.build(speedSample()), ref = report.speedReference, html = R.render(report);
  assert.deepEqual(Array.from(ref.rows, x => [x.id, x.targets]), [['long','③④'],['short','①②③④'],['rst','④⑤'],['sit','⑤'],['game','②③④']]);
  assert.equal(ref.targets.length, 6);
  assert.equal(ref.rows.find(x => x.id === 'rst').workSpeeds.length, 0);
  assert.equal(ref.rows.find(x => x.id === 'sit').recoverySpeeds.length, 0);
  assert.equal(ref.rows.find(x => x.id === 'game').workSpeeds.length, 0);
  assert.match(ref.rows[0].work, /95–105% vVO₂max/); assert.match(ref.rows[1].work, /100–120% VIncTest/);
  assert.deepEqual(Array.from(ref.rows, x => Array.from(x.ratios, p => [p.work, p.rest])), [[[240,120]],[[30,30],[30,15]],[[5,20]],[[30,240]],[[240,120]]]);
  for (const row of ref.rows) for (const ratio of row.ratios) assert.ok(ref.sources.some(source => source.id === ratio.sourceId));
  assert.match(html, /最大有氧速度（MAS）的95–105%/); assert.match(html, /折返终末速度（VIFT）的80–90%/);
  assert.match(html, /随比赛情境自主调节/); assert.match(html, /有氧能力/); assert.match(html, /无氧糖酵解能力/);
  assert.equal((html.match(/实测最大冲刺速度（MSS）/g) || []).length, 2);
  assert.match(html, /做功∶休息参考/); assert.match(html, />1:8<.*?30秒／4分钟/);
  assert.doesNotMatch(html, /data-metric-id="asr"|相对现有目标|data-speed-profile|speed-target-legend|speed-reference-note|data-speed-mas80|录入MAS换算|≥MSS|生理目标 [①②③④⑤⑥]/);
});
test('speed reference bases and athlete type disappear independently for all missing combinations', () => {
  for (let mask = 0; mask < 8; mask++) {
    const r = speedSample();
    r.data.mas.speed = mask & 1 ? 4 : ''; r.data.mss.speed = mask & 2 ? 8 : ''; r.data.ift.speed = mask & 4 ? 5 : '';
    const report = R.build(r), ref = report.speedReference, html = R.render(report);
    assert.equal(ref.available, !!mask); assert.equal(ref.rows.length, mask ? 5 : 0);
    assert.equal(ref.asr !== null, (mask & 3) === 3); assert.equal(ref.srr !== null, (mask & 3) === 3);
    assert.equal(ref.athleteType !== null, (mask & 3) === 3);
    assert.equal(ref.sprintSpeed !== null, !!(mask & 2));
    for (const row of ref.rows.filter(x => x.mas)) {
      assert.equal(row.workSpeeds.some(x => x.basis === 'mas'), !!(mask & 1));
      assert.equal(row.workSpeeds.some(x => x.basis === 'vift'), !!(mask & 4));
    }
    if (!mask) assert.doesNotMatch(html, /speed-ratio-table|speed-reference-table/);
    if (mask === 2) assert.match(html, /实测最大冲刺速度（MSS）/);
  }
});
test('treadmill VIFT remains measured but never supplies shuttle reference speeds or inferred MAS', () => {
  const r = speedSample(); r.data.ift.protocol = 'treadmill';
  let report = R.build(r), ref = report.speedReference;
  assert.equal(ref.metrics.length, 3);
  assert.ok(ref.rows.every(x => ![...x.workSpeeds, ...x.recoverySpeeds].some(x => x.basis === 'vift')));
  assert.match(R.render(report), /未完成级 12\.5 秒/);
  r.data.mas.speed = ''; r.data.mss.speed = '';
  ref = R.build(r).speedReference;
  assert.equal(ref.asr, null); assert.equal(ref.srr, null); assert.equal(ref.athleteType, null);
  assert.ok(ref.rows.every(x => x.workSpeeds.length === 0 && x.recoverySpeeds.length === 0));
});
test('literature athlete type uses unrounded SRR with inclusive middle cutpoints and ignores target settings', () => {
  const r = speedSample(), a = r.definitions.find(x => x.id === 'mas_speed'), s = r.definitions.find(x => x.id === 'mss_speed');
  for (const [srr, expected] of [[1.6999,'耐力型'],[1.7,'混合型'],[1.75,'混合型'],[1.8,'混合型'],[1.8001,'速度型'],[2,'速度型']]) {
    r.data.mss.speed = 4 * srr;
    const ref = R.build(r).speedReference;
    near(ref.srr, srr); assert.equal(ref.athleteType, expected);
    for (const [target, enabled] of [[2,true],[5,true],[0,true],['',true],[4,false]]) {
      a.target = target; s.target = target; a.referenceEnabled = enabled; s.referenceEnabled = enabled;
      assert.equal(R.build(r).speedReference.athleteType, expected);
    }
  }
});
test('zero and negative reserve preserve valid references while suppressing inconsistent combined profiles', () => {
  const r = speedSample(); r.data.mss.speed = 4;
  let ref = R.build(r).speedReference;
  near(ref.asr, 0); near(ref.srr, 1); assert.equal(ref.athleteType, '耐力型');
  r.data.mss.speed = 3;
  ref = R.build(r).speedReference;
  assert.equal(ref.inconsistent, true); assert.equal(ref.athleteType, null); assert.equal(ref.srr, null); assert.equal(ref.asr, null);
  assert.equal(ref.rows[0].workSpeeds.length, 2);
});
test('speed calculations use full precision after unit conversion and never prorate partial IFT stages', () => {
  const r = speedSample();
  Object.assign(r.data.mas, { speed: 14.45, unit: 'km/h' });
  Object.assign(r.data.ift, { speed: 18.9, unit: 'km/h' });
  const ref = R.build(r).speedReference;
  near(ref.rows[0].workSpeeds.find(x => x.basis === 'mas').values[0], 14.45 / 3.6 * .95);
  near(ref.rows[1].workSpeeds.find(x => x.basis === 'vift').values[1], 18.9 / 3.6 * 1.05);
  r.data.ift.partial = 29.5;
  near(R.build(r).speedReference.rows[1].workSpeeds.find(x => x.basis === 'vift').values[1], 18.9 / 3.6 * 1.05);
});
console.log(`${passed} report v2 model checks passed`);
