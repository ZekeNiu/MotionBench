(function (root) {
  "use strict";
  // Approximate pointwise confidence intervals for the CURRENT fitted mean
  // curve, conditional on fixed split times and independent equal-variance
  // distance residuals. This is neither a prediction nor a simultaneous band.
  // Covariance: https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.curve_fit.html
  const VERSION = "sprint-fvp-pointwise-delta-v1", LEVEL = .95;
  const TAU_MIN = .001, TAU_MAX = 1000, CONDITION_LIMIT = 1e10;
  const finite = Number.isFinite, stepScale = Math.cbrt(Number.EPSILON);

  function evaluate(solved, { count = 49 } = {}) {
    const fit = solved?.fit, points = fit?.points;
    const n = Array.isArray(points) ? points.length : 0;
    const metadata = { version: VERSION, level: LEVEL, n, df: n - 2,
      parameterNames: ["vmax", "tau"], currentCurveOnly: true,
      available: false, reason: "", reasonCode: "", covariance: null,
      sse: null, residualVariance: null, tCritical: null,
      scaledConditionNumber: null, velocityRange: null };
    const unavailable = (reasonCode, reason) => {
      Object.assign(metadata, { available: false, reasonCode, reason });
      return { available: false, reason, band: [], metadata };
    };
    const F = root.RingsideSprintFVP;
    if (!F || !root.Calc || !solved?.valid || !fit?.valid || !solved.model?.valid)
      return unavailable("invalid-fit", "需要有效冲刺拟合");
    if (n <= 2 || fit.n !== n)
      return unavailable("insufficient-splits", "原始分段不足以估计拟合区间");
    if (!points.every(p => finite(p.timeS) && p.timeS > 0 && finite(p.distanceM) && p.distanceM > 0)
        || points.some((p, i) => i && (p.timeS <= points[i - 1].timeS || p.distanceM <= points[i - 1].distanceM)))
      return unavailable("invalid-splits", "原始分段须有效且递增");
    const theta = [fit.vmax, fit.tau];
    if (!theta.every(v => finite(v) && v > 0) || fit.tau <= TAU_MIN || fit.tau >= TAU_MAX)
      return unavailable("boundary-fit", "拟合位于参数边界，区间不可用");
    if (!Number.isInteger(count) || count < 2 || count > 401)
      return unavailable("invalid-grid", "绘图网格无效");

    const jacobian = points.map(p => {
      const q = p.timeS / fit.tau, decay = Math.exp(-q);
      return [p.timeS + fit.tau * Math.expm1(-q), fit.vmax * (-1 + (1 + q) * decay)];
    });
    const residuals = points.map(p => p.distanceM - F.distanceAt(p.timeS, fit.vmax, fit.tau));
    const sse = residuals.reduce((sum, r) => sum + r * r, 0);
    if (!finite(sse) || !jacobian.every(row => row.every(finite)))
      return unavailable("nonfinite-fit", "拟合数值无法估计区间");
    metadata.sse = sse;
    metadata.residualVariance = sse / metadata.df;
    // Scale the two columns before checking rank and conditioning. No
    // pseudoinverse or unit-dependent determinant threshold is used.
    const scales = [0, 1].map(i => Math.hypot(...jacobian.map(row => row[i])));
    if (!scales.every(v => finite(v) && v > 0))
      return unavailable("rank-deficient", "分段无法识别两个拟合参数");
    const correlation = jacobian.reduce((sum, row) => sum + row[0] / scales[0] * (row[1] / scales[1]), 0);
    const absolute = Math.abs(correlation), determinant = (1 - absolute) * (1 + absolute);
    metadata.scaledConditionNumber = (1 + absolute) / (1 - absolute);
    if (!(determinant > 0) || !finite(metadata.scaledConditionNumber) || metadata.scaledConditionNumber > CONDITION_LIMIT)
      return unavailable("ill-conditioned", "分段参数识别不稳定，区间不可用");
    const covarianceFactor = metadata.residualVariance / determinant;
    const covariance = [
      [covarianceFactor / scales[0] / scales[0], -covarianceFactor * correlation / scales[0] / scales[1]],
      [-covarianceFactor * correlation / scales[0] / scales[1], covarianceFactor / scales[1] / scales[1]],
    ];
    if (!covariance.every(row => row.every(finite)))
      return unavailable("nonfinite-covariance", "参数协方差无法计算");
    metadata.covariance = covariance;
    metadata.tCritical = root.Calc.t95(metadata.df);
    if (!(finite(metadata.tCritical) && metadata.tCritical > 0))
      return unavailable("invalid-critical-value", "拟合自由度无法计算区间");

    const mass = solved.mass ?? solved.model.mass, K = solved.atmosphere?.K;
    const wind = root.Calc.num(solved.config?.windMps), endTimeS = solved.selected?.endTimeS;
    const mechanicsOptions = { stepS: solved.model.sampleStepS, rfAfterS: solved.model.rfAfterS };
    if (!(finite(mass) && mass > 0 && finite(K) && K >= 0 && finite(wind) && finite(endTimeS) && endTimeS > 0))
      return unavailable("invalid-conditions", "需要完整的拟合测试条件");
    const samples = solved.model.samples || [];
    const velocities = samples.map(p => p.velocity);
    if (velocities.length < 2 || !velocities.every(v => finite(v) && v > 0))
      return unavailable("invalid-range", "模型采样速度范围不可用");
    const min = Math.min(...velocities), max = Math.max(...velocities);
    if (!(max > min)) return unavailable("invalid-range", "模型采样速度范围不可用");
    metadata.velocityRange = { min, max, basis: "mechanics-sample-velocities" };

    const gradients = [];
    const objective = parameters => points.reduce((sum, p) => {
      const r = p.distanceM - F.distanceAt(p.timeS, parameters[0], parameters[1]);
      return sum + r * r;
    }, 0);
    const convergenceTolerance = 64 * Number.EPSILON * Math.max(1, sse, points.reduce((sum, p) => sum + p.distanceM * p.distanceM, 0));
    for (let parameter = 0; parameter < 2; parameter++) {
      const value = theta[parameter];
      let h = Math.min(stepScale * Math.max(1, value), value / 4);
      if (parameter === 1) h = Math.min(h, (value - TAU_MIN) / 4, (TAU_MAX - value) / 4);
      if (!(finite(h) && h > 0 && value + h !== value && value - h !== value))
        return unavailable("invalid-gradient", "拟合梯度无法计算");
      const plus = [...theta], minus = [...theta]; plus[parameter] += h; minus[parameter] -= h;
      const plusSSE = objective(plus), minusSSE = objective(minus);
      if (![plusSSE, minusSSE].every(finite) || Math.min(plusSSE, minusSSE) < sse - convergenceTolerance)
        return unavailable("unconverged-fit", "拟合尚未收敛，区间不可用");
      const upper = F.mechanics({ vmax: plus[0], tau: plus[1] }, mass, K, wind, endTimeS, mechanicsOptions);
      const lower = F.mechanics({ vmax: minus[0], tau: minus[1] }, mass, K, wind, endTimeS, mechanicsOptions);
      if (!upper.valid || !lower.valid)
        return unavailable("invalid-gradient", "拟合梯度无法计算");
      const gradient = [(upper.F0 - lower.F0) / (2 * h), (upper.slope - lower.slope) / (2 * h)];
      if (!gradient.every(finite)) return unavailable("invalid-gradient", "拟合梯度无法计算");
      gradients.push(gradient);
    }
    const band = Array.from({ length: count }, (_, i) => {
      const velocity = min + (max - min) * i / (count - 1);
      const y = solved.model.F0 + solved.model.slope * velocity;
      const gradient = gradients.map(([intercept, slope]) => intercept + slope * velocity);
      const a = gradient[0] / scales[0], b = gradient[1] / scales[1];
      // Algebraically grad' C grad, evaluated as positive squares to avoid
      // cancellation; zero SSE remains exactly zero without fabricated noise.
      const variance = covarianceFactor * ((a - correlation * b) ** 2 + determinant * b * b);
      const standardError = Math.sqrt(variance), half = metadata.tCritical * standardError;
      return { x: velocity, velocity, y, low: y - half, high: y + half,
        powerLow: velocity * (y - half), powerHigh: velocity * (y + half), standardError };
    });
    if (!band.every(p => Object.values(p).every(finite)))
      return unavailable("nonfinite-band", "拟合区间超出数值范围");
    Object.assign(metadata, { available: true, reason: "", reasonCode: "" });
    return { available: true, reason: "", band, metadata };
  }

  root.RingsideSprintFVPConfidence = { version: VERSION, level: LEVEL, evaluate };
})(window);
