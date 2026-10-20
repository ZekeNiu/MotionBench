"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { context, createFixture } = require("./helpers/longitudinal-fixture.cjs");
const c = context();
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-longitudinal-view.js"), "utf8"), c);
const M = c.RingsideModel, R = c.RingsideReport, D = c.Def;
let passed = 0;
const test = (name, run) => { run(); passed++; console.log("PASS " + name); };
const text = html => html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const detail = html => html.match(/<article[^>]*id="detail-mb"[^>]*>[\s\S]*?<\/article>/)?.[0] || "";
const resultTable = html => detail(html).match(/<table\b[^>]*>[\s\S]*?<\/table>/)?.[0] || "";
const headers = html => [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(match => text(match[1]));
const row = (html, id) => html.match(new RegExp('<tr[^>]*data-metric-id="' + id + '"[^>]*>[\\s\\S]*?<\\/tr>'))?.[0] || "";
const cell = (html, label) => html.match(new RegExp('<td data-label="' + label + '">([\\s\\S]*?)<\\/td>'))?.[1] || "";
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, value + " != " + expected);

function fixture() {
  const r = M.defaults();
  Object.keys(r.enabled).forEach(id => r.enabled[id] = id === "mb");
  r.mode = "best";
  r.protocol.mb = "原始协议：3 kg；第一落点";
  r.narrative.text = "人工解读正文保留";
  r.narrative.html = "<p>人工解读正文保留</p>";
  r.data.mb = [{ id: "dominant-fixed", side: "D", distance: 10, notes: "优势侧原始备注" },
    { id: "nondominant-fixed", side: "ND", distance: 9, notes: "非优势侧原始备注" }];
  for (const definition of r.definitions.filter(d => d.testId === "mb")) Object.assign(definition, {
    referenceEnabled: true, targetEnabled: true, target: definition.id === "mb_dom" ? 12 : 8, direction: "higher",
    ranges: D.parseRanges("<8 | 原始低等级 | red\n[8..10) | 原始中等级 | amber\n>=10 | 原始高等级 | green"),
  });
  return r;
}

function renderUnchanged(record) {
  const before = JSON.stringify(record), report = R.build(record), built = JSON.stringify(report.record), html = R.render(report);
  assert.equal(JSON.stringify(record), before, "rendering preserves the stored data, definitions, protocols and narrative");
  assert.equal(JSON.stringify(report.record), built, "rendering preserves the report snapshot");
  assert.deepEqual(Array.from(report.diagnostics), []);
  return { report, html, ball: detail(html), table: resultTable(html) };
}

test("two measured sides use one result table with independent values grades targets and uncapped progress", () => {
  const { report, ball, table } = renderUnchanged(fixture());
  assert.deepEqual(headers(table), ["指标", "结果", "单位", "评价", "参考目标", "目标对照"]);
  assert.equal((ball.match(/<table\b/g) || []).length, 1);
  assert.doesNotMatch(ball, /<svg|chart-wrap|comparison-result|双侧差异|NaN|Infinity/);
  assert.equal((table.match(/data-metric-id="mb_dom"/g) || []).length, 1);
  assert.equal((table.match(/data-metric-id="mb_non"/g) || []).length, 1);
  const dominant = row(table, "mb_dom"), other = row(table, "mb_non");
  assert.equal(text(cell(dominant, "结果")), "10.00"); assert.equal(text(cell(other, "结果")), "9.00");
  assert.equal(text(cell(dominant, "单位")), "m"); assert.equal(text(cell(other, "单位")), "m");
  assert.match(cell(dominant, "评价"), /pill green/); assert.match(cell(other, "评价"), /pill amber/);
  assert.equal(text(cell(dominant, "参考目标")), "12.00 m"); assert.equal(text(cell(other, "参考目标")), "8.00 m");
  assert.match(text(cell(dominant, "目标对照")), /达成比例 83\.3%.*距参考目标 2\.0 m/);
  assert.match(text(cell(other, "目标对照")), /达成比例 112\.5%.*超过参考目标 1\.0 m/);
  assert.equal(report.projects[0].metrics.find(d => d.id === "mb_non").attainment, 100);
  assert.match(ball, /原始协议：3 kg；第一落点/);
});

