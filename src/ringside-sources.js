(function (root) {
  "use strict";
  // Shared by the reference page, computed metrics and report source links.
  const entries = [
    {
      id: "turner-boxing-2018", authors: "Ruddock A, Wilson D, Hembrough D; Turner A (ed.)", year: 2018,
      title: "Boxing. Routledge Handbook of Strength and Conditioning: Sport-specific Programming for High Performance",
      publication: "Routledge, 2018. ISBN 9781138687240.",
      url: "https://www.routledge.com/Routledge-Handbook-of-Strength-and-Conditioning-Sport-specific-Programming-for-High-Performance/Turner/p/book/9780367499044",
      topics: ["职业拳击", "跳跃", "力量耐力", "药球", "地雷杠", "耐力"],
      method: "职业拳手测试参考；CMJ/SJ采用一致的跳高测量方法，药球为3 kg单臂后手投掷，地雷杠按负荷与解剖学左右侧记录峰值速度。",
      data: "内置参考涵盖CMJ、SJ、60秒俯卧撑、3 kg药球、30-15VIFT、乳酸转折点及20–40 kg地雷杠；具体目标与区间见下方数据表。",
      application: "数据用于核对所选评价方案的来源及人群。目标值与分级区间分别列示。",
    },
    {
      id: "eur-mcguigan-2006", authors: "McGuigan MR, Doyle TLA, Newton M, Edwards DJ, Nimphius S, Newton RU", year: 2006,
      title: "Eccentric utilization ratio: effect of sport and phase of training",
      publication: "Journal of Strength and Conditioning Research 20(4):992–995. DOI 10.1519/R-19165.1.",
      url: "https://pubmed.ncbi.nlm.nih.gov/17194252/", topics: ["EUR", "CMJ", "SJ"],
      method: "EUR为CMJ与SJ同一种表现量的比值；研究分别考察跳高与峰值功率口径。",
      data: "142名来自橄榄球、澳式足球、足球、垒球与曲棍球的运动员；本应用采用跳高EUR＝CMJ跳高/SJ跳高。",
      application: "CMJ增益＝(EUR−1)×100%。两者共用同一比较，不作为两个独立能力得分。",
    },
    {
      id: "eur-critique", authors: "Kozinc Ž, Smajla D, Šarabon N", year: 2024,
      title: "Is larger eccentric utilization ratio associated with poorer rate of force development in squat jump? An exploratory study",
      publication: "International Biomechanics 11(1):1–5. DOI 10.1080/23335432.2024.2341634.",
      url: "https://pubmed.ncbi.nlm.nih.gov/38613407/", topics: ["EUR解读", "SJ发力"],
      method: "同时考察跳高、峰值力及峰值功率EUR与SJ发力速率的关系。",
      data: "209名男性、104名女性；峰值力/功率EUR与SJ发力速率出现负相关。",
      application: "较高EUR不能单独解释为能力更好；同时查看SJ和CMJ原始结果、动作策略与重复表现。",
    },
    {
      id: "dsi-context-2020", authors: "Suchomel TJ, Sole CJ, Bellon CR, Stone MH", year: 2020,
      title: "Dynamic Strength Index: Relationships with Common Performance Variables and Contextualization of Training Recommendations",
      publication: "Journal of Human Kinetics 74:59–70.", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7706654/",
      topics: ["fDSI", "力量与弹道训练"],
      method: "fDSI＝CMJ推进峰值力/IMTP峰值力，分子分母须使用可比的力定义与测试协议。",
      data: "88名男性、67名女性NCAA一级运动员；结合跳高、相对力量和发力特征解读DSI。文献讨论0.60与0.80作为训练方向参考。",
      application: "本应用按小于0.60、0.60–0.80、大于0.80分别提示弹道发力、综合发展、最大力量方向；边界0.60和0.80归入综合发展。结合同次原始力量与跳跃表现确定训练优先级。",
    },
    {
      id: "dsi-impulse-2021", authors: "Haischer MH, Krzyszkowski J, Roche S, Kipp K", year: 2021,
      title: "Impulse-Based Dynamic Strength Index: Considering Time-Dependent Force Expression",
      publication: "Journal of Strength and Conditioning Research 35(5):1177–1181. DOI 10.1519/JSC.0000000000004032.",
      url: "https://epublications.marquette.edu/exsci_fac/191/", topics: ["iDSI", "匹配时窗"],
      method: "iDSI比较CMJ向心推进阶段的冲量与IMTP起始后相同时长的冲量。",
      data: "19名大学女子长曲棍球运动员；fDSI和iDSI并非同一物理量，研究中两种比值的训练分类并不总是一致。",
      application: "使用设备输出的冲量与对应时窗，分别标明总力/净力积分口径；iDSI展示连续数值，不套用fDSI训练区间。",
    },
    {
      id: "dsi-impulse-2025", authors: "Ripley NJ, Fahey J, Guppy S, Comfort P", year: 2025,
      title: "Comparisons between different methods of calculating dynamic strength index: Effect on training recommendations",
      publication: "PLOS ONE 20(9):e0331519. DOI 10.1371/journal.pone.0331519.",
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0331519", topics: ["iDSI", "固定250 ms", "fDSI"],
      method: "分别计算CMJ完整推进冲量/IMTP匹配推进时长冲量，以及CMJ完整推进冲量/IMTP起始0–250 ms冲量。",
      data: "固定250 ms指IMTP的积分时窗，CMJ分子仍为完整推进阶段；推进时长变化会影响匹配时窗版本。",
      application: "两个iDSI独立命名与展示。只有明确记录的匹配时窗或0–250 ms设备冲量参与计算，不由稀疏力时点推算积分。",
    },
    {
      id: "hop-10-5", authors: "Flanagan EP, Comyns TM, Harrison AJ, Brady CJ", year: 2025,
      title: "Reactive Strength Ability Is Associated with Late-Phase Sprint Acceleration and Ground Contact Time in Field Sport Athletes",
      publication: "Applied Sciences 15(12):6910. DOI 10.3390/app15126910.",
      url: "https://www.mdpi.com/2076-3417/15/12/6910", topics: ["Hop Test", "10/5", "RSI"],
      method: "10/5连续跳按每跳RSI＝跳高(m)/触地时间(s)排序，取最高五跳的单跳RSI均值。",
      data: "24名精英U21男子hurling运动员；本文的连续跳与分段冲刺研究采用跳高/触地时间口径。",
      application: "应用支持完整逐跳数据或设备汇总。逐跳有效数量超过5时取前5；不足5时使用全部有效跳并显示数量。跳高、触地时间与RSI分别求均值。",
    },
    {
      id: "cmrj-xu-2024", authors: "Xu J, Turner A, Comyns TM, Chavda S, Bishop C", year: 2024,
      title: "The Countermovement Rebound Jump: Between-Session Reliability and a Comparison with the Countermovement and Drop Jump Tests",
      publication: "Journal of Strength and Conditioning Research 38(4):e150–e159. DOI 10.1519/JSC.0000000000004687.",
      url: "https://pure.ul.ie/en/publications/the-countermovement-rebound-jump-between-session-reliability-and-/", topics: ["CMRJ", "第一跳", "反弹跳"],
      method: "CMRJ由一次反向跳及落地后的反弹跳组成；第一跳的RSImod使用起跳时间，第二跳的RSI使用触地时间。",
      data: "33名身体活跃者，跨两次测试比较CMJ、DJ和CMRJ；动作提示和熟悉练习影响测量。",
      application: "跳跃组合图使用CMRJ第二跳的跳高/触地时间RSI；第一跳和第二跳保留独立测量字段。",
    },
    {
      id: "rqr-southey-2024", authors: "Southey BM, Connick MJ, Spits DR, Austin DJ, Beckman EM", year: 2024,
      title: "A reliability and kinetic analysis of the 10/5 repeated jump and drop jump tests to determine the use of a novel reactive strength measure: The reactive quality ratio",
      publication: "Kinesiology 56(2):198–204. DOI 10.26582/k.56.2.2.",
      url: "https://hrcak.srce.hr/en/clanak/465730", topics: ["RQR", "腾空时间/触地时间", "DJ与Hop"],
      method: "RQR＝DJ的FT/CT指数/Hop的FT/CT指数；该文口径为腾空时间/触地时间。",
      data: "DJ采用45 cm落台及3次均值；Hop取10次中FT/CT最高的5跳。",
      application: "RQR与跳高/触地时间RSI分开计算。只有与该协议相符时命名为RQR；其他条件显示为FT/CT反应比，并保留实际协议。",
    },
    {
      id: "sandford-asr-2019", authors: "Sandford GN, Allen SV, Kilding AE, Ross A, Laursen PB", year: 2019,
      title: "Anaerobic Speed Reserve: A Key Component of Elite Male 800-m Running",
      publication: "International Journal of Sports Physiology and Performance 14(4):501–508. DOI 10.1123/ijspp.2018-0163.",
      url: "https://pubmed.ncbi.nlm.nih.gov/30300023/", topics: ["ASR", "SRR"],
      method: "ASR＝MSS−MAS；速度储备比SRR＝MSS/MAS。",
      data: "精英男性中跑运动员研究；最大冲刺速度与最大有氧速度是独立测量基准。",
      application: "ASR以m/s呈现，SRR为无量纲比值；不使用VIFT替代MAS。",
    },
    {
      id: "sandford-asr-2021", authors: "Sandford GN, Laursen PB, Buchheit M", year: 2021,
      title: "Anaerobic Speed/Power Reserve and Sport Performance: Scientific Basis, Current Applications and Future Directions",
      publication: "Sports Medicine. DOI 10.1007/s40279-021-01523-9.",
      url: "https://pubmed.ncbi.nlm.nih.gov/34398445/", topics: ["速度储备", "训练组织"],
      method: "综合最大有氧速度、最大冲刺速度及其储备描述运动员速度特征。",
      data: "综述速度/功率储备的生理基础、测量及训练应用。",
      application: "用原生速度及其关系支持训练分析；个人百分比速度分别按MAS和VIFT计算。",
    },
    {
      id: "buchheit-srr-2025", authors: "Malone S, Buchheit M", year: 2025,
      title: "Dose–Response Associations Between Heart Rate–Derived Load Measures and Changes in High-Intensity Intermittent Performance in Gaelic Football: Time to respect the physiological profile of the player?",
      publication: "Sport Performance & Science Reports 264, v1, September 2025.",
      url: "https://sportperfsci.com/wp-content/uploads/2025/09/SPSR264_Malone.pdf", topics: ["SRR参考分型"],
      method: "按MSS/MAS描述速度特征；研究采用modified SRR分组。",
      data: "同队26名盖尔式足球运动员；参考分组为耐力型<1.70、混合型1.70–1.80、速度型>1.80。",
      application: "本应用将恰好1.70和1.80纳入混合型，以未舍入结果分组；标签为该研究参考分型。",
    },
    {
      id: "buchheit-hiit-2013", authors: "Buchheit M, Laursen PB", year: 2013,
      title: "High-intensity interval training, solutions to the programming puzzle. Part I: cardiopulmonary emphasis",
      publication: "Sports Medicine 43:313–338. DOI 10.1007/s40279-013-0029-x.",
      url: "https://martin-buchheit.net/wp-content/uploads/2018/01/buchheit-laursen-hit-solutions-to-the-programming-puzzle-part-i.pdf", topics: ["HIIT", "MAS", "恢复"],
      method: "训练速度及恢复围绕有氧测试基准、做功时长和恢复时长组织。",
      data: "应用列示长间隔95–105% MAS、短间隔100–120% MAS及主动恢复≤60% MAS；分别呈现主动和被动恢复。",
      application: "个人速度按所录入MAS换算。实际测试的终末速度定义、跑台/场地及折返条件保留在测试方法中。",
    },
    {
      id: "vift-protocol", authors: "Buchheit M", year: "协议资料",
      title: "30–15 Intermittent Fitness Test", publication: "30–15 IFT 开发者官方网站及测试协议。",
      url: "https://30-15ift.com/", topics: ["30-15VIFT", "间歇训练"],
      method: "记录最后完整完成级的VIFT及实际实施方法。",
      data: "应用分别提供长间隔80–90% VIFT、短间隔90–105% VIFT及主动恢复≤45% VIFT算术参考。",
      application: "VIFT与MAS分别换算；未完成级秒数作为测试信息保留，不插值为完整级成绩。",
    },
    {
      id: "lvp-ruf-2018", authors: "Ruf L, Chéry C, Taylor KL", year: 2018,
      title: "Validity and Reliability of the Load-Velocity Relationship to Predict the One-Repetition Maximum in Deadlift",
      publication: "Journal of Strength and Conditioning Research 32(3):681–689. DOI 10.1519/JSC.0000000000002369.",
      url: "https://pubmed.ncbi.nlm.nih.gov/29466270/", topics: ["LVP", "估计负荷"],
      method: "以次最大负荷与动作速度建立个体回归，将对应动作的最小速度阈值代入估算负荷。",
      data: "11名有抗阻训练经验的运动员；研究中部分估计高于实测1RM，存在个体差异。",
      application: "应用对负荷汇总后做线性回归，估计负荷＝(MVT−截距)/斜率，显示95%均值响应置信带。MVT需匹配动作、速度类型和设备。",
    },
    {
      id: "fms-cook-2014", authors: "Cook G, Burton L, Hoogenboom BJ, Voight M", year: 2014,
      title: "Functional movement screening: the use of fundamental movements as an assessment of function — Part 1",
      publication: "International Journal of Sports Physical Therapy 9(3):396–409.",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4060319/", topics: ["FMS", "动作筛查"],
      method: "使用0–3级原始评分，保留侧别表现及疼痛信息。",
      data: "文章介绍筛查依据及深蹲、跨栏步、直线弓步的操作与评分；其余四项见同系列第二部分。",
      application: "报告保留七项原始分数、左右差异、疼痛和备注，以具体动作结果安排进一步检查。",
    },
    {
      id: "nist-cv", authors: "NIST", year: "统计方法",
      title: "Coefficient of Variation", publication: "NIST Dataplot Reference Manual.",
      url: "https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/coefvari.htm", topics: ["重复测量", "SD", "CV"],
      method: "样本标准差使用n−1分母；CV＝样本SD/均值×100%。",
      data: "应用在同一指标至少3次有效重复时显示均值±SD；CV要求适用比率尺度且均值为正。",
      application: "同次连续Hop内的五跳选择不视为五次独立的10/5测试重复。",
    },
  ];
  const byId = new Map(entries.map(source => [source.id, source]));
  function get(id) { return byId.get(id) || null; }
  function forIds(ids) { return [...new Set(ids || [])].map(get).filter(Boolean); }
  function interval(range) {
    if (range.min == null) return (range.includeMax === false ? "<" : "≤") + range.max;
    if (range.max == null) return (range.includeMin === false ? ">" : "≥") + range.min;
    if (range.min === range.max) return "=" + range.min;
    return (range.includeMin === false ? "(" : "[") + range.min + ", " + range.max + (range.includeMax === false ? ")" : "]");
  }
  function render({ E }) {
    const data = (root.Def?.builtins || []).filter(metric => metric.source === root.Def.source);
    const standards = `<details class="source-data"><summary>查看内置职业拳击参考数据（${data.length}项）</summary><div class="table-scroll"><table><thead><tr><th>指标</th><th>目标值</th><th>参考区间</th></tr></thead><tbody>${data.map(metric => `<tr><td>${E(metric.name)}</td><td>${E(metric.target)} ${E(metric.unit)}</td><td>${(metric.ranges || []).map(range => `${E(interval(range))}：${E(range.label)}`).join("；")}</td></tr>`).join("")}</tbody></table></div></details>`;
    return '<div class="references-page"><p class="intro">文献按应用中的测试与计算关系整理。展开可查看采用的方法、数据和适用条件。</p>' + entries.map(source => `<section class="source-reference" id="source-${E(source.id)}"><h3><a href="${E(source.url)}" target="_blank" rel="noopener noreferrer">${E(source.title)}</a></h3><p class="note">${E(source.authors)} · ${E(source.year)}<br>${E(source.publication)}</p><p>${source.topics.map(E).join(" · ")}</p><details><summary>方法与采用数据</summary><dl><dt>测试与计算</dt><dd>${E(source.method)}</dd><dt>文献与参考数据</dt><dd>${E(source.data)}</dd><dt>应用方式</dt><dd>${E(source.application)}</dd></dl></details>${source.id === "turner-boxing-2018" ? standards : ""}</section>`).join("") + '<section class="source-reference"><h3>其他计算方法</h3><p>双侧差异＝|L−R|/max(L,R)×100%；两侧均为0时不计算差异。IR:ER＝内旋/外旋，H:Q＝膝屈/膝伸；力值比与力矩比使用各自匹配的单位和协议。</p></section></div>';
  }
  root.RingsideSources = { entries, get, forIds, render };
})(typeof window !== "undefined" ? window : globalThis);
