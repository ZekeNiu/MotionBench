"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),{createFixture}=require("./helpers/longitudinal-fixture.cjs");
const root=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome",out=path.resolve(root,process.argv.find(arg=>arg.startsWith('--artifact-dir='))?.slice(15)||path.join("output/comparison-polish",channel));
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main(){
 fs.mkdirSync(out,{recursive:true});
 if(fs.existsSync(path.join(out,'results.json')))fs.copyFileSync(path.join(out,'results.json'),path.join(out,'results-before-'+Date.now()+'.json'));
 const result={synthetic:true,channel,sourceHash:hash(path.join(root,"MotionBench.html")),runnerSha256:hash(__filename),checks:[],errors:[],pass:false},browser=await chromium.launch({channel,headless:true});
 const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS "+name);};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:"zh-CN"});page.on("pageerror",error=>result.errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root,"MotionBench.html")).href);await page.waitForFunction(()=>App.ready);
  await page.addScriptTag({content:"window.makeFollowupFixture="+createFixture.toString()});
  await page.addStyleTag({content:'body>:not(#followupFixture):not(.ringside-pdf-stage):not(.html2canvas-container){display:none!important}#followupFixture{width:calc(100% - 40px);max-width:1160px;margin:20px auto}'});
  await page.evaluate(()=>{
   const input=makeFollowupFixture(window,4),ids=['iso_shoulder_externalRotation','iso_hip_abduction','iso_knee_extension','iso_ankle_dorsiflexion'];
   input.records.forEach((record,i)=>{
    Object.keys(record.enabled).forEach(id=>record.enabled[id]=['fms','iso','cmj'].includes(id));record.isoDirectionIds=ids.slice();
    record.data.fms[0].score=[1,2,3,2][i];record.data.fms[0].pain=false;
    record.data.fms[3].left=[3,3,2,1][i];record.data.fms[3].right=3;record.data.fms[3].pain=false;
    record.data.cmj[0].notes='保留原始试次备注';
   });
   input.profile.standards.find(rule=>rule.metricId==='cmj_height').enabled=false;
   window.followupInput=input;window.followupBefore=JSON.stringify(input);window.followupModel=RingsideLongitudinal.build(input.records,input);
   const host=document.createElement('main');host.id='followupFixture';host.dataset.longitudinal='true';document.body.append(host);
   const view=RingsideLongitudinalView.render(followupModel);host.innerHTML='<div class="micro-cards">'+view.summary+'</div>'+view.details;RingsideLongitudinalView.layout(host);
  });
  await check('unset evaluation pills disappear without hiding actual results or notes',async()=>{
   const info=await page.locator('#followupFixture [data-metric-id="cmj_height"]').evaluate(row=>({text:row.textContent,pills:row.querySelectorAll('.longitudinal-assessment').length,values:[...row.querySelectorAll('td[data-record-id] strong')].map(n=>n.textContent)}));
   assert.equal(info.pills,0);assert.equal(info.values.length,4);assert.doesNotMatch(info.text,/未设置评价|未启用评价标准/);assert.match(info.text,/保留原始试次备注/);
  });
  await check('summary counts use the same red and green as personal report classes',async()=>{
   result.summary=await page.locator('#followupFixture [data-change-direction]').evaluateAll(nodes=>nodes.map(n=>({direction:n.dataset.changeDirection,color:getComputedStyle(n.querySelector('.micro-value')).color,text:n.textContent})));
   assert.equal(result.summary.find(n=>n.direction==='improved').color,'rgb(24, 116, 89)');assert.equal(result.summary.find(n=>n.direction==='declined').color,'rgb(178, 63, 61)');
  });
  await check('FMS shared trend preserves all dates fixed ordinal scale and both segment colors',async()=>{
   const chart=page.locator('#followupFixture [data-metric-id="fms:0"] .result-trend');result.fms=await chart.evaluate(n=>({points:n.querySelectorAll('[data-trend-point]').length,scale:n.querySelector('svg').dataset.scoreScale,strokes:[...n.querySelectorAll('[data-trend-segment]')].map(p=>p.getAttribute('stroke')),width:n.getBoundingClientRect().width}));
   assert.equal(result.fms.points,4);assert.equal(result.fms.scale,'0-3');assert.deepEqual(result.fms.strokes,['#187459','#187459','#b23f3d']);assert.ok(result.fms.width>=120);
  });
  await check('joint balance explains every missing selected counterpart without inventing ratios',async()=>{
   const section=page.locator('#followupFixture [data-iso-section="balance"]');const text=await section.textContent();assert.match(text,/关节平衡/);assert.match(text,/未选入配对方向/);for(const name of['内旋','内收','屈曲','跖屈'])assert.ok(text.includes(name));assert.equal(await section.locator('table').count(),0);for(const period of await page.evaluate(()=>followupModel.periods.map(p=>p.date)))assert.ok(text.includes(period));
  });
  await page.locator('#followupFixture .micro-cards').screenshot({path:path.join(out,'summary-desktop.png')});await page.locator('#followupFixture #detail-fms').screenshot({path:path.join(out,'fms-desktop.png')});await page.locator('#followupFixture [data-iso-section="balance"]').screenshot({path:path.join(out,'balance-unavailable.png')});
  await check('complete selected pairs retain the original personal-report ratios',async()=>{
   const info=await page.evaluate(()=>{
    const input=JSON.parse(JSON.stringify(followupInput));input.records.forEach(r=>{r.isoDirectionIds.push('iso_shoulder_internalRotation');Object.assign(r.data.iso.find(q=>q.id==='iso_shoulder_internalRotation'),{left:200,right:200});Object.assign(r.data.iso.find(q=>q.id==='iso_shoulder_externalRotation'),{left:100,right:150});});
    const before=JSON.stringify(input),model=RingsideLongitudinal.build(input.records,input),section=document.createElement('div');section.innerHTML=RingsideLongitudinalView.render(model).details;
    return{unchanged:JSON.stringify(input)===before,text:section.querySelector('[data-iso-section="balance"]').textContent,ratios:model.projects.find(p=>p.id==='iso').metrics.filter(r=>r.section==='balance').map(r=>({values:r.cells.map(c=>c?.value),expected:model.periods.map(p=>p.stats.balanceResults.find(b=>b.id===r.pairId)?.results.find(c=>c.side===r.cells.find(Boolean).context.side)?.value)}))};
   });assert.equal(info.unchanged,true);assert.ok(info.ratios.length>=2);assert.match(info.text,/0.5/);assert.match(info.text,/0.75/);assert.doesNotMatch(info.text,/未设置评价|未启用评价标准/);for(const row of info.ratios)assert.deepEqual(row.values,row.expected);
  });
  await check('narrow screens retain readable mini charts inside horizontally scrollable result tables',async()=>{
   await page.setViewportSize({width:390,height:900});await page.evaluate(()=>RingsideLongitudinalView.layout(document.getElementById('followupFixture')));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
   result.mobileFMS=await page.locator('#followupFixture [data-metric-id="fms:0"] .result-trend').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,cellWidth:n.closest('td').getBoundingClientRect().width,tableWidth:n.closest('table').getBoundingClientRect().width,columns:[...n.closest('table').querySelectorAll('th')].map(th=>th.getBoundingClientRect().width)})));assert.ok(result.mobileFMS.every(n=>n.width>=60),JSON.stringify(result.mobileFMS));
  });
  await page.locator('#followupFixture #detail-fms').screenshot({path:path.join(out,'fms-mobile.png')});await page.setViewportSize({width:1440,height:1000});
  if(!process.argv.includes('--skip-pdf'))await check('actual exported PDF preserves mini charts colors unset evaluation absence and joint-balance explanations',async()=>{
   const data=await page.evaluate(async()=>{
    const source=document.createElement('section');source.dataset.longitudinal='true';
    source.append(...['.micro-cards','#detail-fms','#detail-iso','#detail-jumps'].map(selector=>document.querySelector('#followupFixture '+selector).cloneNode(true)));document.body.append(source);
    const before=source.outerHTML,renderer=html2canvas,capture=[],style=[...document.querySelectorAll('style')].find(s=>s.textContent.startsWith('body>:not(#followupFixture)')),css=style.textContent;style.textContent=css.replace(/^body>[^}]+}/,'');
    window.html2canvas=async(node,options)=>{const box=node.getBoundingClientRect();capture.push({text:node.textContent,height:box.height,rows:[...node.querySelectorAll('.longitudinal-results tr,.longitudinal-balance-unavailable p')].map(n=>{const r=n.getBoundingClientRect();return{top:r.top-box.top,bottom:r.bottom-box.top};}),mini:[...node.querySelectorAll('.result-trend')].map(n=>{const img=n.querySelector('img'),box=n.getBoundingClientRect();return{image:!!img,source:img?.src,width:box.width,height:box.height,color:getComputedStyle(n).color,changes:JSON.parse(n.dataset.resultTrend).points.map(p=>p.change?.improvement)};})});return renderer(node,options);};
    try{const snapshot={...followupModel.periods.at(-1).record,longitudinal:true,longitudinalDateRange:followupModel.periods[0].date+' — '+followupModel.periods.at(-1).date},blob=await RingsidePDF.build(snapshot,source),bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return{pdf:btoa(binary),capture,diagnostics:RingsidePDF.lastDiagnostics,unchanged:source.outerHTML===before};}finally{window.html2canvas=renderer;style.textContent=css;source.remove();}
   });assert.equal(data.unchanged,true);assert.equal(data.diagnostics.status,'complete');for(const p of data.capture)assert.ok(p.rows.every(r=>r.top>=0&&r.bottom<=p.height));const mini=data.capture.flatMap(p=>p.mini);assert.ok(mini.length>=7);assert.ok(mini.every(n=>n.image&&n.width>=60&&n.height>20));assert.ok(mini.some(n=>n.changes.includes('improved')));assert.ok(mini.some(n=>n.changes.includes('declined')));const text=data.capture.map(p=>p.text).join('');assert.match(text,/未选入配对方向/);assert.doesNotMatch(text,/未设置评价|未启用评价标准/);
   fs.writeFileSync(path.join(out,'comparison-followup.pdf'),Buffer.from(data.pdf,'base64'));result.pdfDiagnostics=data.diagnostics;result.pdfCapture=data.capture.map(p=>({...p,mini:p.mini.map(({source,...n})=>n)}));
  });
  await check('report display and PDF leave all source records schemes selections and narratives unchanged',async()=>assert.equal(await page.evaluate(()=>JSON.stringify(followupInput)===followupBefore),true));
  assert.deepEqual(result.errors,[]);assert.equal(hash(path.join(root,'MotionBench.html')),result.sourceHash);assert.equal(hash(__filename),result.runnerSha256);result.pass=true;
 }catch(error){result.errors.push(error.stack||String(error));throw error;}finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));await browser.close();}
 console.log(`${result.checks.length} comparison follow-up checks passed (${channel})`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
