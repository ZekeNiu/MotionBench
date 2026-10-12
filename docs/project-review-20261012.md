# MotionBench 项目复查 · 2026-10-12

2026-10-13 更新：本记录保留 2.19.1 的原始审查与复现结果。下述两项并发资料问题已在 2.20.0 中加入事务内版本核验和备份一致性检查，并完成 Chrome、Edge 回归；新版完整交付证据见 [2.20.0 验收](acceptance-2.20.0.md)。

## 结论与状态

**置信度：高。** 本轮在正式 HTML `2.19.1` 上，用全新 Chrome、Edge 浏览器环境和合成资料实际复现了两项网页多页面并发问题：旧页面恢复资料库会丢失较新资料代的恢复指针；另一页面同时新增资料时，完整备份可能包含没有所属运动员的记录，导致该备份不能导入。

这两项**尚未修复**，列为下一次补丁的优先任务。Windows 常规运行只有一个应用实例和主窗口；本轮复现需要同一浏览器、相同页面地址的两个页面共享一个 IndexedDB 资料库。单窗口正常操作的保存与备份经过同一 Repository 队列，未在此次复现中出现上述跨页面交错。

本轮检查没有替换已冻结验收的 `2.19.1` HTML 或 Windows 二进制。正式发行的已有验收范围见 [2.19.1 验收](acceptance-2.19.1.md)；这些新增复现不属于“全部历史缺陷均已修复”的证明。

| 项目 | 本轮核验结果 | 后续处理 |
| --- | --- | --- |
| 网页旧页面恢复资料库 | Chrome、Edge 均复现，尚未修复 | 下一次补丁增加事务内版本校验 |
| 网页并发完整备份 | Chrome、Edge 均复现，尚未修复 | 下一次补丁校验备份前后的资料版本 |
| 运行依赖告警 | `npm audit --omit=dev` 返回 0 个已知告警 | 保持锁定依赖并持续核验 |
| 构建依赖告警 | 一个 `sprintf-js` 拒绝服务公告沿依赖链产生 8 个中等告警条目 | 单独验证构建依赖调整 |
| 已跟踪预览 ZIP 与图片 | 三个 ZIP 内 HTML 数据为空；20 张独立图像未发现真实人员标识 | 保留合成演示资料，公开部署使用独立文件清单 |
| README 开发环境 | 已修正为 Node.js 24.x，与 package 一致 | 随本轮主页更新发布 |
| GitHub 默认主页 | 已从旧 2.8.0 更新为当前 2.19.1 源码，设置在线演示网址 | 已发布；首页补全功能、下载、安装、更新、存储、迁移、AI 和开发说明 |
| 软件授权 | `package.json` 为 `UNLICENSED` | 首页如实说明，具体开源许可证由项目所有者决定 |
| Windows 数字签名 | 当前构建出处明确记录 `signed:false` | 如需改善系统信任提示，后续配置发布证书 |

## 1. 旧页面恢复资料库后，较新资料失去恢复入口

**优先级：P1；置信度：高；状态：已复现、未修复。**

触发过程：

1. 页面 A、B 打开同一个页面地址。A 的 Repository 停留在资料代 G1。
2. B 导入另一份完整资料库，切换为 `active=G2`、`previous=G1`。
3. A 执行“恢复上次资料库”。实际结果变成 `active=G1`、`previous=G1`。

G2 的完整记录仍在 IndexedDB 中，实测记录哈希保持不变；但界面当前资料和“恢复上次资料库”均指向 G1，无法通过这个入口切回 G2。影响是较新资料从正常入口消失，不能把它表述为记录已被物理删除。

