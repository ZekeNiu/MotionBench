"use strict";
// Isolated synthetic profiles only. Never attach this runner to a user window.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { execFileSync } = require("node:child_process");
const { chromium, _electron } = require("./helpers/playwright.cjs");
const { desktopArtifactIdentity } = require("./helpers/desktop-artifact-identity.cjs");
const ROOT = path.resolve(__dirname, ".."), native = process.argv.includes("--desktop");
const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
const SOURCE = path.resolve(ROOT, arg("--source") || "MotionBench.html");
const OUT = path.resolve(ROOT, arg("--artifact-dir") || "output/implementation-2.24.13/" + (native ? "native" : "focused"));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function seedMedicineBall() {
  const M = RingsideModel, E = RingsideEvaluation, lib = M.libraryDefaults(), records = [], profiles = [];
  for (let index = 0; index < 3; index++) {
    const record = M.sampleRecord(); record.demo = false;
    record.athleteId = "synthetic-medicine-ball-athlete"; record.recordId = "synthetic-medicine-ball-" + index;
    record.athlete.name = "药球表格合成验收"; record.athlete.date = "2026-0" + (index + 1) + "-20";
    record.created = "2026-01-01T00:00:00.000Z"; record.mode = index === 1 ? "best" : "mean";
    for (const id of Object.keys(record.enabled)) record.enabled[id] = id === "mb";
    const trial = (side, distance, i) => ({ id: "ball-" + index + "-" + side + "-" + i, side, distance, notes: (side === "D" ? "优势侧" : "非优势侧") + "原始备注 " + (i + 1) });
    record.data.mb = index === 0 ? [8, 10, 12].map((value, i) => trial("D", value, i)).concat([5, 7, 9].map((value, i) => trial("ND", value, i)))
      : index === 1 ? [10, 12].map((value, i) => trial("D", value, i))
        : [trial("D", 9, 0), trial("ND", 7, 0)];
    record.protocol.mb = "3 kg 单手后手投掷；第一落点；原测试协议完整保留";
    for (const d of record.definitions.filter(d => d.testId === "mb")) Object.assign(d, { referenceEnabled: index !== 2, targetEnabled: index !== 2, target: d.id === "mb_dom" ? 10 : 8, ranges: Def.parseRanges("<8 | 原低段 | red\n8..11 | 原中段 | amber\n>11 | 原高段 | green") });
    if (index === 0) {
      record.definitions.push({ id: "mb_session_note", testId: "mb", name: "手工补充指标", unit: "分", entryScope: "record", measurementScale: "ordinal", category: "performance", ability: "旋转投掷能力", direction: "higher", referenceEnabled: false, scoring: false, ranges: [], source: "原手工指标来源", protocol: "原手工指标协议" });
      record.customValues.mb_session_note = { value: 4, notes: "手工补充指标原始说明" };
    }
    record.narrative = { text: "第 " + (index + 1) + " 期人工药球解读完整保留。", html: "<p>第 " + (index + 1) + " 期人工药球解读完整保留。</p>", origin: "manual", revision: 1, basis: M.fingerprint(record) };
    M.applyAge(record); const profile = E.create(record, "药球独立合成评价 " + index); profiles.push(profile); record.evaluationProfileId = profile.id; records.push(record);
  }
  lib.catalog = M.mergeCatalog(null, records[0]); lib.evaluationProfiles = profiles; lib.defaultEvaluationProfileId = profiles[0].id;
  lib.athletes = [{ id: records[0].athleteId, name: records[0].athlete.name, profile: M.profileFromRecord(records[0]), groupId: "", records, archived: false, deletedAt: null }];
  lib.activeAthleteId = records[0].athleteId; lib.activeRecordId = records[0].recordId;
  await App.importPayload(lib, "replace-library"); await App.showReport(false); await App.saveNow(); return records.map(r => r.recordId);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sourceFiles = Object.fromEntries(fs.readdirSync(path.join(ROOT, "src")).filter(n => /\.(?:js|css)$/.test(n)).sort().map(n => ["src/" + n, hash(path.join(ROOT, "src", n))]));
  const result = { synthetic: true, channel: native ? "desktop" : "chrome", sourceHash: hash(SOURCE), runnerSha256: hash(__filename), sourceFiles, desktop: native, startedAt: new Date().toISOString(), checks: [], errors: [], artifacts: [], pass: false };
  if (arg("--expected-source-hash")) assert.equal(result.sourceHash, arg("--expected-source-hash"));
  const receipt = path.join(OUT, "results.json"); if (fs.existsSync(receipt)) fs.copyFileSync(receipt, path.join(OUT, "results-before-" + Date.now() + ".json"));
  let browser, electron, page, temporary, ids, baseline; const contexts = [];
  const executable = process.env.MOTIONBENCH_EXECUTABLE || require("electron");
  const artifact = file => result.artifacts.push({ file: path.relative(ROOT, file).replaceAll("\\", "/"), sha256: hash(file), bytes: fs.statSync(file).size });
  const watch = p => { p.setDefaultTimeout(30000); p.on("pageerror", error => result.errors.push(error.stack || error.message)); p.on("dialog", dialog => dialog.accept()); };
  const ready = async p => { await p.waitForFunction(() => window.App?.ready); assert.equal(await p.evaluate(() => App.ready), true); };
  const check = async (name, run) => { result.stage = name; console.log("START " + name); await run(); result.checks.push(name); console.log("PASS " + name); };
  const openBrowser = async file => {
    browser ||= await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" }); contexts.push(context);
    const p = await context.newPage(); watch(p); await p.goto(pathToFileURL(file).href); await ready(p); return p;
  };
  const startNative = async () => {
    const env = { ...process.env, MOTIONBENCH_TEST_EXPORT_DIR: path.join(temporary, "downloads") }; delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({ executablePath: executable, args: [...(process.env.MOTIONBENCH_EXECUTABLE ? [] : [ROOT]), "--motionbench-test", "--motionbench-data-dir=" + temporary], cwd: ROOT, env, timeout: 60000 });
    page = await electron.firstWindow(); watch(page); await ready(page);
    assert.equal(path.resolve(await electron.evaluate(({ app }) => app.getPath("userData"))), path.resolve(temporary));
    await electron.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(320, 320); w.setContentSize(1440, 1000); });
    result.identity ||= desktopArtifactIdentity(ROOT, executable, __filename); assert.equal(result.identity.runtimeMatchesSourceHtml, true);
    result.versions = await page.evaluate(() => ({ desktop: MotionBenchDesktop.version, web: MotionBenchDesktop.webVersion, build: RingsideBuild.version }));
  };
  const closeNative = async () => {
    assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true);
    const closed = electron.waitForEvent("close", { timeout: 60000 }); await electron.evaluate(({ BrowserWindow }) => setImmediate(() => BrowserWindow.getAllWindows()[0].close())); await closed; electron = null;
  };
  const snapshot = p => p.evaluate(async () => {
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map(v => v.toString(16).padStart(2, "0")).join("");
    const library = await App.getRepository().exportLibrary(), records = structuredClone(library.athletes);
    for (const athlete of records) for (const r of athlete.records) { delete r.views; delete r.fvpView; delete r.sprintFvpView; delete r.updated; }
    return { records: await digest(records), shared: await digest({ catalog: library.catalog, profiles: library.evaluationProfiles, groups: library.groups, plans: library.testPlans }), narratives: library.athletes.flatMap(a => a.records.map(r => ({ id: r.recordId, narrative: r.narrative, previousNarrative: r.previousNarrative }))) };
  });
  const invariant = async () => { const now = await snapshot(page); assert.deepEqual(now, baseline, "source records, conditions, reference schemes and prose stay exact"); return now; };
  const projection = p => p.evaluate(() => {
    const stored = App.getState(), r = RingsideEvaluation.materialize(stored, App.getLibrary().evaluationProfiles.find(p => p.id === stored.evaluationProfileId));
    return { recordId: r.recordId, mode: r.mode, enabled: r.enabled, data: r.data, protocol: r.protocol, narrative: r.narrative, values: App.stats().values, definitions: r.definitions };
  });
  const select = async id => { assert.equal(await page.evaluate(id => App.selectRecords([id]), id), true); await page.evaluate(() => App.showReport(false)); assert.equal(await page.evaluate(() => App.saveNow()), true); };
  const reveal = async () => { await page.locator("#detail-mb").evaluate(node => { for (let p = node.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true; }); };
  const row = id => page.locator(`#detail-mb tr[data-metric-id="${id}"]`);
  const tableState = async () => page.locator('#detail-mb tr[data-metric-id="mb_dom"]').evaluate(node => { const table = node.closest("table"); return { headers: [...table.querySelectorAll("thead th")].map(n => n.textContent.trim()), rows: [...table.querySelectorAll("tbody tr")].map(n => ({ id: n.dataset.metricId, cells: Object.fromEntries([...n.querySelectorAll("td")].map(td => [td.dataset.label, td.textContent.trim()])) })) }; });
  const shot = async name => { await reveal(); const file = path.join(OUT, name + ".png"); await page.locator("#detail-mb").screenshot({ path: file }); artifact(file); };
  const download = async (kind, name) => { const waiting = page.waitForEvent("download", { timeout: 240000 }); waiting.catch(() => {}); await page.evaluate(kind => App["download" + kind](), kind); const item = await waiting; assert.equal(await item.failure(), null); const file = path.join(OUT, name + "." + kind.toLowerCase()); await item.saveAs(file); artifact(file); return file; };
  const assertDual = async () => {
    await reveal(); const state = await tableState();
    assert.deepEqual(state.headers, ["指标", "结果", "均值 ± SD", "CV", "评价", "参考目标"]); assert.deepEqual(state.rows.map(r => r.id), ["mb_dom", "mb_non"]);
    assert.equal(state.rows[0].cells["结果"], "10.00"); assert.equal(state.rows[1].cells["结果"], "7.00");
    assert.match(state.rows[0].cells["均值 ± SD"], /10\.00\s*±\s*2\.00/); assert.match(state.rows[1].cells["均值 ± SD"], /7\.00\s*±\s*2\.00/);
    assert.match(state.rows[0].cells.CV, /20\.0%/); assert.match(state.rows[1].cells.CV, /28\.6%/);
    assert.equal(state.rows[0].cells["参考目标"], "10.00 m"); assert.equal(state.rows[1].cells["参考目标"], "8.00 m");
    assert.doesNotMatch(await page.locator("#detail-mb").innerText(), /目标对照|达成比例|距参考目标|超过参考目标|达到参考目标/);
    assert.equal(await page.locator("#detail-mb svg,#detail-mb img").count(), 0); assert.equal(await row("mb_dom").locator(".pill.amber").count(), 1);
    assert.match(await page.locator("#detail-mb").innerText(), /手工补充指标原始说明/); assert.equal(await row("mb_session_note").count(), 1);
    const raw = page.locator('#detail-mb [data-raw-trials="mb"]'); assert.equal(await raw.count(), 1); assert.equal(await raw.locator("tbody tr").count(), 6);
    await invariant(); return state;
  };
  const assertSingle = async () => {
    await reveal(); const state = await tableState(); assert.deepEqual(state.headers, ["指标", "结果", "单位", "评价", "参考目标"]); assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0].cells["结果"], "12.00"); assert.equal(state.rows[0].cells["单位"], "m");
    assert.equal(state.rows[0].cells["参考目标"], "10.00 m");
    assert.doesNotMatch(await page.locator("#detail-mb").innerText(), /目标对照|达成比例|距参考目标|超过参考目标|达到参考目标/);
    assert.equal(await row("mb_non").count(), 0); assert.equal(await page.locator("#detail-mb svg,#detail-mb img").count(), 0);
    assert.equal(await page.locator('#detail-mb [data-raw-trials="mb"] tbody tr').count(), 2); await invariant(); return state;
  };
  try {
    if (native) { temporary = fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-ball-table-")); await startNative(); }
    else page = await openBrowser(SOURCE);
    await check("isolated dual-side mean report renders one table with original grades references repeated statistics and raw trials", async () => {
      ids = await page.evaluate(seedMedicineBall); baseline = await snapshot(page); result.dual = await assertDual(); await shot("dual-side-desktop");
    });
    await check("single-side best report uses ordinary result columns without an invented second side short-sample statistics or extra target interpretation", async () => {
      await select(ids[1]); result.single = await assertSingle(); await shot("single-side-desktop");
    });
    if (native) {
      await check("packaged save close and reopen preserve the table source records and manual narrative", async () => {
        const before = await projection(page); await closeNative(); await startNative(); assert.deepEqual(await projection(page), before); await assertSingle(); await invariant();
      });
      result.finalIdentity = desktopArtifactIdentity(ROOT, executable, __filename); assert.deepEqual(result.finalIdentity, result.identity);
    } else {
      await check("disabled reference standards leave measured values intact without invented badges targets or comparisons", async () => {
        await select(ids[2]); await reveal(); const state = await tableState(); assert.equal(state.rows.length, 2); assert.equal(state.rows[0].cells["结果"], "9.00"); assert.equal(state.rows[1].cells["结果"], "7.00");
        for (const r of state.rows) assert.equal(r.cells["参考目标"], "—");
        assert.equal(await page.locator("#detail-mb .pill").count(), 0); assert.doesNotMatch(await page.locator("#detail-mb").innerText(), /NaN|Infinity|目标对照|达成比例|距参考目标|超过参考目标|达到参考目标/); result.ungraded = state; await invariant();
      });
      await check("1440 and 390 pixel single and dual-side tables keep every result and reference without horizontal page overflow", async () => {
        result.responsive = [];
        for (const index of [0, 1]) for (const width of [1440, 390]) {
          await select(ids[index]); await page.setViewportSize({ width, height: 1000 }); await reveal();
          // Resize transitions move the workspace for 200 ms. Measure the final
          // layout rather than a transient narrow column during that movement.
          await page.evaluate(async () => { const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await frame(); await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); await frame(); });
          const geometry = await page.locator("#detail-mb").evaluate(node => {
            const table = node.querySelector('tr[data-metric-id="mb_dom"]').closest("table"), wrapper = table.closest(".table-wrap");
            return { viewport: innerWidth, page: document.documentElement.scrollWidth, table: table.getBoundingClientRect().toJSON(), wrapper: { width: wrapper.clientWidth, scrollWidth: wrapper.scrollWidth }, rows: [...node.querySelectorAll('tr[data-metric-id="mb_dom"],tr[data-metric-id="mb_non"]')].map(row => ({ id: row.dataset.metricId, metricWidth: row.querySelector('td[data-label="指标"]').getBoundingClientRect().width, visible: [...row.querySelectorAll("td")].every(td => td.getBoundingClientRect().width > 0 && getComputedStyle(td).visibility !== "hidden") })) };
          });
          result.responsive.push({ recordId: ids[index], ...geometry }); assert.ok(geometry.page <= width + 1); assert.equal(geometry.rows.length, index === 0 ? 2 : 1); assert.ok(geometry.rows.every(r => r.visible)); assert.ok(geometry.table.right <= width + 1);
          if (width === 390) { assert.ok(geometry.wrapper.scrollWidth <= geometry.wrapper.width + 1, "all result columns remain readable without horizontal table scrolling"); assert.ok(geometry.rows.every(r => r.metricWidth >= 120), "metric names have room for ordinary words rather than one character per line"); }
          await shot((index === 0 ? "dual" : "single") + "-side-" + width); await invariant();
        }
        await page.setViewportSize({ width: 1440, height: 1000 }); await select(ids[0]);
      });
      await check("JSON editable HTML and reload reproduce the personal table calculations references protocols and prose", async () => {
        const expected = await projection(page);
        for (const kind of ["JSON", "HTML"]) {
          const file = await download(kind, "medicine-ball-preserved"), restored = await openBrowser(kind === "HTML" ? file : SOURCE);
          try { if (kind === "JSON") await restored.evaluate(async payload => { await App.importPayload(payload, "replace-library"); await App.showReport(false); }, JSON.parse(fs.readFileSync(file, "utf8"))); assert.deepEqual(await projection(restored), expected); assert.equal(await restored.locator("#detail-mb svg,#detail-mb img").count(), 0); }
          finally { await restored.close(); }
        }
        await page.reload(); await ready(page); assert.deepEqual(await projection(page), expected); await assertDual(); await invariant();
      });
      await check("comparison keeps its native medicine-ball bar charts matrix and all original per-period raw trials", async () => {
        assert.equal(await page.evaluate(ids => App.selectRecords(ids), ids.slice(0, 2)), true); await page.evaluate(() => App.showReport(false)); await reveal();
        assert.equal(await page.evaluate(() => App.getLongitudinal().periods.length), 2);
        const specs = await page.locator("#detail-mb [data-longitudinal-chart]").evaluateAll(nodes => nodes.map(n => JSON.parse(n.dataset.longitudinalChart)));
        assert.equal(specs.length, 3); assert.ok(specs.every(s => s.kind === "bars")); assert.ok(await page.locator("#detail-mb svg").count());
        assert.equal(await page.locator("#detail-mb .longitudinal-results tbody tr").count(), 3); assert.equal(await page.locator('#detail-mb [data-raw-trials="mb"] .longitudinal-raw-period').count(), 2);
        const rawText = await page.locator('#detail-mb [data-raw-trials="mb"]').textContent(); assert.match(rawText, /优势侧原始备注 3/); assert.match(rawText, /非优势侧原始备注 3/);
        result.comparison = { chartKinds: specs.map(s => s.kind), rawPeriods: 2 }; await invariant(); await select(ids[0]); await assertDual();
      });
      await check("actual App PDF export retains the focused medicine-ball table and raw trials without charts row loss or clipping in one or two pages", async () => {
        await reveal(); await page.evaluate(() => {
          const actualBuild = RingsidePDF.build, actualCanvas = html2canvas; window.__medicinePDFRestore = () => { RingsidePDF.build = actualBuild; window.html2canvas = actualCanvas; }; window.__medicinePDFPages = [];
          RingsidePDF.build = (record, report, options) => { const section = report.querySelector("#detail-mb").cloneNode(true); report.replaceChildren(section); return actualBuild(record, report, options); };
          window.html2canvas = async (node, options) => { const body = node.querySelector(".ringside-pdf-content"), box = body.getBoundingClientRect(); __medicinePDFPages.push({ text: body.textContent, rowIds: [...body.querySelectorAll("tr[data-metric-id]")].map(n => n.dataset.metricId), charts: body.querySelectorAll("img[data-pdf-chart],svg").length, controls: body.querySelectorAll("button,input,select,textarea,.no-print").length, overflow: [...body.children].filter(n => n.getBoundingClientRect().bottom > box.bottom + .8).map(n => n.className), headerSets: [...body.querySelectorAll("thead")].map(n => [...n.querySelectorAll("th")].map(th => th.textContent.trim())) }); return actualCanvas(node, options); };
        });
        let file; try { file = await download("PDF", "medicine-ball-focused"); result.pdf = await page.evaluate(() => ({ diagnostics: RingsidePDF.lastDiagnostics, pages: __medicinePDFPages })); } finally { await page.evaluate(() => __medicinePDFRestore()); }
        assert.equal(result.pdf.diagnostics.status, "complete"); assert.ok(result.pdf.diagnostics.pageCount >= 1 && result.pdf.diagnostics.pageCount <= 2); assert.equal(result.pdf.pages.length, result.pdf.diagnostics.pageCount);
        for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(result.pdf.diagnostics[key], []);
        const allRows = result.pdf.pages.flatMap(p => p.rowIds); for (const id of ["mb_dom", "mb_non", "mb_session_note"]) assert.equal(allRows.filter(value => value === id).length, 1, id);
        for (const p of result.pdf.pages) { assert.equal(p.charts, 0); assert.equal(p.controls, 0); assert.deepEqual(p.overflow, []); }
        const text = result.pdf.pages.map(p => p.text).join("\n"); for (const value of ["药球反手投掷", "均值 ± SD", "CV", "参考目标", "优势侧原始备注 3", "非优势侧原始备注 3", "手工补充指标原始说明"]) assert.ok(text.includes(value), value);
        assert.doesNotMatch(text, /目标对照|达成比例|距参考目标|超过参考目标|达到参考目标/);
        assert.ok(result.pdf.pages.flatMap(p => p.headerSets).some(headers => JSON.stringify(headers) === JSON.stringify(result.dual.headers)));
        const renderer = "import sys,json;from pathlib import Path;import pymupdf; p=Path(sys.argv[1]);d=pymupdf.open(p);out=[]\nfor i,page in enumerate(d):\n f=p.parent/('medicine-ball-focused-page-%02d.png'%(i+1));page.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5),alpha=False).save(str(f));out.append(str(f))\nprint(json.dumps(out))";
        const pngs = JSON.parse(execFileSync("python", ["-c", renderer, file], { cwd: ROOT, encoding: "utf8" })); for (const png of pngs) artifact(png); result.pdf.renderedPages = pngs.map(p => path.relative(ROOT, p).replaceAll("\\", "/")); result.pdfPageCount = pngs.length; await invariant();
      });
    }
    assert.equal(result.checks.length, native ? 3 : 7); assert.deepEqual(result.errors, []); assert.equal(hash(SOURCE), result.sourceHash); assert.equal(hash(__filename), result.runnerSha256);
    for (const [file, digest] of Object.entries(sourceFiles)) assert.equal(hash(path.join(ROOT, file)), digest);
    result.invariants = { before: baseline, after: await snapshot(page) }; result.pass = true;
  } catch (error) {
    result.errors.push(error.stack || String(error)); process.exitCode = 1; console.error(error.stack || error);
    if (page && !page.isClosed()) {
      result.failureGeometry = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, active: App.getState().recordId, overflow: [...document.querySelectorAll("body *")].map(n => ({ tag: n.tagName, id: n.id, className: String(n.className || ""), rect: n.getBoundingClientRect().toJSON(), scrollWidth: n.scrollWidth, clientWidth: n.clientWidth, display: getComputedStyle(n).display, overflow: getComputedStyle(n).overflowX })).filter(n => n.rect.width > 0 && (n.rect.right > innerWidth + 1 || n.rect.left < -1)).slice(0, 30) })).catch(() => null);
      const file = path.join(OUT, "failure.png"); await page.screenshot({ path: file, fullPage: true }).then(() => artifact(file)).catch(() => {});
    }
  }
  finally {
    result.finishedAt = new Date().toISOString(); fs.writeFileSync(receipt, JSON.stringify(result, null, 2));
    if (electron) await closeNative().catch(async () => { await electron?.close().catch(() => {}); });
    for (const context of contexts) await context.close(); await browser?.close();
  }
  console.log(result.checks.length + " focused medicine-ball table checks " + (result.pass ? "passed" : "completed before failure"));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
