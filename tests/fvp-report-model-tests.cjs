"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const context=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});context.window=context;
for(const name of ["calc","fvp","sources","definitions","tests","model","evaluation","interventions","viz","report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname,`../src/ringside-${name}.js`),"utf8"),context,{filename:name});
const M=context.RingsideModel,R=context.RingsideReport,V=context.RingsideViz;
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
function fixture(){
  const r=M.defaults();r.athlete.mass=72;r.enabled=Object.fromEntries(Object.keys(r.enabled).map(id=>[id,id==="fvp_sj"]));
  Object.assign(r.fvpConfig.fvp_sj,{distanceCm:33,device:"设备 & 条件",method:"腾空时间法",posture:"双手叉腰"});
  r.data.fvp_sj=[0,20,40,60,80].map((load,i)=>({id:`sj_${i}`,load,height:[33,27,22,14,10][i]}));return r;
}
const finite=html=>assert.doesNotMatch(html,/NaN|Infinity/);
test("FVP-only records retain capability analysis and paired chart/table results",()=>{
  const r=fixture(),report=R.build(r),html=R.render(report);
  assert.match(html,/能力结构分析/);assert.match(html,/data-fvp-panel="fvp_sj"/);assert.match(html,/data-fvp-elasticity="fvp_sj"/);
  assert.equal((html.match(/class="detail-pair fvp-/g)||[]).length,2);assert.match(html,/FVP的不平衡性[\s\S]*25\.86%/);
  assert.match(html,/发展方向：力量端/);assert.doesNotMatch(html,/调整潜力|剖面比/);assert.deepEqual(Array.from(report.diagnostics),[]);finite(html);
});
test("PDF protocol expansion preserves each saved angle, curve flags and measured range",()=>{
  const r=fixture();r.enabled.fvp_cmj=true;r.data.fvp_cmj=r.data.fvp_sj.map(row=>({...row,id:row.id.replace("sj","cmj")}));r.fvpConfig.fvp_cmj.distanceCm=33;
  r.views.fvpProtocol="fvp_cmj";Object.assign(r.fvpAnalysis.fvp_cmj,{angle:30});Object.assign(r.fvpView.fvp_sj,{fv:false,pv:false,range:"measured"});Object.assign(r.fvpView.fvp_cmj,{comparison:true,confidence:false});
  const report=R.build(r),interactive=R.renderFVPAnalysis(report),print=R.renderFVPAnalysis(report,{print:true});
  assert.doesNotMatch(interactive,/data-fvp-panel="fvp_sj"/);assert.match(interactive,/data-fvp-panel="fvp_cmj"/);
  assert.match(print,/data-fvp-panel="fvp_sj"/);assert.match(print,/data-fvp-panel="fvp_cmj"/);assert.match(print,/30° 倾斜目标/);
  assert.match(print,/勾选 F–V 或 P–V 查看曲线/);assert.match(print,/&quot;range&quot;:&quot;measured&quot;/);assert.match(print,/&quot;confidence&quot;:false/);
  assert.doesNotMatch(print,/data-fvp-view=|data-fvp-scenario-form/);finite(print);
  r.data.fvp_cmj=r.data.fvp_cmj.slice(0,2);assert.doesNotMatch(R.renderFVPAnalysis(R.build(r),{print:true}),/data-fvp-panel="fvp_cmj"/);
});
test("target direction changes FVP comparison while elasticity stays vertical",()=>{
  const r=fixture();Object.assign(r.fvpAnalysis.fvp_sj,{deltaForcePct:5,deltaVelocityPct:3});
  const a=R.renderFVPAnalysis(R.build(r));r.fvpAnalysis.fvp_sj.angle=30;const b=R.renderFVPAnalysis(R.build(r));
  const elasticity=html=>html.slice(html.indexOf('<article class="fvp-analysis-card" data-fvp-elasticity=')).replace(/ringside-viz-\d+/g,"ringside-viz-id");assert.equal(elasticity(a),elasticity(b));
  assert.match(b,/FVP的不平衡性[\s\S]*7\.22%/);assert.match(b,/垂直跳跃高度改变/);assert.match(b,/情景判定/);assert.match(b,/力量弹性 Fₑ/);
});
test("load tables preserve repeat statistics, selected attempts and exclusions",()=>{
  const r=fixture();r.data.fvp_sj.push({id:"low1",load:0,height:31},{id:"low2",load:0,height:32},{id:"excluded",load:20,height:45,excluded:true,exclusionReason:"手臂摆动",notes:"<原始备注>"});
  const html=R.renderFVPAnalysis(R.build(r));assert.match(html,/32\.00 ± 1\.00 cm \/ 3\.1%/);assert.match(html,/data-fvp-load="0" role="button" tabindex="0"/);
  assert.match(html,/已排除/);assert.match(html,/手臂摆动/);assert.match(html,/&lt;原始备注&gt;/);assert.match(html,/data-raw-trials="fvp_sj"/);
});
test("curve toggles and narrow dual-axis rendering remain finite with negative confidence bounds",()=>{
  const p={kind:"current",label:"当前剖面",F0:35,V0:3,Pmax:26.25},data={id:"fvp_sj",valid:true,profiles:[p],points:[{load:0,height:30,velocity:1,force:23,power:23}],band:[{x:.8,low:-100,high:120,powerLow:-80,powerHigh:96},{x:1.2,low:-80,high:110,powerLow:-96,powerHigh:132}]};
  for(const fv of [false,true])for(const pv of [false,true]){const html=V.jumpFvp(data,{fv,pv},{width:280,height:390});finite(html);if(fv||pv)assert.match(html,/-[1-9]\d/);}
  const html=V.jumpFvp(data,{},{width:280,height:390});assert.match(html,/Pmax · V₀\/2/);assert.match(html,/95%置信带/);assert.match(html,/实测点/);
  assert.doesNotMatch(V.jumpFvp(data,{points:false,confidence:false},{width:280,height:390}),/实测点<|95%置信带</);
});
test("small nonzero imbalance is shown explicitly without rounding it to zero",()=>{
  const report=R.build(fixture());report.stats.fvp.fvp_sj.imbalance.magnitudePct=.001;
  assert.match(R.renderFVPAnalysis(report),/＜0\.01%/);
});
console.log(`\n${passed} FVP report and visualization checks passed.`);
