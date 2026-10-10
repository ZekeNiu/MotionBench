(function (root) {
  "use strict";
  const M = root.RingsideModel, clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => root.crypto.randomUUID(), now = () => new Date().toISOString();
  const canonical = (v) => JSON.stringify(order(v));
  function order(v) {
    if (Array.isArray(v)) return v.map(order);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, order(v[k])]));
    return v;
  }
  function measurementContext(record, d) {
    const forceMetric = /(?:force|impulse|^imtp_(?:f|rfd)\d)/.test(d.id);
    const config = !forceMetric ? null : d.testId === "cmj" ? { definition: record.cmjConfig?.definition || "gross" } : d.testId === "imtp" ? { unit: record.imtpConfig?.unit || "N", definition: record.imtpConfig?.definition || "gross" } : null;
    if (config && /impulse/.test(d.id)) config.impulseDefinition = (d.testId === "cmj" ? record.cmjConfig : record.imtpConfig)?.impulseDefinition || "gross";
    return { unit: d.unit || "", protocol: record.protocol?.[d.testId] || "", protocolIdentity: record.protocolIdentities?.[d.testId] || M.protocolIdentity("test:" + d.testId, record.protocol?.[d.testId]), metricProtocol: d.protocol || "", metricProtocolIdentity: d.protocolIdentity || M.protocolIdentity("metric:" + d.id,d.protocol), ...(config ? { force: clone(config) } : {}), ...(d.id === "rqr" ? { pairedProtocol: record.protocol?.hop || "", pairedProtocolIdentity: record.protocolIdentities?.hop || M.protocolIdentity("test:hop",record.protocol?.hop) } : {}) };
  }
  function isoContext(row, record) {
    return { region: row.region, directionCode: row.directionCode || "custom_" + row.id, paired: row.paired, unit: row.unit, protocol: row.protocol || record.protocol?.iso || "", protocolIdentity: row.protocolIdentity || M.protocolIdentity("iso:" + row.id,row.protocol || record.protocol?.iso), projectProtocolIdentity: record.protocolIdentities?.iso || M.protocolIdentity("test:iso",record.protocol?.iso) };
  }
  function contextSignature(context) {
    if (Array.isArray(context)) return canonical(context.map(value => JSON.parse(contextSignature(value))));
    if (!context) return canonical(context);
    const out = clone(context);
    if (out.protocolIdentity) delete out.protocol;
    if (out.metricProtocolIdentity) delete out.metricProtocol;
    if (out.pairedProtocolIdentity) delete out.pairedProtocol;
    return canonical(out);
  }
  const factoryText = (id, field, value) => root.Def.factoryText ? root.Def.factoryText(id, field, value) : value;
  function compatibleContext(d, context) {
    if (!context) return context;
    const out = { ...context, metricProtocol: root.Def.viftProtocol(d.id, context.metricProtocol) };
    if (!/(?:force|impulse|^imtp_(?:f|rfd)\d)/.test(d.id)) delete out.force;
    if (!d.legacyManual) {
      out.protocol = factoryText(d.testId, "testProtocol", out.protocol);
      out.metricProtocol = factoryText(d.id, "protocol", out.metricProtocol);
      if (d.id === "rqr" && out.pairedProtocol !== undefined) out.pairedProtocol = factoryText("hop", "testProtocol", out.pairedProtocol);
    }
    out.protocolIdentity ||= M.protocolIdentity("test:" + d.testId,out.protocol);
    out.metricProtocolIdentity ||= M.protocolIdentity("metric:" + d.id,out.metricProtocol);
    if (d.id === "rqr") out.pairedProtocolIdentity ||= M.protocolIdentity("test:hop",out.pairedProtocol);
    return out;
  }
  function normalizeFactoryText(definition) {
    if (definition.legacyManual) return false;
    const textFields = () => canonical({ name:definition.name, protocol:definition.protocol, context:definition.context });
    const before = textFields();
    for (const field of ["name", "protocol"]) definition[field] = factoryText(definition.id, field, definition[field]);
    if (definition.context) definition.context = compatibleContext(definition, definition.context);
    return before !== textFields();
  }
  const imtpTimeContext = record => clone(M.imtpTimeContext(record));
  const imtpTimeMatches = (record, rule) => contextSignature({ ...rule.context, protocolIdentity: rule.context.protocolIdentity || M.protocolIdentity("test:imtp",rule.context.protocol) }) === contextSignature(imtpTimeContext(record));
  const timeStandards = record => (record.imtpTimeStandards || []).map(({ matched, ...rule }) => clone(rule)).sort((a,b) => a.timeMs-b.timeMs || a.kind.localeCompare(b.kind));
  function capture(record) {
    return {
      definitions: record.definitions.map(d => { const definition = { ...clone(d), context: measurementContext(record, d) }; normalizeFactoryText(definition); return definition; }).sort((a,b) => a.id.localeCompare(b.id)),
      rules: clone(record.rules), axes: clone(record.axes),
      iso: record.data.iso.map(row => ({ id: row.id, direction: row.direction, ...isoContext(row, record), target: row.target ?? "", ...(row.reference !== undefined ? {reference:clone(row.reference)} : {}) })).sort((a,b) => a.id.localeCompare(b.id)),
      balance: record.balancePairs.map(pair => ({ ...clone(pair), contexts: [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(r => r.id === id); return row ? isoContext(row, record) : null; }) })).sort((a,b) => a.id.localeCompare(b.id)),
      lvp: Object.fromEntries(Object.entries(record.lvp).map(([id, p]) => {const testId=id.startsWith("landmine") ? "landmine" : id;return [id, { ...clone(p), protocol: record.protocol?.[testId] || "", protocolIdentity: record.protocolIdentities?.[testId] || M.protocolIdentity("test:"+testId,record.protocol?.[testId]) }];})),
      imtpTimeStandards: timeStandards(record),
    };
  }
  function signature(criteria) {
    // Names and descriptive grouping are retained for editing but cannot merge incompatible measurement conditions.
    return canonical({ ...criteria, imtpTimeStandards: criteria.imtpTimeStandards || [] });
  }
  function create(record, name = "评价方案") {
    const profile = { id: "evaluation_" + uid(), name, revision: 1, updated: now(), disabled: false, criteria: capture(record) };
    if (root.RingsideIsoReferences) {
      if (!record.demo) root.RingsideIsoReferences.seedCriteria(profile.criteria);
      profile.isoReferencesVersion = 1;
    }
    return profile;
  }
  function resolve(record, profile) {
    const out = clone(record);
    if (!profile) return out;
    const c = profile.criteria, definitions = new Map(c.definitions.map(d => [d.id, d]));
    out.evaluationIssues = [];
    out.imtpTimeStandards = (c.imtpTimeStandards || []).map(rule => {
      const matched = imtpTimeMatches(record, rule);
      if (!matched && record.enabled.imtp) out.evaluationIssues.push({ id: "imtp_" + (rule.kind === "force_pct_peak" ? "f" : "rfd") + rule.timeMs, reason: "IMTP 时点标准与测量条件不匹配" });
      return { ...clone(rule), matched };
    });
    for (const d of out.definitions) {
      normalizeFactoryText(d);
      const rule = definitions.get(d.id);
      if (rule && contextSignature(compatibleContext(rule, rule.context)) === contextSignature(compatibleContext(d, measurementContext(record, d)))) {
        d.target = null; d.ranges = []; d.referenceEnabled = false;
        for (const key of ["target", "ranges", "direction", "referenceEnabled", "source", "referenceMode", "referenceGroups"]) {
          if (rule[key] !== undefined) d[key] = clone(rule[key]);
          else if (["referenceMode", "referenceGroups"].includes(key)) delete d[key];
        }
        delete d.referenceMatch;
        if (Array.isArray(rule.referenceGroups)) {
          const match = root.RingsideEvaluation.matchReferenceGroup?.(record, rule.referenceGroups, d.testId) || root.RingsideReferences?.matchReferenceGroup(record, rule.referenceGroups) || {group:null,eligible:false,reason:"未加载分层参考标准"};
          d.ranges = match.eligible ? clone(match.group.ranges) : [];
          // Target selection is independent of a literature table's RER eligibility.
          if (match.group && Number.isFinite(match.group.target) && match.group.target > 0) d.target = match.group.target;
          if (match.group) d.source = match.group.source;
          d.referenceMatch = {groupId:match.group?.id||null,eligible:match.eligible,reason:match.reason,sourceId:match.group?.sourceId||"",source:match.group?.source||""};
          if (!match.eligible && rule.referenceEnabled && record.enabled[d.testId]) out.evaluationIssues.push({id:d.id,reason:match.reason});
        }
      } else {
        d.referenceEnabled = false; d.target = null; d.ranges = [];
        if (record.enabled[d.testId]) out.evaluationIssues.push({ id: d.id, reason: rule ? "评价方案与测量条件不匹配" : "方案未包含该指标" });
      }
      if (out.imtpTimeStandards.some(rule => d.id === "imtp_" + (rule.kind === "force_pct_peak" ? "f" : "rfd") + rule.timeMs)) {
        d.referenceEnabled = false; d.target = null; d.ranges = [];
      }
    }
    out.rules = clone(c.rules); out.axes = clone(c.axes);
    for (const row of out.data.iso) {
      const rule = c.iso.find(v => v.id === row.id);
      const matches = rule && contextSignature(isoContext(row, record)) === contextSignature({region:rule.region,directionCode:rule.directionCode,paired:rule.paired,unit:rule.unit,protocol:rule.protocol,protocolIdentity:rule.protocolIdentity || M.protocolIdentity("iso:"+row.id,rule.protocol),projectProtocolIdentity:rule.projectProtocolIdentity || record.protocolIdentities?.iso});
      row.target = matches ? rule.target : "";
      if (matches && rule.reference !== undefined) row.reference = clone(rule.reference);
      else delete row.reference;
      if (rule && !matches && record.enabled.iso && M.selectedIsoRows(record).some(item => item.id === row.id)) out.evaluationIssues.push({ id: row.id, reason: "等长目标的单位或协议不匹配" });
    }
    for (const pair of out.balancePairs) {
      const rule = c.balance.find(p => p.id === pair.id);
      const contexts = [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(r => r.id === id); return row ? isoContext(row, record) : null; });
      if (rule && contextSignature(contexts) === contextSignature(rule.contexts)) {
        for (const key of ["ranges", "referenceEnabled", "source", "reference", "ratioMigrationIssue", "ratioMigrationOriginal"]) {
          if (rule[key] !== undefined) pair[key] = clone(rule[key]);
          else if (["reference", "ratioMigrationIssue", "ratioMigrationOriginal"].includes(key)) delete pair[key];
        }
      } else { pair.referenceEnabled = false; pair.ranges = []; delete pair.reference; }
    }
    for (const [id, p] of Object.entries(out.lvp)) {
      const rule = c.lvp[id];
      const testId = id.startsWith("landmine") ? "landmine" : id;
      if (rule && rule.metric === p.metric && canonical(rule.protocolIdentity || M.protocolIdentity("test:"+testId,rule.protocol)) === canonical(record.protocolIdentities?.[testId] || M.protocolIdentity("test:"+testId,record.protocol?.[testId]))) {
        p.mvt = rule.mvt; p.zones = clone(rule.zones); if (rule.source !== undefined) p.source = rule.source; else delete p.source;
      } else { p.mvt = ""; p.zones = []; }
    }
    return out;
  }
  function template(profile) {
    const r = M.defaults(), c = profile.criteria;
    r.definitions = clone(c.definitions);
    r.definitions.forEach(normalizeFactoryText);
    r.rules = clone(c.rules); r.axes = clone(c.axes);
    r.data.iso = c.iso.map(row => ({ ...clone(row), left: "", right: "", center: "", painLeft: false, painRight: false, painCenter: false, notes: "" }));
    r.balancePairs = clone(c.balance); r.lvp = clone(c.lvp);
    r.imtpTimeStandards = clone(c.imtpTimeStandards || []);
    for (const d of r.definitions) {
      r.protocol[d.testId] = d.context.protocol;
      if (d.id === "rqr" && d.context.pairedProtocol !== undefined) r.protocol.hop = d.context.pairedProtocol;
      if (d.context.force) r[d.testId === "cmj" ? "cmjConfig" : "imtpConfig"] = clone(d.context.force);
    }
    for (const [id,p] of Object.entries(c.lvp)) r.protocol[id.startsWith("landmine") ? "landmine" : id] = p.protocol;
    return r;
  }
  function fromTemplate(draft, original) {
    const c = capture(draft);
    // Definition conditions belong to the source measurement and never change through target editing.
    c.definitions.forEach(d => { const prior = original.criteria.definitions.find(x => x.id === d.id); if (prior) d.context = clone(prior.context); normalizeFactoryText(d); });
    c.imtpTimeStandards.forEach(rule => { const prior = (original.criteria.imtpTimeStandards || []).find(x => x.timeMs === rule.timeMs && x.kind === rule.kind); if (prior) rule.context = clone(prior.context); });
    return c;
  }
  function validateProfile(p) {
    if (!p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !p.name.trim() || !p.criteria) throw Error("评价方案格式无效");
    if (!Number.isSafeInteger(p.revision) || p.revision < 1) throw Error("评价方案版本无效");
    const c = p.criteria;
    M.validateIMTPTimeStandards(c.imtpTimeStandards);
    if (p.previous?.criteria) M.validateIMTPTimeStandards(p.previous.criteria.imtpTimeStandards);
    for (const key of ["definitions", "iso", "balance"]) if (!Array.isArray(c[key])) throw Error("评价方案缺少 " + key);
    for (const definition of c.definitions) root.RingsideReferences?.validateReferenceGroups(definition.referenceGroups);
    for (const definition of p.previous?.criteria?.definitions || []) root.RingsideReferences?.validateReferenceGroups(definition.referenceGroups);
    if (!c.rules || !c.axes || !c.lvp) throw Error("评价方案配置不完整");
    const r = template(p);
    const ids = new Set(r.definitions.map(d => d.testId));
    r.customTests = [...ids].filter(id => !M.TESTS.some(t => t[0] === id)).map(id => ({id, name:id, category:r.definitions.find(d => d.testId === id).category}));
    M.validateRecord(r);
    for (const d of c.definitions) if (!d.context || typeof d.context.unit !== "string") throw Error("指标测量条件不完整");
    for (const row of c.iso) if (row.target !== "" && row.target !== null && (!Number.isFinite(Number(row.target)) || Number(row.target) <= 0)) throw Error("等长目标须为正数或留空");
    for (const p of Object.values(c.lvp)) {
      if (p.mvt !== "" && p.mvt !== null && (!Number.isFinite(Number(p.mvt)) || Number(p.mvt) <= 0)) throw Error("MVT 须为正数或留空");
      for (const z of p.zones) if (!Number.isFinite(z.min) || !Number.isFinite(z.max) || z.min < 0 || z.max <= z.min) throw Error("LVP 素质区间无效");
    }
    return true;
  }
  const newStandardIds = new Set(["dj_rsi","hop_rsi","cmrj_rsi","cmj_rsi_modified","sj_rsi_modified","cmrj_first_rsi_modified"]);
  function hasInstalledStandard(definition) {
    return !!definition && (definition.testId === "cpet" || newStandardIds.has(definition.id));
  }
  function upgradeLibraryProfiles(library) {
    if (!Array.isArray(library?.evaluationProfiles)) return false;
    const defaults = capture(M.defaults()).definitions;
    const isOldUnmodified = d => !d.legacyManual && d.target == null && d.referenceEnabled === false &&
      Array.isArray(d.ranges) && !d.ranges.length && d.referenceGroups === undefined &&
      d.source === "用户配置评价标准" && d.protocol === "使用实际测试协议与匹配评价标准";
    let changed = false;
    const upgrade = criteria => {
      if (!criteria?.definitions) return false;
      let touched = false;
      for (const builtin of defaults.filter(hasInstalledStandard)) {
        const prior = criteria.definitions.find(d => d.id === builtin.id);
        if (!prior) { criteria.definitions.push(clone(builtin)); touched = true; }
        else if (newStandardIds.has(prior.id) && builtin.referenceEnabled && builtin.ranges.length && isOldUnmodified(prior) && prior.unit === builtin.unit && prior.testId === builtin.testId) {
          for (const key of ["target","ranges","referenceEnabled","source"]) prior[key] = clone(builtin[key]);
          touched = true;
        }
      }
      return touched;
    };
    const records = (library.athletes || []).flatMap(a => a.records || []);
    for (const profile of library.evaluationProfiles) {
      const previous = {name:profile.name,criteria:clone(profile.criteria),revision:profile.revision,updated:profile.updated};
      let touched = upgradeIsoCriteria(profile.criteria);
      for (const definition of profile.criteria?.definitions || []) if (normalizeFactoryText(definition)) changed = true;
      if (profile.builtinStandardsVersion !== 1) {touched = upgrade(profile.criteria) || touched;profile.builtinStandardsVersion = 1;changed = true;}
      if (root.RingsideIsoReferences && profile.isoReferencesVersion !== 1) {
        const linked = records.filter(record => record.evaluationProfileId === profile.id);
        const demo = profile.demo || linked.length > 0 && linked.every(record => record.demo);
        if (!demo) touched = root.RingsideIsoReferences.seedCriteria(profile.criteria) || touched;
        profile.isoReferencesVersion = 1;
        changed = true;
      }
      if (touched) { profile.previous = previous; profile.revision += 1; profile.updated = now(); }
      if (touched) changed = true;
    }
    return changed;
  }
  function upgradeIsoCriteria(criteria) {
    if (!criteria) return false;
    const before = canonical({iso:criteria.iso,balance:criteria.balance});
    (criteria.iso || []).forEach(M.normalizeIsoDirection);
    (criteria.balance || []).forEach(pair => M.migrateBalancePair(pair, criteria.iso || []));
    return before !== canonical({iso:criteria.iso,balance:criteria.balance});
  }
  function materialize(record, profile) {
    const out = profile ? resolve(record, profile) : clone(record);
    // Explicit absence survives a standalone export, whose new shared scheme must not seed it again.
    for (const row of out.data.iso) if ((row.target === "" || row.target == null) && row.reference === undefined) row.reference = null;
    for (const pair of out.balancePairs) if (!pair.source && !pair.ranges.length && !pair.referenceEnabled && pair.reference === undefined) pair.reference = null;
    // Keep the descriptive mode in the narrative basis; resolved targets/ranges already freeze the matching group.
    for (const definition of out.definitions) delete definition.referenceGroups;
    return out;
  }
  function migrate(input) {
    if (input?.schema === 3 && input.kind === "athlete-library") {
      const lib = clone(input);
      for (const athlete of lib.athletes || []) athlete.records = (athlete.records || []).map(M.normalizeRecord);
      upgradeLibraryProfiles(lib);
      lib.evaluationProfiles.forEach(p => { p.criteria.imtpTimeStandards ??= []; if (p.previous?.criteria) p.previous.criteria.imtpTimeStandards ??= []; validateProfile(p); }); return lib;
    }
    const legacy = M.normalizeLibrary(input), profiles = [], seen = new Map(), counts = new Map();
    for (const a of legacy.athletes) for (const r of a.records) {
      const c = capture(r), sig = signature(c);
      let profile = seen.get(sig);
      if (!profile) { profile = create(r, r.evaluationSnapshot?.name || "原有评价方案 " + (profiles.length + 1)); if(Number.isSafeInteger(r.evaluationSnapshot?.revision)&&r.evaluationSnapshot.revision>0)profile.revision=r.evaluationSnapshot.revision; profiles.push(profile); seen.set(sig, profile); }
      r.evaluationProfileId = profile.id; counts.set(profile.id, (counts.get(profile.id) || 0) + 1);
    }
    if (!profiles.length) profiles.push(create(M.defaults(), "默认评价方案"));
    const defaultProfile = [...profiles].sort((a,b) => (counts.get(b.id)||0)-(counts.get(a.id)||0) || a.id.localeCompare(b.id))[0];
    return { ...legacy, schema: 3, groups: [], evaluationProfiles: profiles, defaultEvaluationProfileId: defaultProfile.id,
      athletes: legacy.athletes.map(a => ({...a, groupId:"", archived:false, deletedAt:null, records:a.records.map(r=>({...r,archived:false,deletedAt:null}))})) };
  }
  root.RingsideEvaluation = { canonical, capture, signature, create, resolve, template, fromTemplate, validateProfile, migrate, imtpTimeContext, imtpTimeMatches, upgradeLibraryProfiles, upgradeIsoCriteria, materialize, hasInstalledStandard, measurementContext, isoContext, compatibleContext, contextSignature };
})(typeof window !== "undefined" ? window : globalThis);

