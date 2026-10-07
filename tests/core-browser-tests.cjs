"use strict";
// Real controls drive project creation, record selection, entry, settings and
// imports. Isolated data fixtures are reserved for chart and quantity boundaries.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createHash } = require("node:crypto"),
  { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs"),
  { extensionFixture } = require("./helpers/core-fixtures.cjs");
const root = path.resolve(__dirname, ".."),
  source = path.join(root, "Ringside_Boxing_Assessment.html"),
  out = path.join(root, "output/playwright");
const result = {
  sourceHash: createHash("sha256")
    .update(fs.readFileSync(source))
    .digest("hex"),
  tests: [],
  browserErrors: [],
  networkRequests: [],
  artifacts: [],
};
const only = (process.argv.find((x) => x.startsWith("--only=")) || "")
  .slice(7)
  .split(",")
  .filter(Boolean);
let browser;
const state = (p) => p.evaluate(() => App.getState()),
  lib = (p) => p.evaluate(() => App.getLibrary()),
  settle = (p) => p.waitForTimeout(250);
const input = (p, key) => p.locator('[data-path="' + key + '"]'),
  near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
async function boot(record = null, filename = source) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    offline: true,
    acceptDownloads: true,
  });
  if (record)
    await context.addInitScript((record) => {
      if (!sessionStorage.getItem("core-seeded")) {
        localStorage.setItem(
          "ringside-library-v2:" + location.pathname,
          JSON.stringify(record),
        );
        sessionStorage.setItem("core-seeded", "yes");
      }
    }, record);
  const p = await context.newPage(),
    errors = [],
    network = [];
  p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await p.goto(pathToFileURL(filename).href);
  await p.waitForFunction(() => window.App && window.RingsideReport);
  return { p, context, errors, network };
}
async function sidebar(p) {
  await p.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  if (await p.locator("#sidebar").evaluate((el) => el.inert))
    await p.locator("#sidebarToggle").click();
}
async function settings(p, tab) {
  await sidebar(p);
  const scope =
    tab === "catalog"
      ? "catalog"
      : ["ai", "references"].includes(tab)
        ? "app"
        : "record";
  await p.locator('[data-settings-open="' + scope + '"]').click();
  await sidebar(p);
  await p.locator("#settingsTabs button[onclick*=\"'" + tab + "'\"]").click();
}
async function entry(p, id) {
  if ((await p.evaluate(() => App.getUIState())).mode === "settings")
    await report(p);
  await sidebar(p);
  if (await p.locator("#editButton").isVisible())
    await p.locator("#editButton").click();
  await sidebar(p);
  await p.locator("#entryNav button[onclick*=\"'" + id + "'\"]").click();
  await settle(p);
}
async function report(p) {
  for (
    let i = 0;
    i < 2 && (await p.evaluate(() => App.getUIState())).mode !== "report";
    i++
  )
    await p.locator("#workspaceBack").click();
  await settle(p);
}
async function create(p, ids, name = "核心结构验收") {
  await sidebar(p);
  await p.locator('#sidebar button[onclick="App.openNewAthlete()"] ').click();
  await p.locator("#newAthleteName").fill(name);
  await p.locator("#creationNext").click();
  for (const c of await p
    .locator('#creationProjects input[type="checkbox"]')
    .all())
    await c.setChecked(ids.includes(await c.getAttribute("value")));
  await p.locator("#creationSubmit").click();
  await settle(p);
  return state(p);
}
async function saveItem(p) {
  await p.locator('#catalogForm button[type="submit"]').click();
  await settle(p);
  assert.equal(
    await p.locator("#catalogModal").isVisible(),
    false,
    await p.locator("#catalogError").textContent(),
  );
}
async function fillMetric(
  p,
  {
    name,
    unit = "N",
    ability = "专项力量",
    target = "100",
    ranges = ">=80 | 良好 | green",
  } = {},
) {
  await p.locator("#catalogMetricName").fill(name || "指标甲");
  // This suite covers existing record-summary metrics. Trial defaults have their own UI suite.
  if (await p.locator("#catalogEntryScope").count()) await p.locator("#catalogEntryScope").selectOption("record");
  await p.locator("#catalogUnit").fill(unit);
  await p.locator("#catalogAbility").fill(ability);
  await p.locator("#catalogTarget").fill(target);
  await p.locator("#catalogRanges").fill(ranges);
}
async function addProject(p, fields = {}) {
  await settings(p, "catalog");
  await p
    .locator("#settingsContent")
    .getByRole("button", { name: /新增测试项目$/ })
    .click();
  await p
    .locator("#catalogTestName")
    .fill(fields.testName || "自定义多指标项目");
  await fillMetric(p, fields);
  await saveItem(p);
  const catalog = (await lib(p)).catalog,
    test = catalog.tests.at(-1);
  return {
    test,
    metric: catalog.definitions.find((d) => d.testId === test.id),
  };
}
async function addMetric(p, id, fields = {}) {
  await settings(p, "catalog");
  await p
    .locator('[data-catalog-test="' + id + '"]')
    .getByRole("button", { name: "新增指标", exact: true })
    .click();
  await fillMetric(p, fields);
  await saveItem(p);
  return (await lib(p)).catalog.definitions.at(-1);
}
async function editItem(p, test, id = null) {
  await settings(p, "catalog");
  const row = p.locator('[data-catalog-test="' + test + '"]');
  if (id) {
    await row.locator("summary").click();
    await row.locator("button[onclick*=\"'" + id + "'\"]").click();
  } else
    await row.getByRole("button", { name: "编辑项目", exact: true }).click();
}
async function definition(p, id) {
  await settings(p, "definitions");
  await p.locator('select[aria-label="本次评价指标"]').selectOption(id);
}
async function applyProject(p, id) {
  await settings(p, "catalog");
  p.once("dialog", (d) => d.accept());
  await p
    .locator('[data-catalog-test="' + id + '"]')
    .getByRole("button", { name: "更新本次定义", exact: true })
    .click();
  await settle(p);
}
async function selectRecord(p, id) {
  await sidebar(p);
  await p.locator("#recordSelect").selectOption(id);
  await settle(p);
}
async function saveMenu(p) {
  await sidebar(p);
  await p.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
}
async function download(p, name, file) {
  await saveMenu(p);
  const waiting = p.waitForEvent("download");
  await p
    .locator("#saveModal")
    .getByRole("button", { name, exact: true })
    .click();
  const dl = await waiting,
    dest = path.join(out, file);
  await dl.saveAs(dest);
  if (await p.locator("#saveModal").isVisible())
    await p.locator("#saveModal button.close").click();
  return dest;
}
async function importFile(p, file) {
  await saveMenu(p);
  await p.locator("#importFile").setInputFiles(file);
  await settle(p);
}
async function shot(p, label) {
  const dest = path.join(out, "core-" + label + ".png");
  await p.screenshot({ path: dest });
  result.artifacts.push(dest);
}
async function noDuplicates(p) {
  const ids = await p
    .locator("[id]")
    .evaluateAll((nodes) => nodes.map((n) => n.id));
  assert.equal(new Set(ids).size, ids.length);
}
async function check(id, name, fn, fixture = null) {
  if (only.length && !only.includes(id)) return;
  let s;
  try {
    s = await boot(fixture);
    const detail = await fn(s.p, s);
    assert.deepEqual(s.errors, []);
    assert.deepEqual(s.network, []);
    result.tests.push({ id, name, pass: true, detail });
    console.log("PASS " + name);
  } catch (e) {
    result.tests.push({ id, name, pass: false, error: e.stack });
    console.log("FAIL " + name + ": " + e.message);
    if (s) await shot(s.p, "failure-" + id);
  } finally {
    if (s) {
      result.browserErrors.push(...s.errors);
      result.networkRequests.push(...s.network);
      await s.context.close();
    }
  }
}
async function run() {
  await check("navigation", "侧栏操作、三类设置和固定四张摘要卡", async (p) => {
    assert.equal(
      await p
        .locator("#workspace .topbar #editButton,#workspace .topbar #pdfButton")
        .count(),
      0,
    );
    assert.equal(await p.locator("#sidebar #editButton").count(), 1);
    assert.equal(await p.locator(".micro-card").count(), 4);
    assert.equal(
      await p
        .locator(".micro-card select,.micro-card a,.micro-card button")
        .count(),
      0,
    );
    assert.ok(
      (await p.locator(".micro-cards").innerText()).includes("测试情况概述"),
    );
    for (const [tab, title, n] of [
      ["catalog", "测试项目库", 1],
      ["abilities", "本次评价设置", 6],
      ["ai", "应用设置", 2],
    ]) {
      await settings(p, tab);
      assert.equal(await p.locator("#settingsTitle").innerText(), title);
      assert.equal(await p.locator("#settingsTabs button").count(), n);
      assert.equal(await p.locator("#settingsView #settingsTabs").count(), 0);
    }
    await settings(p, "abilities");
    assert.ok(
      (await p.locator("#settingsContent").innerText()).includes(
        "运动表现概览",
      ),
    );
    await shot(p, "settings");
    await report(p);
    await p.setViewportSize({ width: 390, height: 844 });
    await entry(p, "cmj");
    assert.equal((await p.evaluate(() => App.getUIState())).entryTab, "cmj");
    await report(p);
    await noDuplicates(p);
    return { cards: 4, scopes: 3, mobileEdit: true };
  });
  await check(
    "multimetric",
    "界面创建多指标、主能力分组、备注与零值、刷新和三种备份",
    async (p) => {
      const { test, metric } = await addProject(p),
        second = await addMetric(p, test.id, {
          name: "指标乙",
          unit: "cm",
          ability: "专项爆发",
          target: "40",
        });
      await editItem(p, test.id);
      await p.locator("#catalogPrimaryAbility").selectOption("专项爆发");
      await saveItem(p);
      await sidebar(p);
      await p
        .locator('#sidebar button[onclick="App.openNewAthlete()"] ')
        .click();
      await p.locator("#newAthleteName").fill("多指标真实操作");
      await p.locator("#creationNext").click();
      const choice = p.locator(
        '#creationProjects input[value="' + test.id + '"]',
      );
      assert.equal(await choice.count(), 1);
      assert.equal(
        await choice
          .locator("xpath=ancestor::section")
          .locator("h4")
          .innerText(),
        "专项爆发",
      );
      assert.ok(
        (await choice.locator("xpath=..").innerText()).includes("专项力量"),
      );
      await choice
        .locator("xpath=ancestor::section")
        .getByRole("button", { name: "选择本组", exact: true })
        .click();
      assert.equal(
        await p.locator("[data-creation-count]").innerText(),
        "1 项已选",
      );
      await p.locator("#creationSubmit").click();
      await settle(p);
      await input(p, "customValues." + metric.id + ".value").fill("80");
      await input(p, "customValues." + metric.id + ".notes")
        .locator("xpath=ancestor::details")
        .locator("summary")
        .click();
      await input(p, "customValues." + metric.id + ".notes").fill(
        "原始记录备注",
      );
      await input(p, "customValues." + second.id + ".value").fill("0");
      await settle(p);
      await report(p);
      assert.equal(await p.locator("#detail-" + test.id).count(), 1);
      assert.equal(
        await p.locator("#detail-" + test.id + " [data-metric-id]").count(),
        2,
      );
      assert.ok(
        (await p.locator("#detail-" + test.id).innerText()).includes(
          "原始记录备注",
        ),
      );
      await noDuplicates(p);
      const original = await state(p);
      await p.reload();
      await p.waitForFunction(() => window.App);
      assert.equal(Number((await state(p)).customValues[second.id].value), 0);
      await entry(p, "plan");
      const planChoice = input(p, "enabled." + test.id);
      assert.equal(
        await planChoice
          .locator("xpath=ancestor::section[1]")
          .locator("h4")
          .innerText(),
        "专项爆发",
      );
      await report(p);
      const files = [];
      for (const [name, file] of [
        ["导出当前报告 JSON", "core-roundtrip.json"],
        ["保存当前可编辑 HTML 报告", "core-roundtrip.html"],
        ["备份整个运动员库 JSON", "core-library.json"],
      ])
        files.push(await download(p, name, file));
      for (const file of files) {
        const restored = await boot(
          null,
          file.endsWith(".html") ? file : source,
        );
        try {
          if (!file.endsWith(".html")) await importFile(restored.p, file);
          const r = await state(restored.p);
          assert.equal(r.recordId, original.recordId);
          assert.deepEqual(r.customValues, original.customValues);
          assert.equal(
            r.projectSnapshots.find((t) => t.id === test.id).primaryAbility,
            "专项爆发",
          );
          await noDuplicates(restored.p);
          assert.deepEqual(restored.errors, []);
        } finally {
          await restored.context.close();
        }
      }
      await shot(p, "custom");
      return { testId: test.id, metricIds: [metric.id, second.id], files };
    },
  );
  await check(
    "builtin-extension",
    "内置测试新增指标留在原区块，目录变化须主动应用",
    async (p) => {
      const first = await create(p, ["cmj"]);
      await input(p, "data.cmj.0.height").fill("40");
      await settle(p);
      const extra = await addMetric(p, "cmj", {
        name: "自定义推进测量",
        unit: "N",
        ability: "专项控制",
      });
      assert.ok(!(await state(p)).definitions.some((d) => d.id === extra.id));
      await applyProject(p, "cmj");
      await entry(p, "cmj");
      await input(p, "customValues." + extra.id + ".value").fill("500");
      await settle(p);
      await report(p);
      assert.equal(await p.locator("#detail-cmj").count(), 1);
      assert.equal(
        await p
          .locator('#detail-cmj [data-metric-id="' + extra.id + '"]')
          .count(),
        1,
      );
      assert.equal(
        await p
          .locator('#detail-cmj tr[data-metric-id="' + extra.id + '"]')
          .count(),
        1,
      );
      const before = await state(p);
      await editItem(p, "cmj");
      await p.locator("#catalogPrimaryAbility").selectOption("专项控制");
      await saveItem(p);
      assert.deepEqual(
        (await state(p)).projectSnapshots,
        before.projectSnapshots,
      );
      await sidebar(p);
      await p.locator('#sidebar button[onclick="App.newTest()"] ').click();
      await p.locator("#creationSubmit").click();
      await settle(p);
      assert.equal(
        (await state(p)).projectSnapshots.find((t) => t.id === "cmj")
          .primaryAbility,
        "专项控制",
      );
      await selectRecord(p, first.recordId);
      assert.deepEqual(
        (await state(p)).projectSnapshots,
        before.projectSnapshots,
      );
      assert.equal(Number((await state(p)).customValues[extra.id].value), 500);
      await noDuplicates(p);
      return { historicalId: first.recordId, extraMetric: extra.id };
    },
  );
  await check(
    "reserved-name",
    "constructor 能力可以汇总、配置、保存和恢复",
    async (p) => {
      const { test, metric } = await addProject(p, { ability: "constructor" });
      await create(p, [test.id]);
      await input(p, "customValues." + metric.id + ".value").fill("80");
      await settle(p);
      await report(p);
      assert.ok(
        (await p.locator("#reportView").innerText()).includes("constructor"),
      );
      await settings(p, "abilities");
      const select = p.locator(
        '[data-axis="constructor"][data-axis-key="method"]',
      );
      assert.equal(await select.count(), 1);
      await select.selectOption("mean");
      await settle(p);
      await p.reload();
      await p.waitForFunction(() => window.App);
      assert.equal((await state(p)).axes["ability:constructor"].method, "mean");
      const file = await download(
          p,
          "导出当前报告 JSON",
          "core-constructor.json",
        ),
        s = await boot();
      try {
        await importFile(s.p, file);
        assert.equal(
          (await state(s.p)).axes["ability:constructor"].method,
          "mean",
        );
        assert.deepEqual(s.errors, []);
      } finally {
        await s.context.close();
      }
      return { file };
    },
  );
  await check(
    "metric-unit",
    "本次单位变更可取消、换算目标与区间、不可换算时清空",
    async (p) => {
      const { test, metric } = await addProject(p, {
        ranges: ">=80 | 良好 | green",
      });
      await create(p, [test.id]);
      await input(p, "customValues." + metric.id + ".value").fill("80");
      await settle(p);
      await definition(p, metric.id);
      const unit = p.locator('[data-metric-unit="' + metric.id + '"]');
      await unit.fill("kgf");
      await unit.press("Tab");
      assert.equal(await p.locator("#unitModal").isVisible(), true);
      await p.locator("#unitModal button.close").click();
      assert.equal(await unit.inputValue(), "N");
      assert.equal(Number((await state(p)).customValues[metric.id].value), 80);
      await unit.fill("kgf");
      await unit.press("Tab");
      await p.locator("#unitConvertButton").click();
      let r = await state(p),
        d = r.definitions.find((d) => d.id === metric.id);
      near(r.customValues[metric.id].value, 80 / 9.80665);
      near(d.target, 100 / 9.80665);
      near(d.ranges[0].min, 80 / 9.80665);
      await unit.fill("s");
      await unit.press("Tab");
      assert.equal(await p.locator("#unitConvertButton").isVisible(), false);
      await p.locator("#unitClearButton").click();
      r = await state(p);
      d = r.definitions.find((d) => d.id === metric.id);
      assert.equal(r.customValues[metric.id].value, "");
      assert.equal(d.target, null);
      assert.deepEqual(d.ranges, []);
      await p.reload();
      await p.waitForFunction(() => window.App);
      assert.equal(
        (await state(p)).definitions.find((d) => d.id === metric.id).unit,
        "s",
      );
      return { convert: true, clear: true, cancel: true };
    },
  );
  await check(
    "catalog-unit",
    "目录单位同步换算标准，更新本次定义换算测量而历史不变",
    async (p) => {
      const { test, metric } = await addProject(p);
      const first = await create(p, [test.id]);
      await input(p, "customValues." + metric.id + ".value").fill("80");
      await settle(p);
      await editItem(p, test.id);
      await p.locator("#catalogUnit").fill("kgf");
      await p.locator("#catalogUnit").press("Tab");
      await p.locator("#unitConvertButton").click();
      assert.equal(await p.locator("#catalogModal").isVisible(), true);
      near(
        Number(await p.locator("#catalogTarget").inputValue()),
        100 / 9.80665,
      );
      await saveItem(p);
      assert.equal(
        (await state(p)).definitions.find((d) => d.id === metric.id).unit,
        "N",
      );
      await sidebar(p);
      await p.locator('#sidebar button[onclick="App.newTest()"] ').click();
      await p.locator("#creationSubmit").click();
      await settle(p);
      const next = await state(p);
      assert.equal(
        next.definitions.find((d) => d.id === metric.id).unit,
        "kgf",
      );
      await selectRecord(p, first.recordId);
      assert.equal(Number((await state(p)).customValues[metric.id].value), 80);
      await applyProject(p, test.id);
      near((await state(p)).customValues[metric.id].value, 80 / 9.80665);
      await editItem(p, test.id);
      await p.locator("#catalogUnit").fill("s");
      await p.locator("#catalogUnit").press("Tab");
      await p.locator("#unitClearButton").click();
      await saveItem(p);
      await applyProject(p, test.id);
      assert.equal((await state(p)).customValues[metric.id].value, "");
      await selectRecord(p, next.recordId);
      assert.equal(
        (await state(p)).definitions.find((d) => d.id === metric.id).unit,
        "kgf",
      );
      return { first: first.recordId, next: next.recordId };
    },
  );
  await check(
    "screen-boundaries",
    "FMS 缺测疼痛与等长单侧中线不同单位",
    async (p) => {
      await create(p, ["fms", "iso"]);
      await input(p, "data.fms.0.score").selectOption("3");
      await input(p, "data.fms.1.left").selectOption("2");
      await input(p, "data.fms.2.pain").check();
      await settle(p);
      await entry(p, "iso");
      const rows = (await state(p)).data.iso,
        center = rows.findIndex((x) => !x.paired),
        left = rows.findIndex((x) => x.paired),
        both = rows.findIndex((x, i) => x.paired && i !== left);
      await input(p, `data.iso.${center}.center`).fill("10");
      await input(p, `data.iso.${left}.left`).fill("80");
      await input(p, `data.iso.${both}.unit`).selectOption("kgf");
      await p.locator("#unitConvertButton").click();
      await input(p, `data.iso.${both}.left`).fill("8");
      await input(p, `data.iso.${both}.right`).fill("10");
      await settle(p);
      await report(p);
      assert.equal(await p.locator("#detail-fms [data-fms-axis]").count(), 7);
      assert.equal(await p.locator("#detail-fms .viz-point").count(), 2);
      assert.ok(
        (await p.locator("#detail-fms").innerText()).includes("0 · 疼痛"),
      );
      assert.equal(await p.locator("#detail-fms table tbody tr").count(), 7);
      assert.equal(
        await p.locator("#detail-iso [data-radar-series]").count(),
        2,
      );
      const text = await p.locator("#detail-iso").innerText();
      assert.ok(text.includes("20.0% · 左侧较弱") && text.includes("kgf"));
      await p.locator("#detail-fms").scrollIntoViewIfNeeded();
      await shot(p, "fms-boundary");
      await p.locator("#detail-iso").scrollIntoViewIfNeeded();
      await shot(p, "iso-boundary");
      await noDuplicates(p);
      return { partialFMS: true, dualSeries: 2 };
    },
  );
  await check(
    "unclassified",
    "无能力与无目标项目仍有完整数值结果",
    async (p) => {
      const { test, metric } = await addProject(p, {
        ability: "",
        target: "",
        ranges: "",
      });
      await create(p, [test.id]);
      await input(p, "customValues." + metric.id + ".value").fill("0");
      await settle(p);
      await report(p);
      const text = await p.locator("#detail-" + test.id).innerText();
      assert.ok(text.includes("0.00"));
      assert.ok(!text.includes("未启用评价标准"));
      assert.equal(
        await p
          .locator("#detail-" + test.id)
          .locator("xpath=..")
          .locator(".quality-heading h3")
          .innerText(),
        "未分类",
      );
      return { zeroPreserved: true };
    },
  );
  await check(
    "unselected-group",
    "尚未选入的目录项目在本次计划中仍按正确能力分组",
    async (p) => {
      const { test } = await addProject(p, { ability: "待选能力" });
      await create(p, ["cmj"]);
      await entry(p, "plan");
      const control = input(p, "enabled." + test.id);
      assert.equal(
        await control
          .locator("xpath=ancestor::section[1]")
          .locator("h4")
          .innerText(),
        "待选能力",
      );
      await control.check();
      await settle(p);
      await entry(p, test.id);
      assert.ok(
        (await p.locator("#entryNav").innerText()).includes("待选能力"),
      );
      await noDuplicates(p);
      return { project: test.id };
    },
  );
  await check(
    "unit-draft-guard",
    "未应用评价草稿会阻止单位换算，应用后才可同步修改",
    async (p) => {
      const { test, metric } = await addProject(p);
      await create(p, [test.id]);
      await definition(p, metric.id);
      await p.locator("#rangesText").fill(">=90 | 良好 | green");
      const unit = p.locator('[data-metric-unit="' + metric.id + '"]');
      await unit.fill("kgf");
      await unit.press("Tab");
      assert.equal(await p.locator("#unitModal").isVisible(), false);
      assert.equal(await unit.inputValue(), "N");
      assert.equal(
        await p.locator("#rangesText").inputValue(),
        ">=90 | 良好 | green",
      );
      await p.getByRole("button", { name: "应用区间", exact: true }).click();
      await unit.fill("kgf");
      await unit.press("Tab");
      await p.locator("#unitConvertButton").click();
      near(
        (await state(p)).definitions.find((d) => d.id === metric.id).ranges[0]
          .min,
        90 / 9.80665,
      );
      return { draftProtected: true };
    },
  );
  await check(
    "project-category",
    "项目分类同步全部指标且本次修改不改变共用目录",
    async (p) => {
      const { test, metric } = await addProject(p);
      const second = await addMetric(p, test.id, {
        name: "指标乙",
        ability: "控制能力",
      });
      await editItem(p, test.id);
      await p.locator("#catalogCategory").selectOption("screen");
      await saveItem(p);
      assert.ok(
        (await lib(p)).catalog.definitions
          .filter((d) => d.testId === test.id)
          .every((d) => d.category === "screen"),
      );
      await create(p, [test.id]);
      await input(p, "customValues." + metric.id + ".value").fill("50");
      await input(p, "customValues." + second.id + ".value").fill("40");
      await settle(p);
      await definition(p, metric.id);
      const index = (await state(p)).definitions.findIndex(
        (d) => d.id === metric.id,
      );
      await input(p, "definitions." + index + ".category").selectOption(
        "performance",
      );
      await settle(p);
      await report(p);
      assert.equal(
        await p.locator("#performanceDetail #detail-" + test.id).count(),
        1,
      );
      assert.equal(
        await p.locator("#screenDetail #detail-" + test.id).count(),
        0,
      );
      assert.ok(
        (await state(p)).definitions
          .filter((d) => d.testId === test.id)
          .every((d) => d.category === "performance"),
      );
      assert.ok(
        (await lib(p)).catalog.definitions
          .filter((d) => d.testId === test.id)
          .every((d) => d.category === "screen"),
      );
      return { metrics: 2 };
    },
  );
  await check(
    "unit-undo-pairs",
    "撤销等长单位修改保留其他关节配对的新设置",
    async (p) => {
      await create(p, ["iso"]);
      const r = await state(p),
        index = r.data.iso.findIndex((row) => row.paired),
        row = r.data.iso[index];
      await input(p, "data.iso." + index + ".left").fill("100");
      await input(p, "data.iso." + index + ".unit").selectOption("kgf");
      await p.locator("#unitConvertButton").click();
      const pairIndex = r.balancePairs.findIndex(
        (pair) => pair.numeratorId !== row.id && pair.denominatorId !== row.id,
      );
      assert.ok(pairIndex >= 0);
      await settings(p, "balance");
      await input(p, "balancePairs." + pairIndex + ".confirmed").setChecked(
        !r.balancePairs[pairIndex].confirmed,
      );
      await settle(p);
      await entry(p, "iso");
      await p.locator("#undoDeleteButton").click();
      assert.equal(
        (await state(p)).balancePairs[pairIndex].confirmed,
        !r.balancePairs[pairIndex].confirmed,
      );
      assert.equal((await state(p)).data.iso[index].unit, "N");
      assert.equal(
        await p.evaluate(() => document.activeElement.tagName),
        "INPUT",
      );
      return { unrelatedPairRetained: true };
    },
  );
  await check(
    "quantity-limit",
    "75 个项目与 300 个指标边界、完整能力列表和长名称窄屏",
    async (p) => {
      const r = await state(p);
      assert.equal(r.projectSnapshots.length, 75);
      assert.equal(r.definitions.length, 300);
      assert.equal(await p.locator(".ability-comparison tbody tr").count(), 60);
      assert.equal(
        await p.locator('[data-test-ids^="custom_fixture_"]').count(),
        60,
      );
      assert.equal(
        await p.locator('[data-metric-id^="fixture_metric_"]').count(),
        300 -
          r.definitions.filter((d) => !d.id.startsWith("fixture_metric_"))
            .length,
      );
      await noDuplicates(p);
      const layouts = [];
      for (const width of [1440, 900, 390]) {
        await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await settle(p);
        const scroll = await p.evaluate(
          () => document.documentElement.scrollWidth,
        );
        assert.equal(scroll, width);
        await p.locator(".ability-comparison").scrollIntoViewIfNeeded();
        await shot(p, "limit-" + width);
        layouts.push({ width, scroll });
      }
      await p.reload();
      await p.waitForFunction(() => window.App);
      await noDuplicates(p);
      return { tests: 75, definitions: 300, abilities: 60, layouts };
    },
    extensionFixture({ max: true }),
  );
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true });
    result.browser = browser.version();
    await run();
  } catch (e) {
    result.fatalError = e.stack;
  } finally {
    await browser?.close();
    result.passed = result.tests.filter((t) => t.pass).length;
    result.failed = result.tests.filter((t) => !t.pass).length;
    fs.writeFileSync(
      path.join(out, "core-verification-results.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(result.passed + " passed, " + result.failed + " failed");
    if (result.failed || result.fatalError) process.exitCode = 1;
  }
})();
