"use strict";

// Real Electron processes, isolated synthetic user profiles, and the native
// DownloadItem path are used throughout. No user's browser/profile is touched.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { _electron } = require("./helpers/playwright.cjs");
const ExcelJS = require("../vendor/exceljs.min.js");

const root = path.resolve(__dirname, "..");
const out = path.resolve(root, process.env.MOTIONBENCH_DESKTOP_ARTIFACT_DIR || "output/desktop-smoke");
const executablePath = process.env.MOTIONBENCH_EXECUTABLE || require("electron");
const packaged = Boolean(process.env.MOTIONBENCH_EXECUTABLE);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-desktop-test-"));
const downloads = path.join(out, "native-downloads");
fs.mkdirSync(downloads, { recursive: true });
const result = {
  synthetic: true,
  packaged,
  platform: process.platform,
  startedAt: new Date().toISOString(),
  checks: [],
  errors: [],
  network: [],
  artifacts: [],
  windows: [],
  pass: false,
};
const sessions = new Map();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const artifact = (file, kind) => {
  const bytes = fs.readFileSync(file);
  const detail = { path: path.relative(out, file).replaceAll("\\", "/"), kind, bytes: bytes.length, sha256: hash(bytes) };
  result.artifacts.push(detail);
  return detail;
};
const check = async (name, action) => {
  await action();
  result.checks.push(name);
  console.log("PASS", name);
};
const flags = dataDir => [
  `--motionbench-data-dir=${dataDir}`,
  "--motionbench-test",
  ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
];
const launchArgs = dataDir => [...(packaged ? [] : [root]), ...flags(dataDir)];
const launchEnv = () => {
  const env = { ...process.env, MOTIONBENCH_TEST_EXPORT_DIR: downloads };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
const field = (page, key) => page.locator(`[data-path="${key}"]`);
const recordSubset = record => ({
  recordId: record.recordId,
  athleteId: record.athleteId,
  athlete: record.athlete,
  enabled: record.enabled,
  data: record.data,
  acquisition: record.acquisition,
  trainingContext: record.trainingContext,
  projectSnapshots: record.projectSnapshots,
  testPlanSnapshot: record.testPlanSnapshot,
  evaluationProfileId: record.evaluationProfileId,
  definitions: record.definitions,
  customValues: record.customValues,
  fvpConfig: record.fvpConfig,
  fvpAnalysis: record.fvpAnalysis,
  sprintFvpConfig: record.sprintFvpConfig,
  sprintFvpAnalysis: record.sprintFvpAnalysis,
});

async function ready(page) {
  await page.waitForFunction(() => !!window.App?.ready, null, { timeout: 45000 });
  assert.equal(await page.evaluate(() => App.ready), true, "the actual application initializes successfully");
}
async function launch(dataDir, label) {
  const electron = await _electron.launch({ executablePath, args: launchArgs(dataDir), cwd: root, env: launchEnv(), timeout: 45000 });
  const child = electron.process();
  const owned = { label, child, launcherPid: child.pid, nativePid: null, closed: false };
  sessions.set(electron, owned);
  electron.once("close", () => { owned.closed = true; });
  owned.nativePid = await electron.evaluate(() => process.pid);
  const page = await electron.firstWindow({ timeout: 45000 });
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => result.errors.push({ session: label, message: error.message }));
  page.on("request", request => {
    if (/^(https?|wss?):/i.test(request.url())) result.network.push({ session: label, url: request.url() });
  });
  page.on("dialog", dialog => dialog.accept());
  await electron.context().setOffline(true);
  await ready(page);
  const nativeWindow = await electron.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const bounds = window.getBounds(), display = screen.getDisplayMatching(bounds);
    return { bounds, contentBounds: window.getContentBounds(), display: { size: display.size, workArea: display.workArea, scaleFactor: display.scaleFactor } };
  });
  const rendererWindow = await page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio, screenAvailable: { width: screen.availWidth, height: screen.availHeight } }));
  result.windows.push({ session: label, nativePid: owned.nativePid, launcherPid: owned.launcherPid, ...nativeWindow, renderer: rendererWindow });
  // Observe the existing native save handler instead of creating downloads or
  // supplying a Playwright saveAs path that could mask desktop integration bugs.
  await electron.evaluate(({ BrowserWindow }) => {
    globalThis.__desktopSmokeDownloads = [];
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    session.on("will-download", (_event, item) => {
      item.once("done", (_done, state) => globalThis.__desktopSmokeDownloads.push({
        state, path: item.getSavePath(), name: item.getFilename(), bytes: item.getReceivedBytes(), mimeType: item.getMimeType(),
      }));
    });
  });
  return { electron, page, dataDir, label, pid: owned.nativePid };
}
async function closeNatively(session) {
  const closed = session.electron.waitForEvent("close", { timeout: 45000 });
  closed.catch(() => {});
  await session.electron.evaluate(({ BrowserWindow }) => {
    // Let evaluation complete before closing the very process being evaluated.
    setImmediate(() => BrowserWindow.getAllWindows()[0].close());
  });
  await closed;
  sessions.delete(session.electron);
}
async function bounded(operation, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function terminateOwnedTree(owned) {
  // Playwright launches a command shell on Windows. Its PID owns the application
  // tree while alive; the separately recorded native PID covers an exited shell.
  const launcherAlive = owned.child.exitCode === null && owned.child.signalCode === null;
  const pid = launcherAlive ? owned.launcherPid : owned.nativePid;
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) throw Error("Missing isolated test-process identity for cleanup");
  if (process.platform === "win32") {
    return await new Promise(resolve => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, (error, _stdout, stderr) => resolve({
      pid, exitCode: error?.code ?? 0, error: error?.message || null, stderr: stderr.trim().slice(0, 2000),
    })));
  }
  // Playwright's POSIX launcher creates a separate process group. Signal only
  // that group, so browser helpers cannot retain the disposable profile's files.
  try { process.kill(-owned.launcherPid, "SIGKILL"); return { pid: owned.launcherPid, processGroup: true, exitCode: 0 }; }
  catch (error) { return { pid: owned.launcherPid, processGroup: true, error: error.message, code: error.code }; }
}
async function cleanupSession(electron, owned) {
  const detail = { session: owned.label, nativePid: owned.nativePid, launcherPid: owned.launcherPid, forced: false };
  if (!owned.closed) {
    // Install the exit observer before requesting exit, and await it even when
    // evaluation loses its connection as the native process stops. This forced
    // app exit is exclusively fault cleanup; closeNatively above tests the real
    // product save barrier and remains mandatory for a successful smoke run.
    const closed = electron.waitForEvent("close", { timeout: 10000 }).then(() => true, () => false);
    try {
      await bounded(electron.evaluate(({ app }) => { setImmediate(() => app.exit(1)); }), 5000, "Fault-cleanup exit request timed out");
    } catch (error) { detail.exitRequestError = error.message; }
    if (!await closed && !owned.closed) {
      detail.forced = true;
      const killed = electron.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
      detail.termination = await terminateOwnedTree(owned);
      await killed;
    }
  }
  detail.closed = owned.closed;
  detail.exitCode = owned.child.exitCode;
  detail.signal = owned.child.signalCode;
  return detail;
}
async function nativeDownload(session, extension, trigger, timeout = 240000) {
  const before = await session.electron.evaluate(() => globalThis.__desktopSmokeDownloads.length);
  await trigger();
  const deadline = Date.now() + timeout;
  let downloaded;
  while (Date.now() < deadline) {
    const events = await session.electron.evaluate(() => globalThis.__desktopSmokeDownloads);
    downloaded = events.slice(before).find(event => event.name.toLowerCase().endsWith(extension));
    if (downloaded) break;
    await session.page.waitForTimeout(100);
  }
  assert.ok(downloaded, `native ${extension} export completes within ${timeout} ms`);
  assert.equal(downloaded.state, "completed", `native ${extension} download succeeds`);
  assert.ok(downloaded.bytes > 100, `${extension} export contains actual bytes`);
  assert.equal(path.dirname(path.resolve(downloaded.path)), downloads, "native save handler uses the explicitly isolated automation output directory");
  assert.equal(fs.statSync(downloaded.path).size, downloaded.bytes);
  artifact(downloaded.path, "native-" + extension.slice(1));
  return downloaded.path;
}
async function entry(page, project) {
  // Public navigation only; values are entered through the renderer's controls.
  await page.evaluate(project => App.entry(project), project);
  await page.waitForFunction(project => App.getUIState().entryTab === project, project);
}
async function showReport(page) {
  await page.evaluate(() => App.showReport(false));
  await page.locator("#reportView").waitFor({ state: "visible" });
}
async function assertCharts(page) {
  const measured = await page.evaluate(() => {
    const record = App.getState();
    const diagrams = [...document.querySelectorAll("#reportView [data-chart-kind]")].map(node => ({
      kind: node.dataset.chartKind,
      svgs: [...node.querySelectorAll("svg")].map(svg => {
        const box = svg.getBoundingClientRect();
        return { width: box.width, height: box.height, paths: svg.querySelectorAll("path,line,circle,polyline,rect").length };
      }),
    }));
    return {
      diagrams,
      jump: ["fvp_sj", "fvp_cmj"].map(id => ({ id, valid: RingsideFVP.solve(record, id).valid })),
      sprint: RingsideSprintFVP.solve(record).valid,
      viewport: { innerWidth, innerHeight, devicePixelRatio, documentWidth: document.documentElement.scrollWidth },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  assert.ok(measured.jump.every(item => item.valid), "both native jump FVP models remain valid");
  assert.equal(measured.sprint, true, "native sprint FVP model remains valid");
  for (const kind of ["jumpFvp", "jumpElasticity", "sprintFvp"]) {
    const matching = measured.diagrams.filter(item => item.kind === kind);
    assert.ok(matching.length > 0, kind + " chart exists offline");
    assert.ok(matching.some(item => item.svgs.some(svg => svg.width > 100 && svg.height > 100 && svg.paths > 0)), kind + " renders real artwork at a usable size");
  }
  assert.equal(measured.overflow, false, "desktop report fits its native window");
  result.charts = measured;
}
async function createMeasurements(page) {
  await page.evaluate(() => App.importPayload(RingsideModel.libraryDefaults(), "replace-library"));
  const athleteId = await page.evaluate(() => App.createAthlete("Windows 桌面验收运动员（合成）"));
  const navigation = page.locator('[data-workspace-nav="entry"]');
  const sidebarToggle = page.locator("#sidebarToggle");
  if (!await navigation.isVisible() || await sidebarToggle.getAttribute("aria-expanded") !== "true" || await page.locator("#sidebar").evaluate(node => node.inert)) {
    await sidebarToggle.click();
    await page.waitForFunction(() => document.getElementById("sidebarToggle").getAttribute("aria-expanded") === "true" && !document.getElementById("sidebar").inert);
  }
  await navigation.click();
  await page.locator(`[data-creation-athlete="${athleteId}"]`).check();
  await page.locator("#creationNext").click();
  await page.locator("#creationTestStep").waitFor({ state: "visible" });
  for (const project of ["cmj", "fvp_sj", "fvp_cmj", "sprint_fvp"])
    await page.locator(`[data-picker-project="${project}"]`).check();
  await page.locator("#creationDate").fill("2026-10-11");
  await page.locator("#creationSubmit").click();
  await page.waitForFunction(() => App.getUIState().mode === "entry");
  await entry(page, "athlete");
  await field(page, "athlete.mass").fill("72");
  await field(page, "athlete.height").fill("178");
  await entry(page, "cmj");
  await field(page, "data.cmj.0.height").fill("41.5");
  for (const project of ["fvp_sj", "fvp_cmj"]) {
    await entry(page, project);
    await field(page, `fvpConfig.${project}.distanceCm`).fill("33");
    for (let i = 0; i < 5; i++) {
      if (!await field(page, `data.${project}.${i}.load`).count())
        await page.evaluate(project => App.addRow(project), project);
      await field(page, `data.${project}.${i}.load`).fill(String(i * 20));
      await field(page, `data.${project}.${i}.height`).fill(String([33, 27, 22, 14, 10][i] + (project === "fvp_cmj" ? 2 : 0)));
    }
  }
  await entry(page, "sprint_fvp");
  if (!await field(page, "data.sprint_fvp.0.splits.0.timeS").count())
    await page.evaluate(() => App.addRow("sprint_fvp"));
  const times = await page.evaluate(() => [5, 10, 20, 30].map(distance => RingsideSprintFVP.timeAtDistance(distance, 9, 1.2)));
  for (let i = 0; i < times.length; i++)
    await field(page, `data.sprint_fvp.0.splits.${i}.timeS`).fill(String(times[i]));
  await entry(page, "review");
  await page.locator("#entryFinish").click();
  await page.locator("#reportView").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => App.getLibrary().athletes.length), 1);
  assert.equal(await page.evaluate(() => App.getLibrary().athletes[0].records.length), 1);
}
async function secondInstance(session) {
  const child = spawn(executablePath, launchArgs(session.dataDir), { cwd: root, env: launchEnv(), windowsHide: true, stdio: "pipe" });
  let stderr = "";
  child.stderr.on("data", chunk => { if (stderr.length < 6000) stderr += chunk.toString(); });
  child.stdout.resume();
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("second instance did not exit within 20 seconds\n" + stderr)); }, 20000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.equal(exit.code, 0, "a second native instance exits cleanly and hands off to the first");
  assert.equal(await session.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(session.electron.process().exitCode, null, "original application process stays alive");
}
async function verifyManagementCloseGuards(page) {
  const status = () => page.evaluate(() => RingsideManagement.desktopCloseStatus());
  const clean = async () => assert.deepEqual(await status(), { busy: false, unsaved: false });
  await page.evaluate(() => App.viewEvaluation());
  await clean();
  assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true, "reading effective standards does not prevent a safe close");
  await page.locator("#managementModal button.close").click();

  await page.evaluate(() => App.openManagement("teams"));
  await page.locator('[data-manager-action="group-new"]').click();
  await clean();
  const teamName = page.locator('#managementFields input[name="name"]');
  await teamName.fill("尚未保存的合成队伍");
  assert.equal((await status()).unsaved, true);
  const discarded = await page.evaluate(() => App.prepareDesktopClose());
  assert.equal(discarded.ok, false);
  assert.equal(discarded.discardable, true, "a genuinely edited management form needs a deliberate discard decision");
  await teamName.fill("");
  await clean();
  await page.locator("#managementModal button.close").click();

  await page.evaluate(() => App.openManagement("plans"));
  await page.locator('[data-manager-action="plan-new"]').click();
  await clean();
  await page.locator("#testPlanName").fill("尚未保存的合成方案");
  assert.equal((await status()).unsaved, true);
  await page.locator('[data-manager-action="plan-close"]').click();
  await clean();

  await page.evaluate(() => App.editCurrentAthlete());
  await clean();
  const athleteName = page.locator('#managementFields input[name="name"]');
  const originalName = await athleteName.inputValue();
  await athleteName.fill(originalName + " 编辑草稿");
  assert.equal((await status()).unsaved, true);
  await athleteName.fill(originalName);
  await clean();
  // Suspend an actual public save operation to observe the transient submit
  // state. Releasing the gate runs the original save, preserving normal flow.
  await page.evaluate(() => {
    const original = App.updateAthleteProfile;
    const gate = new Promise(resolve => { window.__desktopReleaseProfileSave = resolve; });
    App.updateAthleteProfile = async (...args) => {
      await gate;
      return original(...args);
    };
    window.__desktopRestoreProfileSave = () => {
      App.updateAthleteProfile = original;
      delete window.__desktopReleaseProfileSave;
      delete window.__desktopRestoreProfileSave;
    };
  });
  try {
    await page.locator('#managementForm [type="submit"]').click();
    await page.waitForFunction(() => RingsideManagement.desktopCloseStatus().busy);
    assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, false, "closing is blocked during a management commit");
  } finally {
    await page.evaluate(() => window.__desktopReleaseProfileSave());
  }
  await page.locator("#managementModal").waitFor({ state: "hidden" });
  await page.evaluate(() => window.__desktopRestoreProfileSave());
  await clean();
  await showReport(page);
}
async function verifySaveFailureGuard(page) {
  const before = recordSubset(await page.evaluate(() => App.getState()));
  const checked = await page.evaluate(async () => {
    if (!await App.saveNow()) throw Error("initial verification save failed");
    const repository = App.getRepository(), original = repository.save.bind(repository);
    let attempts = 0;
    repository.save = (...args) => {
      attempts++;
      return attempts === 1 ? Promise.reject(Error("Synthetic one-time desktop save failure")) : original(...args);
    };
    try {
      const rejected = await App.prepareDesktopClose();
      const retried = await App.prepareDesktopClose();
      const stored = await repository.loadRecord(App.getState().recordId);
      return { rejected, retried, attempts, stored };
    } finally { repository.save = original; }
  });
  assert.equal(checked.rejected.ok, false, "a rejected durable write prevents native exit");
  assert.match(checked.rejected.reason, /保存/);
  assert.equal(checked.retried.ok, true, "the same close barrier succeeds after the genuine repository retry");
  assert.ok(checked.attempts >= 2);
  assert.deepEqual(recordSubset(checked.stored), before, "a failed close attempt and retry preserve all test measurements and identities");
  result.storageFailure = { rejected: checked.rejected, retried: checked.retried, attempts: checked.attempts };
}
async function saveSyntheticAIConnection(session) {
  const availability = await session.electron.evaluate(({ safeStorage }) => ({
    available: safeStorage.isEncryptionAvailable(),
    backend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend?.() || null : null,
  }));
  result.aiSettings = { availability };
  if (process.platform === "win32") assert.equal(availability.available, true, "Windows acceptance requires actual OS credential encryption");
  if (!availability.available || availability.backend === "basic_text") {
    const status = await session.page.evaluate(() => RingsideAISettings.status());
    assert.equal(status.state, "unsupported", "a non-Windows environment without real OS encryption fails closed");
    result.aiSettings.notVerified = "OS encryption is unavailable in this platform; Windows smoke must verify DPAPI";
    return null;
  }
  const syntheticKey = "synthetic-desktop-key-not-valid-" + randomUUID();
  const saved = await session.page.evaluate(async key => {
    const prior = await RingsideAISettings.status();
    return RingsideAISettings.save({ base: "https://motionbench-desktop-tests.invalid/v1", model: "synthetic-verification-model", key, expectedRevision: prior.revision });
  }, syntheticKey);
  assert.equal(saved.hasKey, true);
  assert.equal(saved.state, "ready");
  assert.equal(Object.hasOwn(saved, "key"), false, "a renderer settings response never returns the stored credential");
  const ciphertext = fs.readFileSync(path.join(session.dataDir, "ai-settings.dat"));
  assert.ok(ciphertext.length > 0);
  assert.equal(ciphertext.includes(Buffer.from(syntheticKey, "utf8")), false, "OS-encrypted file has no plaintext UTF-8 key");
  assert.equal(ciphertext.includes(Buffer.from(syntheticKey, "utf16le")), false, "OS-encrypted file has no plaintext Windows UTF-16 key");
  result.aiSettings.saved = saved;
  result.aiSettings.ciphertext = { bytes: ciphertext.length, sha256: hash(ciphertext), plaintextAbsent: true };
  await session.page.evaluate(() => App.loadAISettings(true));
  return saved;
}

