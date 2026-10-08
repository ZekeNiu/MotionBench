const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({ console, Intl, crypto: require('node:crypto').webcrypto });
context.window = context;
['ringside-calc.js','ringside-fvp.js','ringside-sources.js','ringside-cpet-reference.js','ringside-definitions.js','ringside-tests.js','ringside-model.js'].forEach(name => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context, { filename: name });
});
const F = context.RingsideFVP, M = context.RingsideModel, T = context.RingsideTests;
const json = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, eps = 1e-8) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function fixture() {
  const r = M.defaults(); r.athlete.mass = 72; r.enabled.fvp_sj = true;
  Object.assign(r.fvpConfig.fvp_sj, { distanceCm: 33, device: '测试设备', method: '腾空时间法', posture: '双手叉腰，静止起跳', distanceSource: '髋高差实测' });
  r.data.fvp_sj = [0,20,40,60,80].map((load,i) => ({ id:'sj_'+i, load, height:[33,27,22,14,10][i], notes:'', excluded:false, exclusionReason:'' }));
  return r;
}

// Cached values from the user's Jump FVP 介绍.xlsx, FVP profile L7:L16/T7:T16.
// This is an independent workbook oracle, not a second copy of solver formulas.
test('supplied Morin workbook matches F0/V0/Pmax/slope/R2 and both optima', () => {
  const s = F.solve(fixture(), 'fvp_sj'); assert.equal(s.valid, true);
  near(s.model.F0, 35.51562707103644); near(s.model.F0Absolute,2557.1251491146236);
  near(s.model.V0,3.102485546552089); near(s.model.Pmax,27.546679916156165);
  near(s.model.PmaxAbsolute,1983.360953963244); near(s.model.slope,-11.447475431595906);
  near(s.model.r2,.8337687355242547); near(s.optimum.slope,-15.439627701317727);
  near(s.comparison.slope,-12.338403094137057); near(s.imbalance.ratio,.7414346804890184);
  near(s.imbalancePct,25.85653195109816); assert.equal(s.direction,'force');
  near(s.current.heightCm,35.591502767319483); near(s.optimum.heightCm,36.3741980458947);
  near(s.potentialGainPct,2.199107139960099); assert.ok(s.potentialGainPct < s.imbalancePct);
});

// Independently cached author 2022 workbook, https://jbmorin.net/wp-content/uploads/2022/01/jump-fvp-profile-copie.xlsx.
test('official Morin 2022 workbook selects best load attempts and matches cached outputs', () => {
  const r = fixture(); r.athlete.mass=70; r.fvpConfig.fvp_sj.distanceCm=28;
  r.data.fvp_sj = [[0,27.57],[0,25.67],[20,19.17],[20,17.59],[40,12.26],[40,13.25],[50,''],[50,11.3]].map(([load,height],i)=>({id:'official_'+i,load,height}));
  const s=F.solve(r,'fvp_sj'); near(s.model.F0,30.628749646888295); near(s.model.V0,3.179368978679242);
  near(s.model.Pmax,24.345024120762357); near(s.model.slope,-9.633593915108257);
  near(s.optimum.slope,-16.74847138288449); near(s.model.r2,.9950909176513449);
  assert.equal(s.points.length,4); assert.deepEqual(json(s.groups.map(g=>g.selectedIds[0])),['official_0','official_2','official_5','official_7']);
});

test('30-degree target changes optimum and direction while measured curve and vertical scenarios stay invariant', () => {
  const r=fixture(), a=F.solve(r,'fvp_sj'); r.fvpAnalysis.fvp_sj.angle=30; const b=F.solve(r,'fvp_sj');
  near(b.optimum.slope,-12.338403094137057); near(b.optimum.F0,36.87178003355435); near(b.optimum.V0,2.988375379879997);
  near(b.imbalance.ratio,.927792303773533); assert.equal(b.optimum.heightCm,null); assert.equal(b.potentialGainPct,null);
  assert.deepEqual(json(a.model),json(b.model)); assert.deepEqual(json(a.current),json(b.current));
  assert.deepEqual(json(a.elasticity),json(b.elasticity)); assert.deepEqual(json(a.scenario),json(b.scenario)); assert.deepEqual(json(a.sensitivity),json(b.sensitivity));
});

