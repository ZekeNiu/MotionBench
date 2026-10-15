"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const {context,createFixture}=require("./helpers/longitudinal-fixture.cjs");
const c=context();vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-longitudinal-view.js"),"utf8"),c);
const V=c.RingsideLongitudinalView,L=c.RingsideLongitudinal;
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const specs=html=>[...html.matchAll(/data-longitudinal-chart="([^"]+)"/g)].map(match=>JSON.parse(decode(match[1])));
let passed=0;function test(name,run){run();passed++;console.log("PASS "+name);}
const f=createFixture(c,3),model=L.build(f.records,f),before=JSON.stringify(f.records),view=V.render(model),all=view.body+view.overview+view.details;
test("render retains source records and separates overview from detailed capability analysis",()=>{assert.equal(JSON.stringify(f.records),before);assert.match(view.details,/能力结构分析/);assert.doesNotMatch(view.overview,/发展方向|训练方向|directionMetrics/);assert.equal(specs(view.overview)[0].max,100);assert.equal(view.legend,"");assert.equal((view.overview.match(/class="longitudinal-legend"/g)||[]).length,1);});
test("all rich built-in graph families retain their own axes and representations",()=>{
 const list=specs(view.details);for(const title of["FMS 动作表现","等长力量","CMJ","IMTP 力时曲线","负荷速度曲线","冲刺FVP","跳跃FVP","弹性框架"]){assert.ok(list.some(s=>s.title.includes(title)),title);}
 const imtp=list.find(s=>s.title==="IMTP 力时曲线");assert.equal(imtp.xLabel,"时间 · ms");assert.equal(imtp.series.length,3);assert.ok(imtp.series.every(s=>s.points.some(p=>p.x===100)));
 const fvp=list.find(s=>s.title==="冲刺FVP");assert.equal(fvp.xLabel,"速度 V · m/s");assert.ok(fvp.series.some(s=>s.right));assert.ok(fvp.series.some(s=>s.label.includes("最优")));assert.ok(fvp.series.filter(s=>s.connect!==false).every(s=>s.points.length>=2));
 const lactate=list.find(s=>s.xLabel==="阶段速度 · m/s");assert.ok(lactate);assert.equal(lactate.rightLabel,"心率 · bpm");
 assert.doesNotMatch(all,/NaN|Infinity|纵向趋势|回归趋势|时间斜率|p 值|Cohen|MDC/);
 assert.ok(model.projects.filter(p=>["fvp","sprint-fvp"].includes(p.renderer)).every(p=>p.metrics.some(row=>row.section==="profile")&&p.metrics.some(row=>row.section==="elasticity")));
 assert.match(view.details,/实测剖面 · 剖面斜率 SFV/);
});
test("IMTP uses the original per-trial peak percentages and retains peak references",()=>{const chart=specs(view.details).find(s=>s.title==="IMTP 力时曲线"),raw=model.periods[0].stats.raw.forceTime;assert.equal(chart.series[0].points.find(p=>p.x===100).y,raw.points.find(p=>p.timeMs===100).percent);assert.equal(chart.series[0].points.find(p=>p.x===0).y,raw.baselinePercent);assert.equal(chart.horizontalMarkers[0].y,100);});
test("coincident IMTP peak references retain every value in readable dated legend entries",()=>{const chart=specs(view.details).find(s=>s.title==="IMTP 力时曲线"),peakOnly={...chart,series:chart.series.map(s=>({...s,points:[]}))};for(const print of[false,true]){const html=V.draw(peakOnly,450,print),svgs=[...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map(m=>m[0]).join("");assert.doesNotMatch(svgs,/<text[^>]*>[^<]*峰值 [\d,]+ N<\/text>/);assert.equal((html.match(/data-reference-label=/g)||[]).length,3);for(const marker of chart.horizontalMarkers)assert.ok(html.includes(marker.label.slice(marker.label.lastIndexOf(" · ")+3)));}});
test("IMTP force overlays convert kgf to the common N axis",()=>{const fixture=createFixture(c,3),m=L.build(fixture.records,fixture),last=m.periods.at(-1),raw=last.stats.raw.forceTime,expected=raw.points[0].force;last.record.imtpConfig.unit="kgf";last.record.views.imtp.yAxis="force";raw.peakForce/=9.80665;raw.baselineForce/=9.80665;raw.points.forEach(p=>p.force/=9.80665);const chart=specs(V.projectFigures(m.projects.find(p=>p.id==="imtp"),m))[0];assert.equal(chart.yLabel,"力 · N");assert.ok(Math.abs(chart.series.at(-1).points.find(p=>p.x===100).y-expected)<1e-8);});
test("FVP retains force and power load points and both original fitted bands",()=>{const chart=specs(view.details).find(s=>s.title==="跳跃FVP · SJ");assert.ok(chart.series.some(s=>s.right&&s.connect===false&&s.label.includes("实测负荷点")));assert.ok(chart.series.some(s=>s.right&&s.band?.length));assert.ok(chart.series.some(s=>!s.right&&s.band?.length));assert.ok(chart.series.some(s=>s.label.includes("Pmax · V₀/2")));});
test("jump bars retain height on the left and RSI on the right with dated observed connections",()=>{
 const dj=specs(view.details).find(s=>s.title==="跳跃测试");assert.ok(dj?.rsi);assert.equal(new Set(dj.values.map(v=>v.groupId)).size,5);const html=V.draw(dj,450);assert.match(html,/RSI · m\/s/);assert.match(html,/data-observed-change="rsi"/);assert.match(html,/data-observed-change="result"/);assert.match(html,/2026/);assert.match(html,/柱：高度（左轴）；点：RSI（右轴）/);
});
test("observed connections break at absent and incompatible dates",()=>{
 const base={kind:"columns",title:"Jump",unit:"cm",periods:[1,2,3].map(i=>({id:"p"+i,date:"2026-0"+i+"-20"})),values:[{value:20},{value:null},{value:25}]};assert.doesNotMatch(V.draw(base,450),/data-observed-change=/);
 base.values=[{value:20},{value:23,comparableToPrevious:false},{value:25,comparableToPrevious:true}];assert.equal((V.draw(base,450).match(/data-observed-change="result"/g)||[]).length,1);
});
test("risk uses measured axes only and one/two axes never invent a polygon",()=>{
 const base={kind:"radar",title:"筛查",max:3,risk:true,axes:[{key:"knee_l",label:"左膝"}],series:[{id:"a",label:"a",color:"#345678",values:[null]},{id:"b",label:"b",color:"#567834",values:[1]}]};assert.doesNotMatch(V.draw(base,450),/<polygon/);
 base.axes.push({key:"knee_r",label:"右膝"});base.series[0].values.push(2);base.series[1].values.push(3);assert.doesNotMatch(V.draw(base,450),/<polygon/);
 const actual=specs(view.body)[0];assert.deepEqual(actual.axes.map(a=>a.key),Array.from(model.risk.axes,a=>a.key));assert.ok(actual.axes.length<=18);
});
test("FMS score zero survives instead of becoming missing or the risk scale",()=>{
 const sample={kind:"radar",title:"FMS",max:3,fms:true,axes:Array.from({length:7},(_,i)=>({key:String(i),label:"动作"+i})),series:[{id:"a",label:"2026-01-01",color:"#345678",values:[0,1,2,3,null,2,3]}]};const html=V.draw(sample,450);assert.match(html,/动作0 0 \/ 3/);assert.match(html,/0 疼痛/);assert.doesNotMatch(html,/NaN|Infinity/);
});
test("long selections keep all dates in chart continuations and date tables",()=>{
 const fixture=createFixture(c,8),m=L.build(fixture.records,fixture),html=V.render(m),list=specs(html.details),cmj=list.find(s=>s.title==="跳跃测试");assert.equal(new Set(cmj.periods.map(p=>p.id)).size,8);const draw=V.draw(cmj,300,true);for(const p of m.periods)assert.ok(draw.includes('data-record-id="'+p.id+'"'));assert.ok((draw.match(/<svg/g)||[]).length>1);for(const p of m.periods)assert.ok(html.details.includes('data-record-id="'+p.id+'"'));assert.doesNotMatch(draw,/NaN|Infinity/);
});
test("tables preserve mean SD CV and fixed overall/recent changes without unsupported statistics",()=>{
 const html=V.table(model.projects.find(p=>p.id==="cmj").metrics,model.periods);assert.match(html,/±/);assert.match(html,/CV/);assert.match(html,/首末/);assert.match(html,/近期/);assert.doesNotMatch(html,/显著性|效果量|p 值|MDC/);
 const two=createFixture(c,2),m=L.build(two.records,two);assert.doesNotMatch(V.table(m.projects.find(p=>p.id==="cmj").metrics,m.periods),/近期/);
});
test("uncalculable changes have neither result placeholders nor empty change columns",()=>{const row={id:"absent",name:"缺测",unit:"cm",cells:[{value:10},null],changes:{overall:{available:false,reason:"端点缺测"},recent:null}};const html=V.table([row],model.periods.slice(0,2),{wrapped:false});assert.doesNotMatch(html,/变化|端点缺测|无可比结果/);assert.match(html,/—/);});
test("specialized precision and tiny nonzero changes remain visible on screen and print",()=>{const row={id:"lvp-fit:bench:slope",name:"拟合斜率",unit:"m/s/kg",cells:[{value:-.0123},{value:-.0122}],changes:{overall:{available:true,delta:.0001,percent:.00003}}};for(const print of[false,true]){const html=V.table([row],model.periods.slice(0,2),{print});assert.match(html,/-0\.0123/);assert.match(html,/\+0\.0001/);assert.match(html,/\+0\.00003%/);}row.changes.overall.delta=1e-8;assert.match(V.table([row],model.periods.slice(0,2)),/\+1e-8/);});
test("screen date matrix is one table while print uses readable continuations",()=>{const fixture=createFixture(c,8),m=L.build(fixture.records,fixture),rows=m.projects.find(p=>p.id==="cmj").metrics;assert.equal((V.table(rows,m.periods,{wrapped:false}).match(/<table /g)||[]).length,1);assert.equal((V.table(rows,m.periods,{print:true,wrapped:false}).match(/<table /g)||[]).length,3);});
test("screen keeps every date in one chart and uses distinct styles after the eighth date",()=>{const fixture=createFixture(c,12),m=L.build(fixture.records,fixture),v=V.render(m),charts=specs(v.body+v.overview+v.details);for(const chart of charts){assert.equal((V.draw(chart,450).match(/<svg/g)||[]).length,1,chart.title);}const risk=charts.find(s=>s.risk);assert.equal(risk.series.length,12);assert.notEqual(risk.series[0].dash,risk.series[8].dash);assert.match(V.draw(charts.find(s=>s.kind==="columns"&&s.grouped),450),/longitudinal-chart-scroll/);});
test("project groups retain combined jump, speed and upper/lower LVP modules",()=>{assert.equal(specs(view.details).filter(s=>s.title==="跳跃测试").length,1);assert.equal(specs(view.details).filter(s=>s.title==="速度与储备").length,1);assert.match(view.details,/上肢 LVP/);assert.match(view.details,/下肢 LVP/);assert.match(view.details,/quality-heading/);assert.match(view.details,/训练速度参考/);});
test("incompatible protocols become distinct visible rows with fixed change endpoints",()=>{const cells=[{value:1,contextKey:"a",context:{method:"MV",protocolIdentity:{version:1}}},{value:2,contextKey:"a",context:{method:"MV",protocolIdentity:{version:1}}},{value:3,contextKey:"b",context:{method:"PV",protocolIdentity:{version:2}}}],row={id:"mixed",name:"速度",unit:"m/s",cells,changes:{overall:{available:false},recent:{available:false}}},html=V.table([row],model.periods,{wrapped:false});assert.match(html,/口径 1/);assert.match(html,/口径 2/);assert.match(html,/MV/);assert.match(html,/PV/);assert.equal((html.match(/data-metric-id=/g)||[]).length,2);assert.doesNotMatch(html,/首末变化|近期变化/);});
test("all generic styles retain their actual graphical type",()=>{
 for(const kind of["bar","column","target","trials","scatter","radar"]){const fixture=createFixture(c,3);const options=kind==="scatter"?{kind,xMetricId:"long_time",yMetricId:"long_pct"}:{kind,metricIds:kind==="radar"?["long_time","long_pct","long_unknown"]:["long_time"]};
  for(const record of fixture.records){if(kind==="radar"){for(const id of options.metricIds){const d=record.definitions.find(d=>d.id===id);d.measurementScale="ratio";d.referenceEnabled=true;d.target=100;d.scoring=true;}}
    record.views.genericReports.long_generic=c.RingsideGenericReport.createView(record,"long_generic",options);}
  fixture.catalog.reportViews={long_generic:c.RingsideGenericReport.createView(fixture.records.at(-1),"long_generic",options)};
  if(kind==="radar")fixture.profile.aggregations["ability:冲刺速度"]={method:"mean",members:options.metricIds.map(id=>"metric:"+id),transforms:Object.fromEntries(options.metricIds.map(id=>["metric:"+id,{kind:"anchors",shape:"higher",points:[{value:0,score:0},{value:100,score:100}]}]))};
  const m=L.build(fixture.records,fixture),project=m.projects.find(p=>p.id==="long_generic"),html=V.projectFigures(project,m),list=specs(html);
  assert.ok(list.length,kind);assert.equal(list[0].kind,{bar:"bars",column:"columns",target:"bars",trials:"xy",scatter:"xy",radar:"radar"}[kind]);
  if(kind==="radar")assert.equal(list[0].axes.length,3);
  if(kind==="scatter")assert.match(list[0].xLabel,/完成用时/);if(kind==="trials")assert.equal(list[0].xLabel,"试次");assert.doesNotMatch(html,/NaN|Infinity/);
 }
});
test("generic radar and scatter retain earlier valid panels when the last date is missing",()=>{
 for(const kind of["radar","scatter"]){const fixture=createFixture(c,3),metricIds=["long_time","long_pct","long_unknown"],options=kind==="scatter"?{kind,xMetricId:"long_time",yMetricId:"long_pct"}:{kind,metricIds};
  for(const record of fixture.records){if(kind==="radar")for(const id of metricIds){const definition=record.definitions.find(d=>d.id===id);Object.assign(definition,{measurementScale:"ratio",referenceEnabled:true,target:100,scoring:true});}record.views.genericReports.long_generic=c.RingsideGenericReport.createView(record,"long_generic",options);}
  fixture.catalog.reportViews={long_generic:c.RingsideGenericReport.createView(fixture.records.at(-1),"long_generic",options)};
  if(kind==="radar")fixture.profile.aggregations["ability:冲刺速度"]={method:"mean",members:metricIds.map(id=>"metric:"+id),transforms:Object.fromEntries(metricIds.map(id=>["metric:"+id,{kind:"anchors",shape:"higher",points:[{value:0,score:0},{value:100,score:100}]}]))};
  fixture.records.at(-1).data.long_generic=[];
  const m=L.build(fixture.records,fixture),project=m.projects.find(p=>p.id==="long_generic"),last=m.periods.at(-1),original=c.RingsideGenericReport.buildChart(last.report,last.report.projects.find(p=>p.id===project.id)),html=V.projectFigures(project,m),list=specs(html);
  assert.equal(original.available,false);assert.equal(list.length,1);assert.equal(list[0].series.length,3);assert.ok(html.includes(original.reason));assert.doesNotMatch(html,/尚无已测维度/);
  if(kind==="radar"){assert.equal(list[0].axes.length,3);assert.ok(list[0].series[0].values.every(v=>v!==null));assert.ok(list[0].series.at(-1).values.every(v=>v===null));}
  else{assert.ok(list[0].series[0].points.length);assert.equal(list[0].series.at(-1).points.length,0);}
 }
});
test("unavailable generic models preserve their original reasons without drawing empty charts",()=>{
 for(const kind of["bar","column","target","trials","scatter","radar"]){const fixture=createFixture(c,3),options=kind==="scatter"?{kind,xMetricId:"long_time",yMetricId:"long_pct"}:{kind,metricIds:kind==="radar"?["long_time","long_pct","long_unknown"]:["long_pct"]};
  for(const record of fixture.records){record.views.genericReports.long_generic=c.RingsideGenericReport.createView(record,"long_generic",options);for(const attempt of record.data.long_generic)delete attempt.metrics.long_pct;}
  fixture.catalog.reportViews={long_generic:c.RingsideGenericReport.createView(fixture.records.at(-1),"long_generic",options)};
  const m=L.build(fixture.records,fixture),project=m.projects.find(p=>p.id==="long_generic"),html=V.projectFigures(project,m);
  assert.equal(specs(html).length,0,kind);assert.doesNotMatch(html,/<svg|尚无已测维度/);for(const period of m.periods){const original=c.RingsideGenericReport.buildChart(period.report,period.report.projects.find(p=>p.id===project.id));assert.equal(original.available,false);assert.ok(html.includes(original.reason),kind);assert.ok(html.includes(period.label));}
 }
});
test("folded raw trials retain dates, both FVP protocols and escaped notes",()=>{assert.match(view.details,/2026-01-20 · .*原始/);assert.match(view.details,/data-raw-trials="fvp_sj"/);assert.match(view.details,/data-raw-trials="fvp_cmj"/);assert.match(view.details,/FMS 原始记录/);assert.match(view.details,/合成试次备注/);});
test("PDF comparison hook bypasses single-record FVP replacement and repaginates all graphs",()=>{const source=fs.readFileSync(path.join(__dirname,"../src/ringside-pdf.js"),"utf8");assert.match(source,/clone\.dataset\.longitudinal !== "true"/);assert.match(source,/RingsideLongitudinalView\?\.layout\(source, \{ print: true \}\)/);});
test("quick summary keeps its four roles with large change counts and every metric name in compact text",()=>{
 const m={...model,changeSummary:{declined:[],improved:Array.from({length:5},(_,i)=>({id:'summary-'+i,projectName:'项目'+i,name:'指标'+i,label:'项目'+i+' · 指标'+i,unit:'cm',change:{available:true,kind:'absolute',delta:i+.5,percent:i+1,improvement:'improved'}}))}},html=V.render(m).summary;
 assert.equal((html.match(/<article /g)||[]).length,4);for(const label of['运动员基本信息','首末下降','首末改善','所选比较日期','暂无下降指标'])assert.ok(html.includes(label));assert.match(html,/<div class="micro-value">5<small> 项<\/small>/);assert.match(html,/<div class="micro-value">0<small> 项<\/small>/);assert.equal((html.match(/data-summary-metric=/g)||[]).length,5);assert.doesNotMatch(html,/<details|longitudinal-change |<li data-summary-metric|%/);for(const p of m.periods)assert.ok(html.includes('data-summary-record="'+p.id+'"'));
 m.changeSummary.improved=[{id:'fms',projectName:'FMS 动作筛查',name:'深蹲评分',label:'FMS 动作筛查 · 深蹲评分',unit:'分',pain:{from:true,to:false},change:{available:true,kind:'ordinal',from:{value:0},to:{value:2},improvement:'improved'}}];assert.match(V.render(m).summary,/FMS 动作筛查 · 深蹲评分/);assert.doesNotMatch(V.render(m).summary,/0（疼痛） → 2/);
});
test("overview alone uses a dated table below three dimensions without any upper dimension cutoff",()=>{
 for(const count of[1,2,3,9,12]){const chart={kind:'radar',title:'运动表现概览',overview:true,max:100,axes:Array.from({length:count},(_,i)=>({key:'a'+i,label:'能力'+i})),series:model.periods.map(p=>({id:p.id,label:p.label,color:p.color,values:Array(count).fill(82)}))},html=V.draw(chart,450);assert.equal(/<table/.test(html),count<3);assert.equal(/<svg/.test(html),count>=3);for(const p of model.periods)assert.ok(html.includes(p.label));if(count>=3)assert.equal((html.match(/data-longitudinal-axis-label=/g)||[]).length,count);}
});
test("risk background transitions narrowly while visible grades carry no numeric scale labels",()=>{
 const html=V.draw(specs(view.body)[0],450),visible=html.replace(/<title>[\s\S]*?<\/title>/g,'').replace(/<[^>]*>/g,' ');assert.match(html,/data-risk-gradient="1"/);assert.match(html,/data-risk-gradient="2"/);assert.doesNotMatch(html,/data-radar-tick=/);assert.doesNotMatch(visible,/1 预警|2 关注|3 达标/);for(const word of['预警','关注','达标'])assert.ok(visible.includes(word));
});
test("comparison radar fills nearby series while missing dimensions remain open",()=>{
 const base={kind:'radar',title:'能力',max:100,axes:Array.from({length:6},(_,i)=>({key:'a'+i,label:'能力'+i})),series:Array.from({length:12},(_,i)=>({id:'p'+i,label:'日期'+i,color:'#456789',values:Array(6).fill(80+i*.1)}))};let html=V.draw(base,450);assert.equal((html.match(/class="radar-fill"/g)||[]).length,12);assert.ok([...html.matchAll(/fill-opacity="([^"]+)"/g)].every(m=>Number(m[1])>0&&Number(m[1])<.2));base.series=[{...base.series[0],values:[80,81,null,82,83,84]}];html=V.draw(base,450);const fills=[...html.matchAll(/<polygon class="radar-fill" points="([^"]+)"[^>]*>/g)];assert.equal(fills.length,4);assert.ok(fills.every(m=>m[1].split(' ').length===3&&m[0].includes('stroke="none"')));
});
console.log(`${passed} longitudinal view checks passed`);
