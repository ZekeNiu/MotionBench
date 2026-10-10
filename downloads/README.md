# MotionBench 2.17.5-local 下载与回退

- [下载预览 ZIP](https://raw.githubusercontent.com/ZekeNiu/MotionBench/review-v2.17.5-sprint-display-20261010/downloads/MotionBench-v2.17.5-local-preview.zip)，解压后运行 `Start_MotionBench.cmd`。
- [单独下载 HTML](https://raw.githubusercontent.com/ZekeNiu/MotionBench/review-v2.17.5-sprint-display-20261010/MotionBench.html)、[固定源码](https://github.com/ZekeNiu/MotionBench/tree/review-v2.17.5-sprint-display-20261010)。
- [八张实际宽窄屏截图](../docs/sprint-display-screenshots-2.17.5.md)、[功能与备份说明](../docs/sprint-display-2.17.5.md)、[实际验收](../docs/acceptance-2.17.5-local.json)。

本轮完成冲刺FVP名称、三条曲线与11项参数选择、默认关闭的近似95%拟合置信区间、自由分段和四/六段模板及累计/逐段时间转换；保留原完整三图区。用户日常 D 盘入口已备份并更新；以下 ZIP 供独立审查。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| MotionBench.html | 4462858 | `f48b2ba8a21bbc5eea74dea904951964fa30a6249d93eacdde15d6e42583d1bc` |
| MotionBench-v2.17.5-local-preview.zip | 3158921 | `275f4a76e46adbd2e7a3aab2a2f7b26909c5d52aeb30db945248bbd14b59a987` |

PowerShell：`Get-FileHash -Algorithm SHA256 -LiteralPath '文件路径'`。

实际通过45套/661项单元检查、19项独立SciPy复核、双浏览器98项主要流程/显示/图区检查，以及原日常启动入口8项检查。PDF已实际下载及渲染，人工查看范围为各验收记录列明的目标页，未声称所有页面均逐页目检。全部使用合成数据与隔离浏览器。

[代码回退标签](https://github.com/ZekeNiu/MotionBench/tree/review-rollback-v2.17.3-before-sprint-display-20261010) 指向 `7dfee7c4ac40c2ad6edde4ece5e2bffbc6c97e89`。修改前 bundle 和原 D 盘8文件备份均已实际校验。旧别名移至备份的 `retired` 目录，可按原路径恢复。程序回退不能代替资料库回滚，本轮没有读取或迁移真实运动员资料。

2.17.4存储实验独立暂停、未包含于本版本；指定Library附件的原生工作簿核验仍受物化阻塞。GitHub仅新建审查分支及标签，不合并main，不创建正式Release。交付后暂停项目。

以下保留原2.17.3交付说明及历史下载，供回退查阅。

---

# MotionBench 2.17.3-local 图表修正版下载

- [下载试用 ZIP](https://github.com/ZekeNiu/MotionBench/raw/refs/tags/review-v2.17.3-chart-restore-20261010/downloads/MotionBench-v2.17.3-local-preview.zip)：应用、版本说明、验收、Windows 计划及八张实际对照截图。
- [单独下载 HTML](https://github.com/ZekeNiu/MotionBench/raw/refs/tags/review-v2.17.3-chart-restore-20261010/MotionBench.html)，[源代码](https://github.com/ZekeNiu/MotionBench/tree/review-v2.17.3-chart-restore-20261010)。
- [直接查看三版本桌面与窄屏整区截图](../docs/chart-restore-comparison-2.17.3.md)。

原完整 FVP、弹性框架及下方的完整冲刺 FVP 保留，四卡折叠独立。图表尺寸、原控件和计算保持一致。
当前仍是离线 HTML/本地服务器应用；没有生成 Windows 安装包。main、旧版及正式 Release 保留。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| MotionBench.html | 4436737 | `5a9d9d4a742878be8e258a58a68238a77a4e5c0f26898090e34d3ed8e0e67854` |
| MotionBench-v2.17.3-local-preview.zip | 4023651 | `b32c8d6563b9242313e46294f2be90f610bedff5b145095e68fb513c8a489a39` |

PowerShell：`Get-FileHash -Algorithm SHA256 -LiteralPath '文件路径'`。

本轮实际通过 41 套/586 项单测，Chrome/Edge × 1440/390 共 38 项图区检查，双浏览器共 28 项完整冲刺保存/导入导出检查。
最终两份 PDF 的全部 50 页原始 PNG 和 12 张实际整区截图已人工查看；[验收记录](../docs/acceptance-2.17.3-local.json)绑定最终 HTML。
历史基线的折叠失败单独记录，不计入修正版通过结果；用户特定记录的全部隐藏原因尚未复现。

[修正、已知边界与数据回退说明](../docs/chart-restore-2.17.3.md)。修正前代码回退标签为
[review-rollback-v2.17.2-before-chart-restore-20261010](https://github.com/ZekeNiu/MotionBench/tree/review-rollback-v2.17.2-before-chart-restore-20261010)，
预期提交 `cd82f0868cc94a454df3c014d4b610d52f7aba4d`，HTML SHA256 `7bc7de631f464cee5c9dff2108375e8425ec34e355e943d030f5f38861c8c033`。

旧交付版仍可下载：[2.17.2 ZIP](https://github.com/ZekeNiu/MotionBench/raw/refs/tags/review-v2.17.2-local-20261010-r2/downloads/MotionBench-v2.17.2-local-preview.zip)，
[2.17.2 不可变源码](https://github.com/ZekeNiu/MotionBench/tree/review-v2.17.2-local-20261010-r2)。
旧 ZIP SHA256 为 `9a5b9ae6475d51747a992bb3dc30599095b97e3370dba43ec43994c11dd2f5d5`，未改写。

代码回退不能替代数据恢复。新路径的 HTML 使用独立本地数据库，真实资料需原应用的 JSONL 备份单独导入。
本轮只使用合成数据；存储扩展已暂停，原生用户工作簿核查仍受既有物化阻塞限制。