test('PV uses the same FV curve and the same fixed-power optimum peak', () => {
  const s=F.solve(fixture(),'fvp_sj'), model=s.model;
  near(F.powerAt(model, model.V0/2),model.Pmax); near(F.forceAt(model, model.V0),0);
  near(F.powerAt(s.optimum,s.optimum.V0/2),model.Pmax); near(F.powerAt(s.comparison,s.comparison.V0/2),model.Pmax);
  const c=F.curve(model); assert.equal(c.length,81); near(c[40].power,model.Pmax);
});

test('distinct loads determine regression df; repeated attempts remain descriptive statistics', () => {
  const r=fixture(); r.data.fvp_sj.push({id:'lower0',load:0,height:31},{id:'lower1',load:0,height:32});
  const s=F.solve(r,'fvp_sj'); assert.equal(s.fit.n,5); assert.equal(s.groups[0].n,3);
  near(s.groups[0].mean,32); near(s.groups[0].sd,1); near(s.groups[0].cv,3.125);
  assert.deepEqual(json(s.groups[0].selectedIds),['sj_0']); near(s.model.F0,35.51562707103644);
});

test('per-load best selection remains explicit when the global report mode is mean', () => {
  const r=fixture(); r.data.fvp_sj.push({id:'lower',load:0,height:10}); r.mode='mean';
  near(F.solve(r,'fvp_sj').points[0].height,33);
});

test('excluded trial stays in raw review and cannot influence selected points or fit', () => {
  const r=fixture(); r.data.fvp_sj.push({id:'excluded',load:0,height:100,excluded:true,exclusionReason:'动作不合格'});
  const s=F.solve(r,'fvp_sj'); assert.equal(s.trials.length,6); assert.equal(s.trials.at(-1).eligible,false);
  assert.equal(s.trials.at(-1).exclusionReason,'动作不合格'); near(s.points[0].height,33); near(s.model.F0,35.51562707103644);
});

test('selected unloaded trial distance overrides shared distance as reference posture', () => {
  const r=fixture(); r.data.fvp_sj[0].distanceCm=40;
  const s=F.solve(r,'fvp_sj'); assert.equal(s.model.distanceCm,40); assert.equal(s.model.distanceBasis,'0 kg 代表试次推进距离');
  near(s.points[0].forceRelative,9.81*(1+.33/.4)); assert.equal(s.points[1].distanceCm,33);
});

test('only blank optional trial distance can use the shared value; explicit invalid distance is excluded', () => {
  for (const value of [0,-1,'不可用']) {
    const r=fixture(); r.data.fvp_sj[0].distanceCm=value; const s=F.solve(r,'fvp_sj');
    assert.equal(s.trials[0].eligible,false); assert.equal(s.trials[0].distanceCm,null);
    assert.equal(s.points.some(point=>point.load===0),false); assert.match(s.trials[0].reason,/正推进距离/);
    assert.equal(s.issues.some(issue=>issue.id==='fvp_trial_0'),true); assert.equal(r.data.fvp_sj[0].distanceCm,value);
  }
  for (const value of ['',null,undefined]) {
    const r=fixture(); r.data.fvp_sj[0].distanceCm=value; const s=F.solve(r,'fvp_sj');
    assert.equal(s.trials[0].eligible,true); assert.equal(s.points[0].distanceCm,33);
  }
});

test('without unloaded data explicit default distance is required for target and elasticity', () => {
  const r=fixture(); r.data.fvp_sj=r.data.fvp_sj.slice(1).map(row=>({...row,distanceCm:33})); r.fvpConfig.fvp_sj.distanceCm='';
  let s=F.solve(r,'fvp_sj'); assert.equal(s.valid,false); assert.equal(s.optimum,null); assert.match(s.reason,/共同推进距离/);
  r.fvpConfig.fvp_sj.distanceCm=33; s=F.solve(r,'fvp_sj'); assert.equal(s.valid,true); assert.equal(s.model.distanceBasis,'共同推进距离');
});

