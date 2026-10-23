"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{context}=require("./helpers/longitudinal-fixture.cjs"),c=context();
for(const name of["metric-semantics","comparison","horizontal-view"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),c);
const html=(value,base)=>c.RingsideHorizontalView.table([{id:"ratio",name:"比值",unit:"比值",meaning:"numeric",measurementScale:"ratio",cells:[{value}],differences:[c.RingsideComparison.difference(value,base,"ratio","比值")]}],[{athleteId:"a",recordId:"r",athlete:{name:"队员"},date:"2026-01-01"}],{wrapped:false});
assert.match(html(1/3,.3361),/低于 0\.0028 比值/);assert.doesNotMatch(html(1/3,.3361),/低于 0 比值/);assert.match(html(.45,.45000000000000007),/持平/);assert.match(html(2e-30,1e-30),/高于 1\.00e-30 比值/);assert.match(html(.02,.01),/高于 0\.01 比值/);console.log("PASS horizontal differences retain real small values without presenting numerical noise as change");
console.log("1 horizontal difference display checks passed");