(async () => {
  let active;
  try {
    const dataDir = path.join(temporaryRoot, "primary");
    active = await launch(dataDir, "first-process");
    await check("native application uses an isolated secure origin and no application HTTP server", async () => {
      assert.equal(active.page.url(), "motionbench://app/MotionBench.html");
      const native = await active.electron.evaluate(({ app, BrowserWindow }) => {
        const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
        return {
          appVersion: app.getVersion(), userData: app.getPath("userData"),
          prefs: { contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox, webSecurity: prefs.webSecurity, allowRunningInsecureContent: prefs.allowRunningInsecureContent },
          listeningApplicationServers: process._getActiveHandles().filter(handle => handle.constructor?.name === "Server" && handle.listening).map(handle => handle.address()),
        };
      });
      assert.equal(path.resolve(native.userData), path.resolve(dataDir));
      assert.deepEqual(native.prefs, { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false });
      assert.deepEqual(native.listeningApplicationServers, [], "MotionBench must not open a Node HTTP service; automation debugger sockets are outside this check");
      assert.deepEqual(await active.page.evaluate(() => ({ require: typeof require, process: typeof process, module: typeof module })), { require: "undefined", process: "undefined", module: "undefined" });
      const capabilities = await active.page.evaluate(() => ({
        keys: Object.keys(window.MotionBenchNative || {}).sort(),
        requestAI: typeof window.MotionBenchNative?.requestAI,
        cancelAI: typeof window.MotionBenchNative?.cancelAI,
        localKeys: Object.keys(window.MotionBenchLocal || {}).sort(),
        localNative: window.MotionBenchLocal?.native,
        hasToken: Object.hasOwn(window.MotionBenchLocal || {}, "token"),
        tokenType: typeof window.MotionBenchLocal?.token,
      }));
      assert.deepEqual(capabilities.keys, ["cancelAI", "requestAI"], "the preload exposes exactly two bounded AI operations");
      assert.equal(capabilities.requestAI, "function");
      assert.equal(capabilities.cancelAI, "function");
      assert.deepEqual(capabilities.localKeys, ["native"]);
      assert.equal(capabilities.localNative, true);
      assert.equal(capabilities.hasToken, false, "the private host token is absent from the renderer bootstrap");
      assert.equal(capabilities.tokenType, "undefined");
      const protocolPost = await active.page.evaluate(async () => {
        const response = await fetch("/api/ai-settings", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }),
        });
        return { status: response.status, contents: await response.text() };
      });
      assert.equal(protocolPost.status, 403, "the custom protocol never exposes the host AI settings service");
      const untrustedWindow = await active.electron.evaluate(async ({ BrowserWindow }, requestId) => {
        const preload = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().preload;
        const probe = new BrowserWindow({ show: false, webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
        try {
          await probe.loadURL("data:text/html,<title>Synthetic AI source-boundary probe</title>");
          const reply = await probe.webContents.executeJavaScript(`(async () => ({
            keys: Object.keys(window.MotionBenchNative || {}).sort(),
            response: await window.MotionBenchNative.requestAI("/api/ai-settings", '{"action":"status"}', ${JSON.stringify(requestId)})
          }))()`);
          return { url: probe.webContents.getURL(), ...reply };
        } finally { probe.destroy(); }
      }, randomUUID());
      assert.ok(untrustedWindow.url.startsWith("data:text/html,"));
      assert.deepEqual(untrustedWindow.keys, ["cancelAI", "requestAI"], "the untrusted probe uses the same actual preload");
      assert.equal(untrustedWindow.response.status, 403, "a different native window cannot use the workspace AI host");
      assert.equal(await active.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, "the source-boundary probe is always destroyed");
      const forbidden = await active.page.evaluate(async () => {
        const response = await fetch("motionbench://app/package.json");
        return { status: response.status, contents: await response.text() };
      });
      assert.ok(forbidden.status >= 400, "private application files are not served to the renderer");
      assert.ok(!forbidden.contents.includes('"devDependencies"'));
      result.native = native;
      result.native.aiBoundary = { capabilities, protocolPost, untrustedWindow };
      await active.page.reload();
      await ready(active.page);
    });
    await check("single instance lock prevents competing native windows", () => secondInstance(active));
    await check("manual athlete test entry renders jump and sprint charts with networking disabled", async () => {
      await createMeasurements(active.page);
      await assertCharts(active.page);
    });
    await check("the existing Copy analysis data button writes the native clipboard using a real user gesture", async () => {
      await active.page.evaluate(() => App.openSettings("ai"));
      await active.page.getByRole("button", { name: "复制分析资料", exact: true }).click();
      await active.page.waitForFunction(() => document.getElementById("toast")?.textContent.includes("已复制当前测试资料"));
      const expectedFacts = await active.page.evaluate(() => JSON.parse(JSON.stringify(App.facts())));
      const copiedFacts = await active.electron.evaluate(({ clipboard }) => clipboard.readText());
      assert.deepEqual(JSON.parse(copiedFacts), expectedFacts, "the native clipboard contains the complete current analysis payload, irrespective of Windows newline normalization");
      assert.equal(await active.page.locator("#previewModal").isVisible(), false, "clipboard permission does not force the manual-copy fallback modal");
      await showReport(active.page);
    });
    await check("management close guards distinguish actual edits, read-only views, reverted forms, and in-progress saves", () => verifyManagementCloseGuards(active.page));
    await check("a failed durable save prevents close and a real retry preserves every measurement", () => verifySaveFailureGuard(active.page));
    let savedAI;
    await check("AI settings use available OS encryption and never write a synthetic credential as plaintext", async () => {
      savedAI = await saveSyntheticAIConnection(active);
    });
    let expected;
    const firstPid = active.pid;
    await check("closing a native window flushes the latest edit and a separate process restores the same record", async () => {
      await active.page.evaluate(() => App.openEntry("cmj"));
      // No explicit save follows this final edit: the native close path must
      // await the application's pending durable writes itself.
      await field(active.page, "data.cmj.0.height").fill("41.75");
      expected = recordSubset(await active.page.evaluate(() => App.getState()));
      await closeNatively(active);
      active = await launch(dataDir, "restarted-process");
      assert.notEqual(active.pid, firstPid, "persistence is checked across actual operating-system processes");
      assert.deepEqual(recordSubset(await active.page.evaluate(() => App.getState())), expected);
      await showReport(active.page);
      await assertCharts(active.page);
      const file = path.join(out, "native-report-after-restart.png");
      await active.page.screenshot({ path: file, fullPage: true });
      artifact(file, "screenshot");
      result.recordId = expected.recordId;
    });
    let forgottenAI;
    if (savedAI) {
      await check("encrypted AI connection metadata and revision survive a separate native process", async () => {
        const restored = await active.page.evaluate(() => RingsideAISettings.status());
        assert.deepEqual(restored, savedAI);
        result.aiSettings.restoredAfterProcessRestart = true;
      });
      await check("forgetting the synthetic credential removes key availability without a provider request", async () => {
        forgottenAI = await active.page.evaluate(async () => {
          const current = await RingsideAISettings.status();
          return RingsideAISettings.forget({ expectedRevision: current.revision });
        });
        assert.equal(forgottenAI.hasKey, false);
        assert.equal(forgottenAI.state, "empty");
        assert.notEqual(forgottenAI.revision, savedAI.revision);
        result.aiSettings.forgotten = forgottenAI;
        await active.page.evaluate(() => App.loadAISettings(true));
      });
    }
    await check("an invalid numeric draft survives real close and restart while the stored measurement stays valid", async () => {
      await active.page.evaluate(() => App.openEntry("cmj"));
      await field(active.page, "data.cmj.0.height").fill("-5");
      assert.equal(await field(active.page, "data.cmj.0.height").getAttribute("aria-invalid"), "true");
      assert.equal(Number((await active.page.evaluate(() => App.getState())).data.cmj[0].height), 41.75);
      const draftPid = active.pid;
      await closeNatively(active);
      active = await launch(dataDir, "invalid-draft-restart");
      assert.notEqual(active.pid, draftPid);
      assert.equal(await field(active.page, "data.cmj.0.height").inputValue(), "-5", "the editable invalid draft is restored from desktop durable draft storage");
      assert.equal(await field(active.page, "data.cmj.0.height").getAttribute("aria-invalid"), "true");
      assert.deepEqual(recordSubset(await active.page.evaluate(() => App.getState())), expected, "an invalid draft never overwrites the last valid saved record");
      const draftScreenshot = path.join(out, "native-invalid-draft-after-restart.png");
      await active.page.screenshot({ path: draftScreenshot, fullPage: true });
      artifact(draftScreenshot, "restored-invalid-draft-screenshot");
      if (forgottenAI) {
        const current = await active.page.evaluate(() => RingsideAISettings.status());
        assert.deepEqual(current, forgottenAI);
        result.aiSettings.forgetSurvivesProcessRestart = true;
      }
      await field(active.page, "data.cmj.0.height").fill("41.75");
      assert.notEqual(await field(active.page, "data.cmj.0.height").getAttribute("aria-invalid"), "true");
      assert.equal(await active.page.evaluate(() => App.saveNow()), true);
      await showReport(active.page);
      result.invalidDraft = { restored: true, validMeasurementPreserved: true, corrected: true };
    });
    await check("XLSX export passes through the native save handler and opens as a populated workbook", async () => {
      await active.page.evaluate(() => App.openEntry("cmj"));
      const file = await nativeDownload(active, ".xlsx", () => active.page.getByRole("button", { name: "下载 Excel 模板", exact: true }).click());
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fs.readFileSync(file));
      assert.ok(workbook.worksheets.length > 0);
      const cmjSheet = workbook.worksheets.find(sheet => /CMJ/i.test(sheet.name) && !sheet.name.includes("补充"));
      assert.ok(cmjSheet, "native workbook contains CMJ data");
      assert.ok(cmjSheet.getSheetValues().flat(2).some(value => Number(value) === 41.75), "latest measurement is present in the exported native workbook");
    });
    await check("PDF export contains real jump, elastic-response, and sprint artwork without missing rows or charts", async () => {
      await showReport(active.page);
      await active.page.evaluate(() => {
        const capture = window.html2canvas;
        window.__desktopPDFChartKinds = [];
        window.html2canvas = (node, options) => {
          window.__desktopPDFChartKinds.push(...[...node.querySelectorAll("[data-chart-kind]")].map(chart => chart.dataset.chartKind));
          return capture(node, options);
        };
      });
      const file = await nativeDownload(active, ".pdf", async () => {
        const menu = active.page.locator("#reportExportMenu");
        if (!await menu.evaluate(node => node.open)) await menu.locator(":scope > summary").click();
        await menu.locator("[data-pdf-action]").click();
      });
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert.ok(bytes.subarray(-1024).toString().includes("%%EOF"));
      const pdf = await active.page.evaluate(() => ({ diagnostics: RingsidePDF.lastDiagnostics, chartKinds: window.__desktopPDFChartKinds }));
      assert.equal(pdf.diagnostics.status, "complete");
      for (const property of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"])
        assert.deepEqual(pdf.diagnostics[property], [], property);
      for (const kind of ["jumpFvp", "jumpElasticity", "sprintFvp"])
        assert.ok(pdf.chartKinds.includes(kind), kind + " has actual PDF artwork");
      result.pdf = pdf;
    });
    let backup;
    await check("full JSONL backup is saved through native download completion", async () => {
      await active.page.evaluate(() => App.openManagement("backup"));
      backup = await nativeDownload(active, ".jsonl", () => active.page.getByRole("button", { name: "导出完整备份", exact: true }).click());
      const rows = fs.readFileSync(backup, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.ok(rows.length > 2, "backup contains manifest, record, and integrity rows");
      assert.ok(rows.some(row => JSON.stringify(row).includes(expected.recordId)), "backup contains the actual persisted test identity");
      result.backupRows = rows.length;
    });
    await closeNatively(active);
    active = await launch(path.join(temporaryRoot, "recovery"), "fresh-recovery-process");
    await check("native file import restores JSONL into a fresh independent database without changing identities or measurements", async () => {
      await active.page.evaluate(() => App.importPayload(RingsideModel.libraryDefaults(), "replace-library"));
      assert.equal(await active.page.evaluate(() => App.getLibrary().athletes.length), 0);
      await active.page.evaluate(() => App.openManagement("backup"));
      await active.page.locator("#backupImportMode").selectOption("replace");
      await active.page.locator("#importFile").setInputFiles(backup);
      await active.page.waitForFunction(id => !document.body.hasAttribute("aria-busy") && App.getLibrary().athletes.some(athlete => athlete.records.some(record => record.recordId === id)), expected.recordId, { timeout: 60000 });
      assert.equal(await active.page.evaluate(() => App.getLibrary().athletes.length), 1);
      const restored = await active.page.evaluate(id => App.getRepository().loadRecord(id), expected.recordId);
      assert.deepEqual(recordSubset(restored), expected);
      assert.equal(await active.page.evaluate(() => App.getLibrary().athletes[0].id), expected.athleteId);
    });
    await check("ordinary desktop work and exports make no remote requests and produce no renderer exceptions", async () => {
      assert.deepEqual(result.network, []);
      assert.deepEqual(result.errors, []);
    });
    await closeNatively(active);
    active = null;
    result.pass = true;
  } catch (error) {
    result.failure = error.stack || String(error);
    console.error(result.failure);
    if (active) {
      try { const file = path.join(out, "failure.png"); await active.page.screenshot({ path: file, fullPage: true }); artifact(file, "failure-screenshot"); } catch {}
    }
    process.exitCode = 1;
  } finally {
    result.cleanup = { sessions: [], errors: [], temporaryProfileRemoved: false };
    for (const [electron, owned] of sessions) {
      try {
        const detail = await cleanupSession(electron, owned);
        result.cleanup.sessions.push(detail);
        if (!detail.closed) result.cleanup.errors.push({ session: owned.label, message: "Isolated native process did not close within bounded fault cleanup" });
      } catch (error) {
        result.cleanup.errors.push({ session: owned.label, message: error.message });
      }
    }
    try {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      result.cleanup.temporaryProfileRemoved = !fs.existsSync(temporaryRoot);
    } catch (error) { result.cleanup.errors.push({ stage: "temporary-profile", code: error.code, message: error.message }); }
    if (result.cleanup.errors.length) { result.pass = false; process.exitCode = 1; }
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2));
    console.log(`${result.checks.length} desktop checks completed; ${result.pass ? "PASS" : "FAIL"}`);
  }
})();