// Version 2 profiles contain evaluation rules, not copies of measurement definitions.
// The non-enumerable criteria adapter is only for older in-process callers and exports.
(function (root) {
  "use strict";
  const E = root.RingsideEvaluation, M = root.RingsideModel, T = root.RingsideTests;
  const legacy = { ...E }, clone = value => JSON.parse(JSON.stringify(value)), number = value => root.Calc.num(value);
  const metadata = new WeakMap(), definitions = new Map();
  const safe = value => typeof value === "string" && /^[A-Za-z0-9_:.\-]+$/.test(value);
  const subjectId = rule => rule.subjectId || rule.id;
  const defaults = () => M.defaults();
  function remember(source) { for (const d of source?.definitions || []) definitions.set(d.id, clone(d)); }
  function sourceRecord(source) {
    if (source?.data && source?.definitions) { remember(source); return source; }
    if (source?.catalog) source = source.catalog;
    if (source?.tests && source?.definitions) {
      remember(source);
      return M.recordFromCatalog(source, {}, Object.fromEntries(source.tests.map(test => [test.id, true])));
    }
    const current = root.App?.getLibrary?.()?.catalog;
    if (current) return sourceRecord(current);
    const record = defaults(); remember(record); return record;
  }
  function descriptor(id, record) { return record?.definitions?.find(d => d.id === id) || definitions.get(id) || defaults().definitions.find(d => d.id === id); }
  function ruleFromDefinition(d) {
    const enabled = d.referenceEnabled === true;
    return { id: "metric:" + d.id, kind: "metric", testId: d.testId, metricId: d.id,
      context: clone(E.compatibleContext(d, d.context)), enabled, targetEnabled: number(d.target) !== null || !!d.referenceGroups?.some(group=>number(group.target)!==null), rangesEnabled: !!d.ranges?.length || !!d.referenceGroups?.length,
      target: number(d.target), direction: d.direction || "higher", ranges: clone(d.ranges || []), source: typeof d.source === "string" ? d.source : "",
      ...(d.referenceGroups ? { referenceGroups: clone(d.referenceGroups) } : {}),
      legacyRangesSignature: E.canonical(d.ranges || []) };
  }
  function fromCriteria(criteria, source) {
    const c = clone(criteria), record = sourceRecord(source);
    M.validateIMTPTimeStandards(c.imtpTimeStandards);
    remember({ definitions: c.definitions });
    let standards = (c.definitions || []).map(d => ruleFromDefinition({ ...d, context: d.context || E.measurementContext(record, d) }));
    for (const rule of c.imtpTimeStandards || []) standards.push({ id: "imtp-time:" + rule.kind + ":" + rule.timeMs,
      kind: "imtp-time", testId: "imtp", timeMs: rule.timeMs, measureKind: rule.kind, context: { ...clone(rule.context), protocolIdentity: rule.context.protocolIdentity || M.protocolIdentity("test:imtp",rule.context.protocol) },
      enabled: !!rule.referenceEnabled, targetEnabled: number(rule.target) !== null, rangesEnabled: !!rule.ranges?.length,
      target: number(rule.target), direction: rule.direction || "higher", ranges: clone(rule.ranges || []), source: rule.source || "",
      legacyRangesSignature: E.canonical(rule.ranges || []) });
    const aliases = new Map();
    for (const rule of standards.filter(rule=>rule.kind === "metric" && /^imtp_rfd\d+(?:\.\d+)?$/.test(rule.metricId) && !c.definitions.find(d=>d.id===rule.metricId)?.legacyManual)) {
      const timeMs = Number(rule.metricId.slice(8)), id = "imtp-time:rfd:" + timeMs;
      aliases.set(rule.id,id);
      if (!standards.some(item=>item.id===id) && (rule.enabled || rule.target != null || rule.ranges.length)) standards.push({ ...rule, id, kind:"imtp-time", timeMs, measureKind:"rfd", context:{protocol:rule.context.protocol,protocolIdentity:rule.context.protocolIdentity,force:rule.context.force || E.imtpTimeContext(record).force} });
      standards = standards.filter(item=>item!==rule);
    }
    for (const row of c.iso || []) standards.push({ id: "iso:" + row.id, kind: "iso", testId: "iso", directionId: row.id,
      context: { region: row.region, directionCode: row.directionCode, paired: row.paired, unit: row.unit, protocol: row.protocol || "", protocolIdentity: row.protocolIdentity || M.protocolIdentity("iso:"+row.id,row.protocol), projectProtocolIdentity: row.projectProtocolIdentity || record.protocolIdentities?.iso || M.protocolIdentity("test:iso",record.protocol?.iso) },
      enabled: true, targetEnabled: number(row.target) !== null, rangesEnabled: false, target: number(row.target), direction: "higher", ranges: [], source: "",
      ...(row.reference !== undefined ? { reference: clone(row.reference) } : {}) });
    for (const pair of c.balance || []) standards.push({ id: "balance:" + pair.id, kind: "balance", testId: "iso", pairId: pair.id,
      context: { numeratorId: pair.numeratorId, denominatorId: pair.denominatorId, contexts: (pair.contexts || []).map((context,index)=>context ? {...clone(context),protocolIdentity:context.protocolIdentity || M.protocolIdentity("iso:"+[pair.numeratorId,pair.denominatorId][index],context.protocol),projectProtocolIdentity:context.projectProtocolIdentity || record.protocolIdentities?.iso || M.protocolIdentity("test:iso",record.protocol?.iso)} : null) },
      enabled: true, targetEnabled: false, rangesEnabled: !!pair.referenceEnabled, target: null, direction: "higher", ranges: clone(pair.ranges || []), source: pair.source || "",
      ...(pair.reference !== undefined ? { reference: clone(pair.reference) } : {}), legacyRangesSignature: E.canonical(pair.ranges || []),
      ...(pair.ratioMigrationIssue ? { migrationIssue: pair.ratioMigrationIssue, legacy: clone(pair.ratioMigrationOriginal) } : {}) });
    const aggregations = {};
    for (const [key, axis] of Object.entries(c.axes || {})) {
      const ability = key.startsWith("ability:") ? key.slice(8) : key;
      if (axis.method === "min") aggregations[T.axisKey(ability)] = { method: "disabled", migrationIssue: "原最低达成汇总已停用，请选择代表指标或明确计分后平均", legacy: clone(axis) };
      else if (axis.method === "mean") aggregations[T.axisKey(ability)] = Array.isArray(axis.members) && axis.transforms ? clone(axis) : { method: "mean", members: (c.definitions || []).filter(d => d.ability === ability && d.category === "performance" && d.scoring !== false && d.referenceEnabled && number(d.target) > 0).map(d => "metric:" + d.id), transforms: {}, migrationIssue: "请为已固定的参与指标设置计分规则", legacy: clone(axis) };
      else if (axis.method === "disabled") aggregations[T.axisKey(ability)] = clone(axis);
      else aggregations[T.axisKey(ability)] = { method: "primary", primary: axis.primary ? (String(axis.primary).includes(":") ? axis.primary : "metric:" + axis.primary) : "" };
    }
    // Freeze the previous deterministic representative choice instead of making it depend on available data.
    const definitionOrder = [...record.definitions.map(d => (c.definitions || []).find(item => item.id === d.id)).filter(Boolean), ...(c.definitions || []).filter(d => !record.definitions.some(item => item.id === d.id))];
    for (const d of definitionOrder) if (d.category === "performance" && d.scoring !== false && d.ability && !aggregations[T.axisKey(d.ability)] && d.referenceEnabled && number(d.target) > 0)
      aggregations[T.axisKey(d.ability)] = { method: "primary", primary: "metric:" + d.id };
    for (const axis of Object.values(aggregations)) {
      if (axis.primary) axis.primary = aliases.get(axis.primary) || axis.primary;
      if (axis.members) axis.members = [...new Set(axis.members.map(id=>aliases.get(id)||id))];
      if (axis.transforms) for (const [from,to] of aliases) if (axis.transforms[from]) { axis.transforms[to] = axis.transforms[from]; delete axis.transforms[from]; }
    }
    return { standards, aggregations, settings: { thresholds: clone(c.rules || record.rules), lvp: clone(c.lvp || {}) } };
  }
  function criteriaOf(profile, source) {
    const record = sourceRecord(source), c = legacy.capture(record);
    const ruleDefinitions = [];
    for (const rule of profile.standards) if (rule.kind === "metric") {
      const d = descriptor(rule.metricId, record) || { id: rule.metricId, testId: rule.testId, name: rule.metricId, unit: rule.context?.unit || "", ability: "", category: "performance", protocol: rule.context?.metricProtocol || "", entryScope: "record" };
      ruleDefinitions.push({ ...clone(d), context: clone(rule.context), target: rule.targetEnabled ? rule.target : null,
        ranges: rule.rangesEnabled ? clone(rule.ranges) : [], direction: rule.direction, referenceEnabled: rule.enabled && (rule.targetEnabled || rule.rangesEnabled), source: rule.source,
        ...(rule.referenceGroups ? { referenceGroups: clone(rule.referenceGroups), referenceMode: "grouped" } : {}) });
    }
    c.definitions = ruleDefinitions;
    c.rules = clone(profile.settings.thresholds); c.axes = clone(profile.aggregations); c.lvp = clone(profile.settings.lvp);
    c.imtpTimeStandards = profile.standards.filter(rule => rule.kind === "imtp-time").map(rule => ({ timeMs: rule.timeMs, kind: rule.measureKind, context: clone(rule.context),
      target: rule.enabled && rule.targetEnabled ? rule.target : null, ranges: rule.enabled && rule.rangesEnabled ? clone(rule.ranges) : [], direction: rule.direction,
      referenceEnabled: rule.enabled && (rule.targetEnabled || rule.rangesEnabled), source: rule.source, ...(rule.metricId ? {legacyMetricId:rule.metricId} : {}) }));
    c.iso = profile.standards.filter(rule => rule.kind === "iso").map(rule => {
      const row = record.data.iso.find(row => row.id === rule.directionId) || M.isoRows().find(row => row.id === rule.directionId) || {};
      return { id: rule.directionId, direction: row.direction || rule.directionId, ...clone(rule.context), target: rule.enabled && rule.targetEnabled ? rule.target ?? "" : "",
        ...(rule.reference !== undefined ? { reference: rule.enabled ? clone(rule.reference) : null } : {}) };
    });
    c.balance = profile.standards.filter(rule => rule.kind === "balance").map(rule => {
      const pair = record.balancePairs.find(pair => pair.id === rule.pairId) || {};
      return { ...clone(pair), id: rule.pairId, ...clone(rule.context), ranges: rule.enabled && rule.rangesEnabled ? clone(rule.ranges) : [], referenceEnabled: rule.enabled && rule.rangesEnabled, source: rule.source,
        ...(rule.reference !== undefined ? { reference: rule.enabled ? clone(rule.reference) : null } : {}), ...(rule.migrationIssue ? { ratioMigrationIssue: rule.migrationIssue, ratioMigrationOriginal: clone(rule.legacy) } : {}) };
    });
    return c;
  }
  function coreSignature(p) { return E.canonical({ standards: p.standards, aggregations: p.aggregations, settings: p.settings }); }
  function sync(profile) {
    const state = metadata.get(profile);
    if (state?.criteria && E.canonical(state.criteria) !== state.baseline) {
      Object.assign(profile, fromCriteria(state.criteria, state.source));
      state.baseline = E.canonical(state.criteria); state.signature = coreSignature(profile);
    }
  }
  function attach(profile, source) {
    if (metadata.has(profile)) return profile;
    const state = { source, criteria: null, baseline: "", signature: "" }; metadata.set(profile, state);
    Object.defineProperty(profile, "criteria", { configurable: true, enumerable: false, get() {
      sync(profile);
      const signature = coreSignature(profile);
      if (!state.criteria || state.signature !== signature) { state.criteria = criteriaOf(profile, state.source); state.baseline = E.canonical(state.criteria); state.signature = signature; }
      return state.criteria;
    }, set(value) { Object.assign(profile, fromCriteria(value, state.source)); state.criteria = null; } });
    return profile;
  }
  function normalizeProfile(input, source) {
    if (!input || typeof input !== "object") throw Error("评价方案格式无效");
    if (input.formatVersion === 2) {
      const criteriaProperty = Object.getOwnPropertyDescriptor(input, "criteria");
      if (criteriaProperty?.enumerable && criteriaProperty.value) {
        Object.assign(input, fromCriteria(criteriaProperty.value, source)); delete input.criteria;
      }
      sync(input);
      if (input.previous && input.previous.formatVersion !== 2) input.previous = serializeProfile(normalizeProfile({ ...input.previous, id: input.id }, source));
      if (!input.releases && input.previous) { const prior=clone(input.previous); delete prior.previous; delete prior.releases; input.releases=[prior]; }
      return attach(input, source);
    }
    if (!input.criteria) throw Error("评价方案缺少规则");
    const profile = {};
    for (const key of ["id", "name", "revision", "updated", "disabled", "demo", "isoReferencesVersion", "builtinStandardsVersion"]) if (input[key] !== undefined) profile[key] = clone(input[key]);
    profile.formatVersion = 2;
    Object.assign(profile, fromCriteria(input.criteria, source));
    if (input.previous?.criteria) profile.previous = serializeProfile(normalizeProfile({ ...input.previous, id: input.id }, source));
    if (profile.previous) { const prior=clone(profile.previous); delete prior.previous; delete prior.releases; profile.releases=[prior]; }
    return attach(profile, source);
  }
  function serializeProfile(input) {
    const p = normalizeProfile(input); sync(p);
    const out = {};
    for (const key of ["formatVersion", "id", "name", "revision", "updated", "disabled", "demo", "isoReferencesVersion", "builtinStandardsVersion", "standards", "aggregations", "settings", "migration", "releases"]) if (p[key] !== undefined) out[key] = clone(p[key]);
    if (p.previous) out.previous = serializeProfile({ ...p.previous, id: p.id });
    return out;
  }
  function ruleSubjects(source, input) {
    const record = sourceRecord(source), subjects = [];
    for (const d of record.definitions.filter(d=>d.legacyManual || !/^imtp_rfd\d+(?:\.\d+)?$/.test(d.id))) subjects.push({ id: "metric:" + d.id, kind: "metric", metricId: d.id, testId: d.testId,
      name: T.metricName(d), unit: d.unit, ability: d.ability || "", measurementScale: measurementScale(d),
      zeroValid: d.zeroValid === true || d.id === "pushup_reps", context: E.measurementContext(record, d), ...(!d.legacyManual && /^imtp_f\d+(?:\.\d+)?$/.test(d.id) ? {name:T.metricName(d)+" · 历史绝对力（N）",locked:true,historical:true} : {}) });
    for (const row of record.data.iso) subjects.push({ id: "iso:" + row.id, kind: "iso", directionId: row.id, testId: "iso", name: (M.REG[row.region] || row.region) + " · " + row.direction,
      unit: row.unit, ability: "", measurementScale: "ratio", zeroValid: true, paired: row.paired, context: E.isoContext(row, record) });
    for (const pair of record.balancePairs) subjects.push({ id: "balance:" + pair.id, kind: "balance", pairId: pair.id, testId: "iso", name: pair.label, unit: "比值", ability: "", measurementScale: "ratio",
      context: { numeratorId: pair.numeratorId, denominatorId: pair.denominatorId, contexts: [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(row => row.id === id); return row ? E.isoContext(row, record) : null; }) } });
    record.data.fms.forEach((row, i) => subjects.push({ id: "fms:" + i, kind: "fixed", testId: "fms", name: row.name, unit: "分", locked: true, measurementScale: "ordinal", context: {} }));
    const profile = input && normalizeProfile(input, record), times = new Set([...(profile?.standards || []).filter(rule => rule.kind === "imtp-time").map(rule => rule.timeMs),
      ...record.definitions.map(d => d.id.match(/^imtp_(?:f|rfd)(\d+)$/)?.[1]).filter(Boolean).map(Number), ...(record.data.imtp || []).flatMap(trial => (trial.timePoints || []).map(point => number(point.timeMs))).filter(time => time > 0)]);
    for (const timeMs of [...times].sort((a,b) => a-b)) for (const measureKind of ["force_pct_peak", "rfd"]) subjects.push({ id: "imtp-time:" + measureKind + ":" + timeMs, kind: "imtp-time", testId: "imtp", timeMs, measureKind,
      name: measureKind === "rfd" ? "0–" + timeMs + " ms 平均 RFD" : timeMs + " ms 力占峰值力比例", unit: measureKind === "rfd" ? "N/s" : "%PF", ability: "早期发力", measurementScale: "ratio", zeroValid: false, context: E.imtpTimeContext(record) });
    for (const rule of profile?.standards || []) if (!subjects.some(subject => subject.id === subjectId(rule))) subjects.push({ id: subjectId(rule), kind: rule.kind, testId: rule.testId, metricId: rule.metricId, directionId: rule.directionId, pairId: rule.pairId,
      timeMs: rule.timeMs, measureKind: rule.measureKind, name: rule.metricId || rule.directionId || rule.pairId || rule.id, unit: rule.context?.unit || "", ability: "", measurementScale: "unknown", context: clone(rule.context), historical: true });
    subjects.forEach(subject => { subject.capabilities = { target: !["balance", "fixed"].includes(subject.kind), ranges: !["iso", "fixed"].includes(subject.kind), reference: ["iso", "balance"].includes(subject.kind), referenceGroups: subject.kind === "metric", conditions: !subject.locked }; });
    return subjects;
  }
  function measurementScale(d) {
    if (d.ratioEligible === true) return "ratio";
    if (d.ratioEligible === false) return d.measurementScale === "ordinal" ? "ordinal" : "unknown";
    if (/(?:slope|drf|imbalance)/i.test(d.id)) return "unknown";
    if (["ratio", "interval", "ordinal", "unknown"].includes(d.measurementScale)) return d.measurementScale;
    return T.isManualMetric(d) ? "unknown" : "ratio";
  }
  function ensureStandard(input, subject) {
    const p = normalizeProfile(input); sync(p);
    let rule = p.standards.find(rule => subjectId(rule) === subject.id);
    if (rule) return rule;
    if (subject.locked) throw Error("固定评分不允许编辑");
    rule = { id: subject.id, kind: subject.kind, testId: subject.testId, context: clone(subject.context), enabled: true,
      targetEnabled: false, rangesEnabled: false, target: null, ranges: [], direction: "higher", source: "" };
    for (const key of ["metricId", "directionId", "pairId", "timeMs", "measureKind"]) if (subject[key] !== undefined) rule[key] = subject[key];
    p.standards.push(rule); return rule;
  }
  function validateConditions(conditions) {
    if (conditions == null) return;
    if (typeof conditions !== "object" || Array.isArray(conditions) || conditions.sex !== undefined && !["any", "male", "female"].includes(conditions.sex)) throw Error("标准适用条件无效");
    for (const key of ["ageMin", "ageMax"]) if (conditions[key] != null && (!Number.isFinite(conditions[key]) || conditions[key] < 0)) throw Error("年龄条件须为非负数或留空");
    if (conditions.ageMax != null && conditions.ageMax <= (conditions.ageMin ?? 0)) throw Error("年龄条件上限须大于下限");
    if (conditions.mode !== undefined && typeof conditions.mode !== "string") throw Error("测试方式条件无效");
    if (conditions.minPeakRER != null && !(number(conditions.minPeakRER) > 0)) throw Error("峰值 RER 条件无效");
  }
  function conditionsMatch(record, conditions, testId) {
    if (!conditions) return { eligible: true, reason: "" };
    const sex = { "男": "male", "男性": "male", male: "male", m: "male", "女": "female", "女性": "female", female: "female", f: "female" }[String(record.athlete?.sex || "").toLowerCase()], age = number(record.athlete?.age);
    if (conditions.sex && conditions.sex !== "any" && conditions.sex !== sex) return { eligible: false, reason: "性别不符合标准条件" };
    if (conditions.ageMin != null && (age === null || age < conditions.ageMin) || conditions.ageMax != null && (age === null || age >= conditions.ageMax)) return { eligible: false, reason: "年龄不符合标准条件" };
    if (conditions.mode && conditions.mode !== "any" && conditions.mode !== (testId === "cpet" ? record.data.cpet?.modality : record.mode)) return { eligible: false, reason: "测试方式不符合标准条件" };
    if (conditions.minPeakRER != null && (number(record.data.cpet?.rer) === null || number(record.data.cpet.rer) < conditions.minPeakRER)) return { eligible: false, reason: "所选参考表要求峰值 RER ≥ " + conditions.minPeakRER };
    return { eligible: true, reason: "" };
  }
  function matchReferenceGroup(record, groups, testId = "cpet") {
    const candidates = groups.filter(group => conditionsMatch(record, { ...group, minPeakRER: undefined }, testId).eligible);
    if (candidates.length !== 1) return { group: null, eligible: false, reason: candidates.length ? "适用标准存在重叠" : "未匹配年龄、性别或测试方式的参考标准" };
    return { group: candidates[0], ...conditionsMatch(record, candidates[0], testId) };
  }
  function validateGroups(groups) {
    if (groups === undefined) return;
    if (!Array.isArray(groups) || groups.length > 300) throw Error("分层标准格式无效");
    const ids = new Set();
    groups.forEach((group, i) => {
      if (!safe(group.id) || ids.has(group.id)) throw Error("分层标准编号缺失或重复"); ids.add(group.id); validateConditions(group);
      if (group.target != null && !(number(group.target) > 0)) throw Error("分层目标须为正数或留空");
      root.RingsideScoring.validateIntervals(group.ranges || []);
      for (const other of groups.slice(0, i)) if (((group.sex || "any") === "any" || (other.sex || "any") === "any" || group.sex === other.sex) && ((group.mode || "any") === "any" || (other.mode || "any") === "any" || group.mode === other.mode) && Math.max(group.ageMin ?? 0, other.ageMin ?? 0) < Math.min(group.ageMax ?? Infinity, other.ageMax ?? Infinity)) throw Error("分层标准的适用条件重叠");
    });
  }
  function validateProfile(input) {
    const p = normalizeProfile(input); sync(p);
    if (!safe(p.id) || typeof p.name !== "string" || !p.name.trim() || !Number.isSafeInteger(p.revision) || p.revision < 1 || !Array.isArray(p.standards) || p.standards.length > 1000 || !p.aggregations || !p.settings?.thresholds || !p.settings.lvp) throw Error("评价方案结构无效");
    const ids = new Set();
    for (const rule of p.standards) {
      if (!safe(rule.id) || ids.has(rule.id) || !["metric", "imtp-time", "iso", "balance"].includes(rule.kind) || !safe(rule.testId) || !rule.context ||
        ["enabled", "targetEnabled", "rangesEnabled"].some(key => typeof rule[key] !== "boolean") || !["higher", "lower"].includes(rule.direction) || typeof rule.source !== "string") throw Error("标准编号、开关或测量条件无效");
      ids.add(rule.id);
      if (rule.kind === "iso" && rule.rangesEnabled || rule.kind === "balance" && rule.targetEnabled) throw Error("该结果不支持此评价方式");
      if (rule.kind !== "metric" && rule.referenceGroups !== undefined) throw Error("该结果不支持通用分层标准");
      if (rule.target != null && (!Number.isFinite(rule.target) || rule.target <= 0)) throw Error("评价目标须为正数或留空");
      if (rule.kind === "metric" && (!safe(rule.metricId) || typeof rule.context.unit !== "string")) throw Error("指标标准缺少测量身份");
      for (const key of ["protocolIdentity","metricProtocolIdentity","pairedProtocolIdentity","projectProtocolIdentity"]) if (rule.context[key]!==undefined && (!safe(rule.context[key]?.id) || !Number.isSafeInteger(rule.context[key]?.version) || rule.context[key].version<1)) throw Error("标准的测量协议身份无效");
      if (rule.kind === "imtp-time") M.validateIMTPTimeStandards([{ kind: rule.measureKind, timeMs: rule.timeMs, context: rule.context, target: rule.target, ranges: rule.ranges, direction: rule.direction, referenceEnabled: rule.enabled, source: rule.source }]);
      root.RingsideScoring.validateIntervals(rule.ranges, { legacy: rule.legacyRangesSignature === E.canonical(rule.ranges) });
      for (const key of ["conditions", "targetConditions", "rangesConditions"]) validateConditions(rule[key]);
      validateGroups(rule.referenceGroups);
      if (rule.reference !== undefined) root.RingsideIsoReferences?.validateReference(rule.reference, rule.kind === "balance");
    }
    for (const [key, value] of Object.entries(p.settings.thresholds)) {
      const error = M.validateField({ rules: p.settings.thresholds }, "rules." + key, value); if (error) throw Error(error);
      if (["scoreAmber", "scoreGreen"].includes(key) && number(value) > 100) throw Error("目标达成阈值不得超过 100");
    }
    for (const axis of Object.values(p.aggregations)) {
      if (!["primary", "mean", "disabled"].includes(axis.method)) throw Error("能力展示方式无效");
      if (axis.method === "disabled") continue;
      if (axis.method === "primary" && (typeof axis.primary !== "string" || !axis.primary)) throw Error("请选择代表指标");
      if (axis.method === "mean") {
        const pending = axis.migrationIssue && axis.legacy?.method === "mean";
        if (!Array.isArray(axis.members) || !axis.members.length && !pending || new Set(axis.members).size !== axis.members.length || !axis.transforms) throw Error("请选择不重复的固定平均成员");
        for (const member of axis.members) if (axis.transforms[member] || !pending) root.RingsideScoring.validateTransform(axis.transforms[member]);
        if (axis.ranges) root.RingsideScoring.validateIntervals(axis.ranges);
      }
    }
    for (const setting of Object.values(p.settings.lvp)) {
      if (!["MV", "MPV", "PV"].includes(setting.metric) || setting.mvt !== "" && setting.mvt != null && !(number(setting.mvt) > 0) || !Array.isArray(setting.zones)) throw Error("LVP 分析设置无效");
      for (const zone of setting.zones) if (!Number.isFinite(zone.min) || !Number.isFinite(zone.max) || zone.min < 0 || zone.max <= zone.min || !zone.label) throw Error("LVP 速度区间无效");
    }
    if (p.releases !== undefined) {
      if (!Array.isArray(p.releases) || p.releases.length>10000) throw Error("方案历史格式无效");
      for (const release of p.releases) { if (release.releases || release.previous) throw Error("历史版本不能嵌套其他历史"); validateProfile({...release,id:p.id}); }
    }
    return true;
  }
  function resolve(record, input) {
    if (!input) {
      const out = legacy.resolve(record, { criteria: { definitions: [], iso: [], balance: [], imtpTimeStandards: [], rules: clone(defaults().rules), axes: {}, lvp: {} } });
      out.evaluationProfileFormat = 2; out.evaluationStandards = [];
      out.evaluationIssues = [{ id: "profile", reason: "未关联有效评价方案" }]; return out;
    }
    const p = normalizeProfile(input, record); sync(p);
    const c = criteriaOf(p, record), unitFactors = new Map();
    const convertRanges = (ranges,factor) => ranges.map(range=>({...range,min:range.min==null?null:range.min*factor,max:range.max==null?null:range.max*factor}));
    for (const definition of c.definitions) {
      const measurement=record.definitions.find(d=>d.id===definition.id),factor=measurement && M.unitFactor(definition.context.unit,measurement.unit);
      if (!measurement || !T.isManualMetric(measurement) || factor==null || factor===1) continue;
      unitFactors.set("metric:"+definition.id,factor); definition.unit=measurement.unit;definition.context.unit=measurement.unit;
      if (definition.target!=null) definition.target*=factor;definition.ranges=convertRanges(definition.ranges,factor);
      for (const group of definition.referenceGroups || []) {if(group.target!=null) group.target*=factor;group.ranges=convertRanges(group.ranges || [],factor);}
      for (const axis of Object.values(c.axes)) {const transform=axis.transforms?.["metric:"+definition.id];if(transform?.kind==="anchors") transform.points.forEach(point=>point.value*=factor);if(transform?.kind==="table") transform.ranges=convertRanges(transform.ranges,factor);}
    }
    const out = legacy.resolve(record, { criteria: c });
    out.evaluationProfileRevision = p.revision;
    out.evaluationProfileFormat = 2;
    out.evaluationStandards = [];
    for (const rule of p.standards) {
      const common = conditionsMatch(record, rule.conditions, rule.testId);
      const targetMatch = common.eligible ? conditionsMatch(record, rule.targetConditions, rule.testId) : common;
      const rangeMatch = common.eligible ? conditionsMatch(record, rule.rangesConditions, rule.testId) : common;
      const d = rule.kind === "metric" ? out.definitions.find(d => d.id === rule.metricId) : null;
      let matched = true;
      if (d) {
        const effectiveContext = unitFactors.has(rule.id) ? {...rule.context,unit:d.unit} : rule.context;
        matched = E.contextSignature(E.compatibleContext(d, effectiveContext)) === E.contextSignature(E.compatibleContext(d, E.measurementContext(record, d)));
        if (!rule.targetEnabled || !targetMatch.eligible) d.target = null;
        if (!rule.rangesEnabled || !rangeMatch.eligible) d.ranges = [];
        d.referenceEnabled = rule.enabled && matched && common.eligible && ((!rule.targetEnabled && !rule.rangesEnabled) || (rule.targetEnabled && targetMatch.eligible) || (rule.rangesEnabled && rangeMatch.eligible));
        d.targetEnabled = rule.enabled && rule.targetEnabled && targetMatch.eligible && matched;
        d.rangesEnabled = rule.enabled && rule.rangesEnabled && rangeMatch.eligible && matched;
      }
      if (rule.kind === "imtp-time") {
        const time = out.imtpTimeStandards.find(item => item.kind === rule.measureKind && item.timeMs === rule.timeMs);
        matched = time?.matched === true;
        if (time) { if (!targetMatch.eligible) time.target = null; if (!rangeMatch.eligible) time.ranges = []; time.referenceEnabled = rule.enabled && ((!rule.targetEnabled && !rule.rangesEnabled) || (rule.targetEnabled && targetMatch.eligible) || (rule.rangesEnabled && rangeMatch.eligible)); }
      }
      if (rule.kind === "iso") {
        const row = out.data.iso.find(row => row.id === rule.directionId);
        matched = !!row && E.contextSignature(rule.context) === E.contextSignature(E.isoContext(row, record));
        if (row) { if (!targetMatch.eligible) row.target = ""; if (!common.eligible) delete row.reference; }
      }
      if (rule.kind === "balance") {
        const pair = out.balancePairs.find(pair => pair.id === rule.pairId);
        const contexts = pair && [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(row => row.id === id); return row ? E.isoContext(row, record) : null; });
        matched = !!pair && pair.numeratorId === rule.context.numeratorId && pair.denominatorId === rule.context.denominatorId && E.contextSignature(contexts) === E.contextSignature(rule.context.contexts);
        if (pair && !common.eligible) delete pair.reference;
        if (pair && !rangeMatch.eligible) { pair.referenceEnabled = false; pair.ranges = []; }
      }
      const reason = !matched ? "评价方案与测量条件不匹配" : !common.eligible ? common.reason : !targetMatch.eligible && !rangeMatch.eligible ? targetMatch.reason : "";
      out.evaluationStandards.push({ subjectId: subjectId(rule), ruleId: rule.id, revision: p.revision, kind: rule.kind, metricId: rule.metricId, timeMs: rule.timeMs, measureKind: rule.measureKind,
        enabled: rule.enabled, applicable: matched && common.eligible, targetApplicable: rule.enabled && rule.targetEnabled && matched && targetMatch.eligible, rangesApplicable: rule.enabled && rule.rangesEnabled && matched && rangeMatch.eligible && d?.referenceMatch?.eligible !== false, reason });
      const visible = rule.kind === "iso" ? M.selectedIsoRows(record).some(row=>row.id===rule.directionId) : rule.kind === "balance" ? record.isoDirectionIds === undefined || [rule.context.numeratorId,rule.context.denominatorId].every(id=>record.isoDirectionIds.includes(id)) : true;
      if (reason && visible && record.enabled[rule.testId]) out.evaluationIssues.push({ id: rule.metricId || rule.directionId || rule.pairId || rule.id, reason });
    }
    return out;
  }
  function previewTransform(rule, transform, value, subject) {
    return root.RingsideScoring.evaluate(value, transform, { subject, target: rule.target, targetEnabled: rule.enabled && rule.targetEnabled, applicable: rule.enabled });
  }
  function changesBetween(before, after) {
    const a = serializeProfile(before), b = serializeProfile(after), changes = [];
    const push = (name, old, next) => { if (E.canonical(old) !== E.canonical(next)) changes.push([name, old == null ? "未设置" : typeof old === "object" ? JSON.stringify(old) : String(old), next == null ? "未设置" : typeof next === "object" ? JSON.stringify(next) : String(next)]); };
    push("方案名称", a.name, b.name);
    const subjects = new Map(ruleSubjects(undefined, b).map(subject => [subject.id, subject]));
    for (const id of new Set([...a.standards.map(rule => rule.id), ...b.standards.map(rule => rule.id)])) push(subjects.get(id)?.name || id, a.standards.find(rule => rule.id === id), b.standards.find(rule => rule.id === id));
    for (const key of new Set([...Object.keys(a.aggregations), ...Object.keys(b.aggregations)])) push("能力展示 · " + key.replace(/^ability:/, ""), a.aggregations[key], b.aggregations[key]);
    push("目标达成与双侧差异", a.settings.thresholds, b.settings.thresholds);
    for (const key of new Set([...Object.keys(a.settings.lvp), ...Object.keys(b.settings.lvp)])) push("分析参数 · " + key, a.settings.lvp[key], b.settings.lvp[key]);
    return changes;
  }
  function upgradeLibraryProfiles(library) {
    if (!Array.isArray(library?.evaluationProfiles)) return false;
    const oldProfiles = library.evaluationProfiles.filter(p => p.formatVersion !== 2);
    let changed = oldProfiles.length > 0;
    if (oldProfiles.length) legacy.upgradeLibraryProfiles({ ...library, evaluationProfiles: oldProfiles });
    library.evaluationProfiles = library.evaluationProfiles.map(input => normalizeProfile(input, library.catalog));
    return changed;
  }
  function migrationReport(before, after) {
    const priorRecords = before?.record ? [before.record] : (before?.athletes || []).flatMap(athlete=>athlete.records || []);
    const raw = value => Array.isArray(value) ? value.map(raw) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key])=>key!=="protocolIdentity").map(([key,item])=>[key,raw(item)])) : value;
    return { version: 1, records: (after.athletes || []).flatMap(athlete => (athlete.records || []).filter(record => record.measurementMigration).map(record => {
      const prior=priorRecords.find(item=>item.recordId===record.recordId);
      return { athleteId: athlete.id, recordId: record.recordId, ...clone(record.measurementMigration), rawUnchanged: prior ? E.canonical(raw(prior.data))===E.canonical(raw(record.data)) && E.canonical(prior.customValues)===E.canonical(record.customValues) : null };
    })),
      profiles: (after.evaluationProfiles || []).map(profile => ({ id: profile.id, name: profile.name, formatVersion: profile.formatVersion,
        aggregations: Object.entries(profile.aggregations || {}).filter(([, axis]) => axis.migrationIssue).map(([ability, axis]) => ({ ability, method: axis.method, reason: axis.migrationIssue, members: clone(axis.members || []), legacy: clone(axis.legacy || {}) })) })) };
  }
  Object.assign(E, { normalizeProfile, serializeProfile, ruleSubjects, ensureStandard, validateProfile, resolve, previewTransform, changesBetween, measurementScale, migrationReport,
    conditionsMatch, matchReferenceGroup, upgradeLibraryProfiles,
    create(record, name) { return normalizeProfile(legacy.create(record, name), record); },
    template(input, source) { const p = normalizeProfile(input, source); sync(p); return legacy.template({ criteria: criteriaOf(p, source) }); },
    fromTemplate(record, original) { const p = normalizeProfile(original, record); return legacy.fromTemplate(record, { criteria: criteriaOf(p, record) }); },
    signature(value) { return value?.formatVersion === 2 || value?.criteria ? coreSignature(normalizeProfile(value)) : legacy.signature(value); },
    materialize(record, profile) { const resolved = profile ? resolve(record, profile) : clone(record); const out = legacy.materialize(resolved); delete out.evaluationStandards; delete out.evaluationProfileRevision; delete out.evaluationProfileFormat; return out; },
    migrate(input) {
      if (input?.schema === 3 && input.kind === "athlete-library") {
        const library = clone(input); library.athletes.forEach(athlete => athlete.records = (athlete.records || []).map(M.normalizeRecord));
        upgradeLibraryProfiles(library); library.catalog = M.normalizeCatalog(library.catalog); library.evaluationProfiles.forEach(validateProfile); return library;
      }
      const exportedProfile = input?.evaluationProfile || (input?.profile?.formatVersion === 2 || input?.profile?.criteria ? input.profile : null);
      if (input?.record && exportedProfile) {
        const library = M.normalizeLibrary(input), record = library.athletes[0].records[0];
        const profile = normalizeProfile(exportedProfile, record); validateProfile(profile);
        record.evaluationProfileId = profile.id;
        return { ...library, schema: 3, groups: [], evaluationProfiles: [profile], defaultEvaluationProfileId: profile.id,
          athletes: library.athletes.map(athlete => ({ ...athlete, groupId: "", archived: false, deletedAt: null,
            records: athlete.records.map(value => ({ ...value, archived: false, deletedAt: null })) })) };
      }
      const library = legacy.migrate(input); library.evaluationProfiles = library.evaluationProfiles.map(p => normalizeProfile(p, library.catalog)); library.catalog = M.normalizeCatalog(library.catalog); return library;
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
