(function (root) {
  "use strict";
  const ids = ["fvp_sj", "fvp_cmj"];
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[character]);
  const present = value => value !== undefined && value !== null && String(value).trim() !== "";
  const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";
  function defaultTrial(load = "") {
    return { id:"fvp_" + root.crypto.randomUUID().replace(/-/g, ""), load, height:"", distanceCm:"", notes:"", excluded:false, exclusionReason:"" };
  }
  function read(record, id) {
    const solver = root.RingsideFVP?.read || root.RingsideFVP?.solve;
    return solver?.(record, id) || { valid:false, reason:"请录入原始跳跃数据" };
  }
  function feedback(record, id) {
    const rows = record.data?.[id] || [], measured = rows.filter(row => present(row.height)), included = measured.filter(row => !row.excluded);
    const result = read(record, id), loads = new Set(included.filter(row => present(row.load) && Number.isFinite(Number(row.load))).map(row => Number(row.load)));
    const missingReasons = measured.filter(row => row.excluded && !present(row.exclusionReason)).length;
    const summary = `${measured.length} 次测量 · ${loads.size} 个负荷${measured.length !== included.length ? ` · 排除 ${measured.length - included.length} 次` : ""}${missingReasons ? ` · ${missingReasons} 次原因待补充` : ""}`;
    if (!result.valid) return `<p class="note fvp-entry-status">${escape(summary)} · ${escape(result.reason || "至少录入 3 个不同负荷，并填写蹬伸距离")}</p>`;
    const groups = result.groups || [], groupRows = groups.map(group => {
      const n = group.n ?? group.selectedIds?.length ?? 0;
      const repeat = n >= 3 ? `${number(group.mean)} ± ${number(group.sd)} cm · CV ${number(group.cv)}%` : `${n} 次`;
      return `<tr><td data-label="附加负荷">${escape(number(group.load, 1))} kg</td><td data-label="采用高度">${escape(number(group.selectedHeightCm))} cm</td><td data-label="重复测量">${escape(repeat)}</td></tr>`;
    }).join("");
    const fit = result.fit || result.model || {}, r2 = fit.r2 ?? fit.rSquared;
    const imbalance = result.imbalancePct ?? result.imbalance?.magnitudePct, direction = result.judgments?.direction || result.imbalance?.label;
    const judgment = direction ? ` · ${escape(direction)}` : "";
    const profile = Number.isFinite(imbalance) ? ` · F–V 失衡 ${imbalance > 0 && imbalance < 0.01 ? "&lt;0.01" : number(imbalance)}%${judgment}` : judgment;
    return `<p class="note fvp-entry-status">${escape(summary)} · 每个负荷采用最高有效跳跃${Number.isFinite(r2) ? ` · R² ${number(r2, 3)}` : ""}${profile}</p><div class="table-wrap"><table class="entry-table fvp-load-summary"><thead><tr><th>附加负荷</th><th>采用高度</th><th>重复测量</th></tr></thead><tbody>${groupRows}</tbody></table></div>`;
  }
  function render(record, id, helpers) {
    if (!ids.includes(id)) throw Error("未知的跳跃 FVP 项目");
    const { input, check, field, table } = helpers, config = record.fvpConfig?.[id] || {}, rows = record.data?.[id] || [];
    const path = "fvpConfig." + id, trialPath = "data." + id;
    const controls = [
      field("测量设备", input(path + ".device", config.device, { type:"text", label:"测量设备", placeholder:"设备名称 / 型号" })),
      field("高度测量方法", input(path + ".method", config.method, { type:"text", label:"高度测量方法", placeholder:"腾空时间 / 起跳速度" })),
      field("动作姿势 / 下蹲深度", input(path + ".posture", config.posture, { type:"text", label:"动作姿势 / 下蹲深度", placeholder:id === "fvp_sj" ? "SJ 起始姿势" : "CMJ 下蹲深度" })),
      field("统一蹬伸距离 cm", input(path + ".distanceCm", config.distanceCm, { label:"统一蹬伸距离 cm", placeholder:"起始至起跳的重心上升距离" })),
      field("蹬伸距离来源", input(path + ".distanceSource", config.distanceSource, { type:"text", label:"蹬伸距离来源", placeholder:"髋高差实测 / 设备 / 估计" })),
    ].join("");
    const body = rows.map((row, index) => {
      const item = trialPath + "." + index;
      return [
        String(index + 1),
        input(item + ".load", row.load, { label:`第 ${index + 1} 次附加负荷 kg`, placeholder:"自重填 0" }),
        input(item + ".height", row.height, { label:`第 ${index + 1} 次垂直跳跃高度 cm` }),
        input(item + ".distanceCm", row.distanceCm, { label:`第 ${index + 1} 次蹬伸距离 cm`, placeholder:"沿用统一值" }),
        input(item + ".notes", row.notes, { type:"text", label:`第 ${index + 1} 次备注` }),
        check(item + ".excluded", row.excluded, "排除"),
        input(item + ".exclusionReason", row.exclusionReason, { type:"text", label:`第 ${index + 1} 次排除原因`, placeholder:"排除时填写" }),
        `<div class="row"><button type="button" class="btn small" onclick="App.addRow('${id}',${index})">同负荷再测</button><button type="button" class="remove" onclick="App.removeRow('${id}',${index})" aria-label="删除试次 ${index + 1}">删除</button></div>`,
      ];
    });
    return `<div class="fvp-entry"><div class="form-grid fvp-entry-protocol">${controls}</div><p class="note">至少测试 3 个不同负荷，建议 4–5 个；同一负荷可重复测试。附加负荷 0 kg 表示自重跳跃。单次蹬伸距离留空时沿用统一值。</p>${table(["试次", "附加负荷 kg", "垂直跳跃高度 cm", "蹬伸距离 cm", "备注", "排除", "排除原因", "操作"], body)}<button type="button" class="btn small" onclick="App.addRow('${id}')">增加试次</button><div data-fvp-entry-feedback="${id}" aria-live="polite">${feedback(record, id)}</div></div>`;
  }
  function update(record, id, container) {
    const scope = container || root.document;
    if (!ids.includes(id) || !scope?.querySelector) return;
    const target = scope.querySelector(`[data-fvp-entry-feedback="${id}"]`);
    if (target) target.innerHTML = feedback(record, id);
  }
  root.RingsideFVPEntry = Object.freeze({ render, feedback, update, defaultTrial, read });
})(window);
