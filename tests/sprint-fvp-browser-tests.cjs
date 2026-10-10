"use strict";
// All records, browser storage, downloads and PDF pages in this suite are synthetic.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const ExcelJS = require("../vendor/exceljs.min.js");
const { manifest, columns, firstRow } = require("./helpers/excel-template.cjs");
const root = path.resolve(__dirname, ".."), source = path.join(root, "MotionBench.html");
const channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const entryOnly = process.argv.includes("--entry-only");
const outputName = process.argv.find(value => value.startsWith("--out="))?.slice(6);
if (outputName && !/^[a-zA-Z0-9-]+$/.test(outputName)) throw new Error("--out must name a directory within output/playwright");
const out = path.join(root, "output/playwright", outputName || (entryOnly ? "sprint-fvp-entry-smoke" : "sprint-fvp"));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { channel, sourceHash: hash(source), synthetic: true, checks: [], errors: [], network: [], artifacts: [], layouts: [], pass: false };
fs.mkdirSync(out, { recursive: true });
const subset = r => ({ raw:r.data.sprint_fvp, config:r.sprintFvpConfig, analysis:r.sprintFvpAnalysis,
  selections:r.views.capabilitySelections });
function legacyFixture() {
  const old = vm.createContext({ console, Intl, crypto:require("node:crypto").webcrypto }); old.window = old;
  for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "model", "evaluation", "interventions"])
    vm.runInContext(execFileSync("git", ["show", `rollback-v2.16.1-local-20261010:src/ringside-${name}.js`], { cwd:root, encoding:"utf8" }), old);
  const record = JSON.parse(JSON.stringify(old.RingsideModel.sampleRecord()));
  record.demo = false; record.recordId = "sprint-legacy-synthetic"; record.athleteId = "sprint-legacy-athlete";
  record.athlete.name = "旧记录兼容验收（合成）"; return record;
}
(async () => {
  const browser = await chromium.launch({ channel, headless:true });
  const context = await browser.newContext({ offline:true, acceptDownloads:true, viewport:{ width:1440, height:1000 }, reducedMotion:"reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const observe = p => { p.on("pageerror", e => result.errors.push(e.message)); p.on("dialog", d => d.accept());
    p.on("request", r => { if (/^https?:/.test(r.url())) result.network.push(r.url()); }); };
  observe(page);
  const ready = async p => { await p.waitForFunction(() => !!window.App?.ready); assert.equal(await p.evaluate(() => App.ready), true); };
  const check = async (name, run) => { await run(); result.checks.push(name); console.log("PASS", name); };
  const input = key => page.locator(`[data-path="${key}"]`);
  const solve = () => page.evaluate(() => RingsideSprintFVP.solve(App.getState()));
  const save = async () => assert.equal(await page.evaluate(() => App.saveNow()), true);
  const artifact = (file, kind) => { result.artifacts.push({ path:path.relative(root,file).replaceAll("\\","/"), sha256:hash(file), kind }); };
  const shot = async (name, locator) => { const file = path.join(out, `${channel}-${name}.png`);
    if (name !== "failure") await page.waitForFunction(() =>
      !document.body.hasAttribute("aria-busy") &&
      (!document.querySelector("#toast") || getComputedStyle(document.querySelector("#toast")).display === "none") &&
      !/正在|失败/.test(document.querySelector("#saveStatus")?.textContent || ""));
    if (name !== "failure") (result.stableScreenshots ||= []).push({name,...await page.evaluate(() => ({
      transferActive:document.body.hasAttribute("aria-busy"),toastDisplay:getComputedStyle(document.querySelector("#toast")).display,
      saveStatus:document.querySelector("#saveStatus")?.textContent || "" }))});
    const viewport = page.viewportSize();
    // Let the actual panel fit below fixed navigation instead of hiding UI.
    if (locator && /^(capability|sprint)-/.test(name)) {
      const box = await locator.boundingBox();
      await page.setViewportSize({ width:viewport.width, height:Math.max(viewport.height,Math.ceil(box.height)+150) });
      await locator.evaluate(node => window.scrollTo(0,node.getBoundingClientRect().top+scrollY-100));
    }
    try { if (locator) await locator.screenshot({ path:file, animations:"disabled" }); else await page.screenshot({ path:file, fullPage:true }); }
    finally { if (page.viewportSize().height !== viewport.height) await page.setViewportSize(viewport); }
    artifact(file,"screenshot"); };
  const download = async (name, trigger) => { const pending = page.waitForEvent("download", { timeout:240000 }); await trigger();
    const dl = await pending, file = path.join(out, `${channel}-${name}`); assert.equal(await dl.failure(), null); await dl.saveAs(file); artifact(file,"download"); return file; };
  let expected, rawTimes, measured, distance10, backup;
  try {
    await page.goto(pathToFileURL(source).href); await ready(page);
    await check("2.16.1 stored history keeps raw data and leaves the new sprint protocol disabled", async () => {
      const old = legacyFixture(); await page.evaluate(r => App.importPayload(RingsideModel.recordEnvelope(r)), old);
      const state = await page.evaluate(() => App.getState()); assert.equal(state.enabled.sprint_fvp,false);
      assert.deepEqual(state.data.cmj.map((row,i)=>Object.fromEntries(Object.keys(old.data.cmj[i]).map(key=>[key,row[key]]))),old.data.cmj);
      assert.deepEqual(state.data.sprint_fvp,[]);
      assert.equal(await page.evaluate(() => RingsideSprintFVP.solve(App.getState()).valid),false);
      await save(); await page.reload(); await ready(page); assert.equal(await page.evaluate(() => App.getState().enabled.sprint_fvp),false);
    });
    await check("manual sprint entry stores four cumulative split times and explicit atmosphere units", async () => {
      rawTimes = await page.evaluate(async () => {
        await App.importPayload(RingsideModel.libraryDefaults(),"replace-library");
        const r = RingsideModel.sampleRecord(); r.demo = false; r.recordId = "sprint-browser-synthetic"; r.athleteId = "sprint-browser-athlete";
        r.athlete.name = "冲刺与能力结构验收（合成数据）"; r.athlete.mass = 75; r.athlete.height = 180;
        r.enabled.sprint_fvp = true; r.data.sprint_fvp = [];
        for (const id of ["fvp_sj","fvp_cmj"]) {
          r.enabled[id] = true; r.fvpConfig[id].distanceCm = 33;
          r.data[id] = [0,20,40,60,80].map((load,i) => ({ id:`${id}-synthetic-${i}`,load,height:[33,27,22,14,10][i],notes:"合成跳跃试次",excluded:false,exclusionReason:"" }));
        }
        Object.assign(r.dsi,{ confirmed:true,source:"imtp",cmjDefinition:"gross",cmjUnit:"N" });
        r.impulseConfig.confirmed = true;
        r.data.cmj[0].propulsiveImpulse = 400; r.data.cmj[0].propulsiveDurationMs = 300;
        r.data.imtp[0].matchedImpulse = 600; r.data.imtp[0].matchedDurationMs = 300; r.data.imtp[0].impulse250 = 500;
        await App.importPayload(RingsideModel.recordEnvelope(r)); await App.openEntry("sprint_fvp"); App.addRow("sprint_fvp");
        return [5,10,20,30].map(x => RingsideSprintFVP.timeAtDistance(x,9,1.2));
      });
      await page.locator('[onclick="App.removeSprintSplit(0,4)"]').click();
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      for (const [i, distance] of [5,10,20,30].entries()) {
        await input(`data.sprint_fvp.0.splits.${i}.distanceM`).fill(String(distance));
        await input(`data.sprint_fvp.0.splits.${i}.timeS`).fill(String(rawTimes[i]));
      }
      await input("sprintFvpConfig.pressureHpa").fill("1013.25");
      await input("sprintFvpConfig.temperatureC").fill("20"); await input("sprintFvpConfig.windMps").fill("0");
      await save(); measured = await solve(); assert.equal(measured.valid,true); assert.ok(Math.abs(measured.fit.vmax-9)<1e-5);
      assert.ok(Math.abs(measured.fit.tau-1.2)<1e-5); assert.equal(measured.targetDistanceM,30);
      assert.equal(measured.config.timeCorrectionS,0); assert.ok(measured.model.RFmax>0&&measured.model.RFmax<1);
      assert.ok(measured.model.DRF<0); assert.ok(Number.isFinite(measured.model.Pmax));
      assert.equal(measured.window.stepS,.1); assert.equal(measured.window.rfAfterS,.3);
      const feedback = await page.locator('[data-sprint-fvp-entry-feedback]').innerText();
      assert.ok(feedback.includes(measured.model.F0.toFixed(2)),"entry F0 feedback must show calculated numeric output");
      assert.ok(feedback.includes(measured.model.Pmax.toFixed(2)),"entry Pmax feedback must show calculated numeric output");
    });
    await check("interval/cumulative mode and fixed correction preserve original inputs without hidden time offsets", async () => {
      await input("sprintFvpConfig.inputTimeMode").selectOption("interval");
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      const intervals = rawTimes.map((t,i) => t-(rawTimes[i-1]||0));
      for (const [i,time] of intervals.entries()) await input(`data.sprint_fvp.0.splits.${i}.timeS`).fill(String(time));
      await save(); let s = await solve(); assert.equal(s.valid,true); assert.ok(Math.abs(s.model.Pmax-measured.model.Pmax)<1e-6);
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      await input("sprintFvpConfig.timeCorrectionS").fill("0.1"); await save(); s = await solve();
      assert.ok(Math.abs(s.points[3].timeS-rawTimes[3]-.1)<1e-9);
      assert.deepEqual((await page.evaluate(() => App.getState().data.sprint_fvp[0].splits.map(x=>Number(x.timeS)))),intervals);
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      await input("sprintFvpConfig.timeCorrectionS").fill("0");
      await input("sprintFvpConfig.inputTimeMode").selectOption("cumulative");
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      for (const [i,time] of rawTimes.entries()) await input(`data.sprint_fvp.0.splits.${i}.timeS`).fill(String(time));
      await save();
    });
    await check("explicit negative start-signal correction restores motion time while keeping every original timestamp", async () => {
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      await input("sprintFvpConfig.timingStart").selectOption("start_signal");
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      await input("sprintFvpConfig.timeCorrectionS").fill("-0.15");
      for (const [i,time] of rawTimes.entries()) await input(`data.sprint_fvp.0.splits.${i}.timeS`).fill(String(time+.15));
      await save(); const corrected = await solve(); assert.equal(corrected.valid,true); assert.ok(Math.abs(corrected.fit.vmax-9)<1e-5);
      assert.deepEqual(await page.evaluate(()=>App.getState().data.sprint_fvp[0].splits.map(x=>Number(x.timeS))),rawTimes.map(t=>t+.15));
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      await input("sprintFvpConfig.timingStart").selectOption("first_propulsive_action");
      await page.locator('.sprint-fvp-entry details.supplement').evaluate(node=>node.open=true);
      await input("sprintFvpConfig.timeCorrectionS").fill("0");
      for (const [i,time] of rawTimes.entries()) await input(`data.sprint_fvp.0.splits.${i}.timeS`).fill(String(time));
      await save();
    });
    await check("split addition, removal and undo keep original split order, raw values and fit", async () => {
      const before = await page.evaluate(()=>App.getState().data.sprint_fvp[0].splits);
      await page.locator('[onclick="App.removeSprintSplit(0,1)"]').click();
      assert.equal(await page.evaluate(()=>App.getState().data.sprint_fvp[0].splits.length),3);
      await page.locator('[onclick="App.undoDelete()"]').click();
      assert.deepEqual(await page.evaluate(()=>App.getState().data.sprint_fvp[0].splits),before);
      await page.locator('[onclick="App.addSprintSplit(0)"]').click();
      assert.equal(await page.evaluate(()=>App.getState().data.sprint_fvp[0].splits.length),5);
      await page.locator('[onclick="App.removeSprintSplit(0,4)"]').click(); await save();
      assert.deepEqual(await page.evaluate(()=>App.getState().data.sprint_fvp[0].splits),before);
      assert.equal((await solve()).valid,true); await page.evaluate(()=>App.showReport());
    });
    if (entryOnly) { assert.deepEqual(result.errors,[]); result.pass=true; return; }
    await check("target distance updates optimum, chart and speed assessment together while measured FVP stays fixed", async () => {
      const before = await solve(); assert.equal(before.optimal.valid,true);
      const rfRow = page.locator('.sprint-fvp-result-table tbody tr').filter({hasText:"RF max"});
      assert.ok((await rfRow.locator("td").nth(1).innerText()).includes((before.model.RFmax*100).toFixed(1)),"RF max is converted from a ratio only once");
      const drfRow = page.locator('.sprint-fvp-result-table tbody tr').filter({hasText:"DRF"});
      assert.ok((await drfRow.locator("td").nth(1).innerText()).includes(before.model.DRF.toFixed(3)),"DRF retains percentage-point units and negative sign");
      await page.locator("[data-sprint-target-distance]").fill("10"); await page.locator("[data-sprint-target-form]").evaluate(form=>form.requestSubmit());
      await page.waitForFunction(() => Number(App.getState().sprintFvpAnalysis.targetDistanceM)===10);
      distance10 = await solve(); assert.equal(distance10.targetDistanceM,10); assert.equal(distance10.model.Pmax,before.model.Pmax);
      assert.notEqual(distance10.optimal.slope,before.optimal.slope); assert.notEqual(distance10.imbalance.profilePct,before.imbalance.profilePct);
      const chart = await page.locator('[data-chart-kind="sprintFvp"]').getAttribute("data-chart-input"); assert.ok(chart.includes("10"));
      assert.ok(!/NaN|Infinity/.test(await page.locator('[data-chart-kind="sprintFvp"] svg').innerHTML()));
      await save(); await page.reload(); await ready(page); await page.evaluate(() => App.showReport());
      assert.equal(Number(await page.locator("[data-sprint-target-distance]").inputValue()),10);
      assert.equal((await solve()).optimal.slope,distance10.optimal.slope);
      await page.locator("[data-sprint-target-follow]").click(); assert.equal((await solve()).targetDistanceM,30);
      await page.locator("[data-sprint-target-distance]").fill("10"); await page.locator("[data-sprint-target-form]").evaluate(form=>form.requestSubmit()); await save();
    });
    await check("four direction cards use one selected metric each and keep every parameter in category tables", async () => {
      const cards = page.locator("[data-capability-direction]"); assert.deepEqual(await cards.evaluateAll(ns=>ns.map(n=>n.dataset.capabilityDirection)),["strength","reactive","speed","endurance"]);
      const strength = page.locator('[data-capability-selection="strength"]');
      assert.deepEqual(await strength.locator("option").evaluateAll(ns=>ns.map(n=>n.value)),["fvp","fdsi","idsi_matched","idsi_fixed250","eur"]);
      for (const value of ["fvp","fdsi","idsi_matched","idsi_fixed250","eur"]) {
        await strength.selectOption(value); assert.equal(await page.locator('[data-capability-direction="strength"] [data-direction-metric]').count(),1);
        assert.equal(await page.locator('[data-capability-direction="strength"] [data-direction-metric]').getAttribute("data-direction-metric"),value);
        const expectedValue = await page.evaluate(id => {
          const s = App.stats();
          return id === "fvp" ? s.fvp[App.getState().views.fvpProtocol || "fvp_sj"].imbalance.magnitudePct
            : s.derived.results.find(result=>result.id===id)?.value;
        },value);
        assert.ok(Number.isFinite(expectedValue),`fixture must have valid ${value}`);
        const shown = await page.locator('[data-capability-direction="strength"] .capability-direction-value').innerText();
        assert.ok(shown.includes(expectedValue.toFixed(value==="fvp"?2:3)),`${value} card must show its model value`);
      }
      for (const id of ["dj_rsi","hop_rsi","cmrj_rsi"]) {
        await page.locator('[data-capability-selection="reactive"]').selectOption(id);
        const expectedValue = await page.evaluate(key=>App.stats().values[key],id);
        assert.ok(Number.isFinite(expectedValue));
        assert.ok((await page.locator('[data-capability-direction="reactive"] .capability-direction-value').innerText()).includes(expectedValue.toFixed(3)));
      }
      for (const id of ["sprint_fvp","srr"]) {
        await page.locator('[data-capability-selection="speed"]').selectOption(id);
        const expectedValue = await page.evaluate(key=>key==="sprint_fvp"?App.stats().sprintFvp.imbalance.magnitudePct:App.stats().derived.results.find(r=>r.id===key).value,id);
        assert.ok((await page.locator('[data-capability-direction="speed"] .capability-direction-value').innerText()).includes(expectedValue.toFixed(id==="sprint_fvp"?2:3)));
      }
      await strength.selectOption("idsi_fixed250"); await page.locator('[data-capability-selection="reactive"]').selectOption("dj_rsi");
      await page.locator('[data-capability-selection="speed"]').selectOption("sprint_fvp");
      assert.equal(await page.locator('[data-capability-direction="endurance"] select').count(),0);
      for (const id of ["fdsi","eur","idsi_matched","idsi_fixed250","dj_rsi","srr"])
        assert.equal(await page.locator(`[data-capability-metric="${id}"]`).count(),1,id);
      await save(); expected = subset(await page.evaluate(() => App.getState())); await page.reload(); await ready(page); await page.evaluate(() => App.showReport());
      assert.equal(await strength.inputValue(),"idsi_fixed250"); assert.equal(await page.locator('[data-capability-selection="speed"]').inputValue(),"sprint_fvp");
      result.saved = expected;
    });
    await check("desktop and narrow report/entry render without page overflow or duplicate direction judgments", async () => {
      for (const width of [1440,900,390]) {
        await page.setViewportSize({ width,height:1000 }); await page.evaluate(() => App.showReport());
        const layout = await page.evaluate(() => ({ width:innerWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,
          cards:[...document.querySelectorAll('[data-capability-direction]')].map(n=>({ id:n.dataset.capabilityDirection,metricCount:n.querySelectorAll('[data-direction-metric]').length,judgments:n.querySelectorAll('.capability-direction-judgment').length,
            marginTop:getComputedStyle(n.querySelector('section')).marginTop,marginBottom:getComputedStyle(n.querySelector('section')).marginBottom })),
          parameterColumnWidth:document.querySelector('.capability-parameter-column').getBoundingClientRect().width,
          parameterGridColumns:getComputedStyle(document.querySelector('.capability-parameter-groups')).gridTemplateColumns.split(' ').length,
          parameterRowGap:getComputedStyle(document.querySelector('.capability-parameter-groups')).rowGap,
          parameterGroups:[...document.querySelectorAll('.capability-parameter-group')].map(n=>({id:n.dataset.capabilityCard,height:n.getBoundingClientRect().height,marginTop:getComputedStyle(n).marginTop,marginBottom:getComputedStyle(n).marginBottom})) }));
        result.layouts.push(layout); assert.equal(layout.pageOverflow,false); assert.ok(layout.cards.every(c=>c.metricCount===1&&c.judgments===1));
        assert.ok(layout.cards.every(c=>c.marginTop==="0px"&&c.marginBottom==="0px"));
        assert.ok(layout.parameterGroups.every(c=>c.marginTop==="0px"&&c.marginBottom==="0px"));
        assert.equal(layout.parameterGridColumns,layout.parameterColumnWidth>=500?2:1);
        await shot(`report-${width}`,page.locator("#trainingAnalysisDetail"));
        if (width===1440||width===390) {
          await shot(`capability-${width}`,page.locator("[data-capability-analysis]"));
          await shot(`sprint-${width}`,page.locator("[data-sprint-fvp-panel]"));
        }
        await page.evaluate(() => App.openEntry("sprint_fvp")); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth+1),false);
        await shot(`entry-${width}`);
      }
      await page.setViewportSize({width:1440,height:1000}); await page.evaluate(() => App.showReport());
    });
    await check("downloaded JSON and full JSONL restore raw timing, methods, target and card selections in fresh storage", async () => {
      const json = await download("record.json",()=>page.evaluate(()=>App.downloadJSON()));
      assert.deepEqual(subset(JSON.parse(fs.readFileSync(json,"utf8")).record),expected);
      backup = await download("backup.motionbench.jsonl",()=>page.evaluate(()=>App.downloadLibrary()));
      const rows = fs.readFileSync(backup,"utf8").trim().split(/\r?\n/).map(JSON.parse);
      assert.deepEqual(subset(rows.find(r=>r.type==="record").value),expected);
      for (const file of [json,backup]) {
        const restored = await browser.newContext({offline:true,acceptDownloads:true}), p = await restored.newPage(); observe(p);
        try { await p.goto(pathToFileURL(source).href); await ready(p); await p.evaluate(()=>App.openManagement("backup"));
          await p.locator("#backupImportMode").selectOption("replace"); await p.locator("#importFile").setInputFiles(file);
          await p.waitForFunction(()=>App.getState().recordId==="sprint-browser-synthetic"); await p.reload(); await ready(p);
          assert.deepEqual(subset(await p.evaluate(()=>App.getState())),expected); assert.equal(await p.evaluate(()=>RingsideSprintFVP.solve(App.getState()).valid),true);
        } finally { await restored.close(); }
      }
    });
    await check("actual editable HTML opens offline with the same sprint profile and capability selections", async () => {
      const file = await download("report.html",()=>page.evaluate(()=>App.downloadHTML()));
      const restored = await browser.newContext({offline:true}), p = await restored.newPage(); observe(p);
      try { await p.goto(pathToFileURL(file).href); await ready(p); await p.evaluate(()=>App.showReport());
        assert.deepEqual(subset(await p.evaluate(()=>App.getState())),expected);
        assert.equal(await p.locator('[data-capability-selection="strength"]').inputValue(),"idsi_fixed250");
        assert.equal(await p.locator('[data-chart-kind="sprintFvp"]').count(),1);
      } finally { await restored.close(); }
    });
    await check("Excel template and UI replacement roundtrip include sprint splits/config and preserve unrelated projects", async () => {
      await page.evaluate(() => App.openEntry("sprint_fvp"));
      const template = await download("template.xlsx",()=>page.getByRole("button",{name:"下载 Excel 模板",exact:true}).click());
      const book = new ExcelJS.Workbook(); await book.xlsx.load(fs.readFileSync(template)); const info = manifest(book);
      const spec = info.sheets.find(s=>s.testId==="sprint_fvp"&&s.kind!=="custom"); assert.ok(spec,"sprint sheet is present");
      const ws = book.getWorksheet(spec.name), cc = columns(ws), row = firstRow(ws);
      assert.ok(cc.distanceM&&cc.timeS,"Excel has split distance and time units");
      const original = Number(ws.getCell(row,cc.timeS).value); assert.ok(original>0);
      ws.getCell(row,cc.timeS).value = original+.001;
      const filled = Buffer.from(await book.xlsx.writeBuffer()), file = path.join(out,`${channel}-filled.xlsx`); fs.writeFileSync(file,filled); artifact(file,"edited-synthetic-template");
      const unrelated = await page.evaluate(()=>JSON.stringify(App.getState().data.cmj));
      await page.getByRole("button",{name:"导入 Excel 文件",exact:true}).click(); await page.locator("#excelFile").setInputFiles(file);
      await page.waitForFunction(()=>!RingsideExcelFlow.isBusy()); assert.equal(await page.locator("#excelConfirm").isDisabled(),false);
      await page.locator('[data-excel-project="sprint_fvp"]').selectOption("replace"); await page.locator("#excelConfirm").click(); await page.locator("#excelModal").waitFor({state:"hidden"});
      assert.equal(Number(await page.evaluate(()=>App.getState().data.sprint_fvp[0].splits[0].timeS)),original+.001);
      assert.equal(await page.evaluate(()=>JSON.stringify(App.getState().data.cmj)),unrelated);
      await page.reload(); await ready(page); assert.equal(Number(await page.evaluate(()=>App.getState().sprintFvpAnalysis.targetDistanceM)),10);
      assert.equal(await page.evaluate(()=>RingsideSprintFVP.solve(App.getState()).valid),true); await page.evaluate(()=>App.showReport());
    });
    if (process.argv.includes("--pdf")) await check("real PDF export preserves selected values, direction judgments and sprint charts without pagination loss or overflow", async () => {
      const screenCards = await page.locator("[data-capability-direction]").evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.capabilityDirection,
        value:n.querySelector('.capability-direction-value')?.innerText,judgment:n.querySelector('.capability-direction-judgment')?.innerText})));
      await page.evaluate(() => {
        window.__sprintPdfPages = []; window.__sprintOriginalCanvas = html2canvas;
        window.html2canvas = async (node,options) => {
          const content = node.querySelector(".ringside-pdf-content"), box = content.getBoundingClientRect();
          window.__sprintPdfPages.push({ text:node.innerText,charts:[...node.querySelectorAll("[data-chart-kind]")].map(n=>n.dataset.chartKind),
            directionCards:[...node.querySelectorAll("[data-capability-direction]")].map(n=>n.dataset.capabilityDirection),
            directionValues:[...node.querySelectorAll("[data-capability-direction]")].map(n=>({id:n.dataset.capabilityDirection,
              value:n.querySelector('.capability-direction-value')?.innerText,judgment:n.querySelector('.capability-direction-judgment')?.innerText})),
            rows:[...node.querySelectorAll("tr[data-row-id]")].map(n=>n.dataset.rowId),
            overflow:[...content.children].filter(n=>n.getBoundingClientRect().bottom>box.bottom+.8).map(n=>n.className) });
          return window.__sprintOriginalCanvas(node,options);
        };
      });
      const before = await page.evaluate(()=>JSON.stringify(App.getState()));
      await page.locator("#reportExportMenu").evaluate(n=>n.open=true);
      const file = await download("report.pdf",()=>page.locator("#reportExportMenu [data-pdf-action]").click());
      const captured = await page.evaluate(() => { html2canvas = __sprintOriginalCanvas; return { pages:__sprintPdfPages,diagnostics:RingsidePDF.lastDiagnostics,state:JSON.stringify(App.getState()) }; });
      assert.equal(captured.state,before); assert.equal(captured.diagnostics.status,"complete");
      for (const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"]) assert.deepEqual(captured.diagnostics[key],[],key);
      assert.ok(captured.diagnostics.textChecks.every(text=>text.exact),"every preserved heading and paragraph must match its source text");
      assert.ok(captured.pages.every(p=>!p.overflow.length)); assert.equal(captured.pages.flatMap(p=>p.charts).filter(kind=>kind==="sprintFvp").length,1);
      assert.deepEqual(captured.pages.flatMap(p=>p.directionCards),["strength","reactive","speed","endurance"]);
      assert.deepEqual(captured.pages.flatMap(p=>p.directionValues),screenCards);
      const cardioPage = captured.pages.findIndex(p=>p.text.includes("心肺与阈值参数"));
      assert.ok(cardioPage>=0 && captured.pages[cardioPage].text.includes("VO₂peak"),"cardio heading and first data row must share a page");
      const sprintRawTitle = "冲刺 FVP · 原始录入分段";
      const sprintRawPages = captured.pages.map((p,i)=>p.text.includes(sprintRawTitle)?i+1:null).filter(Boolean);
      assert.equal(sprintRawPages.length,1,"raw sprint appendix needs one independent visible title");
      assert.ok(fs.statSync(file).size>15000); result.pdf = { path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file),pages:captured.pages,diagnostics:captured.diagnostics,
        layoutAssertions:{cardioHeadingWithFirstRowPage:cardioPage+1,sprintRawTitlePages:sprintRawPages,allTextChecksExact:true} };
    });
    assert.deepEqual(result.errors,[]); assert.deepEqual(result.network,[]); result.pass = true;
  } catch (error) {
    result.failure = error.stack; process.exitCode = 1; console.error(error.stack); await shot("failure").catch(()=>{});
  } finally {
    result.sourceUnchanged = hash(source)===result.sourceHash;
    if (!result.sourceUnchanged) { result.pass=false; process.exitCode=1; }
    fs.writeFileSync(path.join(out,`${channel}-results.json`),JSON.stringify(result,null,2)); await context.close(); await browser.close();
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
