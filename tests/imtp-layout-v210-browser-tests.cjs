"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { spawnSync } = require("node:child_process");
const { chromium } = require("./helpers/playwright.cjs");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome", uiOnly = process.argv.includes("--ui-only");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html");
const out = path.join(root, "output", channel === "msedge" ? "imtp-layout-v210-edge" : "imtp-layout-v210");
fs.mkdirSync(out, { recursive: true });
const hash = filename => createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
const result = { sourceHash: hash(file), channel, uiOnly, checks: [], pdfs: [], errors: [], pass: false };
let browser, page;
async function fixture(count, points, pdf = false) {
  await page.evaluate(({ count, points, pdf }) => {
    const r = App.getState(), recordId = r.recordId, athleteId = r.athleteId, evaluationProfileId = r.evaluationProfileId;
    Object.assign(r, RingsideModel.sampleRecord(), { recordId, athleteId, evaluationProfileId });
    r.projectSnapshots = RingsideTests.snapshots(RingsideModel.defaults()); r.mode = "mean"; r.narrative.text = "";
    r.data.imtp = Array.from({ length: count }, (_, i) => ({ id: "imtp-layout-" + i, peakForce: 2600 + i * 200, baselineForce: 100,
      timePoints: Array.from({ length: points }, (_, t) => ({ id: "p-" + i + "-" + t, timeMs: (t + 1) * 25,
        force: 500 + t * 65 + i * 35, rfd: 12345 + t * 80 + i * 30 })) }));
    const profile = App.getLibrary().evaluationProfiles.find(item => item.id === evaluationProfileId);
    profile.criteria.imtpTimeStandards = [{ timeMs: 25, kind: "force_pct_peak", context: RingsideEvaluation.imtpTimeContext(r), target: 90,
      ranges: Def.parseRanges("<90 | 待提升 | red\n>=90 | 优秀 | green"), direction: "higher", referenceEnabled: true, source: "IMTP布局验收标准" }];
    if (pdf) r.enabled = Object.fromEntries(Object.keys(r.enabled).map(id => [id, id === "imtp"]));
    App.showReport(); App.renderReport();
  }, { count, points, pdf });
  await page.waitForTimeout(150);
}
async function check(id, fn) {
  try { const detail = await fn(); result.checks.push({ id, pass: true, detail }); console.log("PASS " + id); }
  catch (error) { result.checks.push({ id, pass: false, error: error.stack }); console.error("FAIL " + id + ": " + error.stack); }
}
(async () => {
  browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1100 }, locale: "zh-CN" });
  page = await context.newPage(); page.on("pageerror", error => result.errors.push(error.message));
  await page.goto(pathToFileURL(file).href); await page.evaluate(() => App.ready); await page.evaluate(() => App.importPayload(RingsideModel.recordEnvelope(RingsideModel.sampleRecord())));
  await check("IMTP-single-and-repeated-share-desktop-columns-and-stack-at-content-breakpoint", async () => {
    const layouts = [];
    for (const count of [1, 3]) {
      await fixture(count, 3);
      const widths = [1440, 1024, 900, 390];
      await page.setViewportSize({ width: 900, height: 1100 }); await page.waitForTimeout(150);
      const adjustment = await page.locator("#detail-imtp .detail-pair").evaluate(n => 760 - n.getBoundingClientRect().width);
      widths.splice(3, 0, Math.round(900 + adjustment), Math.round(899 + adjustment));
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1100 }); await page.waitForTimeout(160);
        const geometry = await page.evaluate(() => {
          const box = n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
          const pair = document.querySelector("#detail-imtp .detail-pair"), chart = pair.querySelector(".chart-wrap"), table = pair.querySelector("table");
          const brokenNumbers = [], walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) for (const match of walker.currentNode.textContent.matchAll(/\d[\d,.]*%?/g)) {
            const range = document.createRange(); range.setStart(walker.currentNode, match.index); range.setEnd(walker.currentNode, match.index + match[0].length);
            if (range.getClientRects().length > 1) brokenNumbers.push(match[0]);
          }
          return { viewport: innerWidth, pair: box(pair), table: box(table), chart: box(chart), brokenNumbers,
            pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            tableOverflow: table.scrollWidth > pair.querySelector(".detail-data").clientWidth + 1,
            columns: [...table.tHead.rows[0].cells].map(n => n.textContent),
            peers: ["#detail-iso", "#detail-fms", "#detail-cmj"].map(id => box(document.querySelector(id + " .detail-data table"))) };
        });
        assert.equal(geometry.pageOverflow, false, JSON.stringify(geometry)); assert.equal(geometry.tableOverflow, false, JSON.stringify(geometry));
        assert.deepEqual(geometry.brokenNumbers, [], JSON.stringify(geometry));
        if (geometry.pair.width >= 760) {
          assert.ok(geometry.chart.right < geometry.table.x, JSON.stringify(geometry));
          for (const peer of geometry.peers) { assert.ok(Math.abs(peer.x - geometry.table.x) < 2); assert.ok(Math.abs(peer.right - geometry.table.right) < 2); }
          assert.ok(Math.abs(geometry.chart.width / (geometry.chart.width + geometry.table.width) - .44) < .005);
        } else assert.ok(geometry.chart.bottom <= geometry.table.y + 1, JSON.stringify(geometry));
        assert.ok(geometry.columns.includes("评价")); assert.ok(geometry.columns.includes("目标"));
        if (count === 3) { assert.ok(geometry.columns.includes("均值 ± SD")); assert.ok(geometry.columns.includes("CV")); assert.equal(geometry.columns.length, 7); }
        layouts.push({ count, ...geometry });
      }
    }
    return layouts;
  });
  for (const config of uiOnly ? [] : [{ id: "short-single", count: 1, points: 2, mode: "side-by-side" }, { id: "short-repeated", count: 3, points: 2, mode: "side-by-side" }, { id: "long-repeated", count: 3, points: 24, mode: "stacked" }]) {
    await check("actual-PDF-IMTP-" + config.id, async () => {
      await page.setViewportSize({ width: 1440, height: 1100 }); await fixture(config.count, config.points, true);
      const rows = await page.locator(".imtp-results tbody tr").evaluateAll(nodes => nodes.map(n => n.dataset.metricId));
      await page.evaluate(() => {
        window.__imtpLayoutPages = []; window.__imtpLayoutCanvas = html2canvas;
        window.html2canvas = async (node, opts) => {
          const content = node.querySelector(".ringside-pdf-content"), bounds = content.getBoundingClientRect();
          __imtpLayoutPages.push({
            pairs: [...node.querySelectorAll(".imtp-detail")].map(n => ({ mode: n.dataset.pdfImtpLayout, grid: getComputedStyle(n).gridTemplateColumns })),
            charts: [...node.querySelectorAll('.chart-wrap[data-pdf-imtp-layout]')].map(n => ({ mode: n.dataset.pdfImtpLayout, width: n.getBoundingClientRect().width })),
            tables: [...node.querySelectorAll(".imtp-results")].map(n => ({ mode: n.dataset.pdfImtpLayout, width: n.getBoundingClientRect().width, headers: n.tHead.innerText, rows: [...n.tBodies[0].rows].map(r => r.dataset.metricId) })),
            overflow: [...content.children].filter(n => n.getBoundingClientRect().bottom > bounds.bottom + 1 || n.getBoundingClientRect().right > bounds.right + 1).map(n => n.className) });
          return __imtpLayoutCanvas(node, opts);
        };
      });
      const before = await page.evaluate(() => JSON.stringify(App.getState()));
      await page.locator("#reportExportMenu > summary").click();
      const pending = page.waitForEvent("download", { timeout: 180000 }); await page.locator("#reportActions [data-pdf-action]").click();
      const item = await pending, pdf = path.join(out, config.id + ".pdf"); await item.saveAs(pdf);
      await page.waitForFunction(() => !document.querySelector("#reportActions [data-pdf-action]").disabled);
      const capture = await page.evaluate(() => { const value = { pages: __imtpLayoutPages, diagnostics: RingsidePDF.lastDiagnostics, after: JSON.stringify(App.getState()) }; window.html2canvas = __imtpLayoutCanvas; return value; });
      assert.equal(capture.after, before); assert.equal(capture.diagnostics.status, "complete");
      for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(capture.diagnostics[key], []);
      assert.equal(capture.diagnostics.imtpLayouts[0].mode, config.mode);
      const tables = capture.pages.flatMap(p => p.tables);
      assert.deepEqual(tables.flatMap(t => t.rows), rows); assert.ok(tables.every(t => t.mode === config.mode));
      assert.ok(capture.pages.every(p => !p.overflow.length));
      if (config.count === 3) assert.ok(tables.every(t => /均值 ± SD/.test(t.headers) && /CV/.test(t.headers)));
      if (config.mode === "stacked") {
        assert.ok(tables.length > 1); assert.ok(capture.pages.every(p => !p.pairs.length)); assert.ok(tables.every(t => Math.abs(t.width - 703) < 1));
      } else { assert.equal(tables.length, 1); assert.equal(capture.pages.flatMap(p => p.pairs).length, 1); assert.ok(tables[0].width < 400); }
      const prefix = path.join(out, config.id + "-page"), rendered = spawnSync("pdftoppm", ["-scale-to", "1400", "-png", pdf, prefix], { encoding: "utf8", windowsHide: true });
      assert.equal(rendered.status, 0, rendered.error?.message || rendered.stderr);
      const images = capture.pages.map((_, i) => { const filename = prefix + "-" + String(i + 1).padStart(String(capture.pages.length).length, "0") + ".png"; return { path: path.relative(root, filename), sha256: hash(filename) }; });
      result.pdfs.push({ ...config, pdf: path.relative(root, pdf), sha256: hash(pdf), pages: capture.pages, diagnostics: capture.diagnostics, images });
      return { pages: capture.pages.length, mode: config.mode, rows: rows.length };
    });
  }
  result.currentSourceHash = hash(file); result.pass = result.checks.every(c => c.pass) && !result.errors.length && result.sourceHash === result.currentSourceHash;
  fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify(result, null, 2)); await browser.close(); if (!result.pass) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; browser?.close(); });
