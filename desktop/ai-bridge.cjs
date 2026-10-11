"use strict";

// A small host-only adapter: callers never choose request headers or receive
// the private service token. The BrowserWindow owner supplies frame validation.
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE = 8;
const ALLOWED_PATHS = new Set(["/api/ai-settings", "/api/relay"]);

function failure(status, message) { return { status, body: { error: { message } } }; }
function validId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && !/[\x00-\x1f\x7f]/.test(id);
}

function createAIBridge({ service, origin, token, isTrustedSender }) {
  if (typeof service?.handle !== "function" || typeof isTrustedSender !== "function" ||
      typeof token !== "string" || token.length < 32 || token.length > 256 || /[\x00-\x1f\x7f]/.test(token))
    throw new TypeError("A private AI service, token and sender validator are required");
  const originURL = new URL(origin);
  if (!originURL.host || originURL.username || originURL.password || originURL.search || originURL.hash || originURL.pathname !== "")
    throw new TypeError("AI bridge origin must be a bare scheme and host");
  const pending = new Map();
  const trusted = event => {
    try { return isTrustedSender(event) === true; } catch { return false; }
  };

  async function handle(event, requestPath, bodyString, id) {
    if (!trusted(event)) return failure(403, "请从 MotionBench 主窗口发起 AI 请求");
    if (!ALLOWED_PATHS.has(requestPath) || !validId(id) || typeof bodyString !== "string")
      return failure(400, "AI 请求内容无效");
    if (Buffer.byteLength(bodyString, "utf8") > MAX_BODY_BYTES)
      return failure(413, "AI 请求资料过大");
    if (pending.has(id)) return failure(409, "AI 请求标识已在使用，请重试");
    if (pending.size >= MAX_ACTIVE) return failure(429, "AI 请求过多，请稍后重试");
    const controller = new AbortController();
    const entry = { sender: event.sender, controller };
    pending.set(id, entry);
    try {
      const request = new Request(origin + requestPath, {
        method: "POST", body: bodyString, signal: controller.signal,
        headers: { "Content-Type": "application/json", Origin: origin, "X-MotionBench-Token": token },
      });
      const response = await service.handle(request);
      if (!Number.isInteger(response?.status) || response.status < 200 || response.status > 599)
        throw new Error("Invalid service response");
      const body = await response.json();
      return { status: response.status, body };
    } catch {
      return failure(controller.signal.aborted ? 499 : 500,
        controller.signal.aborted ? "AI 请求已取消" : "无法完成本机 AI 请求，请重试");
    } finally {
      if (pending.get(id) === entry) pending.delete(id);
    }
  }

  function cancel(event, id) {
    if (!trusted(event) || !validId(id)) return false;
    const entry = pending.get(id);
    if (!entry || entry.sender !== event.sender) return false;
    entry.controller.abort();
    return true;
  }

  function cancelAll() {
    const count = pending.size;
    for (const entry of pending.values()) entry.controller.abort();
    return count;
  }

  return Object.freeze({ handle, cancel, cancelAll });
}

module.exports = { createAIBridge };
