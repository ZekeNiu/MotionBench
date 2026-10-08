"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const context = vm.createContext({
  console,
  Intl,
  crypto: require("node:crypto").webcrypto,
});
context.window = context;
for (const name of ["calc", "cpet-reference", "definitions", "tests", "model", "interventions", "viz", "report"])
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../src/ringside-" + name + ".js"),
      "utf8",
    ),
    context,
  );
const M = context.RingsideModel,
  T = context.RingsideTests,
  V = context.RingsideViz,
  R = context.RingsideReport;
const copy = (value) => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log("PASS " + name);
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture(ability = "灵敏性") {
  const record = M.defaults();
  record.enabled = Object.fromEntries(M.TESTS.map((t) => [t[0], false]));
  record.enabled.custom_core = true;
  record.customTests = [
    { id: "custom_core", name: "多指标项目", category: "performance" },
  ];
  record.definitions.push({
    id: "measure_core",
    testId: "custom_core",
    name: "指标甲",
    unit: "N",
    ability,
    category: "performance",
    direction: "higher",
    target: 100,
    referenceEnabled: true,
    ranges: [
      {
        min: 80,
        max: 100,
        includeMin: true,
        includeMax: true,
        label: "符合",
        status: "green",
      },
    ],
  });
  record.customValues.measure_core = { value: 80, notes: "实际记录备注" };
  return record;
}
test("registered structures and scalar extensions share one descriptor", () => {
  const record = fixture();
  assert.equal(
    T.describe(record).find((t) => t.id === "custom_core").renderer,
    "scalar",
  );
  assert.deepEqual(
    copy(T.describe(record).find((t) => t.id === "imtp").abilities),
    ["最大力量", "早期发力"],
  );
  near(M.stats(record).values.measure_core, 80);
});
test("primary ability controls unique project grouping while retaining secondary abilities", () => {
  const record = M.normalizeRecord(M.defaults());
  record.projectSnapshots.find((t) => t.id === "imtp").primaryAbility =
    "早期发力";
  const groups = T.groups(T.describe(record));
  assert.equal(
    groups.flatMap((g) => g.projects).filter((t) => t.id === "imtp").length,
    1,
  );
  assert.equal(
    groups.find((g) => g.projects.some((t) => t.id === "imtp")).label,
    "早期发力",
  );
});
test("new record retains project metadata and metric definitions after catalog edits", () => {
  const catalog = M.normalizeCatalog();
  catalog.tests.find((t) => t.id === "imtp").primaryAbility = "早期发力";
  const record = M.recordFromCatalog(
      catalog,
      { name: "快照" },
      { imtp: true },
      "2026-10-05",
    ),
    before = JSON.stringify(record);
  catalog.tests.find((t) => t.id === "imtp").primaryAbility = "最大力量";
  catalog.definitions.find((d) => d.id === "imtp_peak_force").name =
    "修改后的目录";
  assert.equal(
    T.describe(record).find((t) => t.id === "imtp").primaryAbility,
    "早期发力",
  );
  assert.equal(JSON.stringify(record), before);
  assert.deepEqual(copy(M.normalizeRecord(record)), copy(record));
});
test("reserved and punctuation ability names survive scoring configuration and backup validation", () => {
  for (const ability of [
    "constructor",
    "__proto__",
    "prototype",
    "toString",
    '力量 <&> "特殊"',
  ]) {
    const record = fixture(ability);
    record.axes[T.axisKey(ability)] = { method: "mean" };
    assert.equal(M.stats(record).axes[0].label, ability);
    near(M.stats(record).axes[0].value, 80);
    assert.equal(M.validateRecord(M.normalizeRecord(record)), true);
    assert.ok(R.render(R.build(record)).includes("多指标项目"));
  }
});
test("N to kgf converts result target and both range boundaries without mutating its input", () => {
  const record = fixture(),
    before = JSON.stringify(record),
    next = M.changeMetricUnit(record, "measure_core", "kgf", "convert");
  near(next.customValues.measure_core.value, 80 / 9.80665);
  const d = next.definitions.find((d) => d.id === "measure_core");
  near(d.target, 100 / 9.80665);
  near(d.ranges[0].min, 80 / 9.80665);
  near(d.ranges[0].max, 100 / 9.80665);
  assert.equal(JSON.stringify(record), before);
  near(
    M.changeMetricUnit(next, "measure_core", "N", "convert").customValues
      .measure_core.value,
    80,
  );
});
test("incompatible metric units require clearing values and evaluation standards", () => {
  const record = fixture();
  assert.throws(
    () => M.changeMetricUnit(record, "measure_core", "s", "convert"),
    /无法直接换算/,
  );
  const next = M.changeMetricUnit(record, "measure_core", "s", "clear"),
    d = next.definitions.find((d) => d.id === "measure_core");
  assert.equal(next.customValues.measure_core.value, "");
  assert.equal(d.target, null);
  assert.equal(d.ranges.length, 0);
  assert.equal(d.referenceEnabled, false);
  assert.equal(d.unit, "s");
});
test("unit conversion preserves zero and rejects overflow and noncanonical speed labels", () => {
  const record = fixture();
  record.customValues.measure_core.value = 0;
  assert.equal(
    M.changeMetricUnit(record, "measure_core", "kgf", "convert").customValues
      .measure_core.value,
    0,
  );
  assert.throws(
    () => M.changeMetricUnit(record, "measure_core", "km/h", "clear"),
    /速度/,
  );
  record.definitions.find((d) => d.id === "measure_core").unit = "kgf";
  record.customValues.measure_core.value = 1e308;
  assert.throws(
    () => M.changeMetricUnit(record, "measure_core", "N", "convert"),
    /超出/,
  );
});
test("custom multi-metric report owns every metric exactly once and keeps zero and notes", () => {
  const record = fixture();
  record.definitions.push({
    ...copy(record.definitions.at(-1)),
    id: "measure_second",
    name: "指标乙",
    unit: "cm",
  });
  record.customValues.measure_second = { value: 0 };
  const html = R.render(R.build(record));
  assert.equal((html.match(/id="detail-custom_core"/g) || []).length, 1);
  for (const id of ["measure_core", "measure_second"])
    assert.equal(
      (html.match(new RegExp('data-metric-id="' + id + '"', "g")) || []).length,
      1,
    );
  assert.ok(html.includes("实际记录备注"));
  assert.ok(html.includes("0.00"));
  assert.ok(!html.includes("其他能力"));
});
test("supplementary metric on a built-in project stays inside its report block", () => {
  const record = fixture();
  record.enabled.custom_core = false;
  record.enabled.cmj = true;
  record.data.cmj[0].height = 40;
  record.definitions.at(-1).testId = "cmj";
  const html = R.render(R.build(record));
  assert.equal((html.match(/id="detail-cmj"/g) || []).length, 1);
  assert.equal((html.match(/data-metric-id="measure_core"/g) || []).length, 1);
  assert.ok(
    html.indexOf('id="detail-cmj"') <
      html.indexOf('data-metric-id="measure_core"'),
  );
});
test("shared report model is a snapshot that does not change when the live record changes", () => {
  const record = fixture(),
    before = JSON.stringify(record),
    report = R.build(record);
  assert.equal(JSON.stringify(record), before);
  record.customValues.measure_core.value = 999;
  assert.equal(
    report.projects.find((t) => t.id === "custom_core").metrics[0].value,
    80,
  );
  assert.ok(!R.render(report).includes("999.00"));
});
test("summary ignores old filters and contains all four cards without controls or links", () => {
  const record = fixture();
  record.views = {
    ...record.views,
    redScope: "screen",
    amberScope: "screen",
    advantageAbility: "absent",
    overview: "missing",
  };
  const html = R.summary(R.build(record));
  assert.equal((html.match(/class="micro-card(?:\s[^"]*)?"/g) || []).length, 4);
  assert.match(html, /^<article class="micro-card athlete-summary">/);
  assert.ok(html.includes("运动员信息"));
  assert.ok(!/<select|<a\b|<button/.test(html));
});
test("FMS radar retains seven axes, missing results and pain without fabricating points", () => {
  const html = V.fms([
    { score: 0, label: "下蹲活动与控制" },
    { score: null, label: "单腿支撑控制" },
    { score: 2 },
    { score: "" },
    { score: 3 },
  ]);
  assert.equal((html.match(/data-fms-axis=/g) || []).length, 7);
  assert.equal((html.match(/class="viz-point"/g) || []).length, 3);
  assert.ok(html.includes("0 · 疼痛"));
  assert.ok(html.includes("未测"));
  assert.ok(!/NaN|Infinity/.test(html));
});
test("one two and more than eight abilities use a complete readable list", () => {
  for (const n of [1, 2, 9, 60]) {
    const items = Array.from({ length: n }, (_, i) => ({
        label: "完整的能力名称".repeat(8) + i,
        value: 80,
        status: "amber",
      })),
      html = V.radar(items);
    assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/g) || []).length, 1);
    for (const item of items) assert.ok(html.includes(item.label));
    assert.ok(!html.includes("radar-label"));
  }
  assert.equal(
    (
      V.radar(
        Array.from({ length: 8 }, (_, i) => ({ label: "能力" + i, value: 80 })),
      ).match(/class="radar-label"/g) || []
    ).length,
    8,
  );
});
test("isometric result table keeps units and missing-side blanks while showing weaker side", () => {
  const record = M.defaults();
  record.data.iso = record.data.iso.slice(0, 3);
  record.data.iso[0].center = 10;
  record.data.iso[0].unit = "Nm";
  Object.assign(record.data.iso[2], { left: 80, right: 100 });
  record.balancePairs = [];
  const html = R.render(R.build(record));
  assert.ok(/20(?:\.0)?% · 左侧较弱/.test(html.replace(/<[^>]+>/g, "")));
  assert.ok(html.includes("Nm"));
  assert.equal((html.match(/class="inline-asym"/g) || []).length, 0);
  assert.ok(!html.includes("双侧不对称性"));
});
test("unclassified numeric extensions still produce a complete result table", () => {
  const record = fixture("");
  record.definitions.at(-1).target = null;
  record.definitions.at(-1).ranges = [];
  record.definitions.at(-1).referenceEnabled = false;
  const html = R.render(R.build(record));
  assert.ok(html.includes("未分类"));
  assert.ok(html.includes("80.00"));
  assert.ok(!html.includes("未启用评价标准"));
});
test("unselected project metadata survives normalization without metric adoption", () => {
  const catalog = M.normalizeCatalog();
  catalog.tests.push({
    id: "custom_waiting",
    name: "尚未采用的项目",
    category: "performance",
    primaryAbility: "专项力量",
  });
  catalog.definitions.push({
    id: "waiting_metric",
    testId: "custom_waiting",
    name: "待录入指标",
    unit: "N",
    ability: "专项力量",
    category: "performance",
    direction: "higher",
    target: 100,
    ranges: [],
    referenceEnabled: false,
  });
  const record = M.recordFromCatalog(
    catalog,
    { name: "仅选CMJ" },
    { cmj: true },
  );
  assert.equal(
    record.projectSnapshots.find((t) => t.id === "custom_waiting")
      .primaryAbility,
    "专项力量",
  );
  assert.ok(!record.definitions.some((d) => d.id === "waiting_metric"));
  assert.equal(
    M.normalizeRecord(record).projectSnapshots.find(
      (t) => t.id === "custom_waiting",
    ).primaryAbility,
    "专项力量",
  );
});
test("whitespace-only ability never becomes an empty summary axis", () => {
  const record = fixture("  ");
  assert.equal(M.stats(record).axes.length, 0);
  assert.ok(R.render(R.build(record)).includes("未分类"));
});
console.log(passed + " core model checks passed");
