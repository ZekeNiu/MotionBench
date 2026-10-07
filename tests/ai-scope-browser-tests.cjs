"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html");
const out = path.join(root, "output/playwright/silver-ui");
fs.mkdirSync(out, { recursive: true });
const result = { sourceHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  synthetic: true, liveQualityEvidence: false, checks: [], errors: [], pass: false };
const reply = { choices: [{ message: { content: "## 综合判断\n\n下次训练安排分腿蹲 3 组 6 次，组间休息 2 分钟；结合恢复情况调整。" }, finish_reason: "stop" }] };
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on("pageerror", e => result.errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => {
      const r = App.getState(); r.narrative = { text: "教练原稿", html: "<p>教练原稿</p>", revision: 1, basis: RingsideModel.fingerprint(r) };
      App.openSettings("ai");
    });
    await page.locator("#apiURL").fill("https://ai-scope.invalid");
    await page.locator("#apiKey").fill("synthetic-scope-only");
    await page.locator("#apiModel").fill("test-model");
    const held = [];
    await page.route("https://ai-scope.invalid/**", route => { held.push(route); });
    async function start() {
      await page.evaluate(() => App.openEntry("narrative"));
      await page.locator("[data-ai-generate]").click();
      await page.waitForFunction(() => document.querySelector("#aiProgress").dataset.state === "running");
      while (!held.length) await page.waitForTimeout(30);
      return held.shift();
    }
    async function status(kind) {
      await page.waitForFunction(k => document.querySelector("#aiProgress").dataset.state === k, kind);
    }
    async function quiet() {
      assert.equal(await page.locator("#aiProgress").isVisible(), false, "No AI banner outside its views");
      assert.equal(await page.locator("#previewModal").isVisible(), false, "No automatic AI preview");
      assert.equal(await page.locator("#toast").isVisible(), false, "No floating AI message");
      assert.ok(!(await page.locator("#interpState").textContent()).includes("正在生成"), "Report describes saved text, not background task");
    }
    async function routeAcrossViews() {
      for (const [mode, tab] of [["report"], ["entry", "athlete"], ["entry", "cmj"], ["settings", "definitions"], ["settings", "references"]]) {
        await page.evaluate(([mode, tab]) => mode === "report" ? App.showReport() : mode === "entry" ? App.openEntry(tab) : App.openSettings(tab), [mode, tab]);
        await quiet();
      }
      await page.evaluate(() => App.openSettings("ai"));
      assert.equal(await page.locator("#aiProgress").isVisible(), true);
      // Same-page sub-navigation must hide the status synchronously as well.
      await page.locator('[data-settings-tab="references"]').click(); await quiet();
      await page.evaluate(() => App.openEntry("narrative"));
      assert.equal(await page.locator("#aiProgress").isVisible(), true);
      await page.locator('[data-entry-tab="athlete"]').click(); await quiet();
    }

    let pending = await start();
    await page.evaluate(() => App.showReport()); await quiet();
    await page.waitForTimeout(1150); await quiet();
    await routeAcrossViews();
    await pending.fulfill({ json: reply }); await status("ready"); await quiet();
    assert.equal(await page.evaluate(() => App.getState().narrative.text), "教练原稿");
    await page.evaluate(() => App.openEntry("narrative"));
    assert.equal(await page.locator("#previewModal").isVisible(), false);
    await page.locator("#aiReviewButton").click();
    assert.match(await page.locator("#aiPreview").textContent(), /分腿蹲/);
    await page.locator("#previewModal .close").click();
    result.checks.push("running-timer-and-background-ready-scoped-with-retained-draft");
    await routeAcrossViews(); result.checks.push("pending-draft-scoped-on-every-page-and-subpage");

    await page.evaluate(() => App.openEntry("narrative"));
    await page.locator("#aiReviewButton").click(); await page.locator("#applyDraftButton").click();
    await status("applied");
    assert.equal(await page.evaluate(() => App.getState().previousNarrative.text), "教练原稿");
    await routeAcrossViews(); result.checks.push("applied-status-scoped-and-previous-body-preserved");

    pending = await start(); await page.evaluate(() => App.showReport());
    await pending.fulfill({ status: 503, json: { error: { message: "Synthetic service unavailable" } } });
    await status("error"); await quiet(); await routeAcrossViews();
    result.checks.push("background-failure-no-toast-and-error-recoverable-on-return");

    pending = await start(); await page.locator("#aiCancelButton").click(); await status("cancelled");
    await routeAcrossViews(); await pending.fulfill({ json: reply }).catch(() => {});
    await page.waitForTimeout(150); await quiet();
    result.checks.push("cancelled-status-scoped-and-late-response-ignored");

    pending = await start(); await pending.fulfill({ json: reply });
    await page.locator("#previewModal.show").waitFor();
    await page.locator("#previewModal .close").click();
    result.checks.push("staying-on-narrative-keeps-automatic-preview");

    pending = await start(); await page.evaluate(() => { App.entry("athlete"); App.entry("narrative"); });
    await pending.fulfill({ json: reply }); await status("ready");
    assert.equal(await page.locator("#previewModal").isVisible(), false);
    await page.locator("#aiReviewButton").click(); await page.locator("#previewModal .close").click();
    result.checks.push("leaving-and-returning-before-completion-still-requires-manual-review");

    pending = await start(); await page.evaluate(() => App.saveMenu());
    await pending.fulfill({ json: reply }); await status("ready");
    assert.equal(await page.locator("#saveModal").isVisible(), true);
    assert.equal(await page.locator("#previewModal").isVisible(), false);
    await page.locator("#saveModal .close").click();
    assert.equal(await page.locator("#previewModal").isVisible(), false);
    await page.locator("#aiReviewButton").click(); await page.locator("#previewModal .close").click();
    result.checks.push("completion-does-not-replace-another-dialog");

    // Changing test data after a draft exists must invalidate manual review.
    await page.evaluate(() => { App.getState().athlete.mass += 1; });
    await page.locator("#aiReviewButton").click(); await status("error");
    assert.equal(await page.locator("#previewModal").isVisible(), false);
    result.checks.push("stale-draft-cannot-be-opened-or-applied");

    const original = await page.evaluate(() => ({ athleteId: App.getState().athleteId, recordId: App.getState().recordId }));
    // Existing public creation flow produces a second record for switch guards.
    pending = await start(); await page.evaluate(() => App.newTest());
    await page.locator("#newAthleteModal.show").waitFor();
    await page.locator("#creationSubmit").click();
    await page.waitForFunction(id => App.getState().recordId !== id, original.recordId);
    await pending.fulfill({ json: reply }).catch(() => {}); await status("idle");
    await page.evaluate(() => App.openEntry("narrative"));
    assert.equal(await page.locator("#aiProgress").isVisible(), false);
    assert.equal(await page.locator("#previewModal").isVisible(), false);
    await page.evaluate(id => App.selectRecord(id), original.recordId);
    await status("idle");
    result.checks.push("record-switch-clears-task-and-ignores-late-response-even-after-return");

    pending = await start(); await page.evaluate(() => App.openNewAthlete());
    await page.locator("#newAthleteModal.show").waitFor();
    await page.locator("#newAthleteName").fill("侧栏回归（模拟）");
    await page.locator("#creationNext").click();
    await page.locator("#creationProjects input[type=checkbox]").first().check();
    await page.locator("#creationSubmit").click();
    await page.waitForFunction(id => App.getState().athleteId !== id, original.athleteId);
    await pending.fulfill({ json: reply }).catch(() => {}); await status("idle");
    assert.equal(await page.locator("#previewModal").isVisible(), false);
    result.checks.push("athlete-switch-clears-old-task-state");
    assert.deepEqual(result.errors, []); result.pass = true;
    console.log("PASS", result.checks.length, "AI page-scope workflows");
  } catch (e) {
    result.failure = e.stack; process.exitCode = 1; console.error(e.message);
    if (page) await page.screenshot({ path: path.join(out, "ai-scope-failure.png") }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(out, "ai-scope.json"), JSON.stringify(result, null, 2));
    await browser.close();
  }
})();
