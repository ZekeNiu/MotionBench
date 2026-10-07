"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "definitions", "tests", "model", "interventions", "viz", "report"])
  vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`, "utf8"), c);
const M = c.RingsideModel, V = c.RingsideViz, R = c.RingsideReport, I = c.RingsideInterventions;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
const ratio = (html, time) => Number(html.match(new RegExp(`data-force-time="${time}"[^>]*data-force-percent="([^"]+)"`))?.[1]);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
test("IMTP view defaults/imports/persistence keep measurements and draft fingerprint unchanged", () => {
  const r = M.sampleRecord(), before = M.fingerprint(r); delete r.views.imtp;
  assert.equal(M.normalizeRecord(r).views.imtp.yAxis, "percent");
  r.views.imtp = { yAxis: "force" };
  assert.equal(M.normalizeRecord(JSON.parse(JSON.stringify(r))).views.imtp.yAxis, "force");
  assert.equal(M.fingerprint(r), before);
  r.views.imtp.yAxis = "unrecognized";
  assert.equal(M.normalizeRecord(r).views.imtp.yAxis, "percent");
});
test("IMTP mean averages within-trial force percentages with unequal valid counts", () => {
  const r = M.defaults(); r.mode = "mean";
  r.data.imtp = [
    { id:"a", peakForce:2000, baselineForce:100, timePoints:[{id:"a1",timeMs:100,force:1000},{id:"a2",timeMs:200,rfd:7000}] },
    { id:"b", peakForce:3000, timePoints:[{id:"b1",timeMs:100,force:1800}] },
  ];
  const f = M.forceTime(r), html = V.forceTime(f);
  near(f.peakForce, 2500); near(ratio(html, 100), 55); near(ratio(html, 200), 75);
  assert.ok(html.includes("有效 1 次（0 实测 / 1 推算）"));
  assert.ok(html.includes("1,500") || html.includes("1500 N"));
  r.mode = "best"; near(ratio(V.forceTime(M.forceTime(r)), 100), 60);
});
test("IMTP absolute axis preserves N; percent retains above-peak values without fake time zero", () => {
  const f = {peakForce:2000, points:[{timeMs:100,force:2200,n:1,derived:false}]};
  near(ratio(V.forceTime(f),100),110);
  assert.match(V.forceTime(f), /占峰值力 \/ %/);
  const absolute = V.forceTime({...f,yAxis:"force"});
  assert.match(absolute, /力 \/ N/); assert.match(absolute,/110% 峰值 · 2200 N/);
  assert.doesNotMatch(absolute,/data-force-time="0"/);
});
test("invalid peak never produces a percentage while absolute partial force remains visible", () => {
  for (const peakForce of [null, "", 0, -1]) {
    const f = {peakForce, points:[{timeMs:100,force:900}]};
    assert.match(V.forceTime(f), /缺少有效峰值力/);
    assert.doesNotMatch(V.forceTime(f),/data-force-time|NaN|Infinity/);
    assert.match(V.forceTime({...f,yAxis:"force"}),/900 N/);
  }
});
test("reports omit configuration noise and empty evaluation columns but preserve actual unclassified results", () => {
  const r = M.defaults(); r.data.pushup.reps = 45;
  let html = R.render(R.build(r));
  assert.doesNotMatch(html,/未启用评价标准|未设等级区间/);
  r.definitions.find(d=>d.id==="pushup_reps").referenceEnabled = true;
  r.data.pushup.reps = 70; html = R.render(R.build(r));
  assert.match(html,/未分级/);
});
test("Markdown validation accepts independent dose and preserves safe, editable prose", () => {
  const prose = "## 综合判断\n已有优势可通过较低训练量维持。\n\n- 新动作：3组6次，RPE 6，休息2分钟；适应后每次增加1次。\n- 周一和周四安排，若次日恢复不足则减量。";
  assert.equal(I.validateAI("```markdown\n"+prose+"\n```"),prose);
  assert.match(M.textToHTML(prose),/<h3>综合判断<\/h3>/);
  assert.doesNotMatch(M.sanitizeHTML(M.textToHTML(prose+'\n<img src=x onerror="alert(1)">')),/<img/);
  for (const bad of ["", "---", "{\"error\":\"no report\"}", "[]", "<html>error</html>"])
    assert.throws(()=>I.validateAI(bad));
});
test("Markdown coach schedules render as safe tables with complete cell content", () => {
  const text = "## 周安排\n\n| 日期 | 内容 |\n|---|---|\n| 周一 | **力量**与稳定性 |\n| 周四 | <img src=x onerror=alert(1)> |\n\n继续观察恢复。";
  const html = M.sanitizeHTML(M.textToHTML(text));
  assert.match(html, /<thead><tr><th>日期<\/th>/);
  assert.match(html, /<strong>力量<\/strong>/);assert.match(html, /继续观察恢复/);
  assert.doesNotMatch(html, /<img/);
});
console.log(`${passed} chart/AI model checks passed`);
