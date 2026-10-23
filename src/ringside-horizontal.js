(function (root) {
  "use strict";
  const C = root.RingsideComparison, M = root.RingsideModel, E = root.RingsideEvaluation, T = root.RingsideTests;
  const N = value => root.Calc.num(value), clone = value => JSON.parse(JSON.stringify(value));
  const sex = value => ({ male: "男", female: "女", any: "" })[value] ?? value ?? "";
  const chronology = (a, b) => a.date.localeCompare(b.date) || String(a.source.created || "").localeCompare(String(b.source.created || "")) || a.id.localeCompare(b.id);
  const finite = cell => !!cell && N(cell.value) !== null;
  function normalizeWindow(input) {
    if (!input || !["all", "recent7", "recent14", "recent30", "recent90", "recent12", "custom"].includes(input.kind)) throw Error("请明确选择群体数据的日期范围");
    const from = input.from || null, to = input.to || null;
    if (input.kind !== "all" && (!C.validDate(from) || !C.validDate(to)) || from && !C.validDate(from) || to && !C.validDate(to) || from && to && from > to) throw Error("群体数据的起止日期无效");
    return { kind: input.kind, from, to };
  }
  function normalizeReference(input) {
    if (!input?.id || !["all", "sport", "team"].includes(input.scope || "all")) throw Error("群体参照范围无效");
    if (input.scope === "sport" && !input.sportId || input.scope === "team" && !input.teamId) throw Error("请选择参照专项或队伍");
    const result = { ...clone(input), label: input.label || "群体参照", scope: input.scope || "all", sampling: input.sampling || "latest" };
    if (!["latest", "period-record", "period-mean"].includes(result.sampling)) throw Error("群体取样方式无效");
    if (result.window) result.window = normalizeWindow(result.window);
    if (result.subdivisionId && !result.sportId) throw Error("细分类参照须同时指定所属专项");
    if (result.ageBandId && (result.ageMin == null || result.ageMax == null)) throw Error("年龄段须保存明确的周岁上下限");
    for (const key of ["ageMin", "ageMax"]) if (result[key] != null && (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > 150)) throw Error("年龄范围须为有效整数周岁");
    if (result.ageMin != null && result.ageMax != null && result.ageMin > result.ageMax) throw Error("年龄范围上下限无效");
    return result;
  }
  function membership(athlete, reference) {
    if (!athlete || athlete.deleted || athlete.deletedAt || athlete.demo || athlete.sample) return false;
    const profile = athlete.profile || {};
    if (reference.sex && sex(reference.sex) !== sex(profile.sex)) return false;
    if (reference.sportId && reference.sportId !== profile.sportId) return false;
    if (reference.subdivisionId && reference.subdivisionId !== profile.subdivisionId) return false;
    return !reference.teamId || reference.teamId === athlete.groupId;
  }
  function recordEligible(period, reference, window) {
    if (window.from && period.date < window.from || window.to && period.date > window.to) return "date";
    const age = N(period.record.athlete.age);
    if ((reference.ageMin != null || reference.ageMax != null) && (age === null || reference.ageMin != null && age < reference.ageMin || reference.ageMax != null && age > reference.ageMax)) return "age";
    return "";
  }
  function hydrate(source, options) {
    const period = C.prepareRecord(source, options); period.source = source;
    period.layers = { tests: C.observations(period) };
    const overview = C.radar([period], "overview"), risk = C.radar([period], "risk"), capability = C.capability([period]);
    period.layers.overview = new Map(overview.rows.map(row => [row.id, row.cells[0]]));
    period.layers.risk = new Map(risk.rows.map(row => [row.id, row.cells[0]]));
    period.layers.capability = new Map(capability.cards.flatMap(card => card.metrics.map(row => [card.id + ":" + row.id, { ...row.cells[0], metricId: row.metricId, testId: row.testId || row.cells[0]?.displayDefinition?.testId }])));
    period.capabilityCards = capability.cards.map(card => ({ id: card.id, title: card.title }));
    period.sourceFingerprint = C.contentHash(M.fingerprint(period.record));
    period.horizontalCells = new Map();
    return period;
  }
  function projectsFor(template, period) {
    if (template.context?.protocols?.length) return template.context.protocols.map(item => item.testId);
    if (template.testId) return [template.testId];
    const derived = T.derivedDefinitions().find(d => d.id === (template.metricId || template.id));
    if (derived) return derived.dependencies;
    const ids = template.context?.members || [];
    return [...new Set(ids.map(id => period.source.definitions.find(d => "metric:" + d.id === id || d.id === id)?.testId).filter(Boolean))];
  }
  function hasProject(period, template) {
    const projects = projectsFor(template, period);
    return projects.length ? projects.some(id => period.stats.validTests.has(id) || [...period.layers.tests.values()].some(cell => cell.testId === id && (finite(cell) || cell.pain))) : period.stats.validTests.size > 0;
  }
  function comparableCell(period, layer, key, template, catalog, unit) {
    const cacheKey = layer + "|" + key + "|" + unit;
    if (period.horizontalCells.has(cacheKey)) return period.horizontalCells.get(cacheKey);
    let cell = period.layers[layer].get(key);
    if (!cell && layer === "tests" && template.definition) {
      const definition = period.record.definitions.find(d => d.id === template.metricId);
      if (definition) cell = { ...template, value: null, rawValue: null, rawTrials: [], statistics: null, definition,
        unit: definition.unit, context: C.metricContext(period.record, definition, period.stats) };
      else if (template.testId) {
        // A metric removed from a newer otherwise compatible project is missing,
        // not an invitation to retrieve an older personal result.
        cell = { ...template, value: null, rawValue: null, rawTrials: [], statistics: null, context: C.metricContext(period.record, template.definition, period.stats) };
      }
    }
    if (!cell && layer === "capability") {
      const definition = period.record.definitions.find(d => d.id === template.metricId), context = clone(template.context || {});
      const dependencies = C.derivedContext(period.record, context.selectedVariant || template.metricId, period.stats);
      if (context.protocols) context.protocols = context.protocols.map(item => ({ testId: item.testId, ...C.testContext(period.record, item.testId, period.stats) }));
      if (context.test && template.testId) context.test = definition ? C.metricContext(period.record, definition, period.stats) : C.testContext(period.record, template.testId, period.stats);
      Object.assign(context, dependencies);
      cell = { ...template, value: null, rawValue: null, rawTrials: [], statistics: null, context };
    }
    const result = cell ? C.horizontalCell(cell, period, catalog, unit) : null;
    period.horizontalCells.set(cacheKey, result); return result;
  }
  function aggregateAssessment(value, standard) {
    const empty = { status: "gray", label: "", range: null };
    if (N(value) === null || !standard || !standard.enabled || !standard.applicable) return empty;
    if (standard.kind === "fixed-fms") return M.fixedFmsAssessment(value);
    if (standard.kind === "asymmetry") {
      const status = value >= standard.rules.asymRed ? "red" : value >= standard.rules.asymAmber ? "amber" : "green";
      return { status, label: root.Def.assessmentLabel(status), range: null };
    }
    if (standard.kind === "iso") {
      const referenceComparison = root.RingsideIsoReferences?.comparison(value, { target: standard.target, kind: standard.targetKind, matched: standard.applicable, basis: standard.referenceBasis });
      const result = M.isoStrengthAssessment(value, standard.target, { targetKind: standard.targetKind, unit: standard.unit, referenceComparison });
      return { ...result, label: root.Def.assessmentLabel(result.status, ""), range: null };
    }
    const definition = { ...standard, referenceEnabled: standard.enabled, ranges: standard.ranges || [] };
    return standard.kind === "balance" ? M.grade(value, definition) : M.evaluation(value, definition, { rules: standard.rules });
  }
  function emptyGroupBenchmark() {
    return { n: 0, mean: null, best: null, sd: null, min: null, max: null, contributors: [], bestSources: [], distribution: [], sampling: "aggregate", samplingLabel: "群体代表水平", evaluationState: "unconfigured", assessment: { status: "gray", label: "" } };
  }
  function aggregateEvidence(members) {
    const people = new Map();
    for (const member of members) for (const person of member.benchmark?.contributors || []) {
      if (!people.has(person.athleteId)) people.set(person.athleteId, { athleteId: person.athleteId, name: person.name, value: null, sources: [] });
      const entry = people.get(person.athleteId);
      for (const source of person.sources || [{ recordId: person.recordId, date: person.date, value: person.value }]) if (!entry.sources.some(existing => existing.recordId === source.recordId && existing.metricId === member.id)) entry.sources.push({ ...source, metricId: member.id, unit: member.unit });
    }
    return { n: people.size, contributors: [...people.values()] };
  }
  function commonStandard(chosen, reference, metricKey) {
    if (!chosen.length) return { standard: null, conflict: null };
    const candidates = new Map();
    for (const person of chosen) for (const source of person.sources) {
      const standard = source.resolvedStandard || null, id = C.contentHash(E.canonical(effectiveStandard(standard)));
      if (!candidates.has(id)) candidates.set(id, { id, standard, sourceAthleteId: person.athleteId, sourceRecordId: source.recordId });
    }
    const list = [...candidates.values()], override = reference.evaluationOverrides?.[metricKey];
    const selected = override?.standard ? list.find(item => E.canonical(item.standard) === E.canonical(override.standard)) : override?.candidateId ? list.find(item => item.id === override.candidateId) : null;
    if (selected?.standard?.enabled && selected.standard.applicable) return { standard: clone(selected.standard), conflict: null, overridden: true };
    if (override) {
      const standard = override.standard, reason = validateCommonStandard(standard, list.map(item => item.standard));
      return reason ? { standard: null, conflict: { metricKey, reason, candidates: list } } : { standard: clone(standard), conflict: null, overridden: true };
    }
    const applicable = list.filter(item => item.standard?.enabled && item.standard.applicable);
    const inapplicable = list.filter(item => item.standard?.ruleEnabled && (!item.standard.applicable || item.standard.applicabilityReason));
    if (applicable.length > 1 || applicable.length && inapplicable.length) return { standard: null, conflict: { metricKey, reason: "群体结果适用的评价标准不同", candidates: [...applicable, ...inapplicable] } };
    // A standard applicable to only some contributors cannot silently become a
    // common rule. Missing/unconfigured standards alone do not block a report.
    return { standard: applicable.length === 1 && applicable.length === list.length ? applicable[0].standard : null, conflict: null };
  }
  function effectiveStandard(standard) {
    if (!standard?.enabled || !standard.applicable) return standard ? { kind: standard.kind, subjectId: standard.subjectId, unit: standard.unit, ruleEnabled: standard.ruleEnabled, applicable: standard.applicable, reason: standard.applicabilityReason } : null;
    const keys = ["kind", "subjectId", "unit", "target", "targetEnabled", "ranges", "direction", "measurementScale", "zeroValid"];
    const value = Object.fromEntries(keys.filter(key => standard[key] !== undefined).map(key => [key, standard[key]]));
    if (standard.kind === "asymmetry") value.rules = { asymAmber: standard.rules.asymAmber, asymRed: standard.rules.asymRed };
    if (standard.kind === "metric" && !standard.ranges?.length) value.rules = { scoreAmber: standard.rules.scoreAmber, scoreGreen: standard.rules.scoreGreen };
    return value;
  }
  function validateCommonStandard(standard, candidates) {
    if (!standard || !candidates.some(candidate => candidate && ["kind", "subjectId", "unit"].every(key => candidate[key] === standard[key]))) return "统一标准须用于相同指标和单位";
    if (standard.configured !== true || standard.configurationVersion !== 1) return "所选统一标准已不在当前结果中";
    if (!standard.enabled || !standard.applicable) return "请启用并配置适用于群体的统一标准";
    if (["fixed-fms", "asymmetry"].includes(standard.kind)) return "固定评分规则不可在此更改";
    if (standard.target != null && (N(standard.target) === null || N(standard.target) <= 0)) return "统一评价目标须为正数";
    if (standard.kind === "iso" || standard.targetEnabled !== false && !standard.ranges?.length) {
      if (N(standard.target) === null || N(standard.target) <= 0) return "统一评价目标须为正数";
    }
    if (standard.kind === "metric" && !standard.ranges?.length && standard.targetEnabled !== false && !["higher", "lower"].includes(standard.direction)) return "统一标准的评价方向无效";
    const ranges = standard.ranges || [];
    try { root.RingsideScoring.validateIntervals(ranges); } catch (error) { return error.message; }
    if (standard.kind === "balance" && !ranges.length) return "请配置关节平衡的统一评价区间";
    return "";
  }
  function summarize(people, template, contextKey, layer, key, reference, catalog, unit, metricKey = key) {
    const scalar = ["tests", "capability"].includes(layer), averaging = scalar && (template.meaning === "numeric" || template.aggregation?.mean === true);
    const directional = scalar && template.meaning !== "category" && ["higher", "lower"].includes(template.semantics.direction);
    const sampling = reference.sampling === "period-mean" && averaging ? "period-mean" : reference.sampling === "period-record" && directional ? "period-record" : "latest";
    const chosen = [], exclusions = { protocol: 0, missing: 0 };
    for (const [athleteId, periods] of people) {
      const eligible = [];
      for (const period of periods) {
        if (!hasProject(period, template)) continue;
        const cell = comparableCell(period, layer, key, template, catalog, unit);
        if (!cell || cell.contextKey !== contextKey) { exclusions.protocol++; continue; }
        eligible.push({ period, cell });
      }
      eligible.sort((a, b) => chronology(a.period, b.period));
      let selected, selectedSources;
      if (sampling === "latest") { selected = eligible.at(-1); selectedSources = selected ? [selected] : []; }
      else if (sampling === "period-mean") { selectedSources = eligible.filter(item => finite(item.cell)); selected = selectedSources.at(-1); }
      else { selected = eligible.filter(item => finite(item.cell)).reduce((best, item) => !best || (template.semantics.direction === "higher" ? item.cell.value >= best.cell.value : item.cell.value <= best.cell.value) ? item : best, null); selectedSources = selected ? [selected] : []; }
      if (!selected || !finite(selected.cell)) { exclusions.missing++; continue; }
      const { period, cell } = selected;
      const value = sampling === "period-mean" ? root.Calc.descriptive(selectedSources.map(item => item.cell.value), false).mean : cell.value;
      chosen.push({ athleteId, name: period.person?.profile?.name || period.record.athlete.name || athleteId,
        ...(sampling === "period-mean" ? {} : { recordId: period.id, date: period.date, sourceFingerprint: period.sourceFingerprint }),
        value, unit: cell.unit, context: cell.comparisonContext, subjectInputs: sampling === "period-mean" ? null : cell.subjectInputs, statistics: sampling === "period-mean" ? null : cell.statistics,
        recordCount: selectedSources.length, dateRange: { from: selectedSources[0].period.date, to: selectedSources.at(-1).period.date }, effectiveSampling: sampling,
        sources: selectedSources.map(({ period: source, cell: observation }) => ({ recordId: source.id, date: source.date, value: observation.value, unit: observation.unit, mode: source.record.mode,
          context: observation.comparisonContext, subjectInputs: observation.subjectInputs, statistics: observation.statistics || null, testedAge: N(source.record.athlete.age), sourceKind: observation.sourceKind || "observed", pain: !!observation.pain,
          sourceFingerprint: source.sourceFingerprint, resolvedStandard: observation.resolvedStandard || null })),
        representativeMode: period.record.mode, profile: { sex: period.person?.profile?.sex || "", sportId: period.person?.profile?.sportId || "", subdivisionId: period.person?.profile?.subdivisionId || "", teamId: period.person?.groupId || "", testedAge: N(period.record.athlete.age) },
        ...(sampling === "period-mean" ? {} : { pain: !!cell.pain }), ...(cell.sourceKind ? { sourceKind: cell.sourceKind } : {}) });
    }
    chosen.sort((a, b) => a.athleteId.localeCompare(b.athleteId));
    const numeric = averaging, values = chosen.map(item => item.value), stats = root.Calc.descriptive(values, false);
    const best = directional && values.length ? (template.semantics.direction === "higher" ? Math.max(...values) : Math.min(...values)) : null;
    const distribution = [...new Set(values)].sort((a, b) => a - b).map(value => ({ value, count: values.filter(item => item === value).length }));
    const resolved = commonStandard(chosen, reference, metricKey), mean = numeric ? stats.mean : null, assessment = aggregateAssessment(mean, resolved.standard), bestAssessment = aggregateAssessment(best, resolved.standard);
    const evaluationState = resolved.conflict ? "conflict" : N(mean) === null ? "missing" : ["red", "amber", "green"].includes(assessment.status) ? "evaluated" : "unconfigured";
    return { sampling, samplingLabel: sampling === "period-record" ? "期间最佳成绩" : sampling === "period-mean" ? "期间均值" : "最近测试", n: chosen.length, eligibleAthletes: people.size,
      mean: numeric ? stats.mean : null, sd: numeric ? stats.sd : null, best, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
      distribution: numeric ? [] : distribution, contributors: chosen, bestSources: best === null ? [] : chosen.filter(item => item.value === best).map(item => ({ athleteId: item.athleteId, name: item.name,
        ...(item.recordId ? { recordId: item.recordId, date: item.date } : {}), value: item.value, recordCount: item.recordCount, dateRange: item.dateRange, effectiveSampling: item.effectiveSampling, sources: item.sources })),
      assessment, bestAssessment, evaluationState, evaluationConflict: resolved.conflict, resolvedStandard: resolved.standard,
      display: { state: evaluationState === "evaluated" ? "graded" : "observed", visible: evaluationState === "evaluated", status: assessment.status, label: evaluationState === "evaluated" ? root.Def.trafficLabel(assessment.status, assessment.label) : "" },
      excludedCount: exclusions.protocol + exclusions.missing, exclusions, meanLabel: sampling === "period-record" ? "期间最佳成绩的群体均值" : sampling === "period-mean" ? "期间均值的群体均值" : "最近测试均值",
      reason: chosen.length ? "" : "没有符合条件的有效结果" };
  }
  function matrix(direct, candidates, layer, reference, catalog, focusIndex) {
    const discovery = reference ? [...new Map([...direct, ...[...candidates.values()].flat()].map(period => [period.id, period])).values()] : direct;
    const keys = [...new Set(discovery.flatMap(period => [...period.layers[layer].keys()]))], rows = [];
    for (const key of keys) {
      const exemplar = discovery.map(period => period.layers[layer].get(key)).find(Boolean), unit = exemplar.unit || "";
      const cells = direct.map(period => comparableCell(period, layer, key, exemplar, catalog, unit));
      const templates = discovery.map(period => comparableCell(period, layer, key, exemplar, catalog, unit)).filter(Boolean);
      const contexts = [...new Set(templates.map(cell => cell.contextKey))];
      for (const contextKey of contexts) {
        const template = templates.find(cell => cell.contextKey === contextKey), matching = cells.map(cell => cell?.contextKey === contextKey ? cell : null), id = key + (contexts.length > 1 ? ":" + C.contentHash(contextKey).slice(-8) : "");
        const benchmark = reference ? ["tests", "capability"].includes(layer) ? summarize(candidates, template, contextKey, layer, key, reference, catalog, unit, id) : emptyGroupBenchmark() : null;
        const row = { id, metricId: exemplar.metricId || exemplar.id || key,
          subjectId: exemplar.subjectId || exemplar.id || key, testId: exemplar.testId, name: exemplar.name, unit: template.unit, measurementScale: exemplar.measurementScale || "unknown",
          meaning: template.meaning, direction: template.direction, semantics: template.semantics, aggregation: template.aggregation || null, contextKey, context: template.comparisonContext,
          ...(contexts.length > 1 ? { contextLabel: "测量条件 " + (contexts.indexOf(contextKey) + 1) } : {}),
          ...Object.fromEntries(["section", "sourceKind", "groupName", "region", "directionId", "pairId", "parentId"].filter(field => exemplar[field] !== undefined).map(field => [field, exemplar[field]])),
          cells: matching, benchmark,
          differences: matching.map(cell => !cell ? { available: false, reason: "测量条件不同或缺测" } : template.meaning === "category" ? { available: false, reason: "类别结果比较分布" } : C.difference(cell.value, benchmark ? benchmark.mean : matching[focusIndex]?.value, exemplar.measurementScale, template.unit)) };
        rows.push(row);
      }
    }
    return rows;
  }
  function sections(direct, candidates, reference, catalog, focusIndex) {
    const testRows = matrix(direct, candidates, "tests", reference, catalog, focusIndex), descriptors = new Map();
    const discovery = reference ? [...new Map([...direct, ...[...candidates.values()].flat()].map(period => [period.id, period])).values()] : direct;
    for (const period of discovery) for (const project of period.report.projects) if (!descriptors.has(project.id)) descriptors.set(project.id, project);
    const projects = [...descriptors.values()].map(project => ({ id: project.id, name: project.name, renderer: project.renderer, testIds: project.testIds, category: project.category, primaryAbility: project.primaryAbility,
      metrics: testRows.filter(row => row.testId === project.id) })).filter(project => project.metrics.length);
    const makeRadar = kind => {
      const rows = matrix(direct, candidates, kind, reference, catalog, focusIndex);
      return { axes: rows.map(row => ({ key: row.id, label: row.name })), rows,
        series: direct.map((period, index) => ({ id: period.id, recordId: period.id, label: period.label, color: period.color, values: rows.map(row => row.cells[index]?.value ?? null), cells: rows.map(row => row.cells[index]) })),
        benchmark: { label: "群体代表水平", values: rows.map(() => null), counts: rows.map(row => row.benchmark?.n || 0) } };
    };
    const capabilityRows = matrix(direct, candidates, "capability", reference, catalog, focusIndex), cards = new Map(discovery.flatMap(period => period.capabilityCards.map(card => [card.id, card])));
    const result = { projects, overview: makeRadar("overview"), risk: makeRadar("risk"), capability: { cards: [...cards.values()].map(card => ({ ...card, metrics: capabilityRows.filter(row => row.id.startsWith(card.id + ":")) })) } };
    if (reference) rebuildGroupOverview(result, discovery, reference);
    return result;
  }
  function rebuildGroupOverview(result, periods, reference) {
    const rows = result.projects.flatMap(project => project.metrics), riskRanks = { red: 1, amber: 2, green: 3 };
    const availableAbilities = new Set(periods.flatMap(period => period.record.definitions.filter(definition => definition.category === "performance" && definition.scoring !== false).map(definition => T.abilityName(definition.ability)).filter(Boolean)));
    for (const ability of availableAbilities) {
      if (result.overview.rows.some(row => row.subjectId === ability)) continue;
      const owner = periods.find(period => T.axisConfig(period.record, ability)), config = owner && T.axisConfig(owner.record, ability);
      if (!config || !["primary", "mean"].includes(config.method)) continue;
      const context = { members: config.method === "primary" ? [config.primary] : config.members, method: config.method, transforms: config.transforms || {} };
      result.overview.rows.push({ id: ability, metricId: ability, subjectId: ability, name: T.abilityLabel(owner.record, ability), unit: "分", measurementScale: "interval", meaning: "numeric", direction: "none", context, contextKey: E.canonical({ context, unit: "分", scale: "interval", meaning: "numeric" }), cells: result.overview.series.map(() => null), differences: [], benchmark: emptyGroupBenchmark() });
      result.overview.series.forEach(series => { series.values.push(null); series.cells.push(null); });
    }
    result.overview.axes = result.overview.rows.map(row => ({ key: row.id, label: row.name }));
    for (const row of result.overview.rows) {
      const sourceConfig = periods.map(period => T.axisConfig(period.record, row.subjectId)).find(config => config && (!row.context?.method || config.method === row.context.method));
      const config = sourceConfig && { ...sourceConfig, ...(row.context?.method ? { method: row.context.method, members: row.context.members, primary: row.context.members?.[0], transforms: row.context.transforms || {} } : {}) }, ids = config?.method === "primary" ? [config.primary] : config?.members;
      if (!config || !["primary", "mean"].includes(config.method) || !ids?.length) continue;
      const members = ids.map(id => { const matching = rows.filter(item => item.subjectId === id || item.metricId === String(id).replace(/^metric:/, "")); return matching.length === 1 ? matching[0] : null; });
      if (members.some(item => !item?.benchmark || N(item.benchmark.mean) === null || item.benchmark.evaluationConflict)) continue;
      const scored = members.map((member, index) => {
        const standard = member.benchmark.resolvedStandard;
        if (!standard) return { valid: false };
        const transform = config.transforms?.[ids[index]] || (config.method === "primary" ? { kind: "ratio", direction: standard.direction || "higher" } : null);
        return root.RingsideScoring.evaluate(member.benchmark.mean, transform, { target: standard.target, targetEnabled: standard.enabled && standard.targetEnabled !== false,
          applicable: standard.applicable, subject: { measurementScale: standard.measurementScale || member.measurementScale, zeroValid: standard.zeroValid } });
      });
      if (scored.some(score => !score.valid)) continue;
      const aggregate = M.abilityScoreSummary(config, scored.map(score => score.score), members[0].benchmark.assessment);
      const assessment = { status: aggregate.status, label: root.Def.assessmentLabel(aggregate.status, ""), range: null };
      Object.assign(row.benchmark, aggregateEvidence(members), { mean: aggregate.value, score: aggregate.value, assessment, evaluationState: "evaluated", display: { visible: ["red", "amber", "green"].includes(assessment.status), status: assessment.status, label: root.Def.trafficLabel(assessment.status, "") }, members: members.map(member => ({ id: member.id, value: member.benchmark.mean, n: member.benchmark.n })) });
    }
    const isoRisks = new Map(), unlocalized = [];
    for (const asym of rows.filter(item => item.section === "asymmetry" && N(item.benchmark?.mean) !== null)) {
      const forces = rows.filter(item => item.section === "force" && item.directionId === asym.directionId && (() => { const context = { ...item.context }; delete context.side; return E.contextSignature(context) === E.contextSignature(asym.context); })());
      const left = forces.find(item => item.context.side === "L")?.benchmark.mean, right = forces.find(item => item.context.side === "R")?.benchmark.mean;
      const weakSide = N(left) !== null && N(right) !== null && left !== right ? left < right ? "L" : "R" : "", strongSide = weakSide === "L" ? "R" : weakSide === "R" ? "L" : "";
      for (const force of forces) isoRisks.set(force.id, { ...M.isoSideAssessment(force.benchmark.assessment, { side: force.context.side, weakSide, strongSide, asym: asym.benchmark.mean, asymStatus: asym.benchmark.assessment.status }), evidence: force.context.side === weakSide ? asym : null });
      if (!weakSide && ["red", "amber"].includes(asym.benchmark.assessment.status)) unlocalized.push(asym);
    }
    for (const region of new Set(unlocalized.map(row => row.region))) if (!result.risk.rows.some(row => row.subjectId === region)) {
      const context = { region, bilateral: true };
      result.risk.rows.push({ id: "joint:" + region, metricId: region, subjectId: region, name: M.REG[region] || region, unit: "等级", measurementScale: "ordinal", meaning: "ordinal", direction: "none", context, contextKey: E.canonical(context), cells: result.risk.series.map(() => null), differences: [], benchmark: emptyGroupBenchmark() });
      result.risk.series.forEach(series => { series.values.push(null); series.cells.push(null); });
    }
    result.risk.axes = result.risk.rows.map(row => ({ key: row.id, label: row.name }));
    for (const row of result.risk.rows) {
      const observations = (row.context?.measurementCoverage ? JSON.parse(row.context.measurementCoverage) : []).map(item => item.id);
      const matching = rows.filter(item => {
        if (item.testId === "iso") {
          const side = item.context?.side, region = item.region + (side === "L" ? "_l" : side === "R" ? "_r" : "");
          return item.section !== "asymmetry" && region === row.subjectId || unlocalized.includes(item) && item.region === row.subjectId;
        }
        return item.region === row.subjectId || observations.includes(item.metricId) || observations.includes(item.id);
      });
      const tests = matching.map(item => ({ id: item.id, testId: item.testId, name: item.name, unit: item.unit, value: item.benchmark?.mean, hasMeasured: N(item.benchmark?.mean) !== null,
        status: isoRisks.get(item.id)?.status || item.benchmark?.assessment?.status || "gray", reasons: isoRisks.get(item.id)?.reasons || [] }));
      const assessment = M.regionalAssessment(tests), value = riskRanks[assessment.status] ?? null;
      Object.assign(row.benchmark, aggregateEvidence([...matching, ...matching.map(item => isoRisks.get(item.id)?.evidence).filter(Boolean)]), { mean: value, score: value, assessment, evaluationState: value === null ? "unconfigured" : "evaluated", display: { visible: value !== null, status: assessment.status, label: root.Def.trafficLabel(assessment.status, "") }, members: tests });
    }
    for (const kind of ["overview", "risk"]) {
      const radar = result[kind];
      radar.benchmark = { label: reference.label + " · 群体代表水平", values: radar.rows.map(row => row.benchmark?.score ?? null), counts: radar.rows.map(row => row.benchmark?.n || 0) };
    }
    result.aggregateRiskRegions = Object.fromEntries(result.risk.rows.map(row => [row.subjectId, { ...row.benchmark.assessment, hasMeasured: row.benchmark.members?.some(item => item.hasMeasured) || false, tests: row.benchmark.members || [], detail: "", reasons: [] }]));
    result.aggregateOverviewAxes = result.overview.rows.filter(row => N(row.benchmark.score) !== null).map(row => ({ key: row.subjectId, label: row.name, value: row.benchmark.score, status: row.benchmark.assessment.status, scoreUnit: "分", scoreMax: 100, members: row.benchmark.members?.map(item => item.id) || [] }));
    result.aggregateFigures = {};
    const fms = rows.filter(row => row.testId === "fms" && row.aggregation?.evaluator === "fixed-fms");
    if (fms.length) result.aggregateFigures.fms = [{ kind: "radar", chartId: "group:" + reference.id + ":fms", title: "FMS 动作表现", max: 3, fms: true,
      axes: fms.map(row => ({ key: row.id, label: T.fmsAbilities[Number(row.subjectId.split(":")[1])] || row.name })), series: [{ id: reference.id, label: reference.label, color: "#65717c", values: fms.map(row => row.benchmark.mean) }] }];
    const isoRows = rows.filter(row => row.testId === "iso"), directions = [...new Set(isoRows.map(row => row.directionId).filter(Boolean))];
    const iso = directions.map(id => {
      const force = isoRows.filter(row => row.directionId === id && row.section === "force"), asym = isoRows.find(row => row.directionId === id && row.section === "asymmetry");
      const contexts = new Set(force.map(row => { const context = { ...row.context }; delete context.side; return E.contextSignature(context); }));
      if (contexts.size !== 1) return null;
      return { id, region: force[0]?.region, direction: force[0]?.name || id, paired: force.some(row => row.context.side),
        left: force.find(row => row.context.side === "L")?.benchmark.mean ?? null, right: force.find(row => row.context.side === "R")?.benchmark.mean ?? null,
        center: force.find(row => !row.context.side)?.benchmark.mean ?? null, asym: asym?.benchmark.mean ?? null,
        sides: force.map(row => ({ value: row.benchmark.mean, target: row.benchmark.evaluationConflict ? null : row.benchmark.resolvedStandard?.target ?? null, pain: false })) };
    }).filter(row => row?.region);
    if (iso.length) {
      const radar = M.isoRadar(iso, { isoDirectionIds: directions });
      result.isoRadar = radar;
      result.aggregateFigures.iso = [{ kind: "radar", chartId: "group:" + reference.id + ":iso", title: "等长力量 · 力量水平与双侧对称性", tickSuffix: "%", max: radar.max, dynamicRadarMax: true,
        axes: radar.axes.map(axis => ({ key: axis.id, label: axis.label })), series: [["strength", "力量水平"], ["symmetry", "双侧对称性"]].map(([key, label]) => ({ id: reference.id + ":" + key, label: reference.label + " · " + label, color: "#65717c", dash: key === "symmetry" ? "5 3" : "", values: radar.axes.map(axis => axis[key]) })) }];
    }
  }
  // Both public entry points drive this exact pipeline. Yield only after a
  // complete unique record has been prepared; no partial model is exposed.
  function* buildSteps(input, options = {}) {
    if (!Array.isArray(input)) throw Error("横向比较需要完整测试记录");
    const requested = options.participants || [], references = (options.references || []).map(normalizeReference);
    if (!references.length && requested.length < 2) throw Error("请选择至少两名运动员，或一个群体参照");
    if (new Set(requested.map(item => item.athleteId)).size !== requested.length) throw Error("每名直接对比运动员只能选择一次测试");
    if (new Set(references.map(item => item.id)).size !== references.length) throw Error("群体参照编号重复");
    const window = options.window ? normalizeWindow(options.window) : { kind: "all", from: null, to: null }, mode = options.mode || "best";
    references.forEach(reference => { reference.window = normalizeWindow(reference.window || window); });
    if (!["best", "mean"].includes(mode)) throw Error("个人代表成绩口径无效");
    const sources = new Map();
    for (const record of input) { if (!record?.recordId || !record.athleteId) continue; if (sources.has(record.recordId)) throw Error("测试记录编号重复"); sources.set(record.recordId, record); }
    const athletes = new Map((options.athletes || []).map(athlete => [athlete.id, athlete]));
    if (!athletes.size) for (const record of input) if (!athletes.has(record.athleteId)) athletes.set(record.athleteId, { id: record.athleteId, profile: clone(record.athlete) });
    const catalog = options.catalog ? clone(options.catalog) : null, profile = options.profile ? clone(options.profile) : null, periods = new Map();
    function* prepare(source) {
      if (!periods.has(source.recordId)) {
        const person = athletes.get(source.athleteId), period = hydrate(source, { mode, profile, catalog }); period.person = person;
        periods.set(source.recordId, period);
        yield { prepared: periods.size };
      }
      return periods.get(source.recordId);
    }
    const direct = [];
    for (const item of requested) {
      const source = sources.get(item.recordId);
      if (!source || source.athleteId !== item.athleteId || !C.validDate(source.athlete?.date)) throw Error("直接对比记录不存在、人员不匹配或缺少有效日期");
      if (source.demo || source.sample || source.deleted || source.deletedAt || athletes.get(item.athleteId)?.deletedAt || athletes.get(item.athleteId)?.deleted) throw Error("示例数据和回收站记录不能进入横向报告");
      const period = yield* prepare(source); period.color = C.colors[parseInt(C.contentHash(item.athleteId).slice(-8), 16) % C.colors.length];
      period.label = (period.person?.profile?.name || source.athlete.name || item.athleteId) + " · " + source.athlete.date;
      direct.push(period);
    }
    const focusAthleteId = options.focusAthleteId || requested[0]?.athleteId || "", focusIndex = requested.findIndex(item => item.athleteId === focusAthleteId);
    if (focusAthleteId && focusIndex < 0 && options.perspective !== "peers") throw Error("主角须为直接对比运动员之一");
    const differenceFocusIndex = options.perspective === "peers" ? -1 : focusIndex;
    const compiled = [];
    for (const reference of references) {
      const referenceWindow = reference.window;
      const people = new Map(), excluded = { demographic: 0, date: 0, age: 0, invalid: 0 };
      for (const source of sources.values()) {
        if (source.demo || source.sample || source.deleted || source.deletedAt || !C.validDate(source.athlete?.date)) { excluded.invalid++; continue; }
        const person = athletes.get(source.athleteId);
        if (!membership(person, reference)) { excluded.demographic++; continue; }
        // Date filtering avoids running expensive analysis outside the window.
        if (referenceWindow.from && source.athlete.date < referenceWindow.from || referenceWindow.to && source.athlete.date > referenceWindow.to) { excluded.date++; continue; }
        const period = yield* prepare(source), reason = recordEligible(period, reference, referenceWindow);
        if (reason) { excluded[reason]++; continue; }
        if (!people.has(source.athleteId)) people.set(source.athleteId, []); people.get(source.athleteId).push(period);
      }
      compiled.push({ id: reference.id, label: reference.label, spec: reference, eligibleAthletes: people.size, exclusions: excluded, ...sections(direct, people, reference, catalog, differenceFocusIndex) });
    }
    const base = compiled[0] || sections(direct, new Map(), null, catalog, differenceFocusIndex);
    const model = { kind: "horizontal", version: 2, perspective: options.perspective || "peers", focusAthleteId, mode, window, profile, catalog,
      participants: direct.map(period => ({ id: period.id, athleteId: period.source.athleteId, recordId: period.id, date: period.date, label: period.label, color: period.color,
        athlete: clone(period.person?.profile || period.record.athlete), record: clone(period.record), findings: clone(period.stats.findings), advantages: clone(period.stats.advantages) })),
      references: compiled, projects: base.projects, overview: base.overview, risk: base.risk, capability: base.capability };
    model.evaluationConflicts = compiled.flatMap(reference => [...reference.projects.flatMap(project => project.metrics), ...reference.capability.cards.flatMap(card => card.metrics)].filter(row => row.benchmark?.evaluationConflict).map(row => ({ referenceId: reference.id, subjectId: row.subjectId, name: row.name, unit: row.unit, ...row.benchmark.evaluationConflict })));
    const basis = C.contentHash(E.canonical({ version: 1, perspective: model.perspective, focusAthleteId, mode, window, profile, catalog,
      participants: model.participants.map(participant => ({ athleteId: participant.athleteId, recordId: participant.recordId, fingerprint: M.fingerprint(participant.record), athlete: participant.athlete })), references: compiled }));
    model.fingerprint = basis; model.basis = basis;
    return clone(model);
  }
  function build(input, options = {}) {
    const steps = buildSteps(input, options); let step;
    do { step = steps.next(); } while (!step.done);
    return step.value;
  }
  async function buildAsync(input, options = {}, { batchSize = 16, isCancelled = () => false, onProgress, yieldControl = () => new Promise(resolve => root.setTimeout(resolve, 0)) } = {}) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw Error("分批处理条数须为正整数");
    if (isCancelled()) return null;
    const steps = buildSteps(input, options); let prepared = 0;
    try {
      // Let the pending/loading state paint before the first preparation batch.
      onProgress?.({ prepared }); await yieldControl();
      while (!isCancelled()) {
        const step = steps.next();
        if (step.done) { onProgress?.({ prepared }); return isCancelled() ? null : step.value; }
        prepared = step.value.prepared;
        if (prepared % batchSize === 0) { onProgress?.({ prepared }); await yieldControl(); }
      }
      return null;
    } finally { steps.return(); }
  }
  function scopeRows(scope) {
    return [...(scope.projects || []).flatMap(project => project.metrics || []), ...(scope.overview?.rows || []), ...(scope.risk?.rows || []), ...(scope.capability?.cards || []).flatMap(card => card.metrics || [])];
  }
  function present(input, views = {}) {
    const model = clone(input), people = model.participants || [], refs = model.references || [];
    const activeReferenceId = refs.find(reference => reference.id === views.activeReferenceId)?.id || refs[0]?.id || "direct";
    const legacy = (model.version || 1) < 2;
    let focus = clone(views.focus || (legacy && model.perspective === "focus" && model.focusAthleteId ? { kind: "athlete", id: model.focusAthleteId } : people.length === 1 ? { kind: "athlete", id: people[0].athleteId } : { kind: "all" }));
    if (focus.kind === "athlete" && !people.some(person => person.athleteId === focus.id) || focus.kind === "reference" && !refs.some(reference => reference.id === focus.id) || !["all", "athlete", "reference"].includes(focus.kind)) focus = { kind: "all" };
    if (!people.length && refs.length && focus.kind === "all") focus = { kind: "reference", id: activeReferenceId };
    if (focus.kind === "reference") focus = people.length ? people.length === 1 ? { kind: "athlete", id: people[0].athleteId } : { kind: "all" } : { kind: "reference", id: activeReferenceId };
    let baseline = clone(views.baseline || (refs.length && people.length ? { kind: "reference", id: activeReferenceId, statistic: legacy && views.benchmarkTarget === "best" ? "best" : "mean" } : legacy && model.perspective === "focus" ? { kind: "athlete", id: model.focusAthleteId } : { kind: "none" }));
    if (baseline.kind === "reference") { baseline.id ||= activeReferenceId; baseline.statistic = baseline.statistic === "best" ? "best" : "mean"; }
    if (baseline.kind === "athlete" && !people.some(person => person.athleteId === baseline.id) || baseline.kind === "reference" && !refs.some(reference => reference.id === baseline.id) || !["none", "athlete", "reference"].includes(baseline.kind)) baseline = { kind: "none" };
    const labelFor = object => object.kind === "athlete" ? people.find(person => person.athleteId === object.id)?.label || "" : object.kind === "reference" ? refs.find(reference => reference.id === object.id)?.label || "" : object.kind === "all" ? "全部比较对象" : "无差值基准";
    const order = people.map((_, index) => index).sort((a, b) => focus.kind === "athlete" ? Number(people[b].athleteId === focus.id) - Number(people[a].athleteId === focus.id) : 0);
    model.participants = order.map(index => people[index]);
    const scopes = [model, ...refs], allRows = [...new Set(scopes.flatMap(scopeRows))];
    for (const row of allRows) row.cells = order.map(index => row.cells?.[index] || null);
    for (const scope of scopes) for (const key of ["overview", "risk"]) if (scope[key]?.series) scope[key].series.sort((a, b) => model.participants.findIndex(person => person.recordId === (a.recordId || a.id)) - model.participants.findIndex(person => person.recordId === (b.recordId || b.id)));
    const baselineLabel = labelFor(baseline) + (baseline.kind === "reference" ? baseline.statistic === "best" ? " · 最佳" : " · 均值" : "");
    const baselineRows = baseline.kind === "reference" ? scopeRows(refs.find(reference => reference.id === baseline.id)) : [];
    const baseFor = row => {
      if (baseline.kind === "athlete") return row.cells[model.participants.findIndex(person => person.athleteId === baseline.id)]?.value ?? null;
      if (baseline.kind === "reference") return baselineRows.find(item => item.subjectId === row.subjectId && item.contextKey === row.contextKey && item.unit === row.unit)?.benchmark?.[baseline.statistic] ?? null;
      return null;
    };
    const compare = (value, row, self) => {
      if (self || baseline.kind === "none" || row.meaning === "category") return { available: false, reason: self ? "差值基准" : baseline.kind === "none" ? "未选择差值基准" : "类别结果", baseline: clone(baseline), baselineLabel };
      const referenceValue = baseFor(row), result = C.difference(value, referenceValue, row.measurementScale, row.unit);
      return { ...result, baseline: clone(baseline), baselineLabel, referenceValue };
    };
    for (const scope of scopes) for (const row of scopeRows(scope)) {
      row.differences = row.cells.map((cell, index) => compare(cell?.value, row, baseline.kind === "athlete" && model.participants[index]?.athleteId === baseline.id));
      if (row.benchmark) row.benchmark.difference = compare(row.benchmark.mean, row, baseline.kind === "reference" && (scope.id || refs[0]?.id) === baseline.id && baseline.statistic === "mean");
    }
    model.presentation = { focus, baseline, activeReferenceId, participantOrder: model.participants.map(person => person.athleteId), focusLabel: labelFor(focus), baselineLabel };
    model.summary = presentationSummary(model);
    return model;
  }
  function presentationSummary(model) {
    const { focus, baseline, activeReferenceId, focusLabel, baselineLabel } = model.presentation, reference = model.references.find(item => item.id === activeReferenceId);
    const scope = reference || model, summary = { warnings: [], concerns: [], advantages: [], disadvantages: [], baselineAvailable: baseline.kind !== "none", focusLabel, baselineLabel };
    const seen = new Set(), projects = scope.projects || [];
    const add = (row, value, assessment, difference, object, projectName) => {
      if (focus.kind !== "all" && (focus.kind !== object.kind || focus.id !== object.id)) return;
      const identity = object.kind + ":" + object.id + ":" + row.subjectId + ":" + row.contextKey;
      if (seen.has(identity)) return; seen.add(identity);
      const item = { object, subjectLabel: object.label, name: row.name, metricId: row.metricId, subjectId: row.subjectId, testId: row.testId, projectName, value, unit: row.unit, assessment, difference, baselineLabel };
      if (["red", "amber"].includes(assessment?.status)) summary[assessment.status === "red" ? "warnings" : "concerns"].push(item);
      if (!difference?.available || !difference.delta || !["higher", "lower"].includes(row.direction) || ["model", "scenario", "optimum"].includes(row.sourceKind)) return;
      const advantage = difference.delta * (row.direction === "higher" ? 1 : -1) > 0;
      summary[advantage ? "advantages" : "disadvantages"].push({ ...item, delta: difference.delta, ...(difference.percent !== undefined ? { percent: difference.percent } : {}) });
    };
    for (const project of projects) for (const row of project.metrics) {
      row.cells.forEach((cell, index) => { const person = model.participants[index]; if (person && cell) add(row, cell.value, cell.assessment, row.differences[index], { kind: "athlete", id: person.athleteId, label: person.label }, project.name); });
      if (reference && row.benchmark) add(row, row.benchmark.mean, row.benchmark.assessment, row.benchmark.difference, { kind: "reference", id: reference.id, label: reference.label }, project.name);
    }
    return summary;
  }
  function facts(input, views = {}) {
    const model = present(input, views);
    const rows = metrics => metrics.map(row => ({ id: row.id, name: row.name, unit: row.unit, meaning: row.meaning, direction: row.direction, context: row.context,
      ...(row.sourceKind ? { sourceKind: row.sourceKind } : {}), results: row.cells.map(cell => cell ? { value: cell.value, unit: cell.unit, pain: !!cell.pain,
        ...(cell.statistics?.n >= 3 ? { trialStatistics: cell.statistics } : {}), assessment: cell.assessment } : null),
      reference: row.benchmark ? { n: row.benchmark.n, mean: row.benchmark.mean, best: row.benchmark.best, distribution: row.benchmark.distribution, sampling: row.benchmark.sampling,
        contributors: row.benchmark.contributors.map(({ athleteId, recordId, date, value, sources, recordCount, dateRange, effectiveSampling }) => ({ athleteId, ...(recordId ? { recordId, date } : {}), value, sources, recordCount, dateRange, effectiveSampling })), bestSources: row.benchmark.bestSources,
        assessment: row.benchmark.assessment, difference: row.benchmark.difference, resolvedStandard: row.benchmark.resolvedStandard } : null, differences: row.differences }));
    return { type: "cross-athlete-horizontal", perspective: model.perspective, presentation: model.presentation, summary: model.summary, mode: model.mode, window: clone(model.window),
      interpretation: "Differences compare people or an explicitly sampled cohort, never temporal improvement. Means use one contribution per athlete. Fitted parameters, model predictions and scenarios retain their sourceKind; no averaged parameters describe a real individual.",
      participants: model.participants.map(({ athleteId, recordId, date, label, athlete }) => ({ athleteId, recordId, date, label, athlete })),
      references: model.references.map(reference => ({ id: reference.id, label: reference.label, conditions: reference.spec, projects: reference.projects.map(project => ({ id: project.id, name: project.name, metrics: rows(project.metrics) })), overview: rows(reference.overview.rows), risk: rows(reference.risk.rows), capability: reference.capability.cards.map(card => ({ id: card.id, title: card.title, metrics: rows(card.metrics) })) })),
      ...(!model.references.length ? { projects: model.projects.map(project => ({ id: project.id, name: project.name, metrics: rows(project.metrics) })) } : {}) };
  }
  function localText(input, views = {}) {
    const model = present(input, views);
    const { focus, baseline, activeReferenceId, focusLabel, baselineLabel } = model.presentation, reference = model.references.find(item => item.id === activeReferenceId);
    const lines = [focus.kind === "all" ? "横向比较" : focusLabel + " · 横向比较", model.participants.map(person => person.label).join("；"), "个人代表成绩：" + (model.mode === "mean" ? "试次均值" : "最佳试次")];
    if (reference) lines.push("当前群体：" + reference.label);
    if (baseline.kind !== "none") lines.push("差值基准：" + baselineLabel);
    const format = value => value === null || value === undefined ? "—" : String(Number(value.toFixed(4)));
    const personal = row => row.cells.map((cell, index) => cell && N(cell.value) !== null ? (model.participants[index].athlete.name || model.participants[index].athleteId) + " " + format(cell.value) + " " + row.unit +
      (row.differences[index]?.available && row.differences[index].delta !== 0 ? "（差值 " + (row.differences[index].delta > 0 ? "+" : "") + format(row.differences[index].delta) + "）" : "") : "").filter(Boolean).join("；");
    if (!model.references.length) for (const project of model.projects) for (const row of project.metrics.filter(row => row.cells.some(finite)).slice(0, 3))
      lines.push(project.name + " · " + row.name + "：" + personal(row));
    for (const reference of model.references.filter(item => item.id === activeReferenceId)) {
      lines.push("", reference.label);
      for (const project of reference.projects) for (const row of project.metrics.filter(row => row.benchmark?.n).slice(0, 3)) {
        const b = row.benchmark; if (!b?.n) continue;
        lines.push(project.name + " · " + row.name + "：" + b.samplingLabel + "，n=" + b.n + (b.mean === null ? "，按等级／类别统计" : "，均值 " + format(b.mean) + " " + row.unit) + (b.best === null ? "" : "，样本最佳 " + format(b.best) + " " + row.unit) + "。" + personal(row));
      }
    }
    if (baseline.kind !== "none") for (const [key, label] of [["advantages", "相对优势"], ["disadvantages", "相对不足"]]) {
      const items = model.summary[key];
      if (items.length) lines.push(label + "：" + items.slice(0, 3).map(item => (focus.kind === "all" ? item.subjectLabel + " · " : "") + item.projectName + " · " + item.name + " " + (item.delta > 0 ? "+" : "") + format(item.delta) + " " + item.unit).join("；"));
    }
    return lines.join("\n");
  }
  root.RingsideHorizontal = { build, buildAsync, present, facts, localText, normalizeWindow, normalizeReference, aggregateAssessment };
})(typeof window !== "undefined" ? window : globalThis);
