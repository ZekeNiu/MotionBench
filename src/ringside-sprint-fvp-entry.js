(function (root) {
  "use strict";
  const id = "sprint_fvp";
  const present = value => value !== undefined && value !== null && String(value).trim() !== "";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";
  function defaultTrial(distances = [5, 10, 20, 30]) {
    return {id:"sprint_" + root.crypto.randomUUID().replace(/-/g, ""), splits:distances.map(distanceM => ({id:"sprint_split_" + root.crypto.randomUUID().replace(/-/g, ""), distanceM, timeS:""})), excluded:false, exclusionReason:"", notes:""};
  }
  function feedback(record) {
    const rows = record.data?.[id] || [], measured = rows.filter(row => row.splits?.some(split => present(split.timeS)));
    const result = root.RingsideSprintFVP?.solve(record) || {valid:false, reason:"请录入原始分段计时"};
    const summary = `冲刺FVP · ${measured.length} 次测试${measured.some(row => row.excluded) ? ` · 排除 ${measured.filter(row => row.excluded).length} 次` : ""}`;
    if (!result.valid) return `<p class="note sprint-fvp-entry-status">${escape(summary)} · ${escape(result.reason || "请填写至少 4 个有效计时分段及体重、身高")}</p>`;
    const fit = result.model || {}, selected = result.selected || {}, index = rows.findIndex(row => row.id === (result.selectedTrialId || selected.id));
    const target = result.targetDistanceM ?? result.optimum?.distanceM;
    return `<p class="note sprint-fvp-entry-status">${escape(summary)} · 采用${index >= 0 ? `试次 ${index + 1}` : "最佳完整试次"} · F₀ ${number(fit.F0Relative ?? fit.F0)} N/kg · V₀ ${number(fit.V0)} m/s · Pmax ${number(fit.PmaxRelative ?? fit.Pmax)} W/kg${Number.isFinite(target) ? ` · 目标 ${number(target, 1)} m` : ""}</p>`;
  }
  function render(record, helpers) {
    const {input, select, check, field, table} = helpers;
    const config = {...root.RingsideSprintFVP?.defaultsConfig?.(), ...record.sprintFvpConfig}, rows = record.data?.[id] || [];
    const controls = [
      field("计时方式", select("sprintFvpConfig.inputTimeMode", config.inputTimeMode || "cumulative", [["cumulative", "累计计时"], ["interval", "逐段用时"]])),
      field("本次体重 kg", input("athlete.mass", record.athlete.mass, {label:"冲刺FVP本次体重 kg", min:0.000001})),
      field(`身高 cm · ${present(config.heightCm) ? "计算覆盖值" : "沿用本次记录"}`, input("sprintFvpConfig.heightCm", config.heightCm, {label:"冲刺FVP计算身高 cm", min:0.000001, placeholder:present(record.athlete.height) ? String(record.athlete.height) : "请填写身高"})),
      field("专项目标距离 m", input("sprintFvpAnalysis.targetDistanceM", record.sprintFvpAnalysis?.targetDistanceM ?? "", {label:"专项目标距离 m", min:0.000001, placeholder:"留空跟随最佳试次末段"})),
    ].join("");
    const advancedControls = [
      field("计时设备", input("sprintFvpConfig.device", config.device, {type:"text", label:"冲刺FVP计时设备"})),
      field("温度 °C", input("sprintFvpConfig.temperatureC", config.temperatureC, {label:"温度 °C", allowNegative:true})),
      field("气压 hPa", input("sprintFvpConfig.pressureHpa", config.pressureHpa, {label:"气压 hPa", min:0.000001})),
      field("风速 m/s · 顺风为正", input("sprintFvpConfig.windMps", config.windMps, {label:"风速 m/s 顺风为正", allowNegative:true})),
      field("计时起点", select("sprintFvpConfig.timingStart", config.timingStart || config.startConvention || "first_propulsive_action", [["first_propulsive_action", "首次推进动作"], ["gate_crossing", "通过计时门"], ["start_signal", "出发信号"], ["other", "其他"]])),
      field("累计时间修正 s · 加时为正，减时为负", input("sprintFvpConfig.timeCorrectionS", config.timeCorrectionS ?? 0, {label:"累计时间修正 s 加时为正减时为负", allowNegative:true})),
      field("空间起点距出发线 m", input("sprintFvpConfig.positionStartM", config.positionStartM ?? 0, {label:"空间起点距出发线 m"})),
    ].join("");
    const trials = rows.map((row, index) => {
      const path = `data.${id}.${index}`, interval = config.inputTimeMode === "interval";
      const splits = (row.splits || []).map((split, splitIndex) => [String(splitIndex + 1),
        input(`${path}.splits.${splitIndex}.distanceM`, split.distanceM, {label:`试次 ${index + 1} 第 ${splitIndex + 1} 段累计距离 m`, min:0.000001}),
        input(`${path}.splits.${splitIndex}.timeS`, split.timeS, {label:`试次 ${index + 1} 第 ${splitIndex + 1} 段${interval ? "分段" : "累计"}时间 s`, min:0.000001}),
        `<button type="button" class="remove" onclick="App.removeSprintSplit(${index},${splitIndex})" aria-label="删除试次 ${index + 1} 第 ${splitIndex + 1} 段">删除</button>`]);
      return `<article class="imtp-attempt sprint-fvp-attempt"><div class="imtp-attempt-head"><h4>试次 ${index + 1}</h4><button type="button" class="remove" onclick="App.removeRow('${id}',${index})" aria-label="删除冲刺FVP试次 ${index + 1}">删除试次</button></div>${table(["分段", "累计距离 m", interval ? "本段用时 s" : "累计时间 s", "操作"], splits)}<button type="button" class="btn small" onclick="App.addSprintSplit(${index})">＋ 增加分段</button><div class="form-grid">${field("试次备注", input(path + ".notes", row.notes, {type:"text", label:`冲刺FVP试次 ${index + 1} 备注`}))}${check(path + ".excluded", row.excluded, "排除此试次")}${field("排除原因", input(path + ".exclusionReason", row.exclusionReason, {type:"text", label:`冲刺FVP试次 ${index + 1} 排除原因`}))}</div></article>`;
    }).join("");
    return `<div class="sprint-fvp-entry"><div class="form-grid">${controls}</div><p class="note">距离均填累计距离。时间以秒填写小数：累计计时从同一计时起点算起；逐段用时为相邻分段之间的秒数。切换方式会转换所有已录试次的时间。</p><details class="supplement" data-sprint-fvp-entry-settings><summary>高级设置</summary><div class="form-grid">${advancedControls}</div><p class="note">修正只对累计时间加一次；没有自动起跑补时。累计距离从所注明的空间起点测量，至少记录四个有效测点，建议覆盖加速段。最佳剖面采用一条完整有效试次。目标距离改变时，最优冲刺FVP和发展方向同步更新。</p></details>${trials}<div class="row"><button type="button" class="btn small" data-sprint-fvp-template="four" onclick="App.addRow('${id}',-1,'four')">＋ 新增4段试次 · 5/10/20/30 m</button><button type="button" class="btn small" data-sprint-fvp-template="six" onclick="App.addRow('${id}',-1,'six')">＋ 新增6段试次 · 5/10/15/20/25/30 m</button></div><div data-sprint-fvp-entry-feedback aria-live="polite">${feedback(record)}</div></div>`;
  }
  function update(record, container) {
    const target = (container || root.document)?.querySelector?.("[data-sprint-fvp-entry-feedback]");
    if (target) target.innerHTML = feedback(record);
    const heightLabel = (container || root.document)?.querySelector?.('[data-path="sprintFvpConfig.heightCm"]')?.closest(".field")?.querySelector("span");
    if (heightLabel) heightLabel.textContent = `身高 cm · ${present(record.sprintFvpConfig?.heightCm) ? "计算覆盖值" : "沿用本次记录"}`;
  }
  root.RingsideSprintFVPEntry = Object.freeze({defaultTrial, render, feedback, update});
})(typeof window !== "undefined" ? window : globalThis);
