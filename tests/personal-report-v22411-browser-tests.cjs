"use strict";
// Synthetic offline profiles only. Never attach this runner to a user window.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url"), { execFileSync } = require("node:child_process");
const { chromium } = require("./helpers/playwright.cjs"), { createFixture } = require("./helpers/longitudinal-fixture.cjs");
const ROOT = path.resolve(__dirname, ".."), arg = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
const SOURCE = path.resolve(ROOT, arg("--source") || "MotionBench.html"), OUT = path.resolve(ROOT, arg("--artifact-dir") || "output/implementation-2.24.11/focused");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex"), channel = process.argv.includes("--edge") ? "msedge" : "chrome";

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sourceFiles = Object.fromEntries(fs.readdirSync(path.join(ROOT, "src")).filter(name => /\.(?:js|css)$/.test(name)).map(name => ["src/" + name, hash(path.join(ROOT, "src", name))]));
  const result = { synthetic: true, channel, sourceHash: hash(SOURCE), runnerSha256: hash(__filename), sourceFiles, startedAt: new Date().toISOString(), pass: false, checks: [], errors: [], artifacts: [] };
  const expected = arg("--expected-source-hash"); if (expected) assert.equal(result.sourceHash, expected);
  const receipt = path.join(OUT, "results.json"); if (fs.existsSync(receipt)) fs.copyFileSync(receipt, path.join(OUT, "results-before-" + Date.now() + ".json"));
  const browser = await chromium.launch({ channel, headless: true }), contexts = [];
  const artifact = file => result.artifacts.push({ file: path.relative(ROOT, file).replaceAll("\\", "/"), sha256: hash(file), bytes: fs.statSync(file).size });
  const open = async file => {
    const ctx = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" }); contexts.push(ctx);
    const page = await ctx.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", error => result.errors.push(error.stack || error.message)); page.on("dialog", dialog => dialog.accept());
    await page.goto(pathToFileURL(file).href); await page.waitForFunction(() => window.App?.ready); return page;
  };
  const check = async (name, run) => { result.stage = name; console.log("START " + name); await run(); result.checks.push(name); console.log("PASS " + name); };
  let page, ids, baseline;
  const settle = async () => { assert.equal(await page.evaluate(() => App.saveNow()), true); };
  const snapshot = async p => p.evaluate(async () => {
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map(v => v.toString(16).padStart(2, "0")).join("");
    const lib = await App.getRepository().exportLibrary(), records = structuredClone(lib.athletes);
    for (const athlete of records) for (const record of athlete.records) { delete record.views; delete record.fvpView; delete record.sprintFvpView; delete record.updated; }
    const state = App.getState(), stats = App.stats();
    return { records: await digest(records), shared: await digest({ catalog: lib.catalog, evaluationProfiles: lib.evaluationProfiles, groups: lib.groups, testPlans: lib.testPlans }),
      narratives: lib.athletes.flatMap(a => a.records.map(r => ({ id: r.recordId, narrative: r.narrative, previousNarrative: r.previousNarrative }))),
      calculated: await digest({ fvp: stats.fvp, sprint: stats.sprintFvp, iso: stats.isoAnalyses, values: stats.values, evaluations: stats.evaluationResults }),
      active: state.recordId, views: state.views, fvpView: state.fvpView, ui: App.getUIState(), longitudinal: !!App.getLongitudinal() };
  });
  const invariant = async () => { const now = await snapshot(page); assert.equal(now.records, baseline.records, "raw records, conditions, definitions and prose stay exact"); assert.equal(now.shared, baseline.shared); assert.deepEqual(now.narratives, baseline.narratives); return now; };
  const select = async id => { assert.equal(await page.evaluate(id => App.selectRecords([id]), id), true); await page.evaluate(() => App.showReport(false)); await settle(); };
  const activeProjection = p => p.evaluate(() => {
    const stored = App.getState(), r = RingsideEvaluation.materialize(stored, App.getLibrary().evaluationProfiles.find(p => p.id === stored.evaluationProfileId)), s = App.stats();
    return { data: r.data, enabled: r.enabled, protocol: r.protocol, thresholds: r.thresholds, fvpConfig: r.fvpConfig, fvpAnalysis: r.fvpAnalysis, sprintFvpConfig: r.sprintFvpConfig, sprintFvpAnalysis: r.sprintFvpAnalysis, narrative: r.narrative, fvpView: r.fvpView, capabilitySelections: r.views.capabilitySelections, capabilityExpanded: r.views.capabilityExpanded, values: s.values, fms: s.raw.fms, sources: r.definitions.map(d => ({ id: d.id, source: d.source || "", ranges: d.ranges, target: d.target, referenceEnabled: d.referenceEnabled })) };
  });
  const shot = async (name, selector) => { const file = path.join(OUT, name + ".png"); await (selector ? page.locator(selector) : page).screenshot({ path: file, fullPage: !selector }); artifact(file); };
  const download = async (kind, name) => { const event = page.waitForEvent("download", { timeout: 240000 }); event.catch(() => {}); await page.evaluate(kind => App["download" + kind](), kind); const dl = await event; assert.equal(await dl.failure(), null); const file = path.join(OUT, name + "." + kind.toLowerCase()); await dl.saveAs(file); artifact(file); return file; };
  const reveal = async selector => { await page.locator(selector).evaluate(node => { for (let p = node.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true; }); };
  const noMethod = async () => { assert.equal(await page.locator('[data-fvp-panel] > .fvp-method:not(.fvp-load-details)').count(), 0); assert.doesNotMatch(await page.locator('[data-fvp-panel]').first().innerText(), /测试条件、计算与来源/); };
  const uiProof = () => page.evaluate(() => { const storage = window.MotionBenchDesktop ? localStorage : sessionStorage; return { open: document.getElementById("capabilityDetail").open, ui: App.getUIState(), saved: Object.fromEntries(Object.keys(storage).filter(k => k.startsWith("ringside-ui-v1:")).map(k => [k, JSON.parse(storage.getItem(k))])) }; });
  try {
    page = await open(SOURCE);
    await check("three independent personal reports import with original FMS scores bilateral pain prose and reference schemes", async () => {
      ids = await page.evaluate(async factory => {
        const f = (0, eval)("(" + factory + ")")(window, 3), M = RingsideModel, E = RingsideEvaluation, D = Def, lib = M.libraryDefaults(), profiles = [];
        f.records.forEach((r, i) => {
          r.demo = false; r.athlete.name = "个人报告合成验收"; r.views.fvpProtocol = "fvp_sj";
          Object.keys(r.enabled).forEach(id => r.enabled[id] = ["fms", "mb", "lactate", "pushup", "cmj", "sj", "fvp_sj"].includes(id));
          r.enabled.sprint_fvp = false;
          r.data.fms.forEach((item, index) => Object.assign(item, { left: 3, right: 3, score: 3, pain: false, notes: "原始动作备注 " + index }));
          Object.assign(r.data.fms[0], { score: 1 }); Object.assign(r.data.fms[1], { left: 2, right: 3 }); Object.assign(r.data.fms[2], { left: 3, right: 3, pain: true });
          Object.assign(r.data.fms[3], { left: "", right: 3 }); Object.assign(r.data.fms[4], { left: 0, right: 3 });
          r.data.mb = [{ id: "ball-D-" + i, side: "D", distance: 11, notes: "原始投掷备注" }, ...(i === 1 ? [] : [{ id: "ball-ND-" + i, side: "ND", distance: 9, notes: "非优势侧原始备注" }])];
          r.data.pushup.reps = 70; r.thresholds.lt1 = 3.25; r.thresholds.lt2 = 4.25; r.thresholds.unit = "m/s";
          r.data.lactate = [{ speed: 2.5, lactate: 1.2, hr: 120 }, { speed: 3.5, lactate: 2.2, hr: 145 }, { speed: 4.5, lactate: 4.2, hr: 175 }];
          const gap = D.parseRanges("<3 | 低段 | red\n>=5 | 高段 | green"), custom = D.parseRanges("3..4 | 未分级 | gray");
          r.definitions.filter(d => d.testId === "lactate").forEach(d => Object.assign(d, { referenceEnabled: true, targetEnabled: true, target: d.id === "lt1" ? 3.25 : 4.25, ranges: i === 0 ? gap : d.id === "lt1" && i === 1 ? custom : [] }));
          Object.assign(r.definitions.find(d => d.id === "pushup_reps"), { referenceEnabled: true, ranges: D.parseRanges("<60 | 低段 | red\n>=80 | 高段 | green") });
          r.narrative = { text: "第 " + (i + 1) + " 期人工解读原文完整保留。", html: "<p>第 " + (i + 1) + " 期人工解读原文完整保留。</p>", origin: "manual", revision: 1, basis: M.fingerprint(r) };
          M.applyAge(r); const profile = E.create(r, "个人独立评价方案 " + i); profiles.push(profile); r.evaluationProfileId = profile.id;
        });
        lib.catalog = M.mergeCatalog(null, f.records[0]); lib.evaluationProfiles = profiles; lib.defaultEvaluationProfileId = profiles[0].id;
        lib.athletes = [{ id: f.athleteId, name: f.records[0].athlete.name, profile: M.profileFromRecord(f.records[0]), groupId: "", records: f.records, archived: false, deletedAt: null }]; lib.activeAthleteId = f.athleteId; lib.activeRecordId = f.records[0].recordId;
        await App.importPayload(lib, "replace-library"); await App.showReport(false); return f.records.map(r => r.recordId);
      }, createFixture.toString()); await settle(); baseline = await snapshot(page); assert.equal(ids.length, 3); assert.equal(baseline.longitudinal, false);
    });
    await check("FMS evaluation keeps the seven score rows while using only warning attention excellent and no missing grade", async () => {
      const cells = await page.locator('#detail-fms td[data-label="评价"]').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent.trim(), pill: n.querySelector(".pill")?.className })));
      assert.deepEqual(cells.map(c => c.text), ["关注", "关注", "预警", "—", "预警", "优秀", "优秀"]);
      assert.deepEqual(cells.map(c => c.pill?.split(" ")[1] || null), ["amber", "amber", "red", null, "red", "green", "green"]);
      const source = await page.evaluate(() => ({ scores: App.stats().raw.fms.scores, pain: App.getState().data.fms[2] })); assert.deepEqual(source.scores, [1, 2, 0, null, 0, 3, 3]); assert.equal(source.pain.left, 3); assert.equal(source.pain.right, 3);
      assert.match(await page.locator('#detail-fms tr').filter({ hasText: "直线弓步" }).innerText(), /3 \/ 3.*疼痛.*预警/s); await invariant();
      await reveal("#detail-fms"); await shot("desktop-fms", "#detail-fms");
    });
    await check("lactate grade gaps omit gray badges while both thresholds measured stages and configured targets remain", async () => {
      for (const id of ["lt1", "lt2"]) assert.equal(await page.locator(`#detail-lactate tr[data-metric-id="${id}"] .pill`).count(), 0);
      assert.match(await page.locator('#detail-lactate tr[data-metric-id="lt1"]').innerText(), /3\.25/); assert.match(await page.locator('#detail-lactate').innerText(), /1\.20.*120/s);
      assert.match(await page.locator('#detail-pushup tr[data-metric-id="pushup_reps"] .pill.gray').innerText(), /未分级/); await invariant();
      await reveal("#detail-lactate"); await shot("desktop-lactate", "#detail-lactate");
    });
    await check("two medicine-ball sides retain independent values grades and target comparisons in one desktop result table", async () => {
      await reveal("#detail-mb"); const data = await page.locator("#detail-mb tr[data-metric-id]").evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.metricId, text: n.textContent, labels: [...n.querySelectorAll("td")].map(td => td.dataset.label) })));
      assert.deepEqual(data.map(row => row.id), ["mb_dom", "mb_non"]); assert.ok(data.every(row => row.labels.includes("目标对照") && row.labels.includes("结果")));
      assert.match(data[0].text, /11\.00/); assert.match(data[1].text, /9\.00/); assert.equal(await page.locator("#detail-mb svg, #detail-mb .chart-wrap").count(), 0);
      result.twoSidedBall = data; await shot("desktop-medicine-ball", "#detail-mb"); await invariant();
    });
    await check("capability summary uses peer section geometry and internal headings follow the normal h3 h4 h5 hierarchy", async () => {
      await reveal("#capabilityDetail > summary");
      const styles = await page.evaluate(() => {
        const select = selector => document.querySelector(selector), props = node => { const s = getComputedStyle(node), b = node.getBoundingClientRect(); return { tag: node.tagName, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, padding: s.padding, background: s.backgroundColor, width: b.width }; };
        const region = select("#capabilityDetail"), peer = [...document.querySelectorAll("#reportView .details-group")].find(n => n !== region);
        return { summary: props(region.querySelector(":scope > summary")), peer: props(peer.querySelector(":scope > summary")), h3: props(region.querySelector(".quality-heading h3")), otherH3: props(select(".details-group:not(#capabilityDetail) .quality-heading h3")), h4: props(region.querySelector("h4")), otherH4: props(select(".test-title h4")), h5Tags: [...region.querySelectorAll(".capability-parameter-heading h5")].map(n => n.tagName), groups: [...region.querySelectorAll(":scope > .quality-group > .quality-heading h3")].map(n => n.textContent) };
      });
      for (const key of ["fontSize", "fontWeight", "color", "padding", "background"]) assert.equal(styles.summary[key], styles.peer[key], key);
      for (const key of ["fontSize", "fontWeight", "color"]) { assert.equal(styles.h3[key], styles.otherH3[key]); assert.equal(styles.h4[key], styles.otherH4[key]); }
      assert.ok(Math.abs(styles.summary.width - styles.peer.width) < 2); assert.deepEqual(styles.groups, ["发展方向", "力–速度剖面与弹性"]); assert.ok(styles.h5Tags.length); result.headings = styles; await invariant();
      await shot("desktop-capability-headings", '#capabilityDetail [data-capability-group="directions"]');
    });
    await check("personal jump FVP removes only the named method disclosure while retaining load points original trials and computed sources", async () => {
      await noMethod(); assert.ok(await page.locator('[data-fvp-panel="fvp_sj"] .fvp-load-details').count()); assert.ok(await page.locator('[data-fvp-panel="fvp_sj"] [data-raw-trials="fvp_sj"]').count());
      const facts = await page.evaluate(() => ({ current: App.stats().fvp.fvp_sj.current, config: App.getState().fvpConfig.fvp_sj })); assert.ok(facts.current.F0 > 0); assert.ok(facts.config.distanceCm > 0); result.fvpBefore = facts; await invariant();
    });
    await check("all three main disclosures persist across reload record switches and local FVP refresh without changing source records", async () => {
      const roots = ["screenDetail", "performanceDetail", "capabilityDetail"];
      for (const id of roots) await page.locator("#" + id + " > summary").evaluate(n => { if (n.parentElement.open) n.click(); });
      await page.waitForFunction(roots => roots.every(id => App.getUIState().detailOpen[id] === false), roots); await settle();
      result.collapseBeforeReload = await uiProof();
      await page.reload(); await page.waitForFunction(() => App.ready);
      result.collapseAfterReload = await uiProof();
      for (const id of roots) assert.equal(await page.locator("#" + id).getAttribute("open"), null);
      await select(ids[1]);
      const bFolds = { screenDetail: false, performanceDetail: true, capabilityDetail: true };
      for (const [id, open] of Object.entries(bFolds)) await page.locator("#" + id + " > summary").evaluate((n, open) => { if (n.parentElement.open !== open) n.click(); }, open);
      await page.waitForFunction(folds => Object.entries(folds).every(([id, open]) => App.getUIState().detailOpen[id] === open), bFolds); await settle();
      await select(ids[0]); for (const id of roots) assert.equal(await page.locator("#" + id).getAttribute("open"), null);
      await select(ids[1]); await page.reload(); await page.waitForFunction(() => App.ready);
      for (const [id, open] of Object.entries(bFolds)) assert.equal(await page.locator("#" + id).getAttribute("open"), open ? "" : null);
      await select(ids[0]); const before = await snapshot(page);
      await page.locator("#capabilityDetail > summary").click(); const toggle = page.locator('[data-fvp-panel="fvp_sj"] [data-fvp-view="pv"]'); await toggle.uncheck(); await settle(); assert.equal(await page.locator("#capabilityDetail").getAttribute("open"), "");
      assert.equal((await snapshot(page)).calculated, before.calculated); await toggle.check(); await settle(); await noMethod(); await invariant();
    });
    await check("a genuine custom gray lactate range remains visible and one medicine-ball side uses one measured result row", async () => {
      await select(ids[1]); assert.equal(await page.locator('#detail-lactate tr[data-metric-id="lt1"] .pill.gray').innerText(), "未分级"); assert.equal(await page.locator('#detail-lactate tr[data-metric-id="lt2"] .pill.green').count(), 1);
      await reveal("#detail-mb"); const data = await page.locator("#detail-mb tr[data-metric-id]").evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.metricId, text: n.textContent })));
      assert.deepEqual(data.map(row => row.id), ["mb_dom"]); assert.match(data[0].text, /11\.00/); assert.equal(await page.locator("#detail-mb svg").count(), 0);
      result.oneSidedBall = data; await shot("desktop-one-sided-ball", "#detail-mb"); await invariant();
    });
    await check("a target-only lactate standard retains its actual traffic grade and other personal gaps keep their prior display", async () => {
      await select(ids[2]); for (const id of ["lt1", "lt2"]) assert.equal(await page.locator(`#detail-lactate tr[data-metric-id="${id}"] .pill.green`).count(), 1);
      assert.equal(await page.locator('#detail-pushup tr[data-metric-id="pushup_reps"] .pill.gray').innerText(), "未分级"); await invariant();
    });
    await check("1440 and 390 pixel reports retain every result with no page overflow and single or double medicine-ball table rows", async () => {
      result.responsive = [];
      for (const id of [ids[0], ids[1]]) for (const width of [1440, 390]) {
        await select(id); await page.setViewportSize({ width, height: 1000 }); await reveal("#detail-mb"); await reveal("#detail-fms"); await reveal("#capabilityDetail > summary");
        await page.waitForTimeout(200); const geometry = await page.evaluate(() => { const table = document.querySelector("#detail-mb table"), wrap = table.parentElement; return { width: innerWidth, page: document.documentElement.scrollWidth, ball: { rows: table.querySelectorAll("tr[data-metric-id]").length, charts: document.querySelectorAll("#detail-mb svg").length, tableWidth: table.getBoundingClientRect().width, wrapWidth: wrap.getBoundingClientRect().width, scrollWidth: wrap.scrollWidth, overflowX: getComputedStyle(wrap).overflowX }, fmsRows: document.querySelectorAll('#detail-fms td[data-label="评价"]').length, group: getComputedStyle(document.querySelector(".capability-direction-grid")).gridTemplateColumns }; });
        assert.ok(geometry.page <= width + 1); assert.equal(geometry.ball.rows, id === ids[0] ? 2 : 1); assert.equal(geometry.ball.charts, 0); assert.ok(geometry.ball.wrapWidth <= width + 1);
        if (geometry.ball.tableWidth > geometry.ball.wrapWidth + 1) assert.ok(["auto", "scroll"].includes(geometry.ball.overflowX)); assert.equal(geometry.fmsRows, 7); result.responsive.push({ id, ...geometry });
        await shot((id === ids[0] ? "two-sided" : "one-sided") + "-" + width); await invariant();
      }
      await page.setViewportSize({ width: 1440, height: 1000 }); await select(ids[0]);
    });
    await check("JSON HTML report roundtrips preserve current data references prose and view controls while every source period remains unchanged", async () => {
      await page.locator("#capabilityDetail > summary").evaluate(n => { if (n.parentElement.open) n.click(); }); await page.waitForFunction(() => App.getUIState().detailOpen.capabilityDetail === false); await settle();
      const current = await activeProjection(page);
      for (const kind of ["JSON", "HTML"]) {
        const file = await download(kind, "personal-preserved"), restored = await open(kind === "HTML" ? file : SOURCE);
        if (kind === "JSON") { await restored.evaluate(async payload => { await App.importPayload(payload, "replace-library"); await App.showReport(false); }, JSON.parse(fs.readFileSync(file))); }
        assert.deepEqual(await activeProjection(restored), current); await restored.close();
      }
      assert.equal(await page.locator("#capabilityDetail").getAttribute("open"), null); await invariant();
    });
    await check("personal layout rules leave comparison chart geometry labels and period narratives unaffected", async () => {
      const personal = Object.fromEntries(Object.entries((await snapshot(page)).ui.records).map(([id, view]) => [id, view.detailOpen]));
      result.uiIsolationBefore = personal;
      assert.equal(await page.evaluate(ids => App.selectRecords(ids), ids.slice(0, 2)), true); await page.evaluate(() => App.showReport(false)); await settle();
      assert.equal(await page.locator("#capabilityDetail.capability-analysis-region").count(), 0); assert.equal(await page.locator("#capabilityDetail").count(), 1); assert.ok(await page.locator(".result-trend").count());
      const dims = await page.locator(".result-trend svg").evaluateAll(nodes => nodes.map(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })));
      assert.ok(dims.some(n => n.width > 0)); assert.ok(dims.filter(n => n.width > 0).every(n => n.width <= 160.5 && n.height <= 72.5));
      if (await page.locator("#performanceDetail > summary").count()) { await page.locator("#performanceDetail > summary").evaluate(n => { if (n.parentElement.open) n.click(); }); await page.waitForFunction(() => App.getLongitudinalDocument().views.detailOpen?.performanceDetail === false); await settle(); }
      result.uiIsolationInComparison = await page.evaluate(() => ({ ui: App.getUIState(), recordId: App.getState().recordId, owner: document.getElementById("reportView").dataset.longitudinalOwner, views: App.getLongitudinalDocument().views }));
      await invariant(); await select(ids[0]); result.uiIsolationAfter = (await snapshot(page)).ui.records; assert.deepEqual(Object.fromEntries(Object.entries(result.uiIsolationAfter).map(([id, view]) => [id, view.detailOpen])), personal); assert.equal(await page.locator("#capabilityDetail").getAttribute("open"), null);
    });
    if (!process.argv.includes("--skip-pdf")) await check("actual App PDF download keeps the focused personal sections complete within six pages while collapsed capability content prints", async () => {
      await page.locator("#capabilityDetail > summary").evaluate(n => { if (n.parentElement.open) n.click(); }); await page.waitForFunction(() => App.getUIState().detailOpen.capabilityDetail === false); await settle();
      await page.evaluate(() => {
        const actualBuild = RingsidePDF.build, actualPrint = RingsideReport.prepareFVPPrint, actualCanvas = html2canvas; window.__personalPDFRestore = () => { RingsidePDF.build = actualBuild; RingsideReport.prepareFVPPrint = actualPrint; window.html2canvas = actualCanvas; };
        window.__personalPDFCapture = [];
        const pruneModels = clone => { clone.querySelectorAll('[data-fvp-elasticity],[data-sprint-fvp-panel],[data-sprint-elasticity-panel],.fvp-load-details,.fvp-raw-trials').forEach(n => n.remove()); };
        RingsideReport.prepareFVPPrint = (clone, snapshot) => { actualPrint(clone, snapshot); pruneModels(clone); };
        RingsidePDF.build = (record, report, options) => {
          const kept = [...report.querySelectorAll('#detail-fms,#detail-mb,#detail-lactate,#capabilityDetail')].map(n => n.cloneNode(true)); report.replaceChildren(...kept); pruneModels(report); return actualBuild(record, report, options);
        };
        window.html2canvas = async (node, options) => { const body = node.querySelector('.ringside-pdf-content'), box = body.getBoundingClientRect(); __personalPDFCapture.push({ text: node.textContent, controls: node.querySelectorAll('button,input,select,textarea,.no-print').length, overflow: [...body.children].filter(n => n.getBoundingClientRect().bottom > box.bottom + .8).map(n => n.className), charts: node.querySelectorAll('img[data-pdf-chart]').length, cards: node.querySelectorAll('.capability-direction-card').length }); return actualCanvas(node, options); };
      });
      let file; try { file = await download("PDF", "personal-focused"); result.pdf = await page.evaluate(() => ({ diagnostics: RingsidePDF.lastDiagnostics, pages: __personalPDFCapture })); } finally { await page.evaluate(() => __personalPDFRestore()); }
      assert.equal(result.pdf.diagnostics.status, "complete"); assert.ok(result.pdf.diagnostics.pageCount >= 1 && result.pdf.diagnostics.pageCount <= 6);
      for (const key of ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"]) assert.deepEqual(result.pdf.diagnostics[key], []);
      const text = result.pdf.pages.map(p => p.text).join("\n"); for (const value of ["FMS", "药球", "乳酸", "能力结构分析", "发展方向", "力–速度剖面与弹性"]) assert.ok(text.includes(value), value); assert.doesNotMatch(text, /测试条件、计算与来源|未完成动作/);
      assert.ok(result.pdf.pages.reduce((a, p) => a + p.cards, 0)); for (const p of result.pdf.pages) { assert.equal(p.controls, 0); assert.deepEqual(p.overflow, []); }
      const renderer = "import sys,json;from pathlib import Path;import pymupdf; p=Path(sys.argv[1]);d=pymupdf.open(p);out=[]\nfor i,page in enumerate(d):\n f=p.parent/('personal-focused-page-%02d.png'%(i+1));page.get_pixmap(matrix=pymupdf.Matrix(1.35,1.35),alpha=False).save(str(f));out.append(str(f))\nprint(json.dumps(out))";
      const pages = JSON.parse(execFileSync("python", ["-c", renderer, file], { cwd: ROOT, encoding: "utf8" })); for (const png of pages) artifact(png); result.pdf.renderedPages = pages.map(p => path.relative(ROOT, p).replaceAll("\\", "/")); await invariant();
    });
    assert.ok(result.checks.length >= 10); assert.deepEqual(result.errors, []); assert.equal(hash(SOURCE), result.sourceHash); assert.equal(hash(__filename), result.runnerSha256);
    for (const [file, digest] of Object.entries(sourceFiles)) assert.equal(hash(path.join(ROOT, file)), digest);
    result.invariants = { before: { records: baseline.records, shared: baseline.shared, narratives: baseline.narratives }, after: await snapshot(page) }; result.pass = true;
  } catch (error) { result.errors.push(error.stack || String(error)); throw error; }
  finally { result.finishedAt = new Date().toISOString(); fs.writeFileSync(receipt, JSON.stringify(result, null, 2)); for (const ctx of contexts) await ctx.close(); await browser.close(); }
  console.log(result.checks.length + " personal report v2.24.11 browser checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
