(function (global) {
  "use strict";
  // One registry describes the supported measurement structures. User projects
  // use the scalar adapter; their IDs and display names never select executable code.
  const builtins = [
    ["fms", "FMS 动作筛查", "screen", "fms"],
    ["iso", "各方位等长力量", "screen", "iso"],
    ["cmj", "CMJ", "performance", "jumps"],
    ["sj", "SJ", "performance", "jumps"],
    ["imtp", "IMTP", "performance", "imtp"],
    ["landmine", "地雷杠出拳投掷", "performance", "lvp"],
    ["squat", "深蹲 LVP", "performance", "lvp"],
    ["bench", "卧推 LVP", "performance", "lvp"],
    ["deadlift", "硬拉 LVP", "performance", "lvp"],
    ["pushup", "60 秒俯卧撑", "performance", "scalar"],
    ["mb", "药球反手投掷", "performance", "ball"],
    ["lactate", "递增负荷测试：乳酸与心率", "performance", "lactate"],
    ["ift", "30-15VIFT", "performance", "speed"],
    ["mas", "MAS 最大有氧速度", "performance", "speed"],
    ["mss", "MSS 最大冲刺速度", "performance", "speed"],
  ].map(([id, name, category, renderer]) =>
    Object.freeze({ id, name, category, renderer }),
  );
  const registry = new Map(builtins.map((test) => [test.id, test]));
  const jumpFields = [
    { key: "height", suffix: "height", label: "跳高", unit: "cm" },
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
  const extraMetrics = [
    ...["cmj", "sj"].flatMap((id) =>
      jumpFields
        .slice(1)
        .map((field) => [
          id + "_" + field.suffix,
          id,
          id.toUpperCase() + " " + field.label,
          field.unit,
          "爆发力",
        ]),
    ),
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
  ];
  const computedIds = new Set([
    ...(global.Def?.builtins || []).map((d) => d.id),
    ...extraMetrics.map((d) => d[0]),
  ]);
  const extraDefinitions = () =>
    extraMetrics.map(([id, testId, name, unit, ability]) => ({
      id,
      testId,
      name,
      unit,
      ability,
      category: "performance",
      direction: "higher",
      target: null,
      referenceEnabled: false,
      ranges: [],
      source: "用户配置评价标准",
      protocol: "使用实际测试协议与匹配评价标准",
    }));
  const isManualMetric = (definition) =>
    !!definition && !computedIds.has(definition.id);
  const supportsAttemptMetrics = (testId) =>
    ["jumps", "imtp", "speed", "scalar"].includes(registry.get(testId)?.renderer || "scalar");
  const isAttemptMetric = (definition) =>
    isManualMetric(definition) &&
    definition.entryScope === "attempt" &&
    supportsAttemptMetrics(definition.testId);
  function repeatPolicy(source, testId) {
    const renderer = registry.get(testId)?.renderer || "scalar";
    const fields = (source.definitions || []).filter((d) => d.testId === testId && isAttemptMetric(d));
    const test = (source.tests || []).find((t) => t.id === testId)
      || (source.projectSnapshots || []).find((t) => t.id === testId)
      || (source.customTests || []).find((t) => t.id === testId);
    const primary = fields.find((d) => d.id === test?.primaryMetricId) || fields[0];
    return {
      kind: ["fms", "lactate"].includes(renderer) ? "none" : renderer === "iso" ? "direction-side" : renderer === "lvp" ? "load-side" : renderer === "ball" ? "side" : "attempt",
      primaryMetricId: primary?.id || null,
      direction: primary?.direction || "higher",
      fields,
    };
  }
  function attemptFields(source, testId) {
    return jumpFields
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
    ],
    lactate: [
      ["speed", "速度 m/s"],
      ["lactate", "乳酸 mmol/L"],
      ["hr", "心率 bpm"],
    ],
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
    const renderer = registry.get(testId)?.renderer || "scalar";
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
          : nativeFields[testId] || [];
    return {
      shape: ["pushup", "ift", "mas", "mss"].includes(testId)
        ? "object"
        : registry.has(testId)
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
      ...supplied,
      ...(source.customTests || []),
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
        name: test.id === "ift" && test.name === "30–15 IFT" ? "30-15VIFT" : test.name,
        category: test.category || "performance",
        primaryAbility: preferred,
        primaryAbilityLabel: groups.find(group => group.key === preferred)?.name || preferred,
        abilityOrder: groups.findIndex(group => group.key === preferred),
        disabled: test.disabled === true,
        abilities,
        definitions: metrics,
        renderer: registry.get(test.id)?.renderer || "scalar",
        inputKind: registry.has(test.id) ? test.id : "scalar",
        dataContract: dataContract(source, test.id),
        repeatPolicy: repeatPolicy(source, test.id),
        primaryMetricId: test.primaryMetricId || "",
      };
    });
  }
  function snapshots(source) {
    return describe(source).map(({ id, name, category, primaryAbility, primaryMetricId }) => {
      const prior = !source.tests && source.projectSnapshots?.find(test => test.id === id);
      return { id, name: prior?.name ?? name, category,
        primaryAbility: prior?.primaryAbility ?? primaryAbility,
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
    jumpFields,
    attemptFields,
    dataContract,
    isAttemptMetric,
    supportsAttemptMetrics,
    repeatPolicy,
    builtins,
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
