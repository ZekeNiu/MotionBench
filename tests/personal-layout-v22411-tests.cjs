"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "result-display", "interventions", "viz", "report"]) vm.runInContext(fs.readFileSync(path.join(root, "src/ringside-" + name + ".js"), "utf8"), c);
const M = c.RingsideModel, R = c.RingsideReport;
let passed = 0; function test(name, run) { run(); passed++; console.log("PASS " + name); }
function fixture({ directions = true, fvp = true } = {}) {
  const r = M.defaults(); r.athlete.mass = 72; r.narrative.text = "人工解读完整保留";
  for (const id of Object.keys(r.enabled)) r.enabled[id] = (directions && ["cmj", "sj"].includes(id)) || (fvp && ["fvp_sj", "fvp_cmj"].includes(id));
  r.data.cmj = [{ id: "cmj-fixed", height: 40 }]; r.data.sj = [{ id: "sj-fixed", height: 30 }];
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    Object.assign(r.fvpConfig[id], { distanceCm: 33, device: "原设备", method: "腾空时间法", posture: "双手叉腰", distanceSource: "实测" });
    r.protocol[id] = "保留测试条件";
    r.data[id] = [0, 20, 40, 60, 80].map((load, i) => ({ id: id + "-" + i, load, height: [33, 27, 22, 14, 10][i], notes: "原始备注 " + i }));
  }
  return r;
}
test("capability analysis follows the same top-level disclosure and h3/h4 hierarchy as other report sections", () => {
  for (const options of [{ directions: true, fvp: false }, { directions: false, fvp: true }, { directions: true, fvp: true }]) {
    const r = fixture(options), before = JSON.stringify(r), html = R.renderCapabilityAnalysis(R.build(r));
    assert.match(html, /^<details class="details-group capability-analysis-region" id="capabilityDetail"[^>]*data-capability-region[^>]* open><summary>能力结构分析<span>/);
    assert.equal((html.match(/能力结构分析/g) || []).length, 2); // accessible label and one visible heading
    assert.equal((html.match(/class="quality-heading"><h3>发展方向<\/h3>/g) || []).length, 1);
    assert.equal((html.match(/class="quality-heading"><h3>力–速度剖面与弹性<\/h3>/g) || []).length, options.fvp ? 1 : 0);
    assert.match(html, /<h4>/); assert.equal(JSON.stringify(r), before);
  }
});
test("removing the personal FVP method disclosure keeps original protocols calculations load tables trials and controls", () => {
  const r = fixture(), before = JSON.stringify(r), report = R.build(r), values = JSON.stringify(report.stats.fvp);
  for (const print of [false, true]) {
    const html = R.renderFVPAnalysis(report, { print });
    assert.doesNotMatch(html, /测试条件、计算与来源/);
    assert.match(html, /负荷点与重复测量/); assert.match(html, /data-raw-trials="fvp_sj"/);
    assert.match(html, /原始备注 4/); assert.match(html, /FVP的不平衡性/); assert.match(html, /力量弹性 Fₑ/);
    if (!print) { assert.match(html, /data-fvp-angle/); assert.match(html, /data-fvp-view="confidence"/); assert.match(html, /data-fvp-scenario-form/); }
    else assert.match(html, /data-raw-trials="fvp_cmj"/);
  }
  assert.equal(JSON.stringify(r), before); assert.equal(JSON.stringify(report.stats.fvp), values);
  assert.equal(r.protocol.fvp_sj, "保留测试条件"); assert.ok(c.RingsideSources.entries.some(source => source.id.startsWith("fvp-")));
  assert.match(R.renderCapabilityAnalysis(report, { print: true, showFvpMethod: true }), /测试条件、计算与来源/);
});
console.log(passed + " personal report layout checks passed");
