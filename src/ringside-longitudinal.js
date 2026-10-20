(function (root) {
  "use strict";
  const M = root.RingsideModel, E = root.RingsideEvaluation, T = root.RingsideTests, N = root.Calc.num;
  const clone = value => JSON.parse(JSON.stringify(value));
  const canonical = value => E.canonical(value);
  const displayRules = record => ({ scoreAmber: record.rules.scoreAmber, scoreGreen: record.rules.scoreGreen });
  const colors = ["#355e86", "#b76735", "#397b6f", "#815e9b", "#a35163", "#647a36", "#477e9c", "#a87932"];
  const riskOrder = [["neck", "颈部"], ["shoulder_r", "右肩"], ["shoulder_l", "左肩"], ["scapula_r", "右肩胛带"], ["scapula_l", "左肩胛带"], ["elbow_r", "右肘"], ["elbow_l", "左肘"], ["forearm_r", "右前臂"], ["forearm_l", "左前臂"], ["wrist_r", "右腕"], ["wrist_l", "左腕"], ["trunk", "躯干"], ["hip_r", "右髋"], ["hip_l", "左髋"], ["knee_r", "右膝"], ["knee_l", "左膝"], ["ankle_r", "右踝足"], ["ankle_l", "左踝足"]];
  const riskScore = { green: 3, amber: 2, red: 1 };
  // Compact content identity, not an authentication or security primitive.
  function contentHash(text) {
    let a = 1779033703, b = 3144134277, c = 1013904242, d = 2773480762;
    for (let i = 0; i < text.length; i++) {
      const k = text.charCodeAt(i);
      a = b ^ Math.imul(a ^ k, 597399067); b = c ^ Math.imul(b ^ k, 2869860233);
      c = d ^ Math.imul(c ^ k, 951274213); d = a ^ Math.imul(d ^ k, 2716044179);
    }
    a = Math.imul(c ^ (a >>> 18), 597399067); b = Math.imul(d ^ (b >>> 22), 2869860233);
    c = Math.imul(a ^ (c >>> 17), 951274213); d = Math.imul(b ^ (d >>> 19), 2716044179);
    return "longitudinal-v1-" + [a ^ b ^ c ^ d, b ^ a, c ^ a, d ^ a].map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
  }
  function key(athleteId, recordIds) { return JSON.stringify([athleteId, [...new Set(recordIds)].sort()]); }
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function sortRecords(records) {
    return records.slice().sort((a, b) => a.athlete.date.localeCompare(b.athlete.date) || String(a.created || "").localeCompare(String(b.created || "")) || a.recordId.localeCompare(b.recordId));
  }
  const signature = context => E.contextSignature(context);
  function testContext(record, id, stats) {
    const base = { protocolIdentity: record.protocolIdentities?.[id] || M.protocolIdentity("test:" + id, record.protocol?.[id] || "") };
    if (["fvp_sj", "fvp_cmj"].includes(id)) base.settings = { ...record.fvpConfig[id], angle: record.fvpAnalysis?.[id]?.angle || 90 };
    if (id === "sprint_fvp") base.settings = Object.fromEntries(["device", "methodVersion", "startConvention", "timingStart", "inputTimeMode", "timeCorrectionS", "positionStartM", "samplingWindow", "rfAfterS"].map(key => [key, record.sprintFvpConfig?.[key] ?? null]));
    if (id === "cpet") base.settings = { modality: record.data.cpet?.modality, protocol: record.data.cpet?.protocol, oxygenLabel: record.data.cpet?.oxygenLabel };
    if (["ift", "mas", "mss"].includes(id)) base.settings = { protocol: record.data[id]?.protocol || "", method: record.data[id]?.method || "" };
    if (id === "imtp") base.settings = clone(record.imtpConfig || {});
    if (id === "cmj") base.settings = clone(record.cmjConfig || {});
    if (id === "dj" && stats) base.settings = { dropHeights: [...new Set((stats.representativeData.dj || []).map(row => N(row.dropHeightCm)))].sort((a, b) => a - b) };
    if (id === "hop") {
      const selected = stats?.raw.hop ? stats.raw.hop.sets.filter(set => stats.raw.hop.selectedSetIds.includes(set.id)) : M.repeatRows(record, "hop");
      base.settings = { protocols: [...new Set(selected.map(set => canonical({ inputMode: set.inputMode, selectionBasis: set.selectionBasis || (set.inputMode === "summary" ? set.summary?.selectionBasis || "unknown" : "height_rsi") })))].sort().map(value => JSON.parse(value)) };
    }
    if (["bench", "squat", "deadlift", "landmine"].includes(id)) base.settings = { velocityMetrics: (id === "landmine" ? ["landmineL", "landmineR"] : [id]).map(key => ({ id: key, metric: record.lvp[key]?.metric })) };
    return base;
  }
  function derivedContext(record, metricId, stats) {
    const definition = T.derivedDefinitions().find(item => item.id === metricId), dependencies = definition?.dependencies || [];
    return { ...(dependencies.length ? { protocols: dependencies.map(id => ({ testId: id, ...testContext(record, id, stats) })) } : {}),
      ...(/^(?:f?dsi|idsi)/.test(metricId) ? { forceDefinitions: Object.fromEntries(["source", "cmjUnit", "unit", "definition", "protocol"].map(key => [key, record.dsi?.[key] ?? null])) } : {}) };
  }
  function metricContext(record, definition, stats) {
    const context = { ...E.measurementContext(record, definition), entryScope: definition.entryScope || "record", testSettings: ["cmj", "imtp"].includes(definition.testId) ? null : testContext(record, definition.testId, stats).settings || null, ...derivedContext(record, definition.id, stats) };
    if (["lt1", "lt2"].includes(definition.id)) context.thresholdMethod = record.thresholds.method;
    if (/1rm/i.test(definition.id)) context.minimumVelocity = record.lvp[definition.testId]?.mvt ?? null;
    if (definition.id === "sprint_fvp_imbalance") context.targetDistanceM = record.sprintFvpAnalysis?.targetDistanceM;
    if (definition.testId === "dj" && stats) context.dropHeights = [...new Set((stats.representativeData.dj || []).map(row => N(row.dropHeightCm)))].sort((a, b) => a - b);
    return context;
  }
  function comparisonDirection(record, definition, evaluation) {
    if (!definition || evaluation?.applicable === false || !definition.referenceEnabled) return null;
    const rule = record.evaluationStandards?.find(item => item.subjectId === "metric:" + definition.id);
    if (rule && (!rule.enabled || !rule.applicable)) return null;
    // A fitted ratio or an interval score is not a declaration that larger is better.
    const transforms = evaluation?.scoreContributions?.map(item => item.transform) || [];
    if (transforms.some(item => item?.shape === "range" || item?.kind === "table")) return null;
    const ranges = (definition.ranges || []).slice().sort((a, b) => (N(a.min) ?? -Infinity) - (N(b.min) ?? -Infinity));
    if (evaluation?.rangesApplicable && ranges.length) {
      const ranks = ranges.map(range => ({ red: 1, amber: 2, green: 3 })[range.status]), sign = definition.direction === "lower" ? -1 : 1;
      if (ranks.some(rank => rank === undefined) || ranks.some((rank, i) => i && (rank - ranks[i - 1]) * sign < 0)) return null;
      if (!evaluation?.targetApplicable && new Set(ranks).size < 2) return null;
    }
    if (!(evaluation?.targetApplicable && N(evaluation.target) !== null) && !(evaluation?.rangesApplicable && definition.ranges?.length)) return null;
    return ["higher", "lower"].includes(definition.direction) ? definition.direction : null;
  }
  function observations(period) {
    const { record, stats, report } = period, result = new Map();
    const evaluations = stats.evaluationResults || [];
    function add(id, properties) {
      if (N(properties.value) === null && !properties.preserveMissing) return;
      const rawTrials = properties.rawTrials || [];
      result.set(id, { id, metricId: properties.metricId || id, measurementScale: "unknown", notes: "", rawTrials, statistics: null, evaluation: null, direction: null, displayRules: displayRules(record), ...properties, value: N(properties.value), rawValue: N(properties.value), rawUnit: properties.unit || "" });
    }
    for (const project of report.projects) for (const d of project.metrics) {
      const evaluation = evaluations.find(item => item.metricId === d.id && item.kind === "metric") || evaluations.find(item => item.metricId === d.id);
      const group = stats.repetitions.find(item => item.testId === project.id && item.statistics.some(stat => stat.id === d.id));
      const statistic = group?.statistics.find(item => item.id === d.id);
      const rows = group?.attempts || [];
      add(d.id, { metricId: d.id, subjectId: "metric:" + d.id, testId: project.id, name: T.metricName(d), unit: d.unit, value: d.value,
        measurementScale: E.measurementScale(d), context: metricContext(record, d, stats), definition: d,
        statistics: statistic ? clone(statistic) : null, rawTrials: clone(rows), evaluation: evaluation || { grade: d.evaluation },
        direction: comparisonDirection(record, d, evaluation), notes: rows.map(row => row.notes).filter(Boolean).join("；") });
    }
    for (const item of evaluations) {
      if (item.kind === "metric" && result.has(item.metricId)) continue;
      if (item.kind === "fixed") {
        const index = Number(item.subjectId.split(":")[1]), raw = stats.raw.fms?.items[index] || {}, original = record.data.fms[index] || {};
        // The fixed FMS item score is ordinal: pain = 0; bilateral items use
        // the lower of two complete side scores. This is a score direction,
        // not a claim about injury probability or overall athletic ability.
        const fixedFMS = M.FM[index]?.[0] === original.name && M.FM[index]?.[1] === original.bilateral;
        add(item.subjectId, { subjectId: item.subjectId, testId: "fms", name: item.name, unit: "分", value: item.value, measurementScale: "ordinal",
          context: { ...testContext(record, "fms"), item: item.subjectId, name: original.name, bilateral: original.bilateral, aggregation: original.bilateral ? "lower-side" : "single", scoring: "fms-0-pain-1-unable-2-compensated-3-uncompensated" }, evaluation: item, direction: fixedFMS ? "higher" : null,
          notes: [original.bilateral ? "左侧 " + (original.left ?? "—") + " / 右侧 " + (original.right ?? "—") : "", raw.pain || item.value === 0 ? "疼痛" : "", original.notes].filter(Boolean).join("；"), pain: raw.pain || item.value === 0, rawTrials: [clone(original)] });
      } else if (item.kind === "iso") {
        const row = stats.isoAnalyses.find(row => row.id === item.directionId), side = item.side === "L" ? "left" : item.side === "R" ? "right" : "center";
        if (!row) continue;
        const group = stats.repetitions.find(group => group.testId === "iso" && group.directionId === row.id && group.side === side), detail = row.sides.find(s => s.side === item.side);
        const measured = row.sides.some(side => N(side.value) !== null || side.pain);
        const strength = M.isoStrengthAssessment(item.value, detail?.target ?? null, { referenceComparison: detail?.referenceComparison, targetKind: detail?.targetKind, unit: row.unit });
        add(item.subjectId + ":" + (item.side || "C"), { subjectId: item.subjectId, testId: "iso", section: "force", groupName: "力量结果", region: row.region, directionId: row.id,
          name: (M.REG[row.region] || row.region) + " · " + item.name + " · " + (detail?.sideLabel || "中线"), unit: item.unit, value: item.value, preserveMissing: measured, measurementScale: "ratio", context: { ...E.isoContext(row, record), side: item.side }, evaluation: item, referenceTarget: detail?.target, referenceSource: detail?.referenceSource, referenceReason: detail?.referenceReason,
          direction: item.applicable && N(item.target) > 0 ? "higher" : null, statistics: group?.statistics[0] ? clone(group.statistics[0]) : null, rawTrials: clone(group?.attempts || []), pain: !!detail?.pain,
          displayEvaluation: { ...item, targetApplicable: item.targetApplicable || item.applicable !== false && detail?.targetKind === "reference" && N(detail.target) > 0,
            targetKind: detail?.targetKind, grade: { status: strength.status, label: root.Def.assessmentLabel(strength.status, "已测"), range: null }, reason: strength.reasons.join("；") },
          notes: [detail?.pain ? "疼痛" : "", row.notes, ...(group?.attempts || []).map(row => row.notes)].filter(Boolean).join("；") });
        if (item.side === "L" && measured) add("asym:" + row.id, { assessmentKind: "asymmetry", testId: "iso", section: "asymmetry", groupName: "双侧差异", region: row.region, directionId: row.id,
          name: (M.REG[row.region] || row.region) + " · " + item.name + " · 双侧差异", unit: "%", value: row.asym, preserveMissing: true, measurementScale: "ratio", context: E.isoContext(row, record),
          evaluation: { grade: { status: row.asymStatus, label: N(row.asym) === null ? "缺少完整双侧结果" : row.weakSide ? (row.weakSide === "L" ? "左" : "右") + "侧更弱" : "双侧一致" }, reason: N(row.asym) === null ? "缺少完整双侧结果" : "", rules: { asymAmber: record.rules.asymAmber, asymRed: record.rules.asymRed } },
          notes: N(row.asym) === null ? "缺少完整双侧结果" : row.weakSide ? (row.weakSide === "L" ? "左" : "右") + "侧更弱" : "双侧一致" });
      } else if (item.kind === "balance") {
        const pair = record.balancePairs.find(pair => pair.id === item.pairId);
        if (!pair) continue;
        const computed = stats.balanceResults.find(result => result.id === pair.id), detail = computed?.results.find(result => result.side === item.side);
        const directions = [pair.numeratorId, pair.denominatorId].map(id => stats.isoAnalyses.find(row => row.id === id));
        if (!directions.some(row => row?.sides.some(side => N(side.value) !== null || side.pain))) continue;
        const reasons = [detail?.reason, detail?.evaluationReason, detail?.referenceReason].filter(Boolean);
        add(item.subjectId + ":" + (item.side || "C"), { subjectId: item.subjectId, testId: "iso", section: "balance", groupName: "关节平衡", region: pair.region, pairId: pair.id,
          name: (M.REG[pair.region] || pair.region) + " · " + item.name + (item.side ? " · " + (item.side === "L" ? "左侧" : "右侧") : ""), value: item.value, preserveMissing: true, unit: item.unit, measurementScale: "ratio", evaluation: item,
          referenceTarget: detail?.referenceTarget, referenceSource: detail?.referenceSource, referenceReason: detail?.referenceReason, notes: [...new Set(reasons)].join("；"), diagnosticNotes: [detail?.evaluationReason, detail?.referenceReason].filter(Boolean),
          balance: { pairId: pair.id, label: pair.label, numeratorId: pair.numeratorId, denominatorId: pair.denominatorId, numerator: clone(computed?.numerator || null), denominator: clone(computed?.denominator || null), referenceEnabled: pair.referenceEnabled, ranges: clone(pair.ranges || []), result: clone(detail || null) },
          context: { side: item.side, numeratorId: pair.numeratorId, denominatorId: pair.denominatorId, confirmed: pair.confirmed, contexts: [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(row => row.id === id); return row ? E.isoContext(row, record) : null; }) } });
      } else if (item.kind === "imtp-time") {
        const existing = result.get(item.metricId);
        if (existing && existing.unit === item.unit && existing.value === item.value) { existing.evaluation = item; existing.displayDefinition = stats.imtpTimeResults.find(result => result.id === item.metricId)?.standard || existing.definition; continue; }
        add(item.subjectId, { subjectId: item.subjectId, testId: "imtp", name: item.name, unit: item.unit, value: item.value, measurementScale: "ratio", evaluation: item, displayDefinition: stats.imtpTimeResults.find(result => result.id === item.metricId)?.standard, context: { ...E.imtpTimeContext(record), timeMs: item.timeMs, unit: item.unit } });
      }
    }
    for (const series of stats.lvpSeries || []) if (record.enabled[series.testId]) for (const point of series.points) {
      const group = stats.repetitions.find(group => group.testId === series.testId && group.key === series.id + ":" + point.load)
        || stats.repetitions.find(group => group.testId === series.testId && group.load === point.load && (!series.side || group.side === series.side));
      const existing = series.side && result.get("landmine_" + series.side.toLowerCase() + point.load);
      if (existing) {
        existing.statistics = group?.statistics[0] ? clone(group.statistics[0]) : null; existing.rawTrials = clone(group?.attempts || []);
        existing.context.velocity = record.lvp[series.id]?.metric || ""; continue;
      }
      add("lvp:" + series.id + ":" + point.load, { testId: series.testId, name: series.label + " · " + point.load + " kg 速度", value: point.velocity, unit: "m/s", measurementScale: "ratio",
        context: { ...testContext(record, series.testId), load: point.load, seriesId: series.id, velocity: record.lvp[series.id]?.metric || "" }, statistics: group?.statistics[0] ? clone(group.statistics[0]) : null, rawTrials: clone(group?.attempts || []) });
    }
    for (const series of stats.lvpSeries || []) if (record.enabled[series.testId] && series.points.length) {
      const context = { ...testContext(record, series.testId), seriesId: series.id, velocity: series.metric }, fit = series.fit || {}, est = series.est;
      const addFit = (id, name, value, unit, scale = "unknown", extra = {}) => add("lvp-fit:" + series.id + ":" + id, { testId: series.testId, name: series.label + " · " + name, value, unit, measurementScale: scale, sourceKind: "model", context, notes: "速度口径 " + series.metric, ...extra });
      addFit("intercept", "回归截距", fit.a, "m/s"); addFit("slope", "回归斜率", fit.b, "(m/s)/kg");
      if (fit.valid) addFit("r2", "拟合 R²", fit.r2, "");
      if (est?.valid) {
        const extra = { context: { ...context, minimumVelocity: series.mvt }, notes: "速度口径 " + series.metric + "；MVT " + series.mvt + " m/s；" + (est.extrapolated ? "含外推" : "实测范围") };
        addFit("1rm", "预估 1RM", est.load, "kg", "ratio", extra);
        if (N(record.athlete.mass) > 0) addFit("relative1rm", "预估 1RM 体重比", est.load / record.athlete.mass, "kg/kg", "ratio", extra);
      }
      for (const zone of series.zoneLoads || []) {
        const zoneContext = { ...context, velocityMin: zone.velocityMin, velocityMax: zone.velocityMax }, label = zone.label || "素质区间", identity = zone.id || label;
        for (const [field, name, unit] of [["velocityMin", "速度下界", "m/s"], ["velocityMax", "速度上界", "m/s"], ["loadMin", "估计负荷下界", "kg"], ["loadMax", "估计负荷上界", "kg"]]) {
          if (field.startsWith("load") && zone.valid === false) continue;
          add("lvp-zone:" + series.id + ":" + identity + ":" + field, { testId: series.testId, name: series.label + " · " + label + " · " + name, value: zone[field], unit, measurementScale: "ratio", sourceKind: "model", context: zoneContext, notes: zone.extrapolated ? "含外推" : "实测范围" });
        }
      }
    }
    for (const stage of stats.raw.lactate || []) for (const [field, name, unit] of [["lactate", "乳酸", "mmol/L"], ["hr", "心率", "bpm"]]) {
      add("lactate:" + stage.speed + ":" + field, { testId: "lactate", name: stage.speed.toFixed(2) + " m/s · " + name, value: stage[field], unit, measurementScale: "ratio", context: { ...testContext(record, "lactate"), speed: stage.speed, field }, notes: stage.notes || "" });
    }
    // Preserve the original fitted-profile and elasticity tables. Model optima and
    // scenarios have separate identities, so they cannot become measured results.
    for (const testId of ["fvp_sj", "fvp_cmj", "sprint_fvp"]) {
      const sprint = testId === "sprint_fvp", solved = sprint ? stats.sprintFvp : stats.fvp[testId];
      if (!record.enabled[testId] || !solved?.valid) continue;
      for (const item of result.values()) if (item.testId === testId) { item.section = "profile"; item.sourceKind = "profile"; }
      const current = sprint ? solved.model : solved.current, optimum = solved.optimum?.valid ? solved.optimum : solved.optimal?.valid ? solved.optimal : null;
      const basicContext = testContext(record, testId), targetContext = { ...basicContext, ...(sprint ? { targetDistanceM: solved.targetDistanceM } : {}) };
      const append = (suffix, name, value, unit, section, sourceKind, context, measurementScale = "unknown", notes = "") => add(testId + ":" + suffix, { testId, name, value, unit, section, sourceKind, context, measurementScale, notes });
      const profileMetrics = [["F0", "力量端 F₀", "N/kg", "ratio"], ["V0", "速度端 V₀", "m/s", "ratio"], ["Pmax", "最大功率 Pmax", "W/kg", "ratio"],
        ...(sprint ? [["F0Absolute", "力量端 F₀ · 绝对", "N", "ratio"], ["PmaxAbsolute", "最大功率 Pmax · 绝对", "W", "ratio"]] : []), ["slope", "剖面斜率 SFV", "(N/kg)/(m/s)", "unknown"]];
      for (const [field, label, unit, scale] of profileMetrics) {
        if (!["F0", "V0", "Pmax"].includes(field)) append("profile:" + field, "实测剖面 · " + label, current?.[field], unit, "profile", "profile", basicContext, scale);
        if (optimum) append("optimum:" + field, "目标最优 · " + label, optimum[field], unit, "profile", "optimum", targetContext, scale);
      }
      if (!sprint) append("profile:r2", "实测剖面 · 拟合 R²", (solved.fit || solved.model)?.r2, "", "profile", "profile", basicContext);
      else {
        const fit = solved.fit || {}, endVelocity = fit.vmax > 0 && fit.tau > 0 ? fit.vmax * (1 - Math.exp(-solved.selected.endTimeS / fit.tau)) : null;
        for (const [field, label, value] of [["Vmax", "速度模型渐近值 Vmax", fit.vmax], ["endVelocity", "终点速度", endVelocity], ["Vopt", "峰值功率对应速度 Vopt", N(current?.V0) === null ? null : current.V0 / 2]]) {
          append("profile:" + field, "实测剖面 · " + label, value, "m/s", "profile", "profile", { ...basicContext, ...(field === "endVelocity" ? { endDistanceM: solved.selected?.endDistanceM } : {}) }, "ratio");
        }
        if (optimum) append("optimum:Vopt", "目标最优 · 峰值功率对应速度 Vopt", N(optimum.V0) === null ? null : optimum.V0 / 2, "m/s", "profile", "optimum", targetContext, "ratio");
      }
      const framework = sprint ? stats.sprintElasticity : solved;
      if (!framework?.valid) continue;
      const modeled = sprint ? framework.current : framework.verticalCurrent || framework.current, scenario = framework.scenario, elasticity = framework.elasticity;
      const elasticContext = { ...basicContext, ...(sprint ? { targetDistanceM: framework.targetDistanceM, methodVersion: framework.methodVersion } : { angle: 90 }) };
      const scenarioContext = { ...elasticContext, deltaForcePct: scenario?.deltaForcePct ?? 0, deltaVelocityPct: scenario?.deltaVelocityPct ?? 0 };
      const fields = [["F0", "力量端 F₀", "N/kg"], ["V0", "速度端 V₀", "m/s"], ["Pmax", "最大功率 Pmax", "W/kg"], [sprint ? "timeS" : "heightCm", sprint ? "模型预测冲刺时间" : "模型预测跳跃高度", sprint ? "s" : "cm"]];
      for (const [field, label, unit] of fields) {
        append("elasticity:" + field, "当前模型 · " + label, modeled?.[field], unit, "elasticity", "model", elasticContext, "ratio");
        if (scenario?.valid) append("scenario:" + field, "情景 · " + label, scenario[field], unit, "scenario", "scenario", scenarioContext, "ratio", `F₀ 改变 ${scenario.deltaForcePct ?? 0}% · V₀ 改变 ${scenario.deltaVelocityPct ?? 0}%`);
      }
      for (const [field, label] of [["Fe", "力量弹性 Fₑ"], ["ve", "速度弹性 vₑ"], ["ER", "弹性比 ER"], ["EN", "弹性范数 EN"]]) {
        append("elasticity:" + field, "当前模型 · " + label, elasticity?.[field], "", "elasticity", "model", elasticContext);
        if (scenario?.valid) append("scenario:" + field, "情景 · " + label, scenario.elasticity?.[field], "", "scenario", "scenario", scenarioContext);
      }
      if (!sprint) {
        append("elasticity:both1pct", "当前模型 · 双端各提高 1%", N(elasticity?.Fe) !== null && N(elasticity?.ve) !== null ? elasticity.Fe + elasticity.ve : null, "%", "elasticity", "model", elasticContext);
        if (scenario?.valid) append("scenario:both1pct", "情景 · 双端各提高 1%", N(scenario.elasticity?.Fe) !== null && N(scenario.elasticity?.ve) !== null ? scenario.elasticity.Fe + scenario.elasticity.ve : null, "%", "scenario", "scenario", scenarioContext);
      }
    }
    return result;
  }
  function change(cells, fromIndex, toIndex, periods, scale) {
    const a = cells[fromIndex], b = cells[toIndex], from = { recordId: periods[fromIndex].id, date: periods[fromIndex].date, value: a?.value ?? null }, to = { recordId: periods[toIndex].id, date: periods[toIndex].date, value: b?.value ?? null };
    const base = { available: false, from, to, improvement: null, reason: "" };
    if (!a || !b || N(a.value) === null || N(b.value) === null) return { ...base, reason: "端点缺测" };
    if (a.contextKey !== b.contextKey) return { ...base, reason: "测量条件不同" };
    const delta = b.value - a.value, percentage = /^(?:%|％)[A-Za-z0-9]*$/.test(b.unit), kind = scale === "ordinal" ? "ordinal" : percentage ? "percentage-point" : "absolute";
    let improvement = delta === 0 ? "unchanged" : null;
    const evaluationMatches = a.evaluationKey === b.evaluationKey;
    if (a.direction && a.direction === b.direction && evaluationMatches && (!a.coverageKey || a.coverageKey === b.coverageKey)) improvement = delta === 0 ? "unchanged" : delta * (a.direction === "higher" ? 1 : -1) > 0 ? "improved" : "declined";
    const gradeRank = cell => ({ red: 1, amber: 2, green: 3 })[cell.evaluation?.grade?.status], gradeChange = gradeRank(b) - gradeRank(a);
    if (improvement === "improved" && gradeChange < 0 || improvement === "declined" && gradeChange > 0) improvement = null;
    if (!evaluationMatches) improvement = null;
    return { ...base, available: true, delta, ...(scale === "ratio" && !percentage && a.value > 0 ? { percent: delta / a.value * 100 } : {}), kind, improvement, reason: evaluationMatches ? "" : "评价条件不同" };
  }
  function rowFrom(id, cells, periods) {
    const latest = cells.slice().reverse().find(Boolean), unit = latest.unit || "", scale = latest.measurementScale || "unknown";
    const normalized = cells.map(cell => {
      if (!cell) return null;
      const factor = M.unitFactor(cell.unit || "", unit), converted = factor !== null;
      const next = { ...cell, unit: converted ? unit : cell.unit, value: N(cell.value) === null ? null : converted ? cell.value * factor : cell.value };
      if (converted && cell.statistics) next.statistics = { ...cell.statistics, mean: N(cell.statistics.mean) === null ? null : cell.statistics.mean * factor, sd: N(cell.statistics.sd) === null ? null : cell.statistics.sd * Math.abs(factor) };
      const context = clone(cell.context || {});
      if (converted && Object.hasOwn(context, "unit")) context.unit = unit;
      if (converted && context.force?.unit) context.force.unit = unit;
      next.contextKey = canonical({ context: JSON.parse(signature(context)), unit: next.unit, scale: cell.measurementScale || "unknown" });
      const evaluation = cell.evaluation || {}, reference = evaluation.reference || {}, scaleTarget = value => N(value) === null ? null : value * (converted ? factor : 1);
      next.evaluationKey = cell.evaluationKey || canonical({ target: scaleTarget(evaluation.target), source: evaluation.source || "", reference: { groupId: reference.groupId || "", sourceId: reference.sourceId || "", kind: reference.kind || "" },
        ranges: (cell.definition?.ranges || []).map(range => ({ min: scaleTarget(range.min), max: scaleTarget(range.max), includeMin: range.includeMin, includeMax: range.includeMax, status: range.status })) });
      const grade = evaluation.grade || {}, status = grade.status || cell.status || "gray";
      next.assessment = { status: ["red", "amber", "green", "gray"].includes(status) ? status : "gray",
        label: grade.label || cell.judgment || (N(cell.value) === null ? "未测" : "未设置评价"),
        reason: evaluation.reason || cell.referenceReason || (N(cell.value) === null ? cell.notes || "缺少有效测量" : ""),
        target: scaleTarget(evaluation.target ?? cell.target), referenceTarget: scaleTarget(cell.referenceTarget), referenceSource: cell.referenceSource || evaluation.source || "",
        attainment: N(evaluation.attainment ?? cell.attainment), ...(evaluation.reference ? { reference: clone(evaluation.reference) } : {}) };
      next.display = root.RingsideResultDisplay.assessment(next, converted ? factor : 1);
      return next;
    });
    normalized.forEach((cell, i) => { if (cell) cell.comparableToPrevious = !!(i && normalized[i - 1] && cell.contextKey === normalized[i - 1].contextKey); });
    return { id, metricId: latest.metricId || id, subjectId: latest.subjectId || id, testId: latest.testId, name: latest.name, unit, measurementScale: scale,
      ...Object.fromEntries(["section", "sourceKind", "groupName", "region", "directionId", "pairId", "parentId"].filter(key => latest[key] !== undefined).map(key => [key, latest[key]])), cells: normalized,
      changes: { overall: change(normalized, 0, periods.length - 1, periods, scale), recent: periods.length > 2 ? change(normalized, periods.length - 2, periods.length - 1, periods, scale) : null } };
  }
  function matrixRows(maps, periods) {
    return [...new Set(maps.flatMap(map => [...map.keys()]))].map(id => rowFrom(id, maps.map(map => map.get(id) || null), periods));
  }
  function changeSummary(projects, periods) {
    const endpoint = period => ({ recordId: period.id, date: period.date, label: period.label });
    const summary = { from: endpoint(periods[0]), to: endpoint(periods.at(-1)), improved: [], declined: [] }, seen = new Set();
    for (const project of projects) for (const row of project.metrics) {
      const change = row.changes.overall, identity = project.id + ":" + row.id;
      if (seen.has(identity) || !change.available || !["improved", "declined"].includes(change.improvement) || ["optimum", "model", "scenario"].includes(row.sourceKind)) continue;
      seen.add(identity);
      const name = row.testId === "fms" ? row.name + "评分" : row.name;
      summary[change.improvement].push({ id: row.id, metricId: row.metricId, subjectId: row.subjectId, testId: row.testId, projectName: project.name, name,
        label: project.name + " · " + name, unit: row.unit, measurementScale: row.measurementScale, change: clone(change),
        pain: { from: !!row.cells[0]?.pain, to: !!row.cells.at(-1)?.pain } });
    }
    return summary;
  }
  function radar(periods, kind) {
    const maps = periods.map(period => {
      const result = new Map();
      if (kind === "risk") {
        for (const [region, detail] of Object.entries(period.stats.signals.regions)) {
          const tests = (detail.tests || []).filter(test => test.hasMeasured);
          if (!tests.length) continue;
          const coverage = tests.map(test => {
            const iso = test.testId === "iso" && period.record.data.iso.find(row => test.id.startsWith(row.id + "_"));
            const definition = period.record.definitions.find(d => d.id === test.id);
            return { id: test.id, testId: test.testId, side: test.side, unit: test.unit, context: iso ? E.isoContext(iso, period.record) : definition ? metricContext(period.record, definition, period.stats) : testContext(period.record, test.testId, period.stats) };
          }).sort((a, b) => a.id.localeCompare(b.id));
          result.set(region, { assessmentKind: "screening", value: riskScore[detail.status] ?? null, unit: "分", name: riskOrder.find(([key]) => key === region)?.[1] || region, measurementScale: "ordinal", context: { region }, direction: "higher", coverageKey: canonical(coverage), evaluationKey: canonical(tests.map(test => ({ id: test.id, target: test.target, kind: test.targetKind, source: test.referenceSource }))), tests: clone(tests), pain: tests.some(test => test.pain), evaluation: { grade: { status: detail.status, label: detail.label } }, notes: detail.detail || "" });
        }
      } else for (const axis of period.stats.axes) result.set(axis.key, { ...axis, name: axis.label, value: N(axis.value), overviewReference: root.RingsideResultDisplay.abilityReference(axis, period.record), unit: "分", measurementScale: "interval", context: { members: axis.members, method: axis.method, transforms: axis.transforms }, direction: null });
      return result;
    });
    const keys = kind === "risk" ? riskOrder.map(([id]) => id).filter(id => maps.some(map => map.has(id))) : [...new Set(maps.flatMap(map => [...map.keys()]))];
    const rows = keys.map(id => rowFrom(id, maps.map(map => map.get(id) || null), periods));
    if (kind === "risk") rows.forEach(row => {
      for (const comparison of [row.changes.overall, row.changes.recent].filter(Boolean)) {
        const fromIndex = periods.findIndex(period => period.id === comparison.from.recordId), toIndex = periods.findIndex(period => period.id === comparison.to.recordId);
        if (row.cells[fromIndex]?.coverageKey !== row.cells[toIndex]?.coverageKey) { comparison.improvement = null; if (comparison.available) comparison.reason = "参与测试不同"; }
      }
    });
    return { axes: rows.map(row => ({ key: row.id, label: row.name })), rows,
      series: periods.map((period, index) => ({ id: period.id, recordId: period.id, label: period.label, color: period.color, values: rows.map(row => row.cells[index]?.value ?? null), cells: rows.map(row => row.cells[index]) })) };
  }
  function capability(periods) {
    const cards = new Map();
    for (const period of periods) for (const card of period.stats.capabilityCards) cards.set(card.id, card);
    return { cards: [...cards.values()].map(card => {
      const maps = periods.map(period => {
        const original = period.stats.capabilityCards.find(item => item.id === card.id), metrics = [];
        for (const metric of original?.metrics || []) {
          const variants = metric.id === "idsi" ? (period.stats.derived?.results || []).filter(result => ["idsi_matched", "idsi_fixed250"].includes(result.id) && N(result.value) !== null)
            .map(result => ({ ...result, label: M.capabilityDirectionOptions.strength.find(([id]) => id === result.id)?.[1] || result.name, judgment: result.directionHint, status: "gray" })) : [];
          for (const item of variants.length ? variants : [metric]) {
            metrics.push(item);
            // The personal report exposes these measured components beneath the
            // parameter; retain them as explicit rows as well as in the card.
            if (card.id !== "speed") (item.components || []).forEach((component, index) => {
              if (N(component.value) !== null) metrics.push({ ...component, id: item.id + ":component:" + (component.id || index), metricId: component.id,
                parentId: item.id, label: item.label + " · " + component.label, componentContextId: item.selectedVariant || item.id });
            });
          }
        }
        return new Map(metrics.map(metric => {
        const dependentContext = derivedContext(period.record, metric.selectedVariant || metric.id, period.stats);
        const source = period.record.definitions.find(d => d.id === (metric.metricId || metric.id));
        const testId = source?.testId || (metric.id.startsWith("fvp_") ? metric.id.startsWith("fvp_cmj") ? "fvp_cmj" : "fvp_sj" : metric.id.startsWith("sprint_") ? "sprint_fvp" : null);
        const componentContext = metric.componentContextId ? derivedContext(period.record, metric.componentContextId, period.stats) : {};
        const context = { selectedVariant: metric.selectedVariant || "", ...(dependentContext.protocols ? dependentContext : { ...dependentContext, ...(testId ? { test: source ? metricContext(period.record, source, period.stats) : testContext(period.record, testId, period.stats) } : {}) }), ...componentContext, unit: metric.unit,
          ...(metric.id.startsWith("sprint_elasticity") ? { targetDistanceM: period.record.sprintFvpAnalysis?.targetDistanceM } : {}) };
        // Some derived parameters are present only in the capability result;
        // a separate unmeasured catalog slot must not label that result "未录入".
        const evaluation = period.stats.evaluationResults.find(item => item.metricId === (metric.metricId || metric.id) && N(item.value) !== null);
        const target = N(metric.target) > 0 ? N(metric.target) : source?.referenceEnabled && source.matched !== false && N(source.target) > 0 ? N(source.target) : null;
        return [metric.id, { ...metric, name: metric.label, value: metric.value, unit: metric.unit, measurementScale: source ? E.measurementScale(source) : "unknown", context, direction: null, displayRules: displayRules(period.record),
          evaluation: evaluation || { grade: { status: metric.status || "gray", label: metric.judgment || "未设置评价" }, target, source: source?.source || "" },
          target, displayDefinition: source, diagnosticNotes: [metric.judgment].filter(Boolean), notes: metric.judgment || "", components: clone(metric.components || []) }];
        }));
      });
      return { id: card.id, title: card.title, metrics: matrixRows(maps, periods), periods: periods.map(period => ({ periodId: period.id,
        card: clone(period.stats.capabilityCards.find(item => item.id === card.id) || null),
        direction: clone(M.capabilityDirections(period.record, period.stats).find(item => item.id === (card.id === "cardio" ? "endurance" : card.id) && item.hasData) || null) })) };
    }), periods: periods.map(period => ({ id: period.id, cards: period.stats.capabilityCards, directions: M.capabilityDirections(period.record, period.stats) })), analyses: analysisModules(periods) };
  }
  function analysisModules(periods) {
    const modules = [];
    for (const id of ["fvp_sj", "fvp_cmj", "sprint_fvp"]) {
      const sprint = id === "sprint_fvp", hasInput = period => period.record.enabled[id] && (sprint
        ? (period.stats.sprintFvp?.trials || period.record.data[id] || []).some(row => row.splits?.some(split => N(split.timeS) !== null || N(split.distanceM) !== null) || row.notes)
        : (period.record.data[id] || []).some(row => N(row.height) !== null || N(row.load) !== null || row.notes));
      if (!periods.some(hasInput)) continue;
      for (const elasticity of [false, true]) {
        const kind = sprint ? elasticity ? "sprint-elasticity" : "sprint-fvp" : elasticity ? "jump-elasticity" : "jump-fvp";
        modules.push({ id: id + (elasticity ? ":elasticity" : ":profile"), testId: id, kind,
          title: sprint ? elasticity ? "冲刺FVP弹性框架" : "冲刺FVP" : (elasticity ? "跳跃FVP弹性框架" : "跳跃FVP") + " · " + (id === "fvp_cmj" ? "CMJ" : "SJ"),
          periods: periods.map(period => {
            const present = hasInput(period), solved = present ? sprint ? elasticity ? period.stats.sprintElasticity : period.stats.sprintFvp : period.stats.fvp?.[id] : null;
            return { periodId: period.id, available: !!solved?.valid, reason: solved?.valid ? "" : solved?.reason || "本期未测", solved: solved || null,
              config: sprint ? period.record.sprintFvpConfig : period.record.fvpConfig?.[id], analysis: sprint ? period.record.sprintFvpAnalysis : period.record.fvpAnalysis?.[id],
              view: sprint ? period.record.sprintFvpView : period.record.fvpView?.[id], ...(sprint && !elasticity ? { confidence: period.report.sprintFvpConfidence || null } : {}) };
          }) });
      }
    }
    return modules;
  }
  function build(input, options = {}) {
    if (!Array.isArray(input) || input.length < 2) throw Error("纵向比较至少选择两条测试记录");
    if (input.some(record => !record?.recordId || !validDate(record.athlete?.date))) throw Error("纵向比较需要有效测试日期和记录标识");
    if (new Set(input.map(record => record.recordId)).size !== input.length) throw Error("不能重复选择同一测试记录");
    const records = sortRecords(input.map(clone)), athleteId = options.athleteId || records[0].athleteId;
    if (!athleteId || records.some(record => record.athleteId !== athleteId)) throw Error("纵向比较只支持同一名队员");
    const latest = records.at(-1), mode = options.mode ?? latest.mode ?? "best", profile = options.profile ? clone(options.profile) : null, catalog = options.catalog ? clone(options.catalog) : null;
    if (!["best", "mean"].includes(mode)) throw Error("代表成绩须为最佳值或均值");
    const dateCounts = records.reduce((counts, record) => ({ ...counts, [record.athlete.date]: (counts[record.athlete.date] || 0) + 1 }), {});
    const sameDateIndex = {};
    const periods = records.map((source, index) => {
      let record = M.normalizeRecord(clone(source)); record.mode = mode; M.applyAge(record);
      record = E.resolve(record, profile);
      sameDateIndex[record.athlete.date] = (sameDateIndex[record.athlete.date] || 0) + 1;
      const report = root.RingsideReport.build(record, { catalog }), label = record.athlete.date + (dateCounts[record.athlete.date] > 1 ? " · " + sameDateIndex[record.athlete.date] + (source.title ? " " + source.title : "") : "");
      return { id: source.recordId, recordId: source.recordId, date: record.athlete.date, label, color: colors[index % colors.length], record: report.record, report, stats: report.stats };
    });
    const allRows = matrixRows(periods.map(observations), periods), descriptors = new Map();
    for (const period of periods) for (const project of period.report.projects) descriptors.set(project.id, project);
    const projects = [...descriptors.values()].map(project => ({ ...project, testIds: [project.id], metrics: allRows.filter(row => row.testId === project.id), periods: periods.map(period => {
      const current = period.report.projects.find(item => item.id === project.id); return current ? { periodId: period.id, project: current, report: period.report } : null;
    }) })).filter(project => project.metrics.length || periods.some(period => period.stats.validTests.has(project.id)));
    const basis = contentHash(canonical({ version: 1, athleteId, mode, records: periods.map(period => ({ id: period.id, date: period.date, fingerprint: M.fingerprint(period.record) })), profile, catalog }));
    return { kind: "longitudinal", version: 1, key: key(athleteId, records.map(record => record.recordId)), athleteId, athlete: clone(periods.at(-1).record.athlete), mode, profile, catalog, records, recordIds: records.map(record => record.recordId), basis, fingerprint: basis,
      periods, projects, changeSummary: changeSummary(projects, periods), groups: T.groups(projects, periods.at(-1).record), risk: radar(periods, "risk"), overview: radar(periods, "overview"), capability: capability(periods) };
  }
  function facts(model) {
    const measurementContexts = [], contextIndexes = new Map();
    const contextIndex = cell => {
      const identity = canonical(cell.context || {});
      if (!contextIndexes.has(identity)) { contextIndexes.set(identity, measurementContexts.length); measurementContexts.push(clone(cell.context || {})); }
      return contextIndexes.get(identity);
    };
    const compactChange = change => !change ? null : { available: change.available, fromIndex: model.recordIds.indexOf(change.from.recordId), toIndex: model.recordIds.indexOf(change.to.recordId),
      ...(change.available ? { delta: change.delta, ...(change.percent === undefined ? {} : { percent: change.percent }), kind: change.kind, improvement: change.improvement } : {}), ...(change.reason ? { reason: change.reason } : {}) };
    const rows = metrics => metrics.map(row => ({ id: row.id, name: row.name, unit: row.unit, measurementScale: row.measurementScale, ...(row.sourceKind ? { sourceKind: row.sourceKind } : {}),
      results: row.cells.map(cell => !cell ? null : ({ value: cell.value, ...(cell.unit !== row.unit ? { unit: cell.unit } : {}), comparableToPrevious: cell.comparableToPrevious, contextIndex: contextIndex(cell),
        ...(cell.statistics?.n >= 3 ? { statistics: Object.fromEntries(["n", "mean", "sd", "cv"].map(key => [key, cell.statistics[key]])) } : {}), ...(cell.evaluation?.grade ? { evaluation: { status: cell.evaluation.grade.status, label: cell.evaluation.grade.label } } : {}), ...(cell.notes ? { notes: cell.notes } : {}),
        ...(cell.tests ? { tests: cell.tests.map(test => ({ id: test.id, name: test.name, value: test.value, unit: test.unit, status: test.status, pain: !!test.pain })) } : {}) })), changes: { overall: compactChange(row.changes.overall), ...(row.changes.recent ? { recent: compactChange(row.changes.recent) } : {}) } }));
    return { type: "single-athlete-longitudinal", resultOrder: "Each results array follows periods; change indexes are zero-based indexes into periods. Result contextIndex references measurementContexts; optimum, model and scenario values are predictions, separate from fitted profiles.", measurementContexts, athlete: clone(model.athlete), mode: model.mode, profile: model.profile ? { id: model.profile.id, name: model.profile.name, revision: model.profile.revision } : null,
      periods: model.periods.map(period => ({ recordId: period.id, date: period.date, label: period.label, athlete: clone(period.record.athlete), trainingContext: clone(period.record.trainingContext), qualityIssues: period.stats.qualityIssues })),
      projects: model.projects.map(project => ({ id: project.id, name: project.name, metrics: rows(project.metrics) })), risk: rows(model.risk.rows), overview: rows(model.overview.rows), capability: model.capability.cards.map(card => ({ id: card.id, title: card.title, metrics: rows(card.metrics) })) };
  }
  root.RingsideLongitudinal = { build, key, facts, validDate, sortRecords, change };
})(typeof window !== "undefined" ? window : globalThis);
