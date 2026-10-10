# 本地修复轮 2.17.2-local

在隔离工作区 `codex/motionbench-2.17.2-local` 开发，起点是冻结的 `136bf21db398b1a9a83ed34a49635820bc85337e`（2.17.1-local）。回退标签为 `rollback-v2.17.1-local-before-fixes-20261010`。用户原 checkout 与真实运动员资料未参与修改或验证；旧 bundle、证据 ZIP、预览 ZIP 和交付清单保留。

## 修复范围

1. 录入会话恢复只读取一次记录建立原始存储基线。自动保存先校验当前记录，再通过既有事务内 `expectedRecords` 检查完整 JSON，拒绝并发修改、删除或待建 ID 碰撞；失败保留当前输入和会话草稿。旧分段缺失 ID 的规范化不会造成误报。
2. 普通记录保存采用独立的原始存储基线，并串行处理排队保存，避免页面内连续编辑被误判为其他页面修改。冲突后保留本地输入，可导出当前记录副本，明确重开最新记录后再保存。
3. 冲刺分段显式 ID 使用既有 `safeId` 校验，并限制同一试次内唯一。不同试次可复用 ID，旧记录缺失 ID 仍可稳定补齐。计时、距离、算法、方法元数据及测量指纹规则不变。
4. 能力发展方向使用模型中的共享纯函数，屏幕、PDF 和 AI 的所选方向事实使用相同的指标、单位及判定。保留原完整能力事实和原阈值；AI 草稿另外绑定实际选中的依据，图表显示开关不改变测量指纹。
5. 旧 PDF 测试使用当前导出菜单，等待实际初始化、切换和生成完成，明确建立空记录，并使用受控合成文字夹具。重复试次 producer/consumer 显式核对当前构建哈希，避免缺失历史生成文件或误用旧记录。

代码改动、专项测试和存储复现分开提交。实际通过的数量、构建哈希和范围以 [本轮验收记录](acceptance-2.17.2-local.json) 为准；红灯证据和最终证据存于本轮独立目录及证据 ZIP。

核心实际回归：41 套、583 项模型检查；112 项独立科学数值检查；Chrome 和 Edge 各 15 项完整冲刺流程、4 项真实双页面保存冲突检查、10 项真实 IndexedDB 导入检查。两份新 PDF 各 25 页，共 50 张原始渲染 PNG 已逐页查看，12 张最终屏幕截图也实际复查。AI 仅使用本地 transport mock；没有调用真实服务商。

## 已复现、尚未修复的存储并发

以下均在离线的合成 IndexedDB 中，用真实浏览器页面和独立 Repository 执行；本轮只建立复现与正常对照，没有改存储后端。

| 操作 | 实际缺陷 | 下一步最小修复 |
| --- | --- | --- |
| 导出完整 JSONL 时另一实例新建运动员与记录 | 不同表在不同读取事务中导出，可能得到没有所属运动员的记录；真实导入会拒绝该备份。 | 在覆盖所有相关表及元数据的一致只读事务中获取快照；事务完成后编码文件，保留分批与大数据边界。 |
| 旧实例恢复上一代资料库 | 使用过期的代指针，可能令 active 与 previous 指向同一代。 | 在写事务中核对读取时的 active/previous，并基于事务内当前值交换。 |
| 旧实例开始导入后另一实例激活新库 | 旧导入可能替换另一实例刚激活的资料库；新记录仍在底层代中，但不在当前活动库。 | 导入激活事务核对原 active/previous，冲突时停止激活并保留旧活动库。 |
| 合并读取当前代后另一实例在同代保存 | 合并激活的新代可能仍包含旧值，最新提交留在上一代。 | 明确同代写入修订合同，合并激活时事务内核对来源；旧写者的兼容须另行设计，不能仅新增客户端修订号。 |

这些复现成功不代表缺陷修复。实际使用中需完成写入再导出，避免多个窗口同时导入或恢复；后续实现应先以这些脚本验收，而非扩大后端重写。

旧重复试次测试还暴露一个既有产品边界：空资料库、没有当前记录时，目录保存后的旧配置渲染会访问空的 `state.customTests`。本轮合成 producer 明确先建立空记录，再创建目录；没有把这个目录渲染问题算为已修复。后续最小修复应让目录保存及渲染独立于当前记录，并补空库的真实 UI 回归。

## 回退与数据边界

在新目录从旧 bundle 恢复代码，不覆盖任何现有目录：

```powershell
$baselineBundle = Join-Path $PWD 'MotionBench-v2.17.1-local-20261010.bundle'
$recoveryDirectory = Join-Path $PWD 'MotionBench-v2.17.1-recovery-new'
if (Test-Path -LiteralPath $recoveryDirectory) { throw '请指定新的恢复目录。' }
git bundle verify $baselineBundle
if ($LASTEXITCODE -ne 0) { throw '备份校验失败。' }
git clone --branch v2.17.1-local-20261010 $baselineBundle $recoveryDirectory
if ($LASTEXITCODE -ne 0) { throw '代码恢复失败。' }
git -C $recoveryDirectory rev-parse HEAD
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $recoveryDirectory 'MotionBench.html')
```

旧版预期 HEAD 为 `136bf21db398b1a9a83ed34a49635820bc85337e`，HTML SHA256 为 `537d1a22d0839d76acd75b8acc6c67d8781d98f82a32ff2e5bdc8d1429cebd21`。本轮另外从新旧 bundle 各恢复到独立目录并核对提交与两个 HTML 文件。

代码回退不能恢复数据库。真实迁移前仍需完整数据备份及可恢复数据库快照；本轮没有读取、备份或迁移真实资料。用户 Sprint 工作簿的原公式、两个 sheet 图表和原生 Excel 仍待可读本地原文件验证。遵照用户新增授权，本轮源码、HTML 和试用 ZIP 通过独立 GitHub 开发分支交付，不替换 main，不发正式 Release 或部署。没有重试 Library 上传或安装 Windows 应用框架；[分阶段 Windows 应用计划](windows-app-plan.md) 延续既有接口与迁移路线。

## GitHub 下载与代码回退

本轮上传到独立 [审查分支](https://github.com/ZekeNiu/MotionBench/tree/codex/motionbench-2.17.2-review-20261010)，固定版本标签为 `review-v2.17.2-local-20261010-r2`。[试用 ZIP](https://github.com/ZekeNiu/MotionBench/raw/refs/tags/review-v2.17.2-local-20261010-r2/downloads/MotionBench-v2.17.2-local-preview.zip)包含成品 HTML、版本说明、验收记录与四张合成数据截图；源代码和测试位于同一分支。上传不改变 main，也不创建正式 Release。

回退代码时，在新目录克隆上一版标签，保留当前目录和数据：

```powershell
$recoveryDirectory = Join-Path $PWD 'MotionBench-v2.17.1-from-GitHub'
if (Test-Path -LiteralPath $recoveryDirectory) { throw '请指定全新的恢复目录。' }
git clone --branch review-rollback-v2.17.1-local-20261010 https://github.com/ZekeNiu/MotionBench.git $recoveryDirectory
if ($LASTEXITCODE -ne 0) { throw '代码恢复失败。' }
git -C $recoveryDirectory rev-parse HEAD
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $recoveryDirectory 'MotionBench.html')
```

预期提交和 HTML 哈希与上文 2.17.1 基线相同。浏览器资料库与来源和路径有关；克隆到新目录后应使用完整数据备份恢复资料，不应把旧 HTML 文件替换视作数据回滚。
