# 本地代码基线、备份与回退（2026-10-10）

本轮使用独立 checkout 开发，原工作区保持原样。代码基线为 **MotionBench 2.16.1**。核实结论置信度高，依据为本机 Git 状态、完整 ref、代码文件 SHA256 和 GitHub 只读 refs／Release 检查。本文记录开始实施时的状态；本轮新功能验收由对应版本的验收记录单独给出。

## 原始工作区

| 项目 | 实际状态 |
| --- | --- |
| 原仓库 | `D:\OneDrive\工作\言鼎\测试工作台` |
| 原分支 | `codex/motionbench-2.16.1` |
| 跟踪分支 | `origin/codex/motionbench-2.16.1` |
| 原 HEAD | `bdbb92cc0d6d914c6bcf5721d6eb65c2296c7d02` |
| origin | `https://github.com/ZekeNiu/MotionBench.git` |
| 工作区 | `git --no-optional-locks status --short --branch` 仅返回分支行；无未提交或未跟踪文件 |
| worktree | 仅原目录一个；其 Git 目录为原目录下 `.git` |
| 应用版本 | `package.json` 为 `2.16.1` |
| 原入口文件 | `MotionBench.html` 与 `Ringside_Boxing_Assessment.html` 相同 |
| 两份 HTML 的 SHA256 | `a97c903c243246df6a6cb569d28a17c7bc3d35f9380bd3885d973f00d931edff` |

原始状态行：

```text
## codex/motionbench-2.16.1...origin/codex/motionbench-2.16.1
```

“干净”指 Git 跟踪文件与未忽略文件。原目录仍有被忽略的 `output/`、`tmp/`、`.playwright-cli/` 和规划文档；这些可能包含本地数据、凭据或验收缓存，未读取内容、未复制到隔离仓库。真实浏览器 IndexedDB／localStorage 也未读取。原目录未执行 checkout、reset、fetch、代码替换或数据库迁移。

仓库及其父目录未发现 `AGENTS.md` 或仓库内 `.agents/skills`。已读取本机 `C:\Users\ZekeNiu\.codex\AGENTS.md`，按其要求核实前提并区分事实、推断与未知。

## 远端版本核实

2026-10-10 的 [GitHub latest Release](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.16.1) 为 **v2.16.1**，对应 `bdbb92cc0d6d914c6bcf5721d6eb65c2296c7d02`；同名开发分支指向相同提交。原始 HTML 校验值与 Release 声明一致。

- `main` 仍为 v2.8.0：`7e1a9a5fa5a6c83cdae6d88e4879b47213a636b5`。
- v2.13.1：`0fd163ff2fd5f57bcbf7c0053c4bf9744bd3001b`，已不是最新正式版。
- 提供的 v2.16.0 参考提交 `190ea641873c839d52679b6201b73c1c231a0479` 是当前基线的父提交，并由 `rollback-v2.16.0-20261010` 保存。
- 原仓库检查时未保存本地 `v2.16.1` 标签，但其 HEAD 和跟踪分支与远端标签一致。

核实远端只使用 `git ls-remote` 与 GitHub 网页。此次没有新建 Release、远端合并、部署或推送。

## 隔离仓库和代码备份

隔离仓库：

`C:\Users\ZekeNiu\Documents\Codex\2026-10-10\task\MotionBench`

本轮开发分支为 `codex/motionbench-2.17-local`，起点为上述 2.16.1 HEAD。本地代码回退标签为 `rollback-v2.16.1-local-20261010`，指向相同提交。分支名称代表本地开发工作，不代表已发布版本。

下列文件位于隔离仓库的父目录：

| 文件 | 字节数 | SHA256 | 范围 |
| --- | ---: | --- | --- |
| `MotionBench-v2.16.1-baseline.bundle` | 11816557 | `3629d56b7b0a5c74d2e9c18faa0b1633046bf15565f09a6f408da4c69b5ab95a` | 远端 clone 基线的 25 个 refs 与完整可达历史 |
| `MotionBench-v2.16.1-original-refs.bundle` | 11839248 | `66334beaccfecd98254b03248172737de5f09e2f7edf8221b1494f7a351595a5` | 上述基线加原仓库全部 11 个本地分支，合计 36 个 refs 与完整可达历史 |
| `MotionBench-local-baseline-20261010.json` | — | — | 可机器读取的原状态、31 个原 refs、分支备份映射与备份包信息 |

