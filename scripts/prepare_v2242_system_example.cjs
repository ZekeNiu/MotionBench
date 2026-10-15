"use strict";
// Prepare a four-record example against the real, backed-up system catalog.
// This script only reads files and writes standalone artifacts; it never opens
// a desktop profile or calls the repository/import APIs.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, ".."), CHECKPOINT = String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261015-system-before-2.24.2`;
const SOURCE = path.join(ROOT, "output/playwright/v2241/example-installed/example-comparison.json"), BASELINE = path.join(CHECKPOINT, "verification/baseline/snapshot.json");
const OUTPUT = path.join(ROOT, "output/implementation-2.24.2/system-example"), PROFILE = "evaluation_59e27dd9-a441-4ed8-8d6d-1798325c635e";
const read = file => JSON.parse(fs.readFileSync(file, "utf8")), clone = value => JSON.parse(JSON.stringify(value)), hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const c = require("../tests/helpers/longitudinal-fixture.cjs").context();
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/ringside-longitudinal-store.js"), "utf8"), c);
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/ringside-longitudinal-view.js"), "utf8"), c);
const M = c.RingsideModel, E = c.RingsideEvaluation, L = c.RingsideLongitudinal, S = c.RingsideLongitudinalStore;
const same = (a, b, message) => assert.equal(E.canonical(a), E.canonical(b), message);
const source = read(SOURCE), baseline = read(BASELINE), real = baseline.library, oldOwner = source.library.athletes[0];
const nativeIds = ["fms", "iso", "cmj", "sj", "dj", "imtp", "pushup", "mb", "mas", "mss"], configKeys = ["cmjConfig", "imtpConfig", "impulseConfig", "imtpTimeStandards", "isoDirectionIds"];
assert.equal(source.kind, "longitudinal-report"); assert.equal(source.library.athletes.length, 1); assert.equal(oldOwner.records.length, 4);
const profile = real.evaluationProfiles.find(item => item.id === PROFILE); assert.ok(profile);
assert.ok(real.evaluationProfiles.some(item => item.id === real.defaultEvaluationProfileId));
const profiles = real.evaluationProfiles.map(item => clone(E.serializeProfile(item)));
same(profiles, real.evaluationProfiles, "The real serialized evaluation profiles must remain byte-equivalent as JSON values");
const timestamp = new Date().toISOString(), mapping = [];
const records = oldOwner.records.slice().sort((a, b) => a.athlete.date.localeCompare(b.athlete.date)).map(old => {
  same(Object.keys(old.enabled).filter(id => old.enabled[id]).sort(), nativeIds.slice().sort(), "Unexpected source enabled test");
  const fresh = M.recordFromCatalog(clone(real.catalog), clone(oldOwner.profile), clone(old.enabled), old.athlete.date);
  const definitionBasis = Object.fromEntries(["definitions", "customTests", "projectSnapshots", "abilityGroupSnapshot", "protocolIdentities"].map(key => [key, clone(fresh[key])]));
  for (const key of ["athlete", "athleteId", "recordId", "updated", "mode", "trainingContext"]) fresh[key] = clone(old[key]);
  for (const id of nativeIds) {
    same(old.protocolIdentities[id], fresh.protocolIdentities[id], "Measurement protocol identity changed: " + id);
    same(old.protocol[id], fresh.protocol[id], "Measurement protocol text changed: " + id);
    fresh.data[id] = clone(old.data[id]);
  }
  for (const key of configKeys) if (old[key] !== undefined) {
    if (key !== "isoDirectionIds") same(old[key], fresh[key], "Source measurement configuration differs from the real catalog default: " + key);
    fresh[key] = clone(old[key]);
  }
  fresh.evaluationProfileId = PROFILE; fresh.demo = false;
  const value = M.normalizeRecord(fresh), stats = M.stats(E.resolve(value, profile));
  const cmj = stats.values.cmj_height, pushup = stats.values.pushup_reps, mb = stats.values.mb_dom;
  const parts = ["合成示例 · " + value.athlete.date + "。", "本期采用各项目有效试次均值。"];
  if (Number.isFinite(cmj)) parts.push("CMJ 高度 " + cmj.toFixed(1) + " cm。");
  if (Number.isFinite(pushup)) parts.push("60 秒俯卧撑 " + pushup.toFixed(0) + " 次。");
  if (Number.isFinite(mb)) parts.push("药球反手投掷 " + mb.toFixed(1) + " m。");
  if (!Number.isFinite(stats.values.sj_height)) parts.push("本期 SJ 未测。");
  const text = parts.join("");
  value.narrative = { text, html: M.textToHTML(text), updated: timestamp, basis: M.fingerprint(E.resolve(value, profile)), origin: "manual", revision: 1 };
  for (const id of nativeIds) same(value.data[id], old.data[id], "Source raw trials changed: " + id);
  for (const key of configKeys) if (old[key] !== undefined) same(value[key], old[key], "Source measurement configuration changed: " + key);
  for (const [key, expected] of Object.entries(definitionBasis)) same(value[key], expected, "Fresh real catalog snapshot changed: " + key);
  assert.equal(value.customTests.length, 0); assert.ok(!JSON.stringify(value).includes("demo_generic_"));
  same(value.athlete, old.athlete); assert.equal(value.mode, old.mode);
  mapping.push({ recordId: value.recordId, date: value.athlete.date, mode: value.mode, enabled: nativeIds, rawMeasurementsEqual: true, configsEqual: true, catalogSnapshotsFromReal: true,
    protocols: nativeIds.map(id => ({ id, identity: clone(value.protocolIdentities[id]), protocol: value.protocol[id] })), narrativeBasisMatches: value.narrative.basis === M.fingerprint(E.resolve(value, profile)) });
  return value;
});
same(records.map(record => record.athlete.date), ["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"]);
same(records.map(record => record.recordId).sort(), [...source.selection.recordIds].sort());
const model = L.build(records, { athleteId: oldOwner.id, mode: source.selection.mode, profile: clone(profile), catalog: clone(real.catalog) });
const format = number => Number.isInteger(number) ? String(number) : Number(number.toFixed(2)).toString();
const details = item => item.label + "（" + format(item.change.from.value) + "→" + format(item.change.to.value) + " " + item.unit + "）";
const text = ["合成示例：2026-09-01 至 2026-10-13，共四次测试，代表成绩统一采用有效试次均值。",
  "依据当前评价方案和一致的测量条件，首末相比有 " + model.changeSummary.improved.length + " 项改善、" + model.changeSummary.declined.length + " 项下降。",
  "改善指标：" + model.changeSummary.improved.map(details).join("；") + "。",
  "下降指标：" + model.changeSummary.declined.map(details).join("；") + "。",
  "末次 SJ 缺测，不作首末变化判断。后续复测可优先关注左侧肩外旋力量和肩部灵活性，并保持测试动作、仪器与统计方式一致。"].join("\n\n");
