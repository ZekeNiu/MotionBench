"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), c = vm.createContext({ console, Intl, crypto:require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "generic-viz", "model", "evaluation", "interventions", "viz", "report"]) vm.runInContext(fs.readFileSync(path.join(root, "src/ringside-" + name + ".js"), "utf8"), c);
const G=c.RingsideGenericViz, V=c.RingsideViz, M=c.RingsideModel, R=c.RingsideReport, E=c.RingsideEvaluation;
const clean = value => JSON.parse(JSON.stringify(value));
let passed=0;
function test(name, run) {run(); passed++; console.log("PASS "+name);}
function fixture(kind="bars") {
  const definitions=[{id:"qa_left",testId:"qa",name:"左侧握力",unit:"N",side:"left",entryScope:"attempt"}, {id:"qa_right",testId:"qa",name:"右侧握力",unit:"N",side:"right",entryScope:"attempt"}, {id:"qa_time",testId:"qa",name:"完成时间",unit:"s",entryScope:"attempt"}];
  const project={id:"qa",renderer:"scalar",definitions,visualization:{version:1,enabled:true,kind,metricIds:definitions.map(d=>d.id)}};
  const record={mode:"best"}, stats={values:{qa_left:30,qa_right:20,qa_time:0},repetitions:[],evaluationResults:[]};
  return {project,record,stats};
}
test("legacy records default to the existing table without opt-in charts",()=>{
  assert.deepEqual(clean(G.normalizeConfig()),{version:1,enabled:false,kind:"bars",metricIds:[]});
  const {project,record,stats}=fixture();delete project.visualization;assert.equal(G.buildProject(record,stats,project).enabled,false);
});
test("disabling charts preserves chosen kind and safe metric identifiers",()=>{
  assert.deepEqual(clean(G.normalizeConfig({enabled:false,kind:"trials",metricIds:["qa_left"]})),{version:1,enabled:false,kind:"trials",metricIds:["qa_left"]});
  assert.equal(G.validateConfig({version:1,enabled:false,kind:"trials",metricIds:[]}).length,0);
});
test("configuration rejects unsafe IDs duplicate choices and active out-of-project metrics",()=>{
  const {project}=fixture();for(const bad of ["__proto__","constructor","a.b",3]) assert.ok(G.validateConfig({version:1,enabled:false,kind:"bars",metricIds:[bad]}).some(i=>i.code==="unsafe-id"));
  assert.ok(G.validateConfig({...project.visualization,metricIds:["qa_left","qa_left"]},project.definitions,{testId:"qa"}).some(i=>i.code==="duplicate-id"));
  assert.ok(G.validateConfig({...project.visualization,metricIds:["elsewhere"]},project.definitions,{testId:"qa"}).some(i=>i.code==="unknown-metric"));
  assert.ok(G.validateConfig({...project.visualization,kind:"radar"},project.definitions).some(i=>i.code==="invalid-kind"));
});
test("native project graphs remain controlled by their fixed renderer",()=>{
  const {project,record,stats}=fixture();project.renderer="jumps";const result=G.buildProject(record,stats,project);assert.equal(result.figures.length,0);assert.equal(result.issues[0].code,"fixed-native-chart");
});
test("original values only share a quantitative scale when units exactly match",()=>{
  const {project,record,stats}=fixture(), result=G.buildProject(record,stats,project);
  assert.equal(result.figures.length,2);assert.equal(result.figures[0].unit,"N");assert.deepEqual(clean(result.figures[0].rows.map(row=>row.value)),[30,20]);assert.equal(result.figures[1].rows[0].value,0);assert.equal(result.figures[0].paired,true);
});
test("side pairing is declared data and never inferred from names",()=>{
  const {project,record,stats}=fixture();delete project.definitions[0].side;delete project.definitions[1].side;
  const result=G.buildProject(record,stats,project);assert.equal(result.figures[0].paired,false);assert.ok(result.figures[0].rows.every(row=>row.side===null));
});
test("missing and invalid results remain absent while real zeros stay zero",()=>{
  const {project,record,stats}=fixture();stats.values.qa_left="";stats.values.qa_right="bad";
  const result=G.buildProject(record,stats,project);assert.equal(result.figures.length,1);assert.equal(result.figures[0].rows[0].value,0);assert.equal(result.issues.filter(i=>i.code==="missing-result").length,2);
});
test("unspecified units do not imply comparable dimensions",()=>{
  const {project,record,stats}=fixture();project.definitions.forEach(d=>d.unit="");const result=G.buildProject(record,stats,project);
  assert.equal(result.figures.length,3);assert.ok(result.figures.every(figure=>figure.rows.length===1));assert.equal(result.issues.length,3);
});
test("scores and attainment percentages are never substituted for measured values",()=>{
  const {project,record,stats}=fixture();stats.axes=[{value:99}];stats.evaluationResults=[{metricId:"qa_left",attainment:80,scoreContributions:[{score:90}]}];
  const result=G.buildProject(record,stats,project);assert.equal(result.figures[0].rows[0].value,30);assert.equal("score" in result.figures[0].rows[0],false);
});
test("target charts require effective applicable standards with matching units and directions",()=>{
  const {project,record,stats}=fixture("target");stats.evaluationResults=[{kind:"metric",metricId:"qa_left",applicable:true,targetApplicable:true,target:25,unit:"N",direction:"higher"}, {kind:"metric",metricId:"qa_time",applicable:true,targetApplicable:true,target:6,unit:"s",direction:"lower"}];
  const result=G.buildProject(record,stats,project);assert.equal(result.figures.length,2);assert.equal(result.figures[0].rows[0].target,25);assert.equal(result.figures[1].rows[0].direction,"lower");assert.equal(result.figures[1].rows[0].value,0);
  stats.evaluationResults[0].targetApplicable=false;stats.evaluationResults[1].unit="ms";const unavailable=G.buildProject(record,stats,project);assert.equal(unavailable.figures.length,0);assert.ok(unavailable.issues.some(i=>i.code==="target-unit-mismatch"));
});
test("trial plots retain true ordinal positions real observations and selected IDs",()=>{
  const {project,record,stats}=fixture("trials");project.visualization.metricIds=["qa_left"];
  stats.repetitions=[{testId:"qa",key:"qa",fields:[{id:"qa_left"}],selectedIds:["third"],attempts:[{id:"first",index:1,observations:{qa_left:10},values:{qa_left:10}},{id:"second",index:2,observations:{qa_left:null},values:{qa_left:""}},{id:"third",index:3,observations:{qa_left:30},values:{qa_left:30}}]}];
  const result=G.buildProject(record,stats,project);assert.deepEqual(clean(result.figures[0].points.map(p=>p.index)),[1,2,3]);assert.deepEqual(clean(result.figures[0].points.map(p=>p.value)),[10,null,30]);assert.equal(result.figures[0].points[2].selected,true);assert.equal(result.figures[0].points[0].selected,false);
  assert.equal(result.issues[0].code,"missing-attempts");const html=V.genericChart(result.figures[0],{width:320});assert.doesNotMatch(html,/<polyline|<path/);assert.equal((html.match(/data-generic-point=/g)||[]).length,2);
});
test("one actual valid attempt renders one point while retaining partial-missing original ordinals",()=>{
  const {project,record,stats}=fixture("trials");project.visualization.metricIds=["qa_left"];
  stats.repetitions=[{testId:"qa",key:"qa",fields:[{id:"qa_left"}],selectedIds:["real"],attempts:[{id:"empty",index:4,observations:{qa_left:null},values:{qa_left:""}},{id:"real",index:7,observations:{qa_left:20},values:{qa_left:20}},{id:"invalid",index:9,observations:{qa_left:null},values:{qa_left:"invalid"}}]}];
  const result=G.buildProject(record,stats,project);assert.equal(result.figures.length,1);assert.deepEqual(clean(result.figures[0].points.map(point=>[point.index,point.value])),[[4,null],[7,20],[9,null]]);assert.deepEqual(clean(result.figures[0].range),[20,20]);assert.equal(result.figures[0].points[1].selected,true);
  const html=V.genericChart(result.figures[0],{width:320});assert.equal((html.match(/data-generic-point=/g)||[]).length,1);assert.match(html,/第 7 次/);assert.doesNotMatch(html,/<polyline|<path|NaN|Infinity/);assert.ok(result.issues.some(issue=>issue.code==="missing-attempts"));assert.ok(!result.issues.some(issue=>issue.code==="too-few-attempts"));
});
test("zero valid stored attempts give a missing-value reason without a fabricated point",()=>{
  const {project,record,stats}=fixture("trials");project.visualization.metricIds=["qa_left"];
  stats.repetitions=[{testId:"qa",key:"qa",fields:[{id:"qa_left"}],selectedIds:[],attempts:[{id:"empty",index:1,observations:{qa_left:null},values:{qa_left:""}}]}];
  const result=G.buildProject(record,stats,project);assert.equal(result.figures.length,0);assert.equal(result.issues[0].code,"no-valid-attempts");assert.match(result.issues[0].message,/已保存试次.*没有有效数值/);
});
test("single stored results are not synthesized into repeated attempts",()=>{
  const {project,record,stats}=fixture("trials");const result=G.buildProject(record,stats,project);assert.equal(result.figures.length,0);assert.ok(result.issues.every(i=>i.code==="no-attempt-data"));
});
test("long metric selections become bounded figures while preserving one unit domain",()=>{
  const {project,record,stats}=fixture();project.definitions=Array.from({length:14},(_,i)=>({id:"m"+i,testId:"qa",name:"指标"+i,unit:"N"}));project.visualization.metricIds=project.definitions.map(d=>d.id);stats.values=Object.fromEntries(project.definitions.map((d,i)=>[d.id,i-3]));
  const result=G.buildProject(record,stats,project);assert.deepEqual(clean(result.figures.map(figure=>figure.rows.length)),[6,6,2]);assert.ok(result.figures.every(figure=>JSON.stringify(figure.range)===JSON.stringify([-3,10])));
});
test("all chart data and SVG rendering are pure and escape supplied text",()=>{
  const {project,record,stats}=fixture("target");project.definitions[0].name='<img src=x onerror="bad">';stats.evaluationResults=[{kind:"metric",metricId:"qa_left",applicable:true,targetApplicable:true,target:25,unit:"N",direction:"higher"}];const before=JSON.stringify({project,record,stats});
  const result=G.buildProject(record,stats,project);for(const width of [240,320,620]){const svg=V.genericChart(result.figures[0],{width});assert.doesNotMatch(svg,/<img|NaN|Infinity/);assert.match(svg,/&lt;img/);assert.match(svg,/data-target-direction="higher"/);assert.match(svg,/≥ 25/);}assert.equal(JSON.stringify({project,record,stats}),before);
});
function actualRecord(kind="bars", independent=false) {
  const r=M.defaults();r.demo=false;Object.keys(r.enabled).forEach(id=>r.enabled[id]=false);
  const test={id:"generic_qa",name:"通用测量（合成）",category:"performance",primaryAbility:"最大力量",primaryMetricId:"qa_force",selectionDirection:"higher",...(independent?{metricSelection:"independent"}:{}),visualization:{version:1,enabled:true,kind,metricIds:["qa_force","qa_time"]}};
  r.customTests.push(test);r.projectSnapshots ||= [];r.projectSnapshots.push(test);r.enabled.generic_qa=true;
  r.definitions.push(...[{id:"qa_force",name:"握力",unit:"N",direction:"higher",side:"left"},{id:"qa_time",name:"完成时间",unit:"s",direction:"lower"}].map(d=>({...d,testId:test.id,category:"performance",ability:"最大力量",entryScope:"attempt",referenceEnabled:false,target:null,ranges:[],scoring:false})));
  r.data.generic_qa=[{id:"qa-a",metrics:{qa_force:20,qa_time:6},notes:"首试次"},{id:"qa-b",metrics:{qa_force:30,qa_time:7},notes:"第二试次"},{id:"qa-c",metrics:{qa_force:25,qa_time:5},notes:"第三试次"}];
  return r;
}
test("report charts consume model-selected whole attempts instead of choosing metric maxima",()=>{
  const r=actualRecord(), report=R.build(r), charts=report.genericVisuals.generic_qa;assert.equal(report.stats.values.qa_force,30);assert.equal(report.stats.values.qa_time,7);
  assert.deepEqual(clean(charts.figures.flatMap(figure=>figure.rows.map(row=>row.value))),[30,7]);const html=R.render(report);assert.match(html,/data-chart-kind="genericChart"/);assert.match(html,/data-metric-id="qa_force"/);assert.match(html,/data-metric-id="qa_time"/);
});
test("independent metric results and selected point markers follow each actual model group",()=>{
  const r=actualRecord("trials",true), report=R.build(r);assert.equal(report.stats.values.qa_force,30);assert.equal(report.stats.values.qa_time,5);
  const force=report.genericVisuals.generic_qa.figures.find(f=>f.metricId==="qa_force"), time=report.genericVisuals.generic_qa.figures.find(f=>f.metricId==="qa_time");assert.deepEqual(clean(force.points.filter(p=>p.selected).map(p=>p.id)),["qa-b"]);assert.deepEqual(clean(time.points.filter(p=>p.selected).map(p=>p.id)),["qa-c"]);
});
test("turning on display charts keeps calculations scoring fingerprint and manual narrative intact",()=>{
  const r=actualRecord(), fingerprint=M.fingerprint(r), stats=M.stats(r), before=JSON.stringify(r);r.narrative.text="人工正文保留";
  r.projectSnapshots.find(p=>p.id==="generic_qa").visualization.kind="target";r.customTests.find(p=>p.id==="generic_qa").visualization.kind="target";
  assert.equal(M.fingerprint({...r,narrative:JSON.parse(before).narrative}),fingerprint);assert.deepEqual(clean(M.stats(r).values),clean(stats.values));const snapshot=JSON.stringify(r);R.render(R.build(r));assert.equal(JSON.stringify(r),snapshot);assert.equal(r.narrative.text,"人工正文保留");
});
test("project snapshots preserve historic chart choices through record normalization",()=>{
  const r=actualRecord(), normalized=M.normalizeRecord(r);assert.deepEqual(clean(normalized.projectSnapshots.find(p=>p.id==="generic_qa").visualization),{version:1,enabled:true,kind:"bars",metricIds:["qa_force","qa_time"]});
});
test("configured projects with missing data retain a result table and truthful graph reasons",()=>{
  const r=actualRecord();r.data.generic_qa=[];const report=R.build(r), html=R.render(report);assert.equal(report.genericVisuals.generic_qa.figures.length,0);assert.match(html,/data-chart-issue="missing-result"/);assert.match(html,/data-metric-id="qa_force"/);assert.match(html,/不以零代替缺测/);assert.doesNotMatch(html,/data-chart-kind="genericChart"/);
});
console.log(passed+" generic visualization v2.21 model checks passed");
