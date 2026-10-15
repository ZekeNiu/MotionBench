"use strict";
// Verify existing data through the installed/native application. Never seed,
// import, create, or edit an athlete. Private snapshots stay in the checkpoint.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { _electron } = require("./helpers/playwright.cjs");
const ROOT = path.resolve(__dirname, ".."), SOURCE = path.join(ROOT, "MotionBench.html");
const CHECKPOINT = String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.2`;
const INSTALLED = String.raw`D:\Application\Strength&Conditioning\MotionBench\MotionBench.exe`;
const EXAMPLE_ID = "f56b5a5a-6d80-442f-b4e6-73134659b06f", EXAMPLE_NAME = "示例运动员｜纵向比较（合成）";
const DATES = ["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"];
const RECORD_IDS = ["8d2e3b11-c17a-4211-9a61-3441316b1a8e", "8a99ed67-0706-466a-a447-ff0f47368ca9", "285dc077-3543-43a3-8903-d0e60ce2e9af", "1a1865cb-560c-4617-b042-e4bf4e8d3db5"];
const DOCUMENT_KEY = JSON.stringify([EXAMPLE_ID, [...RECORD_IDS].sort()]);
const CHECKS = Object.freeze({
  identity: "Native executable archive origin and prepared profile identity verified",
  baseline: "Captured existing complete library calculations and comparison before the summary update",
  library: "Complete original library records timestamps definitions and narratives preserved",
  calculations: "Every single-report calculation and complete active comparison model preserved",
  visible: "Existing example is visible under all teams and restores the same four-date comparison",
  counts: "Summary headings counts and every metric name agree with the unchanged model",
  names: "Change names rank by absolute percentage and retain three-line clamps and complete titles",
  dates: "All four selected dates use 14px text in a single visible column",
  exports: "Native JSON and HTML exports contain only the unchanged selected example and comparison",
  pdf: "Native example PDF completed through the normal report exporter",
  unchanged: "Inspection exports and save barrier preserve every existing record and comparison body",
  close: "Native save barrier and normal window close completed with no renderer or network errors"
});
/* VERIFY_CHECKS {"baseline":["Native executable archive origin and prepared profile identity verified","Captured existing complete library calculations and comparison before the summary update","Existing example is visible under all teams and restores the same four-date comparison","Inspection exports and save barrier preserve every existing record and comparison body","Native save barrier and normal window close completed with no renderer or network errors"],"copied":["Native executable archive origin and prepared profile identity verified","Complete original library records timestamps definitions and narratives preserved","Every single-report calculation and complete active comparison model preserved","Existing example is visible under all teams and restores the same four-date comparison","Summary headings counts and every metric name agree with the unchanged model","Change names rank by absolute percentage and retain three-line clamps and complete titles","All four selected dates use 14px text in a single visible column","Native JSON and HTML exports contain only the unchanged selected example and comparison","Native example PDF completed through the normal report exporter","Inspection exports and save barrier preserve every existing record and comparison body","Native save barrier and normal window close completed with no renderer or network errors"],"installed":["Native executable archive origin and prepared profile identity verified","Complete original library records timestamps definitions and narratives preserved","Every single-report calculation and complete active comparison model preserved","Existing example is visible under all teams and restores the same four-date comparison","Summary headings counts and every metric name agree with the unchanged model","Change names rank by absolute percentage and retain three-line clamps and complete titles","All four selected dates use 14px text in a single visible column","Native JSON and HTML exports contain only the unchanged selected example and comparison","Inspection exports and save barrier preserve every existing record and comparison body","Native save barrier and normal window close completed with no renderer or network errors"]} VERIFY_CHECKS */
const hash = value => crypto.createHash("sha256").update(value).digest("hex"), fileHash = file => hash(fs.readFileSync(file));
const readJSON = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function same(actual, expected, message) {
  assert.equal(hash(JSON.stringify(canonical(actual))), hash(JSON.stringify(canonical(expected))), message);
}
function projectDocument(document) {
  const value = structuredClone(document);
  if (value?.athleteId === EXAMPLE_ID && value.key === DOCUMENT_KEY) delete value.updated;
  return value;
}
function comparisonProjection(comparison) {
  const value = structuredClone(comparison);
  if (value?.document) value.document = projectDocument(value.document);
  return value;
}
function libraryProjection(library) {
  const value = structuredClone(library);
  for (const key of ["version", "updated", "activeAthleteId", "activeRecordId"]) delete value[key];
  if (value.longitudinalReports) value.longitudinalReports = value.longitudinalReports.map(projectDocument);
  return value;
}
function compareLibraryAndReports(actual, expected) {
  same(libraryProjection(actual.library), libraryProjection(expected.library), CHECKS.library);
  same(actual.reports, expected.reports, "All single-report values axes evaluations fingerprints and narratives must be identical");
}
function compareSnapshots(actual, expected) {
  compareLibraryAndReports(actual, expected);
  same(comparisonProjection(actual.activeComparison), comparisonProjection(expected.activeComparison), "The complete active comparison model basis views and narrative must be identical");
}
function verifyBackup(checkpoint) {
  assert.ok(path.isAbsolute(checkpoint), "Use an explicit absolute checkpoint");
  const file = path.join(checkpoint, "manifest.json"), manifest = readJSON(file);
  assert.equal(manifest.complete, true); assert.ok(Array.isArray(manifest.files) && manifest.files.length);
  for (const entry of manifest.files) {
    assert.ok(["program", "userdata"].includes(entry.kind));
    const target = path.resolve(checkpoint, entry.kind, entry.path), base = path.resolve(checkpoint, entry.kind) + path.sep;
    assert.ok(target.startsWith(base), "Backup entry must stay inside its declared directory");
    assert.equal(fileHash(target), entry.sha256); assert.equal(fs.statSync(target).size, entry.bytes);
  }
  return { file, sha256: fileHash(file), files: manifest.files.length };
}
async function snapshot(page) {
  return JSON.parse(await page.evaluate(async () => {
    const library = await App.getRepository().exportLibrary(), reports = [];
    for (const owner of library.athletes) for (const record of owner.records) {
      const effective = RingsideEvaluation.resolve(record, library.evaluationProfiles.find(profile => profile.id === record.evaluationProfileId));
      const stats = RingsideModel.stats(effective);
      reports.push({ recordId: record.recordId, values: stats.values, axes: stats.axes, evaluationResults: stats.evaluationResults, basis: RingsideModel.fingerprint(effective), narrative: record.narrative });
    }
    const model = App.getLongitudinal();
    const activeComparison = model ? { athleteId: model.athleteId, recordIds: model.periods.map(period => period.id), dates: model.periods.map(period => period.date), document: App.getLongitudinalDocument(), model } : null;
    return JSON.stringify({ library, reports, activeComparison }, (_key, value) => value instanceof Set ? { type: "Set", values: [...value] } : value instanceof Map ? { type: "Map", entries: [...value] } : value);
  }));
}
function assertExample(value, requireActive = true) {
  const owner = value.library.athletes.find(athlete => athlete.id === EXAMPLE_ID);
  assert.ok(owner, "The existing example must already be present"); assert.equal(owner.name, EXAMPLE_NAME);
  assert.equal(owner.archived, false); assert.ok(!owner.deletedAt); assert.equal(owner.groupId, "");
  same(owner.records.map(record => record.recordId).sort(), [...RECORD_IDS].sort(), "Use the four existing records without creating new IDs");
  same(owner.records.map(record => record.athlete.date).sort(), DATES, "Existing example dates must be unchanged");
  assert.ok(owner.records.every(record => record.narrative?.text?.trim()));
  if (!requireActive) return;
  const active = value.activeComparison;
  assert.ok(active, "The saved comparison must restore without reseeding or reselection"); assert.equal(active.athleteId, EXAMPLE_ID);
  same([...active.recordIds].sort(), [...RECORD_IDS].sort(), "The saved selection must contain the same four records"); same(active.dates, DATES);
  assert.equal(active.document.key, DOCUMENT_KEY); assert.ok(active.document.narrative?.text?.trim());
  assert.ok(active.model.changeSummary.improved.length > 0 && active.model.changeSummary.declined.length > 0);
  assert.equal(active.model.overview.axes.length, 3);
}
// Normal exports and close may persist selection and the rebuild timestamp.
// Block any attempted change to existing raw records or shared definitions.
async function protectExistingData(page, library) {
  await page.evaluate(({ library, exampleId, documentKey }) => {
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    const documents = values => values?.map(value => { const clone = structuredClone(value); if (clone.athleteId === exampleId && clone.key === documentKey) delete clone.updated; return clone; });
    const owners = new Map(library.athletes.map(owner => [owner.id, owner])), records = new Map(library.athletes.flatMap(owner => owner.records.map(record => [record.recordId, record])));
    const metadata = owner => { if (!owner) return null; const value = structuredClone(owner); delete value.records; return value; };
    window.__summaryPreservation = { writes: 0, blocked: [] };
    const reject = message => { window.__summaryPreservation.blocked.push(message); throw Error(message); };
    const checkRecords = values => { for (const value of values) if (!same(value, records.get(value.recordId))) reject("Existing record content or identity would change"); };
    const checkDocuments = values => { if (values !== undefined && !same(documents(values), documents(library.longitudinalReports))) reject("Existing comparison content would change"); };
    const repo = App.getRepository(), saveRecords = repo.saveRecords.bind(repo), save = repo.save.bind(repo);
    repo.saveRecords = async function (values, checks, options = {}) {
      checkRecords(values); checkDocuments(options.longitudinalReports);
      if (options.newAthletes?.length) reject("Adding an athlete is not part of verification");
      window.__summaryPreservation.writes++; return saveRecords(values, checks, options);
    };
    repo.save = async function (next, values = [], removals = {}, checks = {}) {
      checkRecords(values); checkDocuments(next.longitudinalReports);
      if (Object.values(removals).some(value => Array.isArray(value) && value.length)) reject("Deleting data is not part of verification");
      if (next.athletes.length !== owners.size || next.athletes.some(owner => !same(metadata(owner), metadata(owners.get(owner.id))))) reject("Existing athlete metadata would change");
      for (const key of ["groups", "evaluationProfiles", "catalog", "testPlans", "defaultEvaluationProfileId"]) if (!same(next[key], library[key])) reject("Shared library definitions would change");
      window.__summaryPreservation.writes++; return save(next, values, removals, checks);
    };
  }, { library, exampleId: EXAMPLE_ID, documentKey: DOCUMENT_KEY });
}
async function inspectSummary(page, model) {
  assert.deepEqual(await page.locator("#microCards .micro-card h3").allTextContents(), ["运动员基本信息", "下降", "改善", "所选比较日期"]);
  const observation = { cards: {}, dates: [] };
  for (const direction of ["declined", "improved"]) {
    const items = model.changeSummary[direction], card = page.locator(`[data-change-direction="${direction}"]`), names = card.locator(".longitudinal-summary-names");
    assert.equal(await card.locator(".micro-value").innerText(), items.length + " 项");
    const countFont = await card.locator(".micro-value").evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    assert.ok(countFont >= 30); assert.equal(await card.locator("details,.longitudinal-change,li").count(), 0);
    const labels = await card.locator("[data-summary-metric]").evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.summaryMetric, text: node.textContent })));
    assert.equal(labels.length, items.length);
    for (const item of items) assert.equal(labels.find(row => row.id === item.id)?.text, item.projectName === item.name ? item.name : item.label);
    const ranked = items.map((item, index) => ({ id: item.id, index, weight: item.change?.available && item.change.kind === "absolute" && Number.isFinite(item.change.percent) && item.change.from?.value > 0 ? Math.abs(item.change.percent) : -1 })).sort((a, b) => b.weight - a.weight || a.index - b.index).map(item => item.id);
    assert.deepEqual(labels.map(row => row.id), ranked);
    const style = await names.evaluate(node => { const css = getComputedStyle(node); return { clamp: css.webkitLineClamp, overflow: css.overflow, height: node.clientHeight, lineHeight: parseFloat(css.lineHeight), title: node.title, text: node.textContent }; });
    assert.equal(style.clamp, "3"); assert.equal(style.overflow, "hidden"); assert.ok(style.height <= 3 * style.lineHeight + 1); assert.equal(style.title, style.text);
    observation.cards[direction] = { count: items.length, countFont, labels, ...style };
  }
  observation.dates = await page.locator("#microCards [data-summary-record]").evaluateAll(nodes => nodes.map(node => { const bounds = node.getBoundingClientRect(); return { id: node.dataset.summaryRecord, text: node.textContent, font: parseFloat(getComputedStyle(node).fontSize), top: bounds.top, bottom: bounds.bottom, left: bounds.left }; }));
  assert.deepEqual(observation.dates.map(row => row.id), model.periods.map(period => period.id));
  assert.deepEqual(observation.dates.map(row => row.text.trim()), DATES);
  assert.ok(observation.dates.every((row, index) => row.font === 14 && (!index || row.top >= observation.dates[index - 1].bottom && Math.abs(row.left - observation.dates[0].left) < 1)));
  for (const id of RECORD_IDS) assert.ok(await page.locator(`[data-summary-record="${id}"]`).isVisible());
  return observation;
}
function verifyExport(payload, expected) {
  assert.equal(payload.kind, "longitudinal-report"); assert.equal(payload.library.athletes.length, 1); assert.equal(payload.library.athletes[0].id, EXAMPLE_ID);
  assert.equal(payload.selection.athleteId, EXAMPLE_ID); same([...payload.selection.recordIds].sort(), [...RECORD_IDS].sort());
  const owner = expected.library.athletes.find(athlete => athlete.id === EXAMPLE_ID);
  const byId = values => [...values].sort((a, b) => a.recordId.localeCompare(b.recordId));
  same(byId(payload.library.athletes[0].records), byId(owner.records), "Exported raw records and manual narratives remain identical");
  assert.equal(payload.library.longitudinalReports.length, 1);
  same(projectDocument(payload.library.longitudinalReports[0]), projectDocument(expected.activeComparison.document), "Exported comparison content remains identical");
  const profileIds = new Set(owner.records.map(record => record.evaluationProfileId));
  same(payload.library.evaluationProfiles, expected.library.evaluationProfiles.filter(profile => profileIds.has(profile.id)), "Exported existing evaluation profiles remain identical");
}
async function main() {
  const arg = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; }, mode = process.argv[2];
  assert.ok(["baseline", "copied", "installed"].includes(mode), "Specify baseline, copied, or installed");
  const checkpoint = path.resolve(arg("--checkpoint") || CHECKPOINT), actual = mode === "installed";
  const profile = path.resolve(arg("--profile") || (actual ? path.join(process.env.APPDATA, "MotionBench Desktop") : path.join(checkpoint, mode + "-profile")));
  assert.equal(profile === path.resolve(process.env.APPDATA, "MotionBench Desktop"), actual, "Only installed mode may use the actual profile");
  if (!actual) assert.ok(profile.startsWith(checkpoint + path.sep), "Copied profiles must remain inside the checkpoint");
  assert.ok(fs.statSync(profile).isDirectory(), "A verified prepared profile must already exist");
  const executable = path.resolve(arg("--executable") || (mode === "copied" ? path.join(ROOT, "dist-desktop/win-unpacked/MotionBench.exe") : INSTALLED));
  if (actual) assert.equal(executable, path.resolve(INSTALLED), "Installed verification must open the installed executable");
  const receiptDirectory = path.join(checkpoint, "verification", mode), out = path.resolve(arg("--artifact-dir") || path.join(ROOT, "output/playwright/v2242/summary", mode));
  fs.mkdirSync(receiptDirectory, { recursive: true }); if (mode !== "baseline") fs.mkdirSync(out, { recursive: true });
  const launchArgs = actual ? [] : ["--motionbench-test", "--motionbench-data-dir=" + profile];
  const archive = path.join(path.dirname(executable), "resources/app.asar"), asar = require("@electron/asar");
  const runtimeHtmlSha256 = hash(asar.extractFile(archive, path.normalize("MotionBench.html"))), workspaceSourceHash = fileHash(SOURCE);
  const result = { mode, pass: false, checks: [], errors: [], errorStacks: [], network: [], artifacts: [], backup: verifyBackup(checkpoint), runnerSha256: fileHash(__filename), sourceHash: mode === "baseline" ? runtimeHtmlSha256 : workspaceSourceHash, workspaceSourceHash, executablePath: executable, executableSha256: fileHash(executable), archivePath: archive, archiveSha256: fileHash(archive), runtimeHtmlSha256, profilePath: profile, actualProfile: actual, normalStartup: actual, launchArgs, pdfRequested: mode === "copied", normalClose: false };
  const artifact = file => { const value = { file: path.resolve(file), sha256: fileHash(file), bytes: fs.statSync(file).size }; result.artifacts.push(value); return value; };
  const saveSnapshot = (name, value) => { const file = path.join(receiptDirectory, name); fs.writeFileSync(file, JSON.stringify(value, null, 2)); return fileHash(file); };
  const stage = name => { result.stage = name; console.log(mode + ": " + name); };
  let electron, page;
  try {
    if (mode !== "baseline") assert.equal(result.runtimeHtmlSha256, result.sourceHash, "Candidate and installed runtime must match final source");
    else assert.equal(result.archiveSha256, fileHash(path.join(checkpoint, "program/resources/app.asar")), "Baseline executable must use the backed-up archive");
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.MOTIONBENCH_TEST_EXPORT_DIR;
    stage("Opening prepared profile");
    electron = await _electron.launch({ executablePath: executable, args: launchArgs, cwd: ROOT, env, timeout: 60000 });
    page = await electron.firstWindow(); page.setDefaultTimeout(30000);
    page.on("pageerror", error => { result.errors.push(error.message); result.errorStacks.push(error.stack); });
    page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
    page.on("dialog", dialog => dialog.dismiss());
    await electron.context().setOffline(true); await page.waitForFunction(() => window.App?.ready, null, { timeout: 60000 }); assert.equal(await page.evaluate(() => App.ready), true);
    const identity = await electron.evaluate(({ app, session, BrowserWindow }) => ({ userDataPath: app.getPath("userData"), sessionDataPath: app.getPath("sessionData"), storagePath: session.defaultSession.storagePath, originURL: BrowserWindow.getAllWindows()[0].webContents.getURL(), defaultSession: BrowserWindow.getAllWindows()[0].webContents.session === session.defaultSession }));
    Object.assign(result, identity); assert.equal(path.resolve(result.userDataPath), profile); assert.equal(path.resolve(result.sessionDataPath), profile); assert.equal(identity.defaultSession, true); assert.equal(identity.originURL, "motionbench://app/MotionBench.html");
    result.version = await page.evaluate(() => MotionBenchDesktop.version); assert.equal(result.version, mode === "baseline" ? "2.24.1-desktop.1" : "2.24.2-desktop.1");
    result.databaseName = await page.evaluate(() => App.getRepository().db.name); assert.equal(result.databaseName, "motionbench-v3:/MotionBench.html");
    result.checks.push(CHECKS.identity);
    stage("Capturing complete startup library and calculated results");
    const startup = await snapshot(page); result.startupSnapshotSha256 = saveSnapshot("startup-snapshot.json", startup);
    result.athletes = startup.library.athletes.length; result.records = startup.reports.length; assertExample(startup, false);
    result.example = { athleteId: EXAMPLE_ID, recordIds: RECORD_IDS, dates: DATES, documentKey: DOCUMENT_KEY };
    let baseline = null;
    if (mode !== "baseline") { const file = path.join(checkpoint, "verification/baseline/snapshot.json"); baseline = readJSON(file); result.baselineSha256 = fileHash(file); compareLibraryAndReports(startup, baseline); }
    stage("Selecting the existing example with original-data protection");
    await protectExistingData(page, startup.library);
    assert.equal(await page.locator("#reportGroupFilter").inputValue(), "");
    await page.locator("#reportAthleteSearch").click(); await page.locator("#reportAthleteSearch").fill("示例运动员");
    assert.equal(await page.locator(`#reportAthleteOptions [data-athlete-choice="${EXAMPLE_ID}"]`).count(), 1);
    assert.ok(await page.locator(`#reportAthleteOptions [data-athlete-choice="${EXAMPLE_ID}"]`).isVisible());
    await page.evaluate(() => {
      window.__summaryOriginalSelectAthlete = App.selectAthlete;
      App.selectAthlete = (...args) => {
        const task = window.__summaryOriginalSelectAthlete(...args);
        window.__summaryAthleteSelection = Promise.resolve(task); return task;
      };
    });
    try {
      await page.locator(`#reportAthleteOptions [data-athlete-choice="${EXAMPLE_ID}"]`).click();
      assert.equal(await page.evaluate(async () => {
        if (!window.__summaryAthleteSelection) throw Error("The real athlete chooser did not invoke its selection handler");
        return window.__summaryAthleteSelection;
      }), true, "The athlete chooser must finish saving and loading before record selection");
    } finally {
      await page.evaluate(() => { App.selectAthlete = window.__summaryOriginalSelectAthlete; delete window.__summaryOriginalSelectAthlete; delete window.__summaryAthleteSelection; });
    }
    await page.waitForFunction(id => App.getState()?.athleteId === id, EXAMPLE_ID);
    assert.equal(await page.evaluate(ids => App.selectRecords(ids), RECORD_IDS), true);
    assert.equal(await page.evaluate(() => App.showReport(true)), "report");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    same(await page.locator("#recordChoices [data-record-choice]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.recordChoice).sort()), [...RECORD_IDS].sort(), "The real record picker must show all four existing records selected");
    stage("Capturing and comparing the selected four-record model");
    const initial = await snapshot(page); assertExample(initial); compareLibraryAndReports(initial, startup);
    result.selectedSnapshotSha256 = saveSnapshot("selected-snapshot.json", initial); result.selectionPreservedData = true;
    if (baseline) { compareSnapshots(initial, baseline); result.checks.push(CHECKS.library, CHECKS.calculations); }
    else result.checks.push(CHECKS.baseline);
    result.checks.push(CHECKS.visible);
    if (mode !== "baseline") {
      stage("Checking summary styles and capturing the native window");
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      result.observation = await inspectSummary(page, initial.activeComparison.model); result.checks.push(CHECKS.counts, CHECKS.names, CHECKS.dates);
      const screenshot = path.join(out, "example-summary.png"), cdp = await electron.context().newCDPSession(page);
      const clip = await page.locator("#microCards").evaluate(node => { const bounds = node.getBoundingClientRect(); return { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width, height: bounds.height, scale: 1 }; });
      const captured = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip }); fs.writeFileSync(screenshot, Buffer.from(captured.data, "base64")); await cdp.detach(); artifact(screenshot);
      const screen = path.join(out, "example-comparison.png"); await page.screenshot({ path: screen, fullPage: false }); artifact(screen);
      const exportPaths = Object.fromEntries(["json", "html", "pdf"].map(extension => [extension, path.join(out, "example-comparison." + extension)]));
      await electron.evaluate(({ BrowserWindow }, paths) => {
        globalThis.__summaryDownloads = [];
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        contents.session.on("will-download", (_event, item, sender) => {
          if (sender !== contents) return;
          const file = paths[item.getFilename().split(".").at(-1).toLowerCase()];
          if (!file) { item.cancel(); return; }
          item.once("done", (_event, state) => __summaryDownloads.push({ file: item.getSavePath(), name: item.getFilename(), state }));
          item.setSavePath(file);
        });
      }, exportPaths);
      const download = async kind => {
        stage("Exporting existing example " + kind);
        const start = await electron.evaluate(() => __summaryDownloads.length), deadline = Date.now() + 900000;
        await page.evaluate(kind => App["download" + kind](), kind);
        const save = await page.evaluate(() => ({ status: document.getElementById("saveStatus")?.textContent, toast: document.getElementById("toast")?.textContent, blocked: window.__summaryPreservation?.blocked || [] }));
        assert.deepEqual(save.blocked, [], "Normal export must not attempt to change protected data");
        assert.ok(!save.status?.startsWith("保存失败") && !/导出失败|保存失败/.test(save.toast || ""), "Normal export reported a save or export failure");
        let downloaded;
        while (Date.now() < deadline) {
          downloaded = await electron.evaluate((_electron, { start, kind }) => __summaryDownloads.slice(start).find(item => item.file.toLowerCase().endsWith("." + kind.toLowerCase())), { start, kind });
          if (downloaded) break; await page.waitForTimeout(100);
        }
        assert.ok(downloaded, "Native export must complete"); assert.equal(downloaded.state, "completed"); assert.equal(path.resolve(downloaded.file), path.resolve(exportPaths[kind.toLowerCase()])); artifact(downloaded.file); console.log(mode + ": native " + kind + " export completed"); return downloaded.file;
      };
      const json = await download("JSON"), html = await download("HTML"); verifyExport(readJSON(json), initial);
      const embedded = fs.readFileSync(html, "utf8").match(/<script\b[^>]*\bid="embedded-data"[^>]*>([\s\S]*?)<\/script>/i);
      assert.ok(embedded, "Exported HTML must include its own selected report data"); verifyExport(JSON.parse(embedded[1]), initial); result.checks.push(CHECKS.exports);
      if (result.pdfRequested) { console.log("Existing example JSON and HTML exported; generating the native PDF."); const pdf = await download("PDF"); assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), "%PDF-"); result.pdfDiagnostics = await page.evaluate(() => RingsidePDF.lastDiagnostics); assert.equal(result.pdfDiagnostics?.status, "complete"); result.checks.push(CHECKS.pdf); }
    }
    stage("Saving and comparing the complete final library and model");
    assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true);
    const final = await snapshot(page); assertExample(final); compareSnapshots(final, initial); if (baseline) compareSnapshots(final, baseline);
    result.snapshotSha256 = saveSnapshot("snapshot.json", final); result.afterSaveUnchanged = true; result.guard = await page.evaluate(() => __summaryPreservation); assert.deepEqual(result.guard.blocked, []); result.checks.push(CHECKS.unchanged);
    stage("Closing the native window through its save barrier");
    const closed = electron.waitForEvent("close", { timeout: 60000 }); await electron.evaluate(({ BrowserWindow }) => setImmediate(() => BrowserWindow.getAllWindows()[0].close())); await closed; electron = null; result.normalClose = true;
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []);
    assert.equal(fileHash(executable), result.executableSha256); assert.equal(fileHash(archive), result.archiveSha256); assert.equal(fileHash(__filename), result.runnerSha256); assert.equal(fileHash(SOURCE), result.workspaceSourceHash);
    result.artifactUnchanged = true; result.checks.push(CHECKS.close); result.pass = true;
  } catch (error) {
    result.failure = error.stack;
    result.failureState = await page?.evaluate(() => ({ guard: window.__summaryPreservation || null, saveStatus: document.getElementById("saveStatus")?.textContent, toast: document.getElementById("toast")?.textContent, mode: window.App?.getUIState?.().mode })).catch(() => null);
    process.exitCode = 1; console.error("Native summary verification failed; see the private checkpoint receipt.");
  } finally {
    await electron?.close().catch(() => {});
    result.sourceUnchanged = fileHash(SOURCE) === result.workspaceSourceHash; result.runnerUnchanged = fileHash(__filename) === result.runnerSha256;
    fs.writeFileSync(path.join(receiptDirectory, "receipt.json"), JSON.stringify(result, null, 2));
    if (mode !== "baseline") fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ mode, pass: result.pass, checks: result.checks.length, athletes: result.athletes, records: result.records, normalClose: result.normalClose }));
  }
}
module.exports = { CHECKS, EXAMPLE_ID, DOCUMENT_KEY, libraryProjection, comparisonProjection, compareLibraryAndReports, compareSnapshots, assertExample, verifyBackup, verifyExport };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
