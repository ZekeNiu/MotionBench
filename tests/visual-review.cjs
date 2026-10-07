"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/playwright");
const file = path.join(root, "Ringside_Boxing_Assessment.html");
fs.mkdirSync(out, { recursive: true });
const result = {
  sourceHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  layouts: [],
  errors: [],
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    offline: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => result.errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => window.App?.getUIState);
    for (const width of [1440, 1280, 900, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(() => {
        App.showReport(false);
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(out, `final-${width}-summary.png`),
      });
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        fms: [...document.querySelectorAll("#detail-fms .detail-pair>div")].map(
          (e) => ({
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
          }),
        ),
        summary: [
          ...document.querySelectorAll(
            ".summary-grid>.card,.screen-layout,.performance-layout",
          ),
        ].map((e) => ({
          class: e.className,
          width: e.getBoundingClientRect().width,
          height: e.getBoundingClientRect().height,
        })),
        duplicateIds: [...document.querySelectorAll("[id]")]
          .map((e) => e.id)
          .filter((id, i, all) => all.indexOf(id) !== i),
      }));
      assert.equal(layout.scrollWidth, width);
      assert.deepEqual(layout.duplicateIds, []);
      assert.ok(
        layout.fms[0].height <= 360,
        "Chart stays bounded beside its independent table",
      );
      if (width > 1100)
        assert.ok(
          Math.abs(layout.fms[0].width / layout.fms[1].width - 44 / 56) < 0.02,
        );
      result.layouts.push(layout);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [id, label] of [
      ["detail-fms", "fms"],
      ["detail-iso", "iso"],
      ["detail-imtp", "force"],
      ["detail-lactate", "lactate"],
      ["lvp-upper", "lvp"],
      ["interpretation", "narrative"],
    ]) {
      const element = page.locator("#" + id);
      if (await element.count()) {
        await element.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(out, `final-1440-${label}.png`),
        });
      }
    }
    await page.evaluate(() => {
      App.openEntry();
      App.entry("imtp");
    });
    await page.screenshot({ path: path.join(out, "final-1440-edit.png") });
    await page.evaluate(() => App.openSettings("methods"));
    await page.screenshot({ path: path.join(out, "final-1440-methods.png") });
    await page.evaluate(() => {
      App.showReport(false);
      const r = App.getState();
      r.athlete.name = "长姓名验收运动员阿布都热合曼·训练团队档案";
      const original = r.data.iso.find(
        (x) => x.region === "shoulder" && x.paired,
      );
      r.data.iso = Array.from({ length: 24 }, (_, i) => ({
        ...original,
        id: "visual-iso-" + i,
        direction: "肩部训练方向" + (i + 1),
        left: 160 + i,
        right: 200 + i,
      }));
      r.balancePairs = [];
      r.views.lvpUpper.selected = ["bench", "landmineR", "landmineL"];
      r.views.lvpUpper.selectionExplicit = true;
      r.lvp.landmineR.mvt = 0.5;
      r.lvp.landmineL.mvt = 0.5;
      const text = [
        "【主要发现】",
        "用于长中文正文版面核验。",
        "【训练优先级】",
        ...Array.from(
          { length: 18 },
          (_, i) =>
            "第" +
            (i + 1) +
            "段：保持站架稳定、控制骨盆和躯干，再逐步提高输出。根据左右侧数据确定练习方向，避免借力或缩短动作幅度。".repeat(
              3,
            ),
        ),
        "【执行建议】",
        "长正文最后一段。",
      ].join("\n\n");
      r.narrative = {
        html: RingsideModel.textToHTML(text),
        text,
        origin: "manual",
        basis: RingsideModel.fingerprint(r),
        revision: 1,
      };
      App.renderReport();
    });
    for (const width of [1440, 1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: path.join(out, `final-stress-${width}-summary.png`),
      });
      const bounds = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert.equal(bounds.scrollWidth, width);
      const estimateLabels = await page.evaluate(() =>
        [...document.querySelectorAll("#lvp-upper .lvp-estimate-label")].map(
          (node) => {
            const box = node.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            };
          },
        ),
      );
      assert.equal(estimateLabels.length, 3);
      for (let i = 0; i < estimateLabels.length; i++) {
        for (let j = i + 1; j < estimateLabels.length; j++) {
          const a = estimateLabels[i],
            b = estimateLabels[j];
          assert.ok(
            !(
              a.left < b.right &&
              a.right > b.left &&
              a.top < b.bottom &&
              a.bottom > b.top
            ),
            `${width}px LVP labels overlap`,
          );
        }
      }
      for (const [id, label] of [
        ["detail-iso", "iso"],
        ["lvp-upper", "lvp"],
        ["interpretation", "narrative"],
      ]) {
        await page.locator("#" + id).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(out, `final-stress-${width}-${label}.png`),
        });
      }
    }
    assert.deepEqual(result.errors, []);
    result.pass = true;
    console.log("PASS visual layouts: 1440 / 1280 / 390, sample and stress");
  } catch (error) {
    result.pass = false;
    result.error = error.stack;
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(out, "final-visual-results.json"),
      JSON.stringify(result, null, 2),
    );
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
