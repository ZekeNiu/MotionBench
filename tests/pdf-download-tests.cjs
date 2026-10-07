"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { chromium } = require("./helpers/playwright.cjs");
const { extensionFixture } = require("./helpers/core-fixtures.cjs");
const { radarFixture } = require("./helpers/radar-fixtures.cjs");
const { chartFixture } = require("./helpers/chart-ai-fixture.cjs");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "output/pdf");
fs.mkdirSync(out, { recursive: true });
const results = {
  started: new Date().toISOString(),
  sourceHash: createHash("sha256")
    .update(fs.readFileSync(path.join(root, "Ringside_Boxing_Assessment.html")))
    .digest("hex"),
  cases: [],
};
const cases = [
  { id: "chrome-chart-percent", channel: "chrome", width: 1440, chartAxis: "percent" },
  { id: "chrome-chart-force", channel: "chrome", width: 390, chartAxis: "force" },
  { id: "chrome-sample", channel: "chrome", width: 1440 },
  { id: "edge-sample", channel: "msedge", width: 1280 },
  { id: "chrome-mobile", channel: "chrome", width: 390 },
  { id: "chrome-empty", channel: "chrome", width: 1440, empty: true },
  { id: "chrome-stress", channel: "chrome", width: 1440, stress: true },
  { id: "chrome-core", channel: "chrome", width: 390, core: true },
  { id: "chrome-radar", channel: "chrome", width: 390, radar: true },
  { id: "chrome-speed-partial", channel: "chrome", width: 390, partialSpeed: true },
  { id: "chrome-speed-complete", channel: "chrome", width: 1440, speedReference: true },
  { id: "chrome-speed-continuation", channel: "chrome", width: 390, speedReference: true, speedContinuation: true },
];
const only = (process.argv.find((value) => value.startsWith("--only=")) || "")
  .slice(7)
  .split(",")
  .filter(Boolean);
