(function (root) {
  "use strict";
  // Samozino et al. 2016, doi:10.1111/sms.12490. All input times are
  // retained; only the explicitly recorded fixed correction is applied.
  const G = 9.81, METHOD_VERSION = "samozino-2016-splits-v1";
  const num = value => root.Calc.num(value);
  const positive = value => { const n = num(value); return n !== null && n > 0 ? n : null; };
  const present = value => value !== "" && value !== null && value !== undefined;
  const defaultsConfig = () => ({ heightCm: "", temperatureC: 20, pressureHpa: 1013.25, windMps: 0,
    device: "", startConvention: "first_propulsive_action", timingStart: "first_propulsive_action",
    inputTimeMode: "cumulative", timeCorrectionS: 0, positionStartM: 0,
    methodVersion: METHOD_VERSION, sampleStepS: .1, rfAfterS: .3, samplingWindow: "terminal_time" });
  const defaultsAnalysis = () => ({ targetDistanceM: "" });
  function normalizeSplits(input) {
    const splits = Array.isArray(input) ? input : [], used = new Set(splits.map(split => split.id).filter(Boolean));
    return splits.map((split, index) => {
      let id = split.id;
      if (!id) {
        id = "sprint_split_" + index;
        while (used.has(id)) id += "_";
        used.add(id);
      }
      return {...split, id, distanceM:split.distanceM ?? "", timeS:split.timeS ?? ""};
    });
  }
  const normalizeTrials = rows => (Array.isArray(rows) ? rows : []).map((row, index) => ({ ...row,
    id: row.id || "row_sprint_fvp_" + index, splits: normalizeSplits(row.splits),
    excluded: row.excluded ?? false, exclusionReason: row.exclusionReason ?? "", notes: row.notes ?? "" }));

  // expm1 keeps short-time displacements accurate without cancellation.
  function distanceAt(time, vmax, tau) { return vmax * (time + tau * Math.expm1(-time / tau)); }
  function timeAtDistance(distance, vmax, tau) {
    if (![distance, vmax, tau].every(value => Number.isFinite(value) && value > 0)) return null;
    let low = 0, high = distance / vmax + tau;
    for (let i = 0; i < 90; i++) {
      const middle = (low + high) / 2;
      if (distanceAt(middle, vmax, tau) < distance) low = middle; else high = middle;
    }
    return (low + high) / 2;
  }
  function goldenMin(fn, low, high) {
    const ratio = (Math.sqrt(5) - 1) / 2;
    let a = high - ratio * (high - low), b = low + ratio * (high - low), fa = fn(a), fb = fn(b);
    for (let i = 0; i < 100 && high - low > 1e-11; i++) {
      if (fa < fb) { high = b; b = a; fb = fa; a = high - ratio * (high - low); fa = fn(a); }
      else { low = a; a = b; fa = fb; b = low + ratio * (high - low); fb = fn(b); }
    }
    return (low + high) / 2;
  }
  function fitSplits(splits) {
    const empty = { valid: false, vmax: null, tau: null, rmseM: null, r2: null, points: [], n: splits.length,
      reason: "至少需要 4 个有效累计分段" };
    if (splits.length < 4) return empty;
    // For each tau, Vmax has a closed-form least-squares solution. Searching
    // log(tau) leaves only one well-scaled numerical degree of freedom.
    const candidate = logTau => {
      const tau = Math.exp(logTau), basis = splits.map(p => p.timeS + tau * Math.expm1(-p.timeS / tau));
      const denominator = basis.reduce((sum, b) => sum + b * b, 0);
      const vmax = basis.reduce((sum, b, i) => sum + b * splits[i].distanceM, 0) / denominator;
      const sse = splits.reduce((sum, p, i) => sum + Math.pow(vmax * basis[i] - p.distanceM, 2), 0);
      return { tau, vmax, sse };
    };
    const low = Math.log(.001), high = Math.log(1000), count = 160;
    const grid = Array.from({ length: count + 1 }, (_, i) => low + (high - low) * i / count);
    let best = 0;
    grid.forEach((x, i) => { if (candidate(x).sse < candidate(grid[best]).sse) best = i; });
    if (best === 0 || best === count) return { ...empty, reason: "分段数据未能确定有限的加速时间常数" };
    const result = candidate(goldenMin(x => candidate(x).sse, grid[best - 1], grid[best + 1]));
    if (![result.tau, result.vmax, result.sse].every(Number.isFinite) || !(result.vmax > 0))
      return { ...empty, reason: "分段拟合超出数值范围" };
    const mean = splits.reduce((sum, p) => sum + p.distanceM / splits.length, 0);
    const total = splits.reduce((sum, p) => sum + Math.pow(p.distanceM - mean, 2), 0);
    return { ...result, valid: true, reason: "", n: splits.length, rmseM: Math.sqrt(result.sse / splits.length),
      r2: total > 0 ? Math.max(0, 1 - result.sse / total) : null,
      points: splits.map(p => ({ ...p, predictedDistanceM: distanceAt(p.timeS, result.vmax, result.tau),
        residualM: distanceAt(p.timeS, result.vmax, result.tau) - p.distanceM })) };
  }
  function airResistance(mass, heightM, temperatureC, pressureHpa) {
    // 760 Torr = 1013.25 hPa. The author's 273 K convention is retained.
    const density = 1.293 * (pressureHpa / 1013.25) * 273 / (273 + temperatureC);
    const frontalArea = .2025 * Math.pow(heightM, .725) * Math.pow(mass, .425) * .266;
    return { density, frontalArea, dragCoefficient: .9, K: .5 * density * frontalArea * .9 };
  }
  function regression(points, xKey, yKey) {
    if (points.length < 2) return null;
    const meanX = points.reduce((sum, p) => sum + p[xKey] / points.length, 0);
    const meanY = points.reduce((sum, p) => sum + p[yKey] / points.length, 0);
    let xx = 0, xy = 0, yy = 0;
    points.forEach(p => { const x = p[xKey] - meanX, y = p[yKey] - meanY; xx += x * x; xy += x * y; yy += y * y; });
    if (!(xx > 0)) return null;
    const slope = xy / xx, intercept = meanY - slope * meanX;
    const sse = points.reduce((sum, p) => sum + Math.pow(p[yKey] - intercept - slope * p[xKey], 2), 0);
    return { slope, intercept, n: points.length, r2: yy > 0 ? Math.max(0, 1 - sse / yy) : null };
  }
  function mechanics(fit, mass, K, windMps, endTimeS, options = {}) {
    const stepS = options.stepS || .1, rfAfterS = options.rfAfterS ?? .3;
    const count = Math.floor((endTimeS + 1e-9) / stepS);
    if (!Number.isFinite(count) || count < 4 || count > 6000 || ![mass, K, windMps, fit.vmax, fit.tau].every(Number.isFinite))
      return { valid: false, samples: [], reason: "加速窗口或环境参数超出模型数值范围" };
    const samples = Array.from({ length: count }, (_, i) => {
      const timeS = (i + 1) * stepS, decay = Math.exp(-timeS / fit.tau);
      const velocity = fit.vmax * (1 - decay), acceleration = fit.vmax / fit.tau * decay;
      const forceAbsolute = mass * acceleration + K * Math.pow(velocity - windMps, 2);
      const force = forceAbsolute / mass, RF = forceAbsolute / Math.hypot(forceAbsolute, mass * G);
      return { timeS, distanceM: distanceAt(timeS, fit.vmax, fit.tau), velocity, acceleration,
        force, forceRelative: force, forceAbsolute, power: force * velocity,
        powerRelative: force * velocity, powerAbsolute: forceAbsolute * velocity, RF };
    });
    const fv = regression(samples, "velocity", "force");
    const rfSamples = samples.filter(p => p.timeS > rfAfterS + 1e-9), rf = regression(rfSamples, "velocity", "RF");
    if (!fv || ![fv.intercept, fv.slope].every(Number.isFinite) || !(fv.intercept > 0) || !(fv.slope < 0) || !rf) return { valid: false, samples,
      reason: "加速窗口无法形成有效的 F–V 与 RF–V 回归" };
    const F0 = fv.intercept, V0 = -F0 / fv.slope, Pmax = F0 * V0 / 4;
    return { valid: true, reason: "", F0, F0Absolute: F0 * mass, V0, Pmax, PmaxAbsolute: Pmax * mass,
      slope: fv.slope, r2: fv.r2, RFmax: Math.max(...rfSamples.map(p => p.RF)), DRF: rf.slope * 100,
      rfIntercept: rf.intercept, rfR2: rf.r2, samples, mass, sampleStepS: stepS, rfAfterS, endTimeS,
      sampleCount: samples.length, rfSampleCount: rfSamples.length,
      units: { F0: "N/kg", F0Absolute: "N", V0: "m/s", Pmax: "W/kg", PmaxAbsolute: "W", slope: "(N/kg)/(m/s)", RFmax: "ratio", DRF: "百分点/(m/s)" } };
  }
  function curve(profile, count = 81) {
    if (!profile?.valid || !(profile.V0 > 0)) return [];
    return Array.from({ length: count }, (_, i) => {
      const velocity = profile.V0 * i / (count - 1), force = profile.F0 + profile.slope * velocity;
      return { velocity, force, forceRelative: force, forceAbsolute: profile.mass ? force * profile.mass : null,
        power: force * velocity, powerRelative: force * velocity, powerAbsolute: profile.mass ? force * velocity * profile.mass : null };
    });
  }
  function performance(Pmax, slope, relativeDrag, distanceM) {
    if (![Pmax, slope, relativeDrag, distanceM].every(Number.isFinite) || !(Pmax > 0 && slope < 0 && relativeDrag >= 0 && distanceM > 0)) return null;
    // Independent sprint optimum: Samozino et al. 2022, equations 11–21,
    // doi:10.1111/sms.14097. No jump push-off distance or jump model is used.
    const F0 = 2 * Math.sqrt(-Pmax * slope), V0 = 2 * Math.sqrt(-Pmax / slope);
    const tau = V0 / (relativeDrag * V0 * V0 + F0), vmax = F0 * tau;
    const timeS = timeAtDistance(distanceM, vmax, tau);
    return timeS === null ? null : { valid: true, F0, V0, Pmax, slope, tau, vmax, timeS, distanceM };
  }
  function optimum(Pmax, distanceM, relativeDrag) {
    if (![Pmax, distanceM, relativeDrag].every(Number.isFinite) || !(Pmax > 0 && distanceM > 0 && relativeDrag >= 0)) return null;
    // Use the paper's slope search interval; a boundary result cannot establish
    // an interior optimum and is never used to label the athlete's deficit.
    const min = .03, max = 1.9, step = .006;
    const slopes = Array.from({ length: Math.ceil((max - min) / step) + 1 }, (_, i) => Math.min(max, min + i * step));
    const time = magnitude => performance(Pmax, -magnitude, relativeDrag, distanceM).timeS;
    let best = 0;
    slopes.forEach((s, i) => { if (time(s) < time(slopes[best])) best = i; });
    if (best === 0 || best === slopes.length - 1) return { valid: false, reason: "最优斜率落在研究搜索边界，未判定发展方向", distanceM };
    const magnitude = goldenMin(time, slopes[best - 1], slopes[best + 1]);
    const result = performance(Pmax, -magnitude, relativeDrag, distanceM);
    const delta = Math.min(.0001, (magnitude - min) / 2, (max - magnitude) / 2);
    if (!result || !Number.isFinite(result.timeS) || time(magnitude - delta) < result.timeS - 1e-9 || time(magnitude + delta) < result.timeS - 1e-9)
      return { valid: false, reason: "最优冲刺 F–V 数值解未收敛", distanceM };
    return { ...result, reason: "", methodVersion: "samozino-2022-optimum-v1", relativeDrag,
      searchSlope: { min: -max, max: -min }, withinStudySimulation: distanceM >= 5 && distanceM <= 30 && Pmax >= 10 && Pmax <= 30 };
  }
  function imbalance(slope, optimalSlope) {
    const ratio = slope / optimalSlope, direction = Math.abs(ratio - 1) < 1e-6 ? "balanced" : ratio < 1 ? "force" : "velocity";
    return { ratio, profilePct: 100 * ratio, magnitudePct: 100 * Math.abs(1 - ratio), signedPct: 100 * (1 - ratio), direction,
      label: direction === "force" ? "发展方向：力量端" : direction === "velocity" ? "发展方向：速度端" : "剖面均衡，发展整体功率" };
  }
  function trialSplits(row, config) {
    const supplied = (Array.isArray(row.splits) ? row.splits : []).filter(p => present(p.distanceM) || present(p.timeS));
    let total = 0, lastDistance = 0, lastTime = 0;
    const splits = [];
    for (const p of supplied) {
      const rawDistance = positive(p.distanceM), rawTime = positive(p.timeS);
      if (rawDistance === null || rawTime === null) return { valid: false, present: true, splits, reason: "分段距离与计时须成对填写正数" };
      const distanceM = rawDistance + num(config.positionStartM);
      total = config.inputTimeMode === "interval" ? total + rawTime : rawTime;
      const timeS = total + num(config.timeCorrectionS);
      if (!(distanceM > lastDistance && timeS > lastTime)) return { valid: false, present: true, splits, reason: "累计距离与修正后的累计时间须严格递增" };
      splits.push({ ...p, rawDistanceM: rawDistance, rawTimeS: rawTime, distanceM, timeS });
      lastDistance = distanceM; lastTime = timeS;
    }
    const reason = splits.length < 4 ? "已验证的分段方法至少需要 4 个累计分段" : splits[0].distanceM > 10 || lastDistance < 30 ? "已验证的分段方法需要早期分段（≤10 m）及至少 30 m 的末段" : "";
    return { valid: !reason, present: supplied.length > 0, splits, reason, endDistanceM: lastDistance, endTimeS: lastTime };
  }
  function solve(record) {
    const config = { ...defaultsConfig(), ...record.sprintFvpConfig }, analysis = { ...defaultsAnalysis(), ...record.sprintFvpAnalysis };
    if (record.sprintFvpConfig?.timingStart === undefined && record.sprintFvpConfig?.startConvention !== undefined)
      config.timingStart = record.sprintFvpConfig.startConvention;
    const mass = positive(record.athlete?.mass), heightCm = present(config.heightCm) ? positive(config.heightCm) : positive(record.athlete?.height);
    const result = { id: "sprint_fvp", label: "分段计时冲刺 F–V/P–V", config, analysis, valid: false, status: "empty", reason: "未录入有效冲刺试次",
      model: null, fit: null, trials: [], selected: null, selectedTrialId: null, points: [], curve: [], samples: [], optimum: null, optimal: null,
      optimumReason: "", imbalance: null, imbalancePct: null, direction: null, targetDistanceM: null, issues: [], methodVersion: METHOD_VERSION };
    const invalidConfig = mass === null ? "需要运动员体重" : heightCm === null ? "需要运动员身高" :
      config.methodVersion !== METHOD_VERSION || num(config.sampleStepS) !== .1 || num(config.rfAfterS) !== .3 || config.samplingWindow !== "terminal_time" ? "此计算方法版本尚不可用；原始分段保留待核对" :
      !["cumulative", "interval"].includes(config.inputTimeMode) ? "计时输入方式无效" :
      num(config.temperatureC) === null || num(config.temperatureC) <= -273 ? "需要有效气温" :
      positive(config.pressureHpa) === null ? "需要正气压（hPa）" :
      num(config.windMps) === null || num(config.timeCorrectionS) === null || num(config.positionStartM) === null ? "风速、时间修正与空间起点须为有限数值" :
      config.timingStart === "gate_crossing" && !(num(config.timeCorrectionS) > 0) ? "门架触发晚于首次推进，请记录已确定的正时间修正" :
      ["start_signal", "signal"].includes(config.timingStart) && !(num(config.timeCorrectionS) < 0) ? "出发信号早于首次推进，请记录扣除反应时间的负修正" :
      !["first_propulsive_action", "gate_crossing", "start_signal", "signal"].includes(config.timingStart) && num(config.timeCorrectionS) === 0 ? "计时起点未明确，请记录已确定的非零时间修正" : "";
    result.trials = normalizeTrials(record.data?.sprint_fvp).map((row, index) => {
      const split = trialSplits(row, config), fit = split.valid && !invalidConfig ? fitSplits(split.splits) : null;
      const reason = row.excluded ? "已排除" : invalidConfig || split.reason || fit?.reason || "";
      return { ...row, index, ...split, inputSplits: row.splits, fit, valid: !invalidConfig && split.valid && fit?.valid === true,
        eligible: !invalidConfig && split.valid && fit?.valid === true && row.excluded !== true, selected: false, reason };
    });
    const eligible = result.trials.filter(t => t.eligible);
    result.status = result.trials.some(t => t.present) ? "review" : "empty";
    result.trials.filter(t => t.present && !t.excluded && !t.valid).forEach(t => result.issues.push({ id: "sprint_fvp_trial_" + t.index,
      testId: "sprint_fvp", status: "amber", message: "第 " + (t.index + 1) + " 次：" + t.reason }));
    if (!eligible.length) { result.reason = invalidConfig || result.trials.find(t => t.present && !t.excluded)?.reason || result.reason; return result; }
    // Different terminal distances are not comparable by raw time. Select the
    // longest measured protocol, then its fastest complete trial; never splice.
    const terminal = Math.max(...eligible.map(t => t.endDistanceM));
    const comparable = eligible.filter(t => Math.abs(t.endDistanceM - terminal) < 1e-8);
    const selected = comparable.reduce((a, b) => b.endTimeS < a.endTimeS ? b : a);
    selected.selected = true;
    const atmosphere = airResistance(mass, heightCm / 100, num(config.temperatureC), num(config.pressureHpa));
    const model = mechanics(selected.fit, mass, atmosphere.K, num(config.windMps), selected.endTimeS);
    Object.assign(result, { valid: model.valid, status: model.valid ? "valid" : "review", reason: model.reason, selected,
      selectedTrialId: selected.id, selectionBasis: "最长完整末段距离内的最快有效试次", fit: selected.fit, model, samples: model.samples,
      points: selected.fit.points, atmosphere, heightCm, mass, curve: curve(model),
      window: { startS: .1, endS: selected.endTimeS, stepS: .1, rfAfterS: .3, basis: "选中试次末段累计时间" } });
    if (!model.valid) return result;
    const target = present(analysis.targetDistanceM) ? positive(analysis.targetDistanceM) : selected.endDistanceM;
    result.targetDistanceM = target;
    if (target === null) { result.optimumReason = "目标距离须为正数"; return result; }
    if (num(config.windMps) !== 0) { result.optimumReason = "最优冲刺 F–V 模型采用无风条件；当前风速下保留实测剖面"; return result; }
    const optimal = optimum(model.Pmax, target, atmosphere.K / mass);
    result.optimum = result.optimal = optimal;
    if (!optimal?.valid) { result.optimumReason = optimal?.reason || "目标距离无法求得最优剖面"; return result; }
    Object.assign(optimal, { mass, F0Absolute: optimal.F0 * mass, PmaxAbsolute: optimal.Pmax * mass });
    const balance = imbalance(model.slope, optimal.slope);
    Object.assign(result, { imbalance: balance, imbalancePct: balance.magnitudePct, direction: balance.direction,
      optimalCurve: curve(optimal), judgments: { direction: balance.label } });
    return result;
  }
  function validate(record, helpers) {
    const { plainObject, safeId, optionalNumber } = helpers, rows = record.data?.sprint_fvp;
    if (rows !== undefined && (!Array.isArray(rows) || rows.length > 1000)) throw Error("冲刺 F–V 试次须为数据行");
    const ids = new Set();
    (rows || []).forEach(row => {
      if (!plainObject(row) || row.id !== undefined && (!safeId(row.id) || ids.has(row.id))) throw Error("冲刺 F–V 试次 ID 无效或重复");
      if (row.id) ids.add(row.id);
      if (!Array.isArray(row.splits) || row.splits.length > 100) throw Error("冲刺分段须为距离与时间数组");
      row.splits.forEach(split => { if (!plainObject(split) || !optionalNumber(split.distanceM) || !optionalNumber(split.timeS)) throw Error("冲刺分段距离与计时须为有限数值或留空"); });
      if (row.excluded !== undefined && typeof row.excluded !== "boolean") throw Error("冲刺排除选项无效");
      ["notes", "exclusionReason"].forEach(key => { if (row[key] !== undefined && typeof row[key] !== "string") throw Error("冲刺 " + key + " 须为文字"); });
    });
    const config = record.sprintFvpConfig, analysis = record.sprintFvpAnalysis;
    [config, analysis].forEach(value => { if (value !== undefined && !plainObject(value)) throw Error("冲刺 F–V 配置格式无效"); });
    if (config) {
      ["heightCm", "temperatureC", "pressureHpa", "windMps", "timeCorrectionS", "positionStartM", "sampleStepS", "rfAfterS"].forEach(key => { if (!optionalNumber(config[key])) throw Error("冲刺 " + key + " 须为有限数值或留空"); });
      ["device", "startConvention", "timingStart", "methodVersion", "samplingWindow"].forEach(key => { if (config[key] !== undefined && typeof config[key] !== "string") throw Error("冲刺 " + key + " 须为文字"); });
      if (config.inputTimeMode !== undefined && !["cumulative", "interval"].includes(config.inputTimeMode)) throw Error("冲刺计时输入方式无效");
    }
    if (analysis && !optionalNumber(analysis.targetDistanceM)) throw Error("冲刺目标距离须为有限数值或留空");
    return true;
  }
  root.RingsideSprintFVP = Object.freeze({ G, METHOD_VERSION, defaultsConfig, defaultsAnalysis, normalizeTrials,
    distanceAt, timeAtDistance, fitSplits, airResistance, mechanics, curve, performance, optimum, imbalance, solve, read: solve, validate });
})(typeof window !== "undefined" ? window : globalThis);
