# MotionBench 在线演示

[打开在线演示](https://zekeniu.github.io/MotionBench/) · [下载 Windows 版](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.20.0-desktop.1)

演示版使用与 HTML、Windows 版相同的报告、计算与录入界面。首次打开时加载一名模拟运动员和一条综合测试记录，可以编辑数据、查看原始试次、切换计算方式并导出 JSON、可编辑 HTML 和 PDF。

初始姓名、训练背景和测量值均由构建脚本从空白记录生成，未使用真实运动员资料。修改保存在当前浏览器中；演示版采用独立的资料库和草稿命名空间。更换浏览器或清除站点数据后，修改不会保留。需要长期使用时，请下载桌面版或 HTML，并定期导出资料库备份。

GitHub Pages 只托管静态演示文件。基础报告不需要账号或后台服务。在线演示可填写个人 AI 连接，服务须支持浏览器跨域请求；密钥仅在当前页面临时使用，刷新后需重新填写。演示不提供公共 AI 密钥。桌面版与 HTML 本机启动入口使用各自的个人配置。

## 可复现构建与验收

```sh
npm ci
python scripts/build.py
node scripts/build_public_demo.cjs
node tests/public-demo-browser-tests.cjs
node tests/public-demo-browser-tests.cjs --edge
```

Linux 自动验收使用 `npx playwright install --with-deps chromium` 后执行 `node tests/public-demo-browser-tests.cjs --chromium`。公开发布后，可追加 `--url https://zekeniu.github.io/MotionBench/`，验证网站实际返回的 HTML 与构建清单一致。

构建目录仅包含 `index.html`、`.nojekyll`、`demo-build.json`；发布任务只上传该目录。清单记录产品 HTML、模拟种子和网页的 SHA-256。源码、测试输出、本地资料库、草稿和 AI 配置均不进入部署包。

浏览器验收检查首次打开的资料数量、独立存储、四张能力卡、跳跃图短标签、390/1440px 布局、实际 JSON/HTML/完整 JSONL 导出、离线 HTML 重开、修改保存重载，以及后台网络请求。页面截图与验收记录保存在 `output/playwright/public-demo/`。
