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
 assert.ok(row.cells.every(c=>!c.display.visible));assert.doesNotMatch(V.table([row],m.periods,{wrapped:false}),/未分级/);
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
test('target grades fixed FMS and true pain/asymmetry warnings have positive provenance',()=>{
 const f=createFixture(c,3);f.profile.standards.find(r=>r.directionId==='iso_neck_flexion').enabled=false;f.records.forEach(r=>r.data.iso.find(t=>t.id==='iso_neck_flexion').painCenter=true);
 const m=L.build(f.records,f);assert.equal(metric(m,'iso:iso_neck_flexion:C').cells[0].display.state,'warning');assert.match(metric(m,'iso:iso_neck_flexion:C').cells[0].display.label,/疼痛/);
 assert.ok(metric(m,'long_time').cells.every(cell=>cell.display.visible));assert.ok(metric(m,'fms:0').cells.every(cell=>cell.display.visible));
 const asym=m.projects.find(p=>p.id==='iso').metrics.find(r=>r.section==='asymmetry'&&r.cells.some(cell=>cell?.value!==null));assert.ok(asym.cells.some(cell=>cell?.display.visible));
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
test('incompatible units are separate rows with the correct unit on each vertical axis',()=>{
 const f=createFixture(c,3);f.records.forEach((r,i)=>r.definitions.find(d=>d.id==='long_unknown').unit=i===2?'自定':'N');const m=L.build(f.records,f),row=metric(m,'long_unknown'),html=V.table([row],m.periods,{wrapped:false}),axes=[...html.matchAll(/data-trend-axis="y"[^>]*aria-label="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(axes,['纵坐标 N','纵坐标 自定']);
});
test('FMS shares the renderer with its fixed domain and never exposes relative score percentages',()=>{
 const f=createFixture(c,3);f.records.forEach((r,i)=>{r.data.fms[0].score=[1,3,2][i];r.data.fms[0].pain=false;});const m=L.build(f.records,f),spec=projection(metric(m,'fms:0'),m.periods),html=D.draw(spec);
 assert.match(html,/data-score-scale="0-3"/);assert.equal(spec.points[1].change.improvement,'improved');assert.equal(spec.points[2].change.improvement,'declined');assert.match(html,/#187459/);assert.match(html,/#b23f3d/);assert.doesNotMatch(html,/相对|起点|终点/);
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
