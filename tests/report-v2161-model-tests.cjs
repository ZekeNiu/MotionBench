"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const c=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});c.window=c;
for(const name of ["calc","fvp","sources","cpet-reference","iso-reference","definitions","tests","model","evaluation","interventions","viz","report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname,`../src/ringside-${name}.js`),"utf8"),c,{filename:name});
const M=c.RingsideModel,R=c.RingsideReport,V=c.RingsideViz,D=c.Def,E=c.RingsideEvaluation;
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
const text=html=>html.replace(/<[^>]*>/g,"");
const ranges=()=>D.parseRanges("<60 | 自定义低等级 | red\n[60..80) | 自定义中等级 | amber\n>=80 | 自定义高等级 | green");
function only(r,...ids){Object.keys(r.enabled).forEach(id=>r.enabled[id]=ids.includes(id));return r;}
function jumpTable(html){return html.match(/<table class="jump-results[^>]*>[\s\S]*?<\/table>/)?.[0]||"";}
function metricRow(html,id){return html.match(new RegExp(`<tr[^>]*data-metric-id="${id}"[^>]*>([\\s\\S]*?)<\\/tr>`))?.[1]||"";}

test("overview has six ordered valid cards while CMJ elasticity remains in the detailed analysis",()=>{
  const r=M.sampleRecord();r.athlete.mass=72;
  for(const id of ["fvp_sj","fvp_cmj"]){r.enabled[id]=true;r.fvpConfig[id].distanceCm=33;r.data[id]=[0,20,40,60,80].map((load,index)=>({id:id+index,load,height:[33,27,22,14,10][index]}));}
  const before=JSON.stringify(r),report=R.build(r),overview=R.overview(report);
  assert.deepEqual([...overview.matchAll(/data-overview-metric="([^"]+)"/g)].map(match=>match[1]),["fvp_sj","fvp_sj_elasticity","fvp_cmj","fdsi","eur","srr"]);
  assert.match(R.renderFVPAnalysis(report,{print:true}),/data-fvp-elasticity="fvp_cmj"/);
  assert.equal(JSON.stringify(r),before);
});

test("jump results always give each test a row and a separate assessment column",()=>{
  for(const repeated of [false,true]){
    const r=only(M.defaults(),"cmj","sj");
    r.data.cmj=(repeated?[40,42,44]:[40]).map((height,index)=>({id:"cmj"+index,height}));
    r.data.sj=(repeated?[35,36,37]:[35]).map((height,index)=>({id:"sj"+index,height}));
    for(const id of ["cmj_height","sj_height"]){const d=r.definitions.find(d=>d.id===id);Object.assign(d,{referenceEnabled:true,target:50,ranges:ranges()});}
    const before=JSON.stringify(r),table=jumpTable(R.render(R.build(r)));
    assert.ok(table);assert.deepEqual([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(match=>match[1]),["指标","结果",...(repeated?["均值 ± SD","CV"]:[]),"评价"]);
    const rows=[...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1);assert.equal(rows.length,2);
    for(const row of rows){const cells=[...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);assert.doesNotMatch(cells[1],/class="pill/);assert.match(cells[1],/参考目标 50/);assert.match(cells.at(-1),/pill red/);assert.match(cells.at(-1),/预警/);}
    assert.equal(JSON.stringify(r),before);
  }
});

test("ungraded jump results keep their independent empty assessment column",()=>{
  const r=only(M.defaults(),"cmj","sj");r.data.cmj=[{height:40}];r.data.sj=[{height:35}];
  for(const d of r.definitions)d.referenceEnabled=false;
  const table=jumpTable(R.render(R.build(r)));assert.match(table,/>评价<\/th>/);assert.equal((table.match(/data-label="评价"/g)||[]).length,2);assert.doesNotMatch(table,/class="pill/);
});

test("generic push-up and medicine-ball assessments map statuses without rewriting saved ranges",()=>{
  for(const status of ["red","amber","green"]){
    const r=only(M.sampleRecord(),"pushup","mb"),value={red:50,amber:70,green:90}[status];
    r.data.pushup.reps=value;r.data.mb.forEach(row=>row.distance=value);
    for(const d of r.definitions.filter(d=>["pushup","mb"].includes(d.testId)))Object.assign(d,{referenceEnabled:true,target:80,ranges:ranges()});
    const before=JSON.stringify(r),report=R.build(r),html=R.render(report),label=D.assessmentLabel(status);
    assert.match(metricRow(html,"pushup_reps"),new RegExp(`pill ${status}[^>]*><i class="dot"><\\/i>${label}`));
    const ball=html.split('id="detail-mb"')[1]?.split('</article>')[0]||html;
    assert.match(ball,new RegExp(`pill ${status}[^>]*><i class="dot"><\\/i>${label}`));assert.match(ball,/参考目标/);
    assert.equal(JSON.stringify(r),before);assert.ok(report.projects.flatMap(project=>project.metrics).every(metric=>metric.evaluation.label===M.evaluation(metric.value,metric,r).label));
  }
});

test("IMTP representative and timed repeated results use the shared short labels",()=>{
  const r=only(M.defaults(),"imtp");r.mode="mean";
  r.data.imtp=[0,1,2].map(index=>({id:"imtp"+index,peakForce:2800+index*20,baselineForce:100,timePoints:[{id:"point"+index,timeMs:250,force:1700+index*20,rfd:6000+index*100}]}));
  Object.assign(r.definitions.find(d=>d.id==="imtp_peak_force"),{referenceEnabled:true,target:3000,ranges:D.parseRanges("<2900 | 原峰值低等级 | red\n>=2900 | 原峰值高等级 | green")});
  r.imtpTimeStandards=[{timeMs:250,kind:"force_pct_peak",context:E.imtpTimeContext(r),referenceEnabled:true,direction:"higher",target:70,source:"模拟验收标准",ranges:D.parseRanges("<60 | 原时点低等级 | red\n[60..70) | 原时点中等级 | amber\n>=70 | 原时点高等级 | green")},
    {timeMs:250,kind:"rfd",context:E.imtpTimeContext(r),referenceEnabled:true,direction:"higher",target:6000,source:"模拟验收标准",ranges:D.parseRanges("<6000 | 原RFD低等级 | red\n>=6000 | 原RFD高等级 | green")}];
  assert.doesNotThrow(()=>M.validateRecord(r));
  const before=JSON.stringify(r),html=R.render(R.build(r));
  for(const [id,status,label] of [["imtp_peak_force","red","预警"],["imtp_f250","amber","关注"],["imtp_rfd250","green","达标"]]){
    const row=metricRow(html,id);assert.ok(row,id);assert.match(row,new RegExp(`pill ${status}`));assert.match(row,new RegExp(label));assert.match(row,/data-repeat-stat=/);assert.doesNotMatch(text(row),/原.+等级/);
  }
  assert.match(html,/>参考目标<\/th>/);assert.equal(JSON.stringify(r),before);
});

test("measured-body grades use short labels while raw FMS scores and gray reasons remain visible",()=>{
  const region={status:"red",hasMeasured:true,tests:[{testId:"iso",name:"外旋",value:50,unit:"N",target:80,targetKind:"manual",status:"red",label:"旧严重"},
    {testId:"fms",name:"动作",value:2,unit:"分",status:"amber",label:"代偿完成"},
    {testId:"iso",name:"ER:IR",value:.7,status:"gray",label:"未设等级区间",notes:"文献均值仅作参考，未设置评价区间"}]};
  const before=JSON.stringify(region),html=V.bodyTooltip(region);
  assert.match(html,/预警/);assert.match(html,/参考目标 80/);assert.match(html,/2 分 · 代偿完成/);assert.match(html,/文献均值仅作参考，未设置评价区间/);assert.doesNotMatch(html,/旧严重/);assert.equal(JSON.stringify(region),before);
});

test("body amber inner circle keeps the canonical fill and only its outer tint is transparent",()=>{
  const html=V.body({neck:{status:"amber",hasMeasured:true,value:0},hip_l:{status:"green",hasMeasured:true,value:10},hip_r:{status:"red",hasMeasured:true,pain:true}},"body.png");
  const amber=html.match(/data-region="neck"[\s\S]*?<\/g>/)[0];assert.match(amber,new RegExp(`r="32" fill="${V.C.amber}" opacity="0"`));assert.match(amber,new RegExp(`r="24" fill="${V.C.amber}" class="viz-hotspot" stroke="white"`));
  assert.equal((html.match(/opacity="\.16"/g)||[]).length,2);assert.equal((html.match(/class="viz-hotspot"/g)||[]).length,3);
});
console.log(`${passed} report v2.16.1 checks passed`);
