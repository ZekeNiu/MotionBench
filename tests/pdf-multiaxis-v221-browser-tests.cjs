"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const { ready, openExport, downloadFromReport } = require("./helpers/pdf-browser.cjs");
const root = path.resolve(__dirname, ".."), hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const OLD_HTML_SHA256 = "9fdac139dcad46a4f533877296f9000abdf9a91ec2d68fae1164453f9d19beae";

async function seedFixture(page, count, meanMembers = 0, longResults = false) {
  return page.evaluate(async ({ count, meanMembers, longResults }) => {
    const M = RingsideModel, E = RingsideEvaluation, r = M.sampleRecord();
    r.demo = false; r.recordId = "synthetic-v221-pdf-" + count + "-" + meanMembers; r.athleteId = "synthetic-v221-pdf-athlete";
    Object.assign(r.athlete, { name: "Synthetic multi-axis PDF", date: "2026-10-13", age: 25, sex: "男", mass: 70 });
    r.narrative.text = "Synthetic manual narrative remains complete after multi-axis PDF pagination.";
    r.narrative.html = "<p>" + r.narrative.text + "</p>"; r.narrative.origin = "人工";
    r.views.capabilityExpanded = {};
    const metricIds = ["cmj_height", "pushup_reps", "mb_dom", "ift_treadmill", "mas_speed", "landmine_r20", "mss_speed"].slice(0, count);
    const selected = metricIds.map(id => r.definitions.find(d => d.id === id));
    if (!meanMembers) Object.keys(r.enabled).forEach(id => r.enabled[id] = ["cmj", ...selected.map(d => d.testId)].includes(id));
    if (longResults) {
      const testId = "synthetic_long_table";
      r.customTests.push({id:testId,name:"Synthetic long results",category:"performance"}); r.enabled[testId] = true;
      for (let index = 0; index < 60; index++) {
        const id = "synthetic_long_metric_" + index;
        r.definitions.push({id,testId,name:"Synthetic result " + index,unit:"N",entryScope:"record",ability:"",category:"performance",direction:"higher",scoring:false,referenceEnabled:false,target:null,ranges:[]});
        r.customValues[id] = {value:index + 1,notes:""};
      }
    }
    const initial = M.stats(r), p = E.create(r, "Synthetic pagination scoring"); p.aggregations = {};
    const transform = id => ({ kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: initial.values[id] * 2, score: 100 }] });
    for (const d of selected) p.aggregations["ability:" + d.ability] = { method: "primary", primary: "metric:" + d.id, scoringVersion: 1, transforms: { ["metric:" + d.id]: transform(d.id) } };
    if (meanMembers) {
      const members = r.definitions.filter(d => Number.isFinite(initial.values[d.id]) && initial.values[d.id] > 0 && p.standards.some(rule => rule.id === "metric:" + d.id)).slice(0, meanMembers);
      if (members.length !== meanMembers) throw Error("Synthetic member fixture is incomplete");
      p.aggregations["ability:" + selected[0].ability] = { method: "mean", members: members.map(d => "metric:" + d.id), transforms: Object.fromEntries(members.map(d => ["metric:" + d.id, transform(d.id)])) };
    }
    await App.importPayload(M.recordEnvelope(r, p), "replace-library"); await App.showReport(false);
    const stats = App.stats(), state = App.getState();
    const rows = [...document.querySelectorAll('[data-test-ids="synthetic_long_table"] tbody > tr')].map(row => [...row.cells].map(cell => cell.textContent.trim()));
    return { count, meanMembers, longResults, axes: stats.axes.map(axis => ({ key: axis.key, value: axis.value, method: axis.method, members: axis.members, scores: axis.scores })), rows,
      hasRadar: !!document.querySelector("#radarChart > svg"), hasComparison: !!document.querySelector("#radarChart .ability-comparison"), scoreTables: document.querySelectorAll(".ability-score-details table").length,
      radarChartIndex: [...document.querySelectorAll("#reportView svg")].indexOf(document.querySelector("#radarChart > svg")),
      narrative: state.narrative.text, raw: JSON.stringify(state.data), recordId: state.recordId, athleteId: state.athleteId, profileId: state.evaluationProfileId, foldState: JSON.stringify(state.views.capabilityExpanded) };
  }, { count, meanMembers, longResults });
}

function assertFixture(fixture, count, meanMembers = 0) {
  assert.equal(fixture.axes.length, count); assert.equal(fixture.scoreTables, 0);
  assert.equal(fixture.hasRadar, count >= 3 && count <= 8); assert.equal(fixture.hasComparison, count > 0 && count < 3);
  for (const axis of fixture.axes) { assert.ok(Math.abs(axis.value - 50) < 1e-8); assert.ok(axis.scores.every(score => Math.abs(score - 50) < 1e-8)); }
  assert.equal(fixture.rows.length, fixture.longResults ? 60 : 0);
}

