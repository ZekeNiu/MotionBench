(function (root) {
  "use strict";
  const copy = value => JSON.parse(JSON.stringify(value));
  const project = (id, name, ability, direction, protocol, sourceIds, metrics, independent = false) => ({
    id: "preset_" + id, kind: "project", name, primaryAbility: ability, description: protocol, protocol, sourceIds,
    testIds: ["preset_" + id], metricSelection: independent ? "independent" : "trial", selectionDirection: direction,
    metrics: metrics.map(([suffix, label, unit, side]) => ({ id: "preset_" + id + "_" + suffix, name: label, unit,
      ...(side ? { side, pairId: "preset_" + id } : {}) })),
  });
  const projects = [
    ...[10, 20].map(distance => project("sprint_" + distance + "m", distance + "米冲刺", "冲刺速度", "lower",
      "站立静止起跑；从首次推进动作至躯干越过" + distance + "米终点计时，单位秒。2–3次有效试次、充分恢复，取最短时间。起跑姿势、触发方式和计时设备须一致。",
      ["nsca-speed-2017"], [["time", "完成时间", "s"]])),
    project("sprint_50m", "50米跑 · 学生体测", "冲刺速度", "lower",
      "学生体测50米：站立式口令起跑，从发令至躯干部到达50米终点计时；录入正式登记成绩（秒），不是飞行冲刺或10/20米分段时间。最佳模式取最短有效成绩。",
      ["student-2014", "student-methods-fudan"], [["time", "完成时间", "s"]]),
    project("standing_long_jump", "立定跳远", "下肢爆发力", "higher",
      "起跳线后双脚同时原地起跳；无助跑、垫步或连跳；测量起跳线后缘至最近落地点的垂直距离（厘米）。保存三次有效试跳，最佳模式取最远距离。",
      ["student-2014", "student-methods-fudan"], [["distance", "跳跃距离", "cm"]]),
    project("cod_505", "传统505变向 · 左右", "变向能力", "lower",
      "10米助跑后越过计时门，继续5米至15米线，指定左脚或右脚触线后180度转向并返回计时门；记录5米往返计时（秒）。左右各三次、充分恢复，两侧分别取最快有效试次。",
      ["clarke-505"], [["left_time", "左脚转向时间", "s", "left"], ["right_time", "右脚转向时间", "s", "right"]], true),
    project("t_test", "T形变向 · 码制", "变向能力", "lower",
      "按ACE协议布置10码（9.144米）前进、5/10/5码侧滑、10码倒退的T形路线。面朝前、不得交叉步，按规定手触锥；两次有效测试，充分恢复，取最快时间（秒）。",
      ["ace-t-test"], [["time", "完成时间", "s"]]),
    project("handgrip", "握力 · 左右", "最大力量", "higher",
      "采用NHANES站立、手臂伸直在体侧的握力协议；调整握距，左右交替各三次，同一手至少间隔60秒。录入kgf，两侧分别取最大有效值；不是左右之和。",
      ["nhanes-grip-2011"], [["left_force", "左手握力", "kgf", "left"], ["right_force", "右手握力", "kgf", "right"]], true),
    ...[["squat", "杠铃背蹲"], ["bench", "卧推"], ["deadlift", "传统硬拉"]].map(([id, name]) => project(id + "_1rm", name + " · 实测1RM", "最大力量", "higher",
      name + "每行记录一次完整1RM测试的最大成功外负荷（kg，含杠铃杆），不把热身组或失败试举记为测次。保持动作范围、器械和辅助条件一致；最佳模式取各完整测次最大值，均值模式比较完整测次的平均结果；不由重复次数或速度公式估算。",
      ["grgic-1rm-2020"], [["load", "实测1RM外负荷", "kg"]])),
    ...[800, 1000].map(distance => project("run_" + distance + "m", distance + "米跑 · 学生体测", "有氧代谢能力", "lower",
      "学生体测" + distance + "米全程跑：站立式口令起跑，完成准确距离后记录正式登记成绩；用总秒数录入（例如4分30秒输入270），不录入4.30。最佳模式取最短有效全程时间。",
      ["student-2014", "student-methods-fudan"], [["time", "全程完成时间", "s"]])),
  ];
  const profiles = ["male", "female"].flatMap(sex => ["y12", "y34"].map(years => ({
    id: "preset_student_2014_" + sex + "_" + years, kind: "profile",
    name: "大学生体测单项等级 · " + (sex === "male" ? "男生" : "女生") + " · " + (years === "y12" ? "大一/大二" : "大三/大四") + "（2014）",
    description: "仅评价50米、立定跳远和" + (sex === "male" ? "1000" : "800") + "米的单项等级；按实际学年主动选择。使用正式体测成绩及最佳模式，不计算完整体测总评或能力分数。",
    testIds: ["preset_sprint_50m", "preset_standing_long_jump", "preset_run_" + (sex === "male" ? "1000" : "800") + "m"],
    sourceIds: ["student-2014", "student-methods-fudan"], sex, years,
  })));
  const items = [...projects, ...profiles], byId = new Map(items.map(item => [item.id, item]));
  function list() { return copy(items.map(({ metrics, protocol, metricSelection, selectionDirection, sex, years, ...item }) => item)); }
  function definitions(item) {
    return item.metrics.map(metric => ({ ...copy(metric), testId: item.id, category: "performance", ability: item.primaryAbility,
      entryScope: "attempt", direction: item.selectionDirection, selectionDirection: item.selectionDirection,
      measurementScale: "ratio", ratioEligible: true, zeroValid: false, valueMinimum: 0, cvEligible: true,
      target: null, ranges: [], referenceEnabled: false, protocol: item.protocol,
      source: item.sourceIds.map(id => root.RingsidePresetSources.get(id).title).join("；") }));
  }
  function testDefinition(item) {
    return { id: item.id, name: item.name, category: "performance", primaryAbility: item.primaryAbility,
      primaryMetricId: item.metrics[0].id, selectionDirection: item.selectionDirection, metricSelection: item.metricSelection,
      visualization: { version: 1, enabled: true, kind: item.metricSelection === "independent" ? "bars" : "trials", metricIds: item.metrics.map(metric => metric.id) } };
  }
  function ranges(bounds, higher) {
    const [excellent, good, pass] = bounds;
    const row = (min, max, includeMin, includeMax, label, status) => ({ min, max, includeMin, includeMax, label, status });
    return higher ? [
      row(excellent, null, true, true, "优秀", "green"),
      row(good, excellent, true, false, "良好", "green"),
      row(pass, good, true, false, "及格", "amber"),
      row(0, pass, false, false, "不及格", "red"),
    ] : [
      row(0, excellent, false, true, "优秀", "green"),
      row(excellent, good, false, true, "良好", "green"),
      row(good, pass, false, true, "及格", "amber"),
      row(pass, null, false, true, "不及格", "red"),
    ];
  }
  function makeProfile(item) {
    const M = root.RingsideModel, E = root.RingsideEvaluation, catalog = M.normalizeCatalog();
    for (const id of item.testIds) {
      const project = byId.get(id);
      catalog.tests.push(testDefinition(project)); catalog.definitions.push(...definitions(project)); catalog.protocol[id] = project.protocol;
      catalog.protocolIdentities[id] = M.protocolIdentity("test:" + id, project.protocol);
    }
    const subjects = E.ruleSubjects(catalog), thresholds = root.RingsidePresetSources.studentThresholds()[item.sex + "_" + item.years];
    const profile = { formatVersion: 2, id: item.id, name: item.name, revision: 1, updated: "2026-10-13T00:00:00.000Z",
      disabled: false, standards: [], aggregations: {}, settings: { thresholds: copy(M.defaults().rules), lvp: {} } };
    for (const [id, key, higher] of [[item.testIds[0], "sprint50", false], [item.testIds[1], "longJump", true], [item.testIds[2], "run", false]]) {
      const metricId = byId.get(id).metrics[0].id, subject = subjects.find(subject => subject.id === "metric:" + metricId);
      const rule = E.ensureStandard(profile, subject);
      Object.assign(rule, { enabled: true, targetEnabled: false, target: null, rangesEnabled: true,
        ranges: ranges(thresholds[key], higher), direction: higher ? "higher" : "lower",
        conditions: { sex: item.sex, mode: "best" }, source: "教育部教体艺〔2014〕5号；" + item.name + "；仅此单项等级。" });
    }
    E.validateProfile(profile); return E.serializeProfile(profile);
  }
  function preview(library, selectedIds) {
    if (!library?.catalog || !Array.isArray(library.catalog.tests) || !Array.isArray(library.catalog.definitions)) throw Error("请先加载共用项目目录");
    if (!Array.isArray(selectedIds) || selectedIds.some(id => !byId.has(id))) throw Error("请选择有效的常用项目或评价方案");
    const ids = [...new Set(selectedIds)], projectIds = new Set(), skipped = [], conflicts = [];
    ids.forEach(id => byId.get(id).testIds.forEach(testId => projectIds.add(testId)));
    const additions = { tests: [], definitions: [], profiles: [], protocol: {} };
    for (const id of projectIds) {
      const item = byId.get(id);
      if (library.catalog.tests.some(test => test.id === id)) { skipped.push({ id, kind: "project", reason: "已存在，保留当前项目及全部设置" }); continue; }
      const collision = item.metrics.find(metric => library.catalog.definitions.some(definition => definition.id === metric.id));
      if (collision) { conflicts.push({ id, kind: "project", reason: "指标编号" + collision.id + "已被其他项目使用，未覆盖" }); continue; }
      additions.tests.push(testDefinition(item)); additions.definitions.push(...definitions(item)); additions.protocol[id] = item.protocol;
    }
    for (const id of ids.filter(id => byId.get(id).kind === "profile")) {
      if ((library.evaluationProfiles || []).some(profile => profile.id === id)) { skipped.push({ id, kind: "profile", reason: "已存在，保留当前方案和用户编辑" }); continue; }
      const item = byId.get(id);
      if (item.testIds.some(testId => conflicts.some(conflict => conflict.id === testId))) continue;
      const missingMetric = item.testIds.find(testId => library.catalog.tests.some(test => test.id === testId) &&
        !byId.get(testId).metrics.every(metric => library.catalog.definitions.some(definition => definition.id === metric.id && definition.testId === testId)));
      if (missingMetric) { conflicts.push({ id, kind: "profile", reason: "现有同编号项目缺少对应测量定义，未替换或套用标准" }); continue; }
      additions.profiles.push(makeProfile(item));
    }
    if (library.catalog.tests.length + additions.tests.length > 75 || library.catalog.definitions.length + additions.definitions.length > 300)
      conflicts.push({ id: "catalog-capacity", kind: "project", reason: "新增后超过项目目录容量，请减少所选项目" });
    const manifest = { testIds: additions.tests.map(test => test.id), metricIds: additions.definitions.map(definition => definition.id),
      profileIds: additions.profiles.map(profile => profile.id), dependencyTestIds: additions.tests.filter(test => !ids.includes(test.id)).map(test => test.id) };
    return { selectedIds: ids, additions, skipped, conflicts, manifest };
  }
  function apply(library, selectedIds) {
    const review = preview(library, selectedIds);
    if (review.conflicts.length) throw Error(review.conflicts.map(conflict => conflict.reason).join("；"));
    const next = copy(library), M = root.RingsideModel, additions = review.additions;
    next.catalog.tests.push(...copy(additions.tests)); next.catalog.definitions.push(...copy(additions.definitions));
    next.catalog.protocolIdentities ||= {};
    for (const [id, protocol] of Object.entries(additions.protocol)) {
      next.catalog.protocol[id] = protocol; next.catalog.protocolIdentities[id] = M.protocolIdentity("test:" + id, protocol);
    }
    if (additions.tests.length) {
      next.catalog.revision = (next.catalog.revision || 1) + 1;
      next.catalog.abilityGroups ||= [];
      for (const test of additions.tests) if (!next.catalog.abilityGroups.some(group => group.key === test.primaryAbility))
        next.catalog.abilityGroups.push({ key: test.primaryAbility, name: test.primaryAbility });
    }
    if (additions.profiles.length) { next.evaluationProfiles ||= []; next.evaluationProfiles.push(...copy(additions.profiles)); }
    M.validateCatalog(next.catalog);
    return { library: next, manifest: copy(review.manifest), preview: review };
  }
  root.RingsidePresets = Object.freeze({ list, preview, apply });
})(typeof window !== "undefined" ? window : globalThis);