(async () => {
  for (const config of cases.filter(
    (config) => !only.length || only.includes(config.id),
  )) {
    const browser = await chromium.launch({
      channel: config.channel,
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: config.width, height: 1000 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      offline: true,
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [],
      network = [];
    // Match the before/after design fixtures and make cross-browser dates stable.
    await page.clock.setFixedTime(new Date("2026-10-06T15:43:00Z"));
    if (config.core || config.radar)
      await page.addInitScript(
        (record) =>
          localStorage.setItem(
            "ringside-library-v2:" + location.pathname,
            JSON.stringify(record),
          ),
        config.radar ? radarFixture() : extensionFixture({ pdf: true }),
      );
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url())) network.push(r.url());
    });
    const started = Date.now();
    const sourceHash = createHash("sha256")
      .update(
        fs.readFileSync(path.join(root, "Ringside_Boxing_Assessment.html")),
      )
      .digest("hex");
    try {
      await page.goto(
        pathToFileURL(path.join(root, "Ringside_Boxing_Assessment.html")).href,
      );
      await page.waitForFunction(() => window.App?.downloadPDF);
      await page.evaluate(() => {
        const original = RingsideReport.layoutCharts;
        window.__printFigures = [];
        RingsideReport.layoutCharts = (container, opts) => {
          original(container, opts);
          if (opts?.print) window.__printFigures = [...container.querySelectorAll("[data-chart-kind]")].map(node => {
            const svg = node.querySelector("svg"), vb = svg.viewBox.baseVal;
            return { kind: node.dataset.chartKind, viewBox: svg.getAttribute("viewBox"), text: svg.textContent,
              outside: [...svg.querySelectorAll("text")].filter(t => { const b=t.getBBox();return b.x<-.5||b.y<-.5||b.x+b.width>vb.width+.5||b.y+b.height>vb.height+.5; }).map(t=>t.textContent) };
          });
        };
      });
      if (config.chartAxis) {
        await page.evaluate(chartFixture);
        const narrative = fs.readFileSync(path.join(root, "output/ai/chart-ai/boxing-complete.md"), "utf8");
        await page.evaluate(({axis, narrative}) => {
          const r = App.getState();r.views.imtp.yAxis = axis;
          r.narrative = { text:narrative, html:RingsideModel.textToHTML(narrative), revision:1, origin:"AI", basis:RingsideModel.fingerprint(r) };
          App.renderReport();
        }, {axis:config.chartAxis, narrative});
      }
      if (config.empty)
        await page.evaluate(() => {
          App.createAthlete("PDF空白验收");
          App.showReport();
        });
      if (config.partialSpeed)
        await page.evaluate(() => {
          const r = App.getState();
          r.data.mas.speed = "";
          r.data.mss.speed = "";
          Object.assign(r.data.ift, { speed: 6, protocol: "shuttle", partial: 12.5 });
          const ir = r.data.iso.find(x => x.region === "shoulder" && x.directionCode === "internalRotation"),
            er = r.data.iso.find(x => x.region === "shoulder" && x.directionCode === "externalRotation");
          Object.assign(ir, { left: 200, right: "", target: "", painRight: true });
          Object.assign(er, { left: 100, right: "", target: 150 });
          App.renderReport();
          if (document.querySelectorAll('[data-speed-metric]').length !== 1 ||
              !document.querySelector('[data-speed-metric="ift"]') || document.querySelector('[data-speed-asr]'))
            throw Error("Partial speed report must contain VIFT only, without ASR");
        });
      if (config.speedReference)
        await page.evaluate((continuation) => {
          const r = App.getState();
          r.data.mas.speed = 4; r.data.mss.speed = 8;
          Object.assign(r.data.ift, { speed: 5, protocol: "shuttle", partial: 12.5 });
          for (const [id, target] of [["mas_speed", 4], ["mss_speed", 8]])
            Object.assign(r.definitions.find(d => d.id === id), { target, referenceEnabled: true });
          if (continuation) {
            for (const id of Object.keys(r.enabled)) r.enabled[id] = ["mas", "mss", "ift"].includes(id);
            r.athlete.name = "速度参考分页压力验收";
          }
          App.renderReport();
          if (continuation) {
            // The button refreshes the report before exporting. Add the synthetic
            // stress text to its fresh clone, then run the unchanged PDF builder.
            const build = RingsidePDF.build;
            RingsidePDF.build = (record, source, options) => {
              for (const cell of source.querySelectorAll('.speed-reference-table tbody td[data-label="训练速度"]')) {
                const note = document.createElement('span');
                note.textContent = '【分页验收合成说明】检查长表续页时，五种形式、强度基准、个人速度和表头仍然完整。'.repeat(8);
                cell.append(note);
              }
              return build(record, source, options);
            };
          }
        }, !!config.speedContinuation);
      if (config.stress)
        await page.evaluate(() => {
          const r = App.getState();
          r.athlete.name = "PDF压力验收";
          r.data.imtp = [
            {
              id: "qa-force",
              peakForce: 2800,
              baselineForce: 100,
              peakTimeMs: 450,
              timePoints: [
                { id: "q100", timeMs: 100, force: 800, rfd: 7000 },
                { id: "q200", timeMs: 200, force: "", rfd: 8500 },
                { id: "q300", timeMs: 300, force: 2300, rfd: "" },
              ],
              f100: 800,
              f200: "",
              rfd100: 7000,
              rfd200: 8500,
            },
          ];
          const isoTemplate = r.data.iso.find(
            (x) => x.region === "shoulder" && x.paired,
          );
          r.data.iso = Array.from({ length: 30 }, (_, i) => ({
            ...isoTemplate,
            id: "qa-iso-" + i,
            direction: "压力测试方向" + (i + 1),
            left: 160 + i * 2,
            right: 200 + i * 2,
          }));
          r.balancePairs = [];
          r.data.lactate = Array.from({ length: 45 }, (_, i) => ({
            id: "qa-lac-" + i,
            speed: 2 + i * 0.07,
            lactate: 1 + i * 0.16,
            hr: 130 + i,
          }));
          r.lvp.landmineR.mvt = 0.5;
          r.lvp.landmineL.mvt = 0.5;
          r.views.lvpUpper.selected = ["bench", "landmineR", "landmineL"];
          r.views.lvpUpper.selectionExplicit = true;
          const M = RingsideModel;
          const text = [
            "【主要发现】",
            "压力验收的离散力值和平均RFD仅用于测试图表，不构成真实运动员数据。",
            "【训练优先级】",
            ...Array.from(
              { length: 38 },
              (_, i) =>
                "第" +
                (i + 1) +
                "段：在对应动作中保持稳定站架、骨盆与躯干控制，先完成规定动作幅度，再逐步提高输出。侧别、单位与原始结果保持一致。".repeat(
                  3,
                ),
            ),
            "【执行建议】",
            "最终段落必须出现在完整报告中。",
          ].join("\n\n");
          r.narrative = {
            html: M.textToHTML(text),
            text,
            updated: new Date().toISOString(),
            basis: M.fingerprint(r),
            origin: "manual",
            revision: 1,
          };
          App.renderReport();
        });
      await page.evaluate(() => {
        document.querySelector("#performanceDetail").open = false;
        window.scrollTo({ top: 350, behavior: "instant" });
        const draw = window.html2canvas;
        window.__pdfLayouts = [];
        window.__pdfAsymRaster = [];
        window.__pdfSpeedRaster = [];
        window.__pdfPainLabels = [];
        window.html2canvas = async (node, options) => {
          for (const cell of node.querySelectorAll('.fms-detail tbody td:nth-child(3)')) {
            if (cell.textContent.trim() !== '疼痛') continue;
            const label = cell.querySelector('span') || cell;
            const lines = new Set();
            for (const text of label.childNodes) {
              if (text.nodeType !== Node.TEXT_NODE || !text.textContent.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(text);
              for (const rect of range.getClientRects()) lines.add(Math.round(rect.top));
            }
            if (lines.size !== 1) throw Error('PDF FMS pain badge must stay on one line');
            window.__pdfPainLabels.push({ text: label.textContent, lines: lines.size });
          }
          window.__pdfLayouts.push({
            hasScreening: !!node.querySelector(".body-art"),
            bodyImages: [...node.querySelectorAll(".body-art img")].map(
              (image) => ({
                width: image.width,
                height: image.height,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                objectFit: getComputedStyle(image).objectFit,
              }),
            ),
          });
          const canvas = await draw(node, options), frame = node.getBoundingClientRect();
          for (const table of node.querySelectorAll('.speed-reference-table')) {
            if (getComputedStyle(table).display !== 'table' || !table.tHead || getComputedStyle(table.tHead).display === 'none')
              throw Error('PDF speed reference must have a visible table header');
            for (const label of table.querySelectorAll('th,.speed-personal strong')) {
              const bounds = label.getBoundingClientRect(), scale = canvas.width / frame.width,
                x = Math.max(0, Math.floor((bounds.left - frame.left) * scale)),
                y = Math.max(0, Math.floor((bounds.top - frame.top) * scale)),
                width = Math.min(canvas.width - x, Math.ceil(bounds.width * scale)),
                height = Math.min(canvas.height - y, Math.ceil(bounds.height * scale));
              if (width <= 0 || height <= 0) throw Error('PDF speed text has no visible bounds');
              const pixels = canvas.getContext('2d').getImageData(x, y, width, height).data;
              let ink = 0;
              for (let i=0;i<pixels.length;i+=4) if(pixels[i+3]>128 && Math.min(pixels[i],pixels[i+1],pixels[i+2])<180) ink++;
              if (ink < 8) throw Error('PDF speed label rendered blank: ' + label.textContent);
              window.__pdfSpeedRaster.push({ text: label.textContent, ink, header: label.tagName === 'TH', page: window.__pdfLayouts.length });
            }
          }
          for (const label of node.querySelectorAll('.asym-value,.asym-side')) {
            const bounds = label.getBoundingClientRect(), scale = canvas.width / frame.width,
              x = Math.max(0, Math.floor((bounds.left - frame.left) * scale)),
              y = Math.max(0, Math.floor((bounds.top - frame.top) * scale)),
              width = Math.min(canvas.width - x, Math.ceil(bounds.width * scale)),
              height = Math.min(canvas.height - y, Math.ceil(bounds.height * scale));
            if (width <= 0 || height <= 0) throw Error('PDF difference label has no visible bounds: ' + label.textContent);
            const pixels = canvas.getContext('2d').getImageData(x, y, width, height).data;
            let ink = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i + 3] > 128 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 180) ink++;
            window.__pdfAsymRaster.push({ text: label.textContent, ink });
            if (ink < 8) throw Error('PDF difference label rendered blank: ' + label.textContent);
          }
          return canvas;
        };
      });
      await page.waitForTimeout(220);
      const before = await page.evaluate(() => ({
        id: App.getState().recordId,
        open: document.querySelector("#performanceDetail").open,
        scroll: scrollY,
        narrative: App.getState().narrative.html,
      }));
      const downloading = Promise.race([
        page.waitForEvent("download", { timeout: 180000 }),
        page
          .waitForFunction(
            () => RingsidePDF.lastDiagnostics?.status === "failed",
            null,
            { timeout: 180000 },
          )
          .then(async () => {
            throw Error(
              (await page.evaluate(() => RingsidePDF.lastDiagnostics)).error,
            );
          }),
      ]);
      if (!(await page.locator("#saveModal").isVisible())) {
        if (await page.locator("#sidebar").evaluate((el) => el.inert))
          await page.locator("#sidebarToggle").click();
        await page
          .locator('#sidebar button[onclick="App.saveMenu()"] ')
          .click();
      }
      await page.locator("#pdfButton").click();
      const file = await downloading,
        destination = path.join(out, config.id + ".pdf");
      await file.saveAs(destination);
      await page.waitForFunction(
        () => !document.querySelector("#pdfButton").disabled,
      );
      const header = fs
        .readFileSync(destination)
        .subarray(0, 5)
        .toString("ascii");
      assert.equal(header, "%PDF-");
      const after = await page.evaluate(() => ({
        id: App.getState().recordId,
        open: document.querySelector("#performanceDetail").open,
        scroll: scrollY,
        narrative: App.getState().narrative.html,
        stages: document.querySelectorAll(".ringside-pdf-stage").length,
        diagnostics: RingsidePDF.lastDiagnostics,
        layouts: window.__pdfLayouts,
      }));
      assert.equal(after.id, before.id);
      assert.equal(after.open, before.open);
      assert.equal(after.narrative, before.narrative);
      assert.ok(Math.abs(after.scroll - before.scroll) < 4);
      assert.equal(after.stages, 0);
      assert.equal(errors.length, 0);
      assert.equal(network.length, 0);
      assert.equal(after.diagnostics.status, "complete");
      assert.equal(after.diagnostics.missingRows.length, 0);
      assert.equal(after.diagnostics.duplicateRows.length, 0);
      assert.equal(after.diagnostics.changedRows.length, 0);
      assert.equal(after.diagnostics.missingCharts.length, 0);
      assert.equal(after.diagnostics.duplicateCharts.length, 0);
      assert.ok(
        after.layouts
          .flatMap((page) => page.bodyImages)
          .every(
            (image) =>
              Math.abs(
                image.width / image.height -
                  image.naturalWidth / image.naturalHeight,
              ) < 0.01,
          ),
        "Screening image must preserve its aspect ratio when the summary splits",
      );
      if (config.core)
        assert.equal(
          after.layouts[0].hasScreening,
          true,
          "Large ability lists must not strand the screening card on an avoidable separate page",
        );
      const speedRaster = await page.evaluate(() => window.__pdfSpeedRaster);
      if (config.speedReference || config.partialSpeed) assert.ok(speedRaster.length > 5, 'Missing visible speed reference content');
      if (config.speedContinuation) assert.ok(new Set(speedRaster.filter(x => x.header).map(x => x.page)).size >= 2, 'Stress table must repeat its header across pages');
      const printFigures = await page.evaluate(() => window.__printFigures);
      assert.ok(printFigures.every(f => !f.outside.length), "PDF chart labels must fit: " + JSON.stringify(printFigures.filter(f => f.outside.length)));
      if (config.chartAxis) {
        assert.ok(printFigures.find(f=>f.kind==="forceTime").text.includes(config.chartAxis==="percent" ? "占峰值力 / %" : "力 / N"));
        assert.ok(!printFigures.some(f=>/未启用评价标准|未设等级区间/.test(f.text)));
      }
      results.cases.push({
        id: config.id,
        sourceHash,
        printFigures,
        chartAxis: config.chartAxis || null,
        pass: true,
        file: destination,
        filename: file.suggestedFilename(),
        bytes: fs.statSync(destination).size,
        elapsedMs: Date.now() - started,
        browser: browser.version(),
        network,
        errors,
        diagnostics: after.diagnostics,
        layouts: after.layouts,
        asymmetryRaster: await page.evaluate(() => window.__pdfAsymRaster),
        speedReferenceRaster: speedRaster,
        fmsPainLabels: await page.evaluate(() => window.__pdfPainLabels),
        syntheticSpeedContinuation: !!config.speedContinuation,
      });
      console.log(
        "PASS " + config.id + " " + fs.statSync(destination).size + " bytes",
      );
    } catch (error) {
      const failure = await page
        .evaluate(() => ({
          diagnostics: RingsidePDF.lastDiagnostics,
          toast: document.querySelector("#toast")?.textContent,
        }))
        .catch(() => null);
      results.cases.push({
        id: config.id,
        sourceHash,
        pass: false,
        error: error.stack,
        failure,
        errors,
        network,
      });
      console.log("FAIL " + config.id + " " + error.message);
    } finally {
      await context.close();
      await browser.close();
      fs.writeFileSync(
        path.join(out, "download-verification.json"),
        JSON.stringify(results, null, 2),
      );
    }
  }
  results.finished = new Date().toISOString();
  results.consistentSourceHash = results.cases.every(
    (item) => item.sourceHash === results.sourceHash,
  );
  fs.writeFileSync(
    path.join(out, "download-verification.json"),
    JSON.stringify(results, null, 2),
  );
  if (results.cases.some((x) => !x.pass)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
