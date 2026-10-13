"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function loadComparisonContext() {
  const c = vm.createContext({ console, Intl, Blob, TextDecoder, setTimeout, clearTimeout, crypto: require("node:crypto").webcrypto }); c.window = c;
  for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "sprint-elasticity", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "generic-report", "model", "evaluation", "interventions", "comparison"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/ringside-" + name + ".js"), "utf8"), c, { filename: "ringside-" + name + ".js" });
  return c;
}
const dates = ["2026-04-07", "2026-04-25", "2026-05-20", "2026-07-01", "2026-08-17", "2026-10-06"];
function stableIds(record, prefix) {
  let count = 0;
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    for (const [key, child] of Object.entries(value)) {
      if (key === "id" && typeof child === "string" && /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|id_)/i.test(child)) value[key] = prefix + "_item_" + count++;
      else walk(child);
    }
  }
  walk(record);
  return record;
}
function addGenericProjects(c, record, athleteIndex, period, change) {
  const { RingsideGenericReport: G, RingsideModel: M } = c;
  for (const [index, kind] of ["bar", "column", "trials", "scatter", "target", "radar"].entries()) {
    const testId = "demo_generic_" + kind, x = testId + "_x", y = testId + "_y", z = testId + "_z";
    record.customTests.push({ id: testId, name: { bar: "通用条形 · 握力", column: "通用柱形 · 立定跳远", trials: "通用试次 · 加速计时", scatter: "通用散点 · 负荷与速度", target: "通用目标 · 耐力次数", radar: "通用雷达 · 技能表现" }[kind], category: "performance", primaryMetricId: x, selectionDirection: kind === "trials" ? "lower" : "higher" });
    record.enabled[testId] = true; record.protocol[testId] = "模拟标准化协议·" + kind;
    const unitX = kind === "trials" ? "s" : kind === "scatter" ? "kg" : kind === "bar" ? "N" : kind === "column" ? "cm" : "次";
    const unitY = kind === "scatter" ? "m/s" : unitX;
    const fields = [[x, unitX, "主指标"], [y, unitY, "辅助指标"], ...(kind === "radar" ? [[z, unitX, "第三指标"]] : [])];
    for (const [id, unit, label] of fields) record.definitions.push({ id, testId, name: label, unit, category: "performance", ability: "模拟能力" + index + (kind === "radar" ? "_" + label : ""),
      direction: kind === "trials" ? "lower" : "higher", entryScope: "attempt", measurementScale: "ratio", zeroValid: true, target: kind === "trials" ? 3.2 : kind === "bar" ? 500 : kind === "column" ? 240 : 50, referenceEnabled: true,
      targetEnabled: true, scoring: true, ranges: [], protocol: "同一试次配对", source: "模拟评价方案" });
    const base = kind === "trials" ? 3.6 + athleteIndex * .012 - change * .018 : kind === "scatter" ? 20 : kind === "bar" ? 360 + athleteIndex * 6 + change * 5 : kind === "column" ? 190 + athleteIndex * 1.1 + change : 35 + athleteIndex % 8 + change;
    record.data[testId] = Array.from({ length: 3 }, (_, attempt) => ({ id: testId + "_" + athleteIndex + "_" + period + "_" + attempt,
      metrics: { [x]: Number((base + (kind === "scatter" ? attempt * 20 : kind === "trials" ? attempt * .03 : attempt)).toFixed(4)),
        [y]: Number((kind === "scatter" ? 1.2 - attempt * .23 + change * .003 : base * .8 + attempt).toFixed(4)), ...(kind === "radar" ? { [z]: Number((base * .9 + attempt).toFixed(4)) } : {}) }, notes: "模拟原始试次" }));
    record.axes["模拟能力" + index] = { method: "primary", primary: x, scoringVersion: 1, transforms: { [x]: { kind: "ratio", direction: kind === "trials" ? "lower" : "higher" } } };
    if (kind === "radar") for (const [id, , label] of fields) record.axes["模拟能力" + index + "_" + label] = { method: "primary", primary: id, scoringVersion: 1, transforms: { [id]: { kind: "ratio", direction: "higher" } } };
    const normalized = M.normalizeRecord(record);
    record.views.genericReports ||= {};
    record.views.genericReports[testId] = G.createView(normalized, testId, kind === "scatter" ? { kind, xMetricId: x, yMetricId: y } : { kind, metricIds: fields.map(field => field[0]) });
  }
}
function demoRecord(c, athleteIndex, period) {
  const M = c.RingsideModel, r = M.defaults(), athleteId = "motionbench_comparison_demo_a_" + String(athleteIndex + 1).padStart(2, "0");
  const pattern = athleteIndex % 4, change = pattern === 0 ? period * (1 + athleteIndex / 40) : pattern === 1 ? -period * (.7 + athleteIndex / 50) : pattern === 2 ? 0 : [0, 1.2, -.7, 2.1, .4, 1.8][period];
  const round = value => Number(value.toFixed(5)), mass = 62 + athleteIndex * .9, strength = 2150 + athleteIndex * 30 + change * 45;
  r.athleteId = athleteId; r.recordId = athleteId + "_" + dates[period]; r.updated = dates[period] + "T10:00:00.000Z"; r.demo = true;
  Object.assign(r.athlete, { name: "模拟队员 " + String(athleteIndex + 1).padStart(2, "0"), date: dates[period], mass: round(mass), height: 168 + athleteIndex % 12,
    birthDate: "2000-01-01", age: 26, sex: athleteIndex % 2 ? "女" : "男", sport: athleteIndex % 3 ? "拳击" : "篮球", dominantHand: athleteIndex % 4 ? "右手" : "左手", notes: "合成演示数据；" + ["改善", "下降", "平台", "波动"][pattern] + "轨迹" });
  Object.assign(r.trainingContext, { experienceYears: 2 + athleteIndex % 5, equipment: "杠铃、药球、跳箱、跑道", weeklySessions: 3 + athleteIndex % 2, weeklySchedule: "周一力量，周三速度，周五耐力" });
  r.data.cmj = Array.from({ length: 3 }, (_, i) => ({ id: "cmj_" + i, height: round(31 + athleteIndex * .45 + change * .8 + i * .4), force: round(1400 + athleteIndex * 14 + change * 22 + i * 12), rsiModified: round(.5 + athleteIndex * .01 + change * .012), propulsiveImpulse: 225 + athleteIndex * 3 + change * 4, propulsiveDurationMs: 320, landingPeakForce: 2100 + athleteIndex * 20, metrics: {} }));
  r.data.sj = [{ id: "sj_0", height: round(27 + athleteIndex * .4 + change * .65), force: round(1350 + athleteIndex * 13 + change * 19), rsiModified: round(.45 + athleteIndex * .009 + change * .01), landingPeakForce: 1900 + athleteIndex * 15, metrics: {} }];
  r.data.dj = Array.from({ length: 3 }, (_, i) => ({ id: "dj_" + i, height: round(30 + athleteIndex * .3 + change * .5 + i * .2), contactTimeMs: round(235 - athleteIndex * .8 - change * 2), flightTimeMs: 480 + athleteIndex * 2 + change * 3, dropHeightCm: 45, activeStiffness: 16 + athleteIndex * .3 + change * .3, metrics: {} }));
  r.mode = "mean";
  r.data.hop.inputMode = "jumps"; r.data.hop.jumps = Array.from({ length: 10 }, (_, i) => ({ id: "hop_" + i, height: round(20 + athleteIndex * .25 + change * .4 + i * .12), contactTimeMs: 190 + i * 1.4 - change, flightTimeMs: 410 + i * 2 + change * 2 }));
  r.data.cmrj = [{ id: "cmrj_0", firstHeight: 35 + athleteIndex * .2 + change * .3, firstTimeToTakeoffMs: 540 - change * 2, height: 28 + athleteIndex * .2 + change * .4, contactTimeMs: 230 - change * 2, flightTimeMs: 450 + change * 2, activeStiffness: 17 + athleteIndex * .2 }];
  r.data.imtp = Array.from({ length: 3 }, (_, i) => ({ id: "imtp_" + i, peakForce: round(strength + i * 20), baselineForce: round(mass * 9.81), peakTimeMs: 900,
    impulse250: 320 + athleteIndex * 3 + change * 7, matchedImpulse: 400 + athleteIndex * 4 + change * 8, matchedDurationMs: 320,
    timePoints: [50, 100, 150, 200, 250, 300].map(timeMs => ({ id: "p_" + i + "_" + timeMs, timeMs,
      force: round((strength + i * 20) * (.3 + timeMs / 600)), rfd: round((strength + i * 20) * (.3 + timeMs / 600) / (timeMs / 1000)) })) }));
  r.impulseConfig.confirmed = true; r.dsi.confirmed = true;
  for (const row of r.data.iso) {
    const base = 130 + athleteIndex * 3 + r.data.iso.indexOf(row) * 5 + change * 4;
    if (row.paired) Object.assign(row, { left: round(base * (athleteIndex % 5 === 0 ? .77 + period * .014 : .94)), right: round(base), target: 170, painLeft: athleteIndex === 0 && period === 0 || athleteIndex === 5 && period >= 4 });
    else Object.assign(row, { center: round(base), target: 190 });
  }
  r.data.fms.forEach((item, index) => {
    const score = Math.min(3, Math.max(1, 2 + ((athleteIndex + index + period) % 4 === 0 ? -1 : period >= 3 && pattern === 0 ? 1 : 0)));
    if (item.bilateral) Object.assign(item, { left: score, right: Math.min(3, score + (athleteIndex % 2)) }); else item.score = score;
    item.pain = athleteIndex === 1 && period === 0 && index === 3 || athleteIndex === 6 && period === 5 && index === 1;
    item.location = ["trunk", "hip_l", "knee_l", "shoulder_l", "hip_r", "trunk", "trunk"][index]; item.notes = "保留原分、侧别与疼痛";
  });
  for (const id of ["fvp_sj", "fvp_cmj"]) {
    r.enabled[id] = true; Object.assign(r.fvpConfig[id], { distanceCm: 35, device: "模拟测力台", method: "腾空时间法", posture: "双手叉腰", distanceSource: "实测髋高差" });
    r.data[id] = [0, 20, 40, 60].map((load, i) => ({ id: id + "_" + i, load, height: round([36, 28, 20, 14][i] + athleteIndex * .12 + change * .25 + (id === "fvp_cmj" ? 3 : 0)), excluded: false }));
  }
  r.enabled.sprint_fvp = true; r.sprintFvpAnalysis.targetDistanceM = 30;
  r.data.sprint_fvp = [{ id: "sprint_0", splits: [5, 10, 20, 30, 40].map(distanceM => ({ id: "split_" + distanceM, distanceM, timeS: round(c.RingsideSprintFVP.timeAtDistance(distanceM, 8.8 + athleteIndex * .025 + change * .05, 1.2 - change * .008)) })), excluded: false }];
  for (const id of ["squat", "bench", "deadlift"]) {
    r.lvp[id].mvt = id === "bench" ? .17 : .3;
    r.lvp[id].zones = [{ min: .3, max: .5, label: "力量负荷区间" }];
    r.data[id] = [30, 50, 70].map((load, i) => ({ id: id + "_" + i, load, velocity: round(1.45 + athleteIndex * .005 + change * .015 - load * .012) }));
  }
  r.data.landmine = ["L", "R"].flatMap(side => [10, 20, 30].map((load, i) => ({ id: "landmine_" + side + "_" + i, side, load, velocity: round(2.7 + change * .018 + athleteIndex * .008 - load * .04 + (side === "L" ? -.1 : 0)) })));
  r.data.pushup = { reps: Math.round(35 + athleteIndex * .7 + change * 1.2), notes: "60秒规范动作" };
  r.data.mb = ["D", "ND"].flatMap(side => [0, 1, 2].map(i => ({ id: "mb_" + side + "_" + i, side, distance: round(4 + athleteIndex * .05 + change * .08 + i * .03 - (side === "ND" ? .3 : 0)) })));
  r.data.lactate = [2.5, 3, 3.5, 4, 4.5, 5].map((speed, i) => ({ id: "lactate_" + i, speed, unit: "m/s", lactate: round(1 + Math.exp((speed - 3.7 - change * .015) * 1.3)), hr: Math.round(110 + i * 13 - change) }));
  r.thresholds.lt1 = round(3.3 + athleteIndex * .012 + change * .018); r.thresholds.lt2 = round(4.2 + athleteIndex * .014 + change * .025);
  r.data.mas.speed = round(4.8 + athleteIndex * .015 + change * .03); r.data.mss.speed = round(8.3 + athleteIndex * .025 + change * .05); r.data.ift.speed = round(5.6 + athleteIndex * .012 + change * .025);
  Object.assign(r.data.cpet, { modality: "treadmill", protocol: "模拟递增负荷", oxygenLabel: "VO2peak", vo2: 47 + athleteIndex * .25 + change * .6, peakHr: 187, rer: 1.13 });
  Object.assign(r.data.cpet.thresholds.first, { vo2: 31 + athleteIndex * .2 + change * .3, hr: 145, speed: r.thresholds.lt1 });
  Object.assign(r.data.cpet.thresholds.second, { vo2: 41 + athleteIndex * .2 + change * .4, hr: 173, speed: r.thresholds.lt2 });
  r.views.capabilitySelections = { strength: "jump_elasticity", reactive: "dj_rsi", speed: "sprint_elasticity" }; r.views.fvpProtocol = "fvp_sj";
  for (const d of r.definitions) {
    if (["cmj_height", "imtp_peak_force", "mas_speed", "mss_speed", "dj_rsi", "cpet_vo2_relative"].includes(d.id)) {
      d.referenceEnabled = true; d.targetEnabled = true;
      const target = { cmj_height: 40, imtp_peak_force: 2700, mas_speed: 5.2, mss_speed: 9, dj_rsi: 1.8, cpet_vo2_relative: 55 }[d.id]; d.target = target;
      d.ranges = [{ min: 0, max: target * .75, includeMax: false, status: "red", label: "需改善" }, { min: target * .75, max: target, includeMax: false, status: "amber", label: "关注" }, { min: target, max: null, status: "green", label: "达到模拟目标", advantage: true }];
    }
  }
  addGenericProjects(c, r, athleteIndex, period, change);
  let normalized = stableIds(M.normalizeRecord(r), r.recordId); normalized.updated = r.updated;
  if (athleteIndex === 21 && period === 2) normalized.data.cmj = [];
  if (athleteIndex === 22 && period === 4) { normalized.protocol.cmj = "模拟异议协议·允许摆臂"; normalized.protocolIdentities.cmj = M.protocolIdentity("test:cmj", normalized.protocol.cmj); }
  if (athleteIndex === 23 && period === 5) normalized.fvpAnalysis.fvp_sj.angle = 30;
  M.validateRecord(normalized);
  return normalized;
}
function createDemoLibrary(c = loadComparisonContext(), { bindReports = true } = {}) {
  const M = c.RingsideModel, E = c.RingsideEvaluation, C = c.RingsideComparison, first = demoRecord(c, 0, 0);
  const base = E.migrate(M.normalizeLibrary(first)), profile = E.create(first, "模拟评价方案·团队与纵向");
  profile.id = "motionbench_comparison_demo_profile"; profile.created = "2026-10-13T00:00:00.000Z"; profile.updated = profile.created;
  const athletes = Array.from({ length: 24 }, (_, index) => {
    const records = dates.map((date, period) => index === 20 && period === 3 ? null : demoRecord(c, index, period)).filter(Boolean);
    records.forEach(record => { record.evaluationProfileId = profile.id; record.archived = false; record.deletedAt = null; });
    if (index === 19) { const repeat = JSON.parse(JSON.stringify(records[1])); repeat.recordId += "_repeat"; repeat.title = "同日重测·请指定"; repeat.updated = dates[1] + "T12:00:00.000Z"; repeat.data.cmj.forEach(row => { row.height += 1; }); records.push(repeat); }
    return { id: records[0].athleteId, name: records[0].athlete.name, profile: M.profileFromRecord(records[records.length - 1]), groupId: "motionbench_comparison_demo_group",
      created: "2026-10-13T00:00:00.000Z", updated: "2026-10-13T00:00:00.000Z", archived: false, deletedAt: null, demo: true, records };
  });
  const library = { ...base, updated: "2026-10-13T00:00:00.000Z", groups: [{ id: "motionbench_comparison_demo_group", name: "模拟队伍·团队与纵向示例", notes: "24名合成队员，6个不等间隔日期；包含缺测、同日重测与测量条件差异", archived: false, deletedAt: null, created: "2026-10-13T00:00:00.000Z", updated: "2026-10-13T00:00:00.000Z" }],
    athletes, evaluationProfiles: [JSON.parse(JSON.stringify(profile))], defaultEvaluationProfileId: profile.id, catalog: M.mergeCatalog(base.catalog, first), activeAthleteId: athletes[0].id, activeRecordId: athletes[0].records[0].recordId };
  library.catalog.reportViews = JSON.parse(JSON.stringify(first.views.genericReports));
  const allIds = athletes.map(athlete => athlete.id);
  const report = (id, athleteIds, selectedDates, text) => {
    const selection = { groupId: library.groups[0].id, athleteIds, dates: selectedDates, recordChoices: Object.fromEntries(athleteIds.map(athleteId => [athleteId, Object.fromEntries(selectedDates.map(date => [date, athletes.find(item => item.id === athleteId).records.find(record => record.athlete.date === date)?.recordId]).filter(([, recordId]) => recordId))])), basis: { strength: "jump_elasticity", reactive: "dj_rsi", speed: "sprint_elasticity", jumpProtocol: "fvp_sj" } };
    return { id, selection: C.normalizeSelection(selection), views: {}, narrative: { text, source: "manual", inputFingerprint: "", updated: "2026-10-13T00:00:00.000Z" }, revisions: [], inputFingerprint: "", created: "2026-10-13T00:00:00.000Z", updated: "2026-10-13T00:00:00.000Z" };
  };
  library.comparisonReports = [
    report("motionbench_comparison_demo_team", allIds, [dates[5]], "共同重点：结合末次测试检查力量、反应力量与耐力的共同需求。\n\n分组建议：按训练方向卡片的实际名单分组；每组在当前每周训练安排内落实对应专项练习。"),
    report("motionbench_comparison_demo_person", [allIds[0]], dates, "模拟队员01：对照不等间隔测试日期观察实测成绩、趋势及预警变化；复测使用相同测量协议。"),
    report("motionbench_comparison_demo_longitudinal", allIds, dates, "共同重点：各指标使用完整可比的固定队员集合，结合末次状态与相对首次测试的变化安排训练。\n\n分组建议：改善组巩固执行，下降组结合训练和恢复情况调整，平台组检查负荷进展，波动组复核测试条件并按既定周期复测。")
  ];
  E.validateProfile(library.evaluationProfiles[0]); M.validateCatalog(library.catalog); M.validateLibrary({ ...library, schema: 2 });
  if (bindReports) for (const report of library.comparisonReports) applyReportBinding(report, C.deriveComparison(C.readComparisonInputs(library, report.selection)));
  return JSON.parse(JSON.stringify(library));
}
function applyReportBinding(report, model) {
  if (!model.ready) throw Error("模拟报告的原始记录选择尚未完成");
  report.selection = JSON.parse(JSON.stringify(model.selection)); report.inputFingerprint = model.fingerprint;
  report.narrative.basis = model.fingerprint; report.narrative.inputFingerprint = model.fingerprint;
  report.narrative.origin = "manual"; report.narrative.revision = 1;
}
async function bindDemoReports(library, c, onProgress) {
  for (const [index, report] of library.comparisonReports.entries()) {
    const model = await c.RingsideComparison.deriveComparisonAsync(c.RingsideComparison.readComparisonInputs(library, report.selection));
    applyReportBinding(report, model); onProgress?.({ current: index + 1, total: library.comparisonReports.length, reportId: report.id, fingerprint: model.fingerprint });
  }
  return library;
}
module.exports = { loadComparisonContext, createDemoLibrary, bindDemoReports, demoRecord, dates };
