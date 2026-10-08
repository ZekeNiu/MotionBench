"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/report-toolbar"),channel=process.argv.includes("--edge")?"msedge":process.env.BROWSER_CHANNEL||"chrome";
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex"),result={channel,sourceHash:hash(file),checks:[],screenshots:[],errors:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce"}),page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",error=>result.errors.push(error.message));
 const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS",name);};
 const selected=async(athlete,record)=>{await page.waitForFunction(({athlete,record})=>App.getLibrary().activeAthleteId===athlete&&(App.getState()?.recordId||"")===record&&document.querySelector('#athleteSelect').value===athlete&&document.querySelector('#recordSelect').value===record,{athlete,record});};
 const choose=async(id,query="")=>{await page.locator('#reportAthleteSearch').focus();await page.locator('#reportAthleteSearch').fill(query);await page.locator(`[data-athlete-choice="${id}"]`).click();};
 const screenshot=async label=>{const target=path.join(out,channel+'-'+label+'.png'),toolbar=await page.locator('#reportToolbar').boundingBox(),options=await page.locator('#reportAthleteOptions').isVisible()?await page.locator('#reportAthleteOptions').boundingBox():null;await page.screenshot({path:target,clip:{x:toolbar.x,y:toolbar.y,width:toolbar.width,height:Math.max(toolbar.y+toolbar.height,options?options.y+options.height:0)-toolbar.y}});result.screenshots.push({path:path.relative(root,target).replaceAll('\\','/'),sha256:hash(target)});};
 try{
  fs.mkdirSync(out,{recursive:true});await page.goto(pathToFileURL(file).href);await page.evaluate(()=>App.ready);
  await page.evaluate(async()=>{
   await App.importPayload(RingsideModel.recordEnvelope(RingsideModel.sampleRecord()));const lib=await App.libraryPayload(),base=lib.athletes[0].records[0];
   lib.groups=[{id:"toolbar_team_a",name:"第一队"},{id:"toolbar_team_b",name:"第二队"}];
   const athlete=(id,group,empty=false)=>{
    const profile={name:empty?"无记录运动员":"同名运动员",sport:"篮球",sex:"男",dominantHand:"右手",sportLevel:""};
    const records=empty?[]:[0,1].map(index=>{const r=JSON.parse(JSON.stringify(base));r.demo=false;r.athleteId=id;r.recordId=id+"_record_"+index;r.athlete={...r.athlete,...profile,date:index?"2026-10-08":"2026-09-01"};r.title=index?"季度复测":"首次测试";r.enabled=Object.fromEntries(Object.keys(r.enabled).map(key=>[key,key==="cmj"]));r.isoDirectionIds=[];r.data.cmj[0].height=35+index;return r;});
    return{id,name:profile.name,profile,groupId:group,archived:false,deletedAt:null,records};
   };
   lib.athletes=[athlete("toolbar_athlete_a","toolbar_team_a"),athlete("toolbar_athlete_b","toolbar_team_b"),athlete("toolbar_empty_c","toolbar_team_a",true)];lib.activeAthleteId="toolbar_athlete_a";lib.activeRecordId="toolbar_athlete_a_record_1";await App.importPayload(lib,"replace-library");await App.showReport();
  });
  await check("real toolbar aligns three controls and keeps exactly two mobile actions",async()=>{
   for(const width of [1440,1280,900,768,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,fields:['reportGroupFilter','reportAthleteSearch','recordSelect'].map(id=>{const rect=document.getElementById(id).getBoundingClientRect();return{x:rect.x,y:rect.y,h:rect.height,w:rect.width};}),actions:[...document.querySelector('#reportActions').children].filter(node=>node.getClientRects().length).length}));
    assert.equal(geometry.overflow,false);assert.equal(geometry.actions,2);assert.ok(geometry.fields.every(rect=>rect.h===42&&rect.w>0));assert.equal(geometry.fields[0].y,geometry.fields[1].y);if(width>700)assert.equal(geometry.fields[1].y,geometry.fields[2].y);else assert.ok(geometry.fields[2].y>geometry.fields[1].y);await screenshot('layout-'+width);
   }
   await page.setViewportSize({width:1440,height:1000});
  });
  await check("duplicate names remain distinguishable and keyboard selection loads the chosen athlete",async()=>{
   const input=page.locator('#reportAthleteSearch');await input.focus();await input.fill("同名");assert.equal(await page.locator('[data-athlete-choice]').count(),2);assert.match(await page.locator('[data-athlete-choice="toolbar_athlete_a"]').innerText(),/第一队/);assert.match(await page.locator('[data-athlete-choice="toolbar_athlete_b"]').innerText(),/第二队/);
   await input.press("ArrowDown");assert.equal(await input.getAttribute('aria-activedescendant'),'reportAthleteOption-0');await input.press("ArrowDown");assert.equal(await page.locator('.athlete-option.highlighted').getAttribute('data-athlete-choice'),'toolbar_athlete_b');assert.notEqual(await page.locator('.athlete-option.highlighted').evaluate(node=>getComputedStyle(node).backgroundColor),await page.locator('.athlete-option[aria-selected="true"]').evaluate(node=>getComputedStyle(node).backgroundColor));await screenshot('keyboard-open');await input.press("Enter");await selected('toolbar_athlete_b','toolbar_athlete_b_record_1');assert.equal(await input.getAttribute('aria-expanded'),'false');assert.match(await input.inputValue(),/第二队/);
  });
  await check("returning to an athlete restores their last viewed historical record",async()=>{
   await choose('toolbar_athlete_a','同名');await selected('toolbar_athlete_a','toolbar_athlete_a_record_1');await page.locator('#recordSelect').selectOption('toolbar_athlete_a_record_0');await selected('toolbar_athlete_a','toolbar_athlete_a_record_0');await choose('toolbar_athlete_b','同名');await selected('toolbar_athlete_b','toolbar_athlete_b_record_1');await choose('toolbar_athlete_a','同名');await selected('toolbar_athlete_a','toolbar_athlete_a_record_0');
  });
  await check("no search matches do not change the report and Escape or Tab restores the committed label",async()=>{
   const input=page.locator('#reportAthleteSearch');await input.focus();await input.fill('不存在的运动员');assert.equal(await page.locator('[data-athlete-choice]').count(),0);assert.match(await page.locator('#reportAthleteOptions').innerText(),/没有匹配/);await input.press('ArrowDown');await selected('toolbar_athlete_a','toolbar_athlete_a_record_0');await screenshot('no-results');await input.press('Escape');assert.equal(await input.getAttribute('aria-expanded'),'false');assert.match(await input.inputValue(),/第一队/);
   await input.fill('同名');await input.press('Tab');assert.equal(await input.getAttribute('aria-expanded'),'false');await selected('toolbar_athlete_a','toolbar_athlete_a_record_0');
  });
  await check("group changes clear an out-of-group report and filter the available athletes",async()=>{
   await choose('toolbar_athlete_b','同名');await selected('toolbar_athlete_b','toolbar_athlete_b_record_1');await page.locator('#reportGroupFilter').selectOption('toolbar_team_a');await selected('','');assert.equal(await page.locator('#recordSelect').isDisabled(),true);assert.equal(await page.locator('#reportActions').isVisible(),false);assert.equal(await page.locator('#reportAthleteSearch').inputValue(),'');await page.locator('#reportAthleteSearch').focus();assert.equal(await page.locator('[data-athlete-choice]').count(),2);assert.equal(await page.locator('[data-athlete-choice="toolbar_athlete_b"]').count(),0);await page.locator('#reportAthleteSearch').press('Escape');
  });
  await check("athletes without records and clearing selection leave safe empty report controls",async()=>{
   await choose('toolbar_empty_c','无记录');await selected('toolbar_empty_c','');assert.equal(await page.locator('#recordSelect').isDisabled(),true);assert.equal(await page.locator('#reportActions').isVisible(),false);assert.match(await page.locator('#reportAthleteSearch').inputValue(),/无记录运动员/);await page.locator('.athlete-clear').click();await selected('','');assert.equal(await page.locator('#reportAthleteSearch').inputValue(),'');assert.equal(await page.locator('#recordSelect').inputValue(),'');await screenshot('empty-selection');
  });
  await check("a slower prior record load cannot overwrite the newest athlete choice",async()=>{
   await page.locator('#reportGroupFilter').selectOption('');
   const data=await page.evaluate(async()=>{const repo=App.getRepository(),original=repo.loadRecord.bind(repo);repo.loadRecord=async id=>{await new Promise(resolve=>setTimeout(resolve,id.includes('athlete_a')?120:10));return original(id);};try{await Promise.all([App.selectAthlete('toolbar_athlete_a'),App.selectAthlete('toolbar_athlete_b')]);return{athlete:App.getLibrary().activeAthleteId,record:App.getState()?.recordId};}finally{repo.loadRecord=original;}});
   assert.deepEqual(data,{athlete:'toolbar_athlete_b',record:'toolbar_athlete_b_record_1'});assert.match(await page.locator('#reportAthleteSearch').inputValue(),/第二队/);assert.equal(await page.locator('#recordSelect').inputValue(),'toolbar_athlete_b_record_1');
  });
  await check("changing group while another athlete is loading cancels the stale out-of-group choice",async()=>{
   const data=await page.evaluate(async()=>{const repo=App.getRepository(),original=repo.loadRecord.bind(repo);repo.loadRecord=async id=>{if(id.includes('athlete_a'))await new Promise(resolve=>setTimeout(resolve,120));return original(id);};try{const pending=App.selectAthlete('toolbar_athlete_a');await new Promise(resolve=>setTimeout(resolve,20));document.querySelector('#reportGroupFilter').value='toolbar_team_b';await App.selectReportGroup();await pending;return{athlete:App.getLibrary().activeAthleteId,record:App.getState()?.recordId,group:document.querySelector('#reportGroupFilter').value};}finally{repo.loadRecord=original;}});
   assert.deepEqual(data,{athlete:'toolbar_athlete_b',record:'toolbar_athlete_b_record_1',group:'toolbar_team_b'});
  });
  assert.deepEqual(result.errors,[]);assert.equal(hash(file),result.sourceHash,'Built artifact changed during verification');result.pass=true;
 }catch(error){result.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(out,channel+'-results.json'),JSON.stringify(result,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
