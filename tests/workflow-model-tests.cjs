const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const context = vm.createContext({ console, Intl, crypto: require('node:crypto').webcrypto });
context.window = context;
['ringside-calc.js', 'ringside-definitions.js', 'ringside-tests.js', 'ringside-model.js', 'ringside-interventions.js'].forEach(name => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context));
const M = context.RingsideModel, Def = context.Def;
const copy = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function customRecord(name = '专项速度', value = 18) {
  const record = M.defaults();
  record.customTests.push({ id: 'custom_speed', name, category: 'performance' });
  record.enabled.custom_speed = true;
  record.definitions.push({ id: 'metric_speed', testId: 'custom_speed', name: '速度', unit: 'km/h', ability: '速度', category: 'performance', direction: 'higher', target: 18, referenceEnabled: true, ranges: [{ min: 18, max: null, includeMin: true, label: '达到目标', status: 'green' }], protocol: '起始速度 9 km/h' });
  record.customValues.metric_speed = { value, notes: '原始测量' };
  record.protocol.custom_speed = '完成速度 18 km/h';
  return record;
}

test('new assessments start with an empty plan and clean measurement/configuration state', () => {
  const r = M.recordFromCatalog(M.normalizeCatalog(), { name: 'A', sex: '女', sport: '散打', dominantHand: '左手', sportLevel: '专业' }, {}, '2026-10-05');
  assert.ok(Object.values(r.enabled).every(value => value === false));
  assert.equal(r.athlete.sport, '散打'); assert.equal(r.athlete.dominantHand, '左手'); assert.equal(r.athlete.date, '2026-10-05');
  assert.equal(M.stats(r).validTests.size, 0); assert.equal(r.lvp.bench.mvt, ''); assert.equal(r.athlete.mass, ''); assert.equal(M.validateRecord(r), true);
});

test('latest assessment uses the test date and creation order, ignoring update times and invalid dates', () => {
  const a = M.defaults(), b = M.defaults(), c = M.defaults(), d = M.defaults();
  a.athlete.date = '2026-10-04'; a.updated = '2099-01-01'; b.athlete.date = '2026-10-05'; c.athlete.date = '2026-10-05'; d.athlete.date = '2026-99-99';
  assert.equal(M.latestRecord({ records: [a, b, c, d] }).recordId, c.recordId);
  assert.equal(M.latestRecord({ records: [] }), null);
});

test('legacy stance stays historical and is never inferred as a preferred hand', () => {
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/verification-v1-original-demo.json'), 'utf8'));
  const n = M.normalizeRecord(original);
  assert.equal(n.athlete.stance, '右后手'); assert.equal(n.athlete.dominantHand, '未注明'); assert.equal(n.athlete.sport, '');
  assert.equal(n.recordId, original.recordId); assert.equal(n.athleteId, 'legacy_' + original.recordId);
  assert.ok(n.data.cmj.every(row => row.id)); assert.deepEqual(copy(M.normalizeRecord(n)), copy(n));
});

test('legacy library derives profile once and history snapshots never overwrite it', () => {
  const old = M.defaults(), latest = M.defaults(); latest.athleteId = old.athleteId;
  old.athlete.name = '旧姓名'; old.athlete.date = '2026-10-01'; latest.athlete.name = '新姓名'; latest.athlete.date = '2026-10-05'; latest.athlete.sport = '跆拳道'; latest.athlete.dominantHand = '右手';
  const lib = M.libraryDefaults(); delete lib.catalog;
  lib.athletes.push({ id: old.athleteId, name: '档案姓名', sample: false, records: [old, latest] }); lib.activeAthleteId = old.athleteId; lib.activeRecordId = old.recordId;
  const n = M.normalizeLibrary(lib); assert.equal(n.athletes[0].profile.name, '档案姓名'); assert.equal(n.athletes[0].profile.sport, '跆拳道');
  n.activeRecordId = old.recordId; n.athletes[0].records[1].athlete.name = '后来修改的快照';
  const normalized = M.normalizeLibrary(n); assert.equal(normalized.athletes[0].profile.name, '档案姓名'); assert.equal(normalized.athletes[0].records[0].athlete.name, '旧姓名');
  assert.deepEqual(copy(M.normalizeLibrary(normalized)), copy(normalized));
});

