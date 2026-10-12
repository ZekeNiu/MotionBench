# MotionBench 2.20.0 公开发布与补验记录

置信度：高。2.20.0 的公开下载、模拟演示、合成资料 CI 与真实在线更新已有可复核证据；**本机最终交付验收尚未完成**。后续在原资料上的 PDF 补验触发了超页保护，未生成 PDF。该遗漏由独立的 2.20.1 修订处理，已发布的 2.20.0 程序、安装资产及历史验收不覆盖替换。

本记录区分 2026-10-13 已完成的公开发布验证与随后发现的问题。2.20.1 的修复结果须由新的合成复现、PDF 和本机验收确认，不能从 2.20.0 的通过结果推定。

## 已公开的交付

| 交付 | 入口与结果 |
| --- | --- |
| 在线 Demo | [GitHub Pages](https://zekeniu.github.io/MotionBench/)，本次部署时版本为 2.20.0，实际公开网址 Chrome、Edge 各 8 项通过 |
| Windows | [2.20.0-desktop.1 正式发行](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.20.0-desktop.1)，公开、非预发行，提供 Setup、Portable、更新元数据、校验值、构建来源与验收附件 |
| 离线 HTML | [2.20.0 发行](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.20.0)，提供单文件 HTML、HTML ZIP 与原验收记录 |
| 项目首页 | [发布时源码](https://github.com/ZekeNiu/MotionBench/tree/ecfd89ad84c584be919000bbdd6d78ccf0f524fd)，发布提交为 `ecfd89ad84c584be919000bbdd6d78ccf0f524fd` |

公开资产的大小和 SHA-256 如下；Windows 保留下载文件的字节与公开摘要一致。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| MotionBench.html | 4696847 | `9fdac139dcad46a4f533877296f9000abdf9a91ec2d68fae1164453f9d19beae` |
| MotionBench-2.20.0-HTML.zip | 2106650 | `e4569b93f966683888920cd6921df9d75d4f136e2188da1842766fd84c998440` |
| MotionBench-2.20.0-desktop.1-Setup-x64.exe | 113625774 | `08e2107de7865f656b8c24e36d9eb9d37e3631f9e342a7e1a42b123984d6b566` |
| MotionBench-2.20.0-desktop.1-Portable-x64.exe | 113389380 | `f1d232bbdc3c43bfbc6b9339ea930bd36657b7d92e575d488d8f9494cbe77376` |
| desktop.yml | 392 | `7b15cfbd3b665a78c4fec6f159a73cbf9d26a97e33afd1028d70bf8b7deb957a` |

资产摘要可由 [HTML 发行资产](https://api.github.com/repos/ZekeNiu/MotionBench/releases/tags/v2.20.0) 与 [Windows 发行资产](https://api.github.com/repos/ZekeNiu/MotionBench/releases/tags/v2.20.0-desktop.1) 复核。当前 Windows 程序未配置数字签名。

## 模拟演示与隐私

演示种子从空白结构构建，包含一名模拟运动员、一条综合测试记录和生成的评价方案。公开部署只包含 `index.html`、`.nojekyll` 与 `demo-build.json`，六类资料库、草稿及偏好命名空间与普通应用隔离。源码目录、测试输出、个人资料库及 AI 配置不进入部署目录。

[Pages 部署 CI](https://github.com/ZekeNiu/MotionBench/actions/runs/38288732104) 成功。独立本地服务器与实际公开网址分别完成 Chrome、Edge 各 8 项检查，计 32 项：首次打开的资料数量、独立存储、四张能力卡及五个跳跃短标签、390/1440px 布局、JSON 与可编辑 HTML 导出、完整 JSONL 备份、离线 HTML 重开、录入后保存重载和后台网络请求均通过。实际导出只有模拟资料；普通体验未观察到后台 API、跟踪脚本或运动员上传请求。

实际公开 HTML 和构建清单与审核文件逐字节一致：

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| index.html | 5132221 | `a628321c197f61c5afb2d6a215d342a94585e88a43699bbad085dcfad8fd9c3d` |
| demo-build.json | 631 | `8c7df27485e4c7f51d9a9bc9a7761a2a60d79e8168f7989bf5d722e270ee1ae2` |

两浏览器的截图与导出在下一次运行前分别复制并回读校验，避免共用输出文件被覆盖。实际截图已目检，模拟数据提示、控件及报告内容可读，未发现横向溢出。

这组公开演示检查实际导出的是 JSON、HTML 与 JSONL，**不包含 PDF 导出验收**。AI 仅在主动操作并填写个人连接后调用用户配置的服务；在线演示没有公共密钥，密钥仅在当前页面临时使用。

## Windows CI 与在线更新

[Windows 构建与安装 CI](https://github.com/ZekeNiu/MotionBench/actions/runs/38286219689) 对应提交 `4e04c9b078c377c66ae06aafa3701cac2f5c7993`，其共用 HTML 与以上 2.20.0 成品一致。真实目录选择、固定 2.19.1-desktop.1 安装包到 2.20.0-desktop.1 的升级、安装版 16 项、便携版 3 项、原生管理 12 项、卸载保留合成资料及更新资产核验通过。完整原始范围和文件绑定保留在 [历史验收](acceptance-2.20.0.md) 与 [JSON 清单](acceptance-2.20.0.json)。

[真实在线更新 CI](https://github.com/ZekeNiu/MotionBench/actions/runs/38289364033) 从未公开、同代码的 `2.20.0-desktop.0` 测试安装向公开 `2.20.0-desktop.1` 更新，实际验证 `desktop.yml` 通道、下载、公开安装包 SHA-512 与 SHA-256、保存失败拒绝安装、保存重试、原目录安装、新程序自动重启以及合成资料、人工正文、DPAPI 密文与修订号、偏好的保留。此流程与固定 2.19.1 安装包的跨版本升级是两项分别记录的检查。

在线更新实际下载的 Setup 为 113625774 字节，SHA-256 与上表一致。重启后的程序及其 HTML 通过对应证据核验；两张更新设置截图已审阅。以上 CI 使用隔离 Windows 用户与合成资料。

## 本机补验发现的 PDF 问题

原目录的 2.20.0 安装成功，版本与资料对照通过，未发现资料改变；但在本机原资料上导出 PDF 时，能力雷达图和三张评分明细表合为一个过高的卡片，触发单页保护而中止。该次诊断记录的整块卡片高度约为 1354.85px，PDF 正文容量为 960px。由于导出失败，没有生成 PDF，也没有可引用的结果页号。

这项发现属于本机实际资料补验，诊断材料保留在私有备份内，本公开记录不包含人员姓名、测量、记录编号或私有文件链接。原历史 PDF 检查是 4 份、26 页的合成样例及渲染对照，未覆盖本次多轴与表格高度组合；不能据此声称本机最终验收已经完成。

后续 2.20.1 已实现过高卡片的分页修订，追加多轴、评分明细和长表的合成复现，按新成品完成 PDF、桌面和演示核验；公开发布与本机原资料的最终 PDF 复验仍待完成。具体通过范围以新的合成及本机证据为准，进度见 [2.20.1 修订说明](motionbench-2.20.1.md)。历史 2.20.0 的程序、发行附件和验收文件保持不变。

## 可复核证据包

| 范围 | 文件与 SHA-256 |
| --- | --- |
| 原合成测试、程序与 Windows CI | [MotionBench-2.20.0-evidence.zip](https://github.com/ZekeNiu/MotionBench/releases/download/v2.20.0-desktop.1/MotionBench-2.20.0-evidence.zip)，`67271eff70e1c9325713b5505fd4fb05116b3fe3ba445094eb680dea3e0f3f0f` |
| 公开模拟演示、实际网址及独立复制证明 | [MotionBench-2.20.0-Publication-Evidence.zip](https://github.com/ZekeNiu/MotionBench/releases/download/v2.20.0-desktop.1/MotionBench-2.20.0-Publication-Evidence.zip)，`d8c05e24108f4a08b68cd8bd726f10c66d7397241ed59177174e465f0abd78d0` |
| 实际公开通道的下载、安装与自动重启 | [MotionBench-2.20.0-desktop.1-Live-Update-Evidence.zip](https://github.com/ZekeNiu/MotionBench/releases/download/v2.20.0-desktop.1/MotionBench-2.20.0-desktop.1-Live-Update-Evidence.zip)，`d4ef0b9162d519fad4216ff502fe38d24368dde77b171506cda88baf39ddb73f` |

公开演示证据包含 51 个明确列出的成员，ZIP 逐成员回读校验通过；在线更新包含 12 个成员，源码与原始结果的哈希已逐项核对。发行附件提供各证据包的独立校验收据。这些材料不包含真实个人资料或可用的个人服务密钥；本机实际 PDF 诊断不在公开包内。
