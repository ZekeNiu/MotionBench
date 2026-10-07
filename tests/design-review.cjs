"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/playwright/visual-upgrade");
const baseline = "output/backups/visual-upgrade-pre-implementation-20261006/Ringside_Boxing_Assessment.html";
const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { sourceHash: digest(path.join(root, "Ringside_Boxing_Assessment.html")), baselineHash: digest(path.join(root, baseline)), layouts: [], contrast: [], errors: [], network: [], images: [] };

async function checkLongRadarLabels(page) {
  result.radarLabels = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const cases = await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.cssText = "width:520px;position:fixed;left:-10000px;top:0";
      document.body.append(host);
      const results = [];
      for (let count = 3; count <= 8; count++) {
        host.innerHTML = RingsideViz.radar(Array.from({ length: count }, (_, i) => ({ label: "较长的自定义能力分类标签" + i, value: 85, status: "amber" })));
        const bounds = host.querySelector("svg").viewBox.baseVal;
        const labels = [...host.querySelectorAll(".radar-label")].map(label => {
          const a = label.getBBox(), b = label.nextElementSibling.getBBox();
          return { outside: [a, b].some(r => r.x < 0 || r.y < 0 || r.x + r.width > bounds.width || r.y + r.height > bounds.height), overlap: a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y };
        });
        results.push({ count, labels });
      }
      host.remove();
      return results;
    });
    result.radarLabels.push({ width, cases });
    assert.ok(cases.every(c => c.labels.every(l => !l.outside && !l.overlap)), "Long radar labels and scores must fit without overlap at " + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

// Audit rendered, visible text using actual ancestor backgrounds, including alpha.
async function contrast(page, state) {
  const issues = await page.evaluate(() => {
    const rgb = text => (text.match(/[\d.]+/g) || []).map(Number);
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const found = new Map();
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement) || el.closest("svg,.brand,[disabled],.context-divider") || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const content = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("").trim();
      if (!content || !/[\p{L}\p{N}]/u.test(content)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
      const style = getComputedStyle(el), ancestors = [];
      for (let p = el; p; p = p.parentElement) ancestors.unshift(p);
      let bg = [255, 255, 255];
      for (const p of ancestors) bg = blend(rgb(getComputedStyle(p).backgroundColor), bg);
      const fg = blend(rgb(style.color), bg), a = luminance(fg), b = luminance(bg);
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const size = parseFloat(style.fontSize), large = size >= 24 || (size >= 18.667 && Number(style.fontWeight) >= 700);
      if (ratio + .001 < (large ? 3 : 4.5)) {
        const key = style.color + ":" + bg.join(",");
        if (!found.has(key)) found.set(key, { selector: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "." + String(el.className).replaceAll(" ", ".")), text: content.slice(0, 90), color: style.color, bg, ratio, size });
      }
    }
    return [...found.values()];
  });
  result.contrast.push({ state, issues });
}

async function capture(page, version, name) {
  const filename = path.join(output, version, name + ".png");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: filename });
  result.images.push({ version, name, path: path.relative(root, filename), sha256: digest(filename) });
  if (version === "after") {
    const bounds = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    result.layouts.push({ state: name, ...bounds });
    assert.equal(bounds.scrollWidth, bounds.width, name + " must not overflow horizontally");
    await contrast(page, name);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [version, file] of [["before", baseline], ["after", "Ringside_Boxing_Assessment.html"]]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai", offline: true });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-10-06T15:43:00Z"));
      if (version === "after") {
        page.on("pageerror", e => result.errors.push(e.message));
        page.on("request", r => { if (/^https?:/.test(r.url())) result.network.push(r.url()); });
      }
      const url = pathToFileURL(path.join(root, file)).href;
      await page.goto(url);
      await page.waitForFunction(() => window.App?.getUIState);
      for (const width of [1920, 1440, 1280, 900, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: "instant" }); });
        await capture(page, version, "summary-" + width);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (version === "after") await checkLongRadarLabels(page);
      for (const [id, name] of [["detail-fms", "fms"], ["detail-iso", "isometric"], [".test-block:has(.speed-detail)", "speed"]]) {
        const loc = page.locator(id.startsWith(".") ? id : "#" + id);
        if (await loc.count()) {
          await loc.scrollIntoViewIfNeeded();
          await capture(page, version, name + "-1440");
        }
      }
      await page.locator("#editButton").click();
      await capture(page, version, "athlete-entry-1440");
      await page.locator("#entryNav button").filter({ hasText: "IMTP" }).click();
      await capture(page, version, "measurement-entry-1440");
      if (version === "after") {
        assert.equal(await page.locator("#entryContent > h3").count(), 0);
        assert.equal(await page.locator("#entryProjectTitle").innerText(), "IMTP");
        await page.keyboard.press("Tab");
        result.keyboardFocus = await page.evaluate(() => { const e = document.activeElement; return { tag: e.tagName, visible: e.checkVisibility(), outline: getComputedStyle(e).outlineStyle }; });
        assert.ok(result.keyboardFocus.visible);
        assert.notEqual(result.keyboardFocus.outline, "none");
      }
      await page.locator('[data-settings-open="catalog"]').click();
      await capture(page, version, "catalog-1440");
      await page.locator('.catalog-metrics > summary').first().click();
      await capture(page, version, "catalog-expanded-1440");
      await page.getByRole("button", { name: "新建运动员", exact: true }).click();
      await capture(page, version, "new-athlete-1440");
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page.locator('[data-settings-open="record"]').click();
      await capture(page, version, "settings-1440");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      await page.evaluate(() => App.openEntry());
      await capture(page, version, "entry-390");
      await page.locator("#sidebarToggle").click();
      await capture(page, version, "navigation-390");
      await page.locator('[data-settings-open="catalog"]').click();
      await capture(page, version, "catalog-390");
      await context.close();
    }
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.network, []);
    const failures = result.contrast.filter(x => x.issues.length);
    result.pass = !failures.length;
    if (failures.length) { console.log(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
    else console.log("PASS design review: five widths, catalog/entry/modal, visible text contrast and keyboard focus");
  } catch (e) { result.pass = false; result.failure = e.stack; process.exitCode = 1; console.error(e); }
  finally { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, "review.json"), JSON.stringify(result, null, 2)); await browser.close(); }
})();
