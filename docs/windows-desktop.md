# MotionBench Windows 桌面版

桌面版通过 Windows 程序或快捷方式启动，自带运行环境。离线录入、计算、图表、Excel 和报告 PDF 可以直接使用。

当前桌面版本为 **2.20.0-desktop.1**，共用工作台版本为 **2.20.0**。下载入口：[Windows 桌面发行](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.20.0-desktop.1)；网页版本见 [2.20.0 发行](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.20.0)。

## 安装

发行包适用于 Windows 10 / 11，x64。

| 文件 | 用途 |
| --- | --- |
| `MotionBench-2.20.0-desktop.1-Setup-x64.exe` | 带安装向导，可选择程序目录并创建快捷方式 |
| `MotionBench-2.20.0-desktop.1-Portable-x64.exe` | 直接运行的便携程序 |
| `SHA256SUMS.txt` | 下载文件校验值 |
| `build-provenance.json` | 版本、构建提交和测试来源 |

安装版与便携版均把资料保存在当前 Windows 用户的 `%APPDATA%\MotionBench Desktop`，与程序所在目录分开。

从 **2.19.1-desktop.1** 升级时，手动运行本版 Setup，随后核对资料并重新打开。此后可使用应用内更新。

## 更新与启动偏好

1. 点击侧栏底部“应用设置”，进入“更新与版本”。帮助菜单的“检查更新”也进入这里。
2. “启动时检查更新”首次默认开启，可关闭。开启后，在资料与草稿恢复完成后检查一次；有新版本时入口显示“新版本”。
3. 点击“检查更新”可以随时手动查询。发现新版本后查看说明，点击“下载更新”。
4. 下载完成后，点击“重启并更新”。程序先完成当前保存，再启动安装并重新打开。若保存、校验或安装启动失败，按此页面提示处理后重试。

升级沿用原安装目录。关闭程序时不会自动安装下载的更新。便携版提供“下载便携版”，退出程序后替换便携程序，资料继续保留。

## 从网页版迁移资料

1. 在原网页的“备份与恢复”导出完整 JSONL 资料库。
2. 打开桌面版，在“备份与恢复”导入这个完整备份，按需要选择替换或合并。
3. 核对运动员、测试记录、队伍、方案和人工解读；关闭并重新打开，确认资料仍在。
4. 从桌面版再导出一份完整备份，作为迁移后的检查副本。

网页版和桌面版分别保存资料。交换资料时使用完整备份，并明确采用哪份资料。“本次测试 HTML / JSON”和 PDF 用于单条报告分享，完整库迁移使用 JSONL。

## AI 连接

在“AI 服务”中填写 HTTPS 地址、密钥和模型并保存。桌面版使用当前 Windows 用户加密保存密钥，重新打开后可继续使用。原网页启动器与桌面版分别保存连接；首次切换时在桌面版重新填写。

密钥与运动员备份分别保存。换电脑或换 Windows 用户后，在“AI 服务”重新配置连接。

## 备份与回退

重要测试批次完成后，在“备份与恢复”导出完整 JSONL。升级、重装和卸载保留桌面资料；主动删除 `%APPDATA%\MotionBench Desktop` 会删除这份本机资料。

返回旧程序前，先另存完整备份。程序版本回退与资料恢复分别进行；网页版回退使用原浏览器入口与相应备份。

本次修改前源码已固定为 `rollback-v2.19.1-desktop.1-before-2.20.0-20261013`。本版变化见 [2.20.0 说明](motionbench-2.20.0.md)，检查记录见 [验收记录](acceptance-2.20.0.md)。

## 开发构建

使用 Node.js 24 和 Python，运行 `npm ci`、`npm run build`、`npm test`、`npm run test:desktop-unit`、`npm run dist:windows` 和 `npm run verify:desktop-package`。Windows 产物位于 `dist-desktop`。版本及依赖锁定于 package、builder 配置和 lockfile，桌面与 HTML 使用同一份工作台成品。
