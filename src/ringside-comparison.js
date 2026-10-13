(function (root) {
  "use strict";
  const M = root.RingsideModel, T = root.RingsideTests, E = root.RingsideEvaluation;
  const N = root.Calc.num, copy = value => JSON.parse(JSON.stringify(value));
  const order = value => Array.isArray(value) ? value.map(order) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, order(value[key])])) : value;
  const canonical = value => JSON.stringify(order(value));
  const statisticsVersion = "comparison-record-statistics-v2", statisticsCache = new Map(), preparedInputs = new WeakMap(), cachedMetadata = new WeakMap();
  const statisticsCacheLimit = 160;
  function cloneStats(value, seen = new Map()) {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Object.prototype.toString.call(value) === "[object Set]") {
      const result = new Set(); seen.set(value, result); value.forEach(item => result.add(cloneStats(item, seen))); return result;
    }
    if (Object.prototype.toString.call(value) === "[object Map]") {
      const result = new Map(); seen.set(value, result); value.forEach((item, key) => result.set(key, cloneStats(item, seen))); return result;
    }
    const result = Array.isArray(value) ? [] : {}; seen.set(value, result);
    for (const [key, item] of Object.entries(value)) result[key] = cloneStats(item, seen);
    return result;
  }
  function statisticsKey(record) { return statisticsVersion + ":" + hash(record); }
  function cachedStats(record, key = statisticsKey(record), canonicalRecord) {
    if (statisticsCache.has(key)) {
      const cached = statisticsCache.get(key); statisticsCache.delete(key); statisticsCache.set(key, cached);
      const result = cloneStats(cached.stats); cachedMetadata.set(result, cached); return result;
    }
    const computed = M.stats(record), cached = { stats: cloneStats(computed), canonicalRecord: canonicalRecord || canonical(record),
      measurementDigest: hash(M.fingerprint(record)), extracted: cloneStats(extraction({ record, stats: computed })) };
    statisticsCache.set(key, cached);
    while (statisticsCache.size > statisticsCacheLimit) statisticsCache.delete(statisticsCache.keys().next().value);
    // Fit functions close over the freshly computed fit. Return a separate graph
    // so a consumer cannot mutate those closure inputs through its result object.
    const result = cloneStats(cached.stats); cachedMetadata.set(result, cached); return result;
  }
  function hash(value) {
    const source = typeof value === "string" ? value : canonical(value), bytes = [];
    for (const character of source) {
      const code = character.codePointAt(0);
      if (code < 128) bytes.push(code);
      else if (code < 2048) bytes.push(192 | code >> 6, 128 | code & 63);
      else if (code < 65536) bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
      else bytes.push(240 | code >> 18, 128 | code >> 12 & 63, 128 | code >> 6 & 63, 128 | code & 63);
    }
    const bitLength = bytes.length * 8; bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 4294967296), low = bitLength >>> 0;
    for (const word of [high, low]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push(word >>> shift & 255);
    const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,
      0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,
      0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,
      0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,
      0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const rotate = (word, amount) => word >>> amount | word << (32 - amount), schedule = new Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) schedule[i] = bytes[offset + i * 4] << 24 | bytes[offset + i * 4 + 1] << 16 | bytes[offset + i * 4 + 2] << 8 | bytes[offset + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const a = schedule[i - 15], b = schedule[i - 2], s0 = rotate(a,7) ^ rotate(a,18) ^ a >>> 3, s1 = rotate(b,17) ^ rotate(b,19) ^ b >>> 10;
        schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) | 0;
      }
      let [a,b,c,d,e,f,g,h] = state;
      for (let i = 0; i < 64; i++) {
        const s1 = rotate(e,6) ^ rotate(e,11) ^ rotate(e,25), choose = e & f ^ ~e & g;
        const t1 = (h + s1 + choose + constants[i] + schedule[i]) | 0;
        const s0 = rotate(a,2) ^ rotate(a,13) ^ rotate(a,22), majority = a & b ^ a & c ^ b & c, t2 = (s0 + majority) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a,b,c,d,e,f,g,h].forEach((word, index) => { state[index] = (state[index] + word) | 0; });
    }
    return "sha256:" + state.map(word => (word >>> 0).toString(16).padStart(8, "0")).join("");
  }
  const unique = values => [...new Set(values)];
  const safeId = id => typeof id === "string" && id.length > 0 && id.length <= 249 && !["__proto__", "constructor", "prototype"].includes(id);
  const day = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
    const timestamp = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
  };
  function normalizeSelection(selection = {}) {
    const athleteIds = unique((selection.athleteIds || []).filter(safeId)).sort();
    const dates = unique((selection.dates || []).filter(date => day(date) !== null)).sort();
    const choices = selection.recordChoices || selection.recordIds || {}, recordChoices = {};
    for (const id of athleteIds) {
      recordChoices[id] = {};
      for (const date of dates) if (safeId(choices[id]?.[date])) recordChoices[id][date] = choices[id][date];
    }
    const source = selection.basis || selection.capabilitySelections || {}, basis = {};
    for (const key of ["strength", "reactive", "speed"]) {
      const options = M.capabilityDirectionOptions[key] || [];
      if (options.some(([id]) => id === source[key])) basis[key] = source[key];
    }
    if (["fvp_sj", "fvp_cmj"].includes(source.jumpProtocol)) basis.jumpProtocol = source.jumpProtocol;
    return { groupId: safeId(selection.groupId) ? selection.groupId : "", athleteIds, dates, recordChoices, basis };
  }
  function selectionKey(selection) { return canonical(normalizeSelection(selection)); }
  function applyExplicitBasis(inputs) {
    const basis = inputs.selection.basis;
    for (const entry of inputs.entries) {
      entry.record.views ||= {};
      entry.record.views.capabilitySelections = { ...entry.record.views.capabilitySelections,
        ...Object.fromEntries(["strength", "reactive", "speed"].filter(key => basis[key]).map(key => [key, basis[key]])) };
      if (basis.jumpProtocol) entry.record.views.fvpProtocol = basis.jumpProtocol;
    }
  }
  // This reader is pure. Store supplies its version-consistent directory and complete records.
  function readComparisonInputs(source, selection = source?.selection || {}) {
    const library = source?.library || source, selected = assertPersonalSelection(normalizeSelection(selection)), issues = [], entries = [], athletes = [];
    const pool = source?.records || (library?.athletes || []).flatMap(athlete => athlete.records || []);
    for (const athleteId of selected.athleteIds) {
      const athlete = (library?.athletes || source?.athletes || []).find(item => item.id === athleteId);
      if (!athlete || athlete.deletedAt) {
        issues.push({ kind: "missing-athlete", athleteId, reason: "所选队员已不存在" });
        athletes.push({ id: athleteId, name: "已删除队员", profile: {} });
        continue;
      }
      athletes.push({ id: athleteId, name: athlete.name || athlete.profile?.name || "未命名队员", profile: copy(athlete.profile || {}) });
      for (const date of selected.dates) {
        const candidates = pool.filter(record => record.athleteId === athleteId && record.athlete?.date === date && !record.deletedAt);
        const explicit = selected.recordChoices[athleteId]?.[date];
        let record = explicit ? candidates.find(item => item.recordId === explicit) : candidates.length === 1 ? candidates[0] : null;
        if (!record) {
          const kind = explicit ? "missing-record" : candidates.length > 1 ? "ambiguous-record" : "missing-measurement";
          issues.push({ kind, athleteId, date, recordId: explicit || "", candidates: candidates.map(item => ({ recordId: item.recordId, title: item.title || "", updated: item.updated })),
            reason: kind === "ambiguous-record" ? "同日有多条测试记录，请指定采用的记录" : kind === "missing-record" ? "指定记录不存在或所属队员、日期已改变" : "本日没有测试记录" });
          continue;
        }
        selected.recordChoices[athleteId][date] = record.recordId;
        record = copy(record);
        const profileId = record.evaluationProfileId || library.defaultEvaluationProfileId;
        const evaluationProfile = (library.evaluationProfiles || source?.evaluationProfiles || []).find(profile => profile.id === profileId);
        if (evaluationProfile && E?.resolve) record = E.resolve(record, evaluationProfile);
        entries.push({ athleteId, date, recordId: record.recordId, record, evaluationProfile: evaluationProfile ? copy(evaluationProfile) : null });
      }
    }
    return { version: 1, selection: selected, athletes, dates: selected.dates, entries, issues,
      ready: !issues.some(item => ["ambiguous-record", "missing-record", "missing-athlete"].includes(item.kind)),
      catalog: copy(library.catalog || source?.catalog || {}), evaluationProfiles: copy(library.evaluationProfiles || source?.evaluationProfiles || []),
      revision: source?.versionState || library.updated || null, expectedConfig: source?.expectedConfig || null };
  }
  const comparisonMethodVersion = "personal-longitudinal-v2";
  const roundoffFactor = 16;
  const roundoffTolerance = scale => roundoffFactor * Number.EPSILON * Math.abs(scale);
  function compensatedSum(values) {
    let sum = 0, correction = 0;
    for (const value of values) { const adjusted = value - correction, next = sum + adjusted; correction = (next - sum) - adjusted; sum = next; }
    return sum;
  }
  function numericMean(values) {
    const xs = values.map(N).filter(value => value !== null);
    if (!xs.length) return null;
    const mean = xs[0] + compensatedSum(xs.map(value => (value - xs[0]) / xs.length));
    return Number.isFinite(mean) ? mean === 0 ? 0 : mean : null;
  }
  function numericDifference(current, baseline) {
    current = N(current); baseline = N(baseline);
    if (current === null || baseline === null) return null;
    const delta = current - baseline;
    return Math.abs(delta) <= roundoffTolerance(Math.max(Math.abs(current), Math.abs(baseline))) ? 0 : delta;
  }
  function assertPersonalSelection(selection) {
    if (selection.athleteIds.length !== 1 || selection.dates.length < 2)
      throw new Error("个人纵向报告须选择一名队员和至少两个不同测试日期");
    return selection;
  }
  function assertPersonalEntries(inputs) {
    const athleteId = inputs.selection.athleteIds[0], seenDates = new Set();
    for (const entry of inputs.entries || []) {
      if (entry.athleteId !== athleteId || entry.record?.athleteId !== athleteId || !inputs.selection.dates.includes(entry.date)
        || entry.record?.athlete?.date !== entry.date || seenDates.has(entry.date))
        throw new Error("个人纵向输入的队员、日期或所选记录不一致");
      seenDates.add(entry.date);
    }
  }
  function trend(periods) {
    const points = periods.filter(item => day(item.date) !== null && N(item.mean) !== null).map(item => ({ date: item.date, value: item.mean, n: item.n }));
    if (points.length < 3) return { available: false, reason: "至少三个不同测试日期才绘制描述性线性趋势", points, slopePer30Days: null, r2: null };
    const origin = day(points[0].date), xs = points.map(point => (day(point.date) - origin) / 86400000), ys = points.map(point => point.value);
    const meanX = numericMean(xs), meanY = numericMean(ys);
    if (ys.every(y => numericDifference(y, ys[0]) === 0)) return { available: true, reason: "", origin: points[0].date,
      intercept: meanY, slopePerDay: 0, slopePer30Days: 0, r2: null,
      points: points.map((point, index) => ({ ...point, day: xs[index], fitted: meanY })) };
    const sxx = compensatedSum(xs.map(x => (x - meanX) ** 2)), sxy = compensatedSum(xs.map((x, index) => (x - meanX) * (ys[index] - meanY)));
    const slope = sxy / sxx, intercept = meanY - slope * meanX;
    const sst = compensatedSum(ys.map(y => (y - meanY) ** 2)), residual = compensatedSum(ys.map((y, index) => (y - intercept - slope * xs[index]) ** 2));
    return { available: true, reason: "", origin: points[0].date, intercept, slopePerDay: slope, slopePer30Days: slope * 30,
      r2: sst > 0 ? Math.max(0, Math.min(1, 1 - residual / sst)) : null,
      points: points.map((point, index) => ({ ...point, day: xs[index], fitted: intercept + slope * xs[index] })) };
  }
  function measurementContext(record, definition) {
    const context = E?.measurementContext ? E.measurementContext(record, definition) : { protocolIdentity: record.protocolIdentities?.[definition.testId] || M.protocolIdentity("test:" + definition.testId, record.protocol?.[definition.testId]),
      metricProtocolIdentity: definition.protocolIdentity || M.protocolIdentity("metric:" + definition.id, definition.protocol || "") };
    return E?.contextSignature ? JSON.parse(E.contextSignature(context)) : context;
  }
  function protocolConfig(input) {
    // Body dimensions and measured propulsion distances are individual inputs.
    // The protocol identity retains the acquisition method and solver conventions.
    const excluded = new Set(["mass", "massKg", "height", "heightCm", "distanceCm", "positionStartM", "temperatureC", "pressureHpa", "windMps"]);
    return Object.fromEntries(Object.entries(input || {}).filter(([key]) => !excluded.has(key)));
  }
  function descriptiveInterpretation(reason = "未形成可追溯的有效评价依据，仅描述数值变化") {
    return { changeInterpretation: "descriptive", changeDirection: "", changeInterpretationBasis: reason,
      changeInterpretationKey: "", changeInterpretationRule: "", changeGrade: "" };
  }
  function evaluatedInterpretation(entry, definition, subjectId, eligible = true, side) {
    if (!definition || !eligible || definition.referenceEnabled !== true || definition.referenceMatch?.eligible === false)
      return descriptiveInterpretation("未启用、未匹配或不适用于本指标的评价标准，仅描述数值变化");
    const standard = entry.record.evaluationStandards?.find(rule => rule.subjectId === subjectId);
    const appraisal = entry.stats.evaluationResults.find(result => result.subjectId === subjectId && (side === undefined || (result.side || "") === side));
    if ((standard && (!standard.enabled || !standard.applicable)) || (!standard && entry.record.evaluationProfileFormat === 2)
      || !appraisal || !appraisal.applicable)
      return descriptiveInterpretation("未形成适用的原评价依据，仅描述数值变化");
    const target = N(definition.target), hasTarget = target !== null && target > 0 && definition.targetEnabled !== false
      && (!standard || standard.targetApplicable === true) && appraisal.targetApplicable !== false;
    const ranges = (definition.ranges || []).filter(range => ["red", "amber", "green"].includes(range.status)
      && (N(range.min) !== null || N(range.max) !== null)
      && (N(range.min) === null || N(range.max) === null || N(range.min) <= N(range.max)))
      .map(range => ({ min: N(range.min), max: N(range.max), includeMin: range.includeMin !== false, includeMax: range.includeMax !== false, status: range.status }));
    const hasRanges = ranges.length > 0 && definition.rangesEnabled !== false
      && (!standard || standard.rangesApplicable === true) && appraisal.rangesApplicable !== false;
    if (hasRanges) {
      if (!["red", "amber", "green"].includes(appraisal.grade?.status) || appraisal.grade?.ambiguous === true)
        return descriptiveInterpretation("已启用的等级区间未形成可判定等级，仅描述数值变化");
      return { changeInterpretation: "evaluation-standard", changeDirection: "",
        changeInterpretationBasis: "本指标适用且已启用的等级区间；改善或下降仅依据原评价等级变化，未跨等级时只描述数值",
        changeInterpretationKey: hash({ subjectId, rule: "ranges", ranges, unit: definition.unit || appraisal.unit || "" }),
        changeInterpretationRule: "ranges", changeGrade: appraisal.grade.status };
    }
    if (hasTarget && N(appraisal.target) === target && ["higher", "lower"].includes(definition.direction)) {
      const direction = definition.direction;
      return { changeInterpretation: "evaluation-standard", changeDirection: direction,
        changeInterpretationBasis: "本指标适用且已启用的目标规则：" + (direction === "higher" ? "较高值" : "较低值") + "方向，目标 " + target + " " + (definition.unit || appraisal.unit || ""),
        changeInterpretationKey: hash({ subjectId, rule: "target", direction, target, unit: definition.unit || appraisal.unit || "" }),
        changeInterpretationRule: "target", changeGrade: appraisal.grade?.status || "" };
    }
    return descriptiveInterpretation("没有有效目标或可判定的等级区间，仅描述数值变化");
  }
  function metricInterpretation(entry, id, definition, extra) {
    if (extra.originalChangeRule) {
      const rule = extra.originalChangeRule;
      return { changeInterpretation: "original-rule", changeDirection: rule.direction, changeInterpretationBasis: rule.basis,
        changeInterpretationKey: hash({ id, rule: rule.identity }), changeInterpretationRule: "original", changeGrade: "" };
    }
    return evaluatedInterpretation(entry, extra.evaluationDefinition || definition, extra.evaluationSubjectId || "metric:" + id,
      extra.evaluationEligible !== false, extra.evaluationSide);
  }
  function extraction(entry) {
    const { record, stats } = entry, items = [], ids = new Set();
    const add = (id, testId, label, value, unit, extra = {}) => {
      if (ids.has(id + "|" + (extra.side || ""))) return;
      ids.add(id + "|" + (extra.side || ""));
      const definition = extra.definition || record.definitions.find(d => d.id === id && d.testId === testId);
      const scope = definition?.entryScope === "attempt" ? "attempt" : "record";
      const aggregation = extra.aggregation || (["cmj", "sj", "dj", "cmrj", "imtp", "mb"].includes(testId) || scope === "attempt" ? record.mode : "record");
      const identity = { testId, metricId: id, unit: unit || "", side: extra.side || "", timeMs: extra.timeMs || null,
        context: extra.context || measurementContext(record, definition || { id, testId, unit }), aggregation,
        ...(extra.protocol ? { protocol: extra.protocol } : {}) };
      const scale = extra.measurementScale || definition?.measurementScale || E?.measurementScale?.(definition || { unit }) || "ratio";
      const continuous = extra.continuous !== false && !["ordinal", "nominal", "categorical", "binary"].includes(scale);
      const { originalChangeRule, evaluationDefinition, evaluationSubjectId, evaluationEligible, evaluationSide, ...publicExtra } = extra;
      items.push({ id, testId, label, unit: unit || "", key: canonical(identity), identity, direction: extra.direction || definition?.direction || "higher",
        measurementScale: scale, continuous, allowCV: continuous && scale === "ratio" && definition?.cvEligible !== false && !/^(?:%|%PF|分)$/.test(unit || ""),
        value: N(value), reason: extra.reason || (N(value) === null ? "缺少有效结果" : ""), ...publicExtra, ...metricInterpretation(entry, id, definition, extra) });
    };
    const timeIds = new Set(stats.imtpTimeResults.map(item => item.id));
    for (const definition of record.definitions) {
      if (!record.enabled[definition.testId] || timeIds.has(definition.id)) continue;
      let unit = definition.unit;
      if (definition.id === "imtp_peak_force") unit = record.imtpConfig?.unit || unit;
      if (definition.id === "cmj_peak_force") unit = record.dsi.cmjUnit || unit;
      const config = ["fvp_sj", "fvp_cmj"].includes(definition.testId) ? record.fvpConfig[definition.testId]
        : definition.testId === "sprint_fvp" ? record.sprintFvpConfig : null;
      const baseContext = measurementContext(record, definition);
      const extra = config ? { context: { ...baseContext, config: protocolConfig(config), ...(definition.id.endsWith("_imbalance") ? { angle: record.fvpAnalysis?.[definition.testId]?.angle || null, targetDistanceM: definition.testId === "sprint_fvp" ? record.sprintFvpAnalysis?.targetDistanceM || null : null } : {}) }, aggregation: "per-load-or-split-representative-fit" } : {};
      if (["squat", "bench", "deadlift", "landmine"].includes(definition.testId)) Object.assign(extra, { context: { ...baseContext, lvp: { metric: record.lvp[definition.testId]?.metric || "MV", mvt: record.lvp[definition.testId]?.mvt || null } } });
      if (definition.testId === "dj") extra.context = { ...baseContext, dropHeightCm: N(stats.raw.dj?.row?.dropHeightCm) };
      if (definition.testId === "hop") extra.context = { ...baseContext, selectionPolicies: unique((stats.raw.hop?.sets || []).filter(set => stats.raw.hop.selectedSetIds?.includes(set.id)).map(set => canonical({ basis: set.selectionBasis, selectedCount: set.counts?.selected }))).sort() };
      if (definition.testId === "cpet") extra.context = { ...baseContext, modality: record.data.cpet.modality, acquisitionProtocol: record.data.cpet.protocol,
        oxygenLabel: record.data.cpet.oxygenLabel, thresholdLabel: definition.id.startsWith("cpet_threshold1_") ? record.data.cpet.thresholds.first.label : definition.id.startsWith("cpet_threshold2_") ? record.data.cpet.thresholds.second.label : "" };
      if (definition.testId === "cmj" && /impulse/.test(definition.id)) extra.context = { ...baseContext, impulseDefinition: record.cmjConfig?.impulseDefinition || "gross" };
      add(definition.id, definition.testId, T.metricName(definition), stats.values[definition.id], unit, { definition, ...extra });
    }
    for (const result of stats.imtpTimeResults) {
      const timeSubject = result.standard ? "imtp-time:" + (result.kind === "force" ? "force_pct_peak" : "rfd") + ":" + result.timeMs : "metric:" + result.id;
      add(result.id, "imtp", result.name, result.value, result.unit, { timeMs: result.timeMs,
        evaluationDefinition: result.standard, evaluationSubjectId: timeSubject,
        evaluationEligible: result.evaluationValid && result.evaluationUnit === result.unit && result.standard?.matched !== false,
        context: { ...measurementContext(record, { id: result.id, testId: "imtp", unit: result.unit }), force: M.imtpTimeContext(record) } });
      if (result.kind === "force") add(result.id + "_pct_peak", "imtp", "IMTP " + result.timeMs + " ms / PF", stats.raw.forceTime?.timeRows.find(point => point.timeMs === result.timeMs)?.forcePercentValid === false ? null : result.forcePercent, "%PF",
        { timeMs: result.timeMs, evaluationDefinition: result.standard, evaluationSubjectId: timeSubject,
          evaluationEligible: result.evaluationValid && result.evaluationUnit === "%PF" && result.standard?.kind === "force_pct_peak" && result.standard?.matched !== false,
          context: { ...M.imtpTimeContext(record), kind: "force_pct_peak" } });
    }
    for (const row of stats.isoAnalyses) {
      const sourceRow = record.data.iso.find(item => item.id === row.id), context = E?.isoContext ? E.isoContext(sourceRow, record) : { direction: row.direction, region: row.region, unit: row.unit };
      for (const side of row.sides) add("iso_" + row.id + "_" + (side.side || "C"), "iso", row.direction + " " + (side.side || ""), side.value, row.unit,
        { side: side.side || "C", context, aggregation: "record", pain: side.pain === true, status: side.status,
          evaluationDefinition: { referenceEnabled: side.target !== null, targetEnabled: true, target: side.target, direction: "higher", unit: row.unit },
          evaluationSubjectId: "iso:" + row.id, evaluationSide: side.side || "", evaluationEligible: side.target > 0 && side.targetKind !== "none" });
      if (row.paired) {
        const amber = N(record.rules.asymAmber), red = N(record.rules.asymRed), hasRule = amber !== null && red !== null && amber >= 0 && red >= amber;
        add("iso_" + row.id + "_asym", "iso", row.direction + " 双侧差异", row.asym, "%", { context, direction: "lower", aggregation: "record",
          ...(hasRule ? { originalChangeRule: { direction: "lower", identity: { asymAmber: amber, asymRed: red }, basis: "原双侧差异预警规则：差异较小的方向；关注 " + amber + "%，预警 " + red + "%（仅指该侧差指标）" } } : {}) });
      }
    }
    for (const pair of stats.balanceResults) {
      const sourcePair = record.balancePairs.find(item => item.id === pair.id), contexts = sourcePair ? [sourcePair.numeratorId, sourcePair.denominatorId].map(id => {
        const row = record.data.iso.find(item => item.id === id); return row && E?.isoContext ? E.isoContext(row, record) : row?.protocolIdentity || null;
      }) : [];
      for (const side of pair.results) add("balance_" + pair.id + "_" + (side.side || "C"), "iso", pair.label + " " + (side.side || ""), side.value, "比值", { side: side.side || "C", context: contexts, aggregation: "record" });
    }
    for (const [index, item] of (stats.raw.fms?.items || []).entries()) {
      const extra = { continuous: false, measurementScale: "ordinal", aggregation: "record", pain: item.pain === true, notes: item.notes || "",
        originalChangeRule: { direction: "higher", identity: "fms-original-item-score-0-3", basis: "原FMS分项0–3评分定义：较高分表示动作评分提高；疼痛与左右原分另行保留" } };
      add("fms_" + index, "fms", item.name, item.value, "分", extra);
      if (item.bilateral) for (const side of ["left", "right"]) add("fms_" + index + "_" + side, "fms", item.name + (side === "left" ? " 左" : " 右"), item[side], "分", { ...extra, side: side === "left" ? "L" : "R" });
    }
    if (stats.raw.fms) add("fms_total", "fms", "FMS 完整总分", stats.raw.fms.complete ? stats.raw.fms.total : null, "分", { continuous: false, measurementScale: "ordinal", aggregation: "record" });
    for (const solved of stats.lvpSeries || []) {
      if (!record.enabled[solved.testId]) continue;
      const context = { protocol: measurementContext(record, { id: solved.id, testId: solved.testId }), side: solved.side || "", metric: solved.metric };
      const extra = { context, side: solved.side || "", aggregation: "per-load-" + record.mode };
      for (const [key, value, label, unit, scale] of [
        ["intercept", solved.fit.a, "速度截距", "m/s", "ratio"], ["slope", solved.fit.b, "负荷–速度斜率", "m/s/kg", "interval"],
        ["r2", solved.fit.r2, "拟合 R²", "", "ratio"], ["zero_velocity_load", solved.fit.load0, "零速度负荷截距", "kg", "ratio"],
        ["estimated_1rm", solved.est.valid ? solved.est.load : null, "指定MVT预估1RM", "kg", "ratio"]]) {
        add(solved.id + "_" + key, solved.testId, solved.label + " " + label, value, unit, { ...extra, measurementScale: scale,
          ...(key === "estimated_1rm" ? { context: { ...context, mvt: solved.mvt } } : {}) });
      }
      for (const point of solved.points) add(solved.id + "_velocity_load_" + point.load, solved.testId, solved.label + " · " + point.load + " kg 速度", point.velocity, "m/s", { ...extra, context: { ...context, loadKg: point.load } });
    }
    for (const result of stats.derived.results || []) {
      if (record.derivedEnabled?.[result.id] === false) continue;
      const definition = T.derivedDefinitions().find(item => item.id === result.id);
      const dependencies = definition?.dependencies || [];
      add(result.id, "derived", result.name || definition?.name || result.id, result.available ? result.value : null, result.unit,
        { context: { dependencies: dependencies.map(id => ({ testId: id, context: measurementContext(record, { id: result.id, testId: id, unit: result.unit }) })),
          ...(result.id === "fdsi" ? { force: Object.fromEntries(Object.entries(record.dsi).filter(([key]) => key !== "force")), cmjConfig: record.cmjConfig, imtpConfig: record.imtpConfig } : {}),
          ...(result.id.startsWith("idsi") ? { impulse: copy(record.impulseConfig) } : {}) }, reason: result.reason || "", aggregation: record.mode });
    }
    for (const id of ["fvp_sj", "fvp_cmj", "sprint_fvp"]) {
      const solved = id === "sprint_fvp" ? stats.sprintFvp : stats.fvp[id];
      if (!record.enabled[id] || !solved?.valid) continue;
      for (const [key, label, unit] of [["F0Absolute", "F₀ 绝对力", "N"], ["PmaxAbsolute", "Pmax 绝对功率", "W"], ["slope", "F–V 斜率", "N/kg/(m/s)"], ["r2", "拟合 R²", ""], ["Vopt", "峰值功率对应速度", "m/s"], ...(id === "sprint_fvp" ? [["Vmax", "速度模型渐近值", "m/s"], ["endVelocity", "终点速度", "m/s"]] : [])]) {
        const value = key === "Vopt" ? solved.model.V0 / 2 : key === "Vmax" ? solved.fit?.vmax : key === "endVelocity" && solved.fit?.tau > 0 ? solved.fit.vmax * (1 - Math.exp(-solved.selected.endTimeS / solved.fit.tau)) : solved.model[key];
        add(id + "_" + key.toLowerCase(), id, label, value, unit, { context: { protocol: measurementContext(record, { id: key, testId: id, unit }), config: protocolConfig(solved.config) }, aggregation: "per-load-or-split-representative-fit" });
      }
      const elasticity = id === "sprint_fvp" ? stats.sprintElasticity : solved;
      if (!elasticity?.elasticity) continue;
      for (const [key, label] of [["Fe", "Fₑ"], ["ve", "vₑ"], ["ER", "ER"], ["EN", "EN"]]) add(id + "_elasticity_" + key.toLowerCase(), id, "弹性 " + label, elasticity.elasticity[key], "",
        { context: { protocol: measurementContext(record, { id: key, testId: id, unit: "" }), method: elasticity.methodVersion || "jump-li-2026", targetDistanceM: id === "sprint_fvp" ? elasticity.targetDistanceM : null }, aggregation: "per-load-or-split-representative-fit" });
    }
    return items;
  }
  const interpretationFields = ["changeInterpretation", "changeDirection", "changeInterpretationBasis", "changeInterpretationKey", "changeInterpretationRule", "changeGrade"];
  function interpretationOf(observation) {
    return Object.fromEntries(interpretationFields.map(field => [field, observation[field] || ""]));
  }
  function compatibleInterpretations(before, after) {
    return before.changeInterpretation !== "descriptive" && after.changeInterpretation !== "descriptive"
      && !!before.changeInterpretationKey && before.changeInterpretationKey === after.changeInterpretationKey
      && before.changeInterpretationRule === after.changeInterpretationRule && before.changeDirection === after.changeDirection;
  }
  function interpretChange(baseline, current, delta, reason) {
    const compatible = compatibleInterpretations(baseline, current), policy = delta === null
      ? descriptiveInterpretation(reason || "缺少前后可比值，无法判定变化")
      : compatible ? interpretationOf(current) : descriptiveInterpretation("基线与本期没有兼容、有效的评价依据，仅描述数值变化");
    let improvement = delta === null ? "unknown" : delta === 0 ? "unchanged" : delta > 0 ? "increased" : "decreased";
    if (delta !== null && delta !== 0 && compatible) {
      if (policy.changeInterpretationRule === "ranges") {
        const gradeRank = { red: 0, amber: 1, green: 2 }, beforeRank = gradeRank[baseline.changeGrade], afterRank = gradeRank[current.changeGrade];
        if (afterRank > beforeRank) improvement = "improved";
        else if (afterRank < beforeRank) improvement = "declined";
      } else if (["higher", "lower"].includes(policy.changeDirection)) {
        improvement = (policy.changeDirection === "higher" ? delta > 0 : delta < 0) ? "improved" : "declined";
      }
    }
    return { ...policy, improvement, baselineInterpretationKey: baseline.changeInterpretationKey || "", currentInterpretationKey: current.changeInterpretationKey || "",
      baselineGrade: baseline.changeGrade || "", currentGrade: current.changeGrade || "" };
  }
  function buildMetric(metadata, entries, selection, indexes, issues = []) {
    const athleteId = selection.athleteIds[0], byDate = new Map();
    for (const entry of entries) {
      const index = indexes?.get(entry), exact = index ? index.byKey.get(metadata.key) : entry.extracted.find(item => item.key === metadata.key),
        sibling = index ? index.byId.get(metadata.id) : entry.extracted.find(item => item.id === metadata.id);
      const mismatch = !sibling ? "本记录未测此指标" : sibling.unit !== metadata.unit ? "单位不一致：本记录为 " + (sibling.unit || "无单位") + "，此指标为 " + (metadata.unit || "无单位")
        : sibling.identity.aggregation !== metadata.identity.aggregation ? "代表成绩取值口径不一致：本记录为 " + sibling.identity.aggregation + "，此指标为 " + metadata.identity.aggregation
        : "测量协议或测量条件不一致";
      byDate.set(entry.date, { athleteId, date: entry.date, recordId: entry.recordId, value: exact ? exact.value : null,
        reason: exact ? exact.reason || "" : mismatch, pain: exact?.pain || false, status: exact?.status || "gray", notes: exact?.notes || "",
        ...(exact ? interpretationOf(exact) : descriptiveInterpretation(mismatch)) });
    }
    const observations = selection.dates.map(date => byDate.get(date) || { athleteId, date,
      recordId: selection.recordChoices[athleteId]?.[date] || "", value: null,
      reason: issues.find(issue => issue.date === date)?.reason || "本日没有有效记录", pain: false, status: "gray", notes: "", ...descriptiveInterpretation("本日没有可比结果") });
    const periods = observations.map(observation => ({ date: observation.date, value: observation.value, mean: observation.value,
      n: observation.value === null ? 0 : 1, observations: observation.value === null ? [] : [observation], allObservations: [observation],
      reason: observation.reason, painCount: observation.pain ? 1 : 0 }));
    const baseline = observations[0], changes = observations.slice(1).map(current => {
      const delta = numericDifference(current.value, baseline.value), reason = current.value === null ? current.reason
        : baseline.value === null ? "基线缺少可比结果：" + baseline.reason : "";
      const percentChange = metadata.measurementScale === "ratio" && !/^(?:%|%PF|分)$/.test(metadata.unit) && baseline.value > 0 && delta !== null
        ? 100 * delta / baseline.value : null;
      return { date: current.date, baselineDate: baseline.date, baselineValue: baseline.value, currentValue: current.value,
        delta, percentChange, deltaUnit: /^(?:%|%PF)$/.test(metadata.unit) ? "百分点" : metadata.unit,
        ...interpretChange(baseline, current, delta, reason), reason };
    });
    const { value, reason, definition, ...descriptor } = metadata;
    const valid = observations.filter(item => item.value !== null), commonInterpretation = valid.length > 0 && valid.every(item => compatibleInterpretations(valid[0], item))
      ? { ...interpretationOf(valid[0]), changeGrade: "" } : descriptiveInterpretation("各期没有统一、有效的评价依据；各次变化分别核对基线与本期，仅有数值依据时显示增加或减少");
    return { ...descriptor, ...commonInterpretation, observations, periods, changes, trend: metadata.continuous ? trend(periods)
      : { available: false, points: [], slopePer30Days: null, reason: "序数和分类数据按原值与状态展示" } };
  }
  function buildAxes(entries, selection) {
    const metadata = new Map();
    for (const entry of entries) for (const axis of entry.stats.axes) {
      const identity = { key: axis.key, method: axis.method, members: axis.members, transforms: axis.transforms,
        definitions: axis.defs.map(definition => ({ id: definition.id, context: measurementContext(entry.record, definition),
          target: definition.target, targetEnabled: definition.targetEnabled, scoring: definition.scoring, scale: definition.measurementScale })) };
      const key = canonical(identity);
      if (!metadata.has(key)) metadata.set(key, { id: axis.key, key, label: axis.label, unit: "分", identity, observations: [] });
      metadata.get(key).observations.push({ athleteId: entry.athleteId, recordId: entry.recordId, date: entry.date, value: axis.value, status: axis.status });
    }
    return [...metadata.values()].map(axis => ({ ...axis, periods: selection.dates.map(date => {
      const observation = axis.observations.find(item => item.date === date), value = N(observation?.value);
      return { date, value, mean: value, n: value === null ? 0 : 1, observations: observation && value !== null ? [observation] : [],
        reason: value === null ? "本期缺少同口径能力评分" : "" };
    }) }));
  }
  function buildSummary(entries, selection) {
    const athleteId = selection.athleteIds[0], cells = new Map(entries.map(entry => [entry.date, entry]));
    const evaluations = new Map(entries.map(entry => [entry, new Map(entry.stats.evaluationResults.map(item => [item.subjectId + "|" + (item.side || ""), item]))]));
    const measurements = new Map(entries.map(entry => [entry, new Map(entry.extracted.map(item => [item.id, item]))]));
    const appraisals = new Map(entries.map(entry => {
      const index = new Map(); for (const result of entry.stats.evaluationResults) if (result.metricId && !index.has(result.metricId)) index.set(result.metricId, result);
      return [entry, index];
    }));
    const measure = (entry, id) => measurements.get(entry)?.get(id);
    const periods = selection.dates.map(date => {
      const entry = cells.get(date), findings = copy(entry?.stats.findings || []), advantages = copy((entry?.stats.advantages.items || []).filter(item => !item.relative));
      const regions = {};
      for (const [key, region] of Object.entries(entry?.stats.signals.regions || {})) {
        regions[key] = { key, name: key, label: region.label, status: region.hasMeasured ? region.status : "gray", measured: !!region.hasMeasured,
          members: region.hasMeasured ? [{ athleteId, recordId: entry.recordId, status: region.status, tests: copy(region.tests || []) }] : [],
          tests: copy(region.tests || []) };
      }
      return { date, athleteId, recordId: entry?.recordId || "", hasResults: !!entry?.stats.validTests.size,
        redCount: findings.filter(item => item.status === "red").length, amberCount: findings.filter(item => item.status === "amber").length,
        advantageCount: advantages.length, findings, advantages, regions };
    });
    const transitions = [], baselineDate = selection.dates[0], baseline = cells.get(baselineDate);
    const judged = item => item && N(item.value) !== null && ["red", "amber", "green"].includes(item.grade?.status);
    for (const date of selection.dates.slice(1)) {
      const latest = cells.get(date);
      for (const key of unique([...(evaluations.get(baseline)?.keys() || []), ...(evaluations.get(latest)?.keys() || [])])) {
        const before = evaluations.get(baseline)?.get(key), after = evaluations.get(latest)?.get(key);
        const metricIds = item => item ? item.metricId ? [item.metricId] : item.directionId ? ["iso_" + item.directionId + "_" + (item.side || "C")]
          : item.kind === "fixed" ? [item.subjectId.replace(":", "_")] : [] : [];
        const a = measure(baseline, metricIds(before)[0]), b = measure(latest, metricIds(after)[0]);
        const canCompare = judged(before) && judged(after) && a && b && a.key === b.key;
        const from = before?.grade?.status || "unknown", to = after?.grade?.status || "unknown", concern = status => ["red", "amber"].includes(status);
        const state = !canCompare ? "unknown" : !concern(from) && concern(to) ? "new" : concern(from) && !concern(to) ? "resolved"
          : concern(from) && concern(to) ? "persistent" : "unchanged";
        transitions.push({ athleteId, fromDate: baselineDate, toDate: date, key, title: after?.name || before?.name || key, from, to, state,
          reason: canCompare ? "" : "前后缺测、评价不可判定或测量内容不一致" });
      }
      const subjects = unique([...(baseline?.stats.advantages.items || []).map(item => item.id), ...(latest?.stats.advantages.items || []).map(item => item.id)]);
      for (const id of subjects) {
        const before = measure(baseline, id), after = measure(latest, id);
        const canCompare = before && after && before.value !== null && after.value !== null && before.key === after.key
          && judged(appraisals.get(baseline)?.get(id)) && judged(appraisals.get(latest)?.get(id));
        const from = !!baseline?.stats.advantages.items.some(item => item.id === id && !item.relative), to = !!latest?.stats.advantages.items.some(item => item.id === id && !item.relative);
        transitions.push({ athleteId, fromDate: baselineDate, toDate: date, key: "advantage:" + id, title: after?.label || before?.label || id, from, to,
          state: !canCompare ? "unknown" : !from && to ? "entered" : from && !to ? "exited" : from && to ? "persistent" : "unchanged",
          reason: canCompare ? "" : "前后缺测或测量不一致" });
      }
    }
    return { periods, latest: periods[periods.length - 1] || null, transitions };
  }
  function buildCapabilities(entries, selection) {
    const athleteId = selection.athleteIds[0];
    return ["strength", "reactive", "speed", "endurance"].map(id => {
      const sourceMember = date => {
        const entry = entries.find(item => item.date === date), direction = entry?.directions.find(item => item.id === id);
        return entry && direction ? { athleteId, recordId: entry.recordId, name: entry.record.athlete.name, ...direction, entry }
          : { athleteId, recordId: "", value: null, hasData: false, status: "gray", judgment: "本期未测", reason: "本日没有有效记录" };
      };
      const memberIdentity = member => {
        const metricId = member.metricId === "fvp" ? (member.context?.protocol || selection.basis.jumpProtocol) + "_imbalance"
          : member.metricId === "sprint_fvp" ? "sprint_fvp_imbalance"
          : member.metricId === "jump_elasticity" ? (member.context?.protocol || selection.basis.jumpProtocol) + "_elasticity_er"
          : member.metricId === "sprint_elasticity" ? "sprint_fvp_elasticity_er" : member.metricId;
        return canonical({ metricId: member.metricId, context: member.context, measure: member.entry?.extracted.find(item => item.id === metricId)?.key || null });
      };
      const sources = new Map(selection.dates.map(date => [date, sourceMember(date)])), templates = new Map();
      for (const entry of entries) {
        const card = entry.stats.capabilityCards.find(card => card.id === (id === "endurance" ? "cardio" : id));
        for (const parameter of card?.metrics || []) {
          const parameterId = parameter.selectedVariant || (parameter.id.startsWith("sprint_elasticity_") ? parameter.id.replace("sprint_elasticity_", "sprint_fvp_elasticity_")
            : /^(?:fvp_sj|fvp_cmj)_(?:fe|ve|er|en)$/.test(parameter.id) ? parameter.id.replace(/_(fe|ve|er|en)$/, "_elasticity_$1") : parameter.id);
          const descriptor = entry.extracted.find(item => item.id === parameterId), identity = descriptor?.key
            || canonical({ id: parameterId, unit: parameter.unit, contexts: (parameter.components || []).map(component => ({ id: component.id, unit: component.unit })) });
          if (!templates.has(identity)) templates.set(identity, { id: parameter.id, key: identity, label: parameter.label, unit: parameter.unit, observations: [] });
          templates.get(identity).observations.push({ athleteId, recordId: entry.recordId, date: entry.date, value: N(parameter.value) });
        }
      }
      const periods = selection.dates.map(date => {
        const { entry, ...member } = sources.get(date), parameters = [...templates.values()].map(parameter => {
          const observations = parameter.observations.filter(item => item.date === date), value = observations[0]?.value ?? null;
          return { id: parameter.id, key: parameter.key, label: parameter.label, unit: parameter.unit, value, mean: value,
            n: value === null ? 0 : 1, observations, reason: value === null ? "本期缺少此参数结果" : "" };
        });
        return { date, n: N(member.value) === null ? 0 : 1, members: [member], parameters };
      });
      const before = sources.get(selection.dates[0]), transitions = periods.slice(1).map(period => {
        const after = sources.get(period.date), compatible = before.hasData && after.hasData && N(before.value) !== null && N(after.value) !== null
          && memberIdentity(before) === memberIdentity(after) && !/待计算|待判断|未设置|未测/.test(before.judgment || "") && !/待计算|待判断|未设置|未测/.test(after.judgment || "");
        return { athleteId, fromDate: selection.dates[0], toDate: period.date, from: before.judgment || "待计算", to: after.judgment || "待计算",
          state: !compatible ? "unknown" : before.judgment === after.judgment ? "unchanged" : "changed", reason: compatible ? "" : "前后缺测或测量口径不一致" };
      });
      return { id, title: { strength: "力量发展方向", reactive: "反应力量水平", speed: "速度发展方向", endurance: "耐力发展方向" }[id],
        basis: selection.basis[id] || "endurance", periods, transitions };
    });
  }
  function finishSteps(steps) { let next = steps.next(); while (!next.done) next = steps.next(); return next.value; }
  function* curveSteps(entries, selection) {
    const curves = new Map();
    const add = (entry, testId, kind, title, unit, xUnit, points, rawPoints, context, support, extra = {}) => {
      points = points.filter(point => N(point.x) !== null && N(point.y) !== null).map(point => ({ ...point, x: N(point.x), y: N(point.y) }));
      if (!points.length) return;
      const { seriesModel, ...curveMetadata } = extra;
      const key = canonical({ testId, kind, unit, xUnit, context }), curve = curves.get(key) || { key, testId, kind, title, unit, xUnit,
        xLabel: xUnit, yLabel: title + (unit ? "（" + unit + "）" : ""), protocol: context, series: [], common: [], ...curveMetadata };
      curve.series.push({ athleteId: entry.athleteId, date: entry.date, recordId: entry.recordId, label: entry.date,
        points, rawPoints: rawPoints || points, model: seriesModel || null,
        supportedMin: support?.[0] ?? Math.min(...points.map(point => point.x)), supportedMax: support?.[1] ?? Math.max(...points.map(point => point.x)) });
      curves.set(key, curve);
    };
    for (const [entryIndex, entry] of entries.entries()) {
      const { record, stats } = entry;
      if (stats.raw.forceTime?.valid !== false && stats.raw.forceTime?.timeRows) {
        const context = M.imtpTimeContext(record), rows = stats.raw.forceTime.timeRows;
        for (const [kind, key, unit] of [["force", "force", "N"], ["rfd", "rfd", "N/s"], ["force_pct_peak", "forcePercent", "%PF"]]) {
          const points = rows.filter(row => kind !== "force_pct_peak" || row.forcePercentValid).map(row => ({ x: row.timeMs, y: row[key] }));
          add(entry, "imtp", kind, { force: "IMTP 实测力", rfd: "IMTP RFD", force_pct_peak: "IMTP 力 / PF" }[kind], unit, "ms", points, points, context, null);
        }
      }
      for (const id of ["fvp_sj", "fvp_cmj", "sprint_fvp"]) {
        const solved = id === "sprint_fvp" ? stats.sprintFvp : stats.fvp[id];
        if (!record.enabled[id] || !solved?.valid) continue;
        const points = solved.points || [], context = { measurement: measurementContext(record, { id, testId: id }), config: protocolConfig(solved.config) };
        const raw = id === "sprint_fvp" ? (solved.samples || []).map(point => ({ x: point.velocity ?? point.velocityMps, y: point.forceRelative ?? point.force })) : points.map(point => ({ x: point.velocity, y: point.forceRelative }));
        const measuredXs = raw.filter(point => N(point.x) !== null && N(point.y) !== null).map(point => point.x), low = measuredXs.length ? Math.min(...measuredXs) : 0, high = measuredXs.length ? Math.max(...measuredXs) : solved.model.V0;
        const grid = Array.from({ length: 41 }, (_, i) => low + (high - low) * i / 40), force = x => solved.model.F0 + solved.model.slope * x;
        add(entry, id, "fv", "F–V", "N/kg", "m/s", grid.map(x => ({ x, y: force(x) })), id === "sprint_fvp" ? [] : raw, context, [low, high], { fitted: true, seriesModel: { a: solved.model.F0, b: solved.model.slope, transform: "linear" } });
        add(entry, id, "pv", "P–V", "W/kg", "m/s", grid.map(x => ({ x, y: force(x) * x })), id === "sprint_fvp" ? [] : raw.map(point => ({ x: point.x, y: point.y * point.x })), context, [low, high], { fitted: true, seriesModel: { a: solved.model.F0, b: solved.model.slope, transform: "power" } });
        const elasticity = id === "sprint_fvp" ? stats.sprintElasticity : solved;
        if (!elasticity?.elasticity) continue;
        const ec = { ...context, method: elasticity.methodVersion || "jump-li-2026", targetDistanceM: elasticity.targetDistanceM || null, angle: id === "sprint_fvp" ? null : solved.analysis.angle };
        for (const source of ["force", "velocity", "both"]) {
          const response = (elasticity.sensitivity?.[source] || []).map(point => ({ x: point.changePct, y: id === "sprint_fvp" ? point.timeS : point.heightCm }));
          add(entry, id, "elasticity_response_" + source, "弹性响应 · " + source, id === "sprint_fvp" ? "s" : "cm", "%", response, [], ec, null, { fitted: true });
        }
        const constraint = id === "sprint_fvp" ? elasticity.constraint : solved.elasticityConstraint;
        if (id === "sprint_fvp") for (const output of ["Fe", "ve", "ER", "EN"]) add(entry, id, "elasticity_constraint_" + output.toLowerCase(), "距离弹性 · " + output, "", "m", (constraint?.points || []).map(point => ({ x: point.distanceM, y: point[output] })), [], ec, null, { fitted: true });
        else add(entry, id, "elasticity_constraint", "等高度弹性 · ER–EN", "", "ER", (constraint?.points || []).map(point => ({ x: point.ER, y: point.EN })), [], ec, null, { fitted: true });
      }
      for (const solved of stats.lvpSeries || []) {
        if (!solved.fit.valid) continue;
        const context = { protocol: measurementContext(record, { id: solved.id, testId: solved.testId }), metric: record.lvp[solved.id]?.metric || "MV", side: solved.side || "" };
        const grid = Array.from({ length: 41 }, (_, index) => solved.fit.minX + (solved.fit.maxX - solved.fit.minX) * index / 40);
        add(entry, solved.testId, "lvp_" + solved.id, solved.label + " LVP", "m/s", "kg", grid.map(x => ({ x, y: solved.fit.a + solved.fit.b * x })), solved.points.map(point => ({ x: point.load, y: point.velocity })), context, [solved.fit.minX, solved.fit.maxX], { fitted: true, seriesModel: { a: solved.fit.a, b: solved.fit.b, transform: "linear" } });
      }
      for (const [kind, unit] of [["lactate", "mmol/L"], ["hr", "bpm"]]) {
        const points = (stats.raw.lactate || []).map(point => ({ x: point.speed, y: point[kind] }));
        add(entry, "lactate", kind, kind === "lactate" ? "乳酸" : "心率", unit, "m/s", points, points, measurementContext(record, { id: kind, testId: "lactate", unit }), null);
      }
      if ((entryIndex + 1) % 4 === 0) yield { stage: "curve-series", completed: entryIndex + 1, count: entries.length };
    }
    return [...curves.values()];
  }
  function* comparisonSteps(input, selection) {
    const prepared = preparedInputs.get(input);
    const inputs = prepared ? input : input?.entries ? copy(input) : readComparisonInputs(input, selection || input?.selection || {});
    inputs.selection = assertPersonalSelection(normalizeSelection(selection || inputs.selection));
    assertPersonalEntries(inputs);
    applyExplicitBasis(inputs);
    const basis = inputs.selection.basis;
    const measurementDigests = new Map();
    // Resolve a single default basis and jump protocol once for this report.
    for (const [index, entry] of inputs.entries.entries()) {
      const saved = prepared?.get(entry.record), matches = saved && saved.canonicalRecord === canonical(entry.record);
      entry.stats = matches ? saved.stats : cachedStats(entry.record);
      measurementDigests.set(entry, matches ? saved.measurementDigest : cachedMetadata.get(entry.stats)?.measurementDigest);
      if ((index + 1) % 4 === 0) yield { stage: "record-statistics", completed: index + 1, count: inputs.entries.length };
    }
    for (const key of ["strength", "reactive", "speed"]) if (!basis[key]) {
      basis[key] = M.capabilityDirectionOptions[key].find(([id]) => inputs.entries.some(entry => {
        const r = copy(entry.record); r.views.capabilitySelections[key] = id;
        return N(M.capabilityDirections(r, entry.stats).find(direction => direction.id === key)?.value) !== null;
      }))?.[0] || M.capabilityDirectionOptions[key][0][0];
    }
    if (!basis.jumpProtocol) basis.jumpProtocol = ["fvp_sj", "fvp_cmj"].find(id => inputs.entries.some(entry => entry.record.enabled[id] && entry.stats.fvp[id]?.valid)) || "fvp_sj";
    const entries = [];
    for (const [index, entry] of inputs.entries.entries()) {
      entry.record.views.capabilitySelections = { ...entry.record.views.capabilitySelections, strength: basis.strength, reactive: basis.reactive, speed: basis.speed };
      entry.record.views.fvpProtocol = basis.jumpProtocol;
      entry.directions = M.capabilityDirections(entry.record, entry.stats);
      const cached = cachedMetadata.get(entry.stats);
      entry.extracted = cached?.extracted ? cloneStats(cached.extracted) : extraction(entry);
      entries.push(entry);
      if ((index + 1) % 4 === 0) yield { stage: "metric-extraction", completed: index + 1, count: inputs.entries.length };
    }
    const metadata = new Map(); for (const entry of entries) for (const item of entry.extracted) if (!metadata.has(item.key)) metadata.set(item.key, item);
    const indexes = new Map(entries.map(entry => {
      const byId = new Map(); for (const item of entry.extracted) if (!byId.has(item.id)) byId.set(item.id, item);
      return [entry, { byKey: new Map(entry.extracted.map(item => [item.key, item])), byId }];
    }));
    const metrics = [];
    for (const item of metadata.values()) {
      metrics.push(buildMetric(item, entries, inputs.selection, indexes, inputs.issues));
      if (metrics.length % 8 === 0) yield { stage: "metric-statistics", completed: metrics.length, count: metadata.size };
    }
    const descriptors = new Map(); for (const entry of entries) for (const project of T.describe(entry.record)) if (!descriptors.has(project.id)) descriptors.set(project.id, project);
    const projects = unique(metrics.map(metric => metric.testId)).map(id => {
      const descriptor = descriptors.get(id);
      return { id, name: descriptor?.name ? T.displayName(descriptor, entries[0]?.record) : id === "derived" ? "训练方向参数" : id,
        renderer: descriptor?.renderer || "scalar", metrics: metrics.filter(metric => metric.testId === id),
        reportView: descriptor?.renderer === "scalar" && entries[0] ? root.RingsideGenericReport?.resolveView(entries.find(entry => entry.record.enabled[id])?.record || entries[0].record, id, inputs.catalog) : undefined };
    });
    const selectionValue = inputs.selection, kind = "personal-longitudinal";
    const fingerprints = [], profileDigests = new Map();
    for (const [index, entry] of entries.entries()) {
      let profile = null;
      if (entry.evaluationProfile) {
        const content = canonical(entry.evaluationProfile);
        if (!profileDigests.has(content)) profileDigests.set(content, hash(E.signature(entry.evaluationProfile)));
        profile = profileDigests.get(content);
      }
      fingerprints.push({ athleteId: entry.athleteId, recordId: entry.recordId, data: measurementDigests.get(entry) || hash(M.fingerprint(entry.record)), basis: M.capabilityDirectionsBasis(entry.record, entry.stats), profile });
      if ((index + 1) % 4 === 0) yield { stage: "fingerprint", completed: index + 1, count: entries.length };
    }
    const fingerprint = hash({ statistics: comparisonMethodVersion, selection: selectionValue, records: fingerprints });
    yield { stage: "summary" }; const summary = buildSummary(entries, selectionValue);
    yield { stage: "capabilities" }; const capabilities = buildCapabilities(entries, selectionValue);
    yield { stage: "axes" }; const axes = buildAxes(entries, selectionValue);
    yield { stage: "curves" }; const curves = yield* curveSteps(entries, selectionValue);
    return { version: 1, kind, selection: selectionValue, athletes: inputs.athletes || [], dates: selectionValue.dates, entries, metrics, projects, catalog: inputs.catalog || {},
      ready: inputs.ready !== false, issues: inputs.issues || [], summary, capabilities, axes, curves, fingerprint, inputFingerprint: fingerprint,
      statistics: { version: comparisonMethodVersion, numericalRoundoff: { relativeFactor: roundoffFactor, epsilon: Number.EPSILON,
        scale: "实际参与运算的原值尺度", absoluteTolerance: 0, purpose: "仅处理IEEE-754机器舍入，不作为测量误差或训练意义阈值" },
        baselineDate: selectionValue.dates[0], change: "本期代表值减最早所选日期代表值；缺测或口径不兼容时不计算",
        changeInterpretation: "仅在基线与本期具有兼容且有效的原评价依据时解释改善或下降；其余非零变化仅描述增加或减少",
        percentChange: "比例尺度且基线为正；百分数指标使用百分点变化", trend: "真实日期普通最小二乘描述性线性趋势" } };
  }
  function deriveComparison(input, selection) { return finishSteps(comparisonSteps(input, selection)); }
  async function deriveComparisonAsync(input, { onProgress, isCurrent = () => true } = {}) {
    const inputs = input?.entries ? copy(input) : readComparisonInputs(input, input?.selection || {});
    inputs.selection = assertPersonalSelection(normalizeSelection(inputs.selection)); assertPersonalEntries(inputs); applyExplicitBasis(inputs);
    const checkCurrent = () => {
      if (!isCurrent()) { const error = new Error("比较计算已取消"); error.name = "AbortError"; throw error; }
    };
    const yieldTask = () => new Promise(resolve => root.setTimeout(resolve, 0)), total = inputs.entries.length;
    const prepared = new Map(); preparedInputs.set(inputs, prepared);
    try {
      checkCurrent(); onProgress?.({ current: 0, total, phase: "records" });
      await yieldTask(); checkCurrent();
      for (let index = 0; index < total; index++) {
        checkCurrent(); const record = inputs.entries[index].record;
        const canonicalRecord = canonical(record), key = statisticsVersion + ":" + hash(canonicalRecord), stats = cachedStats(record, key, canonicalRecord);
        prepared.set(record, { stats, canonicalRecord, measurementDigest: cachedMetadata.get(stats).measurementDigest });
        onProgress?.({ current: index + 1, total, phase: "records" });
        if ((index + 1) % 4 === 0) { await yieldTask(); checkCurrent(); }
      }
      onProgress?.({ current: total, total, phase: "comparison" });
      await yieldTask(); checkCurrent();
      const steps = comparisonSteps(inputs); let next = steps.next();
      while (!next.done) {
        onProgress?.({ current: total, total, phase: "comparison", ...next.value });
        await yieldTask(); checkCurrent(); next = steps.next();
      }
      checkCurrent(); return next.value;
    } finally { preparedInputs.delete(inputs); }
  }
  root.RingsideComparison = Object.freeze({ normalizeSelection, selectionKey, readComparisonInputs, deriveComparison,
    deriveComparisonAsync, numericDifference, trend, extractMetrics: extraction, canonical, hash });
})(typeof window !== "undefined" ? window : globalThis);
