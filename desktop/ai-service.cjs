"use strict";

// Main-process AI service. No renderer-facing API returns a credential, and no
// plaintext credential is written to disk. Electron safeStorage is injected so
// this module can be tested without Electron or a real provider account.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");

const MAX_BODY = 8 * 1024 * 1024;
const MAX_SETTINGS = 128 * 1024;
const DEFAULT_BASE = "https://api.apikey.fan/v1";
const INVALID_BASE = "请填写有效的 HTTPS API 基础地址";
const LOCAL_BASE = "本机连接入口只支持公网 HTTPS AI 服务";
const REVISION_CHANGED = "AI 设置已在其他页面更新，请重新载入设置后重试";

class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function validString(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength && !/[\x00-\x1f\x7f]/.test(value);
}

function isLocalLiteral(host) {
  const family = net.isIP(host);
  if (family === 4) {
    const octets = host.split(".").map(Number), [a, b, c] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    // Global unicast only. Reject transition/documentation ranges as well as
    // loopback, link-local, unique-local and IPv4-mapped private addresses.
    const first = parseInt(host.split(":")[0] || "0", 16);
    return first < 0x2000 || first > 0x3fff || first === 0x2002 ||
      (first === 0x2001 && (host.startsWith("2001:db8:") ||
        parseInt(host.split(":")[1] || "0", 16) < 0x200));
  }
  return false;
}

function normalizeBase(input) {
  if (!validString(input, 2048)) throw new ServiceError(INVALID_BASE);
  let base = input.trim().replace(/\/+$/, "");
  base = base.replace(/\/(?:chat\/completions|models)$/, "");
  if (!base.endsWith("/v1")) base += "/v1";
  let url;
  try { url = new URL(base); } catch { throw new ServiceError(INVALID_BASE); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash)
    throw new ServiceError(INVALID_BASE);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isLocalLiteral(host))
    throw new ServiceError(LOCAL_BASE);
  // Public hostnames may resolve into a VPN client's synthetic address range.
  // Preserve the browser launcher's policy: reject explicit local targets,
  // rather than DNS-blocking a public AI service behind a user's VPN.
  return url.href.replace(/\/+$/, "");
}

function publicSettings(value) {
  return { base: value.base, model: value.model, revision: value.revision,
    state: value.state, hasKey: !!value.key };
}

function emptySettings(revision = "0", state = "empty") {
  return { schema: 1, base: DEFAULT_BASE, model: "", key: "", revision, state };
}

class CredentialStore {
  constructor({ directory, safeStorage }) {
    if (typeof directory !== "string" || !path.isAbsolute(directory))
      throw new TypeError("AI settings directory must be an absolute path");
    this.directory = directory;
    this.safeStorage = safeStorage;
    this.queue = Promise.resolve();
  }

  supported() {
    try {
      // Linux's basic_text fallback provides no OS encryption. Fail closed if
      // someone runs a development build without an available secure backend.
      return !!this.safeStorage?.isEncryptionAvailable() &&
        this.safeStorage.getSelectedStorageBackend?.() !== "basic_text";
    } catch { return false; }
  }

  locked(operation) {
    const result = this.queue.then(async () => {
      if (!this.supported()) throw new ServiceError("系统加密不可用，无法保存 AI 密钥", 503);
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async read() {
    let handle;
    try { handle = await fs.open(path.join(this.directory, "ai-settings.dat"), "r"); }
    catch (error) { if (error.code === "ENOENT") return emptySettings(); throw error; }
    let data, stat;
    try {
      stat = await handle.stat();
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_SETTINGS + 1));
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      data = buffer.subarray(0, length);
    } finally { await handle.close(); }
    const revision = "unreadable:" + crypto.createHash("sha256")
      .update(data).update(String(stat.size)).digest("hex");
    try {
      if (stat.size > MAX_SETTINGS || data.length !== stat.size) throw new Error("size");
      const value = JSON.parse(this.safeStorage.decryptString(data));
      if (!value || value.schema !== 1 ||
        !validString(value.key, 16384) || !validString(value.model, 512) ||
        !validString(value.revision, 128) || !value.revision || normalizeBase(value.base) !== value.base)
        throw new Error("schema");
      return { schema: 1, base: value.base, model: value.model, key: value.key,
        revision: value.revision, state: value.key ? "ready" : "empty" };
    } catch { return emptySettings(revision, "unreadable"); }
  }

  checkRevision(value, expected) {
    if (typeof expected !== "string" || expected !== value.revision)
      throw new ServiceError(REVISION_CHANGED, 409);
  }

  async write(value) {
    let encrypted;
    try {
      const { schema, base, model, key, revision } = value;
      encrypted = this.safeStorage.encryptString(JSON.stringify({ schema, base, model, key, revision }));
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_SETTINGS)
        throw new Error("invalid ciphertext");
    } catch { throw new ServiceError("系统无法加密 AI 设置，原配置已保留", 503); }
    const temporary = path.join(this.directory, ".ai-settings-" + crypto.randomUUID() + ".tmp");
    let handle;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(encrypted);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, path.join(this.directory, "ai-settings.dat"));
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  status() {
    if (!this.supported()) return Promise.resolve(publicSettings(emptySettings("0", "unsupported")));
    return this.locked(async () => publicSettings(await this.read()));
  }