test("a single valid side stays a single measured row without manufacturing the other side", () => {
  for (const [side, id, missing] of [["D", "mb_dom", "mb_non"], ["ND", "mb_non", "mb_dom"]]) {
    const r = fixture(); r.data.mb = r.data.mb.filter(attempt => attempt.side === side);
    const { ball, table } = renderUnchanged(r);
    assert.ok(row(table, id)); assert.equal(row(table, missing), "");
    assert.equal((table.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr\b/g) || []).length, 1);
    assert.doesNotMatch(ball, /<svg|双侧差异|未测侧.*0/);
  }
});

test("empty invalid or notes-only measurements never become zero-valued results", () => {
  for (const attempts of [[], [{ id: "blank", side: "D", distance: "", notes: "仅记录备注" }],
    [{ id: "zero", side: "D", distance: 0 }, { id: "negative", side: "ND", distance: -3 }]]) {
    const r = fixture(); r.data.mb = attempts;
    const { report, ball } = renderUnchanged(r);
    assert.equal(report.stats.values.mb_dom, undefined); assert.equal(report.stats.values.mb_non, undefined);
    assert.doesNotMatch(ball, /<svg|data-metric-id="mb_(?:dom|non)"/);
  }
});

test("best and mean modes retain representative results sample SD CV and all raw trials without duplicate summaries", () => {
  for (const mode of ["best", "mean"]) {
    const r = fixture(); r.mode = mode;
    r.data.mb = [8, 10, 12].map((distance, i) => ({ id: "repeat-D-" + i, side: "D", distance, notes: "原始备注 " + i }));
    r.data.mb.push({ id: "single-ND", side: "ND", distance: 9, notes: "非优势侧单次原文" },
      { id: "orphan", side: "D", distance: "", notes: "无效试次原文 & <保留>" });
    const { report, ball, table } = renderUnchanged(r);
    assert.deepEqual(headers(table), ["指标", "结果", "均值 ± SD", "CV", "评价", "参考目标", "目标对照"]);
    assert.equal(text(cell(row(table, "mb_dom"), "结果")), mode === "best" ? "12.00" : "10.00");
    assert.equal(text(cell(row(table, "mb_dom"), "均值 ± SD")), "10.00 ± 2.00");
    assert.equal(text(cell(row(table, "mb_dom"), "CV")), "20.0%");
    assert.equal(text(cell(row(table, "mb_non"), "均值 ± SD")), "—");
    assert.equal(text(cell(row(table, "mb_non"), "CV")), "—");
    assert.equal((ball.match(/data-repeat-stat="mb_dom"/g) || []).length, 1);
    assert.equal((ball.match(/data-raw-trials="mb"/g) || []).length, 1);
    assert.match(ball, /原始试次 · 共 5 次/);
    for (let i = 0; i < 3; i++) assert.match(ball, new RegExp("原始备注 " + i));
    assert.match(ball, /非优势侧单次原文/); assert.match(ball, /无效试次原文 &amp; &lt;保留&gt;/);
    const statistic = report.stats.repetitions.flatMap(group => group.statistics).find(metric => metric.id === "mb_dom");
    assert.equal(statistic.n, 3); near(statistic.mean, 10); near(statistic.sd, 2); near(statistic.cv, 20);
    assert.equal((table.match(/data-metric-id="mb_dom"/g) || []).length, 1);
  }
});

test("fewer than three trials retain raw observations while omitting unsupported SD and CV columns", () => {
  const r = fixture(); r.data.mb = [{ id: "D-1", side: "D", distance: 8 }, { id: "D-2", side: "D", distance: 10 }];
  const { ball, table } = renderUnchanged(r);
  assert.doesNotMatch(table, /均值 ± SD|>CV<|data-repeat-stat/);
  assert.match(ball, /原始试次 · 共 2 次/); assert.equal((table.match(/<table\b/g) || []).length, 1);
});

