"use strict";
// Run separately against a frozen HTML. Every browser profile, database and
// imported JSONL file is synthetic; the production parser/store are unmodified.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process"), { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
function option(name, fallback) {
  const inline = process.argv.find(arg => arg.startsWith(name + "="));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw Error(name + " requires a value");
  return process.argv[index + 1];
}
const source = path.resolve(root, option("--source", "MotionBench.html"));
const artifactRoot = path.join(root, "output/playwright/split-id-import-2.17.2");
const out = path.resolve(root, option("--artifact-dir", "output/playwright/split-id-import-2.17.2/final"));
const relativeOutput = path.relative(artifactRoot, out);
if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) throw Error("Artifacts must stay within output/playwright/split-id-import-2.17.2");
const hash = value => createHash("sha256").update(value).digest("hex");
const sourceHash = hash(fs.readFileSync(source)), expectedHash = option("--expect-sha", sourceHash);
assert.match(expectedHash, /^[a-f0-9]{64}$/, "--expect-sha must identify the frozen HTML");
assert.equal(sourceHash, expectedHash, "Frozen HTML hash does not match");
fs.mkdirSync(out, { recursive: true });
const result = { channel, sourceHash, expectedSourceHash: expectedHash, sourceUnchanged: false, synthetic: true, realIndexedDB: false, pass: false,
  source: path.relative(root, source).replaceAll("\\", "/"), runnerSha256: hash(fs.readFileSync(__filename)),
  gitHeadAtRun: execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  startedAt: new Date().toISOString(), checks: [], errors: [], network: [], artifacts: [], scenarios: [] };
