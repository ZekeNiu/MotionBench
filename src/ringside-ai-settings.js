(function (root) {
  "use strict";
  async function call(action, fields = {}) {
    const bridge = root.MotionBenchLocal;
    if (!bridge) return { base: "", model: "", hasKey: false, revision: "0", state: "unsupported" };
    let response;
    try {
      response = await fetch("/api/ai-settings", {
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
    status: () => call("status"),
    save: (fields) => call("save", fields),
    forget: (fields) => call("forget", fields),
  };
})(window);