两份 bundle 均已执行 `git bundle verify`，结果为有效且包含完整历史，无外部 prerequisite。这里的“完整”指所列 refs 的可达 Git 对象，未包含被忽略文件、浏览器数据库或凭据。

原仓库独有的 `codex/motionbench-2.11-local-history`（`e4d106f97152c0658e508b2a80ee635f6ad1f72b`）已进入第二份 bundle。其余原本地分支也保存在隔离仓库的 `refs/backup/original-heads/*`，与原 `refs/heads/*` 一一对应。此次 fetch 的目标为隔离仓库；源仓库仅被 Git 读取：

```powershell
git --no-optional-locks fetch --no-tags --no-write-fetch-head 'D:\OneDrive\工作\言鼎\测试工作台' 'refs/heads/*:refs/backup/original-heads/*'
```

## 在新目录恢复代码

先用完整 refs 包验证并新建恢复目录。以下命令仅在尚不存在的恢复目录创建代码副本，不修改原项目或当前开发文件：

```powershell
$baselineArchive = 'C:\Users\ZekeNiu\Documents\Codex\2026-10-10\task\MotionBench-v2.16.1-original-refs.bundle'
$recoveryDirectory = 'C:\Users\ZekeNiu\Documents\Codex\2026-10-10\task\MotionBench-v2.16.1-recovery'
if (Test-Path -LiteralPath $recoveryDirectory) { throw '恢复目录已存在，请指定新的空目录。' }
git bundle verify $baselineArchive
if ($LASTEXITCODE -ne 0) { throw '备份校验失败。' }
git clone --branch codex/motionbench-2.16.1 $baselineArchive $recoveryDirectory
if ($LASTEXITCODE -ne 0) { throw '代码恢复失败。' }
git -C $recoveryDirectory rev-parse HEAD
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $recoveryDirectory 'MotionBench.html')
```

恢复后 HEAD 和 HTML SHA256 应与本文基线相同。核对原本其他分支时，可从 bundle 的备份 ref 新建一个本地查看分支，例如：

```powershell
git -C $recoveryDirectory fetch --no-tags $baselineArchive 'refs/backup/original-heads/*:refs/backup/original-heads/*'
git -C $recoveryDirectory switch -c inspect-local-history refs/backup/original-heads/codex/motionbench-2.11-local-history
```

基线文档本身已保存原 refs；需要再次记录当前 refs 时，可在对应代码副本执行 `git for-each-ref --format='%(refname) %(objectname) %(*objectname)' refs/heads refs/remotes refs/tags refs/backup`。不会通过强制 reset 用户原目录来回退。

## 数据备份与迁移边界

**真实运动员资料尚未备份、读取或迁移。** 本轮隔离开发不打开原浏览器资料库，不产生用户数据库变更。Git bundle、代码标签和 HTML 文件只能恢复代码；替换旧 HTML 不会恢复已发生变化的数据库。

后续在真实使用入口升级或迁移到 Windows 应用前，应完成：

1. 在原版本、原路径、原浏览器的“备份与恢复”导出完整 `.motionbench.jsonl`，下载并保存到用户指定的本机位置。不要将旧版兼容 JSON 视为完整资料库备份。
2. 在用户本机核对文件可读、header 的格式／schema、末尾 end 条数、实体归属、方案关联及文件校验值，并保留原版本代码和这份迁移前数据。含真实资料的文件不进入 Git、测试夹具或远端。
3. 先在隔离资料库用合成档案验证同版本导入、升级、保存重开、导出再导入和失败回退；核对稳定 ID、全部原测量、方案、回收站与新增分析配置。实际通过情况记录到本轮验收，不由本文预先声明。
4. 原数据导入新后端时，先在暂存库验证，再以事务切换。失败保持原库和备份可用。代码回退与数据恢复分别执行；若旧代码不能理解新 schema，必须恢复迁移前的数据副本。

本轮不以读取真实 IndexedDB／localStorage 来验证迁移，也不假定不同路径、浏览器或未来桌面程序自动共享同一资料库。

## 原始 refs 快照

以下为原仓库 2026-10-10 只读复核得到的 31 个 refs。附带的 `^{}` 行是 annotated tag 的 peeled 对象，不计入 refs 数量；原 `origin/HEAD` 指向 `origin/main`。

