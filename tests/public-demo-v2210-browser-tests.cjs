"use strict";
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"),
  assert = require("node:assert/strict"), { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"),
  { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), site = path.join(root, "output/public-demo/site");
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const channel = process.argv.includes("--chromium") ? null : process.argv.includes("--edge") ? "msedge" : "chrome";
const artifactDir = argument("--artifact-dir") || "output/playwright/public-demo-v2210";
assert.ok(artifactDir && !artifactDir.startsWith("--"), "--artifact-dir requires a directory");
const out = path.resolve(root, artifactDir, channel || "chromium"), relativeOut = path.relative(path.join(root, "output"), out);
assert.ok(relativeOut && !relativeOut.startsWith("..") && !path.isAbsolute(relativeOut), "Artifacts must stay in output");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(fs.readFileSync(path.join(site, "demo-build.json")));
const source = fs.readFileSync(path.join(site, "index.html"));
assert.equal(sha(source), manifest.indexSha256);
assert.equal(sha(fs.readFileSync(path.join(root, "MotionBench.html"))), manifest.productionHtmlSha256);
assert.equal(manifest.version, "2.21.0");
assert.deepEqual(fs.readdirSync(site).sort(), manifest.files.slice().sort());
const result = { format: "motionbench-public-demo-acceptance-v2210", channel: channel || "chromium", synthetic: true,
  indexSha256: sha(source), productionHtmlSha256: manifest.productionHtmlSha256,
  seedSha256: manifest.seedSha256, manifestSha256: sha(fs.readFileSync(path.join(site, "demo-build.json"))),
  runnerSha256: sha(fs.readFileSync(__filename)), helperHashes: Object.fromEntries(["tests/helpers/playwright.cjs", "scripts/build_public_demo.cjs"].map(name => [name, sha(fs.readFileSync(path.join(root, name)))])),
  checks: [], screenshots: [], network: [], errors: [], pass: false };
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
    await check("three seeded common projects retain five actual measurements and readable best-selection graphs at desktop tablet and phone widths", async () => {
      const ids = ["preset_handgrip", "preset_cod_505", "preset_standing_long_jump"], expectedValues = {
        preset_handgrip_left_force: 43, preset_handgrip_right_force: 45,
        preset_cod_505_left_time: 2.48, preset_cod_505_right_time: 2.42,
        preset_standing_long_jump_distance: 233,
      };
      const seeded = payload(source.toString("utf8"));
      assert.equal(sha(JSON.stringify(seeded)), manifest.seedSha256);
      const measured = await page.evaluate(ids => {
        const r = App.getState(), stats = App.stats();
        return { recordId: r.recordId, mode: r.mode, projects: r.customTests.filter(t => ids.includes(t.id)),
          definitions: r.definitions.filter(d => ids.includes(d.testId)).map(d => ({ id: d.id, testId: d.testId, unit: d.unit, side: d.side || null, entryScope: d.entryScope })),
          snapshots: r.projectSnapshots.filter(t => ids.includes(t.id)), raw: Object.fromEntries(ids.map(id => [id, r.data[id]])),
          values: Object.fromEntries(r.definitions.filter(d => ids.includes(d.testId)).map(d => [d.id, stats.values[d.id]])),
          groups: stats.repetitions.filter(g => ids.includes(g.testId)).map(g => ({ testId: g.testId, key: g.key, primaryMetricId: g.primaryMetricId, selectedIds: g.selectedIds, representatives: g.representatives })) };
      }, ids);
      assert.equal(measured.recordId, "public-demo-record"); assert.equal(measured.mode, "best");
      assert.deepEqual(measured.projects.map(t => t.id).sort(), ids.slice().sort());
      assert.equal(measured.definitions.length, 5); assert.deepEqual(measured.values, expectedValues);
      assert.deepEqual(measured.raw, Object.fromEntries(ids.map(id => [id, seeded.record.data[id]])));
      assert.ok(measured.definitions.every(d => d.entryScope === "attempt"));
      for (const [id, kind, selection] of [[ids[0], "bars", "independent"], [ids[1], "bars", "independent"], [ids[2], "trials", "trial"]]) {
        const saved = measured.snapshots.find(t => t.id === id);
        assert.equal(saved.visualization.enabled, true); assert.equal(saved.visualization.kind, kind); assert.equal(saved.metricSelection, selection);
        const metrics = measured.definitions.filter(d => d.testId === id);
        for (const metric of metrics) {
          const group = measured.groups.find(g => g.primaryMetricId === metric.id), rows = measured.raw[id];
          const choose = id === ids[1] ? Math.min : Math.max;
          const value = choose(...rows.map(row => row.metrics[metric.id]));
          assert.equal(value, expectedValues[metric.id]); assert.equal(group.representatives[metric.id], value);
          assert.deepEqual(group.selectedIds, [rows.find(row => row.metrics[metric.id] === value).id]);
          assert.equal(metric.unit, id === ids[0] ? "kgf" : id === ids[1] ? "s" : "cm");
        }
        if (id !== ids[2]) {
          assert.deepEqual(metrics.map(d => d.side), ["left", "right"]);
          assert.notEqual(measured.groups.find(g => g.primaryMetricId === metrics[0].id).selectedIds[0], measured.groups.find(g => g.primaryMetricId === metrics[1].id).selectedIds[0]);
        }
      }
      result.commonMeasurements = { commonIds: ids, metricIds: measured.definitions.map(d => d.id), ...measured };
      result.commonLayout = [];
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 1080 }); await page.waitForTimeout(300);
        const layout = await page.evaluate(ids => {
          const rect = n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
            genericChartCount: document.querySelectorAll('[data-chart-kind="genericChart"]').length,
            projects: ids.map(id => {
              const block = document.getElementById("detail-" + id), wrappers = [...block.querySelectorAll('[data-chart-kind="genericChart"]')];
              return { id, block: rect(block), table: rect(block.querySelector('.detail-data table')),
                charts: wrappers.map(wrapper => { const svg = wrapper.querySelector('svg'); return { kind: JSON.parse(wrapper.dataset.chartInput)[0].kind,
                  wrapper: rect(wrapper), svg: rect(svg), labels: [...svg.querySelectorAll('text')].map(n => ({ text: n.textContent, ...rect(n) })),
                  bars: [...svg.querySelectorAll('[data-generic-metric]')].map(n => ({ metricId: n.dataset.genericMetric, value: Number(n.dataset.value), side: n.dataset.side, fill: n.querySelector('rect').getAttribute('fill') })),
                  points: [...svg.querySelectorAll('[data-generic-point]')].map(n => ({ id: n.dataset.genericPoint, value: Number(n.dataset.value), selected: n.dataset.selected === "true", fill: n.querySelector('circle').getAttribute('fill') })) };
                }) };
            }) };
        }, ids);
        assert.equal(layout.width, width); assert.ok(layout.documentWidth <= width + 1); assert.equal(layout.genericChartCount, 3);
        for (const project of layout.projects) {
          assert.ok(project.block.width > 200 && project.block.left >= -1 && project.block.right <= width + 1, project.id);
          assert.ok(project.table.width > 0, "Persistent result table " + project.id); assert.equal(project.charts.length, 1);
          const chart = project.charts[0]; assert.ok(chart.svg.width > 200 && chart.svg.height > 100);
          assert.ok(chart.wrapper.left >= project.block.left - 1 && chart.wrapper.right <= project.block.right + 1);
          assert.ok(chart.svg.left >= -1 && chart.svg.right <= width + 1);
          for (const label of chart.labels) assert.ok(label.left >= chart.svg.left - 1 && label.right <= chart.svg.right + 1 && label.top >= chart.svg.top - 1 && label.bottom <= chart.svg.bottom + 1, project.id + " clipped " + label.text);
          if (project.id !== ids[2]) {
            assert.equal(chart.kind, "bars"); assert.equal(chart.bars.length, 2);
            for (const bar of chart.bars) { assert.equal(bar.value, expectedValues[bar.metricId]); assert.equal(bar.side, measured.definitions.find(d => d.id === bar.metricId).side); }
            assert.notEqual(chart.bars[0].fill, chart.bars[1].fill);
          } else {
            assert.equal(chart.kind, "trials"); assert.deepEqual(chart.points.map(p => p.value), [225, 233, 229]);
            assert.deepEqual(chart.points.map(p => p.selected), [false, true, false]);
            assert.equal(chart.points[0].fill, "white"); assert.equal(chart.points[2].fill, "white"); assert.notEqual(chart.points[1].fill, "white");
          }
          const shot = path.join(out, `demo-common-${width}-${project.id}.png`); await page.locator("#detail-" + project.id).screenshot({ path: shot });
          result.screenshots.push({ path: path.relative(root, shot).replaceAll("\\", "/"), sha256: sha(fs.readFileSync(shot)), bytes: fs.statSync(shot).size, width, testId: project.id, kind: "common-project" });
        }
        result.commonLayout.push(layout);
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
    result.sourceUnchanged = sha(fs.readFileSync(path.join(site, "index.html"))) === result.indexSha256
      && sha(fs.readFileSync(path.join(root, "MotionBench.html"))) === result.productionHtmlSha256
      && sha(fs.readFileSync(path.join(site, "demo-build.json"))) === result.manifestSha256
      && sha(fs.readFileSync(__filename)) === result.runnerSha256
      && Object.entries(result.helperHashes).every(([name, hash]) => sha(fs.readFileSync(path.join(root, name))) === hash);
    result.pass = result.pass && result.sourceUnchanged && result.checks.length === 9 && !result.errors.length;
    if (!result.pass) process.exitCode = 1;
    fs.writeFileSync(path.join(out, "acceptance-" + (channel || "chromium") + (argument("--url") ? "-published" : "") + ".json"), JSON.stringify(result, null, 2) + "\n");
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  });
