"use strict";
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { createHash } = require('node:crypto');
const { chromium } = require('./helpers/playwright.cjs');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'MotionBench.html');
const out = path.join(root, 'output/playwright/fvp-stress');
const channel = process.argv.includes('--edge') ? 'msedge' : 'chrome';
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result = { sourceHash: hash(file), channel, synthetic: true, checks: [], errors: [], network: [], fixtures: [], layouts: [], images: [], pass: false, visualReview: { reviewed: false, pass: false } };
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ offline: true, viewport: { width: 900, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
  page.on('dialog', dialog => dialog.accept());
  const check = async (name, fn) => { await fn(); result.checks.push(name); console.log('PASS ' + name); };
  const panel = () => page.locator('[data-fvp-panel="fvp_sj"]');
  const fixture = async kind => page.evaluate(async kind => {
    const r = RingsideModel.defaults();
    r.recordId = 'fvp-stress-' + kind; r.athleteId = 'fvp-stress-athlete-' + kind;
    r.athlete.name = (kind === 'wide' ? '宽置信带' : '密集负荷点') + '验收（模拟数据）'; r.athlete.mass = 72;
    for (const id of Object.keys(r.enabled)) r.enabled[id] = false;
    r.enabled.fvp_sj = true; r.views.fvpProtocol = 'fvp_sj';
    r.fvpConfig.fvp_sj = { device: '离线图表验收', method: '合成跳跃高度', posture: '统一静止起跳姿势', distanceCm: 33, distanceSource: '固定合成推进距离' };
    if (kind === 'wide') {
      r.data.fvp_sj = [0, 40, 80].map((load, i) => ({ id: 'wide_' + i, load, height: [33, 12, 10][i], excluded: false, notes: '三负荷宽区间样本', exclusionReason: '' }));
    } else {
      // Eighteen DISTINCT loading conditions, generated from one physical
      // loaded-jump profile with a small deterministic observation variation.
      const F0 = 38, V0 = 3.4, d = .33, g = 9.81, slope = -F0 / V0;
      r.data.fvp_sj = Array.from({ length: 18 }, (_, i) => {
        const load = i * 8, k = (72 + load) / 72;
        const v = 2 * (F0 - k * g) / (Math.sqrt(slope * slope + 8 * k / d * (F0 - k * g)) - slope);
        return { id: 'dense_' + i, load, height: 2 * v * v / g * 100 + .08 * Math.sin(i), excluded: false, notes: '独立负荷条件 ' + (i + 1), exclusionReason: '' };
      });
    }
    await App.importPayload(RingsideModel.recordEnvelope(r)); await App.showReport();
    const s = RingsideFVP.solve(App.getState(), 'fvp_sj');
    const intervals = s.points.map(p => s.ci(p.velocity));
    return { kind, valid: s.valid, n: s.fit.n, distinctLoads: new Set(s.points.map(p => p.load)).size, r2: s.fit.r2, df: s.fit.n - 2,
      minBandForce: Math.min(...intervals.map(ci => ci.low)), minBandPower: Math.min(...intervals.map(ci => ci.powerLow)), selectedLoads: s.points.map(p => p.load) };
  }, kind);

  async function geometry(kind, width) {
    const data = await page.evaluate(() => {
      const card = document.querySelector('[data-fvp-panel="fvp_sj"]'), chart = card.querySelector('[data-chart-kind="jumpFvp"]');
      const [graph, options] = JSON.parse(chart.dataset.chartInput), svg = chart.querySelector('svg');
      const rect = svg.querySelector('clipPath rect');
      const left = Number(rect.getAttribute('x')), right = left + Number(rect.getAttribute('width'));
      const min = Math.min(...graph.points.map(p => p.velocity)), max = Math.max(...graph.points.map(p => p.velocity));
      const vMin = options.range === 'measured' ? min : 0;
      const vMax = options.range === 'measured' ? max * 1.015 : Math.max(max, ...graph.profiles.filter(p => p.kind !== 'comparison' || options.comparison).map(p => p.V0)) * 1.04;
      const x = v => left + (v - vMin) / (vMax - vMin) * (right - left);
      const polygonXs = [...svg.querySelectorAll('polygon[fill-opacity=".11"]')].map(p => {
        const coordinates = p.getAttribute('points').trim().split(/[\s,]+/).map(Number);
        return { finite: coordinates.every(Number.isFinite), min: Math.min(...coordinates.filter((_, i) => i % 2 === 0)), max: Math.max(...coordinates.filter((_, i) => i % 2 === 0)) };
      });
      const polylineFinite = [...svg.querySelectorAll('polyline')].every(p => p.getAttribute('points').trim().split(/[\s,]+/).map(Number).every(Number.isFinite));
      return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, cardWidth: card.getBoundingClientRect().width,
        svgWidth: svg.getBoundingClientRect().width, svgHeight: svg.getBoundingClientRect().height, text: svg.textContent,
        nonfiniteMarkup: /NaN|Infinity/.test(svg.outerHTML), polylineFinite, polygonXs,
        pointCount: svg.querySelectorAll('.viz-point[data-fvp-load]').length,
        bandsWithinMeasuredRange: graph.band.every(p => p.x >= min - 1e-12 && p.x <= max + 1e-12),
        expectedBandX: { min: x(min), max: x(max) }, bandRange: { min: Math.min(...graph.band.map(p => p.x)), max: Math.max(...graph.band.map(p => p.x)) },
        measuredRange: { min, max }, range: options.range,
        negativeBandPreserved: graph.band.some(p => p.low < 0 && p.powerLow < 0), negativeAxisLabels: [...svg.querySelectorAll('text')].some(n => /^[-−]\d/.test(n.textContent.trim())) };
    });
    assert.equal(data.width, width); assert.equal(data.overflow, false); assert.ok(data.cardWidth <= width + 1);
    assert.ok(data.svgWidth > 100 && data.svgHeight > 100); assert.equal(data.nonfiniteMarkup, false); assert.equal(data.polylineFinite, true);
    for (const label of ['力 F · N/kg', '功率 P · W/kg', '速度 V · m/s']) assert.ok(data.text.includes(label), label);
    assert.equal(data.polygonXs.length, 2); assert.equal(data.bandsWithinMeasuredRange, true);
    assert.ok(Math.abs(data.bandRange.min - data.measuredRange.min) < 1e-12); assert.ok(Math.abs(data.bandRange.max - data.measuredRange.max) < 1e-12);
    data.polygonXs.forEach(p => { assert.equal(p.finite, true); assert.ok(Math.abs(p.min - data.expectedBandX.min) < .15); assert.ok(Math.abs(p.max - data.expectedBandX.max) < .15); });
    assert.equal(data.pointCount, kind === 'wide' ? 6 : 36);
    if (kind === 'wide') { assert.equal(data.negativeBandPreserved, true); assert.equal(data.negativeAxisLabels, true); }
    result.layouts.push({ fixture: kind, ...data });
  }
  async function shot(kind, width) {
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy') && getComputedStyle(document.querySelector('#toast')).display === 'none');
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(100);
    const p = path.join(out, channel + '-' + kind + '-' + width + '.png');
    const clip = await panel().boundingBox();
    await page.screenshot({ path: p, fullPage: true, clip });
    result.images.push({ path: path.relative(root, p).replaceAll('\\', '/'), sha256: hash(p), fixture: kind, width, reviewed: false, pass: false });
  }
  try {
    await page.goto(pathToFileURL(file).href); await page.waitForFunction(() => !!App.ready);
    for (const kind of ['wide', 'dense']) {
      await page.setViewportSize({ width: 900, height: 1100 });
      await check(kind + ': actual offline import creates the required distinct-load fixture', async () => {
        const meta = await fixture(kind); result.fixtures.push(meta); assert.equal(meta.valid, true);
        assert.equal(meta.n, kind === 'wide' ? 3 : 18); assert.equal(meta.distinctLoads, meta.n);
        if (kind === 'wide') { assert.equal(meta.df, 1); assert.ok(meta.minBandForce < 0 && meta.minBandPower < 0); }
      });
      await check(kind + ': full profile has finite FV/PV curves and mean bands confined to measured support', () => geometry(kind, 900));
      await check(kind + ': measured range keeps both confidence polygons and all independent load points', async () => {
        await panel().locator('[data-fvp-view="range"]').selectOption('measured'); await page.waitForTimeout(140); await geometry(kind, 900);
      });
      const load = kind === 'wide' ? 40 : 128;
      await check(kind + ': hover links the measured load across FV/PV and table', async () => {
        const point = panel().locator('.viz-point[data-fvp-load="' + load + '"]').first(); await point.hover();
        assert.ok(await panel().locator('[data-fvp-load="' + load + '"].is-fvp-highlighted').count() >= 3);
      });
      await check(kind + ': keyboard pin retains the original valid load after 390px resize', async () => {
        const point = panel().locator('.viz-point[data-fvp-load="' + load + '"]').first(); await point.focus(); await point.press('Enter');
        assert.equal(await page.evaluate(() => App.getState().fvpView.fvp_sj.pinnedLoad), load);
        await page.setViewportSize({ width: 390, height: 1100 }); await page.waitForTimeout(180);
        assert.equal(await page.evaluate(() => App.getState().fvpView.fvp_sj.pinnedLoad), load);
        assert.ok(await panel().locator('[data-fvp-load="' + load + '"].is-fvp-pinned').count() >= 3);
        await geometry(kind, 390); await shot(kind, 390);
      });
      await check(kind + ': 900px resize preserves selection and restores coherent full-range axes', async () => {
        await page.setViewportSize({ width: 900, height: 1100 }); await page.waitForTimeout(180);
        assert.ok(await panel().locator('[data-fvp-load="' + load + '"].is-fvp-pinned').count() >= 3);
        await panel().locator('[data-fvp-view="range"]').selectOption('full'); await page.waitForTimeout(140);
        await geometry(kind, 900); await shot(kind, 900);
      });
      await check(kind + ': Escape clears the pin without changing calculations or measurements', async () => {
        const before = await page.evaluate(() => App.recordBasis());
        await panel().locator('.viz-point[data-fvp-load="' + load + '"]').first().focus(); await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => App.getState().fvpView.fvp_sj.pinnedLoad), null);
        assert.equal(await page.evaluate(() => App.recordBasis()), before);
      });
    }
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []); result.pass = true;
  } catch (error) {
    result.failure = error.stack; console.error(error.stack); process.exitCode = 1;
    const p = path.join(out, channel + '-failure.png'); await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    if (fs.existsSync(p)) result.images.push({ path: path.relative(root, p).replaceAll('\\', '/'), sha256: hash(p), reviewed: false, pass: false });
  } finally {
    result.sourceUnchanged = hash(file) === result.sourceHash;
    if (!result.sourceUnchanged) { result.pass = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(out, channel + '-results.json'), JSON.stringify(result, null, 2));
    await context.close(); await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
