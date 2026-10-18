"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const { createFixture } = require("./helpers/longitudinal-fixture.cjs");
const root = path.resolve(__dirname, ".."), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const overlay = process.argv.includes("--source-overlay"), source = path.join(root, "MotionBench.html");
const out = path.resolve(process.argv.find(arg => arg.startsWith("--artifact-dir="))?.slice(15) || path.join(root, "output/playwright/v2244/layout", (overlay ? "source-" : "") + channel));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const result = { synthetic: true, channel, sourceOverlay: overlay, sourceHash: hash(source), runnerSha256: hash(__filename), fixtureSha256: hash(path.join(__dirname, "helpers/longitudinal-fixture.cjs")), moduleHashes: Object.fromEntries(["longitudinal.js", "longitudinal-view.js", "longitudinal.css", "pdf.js"].map(name => ["src/ringside-" + name, hash(path.join(root, "src/ringside-" + name))])), pass: false, checks: [], errors: [], artifacts: [] };
  const browser = await chromium.launch({ channel, headless: true });
  const check = async (name, fn) => { await fn(); result.checks.push(name); console.log("PASS " + name); };
  const artifact = (name, bytes) => { const file = path.join(out, name); fs.writeFileSync(file, bytes); result.artifacts.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: hash(file) }); };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
    page.on("pageerror", error => result.errors.push(error.message));
    await page.goto(pathToFileURL(source).href); await page.waitForFunction(() => App.ready);
    if (overlay) {
      for (const name of ["longitudinal.js", "longitudinal-view.js", "pdf.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, "src/ringside-" + name), "utf8") });
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, "src/ringside-longitudinal.css"), "utf8") });
    }
    await page.addScriptTag({ content: "window.makeLayoutFixture=" + createFixture.toString() });
    await page.addStyleTag({ content: "body>:not(#layoutFixture):not(#personalFixture):not(.ringside-pdf-stage):not(.html2canvas-container){display:none!important}#layoutFixture,#personalFixture{width:calc(100% - 40px);max-width:1160px;margin:20px auto}" });
    await page.evaluate(() => {
      window.layoutInput = makeLayoutFixture(window, 4); window.layoutBefore = JSON.stringify(layoutInput);
      window.layoutModel = RingsideLongitudinal.build(layoutInput.records, layoutInput);
      const host = document.createElement("main"); host.id = "layoutFixture"; host.dataset.longitudinal = "true"; document.body.append(host);
      window.renderLayout = count => { const model = count === 4 ? layoutModel : RingsideLongitudinal.build(layoutInput.records.slice(0, count), layoutInput); host.innerHTML = RingsideLongitudinalView.render(model).details; RingsideLongitudinalView.layout(host); };
      renderLayout(4);
    });
    await check("FMS title radar and date legend stack without inherited flex compression or blank height", async () => {
      result.fms = await page.locator("#layoutFixture #detail-fms .longitudinal-chart").evaluate(node => {
        const box = n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
        return { display: getComputedStyle(node).display, chart: box(node), title: box(node.querySelector(".longitudinal-chart-title")), svg: box(node.querySelector("svg")), legend: box(node.querySelector(".longitudinal-legend")), module: box(node.closest(".longitudinal-test")), dates: [...node.querySelectorAll(".longitudinal-legend span")].map(n => n.textContent) };
      });
      const d = result.fms; assert.equal(d.display, "block"); assert.ok(d.chart.width <= 561); assert.ok(d.chart.height < 440); assert.ok(d.title.height < 28); assert.ok(d.legend.height < 80); assert.ok(d.svg.y >= d.title.bottom); assert.ok(d.legend.y >= d.svg.bottom); assert.ok(d.chart.x > d.module.x); assert.equal(d.dates.length, 4);
      await page.setViewportSize({ width: 1024, height: 1000 }); await page.evaluate(() => RingsideLongitudinalView.layout(document.getElementById("layoutFixture")));
      result.fms1024 = await page.locator("#layoutFixture #detail-fms .longitudinal-chart").evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, titleHeight: node.querySelector(".longitudinal-chart-title").getBoundingClientRect().height, documentWidth: document.documentElement.scrollWidth }));
      assert.ok(result.fms1024.width <= 561); assert.ok(result.fms1024.height < 440); assert.ok(result.fms1024.titleHeight < 28); assert.ok(result.fms1024.documentWidth <= 1026);
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check("FVP and elasticity retain two dates in one row and four dates in two rows", async () => {
      result.analysisGrids = [];
      for (const count of [2, 4]) {
        await page.evaluate(count => renderLayout(count), count);
        const grids = await page.locator("#layoutFixture .longitudinal-analysis-grid").evaluateAll(nodes => nodes.map(grid => ({ columns: getComputedStyle(grid).gridTemplateColumns, items: [...grid.children].map(n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, period: n.dataset.analysisPeriod, kind: n.dataset.analysisKind }; }) })));
        assert.equal(grids.length, 6);
        for (const grid of grids) { assert.equal(grid.items.length, count); assert.equal(grid.items[0].y, grid.items[1].y); assert.ok(grid.items[0].x < grid.items[1].x); if (count === 4) { assert.ok(grid.items[2].y > grid.items[0].y); assert.equal(grid.items[2].y, grid.items[3].y); } }
        result.analysisGrids.push({ count, grids });
      }
    });
    await check("all dated original load values diagnostics scenario interpretations and methods remain complete", async () => {
      const issues = await page.evaluate(() => {
        const issues = [];
        for (const period of layoutModel.periods) {
          const original = document.createElement("div"); original.innerHTML = RingsideReport.renderCapabilityAnalysis(period.report, { print: true });
          for (const [id, attribute, kind] of [["fvp_sj", 'data-fvp-panel="fvp_sj"', "jump-profile"], ["fvp_cmj", 'data-fvp-panel="fvp_cmj"', "jump-profile"], ["fvp_sj", 'data-fvp-elasticity="fvp_sj"', "jump-elasticity"], ["fvp_cmj", 'data-fvp-elasticity="fvp_cmj"', "jump-elasticity"], ["sprint_fvp", "data-sprint-fvp-panel", "sprint-profile"], ["sprint_fvp", "data-sprint-elasticity-panel", "sprint-elasticity"]]) {
            const panel = original.querySelector("[" + attribute + "]"); if (!panel) continue;
            const current = document.querySelector('#layoutFixture #detail-' + id + ' [data-analysis-period="' + period.id + '"][data-analysis-kind="' + kind + '"]');
            if (!current) { issues.push("missing " + id + period.id + kind); continue; }
            const target = current.textContent.replace(/\s+/g, " ");
            for (const node of panel.querySelectorAll("p,summary,td")) {
              if (node.closest(".chart-wrap,[data-raw-trials],.fvp-result-table,.fvp-scenario-table")) continue;
              const text = node.textContent.replace(/\s+/g, " "); if (text && !target.includes(text)) issues.push(id + " " + text);
            }
            for (const row of panel.querySelectorAll(".fvp-scenario-table tbody tr")) if (!target.includes(row.cells[3].textContent.replace(/\s+/g, " "))) issues.push("scenario " + id);
          }
        }
        return issues;
      });
      assert.deepEqual(issues, []);
      await page.locator("#layoutFixture .longitudinal-analysis-grid .fvp-method").evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    });
    await check("assessment color belongs to the short original status label rather than the whole result cell", async () => {
      result.assessments = await page.locator("#layoutFixture .longitudinal-results td[data-assessment-status]").evaluateAll(nodes => nodes.map(node => { const pill = node.querySelector(".longitudinal-assessment"); return { status: node.dataset.assessmentStatus, cellColor: getComputedStyle(node).backgroundColor, pillColor: pill && getComputedStyle(pill).backgroundColor, display: pill && getComputedStyle(pill).display, label: pill?.textContent, reason: node.title }; }));
      assert.ok(result.assessments.length > 50); for (const row of result.assessments) { assert.ok(row.label); assert.ok(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"].includes(row.cellColor)); assert.notEqual(row.pillColor, "rgba(0, 0, 0, 0)"); assert.equal(row.display, "inline-flex"); }
    });
    const shot = async (selector, name) => artifact(name + ".png", await page.locator(selector).screenshot());
    await shot("#layoutFixture #detail-fms", "fms-desktop");
    await shot("#layoutFixture #detail-fvp_sj .longitudinal-analysis-grid >> nth=0", "fvp-desktop");
    await check("narrow containers use one date column without losing content or causing page overflow", async () => {
      await page.setViewportSize({ width: 390, height: 900 }); await page.evaluate(() => RingsideLongitudinalView.layout(document.getElementById("layoutFixture")));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      const grids = await page.locator("#layoutFixture .longitudinal-analysis-grid").evaluateAll(nodes => nodes.map(n => [...n.children].map(c => { const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width }; })));
      for (const grid of grids) { assert.equal(grid.length, 4); assert.equal(grid[0].x, grid[1].x); assert.ok(grid[1].y > grid[0].y); }
      const title = await page.locator("#layoutFixture #detail-fms .longitudinal-chart-title").boundingBox(); assert.ok(title.height < 28);
    });
    await shot("#layoutFixture #detail-fms", "fms-mobile"); await page.setViewportSize({ width: 1440, height: 1000 });
    await check("personal FMS retains its original chart layout and no comparison date grid", async () => {
      const info = await page.evaluate(() => { const host = document.createElement("main"); host.id = "personalFixture"; host.innerHTML = RingsideReport.render(layoutModel.periods[0].report); document.body.append(host); const chart = host.querySelector("#detail-fms .chart-wrap"); const result = { display: getComputedStyle(chart).display, columns: getComputedStyle(chart.closest(".detail-pair")).gridTemplateColumns, grids: host.querySelectorAll(".longitudinal-analysis-grid").length }; host.remove(); return result; });
      assert.equal(info.display, "flex"); assert.equal(info.columns.split(" ").length, 2); assert.equal(info.grids, 0);
    });
    if (!process.argv.includes("--skip-pdf")) await check("actual PDF preserves FMS geometry every date and complete internally paginated analysis content", async () => {
      const data = await page.evaluate(async () => {
        renderLayout(2); const source = document.createElement("section"); source.dataset.longitudinal = "true";
        source.append(document.querySelector("#layoutFixture #detail-fms").cloneNode(true), document.querySelector("#layoutFixture #detail-fvp_sj").cloneNode(true));
        const expected = [...source.querySelectorAll(".longitudinal-analysis-period p,.longitudinal-analysis-period td,.longitudinal-analysis-period dt,.longitudinal-analysis-period dd")].filter(n => !n.closest(".no-print") && n.textContent.trim()).map((node, i) => { node.dataset.layoutContent = String(i); return { id: String(i), text: node.textContent }; });
        document.body.append(source); const before = source.outerHTML, renderer = html2canvas, capture = [];
        const fixtureStyle = [...document.querySelectorAll("style")].find(n => n.textContent.startsWith("body>:not(#layoutFixture)")), css = fixtureStyle.textContent; fixtureStyle.textContent = css.replace(/^body>[^}]+}/, "");
        window.html2canvas = async (node, options) => { const box = node.getBoundingClientRect(); capture.push({ height: box.height, content: [...node.querySelectorAll("[data-layout-content]")].map(n => { const b = n.getBoundingClientRect(); return { id: n.dataset.layoutContent, text: n.textContent, top: b.top - box.top, bottom: b.bottom - box.top }; }), fms: [...node.querySelectorAll(".longitudinal-chart-title")].filter(n => n.textContent.includes("FMS")).map(n => ({ height: n.getBoundingClientRect().height, text: n.textContent })) }); return renderer(node, options); };
        try { const snapshot = { ...layoutModel.periods[1].record, longitudinal: true, longitudinalDateRange: layoutModel.periods[0].date + " — " + layoutModel.periods[1].date }; const blob = await RingsidePDF.build(snapshot, source), bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return { pdf: btoa(binary), expected, capture, diagnostics: RingsidePDF.lastDiagnostics, originalUnchanged: source.outerHTML === before }; } finally { window.html2canvas = renderer; fixtureStyle.textContent = css; source.remove(); }
      });
      assert.equal(data.originalUnchanged, true); assert.equal(data.diagnostics.status, "complete");
      const actual = data.capture.flatMap(p => p.content); assert.ok(data.expected.length > 60);
      assert.deepEqual(actual.map(({ id, text }) => ({ id, text })), data.expected);
      for (const page of data.capture) assert.ok(page.content.every(n => n.top >= 0 && n.bottom <= page.height));
      assert.ok(data.capture.flatMap(p => p.fms).every(n => n.height < 28));
      result.pdfDiagnostics = data.diagnostics; result.pdfCapture = data.capture; result.pdfExpectedContent = data.expected; artifact("layout.pdf", Buffer.from(data.pdf, "base64"));
    });
    await check("layout rendering and export leave all original measurements and definitions unchanged", async () => assert.equal(await page.evaluate(() => JSON.stringify(layoutInput) === layoutBefore), true));
    assert.deepEqual(result.errors, []); result.runnerUnchanged = hash(__filename) === result.runnerSha256; assert.equal(result.runnerUnchanged, true);
    result.sourceUnchanged = hash(source) === result.sourceHash && Object.entries(result.moduleHashes).every(([file, sha]) => hash(path.join(root, file)) === sha); assert.equal(result.sourceUnchanged, true); result.pass = true;
  } catch (error) { result.errors.push(error.stack || String(error)); throw error; }
  finally { fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(`${result.checks.length} longitudinal layout v2244 checks passed (${channel})`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
