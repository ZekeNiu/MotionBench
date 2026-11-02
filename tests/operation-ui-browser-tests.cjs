"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, "..");
const arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const source = path.resolve(root, arg("--source", "MotionBench.html"));
const out = path.resolve(root, arg("--artifact-dir", "output/playwright/operation-ui-227"));
const baseline = arg("--baseline", "");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { channel, sourceHash:hash(source), sourceSHA256:hash(source), runnerSha256:hash(__filename), baselineCompared:!!baseline, baselineHash:baseline?hash(path.resolve(root,baseline)):null, pass:false, checks:[], screenshots:[], artifacts:[], errors:[] };
fs.mkdirSync(out, { recursive: true });
let browser, fixture;
async function open(file, width = 1440, height = 1000) {
  const context = await browser.newContext({ offline: true, locale: "zh-CN", reducedMotion: "reduce", viewport: { width, height } });
  const page = await context.newPage();
  page.on("pageerror", e => result.errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => App.ready);
  fixture ||= await page.evaluate(() => RingsideModel.recordEnvelope(RingsideModel.sampleRecord()));
  await page.evaluate(payload => App.importPayload(payload), fixture);
  await settle(page);
  return { context, page };
}
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function check(name, run) {
  await run(); result.checks.push(name); console.log("PASS " + name);
}
async function shot(page, name) {
  await page.evaluate(() => {
    const toast = document.querySelector("#toast"); if (toast) toast.style.display = "none";
    document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: "instant" });
  });
  await settle(page);
  const target = path.join(out, channel + "-" + name + ".png");
  await page.screenshot({ path: target, animations: "disabled" });
  result.screenshots.push(target);
  result.artifacts.push({ path:path.relative(root,target).replaceAll("\\","/"), kind:"screenshot", sha256:hash(target), bytes:fs.statSync(target).size });
}
const catalogOpen = (page, id) => page.locator(`[data-manager-action="catalog-open"][data-id="${id}"]`).click();
async function originalExplanations(page) {
  await page.evaluate(() => App.openManagement("metrics"));
  const ids = await page.locator('[data-manager-action="catalog-open"]').evaluateAll(nodes => nodes.map(n => n.dataset.id));
  const texts = {};
  for (const id of ids) {
    await catalogOpen(page, id);
    texts[id] = await page.locator("[data-catalog-measurement]").textContent();
  }
  return texts;
}
async function stableReportAppearance(page) {
  await page.evaluate(async () => { await App.showReport(false); window.scrollTo({ top: 0, behavior: "instant" }); });
  await settle(page);
  return page.evaluate(() => {
    const inspect = root => [root, ...root.querySelectorAll("*")].filter(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return box.width && box.height && style.visibility !== "hidden";
    }).map(node => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      const properties = ["fontFamily", "fontSize", "fontWeight", "color", "backgroundColor", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginBottom", "gridTemplateColumns", "borderRadius"];
      return { tag: node.tagName, class: typeof node.className === "string" ? node.className : node.className.baseVal,
        style: properties.map(key => style[key]), box: [box.x, box.y, box.width, box.height].map(n => Math.round(n * 100) / 100) };
    });
    return { report: inspect(document.querySelector("#reportView")), sidebar: inspect(document.querySelector("#sidebar")) };
  });
}
async function fitsPage(page) {
  await settle(page);
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1, JSON.stringify(dimensions));
}
(async () => {
  browser = await chromium.launch({ channel, headless: true });
  let expected = null, appearance = null;
  if (baseline) {
    const { page, context } = await open(path.resolve(root, baseline));
    expected = await originalExplanations(page);
    appearance = await stableReportAppearance(page);
    await context.close();
  }
  const desktop = await open(source);
  try {
    await check(expected?"all project measurement explanations preserve their original text and calculation parameters":"catalog measurement explanations render for every configured project", async () => {
      const actual = await originalExplanations(desktop.page);
      if (expected) {
        const compact = text => text.replace(/\s/g, "");
        assert.deepEqual(Object.keys(actual), Object.keys(expected));
        for (const id of Object.keys(expected)) assert.equal(compact(actual[id]), compact(expected[id]), id);
      }
    });
    await check(appearance?"operation styling leaves the complete desktop report and sidebar appearance unchanged":"operation classes stay outside report and sidebar roots", async () => {
      if (appearance) assert.deepEqual(await stableReportAppearance(desktop.page), appearance);
      assert.equal(await desktop.page.locator("#reportView.operation-ui,#sidebar.operation-ui").count(), 0);
    });
    await check("catalog explanations use separate rules and exact spacing before parameter chips", async () => {
      await desktop.page.evaluate(() => App.openManagement("metrics"));
      await catalogOpen(desktop.page, "cmj");
      const rules = desktop.page.locator("[data-catalog-measurement] .catalog-selection-rules p");
      assert.equal(await rules.count(), 2);
      const layout = await desktop.page.locator("[data-catalog-measurement]").evaluate(section => {
        const rules = section.querySelector(".catalog-selection-rules"), paragraphs = rules.querySelectorAll("p"), group = section.querySelector(".catalog-parameter-group"), title = group.querySelector("h4"), chips = group.querySelector(".catalog-input-list");
        const box = e => e.getBoundingClientRect();
        return { ruleGap: box(paragraphs[1]).top - box(paragraphs[0]).bottom, parameterGap: box(title).top - box(rules).bottom,
          chipGap: box(chips).top - box(title).bottom, body: getComputedStyle(paragraphs[0]).fontSize,
          note: getComputedStyle(chips.children[0]).fontSize, color: getComputedStyle(paragraphs[0]).color };
      });
      assert.equal(layout.ruleGap, 12); assert.equal(layout.parameterGap, 24); assert.equal(layout.chipGap, 12);
      assert.equal(layout.body, "14px"); assert.equal(layout.note, "13px"); assert.equal(layout.color, "rgb(48, 54, 61)");
      await shot(desktop.page, "catalog-spacing-1440");
    });
  } finally { await desktop.context.close(); }
  for (const [width, height] of [[1440, 1000], [1024, 768], [390, 844]]) {
    const scenes = {
      catalog: async page => { await page.evaluate(() => App.openManagement("metrics")); await catalogOpen(page, "cmj"); },
      plans: async page => { await page.evaluate(() => App.openManagement("plans")); await page.locator('[data-manager-action="plan-new"]').click(); },
      entry: page => page.evaluate(() => App.openEntry("cmj")),
      creation: page => page.evaluate(() => App.startDataEntry()),
      settings: page => page.evaluate(() => App.openSettings("ai")),
      dialog: page => page.evaluate(() => App.openCatalogItem("edit-project", "cmj")),
    };
    for (const [name, setup] of Object.entries(scenes)) {
      const { page, context } = await open(source, width, height);
      try {
        await check(`${name} remains usable at ${width}×${height} with a shared operation type scale`, async () => {
          await setup(page); await fitsPage(page);
          const rootId = { catalog: "managementView", plans: "managementView", entry: "entryView", creation: "creationView", settings: "settingsView", dialog: "catalogModal" }[name];
          const h1 = page.locator(`#${rootId} h1`).first();
          if (await h1.count()) assert.equal(await h1.evaluate(e => getComputedStyle(e).fontSize), "24px");
          const control = page.locator(`#${rootId} .field input:not([type=checkbox]):visible,#${rootId} .field select:visible`).first();
          if (await control.count()) assert.ok(["14px", "16px"].includes(await control.evaluate(e => getComputedStyle(e).fontSize)));
          if(name==="creation"){
            const radio=await page.locator(`#${rootId} input[type="radio"]:visible`).evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return{width:box.width,height:box.height};}));
            assert.ok(radio.length>0&&radio.every(box=>box.width===16&&box.height===16),JSON.stringify(radio));
          }
          await shot(page, `${name}-${width}`);
        });
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(result.errors, []);
})().catch(error => { result.failure = error.stack; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  result.pass=!result.failure&&!result.errors.length&&result.checks.length===21;
  if(!result.pass)process.exitCode=1;
  fs.writeFileSync(path.join(out, channel + "-results.json"), JSON.stringify(result, null, 2));
});
