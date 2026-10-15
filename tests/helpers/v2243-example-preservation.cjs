"use strict";
// Serializable guard shared by native verification and offline receipt checks.
// Every permitted value comes from the approved plan or an exact view-state
// transition. Only newly created trial IDs and actual edit timestamps vary.
function createPreservation() {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, function (_key, item) { return item && !Array.isArray(item) && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
  const equal = (a, b) => canonical(a) === canonical(b);
  const require = (condition, message) => { if (!condition) throw Error(message); };
  const same = (a, b, message) => require(equal(a, b), message);
  const get = (value, key) => key.split(".").reduce((at, part) => at?.[part], value);
  function set(value, key, item) { const keys = key.split("."); let at = value; for (const part of keys.slice(0, -1)) at = at[part] ||= {}; if (item === undefined) delete at[keys.at(-1)]; else at[keys.at(-1)] = clone(item); }
  const newRawKeys = ["longitudinal-raw-fms", "longitudinal-raw-jumps", "longitudinal-raw-imtp", "longitudinal-raw-fvp_sj", "longitudinal-raw-fvp_cmj", "longitudinal-raw-sprint_fvp", "longitudinal-raw-lactate", "longitudinal-raw-cpet", "longitudinal-capability-parameters-endurance"];
  function sample(library, plan) {
    const owner = library.athletes.find(owner => owner.id === plan.athleteId); require(owner, "Existing example owner is missing");
    same(owner.records.map(record => record.recordId).sort(), [...plan.recordIds].sort(), "Example record identities differ");
    const key = JSON.stringify([plan.athleteId, [...plan.recordIds].sort()]), document = library.longitudinalReports.find(doc => doc.athleteId === plan.athleteId && doc.key === key);
    require(document, "Existing four-record comparison document is missing");
    return { owner, document, key };
  }
  function time(value, original, range, label) {
    if (value === original) return;
    const stamp = Date.parse(value); require(Number.isFinite(stamp) && stamp >= Date.parse(range.start) && stamp <= Date.parse(range.end), label + " is outside the operation time window");
    require(new Date(stamp).toISOString() === value, label + " is not a canonical timestamp");
  }
  // Partial normal entry can contain the old value, the exact planned value or
  // an empty newly added control. It cannot contain a different measurement.
  function intermediate(actual, before, expected, label, empty = false) {
    if (equal(actual, before) || equal(actual, expected)) return;
    if (actual === undefined) { require(before === undefined, label + " removed an existing field"); return; }
    if (empty && (actual === "" || actual === null)) return;
    if (empty && typeof actual === "number" && typeof expected === "string" && String(actual) === expected) return;
    if (Array.isArray(expected)) {
      require(Array.isArray(actual) && actual.length >= (Array.isArray(before) ? before.length : 0) && actual.length <= expected.length, label + " has an unexpected array length");
      actual.forEach((item, index) => intermediate(item, before?.[index], expected[index], label + "." + index, empty)); return;
    }
    if (expected && typeof expected === "object") {
      require(actual && typeof actual === "object" && !Array.isArray(actual), label + " has an unexpected type");
      for (const key of new Set([...Object.keys(actual), ...Object.keys(before || {})])) { require(Object.hasOwn(expected, key) || Object.hasOwn(before || {}, key), label + "." + key + " is unexpected"); intermediate(actual[key], before?.[key], expected[key], label + "." + key, empty); } return;
    }
    throw Error(label + " differs from both the original and approved input");
  }
  function allIds(library) {
    const ids = new Set();
    const visit = value => { if (!value || typeof value !== "object") return; if (typeof value.id === "string") ids.add(value.id); if (typeof value.recordId === "string") ids.add(value.recordId); Object.values(value).forEach(item => { if (Array.isArray(item)) item.forEach(visit); else visit(item); }); };
    visit(library); return ids;
  }
  function verifyRecord(actual, before, row, options) {
    require(actual.recordId === before.recordId && actual.athleteId === before.athleteId, "Record identity changed");
    const restored = clone(actual), generated = options.generatedIds || {}, reserved = options.reservedIds || new Set();
    for (const change of row.allowedChanges) {
      same(get(before, change.path), change.before, "Plan before-value differs: " + change.path);
      const value = clone(get(actual, change.path));
      for (const idPath of change.generatedIdsOnly || []) {
        const id = get(value, idPath), identity = row.recordId + ":" + change.path + "." + idPath;
        if (id === undefined) { require(!options.final, "A generated trial ID is missing: " + identity); continue; }
        require(typeof id === "string" && id.length > 0 && id.length < 250 && !reserved.has(id), "A new trial reused an existing ID: " + identity);
        if (generated[identity] !== undefined) same(id, generated[identity], "A generated trial ID changed after its first save");
        else { require(!Object.values(generated).includes(id), "Two new trials share an ID"); generated[identity] = id; }
        set(value, idPath, undefined);
      }
      if (options.final) same(value, change.expected, "Saved approved field differs: " + row.recordId + ":" + change.path);
      else intermediate(value, change.before, change.expected, change.path, change.kind === "new-measurements");
      set(restored, change.path, change.beforePresent === false ? undefined : change.before);
    }
    time(actual.updated, before.updated, options.timestampRange, "Edited record.updated"); restored.updated = before.updated;
    same(restored, before, "A record field outside the approved changes was modified");
    return generated;
  }
  function views(before, actual) {
    require(actual && Object.keys(actual).sort().join(",") === Object.keys(before).sort().join(","), "Comparison view structure changed");
    same(actual.reportScroll, before.reportScroll, "Saved comparison scroll changed");
    for (const [key, value] of Object.entries(before.detailOpen || {})) same(actual.detailOpen?.[key], value, "Existing disclosure state changed: " + key);
    for (const [key, value] of Object.entries(actual.detailOpen || {})) if (!Object.hasOwn(before.detailOpen || {}, key)) { require(newRawKeys.includes(key), "Unexpected new disclosure state: " + key); same(value, false, "New raw-data and parameter sections must start closed"); }
  }
  function verifyDocument(actual, original, previous, options) {
    require(actual.key === original.key && actual.athleteId === original.athleteId, "Comparison identity changed");
    views(original.views, actual.views);
    const changedViews = !equal(actual.views, previous.views);
    same(actual.revision, previous.revision + (changedViews ? 1 : 0), "Comparison revision does not match its exact view-state transition");
    require(actual.basis === previous.basis || actual.basis === options.expectedBasis, "Comparison calculation basis does not match the saved raw records");
    time(actual.updated, original.updated, options.timestampRange, "Comparison.updated");
    const restored = clone(actual); for (const key of ["basis", "views", "revision", "updated"]) restored[key] = clone(original[key]);
    same(restored, original, "Comparison narrative, prior revisions or another protected field changed");
    return { fromRevision: previous.revision, toRevision: actual.revision, basisChanged: actual.basis !== previous.basis,
      addedViews: Object.entries(actual.views.detailOpen || {}).filter(([key]) => !Object.hasOwn(previous.views.detailOpen || {}, key)), basis: actual.basis, views: clone(actual.views), updated: actual.updated };
  }
  function verifyLibrary(actual, before, plan, expectedDocument, options) {
    const expected = sample(before, plan), restored = clone(actual), recordPlans = new Map(plan.records.map(row => [row.recordId, row]));
    same(actual.athletes.map(owner => owner.id), before.athletes.map(owner => owner.id), "Athlete inventory or ordering changed");
    for (let index = 0; index < actual.athletes.length; index++) {
      const owner = actual.athletes[index], original = before.athletes[index];
      same(owner.records.map(record => record.recordId), original.records.map(record => record.recordId), "Record inventory or ordering changed");
      for (let r = 0; r < owner.records.length; r++) {
        const record = owner.records[r], prior = original.records[r], row = recordPlans.get(record.recordId);
        if (row) verifyRecord(record, prior, row, options); else same(record, prior, "An original non-example record changed");
      }
      restored.athletes[index].records = clone(original.records);
    }
    const docs = actual.longitudinalReports || [], oldDocs = before.longitudinalReports || [];
    same(docs.map(doc => doc.key), oldDocs.map(doc => doc.key), "Comparison inventory changed");
    docs.forEach((doc, index) => { if (doc.key === expected.key) same(doc, expectedDocument, "Saved comparison differs from the validated transition"); else same(doc, oldDocs[index], "An unrelated comparison changed"); });
    restored.longitudinalReports = clone(before.longitudinalReports);
    for (const key of ["version", "updated", "activeAthleteId", "activeRecordId"]) restored[key] = clone(before[key]);
    same(restored, before, "An athlete, shared definition, default profile or other library field changed");
  }
  return { clone, canonical, equal, require, same, get, set, sample, time, intermediate, allIds, verifyRecord, views, verifyDocument, verifyLibrary, newRawKeys };
}

async function installGuard(page, before, plan, start, activeDocument) {
  await page.evaluate(({ source, before, plan, start, activeDocument }) => {
    const P = (0, eval)("(" + source + ")")(), S = P.sample(before, plan), originalRecords = new Map(before.athletes.flatMap(owner => owner.records.map(record => [record.recordId, record])));
    const storedRecords = new Map(originalRecords), recordPlans = new Map(plan.records.map(row => [row.recordId, row])), originalIds = P.allIds(before);
    const initialDocument = activeDocument || S.document;
    const state = window.__supplement2243 = { writes: 0, blocked: [], generatedIds: {}, documentTransitions: [], timestampStart: start, documents: before.longitudinalReports.map(doc => doc.key === S.key ? P.clone(initialDocument) : P.clone(doc)), expectedDocument: P.clone(initialDocument) };
    const options = final => ({ final, generatedIds: state.generatedIds, reservedIds: originalIds, timestampRange: { start, end: new Date().toISOString() } });
    const reject = error => { state.blocked.push(error.message || String(error)); throw error; };
    const checkRecords = values => { for (const record of values) { const old = originalRecords.get(record.recordId), row = recordPlans.get(record.recordId); if (!old) throw Error("Unexpected new record"); row ? P.verifyRecord(record, old, row, options(false)) : P.same(record, old, "Original non-example record changed"); } };
    const checkDocuments = values => { if (values !== undefined) P.same(values, state.documents, "Repository comparison differs from validated store.put transitions"); };
    const basisInput = () => { const records = plan.recordIds.map(id => storedRecords.get(id)), latest = [...records].sort((a, b) => a.athlete.date.localeCompare(b.athlete.date)).at(-1), profile = before.evaluationProfiles.find(item => item.id === latest.evaluationProfileId); return { records: P.clone(records), basis: RingsideLongitudinal.build(records, { athleteId: plan.athleteId, mode: S.document.mode, profile, catalog: before.catalog }).basis }; };
    const store = RingsideLongitudinalStore, put = store.put.bind(store);
    store.put = (library, document) => {
      try {
        if (document.key !== S.key) P.same(document, before.longitudinalReports.find(item => item.key === document.key), "An unrelated comparison was modified");
        else { const input = basisInput(), transition = P.verifyDocument(document, S.document, state.expectedDocument, { ...options(false), expectedBasis: input.basis }); transition.basisRecords = input.records; transition.expectedBasis = input.basis; state.documentTransitions.push(transition); state.expectedDocument = P.clone(document); state.documents = state.documents.map(item => item.key === S.key ? P.clone(document) : item); }
        return put(library, document);
      } catch (error) { return reject(error); }
    };
    const repo = App.getRepository(), saveRecords = repo.saveRecords.bind(repo), save = repo.save.bind(repo);
    repo.saveRecords = async (values, checks, opts = {}) => { try { checkRecords(values); checkDocuments(opts.longitudinalReports); P.require(!opts.newAthletes?.length, "Unexpected athlete addition"); state.writes++; const result = await saveRecords(values, checks, opts); values.forEach(record => storedRecords.set(record.recordId, P.clone(record))); return result; } catch (error) { return reject(error); } };
    repo.save = async (next, values = [], removals = {}, checks = {}) => { try { checkRecords(values); checkDocuments(next.longitudinalReports); P.require(!Object.values(removals).some(value => Array.isArray(value) && value.length), "Unexpected deletion");
      const complete = P.clone(next); complete.athletes = complete.athletes.map(owner => ({ ...owner, records: owner.records.map(record => values.find(item => item.recordId === record.recordId) || storedRecords.get(record.recordId)) }));
      P.verifyLibrary(complete, before, plan, state.expectedDocument, options(false)); state.writes++; const result = await save(next, values, removals, checks); values.forEach(record => storedRecords.set(record.recordId, P.clone(record))); return result;
    } catch (error) { return reject(error); } };
    for (const method of ["importLibrary", "importRows", "stageImport", "restorePrevious"]) if (typeof repo[method] === "function") repo[method] = async () => reject(Error("Imports and restores are prohibited during normal supplementation"));
  }, { source: createPreservation.toString(), before, plan, start, activeDocument });
}
module.exports = { createPreservation, installGuard, ...createPreservation() };
