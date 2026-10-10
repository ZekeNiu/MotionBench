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
  source = path.join(root, "MotionBench.html"),
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
  const dest = path.join(out, "radar-" + label + ".png");
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
const { radarFixture } = require("./helpers/radar-fixtures.cjs");
async function run() {
  await check(
    "jump-controls",
    "原生试次实际录入、最佳同次选择和每字段均值",
    async (p) => {
      await create(p, ["cmj", "sj"]);
      for (const [key, value] of Object.entries({
        height: 40,
        rsiModified: 0.55,
        force: 1234,
        landingPeakForce: 2345,
      }))
        await input(p, "data.cmj.0." + key).fill(String(value));
      await p
        .getByRole("button", { name: /新增试次/ })
        .first()
        .click();
      await input(p, "data.cmj.1.height").fill("45");
      await input(p, "data.cmj.1.force").fill("1400");
      await settle(p);
      await report(p);
      let s = await p.evaluate(() => App.stats());
      assert.equal(s.values.cmj_peak_force, 1400);
      assert.equal(s.values.cmj_rsi_modified, undefined);
      const controls = await p.locator("#aggMode").count();
      assert.equal(controls, 1);
      await p.locator("#aggMode").selectOption("mean");
      await settle(p);
      s = await p.evaluate(() => App.stats());
      near(s.values.cmj_rsi_modified, 0.55);
      assert.equal(s.raw.cmj.counts.rsiModified, 1);
      await p.reload();
      await p.waitForFunction(() => window.App);
      assert.equal(Number((await state(p)).data.cmj[0].landingPeakForce), 2345);
      await noDuplicates(p);
      return { sameAttempt: true, meanCounts: true };
    },
  );
  await check(
    "trial-catalog",
    "自定义试次指标创建、单位更新和JSON往返",
    async (p) => {
      await create(p, ["cmj"]);
      await input(p, "data.cmj.0.height").fill("40");
      await settings(p, "catalog");
      await p
        .locator('[data-catalog-test="cmj"]')
        .getByRole("button", { name: "新增指标", exact: true })
        .click();
      await fillMetric(p, { name: "试次力测试", unit: "N", target: "98.0665" });
      await p.locator("#catalogEntryScope").selectOption("attempt");
      await saveItem(p);
      const metric = (await lib(p)).catalog.definitions.at(-1);
      await applyProject(p, "cmj");
      await entry(p, "cmj");
      const key = "data.cmj.0.metrics." + metric.id;
      await input(p, key).fill("98.0665");
      await settle(p);
      await report(p);
      assert.ok(
        (await p.locator("#detail-cmj").innerText()).includes("试次力测试"),
      );
      assert.equal(
        await p
          .locator('#detail-cmj [data-metric-id="' + metric.id + '"]')
          .count(),
        1,
      );
      await editItem(p, "cmj", metric.id);
      assert.equal(await p.locator("#catalogEntryScope").isDisabled(), true);
      await p.locator("#catalogUnit").fill("kgf");
      await p.locator("#catalogUnit").press("Tab");
      await p.locator("#unitConvertButton").click();
      await saveItem(p);
      await applyProject(p, "cmj");
      near((await state(p)).data.cmj[0].metrics[metric.id], 10);
      const original = await state(p);
      await report(p);
      const file = await download(p, "导出当前报告 JSON", "radar-trials.json");
      const other = await boot();
      try {
        await importFile(other.p, file);
        near((await state(other.p)).data.cmj[0].metrics[metric.id], 10);
      } finally {
        await other.context.close();
      }
      // An imported catalog may request a scope mutation that the editor disallows.
      await p.evaluate((id) => {
        App.getLibrary().catalog.definitions.find(
          (d) => d.id === id,
        ).entryScope = "record";
      }, metric.id);
      await settings(p, "catalog");
      await p
        .locator('[data-catalog-test="cmj"]')
        .getByRole("button", { name: "更新本次定义", exact: true })
        .click();
      await settle(p);
      assert.deepEqual((await state(p)).data.cmj, original.data.cmj);
      assert.equal(
        (await state(p)).definitions.find((d) => d.id === metric.id).entryScope,
        "attempt",
      );
      assert.ok((await p.locator("#toast").innerText()).includes("录入层级"));
      return { metric: metric.id, converted: 10, scopeGuard: true };
    },
  );
  await check(
    "context-history",
    "训练背景保存、沿用、历史隔离与草稿失效",
    async (p) => {
      const first = await create(p, ["cmj"]);
      await input(p, "data.cmj.0.height").fill("20");
      await entry(p, "athlete");
      await input(p, "trainingContext.experienceYears").fill("3");
      await input(p, "trainingContext.weeklySessions").fill("1");
      await input(p, "trainingContext.equipment").fill("自重、哑铃");
      await input(p, "trainingContext.weeklySchedule").fill("周六体能");
      await settle(p);
      await entry(p, "narrative");
      await p
        .getByRole("button", { name: "生成本地草稿", exact: true })
        .click();
      assert.ok(
        (await p.locator("#aiPreview").innerText()).includes("每周1次"),
      );
      await p.getByRole("button", { name: "关闭草稿", exact: true }).click();
      await entry(p, "athlete");
      await input(p, "trainingContext.weeklySessions").fill("2");
      await settle(p);
      await p.evaluate(() => App.applyAI());
      assert.equal((await state(p)).narrative.text, "");
      assert.ok((await p.locator("#toast").innerText()).includes("数据已更新"));
      const prior = await state(p);
      await sidebar(p);
      await p.locator('#sidebar button[onclick="App.newTest()"] ').click();
      await p.locator("#creationSubmit").click();
      await settle(p);
      const next = await state(p);
      assert.deepEqual(next.trainingContext, prior.trainingContext);
      await entry(p, "athlete");
      await input(p, "trainingContext.equipment").fill("仅自重");
      await settle(p);
      await selectRecord(p, first.recordId);
      assert.equal((await state(p)).trainingContext.equipment, "自重、哑铃");
      await p.reload();
      await p.waitForFunction(() => window.App);
      assert.equal((await state(p)).trainingContext.weeklySessions, "2");
      return { history: first.recordId, next: next.recordId };
    },
  );
  await check(
    "editable-preview",
    "草稿可先编辑再应用并保留原正文",
    async (p) => {
      await entry(p, "narrative");
      await p.locator("#interpEditor").fill("原有人工正文");
      await settle(p);
      await p
        .getByRole("button", { name: "生成本地草稿", exact: true })
        .click();
      await p.locator("#aiPreview").fill("教练修改后的训练安排");
      await p.locator("#applyDraftButton").click();
      let r = await state(p);
      assert.equal(r.narrative.text, "教练修改后的训练安排");
      assert.equal(r.previousNarrative.text, "原有人工正文");
      assert.ok(r.narrative.origin.includes("人工编辑"));
      await p.reload();
      await p.waitForFunction(() => window.App);
      assert.equal((await state(p)).narrative.text, "教练修改后的训练安排");
    },
  );
  await check(
    "dual-radar-layout",
    "双系列填色、超100刻度、缺测不闭合与四宽度布局",
    async (p) => {
      assert.equal(
        await p
          .locator('#detail-iso [data-radar-series="strength"] .radar-fill')
          .count(),
        1,
      );
      assert.equal(
        await p
          .locator('#detail-iso [data-radar-series="symmetry"] .radar-fill')
          .count(),
        1,
      );
      const colors = await p
        .locator("#detail-iso .radar-fill")
        .evaluateAll((ns) =>
          ns.map((n) => ({
            fill: n.getAttribute("fill"),
            opacity: n.getAttribute("fill-opacity"),
          })),
        );
      assert.notEqual(colors[0].fill, colors[1].fill);
      assert.ok(
        colors.every((c) => Number(c.opacity) > 0 && Number(c.opacity) < 1),
      );
      assert.ok(
        await p.evaluate(
          () => RingsideReport.build(App.getState()).isoRadar.max > 100,
        ),
      );
      const layouts = [];
      for (const width of [1440, 1280, 900, 390]) {
        await p.setViewportSize({ width, height: 1000 });
        await settle(p);
        const bounds = await p.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          pairs: [...document.querySelectorAll(".detail-pair")].map((e) => ({
            width: e.clientWidth,
            columns: getComputedStyle(e).gridTemplateColumns,
            charts: [...e.querySelectorAll("svg")].map((s) => ({
              height: s.getBoundingClientRect().height,
              width: s.getBoundingClientRect().width,
            })),
          })),
        }));
        assert.equal(bounds.scroll, width);
        assert.ok(
          bounds.pairs.flatMap((x) => x.charts).every((s) => s.height <= 341),
        );
        layouts.push(bounds);
        for (const id of ["iso", "cmj", "imtp"])
          await p.locator("#detail-" + id).screenshot({
            path: path.join(out, `radar-${width}-${id}.png`),
            style: ".topbar{visibility:hidden!important}",
          });
        for (const id of [
          "detail-fms",
          "detail-iso",
          "detail-cmj",
          "detail-imtp",
          "detail-lactate",
          "lvp-upper",
          "lvp-lower",
        ])
          await p
            .locator("#" + id + " .chart-wrap")
            .first()
            .screenshot({
              path: path.join(out, `chart-${width}-${id}.png`),
              style: ".topbar{visibility:hidden!important}",
            });
      }
      await p.setViewportSize({ width: 1440, height: 1000 });
      await p.evaluate(() => {
        App.getState()
          .data.iso.filter((x) => x.region === "hip")
          .forEach((x) => {
            x.left = "";
            x.right = "";
          });
        App.renderReport();
      });
      assert.equal(
        await p
          .locator('#detail-iso [data-radar-series="strength"] line')
          .count(),
        3,
      );
      assert.equal(
        await p
          .locator('#detail-iso [data-radar-series="strength"] .radar-fill')
          .count(),
        3,
      );
      await noDuplicates(p);
      return { colors, layouts };
    },
    radarFixture(),
  );
  await check(
    "renderer-fallback",
    "图表故障与未知类型保留试次和其他测试结果",
    async (p) => {
      const output = await p.evaluate(() => {
        const old = RingsideViz.lvp;
        RingsideViz.lvp = () => {
          throw Error("injected");
        };
        const report = RingsideReport.build(App.getState());
        let html = RingsideReport.render(report);
        RingsideViz.lvp = old;
        const host = document.createElement("div");
        host.innerHTML = html;
        const lvp = {
          fallback: report.diagnostics.length > 0,
          bench: host.querySelector("#detail-bench").textContent,
          fms: !!host.querySelector("#detail-fms"),
        };
        const other = RingsideReport.build(App.getState());
        other.projects.find((x) => x.id === "cmj").renderer = "unknown";
        html = RingsideReport.render(other);
        return {
          lvp,
          unknown:
            html.includes("试次扩展指标 6") && html.includes("图形暂不可用"),
        };
      });
      assert.ok(output.lvp.fallback && output.lvp.fms && output.unknown);
      assert.ok(output.lvp.bench.includes("负荷"));
      return output;
    },
    radarFixture(),
  );
  await check(
    "partial-values",
    "RFD单项、乳酸心率部分记录与关节平衡列完整显示",
    async (p) => {
      const text = await p.locator("#detail-imtp").innerText();
      assert.ok(text.includes("4,321.00") && text.includes("125"));
      assert.ok(await p.evaluate(() => RingsideModel.stats(App.getState()).balanceResults
        .some((balance) => balance.results.some((result) => (result.reason || balance.reason || '').includes('测量单位不同')))));
      assert.ok(!(await p.locator("#detail-iso").innerText()).includes("测量单位不同"));
      assert.equal(await p.locator("#detail-iso table").count(), 1);
      assert.equal(
        await p.locator("#detail-iso th").last().innerText(),
        "关节平衡",
      );
      const balanceIds = await p
        .locator("#detail-iso [data-balance-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.dataset.balanceId).sort(),
        );
      const expectedBalanceIds = await p.evaluate(() => {
        const s = RingsideModel.stats(App.getState());
        const measured = new Set(
          s.isoAnalyses
            .filter((row) =>
              row.sides.some((side) => side.value !== null || side.pain),
            )
            .map((row) => row.id),
        );
        return s.balanceResults
          .filter(
            (b) => (measured.has(b.numeratorId) || measured.has(b.denominatorId)) && b.results.some((result) => result.value !== null),
          )
          .map((b) => b.id)
          .sort();
      });
      assert.deepEqual(balanceIds, expectedBalanceIds);
      assert.ok(
        (await p.locator("#detail-lactate").innerText()).includes("195"),
      );
      await p
        .locator("#detail-cmj .attempt-details")
        .first()
        .locator("summary")
        .click();
      assert.equal(
        await p
          .locator("#detail-cmj .attempt-details")
          .first()
          .locator("tbody tr")
          .count(),
        60,
      );
      return { trialRows: 60 };
    },
    radarFixture(),
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
      path.join(out, "radar-verification-results.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(result.passed + " passed, " + result.failed + " failed");
    if (result.failed || result.fatalError) process.exitCode = 1;
  }
})();
