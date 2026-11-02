"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
function context(){
  const c=vm.createContext({console,Intl,Blob,TextDecoder,TextEncoder,setTimeout,clearTimeout,crypto:require("node:crypto").webcrypto});c.window=c;
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../../vendor/exceljs.min.js"),"utf8"),c);
  for(const name of ["calc","calculations","scoring","fvp","sprint-fvp","sprint-elasticity","sprint-fvp-confidence","sources","cpet-reference","iso-reference","definitions","tests","metric-semantics","classifications","generic-report","model","acquisition","evaluation","interventions","report-appearance","viz","report","result-display","longitudinal","comparison","horizontal","excel","excel-v3"])
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../../src/ringside-"+name+".js"),"utf8"),c,{filename:name});
  return c;
}
function fixture(c=globalThis){
  const M=c.RingsideModel,r=M.defaults();Object.keys(r.enabled).forEach(id=>r.enabled[id]=false);
  r.demo=false;r.athlete.name="合成计算验收";r.athlete.date="2026-02-01";r.evaluationProfileId="synthetic_evaluation";
  for(const [id,primary]of [["calc_run","calc_total"],["calc_turn","calc_turn_time"]]){r.customTests.push({id,name:id,category:"performance",primaryMetricId:primary,selectionDirection:"lower"});r.enabled[id]=true;r.protocol[id]="合成计时协议";}
  const d=(id,testId,scope="attempt",extra={})=>({id,testId,name:id,unit:"s",category:"performance",entryScope:scope,ability:"",direction:"lower",directionStatus:"confirmed",resultMeaning:"numeric",measurementScale:"ratio",target:null,ranges:[],referenceEnabled:false,...extra});
  r.definitions.push(d("calc_segment_a","calc_run"),d("calc_segment_b","calc_run"),d("calc_total","calc_run","attempt",{distanceM:20,calculation:{version:1,kind:"sum",inputMetricIds:["calc_segment_a","calc_segment_b"]}}),d("calc_turn_time","calc_turn"),d("calc_deficit","calc_turn","record",{measurementScale:"interval",calculation:{version:1,kind:"cod-deficit",timeMetricId:"calc_turn_time",referenceDistanceM:20}}));
  r.data.calc_run=[{id:"run_a",metrics:{calc_segment_a:2,calc_segment_b:1}},{id:"run_b",metrics:{calc_segment_a:1,calc_segment_b:3}},{id:"run_partial",metrics:{calc_segment_a:0.1}}];
  r.data.calc_turn=[{id:"turn_a",metrics:{calc_turn_time:5}},{id:"turn_b",metrics:{calc_turn_time:4}}];
  r.calculationBindings={calc_deficit:{testId:"calc_run",metricId:"calc_total",distanceM:20}};
  r.testPlanSnapshot={id:"synthetic_calculation_plan",name:"合成计算方案",testIds:["calc_run","calc_turn"],calculationBindings:JSON.parse(JSON.stringify(r.calculationBindings))};
  r.views.genericReports ||= {};
  r.views.genericReports.calc_turn=c.RingsideGenericReport.createView(r,"calc_turn",{kind:"bar",metricIds:["calc_deficit"]});
  return M.normalizeRecord(r);
}
module.exports={context,fixture};
