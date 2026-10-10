(function (root) {
  "use strict";
  const Calc = root.Calc,
    Def = root.Def,
    T = root.RingsideTests;
  if (!Calc || !Def) throw new Error("RingsideModel requires Calc and Def.");
  const N = Calc.num;
  const FVP_IDS = ["fvp_sj", "fvp_cmj"];
  const fvpConfigDefaults = () => root.RingsideFVP?.defaultsConfig() || { device: "", method: "", posture: "", distanceCm: "", distanceSource: "" };
  const fvpAnalysisDefaults = () => root.RingsideFVP?.defaultsAnalysis() || { angle: 90, deltaForcePct: 0, deltaVelocityPct: 0 };
  const fvpViewDefaults = () => root.RingsideFVP?.defaultsView() || { fv: true, pv: true, points: true, optimum: true, comparison: false, confidence: true, range: "full", pinnedLoad: null, responseForce: true, responseVelocity: true, responseBoth: true };
  function fvpAnalysis(record, id) {
    if (!FVP_IDS.includes(id) || !T.isNative(record, id)) return null;
    return root.RingsideFVP ? root.RingsideFVP.solve(record, id) : { id, valid: false, status: "empty", reason: "F–V 模型尚未载入", points: [], trials: [], groups: [], issues: [] };
  }
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = () =>
    root.crypto && root.crypto.randomUUID
      ? root.crypto.randomUUID()
      : "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const now = () => new Date().toISOString();
  const date = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  function dateStamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === "0000") return null;
    const parsed = new Date(value + "T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed.getTime() : null;
  }
  function ageAtDate(birthDate, testDate) {
    const born = dateStamp(birthDate), tested = dateStamp(testDate);
    if (born === null || tested === null || born > tested) return null;
    return Number(testDate.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (testDate.slice(5) < birthDate.slice(5) ? 1 : 0);
  }
  function applyAge(record, birthDate = record.athlete.birthDate) {
    const value = birthDate ?? "";
    if (value !== "" && dateStamp(value) === null) throw Error("生日须为有效的 YYYY-MM-DD");
    const age = value === "" ? null : ageAtDate(value, record.athlete.date);
    if (value !== "" && age === null) throw Error("测试日期不能早于生日，请填写有效的测试日期");
    record.athlete.birthDate = value;
    if (age !== null) record.athlete.age = age;
    return record;
  }
  function competitionContext(record) {
    const tested = dateStamp(record.athlete?.date), context = record.trainingContext || {};
    const previous = dateStamp(context.previousCompetitionDate), next = dateStamp(context.nextCompetitionDate);
    return {
      daysSincePrevious: tested !== null && previous !== null && previous <= tested ? (tested - previous) / 86400000 : null,
      daysUntilNext: tested !== null && next !== null && next >= tested ? (next - tested) / 86400000 : null,
    };
  }
  function validateAthleteProfile(profile) {
    if (!plainObject(profile)) throw Error("运动员档案资料无效");
    for (const key of PROFILE_KEYS) if (profile[key] !== undefined && typeof profile[key] !== "string") throw Error("运动员档案资料无效");
    if (profile.birthDate) {
      if (dateStamp(profile.birthDate) === null) throw Error("生日须为有效的 YYYY-MM-DD");
      if (profile.birthDate > date()) throw Error("生日不能晚于今天");
    }
    if (profile.experienceYears !== undefined && profile.experienceYears !== "" && (N(profile.experienceYears) === null || N(profile.experienceYears) < 0 || N(profile.experienceYears) > 80)) throw Error("抗阻训练年限须为 0–80 年或留空");
    return true;
  }
  function validateAthleteContext(record) {
    for (const path of ["athlete.birthDate", "trainingContext.previousCompetitionDate", "trainingContext.nextCompetitionDate"]) {
      const parts = path.split("."), value = record[parts[0]]?.[parts[1]];
      if (value !== undefined && value !== "" && typeof value !== "string") throw Error("日期须为有效的 YYYY-MM-DD");
      const error = validateField(record, path, value);
      if (error) throw Error(error);
    }
    if (record.athlete.injuryHistory !== undefined && typeof record.athlete.injuryHistory !== "string") throw Error("既往伤病史格式无效");
    return true;
  }
  const positive = (value) =>
    N(value) !== null && N(value) > 0 ? N(value) : null;
  const nonnegative = (value) =>
    N(value) !== null && N(value) >= 0 ? N(value) : null;
  const fmt = (value, digits = 2) =>
    N(value) === null ? "—" : String(Number(N(value).toFixed(digits)));
  const esc = (value) =>
    String(value == null ? "" : value).replace(
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
  const rank = { gray: 0, green: 1, amber: 2, red: 3 };
  const TESTS = T.builtins.map(({ id, name, category }) => [
    id,
    name,
    category,
  ]);
  const FM = [
    ["深蹲", false],
    ["跨栏步", true],
    ["直线弓步", true],
    ["肩部灵活性", true],
    ["主动直腿抬高", true],
    ["躯干稳定俯卧撑", false],
    ["旋转稳定性", true],
  ];
  const REG = {
    neck: "颈",
    trunk: "躯干",
    shoulder: "肩",
    scapula: "肩胛带",
    elbow: "肘",
    forearm: "前臂",
    wrist: "腕",
    hip: "髋",
    knee: "膝",
    ankle: "踝足",
  };
  const DIRS = {
    neck: [
      ["flexion", "屈曲（中线）", false],
      ["extension", "伸展（中线）", false],
      ["lateralFlexion", "侧屈", true],
      ["rotation", "旋转", true],
    ],
    trunk: [
      ["flexion", "屈曲（中线）", false],
      ["extension", "伸展（中线）", false],
      ["lateralFlexion", "侧屈", true],
      ["rotation", "旋转", true],
    ],
    shoulder: [
      ["flexion", "屈曲", true],
      ["extension", "伸展", true],
      ["abduction", "外展", true],
      ["adduction", "内收", true],
      ["internalRotation", "内旋", true],
      ["externalRotation", "外旋", true],
      ["horizontalAbduction", "水平外展", true],
      ["horizontalAdduction", "水平内收", true],
    ],
    scapula: [
      ["elevation", "上提", true], ["depression", "下压", true],
      ["protraction", "前伸", true], ["retraction", "后缩", true],
    ],
    elbow: [["flexion", "屈曲", true], ["extension", "伸展", true]],
    forearm: [["pronation", "旋前", true], ["supination", "旋后", true]],
    wrist: [
      ["flexion", "屈曲", true], ["extension", "伸展", true],
      ["radialDeviation", "桡偏", true], ["ulnarDeviation", "尺偏", true],
    ],
    hip: [
      ["flexion", "屈曲", true],
      ["extension", "伸展", true],
      ["abduction", "外展", true],
      ["adduction", "内收", true],
      ["internalRotation", "内旋", true],
      ["externalRotation", "外旋", true],
    ],
    knee: [
      ["extension", "伸展", true],
      ["flexion", "屈曲", true],
      ["internalRotation", "胫骨内旋", true],
      ["externalRotation", "胫骨外旋", true],
    ],
    ankle: [
      ["dorsiflexion", "背屈", true],
      ["plantarflexion", "跖屈", true],
      ["inversion", "内翻", true],
      ["eversion", "外翻", true],
    ],
  };
  const LEGACY_ISO_REGIONS = ["neck", "shoulder", "hip", "knee", "ankle"];
  const isLegacyIsoRow = row => LEGACY_ISO_REGIONS.includes(row.region)
    && !["horizontalAbduction", "horizontalAdduction"].includes(row.directionCode)
    && !(row.region === "knee" && ["internalRotation", "externalRotation"].includes(row.directionCode));
  const legacyIsoDirectionIds = () => isoRows().filter(isLegacyIsoRow).map(row => row.id);
  const isoSideLabels = row => ["neck", "trunk"].includes(row.region)
    ? { left: "左向", right: "右向", center: "中线" }
    : { left: "左侧", right: "右侧", center: "单项" };
  const bodyRegionLabel = region => ({ neck: "颈部", trunk: "躯干", scapula: "肩胛带", forearm: "前臂", ankle: "踝关节" }[region] || REG[region] + "关节");
  function isoDirectionCatalog(record) {
    const rows = isoRows(), ids = new Set(rows.map(row => row.id));
    return rows.concat((record?.data?.iso || []).filter(row => !ids.has(row.id)));
  }
  function validateIsoDirectionIds(ids, rows, allowEmpty = true) {
    if (ids === undefined) return;
    const available = new Set(rows.map(row => row.id));
    if (!Array.isArray(ids) || (!allowEmpty && !ids.length) || ids.length > 1000
      || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !available.has(id)))
      throw new Error("等长力量方向选择无效，请核对所选方向");
  }
  function selectedIsoRows(record) {
    const rows = record.data?.iso || [];
    if (record.isoDirectionIds === undefined) return rows;
    validateIsoDirectionIds(record.isoDirectionIds, rows);
    const byId = new Map(rows.map(row => [row.id, row]));
    return record.isoDirectionIds.map(id => byId.get(id));
  }
  function setIsoDirectionSelection(record, ids) {
    if (!Array.isArray(ids)) throw new Error("请选择本次等长力量方向");
    const catalog = isoDirectionCatalog(record);
    validateIsoDirectionIds(ids, catalog);
    const existing = new Set(record.data.iso.map(row => row.id));
    ids.forEach(id => { if (!existing.has(id)) record.data.iso.push(clone(catalog.find(row => row.id === id))); });
    record.isoDirectionIds = [...ids];
    return record;
  }
  const PAIRS = [
    [
      "shoulder_IR_ER",
      "shoulder",
      "ER:IR",
      "externalRotation",
      "internalRotation",
    ],
    ["shoulder_F_E", "shoulder", "屈:伸", "flexion", "extension"],
    ["shoulder_AD_AB", "shoulder", "内收:外展", "adduction", "abduction"],
    ["knee_H_Q", "knee", "H:Q", "flexion", "extension"],
    ["neck_F_E", "neck", "屈:伸", "flexion", "extension"],
    ["hip_F_E", "hip", "屈:伸", "flexion", "extension"],
    ["hip_AD_AB", "hip", "内收:外展", "adduction", "abduction"],
    ["hip_IR_ER", "hip", "ER:IR", "externalRotation", "internalRotation"],
    ["ankle_DF_PF", "ankle", "背屈:跖屈", "dorsiflexion", "plantarflexion"],
    ["ankle_INV_EVE", "ankle", "内翻:外翻", "inversion", "eversion"],
  ];

  function isoRows() {
    return Object.entries(DIRS).flatMap(([region, directions]) =>
      directions.map(([directionCode, direction, paired]) => ({
        id: "iso_" + region + "_" + directionCode,
        region,
        direction,
        directionCode,
        paired,
        left: "",
        right: "",
        center: "",
        unit: "N",
        target: "",
        protocol: "",
        painLeft: false,
        painRight: false,
        painCenter: false,
        notes: "",
      })),
    ).sort((a, b) => Number(isLegacyIsoRow(b)) - Number(isLegacyIsoRow(a)));
  }
  function directionCode(row) {
    if (row.directionCode) return row.directionCode;
    const entries = DIRS[row.region] || [];
    const legacyLabel = String(row.direction || "").replace(/（(?:左\s*\/\s*右|左向\s*\/\s*右向)）$/, "");
    const match = entries.find(([, label]) => label === legacyLabel);
    return match ? match[0] : "custom_" + row.id;
  }
  function normalizeIsoDirection(row) {
    row.directionCode = directionCode(row);
    const builtin = (DIRS[row.region] || []).find(([code]) => code === row.directionCode);
    if (builtin && [builtin[1], builtin[1] + "（左 / 右）", builtin[1] + "（左向 / 右向）"].includes(row.direction)) row.direction = builtin[1];
    return row;
  }
  function migrateBalancePair(pair, rows) {
    if (!["shoulder_IR_ER", "hip_IR_ER"].includes(pair.id) || pair.ratioConvention === "ER:IR") return false;
    const region = pair.id.startsWith("shoulder") ? "shoulder" : "hip";
    const internal = rows.find(row => row.region === region && directionCode(row) === "internalRotation"), external = rows.find(row => row.region === region && directionCode(row) === "externalRotation");
    if (!internal || !external) return false;
    if (pair.numeratorId === external.id && pair.denominatorId === internal.id) {
      pair.ratioConvention = "ER:IR";
      if (pair.label === "IR:ER") pair.label = "ER:IR";
      return true;
    }
    if (pair.numeratorId !== internal.id || pair.denominatorId !== external.id) return false;
    const original = clone(pair), inverse = [];
    let valid = true;
    for (const range of pair.ranges || []) {
      const min = range.min == null ? null : N(range.min), max = range.max == null ? null : N(range.max);
      if (range.min != null && min === null || range.max != null && max === null || min !== null && min < 0 || max !== null && max <= 0 || min !== null && max !== null && min > max) {valid=false;break;}
      inverse.push({...range,min:max === null ? 0 : 1/max,max:min === null || min === 0 ? null : 1/min,includeMin:max === null ? false : range.includeMax !== false,includeMax:min === null || min === 0 ? false : range.includeMin !== false});
    }
    pair.numeratorId = external.id; pair.denominatorId = internal.id;
    pair.ratioConvention = "ER:IR";
    if (pair.label === "IR:ER") pair.label = "ER:IR";
    if (Array.isArray(pair.contexts)) pair.contexts.reverse();
    if (valid) pair.ranges = inverse.sort((a,b) => (a.min ?? -Infinity)-(b.min ?? -Infinity));
    else {
      pair.ratioMigrationOriginal = original;
      pair.ratioMigrationIssue = "原 IR:ER 区间含无法取倒数的边界，原配置已保留；请重新确认 ER:IR 区间";
      pair.referenceEnabled = false; pair.ranges = [];
    }
    if (pair.reference) {
      // A reciprocal of a sample mean is not the mean of the reciprocal ratios.
      pair.ratioMigrationOriginal ||= original;
      pair.reference.enabled = false;
      pair.ratioMigrationIssue ||= "原 IR:ER 均值不能直接换算成 ER:IR 均值，原参考已保留并停用；请重新确认参考";
    }
    return true;
  }
  function balancePairs(rows) {
    return PAIRS.map(([id, region, label, numeratorCode, denominatorCode]) => {
      const numerator = rows.filter(
        (r) => r.region === region && r.directionCode === numeratorCode,
      );
      const denominator = rows.filter(
        (r) => r.region === region && r.directionCode === denominatorCode,
      );
      return {
        id,
        label,
        region,
        numeratorId: numerator.length === 1 ? numerator[0].id : "",
        denominatorId: denominator.length === 1 ? denominator[0].id : "",
        confirmed: true,
        ranges: [],
        referenceEnabled: false,
        source: "",
        ...(["shoulder_IR_ER", "hip_IR_ER"].includes(id) ? {ratioConvention:"ER:IR"} : {}),
      };
    });
  }
  const extraDefs = T.extraDefinitions;
  function preserveAddedMetricCollisions(definitions, source) {
    const added = new Set(extraDefs().filter((d) =>
      source.derivedEnabled === undefined && (["dj","hop","cmrj"].includes(d.testId) || /propulsive_|matched_|impulse250/.test(d.id)) ||
      (source.capabilityVersion !== 1 || !T.isNative(source,d.testId)) && (d.testId === "cpet" || d.id === "rqr" || d.id.endsWith("_active_stiffness")) ||
      (source.fvpVersion !== 1 || !T.isNative(source,d.testId)) && FVP_IDS.includes(d.testId)
    ).map((d) => d.id));
    return definitions.map((d) => added.has(d.id) ? { ...d, legacyManual: true } : d);
  }
  function newJumpAttempt(testId) {
    return { id: uid(), ...Object.fromEntries(T.fieldsForTest(testId).filter((f) => !f.computed).map((f) => [f.key, ""])), metrics: {}, notes: "" };
  }
  function newHopSet() {
    return { id: uid(), inputMode: "summary", summary: { height: "", contactTimeMs: "", flightTimeMs: "", rsi: "", flightTimeRatio: "", activeStiffness: "", selectionBasis: "unknown", suppliedCount: "", validCount: "", selectedCount: "", notes: "" },
      jumps: [{ id: uid(), height: "", contactTimeMs: "", flightTimeMs: "", notes: "" }], notes: "" };
  }
  function hasMeaningfulHopSet(set) {
    const present = (row, keys) => keys.some(key => N(row?.[key]) !== null);
    return present(set?.summary, ["height", "contactTimeMs", "flightTimeMs", "rsi", "flightTimeRatio", "activeStiffness"]) ||
      (set?.jumps || []).some(jump => present(jump, ["height", "contactTimeMs", "flightTimeMs"]));
  }
  function cpetDefaults() {
    const threshold = label => ({ label, vo2: "", vo2Unit: "ml/kg/min", hr: "", speed: "", power: "" });
    return { modality: "", protocol: "", oxygenLabel: "VO2peak", vo2: "", vo2Unit: "ml/kg/min", peakHr: "", rer: "", thresholds: { first: threshold("VT1"), second: threshold("VT2") } };
  }
  function normalizeCPET(input) {
    const base = cpetDefaults(), value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    return { ...base, ...value, thresholds: { first: { ...base.thresholds.first, ...value.thresholds?.first }, second: { ...base.thresholds.second, ...value.thresholds?.second } } };
  }
  function cpetSummary(record) {
    const data = normalizeCPET(record.data.cpet), mass = positive(record.athlete.mass), issues = [];
    const oxygen = input => {
      const value = positive(input.vo2), unit = input.vo2Unit;
      const relative = value === null ? null : unit === "ml/kg/min" ? value : unit === "l/min" && mass !== null ? value * 1000 / mass : null;
      const absolute = value === null ? null : unit === "l/min" ? value : unit === "ml/kg/min" && mass !== null ? value * mass / 1000 : null;
      return { value, unit, relative, absolute };
    };
    const peak = { ...oxygen(data), label: data.oxygenLabel, hr: positive(data.peakHr), rer: positive(data.rer) };
    const thresholds = Object.fromEntries(["first", "second"].map((key, index) => {
      const input = data.thresholds[key], measured = oxygen(input);
      let percentage = measured.relative !== null && peak.relative !== null ? measured.relative / peak.relative * 100
        : measured.absolute !== null && peak.absolute !== null ? measured.absolute / peak.absolute * 100 : null;
      if (percentage !== null && percentage > 100) { issues.push({ id: "cpet_threshold" + (index + 1) + "_above_peak", testId: "cpet", status: "amber", message: input.label + " 摄氧量高于本次" + peak.label + "，请核对原报告" }); percentage = null; }
      return [key, { ...measured, label: input.label, percentage, hr: positive(input.hr), speed: data.modality === "treadmill" ? positive(input.speed) : null, power: data.modality === "cycle" ? positive(input.power) : null }];
    }));
    const first = thresholds.first, second = thresholds.second;
    const comparable = first.relative !== null && second.relative !== null ? [first.relative, second.relative] : first.absolute !== null && second.absolute !== null ? [first.absolute, second.absolute] : null;
    if (comparable && comparable[0] >= comparable[1]) {
      issues.push({ id: "cpet_threshold_order", testId: "cpet", status: "amber", message: "第一阈值摄氧量须低于第二阈值，请核对原报告" });
      first.percentage = null; second.percentage = null;
    }
    return { modality: data.modality, protocol: data.protocol || record.protocol.cpet || "", peak, thresholds, issues };
  }
  function normalizeHopSet(input, prefix = "hop") {
    const base = newHopSet(), s = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const result = { ...base, ...s, inputMode: s.inputMode === "jumps" ? "jumps" : "summary", summary: { ...base.summary, ...s.summary },
      jumps: (Array.isArray(s.jumps) ? s.jumps : base.jumps).map((row, i) => ({ ...row, id: row.id || prefix + "_jump_" + i })) };
    if (Array.isArray(s.trials)) result.trials = s.trials.map((set, i) => {
      const normalized = normalizeHopSet({ ...set, trials: undefined }, prefix + "_set_" + i);
      normalized.id = set.id || prefix + "_set_" + i;
      delete normalized.trials;
      return normalized;
    });
    return result;
  }
  function convertDefinition(input, legacy = false) {
    const d = clone(input);
    if (!d.legacyManual) ["name","protocol"].forEach(key => { d[key] = Def.factoryText(d.id,key,d[key]); });
    d.ranges = Array.isArray(d.ranges) ? d.ranges : [];
    if (d.unit === "km/h") {
      if (N(d.target) !== null) d.target = N(d.target) / 3.6;
      d.ranges.forEach((r) => {
        ["min", "max"].forEach((k) => {
          if (N(r[k]) !== null) r[k] = N(r[k]) / 3.6;
        });
      });
      d.unit = "m/s";
    }
    if (typeof d.protocol === "string")
      d.protocol = migrateLegacySpeedText(d.protocol, {}).text;
    if (d.id === "cmj_height" && ["CMJ","CMJ 垂直跳跃高度"].includes(d.name)) d.name = "CMJ";
    if (d.id === "sj_height" && ["SJ","SJ 垂直跳跃高度"].includes(d.name)) d.name = "SJ";
    if (["squat_1rm", "bench_1rm", "deadlift_1rm"].includes(d.id))
      d.name = d.name.replace(/估计\s*1RM/g, "预估1RM");
    // Only the preserved built-in intervals have a known excellence meaning.
    if (Def.builtins.some((x) => x.id === d.id))
      d.ranges.forEach((r) => {
        if (r.advantage === undefined) r.advantage = r.label === "优秀";
      });
    return d;
  }
  function defaults() {
    const rows = isoRows();
    return {
      schema: 2,
      capabilityVersion: 1,
      fvpVersion: 1,
      kind: "assessment-record",
      athleteId: uid(),
      recordId: uid(),
      updated: now(),
      demo: false,
      athlete: {
        name: "",
        birthDate: "",
        age: "",
        sex: "未注明",
        mass: "",
        height: "",
        stance: "",
        sport: "",
        dominantHand: "未注明",
        date: date(),
        sportLevel: "",
        injury: "",
        injuryHistory: "",
        cycle: "",
        notes: "",
      },
      enabled: Object.fromEntries(TESTS.map((t) => [t[0], !FVP_IDS.includes(t[0])])),
      mode: "best",
      trainingContext: {
        experienceYears: "",
        equipment: "",
        weeklySchedule: "",
        weeklySessions: "",
        previousCompetitionDate: "",
        nextCompetitionDate: "",
      },
      data: {
        fms: FM.map(([name, bilateral]) => ({
          name,
          bilateral,
          ...(bilateral ? { left: "", right: "" } : { score: "" }),
          pain: false,
          location: "",
          notes: "",
        })),
        iso: rows,
        cmj: [
          {
            id: uid(),
            height: "",
            force: "",
            rsiModified: "",
            landingPeakForce: "",
            metrics: {},
          },
        ],
        sj: [
          {
            id: uid(),
            height: "",
            force: "",
            rsiModified: "",
            landingPeakForce: "",
            metrics: {},
          },
        ],
        dj: [newJumpAttempt("dj")],
        hop: newHopSet(),
        cmrj: [newJumpAttempt("cmrj")],
        fvp_sj: [],
        fvp_cmj: [],
        imtp: [
          normalizeIMTP({
            id: uid(),
            peakForce: "",
            f100: "",
            f200: "",
            rfd100: "",
            rfd200: "",
          }),
        ],
        landmine: [
          { id: uid(), load: "", side: "R", velocity: "" },
          { id: uid(), load: "", side: "L", velocity: "" },
        ],
        squat: [{ id: uid(), load: "", velocity: "" }],
        bench: [{ id: uid(), load: "", velocity: "" }],
        deadlift: [{ id: uid(), load: "", velocity: "" }],
        pushup: { reps: "", notes: "" },
        mb: [
          { id: uid(), side: "D", distance: "" },
          { id: uid(), side: "ND", distance: "" },
        ],
        lactate: [{ id: uid(), speed: "", lactate: "", hr: "" }],
        cpet: cpetDefaults(),
        ift: { speed: "", unit: "m/s", protocol: "shuttle", partial: "" },
        mas: { speed: "", unit: "m/s", method: "" },
        mss: { speed: "", unit: "m/s", method: "" },
      },
      protocol: {
        cmj: "双手叉腰；测量方法与设备待记录",
        sj: "双手叉腰；静止起跳；测量方法与设备待记录",
        fvp_sj: "双手叉腰；静止 SJ；分负荷测量跳跃高度和推进距离；同负荷选最高有效试次",
        fvp_cmj: "双手叉腰；统一反向动作与起跳姿势；分负荷测量跳跃高度和推进距离；同负荷选最高有效试次",
        dj: "双手叉腰；记录跌落高度；落地后立即反弹；RSI 为垂直跳跃高度/触地时间。",
        hop: "垂直连续反应跳；≤5 个有效跳按已筛选数据使用，>5 个按垂直跳跃高度/触地时间选最高5个；保留实际数量。",
        cmrj: "双手叉腰；最大 CMJ 后落地立即反弹；分别记录首跳和第二跳。",
        imtp: "IMTP；姿势、固定方式、采样率与力起点待记录",
        iso: "",
        landmine: "峰值速度；负荷定义、设备与固定方式待记录",
        mb: "3 kg 单手后手出拳式投掷；距离至第一落点",
        squat: "自由杠深蹲；深度与设备待记录",
        bench: "卧推；停顿、握距与设备待记录",
        deadlift: "传统硬拉；起始方式与设备待记录",
        lactate: "跑台；每级3 min；采样恢复1 min",
        cpet: "CPET 实测；保留原报告阈值与摄氧量名称",
      },
      cmjConfig: { definition: "gross", impulseDefinition: "gross" },
      imtpConfig: { unit: "N", definition: "gross", impulseDefinition: "gross" },
      impulseConfig: { confirmed: false },
      derivedEnabled: T.derivedDefaults(),
      imtpTimeStandards: [],
      fvpConfig: Object.fromEntries(FVP_IDS.map(id => [id, fvpConfigDefaults()])),
      fvpAnalysis: Object.fromEntries(FVP_IDS.map(id => [id, fvpAnalysisDefaults()])),
      fvpView: Object.fromEntries(FVP_IDS.map(id => [id, fvpViewDefaults()])),
      lvp: {
        squat: { metric: "MV", mvt: "", zones: [] },
        bench: { metric: "MV", mvt: "", zones: [] },
        deadlift: { metric: "MV", mvt: "", zones: [] },
        landmineR: { metric: "PV", mvt: "", zones: [] },
        landmineL: { metric: "PV", mvt: "", zones: [] },
      },
      thresholds: {
        lt1: "",
        lt2: "",
        unit: "m/s",
        method: "曲线转折点；人工确认",
      },
      dsi: {
        source: "imtp",
        force: "",
        protocol: "IMTP",
        definition: "gross",
        cmjUnit: "N",
        cmjDefinition: "gross",
        confirmed: false,
      },
      definitions: Def.defaultDefinitions()
        .map(convertDefinition)
        .concat(extraDefs()),
      customTests: [],
      customValues: {},
      axes: {},
      balancePairs: balancePairs(rows),
      rules: {
        asymAmber: 10,
        asymRed: 15,
        absoluteAmber: 80,
        scoreAmber: 80,
        scoreGreen: 100,
      },
      views: {
        idsiWindow: "idsi_matched",
        imtp: { yAxis: "percent" },
        redScope: "all",
        amberScope: "all",
        advantageAbility: "all",
        overview: "overall",
        lvpUpper: {
          selected: ["bench"],
          showPoints: true,
          showBand: true,
          showEstimate: true,
          bandExplicit: false,
        },
        lvpLower: {
          selected: ["squat"],
          showPoints: true,
          showBand: true,
          showEstimate: true,
          bandExplicit: false,
        },
      },
      narrative: {
        html: "",
        text: "",
        updated: "",
        basis: "",
        origin: "",
        revision: 0,
      },
    };
  }

  function textToHTML(text) {
    const lines = String(text || "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    let html = "",
      paragraph = [],
      list = [],
      ordered = false;
    const inline = (t) =>
      esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    function flush() {
      if (paragraph.length) {
        html += "<p>" + paragraph.map(inline).join("<br>") + "</p>";
        paragraph = [];
      }
      if (list.length) {
        const tag = ordered ? "ol" : "ul";
        html +=
          "<" +
          tag +
          ">" +
          list.map((t) => "<li>" + inline(t) + "</li>").join("") +
          "</" +
          tag +
          ">";
        list = [];
      }
    }
    const cells = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
    const separator = (line) => /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line.includes("|") && index + 1 < lines.length && separator(lines[index + 1])) {
        flush();
        const headers = cells(line), rows = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes("|")) rows.push(cells(lines[index++]));
        index--;
        const columns = Math.max(headers.length, ...rows.map((row) => row.length));
        html += "<table><thead><tr>" + Array.from({length: columns}, (_, i) => "<th>" + inline(headers[i] || "") + "</th>").join("") + "</tr></thead><tbody>" +
          rows.map((row) => "<tr>" + Array.from({length: columns}, (_, i) => "<td>" + inline(row[i] || "") + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
        continue;
      }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flush(); continue; }
      const t = line.trim(),
        heading = t.match(/^(?:【(.+?)】|#{1,6}\s+(.+))$/),
        bullet = t.match(/^(?:[•●▪*\-]\s+|\d+[.)、]\s*)(.+)$/);
      if (!t) {
        flush();
        continue;
      }
      if (heading) {
        flush();
        html += "<h3>" + inline(heading[1] || heading[2]) + "</h3>";
        continue;
      }
      if (bullet) {
        if (paragraph.length) flush();
        const isOrdered = /^\d/.test(t);
        if (list.length && isOrdered !== ordered) flush();
        ordered = isOrdered;
        list.push(bullet[1]);
        continue;
      }
      if (list.length) flush();
      paragraph.push(line);
    }
    flush();
    return html;
  }
  function sanitizeHTML(html) {
    const allowed = new Set([
      "p",
      "br",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "table", "thead", "tbody", "tr", "th", "td",
    ]);
    const forbidden = new Set([
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "svg",
      "math",
      "template",
    ]);
    if (root.document && root.document.createElement) {
      // Template parsing is inert: image loading/event handlers cannot run before cleaning.
      const template = root.document.createElement("template");
      template.innerHTML = String(html || "");
      const node = template.content;
      function clean(parent) {
        [...parent.childNodes].forEach((child) => {
          if (child.nodeType === 8) {
            child.remove();
            return;
          }
          if (child.nodeType !== 1) return;
          const tag = child.tagName.toLowerCase();
          if (forbidden.has(tag)) {
            child.remove();
            return;
          }
          clean(child);
          if (!allowed.has(tag)) {
            child.replaceWith(...child.childNodes);
            return;
          }
          [...child.attributes].forEach((attribute) =>
            child.removeAttribute(attribute.name),
          );
        });
      }
      clean(node);
      return template.innerHTML;
    }
    // The Node verification route uses the same tag allowlist; browser import uses DOM parsing above.
    return String(html || "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(
        /<(script|style|iframe|object|embed|svg|math|template)\b[^>]*>[^]*?<\/\1\s*>/gi,
        "",
      )
      .replace(/<\/?([A-Za-z][\w:-]*)\b[^>]*>/g, (tag, name) =>
        allowed.has(name.toLowerCase())
          ? (tag.startsWith("</") ? "</" : "<") + name.toLowerCase() + ">"
          : "",
      );
  }
  function htmlToText(html) {
    return String(html || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|h[234]|li|blockquote)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  function migrateLegacySpeedText(text, legacyRecord) {
    const toKMH = (row, defaultUnit) =>
      positive(row?.speed) === null
        ? null
        : N(row.speed) * ((row.unit || defaultUnit) === "m/s" ? 3.6 : 1);
    const mas = toKMH(legacyRecord.data?.mas, "km/h"),
      mss = toKMH(legacyRecord.data?.mss, "m/s");
    const known = {
      MAS: mas,
      MSS: mss,
      ASR: mas !== null && mss !== null ? mss - mas : null,
      VIFT: toKMH(legacyRecord.data?.ift, "km/h"),
      LT1: toKMH(
        {
          speed: legacyRecord.thresholds?.lt1,
          unit: legacyRecord.thresholds?.unit,
        },
        "km/h",
      ),
      LT2: toKMH(
        {
          speed: legacyRecord.thresholds?.lt2,
          unit: legacyRecord.thresholds?.unit,
        },
        "km/h",
      ),
    };
    known.LTP1 = known.LT1;
    known.LTP2 = known.LT2;
    const numberPattern = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
    const namePattern = "(?:ASR|MAS|MSS|VIFT|LTP1|LTP2|LT1|LT2)";
    const tokenPattern =
      "(?:" + namePattern + "\\s*[:：]?\\s*)?" + numberPattern;
    const expression = new RegExp(
      "(" +
        tokenPattern +
        "(?:\\s*(?:[–—~～至/、,，-]|\\.\\.)\\s*" +
        tokenPattern +
        ")*)\\s*km\\s*/\\s*h\\b",
      "gi",
    );
    const tokens = new RegExp(
      "(" + namePattern + "\\s*[:：]?\\s*)?(" + numberPattern + ")",
      "gi",
    );
    const reasons = [];
    let converted = false;
    const result = String(text || "").replace(expression, (match, values) => {
      converted = true;
      const range = /[–—~～至]|\d\s*-\s*\d|\.\./.test(values);
      return (
        values.replace(tokens, (token, prefix, numericText) => {
          const number = Number(numericText),
            name = prefix
              ?.match(new RegExp(namePattern, "i"))?.[0]
              .toUpperCase();
          let canonical = number / 3.6;
          if (name && !range) {
            const originalValue = known[name],
              parts = numericText.toLowerCase().split("e"),
              decimals =
                (parts[0].split(".")[1] || "").length - Number(parts[1] || 0),
              halfStep = 0.5 * Math.pow(10, -decimals);
            if (
              originalValue !== null &&
              Math.abs(originalValue - number) <= halfStep + 1e-9
            )
              canonical = originalValue / 3.6;
            else
              reasons.push(
                name + "旧文字与测试数据未能确认一致，按文字原值换算",
              );
          }
          return (prefix || "") + fmt(canonical, 2);
        }) + " m/s"
      );
    });
    if (/km\s*\/\s*h\b/i.test(result))
      reasons.push("部分速度单位未与明确数值相连，保留原文待复核");
    return {
      text: result,
      converted,
      review: { required: reasons.length > 0, reasons: [...new Set(reasons)] },
    };
  }
  function normalizeRecord(input) {
    if (!input || typeof input !== "object") return defaults();
    const s = clone(input),
      d = defaults(),
      legacy = s.schema !== 2;
    (s.projectSnapshots || []).forEach(test => { if (FVP_IDS.includes(test.id) && test.measurementVersion !== 1) test.legacyCustom = true; });
    validateAbilityGroups(s.abilityGroupSnapshot);
    if (s.schema === 1 && !safeId(s.recordId))
      throw new Error("旧版报告缺少有效的测试记录 ID");
    const out = { ...d, ...s, schema: 2, kind: "assessment-record" };
    out.imtpTimeStandards = s.imtpTimeStandards === undefined ? [] : clone(s.imtpTimeStandards);
    if (s.schema === 1 && !s.athleteId) out.athleteId = "legacy_" + s.recordId;
    out.athlete = { ...d.athlete, ...s.athlete };
    out.trainingContext = { ...d.trainingContext, ...s.trainingContext };
    out.enabled = { ...d.enabled, ...s.enabled };
    ["dj", "hop", "cmrj", "cpet", ...FVP_IDS].forEach((id) => { if (!Object.hasOwn(s.enabled || {}, id)) out.enabled[id] = false; });
    out.data = { ...d.data, ...s.data };
    out.data.fms = (out.data.fms || []).map(row => {
      const next = {...row}, builtin = FM.find(([name]) => name === row.name);
      if (typeof next.bilateral !== "boolean" && builtin) next.bilateral = builtin[1];
      if (next.bilateral === false) for (const key of ["left", "right", "l", "r"]) if (next[key] === "" || next[key] == null) delete next[key];
      return next;
    });
    if (T.isNative(s,"hop")) out.data.hop = normalizeHopSet(s.data?.hop);
    if (T.isNative(s,"cpet")) out.data.cpet = normalizeCPET(s.data?.cpet);
    out.derivedEnabled = { ...d.derivedEnabled, ...s.derivedEnabled };
    out.impulseConfig = { ...d.impulseConfig, ...s.impulseConfig };
    out.fvpConfig = { ...s.fvpConfig };
    out.fvpAnalysis = { ...s.fvpAnalysis };
    out.fvpView = { ...s.fvpView };
    FVP_IDS.filter(id => T.isNative(s, id)).forEach(id => {
      out.data[id] = (Array.isArray(s.data?.[id]) ? s.data[id] : []).map((row, i) => ({
        ...row, id: row.id || "row_" + id + "_" + i, load: row.load ?? "", height: row.height ?? "", distanceCm: row.distanceCm ?? "",
        notes: row.notes ?? "", excluded: row.excluded ?? false, exclusionReason: row.exclusionReason ?? "",
      }));
      out.fvpConfig[id] = { ...fvpConfigDefaults(), ...s.fvpConfig?.[id] };
      out.fvpAnalysis[id] = { ...fvpAnalysisDefaults(), ...s.fvpAnalysis?.[id] };
      out.fvpView[id] = { ...fvpViewDefaults(), ...s.fvpView?.[id] };
    });
    out.fvpVersion = 1;
    ["ift", "mas", "mss", "pushup"].forEach((t) => {
      out.data[t] = { ...d.data[t], ...s.data?.[t] };
    });
    out.rules = { ...s.rules };
    delete out.rules.fmsAmber;
    out.protocol = { ...d.protocol, ...s.protocol };
    Object.keys(out.protocol).forEach((id) => {
      const migration = migrateLegacySpeedText(out.protocol[id], s);
      out.protocol[id] = T.isNative(s,id) ? Def.factoryText(id,"testProtocol",migration.text) : migration.text;
      if (migration.review.required) {
        out.unitMigration ||= {
          required: true,
          reasons: [],
          originalProtocol: {},
        };
        out.unitMigration.originalProtocol[id] = s.protocol?.[id] || "";
        out.unitMigration.reasons = [
          ...new Set(
            out.unitMigration.reasons.concat(migration.review.reasons),
          ),
        ];
      }
    });
    out.thresholds = { ...d.thresholds, ...s.thresholds };
    out.imtpConfig = {
      ...d.imtpConfig,
      definition: legacy
        ? s.dsi?.definition || d.imtpConfig.definition
        : d.imtpConfig.definition,
      ...s.imtpConfig,
    };
    out.cmjConfig = {
      ...d.cmjConfig,
      definition:
        s.cmjConfig?.definition ||
        s.dsi?.cmjDefinition ||
        (legacy ? s.dsi?.definition : "") ||
        d.cmjConfig.definition,
      ...s.cmjConfig,
    };
    out.dsi = { ...d.dsi, ...s.dsi };
    out.customTests = Array.isArray(s.customTests) ? s.customTests : [];
    out.customValues =
      s.customValues && typeof s.customValues === "object"
        ? s.customValues
        : {};
    out.axes = s.axes && typeof s.axes === "object" ? s.axes : {};
    out.views = {
      ...d.views,
      ...s.views,
      imtp: { yAxis: s.views?.imtp?.yAxis === "force" ? "force" : "percent" },
      lvpUpper: { ...d.views.lvpUpper, ...s.views?.lvpUpper },
      lvpLower: { ...d.views.lvpLower, ...s.views?.lvpLower },
    };
    out.lvp = Object.fromEntries(
      Object.entries(d.lvp).map(([t, cfg]) => [t, { ...cfg, ...s.lvp?.[t] }]),
    );
    [
      "fms",
      "iso",
      "cmj",
      "sj",
      "dj",
      "cmrj",
      "imtp",
      "landmine",
      "squat",
      "bench",
      "deadlift",
      "mb",
      "lactate",
    ].forEach((t) => {
      if (!Array.isArray(out.data[t])) out.data[t] = d.data[t];
    });
    [
      "fms",
      "cmj",
      "sj",
      "dj",
      "cmrj",
      "imtp",
      "landmine",
      "squat",
      "bench",
      "deadlift",
      "mb",
      "lactate",
    ].forEach((t) => {
      out.data[t] = out.data[t].map((row, i) => ({
        ...row,
        id: row.id || "row_" + t + "_" + i,
      }));
    });
    out.data.iso = out.data.iso.map((r) => {
      const row = { ...r, id: r.id || uid() };
      normalizeIsoDirection(row);
      return { ...row, protocol: row.protocol || "", notes: row.notes || "" };
    });
    validateIsoDirectionIds(out.isoDirectionIds, out.data.iso);
    const inferredPairs = balancePairs(out.data.iso);
    out.balancePairs = Array.isArray(s.balancePairs)
      ? s.balancePairs.concat(
          inferredPairs.filter(
            (p) => !s.balancePairs.some((existing) => existing.id === p.id),
          ),
        )
      : inferredPairs;
    out.balancePairs.forEach(pair => migrateBalancePair(pair, out.data.iso));
    out.definitions = preserveAddedMetricCollisions((
      Array.isArray(s.definitions) ? s.definitions : d.definitions
    ), s).map((x) => convertDefinition(x, legacy));
    const existing = new Set(out.definitions.map((x) => x.id));
    extraDefs()
      .filter(
        (x) => ["imtp", "cmj", "sj", "dj", "hop", "cmrj", "cpet", ...FVP_IDS].includes(x.testId) && T.isNative(out,x.testId) && !existing.has(x.id),
      )
      .forEach((x) => out.definitions.push(x));
    out.projectSnapshots = T.snapshots(out);
    T.describe(out).forEach((test) => {
      if (!T.isNative(out,test.id) && test.repeatPolicy.fields.length) {
        if (!Array.isArray(out.data[test.id])) out.data[test.id] = [{ id: "row_" + test.id + "_0", metrics: {}, notes: "" }];
        out.data[test.id] = out.data[test.id].map((row, i) => ({ ...row, id: row.id || "row_" + test.id + "_" + i, metrics: { ...row.metrics } }));
      }
    });
    const normalizeTrials = (parent, prefix) => {
      if (Array.isArray(parent.trials)) parent.trials = parent.trials.map((row, i) => ({ ...row, id: row.id || prefix + "_trial_" + i, metrics: { ...row.metrics } }));
    };
    ["pushup", "mas", "mss", "ift"].forEach((id) => normalizeTrials(out.data[id], id));
    out.data.iso.forEach((row) => normalizeTrials(row, row.id));
    ["cmj", "sj", "dj", "cmrj"].filter((id) => T.isNative(out,id)).forEach((id) => {
      out.data[id] = out.data[id].map((row) => ({
        ...d.data[id][0],
        ...row,
        metrics: { ...row.metrics },
      }));
    });
    ["mas", "mss", "ift"].forEach((t) => {
      const row = out.data[t],
        inputUnit =
          s.data?.[t]?.unit ||
          (legacy ? (t === "mss" ? "m/s" : "km/h") : "m/s");
      if (inputUnit === "km/h" || (legacy && inputUnit !== "m/s")) {
        if (N(row.speed) !== null) row.speed = N(row.speed) / 3.6;
      }
      (row.trials || []).forEach((trial) => {
        if ((trial.unit || inputUnit) === "km/h" && N(trial.speed) !== null) trial.speed = N(trial.speed) / 3.6;
        trial.unit = "m/s";
      });
      row.unit = "m/s";
    });
    out.data.lactate.forEach((r) => {
      if (r.unit === "km/h" || (legacy && r.unit !== "m/s")) {
        if (N(r.speed) !== null) r.speed = N(r.speed) / 3.6;
      }
      r.unit = "m/s";
    });
    if (
      s.thresholds?.unit === "km/h" ||
      (legacy && s.thresholds?.unit !== "m/s")
    )
      ["lt1", "lt2"].forEach((k) => {
        if (N(out.thresholds[k]) !== null)
          out.thresholds[k] = N(out.thresholds[k]) / 3.6;
      });
    out.thresholds.unit = "m/s";
    (s.definitions || [])
      .filter((x) => x.unit === "km/h")
      .forEach((x) => {
        mapMetricResults(out, x, (value) =>
          N(value) === null ? value : N(value) / 3.6,
        );
      });
    if (legacy) {
      if (
        positive(s.dsi?.force) !== null &&
        /^IMTP$/i.test(String(s.dsi.protocol || ""))
      ) {
        if (!out.data.imtp.some((r) => positive(r.peakForce) !== null))
          out.data.imtp = [
            {
              id: uid(),
              peakForce: N(s.dsi.force),
              f100: "",
              f200: "",
              rfd100: "",
              rfd200: "",
              migratedFrom: "dsi",
            },
          ];
        out.dsi.source = "imtp";
      } else if (positive(s.dsi?.force) !== null) out.dsi.source = "manual";
      const fragments = [
        ["数据解读", s.narratives?.interpretation],
        ["干预建议", s.narratives?.recommendations],
      ].filter(([, n]) => n && (n.text || n.html));
      if (fragments.length && !s.narrative) {
        const converted = fragments.map(([title, n]) => ({
          title,
          migration: migrateLegacySpeedText(
            n.text || htmlToText(sanitizeHTML(n.html)),
            s,
          ),
        }));
        out.narrative = {
          ...d.narrative,
          html: converted
            .map(
              ({ title, migration }) =>
                "<h3>" + title + "</h3>" + textToHTML(migration.text),
            )
            .join(""),
          updated:
            fragments
              .map(([, n]) => n.updated || "")
              .sort()
              .at(-1) || "",
          origin: "migrated",
          revision: 0,
          legacyTexts: {
            interpretation: String(s.narratives?.interpretation?.text || ""),
            recommendations: String(s.narratives?.recommendations?.text || ""),
          },
          migrationReview: {
            required: converted.some((x) => x.migration.review.required),
            reasons: [
              ...new Set(converted.flatMap((x) => x.migration.review.reasons)),
            ],
          },
        };
        out.narrative.text = htmlToText(out.narrative.html);
      }
    }
    out.data.imtp = out.data.imtp.map(normalizeIMTP);
    out.narrative = { ...d.narrative, ...out.narrative };
    out.narrative.html = sanitizeHTML(
      out.narrative.html || textToHTML(out.narrative.text),
    );
    if (/km\s*\/\s*h\b/i.test(out.narrative.html)) {
      const migration = migrateLegacySpeedText(out.narrative.html, s);
      out.narrative.legacySpeedHTML ||= out.narrative.html;
      out.narrative.html = migration.text;
      out.narrative.migrationReview = {
        required:
          !!out.narrative.migrationReview?.required ||
          migration.review.required,
        reasons: [
          ...new Set([
            ...(out.narrative.migrationReview?.reasons || []),
            ...migration.review.reasons,
          ]),
        ],
      };
    }
    out.narrative.text = htmlToText(out.narrative.html);
    delete out.narratives;
    return out;
  }

  function normalizeIMTP(input) {
    const row = {
      ...input,
      baselineForce: input.baselineForce ?? "",
      peakTimeMs: input.peakTimeMs ?? "",
    };
    // An explicitly empty array is authoritative: deleted legacy points must not return.
    const points = Array.isArray(input.timePoints)
      ? input.timePoints
      : [100, 200]
          .filter(
            (t) => N(input["f" + t]) !== null || N(input["rfd" + t]) !== null,
          )
          .map((t) => ({
            id: "legacy_" + t,
            timeMs: t,
            force: input["f" + t] ?? "",
            rfd: input["rfd" + t] ?? "",
          }));
    row.timePoints = points.map((p, i) => ({
      ...p,
      id: p.id || "time_" + i,
      force: p.force ?? "",
      rfd: p.rfd ?? "",
    }));
    return row;
  }
  function syncIMTPLegacy(row) {
    [100, 200].forEach((t) => {
      const point = (row.timePoints || []).find((p) => N(p.timeMs) === t);
      row["f" + t] = point?.force ?? "";
      row["rfd" + t] = point?.rfd ?? "";
    });
    return row;
  }
  function imtpTimeContext(record) {
    return { protocol: record.protocol?.imtp || "", force: { unit: record.imtpConfig?.unit || "N", definition: record.imtpConfig?.definition || "gross" } };
  }
  function imtpTimeStandard(record, timeMs, kind) {
    const rule = (record.imtpTimeStandards || []).find(r => r.timeMs === timeMs && r.kind === kind);
    if (rule) {
      const current = imtpTimeContext(record), context = rule.context;
      const matched = rule.matched !== false && context?.protocol === current.protocol &&
        context.force?.unit === current.force.unit && context.force?.definition === current.force.definition;
      return { ...clone(rule), unit: kind === "force_pct_peak" ? "%PF" : "N/s", matched,
        referenceEnabled: matched && rule.referenceEnabled, target: matched ? rule.target : null,
        ranges: matched ? clone(rule.ranges) : [] };
    }
    const definition = record.definitions.find(d => d.id === "imtp_" + (kind === "force_pct_peak" ? "f" : "rfd") + timeMs);
    return definition ? { ...clone(definition), kind: kind === "force_pct_peak" ? "force_absolute" : "rfd", matched: true } : null;
  }
  function imtpTimeEvaluation(value, standard, record, valid = true) {
    if (!valid) return { status: "gray", label: "时点力超过峰值，待核对", range: null };
    if (standard && !standard.matched) return { status: "gray", label: "评价方案与测量条件不匹配", range: null };
    if (!standard?.referenceEnabled) return { status: "gray", label: "未启用评价标准", range: null };
    return evaluation(value, standard, record);
  }
  function withoutReplacedIMTPStandards(record) {
    if (!record.imtpTimeStandards?.length) return record.definitions;
    const replaced = new Set(record.imtpTimeStandards.map(rule => "imtp_" + (rule.kind === "force_pct_peak" ? "f" : "rfd") + rule.timeMs));
    return record.definitions.map(d => replaced.has(d.id) ? { ...d, referenceEnabled: false, target: null, ranges: [] } : d);
  }
  function forceTime(record) {
    const mode = record.mode === "mean" ? "mean" : "best";
    const out = {
      mode,
      n: 0,
      selectedIndex: null,
      points: [],
      timeRows: [],
      peakForce: null,
      peakTimeMs: null,
      baselineForce: null,
      baselinePercent: null,
      issues: [],
    };
    if (!record.enabled?.imtp) return out;
    const rows = (record.data.imtp || []).map((row, index) => ({
      row: normalizeIMTP(row),
      index,
    }));
    const differs = (a, b) =>
      Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    const issue = (trialIndex, code, message, timeMs) =>
      out.issues.push({
        id:
          "imtp_" +
          code +
          "_" +
          trialIndex +
          (timeMs === undefined ? "" : "_" + timeMs),
        status: "amber",
        trialIndex,
        ...(timeMs === undefined ? {} : { timeMs }),
        message,
      });
    rows
      .filter((x) => N(x.row.peakForce) !== null && N(x.row.peakForce) < 0)
      .forEach((x) =>
        issue(
          x.index,
          "negative_peak",
          "第 " + (x.index + 1) + " 次 IMTP 峰值力为负，请核对原始测量",
        ),
      );
    const valid = rows.filter((x) => positive(x.row.peakForce) !== null);
    out.n = valid.length;
    if (!valid.length) {
      // Entry warnings must remain available before a valid peak makes plotting possible.
      rows.forEach(({ row, index }) => {
        if (N(row.baselineForce) !== null && N(row.baselineForce) < 0)
          issue(
            index,
            "negative_baseline",
            "第 " + (index + 1) + " 次基线力为负，未用于 RFD 换算",
          );
        row.timePoints.forEach((p, pointIndex) => {
          const t = positive(p.timeMs),
            label =
              t === null
                ? "第 " + (pointIndex + 1) + " 个时间点"
                : fmt(t) + " ms";
          if (N(p.force) !== null && N(p.force) < 0)
            issue(
              index,
              "negative_force_point_" + pointIndex,
              "第 " +
                (index + 1) +
                " 次 " +
                label +
                "力为负，已保留原值并排除绘图",
              t === null ? undefined : t,
            );
          if (N(p.rfd) !== null && N(p.rfd) < 0)
            issue(
              index,
              "negative_rfd_point_" + pointIndex,
              "第 " +
                (index + 1) +
                " 次 " +
                (t === null ? label : "0–" + fmt(t) + " ms") +
                " RFD 为负，未用于换算",
              t === null ? undefined : t,
            );
        });
      });
      return out;
    }
    const chosen =
      mode === "best"
        ? [
            valid.reduce((a, b) =>
              N(b.row.peakForce) > N(a.row.peakForce) ? b : a,
            ),
          ]
        : valid;
    if (mode === "best") out.selectedIndex = chosen[0].index;
    out.peakForce = chosen.reduce(
      (sum, x) => sum + N(x.row.peakForce) / chosen.length,
      0,
    );
    const baselines = chosen.map((x) => nonnegative(x.row.baselineForce));
    if (baselines.every((x) => x !== null)) {
      out.baselineForce = baselines.reduce(
        (a, b) => a + b / baselines.length,
        0,
      );
      out.baselinePercent = Calc.descriptive(chosen.map((x, i) => {
        const value = baselines[i] / N(x.row.peakForce) * 100;
        return Number.isFinite(value) ? value : null;
      }), false).mean;
    }
    const grouped = new Map();
    chosen.forEach(({ row, index }) => {
      const baseline = nonnegative(row.baselineForce),
        times = new Set();
      if (N(row.baselineForce) !== null && N(row.baselineForce) < 0)
        issue(
          index,
          "negative_baseline",
          "第 " + (index + 1) + " 次基线力为负，未用于 RFD 换算",
        );
      row.timePoints.forEach((p) => {
        const t = positive(p.timeMs);
        if (t === null) return;
        if (times.has(t)) {
          issue(
            index,
            "duplicate_time",
            "第 " + (index + 1) + " 次存在重复的 " + fmt(t) + " ms 时间点",
            t,
          );
          return;
        }
        times.add(t);
        const measured = nonnegative(p.force),
          rfd = nonnegative(p.rfd);
        if (N(p.force) !== null && N(p.force) < 0) {
          issue(
            index,
            "negative_force",
            "第 " +
              (index + 1) +
              " 次 " +
              fmt(t) +
              " ms 力为负，已保留原值并排除绘图",
            t,
          );
          return;
        }
        if (N(p.rfd) !== null && N(p.rfd) < 0)
          issue(
            index,
            "negative_rfd",
            "第 " +
              (index + 1) +
              " 次 0–" +
              fmt(t) +
              " ms RFD 为负，未用于换算",
            t,
          );
        const calculated =
          baseline !== null && rfd !== null
            ? baseline + rfd * (t / 1000)
            : null;
        const inferred = Number.isFinite(calculated) ? calculated : null;
        if (calculated !== null && inferred === null)
          issue(
            index,
            "conversion_overflow",
            "第 " +
              (index + 1) +
              " 次 " +
              fmt(t) +
              " ms 的 RFD 换算超出有效数值范围，未用于绘图",
            t,
          );
        if (
          measured !== null &&
          inferred !== null &&
          differs(measured, inferred)
        )
          issue(
            index,
            "force_rfd_conflict",
            "第 " +
              (index + 1) +
              " 次 " +
              fmt(t) +
              " ms 实测力 " +
              fmt(measured) +
              " N 与 RFD 换算力 " +
              fmt(inferred) +
              " N 不一致；图中保留实测力",
            t,
          );
        const force = measured !== null ? measured : inferred;
        if (force === null) {
          if (rfd !== null && baseline === null)
            issue(
              index,
              "baseline_missing",
              "第 " +
                (index + 1) +
                " 次 " +
                fmt(t) +
                " ms 仅录入 RFD，需明确基线力才能换算为力",
              t,
            );
          return;
        }
        if (force > N(row.peakForce) && differs(force, N(row.peakForce)))
          issue(
            index,
            "peak_conflict",
            "第 " +
              (index + 1) +
              " 次 " +
              fmt(t) +
              " ms 力超过所录峰值，请核对测量口径与结果",
            t,
          );
        if (!grouped.has(t)) grouped.set(t, []);
        const percent = force / N(row.peakForce) * 100;
        grouped.get(t).push({ force, percent: Number.isFinite(percent) ? percent : null, derived: measured === null });
      });
    });
    out.points = [...grouped]
      .sort((a, b) => a[0] - b[0])
      .map(([timeMs, ps]) => ({
        timeMs,
        force: ps.reduce((sum, p) => sum + p.force / ps.length, 0),
        percent: Calc.descriptive(ps.map(p => p.percent), false).mean,
        derived: ps.some((p) => p.derived),
        n: ps.length,
        measuredN: ps.filter((p) => !p.derived).length,
        derivedN: ps.filter((p) => p.derived).length,
      }));
    const timeGroups = new Map();
    for (const { row } of chosen) {
      const seen = new Set();
      for (const point of row.timePoints) {
        const time = positive(point.timeMs);
        if (time === null || seen.has(time)) continue;
        seen.add(time);
        if (!timeGroups.has(time)) timeGroups.set(time, []);
        const measured = nonnegative(point.force), peak = N(row.peakForce);
        const percent = measured === null ? null : measured / peak * 100;
        timeGroups.get(time).push({ force: measured, rfd: nonnegative(point.rfd),
          percent: Number.isFinite(percent) ? percent : null,
          percentValid: measured === null || measured <= peak || !differs(measured, peak) });
      }
    }
    out.timeRows = [...timeGroups]
      .sort((a, b) => a[0] - b[0])
      .map(([timeMs, values]) => {
        const rfds = values.map(v => v.rfd).filter(v => v !== null),
          forces = values.map(v => v.force).filter(v => v !== null),
          percentages = values.map(v => v.percent).filter(v => v !== null),
          average = items => items.length ? items.reduce((sum, value) => sum + value / items.length, 0) : null,
          force = average(forces), rfd = average(rfds), forcePercent = average(percentages),
          forcePercentValid = values.every(v => v.percentValid),
          forceStandard = imtpTimeStandard(record, timeMs, "force_pct_peak"),
          rfdStandard = imtpTimeStandard(record, timeMs, "rfd");
        return {
          timeMs,
          force,
          forceN: forces.length,
          forcePercent, forcePercentN: percentages.length, forcePercentValid,
          rfd,
          rfdN: rfds.length,
          source: force === null ? "力未录入" : "实测",
          forceStandard, rfdStandard,
          forceEvaluation: imtpTimeEvaluation(forceStandard?.kind === "force_pct_peak" ? forcePercent : force,
            forceStandard, record, forceStandard?.kind !== "force_pct_peak" || forcePercentValid),
          rfdEvaluation: imtpTimeEvaluation(rfd, rfdStandard, record),
        };
      })
      .filter((p) => p.force !== null || p.rfd !== null);
    if (mode === "best") {
      const { row, index } = chosen[0],
        t = positive(row.peakTimeMs);
      if (N(row.peakTimeMs) !== null && t === null)
        issue(
          index,
          "invalid_peak_time",
          "峰值发生时间须大于 0 ms，未绘制峰值时间点",
        );
      if (t !== null) {
        const p = out.points.find((p) => p.timeMs === t);
        if (p && differs(p.force, out.peakForce))
          issue(
            index,
            "peak_time_conflict",
            "峰值时刻的已录力与峰值力不一致，峰值仅显示为参考线",
            t,
          );
        else out.peakTimeMs = t;
      }
    }
    return out;
  }
  function grade(value, definition) {
    if (N(value) === null)
      return { status: "gray", label: "未录入", range: null };
    if (!definition || !definition.referenceEnabled)
      return { status: "gray", label: "未启用评价标准", range: null };
    if (!definition.ranges?.length)
      return { status: "gray", label: "未设等级区间", range: null };
    const result = Def.grade(value, definition, {
      sharedBoundary: "unclassified",
    });
    return {
      ...result,
      status: ["red", "amber", "green"].includes(result.status)
        ? result.status
        : "gray",
    };
  }
  function attainment(value, definition) {
    if (
      !definition ||
      N(value) === null ||
      positive(definition.target) === null ||
      (Def.builtins.some((d) => d.id === definition.id) &&
        !definition.referenceEnabled)
    )
      return null;
    if (definition.direction === "lower")
      return N(value) === 0
        ? 100
        : Math.max(0, Math.min(100, (N(definition.target) / N(value)) * 100));
    return Calc.score(value, definition.target);
  }
  function unitFactor(from, to) {
    if (from === to) return 1;
    if (from === "N" && to === "kgf") return 1 / 9.80665;
    if (from === "kgf" && to === "N") return 9.80665;
    return null;
  }
  // Called only on owned snapshots: every storage scope follows the same conversion.
  function mapMetricResults(record, definition, transform) {
    const id = definition.id;
    if (record.customValues?.[id])
      record.customValues[id].value = transform(record.customValues[id].value);
    if (T.isAttemptMetric(definition))
      repeatRows(record, definition.testId).forEach((row) => {
        if (row.metrics && Object.hasOwn(row.metrics, id))
          row.metrics[id] = transform(row.metrics[id]);
      });
  }
  function changeMetricUnit(record, id, unit, action) {
    const next = clone(record),
      definition = next.definitions.find((d) => d.id === id);
    if (!T.isManualMetric(definition))
      throw new Error("此指标单位由测试协议确定");
    unit = String(unit || "").trim();
    if (
      !unit ||
      unit.length > 30 ||
      /^(km\s*\/?\s*h|kmph|kph|公里\/小时|千米\/时)$/i.test(unit)
    )
      throw new Error("请填写有效单位；速度使用 m/s");
    const factor = unitFactor(definition.unit, unit);
    if (
      !["convert", "clear"].includes(action) ||
      (action === "convert" && factor === null)
    )
      throw new Error("这两个单位无法直接换算，请选择清空后重新录入");
    next.customValues[id] ||= { value: "", notes: "" };
    const transform = (value) => {
      if (N(value) === null) return value;
      if (action === "clear") return "";
      const converted = N(value) * factor;
      if (!Number.isFinite(converted))
        throw new Error("换算结果超出有效数值范围");
      return converted;
    };
    mapMetricResults(next, definition, transform);
    definition.target =
      action === "clear" ? null : transform(definition.target);
    definition.ranges =
      action === "clear"
        ? []
        : definition.ranges.map((range) => ({
            ...range,
            min: transform(range.min),
            max: transform(range.max),
          }));
    if (action === "clear") definition.referenceEnabled = false;
    definition.unit = unit;
    return next;
  }
  function targetStatus(value, definition, record) {
    if (definition?.referenceEnabled && definition.ranges?.length)
      return grade(value, definition).status;
    const valueScore = attainment(value, definition),
      rules = record?.rules || { scoreAmber: 80, scoreGreen: 100 };
    return valueScore === null
      ? "gray"
      : valueScore >= N(rules.scoreGreen)
        ? "green"
        : valueScore >= N(rules.scoreAmber)
          ? "amber"
          : "red";
  }
  function evaluation(value, definition, record) {
    if (definition?.referenceEnabled && definition.ranges?.length)
      return grade(value, definition);
    const status = targetStatus(value, definition, record);
    return {
      status,
      label:
        status === "gray"
          ? grade(value, definition).label
          : status === "red"
            ? "低于评价目标"
            : status === "amber"
              ? "接近评价目标"
              : "达到评价目标",
      range: null,
    };
  }
  function aggregate(rows, key, mode) {
    return Calc.aggregate(
      (rows || []).filter((r) => positive(r[key]) !== null),
      key,
      mode || "best",
    );
  }
  function speedMS(row, defaultUnit = "m/s") {
    return positive(row?.speed) === null
      ? null
      : N(row.speed) / ((row.unit || defaultUnit) === "km/h" ? 3.6 : 1);
  }
  function groupPoints(rows, side, mode = "best") {
    const map = new Map();
    (rows || [])
      .filter(
        (r) =>
          (!side || r.side === side) &&
          nonnegative(r.load) !== null &&
          positive(r.velocity) !== null,
      )
      .forEach((r) => {
        const key = N(r.load);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
      });
    return [...map]
      .sort((a, b) => a[0] - b[0])
      .map(([load, rs]) => ({
        load,
        velocity: N(aggregate(rs, "velocity", mode).row.velocity),
        n: rs.length,
      }));
  }
  function statusAtScore(score, rules) {
    return score === null
      ? "gray"
      : score >= N(rules.scoreGreen)
        ? "green"
        : score >= N(rules.scoreAmber)
          ? "amber"
          : "red";
  }
  function stronger(left, right) {
    return N(left) === null || N(right) === null || N(left) === N(right)
      ? ""
      : N(left) > N(right)
        ? "L"
        : "R";
  }
  function regionKey(region, side) {
    return ["neck", "trunk"].includes(region)
      ? region
      : region + (side ? "_" + side.toLowerCase() : "");
  }

  function effectiveIsoTarget(record, row, side = "") {
    if (root.RingsideIsoReferences) return root.RingsideIsoReferences.effectiveTarget(record, row, side);
    const target = positive(row.target);
    return {target,kind:target === null ? "none" : "manual",source:"",reason:"",matched:target !== null,basis:row.unit};
  }
  function isoAnalysis(record) {
    return selectedIsoRows(record).map((row) => {
      const left = nonnegative(row.left),
        right = nonnegative(row.right),
        center = nonnegative(row.center);
      const asym =
        row.paired && left !== null && right !== null
          ? Calc.asym(left, right)
          : null;
      const strongSide = stronger(left, right),
        weakSide = strongSide === "L" ? "R" : strongSide === "R" ? "L" : "";
      const asymStatus =
        asym === null
          ? "gray"
          : asym >= N(record.rules.asymRed)
            ? "red"
            : asym >= N(record.rules.asymAmber)
              ? "amber"
              : "green";
      const sides = (
        row.paired
          ? [
              ["L", left, row.painLeft],
              ["R", right, row.painRight],
            ]
          : [["", center, row.painCenter]]
      ).map(([side, value, pain]) => {
        const resolved = effectiveIsoTarget(record,row,side), target = resolved.target;
        const referenceComparison = root.RingsideIsoReferences?.comparison(value,resolved) || null;
        let status = value === null || target === null ? "gray" : "green",
          reasons = [];
        if (pain) {
          status = "red";
          reasons.push("疼痛");
        }
        if (target !== null && value !== null && (referenceComparison ? referenceComparison.status === "amber" : value < target)) {
          if (rank.amber > rank[status]) status = "amber";
          reasons.push((resolved.kind === "reference" ? "低于参考目标 " : "低于评价标准 ") + fmt(target) + " " + row.unit);
        }
        if (side === weakSide && ["red", "amber"].includes(asymStatus)) {
          if (rank[asymStatus] > rank[status]) status = asymStatus;
          reasons.push("双侧差异 " + fmt(asym, 1) + "% " + strongSide);
        }
        return {
          side,
          sideLabel: side || "单项",
          value,
          target,
          targetKind: resolved.kind,
          referenceComparison,
          referenceSource: resolved.source,
          referenceReason: resolved.reason,
          pain: !!pain,
          status,
          label: status === "red" ? "严重" : status === "amber" ? "关注" : status === "green" ? "达标" : value === null ? "未测" : "已测",
          reasons,
          region: regionKey(row.region, side),
        };
      });
      const targets = sides.map(side => side.target).filter(value => value !== null);
      const target = targets.length === sides.length ? targets.reduce((a,b) => a+b,0)/targets.length : null;
      return {
        ...row,
        left,
        right,
        center,
        target,
        targetKind: sides[0]?.targetKind || "none",
        referenceSource: row.reference?.source || "",
        asym,
        asymmetry: asym,
        strongSide,
        weakSide,
        asymStatus,
        status: sides.reduce(
          (a, s) => (rank[s.status] > rank[a] ? s.status : a),
          "gray",
        ),
        sides,
        balance: [],
      };
    });
  }
  // Display-only aggregation. Directional grades and ability scores keep their original inputs.
  function isoRadar(rows, record) {
    const mean = (items) =>
      items.length
        ? items.reduce((sum, x) => sum + x.value / items.length, 0)
        : null;
    const regionIds = record?.isoDirectionIds !== undefined
      ? Object.keys(REG).filter(id => rows.some(row => row.region === id))
      : LEGACY_ISO_REGIONS;
    const axes = regionIds.map((id) => {
      const label = REG[id];
      const directions = rows.filter((row) => row.region === id);
      const strengthSources = [],
        symmetrySources = [];
      directions.forEach((row) => {
        const value = row.paired
          ? row.left !== null && row.right !== null
            ? row.left / 2 + row.right / 2
            : null
          : row.center;
        const percent = row.sides?.every(side => side.value !== null && positive(side.target) !== null)
          ? row.sides.reduce((sum,side) => sum + side.value / side.target * 100,0) / row.sides.length
          : value !== null && positive(row.target) !== null && !row.sides ? value / row.target * 100 : null;
        if (percent !== null && Number.isFinite(percent))
          strengthSources.push({
            id: row.id,
            label: row.direction,
            value: percent,
          });
        if (row.asym !== null && Number.isFinite(row.asym))
          symmetrySources.push({
            id: row.id,
            label: row.direction,
            value: 100 - row.asym,
          });
      });
      return {
        id,
        label,
        strength: mean(strengthSources),
        symmetry: mean(symmetrySources),
        strengthSources,
        symmetrySources,
        pain: directions.some((row) => row.sides.some((side) => side.pain)),
      };
    });
    const highest = Math.max(100, ...axes.map((axis) => axis.strength || 0));
    const rounded = Math.ceil(highest / 20) * 20;
    return {
      axes,
      max: Number.isFinite(rounded) ? rounded : highest,
      reference: 100,
    };
  }
  function reactiveJump(row) {
    const height = positive(row.height), contact = positive(row.contactTimeMs), flight = positive(row.flightTimeMs);
    const firstHeight = positive(row.firstHeight), firstTime = positive(row.firstTimeToTakeoffMs);
    const ratio = (a,b,factor=1) => a !== null && b !== null && Number.isFinite(a / b * factor) ? a / b * factor : null;
    return { ...row, rsi: ratio(height,contact,10), flightTimeRatio: ratio(flight,contact), firstRsiModified: ratio(firstHeight,firstTime,10) };
  }
  const average = (values) => { const valid = values.filter((v) => N(v) !== null).map(N); return valid.length ? valid.reduce((a,b) => a+b/valid.length, 0) : null; };
  function hopSetSummary(set) {
    const mode = set.inputMode === "jumps" ? "jumps" : "summary";
    if (mode === "summary") {
      const s = set.summary || {}, row = Object.fromEntries(T.fieldsForTest("hop").map((f) => [f.key, positive(s[f.key])]));
      const count = (key) => Number.isInteger(N(s[key])) && N(s[key]) >= 0 ? N(s[key]) : null;
      return { id: set.id, inputMode: mode, row, counts: { supplied: count("suppliedCount"), valid: count("validCount"), selected: count("selectedCount") },
        selectedIds: [], selectionBasis: s.selectionBasis || "unknown", jumps: [], flightRatioComplete: row.flightTimeRatio !== null, notes: set.notes || s.notes || "",
        rqr: { value: row.flightTimeRatio, selectedIds: [], counts: { supplied: count("suppliedCount"), valid: count("validCount"), selected: count("selectedCount") }, originalSelection: s.selectionBasis === "flight_ratio" && count("suppliedCount") === 10 && count("validCount") === 10 && count("selectedCount") === 5 } };
    }
    const jumps = (set.jumps || []).map((jump, index) => ({ ...reactiveJump(jump), id: jump.id || set.id + "_jump_" + index, index: index + 1 }));
    const valid = jumps.filter((j) => j.rsi !== null);
    const selected = valid.length > 5 ? [...valid].sort((a,b) => b.rsi-a.rsi || a.index-b.index).slice(0,5) : valid;
    const selectedIds = selected.map((j) => j.id), flightRatioComplete = selected.length > 0 && selected.every((j) => j.flightTimeRatio !== null);
    const supplied = jumps.filter((j) => [j.height,j.contactTimeMs,j.flightTimeMs,j.notes].some((v) => v !== "" && v !== null && v !== undefined)).length;
    const timeValid = jumps.filter((j) => positive(j.flightTimeRatio) !== null);
    const timeSelected = timeValid.length > 5 ? [...timeValid].sort((a,b) => b.flightTimeRatio-a.flightTimeRatio || a.index-b.index).slice(0,5) : timeValid;
    const row = Object.fromEntries(T.fieldsForTest("hop").map((f) => [f.key, average(selected.map((j) => positive(j[f.key])))]));
    // Device Active Stiffness describes the complete Hop test, not one hop cycle.
    row.activeStiffness = positive(set.summary?.activeStiffness);
    // A mean ratio requires the ratio from every selected jump, never a ratio of means.
    if (!flightRatioComplete) row.flightTimeRatio = null;
    return { id: set.id, inputMode: mode, row,
      counts: { supplied, valid: valid.length, selected: selected.length },
      selectedIds, selectionBasis: "height_rsi", jumps: jumps.map((j) => ({ ...j, valid: j.rsi !== null, selected: selectedIds.includes(j.id) })), flightRatioComplete, notes: set.notes || "",
      rqr: { value: average(timeSelected.map((j) => j.flightTimeRatio)), selectedIds: timeSelected.map((j) => j.id), counts: { supplied, valid: timeValid.length, selected: timeSelected.length }, originalSelection: supplied === 10 && timeValid.length === 10 && timeSelected.length === 5 } };
  }
  function hopSummary(record) {
    const sets = repeatRows(record, "hop").map(hopSetSummary), fields = T.attemptFields(record, "hop");
    const eligible = sets.filter((s) => positive(s.row.rsi) !== null);
    const best = eligible.reduce((a,b) => !a || b.row.rsi > a.row.rsi ? b : a, null);
    const selected = record.mode === "mean" ? eligible : best ? [best] : [];
    let row = selected.length ? Object.fromEntries(T.fieldsForTest("hop").map((f) => [f.key,
      f.key === "flightTimeRatio" && !selected.every((s) => s.flightRatioComplete) ? null : average(selected.map((s) => s.row[f.key]))])) : null;
    const stiffnessSets = selected.length ? selected : sets.filter(s => positive(s.row.activeStiffness) !== null);
    if (stiffnessSets.length) {
      row ||= {};
      row.activeStiffness = record.mode === "mean" || selected.length ? average(stiffnessSets.map(s => s.row.activeStiffness)) : Math.max(...stiffnessSets.map(s => s.row.activeStiffness));
    }
    return { row, count: eligible.length, sets, selectedSetIds: selected.map((s) => s.id),
      counts: Object.fromEntries(["supplied","valid","selected"].map((key) => [key, selected.length && selected.every((s) => s.counts[key] !== null) ? selected.reduce((sum,s) => sum+s.counts[key],0) : null])),
      fields, metrics: fields.map((f) => ({ ...f, value: row?.[f.key] ?? null, count: selected.filter((s) => N(s.row[f.key]) !== null).length })),
      attempts: sets.map((s,index) => ({ id: s.id, index: index+1, values: fields.map((f) => ({ id: f.id, value: s.row[f.key] ?? null })) })) };
  }
  function jumpSummary(record, id) {
    if (id === "hop") return hopSummary(record);
    const fields = T.attemptFields(record, id),
      rows = record.data[id] || [];
    const reactive = ["dj", "cmrj"].includes(id), primary = reactive ? "rsi" : "height";
    const clean = rows.map((input) => { const row = reactive ? reactiveJump(input) : input; return ({
      ...row,
      ...Object.fromEntries(
        T.fieldsForTest(id).map((f) => [f.key, positive(row[f.key]) ?? ""]),
      ),
    }); });
    const result = aggregate(clean, primary, record.mode);
    const eligible = clean.filter((row) => positive(row[primary]) !== null);
    const selected =
      record.mode === "best" ? (result.row ? [result.row] : []) : eligible;
    result.metrics = fields.map((field) => {
      const independent = ["activeStiffness","rsiModified","firstHeight","firstTimeToTakeoffMs","firstRsiModified"].includes(field.key);
      const fallbackKey = field.key?.startsWith("first") ? "firstRsiModified" : field.key;
      const sourceRows = independent && !selected.length ? (record.mode === "mean" ? clean : clean.filter(row => positive(row[fallbackKey]) !== null).sort((a,b) => b[fallbackKey]-a[fallbackKey]).slice(0,1)) : selected;
      const values = sourceRows
        .map((row) =>
          field.key ? positive(row[field.key]) : N(row.metrics?.[field.id]),
        )
        .filter((v) => v !== null);
      return {
        ...field,
        value: values.length
          ? values.reduce((sum, v) => sum + v / values.length, 0)
          : null,
        count: values.length,
      };
    });
    result.selectedIds = selected.map((row) => row.id);
    result.selectedRows = selected;
    result.attempts = clean.map((row, index) => ({
      id: row.id,
      index: index + 1,
      values: fields.map((f) => ({
        id: f.id,
        value: f.key ? positive(row[f.key]) : N(row.metrics?.[f.id]),
      })),
    }));
    result.fields = fields;
    return result;
  }
  function computeBalances(record, rows) {
    const idMap = new Map(rows.map((r) => [r.id, r]));
    return (record.balancePairs || []).filter(pair => record.isoDirectionIds === undefined
      || idMap.has(pair.numeratorId) && idMap.has(pair.denominatorId)).map((pair) => {
      const numerator = idMap.get(pair.numeratorId),
        denominator = idMap.get(pair.denominatorId);
      let reason = "";
      if (!numerator || !denominator || pair.numeratorId === pair.denominatorId)
        reason = "请选择两个明确的测量方向";
      else if (pair.confirmed !== true) reason = "尚未确认配对测量协议";
      else if (
        numerator.region !== pair.region ||
        denominator.region !== pair.region
      )
        reason = "配对方向不属于同一关节";
      else if (numerator.unit !== denominator.unit) reason = "测量单位不同";
      else if (numerator.paired !== denominator.paired)
        reason = "配对方向的侧别口径不同";
      else if (
        (numerator.protocol || record.protocol.iso || "") !==
        (denominator.protocol || record.protocol.iso || "")
      )
        reason = "测量协议不同";
      const result = {
        ...pair,
        left: null,
        right: null,
        center: null,
        valid: false,
        reason,
        results: [],
        numerator: numerator
          ? {
              id: numerator.id,
              direction: numerator.direction,
              directionCode: numerator.directionCode,
              unit: numerator.unit,
            }
          : null,
        denominator: denominator
          ? {
              id: denominator.id,
              direction: denominator.direction,
              directionCode: denominator.directionCode,
              unit: denominator.unit,
            }
          : null,
        unit: "比值",
      };
      (numerator?.paired ? ["L", "R"] : [""]).forEach((side) => {
        const key = side === "L" ? "left" : side === "R" ? "right" : "center";
        const numeratorValue = numerator ? nonnegative(numerator[key]) : null,
          denominatorValue = denominator ? positive(denominator[key]) : null;
        const value =
          !reason && numeratorValue !== null && denominatorValue !== null
            ? numeratorValue / denominatorValue
            : null;
        const missingReason =
          reason ||
          (numeratorValue === null
            ? "分子缺测"
            : denominatorValue === null
              ? N(denominator?.[key]) === 0
                ? "分母为零"
                : "分母缺测"
              : "");
        const gradeResult = grade(value, pair);
        const reference = root.RingsideIsoReferences?.effectiveReference(record, {region:pair.region,paired:!!numerator?.paired}, side, pair.reference);
        result[key] = value;
        result.results.push({
          side,
          value,
          status: gradeResult.status,
          label: gradeResult.label,
          referenceTarget: reference?.matched ? reference.target : null,
          referenceComparison: root.RingsideIsoReferences?.comparison(value,reference) || null,
          referenceSource: reference?.source || "",
          referenceReason: reference?.reason || "",
          reason: missingReason,
          region: regionKey(pair.region, side),
          numeratorValue,
          denominatorValue,
        });
        if (value !== null) result.valid = true;
      });
      if (!result.valid && !result.reason)
        result.reason = result.results
          .map((r) => r.reason)
          .filter(Boolean)
          .join("；");
      rows
        .filter((r) => r.id === pair.numeratorId || r.id === pair.denominatorId)
        .forEach((r) => r.balance.push(result));
      return result;
    });
  }
  // Storage adapters retain the existing native arrays. Optional nested trials
  // are authoritative once present; legacy single fields are never counted twice.
  function repeatRows(record, testId, isoIndex) {
    if (testId === "iso") {
      const row = record.data?.iso?.[isoIndex];
      return Array.isArray(row?.trials) ? row.trials : row ? [{ ...row, id: row.id + "_single" }] : [];
    }
    const data = record.data?.[testId];
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object")
      return Array.isArray(data.trials) ? data.trials : [{ ...data, id: testId + "_single" }];
    return [];
  }
  function ensureRepeatRows(record, testId, isoIndex) {
    if (testId === "hop" && T.isNative(record,testId)) {
      const data = record.data.hop;
      if (!Array.isArray(data.trials)) data.trials = [normalizeHopSet({ ...data, trials: undefined })];
      return data.trials;
    }
    if (testId === "iso") {
      const row = record.data.iso[isoIndex];
      if (!Array.isArray(row.trials)) row.trials = repeatRows(record, testId, isoIndex).map((r) => ({
        id: r.id, left: r.left, right: r.right, center: r.center,
        painLeft: !!r.painLeft, painRight: !!r.painRight, painCenter: !!r.painCenter, notes: "",
      }));
      return row.trials;
    }
    if (["pushup", "mas", "mss", "ift"].includes(testId)) {
      const data = record.data[testId];
      if (!Array.isArray(data.trials)) data.trials = repeatRows(record, testId).map((r) => ({
        id: r.id, ...(testId === "pushup" ? { reps: r.reps } : { speed: r.speed, ...(testId === "ift" ? { partial: r.partial } : {}) }),
        metrics: { ...r.metrics }, notes: "",
      }));
      return data.trials;
    }
    if (!Array.isArray(record.data[testId])) record.data[testId] = [{ id: uid(), metrics: {}, notes: "" }];
    return record.data[testId];
  }
  function repeatAnalysis(record) {
    const groups = [];
    const field = (id, key, label, unit, options = {}) => ({
      id, key, label, unit, cvEligible: true, minimum: 0, ...options,
    });
    const extra = (testId) => T.repeatPolicy(record, testId).fields.map((d) => field(d.id, "metrics." + d.id, d.name, d.unit,
      { cvEligible: d.cvEligible === true, minimum: null, direction: d.direction }));
    const rawValue = (row, f) => f.read ? f.read(row) : f.key.startsWith("metrics.") ? row.metrics?.[f.id] : row[f.key];
    const validValue = (value, f) => {
      const v = N(value);
      return v === null || (f.minimum !== null && v < f.minimum) || (f.positive && v <= 0) || (f.integer && !Number.isInteger(v)) ? null : v;
    };
    function add(testId, key, label, fields, rows, primaryId, direction = "higher", context = {}) {
      if (!fields.length) return;
      const primary = fields.find((f) => f.id === primaryId) || fields[0];
      const attempts = rows.map((row, index) => ({
        id: row.id || testId + "_" + index, index: row._repeatIndex ?? index + 1,
        notes: row.notes || "",
        pain: context.side ? !!row[{ left: "painLeft", right: "painRight", center: "painCenter" }[context.side]]
          : !!(row.painLeft || row.painRight || row.painCenter),
        values: Object.fromEntries(fields.map((f) => [f.id, rawValue(row, f) ?? ""])),
        observations: Object.fromEntries(fields.map((f) => [f.id, validValue(f.observe ? f.observe(row) : rawValue(row, f), f)])),
      })).filter((row) => row.notes || row.pain || Object.values(row.values).some((v) => v !== "" && v !== null && v !== undefined));
      const eligible = attempts.filter((row) => row.observations[primary.id] !== null);
      const best = eligible.reduce((chosen, row) => !chosen || (direction === "lower" ? row.observations[primary.id] < chosen.observations[primary.id] : row.observations[primary.id] > chosen.observations[primary.id]) ? row : chosen, null);
      const selected = record.mode === "mean" ? eligible : best ? [best] : [];
      const statistics = fields.map((f) => {
        const { read, observe, ...definition } = f;
        return { ...definition, ...Calc.descriptive(eligible.map((row) => row.observations[f.id]), f.cvEligible) };
      });
      groups.push({ testId, key, label, ...context,
        fields: fields.map(({ read, observe, ...f }) => f), attempts,
        primaryMetricId: primary.id, selectedIds: selected.map((row) => row.id),
        representatives: Object.fromEntries(fields.map((f) => [f.id, Calc.descriptive(selected.map((row) => row.observations[f.id]), false).mean])),
        statistics,
      });
    }
    T.describe(record).filter((test) => record.enabled[test.id] && test.repeatPolicy.kind !== "none").forEach((test) => {
      const id = test.id, rows = repeatRows(record, id), extras = extra(id);
      if (test.renderer === "jumps") {
        const fields = T.attemptFields(record, id).map((f) => field(f.id, f.key || "metrics." + f.id, f.label, f.unit,
          f.key ? { positive: true } : { minimum: null, cvEligible: record.definitions.find((d) => d.id === f.id)?.cvEligible === true }));
        const observations = id === "hop" ? rows.map((r) => ({ ...hopSetSummary(r).row, id: r.id, notes: r.notes, metrics: r.metrics })) : ["dj","cmrj"].includes(id) ? rows.map(reactiveJump) : rows;
        add(id, id, test.name, fields, observations, id + (["dj","hop","cmrj"].includes(id) ? "_rsi" : "_height"));
      } else if (test.renderer === "imtp") {
        const normalized = rows.map((row) => syncIMTPLegacy(normalizeIMTP(row)));
        const fields = [field("imtp_peak_force", "peakForce", "峰值力", "N", { positive: true })];
        fields.push(field("imtp_impulse250", "impulse250", "0–250 ms 冲量", "N·s", { positive: true }),
          field("imtp_matched_impulse", "matchedImpulse", "匹配时窗冲量", "N·s", { positive: true }),
          field("imtp_matched_duration", "matchedDurationMs", "匹配时窗", "ms", { positive: true, cvEligible: false }));
        if (positive(record.athlete.mass) !== null && record.imtpConfig.unit === "N") fields.push(field("imtp_relative_force", "relative", "相对峰值力", "N/kg", { positive: true, read: (row) => positive(row.peakForce) === null ? null : N(row.peakForce) / N(record.athlete.mass) }));
        const times = [...new Set(normalized.flatMap((row) => row.timePoints.map((p) => positive(p.timeMs)).filter((t) => t !== null)))].sort((a,b) => a-b);
        times.forEach((time) => ["force", "rfd"].forEach((kind) => fields.push(field("imtp_" + (kind === "force" ? "f" : "rfd") + time, kind + time,
          kind === "force" ? time + " ms 力" : "0–" + time + " ms RFD", kind === "force" ? "N" : "N/s", {
            read: (row) => row.timePoints.find((p) => N(p.timeMs) === time)?.[kind],
          }))));
        add(id, id, test.name, fields.concat(extras), normalized, "imtp_peak_force");
      } else if (test.renderer === "iso") {
        selectedIsoRows(record).forEach((direction) => {
          const index = record.data.iso.findIndex(row => row.id === direction.id), labels = isoSideLabels(direction);
          (direction.paired ? [["left", labels.left], ["right", labels.right]] : [["center", labels.center]]).forEach(([side, label]) =>
            add(id, direction.id + ":" + side, (REG[direction.region] || direction.region) + " · " + direction.direction + " · " + label,
              [field(side, side, "力量", direction.unit)], repeatRows(record, id, index), side, "higher", { directionId: direction.id, side }));
        });
      } else if (test.renderer === "lvp") {
        const indexed = rows.map((row, index) => ({ ...row, _repeatIndex: index + 1 }));
        const grouped = new Map();
        indexed.filter((row) => nonnegative(row.load) !== null && (id !== "landmine" || ["L", "R"].includes(row.side))).forEach((row) => {
          const side = id === "landmine" ? row.side : "", key = side + ":" + N(row.load);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(row);
        });
        [...grouped].sort((a,b) => N(a[1][0].load) - N(b[1][0].load)).forEach(([key, set]) => {
          const row = set[0], side = id === "landmine" ? row.side : "", metric = record.lvp[id === "landmine" ? id + side : id]?.metric || (side ? "PV" : "MV");
          add(id, key, test.name + (side ? " · " + side : "") + " · " + N(row.load) + " kg · " + metric,
            [field("velocity", "velocity", "速度", "m/s", { positive: true })], set, "velocity", "higher", { load: N(row.load), side });
        });
      } else if (test.renderer === "ball") {
        ["D", "ND"].forEach((side) => add(id, side, side === "D" ? "优势侧" : "非优势侧",
          [field(side === "D" ? "mb_dom" : "mb_non", "distance", "距离", "m", { positive: true })],
          rows.map((row, index) => ({ ...row, _repeatIndex: index + 1 })).filter((row) => row.side === side), side === "D" ? "mb_dom" : "mb_non"));
      } else if (id === "pushup") {
        add(id, id, test.name, [field("pushup_reps", "reps", "有效次数", "次", { integer: true }), ...extras], rows, "pushup_reps");
      } else if (test.renderer === "speed") {
        const metricId = id === "ift" ? record.data.ift.protocol === "treadmill" ? "ift_treadmill" : "ift_shuttle" : id + "_speed";
        add(id, id, test.name, [field(metricId, "speed", id === "ift" ? "VIFT" : "速度", "m/s", { positive: true, read: (row) => speedMS(row, record.data[id].unit) }), ...extras], rows, metricId);
      } else {
        add(id, id, test.name, extras, rows, test.repeatPolicy.primaryMetricId, test.repeatPolicy.direction);
      }
    });
    return groups;
  }
  function repeatProjection(record, groups) {
    const data = { ...record.data };
    ["pushup", "mas", "mss", "ift"].forEach((id) => {
      if (!Array.isArray(data[id]?.trials)) return;
      const group = groups.find((g) => g.testId === id);
      const key = id === "pushup" ? "reps" : "speed";
      data[id] = { ...data[id], [key]: group?.representatives[group.primaryMetricId] ?? "" };
      if (id !== "pushup") data[id].unit = "m/s";
      if (id === "ift") {
        const chosen = group?.selectedIds.length === 1 ? data[id].trials.find((row) => row.id === group.selectedIds[0]) : null;
        data[id].partial = chosen?.partial ?? "";
      }
    });
    data.iso = data.iso.map((row) => {
      if (!Array.isArray(row.trials)) return row;
      const next = { ...row };
      ["left", "right", "center"].forEach((side) => {
        const group = groups.find((g) => g.testId === "iso" && g.directionId === row.id && g.side === side);
        next[side] = group?.representatives[side] ?? "";
        const pain = "pain" + side[0].toUpperCase() + side.slice(1);
        next[pain] = row.trials.some((trial) => !!trial[pain]);
      });
      return next;
    });
    return { ...record, data };
  }
  function speedDirection(record, values) {
    const components = [["mss_speed", "MSS"], ["mas_speed", "MAS"]].map(([id, label]) => {
      const definition = record.definitions.find(d => d.id === id);
      const value = positive(values[id]);
      const target = definition?.referenceEnabled === true && definition.direction === "higher" && definition.matched !== false ? positive(definition.target) : null;
      return { id, label, value, unit: "m/s", target, attainment: value !== null && target !== null ? value / target * 100 : null };
    });
    const [mss, mas] = components;
    if (mss.value !== null && mas.value !== null && mss.value < mas.value) return { components, conclusion: "MSS 低于 MAS，请核对单位、协议及测试结果。", hasTarget: false };
    const comparable = components.filter(item => item.attainment !== null);
    if (comparable.length) {
      const below = comparable.filter(item => item.attainment < 100).map(item => item.id === "mss_speed" ? "冲刺速度（MSS）" : "有氧速度（MAS）");
      return { components, hasTarget: true, conclusion: below.length ? (below.length > 1 ? "并行发展" : "优先发展") + below.join("与") + "。" : comparable.map(item => item.label).join(" 与 ") + " 已达到当前目标，保持并巩固。" };
    }
    const ratio = mss.value !== null && mas.value !== null ? mss.value / mas.value : null;
    return { components, hasTarget: false, conclusion: ratio === null ? "" : ratio < 1.7 ? "耐力型结构 · 速度储备相对较小" : ratio > 1.8 ? "速度型结构 · 速度储备相对较大" : "混合型结构 · 速度储备居中" };
  }
  function derivedResults(record, values, raw, repetitions) {
    const cmjRows = raw.cmj?.selectedRows || [];
    const imtpIds = repetitions.find((g) => g.testId === "imtp")?.selectedIds || [];
    const imtpRows = (record.data.imtp || []).filter((r) => imtpIds.includes(r.id));
    const completeMean = (rows, key) => rows.length && rows.every((r) => positive(r[key]) !== null) ? average(rows.map((r) => N(r[key]))) : null;
    const impulse = completeMean(cmjRows, "propulsiveImpulse"), duration = completeMean(cmjRows, "propulsiveDurationMs");
    const matched = completeMean(imtpRows, "matchedImpulse"), fixed = completeMean(imtpRows, "impulse250");
    const basis = record.cmjConfig?.impulseDefinition || "gross";
    const impulseReason = record.impulseConfig?.confirmed !== true ? "需确认推进期、发力起点及冲量口径可比"
      : basis !== (record.imtpConfig?.impulseDefinition || "gross") ? "CMJ 与 IMTP 冲量净/总力口径不同"
      : impulse === null || duration === null ? "所选 CMJ 尝试需完整推进期冲量和时长" : "";
    const component = (label,value,unit) => ({ label, value: N(value), unit });
    const directions = {
      eur: "结合 CMJ 与 SJ 的绝对成绩、动作控制和纵向变化分析；单凭 EUR 高低不能确定训练优先级。",
      gain: "与 EUR 表达同一关系；对照 CMJ、SJ 原始成绩，避免把比值上升直接解释为能力改善。",
      idsi_matched: "与同口径历史测试比较，结合最大力量、CMJ 成绩和力时曲线判断；目前不使用通用训练界值。",
      idsi_fixed250: "用于固定时窗下的纵向监测；与匹配时窗 iDSI 分开解释，不套用 fDSI 界值。",
      rqr: "结合 DJ、Hop 各自的垂直跳跃高度与触地时间，识别不同反应跳任务的表现差异；当前协议须保持一致。",
      asr: "同时查看 MSS 与 MAS，区分速度端和有氧端的变化；结合专项要求制定训练。",
      srr: "结合 MSS、MAS 和专项要求解释；耐力章节中的参考分组须按其适用人群使用。",
    };
    const results = T.derivedDefinitions().filter((d) => record.derivedEnabled?.[d.id] !== false).map((definition) => {
      const result = { ...definition, enabled: true, value: null, available: false, reason: "", components: [], directionHint: directions[definition.id] || "", aggregation: record.mode === "mean" ? "各测试代表值（均值）之比；不配对独立试次" : "各测试最佳完整尝试的代表值之比" };
      if (["eur","gain"].includes(definition.id)) {
        result.value = raw[definition.id];
        result.components = [component("CMJ 垂直跳跃高度",values.cmj_height,"cm"),component("SJ 垂直跳跃高度",values.sj_height,"cm")];
        result.reason = "需有效 CMJ 与 SJ 垂直跳跃高度";
      } else if (definition.id === "fdsi") {
        result.value = raw.dsi;
        result.components = [component("CMJ 推进期峰值力",raw.cmj?.row?.force,record.dsi.cmjUnit || "N"),component("等长峰值力",raw.dsiForce,record.dsi.source === "manual" ? record.dsi.unit || "N" : record.imtpConfig.unit)];
        result.reason = raw.dsiReason;
        result.protocol += " 默认参考区间：<0.60、0.60–0.80、>0.80；属训练方向假设，不是能力等级。";
      } else if (definition.id.startsWith("idsi_")) {
        const isMatched = definition.id === "idsi_matched", denominator = isMatched ? matched : fixed;
        result.reason = impulseReason || (denominator === null ? "所选 IMTP 尝试缺少完整冲量" : "");
        if (!result.reason && isMatched && !imtpRows.every((r) => positive(r.matchedDurationMs) !== null && Math.abs(N(r.matchedDurationMs)-duration) <= 1e-6)) result.reason = "每个所选 IMTP 积分时窗须与 CMJ 代表推进期时长一致";
        result.value = result.reason ? null : impulse / denominator;
        result.components = [component("CMJ 完整推进期冲量",impulse,"N·s"),component("CMJ 推进期时长",duration,"ms"),component(isMatched ? "IMTP 匹配时窗冲量" : "IMTP 0–250 ms 冲量",denominator,"N·s"),component("IMTP 积分时窗",isMatched ? completeMean(imtpRows,"matchedDurationMs") : 250,"ms")];
        result.protocol += " 当前冲量口径：" + (basis === "net" ? "净力" : "总力") + "；冲量须由原始力时数据积分获得。";
      } else if (definition.id === "rqr") {
        const djRows = raw.dj?.selectedRows || [], hop = raw.hop;
        const djRatio = completeMean(djRows,"flightTimeRatio");
        const chosen = (hop?.sets || []).filter((s) => hop.selectedSetIds.includes(s.id));
        const hopRatio = chosen.length && chosen.every((s) => positive(s.rqr?.value) !== null) ? average(chosen.map((s) => s.rqr.value)) : null;
        result.components = [component("DJ FT/CT 代表值",djRatio,"比值"),component("Hop 平均 FT/CT 代表值",hopRatio,"比值")];
        result.value = djRatio !== null && hopRatio !== null ? djRatio / hopRatio : null;
        result.reason = "所选 DJ 与 Hop 须均有完整 FT/CT，不能用垂直跳跃高度/触地时间 RSI 替代";
        const original = record.mode === "mean" && djRows.length === 3 && djRows.every((r) => N(r.dropHeightCm) === 45) && chosen.length === 1 && chosen.every((s) => s.rqr.originalSelection);
        result.selection = { djIds: djRows.map((r) => r.id), hopSets: chosen.map((s) => ({ id:s.id, ...s.rqr })) };
        result.selectionNote = "RQR 单独按 FT/CT 排序选跳；图中 Hop RSI 仍按垂直跳跃高度/触地时间排序。";
        result.protocolMatch = original;
        result.name = original ? definition.name : "DJ/Hop 反应比 · 当前协议";
        result.protocol += original ? " 当前汇总符合以上主要取值条件。" : " 当前数据按所选汇总模式与 Hop 选跳规则计算，不等同原研究协议。";
      } else {
        const mas = positive(values.mas_speed), mss = positive(values.mss_speed);
        const structure = speedDirection(record, values);
        result.components = structure.components;
        result.directionHint = structure.conclusion;
        result.value = mas !== null && mss !== null ? definition.id === "asr" ? mss-mas : mss/mas : null;
        result.reason = "需有效 MSS 与 MAS";
        if (mas !== null && mss !== null && mss < mas) result.directionHint = "MSS 低于 MAS：请先核对单位、协议及测试结果，再讨论训练方向。";
      }
      result.available = Number.isFinite(result.value);
      if (result.available) {
        const percent = (n) => Math.abs(n).toFixed(1) + "%";
        if (["eur", "gain"].includes(result.id)) {
          const eur = result.id === "eur" ? result.value : 1 + result.value / 100;
          result.directionHint = eur < 1.1 ? "发展 SSC 能力" : eur > 1.1 ? "发展纯向心能力" : "SSC 与纯向心并行发展";
        } else if (result.id === "fdsi") result.directionHint = result.value < .6 ? "发展弹道与快速力量" : result.value > .8 ? "发展最大力量" : "并行发展最大力量与快速力量";
        else if (result.id === "rqr") result.directionHint = result.value === 1 ? "DJ 与 Hop 的腾空／触地时间比相同。" : `DJ 腾空／触地时间比较 Hop ${result.value > 1 ? "高" : "低"} ${percent((result.value - 1) * 100)}。`;
      }
      if (!result.available) { result.value = null; result.reason ||= "缺少可计算的数据或结果超出有效数值范围"; }
      else result.reason = "";
      return result;
    });
    return { results, enabledCount: results.length };
  }
  function capabilityCards(record, values, raw, derived) {
    const cards = [], result = id => derived.results.find(item => item.id === id && item.available);
    const metric = (id, label, value, unit, judgment = "", extra = {}) => ({ id, label, value: N(value), unit, judgment, status: "gray", ...extra });
    const rated = (id, label, value, unit) => {
      const definition = record.definitions.find(d => d.id === id), configured = definition?.referenceEnabled === true;
      const grade = configured ? evaluation(value, definition, record) : null;
      // A gray percentile band is still a valid descriptive classification.
      return metric(id, label, value, unit, grade && (grade.range || grade.status !== "gray") ? grade.label : "", { status: grade?.status || "gray" });
    };
    const add = (id, title, metrics, conclusion = "") => {
      const present = metrics.filter(item => item && Number.isFinite(item.value));
      if (present.length) cards.push({ id, title, metrics: present, conclusion });
    };
    const strength = ["fdsi", "eur"].map(id => {
      const value = result(id);
      return value && metric(id, id === "fdsi" ? "DSI" : "EUR", value.value, value.unit, value.directionHint, { components: value.components });
    });
    const variants = derived.results.filter(item => item.id.startsWith("idsi_") && item.available);
    const impulse = variants.find(item => item.id === record.views?.idsiWindow) || variants.find(item => item.id === "idsi_matched") || variants[0];
    if (impulse) strength.splice(1, 0, metric("idsi", "iDSI 冲量比", impulse.value, impulse.unit, impulse.directionHint, { components: impulse.components, selectedVariant: impulse.id, variants }));
    for (const [id, label] of [["cmj_rsi_modified", "CMJ RSI-modified"], ["sj_rsi_modified", "SJ RSI-modified"], ["cmrj_first_rsi_modified", "CMRJ 首跳 RSI-modified"]])
      if (positive(values[id]) !== null) strength.push(rated(id, label, values[id], "m/s"));
    add("strength", "力量发展方向", strength);
    const reactive = [];
    for (const id of ["dj", "hop", "cmrj"]) {
      const name = id === "hop" ? "Hop" : id.toUpperCase();
      if (positive(values[id + "_rsi"]) !== null) reactive.push(rated(id + "_rsi", name + " RSI", values[id + "_rsi"], "m/s"));
      if (positive(values[id + "_active_stiffness"]) !== null) reactive.push(rated(id + "_active_stiffness", name + " Active Stiffness", values[id + "_active_stiffness"], "kN/m"));
    }
    const ratio = result("rqr");
    if (ratio) reactive.push({ ...rated("rqr", ratio.protocolMatch ? "RQR · DJ/Hop 反应比" : "DJ/Hop FT/CT 反应比", ratio.value, "比值"), components: ratio.components, protocolMatch: ratio.protocolMatch });
    add("reactive", "反应力量水平", reactive);
    const speed = [], asr = result("asr"), srr = result("srr"), structure = speedDirection(record, values);
    for (const item of structure.components) if (item.value !== null) speed.push({ ...rated(item.id, item.label, item.value, item.unit), target: item.target, attainment: item.attainment });
    if (asr && asr.value >= 0) speed.push(metric("asr", "ASR", asr.value, "m/s", "", { components: asr.components }));
    if (srr && srr.value >= 1) speed.push(metric("srr", "SRR", srr.value, "比值", srr.value < 1.7 ? "耐力型" : srr.value > 1.8 ? "速度型" : "混合型", { components: srr.components }));
    add("speed", "速度耐力发展方向", speed, structure.conclusion);
    const cardio = [], targets = [], cpet = raw.cpet;
    let conclusion = "";
    if (cpet) {
      const peak = cpet.peak, label = peak.label === "VO2max" ? "VO₂max" : "VO₂peak";
      const id = peak.relative !== null ? "cpet_vo2_relative" : "cpet_vo2_absolute", value = peak.relative ?? peak.absolute;
      if (value !== null) {
        const components = [rated("cpet_peak_hr", "峰值心率", peak.hr, "bpm")].filter(item => item.value !== null);
        if (peak.relative !== null && peak.absolute !== null) {
          const absolute = rated("cpet_vo2_absolute", label + " 绝对摄氧量", peak.absolute, "L/min");
          if (absolute.judgment) components.unshift(absolute);
        }
        cardio.push({ ...rated(id, label, value, peak.relative !== null ? "mL·kg⁻¹·min⁻¹" : "L/min"), components });
      }
      else if (peak.hr !== null) cardio.push(rated("cpet_peak_hr", "峰值心率", peak.hr, "bpm"));
      for (const [index, threshold] of [cpet.thresholds.first, cpet.thresholds.second].entries()) {
        const stem = "cpet_threshold" + (index + 1), components = [
          rated(stem + (threshold.relative !== null ? "_vo2_relative" : "_vo2_absolute"), threshold.label + " 摄氧量", threshold.relative ?? threshold.absolute, threshold.relative !== null ? "mL·kg⁻¹·min⁻¹" : "L/min"),
          rated(stem + "_hr", threshold.label + " 心率", threshold.hr, "bpm"),
          rated(stem + "_speed", threshold.label + " 速度", threshold.speed, "m/s"),
          rated(stem + "_power", threshold.label + " 功率", threshold.power, "W"),
        ].filter(item => item.value !== null);
        if (threshold.relative !== null && threshold.absolute !== null) {
          const absolute = rated(stem + "_vo2_absolute", threshold.label + " 绝对摄氧量", threshold.absolute, "L/min");
          if (absolute.judgment) components.splice(1,0,absolute);
        }
        if (threshold.percentage !== null) cardio.push({ ...rated(stem + "_pct", threshold.label + " 摄氧量占比", threshold.percentage, "%"), components });
        else if (components.length) {
          cardio.push({ ...components[0], components:components.slice(1) });
        }
      }
      const oxygenTarget = record.definitions.find(d => d.id === "cpet_vo2_relative"), thresholdTarget = record.definitions.find(d => d.id === "cpet_threshold2_pct");
      const p = cpet.thresholds.second.percentage;
      const compared = [[oxygenTarget, peak.relative, label, "mL·kg⁻¹·min⁻¹"], [thresholdTarget, p, cpet.thresholds.second.label, "%"]]
        .filter(([definition, measured]) => definition?.referenceEnabled === true && definition.direction === "higher" && definition.matched !== false && positive(definition.target) !== null && measured !== null);
      compared.forEach(([definition, measured, name, unit]) => targets.push({label:name + " 目标",value:N(definition.target),unit}));
      if (compared.length) {
        const below = compared.filter(([definition, measured]) => measured < N(definition.target)).map(item => item[2]);
        conclusion = below.length ? (below.length > 1 ? "同步提高 " : "优先提高 ") + below.join(" 与 ") + "。" : compared.map(item => item[2]).join(" 与 ") + " 均达到当前目标，保持并巩固。";
      }
    }
    // Legacy lactate thresholds remain speed measurements with their original labels.
    for (const id of ["lt1", "lt2"]) if (positive(values[id]) !== null) {
      const definition = record.definitions.find(d => d.id === id);
      cardio.push(rated(id, definition?.name || id.toUpperCase(), values[id], "m/s"));
    }
    add("cardio", "心肺发展方向", cardio, conclusion);
    const cardioCard = cards.find(card => card.id === "cardio");
    if (cardioCard) cardioCard.targets = targets;
    return cards;
  }
  function stats(record) {
    let state = record || defaults();
    if (state.isoDirectionIds !== undefined) state = { ...state, data: { ...state.data, iso: selectedIsoRows(state) } };
    // Calculations must use canonical results AND definitions even before a
    // legacy record is normalized or reloaded; never alter the caller's data.
    if (state.definitions.some((d) => d.unit === "km/h")) {
      const snapshot = {
        ...state,
        customValues: clone(state.customValues),
        data: clone(state.data),
      };
      state.definitions
        .filter((d) => d.unit === "km/h")
        .forEach((d) => {
          mapMetricResults(snapshot, d, (value) =>
            N(value) === null ? value : N(value) / 3.6,
          );
        });
      state = {
        ...snapshot,
        definitions: state.definitions.map(convertDefinition),
      };
    }
    const repetitions = repeatAnalysis(state);
    state = repeatProjection(state, repetitions);
    if (state.imtpTimeStandards?.length) state = { ...state, definitions: withoutReplacedIMTPStandards(state) };
    const use = (id) => !!state.enabled[id],
      values = {},
      raw = {},
      validTests = new Set();
    const fvp = {};
    FVP_IDS.filter(id => T.isNative(state, id)).forEach(id => {
      const result = fvpAnalysis(state, id);
      fvp[id] = { ...result, enabled: use(id) };
      if (!use(id)) return;
      raw[id] = result;
      if (result.valid) {
        validTests.add(id);
        values[id + "_f0"] = result.model.F0;
        values[id + "_v0"] = result.model.V0;
        values[id + "_pmax"] = result.model.Pmax;
        values[id + "_imbalance"] = result.imbalancePct;
      }
    });
    ["cmj", "sj", "dj", "hop", "cmrj"].filter((id) => T.isNative(state,id)).forEach((t) => {
      if (!use(t)) return;
      const a = jumpSummary(state, t);
      raw[t] = a;
      a.metrics.forEach((metric) => {
        if (metric.value !== null) values[metric.id] = metric.value;
      });
      if (
        a.attempts.some((row) =>
          row.values.some((metric) => metric.value !== null),
        )
      )
        validTests.add(t);
    });
    if (use("imtp")) {
      const rows = state.data.imtp.map((r) => {
        const row = syncIMTPLegacy(normalizeIMTP(r));
        ["f100", "f200", "rfd100", "rfd200"].forEach((k) => {
          if (nonnegative(row[k]) === null) row[k] = "";
        });
        return row;
      });
      const a = aggregate(rows, "peakForce", state.mode);
      raw.imtp = a;
      raw.forceTime = forceTime(state);
      if (
        rows.some((row) =>
          [
            row.peakForce,
            row.baselineForce,
            row.peakTimeMs,
            ...row.timePoints.flatMap((p) => [p.force, p.rfd]),
          ].some((v) => N(v) !== null),
        )
      )
        validTests.add("imtp");
      if (a.row) {
        [["impulse250","imtp_impulse250"],["matchedImpulse","imtp_matched_impulse"],["matchedDurationMs","imtp_matched_duration"]].forEach(([key,id]) => {
          const v = repetitions.find((g) => g.testId === "imtp")?.representatives[id];
          a.row[key] = v ?? "";
          if (v !== null && v !== undefined) values[id] = v;
        });
        values.imtp_peak_force = N(a.row.peakForce);
        if (
          positive(state.athlete.mass) !== null &&
          state.imtpConfig.unit === "N"
        )
          values.imtp_relative_force =
            values.imtp_peak_force / N(state.athlete.mass);
        ["f100", "f200", "rfd100", "rfd200"].forEach((k) => {
          if (nonnegative(a.row[k]) !== null) values["imtp_" + k] = N(a.row[k]);
        });
        validTests.add("imtp");
      }
    }
    const imtpTimeResults = (raw.forceTime?.timeRows || []).flatMap(point => ["force", "rfd"].flatMap(kind => {
      if (point[kind] === null) return [];
      const standard = point[kind + "Standard"], id = "imtp_" + (kind === "force" ? "f" : "rfd") + point.timeMs;
      const percentage = standard?.kind === "force_pct_peak";
      const evaluationValue = percentage ? point.forcePercent : point[kind];
      const evaluationValid = N(evaluationValue) !== null && (!percentage || point.forcePercentValid) && standard?.matched !== false;
      return [{ id, testId: "imtp", timeMs: point.timeMs, kind,
        name: "IMTP " + (kind === "force" ? fmt(point.timeMs) + " ms 力" : "0–" + fmt(point.timeMs) + " ms RFD"),
        value: point[kind], unit: kind === "force" ? "N" : "N/s", forcePercent: kind === "force" ? point.forcePercent : null,
        ability: state.definitions.find(d => d.id === id)?.ability || "早期发力",
        evaluationValue, evaluationValid,
        evaluationUnit: standard?.unit || (kind === "force" ? "N" : "N/s"),
        referenceEnabled: !!standard?.referenceEnabled && evaluationValid, target: standard?.target ?? null,
        ranges: clone(standard?.ranges || []), source: standard?.source || "", standard,
        evaluation: point[kind + "Evaluation"] }];
    }));
    const imtpTimeIds = new Set(imtpTimeResults.map(result => result.id));
    if (
      use("pushup") &&
      nonnegative(state.data.pushup.reps) !== null &&
      (Array.isArray(state.data.pushup.trials) || Number.isInteger(N(state.data.pushup.reps)))
    ) {
      values.pushup_reps = N(state.data.pushup.reps);
      validTests.add("pushup");
    }
    if (use("mb"))
      ["D", "ND"].forEach((side) => {
        const a = aggregate(
          state.data.mb.filter((r) => r.side === side),
          "distance",
          state.mode,
        );
        raw[side === "D" ? "mbD" : "mbND"] = a;
        if (a.row) {
          values[side === "D" ? "mb_dom" : "mb_non"] = N(a.row.distance);
          validTests.add("mb");
        }
      });
    const lvpSeries = [
      ["bench", "bench", "卧推", null],
      ["landmineR", "landmine", "地雷杠 R", "R"],
      ["landmineL", "landmine", "地雷杠 L", "L"],
      ["squat", "squat", "深蹲", null],
      ["deadlift", "deadlift", "硬拉", null],
    ].map(([id, testId, label, side]) => {
      const cfg = state.lvp[id] || {},
        points = use(testId)
          ? groupPoints(state.data[testId], side, state.mode)
          : [],
        fit = Calc.linear(points),
        est = fit.estimate(cfg.mvt);
      const zones = (cfg.zones || []).filter(
        (z) =>
          nonnegative(z.min) !== null &&
          positive(z.max) !== null &&
          N(z.min) < N(z.max),
      );
      const zoneLoads = zones.map((z) => {
        const lower = fit.valid ? (N(z.max) - fit.a) / fit.b : null,
          upper = fit.valid ? (N(z.min) - fit.a) / fit.b : null;
        return {
          ...z,
          velocityMin: N(z.min),
          velocityMax: N(z.max),
          loadMin: lower !== null && lower > 0 ? lower : null,
          loadMax: upper !== null && upper > 0 ? upper : null,
          valid: lower !== null && lower > 0 && upper > lower,
          extrapolated:
            lower !== null &&
            upper !== null &&
            (lower < fit.minX || upper > fit.maxX),
        };
      });
      const series = {
        id,
        testId,
        label,
        side,
        points,
        fit,
        est,
        estimate: est,
        metric: cfg.metric || (side ? "PV" : "MV"),
        mvt: N(cfg.mvt),
        zones,
        zoneLoads,
      };
      if (points.length) validTests.add(testId);
      if (side) {
        raw["lm" + side] = points;
        points.forEach((p) => {
          values["landmine_" + side.toLowerCase() + p.load] = p.velocity;
        });
      } else {
        raw[id] = series;
        if (est.valid && positive(state.athlete.mass) !== null)
          values[id + "_1rm"] = est.load / N(state.athlete.mass);
      }
      return series;
    });
    if (use("ift")) {
      const v = speedMS(state.data.ift);
      if (v !== null) {
        values[
          state.data.ift.protocol === "treadmill"
            ? "ift_treadmill"
            : "ift_shuttle"
        ] = v;
        values.ift_speed = v;
        validTests.add("ift");
      }
    }
    ["mas", "mss"].forEach((t) => {
      if (use(t)) {
        const v = speedMS(state.data[t]);
        if (v !== null) {
          values[t + "_speed"] = v;
          validTests.add(t);
        }
      }
    });
    if (use("lactate")) {
      raw.lactate = state.data.lactate
        .map((r) => ({ ...r, speed: speedMS(r), unit: "m/s" }))
        .filter(
          (r) =>
            r.speed !== null &&
            (nonnegative(r.lactate) !== null || positive(r.hr) !== null),
        );
      if (raw.lactate.length) validTests.add("lactate");
      const lt1 = speedMS({
          speed: state.thresholds.lt1,
          unit: state.thresholds.unit,
        }),
        lt2 = speedMS({
          speed: state.thresholds.lt2,
          unit: state.thresholds.unit,
        });
      raw.thresholdsOrdered = !(lt1 !== null && lt2 !== null && lt1 >= lt2);
      if (raw.thresholdsOrdered) {
        if (lt1 !== null) values.lt1 = lt1;
        if (lt2 !== null) values.lt2 = lt2;
        if (lt1 !== null || lt2 !== null) validTests.add("lactate");
      }
    }
    if (use("cpet") && T.isNative(state, "cpet")) {
      raw.cpet = cpetSummary(state);
      const put = (id, value) => { if (value !== null && Number.isFinite(value)) { values[id] = value; validTests.add("cpet"); } };
      put("cpet_vo2_relative", raw.cpet.peak.relative); put("cpet_vo2_absolute", raw.cpet.peak.absolute); put("cpet_peak_hr", raw.cpet.peak.hr);
      [raw.cpet.thresholds.first, raw.cpet.thresholds.second].forEach((threshold, index) => {
        const stem = "cpet_threshold" + (index + 1);
        for (const [suffix, key] of [["vo2_relative", "relative"], ["vo2_absolute", "absolute"], ["pct", "percentage"], ["hr", "hr"], ["speed", "speed"], ["power", "power"]]) put(stem + "_" + suffix, threshold[key]);
      });
    }
    if (use("fms")) {
      raw.fms = Calc.fms(state.data.fms);
      raw.fms.items = state.data.fms.map((r, i) => ({
        ...r,
        value: raw.fms.scores[i],
        status:
          raw.fms.scores[i] === null
            ? "gray"
            : raw.fms.scores[i] === 0
              ? "red"
              : raw.fms.scores[i] < 3
                ? "amber"
                : "green",
      }));
      if (raw.fms.completed) validTests.add("fms");
    }
    const isoAnalyses = use("iso") ? isoAnalysis(state) : [],
      balanceResults = use("iso") ? computeBalances(state, isoAnalyses) : [];
    raw.iso = isoAnalyses.filter((r) =>
      r.sides.some((s) => s.value !== null || s.pain),
    );
    if (raw.iso.length) validTests.add("iso");
    state.definitions
      .filter(
        (d) => T.isManualMetric(d) && !T.isAttemptMetric(d) && use(d.testId),
      )
      .forEach((d) => {
        const v = N(state.customValues[d.id]?.value);
        if (v !== null) {
          values[d.id] = v;
          validTests.add(d.testId);
        }
      });
    state.definitions.filter((d) => T.isAttemptMetric(d) && use(d.testId)).forEach((d) => {
      const group = repetitions.find((g) => g.testId === d.testId && Object.hasOwn(g.representatives, d.id));
      const value = group?.representatives[d.id];
      if (N(value) !== null) { values[d.id] = value; validTests.add(d.testId); }
    });
    raw.eur =
      positive(values.cmj_height) !== null &&
      positive(values.sj_height) !== null
        ? values.cmj_height / values.sj_height
        : null;
    raw.gain = raw.eur !== null ? (raw.eur - 1) * 100 : null;
    const source =
      state.dsi.source === "manual"
        ? positive(state.dsi.force)
        : use("imtp")
          ? positive(raw.imtp?.row?.peakForce)
          : null;
    const unit =
      state.dsi.source === "manual"
        ? state.dsi.unit || "N"
        : state.imtpConfig.unit;
    const forceDefinition =
      state.dsi.source === "manual"
        ? state.dsi.definition
        : state.imtpConfig.definition;
    const comparable =
      state.dsi.confirmed === true &&
      unit === (state.dsi.cmjUnit || "N") &&
      forceDefinition ===
        (state.cmjConfig?.definition ||
          state.dsi.cmjDefinition ||
          state.dsi.definition ||
          "gross");
    raw.dsi =
      comparable && positive(raw.cmj?.row?.force) !== null && source !== null
        ? N(raw.cmj.row.force) / source
        : null;
    raw.dsiForce = source;
    raw.dsiReason =
      raw.dsi !== null
        ? ""
        : !comparable
          ? "需确认相同力单位、力口径与可比测试协议"
          : "需 CMJ 力与有效等长峰值力";
    raw.asr =
      positive(values.mas_speed) !== null && positive(values.mss_speed) !== null
        ? values.mss_speed - values.mas_speed
        : null;
    const derived = derivedResults(state, values, raw, repetitions);
    const qualityIssues =
      raw.asr !== null && raw.asr < 0
        ? [
            {
              id: "asr_inconsistent",
              status: "red",
              message: "MSS低于MAS，请核对单位、测试协议与测量结果",
            },
          ]
        : [];
    (raw.forceTime?.issues || [])
      .filter((x) => !x.id.startsWith("imtp_baseline_missing_"))
      .forEach((x) => qualityIssues.push({ ...x, testId: "imtp" }));
    qualityIssues.push(...(raw.cpet?.issues || []));
    Object.values(fvp).filter(result => result.enabled).forEach(result => qualityIssues.push(...result.issues));
    const groups = new Map(), axisValues = { ...values };
    const timeResultsById = new Map(imtpTimeResults.map(result => [result.id, result]));
    const replacedTimeIds = new Set((state.imtpTimeStandards || []).map(rule => "imtp_" + (rule.kind === "force_pct_peak" ? "f" : "rfd") + rule.timeMs));
    // Existing time metrics keep their configured axis role. Newly discovered
    // times do not create or become an ability's representative metric.
    const axisDefinitions = state.definitions.map(definition => {
      if (!replacedTimeIds.has(definition.id)) return definition;
      const result = timeResultsById.get(definition.id), standard = result?.standard;
      axisValues[definition.id] = result?.evaluationValid ? result.evaluationValue : null;
      return { ...definition, unit: result?.evaluationUnit || definition.unit,
        referenceEnabled: !!result?.referenceEnabled, target: result?.referenceEnabled ? standard.target : null,
        ranges: result?.referenceEnabled ? standard.ranges : [], direction: standard?.direction || definition.direction };
    });
    axisDefinitions
      .filter(
        (d) =>
          d.category === "performance" && d.scoring !== false &&
          use(d.testId) &&
          T.abilityName(d.ability) &&
          attainment(axisValues[d.id], d) !== null,
      )
      .forEach((d) => {
        const label = T.abilityName(d.ability);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(d);
      });
    const axes = [...groups].map(([label, defs]) => {
      const cfg = T.axisConfig(state, label) || {
          method: "primary",
          primary: defs[0].id,
        },
        chosen =
          cfg.method === "primary"
            ? [defs.find((d) => d.id === cfg.primary) || (replacedTimeIds.has(cfg.primary) ? null : defs[0])].filter(Boolean)
            : defs;
      if (!chosen.length) return null;
      const scores = chosen.map((d) => attainment(axisValues[d.id], d)),
        value =
          cfg.method === "min"
            ? Math.min(...scores)
            : scores.reduce((a, b) => a + b, 0) / scores.length;
      const knownStatuses = chosen
        .map((d) => targetStatus(axisValues[d.id], d, state))
        .filter((s) => s !== "gray");
      const status = knownStatuses.length
        ? knownStatuses.reduce((a, s) => (rank[s] > rank[a] ? s : a), "green")
        : "gray";
      return {
        key: label,
        label: T.abilityLabel(state, label),
        value,
        defs: chosen,
        method: cfg.method,
        scores,
        status,
        tooltip: chosen
          .map((d) => T.metricName(d) + " " + fmt(axisValues[d.id]) + " " + d.unit)
          .join("；"),
      };
    }).filter(Boolean);
    if (state.abilityGroupSnapshot) {
      const order = T.abilityGroups(state).map(group => group.key);
      axes.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    }
    const findingsMap = new Map(),
      regions = {};
    function mark(key, status, label, detail) {
      if (!key) return;
      if (!regions[key])
        regions[key] = {
          status,
          label,
          detail: detail || "",
          reasons: detail ? [detail] : [],
        };
      else {
        if (rank[status] > rank[regions[key].status]) {
          regions[key].status = status;
          regions[key].label = label;
        }
        if (detail && !regions[key].reasons.includes(detail))
          regions[key].reasons.push(detail);
        regions[key].detail = regions[key].reasons.join("；");
      }
    }
    function finding(key, category, status, title, detail, extra = {}) {
      if (!["red", "amber"].includes(status)) return;
      let f = findingsMap.get(key);
      if (!f) {
        f = {
          id: key,
          key,
          category,
          status,
          title,
          detail: "",
          reasons: [],
          sources: [],
          ...extra,
        };
        findingsMap.set(key, f);
      }
      if (rank[status] > rank[f.status]) f.status = status;
      if (detail && !f.reasons.includes(detail)) f.reasons.push(detail);
      if (extra.sourceId && !f.sources.includes(extra.sourceId))
        f.sources.push(extra.sourceId);
      f.detail = f.reasons.join("；");
    }
    isoAnalyses.forEach((row) =>
      row.sides.forEach((side) => {
        const title =
          (["neck", "trunk"].includes(row.region) ? "" : side.side === "L" ? "左" : side.side === "R" ? "右" : "") + bodyRegionLabel(row.region);
        const detail =
          row.direction +
          (side.reasons.length ? "：" + side.reasons.join("；") : "：" + side.label);
        mark(side.region, side.status, title, detail);
        finding("screen:" + side.region, "screen", side.status, title, detail, {
          region: side.region,
          side: side.side,
          sourceId: row.id,
        });
      }),
    );
    balanceResults.forEach((b) =>
      b.results
        .filter((x) => x.value !== null)
        .forEach((side) => {
          const title =
              (["neck", "trunk"].includes(b.region) ? "" : side.side === "L" ? "左" : side.side === "R" ? "右" : "") + bodyRegionLabel(b.region),
            detail = b.label + " " + fmt(side.value) + " · " + side.label;
          mark(side.region, side.status, title, detail);
          finding(
            "screen:" + side.region,
            "screen",
            side.status,
            title,
            detail,
            { region: side.region, side: side.side, sourceId: b.id },
          );
        }),
    );
    raw.fms?.items.forEach((row, i) => {
      const status = row.status,
        location = String(row.location || ""),
        title = "FMS · " + row.name;
      if (row.value === 0 && location) mark(location, "red", title, "疼痛");
      const key =
        row.value === 0 && location ? "screen:" + location : "fms:" + i;
      finding(
        key,
        "screen",
        status,
        title,
        row.value === 0
          ? "测试或清除测试出现疼痛"
          : row.value +
              " / 3 · " +
              (row.value === 1 ? "动作未完成" : "代偿完成"),
        { region: location, sourceId: "fms_" + i },
      );
    });
    state.definitions
      .filter((d) => use(d.testId) && N(values[d.id]) !== null && !imtpTimeIds.has(d.id))
      .forEach((d) => {
        const g = evaluation(values[d.id], d, state),
          detail =
            T.metricName(d) + " " + fmt(values[d.id]) + " " + d.unit + " · " + g.label;
        if (d.category === "screen") {
          if (d.region) mark(d.region, g.status, d.name, detail);
          finding(
            d.region ? "screen:" + d.region : "screenmetric:" + d.id,
            "screen",
            g.status,
            d.name,
            detail,
            { region: d.region || "", sourceId: d.id },
          );
        } else
          finding(
            "performance:" + (d.ability || d.id),
            "performance",
            g.status,
            T.abilityLabel(state, d.ability) || T.metricName(d),
            detail,
            { ability: d.ability || "", sourceId: d.id },
          );
      });
    imtpTimeResults.forEach(result => finding("performance:" + result.ability, "performance", result.evaluation.status,
      T.abilityLabel(state, result.ability), result.name + " " + fmt(result.evaluationValue) + " " + result.evaluationUnit + " · " + result.evaluation.label,
      { ability: result.ability, sourceId: result.id }));
    const findings = [...findingsMap.values()].sort(
      (a, b) => rank[b.status] - rank[a.status],
    );
    const advantageMap = new Map();
    state.definitions
      .filter(
        (d) =>
          d.category === "performance" &&
          use(d.testId) &&
          N(values[d.id]) !== null && !imtpTimeIds.has(d.id),
      )
      .forEach((d) => {
        const g = grade(values[d.id], d);
        if (g.range?.advantage !== true) return;
        const key = d.ability || d.id;
        const item = {
          id: d.id,
          label: T.abilityLabel(state, key),
          ability: key,
          value: values[d.id],
          unit: d.unit,
          detail:
            T.metricName(d) + " " + fmt(values[d.id]) + " " + d.unit + " · " + g.label,
          status: "green",
          relative: false,
        };
        const old = advantageMap.get(key);
        if (!old || attainment(values[d.id], d) > old.score)
          advantageMap.set(key, {
            ...item,
            score: attainment(values[d.id], d),
          });
      });
    imtpTimeResults.filter(result => result.evaluation.range?.advantage === true).forEach(result => {
      const key = result.ability, score = attainment(result.evaluationValue, result.standard);
      const old = advantageMap.get(key);
      if (!old || score > old.score) advantageMap.set(key, { id: result.id, label: T.abilityLabel(state, key), ability: key,
        value: result.evaluationValue, unit: result.evaluationUnit, score,
        detail: result.name + " " + fmt(result.evaluationValue) + " " + result.evaluationUnit + " · " + result.evaluation.label,
        status: "green", relative: false });
    });
    let advantages = {
      items: [...advantageMap.values()],
      relative: false,
      reason: "",
    };
    if (!advantages.items.length) {
      if (axes.length < 2)
        advantages.reason = "有效评分维度不足，尚不能区分相对强项";
      else if (axes.every((a) => Math.abs(a.value - axes[0].value) < 1e-9))
        advantages.reason = "各维度评分相同，尚不能区分相对强项";
      else
        advantages = {
          items: [...axes]
            .sort((a, b) => b.value - a.value)
            .slice(0, 2)
            .map((a) => ({
              id: a.key,
              label: a.label,
              ability: a.key,
              score: a.value,
              value: a.value,
              unit: "%",
              detail: "相对强项 · 目标达成度 " + fmt(a.value, 1) + "%",
              status: "gray",
              relative: true,
            })),
          relative: true,
          reason: "依据本次有效能力评分比较",
        };
    }
    // Body details are a read model of the same representative results. They
    // never add findings or change the existing body grading rules.
    const projectNames = new Map(T.describe(state).map(test => [test.id, test.name]));
    const detailSide = key => /_l$/.test(key) ? "L" : /_r$/.test(key) ? "R" : "C";
    const addBodyTest = (key, test) => {
      if (!key || ["__proto__", "constructor", "prototype"].includes(key)) return;
      regions[key] ||= { status: "gray", label: "未测", detail: "", reasons: [] };
      regions[key].tests ||= [];
      regions[key].tests.push({ ...test, hasMeasured: test.hasMeasured === true || N(test.value) !== null || test.pain === true,
        testName: projectNames.get(test.testId) || test.testId });
    };
    for (const row of isoAnalyses) for (const side of row.sides) {
      const value = side.value, sideKey = side.side === "L" ? "left" : side.side === "R" ? "right" : "center";
      const selected = repetitions.find(group => group.testId === "iso" && group.directionId === row.id && group.side === sideKey)?.selectedIds || [];
      const notes = [row.notes, ...(row.trials || []).filter(trial => selected.includes(trial.id)).map(trial => trial.notes)].filter(Boolean);
      addBodyTest(side.region, { id: row.id + "_" + (side.side || "C"), testId: "iso", name: row.direction,
        side: side.side || "C", sideLabel: side.sideLabel, value, unit: row.unit, target: side.target, targetKind:side.targetKind, referenceComparison:side.referenceComparison, referenceSource:side.referenceSource, status: side.status,
        label: side.label, reasons: [...side.reasons], pain: side.pain,
        missing: value === null, asym: row.asym, notes: [...new Set(notes)].join("；") });
    }
    for (const balance of balanceResults) for (const side of balance.results) {
      addBodyTest(side.region, { id: "balance_" + balance.id + "_" + (side.side || "C"), testId: "iso", name: balance.label,
        side: side.side || "C", value: side.value, unit: balance.unit, target: side.referenceTarget, targetKind:side.referenceTarget === null ? "none" : "reference", referenceComparison:side.referenceComparison, referenceSource:side.referenceSource, label: side.label,
        status: side.status, pain: false, missing: side.value === null, notes: side.reason || "" });
    }
    for (const [index, row] of (raw.fms?.items || []).entries()) if (row.location) {
      const notes = [row.bilateral ? "左侧 " + (N(row.left) === null ? "未测" : fmt(row.left)) + " / 右侧 " + (N(row.right) === null ? "未测" : fmt(row.right)) : "", row.notes].filter(Boolean);
      const hasMeasured = row.value !== null || row.pain === true || row.bilateral &&
        [row.left === undefined ? row.l : row.left, row.right === undefined ? row.r : row.right].some(value => {
          const score = N(value); return score !== null && Number.isInteger(score) && score >= 0 && score <= 3;
        });
      addBodyTest(row.location, { id: row.id || "fms_" + index, testId: "fms", name: row.name,
        side: detailSide(row.location), value: row.value, unit: "分", target: null,
        label: row.value === null ? "未测" : row.value === 0 ? "疼痛" : row.value === 1 ? "动作未完成" : row.value === 2 ? "代偿完成" : "完成",
        status: row.status, pain: row.pain === true || row.value === 0, missing: row.value === null, hasMeasured, notes: notes.join("；") });
    }
    for (const d of state.definitions.filter(d => use(d.testId) && d.category === "screen" && d.region)) {
      const value = N(values[d.id]), result = evaluation(value, d, state);
      const group = repetitions.find(group => group.testId === d.testId && Object.hasOwn(group.representatives, d.id));
      const sourceRows = Array.isArray(state.data[d.testId]) ? state.data[d.testId] : state.data[d.testId]?.trials || [];
      const notes = T.isAttemptMetric(d) ? sourceRows.filter(row => group?.selectedIds.includes(row.id)).map(row => row.notes).filter(Boolean).join("；") : state.customValues[d.id]?.notes || "";
      addBodyTest(d.region, { id: d.id, testId: d.testId, name: T.metricName(d), side: detailSide(d.region), value,
        unit: d.unit, target: d.referenceEnabled ? positive(d.target) : null, label: value === null ? "未测" : result.label,
        status: result.status, pain: false, missing: value === null, notes });
    }
    Object.values(regions).forEach(region => { region.tests ||= []; region.hasMeasured = region.tests.some(test => test.hasMeasured); });
    const allTests = T.describe(state).map((t) => [t.id, t.name, t.category]),
      plannedTests = allTests.filter((t) => use(t[0]));
    const partial = [];
    Object.values(fvp).filter(result => result.enabled && result.status === "review").forEach(result =>
      partial.push({ id: result.id, label: projectNames.get(result.id) || result.label, reason: result.reason || "存在待核对的试次" }));
    if (use("fms") && raw.fms?.completed && !raw.fms.complete)
      partial.push({
        id: "fms",
        label: "FMS",
        reason: "已录入 " + raw.fms.completed + "/7 项",
      });
    ["bench", "squat", "deadlift", "landmineR", "landmineL"].forEach((id) => {
      const series = lvpSeries.find((x) => x.id === id);
      if (series.points.length && !series.fit.valid)
        partial.push({
          id: series.testId,
          label: series.label,
          reason: series.fit.reason,
        });
    });
    const details = Object.fromEntries(
      plannedTests.map(([id]) => [
        id,
        recordProgressDetail(state, id, {
          values,
          fvp,
          raw,
          validTests,
          qualityIssues,
          lvpSeries,
        }),
      ]),
    );
    const progress = {
      planned: plannedTests.length,
      recorded: plannedTests.filter((t) => validTests.has(t[0])).length,
      missing: plannedTests
        .filter((t) => !validTests.has(t[0]))
        .map(([id, label]) => ({ id, label })),
      partial,
      details,
      date: state.athlete.date,
    };
    const cards = capabilityCards(state, values, raw, derived);
    return {
      values,
      fvp,
      derived,
      capabilityCards: cards,
      cardio: cards.find(card => card.id === "cardio") || null,
      imtpTimeResults,
      repetitions,
      representativeData: state.data,
      raw,
      axes,
      validTests,
      signals: {
        regions,
        signals: findings.filter((f) => f.category === "screen"),
      },
      findings,
      advantages,
      progress,
      isoAnalyses,
      balanceResults,
      lvpSeries,
      qualityIssues,
    };
  }

  function recordProgressDetail(record, testId, computed) {
    const s = computed || stats(record),
      rows = (s.representativeData || record.data)[testId],
      valid = s.validTests.has(testId);
    let detail = "",
      review = false;
    const count = (items, key, allowZero = false) =>
      items.filter(
        (row) =>
          (allowZero ? nonnegative(row[key]) : positive(row[key])) !== null,
      ).length;
    if (FVP_IDS.includes(testId) && T.isNative(record, testId)) {
      const result = s.fvp?.[testId] || fvpAnalysis(record, testId);
      detail = result.points.length + " 个不同负荷；" + result.trials.filter(trial => trial.eligible).length + " 个有效试次";
      review = result.status === "review";
      if (review && result.reason) detail += "；" + result.reason;
    } else if (testId === "fms") {
      const missingSide = rows.filter(
        (row) =>
          row.bilateral &&
          row.pain !== true &&
          (N(row.left) !== null) !== (N(row.right) !== null),
      ).length;
      detail =
        "动作 " +
        (s.raw.fms?.completed || 0) +
        "/7" +
        (missingSide ? "；" + missingSide + " 个动作仅录入一侧" : "");
      review = missingSide > 0;
    } else if (testId === "iso") {
      const measured = rows.filter((row) =>
        (row.paired ? [row.left, row.right] : [row.center]).some(
          (v) => nonnegative(v) !== null,
        ),
      ).length;
      const left = rows.filter(
          (row) => row.paired && nonnegative(row.left) !== null,
        ).length,
        right = rows.filter(
          (row) => row.paired && nonnegative(row.right) !== null,
        ).length;
      const center = rows.filter(
        (row) => !row.paired && nonnegative(row.center) !== null,
      ).length;
      detail =
        "方向 " +
        measured +
        "/" +
        rows.length +
        "；左 " +
        left +
        " · 右 " +
        right +
        " · 中线 " +
        center;
    } else if (testId === "mb" || testId === "landmine") {
      const keys =
        testId === "mb"
          ? [
              ["D", "优势侧"],
              ["ND", "非优势侧"],
            ]
          : [
              ["L", "左侧"],
              ["R", "右侧"],
            ];
      detail = keys
        .map(([side, label]) => {
          const items = rows.filter((row) => row.side === side),
            n =
              testId === "mb"
                ? count(items, "distance")
                : items.filter(
                    (row) =>
                      nonnegative(row.load) !== null &&
                      positive(row.velocity) !== null,
                  ).length;
          return label + (n ? " " + n + " 次" : "未录入");
        })
        .join("；");
    } else if (testId === "hop" && T.isNative(record,testId)) {
      const hop = s.raw.hop, counts = hop?.counts;
      detail = "有效测试组 " + (hop?.count || 0) + "/" + (hop?.sets.length || 0) + (counts?.selected !== null && counts?.selected !== undefined ? "；代表结果采用 " + counts.selected + " 跳" : "");
    } else if (["dj", "cmrj"].includes(testId) && T.isNative(record,testId)) {
      detail = "有效 RSI " + rows.filter((r) => reactiveJump(r).rsi !== null).length + "/" + rows.length;
    } else if (["cmj", "sj"].includes(testId)) {
      const attempts = s.raw[testId]?.attempts || [];
      const partial = attempts.filter(
        (a) =>
          a.values.some((v) => v.value !== null) &&
          !positive(rows[a.index - 1].height),
      ).length;
      detail =
        "有效垂直跳跃高度 " +
        count(rows, "height") +
        "/" +
        rows.length +
        (partial ? "；另有 " + partial + " 次仅其他指标" : "");
    } else if (testId === "imtp")
      detail =
        "有效尝试 " +
        count(rows, testId === "imtp" ? "peakForce" : "height") +
        "/" +
        rows.length;
    else if (["bench", "squat", "deadlift"].includes(testId)) {
      const n = rows.filter(
        (row) =>
          nonnegative(row.load) !== null && positive(row.velocity) !== null,
      ).length;
      detail =
        "有效尝试 " +
        n +
        "/" +
        rows.length +
        "；" +
        (s.lvpSeries.find((series) => series.id === testId)?.points.length ||
          0) +
        " 个负荷点";
    } else if (testId === "lactate") {
      const n = rows.filter(
        (row) => speedMS(row) !== null && nonnegative(row.lactate) !== null,
      ).length;
      detail = "有效阶段 " + n + "/" + rows.length;
      review = s.raw.thresholdsOrdered === false;
    } else if (testId === "pushup")
      detail = valid
        ? fmt(s.values.pushup_reps, Number.isInteger(s.values.pushup_reps) ? 0 : 2) + " 次"
        : "有效次数未录入";
    else if (["mas", "mss", "ift"].includes(testId))
      detail = valid
        ? fmt(speedMS(rows)) + " m/s"
        : "速度未录入";
    else {
      const definitions = record.definitions.filter((d) => d.testId === testId),
        n = definitions.filter(
          (d) => N(s.values[d.id]) !== null,
        ).length;
      detail = "指标 " + n + "/" + definitions.length;
    }
    const issues = numericFieldIssues(record).filter(
      (issue) =>
        issue.path.startsWith("data." + testId + ".") ||
        (testId === "lactate" && issue.path.startsWith("thresholds.")) ||
        (issue.path.startsWith("customValues.") &&
          record.definitions.some(
            (d) =>
              d.testId === testId &&
              issue.path === "customValues." + d.id + ".value",
          )),
    );
    const quality = s.qualityIssues.filter(
      (issue) =>
        issue.testId === testId ||
        (issue.id === "asr_inconsistent" && ["mas", "mss"].includes(testId)),
    );
    review ||= issues.length > 0 || quality.length > 0;
    if (issues.length) detail += "；" + issues[0].message;
    if (quality.length) detail += "；" + quality[0].message;
    return {
      status: review ? "review" : valid ? "valid" : "empty",
      label: review ? "待核对" : valid ? "已有有效结果" : "未录入",
      detail,
    };
  }

  function fingerprint(record) {
    // Empty additive defaults must not invalidate existing 2.10 narratives.
    // Real measurements, changed protocols/standards and explicit switches remain inputs.
    const data = clone(record.data), enabled = { ...record.enabled }, protocol = { ...record.protocol };
    for (const row of data.iso || []) if (row.reference === null) delete row.reference;
    // Factory display-name cleanup alone keeps the original serialized narrative basis.
    for (const row of data.iso || []) if (["neck","trunk"].includes(row.region) && ["lateralFlexion","rotation"].includes(row.directionCode)) {
      const label = row.directionCode === "lateralFlexion" ? "侧屈" : "旋转";
      if (row.direction === label) row.direction = label + (row.region === "neck" ? "（左 / 右）" : "（左向 / 右向）");
    }
    const fingerprintPairs = clone(record.balancePairs || []);
    for (const pair of fingerprintPairs) {
      if (pair.reference === null) delete pair.reference;
      delete pair.ratioConvention;
      if (!["shoulder_IR_ER","hip_IR_ER"].includes(pair.id) || pair.referenceEnabled || pair.ranges?.length || pair.reference || pair.ratioMigrationIssue) continue;
      const numerator = data.iso.find(row => row.id === pair.numeratorId), denominator = data.iso.find(row => row.id === pair.denominatorId);
      const has = (row,key,den) => [row?.[key],...(row?.trials || []).map(trial=>trial[key])].some(value => den ? positive(value) !== null : nonnegative(value) !== null);
      const measured = (numerator?.paired ? ["left","right"] : ["center"]).some(key => has(numerator,key,false) && has(denominator,key,true));
      if (!measured && numerator?.directionCode === "externalRotation" && denominator?.directionCode === "internalRotation") {
        [pair.numeratorId,pair.denominatorId] = [pair.denominatorId,pair.numeratorId];
        if (pair.label === "ER:IR") pair.label = "IR:ER";
      }
    }
    const cmjConfig = { ...record.cmjConfig }, imtpConfig = { ...record.imtpConfig };
    // Only measurements whose single-target grade changed invalidate a previously generated interpretation.
    const isoBasisRecord = { ...record, enabled: { iso: record.enabled.iso } };
    const isoBasisState = record.enabled.iso ? repeatProjection(isoBasisRecord, repeatAnalysis(isoBasisRecord)) : record;
    const changedIsoEvaluation = record.enabled.iso && selectedIsoRows(isoBasisState).some(row =>
      (row.paired ? [["L",row.left],["R",row.right]] : [["",row.center]]).some(([side,input]) => {
        const value = nonnegative(input), resolved = effectiveIsoTarget(isoBasisState,row,side);
        return value !== null && resolved.target !== null && (resolved.kind === "reference"
          || resolved.kind === "manual" && value < resolved.target && value/resolved.target*100 < N(record.rules.absoluteAmber));
      }));
    if (cmjConfig.impulseDefinition === "gross") delete cmjConfig.impulseDefinition;
    if (imtpConfig.impulseDefinition === "gross") delete imtpConfig.impulseDefinition;
    const empty = (value) => value === "" || value === null || value === undefined;
    ["dj","cmrj"].forEach(id => { if (T.isNative(record,id)) (data[id] || []).forEach(row => { if (empty(row.activeStiffness)) delete row.activeStiffness; }); });
    if (T.isNative(record,"hop")) (data.hop?.trials || [data.hop]).filter(Boolean).forEach(set => { if (set.summary && empty(set.summary.activeStiffness)) delete set.summary.activeStiffness; });
    ["cmj","imtp"].forEach((id) => (data[id] || []).forEach((row) =>
      (id === "cmj" ? ["propulsiveImpulse","propulsiveDurationMs"] : ["impulse250","matchedImpulse","matchedDurationMs"]).forEach((key) => { if (empty(row[key])) delete row[key]; })));
    const meaningful = (value, key = "") => {
      if (["id","inputMode","selectionBasis","measurementVersion"].includes(key)) return false;
      if (Array.isArray(value)) return value.some((v) => meaningful(v));
      if (value && typeof value === "object") return Object.entries(value).some(([k,v]) => meaningful(v,k));
      return !empty(value) && value !== false;
    };
    const defaultProtocol = defaults().protocol;
    const fvpConfig = clone(record.fvpConfig || {}), fvpAnalysis = clone(record.fvpAnalysis || {});
    const defaultFvpConfig = fvpConfigDefaults(), defaultFvpAnalysis = fvpAnalysisDefaults();
    const sameFvpDefaults = (value, base) => Object.keys({ ...base, ...value }).every(key => JSON.stringify(value?.[key] ?? base[key]) === JSON.stringify(base[key]));
    const cpetMeasured = data.cpet && [data.cpet.vo2,data.cpet.peakHr,data.cpet.rer,...["first","second"].flatMap(side => ["vo2","hr","speed","power"].map(key => data.cpet.thresholds?.[side]?.[key]))].some(value => !empty(value));
    const invisible = new Set(["dj","hop","cmrj","cpet"].filter((id) => T.isNative(record,id) && !enabled[id] && !(id === "cpet" ? cpetMeasured || data.cpet?.protocol || data.cpet?.modality : meaningful(data[id])) && (!protocol[id] || protocol[id] === defaultProtocol[id])));
    FVP_IDS.forEach(id => {
      if (T.isNative(record,id) && !enabled[id] && !meaningful(data[id]) && (!protocol[id] || protocol[id] === defaultProtocol[id]) && sameFvpDefaults(fvpConfig[id], defaultFvpConfig) && sameFvpDefaults(fvpAnalysis[id], defaultFvpAnalysis)) invisible.add(id);
      if (invisible.has(id)) { delete fvpConfig[id]; delete fvpAnalysis[id]; }
    });
    invisible.forEach((id) => { delete data[id]; delete enabled[id]; delete protocol[id]; });
    Object.keys(protocol).forEach(id => { if (T.isNative(record,id)) protocol[id] = Def.factoryText(id,"testProtocol",protocol[id],true); });
    const projection = definition => {
      const { referenceMatch, referenceGroups, ...result } = definition;
      if (!result.legacyManual) ["name","protocol"].forEach(key => { if (Object.hasOwn(result,key)) result[key] = Def.factoryText(result.id,key,result[key],true); });
      return result;
    };
    const extras = new Map(extraDefs().filter((d) => ["dj","hop","cmrj","cpet", ...FVP_IDS].includes(d.testId) || /propulsive_|matched_|impulse250/.test(d.id)).map((d) => [d.id,projection(d)]));
    const same = (a,b) => [...new Set([...Object.keys(a),...Object.keys(b)])].every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
    const definitions = withoutReplacedIMTPStandards(record).map(projection).filter((d) => !extras.has(d.id) || !same(d,extras.get(d.id)));
    const derivedEnabled = Object.fromEntries(Object.entries(record.derivedEnabled || {}).filter(([,enabled]) => enabled === false));
    const athlete = { ...record.athlete }, trainingContext = { ...record.trainingContext };
    delete athlete.birthDate;
    if (empty(athlete.injuryHistory)) delete athlete.injuryHistory;
    for (const key of ["previousCompetitionDate", "nextCompetitionDate"]) if (empty(trainingContext[key])) delete trainingContext[key];
    return JSON.stringify({
      athlete,
      trainingContext,
      enabled,
      ...(record.isoDirectionIds !== undefined ? { isoDirectionIds: record.isoDirectionIds } : {}),
      mode: record.mode,
      data,
      ...(changedIsoEvaluation ? { isoEvaluationBasis: "single-target-amber-green-v1" } : {}),
      definitions,
      custom: record.customValues,
      projects: record.projectSnapshots?.filter((t) => !invisible.has(t.id)),
      rules: record.rules,
      lvp: record.lvp,
      thresholds: record.thresholds,
      dsi: record.dsi,
      cmjConfig,
      imtpConfig,
      ...(Object.keys(fvpConfig).length ? { fvpConfig } : {}),
      ...(Object.keys(fvpAnalysis).length ? { fvpAnalysis } : {}),
      ...(record.impulseConfig?.confirmed ? { impulseConfig: record.impulseConfig } : {}),
      ...(Object.keys(derivedEnabled).length ? { derivedEnabled } : {}),
      ...(record.imtpTimeStandards?.length ? { imtpTimeStandards: record.imtpTimeStandards.map(({ matched, ...rule }) => rule).sort((a,b) => a.timeMs-b.timeMs || a.kind.localeCompare(b.kind)) } : {}),
      balancePairs: fingerprintPairs,
      axes: record.axes,
      protocol,
    });
  }
  function fingerprintWithoutAge(record) {
    const value = JSON.parse(fingerprint(record));
    delete value.athlete.age;
    return canonicalJSON(value);
  }
  function fingerprintMatchesExceptAge(basis, record, evaluationProfile) {
    try {
      const value = JSON.parse(basis);
      if (!plainObject(value) || !plainObject(value.athlete)) return false;
      let comparison = record;
      if (evaluationProfile && root.RingsideEvaluation) {
        comparison = clone(record);
        comparison.athlete.age = value.athlete.age;
        comparison = root.RingsideEvaluation.resolve(comparison, evaluationProfile);
      }
      delete value.athlete.age;
      delete value.athlete.birthDate;
      if (["", null, undefined].includes(value.athlete.injuryHistory)) delete value.athlete.injuryHistory;
      for (const key of ["previousCompetitionDate", "nextCompetitionDate"]) if (["", null, undefined].includes(value.trainingContext?.[key])) delete value.trainingContext?.[key];
      return canonicalJSON(value) === fingerprintWithoutAge(comparison);
    } catch (_) { return false; }
  }
  function recordEnvelope(record, profile, catalog) {
    return {
      schema: 2,
      kind: "assessment-record",
      record: clone(record),
      ...(profile ? { profile: clone(profile) } : {}),
      ...(catalog ? { catalog: clone(catalog) } : {}),
    };
  }
  const PROFILE_KEYS = ["name", "sex", "sport", "dominantHand", "sportLevel", "birthDate", "injuryHistory", "experienceYears"];
  function profileFromRecord(record) {
    const a = record?.athlete || record || {};
    return Object.fromEntries(
      PROFILE_KEYS.map((key) => [
        key,
        String(
          (key === "experienceYears" ? record?.trainingContext?.experienceYears ?? a[key] : a[key]) ?? (["sex", "dominantHand"].includes(key) ? "未注明" : ""),
        ),
      ]),
    );
  }
  function latestRecord(athlete) {
    const records = athlete?.records || [];
    const validDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
      const stamp = new Date(value + "T00:00:00Z");
      return Number.isFinite(stamp.getTime()) &&
        stamp.toISOString().slice(0, 10) === value
        ? value
        : "";
    };
    return records.reduce((best, record) => {
      const key = validDate(record.athlete?.date),
        bestKey = validDate(best?.athlete?.date);
      return !best || key >= bestKey ? record : best;
    }, null);
  }
  function catalogDefaults() {
    const record = defaults();
    return {
      revision: 1,
      capabilityVersion: 1,
      fvpVersion: 1,
      tests: T.snapshots(record),
      definitions: record.definitions,
      abilityGroups: T.abilityGroups(record),
      abilityGroupConflicts: [],
      protocol: record.protocol,
      conflicts: [],
      derivedEnabled: T.derivedDefaults(),
    };
  }
  function normalizeCatalog(input) {
    const base = catalogDefaults(),
      catalog = input ? clone(input) : base;
    const originalCatalog = clone(catalog);
    catalog.revision =
      Number.isSafeInteger(catalog.revision) && catalog.revision >= 1
        ? catalog.revision
        : 1;
    catalog.tests = Array.isArray(catalog.tests) ? catalog.tests : base.tests;
    catalog.tests.forEach((test) => { if (["dj","hop","cmrj","cpet", ...FVP_IDS].includes(test.id) && test.measurementVersion !== 1) test.legacyCustom = true; });
    catalog.derivedEnabled = { ...T.derivedDefaults(), ...catalog.derivedEnabled };
    base.tests.forEach((test) => {
      if (!catalog.tests.some((t) => t.id === test.id))
        catalog.tests.push(test);
    });
    catalog.definitions = preserveAddedMetricCollisions((
      Array.isArray(catalog.definitions)
        ? catalog.definitions
        : base.definitions
    ), originalCatalog).map(convertDefinition);
    catalog.capabilityVersion = 1;
    catalog.fvpVersion = 1;
    base.definitions.forEach((definition) => {
      if (T.isNative(catalog,definition.testId) && !catalog.definitions.some((d) => d.id === definition.id))
        catalog.definitions.push(definition);
    });
    const disabledTests = new Set(catalog.tests.filter(t => t.disabled).map(t => t.id));
    catalog.tests = T.snapshots(catalog);
    validateAbilityGroups(catalog.abilityGroups);
    validateAbilityGroupConflicts(catalog.abilityGroupConflicts);
    catalog.abilityGroups = T.abilityGroups(catalog);
    catalog.abilityGroupConflicts = clone(catalog.abilityGroupConflicts || []);
    catalog.tests.forEach(t => { if (disabledTests.has(t.id)) t.disabled = true; });
    catalog.protocol = { ...base.protocol, ...catalog.protocol };
    Object.keys(catalog.protocol).forEach((id) => {
      catalog.protocol[id] = migrateLegacySpeedText(
        catalog.protocol[id],
        {},
      ).text;
      if (T.isNative(catalog,id)) catalog.protocol[id] = Def.factoryText(id,"testProtocol",catalog.protocol[id]);
    });
    catalog.conflicts = Array.isArray(catalog.conflicts)
      ? catalog.conflicts
      : [];
    catalog.conflicts.forEach((conflict) => {
      conflict.variants = (conflict.variants || []).map((variant) => ({
        ...variant,
        definitions: (variant.definitions || []).map(convertDefinition),
        protocol: variant.test.legacyCustom ? migrateLegacySpeedText(variant.protocol || "", {}).text : Def.factoryText(variant.test.id,"testProtocol",migrateLegacySpeedText(variant.protocol || "", {}).text),
      }));
    });
    return catalog;
  }
  function canonicalJSON(value) {
    if (Array.isArray(value))
      return "[" + value.map(canonicalJSON).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonicalJSON(value[key]))
          .join(",") +
        "}"
      );
    return JSON.stringify(value);
  }
  function catalogVariant(catalog, testId, source) {
    return {
      test: clone(catalog.tests.find((t) => t.id === testId)),
      definitions: clone(
        catalog.definitions.filter((d) => d.testId === testId),
      ).sort((a, b) => a.id.localeCompare(b.id)),
      protocol: catalog.protocol[testId] || "",
      source,
    };
  }
  function sameVariant(a, b) {
    return (
      canonicalJSON({
        test: a.test,
        definitions: a.definitions,
        protocol: a.protocol,
      }) ===
      canonicalJSON({
        test: b.test,
        definitions: b.definitions,
        protocol: b.protocol,
      })
    );
  }
  function mergeCatalog(input, record, source = record.recordId) {
    const catalog = normalizeCatalog(input),
      normalized = normalizeRecord(record);
    const addConflict = (test, candidate) => {
      let conflict = catalog.conflicts.find(
        (c) => c.testId === test.id && c.resolved !== true,
      );
      if (!conflict) {
        conflict = {
          id: test.id,
          testId: test.id,
          name: test.name,
          resolved: false,
          variants: [catalogVariant(catalog, test.id, "现有目录")],
        };
        catalog.conflicts.push(conflict);
      }
      if (!conflict.variants.some((v) => sameVariant(v, candidate)))
        conflict.variants.push(candidate);
    };
    normalized.customTests.forEach((test) => {
      const candidate = {
        test: clone(
          normalized.projectSnapshots.find((t) => t.id === test.id) || test,
        ),
        definitions: clone(
          normalized.definitions.filter((d) => d.testId === test.id),
        ).sort((a, b) => a.id.localeCompare(b.id)),
        protocol: normalized.protocol[test.id] || "",
        source,
      };
      if (!catalog.tests.some((t) => t.id === test.id)) {
        catalog.tests.push(clone(candidate.test));
        catalog.definitions.push(...clone(candidate.definitions));
        catalog.protocol[test.id] = candidate.protocol;
      } else if (!sameVariant(catalogVariant(catalog, test.id, ""), candidate))
        addConflict(test, candidate);
    });
    normalized.definitions
      .filter(
        (d) => T.isManualMetric(d) && TESTS.some((t) => t[0] === d.testId),
      )
      .forEach((definition) => {
        const existing = catalog.definitions.find(
          (d) => d.id === definition.id,
        );
        if (!existing) catalog.definitions.push(clone(definition));
        else if (canonicalJSON(existing) !== canonicalJSON(definition)) {
          const candidate = catalogVariant(catalog, definition.testId, source);
          candidate.definitions = candidate.definitions.map((d) =>
            d.id === definition.id ? clone(definition) : d,
          );
          addConflict(candidate.test, candidate);
        }
      });
    for (const group of T.abilityGroups(normalized)) {
      const existing = catalog.abilityGroups.find(value => value.key === group.key);
      if (!existing) catalog.abilityGroups.push(clone(group));
      else if (existing.name !== group.name && !catalog.abilityGroupConflicts.some(conflict => conflict.key === group.key && conflict.incomingName === group.name))
        catalog.abilityGroupConflicts.push({ key: group.key, localName: existing.name, incomingName: group.name });
    }
    catalog.abilityGroups = T.abilityGroups(catalog);
    return catalog;
  }
  function recordFromCatalog(input, profile, enabled = {}, testDate = date()) {
    const catalog = normalizeCatalog(input),
      record = defaults();
    record.derivedEnabled = clone(catalog.derivedEnabled);
    const blocked = new Set(
      catalog.conflicts.filter((c) => c.resolved !== true).map((c) => c.testId),
    );
    const selected = new Set(
      catalog.tests
        .filter((t) => !!enabled[t.id] && !blocked.has(t.id))
        .map((t) => t.id),
    );
    record.athlete = {
      ...record.athlete,
      ...profileFromRecord(profile),
      date: testDate,
    };
    delete record.athlete.experienceYears;
    record.trainingContext.experienceYears = profileFromRecord(profile).experienceYears;
    applyAge(record);
    record.projectSnapshots = T.snapshots(catalog);
    record.abilityGroupSnapshot = clone(T.abilityGroups(catalog));
    // This legacy value selects an existing metric ID, not a test method.
    // Normalize still uses the historical shuttle fallback for old records.
    record.data.ift.protocol = "treadmill";
    record.data.ift.method = "";
    record.customTests = clone(
      catalog.tests.filter(
        (t) => !T.isNative(catalog,t.id) && selected.has(t.id),
      ),
    );
    record.enabled = Object.fromEntries(
      catalog.tests.map((t) => [t.id, !!enabled[t.id] && !blocked.has(t.id)]),
    );
    record.definitions = record.definitions
      .filter((d) => !selected.has(d.testId))
      .concat(clone(catalog.definitions.filter((d) => selected.has(d.testId))));
    selected.forEach((id) => {
      record.protocol[id] = catalog.protocol[id] || "";
    });
    record.catalogAppliedTests = [...selected];
    return normalizeRecord(record);
  }
  function libraryDefaults() {
    return {
      schema: 2,
      kind: "athlete-library",
      athletes: [],
      catalog: catalogDefaults(),
      activeAthleteId: "",
      activeRecordId: "",
      updated: now(),
    };
  }
  function normalizeLibrary(input) {
    validateLibrary(input);
    if (!input || input.kind !== "athlete-library") {
      const record = normalizeRecord(input?.record || input),
        lib = libraryDefaults();
      const profile = profileFromRecord(input?.profile || record);
      lib.athletes.push({
        id: record.athleteId,
        name: profile.name || record.athlete.name || "未命名运动员",
        profile,
        sample: !!record.demo,
        records: [record],
      });
      lib.catalog = input?.catalog
        ? normalizeCatalog(input.catalog)
        : mergeCatalog(lib.catalog, record);
      lib.activeAthleteId = record.athleteId;
      lib.activeRecordId = record.recordId;
      return lib;
    }
    const lib = {
      ...libraryDefaults(),
      ...clone(input),
      schema: 2,
      kind: "athlete-library",
    };
    lib.catalog = normalizeCatalog(input.catalog);
    lib.athletes = (Array.isArray(input.athletes) ? input.athletes : []).map(
      (a) => {
        const athlete = {
          ...a,
          id: a.id || uid(),
          name: String(a.name || "未命名运动员"),
          sample: !!a.sample,
        };
        athlete.records = (Array.isArray(a.records) ? a.records : []).map(
          (r) => {
            const record = normalizeRecord(r);
            record.athleteId = athlete.id;
            return record;
          },
        );
        athlete.profile = a.profile
          ? profileFromRecord(a.profile)
          : { ...profileFromRecord(latestRecord(athlete)), name: athlete.name };
        return athlete;
      },
    );
    // Once the shared catalog exists, record snapshots are authoritative history.
    // Re-scanning them would turn intentional later catalog edits into conflicts.
    if (!input.catalog)
      lib.athletes.forEach((a) =>
        a.records.forEach((r) => {
          lib.catalog = mergeCatalog(
            lib.catalog,
            r,
            a.name + " / " + r.athlete.date + " / " + r.recordId,
          );
        }),
      );
    const selected =
      lib.athletes.find((a) => a.id === lib.activeAthleteId) || lib.athletes[0];
    lib.activeAthleteId = selected?.id || "";
    lib.activeRecordId =
      selected?.records.find((r) => r.recordId === lib.activeRecordId)
        ?.recordId ||
      selected?.records[0]?.recordId ||
      "";
    return lib;
  }
  const plainObject = (value) =>
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ["[object Object]"].includes(Object.prototype.toString.call(value));
  const safeId = (value) =>
    typeof value === "string" &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value);
  function validateDataTree(value, depth = 0) {
    if (depth > 50) throw new Error("数据嵌套过深");
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("包含非法数值");
    if (
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint"
    )
      throw new Error("数据必须为纯 JSON");
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && !plainObject(value))
      throw new Error("数据对象类型无效");
    Object.entries(value).forEach(([key, v]) => {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("包含不安全字段");
      validateDataTree(v, depth + 1);
    });
  }
  function validateField(record, path, value) {
    path = path.replace(/^(data\.(?:pushup|mas|mss|ift))\.trials\.\d+\./, "$1.")
      .replace(/^(data\.hop)\.trials\.\d+\./, "$1.")
      .replace(/^(data\.iso\.\d+)\.trials\.\d+\./, "$1.");
    const empty = value === "" || value === null || value === undefined;
    if (["athlete.birthDate", "athlete.date", "trainingContext.previousCompetitionDate", "trainingContext.nextCompetitionDate"].includes(path)) {
      if (empty) return "";
      if (dateStamp(value) === null) return "日期须为有效的 YYYY-MM-DD";
      const tested = path === "athlete.date" ? value : record.athlete?.date;
      const born = path === "athlete.birthDate" ? value : record.athlete?.birthDate;
      const previous = path === "trainingContext.previousCompetitionDate" ? value : record.trainingContext?.previousCompetitionDate;
      const next = path === "trainingContext.nextCompetitionDate" ? value : record.trainingContext?.nextCompetitionDate;
      if (born && dateStamp(born) !== null && born > date()) return "生日不能晚于今天";
      if (dateStamp(tested) === null) return "请填写有效的测试日期";
      if (born && dateStamp(born) !== null && born > tested) return "测试日期不能早于生日";
      if (previous && dateStamp(previous) !== null && previous > tested) return "上一场比赛日期不能晚于测试日期";
      if (next && dateStamp(next) !== null && next < tested) return "下一场比赛日期不能早于测试日期";
      return "";
    }
    const number = N(value),
      requireNumber = () => (number === null ? "请填写有限数值" : "");
    const bounds = (min, max, integer = false, strictlyPositive = false) => {
      if (empty) return "";
      if (requireNumber()) return requireNumber();
      if (integer && !Number.isInteger(number)) return "请填写整数";
      if (strictlyPositive && number <= 0) return "数值须大于 0";
      if (min !== null && number < min) return "数值不得小于 " + min;
      if (max !== null && number > max) return "数值不得大于 " + max;
      return "";
    };
    if (path.startsWith("rules.")) {
      const key = path.slice(6);
      if (
        ![
          "asymAmber",
          "asymRed",
          "absoluteAmber",
          "scoreAmber",
          "scoreGreen",
        ].includes(key)
      )
        return "";
      if (empty) return "评价阈值不能为空";
      const error = bounds(
        0,
        /^asym/.test(key) || key === "absoluteAmber" ? 100 : null,
      );
      if (error) return error;
      const rules = { ...record.rules, [key]: number };
      if (
        (/^asym/.test(key) &&
          N(rules.asymAmber) !== null &&
          N(rules.asymRed) !== null &&
          N(rules.asymAmber) >= N(rules.asymRed)) ||
        (/^score/.test(key) &&
          N(rules.scoreAmber) !== null &&
          N(rules.scoreGreen) !== null &&
          N(rules.scoreAmber) >= N(rules.scoreGreen))
      )
        return "关注阈值须低于重点关注／绿灯阈值";
      return "";
    }
    if (path === "data.pushup.reps") return bounds(0, null, true);
    const fvpPath = path.match(/^(?:data|fvpConfig|fvpAnalysis)\.(fvp_(?:sj|cmj))\./);
    if (fvpPath && T.isNative(record, fvpPath[1])) {
      if (/^data\.fvp_(sj|cmj)\.\d+\.load$/.test(path)) return bounds(0, null);
      if (/^(?:data\.fvp_(?:sj|cmj)\.\d+\.(?:height|distanceCm)|fvpConfig\.fvp_(?:sj|cmj)\.distanceCm)$/.test(path)) return bounds(0, null, false, true);
      if (/^fvpAnalysis\.fvp_(sj|cmj)\.delta(?:Force|Velocity)Pct$/.test(path)) return empty ? "" : requireNumber() || (number <= -100 ? "变化须大于 −100%" : "");
    }
    if (/^athlete\.(age|mass|height)$/.test(path))
      return bounds(
        0,
        path === "athlete.age" ? 100 : null,
        false,
        path !== "athlete.age",
      );
    if (/^data\.fms\.\d+\.(score|left|right)$/.test(path))
      return bounds(0, 3, true);
    if (path === "trainingContext.experienceYears") return bounds(0, 80);
    if (path === "trainingContext.weeklySessions") return bounds(0, 14, true);
    if (
      /^data\.(cmj|sj|dj|cmrj)\.\d+\.(height|force|rsiModified|landingPeakForce|propulsiveImpulse|propulsiveDurationMs|contactTimeMs|flightTimeMs|dropHeightCm|firstHeight|firstTimeToTakeoffMs|activeStiffness)$/.test(
        path,
      )
    )
      return bounds(0, null, false, true);
    if (/^data\.hop\.(?:summary|jumps\.\d+)\.(height|contactTimeMs|flightTimeMs|rsi|flightTimeRatio|activeStiffness)$/.test(path)) return bounds(0, null, false, true);
    if (/^data\.cpet\.(?:thresholds\.(?:first|second)\.)?(vo2|peakHr|rer|hr|speed|power)$/.test(path)) return bounds(0, null, false, true);
    if (/^data\.hop\.summary\.(suppliedCount|validCount|selectedCount)$/.test(path)) return bounds(0, null, true);
    if (/^data\.imtp\.\d+\.(impulse250|matchedImpulse|matchedDurationMs)$/.test(path)) return bounds(0, null, false, true);
    if (/^data\.[\w-]+\.(?:\d+\.)?metrics\.[\w-]+$/.test(path))
      return empty ? "" : requireNumber();
    if (
      /^data\.imtp\.\d+\.(peakForce|f100|f200|rfd100|rfd200|baselineForce)$/.test(
        path,
      ) ||
      /^data\.imtp\.\d+\.timePoints\.\d+\.(force|rfd)$/.test(path)
    )
      return empty ? "" : requireNumber();
    if (/^data\.imtp\.\d+\.peakTimeMs$/.test(path))
      return bounds(0, null, false, true);
    const time = path.match(/^data\.imtp\.(\d+)\.timePoints\.(\d+)\.timeMs$/);
    if (time) {
      const error = bounds(0, null, false, true);
      if (error || empty) return error;
      return (record.data.imtp[Number(time[1])]?.timePoints || []).some(
        (p, i) => i !== Number(time[2]) && N(p.timeMs) === number,
      )
        ? "同一次尝试不能有重复时间点"
        : "";
    }
    if (/^data\.iso\.\d+\.(left|right|center)$/.test(path))
      return bounds(0, null);
    if (
      /^data\.iso\.\d+\.target$/.test(path) ||
      /^definitions\.\d+\.target$/.test(path) ||
      path === "dsi.force"
    )
      return bounds(0, null, false, true);
    if (/^data\.(landmine|squat|bench|deadlift)\.\d+\.load$/.test(path))
      return bounds(0, null);
    if (
      /^data\.(landmine|squat|bench|deadlift)\.\d+\.velocity$/.test(path) ||
      /^data\.mb\.\d+\.distance$/.test(path) ||
      /^data\.(mas|mss|ift)\.speed$/.test(path) ||
      /^data\.lactate\.\d+\.speed$/.test(path) ||
      /^thresholds\.(lt1|lt2)$/.test(path) ||
      /^lvp\.[^.]+\.mvt$/.test(path)
    )
      return bounds(0, null, false, true);
    if (/^data\.lactate\.\d+\.(lactate|hr)$/.test(path)) return bounds(0, null);
    if (path === "data.ift.partial") return bounds(0, 30);
    if (/^lvp\.[^.]+\.zones\.\d+\.(min|max)$/.test(path))
      return bounds(0, null, false, path.endsWith(".max"));
    if (/^customValues\.[^.]+\.value$/.test(path))
      return empty ? "" : requireNumber();
    return "";
  }
  function numericFieldIssues(record) {
    const issues = [],
      check = (path, value) => {
        const message = validateField(record, path, value);
        if (message) issues.push({ path, message, value });
      };
    T.describe(record).forEach((test) => {
      if (test.id === "iso") {
        record.data.iso.forEach((row, i) => (row.trials || []).forEach((trial, j) =>
          ["left", "right", "center"].forEach((key) => check(`data.iso.${i}.trials.${j}.${key}`, trial[key]))));
      } else if (test.repeatPolicy.kind !== "none") {
        repeatRows(record, test.id).forEach((row, i) => {
          const base = `data.${test.id}.` + (Array.isArray(record.data[test.id]) ? i + "." : Array.isArray(record.data[test.id]?.trials) ? "trials." + i + "." : "");
          Object.entries(row.metrics || {}).forEach(([id, value]) => check(base + "metrics." + id, value));
          if (["pushup", "mas", "mss", "ift"].includes(test.id)) {
            const key = test.id === "pushup" ? "reps" : "speed";
            check(base + key, row[key]);
            if (test.id === "ift") check(base + "partial", row.partial);
          }
          if (test.id === "hop" && T.isNative(record,"hop")) {
            ["height","contactTimeMs","flightTimeMs","rsi","flightTimeRatio","activeStiffness","suppliedCount","validCount","selectedCount"].forEach((key) => check(base + "summary." + key,row.summary?.[key]));
            (row.jumps || []).forEach((jump,j) => ["height","contactTimeMs","flightTimeMs"].forEach((key) => check(base + "jumps." + j + "." + key,jump[key])));
          }
        });
      }
    });
    ["age", "mass", "height"].forEach((k) =>
      check("athlete." + k, record.athlete[k]),
    );
    if (T.isNative(record,"cpet") && record.data.cpet) {
      ["vo2","peakHr","rer"].forEach(key => check("data.cpet." + key,record.data.cpet[key]));
      ["first","second"].forEach(side => ["vo2","hr","speed","power"].forEach(key => check("data.cpet.thresholds." + side + "." + key,record.data.cpet.thresholds?.[side]?.[key])));
    }
    FVP_IDS.filter(id => T.isNative(record,id)).forEach(id => {
      (record.data[id] || []).forEach((row,i) => ["load","height","distanceCm"].forEach(key => check("data." + id + "." + i + "." + key, row[key])));
      check("fvpConfig." + id + ".distanceCm", record.fvpConfig?.[id]?.distanceCm);
      ["deltaForcePct","deltaVelocityPct"].forEach(key => check("fvpAnalysis." + id + "." + key, record.fvpAnalysis?.[id]?.[key]));
    });
    const fields = {
      fms: ["score", "left", "right"],
      iso: ["left", "right", "center", "target"],
      ...Object.fromEntries(["cmj","sj","dj","cmrj"].map((id) => [id,T.fieldsForTest(id).filter((field) => !field.computed).map((field) => field.key)])),
      imtp: [
        "peakForce",
        "f100",
        "f200",
        "rfd100",
        "rfd200",
        "baselineForce",
        "peakTimeMs",
        "impulse250", "matchedImpulse", "matchedDurationMs",
      ],
      landmine: ["load", "velocity"],
      squat: ["load", "velocity"],
      bench: ["load", "velocity"],
      deadlift: ["load", "velocity"],
      mb: ["distance"],
      lactate: ["speed", "lactate", "hr"],
    };
    Object.entries(fields).forEach(([t, keys]) =>
      (record.data[t] || []).forEach((row, i) => {
        keys.filter((k) => t !== "iso" || !Array.isArray(row.trials) || k === "target")
          .forEach((k) => check("data." + t + "." + i + "." + k, row[k]));
        if (["cmj", "sj"].includes(t))
          Object.entries(row.metrics || {}).forEach(([id, value]) =>
            check(`data.${t}.${i}.metrics.${id}`, value),
          );
        if (t === "imtp")
          (row.timePoints || []).forEach((p, j) =>
            ["timeMs", "force", "rfd"].forEach((k) =>
              check("data.imtp." + i + ".timePoints." + j + "." + k, p[k]),
            ),
          );
      }),
    );
    ["mas", "mss", "ift"].filter((t) => !Array.isArray(record.data[t]?.trials)).forEach((t) =>
      check("data." + t + ".speed", record.data[t]?.speed),
    );
    ["experienceYears", "weeklySessions"].forEach((key) =>
      check("trainingContext." + key, record.trainingContext?.[key]),
    );
    if (!Array.isArray(record.data.ift.trials)) check("data.ift.partial", record.data.ift.partial);
    if (!Array.isArray(record.data.pushup.trials)) check("data.pushup.reps", record.data.pushup.reps);
    ["lt1", "lt2"].forEach((k) =>
      check("thresholds." + k, record.thresholds?.[k]),
    );
    check("dsi.force", record.dsi?.force);
    (record.definitions || []).forEach((d, i) =>
      check("definitions." + i + ".target", d.target),
    );
    Object.entries(record.customValues || {}).forEach(([id, entry]) =>
      check("customValues." + id + ".value", entry?.value),
    );
    Object.entries(record.lvp || {}).forEach(([id, cfg]) => {
      check("lvp." + id + ".mvt", cfg.mvt);
      (cfg.zones || []).forEach((zone, i) =>
        ["min", "max"].forEach((k) =>
          check("lvp." + id + ".zones." + i + "." + k, zone[k]),
        ),
      );
    });
    return issues;
  }
  function recordsIn(input) {
    if (input?.kind === "athlete-library")
      return (input.athletes || []).flatMap((a) => a.records || []);
    return input?.record ? [input.record] : input ? [input] : [];
  }
  function diagnoseRules(input) {
    return recordsIn(input).flatMap((record) =>
      [
        "asymAmber",
        "asymRed",
        "absoluteAmber",
        "scoreAmber",
        "scoreGreen",
      ].flatMap((key) => {
        const path = "rules." + key,
          value = record.rules?.[key],
          message = validateField(record, path, value);
        return message
          ? [
              {
                athleteId: record.athleteId || "",
                recordId: record.recordId,
                path,
                value: value === undefined ? null : value,
                message,
              },
            ]
          : [];
      }),
    );
  }
  function repairRules(input, changes) {
    const repaired = clone(input);
    recordsIn(repaired).forEach((record) => {
      if (changes[record.recordId])
        record.rules = { ...record.rules, ...changes[record.recordId] };
    });
    validateLibrary(repaired);
    return repaired;
  }
  function validatePrimaryMetrics(source) {
    const projects = source.tests || source.projectSnapshots || source.customTests || [];
    projects.forEach((test) => {
      if (test.primaryMetricId === undefined || test.primaryMetricId === "") return;
      if (!safeId(test.primaryMetricId) || !(source.definitions || []).some((d) => d.id === test.primaryMetricId && d.testId === test.id && T.isAttemptMetric(d)))
        throw new Error("主指标须为该测试的试次指标");
    });
  }
  function validateRepeatStorage(input) {
    const validateRows = (rows) => {
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error("重复试次结构无效");
      const ids = new Set();
      rows.forEach((row) => {
        if (!plainObject(row) || (row.id !== undefined && (!safeId(row.id) || ids.has(row.id)))) throw new Error("试次 ID 或数据结构无效");
        if (row.id !== undefined) ids.add(row.id);
        if (row.notes !== undefined && typeof row.notes !== "string") throw new Error("试次备注格式无效");
        if (row.metrics !== undefined && (!plainObject(row.metrics) || Object.keys(row.metrics).some((id) => !safeId(id)))) throw new Error("试次指标结构无效");
        ["painLeft", "painRight", "painCenter"].forEach((key) => {
          if (row[key] !== undefined && typeof row[key] !== "boolean") throw new Error("试次疼痛标记格式无效");
        });
        if (row.unit !== undefined && !["m/s", "km/h"].includes(row.unit)) throw new Error("试次速度单位无效");
      });
    };
    ["pushup", "mas", "mss", "ift", "hop"].forEach((id) => { if (input.data[id]?.trials !== undefined) validateRows(input.data[id].trials); });
    ["dj","cmrj"].forEach((id) => { if (input.data[id] !== undefined) validateRows(input.data[id]); });
    if (input.data.hop !== undefined && T.isNative(input,"hop")) {
      if (!plainObject(input.data.hop)) throw new Error("Hop 测试组结构无效");
      repeatRows(input,"hop").forEach((set) => {
        if (!["summary","jumps"].includes(set.inputMode) || !plainObject(set.summary)) throw new Error("Hop 录入方式或汇总结构无效");
        if (set.summary.activeStiffnessInputUnit !== undefined && !["kN/m","N/m"].includes(set.summary.activeStiffnessInputUnit)) throw new Error("Active Stiffness 输入单位无效");
        validateRows(set.jumps);
        if (!["height_rsi","flight_ratio","unknown"].includes(set.summary.selectionBasis)) throw new Error("Hop 选跳依据无效");
        const supplied = N(set.summary.suppliedCount), valid = N(set.summary.validCount), selected = N(set.summary.selectedCount);
        if ((supplied !== null && valid !== null && valid > supplied) || (valid !== null && selected !== null && selected > valid) || (supplied !== null && selected !== null && selected > supplied)) throw new Error("Hop 跳数须满足录入数 ≥ 有效数 ≥ 采用数");
      });
    }
    input.data.iso.forEach((row) => { if (row.trials !== undefined) validateRows(row.trials); });
    (input.customTests || []).forEach((test) => { if (input.data[test.id] !== undefined) validateRows(input.data[test.id]); });
    validatePrimaryMetrics(input);
  }
  function validateDerivedOptions(source) {
    if (source.derivedEnabled !== undefined && (!plainObject(source.derivedEnabled) || Object.entries(source.derivedEnabled).some(([id,v]) => !safeId(id) || typeof v !== "boolean"))) throw new Error("训练方向指标开关无效");
    if (source.impulseConfig !== undefined && (!plainObject(source.impulseConfig) || typeof source.impulseConfig.confirmed !== "boolean")) throw new Error("冲量可比性确认无效");
    ["cmjConfig","imtpConfig"].forEach((key) => { if (source[key]?.impulseDefinition !== undefined && !["gross","net"].includes(source[key].impulseDefinition)) throw new Error("冲量力口径无效"); });
  }
  function validateCatalog(catalog) {
    validateDerivedOptions(catalog);
    if (
      !plainObject(catalog) ||
      !Array.isArray(catalog.tests) ||
      !Array.isArray(catalog.definitions) ||
      !plainObject(catalog.protocol) ||
      !Array.isArray(catalog.conflicts) ||
      catalog.tests.length > 75 ||
      catalog.definitions.length > 300 ||
      catalog.conflicts.length > 300
    )
      throw new Error("共用项目目录结构无效");
    validateAbilityGroups(catalog.abilityGroups);
    validateAbilityGroupConflicts(catalog.abilityGroupConflicts);
    const testIds = new Set(),
      definitionIds = new Set();
    catalog.tests.forEach((test) => {
      if (
        !plainObject(test) ||
        !safeId(test.id) ||
        testIds.has(test.id) ||
        typeof test.name !== "string" ||
        (test.primaryAbility !== undefined && typeof test.primaryAbility !== "string") ||
        !["screen", "performance"].includes(test.category)
      )
        throw new Error("目录项目 ID 或类型无效");
      testIds.add(test.id);
    });
    const validateDefinitions = (definitions, knownTests) =>
      definitions.forEach((definition) => {
        if (
          !plainObject(definition) ||
          !safeId(definition.id) ||
          !safeId(definition.testId) ||
          !knownTests.has(definition.testId) ||
          typeof definition.name !== "string" ||
          !["higher", "lower"].includes(definition.direction) ||
          !Array.isArray(definition.ranges) ||
          (definition.entryScope !== undefined &&
            !["record", "attempt"].includes(definition.entryScope)) ||
          (definition.entryScope === "attempt" &&
            !T.supportsAttemptMetrics(definition.testId) && !definition.legacyManual) ||
          (definition.cvEligible !== undefined && typeof definition.cvEligible !== "boolean")
        )
          throw new Error("目录指标定义无效");
        Def.parseRanges(Def.rangeText(definition.ranges));
        if (definition.referenceGroups !== undefined) {
          if (!root.RingsideReferences) throw new Error("分组参考标准模块未加载");
          root.RingsideReferences.validateReferenceGroups(definition.referenceGroups);
        }
        const error = validateField(
          { rules: {} },
          "definitions.0.target",
          definition.target,
        );
        if (error) throw new Error("目录指标目标：" + error);
      });
    validateDefinitions(catalog.definitions, testIds);
    validatePrimaryMetrics(catalog);
    catalog.definitions.forEach((definition) => {
      if (definitionIds.has(definition.id)) throw new Error("目录指标 ID 重复");
      definitionIds.add(definition.id);
    });
    Object.entries(catalog.protocol).forEach(([id, protocol]) => {
      if (!safeId(id) || typeof protocol !== "string")
        throw new Error("目录协议字段无效");
    });
    catalog.conflicts.forEach((conflict) => {
      if (
        !plainObject(conflict) ||
        !safeId(conflict.testId) ||
        !testIds.has(conflict.testId) ||
        !Array.isArray(conflict.variants) ||
        conflict.variants.length < 2 ||
        conflict.variants.length > 1000
      )
        throw new Error("目录冲突版本结构无效");
      conflict.variants.forEach((variant) => {
        if (
          !plainObject(variant) ||
          !plainObject(variant.test) ||
          variant.test.id !== conflict.testId ||
          typeof variant.test.name !== "string" ||
          !["screen", "performance"].includes(variant.test.category) ||
          !Array.isArray(variant.definitions) ||
          typeof variant.protocol !== "string"
        )
          throw new Error("目录候选版本无效");
        validateDefinitions(variant.definitions, new Set([conflict.testId]));
      });
    });
    return true;
  }
  function validateAbilityGroups(groups) {
    if (groups === undefined) return;
    if (!Array.isArray(groups) || groups.length > 300) throw new Error("能力分类结构无效");
    const keys = new Set();
    for (const group of groups) {
      if (!plainObject(group) || !validAbilityText(group.key) || !validAbilityText(group.name) || keys.has(group.key))
        throw new Error("能力分类名称或标识无效");
      keys.add(group.key);
    }
  }
  const validAbilityText = value => typeof value === "string" && !!value.trim() && value === value.trim() && value.length <= 120;
  function validateAbilityGroupConflicts(conflicts) {
    if (conflicts === undefined) return;
    if (!Array.isArray(conflicts) || conflicts.length > 300 || conflicts.some(conflict => !plainObject(conflict) ||
      !validAbilityText(conflict.key) || !validAbilityText(conflict.localName) || !validAbilityText(conflict.incomingName)))
      throw new Error("能力分类冲突结构无效");
  }
  function validateIMTPTimeStandards(standards) {
    if (standards === undefined) return;
    if (!Array.isArray(standards) || standards.length > 2000) throw new Error("IMTP 时点标准结构无效");
    const keys = new Set();
    standards.forEach(rule => {
      if (!plainObject(rule) || typeof rule.timeMs !== "number" || !Number.isFinite(rule.timeMs) || rule.timeMs <= 0 ||
          !["force_pct_peak", "rfd"].includes(rule.kind) || !["higher", "lower"].includes(rule.direction) ||
          typeof rule.referenceEnabled !== "boolean" || typeof rule.source !== "string" || !Array.isArray(rule.ranges) ||
          !plainObject(rule.context) || typeof rule.context.protocol !== "string" || !plainObject(rule.context.force) ||
          rule.context.force.unit !== "N" || !["gross", "net"].includes(rule.context.force.definition) ||
          (rule.matched !== undefined && typeof rule.matched !== "boolean")) throw new Error("IMTP 时点标准字段无效");
      const key = rule.timeMs + ":" + rule.kind;
      if (keys.has(key)) throw new Error("IMTP 同一时点的同类标准不能重复");
      keys.add(key);
      if (rule.target !== null && rule.target !== "" &&
          (typeof rule.target !== "number" || !Number.isFinite(rule.target) || rule.target <= 0 ||
           (rule.kind === "force_pct_peak" && rule.target > 100))) throw new Error("IMTP 目标须为正数或留空，峰值百分比不得超过 100");
      Def.parseRanges(Def.rangeText(rule.ranges));
      rule.ranges.forEach(range => {
        for (const key of ["min", "max"]) if (range[key] !== null && range[key] !== undefined &&
          (typeof range[key] !== "number" || !Number.isFinite(range[key]) || range[key] < 0 ||
           (rule.kind === "force_pct_peak" && range[key] > 100))) throw new Error("IMTP 等级端点须为有效非负值，峰值百分比不得超过 100");
        if (range.advantage !== undefined && typeof range.advantage !== "boolean") throw new Error("IMTP 优势等级标记无效");
      });
    });
  }
  function validateRecord(input, options = {}) {
    if (
      !plainObject(input) ||
      ![1, 2].includes(input.schema) ||
      !plainObject(input.athlete) ||
      !plainObject(input.data) ||
      !plainObject(input.enabled) ||
      !Array.isArray(input.definitions)
    )
      throw new Error("不是有效的 Ringside 报告数据");
    validateDataTree(input);
    validateDerivedOptions(input);
    if (input.views?.idsiWindow !== undefined && !["idsi_matched","idsi_fixed250"].includes(input.views.idsiWindow)) throw new Error("iDSI 积分时窗选项无效");
    validateAbilityGroups(input.abilityGroupSnapshot);
    if (input.data.ift?.method !== undefined && typeof input.data.ift.method !== "string") throw new Error("VIFT 测试方法格式无效");
    if (
      !safeId(input.recordId) ||
      (input.schema === 2 && !safeId(input.athleteId)) ||
      (input.athleteId !== undefined && !safeId(input.athleteId))
    )
      throw new Error("运动员或测试记录 ID 无效");
    if (typeof input.athlete.name !== "string")
      throw new Error("运动员姓名字段无效");
    validateAthleteContext(input);
    ["sport", "dominantHand"].forEach((key) => {
      if (
        input.athlete[key] !== undefined &&
        typeof input.athlete[key] !== "string"
      )
        throw new Error("运动员 " + key + " 字段无效");
    });
    if (input.kind !== undefined && input.kind !== "assessment-record")
      throw new Error("报告类型无效");
    [
      "rules",
      "protocol",
      "lvp",
      "thresholds",
      "dsi",
      "axes",
      "customValues",
      "views",
      "narrative",
      "imtpConfig",
      "cmjConfig",
      "trainingContext",
      "impulseConfig",
      "derivedEnabled",
      "fvpConfig",
      "fvpAnalysis",
      "fvpView",
    ].forEach((key) => {
      if (input[key] !== undefined && !plainObject(input[key]))
        throw new Error(key + " 必须为数据字典");
    });
    Object.entries(input.enabled).forEach(([key, value]) => {
      if (!safeId(key) || typeof value !== "boolean")
        throw new Error("测试计划字段无效");
    });
    ["protocol", "lvp", "customValues"].forEach((key) => {
      if (input[key])
        Object.keys(input[key]).forEach((id) => {
          if (!safeId(id)) throw new Error(key + " 包含无效 ID");
        });
    });
    if (input.mode !== undefined && !["best", "mean"].includes(input.mode))
      throw new Error("汇总模式无效");
    validateIMTPTimeStandards(input.imtpTimeStandards);
    if (input.testPlanSnapshot !== undefined) {
      const plan = input.testPlanSnapshot;
      if (!plainObject(plan) || !safeId(plan.id) || typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 120 ||
          !Array.isArray(plan.testIds) || plan.testIds.length > 75 || plan.testIds.some(id => !safeId(id)) ||
          new Set(plan.testIds).size !== plan.testIds.length) throw new Error("测试方案快照结构无效");
    }
    if (
      input.projectSnapshots !== undefined &&
      (!Array.isArray(input.projectSnapshots) ||
        input.projectSnapshots.length > 75 ||
        new Set(input.projectSnapshots.map((t) => t.id)).size !==
          input.projectSnapshots.length ||
        input.projectSnapshots.some(
          (t) =>
            !plainObject(t) ||
            !safeId(t.id) ||
            typeof t.name !== "string" ||
            !["screen", "performance"].includes(t.category) ||
            (t.primaryAbility !== undefined &&
              typeof t.primaryAbility !== "string"),
        ))
    )
      throw new Error("项目快照结构无效");
    if (input.definitions.length > 300 || (input.customTests || []).length > 60)
      throw new Error("定义数量超出限制");
    if (input.customTests !== undefined && !Array.isArray(input.customTests))
      throw new Error("自定义测试结构无效");
    const customIds = new Set();
    (input.customTests || []).forEach((test) => {
      if (
        !plainObject(test) ||
        !safeId(test.id) ||
        customIds.has(test.id) ||
        (TESTS.some((t) => t[0] === test.id) && !["dj","hop","cmrj","cpet", ...FVP_IDS].includes(test.id)) ||
        typeof test.name !== "string" ||
        !["screen", "performance"].includes(test.category)
      )
        throw new Error("自定义测试 ID 或类型无效");
      customIds.add(test.id);
    });
    const ids = new Set();
    input.definitions.forEach((d) => {
      if (
        !safeId(d.id) ||
        !safeId(d.testId) ||
        ids.has(d.id) ||
        !Array.isArray(d.ranges) ||
        typeof d.name !== "string" ||
        !["higher", "lower"].includes(d.direction) ||
        (d.entryScope !== undefined &&
          !["record", "attempt"].includes(d.entryScope)) ||
        (d.entryScope === "attempt" && !T.supportsAttemptMetrics(d.testId) && !d.legacyManual) ||
        (d.cvEligible !== undefined && typeof d.cvEligible !== "boolean")
      )
        throw new Error("指标定义无效或 ID 重复");
      ids.add(d.id);
      Def.parseRanges(Def.rangeText(d.ranges));
      if (d.referenceMode !== undefined && !["standard","grouped"].includes(d.referenceMode)) throw new Error("参考标准模式无效");
      if (d.referenceGroups !== undefined) {
        if (!root.RingsideReferences) throw new Error("分组参考标准模块未加载");
        root.RingsideReferences.validateReferenceGroups(d.referenceGroups);
      }
    });
    [
      "fms",
      "iso",
      "cmj",
      "sj",
      "landmine",
      "squat",
      "bench",
      "deadlift",
      "mb",
      "lactate",
    ].forEach((t) => {
      if (
        !Array.isArray(input.data[t]) ||
        input.data[t].length > 1000 ||
        input.data[t].some((row) => !plainObject(row))
      )
        throw new Error("测试数据结构不完整");
    });
    ["ift", "mas", "mss", "pushup"].forEach((t) => {
      if (!plainObject(input.data[t])) throw new Error("测试数据结构不完整");
    });
    if (input.data.cpet !== undefined && T.isNative(input,"cpet")) {
      const cpet = input.data.cpet;
      if (!plainObject(cpet) || !["","treadmill","cycle"].includes(cpet.modality) || !["VO2max","VO2peak"].includes(cpet.oxygenLabel) || !["ml/kg/min","l/min"].includes(cpet.vo2Unit) || !plainObject(cpet.thresholds) || typeof cpet.protocol !== "string") throw new Error("CPET 测量方式、摄氧量名称或结构无效");
      ["first","second"].forEach((key,index) => {
        const threshold = cpet.thresholds[key];
        if (!plainObject(threshold) || !["VT"+(index+1),"LT"+(index+1)].includes(threshold.label) || !["ml/kg/min","l/min"].includes(threshold.vo2Unit)) throw new Error("CPET 阈值名称、摄氧量单位或结构无效");
      });
    }
    const speedUnits = ["m/s", "km/h"];
    ["ift", "mas", "mss"].forEach((t) => {
      if (
        input.data[t].unit !== undefined &&
        !speedUnits.includes(input.data[t].unit)
      )
        throw new Error("速度单位仅支持 m/s 或 km/h");
    });
    input.data.lactate.forEach((row) => {
      if (row.unit !== undefined && !speedUnits.includes(row.unit))
        throw new Error("速度单位仅支持 m/s 或 km/h");
    });
    ["cmj", "sj", "dj", "cmrj"].forEach((id) =>
      (input.data[id] || []).forEach((row) => {
        if (row.activeStiffnessInputUnit !== undefined && !["kN/m","N/m"].includes(row.activeStiffnessInputUnit)) throw new Error("Active Stiffness 输入单位无效");
        if (
          row.metrics !== undefined &&
          (!plainObject(row.metrics) ||
            Object.keys(row.metrics).some((key) => !safeId(key)))
        )
          throw new Error("试次补充指标结构无效");
      }),
    );
    if (input.trainingContext)
      ["equipment", "weeklySchedule"].forEach((key) => {
        if (
          input.trainingContext[key] !== undefined &&
          typeof input.trainingContext[key] !== "string"
        )
          throw new Error("训练背景格式无效");
      });
    if (
      input.thresholds?.unit !== undefined &&
      !speedUnits.includes(input.thresholds.unit)
    )
      throw new Error("阈值速度单位仅支持 m/s 或 km/h");
    const isoIds = new Set();
    input.data.iso.forEach((row) => {
      root.RingsideIsoReferences?.validateReference(row.reference);
      if (
        !safeId(row.id) ||
        isoIds.has(row.id) ||
        !REG[row.region] ||
        typeof row.direction !== "string" ||
        typeof row.paired !== "boolean"
      )
        throw new Error("等长方向 ID 或定义无效");
      isoIds.add(row.id);
    });
    validateIsoDirectionIds(input.isoDirectionIds, input.data.iso);
    if (input.testPlanSnapshot?.isoDirectionIds !== undefined)
      validateIsoDirectionIds(input.testPlanSnapshot.isoDirectionIds, isoDirectionCatalog(input));
    validateRepeatStorage(input);
    if (input.balancePairs !== undefined) {
      if (
        !Array.isArray(input.balancePairs) ||
        input.balancePairs.length > 1000
      )
        throw new Error("关节配对结构无效");
      const pairIds = new Set();
      input.balancePairs.forEach((pair) => {
        if (
          !plainObject(pair) ||
          !safeId(pair.id) ||
          pairIds.has(pair.id) ||
          !REG[pair.region] ||
          typeof pair.label !== "string" ||
          (pair.numeratorId !== "" && !safeId(pair.numeratorId)) ||
          (pair.denominatorId !== "" && !safeId(pair.denominatorId)) ||
          !Array.isArray(pair.ranges)
        )
          throw new Error("关节配对 ID 或定义无效");
        pairIds.add(pair.id);
        root.RingsideIsoReferences?.validateReference(pair.reference, true);
        Def.parseRanges(Def.rangeText(pair.ranges));
      });
    }
    if (
      input.schema === 2 &&
      (!Array.isArray(input.data.imtp) ||
        input.data.imtp.length > 1000 ||
        input.data.imtp.some((row) => !plainObject(row)))
    )
      throw new Error("IMTP 数据结构不完整");
    const optionalNumber = (value) =>
      value === undefined ||
      value === null ||
      value === "" ||
      ((typeof value === "number" || typeof value === "string") &&
        N(value) !== null);
    FVP_IDS.filter(id => T.isNative(input,id)).forEach(id => {
      const rows = input.data[id];
      if (rows !== undefined && (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !plainObject(row)))) throw new Error("F–V 试次须为数据行");
      const ids = new Set();
      (rows || []).forEach(row => {
        if (row.id !== undefined && (!safeId(row.id) || ids.has(row.id))) throw new Error("F–V 试次 ID 无效或重复");
        if (row.id) ids.add(row.id);
        ["load","height","distanceCm"].forEach(key => { if (!optionalNumber(row[key])) throw new Error("F–V " + key + " 须为有限数值或留空"); });
        if (row.excluded !== undefined && typeof row.excluded !== "boolean") throw new Error("F–V 排除选项无效");
        ["notes","exclusionReason"].forEach(key => { if (row[key] !== undefined && typeof row[key] !== "string") throw new Error("F–V " + key + " 须为文字"); });
      });
      const config = input.fvpConfig?.[id], analysis = input.fvpAnalysis?.[id], view = input.fvpView?.[id];
      [config,analysis,view].forEach(value => { if (value !== undefined && !plainObject(value)) throw new Error("F–V 配置格式无效"); });
      if (config) {
        ["device","method","posture","distanceSource"].forEach(key => { if (config[key] !== undefined && typeof config[key] !== "string") throw new Error("F–V " + key + " 须为文字"); });
        if (!optionalNumber(config.distanceCm)) throw new Error("F–V 推进距离须为有限数值或留空");
      }
      if (analysis) {
        if (analysis.angle !== undefined && ![90,30].includes(analysis.angle)) throw new Error("F–V 目标角度须为 90° 或 30°");
        ["deltaForcePct","deltaVelocityPct"].forEach(key => { if (!optionalNumber(analysis[key])) throw new Error("F–V 情景变化须为有限数值"); });
      }
      if (view) {
        ["fv","pv","points","optimum","comparison","confidence","responseForce","responseVelocity","responseBoth"].forEach(key => { if (view[key] !== undefined && typeof view[key] !== "boolean") throw new Error("F–V 图层选项无效"); });
        if (view.range !== undefined && !["full","measured"].includes(view.range)) throw new Error("F–V 显示范围无效");
        if (view.pinnedLoad !== undefined && view.pinnedLoad !== null && (N(view.pinnedLoad) === null || N(view.pinnedLoad) < 0)) throw new Error("F–V 定位负荷无效");
      }
    });
    if (input.views?.fvpProtocol !== undefined && !FVP_IDS.includes(input.views.fvpProtocol)) throw new Error("F–V 剖面选项无效");
    (input.data.imtp || []).forEach((row) => {
      [
        "peakForce",
        "f100",
        "f200",
        "rfd100",
        "rfd200",
        "baselineForce",
        "peakTimeMs",
      ].forEach((key) => {
        if (!optionalNumber(row[key]))
          throw new Error("IMTP " + key + " 须为有限数值或留空");
      });
      if (row.timePoints === undefined) return;
      if (!Array.isArray(row.timePoints) || row.timePoints.length > 1000)
        throw new Error("IMTP 时间点结构无效");
      const times = new Set(),
        ids = new Set();
      row.timePoints.forEach((point) => {
        if (!plainObject(point)) throw new Error("IMTP 时间点须为数据对象");
        ["timeMs", "force", "rfd"].forEach((key) => {
          if (!optionalNumber(point[key]))
            throw new Error("IMTP 时间点 " + key + " 须为有限数值或留空");
        });
        if (point.id !== undefined) {
          if (!safeId(point.id) || ids.has(point.id))
            throw new Error("IMTP 时间点 ID 无效或重复");
          ids.add(point.id);
        }
        const t = N(point.timeMs);
        if (t !== null && (t <= 0 || times.has(t)))
          throw new Error("IMTP 时间须大于 0 ms 且同次尝试不可重复");
        if (t !== null) times.add(t);
      });
    });
    const issues = numericFieldIssues(input);
    if (issues.length)
      throw new Error(issues[0].path + "：" + issues[0].message);
    if (!options.skipRules && diagnoseRules(input).length)
      throw new Error(
        "评价阈值顺序不合法：" +
          diagnoseRules(input)[0].path +
          " " +
          diagnoseRules(input)[0].message,
      );
    return true;
  }
  function validateLibrary(input, options = {}) {
    if (!plainObject(input)) throw new Error("不是有效的 Ringside 数据备份");
    validateDataTree(input);
    if (input.kind === "athlete-library") {
      if (
        input.schema !== 2 ||
        !Array.isArray(input.athletes) ||
        input.athletes.length > 2000
      )
        throw new Error("运动员库格式无效");
      if (input.catalog !== undefined) validateCatalog(input.catalog);
      const athleteIds = new Set(),
        recordIds = new Set();
      let recordCount = 0;
      input.athletes.forEach((athlete) => {
        if (
          !plainObject(athlete) ||
          !safeId(athlete.id) ||
          typeof athlete.name !== "string" ||
          !Array.isArray(athlete.records) ||
          athlete.records.length > 1000
        )
          throw new Error("运动员档案结构无效");
        if (athleteIds.has(athlete.id)) throw new Error("运动员 ID 重复");
        athleteIds.add(athlete.id);
        if (athlete.sample !== undefined && typeof athlete.sample !== "boolean")
          throw new Error("示例运动员标记无效");
        if (athlete.profile !== undefined) validateAthleteProfile(athlete.profile);
        athlete.records.forEach((record) => {
          validateRecord(record, options);
          if (record.schema === 2 && record.athleteId !== athlete.id)
            throw new Error("测试记录与所属运动员 ID 不一致");
          if (recordIds.has(record.recordId))
            throw new Error("测试记录 ID 在运动员库中重复");
          recordIds.add(record.recordId);
          recordCount++;
          if (recordCount > 10000) throw new Error("测试记录数量超出限制");
        });
      });
      if (input.activeAthleteId && !athleteIds.has(input.activeAthleteId))
        throw new Error("当前运动员 ID 不属于此运动员库");
      if (input.activeRecordId) {
        const selected = input.athletes.find(
          (a) => a.id === input.activeAthleteId,
        );
        if (
          !selected ||
          !selected.records.some((r) => r.recordId === input.activeRecordId)
        )
          throw new Error("当前测试记录 ID 不属于当前运动员");
      }
      return true;
    }
    if (input.record !== undefined) {
      if (
        input.schema !== 2 ||
        !["report", "assessment-record"].includes(input.kind) ||
        !plainObject(input.record)
      )
        throw new Error("单报告备份格式无效");
      if (input.profile !== undefined) validateAthleteProfile(input.profile);
      if (input.catalog !== undefined) validateCatalog(input.catalog);
      return validateRecord(input.record, options);
    }
    return validateRecord(input, options);
  }
  function localText(record) {
    return root.RingsideInterventions.text(
      root.RingsideInterventions.build(record, stats(record)),
    );
  }
  function legacySampleRecord() {
    const record = defaults();
    record.data.iso = record.data.iso.filter(row => legacyIsoDirectionIds().includes(row.id));
    record.demo = true;
    record.athlete = {
      ...record.athlete,
      name: "示例运动员",
      age: 18,
      sex: "男",
      sport: "拳击",
      mass: 68.5,
      height: 176,
      sportLevel: "青年竞技拳击 · 示例",
      cycle: "一般准备期 · 示例",
    };
    record.definitions.forEach((d) => {
      if (d.scoring !== false) d.referenceEnabled = true;
    });
    record.data.fms = record.data.fms.map((x, i) => ({
      ...x,
      ...(x.bilateral
        ? { left: [3, 2, 2, 1, 2, 3, 2][i], right: [3, 2, 3, 2, 2, 3, 2][i] }
        : { score: i === 0 ? 2 : 3 }),
      notes: i === 3 ? "左侧活动受限；无疼痛" : "",
    }));
    record.data.cmj = [
      { id: uid(), height: 42.1, force: 1680 },
      { id: uid(), height: 44.2, force: 1745 },
      { id: uid(), height: 43.7, force: 1800 },
    ];
    record.data.sj = [
      { id: uid(), height: 38.9 },
      { id: uid(), height: 40.8 },
      { id: uid(), height: 40.2 },
    ];
    record.data.imtp = [
      {
        id: uid(),
        peakForce: 2800,
        f100: "",
        f200: "",
        rfd100: "",
        rfd200: "",
        migratedFrom: "dsi",
      },
    ];
    record.dsi = {
      ...record.dsi,
      source: "imtp",
      force: 2800,
      protocol: "IMTP",
      definition: "gross",
      confirmed: true,
    };
    record.data.landmine = [];
    [20, 25, 30, 35, 40].forEach((load, i) =>
      ["R", "L"].forEach((side) =>
        record.data.landmine.push({
          id: uid(),
          load,
          side,
          velocity: (side === "R"
            ? [3.98, 3.68, 3.29, 2.93, 2.64]
            : [3.72, 3.42, 3.03, 2.75, 2.42])[i],
        }),
      ),
    );
    record.data.squat = [40, 60, 80, 100].map((load, i) => ({
      id: uid(),
      load,
      velocity: [1.02, 0.83, 0.66, 0.43][i],
    }));
    record.data.bench = [20, 35, 50, 65].map((load, i) => ({
      id: uid(),
      load,
      velocity: [1.1, 0.92, 0.66, 0.48][i],
    }));
    record.data.deadlift = [50, 75, 100, 125].map((load, i) => ({
      id: uid(),
      load,
      velocity: [0.89, 0.72, 0.54, 0.39][i],
    }));
    record.lvp.squat.mvt = 0.3;
    record.lvp.bench.mvt = 0.17;
    record.lvp.deadlift.mvt = 0.3;
    record.lvp.squat.zones = [
      { min: 0.3, max: 0.5, label: "自定义 · 重力量区间", color: "#e6eafa" },
      { min: 0.5, max: 0.75, label: "自定义 · 中等负荷区间", color: "#e7f3ed" },
      { min: 0.75, max: 1.1, label: "自定义 · 快速发力区间", color: "#fff0d7" },
    ];
    record.data.pushup = { reps: 66, notes: "规范动作计数" };
    record.data.mb = [
      { id: uid(), side: "D", distance: 11.8 },
      { id: uid(), side: "ND", distance: 10.3 },
    ];
    record.data.lactate = [12, 13, 14, 15, 16, 17, 18].map((speed, i) => ({
      id: uid(),
      speed: speed / 3.6,
      unit: "m/s",
      lactate: [1.1, 1.2, 1.5, 2.1, 3.2, 4.8, 7.1][i],
      hr: [136, 142, 148, 157, 167, 178, 188][i],
    }));
    record.thresholds = {
      lt1: 14 / 3.6,
      lt2: 17 / 3.6,
      unit: "m/s",
      method: "曲线转折点人工确认 · 示例",
    };
    record.data.ift = {
      speed: 22 / 3.6,
      unit: "m/s",
      protocol: "treadmill",
      partial: 12,
    };
    record.data.mas = {
      speed: 17.4 / 3.6,
      unit: "m/s",
      method: "连续递增测试 · 示例",
    };
    record.data.mss = {
      speed: 8.1,
      unit: "m/s",
      method: "飞行20 m计时 · 示例",
    };
    record.data.iso.forEach((r) => {
      if (r.region === "shoulder" && r.directionCode === "externalRotation") {
        r.left = 178;
        r.right = 217;
        r.target = 200;
        r.notes = "坐位、肩中立、固定带 · 示例";
      }
      if (r.region === "knee" && r.directionCode === "extension") {
        r.left = 545;
        r.right = 568;
        r.notes = "膝屈90° · 示例";
      }
      if (r.region === "ankle" && r.directionCode === "dorsiflexion") {
        r.left = 190;
        r.right = 214;
        r.notes = "固定姿势 · 示例";
      }
      if (r.region === "neck" && r.directionCode === "flexion") r.center = 192;
      if (r.region === "hip" && r.directionCode === "abduction") {
        r.left = 310;
        r.right = 322;
        r.notes = "侧卧固定 · 示例";
      }
    });
    record.narrative = {
      html: textToHTML(localText(record)),
      text: localText(record),
      updated: now(),
      basis: fingerprint(record),
      origin: "本地",
      revision: 0,
    };
    return record;
  }
  function enrichDemo(record) {
    record.demoRevision = 2;
    ["dj", "hop", "cmrj", "cpet"].forEach(id => { record.enabled[id] = true; });
    record.data.cmj.forEach((row, index) => Object.assign(row, { propulsiveDurationMs: 300, propulsiveImpulse: [398.47, 403.32, 402.17][index], rsiModified: row.height / 100 / .6 }));
    record.data.sj.forEach(row => { row.rsiModified = row.height / 100 / .7; });
    Object.assign(record.data.imtp[0], { impulse250: 533.05, matchedImpulse: 671.80, matchedDurationMs: 300 });
    record.impulseConfig = { ...record.impulseConfig, confirmed: true };
    record.cmjConfig.impulseDefinition = record.imtpConfig.impulseDefinition = "gross";
    record.data.dj = [[32,200,510.84,27.2],[34,190,526.56,29.1],[33,195,518.76,28.4]].map(([height,contactTimeMs,flightTimeMs,activeStiffness]) => ({ ...newJumpAttempt("dj"), height, contactTimeMs, flightTimeMs, activeStiffness, dropHeightCm:45 }));
    const hop = newHopSet();
    hop.inputMode = "jumps";
    hop.jumps = [[25,175,451.52],[27,172,469.24],[29,169,486.31],[28,173,477.85],[30,168,494.62],[31,166,502.80],[30,167,494.62],[32,164,510.84],[29,170,486.31],[31,165,502.80]].map(([height,contactTimeMs,flightTimeMs]) => ({ id:uid(),height,contactTimeMs,flightTimeMs }));
    hop.summary.activeStiffness = 31.6;
    record.data.hop = { ...record.data.hop, trials:[hop] };
    record.data.cmrj = [{ ...newJumpAttempt("cmrj"), firstHeight:41,firstTimeToTakeoffMs:600,height:30,contactTimeMs:170,flightTimeMs:494.62,activeStiffness:30.4 }];
    record.data.cpet = { ...cpetDefaults(), modality:"treadmill", protocol:"跑台递增 CPET · 模拟示例",oxygenLabel:"VO2peak",vo2:62,peakHr:192,rer:1.14,thresholds:{ first:{...cpetDefaults().thresholds.first,vo2:40,hr:148,speed:14/3.6}, second:{...cpetDefaults().thresholds.second,vo2:51,hr:178,speed:17/3.6} } };
    record.definitions.forEach(definition => {
      const current = extraDefs().find(d => d.id === definition.id);
      if (current && /(?:^|_)rsi(?:_modified)?$/.test(definition.id)) Object.assign(definition, { referenceEnabled:current.referenceEnabled, ranges:clone(current.ranges), source:current.source, protocol:current.protocol });
      if (definition.id === "cpet_vo2_relative") { definition.target = 60; definition.referenceEnabled = true; }
      if (definition.id === "cpet_threshold2_pct") { definition.target = 85; definition.referenceEnabled = true; }
    });
    ["cmj","sj","imtp","dj","hop","cmrj","cpet"].forEach(id => { record.protocol[id] += "；新增数据为模拟演示"; });
    return record;
  }
  function sampleRecord() {
    const record = enrichDemo(legacySampleRecord());
    record.narrative = { html:textToHTML(localText(record)),text:localText(record),updated:now(),basis:fingerprint(record),origin:"本地",revision:0 };
    return record;
  }
  function upgradeOriginalDemo(input, profile) {
    if (!input?.demo || input.demoRevision >= 2 || input.narrative?.origin !== "本地" || (input.narrative?.revision || 0) !== 0) return { record:input, changed:false };
    const candidate = normalizeRecord(input), original = normalizeRecord(legacySampleRecord());
    if (candidate.narrative.html !== original.narrative.html || candidate.narrative.text !== original.narrative.text || Object.keys(input.narrative || {}).some(key => !["html","text","updated","basis","origin","revision"].includes(key))) return { record:input, changed:false };
    const clean = (value, key = "") => {
      if (["id","date","measurementVersion"].includes(key)) return undefined;
      if (Array.isArray(value)) return value.map(item => clean(item));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clean(v,k)]).filter(([,v]) => v !== undefined && v !== "" && v !== null));
      return value;
    };
    // Compare every original measurement and identity/context field. Added tests must be empty.
    const originalTests = entries => Object.fromEntries(Object.entries(entries).filter(([id]) => !["dj","hop","cmrj","cpet"].includes(id)));
    const core = record => ({ athlete:clean(record.athlete), data:clean(originalTests(record.data)), enabled:originalTests(record.enabled), protocol:originalTests(record.protocol), mode:record.mode, dsi:record.dsi, thresholds:record.thresholds, trainingContext:record.trainingContext, customValues:record.customValues, customTests:record.customTests, rules:record.rules, axes:record.axes, lvp:record.lvp, cmjConfig:record.cmjConfig, imtpConfig:record.imtpConfig, impulseConfig:record.impulseConfig });
    if (canonicalJSON(core(candidate)) !== canonicalJSON(core(original))) return { record:input, changed:false };
    const effective = profile && root.RingsideEvaluation ? root.RingsideEvaluation.resolve(candidate,profile) : candidate;
    if (canonicalJSON(core(effective)) !== canonicalJSON(core(original))) return { record:input, changed:false };
    const definitionProjection = definition => {
      const { context,referenceMatch,...value } = definition;
      if (!value.legacyManual) ["name","protocol"].forEach(key => { value[key] = Def.factoryText(value.id,key,value[key]); });
      if (/(?:^|_)rsi(?:_modified)?$/.test(value.id) && value.target == null && value.ranges.length === 0 && value.source === "用户配置评价标准" && value.protocol === "使用实际测试协议与匹配评价标准") {
        const current = original.definitions.find(d => d.id === value.id);
        if (current) return { ...value, ranges:current.ranges,source:current.source,protocol:current.protocol };
      }
      return value;
    };
    const existingDefinitions = definitions => definitions.filter(d => d.testId !== "cpet" && d.id !== "rqr" && !d.id.endsWith("_active_stiffness")).map(definitionProjection).sort((a,b) => a.id.localeCompare(b.id));
    if (canonicalJSON(existingDefinitions(effective.definitions)) !== canonicalJSON(existingDefinitions(original.definitions))) return { record:input, changed:false };
    const additionalDefinitions = effective.definitions.filter(d => d.testId === "cpet" || d.id === "rqr" || d.id.endsWith("_active_stiffness"));
    const latest = extraDefs();
    if (additionalDefinitions.some(d => canonicalJSON(definitionProjection(d)) !== canonicalJSON(definitionProjection(latest.find(current => current.id === d.id) || {})))) return { record:input, changed:false };
    const hasValue = value => {
      if (Array.isArray(value)) return value.some(hasValue);
      if (value && typeof value === "object") return Object.entries(value).some(([key,v]) => !["id","inputMode","selectionBasis","label","vo2Unit","oxygenLabel","measurementVersion"].includes(key) && hasValue(v));
      return value !== "" && value !== null && value !== undefined && value !== false;
    };
    if (["dj","hop","cmrj","cpet"].some(id => hasValue(candidate.data[id]))) return { record:input, changed:false };
    const record = enrichDemo(candidate);
    // Existing prose is retained; only untouched factory samples receive measurements.
    return { record, changed:true };
  }
  root.RingsideModel = {
    TESTS,
    FM,
    REG,
    defaults,
    sampleRecord,
    upgradeOriginalDemo,
    cpetDefaults,
    cpetSummary,
    normalizeRecord,
    normalizeIMTP,
    syncIMTPLegacy,
    imtpTimeContext,
    forceTime,
    stats,
    fvpAnalysis,
    grade,
    attainment,
    unitFactor,
    changeMetricUnit,
    targetStatus,
    evaluation,
    isoRows,
    normalizeIsoDirection,
    migrateBalancePair,
    effectiveIsoTarget,
    legacyIsoDirectionIds,
    isoDirectionCatalog,
    selectedIsoRows,
    setIsoDirectionSelection,
    validateIsoDirectionIds,
    isoSideLabels,
    isoRadar,
    jumpSummary,
    hopSummary,
    hopSetSummary,
    newJumpAttempt,
    newHopSet,
    repeatRows,
    ensureRepeatRows,
    repeatAnalysis,
    extraDefs,
    groupPoints,
    fingerprint,
    fingerprintWithoutAge,
    fingerprintMatchesExceptAge,
    sanitizeHTML,
    textToHTML,
    htmlToText,
    libraryDefaults,
    normalizeLibrary,
    recordEnvelope,
    validateRecord,
    validateIMTPTimeStandards,
    validateLibrary,
    validateCatalog,
    validateField,
    diagnoseRules,
    repairRules,
    profileFromRecord,
    ageAtDate,
    applyAge,
    competitionContext,
    validateAthleteProfile,
    validateAthleteContext,
    hasMeaningfulHopSet,
    latestRecord,
    normalizeCatalog,
    mergeCatalog,
    recordFromCatalog,
    recordProgressDetail,
    localText,
    positive,
    nonnegative,
    speedMS,
  };
})(typeof window !== "undefined" ? window : globalThis);
