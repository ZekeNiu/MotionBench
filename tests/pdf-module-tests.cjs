'use strict';

// Exercise semantic pagination, error cleanup and the real application button.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'output', 'pdf');
const { chromium } = require('./helpers/playwright.cjs');

async function inject(page, filename) {
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, filename), 'utf8') });
}

async function captureBuild(page, selector, snapshot) {
  return page.evaluate(async ({ selector, snapshot }) => {
    const actual = window.html2canvas;
    const pages = [], events = [];
    window.html2canvas = async (node, options) => {
      const body = node.querySelector('.ringside-pdf-content');
      const children = [...body.children];
      pages.push({
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        children: children.length,
        lastClass: children.at(-1)?.className || '',
        overflow: children.filter(child => child.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + .5).map(child => child.outerHTML.slice(0, 150)),
        controls: node.querySelectorAll('button,input,select,textarea,[contenteditable],.no-print').length,
        images: node.querySelectorAll('img[data-pdf-chart]').length,
        reducedCharts: [...node.querySelectorAll('img[data-pdf-original-height]')].map(image => ({ height: image.getBoundingClientRect().height, originalHeight: Number(image.dataset.pdfOriginalHeight) })),
        rawSVG: node.querySelectorAll('svg').length,
        headerText: node.querySelector('.ringside-pdf-page-head').textContent,
        rowIds: [...node.querySelectorAll('tbody>tr')].map(row => row.firstElementChild?.textContent).filter(text => /^ROW_\d{3}$/.test(text)),
        tableHeads: [...node.querySelectorAll('thead')].map(head => head.textContent),
        longText: [...node.querySelectorAll('[data-test-long]')].map(paragraph => paragraph.textContent).join(''),
        longList: [...node.querySelectorAll('[data-test-list]')].map(list => list.textContent).join(''),
        forbiddenMarker: node.textContent.includes('DO_NOT_EXPORT')
      });
      return actual(node, options);
    };
    try {
      const blob = await RingsidePDF.build(snapshot, document.querySelector(selector), { onProgress: event => events.push(event) });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let encoded = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      return { base64: btoa(encoded), bytes: blob.size, type: blob.type, pages, events, diagnostics: RingsidePDF.lastDiagnostics, leakedStages: document.querySelectorAll('.ringside-pdf-stage').length };
    } finally { window.html2canvas = actual; }
  }, { selector, snapshot });
}

