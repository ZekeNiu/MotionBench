"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "fvp", "sprint-fvp", "sprint-fvp-confidence", "sprint-elasticity", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/ringside-${name}.js`), "utf8"), c, { filename: name });
const M = c.RingsideModel, R = c.RingsideReport, V = c.RingsideViz;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
const times = [1.3735406501017202, 2.1031246565401025, 3.3485505747362385, 4.505234882806160, 5.633470563022033];
function fixture() {
  const r = M.sampleRecord(); r.athlete.mass = 75; r.athlete.height = 180;
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    r.enabled[id] = true; r.fvpConfig[id].distanceCm = 33;
    r.data[id] = [0, 20, 40, 60, 80].map((load, i) => ({ id: id + i, load, height: [33, 27, 22, 14, 10][i], distanceCm: "" }));
  }
  r.enabled.sprint_fvp = true;
  r.data.sprint_fvp = [{ id: "sprint", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ distanceM, timeS: times[i] })), excluded: false }];
  return r;
}
const chart = (html, kind) => {
  const encoded = html.match(new RegExp(`data-chart-kind="${kind}" data-chart-input="([^"]+)"`))?.[1];
  assert.ok(encoded, kind);
  return JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
};
test("all four cards precede the two FVP and two elasticity panels, with independent saved folds", () => {
  const r = fixture(); r.views.capabilityExpanded.reactive = true; r.views.capabilityExpanded.endurance = true;
  const before = JSON.stringify(r), html = R.renderCapabilityAnalysis(R.build(r));
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual([...html.matchAll(/data-capability-parameters="([^"]+)"( open)?/g)].map(m => [m[1], !!m[2]]), [["strength", false], ["reactive", true], ["speed", false], ["endurance", true]]);
  const sequence = ["data-capability-analysis", "data-fvp-panel=", "data-fvp-elasticity=", "data-sprint-fvp-panel", "data-sprint-elasticity-panel"].map(key => html.indexOf(key));
  assert.ok(sequence.every((position, i) => position >= 0 && (!i || position > sequence[i - 1])));
  assert.doesNotMatch(html, /trainingAnalysisDetail|能力发展方向与参数|保存情景|保存目标距离/);
  assert.match(html, /data-sprint-scenario="deltaForcePct"/); assert.match(html, /data-elasticity-draft-status data-elasticity-id="sprint_fvp"/);
});
test("automatic protocol choice uses one resolver for card, profile and jump elasticity", () => {
  const r = fixture(); delete r.views.fvpProtocol; r.views.capabilitySelections.strength = "jump_elasticity";
  r.data.fvp_sj = r.data.fvp_sj.slice(0, 2);
  const report = R.build(r), html = R.renderCapabilityAnalysis(report);
  assert.equal(M.resolveJumpFvpProtocol(r, report.stats), "fvp_cmj");
  assert.match(html, /data-fvp-panel="fvp_cmj"/); assert.match(html, /data-fvp-elasticity="fvp_cmj"/);
  assert.match(html, /data-direction-metric="jump_elasticity"[\s\S]*?CMJ/);
});
test("both alternate views retain the same current-versus-scenario results and clearly label predictions", () => {
  const r = fixture(); r.sprintFvpAnalysis.deltaForcePct = 5; r.sprintFvpAnalysis.deltaVelocityPct = 0;
  const a = R.renderCapabilityAnalysis(R.build(r));
  r.fvpView.fvp_sj.elasticityView = "constraint"; r.sprintFvpView.elasticityView = "distance";
  const report = R.build(r), b = R.renderCapabilityAnalysis(report);
  assert.ok(report.stats.sprintElasticity.scenario.timeGainPct > 0);
  assert.ok(report.stats.sprintElasticity.scenario.deltaPct < 0);
  for (const html of [a, b]) { assert.match(html, /模型预测跳跃高度/); assert.match(html, /模型预测冲刺时间/); assert.match(html, /缩短/); assert.doesNotMatch(html, /NaN|Infinity/); }
  const tables = html => [...html.matchAll(/<table class="fvp-scenario-table">[\s\S]*?<\/table>/g)].map(m => m[0]);
  assert.deepEqual(tables(a), tables(b));
  assert.match(b, /data-chart-kind="jumpElasticityConstraint"/); assert.match(b, /data-chart-kind="sprintElasticityDistance"/);
  assert.match(b, /data-elasticity-scenario-output data-elasticity-id="fvp_sj"/);
});
test("all response toggles are independent and chart scales remain finite on mobile and PDF", () => {
  const r = fixture(), report = R.build(r), html = R.renderCapabilityAnalysis(report);
  for (const kind of ["jumpElasticity", "sprintElasticity"]) {
    const [data] = chart(html, kind);
    for (const width of [280, 480]) for (const print of [false, true]) for (const shown of [false, true]) {
      const drawing = V[kind]({ ...data, responseForce: shown, responseVelocity: false, responseBoth: false }, { width, print, height: 330 });
      assert.doesNotMatch(drawing, /NaN|Infinity/);
      assert.equal((drawing.match(/data-response-series=/g) || []).length, shown ? 1 : 0);
    }
  }
  for (const [kind, data] of [["jumpElasticityConstraint", report.stats.fvp.fvp_sj.elasticityConstraint], ["sprintElasticityDistance", report.stats.sprintElasticity.constraint]]) {
    for (const width of [280, 480]) for (const print of [false, true]) {
      const drawing = V[kind](data, { width, print, height: 330 });
      assert.doesNotMatch(drawing, /NaN|Infinity/); assert.match(drawing, /data-elasticity-landmark="valley"/); assert.match(drawing, /data-elasticity-landmark="balance"/);
      if (kind === "sprintElasticityDistance") {
        assert.deepEqual([...drawing.matchAll(/data-distance-series="([^"]+)" data-distance-axis="([^"]+)"/g)].map(m => [m[1], m[2]]), [["Fe", "left"], ["ve", "left"], ["EN", "left"], ["ER", "right"]]);
      }
    }
  }
});
test("raw zero distance remains zero and blank distances explicitly use the common value", () => {
  const r = fixture(); r.data.fvp_sj[0].distanceCm = 0;
  const html = R.renderFVPAnalysis(R.build(r)), raw = html.match(/data-raw-trials="fvp_sj"[\s\S]*?<\/details>/)?.[0];
  assert.ok(raw); assert.match(raw, /data-label="蹬伸距离 cm"><div class="result-cell">0\.0<\/div>/);
  assert.match(raw, /33\.0（通用）/);
});
console.log(`${passed} dual elasticity report checks passed`);