const relative = file => path.relative(root, file).replaceAll("\\", "/");
function artifact(name, value) {
  const file = path.join(out, channel + "-" + name);
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", "utf8");
  result.artifacts.push({ path: relative(file), sha256: hash(fs.readFileSync(file)), bytes: fs.statSync(file).size });
}
function evidence(snapshot) {
  return { database: snapshot.database, generation: snapshot.generation, active: snapshot.active, previous: snapshot.previous,
    tableCounts: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length])),
    generationCounts: snapshot.generationCounts, tablesSha256: hash(JSON.stringify(snapshot.tables)) };
}
function installFixtures() {
  const clone = value => JSON.parse(JSON.stringify(value));
  window.splitImportRecord = label => {
    const r = RingsideModel.defaults();
    Object.assign(r, { demo: false, recordId: "synthetic_split_record_" + label, athleteId: "synthetic_split_owner_" + label });
    Object.assign(r.athlete, { name: "Synthetic split import " + label, date: "2026-10-10", mass: 75, height: 180 });
    r.enabled.sprint_fvp = true;
    const times = [1.3735406501017202, 2.1031246565401025, 3.3485505747362385, 4.505234882806160, 5.633470563022033];
    r.data.sprint_fvp = [{ id: "synthetic_trial", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ id: "synthetic_split_" + i,
      distanceM, timeS: times[i], sourceMetadata: { synthetic: true, originalIndex: i } })),
      notes: "Synthetic raw timing", excluded: false, exclusionReason: "", sourceMetadata: { fixture: label } }];
    Object.assign(r.sprintFvpConfig, { heightCm: 180, temperatureC: 23, pressureHpa: 998, windMps: 0,
      device: "Synthetic timing gates", inputTimeMode: "cumulative", timingStart: "first_propulsive_action",
      timeCorrectionS: 0, positionStartM: 0, methodVersion: RingsideSprintFVP.METHOD_VERSION,
      sampleStepS: .1, rfAfterS: .3, samplingWindow: "terminal_time" });
    r.sprintFvpAnalysis.targetDistanceM = 20;
    return r;
  };
  window.splitImportLibrary = (labels, legacyLabels = []) => {
    const lib = RingsideEvaluation.migrate(RingsideModel.recordEnvelope(splitImportRecord(labels[0])));
    const owner = clone(lib.athletes[0]);
    for (const label of labels.slice(1)) {
      const record = RingsideModel.normalizeRecord(splitImportRecord(label)); record.evaluationProfileId = lib.defaultEvaluationProfileId;
      const next = clone(owner); next.id = record.athleteId; next.name = record.athlete.name; next.profile.name = record.athlete.name; next.records = [record];
      lib.athletes.push(next);
    }
    for (const a of lib.athletes) for (const r of a.records) if (legacyLabels.some(label => r.recordId === "synthetic_split_record_" + label))
      for (const trial of r.data.sprint_fvp) for (const split of trial.splits) delete split.id;
    lib.activeAthleteId = lib.athletes[0].id; lib.activeRecordId = lib.athletes[0].records[0].recordId;
    return lib;
  };
  window.splitImportText = async lib => {
    const rows = []; for await (const row of RingsideStore.libraryRows(lib)) rows.push(row);
    return rows.map(row => JSON.stringify(row)).join("\n") + "\n";
  };
  window.splitImportPayload = text => splitImportRepo.importRows(RingsideStore.fileRows(new File([text], "synthetic.motionbench.jsonl", { type: "application/x-ndjson" })));
  window.splitImportSnapshot = async () => {
    const repo = splitImportRepo, names = ["meta", "athletes", "records", "recordIndex", "groups", "profiles", "config"];
    const tx = repo.db.transaction(names, "readonly");
    const arrays = await Promise.all(names.map(name => new Promise((resolve, reject) => {
      const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    })));
    const tables = Object.fromEntries(names.map((name, i) => [name, arrays[i]]));
    const active = tables.meta.find(row => row.id === "active")?.value || "", previous = tables.meta.find(row => row.id === "previous")?.value || "";
    const generationCounts = Object.fromEntries([active, previous].filter(Boolean).map(generation => [generation,
      Object.fromEntries(names.filter(name => name !== "meta").map(name => [name, tables[name].filter(row => row.generation === generation).length]))]));
    return { database: repo.db.name, generation: repo.generation, active, previous, tables, generationCounts };
  };
}
(async () => {
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => result.errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) result.network.push(request.url()); });
  page.on("dialog", dialog => dialog.accept());
  const database = "/synthetic-split-id-import-" + channel + "-" + randomUUID();
  const check = async (name, run) => { const details = await run(); result.checks.push(name); if (details) result.scenarios.push({ name, ...details }); console.log("PASS " + name); };
  let oldExpected, oldRecordId, oldNormalized, mixedExpected;
  try {
    await page.goto(pathToFileURL(source).href); await page.waitForFunction(() => !!window.App?.ready && !!window.RingsideStore?.Repository);
    await page.evaluate(installFixtures);
    result.buildVersion = await page.evaluate(() => RingsideBuild.version);
    await check("native IndexedDB uses a dedicated synthetic database with two rollback generations", async () => {
      const outcome = await page.evaluate(async database => {
        window.splitImportRepo = await RingsideStore.Repository.open(database);
        await splitImportPayload(await splitImportText(splitImportLibrary(["base_previous"])));
        await splitImportPayload(await splitImportText(splitImportLibrary(["base_active"])));
        return { native: indexedDB instanceof IDBFactory && splitImportRepo.db instanceof IDBDatabase, snapshot: await splitImportSnapshot() };
      }, database);
      assert.equal(outcome.native, true); assert.equal(outcome.snapshot.database, "motionbench-v3:" + database);
      assert.ok(outcome.snapshot.active && outcome.snapshot.previous); assert.notEqual(outcome.snapshot.active, outcome.snapshot.previous);
      assert.equal(outcome.snapshot.generationCounts[outcome.snapshot.active].records, 1);
      assert.equal(outcome.snapshot.generationCounts[outcome.snapshot.previous].records, 1);
      result.realIndexedDB = true; return { storage: evidence(outcome.snapshot) };
    });
    await check("legacy JSONL without split IDs imports and loads exact raw timing and method metadata", async () => {
      const outcome = await page.evaluate(async () => {
        const lib = splitImportLibrary(["legacy"], ["legacy"]), expected = structuredClone(lib.athletes[0].records[0]), text = await splitImportText(lib);
        const parsed = []; for await (const row of RingsideStore.fileRows(new Blob([text]))) parsed.push(row);
        const imported = await splitImportPayload(text), loaded = await splitImportRepo.loadRecord(expected.recordId);
        return { expected, loaded, text, imported, parsedRecord: parsed.find(row => row.type === "record").value };
      });
      assert.equal(outcome.imported.added, 1); assert.deepEqual(outcome.parsedRecord, outcome.expected); assert.deepEqual(outcome.loaded, outcome.expected);
      assert.ok(outcome.loaded.data.sprint_fvp[0].splits.every(split => !Object.hasOwn(split, "id")));
      oldExpected = outcome.expected; oldRecordId = oldExpected.recordId;
      artifact("legacy.motionbench.jsonl", outcome.text); artifact("legacy-loaded.json", outcome.loaded);
      return { recordId: oldRecordId, imported: outcome.imported, rawSha256: hash(JSON.stringify(outcome.loaded)), methodVersion: outcome.loaded.sprintFvpConfig.methodVersion };
    });
    await check("legacy load normalizes stable unique IDs while preserving raw data, config and fitting", async () => {
      const outcome = await page.evaluate(async recordId => {
        const raw = await splitImportRepo.loadRecord(recordId), normalized = RingsideModel.normalizeRecord(structuredClone(raw));
        const again = RingsideModel.normalizeRecord(structuredClone(normalized)); RingsideModel.validateRecord(normalized);
        const withoutIds = structuredClone(normalized.data.sprint_fvp); for (const trial of withoutIds) for (const split of trial.splits) delete split.id;
        return { normalized, again, withoutIds, rawFit: RingsideSprintFVP.solve(raw), normalizedFit: RingsideSprintFVP.solve(normalized) };
      }, oldRecordId);
      const ids = outcome.normalized.data.sprint_fvp[0].splits.map(split => split.id);
      assert.equal(new Set(ids).size, ids.length); assert.ok(ids.every(id => /^[A-Za-z0-9_-]+$/.test(id)));
      assert.deepEqual(outcome.again.data.sprint_fvp, outcome.normalized.data.sprint_fvp);
      assert.deepEqual(outcome.withoutIds, oldExpected.data.sprint_fvp); assert.deepEqual(outcome.normalized.sprintFvpConfig, oldExpected.sprintFvpConfig);
      assert.deepEqual(outcome.normalized.sprintFvpAnalysis, oldExpected.sprintFvpAnalysis);
      assert.equal(outcome.rawFit.valid, true, outcome.rawFit.reason); assert.deepEqual(outcome.normalizedFit.fit, outcome.rawFit.fit); assert.deepEqual(outcome.normalizedFit.model, outcome.rawFit.model);
      oldNormalized = outcome.normalized; artifact("legacy-normalized.json", oldNormalized); return { stableIds: ids, fitUnchanged: true, rawAndMethodUnchanged: true };
    });
    await check("a reopened real IDB connection retains legacy raw data and regenerates the same normalized IDs", async () => {
      const loaded = await page.evaluate(async ({ database, recordId }) => {
        splitImportRepo.close(); window.splitImportRepo = await RingsideStore.Repository.open(database);
        const raw = await splitImportRepo.loadRecord(recordId); return { raw, normalized: RingsideModel.normalizeRecord(structuredClone(raw)) };
      }, { database, recordId: oldRecordId });
      assert.deepEqual(loaded.raw, oldExpected); assert.deepEqual(loaded.normalized.data.sprint_fvp, oldNormalized.data.sprint_fvp);
    });
    await check("mixed legacy and explicit-ID records import together through production JSONL validation", async () => {
      const outcome = await page.evaluate(async () => {
        const lib = splitImportLibrary(["mixed_old", "mixed_new"], ["mixed_old"]), text = await splitImportText(lib);
        const expected = lib.athletes.flatMap(a => a.records), imported = await splitImportPayload(text);
        const loaded = await Promise.all(expected.map(record => splitImportRepo.loadRecord(record.recordId)));
        return { text, expected, loaded, imported, snapshot: await splitImportSnapshot() };
      });
      assert.equal(outcome.imported.added, 2); assert.deepEqual(outcome.loaded, outcome.expected); mixedExpected = outcome.expected;
      assert.ok(outcome.loaded[0].data.sprint_fvp[0].splits.every(split => !Object.hasOwn(split, "id")));
      assert.ok(outcome.loaded[1].data.sprint_fvp[0].splits.every(split => typeof split.id === "string"));
      assert.equal(outcome.snapshot.generationCounts[outcome.snapshot.active].records, 2);
      artifact("mixed.motionbench.jsonl", outcome.text); return { imported: outcome.imported, storage: evidence(outcome.snapshot) };
    });
    for (const type of ["duplicate", "dotted"]) for (const merge of [false, true]) await check(`${type} explicit split ID is rejected during ${merge ? "merge" : "replacement"} without changing any stored generation`, async () => {
      const outcome = await page.evaluate(async ({ type, merge }) => {
        const lib = splitImportLibrary(["rejected_" + type]), splits = lib.athletes[0].records[0].data.sprint_fvp[0].splits;
        if (type === "duplicate") splits[1].id = splits[0].id; else splits[0].id = "invalid.split";
        const text = await splitImportText(lib), before = await splitImportSnapshot(); let accepted = false, error = "";
        try { await splitImportRepo.importRows(RingsideStore.fileRows(new Blob([text])), { merge }); accepted = true; } catch (failure) { error = failure.message; }
        return { text, before, after: await splitImportSnapshot(), accepted, error };
      }, { type, merge });
      assert.equal(outcome.accepted, false); assert.match(outcome.error, /ID/); assert.deepEqual(outcome.after, outcome.before);
      assert.deepEqual(await page.evaluate(ids => Promise.all(ids.map(id => splitImportRepo.loadRecord(id))), mixedExpected.map(r => r.recordId)), mixedExpected);
      const name = type + (merge ? "-merge" : "-replace"); artifact(name + ".motionbench.jsonl", outcome.text);
      artifact(name + "-unchanged-storage.json", { before: outcome.before, after: outcome.after });
      return { accepted: false, error: outcome.error, before: evidence(outcome.before), after: evidence(outcome.after), allTablesUnchanged: true };
    });
    await check("separate trials may reuse the same split IDs through import and load", async () => {
      const outcome = await page.evaluate(async () => {
        const lib = splitImportLibrary(["across_trials"]), record = lib.athletes[0].records[0], second = structuredClone(record.data.sprint_fvp[0]);
        second.id = "synthetic_trial_second"; record.data.sprint_fvp.push(second);
        const expected = structuredClone(record), text = await splitImportText(lib), imported = await splitImportPayload(text);
        const loaded = await splitImportRepo.loadRecord(expected.recordId); RingsideModel.validateRecord(loaded);
        return { expected, loaded, imported, text };
      });
      assert.equal(outcome.imported.added, 1); assert.deepEqual(outcome.loaded, outcome.expected);
      assert.deepEqual(outcome.loaded.data.sprint_fvp[0].splits.map(split => split.id), outcome.loaded.data.sprint_fvp[1].splits.map(split => split.id));
      artifact("same-ids-across-trials.motionbench.jsonl", outcome.text); artifact("same-ids-across-trials-loaded.json", outcome.loaded);
    });
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []); assert.equal(hash(fs.readFileSync(source)), sourceHash, "HTML changed during verification");
    result.sourceUnchanged = true;
    result.pass = true;
  } catch (error) { result.errors.push(error.stack || error.message); console.error(error); process.exitCode = 1; }
  finally {
    try { await page.evaluate(() => window.splitImportRepo?.close()); } catch {}
    await context.close(); await browser.close(); result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, channel + "-results.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ channel, pass: result.pass, checks: result.checks.length, sourceHash, realIndexedDB: result.realIndexedDB }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
