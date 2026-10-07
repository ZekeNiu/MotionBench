# 速度与储备：参数依据与采用方式

版本2.10.0，修订日期2026-10-07。保留速度比、运动员类型、实测MSS及五种训练形式；MAS与VIFT分别计算，恢复方式和配对时长完整列示。下述来源与计算说明用于维护和核验，不进入运动员报告的脚注。

## 速度比与类型

SRR＝MSS／MAS。采用 [Malone与Buchheit，2025，Methods第1页](https://sportperfsci.com/wp-content/uploads/2025/09/SPSR264_Malone.pdf) 的参考分组：耐力型＜1.70，混合型介于1.70与1.80之间，速度型＞1.80。论文样本为同队26名盖尔式足球运动员，文中称为modified SRR并引述Sandford等人的工作。用户明确选择直接采用文献参考分型。

论文两端使用开区间，没有说明等于1.70或1.80的归属；软件将这两个值纳入混合型，避免分组缺口。这是明确的实现约定。计算和分组使用未舍入成绩，显示速度比保留两位小数；目标或标准的开关不影响分型。MAS／MSS缺一项或MSS＜MAS时不生成速度比与类型。

[Sandford、Laursen与Buchheit，2021](https://martin-buchheit.net/wp-content/uploads/2021/08/Sandford-Anaerobic-SpeedPower-Reserve-and-Sport-Performance-Scientific-Basis-Current-Applications-and-Future-Directions.pdf) 支持结合MAS、MSS及ASR考察运动能力特征。上述分组的原文存在性置信度高；移用为其他项目的参考分型属于应用选择，不能据此声称已建立拳击常模或验证预测效度。

## 五种形式与六类生理目标

形式描述训练的组织方式，生理目标描述刺激组合。模型保留六类定义，页面用中文表达对应组合，不显示序号，不增加第六行HIIT。

| 形式 | 模型对应目标 | 页面生理目标 |
| --- | --- | --- |
| 长间隔 | ③④ | 有氧能力＋无氧能力；有氧能力＋无氧能力＋神经肌肉刺激 |
| 短间隔 | ①②③④ | 有氧能力；有氧能力＋神经肌肉刺激；有氧能力＋无氧能力；有氧能力＋无氧能力＋神经肌肉刺激 |
| RST | ④⑤ | 有氧能力＋无氧能力＋神经肌肉刺激；无氧能力＋神经肌肉刺激 |
| SIT | ⑤ | 无氧能力＋神经肌肉刺激 |
| 比赛型 | ②③④ | 有氧能力＋神经肌肉刺激；有氧能力＋无氧能力；有氧能力＋无氧能力＋神经肌肉刺激 |

六类定义：①有氧；②有氧与神经肌肉；③有氧与无氧糖酵解；④三者共同刺激；⑤无氧糖酵解与神经肌肉、有氧相对有限；⑥神经肌肉为主，通常对应速度、力量及爆发力训练。[HIIT Science第⑥类说明](https://hiitscience.com/hiit-speed-training/)。

长短间隔及RST参数依据Buchheit、Laursen撰写的《NSCA’s Essentials of Sport Science》第4章；SIT及比赛型典型时长参照《Science and Application of High-Intensity Interval Training》图4.16、4.17。核对材料为[NSCA章节转录](https://studylib.net/doc/27727279/test-source-nsca-essentials-of-sport-science-2021)和[原书章节转录](https://studylib.net/doc/28478875/2019-hiit-science-pro-book.pdf)，并非本轮原书PDF页面的视觉核验。正文还讨论更宽范围，表内值不是唯一标准。

RST图4.15转录标③④，同书第117页总结、NSCA章节和[HIIT Science作者应用文章](https://hiitscience.com/repeated-sprints-football-training/)支持④⑤。采用④⑤已有用户确认，依据置信度高；冲突原因及正式勘误状态未知。

## 训练速度

| 项目 | MAS百分比参考 | VIFT百分比参考 |
| --- | --- | --- |
| 长间隔做功 | 95–105% | 80–90% |
| 短间隔做功 | 100–120% | 90–105% |
| 长／短间隔及RST主动恢复 | ≤60% | ≤45% |

文献长间隔基准为vVO₂max、短间隔与主动恢复基准为VIncTest。VIncTest是递增测试终末速度，不能把任意录入的MAS自动认证为相同协议。软件展示的是明确标记MAS的百分比算术参考。[Buchheit与Laursen，2013，Part I](https://martin-buchheit.net/wp-content/uploads/2018/01/buchheit-laursen-hit-solutions-to-the-programming-puzzle-part-i.pdf)讨论了这些测试基准的差别。

MAS与VIFT分别计算，不平均、不互推。2.10.0中任何有效VIFT成绩均显示个人算术换算，不按历史“跑台／折返”编号限制。项目显示名统一为30-15VIFT，实际测试方法使用独立可留空字段；旧编号继续关联原标准，不代表已确认的方法。[30–15IFT开发者说明](https://30-15ift.com/)中VIFT取最后完成级，软件保留未完成级秒数作为测试信息，不插值。RST／SIT及比赛型做功为“全力以赴”；保留实测最大冲刺速度，MSS不是20–30秒全程可维持的下限。表内保留全部MAS/VIFT通用比例，缺少某个速度只省略该基准的个人换算值；全部原生成绩缺测时不生成空训练表。

长间隔、短间隔及RST同时列主动与被动恢复。主动恢复为≤60% MAS、≤45% VIFT，并附有效个人速度；被动恢复直接使用文字。长间隔对应主动2–4分钟、被动1–3分钟；短间隔10–60秒、RST15–60秒；SIT与比赛型分别为被动1–4分钟和1.5–2分钟。主动与被动恢复的采用讨论见上述Buchheit与Laursen 2013 Part I，表中组合沿用用户确认的训练参考。

## 做功休息比

表中列出有文献或作者资料支持的可用组合，并直接显示相应做功和休息时长。它们是参考组合，不代表比较研究已证明每一种都是所有项目的最优比例。

| 形式 | 做功∶休息 | 对应时长 | 可核查依据与采用方式 |
| --- | --- | --- | --- |
| 长间隔 | 2:1 | 4分钟／2分钟 | [HIIT Science恢复研究解读](https://hiitscience.com/hiit-recovery-insights/)采用6×4分钟及2:1；Buchheit与Laursen2013 Part I亦讨论4分钟跑、约2分钟恢复。前者研究为骑行，作为组织比例参考。 |
| 短间隔 | 1:1或2:1 | 30秒／30秒或30秒／15秒 | [Buchheit与Laursen2013 Part I](https://martin-buchheit.net/wp-content/uploads/2018/01/buchheit-laursen-hit-solutions-to-the-programming-puzzle-part-i.pdf)第3.1.2节讨论30/30；[Almquist与Rønnestad的研究解读](https://hiitscience.com/optimizing-hiit-short-intervals/)采用30/15。后者主要为骑行研究。 |
| RST | 1:4 | 5秒／20秒 | [作者足球RST文章](https://hiitscience.com/repeated-sprints-football-training/)列3–7秒冲刺及20秒重复间恢复。5秒／20秒是该范围内的具体配对；不是直接声称1:4优于所有其他配对，也不是把组间恢复混入比例。 |
| RST | 1:3或1:6 | 5秒／15秒或5秒／30秒，被动恢复 | [Iaia等人，2017](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0171462)比较约5秒的30米冲刺及15／30秒被动恢复；作为有明确配对时长的示例。 |
| SIT | 1:8 | 30秒／4分钟 | [Koral等人2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5839711/)在16名训练过的跑者中采用30秒全力场地跑、4分钟恢复。 |
| 比赛型 | 2:1 | 4分钟／2分钟 | [Bujalance-Moreno等人2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8919881/)采用4分钟小场足球、2分钟被动恢复；表内保留“小场对抗”情境。 |

比例由同一组做功秒数与恢复秒数约分生成，避免比例与时长相互矛盾。没有增加训练组数、ASR百分比处方或折返距离计算。
