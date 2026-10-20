"use strict";
// The historical proof remains immutable. This adapter owns only the lifetime
// of its injected functions, and never saves, imports or restores user data.
const { randomUUID } = require("node:crypto");
const defaultGuard = require("./v2244-display-preservation.cjs");
const SESSION = "__motionbenchDisplayGuardLifecycle";

async function restore(page, token) {
  if (page.isClosed()) return { removed: true, windowClosed: true };
  return page.evaluate(({ key, token }) => {
    const session = window[key];
    if (!session || session.token !== token) throw Error("Display guard session identity changed");
    const guard = window.__displayPreservation2244;
    const proof = guard ? JSON.parse(JSON.stringify(guard)) : null;
    // Restore the captured descriptors rather than copying prototype methods:
    // a caller may legitimately have had its own bound method before the test.
    for (const item of [...session.properties].reverse()) {
      if (item.descriptor) Object.defineProperty(item.target, item.name, item.descriptor);
      else if (!delete item.target[item.name]) throw Error("Cannot remove injected " + item.label);
    }
    for (const item of session.properties) {
      const actual = Object.getOwnPropertyDescriptor(item.target, item.name);
      const expected = item.descriptor;
      const same = expected ? actual && ["value", "get", "set", "enumerable", "configurable", "writable"].every(name => actual[name] === expected[name]) : actual === undefined;
      if (!same) throw Error("Display guard cleanup failed: " + item.label);
    }
    delete window[key];
    return { removed: true, windowClosed: false, restored: session.properties.map(item => item.label), proof };
  }, { key: SESSION, token });
}

async function install(page, original, sample, initialDocument, windowStart, guard = defaultGuard) {
  const token = randomUUID();
  await page.evaluate(({ key, token }) => {
    if (window[key]) throw Error("A display guard session is already active");
    if (window.__displayPreservation2244) throw Error("An earlier unmanaged display guard requires separate recovery");
    const repo = App.getRepository(), store = RingsideLongitudinalStore;
    const properties = [];
    const capture = (target, name, label) => properties.push({ target, name, label, descriptor: Object.getOwnPropertyDescriptor(target, name) });
    capture(window, "__displayPreservation2244", "window.__displayPreservation2244");
    capture(store, "put", "RingsideLongitudinalStore.put");
    for (const name of ["save", "saveRecords", "importLibrary", "importRows", "stageImport", "restorePrevious"])
      capture(repo, name, "repository." + name);
    Object.defineProperty(window, key, { value: { token, properties }, configurable: true });
  }, { key: SESSION, token });
  let cleanup;
  const dispose = async () => cleanup || (cleanup = await restore(page, token));
  try {
    await guard.installGuard(page, original, sample, initialDocument, windowStart);
  } catch (error) {
    try { error.displayGuardCleanup = await dispose(); }
    catch (cleanupError) { error.displayGuardCleanupError = cleanupError; }
    throw error;
  }
  return {
    dispose,
    capture: () => page.evaluate(() => window.__displayPreservation2244 ? JSON.parse(JSON.stringify(window.__displayPreservation2244)) : null)
  };
}

async function withGuard(page, original, sample, initialDocument, windowStart, run, guard = defaultGuard) {
  const session = await install(page, original, sample, initialDocument, windowStart, guard);
  try { return await run(session); }
  finally { await session.dispose(); }
}

// Shared by the native runner and its failure-path test. Capture is completed
// before removing the guard; a failed capture must still reach cleanup.
async function finish({ page, session, failed, captureRecovery, writeRecovery }) {
  const result = { pass: true, recoverySaved: false, removed: session ? false : null };
  try {
    if (failed && page && !page.isClosed()) {
      try {
        const recovery = await captureRecovery();
        await writeRecovery(recovery);
        result.recoverySaved = true;
      } catch (error) {
        result.pass = false;
        result.recoveryError = error.stack || String(error);
      }
    }
  } finally {
    if (session) {
      try {
        result.restoration = await session.dispose();
        result.removed = result.restoration.removed === true;
        if (!result.removed) result.pass = false;
      } catch (error) {
        result.pass = false;
        result.cleanupError = error.stack || String(error);
      }
    }
  }
  return result;
}

module.exports = { install, withGuard, finish };
