(function (root) {
  "use strict";
  const M = root.RingsideModel, E = root.RingsideEvaluation, T = root.RingsideTests, C = root.RingsideComparison;
  const N = value => root.Calc.num(value), clone = value => JSON.parse(JSON.stringify(value));
  const hasValue = cell => cell && N(cell.value) !== null;
  const hash = value => C.contentHash(E.canonical(value));
  const calculationConfiguration = value => { const result = clone(value); for (const key of ["title", "titleAuto", "reportTitle"]) delete result[key]; return result; };
  const canonicalMember = id => String(id).includes(":") ? String(id) : "metric:" + id;
  const flagged = status => status === "red" || status === "amber";
  // Exact SI scale factors, plus the conventional standard-gravity definition of kgf.
  // A matching dimension is required; labels such as %, scores and ratios are not interchangeable.
  const units = { mm: ["length", .001], cm: ["length", .01], m: ["length", 1], km: ["length", 1000],
    ms: ["time", .001], s: ["time", 1], min: ["time", 60], h: ["time", 3600], g: ["mass", .001], kg: ["mass", 1],
    N: ["force", 1], kN: ["force", 1000], kgf: ["force", 9.80665], "m/s": ["speed", 1], "km/h": ["speed", 1 / 3.6] };
  function unitFactor(from, to) { const existing = M.unitFactor(from, to); if (existing !== null) return existing; return units[from] && units[to] && units[from][0] === units[to][0] ? units[from][1] / units[to][1] : null; }
  function scale(value, factor) { if (N(value) === null) return value; const result = N(value) * factor; if (!Number.isFinite(result)) throw Error("单位换算超出有效数值范围"); return result; }
  function scaleRanges(ranges, factor) { return (ranges || []).map(range => ({ ...range, min: scale(range.min, factor), max: scale(range.max, factor) })); }
  function profileForRecord(profile, record) {
    if (!profile) return null;
    const next = clone(profile);
    for (const rule of next.standards) {
      const definition = rule.kind === "metric" && record.definitions.find(item => item.id === rule.metricId);
      if (!definition || !T.isManualMetric(definition) || M.unitFactor(rule.context.unit, definition.unit) !== null) continue;
      const factor = unitFactor(rule.context.unit, definition.unit); if (factor === null) continue;
      rule.context.unit = definition.unit; rule.target = scale(rule.target, factor); rule.ranges = scaleRanges(rule.ranges, factor);
      for (const group of rule.referenceGroups || []) { group.target = scale(group.target, factor); group.ranges = scaleRanges(group.ranges, factor); }
      for (const axis of Object.values(next.aggregations)) {
        const transform = axis.transforms?.["metric:" + definition.id] || axis.transforms?.[definition.id];
        if (transform?.kind === "anchors") transform.points.forEach(point => { point.value = scale(point.value, factor); });
        if (transform?.kind === "table") transform.ranges = scaleRanges(transform.ranges, factor);
      }
    }
    return next;
  }
  function teamCell(cell, period, catalog, unit) {
    const temporal = value => { if (value) value.temporalDirection = cell.direction || null; return value; };
    const definition = period.source?.definitions.find(item => item.id === (cell.metricId || cell.id)) || cell.definition || cell.canonicalDefinition;
    const catalogDefinition = catalog?.definitions.find(item => item.id === (cell.metricId || cell.id));
    const meaning = root.RingsideMetricSemantics.resolve(definition || { measurementScale: cell.measurementScale }, { catalogDefinition }).meaning;
    if (meaning !== "numeric") return temporal(C.horizontalCell(cell, period, catalog, cell.unit || ""));
    if (M.unitFactor(cell.unit || "", unit) !== null) return temporal(C.horizontalCell(cell, period, catalog, unit));
    const factor = unitFactor(cell.unit || "", unit);
    if (factor === null || cell.measurementScale === "ordinal") return temporal(C.horizontalCell(cell, period, catalog, cell.unit || ""));
    const next = clone(cell), metricId = cell.metricId || cell.id;
    const adaptDefinition = definition => definition && ({ ...definition, unit, target: scale(definition.target, factor), ranges: scaleRanges(definition.ranges, factor) });
    next.rawValue = cell.rawValue ?? cell.value; next.rawUnit = cell.rawUnit ?? cell.unit; next.unit = unit; next.value = scale(cell.value, factor);
    if (next.context && Object.hasOwn(next.context, "unit")) next.context.unit = unit;
    if (next.context?.force?.unit === cell.unit) next.context.force.unit = unit;
    if (next.definition) next.definition = adaptDefinition(next.definition);
    if (next.displayDefinition) next.displayDefinition = adaptDefinition(next.displayDefinition);
    if (next.evaluation) { next.evaluation.target = scale(next.evaluation.target, factor); next.evaluation.value = scale(next.evaluation.value, factor); }
    next.referenceTarget = scale(next.referenceTarget, factor);
    if (next.statistics) for (const key of ["mean", "sd", "min", "max"]) if (next.statistics[key] !== undefined) next.statistics[key] = scale(next.statistics[key], factor);
    const adaptRecord = record => ({ ...record, definitions: record.definitions.map(definition => definition.id === metricId ? adaptDefinition(definition) : definition) });
    const result = C.horizontalCell(next, { ...period, record: adaptRecord(period.record), source: adaptRecord(period.source || period.record) }, catalog, unit);
    // The displayed assessment uses the common unit. Evaluation evidence keeps
    // its original value, unit, target and score conversion together.
    if (cell.evaluation) result.evaluation = clone(cell.evaluation);
    return temporal(result);
  }

  function quantile(values, p) {
    if (!values.length) return null;
    const x = (values.length - 1) * p, lower = Math.floor(x), upper = Math.ceil(x);
    return values[lower] + (values[upper] - values[lower]) * (x - lower);
  }
  function statistics(entries, meaning = "numeric") {
    const values = entries.map(entry => N(typeof entry === "number" ? entry : entry.value)).filter(value => value !== null).sort((a, b) => a - b);
    const n = values.length, continuous = meaning === "numeric";
    const result = { n, min: n ? values[0] : null, max: n ? values.at(-1) : null, mean: null, sd: null,
      q1: null, median: null, q3: null, lowerWhisker: null, upperWhisker: null, outliers: [], boxAvailable: continuous && n >= 3 };
    if (!continuous || !n) return result;
    Object.assign(result, root.Calc.descriptive(values, false)); delete result.cv;
    result.q1 = quantile(values, .25); result.median = quantile(values, .5); result.q3 = quantile(values, .75);
    const iqr = result.q3 - result.q1, lower = result.q1 - 1.5 * iqr, upper = result.q3 + 1.5 * iqr;
    result.lowerWhisker = values.find(value => value >= lower); result.upperWhisker = values.findLast(value => value <= upper);
    result.outliers = values.filter(value => value < result.lowerWhisker || value > result.upperWhisker);
    return result;
  }
  function histogram(entries) {
    const valid = entries.filter(hasValue), n = valid.length;
    if (!n) return [];
    const values = valid.map(entry => entry.value), min = Math.min(...values), max = Math.max(...values);
    if (min === max) return [{ from: min, to: max, count: n, members: clone(valid), lastInclusive: true }];
    const count = Math.ceil(Math.log2(n) + 1), width = (max - min) / count;
    const bins = Array.from({ length: count }, (_, index) => ({ from: min + width * index, to: index === count - 1 ? max : min + width * (index + 1), count: 0, members: [], lastInclusive: index === count - 1 }));
    for (const entry of valid) {
      // Comparing stored edges also makes exactly-on-edge values reproducible.
      const index = bins.findIndex(bin => entry.value >= bin.from && (entry.value < bin.to || bin.lastInclusive && entry.value <= bin.to));
      const bin = bins[index < 0 ? bins.length - 1 : index]; bin.members.push(clone(entry)); bin.count++;
    }
    return bins;
  }
  function distribution(entries) {
    const values = [...new Set(entries.filter(hasValue).map(entry => entry.value))].sort((a, b) => a - b);
    return values.map(value => { const members = entries.filter(entry => entry.value === value); return { value, label: String(value), count: members.length, members: clone(members) }; });
  }
  function rankings(metric, people) {
    const entries = people.map((person, index) => ({ athleteId: person.athleteId, name: person.name, recordId: person.recordId, date: person.date,
      value: N(metric.cells[index]?.value), rank: null, missing: !hasValue(metric.cells[index]), index }));
    const sign = metric.rankable && metric.direction === "lower" ? 1 : -1;
    entries.sort((a, b) => Number(a.missing) - Number(b.missing) || (!a.missing ? sign * (a.value - b.value) : 0) || a.index - b.index);
    let previous = null, rank = 0;
    entries.forEach((entry, index) => { if (!entry.missing && metric.rankable) { if (previous === null || entry.value !== previous) rank = index + 1; entry.rank = rank; previous = entry.value; } delete entry.index; });
    return entries;
  }
  function intervalScore(cell) {
    return cell?.evaluation?.scoreContributions?.some(contribution => contribution.transform?.shape === "range") || false;
  }
  function makeRows(periods, people, maps, catalog) {
    const keys = [...new Set(maps.flatMap(map => [...map.keys()]))], rows = [];
    for (const key of keys) {
      const exemplar = maps.map(map => map.get(key)).find(Boolean), catalogMetric = catalog?.definitions?.find(item => item.id === (exemplar.metricId || key));
      const unit = catalogMetric && unitFactor(exemplar.unit || "", catalogMetric.unit || "") !== null ? catalogMetric.unit || "" : exemplar.unit || "";
      const normalized = maps.map((map, index) => map.has(key) ? teamCell(map.get(key), periods[index], catalog, unit) : null);
      const contexts = [...new Set(normalized.filter(Boolean).map(cell => cell.contextKey))].sort();
      for (const contextKey of contexts) {
        const template = normalized.find(cell => cell?.contextKey === contextKey), cells = normalized.map((cell, index) => cell?.contextKey === contextKey ? { ...cell,
          athleteId: people[index].athleteId, name: people[index].name, recordId: people[index].recordId, date: people[index].date } : null);
        const directions = [...new Set(cells.filter(Boolean).map(cell => cell.direction))], direction = directions.length === 1 ? directions[0] : "unconfirmed";
        const id = key + (contexts.length > 1 ? ":" + hash(contextKey).slice(-8) : ""), groupId = contexts.length > 1 ? hash(contextKey) : "default";
        const row = { id, metricId: exemplar.metricId || exemplar.id || key, subjectId: exemplar.subjectId || exemplar.id || key, testId: exemplar.testId,
          name: exemplar.name, unit: template.unit, measurementScale: template.measurementScale || "unknown", meaning: template.meaning || "numeric", direction,
          rankable: template.meaning !== "category" && ["higher", "lower"].includes(direction) && !cells.some(intervalScore), aggregation: clone(template.aggregation || null),
          contextKey, context: template.comparisonContext || {}, groupId, contextLabel: contexts.length > 1 ? "测量条件 " + (contexts.indexOf(contextKey) + 1) : "", cells,
          ...Object.fromEntries(["section", "sourceKind", "groupName", "region", "directionId", "pairId", "parentId"].filter(field => exemplar[field] !== undefined).map(field => [field, exemplar[field]])) };
        row.ranking = rankings(row, people); row.statistics = statistics(row.ranking, row.meaning); row.distribution = distribution(row.ranking);
        // A partial strength measurement can create a balance-ratio placeholder;
        // only ratios observed for at least one team member belong in this union.
        if (row.section === "balance" && !row.statistics.n) continue;
        rows.push(row);
      }
    }
    return rows;
  }
  function observations(period) {
    if (!period) return new Map();
    const result = C.observations(period);
    // Bilateral FMS inputs are distinct recorded metrics, in addition to their fixed lower-side score.
    for (const [index, item] of (period.stats.raw.fms?.items || []).entries()) if (item.bilateral) for (const side of ["left", "right"]) {
      const value = N(item[side]); if (value === null) continue;
      const id = "fms:" + index + ":" + side;
      result.set(id, { id, metricId: id, testId: "fms", name: item.name + " · " + (side === "left" ? "左侧" : "右侧"), value, unit: "分",
        measurementScale: "ordinal", context: { item: index, side, name: item.name }, canonicalDefinition: { resultMeaning: "ordinal", direction: "higher", directionStatus: "confirmed" },
        evaluation: { grade: M.fixedFmsAssessment(value) }, notes: item.notes || "", pain: value === 0 });
    }
    return result;
  }
  function overview(periods, people, profile, catalog) {
    const result = { axes: [], series: [], total: people.length, issues: [] };
    if (!profile) return result;
    const configuration = profile.aggregations || {}, configured = Object.keys(configuration).filter(key => ["primary", "mean"].includes(configuration[key].method));
    const order = T.abilityGroups(catalog || {}).map(group => T.axisKey(group.key));
    configured.sort((a, b) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length));
    const scoreRows = [];
    for (const id of configured) {
      const cfg = configuration[id], key = id.replace(/^ability:/, ""), expected = (cfg.method === "primary" ? [cfg.primary] : cfg.members || []).map(canonicalMember);
      const cells = periods.map((period, index) => {
        const axis = period?.stats.axes.find(item => T.axisKey(item.key) === T.axisKey(key));
        if (!axis || axis.method !== cfg.method || E.canonical(axis.members) !== E.canonical(expected) || N(axis.value) === null) {
          const issue = period?.stats.aggregationIssues.find(item => item.ability === key)?.reason || (period ? "本次缺少适用的能力分数" : "本次未测");
          result.issues.push({ athleteId: people[index].athleteId, axisId: id, reason: issue }); return null;
        }
        return { athleteId: people[index].athleteId, value: axis.value, members: clone(axis.members), evidence: period.stats.evaluationResults.filter(item => expected.includes(item.subjectId)) };
      });
      const valid = cells.filter(Boolean), value = valid.length ? valid.reduce((sum, cell) => sum + cell.value / valid.length, 0) : null;
      const label = T.abilityLabel(catalog || {}, key);
      result.axes.push({ id, key, label, value, n: valid.length, total: people.length, status: "gray", identity: hash({ profile: E.signature(profile), id, configuration: cfg }), cells });
      scoreRows.push(cells);
    }
    result.series.push({ id: "team", label: "团队平均", color: "#65717c", values: result.axes.map(axis => axis.value), counts: result.axes.map(axis => axis.n) });
    people.forEach((person, index) => result.series.push({ id: person.athleteId, athleteId: person.athleteId, label: person.name, color: person.color, values: scoreRows.map(cells => cells[index]?.value ?? null) }));
    return result;
  }
  function regionAliases() {
    const aliases = new Map();
    for (const id of Object.keys(M.REG)) {
      aliases.set(id, { id, side: "" });
      for (const [side, full] of [["L", "left"], ["R", "right"]]) for (const alias of [id + "_" + side.toLowerCase(), full + "_" + id, id + "_" + full, full + id[0].toUpperCase() + id.slice(1), id + "-" + full]) aliases.set(alias, { id, side });
    }
    return aliases;
  }
  function risk(periods, people) {
    const aliases = regionAliases(), regions = Object.entries(M.REG).map(([id, label]) => ({ id, key: id, label, measuredCount: 0, assessedCount: 0, flaggedCount: 0,
      amberCount: 0, redCount: 0, members: [], total: people.length, value: null })), byId = new Map(regions.map(region => [region.id, region])), unlocalized = [], assessedPeople = new Set();
    periods.forEach((period, index) => {
      if (!period) return;
      const person = people[index], local = new Map();
      if (period.stats.evaluationResults.some(item => ["red", "amber", "green"].includes(item.grade?.status) && (item.testId === "fms" || period.record.definitions.some(definition => definition.id === item.metricId && definition.category === "screen")))) assessedPeople.add(person.athleteId);
      for (const [key, detail] of Object.entries(period.stats.signals.regions)) {
        const mapped = aliases.get(key); if (!mapped) continue;
        const entry = local.get(mapped.id) || { measured: false, assessed: false, status: "gray", sides: new Set(), tests: [] };
        entry.measured ||= detail.hasMeasured === true; entry.assessed ||= ["red", "amber", "green"].includes(detail.status);
        if (detail.status === "red" || detail.status === "amber" && entry.status !== "red") entry.status = detail.status;
        if (flagged(detail.status)) {
          if (mapped.side) entry.sides.add(mapped.side);
          for (const test of detail.tests || []) if (test.hasMeasured && flagged(test.status)) entry.tests.push({ ...clone(test), side: test.side || mapped.side });
        }
        local.set(mapped.id, entry);
      }
      for (const [id, entry] of local) {
        const region = byId.get(id); if (entry.measured) region.measuredCount++; if (entry.assessed) { region.assessedCount++; assessedPeople.add(person.athleteId); }
        if (flagged(entry.status)) { region.flaggedCount++; region[entry.status === "red" ? "redCount" : "amberCount"]++;
          region.members.push({ athleteId: person.athleteId, name: person.name, recordId: person.recordId, date: person.date, status: entry.status, sides: [...entry.sides], tests: entry.tests }); }
      }
      const findings = period.stats.signals.signals.filter(item => flagged(item.status) && !aliases.has(item.region));
      if (findings.length) unlocalized.push({ athleteId: person.athleteId, name: person.name, recordId: person.recordId, date: person.date,
        status: findings.some(item => item.status === "red") ? "red" : "amber", findings: clone(findings), tests: clone(findings) });
    });
    regions.forEach(region => { region.value = region.assessedCount ? region.flaggedCount : null; });
    return { regions, axes: regions, unlocalized, total: people.length, max: people.length, assessedCount: assessedPeople.size,
      flaggedCount: new Set([...regions.flatMap(region => region.members), ...unlocalized].map(person => person.athleteId)).size };
  }
  function normalizeConfiguration(options) {
    const supplied = options.configuration || options, configuration = {};
    if (supplied.analysisMode && supplied.analysisMode !== "single") return normalizeComparisonConfiguration(supplied);
    for (const key of ["title", "titleAuto", "groupId", "window", "mode", "profileId"]) if (supplied[key] !== undefined) configuration[key] = clone(supplied[key]);
    configuration.mode ||= "best"; configuration.profileId ||= "";
    if (!["best", "mean"].includes(configuration.mode)) throw Error("个人代表成绩须为最佳值或均值");
    const selected = supplied.participants || [];
    configuration.participants = selected.map(item => ({ athleteId: item.athleteId, recordId: item.recordId || "" }));
    if (supplied.athleteIds) for (const athleteId of supplied.athleteIds) if (!configuration.participants.some(item => item.athleteId === athleteId)) configuration.participants.push({ athleteId, recordId: "" });
    if (!configuration.participants.length || configuration.participants.some(item => typeof item.athleteId !== "string" || !item.athleteId) || new Set(configuration.participants.map(item => item.athleteId)).size !== configuration.participants.length) throw Error("团队报告须选择不重复的运动员");
    const window = configuration.window || { kind: "all", from: null, to: null };
    if (window.from && !C.validDate(window.from) || window.to && !C.validDate(window.to) || window.from && window.to && window.from > window.to) throw Error("报告日期范围无效");
    configuration.window = window; return configuration;
  }
  function* buildSteps(records, options = {}) {
    if (!Array.isArray(records)) throw Error("测试记录须为列表");
    const configuration = normalizeConfiguration(options), sources = new Map(), athletes = new Map((options.athletes || []).map(person => [person.id || person.athleteId, person]));
    for (const record of records) { if (sources.has(record.recordId)) throw Error("测试记录编号重复"); sources.set(record.recordId, record); }
    const catalog = options.catalog ? clone(options.catalog) : null, profile = options.profile ? E.serializeProfile(E.normalizeProfile(clone(options.profile), catalog)) : null;
    if (profile) E.validateProfile(profile);
    const periods = [], people = [];
    for (const participant of configuration.participants) {
      const source = participant.recordId ? sources.get(participant.recordId) : null, owner = athletes.get(participant.athleteId);
      if (participant.recordId && (!source || source.athleteId !== participant.athleteId || !C.validDate(source.athlete?.date))) throw Error("所选测试记录不存在、人员不匹配或日期无效");
      if ([owner, source].some(item => item && (item.demo || item.sample || item.deleted || item.deletedAt))) throw Error("示例数据或回收站资料不能进入团队报告");
      if (source && (configuration.window.from && source.athlete.date < configuration.window.from || configuration.window.to && source.athlete.date > configuration.window.to)) throw Error("所选测试记录不在报告日期范围内");
      const athlete = clone(owner?.profile || source?.athlete || {}), name = athlete.name || owner?.name || participant.athleteId;
      const person = { id: participant.athleteId, athleteId: participant.athleteId, name, label: name, athlete, groupId: owner?.groupId || "",
        recordId: source?.recordId || null, date: source?.athlete.date || null, missing: !source, record: source ? clone(source) : null,
        color: C.colors[parseInt(hash(participant.athleteId).slice(-8), 16) % C.colors.length], sourceFingerprint: source ? hash(source) : null };
      const period = source ? C.prepareRecord(source, { mode: configuration.mode, profile: profileForRecord(profile, source), catalog }) : null;
      if (period) period.source = source;
      people.push(person); periods.push(period); yield { prepared: people.length, total: configuration.participants.length };
    }
    const maps = periods.map(observations), rows = makeRows(periods, people, maps, catalog), descriptors = new Map();
    for (const period of periods.filter(Boolean)) for (const project of period.report.projects) if (!descriptors.has(project.id)) descriptors.set(project.id, project);
    const projects = [...descriptors.values()].map(project => {
      const metrics = rows.filter(row => row.testId === project.id), defaultMetric = metrics.find(row => row.metricId === "cmj_height") || metrics.find(row => row.metricId === project.primaryMetricId) || metrics[0];
      return { id: project.id, name: project.name, category: project.category, renderer: project.renderer, primaryAbility: project.primaryAbility,
        defaultMetricId: defaultMetric?.id || "", metrics, groups: [...new Map(metrics.map(row => [row.groupId, { id: row.groupId, label: row.contextLabel || "相同测量条件" }])).values()] };
    }).filter(project => project.metrics.length);
    const capabilityMaps = periods.map(period => {
      if (!period) return { maps: new Map(), cards: [] };
      const capability = C.capability([period]), maps = new Map();
      for (const card of capability.cards) for (const row of card.metrics) if (row.cells[0]) maps.set(card.id + ":" + row.id, { ...row.cells[0], id: card.id + ":" + row.id, metricId: row.metricId, name: row.name, cardId: card.id });
      return { maps, cards: capability.cards };
    });
    const capabilityRows = makeRows(periods, people, capabilityMaps.map(item => item.maps), catalog), cards = [...new Map(capabilityMaps.flatMap(item => item.cards.map(card => [card.id, card]))).values()].map(card => {
      const metrics = capabilityRows.filter(row => row.id.startsWith(card.id + ":")); return { id: card.id, projectId: "capability:" + card.id, title: card.title, name: card.title, metrics, defaultMetricId: metrics[0]?.id || "" };
    }).filter(card => card.metrics.some(metric => metric.statistics.n));
    const riskData = risk(periods, people), overviewData = overview(periods, people, profile, catalog);
    const model = { kind: "team", version: 1, configuration, mode: configuration.mode, profile, catalog, people, participants: people, projects, capability: { cards }, overview: overviewData, risk: riskData,
      summary: { total: people.length, people: people.length, recorded: people.filter(person => !person.missing).length, missing: people.filter(person => person.missing).length,
        projects: projects.length, screened: people.filter((person, index) => periods[index] && (Object.values(periods[index].stats.signals.regions).some(region => region.hasMeasured) || periods[index].stats.raw.fms?.completed > 0)).length, flagged: riskData.flaggedCount } };
    model.fingerprint = hash({ version: 1, configuration: calculationConfiguration(configuration), profile, catalog, people: people.map(({ record, ...person }) => person) }); model.basis = model.fingerprint;
    return clone(model);
  }
  function buildSingle(records, options = {}) { const iterator = buildSteps(records, options); let next; do { next = iterator.next(); } while (!next.done); return next.value; }
  function build(records, options = {}) {
    const configuration = options.configuration || options;
    return configuration.analysisMode && configuration.analysisMode !== "single" ? buildComparison(records, options) : buildSingle(records, options);
  }
  async function buildAsync(records, options = {}, { batchSize = 8, isCancelled = () => false, onProgress, yieldControl = () => new Promise(resolve => root.setTimeout(resolve, 0)) } = {}) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw Error("分批处理条数须为正整数");
    if ((options.configuration || options).analysisMode && (options.configuration || options).analysisMode !== "single") {
      if (isCancelled()) return null;
      await yieldControl();
      return buildComparisonAsync(records, options, { batchSize, isCancelled, onProgress, yieldControl });
    }
    const iterator = buildSteps(records, options); let prepared = 0;
    try { if (isCancelled()) return null; onProgress?.({ prepared }); await yieldControl(); while (!isCancelled()) {
      const next = iterator.next(); if (next.done) return isCancelled() ? null : next.value;
      prepared = next.value.prepared; if (prepared % batchSize === 0) { onProgress?.(next.value); await yieldControl(); }
    } return null; } finally { iterator.return(); }
  }
  function normalizeComparisonConfiguration(supplied) {
    if (!["longitudinal", "horizontal"].includes(supplied.analysisMode)) throw Error("团队分析方式无效");
    const out = { analysisMode: supplied.analysisMode, mode: supplied.mode || "best", profileId: supplied.profileId || "" };
    for (const key of ["title", "titleAuto", "groupId"]) if (supplied[key] !== undefined) out[key] = clone(supplied[key]);
    if (!["best", "mean"].includes(out.mode)) throw Error("个人代表成绩须为最佳值或均值");
    if (out.analysisMode === "longitudinal") {
      const ids = supplied.athleteIds || (supplied.participants || []).map(person => person.athleteId);
      if (!ids.length || ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw Error("团队纵向须选择不重复的运动员");
      out.athleteIds = [...ids];
      const dates = supplied.dates || (supplied.dateParticipants || []).map(period => period.date);
      if (dates.length < 2 || dates.some(date => !C.validDate(date)) || new Set(dates).size !== dates.length) throw Error("团队纵向须选择至少两个不同的有效测试日期");
      out.dates = [...dates].sort();
      const rows = supplied.dateParticipants || [];
      if (new Set(rows.map(row => row.date)).size !== rows.length || rows.some(row => !out.dates.includes(row.date))) throw Error("测试日期与记录选择不一致");
      out.dateParticipants = out.dates.map(date => {
        const selected = rows.find(row => row.date === date)?.participants || [];
        if (new Set(selected.map(person => person.athleteId)).size !== selected.length || selected.some(person => !ids.includes(person.athleteId))) throw Error("每个日期的运动员须来自固定名单且不能重复");
        return { date, participants: ids.map(athleteId => ({ athleteId, recordId: selected.find(person => person.athleteId === athleteId)?.recordId || "" })) };
      });
      out.participants = ids.map(athleteId => ({ athleteId, recordId: "" }));
    } else {
      const objects = supplied.objects || [];
      if (!objects.length || new Set(objects.map(object => object.id)).size !== objects.length || objects.some(object => typeof object.id !== "string" || !object.id)) throw Error("请选择不重复的团队或参考群体");
      if (objects.length < 2 && !objects.some(object => object.kind === "reference")) throw Error("团队横向须选择至少两个团队，或添加参考群体");
      out.objects = objects.map(object => {
        const kind = object.kind || (object.reference ? "reference" : "team");
        if (!["team", "reference"].includes(kind)) throw Error("团队比较对象类型无效");
        if (kind === "reference") {
          const reference = { ...clone(object.reference || {}), id: object.id };
          reference.window ||= { kind: "all" }; reference.sampling ||= "latest";
          return { id: object.id, label: object.label || reference.label || "参考群体", kind, reference: root.RingsideHorizontal.normalizeReference(reference) };
        }
        const normalized = normalizeConfiguration({ participants: object.participants || [], mode: out.mode, window: object.window || { kind: "all" } });
        return { id: object.id, label: object.label || "团队", kind, groupId: object.groupId || "", participants: normalized.participants, window: normalized.window,
          ...(object.evaluationOverrides ? { evaluationOverrides: clone(object.evaluationOverrides) } : {}) };
      });
      out.participants = [...new Map(out.objects.flatMap(object => object.participants || []).map(person => [person.athleteId, person])).values()];
    }
    return out;
  }
  function selectedSources(configuration) {
    const participants = configuration.analysisMode === "longitudinal" ? (configuration.dateParticipants || []).flatMap(period => period.participants || []) : configuration.analysisMode === "horizontal" ? (configuration.objects || []).flatMap(object => object.participants || []) : configuration.participants || [];
    return { participants, athleteIds: [...new Set([...(configuration.athleteIds || []), ...participants.map(person => person.athleteId)])], recordIds: [...new Set(participants.map(person => person.recordId).filter(Boolean))], hasReferences: configuration.analysisMode === "horizontal" && (configuration.objects || []).some(object => object.kind === "reference") };
  }
  function comparisonKey(row) {
    const context = clone(row.context || {}); delete context.unit; if (context.force) delete context.force.unit;
    const physical = units[row.unit]?.[0] || row.unit || "";
    return E.canonical({ metricId: row.metricId || row.subjectId || row.id, context: JSON.parse(E.contextSignature(context)), meaning: row.meaning, scale: row.measurementScale, unit: physical });
  }
  function convertComparisonCell(cell, fromUnit, unit, contextKey) {
    if (!cell) return null;
    const factor = unitFactor(fromUnit || "", unit || "");
    if (factor === null) return null;
    const value = clone(cell); value.unit = unit; value.contextKey = contextKey;
    if (Object.hasOwn(cell, "temporalDirection")) value.direction = cell.temporalDirection;
    if (N(value.value) !== null) value.value *= factor;
    if (value.statistics) for (const key of ["mean", "sd", "min", "max"]) if (N(value.statistics[key]) !== null) value.statistics[key] *= Math.abs(factor);
    return value;
  }
  function pairChange(row, periods, fromIndex, toIndex) {
    const base = { available: false, from: periods[fromIndex].date, to: periods[toIndex].date, fromIndex, toIndex, n: 0, fromMean: null, toMean: null, delta: null, improvement: null, people: [] };
    if (row.meaning === "category") return { ...base, reason: "类别结果按分布展示" };
    for (const person of row.people) {
      const change = root.RingsideLongitudinal.change(person.cells, fromIndex, toIndex, periods, row.measurementScale);
      if (change.available) base.people.push({ athleteId: person.athleteId, name: person.name, from: change.from.value, to: change.to.value, delta: change.delta, improvement: change.improvement, reason: change.reason });
    }
    base.n = base.people.length;
    if (!base.n) return { ...base, reason: "没有两端均有可比结果的运动员" };
    base.fromMean = base.people.reduce((sum, person) => sum + person.from / base.n, 0);
    base.toMean = base.people.reduce((sum, person) => sum + person.to / base.n, 0);
    // Ordinary ordinal/category codes retain transitions, never a numerical team average.
    if (row.meaning !== "numeric" && row.aggregation?.mean !== true) return { ...base, fromMean: null, toMean: null, transitions: base.people, reason: "等级结果查看个人变化" };
    const difference = C.difference(base.toMean, base.fromMean, row.measurementScale, row.unit);
    Object.assign(base, difference, { available: true });
    if (base.people.every(person => person.improvement !== null) && ["higher", "lower"].includes(row.direction)) base.improvement = difference.delta === 0 ? "unchanged" : difference.delta * (row.direction === "higher" ? 1 : -1) > 0 ? "improved" : "declined";
    base.improved = base.people.filter(person => person.improvement === "improved").length;
    base.declined = base.people.filter(person => person.improvement === "declined").length;
    return base;
  }
  function comparisonProjects(entries, longitudinal, people) {
    const projects = new Map();
    for (const entry of entries) for (const project of entry.projects || []) {
      if (!projects.has(project.id)) projects.set(project.id, { ...clone(project), metrics: [], _rows: new Map() });
      const target = projects.get(project.id);
      for (const metric of project.metrics || []) {
        const key = comparisonKey(metric);
        if (!target._rows.has(key)) target._rows.set(key, { ...clone(metric), id: (metric.metricId || metric.id) + ":" + C.contentHash(key).slice(-8), contextKey: key, cells: [], people: [], _source: metric });
      }
    }
    for (const project of projects.values()) {
      for (const [key, row] of project._rows) {
        const matches = entries.map(entry => entry.projects.find(item => item.id === project.id)?.metrics.find(metric => comparisonKey(metric) === key));
        if (longitudinal) {
          row.people = people.map(person => ({ athleteId: person.athleteId, name: person.name, cells: matches.map(metric => {
            const cell = metric?.cells.find(cell => cell?.athleteId === person.athleteId);
            return convertComparisonCell(cell, metric?.unit, row.unit, key);
          }) }));
          row.cells = matches.map((metric, index) => {
            const members = row.people.map(person => person.cells[index]), stat = statistics(members.filter(hasValue), row.aggregation?.mean === true ? "numeric" : row.meaning), value = stat.mean;
            return { value, mean: value, n: stat.n, total: people.length, unit: row.unit, statistics: stat, distribution: distribution(members.filter(hasValue)), members, contextKey: key };
          });
          row.pairedChanges = { overall: pairChange(row, entries, 0, entries.length - 1), recent: entries.length > 2 ? pairChange(row, entries, entries.length - 2, entries.length - 1) : null };
          row.changes = row.pairedChanges;
        } else {
          row.cells = matches.map(metric => {
            if (!metric?.benchmark) return null;
            const cell = clone(metric.benchmark), factor = unitFactor(metric.unit || "", row.unit || "");
            if (factor === null) return null;
            for (const field of ["mean", "sd", "best", "min", "max"]) if (N(cell[field]) !== null) cell[field] *= factor;
            cell.value = cell.mean; cell.unit = row.unit; cell.contextKey = key; return cell;
          });
        }
        delete row._source; delete row.ranking; delete row.statistics; delete row.distribution; delete row.benchmark;
        project.metrics.push(row);
      }
      const originalDefault = entries.map(entry => entry.projects.find(item => item.id === project.id)?.metrics.find(metric => metric.id === project.defaultMetricId || metric.metricId === project.defaultMetricId)).find(Boolean);
      project.defaultMetricId = (originalDefault && project.metrics.find(metric => metric.contextKey === comparisonKey(originalDefault)) || project.metrics[0])?.id || "";
      delete project._rows;
    }
    return [...projects.values()];
  }
  function* comparisonSteps(records, options) {
    const configuration = normalizeComparisonConfiguration(options.configuration || options), profile = options.profile || null, catalog = options.catalog || null;
    const sourceMap = new Map();
    for (const record of records) { if (sourceMap.has(record.recordId)) throw Error("测试记录编号重复"); sourceMap.set(record.recordId, record); }
    const baseOptions = { mode: configuration.mode, profileId: configuration.profileId, profile, catalog, athletes: options.athletes || [] }, used = new Set(), periods = [], objects = [];
    if (configuration.analysisMode === "longitudinal") {
      for (const selection of configuration.dateParticipants) {
        for (const person of selection.participants) if (person.recordId) {
          const source = sourceMap.get(person.recordId);
          if (!source || source.athlete?.date !== selection.date) throw Error("所选记录与团队比较日期不一致");
          used.add(person.recordId);
        }
        const model = yield { kind: "team", records, options: { ...baseOptions, participants: selection.participants, window: { from: selection.date, to: selection.date } } };
        periods.push({ id: selection.date, date: selection.date, label: selection.date, projects: [...model.projects, ...model.capability.cards.map(card => ({ ...card, id: card.projectId || card.id, name: card.title || card.name, category: "capability" }))], model });
      }
    } else {
      for (const object of configuration.objects) {
        let model = null, reference, candidates = records;
        if (object.kind === "team") {
          model = yield { kind: "team", records, options: { ...baseOptions, participants: object.participants, window: object.window } };
          const selected = new Set(object.participants.map(person => person.recordId).filter(Boolean));
          candidates = records.filter(record => selected.has(record.recordId)); selected.forEach(recordId => used.add(recordId));
          reference = { id: object.id, label: object.label, scope: "all", sampling: "latest", window: { kind: "all" },
            ...(object.evaluationOverrides ? { evaluationOverrides: object.evaluationOverrides } : {}) };
        } else reference = { ...object.reference, id: object.id, label: object.label };
        const horizontal = yield { kind: "reference", records: candidates, options: { ...baseOptions, participants: [], references: [reference] } };
        const referenceModel = horizontal.references[0];
        for (const project of [...referenceModel.projects, ...referenceModel.capability.cards]) for (const row of project.metrics || []) for (const person of row.benchmark?.contributors || []) for (const source of person.sources || []) used.add(source.recordId);
        objects.push({ id: object.id, label: object.label, kind: object.kind, model, referenceModel });
      }
    }
    const sourceRecords = records.filter(record => used.has(record.recordId)).map(clone), sourceOwnerIds = new Set(sourceRecords.map(record => record.athleteId));
    const sourceAthletes = (options.athletes || []).filter(person => sourceOwnerIds.has(person.id)).map(person => ({ id: person.id, name: person.name || person.profile?.name || person.id, profile: clone(person.profile || {}), groupId: person.groupId || "" }));
    for (const record of sourceRecords) if (!sourceAthletes.some(person => person.id === record.athleteId)) sourceAthletes.push({ id: record.athleteId, name: record.athlete.name || record.athleteId, profile: clone(record.athlete), groupId: "" });
    const last = periods.at(-1)?.model, people = last ? clone(last.people) : [...new Map([...objects.flatMap(object => object.model?.people || []), ...sourceAthletes.map(person => ({ athleteId: person.id, id: person.id, name: person.name, athlete: person.profile, groupId: person.groupId }))].map(person => [person.athleteId, person])).values()];
    const projects = comparisonProjects(last ? periods : objects.map(object => ({ ...object.referenceModel, projects: [...object.referenceModel.projects, ...object.referenceModel.capability.cards.map(card => ({ ...card, id: "capability:" + card.id, name: card.title || card.name, category: "capability" }))] })), !!last, people);
    const model = { kind: "team", version: 2, analysisMode: configuration.analysisMode, configuration, mode: configuration.mode, profile: clone(profile), catalog: clone(catalog), people, participants: people, projects, periods, objects, sourceRecords, sourceAthletes,
      overview: last?.overview || { axes: [], series: [] }, risk: last?.risk || { regions: [], assessedCount: 0, flaggedCount: null }, capability: { cards: [] }, summary: last?.summary || { total: people.length, people: people.length, flagged: null },
      evaluationConflicts: objects.flatMap(object => [...object.referenceModel.projects, ...object.referenceModel.capability.cards].flatMap(project => (project.metrics || []).filter(row => row.benchmark?.evaluationConflict).map(row => ({ referenceId: object.id, name: row.name, unit: row.unit, ...row.benchmark.evaluationConflict })))) };
    model.fingerprint = hash({ version: 2, configuration: calculationConfiguration(configuration), profile, catalog, sources: sourceRecords.map(record => ({ id: record.recordId, fingerprint: M.fingerprint(record) })), athletes: sourceAthletes }); model.basis = model.fingerprint;
    return clone(model);
  }
  function buildComparison(records, options) {
    const iterator = comparisonSteps(records, options); let step = iterator.next();
    while (!step.done) { const job = step.value; step = iterator.next(job.kind === "team" ? buildSingle(job.records, job.options) : root.RingsideHorizontal.build(job.records, job.options)); }
    return step.value;
  }
  async function buildComparisonAsync(records, options, controls) {
    const iterator = comparisonSteps(records, options); let step = iterator.next(), prepared = 0;
    try { while (!step.done) {
      if (controls.isCancelled()) return null;
      const job = step.value, progress = { ...controls, onProgress: state => controls.onProgress?.({ prepared: prepared + state.prepared }) };
      const result = job.kind === "team" ? await buildAsync(job.records, job.options, progress) : await root.RingsideHorizontal.buildAsync(job.records, job.options, progress);
      if (!result || controls.isCancelled()) return null;
      prepared += job.records.length; step = iterator.next(result); await controls.yieldControl();
    } return controls.isCancelled() ? null : step.value; } finally { iterator.return(); }
  }
  function present(input, views = {}) {
    const model = clone(input);
    if (model.analysisMode !== "horizontal") return model;
    const ids = model.objects.map(object => object.id), focusObjectId = ids.includes(views.focusObjectId) ? views.focusObjectId : "", baselineObjectId = ids.includes(views.baselineObjectId) ? views.baselineObjectId : "", baselineIndex = ids.indexOf(baselineObjectId);
    model.presentation = { focusObjectId, baselineObjectId };
    for (const project of model.projects) for (const row of project.metrics) {
      row.differences = row.cells.map((cell, index) => baselineIndex < 0 || index === baselineIndex || row.meaning === "category" ? { available: false } : C.difference(cell?.value, row.cells[baselineIndex]?.value, row.measurementScale, row.unit));
      row.cells.forEach((cell, index) => { if (cell) cell.difference = row.differences[index]; });
    }
    return model;
  }
  function hasData(model) {
    return !!model && ((model.projects || []).some(project => (project.metrics || []).some(row => row.statistics?.n > 0 || (row.cells || []).some(cell => cell && (N(cell.value) !== null || cell.n > 0 || cell.pain)))) || (model.risk?.regions || []).some(region => region.measuredCount > 0));
  }
  function memberSeries(model, row) {
    const longitudinal = model?.analysisMode === "longitudinal", horizontal = model?.analysisMode === "horizontal";
    const supported = !!row && (longitudinal || horizontal) && row.meaning !== "category", unit = row?.unit || "";
    const result = { supported, ordering: longitudinal ? "roster" : "descending-value", categories: [], series: [] };
    if (!row || !longitudinal && !horizontal || row.meaning === "category") return result;
    const summarize = (series, missingNames, total) => {
      const entries = series.cells.filter(hasValue);
      return { ...series, n: entries.length, statistics: statistics(entries, row.aggregation?.mean === true ? "numeric" : row.meaning || "numeric"),
        distribution: distribution(entries), missingCount: Math.max(0, total - entries.length), missingNames };
    };
    if (longitudinal) {
      const people = row.people || [];
      result.categories = people.map(person => ({ id: person.athleteId, label: person.name || person.athleteId }));
      result.series = (model.periods || []).map((period, index) => {
        const cells = people.map(person => {
          const cell = person.cells[index];
          return hasValue(cell) ? { ...clone(cell), athleteId: person.athleteId, name: person.name || person.athleteId, unit } : null;
        });
        return summarize({ id: period.id || period.date, label: period.label || period.date, date: period.date, mean: N(row.cells[index]?.value), cells },
          people.filter((person, slot) => !cells[slot]).map(person => person.name || person.athleteId), people.length);
      });
    } else {
      result.series = (model.objects || []).map((object, index) => {
        const benchmark = row.cells[index], roster = object.model?.people || object.model?.participants || [];
        const cells = (benchmark?.contributors || []).map(person => {
          const factor = unitFactor(person.unit || benchmark?.unit || unit, unit), value = N(person.value);
          if (factor === null || value === null) return null;
          const cell = { athleteId: person.athleteId, name: person.name || person.athleteId, value: value * factor, unit };
          for (const key of ["recordId", "date", "effectiveSampling", "recordCount", "dateRange", "sources", "pain", "assessment", "display"])
            if (person[key] !== undefined) cell[key] = clone(person[key]);
          return cell;
        }).filter(Boolean).sort((a, b) => b.value - a.value || String(a.athleteId).localeCompare(String(b.athleteId)));
        const measured = new Set(cells.map(cell => cell.athleteId)), missingNames = roster.filter(person => !measured.has(person.athleteId)).map(person => person.name || person.athlete?.name || person.athleteId);
        return summarize({ id: object.id, label: object.label, mean: N(benchmark?.value), sampling: benchmark?.sampling || object.referenceModel?.spec?.sampling || "latest", cells },
          missingNames, roster.length || benchmark?.eligibleAthletes || object.referenceModel?.eligibleAthletes || cells.length);
      });
      const count = Math.max(0, ...result.series.map(series => series.cells.length));
      result.categories = Array.from({ length: count }, (_, index) => ({ id: String(index + 1), label: "第 " + (index + 1) + " 位" }));
      result.series.forEach(series => { while (series.cells.length < count) series.cells.push(null); });
    }
    return result;
  }
  function chart(model, projectId, view = {}) {
    const project = model.projects.find(item => item.id === projectId) || model.capability.cards.find(item => item.projectId === projectId || item.id === projectId);
    if (!project) return { kind: "column", entries: [], points: [], missing: model.people, n: 0, total: model.people.length, note: "没有该项目结果" };
    const metric = project.metrics.find(item => item.id === view.metricId) || project.metrics.find(item => item.metricId === view.metricId && (!view.groupId || item.groupId === view.groupId)) || project.metrics.find(item => item.id === project.defaultMetricId) || project.metrics[0];
    if (!metric) return { kind: "column", entries: [], points: [], missing: model.people, n: 0, total: model.people.length, note: "尚无有效指标" };
    const requestedKind = ["column", "dot", "box", "histogram"].includes(view.kind) ? view.kind : "column";
    const kind = metric.meaning === "category" ? "distribution" : metric.meaning === "ordinal" && ["box", "histogram"].includes(requestedKind) ? "column" : requestedKind;
    const entries = metric.ranking.filter(entry => !entry.missing), missing = metric.ranking.filter(entry => entry.missing);
    return { kind, requestedKind, metric, entries, points: entries, missing, n: entries.length, total: model.people.length, rankable: metric.rankable, statistics: metric.statistics,
      bins: kind === "histogram" ? histogram(entries) : metric.distribution,
      note: kind === "box" && entries.length < 3 ? "有效人数不足 3 人，保留个人点" : metric.meaning === "category" ? "类别结果按人数展示" : metric.meaning === "ordinal" && kind !== requestedKind ? "等级结果使用柱状图或点图" : !metric.rankable ? "按数值排列，不表示表现优劣" : "" };
  }
  function facts(model, views = {}) {
    if (model.analysisMode && model.analysisMode !== "single") {
      const shown = present(model, views);
      return clone({ type: "team-" + model.analysisMode, configuration: model.configuration, presentation: shown.presentation || null, projects: shown.projects, people: model.people.map(({ record, ...person }) => person),
        periods: model.periods.map(period => ({ date: period.date, summary: period.model.summary, overview: period.model.overview, risk: period.model.risk })), objects: model.objects.map(object => ({ id: object.id, label: object.label, kind: object.kind, reference: object.referenceModel, summary: object.model?.summary || null })),
        interpretation: "Each date retains the entire selected roster. Date means use that date's valid observations; changes use the same people at the two stated endpoints. Reference screening grades describe aggregated representative values, never a number of flagged people." });
    }
    const row = metric => ({ id: metric.id, metricId: metric.metricId, name: metric.name, unit: metric.unit, meaning: metric.meaning, direction: metric.direction,
      rankable: metric.rankable, ranking: metric.ranking, context: metric.context, statistics: metric.statistics,
      cells: metric.cells.map(cell => !cell ? null : ({ athleteId: cell.athleteId, value: cell.value, rawValue: cell.rawValue, rawUnit: cell.rawUnit, evaluation: cell.evaluation, notes: cell.notes, pain: cell.pain })) });
    return clone({ type: "team-report", configuration: model.configuration, fingerprint: model.fingerprint, profile: model.profile ? { id: model.profile.id, name: model.profile.name, revision: model.profile.revision } : null,
      people: model.people.map(({ record, ...person }) => person), summary: model.summary, projects: model.projects.map(project => ({ id: project.id, name: project.name, metrics: project.metrics.map(row) })),
      capability: { cards: model.capability.cards.map(card => ({ id: card.id, title: card.title, metrics: card.metrics.map(row) })) }, overview: model.overview, risk: model.risk, views });
  }
  function localText(model, views = {}) {
    if (model.analysisMode && model.analysisMode !== "single") {
      const lines = [model.configuration.title || "损伤风险筛查与运动表现测试报告", model.analysisMode === "longitudinal" ? "团队纵向比较" : "团队横向比较"];
      for (const project of model.projects) for (const row of project.metrics) {
        const values = row.cells.map((cell, index) => `${model.analysisMode === "longitudinal" ? model.periods[index].date : model.objects[index].label}：${N(cell?.value) === null ? "—" : Number(cell.value.toFixed(4))}${row.unit || ""}（有效 ${cell?.n || 0} 人）`);
        lines.push(project.name + " · " + row.name + "：" + values.join("；"));
        const change = row.pairedChanges?.overall;
        if (change?.available) lines.push(`同人变化：${change.from} → ${change.to}，配对 ${change.n} 人，${Number(change.fromMean.toFixed(4))} → ${Number(change.toMean.toFixed(4))}${row.unit || ""}，差值 ${Number(change.delta.toFixed(4))}${row.unit || ""}。`);
      }
      return lines.join("\n");
    }
    const format = value => N(value) === null ? "—" : String(Number(value.toFixed(4))), summary = model.summary;
    const lines = [model.configuration.title || "团队报告", `报告 ${summary.total} 人，有测试记录 ${summary.recorded} 人，暂无记录 ${summary.missing} 人；${summary.projects} 个项目，${summary.screened} 人有筛查数据。`,
      "个人代表成绩：" + (model.mode === "mean" ? "试次均值" : "最佳试次")];
    const axes = model.overview.axes.filter(axis => axis.n);
    if (axes.length) lines.push("运动表现概览：" + axes.map(axis => `${axis.label}平均 ${format(axis.value)} 分（${axis.n}/${axis.total} 人）`).join("；") + "。");
    for (const project of model.projects) {
      const selected = chart(model, project.id, views.charts?.[project.id] || {}), metric = selected.metric;
      if (!metric || !selected.n) continue;
      const context = metric.contextLabel ? " · " + metric.contextLabel : "";
      if (metric.meaning === "category" || metric.meaning === "ordinal") lines.push(project.name + " · " + metric.name + context + "：" + metric.distribution.map(item => `${item.label}，${item.count} 人`).join("；") + "。");
      else lines.push(project.name + " · " + metric.name + context + `：有效 ${selected.n}/${selected.total} 人，平均 ${format(metric.statistics.mean)} ${metric.unit}，中位数 ${format(metric.statistics.median)} ${metric.unit}，范围 ${format(metric.statistics.min)}–${format(metric.statistics.max)} ${metric.unit}。`);
      if (metric.rankable) { const leaders = selected.entries.filter(entry => entry.rank === 1); if (leaders.length) lines.push("该指标第 1 名：" + leaders.map(entry => entry.name + " " + format(entry.value) + " " + metric.unit).join("；") + "。"); }
    }
    const regions = model.risk.regions.filter(region => region.flaggedCount);
    lines.push(model.risk.assessedCount ? `筛查关注人数：${model.risk.flaggedCount} 人（${model.risk.assessedCount} 人有可评价结果）。` : summary.screened ? "已录入筛查数据，尚无可评价结果。" : "尚无筛查数据。");
    for (const region of regions) lines.push(region.label + `：${region.flaggedCount} 人（已评价 ${region.assessedCount} 人），` + region.members.map(member => member.name + (member.status === "red" ? "·预警" : "·关注") + (member.sides.length ? "·" + member.sides.map(side => side === "L" ? "左" : "右").join("/") : "")).join("；") + "。");
    if (model.risk.unlocalized.length) lines.push("未定位筛查提示：" + model.risk.unlocalized.map(person => person.name).join("、") + "。");
    return lines.join("\n");
  }
  root.RingsideTeam = { build, buildAsync, chart, facts, localText, statistics, histogram, quantile, unitFactor, normalizeConfiguration, selectedSources, present, hasData, memberSeries };
})(typeof window !== "undefined" ? window : globalThis);
