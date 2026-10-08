const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/ringside-viz.js'), 'utf8'), context);
const V = context.RingsideViz;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function markers(html) { return [...html.matchAll(/<g class="viz-point"[^>]*data-force-time="([^"]+)"[^>]*>/g)].map(m => Number(m[1])); }
function finite(html) { assert.ok(!/NaN|Infinity/.test(html)); }

test('body markers preserve region accessibility without white specular dots', () => {
  const html = V.body({ shoulder_l: { status: 'red', tooltip: '疼痛' } });
  assert.equal((html.match(/class="viz-hotspot"/g) || []).length, 18);
  assert.equal((html.match(/<circle /g) || []).length, 36);
  assert.ok(html.includes('data-region="shoulder_l"'));
  assert.ok(html.includes('role="button" tabindex="0"'));
  assert.ok(!html.includes('opacity=".35"'));
  assert.ok(!html.includes('<title'));
  assert.ok(html.includes('aria-label="身体区域筛查"'));
  assert.ok(!/<svg[^>]*style="[^"]*(?:height|width)/.test(html), 'body display dimensions belong to the report container');
});
test('radar uses a compact canvas with readable axis labels and retains full long labels', () => {
  const labels = ['下肢爆发力', '力量耐力', '肢体投掷能力', '间歇耐力', '有氧代谢能力', '较长的自定义能力分类标签'];
  const html = V.radar(labels.map(label => ({ label, value: 85, status: 'amber' })));
  assert.ok(html.includes('viewBox="0 0 520 390"'));
  assert.equal((html.match(/class="radar-label"/g) || []).length, 6);
  assert.ok(html.includes('font-size="18" font-weight="600"'));
  assert.ok(html.includes('<desc>较长的自定义能力分类标签</desc>'));
  assert.ok(!html.includes('<title'));
  assert.ok(!html.includes('100 = 评价目标'));
  finite(html);
});
test('FMS keeps seven radar axes and fixed score traffic lights', () => {
  const html = V.fms(Array.from({ length: 7 }, (_, i) => ({ label: '动作 ' + (i + 1), score: [0, 1, 2, 3, '', null, 4][i] })));
  assert.ok(html.includes('viewBox="0 0 460 350"'));
  assert.equal((html.match(/class="viz-point"/g) || []).length, 4);
  for (const c of [V.C.red, V.C.amber, V.C.green]) assert.ok(html.includes('fill="' + c + '"'));
  finite(html);
});
test('comparison uses supplied grade color and names the supplied target in tooltip', () => {
  const html = V.compare([{ label: '药球投掷', value: 9.6, target: 11, targetLabel: '优秀等级门槛', unit: 'm', status: 'amber' }]);
  assert.ok(html.includes('fill="' + V.C.amber + '"'));
  assert.ok(html.includes('优秀等级门槛 11 m'));
  assert.ok(!html.includes('fill="' + V.C.green + '"'));
});
test('asymmetry splits into small panels and uses the same configured threshold lines', () => {
  const html = V.iso(Array.from({ length: 6 }, (_, i) => ({ label: '方向 ' + i, asym: i === 5 ? 50 : 5, stronger: 'R', status: i === 5 ? 'red' : 'green' })), [], { asymAmber: 15, asymRed: 25 });
  assert.equal((html.match(/<svg /g) || []).length, 2);
  assert.equal((html.match(/data-tooltip="关注阈值 15%"/g) || []).length, 2);
  assert.equal((html.match(/data-tooltip="重点关注阈值 25%"/g) || []).length, 2);
  const thresholds = [...html.matchAll(/data-tooltip="关注阈值 15%"[^]*?<line x1="([^"]+)"/g)].map(m => m[1]);
  assert.equal(thresholds[0], thresholds[1]);
  assert.ok(html.includes('50% R'));
  finite(html);
});
test('balance shows both sides and highlights only confirmed enabled green ranges', () => {
  const input = { label: '肩 IR:ER', left: 1.8, right: 2.2, confirmed: true, referenceEnabled: true, ranges: [{ min: 1.5, max: 2.1, status: 'green' }], statusLeft: 'green', statusRight: 'amber' };
  const html = V.iso([], [input]);
  assert.ok(html.includes('已设评价区间 1.5–2.1'));
  assert.ok(html.includes('圆点 L · 方点 R'));
  assert.ok(html.includes('L 1.8 / R 2.2'));
  assert.ok(html.includes('<rect'));
  assert.ok(!V.iso([], [{ ...input, confirmed: false }]).includes('已设评价区间'));
  finite(html);
});
test('lactate distinguishes fixed concentrations from personal thresholds and uses independent heart-rate axis', () => {
  const rows = [{ speed: 3, lactate: 1, hr: 140 }, { speed: 4, lactate: 3, hr: 165 }, { speed: 5, lactate: 7, hr: 185 }];
  const html = V.lactate(rows, { lt1: 3.5, lt2: 4.6, method: '人工确认' });
  assert.ok(html.includes('2 mmol/L · 固定浓度参考'));
  assert.ok(html.includes('4 mmol/L · 固定浓度参考'));
  assert.ok(html.includes('LT1 3.5 m/s · 人工确认'));
  assert.ok(html.includes('stroke="' + V.C.blue + '" stroke-width="2.5"'));
  assert.ok(html.includes('stroke="' + V.C.red + '" stroke-width="1.8" stroke-dasharray="5 4"'));
  assert.ok(html.includes('心率（右轴）'));
  assert.ok(!V.lactate(rows).includes('LT1 3.5'));
  finite(html);
});
test('lactate custom threshold names keep the original values and method lookup', () => {
  const rows = [{ speed: 3, lactate: 1 }, { speed: 4, lactate: 3 }, { speed: 5, lactate: 7 }];
  const html = V.lactate(rows, { lt1: { speed: 3.5, method: '转折点法' }, lt2: { speed: 4.6, method: '人工确认' }, lt1Label: 'LTP1', lt2Label: 'LTP2' });
  assert.ok(html.includes('LTP1 3.5 m/s · 转折点法'));
  assert.ok(html.includes('LTP2 4.6 m/s · 人工确认'));
  assert.ok(!html.includes('LT1 3.5'));
  finite(html);
});
test('LVP display consistently calls one-repetition-max estimates 预估1RM', () => {
  const series = { id: 'squat', label: '深蹲', points: [{ load: 20, velocity: .9 }, { load: 40, velocity: .7 }, { load: 60, velocity: .5 }], mvt: .2, estimate: { load: 90, valid: true } };
  for (const id of ['squat', 'landmineR', 'landmineL']) for (const label of [undefined, '估计1RM', '估计 1RM', '估计负荷']) {
    const html = V.lvp([{ ...series, id, estimate: { ...series.estimate, label } }], { showBand: false });
    assert.ok(html.includes('预估1RM 90 kg'));
    assert.ok(!html.includes('空心圆：基于MVT的预估1RM'));
    assert.ok(!/估计\s*1RM|估计负荷|指定速度估计/.test(html));
    finite(html);
  }
});
test('nearby left and right landmine estimates keep both points and stagger their labels', () => {
  const base = { points: [{ load: 20, velocity: .9 }, { load: 40, velocity: .7 }, { load: 60, velocity: .5 }], estimate: { valid: true } };
  const html = V.lvp([{ ...base, id: 'landmineR', label: '地雷杠 R', mvt: .2, estimate: { ...base.estimate, load: 90 } }, { ...base, id: 'landmineL', label: '地雷杠 L', mvt: .21, estimate: { ...base.estimate, load: 89 } }], { showBand: false });
  const labelYs = [...html.matchAll(/<text x="[^"]+" y="([^"]+)"[^>]*class="lvp-estimate-label"/g)].map(m => Number(m[1]));
  assert.equal(labelYs.length, 2);
  assert.ok(Math.abs(labelYs[0] - labelYs[1]) >= 20);
  assert.ok(html.includes('地雷杠 R · 预估1RM 90 kg · MVT 0.2 m/s'));
  assert.ok(html.includes('地雷杠 L · 预估1RM 89 kg · MVT 0.21 m/s'));
  assert.equal((html.match(/<desc>预估1RM /g) || []).length, 2);
  assert.ok(html.includes('aria-label="地雷杠 R · 预估1RM 90 kg · MVT 0.2 m/s"'));
  finite(html);
});
test('force-time does not invent baseline or timed peak points', () => {
  const html = V.forceTime({ mode: 'best', n: 1, points: [{ timeMs: 100, force: 1100, derived: false, n: 1 }, { timeMs: 200, force: 1600, derived: true, n: 1 }], peakForce: 2800, peakTimeMs: null, baselineForce: null });
  assert.deepEqual(markers(html), [100, 200]);
  assert.ok(html.includes('data-derived="true"'));
  assert.ok(html.includes('<polygon'));
  assert.ok(html.includes('峰值 100% · 2800 N'));
  assert.ok(!html.includes('<path '));
  finite(html);
});
test('force-time includes explicit zero baseline and peak time without smoothing', () => {
  const html = V.forceTime({ mode: 'best', n: 1, points: [{ timeMs: 100, force: 1100, derived: false }], peakForce: 2800, peakTimeMs: 400, baselineForce: 0 });
  assert.deepEqual(markers(html), [0, 100, 400]);
  assert.ok(html.includes('起始基线'));
  assert.ok(html.includes('峰值时间点'));
  assert.ok(html.includes('峰值 100% · 2800 N'));
  finite(html);
});
test('peak-only force-time stays a reference-only panel without a fabricated time domain', () => {
  const html = V.forceTime({ peakForce: 2800, baselineForce: 500, points: [] });
  assert.deepEqual(markers(html), []);
  assert.ok(html.includes('指定时间的力尚未录入'));
  assert.ok(!html.includes('时间 / ms'));
  finite(html);
});
test('force-time mean tooltips retain each point effective count and provenance', () => {
  const html = V.forceTime({ mode: 'mean', n: 3, peakForce: 2700, points: [{ timeMs: 100, force: 1000, derived: true, n: 2, measuredN: 1, derivedN: 1 }] });
  assert.ok(!html.includes('试次均值') && !html.includes('最佳试次'));
  assert.ok(html.includes('有效 2 次（1 实测 / 1 推算）'));
  assert.deepEqual(markers(html), [100]);
  finite(html);
});
test('ASR extension starts at the MAS endpoint and ends at MSS on a shared axis that includes VIFT', () => {
  const html = V.speed({ mas: 4, mss: 8, ift: 10 }),
    rect = id => html.match(new RegExp('data-speed-metric="' + id + '"[\\s\\S]*?(<rect[^>]*>)'))[1],
    attr = (markup, name) => Number(markup.match(new RegExp('\\b' + name + '="([^"]+)"'))[1]),
    extension = html.match(/<rect data-asr-extension[^>]*>/)[0],
    masEnd = attr(rect('mas'), 'x') + attr(rect('mas'), 'width'),
    mssEnd = attr(rect('mss'), 'x') + attr(rect('mss'), 'width');
  assert.ok(Math.abs(attr(extension, 'x') - masEnd) < .03);
  assert.ok(Math.abs(attr(extension, 'x') + attr(extension, 'width') - mssEnd) < .03);
  assert.ok(attr(rect('ift'), 'width') > attr(rect('mss'), 'width'));
  assert.match(extension, /stroke-dasharray=/); assert.match(html, /ASR 4\.00 m\/s/);
  finite(html);
});
test('short and zero reserves use readable above-bar labels and inconsistent pairs retain only measured bars', () => {
  const short = V.speed({ mas: 7.99, mss: 8, ift: 5 });
  assert.match(short, /data-asr-placement="above"/); assert.match(short, /ASR 0\.01 m\/s/);
  const zero = V.speed({ mas: 8, mss: 8 });
  assert.match(zero, /ASR 0\.00 m\/s/); assert.doesNotMatch(zero, /data-asr-extension/);
  const negative = V.speed({ mas: 8, mss: 7, ift: 9 });
  assert.equal((negative.match(/data-speed-metric=/g) || []).length, 3);
  assert.doesNotMatch(negative, /data-speed-asr/);
});
test('jump chart uses height bars and RSI dots with separate units and no connecting line', () => {
  const html=V.jumpBars([{id:'cmj',label:'CMJ',value:40},{id:'sj',label:'SJ',value:35},{id:'dj',label:'DJ',value:30,rsi:2},{id:'hop',label:'Hop',value:20,rsi:3},{id:'cmrj',label:'CMRJ',value:28,rsi:2.5}]);
  assert.equal((html.match(/data-jump-series="height"/g)||[]).length,5);
  assert.equal((html.match(/data-jump-series="rsi"/g)||[]).length,3);
  assert.match(html,/垂直跳跃高度 · cm/);assert.match(html,/RSI · m\/s/);assert.match(html,/fill="#7895ad"/);assert.match(html,/fill="#176b68"/);
  assert.doesNotMatch(html,/<path|<polyline|<title/);assert.match(html,/aria-label="DJ · RSI 2 m\/s"/);finite(html);
});
test('jump chart omits missing tests and preserves a measured RSI without a reported height',()=>{
  const html=V.jumpBars([{id:'cmj',label:'CMJ',value:null},{id:'hop',label:'Hop',rsi:2.3}]);
  assert.equal((html.match(/data-jump-series="height"/g)||[]).length,0);assert.equal((html.match(/data-jump-series="rsi"/g)||[]).length,1);
  assert.doesNotMatch(html,/>CMJ</);finite(html);
});
console.log(`${passed} visualization checks passed`);
