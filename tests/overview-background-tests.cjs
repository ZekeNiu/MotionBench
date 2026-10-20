"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const { context, createFixture } = require("./helpers/longitudinal-fixture.cjs");

// Synthetic definitions are resolved by the real profile and scoring engines.
// No physical user profile, existing report, or stored measurement is opened.
function overviewFixture(env, base) {
  const input = base(env, 3);
  for (const record of input.records) {
    for (const id of ["long_pct", "long_unknown"]) Object.assign(record.definitions.find(d => d.id === id), { ability: "力量耐力", measurementScale: "ratio", scoring: true });
    record.data.long_generic.forEach((trial, index) => Object.assign(trial.metrics, { long_pct: 55 + index * 5, long_unknown: 65 + index * 5 }));
  }
  input.profile = env.RingsideEvaluation.create(input.records.at(-1), "雷达底色合成标准");
  input.catalog = env.RingsideModel.mergeCatalog(null, input.records.at(-1));
  for (const key of Object.keys(input.profile.aggregations)) input.profile.aggregations[key] = { method: "disabled" };
  Object.assign(input.profile.aggregations, {
    "ability:下肢爆发力": { method: "primary", primary: "metric:cmj_height" },
    "ability:冲刺速度": { method: "primary", primary: "metric:long_time" },
    "ability:力量耐力": { method: "mean", members: ["metric:long_pct", "metric:long_unknown"], transforms: Object.fromEntries(["long_pct", "long_unknown"].map(id => ["metric:" + id, { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 100, score: 100 }] }])), ranges: [
      { min: 0, max: 60, includeMin: true, includeMax: false, status: "red", label: "原低区" },
      { min: 60, max: 80, includeMin: true, includeMax: false, status: "amber", label: "原中区" },
      { min: 80, max: 100, includeMin: true, includeMax: true, status: "green", label: "原高区" }
    ] }
  });
  const rule = id => input.profile.standards.find(item => item.metricId === id);
  Object.assign(rule("cmj_height"), { enabled: true, targetEnabled: true, target: 50, rangesEnabled: true, ranges: [
    { min: 0, max: 30, includeMin: true, includeMax: false, status: "red", label: "原红色" },
    { min: 30, max: 40, includeMin: true, includeMax: false, status: "amber", label: "原黄色" },
    { min: 40, max: null, includeMin: true, includeMax: true, status: "green", label: "原绿色" }
  ] });
  Object.assign(rule("long_time"), { enabled: true, targetEnabled: true, target: 8, rangesEnabled: false, ranges: [] });
  return input;
}
const plain = value => JSON.parse(JSON.stringify(value));
const decode = value => value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const chartSpec = html => JSON.parse(decode(html.match(/data-longitudinal-chart="([^"]+)"/)[1]));
const contains = (range, value) => (range.min == null || value > range.min || value === range.min && range.includeMin !== false) && (range.max == null || value < range.max || value === range.max && range.includeMax !== false);
function run() {
  const env = context(), viewFile = path.join(__dirname, "../src/ringside-longitudinal-view.js");
  vm.runInContext(execFileSync("git", ["show", "5371d20288c64be346e3510ddbc9b75d66d537b5:src/ringside-longitudinal-view.js"], { encoding: "utf8", cwd: path.resolve(__dirname, "..") }), env);
  const previousView = env.RingsideLongitudinalView;
  vm.runInContext(fs.readFileSync(viewFile, "utf8"), env);
  const D = env.RingsideResultDisplay, L = env.RingsideLongitudinal, V = env.RingsideLongitudinalView;
  const input = overviewFixture(env, createFixture), before = JSON.stringify(input), model = L.build(input.records, input), spec = chartSpec(V.render(model).overview);
  let passed = 0, failed = 0;
  function test(name, check) { try { check(); passed++; console.log("PASS " + name); } catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); } }
  const bands = html => [...html.matchAll(/<(?:path|polygon)\b[^>]*data-overview-band="[^"]+"[^>]*>/g)].map(match => ({ html: match[0], status: match[0].match(/data-overview-band="([^"]+)"/)[1], axis: match[0].match(/data-overview-axis="([^"]+)"/)?.[1] }));
  test("primary higher and lower mappings use the actual score domain and fixed-mean mappings use their own configured ranges", () => {
    assert.equal(typeof D.abilityReference, "function"); assert.equal(model.overview.axes.length, 3);
    for (const period of model.periods) for (const axis of period.stats.axes) {
      const reference = D.abilityReference(axis, period.record), cell = model.overview.series.find(series => series.id === period.id).cells[model.overview.axes.findIndex(item => item.key === axis.key)];
      assert.ok(reference, axis.key); assert.equal(reference.kind, "ranges"); assert.equal(reference.unit, "分"); assert.deepEqual(plain(cell.overviewReference), plain(reference));
      const actual = reference.ranges.filter(range => contains(range, axis.value)); assert.equal(actual.length, 1, axis.key); assert.equal(actual[0].status, axis.status, axis.key);
      assert.ok(reference.ranges.every(range => ["预警", "关注", "优秀"].includes(range.label)));
    }
    const primary = model.periods[0].stats.axes.find(axis => axis.key === "下肢爆发力"), ref = D.abilityReference(primary, model.periods[0].record);
    assert.equal(ref.ranges.find(range => range.status === "red").max, 60); assert.equal(ref.ranges.find(range => range.status === "green").min, 80);
    const mean = model.periods[0].stats.axes.find(axis => axis.method === "mean"); assert.equal(mean.members.length, 2); assert.equal(D.abilityReference(mean, model.periods[0].record).ranges.find(range => range.status === "green").min, 80);
  });
  test("each configured ability receives separate semantically labeled color bands below all three date curves", () => {
    for (const print of [false, true]) {
      const html = V.draw(spec, 600, print), found = bands(html);
      assert.ok(found.length >= 8); assert.deepEqual([...new Set(found.map(band => band.axis))].sort(), Array.from(spec.axes, axis => axis.key).sort());
      assert.deepEqual([...new Set(found.map(band => band.status))].sort(), ["amber", "green", "red"]);
      assert.ok(html.indexOf("data-overview-band") < html.indexOf('class="radar-fill"')); assert.equal((html.match(/class="radar-fill"/g) || []).length, 3);
      assert.match(html, /longitudinal-overview-key/); for (const label of ["预警", "关注", "优秀"]) assert.ok(html.includes(label));
      assert.doesNotMatch(html, /NaN|Infinity|data-risk-gradient/);
      assert.match(html, /data-overview-threshold="green"[^>]*data-overview-axis="冲刺速度"[^>]*data-score-value="100"/);
      assert.ok(!found.some(band => band.axis === "冲刺速度" && band.status === "green"), "a green score at exactly 100 must not manufacture a green interval below 100");
    }
  });
  test("an unconfigured mean axis stays unshaded while other configured axes keep their bands", () => {
    const changed = overviewFixture(env, createFixture); delete changed.profile.aggregations["ability:力量耐力"].ranges;
    const m = L.build(changed.records, changed), s = chartSpec(V.render(m).overview), index = s.axes.findIndex(axis => axis.key === "力量耐力");
    assert.ok(s.series.every(series => series.values[index] !== null)); assert.ok(s.series.every(series => series.cells[index].overviewReference == null));
    const found = bands(V.draw(s, 600)); assert.ok(found.length); assert.ok(found.every(band => band.axis !== "力量耐力"));
  });
  test("date filtering recalculates shared backgrounds and a differing period suppresses only the affected ability", () => {
    const mixed = plain(spec), index = mixed.axes.findIndex(axis => axis.key === "下肢爆发力"), ref = mixed.series[2].cells[index].overviewReference;
    ref.ranges.find(range => range.status === "amber").max = 90; ref.ranges.find(range => range.status === "green").min = 90;
    const full = V.draw(mixed, 600), all = bands(full); assert.ok(all.length); assert.ok(all.every(band => band.axis !== "下肢爆发力")); assert.match(full, /评价标准/); assert.match(full, /不同/);
    const selected = { ...mixed, series: mixed.series.slice(0, 2) }, filtered = bands(V.draw(selected, 600)); assert.ok(filtered.some(band => band.axis === "下肢爆发力"));
    assert.equal((V.draw(selected, 600).match(/class="radar-fill"/g) || []).length, 2);
  });
  test("missing measurements remain genuine gaps and fewer than three abilities remain a date table", () => {
    const missing = plain(spec); missing.series[1].values[1] = null; missing.series[1].cells[1] = null;
    const html = V.draw(missing, 600); assert.doesNotMatch(html, /NaN|Infinity/); assert.equal((html.match(/<circle\b/g) || []).length, 8); assert.ok(bands(html).length);
    for (const count of [1, 2]) { const small = { ...spec, axes: spec.axes.slice(0, count), series: spec.series.map(series => ({ ...series, values: series.values.slice(0, count), cells: series.cells.slice(0, count) })) }, table = V.draw(small, 600); assert.match(table, /longitudinal-overview-table/); assert.doesNotMatch(table, /<svg|data-overview-band/); }
  });
  test("injury risk rendering and all original measurements calculations and profile definitions remain byte-identical", () => {
    const risk = chartSpec(V.render(model).body); for (const print of [false, true]) assert.equal(V.draw(risk, 600, print), previousView.draw(risk, 600, print));
    for (const metric of model.overview.rows) V.table([metric], model.periods); assert.equal(JSON.stringify(input), before);
    for (const period of model.periods) assert.deepEqual(plain(env.RingsideModel.stats(period.record).axes), plain(period.stats.axes));
  });
  console.log(`${passed} overview background checks passed; ${failed} failed`); if (failed) process.exitCode = 1;
}
module.exports = { overviewFixture };
if (require.main === module) run();
