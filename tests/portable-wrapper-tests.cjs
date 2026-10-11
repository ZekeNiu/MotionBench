"use strict";

// Exercise the NSIS wrapper itself. Connecting to its child application's CDP
// port avoids assuming the GUI wrapper forwards Electron's debugger stderr.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { chromium } = require("./helpers/playwright.cjs");

const root = path.resolve(__dirname, "..");
const out = path.resolve(process.env.MOTIONBENCH_PORTABLE_ARTIFACT_DIR || path.join(root, "output", "desktop-smoke", "portable"));
const originalExecutable = process.env.MOTIONBENCH_PORTABLE_EXECUTABLE;
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const evidence = { synthetic: true, platform: process.platform, version: packageVersion, checks: [], pass: false, startedAt: new Date().toISOString() };
const wrappers = new Set();
const temporaryRoot = process.platform === "win32" ? fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-便携 验收-")) : null;
let active;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const check = async (name, action) => { await action(); evidence.checks.push(name); console.log("PASS", name); };

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function launchWrapper(executable, dataDirectory, port) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const processHandle = spawn(executable, [
    `--motionbench-data-dir=${dataDirectory}`, "--motionbench-test",
    `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1",
  ], { cwd: path.dirname(executable), env: environment, windowsHide: false, stdio: "ignore" });
  const wrapper = { process: processHandle, exited: false, exitCode: null, error: null };
  wrapper.finished = new Promise(resolve => {
    processHandle.once("error", error => { wrapper.error = error; wrapper.exited = true; resolve(); });
    processHandle.once("exit", code => { wrapper.exitCode = code; wrapper.exited = true; resolve(); });
  });
  wrappers.add(wrapper);
  return wrapper;
}

async function connect(wrapper, port) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (wrapper.error) throw wrapper.error;
    if (wrapper.exited) throw Error(`Portable wrapper exited before its application opened: ${wrapper.exitCode}`);
    try {
      const response = await fetch(endpoint + "/json/version", { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch {}
    await sleep(100);
  }
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const context = browser.contexts()[0];
  assert.ok(context, "the real portable application exposes its renderer context");
  let page;
  for (let i = 0; i < 300; i++) {
    page = context.pages().find(candidate => candidate.url() === "motionbench://app/MotionBench.html");
    if (page) break;
    await sleep(100);
  }
  assert.ok(page, "the portable wrapper opens the application document");
  page.setDefaultTimeout(30000);
  await context.setOffline(true);
  await page.waitForFunction(() => window.App?.ready === true, null, { timeout: 45000 });
  return { wrapper, browser, context, page };
}

async function finish(wrapper, timeout = 30000) {
  let timer;
  try {
    await Promise.race([wrapper.finished, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Portable wrapper did not exit within the expected time")), timeout);
    })]);
  } finally { clearTimeout(timer); }
  if (wrapper.error) throw wrapper.error;
  assert.equal(wrapper.exitCode, 0, "the portable wrapper propagates a clean application exit");
  wrappers.delete(wrapper);
}

async function closeNormally(session) {
  // window.close() reaches the native BrowserWindow close handler and its
  // durable-save barrier; it is not a forced operating-system termination.
  await session.page.evaluate(() => { setTimeout(() => window.close(), 0); });
  await finish(session.wrapper);
  if (session.browser.isConnected()) await session.browser.waitForEvent("disconnected", { timeout: 10000 });
  assert.equal(session.browser.isConnected(), false, "the application's renderer debugger exits with its window");
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  try {
    assert.equal(process.platform, "win32", "portable wrapper verification requires real Windows");
    assert.ok(originalExecutable && fs.existsSync(originalExecutable), "provide the actual generated Portable.exe");
    const executableDirectory = path.join(temporaryRoot, "中文路径 便携程序");
    fs.mkdirSync(executableDirectory);
    const executable = path.join(executableDirectory, "MotionBench 便携验收.exe");
    fs.copyFileSync(originalExecutable, executable);
    assert.equal(hash(executable), hash(originalExecutable), "the moved portable executable is byte-identical to the deliverable");
    evidence.executableSha256 = hash(executable);
    const dataDirectory = path.join(temporaryRoot, "中文路径 桌面资料");
    const firstPort = await availablePort();
    active = await connect(launchWrapper(executable, dataDirectory, firstPort), firstPort);
    let athleteId;
    await check("the actual single-file portable wrapper starts from a path containing Chinese text and spaces", async () => {
      assert.equal(await active.page.evaluate(() => MotionBenchDesktop.version), packageVersion);
      assert.equal(await active.page.evaluate(() => RingsideBuild.version), packageVersion);
      assert.deepEqual(await active.page.evaluate(() => ({ require: typeof require, process: typeof process })), { require: "undefined", process: "undefined" });
      await active.page.evaluate(() => App.importPayload(RingsideModel.libraryDefaults(), "replace-library"));
      athleteId = await active.page.evaluate(() => App.createAthlete("便携程序真实包装器验收（合成）"));
      assert.ok(athleteId);
      assert.equal(await active.page.evaluate(() => App.saveNow()), true);
    });
    await check("repeated Portable.exe launch exits cleanly while the original application remains intact", async () => {
      const second = launchWrapper(executable, dataDirectory, await availablePort());
      await finish(second, 120000);
      assert.equal(active.wrapper.exited, false, "the first portable wrapper remains alive");
      assert.equal(active.browser.isConnected(), true);
      assert.equal(active.context.pages().filter(page => page.url() === "motionbench://app/MotionBench.html").length, 1);
      await active.page.reload();
      await active.page.waitForFunction(() => window.App?.ready === true);
      assert.equal(await active.page.evaluate(id => App.getLibrary().athletes.filter(athlete => athlete.id === id).length, athleteId), 1);
    });
    await check("the portable application exits through its native save barrier and a fresh wrapper restores its data", async () => {
      await closeNormally(active);
      active = null;
      const reopenedPort = await availablePort();
      active = await connect(launchWrapper(executable, dataDirectory, reopenedPort), reopenedPort);
      assert.equal(await active.page.evaluate(id => App.getLibrary().athletes.filter(athlete => athlete.id === id).length, athleteId), 1);
      assert.equal(await active.page.evaluate(() => MotionBenchDesktop.version), packageVersion);
      await active.page.screenshot({ path: path.join(out, "portable-wrapper-reopened.png"), fullPage: true });
      await closeNormally(active);
      active = null;
    });
    evidence.pass = true;
  } catch (error) {
    evidence.failure = error.stack || String(error);
    console.error(evidence.failure);
    process.exitCode = 1;
    if (active) try { await active.page.screenshot({ path: path.join(out, "portable-wrapper-failure.png"), fullPage: true }); } catch {}
  } finally {
    for (const wrapper of wrappers) {
      // Failure cleanup applies exclusively to our disposable verification
      // process trees; it never addresses another user's application process.
      if (process.platform !== "win32" || wrapper.exited || !wrapper.process.pid) continue;
      const killer = spawn("taskkill", ["/PID", String(wrapper.process.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await new Promise(resolve => { killer.once("exit", resolve); killer.once("error", resolve); });
    }
    if (temporaryRoot) try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      evidence.cleanupFailure = error.message;
      evidence.pass = false;
      process.exitCode = 1;
    }
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log(`${evidence.checks.length} portable wrapper checks completed; ${evidence.pass ? "PASS" : "FAIL"}`);
  }
})();
