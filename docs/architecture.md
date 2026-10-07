# MotionBench 核心结构与扩展

项目保留浏览器原生 HTML／CSS／JavaScript 和离线单文件交付。维护正式 `src/`，通过 `scripts/build.py` 构建；生成文件不作为第二套源码维护。

## 数据到报告

`RingsideTests.describe()` 统一返回项目 ID、名称、分类、主能力、能力标签、指标定义、展示类型及数据形状／字段合同。新建选择和未采用的计划项目读取目录描述，已有测试读取记录快照。`groups()` 使用相同顺序与主能力规则。报告将 MAS／MSS／IFT 的展示集中到“速度与储备”，但不修改各测试的录入归属和能力统计。

`RingsideModel.stats()` 负责计算。`RingsideReport.build()` 深复制记录，生成一次统计结果和按项目归属的指标结果；摘要、普通结果、专用图表和 AI 结果列表消费这份报告模型。力量耐力仅在报告渲染和摘要中将红／黄／绿显示为重点关注／关注／正常；报告数据中的原始评价标签保持不变，因此 AI 仍使用原参考分级。等长归一化均值、跳跃同次汇总和 RFD 有效次数由模型统一计算，展示不另造分数。PDF 获取同次渲染的报告副本与记录快照，不再独立计算成绩。异步导出期间切换记录不会改变待导出的内容。

应用主模块管理页面状态、输入、异步保存、导入导出和导航。管理列表与评价方案草稿位于 `ringside-management.js`；报告模板在 `ringside-report.js`，AI 与参考资料设置位于 `ringside-settings.js`。报告选择与管理列表上下文独立，只有查看报告或进入具体录入时才加载对应完整记录。

`ringside-evaluation.js` 是共用评价解析入口：原始记录与关联方案合成只读的生效记录，网页、能力汇总、离线摘要、AI 事实和 PDF 均使用该入口。单位、协议、总力／净力和速度口径保留在测量结构；不匹配的标准停止评价，实测结果继续显示。评价方案改名不改变分析指纹；实际生效依据变化后保留原解读并标记待复核。

## 速度参考与运动员类型

`report.speedReference` 是当前报告的派生结果，集中保存在 `ringside-report.js`，包含有效实测指标、ASR／SRR、运动员类型、五种形式的强度与时长、个人速度、做功休息配对及来源。网页和 PDF 共用同一结果；该对象不写入记录，不进入既有 AI 事实接口。原始 ID、schema、评分与 `stats/projects` 保持原样。

SRR 为 MSS／MAS，按未舍入值使用已选文献参考分组：小于1.70为耐力型，1.70至1.80为混合型，大于1.80为速度型。论文未分配恰好等于两个分界的值，软件统一归入中间组；具体来源与采用方式见 `speed-reference.md`。分组不读取目标、评价标准或其他运动员。MSS＜MAS 时隐藏 ASR／SRR 和类型，保留实测值、核对提示及仍可计算的训练参考。VIFT 不参与 ASR。用户后续要求已取代最初的目标达成比例和差值方案。

参数模型保留 vVO₂max、VIncTest 与 VIFT 的原文基准；界面直接标明个人数值使用的 MAS／折返 VIFT 百分比，避免重复展示。MAS 数值是算术参考，不据此认定测试协议等价。仅折返版 VIFT 使用 VIFT 参考范围，未完成级秒数不进入换算。五种训练形式与六类生理目标分开建模；界面用中文列出各形式的刺激组合，第⑥类不增加训练表行。RST 采用已确认的④⑤。RST／SIT 展示全力冲刺及实测 MSS，不把 MSS 当作整段速度下限。做功休息比由成对秒数约分，来源集中存储；表下不显示图例、来源脚注或80% MAS。

速度图在 MAS 柱尾绘制 ASR 延伸段，短段文字上移；窄屏字号所需的留白和标签宽度一并预留。上方图与测试信息／速度比表仍用现有 `data-pdf-pair`，下方七列训练表独立分页。训练表本身携带 `speed-reference-table` 样式，避免续页失去外层容器后变成卡片；PDF 强制保留表格及表头。

## 测试扩展

