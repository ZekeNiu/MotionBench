"use strict";
// Only synthetic data in a newly owned OS temporary profile. Never attach to an
// existing application or use the installed daily-use program/data directory.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { _electron, chromium } = require("./helpers/playwright.cjs");
const { desktopArtifactIdentity } = require("./helpers/desktop-artifact-identity.cjs");
const { withDeadline, waitForNativeDownload, finishNativeRun, terminateOwnedTemporaryProcess } = require("./helpers/native-runner-limits.cjs");
const ROOT = path.resolve(__dirname, ".."), VERSION = require("../package.json").version;
const OUT = path.join(ROOT, "output/playwright/team-native");
const expectedVersions = { web: VERSION, desktop: require("js-yaml").load(fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8")).extraMetadata.version };
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fixture() {
  const M = RingsideModel, first = M.defaults();
  Object.assign(first, { athleteId: "native-team-a", recordId: "native-team-ra", demo: false });
  Object.assign(first.athlete, { name: "桌面合成甲", sex: "男", birthDate: "2000-01-01", age: 26, date: "2026-11-01" });
  Object.keys(first.enabled).forEach(id => first.enabled[id] = id === "cmj");
  first.data.cmj = [{ id: "one", height: 30 }, { id: "two", height: 34 }];
  first.narrative.text = "甲的个人正文"; first.narrative.html = M.textToHTML(first.narrative.text);
  const lib = RingsideEvaluation.migrate(M.recordEnvelope(first)), copy = value => JSON.parse(JSON.stringify(value));
  lib.groups = [{ id: "native-team-group", name: "桌面合成团队" }];
  lib.athletes[0].groupId = "native-team-group";
  const other = copy(lib.athletes[0]); other.id = "native-team-b"; other.name = other.profile.name = "桌面合成乙";
  other.records[0].athleteId = other.id; other.records[0].recordId = "native-team-rb"; other.records[0].athlete.name = other.name;
  other.records[0].data.cmj = [{ id: "one", height: 40 }, { id: "two", height: 44 }];
  other.records[0].narrative.text = "乙的个人正文"; other.records[0].narrative.html = M.textToHTML(other.records[0].narrative.text);
  const missing = copy(other); missing.id = "native-team-missing"; missing.name = missing.profile.name = "桌面合成未测"; missing.records = [];
  lib.athletes.push(other, missing); lib.activeAthleteId = first.athleteId; lib.activeRecordId = first.recordId;
  return lib;
}
const projection = () => {
  const doc = App.getTeamDocument(), model = App.getTeam();
  return { id: doc?.id, fingerprint: model?.fingerprint, configuration: doc?.configuration, views: doc?.views,
    narrative: doc?.narrative, participants: model?.participants.map(p => [p.athleteId, p.recordId, p.missing]) };
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const receiptPath = path.join(OUT, "results.json");
  if (fs.existsSync(receiptPath)) fs.copyFileSync(receiptPath, path.join(OUT, "results-before-" + Date.now() + ".json"));
  const executable = path.resolve(process.env.MOTIONBENCH_EXECUTABLE || path.join(ROOT, "output/release", VERSION + "-local", "desktop/win-unpacked/MotionBench.exe"));
  assert.ok(fs.existsSync(executable), "Build the candidate before running native acceptance");
  const relativeExecutable = path.relative(path.join(ROOT, "output/release"), executable);
  assert.ok(relativeExecutable && !path.isAbsolute(relativeExecutable) && relativeExecutable !== ".." && !relativeExecutable.startsWith(".." + path.sep), "Use a candidate under workspace output/release");
  assert.ok(fs.existsSync(path.join(path.dirname(executable), "resources/app.asar")), "Use a packaged candidate");
  process.env.MOTIONBENCH_EXECUTABLE = executable;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-refinement-native-team-")), downloads = path.join(profile, "downloads");
  const result = { pass: false, synthetic: true, userData: profile, sourceHash: hash(path.join(ROOT, "MotionBench.html")), runnerSha256: hash(__filename), checks: [], errors: [], artifacts: [], startedAt: new Date().toISOString() };
  const persist = () => fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2));
  const artifact = file => result.artifacts.push({ file: path.relative(ROOT, file).replaceAll("\\", "/"), sha256: hash(file), bytes: fs.statSync(file).size });
  let electron, page, ownedChild, browser, original, expected, teamId, missingId;
  const contexts = [];
  const watch = p => { p.setDefaultTimeout(30000); p.on("pageerror", error => result.errors.push(error.stack || error.message)); p.on("dialog", dialog => dialog.accept()); };
  const ready = async p => { await p.waitForFunction(() => window.App?.ready, null, { timeout: 60000 }); assert.equal(await p.evaluate(() => App.ready), true); };
  const check = async (name, run) => { result.stage = name; console.log("START " + name); await withDeadline(run, 180000, name); result.checks.push(name); persist(); console.log("PASS " + name); };
  const start = async () => {
    const env = { ...process.env, MOTIONBENCH_TEST_EXPORT_DIR: downloads }; delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({ executablePath: executable, args: ["--motionbench-test", "--motionbench-data-dir=" + profile], cwd: ROOT, env, timeout: 60000 });
    ownedChild = electron.process(); await electron.context().setOffline(true); page = await electron.firstWindow(); watch(page);
    await electron.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.hide(); window.setContentSize(1440, 1000);
      globalThis.__teamNativeDownloads = [];
      window.webContents.session.on("will-download", (_event, item) => item.once("done", (_done, state) => globalThis.__teamNativeDownloads.push({ state, path: item.getSavePath(), name: item.getFilename(), bytes: item.getReceivedBytes() })));
      if (!app.commandLine.hasSwitch("motionbench-test")) throw Error("Test mode is required");
    });
    await ready(page);
    assert.equal(path.resolve(await electron.evaluate(({ app }) => app.getPath("userData"))), profile);
    const identity = desktopArtifactIdentity(ROOT, executable, __filename);
    assert.equal(identity.runtimeMatchesSourceHtml, true); assert.match(identity.archiveSha256, /^[a-f0-9]{64}$/);
    if (result.identity) assert.deepEqual(identity, result.identity); else result.identity = identity;
    result.archiveSha256 = identity.archiveSha256;
    result.versions = await page.evaluate(() => ({ web: RingsideBuild.version, desktop: MotionBenchDesktop.version }));
    assert.deepEqual(result.versions, expectedVersions);
  };
  const close = async () => {
    assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true);
    const closed = electron.waitForEvent("close", { timeout: 60000 });
    await electron.evaluate(({ BrowserWindow }) => setImmediate(() => BrowserWindow.getAllWindows()[0].close()));
    await closed; electron = null;
  };
  const originals = () => page.evaluate(async () => (await App.getRepository().values("records")).map(r => ({ id: r.recordId, data: r.data, narrative: r.narrative })));
  const invariant = async () => assert.deepEqual(await originals(), original, "Team changes must preserve all personal source data and narratives");
  const edit = async text => { await page.evaluate(() => App.openEntry("narrative")); await page.locator("#interpEditor").fill(text); assert.equal(await page.evaluate(() => App.showReport(false)), "report"); assert.equal(await page.evaluate(() => App.saveNow()), true); };
  const download = async (kind, suffix, filename) => {
    const before = await electron.evaluate(() => globalThis.__teamNativeDownloads.length);
    const item = await waitForNativeDownload({ label: "Native " + kind + " completed download", trigger: () => page.evaluate(kind => App["download" + kind](), kind),
      read: async () => (await electron.evaluate(() => globalThis.__teamNativeDownloads)).slice(before).find(item => item.name.endsWith(suffix)) });
    assert.equal(item.state, "completed"); assert.ok(item.bytes > 100); assert.equal(path.dirname(path.resolve(item.path)), downloads); assert.equal(fs.statSync(item.path).size, item.bytes);
    const output = path.join(OUT, filename); fs.copyFileSync(item.path, output); artifact(output); return output;
  };
  const offline = async (file, operation) => {
    browser ||= await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ offline: true }); contexts.push(context); const extra = await context.newPage(); watch(extra);
    try { await extra.goto(pathToFileURL(file).href); await ready(extra); await operation(extra); } finally { await context.close(); }
  };
  try {
    await check("packaged candidate opens an owned temporary profile and synthetic roster", async () => {
      await start(); await page.evaluate(async create => { await App.importPayload((0, eval)("(" + create + ")")(), "replace-library"); await App.showReport(false); await App.saveNow(); }, fixture.toString());
      original = await originals(); assert.equal(original.length, 2); assert.equal(await page.evaluate(() => App.getLibrary().athletes.length), 3);
    });
    await check("team creates a separate owner with fixed sources, missing member and independent narrative", async () => {
      assert.equal(await page.evaluate(() => App.selectTeam({ title: "桌面团队验收", titleAuto: false, groupId: "native-team-group", participants: [{ athleteId: "native-team-a", recordId: "native-team-ra" }, { athleteId: "native-team-b", recordId: "native-team-rb" }, { athleteId: "native-team-missing", recordId: "" }], window: { kind: "custom", from: "2026-11-01", to: "2026-11-05" }, mode: "best", profileId: App.getLibrary().defaultEvaluationProfileId })), true);
      teamId = await page.evaluate(() => App.getTeamDocument().id); assert.equal(await page.evaluate(() => App.getTeam().summary.missing), 1);
      await edit("桌面团队独立正文，两人有数据、一人缺测。"); await page.locator("[data-team-kind]").first().selectOption("dot");
      assert.equal(await page.evaluate(() => App.saveNow()), true); assert.equal(await page.locator("#reportView").getAttribute("data-team-owner"), "team:" + teamId); await invariant(); expected = await page.evaluate(projection);
    });
    await check("normal close and restart preserve frozen snapshot, chart and team narrative", async () => {
      await close(); await start(); assert.deepEqual(await page.evaluate(projection), expected); await invariant();
    });
    await check("native JSON and editable HTML exports preserve all roster members and selected records", async () => {
      const jsonFile = await download("JSON", ".json", "team.json"), htmlFile = await download("HTML", ".html", "team.html");
      const payload = JSON.parse(fs.readFileSync(jsonFile, "utf8")); assert.equal(payload.kind, "team-report"); assert.equal(payload.library.athletes.length, 3); assert.equal(payload.library.athletes.flatMap(a => a.records).length, 2);
      await offline(path.join(ROOT, "MotionBench.html"), async p => { await p.evaluate(payload => App.importPayload(payload, "replace-library"), payload); assert.deepEqual(await p.evaluate(projection), expected); });
      await offline(htmlFile, async p => { assert.deepEqual(await p.evaluate(projection), expected); await p.reload(); await ready(p); assert.deepEqual(await p.evaluate(projection), expected); });
      await invariant();
    });
    await check("native complete backup uses schema 5 and restores the exact team document", async () => {
      const backupFile = await download("Library", ".motionbench.jsonl", "team.motionbench.jsonl"), text = fs.readFileSync(backupFile, "utf8"), rows = text.trim().split("\n").map(JSON.parse);
      assert.equal(rows[0].schema, 5); assert.equal(rows.at(-1).counts["team-report"], 1);
      await page.evaluate(async ({ text, id }) => { await App.importBackup(new File([text], "team.motionbench.jsonl", { type: "application/x-ndjson" }), false); if (!await App.restoreSavedReport("team:" + id)) throw Error("Restored team failed to open"); }, { text, id: teamId });
      assert.deepEqual(await page.evaluate(projection), expected); await invariant();
      await close(); await start(); assert.deepEqual(await page.evaluate(projection), expected); await invariant();
    });
    await check("all-missing roster persists without a personal record and exports through native download", async () => {
      assert.equal(await page.evaluate(() => App.selectTeam({ title: "桌面全部未测", titleAuto: false, participants: [{ athleteId: "native-team-a", recordId: "" }, { athleteId: "native-team-missing", recordId: "" }], window: { kind: "custom", from: "2026-11-01", to: "2026-11-05" }, mode: "best", profileId: App.getLibrary().defaultEvaluationProfileId })), true);
      missingId = await page.evaluate(() => App.getTeamDocument().id); assert.equal(await page.evaluate(() => App.getState()), null); await edit("缺测团队的独立正文。");
      const jsonFile = await download("JSON", ".json", "all-missing.json"), payload = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
      assert.equal(payload.library.athletes.length, 2); assert.equal(payload.library.athletes.flatMap(a => a.records).length, 0);
      await offline(path.join(ROOT, "MotionBench.html"), async p => { await p.evaluate(payload => App.importPayload(payload, "replace-library"), payload); assert.equal(await p.evaluate(() => App.getTeamDocument().id), missingId); assert.equal(await p.evaluate(() => App.getState()), null); assert.equal(await p.evaluate(() => App.getRepository().values("records").then(rows => rows.length)), 0); });
      const missing = await page.evaluate(projection); await close(); await start(); assert.deepEqual(await page.evaluate(projection), missing); assert.equal(await page.evaluate(() => App.getState()), null); await invariant();
    });
    await check("final normal exit retains identical packaged identity and source data", async () => {
      await invariant(); await close(); assert.deepEqual(desktopArtifactIdentity(ROOT, executable, __filename), result.identity); assert.equal(hash(__filename), result.runnerSha256); result.normalClose = true;
    });
    assert.deepEqual(result.errors, []); result.pass = true;
  } catch (error) { result.errors.push(error.stack || String(error)); process.exitCode = 1; console.error(error.stack || error); }
  finally {
    await finishNativeRun({ result, persist,
      diagnostics: !result.pass && page && !page.isClosed() ? async () => { result.failureState = await page.evaluate(() => ({ toast: document.querySelector("#toast")?.textContent, save: document.querySelector("#saveStatus")?.textContent, team: App.getTeamDocument()?.id })); } : null,
      normalClose: electron ? close : null, forceTerminate: ownedChild ? () => terminateOwnedTemporaryProcess({ child: ownedChild, executable, profile }) : null,
      closeOtherResources: async () => { await Promise.all(contexts.map(context => context.close())); await browser?.close(); } });
    if (!result.pass) process.exitCode = 1;
  }
  console.log(result.checks.length + " team native checks " + (result.pass ? "passed" : "completed before failure"));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
