(function (global) {
  "use strict";
  const M = global.RingsideModel,
    T = global.RingsideTests,
    V = global.RingsideViz,
    N = global.Calc.num;
  const E = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const F = (value, digits = 1) =>
    N(value) === null
      ? "—"
      : Number(value).toLocaleString("zh-CN", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
  const positive = (value) => N(value) !== null && N(value) > 0;
  const directionLabel = (value) => String(value || "").replace(/[（(]中线[）)]/g, "");
  const pill = (label, status = "gray") =>
    `<span class="pill ${E(status)}"><i class="dot"></i>${E(label)}</span>`;
  const assessmentLabel = (status, fallback) => global.Def.assessmentLabel(status, fallback);
  // Display wording is independent of the stored reference labels and cutoffs.
  const reportEvaluation = (value, definition, record) => {
    const result = M.evaluation(value, definition, record);
    return { ...result, label: assessmentLabel(result.status, result.label) };
  };
  const table = (headers, rows, keys = [], className = "", widths = []) => {
    const evaluation = headers.indexOf("评价");
    if (evaluation >= 0 && !className.split(/\s+/).includes("jump-results") && rows.every((row) => !String(row[evaluation] || "").replace(/<[^>]*>/g, "").replace(/[—\s-]/g, ""))) {
      headers = headers.filter((_, i) => i !== evaluation);
      rows = rows.map((row) => row.filter((_, i) => i !== evaluation));
      widths = widths.filter((_, i) => i !== evaluation);
    }
    const cell = (value) => /with-repeat-columns|repeat-raw-table/.test(className) ? `<div class="result-cell">${value || "—"}</div>` : value || "—";
    const columns = widths.length === headers.length ? `<colgroup>${widths.map(width => `<col style="width:${width}%">`).join("")}</colgroup>` : "";
    return `<div class="table-wrap"><table${className ? ` class="${E(className)}"` : ""}>${columns}<thead><tr>${headers.map((h) => `<th scope="col">${E(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => `<tr${typeof keys[i] === "object" ? ` data-row-id="${E(keys[i].id)}" data-iso-region="${E(keys[i].region || "")}"` : keys[i] ? ` data-metric-id="${E(keys[i])}"` : ""}>${row.map((value, col) => `<td data-label="${E(headers[col])}">${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  };
  const check = (path, value, label) =>
    `<label class="row"><input type="checkbox" data-path="${E(path)}" aria-label="${E(label)}" ${value ? "checked" : ""}>${E(label)}</label>`;
  // Report-only references. These are not stored scores or AI prescriptions.
  const SPEED_GUIDE = {
    sources: [
      { id: "book", label: "Laursen & Buchheit · HIIT（2019）", url: "https://studylib.net/doc/28478875/2019-hiit-science-pro-book.pdf", location: "Figures 1.5, 4.13–4.17; chapter 5 p117" },
      { id: "nsca", label: "Buchheit & Laursen · NSCA（2021）", url: "https://studylib.net/doc/27727279/test-source-nsca-essentials-of-sport-science-2021", location: "Chapter 4: Periodization and Programming for Team Sports" },
      { id: "rst", label: "HIIT Science · RST", url: "https://hiitscience.com/repeated-sprints-football-training/", location: "What’s the Science say? Type4–5" },
      { id: "ratio-rst-passive", label: "Iaia et al. · Repeated-sprint recovery（2017）", url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0171462", location: "6 × 30 m sprints (approximately 5 s), 15 s or 30 s passive recovery" },
      { id: "ratio-long", label: "HIIT Science · Recovery", url: "https://hiitscience.com/hiit-recovery-insights/", location: "6×4 min; 2:1 work:recovery" },
      { id: "ratio-short", label: "Buchheit & Laursen · HIIT Part I", url: "https://martin-buchheit.net/wp-content/uploads/2018/01/buchheit-laursen-hit-solutions-to-the-programming-puzzle-part-i.pdf", location: "Section 3.1.2; 30 s/30 s and short-interval recovery" },
      { id: "ratio-short-2", label: "Almquist & Rønnestad · Short intervals", url: "https://hiitscience.com/optimizing-hiit-short-intervals/", location: "30 s work / 15 s recovery" },
      { id: "ratio-sit", label: "Koral et al. · Running SIT", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5839711/", location: "30 s all-out field running / 4 min recovery" },
      { id: "ratio-game", label: "Bujalance-Moreno et al. · Small-sided games", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8919881/", location: "4 min game / 2 min passive recovery" },
      { id: "srr-profile", label: "Malone & Buchheit · Locomotor profiles", url: "https://sportperfsci.com/wp-content/uploads/2025/09/SPSR264_Malone.pdf", location: "Methods p1; endurance <1.70, hybrid >1.70–<1.80, speed >1.80" },
    ],
    targets: ["① 有氧", "② 有氧＋神经肌肉", "③ 有氧＋无氧糖酵解", "④ 有氧＋无氧糖酵解＋神经肌肉", "⑤ 无氧糖酵解＋神经肌肉，有氧刺激相对有限", "⑥ 神经肌肉为主：速度、力量、爆发力（单独训练）"],
    formats: [
      { id: "long", name: "长间隔 HIIT", targets: "③④", goals: ["有氧能力＋无氧能力", "有氧能力＋无氧能力＋神经肌肉刺激"], work: "95–105% MAS；80–90% VIFT", mas: [.95, 1.05], vift: [.8, .9], duration: "＞1分钟，通常2–5分钟", activeRecovery: true, recovery: "主动≤60% MAS／≤45% VIFT", rest: "主动2–4分钟；被动1–3分钟", ratios: [{ work: 240, rest: 120, sourceId: "ratio-long" }], sourceIds: ["book", "nsca"] },
      { id: "short", name: "短间隔 HIIT", targets: "①②③④", goals: ["有氧能力", "有氧能力＋神经肌肉刺激", "有氧能力＋无氧能力", "有氧能力＋无氧能力＋神经肌肉刺激"], work: "100–120% MAS；90–105% VIFT", mas: [1, 1.2], vift: [.9, 1.05], duration: "10–60秒", activeRecovery: true, recovery: "主动≤60% MAS／≤45% VIFT；被动恢复", rest: "主动10–60秒；被动10–60秒", ratios: [{ work: 30, rest: 30, sourceId: "ratio-short" }, { work: 30, rest: 15, sourceId: "ratio-short-2" }], sourceIds: ["book", "nsca"] },
      { id: "rst", name: "反复冲刺训练 RST", targets: "④⑤", goals: ["有氧能力＋无氧能力＋神经肌肉刺激", "无氧能力＋神经肌肉刺激"], work: "全力以赴", sprint: true, duration: "3–10秒", activeRecovery: true, recovery: "主动≤60% MAS／≤45% VIFT；被动恢复", rest: "主动15–60秒；被动15–60秒", ratios: [{ work: 5, rest: 20, sourceId: "rst" }, { work: 5, rest: 15, recovery: "被动恢复", sourceId: "ratio-rst-passive" }, { work: 5, rest: 30, recovery: "被动恢复", sourceId: "ratio-rst-passive" }], sourceIds: ["nsca", "rst", "ratio-rst-passive"] },
      { id: "sit", name: "冲刺间歇训练 SIT", targets: "⑤", goals: ["无氧能力＋神经肌肉刺激"], work: "全力以赴", sprint: true, duration: "20–30秒", recovery: "被动恢复", rest: "1–4分钟被动恢复", ratios: [{ work: 30, rest: 240, sourceId: "ratio-sit" }], sourceIds: ["book"] },
      { id: "game", name: "基于比赛 HIIT", targets: "②③④", goals: ["有氧能力＋神经肌肉刺激", "有氧能力＋无氧能力", "有氧能力＋无氧能力＋神经肌肉刺激"], work: "全力以赴", duration: "2–5分钟", recovery: "被动恢复", rest: "1.5–2分钟被动恢复", ratios: [{ work: 240, rest: 120, context: "小场对抗", sourceId: "ratio-game" }], sourceIds: ["book", "nsca"] },
    ],
    recovery: { mas: .6, vift: .45 },
    // Adopted reference grouping; exact cutpoints go to the middle group.
    profile: { enduranceBelow: 1.7, speedAbove: 1.8, sourceId: "srr-profile" },
  };
  function buildSpeedReference(record, projects) {
    const protocol = record.data.ift.protocol,
      iftId = protocol === "treadmill" ? "ift_treadmill" : "ift_shuttle",
      order = ["mas_speed", "mss_speed", iftId],
      metrics = projects.flatMap((test) => test.metrics)
        .filter((metric) => order.includes(metric.id) && positive(metric.value))
        .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
      mas = metrics.find((metric) => metric.id === "mas_speed"),
      mss = metrics.find((metric) => metric.id === "mss_speed"),
      ift = metrics.find((metric) => metric.id === iftId),
      bases = { mas: mas?.value ?? null, vift: ift?.value ?? null },
      inconsistent = !!(mas && mss && mss.value < mas.value),
      srr = mas && mss && !inconsistent ? mss.value / mas.value : null;
    const speeds = (ratios) => Object.entries(ratios).flatMap(([basis, range]) =>
      bases[basis] !== null && range ? [{ basis, ratios: range, values: range.map((ratio) => bases[basis] * ratio) }] : []);
    return {
      available: metrics.length > 0,
      metrics,
      protocol,
      inconsistent,
      asr: mas && mss && !inconsistent ? mss.value - mas.value : null,
      srr,
      athleteType: srr === null ? null : srr < SPEED_GUIDE.profile.enduranceBelow ? "耐力型" : srr > SPEED_GUIDE.profile.speedAbove ? "速度型" : "混合型",
      sprintSpeed: mss?.value ?? null,
      rows: metrics.length ? SPEED_GUIDE.formats.map((format) => ({
        ...format,
        workSpeeds: speeds({ mas: format.mas, vift: format.vift }),
        recoverySpeeds: format.activeRecovery ? speeds({ mas: [SPEED_GUIDE.recovery.mas], vift: [SPEED_GUIDE.recovery.vift] }) : [],
      })) : [],
      targets: SPEED_GUIDE.targets,
      sources: SPEED_GUIDE.sources,
    };
  }
  function build(record) {
    const snapshot = JSON.parse(JSON.stringify(record));
    const stats = M.stats(snapshot);
    const projects = T.describe(snapshot).filter(
      (test) => snapshot.enabled[test.id],
    );
    const results = projects.map((test) => ({
      ...test,
      metrics: test.definitions
        .filter((d) => N(stats.values[d.id]) !== null)
        .map((d) => ({
          ...d,
          unit:
            d.id === "cmj_peak_force" ? snapshot.dsi.cmjUnit || "N" : d.unit,
          value: stats.values[d.id],
          evaluation: M.evaluation(stats.values[d.id], d, snapshot),
          attainment: M.attainment(stats.values[d.id], d),
        })),
    }));
    return {
      record: snapshot,
      stats,
      isoRadar: M.isoRadar(stats.isoAnalyses, snapshot),
      diagnostics: [],
      projects: results,
      groups: T.groups(results, snapshot),
      derived: stats.derived || { results: [] },
      speedReference: buildSpeedReference(snapshot, results),
    };
  }
  function summary(report) {
    const { record, stats: s } = report;
    const detailText = (item) => {
      const definition = record.definitions.find((d) => d.id === item.sourceId);
      if (!definition || !item.detail) return item.detail;
      const value = s.values[definition.id],
        original = M.evaluation(value, definition, record).label,
        displayed = reportEvaluation(value, definition, record).label;
      return original === displayed ? item.detail :
        item.detail.replace(" · " + original, " · " + displayed);
    };
    const card = (title, value, note, status = "gray") =>
      `<article class="micro-card"><div class="micro-head"><h3>${title}</h3></div><div class="micro-value ${status}">${value}</div><p>${note}</p></article>`;
    const athlete = record.athlete;
    const details = [
      ["专项", athlete.sport || "未填写"],
      ["年龄", N(athlete.age) !== null ? F(athlete.age, 0) + " 岁" : "未填写"],
      ["体重", positive(athlete.mass) ? F(athlete.mass, 1) + " kg" : "未填写"],
      ["性别", athlete.sex || "未注明"],
    ];
    let html = `<article class="micro-card athlete-summary"><div class="micro-head"><h3>运动员信息</h3></div><div class="micro-value text">${E(athlete.name || "未命名运动员")}</div><dl>${details.map(([label, value]) => `<div><dt>${E(label)}</dt><dd>${E(value)}</dd></div>`).join("")}</dl></article>`;
    for (const [status, title] of [
      ["red", assessmentLabel("red")],
      ["amber", "关注"],
    ]) {
      const items = s.findings.filter((item) => item.status === status);
      const note = items
        .slice(0, 2)
        .map((item) => ({ ...item, detail: detailText(item) }))
        .map((item) =>
          E(
            (item.title || item.label) +
              (item.detail
                ? "：" +
                  (item.detail.length > 65
                    ? item.detail.slice(0, 65) + "…"
                    : item.detail)
                : ""),
          ),
        )
        .join("；");
      html += card(
        title,
        items.length + "<small> 项</small>",
        note || "当前已测项目未触发此级别提示",
        items.length ? status : "gray",
      );
    }
    const advantage = s.advantages;
    html += card(
      "优势",
      advantage.relative
        ? advantage.items.length
          ? "相对强项"
          : "待评价"
        : advantage.items.length
          ? advantage.items.length + "<small> 项</small>"
          : "待评价",
      advantage.items.length
        ? advantage.items
            .map((x) => E(x.label || (x.ability ? T.abilityLabel(record, x.ability) : x.name)))
            .join("、")
        : E(advantage.reason || "暂无可判断项"),
      advantage.relative || !advantage.items.length ? "text gray" : "green",
    );
    return html;
  }
  function overview(report) {
    const cards = [], stats = report.stats;
    const add = (id, label, judgment, detail) => cards.push(`<div class="aux-metric" data-overview-metric="${E(id)}"><span class="aux-label">${E(label)}</span><strong class="aux-judgment">${E(judgment)}</strong><span class="aux-data">${E(detail)}</span></div>`);
    for (const id of ["fvp_sj", "fvp_cmj"]) {
      const solved = stats.fvp?.[id];
      if (!report.record.enabled[id] || !solved?.valid) continue;
      const label = id === "fvp_sj" ? "SJ" : "CMJ", angle = solved.analysis.angle;
      const direction = { force:"发展力量端", velocity:"发展速度端", balanced:"发展整体功率" }[solved.imbalance.direction];
      add(id, `${label} FVP · ${angle}°`, direction, `FVP的不平衡性 ${F(solved.imbalance.magnitudePct,2)}%`);
      const elastic = solved.elasticity;
      if (id === "fvp_sj" && elastic) add(id + "_elasticity", `${label} 弹性响应`, elastic.judgments.ER,
        `F₀ 与 V₀ 各提高 1%，垂直跳跃高度局部约增加 ${F(elastic.Fe + elastic.ve,2)}%`);
    }
    for (const id of ["fdsi", "eur", "srr"]) {
      const card = (stats.capabilityCards || []).find(card => card.metrics.some(metric => metric.id === id));
      const metric = card?.metrics.find(metric => metric.id === id);
      if (!metric || !Number.isFinite(metric.value)) continue;
      add(id, id === "fdsi" ? "DSI" : id.toUpperCase(), id === "srr" && card.conclusion ? card.conclusion : metric.judgment || metric.label,
        `${id === "fdsi" ? "DSI" : id.toUpperCase()} ${F(metric.value,3)}${metric.unit && metric.unit !== "比值" ? " " + metric.unit : ""}`);
    }
    return cards.join("");
  }
  function render(report) {
    const { record: state, stats: s, projects } = report,
      r = s.raw,
      v = s.values;
    const consumedMetrics = new Set();
    const consume = (metrics) => {
      metrics.forEach((d) => consumedMetrics.add(d.id));
      return metrics;
    };
    const definition = (id) => state.definitions.find((d) => d.id === id);
    const projectName = (id, defaultLabel) => {
      const project = projects.find((test) => test.id === id);
      const builtin = T.builtins.find((test) => test.id === id);
      return project?.name && project.name !== builtin?.name ? project.name : defaultLabel || project?.name || id;
    };
    const evaluationPill = (metric) => {
      const result = reportEvaluation(metric.value, metric, state);
      return ["未启用评价标准", "未设等级区间"].includes(result.label) ? "" : pill(result.label, result.status);
    };
    const thresholdLabel = (id) =>
      definition(id)?.name?.match(/\bLTP?[12]\b/i)?.[0] ||
      (id === "lt1" ? "阈值1" : "阈值2");
    const repeatedMetric = (id) => s.repetitions.flatMap((group) => group.statistics).find((metric) => metric.id === id);
    const hasStatistics = (metrics) => metrics.some((metric) => metric?.n >= 3);
    const statisticCells = (metric, prefix = "") => {
      if (!metric || metric.n < 3) return ["—", "—"];
      const label = prefix ? `<span class="stat-condition">${E(prefix)}</span>` : "";
      return [
        `<div class="repeat-stat-value" data-repeat-stat="${E(metric.id)}">${label}<span>${F(metric.mean, 2)} ± ${F(metric.sd, 2)}</span></div>`,
        `<div class="repeat-stat-cv">${label}<span>${metric.cv === null ? "—" : F(metric.cv, 1) + "%"}</span></div>`,
      ];
    };
    const metricTable = (metrics, target = false) => {
      const repeated = hasStatistics(metrics.map((d) => repeatedMetric(d.id)));
      return table(
        ["指标", "结果", ...(repeated ? ["均值 ± SD", "CV"] : ["单位"]), "评价", ...(target ? ["参考目标"] : [])],
        consume(metrics).map((d) => [
          E(d.name) + (repeated && d.unit ? `<small class="metric-meta">${E(d.unit)}</small>` : ""),
          F(d.value, 2),
          ...(repeated ? statisticCells(repeatedMetric(d.id)) : [E(d.unit)]),
          evaluationPill(d),
          ...(target ? [d.attainment !== null ? F(d.target, 2) + " " + E(d.unit) : "—"] : []),
        ]), metrics.map((d) => d.id), repeated ? "with-repeat-columns" : "",
      );
    };
    const supplemental = (tests) => {
      const metrics = tests.flatMap((t) =>
        t.metrics.filter(
          (d) => T.isManualMetric(d) && !consumedMetrics.has(d.id),
        ),
      );
      const notes = metrics
        .filter((d) => state.customValues[d.id]?.notes)
        .map(
          (d) =>
            `<p class="metric-note"><b>${E(d.name)}</b>：${E(state.customValues[d.id].notes)}</p>`,
        )
        .join("");
      return (metrics.length ? metricTable(metrics, true) : "") + notes;
    };
    function block(tests, title, meta, content, includeRepeats = true) {
      const [first, ...rest] = tests;
      const remainder = tests.flatMap((t) =>
        t.metrics.filter((d) => !consumedMetrics.has(d.id)),
      );
      if (remainder.length) content += metricTable(remainder, true);
      if (includeRepeats) content += tests.map(repeatPanel).join("");
      const abilities = [...new Set(tests.flatMap((test) => test.abilities))].map(key => T.abilityLabel(state, key));
      return `<article class="test-block" id="detail-${E(first.id)}" data-test-ids="${E(tests.map((t) => t.id).join(" "))}">${rest.map((t) => `<span class="test-anchor" id="detail-${E(t.id)}"></span>`).join("")}<div class="test-title"><div><h3>${E(title)}</h3>${meta ? `<p>${E(meta)}</p>` : ""}${abilities.length > 1 ? `<p class="ability-tags">${abilities.map(E).join(" · ")}</p>` : ""}</div></div>${content}</article>`;
    }
    const chart = (html, spec) => `<div class="chart-wrap${spec ? " adaptive-chart" : ""}"${spec ? ` data-chart-kind="${E(spec.kind)}" data-chart-input="${E(JSON.stringify(spec.args))}"` : ""}>${html}</div>`;
    const pair = (figure, data, className = "", spec) =>
      `<div class="detail-pair ${className}" data-pdf-pair>${chart(figure, spec)}<div class="detail-data">${data}</div></div>`;
    function repeatPanel(test) {
      if(test.id === "hop") return hopRawPanel(test);
      const groups = (report.stats.repetitions || []).filter((group) => group.testId === test.id);
      const nativeRaw = ["imtp", "lvp", "ball"].includes(test.renderer);
      const nativeRows = nativeRaw ? state.data[test.id] || [] : [];
      const orphaned = nativeRows.some((row) => (N(row.velocity) !== null || N(row.distance) !== null || row.notes)
        && !groups.some((group) => group.attempts.some((attempt) => attempt.id === row.id)));
      if (!groups.length && !orphaned) return "";
      const incomplete = groups.some((group) => group.attempts.length && group.representatives[group.primaryMetricId] === null);
      const imtpRaw = test.id === "imtp" ? rawTable(test) : "";
      const hasRepeated = groups.some((group) => group.attempts.length >= 2) || incomplete || orphaned || (imtpRaw && !report.stats.raw.imtp?.row);
      if (!hasRepeated) return "";
      const count = nativeRaw ? nativeRows.length : new Set(groups.flatMap((group) => group.attempts.map((row) => row.id))).size;
      const raw = nativeRaw ? rawTable(test) : groups.filter((group) => group.attempts.length).map((group) => {
        const fields = group.fields.filter((field) => group.attempts.some((row) => row.values[field.id] !== "" && row.values[field.id] != null));
        if (!fields.length) return "";
        const cell = (value) => N(value) === null ? E(value || "—") : F(value, 2);
        const isoRow=test.id==="iso"?state.data.iso.find(row=>row.id===group.directionId):null;
        const label = isoRow ? `${M.REG[isoRow.region]||isoRow.region} · ${directionLabel(isoRow.direction)}${group.side==="left"?" · L":group.side==="right"?" · R":""}` : group.label;
        const heading = groups.length > 1 ? `<h4>${E(label)}</h4>` : "";
        const rows = fields.length > 4 ? group.attempts.flatMap((row) => fields.map((field) => [row.index, E(field.label), cell(row.values[field.id]), E(field.unit), E([row.pain ? "疼痛" : "", row.notes].filter(Boolean).join(" · "))]))
          : group.attempts.map((row) => [row.index, ...fields.map((field) => cell(row.values[field.id])), E([row.pain ? "疼痛" : "", row.notes].filter(Boolean).join(" · "))]);
        return heading + table(fields.length > 4 ? ["试次", "指标", "结果", "单位", "备注"] : ["试次", ...fields.map((field) => field.label + (field.unit ? " · " + field.unit : "")), "备注"], rows, [], "repeat-raw-table");
      }).join("");
      return `<div class="repeat-panel" data-repeat-test="${E(test.id)}"><details class="attempt-details" id="trials-${E(test.id)}" data-raw-trials="${E(test.id)}" data-trial-title="${E(test.name)}"><summary>${E(test.name)} · 原始试次 · 共 ${count} 次</summary>${raw}</details></div>`;
    }
    function hopRawPanel(test) {
      const inputs=M.repeatRows(state,"hop"), entered=value=>N(value)!==null||typeof value==="string"&&value.trim()!=="";
      const sets=(r.hop?.sets||[]).map((set,index)=>({...set,number:index+1})).filter((set,index)=>{
        const input=inputs[index]||{},summary=input.summary||{};
        if(entered(input.notes)||entered(summary.notes))return true;
        if(input.inputMode==="jumps")return entered(summary.activeStiffness)||(input.jumps||[]).some(jump=>["height","contactTimeMs","flightTimeMs","notes"].some(key=>entered(jump[key])));
        return [...T.fieldsForTest("hop").map(field=>field.key),"suppliedCount","validCount","selectedCount"].some(key=>entered(summary[key]));
      });
      if(!sets.length)return "";
      const fields=[
        ["height","垂直跳跃高度 · cm",2],
        ["rsi","RSI · m/s",3],
        ["contactTimeMs","触地时间 · ms",1],
        ["flightTimeMs","腾空时间 · ms",1],
        ["flightTimeRatio","FT/CT",3],
        ["activeStiffness","Active Stiffness · kN/m",2],
      ].filter(([key])=>sets.some(set=>N(set.row?.[key])!==null));
      const rows=sets.map(set=>[set.number,...fields.map(([key,,digits])=>F(set.row?.[key],digits)),E(set.notes||"—")]);
      const detail=table(["完整测试",...fields.map(([,label])=>label),"备注"],rows,sets.map(set=>"hop-set-"+set.id),"repeat-raw-table hop-summary-table");
      return `<div class="repeat-panel" data-repeat-test="hop"><details class="attempt-details" id="trials-hop" data-raw-trials="hop" data-trial-title="${E(test.name)}"><summary>${E(test.name)} · 完整测试结果 · 共 ${sets.length} 次</summary>${detail}</details></div>`;
    }
    function rawTable(test) {
      const contract = test.dataContract || T.dataContract(state, test.id);
      const value = test.id === "iso" ? M.selectedIsoRows(state) : state.data[test.id];
      let rows = Array.isArray(value)
        ? value
        : value && typeof value === "object"
          ? [value]
          : [];
      if (test.id === "imtp") rows = rows.map(M.normalizeIMTP);
      const fields = contract.fields.filter(([key]) =>
        rows.some((row) => {
          const v = key.startsWith("metrics.")
            ? row.metrics?.[key.slice(8)]
            : row[key];
          return Array.isArray(v)
            ? v.length
            : v !== undefined && v !== null && v !== "" && v !== false;
        }),
      );
      if (!fields.length) return "";
      // One time point per raw row keeps long IMTP trials paginatable while
      // retaining trial metadata and notes exactly once.
      const displayRows = rows.flatMap((row, index) => test.id === "imtp" && row.timePoints.length
        ? row.timePoints.map((point, pointIndex) => ({ row, index, point, pointIndex }))
        : [{ row, index, point: null, pointIndex: 0 }]);
      return table(
        ["试次", ...fields.map(([, label]) => label)],
        displayRows.map(({ row, index, point, pointIndex }) => [
          index + 1,
          ...fields.map(([key]) => {
            if (pointIndex > 0 && key !== "timePoints") return "—";
            let value = key.startsWith("metrics.")
              ? row.metrics?.[key.slice(8)]
              : row[key];
            if (key === "timePoints")
              return (point ? [point] : value || [])
                .map(
                  (p) =>
                    `${E(p.timeMs === "" || p.timeMs == null ? "—" : p.timeMs)} ms：力 ${F(p.force, 2)} N；RFD ${F(p.rfd, 2)} N/s`,
                )
                .join("<br>");
            if (key === "region") value = M.REG[value] || value;
            return typeof value === "boolean"
              ? value
                ? "是"
                : "否"
              : N(value) !== null
                ? F(value, 2)
                : E(value || "—");
          }),
        ]),
        [], "repeat-raw-table",
      );
    }
    function fallback(tests, error) {
      report.diagnostics.push({
        testIds: tests.map((t) => t.id),
        message: String(error.message || error),
      });
      return tests
        .map((test) =>
          block(
            [test],
            test.name,
            "图形暂不可用，已显示有效数据",
            metricTable(test.metrics, true) + rawTable(test),
          ),
        )
        .join("");
    }
    const comparison = (metrics) => {
      if (!metrics.length) return "";
      consume(metrics);
      return `<div class="comparison-results">${metrics
        .map((d) => {
          const target = d.attainment !== null ? N(d.target) : null;
          const gap =
            target === null
              ? null
              : d.direction === "lower"
                ? d.value - target
                : target - d.value;
          const rate =
            target === null
              ? null
              : d.direction === "lower"
                ? d.value === 0
                  ? null
                  : (target / d.value) * 100
                : (d.value / target) * 100;
          const note =
            gap === null
              ? ""
              : gap > 0
                ? "距参考目标 " + F(gap) + " " + E(d.unit)
                : gap === 0
                  ? "达到参考目标"
                  : "超过参考目标 " + F(-gap) + " " + E(d.unit);
          return `<div class="comparison-result" data-metric-id="${E(d.id)}" data-pdf-atomic><div class="comparison-heading"><strong>${E(d.name)}</strong>${evaluationPill(d)}</div>${chart(V.compare([{ label: d.name, value: d.value, unit: d.unit, target, status: d.evaluation.status }], { title: "", compact: true }))}${note ? `<p class="comparison-note">${rate === null ? "" : "达成比例 " + F(rate) + "% · "}${note}</p>` : ""}</div>`;
        })
        .join("")}</div>`;
    };
    const renderers = {
      fms: (tests) => {
        const items = state.data.fms.map((item, i) => ({
          ...item,
          label: T.fmsAbilities[i],
          testName: item.name,
          score: r.fms?.scores[i] ?? null,
        }));
        const rows = state.data.fms.map((item, i) => [
          E(item.name),
          item.bilateral
            ? F(item.left, 0) + " / " + F(item.right, 0)
            : F(item.score, 0),
          item.pain ||
          (!item.bilateral && N(item.score) === 0) ||
          (item.bilateral && [N(item.left), N(item.right)].includes(0))
            ? pill("疼痛", "red")
            : "—",
          pill(
            r.fms?.scores[i] == null
              ? "未完成"
              : ["疼痛", "未完成动作", "代偿完成", "符合标准"][r.fms.scores[i]],
            r.fms?.items[i]?.status || "gray",
          ),
          E(item.notes || "—"),
        ]);
        const native = r.fms?.completed
          ? pair(
              V.fms(items),
              table(["动作", "左／右或单项", "疼痛", "评价", "备注"], rows),
              "fms-detail",
              { kind: "fms", args: [items] },
            )
          : "";
        return block(
          tests,
          projectName("fms", "FMS 动作表现"),
          (r.fms?.complete
            ? "总分 " + r.fms.total + " / 21"
            : r.fms?.completed
              ? "已录入 " + r.fms.completed + " / 7 个动作"
              : "") + (r.fms?.completed ? " · 沿用原动作 0–3 分评分" : ""),
          native + supplemental(tests),
        );
      },
      iso: (tests) => {
        const sideText = (row, side) => side.side;
        const radar = { ...report.isoRadar, axes: report.isoRadar.axes.map((axis) => ({
          ...axis,
          strengthSources: axis.strengthSources.map((source) => ({ ...source, label: directionLabel(source.label) })),
          symmetrySources: axis.symmetrySources.map((source) => ({ ...source, label: directionLabel(source.label) })),
        })) };
        const measured = s.isoAnalyses.filter((row) =>
          row.sides.some((side) => side.value !== null || side.pain),
        );
        const ids = new Set(measured.map((row) => row.id));
        const balancesByRow = new Map();
        for (const balance of s.balanceResults) {
          const owner = ids.has(balance.numeratorId)
            ? balance.numeratorId
            : ids.has(balance.denominatorId)
              ? balance.denominatorId
              : null;
          if (!owner) continue;
          if (!balancesByRow.has(owner)) balancesByRow.set(owner, []);
          balancesByRow.get(owner).push(balance);
        }
        // Compact wording is a display choice; keep the original assessment accessible.
        const statusPill = (prefix, status, description, ungraded = "") => {
          const label = assessmentLabel(status, ungraded);
          return `<span class="pill ${E(status)} iso-status" role="img" aria-label="${E(description)}" title="${E(description)}"><i class="dot"></i>${prefix ? `<span class="iso-status-value">${E(prefix)}</span>` : ""}${label ? ` <span class="iso-status-label">${label}</span>` : ""}</span>`;
        };
        const balanceCell = (row) =>
          (balancesByRow.get(row.id) || [])
            .filter((balance) => balance.results.some((result) => result.value !== null))
            .map((balance) => {
              const standard =
                balance.referenceEnabled && balance.ranges?.length
                  ? `<small class="metric-meta">标准 ${E(global.Def.rangeText(balance.ranges))}</small>`
                  : "";
              const values = balance.results
                .map((result) => {
                  const side = result.side ? result.side + " · " : "";
                  if (result.value === null) return `<div>${E(side)}-</div>`;
                  return `<div>${statusPill(
                    side + F(result.value, 2),
                    result.status,
                    side + F(result.value, 2) + " · " + assessmentLabel(result.status, result.label),
                    balance.referenceEnabled && balance.ranges?.length ? "未评" : "",
                  )}${positive(result.referenceTarget) ? `<small class="metric-meta iso-reference">参考目标 ${F(result.referenceTarget,2)}</small>` : ""}</div>`;
                })
                .join("");
              return `<div class="joint-balance-item" data-balance-id="${E(balance.id)}"><strong>${E(balance.label)}</strong>${values}${standard}</div>`;
            })
            .join("") || "-";
        const evaluationCell = (row, repeated) => {
          const available = row.sides.some((side) =>
            side.pain || ["amber", "red"].includes(side.status) || (side.value !== null && positive(side.target)),
          );
          if (!available) return "-";
          return row.sides.map((side) => {
            const label = side.side ? sideText(row, side) + " · " : "";
            const description = label + (side.reasons.length ? side.reasons.join("；") : "达到目标");
            const value = side.pain ? statusPill(label.trim(), "red", description)
              : side.value === null || (!positive(side.target) && !["amber", "red"].includes(side.status)) ? E(label) + "-"
              : side.referenceComparison && side.status === "gray"
                ? `<span class="iso-reference-evaluation">${E(label)}${E(side.referenceComparison.label)}</span>`
                : statusPill(label.trim(), side.status, description);
            return repeated ? `<div class="stat-side">${value}</div>` : value;
          }).join(repeated ? "" : "<br>");
        };
        const sideStatistics = (row) => row.sides.map((side) => {
          const key = side.side === "L" ? "left" : side.side === "R" ? "right" : "center";
          const group = s.repetitions.find((g) => g.testId === "iso" && g.directionId === row.id && g.side === key);
          return { side: side.side ? sideText(row, side) : "", metric: group?.statistics[0] };
        });
        const repeated = measured.some((row) => hasStatistics(sideStatistics(row).map((x) => x.metric)));
        const sideCells = (row) => [0, 1].map((col) => sideStatistics(row).map(({ side, metric }) =>
          `<div class="stat-side">${metric?.n >= 3 ? statisticCells(metric, side)[col] : E(side ? side + " —" : "—")}</div>`).join(""));
        const rows = measured.map((row) => [
          E((M.REG[row.region] || row.region) + " · " + directionLabel(row.direction)),
          row.sides
            .map(
              (side) => {
                const value = `${side.side ? E(sideText(row, side)) + " " : ""}${F(side.value)} ${E(row.unit)}${side.pain ? " · 疼痛" : ""}`;
                const target = positive(side.target)
                  ? `<small class="metric-meta">参考目标 ${F(side.target)} ${E(row.unit)}</small>` : "";
                return repeated ? `<div class="stat-side">${value}${target}</div>` : value + target;
              },
            )
            .join(repeated ? "" : "<br>"),
          ...(repeated ? sideCells(row) : []),
          row.asym === null
            ? "—"
            : `<span class="pill ${E(row.asymStatus)}"><i class="dot"></i><span class="asym-value">${F(row.asym)}% ·</span> <span class="asym-side">${row.weakSide ? E((row.weakSide === "L" ? "左" : "右") + "侧更弱") : "一致"}</span></span>`,
          evaluationCell(row, repeated),
          balanceCell(row),
        ]);
        const data = table(
          ["部位与方向", "实测力量／参考目标", ...(repeated ? ["均值 ± SD", "CV"] : []), "双侧差异", "评价", "关节平衡"],
          rows,
          measured.map((row) => ({ id: row.id, region: row.region })),
          "iso-results" + (repeated ? " with-repeat-columns" : ""),
          repeated ? [14,20,21,7,12,13,13] : [],
        );
        return block(
          tests,
          projectName("iso", "等长力量"),
          "各关节的力量水平与双侧对称性；具体测试结果见表。",
          pair(V.isoRadar(radar), data, "iso-detail", { kind: "isoRadar", args: [radar] }) +
            supplemental(tests),
        );
      },
      jumps: (tests) => {
        const summaries = tests.map((test) => ({ test, data: r[test.id] }));
        const chartItems=summaries.map(({test,data})=>({id:test.id,label:test.name,value:data?.row?.height,rsi:["dj","hop","cmrj"].includes(test.id)?data?.row?.rsi:null}));
        const fieldMap=new Map();
        tests.forEach(test=>T.attemptFields(state,test.id).forEach(field=>{
          const key=field.key||field.id;
          if(!fieldMap.has(key))fieldMap.set(key,{...field,ids:[],units:new Set()});
          fieldMap.get(key).ids.push(field.id);fieldMap.get(key).units.add(field.unit);
        }));
        const fields=[...fieldMap.values()].map(field=>({...field,unit:field.units.size===1?[...field.units][0]:""}));
        tests.forEach(test=>T.fieldsForTest(test.id).forEach(field=>consumedMetrics.add(test.id+"_"+field.suffix)));
        const activeFields = fields.filter(field=>["height","rsi"].includes(field.key))
          .filter((field) =>
            summaries.some(({ data }) =>
              data?.metrics.some(metric=>field.ids.includes(metric.id)&&metric.value!==null)||data?.attempts?.some((a) =>
                a.values.some(
                  (value) =>
                    field.ids.includes(value.id) && value.value !== null,
                ),
              ),
            ),
          );
        const repeated = hasStatistics(activeFields.flatMap((field) => field.ids.map(repeatedMetric)));
        const jumpCell = (test, data, field) => {
          const metric = data?.metrics.find((m) => field.ids.includes(m.id));
          if (!metric) return "—";
          consumedMetrics.add(metric.id);
          const d = test.metrics.find((m) => m.id === metric.id);
          return `<span data-metric-id="${E(metric.id)}">${F(metric.value, 2)}${metric.unit !== field.unit ? " " + E(metric.unit) : ""}</span>` +
            (metric.value === null ? "" : (d && positive(d.target) ? `<small class="metric-meta">参考目标 ${F(d.target)}</small>` : ""));
        };
        const metricRows = summaries.flatMap(({ test, data }) => activeFields.filter((field) =>
          field.ids.some((id) => data?.metrics.some((metric) => metric.id === id&&metric.value!==null)||data?.attempts?.some(attempt=>attempt.values.some(value=>value.id===id&&value.value!==null)))).map((field) => {
            const metric = data.metrics.find((m) => field.ids.includes(m.id));
            return [E(test.name + " · " + field.label) + `<small class="metric-meta">${E(field.unit || metric.unit)}</small>`,
              jumpCell(test, data, field), ...(repeated ? statisticCells(repeatedMetric(metric.id)) : []),
              test.metrics.find(item => item.id === metric.id) ? evaluationPill(test.metrics.find(item => item.id === metric.id)) : "—"];
          }));
        return block(
          tests,
          tests.map((t) => t.name).join(" / "),
          "",
          pair(
            V.jumpBars(chartItems),
            table(["指标", "结果", ...(repeated ? ["均值 ± SD", "CV"] : []), "评价"], metricRows, [], "jump-results" + (repeated ? " with-repeat-columns" : "")) +
              supplemental(tests),
            "jump-detail",
            {kind:"jumpBars",args:[chartItems]},
          ),
        );
      },
      ball: (tests) =>
        block(
          tests,
          tests[0].name,
          state.protocol.mb,
          comparison(tests[0].metrics.filter((d) => !T.isManualMetric(d))) +
            (hasStatistics(tests[0].metrics.map((d) => repeatedMetric(d.id))) ? metricTable(tests[0].metrics.filter((d) => !T.isManualMetric(d)), true) : "") +
            supplemental(tests),
        ),
      cpet: (tests) => {
        const measured = r.cpet, peakLabel = measured?.peak.label === "VO2max" ? "VO₂max" : "VO₂peak";
        const metrics = tests[0].metrics.map(metric => {
          let name = metric.name.replace(/^CPET /, "");
          if (metric.id === "cpet_vo2_relative") name = peakLabel + " · 相对摄氧量";
          if (metric.id === "cpet_vo2_absolute") name = peakLabel + " · 绝对摄氧量";
          for (const [index, key] of ["first", "second"].entries()) {
            if (metric.id.startsWith("cpet_threshold" + (index + 1) + "_"))
              name = name.replace("第 " + (index + 1) + " 阈值", (measured?.thresholds[key].label || "第 " + (index + 1) + " 阈值") + " ");
          }
          return { ...metric, name };
        });
        const meta = [measured?.modality === "treadmill" ? "跑台" : measured?.modality === "cycle" ? "功率车" : "", measured?.protocol, N(measured?.peak.rer) !== null ? "RER " + F(measured.peak.rer, 2) : ""].filter(Boolean).join(" · ");
        return block(tests, tests[0].name, meta, metricTable(metrics, true));
      },
      scalar: (tests) =>
        block(
          tests,
          tests[0].name,
          state.protocol[tests[0].id] || "",
          metricTable(tests[0].metrics, true) +
            tests[0].metrics
              .filter((d) => state.customValues[d.id]?.notes)
              .map(
                (d) =>
                  `<p class="metric-note"><b>${E(d.name)}</b>：${E(state.customValues[d.id].notes)}</p>`,
              )
              .join(""),
        ),
      imtp: (tests) => {
        const force = { ...r.forceTime, yAxis: state.views.imtp.yAxis };
        const metrics = consume(tests[0].metrics);
        const resultRows = ["imtp_peak_force", "imtp_relative_force"]
          .map((id) => metrics.find((metric) => metric.id === id)).filter(Boolean);
        for (const point of force.timeRows || []) {
          for (const kind of ["force", "rfd"]) {
            if (N(point[kind]) === null) continue;
            const id = "imtp_" + (kind === "force" ? "f" : "rfd") + point.timeMs;
            const original = metrics.find((metric) => metric.id === id);
            const standard = point[kind + "Standard"];
            resultRows.push({
              id, name: kind === "force" ? point.timeMs + " ms 力" : "0–" + point.timeMs + " ms RFD",
              value: point[kind], unit: kind === "force" ? "N" : "N/s",
              forcePercent: kind === "force" ? point.forcePercent : null,
              evaluation: point[kind + "Evaluation"] || original?.evaluation,
              target: standard ? (standard.referenceEnabled && standard.matched !== false ? standard.target : null) : original?.target,
              targetUnit: standard?.unit || original?.unit || (kind === "force" ? "N" : "N/s"),
              referenceEnabled: standard ? standard.referenceEnabled && standard.matched !== false : original?.referenceEnabled,
            });
          }
        }
        resultRows.push(...["imtp_impulse250","imtp_matched_impulse","imtp_matched_duration"].map(id=>metrics.find(metric=>metric.id===id)).filter(Boolean));
        resultRows.push(...metrics.filter((metric) => T.isManualMetric(metric)));
        const repeated = hasStatistics(resultRows.map((metric) => repeatedMetric(metric.id)));
        const data = resultRows.length ? table(
          ["指标", "结果", "单位", ...(repeated ? ["均值 ± SD", "CV"] : []), "评价", "参考目标"],
          resultRows.map((metric) => {
            const evaluation = metric.evaluation;
            const classified = evaluation && !["未启用评价标准", "未设等级区间", "未启用标准"].includes(evaluation.label);
            return [E(metric.name), F(metric.value, 2) + (N(metric.forcePercent) !== null ? `<small class="metric-meta">占峰值力 ${F(metric.forcePercent, 1)}%</small>` : ""), E(metric.unit),
              ...(repeated ? statisticCells(repeatedMetric(metric.id)) : []),
              classified ? pill(assessmentLabel(evaluation.status, evaluation.label), evaluation.status) : "—",
              metric.referenceEnabled && positive(metric.target) ? F(metric.target, 2) + " " + E(metric.targetUnit || metric.unit) : "—"];
          }), resultRows.map((metric) => metric.id), "imtp-results" + (repeated ? " with-repeat-columns" : ""),
        ) : "";
        const notes = metrics.filter((metric) => state.customValues[metric.id]?.notes)
          .map((metric) => `<p class="metric-note"><b>${E(metric.name)}</b>：${E(state.customValues[metric.id].notes)}</p>`).join("");
        return block(
          tests,
          projectName("imtp", "IMTP"),
          state.protocol.imtp,
          `<div class="chart-controls no-print"><label>纵轴 <select data-path="views.imtp.yAxis" aria-label="IMTP 纵轴"><option value="percent"${force.yAxis !== "force" ? " selected" : ""}>峰值百分比</option><option value="force"${force.yAxis === "force" ? " selected" : ""}>绝对力 N</option></select></label></div>` +
          pair(V.forceTime(force), data, "imtp-detail", { kind: "forceTime", args: [force] }) + notes,
        );
      },
      speed: (tests) => {
        const reference = report.speedReference,
          metrics = consume(reference.metrics),
          statuses = Object.fromEntries(metrics.map((d) => [d.testId, d.evaluation.status]));
        const repeated = hasStatistics(metrics.map((d) => repeatedMetric(d.id)));
        const rows = metrics.map((d) => {
          const method = [state.data[d.testId].method,
            d.testId === "ift" && N(report.stats.representativeData.ift.partial) !== null
              ? "未完成级 " + N(report.stats.representativeData.ift.partial) + " 秒" : ""].filter(Boolean).join(" · ");
          const name = projectName(d.testId);
          return [E(name) + (method ? `<small class="metric-meta">${E(method)}</small>` : ""),
            d.referenceEnabled && positive(d.target) ? F(d.target, 2) + " m/s" : "-",
            ...(repeated ? statisticCells(repeatedMetric(d.id)) : []),
            evaluationPill(d)];
        });
        const ratioTable = reference.srr !== null ? table(["速度比 MSS／MAS", "运动员类型"], [[
          `<strong data-speed-srr>${F(reference.srr, 2)}</strong>`,
          `<strong data-speed-type>${E(reference.athleteType)}</strong>`,
        ]], ["speed_ratio"], "speed-ratio-table") : "";
        const speedLines = (items, ratios, upper = false) => Object.entries(ratios).map(([basis, range]) => {
          const item = items.find((value) => value.basis === basis);
          const label = basis === "mas" ? "最大有氧速度（MAS）" : "30-15VIFT",
            ratio = range.map((p) => Math.round(p * 100)).join("–") + "%";
          return `<span class="speed-personal" ${item ? `data-speed-basis="${basis}"` : `data-speed-reference="${basis}"`}><span>${label}的${upper ? "≤" : ""}${ratio}</span>${item ? `<strong>${upper ? "≤" : ""}${item.values.map((value) => F(value, 2)).join("–")} m/s</strong>` : ""}</span>`;
        }).join("");
        const timing = (value) => value.split(/[，；]/).map((part) => `<span class="speed-time">${E(part)}</span>`).join("");
        const durationLabel = (seconds) => seconds >= 60 ? (seconds / 60) + "分钟" : seconds + "秒",
          commonDivisor = (a, b) => b ? commonDivisor(b, a % b) : a,
          restRatios = (ratios) => ratios.map((ratio) => {
            const divisor = commonDivisor(ratio.work, ratio.rest);
            return `<span class="speed-work-rest"><strong>${ratio.work / divisor}:${ratio.rest / divisor}</strong>` +
              `<span>${durationLabel(ratio.work)}／${durationLabel(ratio.rest)}</span>` +
              (ratio.recovery ? `<span>${E(ratio.recovery)}</span>` : "") +
              (ratio.context ? `<span>${E(ratio.context)}</span>` : "") + "</span>";
          }).join("");
        const trainingRows = reference.rows.map((row) => [
          `<strong>${E(row.name)}</strong>`,
          row.goals.map((goal) => `<span class="speed-goal">${E(goal)}</span>`).join(""),
          row.mas ? speedLines(row.workSpeeds, { mas: row.mas, vift: row.vift }) : `<span>${E(row.work)}</span>` +
            (row.sprint && reference.sprintSpeed !== null ? `<span class="speed-personal" data-speed-basis="mss"><span>实测最大冲刺速度（MSS）</span><strong>${F(reference.sprintSpeed, 2)} m/s</strong></span>` : ""),
          timing(row.duration),
          (row.activeRecovery ? `<div class="speed-recovery-option"><span>主动恢复</span>` + speedLines(row.recoverySpeeds, { mas: [SPEED_GUIDE.recovery.mas], vift: [SPEED_GUIDE.recovery.vift] }, true) + `</div><div class="speed-recovery-option">被动恢复</div>` : E(row.recovery)),
          timing(row.rest),
          restRatios(row.ratios),
        ]);
        const training = reference.available ? `<section class="speed-training"><h4 class="subheading">训练速度参考</h4>` +
          table(["形式", "生理目标", "训练速度", "做功时间", "恢复方式与速度", "恢复时间", "做功∶休息示例"], trainingRows,
            reference.rows.map((row) => ({ id: "hiit-" + row.id })), "speed-reference-table") +
          `</section>` : "";
        const speedChart = { mas: v.mas_speed, mss: v.mss_speed, ift: v.ift_speed, statuses,
          labels: Object.fromEntries(tests.map(test => [test.id, projectName(test.id, test.id === "ift" ? "30-15VIFT" : test.id.toUpperCase())])) };
        let body = metrics.length ? pair(V.speed(speedChart),
          table(["指标／测试方法", "参考目标", ...(repeated ? ["均值 ± SD · m/s", "CV"] : []), "评价"], rows, metrics.map((d) => d.id), "speed-test-info" + (repeated ? " with-repeat-columns" : "")) + ratioTable,
          "speed-detail", { kind: "speed", args: [speedChart] }) : "";
        const issues = s.qualityIssues.filter(
          (x) => x.id === "asr_inconsistent",
        );
        if (issues.length)
          body +=
            '<p class="notice">' +
            issues.map((x) => E(x.message)).join("；") +
            "</p>";
        return block(
          tests,
          metrics.length ? metrics.map((d) => projectName(d.testId, d.testId === "ift" ? "30-15VIFT" : d.testId.toUpperCase())).join(" / ") : tests.map((test) => test.name).join(" / "),
          "",
          body + training + supplemental(tests),
        );
      },
      lactate: (tests) =>
        block(
          tests,
          projectName("lactate", "递增负荷测试：乳酸与心率"),
          state.protocol.lactate,
          pair(
            V.lactate(r.lactate || [], {
              lt1: v.lt1,
              lt2: v.lt2,
              lt1Label: thresholdLabel("lt1"),
              lt2Label: thresholdLabel("lt2"),
              method: state.thresholds.method,
            }),
            metricTable(
              tests[0].metrics.filter((d) => !T.isManualMetric(d)),
              true,
            ) +
              table(
                ["速度 m/s", "乳酸 mmol/L", "心率 bpm"],
                state.data.lactate
                  .filter((x) =>
                    [x.speed, x.lactate, x.hr].some((v) => N(v) !== null),
                  )
                  .map((x) => [F(x.speed, 2), F(x.lactate, 2), F(x.hr, 0)]),
              ),
            "lactate-detail",
            { kind: "lactate", args: [r.lactate || [], { lt1: v.lt1, lt2: v.lt2, lt1Label: thresholdLabel("lt1"), lt2Label: thresholdLabel("lt2"), method: state.thresholds.method }] },
          ) + supplemental(tests),
        ),
    };
    const consumed = new Set(),
      grouped = new Map(),
      measured = projects.filter((t) => s.validTests.has(t.id) || repeatPanel(t));
    for (const test of measured.filter((t) => !["lvp","fvp","sprint-fvp"].includes(t.renderer))) {
      if (consumed.has(test.id)) continue;
      const peers =
        test.renderer === "speed"
          ? measured.filter((t) => t.renderer === "speed")
          : test.renderer === "jumps"
            ? measured.filter((t) => t.renderer === "jumps")
            : [test];
      peers.forEach((t) => consumed.add(t.id));
      const key = test.primaryAbility || "未分类",
        label = test.category === "screen" ? "筛查" : test.renderer === "speed" ? "速度与储备" : T.abilityLabel(state, key),
        id = test.category === "screen" ? "screen" : T.groupId(test.renderer === "speed" ? "速度与储备" : key);
      if (!grouped.has(id))
        grouped.set(id, { id, label, category: test.category, html: "" });
      try {
        if (!renderers[test.renderer]) throw Error("未注册的图表类型");
        grouped.get(id).html += renderers[test.renderer](peers);
      } catch (error) {
        grouped.get(id).html += fallback(peers, error);
      }
    }
    const screening = [...grouped.values()]
      .filter((g) => g.category === "screen")
      .map((g) => g.html)
      .join("");
    let performance = [...grouped.values()]
      .filter((g) => g.category !== "screen")
      .map(
        (g) =>
          `<div class="quality-group" id="${E(g.id)}"><div class="quality-heading"><h3>${E(g.label)}</h3></div>${g.html}</div>`,
      )
      .join("");
    const lvpTests = measured.filter((t) => t.renderer === "lvp");
    if (lvpTests.length) {
      try {
        performance +=
          '<div class="quality-group" id="ability-lvp"><div class="quality-heading"><h3>负荷速度曲线</h3></div><div class="lvp-grid">' +
          renderLVP("upper", s) +
          renderLVP("lower", s) +
          "</div>";
        for (const test of lvpTests) {
          const extras = supplemental([test]);
          performance += extras
            ? block([test], test.name, test.abilities.map(key => T.abilityLabel(state, key)).join(" · "), extras, false)
            : `<span class="test-anchor" id="detail-${E(test.id)}" data-test-ids="${E(test.id)}"></span>`;
        }
        performance += "</div>";
      } catch (error) {
        // Build the group before appending so an exception cannot leave broken markup.
        performance =
          [...grouped.values()]
            .filter((g) => g.category !== "screen")
            .map(
              (g) =>
                `<div class="quality-group" id="${E(g.id)}"><div class="quality-heading"><h3>${E(g.label)}</h3></div>${g.html}</div>`,
            )
            .join("") +
          '<div class="quality-group" id="ability-lvp"><div class="quality-heading"><h3>负荷速度曲线</h3></div>' +
          fallback(lvpTests, error) +
          "</div>";
      }
    }
    return `<details class="details-group" id="screenDetail" open><summary>损伤风险筛查<span>动作表现 · 双侧差异 · 关节平衡</span></summary><div class="quality-group">${screening || '<div class="empty">尚无筛查结果</div>'}</div></details><details class="details-group" id="performanceDetail" open><summary>运动表现测试<span>能力表现与测试结果</span></summary>${performance || '<div class="quality-group"><div class="empty">尚无运动表现结果</div></div>'}</details>${renderCapabilities()}`;
    function renderCapabilities() {
      return renderCapabilityAnalysis(report);
    }
    // LVP is a shared comparison renderer across its explicitly registered projects.
    function renderLVP(limb, s) {
      const upper = limb === "upper",
        key = upper ? "lvpUpper" : "lvpLower",
        ids = upper
          ? ["bench", "landmineR", "landmineL"]
          : ["squat", "deadlift"],
        all = s.lvpSeries.filter((x) => ids.includes(x.id)).map(series => ({ ...series,
          label: projectName(series.testId, series.label) +
            (series.testId === "landmine" && projectName(series.testId, series.label) !== series.label ? " " + series.id.slice(-1) : "") })),
        view = state.views[key];
      let selected = all.filter(
        (x) => view.selected.includes(x.id) && x.points.length,
      );
      if (
        !view.selectionExplicit &&
        !selected.length &&
        all.some((x) => x.points.length)
      ) {
        selected = [all.find((x) => x.points.length)];
      }
      const opts = {
        showPoints: view.showPoints,
        showBand: view.bandExplicit ? view.showBand : selected.length === 1,
        showEstimate: view.showEstimate,
      };
      const menu = `<details id="lvp-menu-${limb}" class="multi-select no-print"><summary>选择动作 ⌄</summary><div class="multi-options">${all.map((x) => `<label><input type="checkbox" aria-label="${E(x.label)}" data-lvp-limb="${limb}" data-lvp-id="${E(x.id)}" ${selected.some((item) => item.id === x.id) ? "checked" : ""}>${E(x.label)}${x.points.length ? "" : " · 未录入"}</label>`).join("")}</div></details>`;
      const seriesGroups = (series) => s.repetitions.filter((g) => g.testId === series.testId && (!g.side || series.id === g.testId + g.side));
      const repeated = all.some((series) => hasStatistics(seriesGroups(series).flatMap((g) => g.statistics)));
      const loadCells = (series) => [0, 1].map((col) => seriesGroups(series).filter((g) => g.statistics[0]?.n >= 3).map((g) =>
        `<div class="stat-load">${statisticCells(g.statistics[0], F(g.load, 0) + " kg")[col]}</div>`).join("") || "—");
      const rows = all
        .filter((x) => x.points.length)
        .map((x) => [
          E(x.label),
          x.fit.a !== null
            ? "v = " +
              F(x.fit.a, 3) +
              (x.fit.b < 0 ? " − " : " + ") +
              F(Math.abs(x.fit.b), 4) +
              " × L"
            : "—",
          x.fit.valid ? F(x.fit.r2, 3) : "—",
          x.est?.valid ? F(x.est.load) + " kg" : "—",
          x.est?.valid && positive(state.athlete.mass)
            ? F(x.est.load / state.athlete.mass, 2)
            : "—",
          x.metric,
          ...(repeated ? loadCells(x) : []),
        ]);
      const zoneRows = all
        .filter((x) => x.points.length)
        .flatMap((x) =>
          (x.zoneLoads || []).map((z) => [
            E(x.label),
            E(z.label),
            F(z.min, 2) + "–" + F(z.max, 2),
            z.valid === false
              ? "—"
              : F(z.loadMin ?? z.minLoad) + "–" + F(z.loadMax ?? z.maxLoad),
            z.extrapolated ? "含外推" : "实测范围",
          ]),
        );
      return `<article class="lvp-card" id="lvp-${limb}"><div class="test-title"><h3>${upper ? "上肢" : "下肢"} LVP</h3></div><div class="lvp-controls no-print">${menu}${check("views." + key + ".showPoints", opts.showPoints, "实测点")}${check("views." + key + ".showBand", opts.showBand, "95%置信带")}${check("views." + key + ".showEstimate", opts.showEstimate, "估计点")}</div><div class="detail-pair${repeated ? " wide-results" : ""}" data-pdf-pair><div class="chart-wrap adaptive-chart" data-chart-kind="lvp" data-chart-input="${E(JSON.stringify([selected.map((x) => ({ ...x, estimate: x.est })), opts]))}">${
        selected.length
          ? V.lvp(
              selected.map((x) => ({ ...x, estimate: x.est })),
              opts,
            )
          : '<div class="empty">选择已有数据的动作</div>'
      }</div><div class="lvp-table detail-data">${rows.length ? table(["动作", "回归方程", "R²", "预估1RM", "体重比 kg/kg", "速度口径", ...(repeated ? ["速度均值 ± SD · m/s", "CV"] : [])], rows, [], repeated ? "lvp-results with-repeat-columns" : "") : ""}${zoneRows.length ? table(["动作", "素质区间", "速度 m/s", "负荷 kg", "范围"], zoneRows) : ""}</div></div>${report.projects.filter((test) => all.some((series) => series.testId === test.id)).map(repeatPanel).join("")}</article>`;
    }
  }
  function renderCapabilityAnalysis(report, { print = false } = {}) {
    const { record, stats } = report;
    const cards = (stats.capabilityCards || []).map(card => ({ ...card,
      metrics: (card.metrics || []).filter(metric => N(metric.value) !== null),
    })).filter(card => card.metrics.length);
    const fvp = renderFVPAnalysis(report, { print }), sprint = renderSprintFVPAnalysis(report, { print });
    if (!cards.length && !fvp && !sprint) return "";
    const source = id => cards.find(card => card.id === id);
    const byId = id => cards.flatMap(card => card.metrics).find(metric => metric.id === id);
    const impulseName = id => id === "idsi_fixed250" ? "iDSI · 固定 0–250 ms" : "iDSI · 匹配 CMJ 推进期";
    const impulse = id => {
      const result = (stats.derived?.results || report.derived?.results || []).find(item => item.id === id);
      return result && { ...result, label: impulseName(id), judgment: result.directionHint, status: "gray" };
    };
    const format = metric => F(metric?.value, Number.isInteger(metric?.digits) ? metric.digits
      : metric?.unit === "比值" || /rsi|eur|fdsi|idsi|rqr|srr/.test(metric?.id || "") ? 3 : metric?.unit === "%" ? 1 : 2);
    const unit = metric => metric?.unit && metric.unit !== "比值" ? ` <small>${E(metric.unit)}</small>` : "";
    const selectedFvp = record.views?.fvpProtocol;
    const jumpEntries = Object.entries(stats.fvp || {}).filter(([id]) => record.enabled[id]
      && (record.data[id] || []).some(row => N(row.height) !== null || N(row.load) !== null || row.notes));
    const jumpId = jumpEntries.find(([id]) => id === selectedFvp)?.[0] || jumpEntries[0]?.[0] || selectedFvp || "fvp_sj";
    const jump = stats.fvp?.[jumpId], sprintSolved = stats.sprintFvp;
    const jumpMetric = { id: "fvp", label: `${jumpId === "fvp_cmj" ? "CMJ" : "SJ"} FVP 不平衡性`,
      value: jump?.valid ? jump.imbalance?.magnitudePct : null, unit: "%", digits: 2,
      judgment: jump?.valid ? jump.imbalance?.label : "待计算", status: "gray" };
    const sprintMetric = { id: "sprint_fvp", label: "冲刺 FVP 不平衡性", value: sprintSolved?.valid ? sprintSolved.imbalance?.magnitudePct : null,
      unit: "%", digits: 2, judgment: sprintSolved?.imbalance?.label || "待计算", status: "gray" };
    const options = {
      strength: [["fvp", "FVP 不平衡性"], ["fdsi", "DSI"], ["idsi_matched", impulseName("idsi_matched")], ["idsi_fixed250", impulseName("idsi_fixed250")], ["eur", "EUR"]],
      reactive: [["dj_rsi", "DJ RSI"], ["hop_rsi", "Hop RSI"], ["cmrj_rsi", "CMRJ RSI"]],
      speed: [["sprint_fvp", "冲刺 FVP 不平衡性"], ["srr", "SRR"]],
    };
    const candidate = id => id === "fvp" ? jumpMetric : id === "sprint_fvp" ? sprintMetric
      : id.startsWith("idsi_") ? impulse(id) : byId(id);
    const choice = key => {
      const saved = record.views?.capabilitySelections?.[key];
      return options[key].some(([id]) => id === saved) ? saved
        : options[key].find(([id]) => N(candidate(id)?.value) !== null)?.[0] || options[key][0][0];
    };
    const judgmentFor = (key, metric) => {
      if (N(metric?.value) === null) return "待计算";
      if (key === "reactive") return metric.judgment
        ? (metric.status === "red" || metric.status === "amber" ? "优先提高反应力量 · " : metric.status === "green" ? "保持并巩固反应力量 · " : "当前 RSI 标准 · ") + assessmentLabel(metric.status, metric.judgment)
        : "已测量；在评价标准中选择 RSI 参考。";
      if (metric.id === "eur") {
        const definition = record.definitions.find(item => item.id === "eur");
        const grade = definition?.referenceEnabled ? M.evaluation(metric.value, definition, record) : null;
        return grade?.range ? assessmentLabel(grade.status, grade.label) : "结合 CMJ 与 SJ 的绝对成绩和纵向变化判断发展方向。";
      }
      return metric.judgment ? assessmentLabel(metric.status, metric.judgment) : "待判断";
    };
    const directionCard = (key, title) => {
      const selected = choice(key), metric = candidate(selected) || { id: selected, label: options[key].find(([id]) => id === selected)?.[1], value: null };
      const selector = print ? "" : `<label class="capability-selector no-print">判断依据<select data-capability-selection="${key}" aria-label="${E(title)}判断依据">${options[key].map(([id, label]) => `<option value="${id}"${id === selected ? " selected" : ""}>${E(label)}</option>`).join("")}</select></label>`;
      const basis = selected === "fvp" && jump?.valid ? `${jump.analysis?.angle || 90}° 目标方向`
        : selected === "sprint_fvp" && positive(sprintSolved?.targetDistanceM) ? `目标距离 ${F(sprintSolved.targetDistanceM, 1)} m` : "";
      return `<article class="capability-direction-card" data-capability-direction="${key}"><h3>${E(title)}</h3>${selector}<section data-direction-metric="${E(selected)}"><p class="capability-direction-basis">${E(metric.label)}</p><p class="capability-direction-value">${format(metric)}${unit(metric)}</p>${basis ? `<p class="capability-direction-context">${E(basis)}</p>` : ""}<p class="capability-direction-judgment ${E(metric.status || "gray")}">${E(judgmentFor(key, metric))}</p></section></article>`;
    };
    const cardio = source("cardio"), cardioPrimary = cardio?.metrics.find(metric => /^cpet_vo2_/.test(metric.id)) || cardio?.metrics[0];
    const endurance = `<article class="capability-direction-card" data-capability-direction="endurance"><h3>耐力发展方向</h3><section data-direction-metric="${E(cardioPrimary?.id || "endurance")}"><p class="capability-direction-basis">${E(cardioPrimary?.label || "心肺与阈值表现")}</p><p class="capability-direction-value">${format(cardioPrimary)}${unit(cardioPrimary)}</p><p class="capability-direction-judgment">${E(cardio?.conclusion || (cardioPrimary?.judgment ? assessmentLabel(cardioPrimary.status, cardioPrimary.judgment) : cardioPrimary ? "已测量；按当前心肺与阈值目标判断。" : "待计算"))}</p></section></article>`;
    const left = `<div class="capability-direction-grid">${directionCard("strength", "力量发展方向")}${directionCard("reactive", "反应力量水平")}${directionCard("speed", "速度发展方向")}${endurance}</div>`;
    const target = metric => {
      const definition = record.definitions.find(item => item.id === metric.id);
      const value = positive(metric.target) ? N(metric.target) : definition?.referenceEnabled && definition.matched !== false && positive(definition.target) ? N(definition.target) : null;
      return value === null ? "" : `参考目标 ${F(value, 1)}${metric.unit && metric.unit !== "比值" ? " " + E(metric.unit) : ""}${positive(metric.value) ? ` · 达成 ${F(metric.value / value * 100, 1)}%` : ""}`;
    };
    const parameterGroup = card => {
      const rows = [];
      const add = metric => {
        const note = target(metric), components = card.id === "speed" ? [] : (metric.components || []).filter(component => N(component.value) !== null);
        const assessment = metric.judgment ? `<p class="capability-parameter-judgment ${E(metric.status || "gray")}">${E(assessmentLabel(metric.status, metric.judgment))}</p>` : "";
        const componentData = components.length ? `<dl class="capability-parameter-components">${components.map(component => `<div data-capability-component="${E(component.id || component.label)}"><dt>${E(component.label)}</dt><dd>${format(component)}${unit(component)}${component.judgment ? `<p class="capability-component-judgment ${E(component.status || "gray")}">${E(assessmentLabel(component.status, component.judgment))}</p>` : ""}${target(component) ? `<p class="capability-parameter-target">${target(component)}</p>` : ""}</dd></div>`).join("")}</dl>` : "";
        const folded = components.length || (metric.judgment || "").length > 26;
        const detail = folded ? `<details class="capability-parameter-notes"><summary>${components.length ? "组成数据与解读" : "参数解读"}</summary>${componentData}${assessment}</details>` : assessment;
        const progress = positive(metric.target) && positive(metric.value) ? `<div class="capability-progress-track" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, metric.value / metric.target * 100))}%"></span></div>` : "";
        rows.push(`<tr data-capability-metric="${E(metric.id)}"><td>${E(metric.label)}</td><td><span class="capability-value">${format(metric)}${unit(metric)}</span>${note ? `<p class="capability-parameter-target">${note}</p>${progress}` : ""}${detail}</td></tr>`);
      };
      const ordered = card.id === "speed" ? [...card.metrics].sort((a, b) => ["srr", "mss_speed", "mas_speed", "asr"].indexOf(a.id) - ["srr", "mss_speed", "mas_speed", "asr"].indexOf(b.id)) : card.metrics;
      for (const metric of ordered) {
        if (metric.id === "idsi") {
          const variants = ["idsi_matched", "idsi_fixed250"].map(impulse).filter(item => N(item?.value) !== null);
          if (variants.length) variants.forEach(add);
          else add(metric);
        } else {
          add(metric);
        }
      }
      const labels = { strength: "力量参数", reactive: "反应力量参数", speed: "速度与速度储备参数", cardio: "心肺与阈值参数" };
      const targets = (card.targets || []).filter(item => N(item.value) !== null);
      return `<section class="capability-parameter-group" data-capability-card="${E(card.id)}"><div class="capability-parameter-heading"><h3>${E(labels[card.id] || card.title)}</h3>${card.conclusion ? `<p class="capability-parameter-conclusion">${E(card.conclusion)}</p>` : ""}</div><div class="table-wrap"><table class="capability-parameter-table"><thead><tr><th scope="col">参数</th><th scope="col">结果与参考</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>${targets.length ? `<div class="capability-targets">${targets.map(item => `<p>${E(item.label)} ${F(item.value, 1)} ${E(item.unit)}</p>`).join("")}</div>` : ""}</section>`;
    };
    const right = cards.length ? cards.map(parameterGroup).join("") : '<p class="empty">完成测试后显示能力参数。</p>';
    return `<details class="details-group" id="trainingAnalysisDetail" open><summary>${E(T.analysisLabel)}</summary><div class="quality-group">${fvp}${sprint}<div class="detail-pair capability-structure-pair" data-capability-analysis data-pdf-pair data-pdf-title="能力结构分析"><div class="capability-directions">${left}</div><div class="detail-data capability-parameter-column"><div class="capability-parameter-groups">${right}</div></div></div></div></details>`;
  }
  function sprintFvpChartData(solved) {
    const profiles = [], add = (profile, kind, label) => {
      if (profile?.valid && positive(profile.F0) && positive(profile.V0)) profiles.push({ kind, label, F0: profile.F0, V0: profile.V0, Pmax: profile.Pmax });
    };
    add(solved.model, "current", "当前冲刺剖面");
    add(solved.optimum, "optimum", `${F(solved.targetDistanceM, 1)} m 最优`);
    return { kind: "sprint", id: "sprint_fvp", valid: !!solved.valid, reason: solved.reason, profiles, points: [], band: [] };
  }
  function renderSprintFVPAnalysis(report, { print = false } = {}) {
    const { record, stats } = report, solved = stats.sprintFvp;
    if (!record.enabled.sprint_fvp || !solved || !(record.data.sprint_fvp || []).some(row => (row.splits || []).some(split => N(split.distanceM) !== null || N(split.timeS) !== null))) return "";
    const builtin = T.builtins.find(test => test.id === "sprint_fvp"), displayName = report.projects.find(test => test.id === "sprint_fvp")?.name;
    const title = displayName && displayName !== builtin?.name ? displayName : "分段计时冲刺 F–V/P–V";
    const model = solved.model || {}, optimal = solved.optimum?.valid ? solved.optimum : {}, graph = sprintFvpChartData(solved), rows = [];
    const add = (label, current, best, unit, digits = 2) => rows.push([`${E(label)}<small class="fvp-unit">${E(unit)}</small>`, F(current, digits), F(best, digits)]);
    if (solved.valid) {
      add("力量端 F₀", model.F0, optimal.F0, "N/kg");
      add("速度端 V₀", model.V0, optimal.V0, "m/s", 3);
      add("最大功率 Pmax", model.Pmax, optimal.Pmax, "W/kg");
      add("力量端 F₀ · 绝对", model.F0Absolute, optimal.F0Absolute, "N", 1);
      add("最大功率 Pmax · 绝对", model.PmaxAbsolute, optimal.PmaxAbsolute, "W", 1);
      add("剖面斜率 SFV", model.slope, optimal.slope, "(N/kg)/(m/s)", 3);
      add("RF max", N(model.RFmax) === null ? null : model.RFmax * 100, null, "%", 1);
      add("DRF", model.DRF, null, "百分点/(m/s)", 3);
      add("速度模型渐近值 Vmax", solved.fit?.vmax, null, "m/s", 3);
      const endVelocity = solved.fit?.vmax > 0 && solved.fit?.tau > 0 ? solved.fit.vmax * (1 - Math.exp(-solved.selected.endTimeS / solved.fit.tau)) : null;
      add("终点速度", endVelocity, null, "m/s", 3);
      add("峰值功率对应速度 Vopt", N(model.V0) === null ? null : model.V0 / 2, N(optimal.V0) === null ? null : optimal.V0 / 2, "m/s", 3);
    }
    const follows = N(record.sprintFvpAnalysis?.targetDistanceM) === null;
    const distanceText = positive(solved.targetDistanceM) ? `目标冲刺距离 ${F(solved.targetDistanceM, 1)} m${follows ? " · 跟随当前测试末段" : " · 专项目标"}` : "目标冲刺距离待确定";
    const controls = print ? "" : `<form class="sprint-target-form no-print" data-sprint-target-form><label>专项目标距离 · m<input type="number" min="0.1" step="any" data-sprint-target-distance aria-label="冲刺 FVP 目标距离" value="${E(record.sprintFvpAnalysis?.targetDistanceM ?? "")}" placeholder="跟随测试末段"></label><button class="btn small" type="submit">保存目标距离</button><button class="btn small" type="button" data-sprint-target-follow>跟随测试末段</button></form>`;
    const imbalance = solved.imbalance;
    const result = solved.valid ? table(["指标", "当前", "距离最优"], rows, [], "fvp-result-table sprint-fvp-result-table")
      + (imbalance ? `<div class="fvp-core-judgment"><p><span>FVP 不平衡性</span><strong>${F(imbalance.magnitudePct, 2)}%</strong></p><p>相对最优剖面 ${F(imbalance.profilePct, 2)}% · 100% 为最优</p><p>${E(imbalance.label)}</p></div>` : `<p class="fvp-table-note">${E(solved.optimumReason || "距离最优剖面待计算")}</p>`)
      : `<div class="fvp-empty-result">${E(solved.reason || "录入完整分段计时后计算冲刺剖面。")}</div>`;
    const selected = solved.selected, splits = selected?.fit?.points || selected?.splits || [];
    const fitRows = splits.map(split => [F(split.distanceM, 1), F(split.timeS, 3), F(split.predictedDistanceM, 3), F(split.residualM, 4)]);
    const config = solved.config || record.sprintFvpConfig || {}, conditions = [`${F(solved.mass ?? record.athlete.mass, 1)} kg`, `身高 ${F(solved.heightCm ?? config.heightCm ?? record.athlete.height, 1)} cm`, `${F(config.temperatureC, 1)} °C`, `${F(config.pressureHpa, 1)} hPa`, `风速 ${F(config.windMps, 2)} m/s`].join(" · ");
    const trials = (solved.trials || []).filter(trial => trial.present).flatMap(trial => (trial.inputSplits || trial.splits || []).filter(split => N(split.distanceM) !== null || N(split.timeS) !== null).map((split, index) => [String(trial.index + 1), F(split.distanceM, 1), F(split.timeS, 3), E(trial.excluded ? "已排除" : trial.selected ? "采用" : trial.eligible ? "保留" : trial.reason || "待复核"), index === 0 ? E([trial.notes, trial.exclusionReason].filter(Boolean).join("；")) : ""]));
    const method = `<details class="fvp-method sprint-fvp-method"><summary>拟合残差、测试条件与方法</summary><p>${E(conditions)}</p><p>${E(solved.selectionBasis || "采用同一完整冲刺试次的分段计时")}${selected ? ` · 第 ${selected.index + 1} 次` : ""}。${config.inputTimeMode === "interval" ? "分段耗时累加为累计时间" : "累计时间输入"}；固定时间修正 ${F(config.timeCorrectionS, 3)} s，起始位置修正 ${F(config.positionStartM, 2)} m。</p>${fitRows.length ? table(["距离 m", "累计时间 s", "拟合距离 m", "残差 m"], fitRows, [], "sprint-fvp-fit-table") : ""}<p>V(t) = Vmax(1 − exp(−t/τ))，x(t) = Vmax[t + τ(exp(−t/τ) − 1)]。τ ${F(solved.fit?.tau, 3)} s；距离残差 RMSE ${F(solved.fit?.rmseM, 4)} m；F–V 回归 R² ${F(model.r2, 4)}。</p><p>水平力由体重×加速度与空气阻力求得，以 0.1 s 采样至当前试次末段时间；RF = F水平/√(F水平² + (mg)²)，RF max 为 t &gt; 0.3 s 样本中的最大值，DRF 为同一窗口 RF–V 回归斜率，以百分点/(m/s)显示。</p><p>V₀ 为 F–V 外推的零力速度；Vmax 为分段速度模型的渐近值；终点速度为测试末段时间的模型值；Vopt = V₀/2 为峰值功率对应速度。</p><p>距离最优剖面由独立冲刺模型在固定 Pmax、体重与空气阻力下求最短目标距离时间。相对最优剖面 = 100·SFV/SFVopt；FVP 不平衡性 = 100·|1 − SFV/SFVopt|。${solved.optimum?.valid && solved.optimum.withinStudySimulation === false ? "当前目标距离或功率超出原研究的模拟范围。" : ""}</p><p><a href="https://doi.org/10.1111/sms.12490" target="_blank" rel="noopener noreferrer">Samozino 等 · 分段计时冲刺力–速度–功率方法（2016）</a> · <a href="https://doi.org/10.1111/sms.14097" target="_blank" rel="noopener noreferrer">Samozino 等 · 距离最优冲刺 F–V（2022）</a></p></details>`;
    return `<article class="fvp-analysis-card sprint-fvp-analysis" id="detail-sprint_fvp" data-test-ids="sprint_fvp" data-sprint-fvp-panel><div class="fvp-analysis-heading test-title"><div><h3>${E(title)}</h3><p class="sprint-target-summary">${E(distanceText)}</p></div></div>${controls}<div class="detail-pair sprint-fvp-profile-pair" data-pdf-pair><div class="chart-wrap adaptive-chart" data-chart-kind="sprintFvp" data-chart-input="${E(JSON.stringify([graph, {}]))}">${V.sprintFvp(graph)}</div><div class="detail-data">${result}</div></div>${method}${trials.length ? `<details class="fvp-raw-trials" data-raw-trials="sprint_fvp" data-trial-title="冲刺 FVP · 原始录入分段"><summary>冲刺 FVP · 原始录入分段</summary>${table(["试次", "录入距离 m", "录入时间 s", "采用情况", "备注"], trials, [], "repeat-raw-table")}</details>` : ""}</article>`;
  }
  function fvpChartData(solved) {
    const current=solved.current||solved.model||{}, profiles=[];
    const add=(profile,kind,label)=>{if(profile&&positive(profile.F0)&&positive(profile.V0))profiles.push({kind,label,F0:profile.F0,V0:profile.V0,Pmax:profile.Pmax});};
    add(current,"current","当前剖面");
    add(solved.optimum||solved.optimal,"optimum",`${solved.optimum?.angle||solved.optimal?.angle||90}° 最优`);
    add(solved.comparison,"comparison",`${solved.comparison?.angle||30}° 参照`);
    const points=(solved.points||[]).map(p=>({load:p.load,height:p.heightCm??p.height,force:p.forceRelative??p.force,velocity:p.velocity,power:p.powerRelative??p.power,n:p.n}));
    const band=[];
    if(solved.valid&&points.length&&typeof solved.ci==="function"){
      const min=Math.min(...points.map(p=>p.velocity)),max=Math.max(...points.map(p=>p.velocity));
      for(let i=0;i<=48;i++){const interval=solved.ci(min+(max-min)*i/48);if(interval&&N(interval.low)!==null&&N(interval.high)!==null)band.push({...interval,powerLow:interval.powerLow??interval.low*interval.x,powerHigh:interval.powerHigh??interval.high*interval.x});}
    }
    return{id:solved.id,valid:!!solved.valid,reason:solved.reason,profiles,points,band};
  }
  function fvpElasticityData(solved, view = {}) {
    const sensitivity=solved.sensitivity||{};
    const model=solved.fit||solved.model,force=sensitivity.force||[],velocity=sensitivity.velocity||[],both=sensitivity.both||[];
    const dense=(points,kind)=>{
      if(!solved.valid||!model?.distance||!global.RingsideFVP?.scenario||!points.length)return points;
      const min=Math.min(...points.map(p=>p.changePct)),max=Math.max(...points.map(p=>p.changePct));
      return Array.from({length:121},(_,i)=>{const changePct=min+(max-min)*i/120;return{changePct,...global.RingsideFVP.scenario(model,model.distance,kind!=="velocity"?changePct:0,kind!=="force"?changePct:0)};});
    };
    const compact=points=>points.map(({changePct,valid,deltaPct})=>({changePct,valid,deltaPct}));
    return{id:solved.id,force:compact(force),velocity:compact(velocity),both:compact(both),forceCurve:compact(dense(force,"force")),velocityCurve:compact(dense(velocity,"velocity")),bothCurve:compact(dense(both,"both")),
      responseForce:view.responseForce!==false,responseVelocity:view.responseVelocity!==false,responseBoth:view.responseBoth!==false};
  }
  function fvpResultTable(solved) {
    if(!solved.valid)return `<div class="fvp-empty-result">${E(solved.reason||"录入至少3个不同负荷的有效跳跃，并填写蹬伸距离。")}</div>`;
    const current=solved.current||{},optimal=solved.optimum||solved.optimal||{},imbalance=solved.imbalance||{},fit=solved.fit||solved.model||{},rows=[];
    const add=(name,before,after,unit,digits=2)=>rows.push([`${E(name)}${unit?`<small class="fvp-unit">${E(unit)}</small>`:""}`,F(before,digits),F(after,digits)]);
    add("力量端 F₀",current.F0,optimal.F0,"N/kg");
    add("速度端 V₀",current.V0,optimal.V0,"m/s",3);
    add("最大功率 Pmax",current.Pmax,optimal.Pmax,"W/kg");
    add("剖面斜率 SFV",current.slope,optimal.slope,"N/kg / (m/s)",3);
    add("拟合 R²",fit.r2,null,"",3);
    const imbalanceValue=imbalance.magnitudePct??solved.imbalancePct;
    const imbalanceText=imbalanceValue>0&&imbalanceValue<.01?"＜0.01%":`${F(imbalanceValue,2)}%`;
    return table(["指标","当前","目标最优"],rows,[],"fvp-result-table")+`<div class="fvp-core-judgment"><p><span>FVP的不平衡性</span><strong>${imbalanceText}</strong></p><p>${E(imbalance.label||"发展方向待确定")}</p></div>`;
  }
  function fvpScenarioTable(solved) {
    if(!solved.valid)return `<div class="fvp-empty-result">${E(solved.reason||"完成有效剖面后可比较参数改变。")}</div>`;
    const current=solved.verticalCurrent||solved.current||{},scenario=solved.scenario||{},elasticity=solved.elasticity||{},nextElasticity=scenario.elasticity||{},nextJudgments=nextElasticity.judgments||{},rows=[];
    const add=(name,before,after,unit,judgment,digits=2)=>{if(N(before)!==null||N(after)!==null)rows.push([E(name),`${F(before,digits)}${unit?` ${E(unit)}`:""}`,`${F(after,digits)}${unit?` ${E(unit)}`:""}`,`<span class="fvp-judgment">${E(judgment)}</span>`]);};
    const change=value=>`${value>=0?"+":""}${F(value,2)}%`;
    add("力量端 F₀",current.F0,scenario.F0,"N/kg",`参数改变 ${change(scenario.deltaForcePct??0)}`);
    add("速度端 V₀",current.V0,scenario.V0,"m/s",`参数改变 ${change(scenario.deltaVelocityPct??0)}`,3);
    add("最大功率 Pmax",current.Pmax,scenario.Pmax,"W/kg",N(scenario.Pmax)!==null?`改变 ${change((scenario.Pmax/current.Pmax-1)*100)}`:"待计算");
    add("垂直跳跃高度",current.heightCm,scenario.heightCm,"cm",N(scenario.deltaCm)!==null?`${scenario.deltaCm>=0?"+":"−"}${F(Math.abs(scenario.deltaCm),2)} cm（${change(scenario.deltaPct)}）`:"情景无法计算");
    add("力量弹性 Fₑ",elasticity.Fe,nextElasticity.Fe,"",nextJudgments.Fe||"待判断",3);
    add("速度弹性 vₑ",elasticity.ve,nextElasticity.ve,"",nextJudgments.ve||"待判断",3);
    add("弹性比 ER",elasticity.ER,nextElasticity.ER,"",nextJudgments.ER||"待判断",3);
    add("弹性范数 EN",elasticity.EN,nextElasticity.EN,"","两端局部响应的合成强度",3);
    add("双端各提高 1%",elasticity.Fe + elasticity.ve,N(nextElasticity.Fe)!==null&&N(nextElasticity.ve)!==null?nextElasticity.Fe+nextElasticity.ve:null,"%","垂直跳跃高度的局部增益",2);
    return table(["指标","当前","情景","情景判定"],rows,[],"fvp-scenario-table")+(scenario.valid===false?`<p class="fvp-table-note" role="status">${E(scenario.reason||scenario.message||"情景无法计算，请核对输入。")}</p>`:"");
  }
  function fvpLoadTable(solved) {
    const points=solved.points||[];
    if(!points.length)return "";
    const groupFor=load=>(solved.groups||[]).find(group=>N(group.load)===N(load));
    return `<details class="fvp-method fvp-load-details"><summary>负荷点与重复测量</summary><div class="table-wrap"><table class="fvp-load-table"><thead><tr><th>负荷 kg</th><th>采用跳高 cm</th><th>力 N/kg</th><th>速度 m/s</th><th>功率 W/kg</th><th>均值 ± SD / CV</th></tr></thead><tbody>${points.map(p=>{const group=groupFor(p.load)||{},statistics=group.statistics||group,n=group.n??p.n,mean=statistics.mean??group.meanHeightCm,sd=statistics.sd??group.sdHeightCm,cv=statistics.cv;const repeat=n>=3&&N(mean)!==null&&N(sd)!==null?`${F(mean,2)} ± ${F(sd,2)} cm / ${F(cv,1)}%`:"—";return `<tr data-fvp-id="${E(solved.id)}" data-fvp-load="${E(p.load)}" role="button" tabindex="0" aria-label="附加负荷 ${E(p.load)} kg，采用跳高 ${F(p.heightCm??p.height,2)} cm" aria-pressed="false"><td>${F(p.load,1)}</td><td>${F(p.heightCm??p.height,2)}</td><td>${F(p.forceRelative??p.force,2)}</td><td>${F(p.velocity,3)}</td><td>${F(p.powerRelative??p.power,2)}</td><td>${repeat}</td></tr>`;}).join("")}</tbody></table></div></details>`;
  }
  function fvpRawTrials(record,id,solved,displayName) {
    const rows=solved.trials||record.data?.[id]||[],selected=new Set((solved.points||[]).flatMap(p=>p.selectedIds||[]));
    if(!rows.some(row=>N(row.height)!==null||N(row.load)!==null||row.notes))return "";
    const label=displayName||(id==="fvp_cmj"?"负荷 CMJ":"负荷 SJ");
    const data=rows.map((row,index)=>[index+1,F(row.load,1),F(row.height,2),F(row.distanceCm||record.fvpConfig?.[id]?.distanceCm,1),E(row.excluded?"已排除":row.valid===false?row.reason||"待复核":selected.has(row.id)?"采用":"保留"),E([row.notes,row.excluded?row.exclusionReason:""].filter(Boolean).join("；"))]);
    return `<details class="fvp-raw-trials" data-raw-trials="${E(id)}" data-trial-title="${label} FVP"><summary>${label} · 原始试次 · ${rows.length} 次</summary>${table(["试次","负荷 kg","垂直跳高 cm","蹬伸距离 cm","采用情况","备注"],data,[],"repeat-raw-table")}</details>`;
  }
  function fvpMethod(record,solved) {
    const config=record.fvpConfig?.[solved.id]||{},fit=solved.fit||{},mode="每负荷最高有效跳跃";
    const details=[config.device,config.method,config.posture,positive(config.distanceCm)?`蹬伸距离 ${F(config.distanceCm,1)} cm`:"",config.distanceSource].filter(Boolean).map(E).join(" · ");
    const sources=(global.RingsideSources?.entries||[]).filter(source=>source.id?.startsWith("fvp-"));
    return `<details class="fvp-method"><summary>测试条件、计算与来源</summary><p>${details||E(record.protocol?.[solved.id]||"测试条件待记录")}</p><p>${mode}。以 m 为运动员体重、L 为附加负荷、h 为腾空高度、d 为蹬伸距离（长度换算为 m）：F = (m + L)g(1 + h/d)，V = √(gh/2)；力与功率除以 m 后分别以 N/kg、W/kg 表示。</p><p>拟合 F/m = F₀ + SFV·V；V₀ = −F₀/SFV，Pmax = F₀V₀/4。固定 Pmax 与 d 时，最优峰值功率速度 v 满足 v³/(2λ²d) + g·sinθ·v = Pmax（λ = 0.5），最优 F₀ = 2Pmax/v、V₀ = 2v；FVP的不平衡性 = |1 − SFV/SFVopt| × 100%。</p><p>弹性与情景始终计算垂直跳高：起跳速度 u 满足 u²/(2d) = F₀(1 − λu/V₀) − g，h = u²/(2g)。Fe = ∂lnh/∂lnF₀，ve = ∂lnh/∂lnV₀，ER = Fe/ve，EN = √(Fe² + ve²)；F₀ 与 V₀ 各提高 1% 的局部高度增益约为 (Fe + ve)%。改变 F₀、V₀ 后重新求解垂直跳跃高度。Li 的速度参数化使用 λ = 0.77，换算后保持同一物理剖面。</p><p>${fit.n||0} 个负荷代表点${fit.n>=3?`，残差自由度 ${fit.n-2}`:""}；95%置信带为 F(V) 拟合均值的 Student t 区间，仅显示实测速度范围，P(V) 区间由对应力区间乘 V 得到。未包含测量方法与蹬伸距离的系统误差。</p>${sources.map(source=>`<p><a href="${E(source.url)}" target="_blank" rel="noopener noreferrer">${E(source.title)}</a></p>`).join("")}</details>`;
  }
  function renderFVPAnalysis(report,{print=false}={}) {
    const record=report.record,all=Object.entries(report.stats.fvp||{}).filter(([id])=>record.enabled[id]&&(record.data[id]||[]).some(row=>N(row.height)!==null||N(row.load)!==null||row.notes));
    if(!all.length)return "";
    const preferred=record.views?.fvpProtocol;
    const chosen=all.find(([id])=>id===preferred)||all.find(([,solved])=>solved.valid)||all[0];
    const rendered=print?all.filter(([,solved])=>solved.valid):[chosen];
    if(!rendered.length)return "";
    const profileOptions=all.map(([id])=>{const label=id==="fvp_cmj"?"CMJ":"SJ",builtin=T.builtins.find(test=>test.id===id),name=report.projects.find(test=>test.id===id)?.name;return `<option value="${E(id)}"${id===chosen[0]?" selected":""}>${E(name&&name!==builtin?.name?`${label} · ${name}`:label)}</option>`;}).join("");
    return `<div class="fvp-analysis-stack" data-fvp-analysis-stack>${rendered.map(([id,solved])=>{
      const analysis=record.fvpAnalysis?.[id]||{},angle=analysis.angle===30?30:90,view={fv:true,pv:true,points:true,optimum:true,comparison:false,confidence:true,range:"full",pinnedLoad:null,...record.fvpView?.[id]},label=id==="fvp_cmj"?"CMJ":"SJ";
      const builtin=T.builtins.find(test=>test.id===id),displayName=report.projects.find(test=>test.id===id)?.name||builtin?.name;
      const profileTitle=displayName&&displayName!==builtin?.name?displayName:`跳跃力–速度剖面 · ${label}`;
      const graph=fvpChartData({...solved,id}),elasticity=fvpElasticityData({...solved,id},view);
      const toggle=(key,text)=>`<label><input type="checkbox" data-action="fvp-view" data-fvp-view="${key}" data-fvp-id="${id}" aria-label="${E(text)}"${view[key]?" checked":""}>${E(text)}</label>`;
      const common=print?"":`<div class="fvp-controls fvp-shared-controls no-print"><label>跳跃协议 <select data-fvp-protocol aria-label="FVP 跳跃协议">${profileOptions}</select></label><label>目标方向 <select data-action="fvp-angle" data-fvp-angle data-fvp-id="${id}" aria-label="FVP 目标方向"><option value="90"${angle===90?" selected":""}>90° 垂直</option><option value="30"${angle===30?" selected":""}>30° 倾斜目标</option></select></label></div>`;
      const controls=print?"":`<div class="fvp-controls no-print">${toggle("fv","F–V")}${toggle("pv","P–V")}${toggle("points","实测点")}${toggle("optimum","目标最优曲线")}${toggle("comparison","另一角度参照")}${toggle("confidence","95%置信带")}<label>显示范围 <select data-action="fvp-range" data-fvp-view="range" data-fvp-id="${id}" aria-label="FVP 显示范围"><option value="full"${view.range!=="measured"?" selected":""}>完整剖面</option><option value="measured"${view.range==="measured"?" selected":""}>实测范围</option></select></label></div>`;
      const input=(key,text)=>`<label>${text}<input type="number" data-fvp-scenario="${key}" data-fvp-id="${id}" value="${E(analysis[key]??0)}" step="any" aria-label="${text}"></label>`;
      const scenario=print?`<p class="fvp-table-note">情景参数改变：F₀ ${F(analysis.deltaForcePct??0,2)}% · V₀ ${F(analysis.deltaVelocityPct??0,2)}%。</p>`:`<form class="fvp-scenario-form no-print" data-fvp-scenario-form data-fvp-id="${id}">${input("deltaForcePct","F₀ 改变 · %")}${input("deltaVelocityPct","V₀ 改变 · %")}<button class="btn small" type="submit">保存情景</button></form><div class="fvp-scenario-shortcuts no-print">${[["force","仅 F₀ +5%"],["velocity","仅 V₀ +5%"],["both","两者 +5%"]].map(([key,text])=>`<button type="button" class="btn small" data-fvp-shortcut="${key}" data-fvp-id="${id}">${text}</button>`).join("")}</div>`;
      return `<article class="fvp-analysis-card" data-fvp-panel="${id}" data-fvp-pinned-load="${view.pinnedLoad===null?"":E(view.pinnedLoad)}"><div class="fvp-analysis-heading test-title"><div><h3>${E(profileTitle)}</h3><p>${angle===90?"90° 垂直":"30° 倾斜目标"} · ${solved.points?.length||0} 个负荷代表点</p></div></div>${common}${controls}<div class="detail-pair fvp-profile-pair" data-pdf-pair><div class="chart-wrap adaptive-chart" data-chart-kind="jumpFvp" data-chart-input="${E(JSON.stringify([graph,view]))}">${V.jumpFvp(graph,view)}</div><div class="detail-data">${fvpResultTable(solved)}</div></div><p class="fvp-load-legend no-print" data-fvp-selection-summary hidden></p>${fvpLoadTable({...solved,id})}${fvpMethod(record,{...solved,id})}${fvpRawTrials(record,id,solved,displayName)}</article><article class="fvp-analysis-card" data-fvp-elasticity="${id}"><div class="fvp-analysis-heading test-title"><div><h3>垂直跳表现响应 · ${label}</h3><p>力量端与速度端的垂直跳高响应</p></div></div>${scenario}${print?"":`<div class="fvp-controls fvp-response-controls no-print">${toggle("responseForce","仅 F₀")}${toggle("responseVelocity","仅 V₀")}${toggle("responseBoth","F₀ 与 V₀ 同时")}</div>`}<div class="detail-pair fvp-elasticity-pair" data-pdf-pair><div class="chart-wrap adaptive-chart" data-chart-kind="jumpElasticity" data-chart-input="${E(JSON.stringify([elasticity]))}">${V.jumpElasticity(elasticity)}</div><div class="detail-data" data-fvp-scenario-results>${fvpScenarioTable(solved)}</div></div></article>`;
    }).join("")}</div>`;
  }
  function prepareFVPPrint(clone,snapshot) {
    const analysis=clone.querySelector("#trainingAnalysisDetail");
    if(analysis)analysis.outerHTML=renderCapabilityAnalysis(build(snapshot),{print:true});
  }
  function previewFVP(container,solved) {
    const panel=container.querySelector(`[data-fvp-elasticity="${solved.id}"]`);
    if(!panel)return;
    const view=Object.fromEntries([...panel.querySelectorAll("[data-fvp-view]")].map(control=>[control.dataset.fvpView,control.checked]));
    const chart=panel.querySelector('[data-chart-kind="jumpElasticity"]'),data=fvpElasticityData(solved,view);
    chart.dataset.chartInput=JSON.stringify([data]);
    delete chart.dataset.chartLayout;
    chart.innerHTML=V.jumpElasticity(data,{width:Math.round(chart.getBoundingClientRect().width)||480,height:330});
    panel.querySelector("[data-fvp-scenario-results]").innerHTML=fvpScenarioTable(solved);
    layoutCharts(panel);
  }
  function syncFVPSelection(panel,load,pinned=false) {
    const id=panel.dataset.fvpPanel;
    panel.querySelectorAll("[data-fvp-load]").forEach(node=>{
      const selected=N(node.dataset.fvpLoad)===N(load)&&N(load)!==null;
      node.classList.toggle("is-fvp-highlighted",selected);
      node.classList.toggle("is-fvp-pinned",selected&&pinned);
      node.setAttribute("aria-pressed",String(selected&&pinned));
    });
    const point=panel.querySelector(`[data-fvp-load="${load}"]`),summary=panel.querySelector("[data-fvp-selection-summary]");
    if(summary){summary.hidden=!point;summary.textContent=point?`${pinned?"已固定":"当前"}负荷 ${F(load,1)} kg；图中 F–V、P–V 与负荷表对应同一组测试。`:"";}
    return id;
  }
  const fvpBound=new WeakSet();
  function bindFVPInteractions(container) {
    if(!fvpBound.has(container)){
      fvpBound.add(container);
      const find=event=>{const node=event.target.closest("[data-fvp-load]"),panel=node?.closest("[data-fvp-panel]");return panel?{node,panel,load:N(node.dataset.fvpLoad)}:null;};
      const pin=event=>{const hit=find(event);if(!hit)return;const previous=N(hit.panel.dataset.fvpPinnedLoad),load=previous===hit.load?null:hit.load;hit.panel.dataset.fvpPinnedLoad=load===null?"":load;if(load!==null){const details=hit.panel.querySelector(".fvp-load-details");if(details)details.open=true;}syncFVPSelection(hit.panel,load,load!==null);container.dispatchEvent(new CustomEvent("fvp-selection",{bubbles:true,detail:{id:hit.panel.dataset.fvpPanel,load}}));};
      container.addEventListener("pointerover",event=>{if(event.pointerType==="touch")return;const hit=find(event);if(hit)syncFVPSelection(hit.panel,hit.load,N(hit.panel.dataset.fvpPinnedLoad)===hit.load);});
      container.addEventListener("pointerout",event=>{const hit=find(event),next=event.relatedTarget?.closest?.("[data-fvp-load]");if(hit&&(!next||next.closest("[data-fvp-panel]")!==hit.panel)){const load=N(hit.panel.dataset.fvpPinnedLoad);syncFVPSelection(hit.panel,load,load!==null);}});
      container.addEventListener("focusin",event=>{const hit=find(event);if(hit)syncFVPSelection(hit.panel,hit.load,N(hit.panel.dataset.fvpPinnedLoad)===hit.load);});
      container.addEventListener("focusout",event=>{const hit=find(event),next=event.relatedTarget?.closest?.("[data-fvp-load]");if(hit&&(!next||next.closest("[data-fvp-panel]")!==hit.panel)){const load=N(hit.panel.dataset.fvpPinnedLoad);syncFVPSelection(hit.panel,load,load!==null);}});
      container.addEventListener("click",pin);
      container.addEventListener("keydown",event=>{if(!find(event))return;if(event.key==="Enter"||event.key===" "){event.preventDefault();pin(event);}else if(event.key==="Escape"){const hit=find(event);hit.panel.dataset.fvpPinnedLoad="";syncFVPSelection(hit.panel,null);container.dispatchEvent(new CustomEvent("fvp-selection",{bubbles:true,detail:{id:hit.panel.dataset.fvpPanel,load:null}}));}});
    }
    container.querySelectorAll("[data-fvp-panel]").forEach(panel=>{const load=N(panel.dataset.fvpPinnedLoad);syncFVPSelection(panel,load,load!==null);});
  }
  // Recreate geometry at the actual column width. Only the neighboring primary
  // result tables determine height; attempts and supplemental tables are excluded.
  const chartObservers = new WeakMap();
  function alignIsometricSides(container) {
    container.querySelectorAll(".iso-results.with-repeat-columns").forEach((table) => {
      table.querySelectorAll(".stat-side").forEach((node) => node.style.removeProperty("min-height"));
      if (global.getComputedStyle(table).display !== "table") return;
      for (const row of table.tBodies[0].rows) {
        const columns = [...row.cells].map((cell) => [...cell.querySelectorAll(".stat-side")]);
        const count = Math.max(0, ...columns.map((sides) => sides.length));
        for (let side = 0; side < count; side++) {
          const cells = columns.map((items) => items[side]).filter(Boolean);
          const height = Math.max(...cells.map((cell) => cell.getBoundingClientRect().height));
          cells.forEach((cell) => cell.style.minHeight = height + "px");
        }
      }
    });
  }
  function layoutCharts(container, { print = false } = {}) {
    // A wrapped mean/SD must not push the right-side statistics below the
    // corresponding right-side result and evaluation in neighboring columns.
    alignIsometricSides(container);
    const limits = { isoRadar: [310, 390], forceTime: [320, 440], lactate: [360, 480], speed: [240, 380], fms: [320, 380], lvp: [320, 380], jumpBars:[350,390], jumpFvp:[390,450], jumpElasticity:[310,400], sprintFvp:[390,450] };
    const compact = { isoRadar: 290, forceTime: 300, lactate: 320, speed: 260, fms: 310, lvp: 330, jumpBars:350, jumpFvp:390, jumpElasticity:330, sprintFvp:390 };
    container.querySelectorAll("[data-chart-kind]").forEach((node) => {
      const kind = node.dataset.chartKind, pair = node.closest(".detail-pair"),
        width = Math.round(node.getBoundingClientRect().width);
      if (width < 100 || !limits[kind] || !pair) return;
      const tables = [...pair.querySelectorAll(":scope > .detail-data > .table-wrap")],
        rects = tables.map((table) => table.getBoundingClientRect()),
        target = rects.length ? Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)) : 0,
        stacked = !print && pair.getBoundingClientRect().width < 760 && pair.querySelector(".detail-data").getBoundingClientRect().left < node.getBoundingClientRect().right - 2,
        [min, max] = limits[kind],
        height = print ? Math.max(min * .78, Math.min(max * .78, target)) : stacked ? compact[kind] : Math.max(min, Math.min(max, target)),
        key = [width, Math.round(height), print].join(":" );
      if (node.dataset.chartLayout === key) return;
      const args = JSON.parse(node.dataset.chartInput);
      node.innerHTML = V[kind](...args, { width, height: Math.round(height), print });
      node.dataset.chartLayout = key;
    });
    container.querySelectorAll("[data-fvp-panel]").forEach(panel=>{const load=N(panel.dataset.fvpPinnedLoad);syncFVPSelection(panel,load,load!==null);});
  }
  function observeCharts(container) {
    chartObservers.get(container)?.disconnect();
    let queued = false;
    const observer = new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; layoutCharts(container); });
    });
    chartObservers.set(container, observer);
    container.querySelectorAll("[data-chart-kind],.detail-data > .table-wrap").forEach((node) => observer.observe(node));
    layoutCharts(container);
    bindFVPInteractions(container);
  }
  global.RingsideReport = { build, summary, overview, render, layoutCharts, observeCharts, renderFVPAnalysis, renderSprintFVPAnalysis, renderCapabilityAnalysis, prepareFVPPrint, previewFVP, bindFVPInteractions };
})(window);
