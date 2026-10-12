(function (global) {
  "use strict";
  const KINDS = [
    { id: "bars", label: "成绩条形图", description: "按原始数值展示；不同单位分别绘图。" },
    { id: "trials", label: "重复试次点图", description: "显示真实试次，不连接成趋势线。" },
    { id: "target", label: "实测与目标", description: "仅比较当前适用且有效的参考目标。" },
  ];
  const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
  const plain = value => value && typeof value === "object" && !Array.isArray(value)
    && Object.prototype.toString.call(value) === "[object Object]";
  const copy = value => JSON.parse(JSON.stringify(value));
  function kinds() { return copy(KINDS); }
  function normalizeConfig(raw) {
    const config = plain(raw) ? raw : {};
    return { version: 1, enabled: config.enabled === true,
      kind: KINDS.some(kind => kind.id === config.kind) ? config.kind : "bars",
      metricIds: [...new Set((Array.isArray(config.metricIds) ? config.metricIds : []).filter(safeId))] };
  }
  function validateConfig(raw, definitions = [], options = {}) {
    if (raw === undefined || raw === null) return [];
    const issues = [], issue = (path, code, message) => issues.push({ path: "visualization." + path, code, message });
    if (!plain(raw)) { issue("", "invalid-object", "图表设置必须是对象。"); return issues; }
    if (raw.version !== undefined && raw.version !== 1) issue("version", "unsupported-version", "暂不支持此图表设置版本。");
    if (typeof raw.enabled !== "boolean") issue("enabled", "invalid-enabled", "请选择是否显示图表。");
    if (!KINDS.some(kind => kind.id === raw.kind)) issue("kind", "invalid-kind", "请选择支持的图表样式。");
    if (!Array.isArray(raw.metricIds)) issue("metricIds", "invalid-metrics", "请选择要展示的指标。");
    else {
      if (raw.metricIds.some(id => !safeId(id))) issue("metricIds", "unsafe-id", "图表指标编号无效。");
      if (new Set(raw.metricIds).size !== raw.metricIds.length) issue("metricIds", "duplicate-id", "图表指标不能重复选择。");
      if (raw.enabled === true) {
        if (!raw.metricIds.length) issue("metricIds", "empty-metrics", "请至少选择一个图表指标。");
        const metrics = definitions.filter(metric => !options.testId || metric.testId === options.testId);
        if (raw.metricIds.some(id => !metrics.some(metric => metric.id === id)))
          issue("metricIds", "unknown-metric", "所选图表指标不属于本项目，或已被移除。");
        if (raw.kind === "trials" && options.repeatable === false)
          issue("kind", "not-repeatable", "本项目不保存重复试次，请选择其他图表样式。");
      }
    }
    return issues;
  }
  const number = value => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const side = value => ["left", "right", "L", "R"].includes(value) ? ({ L: "left", R: "right" }[value] || value) : null;
  const sideLabel = value => value === "left" ? "左侧" : value === "right" ? "右侧" : "";
  const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
  function buildProject(record, stats, project) {
    const config = normalizeConfig(project?.visualization), figures = [], issues = [];
    const result = { enabled: config.enabled, kind: config.kind, figures, issues };
    if (!config.enabled) return result;
    if (project?.renderer !== "scalar") {
      issues.push({ code: "fixed-native-chart", message: "本项目使用固定图表，通用图表设置不替换其计算与展示。" });
      return result;
    }
    const definitions = (project.definitions || []).filter(metric => metric.testId === project.id);
    const invalid = validateConfig(project.visualization, definitions, { testId: project.id });
    if (invalid.length) { issues.push(...invalid); return result; }
    const selected = config.metricIds.map(id => definitions.find(metric => metric.id === id));
    const issue = (metric, code, message) => issues.push({ metricId: metric.id, name: metric.name, code, message });
    const entry = metric => ({ metricId: metric.id, name: metric.name || metric.id, unit: String(metric.unit || ""),
      value: number(stats.values?.[metric.id]), side: side(metric.side), sideLabel: sideLabel(side(metric.side)) });
    if (config.kind === "trials") {
      for (const metric of selected) {
        const groups = (stats.repetitions || []).filter(group => group.testId === project.id && group.fields?.some(field => field.id === metric.id));
        if (!groups.length) { issue(metric, "no-attempt-data", "未保存该指标的重复试次，无法绘制试次点图。"); continue; }
        let available = false;
        for (const group of groups) {
          const points = (group.attempts || []).map(attempt => ({ id: attempt.id, index: attempt.index,
            value: number(attempt.observations?.[metric.id]), selected: (group.selectedIds || []).includes(attempt.id),
            missing: number(attempt.observations?.[metric.id]) === null,
            reason: number(attempt.observations?.[metric.id]) !== null ? "" : attempt.values?.[metric.id] === "" || attempt.values?.[metric.id] == null ? "未填写" : "数值无效" }));
          const valid = points.filter(point => point.value !== null);
          if (!valid.length) { issue(metric, "no-valid-attempts", "已保存试次，但没有有效数值，无法绘制试次点图。"); continue; }
          available = true;
          const missing = points.filter(point => point.missing);
          if (missing.length) issue(metric, "missing-attempts", `第 ${missing.map(point => point.index).join("、")} 次未填写或数值无效，图中保留试次位置，不绘制数值。`);
          const batches = chunks(points, 6);
          for (const [index, batch] of batches.entries()) figures.push({ kind: "trials", metricId: metric.id,
            title: metric.name || metric.id, unit: String(metric.unit || ""), side: side(metric.side),
            groupKey: group.key, points: batch, range: [Math.min(...valid.map(point => point.value)), Math.max(...valid.map(point => point.value))],
            selection: record.mode === "mean" ? "本次使用有效试次平均" : "本次按项目规则选取代表试次",
            pageLabel: batches.length > 1 ? `试次 ${batch[0].index}–${batch[batch.length - 1].index}` : "" });
        }
        if (!available) continue;
      }
      return result;
    }
    const byUnit = new Map();
    for (const metric of selected) {
      const row = entry(metric);
      if (row.value === null) {
        const group = (stats.repetitions || []).find(group => group.testId === project.id && group.fields?.some(field => field.id === metric.id));
        const hasRaw = group?.attempts?.some(attempt => number(attempt.observations?.[metric.id]) !== null);
        const reason = hasRaw && !group.selectedIds?.length ? "主指标没有有效试次，未能选出本次成绩。"
          : hasRaw ? "按项目规则选中的代表试次缺少该指标，本次结果缺测。" : "本次没有有效成绩。";
        issue(metric, "missing-result", reason + "图中不以零代替缺测。"); continue;
      }
      if (config.kind === "target") {
        const evaluation = (stats.evaluationResults || []).find(item => item.kind === "metric" && item.metricId === metric.id);
        if (!evaluation || evaluation.applicable === false || evaluation.targetApplicable !== true || evaluation.reference?.eligible === false) {
          issue(metric, "inapplicable-target", evaluation?.reason || evaluation?.reference?.reason || "本次没有启用且适用的参考目标。"); continue;
        }
        const target = number(evaluation.target);
        if (target === null || target <= 0) { issue(metric, "missing-target", "本次未设置有效参考目标，无法绘制目标比较。"); continue; }
        if (String(evaluation.unit || "") !== row.unit) { issue(metric, "target-unit-mismatch", "成绩与参考目标单位不一致，无法直接比较。"); continue; }
        if (!["higher", "lower"].includes(evaluation.direction)) { issue(metric, "invalid-target-direction", "参考目标的比较方向无效。"); continue; }
        Object.assign(row, { target, direction: evaluation.direction, source: evaluation.source || "" });
      }
      const key = row.unit || "unknown-unit:" + row.metricId;
      if (!byUnit.has(key)) byUnit.set(key, []);
      byUnit.get(key).push(row);
      if (!row.unit) issue(metric, "missing-unit", "未填写单位；该指标单独绘图，不与其他指标合并。");
    }
    for (const rows of byUnit.values()) {
      const rangeValues = rows.flatMap(row => config.kind === "target" ? [row.value, row.target] : [row.value]);
      const range = [Math.min(0, ...rangeValues), Math.max(0, ...rangeValues)];
      for (const batch of chunks(rows, 6)) figures.push({ kind: config.kind, title: config.kind === "target" ? "实测与参考目标" : "本次成绩",
        unit: batch[0].unit, rows: batch, range, paired: batch.some(row => row.side === "left") && batch.some(row => row.side === "right"),
        selection: record.mode === "mean" ? "本次成绩按项目规则取平均" : "本次成绩按项目规则选取" });
    }
    return result;
  }
  global.RingsideGenericViz = { normalizeConfig, validateConfig, kinds, buildProject };
})(typeof window !== "undefined" ? window : globalThis);
