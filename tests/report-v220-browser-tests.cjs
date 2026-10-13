"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), source = path.join(root, "MotionBench.html"), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const artifactIndex = process.argv.indexOf("--artifact-dir"), out = path.resolve(root, artifactIndex >= 0 ? process.argv[artifactIndex + 1] : "output/implementation-2.20.0/report");
const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex"); fs.mkdirSync(out, { recursive: true });
const result = { sourceHash: digest(source), runnerSha256: digest(__filename), channel, synthetic: true, checks: [], errors: [], network: [], artifacts: [], pdfs: [] };
(async () => {
  const browser = await chromium.launch({ channel, headless: true }), contexts = [];
  const open = async file => {
    const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("dialog", dialog => dialog.accept()); page.on("pageerror", error => result.errors.push(error.message)); page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
    await page.goto(pathToFileURL(file).href); await page.evaluate(() => App.ready); return page;
  };
  const artifact = (file, kind) => result.artifacts.push({ path: path.relative(root, file).replaceAll("\\", "/"), sha256: digest(file), kind });
  const check = async (name, run) => { await run(); result.checks.push(name); console.log("PASS " + name); };
  const project = page => page.evaluate(() => ({ axes: App.stats().axes.map(axis => ({ key: axis.key, value: axis.value, status: axis.status, method: axis.method, members: axis.members, scores: axis.scores, transforms: axis.transforms, scoreUnit: axis.scoreUnit, scoreMax: axis.scoreMax })), facts: App.facts().capabilities, narrative: App.getState().narrative.text,
    reference: App.stats().evaluationResults.filter(item => item.kind === "iso" || item.kind === "balance") }));
  let page;
  try {
    page = await open(source);
    await page.evaluate(async () => {
      const r = RingsideModel.defaults(); r.demo = false; r.athlete.name = "Synthetic scoring and heading check"; r.athlete.age = 25; r.athlete.sex = "男"; r.athlete.mass = 70; r.athlete.dominantHand = "右";
      Object.keys(r.enabled).forEach(id => r.enabled[id] = ["cmj", "sj", "dj", "mss", "mas", "cpet", "iso"].includes(id));
      r.data.cmj = [{ id: "c", height: 40 }]; r.data.sj = [{ id: "s", height: 30 }]; r.data.dj = [{ id: "d", height: 30, contactTimeMs: 200, flightTimeMs: 400, dropHeightCm: 40 }]; r.data.mss.speed = 9; r.data.mas.speed = 5; r.data.cpet.vo2 = 50; r.data.cpet.rer = 1.2;
      r.narrative.text = "本次人工正文完整保留。"; r.views.capabilitySelections = { strength: "eur", reactive: "dj_rsi", speed: "srr" };
      const p = RingsideEvaluation.create(r, "Synthetic unified scoring scheme");
      p.aggregations = { "ability:下肢爆发力": { method: "primary", primary: "metric:cmj_height", scoringVersion: 1, transforms: { "metric:cmj_height": { kind: "anchors", shape: "higher", points: [{ value: 0, score: 0 }, { value: 80, score: 100 }] } } } };
      Object.assign(p.standards.find(rule => rule.metricId === "cmj_height"), { enabled: true, targetEnabled: true, target: 50, rangesEnabled: true, ranges: [{ min: 0, max: null, label: "Synthetic original grade", status: "green" }] });
      Object.assign(p.standards.find(rule => rule.metricId === "sj_height"), { enabled: true, targetEnabled: true, target: 60, rangesEnabled: false, ranges: [] });
      const iso = p.standards.find(rule => rule.kind === "iso" && rule.reference), row = r.data.iso.find(row => row.id === iso.directionId); row.left = 10; row.right = 10; r.isoDirectionIds = [row.id];
      await App.importPayload(RingsideModel.recordEnvelope(r, p), "replace-library"); await App.showReport(false);
    });
    let primary;
    await check("primary explicit points remain fifty in the overview and AI facts with calculation details removed", async () => {
      primary = await project(page); assert.equal(primary.axes.length, 1); assert.equal(primary.axes[0].value, 50); assert.equal(primary.axes[0].status, "green"); assert.equal(primary.axes[0].scoreUnit, "分"); assert.equal(primary.axes[0].scoreMax, 100);
      assert.equal(primary.facts[0].score, 50); assert.equal(primary.facts[0].scoreUnit, "分"); assert.deepEqual(primary.facts[0].scoreRange, [0, 100]);
      assert.match(await page.locator('.ability-comparison').innerText(), /50 分 \/ 100/);
      assert.equal(await page.locator('.ability-score-details,#abilityScoreDetails,[data-ability-score]').count(), 0);
      assert.equal(await page.getByText('查看能力评分的计算', { exact: true }).count(), 0);
      assert.equal(primary.narrative, "本次人工正文完整保留。");
    });
    await check("capability h3 uses the normal heading width font colors while cards follow h4 and normal result panels", async () => {
      const style = await page.evaluate(() => {
        const region = document.querySelector('[data-capability-region]'), normal = document.querySelector('.details-group .quality-heading');
        const props = node => { const s = getComputedStyle(node), rect = node.getBoundingClientRect(); return { tag: node.tagName, font: s.fontSize, color: s.color, background: s.backgroundColor, padding: s.padding, radius: s.borderRadius, shadow: s.boxShadow, width: rect.width }; };
        return { heading: props(region.querySelector('.quality-heading')), h3: props(region.querySelector('.quality-heading h3')), normal: props(normal), normalH3: props(normal.querySelector('h3')), card: props(region.querySelector('.capability-direction-card')), normalCard: props(document.querySelector('.test-block')), cardTitle: props(region.querySelector('.capability-card-summary h4')), normalTitle: props(document.querySelector('.test-title h4')), headingCount: region.querySelectorAll('h3').length };
      });
      assert.equal(style.headingCount, 1); assert.equal(style.h3.tag, "H3"); assert.equal(style.h3.font, "16px"); assert.equal(style.h3.color, "rgb(69, 84, 106)"); assert.equal(style.heading.background, "rgb(247, 249, 252)");
      for (const key of ["font", "color"]) assert.equal(style.h3[key], style.normalH3[key], key); assert.ok(Math.abs(style.heading.width - style.normal.width) <= 2.1);
      for (const key of ["padding", "radius", "shadow", "background"]) assert.equal(style.card[key], style.normalCard[key], key); assert.equal(style.cardTitle.tag, "H4"); assert.equal(style.cardTitle.font, style.normalTitle.font);
      result.headingEvidence = style;
    });
    await check("desktop and mobile retain the independent card grids and parameter folds without horizontal page overflow", async () => {
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await page.locator('[data-capability-region]').scrollIntoViewIfNeeded();
        const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, count: document.querySelector('.capability-direction-grid').dataset.capabilityCount, columns: getComputedStyle(document.querySelector('.capability-direction-grid')).gridTemplateColumns.split(' ').length, folds: [...document.querySelectorAll('details[data-capability-parameters]')].map(node => ({ id: node.dataset.capabilityParameters, open: node.open })) }));
        assert.equal(state.overflow, false); assert.equal(state.count, "4"); assert.equal(state.columns, width === 390 ? 1 : 2); assert.ok(state.folds.every(item => !item.open));
        const file = path.join(out, channel + "-report-" + width + ".png"); await page.screenshot({ path: file, fullPage: width === 390 }); artifact(file, "screenshot");
      }
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('details[data-capability-parameters="strength"] > summary').click();
      await page.waitForFunction(() => App.getState().views.capabilityExpanded.strength === true);
      await page.waitForFunction(async () => (await App.getRepository().loadRecord(App.getState().recordId)).views.capabilityExpanded.strength === true);
      assert.equal(await page.locator('details[data-capability-parameters="reactive"]').getAttribute('open'), null);
    });
    const download = async (kind, suffix) => {
      const event = page.waitForEvent("download", { timeout: 240000 }); await page.evaluate(kind => App["download" + kind](), kind); const dl = await event; assert.equal(await dl.failure(), null);
      const file = path.join(out, channel + "-" + suffix + "." + kind.toLowerCase()); await dl.saveAs(file); artifact(file, "download"); return file;
    };
    await check("JSON HTML and refresh preserve the shared primary conversion IDs raw records reference comparison and manual text", async () => {
      for (const kind of ["JSON", "HTML"]) {
        const file = await download(kind, "primary"); let restored;
        if (kind === "HTML") restored = await open(file); else { restored = await open(source); await restored.evaluate(async payload => { await App.importPayload(payload, "replace-library"); await App.showReport(false); }, JSON.parse(fs.readFileSync(file))); }
        assert.deepEqual(await project(restored), primary); assert.equal(await restored.locator('details[data-capability-parameters="strength"]').getAttribute('open'), ""); await restored.close();
      }
      await page.reload(); await page.evaluate(() => App.ready); assert.deepEqual(await project(page), primary); assert.equal(await page.locator('details[data-capability-parameters="strength"]').getAttribute('open'), "");
    });
    const pdf = async name => {
      if (!process.argv.includes("--pdf")) return;
      await page.evaluate(() => { window.__v220Pages = []; window.__v220Canvas = window.html2canvas; window.html2canvas = async (node, options) => { __v220Pages.push({ text: node.innerText, heading: [...node.querySelectorAll('.quality-heading h3')].map(h3 => ({ text: h3.textContent, color: getComputedStyle(h3).color, font: getComputedStyle(h3).fontSize })), parameterTables: [...node.querySelectorAll('[data-capability-parameter-table]')].map(node => node.dataset.capabilityParameterTable) }); return __v220Canvas(node, options); }; });
      const file = await download("PDF", name), evidence = await page.evaluate(() => { window.html2canvas = __v220Canvas; return { diagnostics: RingsidePDF.lastDiagnostics, pages: __v220Pages }; });
      assert.equal(evidence.diagnostics.status, "complete"); for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(evidence.diagnostics[key], []);
      const text = evidence.pages.map(page => page.text).join("\n"); assert.doesNotMatch(text, /查看能力评分的计算|平均贡献|固定成员等权平均/); assert.match(text, name === "primary" ? /50(?:\.0)? 分 \/ 100/ : /65(?:\.0)? 分 \/ 100/);
      result.pdfs.push({ file: path.relative(root, file).replaceAll("\\", "/"), sha256: digest(file), ...evidence });
      const tables = evidence.pages.flatMap(page => page.parameterTables); assert.ok(tables.includes("strength")); assert.equal(tables.includes("reactive"), false); assert.equal(tables.includes("speed"), false);
    };
    if (process.argv.includes("--pdf")) await check("actual primary PDF preserves points the common heading and only the live expanded parameter card", () => pdf("primary"));
    await check("changing to a fixed mean retains equal member contributions raw grades and unchanged literature comparisons", async () => {
      await page.evaluate(async () => {
        await App.commitLibraryChange(candidate => { const p = candidate.evaluationProfiles.find(item => item.id === App.getState().evaluationProfileId); p.aggregations["ability:下肢爆发力"] = { method: "mean", members: ["metric:cmj_height", "metric:sj_height"], transforms: { "metric:cmj_height": { kind: "ratio", direction: "higher" }, "metric:sj_height": { kind: "ratio", direction: "higher" } } }; p.revision++; }); await App.showReport(false);
      });
      const mean = await project(page); assert.equal(mean.axes[0].value, 65); assert.deepEqual(mean.axes[0].scores, [80, 50]); assert.equal(mean.axes[0].status, "gray"); assert.equal(mean.narrative, primary.narrative);
      assert.deepEqual(mean.reference.map(({ schemeRevision, ...item }) => item), primary.reference.map(({ schemeRevision, ...item }) => item));
      assert.match(await page.locator('.ability-comparison').innerText(), /65 分 \/ 100/);
      assert.equal(await page.locator('.ability-score-details,#abilityScoreDetails,[data-ability-score]').count(), 0);
    });
    if (process.argv.includes("--pdf")) await check("actual mean PDF retains the overview score and omits calculation details", () => pdf("mean"));
    await check("clearing the v2 capability configuration hides both axis and calculation details while retaining measurements", async () => {
      await page.evaluate(async () => { await App.commitLibraryChange(candidate => { candidate.evaluationProfiles.find(item => item.id === App.getState().evaluationProfileId).aggregations = {}; }); await App.showReport(false); });
      assert.equal((await project(page)).axes.length, 0); assert.equal(await page.locator('[data-ability-score]').count(), 0); assert.equal(await page.evaluate(() => App.getState().data.cmj[0].height), 40); assert.equal(await page.evaluate(() => App.getState().narrative.text), primary.narrative);
    });
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []);
  } catch (error) { result.failure = error.stack; console.error(error.stack); if (page) { const file = path.join(out, channel + "-failure.png"); await page.screenshot({ path: file, fullPage: true }).catch(() => {}); if (fs.existsSync(file)) artifact(file, "failure"); } }
  finally { result.sourceUnchanged = digest(source) === result.sourceHash; result.pass = !result.failure && !result.errors.length && !result.network.length && result.sourceUnchanged; fs.writeFileSync(path.join(out, channel + ".json"), JSON.stringify(result, null, 2)); await Promise.all(contexts.map(context => context.close())); await browser.close(); if (!result.pass) process.exitCode = 1; }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
