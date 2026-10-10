"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const context=vm.createContext({console,Intl,crypto:require("node:crypto").webcrypto});context.window=context;
for(const name of ["calc","fvp","cpet-reference","definitions","tests","iso-reference","scoring", "model"])
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),context);
const M=context.RingsideModel;let passed=0;
const test=(name,run)=>{run();passed++;console.log("PASS "+name);};
const fixture=()=>{const r=M.defaults();r.enabled.cmj=r.enabled.imtp=true;r.data.cmj=[{id:"cmj-1",height:40,force:1500}];r.data.imtp=[{id:"imtp-1",peakForce:2500}];return r;};
test("force entries alone preserve the explicit comparability requirement and expose the blocker",()=>{
  const r=fixture(),before=JSON.stringify(r),raw=M.stats(r).raw;
  assert.equal(raw.dsi,null);assert.match(raw.dsiReason,/尚未确认/);
  assert.equal(raw.dsiContext.cmjForce,1500);assert.equal(raw.dsiContext.isometricForce,2500);
  assert.equal(raw.dsiContext.ready,false);assert.equal(JSON.stringify(r),before);
});
test("confirmed same-unit same-definition forces calculate DSI without changing measurements",()=>{
  const r=fixture();r.dsi.confirmed=true;const before=JSON.stringify(r),raw=M.stats(r).raw;
  assert.equal(raw.dsi,.6);assert.equal(raw.dsiContext.ready,true);assert.equal(raw.dsiContext.issues.length,0);
  assert.equal(raw.dsiReason,"");assert.equal(JSON.stringify(r),before);
});
test("confirmation never permits unlike units or gross/net definitions",()=>{
  const r=fixture();r.dsi.confirmed=true;r.imtpConfig.unit="kgf";
  let raw=M.stats(r).raw;assert.equal(raw.dsi,null);assert.match(raw.dsiReason,/单位不一致.*N.*kgf/);
  r.imtpConfig.unit="N";r.imtpConfig.definition="net";
  raw=M.stats(r).raw;assert.equal(raw.dsi,null);assert.match(raw.dsiReason,/口径不一致.*总力.*净力/);
});
test("DSI keeps the selected CMJ trial paired with its own force and explains missing height",()=>{
  const r=fixture();r.dsi.confirmed=true;r.data.cmj.push({id:"cmj-best",height:45,force:""});
  let raw=M.stats(r).raw;assert.equal(raw.dsi,null);assert.match(raw.dsiReason,/本次采用.*峰值力/);
  r.data.cmj[1].force=2000;assert.equal(M.stats(r).raw.dsi,.8);
  r.data.cmj=[{id:"force-only",height:"",force:1500}];raw=M.stats(r).raw;
  assert.equal(raw.dsi,null);assert.match(raw.dsiReason,/垂直跳跃高度/);
});
test("a confirmed alternative isometric source works without IMTP while disabled CMJ remains unavailable",()=>{
  const r=fixture();r.enabled.imtp=false;r.dsi.source="manual";r.dsi.force=2000;r.dsi.definition="gross";r.dsi.confirmed=true;
  const raw=M.stats(r).raw;assert.equal(raw.dsi,.75);assert.equal(raw.dsiContext.source,"manual");
  r.enabled.cmj=false;assert.equal(M.stats(r).raw.dsi,null);assert.match(M.stats(r).raw.dsiReason,/启用 CMJ/);
});
console.log(passed+" DSI 2.16.1 model checks passed");
