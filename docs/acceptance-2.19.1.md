# MotionBench 2.19.1 验收记录

置信度：高（本机与真实 Windows CI 检查均通过）。Windows CI 已验证实际目录选择页面、中文空格安装路径、2.19.0-desktop.1 → 2.19.1-desktop.1 升级后原始资料与加密 AI 设置保留、安装版、便携启动与卸载保留资料。

HTML 版本 **2.19.1**；Windows 版本 **2.19.1-desktop.1**。成品 SHA256：

`6fcf29d3331c3e1a911615dd84ca6f1e2d3df0f9fa1afe54b01a77645c2567f8`

| 检查 | 结果 |
|---|---:|
| 模型与数据合同 | 52 组，773 项通过 |
| Chrome / Edge 设置、报告与兼容流程 | 100 项通过 |
| PDF | 4 份、48 页；Chrome 24 页直接目视，Edge 24 页逐页像素相同；另有等长重复测量 PDF 8 页全部直接目视 |
| 桌面更新单元 | 23 项通过 |
| 正式封装程序的本机录入、保存重开、导出及更新设置 | 21 项通过 |
| Windows CI | 目录页、旧版升级、安装版 16 项、便携 3 项与卸载保留资料通过 |

EUR 按未舍入数值判断：大于 1.1 强调向心能力，小于或等于 1.1 强调利用 SSC 的能力。CMJ–SJ 增益沿用同一方向；概览、能力参数与 AI 输入保持一致。原测量、fDSI、iDSI、RQR、SRR、FVP 与弹性计算保持原值，独立旧基线已核对。

兼容检查使用独立合成资料库，覆盖单人／多人录入、历史 Hop 逐跳保留、任意 IMTP 时点、XLSX 保存导入、刷新恢复、重复导入、保存失败重试、并发写保护、JSONL 升级备份及回退。旧 schema2 文件由固定 v2.16.1 原导出器和原 ExcelJS 独立生成；新版 schema3 的实际界面下载同时保留。

旧版升级使用固定原始基线 ZIP：[2.19.0-desktop.1 基线](https://github.com/ZekeNiu/MotionBench/releases/download/rollback-v2.19.0-desktop.1-before-2.19.1-20261012/MotionBench-2.19.0-desktop.1-baseline.zip)，共 226,308,505 字节，SHA256 为 `3a73ba9539ad88c0427695e3a0916738a674e60b6e8fb44cb98488ca1ae0d54d`。地址、大小、校验值与原基线提交绑定；CI 升级过程先核验完整 ZIP，再运行旧版保存及新版恢复检查。

本次检查使用独立合成资料库。窄屏为浏览器窗口模拟；AI 检查覆盖输入与过期草稿保护，真实供应商正文质量、物理手机和纸张打印未纳入本次验收。更新单元使用合成服务响应，跨版本安装结果由 CI 旧版升级证据核验。

完整文件依赖和哈希见 [JSON 清单](acceptance-2.19.1.json)。证据包须保留清单中的相对路径。默认核验入口为 `python scripts/verify_delivery.py`；最终 CI 核验使用 `python scripts/verify_v2191.py --require-ci`。只有显式 `--freeze` / `--record` 才更新本文件和 JSON，失败不会改写已有测试证据。
