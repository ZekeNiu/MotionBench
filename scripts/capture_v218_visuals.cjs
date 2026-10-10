"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("../tests/helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),source=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/dual-elasticity-2.18.0/final/visual");
fs.mkdirSync(out,{recursive:true});const hash=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const result={sourceSha256:hash(source),synthetic:true,artifacts:[],pass:false};
(async()=>{
 for(const channel of ["chrome","msedge"]){
  const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,reducedMotion:"reduce",viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on("pageerror",e=>{throw e;});await page.goto(pathToFileURL(source).href);await page.waitForFunction(()=>!!window.App?.ready);
  const fixture=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/three-fvp-regions.json")));
  await page.evaluate(async fixture=>{const payload=structuredClone(fixture.library),r=payload.athletes[0].records[0],s=fixture.currentSprint;r.sprintFvpVersion=s.sprintFvpVersion;r.enabled.sprint_fvp=s.enabled;r.data.sprint_fvp=s.data;r.sprintFvpConfig=s.config;r.sprintFvpAnalysis=s.analysis;await App.importPayload(payload,"replace-library");await App.showReport(false);},fixture);
  await page.locator('[data-capability-selection="strength"]').selectOption("jump_elasticity");await page.locator('[data-capability-selection="speed"]').selectOption("sprint_elasticity");await page.evaluate(()=>App.saveNow());
  const settled=()=>page.waitForFunction(()=>!/正在|失败/.test(document.querySelector("#saveStatus").textContent)&&getComputedStyle(document.querySelector("#toast")).display==="none");
  const capture=async(width,name,locator)=>{
   await settled();await page.mouse.move(0,0);const original=page.viewportSize(),box=await locator.boundingBox();
   await page.setViewportSize({width,height:Math.max(1000,Math.ceil(box.height)+180)});
   await locator.evaluate(n=>scrollTo({top:scrollY+n.getBoundingClientRect().top-90,behavior:"instant"}));
   const file=path.join(out,`${channel}-${width}-${name}.png`);await locator.screenshot({path:file,animations:"disabled"});
   result.artifacts.push({path:path.relative(root,file).replaceAll("\\","/"),sha256:hash(file),channel,width,name});
   await page.setViewportSize(original);
  };
  for(const width of [1440,1280,900,390]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await capture(width,"cards-complete",page.locator("[data-capability-analysis]"));
   for(const [view,sview]of [["response","response"],["constraint","distance"]]){
    await page.locator('[data-fvp-view="elasticityView"]').selectOption(view);await page.locator('[data-sprint-elasticity-view]').selectOption(sview);
    await capture(width,"jump-"+view+"-complete",page.locator("[data-fvp-elasticity]"));await capture(width,"sprint-"+sview+"-complete",page.locator("[data-sprint-elasticity-panel]"));
   }
  }
  await context.close();await browser.close();
 }
 result.pass=hash(source)===result.sourceSha256;fs.writeFileSync(path.join(out,"capture-results.json"),JSON.stringify(result,null,2));console.log("PASS",result.artifacts.length,"complete-region screenshots");
})().catch(e=>{console.error(e);process.exitCode=1;});
