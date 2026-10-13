(function (root) {
  "use strict";
  const kinds = ["none", "bar", "column", "trials", "scatter", "target", "radar"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => !!value && Object.prototype.toString.call(value) === "[object Object]";
  const safe = value => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= 249 && !["__proto__", "constructor", "prototype"].includes(value);
  const num = value => root.Calc.num(value);
  const none = () => ({ version: 1, kind: "none", metricIds: [] });
  const scope = definition => definition.entryScope === "attempt" ? "attempt" : "record";
  const identity = value => plain(value) && safe(value.id) && Number.isSafeInteger(value.version) && value.version >= 1 && Object.keys(value).every(key => ["id", "version"].includes(key));
  const sameIdentity = (left, right) => identity(left) && identity(right) && left.id === right.id && left.version === right.version;
  const projects = source => root.RingsideTests.describe(source);
  const generic = (source, id) => projects(source).find(project => project.id === id && project.renderer === "scalar");
  function signature(source, testId, metricIds) {
    const M = root.RingsideModel;
    return {
      testId,
      projectProtocol: clone(source.protocolIdentities?.[testId] || M.protocolIdentity("test:" + testId, source.protocol?.[testId] || "")),
      metrics: metricIds.map(id => {
        const d = source.definitions.find(definition => definition.id === id && definition.testId === testId);
        if (!d) throw Error("报告图表包含未知指标：" + id);
        return { id, unit: d.unit || "", entryScope: scope(d), protocolIdentity: clone(d.protocolIdentity || M.protocolIdentity("metric:" + id, d.protocol || "")) };
      }),
    };
  }
  function validateView(view, testId, source) {
    if (!plain(view) || view.version !== 1 || !kinds.includes(view.kind) ||
        Object.keys(view).some(key => !["version", "kind", "metricIds", "xMetricId", "yMetricId", "binding"].includes(key))) throw Error("报告图表格式或类型无效");
    if (!safe(testId) || source && !generic(source, testId)) throw Error("报告图表对应的通用项目不存在");
    if (!Array.isArray(view.metricIds) || view.metricIds.length > 300 || view.metricIds.some(id => !safe(id)) || new Set(view.metricIds).size !== view.metricIds.length) throw Error("报告图表指标列表无效");
    if (view.kind === "none" && view.metricIds.length || view.kind !== "none" && !view.metricIds.length) throw Error("请选择报告图表展示指标");
    if (view.kind === "radar" && (view.metricIds.length < 3 || view.metricIds.length > 8)) throw Error("评分雷达图须选择 3–8 个指标");
    if (view.kind === "scatter") {
      if (view.metricIds.length !== 2 || !safe(view.xMetricId) || !safe(view.yMetricId) || view.xMetricId === view.yMetricId ||
          !view.metricIds.includes(view.xMetricId) || !view.metricIds.includes(view.yMetricId)) throw Error("散点图须选择两个不同的试次指标");
    } else if (view.xMetricId !== undefined || view.yMetricId !== undefined) throw Error("只有散点图可以配置 X、Y 指标");
    const b = view.binding;
    if (!plain(b) || b.testId !== testId || !identity(b.projectProtocol) ||
        Object.keys(b).some(key => !["testId", "projectProtocol", "metrics"].includes(key)) ||
        !Array.isArray(b.metrics) || b.metrics.length !== view.metricIds.length) throw Error("报告图表测量匹配信息无效");
    b.metrics.forEach((d, index) => {
      if (!plain(d) || d.id !== view.metricIds[index] || typeof d.unit !== "string" || !["record", "attempt"].includes(d.entryScope) ||
          !identity(d.protocolIdentity) || Object.keys(d).some(key => !["id", "unit", "entryScope", "protocolIdentity"].includes(key))) throw Error("报告图表指标匹配信息无效");
      if (source && !source.definitions.some(definition => definition.id === d.id && definition.testId === testId)) throw Error("报告图表包含未知指标：" + d.id);
      if (["trials", "scatter"].includes(view.kind) && d.entryScope !== "attempt") throw Error("试次图表只能选择试次指标");
    });
    return true;
  }
  function validateViews(views, source) {
    if (views === undefined) return true;
    if (!plain(views) || Object.keys(views).length > 75) throw Error("报告图表设置格式无效");
    for (const [testId, view] of Object.entries(views)) validateView(view, testId, source);
    return true;
  }
  function normalizeViews(views, source) {
    validateViews(views, source);
    return clone(views || {});
  }
  function createView(source, testId, options = {}) {
    const kind = options.kind || "none";
    const metricIds = kind === "none" ? [] : kind === "scatter" ? [options.xMetricId, options.yMetricId] : [...(options.metricIds || [])];
    const view = { version: 1, kind, metricIds,
      ...(kind === "scatter" ? { xMetricId: options.xMetricId, yMetricId: options.yMetricId } : {}),
      binding: signature(source, testId, metricIds) };
    validateView(view, testId, source);
    return view;
  }
  function compatible(view, source, testId) {
    try {
      validateView(view, testId, source);
      const actual = signature(source, testId, view.metricIds), b = view.binding;
      return sameIdentity(b.projectProtocol, actual.projectProtocol) && b.metrics.every((d, i) => {
        const match = actual.metrics[i];
        return d.id === match.id && d.unit === match.unit && d.entryScope === match.entryScope && sameIdentity(d.protocolIdentity, match.protocolIdentity);
      });
    } catch (_) { return false; }
  }
  function resolveView(record, testId, catalog) {
    const current = catalog?.reportViews?.[testId];
    // Explicit disabling is a presentation decision even after measurement edits.
    if (current?.kind === "none") return clone(current);
    if (current && compatible(current, record, testId)) return clone(current);
    const frozen = record.views?.genericReports?.[testId];
    return frozen && compatible(frozen, record, testId) ? clone(frozen) : none();
  }
  function freezeViews(record, catalog) {
    const views = {};
    for (const project of projects(record)) {
      if (project.renderer !== "scalar" || !record.enabled?.[project.id]) continue;
      const view = resolveView(record, project.id, catalog);
      // Freeze the effective disabled state too, so exports do not inherit later changes.
      views[project.id] = view.binding ? view : createView(record, project.id, { kind: "none" });
    }
    record.views ||= {};
    record.views.genericReports = views;
    return record;
  }
  function buildChart(report, project) {
    const record = report.record, computed = report.stats, view = project.reportView || resolveView(record, project.id);
    const result = { kind: view.kind, available: false, reason: "", panels: [] };
    if (view.kind === "none") return result;
    if (!compatible(view, record, project.id)) return { ...result, reason: "图表设置与本次测量协议或指标定义不匹配" };
    const definitions = view.metricIds.map(id => record.definitions.find(d => d.id === id && d.testId === project.id));
    const evaluation = id => (computed.evaluationResults || []).find(item => item.subjectId === "metric:" + id);
    const label = d => root.RingsideTests.metricName(d);
    const status = d => evaluation(d.id)?.grade?.status || "gray";
    const groups = new Map();
    const panel = unit => {
      if (!groups.has(unit)) groups.set(unit, { title: unit || "无单位", unit });
      return groups.get(unit);
    };
    if (["bar", "column", "target"].includes(view.kind)) {
      const omissions = [];
      for (const d of definitions) {
        const value = num(computed.values[d.id]);
        if (value === null) { omissions.push(label(d) + "缺少有效结果"); continue; }
        const rule = evaluation(d.id), target = num(rule?.target);
        if (view.kind === "target" && (!rule?.applicable || !rule.targetApplicable || target === null)) {
          omissions.push(label(d) + "：" + (rule?.reason || "没有适用于本次测量的目标")); continue;
        }
        const p = panel(d.unit || ""); p.items ||= [];
        p.items.push({ id: d.id, label: label(d), value, status: status(d), ...(view.kind === "target" ? { target } : {}) });
      }
      result.reason = omissions.join("；");
    } else if (view.kind === "trials") {
      const omissions = [];
      for (const d of definitions) {
        const attempts = (computed.repetitions || []).filter(group => group.testId === project.id && group.fields.some(f => f.id === d.id)).flatMap(group => group.attempts);
        const points = attempts.filter(attempt => num(attempt.observations[d.id]) !== null).map(attempt => ({ id: attempt.id, index: attempt.index, value: num(attempt.observations[d.id]) }));
        if (!points.length) { omissions.push(label(d) + "没有有效试次数据"); continue; }
        const p = panel(d.unit || ""); p.series ||= [];
        p.series.push({ id: d.id, label: label(d), status: status(d), points });
      }
      result.reason = omissions.join("；");
    } else if (view.kind === "scatter") {
      const x = definitions.find(d => d.id === view.xMetricId), y = definitions.find(d => d.id === view.yMetricId);
      const attempts = (computed.repetitions || []).filter(group => group.testId === project.id && group.fields.some(f => f.id === x.id) && group.fields.some(f => f.id === y.id)).flatMap(group => group.attempts);
      const points = attempts.filter(attempt => num(attempt.observations[x.id]) !== null && num(attempt.observations[y.id]) !== null)
        .map(attempt => ({ id: attempt.id, index: attempt.index, x: num(attempt.observations[x.id]), y: num(attempt.observations[y.id]) }));
      if (points.length) groups.set("scatter", { title: label(x) + " × " + label(y), unit: "", xAxis: { id: x.id, label: label(x), unit: x.unit || "" }, yAxis: { id: y.id, label: label(y), unit: y.unit || "" }, points });
    } else if (view.kind === "radar") {
      const axes = [], failures = [];
      for (const d of definitions) {
        const score = root.RingsideModel.metricScore(record, d.id, computed);
        if (!score.valid) { failures.push(label(d) + "：" + score.reason); continue; }
        axes.push({ id: d.id, label: label(d), value: score.score, status: status(d), tooltip: label(d) + " " + computed.values[d.id] + " " + (d.unit || "") });
      }
      if (failures.length) return { ...result, reason: failures.join("；") };
      groups.set("radar", { title: "评分雷达", unit: "分", axes });
    }
    result.panels = [...groups.values()];
    result.available = result.panels.length > 0;
    if (!result.available && !result.reason) result.reason = view.kind === "scatter" ? "没有同一试次的有效 X、Y 配对" : view.kind === "trials" ? "选定指标没有有效试次数据" : "选定指标缺少有效结果";
    return result;
  }
  root.RingsideGenericReport = { kinds: Object.freeze(kinds), validateViews, normalizeViews, createView, compatible, resolveView, freezeViews, buildChart };
})(typeof window !== "undefined" ? window : globalThis);
