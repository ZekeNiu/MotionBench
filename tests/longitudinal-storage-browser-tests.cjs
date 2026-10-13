"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { pathToFileURL } = require("node:url"), { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), channel = process.argv.includes("--edge") ? "msedge" : "chrome";
const out = path.join(root, "output", "playwright", "v224", "longitudinal-storage", channel); fs.mkdirSync(out, { recursive: true });
const names = ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "model", "evaluation", "longitudinal-store", "store"];
const sources = Object.fromEntries(names.map(name => ["src/ringside-" + name + ".js", fs.readFileSync(path.join(root, "src/ringside-" + name + ".js"), "utf8")]));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const result = { channel, synthetic: true, mode: "source-modules", moduleHashes: Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, hash(text)])), runnerSha256: hash(fs.readFileSync(__filename)), checks: [], errors: [], pass: false };
const shell = path.join(out, "synthetic-storage.html"); fs.writeFileSync(shell, "<!doctype html><meta charset=utf-8><title>Synthetic longitudinal storage tests</title>");
function fixtures() {
  window.copy = value => JSON.parse(JSON.stringify(value));
  window.fixture = () => {
    const record = RingsideModel.defaults(); record.recordId = "r1"; record.athleteId = "a1"; record.athlete.name = "Synthetic storage"; record.athlete.date = "2026-01-01"; record.narrative.text = "Original single body"; record.narrative.html = "<p>Original single body</p>";
    const library = RingsideEvaluation.migrate(RingsideModel.recordEnvelope(record)), second = copy(library.athletes[0].records[0]); second.recordId = "r2"; second.athlete.date = "2026-02-01"; library.athletes[0].records.push(second);
    const document = RingsideLongitudinalStore.normalize({ athleteId: "a1", recordIds: ["r1", "r2"], mode: "mean", evaluationProfileId: library.defaultEvaluationProfileId, profileSnapshot: library.evaluationProfiles[0], views: { highlightRecordId: "r2" }, narrative: { text: "Independent coach body", basis: "old-measurement-basis", revision: 3 }, previousNarrative: { text: "Previous comparison body" }, basis: "new-measurement-basis" });
    return { library, document };
  };
  window.errorOf = async operation => { try { await operation(); return ""; } catch (error) { return error.message; } };
  window.saveDocument = async document => {
    const config = await repo.get("config", "library"), documents = RingsideLongitudinalStore.merge(config.longitudinalReports || [], [document]);
    await repo.saveRecords([], { expectedLongitudinalReports: JSON.stringify(config.longitudinalReports || []) }, { longitudinalReports: documents });
  };
}
(async () => {
  const browser = await chromium.launch({ channel, headless: true });
  try {
    async function check(name, run) {
      const context = await browser.newContext({ offline: true }), pages = [await context.newPage(), await context.newPage()];
      try {
        for (const page of pages) { page.on("pageerror", error => result.errors.push(error.message)); await page.goto(pathToFileURL(shell).href); await page.addScriptTag({content:"window.RingsideBuild={version:"+JSON.stringify(require("../package.json").version)+"};"}); for (const source of Object.values(sources)) await page.addScriptTag({ content: source }); await page.evaluate(fixtures); }
        const database = "/synthetic-longitudinal-v224-" + crypto.randomUUID();
        await pages[0].evaluate(async database => { window.repo = await RingsideStore.Repository.open(database); window.seed = fixture(); await repo.importLibrary(seed.library); await repo.directory(); }, database);
        await pages[1].evaluate(async database => { window.repo = await RingsideStore.Repository.open(database); await repo.directory(); }, database);
        await run(...pages); result.checks.push(name); console.log("PASS " + name);
      } finally { await context.close(); }
    }
    await check("document save persists independently without changing original measurements or single narratives", async a => {
      const value = await a.evaluate(async () => { const before = await repo.values("records"); await saveDocument(seed.document); const config = await repo.get("config", "library"); return { before, after: await repo.values("records"), doc: config.longitudinalReports[0], baseline: JSON.parse(repo.metadataHashes.get("config:library")) }; });
      assert.deepEqual(value.after, value.before); assert.equal(value.doc.narrative.text, "Independent coach body"); assert.deepEqual(value.baseline.longitudinalReports, [value.doc]);
    });
    await check("stale comparison body rejects atomically with attempted simultaneous raw measurement save", async (a, b) => {
      await a.evaluate(async () => { await saveDocument(seed.document); window.baseline = JSON.stringify((await repo.get("config", "library")).longitudinalReports); });
      await b.evaluate(async () => { const config = await repo.get("config", "library"), docs = copy(config.longitudinalReports); docs[0].narrative.html = "<p>Another coach newer body</p>"; docs[0].narrative.revision++; await repo.saveRecords([], { expectedLongitudinalReports: JSON.stringify(config.longitudinalReports) }, { longitudinalReports: docs }); });
      const value = await a.evaluate(async () => { const before = await repo.exportLibrary(), record = await repo.loadRecord("r1"), modified = copy(record); modified.athlete.notes = "Must not save"; const error = await errorOf(() => repo.saveRecords([modified], { expectedRecords: { r1: JSON.stringify(record) }, expectedLongitudinalReports: baseline }, { longitudinalReports: [seed.document] })); return { error, before, after: await repo.exportLibrary() }; });
      assert.match(value.error, /其他页面/); assert.deepEqual(value.after, value.before);
    });
    await check("document-only transaction preserves another page metadata and original record save preserves documents", async (a, b) => {
      await b.evaluate(async () => { const lib = await repo.directory(); lib.groups.push({ id: "other-group", name: "Other page group" }); await repo.save(lib, [], {}, { expectedConfig: repo.metadataHashes.get("config:library") }); });
      await a.evaluate(async () => saveDocument(seed.document));
      const value = await a.evaluate(async () => { const original = await repo.loadRecord("r1"), changed = copy(original); changed.athlete.notes = "Safe measurement record save"; await repo.saveRecords([changed], { expectedRecords: { r1: JSON.stringify(original) } }); return { groups: await repo.values("groups"), config: await repo.get("config", "library"), record: await repo.loadRecord("r1") }; });
      assert.equal(value.groups[0].id, "other-group"); assert.equal(value.config.longitudinalReports[0].narrative.text, "Independent coach body"); assert.equal(value.record.athlete.notes, "Safe measurement record save");
    });
    await check("JSONL backup and reopened repository roundtrip complete current and previous comparison bodies", async a => {
      const value = await a.evaluate(async () => { await saveDocument(seed.document); const before = await repo.exportLibrary(), blob = await repo.backupBlob(); await repo.importRows(RingsideStore.fileRows(blob)); const reopened = await RingsideStore.Repository.open(repo.db.name.slice("motionbench-v3:".length)); const after = await reopened.exportLibrary(); reopened.db.close(); return { before, after }; });
      assert.deepEqual(value.after, value.before);
    });
    await check("merge remaps conflicting record IDs and profile references throughout document and view", async a => {
      const value = await a.evaluate(async () => { await saveDocument(seed.document); const incoming = await repo.exportLibrary(); incoming.athletes[0].records[1].athlete.notes = "Imported distinct measurement context"; incoming.evaluationProfiles[0].name = "Imported changed scheme"; incoming.evaluationProfiles[0].revision++; const imported = await repo.importLibrary(incoming, { merge: true }), after = await repo.exportLibrary(); return { imported, after, originalProfile: seed.document.evaluationProfileId }; });
      assert.ok(value.imported.recordMap.r2); assert.ok(value.imported.profileMap[value.originalProfile]); assert.equal(value.after.longitudinalReports.length, 2);
      const doc = value.after.longitudinalReports.find(document => document.recordIds.includes(value.imported.recordMap.r2));
      assert.equal(doc.views.highlightRecordId, value.imported.recordMap.r2); assert.equal(doc.evaluationProfileId, value.imported.profileMap[value.originalProfile]); assert.equal(doc.profileSnapshot.id, doc.evaluationProfileId); assert.equal(doc.narrative.text, "Independent coach body");
    });
    await check("same-selection conflicting imported body is retained flat without replacing local or duplicating history", async a => {
      const value = await a.evaluate(async () => { await saveDocument(seed.document); const incoming = await repo.exportLibrary(); incoming.longitudinalReports[0].narrative.html = "<p>Imported alternative body</p>"; incoming.longitudinalReports[0].narrative.revision++; await repo.importLibrary(incoming, { merge: true }); await repo.importLibrary(incoming, { merge: true }); return (await repo.directory()).longitudinalReports[0]; });
      assert.equal(value.narrative.text, "Independent coach body"); assert.equal(value.previousNarrative.text, "Previous comparison body"); assert.equal(value.importedVersions.length, 1); assert.equal(value.importedVersions[0].narrative.text, "Imported alternative body"); assert.equal(value.importedVersions[0].importedVersions, undefined);
    });
    await check("soft deletion retains comparison backups and hard record deletion removes associated document atomically", async a => {
      const value = await a.evaluate(async () => { await saveDocument(seed.document); let library = await repo.directory(), stored = await repo.loadRecord("r2"), changed = copy(stored); changed.deletedAt = "2026-03-01T00:00:00Z"; await repo.saveRecords([changed], { expectedRecords: { r2: JSON.stringify(stored) } }); const soft = await repo.exportLibrary(); await repo.importLibrary(soft); library = await repo.directory(); library.athletes[0].records = library.athletes[0].records.filter(record => record.recordId !== "r2"); await repo.save(library, [], { records: ["r2"] }, { expectedConfig: repo.metadataHashes.get("config:library"), expectedRecords: { r2: JSON.stringify(await repo.loadRecord("r2")) } }); return { soft, hard: await repo.exportLibrary() }; });
      assert.equal(value.soft.longitudinalReports.length, 1); assert.equal(value.hard.longitudinalReports.length, 0); assert.equal(value.hard.athletes[0].records.length, 1);
    });
    await check("invalid dated comparison import aborts staging and keeps active original library byte-equivalent", async a => {
      const value = await a.evaluate(async () => { const before = await repo.exportLibrary(), generation = repo.generation, incoming = copy(before); incoming.athletes[0].records[1].athlete.date = ""; incoming.longitudinalReports = [seed.document]; const error = await errorOf(() => repo.importLibrary(incoming)); return { before, after: await repo.exportLibrary(), generation, afterGeneration: repo.generation, error }; });
      assert.match(value.error, /日期/); assert.equal(value.afterGeneration, value.generation); assert.deepEqual(value.after, value.before);
    });
    await check("foreign record document cannot save and unsuccessful document save cannot write its raw record batch", async a => {
      const value = await a.evaluate(async () => { const before = await repo.exportLibrary(), original = await repo.loadRecord("r2"), changed = copy(original); changed.athlete.date = ""; const error = await errorOf(() => repo.saveRecords([changed], { expectedRecords: { r2: JSON.stringify(original) }, expectedLongitudinalReports: "[]" }, { longitudinalReports: [seed.document] })); return { error, before, after: await repo.exportLibrary() }; });
      assert.match(value.error, /日期/); assert.deepEqual(value.after, value.before);
    });
    await check("standalone comparison library export imports selected raw records with document and frozen profile snapshot", async a => {
      const value = await a.evaluate(async () => { await saveDocument(seed.document); const library = await repo.directory(), records = await repo.values("records"), exported = RingsideLongitudinalStore.exportLibrary(library, seed.document, records); await repo.importLibrary(exported); return { exported, imported: await repo.exportLibrary() }; });
      assert.deepEqual(value.imported.athletes[0].records, value.exported.athletes[0].records); assert.deepEqual(value.imported.longitudinalReports, value.exported.longitudinalReports); assert.deepEqual(value.imported.longitudinalReports[0].profileSnapshot, value.exported.longitudinalReports[0].profileSnapshot);
    });
    await check("historical body survives deleted live evaluation profile and standalone export restores its snapshot", async a => {
      const value = await a.evaluate(async () => {
        await saveDocument(seed.document); const library=await repo.exportLibrary(), replacement=RingsideEvaluation.create(RingsideModel.defaults(),"Replacement live scheme");
        library.evaluationProfiles=[replacement];library.defaultEvaluationProfileId=replacement.id;library.athletes[0].records.forEach(record=>record.evaluationProfileId=replacement.id);
        await repo.importLibrary(library);const restored=await repo.exportLibrary();const exported=RingsideLongitudinalStore.exportLibrary(restored,restored.longitudinalReports[0],restored.athletes[0].records);
        await repo.importLibrary(exported);return {restored,exported,after:await repo.exportLibrary()};
      });
      assert.equal(value.restored.evaluationProfiles.length,1);assert.equal(value.restored.longitudinalReports[0].narrative.text,"Independent coach body");assert.equal(value.exported.evaluationProfiles.length,2);assert.deepEqual(value.after.longitudinalReports,value.restored.longitudinalReports);
    });
    await check("legacy unguarded metadata save retains another page comparison while stale body edit rejects", async (a,b) => {
      await a.evaluate(async()=>{window.oldLibrary=await repo.directory();});
      await b.evaluate(async()=>{const config=await repo.get("config","library"),record=await repo.loadRecord("r1");const doc=fixture().document;doc.evaluationProfileId=config.defaultEvaluationProfileId;doc.profileSnapshot=(await repo.values("profiles"))[0];await repo.saveRecords([],{expectedLongitudinalReports:"[]"},{longitudinalReports:[doc]});});
      const retained=await a.evaluate(async()=>{oldLibrary.updated="2026-04-01T00:00:00Z";await repo.save(oldLibrary);oldLibrary.updated="2026-04-02T00:00:00Z";await repo.save(oldLibrary);window.oldBaseline=await repo.directory();return await repo.get("config","library");});
      await b.evaluate(async()=>{const config=await repo.get("config","library"),current=copy(config.longitudinalReports);current[0].narrative.html="<p>Concurrent body two</p>";await repo.saveRecords([],{expectedLongitudinalReports:JSON.stringify(config.longitudinalReports)},{longitudinalReports:current});});
      const value=await a.evaluate(async()=>{oldBaseline.longitudinalReports[0].narrative.html="<p>Intentional stale overwrite</p>";const error=await errorOf(()=>repo.save(oldBaseline));return{error,after:await repo.get("config","library")};});value.retained=retained;
      assert.equal(value.retained.longitudinalReports[0].narrative.text,"Independent coach body");assert.match(value.error,/其他页面/);assert.equal(value.after.longitudinalReports[0].narrative.text,"Concurrent body two");
    });
    assert.deepEqual(result.errors, []); result.pass = true;
  } finally { await browser.close(); fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2)); }
  console.log(`${result.checks.length} longitudinal storage browser checks passed (${channel})`);
})().catch(error => { console.error(error); process.exitCode = 1; });