test("disabled absent zero or negative targets produce no invented ratio or gap while configured grades remain", () => {
  for (const update of [{ referenceEnabled: false }, { targetEnabled: false }, { target: "" }, { target: 0 }, { target: -1 }]) {
    const r = fixture(); r.definitions.filter(d => d.testId === "mb").forEach(d => Object.assign(d, update));
    const { table } = renderUnchanged(r);
    for (const id of ["mb_dom", "mb_non"]) {
      const html = row(table, id); assert.ok(html);
      assert.equal(text(cell(html, "参考目标")), "—"); assert.equal(text(cell(html, "目标对照")), "—");
      assert.doesNotMatch(html, /达成比例|距参考目标|超过参考目标|达到参考目标|NaN|Infinity/);
      if (update.referenceEnabled === false) assert.doesNotMatch(html, /class="pill/);
      else assert.match(html, /class="pill/);
    }
  }
});

test("custom red amber green and genuine gray ranges preserve evaluation semantics and saved definitions", () => {
  for (const [status, label] of [["red", "自定红色"], ["amber", "自定黄色"], ["green", "自定绿色"], ["gray", "自定义稳定等级"]]) {
    const r = fixture(); r.definitions.filter(d => d.testId === "mb").forEach(d => d.ranges = D.parseRanges(">=0 | " + label + " | " + status));
    const { report, table } = renderUnchanged(r);
    for (const id of ["mb_dom", "mb_non"]) {
      const html = cell(row(table, id), "评价"); assert.match(html, new RegExp('class="pill ' + status + '"'));
      assert.equal(text(html), D.assessmentLabel(status, label));
      assert.equal(report.projects[0].metrics.find(d => d.id === id).evaluation.label, label);
    }
  }
  const r = fixture(); r.definitions.filter(d => d.testId === "mb").forEach(d => d.ranges = D.parseRanges("<8 | 下段 | red\n>=11 | 上段 | green"));
  const { table } = renderUnchanged(r); assert.match(cell(row(table, "mb_dom"), "评价"), /pill gray/); assert.equal(text(cell(row(table, "mb_dom"), "评价")), "未分级");
});

test("exact target attainment and lower-direction custom definitions retain their existing progress calculations", () => {
  const r = fixture(); Object.assign(r.definitions.find(d => d.id === "mb_dom"), { target: 10 });
  Object.assign(r.definitions.find(d => d.id === "mb_non"), { target: 6, direction: "lower" });
  const { table } = renderUnchanged(r);
  assert.match(text(cell(row(table, "mb_dom"), "目标对照")), /达成比例 100\.0%.*达到参考目标/);
  assert.match(text(cell(row(table, "mb_non"), "目标对照")), /达成比例 66\.7%.*距参考目标 3\.0 m/);
});

test("other personal projects keep their result columns while longitudinal medicine-ball retains dated bars and trends", () => {
  const personal = fixture(); personal.enabled.pushup = true; personal.data.pushup.reps = 70;
  const { html } = renderUnchanged(personal), pushup = html.match(/<article[^>]*id="detail-pushup"[^>]*>[\s\S]*?<\/article>/)?.[0] || "";
  assert.ok(pushup); assert.doesNotMatch(pushup, /目标对照|达成比例/); assert.match(pushup, /data-metric-id="pushup_reps"/);
  const f = createFixture(c, 3), before = JSON.stringify(f.records), model = c.RingsideLongitudinal.build(f.records, f), project = model.projects.find(p => p.id === "mb");
  assert.ok(project);
  const figures = c.RingsideLongitudinalView.projectFigures(project, model), view = c.RingsideLongitudinalView.render(model);
  assert.equal(JSON.stringify(f.records), before);
  assert.match(figures, /data-longitudinal-chart=/); assert.match(figures, /&quot;kind&quot;:&quot;bars&quot;/);
  assert.match(view.details, /变化趋势/); assert.doesNotMatch(figures, /目标对照/);
  for (const period of model.periods) assert.ok(view.details.includes('data-record-id="' + period.id + '"'));
  assert.equal(project.metrics.filter(metric => ["mb_dom", "mb_non"].includes(metric.metricId)).length, 2);
  assert.ok(project.metrics.every(metric => !/双侧差异/.test(metric.name)));
});

console.log(passed + " medicine-ball report checks passed");
