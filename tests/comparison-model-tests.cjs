"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),crypto=require("node:crypto"),child=require("node:child_process");
const {loadComparisonContext,demoRecord,createDemoLibrary}=require("./helpers/comparison-fixtures.cjs"),c=loadComparisonContext(),M=c.RingsideModel,C=c.RingsideComparison;
const json=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,tolerance=1e-10)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance*Math.max(Number.MIN_VALUE,Math.abs(expected)),actual+" != "+expected);
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
function fixture(dates=["2026-01-01","2026-01-16","2026-03-02"]){
  const records=dates.map((date,period)=>{const r=M.defaults();r.athleteId="a0";r.recordId="r0_"+period;r.athlete.name="Synthetic personal athlete";r.athlete.date=date;
    r.enabled=Object.fromEntries(Object.keys(r.enabled).map(id=>[id,id==="cmj"]));
    r.data.cmj=[{id:"trial1",height:20+period*2,force:1200+period*10},{id:"trial2",height:19+period*2,force:1100+period*10}];return r;});
  return {library:{athletes:[{id:"a0",name:"Synthetic personal athlete",profile:{},groupId:"g",records}],groups:[{id:"g",name:"Synthetic group"}],catalog:M.normalizeCatalog(),evaluationProfiles:[]},
    selection:{groupId:"g",athleteIds:["a0"],dates,recordChoices:{},basis:{strength:"eur",reactive:"dj_rsi",speed:"srr",jumpProtocol:"fvp_sj"}}};
}
const derive=({library,selection})=>C.deriveComparison(C.readComparisonInputs(library,selection));
const metricOf=(model,id)=>{const metric=model.metrics.find(item=>item.id===id);assert.ok(metric,id);return metric;};
function addScalar(f,values,{id="personal_scalar",unit="u",scale="ratio",direction="higher"}={}){
  f.library.athletes[0].records.forEach((record,index)=>{record.definitions.push({id,testId:"cmj",name:"Personal scalar",unit,direction,entryScope:"record",legacyManual:true,
    category:"performance",ability:"Personal",measurementScale:scale,zeroValid:true,ranges:[],referenceEnabled:false,scoring:false});record.customValues[id]={value:values[index]};});return id;
}
const noInference=metric=>{
  for(const key of["cohortIds","sd","cv","ciLow","ciHigh","p","dz","sdChange"])assert.equal(Object.hasOwn(metric,key),false,key);
  for(const item of[...metric.periods,...metric.changes])for(const key of["sd","cv","ciLow","ciHigh","p","pAdjusted","t","dz","sdChange","cohortIds"])assert.equal(Object.hasOwn(item,key),false,key);
};
test("only one athlete and multiple distinct dates enter the public longitudinal engine",()=>{
  const f=fixture();assert.throws(()=>C.readComparisonInputs(f.library,{...f.selection,athleteIds:["a0","other"]}),/一名|个人纵向/);
  assert.throws(()=>C.readComparisonInputs(f.library,{...f.selection,dates:[f.selection.dates[0]]}),/两个|个人纵向/);
  assert.throws(()=>C.deriveComparison({entries:[],selection:{...f.selection,athleteIds:["a0","other"]}}),/一名|个人纵向/);
  const model=derive(f);assert.equal(model.kind,"personal-longitudinal");assert.equal(model.athletes.length,1);model.metrics.forEach(noInference);
  for(const name of["paired","holm","studentP","criticalT","descriptive","quantile"])assert.equal(Object.hasOwn(C,name),false);
  assert.equal(model.statistics.version,"personal-longitudinal-v2");
});
test("normalization sorts dates and retains all IDs for rejection rather than choosing a first athlete",()=>{
  const s=C.normalizeSelection({athleteIds:["b","a","a"],dates:["2026-03-02","2026-01-01","2026-01-01","2026-02-30"],recordIds:{a:{"2026-01-01":"missing-explicit"}}});
  assert.deepEqual(json(s.athleteIds),["a","b"]);assert.deepEqual(json(s.dates),["2026-01-01","2026-03-02"]);assert.equal(s.recordChoices.a["2026-01-01"],"missing-explicit");
});
test("sorted dates, unique record bindings and pure input reads are deterministic",()=>{
  const f=fixture(),before=JSON.stringify(f.library);f.selection.dates.reverse();const input=C.readComparisonInputs(f.library,f.selection);
  assert.equal(input.ready,true);assert.deepEqual(json(input.dates),["2026-01-01","2026-01-16","2026-03-02"]);assert.equal(input.selection.recordChoices.a0["2026-01-16"],"r0_1");
  const model=C.deriveComparison(input);assert.equal(JSON.stringify(f.library),before);assert.equal(model.statistics.baselineDate,"2026-01-01");
});
test("same-day retests remain unresolved until the exact record is selected",()=>{
  const f=fixture(),extra=json(f.library.athletes[0].records[0]);extra.recordId="repeat";extra.data.cmj[0].height=30;f.library.athletes[0].records.push(extra);
  const input=C.readComparisonInputs(f.library,f.selection);assert.equal(input.ready,false);assert.equal(input.issues[0].kind,"ambiguous-record");
  f.selection.recordChoices.a0={"2026-01-01":"repeat"};assert.equal(C.readComparisonInputs(f.library,f.selection).ready,true);assert.equal(metricOf(derive(f),"cmj_height").periods[0].value,30);
});
test("a missing explicit record is never replaced by another same-day record",()=>{
  const f=fixture();f.selection.recordChoices.a0={"2026-01-01":"removed-record"};const input=C.readComparisonInputs(f.library,f.selection);
  assert.equal(input.ready,false);assert.equal(input.selection.recordChoices.a0["2026-01-01"],"removed-record");
  const metric=metricOf(C.deriveComparison(input),"cmj_height");assert.equal(metric.observations[0].recordId,"removed-record");assert.equal(metric.periods[0].value,null);
  assert.equal(metric.periods[2].value,24);assert.equal(metric.changes[1].delta,null);assert.match(metric.changes[1].reason,/基线/);
});
test("archived records remain readable while deleted owners remain explicit unknowns",()=>{
  const f=fixture();f.library.athletes[0].archived=true;f.library.athletes[0].records.forEach(r=>r.archived=true);assert.equal(derive(f).ready,true);
  f.library.athletes[0].deletedAt="2026-04-01T00:00:00Z";const input=C.readComparisonInputs(f.library,f.selection);
  assert.equal(input.ready,false);assert.equal(input.issues[0].kind,"missing-athlete");assert.equal(input.athletes[0].id,"a0");
});
test("one original representative result is retained per date despite multiple trials",()=>{
  const f=fixture();f.library.athletes[0].records.forEach(r=>{r.mode="mean";r.data.cmj.push({id:"trial3",height:18});});
  const metric=metricOf(derive(f),"cmj_height");assert.equal(metric.periods.length,3);
  f.library.athletes[0].records.forEach((r,i)=>{assert.equal(metric.periods[i].value,M.stats(r).values.cmj_height);assert.equal(metric.periods[i].n,1);});
});
test("a missing middle metric preserves valid endpoint values and changes",()=>{
  const f=fixture();f.library.athletes[0].records[1].data.cmj=[];const metric=metricOf(derive(f),"cmj_height");
  assert.deepEqual(json(metric.periods.map(p=>p.value)),[20,null,24]);assert.equal(metric.changes[0].delta,null);assert.match(metric.changes[0].reason,/缺少|未测/);
  assert.equal(metric.changes[1].delta,4);assert.equal(metric.trend.available,false);assert.equal(metric.trend.points.length,2);
});
test("a whole missing round retains its date in metrics, summary, directions and axes",()=>{
  const f=fixture();f.library.athletes[0].records.forEach(r=>r.definitions.find(d=>d.id==="cmj_height").referenceEnabled=true);
  f.library.athletes[0].records.splice(1,1);const model=derive(f),metric=metricOf(model,"cmj_height");assert.ok(model.axes.length);
  assert.equal(model.ready,true);assert.equal(model.dates.length,3);assert.equal(metric.periods[1].value,null);assert.equal(metric.changes[1].delta,4);assert.equal(model.summary.periods[1].hasResults,false);
  for(const card of model.capabilities){assert.equal(card.periods.length,3);assert.equal(card.periods[1].members[0].value,null);}for(const axis of model.axes)assert.equal(axis.periods[1].value,null);
});
test("the earliest selected date remains baseline even when all its measurements are missing",()=>{
  const f=fixture(["2026-01-01","2026-01-16","2026-03-02","2026-04-01"]);f.library.athletes[0].records.shift();const model=derive(f),metric=metricOf(model,"cmj_height");
  assert.equal(model.statistics.baselineDate,"2026-01-01");assert.deepEqual(json(metric.periods.map(p=>p.value)),[null,22,24,26]);
  metric.changes.forEach(change=>{assert.equal(change.baselineDate,"2026-01-01");assert.equal(change.delta,null);assert.match(change.reason,/基线/);});assert.equal(metric.trend.available,true);assert.equal(metric.trend.points.length,3);
});
test("protocol, unit and representative-policy variants remain separate without erasing other dates",()=>{
  for(const mutate of[r=>{r.protocol.cmj="Other acquisition";r.protocolIdentities.cmj=M.protocolIdentity("test:cmj",r.protocol.cmj);},r=>r.definitions.find(d=>d.id==="cmj_height").unit="mm",r=>r.mode="mean"]){
    const f=fixture();mutate(f.library.athletes[0].records[1]);const variants=derive(f).metrics.filter(m=>m.id==="cmj_height");assert.equal(variants.length,2);
    const main=variants.find(m=>m.periods[0].value!==null);assert.equal(main.periods[1].value,null);assert.equal(main.changes[1].delta,4);assert.equal(main.observations[1].recordId,"r0_1");assert.match(main.observations[1].reason,/协议|条件|单位|口径/);
    const other=variants.find(m=>m.periods[0].value===null);assert.ok(other.periods[1].value!==null);assert.equal(other.changes[0].delta,null);
  }
});
test("a lower direction without enabled standards describes an actual timing decrease",()=>{
  const f=fixture(),id=addScalar(f,[4,3.8,3.6],{unit:"s",direction:"lower"}),metric=metricOf(derive(f),id);near(metric.changes[0].delta,-.2);near(metric.changes[0].percentChange,-5);assert.equal(metric.changes[0].improvement,"decreased");assert.equal(metric.changes[0].changeInterpretation,"descriptive");
});
test("percentage points and zero or negative baselines do not become percent changes",()=>{
  for(const[values,unit,delta]of[[[40,45,50],"%",5],[[0,2,3],"cm",2],[[-2,-1,0],"cm",1]]){const f=fixture(),id=addScalar(f,values,{unit}),m=metricOf(derive(f),id);assert.equal(m.changes[0].delta,delta);assert.equal(m.changes[0].percentChange,null);if(unit==="%")assert.equal(m.changes[0].deltaUnit,"百分点");}
});
test("ordinal scores retain their raw values and deltas without a continuous trend",()=>{
  const f=fixture(),id=addScalar(f,[1,2,3],{unit:"分",scale:"ordinal"}),m=metricOf(derive(f),id);assert.deepEqual(json(m.periods.map(p=>p.value)),[1,2,3]);assert.equal(m.changes[0].delta,1);assert.equal(m.changes[0].percentChange,null);assert.equal(m.continuous,false);assert.equal(m.trend.available,false);noInference(m);
});
test("trend uses actual elapsed days and requires three measured dates",()=>{
  const result=C.trend([{date:"2026-01-01",mean:10,n:1},{date:"2026-01-16",mean:11.5,n:1},{date:"2026-03-02",mean:16,n:1}]);near(result.slopePerDay,.1);near(result.slopePer30Days,3);near(result.r2,1);
  assert.equal(C.trend([{date:"2026-01-01",mean:10},{date:"2026-03-02",mean:16}]).available,false);
});
test("machine-equivalent fitted slopes preserve raw observations but give zero changes and flat trends",()=>{
  const values=[-.039999999999999994,-.04,-.040000000000000015],f=fixture(),id=addScalar(f,values,{scale:"interval",unit:"m/s/kg"}),before=JSON.stringify(f.library),m=metricOf(derive(f),id);
  assert.deepEqual(json(m.observations.map(o=>o.value)),values);m.changes.forEach(change=>{assert.equal(change.delta,0);assert.equal(change.improvement,"unchanged");});
  assert.equal(m.trend.slopePerDay,0);assert.equal(m.trend.slopePer30Days,0);assert.equal(m.trend.r2,null);assert.equal(JSON.stringify(f.library),before);noInference(m);
});
test("constant nonzero decimal changes remain real changes without paired inference",()=>{
  const f=fixture(["2026-01-01","2026-01-02","2026-01-03"]),id=addScalar(f,[.1,.2,.3]),m=metricOf(derive(f),id);near(m.changes[0].delta,.1);near(m.changes[1].delta,.2);near(m.trend.slopePerDay,.1);m.changes.forEach(change=>assert.equal(change.improvement,"increased"));noInference(m);
});
test("relative tolerance preserves true tiny values and resolvable changes near one",()=>{
  for(const[baseline,current]of[[1.23e-14,1.24e-14],[-1.23e-14,-1.24e-14],[0,1.23e-14],[1,1+1e-12]])assert.equal(C.numericDifference(current,baseline),current-baseline);
  const f=fixture(),id=addScalar(f,[1e-14,2e-14,3e-14]),m=metricOf(derive(f),id);near(m.changes[0].delta,1e-14);near(m.changes[1].delta,2e-14);m.changes.forEach(change=>assert.equal(change.improvement,"increased"));assert.ok(m.trend.slopePer30Days>0);assert.ok(m.trend.r2>0);noInference(m);
});
test("independent decimal Fraction oracle distinguishes machine residues from real force quantization for each person",()=>{
  const people=Array.from({length:3},(_,i)=>[0,2,5].map(p=>demoRecord(c,i,p))),raw=people.map(records=>records.map(r=>({imtp:r.data.imtp,landmine:r.data.landmine})));
  const code=[
    "import json,sys; from fractions import Fraction as F; from decimal import Decimal",
    "raw=json.loads(sys.stdin.read(),parse_float=Decimal); output=[]",
    "for records in raw:",
    " out={'slopes':[], 'imtp':{}}",
    " for record in records:",
    "  for side in ['L','R']:",
    "   pts=[(F(p['load']),F(p['velocity'])) for p in record['landmine'] if p['side']==side]; mx=sum(x for x,y in pts)/len(pts); my=sum(y for x,y in pts)/len(pts)",
    "   out['slopes'].append(str(sum((x-mx)*(y-my) for x,y in pts)/sum((x-mx)**2 for x,y in pts)))",
    " for time in [50,100,150,200,250,300]:",
    "  values=[]",
    "  for record in records:",
    "   ps=[F(next(p['force'] for p in attempt['timePoints'] if p['timeMs']==time))/F(attempt['peakForce'])*100 for attempt in record['imtp']]; values.append(sum(ps)/len(ps))",
    "  out['imtp'][str(time)]={'constant':len(set(values))==1,'deltas':[float(value-values[0]) for value in values[1:]]}",
    " output.append(out)",
    "print(json.dumps(output))"
  ].join("\n");
  const reference=child.spawnSync("python",["-c",code],{input:JSON.stringify(raw),encoding:"utf8"});assert.equal(reference.status,0,reference.stderr);const expected=JSON.parse(reference.stdout);
  people.forEach((records,i)=>{
    const library={athletes:[{id:records[0].athleteId,name:records[0].athlete.name,records}],catalog:M.mergeCatalog(null,records[0]),evaluationProfiles:[]},before=JSON.stringify(library);
    const model=derive({library,selection:{athleteIds:[records[0].athleteId],dates:records.map(r=>r.athlete.date)}});assert.equal(JSON.stringify(library),before);assert.deepEqual([...new Set(expected[i].slopes)],["-1/25"]);
    for(const id of["landmineR_slope","landmineL_slope","imtp_f150_pct_peak","imtp_f300_pct_peak"]){
      const m=metricOf(model,id);m.changes.forEach(change=>{assert.equal(change.delta,0);assert.equal(change.improvement,"unchanged");});assert.equal(m.trend.slopePer30Days,0);assert.equal(m.trend.r2,null);noInference(m);
      m.observations.forEach(o=>{const r=records.find(r=>r.recordId===o.recordId),stats=M.stats(r),original=id.startsWith("landmine")?stats.lvpSeries.find(s=>s.id===id.replace("_slope","")).fit.b:stats.imtpTimeResults.find(r=>r.id===id.replace("_pct_peak","")).forcePercent;assert.equal(o.value,original);});
    }
    for(const time of[50,100,200,250])metricOf(model,"imtp_f"+time+"_pct_peak").changes.forEach((change,p)=>{const exact=expected[i].imtp[time].deltas[p];assert.ok(Math.abs(change.delta-exact)<2e-14);if(i<2){assert.ok(Math.abs(exact)>1e-11);assert.ok(Math.abs(change.delta)>1e-11);assert.equal(Math.sign(change.delta),Math.sign(exact));}else assert.equal(change.delta,0);});
  });
});
test("shared evaluation profiles resolve current standards without changing raw records",()=>{
  const f=fixture(),profile=c.RingsideEvaluation.create(f.library.athletes[0].records[0],"Synthetic personal scheme");f.library.evaluationProfiles=[profile];f.library.defaultEvaluationProfileId=profile.id;f.library.athletes[0].records.forEach(r=>r.evaluationProfileId=profile.id);
  const before=JSON.stringify(f.library),input=C.readComparisonInputs(f.library,f.selection);input.entries.forEach(entry=>assert.equal(entry.evaluationProfile.id,profile.id));derive(f);assert.equal(JSON.stringify(f.library),before);
});
test("actual DJ and Hop contact times and unsigned FVP imbalance remain descriptive without standards",()=>{
  const records=[0,2,5].map(p=>demoRecord(c,1,p)),f={library:{athletes:[{id:records[0].athleteId,records}],evaluationProfiles:[]},selection:{athleteIds:[records[0].athleteId],dates:records.map(r=>r.athlete.date)}},before=JSON.stringify(f.library),model=derive(f);
  for(const id of["dj_contact_time","hop_contact_time","fvp_sj_imbalance","fvp_cmj_imbalance","sprint_fvp_imbalance"]){
    const metric=metricOf(model,id);assert.equal(metric.changeInterpretation,"descriptive",id);assert.ok(metric.changes.some(change=>change.delta!==0&&change.delta!==null),id);
    metric.changes.forEach(change=>{assert.equal(change.changeInterpretation,"descriptive");assert.equal(change.improvement,change.delta===0?"unchanged":change.delta>0?"increased":"decreased");});
    metric.observations.forEach(o=>assert.equal(o.value,M.stats(records.find(r=>r.recordId===o.recordId)).values[id]));
    if(id.endsWith("imbalance"))metric.observations.forEach(o=>assert.ok(o.value>=0));
  }
  assert.equal(JSON.stringify(f.library),before);
});
test("an enabled effective target supplies interpretation even when ability scoring is disabled",()=>{
  const f=fixture(),id=addScalar(f,[4,3.8,3.6],{unit:"s",direction:"lower"});f.library.athletes[0].records.forEach(r=>Object.assign(r.definitions.find(d=>d.id===id),{referenceEnabled:true,targetEnabled:true,target:3.5,rangesEnabled:false,scoring:false}));
  const m=metricOf(derive(f),id);assert.equal(m.changeInterpretation,"evaluation-standard");assert.equal(m.changeDirection,"lower");m.changes.forEach(change=>{assert.equal(change.improvement,"improved");assert.equal(change.changeInterpretationRule,"target");assert.ok(change.changeInterpretationKey.startsWith("sha256:"));});
  const cmj=fixture();cmj.library.athletes[0].records.forEach((r,i)=>{r.data.cmj[0].height=24-i*2;r.data.cmj[1].height=23-i*2;Object.assign(r.definitions.find(d=>d.id==="cmj_height"),{referenceEnabled:true,targetEnabled:true,target:40,rangesEnabled:false,ranges:[]});});
  metricOf(derive(cmj),"cmj_height").changes.forEach(change=>assert.equal(change.improvement,"declined"));
});
test("enabled flags, valid standards and definition directions are independent requirements",()=>{
  const mutations=[d=>d.referenceEnabled=false,d=>d.targetEnabled=false,d=>d.target=0,d=>d.target=null,d=>d.direction="unknown",d=>d.referenceMatch={eligible:false}];
  mutations.forEach(mutate=>{const f=fixture(),id=addScalar(f,[1,2,3]);f.library.athletes[0].records.forEach(r=>{const d=r.definitions.find(d=>d.id===id);Object.assign(d,{referenceEnabled:true,targetEnabled:true,target:4,rangesEnabled:false});mutate(d);});metricOf(derive(f),id).changes.forEach(change=>{assert.equal(change.changeInterpretation,"descriptive");assert.equal(change.improvement,"increased");});});
  const unknown=fixture(),id=addScalar(unknown,[1,2,3]);unknown.library.athletes[0].records.forEach(r=>delete r.definitions.find(d=>d.id===id).direction);assert.equal(metricOf(derive(unknown),id).changes[0].improvement,"increased");
});
test("real scheme applicability and target switches cannot be replaced by referenceEnabled alone",()=>{
  const f=fixture(),E=c.RingsideEvaluation,profile=E.create(f.library.athletes[0].records[0],"Interpretation scheme"),rule=profile.standards.find(d=>d.id==="metric:cmj_height");
  f.library.evaluationProfiles=[profile];f.library.athletes[0].records.forEach(r=>{r.evaluationProfileId=profile.id;r.athlete.sex="男";});
  Object.assign(rule,{enabled:true,targetEnabled:false,rangesEnabled:false,target:40,ranges:[]});let m=metricOf(derive(f),"cmj_height");assert.equal(m.observations[0].changeInterpretation,"descriptive");assert.equal(m.changes[0].improvement,"increased");
  Object.assign(rule,{targetEnabled:true,target:40,conditions:{sex:"female"}});m=metricOf(derive(f),"cmj_height");assert.equal(m.changes[0].changeInterpretation,"descriptive");assert.equal(m.changes[0].improvement,"increased");
  rule.conditions={};m=metricOf(derive(f),"cmj_height");assert.equal(m.changes[0].improvement,"improved");assert.equal(m.observations[0].changeInterpretationRule,"target");
});
test("front and back effective standards must match while each date keeps its own evidence",()=>{
  const f=fixture(),id=addScalar(f,[1,2,3]);f.library.athletes[0].records.forEach(r=>Object.assign(r.definitions.find(d=>d.id===id),{referenceEnabled:true,targetEnabled:true,target:4,rangesEnabled:false}));
  f.library.athletes[0].records[1].definitions.find(d=>d.id===id).direction="lower";let m=metricOf(derive(f),id);assert.equal(m.changeInterpretation,"descriptive");assert.equal(m.changes[0].improvement,"increased");assert.equal(m.changes[1].improvement,"improved");assert.notEqual(m.changes[0].baselineInterpretationKey,m.changes[0].currentInterpretationKey);
  f.library.athletes[0].records[2].definitions.find(d=>d.id===id).target=5;m=metricOf(derive(f),id);assert.equal(m.changes[1].improvement,"increased");assert.equal(m.changes[1].changeInterpretation,"descriptive");
  f.library.athletes[0].records[2].definitions.find(d=>d.id===id).referenceEnabled=false;assert.equal(metricOf(derive(f),id).changes[1].improvement,"increased");
});
test("one shared scheme is checked separately at each date instead of borrowing baseline applicability",()=>{
  const f=fixture(),E=c.RingsideEvaluation,profile=E.create(f.library.athletes[0].records[0],"Date-specific applicability"),rule=profile.standards.find(d=>d.id==="metric:cmj_height");
  Object.assign(rule,{enabled:true,targetEnabled:true,target:40,rangesEnabled:false,ranges:[],conditions:{sex:"male"}});f.library.evaluationProfiles=[profile];f.library.athletes[0].records.forEach((r,i)=>{r.evaluationProfileId=profile.id;r.athlete.sex=i===1?"女":"男";});
  const metric=metricOf(derive(f),"cmj_height");assert.equal(metric.observations[0].changeInterpretation,"evaluation-standard");assert.equal(metric.observations[1].changeInterpretation,"descriptive");assert.equal(metric.changes[0].improvement,"increased");assert.equal(metric.changes[1].improvement,"improved");assert.equal(metric.changeInterpretation,"descriptive");
});
test("resolvable scientific-scale changes retain their numeric sign before evidence-based interpretation",()=>{
  for(const[values,target]of[[[1.23e-14,1.24e-14,1.22e-14],1.3e-14],[[1,1+1e-12,1-1e-12],2]]){
    const f=fixture(),id=addScalar(f,values);f.library.athletes[0].records.forEach(r=>Object.assign(r.definitions.find(d=>d.id===id),{referenceEnabled:true,targetEnabled:true,target,rangesEnabled:false,ranges:[]}));
    const metric=metricOf(derive(f),id);metric.changes.forEach((change,i)=>assert.equal(change.delta,values[i+1]-values[0]));assert.equal(metric.changes[0].improvement,"improved");assert.equal(metric.changes[1].improvement,"declined");assert.equal(metric.changeInterpretationRule,"target");
  }
});
test("nonmonotonic ranges follow the original grade rather than a higher or lower shortcut",()=>{
  const f=fixture(),id=addScalar(f,[1,2,3]);const ranges=[{min:0,max:1.5,includeMax:false,status:"red"},{min:1.5,max:2.5,includeMax:false,status:"green"},{min:2.5,max:null,status:"amber"}];
  f.library.athletes[0].records.forEach(r=>Object.assign(r.definitions.find(d=>d.id===id),{referenceEnabled:true,targetEnabled:true,target:4,rangesEnabled:true,ranges}));
  let m=metricOf(derive(f),id);assert.equal(m.changeDirection,"");assert.equal(m.changes[0].changeInterpretationRule,"ranges");assert.equal(m.changes[0].improvement,"improved");assert.equal(m.changes[1].improvement,"improved");
  f.library.athletes[0].records[0].customValues[id].value=2;m=metricOf(derive(f),id);assert.equal(m.changes[0].improvement,"unchanged");assert.equal(m.changes[1].improvement,"declined");
  f.library.athletes[0].records[0].customValues[id].value=1;f.library.athletes[0].records[1].customValues[id].value=1.2;m=metricOf(derive(f),id);assert.equal(m.changes[0].improvement,"increased");assert.equal(m.changes[0].baselineGrade,m.changes[0].currentGrade);
});
test("IMTP percentage standards cannot interpret raw force in newtons",()=>{
  const f=fixture(),E=c.RingsideEvaluation;f.library.athletes[0].records.forEach((r,i)=>{r.enabled.imtp=true;r.data.imtp=[{id:"force",peakForce:1000,timePoints:[{id:"time",timeMs:175,force:500+i*50,rfd:2000+i*100}]}];});
  const profile=E.create(f.library.athletes[0].records[0],"IMTP scheme"),subject=E.ruleSubjects(f.library.athletes[0].records[0]).find(s=>s.id==="imtp-time:force_pct_peak:175"),rule=E.ensureStandard(profile,subject);
  Object.assign(rule,{enabled:true,targetEnabled:true,target:100,direction:"higher",rangesEnabled:false,ranges:[]});f.library.evaluationProfiles=[profile];f.library.athletes[0].records.forEach(r=>r.evaluationProfileId=profile.id);
  const model=derive(f),force=metricOf(model,"imtp_f175"),percentage=metricOf(model,"imtp_f175_pct_peak");assert.equal(force.unit,"N");assert.equal(percentage.unit,"%PF");assert.equal(force.changes[0].delta,50);assert.equal(force.changes[0].improvement,"increased");assert.equal(force.changeInterpretation,"descriptive");
  near(percentage.changes[0].delta,5);assert.equal(percentage.changes[0].improvement,"improved");assert.equal(percentage.changeInterpretation,"evaluation-standard");assert.equal(percentage.changes[0].deltaUnit,"百分点");
});
test("explicit original side-difference and FMS score rules retain their narrow meanings",()=>{
  const records=[0,5].map(p=>demoRecord(c,0,p)),f={library:{athletes:[{id:records[0].athleteId,records}],evaluationProfiles:[]},selection:{athleteIds:[records[0].athleteId],dates:records.map(r=>r.athlete.date)}},model=derive(f),asym=model.metrics.find(m=>m.id.startsWith("iso_")&&m.id.endsWith("_asym")&&m.changes[0].delta<0);assert.ok(asym);assert.equal(asym.changes[0].improvement,"improved");assert.equal(asym.changeInterpretation,"original-rule");assert.equal(asym.changeDirection,"lower");
  const fms=model.metrics.find(m=>m.id.startsWith("fms_")&&m.id!=="fms_total"&&m.changes[0].delta>0);assert.ok(fms);assert.equal(fms.changes[0].improvement,"improved");assert.equal(fms.changeInterpretation,"original-rule");assert.equal(fms.measurementScale,"ordinal");assert.equal(fms.trend.available,false);assert.equal(metricOf(model,"fms_total").changeInterpretation,"descriptive");
});
test("summary retains original findings and body-side evidence for each date",()=>{
  const records=[0,5].map(p=>demoRecord(c,0,p)),model=derive({library:{athletes:[{id:records[0].athleteId,name:records[0].athlete.name,records}],evaluationProfiles:[]},selection:{athleteIds:[records[0].athleteId],dates:records.map(r=>r.athlete.date)}});
  model.entries.forEach(entry=>{const period=model.summary.periods.find(p=>p.date===entry.date);assert.equal(period.redCount,entry.stats.findings.filter(f=>f.status==="red").length);assert.equal(period.amberCount,entry.stats.findings.filter(f=>f.status==="amber").length);
    for(const[key,region]of Object.entries(entry.stats.signals.regions))if(region.hasMeasured){assert.equal(period.regions[key].members[0].status,region.status);assert.deepEqual(json(period.regions[key].members[0].tests),json(region.tests));}
  });
});
test("valid baseline-to-last state transitions survive an unknown middle date",()=>{
  const f=fixture();f.library.athletes[0].records.forEach(r=>{const d=r.definitions.find(d=>d.id==="cmj_height");d.referenceEnabled=true;d.ranges=[{min:0,max:23,includeMax:false,status:"red",label:"Concern"},{min:23,max:null,status:"green",label:"Normal",advantage:true}];});
  f.library.athletes[0].records[1].data.cmj=[];const states=derive(f).summary.transitions.filter(t=>t.key.startsWith("metric:cmj_height"));
  assert.equal(states.find(t=>t.toDate==="2026-01-16").state,"unknown");assert.equal(states.find(t=>t.toDate==="2026-03-02").state,"resolved");
});
test("incompatible measurement identities cannot imply risk resolution or entered advantage",()=>{
  const f=fixture();f.library.athletes[0].records.forEach(r=>{const d=r.definitions.find(d=>d.id==="cmj_height");d.referenceEnabled=true;d.ranges=[{min:0,max:23,includeMax:false,status:"red"},{min:23,max:null,status:"green",advantage:true}];});
  const last=f.library.athletes[0].records[2];last.protocol.cmj="Other protocol";last.protocolIdentities.cmj=M.protocolIdentity("test:cmj",last.protocol.cmj);
  const states=derive(f).summary.transitions.filter(t=>t.toDate==="2026-03-02"&&t.key.includes("cmj_height"));assert.ok(states.length);states.forEach(t=>assert.equal(t.state,"unknown"));
});
test("direction values and parameters are independently retained despite a missing date",()=>{
  const f=fixture();f.library.athletes[0].records.forEach(r=>{r.enabled.sj=true;r.data.sj=[{id:"sj",height:18}];});f.library.athletes[0].records[1].data.sj=[];
  const card=derive(f).capabilities.find(card=>card.id==="strength");assert.ok(card.periods[0].members[0].hasData);assert.equal(card.periods[1].members[0].value,null);assert.ok(card.periods[2].members[0].hasData);
  assert.ok(card.periods[0].parameters.find(p=>p.id==="eur").value!==null);assert.ok(card.periods[2].parameters.find(p=>p.id==="eur").value!==null);assert.equal(Object.hasOwn(card,"cohortIds"),false);card.periods.forEach(p=>assert.equal(Object.hasOwn(p,"groups"),false));
});
test("individual capability axes separate incompatible scoring definitions by date",()=>{
  const f=fixture();f.library.athletes[0].records.forEach(r=>r.definitions.find(d=>d.id==="cmj_height").referenceEnabled=true);
  assert.ok(derive(f).axes.length);f.library.athletes[0].records[1].definitions.find(d=>d.id==="cmj_height").target+=10;
  const axes=derive(f).axes.filter(a=>a.identity.definitions.some(d=>d.id==="cmj_height"));assert.ok(axes.length>=2);assert.ok(axes.some(a=>a.periods[0].value!==null&&a.periods[1].value===null&&a.periods[2].value!==null));axes.forEach(a=>assert.equal(Object.hasOwn(a,"cohortIds"),false));
});
test("complex curves keep original dated coordinates and never pool curves",()=>{
  const records=[0,2,5].map(p=>demoRecord(c,0,p));records[1].data.lactate.forEach(p=>p.speed+=.1);records[1].data.imtp.forEach(a=>a.timePoints=a.timePoints.filter(p=>p.timeMs!==100));
  const model=derive({library:{athletes:[{id:records[0].athleteId,name:records[0].athlete.name,records}],evaluationProfiles:[]},selection:{athleteIds:[records[0].athleteId],dates:records.map(r=>r.athlete.date)}});
  for(const id of["imtp","fvp_sj","fvp_cmj","sprint_fvp","landmine","lactate"])assert.ok(model.curves.some(c=>c.testId===id),id);
  model.curves.forEach(curve=>{assert.deepEqual(json(curve.common),[]);assert.equal(Object.hasOwn(curve,"cohortIds"),false);curve.series.forEach(s=>{assert.equal(s.athleteId,records[0].athleteId);assert.equal(s.label,s.date);});});
  const imtp=model.curves.find(c=>c.testId==="imtp"&&c.kind==="force");assert.equal(imtp.series.length,3);assert.equal(imtp.series[1].points.some(p=>p.x===100),false);assert.equal(imtp.series[0].points.some(p=>p.x===100),true);
  const lactate=model.curves.find(c=>c.kind==="lactate");near(lactate.series[1].points[0].x-lactate.series[0].points[0].x,.1);
});
test("FMS sides, pain, notes and six generic chart configurations remain intact",()=>{
  const records=[0,5].map(p=>demoRecord(c,1,p)),model=derive({library:{athletes:[{id:records[0].athleteId,name:records[0].athlete.name,records}],evaluationProfiles:[]},selection:{athleteIds:[records[0].athleteId],dates:records.map(r=>r.athlete.date)}});
  const fms=model.metrics.filter(m=>m.testId==="fms");assert.ok(fms.some(m=>m.identity.side==="L"));assert.ok(fms.some(m=>m.identity.side==="R"));assert.ok(fms.some(m=>m.observations.some(o=>o.pain)));assert.ok(fms.some(m=>m.observations.some(o=>o.notes)));
  fms.forEach(m=>{assert.equal(m.continuous,false);noInference(m);});assert.equal(model.projects.filter(p=>p.id.startsWith("demo_generic")).length,6);
});
test("digests and method metadata bind actual data and the numeric policy without inference",()=>{
  for(const text of["","abc","个人测试🏅","x".repeat(1000)])assert.equal(C.hash(text),"sha256:"+crypto.createHash("sha256").update(text).digest("hex"));
  const f=fixture(),initial=derive(f);assert.equal(initial.fingerprint.length,71);assert.equal(initial.statistics.numericalRoundoff.relativeFactor,16);assert.equal(initial.statistics.numericalRoundoff.absoluteTolerance,0);
  for(const key of["pairedTest","effectSize","correction","comparisonCount","cohort","confidenceLevel"])assert.equal(Object.hasOwn(initial.statistics,key),false);f.library.athletes[0].records[0].data.cmj[0].height+=.1;assert.notEqual(derive(f).fingerprint,initial.fingerprint);
});
test("demo presets contain only independent single-person multi-date reports while retaining original records",()=>{
  const library=createDemoLibrary(c,{bindReports:false});assert.equal(library.athletes.length,24);assert.equal(library.athletes.reduce((n,a)=>n+a.records.length,0),144);assert.equal(library.comparisonReports.length,3);
  library.comparisonReports.forEach(r=>{assert.equal(r.selection.athleteIds.length,1);assert.equal(r.selection.dates.length,6);assert.ok(C.readComparisonInputs(library,r.selection).ready);assert.doesNotMatch(r.narrative.text,/共同重点|分组建议|队员集合/);});
});

