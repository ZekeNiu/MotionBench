(function (root) {
  "use strict";
  const N = value => root.Calc.num(value), escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const colors = { improved: "#187459", declined: "#b23f3d", neutral: "#708699", red: "#b23f3d", amber: "#ac7a21", green: "#187459", gray: "#708699" };
  const statusOf = value => Object.hasOwn(colors, value) ? value : "gray";
  const trafficLabel = (status, fallback = "") => root.Def.trafficLabel(status, fallback);
  const trendSize = Object.freeze({ width: 160, height: 72, minWidth: 120, columnWidth: 172, top: 18, bottom: 57, dateY: 68, unitY: 9 });
  const asymmetry = cell => cell.assessmentKind === "asymmetry" || cell.section === "asymmetry";
  // Partition only at declared or algebraically inverted boundaries. The
  // established evaluator decides each open interval and its exact endpoints;
  // overlaps and gaps therefore remain unclassified instead of being painted
  // according to whichever configured range happens to be drawn last.
  function referenceRanges(boundaries, evaluate, factor = 1) {
    const cuts = [...new Set(boundaries.map(N).filter(value => value !== null))].sort((a, b) => a - b), result = [];
    const edges = [null, ...cuts, null];
    const same = (a, b) => !!(a && b && a.status === b.status && a.label === b.label);
    for (let i = 1; i < edges.length; i++) {
      const min = edges[i - 1], max = edges[i];
      let sample = min === null ? max === null ? 0 : max - Math.max(1, Math.abs(max) / 2)
        : max === null ? min + Math.max(1, Math.abs(min) / 2) : min / 2 + max / 2;
      if (!Number.isFinite(sample)) sample = min === null ? -Number.MAX_VALUE : Number.MAX_VALUE;
      if (min !== null && sample <= min || max !== null && sample >= max) continue;
      const grade = evaluate(sample);
      if (!grade || !["red", "amber", "green", "gray"].includes(grade.status)) continue;
      const interval = { min: min === null ? null : min * factor, max: max === null ? null : max * factor,
        includeMin: min === null || same(evaluate(min), grade), includeMax: max === null || same(evaluate(max), grade),
        status: grade.status, label: trafficLabel(grade.status, grade.label || ""), sourceLabel: grade.label || "" };
      const previous = result.at(-1);
      if (previous && previous.max === interval.min && previous.status === interval.status && previous.sourceLabel === interval.sourceLabel && (previous.includeMax || interval.includeMin)) {
        previous.max = interval.max; previous.includeMax = interval.includeMax;
      } else result.push(interval);
    }
    return result;
  }
  function referenceFor(cell, evaluation, definition, factor) {
    const applicable = evaluation.applicable !== false && definition?.referenceEnabled !== false;
    if (!applicable) return null;
    const unit = cell.unit || evaluation.unit || definition?.unit || "";
    const direction = evaluation.direction || definition?.direction || cell.direction || "higher";
    const base = { unit, direction, source: evaluation.source || "" };
    if (evaluation.kind === "fixed") return { ...base, kind: "ordinal", basis: { kind: "fixed-fms" },
      levels: [0, 1, 2, 3].map(value => { const status = value === 0 ? "red" : value < 3 ? "amber" : "green"; return { value, status, label: trafficLabel(status) }; }) };
    if (cell.assessmentKind === "screening") return { ...base, kind: "ordinal", basis: { kind: "screening-status" },
      levels: ["red", "amber", "green"].map((status, i) => ({ value: i + 1, status, label: trafficLabel(status) })) };
    if (asymmetry(cell)) {
      const amber = N(evaluation.rules?.asymAmber), red = N(evaluation.rules?.asymRed);
      if (amber === null || red === null || amber < 0 || red <= amber) return null;
      return { ...base, kind: "ranges", direction: "lower", basis: { kind: "asymmetry-rules", asymAmber: amber, asymRed: red }, ranges: [
        { min: 0, max: amber, includeMin: true, includeMax: false, status: "green", label: "双侧差异低于关注阈值" },
        { min: amber, max: red, includeMin: true, includeMax: false, status: "amber", label: "双侧差异达到关注阈值" },
        { min: red, max: null, includeMin: true, includeMax: true, status: "red", label: "双侧差异达到预警阈值" }
      ] };
    }
    const ranges = evaluation.rangesApplicable !== false ? definition?.ranges || [] : [];
    const target = evaluation.targetApplicable !== false && N(evaluation.target) > 0 ? N(evaluation.target) : null;
    const targetFields = target === null ? {} : { target: target * factor };
    if (ranges.length) {
      const evaluate = value => { const grade = root.RingsideModel.grade(value, definition); return grade.range ? grade : null; };
      return { ...base, kind: "ranges", basis: { kind: "configured-ranges" }, ...targetFields,
        ranges: referenceRanges(ranges.flatMap(range => [range.min, range.max]), evaluate, factor) };
    }
    if (target === null) return null;
    if (evaluation.kind === "iso" || cell.testId === "iso" && cell.section === "force") {
      // A reference mean for a ratio is descriptive, not a force threshold.
      const descriptive = evaluation.reference?.kind === "literature-mean" && evaluation.reference.status === "gray";
      return { ...base, kind: "target", direction: "higher", ...targetFields,
        basis: { kind: descriptive ? "reference-mean" : "isometric-target", referenceKind: evaluation.reference?.kind || "manual" },
        ranges: descriptive ? [] : referenceRanges([target], value => root.RingsideModel.isoStrengthAssessment(value, target, { unit: definition?.unit || unit }), factor) };
    }
    const scoreAmber = N(cell.displayRules?.scoreAmber), scoreGreen = N(cell.displayRules?.scoreGreen);
    const basis = { kind: "metric-target-score", scoreAmber, scoreGreen };
    const reference = { ...base, kind: "target", ...targetFields, basis, ranges: [] };
    if (scoreAmber === null || scoreGreen === null || scoreAmber < 0 || scoreGreen > 100 || scoreGreen <= scoreAmber) return reference;
    const effective = { ...definition, direction, target, targetEnabled: true, referenceEnabled: true, ranges: [] };
    const boundaries = [0, ...[scoreAmber, scoreGreen].map(score => {
      if (direction === "lower" && score === 0) return null;
      const boundary = direction === "lower" ? target * 100 / score : target * score / 100;
      return Number.isFinite(boundary) ? boundary : direction === "lower" ? target / (score / 100) : target * (score / 100);
    })];
    reference.ranges = referenceRanges(boundaries, value => root.RingsideModel.evaluation(value, effective, { rules: { scoreAmber, scoreGreen } }), factor);
    return reference;
  }
  // Positive provenance, independent of wording and traffic-light color.
  // Measurements and diagnostic reasons remain available even without a grade.
  function assessment(cell, factor = 1) {
    const e = cell.displayEvaluation || cell.evaluation || {}, grade = e.grade || {}, value = N(cell.value), definition = cell.displayDefinition || cell.definition || cell.balance;
    const applicable = e.applicable !== false && definition?.referenceEnabled !== false;
    const ranges = applicable && e.rangesApplicable !== false ? definition?.ranges || [] : [];
    const reference = referenceFor(cell, e, definition, factor);
    const warnings = cell.warnings || [];
    let state = value === null ? "missing" : "observed", label = "", status = "gray", sourceLabel = grade.label || "";
    const reasons = [cell.displayEvaluation ? e.reason || "" : e.reason || cell.assessment?.reason || cell.referenceReason || (value === null ? cell.notes || "" : "")];
    if (value !== null) {
      const matched = !!grade.range || cell.balance && ranges.length && !!root.RingsideModel.grade(cell.rawValue ?? value, cell.balance).range;
      const fixed = e.kind === "fixed" && Number.isInteger(value) && value >= 0 && value <= 3 || asymmetry(cell) || cell.assessmentKind === "screening";
      const target = !ranges.length && reference?.kind === "target" && N(e.attainment) !== null;
      if (applicable && matched || fixed || applicable && target) { state = "graded"; label = grade.label || ""; status = statusOf(grade.status); }
      else if (e.applicable === false) state = "not-applicable";
      else if (ranges.length) state = "unclassified";
    }
    if (warnings.length) {
      const rank = { red: 3, amber: 2, green: 1, gray: 0 }, strongest = warnings.reduce((a, b) => rank[b.status] > rank[a.status] ? b : a);
      state = "warning"; label = warnings.map(w => w.label).join("；"); status = statusOf(strongest.status);
      sourceLabel = label; reasons.push(label);
    }
    // Symptoms override the displayed traffic light, independently of the
    // measurement's target grade. A pain-only record still has a missing value.
    if (cell.pain && !asymmetry(cell)) { state = "warning"; status = "red"; label = trafficLabel("red"); reasons.push("疼痛记录"); }
    if (["graded", "warning"].includes(state) && !asymmetry(cell)) label = trafficLabel(status, label);
    return { state, visible: !!label && ["graded", "warning"].includes(state), label, sourceLabel, status, reference, reason: [...new Set(reasons.filter(Boolean))].join("；") };
  }
  function number(value, digits = 2) {
    if (N(value) === null) return "—";
    const magnitude = Math.abs(value);
    if (magnitude && magnitude < 1e-6) return Number(value.toPrecision(2)).toExponential();
    return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: magnitude ? Math.min(8, Math.max(digits, Math.ceil(-Math.log10(magnitude)) + 1)) : digits });
  }
  function changeLabel(change, unit, digits) {
    if (!change?.available) return change?.reason || "";
    const signed = value => (value > 0 ? "+" : "") + number(value, digits);
    const absolute = signed(change.delta) + (change.kind === "percentage-point" ? " 个百分点" : " " + (unit || ""));
    return absolute + (N(change.percent) !== null ? "；相对 " + signed(change.percent) + "%" : "") + (change.reason ? "；" + change.reason : "");
  }
  // A plain serializable projection also serves print reconstruction. Consumers
  // supply their established comparator rather than deriving a second formula.
  function trend(row, periods, compare) {
    const points = periods.map((period, i) => {
      const cell = row.cells[i], change = i ? compare(row.cells, i - 1, i, periods, row.measurementScale) : null;
      return { id: period.id, date: period.date, label: period.label || period.date, value: N(cell?.value), unit: cell?.unit || row.unit || "", pain: !!cell?.pain,
        reference: cell?.display?.reference || null, evaluationKey: cell?.evaluationKey || "", change };
    });
    const measured = points.filter(p => p.value !== null), reference = measured[0]?.reference;
    const shared = reference && points.every(p => p.evaluationKey === measured[0].evaluationKey && JSON.stringify(p.reference) === JSON.stringify(reference));
    return { name: row.name, unit: measured[0]?.unit || row.unit || "", digits: row.digits ?? 2, ordinal: row.measurementScale === "ordinal", fms: /^fms:/.test(row.id), points: points.map(({ evaluationKey, reference, ...point }) => point), reference: shared ? reference : null,
      ...(!shared && points.some(point => point.reference) ? { references: points.map(point => point.reference) } : {}) };
  }
  function pointLabel(spec, index) {
    const point = spec.points[index], comparison = index ? "；较 " + spec.points[index - 1].label + "：" + changeLabel(point.change, point.unit, spec.digits) : "";
    const reference = spec.references?.[index], referenceText = !spec.references ? "" : !reference ? "；本期无适用评价标准"
      : "；本期评价：" + (reference.kind === "ordinal" ? "固定等级" : reference.kind === "ranges" ? "配置的等级区间" : "参考目标 " + number(reference.target, spec.digits) + " " + reference.unit);
    return point.label + "：" + number(point.value, spec.digits) + (point.value !== null ? " " + point.unit : "（缺测）") + (point.pain ? "；疼痛记录：预警" : "") + referenceText + comparison;
  }
  function draw(spec, width = trendSize.width, print = false) {
    const measured = spec.points.filter(p => p.value !== null);
    if (!measured.length || spec.points.length < 2) return "";
    width = Math.max(trendSize.minWidth, Math.min(trendSize.width, width));
    const { height, top, bottom } = trendSize, right = width - 10, color = colors.neutral;
    const values = measured.map(p => p.value), min = Math.min(...values), max = Math.max(...values), pad = Math.abs(min) * .05 || 1;
    const extent = max === min ? [min-pad, max+pad] : [min, max], span = extent[1]-extent[0];
    const base = 10 ** Math.floor(Math.log10(span)), step = base * (span/base < 2 ? .2 : span/base < 5 ? .5 : 1);
    const clean = value => Number(value.toPrecision(16));
    const ordinalReference = [spec.reference, ...(spec.references || [])].find(reference => reference?.kind === "ordinal"), levels = ordinalReference?.levels || [];
    let low = levels.length ? Math.min(...levels.map(level => level.value)) : spec.fms ? 0 : clean(Math.floor(extent[0]/step)*step), high = levels.length ? Math.max(...levels.map(level => level.value)) : spec.fms ? 3 : clean(Math.ceil(extent[1]/step)*step);
    if(high<=low){low=extent[0];high=extent[1];}
    const ticks = levels.length ? levels.map(level => level.value) : spec.fms ? [0,1,2,3] : [low, clean((low+high)/2), high];
    const axisNumber = value => {
      if (!value) return "0";
      const digits = Math.max(0, Math.min(10, Math.ceil(Math.log10(Math.abs(value)/(high-low)))+2));
      return Math.abs(value)>=1e5 || Math.abs(value)<.001 ? value.toExponential(digits).replace(/\.0+(?=e)/,"").replace(/e\+/,"e") : number(value, Math.max(0,Math.min(10,-Math.floor(Math.log10(high-low))+2)));
    };
    const tickLabels = ticks.map(axisNumber), unit = spec.unit || "", textWidth = label => [...label].reduce((sum,c)=>sum+(/[\u3400-\u9fff]/.test(c)?9:7),0);
    // Units have their own full-width heading. A long unit must not squeeze
    // the plotting area toward the right edge.
    const left = Math.max(25, Math.min(width*.5, Math.max(...tickLabels.map(textWidth))+10));
    const x = i => left + (right - left) * i / (spec.points.length - 1), y = value => bottom - (value - low) / (high - low) * (bottom - top), coord = n => Number(n.toFixed(2));
    const text = (x, y, label, anchor = "middle") => `<text x="${coord(x)}" y="${coord(y)}" text-anchor="${anchor}" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="9" fill="#667684">${escape(label)}</text>`;
    const referenceSlots = spec.reference ? [{ reference: spec.reference, start: left, end: right, scope: "shared" }] : (spec.references || []).map((reference, index) => ({ reference, index, scope: "period",
      start: index ? (x(index - 1) + x(index)) / 2 : left, end: index < spec.points.length - 1 ? (x(index) + x(index + 1)) / 2 : right })).filter(slot => slot.reference);
    // A changed standard belongs only to its own test-date slot. Both screen
    // and print consume these same projected references and boundaries.
    function referenceMarkup(slot, targets = false) {
      const { reference, scope, index } = slot, start = coord(slot.start), end = coord(slot.end);
      const attributes = ` data-trend-reference-scope="${scope}"${index === undefined ? "" : ` data-trend-period-index="${index}"`}`;
      if (targets) return N(reference.target) !== null && reference.target >= low && reference.target <= high
        ? `<path data-trend-reference="target"${attributes} d="M${start} ${coord(y(reference.target))}H${end}" fill="none" stroke="#9aab9e" stroke-dasharray="3 3"><title>参考目标 ${escape(number(reference.target))} ${escape(spec.unit)}</title></path>` : "";
      const ordinal = reference.kind === "ordinal", referenceLevels = ordinal ? reference.levels : [];
      const bands = ordinal ? referenceLevels.map((level, i) => ({ ...level,
        min: i ? (referenceLevels[i - 1].value + level.value) / 2 : low,
        max: i < referenceLevels.length - 1 ? (level.value + referenceLevels[i + 1].value) / 2 : high,
        label: "等级 " + level.value + "：" + level.label })) : reference.ranges || [];
      let markup = "";
      for (const range of bands) {
        const a = Math.max(low, N(range.min) ?? low), b = Math.min(high, N(range.max) ?? high);
        if (b <= a) continue;
        markup += `<rect data-trend-band="${escape(range.status)}" data-trend-band-scope="${scope}"${index === undefined ? "" : ` data-trend-period-index="${index}"`} data-trend-reference="${ordinal ? "ordinal" : "range"}" data-reference-status="${escape(range.status)}" x="${start}" y="${coord(y(b))}" width="${coord(end-start)}" height="${coord(y(a)-y(b))}" fill="${colors[range.status] || color}" fill-opacity=".075"><title>${escape(range.label)}</title></rect>`;
      }
      return `<g${attributes}${index === undefined ? "" : ` data-trend-reference-period="${index}"`}>${markup}</g>`;
    }
    let body = referenceSlots.map(slot => referenceMarkup(slot)).join("");
    body += '<g data-trend-axis="y" data-axis-min="'+low+'" data-axis-max="'+high+'" aria-label="纵坐标 '+escape(unit)+'">';
    body += text(0,trendSize.unitY,unit,"start");
    for (let i=0;i<ticks.length;i++) body += `<path d="M${left} ${coord(y(ticks[i]))}H${right}" fill="none" stroke="#dbe2e8" stroke-dasharray="2 3"/>` + text(left-8,y(ticks[i])+3,tickLabels[i],"end");
    body += `<path d="M${left} ${top}V${bottom}" fill="none" stroke="#c5d0d8"/></g>`;
    body += referenceSlots.map(slot => referenceMarkup(slot, true)).join("");
    spec.points.forEach((point, i) => {
      if (i && point.change?.available) body += `<path data-trend-segment="${i}" d="M${coord(x(i-1))} ${coord(y(spec.points[i-1].value))}L${coord(x(i))} ${coord(y(point.value))}" fill="none" stroke="${colors[point.change.improvement] || color}" stroke-width="1.8" stroke-linecap="round"/>`;
    });
    spec.points.forEach((point, i) => {
      const label = pointLabel(spec, i), cy = point.value === null ? bottom : y(point.value), tone = point.pain ? colors.red : colors[point.change?.improvement] || color;
      const mark = point.value === null ? `<path d="M${coord(x(i)-2)} ${bottom}h4" stroke="#b8c5ce"/>` : `<circle cx="${coord(x(i))}" cy="${coord(cy)}" r="3" fill="${i===spec.points.length-1?tone:"white"}" stroke="${tone}" stroke-width="1.5"/>`;
      const slot = Math.min(22, (right-left)/(spec.points.length-1)), hit = `<rect x="${coord(x(i)-slot/2)}" y="${top-6}" width="${coord(slot)}" height="${bottom-top+12}" fill="transparent"/>`;
      body += `<g data-trend-point="${i}" data-trend-tip="${escape(label)}"${print ? "" : ' tabindex="0" role="button"'} aria-label="${escape(label)}"><title>${escape(label)}</title>${mark}${hit}</g>`;
    });
    const room = (right-left)/(spec.points.length-1), allDates = room >= 45, shortDate = point => point.label.replace(/^\d{4}-/, "");
    spec.points.forEach((point, i) => { if (allDates || i === 0 || i === spec.points.length-1) body += text(x(i), trendSize.dateY, shortDate(point), i===0?"start":i===spec.points.length-1?"end":"middle"); });
    const title = spec.name + " · 变化趋势（按测试次序，点距不代表时间间隔）" + (spec.fms ? "；FMS 0–3 分，0 为疼痛" : "") + (spec.reference ? "；含所测日期共同适用的参考" : spec.references ? "；各日期使用各自评价标准" : "") + "；" + spec.points.map((_, i) => pointLabel(spec, i)).join("；");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${escape(title)}" data-pixel-layout="true"${spec.fms?' data-score-scale="0-3"':""}><title>${escape(title)}</title>${body}</svg>`;
  }
  function render(spec, print = false) { return `<div class="result-trend" style="--result-trend-width:${trendSize.width}px;--result-trend-min-width:${trendSize.minWidth}px" data-result-trend="${escape(JSON.stringify(spec))}">${draw(spec, trendSize.width, print)}</div>`; }
  function layout(container, { print = false } = {}) {
    container.querySelectorAll("[data-result-trend]").forEach(node => {
      const width = Math.max(trendSize.minWidth, Math.min(trendSize.width, Math.floor(node.getBoundingClientRect().width || trendSize.width))), key = width + ":" + print;
      if (node.dataset.trendLayout === key) return;
      node.innerHTML = draw(JSON.parse(node.dataset.resultTrend), width, print); node.dataset.trendLayout = key;
    });
  }
  const mounts = new WeakSet();
  function mount(container) {
    if (mounts.has(container)) return; mounts.add(container);
    let tip;
    const hide = () => { if(tip)tip.hidden = true; };
    const show = node => {
      if (!node) return;
      if (!tip || !tip.isConnected) { tip = container.ownerDocument.createElement("div"); tip.className = "result-trend-tooltip"; tip.setAttribute("role", "status"); container.append(tip); }
      tip.textContent = node.dataset.trendTip; tip.hidden = false;
      const box = node.getBoundingClientRect(), view = container.ownerDocument.defaultView;
      tip.style.left = Math.max(8, Math.min(view.innerWidth - tip.offsetWidth - 8, box.x + box.width/2 - tip.offsetWidth/2)) + "px";
      tip.style.top = Math.max(8, Math.min(view.innerHeight-tip.offsetHeight-8, box.top-tip.offsetHeight-8)) + "px";
    };
    container.addEventListener("pointerover", event => show(event.target.closest("[data-trend-point]")));
    container.addEventListener("pointerout", event => { if(event.target.closest("[data-trend-point]") !== event.relatedTarget?.closest?.("[data-trend-point]"))hide(); });
    container.addEventListener("focusin", event => show(event.target.closest("[data-trend-point]")));
    container.addEventListener("focusout", hide);
    container.addEventListener("click", event => { const node=event.target.closest("[data-trend-point]"); if(node)show(node);else hide(); });
    container.addEventListener("scroll", hide, true);
    container.addEventListener("keydown", event => {
      if(event.key === "Escape") { hide(); return; }
      const node = event.target.closest("[data-trend-point]"); if(!node)return;
      if(["Enter"," "].includes(event.key)){event.preventDefault();show(node);return;}
      const nodes = [...node.closest("[data-result-trend]").querySelectorAll("[data-trend-point]")], index = nodes.indexOf(node), next = { ArrowLeft: index-1, ArrowRight: index+1, Home: 0, End: nodes.length-1 }[event.key];
      if(next !== undefined){event.preventDefault();nodes[Math.max(0,Math.min(nodes.length-1,next))].focus();}
    });
  }
  root.RingsideResultDisplay = { assessment, trend, draw, render, layout, mount, number, changeLabel, trendSize, trafficLabel };
})(typeof window !== "undefined" ? window : globalThis);
