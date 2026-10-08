"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const {pathToFileURL} = require("node:url"), {createHash} = require("node:crypto"), {chromium} = require("./helpers/playwright.cjs"), ExcelJS = require("../vendor/exceljs.min.js");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html"), out = path.join(root, "output/playwright/fvp-storage"), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const hash = target => createHash("sha256").update(fs.readFileSync(target)).digest("hex");
const result = {sourceHash:hash(file), channel, synthetic:true, checks:[], errors:[], network:[], artifacts:[], pass:false};
fs.mkdirSync(out, {recursive:true});
const columns = sheet => Object.fromEntries(sheet.getRow(2).values.map((value, index) => [value, index]).filter(([key]) => key));
const empty = value => value === "" || value === null || value === undefined;
const subset = record => ({recordId:record.recordId, athleteId:record.athleteId, mass:record.athlete.mass, raw:Object.fromEntries(["fvp_sj", "fvp_cmj"].map(id => [id, record.data[id]])), config:record.fvpConfig, analysis:record.fvpAnalysis, view:record.fvpView, selected:record.views.fvpProtocol});
(async () => {
  const browser = await chromium.launch({channel, headless:true}), context = await browser.newContext({offline:true, acceptDownloads:true, viewport:{width:1440, height:1000}, reducedMotion:"reduce"}), page = await context.newPage();
  page.setDefaultTimeout(20000);
  const observe = target => {target.on("pageerror", error => result.errors.push(error.message)); target.on("request", request => {if (/^https?:/.test(request.url())) result.network.push(request.url());}); target.on("dialog", dialog => dialog.accept());};
  observe(page);
  const ready = async target => {await target.waitForFunction(() => !!App.ready); assert.equal(await target.evaluate(() => App.ready), true);};
  const check = async (name, run) => {await run(); result.checks.push(name); console.log("PASS " + name);};
  const input = key => page.locator(`[data-path="${key}"]`);
  const records = () => page.evaluate(() => App.getRepository().values("records"));
  const current = () => page.evaluate(() => App.getState());
  const saved = () => page.evaluate(() => App.saveNow());
  const artifact = (target, kind) => {result.artifacts.push({path:path.relative(root, target).replaceAll("\\", "/"), sha256:hash(target), kind});};
  const configure = async (id, suffix, distance) => {
    await page.evaluate(testId => App.entry(testId), id);
    for (const [key, value] of Object.entries({device:"设备" + suffix, method:id === "fvp_sj" ? "腾空时间" : "起跳速度", posture:id === "fvp_sj" ? "手叉腰，静止 2 秒" : "手叉腰，固定下蹲深度", distanceCm:distance, distanceSource:"髋高差实测"})) await input(`fvpConfig.${id}.${key}`).fill(String(value));
  };
  const trial = async (id, index, values) => {
    while (await page.evaluate(testId => App.getState().data[testId].length, id) <= index) await page.evaluate(testId => App.addRow(testId), id);
    for (const [key, value] of Object.entries(values)) {
      if (key === "excluded") await input(`data.${id}.${index}.${key}`).setChecked(value);
      else await input(`data.${id}.${index}.${key}`).fill(String(value));
    }
  };
  const settings = async (tag, selected) => page.evaluate(async ({tag, selected}) => {
    const record = App.getState();
    record.fvpAnalysis.fvp_sj = {angle:tag === "甲" ? 30 : 90, deltaForcePct:tag === "甲" ? 5 : -3, deltaVelocityPct:tag === "甲" ? -2 : 6};
    record.fvpAnalysis.fvp_cmj = {angle:tag === "甲" ? 90 : 30, deltaForcePct:tag === "甲" ? 4 : 2, deltaVelocityPct:tag === "甲" ? 3 : -4};
    record.fvpView.fvp_sj = {fv:true, pv:tag === "甲", points:true, optimum:true, comparison:tag === "甲", confidence:false, range:"measured", pinnedLoad:20};
    record.fvpView.fvp_cmj = {fv:tag !== "甲", pv:true, points:false, optimum:true, comparison:false, confidence:true, range:"full", pinnedLoad:40};
    record.views.fvpProtocol = selected; return App.saveNow();
  }, {tag, selected});
  const failWrites = () => page.evaluate(() => {const repository = App.getRepository(); window.__fvpOriginalSave = repository.save.bind(repository); window.__fvpRejectedWrites = 0; repository.save = () => {window.__fvpRejectedWrites++; return Promise.reject(Error("FVP 模拟磁盘保存失败"));};});
  const start = async people => {
    if (await page.locator("#excelModal").isVisible()) await page.evaluate(() => App.close("excelModal"));
    await page.evaluate(() => App.startDataEntry());
    for (const id of people) await page.locator(`[data-creation-athlete="${id}"]`).check();
    await page.locator("#creationNext").click();
    const selected = await page.locator('#creationProjects [data-picker-project]:checked').evaluateAll(nodes => nodes.map(node => node.dataset.pickerProject));
    for (const id of selected) await page.locator(`#creationProjects [data-picker-project="${id}"]`).uncheck();
    for (const id of ["fvp_sj", "fvp_cmj"]) await page.locator(`#creationProjects [data-picker-project="${id}"]`).check();
    await page.locator("#creationDate").fill("2026-10-09"); await page.locator("#creationSubmit").click(); await page.waitForFunction(() => App.getUIState().mode === "entry");
  };
  let people, firstId, secondId, firstSnapshot, expectedRecords, backup, filled, excelTargets;
  try {
    await page.goto(pathToFileURL(file).href); await ready(page);
    await check("manual batch creates stable isolated drafts while athlete metadata and FVP setup stay unmeasured", async () => {
      people = await page.evaluate(async () => [await App.createAthlete("FVP 隔离甲（模拟）"), await App.createAthlete("FVP 隔离乙（模拟）")]); await start(people);
      const options = await page.locator("#entryAthleteSelect option").evaluateAll(nodes => nodes.map(node => ({id:node.value, name:node.textContent})));
      firstId = (await current()).recordId; secondId = options.find(option => option.id !== firstId).id;
      assert.equal(options.length, 2); assert.equal((await records()).length, 0);
      await page.evaluate(() => App.entry("athlete")); await input("athlete.mass").fill("75"); await input("athlete.height").fill("180");
      await configure("fvp_sj", "甲", 33); await trial("fvp_sj", 0, {load:0, notes:"尚未测试"}); assert.equal(await saved(), true); assert.equal((await records()).length, 0);
    });
    await check("first athlete stores SJ and CMJ raw repeats, exclusions, distance and independent analysis/view choices", async () => {
      for (const [index, height] of [33, 27, 22].entries()) await trial("fvp_sj", index, {load:index * 20, height, notes:index ? "" : '甲 SJ "自重" & 原始记录'});
      await trial("fvp_sj", 3, {load:20, height:26.8, distanceCm:34, notes:"同负荷复测"});
      await trial("fvp_sj", 4, {load:20, height:99, distanceCm:35, excluded:true, exclusionReason:"未保持起始姿势", notes:"保留异常试次"});
      await configure("fvp_cmj", "甲", 40); for (const [index, height] of [42, 34, 25].entries()) await trial("fvp_cmj", index, {load:index * 20, height, distanceCm:index === 1 ? 39 : "", notes:"甲 CMJ"});
      assert.equal(await settings("甲", "fvp_sj"), true); assert.equal((await records()).length, 1);
      assert.equal(await page.evaluate(() => RingsideFVP.solve(App.getState(), "fvp_sj").valid), true); firstSnapshot = subset(await current());
    });
    await check("second athlete starts with its own empty profiles and a failed first save preserves its pending draft", async () => {
      await page.locator("#entryAthleteSelect").selectOption(secondId); await page.waitForFunction(id => App.getState().recordId === id, secondId);
      const before = await current(); assert.equal(before.data.fvp_sj.length, 0); assert.equal(before.data.fvp_cmj.length, 0); assert.equal(before.fvpConfig.fvp_sj.device, "");
      await page.evaluate(() => App.entry("athlete")); await input("athlete.mass").fill("77"); await configure("fvp_sj", "乙", 37);
      await trial("fvp_sj", 0, {load:0}); assert.equal(await saved(), true); assert.equal((await records()).length, 1);
      await failWrites(); await input("data.fvp_sj.0.height").fill("40"); assert.equal(await saved(), false); assert.match(await page.locator("#saveStatus").innerText(), /保存失败/);
      assert.equal(Boolean(await page.evaluate(id => App.getRepository().loadRecord(id), secondId)), false); assert.equal((await records()).length, 1);
      const target = path.join(out, channel + "-pending-save-failure.png"); await page.screenshot({path:target}); artifact(target, "failure-recovery");
    });
    await check("refresh recovers the unsaved second athlete with stable IDs and retries without duplicating the first", async () => {
      await page.reload(); await ready(page); assert.equal((await current()).recordId, secondId); assert.equal(await page.evaluate(() => App.getUIState().mode), "entry");
      assert.equal(await page.evaluate(() => App.getUIState().entryTab), "fvp_sj"); assert.equal(await input("data.fvp_sj.0.height").inputValue(), "40"); assert.equal(await input("fvpConfig.fvp_sj.device").inputValue(), "设备乙"); assert.equal((await current()).athlete.mass, "77");
      assert.equal(Boolean(await page.evaluate(id => App.getRepository().loadRecord(id), secondId)), false);
      for (const [index, height] of [40, 32, 24].entries()) await trial("fvp_sj", index, {load:index * 20, height, notes:"乙 SJ 独立试次"});
      await trial("fvp_sj", 3, {load:20, height:99, distanceCm:38, excluded:true, exclusionReason:"蹬伸动作不符", notes:"乙 排除原始值"});
      await configure("fvp_cmj", "乙", 43); for (const [index, height] of [48, 38, 29].entries()) await trial("fvp_cmj", index, {load:index * 20, height, distanceCm:index === 2 ? 42 : "", notes:"乙 CMJ 独立试次"});
      assert.equal(await settings("乙", "fvp_cmj"), true); assert.equal((await records()).length, 2);
      const prior = await page.evaluate(id => App.getRepository().loadRecord(id), firstId); assert.deepEqual(subset(prior), firstSnapshot);
    });
    await check("an already saved athlete's failed update survives refresh while the stored baseline and other athlete remain intact", async () => {
      await page.evaluate(() => App.entry("fvp_sj")); const baseline = await page.evaluate(id => App.getRepository().loadRecord(id), secondId);
      await failWrites(); await input("data.fvp_sj.0.height").fill("41.2"); await input("data.fvp_sj.0.distanceCm").fill("38"); assert.equal(await saved(), false);
      assert.deepEqual(subset(await page.evaluate(id => App.getRepository().loadRecord(id), secondId)), subset(baseline));
      await page.reload(); await ready(page); assert.equal((await current()).recordId, secondId);
      assert.deepEqual(subset(await page.evaluate(id => App.getRepository().loadRecord(id), secondId)), subset(baseline));
      assert.equal(await input("data.fvp_sj.0.height").inputValue(), "41.2"); assert.equal(await input("data.fvp_sj.0.distanceCm").inputValue(), "38"); assert.equal(await saved(), true);
      assert.equal((await records()).length, 2); assert.equal((await page.evaluate(id => App.getRepository().loadRecord(id), secondId)).data.fvp_sj[0].height, "41.2");
      await page.locator("#entryAthleteSelect").selectOption(firstId); await page.waitForFunction(id => App.getState().recordId === id, firstId); assert.deepEqual(subset(await current()), firstSnapshot);
    });
    await check("complete JSONL backup includes every FVP trial, exclusion, protocol, scenario and plot setting", async () => {
      await page.evaluate(() => App.entry("review")); await page.locator("#entryFinish").click(); await page.waitForFunction(() => App.getUIState().mode === "report"); expectedRecords = (await records()).map(subset).sort((a, b) => a.recordId.localeCompare(b.recordId));
      await page.evaluate(() => App.openManagement("backup")); const pending = page.waitForEvent("download"); await page.evaluate(() => App.downloadLibrary()); const download = await pending;
      backup = path.join(out, channel + "-full-backup.motionbench.jsonl"); await download.saveAs(backup); artifact(backup, "full-backup");
      const rows = fs.readFileSync(backup, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.deepEqual(rows.filter(row => row.type === "record").map(row => subset(row.value)).sort((a, b) => a.recordId.localeCompare(b.recordId)), expectedRecords);
    });
    await check("backup file restore through the product UI and subsequent refresh preserve both athletes and calculated FVP results", async () => {
      const isolated = await browser.newContext({offline:true, acceptDownloads:true}), restored = await isolated.newPage(); observe(restored);
      try {
        await restored.goto(pathToFileURL(file).href); await ready(restored); await restored.evaluate(() => App.openManagement("backup")); await restored.locator("#backupImportMode").selectOption("replace"); await restored.locator("#importFile").setInputFiles(backup);
        await restored.waitForFunction(() => App.getLibrary().athletes.reduce((n, athlete) => n + athlete.records.length, 0) === 2);
        const actual = await restored.evaluate(() => App.getRepository().values("records")); assert.deepEqual(actual.map(subset).sort((a, b) => a.recordId.localeCompare(b.recordId)), expectedRecords);
        const validity = await restored.evaluate(async () => (await App.getRepository().values("records")).flatMap(record => ["fvp_sj", "fvp_cmj"].map(id => RingsideFVP.solve(record, id).valid))); assert.deepEqual(validity, [true, true, true, true]);
        await restored.reload(); await ready(restored); assert.deepEqual((await restored.evaluate(() => App.getRepository().values("records"))).map(subset).sort((a, b) => a.recordId.localeCompare(b.recordId)), expectedRecords);
      } finally {await isolated.close();}
    });
    await check("the new FVP template downloads from the entry UI with separate stable athlete targets and complete raw/settings fields", async () => {
      await page.evaluate(() => App.showReport()); await start(people); const pending = page.waitForEvent("download"); await page.getByRole("button", {name:"下载 Excel 模板", exact:true}).click(); const download = await pending;
      const target = path.join(out, channel + "-new-fvp-template.xlsx"); await download.saveAs(target); artifact(target, "fvp-template"); const book = new ExcelJS.Workbook(); await book.xlsx.load(fs.readFileSync(target));
      const metadata = book.getWorksheet("本次测试"), mc = columns(metadata); excelTargets = Array.from({length:metadata.rowCount - 2}, (_, index) => ({recordId:metadata.getCell(index + 3, mc.recordId).value, athleteId:metadata.getCell(index + 3, mc.athleteId).value}));
      assert.deepEqual(excelTargets.map(value => value.athleteId).sort(), [...people].sort()); assert.ok(excelTargets.every(value => ![firstId, secondId].includes(value.recordId))); assert.equal((await records()).length, 2);
      const sheets = book.worksheets.filter(sheet => /SJ F|CMJ F/.test(sheet.name)); assert.equal(sheets.length, 2);
      for (const sheet of sheets) {
        const cc = columns(sheet); for (const key of ["load", "height", "distanceCm", "notes", "excluded", "exclusionReason"]) assert.ok(cc[key], key); assert.equal(sheet.rowCount - 2, 30);
        const cmj = /CMJ F/.test(sheet.name), firstRows = new Map();
        for (let row = 3; row <= sheet.rowCount; row++) {
          const recordId = sheet.getCell(row, cc.recordId).value; if (!firstRows.has(recordId)) firstRows.set(recordId, row);
          const index = row - firstRows.get(recordId); if (index > 3) continue; const second = recordId === excelTargets[1].recordId;
          sheet.getCell(row, cc.load).value = index === 3 ? 20 : index * 20;
          sheet.getCell(row, cc.height).value = index === 3 ? 99 : [cmj ? 46 : 38, cmj ? 36 : 29, cmj ? 27 : 21][index] + (second ? 3 : 0);
          sheet.getCell(row, cc.distanceCm).value = index === 1 ? (cmj ? 40 : 35) : null;
          sheet.getCell(row, cc.notes).value = 'Excel UI "完整原始值"'; sheet.getCell(row, cc.excluded).value = index === 3 ? "是" : "否"; sheet.getCell(row, cc.exclusionReason).value = index === 3 ? "Excel 动作不符" : "";
        }
      }
      const conditions = book.getWorksheet("测试条件"), cc = columns(conditions);
      for (let row = 3; row <= conditions.rowCount; row++) {
        const key = conditions.getCell(row, cc.fieldId).value, recordId = conditions.getCell(row, cc.recordId).value, cmj = key.includes("fvp_cmj"), second = recordId === excelTargets[1].recordId;
        const values = {device:"Excel 设备" + (second ? "乙" : "甲"), method:"腾空时间", posture:cmj ? "CMJ 固定下蹲深度" : "SJ 静止起始", distanceCm:cmj ? 41 : 36, distanceSource:"Excel 髋高差实测", angle:cmj ? 30 : 90, deltaForcePct:second ? -2 : 5, deltaVelocityPct:second ? 4 : -1, fv:"是", pv:"是", points:"是", optimum:"是", comparison:"否", confidence:"是", range:"实测范围", pinnedLoad:20};
        const last = key.split(".").at(-1); if (last in values) conditions.getCell(row, cc.value).value = values[last];
      }
      filled = Buffer.from(await book.xlsx.writeBuffer()); const edited = path.join(out, channel + "-filled-fvp-template.xlsx"); fs.writeFileSync(edited, filled); artifact(edited, "fvp-filled-template");
    });
    await check("FVP Excel upload, project preview and commit save both profiles without touching previous records", async () => {
      await page.getByRole("button", {name:"导入 Excel 文件", exact:true}).click(); await page.locator("#excelFile").setInputFiles({name:"FVP_测试录入.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer:filled}); await page.waitForFunction(() => !RingsideExcelFlow.isBusy());
      assert.equal(await page.locator("#excelConfirm").isDisabled(), false); assert.equal(await page.locator(".excel-preview-record").count(), 2); assert.match(await page.locator("#excelContent").innerText(), /SJ.*CMJ/s);
      await page.locator("#excelConfirm").click(); await page.getByText("导入完成：新建 2 条", {exact:false}).waitFor(); assert.equal((await records()).length, 4);
      const old = (await records()).filter(record => [firstId, secondId].includes(record.recordId)).map(subset).sort((a, b) => a.recordId.localeCompare(b.recordId)); assert.deepEqual(old, expectedRecords);
      for (const target of excelTargets) {
        const stored = await page.evaluate(id => App.getRepository().loadRecord(id), target.recordId); assert.equal(stored.athleteId, target.athleteId);
        for (const id of ["fvp_sj", "fvp_cmj"]) {assert.equal(stored.data[id].length, 4); assert.equal(stored.data[id][0].load, 0); assert.equal(stored.data[id][3].excluded, true); assert.equal(stored.data[id][3].exclusionReason, "Excel 动作不符"); assert.equal(stored.fvpConfig[id].distanceSource, "Excel 髋高差实测"); assert.equal(stored.fvpView[id].range, "measured"); assert.equal(stored.fvpView[id].pinnedLoad, 20);}
        assert.equal(stored.fvpAnalysis.fvp_sj.angle, 90); assert.equal(stored.fvpAnalysis.fvp_cmj.angle, 30);
      }
      await page.locator(`[data-excel-open-record="${excelTargets[0].recordId}"]`).click(); await page.waitForFunction(id => App.getState().recordId === id, excelTargets[0].recordId); assert.equal(await page.evaluate(() => RingsideFVP.solve(App.getState(), "fvp_cmj").valid), true);
      await page.reload(); await ready(page); assert.equal((await records()).length, 4); assert.equal((await current()).recordId, excelTargets[0].recordId);
      result.restoredRecords = expectedRecords.map(record => record.recordId); result.excelTargets = excelTargets; result.saveFailureRecoveries = 2;
    });
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []); result.pass = true;
  } catch (error) {
    result.failure = error.stack; process.exitCode = 1; console.error(error.stack);
    const target = path.join(out, channel + "-failure.png"); await page.screenshot({path:target, fullPage:true}).then(() => artifact(target, "failure"), () => {});
  } finally {
    result.sourceUnchanged = hash(file) === result.sourceHash; if (!result.sourceUnchanged) {result.pass = false; process.exitCode = 1;}
    fs.writeFileSync(path.join(out, channel + "-results.json"), JSON.stringify(result, null, 2)); await context.close(); await browser.close();
  }
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
