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
    const config = d.testId === "cmj" ? { definition: record.cmjConfig?.definition || "gross" } : d.testId === "imtp" ? { unit: record.imtpConfig?.unit || "N", definition: record.imtpConfig?.definition || "gross" } : null;
    if (config && /impulse/.test(d.id)) config.impulseDefinition = (d.testId === "cmj" ? record.cmjConfig : record.imtpConfig)?.impulseDefinition || "gross";
    return { unit: d.unit || "", protocol: record.protocol?.[d.testId] || "", metricProtocol: d.protocol || "", ...(config ? { force: clone(config) } : {}), ...(d.id === "rqr" ? { pairedProtocol: record.protocol?.hop || "" } : {}) };
  }
  function isoContext(row, record) {
    return { region: row.region, directionCode: row.directionCode || "custom_" + row.id, paired: row.paired, unit: row.unit, protocol: row.protocol || record.protocol?.iso || "" };
  }
  const factoryText = (id, field, value) => root.Def.factoryText ? root.Def.factoryText(id, field, value) : value;
  function compatibleContext(d, context) {
    if (!context) return context;
    const out = { ...context, metricProtocol: root.Def.viftProtocol(d.id, context.metricProtocol) };
    if (!d.legacyManual) {
      out.protocol = factoryText(d.testId, "testProtocol", out.protocol);
      out.metricProtocol = factoryText(d.id, "protocol", out.metricProtocol);
      if (d.id === "rqr" && out.pairedProtocol !== undefined) out.pairedProtocol = factoryText("hop", "testProtocol", out.pairedProtocol);
    }
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
  const imtpTimeContext = record => M.imtpTimeContext(record);
  const imtpTimeMatches = (record, rule) => canonical(rule.context) === canonical(imtpTimeContext(record));
  const timeStandards = record => (record.imtpTimeStandards || []).map(({ matched, ...rule }) => clone(rule)).sort((a,b) => a.timeMs-b.timeMs || a.kind.localeCompare(b.kind));
  function capture(record) {
    return {
      definitions: record.definitions.map(d => { const definition = { ...clone(d), context: measurementContext(record, d) }; normalizeFactoryText(definition); return definition; }).sort((a,b) => a.id.localeCompare(b.id)),
      rules: clone(record.rules), axes: clone(record.axes),
      iso: record.data.iso.map(row => ({ id: row.id, direction: row.direction, ...isoContext(row, record), target: row.target ?? "", ...(row.reference !== undefined ? {reference:clone(row.reference)} : {}) })).sort((a,b) => a.id.localeCompare(b.id)),
      balance: record.balancePairs.map(pair => ({ ...clone(pair), contexts: [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(r => r.id === id); return row ? isoContext(row, record) : null; }) })).sort((a,b) => a.id.localeCompare(b.id)),
      lvp: Object.fromEntries(Object.entries(record.lvp).map(([id, p]) => [id, { ...clone(p), protocol: record.protocol?.[id.startsWith("landmine") ? "landmine" : id] || "" }])),
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
      if (rule && canonical(compatibleContext(rule, rule.context)) === canonical(compatibleContext(d, measurementContext(record, d)))) {
        for (const key of ["target", "ranges", "direction", "referenceEnabled", "source", "referenceMode", "referenceGroups"]) {
          if (rule[key] !== undefined) d[key] = clone(rule[key]);
          else if (["referenceMode", "referenceGroups"].includes(key)) delete d[key];
        }
        delete d.referenceMatch;
        if (Array.isArray(rule.referenceGroups)) {
          const match = root.RingsideReferences?.matchReferenceGroup(record, rule.referenceGroups) || {group:null,eligible:false,reason:"未加载分层参考标准"};
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
      const matches = rule && canonical(isoContext(row, record)) === canonical({region:rule.region,directionCode:rule.directionCode,paired:rule.paired,unit:rule.unit,protocol:rule.protocol});
      row.target = matches ? rule.target : "";
      if (matches && rule.reference !== undefined) row.reference = clone(rule.reference);
      else delete row.reference;
      if (rule && !matches && record.enabled.iso && M.selectedIsoRows(record).some(item => item.id === row.id)) out.evaluationIssues.push({ id: row.id, reason: "等长目标的单位或协议不匹配" });
    }
    for (const pair of out.balancePairs) {
      const rule = c.balance.find(p => p.id === pair.id);
      const contexts = [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(r => r.id === id); return row ? isoContext(row, record) : null; });
      if (rule && canonical(contexts) === canonical(rule.contexts)) {
        for (const key of ["ranges", "referenceEnabled", "source", "reference", "ratioMigrationIssue", "ratioMigrationOriginal"]) {
          if (rule[key] !== undefined) pair[key] = clone(rule[key]);
          else if (["reference", "ratioMigrationIssue", "ratioMigrationOriginal"].includes(key)) delete pair[key];
        }
      } else { pair.referenceEnabled = false; pair.ranges = []; delete pair.reference; }
    }
    for (const [id, p] of Object.entries(out.lvp)) {
      const rule = c.lvp[id];
      if (rule && rule.metric === p.metric && (rule.protocol || "") === (record.protocol?.[id.startsWith("landmine") ? "landmine" : id] || "")) {
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
    if (!profiles.length) profiles.push(create(M.recordFromCatalog(legacy.catalog, {}, Object.fromEntries(legacy.catalog.tests.map(t => [t.id, true]))), "默认评价方案"));
    const defaultProfile = [...profiles].sort((a,b) => (counts.get(b.id)||0)-(counts.get(a.id)||0) || a.id.localeCompare(b.id))[0];
    return { ...legacy, schema: 3, groups: [], evaluationProfiles: profiles, defaultEvaluationProfileId: defaultProfile.id,
      athletes: legacy.athletes.map(a => ({...a, groupId:"", archived:false, deletedAt:null, records:a.records.map(r=>({...r,archived:false,deletedAt:null}))})) };
  }
  root.RingsideEvaluation = { canonical, capture, signature, create, resolve, template, fromTemplate, validateProfile, migrate, imtpTimeContext, imtpTimeMatches, upgradeLibraryProfiles, upgradeIsoCriteria, materialize, hasInstalledStandard };
})(typeof window !== "undefined" ? window : globalThis);
