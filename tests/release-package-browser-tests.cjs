"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { chromium } = require("./helpers/playwright.cjs");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/release");
const packagedFile = path.join(out, "verify-2.13.0/MotionBench/MotionBench.html");
const sourceFile = path.join(root, "MotionBench.html");
const resultsFile = path.join(out, "package-browser-results.json");
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = {
  packagedFile: path.relative(root, packagedFile).replaceAll("\\", "/"),
  packagedHtmlSha256: null,
  sourceHash: null,
  channels: [],
  pass: false,
};

async function verifyChannel(channel) {
  const evidence = { channel, isolation: "new browser and empty isolated context", checks: [], errors: [], network: [], pass: false };
  result.channels.push(evidence);
  let browser, context, page;
  const check = async (name, run) => {
    await run();
    evidence.checks.push(name);
    console.log("PASS", channel, name);
  };
  const ready = async () => {
    await page.waitForFunction(() => Boolean(window.App?.ready));
    await page.evaluate(async () => { await App.ready; });
  };
  const counts = () => page.evaluate(() => ({
    athletes: App.getLibrary().athletes.length,
    records: App.getLibrary().athletes.reduce((sum, person) => sum + person.records.length, 0),
  }));
  try {
    browser = await chromium.launch({ channel, headless: true });
    context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    context.on("request", request => {
      if (/^https?:/i.test(request.url())) evidence.network.push(request.url());
    });
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => evidence.errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.goto(pathToFileURL(packagedFile).href);
    await ready();

    await check("packaged HTML initializes offline with an empty library", async () => {
      assert.deepEqual(await counts(), { athletes: 0, records: 0 });
      assert.equal(await page.evaluate(() => App.getState()), null);
    });
    await check("ExcelJS and the complete Excel workflow are embedded in the package", async () => {
      const modules = await page.evaluate(() => ({
        excelJs: typeof window.ExcelJS?.Workbook,
        createTemplate: typeof window.RingsideExcel?.createTemplate,
        readTemplate: typeof window.RingsideExcel?.readTemplate,
        preview: typeof window.RingsideExcel?.preview,
        apply: typeof window.RingsideExcel?.apply,
        openWorkflow: typeof window.RingsideExcelFlow?.open,
      }));
      assert.ok(Object.values(modules).every(type => type === "function"));
      evidence.modules = modules;
    });

    let people, downloaded;
    await check("two simulated existing athletes are saved without test records", async () => {
      people = await page.evaluate(async () => {
        const first = await App.createAthlete("交付包验收运动员甲");
        const second = await App.createAthlete("交付包验收运动员乙");
        await App.getRepository().flush();
        return [first, second];
      });
      assert.equal(new Set(people).size, 2);
      assert.ok(people.every(id => typeof id === "string" && id.length > 0));
      assert.deepEqual(await counts(), { athletes: 2, records: 0 });
    });
    await check("actual batch selection and CMJ template download create no empty records", async () => {
      await page.evaluate(() => App.startDataEntry());
      await page.getByRole("button", { name: "多人 Excel 录入", exact: true }).click();
      for (const id of people) await page.locator(`[data-excel-person="${id}"]`).check();
      await page.locator('#excelProjects [data-picker-project="cmj"]').check();
      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("button", { name: "下载 Excel 模板", exact: true }).click();
      const download = await downloadEvent;
      assert.equal(await download.failure(), null);
      assert.match(download.suggestedFilename(), /\.xlsx$/i);
      const destination = path.join(out, `package-${channel}-cmj-template.xlsx`);
      await download.saveAs(destination);
      downloaded = fs.readFileSync(destination);
      assert.equal(downloaded.subarray(0, 2).toString("ascii"), "PK");
      evidence.template = { file: path.basename(destination), bytes: downloaded.length, sha256: sha256(destination) };
      await page.waitForFunction(() => !RingsideExcelFlow.isBusy());
      assert.deepEqual(await counts(), { athletes: 2, records: 0 });
      assert.equal(await page.locator("#excelError").isVisible(), false);
    });
    await check("the packaged product parser reads its downloaded two-person CMJ workbook without errors", async () => {
      const parsed = await page.evaluate(async bytes => {
        const parsed = await RingsideExcel.readTemplate(new Uint8Array(bytes));
        return {
          errors: parsed.errors,
          targets: parsed.targets,
          entries: parsed.entries.map(entry => ({
            athleteId: entry.record.athleteId,
            recordId: entry.record.recordId,
            enabled: Object.entries(entry.record.enabled).filter(([, enabled]) => enabled).map(([id]) => id),
            incoming: entry.incoming,
          })),
        };
      }, [...downloaded]);
      assert.deepEqual(parsed.errors, []);
      assert.equal(parsed.targets.length, 2);
      assert.equal(parsed.entries.length, 2);
      assert.deepEqual(parsed.targets.map(target => target.athleteId).sort(), [...people].sort());
      assert.equal(new Set(parsed.targets.map(target => target.recordId)).size, 2);
      for (const entry of parsed.entries) {
        assert.deepEqual(entry.enabled, ["cmj"]);
        assert.deepEqual(entry.incoming, []);
        assert.ok(parsed.targets.some(target => target.recordId === entry.recordId && target.athleteId === entry.athleteId));
      }
      evidence.parsed = parsed;
      assert.deepEqual(await counts(), { athletes: 2, records: 0 });
    });
    await check("refresh retains both athlete identities and still has no test records", async () => {
      await page.reload();
      await ready();
      assert.deepEqual(await counts(), { athletes: 2, records: 0 });
      assert.deepEqual(await page.evaluate(() => App.getLibrary().athletes.map(person => person.id).sort()), [...people].sort());
      assert.deepEqual(await page.evaluate(() => App.getLibrary().athletes.map(person => person.name).sort()), ["交付包验收运动员乙", "交付包验收运动员甲"].sort());
    });
    await check("the complete packaged workflow has no page errors or network requests", async () => {
      assert.deepEqual(evidence.errors, []);
      assert.deepEqual(evidence.network, []);
    });
    evidence.pass = true;
  } catch (error) {
    evidence.failure = error.stack || String(error);
    console.error(channel, error);
    if (page) await page.screenshot({ path: path.join(out, `package-${channel}-failure.png`), fullPage: true }).catch(() => {});
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  try {
    assert.ok(fs.existsSync(packagedFile), "Generate and extract the release package before running this test.");
    result.packagedHtmlSha256 = sha256(packagedFile);
    result.sourceHash = sha256(sourceFile);
    assert.equal(result.packagedHtmlSha256, result.sourceHash, "Packaged HTML must match the verified source artifact.");
    for (const channel of ["chrome", "msedge"]) await verifyChannel(channel);
    assert.equal(sha256(packagedFile), result.packagedHtmlSha256, "Packaged HTML changed during verification.");
    assert.equal(sha256(sourceFile), result.sourceHash, "Source HTML changed during verification.");
    result.pass = result.channels.length === 2 && result.channels.every(channel => channel.pass);
  } catch (error) {
    result.failure = error.stack || String(error);
    console.error(error);
  } finally {
    result.checkedUtc = new Date().toISOString();
    fs.writeFileSync(resultsFile, JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
  }
})();
