"use strict";
// Offline plan only: no desktop launch, profile access, import or repository writes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, ".."), CHECKPOINT = String.raw`D:\Application\Strength&Conditioning\MotionBench-backups\20261016-system-before-2.24.3`;
const PROJECT_IDS = ["fvp_sj", "fvp_cmj", "sprint_fvp", "lactate", "cpet"];
const ATHLETE_ID = "f56b5a5a-6d80-442f-b4e6-73134659b06f";
const RECORD_IDS = ["8d2e3b11-c17a-4211-9a61-3441316b1a8e", "8a99ed67-0706-466a-a447-ff0f47368ca9", "285dc077-3543-43a3-8903-d0e60ce2e9af", "1a1865cb-560c-4617-b042-e4bf4e8d3db5"];
const DATES = ["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"];
const ORIGINAL_TESTS = ["fms", "iso", "cmj", "sj", "dj", "imtp", "pushup", "mb", "mas", "mss"];
const clone = value => JSON.parse(JSON.stringify(value));
const fileHash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function set(object, key, value) { const parts = key.split("."); let at = object; for (const part of parts.slice(0, -1)) at = at[part] ||= {}; at[parts.at(-1)] = clone(value); }
function get(object, key) { return key.split(".").reduce((at, part) => at?.[part], object); }
function addedDataWithoutIds(data, existing = {}) {
  const out = clone(data);
  for (const id of ["lactate", "fvp_sj", "fvp_cmj", "sprint_fvp"]) for (const [index, row] of (out[id] || []).entries()) {
    if (!existing[id]?.[index]?.id) delete row.id;
    if (id === "sprint_fvp") for (const [splitIndex, split] of (row.splits || []).entries()) if (!existing[id]?.[index]?.splits?.[splitIndex]?.id) delete split.id;
  }
  return out;
}
function plannedProjects(index, record) {
  const str = value => String(value), jumpHeights = {
    fvp_sj: [[32,25,18,12],[33,25.8,18.8,12.8],[32.5,25.4,18.3,12.5],[35,27,20,14]],
    fvp_cmj: [[39,30,22,16],[40,31,23,16.8],[39.5,30.5,22.5,16.5],[42,33,24.5,18]],
  };
  const projects = {};
  for (const id of ["fvp_sj", "fvp_cmj"]) projects[id] = { parameters: {
    ["fvpConfig." + id + ".distanceCm"]: "35", ["fvpConfig." + id + ".device"]: "合成示例",
    ["fvpConfig." + id + ".method"]: "合成跳跃高度输入", ["fvpConfig." + id + ".posture"]: id === "fvp_sj" ? "双手叉腰；静止 SJ" : "双手叉腰；统一反向动作深度",
    ["fvpConfig." + id + ".distanceSource"]: "合成示例值",
  }, rows: [0,20,40,60].map((load, i) => ({ load: str(load), height: str(jumpHeights[id][index][i]), distanceCm: "", notes: "合成示例", excluded: false, exclusionReason: "" })) };
  const times = [[1.368,2.101,3.361,4.537],[1.350,2.071,3.307,4.460],[1.359,2.086,3.334,4.498],[1.332,2.042,3.256,4.385]];
  projects.sprint_fvp = { parameters: { "sprintFvpAnalysis.targetDistanceM": "30", "sprintFvpConfig.device": "合成示例", "sprintFvpConfig.inputTimeMode": "cumulative" },
    rows: [{ splits: [5,10,20,30].map((distance, i) => ({ distanceM: str(distance), timeS: str(times[index][i]) })), excluded: false, exclusionReason: "", notes: "合成示例" }] };
  const lactates = [[1.1,1.4,2.1,3.3,5.0,7.4],[1.0,1.3,1.9,3.0,4.6,7.0],[1.1,1.4,2.0,3.2,4.8,7.2],[1.0,1.2,1.7,2.7,4.2,6.5]],
    lt1 = [3.95,4.05,4.0,4.15], lt2 = [4.7,4.8,4.75,4.9];
  projects.lactate = { parameters: { "protocol.lactate": record.protocol.lactate, "thresholds.lt1": str(lt1[index]), "thresholds.lt2": str(lt2[index]), "thresholds.method": "合成示例：曲线转折点；人工确认" },
    rows: [3,3.5,4,4.5,5,5.5].map((speed, i) => ({ speed: str(speed), lactate: str(lactates[index][i]), hr: str([126,138,150,163,176,187][i] - [0,1,0,2][index]) })) };
  const peak = [54,55,54.5,57], first = [35,36,35.5,38], second = [45,46,45.5,48];
  projects.cpet = { parameters: { "data.cpet.modality": "treadmill", "data.cpet.protocol": "合成示例：跑台递增测试", "data.cpet.oxygenLabel": "VO2peak", "data.cpet.vo2": str(peak[index]), "data.cpet.vo2Unit": "ml/kg/min", "data.cpet.peakHr": "192", "data.cpet.rer": "1.12",
    "data.cpet.thresholds.first.label": "VT1", "data.cpet.thresholds.first.vo2": str(first[index]), "data.cpet.thresholds.first.vo2Unit": "ml/kg/min", "data.cpet.thresholds.first.hr": str([145,146,145,147][index]), "data.cpet.thresholds.first.speed": str([3.8,3.9,3.85,4.0][index]),
    "data.cpet.thresholds.second.label": "VT2", "data.cpet.thresholds.second.vo2": str(second[index]), "data.cpet.thresholds.second.vo2Unit": "ml/kg/min", "data.cpet.thresholds.second.hr": str([174,175,174,176][index]), "data.cpet.thresholds.second.speed": str([4.6,4.7,4.65,4.8][index]) } };
  return Object.fromEntries(PROJECT_IDS.map(id => [id, projects[id]]));
}
// Mirror only installCatalogProject's native-project metadata operation. The
// final UI exercise must independently compare these exact expected values.
function installMetadata(record, catalog, id, M, T) {
  assert.ok(!catalog.conflicts.some(conflict => conflict.testId === id && !conflict.resolved), "Blocked catalog project: " + id);
  assert.ok(M.TESTS.some(test => test[0] === id), "The additions must use native existing tests");
  const project = catalog.tests.find(test => test.id === id); assert.ok(project && !project.disabled);
  const first = Array.isArray(record.catalogAppliedTests) && !record.catalogAppliedTests.includes(id);
  record.projectSnapshots ||= T.snapshots(record);
  const projectIndex = record.projectSnapshots.findIndex(test => test.id === id);
  if (projectIndex < 0) record.projectSnapshots.push(clone(project)); else if (first) record.projectSnapshots[projectIndex] = clone(project);
  for (const definition of catalog.definitions.filter(definition => definition.testId === id)) {
    const index = record.definitions.findIndex(item => item.id === definition.id);
    if (index < 0) record.definitions.push(clone(definition)); else if (first) record.definitions[index] = clone(definition);
    if (T.isManualMetric(definition)) record.customValues[definition.id] ||= { value: "", notes: "" };
  }
  if ((first || !record.protocol[id]) && catalog.protocol[id] !== undefined) record.protocol[id] = catalog.protocol[id];
  if (first || projectIndex < 0) {
    record.protocolIdentities ||= {};
    if (catalog.protocolIdentities?.[id]) record.protocolIdentities[id] = clone(catalog.protocolIdentities[id]);
    assert.notEqual(T.describe(record).find(test => test.id === id)?.renderer, "scalar");
    record.projectSnapshots = T.snapshots(record);
  }
  if (Array.isArray(record.catalogAppliedTests) && !record.catalogAppliedTests.includes(id)) record.catalogAppliedTests.push(id);
  record.catalogRevision = catalog.revision;
  record.enabled[id] = true;
}
function buildPlan(snapshot) {
  const c = require("../tests/helpers/longitudinal-fixture.cjs").context(), M = c.RingsideModel, E = c.RingsideEvaluation, L = c.RingsideLongitudinal, T = c.RingsideTests;
  const canonical = E.canonical, same = (a, b, message) => assert.equal(canonical(a), canonical(b), message), digest = value => crypto.createHash("sha256").update(canonical(value)).digest("hex");
  const library = snapshot.library, libraryBefore = canonical(library), owner = library.athletes.find(item => item.id === ATHLETE_ID);
  assert.ok(owner); assert.equal(owner.records.length, 4); same(owner.records.map(record => record.recordId).sort(), [...RECORD_IDS].sort());
  const records = [], expected = [], metadataKeys = ["enabled", "catalogAppliedTests", "catalogRevision", "projectSnapshots", "definitions", "protocolIdentities", "protocol", "customValues"];
  for (let index = 0; index < RECORD_IDS.length; index++) {
    const before = owner.records.find(record => record.recordId === RECORD_IDS[index]), record = clone(before), projects = plannedProjects(index, before);
    assert.equal(before.athlete.date, DATES[index]); assert.equal(before.athleteId, ATHLETE_ID);
    same(Object.keys(before.enabled).filter(id => before.enabled[id]).sort(), [...ORIGINAL_TESTS].sort());
    for (const id of PROJECT_IDS) {
      assert.equal(before.enabled[id], false, "New projects must be previously disabled");
      const values = id === "cpet" ? [before.data.cpet.vo2, before.data.cpet.peakHr, before.data.cpet.rer, ...["first", "second"].flatMap(key => ["vo2", "hr", "speed", "power"].map(field => before.data.cpet.thresholds[key][field]))]
        : id === "sprint_fvp" ? before.data[id].flatMap(row => (row.splits || []).map(split => split.timeS))
        : before.data[id].flatMap(row => id === "lactate" ? [row.speed, row.lactate, row.hr] : [row.height, row.load]);
      assert.ok(values.every(value => c.Calc.num(value) === null), "Do not replace existing measured data: " + id);
      installMetadata(record, library.catalog, id, M, T);
      for (const [key, value] of Object.entries(projects[id].parameters)) {
        assert.ok(!M.validateField(record, key, value), "Invalid field: " + key); set(record, key, value);
      }
      if (projects[id].rows) {
        record.data[id] = clone(projects[id].rows).map((row, rowIndex) => ({ ...row, id: before.data[id]?.[rowIndex]?.id || "offline_check_" + id + "_" + rowIndex,
          ...(id === "sprint_fvp" ? { splits: row.splits.map((split, splitIndex) => ({ ...split, id: before.data[id]?.[rowIndex]?.splits?.[splitIndex]?.id || "offline_split_" + splitIndex })) } : {}) }));
      }
    }
    const normalized = M.normalizeRecord(record); M.validateRecord(normalized);
    for (const id of ORIGINAL_TESTS) same(normalized.data[id], before.data[id], "Original measurements changed: " + id);
    for (const key of ["athlete", "narrative", "mode", "evaluationProfileId", "customTests", "abilityGroupSnapshot", "cmjConfig", "imtpConfig", "dsi", "impulseConfig", "views", "trainingContext"]) same(normalized[key], before[key], "Original record context changed: " + key);
    same(normalized.definitions.filter(item => !PROJECT_IDS.includes(item.testId)), before.definitions.filter(item => !PROJECT_IDS.includes(item.testId)));
    same(normalized.projectSnapshots.filter(item => !PROJECT_IDS.includes(item.id)), before.projectSnapshots.filter(item => !PROJECT_IDS.includes(item.id)));
    const expectedMetadata = Object.fromEntries(metadataKeys.filter(key => canonical(normalized[key]) !== canonical(before[key])).map(key => [key, clone(normalized[key])]));
    const changes = Object.entries(expectedMetadata).map(([key, value]) => ({ path: key, beforePresent: before[key] !== undefined, ...(before[key] === undefined ? {} : { before: clone(before[key]) }), expected: value, kind: "catalog-install" }));
    for (const id of PROJECT_IDS) {
      for (const [key, value] of Object.entries(projects[id].parameters)) if (canonical(get(before, key)) !== canonical(value)) changes.push({ path: key, before: clone(get(before, key)), expected: clone(value), kind: "parameter" });
      if (projects[id].rows) {
        const generatedIdsOnly = normalized.data[id].flatMap((row, rowIndex) => [
          ...(!before.data[id]?.[rowIndex]?.id ? [rowIndex + ".id"] : []),
          ...(id === "sprint_fvp" ? row.splits.flatMap((split, splitIndex) => !before.data[id]?.[rowIndex]?.splits?.[splitIndex]?.id ? [rowIndex + ".splits." + splitIndex + ".id"] : []) : []),
        ]);
        const expectedRows = addedDataWithoutIds({ [id]: normalized.data[id] }, before.data)[id];
        // App.addRow('lactate') stores speed/lactate/hr/id. Normalization adds a
        // derived unit for calculations; the stored new row has no unit field.
        if (id === "lactate") expectedRows.forEach((row, index) => { if (!Object.hasOwn(before.data[id]?.[index] || {}, "unit")) delete row.unit; });
        changes.push({ path: "data." + id, before: clone(before.data[id]), expected: expectedRows, kind: "new-measurements", generatedIdsOnly });
      }
    }
    const restored = clone(normalized);
    for (const change of changes) {
      if (change.beforePresent === false) delete restored[change.path];
      else set(restored, change.path, change.before);
    }
    same(restored, before, "Unexpected change outside the exact approved paths");
    const profile = library.evaluationProfiles.find(profile => profile.id === normalized.evaluationProfileId); assert.ok(profile);
    const report = c.RingsideReport.build(E.resolve(normalized, profile), { catalog: library.catalog }), stats = report.stats;
    for (const id of ["fvp_sj", "fvp_cmj"]) { assert.equal(stats.fvp[id].valid, true); assert.ok(stats.fvp[id].elasticity && stats.fvp[id].points.length === 4); }
    assert.equal(stats.sprintFvp.valid, true); assert.equal(stats.sprintElasticity.valid, true); assert.equal(stats.raw.cpet.issues.length, 0);
    for (const id of PROJECT_IDS) assert.ok(stats.validTests.has(id), "Missing measured test: " + id);
    records.push({ recordId: before.recordId, date: before.athlete.date, beforeSha256: digest(before), beforeRawSha256: digest(before.data), beforeNarrativeSha256: digest(before.narrative), projects, expectedMetadata, allowedChanges: changes,
      effectiveProfileId: profile.id, validation: { validTests: PROJECT_IDS, jumpLoadPoints: { fvp_sj: stats.fvp.fvp_sj.points.length, fvp_cmj: stats.fvp.fvp_cmj.points.length }, sprintValid: true, sprintElasticityValid: true, cpetIssues: [], values: Object.fromEntries(["lt1", "lt2", "cpet_vo2_relative", "cpet_threshold1_pct", "cpet_threshold2_pct"].map(id => [id, stats.values[id]])) } });
    expected.push(normalized);
  }
  const profile = library.evaluationProfiles.find(profile => profile.id === expected.at(-1).evaluationProfileId), model = L.build(expected, { athleteId: ATHLETE_ID, mode: expected.at(-1).mode, profile, catalog: library.catalog });
  assert.equal(model.capability.analyses.length, 6); assert.ok(model.capability.analyses.every(module => module.periods.every(period => period.available)));
  assert.ok(model.capability.cards.find(card => card.id === "cardio").metrics.some(row => row.id === "lt1"));
  same(library, JSON.parse(libraryBefore));
  return { schema: 1, kind: "existing-example-measurement-addition-plan", athleteId: ATHLETE_ID, recordIds: RECORD_IDS, dates: DATES, projectIds: PROJECT_IDS, records,
    preserved: { originalTests: ORIGINAL_TESTS, existingNarratives: true, originalAthleteAndRecordIds: true, catalogSha256: digest(library.catalog), evaluationProfilesSha256: digest(library.evaluationProfiles), defaultEvaluationProfileId: library.defaultEvaluationProfileId,
      libraryBeforeSha256: digest(library), originalComparisonDocumentsSha256: digest(library.longitudinalReports || []) },
    generatedIdScope: "Only the precise new row/split id paths enumerated in generatedIdsOnly may be generated; every existing row/split id, including the first empty lactate row, remains exact.",
    modelValidation: { pass: true, analyses: model.capability.analyses.map(module => ({ id: module.id, available: module.periods.map(period => period.available) })), capabilityCards: model.capability.cards.map(card => card.id), axes: clone(model.overview.axes) } };
}
if (require.main === module) {
  const input = process.argv[2] || path.join(CHECKPOINT, "verification/baseline/snapshot.json"), output = process.argv[3] || path.join(ROOT, "output/implementation-2.24.3/example-additions-plan.json");
  const snapshot = JSON.parse(fs.readFileSync(input, "utf8")), plan = buildPlan(snapshot);
  plan.provenance = { baseline: { file: path.resolve(input), sha256: fileHash(input) }, generator: { file: __filename, sha256: fileHash(__filename) }, sourceModules: Object.fromEntries(["app", "model", "evaluation", "longitudinal", "tests", "fvp", "sprint-fvp", "sprint-elasticity"].map(id => [id, fileHash(path.join(ROOT, "src/ringside-" + id + ".js"))])) };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(plan, null, 2) + "\n");
  console.log(JSON.stringify({ pass: true, file: path.resolve(output), sha256: fileHash(output), records: plan.records.length, projectsPerRecord: plan.projectIds.length, baseline: plan.provenance.baseline, generatorSha256: plan.provenance.generator.sha256, modelValidation: plan.modelValidation }, null, 2));
}
module.exports = { buildPlan, plannedProjects, addedDataWithoutIds, PROJECT_IDS, ATHLETE_ID, RECORD_IDS, DATES };
