# MotionBench 2.17.2-local 下载

- [试用 ZIP](https://github.com/ZekeNiu/MotionBench/raw/refs/tags/review-v2.17.2-local-20261010/downloads/MotionBench-v2.17.2-local-preview.zip)：解压后打开 `MotionBench.html`。包含版本说明、验收记录、Windows 应用计划和四张合成数据截图。
- [单独下载 HTML](https://github.com/ZekeNiu/MotionBench/raw/refs/tags/review-v2.17.2-local-20261010/MotionBench.html)。浏览器若显示源码，请保存为 HTML 后在本地打开。
- [完整源代码](https://github.com/ZekeNiu/MotionBench/tree/review-v2.17.2-local-20261010)及[本轮修复和已知问题](../docs/local-fixes-2.17.2.md)。

这是独立开发版本，main 和正式 Release 保持原样。HTML 与本地服务器可用；当前不是 Windows 安装包。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| MotionBench.html | 4435395 | `7bc7de631f464cee5c9dff2108375e8425ec34e355e943d030f5f38861c8c033` |
| MotionBench-v2.17.2-local-preview.zip | 2304761 | `bfba63c5cde4f7dee2adac0b00dcccce52a228f2da93ad4e3cba176c47e00b38` |

可以在 PowerShell 使用 `Get-FileHash -Algorithm SHA256 -LiteralPath '文件路径'` 核对下载。

回退代码使用 [2.17.1 回退标签](https://github.com/ZekeNiu/MotionBench/tree/review-rollback-v2.17.1-local-20261010)，预期提交 `136bf21db398b1a9a83ed34a49635820bc85337e`，HTML SHA256 为 `537d1a22d0839d76acd75b8acc6c67d8781d98f82a32ff2e5bdc8d1429cebd21`。在新目录克隆和核对的具体命令见修复说明。已有正式版本和原始标签保留。

代码回退不能代替数据库恢复。升级前从原页面导出完整 JSONL 数据备份；新目录和页面来源可能对应独立资料库，应通过完整备份恢复资料。本轮只用合成数据验证，没有读取、上传或迁移真实运动员资料。

本地验收已通过 41 套/583 项模型检查、112 项独立科学数值检查、Chrome/Edge 各 15 项完整流程、各 4 项真实双页面保存冲突验证、各 10 项真实 IndexedDB 分段 ID 导入检查；两份 PDF 共 50 页实际视觉检查。测试范围与限制见 [验收记录](../docs/acceptance-2.17.2-local.json)。备份、导入、恢复的四种并发缺陷仅完成复现，尚未修复；用户参考工作簿的原公式、两个 sheet 及图表核对仍待可读本地文件。
