# 2.18.0-local 双弹性框架数据契约

本次扩展基于已验收的 2.17.5-local。跳跃项目仍使用 `fvp_sj` / `fvp_cmj`，冲刺项目仍使用 `sprint_fvp`；保留原始测量结构、90° / 30° 同功率最优剖面、经典跳跃速度口径及 2022 冲刺最优剖面算法。新增冲刺弹性结果单独计算，不能以其时间结果替换原有冲刺最优模型。

## 持久化字段

| 字段 | 默认值 | 含义与验证 |
| --- | --- | --- |
| `views.capabilitySelections.strength` | 原默认 `fvp` | 新增 `jump_elasticity`；既有 FVP、DSI、iDSI、EUR 标识保留 |
| `views.capabilitySelections.speed` | 原默认 `sprint_fvp` | 新增 `sprint_elasticity`；既有 FVP、SRR 标识保留 |
| `views.capabilityExpanded.strength/reactive/speed/endurance` | 各为 `false` | 四卡相关参数的展开状态；只能为布尔值 |
| `views.fvpProtocol` | 保持缺字段 | 有数据的显式 `fvp_sj` / `fvp_cmj` 优先；`auto` 与未选同义 |
| `fvpView.{fvp_sj/fvp_cmj}.elasticityView` | `response` | 仅允许 `response` / `constraint`，分别为参数响应 / 固定预测跳高 ER–EN |
| `sprintFvpView.elasticityView` | `response` | 仅允许 `response` / `distance`，分别为参数响应 / 不同目标距离 |
| `sprintFvpView.responseForce/responseVelocity/responseBoth` | 各为 `true` | 三条响应曲线的独立显示状态；只能为布尔值 |
| `sprintFvpAnalysis.deltaForcePct/deltaVelocityPct` | 各为 `0` | 独立改变 F₀ / V₀；须为有限数且大于 −100% |
| `sprintFvpAnalysis.elasticityMethodVersion` | `li-2026-sprint-elasticity-forward1-v1` | 方法元数据须为文字；未知版本保留参数，弹性拒绝计算 |

跳跃既有 `fvpAnalysis.{id}.deltaForcePct/deltaVelocityPct` 同样要求有限数且大于 −100%。显式空字符串、空白文字或 `null` 不表示 0，须提示填写；历史记录缺字段时补默认 0。`sprintFvpAnalysis.targetDistanceM` 保留原语义：空值跟随所选完整试次末段，有值须为有限正数。

显示字段不进入测量指纹。冲刺新增情景字段处于默认 0、方法版本处于当前默认版本时，从指纹投影中省略，保持历史 AI 测量依据。非默认情景、非默认方法版本及目标距离改变进入指纹。选中的能力依据由 `capabilityDirectionsBasis` 单独绑定；跳跃 FVP 与跳跃弹性绑定的是实际解析的 SJ / CMJ 协议，不绑定“自动 / 显式”的显示标记。

## 共用计算接口

- `RingsideModel.resolveJumpFvpProtocol(record, computed?)`：只在启用、系统原生且有录入数据的 SJ / CMJ 中选择。现存显式协议优先，即使该协议暂时无法计算；否则首个有效协议，再首个有数据协议；均不存在时返回 `null`。卡片、图区与 AI 使用同一解析结果。
- `RingsideModel.stats(record).sprintElasticity`：在启用原生冲刺项目时，只调用一次 `RingsideSprintElasticity.solve(sprintFvp, sprintFvpAnalysis)`，供卡片、图表和 AI 复用。顶层 `valid` 表示当前弹性可计算；`scenario.valid/reason` 独立表示设定情景可计算。基线尚不可计算时可保留合法设置。
- 冲刺框架返回 `methodVersion`、`targetDistanceM`、`k`、`atmosphere`、`current`、`elasticity`、`scenario`、`sensitivity`、`constraint`。`current.timeS` 与 `scenario.timeS` 来自新框架；旧 `stats.sprintFvp` 的拟合及最优结果保持独立。
- `elasticity` 包含 `Fe`、`ve`、`ER`、`EN` 与局部响应判定；`scenario` 包含完整重算时间、时间改变和情景后的弹性；`constraint` 包含不同距离的曲线、当前点、EN 最低点与 ER=1 点。
- 跳跃 `RingsideFVP.solve(record,id).elasticityConstraint` 包含 `valid`、`heightCm`、`methodVersion`、`points`、`current`、`balance`、`valley`。固定预测跳高与蹬伸距离，沿原方程重算 Fe、ve、ER、EN；ER=1 与 EN 最低点分别保留。

跳跃约束沿 `F₀(1−λu/V₀)=g(1+h/d)` 计算，仍采用经典 λ=0.5 的 V₀ 展示。Li λ=0.77 换算与既有实现一致；预测高度及四项弹性不因常数速度参数化换算改变。固定高度曲线上 EN 最低点的 `ER=2h/(d+h)` 来自同一方程的导数，不是训练分级阈值。

能力卡采用当前剖面的 ER 判断哪一端局部响应更大；情景结果继续留在弹性面板。跳跃弹性始终对应垂直跳高，即使经典 FVP 的目标角度选为 30°。ER=1 只表示两端局部响应相当，不等于 EN 最低。

## Excel 与 JSON 兼容

Excel 条件的依据选项及标签从 `RingsideModel.capabilityDirectionOptions` 读取。两种现有 XLSX schema 均可往返新增情景、方法版本、视图、协议与四卡展开字段；协议 `auto` 显示为“自动选择有效协议”。旧能力依据标签保留解析别名。

旧 XLSX 未提供新增条件字段时，不以归一化产生的默认值覆写已有记录：已有情景、视图及展开状态保留；新记录获得默认 0、参数响应视图及折叠状态。原模板中的字段或实际新增的条件行均属于明确提供，可按导入决策替换。此兼容规则同时覆盖旧 schema 1 / 2 的真实固定工作簿。

记录信封、JSON / JSONL 存储与评价物化保持原结构；新增字段在归一化时补齐，原始 ID 与测量数据保留。默认项目名称采用精确显示别名：`跳跃FVP · SJ` / `跳跃FVP · CMJ` / `冲刺FVP`。既有原始项目快照与目录名称不因显示改名重写；用户自定义名称保持原样，同名历史自定义项目继续使用原手动结构。

## 验证与基线来源

`tests/dual-elasticity-model-tests.cjs` 覆盖新增字段、无效输入、协议选择、AI 依据、固定高度约束、旧模型数值、两种实际 XLSX 往返及旧模板不覆写未提供字段。

`tests/fixtures/capability-direction-values-v2175.json` 是独立旧模型语义基线：从 Git 提交 `955d3914ad0a85c34f553ce935af54cabd77131f` 的源码只读计算 19 个既有场景，固定保存指标 ID、数值、单位、状态、判定及显示精度。原模型 SHA256 为 `b2b48880054a66afd50d8188c51b7e7502a5d6ad8f4da363b0cc2a5333203711`；完整模块哈希随 JSON 保存。`capability-directions-model-tests.cjs` 同时比较该静态基线与新卡片的屏幕 / 打印 HTML，避免以重置旧布局哈希代替数值验证。

上述工作簿验证使用离线 ExcelJS 读取和写入实际 XLSX 文件，不等同于本轮重新运行 Microsoft Excel。浏览器、PDF 与最终成品哈希的验收由本版本交付记录另行绑定。