- 数值测试通过项目库建立，一个项目可添加多个数值指标。是否手动录入由已注册计算指标 ID 判断，不依赖 `metric_` 前缀。
- 专用结构在 `ringside-tests.js` 注册展示类型；现有 FMS、等长、跳跃、药球、IMTP、乳酸、速度关系和 LVP 使用专用展示。
- 未注册的测试统一使用多指标结果表，图表不按用户自定义名称猜测。新增普通项目不会要求新增专用图表。
- 指标按 `testId` 归属。普通项目只生成一个区块，附加指标进入所属内置项目；CMJ／SJ 同组对比、MAS／MSS／IFT 共用速度图和精简结果表并使用稳定的项目锚点，LVP 保留上／下肢集中对比区。
- 分组使用 `Map`，能力配置键用 `ability:` 前缀；用户标签不会成为普通对象的原型属性。页面分组 ID 来自字符编码，项目区块 ID 来自稳定测试 ID。
- 自定义项目默认使用 `entryScope: attempt`，也可保留记录级数值指标。CMJ／SJ／IMTP／速度及俯卧撑的扩展数值指标支持试次作用域；其他专用分组测试保留各自适配器。等长结果表最后一列承载关节平衡：优先放在已测分子方向，分子未测时放在已测分母方向；每个可计算配对只出现一次，缺失结果显示普通短横线，单侧有效时保留有效侧；疼痛不被缺测覆盖。无表格跨行合并，PDF 续页保持完整行。目标放在实测值下方。专用展示逐块捕获失败，补回未消费指标和原始试次；LVP 与未知展示类型也受保护。

## 重复测量

测试描述的 `repeatPolicy` 提供策略、分组和主指标。`repeatRows()` 将旧单次字段视为一次观测；出现 `trials` 数组后，该数组是唯一测量来源，即使为空也不回退旧值。CMJ、SJ、IMTP、药球、LVP 保留既有数组；等长方向行与俯卧撑、MAS、MSS、IFT 使用可选嵌套数组；自定义试次按项目保存数组。记录级自定义值继续保存在 `customValues`。

`repeatAnalysis()` 同时产出分组内原始观测、选中试次、代表值和描述统计；`stats()` 保留既有结果接口，并增加 `repetitions` 与只读的 `representativeData`。标量和等长的旧计算路径使用代表值投影，不改写原始数据。主指标缺测的动作保留在原始表，不作为完整试次参与汇总；完整试次内，各指标独立排除缺测并记录有效次数。LVP 先按同负荷生成一个代表速度再回归，不以重复次数加权。IMTP 先按每次动作及时间点换算，再计算对应力与 RFD 的统计。

`Calc.descriptive()` 使用样本 SD（n−1）；CV 为 SD／均值×100%，需显式适用、非负观测和正均值。屏幕只在 n≥3 时展示统计。2.6.2把均值 ± SD与CV放入原成绩表新列，n放在均值单元格内；不另开试次统计表。等长按同方向和侧别匹配，IMTP按时间点分力和RFD行，LVP按各负荷保留速度统计，不给预估1RM增加重复统计。定义的 `cvEligible` 与项目 `primaryMetricId` 随快照、导入导出保留；自定义 CV 默认不勾选。统计尺度依据见 [NIST CV](https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/coefvari.htm)。

报告与 AI 读取同一计算接口，PDF 使用同次报告副本。原始表在成对图表区域之后，窄屏转为字段记录；PDF 克隆中将所有原始表移到末尾附录后再分页。原始表的折叠状态属于界面状态，不影响数据指纹；重绘及导出保留当前展开状态。疼痛取全部试次的逻辑或，不受最佳试次选择影响。稳定行 ID 用于嵌套错误草稿和删除撤销；单位换算覆盖所有原始试次。

## 记录与目录

目录为跨运动员共用配置。采用项目时复制指标、协议与项目元数据；`projectSnapshots` 保存名称、报告分类和主能力。旧记录未提供这些字段时按其现有定义补齐，不重建身份 ID。

项目、指标和测量条件由共用目录管理；项目停用只限制新测试选择。评价目标、等级、依据、能力汇总、等长目标、关节平衡和 LVP 参数由命名评价方案管理。每条记录关联一个方案，方案发布后关联历史和归档记录使用最新标准。方案编辑先保留草稿，展示变更及影响条数后保存，并保留上一版。

已有记录保留录入时的测量定义；界面移除了“更新本次定义”和单次评价编辑。同一指标 ID 的记录级／试次级作用域不可通过导入悄悄改变，新增作用域需要新建指标。导入同 ID 不同项目目录时保留候选版本并要求在项目库中选择，已有测量结构不跟随改变。

## 按实体存储与备份

`ringside-store.js` 提供 IndexedDB 异步事务。运动员元信息、完整记录、记录摘要、队伍、评价方案和目录配置分别保存；列表读取摘要，打开时加载完整记录。普通保存只写变化的元信息和当前记录，避免重复序列化整个运动员库。保存失败保留未保存内容以便重试，状态栏明确反馈。

整库 schema 3 保留记录 schema 2 及原始 ID。旧资料先规范化，再按评价配置与测量条件完全一致归并方案，默认采用关联记录最多的方案。迁移／导入写入独立 generation，核验结构、条数、归属和方案关联后原子切换，保留前一代和旧 localStorage；后续导入清理更早暂存代。空库和无测试档案保持为空。

