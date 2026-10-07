(function (global) {
  "use strict";
  const M = global.RingsideModel,
    T = global.RingsideTests;
  const sections = {
    catalog: [["catalog", "项目与指标"]],
    record: [
      ["definitions", "指标与评价标准"],
      ["abilities", "能力汇总"],
      ["rules", "筛查与评价阈值"],
      ["balance", "关节平衡"],
      ["lvp", "LVP 参数"],
      ["methods", "力定义与 DSI"],
    ],
    app: [
      ["ai", "AI 服务"],
      ["references", "参考资料与方法"],
    ],
  };
  const scopes = {
    catalog: {
      title: "测试项目库",
      note: "所有运动员共用；用于后续测试，已有记录保留自己的定义。",
    },
    record: { title: "本次评价设置", note: "仅影响当前选定的测试记录。未启用的标准不参与目标评价；未设区间时可按有效目标评价。配置状态仅在此处说明，报告保留有效评价与异常。" },
    app: { title: "应用设置", note: "管理分析服务，查阅参考资料与计算方法。" },
  };
  const scopeFor = (tab) =>
    Object.keys(sections).find((scope) =>
      sections[scope].some(([id]) => id === tab),
    ) || "record";
  function render({
    state,
    library,
    settingsTab,
    selectedDef,
    apiURL,
    key,
    model,
    controls,
  }) {
    const { E, input, select, field, check, table, regionOptions } = controls;
    const definition = (id) => state.definitions.find((d) => d.id === id);
    function renderCatalog() {
      const catalog = library.catalog;
      const conflicts = catalog.conflicts.filter(
        (conflict) => !conflict.resolved,
      );
      let html =
        '<h3>项目与指标目录</h3><p class="intro">维护可供所有运动员选择的测试项目。目录修改用于后续选择；已有记录可单独更新定义。</p><div class="row"><button type="button" class="btn small primary" onclick="App.openCatalogItem(\'new-test\')">＋ 新增测试项目</button><button type="button" class="btn small" onclick="App.openCatalogItem(\'new-metric\')">＋ 新增指标</button></div><p id="catalogMessage" class="note" role="status"></p>';
      if (conflicts.length) {
        html +=
          '<div class="notice"><h4>待确认的项目版本</h4><p>同一项目存在不同定义。确认共用版本后，该项目即可用于新的测试选择；已有测试记录保留原定义。</p></div>';
        catalog.conflicts.forEach((conflict, index) => {
          if (conflict.resolved) return;
          html += `<section class="catalog-conflict" data-catalog-conflict="${E(conflict.testId)}"><h4>${E(conflict.name)}</h4>`;
          conflict.variants.forEach((variant, variantIndex) => {
            html += `<div class="catalog-conflict-variant"><h5>版本 ${variantIndex + 1} · ${E(variant.source || "来源未注明")}</h5><p>${E(variant.test.name)} · ${variant.test.category === "screen" ? "筛查" : "运动表现"}</p><ul>${variant.definitions.map((d) => `<li><b>${E(d.name)}</b> · ${E(d.unit || "无单位")} · ${E(d.ability || "未填写能力分类")} · ${d.direction === "lower" ? "越低越好" : "越高越好"}${d.target === null || d.target === undefined || d.target === "" ? "" : ` · 目标 ${E(d.target)} ${E(d.unit)}`}<pre class="catalog-range-preview">${E(Def.rangeText(d.ranges))}</pre></li>`).join("")}</ul>${variant.protocol ? `<p class="note">协议：${E(variant.protocol)}</p>` : ""}<button type="button" class="btn small" onclick="App.resolveCatalogConflict(${index},${variantIndex})">采用此版本</button></div>`;
          });
          html += "</section>";
        });
      }
      for (const [category, label] of [
        ["screen", "筛查"],
        ["performance", "运动表现"],
      ]) {
        html += `<div class="subheading">${label}</div>`;
        html += T.describe(catalog)
          .filter((test) => test.category === category)
          .map((test) => {
            const definitions = catalog.definitions.filter(
                (d) => d.testId === test.id,
              ),
              blocked = conflicts.some(
                (conflict) => conflict.testId === test.id,
              );
            const adopted =
              state.enabled[test.id] ||
              state.customTests.some((t) => t.id === test.id) ||
              state.catalogAppliedTests?.includes(test.id);
            return `<section class="catalog-item" data-catalog-test="${E(test.id)}"><div class="catalog-item-heading"><h4>${E(test.name)}</h4><span class="note">${definitions.length} 个指标${test.primaryAbility ? " · " + E(test.primaryAbility) : ""}${blocked ? " · 待确认版本" : ""}</span></div><div class="row"><button type="button" class="btn small" onclick="App.openCatalogItem('edit','${E(test.id)}')" ${blocked ? "disabled" : ""}>编辑项目</button><button type="button" class="btn small" onclick="App.openCatalogItem('new-metric','${E(test.id)}')" ${blocked ? "disabled" : ""}>新增指标</button><button type="button" class="btn small" onclick="App.applyCatalogProject('${E(test.id)}')" ${blocked || !adopted ? "disabled" : ""}>更新本次定义</button></div>${definitions.length ? `<details class="catalog-metrics"><summary>查看 ${definitions.length} 个指标</summary>${definitions.map((d) => `<div class="reference-row"><span><b>${E(d.name)}</b> · ${E(d.unit || "无单位")}<small> · ${E(d.ability || "未填写能力分类")} · ${d.direction === "lower" ? "越低越好" : "越高越好"}${d.target === null || d.target === undefined || d.target === "" ? "" : ` · 目标 ${E(d.target)} ${E(d.unit)}`}</small></span><button type="button" class="btn small" onclick="App.openCatalogItem('edit','${E(test.id)}','${E(d.id)}')" ${blocked ? "disabled" : ""}>编辑指标</button></div>`).join("")}</details>` : '<p class="note">使用该项目的固定测量表。</p>'}${catalog.protocol[test.id] ? `<p class="note">协议：${E(catalog.protocol[test.id])}</p>` : ""}</section>`;
          })
          .join("");
      }
      return html;
    }

    function lvpLabel(id) {
      return {
        bench: "卧推",
        squat: "深蹲",
        deadlift: "硬拉",
        landmineR: "地雷杠 · R",
        landmineL: "地雷杠 · L",
      }[id];
    }
    let h = "";
    if (settingsTab === "catalog") h = renderCatalog();
    else if (settingsTab === "definitions") {
      if (!definition(selectedDef)) selectedDef = state.definitions[0]?.id;
      const d = definition(selectedDef),
        i = state.definitions.indexOf(d);
      h =
        '<h3>本次指标评价</h3><p class="note">以下设置只影响当前测试。项目与指标的新增和共用定义请前往目录。</p><div class="row">' +
        `<select style="flex:1" aria-label="本次评价指标" onchange="App.selectDef(this.value)">${state.definitions.map((d) => `<option value="${E(d.id)}" ${d.id === selectedDef ? "selected" : ""}>${E(d.name)} · ${E(d.unit)}</option>`).join("")}</select>` +
        "</div>";
      if (d)
        h +=
          '<div class="form-grid">' +
          field(
            "指标名称",
            input("definitions." + i + ".name", d.name, { type: "text" }),
          ) +
          field(
            "能力分类（影响能力汇总）",
            input("definitions." + i + ".ability", d.ability || "", {
              type: "text",
            }),
          ) +
          field(
            "评价目标",
            input("definitions." + i + ".target", d.target ?? ""),
          ) +
          field(
            "评价方向",
            select("definitions." + i + ".direction", d.direction, [
              ["higher", "数值越高越好"],
              ["lower", "数值越低越好"],
            ]),
          ) +
          (T.isManualMetric(d)
            ? field(
                "单位",
                `<input type="text" value="${E(d.unit)}" data-metric-unit="${E(d.id)}" aria-label="单位" maxlength="30">`,
              ) +
              field(
                "项目报告分类（影响全部指标）",
                select("definitions." + i + ".category", d.category, [
                  ["performance", "运动表现"],
                  ["screen", "筛查"],
                ]),
              ) +
              field(
                "人体区域",
                select(
                  "definitions." + i + ".region",
                  d.region || "",
                  regionOptions(),
                ),
              )
            : "") +
          field(
            "参考来源 / 适用人群 / 协议",
            input("definitions." + i + ".source", d.source, { type: "text" }),
            true,
          ) +
          "</div>" +
          check(
            "definitions." + i + ".referenceEnabled",
            d.referenceEnabled,
            "启用匹配的评价标准",
          ) +
          `<label class="field" style="margin:13px 0"><span>评价区间：范围 | 名称 | red / amber / green</span><textarea id="rangesText" rows="5">${E(Def.rangeText(d.ranges))}</textarea></label><button class="btn small primary" onclick="App.saveRanges()">应用区间</button><span id="rangeMessage" class="note"></span>` +
          table(
            ["等级", "范围", "认定为优势"],
            d.ranges.map((r, j) => [
              E(r.label),
              E(Def.rangeText([r]).split("|")[0]),
              check(
                "definitions." + i + ".ranges." + j + ".advantage",
                !!r.advantage,
                "优势等级",
              ),
            ]),
          );
    } else if (settingsTab === "balance") {
      h =
        '<h3>关节平衡配对</h3><p class="intro">按明确的测试方向配对。力值比与力矩比应分别设置评价依据。</p>';
      h +=
        state.balancePairs
          .map(
            (p, i) =>
              `<div style="border-bottom:1px solid var(--line);padding:14px 0"><h4>${E(p.label)}</h4><div class="form-grid">${field(
                "分子方向",
                select(
                  "balancePairs." + i + ".numeratorId",
                  p.numeratorId,
                  state.data.iso.map((r) => [
                    r.id,
                    M.REG[r.region] + " · " + r.direction,
                  ]),
                ),
              )}${field(
                "分母方向",
                select(
                  "balancePairs." + i + ".denominatorId",
                  p.denominatorId,
                  state.data.iso.map((r) => [
                    r.id,
                    M.REG[r.region] + " · " + r.direction,
                  ]),
                ),
              )}${field("配对名称", input("balancePairs." + i + ".label", p.label, { type: "text" }))}${field("协议 / 评价依据", input("balancePairs." + i + ".source", p.source || "", { type: "text" }), true)}</div>${check("balancePairs." + i + ".confirmed", p.confirmed, "确认测量口径、单位和配对协议可比较")}${check("balancePairs." + i + ".referenceEnabled", p.referenceEnabled, "启用评价区间")}<textarea id="balanceRanges-${i}" rows="3" style="width:100%;margin-top:9px" placeholder="范围 | 等级 | red / amber / green">${E(Def.rangeText(p.ranges))}</textarea><button class="btn small" onclick="App.saveBalanceRanges(${i})">应用区间</button></div>`,
          )
          .join("") +
        '<button class="btn small" style="margin-top:14px" onclick="App.addBalance()">＋ 新增配对</button>';
    } else if (settingsTab === "lvp") {
      h =
        '<h3>MVT与素质区间</h3><p class="intro">设置对应动作、速度口径和设备的参数。</p>';
      for (const id of [
        "bench",
        "landmineR",
        "landmineL",
        "squat",
        "deadlift",
      ]) {
        const p = state.lvp[id];
        h += `<div style="border-bottom:1px solid var(--line);padding:14px 0"><h4>${E(lvpLabel(id))}</h4><div class="form-grid">${field(
          "速度口径",
          select("lvp." + id + ".metric", p.metric, [
            ["MV", "平均速度 MV"],
            ["MPV", "平均推进速度 MPV"],
            ["PV", "峰值速度 PV"],
          ]),
        )}${field("MVT m/s", input("lvp." + id + ".mvt", p.mvt))}${field("参数依据 / 设备", input("lvp." + id + ".source", p.source || "", { type: "text" }), true)}</div><label class="field"><span>素质区间：速度下限..上限 | 素质名称</span><textarea id="zones-${id}" rows="3">${E((p.zones || []).map((z) => z.min + ".." + z.max + " | " + z.label).join("\n"))}</textarea></label><button class="btn small" style="margin-top:7px" onclick="App.saveZones('${id}')">应用区间</button></div>`;
      }
    } else if (settingsTab === "rules") {
      h =
        '<h3>筛查与评价阈值</h3><p class="intro">影响本次报告中的关注等级、双侧差异提示与目标达成评价。</p><div class="form-grid">' +
        field(
          "不对称关注阈值 %",
          input("rules.asymAmber", state.rules.asymAmber, { max: 100 }),
        ) +
        field(
          "不对称重点关注阈值 %",
          input("rules.asymRed", state.rules.asymRed, { max: 100 }),
        ) +
        field(
          "绝对力重点关注比例 %",
          input("rules.absoluteAmber", state.rules.absoluteAmber, { max: 100 }),
        ) +
        field(
          "目标达成黄灯下界 %",
          input("rules.scoreAmber", state.rules.scoreAmber, { max: 100 }),
        ) +
        field(
          "目标达成绿灯下界 %",
          input("rules.scoreGreen", state.rules.scoreGreen, { max: 100 }),
        ) +
        "</div>";
      h +=
        '<p class="note">FMS 分数保持 0–3 分：0 疼痛、1 未完成、2 代偿完成、3 无代偿完成。</p>';
    } else if (settingsTab === "abilities") {
      h =
        '<h3>能力汇总</h3><p class="intro">设置运动表现概览中每项能力的得分来源：代表指标、平均达成或最低达成。目标达成度按本次指标标准计算。</p>';
      for (const ability of [
        ...new Set(
          state.definitions
            .filter((d) => d.category === "performance" && d.ability)
            .map((d) => d.ability),
        ),
      ]) {
        const ds = state.definitions.filter((d) => d.ability === ability),
          cfg = T.axisConfig(state, ability) || {
            method: "primary",
            primary: ds[0].id,
          };
        h += `<div class="reference-row"><b>${E(T.abilityLabel(state,ability))}</b><select data-axis="${E(ability)}" data-axis-key="method">${[
          ["primary", "代表指标"],
          ["mean", "平均达成"],
          ["min", "最低达成"],
        ]
          .map(
            ([v, n]) =>
              `<option value="${v}" ${cfg.method === v ? "selected" : ""}>${n}</option>`,
          )
          .join(
            "",
          )}</select><select data-axis="${E(ability)}" data-axis-key="primary">${ds.map((d) => `<option value="${E(d.id)}" ${cfg.primary === d.id ? "selected" : ""}>${E(d.name)}</option>`).join("")}</select></div>`;
      }
    } else if (settingsTab === "methods")
      h =
        '<h3>力定义与 DSI 方法</h3><p class="intro">使用设备实际输出口径；比较 CMJ 与全身等长力前须确认协议可比较。</p><div class="form-grid">' +
        field(
          "CMJ 力定义",
          select("cmjConfig.definition", state.cmjConfig.definition, [
            ["gross", "总力"],
            ["net", "净力"],
          ]),
        ) +
        field(
          "IMTP 力定义",
          select("imtpConfig.definition", state.imtpConfig.definition, [
            ["gross", "总力"],
            ["net", "净力"],
          ]),
        ) +
        (state.dsi.source === "manual"
          ? field(
              "其他全身等长力定义",
              select("dsi.definition", state.dsi.definition, [
                ["gross", "总力"],
                ["net", "净力"],
              ]),
            )
          : "") +
        "</div>" +
        check(
          "dsi.confirmed",
          state.dsi.confirmed,
          "确认CMJ与等长测试的单位、力定义和协议可比较",
        );
    else if (settingsTab === "ai")
      h =
        '<h3>AI 综合建议</h3><p class="intro">将本次测试与训练背景交给所选模型综合解读，生成可编辑的训练建议。</p>' +
        (window.MotionBenchLocal
          ? '<p class="notice">已通过本机启动入口打开，可连接中转服务。首次从原 HTML 切换到这里，请在原页面导出运动员库，再在此处“保存与导入”中导入。</p>'
          : '<p class="notice">当前由浏览器直接连接。若中转站拒绝浏览器访问，请关闭本页，使用项目中的“启动 MotionBench”入口，再导入运动员库备份。</p>') + '<div class="form-grid">' +
        field(
          "API基础地址",
          `<input id="apiURL" type="url" value="${E(apiURL)}" placeholder="https://api.example.com">`,
          true,
        ) +
        field(
          "API Key",
          `<input id="apiKey" type="password" value="${E(key)}" autocomplete="off" aria-label="API Key">`,
        ) +
        field(
          "模型名称",
          `<input id="apiModel" value="${E(model)}" list="modelList" aria-label="模型名称"><datalist id="modelList"></datalist>`,
        ) +
        '</div><div class="row"><button class="btn small" id="modelButton" onclick="App.models()">读取可用模型</button><button class="btn small" onclick="App.copyAIFacts()">复制分析资料</button></div><p id="apiMessage" class="note" role="status" aria-live="polite"></p><p class="note">请使用服务提供的模型名称。官方 DeepSeek 与中转站的可用模型可能不同；读取列表后再选择。生成建议还需模型调用权限与可用额度。</p><p class="notice">密钥仅在本次使用的内存中保留，不写入报告或备份。生成 AI 建议时发送当前测试结果与相关背景，不发送姓名字段或其他运动员记录；请勿在自由备注中填写不希望发送的身份信息。</p>';
    else
      h =
        '<h3>参考与方法</h3><p class="intro">原始参考内容保留在设置中，评价区间以团队确认的协议和人群为准。</p><p>不对称性：|L−R| / max(L,R) × 100%；两侧均为0时无有效差异。IR:ER为内旋／外旋，H:Q为膝屈／膝伸。</p><p>EUR = CMJ / SJ；DSI = CMJ推进峰值力 / 可比全身等长峰值力；ASR = MSS − MAS。VIFT独立于MAS。</p><p>LVP采用负荷汇总后的线性回归，置信带为95%均值响应；估计负荷 = (MVT−截距) / 斜率。零速度截距不作为1RM。</p><p>原书参考：Turner（2018），Routledge Handbook of Strength and Conditioning，第22章表22.2。原表空档和边界保留；地雷杠35/40 kg参考数值需由团队审查适用性。</p><p><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7706654/" target="_blank" rel="noopener">DSI研究</a> · <a href="https://pubmed.ncbi.nlm.nih.gov/29466270/" target="_blank" rel="noopener">LVP研究</a> · <a href="https://30-15ift.com/" target="_blank" rel="noopener">30–15 IFT协议</a></p>';
    return { html: h, selectedDef };
  }
  global.RingsideSettings = { render, sections, scopes, scopeFor };
})(window);
