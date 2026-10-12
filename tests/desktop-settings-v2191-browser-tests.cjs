"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"), { createHash } = require("node:crypto");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), source = path.join(root, "MotionBench.html");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.join(root, "output/playwright/v2191-settings");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const evidence = { synthetic: true, nativeBridge: "UI contract mock", channel, sourceHash: hash(source), runnerSha256: hash(__filename), checks: [], errors: [], screenshots: [], pass: false };
fs.mkdirSync(out, { recursive: true });
async function mockNative() {
  window.MotionBenchDesktop = { version: "2.19.1-desktop.1" };
  let listener, completeCheck, completeDownload, completePreferences;
  let current = { version: "2.19.1-desktop.1", webVersion: "2.19.1", portable: false, checkUpdatesOnStartup: true, preferenceError: "", state: "idle", availableVersion: "", progress: null, releaseNotes: "", releaseUrl: "", error: "", lastCheckedAt: "" };
  const emit = value => { Object.assign(current, value); listener?.(structuredClone(current)); return structuredClone(current); };
  window.__desktopTest = {
    emit,
    failPreferences: false,
    holdPreferences: false,
    finishPreferences: () => completePreferences?.(),
    finishCheck: () => completeCheck?.(emit({ state: "available", availableVersion: "2.19.1-desktop.2", releaseNotes: "修复保存与布局。\n<script>unsafe()</script>", releaseUrl: "https://github.com/ZekeNiu/MotionBench/releases/tag/v2.19.1-desktop.2", lastCheckedAt: "2026-10-12T08:00:00Z" })),
    finishDownload: () => completeDownload?.(emit({ state: "downloaded", progress: { percent: 100, transferred: 100, total: 100 } })),
  };
  window.MotionBenchNative = {
    getUpdateState: async () => structuredClone(current),
    onUpdateState: callback => { listener = callback; return () => { listener = null; }; },
    setUpdatePreferences: async preferences => {
      if (window.__desktopTest.failPreferences) throw Error("模拟磁盘写入失败");
      if (window.__desktopTest.holdPreferences) await new Promise(resolve => { completePreferences = resolve; });
      return emit({ ...preferences, preferenceError: "" });
    },
    checkForUpdates: () => { emit({ state: "checking", error: "" }); return new Promise(resolve => { completeCheck = resolve; }); },
    downloadUpdate: () => { emit({ state: "downloading", error: "", progress: { percent: 0, transferred: 0, total: 100 } }); return new Promise(resolve => { completeDownload = resolve; }); },
    installUpdate: async () => emit({ state: "downloaded", error: "模拟当前资料保存失败，请重试保存后更新。" }),
  };
}
(async () => {
  const browser = await chromium.launch({ channel, headless: true }), contexts = [];
  let page;
  const open = async desktop => {
    const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    if (desktop) await context.addInitScript(mockNative);
    const p = await context.newPage();
    p.on("pageerror", error => evidence.errors.push(error.message)); p.on("dialog", dialog => dialog.accept());
    await p.goto(pathToFileURL(source).href); await p.waitForFunction(() => window.App?.ready); assert.equal(await p.evaluate(() => App.ready), true);
    return p;
  };
  const check = async (name, action) => { await action(); evidence.checks.push(name); console.log("PASS " + name); };
  try {
    const html = await open(false);
    await check("standalone HTML hides desktop settings and refuses its route", async () => {
      assert.equal(await html.locator("#desktopSettingsButton").isVisible(), false);
      await html.evaluate(() => App.openSettings("app")); assert.equal(await html.evaluate(() => App.getUIState().mode), "report");
    });
    page = await open(true);
    await check("desktop settings owns versions and startup preference", async () => {
      await page.waitForFunction(() => !document.querySelector("#desktopSettingsButton").hidden);
      await page.locator("#desktopSettingsButton").click();
      await page.locator("#checkUpdatesOnStartup:not([disabled])").waitFor();
      assert.equal(await page.locator("#settingsTitle").innerText(), "应用设置");
      assert.equal(await page.locator("#recordContext").innerText(), "");
      assert.match(await page.locator(".desktop-version").innerText(), /2\.19\.1-desktop\.1/);
      assert.equal(await page.locator("#checkUpdatesOnStartup").isChecked(), true);
      await page.locator("#checkUpdatesOnStartup").uncheck();
      await page.waitForFunction(() => !document.querySelector("#checkUpdatesOnStartup").disabled);
      assert.equal(await page.locator("#checkUpdatesOnStartup").isChecked(), false);
    });
    await check("failed startup preference save restores checkbox and stays in settings", async () => {
      await page.evaluate(() => { __desktopTest.failPreferences = true; });
      await page.locator("#checkUpdatesOnStartup").click();
      await page.waitForFunction(() => document.querySelector(".desktop-update-error")?.textContent.includes("磁盘"));
      assert.equal(await page.locator("#checkUpdatesOnStartup").isChecked(), false);
      assert.equal(await page.locator("#toast").isVisible(), false);
      await page.evaluate(() => { __desktopTest.failPreferences = false; });
    });
    await check("pending startup preference write blocks exit and update until its durable completion", async () => {
      await page.evaluate(() => { __desktopTest.holdPreferences = true; });
      await page.locator("#checkUpdatesOnStartup").click();
      await page.waitForFunction(() => document.querySelector("#checkUpdatesOnStartup").disabled);
      const pending = await page.evaluate(() => App.prepareDesktopClose());
      assert.equal(pending.ok, false); assert.match(pending.reason, /启动检查设置/);
      assert.equal(pending.discardable, undefined, "a pending atomic write cannot be discarded");
      await page.evaluate(() => { __desktopTest.holdPreferences = false; __desktopTest.finishPreferences(); });
      await page.waitForFunction(() => !document.querySelector("#checkUpdatesOnStartup").disabled);
      assert.equal((await page.evaluate(() => App.prepareDesktopClose())).ok, true);
      await page.locator("#checkUpdatesOnStartup").uncheck();
      await page.waitForFunction(() => !document.querySelector("#checkUpdatesOnStartup").disabled);
    });
    await check("check is explicit and availability produces a single sidebar badge", async () => {
      await page.locator("#checkDesktopUpdateButton").click();
      assert.equal(await page.locator("#checkDesktopUpdateButton").isDisabled(), true);
      await page.evaluate(() => __desktopTest.finishCheck());
      await page.locator("#downloadDesktopUpdateButton:not([disabled])").waitFor();
      assert.equal(await page.locator("#desktopUpdateBadge").isVisible(), true);
      const badgeBounds = await page.locator("#desktopUpdateBadge").evaluate(node => ({ right: node.getBoundingClientRect().right, boundary: node.closest(".sidebar-action").getBoundingClientRect().right }));
      assert.ok(badgeBounds.right <= badgeBounds.boundary, "update badge must fit the navigation button");
      await page.locator("#desktopReleaseNotes > summary").click();
      assert.match(await page.locator("#desktopReleaseNotes").innerText(), /<script>unsafe\(\)<\/script>/);
      assert.equal(await page.locator("#desktopReleaseNotes script").count(), 0);
    });
    await check("progress preserves focused preference and release-note expansion", async () => {
      await page.locator("#downloadDesktopUpdateButton").click();
      await page.locator("#checkUpdatesOnStartup").focus();
      await page.evaluate(() => __desktopTest.emit({ progress: { percent: 47, transferred: 47, total: 100 } }));
      assert.equal(await page.locator("progress").getAttribute("value"), "47");
      assert.equal(await page.evaluate(() => document.activeElement.id), "checkUpdatesOnStartup");
      assert.equal(await page.locator("#desktopReleaseNotes").evaluate(node => node.open), true);
      await page.evaluate(() => App.showReport());
      await page.evaluate(() => __desktopTest.emit({ progress: { percent: 81, transferred: 81, total: 100 } }));
      assert.equal(await page.locator("#settingsView").isVisible(), false);
      assert.equal(await page.locator("#toast").isVisible(), false);
      assert.equal(await page.locator("#desktopUpdateBadge").isVisible(), true);
      await page.evaluate(() => __desktopTest.finishDownload());
      await page.locator("#desktopSettingsButton").click();
      await page.locator("#installDesktopUpdateButton:not([disabled])").waitFor();
    });
    await check("restart refusal keeps downloaded update and shows the save error locally", async () => {
      await page.locator("#installDesktopUpdateButton").click();
      await page.waitForFunction(() => document.querySelector("#desktopUpdateError")?.textContent.includes("保存失败"));
      assert.equal(await page.locator("#installDesktopUpdateButton").isEnabled(), true);
      assert.equal(await page.locator("#toast").isVisible(), false);
    });
    await check("application settings has no overflow at desktop and narrow widths", async () => {
      for (const width of [1440, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        const file = path.join(out, `${channel}-settings-${width}.png`); await page.screenshot({ path: file });
        evidence.screenshots.push({ path: path.relative(root, file).replaceAll("\\", "/"), sha256: hash(file) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check("old EUR AI draft stays intact and review status stays in the editor", async () => {
      await html.evaluate(async () => {
        const record = RingsideModel.defaults(); record.demo = false; record.athlete.name = "语义回归示例";
        Object.keys(record.enabled).forEach(id => record.enabled[id] = ["cmj", "sj"].includes(id));
        record.data.cmj = [{ id: "eur_cmj", height: 42 }]; record.data.sj = [{ id: "eur_sj", height: 40 }];
        await App.importPayload(RingsideModel.recordEnvelope(record), "replace-library");
        const state = App.getState(); Object.assign(state.narrative, { origin: "AI", text: "旧 AI 正文需要保留", html: "<p>旧 AI 正文需要保留</p>", basis: App.recordBasis() });
        delete state.narrative.capabilityDirectionsBasis; App.refreshWorkspace();
      });
      assert.equal(await html.locator("#interpState").innerText(), "AI稿");
      await html.evaluate(() => App.openEntry("narrative"));
      assert.match(await html.locator("#editorState").innerText(), /待复核/);
      assert.equal(await html.evaluate(() => App.getState().narrative.text), "旧 AI 正文需要保留");
      const facts = await html.evaluate(() => App.facts());
      assert.ok(facts.selectedCapabilityDirections.every(direction => direction.hasData));
      assert.match(facts.derived.analysis.results.find(result => result.id === "eur").directionHint, /SSC/);
      await html.evaluate(() => { const state = App.getState(); state.narrative.origin = "manual"; App.refreshWorkspace(); });
      assert.equal(await html.locator("#editorState").innerText(), "已填写");
      await html.evaluate(() => {
        const state = App.getState(); state.enabled.sj = false; state.narrative.origin = "AI";
        state.narrative.basis = App.recordBasis();
        const old = JSON.parse(RingsideModel.capabilityDirectionsBasis(App.effectiveRecord())); delete old.directionRules;
        state.narrative.capabilityDirectionsBasis = JSON.stringify(old); App.refreshWorkspace();
      });
      assert.equal(await html.locator("#editorState").innerText(), "AI稿", "an unrelated rule must not mark a record with no EUR for review");
    });
    assert.deepEqual(evidence.errors, []); evidence.pass = true;
  } catch (error) {
    evidence.failure = error.stack; console.error(error.stack); process.exitCode = 1;
    if (page) await page.screenshot({ path: path.join(out, `${channel}-failure.png`) }).catch(() => {});
  } finally {
    evidence.sourceUnchanged = hash(source) === evidence.sourceHash;
    evidence.pass = evidence.pass && evidence.sourceUnchanged;
    fs.writeFileSync(path.join(out, `${channel}.json`), JSON.stringify(evidence, null, 2));
    await Promise.all(contexts.map(context => context.close())); await browser.close();
    if (!evidence.pass) process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