  save({ base, model = "", key, expectedRevision }) {
    base = normalizeBase(base);
    if (!validString(model, 512)) throw new ServiceError("模型名称无效");
    if (key !== undefined && key !== null && !validString(key, 16384)) throw new ServiceError("密钥格式无效");
    key = key ? key.trim() : "";
    return this.locked(async () => {
      const previous = await this.read();
      this.checkRevision(previous, expectedRevision);
      if (!key) {
        if (base !== previous.base) throw new ServiceError("更换服务地址时请填写该服务的密钥");
        if (!previous.key || previous.state === "unreadable") throw new ServiceError("请填写密钥");
        key = previous.key;
      }
      const value = { schema: 1, base, model: model.trim(), key,
        revision: crypto.randomUUID().replaceAll("-", ""), state: "ready" };
      await this.write(value);
      return publicSettings(value);
    });
  }

  forget({ expectedRevision }) {
    return this.locked(async () => {
      const previous = await this.read();
      this.checkRevision(previous, expectedRevision);
      const value = { ...previous, key: "", revision: crypto.randomUUID().replaceAll("-", ""), state: "empty" };
      await this.write(value);
      return publicSettings(value);
    });
  }

  connection(revision) {
    return this.locked(async () => {
      const value = await this.read();
      this.checkRevision(value, revision);
      if (!value.key || value.state !== "ready") throw new ServiceError("请先保存有效的 AI 密钥", 409);
      return value;
    });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  } });
}

function failure(status, message) { return jsonResponse(status, { error: { message } }); }

