"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function context() {
  const c = vm.createContext({ console, Intl, Blob, TextDecoder, crypto: require("node:crypto").webcrypto }); c.window = c;
  for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "generic-report", "model", "evaluation", "interventions", "viz", "report", "result-display", "longitudinal"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/ringside-" + name + ".js"), "utf8"), c);
  return c;
}
// Callable in a browser with createFixture.toString(): no filesystem or Node dependencies.
function createFixture(root = globalThis, count = 3) {
  const M = root.RingsideModel, E = root.RingsideEvaluation, G = root.RingsideGenericReport, records = [];
  for (let index = 0; index < count; index++) {
    const record = M.sampleRecord();
    record.demo = false; record.athleteId = "synthetic-longitudinal-athlete"; record.recordId = "synthetic-period-" + String(index + 1).padStart(2, "0");
    record.created = "2026-01-01T00:00:00.000Z"; record.athlete.name = "纵向验收合成队员"; record.athlete.birthDate = "2000-02-15";
    record.athlete.date = new Date(Date.UTC(2026, index, 20)).toISOString().slice(0, 10); record.athlete.mass = 75 + index;
    record.mode = index === count - 1 ? "mean" : "best"; record.narrative.text = "独立单期人工正文 " + index;
    record.narrative.html = M.textToHTML(record.narrative.text); record.narrative.origin = "manual";
    record.data.cmj = [38, 40, 42].map((height, i) => ({ id: "cmj_" + i, height: height + index * 2, rsiModified: 0.45 + index * 0.02, notes: i === 0 ? "合成试次备注" : "" }));
    record.data.sj = [32, 34, 36].map((height, i) => ({ id: "sj_" + i, height: height + index }));
    record.data.imtp = [0, 1, 2].map(i => ({ id: "imtp_" + i, peakForce: 2200 + i * 100 + index * 150, baselineForce: 100, peakTimeMs: 500, timePoints: [{ id: "f100", timeMs: 100, force: 700 + index * 50 + i * 20 }, { id: "f200", timeMs: 200, force: 1200 + index * 60 + i * 40 }] }));
    for (const id of ["fvp_sj", "fvp_cmj"]) {
      record.enabled[id] = true; record.fvpConfig[id].distanceCm = 35;
      record.data[id] = [0, 20, 40, 60].map((load, i) => ({ id: id + i, load, height: [38, 29, 21, 15][i] + index }));
    }
    record.enabled.sprint_fvp = true;
    record.data.sprint_fvp = [{ id: "sprint", excluded: false, notes: "合成冲刺", splits: [5, 10, 20, 30, 40].map((distanceM, i) => ({ id: "split" + i, distanceM, timeS: root.RingsideSprintFVP.timeAtDistance(distanceM, 9.5 + index * 0.1, 1.15) })) }];
    record.sprintFvpAnalysis.targetDistanceM = 30;
    record.customTests.push({ id: "long_generic", name: "合成通用测试", category: "performance", primaryMetricId: "long_time", selectionDirection: "lower" });
    record.enabled.long_generic = true;
    for (const [id, name, unit, scale] of [["long_time", "完成用时", "s", "ratio"], ["long_pct", "比例", "%", "ratio"], ["long_unknown", "自定义读数", "自定", "unknown"]]) record.definitions.push({ id, testId: "long_generic", name, unit, measurementScale: scale, entryScope: "attempt", cvEligible: scale === "ratio", direction: id === "long_time" ? "lower" : "higher", category: "performance", ability: "冲刺速度", protocol: "固定合成协议", ranges: [], target: id === "long_time" ? 8 : 100, referenceEnabled: true });
    record.data.long_generic = [0, 1, 2].map(i => ({ id: "generic" + i, metrics: { long_time: 12 - index + i * .1, long_pct: 10 + index * 5, long_unknown: 50 + index }, notes: i === 0 ? "通用试次备注" : "" }));
    const normalized = M.normalizeRecord(record);
    normalized.views.genericReports = { long_generic: G.createView(normalized, "long_generic", { kind: "column", metricIds: ["long_time"] }) };
    records.push(normalized);
  }
  const profile = E.create(records.at(-1), "合成统一评价方案"), catalog = M.mergeCatalog(null, records.at(-1));
  return { athleteId: records[0].athleteId, records, profile, catalog, mode: "mean" };
}
module.exports = { context, createFixture };
