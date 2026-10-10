# MotionBench 2.17.0 本地验收记录

**状态：本地实现与已执行的合成数据验收通过。** 最终 37 套、528 项模型检查和 Chrome／Edge 各 12 场景通过；两份实际 PDF 共 50 页已逐页视觉复核通过，另有 6 项通用 PDF 模块自动回归通过。当前版本标记为 `2.17.0-local`，本轮仅交付可审查的本地实现。用户指定工作簿的原文件验收仍受物化阻塞影响；没有新增 Release、远端合并、部署或 Windows 应用安装。

冻结成品为 `MotionBench.html`，4,427,224 字节，SHA256 为 `6702aa6dbd30802715b3c772cb5296d17da0c838e836cd7ce979c4f68f8fa0c2`；`Ringside_Boxing_Assessment.html` 与它逐字节一致。下表的最终模型与本轮浏览器结果都记录相同的 `sourceHash`。最终本地提交由外部交付记录保存，本文不自引用其所属提交。

最终交付验证器实际 exitCode 0，重新构建后两份 HTML 的校验值保持不变。机器可读的当前验收摘要见 [acceptance-2.17.0-local.json](acceptance-2.17.0-local.json)，完整本地证据索引见 [acceptance-manifest.json](../output/acceptance-manifest.json)；旧候选证据不计入当前验收总数。

## 实现范围

本轮在 2.16.1 基线上新增独立的 `sprint_fvp` 项目及纯计算模块，不复用跳跃 FVP 的蹬伸距离、角度和最优剖面：

- 同一次完整冲刺录入累计距离、累计时间或分段耗时；支持完整试次的新增、编辑、排除、删除和撤销。采用同末段距离下最快的完整有效试次，不拼接不同试次的最快分段。
- 保存体重、身高、气温、气压、风速、计时／空间起点和明确的固定时间修正；原始计时保留。信号计时可保存负的反应时间修正，计时门条件使用适当的显式修正，不自动增加固定秒数。
- 采用 2016 分段计时模型计算 F₀、V₀、Pmax、RF max、DRF 和拟合残差，分别标明相对／绝对单位。区分 Vmax、终点速度、理论 V₀ 与峰值功率速度 Vopt。
- 使用独立的 2022 距离最优模型，在固定功率和目标距离下计算最佳冲刺剖面、不平衡性与发展方向。目标默认跟随末段，也可保存专项距离；调整目标同时更新曲线、参数和速度卡。无依据的风修正最优模型、边界解方向及偏差严重分档不作为通用标准加入。
- 冲刺 F–V／P–V 图表置于“能力结构分析”的既有弹性分析后面。原始测量、方法版本、回归窗口、目标距离、指标选择进入记录与导入导出链路。
- 能力结构采用左侧四卡、右侧分类紧凑参数表。力量支持 FVP 不平衡性、DSI、iDSI 两个窗口和 EUR；反应力量使用所选 RSI 的现有评价标准；速度支持冲刺 FVP 不平衡性与 SRR；耐力保持原逻辑，没有指标选择器。每卡只按一个选中指标判定，右侧保留全部有效参数。
- 对接录入会话、共用报告模型、Excel 模板／解析／预览、JSON／完整 JSONL、单报告可编辑 HTML、保存重开和 PDF。纯显示选择独立于原始测量，不因切换指标删除参数。

算法、单位、采样窗口、距离依赖和外推边界见 [冲刺方法说明](sprint-fvp-method.md)。桌面应用的后续接口和分阶段实施见 [Windows 方案](windows-app-plan.md)，本轮未包装 exe 或安装新运行时。

## 原仓库、隔离仓库与数据边界

原仓库位于 `D:\OneDrive\工作\言鼎\测试工作台`，开始时为 clean 分支 `codex/motionbench-2.16.1`，HEAD 为 `bdbb92cc0d6d914c6bcf5721d6eb65c2296c7d02`。本轮实际开发位于：

`C:\Users\ZekeNiu\Documents\Codex\2026-10-10\task\MotionBench`