const detailOpen = {};
for (const match of c.RingsideLongitudinalView.render(model).details.matchAll(/<details\b([^>]*)>/g)) {
  const id = match[1].match(/\bid="([^"]+)"/);
  if (id) { assert.ok(!(id[1] in detailOpen), "Duplicate report detail identity"); detailOpen[id[1]] = /(?:^|\s)open(?:\s|=|$)/.test(match[1]); }
}
assert.equal(detailOpen.screenDetail, true); assert.equal(detailOpen.performanceDetail, true);
const initialViews = { reportScroll: 0, detailOpen };
const document = S.normalize({ version: 1, athleteId: oldOwner.id, recordIds: records.map(record => record.recordId), mode: model.mode, evaluationProfileId: PROFILE, profileSnapshot: clone(profile), views: initialViews,
  narrative: { text, html: M.textToHTML(text), updated: timestamp, basis: model.basis, origin: "manual", revision: 1 }, basis: model.basis, created: timestamp, updated: timestamp, revision: 1 });
const owner = { ...clone(oldOwner), records }, library = { schema: 3, kind: "athlete-library", version: "2.24.2", catalog: clone(real.catalog), testPlans: [], groups: [],
  evaluationProfiles: profiles, defaultEvaluationProfileId: real.defaultEvaluationProfileId, athletes: [owner], activeAthleteId: owner.id, activeRecordId: records.at(-1).recordId, longitudinalReports: [document], updated: timestamp };
assert.equal(owner.groupId, ""); S.validateReferences(document, library, { active: true });
const payload = { schema: 1, kind: "longitudinal-report", library, selection: { athleteId: owner.id, recordIds: records.map(record => record.recordId), mode: model.mode } };
same(payload.library.catalog, real.catalog); same(payload.library.evaluationProfiles, real.evaluationProfiles);
assert.equal(payload.library.defaultEvaluationProfileId, real.defaultEvaluationProfileId);
assert.ok(!JSON.stringify(payload).includes("demo_generic_"));
const migrated = E.migrate(clone(library)); same(migrated.catalog, real.catalog); same(migrated.evaluationProfiles, real.evaluationProfiles);
same(migrated.athletes[0].records, records, "Import normalization would alter approved example records");
assert.equal(migrated.defaultEvaluationProfileId, real.defaultEvaluationProfileId);
assert.equal(L.build(migrated.athletes[0].records, { athleteId: owner.id, mode: model.mode, profile: migrated.evaluationProfiles.find(p => p.id === PROFILE), catalog: migrated.catalog }).basis, model.basis);
fs.mkdirSync(OUTPUT, { recursive: true });
const write = (name, value) => { const file = path.join(OUTPUT, name); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); return { file, sha256: hash(file), bytes: fs.statSync(file).size }; };
const artifact = write("example-comparison-clean.json", payload), facts = write("example-model-facts.json", L.facts(model));
const proof = { pass: true, generatedAt: timestamp, runner: { file: __filename, sha256: hash(__filename) }, source: { file: SOURCE, sha256: hash(SOURCE) }, baseline: { file: BASELINE, sha256: hash(BASELINE) },
  productSourceHash: hash(path.join(ROOT, "MotionBench.html")), payload: artifact, facts, athleteId: owner.id, recordIds: records.map(r => r.recordId), dates: records.map(r => r.athlete.date), mode: model.mode,
  defaultEvaluationProfileId: library.defaultEvaluationProfileId, evaluationProfileId: PROFILE, profileIds: profiles.map(p => p.id), catalogEqual: true, profilesEqual: true, noNewSharedDefinitions: true,
  rawMeasurementsEqual: true, importNormalizationUnchanged: true, initialViewsFromRenderedReport: initialViews, basis: model.basis, axes: clone(model.overview.axes), changes: clone(model.changeSummary), mappings: mapping };
write("preparation-proof.json", proof);
console.log(JSON.stringify({ pass: true, payload: artifact, basis: model.basis, axes: model.overview.axes, improved: model.changeSummary.improved.length, declined: model.changeSummary.declined.length, defaultEvaluationProfileId: library.defaultEvaluationProfileId, evaluationProfileId: PROFILE }, null, 2));
