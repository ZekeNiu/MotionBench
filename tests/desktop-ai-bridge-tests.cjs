"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const settingsSource = fs.readFileSync(path.join(root, "src/ringside-ai-settings.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src/ringside-app.js"), "utf8");
const requestStart = appSource.indexOf("  async function request(");
const requestEnd = appSource.indexOf("  async function models()", requestStart);
assert.ok(requestStart > 0 && requestEnd > requestStart, "test must exercise the actual application relay function");
const relaySource = appSource.slice(requestStart, requestEnd);
const metadata = { base: "https://provider.example/v1", model: "model", revision: "revision-1", state: "ready", hasKey: true };
let passed = 0;

function fixture({ native, local, fetch } = {}) {
  const calls = [], fetched = [], refreshed = [], canceled = [];
  const context = {
    console, JSON, Promise, Object, Number, String, Response, Headers, Request,
    AbortController, AbortSignal, DOMException, crypto: webcrypto, setTimeout, clearTimeout,
    MotionBenchLocal: local,
    MotionBenchNative: native ? {
      requestAI: async (...args) => { calls.push(args); return native(...args); },
      cancelAI: id => { canceled.push(id); },
    } : undefined,
    fetch: async (...args) => { fetched.push(args); return fetch ? fetch(...args) : Response.json(metadata); },
    configuredAI: async () => local ? { configRevision: metadata.revision, model: metadata.model } :
      { base: metadata.base, key: "temporary-web-key", model: metadata.model },
    loadAISettings: async force => { refreshed.push(force); },
    safeAIError: value => String(value),
    setAIStatus: () => {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(settingsSource, context);
  vm.runInContext(relaySource, context);
  return { context, calls, fetched, refreshed, canceled };
}

async function test(name, operation) {
  await operation();
  passed++;
  console.log("PASS " + name);
}

(async () => {
  await test("desktop settings use only the bounded IPC contract and strip returned credential fields", async () => {
    const f = fixture({ local: { native: true },
      native: async () => ({ status: 200, body: { ...metadata, key: "must-not-be-returned" } }) });
    assert.deepEqual(JSON.parse(JSON.stringify(await f.context.RingsideAISettings.status())), metadata);
    await f.context.RingsideAISettings.save({ base: metadata.base, model: metadata.model,
      key: "synthetic-input-key", expectedRevision: metadata.revision });
    await f.context.RingsideAISettings.forget({ expectedRevision: metadata.revision });
    assert.equal(f.fetched.length, 0);
    assert.deepEqual(f.calls.map(call => call[0]), ["/api/ai-settings", "/api/ai-settings", "/api/ai-settings"]);
    assert.deepEqual(f.calls.map(call => JSON.parse(call[1]).action), ["status", "save", "forget"]);
    assert.equal(JSON.parse(f.calls[1][1]).key, "synthetic-input-key");
    assert.equal(JSON.parse(f.calls[2][1]).expectedRevision, metadata.revision);
    assert.ok(f.calls.every(call => typeof call[1] === "string" && /^[a-f0-9-]{36}$/i.test(call[2])));
    assert.equal(new Set(f.calls.map(call => call[2])).size, 3);
  });

  await test("native settings preserve service error status and hide IPC transport diagnostics", async () => {
    const conflict = fixture({ local: { native: true },
      native: async () => ({ status: 409, body: { error: { message: "configuration changed" } } }) });
    await assert.rejects(conflict.context.RingsideAISettings.status(), error => error.status === 409 && /configuration changed/.test(error.message));
    const broken = fixture({ local: { native: true }, native: async () => { throw Error("private transport diagnostics"); } });
    await assert.rejects(broken.context.RingsideAISettings.status(),
      error => /未能连接本机 AI 设置/.test(error.message) && !/private/.test(error.message));
    await assert.rejects(broken.context.request("/models"),
      error => /未能连接本机 AI 服务/.test(error.message) && !/private/.test(error.message));
  });

  await test("desktop relay sends saved revision and payload through IPC without using HTTP or a key", async () => {
    const response = { choices: [{ message: { content: "synthetic suggestion" } }] };
    const f = fixture({ local: { native: true }, native: async () => ({ status: 200, body: response }) });
    const payload = { model: metadata.model, messages: [{ role: "user", content: "synthetic assessment" }] };
    assert.deepEqual(JSON.parse(JSON.stringify(await f.context.request("/chat/completions", payload))), response);
    assert.equal(f.fetched.length, 0); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0], "/api/relay");
    const sent = JSON.parse(f.calls[0][1]);
    assert.deepEqual(sent, { path: "/chat/completions", payload, configRevision: metadata.revision });
    assert.equal(Object.hasOwn(sent, "key"), false); assert.equal(Object.hasOwn(sent, "base"), false);
    const expired = fixture({ local: { native: true },
      native: async () => ({ status: 409, body: { error: { message: "configuration changed" } } }) });
    await assert.rejects(expired.context.request("/models"), /HTTP 409/);
    assert.deepEqual(expired.refreshed, [true]);
  });

  await test("desktop relay cancellation reaches the matching native request and rejects before late results", async () => {
    let release, ready;
    const started = new Promise(resolve => { ready = resolve; });
    const pendingNative = new Promise(resolve => { release = resolve; });
    const f = fixture({ local: { native: true }, native: () => { ready(); return pendingNative; } });
    const controller = new AbortController();
    const pending = f.context.request("/models", undefined, controller, 1000);
    await started;
    controller.abort();
    await assert.rejects(pending, error => error.name === "AbortError");
    assert.deepEqual(f.canceled, [f.calls[0][2]]);
    release({ status: 200, body: { data: [{ id: "late-model" }] } });
    await Promise.resolve();
    assert.equal(f.calls.length, 1); assert.equal(f.canceled.length, 1);
    const completed = fixture({ local: { native: true }, native: async () => ({ status: 200, body: { data: [] } }) });
    const finishedController = new AbortController();
    await completed.context.request("/models", undefined, finishedController, 1000);
    finishedController.abort();
    assert.equal(completed.canceled.length, 0, "completed requests must remove abort listeners");
  });

  await test("native relay timeout cancels upstream and pre-aborted signals invoke no native request", async () => {
    const f = fixture({ local: { native: true }, native: () => new Promise(() => {}) });
    await assert.rejects(f.context.request("/models", undefined, undefined, 20), /已停止等待/);
    assert.equal(f.canceled.length, 1); assert.equal(f.canceled[0], f.calls[0][2]);
    const controller = new AbortController(); controller.abort();
    const preAborted = fixture({ local: { native: true }, native: () => { throw Error("must not execute"); } });
    await assert.rejects(preAborted.context.request("/models", undefined, controller), error => error.name === "AbortError");
    assert.equal(preAborted.calls.length, 0); assert.equal(preAborted.canceled.length, 0);
  });

  await test("web launcher settings and relay retain their existing HTTP token contract", async () => {
    const f = fixture({ local: { token: "web-launcher-token" } });
    await f.context.RingsideAISettings.status();
    assert.equal(f.fetched[0][0], "/api/ai-settings");
    assert.equal(f.fetched[0][1].headers["X-MotionBench-Token"], "web-launcher-token");
    assert.equal(JSON.parse(f.fetched[0][1].body).action, "status");
    await f.context.request("/models");
    assert.equal(f.fetched[1][0], "/api/relay");
    assert.equal(f.fetched[1][1].headers["X-MotionBench-Token"], "web-launcher-token");
    assert.deepEqual(JSON.parse(f.fetched[1][1].body), { path: "/models", configRevision: metadata.revision });
    assert.equal(f.calls.length, 0);
  });

  await test("standalone HTML retains temporary-key direct HTTPS requests and unsupported saved settings", async () => {
    const f = fixture();
    const settings = await f.context.RingsideAISettings.status();
    assert.equal(settings.state, "unsupported"); assert.equal(f.fetched.length, 0);
    await f.context.request("/models");
    assert.equal(f.fetched[0][0], metadata.base + "/models");
    assert.equal(f.fetched[0][1].method, "GET");
    assert.equal(f.fetched[0][1].headers.Authorization, "Bearer temporary-web-key");
    assert.equal(f.fetched[0][1].body, undefined);
    assert.equal(f.calls.length, 0);
  });

  console.log(passed + " desktop AI renderer bridge checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
