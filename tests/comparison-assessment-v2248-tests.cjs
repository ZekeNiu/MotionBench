"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { context, createFixture } = require("./helpers/longitudinal-fixture.cjs");

// One isolated input contract is reused by the browser and model checks. It is
// deliberately built through the production normalizer/evaluation profile.
function assessmentFixture(env, base) {
  const input = base(env, 3);
  input.records.forEach((record, i) => {
    Object.keys(record.enabled).forEach(id => record.enabled[id] = ["fms", "iso", "cmj", "imtp", "long_generic", "fvp_sj"].includes(id));
    record.isoDirectionIds = ["iso_neck_flexion", "iso_shoulder_externalRotation", "iso_shoulder_internalRotation"];
    record.data.cmj.forEach(trial => trial.height = [25, 45, 55][i]);
    record.data.long_generic.forEach(trial => Object.assign(trial.metrics, { long_time: [12, 9, 7][i], long_pct: [60, 90, 110][i], long_unknown: [50, 55, 60][i] }));
    Object.assign(record.data.fms[0], { score: [1, 2, 3][i], pain: false, notes: "原始动作备注" });
    Object.assign(record.data.fms[1], { left: 3, right: 3, pain: i === 1, notes: "双侧原始备注" });
    Object.assign(record.data.iso.find(row => row.id === "iso_neck_flexion"), { center: [140, 180, 220][i], target: 200, painCenter: i > 0, notes: "原始力量备注" });
    Object.assign(record.data.iso.find(row => row.id === "iso_shoulder_externalRotation"), { left: 140, right: 180, target: 100, painLeft: false, painRight: false });
    Object.assign(record.data.iso.find(row => row.id === "iso_shoulder_internalRotation"), { left: 220, right: 220, target: 200, painLeft: true, painRight: false });
  });
  const rule = id => input.profile.standards.find(item => item.metricId === id);
  Object.assign(rule("cmj_height"), { enabled: true, targetEnabled: true, target: 50, rangesEnabled: true, ranges: [
    { min: 0, max: 35, includeMin: true, includeMax: false, status: "red", label: "原红区文字" },
    { min: 35, max: 50, includeMin: true, includeMax: false, status: "amber", label: "原黄区文字" },
    { min: 50, max: 80, includeMin: true, includeMax: true, status: "green", label: "原绿区文字" }
  ] });
  for (const [id, target] of [["long_time", 8], ["long_pct", 100], ["imtp_peak_force", 2500]])
    Object.assign(rule(id), { enabled: true, targetEnabled: true, target, rangesEnabled: false, ranges: [] });
  Object.assign(rule("long_unknown"), { enabled: true, targetEnabled: false, rangesEnabled: true, ranges: [{ min: 40, max: 80, includeMin: true, includeMax: true, status: "gray", label: "自定观察区" }] });
  for (const [directionId, target] of [["iso_neck_flexion", 200], ["iso_shoulder_externalRotation", 100], ["iso_shoulder_internalRotation", 200]]) {
    const standard = input.profile.standards.find(item => item.directionId === directionId);
    Object.assign(standard, { enabled: true, targetEnabled: true, target, rangesEnabled: false, ranges: [] });
    if (standard.reference) standard.reference.enabled = false;
  }
  return input;
}

