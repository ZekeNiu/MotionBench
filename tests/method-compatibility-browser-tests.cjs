"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const source = path.resolve(root, arg("--source", "MotionBench.html")), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const output = path.resolve(root, arg("--artifact-dir", "output/playwright/method-compatibility")), receipt = { channel, synthetic: true, sourceHash: hash(source), runnerSha256: hash(__filename), checks: [], errors: [], pass: false };
(async () => {
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  page.on("pageerror", error => receipt.errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  const check = async (name, run) => { await run(); receipt.checks.push(name); console.log("PASS " + name); };
  const save = async () => { await page.locator('#catalogForm [type="submit"]').click(); await page.locator("#catalogModal").waitFor({ state: "hidden" }); };
  try {
    await page.goto(pathToFileURL(source).href); await page.waitForFunction(() => window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true);
    await page.evaluate(async () => {
      const M = RingsideModel, r = M.sampleRecord(); r.demo = false; r.athlete.name = "Synthetic method identity";
      M.stampProtocolIdentities(r); Object.values(r.protocolIdentities).forEach(identity => identity.version = 7); r.definitions.forEach(d => d.protocolIdentity.version = 9);
      await App.importPayload(M.recordEnvelope(r, RingsideEvaluation.create(r)), "replace-library");
      await App.commitLibraryChange(candidate => { M.stampProtocolIdentities(candidate.catalog); candidate.catalog.protocolIdentities.cmj.version = 7; candidate.catalog.definitions.find(d => d.id === "cmj_height").protocolIdentity.version = 9; });
    });
    await check("project and metric editors remove controls and retain legacy metadata without resetting it", async () => {
      await page.evaluate(() => App.openManagement("metrics")); await page.evaluate(() => App.openCatalogItem("edit-project", "cmj"));
      assert.equal(await page.locator("#catalogProjectMethodChanged,#catalogMetricMethodChanged,#catalogProtocolVersion,#catalogMetricProtocolVersion").count(), 0);
      await page.locator("#catalogTestName").fill("CMJ synthetic rename"); await save();
      assert.equal(await page.evaluate(() => App.getLibrary().catalog.protocolIdentities.cmj.version), 7);
      await page.evaluate(() => App.openCatalogItem("edit", "cmj", "cmj_height")); await page.locator("#catalogMetricName").fill("CMJ synthetic height"); await save();
      assert.equal(await page.evaluate(() => App.getLibrary().catalog.definitions.find(d => d.id === "cmj_height").protocolIdentity.version), 9);
      await page.locator('[data-manager-action="catalog-open"][data-id="cmj"]').click();
      assert.doesNotMatch(await page.locator("#managementContent").innerText(), /协议版本|测量方法版本|方法发生改变/);
    });
    await check("new test and metric creation save successfully without generating method identities", async () => {
      await page.evaluate(() => App.openCatalogItem("new-test"));
      await page.locator("#catalogTestName").fill("Synthetic independent timing"); await page.locator("#catalogMetricName").fill("Elapsed time");
      await page.locator("#catalogUnit").fill("s"); await page.locator("#catalogPerformanceDirection").selectOption("lower"); await page.locator("#catalogSelectionDirection").selectOption("lower");
      await save();
      const result = await page.evaluate(() => { const lib = App.getLibrary(), test = lib.catalog.tests.find(t => t.name === "Synthetic independent timing"), d = lib.catalog.definitions.find(d => d.testId === test.id); window.__methodTestId = test.id; return { identity: lib.catalog.protocolIdentities[test.id], metricIdentity: d.protocolIdentity }; });
      assert.equal(result.identity, undefined); assert.equal(result.metricIdentity, undefined);
      await page.evaluate(() => App.openCatalogItem("new-metric", __methodTestId)); await page.locator("#catalogMetricName").fill("Additional time"); await page.locator("#catalogUnit").fill("s"); await page.locator("#catalogPerformanceDirection").selectOption("lower"); await save();
      assert.equal(await page.evaluate(() => App.getLibrary().catalog.definitions.filter(d => d.testId === __methodTestId).every(d => !d.protocolIdentity)), true);
    });
    await check("JSONL export and merge ignore method-only catalog and evaluation profile differences", async () => {
      const result = await page.evaluate(async () => {
        const before = await App.getRepository().createLibrary(), incoming = JSON.parse(JSON.stringify(before));
        Object.values(incoming.catalog.protocolIdentities).forEach(identity => identity.version += 10);
        incoming.catalog.protocol.cmj += " changed wording";
        incoming.catalog.definitions.forEach(d => { if (d.protocolIdentity) d.protocolIdentity.version += 10; });
        incoming.evaluationProfiles.forEach(p => p.standards.forEach(rule => { rule.context.protocolIdentity = { id: "old_project", version: 23 }; rule.context.metricProtocolIdentity = { id: "old_metric", version: 37 }; rule.context.protocol = "legacy text"; }));
        await App.importPayload(incoming, "merge");
        const after = await App.getRepository().createLibrary(), backup = await App.getRepository().createBackupBlob(() => {}), text = await backup.text();
        return { beforeProfiles: before.evaluationProfiles.length, afterProfiles: after.evaluationProfiles.length, conflicts: after.catalog.conflicts.filter(c => !c.resolved).length, legacyProject: after.catalog.protocolIdentities.cmj.version, jsonl: text.includes('"type":"config"') };
      });
      assert.equal(result.afterProfiles, result.beforeProfiles); assert.equal(result.conflicts, 0); assert.equal(result.legacyProject, 7); assert.equal(result.jsonl, true);
      await page.reload(); await page.waitForFunction(() => window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true);
      assert.equal(await page.evaluate(() => App.getLibrary().catalog.protocolIdentities.cmj.version), 7);
    });
    assert.deepEqual(receipt.errors, []); assert.equal(hash(source), receipt.sourceHash); assert.equal(hash(__filename), receipt.runnerSha256); receipt.pass = true;
  } catch (error) { receipt.error = error.stack; throw error; }
  finally { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, channel + "-results.json"), JSON.stringify(receipt, null, 2)); await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
