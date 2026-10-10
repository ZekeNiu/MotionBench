# 2.17.3-local：保留三块完整图表

原 FVP、弹性框架及其下方的冲刺 FVP 保留完整独立区域。四张能力方向卡和右侧分类参数表使用自己的折叠区，关闭它不会隐藏三块图区。原图的双列比例、参数表、协议与曲线选项、弹性情景设置及负荷交互保持原样。

## 核查事实与修正范围

用相同的合成历史记录，经应用的公开导入流程，比较正式版 v2.16.1、已交付 2.17.2-local 与修正版。原版和 2.17.2 的有效原 FVP、弹性框架均能实际显示；原绘图函数和样式没有被四卡替换。已复现的隐藏机制是：原图与四卡共用 `trainingAnalysisDetail`，收起它会同时隐藏图表。原版也存在这项耦合，不能将此描述为本轮删除了绘图代码。

修正将原完整 FVP/弹性输出及原完整冲刺输出按原顺序移出共用折叠区，保留原框宽、边距和图表尺寸。PDF 从完整能力分析区重建，继续导出所有有效 SJ/CMJ 协议，每个协议保留 FVP 与弹性框架，冲刺图区在下方且只出现一次。

未启用项目或没有原始测量时仍沿用原显示规则；默认空记录不会生成有效图。选择没有足够测量的协议时显示原计算状态，PDF 仅纳入有效协议。不同 HTML 路径使用独立本地数据库；在新路径打开文件后，应通过应用导入原 JSONL 备份，不能认为替换 HTML 已迁移或回滚数据。本次没有读取真实运动员数据库，用户特定页面的全部隐藏原因仍未确认。

## 验证与截图

完整能力分析区的原版、已交付版、修正版桌面与窄屏截图，及修正版收起四卡后的截图，见[实际截图对照](chart-restore-comparison-2.17.3.md)。所有记录均为合成数据。精确的当前版本检查、实际 PDF 与视觉审阅范围见[验收记录](acceptance-2.17.3-local.json)。旧版本证据不替代当前版本通过结果。

本轮只修正图表的独立显示与对应 PDF 重建。原 FVP/冲刺计算、单位、数据结构、选择持久化、最佳冲刺的距离策略和 Excel 模块保持原有合同。先前存储并发问题的后续扩展已保存基线并暂停；已知问题仍见[2.17.2 说明](local-fixes-2.17.2.md)。用户参考工作簿的 Windows 原生物化与原公式/图表核查仍未完成。

## 版本与回退

修正前提交：`cd82f0868cc94a454df3c014d4b610d52f7aba4d`。本地回退标签：`rollback-v2.17.2-local-before-chart-restore-20261010`。修正前完整 bundle 的 SHA256：`e7b7595aea1a34b0400719ec9f6d46664d26fe7fbdde532a85f9a641b179586f`；它已通过 `git bundle verify`，原用户 checkout 未改动。

GitHub 修正版源码与成品在独立审查分支/标签中；旧版、main 和正式 Release 保留。下载、精确文件校验及 GitHub 回退标签见[下载说明](../downloads/README.md)。这仍是 HTML/本地服务器工作台；[Windows 应用分阶段方案](windows-app-plan.md)保留，未安装应用框架或改变系统安全配置。

从旧 bundle 在新目录恢复代码，例如在存放 bundle 的工作目录运行：

```powershell
$chartBaselineBundle = Join-Path $PWD 'MotionBench-v2.17.3-local-before-fixes-20261010.bundle'
$chartRecoveryDirectory = Join-Path $PWD 'MotionBench-v2.17.2-before-charts-recovery'
if (Test-Path -LiteralPath $chartRecoveryDirectory) { throw '请选择新的恢复目录。' }
git bundle verify $chartBaselineBundle
if ($LASTEXITCODE -ne 0) { throw 'Bundle 校验失败。' }
git clone --branch rollback-v2.17.2-local-before-storage-fixes-20261010 $chartBaselineBundle $chartRecoveryDirectory
if ($LASTEXITCODE -ne 0) { throw '恢复失败。' }
git -C $chartRecoveryDirectory rev-parse HEAD
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $chartRecoveryDirectory 'MotionBench.html')
```

预期提交为上面的 `cd82f08…`，HTML SHA256 为 `7bc7de631f464cee5c9dff2108375e8425ec34e355e943d030f5f38861c8c033`。代码恢复不能替代数据库恢复；真实资料迁移或回滚必须另外保留可恢复的数据备份。
