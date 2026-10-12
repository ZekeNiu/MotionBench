"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const source = path.resolve(root, arg("--source", "MotionBench.html")), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.resolve(root, arg("--artifact-dir", "output/playwright/v2191-layout")), hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const isoEnvelope = JSON.parse(fs.readFileSync(path.join(root, "examples/three-trials.json"))), isoFixture = isoEnvelope.record || isoEnvelope;
fs.mkdirSync(out, { recursive: true });
const result = { synthetic: true, channel, sourceSha256: hash(source), runnerSha256: hash(__filename), checks: [], artifacts: [], layouts: [], errors: [], network: [], pdfs: [] };
const artifact = (file, kind) => result.artifacts.push({ path: path.relative(root, file).replaceAll("\\", "/"), sha256: hash(file), kind });
(async () => {
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ offline: true, acceptDownloads: true, reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => result.errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
  page.on("dialog", dialog => dialog.accept());
  const check = async (name, run) => { await run(); result.checks.push(name); console.log("PASS " + name); };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const load = async (count, full = false, unavailable = false) => {
    await page.evaluate(async ({ count, full, unavailable }) => {
      if (!await App.saveNow()) throw Error("Synthetic fixture setup could not save the previous record");
      const r = RingsideModel.sampleRecord(), groups = [["cmj", "sj"], ["dj"], ["mas", "mss"], ["cpet"]], enabled = new Set(groups.slice(0, count).flat());
      r.demo = false; r.athlete.name = "报告布局模拟验收"; r.views.capabilitySelections = { strength: unavailable ? "fvp" : "eur", reactive: "dj_rsi", speed: "srr" };
      r.views.capabilityExpanded = { strength: false, reactive: false, speed: false, endurance: false };
      if (!full) for (const id of Object.keys(r.enabled)) r.enabled[id] = enabled.has(id);
      await App.importPayload(RingsideModel.recordEnvelope(r), "replace-library"); await App.showReport(false);
    }, { count, full, unavailable }); await settle();
  };
  const layout = () => page.evaluate(() => {
    const grid = document.querySelector(".capability-direction-grid"), rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { viewport: innerWidth, grid: grid && { count: grid.dataset.capabilityCount, ...rect(grid), columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length }, cards: [...document.querySelectorAll(".capability-direction-card")].map(node => ({ id: node.dataset.capabilityDirection, ...rect(node), summary: rect(node.querySelector(".capability-card-summary")), fonts: Object.fromEntries(["h3", ".capability-direction-judgment", ".capability-direction-value", ".capability-direction-basis", ".capability-direction-value small"].map(selector => [selector, node.querySelector(selector) ? getComputedStyle(node.querySelector(selector)).fontSize : null])) })), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  const shot = async (name, selector) => { if (selector) await page.locator(selector).first().scrollIntoViewIfNeeded(); await page.waitForFunction(() => !document.querySelector('#toast') || getComputedStyle(document.querySelector('#toast')).display === 'none'); const file = path.join(out, `${channel}-${name}.png`); await page.screenshot({ path: file }); artifact(file, "screenshot"); };
  try {
    await page.goto(pathToFileURL(source).href); await page.waitForFunction(() => !!window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true);
    assert.equal(await page.evaluate(() => RingsideBuild.version), "2.19.1");
    await check("zero through four data-bearing cards use the approved desktop layouts and compact type scale", async () => {
      for (let count = 0; count <= 4; count++) {
        await load(count); const item = await layout(); result.layouts.push(item); assert.equal(item.cards.length, count); assert.equal(item.overflow, false);
        if (!count) { assert.equal(item.grid, null); assert.equal(await page.locator("[data-capability-region]").count(), 0); continue; }
        assert.equal(item.grid.columns, count === 3 ? 3 : count === 1 ? 1 : 2);
        assert.equal(item.grid.count, String(count));
        for (const card of item.cards) { assert.equal(card.fonts.h3, "14px"); assert.equal(card.fonts[".capability-direction-judgment"], "15px"); assert.equal(card.fonts[".capability-direction-value"], "22px"); assert.equal(card.fonts[".capability-direction-basis"], "12px"); }
        if (count === 1) { assert.ok(Math.abs(item.cards[0].width - item.grid.width) < 1); assert.ok(item.cards[0].height < 220, "single card must be a short horizontal summary"); }
        else assert.ok(Math.max(...item.cards.map(c => c.height)) - Math.min(...item.cards.map(c => c.height)) < 1.1, "collapsed cards have equal heights");
        await shot(`cards-${count}-1440`, ".capability-direction-grid");
      }
    });
    await check("three cards follow container widths on narrow screens without page overflow", async () => {
      await load(3);
      for (const width of [900, 390]) { await page.setViewportSize({ width, height: 1000 }); await settle(); const item = await layout(); result.layouts.push(item); assert.equal(item.grid.columns, item.grid.width >= 820 ? 3 : item.grid.width >= 520 ? 2 : 1); assert.equal(item.overflow, false); await shot(`cards-3-${width}`, ".capability-direction-grid"); }
      await page.setViewportSize({ width: 1440, height: 1000 }); await settle();
    });
    await check("expanding one parameter card does not stretch neighbors and persists after refresh", async () => {
      await load(4); const before = await layout();
      await page.locator('[data-capability-parameters="strength"] > summary').click(); await settle(); const expanded = await layout();
      assert.ok(expanded.cards[0].height > before.cards[0].height + 40);
      for (const card of expanded.cards.slice(1)) assert.ok(Math.abs(card.height - before.cards.find(c => c.id === card.id).height) < 1.1, card.id);
      assert.equal(await page.evaluate(() => App.saveNow()), true); await page.reload(); await page.waitForFunction(() => !!window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true); await settle();
      assert.equal(await page.locator('[data-capability-parameters="strength"]').evaluate(node => node.open), true);
      await page.locator('[data-capability-parameters="strength"] > summary').click(); await settle();
      const closed = await layout(); assert.ok(Math.max(...closed.cards.map(c => c.height)) - Math.min(...closed.cards.map(c => c.height)) < 1.1);
      await shot("cards-expanded", ".capability-direction-grid");
    });
    await check("an explicit unavailable selected basis retains valid group parameters", async () => {
      await load(1, false, true); assert.equal(await page.locator('.capability-direction-card').count(), 1);
      assert.equal(await page.locator('[data-direction-metric="fvp"]').count(), 1); assert.match(await page.locator('.capability-direction-judgment').innerText(), /待计算/);
      await page.locator('[data-capability-parameters="strength"] > summary').click(); assert.equal(await page.locator('[data-capability-metric="eur"]').count(), 1);
    });
    await check("live card updates track category additions removals and preserve existing disclosure nodes", async () => {
      await load(4);
      const updates = await page.evaluate(() => {
        const container = document.querySelector('#detailContent'), previous = container.querySelector('[data-capability-parameters="strength"]'), record = structuredClone(App.getState());
        const states = [];
        for (const ids of [['cmj', 'sj'], ['cmj', 'sj', 'dj', 'mas', 'mss'], [], ['cmj', 'sj']]) {
          for (const id of Object.keys(record.enabled)) record.enabled[id] = ids.includes(id);
          const patched = RingsideReport.patchCapabilityAnalysis(container, RingsideReport.build(record)), grid = container.querySelector('.capability-direction-grid');
          states.push({ patched, count: grid?.children.length || 0, countAttribute: grid?.dataset.capabilityCount || null, preserved: grid?.children.length ? container.querySelector('[data-capability-parameters="strength"]') === previous : null });
        }
        return states;
      });
      assert.deepEqual(updates.map(n => n.count), [1, 3, 0, 1]); assert.ok(updates.every(n => n.patched)); assert.equal(updates[0].preserved, true); assert.equal(updates[1].preserved, true);
      assert.deepEqual(updates.map(n => n.countAttribute), ['1', '3', null, '1']);
    });
    await check("ability bands and action cards preserve title hierarchy and chart-left table-right pairs", async () => {
      await load(4, true);
      const evidence = await page.evaluate(() => ({ bands: [...document.querySelectorAll('.quality-heading')].map(n => ({ border: getComputedStyle(n).borderLeftWidth, background: getComputedStyle(n).backgroundColor, size: getComputedStyle(n.querySelector('h3')).fontSize })), actions: [...document.querySelectorAll('.test-title')].map(n => ({ title: n.querySelector('h4')?.textContent, size: n.querySelector('h4') && getComputedStyle(n.querySelector('h4')).fontSize, h3: !!n.querySelector('h3') })), jump: (() => { const p = document.querySelector('.jump-detail'), chart = p.querySelector('.chart-wrap').getBoundingClientRect(), data = p.querySelector('.detail-data').getBoundingClientRect(); return { chart: chart.x, data: data.x, charts: p.querySelectorAll('[data-chart-kind="jumpBars"]').length }; })() }));
      assert.ok(evidence.bands.length); assert.ok(evidence.bands.every(n => n.border === "0px" && n.size === "16px"));
      assert.ok(evidence.actions.every(n => n.title && !n.h3 && n.size === "15px")); assert.equal(evidence.jump.charts, 1); assert.ok(evidence.jump.chart < evidence.jump.data);
      await shot("ability-actions", "#performanceDetail");
    });
    await check("summary body and overview colors equal actual evaluation text while badge tint remains separate", async () => {
      const colors = await page.evaluate(() => {
        const reference = [...document.querySelectorAll('td[data-label="评价"] .pill.amber')].find(n => n.textContent.includes('关注')), ink = getComputedStyle(reference).color;
        const body = [...document.querySelectorAll('.viz-region')].find(n => JSON.parse(n.dataset.bodyDetail).status === 'amber').querySelector('.viz-hotspot');
        const overview = [...document.querySelectorAll('.card')].find(n => n.querySelector('h3')?.textContent === '运动表现概览');
        return { ink, tint: getComputedStyle(reference).backgroundColor, dot: getComputedStyle(reference.querySelector('.dot')).backgroundColor, quick: getComputedStyle(document.querySelector('.micro-value.amber')).color, body: getComputedStyle(body).fill, bodyOpacity: getComputedStyle(body).opacity, overview: [...overview.querySelectorAll('[fill],.amber')].filter(n => getComputedStyle(n).fill === ink || n.classList.contains('amber')).map(n => n.classList.contains('amber') ? getComputedStyle(n).color : getComputedStyle(n).fill), gray: getComputedStyle(document.querySelector('td[data-label="评价"] .pill.gray')).color, vizGray: RingsideViz.C.gray };
      });
      assert.equal(colors.quick, colors.ink); assert.equal(colors.body, colors.ink); assert.equal(colors.dot, colors.ink); assert.equal(colors.bodyOpacity, "1");
      assert.ok(colors.overview.length); assert.ok(colors.overview.every(value => value === colors.ink)); assert.equal(colors.tint, "rgb(250, 244, 233)"); assert.equal(colors.vizGray, "#66707b"); assert.equal(colors.gray, "rgb(102, 112, 123)");
      result.colors = colors;
    });
    await check("five jump labels remain distinct across the former breakpoint and retain full accessible names", async () => {
      const geometries = await page.evaluate(() => {
        const names = { cmj: 'CMJ 完整名称', sj: 'SJ 完整名称', dj: 'DJ 下落跳', hop: '10/5 Hop Test 连续反应跳', cmrj: 'CMRJ 反向反弹跳' }, host = document.createElement('div'); document.body.append(host);
        const results = [240, 320, 479, 480, 487, 600, 740].map(width => {
          host.innerHTML = RingsideViz.jumpBars(Object.entries(names).map(([id, label]) => ({ id, label, value: 35, rsi: 1.8 })), { width });
          const labels = [...host.querySelectorAll('[data-jump-label]')].map(n => { const b = n.querySelector('text').getBBox(); return { id: n.dataset.jumpLabel, short: n.textContent, full: n.getAttribute('aria-label'), x: b.x, right: b.x + b.width }; });
          return { width, labels, overlap: labels.slice(1).some((n, i) => labels[i].right > n.x + .1) };
        }); host.remove(); return results;
      });
      for (const item of geometries) { assert.equal(item.overlap, false, String(item.width)); assert.deepEqual(item.labels.map(n => n.short), ['CMJ', 'SJ', 'DJ', 'Hop', 'CMRJ']); assert.ok(item.labels.find(n => n.id === 'hop').full.includes('10/5')); }
      result.jumpGeometries = geometries;
    });
    await check("long action names and RSI-only Hop remain readable at 1920 with sidebar changes and simulated 125 percent zoom", async () => {
      await page.evaluate(async () => {
        if (!await App.saveNow()) throw Error('Could not save the preceding synthetic case');
        const r = RingsideModel.sampleRecord(), hop = RingsideModel.newHopSet(); r.demo = false; r.athlete.name = '长名称及部分测量模拟验收';
        hop.summary.rsi = 2.15; r.data.hop = { ...hop, trials: [hop] };
        r.projectSnapshots = RingsideTests.snapshots(r).map(test => ['dj', 'pushup'].includes(test.id) ? { ...test, name: '教练完整动作名称：不同训练阶段与测试条件的展示名称应完整换行并保留原始项目身份_' + test.id } : test);
        await App.importPayload(RingsideModel.recordEnvelope(r), 'replace-library'); await App.showReport(false);
      });
      await page.setViewportSize({ width: 1920, height: 1000 });
      for (const mode of [{ sidebar: true, zoom: 1 }, { sidebar: false, zoom: 1 }, { sidebar: false, zoom: 1.25 }]) {
        await page.evaluate(mode => { App.toggleSidebar(mode.sidebar); document.documentElement.style.zoom = String(mode.zoom); RingsideReport.layoutCharts(document.querySelector('#detailContent')); }, mode); await settle();
        const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, labels: [...document.querySelectorAll('.jump-detail [data-jump-label]')].map(n => ({ id: n.dataset.jumpLabel, text: n.textContent })), hopHeight: document.querySelectorAll('.jump-detail [data-jump-test="hop"][data-jump-series="height"]').length, hopRsi: document.querySelectorAll('.jump-detail [data-jump-test="hop"][data-jump-series="rsi"]').length, longName: document.querySelector('#detail-pushup .test-title h4')?.textContent }));
        assert.equal(geometry.overflow, false); assert.equal(geometry.hopHeight, 0); assert.equal(geometry.hopRsi, 1); assert.ok(geometry.longName.includes('完整动作名称'));
        assert.deepEqual(geometry.labels.map(n => n.text), ['CMJ', 'SJ', 'DJ', 'Hop', 'CMRJ']); result.layouts.push({ ...mode, ...geometry });
      }
      await shot('long-names-1920', '#detail-pushup');
      await page.evaluate(() => { document.documentElement.style.zoom = ''; App.toggleSidebar(true); }); await page.setViewportSize({ width: 1440, height: 1000 }); await settle();
    });
    await check("isometric repeated results remain chart-left table-right at 1280 and stack at 900 and 390 without lost values", async () => {
      await page.evaluate(async fixture => {
        if (!await App.saveNow()) throw Error('Could not save the preceding synthetic case');
        const r = structuredClone(fixture); r.demo = false; r.athlete.name = '等长力量三次测量布局模拟验收';
        for (const id of Object.keys(r.enabled)) r.enabled[id] = id === 'iso';
        await App.importPayload(RingsideModel.recordEnvelope(r), 'replace-library'); await App.showReport(false);
      }, isoFixture);
      let referenceRows;
      for (const width of [1280, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await settle();
        await page.evaluate(() => RingsideReport.layoutCharts(document.querySelector('#detailContent'))); await settle();
        const geometry = await page.evaluate(() => {
          const section = document.querySelector('#detail-iso'), pair = section.querySelector('.detail-pair'), chart = pair.querySelector('.chart-wrap'), table = pair.querySelector('.iso-results'), wrap = table.parentElement;
          const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const svg = chart.querySelector('svg'), vb = svg.viewBox.baseVal;
          const labelsOutside = [...svg.querySelectorAll('text')].filter(n => { const b = n.getBBox(); return b.x < -.5 || b.y < -.5 || b.x + b.width > vb.width + .5 || b.y + b.height > vb.height + .5; }).map(n => n.textContent);
          const brokenNumbers = [], misalignedSides = [], walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const n = walker.currentNode; if (!n.parentElement.getClientRects().length) continue;
            for (const match of n.textContent.matchAll(/\d[\d,.]*%?/g)) {
              const range = document.createRange(); range.setStart(n, match.index); range.setEnd(n, match.index + match[0].length);
              if (range.getClientRects().length > 1) brokenNumbers.push(match[0]);
            }
          }
          if (getComputedStyle(table).display === 'table') for (const row of table.tBodies[0].rows) {
            const cells = [...row.cells].map(cell => [...cell.querySelectorAll('.stat-side')]);
            for (let side = 0; side < 2; side++) { const tops = cells.map(c => c[side]?.getBoundingClientRect().top).filter(n => n !== undefined); if (tops.length && Math.max(...tops) - Math.min(...tops) > 1) misalignedSides.push(row.dataset.rowId + ':' + side); }
          }
          return { viewport: innerWidth, pair: rect(pair), chart: rect(chart), table: rect(table), wrap: rect(wrap),
            rows: [...table.tBodies[0].rows].map(n => ({ id: n.dataset.rowId, text: n.innerText.replace(/\s+/g, ' ').trim() })), headers: table.tHead.rows[0].cells.length, statistics: table.querySelectorAll('[data-repeat-stat]').length,
            pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, localScroll: wrap.scrollWidth > wrap.clientWidth + 1, labelsOutside, brokenNumbers, misalignedSides };
        });
        assert.equal(geometry.rows.length, 13); assert.equal(geometry.headers, 7); assert.equal(geometry.statistics, 24);
        assert.equal(geometry.pageOverflow, false); assert.equal(geometry.localScroll, false); assert.deepEqual(geometry.labelsOutside, []); assert.deepEqual(geometry.brokenNumbers, []); assert.deepEqual(geometry.misalignedSides, []);
        if (width === 1280) { assert.ok(geometry.chart.x + geometry.chart.width <= geometry.wrap.x + 1); assert.ok(Math.abs(geometry.chart.y - geometry.wrap.y) < 1); referenceRows = geometry.rows; }
        else { assert.ok(geometry.wrap.y >= geometry.chart.y + geometry.chart.height); assert.deepEqual(geometry.rows, referenceRows); }
        result.layouts.push({ scenario: 'isometric-three-trials', ...geometry });
        await page.waitForFunction(() => !document.querySelector('#toast') || getComputedStyle(document.querySelector('#toast')).display === 'none');
        const file = path.join(out, `${channel}-isometric-${width}.png`); await page.locator('#detail-iso').screenshot({ path: file }); artifact(file, 'screenshot');
      }
      await page.setViewportSize({ width: 1440, height: 1000 }); await settle();
    });
    if (process.argv.includes("--pdf")) await check("actual PDFs preserve card counts action titles and exact rows with open and closed parameters", async () => {
      for (const expanded of [false, true]) {
        await load(expanded ? 4 : 3, expanded);
        if (expanded) for (const key of ['strength', 'reactive', 'speed', 'endurance']) await page.locator(`[data-capability-parameters="${key}"] > summary`).click();
        await page.evaluate(() => { window.__layoutPages = []; window.__layoutCanvas = window.html2canvas; window.html2canvas = async (node, options) => { __layoutPages.push({ text: node.innerText, counts: [...node.querySelectorAll('[data-capability-count]')].map(n => Number(n.dataset.capabilityCount)), stripes: [...node.querySelectorAll('.quality-heading,.pdf-group-heading')].map(n => getComputedStyle(n).borderLeftWidth), titles: [...node.querySelectorAll('.test-title h4')].map(n => ({ text: n.textContent, size: getComputedStyle(n).fontSize })), expandedSummaries: [...node.querySelectorAll('.capability-direction-print-summary')].map(n => { const id = n.querySelector('[data-report-patch]')?.dataset.reportPatch.replace('summary-', ''); return { id, followingRows: node.querySelector(`table[data-capability-parameter-table="${id}"]`)?.querySelectorAll('tbody > tr').length || 0 }; }) }); return __layoutCanvas(node, options); }; });
        const pending = page.waitForEvent('download', { timeout: 240000 }); await page.evaluate(() => App.downloadPDF()); const download = await pending; assert.equal(await download.failure(), null);
        const file = path.join(out, `${channel}-${expanded ? 'open' : 'closed'}-parameters.pdf`); await download.saveAs(file); artifact(file, 'pdf');
        const evidence = await page.evaluate(() => ({ diagnostics: RingsidePDF.lastDiagnostics, pages: __layoutPages }));
        assert.equal(evidence.diagnostics.status, 'complete'); for (const key of ['missingRows', 'duplicateRows', 'changedRows', 'missingCharts', 'duplicateCharts']) assert.deepEqual(evidence.diagnostics[key], []);
        assert.ok(evidence.pages.every(p => p.stripes.every(value => value === '0px'))); assert.ok(evidence.pages.flatMap(p => p.titles).every(n => n.size === '15px'));
        if (expanded) { const summaries = evidence.pages.flatMap(p => p.expandedSummaries); assert.equal(summaries.length, 4); assert.ok(summaries.every(n => n.followingRows > 0), "expanded summaries stay with their parameter table's first row"); }
        if (!expanded) assert.ok(evidence.pages.flatMap(p => p.counts).includes(3));
        result.pdfs.push({ expanded, file: path.relative(root, file).replaceAll('\\', '/'), sha256: hash(file), ...evidence }); await page.evaluate(() => window.html2canvas = __layoutCanvas);
      }
    });
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []);
  } catch (error) { result.failure = error.stack; console.error(error.stack); await shot("failure").catch(() => {}); }
  finally { result.sourceUnchanged = hash(source) === result.sourceSha256; result.pass = !result.failure && result.sourceUnchanged && !result.errors.length && !result.network.length; fs.writeFileSync(path.join(out, `${channel}.json`), JSON.stringify(result, null, 2)); await context.close(); await browser.close(); if (!result.pass) process.exitCode = 1; }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