async function beginCapture(page) {
  await page.evaluate(() => {
    window.__v221OriginalCanvas = window.html2canvas; window.__v221Pages = [];
    window.html2canvas = async (node, options) => {
      const body = node.querySelector(".ringside-pdf-content"), bodyRect = body.getBoundingClientRect();
      const rect = element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, bottom: r.bottom }; };
      const scoreTables = [...body.querySelectorAll("table")].filter(table => [...table.querySelectorAll("tbody td:first-child")].some(td => td.textContent.startsWith("Synthetic result ")));
      __v221Pages.push({ body: rect(body), overflow: [...body.children].filter(child => child.getBoundingClientRect().bottom > bodyRect.bottom - 1).map(child => child.className),
        rows: scoreTables.flatMap(table => [...table.querySelectorAll("tbody > tr")].map(row => [...row.cells].map(cell => cell.textContent.trim()))),
        tables: scoreTables.map(table => ({ index: table.dataset.pdfTableIndex, header: [...table.querySelectorAll("thead th")].map(th => th.textContent.trim()), rowCount: table.querySelectorAll("tbody > tr").length })),
        charts: [...body.querySelectorAll("img[data-pdf-chart-index]")].map(image => ({ index: image.dataset.pdfChartIndex, rect: rect(image), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, originalHeight: image.dataset.pdfOriginalHeight ? Number(image.dataset.pdfOriginalHeight) : null })),
        wholeOverviewCards: [...body.querySelectorAll(".card")].filter(card => card.querySelector(".performance-layout")).length,
        overviewHeads: [...body.querySelectorAll(".card-head")].filter(head => head.querySelector("h3")?.textContent.trim() === "运动表现概览").map(rect),
        narrative: [...body.querySelectorAll("[data-pdf-narrative]")].map(element => element.textContent).join(""), text: body.textContent });
      return __v221OriginalCanvas(node, options);
    };
  });
}

async function finishCapture(page) {
  return page.evaluate(() => {
    window.html2canvas = window.__v221OriginalCanvas;
    return { diagnostics: RingsidePDF.lastDiagnostics, pages: window.__v221Pages, live: { raw: JSON.stringify(App.getState().data), narrative: App.getState().narrative.text, recordId: App.getState().recordId, athleteId: App.getState().athleteId, profileId: App.getState().evaluationProfileId, folds: JSON.stringify(App.getState().views.capabilityExpanded) }, leakedStages: document.querySelectorAll(".ringside-pdf-stage").length };
  });
}

function assertExport(evidence, fixture) {
  const d = evidence.diagnostics;
  assert.equal(d.status, "complete"); assert.equal(evidence.leakedStages, 0); assert.equal(d.pageCount, evidence.pages.length);
  for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(d[key], []);
  assert.equal(d.rowCount, d.renderedRowCount); assert.ok(d.textChecks.every(check => check.exact || check.keepWithNext && check.renderedCharacters === 0));
  assert.deepEqual(evidence.pages.flatMap(page => page.rows), fixture.rows, "Every long result cell must occur once with its original value");
  assert.ok(!/查看能力评分的计算|给分方式|平均贡献/.test(evidence.pages.map(page => page.text).join("")), "Removed calculation details must not enter the PDF");
  assert.ok(evidence.pages.every(page => !page.overflow.length), "No content may extend beyond a PDF page");
  assert.ok(evidence.pages.flatMap(page => page.charts).every(chart => chart.rect.height > 0 && chart.rect.width > 0 && (!chart.originalHeight || chart.rect.height >= chart.originalHeight * .85 - .1)), "Charts must retain complete readable artwork");
  assert.deepEqual(evidence.live, { raw: fixture.raw, narrative: fixture.narrative, recordId: fixture.recordId, athleteId: fixture.athleteId, profileId: fixture.profileId, folds: fixture.foldState });
  assert.ok(evidence.pages.map(page => page.text).join("").includes(fixture.narrative));
  if (fixture.hasRadar) {
    const headingPages = evidence.pages.filter(page => page.overviewHeads.length);
    assert.equal(headingPages.length, 1, "Overview heading must appear exactly once");
    assert.ok(headingPages[0].charts.some(chart => Number(chart.index) === fixture.radarChartIndex), "The overview heading and its radar must remain on the same page");
  }
  if (fixture.longResults) {
    const ids = evidence.pages.flatMap(page => page.tables.map(table => table.index));
    assert.ok(ids.some(id => ids.filter(other => other === id).length > 1), "Long member tables must paginate with repeated headers");
    assert.ok(evidence.pages.flatMap(page => page.tables).every(table => table.header.includes("指标")));
  }
  if (fixture.count === 1) assert.equal(evidence.pages.reduce((sum, page) => sum + page.wholeOverviewCards, 0), 1, "A short overview must remain a whole card");
}