`.motionbench.jsonl` 顺序为 header、config、group、profile、athlete、record、end（条数校验）。读取与写入分批进行，每条记录独立处理，不沿用旧 JSON 的 50 MB 总量限制。合并同 ID 不同评价配置会创建新方案并重映射导入记录，保留本机默认方案与既有记录。同 ID 不同记录保留为导入副本。

单报告 HTML／JSON 导出当前生效快照及方案名称版本，不保留与原库的实时关联。旧版兼容 JSON 只输出有未删除测试的运动员与生效标准；队伍、空档案、回收站不进入旧格式。恢复旧应用优先使用迁移前备份。

## 单位与输出保护

`changeMetricUnit()` 为自定义记录级／试次级结果、评价目标和区间提供统一转换，保留合法零值，拒绝溢出。当前只注册 N↔kgf 的通用手动换算；既有速度迁移单独将明确标注的 km/h 转为 m/s。其他不同单位需要清空重录，不能仅替换标签。

屏幕保留 44%／56% 的双栏比例，容器窄时堆叠。`Report.layoutCharts()` 按实际绘图区宽度、相邻主要结果表高度和各图上下限重新计算 SVG 几何；`ResizeObserver` 响应尺寸、数据和折叠变化。原始试次、补充指标及训练参考表不参与图高。手机使用独立紧凑高度，文字服从共同层级；等长雷达保留主体半径0.9系数，2.6.2将宽处高度范围设为310–390像素，窄处290像素，框架、字号和双系列含义保持一致。代表成绩模式只由全局选择器显示，结果表和图内不重复提示；CMJ和SJ在统计行的指标名称中保留各自项目名。等长与LVP存在重复统计时，原结果表改为全宽，图在表上方；手机端将含统计列的表格转为带字段名的记录。

PDF 在固定 A4 容器内调用 `Report.layoutCharts(container, {print:true})`，测量后冻结 SVG；自适应图表不再套用旧高度上限或二次字号放大。成对区块将图与首段表格留在一起，其余数据续页并重复表头。长试次字段改用纵向四列表，避免极宽表压缩。正文编号与成对区块内编号分开，分别核对源文本、图、表。短 FMS 表保持完整，长自定义指标表和大量能力列表可续页并重复表头；每次导出核对源行、数值、图表数量及重复情况。任何完整性或绘图失败都清理临时页面并恢复导出控件。

## 验证入口

2.8.0 的 `management-*-tests.cjs` 覆盖管理与录入流程、方案联动、失败恢复、跨版本导出、Chrome／Edge 300 名运动员与 3000 条完整记录及实际 PDF 下载。原有回归检查继续保留，`core-model-tests.cjs` 和 `core-browser-tests.cjs` 补充多指标、主能力、保留词、单位、快照和数量边界。`report-v2-model-tests.cjs` 与 `radar-browser-tests.cjs` 补充双雷达、部分记录、原始试次、草稿编辑、背景继承和展示故障回退。`pdf-download-tests.cjs` 覆盖真实离线下载，包含 130 个自定义指标与 60 项新增能力，以及 6 次 CMJ × 10 个字段的长报告。`verify_delivery.py` 将当前各项证据绑定到成品 SHA256；旧版本输出不算本次验收。

## 本地建议与 AI 正文

`ringside-interventions.js` 的本地候选生成规则保持不变，离线文字仍由原有候选与剂量生成。AI 不接收候选答案合同，也不限制动作或剂量必须与候选相同。

AI 输入包含完整训练背景、协议、有效汇总和明确标记的原始记录。未启用评价的目标与区间不参与 AI 分析副本中的派生结论，原记录不变。系统提示词要求跨指标综合、专项与周安排、少量主要训练手段、可执行剂量和进阶条件，并区分事实、推断及建议。独立有效 RFD 不因缺少基线力而失效；缺少基线只限制时点力反推。

AI 直接返回 Markdown；`validateAI()` 检查有效文字并拒绝旧 JSON 合同、空正文及整页网页代码。`textToHTML()` 安全转换标题、列表和表格，清理不允许的标签和属性。该校验不等于训练内容正确性审阅。

训练背景纳入数据指纹，新增记录通过实际创建入口沿用最近记录；不修改历史背景。预览可编辑并经过富文本清理，应用保留上一版正文；数据变化、切换记录或人工正文版本变化触发原有保护。

服务调用仍为原生浏览器 HTTPS，AI 生成等待300秒，模型连接检查保持60秒。离线 HTML 无法自行改变供应商 CORS 策略。验收工具的 HTTP 转发和真实响应回放仅在测试进程存在，不进入构建；模拟、回放、真实服务响应和实际浏览器直连分别记录。

