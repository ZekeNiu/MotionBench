"use strict";

// These cases exercise the delivered, offline HTML through its public controls.
// App getters are used for assertions and fixture inspection, never to skip the
// athlete -> record -> project-selection -> entry workflow being verified.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "Ringside_Boxing_Assessment.html");
const out = path.join(root, "output/playwright");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const only = (process.argv.find((x) => x.startsWith("--only=")) || "")
  .slice(7)
  .split(",")
  .filter(Boolean);
fs.mkdirSync(out, { recursive: true });
const results = {
  started: new Date().toISOString(),
  sourceHash: hash(fs.readFileSync(source)),
  isolation:
    "Fresh non-persistent Chromium contexts; file://; network offline; no user profile or storage.",
  aiVerification:
    "AI request content is checked against a locally intercepted simulated response. No live model call.",
  tests: [],
  browserErrors: [],
  networkRequests: [],
  artifacts: [],
};
let browser;

async function boot(width = 1440, filename = source, storedData = null) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    offline: true,
    acceptDownloads: true,
  });
  if (storedData)
    await context.addInitScript((data) => {
      if (sessionStorage.getItem("ringside-workflow-test-seeded")) return;
      localStorage.setItem(
        "ringside-library-v2:" + location.pathname,
        JSON.stringify(data),
      );
      sessionStorage.setItem("ringside-workflow-test-seeded", "true");
    }, storedData);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [],
    network = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(pathToFileURL(filename).href);
  await page.waitForFunction(
    () => window.App?.getState && window.RingsideModel,
  );
  return { context, page, errors, network };
}
async function shot(page, label, fullPage = false) {
  const filename = path.join(out, "workflow-" + label + ".png");
  await page.screenshot({ path: filename, fullPage });
  results.artifacts.push(filename);
  return filename;
}
async function check(id, name, operation) {
  if (only.length && !only.includes(id)) return;
  let session;
  try {
    session = await boot();
    const detail = await operation(session.page, session);
    assert.deepEqual(session.errors, [], "No browser execution errors");
    const unexpectedNetwork = session.network.filter(
      (url) =>
        !(
          detail?.simulatedAI &&
          url.startsWith("https://ringside-tests.invalid/")
        ),
    );
    assert.deepEqual(
      unexpectedNetwork,
      [],
      "Offline workflow must not request remote resources",
    );
    results.tests.push({ id, name, pass: true, detail });
    console.log("PASS " + name);
  } catch (error) {
    results.tests.push({
      id,
      name,
      pass: false,
      error: error.stack || String(error),
    });
    console.log("FAIL " + name + ": " + error.message);
    if (session) {
      try {
        await shot(session.page, "failure-" + id);
      } catch {}
    }
  } finally {
    if (session) {
      results.browserErrors.push(
        ...session.errors.map((message) => ({ id, message })),
      );
      results.networkRequests.push(
        ...session.network.map((url) => ({ id, url })),
      );
      await session.context.close();
    }
  }
}
const input = (page, dataPath) => page.locator(`[data-path="${dataPath}"]`);
const state = (page) => page.evaluate(() => App.getState());
const library = (page) => page.evaluate(() => App.getLibrary());
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const settled = (page) => page.waitForTimeout(280);
async function sidebar(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  if (await page.locator("#sidebar").evaluate((el) => el.inert))
    await page.locator("#sidebarToggle").click();
}
async function entry(page, tab) {
  await sidebar(page);
  if (await page.locator("#editButton").isVisible())
    await page.locator("#editButton").click();
  await sidebar(page);
  await page.locator(`#entryNav button[onclick*="'${tab}'"]`).click();
  await page.waitForFunction(
    (tab) =>
      App.getUIState().mode === "entry" && App.getUIState().entryTab === tab,
    tab,
  );
}
async function settings(page, tab) {
  await sidebar(page);
  const scope =
    tab === "catalog"
      ? "catalog"
      : ["ai", "references"].includes(tab)
        ? "app"
        : "record";
  await page.locator('[data-settings-open="' + scope + '"]').click();
  await page.locator(`#settingsTabs button[onclick*="'${tab}'"]`).click();
}
async function openCreation(page, kind = "athlete") {
  await sidebar(page);
  await page
    .locator(
      kind === "athlete"
        ? '#sidebar button[onclick="App.openNewAthlete()"]'
        : '#sidebar button[onclick="App.newTest()"] ',
    )
    .click();
  assert.equal(await page.locator("#newAthleteModal").isVisible(), true);
  await page.waitForFunction(
    (kind) =>
      document.activeElement?.id ===
      (kind === "athlete" ? "newAthleteName" : "creationDate"),
    kind,
  );
}
async function chooseCreationProjects(page, projects) {
  const checkboxes = page.locator('#creationProjects input[type="checkbox"]');
  for (const checkbox of await checkboxes.all()) {
    const id =
      (await checkbox.getAttribute("value")) ||
      (await checkbox.getAttribute("data-test-id"));
    await checkbox.setChecked(projects.includes(id));
  }
  assert.equal(
    await page
      .locator('#creationProjects input[type="checkbox"]:checked')
      .count(),
    projects.length,
  );
}
async function create(
  page,
  name = "流程验收运动员",
  projects = ["cmj", "sj", "pushup"],
  fields = {},
) {
  await openCreation(page);
  await page.locator("#newAthleteName").fill(name);
  if (fields.sex) await page.locator("#newAthleteSex").selectOption(fields.sex);
  if (fields.sport) await page.locator("#newAthleteSport").fill(fields.sport);
  if (fields.hand)
    await page.locator("#newAthleteHand").selectOption(fields.hand);
  if (fields.level) await page.locator("#newAthleteLevel").fill(fields.level);
  await page.locator("#creationNext").click();
  assert.equal(
    await page
      .locator('#creationProjects input[type="checkbox"]:checked')
      .count(),
    0,
    "First test starts empty",
  );
  if (fields.date) await page.locator("#creationDate").fill(fields.date);
  await chooseCreationProjects(page, projects);
  await page.locator("#creationSubmit").click();
  await page.waitForFunction(() => App.getUIState().mode === "entry");
  await settled(page);
  assert.equal(await page.locator("#newAthleteModal").isVisible(), false);
  const record = await state(page);
  assert.equal(record.athlete.name, name);
  assert.deepEqual(
    Object.keys(record.enabled)
      .filter((id) => record.enabled[id])
      .sort(),
    projects.slice().sort(),
  );
  assert.equal(
    await page.evaluate(() => App.getUIState().entryTab),
    projects[0],
  );
  return record;
}
async function createRecord(page, projects, date) {
  await openCreation(page, "record");
  if (date) await page.locator("#creationDate").fill(date);
  if (projects) await chooseCreationProjects(page, projects);
  await page.locator("#creationSubmit").click();
  await page.waitForFunction(() => App.getUIState().mode === "entry");
  await settled(page);
  return state(page);
}
async function selectRecord(page, id) {
  await sidebar(page);
  await page.locator("#recordSelect").selectOption(id);
  await settled(page);
}
async function selectAthlete(page, id) {
  await sidebar(page);
  await page.locator("#athleteSelect").selectOption(id);
  await settled(page);
}
async function importFile(page, filename) {
  await sidebar(page);
  await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
  await page.locator("#importFile").setInputFiles(filename);
  await settled(page);
}
async function download(page, name, filename) {
  await sidebar(page);
  await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
  const waiting = page.waitForEvent("download");
  await page
    .locator("#saveModal")
    .getByRole("button", { name, exact: true })
    .click();
  const file = await waiting;
  const destination = path.join(out, filename);
  await file.saveAs(destination);
  results.artifacts.push(destination);
  if (await page.locator("#saveModal").isVisible())
    await page
      .locator("#saveModal")
      .getByRole("button", { name: "关闭保存", exact: true })
      .click();
  return destination;
}
async function addCatalogProject(page, fields = {}) {
  await settings(page, "catalog");
  await page
    .locator("#settingsContent")
    .getByRole("button", { name: /新增测试项目$/ })
    .click();
  await page
    .locator("#catalogTestName")
    .fill(fields.name || "专项速度核验项目");
  await page
    .locator("#catalogMetricName")
    .fill(fields.metric || "专项峰值速度");
  await page.locator("#catalogUnit").fill(fields.unit || "m/s");
  // Preserve the suite's record-summary fixtures; repeat-browser-tests covers the new default.
  await page.locator("#catalogEntryScope").selectOption("record");
  await page.locator("#catalogAbility").fill(fields.ability || "专项速度");
  await page
    .locator("#catalogCategory")
    .selectOption(fields.category || "performance");
  await page
    .locator("#catalogDirection")
    .selectOption(fields.direction || "higher");
  await page.locator("#catalogTarget").fill(String(fields.target ?? 5));
  await page.locator('#catalogForm button[type="submit"]').click();
  await settled(page);
  assert.equal(await page.locator("#catalogModal").isVisible(), false);
  const catalog = (await library(page)).catalog;
  const project = catalog.tests.find(
    (test) => test.name === (fields.name || "专项速度核验项目"),
  );
  assert.ok(project, "New project is available in shared catalog");
  const metric = catalog.definitions.find(
    (definition) => definition.testId === project.id,
  );
  assert.ok(metric);
  return { project, metric };
}