开发分支为 `codex/motionbench-2.17-local`。本轮末次只读复核确认原目录仍为 clean、原分支和上述 2.16.1 HEAD。原仓库未 checkout、reset、fetch 或替换文件，忽略的 `output/`、`tmp/`、缓存、凭据及用户浏览器资料未复制。保存原本地分支时，Git 只读原仓库，把目标 refs 写入隔离仓库的 `refs/backup/original-heads/*`。详见 [本地基线记录](local-baseline-20261010.md)。

末次远端只读复核确认 `main` 仍为 v2.8.0（`7e1a9a5…`），`v2.16.1` 和 `codex/motionbench-2.16.1` 仍为 `bdbb92c…`；[GitHub latest Release](https://github.com/ZekeNiu/MotionBench/releases/tag/v2.16.1) 仍为 v2.16.1，发布时间为 2026-10-10 10:14:09 UTC。

所有产品验证使用合成记录与独立浏览器存储。**真实运动员 IndexedDB／localStorage 尚未读取、备份或迁移，用户数据库未因隔离测试而改变。** 真实入口升级前，仍需在原版本、原路径和原浏览器导出完整 `.motionbench.jsonl` 到用户本地并核验。

## 最终重跑与验证证据

下表区分已完成的最终成品重跑和既有中间证据。旧输出不计入最终通过项；本轮主浏览器场景和完整模型集已对冻结成品重跑，PDF 也已重新导出、渲染和实际逐页审查。

| 检查 | 当前证据 | 本轮结论 |
| --- | --- | --- |
| 原 2.16.1 全模型基线 | [baseline-unit-results.json](../output/tests/baseline-unit-results.json) | 34 套、483 项通过；用于基线比较 |
| 本轮完整模型集 | [unit-results.json](../output/tests/unit-results.json) | 最终 `npm test` exitCode 0，37 套、528 项全部通过，绑定冻结成品。中间报告兼容断言失败已修正，未沿用失败输出作为最终证明 |
| 冲刺模型专项 | [sprint-fvp-model-results.json](../output/tests/sprint-fvp-model-results.json) | 专项中间证据 exitCode 0；新增冲刺、四卡报告和 Excel 模型套件也已纳入最终 37 套重跑 |
| 独立科学数值审阅 | [可复现的独立检查脚本](../tests/sprint-fvp-independent-checks.py)、[science-review-results.json](../output/science-review-results.json)、[science-review.md](../output/science-review.md) | 冻结算法源码 112/112 项独立 SciPy／NumPy 检查通过；覆盖距离拟合、无阻力恒等式、RF／DRF、最优距离回代、固定功率与边界。JSON 记录并核对脚本和模块 SHA256，没有复用旧输出脚本覆盖新证据 |
| 采样与气压差异 | [sprint-window-comparison.json](../output/tests/sprint-window-comparison.json) | 合成数据单独对照原文窗口与公开表窗口、hPa／Torr差异；不能当作用户工作簿原文件验收 |
| Chrome 本轮交互／保存／导出 | [chrome-results.json](../output/playwright/sprint-fvp/chrome-results.json) | 最终 12 场景通过，exitCode 0；`sourceUnchanged=true`，errors／network 为空，绑定冻结成品 |
| Edge 本轮交互／保存／导出 | [msedge-results.json](../output/playwright/sprint-fvp/msedge-results.json) | 最终 12 场景通过，exitCode 0；`sourceUnchanged=true`，errors／network 为空，绑定冻结成品 |
| 旧 DSI 与评价设置回归 | [v217-legacy-browser-summary.json](../output/tests/v217-legacy-browser-summary.json) | 历史候选证据：Chrome／Edge 合计 4 套、32 项通过；未对最后报告／PDF 修复候选重新运行，不计入最终 24 项浏览器验收 |
| 既有资料升级／恢复回归 | [Chrome migration](../output/playwright/v216-migration/chrome-results.json)、[Edge migration](../output/playwright/v216-migration/msedge-results.json) | 历史候选证据：各 7 场景通过，仅合成旧记录；未对最后报告／PDF 修复候选重新运行，不计入最终 24 项浏览器验收 |
| 实际 PDF 下载与逐页渲染 | [Chrome PDF](../output/playwright/sprint-fvp/chrome-report.pdf)、[Edge PDF](../output/playwright/sprint-fvp/msedge-report.pdf) | 最终实际 PDF 各 25 页；文本／图表完整性、四卡值和判定一致性检查通过。标题随首表行及独立冲刺附录标题断言通过；共 50 页逐页视觉复核通过 |
| PDF 渲染明细 | [Chrome render-results](../output/playwright/sprint-fvp/chrome-report-rendered/render-results.json)、[Edge render-results](../output/playwright/sprint-fvp/msedge-report-rendered/render-results.json) | QA 实际复看两浏览器全部页，未发现裁切、重叠或新分页问题；两浏览器逐页 PNG 相同。根代理另目检最终第 21／25 页及 1440 四卡、390 录入截图，确认修复且截图无 toast |
| 最终视觉验收 | [visual-review.json](../output/playwright/sprint-fvp/visual-review.json) | `pass=true`、`allPagesVisuallyReviewed=true`，绑定冻结成品；记录两份 PDF 全 1–25 页、12 张 1440／390 录入／四卡／冲刺分析截图及两处问题的已解决状态，issues 为空 |
| 补充通用 PDF 模块回归 | [module-test-results.json](../output/pdf/module-test-results.json) | 最终 `npm run test:pdf` exitCode 0，6 项通过：依赖哈希、16 页样例、现用导出菜单按钮下载、390 px 的 11 页压力分页、外链失败清理、renderer 失败清理。绑定同一冻结成品；属于自动完整性检查，不计入 50 页目视总数 |
| 最终交付核验 | [acceptance-manifest.json](../output/acceptance-manifest.json)、[可提交的验收摘要](acceptance-2.17.0-local.json) | 验证器 exitCode 0；同一成品的 37 套／528 项、24 浏览器场景、50 页视觉证据一致，重建可复现，两份入口相同 |

两浏览器合计 24 场景覆盖旧 2.16.1 记录、新增冲刺累计计时录入、分段输入转换、正负修正、试次编辑／撤销、目标距离联动、四卡单指标判断、桌面和窄屏、保存重开、下载 JSON／JSONL 后恢复、实际可编辑 HTML 离线重开、Excel 模板与界面导入及 PDF。这些实际交互和自动检查已对冻结成品重跑通过；PDF 共 50 页的实际视觉审查另外完成。

浏览器运行使用隔离配置。旧回归的 Edge 沙箱启动曾在页面加载前失败，同一现有测试经批准的执行权限重跑成功；没有使用个人浏览器 profile，也没有持久修改系统安全配置。窄屏为浏览器视口模拟，不等于实体手机验收。

逐页检查发现的两处 PDF 问题是：旧第 20 页“心肺与阈值参数”标题与首表行分离；旧第 25 页冲刺原始分段表缺少“冲刺 FVP · 原始录入分段”附录标题，视觉上误接在 CMJ 后面。两处已作局部修复并重新导出：最终第 21 页标题与首行保持在一起，第 25 页含独立冲刺附录标题，自动断言与根代理目检均通过。QA 随后完成全部 50 页的最终视觉复核，没有发现新的裁切、重叠或分页问题。

补充 PDF 模块的 [样例文件](../output/pdf/module-sample.pdf)、[现用菜单按钮下载文件](../output/pdf/module-button-sample.pdf) 和 [压力分页文件](../output/pdf/module-stress.pdf) 另存于 `output/pdf/`。样例保持 128/128 行、12 图、80/80 文本完全一致；压力场景保持 130/130 行、1 图、5/5 文本一致。缺失、重复、变更的行／图均为空，浏览器错误及导出外部请求为空。旧 runner 在基线和当前版本都误点隐藏的旧 `saveModal` 按钮；本轮只修正测试导航及 `App.ready` 的 Promise 等待，保留原断言，再经实际现用菜单下载验证。上述附加样例未纳入本轮逐页视觉结论。

## 用户原生工作簿仍未完成的验收

指定文件为 `Sprint F-V Profile(多数据).xlsx`，Library ID 为 `libfile_49a70ce43be08191bd5c5fa01d90df92`。本 Windows 执行器按当前 Library 支持流程尝试物化，下载失败后只重试一次；重试在 `os.setxattr` 失败，没有得到经过可读性确认的受支持本地文件。

因此仍有明确阻塞：

- 尚未实际打开用户原始 xlsx 的两个 sheet。
- 尚未核对原生公式、Solver／缓存关系和原生图表。
- 尚未执行用户工作簿的原生 Excel 重算或与本实现逐项对照。

父线程提供的 Library 缓存文本，以及作者公开工作簿和教程，只能作为独立参考。两张缓存表分别属于分段计时与速度时间曲线案例，其单位／窗口和数值差异已在方法说明列出；本实现不把缓存异常值当作无误差标定值，也不把这些文本核对称为原文件已通过。原文算法和合成独立数值审阅可支持本地实现审查，但不能消除用户指定工作簿的公式／图表验收缺口。

## 回退的不同范围

| 回退类型 | 实际可恢复的内容 | 本轮状态 |
| --- | --- | --- |
| 代码回退 | 2.16.1 跟踪源码、Git 历史、构建输入和原入口文件 | 已有本地 rollback 标签与两份已验证 bundle；在新目录恢复，不强制 reset 原工作区 |
| 原 refs 恢复 | 原仓库本地分支、标签与远端跟踪 refs 的对象 | 原 31 refs 有机器快照；全部 11 本地分支已保存到备份命名空间并进入完整 refs 包 |
| 导入前资料库恢复 | 当前应用保留的上一代资料库 | 已有合成导入／恢复场景；不代表真实用户资料已执行恢复或备份 |
| 应用升级前数据恢复 | 迁移前完整 JSONL 或一致数据库快照 | 真实数据备份未执行。后续须先在原入口导出核验；旧 schema 不可用时恢复对应迁移前数据 |
| 单报告 HTML／JSON | 导出时当前报告的测量、评价和选择快照 | 不是完整运动员库备份，不包含所有队伍、人员、记录或长期库状态 |
| Windows 程序回退 | 可执行程序包及相容的数据版本 | 仅方案；本轮未创建桌面程序或执行本地后端迁移 |

代码备份文件位于隔离仓库父目录：`MotionBench-v2.16.1-baseline.bundle`、`MotionBench-v2.16.1-original-refs.bundle`、`MotionBench-local-baseline-20261010.json`。具体哈希、原 refs 和恢复命令见基线文档。**替换旧 HTML 只恢复代码，不是资料库数据回滚。**

## 验收范围与剩余限制

最终成品已完成完整模型集、两浏览器本轮交互／保存／导出、实际 PDF 自动完整性检查及共 50 页逐页视觉复核，另完成 6 项通用 PDF 模块自动回归。成品校验值见本文开头，最终本地提交由外部交付记录保存；代码备份与数据恢复步骤见基线文档。

用户指定工作簿尚未在本 Windows 执行器完成受支持物化，两个 sheet 的原生公式、图表和 Excel 重算没有实际验收。当前 Excel 通过项是产品模板、解析及浏览器导入往返，不等于用户附件的原生 Excel 操作。

本轮未运行实体手机、实体打印、干净 Windows 机器的桌面安装、新运行时安装或新真实 AI 内容质量验收；窄屏和 PDF 均为本机浏览器及实际下载文件检查。真实资料库备份、升级与迁移尚未执行。用户原工作簿的验收缺口仍需单独完成；本地通过结论不表示所有原文件核对要求已满足。

未进行远端推送、新 Release、合并或部署。后续 Windows 应用和发行按分阶段方案、实际验收与相应授权推进。
