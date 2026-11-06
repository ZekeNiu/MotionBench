"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const {context} = require("./helpers/longitudinal-fixture.cjs"), c = context();
for (const name of ["metric-semantics","comparison","horizontal","team","longitudinal-view","team-view","team-comparison-view"]) vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const M = c.RingsideModel, Team = c.RingsideTeam, View = c.RingsideTeamView, ComparisonView = c.RingsideTeamComparisonView;
const copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name,run) { run(); passed++; console.log("PASS "+name); }
function record(id,date,value) {
  const r=M.defaults();r.demo=false;r.athleteId=id;r.recordId=id+"-"+date;r.athlete.name=id==="a"?"同名队员":"合成队员"+id;r.athlete.date=date;r.athlete.birthDate="2000-01-01";r.athlete.sex="男";
  Object.keys(r.enabled).forEach(key=>r.enabled[key]=false);r.enabled.view_test=true;
  r.customTests.push({id:"view_test",name:"团队视图合成测试",category:"performance",primaryMetricId:"view_value",selectionDirection:"higher"});
  r.definitions.push({id:"view_value",testId:"view_test",name:"合成跳高",unit:"cm",category:"performance",entryScope:"attempt",measurementScale:"ratio",resultMeaning:"numeric",direction:"higher",directionStatus:"confirmed",ranges:[],referenceEnabled:false});
  r.data.view_test=[{id:r.recordId+"-trial",metrics:{view_value:value}}];return M.normalizeRecord(r);
}
function fixture() {
  const dates=["2026-01-01","2026-01-03","2026-02-01"],records=[record("a",dates[0],10),record("b",dates[0],20),record("a",dates[1],15),record("a",dates[2],20),record("c",dates[2],100)],athletes=["a","b","c","empty"].map(id=>({id,profile:{name:id==="a"?"同名队员":"合成队员"+id},groupId:"team"}));
  const configuration={analysisMode:"longitudinal",athleteIds:athletes.map(a=>a.id),dates,dateParticipants:dates.map(date=>({date,participants:athletes.map(a=>({athleteId:a.id,recordId:records.find(r=>r.athleteId===a.id&&r.athlete.date===date)?.recordId||""}))})),mode:"best"};
  const longitudinal=Team.build(records,{configuration,athletes});
  const objects=[{id:"team-first",label:"甲队",kind:"team",participants:configuration.dateParticipants[0].participants},{id:"team-last",label:"乙队",kind:"team",participants:configuration.dateParticipants[2].participants},{id:"reference",label:"历史参考",kind:"reference",reference:{scope:"all",sampling:"period-mean",window:{kind:"all"}}}];
  const horizontal=Team.build(records,{configuration:{analysisMode:"horizontal",mode:"best",objects},athletes});
  return {longitudinal,horizontal,records,athletes};
}
const f=fixture();
function runTests() {
test("summary never turns absent evaluation into zero concerns",()=>{
  const cards=View.summaryCards({participants:[{},{}],risk:{assessedCount:0,flaggedCount:0,regions:[]},overview:{axes:[]}});
  assert.equal(cards[0].value,2);assert.equal(cards[1].value,"—");assert.equal(cards[2].value,"待评价");assert.equal(cards[3].value,"待评价");
  assert.equal(View.summaryCards({participants:[{}],risk:{assessedCount:1,flaggedCount:0,regions:[]}})[1].value,0);
});
test("top concern regions preserve tied counts and their distinct denominators",()=>{
  const cards=View.summaryCards({summary:{total:30},risk:{assessedCount:25,flaggedCount:10,regions:[{label:"肩",flaggedCount:8,assessedCount:20},{label:"膝",flaggedCount:8,assessedCount:25},{label:"踝",flaggedCount:2,assessedCount:3}]}});
  assert.equal(cards[2].value,"肩、膝");assert.match(cards[2].note,/8\/20/);assert.match(cards[2].note,/8\/25/);assert.doesNotMatch(cards[2].value,/踝/);
});
test("relative weakness uses supplied capability scores, retains ties and never infers failed grades",()=>{
  const axes=[{label:"力量",value:60,n:8,total:10},{label:"速度",value:60,n:4,total:10},{label:"耐力",value:90,n:10,total:10}],model={overview:{axes}};
  const card=View.summaryCards(model)[3];assert.equal(card.value,"力量、速度");assert.match(card.note,/8\/10/);assert.match(card.note,/4\/10/);assert.doesNotMatch(card.note,/未达标|不合格/);
  assert.equal(View.summaryCards({overview:{axes:[axes[0]]}})[3].value,"暂无法比较");assert.equal(View.summaryCards({overview:{axes:axes.slice(0,2)}})[3].value,"各能力得分一致");
});
test("actual-date group means and same-person changes remain separate",()=>{
  const row=f.longitudinal.projects[0].metrics[0],out=View.render(f.longitudinal);
  assert.equal(row.cells[0].value,15);assert.equal(row.cells[2].value,60);assert.equal(row.pairedChanges.overall.delta,10);assert.equal(row.pairedChanges.overall.n,1);
  assert.match(out.details,/各日期群体均值/);assert.match(out.details,/同人配对变化/);assert.match(out.details,/2026-01-03/);assert.doesNotMatch(out.details,/个人逐日结果|team-personal-history/);assert.match(out.details,/均值趋势/);assert.match(out.details,/data-team-member-category="empty"/);
});
test("horizontal reports retain all objects with no forced focus or baseline",()=>{
  const out=View.render(f.horizontal);
  assert.match(out.controls,/<option value="" selected>全部对象/);assert.match(out.controls,/<option value="" selected>无/);
  for(const id of ["team-first","team-last","reference"])assert.match(out.details,new RegExp('data-team-column="'+id+'"'));
  assert.equal(ComparisonView.objectSummary(f.horizontal.objects[2])[1].value,"—");
});
test("changing focus or baseline cannot change any frozen source or remove objects",()=>{
  const before=JSON.stringify(f.horizontal),out=View.render(f.horizontal,{views:{focusObjectId:"team-last",baselineObjectId:"team-first"}});
  assert.equal(JSON.stringify(f.horizontal),before);assert.match(out.summary,/data-team-summary-object="team-last"/);assert.doesNotMatch(out.summary,/data-team-summary-object="team-first"/);
  for(const id of ["team-first","team-last","reference"])assert.match(out.details,new RegExp('data-team-column="'+id+'"'));
  assert.match(out.details,/\+45/);assert.match(out.details,/比较基准/);
});
test("print repeats metric labels across date groups and includes one complete mean trend",()=>{
  const model=copy(f.longitudinal),periods=Array.from({length:7},(_,i)=>({id:"p"+i,date:"2026-03-0"+(i+1)})),row=model.projects[0].metrics[0];
  row.cells=periods.map((_,i)=>row.cells[i%3]);
  const html=ComparisonView.comparisonTable([row],periods,{print:true,longitudinal:true,mini:true});assert.equal((html.match(/data-team-comparison-metric=/g)||[]).length,3);assert.equal((html.match(/<th scope="col">均值趋势<\/th>/g)||[]).length,1);assert.equal((html.match(/data-trend-point=/g)||[]).length,7);
  const out=View.render(f.horizontal,{print:true});assert.equal(out.controls,"");assert.doesNotMatch(out.details,/data-team-metric=|data-team-refresh|<select/);
  assert.equal((out.summary.match(/class="micro-cards team-summary-set"/g)||[]).length,3);
});
test("summary mini trends preserve every date, break missing results and stay neutral",()=>{
  const row=copy(f.longitudinal.projects[0].metrics[0]);row.cells[1]=null;
  const html=ComparisonView.summaryTrend(row,f.longitudinal.periods,false);assert.equal((html.match(/data-trend-point=/g)||[]).length,3);assert.doesNotMatch(html,/data-trend-segment=/);
  assert.match(ComparisonView.summaryTrend(f.longitudinal.projects[0].metrics[0],f.longitudinal.periods,false),/data-result-trend=/);
});
test("numeric category codes use count distributions without any continuous trend",()=>{
  const records=copy(f.records);records.forEach(record=>{const definition=record.definitions.find(item=>item.id==="view_value");definition.resultMeaning="category";definition.direction="none";definition.directionStatus="confirmed";});
  const model=Team.build(records,{configuration:f.longitudinal.configuration,athletes:f.athletes}),row=model.projects[0].metrics[0],out=View.render(model);
  assert.equal(row.meaning,"category");assert.doesNotMatch(out.details,/data-result-trend=|data-trend-segment=|均值趋势|个人逐日结果/);assert.match(out.details,/人数分布/);assert.equal((out.details.match(/data-team-column=/g)||[]).length,3);
});
test("default member charts preserve roster slots and horizontal numeric ordering",()=>{
  const out=View.render(f.longitudinal),horizontal=View.render(f.horizontal);
  assert.match(out.details,/<option value="members" selected>/);assert.match(out.details,/<option value="column" selected>/);assert.equal((out.details.match(/data-team-member-value=/g)||[]).length,5);assert.equal((out.details.match(/data-team-missing-slot/g)||[]).length,7);
  assert.match(horizontal.details,/数值/);assert.doesNotMatch(horizontal.details,/个人逐日结果/);
  assert.equal((horizontal.details.match(/data-team-member-value=/g)||[]).length,7);
});
test("comparison chart choices use real samples and never alter source snapshots",()=>{
  const before=JSON.stringify(f),project=f.longitudinal.projects[0].id;
  for(const kind of ["column","dot","box","histogram"])assert.match(View.render(f.longitudinal,{views:{charts:{[project]:{data:"members",kind}}}}).details,/data-team-comparison-chart/);
  const trend=View.render(f.longitudinal,{views:{charts:{[project]:{data:"mean",kind:"trend"}}}});assert.match(trend.details,/data-cod-point/);
  const box=View.render(f.longitudinal,{views:{charts:{[project]:{data:"members",kind:"box"}}}});assert.equal((box.details.match(/data-team-box-member=/g)||[]).length,5);assert.doesNotMatch(box.details,/data-team-box="/);
  assert.equal(JSON.stringify(f),before);
});
console.log(`${passed} team comparison view checks passed`);
}
if (require.main === module) runTests();
module.exports={fixture,context:c};
