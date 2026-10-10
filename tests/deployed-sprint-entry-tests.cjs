"use strict";
// Post-deployment smoke test. No user profile, real records, AI settings, or PDF.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {chromium} = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), url = "http://127.0.0.1:8765/MotionBench.html";
function option(name, fallback) {
  const equal = process.argv.find(arg => arg.startsWith(name + "=")); if (equal) return equal.slice(name.length + 1);
  const i = process.argv.indexOf(name); if (i < 0) return fallback;
  if (!process.argv[i + 1] || process.argv[i + 1].startsWith("--")) throw Error(name + " requires a value");
  return process.argv[i + 1];
}
const deployedFile = option("--deployed-file"), expectedHash = option("--expect-sha"), version = option("--version", "2.17.5-local");
assert.ok(deployedFile && path.isAbsolute(deployedFile), "--deployed-file must name the deployed absolute D: HTML path");
assert.equal(path.parse(deployedFile).root.toUpperCase(), "D:\\", "Only the explicitly deployed D: application file is permitted");
assert.equal(path.basename(deployedFile), "MotionBench.html"); assert.match(expectedHash || "", /^[0-9a-f]{64}$/);
assert.equal(version, "2.17.5-local");
const namespace = path.join(root, "output/deployment-2.17.5/browser"), out = path.resolve(root, option("--artifact-dir", namespace));
const relative = path.relative(namespace, out); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));
const resultFile = path.join(out, "chrome-results.json"); assert.ok(!fs.existsSync(resultFile), "Keep prior deployment evidence; use a fresh attempt directory");
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), hash = file => sha(fs.readFileSync(file));
const specFile = path.join(root, "tests/fixtures/sprint-display-spec.json"), spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
const fixtureFile = path.join(root, spec.baseFixture), fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
assert.equal(spec.synthetic, true); assert.equal(fixture.synthetic, true); assert.equal(hash(fixtureFile), spec.baseFixtureSha256);
const result = {synthetic:true, url, expectedVersion:version, expectedFileSha256:expectedHash, deployedFile,
  runnerSha256:hash(__filename), fixtureHashes:[{path:path.relative(root, specFile), sha256:hash(specFile)}, {path:spec.baseFixture, sha256:hash(fixtureFile)}],
  isolatedProfile:{newBrowserContext:true, persistentUserDataDir:false, storageStateImported:false, retainedAfterExit:false},
  aiSettings:"Startup status fulfilled with an empty synthetic configuration; no server credential access",
  startedAt:new Date().toISOString(), checks:[], failures:[], pageErrors:[], requests:[], blockedRequests:[], artifacts:[], pass:false};
