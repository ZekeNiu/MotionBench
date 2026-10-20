# MotionBench 2.24.10 定向验收与交付范围

本轮基于 `12d25348eb864988680b740efad2ef5427899ed4`（产品 2.24.8）。2.24.9 已撤下，本轮使用 2.24.10，不恢复其雷达图分档背景。

## 行为与风险

- 对照个人报告补齐纵向 FVP、弹性框架的必要条件控件。条件变化保存在比较文档，必须与纯显示选项分离；默认沿用各期原记录，原记录不得被改写。
- 个人报告与纵向报告取消完整剖面／实测范围开关，统一完整剖面。已有记录中的历史显示选择不得改变测量值或拟合结果。
- 空白解读不再显示“尚未填写”，保留“数据已更新 · 待复核”。编辑入口改为有可访问名称的图标，正文、编辑、保存、失效提示及打印行为保持可用。

允许变化的业务文件严格列在 `scripts/release-v22410.json` 的 `changedSource`。其余 `src/`、`desktop/`、`vendor/`、构建脚本、资料保护辅助文件必须与基线字节一致；依赖与打包配置只允许版本号变化。若超出范围，先扩大相应检查，不能让旧版验收自动覆盖新变化。

## 本轮运行

`python scripts/release_v22410.py units` 执行配置内十一套针对性模型／正文／存储及保护器清理检查，逐套保留退出状态、源码身份和日志。配置的浏览器证据分别为：

| 证据 | 本轮重点 | 最小检查数 |
| --- | --- | --- |
| `output/implementation-2.24.10/focused/results.json` | 个人／纵向控件、完整剖面、解读图标与空态、默认结果及交互 | 8 |
| `output/implementation-2.24.10/interaction/results.json` | 独立日期与显示、失败回滚、切换归属、保存、重开、导出 | 13 |
| `output/implementation-2.24.10/native/results.json` | 最终打包程序内合成资料的初始化、比较、正文及保存重开 | 10 |

浏览器证据必须绑定最终 HTML、实际运行器及相关源码的 SHA256；原生证据还须绑定最终 ASAR，运行前后身份一致。此处最小数量用于拒绝不完整运行，具体风险由检查内容与人工审阅核对，不能用数量代替行为覆盖。

交互套件使用 `longitudinal-controls-browser-tests.cjs --skip-pdf`，不重复完整长 PDF。最终原生基础流程使用 `longitudinal-browser-tests.cjs --desktop`，不加 `--pdf`。本轮新增界面的窄屏、打印可读性和图标可访问性由聚焦套件核对；若有实际导出 PDF，应另记录其文件身份及实际逐页查看结果，不把 DOM 打印样式检查称为 PDF 交付。

`python scripts/release_v22410.py rebuild` 对最终 HTML 再构建一次，记录字节一致性。后台 CI 可独立运行全量回归；其结果与本轮本地定向检查分别记录。

## 资料保护与安装顺序

以下命令由负责交付的主任务依次执行。本工具准备阶段不代表已经操作真实资料或完成安装。

1. `adapters`：从已固定校验值的历史模板生成本轮适配器。旧门禁、旧产物、旧 PASS 凭据保持原样。
2. `prepare`：通过 Explorer 正常关闭用户程序，复制并逐文件验证真实安装目录和真实资料目录，产生全新物理 checkpoint。
3. `bind-checkpoint`：验证全部备份字节、物理资料路径、Explorer 来源及生产者身份后，固定 manifest 的 SHA256。
4. `private baseline`、`private candidate`：分别通过 Explorer 启动旧程序／候选程序，使用 checkpoint 的两个独立资料副本。证明原始记录、正文、评价方案、日期、显示设置及未受影响的默认模型得到保留。
5. `verify --require-candidate`：同时核对本轮定向证据、最终包身份和两个副本阶段，满足条件后才允许 `install`。
6. `install`：通过 Explorer 安装；安装器再次验证 checkpoint 后真实资料没有变化、候选身份一致，并核对实际安装的程序和 ASAR。
7. `private installed`、`private reopened`：通过 Explorer 验证原安装目录的真实资料、正常保存／关闭及重开。失败时先保留恢复快照，再清理注入的保护器，不能把有保护器的窗口交给用户。
8. `shortcut`：以普通桌面快捷方式、无任何测试参数打开最终用户窗口；只读核对保存的人员／日期、真实资料目录及可见窗口。此窗口不注入测试保护器。
9. `verify --require-private --record`：生成本轮完整本地证据。检查未完成或失败的阶段不得写成通过。
10. 提交最终源码和验收说明，再执行 `package`，只整理明确允许的十个公开附件；真实资料不进入附件。推送、Release、Demo 发布及远端附件校验由主任务执行。

启动形态以实际 checkpoint 为准：个人报告保持原人员、记录和日期，不为满足验收而切换为比较报告。此时已有比较文档仅作为严格保护器的校验锚，全部未打开的比较文档仍须精确一致；比较 DOM 的断言不计作已运行。普通快捷方式按保存的实际形态核对人员与日期。窗口以隐藏方式启动时，使用正常 `window.close` 触发应用保存／退出处理，避免把没有主窗口句柄误判为不能正常关闭。

真实 checkpoint 为 `D:\Application\Strength&Conditioning\MotionBench-backups\20261020-system-before-2.24.10`。它不复用上次回退的资料快照。安装前若真实资料变化，停止当前安装流程并保护新的状态，不能覆盖新资料。

## 可复用工具边界

`scripts/release_delivery.py` 承担通用交付流程，`scripts/release_v22410.py` 只选择本轮配置。新增版本只提供实际范围、基线、证据与路径，不复制一套旧业务断言。资料保护适配器沿用原严格证明，并使用 `display-guard-lifecycle` 的失败快照及 `finally` 清理。

工具会为验证子进程设置标准 Windows PowerShell 模块路径，避免 Codex 继承环境隐藏系统自带 `Get-FileHash`；它不修改用户系统环境设置。旧失败凭据、回退点、原始资料和已发布版本附件保持可核查。
