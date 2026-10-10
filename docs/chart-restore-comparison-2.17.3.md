# 能力分析区实际截图对照

以下截图来自相同的合成历史记录、实际应用导入与浏览器渲染。原版没有新增冲刺模块；已交付版和修正版的冲刺大图区位于原 FVP、弹性框架之后。截图通过扩大采集视口保留完整区域，另有正常视口的滚动截图作为本地证据；长图在图片查看器中缩放不代表图表本身缩小。

| 版本 | 1440 px 桌面整区 | 390 px 窄屏整区 |
| --- | --- | --- |
| 原 v2.16.1 | [查看原版](../downloads/chart-restore-2.17.3/original-1440.png) | [查看原版窄屏](../downloads/chart-restore-2.17.3/original-390.png) |
| 已交付 2.17.2-local | [查看修正前](../downloads/chart-restore-2.17.3/before-1440.png) | [查看修正前窄屏](../downloads/chart-restore-2.17.3/before-390.png) |
| 修正版 2.17.3-local | [查看修正版](../downloads/chart-restore-2.17.3/fixed-1440.png) | [查看修正版窄屏](../downloads/chart-restore-2.17.3/fixed-390.png) |
| 修正版，四卡收起 | [三图区继续显示](../downloads/chart-restore-2.17.3/fixed-cards-folded-1440.png) | [窄屏三图区继续显示](../downloads/chart-restore-2.17.3/fixed-cards-folded-390.png) |

原 FVP 的协议、目标方向、曲线与范围控件，弹性框架的情景输入和快捷设置，原图右侧参数表均保留。修正没有用四张能力卡替代这三块图区。

核查没有复现有效原图在已交付版中被删除；已实际复现原版及已交付版共用折叠导致图表一同隐藏。用户特定记录的全部隐藏原因尚未确认。无测量、未启用或无有效协议仍按原规则处理，不能用空图伪装成有效结果。

实际运行范围、原始截图与 PDF 的哈希及审阅范围见[验收记录](acceptance-2.17.3-local.json)，修正与回退见[版本说明](chart-restore-2.17.3.md)。
