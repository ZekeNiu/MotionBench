(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const meanings = ["numeric", "ordinal", "category"], directions = ["higher", "lower", "none"];
  let registeredDefinitions;
  function factory(definition) {
    if (!definition || definition.legacyManual || root.RingsideTests?.isManualMetric(definition)) return null;
    registeredDefinitions ||= [...(root.Def?.builtins || []).map(d => ({ ...d, resultMeaning: "numeric", directionStatus: "confirmed" })), ...(root.RingsideTests?.extraDefinitions?.({ canonical: true }) || []), ...(root.RingsideTests?.derivedDefinitions?.() || [])];
    return registeredDefinitions
      .find(item => item.id === definition.id && (!item.testId || item.testId === definition.testId)) || null;
  }
  function normalize(input, options = {}) {
    const d = clone(input), registered = factory(d);
    d.resultMeaning = meanings.includes(d.resultMeaning) ? d.resultMeaning : d.measurementScale === "ordinal" ? "ordinal" : registered?.resultMeaning || "numeric";
    // Existing higher/lower values are still inputs to historical evaluators.
    // Confirmation is separate from the value, never a competing direction.
    if (!["confirmed", "unconfirmed"].includes(d.directionStatus)) d.directionStatus = registered?.directionStatus === "confirmed" && registered.direction === d.direction ? "confirmed" : "unconfirmed";
    if (!directions.includes(d.direction)) d.direction = registered?.direction || "none";
    return d;
  }
  function resolve(input, options = {}) {
    const original = normalize(input || {}), registered = factory(input), catalog = options.catalogDefinition ? normalize(options.catalogDefinition) : null;
    const selected = catalog?.directionStatus === "confirmed" ? catalog : original.directionStatus === "confirmed" ? original : registered?.directionStatus === "confirmed" ? registered : original;
    const confirmed = selected.directionStatus === "confirmed", direction = confirmed && directions.includes(selected.direction) ? selected.direction : "unconfirmed";
    const evaluationDirection = options.evaluation?.direction;
    return { meaning: catalog?.resultMeaning || original.resultMeaning, direction, confirmed,
      source: selected === catalog ? "catalog" : selected === registered ? "builtin" : confirmed ? "definition" : "legacy",
      conflict: ["higher", "lower"].includes(evaluationDirection) && ["higher", "lower"].includes(direction) && evaluationDirection !== direction };
  }
  function validate(d) {
    if (d.resultMeaning !== undefined && !meanings.includes(d.resultMeaning)) throw Error("请选择数值、等级或类别结果");
    if (d.directionStatus !== undefined && !["confirmed", "unconfirmed"].includes(d.directionStatus)) throw Error("指标方向确认状态无效");
    if (d.direction !== undefined && !directions.includes(d.direction)) throw Error("指标表现方向无效");
    return true;
  }
  root.RingsideMetricSemantics = { normalize, resolve, validate };
})(typeof window !== "undefined" ? window : globalThis);
