(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => !!value && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
  const unsafe = key => ["__proto__", "prototype", "constructor"].includes(key);
  const identifier = key => typeof key === "string" && key.length > 0 && key.length <= 500 && !unsafe(key);
  const booleans = new Set(["fv", "pv", "points", "optimum", "comparison", "confidence", "responseForce", "responseVelocity", "responseBoth", "showPoints", "showBand", "showEstimate", "bandExplicit", "selectionExplicit"]);
  const enums = {range:["full", "measured"], elasticityView:["response", "constraint", "distance"], yAxis:["percent", "force"]};
  function json(value, depth = 0) {
    if (depth > 40 || ["undefined", "function", "symbol", "bigint"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)) throw Error("比较图表显示设置无效");
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && !plain(value)) throw Error("比较图表显示设置无效");
    for (const [key, item] of Object.entries(value)) {
      if (unsafe(key)) throw Error("比较图表显示设置包含无效字段");
      json(item, depth + 1);
    }
  }
  function options(input, patch = false) {
    if (!plain(input)) throw Error("比较图层设置无效");
    for (const [key, value] of Object.entries(input)) {
      if (booleans.has(key)) { if (typeof value !== "boolean") throw Error("比较图层开关无效"); }
      else if (enums[key]) { if (!enums[key].includes(value)) throw Error("比较图表视图无效"); }
      else if (key === "selected") { if (!Array.isArray(value) || value.some(id => !identifier(id)) || new Set(value).size !== value.length) throw Error("比较动作选择无效"); }
      else if (key === "pinnedLoad") { if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw Error("比较负荷选择无效"); }
      else if (key === "pinnedRecordId") { if (value !== null && !identifier(value)) throw Error("比较测试记录选择无效"); }
      else if (patch) throw Error("此设置不是比较图表的显示选项");
    }
  }
  function normalize(input = {}, recordIds) {
    if (!plain(input)) throw Error("纵向报告显示设置无效");
    json(input);
    const output = clone(input);
    if (output.charts === undefined) return output;
    if (!plain(output.charts)) throw Error("比较图表设置无效");
    for (const [chartId, chart] of Object.entries(output.charts)) {
      if (!identifier(chartId) || !plain(chart)) throw Error("比较图表标识无效");
      if (chart.recordIds !== undefined) {
        if (!Array.isArray(chart.recordIds) || !chart.recordIds.length || chart.recordIds.some(id => !identifier(id) || recordIds && !recordIds.includes(id)) || new Set(chart.recordIds).size !== chart.recordIds.length) throw Error("每张图至少保留一条当前比较记录");
        chart.recordIds.sort();
      }
      if (chart.options !== undefined) options(chart.options);
      if (chart.metrics !== undefined && (!plain(chart.metrics) || Object.entries(chart.metrics).some(([key, value]) => !identifier(key) || typeof value !== "boolean"))) throw Error("比较显示指标无效");
    }
    return output;
  }
  function config(views, chartId) { return clone(views?.charts?.[chartId] || {}); }
  function selected(views, chartId, recordIds) {
    const chosen = views?.charts?.[chartId]?.recordIds;
    return recordIds.filter(id => !chosen || chosen.includes(id));
  }
  function patch(views, chartId, delta, recordIds) {
    if (!identifier(chartId) || !plain(delta) || Object.keys(delta).some(key => !["recordIds", "options", "metrics"].includes(key))) throw Error("比较图表显示修改无效");
    json(delta);
    if (delta.options !== undefined) options(delta.options, true);
    const output = normalize(views, recordIds), previous = config(output, chartId);
    output.charts ||= {};
    output.charts[chartId] = {...previous, ...clone(delta),
      ...(delta.options ? {options:{...previous.options, ...delta.options}} : {}),
      ...(delta.metrics ? {metrics:{...previous.metrics, ...delta.metrics}} : {})};
    return normalize(output, recordIds);
  }
  root.RingsideLongitudinalViews = Object.freeze({normalize, config, selected, patch});
})(typeof window !== "undefined" ? window : globalThis);
