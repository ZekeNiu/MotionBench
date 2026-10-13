(function (root) {
  "use strict";

  const kinds = [
    ["bar", "横向条形图", "展示报告采用的代表结果，适合较长的指标名称。"],
    ["column", "纵向柱状图", "展示报告采用的代表结果，不同单位分别绘图。"],
    ["trials", "试次点图", "展示每次试次的实测值，横轴保留真实试次编号。"],
    ["scatter", "X–Y 散点图", "仅绘制同一试次的有效配对，两个坐标轴分别标注单位。"],
    ["target", "目标对比图", "展示实测值与本次评价方案适用的目标。"],
    ["radar", "评分雷达图", "选择 3–8 项指标，各项按本次评价方案的明确规则转换为 0–100 分。"],
  ];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let state = null;
  const attempt = metric => root.RingsideTests?.isAttemptMetric(metric) ?? metric.entryScope === "attempt";
  const selectedMetrics = () => state.metrics.filter(metric => state.metricIds.includes(metric.id)).sort((a,b) => state.metricIds.indexOf(a.id)-state.metricIds.indexOf(b.id));
  const eligibleMetrics = () => state.kind === "trials" ? state.metrics.filter(attempt) : state.metrics;

  function read() {
    if (!state || !state.enabled) return {kind:"none"};
    if (state.kind === "scatter") return {kind:state.kind,metricIds:[state.xMetricId,state.yMetricId].filter(Boolean),xMetricId:state.xMetricId,yMetricId:state.yMetricId};
    return {kind:state.kind,metricIds:state.metricIds.slice()};
  }
  function snapshot() {
    return JSON.stringify(read());
  }
  function validate() {
    if (!state || !state.enabled) return {ok:true,error:""};
    if (!kinds.some(([kind]) => kind === state.kind)) return {ok:false,error:"请选择报告图表类型。"};
    if (state.kind === "scatter") {
      const x = state.metrics.find(metric => metric.id === state.xMetricId), y = state.metrics.find(metric => metric.id === state.yMetricId);
      if (!x || !y || x.id === y.id || !attempt(x) || !attempt(y)) return {ok:false,error:"散点图需要两个不同的试次指标；请先在本项目增加相应指标。"};
    } else {
      const selected = selectedMetrics();
      if (!selected.length) return {ok:false,error:state.kind === "trials" ? "试次点图需要至少一个试次指标。" : "请至少选择一个展示指标。"};
      if (selected.length !== state.metricIds.length) return {ok:false,error:"所选指标已不在本项目，请重新选择。"};
      if (state.kind === "trials" && selected.some(metric => !attempt(metric))) return {ok:false,error:"试次点图只能使用每次试次录入的指标。"};
      if (state.kind === "radar" && (selected.length < 3 || selected.length > 8)) return {ok:false,error:"评分雷达图需要选择 3–8 项指标。"};
    }
    return {ok:true,error:""};
  }
  function notify() {
    refreshControls();
    state?.onChange?.(read());
  }
  function metricLabel(metric) {
    return `${metric.name || "首个指标"}${metric.unit ? ` · ${metric.unit}` : ""}`;
  }
  function renderMetrics() {
    if (!state) return;
    const list = state.section.querySelector("[data-generic-metric-list]"), eligible = eligibleMetrics();
    const sorted = [...eligible.filter(metric => state.metricIds.includes(metric.id)).sort((a,b) => state.metricIds.indexOf(a.id)-state.metricIds.indexOf(b.id)),...eligible.filter(metric => !state.metricIds.includes(metric.id))];
    const chosen = state.metricIds.filter(id => eligible.some(metric => metric.id === id));
    list.innerHTML = sorted.map(metric => {
      const index = chosen.indexOf(metric.id), checked = index >= 0;
      return `<li class="generic-report-metric"><label><input type="checkbox" data-generic-metric="${esc(metric.id)}" ${checked?"checked":""}><span>${esc(metric.name || "首个指标")}<small>${esc(metric.unit || "无单位")} · ${attempt(metric)?"每次试次":"本次测试汇总"}</small></span></label><div class="generic-report-order"><button type="button" class="btn small" data-generic-order="up" data-metric-id="${esc(metric.id)}" aria-label="上移 ${esc(metric.name || "首个指标")}" ${!checked||index===0?"disabled":""}>↑</button><button type="button" class="btn small" data-generic-order="down" data-metric-id="${esc(metric.id)}" aria-label="下移 ${esc(metric.name || "首个指标")}" ${!checked||index===chosen.length-1?"disabled":""}>↓</button></div></li>`;
    }).join("") || `<li class="note">${state.kind === "trials" ? "本项目尚无每次试次录入的指标。" : "填写首个指标后即可选择展示。"}</li>`;
    const attempts = state.metrics.filter(attempt), options = `<option value="">请选择试次指标</option>`+attempts.map(metric => `<option value="${esc(metric.id)}">${esc(metricLabel(metric))}</option>`).join("");
    for (const [role,key] of [["X","xMetricId"],["Y","yMetricId"]]) {
      const select = state.section.querySelector(`#genericReport${role}`);select.innerHTML = options;select.value = state[key];
    }
  }
  function refreshControls() {
    if (!state) return;
    const section = state.section;
    section.querySelector("#genericReportEnabled").checked = state.enabled;
    section.querySelector("[data-generic-options]").hidden = !state.enabled;
    section.querySelector("#genericReportKind").value = state.kind;
    section.querySelector("[data-generic-kind-note]").textContent = kinds.find(([kind]) => kind === state.kind)?.[2] || "";
    section.querySelector("[data-generic-metrics]").hidden = state.kind === "scatter";
    section.querySelector("[data-generic-scatter]").hidden = state.kind !== "scatter";
    section.querySelector("[data-generic-radar-note]").hidden = state.kind !== "radar";
    section.querySelector("[data-generic-target-note]").hidden = state.kind !== "target";
    const validation = validate(), error = section.querySelector("[data-generic-validation]");
    error.hidden = validation.ok;error.textContent = validation.error;
    renderPreview();
  }
  function renderPreview() {
    const host = state.section.querySelector("#genericReportPreview");
    if (!state.enabled) {host.innerHTML = "";return;}
    const validation = validate();
    if (!validation.ok) {host.innerHTML = '<p class="note">完成指标选择后显示图样预览。</p>';return;}
    const chart = previewChart();
    host.innerHTML = root.RingsideViz?.generic ? root.RingsideViz.generic(chart,{width:480,height:260}) : '<p class="note">图样预览将在报告图表模块加载后显示。</p>';
  }
  function previewChart() {
    // All values are fixed style examples; this editor never reads measurements.
    const metrics = state.kind === "scatter" ? [state.xMetricId,state.yMetricId].map(id => state.metrics.find(metric => metric.id === id)) : selectedMetrics();
    let panels;
    if (state.kind === "scatter") panels = [{title:"试次配对示例",unit:"",xAxis:{id:metrics[0].id,label:metrics[0].name,unit:metrics[0].unit},yAxis:{id:metrics[1].id,label:metrics[1].name,unit:metrics[1].unit},points:[{id:"example_1",index:1,x:10,y:100},{id:"example_2",index:2,x:20,y:50},{id:"example_3",index:3,x:15,y:75}]}];
    else if (state.kind === "radar") panels = [{title:"示例分数",unit:"分",axes:metrics.map((metric,index) => ({id:metric.id,label:metric.name || "首个指标",value:50+(index*13)%45,status:"gray",tooltip:"样式示例分数"}))}];
    else {
      const units = new Map();metrics.forEach((metric,index) => {
        const unit = metric.unit || "";
        if (!units.has(unit)) units.set(unit,{title:unit || "无单位",unit,items:[],series:[]});
        const panel = units.get(unit), value = 38+index*17;
        panel.items.push({id:metric.id,label:metric.name || "首个指标",value,status:"gray",...(state.kind === "target"?{target:55+index*17}:{})});
        panel.series.push({id:metric.id,label:metric.name || "首个指标",status:"gray",points:[1,2,3].map((trial,i) => ({id:"example_"+trial,index:trial,value:value+[0,-5,8][i]}))});
      });
      panels = [...units.values()].map(panel => state.kind === "trials" ? {title:panel.title,unit:panel.unit,series:panel.series} : {title:panel.title,unit:panel.unit,items:panel.items});
    }
    return {kind:state.kind,available:true,reason:"",panels};
  }
  function updateMetrics(metrics) {
    if (!state) return;
    state.metrics = (metrics || []).filter(metric => metric && metric.id).map(metric => ({...metric}));
    const ids = new Set(state.metrics.map(metric => metric.id));
    state.metricIds = state.metricIds.filter(id => ids.has(id));
    if (!state.metricIds.length && !state.userSelectedMetrics) state.metricIds = state.metrics.map(metric => metric.id);
    const attempts = state.metrics.filter(attempt);
    if (!attempts.some(metric => metric.id === state.xMetricId)) state.xMetricId = attempts[0]?.id || "";
    if (!attempts.some(metric => metric.id === state.yMetricId)) state.yMetricId = attempts.find(metric => metric.id !== state.xMetricId)?.id || "";
    renderMetrics();refreshControls();
  }
  function destroy() {
    if (!state) return;
    state.section.removeEventListener("change",state.change);
    state.section.removeEventListener("click",state.click);
    state.section.remove();state = null;
  }
  function mount(host,{catalog,testId,isNew=false,onChange,metrics}={}) {
    destroy();
    const view = catalog?.reportViews?.[testId], enabled = !!view && view.kind !== "none";
    const section = document.createElement("fieldset");section.className = "catalog-edit-section generic-report-editor";
    section.innerHTML = `<legend>报告图表</legend><label class="generic-report-enable"><input id="genericReportEnabled" type="checkbox" ${enabled?"checked":""}>在报告中显示可视化图</label><p class="note">图表在左侧展示，右侧保留完整结果表。关闭后只展示表格。</p><div data-generic-options ${enabled?"":"hidden"}><div class="form-grid"><label class="field wide"><span>图表类型</span><select id="genericReportKind" aria-label="报告图表类型">${kinds.map(([kind,label]) => `<option value="${kind}">${label}</option>`).join("")}</select></label></div><p class="note" data-generic-kind-note></p><div data-generic-metrics><h3>展示指标与顺序</h3><ul class="generic-report-metrics" data-generic-metric-list aria-label="报告展示指标"></ul></div><div class="form-grid" data-generic-scatter hidden><label class="field"><span>X 轴指标</span><select id="genericReportX" aria-label="散点图 X 轴指标"></select></label><label class="field"><span>Y 轴指标</span><select id="genericReportY" aria-label="散点图 Y 轴指标"></select></label></div><p class="note" data-generic-radar-note hidden>实际报告要求每项都有适用的评分规则和有效测量；缺少任一项时保留表格并说明原因，不补零。</p><p class="note" data-generic-target-note hidden>目标来自各记录采用的评价方案；没有适用目标的指标仍保留实测结果。</p><p class="field-error" role="status" data-generic-validation hidden></p><div class="generic-report-preview"><h3>图样预览 <span>示例数据 · 仅用于预览样式</span></h3><div id="genericReportPreview" aria-label="报告图样示例"></div></div></div>`;
    const preview = host.querySelector("#catalogChangePreview");if (preview) host.insertBefore(section,preview);else host.append(section);
    state = {section,catalog,testId,isNew,onChange,enabled,kind:enabled?view.kind:"bar",metricIds:(view?.metricIds || []).slice(),xMetricId:view?.xMetricId || "",yMetricId:view?.yMetricId || "",metrics:[],userSelectedMetrics:!!view};
    state.change = event => {
      const control = event.target;
      if (control.id === "genericReportEnabled") state.enabled = control.checked;
      else if (control.id === "genericReportKind") {
        state.kind = control.value;
        if (state.kind === "trials") state.metricIds = state.metricIds.filter(id => state.metrics.some(metric => metric.id === id && attempt(metric)));
        renderMetrics();
      } else if (control.matches("[data-generic-metric]")) {
        const id = control.dataset.genericMetric;state.userSelectedMetrics = true;
        state.metricIds = control.checked ? [...state.metricIds.filter(value => value !== id),id] : state.metricIds.filter(value => value !== id);
        renderMetrics();
        [...section.querySelectorAll("[data-generic-metric]")].find(node => node.dataset.genericMetric === id)?.focus();
      } else if (control.id === "genericReportX") state.xMetricId = control.value;
      else if (control.id === "genericReportY") state.yMetricId = control.value;
      else return;
      notify();
    };
    state.click = event => {
      const button = event.target.closest("[data-generic-order]");if (!button || button.disabled) return;
      const index = state.metricIds.indexOf(button.dataset.metricId), next = index + (button.dataset.genericOrder === "up"?-1:1);
      if (index < 0 || next < 0 || next >= state.metricIds.length) return;
      [state.metricIds[index],state.metricIds[next]] = [state.metricIds[next],state.metricIds[index]];
      renderMetrics();notify();
      const replacement = [...section.querySelectorAll("[data-generic-order]")].find(node => node.dataset.metricId === button.dataset.metricId && node.dataset.genericOrder === button.dataset.genericOrder);
      if (replacement && !replacement.disabled) replacement.focus();
      else section.querySelector(`[data-generic-metric="${root.CSS?.escape?.(button.dataset.metricId) || button.dataset.metricId}"]`)?.focus();
    };
    section.addEventListener("change",state.change);section.addEventListener("click",state.click);
    updateMetrics(metrics === undefined ? catalog?.definitions?.filter(metric => metric.testId === testId) : metrics);
    return api;
  }
  const api = {mount,read,snapshot,validate,updateMetrics,destroy};
  root.RingsideGenericReportUI = api;
})(typeof window !== "undefined" ? window : globalThis);
