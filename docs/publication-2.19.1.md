# MotionBench 2.19.1 公开发布验收

置信度：高。在线 Demo、GitHub 首页与 Windows 正式发行均已公开，并已按实际网页、下载资产和真实 Windows 更新结果核验。

| 交付 | 入口与结果 |
| --- | --- |
| 在线 Demo | [GitHub Pages](https://zekeniu.github.io/MotionBench/)，Chrome、Edge 真实网址各 8 项通过 |
| Windows 正式版 | [2.19.1-desktop.1](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.19.1-desktop.1)，公开、非预发行，设为最新发行 |
| 离线 HTML | [2.19.1](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.19.1)，原冻结成品保持一致 |
| 项目首页 | [README](https://github.com/ZekeNiu/MotionBench)，默认分支更新为当前源码，补全使用、下载、更新、迁移、AI、功能和开发说明 |
| 项目复查 | [审查记录](project-review-20261012.md)，确认两项网页多页面并发问题，列出具体修复及验收范围 |

## 公开演示与隐私

演示资料从空白结构生成，包含一名模拟运动员、一条模拟测试记录和一份模拟评价方案；未采用历史示例测量。公开部署仅有 `index.html`、`.nojekyll` 和 `demo-build.json`，采用独立浏览器资料库及草稿命名空间。

当前跟踪文件和 ZIP 文本未检出指定真实姓名；三个已跟踪预览 ZIP 的 HTML 内嵌资料为空，20 张独立截图已实际审阅，未发现真实人员标识。实际线上 JSON、HTML 和完整 JSONL 导出均只有这套模拟资料。编辑、保存、刷新重开、离线 HTML 重开以及 390/1440px 布局通过；没有后台 API、分析脚本或运动员上传请求。

发布源码提交：`5342123d33d55ffe9c84a358b8ef4267e74d846e`。实际部署 [GitHub Actions](https://github.com/ZekeNiu/MotionBench/actions/runs/38266749385) 成功；Linux Chromium 8 项、本机 Chrome/Edge 各 8 项、实际公开网址 Chrome/Edge 各 8 项通过。公开网页与清单的字节及 SHA-256 已核对，实际网页：

`13745a18887f3e6ffe61dfe2bc04dc5e86f06739acfae2298c0a5ccf3121f249`

## Windows 正式更新

保持现有版本、应用标识、安装资产和资料位置，将 GitHub 发行标为正式版本。实际公开通道仍选择 `desktop.yml`，不会选用普通 HTML 发行。原安装包和便携版的 SHA-256：

- Setup：`877d6b9a6b6fb28357c50bd450f399d8738a8c5f0b1f1ccb22bb713a2d07bb38`
- Portable：`47b19f4f82dd1dd0b977105d1f1ba2c656467b3bc1d5442239f20149ee8cdb93`

[真实在线更新验收](https://github.com/ZekeNiu/MotionBench/actions/runs/38265992351) 使用隔离 Windows CI 内的未公开 `2.19.1-desktop.0` 同代码测试安装，向正式 `2.19.1-desktop.1` 更新，实际验证：公开通道检查、下载进度、安装包 SHA-512 与 SHA-256、保存失败拒绝退出、保存重试、原目录安装、新程序自动重启、原始测量与 ID、DPAPI 密文及修订号、偏好保留。

下载的 113,615,194 字节安装包与正式资产一致；实际新版 ASAR 为 `c8dee3e645bbfc40e3229fc1510394e5c2e3cca12b7458a58806b491941caed5`，实际 HTML 与原冻结成品一致。5 个验收源码文件和 6 个原始证据文件逐项校验，两张实际更新设置截图已审阅。

补充 [在线更新证据包](https://github.com/ZekeNiu/MotionBench/releases/download/v2.19.1-desktop.1/MotionBench-2.19.1-desktop.1-Live-Update-Evidence.zip) 已随正式发行提供，SHA-256：

`dd0aaa3932494982f70487e67ea1a53594cb487f2769fa871b5a758244bd2d07`

原有目录选择、旧版升级、安装版、便携版、重装及卸载保留资料证据继续由 [冻结验收](acceptance-2.19.1.md) 绑定。当前应用未配置数字签名。

## 可复核材料

[公开发布及审查证据包](https://github.com/ZekeNiu/MotionBench/releases/download/v2.19.1-desktop.1/MotionBench-2.19.1-Publication-Evidence.zip) 包含模拟网页、构建清单、实际公网两浏览器结果、隐私检查、并发问题的合成复现、原始依赖告警和文件哈希。它不包含个人资料库或凭据。包内清单逐项记录文件哈希，发行附件提供完整 ZIP 的校验值。

已有 2.19.1 成品的 SHA-256 仍为 `6fcf29d3331c3e1a911615dd84ca6f1e2d3df0f9fa1afe54b01a77645c2567f8`；完整原验收核验再次通过。本轮新添部署、说明与验收代码，未替换生产程序二进制。
