"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs"), { createFixture } = require("./helpers/longitudinal-fixture.cjs");
const root = path.resolve(__dirname, ".."), source = path.join(root, "MotionBench.html");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome", skipPDF = process.argv.includes("--skip-pdf"), quick = process.argv.includes("--quick");
const index = process.argv.indexOf("--artifact-dir"), equals = process.argv.find(arg => arg.startsWith("--artifact-dir="));
const out = path.resolve(root, equals ? equals.slice(15) : index >= 0 ? process.argv[index + 1] : `output/release/2.26.3-local/mini-layout/${channel}`);
const relative = path.relative(path.join(root, "output"), out);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Artifacts must stay within an output subdirectory");
if (fs.existsSync(out) && fs.readdirSync(out).length) throw Error("Preserve the existing attempt and use a fresh --artifact-dir");
fs.mkdirSync(out, { recursive: true });
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex"), hashText = value => createHash("sha256").update(value).digest("hex");
const modules = ["src/ringside-result-display.js", "src/ringside-longitudinal.css", "src/ringside-longitudinal-view.js", "src/ringside-pdf.js"];
const receipt = { channel, synthetic: true, sourceHash: sha(source), runnerSha256: sha(__filename), moduleHashes: Object.fromEntries(modules.map(file => [file, sha(path.join(root, file))])), skipPDF, quick, checks: [], matrix: [], screenshots: [], errors: [], pass: false };
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) <= .5, `${message}: ${actual} != ${expected}`); }
function verify(evidence, count, expectedLeft) {
  assert.ok(evidence.rows.length > 0);
  const plotted = evidence.rows.filter(row => !row.empty), lefts = [...new Set(plotted.map(row => row.left))];
  assert.equal(lefts.length, 1, "all report plots share one gutter");
  if (expectedLeft !== undefined) near(lefts[0], expectedLeft, "print/subtree must retain report gutter");
  for (const row of evidence.rows) {
    assert.equal(row.inputUnchanged, true, row.id + " input JSON mutated");
    if (row.empty) { near(row.frame.height, 0, row.id + " empty frame height"); continue; }
    const restoredWidth = row.left + 125 + 10;
    for (const [kind, box] of [["frame", row.frame], ["svg", row.svg]]) { near(box.width, restoredWidth, row.id + " " + kind + " width"); near(box.height, 72, row.id + " " + kind + " height"); }
    assert.deepEqual(row.viewBox, [0, 0, restoredWidth, 72]); assert.equal(row.left, row.svgLeft);
    near(row.expectedWidth, restoredWidth, row.id + " geometry width"); near(row.plotHeight, 39, row.id + " restored plot height");
    if (row.cellInnerWidth !== null) assert.ok(row.cellInnerWidth + .75 >= row.frame.width, row.id + " chart overflows its result column");
    assert.equal(row.pointCount, count, row.id + " retains every date slot");
    assert.deepEqual(row.tickLabels, row.expectedTicks, row.id + " retains exact numeric ticks");
    assert.deepEqual(row.clippedText, [], row.id + " text clipping"); assert.deepEqual(row.textCollisions, [], row.id + " text collisions");
    near(row.gridLeft, row.left, row.id + " plot left"); near(row.gridRight - row.gridLeft, 125, row.id + " restored plot width");
    assert.ok(row.bandOpacity.every(value => value === "0.075"), row.id + " reference band opacity");
  }
  assert.ok(plotted.some(row => row.bandOpacity.length), "evaluation bands must remain present");
  assert.equal(evidence.documentOverflow, false); return lefts[0];
}
// Runs against the actual application DOM and native renderer, with no mirrored drawing code.
function inspect(selector) {
  const container = document.querySelector(selector), D = RingsideResultDisplay;
  const ink = document.createElement("canvas").getContext("2d");
  const box = node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; };
  const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .75 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .75;
  const rows = [...container.querySelectorAll("[data-result-trend]")].map(host => {
    const input = host.dataset.resultTrend, spec = JSON.parse(input), svg = host.querySelector("svg"), geometry = D.geometry(spec, { axisLeft: Number(host.dataset.trendAxisLeft) });
    const base = { id: host.closest("[data-metric-id]")?.dataset.metricId || spec.name, name: spec.name, unit: spec.unit, empty: !svg, frame: box(host), inputUnchanged: input === JSON.stringify(spec) };
    if (!svg) return base;
    const unitNode = svg.querySelector('[data-trend-axis="y"] text');
    // SVG getBBox includes the font line box. For the unit header only, prove
    // actual glyph ink fits instead of treating its 1px leading as clipped ink.
    let unitInkEvidence = null;
    const labels = [...svg.querySelectorAll("text")].map(node => {
      const b = node.getBBox(), fontBox = { x: b.x, y: b.y, width: b.width, height: b.height };
      let bounds = fontBox;
      if (node === unitNode) {
        const style = getComputedStyle(node); ink.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" "); ink.textAlign = "left"; ink.textBaseline = "alphabetic";
        if (!ink.font.includes(style.fontSize)) throw Error("Canvas font did not accept the SVG font size");
        const m = ink.measureText(node.textContent), x = Number(node.getAttribute("x")), y = Number(node.getAttribute("y"));
        bounds = { x: x - m.actualBoundingBoxLeft, y: y - m.actualBoundingBoxAscent, width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
        unitInkEvidence = { text: node.textContent, svgFontSize: style.fontSize, svgFontFamily: style.fontFamily, svgFontWeight: style.fontWeight, canvasFont: ink.font, fontBox, inkBox: bounds };
      }
      return { text: node.textContent, ...bounds };
    }).filter(item => item.width && item.height);
    const grids = [...svg.querySelectorAll('[data-trend-axis="y"] path')].map(node => node.getAttribute("d")).filter(d => /H/.test(d));
    const match = grids[0]?.match(/^M([\d.]+) [\d.]+H([\d.]+)$/);
    const ticks = [...svg.querySelectorAll('[data-trend-axis="y"] text')].slice(1).map(node => node.textContent), cell = host.closest("td"), cellStyle = cell ? getComputedStyle(cell) : null;
    const cellInnerWidth = cell ? cell.getBoundingClientRect().width - parseFloat(cellStyle.paddingLeft) - parseFloat(cellStyle.paddingRight) - parseFloat(cellStyle.borderLeftWidth) - parseFloat(cellStyle.borderRightWidth) : null;
    return { ...base, svg: box(svg), left: Number(host.dataset.trendAxisLeft), svgLeft: Number(svg.dataset.trendAxisLeft), gridLeft: Number(match?.[1]), gridRight: Number(match?.[2]), expectedWidth: geometry.width, plotHeight: geometry.bottom - geometry.top, cellInnerWidth, viewBox: svg.getAttribute("viewBox").split(/\s+/).map(Number), pointCount: svg.querySelectorAll("[data-trend-point]").length, tickLabels: ticks, expectedTicks: geometry.tickLabels, unitInkEvidence, clippedText: labels.filter(b => b.x < -.75 || b.y < -.75 || b.x + b.width > geometry.width + .75 || b.y + b.height > 72.75), textCollisions: labels.flatMap((label, i) => labels.slice(i + 1).filter(other => overlap(label, other)).map(other => ({ label, other }))), bandOpacity: [...svg.querySelectorAll("[data-trend-band]")].map(node => getComputedStyle(node).fillOpacity) };
  });
  return { rows, documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
}
async function main() {
  const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }), page = await context.newPage();
  page.setDefaultTimeout(25000); page.on("pageerror", error => receipt.errors.push(error.message));
  const check = async (name, fn) => { await fn(); receipt.checks.push(name); console.log("PASS " + name); };
  const settle = async () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async name => { const file = path.join(out, name); await page.screenshot({ path: file, fullPage: true }); receipt.screenshots.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: sha(file) }); };
  const invariant = () => page.evaluate(async () => JSON.stringify({ facts: RingsideLongitudinal.facts(App.getLongitudinal()), document: App.getLongitudinalDocument(), raw: await Promise.all(App.getLibrary().athletes.flatMap(a => a.records.map(r => App.getRepository().loadRecord(r.recordId)))) }));
  const unchanged = async (before, label) => {
    const after = await invariant(); if (after === before) return;
    const expected = JSON.parse(before), actual = JSON.parse(after), changed = [];
    const walk = (left, right, at) => {
      if (Object.is(left, right)) return;
      if (!left || !right || typeof left !== "object" || typeof right !== "object") { changed.push({ path: at, before: left, after: right }); return; }
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], at ? at + "." + key : key);
    };
    walk(expected, actual, ""); if (!changed.length) return;
    // Viewport/media changes legitimately persist the current scroll position.
    // Keep all facts, raw record fields, narrative and other document fields
    // exact; record the narrowly identified presentation metadata separately.
    const presentation = new Set(["document.views.reportScroll", "document.updated", "document.revision"]);
    if (changed.every(item => presentation.has(item.path)) && changed.some(item => item.path === "document.views.reportScroll")) {
      (receipt.presentationMetadataChanges ||= []).push({ label, changed }); return;
    }
    receipt.invariantFailure = { label, changed };
    fs.writeFileSync(path.join(out, "invariant-failure.json"), JSON.stringify({ label, changed, expected, actual }, null, 2));
    throw Error(label + ": changed paths " + changed.map(item => item.path).join(", "));
  };
  let ids;
  try {
    await page.goto(pathToFileURL(source).href); await page.waitForFunction(() => !!window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true);
    await check("isolated synthetic library includes five quantities and an entirely missing metric", async () => {
      ids = await page.evaluate(async factory => {
        const f = (0, eval)("(" + factory + ")")(window, 17), M = RingsideModel, enabled = new Set(["cmj", "iso", "imtp", "mas", "long_generic"]);
        f.records = f.records.map((r, index) => {
          for (const id of Object.keys(r.enabled)) r.enabled[id] = enabled.has(id);
          r.title = "迷你图合成测试 " + (index + 1); r.data.cmj = [r.data.cmj[0]]; r.data.imtp = [r.data.imtp[0]];
          r.isoDirectionIds = [r.data.iso.find(row => !row.paired).id, r.data.iso.find(row => row.paired).id];
          const long = r.definitions.find(d => d.id === "long_unknown"); long.name = "相对冲量（长单位）"; long.unit = "牛顿·秒/千克（相对冲量）"; long.measurementScale = "ratio"; long.target = 13000;
          r.definitions.push({ ...r.definitions.find(d => d.id === "long_time"), id: "long_missing", name: "未测指标", unit: "cm" });
          r.data.long_generic = [r.data.long_generic[0]];
          r.data.long_generic[0].metrics = { long_time: 12 - index * .1, long_pct: 20 + index * 2, long_unknown: 12345 + index * 10 };
          r = M.normalizeRecord(r); r.views.genericReports.long_generic = RingsideGenericReport.createView(r, "long_generic", { kind: "none" }); return r;
        });
        f.profile = RingsideEvaluation.create(f.records.at(-1), "迷你图合成评价方案"); f.catalog = M.mergeCatalog(null, f.records.at(-1));
        f.records.forEach(r => r.evaluationProfileId = f.profile.id);
        const lib = M.libraryDefaults(); lib.schema = 3; lib.catalog = f.catalog; lib.evaluationProfiles = [RingsideEvaluation.serializeProfile(f.profile)]; lib.defaultEvaluationProfileId = f.profile.id;
        lib.athletes = [{ id: f.athleteId, name: f.records[0].athlete.name, profile: M.profileFromRecord(f.records[0]), records: f.records }]; lib.activeAthleteId = f.athleteId; lib.activeRecordId = f.records[0].recordId;
        await App.importPayload(lib, "replace-library"); await App.showReport(false); if (!await App.saveNow()) throw Error("Synthetic import did not save"); return f.records.map(r => r.recordId);
      }, createFixture.toString());
    });
    for (const count of (quick ? [2, 17] : [2, 3, 8, 17])) {
      assert.equal(await page.evaluate(ids => App.selectRecords(ids), ids.slice(0, count)), true);
      await page.locator("#reportNarrativeButton").click(); await page.locator("#interpEditor").fill("迷你图合成人工正文：保留全部测试日期、测量值和评价。"); await page.locator("#workspaceBack").click(); assert.equal(await page.evaluate(() => App.saveNow()), true);
      const before = await invariant();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await settle();
        await check(`${count} dates at ${width}px share canonical frame and plot geometry`, async () => {
          const screen = await page.evaluate(inspect, "#reportView"), entry = { count, width, media: "screen", ...screen }; receipt.matrix.push(entry); const axisLeft = verify(screen, count); entry.axisLeft = axisLeft;
          for (const unit of ["cm", "N", "%", "s", "牛顿·秒/千克（相对冲量）"]) assert.ok(screen.rows.some(row => row.unit === unit), "missing module/unit " + unit);
          if (count === 17) await shot(`screen-${count}-${width}.png`);
        });
        await check(`${count} dates at ${width}px retain exact print frame and all date points`, async () => {
          const expected = receipt.matrix.at(-1).axisLeft;
          await page.emulateMedia({ media: "print" });
          await page.evaluate(() => { const clone = document.querySelector("#reportView").cloneNode(true); clone.id = "miniPrintAudit"; clone.className = "ringside-pdf-document ringside-pdf-source"; clone.style.cssText = "position:absolute;left:-20000px;top:0;width:703px"; document.body.append(clone); RingsideLongitudinalView.layout(clone, { print: true }); });
          try { const print = await page.evaluate(inspect, "#miniPrintAudit"); receipt.matrix.push({ count, width, media: "print", axisLeft: expected, ...print }); verify(print, count, expected); }
          finally { await page.evaluate(() => document.querySelector("#miniPrintAudit")?.remove()); await page.emulateMedia({ media: "screen" }); }
          await unchanged(before, "layout/print facts, raw records and manual body");
        });
      }
    }
    await check("an entirely missing renderer input creates no graph, invented point or extra vertical space", async () => {
      const empty = await page.evaluate(() => { const spec = { name: "全缺测组件边界", unit: "cm", points: [{ label: "2026-01-20", value: null }, { label: "2026-02-20", value: null }] }, before = JSON.stringify(spec), host = document.createElement("div"); host.innerHTML = RingsideResultDisplay.render(spec); document.body.append(host); const frame = host.firstElementChild; RingsideResultDisplay.layout(host); const result = { height: frame.getBoundingClientRect().height, svg: frame.querySelectorAll("svg").length, points: frame.querySelectorAll("[data-trend-point]").length, inputUnchanged: before === JSON.stringify(spec) }; host.remove(); return result; });
      near(empty.height, 0, "empty renderer height"); assert.equal(empty.svg, 0); assert.equal(empty.points, 0); assert.equal(empty.inputUnchanged, true); receipt.empty = empty;
    });
    await check("keyboard and slot tooltip behavior remain available", async () => {
      const points = page.locator('#reportView .result-trend [data-trend-point]'); await points.first().focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await points.nth(1).evaluate(node => document.activeElement === node), true); await page.keyboard.press("End");
      assert.equal(await page.evaluate(() => document.activeElement.dataset.trendPoint), "16");
      assert.ok((await page.locator(".result-trend-tooltip:visible").innerText()).length > 0);
    });
    await check("printing an actual lower-gutter subtree retains the larger complete-report context", async () => {
      const selection = await page.evaluate(() => {
        const all = [...document.querySelectorAll('#reportView [data-result-trend]')], full = Math.max(...all.map(node => Number(node.dataset.trendAxisLeft) || 0));
        const table = [...document.querySelectorAll('#reportView [data-longitudinal-table]')].find(node => { const requirements = [...node.querySelectorAll('[data-result-trend]')].map(host => RingsideResultDisplay.geometry(JSON.parse(host.dataset.resultTrend))?.requiredLeft).filter(Number.isFinite); return requirements.length && Math.max(...requirements) < full; });
        if (!table) throw Error("Fixture needs a smaller-gutter module than the full report");
        const clone = table.cloneNode(true), host = document.createElement("div"); host.id = "miniSubtreeAudit"; host.className = "ringside-pdf-document"; host.style.cssText = "position:absolute;left:-20000px;top:0;width:703px"; host.append(clone); document.body.append(host); RingsideLongitudinalView.layout(host, { print: true }); return { full, natural: Math.max(...[...table.querySelectorAll('[data-result-trend]')].map(node => RingsideResultDisplay.geometry(JSON.parse(node.dataset.resultTrend))?.requiredLeft || 0)) };
      });
      try { const view = await page.evaluate(inspect, "#miniSubtreeAudit"); for (const row of view.rows.filter(row => !row.empty)) { near(row.left, selection.full, "subtree inherited gutter"); near(row.svg.width, selection.full + 125 + 10, "subtree width"); near(row.svg.height, 72, "subtree height"); near(row.gridRight-row.gridLeft, 125, "subtree restored plot width"); } receipt.subtree = { ...selection, rows: view.rows }; }
      finally { await page.evaluate(() => document.querySelector("#miniSubtreeAudit")?.remove()); }
    });
    if (!skipPDF) await check("actual 17-date PDF final pages preserve restored mini plot sizes with no missing rows or charts", async () => {
      await page.setViewportSize({ width: 1440, height: 1000 }); await settle(); const before = await invariant();
      await page.evaluate(() => { window.__miniPDFPages = []; const original = window.html2canvas; window.html2canvas = async function(node, ...args) { if (node.classList?.contains("ringside-pdf-page")) window.__miniPDFPages.push([...node.querySelectorAll("[data-result-trend]")].map(host => { const image = host.querySelector("img"), b = host.getBoundingClientRect(), r = image?.getBoundingClientRect(); return { id: host.closest("[data-metric-id]")?.dataset.metricId, empty: !image, frame: { width: b.width, height: b.height }, image: r ? { width: r.width, height: r.height } : null, left: Number(host.dataset.trendAxisLeft) }; })); return original.call(this, node, ...args); }; });
      const awaited = page.waitForEvent("download", { timeout: 240000 }); awaited.catch(() => {}); let timer;
      try { await Promise.race([(async () => { await page.evaluate(() => App.downloadPDF()); const item = await awaited; assert.equal(await item.failure(), null); await item.saveAs(path.join(out, "seventeen-date-minis.pdf")); })(), new Promise((_, reject) => timer = setTimeout(() => reject(Error("PDF shared deadline exceeded")), 240000))]); }
      finally { clearTimeout(timer); }
      const actual = await page.evaluate(() => ({ diagnostics: RingsidePDF.lastDiagnostics, pages: window.__miniPDFPages })), d = actual.diagnostics;
      assert.equal(d.status, "complete"); assert.equal(d.pageCount, actual.pages.length); assert.equal(d.chartCount, d.sourceChartCount); assert.equal(d.renderedRowCount, d.rowCount);
      for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(d[key], [], key);
      const images = actual.pages.flat().filter(row => !row.empty); assert.ok(images.length > 0); const expected = receipt.matrix.find(row => row.count === 17 && row.media === "screen").axisLeft;
      for (const row of actual.pages.flat()) { if (row.empty) { near(row.frame.height, 0, "empty PDF mini height"); continue; } const restoredWidth = expected + 125 + 10; near(row.frame.width, restoredWidth, "PDF frame width"); near(row.frame.height, 72, "PDF frame height"); near(row.image.width, restoredWidth, "PDF image width"); near(row.image.height, 72, "PDF image height"); near(row.left, expected, "PDF inherited report gutter"); }
      await unchanged(before, "PDF data and narrative"); receipt.pdf = { ...actual, file: path.relative(root, path.join(out, "seventeen-date-minis.pdf")).replaceAll("\\", "/"), sha256: sha(path.join(out, "seventeen-date-minis.pdf")) };
    });
    assert.deepEqual(receipt.errors, []); receipt.pass = true;
  } catch (error) { receipt.failure = error.stack || String(error); console.error(receipt.failure); await shot("failure.png").catch(() => {}); process.exitCode = 1; }
  finally { receipt.finishedUTC = new Date().toISOString(); receipt.sourceUnchanged = sha(source) === receipt.sourceHash && modules.every(file => sha(path.join(root, file)) === receipt.moduleHashes[file]); receipt.pass = receipt.pass && receipt.sourceUnchanged; fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(receipt, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
