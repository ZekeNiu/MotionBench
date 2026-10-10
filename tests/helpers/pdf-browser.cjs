"use strict";
const path = require("node:path");
const assert = require("node:assert/strict");

function argument(name) {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function artifactDirectory(root, fallback) {
  return path.resolve(root, argument("artifact-dir") || fallback);
}
async function ready(page) {
  await page.waitForFunction(() => !!window.App?.ready);
  assert.equal(await page.evaluate(() => App.ready), true, "application initialization must complete");
}
async function showReport(page) {
  await page.evaluate(() => App.showReport());
  await page.locator("#reportView").waitFor({ state: "visible" });
}
async function openExport(page) {
  const menu = page.locator("#reportExportMenu");
  await menu.waitFor({ state: "visible" });
  if (!await menu.evaluate(node => node.open)) await menu.locator(":scope > summary").click();
}
async function downloadFromReport(page, action, timeout = 180000) {
  await openExport(page);
  const button = page.locator(`#reportExportMenu button[onclick="App.${action}()"]`);
  assert.equal(await button.count(), 1, `current report action ${action} must exist`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout }),
    button.click(),
  ]);
  assert.equal(await download.failure(), null, `${action} download must complete`);
  return download;
}
async function emptyRecord(page, id) {
  const outcome = await page.evaluate(async id => {
    const record = RingsideModel.defaults();
    Object.assign(record, { recordId: id, athleteId: id + "-athlete", demo: false });
    Object.assign(record.athlete, { name: "PDF 空白验收（合成）", date: "2026-10-10", mass: 70, height: 180 });
    await App.importPayload(RingsideModel.recordEnvelope(record));
    await App.showReport();
    return { recordId: App.getState().recordId, validTests: App.stats().validTests.size };
  }, id);
  assert.equal(outcome.recordId, id, "empty fixture must become the current test record");
  assert.equal(outcome.validTests, 0, "empty fixture must contain no valid measurements");
  return outcome;
}
module.exports = { argument, artifactDirectory, ready, showReport, openExport, downloadFromReport, emptyRecord };
