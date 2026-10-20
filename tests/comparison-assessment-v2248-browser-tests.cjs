"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { execFileSync } = require("node:child_process");
const { chromium } = require("./helpers/playwright.cjs"), { createFixture } = require("./helpers/longitudinal-fixture.cjs"), { assessmentFixture } = require("./comparison-assessment-v2248-tests.cjs");
const root = path.resolve(__dirname, ".."), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.resolve(root, process.argv.find(arg => arg.startsWith("--artifact-dir="))?.slice(15) || "output/comparison-trend/release-v2248-focused/assessment");
const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = ["MotionBench.html", "src/ringside-model.js", "src/ringside-evaluation.js", "src/ringside-result-display.js", "src/ringside-longitudinal.js", "src/ringside-longitudinal-view.js", "src/ringside-longitudinal.css", "src/ringside-pdf.js", "tests/helpers/longitudinal-fixture.cjs", "tests/helpers/playwright.cjs", "tests/comparison-assessment-v2248-tests.cjs"];
const identities = () => Object.fromEntries(files.map(file => [file, digest(path.join(root, file))]));

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const receipt = path.join(out, "results.json");
  if (fs.existsSync(receipt)) fs.copyFileSync(receipt, path.join(out, "results-before-" + Date.now() + ".json"));
  const result = { synthetic: true, scope: "comparison assessment, reference bands, shared table display and focused real PDF", channel, sourceHash: digest(path.join(root, "MotionBench.html")), runnerSha256: digest(__filename), sourceFiles: identities(), version: JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), checks: [], artifacts: [], errors: [], pass: false };
  const browser = await chromium.launch({ channel, headless: true });
  const check = async (name, action) => { await action(); result.checks.push(name); console.log("PASS " + name); };
  const artifact = file => result.artifacts.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: digest(file) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
    page.on("pageerror", error => result.errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "MotionBench.html")).href); await page.waitForFunction(() => App.ready);
    await page.addScriptTag({ content: "window.assessmentBase=" + createFixture.toString() + ";window.assessmentInput=" + assessmentFixture.toString() });
    await page.addStyleTag({ content: "body>:not(#assessmentFixture):not(.ringside-pdf-stage):not(.html2canvas-container){display:none!important}#assessmentFixture{width:calc(100% - 40px);max-width:1160px;margin:20px auto}" });
    await page.evaluate(() => {
      window.assessmentData = assessmentInput(window, assessmentBase); window.assessmentBefore = JSON.stringify(assessmentData);
      window.assessmentModel = RingsideLongitudinal.build(assessmentData.records, assessmentData);
      const ids = ["cmj_height", "fms:0", "fms:1", "long_time", "long_pct", "long_unknown", "iso:iso_neck_flexion:C", "iso:iso_shoulder_externalRotation:L", "asym:iso_shoulder_externalRotation", "iso:iso_shoulder_internalRotation:L", "imtp_peak_force", "fvp_sj:profile:slope"];
      window.assessmentRows = ids.map(id => assessmentModel.projects.flatMap(project => project.metrics).find(row => row.id === id));
      const host = document.createElement("main"); host.id = "assessmentFixture"; host.dataset.longitudinal = "true";
      host.innerHTML = "<h2>纵向比较 · 评价与趋势合成验收</h2>" + RingsideLongitudinalView.table(assessmentRows, assessmentModel.periods); document.body.append(host);
      RingsideLongitudinalView.mount(host, assessmentModel);
    });
    const alignments = async () => page.locator("#assessmentFixture td[data-record-id]").evaluateAll(cells => cells.map(cell => {
      const group = cell.querySelector(".longitudinal-result-value"), value = cell.querySelector("strong"), pill = cell.querySelector(".longitudinal-assessment"), a = value?.getBoundingClientRect(), b = pill?.getBoundingClientRect();
      return { id: cell.closest("tr").dataset.metricId, record: cell.dataset.recordId, label: pill?.textContent, status: pill?.className, inGroup: !!group?.contains(pill), display: group && getComputedStyle(group).display, value: a && { top: a.top, bottom: a.bottom, right: a.right }, pill: b && { top: b.top, bottom: b.bottom, left: b.left }, text: cell.textContent, title: cell.title, pillTitle: pill?.title };
    }));
    const assertInline = cells => {
      assert.ok(cells.filter(cell => cell.pill).length >= 30);
      for (const cell of cells.filter(cell => cell.pill)) {
        if (cell.id.startsWith("asym:")) { assert.equal(cell.inGroup, false); assert.match(cell.label, /左侧更弱/); continue; }
        assert.equal(cell.inGroup, true, JSON.stringify(cell)); assert.equal(cell.display, "flex");
        assert.ok(cell.pill.left >= cell.value.right - .5, JSON.stringify(cell));
        assert.ok(Math.min(cell.value.bottom, cell.pill.bottom) > Math.max(cell.value.top, cell.pill.top), JSON.stringify(cell));
        assert.ok(["预警", "关注", "优秀", "自定观察区"].includes(cell.label), JSON.stringify(cell));
      }
    };
    await check("all result types place standardized traffic lights after their values while bilateral difference keeps its separate explanation", async () => {
      result.desktop = await alignments(); assertInline(result.desktop);
      for (const id of ["cmj_height", "long_time", "long_pct"]) assert.deepEqual(result.desktop.filter(cell => cell.id === id).map(cell => cell.label), ["预警", "关注", "优秀"]);
      assert.deepEqual(result.desktop.filter(cell => cell.id === "fms:0").map(cell => cell.label), ["关注", "关注", "优秀"]);
      assert.ok(result.desktop.filter(cell => cell.id === "long_unknown").every(cell => cell.label === "自定观察区"));
    });
    await check("recorded force pain overrides a green target with a red warning and a source reason without importing asymmetry", async () => {
      const force = result.desktop.filter(cell => cell.id === "iso:iso_neck_flexion:C");
      assert.deepEqual(force.map(cell => cell.label), ["关注", "预警", "预警"]);
      for (const cell of force.slice(1)) { assert.match(cell.status, /\bred\b/); assert.match(cell.title + " " + cell.pillTitle, /疼痛/); assert.doesNotMatch(cell.text, /录入标记：疼痛|双侧差异/); }
      const cleanForces = result.desktop.filter(cell => cell.id === "iso:iso_shoulder_externalRotation:L"); assert.ok(cleanForces.every(cell => cell.label === "优秀")); for (const cell of cleanForces) assert.doesNotMatch(cell.title + " " + cell.pillTitle, /双侧差异/);
      const painFMS = result.desktop.find(cell => cell.id === "fms:1" && cell.record === "synthetic-period-02"); assert.match(painFMS.status, /\bred\b/); assert.match(painFMS.text, /0.*预警.*左侧 3 \/ 右侧 3/);
    });
    await check("configured targets and ranges have visible bounded backgrounds with unchanged geometry and working point details", async () => {
      result.charts = await page.locator("#assessmentFixture .result-trend").evaluateAll(nodes => nodes.map(node => {
        const svg = node.querySelector("svg"), box = svg.getBoundingClientRect(), projection = JSON.parse(node.dataset.resultTrend), bands = [...svg.querySelectorAll('rect[fill-opacity=".075"]')];
        return { id: node.closest("tr").dataset.metricId, width: box.width, height: box.height, points: svg.querySelectorAll("[data-trend-point]").length, reference: projection.reference?.kind, bands: bands.map(rect => ({ fill: rect.getAttribute("fill"), opacity: rect.getAttribute("fill-opacity"), y: +rect.getAttribute("y"), height: +rect.getAttribute("height"), title: rect.textContent })), labels: [...svg.querySelectorAll('[data-trend-axis="y"] text')].map(node => node.textContent) };
      }));
      for (const id of ["cmj_height", "long_time", "long_pct", "long_unknown", "iso:iso_neck_flexion:C", "iso:iso_shoulder_externalRotation:L", "imtp_peak_force", "fms:0", "fms:1"]) {
        const chart = result.charts.find(chart => chart.id === id); assert.ok(chart.reference, id); assert.ok(chart.bands.length > 0, id);
        assert.ok(chart.bands.every(band => band.height > 0 && band.y >= 17.95 && band.y + band.height <= 57.05), id);
      }
      const unconfigured = result.charts.find(chart => chart.id === "fvp_sj:profile:slope"); assert.equal(unconfigured.bands.length, 0);
      for (const chart of result.charts) { assert.ok(Math.abs(chart.width - 160) <= .5); assert.ok(Math.abs(chart.height - 72) <= .5); assert.equal(chart.points, 3); assert.ok(chart.labels.length >= 4); }
      result.periodReferences = await page.evaluate(() => {
        const row = JSON.parse(JSON.stringify(assessmentRows.find(row => row.id === "cmj_height"))); row.id = "synthetic:period-references"; row.name = "各期评价标准不同"; row.cells[1].evaluationKey += ":changed";
        row.cells[1].display.reference = { kind: "target", target: 45, direction: "higher", unit: "cm", ranges: [{ min: null, max: 45, includeMin: false, includeMax: false, status: "amber", label: "关注" }, { min: 45, max: null, includeMin: true, includeMax: false, status: "green", label: "优秀" }] }; Object.assign(row.cells[1].display, { status: "green", label: "优秀", sourceLabel: "达到分期目标", reason: "合成分期目标 45 cm" }); Object.assign(row.cells[2].display, { reference: null, visible: false, label: "", status: "gray", sourceLabel: "未配置评价标准", reason: "合成场景：本期未配置评价标准" }); row.cells[2].assessment.target = null;
        const example = document.createElement("section"); example.id = "assessmentPeriodReferences"; example.innerHTML = "<h3>各期标准不同 · 末期未配置</h3>" + RingsideLongitudinalView.table([row], assessmentModel.periods); document.getElementById("assessmentFixture").append(example);
        RingsideLongitudinalView.layout(example);
        const chart = example.querySelector(".result-trend"), svg = chart.querySelector("svg"), projection = JSON.parse(chart.dataset.resultTrend);
        return { shared: projection.reference, references: projection.references, points: [...svg.querySelectorAll("circle")].map(circle => +circle.getAttribute("cx")), bands: [...svg.querySelectorAll('rect[fill-opacity=".075"]')].map(rect => ({ scope: rect.getAttribute("data-trend-band-scope"), index: +rect.getAttribute("data-trend-period-index"), x: +rect.getAttribute("x"), width: +rect.getAttribute("width") })), targets: [...svg.querySelectorAll('[data-trend-reference="target"]')].map(line => { const coordinates = line.getAttribute("d").match(/^M([^ ]+) [^H]+H(.+)$/); return { scope: line.getAttribute("data-trend-reference-scope"), index: +line.getAttribute("data-trend-period-index"), left: +coordinates[1], right: +coordinates[2] }; }) };
      });
      const periods = result.periodReferences; assert.equal(periods.shared, null); assert.equal(periods.references.length, 3); assert.equal(periods.references[2], null); assert.ok(periods.bands.length);
      const bounds = [[periods.points[0], (periods.points[0] + periods.points[1]) / 2], [(periods.points[0] + periods.points[1]) / 2, (periods.points[1] + periods.points[2]) / 2]];
      for (const band of periods.bands) { assert.equal(band.scope, "period"); assert.ok([0, 1].includes(band.index)); assert.ok(band.x >= bounds[band.index][0] - .02 && band.x + band.width <= bounds[band.index][1] + .02); }
      assert.equal(periods.targets.length, 2); periods.targets.forEach((target, index) => { assert.equal(target.scope, "period"); assert.equal(target.index, index); assert.ok(target.left >= bounds[index][0] - .02 && target.right <= bounds[index][1] + .02); });
      const periodShot = path.join(out, "assessment-period-references.png"); await page.locator("#assessmentPeriodReferences").screenshot({ path: periodShot }); artifact(periodShot);
      const point = page.locator('#assessmentFixture [data-metric-id="long_time"] [data-trend-point="1"]');
      await point.focus(); const tooltip = page.locator("#assessmentFixture .result-trend-tooltip"); await tooltip.waitFor({ state: "visible" });
      assert.match(await tooltip.innerText(), /2026-02-20.*9 s/); await point.press("ArrowRight"); assert.match(await tooltip.innerText(), /2026-03-20.*7 s/); await point.press("Escape"); assert.equal(await tooltip.isVisible(), false);
      const file = path.join(out, "assessment-desktop.png"); await page.locator("#assessmentFixture").screenshot({ path: file }); artifact(file);
    });
    await check("390 pixel screens keep result traffic lights readable on one line without body overflow", async () => {
      await page.setViewportSize({ width: 390, height: 900 }); await page.evaluate(() => RingsideLongitudinalView.layout(document.getElementById("assessmentFixture")));
      result.mobile = await alignments(); assertInline(result.mobile);
      const size = await page.evaluate(() => ({ view: innerWidth, body: document.documentElement.scrollWidth, tables: [...document.querySelectorAll("#assessmentFixture .table-wrap")].map(node => ({ width: node.clientWidth, scroll: node.scrollWidth, overflow: getComputedStyle(node).overflowX })) }));
      assert.ok(size.body <= size.view + 2, JSON.stringify(size)); assert.ok(size.tables.some(table => table.scroll > table.width && ["auto", "scroll"].includes(table.overflow))); result.mobileViewport = size;
      const file = path.join(out, "assessment-mobile.png"); await page.locator("#assessmentFixture").screenshot({ path: file }); artifact(file);
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => RingsideLongitudinalView.layout(document.getElementById("assessmentFixture")));
    });
    if (!process.argv.includes("--skip-pdf")) await check("actual focused PDF preserves inline labels pain priority and serialized reference bands within five pages", async () => {
      const exported = await page.evaluate(async () => {
        const source = document.getElementById("assessmentFixture"), before = source.outerHTML, original = html2canvas, capture = [], fixtureStyle = [...document.querySelectorAll("style")].find(style => style.textContent.startsWith("body>:not(#assessmentFixture)")), css = fixtureStyle.textContent; fixtureStyle.textContent = css.replace(/^body>[^}]+}/, "");
        window.html2canvas = async (node, options) => {
          const box = node.getBoundingClientRect();
          capture.push({ height: box.height, text: node.textContent, rows: [...node.querySelectorAll(".longitudinal-results tbody tr")].map(row => { const r = row.getBoundingClientRect(); return { id: row.dataset.metricId, top: r.top - box.top, bottom: r.bottom - box.top }; }), cells: [...node.querySelectorAll("td[data-record-id]")].map(cell => {
            const group = cell.querySelector(".longitudinal-result-value"), value = cell.querySelector("strong"), pill = cell.querySelector(".longitudinal-assessment"), a = value?.getBoundingClientRect(), b = pill?.getBoundingClientRect();
            return { id: cell.closest("tr").dataset.metricId, record: cell.dataset.recordId, label: pill?.textContent, status: pill?.className, inGroup: !!group?.contains(pill), value: a && { top: a.top, bottom: a.bottom, right: a.right }, pill: b && { top: b.top, bottom: b.bottom, left: b.left }, text: cell.textContent };
          }), charts: [...node.querySelectorAll(".result-trend")].map(chart => {
            const img = chart.querySelector("img"), projection = JSON.parse(chart.dataset.resultTrend), rect = chart.getBoundingClientRect(), canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(img, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, colors = [[178, 63, 61], [172, 122, 33], [24, 116, 89], [112, 134, 153]], colorPixels = [0, 0, 0, 0], periodPixels = [0, 0, 0];
            const svg = new DOMParser().parseFromString(RingsideResultDisplay.draw(projection, 160, true), "image/svg+xml"), xs = [...svg.querySelectorAll("circle")].map(point => +point.getAttribute("cx")), midpoints = [(xs[0] + xs[1]) / 2, (xs[1] + xs[2]) / 2];
            for (let p = 0; p < pixels.length; p += 4) if (pixels[p + 3] >= 17 && pixels[p + 3] <= 22) { const color = colors.findIndex(color => color.every((value, i) => Math.abs(value - pixels[p + i]) <= 12)); if (color >= 0) { colorPixels[color]++; const x = ((p / 4) % canvas.width) * 160 / canvas.width, index = x < midpoints[0] ? 0 : x < midpoints[1] ? 1 : 2; periodPixels[index]++; } }
            return { id: chart.closest("tr").dataset.metricId, image: !!img, reference: projection.reference?.kind, references: projection.references, width: rect.width, height: rect.height, bands: colorPixels.filter(count => count > 100).length, colorPixels, periodPixels, points: projection.points.length };
          }) });
          return original(node, options);
        };
        try {
          const snapshot = { ...assessmentModel.periods.at(-1).record, longitudinal: true, longitudinalDateRange: assessmentModel.periods[0].date + " — " + assessmentModel.periods.at(-1).date }, blob = await RingsidePDF.build(snapshot, source), bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          return { pdf: btoa(binary), capture, diagnostics: RingsidePDF.lastDiagnostics, unchanged: before === source.outerHTML };
        } finally { window.html2canvas = original; fixtureStyle.textContent = css; }
      });
      const file = path.join(out, "comparison-assessment.pdf"); fs.writeFileSync(file, Buffer.from(exported.pdf, "base64")); artifact(file); result.pdfCapture = exported.capture; result.pdfDiagnostics = exported.diagnostics; result.pdfPageCount = exported.capture.length;
      assert.equal(exported.unchanged, true); assert.equal(exported.diagnostics.status, "complete"); assert.ok(exported.capture.length >= 1 && exported.capture.length <= 5, String(exported.capture.length));
      const cells = exported.capture.flatMap(page => page.cells); assert.equal(cells.length, 39);
      for (const cell of cells.filter(cell => cell.pill)) {
        assert.equal(cell.inGroup, !cell.id.startsWith("asym:"), JSON.stringify(cell));
        if (cell.inGroup) { assert.ok(cell.pill.left >= cell.value.right - .5, JSON.stringify(cell)); assert.ok(Math.min(cell.pill.bottom, cell.value.bottom) > Math.max(cell.pill.top, cell.value.top), JSON.stringify(cell)); assert.ok(["预警", "关注", "优秀", "自定观察区"].includes(cell.label)); }
      }
      const forcePain = cells.filter(cell => cell.id === "iso:iso_neck_flexion:C" && cell.record !== "synthetic-period-01"); assert.equal(forcePain.length, 2); for (const cell of forcePain) { assert.match(cell.status, /\bred\b/); assert.equal(cell.label, "预警"); assert.doesNotMatch(cell.text, /录入标记：疼痛/); }
      const charts = exported.capture.flatMap(page => page.charts); assert.equal(charts.length, 13);
      for (const chart of charts) { assert.equal(chart.image, true); assert.equal(chart.points, 3); assert.ok(chart.width <= 160.5 && chart.width >= 120); assert.ok(chart.height <= 72.5 && chart.height >= 54); if (chart.reference || chart.references) assert.ok(chart.bands > 0, chart.id); }
      const periodPNG = charts.find(chart => chart.id === "synthetic:period-references"); assert.ok(periodPNG.periodPixels[0] > 100 && periodPNG.periodPixels[1] > 100); assert.ok(periodPNG.periodPixels[2] < 40, JSON.stringify(periodPNG));
      for (const page of exported.capture) assert.ok(page.rows.every(row => row.top >= -.5 && row.bottom <= page.height + .5));
    });
    await check("all source records definitions profile selections narratives and tested file hashes remain unchanged", async () => {
      assert.equal(await page.evaluate(() => assessmentBefore === JSON.stringify(assessmentData)), true); assert.deepEqual(identities(), result.sourceFiles); assert.equal(digest(__filename), result.runnerSha256);
    });
    assert.deepEqual(result.errors, []); result.pass = true;
  } catch (error) { result.errors.push(error.stack || String(error)); throw error; }
  finally { fs.writeFileSync(receipt, JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(result.checks.length + " comparison assessment browser checks passed (" + channel + ")");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
