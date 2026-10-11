(function (root) {
  "use strict";
  async function nativeRequest(path, serializedBody, signal) {
    const native = root.MotionBenchNative;
    if (typeof native?.requestAI !== "function") throw Error("未能连接本机 AI 服务，请重新打开程序。");
    const canceledError = () => new DOMException("AI 请求已取消", "AbortError");
    if (signal?.aborted) throw canceledError();
    const requestId = crypto.randomUUID();
    let rejectCanceled;
    const canceled = new Promise((_, reject) => { rejectCanceled = reject; });
    const onAbort = () => {
      // The preload can only send a bounded cancellation ID. Main validates
      // its originating window/frame before aborting the provider transport.
      try { Promise.resolve(native.cancelAI?.(requestId)).catch(() => {}); }
      catch {}
      rejectCanceled(canceledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      let result;
      try {
        result = await Promise.race([
          Promise.resolve(native.requestAI(path, serializedBody, requestId)), canceled,
        ]);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw canceledError();
        throw Error("未能连接本机 AI 服务，请重新打开程序。");
      }
      if (signal?.aborted) throw canceledError();
      if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599 ||
        !Object.hasOwn(result, "body"))
        throw Error("本机 AI 服务返回格式无效，请重新打开程序。");
      return new Response(JSON.stringify(result.body), {
        status: result.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function call(action, fields = {}) {
    const bridge = root.MotionBenchLocal;
    const native = typeof root.MotionBenchNative?.requestAI === "function";
    if (!bridge && !native) return { base: "", model: "", hasKey: false, revision: "0", state: "unsupported" };
    let response;
    try {
      response = native ? await nativeRequest("/api/ai-settings", JSON.stringify({ ...fields, action }), AbortSignal.timeout(15000)) :
        await fetch("/api/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-MotionBench-Token": bridge.token },
        body: JSON.stringify({ ...fields, action }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw Error("未能连接本机 AI 设置，请重新打开启动入口后重试。");
    }
    let data;
    try { data = await response.json(); }
    catch { throw Error("本机 AI 设置返回格式无效，请重新打开启动入口。"); }
    if (!response.ok || data.error) {
      const error = Error(data.error?.message || "未能保存本机 AI 设置，原配置已保留。");
      error.status = response.status;
      throw error;
    }
    return { base: data.base, model: data.model, hasKey: !!data.hasKey, revision: data.revision, state: data.state };
  }
  root.RingsideAISettings = {
    nativeRequest,
    status: () => call("status"),
    save: (fields) => call("save", fields),
    forget: (fields) => call("forget", fields),
  };
})(window);
