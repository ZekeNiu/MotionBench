(function (global) {
  "use strict";
  const V = global.RingsideViz, M = global.RingsideModel;
  const C = V.C, FONT = "Segoe UI, Microsoft YaHei, Arial, sans-serif";
  const PALETTE = [C.blue, "#71849f", "#786aa8", "#a37e46", "#497e73", "#a36676", "#577e9e", "#73736c"];
  const DASHES = ["", "7 4", "2 4", "9 3 2 3", "5 3", "1 3"];
  const REGIONS = { neck: "颈部", trunk: "躯干", shoulder_r: "右肩", shoulder_l: "左肩", scapula_r: "右肩胛带", scapula_l: "左肩胛带", elbow_r: "右肘", elbow_l: "左肘", forearm_r: "右前臂", forearm_l: "左前臂", wrist_r: "右腕", wrist_l: "左腕", hip_r: "右髋", hip_l: "左髋", knee_r: "右膝", knee_l: "左膝", ankle_r: "右踝足", ankle_l: "左踝足" };
  const E = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const N = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  const F = (value, digits = 2) => {
    if (N(value) === null) return "—";
    if (value === 0) return "0";
    let precision = digits;
    if (digits > 0 && Math.abs(value) < 10 ** -digits) {
      precision = Math.max(digits, 2 - Math.floor(Math.log10(Math.abs(value))));
      if (precision > 12) return value.toExponential(2);
    }
    const rounded = Number(value.toFixed(precision));
    return (rounded === 0 ? 0 : rounded).toLocaleString("zh-CN", { maximumFractionDigits: precision, useGrouping: false });
  };
  const signed = value => N(value) === null ? "—" : (value > 0 ? "+" : "") + F(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const people = model => new Map((model.athletes || []).map(a => [a.id, a.name || a.profile?.name || "未命名队员"]));
  const nameOf = (model, id) => people(model).get(id) || id || "队员";
  const toneOf = (model, date) => PALETTE[Math.max(0, model.dates.indexOf(date)) % PALETTE.length];
  const dashOf = (model, date) => DASHES[Math.max(0, model.dates.indexOf(date)) % DASHES.length];
  const basisLabel = (key, value) => M.capabilityDirectionOptions[key]?.find(([id]) => id === value)?.[1] || (key === "endurance" ? "心肺与阈值表现" : value || "");
  const labelOf = (model, series) => nameOf(model, series.athleteId) + (model.dates.length > 1 ? " · " + series.date : "");
  const stamp = date => Date.parse(String(date) + "T00:00:00Z") / 86400000;
  const text = (x, y, value, attrs = "") => `<text x="${F(x)}" y="${F(y)}" font-family="${FONT}"${/\bfont-size\s*=/.test(attrs) ? "" : ' font-size="12"'}${/\bfill\s*=/.test(attrs) ? "" : ` fill="${C.muted}"`} ${attrs}>${E(value)}</text>`;
  const line = (x1, y1, x2, y2, attrs = "") => `<line x1="${F(x1)}" y1="${F(y1)}" x2="${F(x2)}" y2="${F(y2)}"${/\bstroke\s*=/.test(attrs) ? "" : ` stroke="${C.grid}"`} ${attrs}/>`;
  const poly = (points, attrs) => `<polyline points="${points.map(p => p.map(v => F(v)).join(",")).join(" ")}" fill="none" ${attrs}/>`;
  const svg = (w, h, title, markup, description = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${E(title)}"><desc>${E(description || title)}</desc>${markup}</svg>`;
  const point = (x, y, value, series, model, attrs = "", shape = "circle") => {
    const tone = toneOf(model, series.date), tip = labelOf(model, series) + " · " + value;
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
  function legend(model) {
    return `<div class="comparison-legend no-print" aria-label="测试日期图例">${model.dates.map(date => `<button type="button" class="comparison-legend-date" data-comparison-date-highlight="${E(date)}" aria-pressed="false"><i class="comparison-line-key comparison-line-pattern-${model.dates.indexOf(date) % DASHES.length}" style="--comparison-line-color:${toneOf(model, date)}"></i>${E(date)}</button>`).join("")}</div><div class="comparison-print-legend">${model.dates.map(date => `<span><i class="comparison-line-key comparison-line-pattern-${model.dates.indexOf(date) % DASHES.length}" style="--comparison-line-color:${toneOf(model, date)}"></i>${E(date)}</span>`).join("")}</div>`;
  }
  function curveChart(model, curve, layout = {}) {
    const w = layout.width || 700, h = layout.height || 330, series = (curve.series || []).filter(s => s.points?.length);
    if (!series.length) return `<p class="empty">${E(curve.reason || "暂无有效曲线")}</p>`;
    const all = series.flatMap(s => [...s.points, ...(s.rawPoints || [])]).filter(p => N(p.x) !== null && N(p.y) !== null);
    const grid = frame(w, h, range(all.map(p => p.x)), range(all.map(p => p.y)), { xLabel: curve.xLabel || curve.xUnit || "", yLabel: curve.yLabel || curve.unit || "" });
    let out = grid.out;
    series.forEach(s => {
      const points = s.points.filter(p => N(p.x) !== null && N(p.y) !== null).slice().sort((a,b) => a.x-b.x), dash = dashOf(model,s.date), tone = toneOf(model,s.date);
      if (!curve.noConnect) out += `<g class="comparison-series" data-date="${E(s.date)}">${poly(points.map(p => [grid.x(p.x),grid.y(p.y)]), `stroke="${tone}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""}`)}</g>`;
      const measured = curve.fitted && curve.testId === "sprint_fvp" ? [] : Array.isArray(s.rawPoints) ? s.rawPoints : s.points;
      measured.forEach(p => { if (N(p.x) !== null && N(p.y) !== null) out += point(grid.x(p.x), grid.y(p.y), `${F(p.x)} ${curve.xUnit || ""} · ${F(p.y)} ${curve.unit || ""}${p.derived ? " · 推算" : s.rawPoints?.length ? " · 实测" : ""}`, s, model, `data-comparison-x="${p.x}"`, p.derived ? "diamond" : "circle"); });
    });
    const protocol = typeof curve.protocol === "string" ? curve.protocol : model.entries.find(e => e.record?.enabled?.[curve.testId])?.record.protocol?.[curve.testId] || "";
    return svg(w,h,curve.title,out,curve.description || "各测试日期保留原始坐标、实测点与各期拟合曲线。") + legend(model) + (protocol ? `<p class="comparison-chart-caption">${E(protocol)}</p>` : "");
  }
  function metricChart(model, metric, kind = "column", layout = {}) {
    const horizontal = kind === "bar" || kind === "target", valid = metric.observations.filter(o => N(o.value) !== null), count = model.dates.length, w = layout.width || 700, h = layout.height || 330;
    if (!valid.length) return `<p class="empty">${E(metric.label)}：${E(metric.reason || "缺少有效结果")}</p>`;
    const vr = range(valid.map(o => o.value), ["column","bar","target"].includes(kind)), cr = {min:-.6,max:count-.4};
    const grid = frame(w,h,horizontal ? vr : cr,horizontal ? cr : vr,{categories:model.dates,horizontal,xLabel:horizontal ? metric.unit : "测试日期",yLabel:horizontal ? metric.label : metric.label+(metric.unit ? " · "+metric.unit : "")});
    let out=grid.out;
    valid.forEach(o => {
      const index=model.dates.indexOf(o.date), tone=toneOf(model,o.date), label=`${o.date} · ${metric.label}：${F(o.value)} ${metric.unit}`;
      if (["column","bar","target"].includes(kind)) {
        const width=Math.min(32,(grid.right-grid.left)/count*.45), px=horizontal ? grid.x(Math.min(0,o.value)) : grid.x(index)-width/2, py=horizontal ? grid.y(index)-7 : grid.y(Math.max(0,o.value)), rw=horizontal ? Math.abs(grid.x(o.value)-grid.x(0)) : width, rh=horizontal ? 14 : Math.abs(grid.y(o.value)-grid.y(0));
        out+=`<rect class="comparison-series" data-date="${E(o.date)}" x="${F(px)}" y="${F(py)}" width="${F(rw)}" height="${F(rh)}" fill="${tone}"><title>${E(label)}</title></rect>`;
      }
      out+=point(horizontal ? grid.x(o.value) : grid.x(index),horizontal ? grid.y(index) : grid.y(o.value),`${metric.label}：${F(o.value)} ${metric.unit}`,o,model);
      if (kind === "target") {
        const entry=model.entries.find(e=>e.recordId===o.recordId), evaluation=entry?.stats?.evaluationResults?.find(e=>e.metricId===metric.id), target=evaluation?.targetApplicable ? N(evaluation.target) : null;
        if (target !== null) out+=line(grid.x(target),grid.y(index)-11,grid.x(target),grid.y(index)+11,`stroke="${tone}" stroke-width="2" stroke-dasharray="3 2"`);
      }
    });
    return svg(w,h,metric.label,out,"按测试日期显示本记录的代表成绩；缺测日期留空。")+legend(model);
  }
  function trendChart(model, metric, layout = {}) {
    const w=layout.width||700,h=layout.height||330, byDate=new Map(metric.observations.map(o=>[o.date,o])), valid=metric.observations.filter(o=>N(o.value)!==null);
    if (!valid.length) return `<p class="empty">${E(metric.label)}：缺少有效结果</p>`;
    const grid=frame(w,h,range(model.dates.map(stamp)),range(valid.map(o=>o.value)),{dates:model.dates,xLabel:"测试日期",yLabel:metric.label+(metric.unit ? " · "+metric.unit : "")});
    let out=grid.out;
    model.dates.forEach((date,i)=>{
      const o=byDate.get(date), next=byDate.get(model.dates[i+1]);
      if (N(o?.value)===null) return;
      if (N(next?.value)!==null) out+=line(grid.x(stamp(date)),grid.y(o.value),grid.x(stamp(next.date)),grid.y(next.value),`class="comparison-observed-connector" stroke="${C.blue}" stroke-width="2"`);
      out+=point(grid.x(stamp(date)),grid.y(o.value),`${metric.label}：${F(o.value)} ${metric.unit}`,o,model);
    });
    const trend=metric.trend;
    if (model.dates.length>=3 && N(trend?.slopePer30Days)!==null && N(trend?.intercept)!==null) {
      const origin=stamp(trend.origin||model.dates[0]), first=trend.intercept+trend.slopePer30Days/30*(stamp(model.dates[0])-origin), last=trend.intercept+trend.slopePer30Days/30*(stamp(model.dates.at(-1))-origin);
      out+=line(grid.x(stamp(model.dates[0])),grid.y(first),grid.x(stamp(model.dates.at(-1))),grid.y(last),`class="comparison-trend-fit" stroke="${C.ink}" stroke-width="2" stroke-dasharray="7 5"`);
    }
    const tail=N(trend?.slopePer30Days)!==null ? `描述性线性趋势：${signed(trend.slopePer30Days)} ${metric.unit||"单位"}／30天${N(trend.r2)!==null ? " · R² "+F(trend.r2,3) : ""}` : model.dates.length===2 ? "实线连接两期实测结果" : trend?.reason || "有效日期不足三期，保留实测结果";
    return svg(w,h,metric.label+"趋势",out,"横轴为真实测试日期；缺测日期保留空白，实测连线在缺测处断开。")+legend(model)+`<p class="comparison-chart-caption">${E(tail)}</p>`;
  }
  function radarChart(model, axes, series, {title="能力评分",maximum=100,unit="分",width=560}={}) {
    if (!axes.length) return '<p class="empty">暂无可比较的能力评分</p>';
    if (axes.length<3) return series.map(s=>`<div class="comparison-axis-list">${axes.map((a,i)=>`<span>${E(a.label)} · ${E(s.date)}：${F(s.values[i])} ${E(unit)}</span>`).join("")}</div>`).join("");
    const w=width,h=410,cx=w/2,cy=190,r=Math.min(125,w*.23),polar=(i,v)=>[cx+Math.cos(-Math.PI/2+i*Math.PI*2/axes.length)*r*v/maximum,cy+Math.sin(-Math.PI/2+i*Math.PI*2/axes.length)*r*v/maximum];
    let out=maximum===3?text(cx+5,cy+4,"0",'class="comparison-radar-tick" data-value="0" font-size="10"'):"";
    const ticks=maximum===3?[1,2,3]:[maximum/4,maximum/2,maximum*.75,maximum];
    ticks.forEach(v=>{out+=`<polygon points="${axes.map((a,i)=>polar(i,v).map(v=>F(v)).join(",")).join(" ")}" fill="none" stroke="${C.grid}"/>`+text(cx+5,cy-r*v/maximum+4,F(v,0),`class="comparison-radar-tick" data-value="${v}" font-size="10"`);});
    axes.forEach((a,i)=>{const p=polar(i,maximum*1.19);out+=line(cx,cy,...polar(i,maximum))+text(p[0],p[1],a.label,`text-anchor="middle" fill="${C.ink}" font-size="16"`);});
    series.forEach(s=>{
      const tone=toneOf(model,s.date),dash=dashOf(model,s.date),values=s.values;
      out+=`<g class="comparison-series" data-date="${E(s.date)}">`;
      values.forEach((v,i)=>{const next=(i+1)%values.length;if(N(v)!==null&&N(values[next])!==null)out+=line(...polar(i,Math.max(0,v)),...polar(next,Math.max(0,values[next])),`stroke="${tone}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""}`);});
      values.forEach((v,i)=>{if(N(v)===null)return;const p=polar(i,Math.max(0,v)),tip=`${axes[i].label} · ${s.date}：${F(v)} ${unit}`;out+=`<g data-tooltip="${E(tip)}"><title>${E(tip)}</title><circle cx="${F(p[0])}" cy="${F(p[1])}" r="3.5" fill="${tone}"/></g>`;});out+="</g>";
    });
    return svg(w,h,title,out,"每个测试日期保留个人系列与原评分量尺；缺测轴留空并断开线段。")+legend(model);
  }
  function axisSeries(model,axes) {
    return model.dates.map(date=>({athleteId:model.athletes[0].id,date,values:axes.map(axis=>{const p=axis.periods?.find(p=>p.date===date);return N(p?.value) ?? N(p?.observations?.[0]?.value) ?? N(p?.mean);})}));
  }
  function radar(model) {
    const axes = model.axes || [];
    if (axes.length <= 8) return radarChart(model, axes, axisSeries(model, axes));
    return Array.from({ length: Math.ceil(axes.length / 7) }, (_, i) => { const group = axes.slice(i * 7, (i + 1) * 7); return `<div class="comparison-radar-facet" data-pdf-atomic>${radarChart(model, group, axisSeries(model, group))}</div>`; }).join("");
  }
  function summary(model) {
    const latest=model.entries.find(e=>e.date===model.dates.at(-1)),findings=latest?.stats?.findings||[],advantage=latest?.stats?.advantages?.items||[],transitions=model.summary?.transitions||[];
    const counts=state=>transitions.filter(t=>t.state===state&&t.toDate===model.dates.at(-1)&&!t.key?.startsWith("advantage:")).length;
    const card=(label,value,note,status="gray",unit="项")=>`<article class="micro-card"><div class="micro-head"><h3>${E(label)}</h3></div><div class="micro-value ${status}">${value}<small> ${unit}</small></div><p>${E(note)}</p></article>`;
    const red=findings.filter(f=>f.status==="red").length,amber=findings.filter(f=>f.status==="amber").length,green=advantage.filter(a=>!a.relative).length;
    return card("测试日期",model.dates.length,`末次 ${model.dates.at(-1)} · 基线 ${model.dates[0]}`,"gray","期")+card("预警",red,`末次相对基线：新增 ${counts("new")} 项 · 解除 ${counts("resolved")} 项 · 持续 ${counts("persistent")} 项`,red?"red":"gray")+card("关注",amber,"末次测试的关注项目",amber?"amber":"gray")+card("优势",green,"末次已评价的优势项目",green?"green":"gray");
  }
  const regionList=period=>Array.isArray(period?.regions)?period.regions:Object.values(period?.regions||{});
  function body(model) { return screeningChart(model); }
  function screeningChart(model) {
    const periods=model.summary?.periods||[],known=periods.flatMap(p=>regionList(p).map(r=>r.key)),keys=[...new Set([...Object.keys(REGIONS),...known])],score={green:3,amber:2,red:1},labels={green:"达标",amber:"关注",red:"预警",gray:"已测未判定"};
    const w=640,h=540,cx=320,cy=255,radius=160,polar=(index,value)=>{const angle=-Math.PI/2+index*2*Math.PI/keys.length;return [cx+Math.cos(angle)*radius*value/3,cy+Math.sin(angle)*radius*value/3];};
    const regionAt=(date,key)=>regionList(periods.find(p=>p.date===date)).find(r=>r.key===key), memberAt=(date,key)=>regionAt(date,key)?.members?.find(m=>m.athleteId===model.athletes[0].id);
    const detailAt=(date,key)=>{
      const member=memberAt(date,key),region=regionAt(date,key),status=member?.status||"gray",grade=score[status]??null,measured=!!member||region?.measured===true||region?.hasMeasured===true,label=grade===null?(measured?"已测未判定":"未测"):labels[status];
      return {name:`${REGIONS[key]||region?.label||key} · ${date}`,status,hasMeasured:measured,label,tests:[{name:"筛查状态",value:grade,unit:"级",status,missing:!measured,label},...(member?.tests||region?.tests||[])]};
    };
    let out=[3,2,1].map(value=>`<polygon class="comparison-screening-grade-ring" data-grade="${value}" points="${keys.map((_,i)=>polar(i,value).map(v=>F(v)).join(",")).join(" ")}" fill="${C[{3:"green",2:"amber",1:"red"}[value]]}" fill-opacity=".055" stroke="${C.grid}"/>`).join("");
    [1,2,3].forEach(value=>{out+=text(cx+8,cy-radius*value/3-5,`${value} · ${labels[{1:"red",2:"amber",3:"green"}[value]]}`,`font-size="13" fill="${C[{1:"red",2:"amber",3:"green"}[value]]}"`);});
    keys.forEach((key,index)=>{
      const p=polar(index,3),labelPoint=polar(index,3.75),label=REGIONS[key]||regionAt(model.dates.at(-1),key)?.label||key,cos=(labelPoint[0]-cx)/radius,anchor=cos>.2?"start":cos<-.2?"end":"middle",parts=label.length>6?[label.slice(0,6),label.slice(6)]:[label];
      const detail={name:label,status:"gray",hasMeasured:model.dates.some(date=>detailAt(date,key).hasMeasured),tests:model.dates.flatMap(date=>detailAt(date,key).tests.map(t=>({...t,name:date+" · "+(t.name||t.title||"测试")})))};
      out+=line(cx,cy,p[0],p[1]);
      out+=`<g class="comparison-screening-axis" data-region="${E(key)}" data-body-detail="${E(JSON.stringify(detail))}" data-overview-detail="${E(JSON.stringify(detail))}" tabindex="0" role="button">${parts.map((part,i)=>text(labelPoint[0],labelPoint[1]+i*18,part,`class="comparison-screening-axis-label" text-anchor="${anchor}" font-size="18" fill="${C.ink}"`)).join("")}</g>`;
    });
    model.dates.forEach(date=>{
      const values=keys.map(key=>score[memberAt(date,key)?.status]??null),tone=toneOf(model,date),dash=dashOf(model,date);let marks="";
      values.forEach((value,index)=>{const next=(index+1)%keys.length;if(value!==null&&values[next]!==null)marks+=line(...polar(index,value),...polar(next,values[next]),`class="comparison-screening-segment" data-screening-from="${E(keys[index])}" data-screening-to="${E(keys[next])}" stroke="${tone}" stroke-width="2"${dash?` stroke-dasharray="${dash}"`:""}`);});
      keys.forEach((key,index)=>{
        const member=memberAt(date,key),entry=model.entries.find(e=>e.date===date),detail=detailAt(date,key),grade=score[detail.status]??null,recordId=member?.recordId||entry?.recordId||"",tooltip=`${date} · ${REGIONS[key]||key}：${grade===null?detail.label:grade+'级 · '+detail.label}`,p=grade===null?null:polar(index,grade);
        marks+=`<g class="viz-region comparison-screening-row${grade===null?' comparison-screening-unknown':''}" data-date="${E(date)}" data-region="${E(key)}" data-record-id="${E(recordId)}" data-status="${E(detail.status)}" data-value="${grade??''}" data-body-detail="${E(JSON.stringify(detail))}" data-tooltip="${E(tooltip)}" role="button" tabindex="0" aria-label="${E(tooltip)}">${p?`<circle class="comparison-screening-point viz-hotspot" cx="${F(p[0])}" cy="${F(p[1])}" r="3.5" fill="${C[detail.status]}" stroke="white" stroke-width="1.2"/>`:""}<title>${E(tooltip)}</title></g>`;
      });
      out+=`<g class="comparison-series comparison-screening-series" data-date="${E(date)}">${marks}</g>`;
    });
    const chart=svg(w,h,"个人纵向身体部位筛查雷达",out,"同一名队员各测试日期分别形成系列；达标、关注、预警显示为3、2、1。未判定部位留空，线段在缺测处断开。").replace("<svg ",`<svg data-center-x="${cx}" data-center-y="${cy}" data-max-radius="${radius}" data-max-value="3" `);
    return `<div class="comparison-screening-chart" data-pdf-atomic><p class="comparison-screening-active-date">${E(model.dates[0])} — ${E(model.dates.at(-1))}</p><div class="comparison-screening-viewport">${chart}</div>${legend(model)}<p class="comparison-screening-caption">显示等级：绿色 3 达标 · 黄色 2 关注 · 红色 1 预警。未判定留空。点击日期图例突出该期，点击图点或部位名称查看原项目与判定依据。</p></div>`;
  }
  function screenItems(model) {
    const periods=model.summary?.periods||[],keys=[...new Set(periods.flatMap(p=>regionList(p).filter(r=>r.members?.length||r.measured||r.hasMeasured).map(r=>r.key)))];
    const item=key=>`<details class="screen-item comparison-region-members" data-region="${E(key)}"><summary><strong>${E(REGIONS[key]||key)}</strong><span>各期筛查结果</span></summary>${model.dates.map(date=>{const r=regionList(periods.find(p=>p.date===date)).find(r=>r.key===key),m=r?.members?.[0],status=m?.status||r?.status,entry=model.entries.find(e=>e.date===date),measured=!!m||r?.measured||r?.hasMeasured;return `<p data-date="${E(date)}" data-record-id="${E(m?.recordId||entry?.recordId||'')}"><button class="comparison-date-link" data-comparison-date-highlight="${E(date)}">${E(date)}</button> · ${E(measured?({red:'预警',amber:'关注',green:'达标',gray:'已测未判定'}[status]||'已测未判定'):'未测')}${m?.tests?.length?' · '+E(m.tests.map(t=>t.name||t.title).filter(Boolean).join('、')):''}</p>`;}).join('')}</details>`;
    return keys.slice(0,4).map(item).join('')+(keys.length>4?`<details class="comparison-more-regions"><summary>查看其余 ${keys.length-4} 个部位</summary>${keys.slice(4).map(item).join('')}</details>`:'')||'<div class="screen-item"><h4>暂无可判断的筛查结果</h4></div>';
  }
  function overview(model) {
    const axes=model.axes||[];
    if(!axes.length)return '';
    return `<details class="comparison-ability-values"><summary>查看各期能力数值</summary>${table(["能力",...model.dates],axes.map(axis=>[E(axis.label),...model.dates.map(date=>{const p=axis.periods?.find(p=>p.date===date);return F(N(p?.value)??N(p?.observations?.[0]?.value)??N(p?.mean))+" 分";})]))}</details>`;
  }
  function preferences(model, views = {}) {
    const next = copy(views); next.projects ||= {}; next.capabilityExpanded ||= {};
    delete next.screeningDate; delete next.highlightAthleteId;
    next.highlightDate = model.dates.includes(next.highlightDate) ? next.highlightDate : "";
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
  const changeLabel = (metric,change) => change ? `${signed(change.delta)}${N(change.delta)!==null ? " "+E(change.deltaUnit||metric.unit) : ""}${N(change.percentChange)!==null ? `<small>${signed(change.percentChange)}%</small>` : /^(%|%PF)$/.test(metric.unit)&&N(change.delta)!==null ? '<small>百分点变化</small>' : ''}${change.improvement&&change.improvement!=="unknown" ? `<small>${E({improved:'改善',declined:'下降',increased:'增加',decreased:'减少',unchanged:'持平',changed:'变化'}[change.improvement]||'')}</small>` : ''}${change.reason ? `<small>${E(change.reason)}</small>`:''}` : '—';
  function projectTable(model,project,prefs) {
    const rows=project.metrics.flatMap(metric=>model.dates.map(date=>{
      const o=metric.observations.find(o=>o.date===date),period=metric.periods.find(p=>p.date===date),value=N(o?.value)??N(period?.value)??N(period?.mean),change=metric.changes?.find(c=>c.date===date),reason=o?.reason||period?.reason||'',recordId=o?.recordId||model.entries.find(e=>e.date===date)?.recordId;
      return {attrs:` class="comparison-person-row" data-metric-key="${E(metric.key)}" data-date="${E(date)}" data-comparison-date-highlight="${E(date)}" tabindex="0" role="button" aria-label="突出${E(date)}的图中数据"`,cells:[E(metric.label)+`<small>${E(metric.unit)}</small>`,E(date),F(value,metric.continuous===false?0:2),changeLabel(metric,change),E(reason),...(prefs.tableMode==='individual'?[recordId?`<button class="btn small comparison-edit-record no-print" data-comparison-edit-record="${E(recordId)}">编辑记录</button>`:'—']:[])]};
    }));
    return table(['指标','测试日期','代表结果','相对基线变化','说明',...(prefs.tableMode==='individual'?['记录']:[])],rows);
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
      if (group.kind === "radar") output.push(`<div class="comparison-chart-panel" data-pdf-atomic><h5>评分雷达</h5>${radarChart(model,group.axes,group.series)}</div>`);
      else output.push(`<div class="comparison-chart-panel" data-pdf-atomic><h5>${E(group.title)}</h5>${curveChart(model,{...group,noConnect:true,description:group.kind==="scatter" ? "各期保留同一次试次的真实 X–Y 配对与两轴单位。" : "各期保留真实试次编号与原值，不连接不同试次。"})}</div>`);
    }
    return output.join("");
  }
  function fmsDetails(model, project) {
    if (project.renderer !== "fms") return "";
    const rows = model.entries.filter(e => e.record?.enabled?.fms).flatMap(entry => (entry.record.data.fms || []).map((item, i) => [E(entry.date), E(item.name || global.RingsideTests.fmsAbilities[i]), F(global.Calc.num(item.bilateral ? item.left : item.score), 0), F(global.Calc.num(item.bilateral ? item.right : null), 0), E(item.pain || item.painLeft || item.painRight || item.painCenter || entry.stats.raw.fms?.scores?.[i] === 0 ? "疼痛／清除阳性" : ""), E(item.notes || "")]));
    return `<details class="comparison-raw-details"><summary>FMS 原分、左右侧与疼痛记录</summary>${table(["日期", "动作", "左／单项", "右", "疼痛", "备注"], rows)}</details>`;
  }
  function isoCharts(model,project) {
    if(project.renderer!=="iso")return "";
    const records=model.entries.filter(e=>e.record?.enabled?.iso).map(entry=>({entry,radar:M.isoRadar(entry.stats.isoAnalyses,entry.record)})),axes=[...new Map(records.flatMap(r=>r.radar.axes.map(a=>[a.key||a.id||a.label,a]))).values()];
    if(!axes.length)return "";
    return ['strength','symmetry'].map(key=>{
      const series=records.map(({entry,radar})=>({athleteId:entry.athleteId,date:entry.date,values:axes.map(a=>radar.axes.find(r=>(r.key||r.id||r.label)===(a.key||a.id||a.label))?.[key]??null)}));
      const title=key==='strength'?'关节力量水平':'关节对称性';
      return `<div class="comparison-chart-panel" data-pdf-atomic><h5>${title}</h5>${radarChart(model,axes,series,{title,maximum:Math.max(100,...series.flatMap(s=>s.values).filter(v=>N(v)!==null)),unit:'%'})}</div>`;
    }).join('');
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
    return `<div class="comparison-controls no-print"><details class="multi-select comparison-metric-picker" data-comparison-picker="${E(project.id)}"${prefs.pickerOpen ? " open" : ""}><summary>图中指标 · ${prefs.metricKeys.length + prefs.curveKeys.length} 项</summary><div class="multi-options">${curves.length ? '<p class="comparison-picker-label">原图曲线</p>' + curves.map(curve => `<label><input type="checkbox" data-comparison-curve="${E(curve.key)}" data-comparison-project="${E(project.id)}"${prefs.curveKeys.includes(curve.key) ? " checked" : ""}>${E(curve.title)}${curve.unit ? " · " + E(curve.unit) : ""}</label>`).join("") + '<p class="comparison-picker-label">结果指标</p>' : ""}${selectable}</div></details>${model.dates.length > 1 ? `<div class="comparison-segment" role="group" aria-label="${E(project.name)}图表形式"><button data-comparison-chart-mode="original" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.chartMode === "original"}">原图对照</button><button data-comparison-chart-mode="trend" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.chartMode === "trend"}">指标趋势</button></div>` : ""}<div class="comparison-segment" role="group" aria-label="${E(project.name)}表格内容"><button data-comparison-table-mode="summary" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.tableMode === "summary"}">结果</button><button data-comparison-table-mode="individual" data-comparison-project="${E(project.id)}" aria-pressed="${prefs.tableMode === "individual"}">记录明细</button></div></div>`;
  }
  function capabilityAnalysis(model,views) {
    const cards=model.capabilities||[];
    if(!cards.length)return '';
    const optionMap=M.capabilityDirectionOptions||{};
    return `<section class="capability-analysis-region comparison-capabilities" data-capability-region><div class="quality-group"><div class="quality-heading"><h3>${E(global.RingsideTests.analysisLabel)}</h3></div><div class="capability-direction-grid" data-capability-count="${cards.length}">${cards.map(card=>{
      const latest=card.periods?.at(-1),member=latest?.members?.[0],basis=model.selection?.basis?.[card.id],options=optionMap[card.id];
      const rows=model.dates.map(date=>{const p=card.periods?.find(p=>p.date===date),m=p?.members?.[0];return [E(date),E(m?.label||basisLabel(card.id,card.basis)),F(m?.value)+(m?.unit?' '+E(m.unit):''),E(m?.judgment||m?.reason||'暂无可判断结果')];});
      const parameters=(card.periods||[]).flatMap(p=>(p.parameters||[]).map(v=>[E(p.date),E(v.label),F(N(v.value)??N(v.mean))+' '+E(v.unit)]));
      const shifts=card.transitions||[];
      return `<article class="capability-direction-card" data-comparison-capability="${E(card.id)}"><div class="capability-card-summary"><h4>${E(card.title)}</h4><section><p class="capability-direction-basis">${E(basisLabel(card.id,card.basis))}</p><p class="capability-direction-judgment">${E(member?.judgment||member?.reason||'暂无可判断结果')}</p><p class="capability-direction-context">末次 ${E(model.dates.at(-1))}</p></section>${options?`<label class="capability-selector no-print">判断依据<select data-comparison-basis="${E(card.id)}" aria-label="${E(card.title)}判断依据">${options.map(([id,label])=>`<option value="${E(id)}"${id===basis?' selected':''}>${E(label)}</option>`).join('')}</select></label>`:''}</div><details class="capability-card-parameters" data-comparison-capability-expanded="${E(card.id)}"${views.capabilityExpanded?.[card.id]?' open':''}><summary>查看各期方向与相关参数</summary>${table(['测试日期','判断依据','结果','方向'],rows)}${parameters.length?table(['测试日期','参数','数值'],parameters):''}${shifts.length?table(['比较日期','基线方向','本期方向','变化'],shifts.map(t=>[E(t.toDate||t.date),E(t.from?.judgment||t.from),E(t.to?.judgment||t.to),E({changed:'方向改变',unchanged:'保持',unknown:'待判断'}[t.state]||t.state||'')])):''}</details></article>`;
    }).join('')}</div></div></section>`;
  }
  function render(model,views={},options={}) {
    if(model.athletes?.length!==1||model.dates?.length<2)throw new Error('个人纵向报告需要一名队员和至少两个测试日期');
    views=preferences(model,views);
    const projects=model.projects.map(project=>{const prefs=views.projects[project.id];return `<article class="test-block comparison-project" id="detail-${E(project.id)}" data-comparison-project="${E(project.id)}"><div class="test-title"><div><h4>${E(project.name)}</h4><p>${E(model.dates.join(' · '))} · 基线 ${E(model.dates[0])}</p></div></div>${controls(model,project,prefs)}<div class="comparison-chart-stack">${projectCharts(model,project,prefs)}</div><div class="comparison-data">${projectTable(model,project,prefs)}${fmsDetails(model,project)}</div></article>`;}).join('');
    const summaryHTML=options.includeSummary?`<div class="micro-cards">${summary(model)}</div><div class="summary-grid"><article class="card"><div class="card-head"><h3>损伤风险筛查</h3></div>${body(model)}${screenItems(model)}</article><article class="card"><div class="card-head"><h3>运动表现概览</h3></div>${radar(model)}${overview(model)}</article></div>`:'';
    return `<div class="comparison-report" data-comparison-kind="personal-longitudinal">${summaryHTML}<div class="quality-group"><div class="quality-heading"><h3>个人纵向报告</h3><p>${E(nameOf(model,model.athletes[0].id))} · ${model.dates.length} 个测试日期</p></div>${projects||'<p class="empty">所选记录暂无可比较指标</p>'}</div>${capabilityAnalysis(model,views)}</div>`;
  }
  function applyHighlight(container,date='') {
    container.querySelectorAll('.comparison-series,.comparison-person-row').forEach(node=>{
      const active=!!date&&node.dataset.date===date,dimmed=!!date&&!active;node.classList.toggle('comparison-highlighted',active);node.classList.toggle('comparison-dimmed',dimmed);
      if(node.classList.contains('comparison-screening-series')){node.setAttribute('opacity',dimmed?'.12':'1');node.querySelectorAll('.comparison-screening-segment').forEach(segment=>segment.setAttribute('stroke-width',active?'3':'2'));}
    });
    container.querySelectorAll('[data-comparison-date-highlight]').forEach(node=>node.setAttribute('aria-pressed',String(!!date&&node.dataset.comparisonDateHighlight===date)));
    container.querySelectorAll('.comparison-screening-axis').forEach(axis=>{const selected=date?[...container.querySelectorAll('.comparison-screening-row')].find(row=>row.dataset.date===date&&row.dataset.region===axis.dataset.region):null;axis.dataset.bodyDetail=selected?.dataset.bodyDetail||axis.dataset.overviewDetail;});
  }
  const bindings = new WeakMap();
  function bind(container, options) {
    const state = { ...options, views: preferences(options.model, options.views || options.prefs || {}) }; bindings.set(container, state);
    if (!container.dataset.comparisonBound) {
      container.dataset.comparisonBound = "true";
      const publish = current => { current.onPreferences?.(copy(current.views)); };
      container.addEventListener("click", event => {
        const current = bindings.get(container), node = event.target.closest("[data-comparison-chart-mode],[data-comparison-table-mode],[data-comparison-date-highlight],[data-comparison-edit-record]");
        if (!node || !container.contains(node)) return;
        if (current.overview && node.closest(".comparison-report")) return;
        if (node.dataset.comparisonEditRecord) { event.stopPropagation(); current.onEditRecord?.(node.dataset.comparisonEditRecord); return; }
        if (node.dataset.comparisonDateHighlight) { const date = node.dataset.comparisonDateHighlight; current.views.highlightDate = current.views.highlightDate === date ? "" : date; applyHighlight(container, current.views.highlightDate); publish(current); return; }
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
    applyHighlight(container, state.views.highlightDate);
  }
  function bindOverview(container, options) {
    bind(container, { ...options, overview: true });
  }
  function snapshotView(container, views = {}) {
    const result = copy(views); result.projects ||= {}; result.capabilityExpanded ||= {};
    container.querySelectorAll("[data-comparison-expanded]").forEach(d => { result.projects[d.dataset.comparisonExpanded] ||= {}; result.projects[d.dataset.comparisonExpanded].expanded = d.open; });
    container.querySelectorAll("[data-comparison-picker]").forEach(d => { result.projects[d.dataset.comparisonPicker] ||= {}; result.projects[d.dataset.comparisonPicker].pickerOpen = d.open; });
    container.querySelectorAll("[data-comparison-capability-expanded]").forEach(d => { result.capabilityExpanded[d.dataset.comparisonCapabilityExpanded] = d.open; });
    return result;
  }
  global.RingsideComparisonReport = { render, summary, body, screenItems, radar, overview, preferences, bind, bindOverview, applyHighlight, snapshotView, curveChart, metricChart, trendChart, radarChart, genericPanels };
})(typeof window !== "undefined" ? window : globalThis);
