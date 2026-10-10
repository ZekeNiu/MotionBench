(function (global) {
  "use strict";
  const M = global.RingsideModel,
    T = global.RingsideTests;
  const sections = { ai: [["ai", "AI 服务"]], references: [["references", "参考资料与方法"]] };
  const scopes = {
    ai: { title: "AI 服务", note: "配置分析服务与模型，管理本机保存的连接。" },
    references: { title: "参考资料与方法", note: "查阅测试协议、计算公式、采用的数据和原始文献。" },
  };
  const scopeFor = tab => tab === "ai" ? "ai" : "references";
  function render({
    state,
    library,
    settingsTab,
    selectedDef,
    apiURL,
    key,
    model,
    aiConfig = null,
    aiDirty = false,
    aiBusy = false,
    controls,
  }) {
    const { E, input, select, field, check, table, regionOptions } = controls;
    let h = "";
    if (settingsTab === "ai")
      h =
        '<h3>AI 综合建议</h3><p class="intro">将本次测试与训练背景交给所选模型综合解读，生成可编辑的训练建议。</p>' +
        (window.MotionBenchLocal
          ? '<p class="notice">连接设置由 Windows 加密保存在这台电脑上，重新打开后可继续使用。首次从 HTML 文件切换到本机入口，请通过“备份与恢复”导入原页面的完整备份。</p>'
          : '<p class="notice">此 HTML 页面使用临时密钥。通过项目中的“启动 MotionBench”入口打开，可加密保存连接并在下次使用；原资料可通过“备份与恢复”迁移。</p>') + '<div class="form-grid">' +
        field(
          "API基础地址",
          `<input id="apiURL" type="url" value="${E(apiURL)}" placeholder="https://api.example.com" ${aiBusy ? "disabled" : ""}>`,
          true,
        ) +
        field(
          "API Key",
          `<input id="apiKey" type="password" value="${E(key)}" autocomplete="off" aria-label="API Key" placeholder="${aiConfig?.hasKey ? "已保存；填写新密钥可替换" : "填写服务密钥"}" ${aiBusy ? "disabled" : ""}>`,
        ) +
        field(
          "模型名称",
          `<input id="apiModel" value="${E(model)}" list="modelList" aria-label="模型名称" ${aiBusy ? "disabled" : ""}><datalist id="modelList"></datalist>`,
        ) +
        '</div>' + (window.MotionBenchLocal ? `<p id="aiConfigStatus" class="note" role="status" aria-live="polite">${E(aiStatusText(aiConfig, aiDirty, aiBusy))}</p>` : '') +
        '<div class="row">' + (window.MotionBenchLocal ? `<button class="btn small primary" id="saveAISettingsButton" onclick="App.saveAISettings()" ${aiBusy || !aiConfig ? "disabled" : ""}>保存设置</button>` : '') +
        `<button class="btn small" id="modelButton" onclick="App.models()" ${aiBusy ? "disabled" : ""}>读取可用模型</button>` +
        (window.MotionBenchLocal ? `<button class="btn small" id="forgetAIKeyButton" onclick="App.forgetAIKey()" ${aiBusy || (!aiConfig?.hasKey && aiConfig?.state !== "unreadable") ? "disabled" : ""}>忘记密钥</button>` : '') +
        '<button class="btn small" onclick="App.copyAIFacts()">复制分析资料</button></div><p id="apiMessage" class="note" role="status" aria-live="polite"></p>' +
        (window.MotionBenchLocal ? '<p class="note">首次填写地址和密钥后先保存，再读取模型；选定模型后保存即可。更换服务地址时需填写对应密钥。</p>' : '') +
        '<p class="note">请使用服务提供的模型名称。读取列表成功后，生成建议仍需模型权限和可用额度。</p><p class="notice">密钥不写入报告或运动员库备份。生成 AI 建议时发送当前测试结果与相关训练背景，不发送姓名字段或其他运动员记录。</p>';
    else
      h = global.RingsideSources.render({ E });
    return { html: h, selectedDef };
  }
  function aiStatusText(config, dirty, busy) {
    if (busy) return "正在更新本机 AI 设置…";
    if (dirty) return "有未保存的设置，请保存后读取模型或生成建议。";
    if (!config) return "正在读取本机 AI 设置…";
    if (config.state === "unreadable") return "无法解密已有设置，请重新填写密钥并保存，或忘记原密钥。";
    if (config.state === "unsupported") return "当前启动环境不支持 Windows 加密保存。";
    if (!config.hasKey) return "尚未保存密钥。";
    return config.model ? "密钥与模型已加密保存。" : "密钥已加密保存，请读取并选择模型后保存。";
  }
  global.RingsideSettings = { render, sections, scopes, scopeFor, aiStatusText };
})(window);
