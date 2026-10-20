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
test("tables retain mean SD CV with one all-date trend and preserved internal summaries",()=>{
 const rows=model.projects.find(p=>p.id==="cmj").metrics,html=V.table(rows,model.periods);assert.match(html,/±/);assert.match(html,/CV/);assert.equal((html.match(/>变化趋势<\/th>/g)||[]).length,1);assert.equal(rows[0].changes.overall.available,true);assert.equal(rows[0].changes.recent.available,true);assert.doesNotMatch(html,/首末变化|近期变化|起点|终点/);
});
test("same-day dates and print continuations keep every trend point exactly once",()=>{
 const f=createFixture(c,5);f.records[1].athlete.date=f.records[0].athlete.date;const m=L.build(f.records,f),rows=m.projects.find(p=>p.id==="cmj").metrics;
 for(const print of[false,true]){const html=V.table([rows[0]],m.periods,{print,wrapped:false});assert.equal((html.match(/data-trend-point=/g)||[]).length,5);assert.match(html,/2026-01-20 · 1/);assert.match(html,/2026-01-20 · 2/);assert.equal((html.match(/>变化趋势<\/th>/g)||[]).length,1);}
});
test("missing endpoints retain empty dates without reconnecting gaps",()=>{
 const f=createFixture(c,3);f.records[0].data.cmj=[];const m=L.build(f.records,f),row=m.projects.find(p=>p.id==="cmj").metrics[0];assert.equal(row.changes.overall.available,false);const html=V.table([row],m.periods);assert.doesNotMatch(html,/data-trend-segment="1"/);assert.match(html,/data-trend-segment="2"/);
});
test("percentage-point tooltips are distinct from valid relative percentage changes",()=>{
 const row=model.projects.find(p=>p.id==="long_generic").metrics.find(r=>r.metricId==="long_pct");assert.equal(row.changes.overall.kind,"percentage-point");const html=V.table([row],model.periods,{wrapped:false});assert.match(html,/个百分点/);assert.doesNotMatch(html,/相对/);
});
test("single selected date suppresses the trend column",()=>{
 const row={id:"one",name:"测量",unit:"N",cells:[{value:12}],changes:{}};assert.doesNotMatch(V.table([row],model.periods.slice(0,1),{wrapped:false}),/变化趋势/);
});
test("screen date matrix is one table while print uses readable continuations",()=>{const fixture=createFixture(c,8),m=L.build(fixture.records,fixture),rows=m.projects.find(p=>p.id==="cmj").metrics;assert.equal((V.table(rows,m.periods,{wrapped:false}).match(/<table /g)||[]).length,1);assert.equal((V.table(rows,m.periods,{print:true,wrapped:false}).match(/<table /g)||[]).length,3);});
test("screen keeps every date in one chart and uses distinct styles after the eighth date",()=>{const fixture=createFixture(c,12),m=L.build(fixture.records,fixture),v=V.render(m),charts=specs(v.body+v.overview+v.details);for(const chart of charts){assert.equal((V.draw(chart,450).match(/<svg/g)||[]).length,1,chart.title);}const risk=charts.find(s=>s.risk);assert.equal(risk.series.length,12);assert.notEqual(risk.series[0].dash,risk.series[8].dash);assert.match(V.draw(charts.find(s=>s.kind==="columns"&&s.grouped),450),/longitudinal-chart-scroll/);});
test("project groups retain combined jump, speed and upper/lower LVP modules",()=>{assert.equal(specs(view.details).filter(s=>s.title==="跳跃测试").length,1);assert.ok(specs(view.details).filter(s=>s.speedPanel).length>=2);assert.equal((view.details.match(/data-longitudinal-grid="speed"/g)||[]).length,1);assert.match(view.details,/上肢 LVP/);assert.match(view.details,/下肢 LVP/);assert.match(view.details,/quality-heading/);assert.match(view.details,/训练速度参考/);});
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
 assert.equal((html.match(/<article /g)||[]).length,4);for(const label of['运动员基本信息','下降','改善','所选比较日期','暂无下降指标'])assert.ok(html.includes(label));assert.match(html,/<div class="micro-value green">5<small> 项<\/small>/);assert.match(html,/<div class="micro-value red">0<small> 项<\/small>/);assert.equal((html.match(/data-summary-metric=/g)||[]).length,5);assert.doesNotMatch(html,/<details|longitudinal-change |<li data-summary-metric|%/);for(const p of m.periods)assert.ok(html.includes('data-summary-record="'+p.id+'"'));
 m.changeSummary.improved=[{id:'fms',projectName:'FMS 动作筛查',name:'深蹲评分',label:'FMS 动作筛查 · 深蹲评分',unit:'分',pain:{from:true,to:false},change:{available:true,kind:'ordinal',from:{value:0},to:{value:2},improvement:'improved'}}];assert.match(V.render(m).summary,/FMS 动作筛查 · 深蹲评分/);assert.doesNotMatch(V.render(m).summary,/0（疼痛） → 2/);
});
test("summary ranks only valid relative changes stably without mutating source metrics",()=>{
 const item=(id,change)=>({id,projectName:id,name:'指标',label:id+' · 指标',unit:'cm',change:{available:true,kind:'absolute',from:{value:10},...change}}),items=[item('ordinal',{kind:'ordinal',percent:1000}),item('small',{percent:-5,delta:9000}),item('tied-first',{percent:20,delta:1}),item('no-percent',{delta:100000}),item('tied-second',{percent:-20,delta:-10}),item('largest',{percent:30,delta:.1}),item('points',{kind:'percentage-point',percent:999}),item('zero-baseline',{percent:999,from:{value:0}}),item('negative-baseline',{percent:999,from:{value:-10}}),item('not-finite',{percent:Infinity}),item('numeric-string',{percent:'99'})],m={...model,changeSummary:{declined:items,improved:[]}},before=items.map(i=>i.id),html=V.render(m).summary,order=[...html.matchAll(/data-summary-metric="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(order,['largest','tied-first','tied-second','small','ordinal','no-percent','points','zero-baseline','negative-baseline','not-finite','numeric-string']);assert.deepEqual(items.map(i=>i.id),before);assert.match(html,/<h3>下降<\/h3>/);assert.match(html,/<h3>改善<\/h3>/);assert.doesNotMatch(html,/<h3>首末/);assert.match(html,/class="longitudinal-summary-names" title="largest · 指标；tied-first · 指标/);assert.match(html,/<div class="micro-value red">11<small> 项<\/small>/);
});
test("overview alone uses a dated table below three dimensions without any upper dimension cutoff",()=>{
 for(const count of[1,2,3,9,12]){const chart={kind:'radar',title:'运动表现概览',overview:true,max:100,axes:Array.from({length:count},(_,i)=>({key:'a'+i,label:'能力'+i})),series:model.periods.map(p=>({id:p.id,label:p.label,color:p.color,values:Array(count).fill(82)}))},html=V.draw(chart,450);assert.equal(/<table/.test(html),count<3);assert.equal(/<svg/.test(html),count>=3);for(const p of model.periods)assert.ok(html.includes(p.label));if(count>=3)assert.equal((html.match(/data-longitudinal-axis-label=/g)||[]).length,count);}
});
test("risk background transitions narrowly while visible grades carry no numeric scale labels",()=>{
 const html=V.draw(specs(view.body)[0],450),visible=html.replace(/<title>[\s\S]*?<\/title>/g,'').replace(/<[^>]*>/g,' ');assert.match(html,/data-risk-gradient="1"/);assert.match(html,/data-risk-gradient="2"/);assert.doesNotMatch(html,/data-radar-tick=/);assert.doesNotMatch(visible,/1 预警|2 关注|3 优秀/);for(const word of['预警','关注','优秀'])assert.ok(visible.includes(word));
});
test("comparison radar fills nearby series while missing dimensions remain open",()=>{
 const base={kind:'radar',title:'能力',max:100,axes:Array.from({length:6},(_,i)=>({key:'a'+i,label:'能力'+i})),series:Array.from({length:12},(_,i)=>({id:'p'+i,label:'日期'+i,color:'#456789',values:Array(6).fill(80+i*.1)}))};let html=V.draw(base,450);assert.equal((html.match(/class="radar-fill"/g)||[]).length,12);assert.ok([...html.matchAll(/fill-opacity="([^"]+)"/g)].every(m=>Number(m[1])>0&&Number(m[1])<.2));base.series=[{...base.series[0],values:[80,81,null,82,83,84]}];html=V.draw(base,450);const fills=[...html.matchAll(/<polygon class="radar-fill" points="([^"]+)"[^>]*>/g)];assert.equal(fills.length,4);assert.ok(fills.every(m=>m[1].split(' ').length===3&&m[0].includes('stroke="none"')));
});
test("regional screening table is removed while measured risk axes and detailed tests remain",()=>{assert.doesNotMatch(view.details,/各区域筛查等级|longitudinal-regions/);assert.ok(specs(view.body)[0].axes.length);assert.match(view.details,/FMS 动作表现/);assert.match(view.details,/data-iso-section="force"/);assert.match(view.details,/data-iso-section="asymmetry"/);assert.equal(/data-iso-section="balance"/.test(view.details),model.projects.filter(project=>project.renderer==="iso").some(project=>project.metrics.some(row=>row.section==="balance"&&row.cells.some(cell=>cell&&Number.isFinite(cell.value)))));});
test("one raw disclosure per module retains every dated project trial table",()=>{
 const nodes=[...view.details.matchAll(/<details class="attempt-details longitudinal-raw"[^>]*data-raw-trials="([^"]+)"/g)];assert.ok(nodes.length>5);assert.equal(new Set(nodes.map(m=>m[1])).size,nodes.length);assert.equal((view.details.match(/<summary>展开所有原始试次数据<\/summary>/g)||[]).length,nodes.length);assert.equal((view.details.match(/<details[^>]*data-raw-trials=/g)||[]).length,nodes.length);
 for(const p of model.periods)for(const project of model.projects){if(project.renderer==='fms')continue;const original=c.RingsideReport.render(p.report),raw=[...original.matchAll(/<details[^>]*data-raw-trials="([^"]+)"/g)].filter(m=>m[1]===project.id);if(raw.length)assert.ok(view.details.includes('data-raw-project="'+project.id+'"'),project.id);}
 for(const p of model.periods)assert.ok(view.details.includes(p.label+' · FMS 原始记录'));
});
test("speed panels retain every date and MAS reserve on a shared scale for matching units",()=>{
 const panels=specs(view.details).filter(s=>s.speedPanel);assert.ok(panels.length>=2);for(const panel of panels){assert.equal(panel.periods.length,model.periods.length);assert.ok(panel.values.every(v=>Object.hasOwn(v,'value')));for(const peer of panels.filter(peer=>peer.unit===panel.unit))assert.deepEqual(peer.scaleValues,panel.scaleValues);const html=V.draw(panel,330,true);for(const p of model.periods)assert.ok(html.includes(p.date));}
 const mas=panels.find(panel=>panel.values.some(v=>v.asrEnd!==null));assert.ok(mas);assert.match(V.draw(mas,330),/ASR/);
});
test("assessments preserve original colors labels basis and missing reasons through print serialization",()=>{
 const rows=[{id:'status',name:'测量',unit:'N',cells:[{value:12,display:{visible:true,label:'原分级',status:'red'},assessment:{status:'red',label:'原分级',reason:'原判定依据',target:20}},{value:null,display:{visible:false},notes:'缺少完整双侧结果',assessment:{status:'gray',label:'缺少完整双侧结果',reason:'分母缺测'}},{value:22,display:{visible:true,label:'原达标',status:'green'},assessment:{status:'green',label:'原达标',referenceSource:'原参考来源'}}],changes:{}}];
 const html=V.table(rows,model.periods),compact=JSON.parse(decode(html.match(/data-longitudinal-table="([^"]+)"/)[1]));for(const output of[html,V.table(compact.rows,compact.periods,{print:true,wrapped:false})]){assert.match(output,/data-assessment-status="red"/);assert.match(output,/data-assessment-status="green"/);assert.match(output,/title="原判定依据；参考目标 20"/);assert.match(output,/缺少完整双侧结果/);assert.match(output,/title="分母缺测"/);assert.doesNotMatch(output,/<td[^>]*class="[^"]*(?:longitudinal-assessed|red|green|gray)/);for(const status of["red","green"])assert.match(output,new RegExp('class="pill '+status+' longitudinal-assessment"'));}
});
test("assessment labels remove only identical displayed notes and preserve distinct comments",()=>{
 const row={id:"asym",name:"双侧差异",unit:"%",cells:[{value:12,display:{visible:true,label:"左侧更弱",status:"amber"},assessment:{status:"amber",label:"左侧更弱"},notes:"左侧更弱；左侧更弱，第二次试次疼痛"},{value:8,display:{visible:true,label:"双侧一致",status:"green"},assessment:{status:"green",label:"双侧一致"},notes:["双侧一致","原始备注"]},{value:null,assessment:{status:"gray",label:"缺少完整双侧结果"},notes:"缺少完整双侧结果；保留缺测说明"}],changes:{}},before=JSON.stringify(row);
 const html=V.table([row],model.periods),compact=JSON.parse(decode(html.match(/data-longitudinal-table="([^"]+)"/)[1]));for(const output of[V.table([row],model.periods,{wrapped:false}),V.table(compact.rows,compact.periods,{print:true,wrapped:false})]){assert.doesNotMatch(output,/<small>左侧更弱<\/small>|<small>双侧一致<\/small>/);assert.match(output,/<small>左侧更弱，第二次试次疼痛<\/small>/);assert.match(output,/<small>原始备注<\/small>/);assert.match(output,/缺少完整双侧结果；保留缺测说明/);assert.match(output,/class="pill amber longitudinal-assessment"/);}
 assert.equal(JSON.stringify(row),before);
});
test("full personal FVP analysis support survives without duplicating charts or numeric result tables",()=>{
 const terms=['负荷点与重复测量','测试条件、计算与来源','95%置信带为 F(V) 拟合均值','拟合残差、测试条件与方法','距离残差 RMSE','V₀ 为 F–V 外推的零力速度','弹性计算与来源','情景参数改变','两端局部响应的合成强度'];for(const term of terms)assert.ok(view.details.includes(term),term);
 assert.equal((view.details.match(/data-analysis-period=/g)||[]).length,model.periods.length*6);assert.doesNotMatch(view.details,/class="fvp-result-table|class="fvp-scenario-table|data-chart-kind="(?:jumpFvp|sprintFvp|jumpElasticity|sprintElasticity)/);
 for(const p of model.periods){const native=c.RingsideReport.renderFVPAnalysis(p.report,{print:true});for(const table of native.matchAll(/<table class="fvp-load-table">[\s\S]*?<\/table>/g)){const values=[...table[0].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m=>m[1]);for(const value of values)assert.ok(view.details.includes('<td>'+value+'</td>'));}}
});
test("capability periods retain conclusions targets and CPET component interpretation",()=>{
 assert.equal((view.details.match(/class="longitudinal-direction-grid"/g)||[]).length,4);assert.equal((view.details.match(/data-period-count="3"/g)||[]).length>=4,true);
 for(const p of model.periods)for(const card of p.stats.capabilityCards){if(card.conclusion)assert.ok(decode(view.details).includes(card.conclusion));for(const target of card.targets||[])if(c.Calc.num(target.value)!==null)assert.ok(decode(view.details).includes(target.label));}
 for(const term of['心肺与阈值参数','组成数据与解读','参考与解读'])assert.ok(view.details.includes(term),term);
});
test("missing FVP periods retain the original no-data reason without generated results",()=>{const fixture=createFixture(c,3);fixture.records[1].enabled.fvp_sj=false;const m=L.build(fixture.records,fixture),html=V.render(m).details;const start=html.indexOf('data-test-ids="fvp_sj"'),end=html.indexOf('<article class="test-block',start+1),block=html.slice(start,end<0?undefined:end);assert.ok(block.includes(m.periods[1].label));assert.match(block,/本期未测/);});
test("nearby lactate thresholds keep every original line and dated legend value without overlapping plot labels",()=>{
 const original=specs(view.details).find(s=>s.kind==='xy'&&s.rightLabel==='心率 · bpm');assert.ok(original);const spec=JSON.parse(JSON.stringify(original));spec.markers.forEach((m,i)=>m.x=m.label==='LT1'?4+i*.0001:4.75);const html=V.draw(spec,710),svgs=[...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map(m=>m[0]).join('');assert.equal((html.match(/data-threshold-record=/g)||[]).length,spec.markers.length);assert.doesNotMatch(svgs,/<text[^>]*>LT[12]<\/text>/);for(const s of spec.series){const text=html.slice(html.indexOf('class="longitudinal-curve-key"')).split('</span>').find(part=>part.includes(s.label));assert.ok(text);if(s.markerLegend){for(const m of spec.markers.filter(m=>m.recordId===s.recordId))assert.ok(text.includes(m.label+' '+m.x+' m/s'));}else assert.doesNotMatch(text,/LT1|LT2/);}assert.deepEqual(spec.series.map(s=>s.points),original.series.map(s=>s.points));
});
test("each retained elasticity label and interpretation remains one semantic PDF block",()=>{
 const lists=[...view.details.matchAll(/<dl class="longitudinal-analysis-notes">([\s\S]*?)<\/dl>/g)];assert.equal(lists.length,model.periods.length*3);for(const list of lists){const rows=[...list[1].matchAll(/<div([^>]*)><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)];assert.ok(rows.length>=8);for(const row of rows){assert.match(row[1],/data-pdf-atomic/);assert.ok(row[2]&&row[3]);}}
});
test("plot date filters recompute observed connections from the displayed measurement contexts",()=>{
 const m=L.build(f.records,f),jump=m.projects.find(p=>p.id==="dj"),speed=m.projects.flatMap(p=>p.metrics).find(r=>r.metricId==="mas_speed"),height=jump.metrics.find(r=>r.metricId==="dj_height"),rsi=jump.metrics.find(r=>r.metricId==="dj_rsi"),ids=m.periods.map(p=>p.id);
 for(const row of[height,rsi,speed])for(let i=0;i<3;i++){row.cells[i].contextKey=i===0?"protocol-a":"protocol-b";row.cells[i].comparableToPrevious=i===2;}
 const views={charts:{jumps:{recordIds:[ids[0],ids[2]]},"speed:mas_speed":{recordIds:[ids[0],ids[2]]}}};
 let charts=specs(V.render(m,{views}).details),bar=charts.find(s=>s.chartId==="jumps"),mas=charts.find(s=>s.chartId==="speed:mas_speed");
 assert.equal(bar.values.find(v=>v.groupId==="dj"&&v.recordId===ids[2]).comparableToPrevious,false);
 assert.equal(bar.values.find(v=>v.groupId==="dj"&&v.recordId===ids[2]).rsiComparableToPrevious,false);
 assert.equal(mas.values[1].comparableToPrevious,false);
 for(const row of[height,rsi,speed])row.cells[2].contextKey="protocol-a";
 charts=specs(V.render(m,{views}).details);bar=charts.find(s=>s.chartId==="jumps");mas=charts.find(s=>s.chartId==="speed:mas_speed");
 assert.equal(bar.values.find(v=>v.groupId==="dj"&&v.recordId===ids[2]).comparableToPrevious,true);
 assert.equal(bar.values.find(v=>v.groupId==="dj"&&v.recordId===ids[2]).rsiComparableToPrevious,true);
 assert.equal(mas.values[1].comparableToPrevious,true);
 assert.equal(height.cells[2].comparableToPrevious,true);
});
test("unset evaluation diagnostics stay out of pills without dropping user notes",()=>{
 const f=createFixture(c,3);f.profile.standards.find(r=>r.metricId==='cmj_height').enabled=false;f.records[0].data.cmj[0].notes='未设置评价；原始备注';const m=L.build(f.records,f),row=m.projects.find(p=>p.id==='cmj').metrics.find(r=>r.metricId==='cmj_height'),html=V.table([row],m.periods);assert.doesNotMatch(html,/class="pill gray longitudinal-assessment/);assert.match(html,/原始备注/);assert.match(html,/未设置评价；原始备注/);
});
test("FMS shares the all-date trend with a fixed zero-to-three domain and semantic colors",()=>{
 const fixture=createFixture(c,3);fixture.records.forEach((r,i)=>{r.data.fms[0].score=[1,3,2][i];r.data.fms[0].pain=false;});const m=L.build(fixture.records,fixture),row=m.projects.find(p=>p.id==='fms').metrics.find(r=>r.id==='fms:0'),before=JSON.stringify(row),html=V.table([row],m.periods),compact=JSON.parse(decode(html.match(/data-longitudinal-table="([^"]+)"/)[1]));
 for(const out of[V.table([row],m.periods,{wrapped:false}),V.table(compact.rows,compact.periods,{print:true,wrapped:false})]){assert.equal((out.match(/data-score-scale="0-3"/g)||[]).length,1);assert.equal((out.match(/data-trend-point=/g)||[]).length,3);assert.match(out,/#187459/);assert.match(out,/#b23f3d/);assert.doesNotMatch(out,/起点|终点|相对/);}assert.equal(JSON.stringify(row),before);
});
test("joint balance without valid selected results is omitted while force asymmetry and source records remain",()=>{
 const fixture=createFixture(c,3);for(const r of fixture.records)r.isoDirectionIds=['iso_shoulder_externalRotation','iso_hip_abduction','iso_knee_extension','iso_ankle_dorsiflexion'];
 const before=JSON.stringify(fixture),m=L.build(fixture.records,fixture),iso=m.projects.find(p=>p.id==='iso');assert.ok(!iso.metrics.some(row=>row.section==='balance'));
 const html=V.render(m).details;assert.doesNotMatch(html,/data-iso-section="balance"|<h5[^>]*>关节平衡<\/h5>|未选入配对方向/);for(const section of ['force','asymmetry']){assert.match(html,new RegExp('data-iso-section="'+section+'"'));assert.ok(iso.metrics.some(row=>row.section===section&&row.cells.some(cell=>cell&&Number.isFinite(cell.value))));}for(const id of fixture.records[0].isoDirectionIds)assert.ok(html.includes(id));assert.equal(JSON.stringify(fixture),before);
 assert.ok(!/data-metric-id="balance:/.test(html));
});
console.log(`${passed} longitudinal view checks passed`);
