"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { createHash } = require("node:crypto");
const { _electron } = require("playwright"), { desktopArtifactIdentity } = require("./helpers/desktop-artifact-identity.cjs");
const { seedFixture, assertFixture, beginCapture, finishCapture, assertExport } = require("./pdf-multiaxis-v221-browser-tests.cjs");
const root = path.resolve(__dirname, ".."), hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const executable = path.resolve(process.env.MOTIONBENCH_EXECUTABLE || path.join(root, "dist-desktop/win-unpacked/MotionBench.exe"));
const out = path.resolve(process.env.MOTIONBENCH_V221_PDF_ARTIFACT_DIR || path.join(root, "output/tests/v221-desktop/packaged-pdf"));

async function main() {
  assert.equal(process.platform, "win32"); assert.ok(fs.existsSync(executable)); fs.mkdirSync(out, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-native-v221-pdf-")), resolved = fs.realpathSync(temporary);
  const identity = desktopArtifactIdentity(root, executable, __filename);
  const result = { synthetic: true, packaged: true, platform: process.platform, sourceHash: identity.sourceHtmlSha256, identity, executableSha256: hash(executable), fixtureHelperSha256: hash(path.join(root, "tests/pdf-multiaxis-v221-browser-tests.cjs")), checks: [], errors: [], network: [], fixtures: [], pdfs: [], artifacts: [], pass: false };
  let electron;
  const check = async (name, action) => { await action(); result.checks.push(name); console.log("PASS " + name); };
  try {
    const env = { ...process.env, MOTIONBENCH_TEST_EXPORT_DIR: path.join(temporary, "downloads") }; delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({ executablePath: executable, args: ["--motionbench-test", "--motionbench-data-dir=" + temporary], cwd: root, env, timeout: 45000 });
    const page = await electron.firstWindow(); page.setDefaultTimeout(20000);
    page.on("dialog", dialog => dialog.accept()); await electron.context().setOffline(true);
    page.on("pageerror", error => result.errors.push(error.message)); page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
    await page.waitForFunction(() => !!window.App?.ready);
    assert.equal(await page.evaluate(() => App.ready), true);
    await check("packaged PDF renderer matches source HTML and uses an isolated synthetic profile", async () => {
      assert.equal(identity.runtimeMatchesSourceHtml, true); assert.equal(identity.sourceHtmlSha256, identity.runtimeHtmlSha256);
      result.versions = await page.evaluate(() => ({ desktop: MotionBenchDesktop.version, web: MotionBenchDesktop.webVersion, build: RingsideBuild.version }));
      assert.equal(result.versions.desktop, require("js-yaml").load(fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8")).extraMetadata.version);
      assert.equal(result.versions.web, require(path.join(root, "package.json")).version);
      const actual = await electron.evaluate(({ app }) => app.getPath("userData")); result.isolatedProfile = path.resolve(actual) === resolved;
      assert.equal(result.isolatedProfile, true);
    });
    await electron.evaluate(({ BrowserWindow }) => {
      globalThis.__v221NativeDownloads = [];
      BrowserWindow.getAllWindows()[0].webContents.session.on("will-download", (_event, item) => item.once("done", (_done, state) => __v221NativeDownloads.push({ name: item.getFilename(), state, path: item.getSavePath(), bytes: item.getTotalBytes() })));
    });
    for (const count of [3, 7]) await check(`native UI actually saves a ${count}-axis radar PDF with its heading and no calculation details`, async () => {
      const fixture = await seedFixture(page, count); assertFixture(fixture, count); result.fixtures.push(fixture);
      await beginCapture(page);
      const before = await electron.evaluate(() => __v221NativeDownloads.length);
      const menu = page.locator("#reportExportMenu"); if (!await menu.evaluate(node => node.open)) await menu.locator(":scope > summary").click();
      await menu.locator("[data-pdf-action]").click();
      let downloaded;
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline) { downloaded = await electron.evaluate((_electron, index) => __v221NativeDownloads.slice(index).find(item => /\.pdf$/i.test(item.name)), before); if (downloaded) break; await page.waitForTimeout(100); }
      assert.ok(downloaded, "Actual native PDF save must complete"); assert.equal(downloaded.state, "completed"); assert.ok(downloaded.bytes > 100);
      assert.ok(path.resolve(downloaded.path).startsWith(resolved + path.sep), "Native download must stay within the owned temporary profile");
      const file = path.join(out, `native-${count}-axes.pdf`); fs.copyFileSync(downloaded.path, file); assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), "%PDF-");
      const evidence = await finishCapture(page); result.pdfs.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: hash(file), axisCount: count, meanMembers: 0, ...evidence }); assertExport(evidence, fixture);
    });
    await check("native PDF export leaves the source executable archive and current measurements unchanged", async () => {
      result.finalIdentity = desktopArtifactIdentity(root, executable, __filename); result.artifactUnchanged = JSON.stringify(identity) === JSON.stringify(result.finalIdentity) && hash(executable) === result.executableSha256;
      assert.equal(result.artifactUnchanged, true); assert.equal(result.pdfs.length, 2); assert.equal(result.fixtures.length, 2);
    });
    result.pass = !result.errors.length && !result.network.length;
  } catch (error) { result.failure = error.stack; if (electron) { const page = await electron.firstWindow(); result.setupFailure = await page.evaluate(() => ({ saveStatus: document.getElementById("saveStatus")?.textContent, hasState: !!App.getState(), athleteCount: App.getLibrary()?.athletes?.length, activeAthleteId: App.getLibrary()?.activeAthleteId, stateAthleteId: App.getState()?.athleteId })); } console.error(result.failure, result.setupFailure); process.exitCode = 1; }
  finally {
    if (electron) await electron.close().catch(error => { result.cleanupFailure = error.message; result.pass = false; });
    assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("motionbench-native-v221-pdf-"));
    await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(error => { result.cleanupFailure = error.message; result.pass = false; });
    result.temporaryProfileRemoved = !fs.existsSync(resolved); result.sourceUnchanged = hash(path.join(root, "MotionBench.html")) === result.sourceHash;
    result.pass = result.pass && result.temporaryProfileRemoved && result.sourceUnchanged;
    fs.writeFileSync(path.join(out, "native-pdf-results.json"), JSON.stringify(result, null, 2)); if (!result.pass) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
