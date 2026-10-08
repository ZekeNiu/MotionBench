const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('node:assert/strict');
const context = vm.createContext({ console, Intl, crypto: require('node:crypto').webcrypto });
context.window = context;
for (const name of ['ringside-calc.js', 'ringside-fvp.js', 'ringside-cpet-reference.js', 'ringside-definitions.js', 'ringside-tests.js', 'ringside-model.js', 'ringside-interventions.js']) {
  const filename = path.join(__dirname, '../src', name);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
}
const M = context.RingsideModel;
const copy = x => JSON.parse(JSON.stringify(x));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
const record = rows => { const r = M.defaults(); r.data.imtp = rows; return r; };

test('legacy time points migrate once, preserve values, and keep schema2', () => {
  const r = record([{ id: 'trial', peakForce: 3000, f100: 1000, f200: '', rfd100: 7000, rfd200: 8000 }]);
  const before = JSON.stringify(r), n = M.normalizeRecord(r);
  assert.equal(n.schema, 2); assert.equal(JSON.stringify(r), before);
  assert.deepEqual(copy(n.data.imtp[0].timePoints).map(p => [p.timeMs, p.force, p.rfd]), [[100, 1000, 7000], [200, '', 8000]]);
  assert.deepEqual(copy(M.normalizeRecord(n)), copy(n));
  n.data.imtp[0].timePoints = []; M.syncIMTPLegacy(n.data.imtp[0]);
  assert.equal(n.data.imtp[0].f100, ''); assert.equal(n.data.imtp[0].rfd200, '');
  assert.equal(M.normalizeRecord(n).data.imtp[0].timePoints.length, 0);
});
test('best uses one complete peak-selected trial and ties retain the first', () => {
  const r = record([{ peakForce: 2000, baselineForce: 500, peakTimeMs: 400, timePoints: [{ timeMs: 100, force: 1500 }] }, { peakForce: 3000, baselineForce: 600, peakTimeMs: 500, timePoints: [{ timeMs: 200, force: 1800 }] }, { peakForce: 3000, timePoints: [{ timeMs: 100, force: 2500 }] }]);
  const f = M.forceTime(r); assert.equal(f.selectedIndex, 1); assert.equal(f.n, 3);
  assert.deepEqual(copy(f.points).map(p => p.timeMs), [200]); near(f.baselineForce, 600); near(f.peakTimeMs, 500);
});
test('zero baseline is explicit; missing baseline never becomes zero', () => {
  const r = record([{ peakForce: 3000, timePoints: [{ timeMs: 100, rfd: 9000 }] }]);
  let f = M.forceTime(r); assert.equal(f.points.length, 0); assert.equal(f.baselineForce, null); assert.ok(f.issues.some(x => x.id.startsWith('imtp_baseline_missing')));
  r.data.imtp[0].baselineForce = 0; f = M.forceTime(r); near(f.points[0].force, 900); assert.equal(f.points[0].derived, true);
  assert.equal(r.data.imtp[0].timePoints[0].force, undefined);
});
test('mean converts within each trial, pools only matching times, and carries n', () => {
  const r = record([{ peakForce: 3000, baselineForce: 500, peakTimeMs: 400, timePoints: [{ timeMs: 100, rfd: 10000 }, { timeMs: 200, force: 2200 }] }, { peakForce: 4000, baselineForce: 900, peakTimeMs: 600, timePoints: [{ timeMs: 100, force: 2100 }] }, { peakForce: '', baselineForce: 0, timePoints: [{ timeMs: 100, force: 10000 }] }]);
  r.mode = 'mean'; const f = M.forceTime(r); near(f.peakForce, 3500); near(f.baselineForce, 700); assert.equal(f.peakTimeMs, null);
  near(f.points[0].force, 1800); assert.equal(f.points[0].n, 2); assert.equal(f.points[0].measuredN, 1); assert.equal(f.points[0].derivedN, 1);
  near(f.points[1].force, 2200); assert.equal(f.points[1].n, 1);
  r.data.imtp[1].baselineForce = ''; assert.equal(M.forceTime(r).baselineForce, null);
});
test('negative legacy values stay raw and cannot contaminate field means or curves', () => {
  const r = record([{ peakForce: 2000, f100: -900, rfd100: -8000 }, { peakForce: 3000, f100: 1100, rfd100: 6000 }]);
  r.mode = 'mean'; const before = JSON.stringify(r), s = M.stats(r);
  near(s.values.imtp_f100, 1100); near(s.values.imtp_rfd100, 6000); near(s.raw.forceTime.points[0].force, 1100);
  assert.equal(s.raw.forceTime.points[0].n, 1); assert.ok(s.qualityIssues.some(x => x.id.startsWith('imtp_negative_force')));
  assert.equal(JSON.stringify(r), before); assert.equal(M.validateRecord(r), true);
});
test('force/RFD disagreement retains actual force and surfaces the mismatch', () => {
  const r = record([{ peakForce: 3000, baselineForce: 500, peakTimeMs: 100, timePoints: [{ timeMs: 100, force: 1500, rfd: 2000 }] }]);
  const before = JSON.stringify(r), f = M.forceTime(r); near(f.points[0].force, 1500); assert.equal(f.points[0].derived, false);
  assert.ok(f.issues.some(x => x.id.startsWith('imtp_force_rfd_conflict'))); assert.ok(f.issues.some(x => x.id.startsWith('imtp_peak_time_conflict')));
  assert.equal(f.peakTimeMs, null); assert.equal(JSON.stringify(r), before);
});
test('single measured point and unknown peak time do not acquire artificial samples', () => {
  const f = M.forceTime(record([{ peakForce: 3000, timePoints: [{ timeMs: 75, force: 500 }] }]));
  assert.equal(f.points.length, 1); assert.equal(f.points[0].timeMs, 75); assert.equal(f.peakTimeMs, null); assert.equal(f.baselineForce, null);
});
test('finite extreme inputs cannot leak infinity into force-time output', () => {
  const r = record([{ peakForce: 1e308, baselineForce: 0, timePoints: [{ timeMs: 1000, rfd: 1e308 }] }, { peakForce: 1e308, baselineForce: 0, timePoints: [{ timeMs: 1000, force: 1e308 }, { timeMs: 1e308, rfd: 1e308 }] }]);
  r.mode = 'mean'; const f = M.forceTime(r); assert.ok(Number.isFinite(f.peakForce)); assert.ok(Number.isFinite(f.points[0].force));
  assert.equal(f.points.length, 1); assert.ok(f.issues.some(x => x.id.startsWith('imtp_conversion_overflow')));
});
test('time-point structural validation rejects malformed or duplicate entries', () => {
  const cases = [null, 'bad', [{ timeMs: 0 }], [{ timeMs: -10 }], [{ timeMs: 'bad' }], [{ timeMs: 100, force: true }], [{ timeMs: 100 }, { timeMs: '100' }], [{ id: 'same', timeMs: 100 }, { id: 'same', timeMs: 200 }], [null]];
  cases.forEach(timePoints => assert.throws(() => M.validateRecord(record([{ peakForce: 3000, timePoints }]))));
  assert.throws(() => M.validateRecord(record([null])));
  assert.equal(M.validateRecord(record([{ peakForce: 3000, timePoints: [{ id: 'draft', timeMs: '', force: '', rfd: '' }] }])), true);
});
test('optional force data participates in fingerprints, import and envelopes', () => {
  const r = record([{ id: 'trial', peakForce: 3000, timePoints: [{ id: 'point', timeMs: 100, force: 1500 }] }]), before = M.fingerprint(r);
  r.data.imtp[0].baselineForce = 500; assert.notEqual(M.fingerprint(r), before);
  const n = M.normalizeLibrary(M.recordEnvelope(r)).athletes[0].records[0];
  assert.deepEqual(copy(n.data.imtp), copy(M.normalizeRecord(r).data.imtp));
  r.enabled.imtp = false; assert.equal(M.forceTime(r).points.length, 0);
});
test('local guidance gives side-specific actions without retest filler or editing manual text', () => {
  const r = M.defaults(), er = r.data.iso.find(x => x.region === 'shoulder' && x.directionCode === 'externalRotation');
  Object.assign(er, { left: 100, right: 150, target: 150 }); r.data.fms[0].score = 2;
  r.narrative = { ...r.narrative, text: '人工正文', html: '<p>人工正文</p>' };
  const before = JSON.stringify(r), text = M.localText(r);
  assert.ok(text.includes('【主要发现】') && text.includes('【训练优先级】') && text.includes('【执行建议】'));
  assert.ok(text.includes('肩外旋自我阻力等长（左侧）') && text.includes('RPE 6–7') && text.includes('每次10秒')); 
  assert.ok(text.includes('扶持深蹲') && text.includes('无代偿完成原测试动作')); assert.ok(!text.includes('复测'));
  assert.equal(JSON.stringify(r), before);
});
test('pain is handled before loading and conflicting IMTP values do not drive training', () => {
  const r = record([{ peakForce: 1500, baselineForce: 0, timePoints: [{ timeMs: 100, force: 500, rfd: 1000 }] }]);
  const er = r.data.iso.find(x => x.region === 'shoulder' && x.directionCode === 'externalRotation');
  Object.assign(er, { left: 100, right: 150, painLeft: true });
  r.definitions.find(d => d.id === 'imtp_f100').target = 1000;
  const text = M.localText(r); assert.ok(text.indexOf('**先处理疼痛**') >= 0); assert.ok(text.indexOf('**先处理疼痛**') < text.indexOf('**先核对测量**'));
  assert.ok(!text.includes('肩外旋自我阻力等长')); assert.ok(text.includes('IMTP 测量待核对'));
  assert.ok(!text.includes('安排快速建立力的等长拉力'));
});
test('a complete assessment keeps bounded findings and at most three training priorities', () => {
  const r = M.sampleRecord();
  r.data.iso.find(x => x.region === 'neck' && x.directionCode === 'flexion').painCenter = true;
  r.data.mss.speed = 4; r.data.mas.speed = 5;
  const text = M.localText(r), overview = text.split('【训练优先级】')[0];
  const findings = overview.split('\n').filter(line => line.startsWith('• '));
  assert.ok(findings.length >= 3 && findings.length <= 5, `got ${findings.length} findings`);
  assert.equal(overview.split('动作质量：').length - 1, 1);
  assert.ok(overview.includes('活动度与控制练习') && overview.includes('评分本身不能确定具体受限原因'));
  assert.ok((text.match(/^\*\*.+\*\*$/gm) || []).length <= 3); assert.ok(text.includes('**先处理疼痛**'));
  assert.ok(overview.includes('暂停ASR训练建议'));
});
test('ungraded force measurements do not become an invented training deficit or advantage', () => {
  const r = record([{ peakForce: 1500, timePoints: [{ timeMs: 100, force: 500 }] }]);
  r.definitions.forEach(d => { d.target = ''; d.referenceEnabled = false; });
  const before = JSON.stringify(r), text = M.localText(r), overview = text.split('【训练优先级】')[0];
  assert.ok(overview.includes('尚不能据此确认优势或训练不足'));
  assert.ok(!overview.includes('需要加强') && !overview.includes('主要表现短板'));
  assert.equal(JSON.stringify(r), before);
});
test('negative entry warnings survive missing peaks and unfinished time-point drafts', () => {
  const r = record([{ id: 'trial', peakForce: '', baselineForce: -500, timePoints: [{ id: 'draft', timeMs: '', force: -900, rfd: -8000 }, { id: 'known', timeMs: 100, force: -1000, rfd: -9000 }] }]);
  const before = JSON.stringify(r), f = M.forceTime(r);
  assert.equal(M.validateRecord(r), true); assert.equal(f.n, 0);
  assert.equal(f.peakForce, null); assert.equal(f.baselineForce, null); assert.equal(f.points.length, 0);
  assert.equal(f.issues.filter(x => x.id.startsWith('imtp_negative_force')).length, 2);
  assert.equal(f.issues.filter(x => x.id.startsWith('imtp_negative_rfd')).length, 2);
  assert.equal(f.issues.filter(x => x.id.startsWith('imtp_negative_baseline')).length, 1);
  assert.equal(new Set(f.issues.map(x => x.id)).size, f.issues.length);
  assert.ok(f.issues.some(x => x.message.includes('第 1 个时间点')));
  assert.equal(JSON.stringify(r), before);
  const imported = M.normalizeLibrary(M.recordEnvelope(r)).athletes[0].records[0];
  assert.equal(imported.data.imtp[0].baselineForce, -500); assert.equal(imported.data.imtp[0].timePoints[0].rfd, -8000);
});
console.log(`${passed} force-time checks passed`);
