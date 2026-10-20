"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const { chromium } = require("./helpers/playwright.cjs");
const { createFixture } = require("./helpers/longitudinal-fixture.cjs");
const root = path.resolve(__dirname, ".."), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.resolve(root, process.argv.find(arg => arg.startsWith("--artifact-dir="))?.slice(15) || "output/comparison-trend/release-v2247-pdf-isolated/polish");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const identityFiles = ["MotionBench.html", "src/ringside-model.js", "src/ringside-evaluation.js", "src/ringside-result-display.js", "src/ringside-longitudinal.js", "src/ringside-longitudinal-view.js", "src/ringside-longitudinal.css", "src/ringside-pdf.js", "tests/helpers/longitudinal-fixture.cjs", "tests/helpers/playwright.cjs"];
const identities = () => Object.fromEntries(identityFiles.map(file => [file, hash(path.join(root, file))]));

// Independent synthetic scenarios. No shared fixture, saved record, or installed profile is edited.
function polishFixture(env, base) {
  const f = base(env, 3);
  f.records.forEach((r, i) => {
    Object.keys(r.enabled).forEach(id => r.enabled[id] = ["fms", "iso"].includes(id));
    r.isoDirectionIds = ["iso_shoulder_externalRotation", "iso_shoulder_internalRotation", "iso_neck_flexion"];
    r.data.fms[0].score = [1, 3, 2][i]; r.data.fms[0].pain = false; r.data.fms[0].notes = "动作备注完整保留";
    r.data.fms[3].left = [2, 3, 2][i]; r.data.fms[3].right = 3; r.data.fms[3].pain = i === 1; r.data.fms[3].notes = "双侧动作备注保留";
    Object.assign(r.data.iso.find(q => q.id === "iso_shoulder_externalRotation"), { left: [140, 150, 160][i], right: [180, 190, 200][i], painLeft: true, painRight: false, notes: "力量原始备注保留" });
    Object.assign(r.data.iso.find(q => q.id === "iso_shoulder_internalRotation"), { left: 220, right: i === 1 ? 0 : 220, painLeft: true, painRight: false });
    Object.assign(r.data.iso.find(q => q.id === "iso_neck_flexion"), { center: 192 + i, painCenter: true });
  });
  const neck = f.profile.standards.find(q => q.directionId === "iso_neck_flexion");
  neck.enabled = false; neck.reference.enabled = false;
  const internal = f.profile.standards.find(q => q.directionId === "iso_shoulder_internalRotation");
  Object.assign(internal, { enabled: true, targetEnabled: true, target: 200, rangesEnabled: false }); internal.reference.enabled = false;
  return f;
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const receipt = path.join(out, "results.json");
  if (fs.existsSync(receipt)) fs.copyFileSync(receipt, path.join(out, "results-before-" + Date.now() + ".json"));
  const result = { synthetic: true, channel, sourceHash: hash(path.join(root, "MotionBench.html")), runnerSha256: hash(__filename), sourceFiles: identities(), version: JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), checks: [], errors: [], artifacts: [], pass: false };
  const browser = await chromium.launch({ channel, headless: true });
  const check = async (name, run) => { await run(); result.checks.push(name); console.log("PASS " + name); };
  const shot = async (page, selector, name) => { const file = path.join(out, name); await page.locator(selector).screenshot({ path: file }); result.artifacts.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: hash(file) }); };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
    page.on("pageerror", e => result.errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, "MotionBench.html")).href); await page.waitForFunction(() => App.ready);
    await page.addScriptTag({ content: "window.makePolishBase=" + createFixture.toString() + ";window.makePolishFixture=" + polishFixture.toString() });
    await page.addStyleTag({ content: "body>:not(#polishFixture):not(.ringside-pdf-stage):not(.html2canvas-container){display:none!important}#polishFixture{width:calc(100% - 40px);max-width:1160px;margin:20px auto}#polishSamples{margin-top:20px}" });
    await page.evaluate(() => {
      window.polishInput = makePolishFixture(window, makePolishBase); window.polishBefore = JSON.stringify(polishInput);
      window.polishModel = RingsideLongitudinal.build(polishInput.records, polishInput);
      const host = document.createElement("main"); host.id = "polishFixture"; host.dataset.longitudinal = "true"; document.body.append(host);
      host.innerHTML = RingsideLongitudinalView.render(polishModel).details;
      const samples = [
        { id: "polish:negative", name: "负值范围", unit: "N", values: [-250, -125, -200] },
        { id: "polish:long-unit", name: "较长单位", unit: "(N/kg)/(m/s)", values: [1.2, 1.4, 1.3] },
        { id: "polish:tiny", name: "小量级读数", unit: "s", values: [0.00012, 0.00014, 0.00013] },
        { id: "polish:large", name: "大量级读数", unit: "N", values: [12000000, 14000000, 13000000] },
        { id: "polish:percent", name: "百分数读数", unit: "%", values: [20, 25, 22] },
        { id: "polish:constant", name: "恒定读数", unit: "N", values: [20, 20, 20] }
      ].map(spec => ({ ...spec, measurementScale: "ratio", cells: spec.values.map(value => ({ value, unit: spec.unit, contextKey: "same", evaluationKey: "same", direction: "higher" })) }));
      const gallery = document.createElement("section"); gallery.id = "polishSamples"; gallery.innerHTML = "<h4>变化趋势边界示例</h4>" + RingsideLongitudinalView.table(samples, polishModel.periods); host.append(gallery);
      const sfvCases = document.createElement("section"); sfvCases.id = "polishSFVcases";
      for (const kind of ["two-dates", "two-valid", "split-context"]) {
        const fixture = makePolishBase(window, 3);
        if (kind === "two-dates") fixture.records = fixture.records.slice(0, 2);
        if (kind === "two-valid") fixture.records[1].data.fvp_sj = [];
        if (kind === "split-context") fixture.records[0].fvpConfig.fvp_sj.distanceCm = 36;
        const model = RingsideLongitudinal.build(fixture.records, fixture), row = model.projects.find(p => p.id === "fvp_sj").metrics.find(r => r.id === "fvp_sj:profile:slope"), section = document.createElement("section");
        section.dataset.sfvCase = kind; section.innerHTML = "<h4>SFV · " + kind + "</h4>" + RingsideLongitudinalView.table([row], model.periods); sfvCases.append(section);
      }
      host.append(sfvCases);
      RingsideLongitudinalView.mount(host, polishModel);
    });
    await check("all mini charts share compact dimensions readable nine-pixel axes and unclipped scale labels", async () => {
      result.charts = await page.locator("#polishFixture .result-trend svg").evaluateAll(nodes => nodes.map(svg => {
        const box = svg.getBoundingClientRect(), axis = svg.querySelector('[data-trend-axis="y"]');
        return { name: JSON.parse(svg.parentElement.dataset.resultTrend).name, width: box.width, height: box.height, viewBox: svg.getAttribute("viewBox"), scale: svg.dataset.scoreScale || "", ticks: [...axis.querySelectorAll("text")].map(n => { const r = n.getBoundingClientRect(); return { text: n.textContent, size: getComputedStyle(n).fontSize, left: r.left - box.left, right: r.right - box.left }; }) };
      }));
      assert.ok(result.charts.length >= 20); for (const chart of result.charts) {
        assert.ok(chart.width >= 120 && chart.width <= 160.5, JSON.stringify(chart)); assert.ok(Math.abs(chart.height - 72) <= .5, JSON.stringify(chart));
        assert.ok(chart.ticks.length >= 4); for (const tick of chart.ticks) { assert.equal(tick.size, "9px"); assert.ok(tick.left >= -1 && tick.right <= chart.width + 1, JSON.stringify(chart)); }
      }
      const fms = result.charts.filter(c => c.scale === "0-3"); assert.equal(fms.length, 7); for (const chart of fms) assert.deepEqual(chart.ticks.slice(1).map(t => t.text), ["0", "1", "2", "3"]);
      result.sfv = await page.locator("#polishSFVcases .result-trend").evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(), cell = node.closest("td").getBoundingClientRect(), projection = JSON.parse(node.dataset.resultTrend); return { kind: node.closest("[data-sfv-case]").dataset.sfvCase, width: box.width, height: box.height, left: box.left - cell.left, points: projection.points.length, valid: projection.points.filter(p => p.value !== null).length }; }));
      assert.equal(result.sfv.length, 4); assert.deepEqual(result.sfv.filter(c => c.kind === "split-context").map(c => c.valid).sort(), [1, 2]); assert.equal(result.sfv.find(c => c.kind === "two-valid").valid, 2);
      for (const chart of result.sfv) { assert.ok(Math.abs(chart.width - 160) <= .5, JSON.stringify(chart)); assert.ok(Math.abs(chart.height - 72) <= .5); assert.ok(Math.abs(chart.left - result.sfv[0].left) <= .5, JSON.stringify(result.sfv)); }
    });
    const fmsAlignment = async () => page.locator('#polishFixture [data-metric-id^="fms:"] td[data-record-id]').evaluateAll(cells => cells.map(cell => {
      const group = cell.querySelector(".longitudinal-result-value"), score = group?.querySelector("strong"), pill = group?.querySelector(".longitudinal-assessment"), a = score?.getBoundingClientRect(), b = pill?.getBoundingClientRect();
      return { value: score?.textContent, label: pill?.textContent, display: group && getComputedStyle(group).display, score: a && { top: a.top, bottom: a.bottom, right: a.right }, pill: b && { top: b.top, bottom: b.bottom, left: b.left }, text: cell.textContent };
    }));
    const assertAlignment = cells => { assert.equal(cells.length, 21); for (const cell of cells) { assert.equal(cell.display, "flex"); assert.ok(cell.score && cell.pill, JSON.stringify(cell)); assert.ok(cell.pill.left >= cell.score.right - .5, JSON.stringify(cell)); assert.ok(Math.min(cell.score.bottom, cell.pill.bottom) > Math.max(cell.score.top, cell.pill.top), JSON.stringify(cell)); } };
    await check("desktop FMS scores and traffic lights share a line while side scores and original notes remain", async () => {
      result.desktopFMS = await fmsAlignment(); assertAlignment(result.desktopFMS);
      assert.match(await page.locator('#polishFixture [data-metric-id="fms:0"]').innerText(), /动作备注完整保留/);
      const bilateral = await page.locator('#polishFixture [data-metric-id="fms:3"]').innerText(); assert.match(bilateral, /左侧 2 \/ 右侧 3/); assert.match(bilateral, /双侧动作备注保留/);
      const painful = page.locator('#polishFixture [data-metric-id="fms:3"] td[data-record-id="synthetic-period-02"]'); assert.equal(await painful.locator("strong").innerText(), "0"); assert.equal(await painful.locator(".longitudinal-assessment.red").count(), 1); assert.match(await painful.innerText(), /疼痛/); assert.match(await painful.innerText(), /左侧 3 \/ 右侧 3/); assert.match(await painful.innerText(), /双侧动作备注保留/);
    });
    await check("recorded pain stays separate from target and asymmetry evaluation for three real isometric cases", async () => {
      result.painCases = await page.evaluate(() => {
        const noPain = JSON.parse(JSON.stringify(polishInput)); noPain.records.forEach(r => r.data.iso.forEach(row => { row.painLeft = false; row.painRight = false; row.painCenter = false; }));
        const control = RingsideLongitudinal.build(noPain.records, noPain), ids = ["iso:iso_shoulder_externalRotation:L", "iso:iso_shoulder_internalRotation:L", "iso:iso_neck_flexion:C"], find = (m, id) => m.projects.find(p => p.id === "iso").metrics.find(r => r.id === id).cells[0];
        return { rows: ids.map(id => { const cell = find(polishModel, id), clean = find(control, id), node = document.querySelector('#polishFixture [data-metric-id="' + id + '"] td[data-record-id]'); return { id, pain: cell.pain, display: cell.display, cleanDisplay: clean.display, pills: [...node.querySelectorAll(".longitudinal-assessment")].map(n => n.textContent), text: node.textContent }; }), risks: polishModel.periods.map(p => p.stats.signals.regions), noPainRisks: control.periods.map(p => p.stats.signals.regions) };
      });
      for (const row of result.painCases.rows) { assert.equal(row.pain, true); assert.deepEqual(row.display, row.cleanDisplay); assert.ok(row.pills.every(p => !p.includes("疼痛"))); assert.match(row.text, /录入标记：疼痛/); }
      assert.ok(result.painCases.rows.every(row => row.pills.every(p => !p.includes("双侧差异")))); assert.ok(result.painCases.rows[1].display.visible); assert.equal(result.painCases.rows[1].display.status, "green"); assert.equal(result.painCases.rows[2].pills.length, 0);
      assert.match(await page.locator('#polishFixture [data-iso-section="asymmetry"]').innerText(), /22.22/);
      assert.ok(result.painCases.risks.some(regions => Object.values(regions).some(r => r.status === "red"))); assert.notDeepEqual(result.painCases.risks, result.painCases.noPainRisks);
    });
    await check("absent pairs and selected pairs without any valid ratio both omit the joint balance section", async () => {
      result.emptyBalances = await page.evaluate(() => ["unselected", "invalid"].map(kind => {
        const input = JSON.parse(JSON.stringify(polishInput)); input.records.forEach(r => { if (kind === "unselected") r.isoDirectionIds = ["iso_shoulder_externalRotation"]; else { r.isoDirectionIds = ["iso_shoulder_externalRotation", "iso_shoulder_internalRotation"]; Object.assign(r.data.iso.find(row => row.id === "iso_shoulder_internalRotation"), { left: 0, right: 0 }); } });
        const before = JSON.stringify(input), model = RingsideLongitudinal.build(input.records, input), host = document.createElement("div"); host.innerHTML = RingsideLongitudinalView.render(model).details;
        return { kind, sections: host.querySelectorAll('[data-iso-section="balance"]').length, captions: [...host.querySelectorAll(".longitudinal-table-caption")].map(n => n.textContent), unchanged: before === JSON.stringify(input) };
      })); for (const scenario of result.emptyBalances) { assert.equal(scenario.sections, 0); assert.ok(!scenario.captions.includes("关节平衡")); assert.equal(scenario.unchanged, true); }
    });
    await check("partly valid joint balance preserves all dates original ratios and the invalid denominator reason", async () => {
      const info = await page.evaluate(() => {
        const rows = polishModel.projects.find(p => p.id === "iso").metrics.filter(r => r.section === "balance" && r.pairId === "shoulder_IR_ER");
        return { rows: rows.map(r => ({ id: r.id, values: r.cells.map(c => c?.value), expected: polishModel.periods.map(p => p.stats.balanceResults.find(b => b.id === r.pairId)?.results.find(c => c.side === r.cells.find(Boolean).context.side)?.value) })), text: document.querySelector('#polishFixture [data-iso-section="balance"]').textContent, dates: [...document.querySelectorAll('#polishFixture [data-iso-section="balance"] th')].map(n => n.textContent) };
      }); assert.equal(info.rows.length, 2); for (const row of info.rows) assert.deepEqual(row.values, row.expected); assert.equal(info.rows.find(r => r.id.endsWith(":R")).values[1], null); assert.match(info.text, /分母为零/); for (const date of ["2026-01-20", "2026-02-20", "2026-03-20"]) assert.ok(info.dates.includes(date)); result.balance = info;
    });
    await shot(page, "#polishFixture #detail-fms", "fms-desktop.png"); await shot(page, "#polishFixture #detail-iso", "iso-desktop.png"); await shot(page, "#polishSamples", "trend-edgecases-desktop.png"); await shot(page, "#polishSFVcases", "sfv-cases-desktop.png");
    await check("390 pixel screens preserve inline FMS results and scroll only their result tables", async () => {
      await page.setViewportSize({ width: 390, height: 900 }); await page.evaluate(() => RingsideLongitudinalView.layout(document.getElementById("polishFixture")));
      result.mobileFMS = await fmsAlignment(); assertAlignment(result.mobileFMS);
      const state = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, tables: [...document.querySelectorAll('#polishFixture #detail-fms .table-wrap')].map(node => ({ width: node.clientWidth, scroll: node.scrollWidth, overflow: getComputedStyle(node).overflowX })) }));
      assert.ok(state.body <= state.width + 2, JSON.stringify(state)); assert.ok(state.tables.some(t => t.scroll > t.width && ["auto", "scroll"].includes(t.overflow))); result.mobile = state;
      await shot(page, "#polishFixture #detail-fms", "fms-mobile.png"); await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => RingsideLongitudinalView.layout(document.getElementById("polishFixture")));
    });
    if (!process.argv.includes("--skip-pdf")) await check("actual focused PDF preserves inline FMS grades compact charts and partial balance reasons within six pages", async () => {
      const data = await page.evaluate(async () => {
        const source = document.createElement("section"); source.dataset.longitudinal = "true"; source.innerHTML = "<h2>纵向比较 · 本次优化合成验收</h2>";
        for (const [title, selector] of [["FMS 动作评分", '#polishFixture #detail-fms .longitudinal-table'], ["等长力量", '#polishFixture #detail-iso .longitudinal-iso-section'], ["坐标边界示例", '#polishSamples .longitudinal-table'], ["SFV 稀疏有效数据", '#polishSFVcases .longitudinal-table']]) { const heading = document.createElement("h3"); heading.textContent = title; source.append(heading); document.querySelectorAll(selector).forEach(n => source.append(n.cloneNode(true))); }
        document.body.append(source); const before = source.outerHTML, renderer = html2canvas, capture = [], fixtureStyle = [...document.querySelectorAll("style")].find(s => s.textContent.startsWith("body>:not(#polishFixture)")), css = fixtureStyle.textContent; fixtureStyle.textContent = css.replace(/^body>[^}]+}/, "");
        window.html2canvas = async (node, options) => {
          const box = node.getBoundingClientRect();
          capture.push({ height: box.height, text: node.textContent, rows: [...node.querySelectorAll(".longitudinal-results tr")].map(n => { const r = n.getBoundingClientRect(); return { top: r.top - box.top, bottom: r.bottom - box.top }; }), fms: [...node.querySelectorAll('[data-metric-id^="fms:"] td[data-record-id]')].map(cell => { const value = cell.querySelector(".longitudinal-result-value strong"), badge = cell.querySelector(".longitudinal-result-value .longitudinal-assessment"), score = value?.getBoundingClientRect(), pill = badge?.getBoundingClientRect(); return { id: cell.closest("tr").dataset.metricId, record: cell.dataset.recordId, value: value?.textContent, status: badge?.className, text: cell.textContent, score: score && { top: score.top, bottom: score.bottom, right: score.right }, pill: pill && { top: pill.top, bottom: pill.bottom, left: pill.left } }; }), forces: [...node.querySelectorAll('[data-metric-id^="iso:"] td[data-record-id]')].map(cell => ({ text: cell.textContent, pills: [...cell.querySelectorAll(".longitudinal-assessment")].map(n => n.textContent), neutralSymptom: !!cell.querySelector(".longitudinal-symptom"), alarmingSymptom: !!cell.querySelector("small.red") })), charts: [...node.querySelectorAll(".result-trend")].map(n => { const img = n.querySelector("img"), r = n.getBoundingClientRect(), cell = n.closest("td").getBoundingClientRect(); return { image: !!img, width: r.width, height: r.height, left: r.left - cell.left, source: img?.src, name: JSON.parse(n.dataset.resultTrend).name, points: JSON.parse(n.dataset.resultTrend).points.length }; }) });
          return renderer(node, options);
        };
        try { const snapshot = { ...polishModel.periods.at(-1).record, longitudinal: true, longitudinalDateRange: polishModel.periods[0].date + " — " + polishModel.periods.at(-1).date }, blob = await RingsidePDF.build(snapshot, source), bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return { pdf: btoa(binary), capture, diagnostics: RingsidePDF.lastDiagnostics, unchanged: source.outerHTML === before }; } finally { window.html2canvas = renderer; fixtureStyle.textContent = css; source.remove(); }
      });
      assert.equal(data.unchanged, true); assert.equal(data.diagnostics.status, "complete"); assert.ok(data.capture.length >= 1 && data.capture.length <= 6, String(data.capture.length));
      const cells = data.capture.flatMap(p => p.fms); assert.equal(cells.length, 21); for (const cell of cells) { assert.ok(cell.score && cell.pill); assert.ok(cell.pill.left >= cell.score.right - .5); assert.ok(Math.min(cell.score.bottom, cell.pill.bottom) > Math.max(cell.score.top, cell.pill.top)); }
      const fmsPain = cells.find(cell => cell.id === "fms:3" && cell.record === "synthetic-period-02"); assert.equal(fmsPain.value, "0"); assert.match(fmsPain.status, /\bred\b/); assert.match(fmsPain.text, /疼痛.*左侧 3 \/ 右侧 3/);
      const forces = data.capture.flatMap(p => p.forces); assert.ok(forces.some(c => c.neutralSymptom)); for (const cell of forces) { assert.ok(cell.pills.every(label => !/疼痛|双侧差异/.test(label))); assert.equal(cell.alarmingSymptom, false); }
      for (const p of data.capture) assert.ok(p.rows.every(r => r.top >= -.5 && r.bottom <= p.height + .5));
      const charts = data.capture.flatMap(p => p.charts); assert.ok(charts.length >= 20); for (const chart of charts) { assert.equal(chart.image, true); assert.ok([2, 3].includes(chart.points)); assert.ok(chart.width <= 160.5 && chart.width >= 120); assert.ok(chart.height <= 72.5 && chart.height >= 54); assert.ok(chart.source?.startsWith("data:image/")); }
      const sfv = charts.filter(c => /SFV/.test(c.name)); assert.equal(sfv.length, 4); for (const chart of sfv) { assert.ok(Math.abs(chart.width - 160) <= .5); assert.ok(Math.abs(chart.left - sfv[0].left) <= .5, JSON.stringify(sfv)); }
      const text = data.capture.map(p => p.text).join(""); assert.match(text, /分母为零/); assert.match(text, /录入标记：疼痛/); assert.match(text, /动作备注完整保留/);
      const pdf = path.join(out, "comparison-polish.pdf"); fs.writeFileSync(pdf, Buffer.from(data.pdf, "base64")); result.artifacts.push({ file: path.relative(root, pdf).replaceAll("\\", "/"), sha256: hash(pdf) });
      result.pdfCapture = data.capture.map(p => ({ ...p, charts: p.charts.map(({ source, ...chart }) => chart) })); result.pdfDiagnostics = data.diagnostics;
    });
    await check("all source measurements pain flags schemes selections and manual narratives remain unchanged", async () => {
      assert.equal(await page.evaluate(() => JSON.stringify(polishInput) === polishBefore), true); assert.deepEqual(identities(), result.sourceFiles); assert.equal(hash(__filename), result.runnerSha256);
    });
    assert.deepEqual(result.errors, []); result.pass = true;
  } catch (e) { result.errors.push(e.stack || String(e)); throw e; }
  finally { fs.writeFileSync(receipt, JSON.stringify(result, null, 2)); await browser.close(); }
  console.log(result.checks.length + " comparison polish browser checks passed (" + channel + ")");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
