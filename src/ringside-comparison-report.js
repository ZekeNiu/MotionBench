(function (global) {
  "use strict";
  const V = global.RingsideViz, M = global.RingsideModel;
  const C = V.C, FONT = "Segoe UI, Microsoft YaHei, Arial, sans-serif";
  const PALETTE = [C.blue, "#71849f", "#786aa8", "#a37e46", "#497e73", "#a36676", "#577e9e", "#73736c"];
  const DASHES = ["", "7 4", "2 4", "9 3 2 3", "5 3", "1 3"];
  const REGIONS = { neck: "颈部", trunk: "躯干", shoulder_r: "右肩", shoulder_l: "左肩", scapula_r: "右肩胛带", scapula_l: "左肩胛带", elbow_r: "右肘", elbow_l: "左肘", forearm_r: "右前臂", forearm_l: "左前臂", wrist_r: "右腕", wrist_l: "左腕", hip_r: "右髋", hip_l: "左髋", knee_r: "右膝", knee_l: "左膝", ankle_r: "右踝足", ankle_l: "左踝足" };
  const E = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const N = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  const F = (value, digits = 2) => N(value) === null ? "—" : Number(value.toFixed(digits)).toLocaleString("zh-CN", { maximumFractionDigits: digits, useGrouping: false });
  const signed = value => N(value) === null ? "—" : (value > 0 ? "+" : "") + F(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const people = model => new Map((model.athletes || []).map(a => [a.id, a.name || a.profile?.name || "未命名队员"]));
  const nameOf = (model, id) => people(model).get(id) || id || "队员";
  const toneOf = (model, id) => PALETTE[Math.max(0, model.athletes.findIndex(a => a.id === id)) % PALETTE.length];
  const dashOf = (model, date) => DASHES[Math.max(0, model.dates.indexOf(date)) % DASHES.length];
  const basisLabel = (key, value) => M.capabilityDirectionOptions[key]?.find(([id]) => id === value)?.[1] || (key === "endurance" ? "心肺与阈值表现" : value || "");
  const labelOf = (model, series) => nameOf(model, series.athleteId) + (model.dates.length > 1 ? " · " + series.date : "");
  const stamp = date => Date.parse(String(date) + "T00:00:00Z") / 86400000;
  const text = (x, y, value, attrs = "") => `<text x="${F(x)}" y="${F(y)}" font-family="${FONT}"${/\bfont-size\s*=/.test(attrs) ? "" : ' font-size="12"'}${/\bfill\s*=/.test(attrs) ? "" : ` fill="${C.muted}"`} ${attrs}>${E(value)}</text>`;
  const line = (x1, y1, x2, y2, attrs = "") => `<line x1="${F(x1)}" y1="${F(y1)}" x2="${F(x2)}" y2="${F(y2)}"${/\bstroke\s*=/.test(attrs) ? "" : ` stroke="${C.grid}"`} ${attrs}/>`;
  const poly = (points, attrs) => `<polyline points="${points.map(p => p.map(v => F(v)).join(",")).join(" ")}" fill="none" ${attrs}/>`;
  const svg = (w, h, title, markup, description = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${E(title)}"><desc>${E(description || title)}</desc>${markup}</svg>`;
  const point = (x, y, value, series, model, attrs = "", shape = "circle") => {
    const tone = toneOf(model, series.athleteId), tip = labelOf(model, series) + " · " + value;
    const mark = shape === "diamond" ? `<polygon points="${F(x)},${F(y - 5)} ${F(x + 5)},${F(y)} ${F(x)},${F(y + 5)} ${F(x - 5)},${F(y)}" fill="${tone}"/>` : `<circle cx="${F(x)}" cy="${F(y)}" r="4" fill="${tone}" stroke="white" stroke-width="1"/>`;
    return `<g class="viz-point comparison-series" data-athlete-id="${E(series.athleteId)}" data-date="${E(series.date)}" data-tooltip="${E(tip)}" tabindex="0" ${attrs}>${mark}<title>${E(tip)}</title></g>`;
  };
  function range(values, zero = false) {
    values = values.filter(v => N(v) !== null);
    if (!values.length) return { min: 0, max: 1 };
    let min = Math.min(...values), max = Math.max(...values), span = max - min || Math.abs(max) * .15 || 1;
    min = zero && min >= 0 ? 0 : min - span * .12; max = zero && max <= 0 ? 0 : max + span * .12;
    if (max === min) max = min + 1;
    return { min, max };
  }
  function tickFormat(value, step) {
    const digits = Math.min(12, Math.max(0, -Math.floor(Math.log10(Math.abs(step) || 1)) + 1));
    if (Math.abs(value) < Math.abs(step) * 1e-8) return "0";
    const rounded = Number(value.toFixed(digits));
    if (rounded === 0 && value !== 0) return value.toExponential(2);
    return F(rounded, digits);
  }
  function frame(w, h, xr, yr, { xLabel = "", yLabel = "", dates = [], categories = [], horizontal = false } = {}) {
    const left = horizontal ? Math.min(180, w * .25) : 65, right = w - 25, top = 34, bottom = h - 60;
    const x = value => left + (value - xr.min) / (xr.max - xr.min) * (right - left), y = value => bottom - (value - yr.min) / (yr.max - yr.min) * (bottom - top);
    let out = "";
    for (let i = 0; i <= 4; i++) {
      const v = yr.min + (yr.max - yr.min) * i / 4;
      if (!horizontal) out += line(left, y(v), right, y(v)) + text(left - 10, y(v) + 4, tickFormat(v, (yr.max - yr.min) / 4), 'class="comparison-y-tick" text-anchor="end" font-size="11"');
      const xv = xr.min + (xr.max - xr.min) * i / 4;
      if (!dates.length && !categories.length || horizontal) out += line(x(xv), top, x(xv), bottom) + text(x(xv), bottom + 22, tickFormat(xv, (xr.max - xr.min) / 4), 'class="comparison-x-tick" text-anchor="middle" font-size="11"');
    }
    out += line(left, top, left, bottom, `stroke="${C.muted}"`) + line(left, bottom, right, bottom, `stroke="${C.muted}"`);
    dates.forEach((date, index) => { const px = x(stamp(date)); out += text(px, bottom + 22 + index % 2 * 14, date, 'text-anchor="middle" font-size="10"'); });
    categories.forEach((item, i) => { if (horizontal) out += text(left - 9, y(i) + 4, item, 'text-anchor="end" font-size="11"'); else out += text(x(i), bottom + 22, item, 'text-anchor="middle" font-size="10"'); });
    out += text(left, 18, yLabel, `fill="${C.ink}" font-size="12"`) + text(right, h - 7, xLabel, 'text-anchor="end" font-size="12"');
    return { out, x, y, left, right, top, bottom };
  }
  function errorBar(x, mean, sd, grid, tone, horizontal = false, tip = "") {
    if (N(mean) === null) return "";
    const lo = mean - (N(sd) === null ? 0 : sd), hi = mean + (N(sd) === null ? 0 : sd);
    const marker = horizontal ? `<circle cx="${F(grid.x(mean))}" cy="${F(x)}" r="5" fill="${tone}"/>` : `<circle cx="${F(x)}" cy="${F(grid.y(mean))}" r="5" fill="${tone}"/>`;
    const bars = N(sd) === null ? "" : horizontal ? line(grid.x(lo), x, grid.x(hi), x, `stroke="${tone}" stroke-width="2.5"`) + line(grid.x(lo), x - 5, grid.x(lo), x + 5, `stroke="${tone}" stroke-width="2"`) + line(grid.x(hi), x - 5, grid.x(hi), x + 5, `stroke="${tone}" stroke-width="2"`) : line(x, grid.y(lo), x, grid.y(hi), `stroke="${tone}" stroke-width="2.5"`) + line(x - 5, grid.y(lo), x + 5, grid.y(lo), `stroke="${tone}" stroke-width="2"`) + line(x - 5, grid.y(hi), x + 5, grid.y(hi), `stroke="${tone}" stroke-width="2"`);
    return `<g class="comparison-mean" data-tooltip="${E(tip)}"><title>${E(tip)}</title>${bars}${marker}</g>`;
  }
  function legend(model, series, { mean = true } = {}) {
    const members = [...new Set(series.map(s => s.athleteId))];
    const number = id => model.athletes.length > 12 ? String(model.athletes.findIndex(a => a.id === id) + 1).padStart(2, "0") + " · " : "";
    return `<div class="comparison-legend no-print" aria-label="图例">${members.map(id => `<button type="button" class="comparison-legend-person" data-comparison-highlight="${E(id)}" aria-pressed="false"><i style="background:${toneOf(model, id)}"></i>${E(number(id) + nameOf(model, id))}</button>`).join("")}</div><div class="comparison-print-legend">${members.map(id => `<span><i style="background:${toneOf(model, id)}"></i>${E(number(id) + nameOf(model, id))}</span>`).join("")}</div><div class="comparison-chart-key">${model.dates.length > 1 ? model.dates.map((date, i) => `<span><i class="comparison-line-key comparison-line-pattern-${i % DASHES.length}" style="--comparison-line-color:${mean ? dateMean(model, date) : C.muted}" aria-hidden="true"></i>${E(date)}</span>`).join("") : ""}${mean ? "<span><b>●</b> 均值 ± 样本 SD</span>" : ""}</div>`;
  }
  const dateMean = (model, date) => PALETTE[Math.max(0, model.dates.indexOf(date)) % PALETTE.length];
  function curveChart(model, curve, layout = {}) {
    const w = layout.width || 700, h = layout.height || 330, series = (curve.series || []).filter(s => s.points?.length), common = curve.common || [];
    if (!series.length) return `<p class="empty">${E(curve.reason || "暂无有效曲线")}</p>`;
    const all = series.flatMap(s => [...s.points, ...(s.rawPoints || [])]).filter(p => N(p.x) !== null && N(p.y) !== null);
    const xr = range(all.map(p => p.x)), yr = range([...all.map(p => p.y), ...common.flatMap(p => [p.mean - (p.sd || 0), p.mean + (p.sd || 0)])]);
    const grid = frame(w, h, xr, yr, { xLabel: curve.xLabel || curve.xUnit || "", yLabel: curve.yLabel || curve.unit || "" });
    let out = grid.out;
    model.dates.forEach(date => {
      const means = common.filter(p => p.date === date && N(p.mean) !== null).sort((a, b) => a.x - b.x), tone = dateMean(model, date);
      if (!curve.noConnect && means.length > 1 && means.every(p => N(p.sd) !== null)) out += `<polygon class="comparison-sd-band" data-date="${E(date)}" points="${means.map(p => [grid.x(p.x), grid.y(p.mean + p.sd)]).concat(means.slice().reverse().map(p => [grid.x(p.x), grid.y(p.mean - p.sd)])).map(p => p.map(v => F(v)).join(",")).join(" ")}" fill="${tone}" fill-opacity=".12"/>`;
    });
    series.forEach(s => {
      const points = s.points.filter(p => N(p.x) !== null && N(p.y) !== null).slice().sort((a, b) => a.x - b.x), dash = dashOf(model, s.date), tone = toneOf(model, s.athleteId);
      if (!curve.noConnect) out += `<g class="comparison-series" data-athlete-id="${E(s.athleteId)}" data-date="${E(s.date)}">${poly(points.map(p => [grid.x(p.x), grid.y(p.y)]), `stroke="${tone}" stroke-opacity=".65" stroke-width="1.6"${dash ? ` stroke-dasharray="${dash}"` : ""}`)}</g>`;
      const measured = curve.fitted && curve.testId === "sprint_fvp" ? [] : Array.isArray(s.rawPoints) ? s.rawPoints : s.points;
      measured.forEach(p => { if (N(p.x) !== null && N(p.y) !== null) out += point(grid.x(p.x), grid.y(p.y), `${F(p.x)} ${curve.xUnit || ""} · ${F(p.y)} ${curve.unit || ""}${p.derived ? " · 推算" : s.rawPoints?.length ? " · 实测" : ""}`, s, model, `data-comparison-x="${p.x}"`, p.derived ? "diamond" : "circle"); });
    });
    model.dates.forEach(date => {
      const means = common.filter(p => p.date === date && N(p.mean) !== null).sort((a, b) => a.x - b.x), tone = dateMean(model, date), dash = dashOf(model, date);
      if (means.length > 1 && !curve.noConnect) out += poly(means.map(p => [grid.x(p.x), grid.y(p.mean)]), `class="comparison-mean-line" stroke="${tone}" stroke-width="3.2"${dash ? ` stroke-dasharray="${dash}"` : ""}`);
      if (!curve.fitted) means.forEach(p => { out += errorBar(grid.x(p.x), p.mean, p.sd, grid, tone, false, `${date} · ${F(p.x)} ${curve.xUnit || ""} · 均值 ${F(p.mean)} ± ${F(p.sd)} ${curve.unit || ""} · n=${p.n}`); if (N(p.xSd) !== null) out += errorBar(grid.y(p.mean), p.x, p.xSd, grid, tone, true, `${date} · X 均值 ${F(p.x)} ± ${F(p.xSd)} ${curve.xUnit || ""} · n=${p.n}`); });
    });
    const protocol = typeof curve.protocol === "string" ? curve.protocol : model.entries.find(e => e.record?.enabled?.[curve.testId])?.record.protocol?.[curve.testId] || "";
    return svg(w, h, curve.title, out, curve.description || "个人曲线与各日期均值；阴影及误差棒为队员间样本标准差。") + legend(model, series, { mean: common.length > 0 }) + `<p class="comparison-chart-caption">${E(protocol)}${common.length ? " · 阴影与误差棒：队员间样本 SD" : ""}${curve.fitted ? " · 均值仅显示共同适用区间" : ""}</p>`;
  }
  function metricChart(model, metric, kind = "column", layout = {}) {
    const horizontal = kind === "bar" || kind === "target", valid = metric.observations.filter(o => N(o.value) !== null), count = Math.max(1, model.athletes.length), crowded = !horizontal && count > 12, w = Math.max(layout.width || 700, crowded ? count * 52 + 90 : 0);
    const h = horizontal ? Math.max(280, Math.min(750, count * 27 + 105)) : layout.height || 330;
    if (!valid.length) return `<p class="empty">${E(metric.label)}：${E(metric.reason || "缺少有效结果")}</p>`;
    const values = valid.map(o => o.value).concat(metric.periods.flatMap(p => N(p.mean) === null ? [] : [p.mean - (p.sd || 0), p.mean + (p.sd || 0)]));
    const vr = range(values, kind === "column" || kind === "bar" || kind === "target"), cr = { min: -.6, max: count - .4 };
    const labels = model.athletes.map((a, i) => crowded ? String(i + 1).padStart(2, "0") : a.name), grid = frame(w, h, horizontal ? vr : cr, horizontal ? cr : vr, { categories: labels, horizontal, xLabel: horizontal ? metric.unit : crowded ? "队员编号 · 对应下方图例" : "队员", yLabel: horizontal ? metric.label : metric.label + (metric.unit ? " · " + metric.unit : "") });
    let out = grid.out;
    valid.forEach(o => {
      const index = model.athletes.findIndex(a => a.id === o.athleteId), dateIndex = model.dates.indexOf(o.date), offset = (dateIndex - (model.dates.length - 1) / 2) * .52 / Math.max(1, model.dates.length), cat = index + offset, tone = toneOf(model, o.athleteId), label = labelOf(model, o) + ` · ${metric.label}：${F(o.value)} ${metric.unit}`;
      if (kind === "column" || kind === "bar" || kind === "target") {
        const barWidth = Math.min(18, (grid.right - grid.left) / count * .48 / Math.max(1, model.dates.length)), px = horizontal ? grid.x(Math.min(0, o.value)) : grid.x(cat) - barWidth / 2, py = horizontal ? grid.y(cat) - 4 : grid.y(Math.max(0, o.value)), rw = horizontal ? Math.abs(grid.x(o.value) - grid.x(0)) : barWidth, rh = horizontal ? 8 : Math.abs(grid.y(o.value) - grid.y(0));
        out += `<rect class="comparison-series" data-athlete-id="${E(o.athleteId)}" data-date="${E(o.date)}" x="${F(px)}" y="${F(py)}" width="${F(rw)}" height="${F(rh)}" fill="${tone}" opacity="${F(.4 + .6 * (dateIndex + 1) / model.dates.length)}"><title>${E(label)}</title></rect>`;
      }
      out += point(horizontal ? grid.x(o.value) : grid.x(cat), horizontal ? grid.y(cat) : grid.y(o.value), `${metric.label}：${F(o.value)} ${metric.unit}`, o, model);
      if (kind === "target") {
        const entry = model.entries.find(e => e.recordId === o.recordId), evaluation = entry?.stats?.evaluationResults?.find(e => e.metricId === metric.id), target = evaluation?.targetApplicable ? N(evaluation.target) : null;
        if (target !== null) out += line(grid.x(target), grid.y(cat) - 9, grid.x(target), grid.y(cat) + 9, `stroke="${tone}" stroke-width="2" stroke-dasharray="3 2"`);
      }
    });
    metric.periods.forEach((p, i) => {
      if (N(p.mean) === null) return;
      const tone = dateMean(model, p.date), tip = `${p.date} · 均值 ${F(p.mean)} ± ${F(p.sd)} ${metric.unit} · n=${p.n}`;
      if (horizontal) { out += line(grid.x(p.mean), grid.top, grid.x(p.mean), grid.bottom, `stroke="${tone}" stroke-width="2" stroke-dasharray="${dashOf(model, p.date) || "6 4"}"`) + errorBar(grid.top + 13 + i * 17, p.mean, p.sd, grid, tone, true, tip); }
      else { out += line(grid.left, grid.y(p.mean), grid.right, grid.y(p.mean), `stroke="${tone}" stroke-width="2" stroke-dasharray="${dashOf(model, p.date) || "6 4"}"`) + errorBar(grid.right - 10 - i * 13, p.mean, p.sd, grid, tone, false, tip); }
    });
    const figure = svg(w, h, metric.label, out, "每名队员使用本记录代表成绩；均值与样本 SD 由实际有效队员计算。");
    return (crowded ? `<p class="comparison-chart-scroll-hint no-print">左右滑动查看全部队员 · 编号对应下方图例</p><div class="comparison-chart-viewport">${figure.replace('<svg ', `<svg style="min-width:${w}px" `)}</div>` : figure) + legend(model, valid);
  }
  function trendChart(model, metric, layout = {}) {
    const w = layout.width || 700, h = layout.height || 330, periods = metric.periods, cohort = new Set(metric.cohortIds || []), observations = metric.observations.filter(o => cohort.has(o.athleteId) && N(o.value) !== null);
    const days = model.dates.map(stamp), xr = range(days), yr = range(observations.map(o => o.value).concat(periods.flatMap(p => N(p.mean) === null ? [] : [p.mean - (p.sd || 0), p.mean + (p.sd || 0)])));
    const grid = frame(w, h, xr, yr, { dates: model.dates, xLabel: "测试日期", yLabel: metric.label + (metric.unit ? " · " + metric.unit : "") });
    let out = grid.out;
    model.athletes.forEach(a => {
      const samples = observations.filter(o => o.athleteId === a.id).sort((a, b) => stamp(a.date) - stamp(b.date));
      if (samples.length > 1) out += poly(samples.map(o => [grid.x(stamp(o.date)), grid.y(o.value)]), `class="comparison-series" data-athlete-id="${E(a.id)}" stroke="${toneOf(model, a.id)}" stroke-width="1.5" stroke-opacity=".55"`);
      samples.forEach(o => { out += point(grid.x(stamp(o.date)), grid.y(o.value), `${metric.label}：${F(o.value)} ${metric.unit}`, o, model); });
    });
    const means = periods.filter(p => N(p.mean) !== null);
    if (means.length > 1) out += poly(means.map(p => [grid.x(stamp(p.date)), grid.y(p.mean)]), `class="comparison-mean-line" stroke="${C.blue}" stroke-width="3"`);
    means.forEach(p => { out += errorBar(grid.x(stamp(p.date)), p.mean, p.sd, grid, C.blue, false, `${p.date} · 均值 ${F(p.mean)} ± ${F(p.sd)} · n=${p.n}`); });
    const trend = metric.trend;
    if (model.dates.length >= 3 && N(trend?.slopePer30Days) !== null && N(trend?.intercept) !== null) {
      const origin = stamp(model.dates[0]), first = trend.intercept, last = first + trend.slopePer30Days / 30 * (stamp(model.dates.at(-1)) - origin);
      out += line(grid.x(origin), grid.y(first), grid.x(stamp(model.dates.at(-1))), grid.y(last), `class="comparison-trend-fit" stroke="${C.ink}" stroke-width="2" stroke-dasharray="7 5"`);
    }
    const tail = trend && N(trend.slopePer30Days) !== null ? `描述性线性趋势：${signed(trend.slopePer30Days)} ${metric.unit || "单位"}／30天${N(trend.r2) !== null ? " · R² " + F(trend.r2, 3) : ""}` : model.dates.length === 2 ? "实线连接两期实测结果" : "";
    return svg(w, h, metric.label + "趋势", out, "横轴为真实测试日期；全部日期采用同一组有效队员。") + legend(model, observations) + `<p class="comparison-chart-caption">固定队员 n=${cohort.size}${tail ? " · " + E(tail) : ""}</p>`;
  }
  function radarChart(model, axes, series, { title = "能力评分", maximum = 100, unit = "分", width = 560 } = {}) {
    if (!axes.length) return '<p class="empty">暂无可比较的能力评分</p>';
    if (axes.length < 3) return series.map(s => `<div class="comparison-axis-list">${axes.map((a, i) => `<span>${E(a.label)} · ${E(labelOf(model, s))}：${F(s.values[i])} ${E(unit)}</span>`).join("")}</div>`).join("");
    const w = width, h = 410, cx = w / 2, cy = 190, r = Math.min(125, w * .23), polar = (i, v) => [cx + Math.cos(-Math.PI / 2 + i * Math.PI * 2 / axes.length) * r * v / maximum, cy + Math.sin(-Math.PI / 2 + i * Math.PI * 2 / axes.length) * r * v / maximum];
    let out = "";
    [maximum / 4, maximum / 2, maximum * .75, maximum].forEach(v => { out += `<polygon points="${axes.map((a, i) => polar(i, v).map(x => F(x)).join(",")).join(" ")}" fill="none" stroke="${C.grid}"/>` + text(cx + 5, cy - r * v / maximum + 4, F(v, 0), 'font-size="10"'); });
    axes.forEach((a, i) => { const p = polar(i, maximum * 1.19); out += line(cx, cy, ...polar(i, maximum)) + text(p[0], p[1], a.label, `text-anchor="middle" fill="${C.ink}" font-size="16"`); });
    series.forEach(s => {
      const tone = s.mean ? dateMean(model, s.date) : toneOf(model, s.athleteId), values = s.values;
      out += `<g class="${s.mean ? "comparison-mean-line" : "comparison-series"}"${s.athleteId ? ` data-athlete-id="${E(s.athleteId)}"` : ""} data-date="${E(s.date)}">`;
      values.forEach((v, i) => { const next = (i + 1) % values.length; if (N(v) !== null && N(values[next]) !== null) out += line(...polar(i, Math.max(0, v)), ...polar(next, Math.max(0, values[next])), `stroke="${tone}" stroke-width="${s.mean ? 3 : 1.3}" stroke-opacity="${s.mean ? 1 : .45}"${dashOf(model, s.date) ? ` stroke-dasharray="${dashOf(model, s.date)}"` : ""}`); });
      values.forEach((v, i) => {
        if (N(v) === null) return;
        const p = polar(i, Math.max(0, v)), tip = `${axes[i].label} · ${s.mean ? s.date + " 均值" : labelOf(model, s)}：${F(v)} ${unit}${s.mean ? " ± " + F(s.sds?.[i]) + " · n=" + (s.ns?.[i] || 0) : ""}`;
        out += `<g data-tooltip="${E(tip)}"><title>${E(tip)}</title><circle cx="${F(p[0])}" cy="${F(p[1])}" r="${s.mean ? 4 : 2.8}" fill="${tone}"/></g>`;
        if (s.mean && N(s.sds?.[i]) !== null) out += line(...polar(i, Math.max(0, v - s.sds[i])), ...polar(i, v + s.sds[i]), `stroke="${tone}" stroke-width="2"`);
      });
      out += "</g>";
    });
    const last = series.filter(s => s.mean).at(-1);
    const counts = last ? `<div class="comparison-axis-counts">${axes.map((a, i) => `<span>${E(a.label)} <b>n=${last.ns[i]}</b> · ${F(last.values[i])} ± ${F(last.sds[i])}</span>`).join("")}</div>` : "";
    return svg(w, h, title, out, "个人系列、各日期均值与轴向样本标准差；缺测轴保持空白。") + counts + legend(model, series.filter(s => !s.mean));
  }
  function axisSeries(model, axes) {
    const series = [];
    model.dates.forEach(date => {
      model.athletes.forEach(a => { const values = axes.map(axis => axis.periods?.find(p => p.date === date)?.observations?.find(o => o.athleteId === a.id)?.value ?? null); if (values.some(v => N(v) !== null)) series.push({ athleteId: a.id, date, values }); });
      series.push({ mean: true, date, values: axes.map(a => a.periods?.find(p => p.date === date)?.mean ?? null), sds: axes.map(a => a.periods?.find(p => p.date === date)?.sd ?? null), ns: axes.map(a => a.periods?.find(p => p.date === date)?.n || 0) });
    });
    return series;
  }
  function radar(model) {
    const axes = model.axes || [];
    if (axes.length <= 8) return radarChart(model, axes, axisSeries(model, axes));
    return Array.from({ length: Math.ceil(axes.length / 7) }, (_, i) => { const group = axes.slice(i * 7, (i + 1) * 7); return `<div class="comparison-radar-facet" data-pdf-atomic>${radarChart(model, group, axisSeries(model, group))}</div>`; }).join("");
  }
  function summary(model) {
    const s = model.summary?.latest || {}, card = (label, value, note, status = "gray") => `<article class="micro-card"><div class="micro-head"><h3>${E(label)}</h3></div><div class="micro-value ${status}">${value}<small> 人</small></div><p>${E(note)}</p></article>`;
    const transitions = model.summary?.transitions || [], counts = state => transitions.filter(t => t.state === state && t.toDate === model.dates.at(-1) && !t.key?.startsWith("advantage:")).length;
    return card("所选队员", s.selectedCount ?? model.athletes.length, `${s.resultCount || 0} 人有结果 · ${model.dates.at(-1) || ""}`) + card("预警", s.redCount || 0, model.dates.length > 1 ? `末次相对基线：新增 ${counts("new")} 项 · 解除 ${counts("resolved")} 项 · 持续 ${counts("persistent")} 项` : "末次测试有预警的队员", s.redCount ? "red" : "gray") + card("关注", s.amberCount || 0, "每位队员计一次", s.amberCount ? "amber" : "gray") + card("优势", s.advantageCount || 0, "具有已评价优势的队员", s.advantageCount ? "green" : "gray");
  }
  function body(model, { bodyImage = global.RingsideBodyImage, views = {} } = {}) {
    if (model.athletes.length > 1) return screeningChart(model, views);
    const periods = model.summary?.periods || [];
    return `${periods.length > 1 ? `<p class="comparison-body-date-hint no-print">共 ${periods.length} 个测试日期 · 左右滑动查看</p>` : ""}<div class="comparison-body-facets">${periods.map(period => {
      const regions = Object.fromEntries((Array.isArray(period.regions) ? period.regions : Object.values(period.regions || {})).map(region => {
        const tests = (region.members || []).flatMap(member => (member.tests || []).map(t => ({ ...t, name: nameOf(model, member.athleteId) + " · " + (t.name || t.title || "测试") })));
        const status = region.redCount ? "red" : region.amberCount ? "amber" : region.greenCount ? "green" : "neutral";
        const label = REGIONS[region.key] || region.name || region.label || region.key;
        return [region.key, { name: label, status, hasMeasured: region.n > 0, tests, label: `${region.redCount || 0} 预警 / ${region.amberCount || 0} 关注 · ${region.n || 0} 人有效`, detail: `${label}：${region.redCount || 0} 人预警，${region.amberCount || 0} 人关注；${region.n || 0} 人有可判断结果` }];
      }));
      return `<figure data-pdf-atomic><figcaption>${E(period.date)}</figcaption>${V.body(regions, bodyImage)}</figure>`;
    }).join("")}</div>`;
  }
  function screeningChart(model, views = {}) {
    const periods = model.summary?.periods || [], lookup = period => Array.isArray(period?.regions) ? period.regions : Object.values(period?.regions || {}), date = model.dates.includes(views.screeningDate) ? views.screeningDate : model.dates.at(-1), period = periods.find(p => p.date === date), regions = lookup(period);
    const keys = [...new Set(periods.flatMap(p => lookup(p).map(region => region.key)))], score = { green: 3, amber: 2, red: 1 }, labels = { green: "达标", amber: "关注", red: "预警", gray: "未知" };
    if (!keys.length) return '<p class="empty comparison-screening-chart">暂无可判断的筛查结果</p>';
    const w = 640, h = 540, cx = 320, cy = 255, radius = 160, polar = (index, value) => { const angle = -Math.PI / 2 + index * 2 * Math.PI / keys.length; return [cx + Math.cos(angle) * radius * value / 3, cy + Math.sin(angle) * radius * value / 3]; };
    const memberAt = (athleteId, key) => regions.find(region => region.key === key)?.members?.find(member => member.athleteId === athleteId), valuesOf = id => keys.map(key => score[memberAt(id, key)?.status] ?? null);
    let out = [3, 2, 1].map(value => `<polygon class="comparison-screening-grade-ring" data-grade="${value}" points="${keys.map((_, i) => polar(i, value).map(v => F(v)).join(",")).join(" ")}" fill="${C[{ 3: "green", 2: "amber", 1: "red" }[value]]}" fill-opacity=".055" stroke="${C.grid}"/>`).join("");
    [1, 2, 3].forEach(value => { out += text(cx + 8, cy - radius * value / 3 - 5, `${value} · ${labels[{ 1: "red", 2: "amber", 3: "green" }[value]]}`, `font-size="13" fill="${C[{ 1: "red", 2: "amber", 3: "green" }[value]]}"`); });
    keys.forEach((key, index) => {
      const point = polar(index, 3), labelPoint = polar(index, 3.75), label = REGIONS[key] || regions.find(r => r.key === key)?.label || key, cos = (labelPoint[0] - cx) / radius, anchor = cos > .2 ? "start" : cos < -.2 ? "end" : "middle", region = regions.find(r => r.key === key), n = (region?.redCount || 0) + (region?.amberCount || 0) + (region?.greenCount || 0), parts = label.length > 6 ? [label.slice(0, 6), label.slice(6)] : [label];
      out += line(cx, cy, point[0], point[1]);
      const details = { name: label + " · " + date, status: "gray", hasMeasured: !!region?.n, tests: model.athletes.map(athlete => { const member = memberAt(athlete.id, key); return { name: nameOf(model, athlete.id), value: score[member?.status] ?? null, unit: "级", status: member?.status || "gray", missing: !member, label: labels[member?.status] || (member ? "已测未判定" : "未测"), notes: (member?.tests || []).map(t => t.name || t.title).filter(Boolean).join("、") }; }) };
      let axis = parts.map((part, lineIndex) => text(labelPoint[0], labelPoint[1] + lineIndex * 18, part, `class="comparison-screening-axis-label" text-anchor="${anchor}" font-size="18" fill="${C.ink}"`)).join("");
      axis += text(labelPoint[0], labelPoint[1] + parts.length * 18, "n=" + n, `text-anchor="${anchor}" font-size="12"`);
      out += `<g class="comparison-screening-axis" data-region="${E(key)}" data-body-detail="${E(JSON.stringify(details))}" data-overview-detail="${E(JSON.stringify(details))}" data-tooltip="${E(label + ' · ' + date + ' · 可判定 ' + n + ' 人')}" tabindex="0" role="button">${axis}</g>`;
    });
    model.athletes.forEach(athlete => {
      const values = valuesOf(athlete.id), color = toneOf(model, athlete.id);
      let series = values.every(value => value !== null) ? `<polygon points="${values.map((value, index) => polar(index, value).map(v => F(v)).join(",")).join(" ")}" fill="${color}" fill-opacity="${model.athletes.length <= 8 ? .025 : 0}" stroke="none"/>` : "";
      values.forEach((value, index) => { const next = (index + 1) % keys.length; if (value !== null && values[next] !== null) { const a = polar(index, value), b = polar(next, values[next]); series += line(a[0], a[1], b[0], b[1], `class="comparison-screening-segment" data-screening-from="${E(keys[index])}" data-screening-to="${E(keys[next])}" stroke="${color}" stroke-width="1.5" stroke-opacity=".6"`); } });
      keys.forEach((key, index) => {
        const label = REGIONS[key] || regions.find(r => r.key === key)?.label || key, member = memberAt(athlete.id, key), entry = model.entries.find(e => e.athleteId === athlete.id && e.date === date), status = member?.status || "gray", grade = score[status] ?? null, recordId = member?.recordId || entry?.recordId || "", region = regions.find(r => r.key === key), measured = region?.n || 0, assessed = (region?.redCount || 0) + (region?.amberCount || 0) + (region?.greenCount || 0);
        const stateLabel = grade === null ? member ? "已测未判定" : "未测" : labels[status], tests = [{ name: "筛查状态", value: grade, unit: "级", status, missing: !member, label: stateLabel }, ...(member?.tests || []).map(test => ({ ...test, name: nameOf(model, athlete.id) + " · " + (test.name || test.title || "测试") }))], detail = { name: nameOf(model, athlete.id) + " · " + label + " · " + date, status, hasMeasured: !!member, label: stateLabel, tests };
        const tooltip = `${nameOf(model, athlete.id)} · ${date} · ${label}：${grade === null ? stateLabel : grade + '级 · ' + stateLabel}`;
        const coords = grade === null ? null : polar(index, grade), marks = coords ? `<circle class="comparison-screening-point viz-hotspot" cx="${F(coords[0])}" cy="${F(coords[1])}" r="4" fill="${C[status]}" stroke="white" stroke-width="1.2"/>` : "";
        series += `<g class="viz-region comparison-screening-row${grade === null ? " comparison-screening-unknown" : ""}" data-athlete-id="${E(athlete.id)}" data-record-id="${E(recordId)}" data-region="${E(key)}" data-date="${E(date)}" data-status="${E(status)}" data-value="${grade ?? ""}" data-valid-n="${assessed}" data-measured-n="${measured}" data-assessed-n="${assessed}" data-unknown-count="${model.athletes.length - assessed}" data-body-detail="${E(JSON.stringify(detail))}" data-tooltip="${E(tooltip)}" role="button" tabindex="0" aria-label="${E(tooltip)}">${marks}<title>${E(tooltip)}</title></g>`;
      });
      out += `<g class="comparison-series comparison-screening-series" data-athlete-id="${E(athlete.id)}" data-date="${E(date)}">${series}</g>`;
    });
    const unknown = id => valuesOf(id).every(value => value === null), personLabel = athlete => (model.athletes.length > 12 ? String(model.athletes.indexOf(athlete) + 1).padStart(2, "0") + " · " : "") + nameOf(model, athlete.id) + (unknown(athlete.id) ? "（未知）" : "");
    const legend = `<div class="comparison-legend no-print">${model.athletes.map(athlete => `<button class="comparison-legend-person" type="button" data-comparison-highlight="${E(athlete.id)}" aria-pressed="false"><i style="background:${toneOf(model, athlete.id)}"></i>${E(personLabel(athlete))}</button>`).join("")}</div><div class="comparison-print-legend">${model.athletes.map(athlete => `<span><i style="background:${toneOf(model, athlete.id)}"></i>${E(personLabel(athlete))}</span>`).join("")}</div>`;
    const dates = model.dates.length > 1 ? `<div class="comparison-segment comparison-screening-date-picker no-print" aria-label="筛查测试日期">${model.dates.map(d => `<button type="button" data-comparison-screening-date="${E(d)}" aria-pressed="${d === date}">${E(d)}</button>`).join("")}</div>` : "";
    const chart = svg(w, h, "团队队员身体部位筛查雷达", out, "每名队员保留独立系列。原评价状态达标、关注、预警分别展示为 3、2、1；未知无点且相邻线段断开，不替换为零。").replace("<svg ", `<svg data-center-x="${cx}" data-center-y="${cy}" data-max-radius="${radius}" data-max-value="3" `);
    return `<div class="comparison-screening-chart" data-screening-date="${E(date)}" data-pdf-atomic>${dates}<p class="comparison-screening-active-date">${E(date)} · ${model.athletes.length} 名队员</p><div class="comparison-screening-viewport">${chart}</div>${legend}<p class="comparison-screening-caption">显示等级：绿色 3 达标 · 黄色 2 关注 · 红色 1 预警。未判定留空；n 为该日期可判定人数。点击队员图例突出个人，点击图点或部位名称查看判定依据。</p></div>`;
  }
  function screenItems(model, { views = {} } = {}) {
    const date = model.dates.includes(views.screeningDate) ? views.screeningDate : model.dates.at(-1), latest = model.summary?.periods?.find(p => p.date === date) || model.summary?.latest, regions = Array.isArray(latest?.regions) ? latest.regions : Object.values(latest?.regions || {});
    const sorted = regions.filter(r => r.n > 0).sort((a, b) => b.redCount - a.redCount || b.amberCount - a.amberCount), item = r => `<details class="screen-item comparison-region-members" data-region="${E(r.key)}" data-date="${E(date)}"><summary><strong>${E(REGIONS[r.key] || r.name || r.label || r.key)}</strong><span>${r.redCount || 0} 预警 · ${r.amberCount || 0} 关注 · ${r.n} 人实测</span></summary>${(r.members || []).map(member => `<p data-athlete-id="${E(member.athleteId)}" data-record-id="${E(member.recordId)}"><button class="comparison-person-link" data-comparison-highlight="${E(member.athleteId)}">${E(nameOf(model, member.athleteId))}</button> · ${E({ red: "预警", amber: "关注", green: "达标", gray: "已测未评" }[member.status] || "已测")}${member.tests?.length ? " · " + E(member.tests.map(t => t.name || t.title).filter(Boolean).join("、")) : ""}</p>`).join("")}</details>`;
    return sorted.slice(0, 4).map(item).join("") + (sorted.length > 4 ? `<details class="comparison-more-regions"><summary>查看其余 ${sorted.length - 4} 个部位</summary>${sorted.slice(4).map(item).join("")}</details>` : "") || '<div class="screen-item"><h4>暂无可判断的筛查结果</h4></div>';
  }
  function overview(model) {
    return (model.capabilities || []).map(c => { const p = c.periods?.at(-1); return `<div class="aux-metric"><span class="aux-label">${E(c.title)}</span><strong class="aux-judgment">${E((p?.groups || []).map(g => g.judgment + " " + g.count + "人").join("；") || "暂无结果")}</strong><span class="aux-data">${E(basisLabel(c.id, c.basis))}</span></div>`; }).join("");
  }
  function preferences(model, views = {}) {
    const next = copy(views); next.projects ||= {}; next.capabilityExpanded ||= {};
    next.screeningDate = model.dates.includes(next.screeningDate) ? next.screeningDate : model.dates.at(-1);
    for (const project of model.projects || []) {
      const saved = next.projects[project.id] || {}, keys = new Set(project.metrics.map(m => m.key));
      const native = model.entries.find(e => e.record?.enabled?.[project.id]);
      const configured = project.renderer === "scalar" && native ? global.RingsideGenericReport?.resolveView(native.record, project.id, model.catalog)?.metricIds : null;
      const defaults = configured?.length ? project.metrics.filter(m => configured.includes(m.id)).map(m => m.key) : project.renderer === "fms" ? project.metrics.filter(m => /^fms_\d$/.test(m.id)).map(m => m.key) : project.metrics.slice(0, project.renderer === "iso" ? 6 : 3).map(m => m.key);
      const curves = (model.curves || []).filter(c => c.testId === project.id), curveKeys = new Set(curves.map(c => c.key)), curveDefaults = curves.filter(c => ["fv", "pv"].includes(c.kind) || project.renderer === "imtp" && c.kind === (native?.record.views.imtp?.yAxis === "force" ? "force" : "force_pct_peak") || project.renderer === "lvp" || project.renderer === "lactate").map(c => c.key);
      next.projects[project.id] = { ...saved, metricKeys: Array.isArray(saved.metricKeys) ? saved.metricKeys.filter(key => keys.has(key)) : defaults, curveKeys: Array.isArray(saved.curveKeys) ? saved.curveKeys.filter(key => curveKeys.has(key)) : curveDefaults, chartMode: saved.chartMode === "trend" && model.dates.length > 1 ? "trend" : "original", tableMode: saved.tableMode === "individual" ? "individual" : "summary", expanded: saved.expanded === true, pickerOpen: saved.pickerOpen === true };
    }
    return next;
  }
  function table(headers, rows, attrs = "", className = "comparison-statistics-table") {
    return `<div class="table-wrap"><table class="${className}"><thead><tr>${headers.map(h => `<th scope="col">${E(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr${row.attrs || ""}>${(row.cells || row).map((cell, i) => `<td data-label="${E(headers[i])}">${cell ?? "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const meanSD = p => `${F(p.mean)}${N(p.sd) !== null ? " ± " + F(p.sd) : ""}`;
  const changeLabel = (metric, change) => change ? `${signed(change.delta)} ${E(metric.unit)}${N(change.percentChange) !== null ? `<small>${signed(change.percentChange)}%</small>` : /^(%|%PF)$/.test(metric.unit) && N(change.delta) !== null ? "<small>百分点变化</small>" : ""}${change.improvement && change.improvement !== "unknown" ? `<small>${E({ improved: "改善", declined: "下降", unchanged: "持平", changed: "变化" }[change.improvement] || "")}</small>` : ""}` : "—";
  function projectTable(model, project, prefs) {
    const longitudinal = model.dates.length > 1, team = model.athletes.length > 1;
    if (prefs.tableMode === "individual") {
      const rows = project.metrics.flatMap(metric => metric.observations.map(o => {
        const baseline = metric.observations.find(x => x.athleteId === o.athleteId && x.date === model.dates[0]), delta = longitudinal && o.date !== model.dates[0] && N(o.value) !== null && N(baseline?.value) !== null ? o.value - baseline.value : null;
        return { attrs: ` class="comparison-person-row" data-athlete-id="${E(o.athleteId)}" data-comparison-highlight="${E(o.athleteId)}" tabindex="0" role="button" aria-label="突出${E(nameOf(model, o.athleteId))}的图中数据"`, cells: [E(metric.label) + `<small>${E(metric.unit)}</small>`, E(nameOf(model, o.athleteId)), E(o.date), F(o.value), ...(longitudinal ? [signed(delta)] : []), E(o.reason || ""), o.recordId ? `<button class="btn small comparison-edit-record no-print" data-comparison-edit-record="${E(o.recordId)}">编辑记录</button>` : "—"] };
      }));
      return table(["指标", "队员", "测试日期", "代表结果", ...(longitudinal ? ["相对基线变化"] : []), "说明", "记录"], rows);
    }
    const rows = project.metrics.flatMap(metric => metric.periods.map(p => {
      const change = metric.changes?.find(c => c.date === p.date), infer = team && longitudinal && metric.continuous !== false;
      const distribution = metric.continuous === false && p.observations?.length ? p.observations.reduce((map, o) => { if (N(o.value) !== null) map.set(o.value, (map.get(o.value) || 0) + 1); return map; }, new Map()) : null;
      return { attrs: ` data-metric-key="${E(metric.key)}" data-date="${E(p.date)}"`, cells: [E(metric.label) + `<small>${E(metric.unit)}</small>`, E(p.date), p.n, distribution ? [...distribution].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${F(v)}分：${n}人`).join(" · ") : meanSD(p), ...(longitudinal ? [changeLabel(metric, change)] : []), ...(team && longitudinal ? [infer && N(change?.ciLow) !== null ? `[${F(change.ciLow)}, ${F(change.ciHigh)}]` : "—", infer ? F(change?.dz, 3) : "—", infer && N(change?.pAdjusted) !== null ? `<span${change.pAdjusted < .05 ? ' class="comparison-significant"' : ""}>${change.pAdjusted < .001 ? "<0.001" : F(change.pAdjusted, 4)}</span>` : "—"] : [])] };
    }));
    const output = table(["指标", "测试日期", "n", "均值 ± SD／分布", ...(longitudinal ? ["相对基线变化"] : []), ...(team && longitudinal ? ["变化95% CI", "Cohen’s dz", "Holm p"] : [])], rows);
    const expanded = project.metrics.flatMap(metric => metric.periods.map(p => { const change = metric.changes?.find(c => c.date === p.date); return [E(metric.label), E(p.date), F(p.median), `[${F(p.q1)}, ${F(p.q3)}]`, `${F(p.min)}–${F(p.max)}`, N(p.cv) !== null ? F(p.cv, 1) + "%" : "—", ...(longitudinal && team ? [F(change?.t, 3), N(change?.df) === null ? "—" : change.df, N(change?.p) !== null ? F(change.p, 5) : "—", E(change?.reason || "")] : [])]; }));
    return output + `<details class="comparison-distribution" data-comparison-expanded="${E(project.id)}"${prefs.expanded ? " open" : ""}><summary>查看完整分布${longitudinal && team ? "与检验详情" : ""}</summary>${table(["指标", "测试日期", "中位数", "Q1–Q3", "范围", "CV", ...(longitudinal && team ? ["t", "df", "原始 p", "说明"] : [])], expanded, "", "comparison-distribution-table")}</details>`;
  }
  function genericPanels(model, project, keys) {
    const nativeEntries = model.entries.filter(e => e.record?.enabled?.[project.id]), panels = [];
    for (const entry of nativeEntries) {
      const defs = keys.map(key => project.metrics.find(m => m.key === key)?.id).filter(Boolean), report = { record: entry.record, stats: entry.stats }, view = project.reportView || global.RingsideGenericReport?.resolveView(entry.record, project.id, model.catalog);
      if (!view || ["none", "bar", "column", "target"].includes(view.kind)) continue;
      const filtered = view.kind === "scatter" && defs.length >= 2 ? global.RingsideGenericReport.createView(entry.record, project.id, { kind: "scatter", xMetricId: defs[0], yMetricId: defs[1] }) : view.kind === "scatter" ? view : { ...view, metricIds: view.metricIds.filter(id => defs.includes(id)) };
      if (!filtered.metricIds.length) continue;
      const chart = global.RingsideGenericReport.buildChart(report, { ...project, reportView: filtered });
      chart.panels.forEach((panel, index) => panels.push({ entry, chart, panel, index }));
      if (!chart.available && chart.reason) panels.push({ entry, chart, panel: null });
    }
    return panels;
  }
  function originalGeneric(model, project, metrics) {
    const data = genericPanels(model, project, metrics.map(m => m.key)), grouped = new Map(), output = [];
    for (const item of data) {
      if (!item.panel) { output.push(`<p class="note">${E(labelOf(model, item.entry))}：${E(item.chart.reason)}</p>`); continue; }
      const p = item.panel, kind = item.chart.kind;
      if (kind === "radar") {
        const scoreRules = p.axes.map(a => { const score = M.metricScore(item.entry.record, a.id, item.entry.stats), metric = item.entry.extracted?.find(m => m.id === a.id); return { id: a.id, transform: score.transform, target: item.entry.record.definitions.find(d => d.id === a.id)?.target, measurement: metric?.identity }; });
        const key = "radar:" + JSON.stringify(scoreRules), group = grouped.get(key) || { kind, axes: p.axes, series: [] };
        group.series.push({ athleteId: item.entry.athleteId, date: item.entry.date, values: p.axes.map(a => a.value) }); grouped.set(key, group);
      } else {
        const groups = kind === "trials" ? p.series.map(s => ({ key: s.id + "|" + p.unit, title: s.label, unit: p.unit, xUnit: "次", xLabel: "真实试次编号", points: s.points.map(point => ({ x: point.index, y: point.value })) })) : [{ key: p.xAxis.id + "|" + p.yAxis.id, title: p.title, unit: p.yAxis.unit, xUnit: p.xAxis.unit, xLabel: p.xAxis.label + " · " + p.xAxis.unit, yLabel: p.yAxis.label + " · " + p.yAxis.unit, points: p.points.map(point => ({ x: point.x, y: point.y, trial: point.index })) }];
        groups.forEach(g => { const key = kind + ":" + g.key, group = grouped.get(key) || { ...g, kind, series: [], common: [] }; group.series.push({ athleteId: item.entry.athleteId, date: item.entry.date, recordId: item.entry.recordId, points: g.points }); grouped.set(key, group); });
      }
    }
    for (const group of grouped.values()) {
      if (group.kind === "radar") {
        model.dates.forEach(date => {
          const summaries = group.axes.map((a, i) => { const fixed = model.athletes.filter(person => model.dates.every(d => group.series.some(s => s.athleteId === person.id && s.date === d && N(s.values[i]) !== null))).map(person => person.id); return global.Calc.descriptive(group.series.filter(s => s.date === date && (model.dates.length === 1 || fixed.includes(s.athleteId))).map(s => s.values[i]), false); });
          group.series.push({ mean: true, date, values: summaries.map(s => s.mean), sds: summaries.map(s => s.sd), ns: summaries.map(s => s.n) });
        });
        output.push(`<div class="comparison-chart-panel" data-pdf-atomic><h5>评分雷达</h5>${radarChart(model, group.axes, group.series)}</div>`);
      } else {
        const indices = [...new Set(group.series.flatMap(s => s.points.map(p => group.kind === "trials" ? p.x : p.trial)))];
        indices.forEach(index => {
          const pointAt = series => series.points.find(p => (group.kind === "trials" ? p.x : p.trial) === index), fixed = model.athletes.filter(person => model.dates.every(date => group.series.some(s => s.athleteId === person.id && s.date === date && pointAt(s)))).map(person => person.id);
          model.dates.forEach(date => {
            const series = group.series.filter(s => s.date === date && (model.dates.length === 1 || fixed.includes(s.athleteId))), points = series.map(pointAt).filter(Boolean), xs = global.Calc.descriptive(points.map(p => p.x), false), ys = global.Calc.descriptive(points.map(p => p.y), false);
            if (ys.n) group.common.push({ date, x: xs.mean, mean: ys.mean, sd: ys.sd, xSd: group.kind === "scatter" ? xs.sd : null, n: ys.n });
          });
        });
        output.push(`<div class="comparison-chart-panel" data-pdf-atomic><h5>${E(group.title)}</h5>${curveChart(model, { ...group, noConnect: true, description: group.kind === "scatter" ? "仅采用同一次试次的真实 X–Y 配对；每个试次编号分别计算队员间均值及两轴样本标准差。" : "每条系列保留真实试次编号；每个试次编号分别计算队员间均值及样本标准差，试次数不增加团队样本数。" })}</div>`);
      }
    }
    return output.join("");
  }
  function fmsDetails(model, project) {
    if (project.renderer !== "fms") return "";
    const rows = model.entries.filter(e => e.record?.enabled?.fms).flatMap(entry => (entry.record.data.fms || []).map((item, i) => [E(nameOf(model, entry.athleteId)), E(entry.date), E(item.name || global.RingsideTests.fmsAbilities[i]), F(global.Calc.num(item.bilateral ? item.left : item.score), 0), F(global.Calc.num(item.bilateral ? item.right : null), 0), E(item.pain || item.painLeft || item.painRight || item.painCenter || entry.stats.raw.fms?.scores?.[i] === 0 ? "疼痛／清除阳性" : ""), E(item.notes || "")]));
    return `<details class="comparison-raw-details"><summary>FMS 原分、左右侧与疼痛记录</summary>${table(["队员", "日期", "动作", "左／单项", "右", "疼痛", "备注"], rows)}</details>`;
  }
  function isoCharts(model, project) {
    if (project.renderer !== "iso") return "";
    const records = model.entries.filter(e => e.record?.enabled?.iso).map(e => ({ entry: e, radar: M.isoRadar(e.stats.isoAnalyses, e.record) })), axes = [...new Map(records.flatMap(r => r.radar.axes.map(a => [a.key || a.id || a.label, a]))).values()];
    if (!axes.length) return "";
    return ["strength", "symmetry"].map(key => {
      const series = records.map(({ entry, radar }) => ({ athleteId: entry.athleteId, date: entry.date, values: axes.map(a => radar.axes.find(r => (r.key || r.id || r.label) === (a.key || a.id || a.label))?.[key] ?? null) }));
      const compatible = axes.map(axis => {
        const definitions = records.map(({ entry, radar }) => {
          const match = radar.axes.find(a => a.id === axis.id), ids = (match?.[key + "Sources"] || []).map(source => source.id).sort();
          return JSON.stringify(ids.map(id => { const row = entry.stats.isoAnalyses.find(r => r.id === id), original = entry.record.data.iso.find(r => r.id === id); return { id, context: global.RingsideEvaluation.isoContext(original, entry.record), targets: key === "strength" ? row.sides.map(s => [s.side, s.target]) : [] }; }));
        });
        return definitions.length > 0 && definitions[0] !== "[]" && definitions.every(d => d === definitions[0]);
      });
      model.dates.forEach(date => {
        const summaries = axes.map((axis, i) => {
          if (!compatible[i]) return { n: 0, mean: null, sd: null };
          const fixed = model.athletes.filter(a => model.dates.every(d => series.some(s => s.athleteId === a.id && s.date === d && N(s.values[i]) !== null))).map(a => a.id);
          const values = series.filter(s => s.date === date && (model.dates.length === 1 || fixed.includes(s.athleteId))).map(s => s.values[i]).filter(v => N(v) !== null);
          return global.Calc.descriptive(values, false);
        });
        series.push({ mean: true, date, values: summaries.map(s => s.mean), sds: summaries.map(s => s.sd), ns: summaries.map(s => s.n) });
      });
      return `<div class="comparison-chart-panel" data-pdf-atomic><h5>${key === "strength" ? "关节力量水平" : "关节对称性"}</h5>${radarChart(model, axes, series, { title: key === "strength" ? "关节力量水平" : "关节对称性", maximum: Math.max(100, ...series.flatMap(s => s.values).filter(v => N(v) !== null)), unit: "%" })}${compatible.some(v => !v) ? '<p class="comparison-chart-caption">部分部位采用不同测量内容或评价目标，均值留空；个人结果保留。</p>' : ""}</div>`;
    }).join("");
  }
  function projectCharts(model, project, prefs) {
    const selected = prefs.metricKeys.map(key => project.metrics.find(m => m.key === key)).filter(Boolean);
    if (!selected.length && !prefs.curveKeys.length) return '<p class="empty">选择图中展示的指标</p>';
    if (prefs.chartMode === "trend") return selected.map(metric => `<div class="comparison-chart-panel" data-pdf-atomic><h5>${E(metric.label)}${metric.unit ? " · " + E(metric.unit) : ""}</h5>${trendChart(model, metric)}</div>`).join("");
    const curves = (model.curves || []).filter(c => c.testId === project.id && prefs.curveKeys.includes(c.key)), generic = project.renderer === "scalar" ? originalGeneric(model, project, selected) : "", iso = isoCharts(model, project);
    let result = curves.map(curve => `<div class="comparison-chart-panel" data-pdf-atomic><h5>${E(curve.title || curve.kind)}</h5>${curveChart(model, curve)}</div>`).join("") + generic + iso;
    if (project.renderer === "fms") {
      const axes = selected.filter(m => /^fms_\d$/.test(m.id));
      if (axes.length) result += `<div class="comparison-chart-panel" data-pdf-atomic><h5>FMS 原动作评分</h5>${radarChart(model, axes, axisSeries(model, axes), { title: "FMS 原动作评分", maximum: 3, unit: "分" })}</div>`;
      result += selected.filter(m => !/^fms_\d$/.test(m.id)).map(metric => `<div class="comparison-chart-panel" data-pdf-atomic><h5>${E(metric.label)}</h5>${metricChart(model, metric, "column")}</div>`).join("");
    }
    const native = model.entries.find(e => e.record?.enabled?.[project.id]), view = project.renderer === "scalar" && native ? global.RingsideGenericReport?.resolveView(native.record, project.id, model.catalog) : null;
    if ((!generic || curves.length || iso) && project.renderer !== "fms") result += selected.map(metric => `<div class="comparison-chart-panel" data-pdf-atomic><h5>${E(metric.label)}${metric.unit ? " · " + E(metric.unit) : ""}</h5>${metricChart(model, metric, view?.kind || "column")}</div>`).join("");
    return result;
  }
  function controls(model, project, prefs) {
    const curves = (model.curves || []).filter(c => c.testId === project.id);
    const native = model.entries.find(e => e.record?.enabled?.[project.id]), nativeView = project.reportView || (native && global.RingsideGenericReport?.resolveView(native.record, project.id, model.catalog));
    const selectable = nativeView?.kind === "scatter" && prefs.chartMode === "original" ? ["横轴", "纵轴"].map((label, axis) => `<label class="comparison-axis-picker">${label}<select data-comparison-scatter-axis="${axis}" data-comparison-project="${E(project.id)}" aria-label="${E(project.name)}${label}">${project.metrics.filter(metric => native.record.definitions.find(d => d.id === metric.id)?.entryScope === "attempt").map(metric => `<option value="${E(metric.key)}"${metric.key === prefs.metricKeys[axis] ? " selected" : ""}>${E(metric.label)} · ${E(metric.unit)}</option>`).join("")}</select></label>`).join("") : project.metrics.map(metric => `<label><input type="checkbox" data-comparison-metric="${E(metric.key)}" data-comparison-project="${E(project.id)}"${prefs.metricKeys.includes(metric.key) ? " checked" : ""}>${E(metric.label)}${metric.unit ? " · " + E(metric.unit) : ""}</label>`).join("");
    return `<div class="comparison-controls no-print"><details class="multi-select comparison-metric-picker" data-comparison-picker="${E(project.id)}"${prefs.pickerOpen ? " open" : ""}><summary>图中指标 · ${prefs.metricKeys.length + prefs.curveKeys.length} 项</summary><div class="multi-options">${curves.length ? '<p class="comparison-picker-label">原图曲线</p>' + curves.map(curve => `<label><input type="checkbox" data-comparison-curve="${E(curve.key)}" data-comparison-project="${E(project.id)}"${prefs.curveKeys.includes(curve.key) ? " checked" : ""}>${E(curve.title)}${curve.unit ? " · " + E(curve.unit) : ""}</label>`).join("") + '<p class="comparison-picker-label">结果指标</p>' : ""}${selectable}</div></details>${model.dates.length > 1 ? `<div class="comparison-segment" role="group" aria-label="${E(project.name)}图表形式"><button data-comparison-chart-mode="original" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.chartMode === "original"}">原图对照</button><button data-comparison-chart-mode="trend" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.chartMode === "trend"}">指标趋势</button></div>` : ""}<div class="comparison-segment" role="group" aria-label="${E(project.name)}表格内容"><button data-comparison-table-mode="summary" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.tableMode === "summary"}">汇总</button><button data-comparison-table-mode="individual" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.tableMode === "individual"}">个人明细</button></div></div>`;
  }
  function capabilityAnalysis(model, views) {
    const cards = model.capabilities || [];
    if (!cards.length) return "";
    const optionMap = M.capabilityDirectionOptions || {};
    return `<section class="capability-analysis-region comparison-capabilities" data-capability-region><div class="quality-group"><div class="quality-heading"><h3>${E(global.RingsideTests.analysisLabel)}</h3></div><div class="capability-direction-grid" data-capability-count="${cards.length}">${cards.map(card => {
      const period = card.periods?.at(-1), groups = period?.groups || [], basis = model.selection?.basis?.[card.id], options = optionMap[card.id];
      const parameters = (period?.parameters || []).map(p => [E(p.label), p.n, meanSD(p) + " " + E(p.unit), F(p.median), N(p.cv) !== null ? F(p.cv, 1) + "%" : "—"]);
      const shifts = card.transitions || [];
      return `<article class="capability-direction-card" data-comparison-capability="${E(card.id)}"><div class="capability-card-summary"><h4>${E(card.title)}</h4><section><p class="capability-direction-basis">${E(basisLabel(card.id, card.basis))}</p>${groups.map(group => `<p class="capability-direction-judgment">${E(group.judgment)} <small>${group.count} 人</small></p><p class="capability-direction-context">${E((group.names || group.athleteIds?.map(id => nameOf(model, id)) || []).join("、"))}</p>`).join("") || '<p class="empty">暂无可判断结果</p>'}</section>${options ? `<label class="capability-selector no-print">判断依据<select data-comparison-basis="${E(card.id)}" aria-label="${E(card.title)}判断依据">${options.map(([id, label]) => `<option value="${E(id)}"${id === basis ? " selected" : ""}>${E(label)}</option>`).join("")}</select></label>` : ""}</div><details class="capability-card-parameters" data-comparison-capability-expanded="${E(card.id)}"${views.capabilityExpanded?.[card.id] ? " open" : ""}><summary>查看相关参数与分组${shifts.length ? "变化" : ""}</summary>${parameters.length ? table(["参数", "n", "均值 ± SD", "中位数", "CV"], parameters) : ""}${shifts.length ? table(["队员", "比较日期", "基线方向", "本期方向", "变化"], shifts.map(t => [E(nameOf(model, t.athleteId)), E(t.toDate || t.date), E(t.from?.judgment || t.from), E(t.to?.judgment || t.to), E({ changed: "方向改变", unchanged: "保持", unknown: "待判断" }[t.state] || t.state || "")])) : ""}${(period?.members || []).length ? table(["队员", "判断依据", "结果", "方向"], period.members.map(m => [E(nameOf(model, m.athleteId)), E(m.label), F(m.value) + " " + E(m.unit), E(m.judgment)])) : ""}</details></article>`;
    }).join("")}</div></div></section>`;
  }
  function render(model, views = {}, options = {}) {
    views = preferences(model, views);
    const longitudinal = model.dates.length > 1, heading = model.kind === "team" ? "团队报告" : model.kind === "personal-longitudinal" ? "个人纵向报告" : "团队纵向报告";
    const projects = model.projects.map(project => { const prefs = views.projects[project.id]; return `<article class="test-block comparison-project" id="detail-${E(project.id)}" data-comparison-project="${E(project.id)}"><div class="test-title"><div><h4>${E(project.name)}</h4><p>${E(model.dates.join(" · "))}${longitudinal ? " · 基线 " + E(model.dates[0]) : ""}</p></div></div>${controls(model, project, prefs)}<div class="comparison-chart-stack">${projectCharts(model, project, prefs)}</div><div class="comparison-data">${projectTable(model, project, prefs)}${fmsDetails(model, project)}</div></article>`; }).join("");
    const stats = model.statistics || {}, summaryHTML = options.includeSummary ? `<div class="micro-cards">${summary(model)}</div><div class="summary-grid"><article class="card"><div class="card-head"><h3>损伤风险筛查</h3></div>${body(model, { ...options, views })}${screenItems(model, { views })}</article><article class="card"><div class="card-head"><h3>运动表现概览</h3></div>${radar(model)}</article></div>` : "";
    return `<div class="comparison-report" data-comparison-kind="${E(model.kind)}">${summaryHTML}<div class="quality-group"><div class="quality-heading"><h3>${heading}</h3><p>${model.athletes.length} 名队员 · ${model.dates.length} 个测试日期</p></div>${projects || '<p class="empty">所选记录暂无可比较指标</p>'}</div>${capabilityAnalysis(model, views)}${longitudinal && model.athletes.length > 1 ? `<details class="comparison-method"><summary>统计方法</summary><p>连续指标采用固定配对队员；双侧配对 t 检验，Cohen’s dz，报告内全部比较统一 Holm 校正。95% CI 为单项未校正的平均变化区间。${stats.comparisonCount ?? stats.familySize ?? ""} 项比较。</p><p>均值采用每位队员的记录代表成绩；样本标准差反映队员间分布。日期趋势按实际时间间隔计算。</p></details>` : ""}</div>`;
  }
  function applyHighlight(container, id = "") {
    container.querySelectorAll(".comparison-series,.comparison-person-row").forEach(node => { const active = !!id && node.dataset.athleteId === id; node.classList.toggle("comparison-highlighted", active); node.classList.toggle("comparison-dimmed", !!id && !active); if (node.classList.contains("comparison-screening-series")) { node.setAttribute("opacity", !!id && !active ? ".12" : "1"); node.querySelectorAll(".comparison-screening-segment").forEach(segment => { segment.setAttribute("stroke-width", active ? "3" : "1.5"); segment.setAttribute("stroke-opacity", active ? "1" : ".6"); }); } });
    container.querySelectorAll("[data-comparison-highlight]").forEach(node => { node.setAttribute("aria-pressed", String(!!id && node.dataset.comparisonHighlight === id)); });
    container.querySelectorAll(".comparison-screening-axis").forEach(axis => {
      const selected = id ? [...container.querySelectorAll(".comparison-screening-row")].find(row => row.dataset.athleteId === id && row.dataset.region === axis.dataset.region) : null;
      axis.dataset.bodyDetail = selected?.dataset.bodyDetail || axis.dataset.overviewDetail;
    });
  }
  const bindings = new WeakMap();
  function bind(container, options) {
    const state = { ...options, views: preferences(options.model, options.views || options.prefs || {}) }; bindings.set(container, state);
    if (!container.dataset.comparisonBound) {
      container.dataset.comparisonBound = "true";
      const publish = current => { current.onPreferences?.(copy(current.views)); };
      container.addEventListener("click", event => {
        const current = bindings.get(container), node = event.target.closest("[data-comparison-chart-mode],[data-comparison-table-mode],[data-comparison-highlight],[data-comparison-edit-record],[data-comparison-screening-date]");
        if (!node || !container.contains(node)) return;
        if (current.overview && node.closest(".comparison-report")) return;
        if (node.dataset.comparisonScreeningDate) { current.views.screeningDate = node.dataset.comparisonScreeningDate; publish(current); return; }
        if (node.dataset.comparisonEditRecord) { event.stopPropagation(); current.onEditRecord?.(node.dataset.comparisonEditRecord); return; }
        if (node.dataset.comparisonHighlight) { const id = node.dataset.comparisonHighlight; current.views.highlightAthleteId = current.views.highlightAthleteId === id ? "" : id; applyHighlight(container, current.views.highlightAthleteId); publish(current); return; }
        const projectId = node.dataset.comparisonProject, preference = current.views.projects[projectId];
        if (node.dataset.comparisonChartMode) preference.chartMode = node.dataset.comparisonChartMode;
        if (node.dataset.comparisonTableMode) preference.tableMode = node.dataset.comparisonTableMode;
        publish(current);
      });
      container.addEventListener("change", event => {
        const current = bindings.get(container), node = event.target;
        if (current.overview && node.closest(".comparison-report")) return;
        if (node.dataset.comparisonMetric) { const preference = current.views.projects[node.dataset.comparisonProject], keys = new Set(preference.metricKeys); if (node.checked) keys.add(node.dataset.comparisonMetric); else keys.delete(node.dataset.comparisonMetric); preference.metricKeys = [...keys]; publish(current); }
        else if (node.dataset.comparisonCurve) { const preference = current.views.projects[node.dataset.comparisonProject], keys = new Set(preference.curveKeys); if (node.checked) keys.add(node.dataset.comparisonCurve); else keys.delete(node.dataset.comparisonCurve); preference.curveKeys = [...keys]; publish(current); }
        else if (node.dataset.comparisonScatterAxis !== undefined) {
          const preference = current.views.projects[node.dataset.comparisonProject], axis = +node.dataset.comparisonScatterAxis, other = 1 - axis, previous = preference.metricKeys[axis];
          if (preference.metricKeys[other] === node.value) preference.metricKeys[other] = previous;
          preference.metricKeys[axis] = node.value; preference.metricKeys = preference.metricKeys.slice(0, 2); publish(current);
        }
        else if (node.dataset.comparisonBasis) current.onBasis?.({ key: node.dataset.comparisonBasis, value: node.value });
      });
      container.addEventListener("keydown", event => {
        if ((event.key === "Enter" || event.key === " ") && event.target.matches(".comparison-person-row")) { event.preventDefault(); event.target.click(); }
      });
      container.addEventListener("toggle", event => {
        const current = bindings.get(container), node = event.target;
        if (!current) return;
        if (current.overview && node.closest(".comparison-report")) return;
        if (node.dataset.comparisonExpanded) { const p = current.views.projects[node.dataset.comparisonExpanded]; if (p.expanded !== node.open) { p.expanded = node.open; publish(current); } }
        else if (node.dataset.comparisonPicker) { const p = current.views.projects[node.dataset.comparisonPicker]; if (p.pickerOpen !== node.open) { p.pickerOpen = node.open; publish(current); } }
        else if (node.dataset.comparisonCapabilityExpanded) { const id = node.dataset.comparisonCapabilityExpanded; if (current.views.capabilityExpanded[id] !== node.open) { current.views.capabilityExpanded[id] = node.open; publish(current); } }
      }, true);
    }
    applyHighlight(container, state.views.highlightAthleteId);
  }
  function bindOverview(container, options) {
    bind(container, { ...options, overview: true });
  }
  function snapshotView(container, views = {}) {
    const result = copy(views); result.projects ||= {}; result.capabilityExpanded ||= {};
    const screening = container.querySelector(".comparison-screening-chart[data-screening-date]"); if (screening) result.screeningDate = screening.dataset.screeningDate;
    container.querySelectorAll("[data-comparison-expanded]").forEach(d => { result.projects[d.dataset.comparisonExpanded] ||= {}; result.projects[d.dataset.comparisonExpanded].expanded = d.open; });
    container.querySelectorAll("[data-comparison-picker]").forEach(d => { result.projects[d.dataset.comparisonPicker] ||= {}; result.projects[d.dataset.comparisonPicker].pickerOpen = d.open; });
    container.querySelectorAll("[data-comparison-capability-expanded]").forEach(d => { result.capabilityExpanded[d.dataset.comparisonCapabilityExpanded] = d.open; });
    return result;
  }
  global.RingsideComparisonReport = { render, summary, body, screenItems, radar, overview, preferences, bind, bindOverview, applyHighlight, snapshotView, curveChart, metricChart, trendChart, radarChart, genericPanels };
})(typeof window !== "undefined" ? window : globalThis);