test('CI matches independent OLS mean confidence interval workbook fixture', () => {
  const s=F.solve(fixture(),'fvp_sj'), ci=s.ci(s.fit.meanX);
  near(s.fit.sse,5.682468424070101); near(s.fit.s,1.3762834524024112);
  near(ci.low,22.130227622686817); near(ci.high,26.047772377313194);
  near(ci.powerLow,22.08992363011676); near(ci.powerHigh,26.000333677528403);
  assert.equal(s.ci(0),null); assert.equal(s.ci(0,false).extrapolated,true);
});

test('three distinct loads use residual df=1 and the Student t tail', () => {
  const r=fixture(); r.data.fvp_sj=r.data.fvp_sj.slice(0,3); const s=F.solve(r,'fvp_sj');
  assert.equal(s.valid,true); assert.equal(s.fit.n,3); near(s.fit.tcrit,12.7062047361747);
  const ci=s.ci(s.fit.meanX), expectedHalf=12.7062047361747*s.fit.s/Math.sqrt(3);
  near((ci.high-ci.low)/2,expectedHalf);
});

test('two loads, identical velocities, nonnegative slope and invalid F0 cannot become valid profiles', () => {
  const r=fixture(); r.data.fvp_sj=r.data.fvp_sj.slice(0,2); let s=F.solve(r,'fvp_sj'); assert.equal(s.valid,false); assert.equal(s.ci(1),null);
  r.data.fvp_sj=[0,20,40].map((load,i)=>({id:'flat_'+i,load,height:20})); assert.equal(F.solve(r,'fvp_sj').valid,false);
  assert.equal(F.regression([{velocity:1,forceRelative:20},{velocity:2,forceRelative:30},{velocity:3,forceRelative:40}]).valid,false);
  assert.equal(F.performance(9,3,.3).valid,false); assert.equal(F.elasticity(9,3,.3),null);
});

test('unfinished native FVP enters progress as partial while configuration alone stays unmeasured', () => {
  const r=fixture(); r.data.fvp_sj=r.data.fvp_sj.slice(0,2); const stats=M.stats(r);
  assert.equal(stats.progress.partial.some(item=>item.id==='fvp_sj'),true);
  assert.equal(stats.progress.details.fvp_sj.status,'review'); assert.match(stats.progress.details.fvp_sj.detail,/2 个不同负荷/);
  r.data.fvp_sj=[]; const empty=M.stats(r); assert.equal(empty.progress.partial.some(item=>item.id==='fvp_sj'),false);
  assert.equal(empty.progress.details.fvp_sj.status,'empty');
});

test('finite entries whose derived arithmetic overflows remain raw and cannot create nonfinite points', () => {
  const r=fixture(); r.data.fvp_sj.push({id:'overflow',load:1e308,height:33,distanceCm:1e-300});
  const stats=F.solve(r,'fvp_sj'); assert.equal(stats.valid,true); assert.equal(stats.trials.at(-1).valid,false);
  assert.match(stats.trials.at(-1).reason,/数值范围/); assert.equal(stats.points.length,5);
  assert.equal(stats.points.every(p=>Number.isFinite(p.forceRelative)&&Number.isFinite(p.powerRelative)),true);
  assert.equal(r.data.fvp_sj.at(-1).load,1e308);
});

test('zero residual CI is valid and does not acquire an invented width', () => {
  const fit=F.regression([{velocity:1,forceRelative:30},{velocity:2,forceRelative:20},{velocity:3,forceRelative:10}]);
  assert.equal(fit.valid,true); assert.equal(fit.s,0); const ci=F.confidence(fit,2); assert.equal(ci.low,ci.high); assert.equal(ci.low,20);
});

