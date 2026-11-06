"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {selectionUI}=require('./helpers/report-selection-ui.cjs');
const {chromium}=require('./helpers/playwright.cjs'),{createFixture}=require('./helpers/longitudinal-fixture.cjs');
const root=path.resolve(__dirname,'..'),channel=process.argv.includes('--edge')?'msedge':'chrome',pdf=process.argv.includes('--pdf');
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const out=path.resolve(arg('--artifact-dir',path.join(root,'output/release/2.29.0-local/acceptance/team-'+channel))),source=path.resolve(arg('--source',path.join(root,'MotionBench.html'))),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function main(){
 fs.mkdirSync(out,{recursive:true});const result={synthetic:true,channel,sourceHash:hash(source),runnerSha256:hash(__filename),fixtureSha256:hash(path.join(__dirname,"helpers/longitudinal-fixture.cjs")),selectionUiHelperSha256:hash(path.join(__dirname,"helpers/report-selection-ui.cjs")),checks:[],errors:[],pass:false};let browser,page,context,ids,baseline;
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log('PASS '+name);};
 const ready=async p=>{await p.waitForFunction(()=>window.App?.ready);assert.equal(await p.evaluate(()=>App.ready),true,await p.locator('#startupStatus').innerText());};
 const watch=p=>p.on('pageerror',e=>result.errors.push(e.stack||e.message));
 const download=async kind=>{const pending=page.waitForEvent('download',{timeout:300000});pending.catch(()=>{});await page.evaluate(kind=>App['download'+kind](),kind);if(kind==='PDF')assert.equal(await page.evaluate(()=>RingsidePDF.lastDiagnostics?.status),'complete',await page.locator('#toast').innerText());const d=await pending;assert.equal(await d.failure(),null);const f=path.join(out,'team-report.'+kind.toLowerCase());await d.saveAs(f);return f;};
 try{
  browser=await chromium.launch({channel});context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();watch(page);await page.goto(pathToFileURL(source).href);await ready(page);
  await check('create isolated team with complete records, missing member and tied names',async()=>{
   ids=await page.evaluate(async factory=>{
    const f=(0,eval)('('+factory+')')(window,2),M=RingsideModel,lib=M.libraryDefaults();lib.schema=3;lib.catalog=f.catalog;
    lib.groups=[{id:'team-fixture',name:'合成测试队'}];lib.evaluationProfiles=[RingsideEvaluation.serializeProfile(f.profile)];lib.defaultEvaluationProfileId=f.profile.id;
    lib.athletes=Array.from({length:4},(_,i)=>{const id='team-person-'+i,name=i===1?'团队长姓名运动员·姓名完整显示验收':i===2?'合成队员1':'合成队员'+(i+1);const records=i===3?[]:f.records.map((source,j)=>{const r=structuredClone(source);r.athleteId=id;r.recordId='team-record-'+i+'-'+j;r.athlete.name=name;r.athlete.date='2026-11-0'+(j+4);r.athlete.sex='男';r.evaluationProfileId=f.profile.id;for(const key of Object.keys(r.enabled))r.enabled[key]=['cmj','iso','fms'].includes(key);r.data.cmj.forEach(row=>row.height+=i*5);return r;});return {id,name,profile:records.length?M.profileFromRecord(records[0]):{...M.profileFromRecord(f.records[0]),name},groupId:'team-fixture',archived:false,deletedAt:null,records};});
    lib.activeAthleteId=lib.athletes[0].id;lib.activeRecordId=lib.athletes[0].records[0].recordId;await App.importPayload(lib,'replace-library');await App.showReport(false);return {people:lib.athletes.map(a=>a.id),records:lib.athletes.flatMap(a=>a.records.map(r=>r.recordId)),profileId:f.profile.id};
   },createFixture.toString());
   baseline=await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids.records);
  });
  await check('team setup selects entire team and one latest record per person',async()=>{
   await page.evaluate(()=>App.openReportSetup('team',{step:2}));const dialog=page.locator('#teamReportSelection');await dialog.locator('[data-team-field="groupId"]').selectOption('team-fixture');await page.locator('#reportWorkflowNext').click();
   await dialog.locator('[data-team-field="from"]').fill('2026-11-04');await dialog.locator('[data-team-field="from"]').press('Tab');await dialog.locator('[data-team-field="to"]').fill('2026-11-05');await dialog.locator('[data-team-field="to"]').press('Tab');
   assert.equal(await dialog.locator('[data-team-person]:checked').count(),4);assert.equal(await dialog.locator('[data-team-record]').count(),3);
   const selected=await dialog.locator('[data-team-record]').evaluateAll(nodes=>nodes.map(n=>n.value));assert.deepEqual(selected,['team-record-0-1','team-record-1-1','team-record-2-1']);
   await page.locator('#reportWorkflowNext').click();await page.locator('#reportWorkflowNext').click();await page.waitForFunction(()=>App.getTeam()?.participants.length===4);await page.waitForFunction(()=>App.getReportSetup()===null);
   assert.equal(await page.locator('#reportView').getAttribute('data-team'),'true');assert.equal(await page.locator('#directionMetrics').isVisible(),false);
   assert.equal(await page.locator('#bodyChart img').count(),0);assert.ok(await page.locator('[data-team-project]').count()>0);
   assert.deepEqual(await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids.records),baseline);
  });
  await check('four chart types keep complete metric table and missing team member',async()=>{
   const project=page.locator('[data-team-project="cmj"]');
   const projectId=await project.getAttribute('data-team-project');assert.ok(projectId);
   const initial=await project.locator('tbody').innerText();assert.match(initial,/合成队员4/);const columns=await project.locator('thead th').count();assert.ok(columns>3);
   for(const kind of ['dot','box','histogram','column']){await project.locator('[data-team-kind]').selectOption(kind);await page.waitForFunction(({id,kind})=>App.getTeamDocument().views.charts[id]?.kind===kind,{id:projectId,kind});assert.equal(await project.locator('tbody').innerText(),initial);assert.equal(await project.locator('thead th').count(),columns);}
   assert.equal(await page.evaluate(()=>App.saveNow()),true);
  });
  await check('narrative, view preferences and frozen results survive normal reload',async()=>{
   await page.evaluate(()=>App.openEntry('narrative'));await page.locator('#interpEditor').fill('团队报告人工解读：保留逐人成绩及筛查名单。');await page.evaluate(()=>App.showReport(false));assert.equal(await page.evaluate(()=>App.saveNow()),true);
   const before=await page.evaluate(()=>({id:App.getTeamDocument().id,basis:App.getTeamDocument().basis,views:App.getTeamDocument().views,narrative:App.getTeamDocument().narrative.text}));
   await page.reload();await ready(page);assert.equal(await page.evaluate(()=>App.getTeamDocument().id),before.id);assert.equal(await page.evaluate(()=>App.getTeamDocument().basis),before.basis);assert.equal(await page.evaluate(()=>App.getTeamDocument().narrative.text),before.narrative);assert.deepEqual(await page.evaluate(()=>App.getTeamDocument().views.charts),before.views.charts);
   assert.deepEqual(await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids.records),baseline);
  });
  await check('team JSON and editable HTML restore all participants and document identity',async()=>{
   const expected=await page.evaluate(()=>({id:App.getTeamDocument().id,basis:App.getTeamDocument().basis,people:App.getTeam().participants.length,narrative:App.getTeamDocument().narrative.text}));
   const json=await download('JSON'),html=await download('HTML'),payload=JSON.parse(fs.readFileSync(json,'utf8'));assert.equal(payload.kind,'team-report');assert.equal(payload.library.athletes.length,4);assert.equal(payload.library.athletes.flatMap(a=>a.records).length,3);
   const extra=await context.newPage();watch(extra);await extra.goto(pathToFileURL(html).href);await ready(extra);assert.deepEqual(await extra.evaluate(()=>({id:App.getTeamDocument().id,basis:App.getTeamDocument().basis,people:App.getTeam().participants.length,narrative:App.getTeamDocument().narrative.text})),expected);await extra.close();
   await page.evaluate(payload=>App.importPayload(payload),payload);assert.equal(await page.evaluate(()=>App.getTeamDocument().basis),expected.basis);assert.match(await page.locator('#narrativeView').innerText(),/团队报告人工解读/);
  });
  await check('team report is listed, can reopen, and switching to personal removes team styling',async()=>{
   const docId=await page.evaluate(()=>App.getTeamDocument().id),row=await page.evaluate(async id=>(await App.listSavedReports()).find(r=>r.id==='team:'+id),docId);assert.equal(row.kind,'team');
   await page.evaluate(()=>App.openReportSetup('personal',{step:2}));const u=selectionUI(page);await u.mode('single');await u.chooseAthlete('team-person-0');await u.chooseRecord('team-person-0','team-record-0-0');await u.apply();await page.waitForFunction(()=>!App.getTeam()&&App.getReportSetup()===null);assert.equal(await page.locator('#reportView').getAttribute('data-team'),null);
   assert.equal(await page.evaluate(id=>App.restoreSavedReport('team:'+id),docId),true);assert.equal(await page.locator('#reportView').getAttribute('data-team'),'true');
  });
  await check('desktop and narrow layouts preserve complete scrollable report without page overflow',async()=>{
   await page.screenshot({path:path.join(out,'team-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
   await page.waitForFunction(()=>getComputedStyle(document.getElementById('workspace')).marginLeft==='0px');
   const width=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(width.scroll<=width.client+1,JSON.stringify(width));await page.screenshot({path:path.join(out,'team-narrow.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  });
  await check('print projection preserves all rows, column groups and risk people',async()=>{
   const print=await page.evaluate(()=>{const node=document.querySelector('#reportView').cloneNode(true),model=App.getTeam();RingsideTeamView.preparePrint(node,model,App.getTeamDocument().views);return {rows:node.querySelectorAll('[data-team-row]').length,people:model.participants.length,projects:model.projects.length,controls:node.querySelectorAll('[data-team-kind]').length,text:node.textContent};});assert.ok(print.rows>=print.people*print.projects);assert.equal(print.controls,0);assert.match(print.text,/筛查名单/);assert.match(print.text,/合成队员4/);
  });
  if(pdf)await check('actual PDF export preserves team page identity and radar proportions',async()=>{
   await page.evaluate(()=>{const capture=window.html2canvas;window.teamPDFPages=[];window.html2canvas=async function(node,options){const img=node.querySelector('.body-art img'),box=img?.getBoundingClientRect();window.teamPDFPages.push({team:node.dataset.team,radar:img?{width:box.width,height:box.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight}:null,feet:[...node.querySelectorAll('.summary-grid .card-foot')].map(el=>getComputedStyle(el).display)});return capture(node,options);};});
   const file=await download('PDF');assert.ok(fs.statSync(file).size>10000);result.pdf=file;result.pdfSha256=hash(file);result.pdfDiagnostics=await page.evaluate(()=>RingsidePDF.lastDiagnostics);result.pdfPages=await page.evaluate(()=>window.teamPDFPages);
   assert.ok(result.pdfPages.length>0);assert.ok(result.pdfPages.some(p=>p.radar));for(const p of result.pdfPages){assert.equal(p.team,'true');assert.ok(p.feet.every(display=>display==='none'));if(p.radar){const r=p.radar;assert.ok(r.width>250);assert.ok(Math.abs(r.width/r.height-r.naturalWidth/r.naturalHeight)<.01,JSON.stringify(r));}}
  });
  assert.deepEqual(result.errors,[]);assert.equal(hash(source),result.sourceHash);assert.equal(hash(__filename),result.runnerSha256);assert.equal(hash(path.join(__dirname,"helpers/longitudinal-fixture.cjs")),result.fixtureSha256);assert.equal(hash(path.join(__dirname,"helpers/report-selection-ui.cjs")),result.selectionUiHelperSha256);result.sourceUnchanged=true;result.pass=true;
 }catch(e){result.error=e.stack||String(e);console.error(result.error);if(page){result.layoutDiagnostics=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].map(node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return {tag:node.tagName,id:node.id,class:typeof node.className==='string'?node.className:'svg',right:box.right,left:box.left,width:box.width,overflow:style.overflowX,position:style.position};}).filter(node=>node.width>0&&(node.right>document.documentElement.clientWidth+1||node.left< -1)).slice(0,70),feet:[...document.querySelectorAll('.summary-grid .card-foot')].map(node=>({html:node.outerHTML,display:getComputedStyle(node).display,matched:node.matches('[data-team="true"] .screen-layout+.card-foot,[data-team="true"] .performance-layout+.card-foot')}))})).catch(()=>null);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));await browser?.close();}
}
main();
