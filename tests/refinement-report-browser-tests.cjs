"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html");
const out = path.join(root, "output", "report-refinement"); fs.mkdirSync(out, { recursive: true });
const result = { sourceHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"), cases: [], pass: false };
const cases = [{ id: "mean-percent-partial", partial: true, rows: 5 }, { id: "three-repeats-hiit", points: 4, rows: 8 }, { id: "long-imtp-continuation", points: 24, rows: 38 }]
  .filter(config => !process.argv[2] || config.id === process.argv[2]);
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const config of cases) {
  const check = { ...config, sourceHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"), errors: [], layouts: [], images: [], pass: false };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", offline: true, acceptDownloads: true, reducedMotion: "reduce" });
  const page = await context.newPage(); page.on("pageerror", error => check.errors.push(error.message));
  try {
    await page.goto(pathToFileURL(file).href); await page.evaluate(() => App.ready); await page.evaluate(() => App.loadDemo());
    await page.evaluate(config => {
      const r = App.getState(); r.mode = "mean";
      Object.assign(r.athlete, { name: "报告改版验收运动员", age: 21, sport: "拳击", mass: 72.5, sex: "男" });
      r.enabled = Object.fromEntries(Object.keys(r.enabled).map(id => [id, ["imtp", "mas", "mss", "ift"].includes(id)]));
      r.data.imtp = config.partial ? [
        { id: "partial-a", peakForce: 1000, baselineForce: 100, timePoints: [{ id: "a1", timeMs: 100, force: 500 }, { id: "a2", timeMs: 250, force: 900 }, { id: "a3", timeMs: 200, rfd: 4000 }] },
        { id: "partial-b", peakForce: 3000, timePoints: [{ id: "b1", timeMs: 100, force: 1800 }] },
        { id: "partial-no-pf", timePoints: [{ id: "c1", timeMs: 375, rfd: 4321 }] },
      ] : [0, 1, 2].map(i => ({ id: "review-trial-" + i, peakForce: 2600 + i * 200, baselineForce: 100,
        timePoints: Array.from({ length: config.points }, (_, t) => ({ id: "review-point-" + i + "-" + t, timeMs: (t + 1) * 25,
          force: 500 + t * 65 + i * 35, ...(t % 2 === 0 ? { rfd: 3000 + t * 80 + i * 30 } : {}) })) }));
      r.data.mas = { ...r.data.mas, speed: 4 }; r.data.mss = { ...r.data.mss, speed: 8 };
      r.data.ift = { ...r.data.ift, speed: 5, protocol: "shuttle" };
      delete r.data.mas.trials; delete r.data.mss.trials; delete r.data.ift.trials;
      if (config.partial) {
        const profile = App.getLibrary().evaluationProfiles.find(item => item.id === r.evaluationProfileId);
        profile.criteria.imtpTimeStandards = [{ timeMs: 250, kind: "force_pct_peak", context: RingsideEvaluation.imtpTimeContext(r), target: 90,
          ranges: Def.parseRanges("<90 | 待提升 | red\n>=90 | 优秀 | green"), direction: "higher", referenceEnabled: true, source: "自定义验收标准" }];
      }
      App.showReport(); App.renderReport();
    }, config);
    assert.equal(await page.locator("#microCards > article").count(), 4);
    assert.equal(await page.locator("#microCards > article").first().locator("h3").innerText(), "运动员信息");
    assert.match(await page.locator("#microCards > article").first().innerText(), /拳击[\s\S]*21 岁[\s\S]*72.5 kg/);
    assert.equal(await page.locator("#detail-imtp .detail-data table").count(), 1);
    assert.equal(await page.locator(".imtp-results tbody tr").count(), config.rows);
    if (config.partial) {
      assert.equal(Number(await page.locator('[data-force-time="100"]').getAttribute("data-force-percent")), 55);
      assert.equal(Number(await page.locator('[data-force-time="250"]').getAttribute("data-force-percent")), 90);
      assert.equal(await page.locator('.imtp-results [data-metric-id="imtp_f200"]').count(), 0);
      assert.equal(await page.locator('.imtp-results [data-metric-id="imtp_rfd375"]').count(), 0);
      assert.match(await page.locator('#trials-imtp').textContent(), /4,321/);
      assert.match(await page.locator('.imtp-results [data-metric-id="imtp_f250"]').innerText(), /90.0%[\s\S]*优秀[\s\S]*90.00 %/);
    }
    assert.doesNotMatch(await page.locator(".imtp-results").innerText(), /\bn=\d/);
    const rowIds = await page.locator(".imtp-results tbody tr").evaluateAll(rows => rows.map(row => row.dataset.metricId));
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(250);
      const geometry = await page.evaluate(() => {
        const table = document.querySelector(".imtp-results").getBoundingClientRect();
        return { width: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          tableLeft: table.left, tableRight: table.right, firstCard: document.querySelector("#microCards > article").getBoundingClientRect().height };
      });
      assert.equal(geometry.pageOverflow, false, JSON.stringify(geometry));
      assert.ok(geometry.tableRight <= width + 1 && geometry.tableLeft >= -1, JSON.stringify(geometry));
      check.layouts.push(geometry);
      for (const [selector, label] of [["#microCards", "summary"], [".speed-training", "hiit"], ...(width === 1440 ? [["#detail-imtp .detail-pair", "imtp"]] : [])]) {
        const image = path.join(out, config.id + "-" + label + "-" + width + ".png");
        await page.locator(selector).screenshot({ path: image });
        check.images.push({ path: path.relative(root, image), sha256: createHash("sha256").update(fs.readFileSync(image)).digest("hex") });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      window.__refinementPages = [];
      const render = window.html2canvas;
      window.html2canvas = async (node, options) => {
        const body = node.querySelector(".ringside-pdf-content"), rect = body.getBoundingClientRect();
        __refinementPages.push({ text: node.innerText,
          rows: [...node.querySelectorAll(".imtp-results tbody tr")].map(row => row.dataset.metricId),
          headers: [...node.querySelectorAll(".imtp-results thead")].map(head => head.innerText),
          overflow: [...body.children].filter(child => child.getBoundingClientRect().bottom > rect.bottom + 1).map(child => child.className) });
        return render(node, options);
      };
    });
    const before = await page.evaluate(() => JSON.stringify(App.getState()));
    await page.locator("#reportExportMenu > summary").click();
    const pending = Promise.race([
      page.waitForEvent("download", { timeout: 180000 }),
      page.waitForFunction(() => RingsidePDF.lastDiagnostics?.status === "failed", null, { timeout: 180000 })
        .then(async () => { throw Error("PDF export failed: " + await page.evaluate(() => JSON.stringify(RingsidePDF.lastDiagnostics))); }),
    ]);
    await page.locator("#reportActions [data-pdf-action]").click();
    const download = await pending, pdfPath = path.join(out, config.id + ".pdf"); await download.saveAs(pdfPath);
    await page.waitForFunction(() => !document.querySelector("#reportActions [data-pdf-action]").disabled);
    const exported = await page.evaluate(() => ({ data: JSON.stringify(App.getState()), pages: __refinementPages, diagnostics: RingsidePDF.lastDiagnostics }));
    assert.equal(exported.data, before); assert.equal(exported.diagnostics.status, "complete");
    for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(exported.diagnostics[key], []);
    assert.deepEqual(exported.pages.flatMap(item => item.rows), rowIds);
    if (config.partial) assert.match(exported.pages.map(item => item.text).join("\n"), /250 ms 力[\s\S]*90.0%[\s\S]*优秀[\s\S]*90.00 %/);
    if (config.points === 24) assert.ok(exported.pages.filter(item => item.rows.length).length >= 2);
    assert.ok(exported.pages.every(item => item.overflow.length === 0));
    assert.ok(exported.pages.every(item => !/[尚暂]无筛查结果/.test(item.text)), "empty screening details must not occupy PDF pages");
    assert.match(await page.locator("#screenDetail").textContent(), /尚无筛查结果/);
    assert.ok(exported.pages.filter(item => item.rows.length).every(item => item.headers.every(text => text.includes("指标") && (config.partial || text.includes("均值 ± SD")))));
    assert.deepEqual(check.errors, []);
    const prefix = path.join(out, config.id + "-pdf-page");
    const rendered = spawnSync("pdftoppm", ["-scale-to", "1400", "-png", pdfPath, prefix], { encoding: "utf8", windowsHide: true });
    assert.equal(rendered.status, 0, rendered.error?.message || rendered.stderr);
    const renderedPages = Array.from({ length: exported.pages.length }, (_, index) => path.basename(prefix) + "-" + String(index + 1).padStart(String(exported.pages.length).length, "0") + ".png")
      .map(name => ({ path: path.relative(root, path.join(out, name)), sha256: createHash("sha256").update(fs.readFileSync(path.join(out, name))).digest("hex") }));
    Object.assign(check, { pass: true, pdfHash: createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex"), pages: exported.pages, diagnostics: exported.diagnostics, renderedPages });
    console.log("PASS " + config.id + " layouts and actual PDF download: " + exported.pages.length + " pages");
  } catch (error) { check.failure = error.stack; check.failedDiagnostics = await page.evaluate(() => window.RingsidePDF?.lastDiagnostics).catch(() => null); process.exitCode = 1; console.error(error.stack); }
  finally { result.cases.push(check); fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify(result, null, 2)); await context.close(); }
  }
  result.pass = result.cases.length === cases.length && result.cases.every(check => check.pass);
  fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify(result, null, 2));
  await browser.close();
})();
