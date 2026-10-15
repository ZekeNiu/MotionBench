"use strict";
// Preserve the real Explorer library through 2.24.3. This runner never imports,
// creates, edits or deletes records. Actual-profile stages only attach to an
// instance that the root operator already launched through the Desktop broker.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFile } = require("node:child_process"), { promisify } = require("node:util");
const { _electron, chromium } = require("./helpers/playwright.cjs");
const prior = require("./desktop-system-v2242.cjs");
const ROOT = path.resolve(__dirname, ".."), SOURCE = path.join(ROOT, "MotionBench.html");
const CHECKPOINT = String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261016-system-before-2.24.3`;
const INSTALLED = String.raw`D:\Application\Strength&Conditioning\MotionBench\MotionBench.exe`;
const EXAMPLE_NAME = "示例运动员｜纵向比较（合成）";
const DATES = ["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"];
const DEPENDENCIES = ["tests/desktop-system-v2242.cjs", "tests/helpers/playwright.cjs"];
const CHECKS = {
  baseline: ["Verified backed-up runtime and fresh real-system baseline copy", "Captured the complete original library and single-report calculations", "Existing four-record selection preserved every record and saved comparison", "Save barrier preserved the complete library and active comparison model", "Native application closed normally with unchanged producers and no renderer or network errors"],
  candidate: ["Verified final runtime and fresh real-system candidate copy", "Complete original library and single-report calculations match baseline", "Existing four-record selection preserved every record and saved comparison", "Existing comparison facts remain equal while new report fields are permitted", "Native JSON and HTML contain only the unchanged existing four-record report", "Native PDF and screenshots were produced from the existing comparison", "Save barrier preserved the complete library and active comparison model", "Native application closed normally with unchanged producers and no renderer or network errors"],
  installed: ["Verified installed runtime and Explorer physical profile identity", "Complete original library and single-report calculations match baseline", "Existing four-record selection preserved every record and saved comparison", "Existing comparison facts remain equal while new report fields are permitted", "Native installed comparison agrees with the verified candidate model", "Save barrier preserved the complete library and active comparison model", "Native application closed normally with unchanged producers and no renderer or network errors"],
  reopened: ["Verified installed runtime and Explorer physical profile identity", "Reopen restored the complete saved library selection and comparison", "Save barrier preserved the complete library and active comparison model", "Native application closed normally with unchanged producers and no renderer or network errors"]
};
/* VERIFY_CHECKS {"baseline":["Verified backed-up runtime and fresh real-system baseline copy","Captured the complete original library and single-report calculations","Existing four-record selection preserved every record and saved comparison","Save barrier preserved the complete library and active comparison model","Native application closed normally with unchanged producers and no renderer or network errors"],"candidate":["Verified final runtime and fresh real-system candidate copy","Complete original library and single-report calculations match baseline","Existing four-record selection preserved every record and saved comparison","Existing comparison facts remain equal while new report fields are permitted","Native JSON and HTML contain only the unchanged existing four-record report","Native PDF and screenshots were produced from the existing comparison","Save barrier preserved the complete library and active comparison model","Native application closed normally with unchanged producers and no renderer or network errors"],"installed":["Verified installed runtime and Explorer physical profile identity","Complete original library and single-report calculations match baseline","Existing four-record selection preserved every record and saved comparison","Existing comparison facts remain equal while new report fields are permitted","Native installed comparison agrees with the verified candidate model","Save barrier preserved the complete library and active comparison model","Native application closed normally with unchanged producers and no renderer or network errors"],"reopened":["Verified installed runtime and Explorer physical profile identity","Reopen restored the complete saved library selection and comparison","Save barrier preserved the complete library and active comparison model","Native application closed normally with unchanged producers and no renderer or network errors"]} VERIFY_CHECKS */
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex"), fileHash = file => hash(fs.readFileSync(file));
const readJSON = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const canonical = prior.canonical, same = prior.same, snapshot = prior.snapshot;
const arg = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; };
const normPath = value => path.resolve(String(value).replace(/^\\\\\?\\/, "")).toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const execute = promisify(execFile), PS = path.join(process.env.WINDIR, "System32/WindowsPowerShell/v1.0/powershell.exe");
async function powershell(code) {
  const { stdout } = await execute(PS, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from("$ErrorActionPreference='Stop';" + code, "utf16le").toString("base64")], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
}
function example(library) {
  const owners = library.athletes.filter(owner => owner.name === EXAMPLE_NAME && !owner.deletedAt);
  assert.equal(owners.length, 1, "The existing example must be unambiguous");
  const owner = owners[0], records = [...owner.records].sort((a, b) => a.athlete.date.localeCompare(b.athlete.date));
  assert.equal(records.length, 4); same(records.map(record => record.athlete.date), DATES);
  const recordIds = records.map(record => record.recordId), key = JSON.stringify([owner.id, [...recordIds].sort()]);
  const document = (library.longitudinalReports || []).find(doc => doc.athleteId === owner.id && doc.key === key);
  assert.ok(document, "The comparison must already be saved before verification");
  same([...document.recordIds].sort(), [...recordIds].sort()); assert.ok(document.narrative?.text?.trim());
  return { athleteId: owner.id, recordIds, dates: DATES, documentKey: key };
}
function documentProjection(document, sample) {
  const value = structuredClone(document);
  if (value?.athleteId === sample.athleteId && value.key === sample.documentKey) delete value.updated;
  return value;
}
function libraryProjection(library, sample) {
  const value = structuredClone(library);
  for (const key of ["version", "updated", "activeAthleteId", "activeRecordId"]) delete value[key];
  if (value.longitudinalReports) value.longitudinalReports = value.longitudinalReports.map(doc => documentProjection(doc, sample));
  return value;
}
function compareLibrary(actual, expected, sample) {
  same(libraryProjection(actual.library, sample), libraryProjection(expected.library, sample), "Every owner, record, timestamp, definition and saved comparison must remain unchanged");
  same(actual.reports, expected.reports, "Every single-report value, axis, evaluation, fingerprint and narrative must remain unchanged");
}
function comparisonProjection(comparison, sample) {
  const value = structuredClone(comparison);
  if (value?.document) value.document = documentProjection(value.document, sample);
  return value;
}
// The requested 2.24.3 additions extend the comparison representation. Preserve
// the original measured/resolved periods and selection independently of those
// new project rows and layout fields. Within one build the entire model is exact.
function comparisonFacts(comparison, sample) {
  assert.ok(comparison?.model, "The existing comparison must be active");
  const model = comparison.model;
  return { athleteId: comparison.athleteId, recordIds: comparison.recordIds, dates: comparison.dates,
    document: documentProjection(comparison.document, sample),
    model: Object.fromEntries(["kind", "version", "key", "athleteId", "athlete", "mode", "profile", "catalog", "records", "recordIds", "basis", "fingerprint", "periods"].map(key => [key, model[key]])) };
}
function compareSnapshots(actual, expected, sample, crossVersion = false) {
  compareLibrary(actual, expected, sample);
  same(crossVersion ? comparisonFacts(actual.activeComparison, sample) : comparisonProjection(actual.activeComparison, sample), crossVersion ? comparisonFacts(expected.activeComparison, sample) : comparisonProjection(expected.activeComparison, sample), crossVersion ? "Original comparison measurements, single-period reports, basis and saved document changed" : "Complete active comparison changed during inspection or save");
}
function verifyBackup(checkpoint) {
  const file = path.join(checkpoint, "manifest.json"), manifest = readJSON(file);
  assert.equal(manifest.complete, true); assert.equal(manifest.kind, "system-profile-checkpoint");
  assert.equal(manifest.source.virtualized, false); assert.equal(manifest.source.parentName.toLowerCase(), "explorer.exe");
  assert.equal(normPath(manifest.source.parentExecutable), normPath(path.join(process.env.WINDIR, "explorer.exe")));
  assert.equal(manifest.sourceUnchanged, true); assert.equal(manifest.fileCount, manifest.files.length);
  assert.equal(manifest.bytes, manifest.files.reduce((total, item) => total + item.bytes, 0));
  assert.equal(normPath(manifest.programReference.checkpoint), normPath(checkpoint));
  const inventories = [[manifest.files, "userdata", "system-userdata"], [manifest.programReference.files, "program", "program"]];
  for (const [files, kind, folder] of inventories) {
    assert.ok(files.length); assert.equal(new Set(files.map(item => item.path.toLowerCase())).size, files.length);
    for (const item of files) {
      assert.equal(item.kind, kind); assert.equal(normPath(item.physical), normPath(item.logical));
      const base = path.resolve(checkpoint, folder), target = path.resolve(base, item.path);
      assert.ok(normPath(target).startsWith(normPath(base) + path.sep));
      assert.equal(fileHash(target), item.sha256); assert.equal(fs.statSync(target).size, item.bytes);
    }
  }
  return { file, sha256: fileHash(file), manifest };
}
function verifyFreshProfile(profile, backup) {
  const files = fs.readdirSync(profile, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  assert.equal(files.length, backup.manifest.files.length, "Use a fresh checkpoint profile; preserve used profiles before retrying");
  for (const entry of backup.manifest.files) { const file = path.join(profile, entry.path); assert.equal(fileHash(file), entry.sha256); assert.equal(fs.statSync(file).size, entry.bytes); }
  return { files: files.length, bytes: backup.manifest.bytes, allFilesEqual: true };
}
async function protect(page, library, sample) {
  await page.evaluate(({ library, sample }) => {
    const canon = value => Array.isArray(value) ? value.map(canon) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])])) : value;
    const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    const owners = new Map(library.athletes.map(owner => [owner.id, owner]));
    const records = new Map(library.athletes.flatMap(owner => owner.records.map(record => [record.recordId, record])));
    const metadata = owner => { if (!owner) return null; const value = structuredClone(owner); delete value.records; return value; };
    const documents = values => values?.map(doc => { const value = structuredClone(doc); if (value.athleteId === sample.athleteId && value.key === sample.documentKey) delete value.updated; return value; });
    window.__preservation2243 = { writes: 0, blocked: [] };
    const reject = message => { window.__preservation2243.blocked.push(message); throw Error(message); };
    const checkRecords = values => { for (const record of values) if (!same(record, records.get(record.recordId))) reject("Existing raw record or narrative would change"); };
    const checkDocuments = values => { if (values !== undefined && !same(documents(values), documents(library.longitudinalReports))) reject("Existing comparison body, revision, views or basis would change"); };
    const repo = App.getRepository(), save = repo.save.bind(repo), saveRecords = repo.saveRecords.bind(repo);
    repo.saveRecords = async (values, checks, options = {}) => { checkRecords(values); checkDocuments(options.longitudinalReports); if (options.newAthletes?.length) reject("Adding an athlete is not verification"); window.__preservation2243.writes++; return saveRecords(values, checks, options); };
    repo.save = async (next, values = [], removals = {}, checks = {}) => {
      checkRecords(values); checkDocuments(next.longitudinalReports);
      if (Object.values(removals).some(value => Array.isArray(value) && value.length)) reject("Deleting data is not verification");
      if (next.athletes.length !== owners.size || next.athletes.some(owner => !same(metadata(owner), metadata(owners.get(owner.id))))) reject("Athlete metadata would change");
      for (const key of ["catalog", "evaluationProfiles", "testPlans", "groups", "defaultEvaluationProfileId"]) if (!same(next[key], library[key])) reject("Shared definitions or default evaluation profile would change");
      window.__preservation2243.writes++; return save(next, values, removals, checks);
    };
    for (const name of ["importLibrary", "importRows", "stageImport", "restorePrevious"]) if (typeof repo[name] === "function") repo[name] = async () => reject("Imports and restores are not verification");
  }, { library, sample });
}
async function selectExisting(page, sample) {
  if (await page.evaluate(id => App.getState()?.athleteId !== id, sample.athleteId)) assert.equal(await page.evaluate(id => App.selectAthlete(id), sample.athleteId), true);
  const current = await page.evaluate(() => App.getLongitudinal()?.recordIds || []);
  if (JSON.stringify([...current].sort()) !== JSON.stringify([...sample.recordIds].sort())) assert.equal(await page.evaluate(ids => App.selectRecords(ids), sample.recordIds), true);
  assert.equal(await page.evaluate(() => App.showReport(true)), "report");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  same(await page.locator("#recordChoices [data-record-choice]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.recordChoice).sort()), [...sample.recordIds].sort());
}
function assertActive(value, sample) {
  const active = value.activeComparison; assert.ok(active); assert.equal(active.athleteId, sample.athleteId);
  same(active.recordIds, sample.recordIds); same(active.dates, sample.dates);
  assert.equal(active.document.key, sample.documentKey); assert.ok(active.document.narrative?.text?.trim());
}
function verifyExport(payload, expected, sample) {
  assert.equal(payload.kind, "longitudinal-report"); assert.equal(payload.library.athletes.length, 1);
  const owner = expected.library.athletes.find(item => item.id === sample.athleteId), byId = values => [...values].sort((a, b) => a.recordId.localeCompare(b.recordId));
  const actualOwner = payload.library.athletes[0]; assert.equal(actualOwner.id, sample.athleteId);
  same(byId(actualOwner.records), byId(owner.records), "Selected export raw records changed");
  const metadata = value => { const copy = structuredClone(value); delete copy.records; return copy; }; same(metadata(actualOwner), metadata(owner));
  same(payload.selection, { athleteId: sample.athleteId, recordIds: expected.activeComparison.recordIds, mode: expected.activeComparison.model.mode });
  assert.equal(payload.library.longitudinalReports.length, 1); same(documentProjection(payload.library.longitudinalReports[0], sample), documentProjection(expected.activeComparison.document, sample));
  same(payload.library.catalog, expected.library.catalog);
  const ids = new Set([...owner.records.map(record => record.evaluationProfileId), expected.activeComparison.document.evaluationProfileId]);
  same(payload.library.evaluationProfiles, expected.library.evaluationProfiles.filter(profile => ids.has(profile.id)));
}
function saveSnapshot(directory, name, value, result) {
  const file = path.join(directory, name); fs.writeFileSync(file, JSON.stringify(value, null, 2));
  const sha256 = fileHash(file); result.snapshots.push({ file, sha256 }); return sha256;
}
async function attachInstalled(result, backup) {
  const port = Number(arg("--cdp-port")); assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const launchFile = path.resolve(arg("--launch-receipt") || ""), physicalFile = path.resolve(arg("--physical-before") || ""), physicalLaunchFile = path.resolve(arg("--physical-before-launch") || "");
  assert.ok(arg("--launch-receipt") && arg("--physical-before") && arg("--physical-before-launch"));
  const launch = readJSON(launchFile), physical = readJSON(physicalFile), physicalLaunch = readJSON(physicalLaunchFile), broker = path.join(ROOT, "scripts/invoke-from-desktop.ps1");
  for (const receipt of [launch, physicalLaunch]) { assert.equal(receipt.dispatched, true); assert.equal(receipt.method, "ShellWindows.FindWindowSW(8,1).Document.Application.ShellExecute"); assert.equal(receipt.launcherSha256, fileHash(broker)); assert.equal(normPath(receipt.desktopExecutable), normPath(path.join(process.env.WINDIR, "explorer.exe"))); }
  assert.equal(normPath(launch.targetPath), normPath(INSTALLED)); assert.equal(launch.targetSha256, result.executableSha256); assert.equal(launch.arguments, "--remote-debugging-port=" + port);
  assert.equal(physical.parentName.toLowerCase(), "explorer.exe"); assert.equal(physical.parentProcessId, physicalLaunch.desktopProcessId); assert.equal(normPath(physical.profile), normPath(backup.manifest.source.profile));
  assert.ok(physical.resolvedFiles.length); assert.equal(physical.files, physical.resolvedFiles.length);
  for (const entry of physical.resolvedFiles) { assert.ok(normPath(entry.logical).startsWith(normPath(physical.profile) + path.sep)); assert.equal(normPath(entry.physical), normPath(entry.logical)); }
  for (const name of ["ai-settings.dat", "desktop-preferences.json"]) { const before = backup.manifest.files.find(entry => entry.path === name), actual = physical.resolvedFiles.find(entry => normPath(entry.logical) === normPath(path.join(physical.profile, name))); assert.equal(!!actual, !!before); if (before) assert.equal(actual.sha256, before.sha256); }
  const identity = await powershell("$p=@(Get-CimInstance Win32_Process -Filter \"Name='MotionBench.exe'\" | Where-Object {$_.CommandLine -like '*--remote-debugging-port=" + port + "*' -and $_.CommandLine -notlike '*--type=*'});if($p.Count -ne 1){throw 'Expected one native main process'};$p=$p[0];$parent=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$p.ParentProcessId);[ordered]@{processId=$p.ProcessId;parentProcessId=$p.ParentProcessId;parentName=$parent.Name;executablePath=$p.ExecutablePath;commandLine=$p.CommandLine}|ConvertTo-Json -Compress");
  assert.equal(identity.parentName.toLowerCase(), "explorer.exe"); assert.equal(identity.parentProcessId, launch.desktopProcessId); assert.equal(normPath(identity.executablePath), normPath(INSTALLED)); assert.doesNotMatch(identity.commandLine, /--motionbench-test|--motionbench-data-dir|--user-data-dir/);
  const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, { timeout: 30000 }), context = browser.contexts()[0];
  assert.equal(browser.contexts().length, 1); const page = context.pages().find(item => item.url() === "motionbench://app/MotionBench.html"); assert.ok(page);
  const cdp = await browser.newBrowserCDPSession(), contexts = await cdp.send("Target.getBrowserContexts"); await cdp.detach(); assert.deepEqual(contexts.browserContextIds, []);
  Object.assign(result, identity, { userDataPath: physical.profile, sessionDataPath: physical.profile, actualProfile: true, systemContext: true, normalStartup: false, launchArgs: [launch.arguments], defaultSession: true,
    launchReceipt: { file: launchFile, sha256: fileHash(launchFile) }, physicalEvidence: { before: { file: physicalFile, sha256: fileHash(physicalFile), launchReceipt: { file: physicalLaunchFile, sha256: fileHash(physicalLaunchFile) } } } });
  return { browser, context, page, pid: identity.processId };
}
async function closeNative(session, result) {
  assert.equal((await session.page.evaluate(() => App.prepareDesktopClose())).ok, true);
  if (session.electron) { const closed = session.electron.waitForEvent("close", { timeout: 60000 }); await session.electron.evaluate(({ BrowserWindow }) => setImmediate(() => BrowserWindow.getAllWindows()[0].close())); await closed; }
  else { const receipt = await powershell("$p=Get-Process -Id " + session.pid + ";$sent=$p.CloseMainWindow();[ordered]@{processId=$p.Id;method='CloseMainWindow';requested=$sent}|ConvertTo-Json -Compress"); assert.equal(receipt.requested, true); let exited = false;
    for (let index = 0; index < 120; index++) { if (!await powershell("[bool](Get-Process -Id " + session.pid + " -ErrorAction SilentlyContinue)|ConvertTo-Json -Compress")) { exited = true; break; } await sleep(250); }
    assert.ok(exited, "The native window did not close normally"); result.closeEvidence = { ...receipt, exited }; await session.browser.close();
  }
  result.normalClose = true;
}
async function exportCandidate(session, selected, sample, result, out, stage) {
  const artifact = file => { result.artifacts.push({ file, bytes: fs.statSync(file).size, sha256: fileHash(file) }); };
  const paths = Object.fromEntries(["json", "html", "pdf"].map(extension => [extension, path.join(out, "existing-comparison." + extension)]));
  await session.electron.evaluate(({ BrowserWindow }, paths) => { globalThis.__preservationDownloads = []; const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.session.on("will-download", (_event, item, sender) => { if (sender !== contents) return; const file = paths[item.getFilename().split(".").at(-1).toLowerCase()]; if (!file) { item.cancel(); return; } item.once("done", (_event, state) => __preservationDownloads.push({ file: item.getSavePath(), state })); item.setSavePath(file); });
  }, paths);
  const download = async kind => { stage("Exporting existing comparison " + kind); const start = await session.electron.evaluate(() => __preservationDownloads.length);
    await session.page.evaluate(kind => App["download" + kind](), kind);
    const status = await session.page.evaluate(() => ({ blocked: __preservation2243.blocked, status: document.getElementById("saveStatus")?.textContent, toast: document.getElementById("toast")?.textContent }));
    assert.deepEqual(status.blocked, []); assert.ok(!/保存失败|导出失败/.test((status.status || "") + (status.toast || "")));
    let saved; const deadline = Date.now() + 900000; let nextUpdate = Date.now() + 30000;
    while (Date.now() < deadline) { saved = await session.electron.evaluate((_e, { start, file }) => __preservationDownloads.slice(start).find(item => item.file === file), { start, file: paths[kind.toLowerCase()] }); if (saved) break; if (Date.now() > nextUpdate) { console.log("Waiting for native " + kind + " download completion"); nextUpdate = Date.now() + 30000; } await sleep(100); }
    assert.ok(saved); assert.equal(saved.state, "completed"); artifact(saved.file); return saved.file;
  };
  const json = await download("JSON"), html = await download("HTML"); verifyExport(readJSON(json), selected, sample);
  const embedded = fs.readFileSync(html, "utf8").match(/<script\b[^>]*\bid="embedded-data"[^>]*>([\s\S]*?)<\/script>/i); assert.ok(embedded); verifyExport(JSON.parse(embedded[1]), selected, sample); result.checks.push(CHECKS.candidate[4]);
  const pdf = await download("PDF"); assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), "%PDF-"); result.pdfDiagnostics = await session.page.evaluate(() => RingsidePDF.lastDiagnostics); assert.equal(result.pdfDiagnostics?.status, "complete"); console.log("Existing comparison PDF completed: " + pdf);
  // Page screenshots do not scroll an element into view or change saved views.
  const image = path.join(out, "existing-comparison.png"); await session.page.screenshot({ path: image, fullPage: false }); artifact(image); result.checks.push(CHECKS.candidate[5]);
}
async function main() {
  const mode = process.argv[2]; assert.ok(Object.hasOwn(CHECKS, mode));
  const checkpoint = path.resolve(arg("--checkpoint") || CHECKPOINT), backup = verifyBackup(checkpoint), actual = ["installed", "reopened"].includes(mode);
  const profile = actual ? backup.manifest.source.profile : path.join(checkpoint, "system-" + mode + "-profile");
  const executable = mode === "baseline" ? path.join(checkpoint, "program/MotionBench.exe") : actual ? INSTALLED : path.join(ROOT, "dist-desktop/win-unpacked/MotionBench.exe");
  const directory = path.join(checkpoint, "verification", mode), out = path.resolve(arg("--artifact-dir") || path.join(ROOT, "output/playwright/v2243/preservation", mode));
  fs.mkdirSync(directory, { recursive: true }); assert.ok(!fs.existsSync(path.join(directory, "receipt.json")), "Preserve prior receipts before rerunning");
  if (mode === "candidate") { fs.mkdirSync(out, { recursive: true }); assert.equal(fs.readdirSync(out).length, 0, "Use an empty artifact directory"); }
  const archive = path.join(path.dirname(executable), "resources/app.asar"), runtime = hash(require("@electron/asar").extractFile(archive, path.normalize("MotionBench.html")));
  const result = { mode, pass: false, checks: [], errors: [], network: [], snapshots: [], artifacts: [], normalClose: false, pdfRequested: mode === "candidate", actualProfile: actual, normalStartup: false,
    runnerSha256: fileHash(__filename), dependencyHashes: Object.fromEntries(DEPENDENCIES.map(file => [file, fileHash(path.join(ROOT, file))])), workspaceSourceHash: fileHash(SOURCE), sourceHash: runtime, runtimeHtmlSha256: runtime,
    executablePath: executable, executableSha256: fileHash(executable), archivePath: archive, archiveSha256: fileHash(archive), profilePath: profile, backupManifest: backup.file, backupManifestSha256: backup.sha256 };
  const stage = value => { result.stage = value; console.log(mode + ": " + value); };
  let session;
  try {
    if (mode !== "baseline") assert.equal(runtime, result.workspaceSourceHash, "Final runtime must match final workspace HTML");
    if (actual) session = await attachInstalled(result, backup);
    else { result.profileCopy = verifyFreshProfile(profile, backup); result.launchArgs = ["--motionbench-test", "--motionbench-data-dir=" + profile]; const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.MOTIONBENCH_TEST_EXPORT_DIR;
      stage("Opening verified isolated real-profile copy"); const electron = await _electron.launch({ executablePath: executable, args: result.launchArgs, cwd: ROOT, env, timeout: 60000 }); session = { electron, context: electron.context(), page: await electron.firstWindow() };
      Object.assign(result, await electron.evaluate(({ app, session, BrowserWindow }) => ({ userDataPath: app.getPath("userData"), sessionDataPath: app.getPath("sessionData"), defaultSession: BrowserWindow.getAllWindows()[0].webContents.session === session.defaultSession })));
      assert.equal(normPath(result.userDataPath), normPath(profile)); assert.equal(normPath(result.sessionDataPath), normPath(profile)); assert.equal(result.defaultSession, true);
    }
    const page = session.page; page.setDefaultTimeout(30000); page.on("pageerror", error => result.errors.push(error.stack)); page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); }); page.on("dialog", dialog => dialog.dismiss());
    await session.context.setOffline(true); await page.waitForFunction(() => window.App?.ready, null, { timeout: 60000 }); assert.equal(await page.evaluate(() => App.ready), true);
    result.originURL = page.url(); assert.equal(result.originURL, "motionbench://app/MotionBench.html"); result.databaseName = await page.evaluate(() => App.getRepository().db.name); assert.equal(result.databaseName, "motionbench-v3:/MotionBench.html");
    result.version = await page.evaluate(() => MotionBenchDesktop.version); assert.equal(result.version, mode === "baseline" ? "2.24.2-desktop.1" : "2.24.3-desktop.1"); result.checks.push(CHECKS[mode][0]);
    stage("Capturing original library and all single-report calculations"); const startup = await snapshot(page), sample = example(startup.library); result.example = sample; result.counts = { athletes: startup.library.athletes.length, records: startup.reports.length };
    result.startupSnapshotSha256 = saveSnapshot(directory, "startup-snapshot.json", startup, result); let baseline;
    if (mode !== "baseline") { const file = path.join(checkpoint, "verification/baseline/snapshot.json"), receipt = readJSON(path.join(path.dirname(file), "receipt.json")); assert.equal(receipt.pass, true); assert.equal(receipt.runnerSha256, result.runnerSha256); assert.equal(receipt.snapshotSha256, fileHash(file)); baseline = readJSON(file); same(sample, example(baseline.library)); compareLibrary(startup, baseline, sample); result.baselineSnapshotSha256 = fileHash(file); }
    await protect(page, startup.library, sample);
    if (mode === "reopened") { const file = path.join(checkpoint, "verification/installed/snapshot.json"), receipt = readJSON(path.join(path.dirname(file), "receipt.json")); assert.equal(receipt.pass, true); assert.equal(receipt.runnerSha256, result.runnerSha256); assert.equal(receipt.snapshotSha256, fileHash(file)); compareSnapshots(startup, readJSON(file), sample); assertActive(startup, sample); result.installedSnapshotSha256 = fileHash(file); result.checks.push(CHECKS.reopened[1]); }
    else result.checks.push(CHECKS[mode][1]);
    stage("Checking the existing four-record comparison without editing"); if (mode !== "reopened") await selectExisting(page, sample);
    const selected = await snapshot(page); assertActive(selected, sample); compareLibrary(selected, startup, sample); result.selectedSnapshotSha256 = saveSnapshot(directory, "selected-snapshot.json", selected, result); result.selectionPreservedData = true;
    if (mode !== "reopened") result.checks.push(CHECKS[mode][2]);
    if (baseline && mode !== "reopened") { compareSnapshots(selected, baseline, sample, true); result.comparisonFactsPreserved = true; result.checks.push(CHECKS[mode][3]); }
    if (mode === "installed") { const file = path.join(checkpoint, "verification/candidate/snapshot.json"), receipt = readJSON(path.join(path.dirname(file), "receipt.json")); assert.equal(receipt.pass, true); assert.equal(receipt.runnerSha256, result.runnerSha256); assert.equal(receipt.snapshotSha256, fileHash(file)); compareSnapshots(selected, readJSON(file), sample); result.candidateSnapshotSha256 = fileHash(file); result.checks.push(CHECKS.installed[4]); }
    if (mode === "candidate") await exportCandidate(session, selected, sample, result, out, stage);
    stage("Saving and checking every original field and full active model"); assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true);
    const final = await snapshot(page); compareSnapshots(final, selected, sample); if (baseline) compareLibrary(final, baseline, sample);
    result.snapshotSha256 = saveSnapshot(directory, "snapshot.json", final, result); result.guard = await page.evaluate(() => __preservation2243); assert.deepEqual(result.guard.blocked, []); result.originalPreserved = result.afterSaveUnchanged = true; result.checks.push(CHECKS[mode].at(-2));
    stage("Closing through the normal native save barrier"); await closeNative(session, result); session = null;
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []);
    assert.equal(fileHash(SOURCE), result.workspaceSourceHash); assert.equal(fileHash(__filename), result.runnerSha256); assert.equal(fileHash(executable), result.executableSha256); assert.equal(fileHash(archive), result.archiveSha256);
    for (const [file, sha256] of Object.entries(result.dependencyHashes)) assert.equal(fileHash(path.join(ROOT, file)), sha256);
    result.checks.push(CHECKS[mode].at(-1)); same(result.checks, CHECKS[mode]); result.pass = true;
  } catch (error) { result.failure = error.stack; result.failureState = await session?.page.evaluate(() => ({ guard: window.__preservation2243 || null, status: document.getElementById("saveStatus")?.textContent, toast: document.getElementById("toast")?.textContent })).catch(() => null); process.exitCode = 1; console.error("Preservation verification failed; see private receipt."); }
  finally {
    if (session) try { await closeNative(session, result); } catch (error) { result.closeFailure = String(error); }
    result.sourceUnchanged = fileHash(SOURCE) === result.workspaceSourceHash; result.runnerUnchanged = fileHash(__filename) === result.runnerSha256;
    result.artifactUnchanged = fileHash(executable) === result.executableSha256 && fileHash(archive) === result.archiveSha256;
    result.dependenciesUnchanged = Object.entries(result.dependencyHashes).every(([file, sha256]) => fileHash(path.join(ROOT, file)) === sha256);
    fs.writeFileSync(path.join(directory, "receipt.json"), JSON.stringify(result, null, 2)); if (mode === "candidate") fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ mode, pass: result.pass, checks: result.checks.length, normalClose: result.normalClose, counts: result.counts }));
  }
}
module.exports = { CHECKS, CHECKPOINT, example, documentProjection, libraryProjection, comparisonProjection, comparisonFacts, compareLibrary, compareSnapshots, verifyBackup, verifyFreshProfile, protect, snapshot, verifyExport };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
