"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict"), path = require("node:path");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "scoring", "fvp", "sprint-fvp", "cpet-reference", "definitions", "tests", "iso-reference", "model", "evaluation", "interventions"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), c);
const M = c.RingsideModel, E = c.RingsideEvaluation, S = c.RingsideScoring, T = c.RingsideTests, copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
function near(actual, expected) { assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8, actual + " != " + expected); }
function fixture() {
  const r = M.defaults(); r.enabled.cmj = true; r.enabled.sj = true;
  r.data.cmj = [{ id: "c1", height: 40 }]; r.data.sj = [{ id: "s1", height: 30 }];
  for (const id of ["cmj_height", "sj_height"]) Object.assign(r.definitions.find(d => d.id === id), {referenceEnabled:true,target:50});
  const p = E.create(r); p.aggregations = {}; return { r, p };
}
function rule(p, id) { return p.standards.find(x => x.id === "metric:" + id); }
function standard(p, id, target) { Object.assign(rule(p, id), { enabled: true, targetEnabled: true, rangesEnabled: false, target, ranges: [] }); }
function mean(p) { p.aggregations["ability:下肢爆发力"] = { method: "mean", members: ["metric:cmj_height", "metric:sj_height"], transforms: { "metric:cmj_height": {kind:"ratio",direction:"higher"}, "metric:sj_height": {kind:"ratio",direction:"higher"} } }; }
const axis = (r,p) => M.stats(E.resolve(r,p)).axes.find(x => x.key === "下肢爆发力");

