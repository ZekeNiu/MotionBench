"use strict";
const assert = require("node:assert/strict"), vm = require("node:vm");
const lifecycle = require("./helpers/display-guard-lifecycle.cjs");
const guard = require("./helpers/v2244-display-preservation.cjs");
const document = { key: "comparison", athleteId: "athlete", recordIds: ["a", "b"], views: {}, revision: 0, updated: "2026-10-20T00:00:00.000Z" };
const library = { athletes: [], longitudinalReports: [document] };
const sample = { athleteId: "athlete", documentKey: "comparison" };
function page() {
  const context = vm.createContext({});
  vm.runInContext(`
    window = globalThis;
    document = {querySelectorAll: () => []};
    class Repository {
      save() { return "save-original"; }
      saveRecords() { return "records-original"; }
      importLibrary() { return "import-original"; }
      importRows() {} stageImport() {} restorePrevious() {}
    }
    const repository = new Repository();
    // An existing own descriptor must be restored as well as inherited methods.
    Object.defineProperty(repository, "save", {value: repository.save.bind(repository), writable: true, configurable: true, enumerable: false});
    App = {getRepository: () => repository};
    RingsideLongitudinalStore = {put: () => "put-original"};
    originalSave = repository.save;
    originalPut = RingsideLongitudinalStore.put;
  `, context);
  return {
    isClosed: () => false,
    evaluate: async (fn, args) => vm.runInContext("(" + fn.toString() + ")(" + (JSON.stringify(args) || "undefined") + ")", context),
    check: expression => vm.runInContext(expression, context)
  };
}
function restored(p) {
  assert.equal(p.check("RingsideLongitudinalStore.put === originalPut"), true);
  assert.equal(p.check("App.getRepository().save === originalSave"), true);
  assert.equal(p.check("Object.getOwnPropertyDescriptor(App.getRepository(), 'save').enumerable"), false);
  assert.equal(p.check("Object.hasOwn(App.getRepository(), 'saveRecords')"), false);
  assert.equal(p.check("Object.hasOwn(App.getRepository(), 'importLibrary')"), false);
  assert.equal(p.check("Object.hasOwn(window, '__displayPreservation2244')"), false);
  assert.equal(p.check("Object.hasOwn(window, '__motionbenchDisplayGuardLifecycle')"), false);
}
async function main() {
  const p = page();
  const session = await lifecycle.install(p, library, sample, document, document.updated);
  assert.equal(p.check("RingsideLongitudinalStore.put === originalPut"), false);
  await assert.rejects(lifecycle.install(p, library, sample, document, document.updated), /already active/);
  await p.evaluate(({ library, document }) => {
    try { RingsideLongitudinalStore.put(library, { ...document, views: {charts: {unknown: {}}}, revision: 1 }); }
    catch (error) { if (!/Unrequested chart/.test(error.message)) throw error; }
  }, { library, document });
  const cleanup = await session.dispose();
  assert.equal(cleanup.removed, true);
  assert.equal(cleanup.proof.blocked.length, 1);
  assert.match(cleanup.proof.blocked[0], /Unrequested chart/);
  restored(p);
  assert.deepEqual(await session.dispose(), cleanup);
  // A later wrapper belongs to this same verification scope and is removed too.
  await assert.rejects(lifecycle.withGuard(p, library, sample, document, document.updated, async () => {
    await p.evaluate(() => { const put = RingsideLongitudinalStore.put; RingsideLongitudinalStore.put = (...args) => put(...args); });
    throw Error("simulated assertion failure");
  }), /simulated assertion failure/);
  restored(p);
  // Partial installation must clean up even when the guard itself rejects.
  const broken = {installGuard: async (...args) => { await guard.installGuard(...args); throw Error("partial installation"); }};
  await assert.rejects(lifecycle.install(p, library, sample, document, document.updated, broken), error => /partial installation/.test(error.message) && error.displayGuardCleanup.removed);
  restored(p);
  // Exercise the native runner's actual shared finally path with a live realm.
  // Its recovery writer observes the still-installed guard, then cleanup runs.
  const orderedSession = await lifecycle.install(p, library, sample, document, document.updated);
  const events = [];
  let failureCleanup;
  await assert.rejects((async () => {
    try { assert.fail("native assertion failure"); }
    finally {
      failureCleanup = await lifecycle.finish({page:p,session:orderedSession,failed:true,
        captureRecovery:async()=>{events.push("capture");assert.equal(p.check("RingsideLongitudinalStore.put === originalPut"),false);return {document,guard:await orderedSession.capture()};},
        writeRecovery:async recovery=>{events.push("write");assert.equal(recovery.document,document);assert.ok(recovery.guard);assert.equal(p.check("RingsideLongitudinalStore.put === originalPut"),false);}});
      events.push("finished");
    }
  })(), /native assertion failure/);
  assert.deepEqual(events,["capture","write","finished"]);
  assert.equal(failureCleanup.pass,true);assert.equal(failureCleanup.recoverySaved,true);assert.equal(failureCleanup.removed,true);
  restored(p);
  const exportSession = await lifecycle.install(p, library, sample, document, document.updated);
  const captureFailure = await lifecycle.finish({page:p,session:exportSession,failed:true,captureRecovery:async()=>{throw Error("recovery export failure");},writeRecovery:()=>assert.fail("do not write incomplete recovery")});
  assert.equal(captureFailure.pass,false);assert.equal(captureFailure.recoverySaved,false);assert.match(captureFailure.recoveryError,/recovery export failure/);assert.equal(captureFailure.removed,true);
  restored(p);
  const writeSession = await lifecycle.install(p, library, sample, document, document.updated);
  const writeFailure = await lifecycle.finish({page:p,session:writeSession,failed:true,captureRecovery:async()=>({}),writeRecovery:async()=>{throw Error("recovery disk failure");}});
  assert.equal(writeFailure.pass,false);assert.match(writeFailure.recoveryError,/recovery disk failure/);assert.equal(writeFailure.removed,true);
  restored(p);
  const cleanupFailure = await lifecycle.finish({page:p,session:{dispose:async()=>{throw Error("restore failure");}},failed:false});
  assert.equal(cleanupFailure.pass,false);assert.equal(cleanupFailure.removed,false);assert.match(cleanupFailure.cleanupError,/restore failure/);
  // Do not claim recovery of an old guard whose original put was never captured.
  await p.evaluate(() => { window.__displayPreservation2244 = { blocked: [] }; });
  await assert.rejects(lifecycle.install(p, library, sample, document, document.updated), /unmanaged/);
  const unmanaged = await lifecycle.finish({page:p,failed:true,captureRecovery:async()=>({}),writeRecovery:()=>{}});
  assert.equal(unmanaged.removed,null); // No captured session cannot prove legacy cleanup.
  console.log("Display guard lifecycle: original proof, blocked write, normal/assertion/partial-install cleanup, shared native failure path, recovery capture/write failures, cleanup failure, nested and legacy rejection PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
