(function (root) {
  "use strict";
  // All force and power calculations use athlete-mass-normalized quantities.
  // The classic jump model uses mean push-off velocity = 0.5 * take-off velocity.
  const G = 9.81, LAMBDA = 0.5, LI_LAMBDA = 0.77;
  const ids = ["fvp_sj", "fvp_cmj"];
  const num = (value) => root.Calc.num(value);
  const positive = (value) => { const n = num(value); return n !== null && n > 0 ? n : null; };
  const equal = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const defaultsConfig = () => ({ device: "", method: "", posture: "", distanceCm: "", distanceSource: "" });
  const defaultsAnalysis = () => ({ angle: 90, deltaForcePct: 0, deltaVelocityPct: 0 });
  const defaultsView = () => ({ fv: true, pv: true, points: true, optimum: true, comparison: false, confidence: true, range: "full", pinnedLoad: null,
    responseForce: true, responseVelocity: true, responseBoth: true, elasticityView: "response" });

  function regression(points) {
    const n = points.length, result = { valid: false, a: null, b: null, n, r2: null, meanX: null, sxx: null, s: null, tcrit: null, minX: null, maxX: null, reason: "至少需要 3 个不同负荷的有效结果" };
    if (n < 2) return result;
    const meanX = points.reduce((sum, p) => sum + p.velocity / n, 0);
    const meanY = points.reduce((sum, p) => sum + p.forceRelative / n, 0);
    let sxx = 0, sxy = 0, syy = 0;
    points.forEach((p) => { const x = p.velocity - meanX, y = p.forceRelative - meanY; sxx += x * x; sxy += x * y; syy += y * y; });
    Object.assign(result, { meanX, sxx, minX: Math.min(...points.map(p => p.velocity)), maxX: Math.max(...points.map(p => p.velocity)) });
    if (![sxx,sxy,syy,meanX,meanY].every(Number.isFinite)) { result.reason = "数据超出模型数值范围"; return result; }
    if (!(sxx > 0)) { result.reason = "不同负荷的速度相同，无法确定 F–V 斜率"; return result; }
    result.b = sxy / sxx; result.a = meanY - result.b * meanX;
    result.sse = points.reduce((sum, p) => sum + Math.pow(p.forceRelative - result.a - result.b * p.velocity, 2), 0);
    result.r2 = syy > 0 ? Math.max(0, Math.min(1, 1 - result.sse / syy)) : null;
    if (n > 2) { result.s = Math.sqrt(result.sse / (n - 2)); result.tcrit = root.Calc.t95(n - 2); }
    if (n < 3) return result;
    if (!(result.b < 0)) { result.reason = "力未随速度下降，请核对负荷、跳跃高度与推进距离"; return result; }
    if (!(result.a > G)) { result.reason = "F₀ 未超过重力加速度，无法形成有效的无负荷起跳模型"; return result; }
    Object.assign(result, { valid: true, reason: "", F0: result.a, V0: -result.a / result.b, slope: result.b });
    result.Pmax = result.F0 * (result.V0 / 4);
    if (![result.F0,result.V0,result.Pmax,result.slope].every(Number.isFinite)) { result.valid = false; result.reason = "数据超出模型数值范围"; }
    return result;
  }

  function forceAt(profile, velocity) {
    const v = num(velocity), f = num(profile && (profile.F0 ?? profile.a)), slope = num(profile && (profile.slope ?? profile.b));
    return v === null || f === null || slope === null ? null : f + slope * v;
  }
  function powerAt(profile, velocity) { const f = forceAt(profile, velocity), v = num(velocity); return f === null || v === null ? null : f * v; }
  function curve(profile, count = 81) {
    if (!profile || !(profile.V0 > 0)) return [];
    count = Math.max(2, Math.min(401, Math.round(count)));
    return Array.from({ length: count }, (_, i) => {
      const velocity = profile.V0 * i / (count - 1);
      return { velocity, force: forceAt(profile, velocity), power: powerAt(profile, velocity) };
    });
  }

  // The measured profile and all elasticity scenarios predict vertical jumps.
  function performance(F0, V0, distance, lambda = LAMBDA) {
    const q = G;
    if (![F0, V0, distance, lambda].every(v => Number.isFinite(v) && v > 0) || !(F0 > q)) return { valid: false, heightCm: null, takeoffVelocity: null };
    const slope = -F0 / V0, term = distance * slope * lambda;
    // Rationalized form avoids cancellation for steep force-biased profiles.
    const takeoffVelocity = 2 * distance * (F0 - q) / (Math.sqrt(term * term + 2 * distance * (F0 - q)) - term);
    if (!(takeoffVelocity > 0) || !Number.isFinite(takeoffVelocity)) return { valid: false, heightCm: null, takeoffVelocity: null };
    const heightCm = takeoffVelocity * takeoffVelocity / (2 * G) * 100;
    return Number.isFinite(heightCm) ? { valid: true, heightCm, takeoffVelocity } : { valid: false, heightCm: null, takeoffVelocity: null };
  }

  function optimum(Pmax, distance, angle = 90, lambda = LAMBDA) {
    const q = G * Math.sin(angle * Math.PI / 180);
    if (![Pmax, distance, q, lambda].every(v => Number.isFinite(v) && v > 0)) return null;
    // At fixed power the optimum satisfies v^3/(2*lambda^2*d)+q*v=Pmax.
    let low = 0, high = Math.min(Pmax / q, Math.cbrt(2 * lambda * lambda) * Math.cbrt(distance) * Math.cbrt(Pmax));
    for (let i = 0; i < 100; i += 1) {
      const middle = (low + high) / 2;
      if (middle / distance * middle * middle / (2 * lambda * lambda) + q * middle > Pmax) high = middle;
      else low = middle;
    }
    const velocity = (low + high) / 2, F0 = 2 * (Pmax / velocity), V0 = 2 * velocity;
    return { valid: true, angle, F0, V0, Pmax, slope: -Pmax / velocity / velocity,
      ...(angle === 90 ? performance(F0, V0, distance, lambda) : { heightCm: null }) };
  }

  function imbalance(slope, optimalSlope) {
    const ratio = slope / optimalSlope, direction = equal(ratio, 1) ? "balanced" : ratio < 1 ? "force" : "velocity";
    return { ratio, profilePct: ratio * 100, magnitudePct: Math.abs(1 - ratio) * 100, signedPct: (1 - ratio) * 100, direction,
      label: direction === "force" ? "发展方向：力量端" : direction === "velocity" ? "发展方向：速度端" : "剖面均衡，发展整体功率" };
  }

  function responseLabel(value) { return equal(value, 1) ? "等比例响应" : value > 1 ? "超比例响应" : "次比例响应"; }
  function elasticity(F0, V0, distance) {
    const current = performance(F0, V0, distance);
    if (!current.valid) return null;
    const u = current.takeoffVelocity;
    // Convert both velocity terms to Li's lambda=0.77 parameterization.
    const v0 = V0 * LI_LAMBDA / LAMBDA, vd = LI_LAMBDA * u;
    const denominator = u * u * v0 / distance + F0 * vd;
    const Fe = 2 * F0 * (v0 - vd) / denominator, ve = 2 * F0 * vd / denominator;
    if (![Fe, ve].every(v => Number.isFinite(v) && v > 0) || !(F0 > G)) return null;
    const ER = Fe / ve, EN = Math.hypot(Fe, ve);
    return { Fe, ve, ER, EN, force: Fe, velocity: ve, angle: 90,
      outcome: "垂直跳跃高度",
      judgments: { Fe: responseLabel(Fe), ve: responseLabel(ve), ER: equal(ER, 1) ? "两端响应相当" : ER > 1 ? "力量端响应更大" : "速度端响应更大", EN: null } };
  }

  function scenario(profile, distance, deltaForcePct, deltaVelocityPct) {
    const F0 = profile.F0 * (1 + deltaForcePct / 100), V0 = profile.V0 * (1 + deltaVelocityPct / 100);
    const current = performance(profile.F0, profile.V0, distance), next = performance(F0, V0, distance);
    const baseValue = current.heightCm, value = next.heightCm;
    const result = { ...next, angle: 90, F0, V0, Pmax: F0 * V0 / 4, slope: -F0 / V0, deltaForcePct, deltaVelocityPct,
      deltaCm: next.valid ? value - baseValue : null,
      deltaVelocityMps: next.valid ? next.takeoffVelocity - current.takeoffVelocity : null,
      deltaPct: next.valid ? (value / baseValue - 1) * 100 : null, elasticity: next.valid ? elasticity(F0, V0, distance) : null };
    const previous = elasticity(profile.F0, profile.V0, distance);
    if (result.elasticity && previous) result.elasticity.judgments.EN = equal(result.elasticity.EN, previous.EN) ? "情景后弹性范数不变" : result.elasticity.EN > previous.EN ? "情景后弹性范数上升" : "情景后弹性范数下降";
    return result;
  }

  // Li's fixed-height constraint: F0(1 - lambda*u/V0) = g(1 + h/d).
  // Sampling ER changes the force/velocity allocation while retaining h and d.
  function elasticityConstraint(profile, distance, count = 121) {
    const predicted = performance(profile?.F0, profile?.V0, distance), base = elasticity(profile?.F0, profile?.V0, distance);
    const result = { valid: false, methodVersion: "li-2026-jump-constant-height-v1", heightCm: predicted.heightCm, current: null, balance: null, valley: null, points: [] };
    if (!predicted.valid || !base) return result;
    const vd = LAMBDA * predicted.takeoffVelocity, force = G * (1 + predicted.heightCm / 100 / distance);
    const low = Math.min(.1, base.ER / 2), high = Math.max(8, base.ER * 2);
    count = Math.max(3, Math.min(401, Math.round(count)));
    const ratios = Array.from({ length: count }, (_, i) => Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * i / (count - 1)));
    const valleyER = predicted.takeoffVelocity * predicted.takeoffVelocity / distance / force;
    ratios.push(base.ER,1,valleyER);
    const point = ER => {
      const F0 = force * (1 + ER) / ER, V0 = vd * (1 + ER), response = elasticity(F0, V0, distance);
      return response ? { F0, V0, heightCm: predicted.heightCm, Fe: response.Fe, ve: response.ve, ER: response.ER, EN: response.EN } : null;
    };
    result.points = [...new Set(ratios)].sort((a,b) => a-b).map(point).filter(Boolean);
    result.balance = point(1);
    // On this same-height curve EN = 2*Fb*sqrt(ER²+1)/(u²*ER/d + Fb).
    result.valley = point(valleyER);
    result.current = { F0: profile.F0, V0: profile.V0, heightCm: predicted.heightCm, ...base };
    result.valid = result.points.length >= 3;
    return result;
  }

  function confidence(fit, velocity, measuredOnly = true) {
    const x = num(velocity);
    if (x === null || !fit.valid || fit.n < 3 || fit.s === null || fit.tcrit === null || !(fit.sxx > 0)) return null;
    const extrapolated = x < fit.minX || x > fit.maxX;
    if (measuredOnly && extrapolated) return null;
    const y = fit.a + fit.b * x, half = fit.tcrit * fit.s * Math.sqrt(1 / fit.n + Math.pow(x - fit.meanX, 2) / fit.sxx);
    return { x, y, low: y - half, high: y + half, powerLow: x * (y - half), powerHigh: x * (y + half), extrapolated };
  }

  function solve(record, id) {
    const label = id === "fvp_cmj" ? "CMJ F–V/P–V 剖面" : "SJ F–V/P–V 剖面";
    const config = { ...defaultsConfig(), ...record.fvpConfig?.[id] }, analysis = { ...defaultsAnalysis(), ...record.fvpAnalysis?.[id] };
    const angle = analysis.angle === 30 ? 30 : 90, mass = positive(record.athlete?.mass), sharedDistance = positive(config.distanceCm);
    const raw = Array.isArray(record.data?.[id]) ? record.data[id] : [], groups = [], points = [];
    const trials = raw.map((row, index) => {
      const hasTrialDistance = row.distanceCm !== "" && row.distanceCm !== undefined && row.distanceCm !== null;
      const load = num(row.load), height = positive(row.height), distanceCm = hasTrialDistance ? positive(row.distanceCm) : sharedDistance;
      const present = [row.load, row.height, row.distanceCm].some(v => v !== "" && v !== undefined && v !== null);
      const complete = load !== null && load >= 0 && height !== null && distanceCm !== null && mass !== null;
      const derivedForce = complete ? (mass + load) / mass * G * (1 + height / distanceCm) : null;
      const valid = complete && Number.isFinite(derivedForce);
      const reason = row.excluded ? "已排除" : !present ? "未录入" : load === null || load < 0 ? "需要非负附加负荷" : height === null ? "需要正跳跃高度" : distanceCm === null ? "需要正推进距离" : mass === null ? "需要运动员体重" : !valid ? "数据超出模型数值范围" : "";
      return { ...row, id: row.id || "row_" + id + "_" + index, index, load, height, heightCm: height, distanceCm, present, valid, eligible: valid && row.excluded !== true, excluded: row.excluded === true, selected: false, reason };
    });
    const byLoad = new Map();
    trials.filter(t => t.eligible).forEach(trial => { if (!byLoad.has(trial.load)) byLoad.set(trial.load, []); byLoad.get(trial.load).push(trial); });
    [...byLoad.keys()].sort((a,b) => a-b).forEach(load => {
      const rows = byLoad.get(load), best = rows.reduce((a,b) => b.height > a.height ? b : a);
      best.selected = true;
      const stats = root.Calc.descriptive(rows.map(r => r.height), true), distance = best.distanceCm / 100, h = best.height / 100;
      const forceRelative = (mass + load) / mass * G * (1 + h / distance), velocity = LAMBDA * Math.sqrt(2 * G * h), powerRelative = forceRelative * velocity;
      const group = { key: String(load), load, n: rows.length, ...stats, selectedIds: [best.id], selectedHeightCm: best.height, selectedDistanceCm: best.distanceCm, trials: rows };
      groups.push(group);
      points.push({ key: String(load), load, height: best.height, heightCm: best.height, distanceCm: best.distanceCm,
        force: forceRelative, forceRelative, forceAbsolute: forceRelative * mass, velocity, power: powerRelative, powerRelative, powerAbsolute: powerRelative * mass, n: rows.length, selectedIds: [best.id] });
    });
    const fit = regression(points), presentCount = trials.filter(t => t.present).length;
    const result = { id, label, config, analysis: { ...analysis, angle }, valid: fit.valid, status: fit.valid ? "valid" : presentCount ? "review" : "empty", reason: fit.reason,
      points, selectedPoints: points, trials, groups, model: fit, fit, current: null, optimum: null, optimal: null, comparison: null,
      imbalance: null, imbalancePct: null, direction: null, potentialGainPct: null, elasticity: null, scenario: null, elasticityConstraint: null,
      sensitivity: { force: [], velocity: [], both: [] }, ci: (v, measuredOnly) => confidence(fit, v, measuredOnly), issues: [] };
    trials.filter(t => t.present && !t.excluded && !t.valid).forEach(t => result.issues.push({ id: "fvp_trial_" + t.index, testId: id, status: "amber", message: "第 " + (t.index + 1) + " 次：" + t.reason }));
    if (!fit.valid) return result;
    // The selected unloaded trial defines the reference push-off posture.
    // Without an unloaded trial, an explicit shared distance is required.
    const unloaded = points.find(p => p.load === 0), distanceCm = unloaded?.distanceCm ?? sharedDistance;
    if (distanceCm === null) {
      result.valid = false; result.status = "review"; result.reason = "请补充共同推进距离，或录入完整的 0 kg 试次，以计算目标剖面与弹性";
      return result;
    }
    const distance = distanceCm / 100;
    Object.assign(fit, { F0Absolute: fit.F0 * mass, PmaxAbsolute: fit.Pmax * mass, mass, distanceCm, distance,
      lambda: LAMBDA, velocityConvention: "平均推进速度", distanceBasis: unloaded ? "0 kg 代表试次推进距离" : "共同推进距离", protocol: config });
    const current = { angle: 90, F0: fit.F0, V0: fit.V0, Pmax: fit.Pmax, slope: fit.slope, ...performance(fit.F0, fit.V0, distance) };
    const optimal = optimum(fit.Pmax, distance, angle), comparison = optimum(fit.Pmax, distance, angle === 90 ? 30 : 90), balance = imbalance(fit.slope, optimal.slope);
    const deltaForcePct = num(analysis.deltaForcePct) ?? 0, deltaVelocityPct = num(analysis.deltaVelocityPct) ?? 0;
    const elastic = elasticity(fit.F0, fit.V0, distance), next = scenario(fit, distance, deltaForcePct, deltaVelocityPct);
    Object.assign(result, { current, verticalCurrent: current, optimum: optimal, optimal, comparison, imbalance: balance, imbalancePct: balance.magnitudePct, direction: balance.direction,
      potentialGainPct: angle === 90 ? (optimal.heightCm / current.heightCm - 1) * 100 : null, elasticity: elastic, scenario: next, elasticityConstraint: elasticityConstraint(fit, distance),
      judgments: { direction: balance.label } });
    result.sensitivity = {
      force: [-20,-15,-10,-5,0,5,10,15,20].map(changePct => ({ changePct, ...scenario(fit, distance, changePct, 0) })),
      velocity: [-20,-15,-10,-5,0,5,10,15,20].map(changePct => ({ changePct, ...scenario(fit, distance, 0, changePct) })),
      both: [-20,-15,-10,-5,0,5,10,15,20].map(changePct => ({ changePct, ...scenario(fit, distance, changePct, changePct) })),
    };
    return result;
  }
  root.RingsideFVP = Object.freeze({ ids, G, LAMBDA, LI_LAMBDA, defaultsConfig, defaultsAnalysis, defaultsView, solve, read: solve,
    regression, forceAt, powerAt, curve, performance, optimum, imbalance, elasticity, scenario, elasticityConstraint, confidence, equal });
})(typeof window !== "undefined" ? window : globalThis);