test('custom legacy speed is consistently graded before normalization, after reload and after export', () => {
  const r = customRecord(), original = JSON.stringify(r), immediate = M.stats(r);
  near(immediate.values.metric_speed, 5); near(immediate.axes.find(axis => axis.label === '速度').value, 100); assert.equal(immediate.axes.find(axis => axis.label === '速度').defs[0].unit, 'm/s');
  assert.equal(JSON.stringify(r), original);
  const normalized = M.normalizeRecord(r), restored = M.normalizeLibrary(M.recordEnvelope(normalized)).athletes[0].records[0];
  for (const record of [normalized, restored, M.normalizeRecord(restored)]) {
    near(record.customValues.metric_speed.value, 5); near(record.definitions.find(d => d.id === 'metric_speed').target, 5); near(M.stats(record).axes.find(axis => axis.label === '速度').value, 100);
    assert.equal(record.definitions.find(d => d.id === 'metric_speed').unit, 'm/s');
  }
  assert.deepEqual(copy(M.normalizeRecord(normalized)), copy(normalized));
});

test('built-in speed standards preserve exact source bounds and endpoint policies in m/s', () => {
  const ift = Def.builtins.find(d => d.id === 'ift_treadmill'), lt1 = Def.builtins.find(d => d.id === 'lt1');
  assert.equal(ift.unit, 'm/s'); near(ift.target, 23.5 / 3.6); near(ift.ranges[0].max, 19.5 / 3.6); near(ift.ranges[3].min, 23.5 / 3.6);
  near(lt1.ranges[1].min, 12 / 3.6); near(lt1.ranges[1].max, 12 / 3.6);
  const enabled = { ...ift, referenceEnabled: true };
  assert.equal(Def.grade(19.5 / 3.6, enabled).status, 'red'); assert.equal(Def.grade(19.75 / 3.6, enabled).status, 'unclassified'); assert.equal(Def.grade(23.5 / 3.6, enabled).status, 'green');
  assert.ok(!/km\/h/.test(ift.protocol));
});

test('speed migration preserves range inclusion, source text and uncertain manually written units', () => {
  const r = customRecord(); r.definitions.at(-1).ranges = [{ min: 9, max: 18, includeMin: false, includeMax: true, label: '区间', status: 'amber' }];
  r.narrative = { html: '<p><strong>速度</strong> 18 km/h；自定义 km/h 说明</p>', text: '', origin: 'manual' };
  const n = M.normalizeRecord(r), range = n.definitions.at(-1).ranges[0];
  near(range.min, 2.5); near(range.max, 5); assert.equal(range.includeMin, false); assert.equal(range.includeMax, true);
  assert.ok(n.narrative.html.includes('<strong>速度</strong> 5 m/s')); assert.ok(n.narrative.html.includes('自定义 km/h 说明')); assert.equal(n.narrative.migrationReview.required, true);
  assert.equal(n.narrative.legacySpeedHTML, r.narrative.html); assert.deepEqual(copy(M.normalizeRecord(n)), copy(n));
});

test('shared directory supports all athletes while copied snapshots stay independent', () => {
  const source = customRecord(), cat = M.mergeCatalog(M.normalizeCatalog(), source, '测试来源');
  cat.revision = 7; assert.equal(M.normalizeCatalog(cat).revision, 7);
  const a = M.recordFromCatalog(cat, { name: 'A' }, { custom_speed: true }), b = M.recordFromCatalog(cat, { name: 'B' }, { custom_speed: true });
  assert.equal(a.customTests[0].name, '专项速度'); assert.equal(b.customTests[0].id, 'custom_speed'); assert.equal(M.validateCatalog(cat), true);
  cat.definitions.find(d => d.id === 'metric_speed').target = 6;
  near(a.definitions.find(d => d.id === 'metric_speed').target, 5); near(b.definitions.find(d => d.id === 'metric_speed').target, 5);
  assert.equal(a.customValues.metric_speed, undefined); assert.equal(b.customValues.metric_speed, undefined);
});