async function main() {
  const channel = process.argv.includes("--edge") ? "msedge" : "chrome", baseline = process.argv.includes("--baseline");
  const arg = process.argv.indexOf("--artifact-dir"), out = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/implementation-2.20.1/pdf"); fs.mkdirSync(out, { recursive: true });
  let source = path.join(root, "MotionBench.html");
  if (baseline) { source = path.join(out, "MotionBench-2.20.0-baseline.html"); fs.writeFileSync(source, execFileSync("git", ["show", "v2.20.0:MotionBench.html"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })); assert.equal(hash(source), OLD_HTML_SHA256); }
  const result = { synthetic: true, channel, sourceHash: hash(source), runnerSha256: hash(__filename), helperHashes: { "tests/helpers/playwright.cjs": hash(path.join(root, "tests/helpers/playwright.cjs")), "tests/helpers/pdf-browser.cjs": hash(path.join(root, "tests/helpers/pdf-browser.cjs")) }, baseline, checks: [], errors: [], network: [], fixtures: [], pdfs: [], artifacts: [], pass: false };
  if (baseline) result.baselineHtml = { path: path.relative(root, source).replaceAll("\\", "/"), sha256: hash(source) };
  const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(20000);
  const check = async (name, action) => { await action(); result.checks.push(name); console.log("PASS " + name); };
  page.on("pageerror", error => result.errors.push(error.message)); page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
  try {
    await page.goto(pathToFileURL(source).href); await ready(page);
    for (const [count, meanMembers, longResults] of baseline ? [[3, 0], [7, 0]] : [[3, 0], [7, 0], [7, 2], [1, 0], [3, 2, true]]) {
      let fixture;
      await check(`${count} axes / ${meanMembers} mean members use real shared scores and the expected overview`, async () => { fixture = await seedFixture(page, count, meanMembers, longResults); assertFixture(fixture, count, meanMembers); result.fixtures.push(fixture); });
      await check(baseline ? `published 2.20.0 actually rejects the oversized ${count}-axis radar card` : `actual ${count}-axis / ${meanMembers}-member PDF preserves every row chart and narrative`, async () => {
        if (baseline) {
          let downloads = 0; const onDownload = () => downloads++; page.on("download", onDownload);
          await openExport(page); await page.locator("#reportExportMenu [data-pdf-action]").click();
          await page.waitForFunction(recordId => { const d = RingsidePDF.lastDiagnostics; return d?.recordId === recordId && ["failed", "complete"].includes(d.status); }, fixture.recordId);
          const failure = await page.evaluate(() => ({ status: RingsidePDF.lastDiagnostics.status, error: RingsidePDF.lastDiagnostics.error, stages: document.querySelectorAll(".ringside-pdf-stage").length, raw: JSON.stringify(App.getState().data), narrative: App.getState().narrative.text }));
          page.off("download", onDownload); result.fixtures.at(-1).expectedFailure = failure; assert.equal(failure.status, "failed"); assert.equal(downloads, 0); assert.match(failure.error, /PDF 中有超过一页的图表或卡片/); assert.equal(failure.stages, 0); assert.equal(failure.raw, fixture.raw); assert.equal(failure.narrative, fixture.narrative);
        } else {
          await beginCapture(page);
          const download = await downloadFromReport(page, "downloadPDF", 240000), file = path.join(out, `${channel}-${count}-axes-${meanMembers}-mean.pdf`); await download.saveAs(file);
          const evidence = await finishCapture(page); assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), "%PDF-");
          result.pdfs.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: hash(file), axisCount: count, meanMembers, ...evidence });
          assertExport(evidence, fixture);
        }
      });
    }
    result.pass = true;
  } catch (error) { result.failure = error.stack; console.error(result.failure); process.exitCode = 1; }
  finally { result.sourceUnchanged = hash(source) === result.sourceHash; result.pass = result.pass && result.sourceUnchanged && !result.errors.length && !result.network.length; fs.writeFileSync(path.join(out, `${baseline ? "baseline-" : ""}${channel}.json`), JSON.stringify(result, null, 2)); await context.close(); await browser.close(); if (!result.pass) process.exitCode = 1; }
}

module.exports = { seedFixture, assertFixture, beginCapture, finishCapture, assertExport };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
