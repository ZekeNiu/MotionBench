# MotionBench 按变更风险验收

每次验收由最终源码差异及受影响行为决定。显示调整无需在本地重复执行所有项目、所有浏览器与整份长报告；真实资料保护、最终程序身份及公开附件校验每次保留。

## 本轮范围：2.24.9

只为纵向比较的运动表现概览雷达增加基于评价标准的底色。业务变更限定 `src/ringside-result-display.js` 的能力评价投影、`src/ringside-longitudinal.js` 的纯显示字段 `overviewReference`，以及 `src/ringside-longitudinal-view.js` 的雷达底色绘制。风险筛查、mini、原始测量、评分公式、评价标准、存储、PDF 引擎和 Electron 运行环境保留。

共同底色只能表示所展示日期共用的实际标准：各维度单独确定区段，标准缺失、各期不同或无法唯一投影时留白。不得把能力评分 0–100 直接套成一套全局红黄绿界限；上限或下限饱和导致评分无法唯一确定等级时，不制造区间。

## 可继承的基线

本轮直接基线为 2.24.8，提交 `5371d20288c64be346e3510ddbc9b75d66d537b5`，验收记录 `docs/acceptance-2.24.8.json`；其未变化功能沿用 2.24.7 的完整验收。复用前核验基线源码、验收记录及已有本地凭据的实际字节。

继承至少逐文件覆盖除三项明确变更外的 `src/`、`desktop/`、`vendor/`、构建脚本和资料保护辅助文件；依赖及打包配置仅允许版本元数据变化。超出范围的差异必须重新评估，不能自动复用。报告分别列出本轮新运行、基线继承和未运行的内容，继承检查不得记为本轮重新执行。

## 本轮本地检查

1. 九套相关单元检查：`comparison-trend-tests.cjs`、`longitudinal-model-tests.cjs`、`longitudinal-view-tests.cjs`、`longitudinal-display-state-tests.cjs`、`longitudinal-store-model-tests.cjs`、`evaluation-v220-model-tests.cjs`、`v2244-display-preservation-tests.cjs`、`overview-background-tests.cjs`、`overview-reference-tests.cjs`。检查实际标准的来源、变换边界与缺口、标准不同时留白，以及原数值和显示保存状态保留。
2. `overview-background-browser-tests.cjs`：六组针对性行为，检查实际 SVG 区段、日期选择、缺失或不同标准、风险保留、窄屏、打印和一份不超过五页的实际 PDF。渲染并检查这份 PDF 的每一页，不重复生成全项目长报告。
3. 使用最终独立程序执行 `longitudinal-browser-tests.cjs --desktop` 的十项最小流程，不重复导出完整原生长 PDF。另执行 `comparison-trend-interaction-tests.cjs` 的三项鼠标、键盘和触屏检查，确认共用显示组件扩展后 mini 交互保持。
4. 正常关闭真实程序，通过 Explorer 验证实际安装与资料目录，完成逐文件核验的物理备份；验证旧版资料副本、候选包、原目录更新、正常保存关闭重开及普通快捷方式。严格资料写保护不放宽；新 `overviewReference` 只是显示投影，可从比较模型摘要中排除，原始记录和原评价仍完整核对。
5. 最终 HTML 重建字节一致，运行包身份和安装结果一致；正式发布使用十个公开附件的允许清单，核对 GitHub 源码、标签、Release 及附件实际大小与 SHA256，并核对在线演示。真实资料快照不进入公开附件。

## 何时扩大回归

| 最终变更或异常 | 增加检查 |
| --- | --- |
| 测量、评分、公式、代表值、方向或单位 | 对应模型完整边界；跨项目共享计算变更时全部模型 |
| 存储、迁移、导入或资料结构 | 旧资料、跨版本往返、保存失败与重开 |
| PDF 分页、导出器或通用图表机制 | 长报告、跨页表格、多日期及原生导出 |
| Electron、依赖、安全、自动更新或打包方式 | 桌面模块、安全、原生 smoke 及实际安装或更新 |
| 未解释的失败、差异超出清单或基线证据缺失 | 定位原因后扩大到受影响范围 |
| 后台 Windows CI、周期完整回归 | 独立记录全量结果，不冒充本轮本地检查，也不覆盖已知失败 |

## 可复用执行入口

`scripts/release_display.py` 保存共用门禁；`scripts/release_v2249.py` 是薄入口，版本、基线、备份路径、变更清单和针对性测试由 `scripts/release-v2249.json` 明确配置。2.24.8 及更早入口、私资料运行器和既有证据保持原字节，后续显示发布可复用共用实现，避免逐版复制整个门禁。

`prepare` 通过实际 Explorer 环境创建新备份；`bind-checkpoint` 核验全部备份字节后固定 manifest 校验值。`run units`、`run browser`、`run native` 生成本轮证据；`verify --require-candidate` 是安装前条件，`verify --require-private --record` 写入完整本地结果，`package` 仅整理已经提交且验证通过的公开文件。安装适配器固定校验共用验证器、版本入口和配置，不能在更改门禁后重用旧通过凭据。

后台 Windows CI 保留完整模型、桌面模块、浏览器、原生长 PDF 与 smoke，状态单独报告；本地精简范围不等待重复全量运行作为每次小改的固定前提。
