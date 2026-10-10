(function (root) {
  'use strict';

  // Numeric helpers deliberately distinguish a recorded zero from missing data.
  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    var text = value.trim();
    if (!text || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    var result = Number(text);
    return Number.isFinite(result) ? result : null;
  }

  function aggregate(rows, mainKey, mode) {
    mode = mode || 'best';
    var input = Array.isArray(rows) ? rows : [];
    var result = { row: null, n: 0, counts: {}, selectedIndex: null, mode: mode, reason: '' };
    if (mode !== 'best' && mode !== 'mean') {
      result.reason = '汇总模式必须是 best 或 mean';
      return result;
    }
    if (mode === 'best') {
      var best = -Infinity;
      input.forEach(function (row, index) {
        if (!row || typeof row !== 'object') return;
        var value = num(row[mainKey]);
        // Ties retain the first complete attempt; no per-field cherry-picking.
        if (value !== null && value > best) {
          best = value;
          result.selectedIndex = index;
        }
      });
      if (result.selectedIndex === null) {
        result.reason = '没有有效的主指标，无法选择代表尝试';
        return result;
      }
      result.row = Object.assign({}, input[result.selectedIndex]);
      result.n = 1;
      Object.keys(result.row).forEach(function (key) {
        result.counts[key] = num(result.row[key]) === null ? 0 : 1;
      });
      return result;
    }
    var sums = {};
    input.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var hasValue = false;
      Object.keys(row).forEach(function (key) {
        var value = num(row[key]);
        if (value === null) return;
        sums[key] = (sums[key] || 0) + value;
        result.counts[key] = (result.counts[key] || 0) + 1;
        hasValue = true;
      });
      if (hasValue) result.n += 1;
    });
    if (!result.n) {
      result.reason = '没有有效数值';
      return result;
    }
    result.row = {};
    Object.keys(sums).forEach(function (key) {
      result.row[key] = sums[key] / result.counts[key];
    });
    return result;
  }

  // Describes repeated observations, independently of the representative result.
  function descriptive(values, allowCV) {
    var xs = values.map(num).filter(function (x) { return x !== null; });
    var n = xs.length, mean = n ? xs.reduce(function (sum, x) { return sum + x / n; }, 0) : null;
    var sd = n > 1 ? Math.hypot.apply(null, xs.map(function (x) { return (x - mean) / Math.sqrt(n - 1); })) : null;
    if (!Number.isFinite(sd)) sd = null;
    var cv = allowCV && n > 1 && mean > 0 && xs.every(function (x) { return x >= 0; }) && sd !== null ? sd / mean * 100 : null;
    return { n: n, mean: Number.isFinite(mean) ? mean : null, sd: sd, cv: Number.isFinite(cv) ? cv : null };
  }

  // Two-sided 95% Student t critical values, residual df = n - 2.
  var critical95 = [null, 12.7062047364, 4.3026527297, 3.1824463053,
    2.7764451052, 2.5705818356, 2.4469118511, 2.3646242516, 2.3060041352,
    2.2621571629, 2.2281388520, 2.2009851601, 2.1788128297, 2.1603686565,
    2.1447866879, 2.1314495456, 2.1199052992, 2.1098155778, 2.1009220402,
    2.0930240544, 2.0859634473, 2.0796138447, 2.0738730679, 2.0686576104,
    2.0638985616, 2.0595385528, 2.0555294386, 2.0518305165, 2.0484071418,
    2.0452296421, 2.0422724563];

  function t95(df) {
    if (!Number.isFinite(df) || df < 1) return null;
    df = Math.floor(df);
    if (df <= 30) return critical95[df];
    // Cornish-Fisher expansion is accurate beyond the tabulated small-df tail.
    var z = 1.959963984540054;
    var z2 = z * z;
    return z + z * (z2 + 1) / (4 * df)
      + z * (5 * z2 * z2 + 16 * z2 + 3) / (96 * df * df)
      + z * (3 * z2 * z2 * z2 + 19 * z2 * z2 + 17 * z2 - 15) / (384 * df * df * df);
  }

  function linear(points) {
    var usable = (Array.isArray(points) ? points : []).map(function (point) {
      return { load: num(point && point.load), velocity: num(point && point.velocity) };
    }).filter(function (point) { return point.load !== null && point.velocity !== null; });
    var n = usable.length;
    var fit = {
      a: null, b: null, r2: null, n: n, distinctLoads: 0, meanX: null,
      sxx: null, s: null, se: null, seIntercept: null, tcrit: null,
      valid: false, reason: '', v0: null, load0: null,
      extrapolated: true, minX: null, maxX: null, points: usable
    };
    fit.predict = function (load) {
      var x = num(load);
      return x === null || fit.a === null ? null : fit.a + fit.b * x;
    };
    fit.interval = function (load) {
      var x = num(load);
      var y = fit.predict(load);
      if (x === null || y === null || fit.s === null || fit.tcrit === null) return null;
      var leverage = 1 / n + (x - fit.meanX) * (x - fit.meanX) / fit.sxx;
      var half = fit.tcrit * fit.s * Math.sqrt(leverage);
      var predictionHalf = fit.tcrit * fit.s * Math.sqrt(1 + leverage);
      return {
        x: x, y: y, low: y - half, high: y + half,
        predictionLow: y - predictionHalf, predictionHigh: y + predictionHalf,
        extrapolated: x < fit.minX || x > fit.maxX
      };
    };
    fit.estimate = function (mvt) {
      var velocity = num(mvt);
      if (!fit.valid) return { valid: false, load: null, velocity: velocity, reason: fit.reason };
      if (velocity === null || velocity <= 0) {
        return { valid: false, load: null, velocity: velocity, reason: '需要明确指定大于 0 的 MVT' };
      }
      var load = (velocity - fit.a) / fit.b;
      if (!Number.isFinite(load) || load <= 0) {
        return { valid: false, load: null, velocity: velocity, reason: '该 MVT 未得到正负荷估计' };
      }
      return {
        valid: true, load: load, velocity: velocity,
        extrapolated: load < fit.minX || load > fit.maxX,
        reason: '基于指定 MVT 的负荷估计；不是实测 1RM'
      };
    };
    if (n < 2) {
      fit.reason = '至少需要 2 个有效点才能拟合；行动性解读需要 3 个不同负荷';
      return fit;
    }
    fit.distinctLoads = new Set(usable.map(function (point) { return point.load; })).size;
    fit.minX = Math.min.apply(null, usable.map(function (point) { return point.load; }));
    fit.maxX = Math.max.apply(null, usable.map(function (point) { return point.load; }));
    fit.meanX = usable.reduce(function (sum, point) { return sum + point.load; }, 0) / n;
    var meanY = usable.reduce(function (sum, point) { return sum + point.velocity; }, 0) / n;
    var sxy = 0, syy = 0;
    fit.sxx = 0;
    usable.forEach(function (point) {
      var dx = point.load - fit.meanX;
      var dy = point.velocity - meanY;
      fit.sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    });
    if (fit.distinctLoads < 2 || fit.sxx <= 0) {
      fit.reason = '需要至少 2 个不同负荷，重复的同负荷点无法确定斜率';
      return fit;
    }
    fit.b = sxy / fit.sxx;
    fit.a = meanY - fit.b * fit.meanX;
    var sse = usable.reduce(function (sum, point) {
      var residual = point.velocity - fit.a - fit.b * point.load;
      return sum + residual * residual;
    }, 0);
    fit.r2 = syy > 0 ? Math.max(0, Math.min(1, 1 - sse / syy)) : null;
    if (n > 2) {
      fit.s = Math.sqrt(Math.max(0, sse / (n - 2)));
      fit.se = fit.s / Math.sqrt(fit.sxx);
      fit.seIntercept = fit.s * Math.sqrt(1 / n + fit.meanX * fit.meanX / fit.sxx);
      fit.tcrit = t95(n - 2);
    }
    // Intercepts are mathematical extrapolations. Zero-velocity load is not 1RM.
    fit.v0 = fit.a;
    if (fit.b < 0 && fit.a > 0) fit.load0 = -fit.a / fit.b;
    if (fit.distinctLoads < 3) fit.reason = '不同负荷少于 3 个，拟合仅供预览';
    else if (fit.b >= 0) fit.reason = '速度未随负荷下降，请检查数据及测试方法';
    else if (fit.a <= 0) fit.reason = '速度截距不为正，不能作有效负荷外推';
    else { fit.valid = true; fit.reason = ''; }
    return fit;
  }

  // Return the interpolated `key` at a velocity (default independent variable).
  // An optional xKey supports lactate-vs-speed and other profiles explicitly.
  function interpolate(rows, key, value, xKey) {
    xKey = xKey || 'velocity';
    var x = num(value);
    if (x === null) return null;
    var valid = (Array.isArray(rows) ? rows : []).map(function (row) {
      return { x: num(row && row[xKey]), y: num(row && row[key]) };
    }).filter(function (point) { return point.x !== null && point.y !== null; });
    if (!valid.length) return null;
    valid.sort(function (a, b) { return a.x - b.x; });
    // Repeated independent values with conflicting outcomes are ambiguous.
    var exact = valid.filter(function (point) { return point.x === x; });
    if (exact.length) {
      return exact.every(function (point) { return point.y === exact[0].y; }) ? exact[0].y : null;
    }
    if (x < valid[0].x || x > valid[valid.length - 1].x) return null;
    for (var i = 1; i < valid.length; i += 1) {
      var low = valid[i - 1], high = valid[i];
      if (low.x < x && x < high.x) return low.y + (x - low.x) * (high.y - low.y) / (high.x - low.x);
    }
    return null;
  }

  function asym(left, right) {
    var l = num(left), r = num(right);
    if (l === null || r === null) return null;
    var denominator = Math.max(Math.abs(l), Math.abs(r));
    return denominator > 0 ? Math.abs(l - r) / denominator * 100 : null;
  }

  function fms(items) {
    var list = Array.isArray(items) ? items : items && typeof items === 'object' ? Object.values(items) : [];
    var scores = [], painCount = 0;
    for (var i = 0; i < 7; i += 1) {
      var item = list[i], value = null;
      if (item && typeof item === 'object') {
        if (item.pain === true || item.pain === 'true' || item.pain === 1) {
          value = 0; painCount += 1;
        } else {
          var bilateral = typeof item.bilateral === 'boolean' ? item.bilateral
            : num(item.left === undefined ? item.l : item.left) !== null
              || num(item.right === undefined ? item.r : item.right) !== null;
          if (bilateral) {
            var left = num(item.left === undefined ? item.l : item.left);
            var right = num(item.right === undefined ? item.r : item.right);
            if (left !== null && right !== null) value = Math.min(left, right);
          } else value = num(item.score);
        }
      } else value = num(item);
      scores.push(value !== null && Number.isInteger(value) && value >= 0 && value <= 3 ? value : null);
    }
    var completed = scores.filter(function (value) { return value !== null; }).length;
    var partialTotal = scores.reduce(function (sum, value) { return sum + (value === null ? 0 : value); }, 0);
    return {
      total: completed === 7 ? partialTotal : null,
      partialTotal: partialTotal, completed: completed,
      missing: 7 - completed, painCount: painCount, scores: scores, complete: completed === 7
    };
  }

  function score(value, target) {
    var v = num(value), t = num(target);
    return v === null || t === null || t <= 0 ? null : Math.max(0, Math.min(100, 100 * v / t));
  }

  // The literal intervals are authoritative: gaps stay unclassified. At a
  // single shared inclusive endpoint the documented default is the upper band;
  // callers can choose { sharedBoundary: 'lower' } or 'unclassified'.
  function classify(value, ranges, options) {
    var v = num(value);
    var policy = typeof options === 'string' ? options : options && options.sharedBoundary;
    policy = policy || 'upper';
    var unclassified = { status: 'unclassified', label: '未分级', range: null, ambiguous: false, boundaryResolved: false };
    if (v === null || !Array.isArray(ranges)) return unclassified;
    var matches = ranges.filter(function (range) {
      var min = num(range.min), max = num(range.max);
      if ((range.min !== undefined && range.min !== null && min === null)
          || (range.max !== undefined && range.max !== null && max === null)) return false;
      var lower = min === null ? true : range.minInclusive === false ? v > min : v >= min;
      var upper = max === null ? true : range.maxInclusive === false ? v < max : v <= max;
      return lower && upper;
    });
    if (!matches.length) return unclassified;
    var selected = matches[0], resolved = false;
    if (matches.length > 1) {
      var lowerBands = matches.filter(function (range) { return num(range.max) === v; });
      var upperBands = matches.filter(function (range) { return num(range.min) === v; });
      var onlyEndpoint = matches.length === 2 && lowerBands.length === 1 && upperBands.length === 1
        && lowerBands[0] !== upperBands[0];
      if (!onlyEndpoint || (policy !== 'upper' && policy !== 'lower')) {
        unclassified.ambiguous = true;
        return unclassified;
      }
      selected = policy === 'upper' ? upperBands[0] : lowerBands[0];
      resolved = true;
    }
    return {
      status: selected.status || selected.id || 'classified',
      label: selected.label || selected.name || selected.status || '已分级',
      range: selected, ambiguous: false, boundaryResolved: resolved
    };
  }

  root.Calc = { num: num, aggregate: aggregate, descriptive: descriptive, linear: linear, t95: t95,
    interpolate: interpolate, asym: asym, fms: fms, score: score, classify: classify };
})(typeof window !== 'undefined' ? window : globalThis);
