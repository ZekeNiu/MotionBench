"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs"), { createFixture } = require("./helpers/longitudinal-fixture.cjs");
const root = path.resolve(__dirname, ".."), argument = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const source = path.resolve(root, argument("--source", "MotionBench.html")), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.resolve(root, argument("--artifact-dir", "output/playwright/v224/longitudinal-ai/" + channel));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const reply = "## 纵向测量与训练安排\n\n结合本次实测变化，保留既有训练节奏并观察动作质量。\n\n- 周一进行分腿蹲3组6次，RPE 6，组间休息2分钟；连续两次动作稳定后增加负荷。\n- 周四安排低量跳跃，记录次日恢复情况；四周后按同一流程复测。";
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const result = { synthetic: true, liveQualityEvidence: false, channel, source: path.relative(root, source), sourceHash: hash(source), runnerSha256: hash(__filename), fixtureSha256: hash(path.join(__dirname, "helpers/longitudinal-fixture.cjs")), checks: [], errors: [], pass: false };
  const browser = await chromium.launch({ channel }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  page.setDefaultTimeout(25000); page.on("pageerror", error => result.errors.push(error.message));
  let ids, behavior = "success", conflictDecision = "dismiss", requestNumber = 0, lastRequest, held = [], conflicts = [];
  page.on("dialog", async dialog => {
    if (dialog.type() === "confirm" && dialog.message().includes("正文已有人工修改")) { conflicts.push(dialog.message()); await dialog[conflictDecision](); }
    else await dialog.accept();
  });
  const check = async (name, run) => { await run(); result.checks.push(name); console.log("PASS " + name); };
  const waitRequests = async count => {
    const end = Date.now() + 25000;
    while (requestNumber < count && Date.now() < end) await page.waitForTimeout(30);
    assert.equal(requestNumber, count, "expected one request per AI action");
  };
  const start = async next => { behavior = next; const count = requestNumber + 1; await page.locator("#reportAIButton").click(); await waitRequests(count); };
  const waitPreview = () => page.locator("#previewModal.show").waitFor();
  const closePreview = () => page.locator('#previewModal [aria-label="关闭草稿"]').click();
  const narrative = () => page.evaluate(() => (App.getLongitudinalDocument() || App.getState()).narrative.text);
  const writeBody = async text => { await page.evaluate(() => App.openEntry("narrative")); await page.locator("#interpEditor").fill(text); assert.equal(await narrative(), text); };
  const select = async chosen => { await page.evaluate(chosen => App.selectRecords(chosen), chosen); await page.evaluate(() => App.showReport(false)); };
  const release = async () => { const gate = held.shift(); assert.ok(gate, "held request exists"); gate.resolve(); await gate.done; };
  const noLatePreview = async () => { await page.waitForTimeout(100); assert.equal(await page.locator("#previewModal").isVisible(), false); assert.equal(await page.locator("#reportAIButton").isDisabled(), false); };
  try {
    await page.route("https://longitudinal-ai-tests.invalid/**", async route => {
      if (!route.request().url().endsWith("/chat/completions")) return route.fulfill({ json: { data: [{ id: "synthetic-model" }] } });
      const action = behavior; lastRequest = route.request().postDataJSON(); requestNumber++;
      let finish;
      if (action === "hold") {
        let resolve;
        const wait = new Promise(r => resolve = r), done = new Promise(r => finish = r);
        held.push({ resolve, done }); await wait;
      }
      try {
        if (action === "failure") await route.fulfill({ status: 503, json: { error: { message: "synthetic service failure" } } });
        else await route.fulfill({ json: { choices: [{ message: { content: reply } }] } });
      } catch (error) {
        if (action !== "hold" || !/closed|handled|cancel|abort|invalid|Fetch/i.test(error.message)) throw error;
      } finally { finish?.(); }
    });
    await page.goto(pathToFileURL(source).href); await page.waitForFunction(() => window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true);
    await check("isolated three-period fixture preserves distinct source narratives", async () => {
      ids = await page.evaluate(async factory => {
        const f = (0, eval)("(" + factory + ")")(window, 3), M = RingsideModel, lib = M.libraryDefaults();
        lib.catalog = f.catalog; lib.evaluationProfiles = [f.profile]; lib.defaultEvaluationProfileId = f.profile.id;
        f.records.forEach(record => record.evaluationProfileId = f.profile.id);
        lib.athletes = [{ id: f.athleteId, name: f.records[0].athlete.name, profile: M.profileFromRecord(f.records[0]), groupId: "", records: f.records, archived: false, deletedAt: null }];
        lib.activeAthleteId = f.athleteId; lib.activeRecordId = f.records[0].recordId;
        await App.importPayload(lib, "replace-library"); await App.showReport(false); return f.records.map(record => record.recordId);
      }, createFixture.toString());
      assert.match(await narrative(), /独立单期人工正文 0/);
    });
    await check("unconfigured report icon opens AI settings and returns to the same single report", async () => {
      await page.locator("#reportAIButton").click(); await page.waitForFunction(() => App.getUIState().mode === "settings");
      assert.equal(await page.evaluate(() => App.getUIState().settingsTab), "ai"); assert.equal(await page.evaluate(() => App.getState().recordId), ids[0]);
      await page.locator("#apiURL").fill("https://longitudinal-ai-tests.invalid"); await page.locator("#apiKey").fill("synthetic-only-key"); await page.locator("#apiModel").fill("synthetic-model");
      await page.locator("#workspaceBack").click(); await page.waitForFunction(() => App.getUIState().mode === "report"); assert.equal(await page.evaluate(() => App.getState().recordId), ids[0]); assert.equal(requestNumber, 0);
    });
    await check("single-report icon starts immediately and only explicit apply changes its body", async () => {
      const original = await narrative(); await start("success"); await waitPreview();
      assert.equal(await page.evaluate(() => App.getUIState().mode), "report"); assert.equal(await narrative(), original); assert.ok(!lastRequest.messages[0].content.includes("当前任务为同一运动员的纵向比较"));
      await page.locator("#aiPreview").fill("单期 AI 草稿经过人工审阅。"); await page.locator("#applyDraftButton").click(); await page.evaluate(() => App.saveNow());
      assert.equal(await narrative(), "单期 AI 草稿经过人工审阅。"); assert.equal(await page.evaluate(() => App.getState().previousNarrative.text), original);
      const others = await page.evaluate(async ids => Promise.all(ids.map(id => App.getRepository().loadRecord(id))), ids.slice(1)); assert.ok(others.every(record => record.narrative.text.startsWith("独立单期人工正文")));
    });
    await check("comparison icon supplies all selected periods and protects the separate manual body", async () => {
      await select(ids); await writeBody("比较人工正文：保持测量结果和训练计划分开判断。"); await page.evaluate(() => App.showReport(false));
      await start("success"); await waitPreview(); assert.ok(lastRequest.messages[0].content.includes("纵向比较"));
      const facts = JSON.parse(lastRequest.messages[1].content.slice(lastRequest.messages[1].content.indexOf("\n") + 1));
      assert.equal(facts.type, "single-athlete-longitudinal"); assert.deepEqual(facts.periods.map(period => period.recordId), ids);
      assert.equal(await narrative(), "比较人工正文：保持测量结果和训练计划分开判断。"); await closePreview();
    });
    await check("failed comparison request exposes retry and keeps the body untouched", async () => {
      const original = await narrative(); await start("failure"); await page.waitForFunction(() => document.getElementById("aiProgress").dataset.state === "error");
      assert.equal(await narrative(), original); assert.equal(await page.locator("#previewModal").isVisible(), false);
      behavior = "success"; const count = requestNumber + 1; await page.locator("#reportAIStatus").getByRole("button", { name: "重试", exact: true }).click(); await waitRequests(count); await waitPreview();
      assert.equal(await narrative(), original); await closePreview();
    });
    await check("cancelled delayed request cannot later open a draft and can be retried", async () => {
      const original = await narrative(); await start("hold"); await page.locator("#reportAIStatus").getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForFunction(() => document.getElementById("aiProgress").dataset.state === "cancelled"); await release(); await noLatePreview(); assert.equal(await narrative(), original);
      behavior = "success"; const count = requestNumber + 1; await page.locator("#reportAIStatus").getByRole("button", { name: "重试", exact: true }).click(); await waitRequests(count); await waitPreview(); await closePreview();
    });
    await check("delayed result cannot cross from one comparison selection to another", async () => {
      const original = await narrative(); await start("hold"); await select(ids.slice(0, 2)); const newOwner = await narrative(); await release(); await noLatePreview();
      assert.equal(await narrative(), newOwner); assert.equal(await page.evaluate(() => App.getLongitudinal().periods.length), 2);
      await select(ids); assert.equal(await narrative(), original);
    });
    await check("delayed result cannot cross from comparison to a single-record report", async () => {
      const original = await narrative(); await start("hold"); await select([ids[0]]); const single = await narrative(); await release(); await noLatePreview();
      assert.equal(await narrative(), single); assert.equal(await page.evaluate(() => App.getLongitudinal()), null); assert.equal(single, "单期 AI 草稿经过人工审阅。");
      await select(ids); assert.equal(await narrative(), original);
    });
    await check("manual edits during generation require explicit overwrite consent and preserve previous version", async () => {
      await start("hold"); const text = "生成期间人工补充：恢复状态仍需逐日观察。"; await writeBody(text); await release(); await waitPreview();
      const count = conflicts.length; conflictDecision = "dismiss"; await page.locator("#applyDraftButton").click(); assert.equal(conflicts.length, count + 1); assert.equal(await narrative(), text);
      conflictDecision = "accept"; await page.locator("#applyDraftButton").click(); assert.match(await narrative(), /纵向测量与训练安排/); assert.equal(await page.evaluate(() => App.getLongitudinalDocument().previousNarrative.text), text);
      await page.evaluate(() => App.showReport(false));
    });
    await check("manual edits after preview also reject silent replacement", async () => {
      await start("success"); await waitPreview(); await closePreview(); const text = "预览后人工修订：下周减少一次高强度跳跃。"; await writeBody(text);
      await page.evaluate(() => App.reviewAIDraft()); await waitPreview(); const count = conflicts.length; conflictDecision = "dismiss"; await page.locator("#applyDraftButton").click();
      assert.equal(conflicts.length, count + 1); assert.equal(await narrative(), text); await closePreview(); await page.evaluate(() => App.showReport(false));
    });
    await check("real period edit during generation recomputes comparison and marks retained body for review", async () => {
      const before = await page.evaluate(() => ({ basis: App.getLongitudinal().basis, narrative: App.getLongitudinalDocument().narrative.text, originals: App.getLongitudinal().records.map(record => ({ id: record.recordId, narrative: record.narrative.text })) }));
      await start("hold"); await page.locator("#editButton").click(); await page.locator(`[data-longitudinal-edit="${ids[0]}"]`).click(); await page.locator("#entryView").waitFor({ state: "visible" });
      await page.evaluate(() => App.entry("cmj")); await page.locator('[data-path="data.cmj.0.height"]').fill("50");
      result.editedPeriod = await page.evaluate(() => ({ id: App.getState().recordId, height: App.getState().data.cmj[0].height }));
      assert.equal(result.editedPeriod.id, ids[0]); assert.equal(Number(result.editedPeriod.height), 50); assert.equal(await page.evaluate(() => App.saveNow()), true);
      result.storedPeriod = await page.evaluate(async id => ({ height: (await App.getRepository().loadRecord(id)).data.cmj[0].height }), ids[0]);
      assert.equal(Number(result.storedPeriod.height), 50);
      await page.evaluate(() => App.showReport(false)); await release(); await noLatePreview();
      const after = await page.evaluate(() => ({ basis: App.getLongitudinal().basis, values: App.getLongitudinal().projects.flatMap(project => project.metrics).find(row => row.id === "cmj_height").cells.map(cell => cell.value), narrative: App.getLongitudinalDocument().narrative.text, originals: App.getLongitudinal().records.map(record => ({ id: record.recordId, narrative: record.narrative.text })) }));
      assert.deepEqual(after.values, [44, 42, 44]); assert.notEqual(after.basis, before.basis); assert.equal(after.narrative, before.narrative); assert.deepEqual(after.originals, before.originals);
      assert.match(await page.locator("#interpState").innerText(), /数据已更新.*待复核/); assert.equal(Number(await page.evaluate(async id => (await App.getRepository().loadRecord(id)).data.cmj[0].height, ids[0])), 50);
    });
    assert.deepEqual(result.errors, []); result.sourceUnchanged = hash(source) === result.sourceHash; assert.ok(result.sourceUnchanged); result.requestCount = requestNumber; result.pass = true;
  } catch (error) {
    result.failure = error.stack; result.ui = await page.evaluate(() => ({ mode: App.getUIState(), status: document.getElementById("aiProgress").dataset.state, title: document.getElementById("aiProgressTitle").textContent, detail: document.getElementById("aiProgressDetail").textContent, current: App.getState()?.recordId, owner: App.getLongitudinalDocument()?.key })).catch(() => null);
    await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {}); console.error(error.stack); console.error(result.ui); process.exitCode = 1;
  } finally {
    held.forEach(gate => gate.resolve()); result.sourceUnchanged = hash(source) === result.sourceHash; fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2)); await browser.close();
  }
}
main();
