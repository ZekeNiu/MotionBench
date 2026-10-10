"use strict";
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { pathToFileURL } = require('node:url');
const { chromium } = require('./helpers/playwright.cjs');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'MotionBench.html'), out = path.join(root, 'output/playwright');
const result = { sourceHash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), tests: [], errors: [], network: [], images: [] };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true, locale: 'zh-CN' });
  const p = await context.newPage();
  p.on('pageerror', e => result.errors.push(e.message));
  p.on('request', request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
  const check = async (id, run) => {
    try { const detail = await run(); result.tests.push({ id, pass: true, detail }); console.log('PASS ' + id); }
    catch (e) { result.tests.push({ id, pass: false, error: e.stack }); console.log('FAIL ' + id + ': ' + e.message); }
  };
  const capture = async (selector, name) => {
    const image = path.join(out, 'display-' + name + '.png');
    await p.locator(selector).screenshot({ path: image, style: '.topbar{visibility:hidden!important}' });
    result.images.push(path.relative(root, image).replaceAll('\\', '/'));
  };
  try {
    await p.goto(pathToFileURL(file).href);
    await p.waitForFunction(() => window.App?.getState);
    await check('all-speed-subsets', async () => {
      const subsets = [];
      for (let mask = 0; mask < 8; mask++) {
        await p.evaluate(mask => {
          const r = App.getState();
          r.data.mas.speed = mask & 1 ? 5 : '';
          r.data.mss.speed = mask & 2 ? 8 : '';
          Object.assign(r.data.ift, { speed: mask & 4 ? 6 : '', protocol: 'shuttle', partial: 12 });
          App.renderReport();
        }, mask);
        const bars = await p.locator('[data-speed-metric]').evaluateAll(ns => ns.map(n => n.dataset.speedMetric));
        assert.deepEqual(bars, ['mas', 'mss', 'ift'].filter((_, i) => mask & (1 << i)));
        assert.equal(await p.locator('[data-speed-asr]').count(), (mask & 3) === 3 ? 1 : 0);
        assert.equal(await p.locator('.speed-detail').count(), mask ? 1 : 0);
        if (mask & 4) {
          assert.equal(await p.locator('.speed-detail tr[data-metric-id="ift_treadmill"]').count(), 0);
          assert.match(await p.locator('.speed-detail').innerText(), /折返版 · 未完成级 12 秒/);
        }
        if ([1, 4, 5, 7].includes(mask)) await capture('.speed-detail', 'speed-subset-' + mask);
        subsets.push({ mask, bars });
      }
      return subsets;
    });
    await check('speed-zero-negative-asr-and-protocol', async () => {
      await p.evaluate(() => {
        const r = App.getState(); r.data.mss.speed = 5;
        r.data.ift.protocol = 'treadmill'; App.renderReport();
      });
      assert.match(await p.locator('[data-speed-asr]').textContent(), /ASR 0\.00 m\/s/);
      assert.match(await p.locator('.speed-detail').innerText(), /跑台改良版/);
      assert.equal(await p.locator('.speed-detail tr[data-metric-id="ift_shuttle"]').count(), 0);
      await p.evaluate(() => { App.getState().data.mss.speed = 4; App.renderReport(); });
      assert.equal(await p.locator('[data-speed-asr]').count(), 0);
      assert.equal(await p.locator('[data-speed-metric]').count(), 3);
      assert.match(await p.locator('.test-block:has(.speed-detail)').innerText(), /MSS低于MAS/);
    });
    await check('strength-endurance-real-input', async () => {
      const samples = [];
      await p.locator('#editButton').click();
      await p.locator('#entryNav button[onclick*="\'pushup\'"]').click();
      for (const value of [59, 66, 70, 75, 80]) {
        const control = p.locator('[data-path="data.pushup.reps"]');
        await control.fill(String(value)); await control.blur();
        await p.waitForFunction(value => Number(App.getState().data.pushup.reps) === value, value);
        const actual = await p.evaluate(() => {
          const report = RingsideReport.build(App.getState()), metric = report.projects.find(x => x.id === 'pushup').metrics[0];
          const dom = new DOMParser().parseFromString(RingsideReport.render(report), 'text/html');
          return { ...metric.evaluation, label: dom.querySelector('tr[data-metric-id="pushup_reps"] [data-label="评价"]').textContent, target: metric.target };
        });
        const expected = value === 59 ? ['red', '重点关注'] : value === 66 ? ['amber', '关注'] : value === 70 ? ['gray', '未分级'] : ['green', '正常'];
        assert.deepEqual([actual.status, actual.label], expected); assert.equal(actual.target, 80);
        samples.push({ value, ...actual });
      }
      await p.evaluate(() => App.showReport(false));
      await capture('#detail-pushup', 'strength-endurance');
      return samples;
    });
    await check('isometric-dashes-sides-and-pain', async () => {
      const id = await p.evaluate(() => {
        const r = App.getState(), ir = r.data.iso.find(x => x.region === 'shoulder' && x.directionCode === 'internalRotation'), er = r.data.iso.find(x => x.region === 'shoulder' && x.directionCode === 'externalRotation');
        Object.assign(ir, { left: 200, right: '', target: '', painRight: false });
        Object.assign(er, { left: '', right: '', painLeft: false, painRight: false });
        App.renderReport(); return ir.id;
      });
      const row = p.locator('#detail-iso tr[data-row-id="' + id + '"]');
      assert.equal(await row.locator('[data-label="评价"]').innerText(), '-');
      assert.equal(await row.locator('[data-label="关节平衡"]').innerText(), '-');
      await p.evaluate(id => {
        const r = App.getState(); Object.assign(r.data.iso.find(x => x.id === id), { target: 200, painRight: true });
        Object.assign(r.data.iso.find(x => x.region === 'shoulder' && x.directionCode === 'externalRotation'), { left: 100 }); App.renderReport();
      }, id);
      assert.match(await row.locator('[data-label="评价"]').innerText(), /R · 疼痛/);
      assert.match(await row.locator('[data-label="关节平衡"]').innerText(), /L · 2\.00/);
      assert.match(await row.locator('[data-label="关节平衡"]').innerText(), /R · -/);
      assert.equal(await p.locator('[data-balance-id="shoulder_IR_ER"]').count(), 1);
      assert.equal(await p.locator('#detail-iso table').count(), 1);
      await capture('#detail-iso', 'partial-iso');
      await p.evaluate(() => {
        const r = App.getState(); r.data.iso.forEach(x => Object.assign(x, { left: '', right: '', center: '', painLeft: false, painRight: false, painCenter: false })); App.renderReport();
      });
      assert.equal(await p.locator('#detail-iso').count(), 0);
    });
    await check('four-width-chart-and-asymmetry-layouts', async () => {
      await p.evaluate(() => {
        Object.assign(App.getState(), RingsideModel.sampleRecord());
        App.renderReport();
      });
      const layouts = [];
      for (const width of [1440, 1280, 900, 390]) {
        await p.setViewportSize({ width, height: 1000 });
        await p.waitForTimeout(120);
        const bounds = await p.evaluate(() => {
          const outOfChart = [...document.querySelectorAll('.detail-pair svg text')].filter(node => {
            const b = node.getBoundingClientRect(), outer = node.ownerSVGElement.getBoundingClientRect();
            return b.width && (b.left < outer.left - 1 || b.right > outer.right + 1 || b.bottom > outer.bottom + 1);
          }).map(n => n.textContent);
          const fragments = [...document.querySelectorAll('#detail-iso .asym-side')].map(node => {
            const range = document.createRange(); range.selectNodeContents(node);
            const rects = [...range.getClientRects()]; const cell = node.closest('td').getBoundingClientRect();
            return { text: node.textContent, lines: rects.length, width: node.getBoundingClientRect().width, fits: rects.every(r => r.right <= cell.right + 1) };
          });
          return { width: innerWidth, scroll: document.documentElement.scrollWidth, outOfChart, fragments,
            isoColumns: [...document.querySelectorAll('#detail-iso th')].map(n => n.getBoundingClientRect().width),
            charts: [...document.querySelectorAll('.detail-pair svg')].map(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })) };
        });
        assert.equal(bounds.scroll, width); assert.deepEqual(bounds.outOfChart, []);
        assert.ok(bounds.fragments.every(x => x.lines === 1 && x.fits));
        assert.ok(bounds.isoColumns[2] > bounds.isoColumns[3]);
        assert.ok(bounds.charts.every(x => x.height <= 341));
        for (const [selector, label] of [['#detail-iso', 'iso'], ['.test-block:has(.speed-detail)', 'speed']]) await capture(selector, width + '-' + label);
        layouts.push(bounds);
      }
      return layouts;
    });
  } finally {
    await browser.close();
    result.passed = result.tests.filter(x => x.pass).length; result.failed = result.tests.length - result.passed;
    result.pass = result.failed === 0 && result.errors.length === 0 && result.network.length === 0;
    fs.writeFileSync(path.join(out, 'display-verification-results.json'), JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
