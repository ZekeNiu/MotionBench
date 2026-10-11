"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createAIService, normalizeBase } = require("../desktop/ai-service.cjs");

const ORIGIN = "motionbench://app", TOKEN = "private-test-token-" + "x".repeat(32);
const SECRET = "synthetic-desktop-secret-not-a-real-key";
const directories = [];
let passed = 0;

// Authenticated encryption stands in for OS safeStorage. All provider calls
// below use mocks: this suite opens no socket and needs no provider account.
function encryptedStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motionbench-desktop-ai-"));
  directories.push(directory);
  const safeStorage = encryptedStorage(), calls = [];
  let fetchImpl = options.fetch || (async (url, request) => {
    calls.push({ url, request });
    return Response.json({ data: [{ id: "test-model" }] });
  });
  const config = { directory, safeStorage, origin: ORIGIN, token: TOKEN,
    fetch: (...args) => fetchImpl(...args), ...options };
  const service = createAIService(config);
  async function call(body, endpoint = "/api/ai-settings", requestOptions = {}) {
    const { headers = {}, ...rest } = requestOptions;
    const requestHeaders = new Headers({ Origin: ORIGIN, "X-MotionBench-Token": TOKEN,
      "Content-Type": "application/json" });
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) requestHeaders.delete(name);
      else requestHeaders.set(name, value);
    }
    const request = new Request(ORIGIN + endpoint, {
      method: "POST", headers: requestHeaders, body: JSON.stringify(body), ...rest,
    });
    const response = await service.handle(request);
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function save(fields = {}) {
    const status = await call({ action: "status" });
    return call({ action: "save", base: "https://provider.example", model: "test-model",
      key: SECRET, expectedRevision: status.body.revision, ...fields });
  }
  return { directory, safeStorage, config, service, call, save, calls,
    setFetch: value => { fetchImpl = value; } };
}

async function test(name, operation) {
  await operation(); passed++; console.log("PASS " + name);
}

function noSecret(value) {
  assert.ok(!JSON.stringify(value).includes(SECRET), "credential must never enter the renderer response");
}

