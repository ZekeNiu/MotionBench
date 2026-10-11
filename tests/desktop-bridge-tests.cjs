"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAIBridge } = require("../desktop/ai-bridge.cjs");
const { createAIService } = require("../desktop/ai-service.cjs");

const origin = "motionbench://app";
const token = "private-host-token-" + "d8".repeat(24);
const sender = {};
const frame = {};
const event = { sender, senderFrame: frame };
const isTrustedSender = candidate => candidate?.sender === sender && candidate?.senderFrame === frame;
const body = JSON.stringify({ action: "status" });
const success = value => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const waitUntil = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error("Expected asynchronous bridge operation did not start");
    await new Promise(resolve => setImmediate(resolve));
  }
};

(async () => {
  let directory;
  try {
    let calls = 0, requestSeen;
    const bridge = createAIBridge({ origin, token, isTrustedSender, service: { handle: async request => {
      calls++; requestSeen = request;
      return success({ state: "empty", hasKey: false, revision: "0" });
    } } });
    for (const source of [{ sender: {}, senderFrame: frame }, { sender, senderFrame: {} }, null]) {
      assert.equal((await bridge.handle(source, "/api/ai-settings", body, "foreign")).status, 403);
      assert.equal(bridge.cancel(source, "foreign"), false);
    }
    for (const route of ["/api/relay?base=https://example.org", "/api/relay/../ai-settings", "https://example.org/api/relay", "/api/ai-settings/", "/package.json"]) {
      assert.equal((await bridge.handle(event, route, body, "invalid-path")).status, 400);
    }
    for (const id of ["", "a".repeat(129), null, {}, "id\nheader"]) {
      assert.equal((await bridge.handle(event, "/api/ai-settings", body, id)).status, 400);
    }
    assert.equal((await bridge.handle(event, "/api/ai-settings", {}, "object-body")).status, 400);
    assert.equal((await bridge.handle(event, "/api/ai-settings", "x".repeat(8 * 1024 * 1024 + 1), "large-body")).status, 413);
    assert.equal((await bridge.handle(event, "/api/ai-settings", "测".repeat(3 * 1024 * 1024), "large-utf8-body")).status, 413);
    assert.equal(calls, 0, "invalid senders, paths, identities and oversized bodies never reach the service");
    const state = await bridge.handle(event, "/api/ai-settings", body, "valid-status");
    assert.deepEqual(state, { status: 200, body: { state: "empty", hasKey: false, revision: "0" } });
    assert.equal(JSON.stringify(state).includes(token), false);
    assert.equal(requestSeen.url, origin + "/api/ai-settings");
    assert.equal(requestSeen.headers.get("Origin"), origin);
    assert.equal(requestSeen.headers.get("X-MotionBench-Token"), token);
    assert.equal(await requestSeen.text(), body);
    const thrown = createAIBridge({ origin, token, isTrustedSender, service: { handle: async () => { throw Error("C:\\private\\secret " + token); } } });
    const safeError = await thrown.handle(event, "/api/relay", "{}", "safe-error");
    assert.equal(safeError.status, 500);
    assert.equal(JSON.stringify(safeError).includes(token), false);
    assert.equal(JSON.stringify(safeError).includes("private"), false);

    const active = new Map();
    const concurrent = createAIBridge({ origin, token, isTrustedSender, service: { handle: request => new Promise(resolve => {
      const id = new URL(request.url).pathname + active.size;
      active.set(id, request);
      request.signal.addEventListener("abort", () => resolve(new Response('{"error":{"message":"canceled"}}', { status: 499 })), { once: true });
    }) } });
    const first = concurrent.handle(event, "/api/relay", "{}", "in-flight");
    assert.equal((await concurrent.handle(event, "/api/relay", "{}", "in-flight")).status, 409);
    assert.equal(concurrent.cancel({ sender: {}, senderFrame: frame }, "in-flight"), false);
    assert.equal([...active.values()][0].signal.aborted, false);
    assert.equal(concurrent.cancel(event, "in-flight"), true);
    assert.equal([...active.values()][0].signal.aborted, true);
    assert.equal((await first).status, 499);
    active.clear();
    const eight = Array.from({ length: 8 }, (_, i) => concurrent.handle(event, "/api/relay", "{}", "active-" + i));
    assert.equal((await concurrent.handle(event, "/api/relay", "{}", "ninth-request")).status, 429);
    assert.equal(concurrent.cancelAll(), 8);
    assert.ok([...active.values()].every(request => request.signal.aborted));
    assert.ok((await Promise.all(eight)).every(result => result.status === 499));
    assert.equal(concurrent.cancelAll(), 0, "settled operations leave no pending identities");

    directory = await fs.mkdtemp(path.join(os.tmpdir(), "motionbench-bridge-test-"));
    let upstreamSignal, upstreamAborted = false;
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: buffer => buffer.toString("utf8") };
    const service = createAIService({ directory, origin, token, safeStorage, fetch: (_url, options) => {
      upstreamSignal = options.signal;
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => {
        upstreamAborted = true; reject(new Error("provider-private-error " + token));
      }, { once: true }));
    } });
    const actual = createAIBridge({ service, origin, token, isTrustedSender });
    const status = await actual.handle(event, "/api/ai-settings", body, "real-status");
    assert.equal(status.status, 200, "host-only Origin and token pass the existing unmodified service checks");
    const saved = await actual.handle(event, "/api/ai-settings", JSON.stringify({ action: "save", base: "https://provider.example/v1", model: "test-model", key: "synthetic-provider-key", expectedRevision: status.body.revision }), "real-save");
    assert.equal(saved.status, 200);
    assert.equal(JSON.stringify(saved).includes(token), false);
    assert.equal(JSON.stringify(saved).includes("synthetic-provider-key"), false);
    const relay = actual.handle(event, "/api/relay", JSON.stringify({ path: "/models", payload: null, configRevision: saved.body.revision }), "real-relay");
    await waitUntil(() => !!upstreamSignal);
    assert.equal(actual.cancel(event, "real-relay"), true);
    const canceled = await relay;
    assert.equal(canceled.status, 499);
    assert.equal(upstreamAborted, true, "bridge cancellation terminates the service's actual upstream fetch");
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(JSON.stringify(canceled).includes(token), false);
    assert.equal(actual.cancelAll(), 0);
    console.log("Desktop AI bridge sender, path, body, concurrency, private-header and upstream cancellation checks passed");
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
