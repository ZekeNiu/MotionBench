(function (root) {
  "use strict";
  const M = root.RingsideModel, T = root.RingsideTests, E = root.RingsideEvaluation;
  const N = root.Calc.num, copy = value => JSON.parse(JSON.stringify(value));
  const order = value => Array.isArray(value) ? value.map(order) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, order(value[key])])) : value;
  const canonical = value => JSON.stringify(order(value));
  const statisticsVersion = "comparison-record-statistics-v1", statisticsCache = new Map(), criticalCache = new Map(), preparedInputs = new WeakMap(), cachedMetadata = new WeakMap();
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
    const library = source?.library || source, selected = normalizeSelection(selection), issues = [], entries = [], athletes = [];
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
      ready: selected.athleteIds.length > 0 && selected.dates.length > 0 && !issues.some(item => ["ambiguous-record", "missing-record", "missing-athlete"].includes(item.kind)),
      catalog: copy(library.catalog || source?.catalog || {}), evaluationProfiles: copy(library.evaluationProfiles || source?.evaluationProfiles || []),
      revision: source?.versionState || library.updated || null, expectedConfig: source?.expectedConfig || null };
  }
  function quantile(values, probability) {
    const sorted = values.filter(value => N(value) !== null).map(N).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * probability, lower = Math.floor(index), fraction = index - lower;
    return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
  }
  function descriptive(values, allowCV = false) {
    const xs = values.map(N).filter(value => value !== null), stats = root.Calc.descriptive(xs, allowCV);
    const q1 = quantile(xs, .25), q3 = quantile(xs, .75);
    return { ...stats, median: quantile(xs, .5), q1, q3, iqr: q1 === null ? null : q3 - q1,
      min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null };
  }
  // Lanczos log-gamma and continued-fraction incomplete beta give exact Student-t tails.
  function logGamma(z) {
    const coefficients = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let x = .99999999999980993;
    coefficients.forEach((value, index) => { x += value / (z + index + 1); });
    const t = z + coefficients.length - .5;
    return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x);
  }
  function betaFraction(a, b, x) {
    const tiny = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let result = d;
    for (let m = 1; m <= 250; m++) {
      let aa = m * (b - m) * x / ((qam + 2 * m) * (a + 2 * m));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d; result *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + 2 * m) * (qap + 2 * m));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c; result *= delta;
      if (Math.abs(delta - 1) < 3e-14) break;
    }
    return result;
  }
  function regularizedBeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
    return x < (a + 1) / (a + b + 2) ? front * betaFraction(a, b, x) / a : 1 - front * betaFraction(b, a, 1 - x) / b;
  }
  function studentP(t, df) {
    if (N(t) === null || N(df) === null || df < 1) return null;
    return Math.max(0, Math.min(1, regularizedBeta(df / (df + t * t), df / 2, .5)));
  }
  function criticalT(df, alpha = .05) {
    if (!Number.isInteger(df) || df < 1 || !(alpha > 0 && alpha < 1)) return null;
    const key = df + "|" + alpha;
    if (criticalCache.has(key)) return criticalCache.get(key);
    let low = 0, high = 1;
    while (studentP(high, df) > alpha && high < 1e12) high *= 2;
    for (let i = 0; i < 80; i++) { const mid = (low + high) / 2; if (studentP(mid, df) > alpha) low = mid; else high = mid; }
    const value = (low + high) / 2;
    criticalCache.set(key, value);
    if (criticalCache.size > 256) criticalCache.delete(criticalCache.keys().next().value);
    return value;
  }
  function paired(base, current, { infer = true, allowPercent = false, unit = "", continuous = true } = {}) {
    const pairs = base.map((value, index) => [N(value), N(current[index])]).filter(pair => pair.every(value => value !== null));
    const differences = pairs.map(([before, after]) => after - before), distribution = descriptive(differences);
    const baseline = descriptive(pairs.map(pair => pair[0])), latest = descriptive(pairs.map(pair => pair[1]));
    const delta = distribution.mean, percentChange = allowPercent && baseline.mean > 0 && delta !== null ? 100 * delta / baseline.mean : null;
    const result = { n: pairs.length, baselineMean: baseline.mean, currentMean: latest.mean, delta, meanChange: delta,
      percentChange, deltaUnit: /^(?:%|%PF)$/.test(unit) ? "百分点" : unit, sdChange: distribution.sd,
      ciLow: null, ciHigh: null, t: null, df: null, p: null, pAdjusted: null, dz: null, reason: "", differences };
    if (!continuous) { result.reason = "序数或分类结果按原值和状态转移展示"; return result; }
    if (!infer) { result.reason = "个人纵向采用实测变化，不估计队员间的配对检验"; return result; }
    if (pairs.length < 2) { result.reason = "有效配对少于2人，无法估计差值的标准差与推断统计"; return result; }
    if (!(distribution.sd > 0)) { result.reason = "配对差值零方差，t与Cohen’s dz无法估计"; return result; }
    const se = distribution.sd / Math.sqrt(pairs.length), df = pairs.length - 1, t = delta / se, half = criticalT(df) * se;
    Object.assign(result, { t, df, p: studentP(t, df), dz: delta / distribution.sd, ciLow: delta - half, ciHigh: delta + half });
    return result;
  }
  function holm(values, familySize = values.length) {
    const usable = values.map((p, index) => ({ p: N(p), index })).filter(item => item.p !== null && item.p >= 0 && item.p <= 1).sort((a, b) => a.p - b.p);
    const results = values.map(() => null), m = Math.max(familySize, usable.length);
    let maximum = 0;
    usable.forEach(({ p, index }, rank) => { maximum = Math.max(maximum, Math.min(1, (m - rank) * p)); results[index] = maximum; });
    return results;
  }
  function trend(periods) {
    const points = periods.filter(item => day(item.date) !== null && N(item.mean) !== null).map(item => ({ date: item.date, value: item.mean, n: item.n }));
    if (points.length < 3) return { available: false, reason: "至少三个不同测试日期才绘制描述性线性趋势", points, slopePer30Days: null, r2: null };
    const origin = day(points[0].date), xs = points.map(point => (day(point.date) - origin) / 86400000), ys = points.map(point => point.value);
    const meanX = descriptive(xs).mean, meanY = descriptive(ys).mean;
    const sxx = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0), sxy = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0);
    const slope = sxy / sxx, intercept = meanY - slope * meanX;
    const sst = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0), residual = ys.reduce((sum, y, index) => sum + (y - intercept - slope * xs[index]) ** 2, 0);
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
      items.push({ id, testId, label, unit: unit || "", key: canonical(identity), identity, direction: extra.direction || definition?.direction || "higher",
        measurementScale: scale, continuous, allowCV: continuous && scale === "ratio" && definition?.cvEligible !== false && !/^(?:%|%PF|分)$/.test(unit || ""),
        value: N(value), reason: extra.reason || (N(value) === null ? "缺少有效结果" : ""), ...extra });
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
      add(result.id, "imtp", result.name, result.value, result.unit, { timeMs: result.timeMs, context: { ...measurementContext(record, { id: result.id, testId: "imtp", unit: result.unit }), force: M.imtpTimeContext(record) } });
      if (result.kind === "force") add(result.id + "_pct_peak", "imtp", "IMTP " + result.timeMs + " ms / PF", stats.raw.forceTime?.timeRows.find(point => point.timeMs === result.timeMs)?.forcePercentValid === false ? null : result.forcePercent, "%PF",
        { timeMs: result.timeMs, context: { ...M.imtpTimeContext(record), kind: "force_pct_peak" } });
    }
    for (const row of stats.isoAnalyses) {
      const sourceRow = record.data.iso.find(item => item.id === row.id), context = E?.isoContext ? E.isoContext(sourceRow, record) : { direction: row.direction, region: row.region, unit: row.unit };
      for (const side of row.sides) add("iso_" + row.id + "_" + (side.side || "C"), "iso", row.direction + " " + (side.side || ""), side.value, row.unit,
        { side: side.side || "C", context, aggregation: "record", pain: side.pain === true, status: side.status });
      if (row.paired) add("iso_" + row.id + "_asym", "iso", row.direction + " 双侧差异", row.asym, "%", { context, direction: "lower", aggregation: "record" });
    }
    for (const pair of stats.balanceResults) {
      const sourcePair = record.balancePairs.find(item => item.id === pair.id), contexts = sourcePair ? [sourcePair.numeratorId, sourcePair.denominatorId].map(id => {
        const row = record.data.iso.find(item => item.id === id); return row && E?.isoContext ? E.isoContext(row, record) : row?.protocolIdentity || null;
      }) : [];
      for (const side of pair.results) add("balance_" + pair.id + "_" + (side.side || "C"), "iso", pair.label + " " + (side.side || ""), side.value, "比值", { side: side.side || "C", context: contexts, aggregation: "record" });
    }
    for (const [index, item] of (stats.raw.fms?.items || []).entries()) {
      const extra = { continuous: false, measurementScale: "ordinal", aggregation: "record", pain: item.pain === true, notes: item.notes || "" };
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
  function buildMetric(metadata, entries, selection, indexes) {
    const byEntry = new Map();
    for (const entry of entries) {
      const index = indexes?.get(entry), exact = index ? index.byKey.get(metadata.key) : entry.extracted.find(item => item.key === metadata.key),
        sibling = index ? index.byId.get(metadata.id) : entry.extracted.find(item => item.id === metadata.id);
      const mismatch = !sibling ? "本记录未测此指标" : sibling.unit !== metadata.unit ? "单位不一致：本记录为 " + (sibling.unit || "无单位") + "，此指标为 " + (metadata.unit || "无单位")
        : sibling.identity.aggregation !== metadata.identity.aggregation ? "代表成绩取值口径不一致：本记录为 " + sibling.identity.aggregation + "，此指标为 " + metadata.identity.aggregation
        : "测量协议或测量条件不一致";
      byEntry.set(entry.athleteId + "|" + entry.date, { athleteId: entry.athleteId, date: entry.date, recordId: entry.recordId,
        value: exact ? exact.value : null, reason: exact ? exact.reason || "" : mismatch,
        pain: exact?.pain || false, status: exact?.status || "gray" });
    }
    const observations = selection.athleteIds.flatMap(athleteId => selection.dates.map(date => byEntry.get(athleteId + "|" + date) || { athleteId, date, recordId: "", value: null, reason: "本日没有有效记录" }));
    const cells = new Map(observations.map(item => [item.athleteId + "|" + item.date, item]));
    const cohortIds = selection.athleteIds.filter(id => selection.dates.every(date => cells.get(id + "|" + date).value !== null));
    const longitudinal = selection.dates.length > 1;
    const periods = selection.dates.map(date => {
      const all = observations.filter(item => item.date === date), included = all.filter(item => item.value !== null && (!longitudinal || cohortIds.includes(item.athleteId)));
      const stats = descriptive(included.map(item => item.value), metadata.allowCV);
      const distribution = metadata.continuous ? null : Object.fromEntries(unique(included.map(item => String(item.value))).sort().map(value => [value, included.filter(item => String(item.value) === value).length]));
      return { date, ...stats, observations: included, allObservations: all, distribution, painCount: included.filter(item => item.pain).length };
    });
    const base = periods[0], changes = periods.slice(1).map(period => {
      const first = cohortIds.map(id => cells.get(id + "|" + base.date)?.value);
      const current = cohortIds.map(id => cells.get(id + "|" + period.date)?.value);
      const result = paired(first, current, { infer: selection.athleteIds.length > 1, continuous: metadata.continuous, unit: metadata.unit,
        allowPercent: metadata.measurementScale === "ratio" && !/^(?:%|%PF|分)$/.test(metadata.unit) });
      return { date: period.date, baselineDate: base.date, ...result, improvement: result.delta === null ? "unknown" : result.delta === 0 ? "unchanged" : metadata.direction === "lower" ? result.delta < 0 ? "improved" : "declined" : metadata.direction === "higher" ? result.delta > 0 ? "improved" : "declined" : "changed" };
    });
    const { value, reason, definition, ...descriptor } = metadata;
    return { ...descriptor, observations, cohortIds, periods, changes, trend: metadata.continuous ? trend(periods) : { available: false, points: [], slopePer30Days: null, reason: "序数和分类数据按原值与状态展示" } };
  }
  function aggregateAxes(entries, selection) {
    const metadata = new Map();
    for (const entry of entries) for (const axis of entry.stats.axes) {
      const identity = { key: axis.key, method: axis.method, members: axis.members, transforms: axis.transforms,
        definitions: axis.defs.map(definition => ({ id: definition.id, context: measurementContext(entry.record, definition),
          target: definition.target, targetEnabled: definition.targetEnabled, scoring: definition.scoring, scale: definition.measurementScale })) };
      const key = canonical(identity);
      if (!metadata.has(key)) metadata.set(key, { id: axis.key, key, label: axis.label, unit: "分", identity, observations: [] });
      metadata.get(key).observations.push({ athleteId: entry.athleteId, recordId: entry.recordId, date: entry.date, value: axis.value, status: axis.status });
    }
    return [...metadata.values()].map(axis => {
      const cohortIds = selection.athleteIds.filter(id => selection.dates.every(date => axis.observations.some(item => item.athleteId === id && item.date === date)));
      return { ...axis, cohortIds, periods: selection.dates.map(date => { const observations = axis.observations.filter(item => item.date === date && (selection.dates.length === 1 || cohortIds.includes(item.athleteId))); return { date, ...descriptive(observations.map(item => item.value)), observations }; }) };
    });
  }
  function buildSummary(entries, selection) {
    const cells = new Map(entries.map(entry => [entry.athleteId + "|" + entry.date, entry]));
    const evaluations = new Map(entries.map(entry => [entry, new Map(entry.stats.evaluationResults.map(item => [item.subjectId + "|" + (item.side || ""), item]))]));
    const measurements = new Map(entries.map(entry => [entry, new Map(entry.extracted.map(item => [item.id, item]))]));
    const appraisals = new Map(entries.map(entry => {
      const index = new Map(); for (const result of entry.stats.evaluationResults) if (result.metricId && !index.has(result.metricId)) index.set(result.metricId, result);
      return [entry, index];
    }));
    const measure = (entry, id) => measurements.get(entry)?.get(id);
    const periods = selection.dates.map(date => {
      const present = entries.filter(entry => entry.date === date), counted = status => present.filter(entry => entry.stats.findings.some(item => item.status === status)).map(entry => entry.athleteId);
      const red = counted("red"), amber = counted("amber"), advantage = present.filter(entry => entry.stats.advantages.items.some(item => !item.relative)).map(entry => entry.athleteId);
      const regions = {};
      for (const entry of present) for (const [key, region] of Object.entries(entry.stats.signals.regions || {})) {
        const out = regions[key] ||= { key, name: key, label: region.label, n: 0, count: 0, redCount: 0, amberCount: 0, greenCount: 0, status: "gray", members: [], tests: [] };
        if (!region.hasMeasured) continue;
        out.n++; out.members.push({ athleteId: entry.athleteId, recordId: entry.recordId, status: region.status, tests: copy(region.tests || []) });
        if (["red", "amber", "green"].includes(region.status)) out[region.status + "Count"]++;
        if (["red", "amber"].includes(region.status)) out.count++;
        out.tests.push(...(region.tests || []).map(test => ({ ...copy(test), athleteId: entry.athleteId, recordId: entry.recordId })));
        const severity = { gray: 0, green: 1, amber: 2, red: 3 }; if (severity[region.status] > severity[out.status]) out.status = region.status;
      }
      return { date, selectedCount: selection.athleteIds.length, resultCount: present.filter(entry => entry.stats.validTests.size > 0).length,
        redCount: red.length, amberCount: amber.length, advantageCount: advantage.length,
        red: { count: red.length, athleteIds: red }, amber: { count: amber.length, athleteIds: amber }, advantage: { count: advantage.length, athleteIds: advantage }, regions };
    });
    const transitions = [], baselineDate = selection.dates[0];
    for (const athleteId of selection.athleteIds) {
      const baseline = cells.get(athleteId + "|" + baselineDate);
      for (const date of selection.dates.slice(1)) {
        const latest = cells.get(athleteId + "|" + date);
        for (const key of unique([...(evaluations.get(baseline)?.keys() || []), ...(evaluations.get(latest)?.keys() || [])])) {
          const find = entry => evaluations.get(entry)?.get(key);
          const before = find(baseline), after = find(latest);
          const metricIds = item => item ? item.metricId ? [item.metricId] : item.directionId ? ["iso_" + item.directionId + "_" + (item.side || "C")] : item.kind === "fixed" ? [item.subjectId.replace(":", "_")] : [] : [];
          const a = measure(baseline, metricIds(before)[0]), b = measure(latest, metricIds(after)[0]);
          const fullHistory = selection.dates.map(historyDate => cells.get(athleteId + "|" + historyDate));
          const canCompare = before && after && before.value !== null && after.value !== null && a && b && a.key === b.key
            && fullHistory.every(entry => {
              const result = find(entry), measurement = measure(entry, metricIds(result)[0]);
              return result && N(result.value) !== null && result.grade?.status !== "gray" && measurement && measurement.key === a.key;
            });
          const from = before?.grade?.status || "unknown", to = after?.grade?.status || "unknown";
          const concern = status => ["red", "amber"].includes(status);
          const state = !canCompare ? "unknown" : !concern(from) && concern(to) ? "new" : concern(from) && !concern(to) ? "resolved" : concern(from) && concern(to) ? "persistent" : "unchanged";
          transitions.push({ athleteId, fromDate: baselineDate, toDate: date, key, title: after?.name || before?.name || key, from, to, state, reason: canCompare ? "" : "前后缺测、评价不可判定或测量内容不一致" });
        }
        const advantageSubjects = unique([...(baseline?.stats.advantages.items || []).map(item => item.id), ...(latest?.stats.advantages.items || []).map(item => item.id)]);
        for (const id of advantageSubjects) {
          const before = measure(baseline, id), after = measure(latest, id), canCompare = before && after && before.value !== null && after.value !== null && before.key === after.key
            && selection.dates.every(historyDate => {
              const entry = cells.get(athleteId + "|" + historyDate), measurement = measure(entry, id);
              const appraisal = appraisals.get(entry)?.get(id);
              return measurement && measurement.key === before.key && N(measurement.value) !== null && appraisal && appraisal.grade?.status !== "gray";
            });
          const from = !!baseline?.stats.advantages.items.some(item => item.id === id && !item.relative), to = !!latest?.stats.advantages.items.some(item => item.id === id && !item.relative);
          transitions.push({ athleteId, fromDate: baselineDate, toDate: date, key: "advantage:" + id, title: after?.label || before?.label || id, from, to,
            state: !canCompare ? "unknown" : !from && to ? "entered" : from && !to ? "exited" : from && to ? "persistent" : "unchanged", reason: canCompare ? "" : "前后缺测或测量不一致" });
        }
      }
    }
    return { periods, latest: periods[periods.length - 1] || null, transitions };
  }
  function buildCapabilities(entries, selection) {
    return ["strength", "reactive", "speed", "endurance"].map(id => {
      const sourceMembers = date => entries.filter(entry => entry.date === date).map(entry => ({ athleteId: entry.athleteId, recordId: entry.recordId, name: entry.record.athlete.name,
        ...entry.directions.find(direction => direction.id === id), entry })).filter(item => item.hasData);
      const memberIdentity = member => {
        if (!member) return null;
        const metricId = member.metricId === "fvp" ? (member.context?.protocol || selection.basis.jumpProtocol) + "_imbalance"
          : member.metricId === "sprint_fvp" ? "sprint_fvp_imbalance"
          : member.metricId === "jump_elasticity" ? (member.context?.protocol || selection.basis.jumpProtocol) + "_elasticity_er"
          : member.metricId === "sprint_elasticity" ? "sprint_fvp_elasticity_er" : member.metricId;
        return canonical({ metricId: member.metricId, context: member.context, measure: member.entry?.extracted.find(item => item.id === metricId)?.key || null });
      };
      const availableByDate = selection.dates.map(date => sourceMembers(date)), cohortIds = selection.athleteIds.filter(athleteId => {
        const history = availableByDate.map(members => members.find(member => member.athleteId === athleteId)), first = history[0];
        return first && history.every(member => member && N(member.value) !== null && member.judgment && !/待计算|待判断|未设置|未测/.test(member.judgment) && memberIdentity(member) === memberIdentity(first));
      });
      const parameterTemplates = new Map();
      for (const entry of entries) {
        const card = entry.stats.capabilityCards.find(card => card.id === (id === "endurance" ? "cardio" : id));
        for (const parameter of card?.metrics || []) {
          const parameterId = parameter.selectedVariant || (parameter.id.startsWith("sprint_elasticity_") ? parameter.id.replace("sprint_elasticity_", "sprint_fvp_elasticity_")
            : /^(?:fvp_sj|fvp_cmj)_(?:fe|ve|er|en)$/.test(parameter.id) ? parameter.id.replace(/_(fe|ve|er|en)$/, "_elasticity_$1") : parameter.id);
          const descriptor = entry.extracted.find(item => item.id === parameterId), identity = descriptor?.key || canonical({ id: parameterId, unit: parameter.unit, contexts: (parameter.components || []).map(component => ({ id: component.id, unit: component.unit })) });
          if (!parameterTemplates.has(identity)) parameterTemplates.set(identity, { id: parameter.id, key: identity, label: parameter.label, unit: parameter.unit, observations: [] });
          parameterTemplates.get(identity).observations.push({ athleteId: entry.athleteId, date: entry.date, value: parameter.value });
        }
      }
      for (const parameter of parameterTemplates.values()) parameter.cohortIds = selection.athleteIds.filter(athleteId => cohortIds.includes(athleteId)
        && selection.dates.every(date => parameter.observations.some(item => item.athleteId === athleteId && item.date === date && N(item.value) !== null)));
      const periods = selection.dates.map(date => {
        const availableMembers = sourceMembers(date).map(({ entry, ...member }) => member);
        const members = availableMembers.filter(member => selection.dates.length === 1 || cohortIds.includes(member.athleteId));
        const groups = unique(members.map(item => canonical([item.metricId, item.context, item.judgment, item.status]))).map(key => {
          const items = members.filter(item => canonical([item.metricId, item.context, item.judgment, item.status]) === key), first = items[0];
          return { judgment: first.judgment, status: first.status, metricId: first.metricId, context: first.context, count: items.length, athleteIds: items.map(item => item.athleteId), names: items.map(item => item.name) };
        });
        const parameters = [...parameterTemplates.values()].map(parameter => {
          const observations = parameter.observations.filter(item => item.date === date && (selection.dates.length === 1 || parameter.cohortIds.includes(item.athleteId)));
          return { ...parameter, observations, ...descriptive(observations.map(item => item.value), false) };
        });
        return { date, n: members.filter(item => item.value !== null).length, members, availableMembers, availableCount: availableMembers.filter(item => item.value !== null).length,
          groups, parameters };
      });
      const transitions = [];
      for (const athleteId of selection.athleteIds) {
        const before = periods[0]?.members.find(item => item.athleteId === athleteId);
        for (const period of periods.slice(1)) {
          const after = period.members.find(item => item.athleteId === athleteId), compatible = before && after && before.value !== null && after.value !== null && before.metricId === after.metricId && canonical(before.context) === canonical(after.context);
          transitions.push({ athleteId, fromDate: periods[0].date, toDate: period.date, from: before?.judgment || "待计算", to: after?.judgment || "待计算", state: !compatible ? "unknown" : before.judgment === after.judgment ? "unchanged" : "changed" });
        }
      }
      return { id, title: { strength: "力量发展方向", reactive: "反应力量水平", speed: "速度发展方向", endurance: "耐力发展方向" }[id], basis: selection.basis[id] || "endurance", cohortIds, periods, transitions };
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
      curve.series.push({ athleteId: entry.athleteId, date: entry.date, recordId: entry.recordId, label: entry.record.athlete.name,
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
    const interpolate = (series, x) => {
      if (series.model) { const y = series.model.a + series.model.b * x; return series.model.transform === "power" ? y * x : y; }
      const points = series.points.slice().sort((a, b) => a.x - b.x), exact = points.find(point => Math.abs(point.x - x) < 1e-10);
      if (exact) return exact.y;
      const index = points.findIndex(point => point.x > x);
      if (index < 1) return null;
      const a = points[index - 1], b = points[index]; return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    };
    for (const curve of curves.values()) {
      const fixedIds = selection.athleteIds.filter(id => selection.dates.every(date => curve.series.some(series => series.athleteId === id && series.date === date)));
      curve.cohortIds = fixedIds;
      const fixedSeries = curve.series.filter(series => selection.dates.length === 1 || fixedIds.includes(series.athleteId));
      const fixedLow = fixedSeries.length ? Math.max(...fixedSeries.map(series => series.supportedMin)) : null;
      const fixedHigh = fixedSeries.length ? Math.min(...fixedSeries.map(series => series.supportedMax)) : null;
      const measuredXs = unique(curve.series.flatMap(series => series.points.map(point => point.x))).sort((a, b) => a - b);
      for (const date of selection.dates) {
        const series = curve.series.filter(series => series.date === date && (selection.dates.length === 1 || fixedIds.includes(series.athleteId)));
        if (!series.length) continue;
        const low = fixedLow, high = fixedHigh;
        const xs = curve.fitted ? high >= low ? Array.from({ length: 41 }, (_, index) => low + (high - low) * index / 40) : [] : measuredXs;
        for (const x of xs) {
          const pointIds = curve.fitted ? fixedIds : selection.athleteIds.filter(id => selection.dates.every(historyDate => {
            const line = curve.series.find(line => line.athleteId === id && line.date === historyDate);
            return line && line.points.some(point => Math.abs(point.x - x) < 1e-10 && N(point.y) !== null);
          }));
          const included = series.filter(line => pointIds.includes(line.athleteId));
          if (!included.length || !curve.fitted && selection.dates.length === 1 && included.length < series.length) continue;
          const values = included.map(line => curve.fitted ? interpolate(line, x) : line.points.find(point => Math.abs(point.x - x) < 1e-10)?.y);
          curve.common.push({ date, x, ...descriptive(values), source: curve.fitted ? "模型共同支持区间" : "共同实测坐标", athleteIds: included.map(line => line.athleteId) });
        }
      }
      yield { stage: "curve-summary", key: curve.key };
    }
    return [...curves.values()];
  }
  function* comparisonSteps(input, selection) {
    const prepared = preparedInputs.get(input);
    const inputs = prepared ? input : input?.entries ? copy(input) : readComparisonInputs(input, selection || input?.selection || {});
    inputs.selection = normalizeSelection(selection || inputs.selection);
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
      metrics.push(buildMetric(item, entries, inputs.selection, indexes));
      if (metrics.length % 8 === 0) yield { stage: "metric-statistics", completed: metrics.length, count: metadata.size };
    }
    const family = metrics.filter(metric => metric.continuous && metric.cohortIds.length > 1).flatMap(metric => metric.changes.map(change => ({ metric, change })));
    const adjusted = holm(family.map(item => item.change.p), family.length);
    family.forEach((item, index) => { item.change.pAdjusted = adjusted[index]; item.change.comparisonCount = family.length; });
    const descriptors = new Map(); for (const entry of entries) for (const project of T.describe(entry.record)) if (!descriptors.has(project.id)) descriptors.set(project.id, project);
    const projects = unique(metrics.map(metric => metric.testId)).map(id => {
      const descriptor = descriptors.get(id);
      return { id, name: descriptor?.name ? T.displayName(descriptor, entries[0]?.record) : id === "derived" ? "训练方向参数" : id,
        renderer: descriptor?.renderer || "scalar", metrics: metrics.filter(metric => metric.testId === id),
        reportView: descriptor?.renderer === "scalar" && entries[0] ? root.RingsideGenericReport?.resolveView(entries.find(entry => entry.record.enabled[id])?.record || entries[0].record, id, inputs.catalog) : undefined };
    });
    const selectionValue = inputs.selection, kind = selectionValue.athleteIds.length === 1 ? selectionValue.dates.length === 1 ? "individual" : "personal-longitudinal" : selectionValue.dates.length === 1 ? "team" : "team-longitudinal";
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
    const fingerprint = hash({ selection: selectionValue, records: fingerprints });
    yield { stage: "summary" }; const summary = buildSummary(entries, selectionValue);
    yield { stage: "capabilities" }; const capabilities = buildCapabilities(entries, selectionValue);
    yield { stage: "axes" }; const axes = aggregateAxes(entries, selectionValue);
    yield { stage: "curves" }; const curves = yield* curveSteps(entries, selectionValue);
    return { version: 1, kind, selection: selectionValue, athletes: inputs.athletes || [], dates: selectionValue.dates, entries, metrics, projects, catalog: inputs.catalog || {},
      ready: inputs.ready !== false, issues: inputs.issues || [], summary, capabilities, axes, curves, fingerprint, inputFingerprint: fingerprint,
      statistics: { version: "paired-t-holm-v1", pairedTest: "双侧配对 t 检验", effectSize: "Cohen’s dz", correction: "Holm", confidenceLevel: .95,
        confidenceInterval: "配对平均变化的单项未校正95% CI", comparisonCount: family.length, estimatedCount: family.filter(item => item.change.p !== null).length,
        cohort: "每指标所有选中日期均有效可比的固定队员集合", quantile: "R type 7", trend: "真实日期普通最小二乘描述性线性趋势" } };
  }
  function deriveComparison(input, selection) { return finishSteps(comparisonSteps(input, selection)); }
  async function deriveComparisonAsync(input, { onProgress, isCurrent = () => true } = {}) {
    const inputs = input?.entries ? copy(input) : readComparisonInputs(input, input?.selection || {});
    inputs.selection = normalizeSelection(inputs.selection); applyExplicitBasis(inputs);
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
    deriveComparisonAsync, descriptive, quantile, studentP, criticalT, paired, holm, trend, extractMetrics: extraction, canonical, hash });
})(typeof window !== "undefined" ? window : globalThis);