function verifyPages(result) {
  assert.ok(result.pages.length > 0);
  assert.equal(result.leakedStages, 0, 'temporary export DOM must be removed');
  assert.equal(result.type, 'application/pdf');
  assert.equal(Buffer.from(result.base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  for (const page of result.pages) {
    assert.ok(Math.abs(page.width - 210 * 96 / 25.4) < 1);
    assert.ok(Math.abs(page.height - 297 * 96 / 25.4) < 1);
    assert.equal(page.controls, 0);
    assert.equal(page.rawSVG, 0);
    assert.equal(page.forbiddenMarker, false);
    assert.ok(page.reducedCharts.every(chart => chart.height >= chart.originalHeight * .85 - .1), 'group fitting must preserve chart readability within a 15% size adjustment');
    assert.deepEqual(page.overflow, [], 'visible blocks must stay within page body');
  }
  assert.equal(result.events.at(-1).phase, 'complete');
  assert.equal(result.events.at(-1).percent, 100);
  assert.equal(result.diagnostics.status, 'complete');
  assert.equal(result.diagnostics.pageCount, result.pages.length);
  assert.equal(result.diagnostics.rowCount, result.diagnostics.renderedRowCount);
  for (const key of ['missingRows', 'duplicateRows', 'changedRows', 'missingCharts', 'duplicateCharts']) assert.deepEqual(result.diagnostics[key], []);
  assert.ok(result.diagnostics.textChecks.every(check => check.exact || check.keepWithNext && check.renderedCharacters === 0));
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const sourceHash = createHash('sha256').update(fs.readFileSync(path.join(root, 'Ringside_Boxing_Assessment.html'))).digest('hex');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'versions.json'), 'utf8'));
  for (const dependency of manifest.dependencies) {
    for (const [filename, expected] of [[dependency.file, dependency.sha256], [dependency.license_file, dependency.license_sha256]]) {
      const actual = createHash('sha256').update(fs.readFileSync(path.join(root, 'vendor', filename))).digest('hex');
      assert.equal(actual, expected, filename + ' integrity');
    }
  }
  console.log('PASS pinned offline dependency hashes');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], requests = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
    await page.goto(pathToFileURL(path.join(root, 'Ringside_Boxing_Assessment.html')).href);
    await page.waitForFunction(() => !!window.App?.ready);
    assert.equal(await page.evaluate(() => App.ready), true, 'application initialization must complete');
    for (const filename of ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js', 'src/ringside-pdf.js']) await inject(page, filename);

    // Opening export details must not trigger the live application's toggle
    // listener and overwrite the user's intentionally collapsed section.
    await page.evaluate(() => { const group = document.querySelector('#reportView .details-group,main.wrap .details-group'); if (group) group.open = false; });
    await page.waitForTimeout(50);
    const before = await page.evaluate(() => ({ state: JSON.stringify(App.getState()), details: [...document.querySelectorAll('main details')].map(node => node.open) }));
    const grouping = await page.evaluate(() => {
      const report = document.querySelector('#reportView,main.wrap');
      const tables = [...report.querySelectorAll('table')], charts = [...report.querySelectorAll('svg')];
      return { fmsTable: tables.indexOf(report.querySelector('#detail-fms table')), pushupTable: tables.indexOf(report.querySelector('#detail-pushup table')), pushupChart: charts.indexOf(report.querySelector('#detail-pushup svg')), imtpChart: charts.indexOf(report.querySelector('#detail-imtp svg')) };
    });
    const snapshot = await page.evaluate(() => App.getState());
    const sample = await captureBuild(page, '#reportView,main.wrap', snapshot);
    verifyPages(sample);
    assert.ok(sample.pages.reduce((sum, item) => sum + item.images, 0) > 5, 'sample charts must survive export');
    if (grouping.fmsTable >= 0) {
      const pages = sample.diagnostics.pages.filter(item => item.tableIndices.includes(grouping.fmsTable));
      assert.equal(pages.length, 1, 'the seven FMS results must stay together rather than split six plus one');
    }
    if (grouping.pushupTable >= 0 && grouping.pushupChart >= 0) {
      const resultPage = sample.diagnostics.pages.find(item => item.tableIndices.includes(grouping.pushupTable));
      assert.ok(resultPage.charts.includes(grouping.pushupChart), 'the one-row pushup result must stay with its chart');
      if (grouping.imtpChart >= 0) assert.ok(resultPage.charts.includes(grouping.imtpChart), 'the short pushup test should fill the remaining space after IMTP instead of occupying a mostly empty page');
    }
    const after = await page.evaluate(() => ({ state: JSON.stringify(App.getState()), details: [...document.querySelectorAll('main details')].map(node => node.open) }));
    assert.deepEqual(after, before, 'PDF module must not mutate report state or fold state');
    fs.writeFileSync(path.join(artifacts, 'module-sample.pdf'), Buffer.from(sample.base64, 'base64'));
    console.log(`PASS real offline sample PDF: ${sample.pages.length} pages, ${sample.bytes} bytes`);

    {
      // The sidebar backup action opens library management. Exercise the
      // current report export menu, rather than the hidden legacy save modal.
      const button = page.locator('#reportExportMenu [data-pdf-action]');
      assert.equal(await button.count(), 1, 'the current report must expose its PDF action');
      await page.locator('#reportExportMenu > summary').click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120000 }),
        button.click(),
      ]);
      const destination = path.join(artifacts, 'module-button-sample.pdf');
      await download.saveAs(destination);
      assert.equal(fs.readFileSync(destination).subarray(0, 5).toString(), '%PDF-');
      assert.match(download.suggestedFilename(), /\.pdf$/i);
      await page.waitForFunction(() => !document.querySelector('#reportExportMenu [data-pdf-action]').disabled);
      assert.equal(await page.evaluate(() => RingsidePDF.lastDiagnostics.status), 'complete');
      console.log('PASS real application PDF button downloads an offline PDF file');
    }

    const expected = await page.evaluate(() => {
      const fixture = document.createElement('main'); fixture.id = 'pdfStressFixture';
      const longText = Array.from({ length: 100 }, (_, index) => `段${String(index).padStart(3, '0')}：力量测试显示起始阶段的发力能力需要结合动作质量和训练负荷评估，保持项目记录中的原始数值，不混淆实测结果与推断。`).join('');
      const longList = Array.from({ length: 52 }, (_, index) => `建议${String(index).padStart(3, '0')}：在技术课中观察疲劳后的动作稳定性，依据当前测试记录调整训练内容，保留完整中文文本。`).join('');
      const rows = Array.from({ length: 130 }, (_, index) => `<tr><td>ROW_${String(index).padStart(3, '0')}</td><td>左侧 ${index} N；右侧 ${index + 10} N。数据必须完整保留。</td></tr>`).join('');
      fixture.innerHTML = `<div class="hero"><h1>PDF 分页压力验证</h1></div><div class="no-print">DO_NOT_EXPORT</div><section><div class="section-heading"><div class="section-title"><span class="section-number">02</span><div><h2>逐行续页表格</h2></div></div></div><div class="chart-wrap"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 180"><title>隐藏报告图表</title><line x1="30" y1="140" x2="580" y2="140" stroke="#8390a2"/><text x="30" y="60" font-size="18">隐藏报告依然使用真实 viewBox 绘图</text><circle cx="150" cy="120" r="8" fill="#bb4248"/></svg></div><table><thead><tr><th>编号</th><th>完整测试结果</th></tr></thead><tbody>${rows}</tbody></table></section><section><div class="section-heading"><div class="section-title"><span class="section-number">03</span><div><h2>长中文解读</h2></div></div></div><p data-test-long><strong>${longText.slice(0, 1357)}</strong>${longText.slice(1357)}</p><h3>长列表项</h3><ol start="3" data-test-list><li>${longList}</li></ol></section>`;
      fixture.hidden = true;
      document.body.append(fixture);
      return { longText, longList };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const stress = await captureBuild(page, '#pdfStressFixture', { athlete: { name: '中文分页验收', date: '2026-10-04' }, recordId: 'pdf-stress' });
    verifyPages(stress);
    assert.ok(stress.pages.reduce((sum, item) => sum + item.images, 0) >= 1, 'hidden report SVG must be restored from its viewBox');
    assert.equal(await page.evaluate(() => document.getElementById('pdfStressFixture').hidden), true, 'the live report must stay hidden');
    assert.deepEqual(stress.pages.flatMap(item => item.rowIds), Array.from({ length: 130 }, (_, index) => 'ROW_' + String(index).padStart(3, '0')));
    assert.equal(stress.pages.map(item => item.longText).join(''), expected.longText, 'long formatted Chinese paragraph must be retained exactly');
    assert.equal(stress.pages.map(item => item.longList).join(''), expected.longList, 'long list item must be retained exactly');
    assert.ok(stress.pages.filter(item => item.tableHeads.length).length > 2, 'continued tables repeat their column headers');
    assert.ok(stress.pages.every(item => !/section-heading|test-title|pdf-group-heading/.test(item.lastClass)), 'a title must not be the last block on a page');
    fs.writeFileSync(path.join(artifacts, 'module-stress.pdf'), Buffer.from(stress.base64, 'base64'));
    console.log(`PASS mobile viewport, repeated table heads and lossless Chinese pagination: ${stress.pages.length} pages`);

    assert.deepEqual(requests, [], 'real offline exports must make no HTTP requests');
    await page.route('https://example.invalid/**', route => route.abort());
    const failure = await page.evaluate(async () => {
      const fixture = document.getElementById('pdfStressFixture');
      const image = document.createElement('img'); image.src = 'https://example.invalid/not-embedded.png'; fixture.append(image);
      let message = '';
      try { await RingsidePDF.build({}, fixture); } catch (error) { message = error.message; }
      image.remove();
      return { message, leaked: document.querySelectorAll('.ringside-pdf-stage').length };
    });
    assert.match(failure.message, /未内嵌图片/);
    assert.equal(failure.leaked, 0);
    // The fixture deliberately requests a rejected external image; the export
    // itself must not make any requests while rendering either real report.
    assert.ok(requests.every(url => url === 'https://example.invalid/not-embedded.png'), JSON.stringify(requests));
    assert.deepEqual(errors, []);
    console.log('PASS explicit failure and cleanup for non-embedded image');
    const rendererFailure = await page.evaluate(async () => {
      const actual = html2canvas;
      window.html2canvas = async () => { throw new Error('Injected renderer failure'); };
      let message = '';
      try { await RingsidePDF.build({}, document.getElementById('pdfStressFixture')); }
      catch (error) { message = error.message; }
      finally { window.html2canvas = actual; }
      return { message, leaked: document.querySelectorAll('.ringside-pdf-stage').length };
    });
    assert.equal(rendererFailure.message, 'Injected renderer failure');
    assert.equal(rendererFailure.leaked, 0);
    console.log('PASS renderer failure cleans all temporary pages');
    fs.writeFileSync(path.join(artifacts, 'module-test-results.json'), JSON.stringify({
      sourceHash,
      sample: { pages: sample.pages.length, bytes: sample.bytes, captures: sample.pages, diagnostics: sample.diagnostics },
      stress: { pages: stress.pages.length, bytes: stress.bytes, captures: stress.pages, diagnostics: stress.diagnostics },
      browserErrors: errors,
      externalRequestsDuringExport: [],
      blockedNegativeFixtureRequests: requests
    }, null, 2));
    await context.close();
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
