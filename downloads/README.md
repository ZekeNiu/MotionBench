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