fs.mkdirSync(out, {recursive:true});
const safeUrl = raw => {try {const u = new URL(raw); return u.origin + u.pathname;} catch {return "non-http-resource";}};
const safeError = error => String(error?.stack || error).replace(/("?token"?\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
const artifact = (file, kind) => result.artifacts.push({path:path.relative(root, file).replaceAll("\\", "/"), sha256:hash(file), bytes:fs.statSync(file).size, kind});
const copy = value => structuredClone(value);
function makeRecord() {
  const record = copy(fixture.library.athletes[0].records[0]);
  record.recordId = "deployed-sprint-entry-synthetic-record"; record.athleteId = "deployed-sprint-entry-synthetic-athlete";
  record.athlete.name = "Synthetic deployed sprint entry"; record.athlete.mass = spec.massKg; record.athlete.height = spec.heightCm; record.demo = false;
  record.sprintFvpVersion = 1; record.enabled.sprint_fvp = true; record.data.sprint_fvp = [];
  record.sprintFvpConfig = {heightCm:"", temperatureC:20, pressureHpa:1013.25, windMps:0, device:"Synthetic deployed entry",
    startConvention:"first_propulsive_action", timingStart:"first_propulsive_action", inputTimeMode:"cumulative", timeCorrectionS:0, positionStartM:0,
    methodVersion:"samozino-2016-splits-v1", sampleStepS:.1, rfAfterS:.3, samplingWindow:"terminal_time"};
  record.sprintFvpAnalysis = {targetDistanceM:""}; delete record.sprintFvpView;
  return record;
}

(async () => {
  let browser, context, page, sourceBytes;
  const check = async (name, run) => {await run(); result.checks.push(name); console.log("PASS " + name);};
  const ready = async () => {await page.waitForFunction(() => !!window.App?.ready); assert.equal(await page.evaluate(() => App.ready), true);};
  const save = async () => assert.equal(await page.evaluate(() => App.saveNow()), true);
  const state = () => page.evaluate(() => App.getState());
  const screenshot = async (name, selector) => {
    const locator = page.locator(selector), file = path.join(out, "chrome-" + name + ".png"), original = page.viewportSize();
    const box = await locator.boundingBox(); assert.ok(box && box.width > 0 && box.height > 0);
    await page.setViewportSize({width:original.width, height:Math.max(original.height, Math.ceil(box.height) + 180)});
    try {await locator.evaluate(node => scrollTo(0, scrollY + node.getBoundingClientRect().top - 90)); await locator.screenshot({path:file, animations:"disabled"});}
    finally {await page.setViewportSize(original);} artifact(file, "synthetic-deployed-screenshot");
  };
  try {
    await check("deployed D application file matches the approved build hash", async () => {
      sourceBytes = fs.readFileSync(deployedFile); result.deployedFileSha256 = sha(sourceBytes); result.deployedFileBytes = sourceBytes.length;
      assert.equal(result.deployedFileSha256, expectedHash);
    });
    browser = await chromium.launch({channel:"chrome", headless:true});
    context = await browser.newContext({acceptDownloads:false, viewport:{width:1440, height:1000}, reducedMotion:"reduce"});
    const initialStorage = await context.storageState(); assert.deepEqual(initialStorage, {cookies:[], origins:[]});
    await context.route("**/*", async route => {
      const request = route.request(), target = new URL(request.url());
      if (!["http:", "https:"].includes(target.protocol)) return route.continue();
      const sameOrigin = target.origin === "http://127.0.0.1:8765", requestInfo = {method:request.method(), url:safeUrl(request.url())};
      if (sameOrigin && target.pathname === "/MotionBench.html" && !target.search && request.method() === "GET") {
        result.requests.push({...requestInfo, disposition:"local-html"}); return route.continue();
      }
      if (sameOrigin && target.pathname === "/api/ai-settings" && request.method() === "POST" && request.postDataJSON()?.action === "status") {
        result.requests.push({...requestInfo, disposition:"synthetic-status-mock"});
        return route.fulfill({status:200, contentType:"application/json", body:JSON.stringify({base:"", model:"", hasKey:false, revision:"synthetic-0", state:"empty"})});
      }
      if (sameOrigin && target.pathname === "/favicon.ico" && request.method() === "GET")
        return route.fulfill({status:204, body:""});
      result.blockedRequests.push(requestInfo); return route.abort("blockedbyclient");
    });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", error => result.pageErrors.push(safeError(error)));
    page.on("dialog", dialog => dialog.accept()); page.on("download", () => result.failures.push({name:"unexpected-download", error:"Deployment smoke test must not download files"}));
    await check("local service serves the deployed source and App reaches the expected version", async () => {
      const response = await page.goto(url); assert.ok(response); assert.equal(response.status(), 200); assert.equal(response.url(), url);
      const served = await response.body(); result.servedHtmlSha256 = sha(served);
      // The local server injects only this bootstrap. Never write HTML or token to evidence.
      const rendered = served.toString("utf8"), bootstrap = /<script id="motionbench-local-bootstrap">[\s\S]*?<\/script>/g;
      result.localBootstrapCount = (rendered.match(bootstrap) || []).length; assert.ok(result.localBootstrapCount <= 1);
      const normalize = text => text.replace(/\r\n/g, "\n"), servedSource = normalize(rendered.replace(bootstrap, ""));
      result.servedSourceSha256 = sha(servedSource); result.deployedCanonicalSourceSha256 = sha(normalize(sourceBytes.toString("utf8")));
      assert.equal(result.servedSourceSha256, result.deployedCanonicalSourceSha256);
      await ready(); result.appReady = await page.evaluate(() => App.ready); result.buildVersion = await page.evaluate(() => RingsideBuild.version);
      assert.equal(result.appReady, true); assert.equal(result.buildVersion, version);
    });
    const record = makeRecord(), originalJump = {fvp_sj:copy(record.data.fvp_sj), fvp_cmj:copy(record.data.fvp_cmj)};
    await check("synthetic import uses fresh display defaults and the native project picker says sprint FVP", async () => {
      await page.evaluate(async record => {await App.importPayload(RingsideModel.recordEnvelope(record)); await App.showReport(false);}, record);
      const imported = await state(); assert.equal(imported.sprintFvpView.fv, true); assert.equal(imported.sprintFvpView.pv, true);
      assert.equal(imported.sprintFvpView.optimum, true); assert.equal(imported.sprintFvpView.confidence, false); assert.equal(Object.keys(imported.sprintFvpView.metrics).length, 11);
      assert.ok(Object.values(imported.sprintFvpView.metrics).every(value => value === true));
      await page.locator("#editButton").click(); await page.locator('[data-entry-tab="plan"]').click();
      const native = page.locator('[data-picker-project="sprint_fvp"]'); assert.equal(await native.getAttribute("aria-label"), "冲刺FVP");
      assert.equal(await native.isChecked(), true); result.nativeProjectLabel = await native.getAttribute("aria-label");
    });
    await check("actual entry navigation and the six point template create editable blank measurements", async () => {
      await page.locator('[data-entry-tab="sprint_fvp"]').click();
      assert.equal(await page.locator("#entryProjectTitle").innerText(), "冲刺FVP");
      await page.locator('[data-sprint-fvp-template="six"]').click();
      const before = await state(); assert.equal(before.data.sprint_fvp.length, 1);
      assert.deepEqual(before.data.sprint_fvp[0].splits.map(split => split.distanceM), [5, 10, 15, 20, 25, 30]);
      assert.ok(before.data.sprint_fvp[0].splits.every(split => split.timeS === ""));
      for (let i = 0; i < spec.splits.length; i++) {
        await page.locator(`[data-path="data.sprint_fvp.0.splits.${i}.distanceM"]`).fill(String(spec.splits[i].distanceM));
        await page.locator(`[data-path="data.sprint_fvp.0.splits.${i}.timeS"]`).fill(String(spec.splits[i].timeS));
      }
      await save(); result.enteredRaw = (await state()).data.sprint_fvp; result.entryMode = (await state()).sprintFvpConfig.inputTimeMode;
      assert.equal(result.entryMode, "cumulative"); assert.equal(await page.evaluate(() => RingsideSprintFVP.solve(App.getState()).valid), true);
      await screenshot("six-point-entry", "#entryContent");
    });
    await check("report entry renders the original three graph regions with real dimensions", async () => {
      await page.locator(".brand-home").click(); await page.waitForFunction(() => App.getUIState().mode === "report");
      result.regions = await page.locator("[data-capability-region] [data-chart-kind]").evaluateAll(nodes => nodes.filter(node => ["jumpFvp", "jumpElasticity", "sprintFvp"].includes(node.dataset.chartKind)).map(node => {
        const box = node.getBoundingClientRect(), svg = node.querySelector("svg"), svgBox = svg?.getBoundingClientRect();
        return {kind:node.dataset.chartKind, width:box.width, height:box.height, svgWidth:svgBox?.width || 0, svgHeight:svgBox?.height || 0,
          closedAncestor:!!node.closest("details:not([open])")};
      }));
      assert.deepEqual(result.regions.map(region => region.kind), ["jumpFvp", "jumpElasticity", "sprintFvp"]);
      assert.ok(result.regions.every(region => region.width > 100 && region.height > 100 && region.svgWidth > 100 && region.svgHeight > 100 && !region.closedAncestor));
      const current = await state(); assert.deepEqual({fvp_sj:current.data.fvp_sj, fvp_cmj:current.data.fvp_cmj}, originalJump);
    });
    await check("approximate confidence interval is available for the six measured splits", async () => {
      const before = await page.evaluate(() => RingsideSprintFVP.solve(App.getState()).model.F0);
      await page.locator('[data-sprint-fvp-view="confidence"]').check();
      result.confidence = await page.locator("[data-sprint-fvp-confidence-status]").evaluate(node => JSON.parse(node.dataset.sprintFvpConfidenceMeta));
      assert.equal(result.confidence.available, true, result.confidence.reason); assert.equal(result.confidence.n, 6); assert.equal(result.confidence.df, 4);
      assert.equal(result.confidence.version, spec.confidence.methodVersion); assert.equal(result.confidence.level, .95);
      assert.equal(result.confidence.currentCurveOnly, true); assert.equal(await page.locator("[data-sprint-fvp-confidence-band]").count(), 2);
      assert.equal(await page.evaluate(() => RingsideSprintFVP.solve(App.getState()).model.F0), before);
      await save(); await screenshot("three-regions-confidence", "[data-capability-region]");
    });
    await check("synthetic entry and confidence setting survive saving and reopening the local URL", async () => {
      await page.reload(); await ready(); await page.evaluate(() => App.showReport(false));
      const reopened = await state(); assert.equal(reopened.recordId, record.recordId); assert.deepEqual(reopened.data.sprint_fvp, result.enteredRaw);
      assert.equal(reopened.sprintFvpView.confidence, true); assert.equal(await page.locator("[data-sprint-fvp-confidence-band]").count(), 2);
      assert.equal(await page.evaluate(() => RingsideBuild.version), version);
      await screenshot("report-reopened", "[data-capability-region]");
    });
    await check("isolated deployment flow has no page errors or unauthorized requests", async () => {
      assert.deepEqual(result.pageErrors, []); assert.deepEqual(result.blockedRequests, []); assert.equal(result.failures.length, 0);
    });
  } catch (error) {result.failures.push({name:"deployment-flow", error:safeError(error)}); console.error(safeError(error));}
  finally {
    if (context) {await context.close(); result.isolatedContextClosed = true;}
    if (browser) {await browser.close(); result.browserClosed = true;}
    result.deployedFileSha256After = fs.existsSync(deployedFile) ? hash(deployedFile) : null;
    result.sourceUnchanged = result.deployedFileSha256After === expectedHash; result.finishedAt = new Date().toISOString();
    result.pass = result.checks.length === 8 && !result.failures.length && !result.pageErrors.length && !result.blockedRequests.length && result.sourceUnchanged;
    result.exitCode = result.pass ? 0 : 1; fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
    console.log(result.checks.length + " deployed sprint entry checks passed; pass=" + result.pass); if (!result.pass) process.exitCode = 1;
  }
})().catch(error => {console.error(safeError(error)); process.exitCode = 1;});
