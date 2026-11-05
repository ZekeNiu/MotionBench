(function (root) {
  "use strict";
  const M = root.RingsideModel, E = root.RingsideEvaluation, T = root.RingsideTests, C = root.RingsideComparison;
  const N = value => root.Calc.num(value), clone = value => JSON.parse(JSON.stringify(value));
  const hasValue = cell => cell && N(cell.value) !== null;
  const hash = value => C.contentHash(E.canonical(value));
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
    const definition = period.source?.definitions.find(item => item.id === (cell.metricId || cell.id)) || cell.definition || cell.canonicalDefinition;
    const catalogDefinition = catalog?.definitions.find(item => item.id === (cell.metricId || cell.id));
    const meaning = root.RingsideMetricSemantics.resolve(definition || { measurementScale: cell.measurementScale }, { catalogDefinition }).meaning;
    if (meaning !== "numeric") return C.horizontalCell(cell, period, catalog, cell.unit || "");
    if (M.unitFactor(cell.unit || "", unit) !== null) return C.horizontalCell(cell, period, catalog, unit);
    const factor = unitFactor(cell.unit || "", unit);
    if (factor === null || cell.measurementScale === "ordinal") return C.horizontalCell(cell, period, catalog, cell.unit || "");
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
    return result;
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
          rankable: template.meaning !== "category" && ["higher", "lower"].includes(direction) && !cells.some(intervalScore),
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
    model.fingerprint = hash({ version: 1, configuration, profile, catalog, people: people.map(({ record, ...person }) => person) }); model.basis = model.fingerprint;
    return clone(model);
  }
  function build(records, options = {}) { const iterator = buildSteps(records, options); let next; do { next = iterator.next(); } while (!next.done); return next.value; }
  async function buildAsync(records, options = {}, { batchSize = 8, isCancelled = () => false, onProgress, yieldControl = () => new Promise(resolve => root.setTimeout(resolve, 0)) } = {}) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw Error("分批处理条数须为正整数");
    const iterator = buildSteps(records, options); let prepared = 0;
    try { if (isCancelled()) return null; onProgress?.({ prepared }); await yieldControl(); while (!isCancelled()) {
      const next = iterator.next(); if (next.done) return isCancelled() ? null : next.value;
      prepared = next.value.prepared; if (prepared % batchSize === 0) { onProgress?.(next.value); await yieldControl(); }
    } return null; } finally { iterator.return(); }
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
    const row = metric => ({ id: metric.id, metricId: metric.metricId, name: metric.name, unit: metric.unit, meaning: metric.meaning, direction: metric.direction,
      rankable: metric.rankable, ranking: metric.ranking, context: metric.context, statistics: metric.statistics,
      cells: metric.cells.map(cell => !cell ? null : ({ athleteId: cell.athleteId, value: cell.value, rawValue: cell.rawValue, rawUnit: cell.rawUnit, evaluation: cell.evaluation, notes: cell.notes, pain: cell.pain })) });
    return clone({ type: "team-report", configuration: model.configuration, fingerprint: model.fingerprint, profile: model.profile ? { id: model.profile.id, name: model.profile.name, revision: model.profile.revision } : null,
      people: model.people.map(({ record, ...person }) => person), summary: model.summary, projects: model.projects.map(project => ({ id: project.id, name: project.name, metrics: project.metrics.map(row) })),
      capability: { cards: model.capability.cards.map(card => ({ id: card.id, title: card.title, metrics: card.metrics.map(row) })) }, overview: model.overview, risk: model.risk, views });
  }
  function localText(model, views = {}) {
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
  root.RingsideTeam = { build, buildAsync, chart, facts, localText, statistics, histogram, quantile, unitFactor, normalizeConfiguration };
})(typeof window !== "undefined" ? window : globalThis);