test('elasticity is independently checked by symmetric log derivatives of vertical predicted height', () => {
  for(const [f,v,d] of [[35.51562707103644,3.102485546552089,.33],[25,5,.4],[60,2,.25]]) {
    const e=F.elasticity(f,v,d), step=1e-5;
    const force=(Math.log(F.performance(f*Math.exp(step),v,d).heightCm)-Math.log(F.performance(f*Math.exp(-step),v,d).heightCm))/(2*step);
    const velocity=(Math.log(F.performance(f,v*Math.exp(step),d).heightCm)-Math.log(F.performance(f,v*Math.exp(-step),d).heightCm))/(2*step);
    near(e.Fe,force); near(e.ve,velocity); near(e.ER,force/velocity); near(e.EN,Math.hypot(force,velocity));
  }
});

test('Li velocity reparameterization leaves jump height and same-power optimum ratio invariant', () => {
  const s=F.solve(fixture(),'fvp_sj'), scale=.77/.5;
  near(F.performance(s.model.F0,s.model.V0*scale,.33,.77).heightCm,s.current.heightCm);
  const opt=F.optimum(s.model.Pmax*scale,.33,90,.77);
  near(opt.F0,s.optimum.F0); near(opt.V0,s.optimum.V0*scale);
  near((s.model.slope/scale)/opt.slope,s.imbalance.ratio);
});

test('combined scenario responds to independent end changes without requiring fixed power', () => {
  const r=fixture(); r.fvpAnalysis.fvp_sj.deltaForcePct=10; r.fvpAnalysis.fvp_sj.deltaVelocityPct=5;
  const s=F.solve(r,'fvp_sj'), n=s.scenario;
  near(n.Pmax,s.model.Pmax*1.1*1.05); assert.ok(n.heightCm>s.current.heightCm);
  near(n.deltaCm,n.heightCm-s.current.heightCm); near(n.deltaPct,(n.heightCm/s.current.heightCm-1)*100);
  assert.match(n.elasticity.judgments.EN,/情景后整体敏感度/);
  assert.equal(F.scenario(s.model,.33,-90,0).valid,false);
});

test('direction is continuous with tolerant equality and has no five-band categories', () => {
  assert.equal(F.imbalance(-10,-10).direction,'balanced'); assert.equal(F.imbalance(-10*(1+1e-10),-10).direction,'balanced');
  assert.equal(F.imbalance(-6,-10).direction,'force'); assert.equal(F.imbalance(-14,-10).direction,'velocity');
  assert.equal(F.imbalance(-14,-10).className,undefined); assert.equal(F.solve(fixture(),'fvp_sj').judgments.F0,undefined);
});

test('protocols are separate, default disabled and computed parameters cannot create radar scores', () => {
  const r=fixture(); assert.equal(r.enabled.fvp_cmj,false); assert.deepEqual(json(r.data.fvp_cmj),[]);
  r.definitions.filter(d=>d.testId==='fvp_sj').forEach(d=>{d.referenceEnabled=true;d.target=1;});
  const stats=M.stats(r); assert.equal(stats.fvp.fvp_sj.valid,true); assert.equal(stats.fvp.fvp_cmj.valid,false);
  assert.equal(stats.validTests.has('fvp_sj'),true); assert.equal(stats.axes.some(a=>a.key===T.analysisLabel),false);
  near(stats.values.fvp_sj_f0,35.51562707103644); assert.equal(T.registry.get('fvp_sj').renderer,'fvp');
  assert.equal(T.derivedDefinitions().every(d=>d.ability===T.analysisLabel),true);
  assert.equal(T.abilityGroups(M.defaults()).some(group=>group.key===T.analysisLabel),false);
  assert.equal(r.definitions.filter(d=>d.testId.startsWith('fvp_')).every(d=>d.ability==='爆发力'&&d.scoring===false),true);
});

test('config alone never counts as measurement and raw arrays survive normalization', () => {
  const r=M.defaults(); r.enabled.fvp_sj=true; r.athlete.mass=72; r.fvpConfig.fvp_sj.distanceCm=33;
  let stats=M.stats(r); assert.equal(stats.validTests.has('fvp_sj'),false); assert.equal(stats.fvp.fvp_sj.status,'empty');
  const f=fixture(), n=M.normalizeRecord(f); assert.deepEqual(json(M.normalizeRecord(n)),json(n));
  assert.equal(M.validateRecord(n),true); assert.deepEqual(json(n.data.fvp_sj.map(t=>t.height)),[33,27,22,14,10]);
});