```text
refs/heads/codex/management-center 7e1a9a5fa5a6c83cdae6d88e4879b47213a636b5
refs/heads/codex/motionbench-2.11 3e12b7499c964b5704ff8cd2c3e2b5f08675b6cd
refs/heads/codex/motionbench-2.11-local-history e4d106f97152c0658e508b2a80ee635f6ad1f72b
refs/heads/codex/motionbench-2.13 42d5c925d98b6faf64f19b8d491a724f733c8874
refs/heads/codex/motionbench-2.13.1 0fd163ff2fd5f57bcbf7c0053c4bf9744bd3001b
refs/heads/codex/motionbench-2.14 b8256ff8559807fe637b3feeb845c3d5d30119f9
refs/heads/codex/motionbench-2.16 190ea641873c839d52679b6201b73c1c231a0479
refs/heads/codex/motionbench-2.16.1 bdbb92cc0d6d914c6bcf5721d6eb65c2296c7d02
refs/heads/codex/motionbench-athlete-context 206bf47cc558e1ca4c9c7aa86c561c2e711ab41d
refs/heads/codex/workflow-report-refinement 73e7ef56f1ebe6c91db84aeeac3923a1ea8de7be
refs/heads/main 7e1a9a5fa5a6c83cdae6d88e4879b47213a636b5
refs/remotes/origin/HEAD 7e1a9a5fa5a6c83cdae6d88e4879b47213a636b5
refs/remotes/origin/codex/management-center 7e1a9a5fa5a6c83cdae6d88e4879b47213a636b5
refs/remotes/origin/codex/motionbench-2.11 3e12b7499c964b5704ff8cd2c3e2b5f08675b6cd
refs/remotes/origin/codex/motionbench-2.13 42d5c925d98b6faf64f19b8d491a724f733c8874
refs/remotes/origin/codex/motionbench-2.13.1 0fd163ff2fd5f57bcbf7c0053c4bf9744bd3001b
refs/remotes/origin/codex/motionbench-2.16.1 bdbb92cc0d6d914c6bcf5721d6eb65c2296c7d02
refs/remotes/origin/codex/workflow-report-refinement 73e7ef56f1ebe6c91db84aeeac3923a1ea8de7be
refs/remotes/origin/main 7e1a9a5fa5a6c83cdae6d88e4879b47213a636b5
refs/tags/rollback-v2.14.0-20261009 b8256ff8559807fe637b3feeb845c3d5d30119f9
refs/tags/rollback-v2.15.0-20261009 a8ad5970815a5d2d7faeaee0d0dfd01ef867afc9
refs/tags/rollback-v2.15.0-20261009^{} 206bf47cc558e1ca4c9c7aa86c561c2e711ab41d
refs/tags/rollback-v2.16.0-20261010 f77d757282e4dc12a03bda76f436fa9a6cb75390
refs/tags/rollback-v2.16.0-20261010^{} 190ea641873c839d52679b6201b73c1c231a0479
refs/tags/v2.10.0 e7224e86d77f373fb6b0fe0942d0f5d7cb6914b6
refs/tags/v2.10.0^{} 73e7ef56f1ebe6c91db84aeeac3923a1ea8de7be
refs/tags/v2.11.0 3790fa021f35e5f96bb25cb233ac02116f25cebf
refs/tags/v2.11.0^{} 3821b57cb930462a83631ad41af7fa0baa0ba2e5
refs/tags/v2.12.0 eaadb4289bfa654b92f0d6116c7f971382991768
refs/tags/v2.12.0^{} 3e12b7499c964b5704ff8cd2c3e2b5f08675b6cd
refs/tags/v2.13.0 99a328fd04d44d96b1561d61be5dbd246634fc52
refs/tags/v2.13.0^{} 42d5c925d98b6faf64f19b8d491a724f733c8874
refs/tags/v2.13.1 385b258539be9ceb3cba9625d0077a402739d795
refs/tags/v2.13.1^{} 0fd163ff2fd5f57bcbf7c0053c4bf9744bd3001b
refs/tags/v2.7.0 44e7c745ded42dba0f492aa0424735355b821a81
refs/tags/v2.7.1 37ea5dc9011a2a6d4c8378d65fca015e2576d229
refs/tags/v2.7.1^{} 56c20cb1a2e086397ffa8172d3842f809574e529
refs/tags/v2.7.2 17faed1c8dc616584c1700b35a7ce7d8d7980a91
refs/tags/v2.7.2^{} bfa9164c3110f7d1e24e65648a0a6c5f237c3ef9
refs/tags/v2.8.0 e8fcdc7f5c1d95ece003fdd94398391bbcdf431d
refs/tags/v2.8.0^{} 7e1a9a5fa5a6c83cdae6d88e4879b47213a636b5
```
