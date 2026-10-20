此文件记录2026-10-19的历史本地候选；正式2.24.6的源码、安装与发布验收见 [acceptance-2.24.6.md](acceptance-2.24.6.md)。

# MotionBench 纵向报告评价与变化趋势验收

日期：2026-10-19。状态：本地自动验收通过；待用户审阅。

本地候选基于 `f08f7b9007d17a2dd187accbd6d6a02f91d03c1b`，分支 `codex/motionbench-comparison-trend`。本轮未升级安装版或发布 GitHub。

最终 HTML SHA256：`e6937310f389a1929a7102c6936a13174d205880ef110e15f0eb6e06d37898ff`。

64 套 / 1019 项单元、18 项定向（其中16项已计入单元）、71 项浏览器/PDF检查通过。三份PDF共57页（完整模块51页、8日期续表5页、关节平衡1页），已完成全页自动几何/保真检查与缩略核看，并放大核看18个关键页。源代码重建与交付HTML逐字节一致。

## 最终行为

- 评价显示根据实际匹配区间、有效目标、固定筛查规则及真实疼痛／双侧差异警告决定。有测量但未分级、标准关闭或条件不匹配时保留数值，取消评价占位。真正命中的自定义灰色等级保留，原始备注和缺测原因保留。
- 各结果比较表统一为一个“变化趋势”列，展示全部所选日期。FMS、等长、IMTP、通用指标、FVP 和弹性参数共用 `RingsideResultDisplay`。
- 每张 mini 图均有纵轴刻度与单位；FMS 固定为 0–3 分，其他指标按实际数值范围显示。平值仍有可读轴域，小数、负数和极端值保留有效精度。
- 横轴按测试次序排列；同日多条记录独立显示。缺测和不兼容口径之间断线，未选入本口径的日期保留空点。空间允许时显示各日期，否则显示首末短日期；完整日期始终可查看。
- 悬停、键盘聚焦或模拟触屏点击可查看日期、数值、单位及相邻测试的变化。合法的相对百分比只用于正基线的比率尺度；FMS 显示分差，百分数指标明确显示百分点差。无可靠评价方向时线段保持中性。
- 只有各实测日期共同适用且已经统一单位的真实参考才绘制背景；有效目标在当前轴域内时可显示虚线。原始测量、评价算法、日期选择、图表配置、人工解读、总体／近期变化和 AI 事实结构保持不变。
- 报告重新渲染后，悬停与键盘提示会显示当前图点数据，不保留已移除节点的提示引用。
- 打印重建保留完整趋势投影。日期较多时结果表分组续排，每行完整趋势放在最后一组；PDF 跨页时可重复表头。

## 证据

最终结果、全部证据文件的 SHA256、源模块与测试绑定见同目录的 `acceptance-comparison-trend.json`。验收仅认可其中列出的最终候选证据。

| 范围 | 证据位置（项目根目录起） |
| --- | --- |
| 未分级／已测泄漏的原始复现 | `output/comparison-trend/reproduction.log` |
| 新功能与原计算／IMTP 比较依据对照 | `output/comparison-trend/baseline-verified.log` |
| 完整单元 | `output/tests/comparison-trend-verified/unit-results.json` |
| Chrome 交互与实际 PDF | `output/comparison-trend/verified/chrome/results.json` |
| Edge 交互 | `output/comparison-trend/verified/edge/results.json` |
| 控件保存、失败重试、刷新与导出配置 | `output/comparison-trend/verified/controls/results.json` |
| 原有布局与补充回归 | `output/comparison-trend/verified/layout/results.json`、`output/comparison-trend/verified/followup/results.json` |
| 记录切换和 AI 正文保护 | `output/comparison-trend/verified/interaction/results.json`、`output/comparison-trend/verified/ai/results.json` |
| 实际完整模块 PDF | `output/comparison-trend/verified/chrome/comparison-trend-full.pdf` |
| 8 日期含同日记录与缺测的续表 PDF | `output/comparison-trend/verified/chrome/comparison-trend-eight-dates.pdf` |
| 重绘后悬停／键盘复用 | `output/comparison-trend/verified/tooltip/results.json` |
| 实际关节平衡 PDF | `output/comparison-trend/verified/balance-pdf/results.json` |
| 当前实际界面预览 | `output/comparison-trend/preview-fms.png`、`output/comparison-trend/preview-long_generic.png` |

此前无纵轴的候选、主动取消的旧控件PDF、测试输入在运行中变化的首次单元、未先布局导致8日期夹具不可变性误报的运行、以及提示节点修复前的候选，均不作为本次最终验收通过证据。以上中间记录保留在 output/comparison-trend，最终证据统一位于 verified 及 comparison-trend-verified。

## 验证边界

使用隔离浏览器与合成记录。移动端、触屏和缩放为浏览器模拟；AI 检查使用模拟响应验证编辑及过期结果保护。未对真实用户资料、实体移动设备、实体打印机或真实 AI 服务作本轮验收。自动验收完成后仍待用户审阅，不代表用户已确认视觉方案。