(async () => {
  try {
    await test("HTTPS address normalization and local-target rejection", async () => {
      assert.equal(normalizeBase(" https://PROVIDER.example:443/v1/chat/completions/ "), "https://provider.example/v1");
      assert.equal(normalizeBase("https://provider.example/proxy/models"), "https://provider.example/proxy/v1");
      assert.equal(normalizeBase("https://[2606:4700:4700::1111]"), "https://[2606:4700:4700::1111]/v1");
      for (const base of ["http://provider.example", "https://name:password@provider.example", "https://provider.example?q=1",
        "https://provider.example#part", "https://127.0.0.1", "https://2130706433", "https://0x7f000001",
        "https://[::1]", "https://[::ffff:127.0.0.1]", "https://10.1.2.3", "https://169.254.169.254",
        "https://192.168.1.1", "https://localhost.", "https://host.local", "https://one.localhost", "https://provider.example\n"])
        assert.throws(() => normalizeBase(base), undefined, base);
    });

    await test("encrypted save, restart, model-only edit and metadata never expose a key", async () => {
      const f = await fixture();
      const initial = await f.call({ action: "status" });
      assert.equal(initial.status, 200); assert.equal(initial.body.state, "empty");
      const saved = await f.save();
      assert.equal(saved.status, 200); assert.equal(saved.body.hasKey, true); noSecret(saved.body);
      assert.equal(saved.body.base, "https://provider.example/v1");
      assert.equal(Object.hasOwn(saved.body, "key"), false);
      const bytes = await fs.readFile(path.join(f.directory, "ai-settings.dat"));
      assert.equal(bytes.includes(Buffer.from(SECRET)), false);
      assert.throws(() => JSON.parse(bytes.toString("utf8")));
      const restarted = createAIService(f.config);
      const response = await restarted.handle(new Request(ORIGIN + "/api/ai-settings", { method: "POST",
        headers: { Origin: ORIGIN, "X-MotionBench-Token": TOKEN }, body: JSON.stringify({ action: "status" }) }));
      assert.deepEqual(await response.json(), saved.body);
      const edited = await f.call({ action: "save", base: "https://PROVIDER.example:443/v1", model: "different-model",
        key: "", expectedRevision: saved.body.revision });
      assert.equal(edited.status, 200); assert.equal(edited.body.hasKey, true); noSecret(edited);
      assert.notEqual(edited.body.revision, saved.body.revision);
      assert.equal(edited.headers.get("Cache-Control"), "no-store");
    });

    await test("revision conflict and concurrent saves cannot overwrite newer configuration", async () => {
      const f = await fixture(), saved = await f.save();
      const body = { action: "save", base: saved.body.base, key: "", expectedRevision: saved.body.revision };
      const results = await Promise.all([f.call({ ...body, model: "one" }), f.call({ ...body, model: "two" })]);
      assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
      const status = await f.call({ action: "status" });
      assert.equal(status.body.model, results.find(x => x.status === 200).body.model);
      const staleForget = await f.call({ action: "forget", expectedRevision: saved.body.revision });
      assert.equal(staleForget.status, 409); assert.equal(status.body.hasKey, true);
    });

    await test("changing provider requires its own key; forgetting persists across restart", async () => {
      const f = await fixture(), saved = await f.save();
      const changed = await f.call({ action: "save", base: "https://other.example", model: "test-model", key: "",
        expectedRevision: saved.body.revision });
      assert.equal(changed.status, 400);
      assert.deepEqual((await f.call({ action: "status" })).body, saved.body);
      const forgotten = await f.call({ action: "forget", expectedRevision: saved.body.revision });
      assert.equal(forgotten.status, 200); assert.equal(forgotten.body.hasKey, false);
      const restarted = createAIService(f.config);
      const response = await restarted.handle(new Request(ORIGIN + "/api/ai-settings", { method: "POST",
        headers: { Origin: ORIGIN, "X-MotionBench-Token": TOKEN }, body: JSON.stringify({ action: "status" }) }));
      assert.equal((await response.json()).hasKey, false);
      const relay = await f.call({ path: "/models", configRevision: forgotten.body.revision }, "/api/relay");
      assert.equal(relay.status, 409); assert.equal(f.calls.length, 0);
    });

    await test("corrupt ciphertext is reported, never silently replaced, and explicit recovery is versioned", async () => {
      const f = await fixture(); await f.save();
      const file = path.join(f.directory, "ai-settings.dat"), broken = Buffer.from("corrupt ciphertext");
      await fs.writeFile(file, broken);
      const status = await f.call({ action: "status" });
      assert.equal(status.body.state, "unreadable"); assert.match(status.body.revision, /^unreadable:/);
      assert.deepEqual(await fs.readFile(file), broken);
      assert.equal((await f.call({ action: "save", base: status.body.base, model: "test-model", key: "",
        expectedRevision: status.body.revision })).status, 400);
      const recovered = await f.save({ expectedRevision: status.body.revision });
      assert.equal(recovered.status, 200); assert.equal(recovered.body.state, "ready");
      assert.notEqual(recovered.body.revision, status.body.revision);
      await fs.writeFile(file, Buffer.alloc(128 * 1024 + 1, 1));
      assert.equal((await f.call({ action: "status" })).body.state, "unreadable");
    });

    await test("unavailable OS encryption and plaintext backend fail closed", async () => {
      for (const safeStorage of [{ isEncryptionAvailable: () => false },
        { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" }]) {
        const f = await fixture({ safeStorage });
        const status = await f.call({ action: "status" });
        assert.equal(status.body.state, "unsupported"); assert.equal(status.body.hasKey, false);
        assert.equal((await f.save()).status, 503);
        await assert.rejects(fs.access(path.join(f.directory, "ai-settings.dat")));
      }
    });

    await test("encryption or filesystem failures preserve previous settings and hide diagnostics", async () => {
      const f = await fixture(), saved = await f.save();
      const file = path.join(f.directory, "ai-settings.dat"), previous = await fs.readFile(file);
      f.safeStorage.encryptString = () => { throw new Error(SECRET + " native crypto diagnostics"); };
      const failed = await f.call({ action: "save", base: saved.body.base, model: "new-model", key: "",
        expectedRevision: saved.body.revision });
      assert.equal(failed.status, 503); noSecret(failed);
      assert.deepEqual(await fs.readFile(file), previous);
      assert.deepEqual((await f.call({ action: "status" })).body, saved.body);
      const blocked = await fixture();
      await fs.rm(blocked.directory, { recursive: true }); await fs.writeFile(blocked.directory, "occupied");
      const error = await blocked.call({ action: "status" });
      assert.equal(error.status, 500); assert.ok(!JSON.stringify(error.body).includes(blocked.directory));
    });

    await test("relay keeps credentials in main process, uses saved model and blocks forged connection fields", async () => {
      const f = await fixture(), saved = await f.save();
      const models = await f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay");
      assert.equal(models.status, 200); assert.equal(f.calls.length, 1);
      const call = f.calls[0];
      assert.equal(call.url, "https://provider.example/v1/models"); assert.equal(call.request.method, "GET");
      assert.equal(call.request.headers.Authorization, "Bearer " + SECRET);
      assert.equal(call.request.redirect, "manual"); assert.equal(call.request.credentials, "omit");
      assert.equal(call.request.cache, "no-store"); noSecret(models);
      const chat = await f.call({ path: "/chat/completions", configRevision: saved.body.revision,
        payload: { model: "test-model", messages: [{ role: "user", content: "synthetic athlete data" }] } }, "/api/relay");
      assert.equal(chat.status, 200); assert.equal(f.calls[1].request.method, "POST");
      assert.equal(JSON.parse(f.calls[1].request.body).model, "test-model");
      for (const [data, status] of [
        [{ path: "/models", base: saved.body.base, configRevision: saved.body.revision }, 400],
        [{ path: "/models", key: "attacker", configRevision: saved.body.revision }, 400],
        [{ path: "/arbitrary", configRevision: saved.body.revision }, 400],
        [{ path: "/models", payload: {}, configRevision: saved.body.revision }, 400],
        [{ path: "/chat/completions", payload: [], configRevision: saved.body.revision }, 400],
        [{ path: "/chat/completions", payload: { model: "another-model" }, configRevision: saved.body.revision }, 409],
        [{ path: "/models", configRevision: "stale" }, 409],
      ]) assert.equal((await f.call(data, "/api/relay")).status, status);
      assert.equal(f.calls.length, 2);
    });

    await test("upstream JSON redacts key in nested values and property names including provider errors", async () => {
      const f = await fixture(), saved = await f.save();
      f.setFetch(async () => Response.json({ error: { message: "provider rejected " + SECRET },
        [SECRET]: [{ value: SECRET }] }, { status: 401 }));
      const result = await f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay");
      assert.equal(result.status, 401); noSecret(result);
      assert.match(result.body.error.message, /密钥已隐藏/);
      assert.equal(result.body["[密钥已隐藏]"][0].value, "[密钥已隐藏]");
      f.setFetch(async () => { throw new Error("request failed with Authorization Bearer " + SECRET); });
      const error = await f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay");
      assert.equal(error.status, 502); noSecret(error);
    });

    await test("redirects never forward saved credential to another endpoint", async () => {
      const f = await fixture(), saved = await f.save(); let calls = 0;
      f.setFetch(async (_, options) => {
        calls++; assert.equal(options.redirect, "manual");
        return new Response("", { status: 302, headers: { Location: "https://attacker.example" } });
      });
      const response = await f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay");
      assert.equal(response.status, 502); assert.match(response.body.error.message, /重定向/);
      assert.equal(calls, 1); noSecret(response);
    });

    await test("response size, invalid JSON, invalid UTF-8 and excessive nesting are bounded", async () => {
      const f = await fixture({ maxBodyBytes: 1024 }), saved = await f.save();
      for (const upstream of [
        () => new Response("x".repeat(2048)),
        () => new Response("<html>upstream error</html>"),
        () => new Response(Buffer.from([0xff])),
        () => new Response("[".repeat(102) + "0" + "]".repeat(102)),
        () => new Response(null, { status: 204 }),
      ]) {
        f.setFetch(async () => upstream());
        const response = await f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay");
        assert.equal(response.status, 502); noSecret(response);
      }
    });

    await test("bad requests and mismatched origins or tokens never reach credentials or network", async () => {
      const f = await fixture({ maxBodyBytes: 1024 });
      for (const request of [
        { headers: { Origin: "https://attacker.example" } },
        { headers: { Origin: "null" } },
        { headers: { Origin: "motionbench://other" } },
        { headers: { "X-MotionBench-Token": "wrong" } },
      ]) assert.equal((await f.call({ action: "status" }, "/api/ai-settings", request)).status, 403);
      assert.equal((await f.call({ action: "status" }, "/api/ai-settings?x=1")).status, 403);
      assert.equal((await f.call({ action: "status" }, "/api/not-real")).status, 403);
      assert.equal((await f.call({ action: "unknown" })).status, 400);
      assert.equal((await f.call(["invalid"])).status, 400);
      assert.equal((await f.call({ action: "status", value: "x".repeat(1100) })).status, 413);
      assert.equal((await f.call({ action: "status" }, "/api/ai-settings", { body: "broken JSON" })).status, 400);
      assert.equal((await f.call({ action: "status" }, "/api/ai-settings", { body: "" })).status, 413);
      assert.equal((await f.call({ action: "status" }, "/api/ai-settings", { headers: { "Content-Length": "4096" } })).status, 413);
      assert.equal((await f.save({ key: "bad\nkey" })).status, 400);
      assert.equal((await f.save({ model: "bad\nmodel" })).status, 400);
      assert.equal(f.calls.length, 0);
    });

    await test("provider and response-body stalls time out and abort; renderer cancellation propagates", async () => {
      const f = await fixture({ modelsTimeoutMs: 25, chatTimeoutMs: 25 }), saved = await f.save();
      let signal;
      f.setFetch(async (_, options) => { signal = options.signal; return new Promise(() => {}); });
      const timeout = await f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay");
      assert.equal(timeout.status, 504); assert.equal(signal.aborted, true);
      let bodyCanceled = false;
      f.setFetch(async (_, options) => {
        signal = options.signal;
        return new Response(new ReadableStream({ start() {}, cancel() { bodyCanceled = true; } }));
      });
      const stalledBody = await f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay");
      assert.equal(stalledBody.status, 504); assert.equal(signal.aborted, true); assert.equal(bodyCanceled, true);
      const controller = new AbortController(); let start;
      const started = new Promise(resolve => { start = resolve; });
      f.setFetch(async (_, options) => { signal = options.signal; start(); return new Promise(() => {}); });
      const pending = f.call({ path: "/models", configRevision: saved.body.revision }, "/api/relay", { signal: controller.signal });
      await started; controller.abort();
      assert.equal((await pending).status, 499); assert.equal(signal.aborted, true);
    });

    console.log(passed + " desktop AI service checks passed");
  } finally {
    await Promise.all(directories.map(directory => fs.rm(directory, { recursive: true, force: true })));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
