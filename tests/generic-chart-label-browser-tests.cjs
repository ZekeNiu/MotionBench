"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { createHash } = require("node:crypto"), { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), source = path.join(root, "src/ringside-viz.js"), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const index = process.argv.indexOf("--artifact-dir"), out = index >= 0 ? path.resolve(process.argv[index + 1]) : path.join(root, "output/playwright/v222/generic-labels", channel);
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out, { recursive: true });
const result = { channel, sourceFile: "src/ringside-viz.js", sourceFileSha256: hash(source), runnerSha256: hash(__filename), checks: [], screenshots: [], errors: [], pass: false };
(async () => {
  const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 650, height: 600 } });
  page.on("pageerror", error => result.errors.push(error.message));
  try {
    await page.setContent('<style>body{margin:16px;font-family:Segoe UI,Microsoft YaHei;background:white}.generic-chart-heading{font-size:12px;color:#636b76;margin:0 0 6px}#chart{width:440px}</style><div id="chart"></div>');
    await page.addScriptTag({ path: source });
    for (const count of [3, 4, 5, 6, 7, 8]) for (const width of [230, 290, 440, 560]) for (const print of [false, true]) for (const height of [300, 350]) for (const naming of ["short", "long", "latin"]) {
      const evidence = await page.evaluate(({ count, width, print, height, naming }) => {
        const chart = document.querySelector("#chart"); chart.style.width = width + "px";
        const axes = Array.from({ length: count }, (_, index) => ({ id: "axis" + index, label: naming === "short" ? "指标" + index : naming === "latin" ? "Synthetic X power with a deliberately long label for reading " + index : "力量表现与每一次有效试次中极长指标名称方向和测量说明" + index, value: [25, 100, 13.3, 99.9, 0, 50, 66.6, 80][index], status: "gray" }));
        chart.innerHTML = RingsideViz.generic({ kind: "radar", available: true, panels: [{ title: "评分雷达", unit: "分", axes }] }, { width, height, print });
        const svg = chart.querySelector("svg"), bounds = svg.getBoundingClientRect(), rounded = value => Math.round(value * 1000) / 1000;
        const rect = node => { const r = node.getBoundingClientRect(); return { text: node.textContent, class: node.getAttribute("class"), axis: node.closest("[data-generic-metric]")?.dataset.genericMetric || null, left: rounded(r.left - bounds.left), right: rounded(r.right - bounds.left), top: rounded(r.top - bounds.top), bottom: rounded(r.bottom - bounds.top) }; };
        const ticks = [...svg.querySelectorAll(".generic-radar-tick")].map(rect), labels = [...svg.querySelectorAll(".generic-radar-label,.generic-radar-score")].map(rect);
        const intersect = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
        const tickCollisions = labels.flatMap(label => ticks.filter(tick => intersect(label, tick)).map(tick => ({ label, tick })));
        const labelCollisions = labels.flatMap((label, index) => labels.slice(index + 1).filter(other => intersect(label, other)).map(other => ({ label, other })));
        const overflow = [...svg.querySelectorAll("text")].map(rect).filter(r => r.left < -.75 || r.right > bounds.width + .75 || r.top < -.75 || r.bottom > bounds.height + .75);
        return { count, width, height, print, naming, svg: { width: rounded(bounds.width), height: rounded(bounds.height) }, labels, ticks, tickCollisions, labelCollisions, overflow };
      }, { count, width, print, height, naming });
      result.checks.push(evidence);
      assert.deepEqual(evidence.tickCollisions, [], JSON.stringify({ count, width, height, print, naming, tickCollisions: evidence.tickCollisions }));
      assert.deepEqual(evidence.labelCollisions, [], JSON.stringify({ count, width, height, print, naming, labelCollisions: evidence.labelCollisions }));
      assert.deepEqual(evidence.overflow, [], JSON.stringify({ count, width, height, print, naming, overflow: evidence.overflow }));
      if ([3, 8].includes(count) && [230, 440].includes(width) && height === 300 && naming === "long") {
        const file = path.join(out, `radar-${count}-${width}-${print ? "print" : "screen"}.png`); await page.locator("#chart").screenshot({ path: file }); result.screenshots.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: hash(file) });
      }
    }
    assert.deepEqual(result.errors, []); result.pass = true; console.log("PASS " + result.checks.length + " actual SVG label collision and boundary checks");
  } catch (error) { result.failure = error.stack; console.error(error.stack); await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {}); process.exitCode = 1; }
  finally { result.sourceUnchanged = hash(source) === result.sourceFileSha256; result.pass = result.pass && result.sourceUnchanged; fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2)); await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
