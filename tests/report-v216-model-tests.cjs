"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const context=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});context.window=context;
for(const name of ["calc","fvp","sources","cpet-reference","iso-reference","definitions","tests","model","evaluation","interventions","viz","report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname,`../src/ringside-${name}.js`),"utf8"),context,{filename:name});
const M=context.RingsideModel,R=context.RingsideReport,V=context.RingsideViz;
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
const json=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const r=M.sampleRecord();r.athlete.mass=72;
  for(const id of ["fvp_sj","fvp_cmj"]){r.enabled[id]=true;r.fvpConfig[id].distanceCm=33;r.data[id]=[0,20,40,60,80].map((load,index)=>({id:`${id}-${index}`,load,height:[33,27,22,14,10][index]}));}
  return r;
}
test("overview preserves both protocols ahead of all directional ratios and excludes invalid or disabled profiles",()=>{
  const r=fixture(),report=R.build(r),html=R.overview(report);
  const ids=[...html.matchAll(/data-overview-metric="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(ids.slice(0,3),["fvp_sj","fvp_sj_elasticity","fvp_cmj"]);
  assert.ok(!ids.includes("fvp_cmj_elasticity"));
  assert.ok(ids.includes("eur"));assert.ok(html.includes("各提高 1%"));assert.doesNotMatch(html,/CMJ 垂直跳跃高度较 SJ|1\.1 标准|待录入|未测/);
  r.views.fvpProtocol="fvp_cmj";assert.equal(R.overview(R.build(r)),html);
  r.enabled.fvp_sj=false;r.data.fvp_cmj=r.data.fvp_cmj.slice(0,2);
  assert.doesNotMatch(R.overview(R.build(r)),/data-overview-metric="fvp_/);
});
test("response checkboxes support every combination and PDF respects protocol-specific visibility",()=>{
  const r=fixture();
  for(let mask=0;mask<8;mask++){
    const keys=["responseForce","responseVelocity","responseBoth"];
    keys.forEach((key,index)=>r.fvpView.fvp_sj[key]=!!(mask&(1<<index)));
    const report=R.build(r),html=R.renderFVPAnalysis(report),chart=html.slice(html.indexOf('data-fvp-elasticity="fvp_sj"'));
    for(const [index,key] of ["force","velocity","both"].entries())assert.equal(chart.includes(`data-response-series="${key}"`),!!(mask&(1<<index)));
    assert.doesNotMatch(chart,/NaN|Infinity/);
    if(!mask)assert.match(chart,/勾选曲线查看表现响应/);
  }
  Object.assign(r.fvpView.fvp_sj,{responseForce:false,responseVelocity:false,responseBoth:true});
  Object.assign(r.fvpView.fvp_cmj,{responseForce:true,responseVelocity:false,responseBoth:false});
  const print=R.renderFVPAnalysis(R.build(r),{print:true});
  const sj=print.split('data-fvp-elasticity="fvp_sj"')[1].split('data-fvp-panel="fvp_cmj"')[0],cmj=print.split('data-fvp-elasticity="fvp_cmj"')[1];
  assert.match(sj,/data-response-series="both"/);assert.doesNotMatch(sj,/data-response-series="force"|data-response-series="velocity"/);
  assert.match(cmj,/data-response-series="force"/);assert.doesNotMatch(cmj,/data-response-series="both"|data-response-series="velocity"/);
  assert.match(print,/弹性范数 EN/);assert.match(print,/双端各提高 1%/);assert.doesNotMatch(print,/归一弹性 EN|选择负荷点可对应查看/);
});
test("speed endpoints stay visible and target attainment can exceed the full visual bar",()=>{
  const report=R.build(fixture());
  report.stats.capabilityCards=[{id:"speed",title:"速度耐力发展方向",metrics:[{id:"asr",label:"ASR",value:4,unit:"m/s"},{id:"mss_speed",label:"MSS",value:9,unit:"m/s",target:8,attainment:112.5},{id:"mas_speed",label:"MAS",value:5,unit:"m/s",target:6,attainment:83.333},{id:"srr",label:"SRR",value:1.8,unit:"比值",judgment:"混合型"}],conclusion:"发展有氧速度"}];
  const html=R.render(report).split('data-capability-card="speed"')[1];
  const ids=[...html.matchAll(/data-capability-metric="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(ids,["srr","mss_speed","mas_speed","asr"]);
  assert.match(html,/达成 112\.5%/);assert.match(html,/width:100%/);assert.match(html,/发展有氧速度/);
  assert.ok(html.indexOf("发展有氧速度")<html.indexOf('data-capability-metric="srr"'));
  assert.doesNotMatch(html,/组成数据/);
});
test("literature targets keep their reference name and use the agreed short assessment labels",()=>{
  const html=V.bodyTooltip({name:"髋",status:"amber",tests:[{name:"外展",side:"L",sideLabel:"L",value:300,unit:"N",target:320,targetKind:"reference",status:"amber",referenceComparison:{label:"低于参考目标"},label:"关注"},{name:"外展",side:"R",sideLabel:"R",value:330,unit:"N",target:320,targetKind:"reference",status:"green",referenceComparison:{label:"达到参考目标"},label:"达标"}]});
  assert.match(html,/参考目标 320(?:\.00)? N/);assert.match(html,/关注/);assert.match(html,/达标/);assert.doesNotMatch(html,/未启用评价标准|低于参考目标|达到参考目标/);
});
test("isometric report keeps L and R naming and explicit fixed column proportions",()=>{
  const r=fixture();r.enabled.iso=true;
  const row=r.data.iso.find(item=>item.paired);assert.ok(row);row.trials=[0,1,2].map(index=>({id:`iso-trial-${index}`,left:30+index,right:35+index,painLeft:false,painRight:false}));
  const before=JSON.stringify(r),report=R.build(r),html=R.render(report);
  assert.match(html,/<colgroup><col style="width:14%"><col style="width:20%"><col style="width:21%"><col style="width:7%"><col style="width:12%"><col style="width:13%"><col style="width:13%"><\/colgroup>/);
  const iso=html.split('class="iso-results with-repeat-columns"')[1].split('</table>')[0];
  assert.doesNotMatch(iso,/左向|右向|向较弱|L较弱|R较弱/);assert.match(iso,/左侧更弱|右侧更弱/);
  assert.equal(JSON.stringify(r),before);
});
test("untargeted isometric measurements retain pain and asymmetry grades without inventing a pass",()=>{
  for(const sample of [{left:26,status:"amber",label:"关注"},{left:20,status:"red",label:"预警"},{left:30,status:"gray",label:""},{left:30,pain:true,status:"red",label:"预警"}]){
    const r=M.defaults();Object.keys(r.enabled).forEach(id=>r.enabled[id]=id==="iso");
    const row=r.data.iso.find(item=>item.region==="hip"&&item.directionCode==="externalRotation");
    Object.assign(row,{target:null,reference:null,left:sample.left,right:30,painLeft:!!sample.pain,painRight:false});r.isoDirectionIds=[row.id];
    const report=R.build(r),analysis=report.stats.isoAnalyses.find(item=>item.id===row.id);
    assert.equal(analysis.sides[0].target,null);assert.equal(analysis.sides[0].status,sample.status);
    const html=R.render(report),rendered=html.match(new RegExp(`<tr\\b[^>]*data-row-id="${row.id}"[^>]*>([\\s\\S]*?)<\\/tr>`));assert.ok(rendered);
    const evaluation=rendered[1].match(/<td\b[^>]*data-label="评价"[^>]*>([\s\S]*?)<\/td>/)?.[1]||"-";
    if(sample.label){assert.match(evaluation,new RegExp(`pill ${sample.status} iso-status`));assert.match(evaluation,new RegExp(sample.label));}
    else {assert.equal(evaluation,"-");assert.doesNotMatch(evaluation,/达标|green/);}
  }
});
test("body hotspots include only recorded regions and retain zero pain and partial measurements",()=>{
  const html=V.body({neck:{status:"gray",hasMeasured:true,tests:[{value:0,missing:false}]},
    shoulder_l:{status:"gray",hasMeasured:false,tests:[{value:null,target:100,missing:true}]},
    shoulder_r:{status:"red",tests:[{value:null,pain:true,missing:true}]},
    scapula_l:{status:"gray",hasMeasured:true,tests:[{hasMeasured:true,value:null,missing:true,notes:"左侧 2 / 右侧 未测"}]},
    scapula_r:{status:"red",hasMeasured:false,tests:[{value:null,target:100}]},
    hip_l:{status:"gray",tests:[{value:0,missing:false}]},knee_r:"green",ankle_r:"gray",trunk:{status:"green"}},"body.png");
  assert.deepEqual([...html.matchAll(/data-region="([^"]+)"/g)].map(match=>match[1]),["neck","shoulder_r","scapula_l","hip_l","knee_r"]);
  assert.equal((html.match(/<circle /g)||[]).length,10);assert.equal((html.match(/stroke-dasharray="4 3"/g)||[]).length,1);
  assert.match(html,/aria-label="颈部：已测/);assert.match(html,/aria-label="左肩胛带：已测/);
  const empty=V.body({},"body.png");assert.doesNotMatch(empty,/class="viz-hotspot"|<circle |stroke-dasharray="4 3"|data-body-detail=/);assert.match(empty,/<image /);
});
console.log(`${passed} report v2.16 checks passed`);
