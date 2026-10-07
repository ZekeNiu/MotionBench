"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "definitions", "tests", "model", "interventions", "viz", "report"]) vm.runInContext(fs.readFileSync(`src/ringside-${name}.js`, "utf8"), c);
const M = c.RingsideModel, R = c.RingsideReport, T = c.RingsideTests, C = c.Calc;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);
const copy = (x) => JSON.parse(JSON.stringify(x));
function custom() {
  const r = M.defaults();
  r.customTests.push({ id: "custom_repeat", name: "往返跑", category: "performance", primaryMetricId: "time" });
  r.enabled.custom_repeat = true;
  for (const [id, name, unit, direction] of [["time", "用时", "s", "lower"], ["force_extra", "力", "N", "higher"]]) r.definitions.push({ id, testId:"custom_repeat", name, unit, direction, category:"performance", ability:"速度", ranges:[], target:null, entryScope:"attempt", cvEligible:true });
  r.data.custom_repeat = [{id:"a",metrics:{time:12,force_extra:100}}, {id:"b",metrics:{time:10,force_extra:80}}, {id:"c",metrics:{time:10,force_extra:120}}];
  return r;
}
const stat = (r,id,key) => M.stats(r).repetitions.find((g) => g.testId===id && (!key || g.key===key));
test("sample SD and CV retain zeros, use n-1 and leave undefined CV empty", () => {
  const x=C.descriptive([38,40,42],true); near(x.mean,40); near(x.sd,2); near(x.cv,5); assert.equal(x.n,3);
  assert.equal(C.descriptive([0,0,0],true).cv,null); near(C.descriptive([0,0,0],true).sd,0);
  assert.equal(C.descriptive([-1,2,3],true).cv,null);
  assert.equal(C.descriptive([1,2,3],false).cv,null);
  assert.equal(C.descriptive(["",null,"invalid"],true).n,0);
  assert.equal(C.descriptive([9],true).sd,null);
});
test("report starts statistics at three and raw details at two, independently of representative mode", () => {
  const r=M.defaults(); r.enabled=Object.fromEntries(Object.keys(r.enabled).map(id=>[id,id==="cmj"]));
  for(const count of [0,1,2,3,6]) {
    r.data.cmj=Array.from({length:count},(_,i)=>({id:"j"+i,height:38+i*2}));
    const html=R.render(R.build(r));
    assert.equal(html.includes("with-repeat-columns"),count>=3); assert.equal(html.includes("data-raw-trials"),count>=2);
    assert.doesNotMatch(html,/repeat-stat-table|repeat-statistics/);
    assert.doesNotMatch(html,/data-raw-trials[^>]* open/);
  }
  r.data.cmj=[38,40,42].map((height,i)=>({id:"j"+i,height}));
  const before=copy(stat(r,"cmj").statistics); near(M.stats(r).values.cmj_height,42);
  r.mode="mean"; near(M.stats(r).values.cmj_height,40); assert.deepEqual(copy(stat(r,"cmj").statistics),before);
});
test("custom best follows primary direction, first tie, same attempt and per-field mean counts", () => {
  const r=custom(), before=JSON.stringify(r);
  near(M.stats(r).values.time,10); near(M.stats(r).values.force_extra,80); assert.equal(JSON.stringify(r),before);
  delete r.data.custom_repeat[1].metrics.force_extra;
  assert.equal(M.stats(r).values.force_extra,undefined);
  r.mode="mean"; near(M.stats(r).values.force_extra,110); near(M.stats(r).values.time,32/3);
  const g=stat(r,"custom_repeat"); assert.equal(g.statistics.find(x=>x.id==="force_extra").n,2);
  r.data.custom_repeat.push({id:"d",metrics:{force_extra:999}});
  near(M.stats(r).values.force_extra,110); assert.equal(stat(r,"custom_repeat").attempts.length,4);
});
test("legacy record metrics are not converted into attempts and primary selection survives snapshots", () => {
  const r=custom(); r.customValues.force_extra={value:999};
  const normalized=M.normalizeRecord(r); assert.equal(normalized.projectSnapshots.find(x=>x.id==="custom_repeat").primaryMetricId,"time");
  near(M.stats(normalized).values.force_extra,80);
  normalized.definitions.find(d=>d.id==="force_extra").entryScope="record";
  near(M.stats(normalized).values.force_extra,999);
  const cat=M.mergeCatalog(M.normalizeCatalog(),r); M.validateCatalog(cat);
  const fresh=M.recordFromCatalog(cat,{name:"新人"},{custom_repeat:true});
  assert.equal(fresh.data.custom_repeat.length,1); assert.equal(Object.keys(fresh.data.custom_repeat[0].metrics).length,0);
});
test("scalar trials are authoritative; empty arrays never resurrect legacy measurements", () => {
  const r=M.defaults(); r.data.pushup.reps=99; r.data.mas.speed=99;
  r.data.pushup.trials=[0,1,3].map((reps,i)=>({id:"p"+i,reps}));
  r.data.mas.trials=[4,5,6].map((speed,i)=>({id:"s"+i,speed}));
  r.mode="mean"; near(M.stats(r).values.pushup_reps,4/3); near(M.stats(r).values.mas_speed,5);
  assert.equal(M.recordProgressDetail(r,"pushup").status,"valid");
  assert.match(M.recordProgressDetail(r,"pushup").detail,/1\.33/);
  assert.equal(M.recordProgressDetail(custom(),"custom_repeat").detail,"指标 2/2");
  assert.equal(stat(r,"pushup").statistics[0].n,3);
  r.data.pushup.trials=[]; assert.equal(M.stats(r).values.pushup_reps,undefined);
  assert.equal(M.validateField(r,"data.pushup.trials.1.reps",1.5),"请填写整数");
  assert.ok(M.validateField(r,"data.mas.trials.0.speed",0));
  assert.ok(M.validateField(r,"data.ift.trials.0.partial",31));
});
test("isometric sides use independent groups and preserve pain from an unselected attempt", () => {
  const r=M.defaults(), row=r.data.iso.find(x=>x.paired); r.data.iso=[row];
  row.left=999;row.right=999; row.trials=[{id:"i1",left:100,right:130,painLeft:true},{id:"i2",left:120,right:110},{id:"i3",left:110,right:120}];
  const s=M.stats(r); near(s.isoAnalyses[0].left,120);near(s.isoAnalyses[0].right,130);assert.ok(s.isoAnalyses[0].sides[0].pain);
  near(stat(r,"iso",row.id+":left").statistics[0].mean,110);
  near(stat(r,"iso",row.id+":left").statistics[0].sd,10);
  assert.equal(stat(r,"iso",row.id+":left").attempts[0].pain,true);
  assert.equal(stat(r,"iso",row.id+":right").attempts[0].pain,false);
  r.mode="mean";near(M.stats(r).isoAnalyses[0].left,110); near(M.stats(r).isoAnalyses[0].right,120);
  row.trials[0].painLeft=false;assert.equal(M.stats(r).isoAnalyses[0].sides[0].pain,false);
});
test("LVP repeats stay within load and side; each load has exactly one regression point", () => {
  const r=M.defaults(); r.data.bench=[{id:"a",load:40,velocity:.8},{id:"b",load:40,velocity:.9},{id:"c",load:40,velocity:1},{id:"d",load:60,velocity:.6},{id:"e",load:80,velocity:.4}];
  const before=copy(stat(r,"bench",":40").statistics);near(before[0].mean,.9);near(before[0].sd,.1);
  assert.equal(M.stats(r).lvpSeries.find(x=>x.id==="bench").points.length,3);
  near(M.stats(r).lvpSeries.find(x=>x.id==="bench").points[0].velocity,1);
  r.mode="mean"; near(M.stats(r).lvpSeries.find(x=>x.id==="bench").points[0].velocity,.9);
  assert.deepEqual(copy(stat(r,"bench",":40").statistics),before);
  r.data.landmine=[...r.data.bench.map(x=>({...x,side:"L"})),...r.data.bench.map(x=>({...x,id:"R"+x.id,side:"R",velocity:x.velocity*2}))];
  near(stat(r,"landmine","R:40").statistics[0].mean,1.8);near(stat(r,"landmine","L:40").statistics[0].mean,.9);
  assert.ok(R.render(R.build(r)).includes('data-raw-trials="bench"'));
  r.definitions.push({id:"bench_extra",testId:"bench",name:"附加",unit:"N",entryScope:"record",category:"performance",direction:"higher",ranges:[]});r.customValues.bench_extra={value:10};
  assert.equal(R.render(R.build(r)).split('data-raw-trials="bench"').length-1,1);
});
test("ball sides and protocols do not mix; FMS and lactate never acquire repeat panels", () => {
  const r=M.sampleRecord(); r.data.mb=[1,2,3].map((distance,i)=>({id:"d"+i,side:"D",distance})).concat([5,6,7].map((distance,i)=>({id:"n"+i,side:"ND",distance})));
  near(stat(r,"mb","D").statistics[0].mean,2);near(stat(r,"mb","ND").statistics[0].mean,6);
  const s=M.stats(r);assert.ok(!s.repetitions.some(g=>["fms","lactate"].includes(g.testId)));
  assert.doesNotMatch(R.render(R.build(r)),/data-raw-trials="(?:fms|lactate)"/);
  r.data.ift.trials=[4,5,6].map((speed,i)=>({id:"s"+i,speed}));r.data.ift.protocol="treadmill";
  near(M.stats(r).values.ift_treadmill,6);assert.equal(M.stats(r).values.ift_shuttle,undefined);
});
test("raw grouped trials retain missing conditions, zero counts and original order", () => {
  const r=M.defaults();r.data.bench=[{id:"missing",velocity:.87654,notes:"负荷待补"}];
  let html=R.render(R.build(r));assert.match(html,/负荷待补/);assert.match(html,/0\.88/);assert.doesNotMatch(html,/repeat-stat-table/);
  r.data.mb=[{id:"b",distance:4.25,notes:"侧别待补"}];html=R.render(R.build(r));assert.match(html,/侧别待补/);
  r.data.pushup.trials=[0,0,0].map((reps,i)=>({id:"z"+i,reps}));
  const g=stat(r,"pushup");assert.equal(g.statistics[0].n,3);assert.equal(g.statistics[0].sd,0);assert.equal(g.statistics[0].cv,null);
});
test("IMTP time points count independently, raw RFD-only values survive and modes do not affect SD", () => {
  const r=M.defaults();r.data.imtp=[0,1,2].map(i=>({id:"f"+i,peakForce:2000+i*100,baselineForce:100,timePoints:[{id:"t"+i,timeMs:100,rfd:4000+i*1000},...(i===2?[]:[{id:"u"+i,timeMs:200,force:1000}])]}));
  const g=stat(r,"imtp");const f=g.statistics.find(x=>x.id==="imtp_f100");assert.equal(f.mean,null);assert.equal(f.sd,null);assert.equal(f.n,0);
  assert.equal(M.forceTime(r).points.find(x=>x.timeMs===100).force,700);
  assert.equal(g.statistics.find(x=>x.id==="imtp_f200").n,2);
  r.mode="mean"; assert.deepEqual(copy(stat(r,"imtp").statistics),copy(g.statistics));
  r.data.imtp=[{id:"partial",timePoints:[{id:"pt",timeMs:100,rfd:4321}]}];
  assert.match(R.render(R.build(r)),/4,321/);
});
test("conversion and normalization update all observations exactly once and keep CV invariant", () => {
  const r=custom(), old=stat(r,"custom_repeat").statistics.find(x=>x.id==="force_extra");
  const next=M.changeMetricUnit(r,"force_extra","kgf","convert");
  near(next.data.custom_repeat[0].metrics.force_extra,100/9.80665); near(r.data.custom_repeat[0].metrics.force_extra,100);
  near(stat(next,"custom_repeat").statistics.find(x=>x.id==="force_extra").cv,old.cv);
  r.data.mas={speed:18,unit:"km/h",trials:[{id:"s1",speed:18},{id:"s2",speed:21.6}]};
  const once=M.normalizeRecord(r),twice=M.normalizeRecord(once);near(once.data.mas.trials[0].speed,5);assert.deepEqual(copy(once),copy(twice));
});
test("nested imports validate numeric fields, IDs, primary ownership and CV declarations", () => {
  const r=custom();M.validateRecord(r);
  r.data.pushup.trials=[{id:"p",reps:1.5}];assert.throws(()=>M.validateRecord(r));
  r.data.pushup.trials=[{id:"p",reps:1},{id:"p",reps:2}];assert.throws(()=>M.validateRecord(r));
  delete r.data.pushup.trials;r.customTests[0].primaryMetricId="cmj_height";assert.throws(()=>M.validateRecord(r));
  r.customTests[0].primaryMetricId="time";r.definitions.find(d=>d.id==="time").cvEligible="yes";assert.throws(()=>M.validateRecord(r));
});
test("repeated changes stale analysis; raw expansion is presentation-only and source data stay immutable", () => {
  const r=custom(), before=M.fingerprint(r), snapshot=JSON.stringify(r);R.render(R.build(r));assert.equal(JSON.stringify(r),snapshot);
  r.data.custom_repeat[0].metrics.time=13;assert.notEqual(M.fingerprint(r),before);
  const changed=M.fingerprint(r);r.views.details={"trials-custom_repeat":true};assert.equal(M.fingerprint(r),changed);
});
test("all demo statistics appear exactly once inside result rows, including isometric sides and IMTP", () => {
  const fixture=JSON.parse(fs.readFileSync('examples/three-trials.json','utf8')),r=fixture.record || fixture;
  const report=R.build(r),html=R.render(report);
  assert.deepEqual(copy(report.diagnostics),[]);
  const expected=M.stats(r).repetitions.flatMap(g=>g.statistics).filter(m=>m.n>=3).length;
  assert.equal((html.match(/data-repeat-stat=/g)||[]).length,expected);
  assert.doesNotMatch(html,/repeat-stat-table|repeat-statistics|力来源|有效次数 力\/RFD/);
  const iso=html.match(/<article[^>]+id="detail-iso"[\s\S]*?<\/article>/)[0];
  assert.doesNotMatch(iso,/中线/);assert.match(iso,/iso-results with-repeat-columns/);
  assert.match(html,/imtp-results with-repeat-columns/);
  assert.match(html,/lvp-results with-repeat-columns/);
});
test("result columns retain all-zero SD and CV unavailable, with missing values counted per metric", () => {
  const r=custom(); r.data.custom_repeat[2].metrics.force_extra='';
  const html=R.render(R.build(r));
  assert.match(html,/data-repeat-stat="time"/);assert.doesNotMatch(html,/data-repeat-stat="force_extra"/);
  r.data.pushup.trials=[0,0,0].map((reps,i)=>({id:'zero'+i,reps}));
  assert.match(R.render(R.build(r)),/data-repeat-stat="pushup_reps">[\s\S]*?0\.00 ± 0\.00/);
});
console.log(`${passed} repeated measurement model checks passed`);
