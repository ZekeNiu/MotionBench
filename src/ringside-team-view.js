(function (root) {
  "use strict";
  const E = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const N = value => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const F = (value, digits = 2) => N(value) === null ? "—" : Number(value).toLocaleString("zh-CN", {maximumFractionDigits: digits});
  const kinds = [["column", "排名柱状图"], ["dot", "排名点图"], ["box", "箱线分布图"], ["histogram", "直方图"]];
  const chunks = (values, size) => Array.from({length: Math.ceil(values.length / size)}, (_, index) => values.slice(index * size, (index + 1) * size));
  const theme = () => root.RingsideReportAppearance?.theme || {ink:"#213836", muted:"#60736e", grid:"#dce6e2", accent:"#066c64", persons8:["#067970", "#2c7fb1", "#a1732b", "#945a8f"]};
  const personId = person => person.athleteId || person.id;
  const personName = person => person.name || person.athlete?.name || person.label || personId(person);
  const metricMeaning = metric => metric.meaning || (metric.measurementScale === "ordinal" ? "ordinal" : "numeric");
  const precision = metric => Number.isInteger(metric?.digits) ? metric.digits : metricMeaning(metric || {}) === "ordinal" ? 0 : 2;
  function binPrecision(data) {
    const widths=(data.bins||[]).map(bin=>bin.to-bin.from).filter(width=>width>0),base=precision(data.metric||{});
    if(widths.length)return Math.min(15,Math.max(base,Math.ceil(-Math.log10(Math.min(...widths)))+1));
    const value=data.bins?.[0]?.from,parts=String(value??"").toLowerCase().split("e"),decimals=(parts[0].split(".")[1]||"").length-Number(parts[1]||0);
    return Math.min(15,Math.max(base,decimals));
  }
  const binValue = (value, data) => {const digits=binPrecision(data);return value!==0&&Math.abs(value)<10**-digits?Number(value).toExponential(5):F(value,digits);};
  const metricLabel = metric => metric.name + (metric.contextLabel ? " · " + metric.contextLabel : "");
  const line = (x1, y1, x2, y2, attrs = "") => `<line x1="${F(x1, 3).replace(/,/g, "")}" y1="${y1}" x2="${F(x2, 3).replace(/,/g, "")}" y2="${y2}" stroke="${theme().grid}" ${attrs}/>`;
  const text = (x, y, value, attrs = "") => `<text x="${x}" y="${y}" fill="${theme().ink}"${/font-size=/.test(attrs) ? "" : ' font-size="12"'} ${attrs}>${E(value)}</text>`;
  const words = (value, width = 6) => { const chars = Array.from(String(value || "")); return chunks(chars, width).map(group => group.join("")); };
  const lines = (x, y, values, attrs = "", step = 15) => `<text x="${x}" y="${y}" fill="${theme().ink}"${/font-size=/.test(attrs) ? "" : ' font-size="12"'} ${attrs}>${values.map((value, i) => `<tspan x="${x}" dy="${i ? step : 0}">${E(value)}</tspan>`).join("")}</text>`;
  const svg = (width, height, title, content, description = title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${E(title)}" data-pixel-layout="true" style="font-family:Segoe UI,Microsoft YaHei,sans-serif;--team-chart-width:${width}px"><desc>${E(description)}</desc>${content}</svg>`;
  const hit = (content, tooltip, attrs = "") => `<g class="team-chart-hit" tabindex="0" data-team-tooltip="${E(tooltip)}" aria-label="${E(tooltip)}" ${attrs}>${content}</g>`;
  function range(values, zero = false) {
    const finite = values.map(N).filter(value => value !== null);
    let min = finite.length ? Math.min(...finite) : 0, max = finite.length ? Math.max(...finite) : 1;
    if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
    if (min === max) { const padding = Math.max(Math.abs(min) * .1, 1); min -= zero && min === 0 ? 0 : padding; max += padding; }
    const padding = (max - min) * .08;
    return {min: min < 0 || !zero ? min - padding : 0, max: max > 0 || !zero ? max + padding : 0};
  }
  function yGrid(width, top, bottom, extent, unit, integer = false) {
    const left = 62, right = width - 20, y = value => bottom - (value - extent.min) / (extent.max - extent.min) * (bottom - top);
    let out = text(left, 17, unit || "无单位", 'font-size="11"');
    const ticks = [...new Set(Array.from({length:5},(_,i) => { const value=extent.min+(extent.max-extent.min)*i/4;return integer ? Math.round(value) : value; }))];
    for (const value of ticks) { const py = y(value); out += line(left, py, right, py) + text(left - 9, py + 4, F(value), 'text-anchor="end" font-size="10"'); }
    if (extent.min <= 0 && extent.max >= 0) out += line(left, y(0), right, y(0), 'stroke-width="1.2"');
    return {left, right, y, out};
  }
  function rankChart(data, {width = 720, print = false, entries = data.entries, allEntries = data.entries} = {}) {
    const column = data.kind === "column", slotWidth = print ? 62 : 64, w = print ? width : Math.max(width, 82 + entries.length * slotWidth),
      labels = entries.map(entry => words(entry.name || entry.label || entry.athleteId, print ? 5 : 6)),
      labelHeight = Math.max(1, ...labels.map(value => value.length)) * 15, top = 35, bottom = 252, h = bottom + 50 + labelHeight,
      grid = yGrid(w, top, bottom, range(allEntries.map(entry => entry.value), column), data.metric.unit), slot = (grid.right - grid.left) / Math.max(1, entries.length);
    let out = grid.out;
    entries.forEach((entry, index) => {
      const x = grid.left + slot * (index + .5), py = grid.y(entry.value), value = F(entry.value, precision(data.metric)),
        tooltip = [entry.name || entry.label, `${data.metric.name} ${value}${data.metric.unit ? " " + data.metric.unit : ""}`, entry.rank != null ? `第 ${entry.rank} 名` : "", entry.date || ""].filter(Boolean).join(" · "),
        shape = column ? `<rect x="${x - Math.min(36, slot * .6) / 2}" y="${Math.min(py, grid.y(0))}" width="${Math.min(36, slot * .6)}" height="${Math.max(0, Math.abs(grid.y(0) - py))}" rx="2" fill="${theme().accent}" fill-opacity=".84"/>${entry.value === 0 ? line(x - 13, py, x + 13, py, `style="stroke:${theme().accent}" stroke-width="3"`) : ""}` : `<circle cx="${x}" cy="${py}" r="5" fill="${theme().accent}"/>`;
      out += hit(shape + text(x, entry.value < 0 && column ? py + 16 : py - 10, value, 'text-anchor="middle" font-size="11"'), tooltip, `role="button" data-team-person="${E(entry.athleteId)}"`);
      out += lines(x, bottom + 23, labels[index], 'text-anchor="middle" font-size="11"') + (entry.rank != null ? text(x, h - 9, `第 ${entry.rank} 名`, 'text-anchor="middle" font-size="10"') : "");
    });
    return svg(w, h, data.metric.name + " · " + (column ? "排名柱状图" : "排名点图"), out, "每位运动员一个代表结果，按该指标的成绩方向排序；缺测不作零值。");
  }
  function boxChart(data, width = 720) {
    const w = Math.max(290, width), left = 62, right = w - 24, top = 48, bottom = 220, extent = range(data.entries.map(entry => entry.value)),
      x = value => left + (value - extent.min) / (extent.max - extent.min) * (right - left), stat = data.statistics || {}, cy = 105;
    let out = text(left, 23, data.metric.unit || "无单位", 'font-size="11"');
    for (let i = 0; i <= 4; i++) { const value = extent.min + (extent.max - extent.min) * i / 4, px = x(value); out += line(px, top, px, bottom) + text(px, bottom + 23, F(value), 'text-anchor="middle" font-size="10"'); }
    if (data.n >= 3 && stat.boxAvailable !== false && [stat.q1, stat.median, stat.q3, stat.lowerWhisker, stat.upperWhisker].every(value => N(value) !== null)) {
      out += line(x(stat.lowerWhisker), cy, x(stat.upperWhisker), cy, `style="stroke:${theme().accent}" stroke-width="2"`) +
        line(x(stat.lowerWhisker), cy - 17, x(stat.lowerWhisker), cy + 17, `style="stroke:${theme().accent}" stroke-width="2"`) + line(x(stat.upperWhisker), cy - 17, x(stat.upperWhisker), cy + 17, `style="stroke:${theme().accent}" stroke-width="2"`) +
        `<rect x="${x(stat.q1)}" y="${cy - 25}" width="${Math.max(1, x(stat.q3) - x(stat.q1))}" height="50" fill="${theme().accent}" fill-opacity=".15" stroke="${theme().accent}"/>` +
        line(x(stat.median), cy - 25, x(stat.median), cy + 25, `style="stroke:${theme().accent}" stroke-width="2.5"`);
      out += text(x(stat.median), cy - 36, "中位数 " + F(stat.median, precision(data.metric)), 'text-anchor="middle" font-size="11"');
    } else out += text((left + right) / 2, cy, "少于 3 人，显示个人结果", 'text-anchor="middle" font-size="12"');
    const lanes = new Map();
    data.entries.forEach(entry => {
      const bucket = Math.round(x(entry.value) / 12), lane = lanes.get(bucket) || 0; lanes.set(bucket, lane + 1);
      const py = 175 + ((lane % 7) - 3) * 7;
      const same = data.entries.filter(other => other.value === entry.value);
      out += hit(`<circle cx="${x(entry.value)}" cy="${py}" r="4.5" fill="${theme().accent}" fill-opacity=".78" stroke="white" stroke-width="1"/>`, `${entry.name} · ${data.metric.name} ${F(entry.value, precision(data.metric))} ${data.metric.unit || ""}${same.length > 1 ? `\n同值 ${same.length} 人：` + same.map(person=>person.name).join("、") : ""}`, `role="button" data-team-person="${E(entry.athleteId)}"`);
    });
    return svg(w, 263, data.metric.name + " · 箱线分布图", out, "每个点代表一名运动员。箱体为第一至第三四分位数，中线为中位数；须限于四分位距 1.5 倍范围内的实测值，所有个人点均保留。");
  }
  function histogramChart(data, width = 720) {
    const category = data.kind === "distribution", bins = data.bins || [], w = Math.max(width, category ? bins.length * 86 + 82 : 0),
      labels = bins.map(bin => category ? words(bin.label ?? bin.value, 6) : [binValue(bin.from,data),"– " + binValue(bin.to,data)]),
      labelHeight = Math.max(1, ...labels.map(parts => parts.length)) * 15, top = 32, bottom = 242, left = 62, right = w - 20,
      max = Math.max(1, ...bins.map(bin => bin.count)), y = value => bottom - value / max * (bottom - top), slot = (right - left) / Math.max(1, bins.length);
    let out = text(left, 17, "人数", 'font-size="11"');
    [...new Set(Array.from({length: 5}, (_, index) => Math.round(max * index / 4)))].forEach(value => { out += line(left, y(value), right, y(value)) + text(left - 9, y(value) + 4, value, 'text-anchor="end" font-size="10"'); });
    bins.forEach((bin, index) => {
      const bx = left + index * slot, label = category ? String(bin.label ?? bin.value) : `${binValue(bin.from,data)} ≤ 结果 ${bin.lastInclusive ? "≤" : "<"} ${binValue(bin.to,data)}`,
        members = (bin.members || []).map(member => typeof member === "string" ? member : member.name || member.label || member.athleteId), tooltip = `${label} · ${bin.count} 人${members.length ? "\n" + members.join("、") : ""}`;
      out += hit(`<rect x="${bx + (category ? slot * .16 : 1)}" y="${y(bin.count)}" width="${Math.max(1, slot * (category ? .68 : 1) - (category ? 0 : 2))}" height="${bottom - y(bin.count)}" fill="${theme().accent}" fill-opacity=".82"/>` + text(bx + slot / 2, y(bin.count) - 9, bin.count, 'text-anchor="middle" font-size="11"'), tooltip, `role="button" data-team-bin="${index}"`);
      out += lines(bx + slot / 2, bottom + 23, labels[index], 'text-anchor="middle" font-size="10"');
    });
    out += text((left + right) / 2, bottom + 35 + labelHeight, category ? data.metric.name : data.metric.name + (data.metric.unit ? " · " + data.metric.unit : ""), 'text-anchor="middle" font-size="11"');
    return svg(w, bottom + 49 + labelHeight, data.metric.name + (category ? " · 人数分布" : " · 直方图"), out);
  }
  function chartHTML(data, options = {}) {
    if (!data?.metric) return '<p class="team-empty">暂无可显示的指标。</p>';
    if (!data.n) return '<p class="team-empty">该指标暂无有效结果。</p>';
    const width = options.width || (options.print ? 680 : 720), ranked = ["column", "dot"].includes(data.kind), groups = options.print && ranked ? chunks(data.entries, 9) : [data.entries];
    return groups.map((entries, index) => `<div class="team-chart-panel" data-pdf-atomic>${groups.length > 1 ? `<p class="team-chart-continuation">${E(data.metric.name)} · ${index * 9 + 1}–${index * 9 + entries.length} / ${data.n} 人</p>` : ""}${ranked ? rankChart(data, {...options, width, entries}) : data.kind === "box" ? boxChart(data, width) : histogramChart(data, width)}</div>`).join("");
  }
  function comparisonLegend(series) {
    return `<div class="team-radar-legend team-comparison-legend">${series.map(item => `<span><i style="background:${item.color}"></i>${E(item.label)}${item.n == null ? "" : ` · ${item.n} 人`}</span>`).join("")}</div>`;
  }
  function groupedChart(data, {width, print, categories, series, extent}) {
    const column = data.kind !== "dot", mean = data.ordering === "mean", slotWidth = mean ? series.length * 100 : Math.max(86, series.length * 48 + 20), w = print ? width : Math.max(width,82 + categories.length * slotWidth), bottom = 252,
      grid = yGrid(w,35,bottom,extent,data.counts ? "人数" : data.metric.unit,!!data.counts), slot = (grid.right - grid.left) / Math.max(1,categories.length), inner = mean ? slot / Math.max(1,series.length) : Math.min(slot * .8,series.length * 36) / Math.max(1,series.length),
      names = data.ordering === "descending-value" || mean, nameWidth = mean ? Math.max(3,Math.min(24,Math.floor(inner / 10) - 1)) : 3,
      nameParts = value => mean && /^\d{4}-\d{2}-\d{2}$/.test(value) && inner >= 64 ? [value] : words(value,nameWidth),
      nameLines = names ? series.flatMap(item => categories.map(category => nameParts(item.cells[category.index]?.name || (mean ? item.label : "")))) : [],
      nameHeight = Math.max(0,...nameLines.map(parts => parts.length)) * 15,
      categoryHeight = Math.max(1,...categories.map(category => words(category.label,10).length)) * 15;
    let out = grid.out;
    categories.forEach((category,index) => {
      series.forEach((item,seriesIndex) => {
        const cell = item.cells[category.index], value = N(cell?.value), x = grid.left + slot * (index + .5) + inner * (seriesIndex - (series.length - 1) / 2), attrs = `data-team-member-series="${E(item.id)}" data-team-member-category="${E(category.id)}"`;
        if (value === null) { out += `<g ${attrs} data-team-missing-slot>${text(x,bottom - 10,"—",'text-anchor="middle" font-size="11"')}</g>`; return; }
        const py = grid.y(value), size = Math.min(32,inner * .9), formatted = F(value,data.counts ? 0 : precision(data.metric)),
          grade = cell.assessment && ["red","amber","green"].includes(cell.assessment.status) ? cell.assessment.label || root.RingsideResultDisplay.trafficLabel(cell.assessment.status) : "",
          tooltip = [item.label,cell.name || category.label,`${data.metric.name} ${formatted}${data.counts ? " 人" : data.metric.unit ? " " + data.metric.unit : ""}`,cell.pain ? "疼痛记录：预警" : grade,cell.tooltip || ""].filter(Boolean).join(" · "),
          shape = column ? `<rect x="${x-size/2}" y="${Math.min(py,grid.y(0))}" width="${size}" height="${Math.abs(grid.y(0)-py)}" rx="2" fill="${item.color}" fill-opacity=".84"/>${value === 0 ? line(x-size/2,py,x+size/2,py,`style="stroke:${item.color}" stroke-width="3"`) : ""}` : `<circle cx="${x}" cy="${py}" r="5" fill="${item.color}"/>`;
        out += hit(shape + text(x,value < 0 && column ? py + 16 : py - 10,formatted,'text-anchor="middle" font-size="11"'),tooltip,`${attrs} data-team-member-value="${value}" data-team-member-name="${E(cell.name || "")}"`);
        if (names) out += lines(x,bottom+23,nameParts(cell.name || item.label),'text-anchor="middle" font-size="10"');
      });
      if (data.ordering !== "mean") out += lines(grid.left+slot*(index+.5),bottom+23+nameHeight,words(category.label,10),'text-anchor="middle" font-size="11"');
    });
    return svg(w,bottom+38+nameHeight+(data.ordering === "mean" ? 0 : categoryHeight),data.metric.name + (column ? " · 分组柱状图" : " · 分组点图"),out,"同色表示同一日期或比较对象。缺测保留空位，不作零值；数值名次不表示成绩好坏。");
  }
  function comparisonBoxes(data, {width, series, extent}) {
    const left = 62, right = width - 24, top = 36, bottom = 50 + series.length * 84,
      x = value => left + (value-extent.min)/(extent.max-extent.min)*(right-left);
    let out = text(left,17,data.metric.unit || "无单位",'font-size="11"');
    for (let i=0;i<=4;i++) { const value=extent.min+(extent.max-extent.min)*i/4,px=x(value); out+=line(px,top,px,bottom)+text(px,bottom+23,F(value),'text-anchor="middle" font-size="10"'); }
    series.forEach((item,index) => {
      const cy=70+index*84, stat=item.statistics || {}, entries=item.cells.filter(cell=>N(cell?.value)!==null), color=item.color;
      out+=text(left,cy-15,item.label + ` · ${entries.length} 人`,'font-size="11"');
      if (entries.length >= 3 && stat.boxAvailable && [stat.q1,stat.median,stat.q3,stat.lowerWhisker,stat.upperWhisker].every(value=>N(value)!==null)) {
        out+=line(x(stat.lowerWhisker),cy+5,x(stat.upperWhisker),cy+5,`style="stroke:${color}" stroke-width="2"`)+line(x(stat.lowerWhisker),cy-7,x(stat.lowerWhisker),cy+17,`style="stroke:${color}" stroke-width="2"`)+line(x(stat.upperWhisker),cy-7,x(stat.upperWhisker),cy+17,`style="stroke:${color}" stroke-width="2"`)+`<rect data-team-box="${E(item.id)}" x="${x(stat.q1)}" y="${cy-12}" width="${Math.max(1,x(stat.q3)-x(stat.q1))}" height="34" fill="${color}" fill-opacity=".15" stroke="${color}"/>`+line(x(stat.median),cy-12,x(stat.median),cy+22,`style="stroke:${color}" stroke-width="2.5"`);
      } else out+=text(right,cy-15,entries.length ? "少于 3 人，显示个人结果" : "暂无有效结果",'text-anchor="end" font-size="10"');
      const lanes=new Map();
      entries.forEach(cell=>{const bucket=Math.round(x(cell.value)/12),lane=lanes.get(bucket)||0;lanes.set(bucket,lane+1);out+=hit(`<circle cx="${x(cell.value)}" cy="${cy+37+(lane%5-2)*4}" r="4" fill="${color}" fill-opacity=".78" stroke="white"/>`,`${item.label} · ${cell.name} · ${F(cell.value,precision(data.metric))} ${data.metric.unit || ""}`,`data-team-box-member="${E(cell.athleteId)}" data-team-member-series="${E(item.id)}"`);});
    });
    return svg(width,bottom+42,data.metric.name+" · 箱线分布图",out,"箱体为成员结果的第一至第三四分位数，中线为中位数；少于三人仅显示真实成员点。");
  }
  function comparisonChartHTML(input, {width = 720, print = false} = {}) {
    if (!input.series.some(item=>item.cells.some(cell=>N(cell?.value)!==null))) return '<p class="team-empty">所选指标暂无有效结果。</p>';
    let data = input;
    if (data.kind === "histogram") {
      const bins=root.RingsideTeam.histogram(data.series.flatMap((item,seriesIndex)=>item.cells.filter(cell=>N(cell?.value)!==null).map(cell=>({...cell,seriesIndex})))), binData={metric:data.metric,bins};
      data={...data,kind:"column",counts:true,ordering:"distribution",categories:bins.map((bin,index)=>({id:"bin-"+index,label:binValue(bin.from,binData)+" – "+binValue(bin.to,binData)})),series:data.series.map((item,seriesIndex)=>({...item,cells:bins.map(bin=>{const members=bin.members.filter(cell=>cell.seriesIndex===seriesIndex);return {value:members.length,tooltip:members.map(cell=>cell.name).join("、")};})}))};
    }
    const allValues=data.series.flatMap(item=>item.cells.map(cell=>N(cell?.value))).filter(value=>value!==null), extent=data.counts ? {min:0,max:Math.max(1,...allValues)} : range(allValues,data.kind!=="box" && data.kind!=="dot"),
      seriesGroups=print ? chunks(data.series,data.kind==="box" ? 5 : data.ordering==="mean" ? Math.max(1,Math.floor((width-82)/86)) : 10) : [data.series];
    return seriesGroups.flatMap(series=>{
      const categories=data.categories.map((category,index)=>({...category,index})), capacity=Math.max(1,Math.floor((width-82)/Math.max(86,series.length*48+20))), categoryGroups=print && data.kind!=="box" ? chunks(categories,capacity) : [categories];
      return categoryGroups.map(group=>{
        const objectRange=data.kind==="box" || data.ordering==="mean", start=objectRange ? data.series.findIndex(item=>item.id===series[0].id) : group[0]?.index || 0, count=objectRange ? series.length : group.length,
          label=objectRange ? "对象" : data.ordering==="descending-value" ? "数值名次" : data.ordering==="distribution" ? data.metric.meaning==="category" ? "类别" : "区间" : "成员",
          continuation=print && (seriesGroups.length>1 || categoryGroups.length>1) ? `<p class="team-chart-continuation">${E(data.metric.name)} · ${label} ${start+1}–${start+count} / ${objectRange ? data.series.length : categories.length}</p>` : "";
        return `<div class="team-chart-panel" data-pdf-atomic>${continuation}${comparisonLegend(series)}${data.kind==="box" ? comparisonBoxes(data,{width,series,extent}) : groupedChart(data,{width,print,categories:group,series,extent})}</div>`;
      });
    }).join("");
  }
  function radarHTML(axes, series, {risk = false, total = 0} = {}) {
    if (!axes.length) return '<p class="team-empty">暂无可评价的维度。</p>';
    const w = 460, h = 378, cx = w / 2, cy = 180, radius = 112, upper = risk ? Math.max(1, total, ...axes.map(axis => axis.flaggedCount || 0)) : 100,
      at = (index, r) => [cx + r * Math.cos(-Math.PI / 2 + index * 2 * Math.PI / axes.length), cy + r * Math.sin(-Math.PI / 2 + index * 2 * Math.PI / axes.length)], pointsText = points => points.map(point => point.join(",")).join(" ");
    let out = "";
    const ticks = risk ? [...new Set(Array.from({length: 5}, (_, i) => Math.max(1, Math.round(upper * (i + 1) / 5))))] : [20, 40, 60, 80, 100];
    ticks.forEach(value => { const points = axes.map((_, index) => at(index, radius * value / upper)); out += axes.length >= 3 ? `<polygon points="${pointsText(points)}" fill="none" stroke="${theme().grid}"/>` : `<circle cx="${cx}" cy="${cy}" r="${radius * value / upper}" fill="none" stroke="${theme().grid}"/>`; out += text(cx + 4, cy - radius * value / upper + 12, value, 'font-size="9"'); });
    axes.forEach((axis, index) => { const end = at(index, radius); out += line(cx, cy, ...end); });
    series.forEach((item, seriesIndex) => {
      const color = item.color || (seriesIndex === 0 ? theme().accent : theme().persons8[(seriesIndex + 1) % theme().persons8.length]), points = axes.map((_, index) => N(item.values?.[index]) === null ? null : at(index, radius * Math.max(0, Math.min(upper, item.values[index])) / upper));
      if (axes.length >= 3 && points.every(Boolean)) out += `<polygon data-team-radar-series="${E(item.id)}" points="${pointsText(points)}" fill="${color}" fill-opacity="${seriesIndex ? .025 : .09}" stroke="${color}" stroke-width="${seriesIndex ? 1.8 : 2.5}"/>`;
      else points.forEach((point, index) => { const next = points[(index + 1) % points.length]; if (point && next && axes.length > 2) out += line(...point, ...next, `style="stroke:${color}" stroke-width="2" data-team-radar-series="${E(item.id)}"`); });
      points.forEach((point, index) => {
        if (!point) return;
        const axis = axes[index], tip = risk ? riskTooltip(axis) : `${item.label} · ${axis.label} ${F(item.values[index], 1)} 分${item.id === "team" ? ` · ${axis.n || 0}/${axis.total ?? total} 人` : ""}`;
        out += hit(`<circle cx="${point[0]}" cy="${point[1]}" r="4" fill="${color}" stroke="white" stroke-width="1.3"/>`, tip, risk ? `role="button" data-team-risk="${E(axis.id || axis.key)}"` : "");
      });
    });
    axes.forEach((axis, index) => {
      const point = at(index, radius + 30), anchor = point[0] < cx - 16 ? "end" : point[0] > cx + 16 ? "start" : "middle", labelParts = words(axis.label, 6), labelY = point[1] - (labelParts.length - 1) * 8,
        value = risk ? axis.assessedCount ? `${axis.flaggedCount || 0} 人 · 已评 ${axis.assessedCount}` : `未评价 · 已测 ${axis.measuredCount || 0}` : `${F(axis.value, 1)} 分 · ${axis.n || 0}/${axis.total ?? total} 人`,
        label = lines(point[0], labelY, labelParts, `text-anchor="${anchor}" font-size="12" font-weight="600"`) + text(point[0], labelY + labelParts.length * 15 + 2, value, `text-anchor="${anchor}" font-size="10"`);
      out += risk ? hit(label, riskTooltip(axis), `role="button" data-team-risk="${E(axis.id || axis.key)}"`) : label;
    });
    return svg(w, h, risk ? "各部位需关注人数" : "团队运动表现概览", out, risk ? "人数为预警与关注的去重人数。点击部位查看具体名单。" : "团队平均为各维度有效个人评分的算术平均，缺失不补零。") + (!risk ? `<div class="team-radar-legend">${series.map((item, index) => `<span><i style="background:${item.color || (index ? theme().persons8[(index + 1) % theme().persons8.length] : theme().accent)}"></i>${E(item.label)}</span>`).join("")}</div>` : "");
  }
  function riskTooltip(region) {
    const names = (region.members || []).map(member => `${member.name}${member.status === "red" ? "（预警）" : "（关注）"}`).join("、");
    return region.assessedCount ? `${region.label} · 需关注 ${region.flaggedCount || 0} 人（预警 ${region.redCount || 0}、关注 ${region.amberCount || 0}）\n已测 ${region.measuredCount || 0} 人 · 已评价 ${region.assessedCount} 人${names ? "\n" + names : "\n暂无需关注人员"}` : `${region.label} · 尚无可评价结果\n已测 ${region.measuredCount || 0} 人`;
  }
  function evidenceText(test) {
    if(typeof test==="string")return test;
    const side=test.sideLabel||({L:"左侧",R:"右侧",C:"中线",left:"左侧",right:"右侧"}[test.side])||test.side||"",
      title=[test.testName&&test.testName!==test.name?test.testName:"",test.name||test.title||test.label||"测试",side].filter(Boolean).join(" · "),
      facts=[test.missing?"未测":N(test.value)!==null?F(test.value)+(test.unit?" "+test.unit:""):"",N(test.target)!==null?"参考目标 "+F(test.target)+(test.unit?" "+test.unit:""):"",N(test.asym)!==null?"双侧差异 "+F(test.asym,1)+"%":"",test.pain?"疼痛":"",test.reason||test.detail||"",...(Array.isArray(test.reasons)?test.reasons:[]),...(Array.isArray(test.notes)?test.notes:[test.notes||""])].filter(Boolean).map(String);
    return title+([...new Set(facts)].length?"："+[...new Set(facts)].join(" · "):"");
  }
  function memberHTML(member) {
    const sideLabel = side => ({left:"左侧", right:"右侧", L:"左侧", R:"右侧", bilateral:"双侧"}[side] || side), sides = Array.isArray(member.sides) ? member.sides.map(sideLabel).join("、") : member.sides || "",
      tests = [...new Set((member.tests || []).map(evidenceText).filter(Boolean))].join("；");
    return `<li><strong>${E(member.name || member.athleteId)}</strong><span class="pill ${member.status === "red" ? "red" : "amber"}">${member.status === "red" ? "预警" : "关注"}</span>${sides ? `<span>${E(sides)}</span>` : ""}${tests ? `<small>${E(tests)}</small>` : ""}</li>`;
  }
  function riskLists(risk, print = false) {
    const regions = risk?.regions || [], unlocalized = risk?.unlocalized || [], content = regions.map(region => `<section data-team-risk-region="${E(region.id || region.key)}"><h4 tabindex="-1">${E(region.label)} <small>${region.assessedCount ? `${region.flaggedCount || 0} 人 · 已测 ${region.measuredCount || 0} 人 · 已评价 ${region.assessedCount} 人` : `未评价 · 已测 ${region.measuredCount || 0} 人`}</small></h4>${region.members?.length ? `<ul>${region.members.map(memberHTML).join("")}</ul>` : `<p class="note">${region.assessedCount ? "暂无需关注人员。" : "尚无可评价结果。"}</p>`}</section>`).join("") +
      (unlocalized.length ? `<section class="team-unlocalized"><h4>未定位到具体部位的筛查提示</h4><ul>${unlocalized.map(memberHTML).join("")}</ul></section>` : "");
    return print ? `<div class="team-risk-lists team-risk-print"><h4>筛查名单</h4>${content}</div>` : `<details class="team-risk-lists" data-team-risk-lists><summary>查看各部位名单</summary>${content}</details>`;
  }
  function overviewHTML(model, views, print) {
    const overview = model.overview || {}, axes = overview.axes || [], allowed = new Set((views.overviewAthleteIds || []).slice(0, 3)),
      series = (overview.series || []).filter(series => series.id === "team" || allowed.has(series.id)), people = model.participants || [],
      controls = print ? "" : `<details class="team-overlay-control no-print"><summary>叠加个人${allowed.size ? `（${allowed.size}/3）` : ""}</summary><input type="search" data-team-overlay-search placeholder="搜索队员姓名" aria-label="搜索叠加队员"><div>${people.map(person => `<label><input type="checkbox" data-team-overlay="${E(personId(person))}"${allowed.has(personId(person)) ? " checked" : ""}${allowed.size >= 3 && !allowed.has(personId(person)) ? " disabled" : ""}><span>${E(personName(person))}</span></label>`).join("")}</div><p class="note">最多选择 3 人，与团队平均共同显示。</p></details>`;
    const valid = axes.filter(axis => axis.n > 0 && N(axis.value) !== null);
    if (valid.length < 3) return controls + (valid.length ? `<div class="team-overview-values"><p class="note">有效维度不足 3 项，显示已有评分。</p>${valid.map(axis => `<div><strong>${E(axis.label)}</strong><span>${F(axis.value,1)} 分</span><small>${axis.n}/${axis.total ?? people.length} 人</small></div>`).join("")}</div>` : '<p class="team-empty">暂无可用于团队概览的评分。</p>');
    return controls + `<div class="team-radar">${radarHTML(axes, series, {total: people.length})}</div>`;
  }
  function cellHTML(cell, metric) {
    if (!cell || cell.value === null || cell.value === undefined || cell.value === "") return '<span class="team-missing">—</span>';
    const value = metricMeaning(metric) === "numeric" || metricMeaning(metric) === "ordinal" ? F(cell.value, precision(metric)) : E(cell.value),
      grade = cell.evaluation?.grade, date = cell.date || "", notes = Array.isArray(cell.notes) ? cell.notes.filter(Boolean).join("；") : cell.notes || "";
    return `<strong>${value}</strong>${grade?.label && ["red","amber","green"].includes(grade.status) ? `<span class="pill ${grade.status}">${E(grade.label)}</span>` : ""}${cell.pain ? '<small class="team-pain">疼痛</small>' : ""}${notes ? `<small>${E(notes)}</small>` : ""}${cell.sourceDate && cell.sourceDate !== date ? `<small>${E(cell.sourceDate)}</small>` : ""}`;
  }
  function tableHTML(project, model, data, {print = false} = {}) {
    const people = model.participants || [], byPerson = new Map(people.map((person, index) => [personId(person), {person, index}])),
      entries = [...(data.entries || []), ...(data.missing || [])], ordered = [], seen = new Set();
    entries.forEach(entry => { const id = personId(entry); if (byPerson.has(id) && !seen.has(id)) { ordered.push({...byPerson.get(id), rank:entry.rank ?? null}); seen.add(id); } });
    people.forEach((person, index) => { if (!seen.has(personId(person))) ordered.push({person, index, rank:null}); });
    const metrics = project.metrics || [], groups = print ? chunks(metrics, 4) : [metrics];
    return groups.map((group, index) => `<div class="team-table-wrap"><table class="team-results"${print ? "" : ` style="min-width:${210 + group.length * 135}px"}`}><caption>${E(project.name)} · 全部指标${groups.length > 1 ? `（${index + 1}/${groups.length}）` : ""}</caption><colgroup><col class="team-name-column"><col class="team-rank-column">${group.map(() => '<col class="team-metric-column">').join("")}</colgroup><thead><tr><th scope="col">运动员</th><th scope="col">名次</th>${group.map(metric => `<th scope="col"${metric.id === data.metric?.id ? ' class="team-selected-metric"' : ""}>${E(metric.name)}${metric.unit ? `<small>${E(metric.unit)}</small>` : ""}${metric.contextLabel ? `<small>${E(metric.contextLabel)}</small>` : ""}</th>`).join("")}</tr></thead><tbody>${ordered.map(({person,index:personIndex,rank}) => `<tr data-team-row="${E(personId(person))}"><th scope="row"><span>${E(personName(person))}</span><small>${E(person.date || "未选择测试记录")}</small></th><td>${rank === null ? "—" : rank}</td>${group.map(metric => `<td${metric.id === data.metric?.id ? ' class="team-selected-metric"' : ""}>${cellHTML(metric.cells?.[personIndex], metric)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("");
  }
  function projectHTML(project, model, views, {print = false} = {}) {
    const saved = views.charts?.[project.id] || {}, data = root.RingsideTeam.chart(model, project.id, saved), metric = data.metric,
      kind = saved.kind || "column", metricOptions = (project.metrics || []).map(row => `<option value="${E(row.id)}"${row.id === metric?.id ? " selected" : ""}>${E(metricLabel(row))}${row.unit ? " · " + E(row.unit) : ""}</option>`).join(""),
      controls = print ? "" : `<div class="team-chart-controls no-print"><label>指标<select data-team-metric="${E(project.id)}" aria-label="${E(project.name)}图表指标">${metricOptions}</select></label><label>图形<select data-team-kind="${E(project.id)}" aria-label="${E(project.name)}图形"${data.kind === "distribution" ? " disabled" : ""}>${data.kind === "distribution" ? '<option value="distribution">人数分布</option>' : kinds.map(([value,label]) => `<option value="${value}"${value === (metricMeaning(metric || {}) === "ordinal" ? data.kind : kind) ? " selected" : ""}${metricMeaning(metric || {}) === "ordinal" && ["box","histogram"].includes(value) ? " disabled" : ""}>${label}</option>`).join("")}</select></label></div>`,
      caption = metric ? `${metric.name}${metric.unit ? " · " + metric.unit : ""} · ${data.n}/${data.total} 人${data.kind === "distribution" ? " · 人数分布" : data.rankable ? "" : " · 按数值排列"}` : "暂无指标";
    return `<article class="test-block team-test" data-team-project="${E(project.id)}"><div class="test-title"><h4>${E(project.name)}</h4></div>${controls}<p class="team-chart-caption${print ? " longitudinal-chart-title" : ""}">${E(caption)}</p><div class="team-chart-scroll" data-team-chart="${E(project.id)}">${chartHTML(data,{print})}</div>${print ? "" : '<section class="team-chart-inspector no-print" data-team-inspector hidden aria-live="polite"></section>'}${data.note ? `<p class="note team-chart-note">${E(data.note)}</p>` : ""}${tableHTML(project, model, data, {print})}</article>`;
  }
  function detailsHTML(model, views, print = false) {
    const projects = model.projects || [], sections = [["screen", "损伤风险筛查"], ["performance", "运动表现测试"]];
    let html = sections.map(([category, label]) => { const selected = projects.filter(project => category === "screen" ? project.category === "screen" : project.category !== "screen"); return selected.length ? `<details class="details-group team-details" id="team-${category}" open><summary>${label}</summary><div class="quality-group">${selected.map(project => projectHTML(project,model,views,{print})).join("")}</div></details>` : ""; }).join("");
    const cards = model.capability?.cards || [];
    if (cards.length) html += `<details class="details-group team-details" id="team-capability" open><summary>能力结构分析</summary><div class="quality-group">${cards.filter(card => card.metrics?.length).map(card => projectHTML({...card,id:card.projectId || card.id,name:card.title || card.name},model,views,{print})).join("")}</div></details>`;
    return html || '<p class="team-empty">所选队员在本次范围内暂无测试结果。</p>';
  }
  function summaryCards(model, {label = ""} = {}) {
    const people = model.participants || model.people || [], risk = model.risk || {}, regions = risk.regions || [],
      total = model.summary?.total ?? people.length, assessed = N(risk.assessedCount),
      countsAvailable = risk.countsAvailable !== false && assessed !== null && assessed > 0,
      flagged = risk.flaggedCount ?? new Set([...regions.flatMap(region => region.members || []), ...(risk.unlocalized || [])].map(person => person.athleteId)).size,
      candidates = regions.filter(region => region.assessedCount > 0 && region.flaggedCount > 0), most = Math.max(0, ...candidates.map(region => region.flaggedCount)),
      sites = candidates.filter(region => region.flaggedCount === most), axes = (model.overview?.axes || []).filter(axis => axis.n > 0 && N(axis.value) !== null),
      minimum = axes.length ? Math.min(...axes.map(axis => axis.value)) : null,
      weak = axes.filter(axis => Number(axis.value.toFixed(1)) === Number(minimum?.toFixed(1))), equal = axes.length > 1 && weak.length === axes.length;
    const siteValue = sites.length ? sites.map(region => region.label).join("、") : !countsAvailable ? "待评价" : risk.unlocalized?.length ? "暂无可定位部位" : "暂无关注部位",
      siteNote = sites.length ? sites.map(region => `${region.label} ${region.flaggedCount}/${region.assessedCount} 人需关注`).join("；") : risk.unlocalized?.length ? "存在未定位到具体部位的筛查提示" : countsAvailable ? "依据已评价的筛查结果" : "尚无可评价的部位结果",
      weakValue = !axes.length ? "待评价" : axes.length < 2 ? "暂无法比较" : equal ? "各能力得分一致" : weak.map(axis => axis.label).join("、"),
      weakNote = !axes.length ? "尚无可用于比较的能力评分" : axes.length < 2 ? "仅一项能力有有效评分" : equal ? `${F(minimum, 1)} 分 · 按各项有效评分计算` : weak.map(axis => `${axis.label} ${F(axis.value, 1)} 分 · ${axis.n}/${axis.total ?? total} 人`).join("；");
    return [
      {title:"报告人数", value:total, note:label || model.configuration?.teamName || model.groups?.find(group => group.id === model.configuration?.groupId)?.name || "已选报告成员"},
      {title:"筛查关注人数", value:countsAvailable ? flagged : "—", note:countsAvailable ? `已评价 ${assessed}/${total} 人` : "尚无可评价的筛查结果"},
      {title:"主要关注部位", value:siteValue, note:siteNote, text:true},
      {title:"相对薄弱能力", value:weakValue, note:weakNote, text:true}
    ];
  }
  function summaryHTML(model, options) {
    return summaryCards(model, options).map(card => `<article class="micro-card team-summary"><div class="micro-head"><h3>${E(card.title)}</h3></div><div class="micro-value${card.text ? " text" : ""}">${E(card.value)}</div><p>${E(card.note)}</p></article>`).join("");
  }
  function render(model, {views = {}, print = false} = {}) {
    if (["longitudinal", "horizontal"].includes(model.analysisMode)) return root.RingsideTeamComparisonView.render(model, {views, print});
    const people = model.participants || [], configuration = model.configuration || {}, risk = model.risk || {}, regions = risk.regions || [],
      summary = summaryHTML(model),
      riskRadar = radarHTML(regions, [{id:"risk",label:"需关注人数",values:regions.map(region => region.assessedCount ? region.flaggedCount : null)}], {risk:true,total:risk.total || people.length});
    return {controls:"", summary, body:`<div class="team-radar">${riskRadar}</div><p class="team-risk-key"><span><i class="dot red"></i>预警</span><span><i class="dot amber"></i>关注</span></p>`, screenItems:print ? "" : riskLists(risk), screenPill:"各部位需关注人数", overview:overviewHTML(model,views,print), referenceLabel:model.profile?.name || configuration.profileName || "团队平均评分", legend:"", details:(print ? riskLists(risk,true) : '<div class="team-report-tools no-print"><button type="button" class="btn small" data-team-refresh>更新已选记录数据</button></div>') + detailsHTML(model,views,print)};
  }
  function layout(container, {print = false} = {}) {
    if (!container) return;
    container.querySelectorAll(".team-chart-scroll").forEach(node => { node.style.overflowX = print ? "visible" : "auto"; });
    root.RingsideTeamComparisonView?.layout(container, {print});
  }
  function bind(container, model, views = {}, {updateViews = () => {}} = {}) {
    if (!container) return;
    container.__teamBinding?.abort();
    const abort = new AbortController(); container.__teamBinding = abort; const options = {signal:abort.signal};
    container.querySelector(".team-tooltip")?.remove();
    const tooltip = container.ownerDocument.createElement("div"); tooltip.className = "team-tooltip no-print"; tooltip.setAttribute("role","tooltip"); tooltip.hidden = true; container.append(tooltip);
    const show = (target, event) => { tooltip.textContent = target.dataset.teamTooltip || ""; tooltip.hidden = !tooltip.textContent; const box = target.getBoundingClientRect(), doc = container.ownerDocument.documentElement; tooltip.style.left = Math.max(8, Math.min((event?.clientX || box.left + box.width / 2) + 12, doc.clientWidth - Math.min(360, doc.clientWidth - 24) - 12)) + "px"; tooltip.style.top = Math.max(8, Math.min((event?.clientY || box.bottom) + 12, doc.clientHeight - tooltip.offsetHeight - 12)) + "px"; };
    const hide = () => { tooltip.hidden = true; };
    container.addEventListener("pointerover", event => { const target = event.target.closest("[data-team-tooltip]"); if (target) show(target,event); }, options);
    container.addEventListener("pointerout", event => { if (event.target.closest("[data-team-tooltip]")) hide(); }, options);
    container.addEventListener("focusin", event => { const target = event.target.closest("[data-team-tooltip]"); if (target) show(target); }, options);
    container.addEventListener("focusout", hide, options);
    const openRisk = key => { const lists = container.querySelector("[data-team-risk-lists]"); if (!lists) return; lists.open = true; const section = [...lists.querySelectorAll("[data-team-risk-region]")].find(node => node.dataset.teamRiskRegion === key); section?.querySelector("h4")?.focus({preventScroll:true}); section?.scrollIntoView({block:"nearest",behavior:"smooth"}); hide(); };
    const locatePerson = (project,id) => { project.querySelectorAll("[data-team-row]").forEach(row=>{row.classList.toggle("team-row-highlight",row.dataset.teamRow===id);}); const row=[...project.querySelectorAll("[data-team-row]")].find(row=>row.dataset.teamRow===id); if(row){row.tabIndex=-1;row.focus({preventScroll:true});row.scrollIntoView({block:"nearest",behavior:"smooth"});} };
    const inspect = target => {
      const project=target.closest("[data-team-project]"),panel=project?.querySelector("[data-team-inspector]"); if(!project||!panel)return;
      const data=root.RingsideTeam.chart(model,project.dataset.teamProject,views.charts?.[project.dataset.teamProject]||{}),bin=target.hasAttribute("data-team-bin")?data.bins?.[Number(target.dataset.teamBin)]:null,person=data.entries.find(entry=>entry.athleteId===target.dataset.teamPerson),members=bin?.members||(person?data.kind==="box"?data.entries.filter(entry=>entry.value===person.value):[person]:[]);
      const label=bin?data.kind==="distribution"?String(bin.label??bin.value):`${binValue(bin.from,data)} ≤ 结果 ${bin.lastInclusive?"≤":"<"} ${binValue(bin.to,data)}`:data.metric.name;
      panel.innerHTML=`<div class="team-inspector-head"><strong>${E(label)} · ${members.length} 人</strong><button type="button" class="text-btn" data-team-close-inspector>收起名单</button></div><ul>${members.map(member=>`<li><button type="button" class="text-btn" data-team-locate-person="${E(member.athleteId)}">${E(member.name||member.label||member.athleteId)}</button><span>${F(member.value,precision(data.metric))}${data.metric.unit?" "+E(data.metric.unit):""}</span></li>`).join("")}</ul>`;
      panel.hidden=false; hide(); panel.scrollIntoView({block:"nearest",behavior:"smooth"});
    };
    container.addEventListener("click", event => { const risk=event.target.closest("[data-team-risk]"),point=event.target.closest("[data-team-person],[data-team-bin]"),locate=event.target.closest("[data-team-locate-person]"),close=event.target.closest("[data-team-close-inspector]"); if(risk)openRisk(risk.dataset.teamRisk);else if(point)inspect(point);else if(locate)locatePerson(locate.closest("[data-team-project]"),locate.dataset.teamLocatePerson);else if(close)close.closest("[data-team-inspector]").hidden=true; }, options);
    container.addEventListener("keydown", event => { if(event.key==="Escape")hide(); const risk=event.target.closest("[data-team-risk]"),point=event.target.closest("[data-team-person],[data-team-bin]"); if((risk||point)&&["Enter"," "].includes(event.key)){event.preventDefault();if(risk)openRisk(risk.dataset.teamRisk);else inspect(point);} }, options);
    const filterOverlays = value => { const query=String(value||"").trim().toLocaleLowerCase();container.__teamOverlaySearch=value;container.querySelectorAll("[data-team-overlay]").forEach(input=>{input.closest("label").hidden=!input.closest("label").textContent.toLocaleLowerCase().includes(query);}); };
    const search=container.querySelector("[data-team-overlay-search]"),overlay=container.querySelector(".team-overlay-control");if(search){search.value=container.__teamOverlaySearch||"";filterOverlays(search.value);}if(overlay){if(container.__teamOverlayOpen)overlay.open=true;overlay.addEventListener("toggle",()=>{container.__teamOverlayOpen=overlay.open;},options);}
    container.addEventListener("input",event=>{if(event.target.matches("[data-team-overlay-search]"))filterOverlays(event.target.value);},options);
    container.addEventListener("change", event => {
      const input = event.target;
      if (input.matches("[data-team-presentation]")) updateViews({[input.dataset.teamPresentation]:input.value});
      if (input.matches("[data-team-kind],[data-team-metric],[data-team-data]")) { const projectId = input.dataset.teamKind || input.dataset.teamMetric || input.dataset.teamData, key = input.hasAttribute("data-team-kind") ? "kind" : input.hasAttribute("data-team-data") ? "data" : "metricId"; updateViews({charts:{...(views.charts || {}),[projectId]:{...(views.charts?.[projectId] || {}),[key]:input.value}}}); }
      if (input.matches("[data-team-overlay]")) { container.__teamOverlayOpen=true;const selected = [...container.querySelectorAll("[data-team-overlay]:checked")].map(node => node.dataset.teamOverlay).slice(0,3); updateViews({overviewAthleteIds:selected}); }
    }, options);
    container.__teamResizeObserver?.disconnect();
    if (model.analysisMode && typeof ResizeObserver !== "undefined") {
      let scheduled = false;
      const observer = new ResizeObserver(() => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; if (container.isConnected && !abort.signal.aborted) layout(container); }); });
      container.__teamResizeObserver = observer; observer.observe(container); abort.signal.addEventListener("abort", () => observer.disconnect(), {once:true});
    }
  }
  function preparePrint(container, model, views = {}) {
    const output = render(model,{views,print:true}); container.dataset.team = "true";
    for (const [id, key] of [["microCards","summary"],["bodyChart","body"],["screenItems","screenItems"],["radarChart","overview"]]) { const node = container.querySelector("#" + id); if (node) { node.innerHTML = output[key]; if (id === "microCards") node.classList.toggle("team-summary-multiple", !!node.querySelector(".team-summary-set")); } }
    const data = container.querySelector("#detailContent,#testDetails,[data-team-details]");
    if (data) data.innerHTML = output.details;
    else { const first = container.querySelector(".team-details"); if (first) { const parent = first.parentElement; parent.querySelectorAll(".team-details,.team-risk-print").forEach(node=>node.remove()); parent.insertAdjacentHTML("beforeend",output.details); } }
    container.querySelectorAll(".team-tooltip,.team-overlay-control,.team-chart-controls,.team-comparison-controls").forEach(node=>node.remove());
    layout(container,{print:true}); return output;
  }
  function prepareBrowserPrint(container, model, views = {}) {
    if (!container?.ownerDocument) return () => {};
    const clone = container.cloneNode(true); clone.removeAttribute("id"); clone.classList.add("team-browser-print"); preparePrint(clone,model,views); container.ownerDocument.body.append(clone); container.ownerDocument.body.classList.add("team-print-active");
    return () => { clone.remove(); container.ownerDocument.body.classList.remove("team-print-active"); };
  }
  root.RingsideTeamView = {render,layout,bind,preparePrint,prepareBrowserPrint,chartHTML,comparisonChartHTML,radarHTML,tableHTML,kinds,summaryCards,summaryHTML,cellHTML,riskLists};
})(typeof window !== "undefined" ? window : globalThis);
