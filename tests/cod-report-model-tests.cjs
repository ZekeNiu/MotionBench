"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {context,fixture}=require("./helpers/calculation-fixture.cjs"),c=context(),M=c.RingsideModel,G=c.RingsideGenericReport,copy=v=>JSON.parse(JSON.stringify(v));
for(const name of ["longitudinal-view","horizontal-view"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
const project=m=>m.projects.find(p=>p.id==="calc_turn"),cod=p=>p.metrics.find(row=>row.metricId==="calc_deficit");
const nextRecord=r=>({...copy(r),recordId:r.recordId+"_later",athlete:{...r.athlete,date:"2026-05-01"}});
function records(){return [4,3,null,2].map((time,i)=>{const r=fixture(c);r.recordId="cod_record_"+i;r.athleteId="cod_athlete";r.athlete.date=["2026-02-01","2026-02-11","2026-03-11","2026-04-11"][i];r.data.calc_turn=[{id:"turn_"+i,metrics:{calc_turn_time:time??4}}];if(time===null)r.data.calc_run=[];return r;});}
function horizontal(rs,groupOnly=false){return c.RingsideHorizontal.build(rs,{participants:groupOnly?[]:rs.map(r=>({athleteId:r.athleteId,recordId:r.recordId})),athletes:rs.map(r=>({id:r.athleteId,profile:{name:"Synthetic COD athlete",sex:"男"}})),catalog:M.mergeCatalog(null,rs[0]),references:[{id:"cod_cohort",label:"Synthetic paired reference",scope:"all",sampling:"latest"}],window:{kind:"all"},mode:"best"});}
test("dedicated COD bars preserve positive zero and negative values and obey visualization disable",()=>{
 for(const [time,value]of [[4,1],[3,0],[2,-1]]){const r=fixture(c);r.data.calc_turn=[{id:"turn",metrics:{calc_turn_time:time}}];const report=c.RingsideReport.build(r),p=report.projects.find(p=>p.id==="calc_turn"),chart=G.buildChart(report,p);assert.equal(chart.kind,"bar");assert.equal(chart.panels[0].items[0].value,value);assert.deepEqual(copy(chart.panels[0].items.map(item=>item.id)),["calc_deficit"]);p.reportView=G.createView(r,p.id,{kind:"none"});assert.equal(G.buildChart(report,p).kind,"none");}
});
test("missing COD retains measured source table and internal reason without four visible explanation paths",()=>{
 const r=fixture(c);r.data.calc_run=[];const report=c.RingsideReport.build(r),html=c.RingsideReport.render(report);assert.match(report.stats.calculationResults.calc_deficit.reason,/参照/);assert.doesNotMatch(html,/缺少有效直线参照时间|缺少有效变向总时间|尚未绑定直线参照|本次记录未包含直线参照项目/);assert.match(html,/cod-results/);assert.match(html,/直线参照/);
 const model=c.RingsideLongitudinal.build([r,nextRecord(r)],{profile:null}),row=cod(project(model));assert.equal(row.cells[0].value,null);assert.equal(row.cells[0].notes,"");assert.doesNotMatch(c.RingsideLongitudinalView.render(model).details,/缺少有效直线参照时间/);
});
test("a completely unmeasured COD does not force a block even when its straight reference is measured",()=>{
 for(const runMeasured of [true,false]){const r=fixture(c);r.data.calc_turn=[];if(!runMeasured)r.data.calc_run=[];const report=c.RingsideReport.build(r);assert.doesNotMatch(c.RingsideReport.render(report),/id="detail-calc_turn"/);assert.equal(report.stats.calculationResults.calc_deficit.reference,runMeasured?3:null);
 const long=c.RingsideLongitudinal.build([r,nextRecord(r)],{profile:null});assert.equal(project(long),undefined);
 const other=copy(r);other.athleteId="cod_other";other.recordId="cod_other_empty";const h=horizontal([r,other]);assert.doesNotMatch(c.RingsideHorizontalView.render(h).details,/horizontal-cod_cohort-calc_turn/);}
 const row={id:"calc_deficit_reference",testId:"calc_turn",context:{calculation:{kind:"cod-deficit"},role:"reference"},cells:[{value:3,notes:""}],benchmark:{mean:3}};assert.equal(G.hasCODContent({id:"calc_turn",metrics:[row]},[]),false);
});
test("longitudinal COD uses real date coordinates and missing observations break only their adjacent segments",()=>{
 const rs=records(),model=c.RingsideLongitudinal.build(rs,{profile:null}),p=project(model),specs=c.RingsideLongitudinalView.projectFigures(p,model,{specsOnly:true});assert.equal(specs.length,1);const spec=specs[0];assert.equal(spec.kind,"cod-trend");assert.deepEqual(copy(spec.values.map(v=>v?.value)),[1,0,null,-1]);const html=c.RingsideLongitudinalView.draw(spec,520);assert.equal((html.match(/data-cod-point=/g)||[]).length,3);assert.equal((html.match(/data-observed-change="result"/g)||[]).length,1);assert.doesNotMatch(html,/<rect\b/);assert.match(html,/2026/);assert.match(html,/04-11/);
 const positions=[...html.matchAll(/<circle[^>]*cx="([^"]+)"[^>]*data-cod-point="(\d+)"/g)].map(x=>[Number(x[2]),Number(x[1])]);assert.equal(positions.length,3);assert.ok(Math.abs((positions[1][1]-positions[0][1])/(positions[2][1]-positions[0][1])-10/69)<.02);
});
test("the horizontal renderer keeps existing bars and the group aggregate remains the mean of paired deficits",()=>{
 const rs=records().slice(0,3).map((r,i)=>({...r,athleteId:"cod_person_"+i})),h=horizontal(rs),reference=h.references[0],p=reference.projects.find(p=>p.id==="calc_turn"),row=cod(p);assert.equal(row.benchmark.n,2);assert.equal(row.benchmark.mean,.5);const html=c.RingsideHorizontalView.render(h).details;assert.match(html,/horizontal-figures/);assert.doesNotMatch(html,/cod-trend|缺少有效直线参照时间/);assert.match(html,/&quot;kind&quot;:&quot;bars&quot;/);
 const only=c.RingsideHorizontalView.render(horizontal(rs,true)).details;assert.match(only,/horizontal-figures/);assert.doesNotMatch(only,/缺少有效直线参照时间/);
});
test("an explicitly disabled historical COD visualization stays out of the line without altering its table value",()=>{
 const rs=records().slice(0,2);rs[1].views.genericReports.calc_turn=G.createView(rs[1],"calc_turn",{kind:"none"});const model=c.RingsideLongitudinal.build(rs,{profile:null}),p=project(model),spec=c.RingsideLongitudinalView.projectFigures(p,model,{specsOnly:true})[0];assert.equal(cod(p).cells[1].value,0);assert.equal(spec.values[1],null);assert.equal(spec.values[0].value,1);
});
test("legacy frozen notes project calculation reasons away while preserving manual notes and all stored facts",()=>{
 const rs=records().slice(0,3);rs[2].data.calc_turn[0].notes="Synthetic operator note";const model=c.RingsideLongitudinal.build(rs,{profile:null}),p=project(model),row=cod(p);row.cells=copy(row.cells);const cell=row.cells[2];cell.notes="缺少有效直线参照时间；Synthetic operator note";cell.assessment.reason="缺少有效直线参照时间";cell.display.reason="缺少有效直线参照时间";const before=JSON.stringify(model),html=c.RingsideLongitudinalView.render(model).details;assert.doesNotMatch(html,/缺少有效直线参照时间/);assert.match(html,/Synthetic operator note/);assert.equal(JSON.stringify(model),before);
 const record=copy(rs[2]);record.customValues.calc_deficit={notes:"缺少有效直线参照时间"};const shown=G.displayCODCell(cell,row,record);assert.match(shown.notes,/缺少有效直线参照时间/);assert.match(shown.notes,/Synthetic operator note/);
});
test("legacy frozen horizontal notes and displayNotes are cleaned without changing snapshot values or raw notes",()=>{
 const rs=records().slice(0,3).map((r,i)=>({...r,athleteId:"legacy_person_"+i}));rs[2].data.calc_turn[0].notes="Synthetic original note";const model=horizontal(rs),row=cod(model.references[0].projects.find(p=>p.id==="calc_turn"));row.cells=copy(row.cells);row.cells[2].notes="缺少有效直线参照时间；Synthetic original note";row.cells[2].displayNotes=["缺少有效直线参照时间","Synthetic original note"];const before=JSON.stringify(model),html=c.RingsideHorizontalView.render(model).details;assert.doesNotMatch(html,/缺少有效直线参照时间/);assert.match(html,/Synthetic original note/);assert.equal(JSON.stringify(model),before);
});
console.log(`${passed} COD report checks passed`);
