(function (root) {
  "use strict";
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const configurationKeys = new Set([
    "id", "name", "protocol", "unit", "method", "label", "inputmode", "selectionbasis",
    "vo2unit", "oxygenlabel", "side", "region", "direction", "directioncode", "code", "target",
    "paired", "bilateral", "measurementversion", "forcedefinition", "impulsedefinition",
    "modality", "timems", "location", "position", "posture", "angle", "fixation", "measurementlocation",
    "confirmed", "referenceenabled", "source", "ranges", "enabled", "selected", "excluded",
  ]);
  // Empty rows and protocol choices do not turn a template into a measured record.
  // Metric IDs remain keys, including a user metric named after a configuration field.
  function project(value, dictionary = false) {
    if (Array.isArray(value)) {
      const items = value.map(item => project(item)).filter(item => item !== undefined);
      return items.length ? items : undefined;
    }
    if (object(value)) {
      const result = {};
      for (const key of Object.keys(value).sort()) {
        if (!dictionary && configurationKeys.has(key.toLowerCase())) continue;
        const item = project(value[key], key === "metrics");
        if (item !== undefined) Object.defineProperty(result, key, { value:item, enumerable:true, configurable:true, writable:true });
      }
      return Object.keys(result).length ? result : undefined;
    }
    if (value === undefined || value === null || value === false || value === "") return undefined;
    if (typeof value === "string" && !value.trim()) return undefined;
    return value;
  }
  function signature(record) {
    return JSON.stringify({
      data: project(record?.data, true),
      customValues: project(record?.customValues, true),
      narrative: record?.narrative?.text?.trim() || undefined,
    });
  }
  function create(records, { origin = null, pendingAthletes = [] } = {}) {
    if (!Array.isArray(records)) throw Error("本次录入名单无效");
    const ids = records.map(record => record.recordId);
    if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw Error("本次测试记录编号无效");
    return {
      records, base: records.length ? clone(records[0]) : null,
      origin: clone(origin), pendingAthletes: clone(pendingAthletes), savedIds: new Set(),
      initialMeasurements: new Map(records.map(record => [record.recordId, signature(record)])),
      selectedRecordId: records[0]?.recordId || "", missingRecordIds: [], conflictRecordIds: [],
    };
  }
  function hasManualData(session, record) {
    return signature(record) !== (session.initialMeasurements.get(record.recordId) ?? signature(session.base));
  }
  function markSaved(session, id) { session.savedIds.add(id); }
  function isPending(session, id) { return !session.savedIds.has(id); }
  const metadataKeys = new Set(["athleteId", "recordId", "athlete", "trainingContext"]);
  function contents(record) {
    return Object.fromEntries(Object.entries(record).filter(([key]) => !metadataKeys.has(key)));
  }
  function differences(before, after, path = [], result = []) {
    if (JSON.stringify(before) === JSON.stringify(after)) return result;
    if (object(before) && object(after)) {
      for (const key of Object.keys(before)) if (!own(after, key)) result.push({ path:path.concat(key), remove:true });
      for (const key of Object.keys(after)) {
        if (!own(before, key)) result.push({ path:path.concat(key), value:clone(after[key]) });
        else differences(before[key], after[key], path.concat(key), result);
      }
    } else result.push({ path, value:clone(after) });
    return result;
  }
  function recordContent(record) {
    const value = clone(record); delete value.updated; return JSON.stringify(value);
  }
  function encode(session, stateId = session.selectedRecordId, { dirtyRecords = [] } = {}) {
    const baseline = session.base ? contents(session.base) : {};
    return {
      version:1, base:clone(session.base), origin:clone(session.origin), pendingAthletes:clone(session.pendingAthletes),
      savedIds:[...session.savedIds], selectedRecordId:stateId || session.records[0]?.recordId || "",
      dirtyRecords:dirtyRecords.filter(item => session.savedIds.has(item.record.recordId)).map(item => ({
        record:clone(item.record), baselineContent:typeof item.baselineContent === "string" ? item.baselineContent : null,
      })),
      entries:session.records.map(record => ({
        athleteId:record.athleteId, recordId:record.recordId, athlete:clone(record.athlete), trainingContext:clone(record.trainingContext),
        ...(isPending(session, record.recordId) ? { patch:differences(baseline, contents(record)) } : {}),
      })),
    };
  }
  function applyPatch(record, patch) {
    if (!Array.isArray(patch)) throw Error("临时录入内容无效");
    for (const operation of patch) {
      const path = operation.path;
      if (!Array.isArray(path) || !path.length || path.some(key => typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))) throw Error("临时录入字段无效");
      let destination = record;
      for (const key of path.slice(0, -1)) {
        if (!own(destination, key) || !object(destination[key])) destination[key] = {};
        destination = destination[key];
      }
      const key = path[path.length - 1];
      if (operation.remove) delete destination[key];
      else Object.defineProperty(destination, key, { value:clone(operation.value), enumerable:true, configurable:true, writable:true });
    }
    return record;
  }
  async function decode(payload, loadRecord) {
    if (!payload || payload.version !== 1 || !Array.isArray(payload.entries) || !Array.isArray(payload.savedIds)
      || (payload.entries.length && !object(payload.base))) throw Error("临时录入数据格式无效");
    const ids = payload.entries.map(entry => entry.recordId);
    if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw Error("临时测试记录编号无效");
    if (payload.dirtyRecords !== undefined && !Array.isArray(payload.dirtyRecords)) throw Error("临时未保存内容无效");
    const dirty = new Map();
    for (const item of payload.dirtyRecords || []) {
      if (!object(item?.record) || typeof item.record.recordId !== "string" || dirty.has(item.record.recordId)) throw Error("临时未保存记录无效");
      dirty.set(item.record.recordId, item);
    }
    const saved = new Set(payload.savedIds), records = [], missingRecordIds = [], conflictRecordIds = [];
    for (const entry of payload.entries) {
      if (saved.has(entry.recordId)) {
        const record = await loadRecord(entry.recordId);
        if (!record) { missingRecordIds.push(entry.recordId); continue; }
        if (record.recordId !== entry.recordId || record.athleteId !== entry.athleteId) throw Error("临时测试记录与运动员编号不匹配");
        const pending = dirty.get(entry.recordId);
        if (pending) {
          if (pending.record.athleteId !== entry.athleteId) throw Error("临时未保存记录与运动员编号不匹配");
          const current = recordContent(record);
          // A failed/in-flight local save can be restored only while its original
          // stored baseline remains current, or when that exact save has committed.
          if (current === pending.baselineContent || current === recordContent(pending.record)) records.push(clone(pending.record));
          else { conflictRecordIds.push(entry.recordId); records.push(record); }
        } else records.push(record);
      } else {
        const record = applyPatch(clone(payload.base), entry.patch || []);
        for (const key of metadataKeys) if (own(entry, key)) record[key] = clone(entry[key]);
        records.push(record);
      }
    }
    const session = create(records, { origin:payload.origin, pendingAthletes:payload.pendingAthletes || [] });
    session.base = clone(payload.base);
    const initial = signature(session.base);
    session.initialMeasurements = new Map(records.map(record => [record.recordId, initial]));
    session.savedIds = new Set(records.filter(record => saved.has(record.recordId)).map(record => record.recordId));
    session.selectedRecordId = records.some(record => record.recordId === payload.selectedRecordId) ? payload.selectedRecordId : records[0]?.recordId || "";
    session.missingRecordIds = missingRecordIds;
    session.conflictRecordIds = conflictRecordIds;
    return session;
  }
  root.RingsideEntrySession = { create, hasManualData, markSaved, isPending, encode, decode };
})(window);
