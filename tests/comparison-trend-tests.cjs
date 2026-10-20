"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {context,createFixture}=require('./helpers/longitudinal-fixture.cjs'),c=context();
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ringside-longitudinal-view.js'),'utf8'),c);
const L=c.RingsideLongitudinal,V=c.RingsideLongitudinalView;
const metric=(m,id)=>m.projects.flatMap(p=>p.metrics).find(r=>r.id===id);
let passed=0,failed=0;
function test(name,run){try{run();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
test('real uncovered reference interval has a measured result and no evaluation pill',()=>{
 const f=createFixture(c,3);f.records.forEach(r=>r.data.cmj.forEach(t=>t.height=37));
 const m=L.build(f.records,f),r=metric(m,'cmj_height');assert.equal(r.cells[0].evaluation.grade.label,'未分级');assert.equal(r.cells[0].value,37);
 assert.doesNotMatch(V.table([r],m.periods,{wrapped:false}),/class="pill [^"]*longitudinal-assessment/);
});
test('real isometric observation with neither target nor warning has no measured-only pill',()=>{
 const f=createFixture(c,3),rule=f.profile.standards.find(r=>r.directionId==='iso_neck_flexion');rule.enabled=false;rule.reference.enabled=false;
 const m=L.build(f.records,f),r=metric(m,'iso:iso_neck_flexion:C');assert.ok(r.cells[0].value>0);assert.equal(r.cells[0].evaluation.grade.label,'已测');
 assert.doesNotMatch(V.table([r],m.periods,{wrapped:false}),/class="pill [^"]*longitudinal-assessment/);
});
test('genuinely matched custom gray grade is retained',()=>{
 const f=createFixture(c,3),rule=f.profile.standards.find(r=>r.metricId==='cmj_height');rule.ranges=[{min:0,max:100,includeMin:true,includeMax:true,label:'自定观察区',status:'gray'}];
 const m=L.build(f.records,f),r=metric(m,'cmj_height');assert.ok(r.cells[0].evaluation.grade.range);
 assert.match(V.table([r],m.periods,{wrapped:false}),/class="pill gray longitudinal-assessment"[^>]*>[\s\S]*?自定观察区/);
});
const D=c.RingsideResultDisplay,copy=value=>JSON.parse(JSON.stringify(value));
const projection=(row,periods)=>D.trend({...row,digits:4},periods,L.change);

