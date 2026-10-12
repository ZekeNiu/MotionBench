# MotionBench

运动表现评估与训练报告工作台，用于组织测试、录入测量、管理运动员、分析能力结构并输出教练报告。支持 Windows 桌面程序和离线单文件 HTML，两版共用计算、评价和报告界面。

**当前版本：Windows `2.21.0-desktop.1` · HTML `2.21.0`**

[在线 Demo](https://zekeniu.github.io/MotionBench/) · [下载 Windows 安装版](https://github.com/ZekeNiu/MotionBench/releases/download/v2.21.0-desktop.1/MotionBench-2.21.0-desktop.1-Setup-x64.exe) · [下载便携版](https://github.com/ZekeNiu/MotionBench/releases/download/v2.21.0-desktop.1/MotionBench-2.21.0-desktop.1-Portable-x64.exe) · [下载离线 HTML](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.21.0) · [修订说明](docs/motionbench-2.21.0.md)

2.21.0 加入12个常用测试项目、14个指标与4套大学生体测单项等级方案，并支持为通用项目选择成绩条形图、重复试次点图或实测与目标。结果表继续保留；左右独立选值、测量方法和既有记录的快照使用同一计算流程。详见 [使用说明](docs/motionbench-2.21.0.md)、[项目与标准来源](docs/preset-tests-and-standards.md) 和 [发布核验记录](https://github.com/ZekeNiu/MotionBench/blob/main/docs/publication-2.21.0.md)。

![MotionBench 在线演示，全部资料为模拟数据](assets/motionbench-demo.png)

## 选择使用方式

| 版本 | 适合场景 | 打开方式 | 资料位置 |
| --- | --- | --- | --- |
| Windows 安装版 | 日常测试与报告，推荐 | 运行 Setup，选择目录，打开快捷方式 | 当前 Windows 用户的本机资料目录 |
| Windows 便携版 | 无需安装，直接运行 | 运行 Portable exe | 与安装版共用当前 Windows 用户的本机资料目录 |
| 离线 HTML | 浏览器使用、跨平台或分享单条报告 | 下载 HTML；本机 AI 中转可使用 HTML ZIP 内的启动器 | 对应浏览器、来源及页面路径的本地资料库 |
| 在线 Demo | 快速体验完整工作台 | [直接打开](https://zekeniu.github.io/MotionBench/) | 当前浏览器的 Demo 资料库 |

在线 Demo 只包含专门生成的模拟运动员和测量，不包含真实人员资料。录入和修改保存在当前浏览器，不会成为其他访客的示例。Demo 与桌面版分别存储资料，需要交换时使用完整备份。部署方式与隐私检查见 [Demo 说明](docs/demo.md)。

## 从测试到报告

1. **建立档案**：管理运动员与队伍，记录专项、性别、生日和训练背景。
2. **设置测试**：选择一人或多人、测试日期、项目和共用评价方案；测试方案可重复使用。
3. **录入测量**：逐项填写或下载 Excel 模板，完成后导入并核对。已有测量可选择保留或替换，空白项不会清除已测数据。
4. **查看分析**：快速摘要、人体部位图、运动表现概览、能力结构和具体数据使用同一套结果；重复试次保留原始数据与统计。
5. **完成报告**：编辑解读，生成离线摘要或 AI 综合建议，导出 PDF、独立 HTML、单条 JSON 或完整 JSONL 备份。

## 主要功能

| 范围 | 支持内容 |
| --- | --- |
| 损伤风险筛查 | FMS、等长力量、双侧差异、疼痛与部位结果 |
| 跳跃与爆发力 | CMJ、SJ、DJ、10/5 Hop、CMRJ、IMTP、重复试次统计 |
| 负荷与力量速度 | 负荷－速度、SJ/CMJ 跳跃 FVP、冲刺 FVP、弹性分析和表现响应 |
| 速度与心肺 | MAS、MSS、30–15 VIFT、速度耐力、乳酸、CPET 摄氧量与阈值 |
| 评价体系 | 项目及能力目录、可复用方案、参考目标、分级区间、单位与协议匹配 |
| 人员和记录 | 队伍、搜索、批量操作、历史记录、归档、回收站和测试方案 |
| 数据与交付 | Excel 模板及导入、JSON/JSONL 备份与恢复、独立 HTML、PDF |
| 解读 | 可编辑人工正文、离线规则摘要、AI 草稿预览与应用、历史正文保留 |

最佳试次与均值可切换；至少三个有效值显示均值、样本 SD 与适用时的 CV。缺测保留为空。Hop 以整次测试结果呈现，历史逐跳资料继续保留。

评价方案更新后，关联记录使用最新标准，原始测量和人工解读保留。协议、单位和测量条件影响标准匹配，评价结果与报告共用同一计算入口。EUR 使用未舍入的 CMJ/SJ 比值：**大于 1.1 强调向心能力，小于或等于 1.1 强调利用 SSC 的能力**。

## Windows 安装与更新

适用于 Windows 10 / 11 x64。Setup 包含完整 Electron 运行环境，安装向导可选择中文、含空格及非系统盘目录。Portable 首次启动会解包运行环境。

- **从 `2.19.1-desktop.1` 升级**：在侧栏底部“应用设置”检查、下载并重启更新，或运行新版 Setup。
- **安装版更新**：沿用原安装目录。启动检查默认开启，可关闭；下载和安装均需点击，普通退出不会自动安装。
- **便携版更新**：在应用设置检查并打开便携版下载，退出程序后替换 exe。
- **资料保存**：安装版和便携版共用 `%APPDATA%\MotionBench Desktop`，与程序目录分开。升级、重装及卸载保留资料。

桌面版本后缀 `desktop.1` 标识专用发行通道。完整发行资产包含 Setup、Portable、desktop.yml、安装包 blockmap、校验值与构建来源。当前 exe 未配置数字签名，可用发行附件 `SHA256SUMS.txt` 核对下载文件。

操作详情见 [桌面版使用说明](docs/windows-desktop.md)。

## HTML、本机入口与资料迁移

下载 [2.21.0 HTML 发行](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.21.0) 中的 `MotionBench.html` 可直接打开，无需安装。需要本机 AI 中转时，解压 `MotionBench-2.21.0-HTML.zip`，Windows 运行 `Start_MotionBench.cmd`；其他系统运行 `python3 scripts/serve.py`，需要 Python 3.10+。

本机启动器默认地址为 `http://127.0.0.1:8765/MotionBench.html`。保持原文件位置、浏览器和打开地址可继续使用原资料。浏览器、地址、路径或桌面入口变化前，请先在“备份与恢复”导出完整 JSONL，再在目标入口导入并核对。单条 JSON、HTML 和 PDF 用于报告分享，完整资料库迁移使用 JSONL。

重要测试批次完成后另存完整备份。回退程序和恢复资料是两个步骤；历次发行与迁移说明保留在 [Releases](https://github.com/ZekeNiu/MotionBench/releases) 和 `docs/`。

## AI 服务

“生成离线摘要”无需联网；“生成 AI 综合建议”需要自行配置 HTTPS 服务地址、文本模型、密钥及可用额度。AI 草稿先预览，点击“应用草稿”才替换正文，保留上一版。

桌面版使用当前 Windows 用户加密保存 AI 连接；Windows HTML 启动器也提供独立的加密保存。密钥不进入运动员备份、导出 HTML 或 PDF。直接打开 HTML 或使用在线 Demo 时，密钥仅在当前页面临时使用，刷新后需重新填写；服务须支持浏览器跨域请求。

主动生成 AI 建议时，当前测试和训练背景会发送给用户配置的服务；姓名和原始生日字段不发送，自由备注请先去掉身份信息。普通录入、计算和导出不需要 AI 服务。

## 方法与使用说明

本版可按需添加12个常用测试项目、14个测量指标和4套大学生体测单项等级方案。通用项目可选择成绩条形图、重复试次点图或实测与目标，结果表继续保留。添加项目和标准的操作见[2.21.0使用说明](docs/motionbench-2.21.0.md)，协议、单位和官方分组边界见[常用测试与评价标准](docs/preset-tests-and-standards.md)。

[软件结构](docs/architecture.md) · [速度参考](docs/speed-reference.md) · [冲刺FVP方法](docs/sprint-fvp-method.md) · [历次发行](https://github.com/ZekeNiu/MotionBench/releases)

## 评价方案与项目目录

评价方案分为项目标准、能力图设置和记录预览。按能力选择一个指标或固定成员平均，设置给分方法并试算；发布前比较已发布标准与草稿对已有记录的影响。

“项目与指标库”按项目主能力组织，支持搜索具体指标、查看测量和结果规则、独立编辑项目及指标，再进入选定评价方案配置标准。能力图分数为 0–100 分；目标、等级和参考均值各自保留原有用途。

普通成绩保存独立于共享配置；跨页面恢复与资料清理受事务保护，备份过程检测版本变化，避免生成混合版本资料库。此次修复对应的原始审查记录见 [项目审查](https://github.com/ZekeNiu/MotionBench/blob/main/docs/project-review-20261012.md)。

## 开发与构建

使用 **Node.js 24.x** 与 **Python 3.10+**。Electron、打包器、更新器和浏览器测试依赖锁定于 package 与 lockfile；图表和导出库嵌入 HTML，不依赖运行时 CDN。

```powershell
npm ci
npm run build
npm test
npm run test:desktop-unit
npm run test:desktop-settings
npm run dist:windows
npm run verify:desktop-package
```

`src/` 是工作台正式源码，`desktop/` 是 Electron 主进程和预加载桥接，`scripts/build.py` 生成 `MotionBench.html`，`dist-desktop/` 存放 Windows 产物。修改正式源码后重新构建 HTML；内部 Ringside 模块名称为兼容保留。

浏览器、PDF、安装及升级验收入口按版本保留，不能用旧版结果代替新版本测试。GitHub Pages 通过单独的模拟数据构建和明确文件清单部署，不发布整个仓库。新版本正式交付需将测试和实际产物的校验值绑定。

## 许可

项目当前声明为 `UNLICENSED`，尚未指定开源许可证。第三方依赖的许可文本保留在 `vendor/`，各依赖按其许可证使用。

常用项目从“项目与指标库 → 添加常用项目”加入，参考方案也可从“评价方案 → 添加参考方案”单独选择；已有记录继续使用原方案。大学生方案按实际性别和学年选择，用正式体测成绩判断单项等级。