test('only selected projects acquire catalog snapshots and preferred-hand/profile export is independent of test history', () => {
  const cat = M.mergeCatalog(M.normalizeCatalog(), customRecord()); cat.definitions.find(d => d.id === 'cmj_height').target = 60;
  const first = M.recordFromCatalog(cat, { name: '历史姓名', sport: '拳击', dominantHand: '左手' }, { cmj: true });
  assert.equal(first.customTests.length, 0); assert.ok(!first.definitions.some(d => d.id === 'metric_speed')); assert.deepEqual(copy(first.catalogAppliedTests), ['cmj']);
  assert.equal(first.definitions.find(d => d.id === 'cmj_height').target, 60);
  const currentProfile = { name: '档案姓名', sex: '男', sport: '散打', dominantHand: '右手', sportLevel: '专业' };
  const restored = M.normalizeLibrary(M.recordEnvelope(first, currentProfile, cat));
  assert.equal(restored.athletes[0].profile.name, '档案姓名'); assert.equal(restored.athletes[0].profile.sport, '散打');
  assert.equal(restored.athletes[0].records[0].athlete.name, '历史姓名'); assert.equal(restored.athletes[0].records[0].athlete.dominantHand, '左手');
  assert.ok(restored.catalog.tests.some(test => test.id === 'custom_speed'));
});

test('same-ID conflicting old projects preserve all definitions and block new selection until resolved', () => {
  const first = customRecord(), second = customRecord('专项新定义'); second.definitions.at(-1).target = 21.6;
  let cat = M.mergeCatalog(M.normalizeCatalog(), first, '旧记录一'); cat = M.mergeCatalog(cat, second, '旧记录二'); cat = M.mergeCatalog(cat, second, '旧记录二重复');
  assert.equal(cat.conflicts.length, 1); assert.equal(cat.conflicts[0].variants.length, 2); near(cat.conflicts[0].variants[1].definitions[0].target, 6);
  const record = M.recordFromCatalog(cat, { name: 'C' }, { custom_speed: true }); assert.equal(record.enabled.custom_speed, false); assert.equal(record.customTests.length, 0);
  near(first.definitions.at(-1).target, 18); near(second.definitions.at(-1).target, 21.6); assert.equal(M.validateCatalog(cat), true);
});

test('migrating a legacy library merges its custom catalog but ignores personal builtin settings', () => {
  const r = customRecord(); r.athlete.name = 'A'; r.definitions.find(d => d.id === 'cmj_height').target = 999; r.protocol.cmj = 'A个人协议';
  const lib = M.libraryDefaults(); delete lib.catalog; lib.athletes = [{ id: r.athleteId, name: 'A', records: [r] }];
  const normalized = M.normalizeLibrary(lib);
  assert.ok(normalized.catalog.tests.some(t => t.id === 'custom_speed')); assert.equal(normalized.catalog.definitions.find(d => d.id === 'cmj_height').target, 50); assert.notEqual(normalized.catalog.protocol.cmj, 'A个人协议');
  assert.equal(normalized.athletes[0].records[0].definitions.find(d => d.id === 'cmj_height').target, 999); assert.deepEqual(copy(M.normalizeLibrary(normalized)), copy(normalized));
});

test('input and import share integer and positive-value rules while optional fields allow empty', () => {
  const r = M.defaults();
  assert.match(M.validateField(r, 'data.pushup.reps', '3.5'), /整数/); r.data.pushup.reps = '3.5'; assert.throws(() => M.validateRecord(r), /data.pushup.reps/);
  r.data.pushup.reps = 0; assert.equal(M.validateRecord(r), true); assert.equal(M.stats(r).values.pushup_reps, 0);
  for (const value of [-1, 0, 'not-a-number']) assert.ok(M.validateField(r, 'data.cmj.0.height', value));
  assert.equal(M.validateField(r, 'data.cmj.0.height', ''), ''); assert.equal(M.validateField(r, 'data.cmj.0.height', 43.25), '');
});

test('valid custom zero survives calculations, normalization and library round trips', () => {
  const r = customRecord('零值指标', 0), n = M.normalizeLibrary(r);
  assert.equal(M.stats(r).values.metric_speed, 0); assert.equal(n.athletes[0].records[0].customValues.metric_speed.value, 0); assert.equal(M.stats(n.athletes[0].records[0]).values.metric_speed, 0);
  assert.equal(M.validateField(r, 'customValues.metric_speed.value', 0), '');
});

