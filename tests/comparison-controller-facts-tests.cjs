"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {loadComparisonContext}=require("./helpers/comparison-fixtures.cjs"),c=loadComparisonContext(),M=c.RingsideModel,C=c.RingsideComparison;
const plain=x=>JSON.parse(JSON.stringify(x)),digest=x=>crypto.createHash("sha256").update(x).digest("hex"),size=x=>Buffer.byteLength(JSON.stringify(x));
const file=path.resolve(__dirname,"../src/ringside-comparison-controller.js"),source=fs.readFileSync(file,"utf8"),controllerHash=digest(source);
c.location={pathname:"/personal-longitudinal-facts-test"};
assert.ok(source.includes("Object.assign(api,{select,"));
vm.runInContext(source.replace("Object.assign(api,{select,","api.__setFixture = value => {model=value;selection=copy(value.selection);};\n    Object.assign(api,{select,"),c);
const controller=(model,library)=>{const api=c.RingsideComparisonController.create({library:()=>library});api.__setFixture(model);return api;};
const dates=["2026-04-01","2026-04-19","2026-05-11","2026-06-07"];
const athlete={id:"personal-athlete",name:"个人模拟运动员",groupId:"group",profile:{},records:dates.flatMap((date,i)=>{
 if(i===2)return [];
 const r=M.defaults();r.athleteId=athleteId();r.recordId="personal-record-"+i;r.athlete.name="个人模拟运动员";r.athlete.date=date;r.athlete.mass=70;
 Object.keys(r.enabled).forEach(id=>r.enabled[id]=["cmj","sj","fms"].includes(id));
 r.data.cmj=i===1?[]:[{id:"cmj",height:30+i*2}];r.data.sj=[{id:"sj",height:25+i}];
 r.data.fms.forEach((item,j)=>{item.pain=j===0&&i===0;if(item.bilateral){item.left=2;item.right=3;}else item.score=item.pain?0:2;item.notes="保留左右侧与疼痛备注";});
 return[r];
})};
function athleteId(){return "personal-athlete";}
const foreign={id:"foreign-athlete",name:"其他人的资料",profile:{},records:[]};
const library={athletes:[athlete,foreign],groups:[{id:"group",name:"模拟队伍"}],catalog:M.normalizeCatalog(),evaluationProfiles:[]};
const selection={groupId:"group",athleteIds:[athlete.id],dates,recordChoices:{[athlete.id]:Object.fromEntries(dates.map(date=>[date,athlete.records.find(r=>r.athlete.date===date)?.recordId||""]))}};
const model=C.deriveComparison(library,selection);
model.metrics[0].observations[0].notes="人工核对备注\n第二行";
model.summary.transitions.push({athleteId:athlete.id,fromDate:dates[0],toDate:dates[1],key:"advantage:boolean",title:"优势进入",from:false,to:true,state:"entered",reason:""});
const api=controller(model,library),facts=plain(api.facts());
const scalars=x=>Object.fromEntries(Object.entries(x).filter(([,v])=>v===null||["string","number","boolean"].includes(typeof v)));
let passed=0;function test(name,run){run();passed++;console.log("PASS "+name);}
test("personal facts contain exactly the selected athlete and explicit date-record bindings",()=>{
 assert.equal(facts.factsVersion,2);assert.equal(facts.reportType,"personal-longitudinal");assert.equal(facts.athlete.id,athlete.id);
 assert.equal(JSON.stringify(facts).includes(foreign.id),false);assert.equal(facts.athletes,undefined);
 assert.deepEqual(facts.selectedRecordIds,dates.map(date=>({date,recordId:selection.recordChoices[athlete.id][date]||null})));
});
test("all observations retain their dates values missingness pain sides notes and record IDs",()=>{
 assert.equal(facts.metrics.length,model.metrics.length);
 facts.metrics.forEach((m,i)=>assert.deepEqual(m.observations,plain(model.metrics[i].observations.map(scalars))));
 assert.ok(facts.metrics.some(m=>m.observations.some(o=>o.value===0&&o.pain===true)));
 assert.ok(facts.metrics.some(m=>m.observations.some(o=>o.value===null&&o.recordId==="")));
 assert.ok(facts.metrics.some(m=>m.observations.some(o=>o.notes==="人工核对备注\n第二行")));
});
test("state transitions preserve boolean false and all source subjects without indexing ambiguity",()=>{
 assert.deepEqual(facts.summary.transitions,plain(model.summary.transitions.map(scalars)));
 const row=facts.summary.transitions.find(t=>t.key==="advantage:boolean");assert.equal(row.from,false);assert.equal(row.to,true);
});
test("scientific identity personal changes and real-date trends retain exact computed values",()=>{
 facts.metrics.forEach((m,i)=>{
  const original=model.metrics[i];assert.deepEqual(m.identity,plain(original.identity));assert.deepEqual(m.changes,plain(original.changes.map(scalars)));
  assert.deepEqual(m.periods,plain(original.periods.map(scalars)));assert.deepEqual(m.trend.points,plain(original.trend.points.map(scalars)));
  assert.equal(m.cohortIds,undefined);assert.ok(m.changes.every(change=>change.p===undefined&&change.dz===undefined&&change.ciLow===undefined));
 });
 assert.equal(facts.statistics.effectSize,undefined);assert.equal(facts.statistics.correction,undefined);
});
test("current personal context and executable prescriptions match the existing individual rules",()=>{
 const last=model.entries.at(-1);assert.deepEqual(facts.athlete.testContext,plain(last.record.athlete));
 assert.deepEqual(facts.athlete.trainingContext,plain(last.record.trainingContext));assert.equal(facts.athlete.periods.length,model.entries.length);
 for(const plan of facts.existingIndividualPlans){const entry=model.entries.find(e=>e.recordId===selection.recordChoices[athlete.id][dates.at(-1)]),reference=c.RingsideInterventions.build(entry.record,entry.stats);assert.deepEqual(plan.context,plain(reference.context));assert.deepEqual(plan.execution,plain(reference.execution));}
});
test("offline narrative uses personal priorities without grouping unrelated athletes",()=>{
 const text=api.localText();assert.ok(text.includes("本次训练重点"));assert.ok(!/共同重点|分组|有效.*人|团队/.test(text));assert.ok(!text.includes(foreign.name));
});
console.log(passed+" personal longitudinal facts checks passed");
if(process.argv.includes("--full")){
 const fixture=path.resolve(__dirname,"../output/comparison-demo/个人纵向模拟资料库.json"),bytes=fs.readFileSync(fixture),fullLibrary=JSON.parse(bytes),a=fullLibrary.athletes[0];
 const ds=[...new Set(a.records.map(r=>r.athlete.date))].sort(),chosen={groupId:a.groupId,athleteIds:[a.id],dates:ds,recordChoices:{[a.id]:Object.fromEntries(ds.map(d=>[d,a.records.find(r=>r.athlete.date===d).recordId]))},basis:{strength:"jump_elasticity",reactive:"dj_rsi",speed:"sprint_elasticity",jumpProtocol:"fvp_sj"}};
 const fullModel=C.deriveComparison(fullLibrary,chosen),fullFacts=plain(controller(fullModel,fullLibrary).facts());
 fullFacts.metrics.forEach((m,i)=>assert.deepEqual(m.observations,plain(fullModel.metrics[i].observations.map(scalars))));
 assert.deepEqual(fullFacts.summary.transitions,plain(fullModel.summary.transitions.map(scalars)));
 const request={model:"synthetic-model",messages:[{role:"user",content:"个人纵向解读\n"+JSON.stringify(fullFacts)}],max_tokens:8000};
 assert.ok(size(request)<8*1024*1024);
 const receipt={pass:true,controllerSha256:controllerHash,modelSha256:digest(fs.readFileSync(path.resolve(__dirname,"../src/ringside-comparison.js"))),fixtureSha256:digest(bytes),testSha256:digest(fs.readFileSync(__filename)),factsVersion:2,people:1,dates:ds.length,records:fullModel.entries.length,metrics:fullModel.metrics.length,factsBytes:size(fullFacts),requestBytes:size(request),exactRoundTrip:{observations:fullModel.metrics.reduce((n,m)=>n+m.observations.length,0),transitions:fullModel.summary.transitions.length},sourceUnchanged:digest(fs.readFileSync(file,"utf8"))===controllerHash};
 assert.equal(receipt.sourceUnchanged,true);
 const out=path.resolve(__dirname,"../output/playwright/v2231/ai-facts-diagnostic");fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"controller-full-proof.json"),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}

