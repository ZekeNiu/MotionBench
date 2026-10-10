"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/playwright/picker"),channel=process.argv.includes("--edge")?"msedge":process.env.BROWSER_CHANNEL||"chrome";
const result={channel,scope:"source component browser checks",artifactHash:createHash("sha256").update(fs.readFileSync(path.join(root,"MotionBench.html"))).digest("hex"),sourceHash:createHash("sha256").update(fs.readFileSync(path.join(root,"src/ringside-picker.js"))).digest("hex"),checks:[],errors:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1280,height:900}}),page=await context.newPage();page.on("pageerror",error=>result.errors.push(error.message));
 const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS",name);};
 try{
  fs.mkdirSync(out,{recursive:true});await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main style="max-width:1100px;margin:auto;padding:16px"><label class="field">方案名称<input id="planName" value="保留的草稿"></label><div id="picker"></div></main></body></html>');
  for(const name of ["ringside.css","ringside-management-refinement.css"])await page.addStyleTag({path:path.join(root,"src",name)});
  for(const name of ["calc", "fvp","cpet-reference","definitions","tests","scoring", "model","picker"])await page.addScriptTag({path:path.join(root,"src/ringside-"+name+".js")});
  await page.evaluate(()=>{window.selection={testIds:["cmj"],isoDirectionIds:[]};const options={source:RingsideModel.defaults(),selection,context:"plan",onChange(next){window.selection=next;}};document.querySelector('#picker').innerHTML=RingsidePicker.render(options);window.picker=RingsidePicker.bind(document.querySelector('#picker'),options);});
  await check("continuous keyboard selection keeps focus grid nodes and other draft fields",async()=>{
   const control=page.locator('[data-picker-project="imtp"]');await control.focus();await page.evaluate(()=>{window.initialControl=document.activeElement;window.initialGrid=document.querySelector('.check-grid');});await control.press("Space");
   assert.deepEqual(await page.evaluate(()=>({focused:document.activeElement===initialControl,grid:document.querySelector('.check-grid')===initialGrid,selected:selection.testIds,name:document.querySelector('#planName').value})),{focused:true,grid:true,selected:["cmj","imtp"],name:"保留的草稿"});
  });
  await check("isometric direction selection is explicit and reversible without deleting retained choices",async()=>{
   await page.locator('[data-picker-project="iso"]').check();assert.equal(await page.locator('[data-picker-iso]:checked').count(),0);assert.equal(await page.locator('[data-picker-iso]').count(),42);
   const control=page.locator('[data-picker-iso="iso_neck_flexion"]');await control.focus();await control.press("Space");assert.equal(await page.evaluate(()=>document.activeElement.dataset.pickerIso),"iso_neck_flexion");
   await page.locator('[data-picker-project="iso"]').uncheck();assert.equal(await page.locator('[data-picker-iso-panel]').isVisible(),false);assert.deepEqual(await page.evaluate(()=>selection.isoDirectionIds),["iso_neck_flexion"]);
   await page.locator('[data-picker-project="iso"]').check();assert.equal(await control.isChecked(),true);
   await page.locator('[data-picker-action="iso-all"][data-picker-id="hip"]').click();assert.equal(await page.locator('[data-picker-iso]:checked').count(),7);await page.locator('[data-picker-action="iso-none"][data-picker-id="hip"]').click();assert.equal(await page.locator('[data-picker-iso]:checked').count(),1);
  });
  await check("ordering changes only the selected order and retains keyboard focus",async()=>{
   await page.locator('.picker-order summary').click();const move=page.locator('[data-picker-action="up"][data-picker-id="imtp"]');await move.focus();await move.press("Enter");
   assert.deepEqual(await page.evaluate(()=>selection.testIds),["imtp","cmj","iso"]);
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.pickerId),"imtp");
   assert.equal(await page.locator('[data-picker-project="imtp"]').isChecked(),true);
   await page.locator('[data-picker-action="down"][data-picker-id="imtp"]').focus();await page.locator('[data-picker-action="down"][data-picker-id="imtp"]').press("Enter");
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.pickerId),"imtp");assert.deepEqual(await page.evaluate(()=>selection.testIds),["cmj","imtp","iso"]);
  });
  await check("mobile direction controls and selected order remain inside the viewport",async()=>{
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('[data-picker-iso-panel]').screenshot({path:path.join(out,channel+'-directions-mobile.png')});
  });
  await check("report toolbar fields share control heights and align across desktop tablet and mobile",async()=>{
   const toolbar=await context.newPage();toolbar.on("pageerror",error=>result.errors.push(error.message));
   const markup=fs.readFileSync(path.join(root,"src/ringside-shell.html"),"utf8").match(/<section id="reportToolbar"[\s\S]*?<\/section>/)[0];
   await toolbar.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'+markup+'</body></html>');
   for(const name of ["ringside.css","ringside-workflow.css","ringside-management-refinement.css","ringside-report-refinement.css"])await toolbar.addStyleTag({path:path.join(root,"src",name)});
   await toolbar.evaluate(()=>{document.querySelector('#reportActions').hidden=false;document.querySelector('#reportAthleteSearch').value='李同学 · 篮球 · 123456';document.querySelector('#recordSelect').innerHTML='<option>2026-10-08 · 季度复测</option>';});
   for(const width of [1440,768,390]){
    await toolbar.setViewportSize({width,height:844});
    const geometry=await toolbar.evaluate(()=>({fields:['reportGroupFilter','reportAthleteSearch','recordSelect'].map(id=>{const rect=document.getElementById(id).getBoundingClientRect();return{id,x:rect.x,y:rect.y,w:rect.width,h:rect.height};}),overflow:document.documentElement.scrollWidth>innerWidth+1}));
    assert.equal(geometry.overflow,false);assert.ok(geometry.fields.every(field=>field.h===42&&field.w>0));assert.equal(geometry.fields[0].y,geometry.fields[1].y);
    if(width>700)assert.equal(geometry.fields[1].y,geometry.fields[2].y);else assert.ok(geometry.fields[2].y>geometry.fields[1].y);
    await toolbar.locator('#reportToolbar').screenshot({path:path.join(out,channel+'-toolbar-'+width+'.png')});
   }
   await toolbar.close();
  });
  assert.deepEqual(result.errors,[]);assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root,"MotionBench.html"))).digest("hex"),result.artifactHash);result.pass=true;
 }finally{fs.writeFileSync(path.join(out,channel+'-results.json'),JSON.stringify(result,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
