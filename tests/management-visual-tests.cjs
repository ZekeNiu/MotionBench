"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/management"),result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),pass:false,errors:[],layouts:[],images:[]};
fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:"chrome"}),page=await browser.newPage({offline:true,viewport:{width:1440,height:960},reducedMotion:"reduce"});page.on("pageerror",e=>result.errors.push(e.message));
 async function shot(id,fullPage=true){await page.evaluate(()=>{document.querySelector('#toast').style.display="none";});const target=path.join(out,id+".png");await page.screenshot({path:target,fullPage});result.images.push({path:path.relative(root,target).replaceAll("\\","/"),sha256:createHash("sha256").update(fs.readFileSync(target)).digest("hex")});}
 try{await page.goto(pathToFileURL(file).href);await page.evaluate(()=>App.ready);await page.evaluate(()=>App.loadDemo());
  for(const [width,height]of [[1440,960],[390,844],[844,390]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>{App.openManagement("profiles");RingsideManagement.viewProfile(App.getState().evaluationProfileId);});
   for(const tab of ["definitions","imtp","rules","axes","iso","balance","lvp"]){await page.locator(`[data-manager-action="profile-tab"][data-id="${tab}"]`).click();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`${width} ${tab}`);const colors=await page.locator(".profile-tabs [aria-current=page]").evaluate(el=>{const s=getComputedStyle(el);return[s.color,s.backgroundColor];});assert.notEqual(colors[0],colors[1]);assert.notEqual(colors[1],"rgb(248, 249, 251)");result.layouts.push({width,height,tab,overflow});if(width===1440&&["definitions","imtp"].includes(tab)||width===390&&tab==="lvp"||width===844&&tab==="axes")await shot("profile-"+width+"-"+tab);}
   await page.evaluate(()=>{App.openManagement("records");});await shot("records-"+width);
   await page.evaluate(()=>{App.openEntry("cmj");});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);if(width===1440)await shot("entry-cmj-1440");
   await page.evaluate(async()=>{await App.showReport();App.viewEvaluation();});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);if(width===390)await shot("effective-standards-390",false);await page.evaluate(()=>App.close("managementModal"));
  }
  assert.deepEqual(result.errors,[]);result.pass=true;console.log("PASS 21 profile layouts, 3 records/entry/standard views");
 }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;}finally{fs.writeFileSync(path.join(out,"visual-layouts.json"),JSON.stringify(result,null,2));await browser.close();}
})();
