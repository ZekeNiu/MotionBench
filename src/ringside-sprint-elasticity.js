(function (root) {
  "use strict";
  // Li et al., bioRxiv 10.64898/2026.08.29.748040 v1. This independent
  // rest-start ODE does not replace the Samozino 2022 optimal-profile model.
  const METHOD_VERSION = "li-2026-sprint-elasticity-forward1-v1", PERTURBATION = .01;
  const defaultsAnalysis = () => ({ deltaForcePct: 0, deltaVelocityPct: 0, elasticityMethodVersion: METHOD_VERSION });
  const num = value => {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const n = Number(value); return Number.isFinite(n) ? n : null;
  };
  const positive = value => { const n = num(value); return n !== null && n > 0 ? n : null; };
  const invalid = reason => ({ valid: false, reason });
  const copy = value => JSON.parse(JSON.stringify(value));
  const cache = new Map();
  function airResistance(massKg, heightCm, temperatureC, pressureHpa) {
    if (!(massKg > 0 && heightCm > 0 && temperatureC > -273 && pressureHpa > 0) ||
        ![massKg, heightCm, temperatureC, pressureHpa].every(Number.isFinite)) return null;
    const density = 1.293 * (pressureHpa / 1013.25) * 273 / (273 + temperatureC);
    const frontalArea = .2025 * Math.pow(heightCm / 100, .725) * Math.pow(massKg, .425) * .266;
    const K = .5 * density * frontalArea * .9, k = K / massKg;
    return [density, frontalArea, K, k].every(Number.isFinite) ? { density, frontalArea, dragCoefficient: .9, K, k } : null;
  }
  function coefficients(F0, V0, k) {
    if (![F0, V0, k].every(Number.isFinite) || !(F0 > 0 && V0 > 0 && k >= 0)) return null;
    const b = F0 / V0, lambda = Math.hypot(b, 2 * Math.sqrt(k) * Math.sqrt(F0));
    const vmax = 2 * (F0 / (lambda + b)), q = k * vmax / lambda;
    return [b, lambda, vmax, q].every(Number.isFinite) && lambda > 0 && vmax > 0 ? { b, lambda, vmax, q } : null;
  }
  // Accurate residuals avoid subtracting the O(t) terms of a short sprint.
  function exponentialResidual(u) {
    return u < .01 ? u * u * (.5 + u * (-1 / 6 + u * (1 / 24 + u * (-1 / 120 + u * (1 / 720 - u / 5040))))) : u + Math.expm1(-u);
  }
  function logarithmicResidual(x) {
    return Math.abs(x) < .01 ? x * x * (-.5 + x * (1 / 3 + x * (-.25 + x * (.2 + x * (-1 / 6 + x / 7))))) : Math.log1p(x) - x;
  }
  function distanceAt(timeS, F0, V0, k) {
    const c = coefficients(F0, V0, k);
    if (!c || !Number.isFinite(timeS) || timeS < 0) return null;
    const u = c.lambda * timeS;
    // d=(vmax/lambda)[u+log(1+q*(exp(-u)-1))/q]. Its q=0
    // limit is the ordinary mono-exponential displacement without resistance.
    const correction = c.q > 0 ? logarithmicResidual(c.q * Math.expm1(-u)) / c.q : 0;
    const distanceM = c.vmax / c.lambda * (exponentialResidual(u) + correction);
    return Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : null;
  }
  function velocityAt(timeS, F0, V0, k) {
    const c = coefficients(F0, V0, k);
    if (!c || !Number.isFinite(timeS) || timeS < 0) return null;
    const w = Math.expm1(-c.lambda * timeS);
    return c.vmax * (-w) * (1 - c.q) / (1 + c.q * w);
  }
  function performance(F0, V0, k, distanceM) {
    const c = coefficients(F0, V0, k), Pmax = F0 * (V0 / 4), slope = -F0 / V0;
    if (!c || !Number.isFinite(distanceM) || distanceM <= 0) return invalid("冲刺模型需要正 F₀、V₀、距离与非负空气阻力");
    if (![Pmax, slope].every(Number.isFinite) || !(Pmax > 0 && slope < 0)) return invalid("冲刺剖面超出模型数值范围");
    let low = 0, high = distanceM / c.vmax + 1 / c.lambda;
    let upper = distanceAt(high, F0, V0, k);
    for (let i = 0; upper !== null && upper < distanceM && i < 60; i++) {
      high *= 2; upper = distanceAt(high, F0, V0, k);
    }
    if (upper === null || upper < distanceM) return invalid("冲刺时间求根超出数值范围");
    for (let i = 0; i < 90; i++) {
      const middle = (low + high) / 2, x = distanceAt(middle, F0, V0, k);
      if (x === null) return invalid("冲刺位移超出数值范围");
      if (x < distanceM) low = middle; else high = middle;
    }
    const timeS = (low + high) / 2, predictedDistanceM = distanceAt(timeS, F0, V0, k);
    const tolerance = 1e-9 * Math.max(distanceM, 1e-9);
    if (!(timeS > 0) || !Number.isFinite(timeS) || Math.abs(predictedDistanceM - distanceM) > tolerance)
      return invalid("冲刺时间求根未收敛");
    return { valid: true, reason: "", F0, V0, Pmax, slope, k, distanceM, timeS,
      velocityMps: velocityAt(timeS, F0, V0, k), vmax: c.vmax, predictedDistanceM, methodVersion: METHOD_VERSION };
  }
  function elasticity(F0, V0, k, distanceM) {
    const current = performance(F0, V0, k, distanceM);
    if (!current.valid) return { ...current, Fe: null, ve: null, EN: null, ER: null };
    let Fe, ve;
    if (k === 0) {
      const tau = F0 * current.timeS / V0, xi = F0 * distanceM / (V0 * V0);
      const A = xi / (tau * -Math.expm1(-tau));
      Fe = 1 - A; ve = 2 * A - 1;
    } else {
      // The author's public calculator uses single-end +1%, rather than a
      // logarithmic/central difference. Each perturbed time is solved anew.
      const tF = performance(F0 * (1 + PERTURBATION), V0, k, distanceM);
      const tV = performance(F0, V0 * (1 + PERTURBATION), k, distanceM);
      if (!tF.valid || !tV.valid) return { ...invalid("1% 扰动后的冲刺时间无法计算"), Fe: null, ve: null, EN: null, ER: null };
      Fe = -(tF.timeS - current.timeS) / current.timeS / PERTURBATION;
      ve = -(tV.timeS - current.timeS) / current.timeS / PERTURBATION;
    }
    const EN = Math.hypot(Fe, ve), ER = ve !== 0 ? Fe / Math.abs(ve) : null;
    if (![Fe, ve, EN].every(Number.isFinite) || Fe < 0 || ve < 0 || ER === null || !Number.isFinite(ER))
      return { ...invalid("此距离的时间敏感性超出数值分辨率"), Fe: null, ve: null, EN: null, ER: null };
    return { ...current, Fe, ve, EN, ER, force: Fe, velocity: ve, outcome: "冲刺时间", conservation: 2 * Fe + ve,
      differenceMethod: k === 0 ? "analytic-no-drag" : "forward-relative-1pct", perturbationPct: k === 0 ? null : 1,
      judgments: { Fe: "力量端时间敏感性", ve: "速度端时间敏感性", EN: "综合时间敏感性",
        ER: Math.abs(ER - 1) < 1e-6 ? "两端时间响应相当" : ER > 1 ? "力量端时间响应更大" : "速度端时间响应更大" } };
  }
  function scenario(profile, k, distanceM, deltaForcePct, deltaVelocityPct) {
    const dF = num(deltaForcePct), dV = num(deltaVelocityPct);
    if (dF === null || dV === null || dF <= -100 || dV <= -100)
      return { ...invalid("情景变化须为有限百分比，且大于 −100%"), deltaForcePct: dF, deltaVelocityPct: dV, timeS: null,
        deltaTimeS: null, deltaPct: null, timeGainS: null, timeGainPct: null, elasticity: null };
    const F0 = profile.F0 * (1 + dF / 100), V0 = profile.V0 * (1 + dV / 100);
    const current = performance(profile.F0, profile.V0, k, distanceM), next = performance(F0, V0, k, distanceM);
    const elastic = next.valid ? elasticity(F0, V0, k, distanceM) : null;
    const valid = current.valid && next.valid && elastic?.valid === true;
    const deltaTimeS = valid ? next.timeS - current.timeS : null;
    const deltaPct = valid ? (next.timeS / current.timeS - 1) * 100 : null;
    return { ...next, valid, timeS: valid ? next.timeS : null, reason: valid ? "" : next.reason || elastic?.reason || current.reason,
      F0, V0, deltaForcePct: dF, deltaVelocityPct: dV, deltaTimeS, deltaPct,
      timeGainS: valid ? -deltaTimeS : null, timeGainPct: valid ? -deltaPct : null, elasticity: valid ? elastic : null };
  }
  function normalize(params) {
    const p = { ...params }, F0 = positive(p.F0), V0 = positive(p.V0), massKg = positive(p.massKg), heightCm = positive(p.heightCm);
    const temperatureC = num(p.temperatureC === undefined ? 20 : p.temperatureC);
    const pressureHpa = positive(p.pressureHpa === undefined ? 1013.25 : p.pressureHpa);
    const windMs = num(p.windMs === undefined ? 0 : p.windMs), targetDistanceM = positive(p.targetDistanceM);
    if (F0 === null || V0 === null) return invalid("需要有效的冲刺 F–V 剖面");
    if (targetDistanceM === null) return invalid("目标距离须为正数");
    const atmosphere = airResistance(massKg, heightCm, temperatureC, pressureHpa);
    if (!atmosphere || massKg === null || heightCm === null || temperatureC === null || pressureHpa === null)
      return invalid("需要有效的体重、身高、气温与气压");
    if (windMs === null) return invalid("风速须为有限数值");
    if (windMs !== 0) return invalid("冲刺弹性模型采用静止起跑与静风条件；当前风速下保留原有实测剖面");
    const k = p.k === undefined ? atmosphere.k : num(p.k);
    if (k === null || k < 0) return invalid("空气阻力系数须为非负有限数值");
    return { valid: true, reason: "", F0, V0, massKg, heightCm, temperatureC, pressureHpa, windMs, targetDistanceM, k, atmosphere,
      deltaForcePct: p.deltaForcePct === undefined ? 0 : p.deltaForcePct,
      deltaVelocityPct: p.deltaVelocityPct === undefined ? 0 : p.deltaVelocityPct };
  }
  function distanceSamples(targetDistanceM, markers = []) {
    const xs = Array.from({ length: 101 }, (_, i) => .5 + 29.5 * i / 100).concat(targetDistanceM, markers);
    const maximum = Math.max(30, targetDistanceM, ...markers);
    if (maximum > 30) {
      // Keep the study interval dense even when a displayed model marker is
      // outside it; logarithmic samples avoid one long straight chart segment.
      const span = Math.log(maximum) - Math.log(30);
      for (let i = 1; i < 40; i++) xs.push(Math.exp(Math.log(30) + span * i / 40));
    }
    return xs;
  }
  function distanceSeries(params, distances) {
    const p = normalize(params);
    if (!p.valid) return [];
    const xs = distances || distanceSamples(p.targetDistanceM);
    return [...new Set(xs.map(num).filter(x => x !== null && x > 0))].sort((a, b) => a - b)
      .map(distanceM => ({ distanceM, ...elasticity(p.F0, p.V0, p.k, distanceM) }));
  }
  function responseSeries(params, changes = [-20, -15, -10, -5, 0, 5, 10, 15, 20]) {
    const p = normalize(params);
    if (!p.valid) return { force: [], velocity: [], both: [] };
    const make = (dF, dV, changePct) => ({ changePct, ...scenario(p, p.k, p.targetDistanceM, dF, dV) });
    return { force: changes.map(x => make(x, 0, x)), velocity: changes.map(x => make(0, x, x)), both: changes.map(x => make(x, x, x)) };
  }
  function goldenMin(fn, low, high) {
    const ratio = (Math.sqrt(5) - 1) / 2;
    let a = high - ratio * (high - low), b = low + ratio * (high - low), fa = fn(a), fb = fn(b);
    // Distance resolution is numerical, not a scientific ER classification cutoff.
    for (let i = 0; i < 80 && high - low > 1e-7 * Math.max(1, high); i++) {
      if (fa < fb) { high = b; b = a; fb = fa; a = high - ratio * (high - low); fa = fn(a); }
      else { low = a; a = b; fa = fb; b = low + ratio * (high - low); fb = fn(b); }
    }
    return (low + high) / 2;
  }
  function characteristicDistances(p) {
    const scale = p.V0 * p.V0 / p.F0;
    if (!(scale > 0) || !Number.isFinite(scale)) return { valley: invalid("特征距离超出数值范围"), balance: invalid("特征距离超出数值范围") };
    if (p.k === 0) {
      const valley = elasticity(p.F0, p.V0, 0, scale * .5222453037474273);
      const balance = elasticity(p.F0, p.V0, 0, scale * 1.2657118326651715);
      return { valley, balance };
    }
    // Scan the dimensionless distance, bracket its lowest EN, then refine.
    // With a finite 1% difference, the EN minimum need not coincide with ER=2.
    const grid = Array.from({ length: 65 }, (_, i) => scale * Math.exp(Math.log(1e-4) + Math.log(1e8) * i / 64));
    const values = grid.map(x => elasticity(p.F0, p.V0, p.k, x));
    const usable = values.map((v, i) => v.valid ? i : -1).filter(i => i >= 0);
    const best = usable.reduce((a, i) => a === null || values[i].EN < values[a].EN ? i : a, null);
    let valley = invalid("未能在有限距离内定位 EN 最低点");
    if (best !== null && best > 0 && best < grid.length - 1 && values[best - 1].valid && values[best + 1].valid) {
      const x = goldenMin(d => { const e = elasticity(p.F0, p.V0, p.k, d); return e.valid ? e.EN : Infinity; }, grid[best - 1], grid[best + 1]);
      valley = elasticity(p.F0, p.V0, p.k, x);
    }
    let balance = invalid("未能在有限距离内定位 ER=1 的平衡距离");
    for (let i = 1; i < grid.length; i++) {
      if (!values[i - 1].valid || !values[i].valid || !(values[i - 1].ER >= 1 && values[i].ER <= 1)) continue;
      let low = grid[i - 1], high = grid[i];
      for (let j = 0; j < 60; j++) {
        const mid = (low + high) / 2, value = elasticity(p.F0, p.V0, p.k, mid);
        if (!value.valid) break;
        if (value.ER > 1) low = mid; else high = mid;
      }
      balance = elasticity(p.F0, p.V0, p.k, (low + high) / 2); break;
    }
    return { valley, balance };
  }
  function compute(params = {}) {
    const p = normalize(params), requestedMethodVersion = params.elasticityMethodVersion === undefined ? METHOD_VERSION : params.elasticityMethodVersion;
    const empty = { ...invalid(p.reason), methodVersion: METHOD_VERSION, requestedMethodVersion,
      targetDistanceM: p.targetDistanceM ?? num(params.targetDistanceM), current: null, elasticity: null,
      scenario: { ...invalid(p.reason), timeS: null, elasticity: null }, sensitivity: { force: [], velocity: [], both: [] },
      constraint: { ...invalid(p.reason), points: [], current: null, valley: null, balance: null, methodVersion: METHOD_VERSION } };
    if (requestedMethodVersion !== METHOD_VERSION) {
      const reason = "此冲刺弹性方法版本尚不可用；原始参数保留待核对";
      return { ...empty, reason, scenario: { ...empty.scenario, reason }, constraint: { ...empty.constraint, reason } };
    }
    if (!p.valid) return empty;
    const key = JSON.stringify([p.F0, p.V0, p.massKg, p.heightCm, p.temperatureC, p.pressureHpa, p.k, p.targetDistanceM, p.deltaForcePct, p.deltaVelocityPct]);
    if (cache.has(key)) return copy(cache.get(key));
    const elastic = elasticity(p.F0, p.V0, p.k, p.targetDistanceM);
    if (!elastic.valid) return { ...empty, reason: elastic.reason, scenario: { ...empty.scenario, reason: elastic.reason } };
    const current = performance(p.F0, p.V0, p.k, p.targetDistanceM);
    const next = scenario(p, p.k, p.targetDistanceM, p.deltaForcePct, p.deltaVelocityPct);
    const characteristics = characteristicDistances(p);
    const markers = [characteristics.valley, characteristics.balance].filter(value => value.valid).map(value => value.distanceM);
    const result = { valid: true, reason: "", methodVersion: METHOD_VERSION, requestedMethodVersion,
      targetDistanceM: p.targetDistanceM, k: p.k, atmosphere: p.atmosphere, current, elasticity: elastic, scenario: next,
      sensitivity: responseSeries(p), constraint: { valid: true, reason: "", points: distanceSeries(p, distanceSamples(p.targetDistanceM, markers)), current: elastic,
        ...characteristics, methodVersion: METHOD_VERSION, referenceRangeM: [0, 30] },
      withinStudyDistance: p.targetDistanceM <= 30, startConvention: "rest", windMs: 0 };
    if (cache.size >= 16) cache.delete(cache.keys().next().value);
    cache.set(key, copy(result)); return result;
  }
  function solve(sprint, analysis = {}) {
    const config = sprint?.config || {}, saved = { ...sprint?.analysis, ...analysis };
    if (!sprint?.valid || !sprint.model?.valid) {
      const reason = sprint?.reason || "需要有效的冲刺 F–V 剖面";
      const result = compute({ ...saved });
      return { ...result, reason, scenario: { ...result.scenario, reason }, constraint: { ...result.constraint, reason } };
    }
    return compute({ F0: sprint.model.F0, V0: sprint.model.V0, massKg: sprint.mass ?? sprint.model.mass,
      heightCm: sprint.heightCm ?? config.heightCm, temperatureC: config.temperatureC,
      pressureHpa: config.pressureHpa, windMs: config.windMps, targetDistanceM: sprint.targetDistanceM,
      ...(sprint.atmosphere?.K !== undefined ? { k: sprint.atmosphere.K / (sprint.mass ?? sprint.model.mass) } : {}),
      deltaForcePct: saved.deltaForcePct === undefined ? 0 : saved.deltaForcePct,
      deltaVelocityPct: saved.deltaVelocityPct === undefined ? 0 : saved.deltaVelocityPct,
      elasticityMethodVersion: saved.elasticityMethodVersion === undefined ? METHOD_VERSION : saved.elasticityMethodVersion });
  }
  root.RingsideSprintElasticity = Object.freeze({ METHOD_VERSION, defaultsAnalysis, airResistance,
    distanceAt, velocityAt, performance, elasticity, scenario, compute, solve, read: solve, distanceSeries, responseSeries });
})(typeof window !== "undefined" ? window : globalThis);