async function boundedBody(body, limit, oversizeMessage, signal) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader(), chunks = [];
  let length = 0;
  // cancel() resolves pending reader.read() calls even while an underlying
  // transport is stalled. Avoid attaching one Promise.race handler per chunk.
  const onAbort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Response stream aborted");
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error("Response stream aborted");
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw new ServiceError(oversizeMessage, 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function redact(value, key, depth = 0) {
  if (depth > 100) throw new ServiceError("AI 服务返回内容结构过于复杂", 502);
  if (typeof value === "string") return value.split(key).join("[密钥已隐藏]");
  if (Array.isArray(value)) return value.map(item => redact(item, key, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([name, item]) => [redact(name, key, depth + 1), redact(item, key, depth + 1)]));
  return value;
}

function matchingOrigin(candidate, origin) {
  try {
    const url = new URL(candidate), expected = new URL(origin);
    return url.protocol === expected.protocol && url.host === expected.host &&
      !url.username && !url.password;
  } catch { return false; }
}

function equalToken(candidate, token) {
  if (typeof candidate !== "string" || candidate.length > 256) return false;
  const left = Buffer.from(candidate || ""), right = Buffer.from(token);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * createAIService({ directory, safeStorage, origin, token, fetch?,
 *                   maxBodyBytes?, modelsTimeoutMs?, chatTimeoutMs? })
 * Returns { handle(request): Promise<Response> }. Pass Electron net.fetch as
 * fetch to reuse Windows system proxy settings. The host must remain single
 * instance, and must route requests only from its own trusted main frame.
 */
function createAIService(options) {
  const { directory, safeStorage, origin, token, fetch: fetchImpl = globalThis.fetch,
    maxBodyBytes = MAX_BODY, modelsTimeoutMs = 55000, chatTimeoutMs = 295000 } = options;
  if (!validString(token, 256) || token.length < 32 || typeof fetchImpl !== "function")
    throw new TypeError("A private service token and fetch implementation are required");
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_BODY ||
    !Number.isInteger(modelsTimeoutMs) || modelsTimeoutMs < 1 || modelsTimeoutMs > 300000 ||
    !Number.isInteger(chatTimeoutMs) || chatTimeoutMs < 1 || chatTimeoutMs > 300000)
    throw new TypeError("AI service limits are invalid");
  const originURL = new URL(origin);
  if (!originURL.host || originURL.username || originURL.password || originURL.search || originURL.hash || originURL.pathname !== "")
    throw new TypeError("AI service origin must be a bare scheme and host");
  const credentials = new CredentialStore({ directory, safeStorage });

  async function relay(data, requestSignal) {
    if (Object.hasOwn(data, "key") || Object.hasOwn(data, "base"))
      throw new ServiceError("本机 AI 请求应使用已保存的配置，请刷新页面后重试");
    if (data.path !== "/models" && data.path !== "/chat/completions") throw new ServiceError("请求内容无效");
    const connection = await credentials.connection(data.configRevision), payload = data.payload;
    if ((data.path === "/models" && payload != null) ||
      (data.path === "/chat/completions" && (!payload || typeof payload !== "object" || Array.isArray(payload))))
      throw new ServiceError("请求内容无效");
    if (payload && (!connection.model || payload.model !== connection.model))
      throw new ServiceError("模型与本机设置不一致，请保存所选模型后重试", 409);
    const controller = new AbortController();
    let timer, timedOut = false, stopped;
    const canceled = new Promise((_, reject) => { stopped = reject; });
    const onAbort = () => {
      controller.abort();
      stopped(new ServiceError("AI 请求已取消", 499));
    };
    if (requestSignal?.aborted) throw new ServiceError("AI 请求已取消", 499);
    requestSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      stopped(new ServiceError("AI 服务响应超时，请重试或更换模型", 504));
    }, payload ? chatTimeoutMs : modelsTimeoutMs);
    const network = (async () => {
      const response = await fetchImpl(normalizeBase(connection.base) + data.path, {
        method: payload ? "POST" : "GET", redirect: "manual", credentials: "omit",
        referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal,
        headers: { Authorization: "Bearer " + connection.key, "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        throw new ServiceError("AI 服务返回重定向，已阻止密钥转发，请核对 API 地址", 502);
      }
      if (response.status < 200 || response.status > 599) throw new ServiceError("AI 服务返回状态无效", 502);
      let bytes;
      try { bytes = await boundedBody(response.body, maxBodyBytes, "AI 服务返回内容过大", controller.signal); }
      catch (error) { if (error instanceof ServiceError) error.status = 502; throw error; }
      let decoded;
      try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new ServiceError("AI 服务未返回有效 JSON，请核对 API 地址", response.status >= 400 ? response.status : 502); }
      return jsonResponse(response.status, redact(decoded, connection.key));
    })();
    try { return await Promise.race([network, canceled]); }
    catch (error) {
      if (error instanceof ServiceError) throw error;
      if (timedOut) throw new ServiceError("AI 服务响应超时，请重试或更换模型", 504);
      if (requestSignal?.aborted) throw new ServiceError("AI 请求已取消", 499);
      throw new ServiceError("无法连接 AI 服务，请检查网络与服务地址", 502);
    } finally {
      clearTimeout(timer);
      requestSignal?.removeEventListener("abort", onAbort);
      controller.abort();
    }
  }

  async function handle(request) {
    try {
      const url = new URL(request.url);
      if (!matchingOrigin(url.href, origin) || !["/api/relay", "/api/ai-settings"].includes(url.pathname) ||
        url.search || url.hash || request.method !== "POST" ||
        !matchingOrigin(request.headers.get("Origin"), origin) ||
        !equalToken(request.headers.get("X-MotionBench-Token"), token))
        return failure(403, "请从本机启动页面发起请求");
      const length = request.headers.get("Content-Length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes || Number(length) === 0))
        throw new ServiceError("请求资料过大或为空", 413);
      const body = await boundedBody(request.body, maxBodyBytes, "请求资料过大或为空");
      if (!body.length) throw new ServiceError("请求资料过大或为空", 413);
      let data;
      try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
      catch { throw new ServiceError("请求内容无效"); }
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new ServiceError("请求内容无效");
      if (url.pathname === "/api/relay") return await relay(data, request.signal);
      let result;
      if (data.action === "status") result = await credentials.status();
      else if (data.action === "save") result = await credentials.save(data);
      else if (data.action === "forget") result = await credentials.forget(data);
      else throw new ServiceError("AI 设置操作无效");
      return jsonResponse(200, result);
    } catch (error) {
      if (error instanceof ServiceError) return failure(error.status, error.message);
      // Do not expose filesystem paths, native crypto diagnostics or network
      // request objects: these can contain user information or credentials.
      return failure(500, "无法读写本机 AI 设置，原配置已保留，请检查磁盘与目录权限");
    }
  }

  return Object.freeze({ handle });
}

module.exports = { createAIService, CredentialStore, normalizeBase, ServiceError };