test("new profiles persist independent rule identities without measurement definitions or criteria", () => {
  const {r,p}=fixture(), json=copy(p); assert.equal(json.formatVersion,2); assert.equal(json.criteria,undefined);
  assert.equal(json.standards.find(x=>x.metricId==="cmj_height").name,undefined);
  assert.equal(json.standards.find(x=>x.metricId==="cmj_height").ability,undefined);
  const before=JSON.stringify(r.data); E.resolve(r,p); assert.equal(JSON.stringify(r.data),before); assert.ok(E.validateProfile(p));
});
test("standalone exports retain the independent scheme and athlete identity including fixed means and history", () => {
  const {r,p}=fixture(); mean(p); r.athlete.name="测量运动员"; p.name="明确计分方案"; p.revision=3;
  const older=E.serializeProfile(p); older.revision=2; p.releases=[older]; p.previous=copy(older);
  const expected=axis(r,p).value;
  for(const envelope of [M.recordEnvelope(r,p),{schema:2,kind:"report",record:copy(r),profile:M.profileFromRecord(r),evaluationProfile:E.serializeProfile(p)}, {schema:2,kind:"assessment-record",record:copy(r),profile:E.serializeProfile(p)}]) {
    const imported=E.migrate(envelope), record=imported.athletes[0].records[0], profile=imported.evaluationProfiles[0];
    assert.equal(imported.athletes[0].name,"测量运动员"); assert.equal(record.evaluationProfileId,p.id);
    assert.deepEqual(copy(E.serializeProfile(profile)),copy(E.serializeProfile(p))); near(axis(record,profile).value,expected);
  }
});
test("a blank published profile remains blank during upgrades", () => {
  const {p}=fixture(); p.standards=[]; const lib={evaluationProfiles:[p]}; assert.equal(E.upgradeLibraryProfiles(lib),false); assert.equal(p.standards.length,0);
});
test("no scheme and absent rules cannot inherit private record targets references or analysis zones", () => {
  const {r,p}=fixture(); p.standards=[]; p.settings.lvp={};
  for(const out of [E.resolve(r,p),E.resolve(r,null)]) { assert.equal(out.definitions.find(x=>x.id==="cmj_height").target,null); assert.ok(out.data.iso.every(x=>x.target==="" && x.reference===undefined)); assert.ok(Object.values(out.lvp).every(x=>x.mvt==="" && x.zones.length===0)); }
});
test("missing fields in old standards clear stored per-record evaluation values", () => {
  const {r}=fixture(), old={id:"old",name:"old",revision:1,criteria:E.capture(r)}; const d=old.criteria.definitions.find(x=>x.id==="cmj_height"); delete d.target; delete d.referenceEnabled;
  const out=E.resolve(r,E.normalizeProfile(old,r)).definitions.find(x=>x.id==="cmj_height"); assert.equal(out.target,null); assert.equal(out.referenceEnabled,false);
});
test("force basis applies to force but does not invalidate jump-height standards", () => {
  const {r,p}=fixture(); r.cmjConfig.definition="net"; const out=E.resolve(r,p); assert.equal(out.definitions.find(x=>x.id==="cmj_height").referenceEnabled,true);
  r.imtpConfig.definition="net"; assert.equal(E.resolve(r,p).definitions.find(x=>x.id==="imtp_peak_force").referenceEnabled,false);
});
test("target and grade switches and demographic conditions operate independently", () => {
  const {r,p}=fixture(); r.athlete.sex="男"; r.athlete.age=25;
  const d=rule(p,"cmj_height"); Object.assign(d,{enabled:true,targetEnabled:true,target:50,rangesEnabled:true,ranges:[{min:0,max:null,label:"已达区间",status:"green"}],targetConditions:{sex:"female"}});
  let out=E.resolve(r,p), result=M.stats(out).evaluationResults.find(x=>x.subjectId===d.id); assert.equal(result.target,null); assert.equal(result.grade.status,"green"); assert.equal(result.targetApplicable,false);
  d.targetConditions={sex:"male"};d.rangesConditions={ageMin:30};out=E.resolve(r,p); result=M.stats(out).evaluationResults.find(x=>x.subjectId===d.id); near(result.attainment,80);assert.equal(result.rangesApplicable,false);
});
test("primary missing hides its ability even when another member was measured", () => {
  const {r,p}=fixture(); standard(p,"cmj_height",50);standard(p,"sj_height",40);p.aggregations["ability:下肢爆发力"]={method:"primary",primary:"metric:cmj_height"};r.data.cmj=[]; assert.equal(axis(r,p),undefined);
});
test("fixed mean uses all explicit members equally and retains each contribution", () => {
  const {r,p}=fixture();standard(p,"cmj_height",50);standard(p,"sj_height",60);mean(p);const a=axis(r,p);near(a.value,65);assert.deepEqual(copy(a.scores),[80,50]);assert.equal(a.status,"gray");
  const result=M.stats(E.resolve(r,p)).evaluationResults.find(x=>x.subjectId==="metric:cmj_height");near(result.scoreContributions[0].score,80);assert.equal(result.schemeRevision,1);
});
test("mean does not silently drop a missing, disabled or inapplicable member", () => {
  const {r,p}=fixture();standard(p,"cmj_height",50);standard(p,"sj_height",60);mean(p);
  r.data.sj=[];assert.equal(axis(r,p),undefined);r.data.sj=[{id:"s",height:30}];rule(p,"sj_height").enabled=false;assert.equal(axis(r,p),undefined);rule(p,"sj_height").enabled=true;rule(p,"sj_height").conditions={sex:"female"};r.athlete.sex="男";assert.equal(axis(r,p),undefined);
});
test("mean grades require their own explicit intervals, never worst member color", () => {
  const {r,p}=fixture();standard(p,"cmj_height",50);standard(p,"sj_height",60);mean(p);const cfg=p.aggregations["ability:下肢爆发力"];cfg.ranges=[{min:60,max:100,label:"团队目标",status:"green"}];assert.equal(axis(r,p).status,"green");
});
test("legacy mean freezes members and awaits conversion; legacy min becomes inactive", () => {
  const {r}=fixture();r.axes["ability:下肢爆发力"]={method:"mean"};r.axes["ability:力量耐力"]={method:"min"};const p=E.normalizeProfile({id:"old",name:"old",revision:1,criteria:E.capture(r)},r);
  assert.ok(p.aggregations["ability:下肢爆发力"].members.includes("metric:cmj_height"));assert.equal(Object.keys(p.aggregations["ability:下肢爆发力"].transforms).length,0);assert.equal(axis(r,p),undefined);assert.equal(p.aggregations["ability:力量耐力"].method,"disabled");assert.ok(E.validateProfile(p));
});
test("user-disabled ability is a valid explicit choice",()=>{const {p}=fixture();p.aggregations["ability:下肢爆发力"]={method:"disabled"};assert.ok(E.validateProfile(p));});
test("ratio scoring respects scale zero domain direction clipping and missing values", () => {
  const context={target:10,subject:{measurementScale:"ratio",zeroValid:true}};
  near(S.evaluate(5,{kind:"ratio",direction:"higher"},context).score,50);near(S.evaluate(20,{kind:"ratio",direction:"higher"},context).score,100);near(S.evaluate(20,{kind:"ratio",direction:"lower"},context).score,50);
  near(S.evaluate(0,{kind:"ratio",direction:"lower"},context).score,100);assert.equal(S.evaluate("",{kind:"ratio",direction:"lower"},context).valid,false);
  assert.equal(S.evaluate(0,{kind:"ratio",direction:"higher"},{...context,subject:{measurementScale:"ratio",zeroValid:false}}).valid,false);
  for(const value of [-1,NaN,Infinity])assert.equal(S.evaluate(value,{kind:"ratio",direction:"higher"},context).valid,false);
  assert.equal(S.evaluate(20,{kind:"ratio",direction:"higher"},{...context,subject:{measurementScale:"interval"}}).valid,false);
});
test("single-direction and optimal-interval anchors interpolate and saturate explicitly",()=>{
  const higher={kind:"anchors",shape:"higher",points:[{value:10,score:0},{value:20,score:100}]};near(S.evaluate(15,higher).score,50);near(S.evaluate(30,higher).score,100);
  const range={kind:"anchors",shape:"range",points:[{value:0,score:0},{value:10,score:100},{value:20,score:100},{value:30,score:0}]};for(const [v,s] of [[-5,0],[5,50],[15,100],[25,50],[35,0]])near(S.evaluate(v,range).score,s);
  assert.equal(S.evaluate(15,higher,{subject:{measurementScale:"ordinal"}}).valid,false);
});
test("score tables honor endpoints and real gaps without interpolating ordinal colors",()=>{
  const transform={kind:"table",ranges:[{min:0,max:1,includeMax:false,score:0},{min:1,max:2,score:70},{min:3,max:4,score:100}]};near(S.evaluate(1,transform).score,70);assert.equal(S.evaluate(2.5,transform).valid,false);assert.throws(()=>S.validateTransform({kind:"table",ranges:[]}));
});
test("anchor scores can contribute without targets but require a configured measurement rule",()=>{
  const {r,p}=fixture();mean(p);for(const id of ["cmj_height","sj_height"])Object.assign(rule(p,id),{enabled:true,targetEnabled:false,rangesEnabled:false,target:null,ranges:[]});
  p.aggregations["ability:下肢爆发力"].transforms=Object.fromEntries(["cmj_height","sj_height"].map(id=>["metric:"+id,{kind:"anchors",shape:"higher",points:[{value:0,score:0},{value:50,score:100}]}]));near(axis(r,p).value,70);
  p.standards=p.standards.filter(x=>x.id!=="metric:sj_height");assert.equal(axis(r,p),undefined);
});
test("overlaps and invalid aggregation or conversion settings are rejected before publication",()=>{
  const {p}=fixture(); const d=rule(p,"cmj_height");d.ranges=[{min:0,max:10,label:"A",status:"red"},{min:10,max:20,label:"B",status:"green"}];assert.throws(()=>E.validateProfile(p));d.ranges[0].includeMax=false;assert.ok(E.validateProfile(p));
  mean(p);delete p.aggregations["ability:下肢爆发力"].transforms["metric:sj_height"];assert.throws(()=>E.validateProfile(p));p.aggregations={"ability:下肢爆发力":{method:"min"}};assert.throws(()=>E.validateProfile(p));
});
test("old unchanged overlapping intervals are retained but any edit must remove ambiguity",()=>{
  const {r}=fixture(),d=r.definitions.find(x=>x.id==="cmj_height");d.ranges=[{min:0,max:10,label:"A",status:"red"},{min:10,max:20,label:"B",status:"green"}];const p=E.create(r);assert.ok(E.validateProfile(p));rule(p,d.id).ranges[1].max=30;assert.throws(()=>E.validateProfile(p));
});
test("new catalog owns measurements only and preserves explicit representative selection",()=>{
  const catalog=M.normalizeCatalog(M.libraryDefaults().catalog);assert.equal(catalog.measurementPolicyVersion,1);assert.ok(catalog.definitions.every(d=>d.target===null && d.ranges.length===0 && !d.referenceEnabled && d.referenceGroups===undefined));
  const r=M.recordFromCatalog(catalog,{}, {cmj:true});assert.equal(r.measurementPolicyVersion,1);
});
function customFixture(){const r=M.defaults();r.customTests.push({id:"timing",name:"计时",category:"performance",primaryMetricId:"time",selectionDirection:"lower"});r.enabled.timing=true;r.definitions.push({id:"time",testId:"timing",name:"时间",unit:"s",direction:"lower",ability:"速度",category:"performance",entryScope:"attempt",target:10,referenceEnabled:true,ranges:[],measurementScale:"ratio",protocol:"计时"});r.data.timing=[{id:"a",metrics:{time:12}},{id:"b",metrics:{time:10}}];return r;}
test("changing an evaluation direction never changes the measurement representative",()=>{const r=M.normalizeRecord(customFixture()),p=E.create(r);near(M.stats(r).values.time,10);rule(p,"time").direction="higher";near(M.stats(E.resolve(r,p)).values.time,10);});
test("legacy selection is frozen once with auditable before and after values",()=>{const r=customFixture();delete r.customTests[0].selectionDirection;const n=M.normalizeRecord(r);assert.equal(n.projectSnapshots.find(x=>x.id==="timing").selectionDirection,"lower");assert.equal(n.measurementMigration.decisions.find(x=>x.testId==="timing").basis,"legacy-measurement-definition");near(n.measurementMigration.representatives.find(x=>x.testId==="timing").before.time,10);near(n.measurementMigration.representatives.find(x=>x.testId==="timing").after.time,10);assert.deepEqual(copy(M.normalizeRecord(n).measurementMigration),copy(n.measurementMigration));});
test("unknown legacy selection is retained and flagged rather than called proven",()=>{const r=customFixture();delete r.customTests[0].selectionDirection;delete r.definitions.find(x=>x.id==="time").direction;const n=M.normalizeRecord(r);assert.equal(n.measurementMigration.reviewRequired,true);near(M.stats(n).values.time,12);});
test("unit conversions update values targets and score anchors without changing scores",()=>{const r=customFixture();const d=r.definitions.find(x=>x.id==="time");d.unit="N";r.axes["ability:速度"]={method:"mean",members:["metric:time"],transforms:{"metric:time":{kind:"anchors",shape:"higher",points:[{value:0,score:0},{value:20,score:100}]}}};const next=M.changeMetricUnit(r,"time","kgf","convert");near(next.axes["ability:速度"].transforms["metric:time"].points[1].value,20/9.80665);near(S.evaluate(10/9.80665,next.axes["ability:速度"].transforms["metric:time"]).score,50);});
test("arbitrary IMTP time conditions and fixed mean membership use the percentage result",()=>{const {r,p}=fixture();r.enabled.imtp=true;r.data.imtp=[{id:"i",peakForce:1000,timePoints:[{id:"t",timeMs:175,force:500,rfd:2000}]}];const subject=E.ruleSubjects(r).find(x=>x.id==="imtp-time:force_pct_peak:175"),d=E.ensureStandard(p,subject);Object.assign(d,{targetEnabled:true,target:100});p.aggregations["ability:早期发力"]={method:"mean",members:[d.id],transforms:{[d.id]:{kind:"ratio",direction:"higher"}}};const s=M.stats(E.resolve(r,p)),a=s.axes.find(x=>x.key==="早期发力");near(a.value,50);const result=s.evaluationResults.find(x=>x.subjectId===d.id);near(result.value,50);assert.equal(result.unit,"%PF");near(result.rawValue,500);});
test("migration and export preserve independent profiles including rollback snapshots",()=>{const {r,p}=fixture();p.previous=E.serializeProfile(p);const envelope=M.recordEnvelope(r,p);assert.equal(envelope.evaluationProfile.formatVersion,2);assert.equal(envelope.evaluationProfile.criteria,undefined);const lib=E.migrate(envelope);assert.equal(lib.evaluationProfiles[0].formatVersion,2);assert.equal(lib.catalog.measurementPolicyVersion,1);assert.ok(E.migrationReport(envelope,lib).records.length);assert.equal(JSON.stringify(lib).includes('"criteria":'),false);});
test("explicit advantages never turn target ratios into relative strengths",()=>{const {r,p}=fixture();for(const d of p.standards){d.ranges=[];d.rangesEnabled=false;}const s=M.stats(E.resolve(r,p));assert.equal(s.advantages.items.length,0);});
test("descriptors expose only supported forms and no ratio assumptions for signed slopes",()=>{const {r,p}=fixture(),subjects=E.ruleSubjects(r,p);assert.equal(subjects.find(x=>x.kind==="iso").capabilities.ranges,false);assert.equal(subjects.find(x=>x.kind==="balance").capabilities.target,false);assert.equal(subjects.find(x=>x.kind==="fixed").locked,true);assert.equal(E.measurementScale({id:"sprint_fvp_drf",measurementScale:"ratio"}),"unknown");assert.equal(E.measurementScale({id:"custom",ratioEligible:true}),"ratio");});
test("description edits keep standards while explicit project metric and ISO protocol versions invalidate them",()=>{
  const {r,p}=fixture(); const original=E.resolve(r,p);r.protocol.cmj+="新版说明";r.definitions.find(d=>d.id==="cmj_height").protocol+="说明修订";assert.equal(E.resolve(r,p).definitions.find(d=>d.id==="cmj_height").target,50);
  r.protocolIdentities.cmj.version++;assert.equal(E.resolve(r,p).definitions.find(d=>d.id==="cmj_height").referenceEnabled,false);
  r.protocolIdentities.iso.version++;assert.ok(E.resolve(r,p).data.iso.every(row=>row.target==="" && row.reference===undefined));
  assert.equal(original.definitions.find(d=>d.id==="cmj_height").target,50);
});
test("custom measurement identities copy from the directory and historical records keep their version",()=>{
  const r=M.normalizeRecord(customFixture()),catalog=M.mergeCatalog(M.normalizeCatalog(),r);catalog.protocolIdentities.timing={id:"timing-protocol",version:3};catalog.definitions.find(d=>d.id==="time").protocolIdentity={id:"timing-result",version:4};
  const next=M.recordFromCatalog(catalog,{}, {timing:true});assert.deepEqual(copy(next.protocolIdentities.timing),{id:"timing-protocol",version:3});assert.deepEqual(copy(next.definitions.find(d=>d.id==="time").protocolIdentity),{id:"timing-result",version:4});assert.notEqual(r.protocolIdentities.timing.version,3);
});
test("RFD has one canonical time subject while historical absolute force stays distinct and read-only",()=>{const {r,p}=fixture();const subjects=E.ruleSubjects(r,p);assert.equal(subjects.some(x=>x.id==="metric:imtp_rfd100"),false);assert.equal(subjects.filter(x=>x.id==="imtp-time:rfd:100").length,1);assert.equal(subjects.find(x=>x.id==="metric:imtp_f100").locked,true);assert.equal(subjects.find(x=>x.id==="imtp-time:force_pct_peak:100").locked,undefined);});
test("flat release history survives serialization and nested histories are rejected",()=>{const {p}=fixture();const prior=E.serializeProfile(p);p.releases=[prior];p.revision=2;assert.equal(E.serializeProfile(p).releases[0].revision,1);assert.ok(E.validateProfile(p));p.releases[0].releases=[];assert.throws(()=>E.validateProfile(p));});
test("shared evaluation adapts N and kgf without rewriting the scheme or its scores",()=>{const r=M.normalizeRecord(customFixture()),d=r.definitions.find(d=>d.id==="time");d.unit="N";const p=E.create(r);p.aggregations={"ability:速度":{method:"mean",members:["metric:time"],transforms:{"metric:time":{kind:"anchors",shape:"higher",points:[{value:0,score:0},{value:20,score:100}]}}}};const before=JSON.stringify(p),next=M.changeMetricUnit(r,"time","kgf","convert");const score=record=>M.stats(E.resolve(record,p)).axes.find(axis=>axis.key==="速度").value;near(score(r),50);near(score(next),50);assert.equal(JSON.stringify(p),before);near(E.resolve(next,p).definitions.find(d=>d.id==="time").target,10/9.80665);});
console.log(passed+" evaluation v2.19 model checks passed");
