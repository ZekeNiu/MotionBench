"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { spawnSync } = require("node:child_process");
const { chromium } = require("./helpers/playwright.cjs");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome", uiOnly = process.argv.includes("--ui-only");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html"), out = path.join(root, "output", channel === "msedge" ? "report-v210-edge" : "report-v210");
fs.mkdirSync(out, { recursive: true });
const hash = filename => createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
const envelope = JSON.parse(fs.readFileSync(path.join(root, "examples", "three-trials.json"))), fixture = envelope.record || envelope;
const result = { sourceHash: hash(file), channel, uiOnly, checks: [], pdfs: [], images: [], errors: [], pass: false };
let browser, context, page;
async function sample(count = 3, rows = 13, pdf = false) {
  await page.evaluate(({ fixture, count, rows, pdf }) => {
    const r = App.getState(), recordId = r.recordId, athleteId = r.athleteId, evaluationProfileId = r.evaluationProfileId;
    Object.assign(r, RingsideModel.sampleRecord(), { recordId, athleteId, evaluationProfileId });
    r.projectSnapshots = RingsideTests.snapshots(RingsideModel.defaults());
    r.data = JSON.parse(JSON.stringify(fixture.data)); r.balancePairs = JSON.parse(JSON.stringify(fixture.balancePairs));
    r.mode = "mean"; r.narrative.text = "";
    r.data.iso = r.data.iso.filter(x => x.trials?.length).slice(0, rows);
    r.data.iso.forEach(x => { x.trials = x.trials.slice(0, count); });
    r.data.imtp = r.data.imtp.slice(0, 1);
    Object.assign(r.data.mas, { speed: 4, unit: "m/s" }); Object.assign(r.data.mss, { speed: 8, unit: "m/s" });
    Object.assign(r.data.ift, { speed: 5, unit: "m/s", protocol: "treadmill", method: "本次自由填写的方法" });
    delete r.data.mas.trials; delete r.data.mss.trials; delete r.data.ift.trials;
    if (pdf) r.enabled = Object.fromEntries(Object.keys(r.enabled).map(id => [id, ["iso", "mas", "mss", "ift"].includes(id)]));
    App.showReport(); App.renderReport();
  }, { fixture, count, rows, pdf });
  await page.waitForTimeout(120);
}
async function check(id, fn) {
  try { const detail = await fn(); result.checks.push({ id, pass: true, detail }); console.log("PASS " + id); }
  catch (error) { result.checks.push({ id, pass: false, error: error.stack }); console.error("FAIL " + id + ": " + error.stack); }
}
async function image(selector, id) {
  const filename = path.join(out, id + ".png"); await page.locator(selector).screenshot({ path: filename });
  result.images.push({ path: path.relative(root, filename), sha256: hash(filename) });
}
async function download(action, id, extension) {
  await page.locator("#reportExportMenu > summary").click();
  const pending = page.waitForEvent("download", { timeout: 180000 });
  await page.locator(`#reportActions button[onclick="App.${action}()"]`).click();
  const item = await pending, filename = path.join(out, id + "." + extension); await item.saveAs(filename); return filename;
}
(async () => {
  browser = await chromium.launch({ channel, headless: true });
  context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  page = await context.newPage(); page.on("pageerror", error => result.errors.push(error.message));
  await page.goto(pathToFileURL(file).href); await page.evaluate(() => App.ready); await page.evaluate(() => App.importPayload(RingsideModel.recordEnvelope(RingsideModel.sampleRecord())));

  await check("desktop-repeat-tables-share-column-edges-and-mobile-remains-contained", async () => {
    const layouts = [];
    for (const count of [1, 3]) {
      await sample(count);
      for (const width of [1920, 1440, 1366, 1280, 1100, 1024, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(150);
        const layout = await page.evaluate(() => {
          const box = n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
          const pair = document.querySelector("#detail-iso .detail-pair"), table = pair.querySelector("table"), chart = pair.querySelector(".chart-wrap");
          const brokenNumbers = [], walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) for (const match of walker.currentNode.textContent.matchAll(/\d[\d,.]*%?/g)) {
            const range = document.createRange(); range.setStart(walker.currentNode, match.index); range.setEnd(walker.currentNode, match.index + match[0].length);
            if (range.getClientRects().length > 1) brokenNumbers.push(match[0]);
          }
          return { width: innerWidth, table: box(table), chart: box(chart), pair: box(pair), pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            localScroll: table.parentElement.scrollWidth > table.parentElement.clientWidth + 1, brokenNumbers,
            peers: [...document.querySelectorAll("#detail-fms .detail-pair table,#detail-cmj .detail-pair table,#detail-imtp .detail-pair table")].map(box) };
        });
        assert.equal(layout.pageOverflow, false); assert.equal(layout.localScroll, false); assert.deepEqual(layout.brokenNumbers, []);
        assert.ok(layout.peers.length >= 2);
        if (width > 600) {
          assert.ok(layout.chart.x + layout.chart.width <= layout.table.x + 1);
          assert.ok(Math.abs(layout.table.y - layout.chart.y) < 1);
          assert.ok(layout.peers.every(p => Math.abs(p.x - layout.table.x) < 1 && Math.abs(p.width - layout.table.width) < 1));
        } else assert.ok(layout.table.y >= layout.chart.y + layout.chart.height);
        layouts.push({ count, ...layout });
        if (count === 3 && [1440, 1024, 390].includes(width)) await image("#detail-iso .detail-pair", "iso-" + width);
      }
    }
    return layouts;
  });

  await check("body-size-status-color-and-rich-tooltip-keyboard-and-real-touch", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await sample();
    const initial = await page.evaluate(() => {
      const body = document.querySelector(".body-art svg"), neck = body.querySelector('[data-region="neck"] .viz-hotspot'), amber = document.querySelector(".micro-value.amber");
      return { height: body.getBoundingClientRect().height, radius: Number(neck.getAttribute("r")),
        markers: body.querySelectorAll("[data-body-detail]").length, nativeTitles: body.querySelectorAll(".viz-region title").length,
        amber: getComputedStyle(amber).color, unit: getComputedStyle(amber.querySelector("small")).color,
        greenLabels: [...body.querySelectorAll('[data-body-detail]')].filter(n => JSON.parse(n.dataset.bodyDetail).status === "green").map(n => n.getAttribute("aria-label")) };
    });
    assert.equal(initial.height, 390); assert.equal(initial.radius, 24); assert.equal(initial.markers, 9); assert.equal(initial.nativeTitles, 0);
    assert.equal(initial.amber, initial.unit); assert.ok(initial.greenLabels.every(text => text.includes("优秀")));
    await image(".summary-grid", "summary-1440");
    const region = page.locator('[data-body-detail][data-region="neck"]');
    await region.evaluate(node => { const item = JSON.parse(node.dataset.bodyDetail); item.tests = Array.from({ length: 28 }, (_, i) => ({ name: "完整测试条目" + i, side: "C", value: i, unit: "N", target: 30, label: "关注", notes: i === 27 ? "最后条目完整保留" : "" })); node.dataset.bodyDetail = JSON.stringify(item); });
    await region.scrollIntoViewIfNeeded(); await region.hover();
    await page.waitForFunction(() => !document.querySelector("#bodyRegionTooltip").hidden);
    await page.locator("#bodyRegionTooltip").hover(); await page.waitForTimeout(250);
    assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), true);
    await page.mouse.move(0, 0); await page.waitForFunction(() => document.querySelector("#bodyRegionTooltip").hidden);
    await region.focus(); await page.waitForFunction(() => !document.querySelector("#bodyRegionTooltip").hidden);
    assert.equal(await page.locator("#bodyRegionTooltip li").count(), 28);
    await page.keyboard.press("Enter"); assert.equal(await page.locator("#bodyRegionTooltip").evaluate(n => document.activeElement === n), true);
    await page.keyboard.press("End");
    await page.waitForFunction(() => document.querySelector("#bodyRegionTooltip").scrollTop > 0);
    assert.match(await page.locator("#bodyRegionTooltip").innerText(), /最后条目完整保留/);
    await page.keyboard.press("Escape"); assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), false);
    assert.equal(await region.evaluate(n => document.activeElement === n), true);
    const bounds = [];
    for (const viewport of [{ width: 1440, height: 380 }, { width: 390, height: 500 }]) {
      await page.setViewportSize(viewport); await region.scrollIntoViewIfNeeded(); await region.click();
      assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), true);
      const b = await page.locator("#bodyRegionTooltip").boundingBox();
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width + 1 && b.y + b.height <= viewport.height + 1);
      bounds.push({ viewport, ...b }); await image("#bodyRegionTooltip", "body-popover-" + viewport.width);
      await region.click(); assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), false);
    }
    const mobile = await browser.newContext({ offline: true, isMobile: true, hasTouch: true, viewport: { width: 390, height: 500 } });
    try {
      const touchPage = await mobile.newPage(); await touchPage.goto(pathToFileURL(file).href); await touchPage.evaluate(() => App.ready); await touchPage.evaluate(() => App.importPayload(RingsideModel.recordEnvelope(RingsideModel.sampleRecord())));
      const target = touchPage.locator('[data-body-detail][data-region="neck"]'); await target.scrollIntoViewIfNeeded();
      await target.tap(); assert.equal(await touchPage.locator("#bodyRegionTooltip").isVisible(), true);
      await target.tap(); assert.equal(await touchPage.locator("#bodyRegionTooltip").isVisible(), false);
    } finally { await mobile.close(); }
    return { initial, bounds, realTouchTap: true };
  });

  await check("VIFT-free-method-real-entry-reload-JSON-and-independent-HTML", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); const exports = [];
    for (const protocol of ["shuttle", "treadmill"]) {
      await sample(); await page.evaluate(protocol => { App.getState().data.ift.protocol = protocol; App.getState().data.ift.method = ""; App.renderReport(); }, protocol);
      assert.equal(await page.locator('.speed-training [data-speed-basis="vift"]').count(), 5);
      assert.doesNotMatch(await page.locator(".speed-detail").innerText(), /折返版|跑台改良版/);
      await page.locator("#editButton").click(); await page.locator('#entryNav button[onclick*="\'ift\'"]').click();
      const method = "手工测试方法 / " + protocol;
      await page.locator('[data-path="data.ift.method"]').fill(method); await page.locator('[data-path="data.ift.method"]').blur();
      assert.equal(await page.evaluate(() => App.saveNow()), true); await page.evaluate(() => App.showReport(false));
      await page.reload(); await page.evaluate(() => App.ready); await page.evaluate(() => App.showReport());
      assert.equal(await page.evaluate(() => App.getState().data.ift.method), method);
      assert.match(await page.locator('[data-row-id="hiit-long"]').innerText(), /4\.00–4\.50 m\/s/);
      const json = await download("downloadJSON", "vift-" + protocol, "json"), html = await download("downloadHTML", "vift-" + protocol, "html");
      const payload = JSON.parse(fs.readFileSync(json)); assert.equal(payload.record.data.ift.method, method); assert.equal(payload.record.data.ift.protocol, protocol);
      const isolated = await browser.newContext({ offline: true }), p = await isolated.newPage();
      await p.goto(pathToFileURL(html).href); await p.evaluate(() => App.ready); await p.evaluate(() => App.showReport());
      assert.equal(await p.evaluate(() => App.getState().data.ift.method), method);
      assert.equal(await p.locator('.speed-training [data-speed-basis="vift"]').count(), 5);
      assert.match(await p.locator(".speed-detail").innerText(), new RegExp(method)); await isolated.close();
      exports.push({ protocol, json: path.relative(root, json), jsonHash: hash(json), html: path.relative(root, html), htmlHash: hash(html) });
    }
    return exports;
  });

  await check("captured-project-display-names-reach-report-headings-and-speed-chart", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await sample();
    const snapshot = await page.evaluate(() => {
      const r = App.getState(), values = JSON.stringify(RingsideModel.stats(r).values);
      r.projectSnapshots = RingsideTests.snapshots(r).map(test => ({ ...test, name: "自定展示名称_" + test.id }));
      App.renderReport();
      return { values, after: JSON.stringify(RingsideModel.stats(r).values) };
    });
    assert.equal(snapshot.values, snapshot.after);
    for (const id of ["fms", "iso", "imtp"]) assert.equal(await page.locator(`#detail-${id} .test-title h3`).textContent(), "自定展示名称_" + id);
    for (const id of ["mas", "mss", "ift"]) assert.match(await page.locator(`[data-speed-metric="${id}"]`).getAttribute("data-tooltip"), new RegExp("自定展示名称_" + id));
    assert.ok(await page.locator(".speed-reference-table th").filter({ hasText: "做功∶休息示例" }).count());
    await image(".speed-detail", "renamed-speed-projects");
    return snapshot;
  });

  for (const config of uiOnly ? [] : [{ id: "short-single", count: 1, rows: 4, mode: "side-by-side" }, { id: "short-repeated", count: 3, rows: 4, mode: "side-by-side" }, { id: "long-repeated", count: 3, rows: 13, mode: "stacked" }]) {
    await check("actual-PDF-" + config.id, async () => {
      await page.setViewportSize({ width: 1440, height: 1000 }); await sample(config.count, config.rows, true);
      const rows = await page.locator(".iso-results tbody tr").evaluateAll(nodes => nodes.map(n => n.dataset.rowId));
      await page.evaluate(() => {
        window.__v210Pages = []; window.__v210Canvas = html2canvas;
        window.html2canvas = async (node, opts) => {
          const content = node.querySelector(".ringside-pdf-content"), bounds = content.getBoundingClientRect();
          __v210Pages.push({ text: node.innerText,
            pairs: [...node.querySelectorAll(".iso-detail")].map(n => ({ mode: n.dataset.pdfIsoLayout, grid: getComputedStyle(n).gridTemplateColumns })),
            tables: [...node.querySelectorAll(".iso-results")].map(n => ({ mode: n.dataset.pdfIsoLayout, width: n.getBoundingClientRect().width, headers: n.tHead.innerText, rows: [...n.tBodies[0].rows].map(r => r.dataset.rowId) })),
            bodyHeight: node.querySelector(".body-art img")?.getBoundingClientRect().height || null,
            overflow: [...content.children].filter(n => n.getBoundingClientRect().bottom > bounds.bottom + 1).map(n => n.className) });
          return __v210Canvas(node, opts);
        };
      });
      const before = await page.evaluate(() => JSON.stringify(App.getState()));
      const pdf = await download("downloadPDF", config.id, "pdf");
      await page.waitForFunction(() => !document.querySelector("#reportActions [data-pdf-action]").disabled);
      const capture = await page.evaluate(() => { const result = { pages: __v210Pages, diagnostics: RingsidePDF.lastDiagnostics, after: JSON.stringify(App.getState()) }; window.html2canvas = __v210Canvas; return result; });
      assert.equal(capture.after, before); assert.equal(capture.diagnostics.status, "complete");
      for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(capture.diagnostics[key], []);
      assert.equal(capture.diagnostics.isometricLayouts[0].mode, config.mode);
      const tables = capture.pages.flatMap(x => x.tables); assert.deepEqual(tables.flatMap(t => t.rows), rows);
      assert.ok(tables.every(t => t.mode === config.mode)); assert.ok(capture.pages.every(x => x.overflow.length === 0));
      assert.ok(capture.pages.some(x => x.bodyHeight === 315));
      if (config.mode === "stacked") {
        assert.ok(tables.length > 1); assert.ok(capture.pages.every(p => p.pairs.length === 0));
        assert.ok(tables.every(t => Math.abs(t.width - 703) < 1));
      } else { assert.equal(tables.length, 1); assert.equal(capture.pages.flatMap(p => p.pairs).length, 1); assert.ok(tables[0].width < 400); }
      const text = capture.pages.map(x => x.text).join("\n");
      for (const expected of ["30-15VIFT", "做功∶休息示例", "5秒／15秒", "5秒／30秒", "被动恢复", "4.00–4.50 m/s"]) assert.ok(text.includes(expected), expected);
      assert.doesNotMatch(text, /0（被动恢复）/);
      const prefix = path.join(out, config.id + "-page"), rendered = spawnSync("pdftoppm", ["-scale-to", "1400", "-png", pdf, prefix], { encoding: "utf8", windowsHide: true });
      assert.equal(rendered.status, 0, rendered.error?.message || rendered.stderr);
      const images = Array.from({ length: capture.pages.length }, (_, i) => prefix + "-" + String(i + 1).padStart(String(capture.pages.length).length, "0") + ".png").map(filename => ({ path: path.relative(root, filename), sha256: hash(filename) }));
      const evidence = { ...config, pdf: path.relative(root, pdf), sha256: hash(pdf), pages: capture.pages, diagnostics: capture.diagnostics, images };
      result.pdfs.push(evidence); return { pages: capture.pages.length, mode: config.mode, rows: rows.length };
    });
  }
  result.currentSourceHash = hash(file);
  result.pass = result.checks.every(x => x.pass) && result.errors.length === 0 && result.sourceHash === result.currentSourceHash;
  fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify(result, null, 2));
  await browser.close(); if (!result.pass) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; browser?.close(); });