剂量来源分开记录：一般训练原则对应 [ACSM 2026](https://acsm.org/resistance-training-guidelines-update-2026/)，VIFT 方法对应 [作者托管资料](https://3015ift.wordpress.com/wp-content/uploads/2013/07/buchheit-30-15ift-hottopic-nsca.pdf)，模板中的具体起始范围标注 `practice-start-v1`，不冒充原文剂量。

## 速度图与等长展示边界

`RingsideViz.speed` 接受可选 `mas`、`mss`、`ift` 和各自状态，固定顺序绘制有效正值。ASR 在图中由 MSS−MAS 计算，仅两者完整且差值非负时出现；零差值有效。右表来自同一份规范化数据，仅显示当前 IFT 版本的指标，单位为 m/s。自定义附加指标仍由原归属项目消费；没有原生速度时只显示附加结果，不生成空图。

等长雷达有且仅有力量／对称两组彩色数据；100% 参考圈使用普通网格样式，来源动作在点详情中。双侧差异占结果表22%宽度，百分比和较弱侧各自保持完整。列宽和标签样式由表格自身的 `iso-results` 类承载，PDF 续表克隆保留该类，不依赖已被移除的图表外层容器。实际下载测试检查每个差异文字区域的像素，避免 DOM 文本完整但栅格文字丢失的假通过。


## 2.4.0 视觉体系

界面颜色与尺寸以 `ringside.css` 的根变量为入口，公共控件和项目库布局集中定义。`ringside-shell.html` 使用离线内嵌 SVG 功能图标；`entryProjectTitle` 同时承担录入项目标题和内容区域的可访问名称，表单内部不再重复标题。

`ringside-viz.js` 显式使用相同语义配色及系统字体。FMS 和能力雷达的字号、行间距、分数偏移、画布高度共同调整，不能只放大字体；桌面和手机的 3–8 轴长名称检查验证边界与重叠。`ringside-pdf.js` 另设适合 A4 的尺寸规则，正文 13.333px 对应 10pt、表格 12px 对应 9pt；FMS 五列宽度为 25／18／15／24／18%，完整保留疼痛文字和可换行备注。

2.4.0 全界面验收和19组对比保留为历史证据。2.5.0 的 `tests/chart-ai-browser-tests.cjs` 使用同数据、同尺寸的独立离线浏览器，检查五种宽度、主要边界状态并生成12组图表截图；`scripts/build_visual_comparison.py --chart-ai` 打包本次自包含查看器。当前验收不借用旧版本测试结果冒充最终版本通过。

## IMTP 显示偏好与评价提示

`views.imtp.yAxis` 仅接受 `percent` 或 `force`，旧记录默认 `percent`。百分比按当前汇总时点力除以当前汇总正峰值计算；模型的最佳／均值、RFD、有效次数和原始记录均不变。该显示偏好不进入数据指纹，保存和 PDF 使用当前选择。缺峰值不算百分比；未知起点和缺测时间点不补造。

报告仅省略“未启用评价标准”“未设等级区间”两类配置状态。整表无有效评价时隐藏评价列，孤立空评价显示短横线；真实的未分级、疼痛、有效目标及数据异常继续显示。本次设置页承担配置说明。

## 2.6.3 isometric print layout

The report keeps the isometric pair independent of the generic wide-results flag. Content-driven table widths and a local overflow container preserve seven columns; derived DOM side-band heights align L/R results, statistics and evaluations. Mobile card layout clears those heights.

PDF preflight runs on the print clone before SVG rasterization. It measures the main isometric pair and its title together with pending leading headings found through the existing block collector, using a real fresh A4 body. A fitting pair stays together without chart shrink-to-fit; an oversized pair becomes separate chart/table blocks. Stacked isometric tables bypass the generic short-table whole-page move. Measured print colgroups survive tableFragment cloning, keeping continuation widths stable. `lastDiagnostics.isometricLayouts` records the chosen mode, measured heights, pending-heading count and capacity; this adds no stored record fields.


## 2.7.0 AI 连接与篇幅

单文件从正式源码构建为 MotionBench.html，并同步保留 Ringside_Boxing_Assessment.html 兼容入口。数据结构及历史存储键不改名。API 配置保留在页面闭包内，不序列化到记录；导出 HTML 删除运行时本机令牌。

直接打开文件时调用支持 CORS 的 HTTPS 服务；scripts/serve.py 则提供固定 loopback 入口和经过 Origin/Host/随机令牌校验的模型/聊天转发，不保存凭据、不向重定向地址发送授权。

AI 请求绑定当前记录、测量指纹、正文版本及连接设置。持续状态覆盖等待、取消、失败、预览待应用和应用成功。超长正文使用与 PDF 相同的分页器在独立副本中试排，超过两页则同模型精简一次；实际 PDF 中解读部分从新页开始。测量副本不会写回记录或改变字号。
