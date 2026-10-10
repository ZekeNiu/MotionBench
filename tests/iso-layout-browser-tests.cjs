"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), source = path.join(root, "MotionBench.html");
const out = path.join(root, "output/playwright/iso-layout"), pdfOut = path.join(root, "output/pdf");
fs.mkdirSync(out, { recursive: true });
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const envelope = JSON.parse(fs.readFileSync(path.join(root, "examples/three-trials.json")));
const demo = envelope.record || envelope, clone = x => JSON.parse(JSON.stringify(x));
const evidence = { sourceHash: hash(source), checks: [], layouts: [], images: [], downloads: [], errors: [], network: [], pass: false };
const pdfEvidence = { sourceHash: evidence.sourceHash, cases: [], pass: false };
const measured = demo.data.iso.filter(r => r.trials?.length);
let browser, page, context;
async function open(width = 1440) {
  context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on("dialog", d => d.accept()); page.on("pageerror", e => evidence.errors.push(e.message));
  page.on("request", r => { if (/^https?:/.test(r.url())) evidence.network.push(r.url()); });
  await page.clock.setFixedTime(new Date("2026-10-07T02:00:00Z"));
  await page.goto(pathToFileURL(source).href); await page.waitForFunction(() => window.App?.getState);
}
async function saveMenu() {
  if (await page.locator("#sidebar").evaluate(n => n.inert)) await page.locator("#sidebarToggle").click();
  await page.locator('#sidebar button[onclick="App.saveMenu()"]').click();
}
async function importRecord(record) {
  await saveMenu();
  await page.locator("#importFile").setInputFiles({ name: "isometric-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schema: 2, kind: "report", record })) });
  await page.waitForFunction(id => App.getState().recordId === id, record.recordId);
  if (await page.locator("#saveModal").isVisible()) await page.locator("#saveModal button.close").click();
  if (await page.locator("#sidebarScrim").isVisible()) await page.locator("#sidebarScrim").click();
  await page.evaluate(() => App.showReport()); await page.waitForTimeout(180);
}
function fixture(id, count = 3, rows = 13) {
  const r = clone(demo); r.recordId = "iso-layout-" + id; r.athlete.name = "等长布局验收（模拟数据）";
  r.enabled = Object.fromEntries(Object.keys(r.enabled).map(k => [k, k === "iso"]));
  r.data.iso = clone(measured.slice(0, rows));
  for (const row of r.data.iso) row.trials = Array.from({ length: count }, (_, i) => ({ ...row.trials[i % 3], id: row.id + "-layout-" + i }));
  const ids = new Set(r.data.iso.map(r => r.id));
  r.balancePairs = r.balancePairs.filter(p => ids.has(p.numeratorId) && ids.has(p.denominatorId));
  return r;
}
function stressFixture() {
  const r = fixture("stress", 4), shoulder = r.data.iso.find(x => x.id === "iso_shoulder_internalRotation");
  shoulder.direction = "自定义肩内旋方向 · 长名称与固定姿势核验";
  shoulder.target = 1234567;
  shoulder.trials.forEach((t, i) => { t.left = 987654.321 + i; t.right = 1234567.123 + i; t.painLeft = i === 0; });
  r.data.iso.find(x => x.id === "iso_shoulder_externalRotation").target = "";
  const hip = r.data.iso.find(x => x.id === "iso_hip_flexion");
  hip.trials.forEach(t => t.right = "");
  const pair = r.balancePairs.find(p => p.numeratorId === shoulder.id);
  r.balancePairs.push(...[1, 2].map(i => ({ ...pair, id: "layout-balance-" + i, label: "补充平衡配对 " + i })));
  return r;
}
function gradingFixture() {
  const r = fixture("grades", 3);
  r.data.iso.slice(0, 3).forEach((row, i) => {
    const value = Math.max(...row.trials.map(t => Number(row.paired ? t.left : t.center)));
    row.target = value / [1, .9, .6][i];
  });
  r.balancePairs.forEach((pair, i) => {
    if (i < 3) Object.assign(pair, { referenceEnabled: true, ranges: [{ min: 0, max: 10, label: ['处于绿色区间', '处于黄色区间', '处于红色区间'][i], status: ['green', 'amber', 'red'][i] }] });
    else Object.assign(pair, { referenceEnabled: i !== 3, ranges: [] });
  });
  return r;
}
// Token rectangles catch decimal values being broken across lines even when
// the table itself fits its container. Every visible digit sequence stays whole.
function geometry() {
  const section = document.querySelector("#detail-iso"), pair = section.querySelector(".detail-pair");
  const chart = pair.querySelector(".chart-wrap"), table = pair.querySelector(".iso-results"), wrap = table.parentElement;
  const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const svg = chart.querySelector("svg"), vb = svg.viewBox.baseVal;
  const labelsOutside = [...svg.querySelectorAll("text")].filter(t => { const b = t.getBBox(); return b.x < -.5 || b.y < -.5 || b.x + b.width > vb.width + .5 || b.y + b.height > vb.height + .5; }).map(t => t.textContent);
  const brokenNumbers = [], walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.parentElement.getClientRects().length) continue;
    for (const m of t.textContent.matchAll(/\d[\d,.]*%?/g)) {
      const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length);
      if (r.getClientRects().length > 1) brokenNumbers.push(m[0]);
    }
  }
  const misalignedSides = [];
  if (getComputedStyle(table).display === "table") for (const row of table.tBodies[0].rows) {
    const columns = [...row.cells].map(cell => [...cell.querySelectorAll('.stat-side')]);
    for (let side = 0; side < 2; side++) { const tops = columns.map(c => c[side]?.getBoundingClientRect().top).filter(x => x !== undefined); if (tops.length && Math.max(...tops) - Math.min(...tops) > 1) misalignedSides.push(row.dataset.rowId + ':' + side); }
  }
  return { viewport: innerWidth, chart: rect(chart), table: rect(table), wrap: rect(wrap), pair: rect(pair),
    peers: [...document.querySelectorAll('#detail-cmj .detail-pair table,#detail-imtp .detail-pair table')].map(rect),
    pageOverflow: document.documentElement.scrollWidth > innerWidth, localScroll: wrap.scrollWidth > wrap.clientWidth + 1,
    font: getComputedStyle(table.querySelector("td")).fontSize, labelsOutside, brokenNumbers, misalignedSides,
    columns: [...table.querySelectorAll("th")].map(t => ({ label: t.textContent, width: t.getBoundingClientRect().width })) };
}
async function screenshot(name) {
  await page.locator("#detail-iso").evaluate(n => scrollTo({ top: scrollY + n.getBoundingClientRect().top - 82, behavior: "instant" }));
  await page.waitForTimeout(120); const dest = path.join(out, name + ".png");
  await page.screenshot({ path: dest }); evidence.images.push({ path: path.relative(root, dest), sha256: hash(dest) });
}
async function check(name, run) { await run(); evidence.checks.push(name); console.log("PASS " + name); }
async function browserChecks() {
  await open(); await importRecord(demo);
  await check("six-width-seven-columns-aligned-tables-and-readable-numbers", async () => {
    for (const width of [1920, 1440, 1366, 1280, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(200);
      const g = await page.evaluate(geometry); evidence.layouts.push({ scenario: "demo", ...g });
      assert.equal(g.pageOverflow, false); assert.deepEqual(g.labelsOutside, []); assert.deepEqual(g.brokenNumbers, []); assert.deepEqual(g.misalignedSides, []); assert.equal(g.font, "13px");
      assert.equal(g.columns.length, 7);
      assert.equal(g.localScroll, false, 'standard data fits without table scrolling');
      assert.ok(g.peers.length >= 2);
      assert.ok(g.peers.every(p => Math.abs(p.x - g.table.x) < 1 && Math.abs(p.width - g.table.width) < 1), 'align both table edges with CMJ and IMTP');
      if (width > 600) { assert.ok(g.chart.x + g.chart.width <= g.wrap.x + 1); assert.ok(Math.abs(g.chart.y - g.wrap.y) < 1); }
      else { assert.ok(g.wrap.y >= g.chart.y + g.chart.height); assert.equal(g.localScroll, false); }
      if ([1440, 1366, 1280, 390].includes(width)) await screenshot("demo-" + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const cv = evidence.layouts[0].columns[3].width, stats = evidence.layouts[0].columns[2].width;
    assert.ok(cv < stats * .65);
    assert.equal(await page.locator("#detail-imtp .iso-detail").count(), 0);
    assert.equal(await page.locator("#lvp-upper .wide-results").count(), 1);
  });
  await check("one-two-three-four-valid-trials-preserve-radar-and-statistics", async () => {
    for (const n of [1, 2, 3, 4]) {
      await importRecord(fixture("count-" + n, n));
      assert.equal(await page.locator("#detail-iso .iso-results th").count(), n >= 3 ? 7 : 5);
      assert.equal(await page.locator("#detail-iso [data-repeat-stat]").count(), n >= 3 ? 24 : 0);
      const before = await page.evaluate(() => JSON.stringify(App.stats().repetitions.map(g => g.statistics)));
      for (const mode of ["mean", "best"]) { await page.locator("#aggMode").selectOption(mode); assert.equal(await page.evaluate(() => JSON.stringify(App.stats().repetitions.map(g => g.statistics))), before); }
      const values = await page.evaluate(() => { const s = App.stats(), actual = RingsideReport.build(App.getState()).isoRadar; return { axes: actual.axes.map(a => a.label), values: actual.axes.map(a => a.strength), statistics: s.repetitions.flatMap(g => g.statistics).map(s => s.n) }; });
      assert.deepEqual(values.axes, ["颈", "肩", "髋", "膝", "踝"]); assert.ok(values.statistics.every(x => x === n));
      const g = await page.evaluate(geometry); assert.ok(g.chart.x + g.chart.width <= g.wrap.x + 1); assert.equal(g.pageOverflow, false);
    }
  });
  await check("mixed-side-counts-and-long-pain-missing-large-value-results", async () => {
    const mixed = fixture("mixed", 4); mixed.data.iso[2].trials[2].right = ""; mixed.data.iso[2].trials[3].right = "";
    await importRecord(mixed); const row = page.locator('[data-row-id="iso_neck_lateralFlexion"]');
    assert.equal(await row.locator("[data-repeat-stat]").count(), 1); assert.doesNotMatch(await row.innerText(), /\bn=\d/);
    await importRecord(stressFixture());
    assert.ok((await page.locator("#detail-iso").innerText()).includes("疼痛"));
    assert.equal(await page.locator('#detail-iso [data-row-id="iso_shoulder_internalRotation"] [data-balance-id]').count(), 3);
    for (const width of [1440, 1280, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(200); const g = await page.evaluate(geometry); evidence.layouts.push({ scenario: "stress", ...g }); assert.equal(g.pageOverflow, false); assert.deepEqual(g.labelsOutside, []); assert.deepEqual(g.brokenNumbers, []); await screenshot("stress-" + width); }
  });
  await check("raw-trials-do-not-stretch-chart-and-editable-demo-restores", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await importRecord(demo);
    const h = (await page.locator("#detail-iso svg").boundingBox()).height;
    await page.locator("#trials-iso summary").click(); assert.equal((await page.locator("#detail-iso svg").boundingBox()).height, h); await page.locator("#trials-iso summary").click();
    for (const [label, name] of [["保存当前可编辑 HTML 报告", "Ringside_三次重复演示.html"], ["导出当前报告 JSON", "三次重复演示.json"]]) {
      await saveMenu(); const waiting = page.waitForEvent("download"); await page.locator("#saveModal").getByRole("button", { name: label, exact: true }).click();
      const d = await waiting, file = path.join(root, "output/demo", name); await d.saveAs(file); evidence.downloads.push({ path: path.relative(root, file), sha256: hash(file) });
      if (await page.locator("#saveModal").isVisible()) await page.locator("#saveModal button.close").click();
    }
    const clean = await browser.newContext({ offline: true }), p = await clean.newPage(); await p.goto(pathToFileURL(path.join(root, "output/demo/Ringside_三次重复演示.html")).href); await p.waitForFunction(() => window.App?.getState);
    assert.equal(await p.evaluate(() => App.stats().repetitions.filter(g => g.attempts.length === 3).length), 56); assert.equal(await p.locator("[data-repeat-stat]").count(), 71); await clean.close();
  });
  await check("compact-labels-retain-grades-ratios-sides-and-full-accessible-explanations", async () => {
    await importRecord(gradingFixture());
    for (const column of ['评价', '关节平衡']) {
      for (const [status, label] of Object.entries({green: '达标', amber: '关注', red: '严重'})) {
        const pills = page.locator(`#detail-iso td[data-label="${column}"] .iso-status.${status}`);
        assert.ok(await pills.count(), column + status);
        assert.ok((await pills.locator('.iso-status-label').allTextContents()).every(t => t === label));
        assert.ok((await pills.evaluateAll(nodes => nodes.map(n => n.title === n.getAttribute('aria-label') && n.title.length > 2))).every(Boolean));
      }
    }
    const gray = page.locator('#detail-iso td[data-label="关节平衡"] .iso-status.gray');
    assert.ok(await gray.count());
    assert.ok((await gray.allTextContents()).every(t => /\d/.test(t) && !/[\u4e00-\u9fff]/.test(t)), 'unconfigured gray pills retain ratios without status text');
    assert.ok((await gray.evaluateAll(nodes => nodes.map(n => /未启用评价标准|未设等级区间/.test(n.title)))).every(Boolean));
    for (const width of [1440, 1366, 1280, 900, 390]) {
      await page.setViewportSize({width, height:1000}); await page.waitForTimeout(180);
      const g = await page.evaluate(geometry); evidence.layouts.push({scenario:'grades', ...g});
      assert.equal(g.pageOverflow, false); assert.equal(g.localScroll, false);
      assert.deepEqual(g.brokenNumbers, []); assert.deepEqual(g.misalignedSides, []);
    }
    await page.setViewportSize({width:1366,height:1000}); await screenshot('compact-grades-1366');
  });
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.network, []); evidence.pass = true;
  await context.close(); fs.writeFileSync(path.join(out, "review.json"), JSON.stringify(evidence, null, 2));
}
async function pdfCase(id, record, mode, width = 1440, expanded = false) {
  await open(width); await importRecord(record);
  const before = await page.evaluate(expanded => {
    document.querySelectorAll("[data-raw-trials]").forEach(n => n.open = expanded);
    window.__isoPages = []; window.__isoPrintLabels = [];
    const layout = RingsideReport.layoutCharts;
    RingsideReport.layoutCharts = function(node, options) { layout(node, options); if (options?.print) for (const svg of node.querySelectorAll('.iso-detail svg')) { const v = svg.viewBox.baseVal; for (const t of svg.querySelectorAll('text')) { const b = t.getBBox(); if (b.x < -.5 || b.y < -.5 || b.x + b.width > v.width + .5 || b.y + b.height > v.height + .5) __isoPrintLabels.push(t.textContent); } } };
    const render = html2canvas;
    window.html2canvas = async (n, o) => {
      const body = n.querySelector(".ringside-pdf-content"), b = body.getBoundingClientRect();
      const rect = x => { const r = x.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const brokenNumbers = [], misalignedSides = [];
      for (const table of n.querySelectorAll('.iso-results')) {
        const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { const t = walker.currentNode; for (const m of t.textContent.matchAll(/\d[\d,.]*%?/g)) { const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); if (r.getClientRects().length > 1) brokenNumbers.push(m[0]); } }
        for (const row of table.tBodies[0].rows) { const columns = [...row.cells].map(cell => [...cell.querySelectorAll('.stat-side')]); for (let side = 0; side < 2; side++) { const tops = columns.map(c => c[side]?.getBoundingClientRect().top).filter(x => x !== undefined); if (tops.length && Math.max(...tops) - Math.min(...tops) > 1) misalignedSides.push(row.dataset.rowId + ':' + side); } }
      }
      __isoPages.push({ text: n.innerText, stats: n.querySelectorAll("[data-repeat-stat]").length,
        brokenNumbers, misalignedSides,
        overflow: [...body.children].filter(x => x.getBoundingClientRect().bottom > b.bottom + .5).map(x => x.className),
        rowColors: [...new Set([...n.querySelectorAll("tbody tr,tbody td")].map(r => getComputedStyle(r).backgroundColor))],
        iso: [...n.querySelectorAll('.iso-results')].map(t => ({ ...rect(t), columns: [...t.tHead.rows[0].cells].map(c => c.getBoundingClientRect().width), headers: t.tHead.innerText, rows: [...t.querySelectorAll('tbody>tr')].map(r => r.dataset.rowId), mode: t.dataset.pdfIsoLayout, font: getComputedStyle(t.querySelector('td')).fontSize })),
        charts: [...n.querySelectorAll('.chart-wrap[data-pdf-iso-layout]')].map(rect),
        tables: [...n.querySelectorAll('table')].map(t => ({ headers: t.tHead?.innerText, rows: t.tBodies[0]?.rows.length })) });
      return render(n, o);
    };
    return { state: JSON.stringify(App.getState()), raw: [...document.querySelectorAll('[data-raw-trials]')].map(n => n.open), stats: document.querySelectorAll('[data-repeat-stat]').length, rows: [...document.querySelectorAll('.iso-results tbody tr')].map(n => n.dataset.rowId) };
  }, expanded);
  await saveMenu(); const waiting = Promise.race([page.waitForEvent("download", { timeout: 180000 }), page.waitForFunction(() => RingsidePDF.lastDiagnostics?.status === "failed", null, { timeout: 180000 }).then(async () => { throw Error((await page.evaluate(() => RingsidePDF.lastDiagnostics)).error); })]);
  await page.locator("#pdfButton").click(); const d = await waiting, dest = path.join(pdfOut, id + ".pdf"); await d.saveAs(dest); await page.waitForFunction(() => !document.querySelector("#pdfButton").disabled);
  const after = await page.evaluate(() => ({ state: JSON.stringify(App.getState()), raw: [...document.querySelectorAll('[data-raw-trials]')].map(n => n.open), pages: __isoPages, labelsOutside: __isoPrintLabels, diagnostics: RingsidePDF.lastDiagnostics }));
  fs.writeFileSync(path.join(out, id + "-capture.json"), JSON.stringify({ sourceHash: evidence.sourceHash, pages: after.pages, diagnostics: after.diagnostics, labelsOutside: after.labelsOutside }, null, 2));
  assert.equal(after.state, before.state); assert.deepEqual(after.raw, before.raw); assert.deepEqual(after.labelsOutside, []);
  assert.equal(after.diagnostics.status, "complete");
  for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(after.diagnostics[key], []);
  assert.equal(after.diagnostics.isometricLayouts[0].mode, mode);
  assert.equal(after.pages.reduce((n, p) => n + p.stats, 0), before.stats);
  assert.deepEqual(after.pages.flatMap(p => p.iso.flatMap(t => t.rows)), before.rows);
  assert.ok(after.pages.every(p => !p.overflow.length));
  assert.ok(after.pages.every(p => p.rowColors.every(c => c === "rgb(255, 255, 255)")), "Every PDF data row and cell is white");
  assert.ok(after.pages.every(p => !p.brokenNumbers.length)); assert.ok(after.pages.every(p => !p.misalignedSides.length));
  const isoPages = after.pages.filter(p => p.iso.length), chartPages = after.pages.filter(p => p.charts.length);
  assert.equal(chartPages.length, 1); assert.ok(isoPages.every(p => p.iso.every(t => t.font === "12px")));
  if (mode === "side-by-side") { assert.equal(isoPages.length, 1); assert.equal(isoPages[0].charts.length, 1); assert.ok(isoPages[0].charts[0].x + isoPages[0].charts[0].width <= isoPages[0].iso[0].x + 1); }
  else { assert.ok(isoPages.every(p => p.iso.every(t => t.width > 690))); assert.ok(isoPages.every(p => p.iso.every(t => t.headers.includes("均值 ± SD")))); assert.ok(chartPages[0].iso.length); const columns = isoPages[0].iso[0].columns; assert.ok(isoPages.every(p => p.iso.every(t => t.columns.every((w,i) => Math.abs(w-columns[i]) < 1)))); }
  pdfEvidence.cases.push({ id, pass: true, width, expanded, mode, pdfSha256: hash(dest), pages: after.pages, diagnostics: after.diagnostics });
  fs.writeFileSync(path.join(pdfOut, "iso-layout-download-verification.json"), JSON.stringify(pdfEvidence, null, 2));
  console.log("PASS PDF " + id + " " + mode + " " + after.pages.length + " pages " + JSON.stringify(after.diagnostics.isometricLayouts)); await context.close();
}
(async () => {
  browser = await chromium.launch({ channel: "chrome" });
  try {
    if (!process.argv.includes("--pdf-only")) await browserChecks();
    if (!process.argv.includes("--browser-only")) {
      await pdfCase("iso-layout-small", fixture("pdf-small", 3, 3), "side-by-side");
      await pdfCase("iso-layout-boundary-fit", fixture("pdf-fit", 3, 5), "side-by-side");
      await pdfCase("iso-layout-boundary-stack", fixture("pdf-stack", 3, 6), "stacked");
      await pdfCase("iso-layout-stress", stressFixture(), "stacked");
      await pdfCase("iso-layout-demo", demo, "stacked");
      await pdfCase("iso-layout-small-mobile", fixture("pdf-small", 3, 3), "side-by-side", 390, true);
      assert.deepEqual(pdfEvidence.cases[0].pages, pdfEvidence.cases.at(-1).pages);
      await pdfCase("iso-layout-grades", gradingFixture(), "stacked");
      assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.network, []);
      pdfEvidence.foldAndViewportIndependent = true; pdfEvidence.pass = true;
      fs.writeFileSync(path.join(pdfOut, "iso-layout-download-verification.json"), JSON.stringify(pdfEvidence, null, 2));
    }
  } catch (error) {
    const failure = { sourceHash: evidence.sourceHash, failure: error.stack, browser: evidence, pdf: pdfEvidence };
    fs.writeFileSync(path.join(out, "failure-" + Date.now() + ".json"), JSON.stringify(failure, null, 2));
    console.error(error.stack); process.exitCode = 1;
  } finally { await browser.close(); }
})();
