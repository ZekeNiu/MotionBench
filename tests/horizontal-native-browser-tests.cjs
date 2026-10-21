"use strict";
// Synthetic data and a fresh temporary desktop profile only. Never attach to a user window.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{execFileSync}=require("node:child_process");
const {chromium,_electron}=require("./helpers/playwright.cjs"),{desktopArtifactIdentity}=require("./helpers/desktop-artifact-identity.cjs");
const ROOT=path.resolve(__dirname,".."),SOURCE=path.join(ROOT,"MotionBench.html"),OUT=path.join(ROOT,"output/playwright/horizontal-2.25.0/desktop");
const TITLE="桌面横向原生验收报告";
const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex"),hashObject=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const projection=()=>{const m=App.getHorizontal(),d=App.getHorizontalDocument();return {basis:m.fingerprint,participants:m.participants.map(p=>[p.athleteId,p.recordId]),references:m.references.map(ref=>({id:ref.id,rows:ref.projects.flatMap(p=>p.metrics).map(row=>({id:row.id,cells:row.cells.map(cell=>cell?.value??null),benchmark:row.benchmark,differences:row.differences}))})),narrative:d.narrative,previousNarrative:d.previousNarrative||null};};
async function seed(){
  const M=RingsideModel,E=RingsideEvaluation,lib=M.libraryDefaults(),heights=[[80,40],[30,50],[20,60]];
  const people=heights.map((values,i)=>{const id="native-horizontal-person-"+i,name="桌面横向合成队员"+(i+1),records=values.map((value,j)=>{
    const r=M.sampleRecord();r.demo=false;r.sample=false;r.athleteId=id;r.recordId="native-horizontal-record-"+i+"-"+j;r.created="2026-01-01T00:00:00.000Z";
    Object.assign(r.athlete,{name,sex:"男",birthDate:"2000-01-01",date:"2026-0"+(j+1)+"-20",sport:"自定桌面专项"});r.mode="mean";
    for(const key of Object.keys(r.enabled))r.enabled[key]=key==="cmj";
    r.data.cmj=[-2,0,2].map((offset,k)=>({id:"cmj-"+i+"-"+j+"-"+k,height:value+offset,rsiModified:0.4+i*0.1,notes:k===0?"桌面原始试次 "+i+"-"+j:""}));
    M.applyAge(r);r.narrative={text:"单次原文 "+i+"-"+j,html:"<p>单次原文 "+i+"-"+j+"</p>",revision:1,origin:"manual",basis:M.fingerprint(r)};
    return r;
  });return{id,name,profile:{...M.profileFromRecord(records[1]),sportId:"native-sport",subdivisionId:"native-role"},groupId:"native-team",records,archived:i===2,deletedAt:null};});
  const profile=E.create(people[0].records[1],"桌面横向统一评价");for(const person of people)for(const r of person.records)r.evaluationProfileId=profile.id;
  lib.catalog=M.mergeCatalog(null,people[0].records[1]);lib.evaluationProfiles=[E.serializeProfile(profile)];lib.defaultEvaluationProfileId=profile.id;
  lib.classifications={version:1,sports:[{id:"native-sport",name:"自定桌面专项",subdivisionLabel:"主要小项"}],subdivisions:[{id:"native-role",sportId:"native-sport",name:"自定小项"}],ageBands:[{id:"native-age",name:"20–29 岁",min:20,max:29}]};
  lib.groups=[{id:"native-team",name:"桌面合成队伍"}];lib.athletes=people;lib.activeAthleteId=people[0].id;lib.activeRecordId=people[0].records[0].recordId;
  await App.importPayload(lib,"replace-library");await App.showReport(false);await App.saveNow();return{people:people.map(p=>p.id),records:people.map(p=>p.records.map(r=>r.recordId))};
}
async function main(){
  fs.mkdirSync(OUT,{recursive:true});const receipt=path.join(OUT,"results.json");if(fs.existsSync(receipt))fs.copyFileSync(receipt,path.join(OUT,"results-before-"+Date.now()+".json"));
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-horizontal-native-")),executable=process.env.MOTIONBENCH_EXECUTABLE||require("electron");
  const result={synthetic:true,channel:"desktop",desktop:true,packaged:!!process.env.MOTIONBENCH_EXECUTABLE,userData:temporary,sourceHash:hash(SOURCE),runnerSha256:hash(__filename),startedAt:new Date().toISOString(),checks:[],errors:[],artifacts:[],pass:false};
  const artifact=file=>result.artifacts.push({file:path.relative(ROOT,file).replaceAll("\\","/"),sha256:hash(file),bytes:fs.statSync(file).size});
  let electron,page,browser,ids,baseline,expected,jsonFile,htmlFile;const contexts=[];
  const watch=p=>{p.setDefaultTimeout(30000);p.on("pageerror",error=>result.errors.push(error.stack||error.message));p.on("dialog",dialog=>dialog.accept());};
  const ready=async p=>{await p.waitForFunction(()=>window.App?.ready,{},{timeout:60000});assert.equal(await p.evaluate(()=>App.ready),true);};
  const check=async(name,fn)=>{result.stage=name;console.log("START "+name);await fn();result.checks.push(name);console.log("PASS "+name);};
  const startNative=async()=>{
    const env={...process.env,MOTIONBENCH_TEST_EXPORT_DIR:path.join(temporary,"downloads")};delete env.ELECTRON_RUN_AS_NODE;
    electron=await _electron.launch({executablePath:executable,args:[...(process.env.MOTIONBENCH_EXECUTABLE?[]:[ROOT]),"--motionbench-test","--motionbench-data-dir="+temporary],cwd:ROOT,env,timeout:60000});
    page=await electron.firstWindow();watch(page);await ready(page);assert.equal(path.resolve(await electron.evaluate(({app})=>app.getPath("userData"))),path.resolve(temporary));
    await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(320,320);w.setContentSize(1440,1000);});
    // Observe the application's own native save handler. Playwright download
    // interception would bypass Electron's will-download destination contract.
    await electron.evaluate(({BrowserWindow})=>{globalThis.__horizontalNativeDownloads=[];BrowserWindow.getAllWindows()[0].webContents.session.on("will-download",(_event,item)=>item.once("done",(_done,state)=>globalThis.__horizontalNativeDownloads.push({state,path:item.getSavePath(),name:item.getFilename(),bytes:item.getReceivedBytes()})));});
    result.identity ||= desktopArtifactIdentity(ROOT,executable,__filename);assert.equal(result.identity.runtimeMatchesSourceHtml,true);
    if(result.packaged)assert.match(result.identity.archiveSha256,/^[a-f0-9]{64}$/,"packaged verification must identify an actual app.asar");
    result.versions=await page.evaluate(()=>({desktop:MotionBenchDesktop.version,web:MotionBenchDesktop.webVersion,build:RingsideBuild.version}));
    assert.equal(result.versions.web,result.versions.build);
  };
  const closeNative=async()=>{
    assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);
    const closed=electron.waitForEvent("close",{timeout:60000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;electron=null;
  };
  const records=async()=>page.evaluate(async ids=>Promise.all(ids.records.flat().map(id=>App.getRepository().loadRecord(id))),ids);
  const invariant=async()=>assert.deepEqual(await records(),baseline,"all six original records, raw trials, conditions and personal narratives remain exact");
  const download=async(kind,name="horizontal-desktop")=>{
    const before=await electron.evaluate(()=>globalThis.__horizontalNativeDownloads.length);await page.evaluate(kind=>App["download"+kind](),kind);
    if(kind==="PDF")assert.equal(await page.evaluate(()=>RingsidePDF.lastDiagnostics?.status),"complete",await page.locator("#toast").innerText());
    let item;const until=Date.now()+60000;
    while(Date.now()<until){item=(await electron.evaluate(()=>globalThis.__horizontalNativeDownloads)).slice(before).find(value=>value.name.toLowerCase().endsWith("."+kind.toLowerCase()));if(item)break;await page.waitForTimeout(100);}
    assert.ok(item,"native "+kind+" download completes");assert.equal(item.state,"completed");assert.ok(item.bytes>100);assert.equal(path.dirname(path.resolve(item.path)),path.join(temporary,"downloads"));assert.equal(fs.statSync(item.path).size,item.bytes);
    (result.nativeDownloads ||= []).push(item);const file=path.join(OUT,name+"."+kind.toLowerCase());fs.copyFileSync(item.path,file);artifact(file);return file;
  };
  const offline=async file=>{
    browser ||= await chromium.launch({channel:"chrome",headless:true});const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},locale:"zh-CN",timezoneId:"Asia/Shanghai"});contexts.push(context);
    const p=await context.newPage();watch(p);await p.goto(pathToFileURL(file).href);await ready(p);return p;
  };
  const assertExport=async p=>{
    assert.deepEqual(await p.evaluate(projection),expected);const people=await p.evaluate(()=>App.getLibrary().athletes.map(a=>({id:a.id,records:a.records.map(r=>r.recordId)})));
    assert.equal(people.length,2);assert.equal(people.flatMap(a=>a.records).length,2);assert.ok(!people.some(a=>a.id===ids.people[2]));
    assert.equal(await p.evaluate(()=>App.getHorizontal().references[0].projects.flatMap(p=>p.metrics).find(r=>r.metricId==="cmj_height").benchmark.n),3);
  };
  try{
    await check("isolated desktop launches and imports three synthetic athletes with six complete original records",async()=>{await startNative();ids=await page.evaluate(seed);baseline=await records();assert.equal(baseline.length,6);result.originalRecordsSha256=hashObject(baseline);});
    await check("desktop setup creates two direct participants and explicit latest versus period-record reference groups",async()=>{
      await page.locator("#horizontalButton").click();const box=page.locator("#horizontalDialog");await box.locator('[data-field="title"]').fill(TITLE);await box.locator('[data-field="mode"]').selectOption("mean");await box.locator("[data-add-person]").click();await box.locator("[data-person-athlete]").nth(1).selectOption(ids.people[1]);
      await box.locator('[data-field="window.kind"]').selectOption("all");await box.locator("[data-add-reference]").click();await box.locator('[data-reference-field="label"]').fill("桌面数据库男性 · 最近测试");
      await box.locator("[data-add-reference]").click();await box.locator('[data-reference-field="label"]').nth(1).fill("桌面数据库男性 · 阶段纪录");await box.locator('[data-reference-field="sampling"]').nth(1).selectOption("period-record");
      await box.locator('[type="submit"]').click();await page.waitForFunction(()=>App.getHorizontal()?.references.length===2&&!document.getElementById("horizontalDialog"));assert.equal(await page.locator("#reportView").getAttribute("data-horizontal"),"true");
    });
    await check("read-only comparison uses each athlete once with correct sample counts means best values and differences",async()=>{
      const data=await page.evaluate(()=>App.getHorizontal().references.map(ref=>{const row=ref.projects.flatMap(p=>p.metrics).find(r=>r.metricId==="cmj_height");return{benchmark:row.benchmark,cells:row.cells.map(c=>c?.value),differences:row.differences};}));
      assert.equal(data[0].benchmark.n,3);assert.equal(data[0].benchmark.mean,50);assert.equal(data[0].benchmark.best,60);
      assert.equal(data[1].benchmark.n,3);assert.ok(Math.abs(data[1].benchmark.mean-190/3)<1e-9);assert.equal(data[1].benchmark.best,80);
      for(const ref of data)for(let i=0;i<ref.cells.length;i++)assert.ok(Math.abs(ref.differences[i].delta-(ref.cells[i]-ref.benchmark.mean))<1e-9);
      assert.ok(await page.locator("#detailContent svg").count());assert.equal(await page.locator(".horizontal-results input,.horizontal-results [contenteditable=true]").count(),0);
      result.benchmarks=data;await invariant();const file=path.join(OUT,"desktop-report.png");await page.screenshot({path:file,fullPage:true});artifact(file);
    });
    await check("display choices preserve frozen samples and save independently from original records",async()=>{
      const before=await page.evaluate(projection);await page.locator(".horizontal-controls details summary").click();await page.locator("[data-horizontal-person]").nth(1).uncheck();
      await page.locator('[data-horizontal-view="activeReferenceId"]').selectOption(before.references[1].id);assert.equal(await page.evaluate(()=>App.saveNow()),true);
      assert.deepEqual(await page.evaluate(projection),before);assert.equal(await page.evaluate(()=>App.getHorizontalDocument().views.hiddenParticipantIds.length),1);
      if(!await page.locator("[data-horizontal-person]").nth(1).isVisible())await page.locator(".horizontal-controls details summary").click();
      await page.locator("[data-horizontal-person]").nth(1).check();await page.locator('[data-horizontal-view="pdfReferences"]').selectOption("all");assert.equal(await page.evaluate(()=>App.saveNow()),true);await invariant();
    });
    await check("independent horizontal narrative persists without replacing any personal narrative",async()=>{
      await page.evaluate(()=>App.openEntry("narrative"));await page.locator("#interpEditor").fill("桌面横向独立正文：最近测试与阶段个人纪录分别比较，三个合成人员各贡献一次。");
      await page.evaluate(()=>App.showReport(false));assert.equal(await page.evaluate(()=>App.saveNow()),true);assert.match(await page.locator("#narrativeView").innerText(),/桌面横向独立正文/);await invariant();expected=await page.evaluate(projection);
    });
    await check("normal desktop close and reopen restore frozen evidence narrative and selected reference",async()=>{
      const before=await page.evaluate(()=>App.getHorizontalDocument().views);await closeNative();await startNative();assert.deepEqual(await page.evaluate(projection),expected);
      const after=await page.evaluate(()=>App.getHorizontalDocument().views);assert.equal(after.activeReferenceId,before.activeReferenceId);assert.equal(after.pdfReferences,"all");await invariant();
    });
    await check("desktop JSON and editable HTML exports contain direct participants and frozen cohort facts only",async()=>{
      jsonFile=await download("JSON");htmlFile=await download("HTML");const payload=JSON.parse(fs.readFileSync(jsonFile,"utf8"));assert.equal(payload.kind,"horizontal-report");
      assert.equal(payload.library.athletes.length,2);assert.equal(payload.library.athletes.flatMap(a=>a.records).length,2);assert.ok(!payload.library.athletes.some(a=>a.id===ids.people[2]));
      assert.equal(payload.document.snapshot.references[0].projects.flatMap(p=>p.metrics).find(r=>r.metricId==="cmj_height").benchmark.n,3);await invariant();
    });
    await check("JSON opens offline with exact frozen comparison and does not create reference-only athlete records",async()=>{
      const p=await offline(SOURCE);try{await p.evaluate(payload=>App.importPayload(payload,"replace-library"),JSON.parse(fs.readFileSync(jsonFile,"utf8")));await assertExport(p);await p.reload();await ready(p);await assertExport(p);}finally{await p.close();}
    });
    await check("editable HTML opens offline with exact frozen comparison and independent narrative",async()=>{const p=await offline(htmlFile);try{await assertExport(p);await p.reload();await ready(p);await assertExport(p);}finally{await p.close();}});
    await check("real desktop PDF includes both saved references with complete rows charts and raw trial evidence",async()=>{
      await page.evaluate(()=>{
        const real=html2canvas;window.__horizontalNativePDFPages=[];window.__restoreHorizontalNativePDF=()=>{window.html2canvas=real;};
        window.html2canvas=async(node,options)=>{const body=node.querySelector(".ringside-pdf-content"),box=body.getBoundingClientRect();__horizontalNativePDFPages.push({text:body.textContent,rowIds:[...body.querySelectorAll("tr[data-metric-id]")].map(n=>n.dataset.metricId),charts:body.querySelectorAll("img[data-pdf-chart],svg").length,controls:body.querySelectorAll("button,input,select,textarea,.no-print").length,overflow:[...body.children].filter(n=>n.getBoundingClientRect().bottom>box.bottom+0.8).map(n=>n.className)});return real(node,options);};
      });
      let file;try{file=await download("PDF");result.pdf=await page.evaluate(()=>({diagnostics:RingsidePDF.lastDiagnostics,pages:__horizontalNativePDFPages}));}finally{await page.evaluate(()=>__restoreHorizontalNativePDF());}
      assert.equal(result.pdf.diagnostics.status,"complete");for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(result.pdf.diagnostics[key],[],key);
      assert.equal(result.pdf.pages.length,result.pdf.diagnostics.pageCount);assert.ok(result.pdf.pages.some(p=>p.charts>0));for(const p of result.pdf.pages){assert.equal(p.controls,0);assert.deepEqual(p.overflow,[]);}
      const text=result.pdf.pages.map(p=>p.text).join("\n");for(const expectedText of ["桌面数据库男性 · 最近测试","桌面数据库男性 · 阶段纪录","桌面横向独立正文","桌面原始试次","群体均值"])assert.ok(text.includes(expectedText),expectedText);
      const diagnosticFile=path.join(OUT,"pdf-diagnostics.json");fs.writeFileSync(diagnosticFile,JSON.stringify(result.pdf,null,2));artifact(diagnosticFile);
      const renderer="import sys,json;from pathlib import Path;import pymupdf; p=Path(sys.argv[1]);d=pymupdf.open(p);out=[]\nfor i,page in enumerate(d):\n f=p.parent/('horizontal-desktop-page-%02d.png'%(i+1));page.get_pixmap(matrix=pymupdf.Matrix(1.2,1.2),alpha=False).save(str(f));out.append(str(f))\nprint(json.dumps({'pages':out,'metadata':d.metadata}))";
      const rendered=JSON.parse(execFileSync("python",["-c",renderer,file],{cwd:ROOT,encoding:"utf8"})),images=rendered.pages;
      result.pdf.metadata=rendered.metadata;assert.equal(await page.evaluate(()=>App.getHorizontalDocument().configuration.title),TITLE);assert.equal(rendered.metadata.title,TITLE,"PDF metadata uses the horizontal report title");
      assert.equal(rendered.metadata.subject,"横向比较报告 · 2 名运动员","PDF subject preserves the participant count and every Unicode character");
      for(const png of images)artifact(png);result.pdfPageCount=images.length;assert.equal(images.length,result.pdf.diagnostics.pageCount);await invariant();
    });
    await check("final normal close preserves originals and binds receipt to the unchanged desktop artifact",async()=>{
      result.finalOriginalRecordsSha256=hashObject(await records());assert.equal(result.finalOriginalRecordsSha256,result.originalRecordsSha256);assert.deepEqual(await page.evaluate(projection),expected);
      await closeNative();result.finalIdentity=desktopArtifactIdentity(ROOT,executable,__filename);assert.deepEqual(result.finalIdentity,result.identity);assert.equal(hash(SOURCE),result.sourceHash);assert.equal(hash(__filename),result.runnerSha256);
    });
    assert.equal(result.checks.length,11);assert.deepEqual(result.errors,[]);result.pass=true;
  }catch(error){result.errors.push(error.stack||String(error));process.exitCode=1;console.error(error.stack||error);if(page&&!page.isClosed()){result.failureState=await page.evaluate(()=>({toast:document.querySelector("#toast")?.textContent,horizontal:!!App.getHorizontal(),active:App.getState()?.recordId})).catch(()=>null);const file=path.join(OUT,"failure.png");await page.screenshot({path:file,fullPage:true}).then(()=>artifact(file)).catch(()=>{});}}
  finally{if(electron)await closeNative().catch(async()=>{await electron?.close().catch(()=>{});});for(const context of contexts)await context.close();await browser?.close();result.finishedAt=new Date().toISOString();fs.writeFileSync(receipt,JSON.stringify(result,null,2));}
  console.log(result.checks.length+" horizontal desktop checks "+(result.pass?"passed":"completed before failure"));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
