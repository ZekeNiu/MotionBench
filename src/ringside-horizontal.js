(function (root) {
  "use strict";
  const C = root.RingsideComparison, M = root.RingsideModel, E = root.RingsideEvaluation, T = root.RingsideTests;
  const N = value => root.Calc.num(value), clone = value => JSON.parse(JSON.stringify(value));
  const sex = value => ({ male: "男", female: "女", any: "" })[value] ?? value ?? "";
  const chronology = (a, b) => a.date.localeCompare(b.date) || String(a.source.created || "").localeCompare(String(b.source.created || "")) || a.id.localeCompare(b.id);
  const finite = cell => !!cell && N(cell.value) !== null;
  function normalizeWindow(input) {
    if (!input || !["all", "recent12", "custom"].includes(input.kind)) throw Error("请明确选择群体数据的日期范围");
    const from = input.from || null, to = input.to || null;
    if (input.kind !== "all" && (!C.validDate(from) || !C.validDate(to)) || from && !C.validDate(from) || to && !C.validDate(to) || from && to && from > to) throw Error("群体数据的起止日期无效");
    return { kind: input.kind, from, to };
  }
  function normalizeReference(input) {
    if (!input?.id || !["all", "sport", "team"].includes(input.scope || "all")) throw Error("群体参照范围无效");
    if (input.scope === "sport" && !input.sportId || input.scope === "team" && !input.teamId) throw Error("请选择参照专项或队伍");
    const result = { ...clone(input), label: input.label || "群体参照", scope: input.scope || "all", sampling: input.sampling || "latest" };
    if (!["latest", "period-record"].includes(result.sampling)) throw Error("群体取样方式无效");
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
  function summarize(people, template, contextKey, layer, key, reference, catalog, unit) {
    const directional = template.meaning !== "category" && ["higher", "lower"].includes(template.semantics.direction), sampling = reference.sampling === "period-record" && directional && ["tests", "capability"].includes(layer) ? "period-record" : "latest";
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
      let selected;
      if (sampling === "latest") selected = eligible.at(-1);
      else selected = eligible.filter(item => finite(item.cell)).reduce((best, item) => !best || (template.semantics.direction === "higher" ? item.cell.value >= best.cell.value : item.cell.value <= best.cell.value) ? item : best, null);
      if (!selected || !finite(selected.cell)) { exclusions.missing++; continue; }
      const { period, cell } = selected;
      chosen.push({ athleteId, name: period.person?.profile?.name || period.record.athlete.name || athleteId, recordId: period.id, date: period.date,
        value: cell.value, unit: cell.unit, context: cell.comparisonContext, subjectInputs: cell.subjectInputs, statistics: cell.statistics, sourceFingerprint: period.sourceFingerprint,
        representativeMode: period.record.mode, profile: { sex: period.person?.profile?.sex || "", sportId: period.person?.profile?.sportId || "", subdivisionId: period.person?.profile?.subdivisionId || "", teamId: period.person?.groupId || "", testedAge: N(period.record.athlete.age) },
        pain: !!cell.pain, ...(cell.sourceKind ? { sourceKind: cell.sourceKind } : {}) });
    }
    chosen.sort((a, b) => a.athleteId.localeCompare(b.athleteId));
    const numeric = template.meaning === "numeric", values = chosen.map(item => item.value), stats = root.Calc.descriptive(values, false);
    const best = directional && values.length ? (template.semantics.direction === "higher" ? Math.max(...values) : Math.min(...values)) : null;
    const distribution = [...new Set(values)].sort((a, b) => a - b).map(value => ({ value, count: values.filter(item => item === value).length }));
    return { sampling, samplingLabel: sampling === "period-record" ? "阶段个人纪录" : "最近测试", n: chosen.length, eligibleAthletes: people.size,
      mean: numeric ? stats.mean : null, sd: numeric ? stats.sd : null, best, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
      distribution: numeric ? [] : distribution, contributors: chosen, bestSources: best === null ? [] : chosen.filter(item => item.value === best).map(item => ({ athleteId: item.athleteId, name: item.name, recordId: item.recordId, date: item.date, value: item.value })),
      excludedCount: exclusions.protocol + exclusions.missing, exclusions, meanLabel: sampling === "period-record" ? "阶段个人纪录均值" : "最近测试均值",
      reason: chosen.length ? "" : "没有符合条件的有效结果" };
  }
  function matrix(direct, candidates, layer, reference, catalog, focusIndex) {
    const keys = [...new Set(direct.flatMap(period => [...period.layers[layer].keys()]))], rows = [];
    for (const key of keys) {
      const exemplar = direct.map(period => period.layers[layer].get(key)).find(Boolean), unit = exemplar.unit || "";
      const cells = direct.map(period => comparableCell(period, layer, key, exemplar, catalog, unit));
      const contexts = [...new Set(cells.filter(Boolean).map(cell => cell.contextKey))];
      for (const contextKey of contexts) {
        const template = cells.find(cell => cell?.contextKey === contextKey), matching = cells.map(cell => cell?.contextKey === contextKey ? cell : null);
        const benchmark = reference ? summarize(candidates, template, contextKey, layer, key, reference, catalog, unit) : null;
        const row = { id: key + (contexts.length > 1 ? ":" + C.contentHash(contextKey).slice(-8) : ""), metricId: exemplar.metricId || exemplar.id || key,
          subjectId: exemplar.subjectId || exemplar.id || key, testId: exemplar.testId, name: exemplar.name, unit: template.unit, measurementScale: exemplar.measurementScale || "unknown",
          meaning: template.meaning, direction: template.direction, semantics: template.semantics, contextKey, context: template.comparisonContext,
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
    for (const period of direct) for (const project of period.report.projects) if (!descriptors.has(project.id)) descriptors.set(project.id, project);
    const projects = [...descriptors.values()].map(project => ({ id: project.id, name: project.name, category: project.category, primaryAbility: project.primaryAbility,
      metrics: testRows.filter(row => row.testId === project.id) })).filter(project => project.metrics.length);
    const makeRadar = kind => {
      const rows = matrix(direct, candidates, kind, reference, catalog, focusIndex);
      return { axes: rows.map(row => ({ key: row.id, label: row.name })), rows,
        series: direct.map((period, index) => ({ id: period.id, recordId: period.id, label: period.label, color: period.color, values: rows.map(row => row.cells[index]?.value ?? null), cells: rows.map(row => row.cells[index]) })),
        benchmark: { label: "群体平均评分 · 最近测试", values: rows.map(row => row.benchmark?.mean ?? null), counts: rows.map(row => row.benchmark?.n || 0) } };
    };
    const capabilityRows = matrix(direct, candidates, "capability", reference, catalog, focusIndex), cards = new Map(direct.flatMap(period => period.capabilityCards.map(card => [card.id, card])));
    return { projects, overview: makeRadar("overview"), risk: makeRadar("risk"), capability: { cards: [...cards.values()].map(card => ({ ...card, metrics: capabilityRows.filter(row => row.id.startsWith(card.id + ":")) })) } };
  }
  // Both public entry points drive this exact pipeline. Yield only after a
  // complete unique record has been prepared; no partial model is exposed.
  function* buildSteps(input, options = {}) {
    if (!Array.isArray(input)) throw Error("横向比较需要完整测试记录");
    const requested = options.participants || [], references = (options.references || []).map(normalizeReference);
    if (requested.length < (references.length ? 1 : 2)) throw Error("请选择至少两名运动员，或一名运动员及群体参照");
    if (new Set(requested.map(item => item.athleteId)).size !== requested.length) throw Error("每名直接对比运动员只能选择一次测试");
    if (new Set(references.map(item => item.id)).size !== references.length) throw Error("群体参照编号重复");
    const window = normalizeWindow(options.window), mode = options.mode || "best";
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
    const focusAthleteId = options.focusAthleteId || requested[0].athleteId, focusIndex = requested.findIndex(item => item.athleteId === focusAthleteId);
    if (focusIndex < 0 && options.perspective !== "peers") throw Error("主角须为直接对比运动员之一");
    const differenceFocusIndex = options.perspective === "peers" ? -1 : focusIndex;
    const compiled = [];
    for (const reference of references) {
      const people = new Map(), excluded = { demographic: 0, date: 0, age: 0, invalid: 0 };
      for (const source of sources.values()) {
        if (source.demo || source.sample || source.deleted || source.deletedAt || !C.validDate(source.athlete?.date)) { excluded.invalid++; continue; }
        const person = athletes.get(source.athleteId);
        if (!membership(person, reference)) { excluded.demographic++; continue; }
        // Date filtering avoids running expensive analysis outside the window.
        if (window.from && source.athlete.date < window.from || window.to && source.athlete.date > window.to) { excluded.date++; continue; }
        const period = yield* prepare(source), reason = recordEligible(period, reference, window);
        if (reason) { excluded[reason]++; continue; }
        if (!people.has(source.athleteId)) people.set(source.athleteId, []); people.get(source.athleteId).push(period);
      }
      compiled.push({ id: reference.id, label: reference.label, spec: reference, eligibleAthletes: people.size, exclusions: excluded, ...sections(direct, people, reference, catalog, differenceFocusIndex) });
    }
    const base = compiled[0] || sections(direct, new Map(), null, catalog, differenceFocusIndex);
    const model = { kind: "horizontal", version: 1, perspective: options.perspective || "focus", focusAthleteId, mode, window, profile, catalog,
      participants: direct.map(period => ({ id: period.id, athleteId: period.source.athleteId, recordId: period.id, date: period.date, label: period.label, color: period.color,
        athlete: clone(period.person?.profile || period.record.athlete), record: clone(period.record) })),
      references: compiled, projects: base.projects, overview: base.overview, risk: base.risk, capability: base.capability };
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
  function facts(model) {
    const rows = metrics => metrics.map(row => ({ id: row.id, name: row.name, unit: row.unit, meaning: row.meaning, direction: row.direction, context: row.context,
      ...(row.sourceKind ? { sourceKind: row.sourceKind } : {}), results: row.cells.map(cell => cell ? { value: cell.value, unit: cell.unit, pain: !!cell.pain,
        ...(cell.statistics?.n >= 3 ? { trialStatistics: cell.statistics } : {}), assessment: cell.assessment } : null),
      reference: row.benchmark ? { n: row.benchmark.n, mean: row.benchmark.mean, best: row.benchmark.best, distribution: row.benchmark.distribution, sampling: row.benchmark.sampling,
        contributors: row.benchmark.contributors.map(({ athleteId, recordId, date, value }) => ({ athleteId, recordId, date, value })), bestSources: row.benchmark.bestSources } : null, differences: row.differences }));
    return { type: "cross-athlete-horizontal", perspective: model.perspective, mode: model.mode, window: clone(model.window),
      interpretation: "Differences compare people or an explicitly sampled cohort, never temporal improvement. Means use one contribution per athlete. Fitted parameters, model predictions and scenarios retain their sourceKind; no averaged parameters describe a real individual.",
      participants: model.participants.map(({ athleteId, recordId, date, label, athlete }) => ({ athleteId, recordId, date, label, athlete })),
      references: model.references.map(reference => ({ id: reference.id, label: reference.label, conditions: reference.spec, projects: reference.projects.map(project => ({ id: project.id, name: project.name, metrics: rows(project.metrics) })), overview: rows(reference.overview.rows), capability: reference.capability.cards.map(card => ({ id: card.id, title: card.title, metrics: rows(card.metrics) })) })),
      ...(!model.references.length ? { projects: model.projects.map(project => ({ id: project.id, name: project.name, metrics: rows(project.metrics) })) } : {}) };
  }
  function localText(model) {
    const lines = ["横向比较", model.participants.map(person => person.label).join("；"), "个人代表成绩：" + (model.mode === "mean" ? "试次均值" : "最佳试次")];
    const format = value => value === null || value === undefined ? "—" : String(Number(value.toFixed(4)));
    const personal = row => row.cells.map((cell, index) => cell && N(cell.value) !== null ? (model.participants[index].athlete.name || model.participants[index].athleteId) + " " + format(cell.value) + " " + row.unit +
      (row.differences[index]?.available && row.differences[index].delta !== 0 ? "（差值 " + (row.differences[index].delta > 0 ? "+" : "") + format(row.differences[index].delta) + "）" : "") : "").filter(Boolean).join("；");
    if (!model.references.length) for (const project of model.projects) for (const row of project.metrics.filter(row => row.cells.some(finite)).slice(0, 3))
      lines.push(project.name + " · " + row.name + "：" + personal(row));
    for (const reference of model.references) {
      lines.push("", reference.label);
      for (const project of reference.projects) for (const row of project.metrics.filter(row => row.benchmark?.n).slice(0, 3)) {
        const b = row.benchmark; if (!b?.n) continue;
        lines.push(project.name + " · " + row.name + "：" + b.samplingLabel + "，n=" + b.n + (b.mean === null ? "，按等级／类别统计" : "，均值 " + format(b.mean) + " " + row.unit) + (b.best === null ? "" : "，样本最佳 " + format(b.best) + " " + row.unit) + "。" + personal(row));
      }
    }
    return lines.join("\n");
  }
  root.RingsideHorizontal = { build, buildAsync, facts, localText, normalizeWindow, normalizeReference };
})(typeof window !== "undefined" ? window : globalThis);
