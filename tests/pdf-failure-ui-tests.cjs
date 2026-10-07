'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('./helpers/playwright.cjs');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'Ringside_Boxing_Assessment.html');
const result = { sourceHash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), pass: false };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ offline: true, acceptDownloads: true });
  const page = await context.newPage();
  let downloads = 0;
  page.on('download', () => downloads++);
  try {
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => window.App?.downloadPDF);
    await page.evaluate(() => {
      App.createAthlete('PDF失败重试验收'); App.showReport();
      window.__originalPDFRenderer = window.html2canvas;
      window.html2canvas = async () => { throw new Error('验收模拟绘制失败'); };
    });
    if (!await page.locator('#saveModal').isVisible()) {
        if (await page.locator('#sidebar').evaluate(el=>el.inert)) await page.locator('#sidebarToggle').click();
        await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
      }
      await page.locator('#pdfButton').click();
    await page.waitForFunction(() => !document.querySelector('#pdfButton').disabled && document.querySelector('#toast').textContent.includes('PDF导出失败'));
    assert.equal(downloads, 0);
    const failure = await page.evaluate(() => ({
      temporaryPages: document.querySelectorAll('.ringside-pdf-stage').length,
      button: document.querySelector('#pdfButton').textContent,
      progressHidden: document.querySelector('#pdfProgress').hidden,
      status: RingsidePDF.lastDiagnostics.status
    }));
    assert.equal(failure.temporaryPages, 0); assert.equal(failure.button, '导出当前报告 PDF');
    assert.equal(failure.progressHidden, true); assert.equal(failure.status, 'failed');
    await page.evaluate(() => { window.html2canvas = window.__originalPDFRenderer; delete window.__originalPDFRenderer; });
    const pending = page.waitForEvent('download', { timeout: 60000 });
    if (!await page.locator('#saveModal').isVisible()) {
        if (await page.locator('#sidebar').evaluate(el=>el.inert)) await page.locator('#sidebarToggle').click();
        await page.locator('#sidebar button[onclick="App.saveMenu()"] ').click();
      }
      await page.locator('#pdfButton').click();
    const download = await pending;
    await download.saveAs(path.join(root, 'output/pdf/failure-retry.pdf'));
    await page.waitForFunction(() => !document.querySelector('#pdfButton').disabled);
    assert.equal(downloads, 1);
    result.pass = true; result.failure = failure; result.retryPages = await page.evaluate(() => RingsidePDF.lastDiagnostics.pageCount);
    console.log('PASS PDF failed click downloads nothing, restores controls, and retries successfully');
  } catch (error) { result.error = error.stack; throw error; }
  finally {
    fs.writeFileSync(path.join(root, 'output/pdf/failure-ui-verification.json'), JSON.stringify(result, null, 2));
    await context.close(); await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