function run() {
  const env = context();
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-longitudinal-view.js"), "utf8"), env);
  const L = env.RingsideLongitudinal, D = env.RingsideResultDisplay, V = env.RingsideLongitudinalView;
  const plain = value => JSON.parse(JSON.stringify(value)), row = (model, id) => model.projects.flatMap(project => project.metrics).find(item => item.id === id);
  const input = assessmentFixture(env, createFixture), before = JSON.stringify(input), model = L.build(input.records, input);
  let passed = 0, failed = 0;
  function test(name, check) { try { check(); passed++; console.log("PASS " + name); } catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); } }
  const spec = metric => D.trend(metric, model.periods, L.change);
  const rectangles = html => [...html.matchAll(/<rect\b([^>]*)>([\s\S]*?)<\/rect>/g)].filter(match => /fill-opacity="\.075"/.test(match[1])).map(match => {
    const attr = key => match[1].match(new RegExp('(?:^| )' + key + '="([^"]+)"'))?.[1];
    return { x: +attr("x"), y: +attr("y"), width: +attr("width"), height: +attr("height"), fill: attr("fill"), scope: attr("data-trend-band-scope"), periodIndex: +attr("data-trend-period-index"), title: match[2].replace(/<[^>]+>/g, "") };
  });
  const color = { red: "#b23f3d", amber: "#ac7a21", green: "#187459", gray: "#708699" };

  test("all real colored grades use the same three audience labels while custom gray and asymmetry retain their meaning", () => {
    const labels = { red: "预警", amber: "关注", green: "优秀" };
    const cells = [...model.projects.flatMap(project => project.metrics), ...model.capability.cards.flatMap(card => card.metrics), ...model.risk.rows].filter(metric => metric.section !== "asymmetry").flatMap(metric => metric.cells).filter(cell => cell?.display.visible);
    assert.ok(cells.length > 35);
    for (const cell of cells) if (labels[cell.display.status]) assert.equal(cell.display.label, labels[cell.display.status]);
    assert.ok(row(model, "long_unknown").cells.every(cell => cell.display.label === "自定观察区" && cell.display.status === "gray"));
    assert.ok(row(model, "asym:iso_shoulder_externalRotation").cells.every(cell => /左侧更弱/.test(cell.display.label)));
  });
  test("recorded isometric pain takes priority over a met target and remains traceable without changing the numeric result", () => {
    const force = row(model, "iso:iso_neck_flexion:C");
    assert.deepEqual(plain(force.cells.map(cell => cell.value)), [140, 180, 220]);
    assert.equal(force.cells[0].display.status, "amber");
    for (const cell of force.cells.slice(1)) { assert.equal(cell.display.status, "red"); assert.equal(cell.display.label, "预警"); assert.match(cell.display.reason || "", /疼痛/); }
    const html = V.table([force], model.periods);
    assert.doesNotMatch(html, /录入标记：疼痛|longitudinal-symptom/); assert.match(html, /title="[^"]*疼痛/);
  });
  test("a 22.2 percent bilateral difference stays in its own row and never downgrades target-met force", () => {
    const force = row(model, "iso:iso_shoulder_externalRotation:L"), asymmetry = row(model, "asym:iso_shoulder_externalRotation");
    assert.ok(force.cells.every(cell => cell.display.status === "green" && cell.display.label === "优秀"));
    assert.ok(force.cells.every(cell => !/双侧差异/.test(cell.display.reason || "")));
    for (const cell of asymmetry.cells) { assert.ok(Math.abs(cell.value - 22.22222222222222) < 1e-10); assert.equal(cell.display.status, "red"); assert.match(cell.display.label, /左侧更弱/); }
  });
  test("FMS pain remains zero red regardless of full bilateral scores", () => {
    const cell = row(model, "fms:1").cells[1];
    assert.equal(cell.value, 0); assert.equal(cell.display.status, "red"); assert.equal(cell.display.label, "预警");
    assert.equal(cell.rawTrials[0].left, 3); assert.equal(cell.rawTrials[0].right, 3); assert.match(cell.notes, /疼痛/);
  });
  test("a pain flag without a numeric force value shows a symptom warning while preserving the missing measurement", () => {
    const fixture = assessmentFixture(env, createFixture); fixture.records.forEach(record => Object.assign(record.data.iso.find(row => row.id === "iso_neck_flexion"), { center: "", painCenter: true }));
    const changed = L.build(fixture.records, fixture), metric = row(changed, "iso:iso_neck_flexion:C"); assert.ok(metric);
    for (const cell of metric.cells) { assert.equal(cell.value, null); assert.equal(cell.pain, true); assert.equal(cell.display.visible, true); assert.equal(cell.display.state, "warning"); assert.equal(cell.display.status, "red"); assert.equal(cell.display.label, "预警"); assert.match(cell.display.reason, /疼痛记录/); }
    const html = V.table([metric], changed.periods, { wrapped: false }); assert.equal((html.match(/longitudinal-unavailable/g) || []).length, 3); assert.equal((html.match(/class="pill red longitudinal-assessment"/g) || []).length, 3); assert.doesNotMatch(html, /<strong>0<\/strong>/);
  });
  test("range higher-target lower-target isometric-target and FMS references shade the actual grade region", () => {
    for (const id of ["cmj_height", "long_pct", "long_time", "iso:iso_shoulder_externalRotation:L", "iso:iso_neck_flexion:C", "imtp_peak_force", "fms:0", "fms:1", "long_unknown"]) {
      const metric = row(model, id), projection = spec(metric), html = D.draw(projection), bands = rectangles(html);
      assert.ok(projection.reference, id); assert.ok(bands.length, id + " has no background bands");
      assert.ok(bands.every(band => Number.isFinite(band.y) && band.height > 0 && band.width > 0), id);
      const points = [...html.matchAll(/<g data-trend-point="(\d+)"[\s\S]*?<circle[^>]* cy="([^"]+)"/g)].map(match => ({ index: +match[1], y: +match[2] }));
      for (const point of points) {
        const cell = metric.cells[point.index]; if (cell.pain) continue;
        assert.ok(bands.some(band => band.fill === color[cell.display.status] && point.y >= band.y - .02 && point.y <= band.y + band.height + .02), id + " point " + point.index + " is outside its actual grade band");
      }
    }
  });
  test("missing disabled mismatched and genuinely unconfigured standards do not acquire misleading grade bands", () => {
    for (const kind of ["disabled", "mismatched", "missing", "unconfigured"]) {
      const fixture = assessmentFixture(env, createFixture), standard = fixture.profile.standards.find(item => item.metricId === "cmj_height");
      if (kind === "disabled") standard.enabled = false;
      if (kind === "mismatched") fixture.records.forEach(record => record.protocolIdentities.cmj.version++);
      if (kind === "missing") fixture.records.forEach(record => record.data.cmj = []);
      if (kind === "unconfigured") Object.assign(standard, { targetEnabled: false, rangesEnabled: false, ranges: [], target: null });
      const changed = L.build(fixture.records, fixture), metric = row(changed, "cmj_height"); if (!metric) continue;
      assert.ok(metric.cells.filter(Boolean).every(cell => !cell.display.visible), kind);
      assert.equal(rectangles(D.draw(D.trend(metric, changed.periods, L.change))).length, 0, kind);
    }
    assert.equal(rectangles(D.draw(spec(row(model, "fvp_sj:profile:slope")))).length, 0);
  });
  test("different effective standards use individual date slots while an unconfigured date stays unshaded", () => {
    const metric = plain(row(model, "cmj_height")); metric.cells[1].evaluationKey += ":changed";
    metric.cells[1].display.reference = { kind: "target", target: 45, direction: "higher", unit: "cm", ranges: [{ min: null, max: 45, includeMin: false, includeMax: false, status: "amber", label: "关注" }, { min: 45, max: null, includeMin: true, includeMax: false, status: "green", label: "优秀" }] };
    Object.assign(metric.cells[1].display, { status: "green", label: "优秀" }); Object.assign(metric.cells[2].display, { reference: null, visible: false, label: "", status: "gray" });
    const projection = spec(metric); assert.equal(projection.reference, null); assert.equal(projection.references.length, 3); assert.equal(projection.references[2], null);
    const html = D.draw(projection), bands = rectangles(html), xs = [...html.matchAll(/<circle cx="([^"]+)"/g)].map(match => +match[1]), bounds = [[xs[0], (xs[0] + xs[1]) / 2], [(xs[0] + xs[1]) / 2, (xs[1] + xs[2]) / 2]];
    assert.ok(bands.length); assert.ok(bands.every(band => band.scope === "period" && [0, 1].includes(band.periodIndex)));
    for (const band of bands) assert.ok(band.x >= bounds[band.periodIndex][0] - .02 && band.x + band.width <= bounds[band.periodIndex][1] + .02, JSON.stringify(band));
    const targets = html.match(/<path[^>]*data-trend-reference="target"[^>]*>/g) || []; assert.equal(targets.length, 2);
    targets.forEach((target, index) => { assert.match(target, /data-trend-reference-scope="period"/); assert.match(target, new RegExp('data-trend-period-index="' + index + '"')); const line = target.match(/ d="M([^ ]+) [^H]+H([^"]+)"/); assert.ok(line); assert.ok(+line[1] >= bounds[index][0] - .02 && +line[2] <= bounds[index][1] + .02); });
    const wrapped = V.table([metric], model.periods), compact = JSON.parse(wrapped.match(/data-longitudinal-table="([^"]+)"/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    assert.deepEqual(plain(D.trend(compact.rows[0], compact.periods, L.change).references), plain(projection.references)); assert.match(V.table(compact.rows, compact.periods, { print: true, wrapped: false }), /data-trend-band-scope="period"/);
    assert.equal(projection.points[1].change.improvement, null); assert.equal(projection.points[1].change.available, true);
  });
  test("target backgrounds follow the actual saved traffic thresholds and stop sharing when those thresholds change", () => {
    const fixture = assessmentFixture(env, createFixture); Object.assign(fixture.profile.settings.thresholds, { scoreAmber: 60, scoreGreen: 90 });
    const changed = L.build(fixture.records, fixture), metric = row(changed, "long_pct"), projection = D.trend(metric, changed.periods, L.change), html = D.draw(projection), bands = rectangles(html);
    assert.deepEqual(plain(metric.cells.map(cell => cell.display.status)), ["amber", "green", "green"]);
    assert.ok(bands.some(band => band.fill === color.amber)); assert.ok(bands.some(band => band.fill === color.green));
    // A unified profile overrides saved per-record rules. Exercise a changed
    // effective display contract directly rather than pretending it does not.
    const mixed = plain(metric); mixed.cells[1].displayRules.scoreAmber = 80; mixed.cells[1].display = D.assessment(mixed.cells[1]);
    const mixedProjection = D.trend(mixed, changed.periods, L.change);
    assert.equal(mixedProjection.reference, null); assert.equal(mixedProjection.references.length, 3); assert.ok(rectangles(D.draw(mixedProjection)).every(band => band.scope === "period"));
  });
  test("all result pills except bilateral difference share their value group in screen and print reconstruction", () => {
    const metrics = ["cmj_height", "fms:0", "long_time", "long_unknown", "iso:iso_neck_flexion:C", "asym:iso_shoulder_externalRotation"].map(id => row(model, id));
    const html = V.table(metrics, model.periods), projection = JSON.parse(html.match(/data-longitudinal-table="([^"]+)"/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    for (const rendered of [html, V.table(projection.rows, projection.periods, { print: true, wrapped: false })]) {
      const sections = [...rendered.matchAll(/<tr data-metric-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)]; assert.equal(sections.length, metrics.length);
      for (const [, id, content] of sections) {
        const groups = content.match(/<span class="longitudinal-result-value">[\s\S]*?<\/strong><span class="pill [^"]* longitudinal-assessment"/g) || [];
        assert.equal(groups.length, id.startsWith("asym:") ? 0 : 3, id);
      }
    }
    for (const metric of projection.rows) assert.deepEqual(plain(spec(metric).reference), plain(spec(row(model, metric.id)).reference));
  });
  test("raw records definitions selected trials narratives and full source statistics remain identical through all display operations", () => {
    const statistics = input.records.map(record => plain(env.RingsideModel.stats(record)));
    for (const metric of model.projects.flatMap(project => project.metrics)) { V.table([metric], model.periods); D.draw(spec(metric)); }
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(input.records.map(record => plain(env.RingsideModel.stats(record))), statistics);
    if (process.argv.includes("--baseline")) {
      const previous = context(), baseline = "77e97a594f3024d88e6c5c28cd8b6469ec569b18";
      for (const file of ["src/ringside-model.js", "src/ringside-evaluation.js"]) vm.runInContext(require("node:child_process").execFileSync("git", ["show", baseline + ":" + file], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }), previous);
      assert.deepEqual(input.records.map(record => plain(previous.RingsideModel.stats(record))), statistics);
    }
  });
  console.log(`${passed} comparison assessment checks passed; ${failed} failed`); if (failed) process.exitCode = 1;
}
module.exports = { assessmentFixture };
if (require.main === module) run();
