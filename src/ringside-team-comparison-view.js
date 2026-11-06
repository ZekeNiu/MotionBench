(function (root) {
  "use strict";
  const E = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const N = value => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const F = (value, digits = 2) => N(value) === null ? "—" : Number(value).toLocaleString("zh-CN", {maximumFractionDigits:digits});
  const chunks = (items, size) => Array.from({length:Math.ceil(items.length / size)}, (_, i) => items.slice(i * size, (i + 1) * size));
  const empty = message => `<p class="team-empty">${E(message)}</p>`;
  const axisKey = row => row.id || row.key;
  const metricName = row => row.name + (row.contextLabel ? " · " + row.contextLabel : "");
  const missing = '<span class="team-missing">—</span>';
  function figures(spec, print) {
    return `<div class="team-comparison-figure" data-team-figure="${E(JSON.stringify(spec))}">${root.RingsideLongitudinalView.draw(spec, print ? 680 : 720, print)}</div>`;
  }
  function decoratedPeriods(model) {
    const periods = model.periods || [], appearance = root.RingsideReportAppearance.dates(periods);
    return periods.map(period => ({...period, ...appearance.byRecord[period.id]}));
  }
  function aggregateCell(cell, row, {difference, baseline = false} = {}) {
    if (!cell || !cell.n) return missing;
    const value = N(cell.value ?? cell.mean), distribution = cell.distribution || [],
      content = value !== null ? `<strong>${F(value, Number.isInteger(row.digits) ? row.digits : 2)}</strong>` : distribution.length ? distribution.map(item => `${E(item.label ?? item.value)}：${item.count} 人`).join("<br>") : missing,
      grade = cell.assessment || cell.evaluation?.grade,
      assessment = grade && ["red","amber","green"].includes(grade.status) ? `<span class="pill ${grade.status}">${E(grade.label || root.RingsideResultDisplay.trafficLabel(grade.status))}</span>` : "",
      count = `<small>有效 ${cell.n}${N(cell.total) === null ? "" : "/" + cell.total} 人</small>`;
    return content + assessment + count + (baseline ? '<small>比较基准</small>' : difference ? differenceHTML(difference, row) : "");
  }
  function differenceHTML(change, row) {
    if (!change?.available) return change?.reason ? `<small>${E(change.reason)}</small>` : "";
    const signed = value => (value > 0 ? "+" : "") + F(value, Number.isInteger(row.digits) ? row.digits : 2),
      unit = change.kind === "percentage-point" ? " 个百分点" : row.unit ? " " + E(row.unit) : "";
    return `<small class="team-difference"${change.improvement ? ` data-improvement="${E(change.improvement)}"` : ""}>${signed(change.delta)}${unit}${N(change.percent) !== null ? `（${signed(change.percent)}%）` : ""}</small>`;
  }
  function comparisonTable(rows, columns, {print = false, focus = "", baseline = "", longitudinal = false} = {}) {
    if (!rows.length) return "";
    const indexed = columns.map((column, i) => ({...column, index:i})), groups = print ? chunks(indexed, 3) : [indexed];
    return groups.map(group => `<div class="team-table-wrap"><table class="team-results team-comparison-table"${print ? "" : ` style="min-width:${160 + group.length * 155}px"}`}><colgroup><col class="team-comparison-name-column">${group.map(() => "<col>").join("")}</colgroup><thead><tr><th scope="col">指标</th>${group.map(column => `<th scope="col"${column.id === focus ? ' class="team-comparison-focus"' : ""}>${E(column.label || column.date)}${column.id === baseline ? "<small>比较基准</small>" : ""}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr data-team-comparison-metric="${E(row.id)}"><th scope="row">${E(metricName(row))}${row.unit ? `<small>${E(row.unit)}</small>` : ""}</th>${group.map(column => `<td data-team-column="${E(column.id)}">${aggregateCell(row.cells?.[column.index], row, {difference:longitudinal ? null : row.differences?.[column.index] || row.cells?.[column.index]?.difference, baseline:column.id === baseline})}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("");
  }
  function pairedTable(rows, periods, print) {
    const spans = [{key:"overall", label:"首末日期"}, ...(periods.length > 2 ? [{key:"recent", label:"最近两次"}] : [])];
    return spans.map(span => `<div class="team-table-wrap"><table class="team-results team-paired-results"><caption>同人配对变化 · ${span.label}</caption><thead><tr><th scope="col">指标</th><th scope="col">配对人数</th><th scope="col">起始均值</th><th scope="col">结束均值</th><th scope="col">变化</th></tr></thead><tbody>${rows.map(row => {
      const change = row.pairedChanges?.[span.key] || row.changes?.[span.key], available = change?.available;
      return `<tr><th scope="row">${E(metricName(row))}${row.unit ? `<small>${E(row.unit)}</small>` : ""}</th><td>${change?.n > 0 ? change.n : missing}</td><td>${available ? F(change.fromMean) + `<small>${E(change.from)}</small>` : missing}</td><td>${available ? F(change.toMean) + `<small>${E(change.to)}</small>` : missing}</td><td>${available ? differenceHTML(change, row) : missing}${!available && change?.reason ? `<small>${E(change.reason)}</small>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`).join("") + '<p class="note team-comparison-note">配对变化只使用该指标在比较两端都有有效结果的同一批成员；各日期群体均值使用当日有效结果。</p>';
  }
  function personalHistory(row, periods, print) {
    const people = row.people || [], indexed = periods.map((period, index) => ({...period, index})), groups = print ? chunks(indexed, 3) : [indexed],
      hasTrend = row.meaning !== "category" && periods.length > 1 && people.some(person => person.cells?.some(cell => N(cell?.value) !== null)),
      trend = person => person.cells?.some(cell => N(cell?.value) !== null) ? root.RingsideResultDisplay.render(root.RingsideResultDisplay.trend({...row,id:row.metricId || row.id,cells:person.cells},periods,root.RingsideLongitudinal.change),print) : missing;
    return `<details class="team-personal-history"${print ? " open" : ""}><summary>${E(metricName(row))} · 个人逐日结果</summary>${groups.map((group,index) => {
      const showTrend = hasTrend && index === groups.length - 1;
      return `<div class="team-table-wrap"><table class="team-results team-comparison-table team-personal-results"${print ? "" : ` style="min-width:calc(${160 + group.length * 130}px + ${showTrend ? "var(--result-trend-column-width,184px)" : "0px"})"}`}><colgroup><col class="team-comparison-name-column">${group.map(() => "<col>").join("")}${showTrend ? '<col class="team-trend-column">' : ""}</colgroup><thead><tr><th scope="col">运动员</th>${group.map(period => `<th scope="col">${E(period.date)}</th>`).join("")}${showTrend ? '<th scope="col">变化趋势</th>' : ""}</tr></thead><tbody>${people.map(person => `<tr data-team-history-person="${E(person.athleteId)}"><th scope="row">${E(person.name || person.athleteId)}</th>${group.map(period => `<td data-team-history-date="${E(period.date)}">${root.RingsideTeamView.cellHTML(person.cells?.[period.index], row)}</td>`).join("")}${showTrend ? `<td data-label="变化趋势">${trend(person)}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
    }).join("")}</details>`;
  }
  function projectHTML(project, model, views, print) {
    const longitudinal = model.analysisMode === "longitudinal", rows = project.metrics || [], saved = views.charts?.[project.id] || {},
      row = rows.find(item => item.id === saved.metricId) || rows.find(item => item.id === project.defaultMetricId || item.metricId === project.defaultMetricId) || rows[0],
      columns = longitudinal ? decoratedPeriods(model) : model.objects || [], palette = root.RingsideReportAppearance.colors(columns.map(column => column.id)),
      periods = columns.map(column => ({id:column.id,date:column.date || "",label:column.label || column.date,color:column.color || palette[column.id],latest:column.latest})),
      controls = print || rows.length < 2 ? "" : `<div class="team-chart-controls no-print"><label>图表指标<select data-team-metric="${E(project.id)}" aria-label="${E(project.name)}图表指标">${rows.map(item => `<option value="${E(item.id)}"${item.id === row?.id ? " selected" : ""}>${E(metricName(item))}${item.unit ? " · " + E(item.unit) : ""}</option>`).join("")}</select></label></div>`,
      title = row ? metricName(row) + (longitudinal ? " · 各日期群体均值" : " · 群体代表结果") : project.name,
      spec = row && {kind:longitudinal ? "cod-trend" : "columns",title,showTitle:false,subjectKind:longitudinal ? "date" : "athlete",unit:row.unit || "无单位",periods,values:(row.cells || []).map(cell => ({value:N(cell?.value ?? cell?.mean)}))},
      chart = spec && spec.values.some(cell => cell.value !== null) ? figures(spec, print) : empty(row?.meaning === "category" || row?.meaning === "ordinal" ? "等级与类别结果见人数分布表。" : "所选指标暂无有效群体结果。"),
      table = comparisonTable(rows, columns, {print,longitudinal,focus:views.focusObjectId,baseline:views.baselineObjectId});
    return `<article class="test-block team-test team-comparison-project" data-team-project="${E(project.id)}"><div class="test-title"><h4>${E(project.name)}</h4></div>${controls}<p class="team-chart-caption">${E(title)}</p>${chart}${table}${longitudinal ? pairedTable(rows, periods, print) + rows.map(item => personalHistory(item, columns, print)).join("") : ""}</article>`;
  }
  function detailsHTML(model, views, print) {
    const projects = model.projects || [], section = (category, title) => {
      const list = projects.filter(project => category === "performance" ? !["screen", "capability"].includes(project.category) : project.category === category);
      return list.length ? `<details class="details-group team-details" id="team-comparison-${category}" open><summary>${title}</summary><div class="quality-group">${list.map(project => projectHTML(project, model, views, print)).join("")}</div></details>` : "";
    };
    const cards = (model.capability?.cards || []).filter(card => card.metrics?.length), capability = cards.length ? `<details class="details-group team-details" id="team-comparison-capability" open><summary>能力结构分析</summary><div class="quality-group">${cards.map(card => projectHTML({...card,id:card.projectId || card.id,name:card.title || card.name},model,views,print)).join("")}</div></details>` : "";
    return section("screen", "损伤风险筛查") + section("performance", "运动表现测试") + section("capability", "能力结构分析") + capability || empty("所选范围内暂无可比较结果。");
  }
  function longitudinalOverview(model, risk, print) {
    const periods = decoratedPeriods(model), all = periods.flatMap(period => risk ? period.model.risk?.regions || [] : period.model.overview?.axes || []), axes = [...new Map(all.map(axis => [axis.id || axis.key, {key:axis.id || axis.key,label:axis.label}])).values()];
    if (!axes.length) return empty(risk ? "暂无可评价的筛查部位。" : "暂无可用于比较的能力评分。");
    const rows = axes.map(axis => ({id:axis.key,name:axis.label,unit:risk ? "人" : "分",cells:periods.map(period => {
      const source = (risk ? period.model.risk?.regions : period.model.overview?.axes)?.find(item => (item.id || item.key) === axis.key), n = risk ? source?.assessedCount : source?.n;
      return n ? {value:risk ? source.flaggedCount : source.value,n,total:model.people?.length || period.model.people?.length || 0} : null;
    })})), series = periods.map((period,index) => ({id:period.id,label:period.date,color:period.color,latest:period.latest,strokeWidth:period.strokeWidth,values:rows.map(row => row.cells[index]?.value ?? null)})),
      spec = {kind:"radar",title:risk ? "各日期筛查关注人数" : "各日期能力平均分",showTitle:false,axes,series,max:risk ? Math.max(1,model.people?.length || 0) : 100,tickSuffix:risk ? " 人" : " 分",overview:!risk};
    if (!rows.some(row => row.cells.some(cell => N(cell?.value) !== null))) return empty(risk ? "暂无可评价的筛查部位。" : "暂无可用于比较的能力评分。");
    return figures(spec,print) + comparisonTable(rows,periods,{print,longitudinal:true});
  }
  function referenceOverview(model, risk, print) {
    const objects = model.objects || [], entries = objects.map(object => ({object,data:object.referenceModel?.[risk ? "risk" : "overview"]})),
      axes = [...new Map(entries.flatMap(({data}) => (data?.rows || []).map(row => [axisKey(row),{key:axisKey(row),label:row.name}]))).values()], palette = root.RingsideReportAppearance.colors(objects.map(object => object.id));
    if (!axes.length) return empty(risk ? "暂无可评价的群体筛查结果。" : "暂无可用于比较的群体能力评分。");
    const rows = axes.map(axis => ({id:axis.key,name:axis.label,unit:risk ? "" : "分",cells:entries.map(({data}) => {
      const row = data?.rows?.find(item => axisKey(item) === axis.key), benchmark = row?.benchmark;
      return benchmark ? {...benchmark,value:N(benchmark.score ?? benchmark.mean)} : null;
    })})), series = objects.map((object,index) => ({id:object.id,label:object.label,color:palette[object.id],values:rows.map(row => row.cells[index]?.value ?? null)})),
      spec = {kind:"radar",title:risk ? "群体代表筛查评价" : "群体代表能力评分",showTitle:false,subjectKind:"athlete",axes,series,max:risk ? 3 : 100,risk,overview:!risk};
    if (!rows.some(row => row.cells.some(cell => N(cell?.value) !== null))) return empty(risk ? "暂无可评价的群体筛查结果。" : "暂无可用于比较的群体能力评分。");
    return figures(spec,print) + comparisonTable(rows,objects,{print,focus:model.presentation?.focusObjectId});
  }
  function objectSummary(object) {
    const reference = object.referenceModel || {}, rows = reference.overview?.rows || [],
      source = object.model || {participants:[],summary:{total:reference.eligibleAthletes || 0},risk:{countsAvailable:false}},
      overview = {axes:rows.map(row => ({id:row.id,label:row.name,value:N(row.benchmark?.score ?? row.benchmark?.mean),n:row.benchmark?.n || 0,total:source.summary?.total ?? reference.eligibleAthletes ?? 0}))},
      cards = root.RingsideTeamView.summaryCards({...source,overview},{label:object.label}), concerns = (reference.risk?.rows || []).filter(row => ["red","amber"].includes(row.benchmark?.assessment?.status)),
      evaluated = (reference.risk?.rows || []).some(row => ["red","amber","green"].includes(row.benchmark?.assessment?.status));
    cards[0].note = object.kind === "team" ? "所选报告成员" : ({"period-mean":"期间均值","period-record":"期间最佳成绩",latest:"最近可比测试"}[reference.spec?.sampling] || "群体参照");
    cards[2] = {title:"主要关注部位",value:concerns.length ? concerns.map(row => row.name).join("、") : evaluated ? "暂无关注部位" : "待评价",note:"按群体代表结果评价",text:true};
    if (object.kind === "reference") cards[1] = {title:"筛查关注人数",value:"—",note:"群体代表结果不对应个人关注人数"};
    return cards;
  }
  function horizontalSummary(model, views, print) {
    const objects = model.objects || [], focus = objects.find(object => object.id === views.focusObjectId), selected = focus ? [focus] : objects,
      values = selected.map(object => ({object,cards:objectSummary(object)})), titles = ["报告人数","筛查关注人数","主要关注部位","相对薄弱能力"];
    const cardsHTML = group => titles.map((title,index) => `<article class="micro-card team-summary team-comparison-summary"><div class="micro-head"><h3>${title}</h3></div>${group.map(({object,cards}) => `<div class="team-summary-object" data-team-summary-object="${E(object.id)}"><strong class="team-summary-object-name">${E(object.label)}</strong><div class="micro-value${cards[index].text ? " text" : ""}">${E(cards[index].value)}</div><p>${E(cards[index].note)}</p></div>`).join("")}</article>`).join("");
    return print && values.length > 1 ? values.map(value => `<div class="micro-cards team-summary-set">${cardsHTML([value])}</div>`).join("") : cardsHTML(values);
  }
  function presentationControls(model, views) {
    const options = (items, selected) => items.map(([id,label]) => `<option value="${E(id)}"${id === (selected || "") ? " selected" : ""}>${E(label)}</option>`).join(""), objects = (model.objects || []).map(object => [object.id,object.label]);
    return `<div class="horizontal-controls team-comparison-controls no-print"><label><span>报告重点</span><select data-team-presentation="focusObjectId" aria-label="报告重点">${options([["","全部对象"],...objects],views.focusObjectId)}</select></label><label><span>比较基准</span><select data-team-presentation="baselineObjectId" aria-label="比较基准">${options([["","无"],...objects],views.baselineObjectId)}</select></label></div>`;
  }
  function render(input, {views = {}, print = false} = {}) {
    const model = root.RingsideTeam.present ? root.RingsideTeam.present(input,views) : input, longitudinal = model.analysisMode === "longitudinal", last = model.periods?.at(-1),
      summary = longitudinal ? root.RingsideTeamView.summaryHTML(last?.model || model,{label:last?.date ? "最新日期 · " + last.date : "已选报告成员"}) : horizontalSummary(model,views,print),
      tools = print ? "" : '<div class="team-report-tools no-print"><button type="button" class="btn small" data-team-refresh>更新已选记录数据</button></div>';
    return {controls:longitudinal || print ? "" : presentationControls(model,views),summary,
      body:longitudinal ? longitudinalOverview(model,true,print) : referenceOverview(model,true,print),screenItems:"",screenPill:longitudinal ? "各日期筛查关注人数" : "群体代表筛查评价",
      overview:longitudinal ? longitudinalOverview(model,false,print) : referenceOverview(model,false,print),referenceLabel:longitudinal ? "各日期有效个人评分的均值" : "统一口径的群体代表能力评分",legend:"",details:tools + detailsHTML(model,views,print)};
  }
  function layout(container, {print = false} = {}) {
    root.RingsideResultDisplay.layout(container,{print});
    if (!print) root.RingsideResultDisplay.mount(container);
    container.querySelectorAll(".team-personal-results").forEach(table => {
      const widths = [...table.querySelectorAll("[data-result-trend]")].map(node => Number.parseFloat(node.style.getPropertyValue("--result-trend-width")) || 160);
      table.style.setProperty("--result-trend-column-width", (Math.max(160,...widths) + (print ? 16 : 24)) + "px");
    });
    container.querySelectorAll("[data-team-figure]").forEach(node => {
      const width = print ? 680 : Math.max(250,Math.round(node.clientWidth || 720)), key = width + ":" + print;
      if (node.dataset.teamFigureLayout === key) return;
      node.innerHTML = root.RingsideLongitudinalView.draw(JSON.parse(node.dataset.teamFigure),width,print); node.dataset.teamFigureLayout = key;
    });
  }
  root.RingsideTeamComparisonView = {render,layout,comparisonTable,aggregateCell,objectSummary,pairedTable,personalHistory};
})(typeof window !== "undefined" ? window : globalThis);
