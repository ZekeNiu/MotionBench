"use strict";
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"),
  assert = require("node:assert/strict"), { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"),
  { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), site = path.join(root, "output/public-demo/site"),
  out = path.join(root, "output/playwright/public-demo");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(fs.readFileSync(path.join(site, "demo-build.json")));
const source = fs.readFileSync(path.join(site, "index.html"));
assert.equal(sha(source), manifest.indexSha256);
assert.deepEqual(fs.readdirSync(site).sort(), manifest.files.slice().sort());
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const channel = process.argv.includes("--chromium") ? null : process.argv.includes("--edge") ? "msedge" : "chrome";
const result = { format: "motionbench-public-demo-acceptance-v1", channel: channel || "chromium",
  indexSha256: sha(source), productionHtmlSha256: manifest.productionHtmlSha256,
  runnerSha256: sha(fs.readFileSync(__filename)), checks: [], screenshots: [], network: [], errors: [], pass: false };
let server, browser;
async function check(name, fn) { await fn(); result.checks.push(name); console.log("PASS " + name); }
async function ready(page) { await page.waitForFunction(() => !!window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true); }
function observe(page) {
  page.on("pageerror", error => result.errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push({
    url: request.url(), method: request.method(), type: request.resourceType() }); });
}
function payload(html) {
  const block = html.match(/<script id="embedded-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(block, "Export must contain an embedded report"); return JSON.parse(block[1]);
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  let target = argument("--url");
  if (!target) {
    const files = new Map([["/", "index.html"], ["/index.html", "index.html"], ["/demo-build.json", "demo-build.json"]]);
    server = http.createServer((req, res) => {
      const name = files.get(req.url); if (!name) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", name.endsWith(".html") ? "text/html; charset=utf-8" : "application/json; charset=utf-8");
      res.end(fs.readFileSync(path.join(site, name)));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    target = "http://127.0.0.1:" + server.address().port + "/";
  }
  result.url = target;
  browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true,
    locale: "zh-CN", timezoneId: "Asia/Shanghai" }), page = await context.newPage();
  page.setDefaultTimeout(20000); observe(page);
  try {
    await check("deployed HTML and manifest match the reviewed synthetic artifact", async () => {
      const response = await context.request.get(target); assert.equal(response.status(), 200);
      assert.equal(sha(await response.body()), manifest.indexSha256);
      const remoteManifest = await context.request.get(new URL("demo-build.json", target).href);
      assert.equal(remoteManifest.status(), 200); assert.deepEqual(await remoteManifest.json(), manifest);
    });
    await page.goto(target); await ready(page);
    await check("fresh browser opens exactly one synthetic athlete and test record", async () => {
      const data = await page.evaluate(async () => ({ record: App.getState(), directory: await App.getRepository().directory() }));
      assert.equal(data.record.recordId, "public-demo-record");
      assert.equal(data.record.athlete.name, "演示运动员（模拟数据）"); assert.equal(data.record.demo, true);
      assert.equal(data.directory.athletes.length, 1);
      assert.equal(data.directory.athletes.reduce((count, athlete) => count + athlete.records.length, 0), 1);
      assert.doesNotMatch(JSON.stringify(data), /(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/);
      assert.equal(await page.locator(".public-demo-banner").count(), 1);
      assert.match(await page.locator(".public-demo-banner").innerText(), /初始数据为模拟数据/);
      const runtime = await page.evaluate(() => ({ local: !!window.MotionBenchLocal, native: !!window.MotionBenchNative }));
      assert.deepEqual(runtime, { local: false, native: false });
    });
    await check("demo storage is isolated from the ordinary application namespace", async () => {
      const names = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name));
      assert.equal(names.length, 1); assert.match(names[0], /^public-demo-motionbench-v3:/);
      assert.ok(!names.some(name => name.startsWith("motionbench-v3:")));
    });
    await check("four capability cards and five shared jump labels render at desktop and phone widths", async () => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1080 }); await page.waitForTimeout(300);
        assert.equal(await page.locator(".capability-direction-card").count(), 4);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const jumpLabels = await page.locator('[data-chart-kind="jumpBars"] svg text').allTextContents();
        for (const label of ["CMJ", "SJ", "DJ", "Hop", "CMRJ"]) assert.ok(jumpLabels.includes(label), "Missing jump label " + label);
        const shot = path.join(out, "demo-" + width + ".png"); await page.screenshot({ path: shot });
        result.screenshots.push({ path: path.relative(root, shot).replaceAll("\\", "/"), sha256: sha(fs.readFileSync(shot)), width });
      }
    });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await check("actual JSON and editable HTML exports contain only the synthetic record", async () => {
      for (const [method, name] of [["downloadJSON", "demo-report.json"], ["downloadHTML", "demo-report.html"]]) {
        const wait = page.waitForEvent("download"); await page.evaluate(method => App[method](), method);
        const download = await wait, file = path.join(out, name); await download.saveAs(file);
        const text = fs.readFileSync(file, "utf8"), data = name.endsWith(".html") ? payload(text) : JSON.parse(text);
        assert.equal(data.record.recordId, "public-demo-record"); assert.equal(data.record.athlete.name, "演示运动员（模拟数据）");
        assert.equal(data.record.data.cmj[0].height, 43);
        assert.doesNotMatch(text, /(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/);
      }
      const offline = await browser.newContext({ offline: true }), restored = await offline.newPage(); observe(restored);
      await restored.goto(pathToFileURL(path.join(out, "demo-report.html")).href); await ready(restored);
      assert.equal(await restored.evaluate(() => App.getState().recordId), "public-demo-record");
      assert.equal(await restored.locator(".capability-direction-card").count(), 4); await offline.close();
    });
    await check("actual full JSONL backup contains only the synthetic athlete, record and generated profiles", async () => {
      const wait = page.waitForEvent("download"); await page.evaluate(() => App.downloadLibrary());
      const download = await wait, file = path.join(out, "demo-library.motionbench.jsonl"); await download.saveAs(file);
      const text = fs.readFileSync(file, "utf8"), rows = text.trim().split("\n").map(line => JSON.parse(line));
      assert.equal(rows[0].format, "motionbench-backup"); assert.equal(rows.at(-1).type, "end");
      assert.equal(rows.at(-1).counts.athlete, 1); assert.equal(rows.at(-1).counts.record, 1);
      assert.equal(rows.filter(row => row.type === "athlete")[0].value.name, "演示运动员（模拟数据）");
      assert.equal(rows.filter(row => row.type === "record")[0].value.recordId, "public-demo-record");
      assert.ok(rows.filter(row => row.type === "profile").length >= 1);
      assert.doesNotMatch(text, /(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/);
      result.backupCounts = rows.at(-1).counts;
    });
    await check("real data entry saves and survives reload without a server upload", async () => {
      await page.evaluate(() => App.openEntry("cmj"));
      await page.locator('[data-path="data.cmj.0.height"]').fill("46.5");
      assert.equal(await page.evaluate(() => App.saveNow()), true);
      await page.reload(); await ready(page);
      assert.equal(await page.evaluate(() => Number(App.getState().data.cmj[0].height)), 46.5);
    });
    await check("no background API, tracking, remote script or athlete upload request", async () => {
      const unexpected = result.network.filter(request => request.method !== "GET" || request.type !== "document" ||
        new URL(request.url).origin !== new URL(target).origin);
      assert.deepEqual(unexpected, []); assert.deepEqual(result.errors, []);
    });
    result.pass = true;
  } finally { await context.close(); }
})().catch(error => { result.failure = error.stack; console.error(error.stack); process.exitCode = 1; })
  .finally(async () => {
    fs.writeFileSync(path.join(out, "acceptance-" + (channel || "chromium") + (argument("--url") ? "-published" : "") + ".json"), JSON.stringify(result, null, 2) + "\n");
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  });
