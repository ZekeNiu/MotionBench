(function (root) {
  "use strict";
  const N = value => root.Calc.num(value), escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const colors = { improved: "#187459", declined: "#b23f3d", neutral: "#708699", red: "#b23f3d", amber: "#ac7a21", green: "#187459", gray: "#708699" };
  const statusOf = value => Object.hasOwn(colors, value) ? value : "gray";
  // Positive provenance, independent of wording and traffic-light color.
  // Measurements and diagnostic reasons remain available even without a grade.
  function assessment(cell, factor = 1) {
    const e = cell.evaluation || {}, grade = e.grade || {}, value = N(cell.value), definition = cell.displayDefinition || cell.definition || cell.balance;
    const applicable = e.applicable !== false && definition?.referenceEnabled !== false;
    const ranges = applicable && e.rangesApplicable !== false ? definition?.ranges || [] : [];
    const convert = value => N(value) === null ? null : value * factor;
    const reference = ranges.length ? { kind: "ranges", ranges: ranges.map(r => ({ min: convert(r.min), max: convert(r.max), includeMin: r.includeMin, includeMax: r.includeMax, status: statusOf(r.status), label: r.label })) }
      : applicable && e.targetApplicable !== false && N(e.target) > 0 ? { kind: "target", target: convert(e.target), source: e.source || "" } : null;
    const warnings = cell.warnings || (cell.pain ? [{ status: "red", label: "疼痛" }] : []);
    let state = value === null ? "missing" : "observed", label = "", status = "gray";
    if (value !== null) {
      const matched = !!grade.range || cell.balance && ranges.length && !!root.RingsideModel.grade(cell.rawValue ?? value, cell.balance).range;
      const fixed = e.kind === "fixed" && Number.isInteger(value) && value >= 0 && value <= 3 || cell.assessmentKind === "asymmetry" || cell.assessmentKind === "screening";
      const target = !ranges.length && reference?.kind === "target" && N(e.attainment) !== null;
      if (applicable && matched || fixed || applicable && target) { state = "graded"; label = grade.label || ""; status = statusOf(grade.status); }
      else if (e.applicable === false) state = "not-applicable";
      else if (ranges.length) state = "unclassified";
    }
    if (warnings.length) {
      const rank = { red: 3, amber: 2, green: 1, gray: 0 }, strongest = warnings.reduce((a, b) => rank[b.status] > rank[a.status] ? b : a);
      state = "warning"; label = warnings.map(w => w.label).join("；"); status = statusOf(strongest.status);
    }
    return { state, visible: !!label && ["graded", "warning"].includes(state), label, status, reference };
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
    const shared = reference && measured.every(p => p.evaluationKey === measured[0].evaluationKey && JSON.stringify(p.reference) === JSON.stringify(reference));
    return { name: row.name, unit: measured[0]?.unit || row.unit || "", digits: row.digits ?? 2, ordinal: row.measurementScale === "ordinal", fms: /^fms:/.test(row.id), points: points.map(({ evaluationKey, reference, ...point }) => point), reference: shared ? reference : null };
  }
  function pointLabel(spec, index) {
    const point = spec.points[index], comparison = index ? "；较 " + spec.points[index - 1].label + "：" + changeLabel(point.change, point.unit, spec.digits) : "";
    return point.label + "：" + number(point.value, spec.digits) + (point.value !== null ? " " + point.unit : "（缺测）") + (point.pain ? "；疼痛" : "") + comparison;
  }
  function draw(spec, width = 180, print = false) {
    const measured = spec.points.filter(p => p.value !== null);
    if (!measured.length || spec.points.length < 2) return "";
    width = Math.max(120, Math.min(420, width));
    const height = 82, right = width - 10, top = 19, bottom = 58, color = colors.neutral;
    const values = measured.map(p => p.value), min = Math.min(...values), max = Math.max(...values), pad = Math.abs(min) * .05 || 1;
    const extent = max === min ? [min-pad, max+pad] : [min, max], span = extent[1]-extent[0];
    const base = 10 ** Math.floor(Math.log10(span)), step = base * (span/base < 2 ? .2 : span/base < 5 ? .5 : 1);
    const clean = value => Number(value.toPrecision(16));
    let low = spec.fms ? 0 : clean(Math.floor(extent[0]/step)*step), high = spec.fms ? 3 : clean(Math.ceil(extent[1]/step)*step);
    if(high<=low){low=extent[0];high=extent[1];}
    const ticks = spec.fms ? [0,1,2,3] : [low, clean((low+high)/2), high];
    const axisNumber = value => {
      if (!value) return "0";
      const digits = Math.max(0, Math.min(10, Math.ceil(Math.log10(Math.abs(value)/(high-low)))+2));
      return Math.abs(value)>=1e5 || Math.abs(value)<.001 ? value.toExponential(digits).replace(/\.0+(?=e)/,"").replace(/e\+/,"e") : number(value, Math.max(0,Math.min(10,-Math.floor(Math.log10(high-low))+2)));
    };
    const tickLabels = ticks.map(axisNumber), unit = spec.unit || "", textWidth = label => [...label].reduce((sum,c)=>sum+(/[\u3400-\u9fff]/.test(c)?9:7),0);
    const left = Math.max(25, Math.min(width*.5, Math.max(...tickLabels.map(textWidth),textWidth(unit))+10));
    const x = i => left + (right - left) * i / (spec.points.length - 1), y = value => bottom - (value - low) / (high - low) * (bottom - top), coord = n => Number(n.toFixed(2));
    const text = (x, y, label, anchor = "middle") => `<text x="${coord(x)}" y="${coord(y)}" text-anchor="${anchor}" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="9" fill="#667684">${escape(label)}</text>`;
    let body = "";
    if (spec.reference?.kind === "ranges") for (const range of spec.reference.ranges) {
      const a = Math.max(low, N(range.min) ?? low), b = Math.min(high, N(range.max) ?? high);
      if (b <= a) continue;
      body += `<rect x="${left}" y="${coord(y(b))}" width="${right-left}" height="${coord(y(a)-y(b))}" fill="${colors[range.status] || color}" fill-opacity=".075"><title>${escape(range.label)}</title></rect>`;
    }
    body += '<g data-trend-axis="y" data-axis-min="'+low+'" data-axis-max="'+high+'" aria-label="纵坐标 '+escape(unit)+'">';
    body += text(left-8,9,unit,"end");
    for (let i=0;i<ticks.length;i++) body += `<path d="M${left} ${coord(y(ticks[i]))}H${right}" fill="none" stroke="#dbe2e8" stroke-dasharray="2 3"/>` + text(left-8,y(ticks[i])+3,tickLabels[i],"end");
    body += `<path d="M${left} ${top}V${bottom}" fill="none" stroke="#c5d0d8"/></g>`;
    if (spec.reference?.kind === "target" && spec.reference.target >= low && spec.reference.target <= high) body += `<path data-trend-reference="target" d="M${left} ${coord(y(spec.reference.target))}H${right}" fill="none" stroke="#9aab9e" stroke-dasharray="3 3"><title>参考目标 ${escape(number(spec.reference.target))} ${escape(spec.unit)}</title></path>`;
    spec.points.forEach((point, i) => {
      if (i && point.change?.available) body += `<path data-trend-segment="${i}" d="M${coord(x(i-1))} ${coord(y(spec.points[i-1].value))}L${coord(x(i))} ${coord(y(point.value))}" fill="none" stroke="${colors[point.change.improvement] || color}" stroke-width="1.8" stroke-linecap="round"/>`;
    });
    spec.points.forEach((point, i) => {
      const label = pointLabel(spec, i), cy = point.value === null ? bottom : y(point.value), tone = point.pain ? colors.red : colors[point.change?.improvement] || color;
      const mark = point.value === null ? `<path d="M${coord(x(i)-2)} ${bottom}h4" stroke="#b8c5ce"/>` : `<circle cx="${coord(x(i))}" cy="${coord(cy)}" r="3" fill="${i===spec.points.length-1?tone:"white"}" stroke="${tone}" stroke-width="1.5"/>`;
      const slot = Math.min(22, (right-left)/(spec.points.length-1)), hit = `<rect x="${coord(x(i)-slot/2)}" y="13" width="${coord(slot)}" height="51" fill="transparent"/>`;
      body += `<g data-trend-point="${i}" data-trend-tip="${escape(label)}"${print ? "" : ' tabindex="0" role="button"'} aria-label="${escape(label)}"><title>${escape(label)}</title>${mark}${hit}</g>`;
    });
    const room = (right-left)/(spec.points.length-1), allDates = room >= 45, shortDate = point => point.label.replace(/^\d{4}-/, "");
    spec.points.forEach((point, i) => { if (allDates || i === 0 || i === spec.points.length-1) body += text(x(i), 77, shortDate(point), i===0?"start":i===spec.points.length-1?"end":"middle"); });
    const title = spec.name + " · 变化趋势（按测试次序，点距不代表时间间隔）" + (spec.fms ? "；FMS 0–3 分，0 为疼痛" : "") + (spec.reference ? "；含所测日期共同适用的参考" : "") + "；" + spec.points.map((_, i) => pointLabel(spec, i)).join("；");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${escape(title)}" data-pixel-layout="true"${spec.fms?' data-score-scale="0-3"':""}><title>${escape(title)}</title>${body}</svg>`;
  }
  function render(spec, print = false) { return `<div class="result-trend" data-result-trend="${escape(JSON.stringify(spec))}">${draw(spec, 180, print)}</div>`; }
  function layout(container, { print = false } = {}) {
    container.querySelectorAll("[data-result-trend]").forEach(node => {
      const width = Math.max(120, Math.floor(node.getBoundingClientRect().width || 180)), key = width + ":" + print;
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
  root.RingsideResultDisplay = { assessment, trend, draw, render, layout, mount, number, changeLabel };
})(typeof window !== "undefined" ? window : globalThis);