test('fingerprint includes measurements/config/scenario and excludes all chart display state', () => {
  const r=fixture(), base=M.fingerprint(r);
  r.fvpView.fvp_sj.fv=false; r.fvpView.fvp_sj.pinnedLoad=20; r.views.fvpProtocol='fvp_cmj'; assert.equal(M.fingerprint(r),base);
  r.fvpAnalysis.fvp_sj.angle=30; assert.notEqual(M.fingerprint(r),base); r.fvpAnalysis.fvp_sj.angle=90;
  r.fvpAnalysis.fvp_sj.deltaForcePct=2; assert.notEqual(M.fingerprint(r),base); r.fvpAnalysis.fvp_sj.deltaForcePct=0;
  r.fvpConfig.fvp_sj.device='另一设备'; assert.notEqual(M.fingerprint(r),base);
});

test('empty additive FVP defaults do not invalidate a historical narrative fingerprint', () => {
  const r=M.defaults(), legacy=json(r); delete legacy.fvpVersion; delete legacy.fvpConfig; delete legacy.fvpAnalysis; delete legacy.fvpView;
  ['fvp_sj','fvp_cmj'].forEach(id=>{delete legacy.enabled[id];delete legacy.data[id];delete legacy.protocol[id];});
  legacy.definitions=legacy.definitions.filter(d=>!d.testId.startsWith('fvp_'));
  assert.equal(M.fingerprint(legacy),M.fingerprint(r));
});

test('historical custom project and parameter ID collisions stay manual with original data', () => {
  const r=M.defaults(); delete r.fvpVersion; r.customTests=[{id:'fvp_sj',name:'历史自定义测试',category:'performance'}];
  r.data.fvp_sj={value:'原始自定义数据'}; r.definitions=r.definitions.filter(d=>d.testId!=='fvp_sj');
  r.definitions.push({id:'fvp_sj_f0',testId:'fvp_sj',name:'历史自定义指标',unit:'分',ability:'历史能力',category:'performance',direction:'higher',ranges:[],target:null,referenceEnabled:false});
  const n=M.normalizeRecord(r); assert.equal(T.isNative(n,'fvp_sj'),false); assert.equal(M.fvpAnalysis(n,'fvp_sj'),null);
  assert.equal(n.definitions.find(d=>d.id==='fvp_sj_f0').legacyManual,true); assert.deepEqual(json(n.data.fvp_sj),{value:'原始自定义数据'});
  assert.equal(M.validateField(n,'data.fvp_sj.0.height',-1),'');
});

test('native validation rejects invalid storage but permits arbitrary finite positive scenario gains', () => {
  const r=fixture(); r.fvpAnalysis.fvp_sj.deltaForcePct=50; assert.equal(M.validateRecord(r),true);
  r.fvpAnalysis.fvp_sj.deltaForcePct=-100; assert.throws(()=>M.validateRecord(r),/−100/); r.fvpAnalysis.fvp_sj.deltaForcePct=0;
  r.data.fvp_sj[0].height=0; assert.throws(()=>M.validateRecord(r),/大于 0/); r.data.fvp_sj[0].height=33;
  r.data.fvp_sj[1].id='sj_0'; assert.throws(()=>M.validateRecord(r),/重复/);
});

test('fresh catalogs keep FVP parameters computed and old colliding snapshots remain custom', () => {
  const c=M.libraryDefaults().catalog, normalized=M.normalizeCatalog(c);
  assert.equal(normalized.definitions.filter(d=>d.testId.startsWith('fvp_')).some(d=>d.legacyManual),false);
  const old=json(c); delete old.fvpVersion; old.tests.find(t=>t.id==='fvp_sj').measurementVersion=undefined;
  const n=M.normalizeCatalog(old); assert.equal(n.tests.find(t=>t.id==='fvp_sj').legacyCustom,true);
});
console.log(`${passed} FVP model checks passed`);