test('negative IMTP measurements remain saved and are explicitly marked for review', () => {
  const r = M.defaults(); r.data.imtp[0].peakForce = -100;
  assert.equal(M.validateField(r, 'data.imtp.0.peakForce', -100), ''); assert.equal(M.validateRecord(r), true);
  const detail = M.recordProgressDetail(r, 'imtp'); assert.equal(detail.status, 'review'); assert.equal(detail.label, '待核对'); assert.ok(detail.detail.includes('负'));
  assert.equal(r.data.imtp[0].peakForce, -100); assert.equal(M.stats(r).values.imtp_peak_force, undefined);
});

test('bad-rule backups diagnose and repair only explicitly supplied fields without changing raw data', () => {
  const r = M.sampleRecord(); r.rules.asymAmber = ''; r.rules.scoreGreen = 50; const original = JSON.stringify(r);
  const findings = M.diagnoseRules(M.recordEnvelope(r)); assert.ok(findings.some(issue => issue.path === 'rules.asymAmber')); assert.ok(findings.some(issue => issue.path === 'rules.scoreGreen'));
  assert.throws(() => M.validateLibrary(r), /评价阈值/); assert.equal(M.validateLibrary(r, { skipRules: true }), true);
  const repaired = M.repairRules(r, { [r.recordId]: { asymAmber: 10, scoreGreen: 100 } }); assert.equal(M.validateLibrary(repaired), true); assert.equal(JSON.stringify(r), original);
  assert.deepEqual(copy(repaired.data), copy(r.data)); assert.equal(repaired.recordId, r.recordId); assert.equal(repaired.updated, r.updated);
  assert.throws(() => M.repairRules(r, { [r.recordId]: { asymAmber: 10 } }), /评价阈值/);
  const missing = copy(r); delete missing.rules; assert.equal(M.diagnoseRules(missing).length, 5); assert.deepEqual(copy(M.normalizeRecord(missing).rules), {});
});

test('progress conveys measured sides, directions, stages and actions without claiming completion', () => {
  const r = M.defaults(); r.data.mb[0].distance = 12; r.data.iso[0].center = 100; r.data.fms[1].left = 2; r.data.lactate[0] = { id: 'stage', speed: 3, lactate: 2, hr: 140 };
  const s = M.stats(r);
  assert.equal(s.progress.details.mb.label, '已有有效结果'); assert.ok(s.progress.details.mb.detail.includes('非优势侧未录入'));
  assert.ok(s.progress.details.iso.detail.includes('方向 1/')); assert.ok(s.progress.details.iso.detail.includes('中线 1'));
  assert.equal(s.progress.details.fms.label, '待核对'); assert.ok(s.progress.details.fms.detail.includes('仅录入一侧')); assert.ok(s.progress.details.lactate.detail.includes('有效阶段 1/1'));
  assert.ok(!Object.values(s.progress.details).some(detail => /已完成/.test(detail.label)));
});

test('disabled measurements are kept intact and stop affecting reports until selected again', () => {
  const r = M.defaults(); r.data.cmj[0].height = 43.25; const saved = JSON.stringify(r.data.cmj); r.enabled.cmj = false;
  assert.equal(M.stats(r).values.cmj_height, undefined); assert.equal(JSON.stringify(r.data.cmj), saved);
  r.enabled.cmj = true; near(M.stats(r).values.cmj_height, 43.25);
});

test('sport background changes advice assumptions without replacing measurement standards', () => {
  const r = M.defaults(); r.athlete.sport = '跆拳道'; r.data.mb[0].distance = 5;
  r.definitions.find(d => d.id === 'mb_dom').referenceEnabled = true;
  const before = JSON.stringify(r.definitions), text = M.localText(r);
  assert.ok(text.includes('站姿快速转髋与推臂') && text.includes('徒手') && text.includes('3组 × 4–6次'));
  assert.ok(!text.includes('结合拳击站架')); assert.equal(JSON.stringify(r.definitions), before);
  r.athlete.sport = '拳击'; assert.ok(M.localText(r).includes('结合拳击站架'));
});

console.log(`${passed} workflow model checks passed`);