test('capability parameters retain the original range provenance instead of guessing from attainment',()=>{
 const f=createFixture(c,3);f.records.forEach(r=>{r.enabled.lactate=true;r.thresholds.lt1=4.05;r.thresholds.lt2=7;r.thresholds.unit='m/s';});
 const rule=f.profile.standards.find(r=>r.metricId==='lt1');rule.enabled=true;rule.rangesEnabled=true;rule.targetEnabled=true;rule.target=5;
 rule.ranges=[{min:0,max:3,label:'低区',status:'red'},{min:5,max:8,label:'自定观察区',status:'gray'}];
 const m=L.build(f.records,f),row=m.capability.cards.find(c=>c.id==='cardio').metrics.find(r=>r.id==='lt1');assert.ok(row.cells.every(c=>c?.value>0));assert.ok(row.cells.every(c=>c.evaluation.grade.range===null));
 assert.ok(row.cells.every(c=>!c.display.visible));assert.doesNotMatch(V.table([row],m.periods,{wrapped:false}),/class="pill [^"]*longitudinal-assessment/);
 f.records.forEach(r=>r.thresholds.lt1=6);const graded=L.build(f.records,f).capability.cards.find(c=>c.id==='cardio').metrics.find(r=>r.id==='lt1');assert.ok(graded.cells.every(c=>c.display.visible&&c.display.label==='自定观察区'));
});
test('disabled mismatched missing and ambiguous evaluations never acquire a display grade',()=>{
 for(const setup of [f=>f.profile.standards.find(r=>r.metricId==='cmj_height').enabled=false,
  f=>f.records.forEach(r=>r.data.cmj=[]),
  f=>f.records.forEach(r=>r.protocolIdentities.cmj.version++),
  f=>{const rule=f.profile.standards.find(r=>r.metricId==='cmj_height');rule.ranges=[{min:0,max:42,includeMax:true,label:'A',status:'amber'},{min:42,max:100,includeMin:true,label:'B',status:'green'}];f.records.forEach(r=>r.data.cmj.forEach(t=>t.height=42));}]){
  const f=createFixture(c,3);setup(f);const m=L.build(f.records,f),row=metric(m,'cmj_height');if(row)assert.ok(row.cells.filter(Boolean).every(cell=>!cell.display.visible));
 }
});
function isoDisplayFixture(directionId, { target = null, value = 220, pain = true, left = null, right = null } = {}) {
 const f=createFixture(c,3),rule=f.profile.standards.find(r=>r.directionId===directionId);assert.ok(rule);
 Object.assign(rule,{enabled:true,targetEnabled:target!==null,target,rangesEnabled:false});if(rule.reference)rule.reference.enabled=false;
 f.records.forEach(record=>{const row=record.data.iso.find(r=>r.id===directionId);assert.ok(row);if(row.reference)row.reference.enabled=false;row.target=target===null?'':target;
  if(row.paired)Object.assign(row,{left,right,painLeft:pain,painRight:false});else Object.assign(row,{center:value===null?'':value,painCenter:pain});});
 return f;
}
test('isometric pain without a target displays a symptom warning and never invents a target grade',()=>{
 const f=isoDisplayFixture('iso_neck_flexion'),before=JSON.stringify(f),m=L.build(f.records,f),row=metric(m,'iso:iso_neck_flexion:C');
 for(const cell of row.cells){assert.equal(cell.pain,true);assert.equal(cell.evaluation.grade.status,'red');assert.equal(cell.display.visible,true);assert.equal(cell.display.state,'warning');assert.equal(cell.display.status,'red');assert.equal(cell.display.label,'预警');assert.match(cell.display.reason,/疼痛记录/);assert.doesNotMatch(cell.displayEvaluation.reason,/疼痛|双侧差异/);}
 assert.match(V.table([row],m.periods,{wrapped:false}),/class="pill red longitudinal-assessment/);assert.equal(JSON.stringify(f),before);
});
test('isometric pain warning overrides display while original target assessment and regional risk remain intact',()=>{
 const f=isoDisplayFixture('iso_neck_flexion',{target:150}),before=JSON.stringify(f),m=L.build(f.records,f),row=metric(m,'iso:iso_neck_flexion:C');
 for(const cell of row.cells){assert.equal(cell.pain,true);assert.equal(cell.display.status,'red');assert.equal(cell.display.state,'warning');assert.equal(cell.display.label,'预警');assert.equal(cell.display.visible,true);assert.equal(cell.evaluation.grade.status,'red');assert.equal(cell.displayEvaluation.grade.status,'green');assert.match(cell.display.reason,/疼痛记录/);assert.doesNotMatch(cell.display.label,/疼痛|双侧差异/);assert.doesNotMatch(cell.displayEvaluation.reason,/疼痛|双侧差异/);}
 for(const period of m.periods){const side=period.stats.isoAnalyses.find(r=>r.id==='iso_neck_flexion').sides[0];assert.equal(side.status,'red');assert.ok(side.reasons.includes('疼痛'));}
 const risk=m.risk.rows.find(r=>r.id==='neck');assert.ok(risk.cells.every(cell=>cell.pain&&cell.evaluation.grade.status==='red'&&cell.display.status==='red'));assert.equal(JSON.stringify(f),before);
});
test('a 22.2 percent asymmetry grades only its dedicated row and does not downgrade target-met force',()=>{
 const f=isoDisplayFixture('iso_shoulder_externalRotation',{target:100,left:140,right:180,pain:false}),m=L.build(f.records,f),force=metric(m,'iso:iso_shoulder_externalRotation:L'),asym=metric(m,'asym:iso_shoulder_externalRotation');
 for(const cell of force.cells){assert.equal(cell.value,140);assert.equal(cell.display.status,'green');assert.equal(cell.displayEvaluation.grade.status,'green');assert.doesNotMatch(cell.display.label,/疼痛|双侧差异/);assert.doesNotMatch(cell.displayEvaluation.reason,/疼痛|双侧差异/);assert.equal(cell.evaluation.grade.status,'red');}
 for(const cell of asym.cells){assert.ok(Math.abs(cell.value-22.22222222222222)<1e-10);assert.equal(cell.display.status,'red');assert.equal(cell.display.visible,true);assert.match(cell.display.label,/左侧更弱/);}
});
test('missing force preserves its absent numeric result while an explicit pain flag still displays a symptom warning',()=>{
 const f=isoDisplayFixture('iso_neck_flexion',{target:150,value:null}),m=L.build(f.records,f),row=metric(m,'iso:iso_neck_flexion:C');assert.ok(row);
 for(const cell of row.cells){assert.equal(cell.value,null);assert.equal(cell.pain,true);assert.equal(cell.evaluation.grade.status,'red');assert.equal(cell.display.visible,true);assert.equal(cell.display.state,'warning');assert.equal(cell.display.label,'预警');assert.match(cell.display.reason,/疼痛记录/);}
 const html=V.table([row],m.periods,{wrapped:false});assert.match(html,/class="pill red longitudinal-assessment/);assert.doesNotMatch(html,/<strong>0<\/strong>/);
});
test('fixed FMS pain takes precedence over complete 3 and 3 side scores as a zero red grade',()=>{
 const f=createFixture(c,3);f.records.forEach(record=>Object.assign(record.data.fms[1],{left:3,right:3,pain:true}));const before=JSON.stringify(f),m=L.build(f.records,f),row=metric(m,'fms:1');
 for(const cell of row.cells){assert.equal(cell.value,0);assert.equal(cell.pain,true);assert.equal(cell.display.visible,true);assert.equal(cell.display.status,'red');assert.equal(cell.evaluation.grade.status,'red');assert.equal(cell.rawTrials[0].left,3);assert.equal(cell.rawTrials[0].right,3);}
 assert.equal(JSON.stringify(f),before);
});

test('joint balance uses actual matched gray range and retains invalid denominator reason',()=>{
 const f=createFixture(c,3),rule=f.profile.standards.find(r=>r.kind==='balance');assert.ok(rule);rule.enabled=true;rule.rangesEnabled=true;rule.ranges=[{min:0,max:100,includeMin:true,includeMax:true,label:'平衡观察区',status:'gray'}];
 for(const r of f.records){const pair=r.balancePairs.find(p=>p.id===rule.pairId);Object.assign(r.data.iso.find(t=>t.id===pair.numeratorId),{left:100,right:150});Object.assign(r.data.iso.find(t=>t.id===pair.denominatorId),{left:200,right:200});}
 const m=L.build(f.records,f),row=m.projects.find(p=>p.id==='iso').metrics.find(r=>r.pairId===rule.pairId&&r.cells.some(cell=>cell?.value!==null));assert.ok(row);assert.ok(row.cells.some(cell=>cell?.display.label==='平衡观察区'));
 const pair=f.records[0].balancePairs.find(p=>p.id===rule.pairId);f.records[0].data.iso.find(r=>r.id===pair.denominatorId).left=0;
 const updated=L.build(f.records,f),missing=updated.projects.find(p=>p.id==='iso').metrics.find(r=>r.pairId===pair.id&&r.cells[0]?.context.side==='L');assert.equal(missing.cells[0].display.visible,false);assert.match(V.table([missing],updated.periods),/分母为零/);
});
test('all selected periods survive one shared trend in screen and print projection',()=>{
 for(const count of[2,3,8]){const f=createFixture(c,count),m=L.build(f.records,f),row=metric(m,'cmj_height'),before=JSON.stringify(row),html=V.table([row],m.periods),data=JSON.parse(html.match(/data-longitudinal-table="([^"]*)"/)[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
  for(const out of[html,V.table(data.rows,data.periods,{print:true,wrapped:false})]){assert.equal((out.match(/>变化趋势<\/th>/g)||[]).length,1);assert.equal((out.match(/data-trend-point=/g)||[]).length,count);assert.doesNotMatch(out,/首末变化|近期变化|起点|终点/);}assert.equal(JSON.stringify(row),before);
 }
});
test('gaps and incompatible protocols break segments without skipping selected dates',()=>{
 const f=createFixture(c,8);f.records[2].data.cmj=[];f.records[5].protocolIdentities.cmj.version++;
 const m=L.build(f.records,f),row=metric(m,'cmj_height'),spec=projection(row,m.periods);assert.equal(spec.points.length,8);assert.equal(spec.points[2].value,null);
 const html=D.draw(spec);for(const i of[2,3,5,6])assert.ok(!html.includes('data-trend-segment="'+i+'"'));for(const i of[1,4,7])assert.ok(html.includes('data-trend-segment="'+i+'"'));
});
test('adjacent change semantics remain ordinal percentage-point ratio unknown and zero/negative safe',()=>{
 const f=createFixture(c,3),m=L.build(f.records,f);
 for(const id of['fms:0','long_pct','long_time','long_unknown']){const row=metric(m,id),spec=projection(row,m.periods);assert.deepEqual(copy(spec.points[2].change),copy(row.changes.recent));if(id==='fms:0'||id==='long_unknown')assert.equal(spec.points[1].change.percent,undefined);if(id==='long_pct'){assert.equal(spec.points[1].change.kind,'percentage-point');assert.match(D.draw(spec),/个百分点/);}}
 for(const value of[0,-10]){const row=copy(metric(m,'long_time'));row.cells[0].value=value;assert.equal(projection(row,m.periods).points[1].change.percent,undefined);}
});
test('changed evaluation keeps physical changes neutral and prevents shared reference shading',()=>{
 const f=createFixture(c,3),m=L.build(f.records,f),row=copy(metric(m,'cmj_height'));row.cells[1].evaluationKey='different';row.cells[1].display.reference={kind:'target',target:1};
 const spec=projection(row,m.periods);assert.equal(spec.reference,null);assert.equal(spec.points[1].change.improvement,null);assert.equal(spec.points[1].change.available,true);assert.match(D.draw(spec),/评价条件不同/);
});
test('unit-converted ranges use the displayed physical unit and raw readings stay untouched',()=>{
 const f=createFixture(c,3),d=f.records[2].definitions.find(r=>r.id==='cmj_height'),rule=f.profile.standards.find(r=>r.metricId==='cmj_height');
 const m=L.build(f.records,f),original=metric(m,'cmj_height').cells[0];assert.equal(original.display.reference.ranges[1].min,40);
 // Exercise the projection boundary with a known force conversion; the caller
 // owns conversion just as rowFrom does, not the renderer.
 const raw={value:100,rawValue:980.665,definition:{referenceEnabled:true,ranges:[{min:900,max:1100,status:'gray',label:'观察'}]},evaluation:{grade:{range:{min:900,max:1100},status:'gray',label:'观察'}}};
 const before=JSON.stringify(raw),a=D.assessment(raw,1/9.80665);assert.ok(Math.abs(a.reference.ranges[0].min-900/9.80665)<1e-10);assert.equal(JSON.stringify(raw),before);
});
test('same-day records stay individually labelled and do not imply elapsed-time slopes',()=>{
 const f=createFixture(c,3);f.records[1].athlete.date=f.records[0].athlete.date;const m=L.build(f.records,f),spec=projection(metric(m,'cmj_height'),m.periods);assert.notEqual(spec.points[0].label,spec.points[1].label);assert.match(D.draw(spec),/点距不代表时间间隔/);assert.equal((D.draw(spec).match(/data-trend-point=/g)||[]).length,3);
});
test('flat tiny negative and extreme observed values render finite chart coordinates',()=>{
 const f=createFixture(c,3),m=L.build(f.records,f);for(const values of[[1,1,1],[-.0123,-.0122,-.0121],[1e-8,2e-8,3e-8],[-1e12,0,1e12],[1e6,1e6+.01,1e6+.02]]){const row=copy(metric(m,'long_time'));row.cells.forEach((cell,i)=>cell.value=values[i]);const html=D.draw(projection(row,m.periods));assert.doesNotMatch(html,/NaN|Infinity/);assert.equal((html.match(/data-trend-point=/g)||[]).length,3);const low=Number(html.match(/data-axis-min="([^"]+)"/)[1]),high=Number(html.match(/data-axis-max="([^"]+)"/)[1]);assert.ok(low<=Math.min(...values)&&high>=Math.max(...values)&&low<high);}
});
test('each mini chart has a readable unit and numeric vertical axis including ordinal data',()=>{
 const f=createFixture(c,3),m=L.build(f.records,f);for(const id of['cmj_height','long_pct','long_time','long_unknown','fms:0']){const row=metric(m,id),html=D.draw(projection(row,m.periods)),axis=html.match(/<g data-trend-axis="y"[\s\S]*?<\/g>/)[0];assert.match(axis,new RegExp('纵坐标 '+row.unit));assert.ok((axis.match(/<text /g)||[]).length>=4);}
});
test('shared mini geometry stays compact across input widths and arbitrary selected point counts',()=>{
 assert.equal(D.trendSize.width,160);assert.equal(D.trendSize.height,72);assert.equal(D.trendSize.columnWidth,172);assert.equal(Object.isFrozen(D.trendSize),true);
 const f=createFixture(c,3),m=L.build(f.records,f),base=projection(metric(m,'fms:0'),m.periods);
 for(const count of[2,3,8,24])for(const requested of[120,160,420]){
  const spec={...base,points:Array.from({length:count},(_,i)=>({...base.points[i%3],id:'synthetic-point-'+i,change:i?{available:true,delta:0,kind:'ordinal',improvement:null}:null}))},html=D.draw(spec,requested),width=Math.min(160,requested);
  assert.match(html,new RegExp('viewBox="0 0 '+width+' 72" width="'+width+'" height="72"'));assert.equal((html.match(/data-trend-point=/g)||[]).length,count);
  const axis=html.match(/<g data-trend-axis="y"[\s\S]*?<\/g>/)[0],labels=[...axis.matchAll(/<text [^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)];assert.deepEqual(labels.map(m=>m[2]),['分','0','1','2','3']);assert.ok(labels.every(m=>m[1]==='9'));
 }
 const html=V.table([metric(m,'fms:0')],m.periods,{wrapped:false});assert.match(html,/col style="width:172px"/);
});

test('incompatible units are separate rows with the correct unit on each vertical axis',()=>{
 const f=createFixture(c,3);f.records.forEach((r,i)=>r.definitions.find(d=>d.id==='long_unknown').unit=i===2?'自定':'N');const m=L.build(f.records,f),row=metric(m,'long_unknown'),html=V.table([row],m.periods,{wrapped:false}),axes=[...html.matchAll(/data-trend-axis="y"[^>]*aria-label="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(axes,['纵坐标 N','纵坐标 自定']);
});
test('FMS shares the renderer with its fixed domain and never exposes relative score percentages',()=>{
 const f=createFixture(c,3);f.records.forEach((r,i)=>{r.data.fms[0].score=[1,3,2][i];r.data.fms[0].pain=false;});const m=L.build(f.records,f),spec=projection(metric(m,'fms:0'),m.periods),html=D.draw(spec);
 assert.match(html,/data-score-scale="0-3"/);assert.equal(spec.points[1].change.improvement,'improved');assert.equal(spec.points[2].change.improvement,'declined');assert.match(html,/#187459/);assert.match(html,/#b23f3d/);assert.doesNotMatch(html,/相对|起点|终点/);
});
// The immutable previous model is checked explicitly because CI may use a
// shallow checkout without historical objects; the normal suite stays portable.
if(process.argv.includes('--model-baseline'))test('extracting target-only strength assessment leaves complete original stats identical to f4f4fd4',()=>{
 const previous=context(),oldModel=require('node:child_process').execFileSync('git',['show','f4f4fd4:src/ringside-model.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',maxBuffer:8*1024*1024});
 vm.runInContext(oldModel,previous);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ringside-evaluation.js'),'utf8'),previous);
 const f=createFixture(c,3);f.records.forEach((record,index)=>{const neck=record.data.iso.find(r=>r.id==='iso_neck_flexion'),shoulder=record.data.iso.find(r=>r.id==='iso_shoulder_externalRotation');
  if(neck.reference)neck.reference.enabled=false;if(shoulder.reference)shoulder.reference.enabled=false;
  Object.assign(neck,{target:[200,150,150][index],center:index===1?'':index===2?220:192,painCenter:true});Object.assign(shoulder,{target:index===2?200:100,left:index===2?100:140,right:index===2?100:180,painLeft:index===1});});
 const before=JSON.stringify(f);for(const record of f.records)assert.deepEqual(copy(c.RingsideModel.stats(record)),copy(previous.RingsideModel.stats(record)));assert.equal(JSON.stringify(f),before);
 for(const record of f.records){const row=record.data.iso.find(r=>r.id==='iso_neck_flexion');row.target='';row.center=192;}const withoutTargets=JSON.stringify(f);
 for(const record of f.records)assert.deepEqual(copy(c.RingsideModel.stats(record)),copy(previous.RingsideModel.stats(record)));
 assert.equal(JSON.stringify(f),withoutTargets);
});

if(process.argv.includes('--baseline'))test('source records calculations summaries AI facts and chart choices match the baseline',()=>{
 const f=createFixture(c,3),before=JSON.stringify(f),current=L.build(f.records,f),facts=copy(L.facts(current));
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../output/comparison-trend/baseline/ringside-longitudinal.js'),'utf8'),c);const previous=c.RingsideLongitudinal.build(f.records,f);
 assert.deepEqual(facts,copy(c.RingsideLongitudinal.facts(previous)));assert.deepEqual(copy(current.changeSummary),copy(previous.changeSummary));assert.deepEqual(copy(current.periods.map(p=>p.stats)),copy(previous.periods.map(p=>p.stats)));assert.equal(JSON.stringify(f),before);c.RingsideLongitudinal=L;
});
if(process.argv.includes('--baseline'))test('configured IMTP standards add display reference without changing original comparison identity',()=>{
 const f=createFixture(c,3);f.records.forEach(r=>{r.data.imtp.forEach(t=>t.timePoints[0].rfd=5000);r.imtpTimeStandards=[{timeMs:100,kind:'rfd',context:c.RingsideEvaluation.imtpTimeContext(r),target:4000,ranges:[{min:0,max:8000,label:'RFD观察区',status:'gray'}],direction:'higher',referenceEnabled:true,source:'合成标准'}];});f.profile=c.RingsideEvaluation.create(f.records[2]);
 const current=L.build(f.records,f);vm.runInContext(fs.readFileSync(path.join(__dirname,'../output/comparison-trend/baseline/ringside-longitudinal.js'),'utf8'),c);const previous=c.RingsideLongitudinal.build(f.records,f);c.RingsideLongitudinal=L;
 const row=m=>m.projects.find(p=>p.id==='imtp').metrics.find(r=>r.id==='imtp_rfd100');assert.equal(row(current).cells[0].display.label,'RFD观察区');assert.deepEqual(copy(row(current).cells.map(cell=>cell.evaluationKey)),copy(row(previous).cells.map(cell=>cell.evaluationKey)));assert.deepEqual(copy(L.facts(current)),copy(L.facts(previous)));
});
console.log(`${passed} comparison trend checks passed; ${failed} failed`);if(failed)process.exitCode=1;
