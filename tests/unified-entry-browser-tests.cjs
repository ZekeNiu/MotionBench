"use strict";

// This suite exercises the shared single-/multi-athlete workflow through visible controls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"), { createHash } = require("node:crypto");
const { chromium } = require("./helpers/playwright.cjs"), ExcelJS = require("../vendor/exceljs.min.js");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.join(root, "output/playwright/unified-entry");
const result = { sourceHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"), channel, checks: [], errors: [], network: [], screenshots: [], layouts: [], pass: false };
const columns = sheet => Object.fromEntries(sheet.getRow(2).values.map((key, index) => [key, index]).filter(([key]) => key));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => result.errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
  page.on("dialog", dialog => dialog.accept());
  const check = async (name, run) => { await run(); result.checks.push(name); console.log("PASS", name); };
  const ready = async () => { await page.waitForFunction(() => !!App.ready); await page.evaluate(async () => App.ready); };
  const countRecords = () => page.evaluate(() => App.getLibrary().athletes.reduce((sum, athlete) => sum + athlete.records.length, 0));
  const snapshot = async name => {
    const destination = path.join(out, `${channel}-${name}.png`);
    await page.screenshot({ path: destination, fullPage: true });
    result.screenshots.push({ path: path.relative(root, destination).replaceAll("\\", "/"), sha256: createHash("sha256").update(fs.readFileSync(destination)).digest("hex") });
  };
  const choose = id => page.locator(`[data-creation-athlete="${id}"]`).check();
  const download = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 Excel 模板", exact: true }).click();
    const downloaded = await pending, destination = path.join(out, `${channel}-${Date.now()}.xlsx`);
    assert.equal(await downloaded.failure(), null); await downloaded.saveAs(destination);
    await page.waitForFunction(() => !RingsideExcelFlow.isBusy());
    return fs.readFileSync(destination);
  };
  const parse = data => page.evaluate(async values => RingsideExcel.readTemplate(new Uint8Array(values)), [...data]);
  const upload = async data => {
    await page.getByRole("button", { name: "导入 Excel 文件", exact: true }).click();
    assert.equal(await page.locator("#excelModal").isVisible(), true);
    assert.equal(await page.locator("#excelModal").getByRole("button", { name: "下载 Excel 模板", exact: true }).count(), 0);
    await page.locator("#excelFile").setInputFiles({ name: "统一录入验收.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: data });
    await page.waitForFunction(() => !RingsideExcelFlow.isBusy());
  };
  let people, emptyTemplate, templateTargets, filledTemplate;
  try {
    await page.goto(pathToFileURL(file).href); await ready();
    await page.evaluate(()=>App.importPayload(RingsideModel.libraryDefaults(), "replace-library"));
    people = await page.evaluate(async () => {
      const first = await App.createAthlete("统一录入同名运动员");
      const second = await App.createAthlete("统一录入同名运动员");
      const third = await App.createAthlete("统一录入未选人员");
      await App.getRepository().flush();
      return [first, second, third];
    });
    await check("athlete selection supports multiple existing identities without an Excel-specific branch", async () => {
      await page.evaluate(() => App.startDataEntry());
      assert.equal(await page.locator("#creationView").getByRole("button", { name: /Excel/ }).count(), 0);
      await choose(people[0]); await choose(people[1]);
      await page.locator("#creationAthleteSearch").fill("未选人员");
      assert.equal(await page.locator(`[data-creation-athlete="${people[2]}"]`).isVisible(), true);
      await page.locator("#creationAthleteSearch").fill("");
      assert.equal(await page.locator(`[data-creation-athlete="${people[0]}"]`).isChecked(), true);
      assert.equal(await page.locator(`[data-creation-athlete="${people[1]}"]`).isChecked(), true);
      assert.equal(await page.locator(`[data-creation-athlete="${people[2]}"]`).isChecked(), false);
      assert.equal(await countRecords(), 0); await snapshot("step1-multiple");
      for (const width of [1440, 1280, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.evaluate(() => ({ stage: "athlete selection", width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
        assert.equal(geometry.overflow, false); result.layouts.push(geometry);
        if (width === 390) await snapshot("step1-multiple-390");
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check("test setup contains no template or import entry and carries the selected athlete count", async () => {
      await page.locator("#creationNext").click(); await page.locator("#creationTestStep").waitFor({ state: "visible" });
      assert.equal(await page.locator("#creationView").getByRole("button", { name: /Excel/ }).count(), 0);
      await page.locator('#creationProjects [data-picker-project="cmj"]').check();
      await page.locator("#creationDate").fill("2026-10-10");
      assert.equal(await countRecords(), 0); await snapshot("step2-settings");
      await page.locator("#creationSubmit").click(); await page.waitForFunction(() => App.getUIState().mode === "entry");
    });
    await check("project entry offers separate download and import controls without creating empty test records", async () => {
      assert.equal(await page.getByRole("button", { name: "下载 Excel 模板", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "导入 Excel 文件", exact: true }).count(), 1);
      emptyTemplate = await download(); assert.equal(await countRecords(), 0);
      assert.equal(await page.locator("#excelModal").isVisible(), false);
      const parsed = await parse(emptyTemplate); assert.deepEqual(parsed.errors, []);
      templateTargets = parsed.targets;
      assert.deepEqual(templateTargets.map(target => target.athleteId).sort(), people.slice(0, 2).sort());
      assert.equal(new Set(templateTargets.map(target => target.recordId)).size, 2);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(emptyTemplate);
      const sheet = workbook.worksheets.find(item => /CMJ/.test(item.name) && !item.name.includes("补充")), keys = columns(sheet);
      assert.ok(sheet); assert.equal(sheet.rowCount - 2, 6);
      for (let row = 3; row <= sheet.rowCount; row++) sheet.getCell(row, keys.height).value = 30 + row;
      filledTemplate = Buffer.from(await workbook.xlsx.writeBuffer()); await snapshot("step3-actions");
    });
    await check("cancelled import preview retains the entry session and writes no partial batch", async () => {
      await upload(filledTemplate); assert.equal(await page.locator(".excel-preview-record").count(), 2);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await countRecords(), 0); assert.equal(await page.evaluate(() => App.getUIState().mode), "entry");
      assert.equal(await page.locator("#entryAthleteSelect option").count(), 2);
    });
    await check("a newly rejected workbook invalidates the prior valid preview and can be corrected", async () => {
      await upload(filledTemplate); assert.equal(await page.locator("#excelConfirm").isDisabled(), false);
      await page.locator("#excelFile").setInputFiles({ name: "损坏模板.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("not-an-xlsx-workbook") });
      await page.waitForFunction(() => !RingsideExcelFlow.isBusy());
      assert.equal(await page.locator("#excelConfirm").count(), 0);
      assert.equal(await page.locator("#excelError").isVisible(), true);
      await page.evaluate(() => RingsideExcelFlow.confirm()); assert.equal(await countRecords(), 0);
      await page.locator("#excelFile").setInputFiles({ name: "更正模板.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: filledTemplate });
      await page.waitForFunction(() => !RingsideExcelFlow.isBusy()); assert.equal(await page.locator("#excelConfirm").isDisabled(), false);
      const outside = await page.evaluate(async athleteId => {
        const owner = App.getLibrary().athletes.find(person => person.id === athleteId);
        const record = RingsideModel.recordFromCatalog(App.getLibrary().catalog, owner.profile, { cmj: true }, "2026-10-10");
        record.athleteId = athleteId; record.recordId = crypto.randomUUID(); record.data.cmj[0].height = 77;
        const created = await RingsideExcel.createTemplate({ records: [record], prefill: true }); return Array.from(created.bytes);
      }, people[2]);
      await page.locator("#excelFile").setInputFiles({ name: "名单外人员.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(outside) });
      await page.waitForFunction(() => !RingsideExcelFlow.isBusy()); assert.equal(await page.locator("#excelConfirm").count(), 0);
      assert.match(await page.locator("#excelError").innerText(), /名单之外/); assert.equal(await countRecords(), 0);
      await page.getByRole("button", { name: "取消", exact: true }).click();
    });
    await check("the import entry reads the completed two-person template and saves distinct target records", async () => {
      await upload(filledTemplate); assert.equal(await page.locator("#excelConfirm").isDisabled(), false);
      await page.locator("#excelConfirm").click();
      await page.getByText("导入完成：新建 2 条", { exact: false }).waitFor();
      assert.equal(await countRecords(), 2);
      for (const target of templateTargets) {
        const record = await page.evaluate(id => App.getRepository().loadRecord(id), target.recordId);
        assert.equal(record.athleteId, target.athleteId); assert.equal(record.data.cmj.length, 3);
      }
    });
    await page.evaluate(() => App.close("excelModal"));
    await check("manual entry switches between selected athletes while retaining each athlete's own measurements", async () => {
      await page.evaluate(async () => { await App.showReport(); await App.startDataEntry(); }); await choose(people[0]); await choose(people[1]);
      await page.locator("#creationNext").click(); await page.locator("#creationTestStep").waitFor({ state: "visible" });
      await page.locator('#creationProjects [data-picker-project="cmj"]').check();
      await page.locator("#creationSubmit").click(); await page.waitForFunction(() => App.getUIState().mode === "entry");
      const choices = await page.locator("#entryAthleteSelect option").evaluateAll(options => options.map(option => option.value));
      assert.equal(choices.length, 2);
      await page.locator("#entryAthleteSelect").selectOption(choices[0]);
      await page.waitForFunction(id => App.getState()?.athleteId === id, people[0]);
      await page.locator('[data-path="data.cmj.0.height"]').fill("41.5");
      const firstRecord = await page.evaluate(() => App.getState().recordId);
      await page.locator("#entryAthleteSelect").selectOption(choices[1]);
      await page.waitForFunction(id => App.getState()?.athleteId === id, people[1]);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "");
      await page.locator('[data-path="data.cmj.0.height"]').fill("53.25");
      assert.equal(await page.evaluate(() => App.saveNow()), true);
      const secondRecord = await page.evaluate(() => App.getState().recordId);
      assert.notEqual(firstRecord, secondRecord);
      await page.locator("#entryAthleteSelect").selectOption(firstRecord);
      await page.waitForFunction(id => App.getState()?.athleteId === id, people[0]);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "41.5");
      assert.equal(await page.evaluate(() => App.getState().recordId), firstRecord);
      assert.equal(await page.evaluate(async id => Number((await App.getRepository().loadRecord(id)).data.cmj[0].height), secondRecord), 53.25);
      result.manualTargets = [{ athleteId: people[0], recordId: firstRecord }, { athleteId: people[1], recordId: secondRecord }];
    });
    await check("an invalid manual measurement prevents athlete switching and preserves the editable value", async () => {
      await page.locator('[data-path="data.cmj.0.height"]').fill("-5");
      await page.locator("#entryAthleteSelect").selectOption(result.manualTargets[1].recordId);
      assert.equal(await page.evaluate(() => App.getState().athleteId), people[0]);
      assert.equal(await page.locator("#entryAthleteSelect").inputValue(), result.manualTargets[0].recordId);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "-5");
      assert.equal(await page.evaluate(() => Number(App.getState().data.cmj[0].height)), 41.5);
      await page.locator('[data-path="data.cmj.0.height"]').fill("41.5"); assert.equal(await page.evaluate(() => App.saveNow()), true);
    });
    await check("a failed manual save prevents switching and can be retried without losing either athlete", async () => {
      await page.evaluate(() => {
        const repository = App.getRepository(); window.__unifiedSave = repository.save.bind(repository);
        repository.save = () => Promise.reject(Error("统一录入保存失败"));
      });
      await page.locator('[data-path="data.cmj.0.height"]').fill("45.75");
      await page.locator("#entryAthleteSelect").selectOption(result.manualTargets[1].recordId);
      await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("保存失败"));
      assert.equal(await page.evaluate(() => App.getState().athleteId), people[0]);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "45.75");
      await page.evaluate(() => { App.getRepository().save = window.__unifiedSave; delete window.__unifiedSave; });
      await page.locator("#entryAthleteSelect").selectOption(result.manualTargets[1].recordId);
      await page.waitForFunction(id => App.getState()?.athleteId === id, people[1]);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "53.25");
      assert.equal(await page.evaluate(async id => Number((await App.getRepository().loadRecord(id)).data.cmj[0].height), result.manualTargets[0].recordId), 45.75);
    });
    await check("refresh resumes the selected athlete and the multiple-athlete manual entry session", async () => {
      await page.reload(); await ready();
      assert.equal(await page.evaluate(() => App.getUIState().mode), "entry");
      assert.equal(await page.evaluate(() => App.getState().athleteId), people[1]);
      assert.equal(await page.locator("#entryAthleteSelect option").count(), 2);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "53.25");
      await page.locator("#entryAthleteSelect").selectOption(result.manualTargets[0].recordId);
      await page.waitForFunction(id => App.getState()?.athleteId === id, people[0]);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "45.75");
      await snapshot("manual-refresh");
    });
    await check("an empty single-athlete entry survives refresh with a stable template target and cancels without a record", async () => {
      await page.evaluate(async () => { await App.showReport(); await App.startDataEntry(); });
      await choose(people[2]); await page.locator("#creationNext").click();
      await page.locator('#creationProjects [data-picker-project="cmj"]').check();
      const before = await countRecords(); await page.locator("#creationSubmit").click();
      await page.waitForFunction(() => App.getUIState().mode === "entry");
      const target = await page.evaluate(() => ({ athleteId: App.getState().athleteId, recordId: App.getState().recordId }));
      assert.equal(target.athleteId, people[2]); assert.equal(await countRecords(), before);
      const first = await parse(await download()); assert.deepEqual(first.targets, [target]);
      await page.evaluate(() => App.saveLibraryChanges());
      assert.equal(await page.evaluate(() => App.saveNow()), true);
      assert.equal(await countRecords(), before);
      await page.reload(); await ready(); assert.equal(await page.evaluate(() => App.getUIState().mode), "entry");
      assert.equal(await page.evaluate(() => App.getState().recordId), target.recordId);
      assert.equal(await countRecords(), before); const second = await parse(await download());
      assert.deepEqual(second.targets, [target]);
      for (const width of [1440, 1280, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, actions: [...document.querySelectorAll("[data-entry-excel-action]")].map(button => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right, width: button.getBoundingClientRect().width })) }));
        assert.equal(geometry.overflow, false); assert.ok(geometry.actions.every(bounds => bounds.left >= 0 && bounds.right <= width + 1));
        result.layouts.push(geometry); await snapshot(`entry-actions-${width}`);
      }
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator("#workspaceBack").click();
      await page.waitForFunction(() => App.getUIState().mode === "report"); assert.equal(await countRecords(), before);
      assert.equal(await page.evaluate(id => App.getLibrary().athletes.find(person => person.id === id).records.length, people[2]), 0);
    });
    await check("a normalized pending session preserves a newly typed measurement on immediate refresh", async () => {
      await page.evaluate(() => App.startDataEntry()); await choose(people[2]); await page.locator("#creationNext").click();
      await page.locator('#creationProjects [data-picker-project="cmj"]').check(); await page.locator("#creationSubmit").click();
      await page.waitForFunction(() => App.getUIState().mode === "entry");
      const target = await page.evaluate(() => App.getState().recordId), before = await countRecords();
      await page.evaluate(() => App.saveLibraryChanges()); assert.equal(await page.evaluate(() => App.saveNow()), true);
      assert.equal(await countRecords(), before);
      await page.evaluate(() => {
        const field = document.querySelector('[data-path="data.cmj.0.height"]'); field.value = "61.25";
        field.dispatchEvent(new Event("input", { bubbles: true })); location.reload();
      });
      await page.waitForLoadState("load"); await ready();
      assert.equal(await page.evaluate(() => App.getState().recordId), target);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "61.25");
      assert.equal(await page.evaluate(() => App.saveNow()), true);
      assert.equal(await countRecords(), before + 1);
      assert.equal(await page.evaluate(async id => Number((await App.getRepository().loadRecord(id)).data.cmj[0].height), target), 61.25);
    });
    await check("failed persistence of a saved athlete retains the edited measurement after refresh", async () => {
      const target = await page.evaluate(() => App.getState().recordId);
      await page.evaluate(() => {
        const repository = App.getRepository(); window.__unifiedRefreshSave = repository.save.bind(repository);
        repository.save = () => Promise.reject(Error("刷新前保存失败"));
      });
      await page.locator('[data-path="data.cmj.0.height"]').fill("66.75");
      assert.equal(await page.evaluate(() => App.saveNow()), false);
      assert.equal(await page.evaluate(async id => Number((await App.getRepository().loadRecord(id)).data.cmj[0].height), target), 61.25);
      await page.reload(); await ready(); assert.equal(await page.evaluate(() => App.getState().recordId), target);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "66.75");
      assert.equal(await page.evaluate(() => App.saveNow()), true);
      assert.equal(await page.evaluate(async id => Number((await App.getRepository().loadRecord(id)).data.cmj[0].height), target), 66.75);
    });
    await check("refresh uses a concurrently changed stored record and explicitly reports the conflict", async () => {
      const target = await page.evaluate(() => App.getState().recordId);
      await page.evaluate(() => {
        const repository = App.getRepository(); window.__unifiedConcurrentSave = repository.save.bind(repository);
        repository.save = () => Promise.reject(Error("冲突场景保留未存输入"));
      });
      await page.locator('[data-path="data.cmj.0.height"]').fill("67.75"); assert.equal(await page.evaluate(() => App.saveNow()), false);
      await page.evaluate(async id => {
        const stored = await App.getRepository().loadRecord(id); stored.data.cmj[0].height = 88.5;
        await window.__unifiedConcurrentSave(App.getLibrary(), [stored]);
      }, target);
      await page.reload(); await ready(); assert.equal(await page.evaluate(() => App.getState().recordId), target);
      assert.equal(await page.locator('[data-path="data.cmj.0.height"]').inputValue(), "88.5");
      assert.match(await page.locator("#toast").innerText(), /其他页面修改.*最新内容/);
      assert.equal(await page.evaluate(async id => (await App.getRepository().loadRecord(id)).data.cmj[0].height, target), 88.5);
    });
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []); result.pass = true;
  } catch (error) {
    result.failure = error.stack; process.exitCode = 1; console.error(error);
    await page.screenshot({ path: path.join(out, `${channel}-failure.png`), fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(out, `${channel}-results.json`), JSON.stringify(result, null, 2));
    await context.close(); await browser.close();
  }
})();
