(function (root) {
  "use strict";
  const C = root.RingsideComparison, E = root.RingsideEvaluation, M = root.RingsideModel, S = root.RingsideMetricSemantics;
  if (!C) throw Error("请先加载共享测试结果计算");
  const clone = value => JSON.parse(JSON.stringify(value));
  function resolvedStandard(cell, period, unit) {
    const record = period.record, factor = M.unitFactor(cell.unit || "", unit || "") ?? 1;
    const scale = value => root.Calc.num(value) === null ? null : value * factor;
    const ranges = values => (values || []).map(range => ({ ...clone(range), min: scale(range.min), max: scale(range.max) }));
    const rules = Object.fromEntries(["scoreAmber", "scoreGreen", "asymAmber", "asymRed"].map(key => [key, record.rules[key]]));
    const match = record.evaluationStandards?.find(item => item.subjectId === cell.subjectId);
    const base = { subjectId: cell.subjectId || cell.metricId || cell.id, unit: unit || "", ruleId: match?.ruleId || "", revision: record.evaluationProfileRevision || 0, rules,
      ruleEnabled: match?.enabled === true, applicabilityReason: match?.reason || "" };
    if (cell.aggregation?.evaluator === "fixed-fms") return { ...base, kind: "fixed-fms", enabled: true, applicable: true };
    if (cell.section === "asymmetry") return { ...base, kind: "asymmetry", enabled: true, applicable: true };
    if (cell.section === "force") {
      const row = record.data.iso.find(item => item.id === cell.directionId), side = cell.context?.side || "";
      if (!row) return null;
      const target = M.effectiveIsoTarget(record, row, side);
      return { ...base, kind: "iso", enabled: target.target !== null, applicable: target.matched !== false, target: scale(target.target), targetKind: target.kind,
        referenceBasis: target.basis || "", referenceGroup: target.group || null, sideKey: target.sideKey || side, source: target.source || "" };
    }
    if (cell.section === "balance") {
      const pair = record.balancePairs.find(item => item.id === cell.pairId);
      return pair ? { ...base, kind: "balance", enabled: pair.referenceEnabled === true, applicable: match?.applicable !== false, ranges: ranges(pair.ranges), source: pair.source || "" } : null;
    }
    const definition = cell.definition || cell.displayDefinition || record.definitions.find(d => d.id === cell.metricId || d.id === cell.id);
    if (!definition) return null;
    const missingGroup = definition.referenceMatch && !definition.referenceMatch.groupId;
    return { ...base, kind: "metric", enabled: definition.referenceEnabled === true, applicable: match?.applicable !== false && !missingGroup,
      applicabilityReason: missingGroup ? definition.referenceMatch.reason || "没有匹配的分层标准" : base.applicabilityReason,
      targetEnabled: definition.targetEnabled !== false, target: scale(definition.target), ranges: ranges(definition.ranges), direction: definition.direction || "higher",
      measurementScale: E.measurementScale(definition), zeroValid: definition.zeroValid === true || definition.id === "pushup_reps", ability: definition.ability || "", source: definition.source || "", referenceGroupId: definition.referenceMatch?.groupId || "" };
  }
  function horizontalCell(cell, period, catalog, unit = cell?.unit || "") {
    if (!cell) return null;
    const normalized = C.rowFrom(cell.id || cell.metricId || cell.name, [cell], [period]).cells[0];
    const metricId = cell.metricId || cell.id;
    const rawDefinition = period.source?.definitions?.find(d => d.id === metricId) || period.record.definitions.find(d => d.id === metricId);
    const catalogDefinition = catalog?.definitions?.find(d => {
      if (d.id !== metricId) return false;
      if (!rawDefinition) return true;
      const originalContext = E.measurementContext(period.source || period.record, rawDefinition), catalogContext = E.measurementContext(period.source || period.record, d);
      if (M.unitFactor(originalContext.unit, catalogContext.unit) !== null) originalContext.unit = catalogContext.unit;
      return E.contextSignature(originalContext) === E.contextSignature(catalogContext);
    });
    const fallback = { id: cell.id, testId: cell.testId, resultMeaning: cell.measurementScale === "ordinal" ? "ordinal" : "numeric",
      direction: "none", directionStatus: "confirmed" };
    const semantics = S.resolve(rawDefinition || cell.canonicalDefinition || fallback, { catalogDefinition, evaluation: cell.evaluation });
    const factor = M.unitFactor(normalized.unit, unit), next = clone(normalized);
    if (factor !== null) {
      next.unit = unit; if (next.value !== null) next.value *= factor;
      if (next.statistics) { if (next.statistics.mean !== null) next.statistics.mean *= factor; if (next.statistics.sd !== null) next.statistics.sd *= Math.abs(factor); }
    }
    const context = clone(cell.context || {}), subjectInputs = {};
    // A regional screening grade is meaningful only for the same observed tests.
    if (cell.coverageKey) context.measurementCoverage = cell.coverageKey;
    const subjectKeys = root.RingsideTests.describe(period.source || period.record).find(test => test.id === cell.testId)?.comparisonSubjectInputs || [];
    function visit(value, path = "") {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if ((key === "settings" || key === "testSettings") && item && typeof item === "object") for (const field of subjectKeys) if (Object.hasOwn(item, field)) { subjectInputs[path + key + "." + field] = item[field]; delete item[field]; }
        visit(item, path + key + ".");
      }
    }
    visit(context);
    if (factor !== null && Object.hasOwn(context, "unit")) context.unit = unit;
    if (factor !== null && context.force?.unit) context.force.unit = unit;
    next.contextKey = E.canonical({ context: JSON.parse(E.contextSignature(context)), unit: next.unit, scale: cell.measurementScale || "unknown", meaning: semantics.meaning });
    next.comparisonContext = context; next.subjectInputs = subjectInputs;
    next.semantics = semantics; next.direction = semantics.direction; next.meaning = semantics.meaning;
    next.resolvedStandard = resolvedStandard(cell, period, next.unit);
    delete next.comparableToPrevious;
    return next;
  }
  function difference(value, reference, scale, unit) {
    if (root.Calc.num(value) === null || root.Calc.num(reference) === null) return { available: false, reason: "缺少有效参照" };
    const rawDelta = value - reference, tolerance = Number.EPSILON * Math.max(Math.abs(value), Math.abs(reference), Number.MIN_VALUE) * 16;
    const delta = Math.abs(rawDelta) <= tolerance ? 0 : rawDelta, percentage = /^(?:%|％)[A-Za-z0-9]*$/.test(unit || "");
    return { available: true, delta, kind: scale === "ordinal" ? "ordinal" : percentage ? "percentage-point" : "absolute",
      ...(scale === "ratio" && !percentage && reference > 0 ? { percent: delta / reference * 100 } : {}),
      relation: delta === 0 ? "equal" : delta > 0 ? "higher" : "lower" };
  }
  Object.assign(C, { horizontalCell, difference, resolvedStandard });
})(typeof window !== "undefined" ? window : globalThis);
