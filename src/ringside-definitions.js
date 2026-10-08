(function (root) {
  'use strict';

  var SOURCE = 'Ruddock, Wilson & Hembrough, Boxing, in Turner (ed.), Routledge Handbook of Strength and Conditioning (2018), 第 22 章表 22.2，印刷页 393 / PDF 页 406。职业拳手参考。';
  // Exact factory aliases only. Free text and user-edited protocols are never rewritten.
  var factoryAliases = {
    name: {
      cmj_height: ['CMJ 跳高', 'CMJ 垂直跳跃高度'],
      sj_height: ['SJ 跳高', 'SJ 垂直跳跃高度'],
      dj_height: ['DJ 反弹跳高', 'DJ 反弹垂直跳跃高度'],
      hop_height: ['HOP 反弹跳高', 'HOP 反弹垂直跳跃高度'],
      cmrj_height: ['CMRJ 反弹跳高', 'CMRJ 反弹垂直跳跃高度'],
      cmrj_first_height: ['CMRJ 首跳跳高', 'CMRJ 首跳垂直跳跃高度']
    },
    protocol: {
      cmj_height: ['统一手臂使用、起始姿势与跳高测量方法；原章节使用光电飞行时间。', '统一手臂使用、起始姿势与垂直跳跃高度测量方法；原章节使用光电飞行时间。']
    },
    testProtocol: {
      dj: ['双手叉腰；记录跌落高度；落地后立即反弹；RSI 为跳高/触地时间。', '双手叉腰；记录跌落高度；落地后立即反弹；RSI 为垂直跳跃高度/触地时间。'],
      hop: ['垂直连续反应跳；≤5 个有效跳按已筛选数据使用，>5 个按跳高/触地时间选最高5个；保留实际数量。', '垂直连续反应跳；≤5 个有效跳按已筛选数据使用，>5 个按垂直跳跃高度/触地时间选最高5个；保留实际数量。']
    }
  };
  function factoryText(id, field, value, legacy) {
    var pair = factoryAliases[field] && factoryAliases[field][id];
    return pair && value === pair[legacy ? 1 : 0] ? pair[legacy ? 0 : 1] : value;
  }
  var anomalies = [
    '原表存在空白区间与共享边界：保留原文，不自动补齐；未命中区间显示“未分级”。共享单点默认归入数值较高的区间，可在调用分级时改为 lower 或 unclassified。',
    '地雷杠 35 kg 的部分参考值低于 40 kg，这是原表内容；不自动修订。其左右侧为解剖学 R/L，药球则为优势/非优势侧。',
    '乳酸 LTP1/LTP2 的“达标”“良好”在原表中是单点值；不扩展为连续区间。',
    '目标达成度是数值 / 用户设定目标 × 100 的可配置展示值，不是百分位、验证过的能力总分或损伤概率。',
    '第 22 章未给出 FMS、区域等长绝对力量或不对称性的损伤预测阈值，亦未给出深蹲、卧推或硬拉 LVP 的统一速度素质区间。'
  ];

  function numeric(text) {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
    var value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  // One literal interval per line: <35 | 待提升 | red
  // Inclusive decimal intervals use 40..44; brackets permit exclusive endpoints.
  function parseRanges(text) {
    if (typeof text !== 'string') throw new Error('评价区间需要文本。');
    var result = [];
    text.split(/\r?\n/).forEach(function (raw, index) {
      var line = raw.trim();
      if (!line) return;
      var parts = line.split('|').map(function (part) { return part.trim(); });
      function fail(message) { throw new Error('第 ' + (index + 1) + ' 行：' + message); }
      if (parts.length !== 3 || !parts[1]) fail('请使用“区间 | 标签 | red/amber/green/gray”。');
      if (['red', 'amber', 'green', 'gray'].indexOf(parts[2]) === -1) fail('颜色仅支持 red、amber、green、gray。');
      var expression = parts[0].replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/\s+/g, '');
      var min = null, max = null, includeMin = true, includeMax = true;
      var match = expression.match(/^(<=|>=|<|>|=)(.+)$/);
      if (match) {
        var endpoint = numeric(match[2]);
        if (endpoint === null) fail('端点必须是有限数值。');
        if (match[1] === '<' || match[1] === '<=') { max = endpoint; includeMax = match[1] === '<='; }
        else if (match[1] === '>' || match[1] === '>=') { min = endpoint; includeMin = match[1] === '>='; }
        else { min = endpoint; max = endpoint; }
      } else {
        var left = expression.charAt(0), right = expression.charAt(expression.length - 1);
        var hasLeft = left === '[' || left === '(';
        var hasRight = right === ']' || right === ')';
        if (hasLeft !== hasRight) fail('区间括号需要成对出现，例如 [40..44)。');
        if (hasLeft) {
          includeMin = left === '['; includeMax = right === ']';
          expression = expression.slice(1, -1);
        }
        var bounds = expression.split('..');
        if (bounds.length !== 2) fail('区间支持 <、<=、>、>=、= 或 40..44。');
        min = numeric(bounds[0]); max = numeric(bounds[1]);
        if (min === null || max === null) fail('两个端点都必须是有限数值。');
        if (min > max) fail('下限不能大于上限。');
        if (min === max && (!includeMin || !includeMax)) fail('相同端点的区间必须包含端点。');
      }
      result.push({ min: min, max: max, includeMin: includeMin, includeMax: includeMax, label: parts[1], status: parts[2] });
    });
    return result;
  }

  function rangeText(ranges) {
    return (Array.isArray(ranges) ? ranges : []).map(function (range) {
      var expression;
      if (range.min === null || range.min === undefined) {
        if (range.max === null || range.max === undefined) throw new Error('不支持两端均无限的分级区间。');
        expression = (range.includeMax === false ? '<' : '<=') + range.max;
      } else if (range.max === null || range.max === undefined) {
        expression = (range.includeMin === false ? '>' : '>=') + range.min;
      } else if (range.min === range.max && range.includeMin !== false && range.includeMax !== false) {
        expression = '=' + range.min;
      } else {
        expression = range.min + '..' + range.max;
        if (range.includeMin === false || range.includeMax === false) expression = (range.includeMin === false ? '(' : '[') + expression + (range.includeMax === false ? ')' : ']');
      }
      return expression + ' | ' + range.label + ' | ' + range.status;
    }).join('\n');
  }

  function make(id, testId, name, unit, ability, target, protocol, text) {
    return { id: id, testId: testId, name: name, unit: unit, ability: ability,
      category: 'performance', direction: 'higher', target: target,
      referenceEnabled: false, source: SOURCE, protocol: protocol, ranges: parseRanges(text) };
  }

  function four(poor, adequate, good, excellent) {
    return poor + ' | 待提升 | red\n' + adequate + ' | 达标 | amber\n' + good + ' | 良好 | green\n' + excellent + ' | 优秀 | green';
  }

  var builtins = [
    make('cmj_height', 'cmj', 'CMJ 垂直跳跃高度', 'cm', '下肢爆发力', 50, '统一手臂使用、起始姿势与垂直跳跃高度测量方法；原章节使用光电飞行时间。', four('<35', '40..44', '45..49', '>50')),
    make('sj_height', 'sj', 'SJ 垂直跳跃高度', 'cm', '下肢爆发力', 50, '静止半蹲起跳，避免预先反向运动；与 CMJ 采用一致测量方法。', four('<30', '35..39', '40..44', '>50')),
    make('pushup_reps', 'pushup', '60 秒俯卧撑', '次', '力量耐力', 80, '60 秒；下放至胸部与大腿触地，再完全伸肘计 1 次；记录动作规范。', four('<60', '60..70', '70..80', '>80')),
    make('mb_dom', 'mb', '3 kg 药球后手投掷·优势侧', 'm', '旋转投掷能力', 13, '3 kg 药球；拳击分腿站姿，从后脚侧肩部单臂模拟后手出拳；起点至首次落地距离。', four('<9', '9..11', '11..13', '>13')),
    make('mb_non', 'mb', '3 kg 药球后手投掷·非优势侧', 'm', '旋转投掷能力', 12, '3 kg 药球；与优势侧相同动作与测距。不是双手旋转掷球或头上向后投掷。', four('<8', '8..10', '10..12', '>12')),
    make('ift_treadmill', 'ift', '30-15VIFT', 'km/h', '间歇耐力', 23.5, '30-15VIFT', four('<=19.5', '20..21.5', '22..23', '>=23.5')),
    make('lt1', 'lactate', '乳酸第一转折点 LTP1', 'km/h', '有氧代谢能力', 15, '递增跑台乳酸曲线第一转折点，由评估者确认方法；原章 3 分钟 / 级、1 分钟采样恢复。固定 2 mmol/L 不等同于 LTP1。', four('<=10', '=12', '=14', '>=15')),
    make('lt2', 'lactate', '乳酸第二转折点 LTP2', 'km/h', '有氧代谢能力', 18, '递增跑台乳酸曲线第二转折点，由评估者确认方法；固定 4 mmol/L 不等同于 LTP2。', four('<=13', '=15', '=17', '>=18')),
    make('landmine_r20', 'landmine', '地雷杠出拳·右侧 20 kg 峰值速度', 'm/s', '专项快速发力', 4.28, '总标称负荷 20 kg（杠铃+杠铃片）；右手，固定脚位拳击分腿姿势；线性位移传感器峰值速度。', four('<3.56', '3.57..3.97', '3.98..4.26', '>4.28')),
    make('landmine_l20', 'landmine', '地雷杠出拳·左侧 20 kg 峰值速度', 'm/s', '专项快速发力', 3.98, '总标称负荷 20 kg；左手；与右侧保持一致的器材、杠角与传感器安装。', four('<3.54', '3.55..3.76', '3.77..3.96', '>3.98')),
    make('landmine_r25', 'landmine', '地雷杠出拳·右侧 25 kg 峰值速度', 'm/s', '专项快速发力', 3.69, '总标称负荷 25 kg；解剖学右侧；记录峰值速度。', four('<3.11', '3.11..3.51', '3.52..3.65', '>3.69')),
    make('landmine_l25', 'landmine', '地雷杠出拳·左侧 25 kg 峰值速度', 'm/s', '专项快速发力', 3.5, '总标称负荷 25 kg；解剖学左侧；记录峰值速度。', four('<3.0', '3.01..3.3', '3.31..3.48', '>3.5')),
    make('landmine_r30', 'landmine', '地雷杠出拳·右侧 30 kg 峰值速度', 'm/s', '专项快速发力', 3.3, '总标称负荷 30 kg；解剖学右侧；记录峰值速度。', four('<2.75', '2.76..2.99', '3.0..3.28', '>3.3')),
    make('landmine_l30', 'landmine', '地雷杠出拳·左侧 30 kg 峰值速度', 'm/s', '专项快速发力', 3.09, '总标称负荷 30 kg；解剖学左侧；记录峰值速度。', four('<2.67', '2.68..2.94', '2.95..3.08', '>3.09')),
    make('landmine_r35', 'landmine', '地雷杠出拳·右侧 35 kg 峰值速度', 'm/s', '专项快速发力', 2.68, '总标称负荷 35 kg；保留原表数值，此负荷参考值与 40 kg 不呈预期单调关系。', four('<1.92', '1.93..2.4', '2.41..2.67', '>2.68')),
    make('landmine_l35', 'landmine', '地雷杠出拳·左侧 35 kg 峰值速度', 'm/s', '专项快速发力', 2.56, '总标称负荷 35 kg；保留原表数值，此负荷参考值与 40 kg 不呈预期单调关系。', four('<1.80', '1.81..2.32', '2.33..2.56', '>2.56')),
    make('landmine_r40', 'landmine', '地雷杠出拳·右侧 40 kg 峰值速度', 'm/s', '专项快速发力', 2.65, '总标称负荷 40 kg；解剖学右侧；记录峰值速度。', four('<2.17', '2.18..2.32', '2.33..2.61', '>2.65')),
    make('landmine_l40', 'landmine', '地雷杠出拳·左侧 40 kg 峰值速度', 'm/s', '专项快速发力', 2.42, '总标称负荷 40 kg；解剖学左侧；记录峰值速度。', four('<2.02', '2.03..2.09', '2.10..2.34', '>2.42'))
  ];

  // Source intervals are retained exactly above, then converted to the page's
  // single speed unit without changing endpoint inclusion or grading gaps.
  builtins.filter(function (definition) { return definition.unit === 'km/h'; }).forEach(function (definition) {
    definition.target /= 3.6;
    definition.ranges.forEach(function (range) {
      ['min', 'max'].forEach(function (key) { if (range[key] !== null) range[key] /= 3.6; });
    });
    definition.unit = 'm/s';
    definition.protocol = definition.protocol.replace(/([\d.]+)\s*km\/h/g, function (_, value) { return String(Number((Number(value) / 3.6).toFixed(6))) + ' m/s'; });
  });

  function grade(value, definition, options) {
    if (!root.Calc || typeof root.Calc.classify !== 'function') throw new Error('请先加载 math.js。');
    var def = definition || {};
    if (def.referenceEnabled === false) return { status: 'unclassified', label: '未启用标准', range: null, ambiguous: false, boundaryResolved: false };
    var ranges = (Array.isArray(def.ranges) ? def.ranges : []).map(function (range) {
      return Object.assign({}, range, { minInclusive: range.includeMin !== false, maxInclusive: range.includeMax !== false });
    });
    return root.Calc.classify(value, ranges, options);
  }

  // Only the shipped description has an alias. User-authored measurement
  // conditions, units and the two legacy metric IDs remain distinct.
  function viftProtocol(id, text) {
    var legacy = '跑台改良版：8 km/h 起，每级 +0.5 km/h，30 秒跑 / 15 秒被动恢复；记录最终完整级与未完成级持续时间。不得套用至折返版。';
    var converted = '跑台改良版：2.222222 m/s 起，每级 +0.138889 m/s，30 秒跑 / 15 秒被动恢复；记录最终完整级与未完成级持续时间。不得套用至折返版。';
    return id === 'ift_treadmill' && [legacy, converted, '30-15VIFT'].indexOf(text) !== -1 ? '30-15VIFT' : text;
  }
  root.Def = { builtins: builtins, source: SOURCE, anomalies: anomalies, viftProtocol: viftProtocol, factoryText: factoryText,
    defaultDefinitions: function () { return JSON.parse(JSON.stringify(builtins)); },
    parseRanges: parseRanges, rangeText: rangeText, grade: grade };
})(typeof window !== 'undefined' ? window : globalThis);