(async()=>{
  const asyncTest=async(name,run)=>{await run();passed++;console.log("PASS "+name);};
  const isolated=()=>{const context=loadComparisonContext();let calls=0;const original=context.RingsideModel.stats;context.RingsideModel.stats=(...args)=>{calls++;return original(...args);};return{C:context.RingsideComparison,calls:()=>calls};};
  await asyncTest("async results match sync, yield progress and reject multiple people before computing",async()=>{
    const x=isolated(),f=fixture(),inputs=x.C.readComparisonInputs(f.library,f.selection),source=JSON.stringify(inputs),progress=[];
    await assert.rejects(x.C.deriveComparisonAsync({...inputs,selection:{...inputs.selection,athleteIds:["a0","other"]}}),/一名|个人纵向/);assert.equal(x.calls(),0);
    const model=await x.C.deriveComparisonAsync(inputs,{onProgress:v=>progress.push(json(v))});assert.equal(x.calls(),3);assert.equal(progress[0].current,0);assert.equal(progress.at(-1).phase,"comparison");
    assert.deepEqual(json(model),json(x.C.deriveComparison(inputs)));assert.equal(JSON.stringify(inputs),source);assert.equal(x.calls(),3);
  });
  await asyncTest("async calculation cancels before work and between record batches",async()=>{
    const x=isolated(),f=fixture(Array.from({length:8},(_,i)=>"2026-01-"+String(i+1).padStart(2,"0"))),inputs=x.C.readComparisonInputs(f.library,f.selection);
    await assert.rejects(x.C.deriveComparisonAsync(inputs,{isCurrent:()=>false}),e=>e.name==="AbortError");assert.equal(x.calls(),0);
    let current=true,eventObserved=false;await assert.rejects(x.C.deriveComparisonAsync(inputs,{isCurrent:()=>current,onProgress:v=>{if(v.current===4)setTimeout(()=>{current=false;eventObserved=true;},0);}}),e=>e.name==="AbortError");
    assert.equal(eventObserved,true);assert.equal(x.calls(),4);
  });
  await asyncTest("cancellation stays responsive during aggregation and prepared records remain reusable",async()=>{
    const x=isolated(),f=fixture(),inputs=x.C.readComparisonInputs(f.library,f.selection);let current=true,reached=false;
    await assert.rejects(x.C.deriveComparisonAsync(inputs,{isCurrent:()=>current,onProgress:v=>{if(v.stage==="metric-statistics"){reached=true;setTimeout(()=>current=false,0);}}}),e=>e.name==="AbortError");
    assert.equal(reached,true);assert.equal(x.calls(),3);assert.equal((await x.C.deriveComparisonAsync(inputs)).ready,true);assert.equal(x.calls(),3);
  });
  await asyncTest("raw values, units, view semantics and chosen report basis invalidate affected cached records",async()=>{
    const x=isolated(),f=fixture(),initial=await x.C.deriveComparisonAsync(x.C.readComparisonInputs(f.library,f.selection));assert.equal(x.calls(),3);
    f.library.athletes[0].records[0].data.cmj[0].height+=1;const changed=await x.C.deriveComparisonAsync(x.C.readComparisonInputs(f.library,f.selection));assert.equal(x.calls(),4);assert.notEqual(changed.fingerprint,initial.fingerprint);
    f.library.athletes[0].records[0].definitions.find(d=>d.id==="cmj_height").unit="mm";await x.C.deriveComparisonAsync(x.C.readComparisonInputs(f.library,f.selection));assert.equal(x.calls(),5);
    f.library.athletes[0].records[0].views.idsiWindow="idsi_fixed250";await x.C.deriveComparisonAsync(x.C.readComparisonInputs(f.library,f.selection));assert.equal(x.calls(),6);
    f.selection.basis.strength="fdsi";const basis=await x.C.deriveComparisonAsync(x.C.readComparisonInputs(f.library,f.selection));assert.equal(x.calls(),9);assert.ok(basis.entries.every(e=>e.directions.find(d=>d.id==="strength").metricId==="fdsi"));
  });
  await asyncTest("returned records and fit graphs cannot poison future cached calculations",async()=>{
    const x=isolated(),f=fixture(),inputs=x.C.readComparisonInputs(f.library,f.selection),first=await x.C.deriveComparisonAsync(inputs);
    first.entries[0].stats.values.cmj_height=-999;first.entries[0].stats.validTests.clear();first.entries[0].stats.representativeData.cmj[0].height=-999;first.entries[0].extracted.find(m=>m.id==="cmj_height").value=-999;
    const second=await x.C.deriveComparisonAsync(inputs);assert.equal(x.calls(),3);assert.equal(second.entries[0].stats.values.cmj_height,20);assert.ok(second.entries[0].stats.validTests.has("cmj"));
    const records=[0,5].map(p=>demoRecord(c,0,p)),input=x.C.readComparisonInputs({athletes:[{id:records[0].athleteId,name:records[0].athlete.name,records}],evaluationProfiles:[]},{athleteIds:[records[0].athleteId],dates:records.map(r=>r.athlete.date)});
    const complex=await x.C.deriveComparisonAsync(input),fit=complex.entries[0].stats.lvpSeries.find(s=>s.id==="squat").fit,expected=fit.predict(50);fit.a=-999;fit.b=-999;
    const next=await x.C.deriveComparisonAsync(input);near(next.entries[0].stats.lvpSeries.find(s=>s.id==="squat").fit.predict(50),expected);
  });
  await asyncTest("160-record bound handles one person's long history and evicts older records",async()=>{
    const dates=Array.from({length:161},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10)),x=isolated(),f=fixture(dates),inputs=x.C.readComparisonInputs(f.library,f.selection);
    await x.C.deriveComparisonAsync(inputs);assert.equal(x.calls(),161);x.C.deriveComparison({...inputs,entries:[inputs.entries[160]]});assert.equal(x.calls(),161);x.C.deriveComparison({...inputs,entries:[inputs.entries[0]]});assert.equal(x.calls(),162);
  });
  console.log(passed+" personal longitudinal model checks passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
