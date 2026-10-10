(function (root) {
  "use strict";
  const number = value => root.Calc.num(value);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const clamp = value => Math.max(0, Math.min(100, value));
  const intervalContains = (range, value) => (range.min == null || value > range.min || value === range.min && range.includeMin !== false) &&
    (range.max == null || value < range.max || value === range.max && range.includeMax !== false);
  function validateIntervals(ranges, options = {}) {
    if (!Array.isArray(ranges) || ranges.length > 300) throw Error("区间须为不超过 300 行的列表");
    ranges.forEach((range, index) => {
      if (!range || ["min", "max"].some(key => range[key] != null && !finite(range[key])) ||
          range.min != null && range.max != null && (range.min > range.max || range.min === range.max && (range.includeMin === false || range.includeMax === false))) throw Error("第 " + (index + 1) + " 个区间的端点无效");
      if (["includeMin", "includeMax"].some(key => range[key] !== undefined && typeof range[key] !== "boolean")) throw Error("区间端点包含选项无效");
      if (options.scores && (!finite(range.score) || range.score < 0 || range.score > 100)) throw Error("评分表的分数须在 0–100 内");
      if (!options.scores && (typeof range.label !== "string" || !range.label.trim() || !["red", "amber", "green", "gray"].includes(range.status))) throw Error("区间名称或颜色无效");
      ranges.slice(0, index).forEach(prior => {
        const low = Math.max(range.min ?? -Infinity, prior.min ?? -Infinity), high = Math.min(range.max ?? Infinity, prior.max ?? Infinity);
        if (low < high || low === high && intervalContains(range, low) && intervalContains(prior, low)) {
          if (!options.legacy) throw Error("第 " + (index + 1) + " 个区间与其他区间重叠");
        }
      });
    });
    return true;
  }
  function validateTransform(transform, subject) {
    if (!transform || !["ratio", "anchors", "table"].includes(transform.kind)) throw Error("请选择明确的计分规则");
    if (transform.kind === "ratio") {
      if (!["higher", "lower"].includes(transform.direction)) throw Error("目标比例计分方向无效");
      if (subject && subject.measurementScale !== "ratio") throw Error("此指标尚未确认具有有效比例尺度，请使用明确评分点");
      return true;
    }
    if (transform.kind === "table") { if (!transform.ranges?.length) throw Error("评分表至少需要一个区间"); return validateIntervals(transform.ranges, { scores: true }); }
    if (subject?.measurementScale === "ordinal") throw Error("有序等级请使用明确评分表，不能直接作连续插值");
    if (!["higher", "lower", "range"].includes(transform.shape) || !Array.isArray(transform.points) || transform.points.length < 2 || transform.points.length > 100) throw Error("请设置完整的评分点");
    const points = transform.points;
    points.forEach((point, i) => {
      if (!finite(point.value) || !finite(point.score) || point.score < 0 || point.score > 100 || i && point.value <= points[i - 1].value) throw Error("评分点须按测量值递增，分数为 0–100");
      if (i && transform.shape !== "range" && (transform.shape === "higher" ? point.score < points[i - 1].score : point.score > points[i - 1].score)) throw Error("评分点须符合评价方向");
    });
    if (transform.shape === "range") {
      if (points.length !== 4 || points.map(point => point.score).join(",") !== "0,100,100,0") throw Error("适宜区间须设置四个评分点：0、100、100、0");
    } else if (points[0].score !== (transform.shape === "higher" ? 0 : 100) || points.at(-1).score !== (transform.shape === "higher" ? 100 : 0)) throw Error("单向评分的两端须明确为 0 分和 100 分");
    return true;
  }
  function evaluate(value, transform, context = {}) {
    const v = number(value), fail = reason => ({ valid: false, score: null, reason });
    if (v === null) return fail("缺少有效测量");
    try { validateTransform(transform, context.subject); } catch (error) { return fail(error.message); }
    if (context.applicable === false) return fail(context.reason || "计分规则不适用于本次测量");
    if (transform.kind === "ratio") {
      const target = number(context.target);
      if (context.targetEnabled === false || target === null || target <= 0) return fail("缺少有效目标");
      if (v < 0 || v === 0 && context.subject?.zeroValid === false) return fail("测量超出目标比例计分的有效范围");
      return { valid: true, score: transform.direction === "lower" ? v === 0 ? 100 : clamp(100 * target / v) : clamp(100 * v / target), reason: "" };
    }
    if (transform.kind === "table") {
      const matches = transform.ranges.filter(range => intervalContains(range, v));
      return matches.length === 1 ? { valid: true, score: matches[0].score, reason: "" } : fail(matches.length ? "评分区间重叠" : "测量未命中评分表");
    }
    const points = transform.points;
    if (v <= points[0].value) return { valid: true, score: points[0].score, reason: "" };
    if (v >= points.at(-1).value) return { valid: true, score: points.at(-1).score, reason: "" };
    const i = points.findIndex(point => point.value >= v), a = points[i - 1], b = points[i];
    return { valid: true, score: clamp(a.score + (v - a.value) / (b.value - a.value) * (b.score - a.score)), reason: "" };
  }
  root.RingsideScoring = { validateIntervals, validateTransform, evaluate, intervalContains };
})(typeof window !== "undefined" ? window : globalThis);
