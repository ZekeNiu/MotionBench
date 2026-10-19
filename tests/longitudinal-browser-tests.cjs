"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium,_electron}=require('./helpers/playwright.cjs'),{createFixture}=require('./helpers/longitudinal-fixture.cjs');
const root=path.resolve(__dirname,'..'),native=process.argv.includes('--desktop'),pdf=process.argv.includes('--pdf'),channel=native?'desktop':process.argv.includes('--edge')?'msedge':'chrome';
const out=path.resolve(root,process.argv.includes('--artifact-dir')?process.argv[process.argv.indexOf('--artifact-dir')+1]:`output/playwright/v224/longitudinal/${channel}`),source=path.join(root,'MotionBench.html');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const result={synthetic:true,channel,sourceHash:hash(source),runnerSha256:hash(__filename),fixtureSha256:hash(path.join(__dirname,'helpers/longitudinal-fixture.cjs')),checks:[],errors:[],artifacts:[],pass:false};
  let browser,context,electron,page,temporary,ids,baseline;
  const check=async(name,fn)=>{await fn();result.checks.push(name);console.log('PASS '+name);};
  const artifact=file=>result.artifacts.push({file:path.relative(root,file).replaceAll('\\','/'),sha256:hash(file)});
  const watch=p=>{p.setDefaultTimeout(25000);p.on('pageerror',e=>result.errors.push(e.message));p.on('dialog',d=>d.accept());};
  const wait=async()=>{await page.waitForFunction(()=>window.App?.ready);assert.equal(await page.evaluate(()=>App.ready),true);};
  const projection=()=>{const m=App.getLongitudinal();return {mode:m.mode,profile:m.profile,fingerprint:m.fingerprint,periods:m.periods.map(p=>({id:p.id,date:p.date})),projects:m.projects.map(p=>({id:p.id,metrics:p.metrics})),risk:m.risk,overview:m.overview,capability:m.capability.cards};};
  const startNative=async()=>{
    const executable=process.env.MOTIONBENCH_EXECUTABLE||require('electron'),env={...process.env,MOTIONBENCH_TEST_EXPORT_DIR:path.join(temporary,'downloads')};delete env.ELECTRON_RUN_AS_NODE;
    electron=await _electron.launch({executablePath:executable,args:[...(process.env.MOTIONBENCH_EXECUTABLE?[]:[root]),'--motionbench-test','--motionbench-data-dir='+temporary],cwd:root,env,timeout:60000});
    page=await electron.firstWindow();watch(page);await wait();await electron.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.setBackgroundThrottling(false);window.on("show",()=>window.hide());window.hide();});
    assert.equal(path.resolve(await electron.evaluate(({app})=>app.getPath('userData'))),path.resolve(temporary));
    result.identity=require('./helpers/desktop-artifact-identity.cjs').desktopArtifactIdentity(root,executable,__filename);
    result.versions=await page.evaluate(()=>({desktop:MotionBenchDesktop.version,web:MotionBenchDesktop.webVersion,build:RingsideBuild.version}));
    await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(320,320);w.setContentSize(1440,1000);globalThis.__longDownloads=[];w.webContents.session.on('will-download',(_e,item)=>item.once('done',(_e,state)=>__longDownloads.push({path:item.getSavePath(),name:item.getFilename(),state})));});
  };
  const closeNative=async()=>{if(!electron)return;assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);const closed=electron.waitForEvent('close',{timeout:60000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;electron=null;};
  const download=async kind=>{
    const file=path.join(out,'comparison.'+kind.toLowerCase());
    if(native){const index=await electron.evaluate(()=>__longDownloads.length);await page.evaluate(kind=>App['download'+kind](),kind);const end=Date.now()+900000;let item;while(Date.now()<end){item=await electron.evaluate((_e,{index,kind})=>__longDownloads.slice(index).find(d=>d.name.toLowerCase().endsWith('.'+kind.toLowerCase())),{index,kind});if(item)break;await page.waitForTimeout(100);}assert.ok(item,'native download finished');assert.equal(item.state,'completed');fs.copyFileSync(item.path,file);}
    else{const downloading=page.waitForEvent('download',{timeout:900000});downloading.catch(()=>{});await page.evaluate(kind=>App['download'+kind](),kind);if(kind==='PDF'){const status=await page.evaluate(()=>({toast:document.getElementById('toast').textContent,diagnostics:RingsidePDF.lastDiagnostics}));assert.equal(status.diagnostics?.status,'complete',JSON.stringify(status));}const d=await downloading;assert.equal(await d.failure(),null);await d.saveAs(file);}artifact(file);return file;
  };
  try{
    if(native){temporary=fs.mkdtempSync(path.join(os.tmpdir(),'motionbench-v224-synthetic-'));await startNative();}
    else{browser=await chromium.launch({channel});context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();watch(page);await page.goto(pathToFileURL(source).href);await wait();}
    await check('seed isolated three-period fixture',async()=>{
      ids=await page.evaluate(async factory=>{
        const f=(0,eval)('('+factory+')')(window,3),M=RingsideModel,lib=M.libraryDefaults();
        const G=RingsideGenericReport;
        for(const r of f.records)for(const kind of ['bar','target','trials','scatter','radar']){
          const id='long_'+kind,original=r.customTests.find(t=>t.id==='long_generic'),defs=r.definitions.filter(d=>d.testId==='long_generic');
          const map=Object.fromEntries(defs.map(d=>[d.id,id+'_'+d.id.slice(5)]));
          r.customTests.push({...structuredClone(original),id,name:'合成图型 · '+kind,primaryMetricId:map.long_time});r.enabled[id]=true;
          r.definitions.push(...defs.map(d=>({...structuredClone(d),id:map[d.id],testId:id,measurementScale:'ratio',...(kind==='radar'?{referenceEnabled:true,target:100,scoring:true}:{})})));
          r.data[id]=r.data.long_generic.map(row=>({...structuredClone(row),metrics:Object.fromEntries(Object.entries(row.metrics).map(([key,value])=>[map[key],value]))}));
          r.views.genericReports[id]=G.createView(r,id,kind==='scatter'?{kind,xMetricId:map.long_time,yMetricId:map.long_pct}:{kind,metricIds:kind==='radar'?Object.values(map):[map.long_time]});
        }
        f.profile=RingsideEvaluation.create(f.records.at(-1),'合成统一评价方案');
        const axes=['long_radar_time','long_radar_pct','long_radar_unknown'];
        f.profile.aggregations['ability:冲刺速度']={method:'mean',members:axes.map(id=>'metric:'+id),transforms:Object.fromEntries(axes.map(id=>['metric:'+id,{kind:'anchors',shape:'higher',points:[{value:0,score:0},{value:100,score:100}]}]))};
        f.catalog=M.mergeCatalog(null,f.records.at(-1));f.catalog.reportViews=structuredClone(f.records.at(-1).views.genericReports);
        lib.schema=3;lib.catalog=f.catalog;lib.evaluationProfiles=[RingsideEvaluation.serializeProfile(f.profile)];lib.defaultEvaluationProfileId=f.profile.id;
        f.records.forEach(r=>{r.evaluationProfileId=f.profile.id;r.narrative.html=M.textToHTML(r.narrative.text);});
        lib.athletes=[{id:f.athleteId,name:f.records[0].athlete.name,profile:M.profileFromRecord(f.records[0]),groupId:'',records:f.records,archived:false,deletedAt:null}];
        lib.activeAthleteId=f.athleteId;lib.activeRecordId=f.records[0].recordId;
        await App.importPayload(lib,'replace-library');await App.showReport(false);return f.records.map(r=>r.recordId);
      },createFixture.toString());
      baseline=await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids);
    });
    await check('existing picker checks add date series and preserve source records',async()=>{
      await page.locator('#recordChoiceLabel').click();
      await page.locator(`[data-record-choice="${ids[1]}"]`).check();
      await page.waitForFunction(()=>App.getLongitudinal()?.periods.length===2);
      await page.locator(`[data-record-choice="${ids[2]}"]`).check();
      await page.waitForFunction(()=>App.getLongitudinal()?.periods.length===3 && document.getElementById('reportView').dataset.longitudinal==='true' && document.getElementById('recordContext').textContent.includes('3 次'));
      await page.evaluate(()=>document.getElementById('recordChoiceMenu').open=false);
      assert.equal(await page.locator('#directionMetrics').isVisible(),false);
      assert.ok(await page.locator('#bodyChart svg').count());
      for(const id of ['long_generic','long_bar','long_target','long_trials','long_scatter','long_radar'])assert.ok(await page.locator(`#detail-${id} svg`).count(),'actual comparison chart '+id+' '+await page.locator(`#detail-${id}`).innerText());
      assert.equal(await page.evaluate(()=>App.getLongitudinal().mode),'mean');
      const row=await page.evaluate(()=>App.getLongitudinal().projects.flatMap(p=>p.metrics).find(r=>r.metricId==='cmj_height'||r.id==='cmj_height'||r.name.includes('反向跳')&&r.unit==='cm'));
      assert.ok(row,'CMJ comparison row');assert.deepEqual(row.cells.map(c=>c.value),[40,42,44]);assert.equal(row.changes.overall.delta,4);assert.equal(row.changes.overall.percent,10);assert.equal(row.changes.recent.delta,2);
      assert.deepEqual(await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids),baseline);
    });
    await check('representative selector changes comparison only',async()=>{
      await page.locator('#aggMode').selectOption('best');await page.waitForFunction(()=>App.getLongitudinal()?.mode==='best');
      assert.deepEqual(await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids),baseline);
      await page.locator('#aggMode').selectOption('mean');await page.waitForFunction(()=>App.getLongitudinal()?.mode==='mean');
    });
    await check('independent manual body persists and survives reload',async()=>{
      await page.evaluate(()=>App.openEntry('narrative'));await page.locator('#interpEditor').fill('纵向人工正文：三期跳跃成绩逐次增加，下一阶段按恢复情况安排训练。');await page.evaluate(()=>App.showReport(false));
      assert.match(await page.locator('#narrativeView').innerText(),/纵向人工正文/);await page.evaluate(()=>App.saveNow());
      await page.reload();await wait();assert.equal(await page.evaluate(()=>App.getLongitudinal()?.periods.length),3);assert.match(await page.locator('#narrativeView').innerText(),/纵向人工正文/);
      assert.deepEqual(await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids),baseline);
    });
    await check('complete JSON and editable HTML reproduce selection and body',async()=>{
      const expected=await page.evaluate(projection);
      const jsonFile=await download('JSON'),htmlFile=await download('HTML'),payload=JSON.parse(fs.readFileSync(jsonFile,'utf8'));
      assert.equal(payload.kind,'longitudinal-report');assert.equal(payload.selection.recordIds.length,3);assert.equal(payload.library.athletes.length,1);assert.equal(payload.library.athletes[0].records.length,3);
      if(native){browser=await chromium.launch({channel:'chrome'});context=await browser.newContext({viewport:{width:1440,height:1000}});}
      const extra=await context.newPage();watch(extra);await extra.goto(pathToFileURL(htmlFile).href);await extra.waitForFunction(()=>App?.ready);assert.equal(await extra.evaluate(()=>App.ready),true);
      assert.equal(await extra.evaluate(()=>App.getLongitudinal()?.periods.length),3);assert.match(await extra.locator('#narrativeView').innerText(),/纵向人工正文/);assert.deepEqual(await extra.evaluate(projection),expected);await extra.close();
      await page.evaluate(async payload=>{await App.importPayload(payload,'replace-library');await App.saveNow();},payload);assert.equal(await page.evaluate(()=>App.getLongitudinal()?.periods.length),3);
      assert.deepEqual(await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids),baseline);
      assert.deepEqual(await page.evaluate(projection),expected);
    });
    await check('invalid dated multi-selection rejected without changing current report',async()=>{
      const before=await page.evaluate(()=>App.getLongitudinal().fingerprint);
      const error=await page.evaluate(async()=>{try{await App.selectRecords(['missing-record','other-missing']);return '';}catch(e){return e.message;}});assert.ok(error);assert.equal(await page.evaluate(()=>App.getLongitudinal().fingerprint),before);
    });
    await check('comparison edit selects one record and returns to comparison',async()=>{
      await page.locator('#editButton').click();await page.locator(`[data-longitudinal-edit="${ids[0]}"]`).click();await page.waitForFunction(()=>App.getUIState().mode==='entry');
      assert.equal(await page.evaluate(()=>App.getState().recordId),ids[0]);await page.evaluate(()=>App.showReport(false));assert.equal(await page.evaluate(()=>App.getLongitudinal()?.periods.length),3);
    });
    await check('single selection restores original body chart, directions, and single narrative',async()=>{
      await page.evaluate(id=>App.selectRecords([id]),ids[0]);assert.equal(await page.evaluate(()=>App.getLongitudinal()),null);assert.equal(await page.locator('#directionMetrics').isVisible(),true);assert.match(await page.locator('#narrativeView').innerText(),/独立单期人工正文/);
      await page.evaluate(ids=>App.selectRecords(ids),ids);assert.match(await page.locator('#narrativeView').innerText(),/纵向人工正文/);
    });
    if(!native)await check('report AI icon opens editable owner-bound preview and applies independently',async()=>{
      await page.evaluate(()=>App.openSettings('ai'));await page.locator('#apiURL').fill('https://longitudinal-tests.invalid');await page.locator('#apiKey').fill('synthetic-test-key');await page.locator('#apiModel').fill('synthetic-model');
      let requestBody;await page.route('https://longitudinal-tests.invalid/**',async route=>{requestBody=route.request().postDataJSON();await route.fulfill({json:{choices:[{message:{content:'## 纵向表现\n\n三次跳跃测量逐步增加，结合当前训练安排，优先保持动作质量。\n\n- 周一安排分腿蹲3组6次，RPE 6，组间休息2分钟；连续两次动作稳定后再增加负荷。\n- 周四进行低量跳跃练习，观察次日恢复情况，四周后按相同流程复测。'}}]}});});
      await page.evaluate(()=>App.showReport(false));await page.locator('#reportAIButton').click();await page.locator('#previewModal.show').waitFor();assert.ok(requestBody.messages[0].content.includes('纵向比较'));assert.ok(requestBody.messages[1].content.includes(ids[0]));assert.ok(requestBody.messages[1].content.includes(ids[2]));
      assert.match(await page.evaluate(()=>App.getLongitudinalDocument().narrative.text),/纵向人工正文/);await page.locator('#aiPreview').fill('AI草稿经人工修改：保留三期实测变化与训练安排。');await page.locator('#applyDraftButton').click();await page.evaluate(()=>App.saveNow());
      const doc=await page.evaluate(()=>App.getLongitudinalDocument());assert.match(doc.narrative.text,/AI草稿经人工修改/);assert.match(doc.previousNarrative.text,/纵向人工正文/);assert.deepEqual(await page.evaluate(async ids=>Promise.all(ids.map(id=>App.getRepository().loadRecord(id))),ids),baseline);
    });
    await check('rendered report contains no invented inference or nonfinite values',async()=>{
      const text=await page.locator('#reportView').innerText();assert.ok(!/无法估计|无可比结果|NaN|Infinity|Cohen|MDC95/.test(text));
      const file=path.join(out,'report-desktop.png');await page.screenshot({path:file,fullPage:true});artifact(file);
      await page.evaluate(()=>window.scrollTo(0,0));const overview=path.join(out,'report-overview.png');await page.screenshot({path:overview});artifact(overview);
    });
    if(pdf)await check('actual comparison PDF retains all rows and charts',async()=>{
      await page.evaluate(()=>{window.__longPdfPages=[];window.__longCanvas=html2canvas;window.html2canvas=async(node,options)=>{__longPdfPages.push({directions:!!node.querySelector('#directionMetrics'),header:node.querySelector('.ringside-pdf-page-head')?.textContent||''});return __longCanvas(node,options);};});
      try{await download('PDF');}finally{await page.evaluate(()=>{window.html2canvas=__longCanvas;delete window.__longCanvas;});}
      const diagnostic=await page.evaluate(()=>RingsidePDF.lastDiagnostics);result.pdf=diagnostic;assert.equal(diagnostic.status,'complete');for(const key of ['missingRows','duplicateRows','changedRows','missingCharts','duplicateCharts'])assert.deepEqual(diagnostic[key],[]);
      result.pdfPages=await page.evaluate(()=>__longPdfPages);const dates=await page.evaluate(()=>[App.getLongitudinal().periods[0].date,App.getLongitudinal().periods.at(-1).date]);assert.equal(result.pdfPages.length,diagnostic.pageCount);assert.ok(result.pdfPages.every(p=>!p.directions&&dates.every(date=>p.header.includes(date))));
    });
    if(native)await check('packaged app save-close-reopen preserves comparison and body',async()=>{
      await closeNative();await startNative();assert.equal(await page.evaluate(()=>App.getLongitudinal()?.periods.length),3);assert.match(await page.locator('#narrativeView').innerText(),/纵向人工正文/);
    });
    assert.deepEqual(result.errors,[]);result.sourceUnchanged=result.sourceHash===hash(source);assert.ok(result.sourceUnchanged);
    if(native){result.finalIdentity=require('./helpers/desktop-artifact-identity.cjs').desktopArtifactIdentity(root,process.env.MOTIONBENCH_EXECUTABLE||require('electron'),__filename);assert.deepEqual(result.finalIdentity,result.identity);}
    result.pass=true;
  }catch(e){result.failure=e.stack;result.ui=await page?.evaluate(()=>({title:document.getElementById('reportTitle').textContent,mode:App.getUIState(),longitudinal:document.getElementById('reportView').dataset.longitudinal,hidden:document.getElementById('directionMetrics').hidden,display:getComputedStyle(document.getElementById('directionMetrics')).display,save:document.getElementById('saveStatus').textContent})).catch(()=>null);console.error(e.stack);console.error(result.ui);process.exitCode=1;}finally{result.sourceUnchanged=result.sourceHash===hash(source);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));await electron?.close().catch(()=>{});await browser?.close();}
}
main();
