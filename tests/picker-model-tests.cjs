"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const context=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});context.window=context;
for(const name of ["calc","cpet-reference","definitions","tests","model","picker"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),context);
const M=context.RingsideModel,T=context.RingsideTests,P=context.RingsidePicker,copy=value=>JSON.parse(JSON.stringify(value));
let passed=0;const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
const source=M.defaults(),options={source,selection:{testIds:[],isoDirectionIds:[]}},apply=(selection,action,extra={})=>copy(P.applyAction(selection,action,{...options,...extra,selection}));

test("individual choices preserve existing order and append only new projects",()=>{
 const selected={testIds:["imtp","cmj"],isoDirectionIds:[]},next=apply(selected,{kind:"project",id:"sj",checked:true});
 assert.deepEqual(next.testIds,["imtp","cmj","sj"]);assert.deepEqual(selected.testIds,["imtp","cmj"]);
 assert.deepEqual(apply(next,{kind:"project",id:"cmj",checked:true}).testIds,next.testIds);
 assert.deepEqual(apply(next,{kind:"move",id:"sj",offset:-1}).testIds,["imtp","sj","cmj"]);
});
test("bulk selection uses visible catalog order and skips unavailable projects",()=>{
 const described=copy(T.describe(source)),blocked="cmj";described.find(project=>project.id==="sj").disabled=true;
 const selected={testIds:["imtp"],isoDirectionIds:[]},extra={projects:described,blockedIds:[blocked]},next=apply(selected,{kind:"group",id:"all",checked:true},extra);
 const expected=T.groups(described.filter(project=>!project.disabled),source).flatMap(group=>group.projects).map(project=>project.id).filter(id=>id!==blocked&&id!=="imtp");
 assert.deepEqual(next.testIds,["imtp",...expected]);assert.ok(!next.testIds.includes("sj"));
 assert.deepEqual(apply(selected,{kind:"project",id:blocked,checked:true},extra).testIds,["imtp"]);
 assert.deepEqual(apply(selected,{kind:"project",id:"unrecognized",checked:true}).testIds,["imtp"]);
});
test("selecting the isometric parent never implicitly selects all directions",()=>{
 const next=apply({testIds:[],isoDirectionIds:[]},{kind:"project",id:"iso",checked:true});
 assert.deepEqual(next,{testIds:["iso"],isoDirectionIds:[]});
 const withDirection=apply(next,{kind:"iso",id:"iso_neck_flexion",checked:true});
 assert.deepEqual(withDirection.isoDirectionIds,["iso_neck_flexion"]);
 const disabled=apply(withDirection,{kind:"project",id:"iso",checked:false});
 assert.deepEqual(disabled.testIds,[]);assert.deepEqual(disabled.isoDirectionIds,["iso_neck_flexion"]);
 assert.deepEqual(apply(disabled,{kind:"project",id:"iso",checked:true}).isoDirectionIds,["iso_neck_flexion"]);
});
test("joint bulk choices affect only the requested region and preserve other choices",()=>{
 const selected={testIds:["iso"],isoDirectionIds:["iso_neck_flexion"]};
 const next=apply(selected,{kind:"iso-group",id:"hip",checked:true});
 assert.deepEqual(next.isoDirectionIds,["iso_neck_flexion",...M.isoRows().filter(row=>row.region==="hip").map(row=>row.id)]);
 assert.deepEqual(apply(next,{kind:"iso-group",id:"hip",checked:false}).isoDirectionIds,["iso_neck_flexion"]);
 assert.deepEqual(apply(next,{kind:"iso",id:"unknown",checked:true}),next);
});
test("legacy direction selections survive unrelated project selection without expansion",()=>{
 const selected={testIds:["iso"],isoDirectionIds:copy(M.legacyIsoDirectionIds())};
 const next=apply(selected,{kind:"group",id:"all",checked:true});
 assert.equal(next.isoDirectionIds.length,22);assert.deepEqual(next.isoDirectionIds,selected.isoDirectionIds);assert.equal(M.isoRows().length,42);
});
test("all contexts use the same project and direction controls with escaped labels",()=>{
 for(const contextName of ["plan","creation","record"]){
  const html=P.render({...options,context:contextName,selection:{testIds:["iso"],isoDirectionIds:["iso_neck_flexion"]}});
  assert.equal((html.match(/data-picker-project=/g)||[]).length,T.describe(source).length);
  assert.equal((html.match(/data-picker-iso=/g)||[]).length,42);
  assert.equal((html.match(/data-picker-iso="iso_neck_flexion"[^>]*checked/g)||[]).length,1);
 }
 const custom=copy(T.describe(source));custom[0].name='<img src=x onerror="bad">';
 assert.doesNotMatch(P.render({...options,projects:custom}),/<img src=x/);
});
console.log(`${passed} picker model checks passed`);
