"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html"), out = path.join(root, "output/playwright/v2161-evaluation");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome", hash = () => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out, { recursive: true });
const result = { sourceHash: hash(), channel, synthetic: true, checks: [], observations: {}, artifacts: [], errors: [], network: [], pass: false };

(async () => {
  const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }), page = await context.newPage();
  page.setDefaultTimeout(15000); page.on("pageerror", error => result.errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
  const ready = async () => { await page.waitForFunction(() => !!App.ready); assert.equal(await page.evaluate(() => App.ready), true); }, check = async (name, fn) => { await fn(); result.checks.push(name); console.log("PASS " + name); };
  const click = (action, id) => page.locator(`[data-manager-action="${action}"]${id ? `[data-id="${id}"]` : ""}`).first().click();
  const reload = async () => { await page.reload(); await ready(); };
  const save = async () => { await click("profile-review"); await page.locator('#managementForm [type="submit"]').click(); await page.locator("#managementModal").waitFor({ state: "hidden" }); await reload(); };
  let ids, baseline;
  const editor = async tab => { await page.evaluate(() => App.openManagement("profiles")); await click("profile-edit", ids.profile); if (tab !== "definitions") await click("profile-tab", tab); };
  const snapshot = () => page.evaluate(() => {
    const r = App.effectiveRecord(), s = App.stats(), peak = r.definitions.find(d => d.id === "imtp_peak_force");
    return { peak: { value: s.values.imtp_peak_force, target: peak.target, ranges: peak.ranges, enabled: peak.referenceEnabled, evaluation: RingsideModel.evaluation(s.values.imtp_peak_force, peak, r), attainment: RingsideModel.attainment(s.values.imtp_peak_force, peak) },
      times: s.raw.forceTime.timeRows, axes: s.axes, rules: r.imtpTimeStandards, raw: App.getState().data, narrative: App.getState().narrative };
  });
  const assessment = id => page.locator(`.imtp-results tr[data-metric-id="${id}"] [data-label="评价"]`);
  const shoot = async (name, selector = "#profileEditorFields") => {
    const target = path.join(out, `${channel}-${name}.png`); await page.locator(selector).screenshot({ path: target });
    result.artifacts.push({ path: path.relative(root, target).replaceAll("\\", "/"), sha256: createHash("sha256").update(fs.readFileSync(target)).digest("hex") });
  };
  try {
    await page.goto(pathToFileURL(file).href); await ready();
    await check("persist an isolated synthetic measured record and a separate unchanged evaluation scheme", async () => {
      ids = await page.evaluate(async () => {
        const M = RingsideModel, E = RingsideEvaluation, r = M.defaults(); r.athlete.name = "评价开关合成验收"; r.athlete.mass = 70;
        Object.keys(r.enabled).forEach(id => r.enabled[id] = id === "imtp");
        r.definitions.forEach(d => Object.assign(d, { referenceEnabled: false, target: null, ranges: [] }));
        r.data.imtp = [{ id: "synthetic-trial", peakForce: 1000, baselineForce: "", timePoints: [{ id: "p100", timeMs: 100, force: 450, rfd: "" }, { id: "p250", timeMs: 250, force: 700, rfd: "" }] }];
        Object.assign(r.definitions.find(d => d.id === "imtp_f100"), { referenceEnabled: true, target: 400, ranges: Def.parseRanges("<400 | 预警 | red\n>=400 | 达标 | green"), source: "合成标准" });
        r.narrative = { html: "<p>保留教练手写建议</p>", text: "保留教练手写建议", origin: "手写", revision: 2 };
        const lib = E.migrate(M.recordEnvelope(r)), main = lib.athletes[0].records[0], p = lib.evaluationProfiles[0]; p.name = "本次编辑方案";
        const control = JSON.parse(JSON.stringify(main)), other = JSON.parse(JSON.stringify(p)); control.recordId = crypto.randomUUID(); other.id = crypto.randomUUID(); other.name = "独立对照方案"; control.evaluationProfileId = other.id;
        Object.assign(other.criteria.definitions.find(d => d.id === "imtp_peak_force"), { referenceEnabled: true, target: 2000, ranges: Def.parseRanges("<1500 | 预警 | red\n>=1500 | 达标 | green") });
        lib.athletes[0].records.push(control); lib.evaluationProfiles.push(other); await App.importPayload(lib, "replace-library");
        return { main: main.recordId, profile: p.id, control: control.recordId, controlProfile: other.id };
      });
      await reload(); assert.equal(await page.evaluate(() => App.getState().recordId), ids.main);
      baseline = await snapshot(); assert.equal(baseline.times.find(row => row.timeMs === 100).forceEvaluation.status, "green");
      result.observations.controlBefore = await page.evaluate(async ({ control, controlProfile }) => ({ record: await App.getRepository().loadRecord(control), profile: App.getLibrary().evaluationProfiles.find(p => p.id === controlProfile) }), ids);
    });
    await check("save peak target and intervals through real management fields and retain interval priority after refresh", async () => {
      await editor("definitions"); await page.locator("#profileMetricSelect").selectOption("imtp_peak_force");
      const text = await page.locator("#profileEditorFields").innerText(); assert.match(text, /参考目标（用于达成度）/); assert.match(text, /启用本指标评价/);
      const help = await page.locator("[data-evaluation-help]").innerText(); for (const term of ["区间为准", "达标不一定表示达到参考目标", "关闭本指标评价后", "不参与评级或能力达成计算"]) assert.ok(help.includes(term), term);
      await page.locator('[data-profile-path$=".target"]').fill("1500"); await page.locator('[data-profile-path$=".referenceEnabled"]').check();
      await page.locator("[data-profile-ranges]").fill("<900 | 预警 | red\n>=900 | 达标 | green"); await shoot("peak-editor"); await save();
      const s = await snapshot(); assert.equal(s.peak.value, 1000); assert.equal(s.peak.target, 1500); assert.equal(s.peak.evaluation.status, "green"); assert.ok(Math.abs(s.peak.attainment - 1000 / 1500 * 100) < 1e-8);
      assert.equal(s.axes.find(axis => axis.key === "最大力量").status, "green"); await page.evaluate(() => App.showReport()); assert.equal((await assessment("imtp_peak_force").innerText()).trim(), "达标");
      result.observations.enabledPeak = s.peak;
    });
    await check("create an arbitrary percentage time standard through management with both target and grade intervals", async () => {
      await editor("imtp"); await page.locator("#imtpStandardSelect").selectOption("force_pct_peak:250"); await click("profile-time-create", "force_pct_peak:250");
      assert.match(await page.locator("#profileEditorFields").innerText(), /参考目标 · %PF/); assert.match(await page.locator("[data-evaluation-help]").innerText(), /区间为准/);
      await page.locator('[data-profile-path$=".target"]').fill("90"); await page.locator('[data-profile-path$=".referenceEnabled"]').check(); await page.locator("[data-profile-ranges]").fill("<60 | 预警 | red\n>=60 | 达标 | green");
      await shoot("custom-time-editor"); await save(); const s = await snapshot(), row = s.times.find(row => row.timeMs === 250);
      assert.equal(row.force, 700); assert.equal(row.forcePercent, 70); assert.equal(row.forceStandard.target, 90); assert.equal(row.forceEvaluation.status, "green"); assert.equal(s.rules.find(rule => rule.timeMs === 250).ranges.length, 2);
      assert.equal(s.axes.some(axis => axis.defs.some(d => d.id === "imtp_f250")), false); await page.evaluate(() => App.showReport()); assert.equal((await assessment("imtp_f250").innerText()).trim(), "达标"); result.observations.enabledCustomTime = row;
    });
    await check("disabled peak and legacy time targets remain saved while report and ability axes become ungraded", async () => {
      await editor("definitions"); for (const id of ["imtp_peak_force", "imtp_f100"]) { await page.locator("#profileMetricSelect").selectOption(id); await page.locator('[data-profile-path$=".referenceEnabled"]').uncheck(); }
      await save(); const s = await snapshot(); assert.equal(s.peak.enabled, false); assert.equal(s.peak.target, 1500); assert.equal(s.peak.ranges.length, 2); assert.equal(s.peak.evaluation.status, "gray"); assert.equal(s.peak.attainment, null); assert.equal(s.axes.length, 0);
      const legacy = s.times.find(row => row.timeMs === 100); assert.equal(legacy.force, 450); assert.equal(legacy.forcePercent, 45); assert.equal(legacy.forceEvaluation.status, "gray");
      await page.evaluate(() => App.showReport()); for (const id of ["imtp_peak_force", "imtp_f100"]) { assert.equal(await assessment(id).locator(".pill.red,.pill.amber,.pill.green").count(), 0); assert.equal((await assessment(id).innerText()).trim(), "—"); }
      assert.equal((await assessment("imtp_f250").innerText()).trim(), "达标"); result.observations.disabledPeak = s.peak;
    });
    await check("disable the arbitrary time standard and refresh without losing raw force physical percent or either criterion", async () => {
      await editor("imtp"); await page.locator("#imtpStandardSelect").selectOption("force_pct_peak:250"); await page.locator('[data-profile-path$=".referenceEnabled"]').uncheck(); await save();
      const s = await snapshot(), row = s.times.find(row => row.timeMs === 250), saved = s.rules.find(rule => rule.timeMs === 250);
      assert.equal(row.force, 700); assert.equal(row.forcePercent, 70); assert.equal(row.forceEvaluation.status, "gray"); assert.equal(saved.referenceEnabled, false); assert.equal(saved.target, 90); assert.equal(saved.ranges.length, 2); assert.equal(s.axes.length, 0);
      assert.deepEqual(s.raw, baseline.raw); assert.deepEqual(s.narrative, baseline.narrative); await page.evaluate(() => App.showReport());
      const ungraded = assessment("imtp_f250"); if (await ungraded.count()) assert.equal((await ungraded.innerText()).trim(), "—");
      assert.equal(await page.locator(".imtp-results .pill.red,.imtp-results .pill.amber,.imtp-results .pill.green").count(), 0);
      assert.match(await page.locator('.imtp-results tr[data-metric-id="imtp_f250"] [data-label="结果"]').innerText(), /700.*70(?:\.0)?%/s);
      await shoot("disabled-report", "#detail-imtp"); result.observations.disabledCustomTime = row;
      await editor("imtp"); await page.locator("#imtpStandardSelect").selectOption("force_pct_peak:250"); assert.equal(await page.locator('[data-profile-path$=".target"]').inputValue(), "90"); assert.equal(await page.locator('[data-profile-path$=".referenceEnabled"]').isChecked(), false); assert.match(await page.locator("[data-profile-ranges]").inputValue(), /60/); await click("profile-close");
    });
    await check("re-enabling saved criteria restores the original grades and leaves the independent record and scheme untouched", async () => {
      await editor("definitions"); for (const id of ["imtp_peak_force", "imtp_f100"]) { await page.locator("#profileMetricSelect").selectOption(id); await page.locator('[data-profile-path$=".referenceEnabled"]').check(); } await save();
      await editor("imtp"); await page.locator("#imtpStandardSelect").selectOption("force_pct_peak:250"); await page.locator('[data-profile-path$=".referenceEnabled"]').check(); await save();
      const s = await snapshot(); assert.equal(s.peak.evaluation.status, "green"); assert.equal(s.times.find(row => row.timeMs === 100).forceEvaluation.status, "green"); assert.equal(s.times.find(row => row.timeMs === 250).forceEvaluation.status, "green"); assert.equal(s.axes.length, 2); assert.deepEqual(s.raw, baseline.raw); assert.deepEqual(s.narrative, baseline.narrative);
      result.observations.controlAfter = await page.evaluate(async ({ control, controlProfile }) => ({ record: await App.getRepository().loadRecord(control), profile: App.getLibrary().evaluationProfiles.find(p => p.id === controlProfile) }), ids);
      assert.deepEqual(result.observations.controlAfter, result.observations.controlBefore); await page.evaluate(() => App.showReport()); await shoot("restored-report", "#detail-imtp");
      assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []); assert.equal(hash(), result.sourceHash);
    });
    result.pass = true; console.log(result.checks.length + " evaluation UI checks passed");
  } catch (error) { result.failure = error.stack; result.failureContext = await page.evaluate(() => ({ mode: App.getUIState().mode, validTests: [...App.stats().validTests], detail: document.querySelector("#detailContent")?.innerText, imtp: document.querySelector("#detail-imtp")?.outerHTML })).catch(() => null); console.error(error.stack); process.exitCode = 1; await page.screenshot({ path: path.join(out, channel + "-failure.png") }).catch(() => {}); }
  finally { fs.writeFileSync(path.join(out, channel + "-results.json"), JSON.stringify(result, null, 2)); await context.close(); await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
