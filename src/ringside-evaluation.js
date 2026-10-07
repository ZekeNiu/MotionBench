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
    const config = d.testId === "cmj" ? record.cmjConfig : d.testId === "imtp" ? record.imtpConfig : null;
    return { unit: d.unit || "", protocol: record.protocol?.[d.testId] || "", metricProtocol: d.protocol || "", ...(config ? { force: clone(config) } : {}) };
  }
  function isoContext(row, record) {
    return { region: row.region, directionCode: row.directionCode || "custom_" + row.id, paired: row.paired, unit: row.unit, protocol: row.protocol || record.protocol?.iso || "" };
  }
  function compatibleContext(id, context) {
    return context ? { ...context, metricProtocol: root.Def.viftProtocol(id, context.metricProtocol) } : context;
  }
  const imtpTimeContext = record => M.imtpTimeContext(record);
  const imtpTimeMatches = (record, rule) => canonical(rule.context) === canonical(imtpTimeContext(record));
  const timeStandards = record => (record.imtpTimeStandards || []).map(({ matched, ...rule }) => clone(rule)).sort((a,b) => a.timeMs-b.timeMs || a.kind.localeCompare(b.kind));
  function capture(record) {
    return {
      definitions: record.definitions.map(d => ({ ...clone(d), context: measurementContext(record, d) })).sort((a,b) => a.id.localeCompare(b.id)),
      rules: clone(record.rules), axes: clone(record.axes),
      iso: record.data.iso.map(row => ({ id: row.id, direction: row.direction, ...isoContext(row, record), target: row.target ?? "" })).sort((a,b) => a.id.localeCompare(b.id)),
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
    return { id: "evaluation_" + uid(), name, revision: 1, updated: now(), disabled: false, criteria: capture(record) };
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
      const rule = definitions.get(d.id);
      if (rule && canonical(compatibleContext(d.id, rule.context)) === canonical(compatibleContext(d.id, measurementContext(record, d)))) {
        for (const key of ["target", "ranges", "direction", "referenceEnabled", "source"]) if (rule[key] !== undefined) d[key] = clone(rule[key]);
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
      if (rule && !matches && record.enabled.iso) out.evaluationIssues.push({ id: row.id, reason: "等长目标的单位或协议不匹配" });
    }
    for (const pair of out.balancePairs) {
      const rule = c.balance.find(p => p.id === pair.id);
      const contexts = [pair.numeratorId, pair.denominatorId].map(id => { const row = record.data.iso.find(r => r.id === id); return row ? isoContext(row, record) : null; });
      if (rule && canonical(contexts) === canonical(rule.contexts)) {
        for (const key of ["ranges", "referenceEnabled", "source"]) pair[key] = clone(rule[key]);
      } else { pair.referenceEnabled = false; pair.ranges = []; }
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
    r.rules = clone(c.rules); r.axes = clone(c.axes);
    r.data.iso = c.iso.map(row => ({ ...clone(row), left: "", right: "", center: "", painLeft: false, painRight: false, painCenter: false, notes: "" }));
    r.balancePairs = clone(c.balance); r.lvp = clone(c.lvp);
    r.imtpTimeStandards = clone(c.imtpTimeStandards || []);
    for (const d of c.definitions) {
      r.protocol[d.testId] = d.context.protocol;
      if (d.context.force) r[d.testId === "cmj" ? "cmjConfig" : "imtpConfig"] = clone(d.context.force);
    }
    for (const [id,p] of Object.entries(c.lvp)) r.protocol[id.startsWith("landmine") ? "landmine" : id] = p.protocol;
    return r;
  }
  function fromTemplate(draft, original) {
    const c = capture(draft);
    // Definition conditions belong to the source measurement and never change through target editing.
    c.definitions.forEach(d => { const prior = original.criteria.definitions.find(x => x.id === d.id); if (prior) d.context = clone(prior.context); });
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
  function migrate(input) {
    if (input?.schema === 3 && input.kind === "athlete-library") {
      const lib = clone(input); lib.evaluationProfiles.forEach(p => { p.criteria.imtpTimeStandards ??= []; if (p.previous?.criteria) p.previous.criteria.imtpTimeStandards ??= []; validateProfile(p); }); return lib;
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
  root.RingsideEvaluation = { canonical, capture, signature, create, resolve, template, fromTemplate, validateProfile, migrate, imtpTimeContext, imtpTimeMatches };
})(typeof window !== "undefined" ? window : globalThis);