async function run() {
  await check(
    "embedded-source",
    "单文件内嵌全部正式模块并与源码一致",
    async () => {
      const html = fs.readFileSync(source, "utf8").replace(/\r\n/g, "\n");
      const scripts = [
        ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
      ].map((m) => m[1].trim());
      const modules = fs
        .readdirSync(path.join(root, "src"))
        .filter((name) => name.endsWith(".js"));
      const matches = modules.map((name) => {
        const expected = fs
          .readFileSync(path.join(root, "src", name), "utf8")
          .replace(/\r\n/g, "\n")
          .trim()
          .replaceAll("</script", "<\\/script");
        const match = scripts.includes(expected);
        assert.equal(match, true, `${name} must match the delivered HTML`);
        return { file: name, sha256: hash(expected), matches: match };
      });
      assert.deepEqual(
        modules.sort(),
        [
          "app",
          "calc",
          "definitions",
          "model",
          "interventions",
          "pdf",
          "report",
          "settings",
          "tests",
          "viz",
        ]
          .map((name) => "ringside-" + name + ".js")
          .sort(),
      );
      return matches;
    },
  );
  await check(
    "creation",
    "逐位运动员建档、专项惯用手、选项目后直接录入",
    async (page) => {
      const record = await create(page, "建档核验", ["cmj", "sj", "pushup"], {
        sex: "女",
        sport: "散打",
        hand: "左手",
        level: "青年组",
      });
      assert.equal(record.athlete.sport, "散打");
      assert.equal(record.athlete.dominantHand, "左手");
      assert.equal(record.athlete.sex, "女");
      assert.equal(record.athlete.sportLevel, "青年组");
      const athlete = (await library(page)).athletes.find(
        (a) => a.id === record.athleteId,
      );
      assert.equal(athlete.profile.sport, "散打");
      assert.equal(athlete.profile.dominantHand, "左手");
      assert.equal(athlete.records.length, 1);
      assert.equal(await page.evaluate(() => App.stats().validTests.size), 0);
      const identity = await page.locator("#entryIdentity").innerText();
      assert.ok(
        identity.includes("建档核验") && identity.includes(record.athlete.date),
      );
      await page.locator("#entryNext").click();
      assert.equal(await page.evaluate(() => App.getUIState().entryTab), "sj");
      await page.locator("#entryPrevious").click();
      assert.equal(await page.evaluate(() => App.getUIState().entryTab), "cmj");
      return {
        athleteId: record.athleteId,
        recordId: record.recordId,
        identity,
      };
    },
  );
  await check(
    "creation-cancel",
    "创建草稿取消无档案或空测试残留且双击只创建一次",
    async (page) => {
      const before = await library(page);
      await openCreation(page);
      await page.waitForFunction(
        () => document.activeElement?.id === "newAthleteName",
      );
      assert.equal(
        await page
          .locator("#newAthleteName")
          .evaluate((el) => document.activeElement === el),
        true,
      );
      await page.locator("#newAthleteName").fill("应取消");
      await page.locator("#newAthleteName").press("Enter");
      assert.equal(await page.locator("#creationTestStep").isVisible(), true);
      await page.locator("#newAthleteModal button.close").click();
      assert.deepEqual((await library(page)).athletes, before.athletes);
      await openCreation(page);
      await page.locator("#newAthleteName").fill("防重复核验");
      await page.locator("#creationNext").click();
      assert.equal(
        await page.locator("#creationSubmit").isDisabled(),
        true,
        "No project selected: creation is blocked",
      );
      assert.deepEqual((await library(page)).athletes, before.athletes);
      await chooseCreationProjects(page, ["cmj"]);
      await page.locator("#creationSubmit").dblclick();
      await settled(page);
      const created = (await library(page)).athletes.filter(
        (a) => a.name === "防重复核验",
      );
      assert.equal(created.length, 1);
      assert.equal(created[0].records.length, 1);
      await openCreation(page, "record");
      await page.locator("#newAthleteModal button.close").click();
      assert.equal(
        (await library(page)).athletes.find((a) => a.id === created[0].id)
          .records.length,
        1,
      );
      return { doubleClickRecordCount: created[0].records.length };
    },
  );
  await check(
    "latest-by-date",
    "新增测试按日期和同日创建顺序沿用项目，不沿用正在查看的旧记录",
    async (page) => {
      const first = await create(page, "历史来源核验", ["cmj"], {
        date: "2026-09-01",
        sport: "拳击",
        hand: "右手",
        level: "成年组",
      });
      const recent = await createRecord(page, ["sj", "pushup"], "2026-09-30");
      const sameDay = await createRecord(page, ["pushup"], "2026-09-30");
      const backdated = await createRecord(page, ["iso"], "2026-09-05");
      await selectRecord(page, first.recordId);
      await openCreation(page, "record");
      assert.equal(
        await page.locator("#creationProfileStep").isVisible(),
        false,
      );
      assert.ok(
        (await page.locator("#creationSource").innerText()).includes(
          "2026-09-30",
        ),
      );
      const checked = await page
        .locator('#creationProjects input[type="checkbox"]:checked')
        .evaluateAll((nodes) => nodes.map((node) => node.value));
      assert.deepEqual(checked, ["pushup"]);
      await page.locator("#creationDate").fill("2026-10-04");
      await page.locator("#creationSubmit").click();
      await settled(page);
      const next = await state(page);
      assert.equal(next.athleteId, first.athleteId);
      assert.notEqual(next.recordId, first.recordId);
      assert.equal(next.data.pushup.reps, "");
      assert.equal(next.athlete.sport, "拳击");
      assert.equal(next.athlete.dominantHand, "右手");
      assert.equal(next.athlete.sportLevel, "成年组");
      return {
        first: first.recordId,
        recent: recent.recordId,
        sameDay: sameDay.recordId,
        backdated: backdated.recordId,
        inherited: checked,
      };
    },
  );
  await check(
    "profile-history",
    "专项自定义、档案与历史快照分离，查看历史不改姓名或更新时间",
    async (page) => {
      const old = await create(page, "最初姓名", ["cmj"], {
        sport: "自由搏击",
        hand: "双手",
        level: "业余",
      });
      const next = await createRecord(page, ["cmj"], "2026-10-04");
      await entry(page, "athlete");
      await input(page, "athlete.name").fill("更新姓名");
      await input(page, "athlete.sport").fill("跆拳道");
      await input(page, "athlete.dominantHand").selectOption("右手");
      await settled(page);
      const before = await library(page);
      const profile = before.athletes.find(
        (a) => a.id === old.athleteId,
      ).profile;
      assert.equal(profile.name, "更新姓名");
      assert.equal(profile.sport, "跆拳道");
      await selectRecord(page, old.recordId);
      const after = await library(page);
      const owner = after.athletes.find((a) => a.id === old.athleteId);
      assert.equal(owner.name, "更新姓名");
      assert.deepEqual(owner.profile, profile);
      assert.equal(
        owner.records.find((r) => r.recordId === old.recordId).athlete.name,
        "最初姓名",
      );
      assert.equal(
        owner.records.find((r) => r.recordId === old.recordId).athlete.sport,
        "自由搏击",
      );
      assert.equal(
        owner.records.find((r) => r.recordId === next.recordId).athlete.name,
        "更新姓名",
      );
      for (const record of before.athletes.find((a) => a.id === old.athleteId)
        .records)
        assert.equal(
          owner.records.find((r) => r.recordId === record.recordId).updated,
          record.updated,
          "Reading history must not touch record.updated",
        );
      await page.reload();
      await page.waitForFunction(() => window.App);
      assert.equal(
        (await library(page)).athletes.find((a) => a.id === old.athleteId)
          .profile.name,
        "更新姓名",
      );
      return {
        profile,
        oldSnapshot: owner.records.find((r) => r.recordId === old.recordId)
          .athlete,
      };
    },
  );
  await check(
    "plan-focus-retention",
    "项目选择连续键盘焦点保留、停用不删除原数据且不计报告",
    async (page) => {
      await create(page);
      await input(page, "data.cmj.0.height").fill("43.25");
      await settled(page);
      await entry(page, "plan");
      const checkbox = input(page, "enabled.cmj");
      await checkbox.evaluate((el) => {
        window.__planCheckbox = el;
        window.__planForm =
          document.getElementById("entryContent").firstElementChild;
      });
      await checkbox.uncheck();
      await settled(page);
      assert.deepEqual(
        await page.evaluate(() => ({
          focus: document.activeElement === window.__planCheckbox,
          checkbox:
            document.querySelector('[data-path="enabled.cmj"]') ===
            window.__planCheckbox,
          form:
            document.getElementById("entryContent").firstElementChild ===
            window.__planForm,
        })),
        { focus: true, checkbox: true, form: true },
      );
      assert.equal((await state(page)).data.cmj[0].height, "43.25");
      assert.equal(
        await page.evaluate(
          () =>
            App.stats().values.cmj_height === undefined &&
            !App.stats().validTests.has("cmj"),
        ),
        true,
      );
      assert.equal(
        await page.locator("#entryNav button[onclick*=\"'cmj'\"]").count(),
        0,
      );
      await checkbox.check();
      await settled(page);
      near(await page.evaluate(() => App.stats().values.cmj_height), 43.25);
      assert.equal(
        await page.locator("#entryNav button[onclick*=\"'cmj'\"]").count(),
        1,
      );
      return { dataRetained: true, reenabledValue: 43.25 };
    },
  );
  await check(
    "invalid-drafts",
    "负CMJ与非整数俯卧撑草稿跨页及刷新保留，合法修正后恢复保存",
    async (page) => {
      await create(page);
      await input(page, "data.cmj.0.height").fill("43.25");
      await settled(page);
      await input(page, "data.cmj.0.height").fill("-1");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        "true",
      );
      assert.equal((await state(page)).data.cmj[0].height, "43.25");
      await entry(page, "sj");
      assert.ok(
        (await page.locator("#entryProblemSummary").innerText()).length > 0,
      );
      await entry(page, "cmj");
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "-1");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        "true",
      );
      await page.reload();
      await page.waitForFunction(() => window.App);
      await entry(page, "cmj");
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "-1");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        "true",
      );
      await input(page, "data.cmj.0.height").fill("44");
      await settled(page);
      near(await page.evaluate(() => App.stats().values.cmj_height), 44);
      await input(page, "data.cmj.0.height").fill("");
      await input(page, "data.cmj.0.height").pressSequentially("1e");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        "true",
      );
      await entry(page, "sj");
      await entry(page, "cmj");
      assert.equal(
        await input(page, "data.cmj.0.height").inputValue(),
        "1e",
        "Incomplete numeric tokens must retain their prefix",
      );
      await page.reload();
      await page.waitForFunction(() => window.App);
      await entry(page, "cmj");
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "1e");
      await input(page, "data.cmj.0.height").fill("44");
      await settled(page);
      await entry(page, "pushup");
      await input(page, "data.pushup.reps").fill("3.5");
      assert.equal(
        await input(page, "data.pushup.reps").getAttribute("aria-invalid"),
        "true",
      );
      assert.equal(
        await page.evaluate(() => App.stats().validTests.has("pushup")),
        false,
      );
      await entry(page, "sj");
      await page.reload();
      await page.waitForFunction(() => window.App);
      await entry(page, "pushup");
      assert.equal(await input(page, "data.pushup.reps").inputValue(), "3.5");
      assert.equal(
        await input(page, "data.pushup.reps").getAttribute("aria-invalid"),
        "true",
      );
      await input(page, "data.pushup.reps").fill("4");
      await settled(page);
      assert.equal(
        await input(page, "data.pushup.reps").getAttribute("aria-invalid"),
        null,
      );
      assert.equal(
        await page.evaluate(() => App.stats().values.pushup_reps),
        4,
      );
      return { correctedCMJ: 44, correctedPushup: 4 };
    },
  );
  await check(
    "rows-focus-undo",
    "新增尝试聚焦、删除后撤销恢复原数据并保持稳定行ID",
    async (page) => {
      await create(page, "行操作核验", ["cmj"]);
      await input(page, "data.cmj.0.height").fill("41");
      await settled(page);
      const firstId = (await state(page)).data.cmj[0].id;
      await page
        .locator("#entryContent button[onclick*=\"App.addRow('cmj')\"]")
        .click();
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.path),
        "data.cmj.1.height",
      );
      await input(page, "data.cmj.1.height").fill("42");
      await settled(page);
      const addedId = (await state(page)).data.cmj[1].id;
      await input(page, "data.cmj.0.height")
        .locator("xpath=ancestor::tr")
        .getByRole("button")
        .click();
      assert.equal((await state(page)).data.cmj.length, 1);
      assert.equal((await state(page)).data.cmj[0].id, addedId);
      assert.equal(await page.locator("#undoDeleteButton").isVisible(), true);
      await page.locator("#undoDeleteButton").click();
      const restored = (await state(page)).data.cmj;
      assert.deepEqual(
        restored.map((row) => row.id),
        [firstId, addedId],
      );
      assert.deepEqual(
        restored.map((row) => row.height),
        ["41", "42"],
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.path),
        "data.cmj.0.height",
        "Undo returns focus to the restored attempt",
      );
      await page.reload();
      await page.waitForFunction(() => window.App);
      assert.deepEqual(
        (await state(page)).data.cmj.map((row) => row.id),
        [firstId, addedId],
      );
      return { firstId, addedId, restoredRows: restored.length };
    },
  );
  await check(
    "draft-scope-stable-row",
    "错误草稿绑定运动员、记录和稳定行ID，删前行和切换档案不串值",
    async (page) => {
      const first = await create(page, "草稿运动员甲", ["cmj"]);
      await input(page, "data.cmj.0.height").fill("41");
      await page
        .locator("#entryContent button[onclick*=\"App.addRow('cmj')\"]")
        .click();
      await input(page, "data.cmj.1.height").fill("42");
      await settled(page);
      const rowId = (await state(page)).data.cmj[1].id;
      await input(page, "data.cmj.1.height").fill("-2");
      await input(page, "data.cmj.0.height")
        .locator("xpath=ancestor::tr")
        .getByRole("button")
        .click();
      assert.equal((await state(page)).data.cmj[0].id, rowId);
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "-2");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        "true",
      );
      const second = await create(page, "草稿运动员乙", ["cmj"]);
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        null,
      );
      await selectAthlete(page, first.athleteId);
      await entry(page, "cmj");
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "-2");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        "true",
      );
      assert.equal(Number((await state(page)).data.cmj[0].height), 42);
      await createRecord(page, ["cmj"], "2026-10-05");
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "");
      assert.equal(
        await input(page, "data.cmj.0.height").getAttribute("aria-invalid"),
        null,
      );
      await selectRecord(page, first.recordId);
      await entry(page, "cmj");
      assert.equal(await input(page, "data.cmj.0.height").inputValue(), "-2");
      return {
        athleteA: first.athleteId,
        athleteB: second.athleteId,
        stableRow: rowId,
      };
    },
  );
  await check(
    "partial-context",
    "一侧药球与单方向等长明确显示已录范围，未测项不称完整完成",
    async (page) => {
      await create(page, "录入范围核验", ["iso", "mb"]);
      await input(page, "data.iso.0.center").fill("100");
      await settled(page);
      await entry(page, "mb");
      await input(page, "data.mb.0.distance").fill("5.2");
      await settled(page);
      await entry(page, "plan");
      const iso = await page.locator('[data-plan-status="iso"]').innerText();
      const mb = await page.locator('[data-plan-status="mb"]').innerText();
      assert.ok(iso.includes("方向 1/") && iso.includes("中线 1"), iso);
      assert.ok(
        mb.includes("优势侧 1 次") && mb.includes("非优势侧未录入"),
        mb,
      );
      assert.ok(!iso.includes("已完成") && !mb.includes("已完成"));
      assert.ok(
        (
          await page
            .locator('#entryNav button[data-entry-tab="mb"]')
            .innerText()
        ).includes("有结果"),
      );
      return { isometric: iso, medicineBall: mb };
    },
  );
  await check(
    "fresh-configuration",
    "新运动员不继承上一运动员本次评价与测试方法",
    async (page) => {
      await create(page, "配置来源甲", ["cmj"]);
      await settings(page, "rules");
      await input(page, "rules.asymAmber").fill("7");
      await settings(page, "lvp");
      await input(page, "lvp.squat.mvt").fill("0.45");
      await settled(page);
      const second = await create(page, "配置来源乙", ["cmj"]);
      assert.equal(Number(second.rules.asymAmber), 10);
      assert.equal(second.lvp.squat.mvt, "");
      return {
        asymAmber: second.rules.asymAmber,
        squatMVT: second.lvp.squat.mvt,
      };
    },
  );
  await check(
    "catalog-snapshots",
    "共用目录跨运动员可选，编辑目录不重写旧定义快照",
    async (page) => {
      const first = await create(page, "目录运动员甲", ["cmj"]);
      const originalDefinitions = (await state(page)).definitions;
      const { project, metric } = await addCatalogProject(page);
      assert.equal(metric.ability, "专项速度");
      assert.equal(metric.direction, "higher");
      assert.equal(metric.unit, "m/s");
      assert.deepEqual(
        (await state(page)).definitions,
        originalDefinitions,
        "Editing shared catalog must not silently rewrite current snapshot",
      );
      const measured = await createRecord(page, [project.id], "2026-10-04");
      const valuePath = `customValues.${metric.id}.value`;
      await input(page, valuePath).fill("0");
      await settled(page);
      assert.equal(
        await page.evaluate((id) => App.stats().values[id], metric.id),
        0,
      );
      await settings(page, "catalog");
      await page
        .locator(`[data-catalog-test="${project.id}"]`)
        .getByRole("button", { name: "编辑项目", exact: true })
        .click();
      await page.locator("#catalogTarget").fill("10");
      await page.locator('#catalogForm button[type="submit"]').click();
      await settled(page);
      assert.equal(
        Number(
          (await state(page)).definitions.find(
            (definition) => definition.id === metric.id,
          ).target,
        ),
        5,
      );
      const second = await create(page, "目录运动员乙", [project.id]);
      assert.equal(
        Number(
          second.definitions.find((definition) => definition.id === metric.id)
            .target,
        ),
        10,
      );
      assert.equal(
        second.definitions.find((definition) => definition.id === metric.id)
          .unit,
        "m/s",
      );
      await selectAthlete(page, first.athleteId);
      await selectRecord(page, measured.recordId);
      assert.equal(
        Number(
          (await state(page)).definitions.find(
            (definition) => definition.id === metric.id,
          ).target,
        ),
        5,
      );
      await entry(page, project.id);
      assert.equal(await input(page, valuePath).inputValue(), "0");
      return {
        project: project.id,
        metric: metric.id,
        historicalTarget: 5,
        nextAthleteTarget: 10,
      };
    },
  );
  await check(
    "catalog-legacy-conflicts",
    "旧库同ID异定义保留版本，确认目录版本不覆盖历史快照",
    async (page) => {
      const first = await create(page, "冲突版本运动员", ["cmj"]);
      const { project, metric } = await addCatalogProject(page, {
        name: "旧目录冲突项目",
      });
      const measured = await createRecord(page, [project.id], "2026-10-04");
      const payload = await library(page);
      delete payload.catalog;
      const owner = payload.athletes.find(
        (athlete) => athlete.id === first.athleteId,
      );
      const alternative = JSON.parse(
        JSON.stringify(
          owner.records.find((record) => record.recordId === measured.recordId),
        ),
      );
      alternative.recordId = "qa-conflicting-record";
      alternative.athlete.date = "2026-10-05";
      alternative.definitions.find(
        (definition) => definition.id === metric.id,
      ).target = 7;
      owner.records.push(alternative);
      const filename = path.join(out, "workflow-legacy-catalog-conflicts.json");
      fs.writeFileSync(filename, JSON.stringify(payload, null, 2));
      results.artifacts.push(filename);
      const restored = await boot();
      try {
        await importFile(restored.page, filename);
        await restored.page.waitForFunction(
          (id) => App.getState().recordId === id,
          measured.recordId,
        );
        const migrated = await library(restored.page);
        const conflict = migrated.catalog.conflicts.find(
          (item) => item.testId === project.id,
        );
        assert.ok(
          conflict && conflict.variants.length === 2 && !conflict.resolved,
        );
        await openCreation(restored.page);
        await restored.page.locator("#newAthleteName").fill("冲突未确认");
        await restored.page.locator("#creationNext").click();
        assert.equal(
          await restored.page
            .locator(`#creationProjects input[value="${project.id}"]`)
            .isDisabled(),
          true,
        );
        await restored.page.locator("#newAthleteModal button.close").click();
        await settings(restored.page, "catalog");
        const panel = restored.page.locator(
          `[data-catalog-conflict="${project.id}"]`,
        );
        assert.equal(
          await panel
            .getByRole("button", { name: "采用此版本", exact: true })
            .count(),
          2,
        );
        restored.page.once("dialog", async (dialog) => {
          await dialog.accept();
        });
        await panel
          .getByRole("button", { name: "采用此版本", exact: true })
          .nth(1)
          .click();
        await settled(restored.page);
        const resolved = await library(restored.page);
        assert.equal(
          resolved.catalog.conflicts.find((item) => item.testId === project.id)
            .resolved,
          true,
        );
        assert.equal(
          Number(
            resolved.catalog.definitions.find(
              (definition) => definition.id === metric.id,
            ).target,
          ),
          7,
        );
        const records = resolved.athletes.find(
          (athlete) => athlete.id === first.athleteId,
        ).records;
        assert.equal(
          Number(
            records
              .find((record) => record.recordId === measured.recordId)
              .definitions.find((definition) => definition.id === metric.id)
              .target,
          ),
          5,
        );
        assert.equal(
          Number(
            records
              .find((record) => record.recordId === alternative.recordId)
              .definitions.find((definition) => definition.id === metric.id)
              .target,
          ),
          7,
        );
        const nextAthlete = await create(restored.page, "采用确认目录", [
          project.id,
        ]);
        assert.equal(
          Number(
            nextAthlete.definitions.find(
              (definition) => definition.id === metric.id,
            ).target,
          ),
          7,
        );
        assert.deepEqual(restored.errors, []);
        assert.deepEqual(restored.network, []);
      } finally {
        await restored.context.close();
      }
      return {
        fixture: filename,
        versionsRetained: 2,
        historicalTargets: [5, 7],
        selectedTarget: 7,
      };
    },
  );
  await check(
    "actual-exports",
    "实际HTML、报告JSON、整库JSON下载后隔离恢复专项惯用手、项目目录与历史",
    async (page) => {
      const first = await create(page, "导出核验甲", ["cmj"], {
        sport: "散打",
        hand: "左手",
        level: "青年组",
      });
      await input(page, "data.cmj.0.height").fill("43.25");
      await settled(page);
      const { project, metric } = await addCatalogProject(page, {
        name: "导出专项项目",
      });
      const current = await createRecord(page, [project.id], "2026-10-05");
      await input(page, `customValues.${metric.id}.value`).fill("5");
      await settled(page);
      const expectedLibrary = await library(page);
      const files = {
        html: await download(
          page,
          "保存当前可编辑 HTML 报告",
          "workflow-export-report.html",
        ),
        json: await download(
          page,
          "导出当前报告 JSON",
          "workflow-export-report.json",
        ),
        library: await download(
          page,
          "备份整个运动员库 JSON",
          "workflow-export-library.json",
        ),
      };
      const restorations = [];
      for (const kind of ["html", "json", "library"]) {
        const restored = await boot(
          1440,
          kind === "html" ? files.html : source,
        );
        try {
          if (kind !== "html") await importFile(restored.page, files[kind]);
          await restored.page.waitForFunction(
            (id) => App.getState().recordId === id,
            current.recordId,
          );
          const recovered = await state(restored.page);
          assert.equal(recovered.athleteId, first.athleteId);
          assert.equal(recovered.athlete.sport, "散打");
          assert.equal(recovered.athlete.dominantHand, "左手");
          near(
            await restored.page.evaluate(
              (id) => App.stats().values[id],
              metric.id,
            ),
            5,
          );
          assert.equal(
            recovered.definitions.find(
              (definition) => definition.id === metric.id,
            ).unit,
            "m/s",
          );
          assert.ok(
            (await restored.page.locator("#athleteMeta").innerText()).includes(
              "散打",
            ),
          );
          assert.ok(
            (await restored.page.locator("#athleteMeta").innerText()).includes(
              "左手",
            ),
          );
          const restoredLibrary = await library(restored.page);
          assert.ok(
            restoredLibrary.catalog.tests.some(
              (test) => test.id === project.id,
            ),
          );
          if (kind === "library") {
            const owner = restoredLibrary.athletes.find(
              (athlete) => athlete.id === first.athleteId,
            );
            assert.equal(owner.profile.sport, "散打");
            assert.equal(owner.profile.dominantHand, "左手");
            assert.deepEqual(
              owner.records.map((record) => record.recordId),
              expectedLibrary.athletes
                .find((athlete) => athlete.id === first.athleteId)
                .records.map((record) => record.recordId),
            );
            await selectRecord(restored.page, first.recordId);
            near(
              await restored.page.evaluate(() => App.stats().values.cmj_height),
              43.25,
            );
          }
          await restored.page.reload();
          await restored.page.waitForFunction(() => window.App);
          assert.equal((await state(restored.page)).athlete.sport, "散打");
          assert.deepEqual(restored.errors, []);
          assert.deepEqual(restored.network, []);
          restorations.push({
            kind,
            filename: files[kind],
            bytes: fs.statSync(files[kind]).size,
            sha256: hash(fs.readFileSync(files[kind])),
          });
        } finally {
          await restored.context.close();
        }
      }
      return restorations;
    },
  );
  await check(
    "builtin-catalog-export",
    "内置项目目录目标真实编辑、完整整库下载恢复并用于新运动员",
    async (page) => {
      await create(page, "内置目录目标核验", ["mas"]);
      const originalTarget = (await state(page)).definitions.find(
        (definition) => definition.id === "mas_speed",
      ).target;
      await settings(page, "catalog");
      await page
        .locator('[data-catalog-test="mas"]')
        .getByRole("button", { name: "编辑项目", exact: true })
        .click();
      await page.locator("#catalogTarget").fill("6.25");
      await page.locator('#catalogForm button[type="submit"]').click();
      await settled(page);
      assert.equal(
        (await library(page)).catalog.definitions.find(
          (definition) => definition.id === "mas_speed",
        ).target,
        6.25,
      );
      assert.equal(
        (await state(page)).definitions.find(
          (definition) => definition.id === "mas_speed",
        ).target,
        originalTarget,
      );
      const expectedCatalog = (await library(page)).catalog;
      const filename = await download(
        page,
        "备份整个运动员库 JSON",
        "workflow-builtin-catalog-library.json",
      );
      const restored = await boot();
      try {
        await importFile(restored.page, filename);
        assert.deepEqual(
          (await library(restored.page)).catalog,
          expectedCatalog,
          "The complete explicit shared catalog survives backup restore",
        );
        const newAthlete = await create(restored.page, "恢复目录新档案", [
          "mas",
        ]);
        assert.equal(
          newAthlete.definitions.find(
            (definition) => definition.id === "mas_speed",
          ).target,
          6.25,
        );
        assert.equal(
          newAthlete.definitions.find(
            (definition) => definition.id === "mas_speed",
          ).unit,
          "m/s",
        );
        assert.deepEqual(restored.errors, []);
        assert.deepEqual(restored.network, []);
      } finally {
        await restored.context.close();
      }
      return {
        filename,
        oldSnapshotTarget: originalTarget,
        restoredCatalogTarget: 6.25,
      };
    },
  );
  await check(
    "legacy-rules-recovery",
    "已有异常备份先定位修正规则，取消不写库且原始数据可下载保留",
    async (page) => {
      const original = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "fixtures/verification-v1-original-demo.json"),
          "utf8",
        ),
      );
      original.demo = false;
      original.recordId = "qa-abnormal-rules-record";
      original.athlete.name = "旧异常备份核验";
      original.rules.scoreAmber = original.rules.scoreGreen;
      const filename = path.join(out, "workflow-abnormal-rules-input.json");
      fs.writeFileSync(filename, JSON.stringify(original, null, 2));
      results.artifacts.push(filename);
      const before = await library(page);
      await importFile(page, filename);
      assert.equal(await page.locator("#recoveryModal").isVisible(), true);
      assert.ok(
        (await page.locator("#recoveryFields").innerText()).includes("阈值"),
      );
      assert.deepEqual(
        (await library(page)).athletes,
        before.athletes,
        "Recovery must not partly replace the library",
      );
      const waiting = page.waitForEvent("download");
      await page
        .locator("#recoveryModal")
        .getByRole("button", { name: "下载原始数据", exact: true })
        .click();
      const file = await waiting;
      const rawFile = path.join(
        out,
        "workflow-abnormal-rules-original-preserved.json",
      );
      await file.saveAs(rawFile);
      results.artifacts.push(rawFile);
      assert.deepEqual(JSON.parse(fs.readFileSync(rawFile, "utf8")), original);
      await page
        .locator(
          '#recoveryFields input[data-recovery-record="qa-abnormal-rules-record"][data-recovery-field="scoreAmber"]',
        )
        .fill("80");
      await page.locator('#recoveryForm button[type="submit"]').click();
      await page.waitForFunction(
        () => App.getState().recordId === "qa-abnormal-rules-record",
      );
      const repaired = await state(page);
      assert.equal(Number(repaired.rules.scoreAmber), 80);
      assert.equal(repaired.athlete.name, original.athlete.name);
      assert.equal(repaired.data.cmj.length, original.data.cmj.length);
      assert.equal(
        Number(repaired.data.cmj[0].height),
        Number(original.data.cmj[0].height),
      );
      assert.equal(
        await page.evaluate(() => RingsideModel.validateRecord(App.getState())),
        true,
      );
      await download(
        page,
        "备份整个运动员库 JSON",
        "workflow-repaired-library.json",
      );
      return {
        rawFile,
        rawSHA: hash(fs.readFileSync(rawFile)),
        repairedRecord: repaired.recordId,
        originalResultPreserved: true,
      };
    },
  );
  await check(
    "startup-recovery",
    "本地已有异常数据启动进入核对恢复，原始结果保留且无执行错误",
    async () => {
      const damaged = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "fixtures/verification-v1-original-demo.json"),
          "utf8",
        ),
      );
      damaged.recordId = "qa-startup-recovery-record";
      damaged.athlete.name = "启动恢复核验";
      damaged.demo = false;
      damaged.rules.scoreAmber = damaged.rules.scoreGreen;
      const restored = await boot(1440, source, damaged);
      try {
        assert.equal(
          await restored.page.locator("#recoveryModal").isVisible(),
          true,
        );
        assert.ok(
          (await restored.page.locator("#recoveryFields").innerText()).includes(
            "阈值",
          ),
        );
        await restored.page
          .locator(
            '#recoveryFields input[data-recovery-record="qa-startup-recovery-record"][data-recovery-field="scoreAmber"]',
          )
          .fill("80");
        await restored.page
          .locator('#recoveryForm button[type="submit"]')
          .click();
        await restored.page.waitForFunction(
          () =>
            window.App?.getState()?.recordId === "qa-startup-recovery-record",
        );
        const recovered = await state(restored.page);
        assert.equal(recovered.athlete.name, damaged.athlete.name);
        assert.equal(
          Number(recovered.data.cmj[0].height),
          Number(damaged.data.cmj[0].height),
        );
        assert.equal(Number(recovered.rules.scoreAmber), 80);
        assert.equal(
          await restored.page.evaluate(() =>
            RingsideModel.validateRecord(App.getState()),
          ),
          true,
        );
        assert.deepEqual(restored.errors, []);
        assert.deepEqual(restored.network, []);
        return {
          recordId: recovered.recordId,
          originalCMJ: damaged.data.cmj[0].height,
          repairedThreshold: recovered.rules.scoreAmber,
        };
      } finally {
        await restored.context.close();
      }
    },
  );
  await check(
    "ai-background",
    "专项惯用手进入真实AI请求事实，模拟响应不调用外部模型",
    async (page, session) => {
      await create(page, "AI背景核验", ["cmj"], {
        sport: "跆拳道",
        hand: "双手",
      });
      await input(page, "data.cmj.0.height").fill("43");
      await settled(page);
      await settings(page, "ai");
      await page.locator("#apiURL").fill("https://ringside-tests.invalid");
      await page.locator("#apiKey").fill("local-simulated-key");
      await page.locator("#apiModel").fill("local-simulated-model");
      await page.locator("#workspaceBack").click();
      await entry(page, "narrative");
      await page.evaluate(() => {
        App.getState().dsi.cmjUnit = "kgf";
        App.getState().data.cmj[0].force = 100;
      });
      const mockResult = "## 本地模拟响应\n结合专项背景与有效结果提出训练重点。\n\n- 每周安排两次力量练习；动作质量稳定后逐步进阶。";
      let requestBody;
      await page.route("https://ringside-tests.invalid/**", async (route) => {
        if (route.request().method() === "OPTIONS") {
          await route.fulfill({
            status: 204,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "POST, OPTIONS",
              "access-control-allow-headers": "authorization, content-type",
            },
          });
          return;
        }
        requestBody = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          headers: { "access-control-allow-origin": "*" },
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: mockResult } }],
          }),
        });
      });
      await session.context.setOffline(false);
      await page.locator("[data-ai-generate]").click();
      await page.waitForFunction(() =>
        document.getElementById("previewModal").classList.contains("show"),
      );
      assert.ok(requestBody?.messages?.length);
      const actualFacts = JSON.parse(
        requestBody.messages[1].content.slice(
          requestBody.messages[1].content.indexOf("\n") + 1,
        ),
      );
      assert.equal(
        actualFacts.results.find((x) => x.name === "CMJ 起跳峰值力").unit,
        "kgf",
      );

      assert.ok(
        requestBody.messages[0].content.startsWith("你是一位帮助教练"),
      );
      assert.ok(
        requestBody.messages[0].content.includes(
          "不自行创建常模",
        ),
      );
      const content = requestBody.messages
        .map((message) => message.content)
        .join("\n");
      assert.ok(content.includes('"sport":"跆拳道"'));
      assert.ok(content.includes('"dominantHand":"双手"'));
      assert.ok(
        (await page.locator("#aiPreview").innerText()).includes(
          "本地模拟响应",
        ),
      );
      await session.context.setOffline(true);
      return {
        simulatedAI: true,
        sportInRequest: true,
        dominantHandInRequest: true,
        liveModelCalled: false,
      };
    },
  );
  await check(
    "pdf-background",
    "实际离线PDF下载，专项惯用手进入PDF排版且页面无遗漏诊断",
    async (page) => {
      const record = await create(page, "PDF专项核验", ["cmj"], {
        sport: "散打",
        hand: "左手",
      });
      await input(page, "data.cmj.0.height").fill("43.25");
      await settled(page);
      await page.locator("#workspaceBack").click();
      await page.evaluate(() => {
        window.__pdfBackground = { sport: false, hand: false };
        window.__pdfObserver = new MutationObserver(() => {
          const text = [...document.querySelectorAll(".ringside-pdf-document")]
            .map((el) => el.textContent)
            .join("\n");
          window.__pdfBackground.sport ||= text.includes("散打");
          window.__pdfBackground.hand ||= text.includes("左手");
        });
        window.__pdfObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      });
      const waiting = page.waitForEvent("download", { timeout: 180000 });
      await sidebar(page);
      await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
      await page.locator("#pdfButton").click();
      const file = await waiting;
      const filename = path.join(out, "workflow-sport-hand-report.pdf");
      await file.saveAs(filename);
      results.artifacts.push(filename);
      await page.waitForFunction(
        () => !document.getElementById("pdfButton").disabled,
      );
      const diagnostic = await page.evaluate(() => {
        window.__pdfObserver.disconnect();
        return {
          background: window.__pdfBackground,
          diagnostics: RingsidePDF.lastDiagnostics,
          id: App.getState().recordId,
          stages: document.querySelectorAll(".ringside-pdf-stage").length,
        };
      });
      assert.equal(
        fs.readFileSync(filename).subarray(0, 5).toString("ascii"),
        "%PDF-",
      );
      assert.ok(fs.statSync(filename).size > 1000);
      assert.deepEqual(diagnostic.background, { sport: true, hand: true });
      assert.equal(diagnostic.id, record.recordId);
      assert.equal(diagnostic.stages, 0);
      assert.equal(diagnostic.diagnostics.status, "complete");
      for (const key of [
        "missingRows",
        "duplicateRows",
        "changedRows",
        "missingCharts",
        "duplicateCharts",
      ])
        assert.equal(diagnostic.diagnostics[key].length, 0, key);
      return {
        filename,
        sha256: hash(fs.readFileSync(filename)),
        bytes: fs.statSync(filename).size,
        ...diagnostic,
      };
    },
  );
  await check(
    "speed-migration",
    "旧18km/h迁移为5m/s、目标100%，零值显示与刷新导出再导入一致",
    async (page) => {
      const fixture = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "fixtures/verification-v1-original-demo.json"),
          "utf8",
        ),
      );
      fixture.athleteId = "qa-legacy-speed-athlete";
      fixture.recordId = "qa-legacy-speed-record";
      fixture.demo = false;
      fixture.athlete.name = "旧单位迁移核验";
      fixture.customTests = [
        { id: "test_qa_speed", name: "自定义速度", category: "performance" },
      ];
      fixture.enabled.test_qa_speed = true;
      fixture.definitions.push({
        id: "metric_qa_speed",
        testId: "test_qa_speed",
        name: "速度指标",
        unit: "km/h",
        target: 18,
        ability: "自定义速度能力",
        category: "performance",
        direction: "higher",
        referenceEnabled: true,
        source: "隔离验收输入",
        protocol: "18 km/h",
        ranges: [
          {
            min: 0,
            max: 18,
            includeMin: true,
            includeMax: true,
            status: "green",
            label: "核验",
          },
        ],
      });
      fixture.customValues = {
        metric_qa_speed: { value: 18, notes: "原始km/h输入" },
      };
      const filename = path.join(out, "workflow-legacy-speed-input.json");
      fs.writeFileSync(filename, JSON.stringify(fixture, null, 2));
      results.artifacts.push(filename);
      await importFile(page, filename);
      await page.waitForFunction(
        () => App.getState().recordId === "qa-legacy-speed-record",
      );
      async function assertSpeed(targetPage) {
        const check = await targetPage.evaluate(() => {
          const record = App.getState(),
            metric = record.definitions.find((d) => d.id === "metric_qa_speed");
          return {
            value: App.stats().values.metric_qa_speed,
            target: metric.target,
            unit: metric.unit,
            attainment: RingsideModel.attainment(
              App.stats().values.metric_qa_speed,
              metric,
            ),
            min: metric.ranges[0].min,
            max: metric.ranges[0].max,
            includeMin: metric.ranges[0].includeMin,
            includeMax: metric.ranges[0].includeMax,
            kmDefinitions: record.definitions.filter((d) => d.unit === "km/h")
              .length,
            stance: record.athlete.stance,
            hand: record.athlete.dominantHand,
          };
        });
        near(check.value, 5);
        near(check.target, 5);
        near(check.attainment, 100);
        near(check.min, 0);
        near(check.max, 5);
        assert.equal(check.unit, "m/s");
        assert.equal(check.includeMin, true);
        assert.equal(check.includeMax, true);
        assert.equal(check.kmDefinitions, 0);
        assert.equal(check.stance, "右后手");
        assert.ok(
          !check.hand || check.hand === "未注明",
          "Legacy stance must not be guessed into dominant hand",
        );
        return check;
      }
      const initial = await assertSpeed(page);
      await entry(page, "test_qa_speed");
      assert.equal(
        await input(page, "customValues.metric_qa_speed.value").inputValue(),
        "5",
      );
      assert.ok(
        (await page.locator("#entryContent").innerText()).includes("m/s"),
      );
      await input(page, "customValues.metric_qa_speed.value").fill("0");
      await settled(page);
      assert.equal(
        await page.evaluate(() => App.stats().values.metric_qa_speed),
        0,
      );
      await entry(page, "cmj");
      await entry(page, "test_qa_speed");
      assert.equal(
        await input(page, "customValues.metric_qa_speed.value").inputValue(),
        "0",
      );
      await page.reload();
      await page.waitForFunction(() => window.App);
      await entry(page, "test_qa_speed");
      assert.equal(
        await input(page, "customValues.metric_qa_speed.value").inputValue(),
        "0",
      );
      await input(page, "customValues.metric_qa_speed.value").fill("5");
      await settled(page);
      await page.reload();
      await page.waitForFunction(() => window.App);
      await assertSpeed(page);
      for (const tab of ["mas", "mss", "ift", "lactate", "squat", "landmine"]) {
        await entry(page, tab);
        assert.equal(
          await page.locator('#entryContent option[value="km/h"]').count(),
          0,
        );
        assert.ok(
          (await page.locator("#entryContent").innerText()).includes("m/s"),
        );
      }
      const exported = await download(
        page,
        "导出当前报告 JSON",
        "workflow-speed-export.json",
      );
      const restored = await boot();
      try {
        await importFile(restored.page, exported);
        await restored.page.waitForFunction(
          () => App.getState().recordId === "qa-legacy-speed-record",
        );
        await assertSpeed(restored.page);
        await restored.page.reload();
        await restored.page.waitForFunction(() => window.App);
        await assertSpeed(restored.page);
        assert.deepEqual(restored.errors, []);
        assert.deepEqual(restored.network, []);
      } finally {
        await restored.context.close();
      }
      return {
        initial,
        exportFile: exported,
        isolatedImportAndReloadMatch: true,
      };
    },
  );
  await check(
    "unit-conversion",
    "力量单位取消保原义、N与kgf换算结果和目标、Nm必须清空重录",
    async (page) => {
      await create(page, "力量换算核验", ["iso"]);
      const pairedIndex = await page.evaluate(() =>
        App.getState().data.iso.findIndex((row) => row.paired),
      );
      const rowPath = `data.iso.${pairedIndex}`;
      await input(page, rowPath + ".left").fill("100");
      await input(page, rowPath + ".right").fill("200");
      await input(page, rowPath + ".target").fill("150");
      await settled(page);
      await input(page, rowPath + ".unit").selectOption("kgf");
      assert.equal(await page.locator("#unitModal").isVisible(), true);
      assert.equal((await state(page)).data.iso[pairedIndex].unit, "N");
      await page.locator("#unitModal button.close").click();
      assert.equal(await input(page, rowPath + ".unit").inputValue(), "N");
      assert.equal(Number((await state(page)).data.iso[pairedIndex].left), 100);
      await input(page, rowPath + ".unit").selectOption("kgf");
      await page.locator("#unitConvertButton").click();
      let row = (await state(page)).data.iso[pairedIndex];
      assert.equal(row.unit, "kgf");
      near(Number(row.left), 100 / 9.80665, 1e-6);
      near(Number(row.right), 200 / 9.80665, 1e-6);
      near(Number(row.target), 150 / 9.80665, 1e-6);
      await input(page, rowPath + ".unit").selectOption("N");
      await page.locator("#unitConvertButton").click();
      row = (await state(page)).data.iso[pairedIndex];
      near(Number(row.left), 100, 1e-6);
      near(Number(row.target), 150, 1e-6);
      assert.equal(await page.locator("#undoDeleteButton").isVisible(), true);
      await input(page, rowPath + ".left").fill("123");
      await settled(page);
      assert.equal(
        await page.locator("#undoDeleteButton").isVisible(),
        false,
        "Editing the converted row invalidates stale unit undo",
      );
      assert.equal(Number((await state(page)).data.iso[pairedIndex].left), 123);
      await input(page, rowPath + ".unit").selectOption("Nm");
      assert.equal(await page.locator("#unitModal").isVisible(), true);
      assert.equal(
        (await page.locator("#unitConvertButton").isVisible()) &&
          !(await page.locator("#unitConvertButton").isDisabled()),
        false,
      );
      await page.locator("#unitClearButton").click();
      row = (await state(page)).data.iso[pairedIndex];
      assert.equal(row.unit, "Nm");
      assert.equal(row.left, "");
      assert.equal(row.right, "");
      assert.equal(row.center, "");
      assert.equal(row.target, "");
      await page.reload();
      await page.waitForFunction(() => window.App);
      assert.equal((await state(page)).data.iso[pairedIndex].unit, "Nm");
      return { pairedIndex, finalUnit: "Nm", valuesCleared: true };
    },
  );
  await check(
    "rules-export-guard",
    "阈值空草稿不能冒充保存，取消导出保留草稿，明确放弃后备份可恢复",
    async (page) => {
      await create(page, "阈值核验", ["cmj"]);
      await settings(page, "rules");
      const before = (await state(page)).rules.scoreAmber;
      await input(page, "rules.scoreAmber").fill("");
      assert.equal(
        await input(page, "rules.scoreAmber").getAttribute("aria-invalid"),
        "true",
      );
      assert.equal((await state(page)).rules.scoreAmber, before);
      let dialogText = "",
        downloaded = false;
      const onDownload = () => {
        downloaded = true;
      };
      page.on("download", onDownload);
      page.once("dialog", async (dialog) => {
        dialogText = dialog.message();
        await dialog.dismiss();
      });
      await sidebar(page);
      await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
      await page
        .locator("#saveModal")
        .getByRole("button", { name: "导出当前报告 JSON", exact: true })
        .click();
      await settled(page);
      assert.equal(downloaded, false);
      assert.ok(dialogText.includes("放弃") && dialogText.includes("错误输入"));
      if (await page.locator("#saveModal").isVisible())
        await page.locator("#saveModal button.close").click();
      assert.equal(await input(page, "rules.scoreAmber").inputValue(), "");
      assert.equal(
        await input(page, "rules.scoreAmber").getAttribute("aria-invalid"),
        "true",
      );
      page.off("download", onDownload);
      page.once("dialog", async (dialog) => {
        await dialog.accept();
      });
      const exported = await download(
        page,
        "导出当前报告 JSON",
        "workflow-rules-recoverable.json",
      );
      const restored = await boot();
      try {
        await importFile(restored.page, exported);
        assert.equal((await state(restored.page)).rules.scoreAmber, before);
        assert.equal(
          await restored.page.evaluate(() =>
            RingsideModel.validateRecord(App.getState()),
          ),
          true,
        );
        assert.deepEqual(restored.errors, []);
      } finally {
        await restored.context.close();
      }
      return {
        rejectedDownload: true,
        explicitDiscardDownload: exported,
        restoredThreshold: before,
      };
    },
  );
  await check(
    "range-draft-guard",
    "评价区间错误草稿跨页刷新保留，未应用区间不能无提示导出",
    async (page) => {
      const record = await create(page, "评价区间草稿核验", ["cmj"]);
      await settings(page, "definitions");
      const originalRanges = (await state(page)).definitions.find(
        (definition) => definition.id === "cmj_height",
      ).ranges;
      await page.locator("#rangesText").fill("错误区间文字");
      await page.getByRole("button", { name: "应用区间", exact: true }).click();
      assert.equal(
        await page.locator("#rangesText").getAttribute("aria-invalid"),
        "true",
      );
      assert.deepEqual(
        (await state(page)).definitions.find(
          (definition) => definition.id === "cmj_height",
        ).ranges,
        originalRanges,
      );
      await settings(page, "rules");
      await settings(page, "definitions");
      assert.equal(
        await page.locator("#rangesText").inputValue(),
        "错误区间文字",
      );
      await page.reload();
      await page.waitForFunction(() => window.App);
      assert.equal(
        await page.locator("#rangesText").inputValue(),
        "错误区间文字",
      );
      assert.equal(
        await page.locator("#rangesText").getAttribute("aria-invalid"),
        "true",
      );
      let downloaded = false,
        confirmation = "";
      const onDownload = () => {
        downloaded = true;
      };
      page.on("download", onDownload);
      page.once("dialog", async (dialog) => {
        confirmation = dialog.message();
        await dialog.dismiss();
      });
      await sidebar(page);
      await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
      await page
        .locator("#saveModal")
        .getByRole("button", { name: "导出当前报告 JSON", exact: true })
        .click();
      await settled(page);
      assert.equal(downloaded, false);
      assert.ok(confirmation.includes("放弃"));
      if (await page.locator("#saveModal").isVisible())
        await page.locator("#saveModal button.close").click();
      page.off("download", onDownload);
      assert.equal(
        await page.locator("#rangesText").inputValue(),
        "错误区间文字",
      );
      await page
        .locator("#rangesText")
        .fill("<40 | 待提升 | red\n>=40 | 达标 | green");
      await page.getByRole("button", { name: "应用区间", exact: true }).click();
      assert.equal(
        await page.locator("#rangesText").getAttribute("aria-invalid"),
        null,
      );
      const applied = (await state(page)).definitions.find(
        (definition) => definition.id === "cmj_height",
      ).ranges;
      assert.equal(applied.length, 2);
      const filename = await download(
        page,
        "导出当前报告 JSON",
        "workflow-applied-ranges.json",
      );
      const restored = await boot();
      try {
        await importFile(restored.page, filename);
        await restored.page.waitForFunction(
          (id) => App.getState().recordId === id,
          record.recordId,
        );
        assert.deepEqual(
          (await state(restored.page)).definitions.find(
            (definition) => definition.id === "cmj_height",
          ).ranges,
          applied,
        );
        assert.deepEqual(restored.errors, []);
        assert.deepEqual(restored.network, []);
      } finally {
        await restored.context.close();
      }
      return {
        filename,
        unappliedExportBlocked: true,
        appliedRangeCount: applied.length,
      };
    },
  );
  await check(
    "responsive",
    "1440/1280/900/390录入身份可见、字段不裁剪且无重复ID",
    async (page) => {
      const record = await create(page, "小屏身份核验", ["iso", "cmj", "mb"]);
      const layouts = [];
      for (const width of [1440, 1280, 900, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await entry(page, "iso");
        await settled(page);
        assert.equal(await page.locator("#entryIdentity").isVisible(), true);
        const identity = await page.locator("#entryIdentity").innerText();
        assert.ok(
          identity.includes(record.athlete.name) &&
            identity.includes(record.athlete.date),
        );
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          duplicateIds: [...document.querySelectorAll("[id]")]
            .map((el) => el.id)
            .filter((id, i, all) => all.indexOf(id) !== i),
          fields: [
            ...document.querySelectorAll(
              "#entryContent input, #entryContent select",
            ),
          ].map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              name: el.getAttribute("aria-label"),
              left: rect.left,
              right: rect.right,
              width: rect.width,
              type: el.type,
              inCell: !!el.closest("td"),
              cellLabel: el.closest("td")?.getAttribute("data-label"),
            };
          }),
        }));
        assert.equal(layout.scrollWidth, width);
        assert.deepEqual(layout.duplicateIds, []);
        assert.ok(layout.fields.length > 0);
        for (const field of layout.fields) {
          assert.ok(
            field.left >= -1 &&
              field.right <= width + 1 &&
              field.width >= (field.type === "checkbox" ? 12 : 40),
            JSON.stringify(field),
          );
          assert.ok(
            field.name && !/^(data\.|athlete\.|definitions\.)/.test(field.name),
            "Controls need human-readable names",
          );
          if (width <= 600 && field.inCell)
            assert.ok(
              field.cellLabel,
              "Mobile table cells must retain field labels",
            );
        }
        await shot(page, `entry-iso-${width}`);
        if (width === 390) {
          await page.evaluate(() =>
            window.scrollTo({ top: 650, behavior: "instant" }),
          );
          await settled(page);
          const currentProject = await page
            .locator("#workspaceLabel")
            .innerText();
          assert.ok(currentProject.includes("等长"), currentProject);
          const sticky = await page.locator("#workspaceLabel").boundingBox();
          assert.ok(
            sticky && sticky.y >= 0 && sticky.y < 100,
            "Current project remains in the visible sticky header after scrolling",
          );
          const stickyIdentity = await page
            .locator("#recordContext")
            .boundingBox();
          assert.ok(
            stickyIdentity && stickyIdentity.y >= 0 && stickyIdentity.y < 120,
            "Athlete and date remain visible after scrolling",
          );
          const stickyIdentityText = await page
            .locator("#recordContext")
            .innerText();
          assert.ok(
            stickyIdentityText.includes(record.athlete.name) &&
              stickyIdentityText.includes(record.athlete.date),
          );
          await shot(page, "entry-iso-390-scrolled");
        }
        await page.locator("#workspaceBack").click();
        await settled(page);
        await shot(page, `report-${width}`);
        layouts.push({
          width,
          identity,
          fieldCount: layout.fields.length,
          duplicateIds: layout.duplicateIds,
          scrollWidth: layout.scrollWidth,
        });
      }
      return layouts;
    },
  );
}

(async () => {
  try {
    browser = await chromium.launch({ headless: true });
    results.browserVersion = browser.version();
    await run();
  } catch (error) {
    results.fatalError = error.stack || String(error);
  } finally {
    if (browser) await browser.close();
    results.finished = new Date().toISOString();
    results.passed = results.tests.filter((test) => test.pass).length;
    results.failed = results.tests.filter((test) => !test.pass).length;
    fs.writeFileSync(
      path.join(out, "workflow-verification-results.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(`${results.passed} passed, ${results.failed} failed`);
    if (results.failed || results.fatalError) process.exitCode = 1;
  }
})();
