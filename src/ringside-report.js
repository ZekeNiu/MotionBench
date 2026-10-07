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
  // Display wording is independent of the stored reference labels and cutoffs.
  const reportEvaluation = (value, definition, record) => {
    const result = M.evaluation(value, definition, record);
    const label = definition.category === "performance" &&
      T.abilityName(definition.ability) === "力量耐力"
      ? { red: "重点关注", amber: "关注", green: "正常" }[result.status]
      : null;
    return label ? { ...result, label } : result;
  };
  const table = (headers, rows, keys = [], className = "") => {
    const evaluation = headers.indexOf("评价");
    if (evaluation >= 0 && rows.every((row) => !String(row[evaluation] || "").replace(/<[^>]*>/g, "").replace(/[—\s-]/g, ""))) {
      headers = headers.filter((_, i) => i !== evaluation);
      rows = rows.map((row) => row.filter((_, i) => i !== evaluation));
    }
    const cell = (value) => /with-repeat-columns|repeat-raw-table/.test(className) ? `<div class="result-cell">${value || "—"}</div>` : value || "—";
    return `<div class="table-wrap"><table${className ? ` class="${E(className)}"` : ""}><thead><tr>${headers.map((h) => `<th scope="col">${E(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => `<tr${typeof keys[i] === "object" ? ` data-row-id="${E(keys[i].id)}" data-iso-region="${E(keys[i].region || "")}"` : keys[i] ? ` data-metric-id="${E(keys[i])}"` : ""}>${row.map((value, col) => `<td data-label="${E(headers[col])}">${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
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
      isoRadar: M.isoRadar(stats.isoAnalyses),
      diagnostics: [],
      projects: results,
      groups: T.groups(results, snapshot),
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
      ["red", "重点关注"],
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
        ["指标", "结果", ...(repeated ? ["均值 ± SD", "CV"] : ["单位"]), "评价", ...(target ? ["目标"] : [])],
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
        const label = test.id === "iso" ? directionLabel(group.label).replace(/ · 中线$/, "") : group.label;
        const heading = groups.length > 1 ? `<h4>${E(label)}</h4>` : "";
        const rows = fields.length > 4 ? group.attempts.flatMap((row) => fields.map((field) => [row.index, E(field.label), cell(row.values[field.id]), E(field.unit), E([row.pain ? "疼痛" : "", row.notes].filter(Boolean).join(" · "))]))
          : group.attempts.map((row) => [row.index, ...fields.map((field) => cell(row.values[field.id])), E([row.pain ? "疼痛" : "", row.notes].filter(Boolean).join(" · "))]);
        return heading + table(fields.length > 4 ? ["试次", "指标", "结果", "单位", "备注"] : ["试次", ...fields.map((field) => field.label + (field.unit ? " · " + field.unit : "")), "备注"], rows, [], "repeat-raw-table");
      }).join("");
      return `<div class="repeat-panel" data-repeat-test="${E(test.id)}"><details class="attempt-details" id="trials-${E(test.id)}" data-raw-trials="${E(test.id)}" data-trial-title="${E(test.name)}"><summary>${E(test.name)} · 原始试次 · 共 ${count} 次</summary>${raw}</details></div>`;
    }
    function rawTable(test) {
      const contract = test.dataContract || T.dataContract(state, test.id);
      const value = state.data[test.id];
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
                ? "距目标 " + F(gap) + " " + E(d.unit)
                : gap === 0
                  ? "达到目标"
                  : "超过目标 " + F(-gap) + " " + E(d.unit);
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
          const label = { green: "达标", amber: "关注", red: "严重" }[status] || ungraded;
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
                    side + F(result.value, 2) + " · " + result.label,
                    balance.referenceEnabled && balance.ranges?.length ? "未评" : "",
                  )}</div>`;
                })
                .join("");
              return `<div class="joint-balance-item" data-balance-id="${E(balance.id)}"><strong>${E(balance.label)}</strong>${values}${standard}</div>`;
            })
            .join("") || "-";
        const evaluationCell = (row, repeated) => {
          const available = row.sides.some((side) =>
            side.pain || (side.value !== null && positive(row.target)),
          );
          if (!available) return "-";
          return row.sides.map((side) => {
            const label = side.side ? side.side + " · " : "";
            const description = label + (side.reasons.length ? side.reasons.join("；") : "达到目标");
            const value = side.pain ? statusPill(label.trim(), "red", description)
              : side.value === null || !positive(row.target) ? E(label) + "-"
              : statusPill(label.trim(), side.status, description);
            return repeated ? `<div class="stat-side">${value}</div>` : value;
          }).join(repeated ? "" : "<br>");
        };
        const sideStatistics = (row) => row.sides.map((side) => {
          const key = side.side === "L" ? "left" : side.side === "R" ? "right" : "center";
          const group = s.repetitions.find((g) => g.testId === "iso" && g.directionId === row.id && g.side === key);
          return { side: side.side, metric: group?.statistics[0] };
        });
        const repeated = measured.some((row) => hasStatistics(sideStatistics(row).map((x) => x.metric)));
        const sideCells = (row) => [0, 1].map((col) => sideStatistics(row).map(({ side, metric }) =>
          `<div class="stat-side">${metric?.n >= 3 ? statisticCells(metric, side)[col] : E(side ? side + " —" : "—")}</div>`).join(""));
        const rows = measured.map((row) => [
          E((M.REG[row.region] || row.region) + " · " + directionLabel(row.direction)),
          row.sides
            .map(
              (side, index) => {
                const value = `${side.side ? E(side.side) + " " : ""}${F(side.value)} ${E(row.unit)}${side.pain ? " · 疼痛" : ""}`;
                const target = index === row.sides.length - 1 && positive(row.target)
                  ? `<small class="metric-meta">目标 ${F(row.target)} ${E(row.unit)}</small>` : "";
                return repeated ? `<div class="stat-side">${value}${target}</div>` : value + target;
              },
            )
            .join(repeated ? "" : "<br>"),
          ...(repeated ? sideCells(row) : []),
          row.asym === null
            ? "—"
            : `<span class="pill ${E(row.asymStatus)}"><i class="dot"></i><span class="asym-value">${F(row.asym)}% ·</span> <span class="asym-side">${row.weakSide ? row.weakSide === "L" ? "左侧较弱" : "右侧较弱" : "一致"}</span></span>`,
          evaluationCell(row, repeated),
          balanceCell(row),
        ]);
        const data = table(
          ["部位与方向", "实测力量／目标", ...(repeated ? ["均值 ± SD", "CV"] : []), "双侧差异", "评价", "关节平衡"],
          rows,
          measured.map((row) => ({ id: row.id, region: row.region })),
          "iso-results" + (repeated ? " with-repeat-columns" : ""),
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
        const fields = T.jumpFields.map((field) => {
          const units = [
            ...new Set(
              tests.map(
                (test) =>
                  T.attemptFields(state, test.id).find(
                    (f) => f.key === field.key,
                  ).unit,
              ),
            ),
          ];
          return {
            ...field,
            unit: units.length === 1 ? units[0] : "",
            ids: tests.map((test) => test.id + "_" + field.suffix),
          };
        });
        const extra = tests.flatMap((test) =>
          T.attemptFields(state, test.id)
            .filter((field) => !field.key)
            .map((field) => ({ ...field, ids: [field.id] })),
        );
        const activeFields = [...fields, ...extra]
          .filter((field) =>
            summaries.some(({ data }) =>
              data?.attempts.some((a) =>
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
            (metric.value === null ? "" : (d && positive(d.target) ? `<small class="metric-meta">目标 ${F(d.target)}</small>` : "") + (d ? evaluationPill(d) : ""));
        };
        const metricRows = repeated ? summaries.flatMap(({ test, data }) => activeFields.filter((field) =>
          field.ids.some((id) => data?.metrics.some((metric) => metric.id === id))).map((field) => {
            const metric = data.metrics.find((m) => field.ids.includes(m.id));
            return [E(test.name + " · " + field.label) + `<small class="metric-meta">${E(field.unit || metric.unit)}</small>`,
              jumpCell(test, data, field), ...statisticCells(repeatedMetric(metric.id))];
          })) : activeFields.map((field) => [
            E(field.label) +
              '<small class="muted"> ' +
              E(field.unit) +
              "</small>",
            ...summaries.map(({ test, data }) => jumpCell(test, data, field)),
          ]);
        return block(
          tests,
          tests.map((t) => t.name).join(" / "),
          "",
          pair(
            V.jumpBars(
              summaries.map(({ test, data }) => ({
                label: test.name,
                value: data?.row?.height,
              })),
            ),
            table(repeated ? ["指标", "结果", "均值 ± SD", "CV"] : ["指标", ...tests.map((t) => t.name)], metricRows, [], repeated ? "with-repeat-columns" : "") +
              supplemental(tests),
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
        resultRows.push(...metrics.filter((metric) => T.isManualMetric(metric)));
        const repeated = hasStatistics(resultRows.map((metric) => repeatedMetric(metric.id)));
        const data = resultRows.length ? table(
          ["指标", "结果", "单位", ...(repeated ? ["均值 ± SD", "CV"] : []), "评价", "目标"],
          resultRows.map((metric) => {
            const evaluation = metric.evaluation;
            const classified = evaluation && !["未启用评价标准", "未设等级区间", "未启用标准"].includes(evaluation.label);
            return [E(metric.name), F(metric.value, 2) + (N(metric.forcePercent) !== null ? `<small class="metric-meta">占峰值力 ${F(metric.forcePercent, 1)}%</small>` : ""), E(metric.unit),
              ...(repeated ? statisticCells(repeatedMetric(metric.id)) : []),
              classified ? pill(evaluation.label, evaluation.status) : "—",
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
          table(["指标／测试方法", "目标", ...(repeated ? ["均值 ± SD · m/s", "CV"] : []), "评价"], rows, metrics.map((d) => d.id), "speed-test-info" + (repeated ? " with-repeat-columns" : "")) + ratioTable,
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
    for (const test of measured.filter((t) => t.renderer !== "lvp")) {
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
    return `<details class="details-group" id="screenDetail" open><summary>损伤风险筛查<span>动作表现 · 双侧差异 · 关节平衡</span></summary><div class="quality-group">${screening || '<div class="empty">尚无筛查结果</div>'}</div></details><details class="details-group" id="performanceDetail" open><summary>运动表现<span>能力表现与测试结果</span></summary>${performance || '<div class="quality-group"><div class="empty">尚无运动表现结果</div></div>'}</details>`;
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
    const limits = { isoRadar: [310, 390], forceTime: [320, 440], lactate: [360, 480], speed: [240, 380], fms: [320, 380], lvp: [320, 380] };
    const compact = { isoRadar: 290, forceTime: 300, lactate: 320, speed: 260, fms: 310, lvp: 330 };
    container.querySelectorAll("[data-chart-kind]").forEach((node) => {
      const kind = node.dataset.chartKind, pair = node.closest(".detail-pair"),
        width = Math.round(node.getBoundingClientRect().width);
      if (width < 100 || !limits[kind]) return;
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
  }
  global.RingsideReport = { build, summary, render, layoutCharts, observeCharts };
})(window);
