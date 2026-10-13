(function (global) {
  "use strict";
  const analysisLabel = "能力结构分析";
  // One registry describes the supported measurement structures. User projects
  // use the scalar adapter; their IDs and display names never select executable code.
  const builtins = [
    ["fms", "FMS 动作筛查", "screen", "fms"],
    ["iso", "各方位等长力量", "screen", "iso"],
    ["cmj", "CMJ", "performance", "jumps"],
    ["sj", "SJ", "performance", "jumps"],
    ["fvp_sj", "SJ F–V/P–V 剖面", "performance", "fvp"],
    ["fvp_cmj", "CMJ F–V/P–V 剖面", "performance", "fvp"],
    ["sprint_fvp", "分段计时冲刺 F–V/P–V 剖面", "performance", "sprint-fvp"],
    ["dj", "DJ 下落跳", "performance", "jumps"],
    ["hop", "10/5 Hop Test 连续反应跳", "performance", "jumps"],
    ["cmrj", "CMRJ 反向反弹跳", "performance", "jumps"],
    ["imtp", "IMTP", "performance", "imtp"],
    ["landmine", "地雷杠出拳投掷", "performance", "lvp"],
    ["squat", "深蹲 LVP", "performance", "lvp"],
    ["bench", "卧推 LVP", "performance", "lvp"],
    ["deadlift", "硬拉 LVP", "performance", "lvp"],
    ["pushup", "60 秒俯卧撑", "performance", "scalar"],
    ["mb", "药球反手投掷", "performance", "ball"],
    ["lactate", "递增负荷测试：乳酸与心率", "performance", "lactate"],
    ["cpet", "CPET 心肺运动测试", "performance", "cpet"],
    ["ift", "30-15VIFT", "performance", "speed"],
    ["mas", "MAS 最大有氧速度", "performance", "speed"],
    ["mss", "MSS 最大冲刺速度", "performance", "speed"],
  ].map(([id, name, category, renderer]) =>
    Object.freeze({ id, name, category, renderer }),
  );
  const registry = new Map(builtins.map((test) => [test.id, test]));
  const reactiveIds = ["dj","hop","cmrj"];
  function isNative(source, id) {
    return registry.has(id) && !(source.customTests || []).some((t) => t.id === id) &&
      !(source.tests || source.projectSnapshots || []).some((t) => t.id === id && t.legacyCustom === true);
  }
  function displayName(test, source) {
    const name=test?.name??"";
    if(["fvp_sj","fvp_cmj"].includes(test?.id)&&!test.legacyCustom&&(!source||isNative(source,test.id))) {
      const protocol=test.id==="fvp_sj"?"SJ":"CMJ";
      if([`${protocol} F–V/P–V 剖面`,`${protocol} F–V/P–V`,`跳跃力–速度剖面 · ${protocol}`].includes(name))return `跳跃FVP · ${protocol}`;
    }
    if(test?.id==="sprint_fvp"&&!test.legacyCustom&&(!source||isNative(source,test.id))&&["分段计时冲刺 F–V/P–V 剖面","分段计时冲刺 F–V/P–V"].includes(name))return "冲刺FVP";
    return test?.id==="ift"&&name==="30–15 IFT"?"30-15VIFT":name;
  }
  const jumpFields = [
    { key: "height", suffix: "height", label: "垂直跳跃高度", unit: "cm" },
    {
      key: "rsiModified",
      suffix: "rsi_modified",
      label: "RSI-modified",
      unit: "m/s",
    },
    { key: "force", suffix: "peak_force", label: "起跳峰值力", unit: "N" },
    {
      key: "landingPeakForce",
      suffix: "landing_peak_force",
      label: "落地峰值力",
      unit: "N",
    },
  ];
  const reactiveFields = [
    { key: "height", suffix: "height", label: "反弹垂直跳跃高度", unit: "cm" },
    { key: "rsi", suffix: "rsi", label: "RSI", unit: "m/s", computed: true },
    { key: "contactTimeMs", suffix: "contact_time", label: "触地时间", unit: "ms" },
    { key: "flightTimeMs", suffix: "flight_time", label: "腾空时间", unit: "ms" },
    { key: "flightTimeRatio", suffix: "flight_time_ratio", label: "腾空 / 触地时间", unit: "比值", computed: true },
    { key: "activeStiffness", suffix: "active_stiffness", label: "Active Stiffness", unit: "kN/m" },
  ];
  function fieldsForTest(id) {
    if (id === "dj") return reactiveFields.concat({ key: "dropHeightCm", suffix: "drop_height", label: "跌落高度", unit: "cm" });
    if (id === "hop") return reactiveFields;
    if (id === "cmrj") return [
      { key: "firstHeight", suffix: "first_height", label: "首跳垂直跳跃高度", unit: "cm" },
      { key: "firstTimeToTakeoffMs", suffix: "first_time_to_takeoff", label: "首跳起跳用时", unit: "ms" },
      { key: "firstRsiModified", suffix: "first_rsi_modified", label: "首跳 RSI-modified", unit: "m/s", computed: true },
      ...reactiveFields,
    ];
    return id === "cmj" ? jumpFields.concat([
      { key: "propulsiveImpulse", suffix: "propulsive_impulse", label: "推进期冲量", unit: "N·s" },
      { key: "propulsiveDurationMs", suffix: "propulsive_duration", label: "推进期时长", unit: "ms" },
    ]) : jumpFields;
  }
  const derivedRegistry = [
    ["eur", "EUR", "比值", "CMJ 垂直跳跃高度 / SJ 垂直跳跃高度", ["cmj", "sj"], ["eur-mcguigan-2006", "eur-critique"], "常用", "CMJ 与 SJ 使用一致的手臂条件和测高方法；结合两项成绩解释。"],
    ["gain", "CMJ–SJ 增益", "%", "(CMJ 垂直跳跃高度 / SJ 垂直跳跃高度 − 1) × 100", ["cmj", "sj"], ["eur-mcguigan-2006", "eur-critique"], "常用", "EUR 的百分比表达，不作为额外独立证据。"],
    ["fdsi", "DSI / fDSI", "比值", "CMJ 推进期峰值力 / 等长峰值力", ["cmj", "imtp"], ["dsi-context-2020"], "常用", "相同力单位、净/总力口径及可比协议；结合最大力量和跳跃表现。"],
    ["idsi_matched", "iDSI · 匹配时窗", "比值", "CMJ 完整推进期冲量 / IMTP 同等时窗冲量", ["cmj", "imtp"], ["dsi-impulse-2021", "dsi-impulse-2025"], "研究", "IMTP 从发力起点积分至 CMJ 推进期同等时长；双方冲量口径一致。"],
    ["idsi_fixed250", "iDSI · 固定 250 ms", "比值", "CMJ 完整推进期冲量 / IMTP 0–250 ms 冲量", ["cmj", "imtp"], ["dsi-impulse-2025"], "研究", "仅分母固定为 250 ms；不沿用 fDSI 训练界值。"],
    ["rqr", "RQR · DJ/Hop 反应比", "比值", "DJ 平均 FT/CT / Hop 平均 FT/CT", ["dj", "hop"], ["rqr-southey-2024"], "研究", "FT/CT 为腾空与触地时间之比；原研究为 DJ 45 cm 三次平均、Hop 十跳中按 FT/CT 选最高五跳。"],
    ["asr", "ASR · 无氧速度储备", "m/s", "MSS − MAS", ["mss", "mas"], ["sandford-asr-2019"], "常用", "使用有效 MSS 与 MAS，保留具体测量方法；不以 VIFT 替代 MAS。"],
    ["srr", "SRR · 速度储备比", "比值", "MSS / MAS", ["mss", "mas"], ["sandford-asr-2019", "buchheit-srr-2025"], "常用", "结合 MSS、MAS 与专项要求解释，不套用其他专项的分组界值。"],
  ].map(([id, name, unit, formula, dependencies, sourceIds, evidenceLevel, protocol]) =>
    ({ id, name, unit, formula, dependencies, sourceIds, evidenceLevel, protocol, ability: analysisLabel, scoring: false }));
  const derivedDefinitions = () => JSON.parse(JSON.stringify(derivedRegistry));
  const derivedDefaults = () => Object.fromEntries(derivedRegistry.map((d) => [d.id, true]));
  const extraMetrics = [
    ...[
      ["f0", "冲刺 F₀", "N/kg"], ["v0", "冲刺 V₀", "m/s"], ["pmax", "冲刺 Pmax", "W/kg"],
      ["rfmax", "冲刺 RF max", "%"], ["drf", "冲刺 DRF", "百分点/(m/s)"], ["imbalance", "冲刺 FVP 不平衡度", "%"],
    ].map(([key, name, unit]) => ["sprint_fvp_" + key, "sprint_fvp", name, unit, "最大速度"]),
    ...["fvp_sj", "fvp_cmj"].flatMap(id => [
      [id + "_f0", id, (id === "fvp_sj" ? "SJ" : "CMJ") + " F₀", "N/kg", "爆发力"],
      [id + "_v0", id, (id === "fvp_sj" ? "SJ" : "CMJ") + " V₀", "m/s", "爆发力"],
      [id + "_pmax", id, (id === "fvp_sj" ? "SJ" : "CMJ") + " Pmax", "W/kg", "爆发力"],
      [id + "_imbalance", id, (id === "fvp_sj" ? "SJ" : "CMJ") + " FVP的不平衡性", "%", "爆发力"],
    ]),
    ...["cmj", "sj"].flatMap((id) =>
      fieldsForTest(id)
        .slice(1)
        .map((field) => [
          id + "_" + field.suffix,
          id,
          id.toUpperCase() + " " + field.label,
          field.unit,
          "爆发力",
        ]),
    ),
    ...["dj", "hop", "cmrj"].flatMap((id) => fieldsForTest(id).map((field) =>
      [id + "_" + field.suffix, id, id.toUpperCase() + " " + field.label, field.unit, "反应力量"])),
    ["rqr", "dj", "DJ/Hop FT/CT 反应比", "比值", "反应力量"],
    ["squat_1rm", "squat", "深蹲预估1RM / 体重", "kg/kg", "最大力量"],
    ["bench_1rm", "bench", "卧推预估1RM / 体重", "kg/kg", "最大力量"],
    ["deadlift_1rm", "deadlift", "硬拉预估1RM / 体重", "kg/kg", "最大力量"],
    ["mas_speed", "mas", "MAS", "m/s", "有氧代谢能力"],
    ["mss_speed", "mss", "MSS", "m/s", "冲刺速度"],
    ["ift_shuttle", "ift", "30-15VIFT", "m/s", "间歇耐力"],
    ["imtp_peak_force", "imtp", "IMTP 峰值力", "N", "最大力量"],
    ["imtp_relative_force", "imtp", "IMTP 相对峰值力", "N/kg", "最大力量"],
    ["imtp_f100", "imtp", "IMTP 100 ms 力", "N", "早期发力"],
    ["imtp_f200", "imtp", "IMTP 200 ms 力", "N", "早期发力"],
    ["imtp_rfd100", "imtp", "IMTP 0–100 ms RFD", "N/s", "早期发力"],
    ["imtp_rfd200", "imtp", "IMTP 0–200 ms RFD", "N/s", "早期发力"],
    ["imtp_impulse250", "imtp", "IMTP 0–250 ms 冲量", "N·s", "早期发力"],
    ["imtp_matched_impulse", "imtp", "IMTP 匹配时窗冲量", "N·s", "早期发力"],
    ["imtp_matched_duration", "imtp", "IMTP 匹配时窗", "ms", "早期发力"],
    ["cpet_vo2_relative", "cpet", "CPET 相对摄氧量", "mL·kg⁻¹·min⁻¹", "有氧代谢能力"],
    ["cpet_vo2_absolute", "cpet", "CPET 绝对摄氧量", "L/min", "有氧代谢能力"],
    ["cpet_peak_hr", "cpet", "CPET 峰值心率", "bpm", "有氧代谢能力"],
    ...[1, 2].flatMap(n => [
      [`cpet_threshold${n}_vo2_relative`, "cpet", `第 ${n} 阈值相对摄氧量`, "mL·kg⁻¹·min⁻¹", "有氧代谢能力"],
      [`cpet_threshold${n}_vo2_absolute`, "cpet", `第 ${n} 阈值绝对摄氧量`, "L/min", "有氧代谢能力"],
      [`cpet_threshold${n}_pct`, "cpet", `第 ${n} 阈值摄氧量占比`, "%", "有氧代谢能力"],
      [`cpet_threshold${n}_hr`, "cpet", `第 ${n} 阈值心率`, "bpm", "有氧代谢能力"],
      [`cpet_threshold${n}_speed`, "cpet", `第 ${n} 阈值速度`, "m/s", "有氧代谢能力"],
      [`cpet_threshold${n}_power`, "cpet", `第 ${n} 阈值功率`, "W", "有氧代谢能力"],
    ]),
  ];
  const computedIds = new Set([
    ...(global.Def?.builtins || []).map((d) => d.id),
    ...extraMetrics.map((d) => d[0]),
  ]);
  const jumpReference = (id) => {
    const modified = /(?:^|_)rsi_modified$/.test(id), rsi = /^(dj|hop|cmrj)_rsi$/.test(id);
    if (!modified && !rsi) return {};
    return { referenceEnabled: true, source: "用户指定评价标准（2026-10-08）", protocol: modified ? "垂直跳跃高度(m) / 整个起跳动作时间(s)" : "垂直跳跃高度(m) / 触地时间(s)",
      ranges: global.Def.parseRanges(modified ? "<0.35 | 较差 | red\n[0.35..0.50) | 一般 | amber\n0.50..0.65 | 良好 | green\n>0.65 | 优秀 | green" : "<1.5 | 较差 | red\n[1.5..2.0) | 中等 | amber\n2.0..2.5 | 良好 | green\n>2.5 | 优秀 | green") };
  };
  const extraDefinitions = () =>
    extraMetrics.map(([id, testId, name, unit, ability]) => ({
      id,
      testId,
      name,
      unit,
      ability,
      category: "performance",
      measurementScale: "ratio",
      direction: "higher",
      target: null,
      referenceEnabled: false,
      ranges: [],
      source: "用户配置评价标准",
      protocol: "使用实际测试协议与匹配评价标准",
      ...jumpReference(id),
      ...(testId.startsWith("fvp_") ? { scoring: false, source: "Morin & Samozino 2016；Samozino et al. 2008/2012", protocol: "各负荷选最高有效跳跃高度；以体重、附加负荷、跳跃高度及推进距离计算" } : {}),
      ...(testId === "sprint_fvp" ? {scoring:false, source:"Samozino et al. 2016；Morin et al. 2022", protocol:"静止起跑分段计时；最佳完整试次；最佳 F–V 取决于 Pmax 和目标距离"} : {}),
      ...(id === "cpet_vo2_relative" ? { referenceEnabled: true, referenceMode: "grouped", referenceGroups: global.RingsideReferences?.cpetReferenceGroups?.() || [], source: "FRIEND 2022 · 实测摄氧量参考百分位", protocol: "CPET 实测摄氧量" } : {}),
    }));
  const isManualMetric = (definition) =>
    !!definition && (definition.legacyManual === true || !computedIds.has(definition.id));
  const supportsAttemptMetrics = (testId) =>
    ["jumps", "imtp", "speed", "scalar"].includes(registry.get(testId)?.renderer || "scalar");
  const isAttemptMetric = (definition) =>
    isManualMetric(definition) &&
    definition.entryScope === "attempt" &&
    (definition.legacyManual === true || supportsAttemptMetrics(definition.testId));
  function repeatPolicy(source, testId) {
    const renderer = isNative(source,testId) ? registry.get(testId).renderer : "scalar";
    const fields = (source.definitions || []).filter((d) => d.testId === testId && isAttemptMetric(d));
    const test = (source.tests || []).find((t) => t.id === testId)
      || (source.projectSnapshots || []).find((t) => t.id === testId)
      || (source.customTests || []).find((t) => t.id === testId);
    const primary = fields.find((d) => d.id === test?.primaryMetricId) || fields[0];
    return {
      kind: ["fms", "lactate", "cpet", "fvp", "sprint-fvp"].includes(renderer) ? "none" : renderer === "iso" ? "direction-side" : renderer === "lvp" ? "load-side" : renderer === "ball" ? "side" : "attempt",
      primaryMetricId: primary?.id || null,
      selectionDirection: test?.selectionDirection || "higher",
      direction: primary?.direction || "higher",
      fields,
    };
  }
  function attemptFields(source, testId) {
    return fieldsForTest(testId)
      .filter((field) => !(source.definitions || []).some((d) => d.id === testId + "_" + field.suffix && d.legacyManual === true))
      .map((field) => ({
        ...field,
        id: testId + "_" + field.suffix,
        unit:
          testId === "cmj" && field.key === "force"
            ? source.dsi?.cmjUnit || "N"
            : field.unit,
      }))
      .concat(
        (source.definitions || [])
          .filter((d) => d.testId === testId && isAttemptMetric(d))
          .map((d) => ({ id: d.id, key: null, label: d.name, unit: d.unit })),
      );
  }
  // Explicit native data contracts also support a chart-independent raw-data view.
  const nativeFields = {
    fms: [
      ["name", "动作"],
      ["left", "左分"],
      ["right", "右分"],
      ["score", "单项分"],
      ["pain", "疼痛"],
      ["notes", "备注"],
    ],
    iso: [
      ["region", "部位"],
      ["direction", "方向"],
      ["left", "左"],
      ["right", "右"],
      ["center", "中线"],
      ["unit", "单位"],
      ["target", "目标"],
      ["painLeft", "左侧疼痛"],
      ["painRight", "右侧疼痛"],
      ["painCenter", "中线疼痛"],
      ["notes", "备注"],
    ],
    imtp: [
      ["peakForce", "峰值力 N"],
      ["baselineForce", "起点力 N"],
      ["peakTimeMs", "峰值时间 ms"],
      ["timePoints", "时间点"],
      ["impulse250", "0–250 ms 冲量 N·s"],
      ["matchedImpulse", "匹配时窗冲量 N·s"],
      ["matchedDurationMs", "匹配时窗 ms"],
    ],
    lactate: [
      ["speed", "速度 m/s"],
      ["lactate", "乳酸 mmol/L"],
      ["hr", "心率 bpm"],
    ],
    cpet: [["modality", "测试方式"], ["oxygenLabel", "原报告摄氧量名称"], ["vo2", "摄氧量"], ["vo2Unit", "摄氧量单位"], ["peakHr", "峰值心率 bpm"], ["rer", "峰值 RER"], ["thresholds", "实测阈值"]],
    pushup: [["reps", "次数"]],
    mb: [
      ["side", "侧别"],
      ["distance", "距离 m"],
    ],
    ift: [
      ["speed", "VIFT m/s"],
      ["method", "方法"],
    ],
    mas: [
      ["speed", "速度 m/s"],
      ["method", "方法"],
    ],
    mss: [
      ["speed", "速度 m/s"],
      ["method", "方法"],
    ],
  };
  function dataContract(source, testId) {
    const renderer = isNative(source,testId) ? registry.get(testId).renderer : "scalar";
    const fields =
      renderer === "jumps"
        ? attemptFields(source, testId).map((f) => [
            f.key || "metrics." + f.id,
            f.label + " " + f.unit,
          ])
        : renderer === "lvp"
          ? [
              ["side", "侧别"],
              ["load", "负荷 kg"],
              ["velocity", "速度 m/s"],
            ]
          : renderer === "fvp" ? [["load", "附加负荷 kg"], ["height", "垂直跳跃高度 cm"], ["distanceCm", "推进距离 cm"], ["excluded", "已排除"], ["exclusionReason", "排除原因"]]
          : renderer === "sprint-fvp" ? [["splits", "累计距离 m / 时间 s"], ["excluded", "已排除"], ["exclusionReason", "排除原因"]]
          : nativeFields[testId] || [];
    return {
      shape: isNative(source,testId) && ["pushup", "ift", "mas", "mss", "hop", "cpet"].includes(testId)
        ? "object"
        : isNative(source,testId)
          ? "rows"
          : "scalar",
      fields: fields.concat(!["fms", "lactate"].includes(testId) ? [
        ...(renderer === "jumps" ? [] : (source.definitions || []).filter((d) => d.testId === testId && isAttemptMetric(d)).map((d) => ["metrics." + d.id, d.name + " " + d.unit])),
        ["notes", "备注"],
      ] : []),
      nativeMetricIds: (source.definitions || [])
        .filter((d) => d.testId === testId && !isManualMetric(d))
        .map((d) => d.id),
    };
  }
  const abilityName = (value) =>
    typeof value === "string" ? value.trim() : "";
  const metricName = (definition) => {
    const legacy = { ift_treadmill: "30–15 IFT·跑台改良版终末速度", ift_shuttle: "30–15 折返 VIFT" };
    return legacy[definition.id] === definition.name ? "30-15VIFT" : definition.name;
  };
  const metricProtocol = (definition) => [...new Set([definition.context?.protocol || "",
    global.Def.viftProtocol(definition.id, definition.context?.metricProtocol ?? definition.protocol ?? "")].filter(Boolean))].join("；");
  function primaryAbility(test, definitions) {
    return abilityName(test.primaryAbility) || (test.id === "fms" ? "动作筛查" : test.id === "iso" ? "等长力量" :
      abilityName(definitions.find(d => d.testId === test.id && abilityName(d.ability))?.ability)) || "未分类";
  }
  function abilityGroups(source = {}) {
    const configured = source.abilityGroupSnapshot || source.abilityGroups || [], result = [], seen = new Set();
    const add = (key, name = key) => { key = abilityName(key); if (key && !seen.has(key)) { seen.add(key); result.push({ key, name: abilityName(name) || key }); } };
    configured.forEach(group => add(group.key, group.name));
    const definitions = source.definitions || [], tests = source.tests || source.projectSnapshots || builtins;
    [...tests, ...(source.customTests || [])].forEach(test => add(primaryAbility(test, definitions)));
    definitions.forEach(d => add(d.ability));
    return result;
  }
  const abilityLabel = (source, key) => abilityGroups(source).find(group => group.key === key)?.name || abilityName(key);
  const groupId = (label) =>
    "ability-" +
    Array.from(label)
      .map((c) => c.codePointAt(0).toString(16))
      .join("-");
  const axisKey = (label) => "ability:" + abilityName(label);
  function axisConfig(record, label) {
    const axes = record.axes || {},
      key = axisKey(label);
    return Object.hasOwn(axes, key)
      ? axes[key]
      : Object.hasOwn(axes, label)
        ? axes[label]
        : null;
  }
  function describe(source) {
    const definitions = source.definitions || [];
    const groups = abilityGroups(source);
    const supplied = source.tests || source.projectSnapshots || builtins;
    const projects = new Map();
    for (const test of [
      ...(source.customTests || []),
      ...supplied,
      ...(source.tests ? [] : builtins),
    ]) {
      if (!projects.has(test.id)) projects.set(test.id, test);
    }
    return [...projects.values()].map((test) => {
      const metrics = definitions.filter((d) => d.testId === test.id);
      const abilities = [
        ...new Set(metrics.map((d) => abilityName(d.ability)).filter(Boolean)),
      ];
      const preferred = primaryAbility(test, definitions);
      return {
        id: test.id,
        name: displayName(test,source),
        category: test.category || "performance",
        primaryAbility: preferred,
        primaryAbilityLabel: groups.find(group => group.key === preferred)?.name || preferred,
        abilityOrder: groups.findIndex(group => group.key === preferred),
        disabled: test.disabled === true,
        abilities,
        definitions: metrics,
        renderer: isNative(source,test.id) ? registry.get(test.id).renderer : "scalar",
        inputKind: isNative(source,test.id) ? test.id : "scalar",
        ...(test.legacyCustom ? { legacyCustom: true } : {}),
        dataContract: dataContract(source, test.id),
        repeatPolicy: repeatPolicy(source, test.id),
        primaryMetricId: test.primaryMetricId || "",
        selectionDirection: test.selectionDirection || "higher",
      };
    });
  }
  function snapshots(source) {
    return describe(source).map(({ id, name, category, primaryAbility, primaryMetricId, selectionDirection }) => {
      const prior = !source.tests && source.projectSnapshots?.find(test => test.id === id);
      // Display aliases must not rewrite measurement snapshots or catalog names.
      const rawFvpName=["fvp_sj","fvp_cmj","sprint_fvp"].includes(id)&&isNative(source,id)?(source.tests||source.projectSnapshots||builtins).find(test=>test.id===id)?.name:undefined;
      return { id, name: prior?.name ?? rawFvpName ?? name, category,
        primaryAbility: prior?.primaryAbility ?? primaryAbility,
        selectionDirection: prior?.selectionDirection ?? selectionDirection,
        ...([...reactiveIds, "cpet", "fvp_sj", "fvp_cmj", "sprint_fvp"].includes(id) ? isNative(source,id) ? { measurementVersion: 1 } : { legacyCustom: true } : {}),
        ...(primaryMetricId ? { primaryMetricId } : {}) };
    });
  }
  function groups(projects, source) {
    const grouped = new Map();
    for (const project of projects) {
      const key =
        project.category === "screen"
          ? "筛查"
          : project.primaryAbility || "未分类";
      const label = project.category === "screen" ? "筛查" : source ? abilityLabel(source, key) : project.primaryAbilityLabel || key;
      const order = project.category === "screen" ? -1 : source ? abilityGroups(source).findIndex(group => group.key === key) : project.abilityOrder ?? projects.length;
      const id = project.category === "screen" ? "screen" : groupId(key);
      if (!grouped.has(id))
        grouped.set(id, {
          id,
          key,
          label,
          order,
          category: project.category,
          projects: [],
        });
      grouped.get(id).projects.push(project);
    }
    return [...grouped.values()].sort(
      (a, b) =>
        (a.category === "screen" ? 0 : 1) - (b.category === "screen" ? 0 : 1) || a.order - b.order,
    );
  }
  const fmsAbilities = [
    "下蹲活动与控制",
    "单腿支撑控制",
    "分腿姿势控制",
    "肩带活动能力",
    "髋部活动与骨盆控制",
    "躯干整体稳定",
    "躯干多平面控制",
  ];
  global.RingsideTests = Object.freeze({
    analysisLabel,
    jumpFields,
    fieldsForTest,
    derivedDefinitions,
    derivedDefaults,
    attemptFields,
    dataContract,
    isAttemptMetric,
    supportsAttemptMetrics,
    repeatPolicy,
    builtins,
    isNative,
    displayName,
    registry,
    extraDefinitions,
    isManualMetric,
    abilityName,
    abilityGroups,
    abilityLabel,
    metricName,
    metricProtocol,
    groupId,
    axisKey,
    axisConfig,
    describe,
    snapshots,
    groups,
    fmsAbilities,
  });
})(typeof window !== "undefined" ? window : globalThis);
