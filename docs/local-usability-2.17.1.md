# 本地小修复与回退（2.17.1-local）

本次在隔离 checkout 的 `codex/motionbench-2.17.1-local` 分支实施，起点是已完成验收的 `d5eaf28967aa0cdf76addbf4195e3adb4805a441`（2.17.0-local）。修改前建立 `rollback-v2.17.0-local-before-usability-20261010` 标签。原始用户仓库与真实资料库没有参与修改。

## 已复现并修复的问题

| 问题与证据 | 最小修复 | 兼容边界 |
| --- | --- | --- |
| 默认录入与 Excel 预留 5/10/20/30/40 m，填完合法的前四段仍被空白 40 m 阻止计算。真实合成 XLSX 导入无格式错误，却无法生成剖面。 | 新建试次和空白模板默认预留 5/10/20/30 m 四段。 | 不删除旧记录的第五段；可手动添加 40 m 或其他距离。测量协议与算法最小分段条件没有改变。 |
| 分段原先没有稳定身份，错误输入草稿按数组位置保存；删除前一段后，10 m 的草稿会显示在 20 m 行。 | 沿用应用现有稳定路径机制，补充分段技术 ID；旧索引草稿先转为稳定路径，再删除、撤销或恢复录入会话。 | 原计时与距离不变；已有 ID 保留，新增 ID 不参与分析指纹，旧报告不会仅因补 ID 而过期。Excel 的公开字段及 schema 不变。 |
| 存储配置把来源版本硬编码为 2.16.0，当前冲刺记录导出的 JSONL 仍误标旧应用。 | 构建时从 package.json 注入冻结的 RingsideBuild.version，备份使用当前生产版本。 | schema 3、记录 schema 2、算法 methodVersion 独立保留；独立源码环境保留已知来源版本，不把未来来源降级。旧备份仍可导入。 |

同时修正录入反馈把 10.5 m 四舍五入显示为 11 m 的问题，录入、保存值、模型与报告使用相同目标距离。以上不涉及数据库后端替换或运动学方程改写。

## 验证与证据

模型验收入口是 `npm test`，新增 `sprint-fvp-usability-model-tests.cjs`，覆盖应用实际草稿迁移、删除、撤销函数，旧记录原值与分析指纹，以及目标距离显示。Excel 和存储套件追加真实工作簿、JSONL 编解码及旧备份导入验证。

浏览器使用 `tests/sprint-fvp-browser-tests.cjs --pdf --artifact-dir output/playwright/sprint-fvp-2.17.1-local`，Edge 加 `--edge`。实际结果、页面截图和 PDF 在该独立目录，不替换上一版浏览器证据。最终通过数及 HTML 哈希以 [验收记录](acceptance-2.17.1-local.json) 为准；验证脚本拒绝引用不同成品或不同计算模块的旧结果。

其他旧 PDF 测试入口还存在隐藏按钮、初始化未等待与未声明生成夹具的问题，本次未修复或借用其历史通过结果。已经修好的 `pdf-module-tests.cjs` 与新的冲刺完整流程单独验收。用户提供的原生 Sprint 工作簿公式、两个 sheet 图表和原生 Microsoft Excel 未通过本机验证；Library 阻塞仍需用户提供可读的本地原文件路径。

## 代码回退

父目录保留 2.17.0-local 的完整 bundle 和证据 ZIP，禁止覆盖。2.17.1-local 完成后另建完整 bundle、标签和交付记录。需要回退时在新的目录克隆旧 bundle，避免重置用户原目录或覆盖未提交改动：

```powershell
$previousBundle = 'C:\Users\ZekeNiu\Documents\Codex\2026-10-10\task\MotionBench-v2.17.0-local-20261010.bundle'
$previousDirectory = 'C:\Users\ZekeNiu\Documents\Codex\2026-10-10\task\MotionBench-v2.17.0-recovery-new'
if (Test-Path -LiteralPath $previousDirectory) { throw '请指定新的恢复目录。' }
git bundle verify $previousBundle
if ($LASTEXITCODE -ne 0) { throw '备份校验失败。' }
git clone --branch v2.17.0-local-20261010 $previousBundle $previousDirectory
if ($LASTEXITCODE -ne 0) { throw '代码恢复失败。' }
git -C $previousDirectory rev-parse HEAD
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $previousDirectory 'MotionBench.html')
```

预期 HEAD 为 `d5eaf28967aa0cdf76addbf4195e3adb4805a441`，HTML SHA256 为 `6702aa6dbd30802715b3c772cb5296d17da0c838e836cd7ce979c4f68f8fa0c2`。已有 `final-restore-validation` 目录完成了该版本的实际 bundle 恢复核对。

这些文件只能恢复代码。真实数据仍须另行保留迁移前完整 JSONL 或未来数据库快照，不能把替换 HTML 当作数据恢复。本次没有迁移真实资料、安装桌面框架、推送分支、合并或发布 Release。
