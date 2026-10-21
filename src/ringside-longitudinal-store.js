(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => !!value && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
  const safeId = value => typeof value === "string" && value.length > 0 && value.length < 250 && /^[A-Za-z0-9_.:-]+$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
  function json(value, depth = 0) {
    if (depth > 40 || typeof value === "number" && !Number.isFinite(value) || ["function", "symbol", "bigint"].includes(typeof value)) throw Error("纵向报告包含无效数据");
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && !plain(value)) throw Error("纵向报告包含无效对象");
    for (const [name, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(name)) throw Error("纵向报告包含不安全字段");
      json(item, depth + 1);
    }
  }
  function key(athleteId, recordIds) {
    if (!safeId(athleteId) || !Array.isArray(recordIds) || recordIds.some(id => !safeId(id))) throw Error("纵向报告的运动员或测试编号无效");
    return JSON.stringify([athleteId, [...new Set(recordIds)].sort()]);
  }
  function narrative(value = {}) {
    if (!plain(value)) throw Error("纵向报告正文格式无效");
    for (const name of ["text", "html", "updated", "basis", "origin"]) if (value[name] !== undefined && typeof value[name] !== "string") throw Error("纵向报告正文格式无效");
    if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0)) throw Error("纵向报告正文版本无效");
    const out = { text: "", html: "", updated: "", basis: "", origin: "manual", revision: 0, ...clone(value) };
    out.html = root.RingsideModel.sanitizeHTML(out.html || root.RingsideModel.textToHTML(out.text));
    out.text = root.RingsideModel.htmlToText(out.html);
    return out;
  }
  function normalize(input, { archive = false } = {}) {
    json(input);
    if (!plain(input) || input.version !== undefined && input.version !== 1) throw Error("纵向报告格式或版本无效");
    const documentKey = key(input.athleteId, input.recordIds), recordIds = [...new Set(input.recordIds)].sort();
    if (recordIds.length < 2 || recordIds.length > 1000 || recordIds.length !== input.recordIds.length) throw Error("纵向报告需要至少两条不同的测试记录");
    if (input.key !== undefined && input.key !== documentKey) throw Error("纵向报告编号与所选记录不一致");
    if (input.mode !== undefined && !["best", "mean"].includes(input.mode)) throw Error("纵向报告汇总方式无效");
    if (input.evaluationProfileId && !safeId(input.evaluationProfileId)) throw Error("纵向报告评价方案编号无效");
    if (input.views !== undefined && !plain(input.views)) throw Error("纵向报告显示设置无效");
    for (const name of ["basis", "created", "updated"]) if (input[name] !== undefined && typeof input[name] !== "string") throw Error("纵向报告元数据无效");
    if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 0)) throw Error("纵向报告版本无效");
    if (input.importedVersions !== undefined && (archive || !Array.isArray(input.importedVersions) || input.importedVersions.length > 1000)) throw Error("纵向报告导入历史格式无效");
    const importedVersions=input.importedVersions?.map(value=>normalize(value,{archive:true}));
    if(importedVersions?.some(value=>value.key!==documentKey))throw Error("纵向报告导入历史与所选记录不一致");
    const profileSnapshot = input.profileSnapshot ? root.RingsideEvaluation.serializeProfile(input.profileSnapshot) : null;
    if (profileSnapshot) root.RingsideEvaluation.validateProfile(profileSnapshot);
    if(profileSnapshot && input.evaluationProfileId && profileSnapshot.id!==input.evaluationProfileId)throw Error("纵向报告评价方案与快照不一致");
    return { version: 1, key: documentKey, athleteId: input.athleteId, recordIds, mode: input.mode || "best",
      evaluationProfileId: input.evaluationProfileId || profileSnapshot?.id || "", profileSnapshot,
      views: root.RingsideLongitudinalViews ? root.RingsideLongitudinalViews.normalize(input.views || {}, recordIds) : clone(input.views || {}), narrative: narrative(input.narrative),
      ...(input.previousNarrative ? { previousNarrative: narrative(input.previousNarrative) } : {}),
      ...(importedVersions?.length ? { importedVersions } : {}),
      basis: input.basis || "", created: input.created || "", updated: input.updated || "", revision: input.revision || 0 };
  }
  function normalizeList(input) {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 10000) throw Error("纵向报告列表格式无效");
    const seen = new Set();
    return input.map(value => { const document = normalize(value); if (seen.has(document.key)) throw Error("纵向报告重复"); seen.add(document.key); return document; });
  }
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validateReferences(document, library, { active = false } = {}) {
    const owner = library.athletes?.find(athlete => athlete.id === document.athleteId);
    if (!owner || active && (owner.deletedAt || owner.archived)) throw Error("纵向报告所属运动员不存在或不可用");
    for (const id of document.recordIds) {
      const record = owner.records?.find(value => value.recordId === id);
      if (!record || record.athleteId !== document.athleteId || active && (record.deletedAt || record.archived) || !validDate(record.athlete?.date)) throw Error("纵向报告包含不存在、不可用或日期无效的测试记录");
    }
    if (document.evaluationProfileId && library.evaluationProfiles && !library.evaluationProfiles.some(profile => profile.id === document.evaluationProfileId) && document.profileSnapshot?.id !== document.evaluationProfileId) throw Error("纵向报告评价方案不存在");
    return true;
  }
  function get(library, athleteId, recordIds) {
    const documentKey = recordIds === undefined ? athleteId : key(athleteId, recordIds);
    const document = library.longitudinalReports?.find(value => value.key === documentKey);
    return document ? normalize(document) : null;
  }
  function put(library, input) {
    const document = normalize(input); validateReferences(document, library, { active: true });
    const reports = normalizeList(library.longitudinalReports), index = reports.findIndex(value => value.key === document.key);
    if (index < 0) reports.push(document); else reports[index] = document;
    library.longitudinalReports = reports;
    return clone(document);
  }
  function remove(library, documentKey) {
    library.longitudinalReports = normalizeList(library.longitudinalReports).filter(document => document.key !== documentKey);
  }
  function mapped(map, id) { return map instanceof Map ? map.get(id) || id : map?.[id] || id; }
  function remap(input, maps = {}) {
    const document = normalize(input);
    document.athleteId = mapped(maps.athleteMap, document.athleteId);
    document.recordIds = document.recordIds.map(id => mapped(maps.recordMap, id));
    document.evaluationProfileId = mapped(maps.profileMap, document.evaluationProfileId);
    if (document.profileSnapshot) document.profileSnapshot.id = mapped(maps.profileMap, document.profileSnapshot.id);
    const remapView = value => Array.isArray(value) ? value.map(remapView) : plain(value) ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, remapView(item)])) : typeof value === "string" ? mapped(maps.recordMap, value) : value;
    document.views = remapView(document.views);
    if (document.importedVersions) document.importedVersions = document.importedVersions.map(value => remap(value, maps));
    document.key = key(document.athleteId, document.recordIds);
    return normalize(document);
  }
  function merge(existing, incoming, maps = {}) {
    const output = normalizeList(existing);
    for (const input of normalizeList(incoming)) {
      const document = remap(input, maps), prior = output.find(value => value.key === document.key);
      if (!prior) output.push(document);
      else {
        const { importedVersions: history = [], ...body } = document;
        const { importedVersions: priorHistory = [], ...priorBody } = prior;
        const canonical = root.RingsideEvaluation.canonical;
        const candidates = canonical(body) === canonical(priorBody) ? history : [body, ...history];
        const versions = [...priorHistory], known = new Set([canonical(priorBody), ...priorHistory.map(canonical)]);
        for (const value of candidates) if (!known.has(canonical(value))) { versions.push(value); known.add(canonical(value)); }
        if (versions.length) prior.importedVersions = versions;
      }
    }
    return output;
  }
  function exportLibrary(library, input, records) {
    const document = normalize(input), selected = document.recordIds.map(id => records?.find(record => record.recordId === id));
    if (selected.some(record => !record || record._summary)) throw Error("导出纵向报告需要全部所选测试的完整记录");
    const sourceOwner = library.athletes.find(athlete => athlete.id === document.athleteId);
    if (!sourceOwner) throw Error("纵向报告运动员不存在");
    const owner = { ...clone(sourceOwner), records: clone(selected) };
    const profileIds = new Set([...selected.map(record => record.evaluationProfileId), document.evaluationProfileId].filter(Boolean));
    const profiles = (library.evaluationProfiles || []).filter(profile => profileIds.has(profile.id)).map(profile => root.RingsideEvaluation.serializeProfile(profile));
    if(document.profileSnapshot && profileIds.has(document.profileSnapshot.id) && !profiles.some(profile=>profile.id===document.profileSnapshot.id))profiles.push(clone(document.profileSnapshot));
    if (profiles.length !== profileIds.size) throw Error("导出纵向报告缺少所选测试的评价方案");
    const output = { schema: 3, kind: "athlete-library", version: library.version, catalog: clone(library.catalog), testPlans: [],
      ...(library.classifications !== undefined ? { classifications: clone(library.classifications) } : {}),
      groups: clone((library.groups || []).filter(group => group.id === owner.groupId)), evaluationProfiles: profiles,
      defaultEvaluationProfileId: document.evaluationProfileId || profiles[0]?.id || "", athletes: [owner],
      activeAthleteId: owner.id, activeRecordId: selected.slice().sort((a, b) => a.athlete.date.localeCompare(b.athlete.date) || String(a.created || "").localeCompare(String(b.created || "")) || a.recordId.localeCompare(b.recordId)).at(-1).recordId,
      longitudinalReports: [document], updated: library.updated || "" };
    validateReferences(document, output, { active: true });
    return output;
  }
  root.RingsideLongitudinalStore = { key, normalize, normalizeList, validDate, validateReferences, get, put, remove, remap, merge, exportLibrary };
})(typeof window !== "undefined" ? window : globalThis);
