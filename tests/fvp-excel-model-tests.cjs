"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
global.window = global; global.ExcelJS = require("../vendor/exceljs.min.js");
for (const name of ["calc", "cpet-reference", "definitions", "tests", "fvp", "model", "evaluation", "interventions", "excel", "entry-session", "fvp-entry"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"));
const M = RingsideModel, X = RingsideExcel, S = RingsideEntrySession, F = RingsideFVP, E = RingsideFVPEntry;
const copy = value => JSON.parse(JSON.stringify(value)), hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
let passed = 0;
async function test(name, run) { await run(); passed++; console.log("PASS " + name); }
function seed(ids = ["fvp_sj", "fvp_cmj"]) {
  const record = M.recordFromCatalog(M.normalizeCatalog(), {name:"FVP Excel 核验", sex:"男", sport:"拳击"}, Object.fromEntries(ids.map(id => [id, true])), "2026-10-09");
  record.evaluationProfileId = "evaluation_test"; record.athlete.mass = 75; record.athlete.height = 180; record.athlete.age = 26;
  return record;
}
const athlete = record => ({id:record.athleteId, name:record.athlete.name, profile:M.profileFromRecord(record), records:[]});
async function workbook(record, prefill = false) { const exported = await X.createTemplate({records:[record], prefill}), book = new ExcelJS.Workbook(); await book.xlsx.load(exported.bytes); return {book, exported}; }
const worksheet = (book, id, record) => {
  const name = RingsideTests.describe(record).find(test => test.id === id).name.replace(/[\\/*?:\[\]]/g, "_").slice(0, 23);
  return book.worksheets.find(sheet => /^\d{2}_/.test(sheet.name) && sheet.name.slice(3) === name);
};
const {column:col,manifest,firstRow}=require("./helpers/excel-template.cjs");
const set = (sheet, row, key, value) => sheet.getCell(row, col(sheet, key)).value = value;
function setting(book, key, value) { const sheet = book.getWorksheet("测试条件"); for (let row = 2; row <= sheet.rowCount; row++) if (sheet.getCell(row, col(sheet, "fieldId")).value === key) { set(sheet, row, "value", value); return; } throw Error("Missing setting " + key); }
const parse = book => book.xlsx.writeBuffer().then(bytes => X.readTemplate(bytes));
const preview = (parsed, record, existing = []) => X.preview(parsed, {athletes:[athlete(record)], records:existing, catalog:M.normalizeCatalog()});
const decisions = review => Object.fromEntries(review.entries.map(entry => [entry.recordId, {metadata:"replace", projects:Object.fromEntries(entry.projects.map(project => [project.id, "replace"]))}]));
const rawTrial = trial => Object.fromEntries(["load", "height", "distanceCm", "notes", "excluded", "exclusionReason"].map(key => [key, trial[key] ?? (key === "excluded" ? false : "")]));
function fill(record) {
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    const cmj = id === "fvp_cmj";
    record.fvpConfig[id] = {device:"测力台 A", method:cmj ? "起跳速度" : "腾空时间", posture:cmj ? "手叉腰，自选下蹲深度" : "手叉腰，静止 2 秒", distanceCm:cmj ? 40 : 35, distanceSource:"髋高差实测"};
    record.fvpAnalysis[id] = {angle:cmj ? 30 : 90, deltaForcePct:5, deltaVelocityPct:3};
    record.fvpView[id] = {fv:true, pv:true, points:true, optimum:true, comparison:cmj, confidence:cmj, range:"full", pinnedLoad:20,responseForce:!cmj,responseVelocity:cmj,responseBoth:true};
    const loads = cmj ? [0, 15, 30, 45] : [0, 20, 40, 60, 80], heights = cmj ? [45, 36, 28, 20] : [38, 28, 22, 17, 13];
    record.data[id] = loads.map((load, index) => ({id:id + "_native_" + index, load, height:heights[index], distanceCm:index === 2 ? (cmj ? 38 : 36) : "", notes:index === 0 ? '原始记录："自重" & 基线' : "", excluded:false, exclusionReason:""}));
    record.data[id].push({id:id + "_repeat", load:loads[1], height:heights[1] - 0.2, distanceCm:cmj ? 39 : 35.5, notes:"同负荷复测", excluded:false, exclusionReason:""});
    record.data[id].push({id:id + "_excluded", load:loads[1], height:99, distanceCm:cmj ? 40 : 35, notes:"保留原始异常试次", excluded:true, exclusionReason:"起跳动作不符"});
  }
  return record;
}
function verifyContract(actual, expected) {
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    assert.deepEqual(actual.data[id].map(rawTrial), expected.data[id].map(rawTrial));
    for (const key of ["fvpConfig", "fvpAnalysis", "fvpView"]) assert.deepEqual(actual[key][id], expected[key][id]);
    const before = F.solve(expected, id), after = F.solve(actual, id); assert.equal(before.valid, true); assert.equal(after.valid, true);
    for (const key of ["F0", "V0", "Pmax", "r2", "slope"]) assert.ok(Math.abs(before.fit[key] - after.fit[key]) < 1e-10, key);
    for (const key of ["Fe", "ve", "ER", "EN"]) assert.ok(Math.abs(before.elasticity[key] - after.elasticity[key]) < 1e-10, key);
    assert.equal(after.groups.find(group => group.load === expected.data[id][1].load).selectedHeightCm, expected.data[id][1].height);
  }
}
async function prepareNative(directory) {
  directory = path.resolve(directory); fs.mkdirSync(directory, {recursive:true});
  const blank = seed(["fvp_sj", "fvp_cmj", "cmj"]), expected = fill(copy(blank)); expected.data.cmj = [{id:"native_cmj", height:40.5, notes:"其他项目保留"}];
  const {book, exported} = await workbook(blank), input = path.join(directory, "FVP_Input.xlsx"), output = path.join(directory, "FVP_ExcelSaved.xlsx");
  fs.writeFileSync(input, Buffer.from(exported.bytes));
  const html = path.join(__dirname, "../MotionBench.html");
  const fixture = {input, output, expected, conditionsSheetName:"测试条件", sheetNames:Object.fromEntries(["fvp_sj", "fvp_cmj", "cmj"].map(id => [id, worksheet(book, id, blank).name])), moduleSha256:hash(path.join(__dirname, "../src/ringside-excel.js")), htmlSha256:fs.existsSync(html) ? hash(html) : null};
  fs.writeFileSync(path.join(directory, "fixture.json"), JSON.stringify(fixture, null, 2), "utf8");
  console.log("Native Excel fixture prepared: " + directory);
}
async function readNative(directory) {
  directory = path.resolve(directory); const fixture = JSON.parse(fs.readFileSync(path.join(directory, "fixture.json"), "utf8"));
  assert.equal(hash(path.join(__dirname, "../src/ringside-excel.js")), fixture.moduleSha256, "Excel module changed after native fixture preparation");
  const parsed = await X.readTemplate(fs.readFileSync(fixture.output)); assert.deepEqual(parsed.errors, []);
  const review = preview(parsed, fixture.expected), actual = X.apply(review, decisions(review)).records[0]; verifyContract(actual, fixture.expected);
  assert.equal(actual.data.cmj[0].height, 40.5); assert.equal(actual.data.cmj[0].notes, "其他项目保留");
  const evidence = {pass:true, checkedAt:new Date().toISOString(), check:"native Microsoft Excel open → populate → save → MotionBench parse/apply", excelModuleSha256:fixture.moduleSha256, sourceHash:fixture.htmlSha256, xlsxHash:hash(fixture.output), inputSha256:hash(fixture.input), rawTrialCounts:Object.fromEntries(["fvp_sj", "fvp_cmj"].map(id => [id, actual.data[id].length])), result:"passed"};
  fs.writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8"); console.log("PASS actual Microsoft Excel round trip, all FVP raw/config/analysis/view fields and calculations");
  fs.writeFileSync(path.join(directory, "fvp-readback-result.json"), JSON.stringify(evidence, null, 2), "utf8");
}
async function run() {
  await test("SJ and CMJ actual XLSX preserve raw trials, exclusions, protocol, analysis and view", async () => {
    const record = fill(seed()), {exported} = await workbook(record, true), parsed = await X.readTemplate(exported.bytes); assert.deepEqual(parsed.errors, []);
    const review = preview(parsed, record), actual = X.apply(review, decisions(review)).records[0]; verifyContract(actual, record);
  });
  await test("new template reserves thirty blank trials and accepts zero added load", async () => {
    const record = seed(), {book} = await workbook(record), sheet = worksheet(book, "fvp_sj", record); assert.equal(sheet.rowCount - 1, 30);
    setting(book, "fvpConfig.fvp_sj.distanceCm", 35);
    for (const [index, [load, height]] of [[0, 38], [20, 28], [40, 22]].entries()) {set(sheet, index + 2, "load", load); set(sheet, index + 2, "height", height);}
    const parsed = await parse(book); assert.deepEqual(parsed.errors, []); const actual = X.apply(preview(parsed, record)).records[0];
    assert.equal(actual.data.fvp_sj[0].load, 0); assert.equal(actual.data.fvp_sj.length, 3); assert.equal(F.solve(actual, "fvp_sj").valid, true);
  });
  await test("FVP protocol, display choices, distance and load without height do not create measurements", async () => {
    const record = seed(), {book} = await workbook(record), sheet = worksheet(book, "fvp_sj", record);
    setting(book, "fvpConfig.fvp_sj.distanceCm", 35); setting(book, "fvpConfig.fvp_sj.distanceSource", "估计"); setting(book, "fvpAnalysis.fvp_sj.deltaForcePct", 10);
    set(sheet, 2, "load", 0); set(sheet, 2, "distanceCm", 35); set(sheet, 2, "notes", "尚未测试"); set(sheet, 2, "excluded", "是"); set(sheet, 2, "exclusionReason", "尚未测试");
    const parsed = await parse(book); assert.deepEqual(parsed.errors, []); const review = preview(parsed, record);
    assert.equal(review.entries[0].projects.find(project => project.id === "fvp_sj").newCount, 0); assert.equal(X.apply(review).records.length, 0);
  });
  await test("FVP workbook validates numbers and angle options at their exact cells", async () => {
    const record = seed(), {book} = await workbook(record), sheet = worksheet(book, "fvp_sj", record);
    set(sheet, 2, "height", "三十八"); set(sheet, 3, "height", {formula:"20+8", result:28}); setting(book, "fvpAnalysis.fvp_sj.angle", 45);
    const parsed = await parse(book); assert.ok(parsed.errors.some(error => error.sheet === sheet.name && error.address === sheet.getCell(2, col(sheet, "height")).address && /有限数值/.test(error.message)));
    assert.ok(parsed.errors.some(error => error.sheet === sheet.name && error.address === sheet.getCell(3, col(sheet, "height")).address && /公式/.test(error.message)));
    assert.ok(parsed.errors.some(error => error.sheet === "测试条件" && error.address && /90 \/ 30/.test(error.message))); assert.throws(() => X.apply(preview(parsed, record)), /错误/);
  });
  await test("entry session ignores FVP setup but keeps actual zero/negative height drafts", () => {
    const record = seed(), session = S.create([record]), changed = copy(record); changed.fvpConfig.fvp_sj.distanceCm = 35; changed.fvpAnalysis.fvp_sj.deltaForcePct = 5;
    changed.data.fvp_sj = [{id:"pending", load:0, distanceCm:35, height:"", notes:"准备测试", excluded:true, exclusionReason:"准备测试"}]; assert.equal(S.hasManualData(session, changed), false);
    changed.data.fvp_sj[0].height = 0; assert.equal(S.hasManualData(session, changed), true); changed.data.fvp_sj[0].height = -1; assert.equal(S.hasManualData(session, changed), true);
    changed.data.fvp_sj[0].height = " "; assert.equal(S.hasManualData(session, changed), false);
  });
  await test("a legacy custom project named fvp_sj retains manual measurements and its workbook contract", async () => {
    const record = seed(["fvp_sj"]);
    record.customTests = [{id:"fvp_sj", name:"历史自定义项目", category:"performance", primaryAbility:"最大力量", legacyCustom:true}];
    record.projectSnapshots = record.projectSnapshots.map(test => test.id === "fvp_sj" ? {...test, legacyCustom:true} : test);
    record.definitions = record.definitions.filter(definition => definition.testId !== "fvp_sj");
    record.definitions.push({id:"legacy_fvp_measure", testId:"fvp_sj", name:"历史手录指标", unit:"N", ability:"最大力量", category:"performance", direction:"higher", target:null, referenceEnabled:false, ranges:[], entryScope:"attempt", legacyManual:true});
    record.data.fvp_sj = []; const session = S.create([record]); record.data.fvp_sj = [{id:"legacy_trial", metrics:{legacy_fvp_measure:42}, notes:"历史试次"}];
    assert.equal(RingsideTests.isNative(record, "fvp_sj"), false); assert.equal(S.hasManualData(session, record), true);
    const {book} = await workbook(record, true), sheet = worksheet(book, "fvp_sj", record);
    assert.equal(sheet.getCell(2, col(sheet, "metrics.legacy_fvp_measure")).value, 42);
    set(sheet, 2, "metrics.legacy_fvp_measure", 43);
    const parsed = await parse(book); assert.deepEqual(parsed.errors, []);
    const review = preview(parsed, record, [copy(record)]); assert.deepEqual(review.errors, []);
    const actual = X.apply(review, decisions(review)).records[0];
    assert.equal(actual.data.fvp_sj[0].metrics.legacy_fvp_measure, 43); assert.equal(actual.data.fvp_sj[0].notes, "历史试次");
  });
  await test("native entry uses shared form helpers, same-load repeat and reactive feedback", () => {
    const record = fill(seed()), helpers = {input:(key, value) => `<input data-path="${key}" value="${String(value).replace(/"/g, "&quot;")}">`, check:(key, value) => `<input type="checkbox" data-path="${key}" ${value ? "checked" : ""}>`, field:(label, control) => `<label>${label}${control}</label>`, table:(heads, rows) => `<table>${rows.flat().join("")}</table>`};
    const html = E.render(record, "fvp_sj", helpers); assert.ok(html.includes('data-path="fvpConfig.fvp_sj.distanceSource"')); assert.ok(html.includes('data-path="data.fvp_sj.6.exclusionReason"'));
    assert.ok(html.includes("App.addRow('fvp_sj',0)")); assert.ok(html.includes("App.removeRow('fvp_sj',0)")); assert.ok(html.includes("form-grid")); assert.ok(/R²/.test(html));
    assert.ok(/力量端|速度端|剖面均衡/.test(html)); let selection = null; const target = {innerHTML:""}; E.update(record, "fvp_sj", {querySelector:key => {selection = key; return target;}});
    assert.equal(selection, '[data-fvp-entry-feedback="fvp_sj"]'); assert.ok(target.innerHTML.includes("排除 1 次")); assert.equal(E.defaultTrial(0).load, 0);
  });
  console.log(passed + " FVP Excel/entry checks passed");
}
(async () => {
  const mode = process.argv[2]; if (mode === "--prepare-native") return prepareNative(process.argv[3]); if (mode === "--read-native") return readNative(process.argv[3]); return run();
})().catch(error => {console.error(error); process.exitCode = 1;});