原因在 [Repository.restorePrevious](../src/ringside-store.js#L368)：读取 `previous` 后直接写入 `active`，并把调用实例的旧 `generation` 写成 `previous`；写入事务没有核对实际 `active`、`previous` 和资料修订号。产品入口 [App.restorePreviousLibrary](../src/ringside-app.js#L4741) 直接调用此方法；[恢复按钮](../src/ringside-management.js#L477) 只增加用户确认。

最小修复方向：

- 在 Repository 操作队列内处理恢复；在同一个 IndexedDB 写事务中读取实际 active、previous、revision 和目标资料配置，核对调用实例仍对应当前资料代。旧页面必须拒绝恢复并要求重新载入。
- 用事务中核验过的实际 active 写入 previous；目标不存在、目标与当前相同或校验失败时不改变任一指针。
- 产品入口先完成当前保存和未完成操作检查，再切换内存目录。升级前资料的特殊恢复路径也使用相同的版本依据，保留既有升级检查点。

补丁验收至少覆盖：正常 G2→G1→G2 往返；旧页面操作被拒绝且 G2/指针完全不变；恢复事务期间另一页面导入或保存；当前保存失败；旧资料升级检查点恢复；退出、刷新重开和 JSONL 往返。

Windows [单实例锁](../desktop/main.cjs#L195) 会将第二次启动交给已有主窗口。本轮两页面复现不能直接等同于常规 Windows 单窗口中的实际事故。

## 2. 另一页面新增人员时，完整备份可能不一致

**优先级：P1；置信度：高；状态：已复现、未修复。**

触发过程：

1. A 开始导出完整 JSONL，已经读完运动员条目，尚未读取测试记录。
2. B 在相同资料库中提交一名新运动员及其测试记录。
3. A 继续读取记录，得到旧的 1 名运动员和新的 2 条记录。

实测导出尾计数为 `athlete=1`、`record=2`；`record-during-backup` 关联的 `athlete-during-backup` 缺失。将这份导出交给产品原有 JSONL 导入器，得到“测试的运动员或评价方案不存在”，整批导入被拒绝，未产生部分导入。

原因在 [Repository.rows](../src/ringside-store.js#L192) 和 [createBackupBlob](../src/ringside-store.js#L201)：不同表、不同批次分别读取，导出完成前没有核对统一资料版本。[backupBlob](../src/ringside-store.js#L200) 的队列可以串行化当前 Repository 的操作，其他页面有各自的队列，因此仍可在两次读取之间提交。产品 [完整备份入口](../src/ringside-app.js#L4427) 使用此方法。

最小修复方向：在导出前记录 active/generation/revision，构建候选备份后再次核对；任一变化就丢弃候选并给出具体重试信息，不能继续下载并提示“完整备份已导出”。这能保留分批读取，避免为解决一致性而把整库一次装入内存。升级备份、旧格式导出等共用完整资料读取入口需要一起检查。若采用版本稳定的快照机制，也应验证容量和跨页面行为。

补丁验收至少覆盖：读取人员后并发新增人员和记录；读取方案后并发修改或新增方案；记录分批期间修改和删除；导出期间切换资料代；无并发时旧 JSONL 导入、导出再导入内容一致；大资料库容量与实际下载提示。失败的候选备份不得生成可下载文件。

同一窗口通过现有 Repository 队列进行普通保存时，写入会等待备份操作结束。本轮证据证明的是跨页面交错，未证明单窗口静止资料库导出的备份有误。

## 3. 构建依赖中的格式化漏洞

**优先级：P2；置信度：高；状态：告警已核验，未调整依赖。**

当前完整依赖核验发现 [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)：`sprintf-js <=1.1.3` 接收攻击者控制的过大精度格式串时可能抛出异常，造成调用操作中止。公告在本次检查时没有列出修复版本。

实际依赖链为 `electron-builder 26.15.3 → app-builder-lib → @electron/get 3.1.0 → global-agent → roarr → sprintf-js 1.1.3`。npm 展示的 8 个中等条目是这一个公告沿依赖链的影响，不能称为 8 个独立漏洞。

`npm audit --omit=dev` 返回 0 个已知告警。实际桌面 ASAR 文件清单中没有 `sprintf-js`、`roarr`、`global-agent` 或 `electron-builder`。当前证据支持构建环境依赖告警，不支持“已发布桌面工作台因此存在同样的运行时漏洞”。

后续应先验证是否存在兼容且能移除该依赖链的构建依赖方案，再重新执行打包、安装、目录选择、升级、更新与资料保留验收。当前 npm 给出的自动调整涉及更改已锁定的 builder 版本，不能在冻结发行中直接执行自动修复。

## 4. 已公开文件与演示资料

当前源码、生成 HTML、测试和文档文本，以及检查时的旧 main 文本，未检出指定的真实姓名。三个已跟踪预览 ZIP 已逐成员检查文本和 Unicode 转义，内部各 HTML 的 `embedded-data` 均为 `null`，没有携带导出资料库。

实际查看了 `downloads/chart-restore-2.17.3/` 的 8 张图片、`downloads/sprint-display-2.17.5/` 的 8 张图片，以及 2.17.2 ZIP 内另有的 4 张截图。内容均为能力分析和冲刺图区；含人员栏的图片显示 `Synthetic three-region new entry`，未发现真实人员标识。ZIP 中重复收录的图片与已跟踪图片属于相同图像。

本轮 [公开 demo 构建脚本](../scripts/build_public_demo.cjs) 从 `M.defaults()` 空白结构生成新的模拟测量、人员和训练背景；没有调用旧示例记录或读取保存的运动员记录。演示资料使用单独的浏览器存储命名空间，发布目录限定为 `index.html`、`.nojekyll` 和 `demo-build.json`。

公开 demo 已通过 [GitHub Pages 发布任务](https://github.com/ZekeNiu/MotionBench/actions/runs/38266749385) 部署；网页 SHA-256 为 `13745a18887f3e6ffe61dfe2bc04dc5e86f06739acfae2298c0a5ccf3121f249`。公开部署不包含整个工作区、个人资料库、桌面配置或验收输出目录。此次检查针对上述当前文件，没有执行 Git 历史重写，也没有读取个人 AppData、实际运动员数据库或 AI 凭据。

## 复现与证据

复现使用正式 HTML SHA-256：

`6fcf29d3331c3e1a911615dd84ca6f1e2d3df0f9fa1afe54b01a77645c2567f8`

本轮本地证据目录为 `output/project-audit-20261012/`：

- `chrome-storage-audit.json`、`msedge-storage-audit.json`：两项问题的资料代、记录哈希、前后指针、导入结果；均记录源码未改变、没有页面错误、没有网络请求。
- `chrome-inconsistent-synthetic-backup.jsonl`、`msedge-inconsistent-synthetic-backup.jsonl`：实际生成且被产品导入器拒绝的合成备份。
- `npm-audit-production.json`、`npm-audit-all.json`：本轮依赖核验原始结果。
- `tracked-preview-privacy.json`、`image-privacy-review.json`：三个 ZIP 的内嵌数据状态及 20 张独立图像的文件哈希、尺寸和审阅结果。

确定性复现脚本为 `output/project-audit-storage.cjs`，使用项目已有的合成资料生成方法和真正的 Chromium IndexedDB，不替换产品存储模块。先在人员与记录读取之间设置测试屏障，再由另一页面完成真实写事务，从而稳定触发并发条件。旧的 [存储诊断脚本](../tests/storage-concurrency-repros.cjs) 保留了相同问题的历史复现，但本轮结论来自上述 2.19.1 新证据。
