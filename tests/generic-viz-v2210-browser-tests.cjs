"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{execFileSync}=require("node:child_process"),{pathToFileURL}=require("node:url");
const {chromium,_electron}=require("./helpers/playwright.cjs");
const {argument,ready,openExport,downloadFromReport}=require("./helpers/pdf-browser.cjs");
const {desktopArtifactIdentity}=require("./helpers/desktop-artifact-identity.cjs");
const root=path.resolve(__dirname,".."),source=path.resolve(root,argument("source")||"MotionBench.html"),exe=argument("exe");
const channel=exe?"native":process.argv.includes("--edge")?"msedge":"chrome",pdf=process.argv.includes("--pdf");
const out=path.resolve(root,argument("artifact-dir")||(exe?"output/tests/v2210-desktop/packaged-generic":"output/implementation-2.21.0/generic"));
const inside=path.relative(path.join(root,"output"),out);assert.ok(inside&&!inside.startsWith("..")&&!path.isAbsolute(inside),"Synthetic evidence must stay within this checkout output");
fs.mkdirSync(out,{recursive:true});const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result={schema:1,synthetic:true,sourceHash:hash(source),runnerSha256:hash(__filename),channel,packaged:!!exe,platform:process.platform,pass:false,checks:[],errors:[],network:[],artifacts:[],pdfs:[],isolation:{isolatedProfile:!exe,temporaryProfileRemoved:!exe},producers:{pdfHelperSha256:hash(path.join(__dirname,"helpers/pdf-browser.cjs"))}};
const artifact=(file,kind)=>{const item={path:path.relative(root,file).replaceAll("\\","/"),bytes:fs.statSync(file).size,sha256:hash(file),kind};result.artifacts.push(item);return item;};
async function check(name,action){await action();result.checks.push({name,pass:true});console.log("PASS "+name);}
let browser,context,electron,page,profile;
async function seed(mode="best"){
 return page.evaluate(async mode=>{
  const M=RingsideModel,E=RingsideEvaluation,r=M.defaults();r.demo=false;r.recordId="synthetic-generic-v2210-"+mode;r.athleteId="synthetic-generic-v2210-athlete";r.mode=mode;
  Object.assign(r.athlete,{name:"Synthetic generic report",date:"2026-10-13",age:25,sex:"男",mass:70});Object.keys(r.enabled).forEach(id=>r.enabled[id]=false);
  r.narrative.text="Synthetic manual narrative stays complete in generic chart export.";r.narrative.html="<p>"+r.narrative.text+"</p>";r.narrative.origin="人工";
  const definitions=[],tests=[];
  function project(id,name,fields,kind,rows,independent=false){
   const metrics=fields.map(field=>({testId:id,category:"performance",ability:"最大力量",entryScope:"attempt",referenceEnabled:false,target:null,ranges:[],direction:"higher",scoring:false,...field}));definitions.push(...metrics);
   const test={id,name,category:"performance",primaryAbility:"最大力量",primaryMetricId:metrics[0].id,selectionDirection:"higher",...(independent?{metricSelection:"independent"}:{}),...(kind?{visualization:{version:1,enabled:true,kind,metricIds:metrics.map(metric=>metric.id)}}:{})};tests.push(test);r.enabled[id]=true;
   r.data[id]=rows.map((values,index)=>({id:id+"-"+(index+1),metrics:values,notes:"Synthetic actual attempt "+(index+1)}));
  }
  project("g_pair","左右独立握力（合成）",[{id:"g_left",name:"左侧握力",unit:"N",side:"left"},{id:"g_right",name:"右侧握力",unit:"N",side:"right"}],"bars",[{g_left:20,g_right:50},{g_left:40,g_right:30},{g_left:30,g_right:40}],true);
  project("g_mixed","多单位和真实零值（合成）",[{id:"g_force",name:"较长指标名称用于窄屏换行与单位保持完整的测量结果",unit:"N"},{id:"g_zero",name:"实际零次结果",unit:"次"}],"bars",[{g_force:12,g_zero:0},{g_force:24,g_zero:0},{g_force:18,g_zero:0}]);
  project("g_trials","重复试次（合成）",[{id:"g_trial",name:"有效力量",unit:"N"}],"trials",[{g_trial:10},{g_trial:""},{g_trial:30},{g_trial:20}]);
  project("g_target","不同目标方向（合成）",[{id:"g_target_force",name:"力量",unit:"N"},{id:"g_target_time",name:"完成时间",unit:"s",direction:"lower"}],"target",[{g_target_force:30,g_target_time:7},{g_target_force:40,g_target_time:8},{g_target_force:20,g_target_time:6}]);
  project("g_missing","缺测与未设置目标（合成）",[{id:"g_missing_value",name:"未测力量",unit:"N"},{id:"g_no_target",name:"未设置目标的力量",unit:"N"}],"target",[{g_missing_value:20,g_no_target:10},{g_missing_value:30,g_no_target:15},{g_missing_value:25,g_no_target:12}]);
  project("g_empty","本次尚未测量（合成）",[{id:"g_empty_value",name:"尚未测量的力量",unit:"N"}],"bars",[]);
  project("g_legacy","原有通用表格（合成）",[{id:"g_legacy_value",name:"名称含左侧但没有侧别字段",unit:"cm"}],null,[{g_legacy_value:25}]);
  const many=Array.from({length:14},(_,index)=>({id:"g_many_"+index,name:"分张结果 "+(index+1),unit:"N"}));project("g_many","多指标分张（合成）",many,"bars",Array.from({length:3},(_,attempt)=>Object.fromEntries(many.map((metric,index)=>[metric.id,10+index+attempt]))));
  r.customTests.push(...tests);r.projectSnapshots=[...RingsideTests.snapshots(r),...tests.filter(test=>!RingsideTests.snapshots(r).some(snapshot=>snapshot.id===test.id))];r.definitions.push(...definitions);
  const p=E.create(r,"Synthetic generic evaluation");p.aggregations={};
  for(const[id,target]of[["g_target_force",50],["g_target_time",6]]){const rule=p.standards.find(rule=>rule.metricId===id);if(!rule)throw Error("Synthetic standard is missing");Object.assign(rule,{enabled:true,targetEnabled:true,target,rangesEnabled:false,ranges:[]});}
  await App.importPayload(M.recordEnvelope(r,p),"replace-library");await App.showReport(false);await App.getRepository().flush();
  return {recordId:App.getState().recordId,raw:JSON.stringify(App.getState().data),narrative:App.getState().narrative.text,mode,expectedChartKinds:["bars","target","trials"],renderedChartKinds:[...new Set([...document.querySelectorAll('[data-chart-kind="genericChart"]')].map(node=>JSON.parse(node.dataset.chartInput)[0].kind))].sort(),visualizations:App.getState().projectSnapshots.filter(test=>test.id.startsWith("g_")).map(test=>({id:test.id,visualization:test.visualization||null})),values:App.stats().values};
 },mode);
}
async function resize(width){
 if(electron){await electron.evaluate(({BrowserWindow},width)=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(320,320);window.setContentSize(width,1000);},width);await page.waitForFunction(width=>innerWidth===width,width);}
 else await page.setViewportSize({width,height:1000});
 await page.evaluate(()=>RingsideReport.layoutCharts(document.getElementById("reportView")));await page.waitForTimeout(100);
}
async function screenshotActual(file,clip){
 if(!electron)return page.screenshot({path:file,fullPage:true,scale:"css",...(clip?{clip}:{})});
 // Electron attaches to a real Windows display without a context deviceScaleFactor.
 // Explicit actual DPR scaling avoids Chromium repeating pixels after texture row 16384.
 const session=await electron.context().newCDPSession(page);
 try{
  const dpr=await page.evaluate(()=>devicePixelRatio),metrics=await session.send("Page.getLayoutMetrics"),body=metrics.cssContentSize;
  assert.ok(Number.isFinite(dpr)&&dpr>0&&body,"Actual CSS dimensions and device scale must be available");
  const region=clip?{x:clip.x,y:clip.y,width:Math.ceil(clip.width),height:Math.ceil(clip.height)}:{x:0,y:0,width:Math.ceil(body.width),height:Math.ceil(body.height)};
  assert.ok(region.width>0&&region.height>0&&region.height<=16384,"Synthetic full-page capture must fit the renderer texture at CSS scale");
  const capture=await session.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:true,clip:{...region,scale:1/dpr}}),buffer=Buffer.from(capture.data,"base64"),width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
  assert.ok(Math.abs(width-region.width)<=1&&Math.abs(height-region.height)<=1,"Actual PNG dimensions must match CSS capture dimensions");
  fs.writeFileSync(file,buffer);result.screenshotCaptures||=[];result.screenshotCaptures.push({path:path.relative(root,file).replaceAll("\\","/"),css:region,devicePixelRatio:dpr,scale:1/dpr,width,height,captureBeyondViewport:true});
 }finally{await session.detach();}
}
function measuredData(data){const snapshot=JSON.parse(JSON.stringify(data));for(const row of snapshot.iso||[])delete row.reference;return snapshot;}
async function downloadActual(action){
 if(!electron)return downloadFromReport(page,action);
 await electron.evaluate(({BrowserWindow})=>{globalThis.__genericNativeDownload=null;BrowserWindow.getAllWindows()[0].webContents.session.once("will-download",(_event,item)=>item.once("done",(_done,state)=>{globalThis.__genericNativeDownload={name:item.getFilename(),state,path:item.getSavePath(),bytes:item.getTotalBytes()};}));});
 await openExport(page);await page.locator(`#reportExportMenu button[onclick="App.${action}()"]`).click();
 const deadline=Date.now()+180000;let saved;
 while(Date.now()<deadline){saved=await electron.evaluate(()=>globalThis.__genericNativeDownload);if(saved)break;await page.waitForTimeout(150);}
 assert.ok(saved,"Actual native save must complete");assert.equal(saved.state,"completed");assert.ok(saved.bytes>0);assert.ok(path.resolve(saved.path).startsWith(path.join(out,"native-downloads")+path.sep));
 result.nativeDownloads ||= [];result.nativeDownloads.push({name:saved.name,state:saved.state,bytes:saved.bytes});
 return{saveAs:async destination=>{fs.copyFileSync(saved.path,destination);assert.equal(fs.statSync(destination).size,saved.bytes);}};
}
async function pdfCapture(fixture,label){
 await page.evaluate(()=>{window.__genericOriginalCanvas=window.html2canvas;window.__genericPages=[];window.html2canvas=async(node,options)=>{const body=node.querySelector(".ringside-pdf-content"),rect=body.getBoundingClientRect(),box=element=>{const r=element.getBoundingClientRect();return{width:r.width,height:r.height,bottom:r.bottom};};__genericPages.push({body:box(body),overflow:[...body.children].filter(child=>child.getBoundingClientRect().bottom>rect.bottom+1).map(child=>child.className),charts:[...body.querySelectorAll("img[data-pdf-chart]")].map(image=>({index:image.dataset.pdfChartIndex,rect:box(image),naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight})),rows:[...body.querySelectorAll("tbody>tr")].map(row=>[...row.cells].map(cell=>cell.textContent.trim())),text:body.textContent});return __genericOriginalCanvas(node,options);};});
 const download=await downloadActual("downloadPDF");const file=path.join(out,channel+"-"+label+".pdf");await download.saveAs(file);artifact(file,"generic-pdf");
 const evidence=await page.evaluate(()=>{window.html2canvas=window.__genericOriginalCanvas;return{diagnostics:RingsidePDF.lastDiagnostics,pages:window.__genericPages,after:{recordId:App.getState().recordId,raw:JSON.stringify(App.getState().data),narrative:App.getState().narrative.text},leakedStages:document.querySelectorAll(".ringside-pdf-stage").length};});
 assert.equal(evidence.diagnostics.status,"complete");assert.equal(evidence.leakedStages,0);for(const key of["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(evidence.diagnostics[key],[]);assert.ok(evidence.pages.every(page=>!page.overflow.length));assert.ok(evidence.pages.flatMap(page=>page.charts).every(chart=>chart.rect.width>0&&chart.rect.height>0));assert.ok(evidence.pages.map(page=>page.text).join("").includes(fixture.narrative));assert.deepEqual(evidence.after,{recordId:fixture.recordId,raw:fixture.raw,narrative:fixture.narrative});
 const actualPages=Number(execFileSync("python",["-c","import sys;from pypdf import PdfReader;print(len(PdfReader(sys.argv[1]).pages))",file],{encoding:"utf8",windowsHide:true}).trim());assert.equal(actualPages,evidence.pages.length);assert.equal(actualPages,evidence.diagnostics.pageCount);
 assert.deepEqual(fixture.renderedChartKinds,fixture.expectedChartKinds,"Each independently requested graph kind must be rendered");
 result.pdfs.push({path:path.relative(root,file).replaceAll("\\","/"),bytes:fs.statSync(file).size,sha256:hash(file),sourceHash:result.sourceHash,chartKind:"bars-trials-target",fixture:{...fixture,after:evidence.after},actualPages,pages:evidence.pages,diagnostics:evidence.diagnostics,after:evidence.after,pass:true});
}
(async()=>{
 try{
  if(exe){
   const executable=path.resolve(exe);assert.ok(fs.existsSync(executable));process.env.MOTIONBENCH_EXECUTABLE=executable;result.executableSha256=hash(executable);result.identity=desktopArtifactIdentity(root,executable,__filename);assert.equal(result.identity.runtimeMatchesSourceHtml,true);assert.equal(result.identity.runtimeHtmlSha256,result.sourceHash);
   profile=fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-generic-v2210-"));const env={...process.env,MOTIONBENCH_TEST_EXPORT_DIR:path.join(out,"native-downloads")};delete env.ELECTRON_RUN_AS_NODE;
   electron=await _electron.launch({executablePath:executable,args:["--motionbench-test","--motionbench-data-dir="+profile],cwd:root,env,timeout:45000});page=await electron.firstWindow();await electron.context().setOffline(true);
   const actual=await electron.evaluate(({app})=>({userData:app.getPath("userData"),sessionData:app.getPath("sessionData")}));assert.equal(path.resolve(actual.userData),path.resolve(profile));assert.equal(path.resolve(actual.sessionData),path.resolve(profile));Object.assign(result.isolation,{isolatedProfile:true,userDataArgument:true,temporaryProfileRemoved:false});
  }else{browser=await chromium.launch({channel,headless:true});context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:1000}});page=await context.newPage();await page.goto(pathToFileURL(source).href);}
  page.setDefaultTimeout(20000);page.on("pageerror",error=>result.errors.push(error.message));page.on("request",request=>{if(/^(https?|wss?):/i.test(request.url()))result.network.push(request.url());});page.on("dialog",dialog=>dialog.accept());await ready(page);
  await check("the exact runtime version loads with an independently isolated synthetic library",async()=>{result.versions=await page.evaluate(()=>({desktop:window.MotionBenchDesktop?.version||null,web:window.MotionBenchDesktop?.webVersion||RingsideBuild.version,build:RingsideBuild.version}));assert.equal(result.versions.web,"2.21.0");assert.equal(result.versions.build,"2.21.0");if(exe)assert.equal(result.versions.desktop,"2.21.0-desktop.1");});
  let fixture=await seed();result.fixture=fixture;
  await check("legacy generic projects retain their results table without invented charts",async()=>{const block=page.locator("#detail-g_legacy");assert.equal(await block.locator("table").count(),1);assert.equal(await block.locator("svg").count(),0);assert.match(await block.innerText(),/25.00/);});
  await check("measured values and real zero stay labelled and unlike units use separate scales",async()=>{const rows=await page.locator("#detail-g_mixed [data-chart-kind]").evaluateAll(nodes=>nodes.map(node=>JSON.parse(node.dataset.chartInput)[0]));assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.unit),["N","次"]);assert.equal(rows[0].rows[0].value,24);assert.equal(rows[1].rows[0].value,0);assert.match(await page.locator("#detail-g_mixed").innerText(),/0.00/);assert.equal(await page.locator("#detail-g_many [data-chart-kind]").count(),3);});
  await check("left and right graph values use explicit sides and each true model selection",async()=>{const rows=await page.locator("#detail-g_pair [data-chart-kind]").evaluate(node=>JSON.parse(node.dataset.chartInput)[0].rows);assert.deepEqual(rows.map(row=>[row.side,row.value]),[["left",40],["right",50]]);assert.equal(await page.locator("#detail-g_legacy [data-side]").count(),0);});
  await check("real trial positions and selected attempts remain distinct without a fabricated trend",async()=>{const graph=page.locator("#detail-g_trials [data-chart-kind]");const points=await graph.evaluate(node=>JSON.parse(node.dataset.chartInput)[0].points);assert.deepEqual(points.map(point=>[point.index,point.value,point.selected]),[[1,10,false],[2,null,false],[3,30,true],[4,20,false]]);assert.equal(await graph.locator("polyline,path").count(),0);assert.equal(await graph.locator("[data-generic-point]").count(),3);assert.match(await page.locator("#detail-g_trials").innerText(),/第 2 次/);});
  await check("applicable raw targets respect higher and lower directions while absent targets remain explanations",async()=>{assert.equal(await page.locator('#detail-g_target [data-target-direction="higher"]').count(),1);assert.equal(await page.locator('#detail-g_target [data-target-direction="lower"]').count(),1);assert.match(await page.locator("#detail-g_target").innerText(),/越小越好/);const targetRows=await page.locator("#detail-g_target [data-chart-kind]").evaluateAll(nodes=>nodes.flatMap(node=>JSON.parse(node.dataset.chartInput)[0].rows));assert.deepEqual(targetRows.map(row=>[row.metricId,row.value,row.target,row.unit,row.direction]),[["g_target_force",40,50,"N","higher"],["g_target_time",8,6,"s","lower"]]);assert.equal(await page.locator("#detail-g_missing svg").count(),0);assert.match(await page.locator("#detail-g_missing").innerText(),/参考目标/);assert.equal(await page.locator("#detail-g_missing > .table-wrap > table").count(),1);assert.equal(await page.locator("#detail-g_empty svg").count(),0);assert.equal(await page.locator("#detail-g_empty table").count(),1);assert.match(await page.locator("#detail-g_empty").innerText(),/不以零代替缺测/);});
  await check("charts and persistent tables remain readable at desktop tablet and phone widths",async()=>{result.responsive=[];for(const width of[1440,1024,390]){await resize(width);const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,charts:[...document.querySelectorAll('[data-chart-kind="genericChart"] svg')].map(svg=>{const bound=svg.getBoundingClientRect();return{width:bound.width,height:bound.height,clipped:[...svg.querySelectorAll("text")].filter(text=>{const r=text.getBoundingClientRect();return r.left<bound.left-1||r.right>bound.right+1||r.top<bound.top-1||r.bottom>bound.bottom+1;}).map(text=>text.textContent)};})}));assert.equal(geometry.overflow,false);assert.ok(geometry.charts.every(chart=>chart.width>0&&chart.height>0&&!chart.clipped.length),JSON.stringify(geometry.charts));result.responsive.push(geometry);const file=path.join(out,channel+"-"+width+".png");await screenshotActual(file);artifact(file,"generic-screenshot");await page.evaluate(()=>window.scrollTo(0,0));for(const id of["g_pair","g_mixed","g_trials","g_target"]){const box=await page.locator("#detail-"+id).boundingBox(),region=path.join(out,channel+"-"+width+"-"+id+".png");await screenshotActual(region,box);artifact(region,"generic-focused-screenshot");}}await resize(1440);});
  await check("actual JSON export and reload preserve raw data chart snapshots and manual text",async()=>{const download=await downloadActual("downloadJSON"),file=path.join(out,channel+"-record.json");await download.saveAs(file);artifact(file,"generic-record-json");const payload=JSON.parse(fs.readFileSync(file,"utf8")),record=payload.record||payload;assert.deepEqual(measuredData(record.data),measuredData(JSON.parse(fixture.raw)),"All measurements must stay exact; runtime iso reference decoration is not measurement data");assert.equal(record.narrative.text,fixture.narrative);assert.ok(record.projectSnapshots.some(test=>test.id==="g_pair"&&test.visualization.kind==="bars"));await page.reload();await ready(page);await page.evaluate(()=>App.showReport(false));assert.equal(await page.locator("#detail-g_pair [data-chart-kind]").count(),1);assert.equal(await page.evaluate(()=>JSON.stringify(App.getState().data)),fixture.raw);assert.equal(await page.evaluate(()=>App.getState().narrative.text),fixture.narrative);});
  if(pdf){await check("actual best-mode PDF preserves complete charts result rows original trials and manual narrative",async()=>{fixture=await seed("best");await pdfCapture(fixture,"best");});await check("actual mean-mode PDF preserves true averaged values and all trial selection markers",async()=>{fixture=await seed("mean");const values=await page.locator("#detail-g_pair [data-chart-kind]").evaluate(node=>JSON.parse(node.dataset.chartInput)[0].rows.map(row=>row.value));assert.deepEqual(values,[30,40]);const targets=await page.locator("#detail-g_target [data-chart-kind]").evaluateAll(nodes=>nodes.flatMap(node=>JSON.parse(node.dataset.chartInput)[0].rows).map(row=>[row.value,row.target]));assert.ok(Math.abs(targets[0][0]-30)<1e-9);assert.equal(targets[0][1],50);assert.deepEqual(targets[1],[7,6]);const trialPoints=await page.locator("#detail-g_trials [data-chart-kind]").evaluate(node=>JSON.parse(node.dataset.chartInput)[0].points);assert.deepEqual(trialPoints.map(point=>[point.value,point.selected]),[[10,true],[null,false],[30,true],[20,true]]);await pdfCapture(fixture,"mean");});}
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
 }catch(error){result.errors.push(error.stack||error.message);console.error(error.stack||error);process.exitCode=1;}
 finally{
  if(electron){try{await electron.close();}catch(error){result.errors.push("Native close: "+error.message);result.pass=false;process.exitCode=1;}}
  if(browser)await browser.close();
  if(profile){const safe=path.resolve(profile),prefix=path.resolve(os.tmpdir())+path.sep;assert.ok(safe.startsWith(prefix)&&path.basename(safe).startsWith("motionbench-generic-v2210-"));fs.rmSync(safe,{recursive:true,force:true});result.isolation.temporaryProfileRemoved=!fs.existsSync(safe);}
  result.sourceUnchanged=hash(source)===result.sourceHash;assert.equal(result.sourceUnchanged,true);result.checkCount=result.checks.length;
  if(exe){result.finalIdentity=desktopArtifactIdentity(root,path.resolve(exe),__filename);result.artifactUnchanged=JSON.stringify(result.identity)===JSON.stringify(result.finalIdentity)&&hash(path.resolve(exe))===result.executableSha256;if(!result.artifactUnchanged){result.pass=false;process.exitCode=1;}}
  fs.writeFileSync(path.join(out,channel+".json"),JSON.stringify(result,null,2)+"\n");
 }
})();
