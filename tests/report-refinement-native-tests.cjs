"use strict";
// This runner owns a fresh temporary profile and only imports synthetic data.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), { createHash } = require("node:crypto");
const { _electron } = require("./helpers/playwright.cjs");
const { desktopArtifactIdentity } = require("./helpers/desktop-artifact-identity.cjs");
const { withDeadline, waitForNativeDownload, finishNativeRun, terminateOwnedTemporaryProcess } = require("./helpers/native-runner-limits.cjs");
const ROOT = path.resolve(__dirname, ".."), VERSION = require("../package.json").version;
const argument = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const OUT = path.resolve(argument("--artifact-dir", path.join(ROOT, "output/release/2.29.1-local/native-smoke")));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const expectedVersions = { web: VERSION, desktop: require("js-yaml").load(fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8")).extraMetadata.version };

function fixture() {
  const M = RingsideModel, E = RingsideEvaluation, first = M.defaults(), copy = value => JSON.parse(JSON.stringify(value));
  Object.assign(first, { athleteId: "refinement-a0", recordId: "refinement-r0-0", demo: false });
  Object.assign(first.athlete, { name: "合成队员一", sex: "男", birthDate: "2000-01-01", date: "2026-11-01", mass: 70 });
  Object.keys(first.enabled).forEach(id => first.enabled[id] = id === "cmj");
  first.data.cmj = [{ id: "jump-one", height: 30 }, { id: "jump-two", height: 32 }];
  first.narrative.text = "合成个人正文"; first.narrative.html = M.textToHTML(first.narrative.text);
  const lib = E.migrate(M.recordEnvelope(first)), profile = E.create(first, "合成分层评价方案"), rule = profile.standards.find(item => item.metricId === "cmj_height");
  if (!rule) throw Error("CMJ standard fixture is missing");
  rule.enabled = rule.targetEnabled = true; rule.rangesEnabled = false;
  rule.referenceGroups = [{ id: "men", sex: "male", ageMin: null, ageMax: null, mode: "any", target: 50, ranges: [], source: "合成标准" }, { id: "women", sex: "female", ageMin: null, ageMax: null, mode: "any", target: 40, ranges: [], source: "合成标准" }];
  lib.evaluationProfiles = [E.serializeProfile(profile)]; lib.defaultEvaluationProfileId = profile.id;
  lib.groups = [{ id: "refinement-g1", name: "合成一队" }, { id: "refinement-g2", name: "合成二队" }];
  lib.athletes = Array.from({ length: 4 }, (_, index) => {
    const id = "refinement-a" + index, name = "合成队员" + (index + 1), records = ["2026-11-01", "2026-11-03", "2026-11-06"].map((date, period) => {
      const record = copy(first); record.athleteId = id; record.recordId = "refinement-r" + index + "-" + period; record.evaluationProfileId = profile.id;
      Object.assign(record.athlete, { name, sex: index % 2 ? "女" : "男", date }); record.data.cmj.forEach((row, trial) => row.height = 25 + index * 5 + period * 3 + trial * 2);
      record.narrative.text = name + "的原始正文 " + period; record.narrative.html = M.textToHTML(record.narrative.text); return M.normalizeRecord(record);
    });
    return { id, name, profile: M.profileFromRecord(records[0]), groupId: index < 2 ? "refinement-g1" : "refinement-g2", records };
  });
  lib.activeAthleteId = lib.athletes[0].id; lib.activeRecordId = lib.athletes[0].records[0].recordId; return lib;
}
const projection = (doc = App.getTeamDocument()) => ({ id: doc.id, basis: doc.basis, configuration: doc.configuration, views: doc.views, narrative: doc.narrative, snapshot: doc.snapshot });
function assertInitializedViews(before, after) {
  const defaults = { "trials-cmj": false, "trials-dj": false, "trials-hop": false, "trials-sj": false, capabilityDetail: true, performanceDetail: true, screenDetail: true };
  const compared = structuredClone(after), existing = before.views.detailOpen || {}, added = {};
  for (const [key, value] of Object.entries(after.views.detailOpen || {})) {
    if (Object.hasOwn(existing, key)) continue;
    assert.ok(Object.hasOwn(defaults, key), "Unexpected detail state added during initialization: " + key);
    assert.equal(value, defaults[key], "Unexpected initial detail state: " + key);
    added[key] = value; delete compared.views.detailOpen[key];
  }
  assert.deepEqual(compared, before, "Initialization may only add the seven existing UI defaults; all report content and existing views must stay identical");
  return added;
}
function preparePDFCapture() {
  window.__reportRefinementPDFObserver?.disconnect();
  const sources = new Map(), capture = window.__reportRefinementOriginalCapture || window.html2canvas;
  window.__reportRefinementOriginalCapture = capture; window.__reportRefinementCapturedCharts = []; window.__reportRefinementCapturedImages = [];
  // The PDF collector rasterizes SVGs and then copies atomic panels. Track its
  // existing chart index through that transformation, without relying on a
  // report wrapper surviving pagination or changing any rendering operation.
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const original = [...record.removedNodes].find(node => node.nodeType === 1 && node.tagName.toLowerCase() === "svg");
      const image = [...record.addedNodes].find(node => node.nodeType === 1 && node.matches("img[data-pdf-chart-index]"));
      if (!original || !image) continue;
      const wrapper = record.target.closest("[data-team-comparison-chart]"), trend = record.target.closest('[data-label="均值趋势"] [data-result-trend]');
      if (!wrapper && !trend) continue;
      const members = [...original.querySelectorAll("[data-team-member-value]")].map(node => ({ series: node.dataset.teamMemberSeries, category: node.dataset.teamMemberCategory, value: Number(node.dataset.teamMemberValue), color: node.querySelector("rect")?.getAttribute("fill"), column: !!node.querySelector("rect") }));
      const missing = [...original.querySelectorAll("[data-team-missing-slot]")].map(node => ({ series: node.dataset.teamMemberSeries, category: node.dataset.teamMemberCategory }));
      sources.set(image.dataset.pdfChartIndex, { src: image.src, index: Number(image.dataset.pdfChartIndex), projectId: record.target.closest("[data-team-project]")?.dataset.teamProject,
        ordering: wrapper ? JSON.parse(wrapper.dataset.teamComparisonChart).ordering : null, members, missing,
        trend: trend ? { spec: JSON.parse(trend.dataset.resultTrend), points: [...original.querySelectorAll("[data-trend-point]")].map(node => ({ index: Number(node.dataset.trendPoint), measured: !!node.querySelector("circle") })), segments: [...original.querySelectorAll("[data-trend-segment]")].map(node => Number(node.dataset.trendSegment)) } : null });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true }); window.__reportRefinementPDFObserver = observer;
  window.html2canvas = function (node, options) {
    for (const image of node.querySelectorAll("img[data-pdf-chart-index]")) {
      window.__reportRefinementCapturedImages.push({ index: Number(image.dataset.pdfChartIndex), width: image.naturalWidth, height: image.naturalHeight });
      const source = sources.get(image.dataset.pdfChartIndex);
      if (!source) continue;
      if (image.src !== source.src) throw Error("PDF chart raster changed after the source SVG was recorded");
      const { src, ...evidence } = source; window.__reportRefinementCapturedCharts.push({ ...evidence, matchingRaster: true });
    }
    return capture(node, options);
  };
  return [...document.querySelectorAll('[data-team-project="cmj"] [data-label="均值趋势"] [data-result-trend]')].map(node => JSON.parse(node.dataset.resultTrend));
}
function assertPDFCapture(selected, expectedTrends, captured, images, diagnostics) {
  const sorted = rows => rows.map(row => JSON.stringify(row)).sort(), expectedMembers = [], expectedMissing = [];
  for (const series of selected.series) selected.categories.forEach((category, index) => {
    const cell = series.cells[index];
    if (cell && cell.value !== null) expectedMembers.push({ series: series.id, category: category.id, value: cell.value, color: series.color, column: true });
    else expectedMissing.push({ series: series.id, category: category.id });
  });
  const plots = captured.filter(chart => chart.projectId === "cmj" && chart.ordering === selected.ordering);
  assert.ok(plots.length, "Native PDF must capture the grouped member columns");
  assert.deepEqual(sorted(plots.flatMap(chart => chart.members)), sorted(expectedMembers), "Every member value, group, category and color must reach the actual PDF raster");
  assert.deepEqual(sorted(plots.flatMap(chart => chart.missing)), sorted(expectedMissing), "PDF keeps missing-member positions");
  const trends = captured.filter(chart => chart.projectId === "cmj" && chart.trend).map(chart => chart.trend);
  assert.deepEqual(trends.map(trend => trend.spec), expectedTrends, "All mean mini trends must reach the actual PDF raster");
  for (const trend of trends) {
    assert.deepEqual(trend.points, trend.spec.points.map((point, index) => ({ index, measured: point.value !== null })));
    assert.deepEqual(trend.segments, trend.spec.points.flatMap((point, index) => index && point.change?.available ? [index] : []));
  }
  assert.deepEqual(images.map(image => image.index).sort((a, b) => a - b), Array.from({ length: diagnostics.sourceChartCount }, (_, index) => index));
  assert.ok(images.every(image => image.width > 0 && image.height > 0), "Every captured PDF chart image is decoded");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const receiptPath = path.join(OUT, "results.json"), executable = path.resolve(argument("--executable", process.env.MOTIONBENCH_EXECUTABLE || path.join(ROOT, "output/release", VERSION + "-local", "desktop/win-unpacked/MotionBench.exe")));
  const relative = path.relative(path.join(ROOT, "output/release"), executable);
  assert.ok(relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep), "Use a workspace release candidate, never the daily-use installation");
  assert.ok(fs.existsSync(executable)); assert.ok(fs.existsSync(path.join(path.dirname(executable), "resources/app.asar")), "A packaged candidate is required");
  process.env.MOTIONBENCH_EXECUTABLE = executable;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-refinement-native-reports-")), downloads = path.join(profile, "downloads");
  const result = { pass: false, synthetic: true, isolated: true, sourceHash: hash(path.join(ROOT, "MotionBench.html")), runnerSha256: hash(__filename), checks: [], errors: [], artifacts: [], startedAt: new Date().toISOString() };
  const persist = () => fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2));
  let electron, page, ownedChild, originals, horizontal, longitudinal;
  const check = async (name, run) => { result.stage = name; console.log("START " + name); await withDeadline(run, 360000, name); result.checks.push(name); persist(); console.log("PASS " + name); };
  const start = async () => {
    const env = { ...process.env, MOTIONBENCH_TEST_EXPORT_DIR: downloads }; delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({ executablePath: executable, args: ["--motionbench-test", "--motionbench-data-dir=" + profile], cwd: ROOT, env, timeout: 60000 });
    ownedChild = electron.process(); await electron.context().setOffline(true); page = await electron.firstWindow(); page.setDefaultTimeout(30000);
    page.on("pageerror", error => result.errors.push(error.stack || error.message)); page.on("dialog", dialog => dialog.accept());
    await electron.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.hide(); window.setContentSize(1440, 1000); globalThis.__reportRefinementDownloads = [];
      window.webContents.session.on("will-download", (_event, item) => item.once("done", (_done, state) => globalThis.__reportRefinementDownloads.push({ state, path: item.getSavePath(), name: item.getFilename(), bytes: item.getReceivedBytes() })));
      if (!app.commandLine.hasSwitch("motionbench-test")) throw Error("Test mode is required");
    });
    await page.waitForFunction(() => window.App?.ready, null, { timeout: 60000 });
    assert.equal(path.resolve(await electron.evaluate(({ app }) => app.getPath("userData"))), profile);
    const identity = desktopArtifactIdentity(ROOT, executable, __filename);
    assert.equal(identity.runtimeMatchesSourceHtml, true); assert.match(identity.archiveSha256, /^[a-f0-9]{64}$/);
    if (result.identity) assert.deepEqual(identity, result.identity); else result.identity = identity;
    result.versions = await page.evaluate(() => ({ web: RingsideBuild.version, desktop: MotionBenchDesktop.version })); assert.deepEqual(result.versions, expectedVersions);
    assert.equal(await electron.evaluate(({ app }) => app.getVersion()), expectedVersions.desktop);
  };
  const close = async () => {
    assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true);
    const closed = electron.waitForEvent("close", { timeout: 60000 }); closed.catch(() => {});
    await electron.evaluate(({ BrowserWindow }) => { setImmediate(() => BrowserWindow.getAllWindows()[0].close()); });
    await closed; electron = null;
  };
  const records = () => page.evaluate(async () => (await App.getRepository().values("records")).sort((a, b) => a.recordId.localeCompare(b.recordId)));
  const invariant = async () => assert.deepEqual(await records(), originals, "Report controls must preserve every source measurement and personal narrative");
  const chart = async kind => {
    await page.locator('[data-team-data="cmj"]').selectOption("members"); await page.locator('[data-team-kind="cmj"]').selectOption(kind);
    assert.equal(await page.evaluate(() => App.saveNow()), true);
    const shown = await page.locator('[data-team-project="cmj"] [data-team-comparison-chart]').evaluate(node => JSON.parse(node.dataset.teamComparisonChart));
    assert.equal(shown.kind, kind); assert.ok(shown.series.every(series => series.cells.length > 1)); return shown;
  };
  const restore = async document => {
    assert.equal(await page.evaluate(id => App.restoreSavedReport("team:" + id), document.id), true);
    assert.deepEqual(await page.evaluate(projection), document);
  };
  const pdf = async (name, document) => {
    await restore(document); const selected = await chart("column"), expectedTrends = await page.evaluate(preparePDFCapture);
    if (document.configuration.analysisMode === "longitudinal") assert.ok(expectedTrends.length > 0);
    const before = await electron.evaluate(() => globalThis.__reportRefinementDownloads.length);
    const item = await waitForNativeDownload({ timeout: 150000, label: name + " native PDF", trigger: async () => {
      const menu = page.locator("#reportExportMenu"); if (!await menu.evaluate(node => node.open)) await menu.locator(":scope > summary").click(); await menu.locator("[data-pdf-action]").click();
    }, read: async () => (await electron.evaluate(() => globalThis.__reportRefinementDownloads)).slice(before).find(item => item.name.toLowerCase().endsWith(".pdf")) });
    assert.equal(item.state, "completed"); assert.equal(path.dirname(path.resolve(item.path)), downloads); assert.equal(fs.statSync(item.path).size, item.bytes);
    const file = path.join(OUT, name + ".pdf"); fs.copyFileSync(item.path, file); const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert.ok(bytes.subarray(-1024).toString().includes("%%EOF"));
    const diagnostics = await page.evaluate(() => RingsidePDF.lastDiagnostics); assert.equal(diagnostics.status, "complete");
    for (const field of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(diagnostics[field], [], field);
    const captured = await page.evaluate(() => window.__reportRefinementCapturedCharts), images = await page.evaluate(() => window.__reportRefinementCapturedImages);
    await page.evaluate(() => window.__reportRefinementPDFObserver.disconnect()); assertPDFCapture(selected, expectedTrends, captured, images, diagnostics);
    result.artifacts.push({ path: path.relative(OUT, file).split(path.sep).join("/"), sha256: hash(file), bytes: bytes.length, kind: "pdf", diagnostics, capturedCharts: captured, capturedImages: images, miniTrends: expectedTrends.length }); persist();
  };
  try {
    await check("packaged candidate version and ASAR identity match the source in an isolated synthetic profile", async () => {
      await start(); await page.evaluate(async factory => { await App.importPayload((0, eval)("(" + factory + ")")(), "replace-library"); await App.showReport(false); await App.saveNow(); }, fixture.toString());
      originals = await records(); assert.equal(originals.length, 12); assert.equal(await page.evaluate(() => App.getLibrary().athletes.length), 4);
    });
    await check("team common standards and both comparison chart choices survive a normal close and reopen", async () => {
      await page.locator('[data-workspace-nav="reports"]').click(); await page.locator('[name="reportFamily"][value="team"]').check(); const next = () => page.locator("#reportWorkflowNext").click();
      await next(); await page.locator("[data-team-analysis]").selectOption("horizontal"); await page.locator("[data-team-add-group]").selectOption("refinement-g1"); await page.locator("[data-team-add-group]").selectOption("refinement-g2"); await next(); await next(); await next();
      let resolved = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.waitForFunction(() => !App.getReportSetup()?.busy); if (await page.evaluate(() => !App.getReportSetup())) break;
        const dialog = page.locator("#teamReportStandardsDialog[open]"); assert.equal(await dialog.isVisible(), true); assert.equal(await dialog.locator("[data-reference-field]").count(), 0);
        const choices = dialog.locator("[data-standard-choice]"); assert.ok(await choices.count());
        for (let index = 0; index < await choices.count(); index++) await choices.nth(index).selectOption("0");
        await dialog.locator("[data-reference-confirm]").click(); resolved++; await next();
      }
      assert.equal(await page.evaluate(() => App.getReportSetup()), null); assert.equal(resolved, 2);
      assert.deepEqual(await page.evaluate(() => App.getTeam().evaluationConflicts), []);
      assert.equal((await chart("box")).ordering, "descending-value"); horizontal = await page.evaluate(projection);
      assert.deepEqual(horizontal.configuration.objects.map(object => object.kind), ["team", "team"]);
      assert.ok(horizontal.configuration.objects.every(object => object.evaluationOverrides?.cmj_height?.standard));
      assert.equal(await page.evaluate(async () => {
        const dates = ["2026-11-01", "2026-11-03", "2026-11-06"], athleteIds = App.getLibrary().athletes.map(athlete => athlete.id);
        return App.selectTeam({ analysisMode: "longitudinal", athleteIds, dates, dateParticipants: dates.map((date, period) => ({ date, participants: athleteIds.map((athleteId, index) => ({ athleteId, recordId: "refinement-r" + index + "-" + period })) })), mode: "best", profileId: App.getLibrary().defaultEvaluationProfileId });
      }), true);
      assert.equal((await chart("dot")).ordering, "roster"); longitudinal = await page.evaluate(projection); assert.notEqual(longitudinal.id, horizontal.id); await invariant();
      // Normal source switches lazily persist existing detail defaults. Capture
      // the actual stored state only after those switches, with every addition
      // constrained above; the close/reopen and export comparisons stay exact.
      for (let round = 0; round < 2; round++) for (const document of [horizontal, longitudinal]) {
        assert.equal(await page.evaluate(id => App.restoreSavedReport("team:" + id), document.id), true);
        assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true);
      }
      const saved = await page.evaluate(ids => Promise.all(ids.map(id => App.getRepository().getTeamReport(id))), [horizontal.id, longitudinal.id]);
      const storedHorizontal = projection(saved[0]), storedLongitudinal = projection(saved[1]);
      result.initializedDetailDefaults = { horizontal: assertInitializedViews(horizontal, storedHorizontal), longitudinal: assertInitializedViews(longitudinal, storedLongitudinal) };
      horizontal = storedHorizontal; longitudinal = storedLongitudinal; await invariant();
      await close(); await start(); assert.deepEqual(await page.evaluate(projection), longitudinal); await restore(horizontal); assert.equal(await page.locator('[data-team-kind="cmj"]').inputValue(), "box"); await restore(longitudinal); assert.equal(await page.locator('[data-team-kind="cmj"]').inputValue(), "dot"); await invariant();
    });
    await check("native horizontal and longitudinal PDFs contain the selected charts and complete report content", async () => {
      await pdf("team-horizontal", horizontal); await pdf("team-longitudinal", longitudinal); await invariant(); await close();
      assert.deepEqual(desktopArtifactIdentity(ROOT, executable, __filename), result.identity); assert.equal(hash(path.join(ROOT, "MotionBench.html")), result.sourceHash); assert.equal(hash(__filename), result.runnerSha256);
      result.artifactUnchanged = true; result.sourceUnchanged = true; result.normalClose = true;
    });
    assert.deepEqual(result.errors, []); result.pass = true;
  } catch (error) { result.errors.push(error.stack || String(error)); process.exitCode = 1; console.error(error.stack || error); }
  finally {
    await finishNativeRun({ result, persist,
      diagnostics: !result.pass && page && !page.isClosed() ? async () => { result.failureState = await page.evaluate(() => ({ toast: document.querySelector("#toast")?.textContent, setup: App.getReportSetup(), teamId: App.getTeamDocument()?.id })); } : null,
      normalClose: electron ? close : null, forceTerminate: ownedChild ? () => terminateOwnedTemporaryProcess({ child: ownedChild, executable, profile }) : null });
    if (!result.pass) process.exitCode = 1;
  }
  console.log(result.checks.length + " report refinement native checks " + (result.pass ? "passed" : "completed before failure"));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
