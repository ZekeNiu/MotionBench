"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url"),{createHash}=require("node:crypto");
const {chromium}=require("./helpers/playwright.cjs"),ExcelJS=require("../vendor/exceljs.min.js");
const outputOption=process.argv.indexOf("--output-dir");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),channel=process.argv.includes("--edge")?"msedge":"chrome",out=outputOption>=0?path.resolve(process.argv[outputOption+1]):path.join(root,"output/playwright/v213-excel");fs.mkdirSync(out,{recursive:true});
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),channel,checks:[],errors:[],network:[],layouts:[],pass:false};
const {columns,directionId}=require("./helpers/excel-template.cjs");
async function workbook(bytes){const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);return book;}
async function bytes(book){return Buffer.from(await book.xlsx.writeBuffer());}
(async()=>{
 const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce",acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(15000);
 page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});page.on("dialog",d=>d.accept());
 const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS",name);};
 let people,blank,filled,targets;
 const upload=async(buffer)=>{if(!await page.locator("#excelModal").isVisible())await page.getByRole("button",{name:"导入 Excel 文件",exact:true}).click();await page.locator("#excelFile").setInputFiles({name:"测试录入.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer});await page.waitForFunction(()=>!RingsideExcelFlow.isBusy());};
 const getDownload=async()=>{const wait=page.waitForEvent("download");await page.getByRole("button",{name:"下载 Excel 模板",exact:true}).click();const download=await wait;const destination=path.join(out,channel+"-"+Date.now()+".xlsx");await download.saveAs(destination);return fs.readFileSync(destination);};
 const countRecords=()=>page.evaluate(()=>App.getLibrary().athletes.reduce((n,a)=>n+a.records.length,0));
 const openEdit=async()=>{if(await page.locator("#excelModal").isVisible())await page.evaluate(()=>App.close("excelModal"));await page.evaluate(async()=>{await App.showReport();await App.openEntry("cmj");});};
 const startEntry=async(ids,{tests=["cmj","iso"],directions=["iso_shoulder_externalRotation","iso_wrist_flexion"],date,mass}={})=>{
  if(await page.locator("#excelModal").isVisible())await page.evaluate(()=>App.close("excelModal"));
  await page.evaluate(async()=>{await App.showReport();await App.startDataEntry();});
  for(const id of ids)await page.locator(`[data-creation-athlete="${id}"]`).check();
  await page.locator("#creationNext").click();await page.locator("#creationTestStep").waitFor({state:"visible"});
  const selected=await page.locator('#creationProjects [data-picker-project]:checked').evaluateAll(choices=>choices.map(choice=>choice.dataset.pickerProject));
  for(const id of selected)await page.locator(`#creationProjects [data-picker-project="${id}"]`).uncheck();
  for(const id of tests)await page.locator(`#creationProjects [data-picker-project="${id}"]`).check();
  for(const id of tests.includes("iso")?directions:[])await page.locator(`#creationProjects [data-picker-iso="${id}"]`).check();
  if(date)await page.locator("#creationDate").fill(date);if(mass)await page.locator("#creationMass").fill(mass);
  await page.locator("#creationSubmit").click();await page.waitForFunction(()=>App.getUIState().mode==="entry");
 };
 try{
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>App.ready);
  people=await page.evaluate(async()=>{await App.importPayload(RingsideModel.libraryDefaults(),"replace-library");for(let i=0;i<2;i++){const r=RingsideModel.sampleRecord();r.recordId=crypto.randomUUID();r.athleteId=crypto.randomUUID();r.athlete.name="Excel同名运动员";r.athlete.sport=i?"田径":"篮球";r.demo=false;await App.importPayload(RingsideModel.recordEnvelope(r));}return App.getLibrary().athletes.map(a=>a.id);});
  assert.equal(people.length,2);const baseline=await countRecords();
  await check("batch templates select existing duplicate-name athletes without creating blank records",async()=>{
   await startEntry(people);
   blank=await getDownload();assert.equal(await countRecords(),baseline);
   const book=await workbook(blank),sheet=book.worksheets.find(ws=>ws.name.includes("等长"));assert.equal(sheet.rowCount-1,12);assert.deepEqual([...new Set(Array.from({length:sheet.rowCount-1},(_,i)=>directionId(sheet,i+2)))].sort(),["iso_shoulder_externalRotation","iso_wrist_flexion"].sort());
   const parsed=await page.evaluate(async values=>RingsideExcel.readTemplate(new Uint8Array(values)),[...blank]);assert.deepEqual(parsed.errors,[]);targets=parsed.targets;assert.deepEqual(targets.map(t=>t.athleteId).sort(),people.sort());
  });
  const book=await workbook(blank);
  const cmj=book.worksheets.find(ws=>/CMJ/.test(ws.name)&&!ws.name.includes("补充")),cc=columns(cmj);for(let row=2;row<=cmj.rowCount;row++){cmj.getCell(row,cc.height).value=30+(row-2)*2;cmj.getCell(row,cc.notes).value="Excel实际上传试次";}
  const iso=book.worksheets.find(ws=>ws.name.includes("等长")),ic=columns(iso);for(let row=2;row<=iso.rowCount;row++){iso.getCell(row,ic.left).value=row===2?0:100+row;iso.getCell(row,ic.right).value=120+row;}
  filled=await bytes(book);
  await check("formula errors identify cells and leave the full library unchanged",async()=>{const invalid=await workbook(filled),sheet=invalid.getWorksheet(cmj.name);sheet.getCell(2,cc.height).value={formula:"30+1",result:31};await upload(await bytes(invalid));assert.match(await page.locator("#excelContent").innerText(),/不接受公式/);assert.equal(await page.locator("#excelConfirm").isDisabled(),true);assert.equal(await countRecords(),baseline);});
  await check("validated two-athlete import saves one record per athlete atomically",async()=>{await upload(filled);assert.equal(await page.locator("#excelConfirm").isDisabled(),false);await page.locator("#excelConfirm").click();await page.getByText("导入完成：新建 2 条",{exact:false}).waitFor();assert.equal(await countRecords(),baseline+2);for(const target of targets){const stored=await page.evaluate(id=>App.getRepository().loadRecord(id),target.recordId);assert.equal(stored.data.cmj.length,3);assert.deepEqual(stored.isoDirectionIds,["iso_shoulder_externalRotation","iso_wrist_flexion"]);assert.equal(stored.data.iso.find(row=>row.id==="iso_shoulder_externalRotation").trials.length,3);}});
  await check("successful import survives refresh and the report uses the selected measurements",async()=>{await page.locator(`[data-excel-open-record="${targets[0].recordId}"]`).click();await page.waitForFunction(id=>App.getState()?.recordId===id,targets[0].recordId);assert.equal(await page.evaluate(()=>App.stats().isoAnalyses.length),2);await page.reload();await page.waitForFunction(()=>App.ready);assert.equal(await page.evaluate(()=>App.getState().recordId),targets[0].recordId);assert.equal(await countRecords(),baseline+2);});
  await check("reimporting the same workbook does not create duplicate records",async()=>{await startEntry(people);await upload(filled);await page.locator("#excelConfirm").click();await page.getByText("导入完成：新建 0 条",{exact:false}).waitFor();assert.equal(await countRecords(),baseline+2);assert.match(await page.locator("#excelContent").innerText(),/跳过 2 条/);await page.getByRole("button",{name:"完成",exact:true}).click();await page.evaluate(async target=>{await App.showReport();await App.showExcelRecord(target.athleteId,target.recordId);},targets[0]);});
  await check("supplemental templates retain populated projects by default and explicit replacement replaces the whole trial set",async()=>{
   await openEdit();const supplemental=await getDownload(),edit=await workbook(supplemental),sheet=edit.worksheets.find(ws=>/CMJ/.test(ws.name)&&!ws.name.includes("补充")),c=columns(sheet);sheet.getCell(2,c.height).value=47;
   const input=await bytes(edit);await upload(input);assert.equal(await page.locator('[data-excel-project="cmj"]').inputValue(),"keep");
   await page.locator('[data-excel-project="cmj"]').selectOption("replace");await page.locator("#excelConfirm").click();await page.locator("#excelModal").waitFor({state:"hidden"});assert.equal(await page.evaluate(()=>App.getState().data.cmj[0].height),47);assert.equal(await page.evaluate(()=>App.getState().data.cmj.length),3);
  });
  await check("failed persistence leaves all measurements unchanged and the preview can be retried",async()=>{
   await openEdit();const update=await workbook(await getDownload()),sheet=update.worksheets.find(ws=>/CMJ/.test(ws.name)&&!ws.name.includes("补充")),c=columns(sheet);sheet.getCell(2,c.height).value=48;await upload(await bytes(update));await page.locator('[data-excel-project="cmj"]').selectOption("replace");
   await page.evaluate(()=>{const repo=App.getRepository();window.__excelSave=repo.save.bind(repo);repo.save=()=>Promise.reject(Error("模拟保存失败"));});
   await page.locator("#excelConfirm").click();await page.locator("#excelError").waitFor({state:"visible"});assert.match(await page.locator("#excelError").innerText(),/模拟保存失败/);assert.equal(await page.evaluate(async()=>(await App.getRepository().loadRecord(App.getState().recordId)).data.cmj[0].height),47);
   await page.evaluate(()=>{App.getRepository().save=window.__excelSave;delete window.__excelSave;});await page.locator("#excelConfirm").click();await page.locator("#excelModal").waitFor({state:"hidden"});assert.equal(await page.evaluate(()=>App.getState().data.cmj[0].height),48);
  });
  await check("stale preview rejects a concurrent write without partial replacement",async()=>{
   await openEdit();const update=await workbook(await getDownload()),sheet=update.worksheets.find(ws=>/CMJ/.test(ws.name)&&!ws.name.includes("补充")),c=columns(sheet);sheet.getCell(2,c.height).value=52;await upload(await bytes(update));await page.locator('[data-excel-project="cmj"]').selectOption("replace");
   const id=await page.evaluate(async()=>{const r=await App.getRepository().loadRecord(App.getState().recordId);r.data.cmj[0].height=63;await App.getRepository().save(App.getLibrary(),[r]);return r.recordId;});
   await page.locator("#excelConfirm").click();await page.locator("#excelError").waitFor({state:"visible"});assert.match(await page.locator("#excelError").innerText(),/预览已过期/);assert.equal(await page.evaluate(async id=>(await App.getRepository().loadRecord(id)).data.cmj[0].height,id),63);await page.evaluate(()=>App.close("excelModal"));
  });
  await check("cancelled previews leave records unchanged and unknown athlete IDs are rejected",async()=>{
   await page.evaluate(async()=>{await App.loadDirectory();App.refreshWorkspace();});await startEntry(people);await upload(filled);await page.getByRole("button",{name:"取消",exact:true}).click();assert.equal(await countRecords(),baseline+2);
   const invalid=await workbook(filled),sheet=invalid.getWorksheet("本次测试"),c=columns(sheet);sheet.getCell(2,c.athleteId).value="unknown-athlete";await upload(await bytes(invalid));const confirm=page.locator("#excelConfirm");assert.ok(!await confirm.count()||await confirm.isDisabled());assert.match((await page.locator("#excelError").innerText())+(await page.locator("#excelContent").innerText()),/名单之外|编号|unknown-athlete/);assert.equal(await countRecords(),baseline+2);await page.evaluate(()=>App.close("excelModal"));
  });
  await check("batch setup and preview fit desktop and narrow screens",async()=>{
   await startEntry(people);await upload(filled);
   for(const width of [1440,1280,900,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,modalOverflow:document.querySelector('.excel-modal').scrollWidth>document.querySelector('.excel-modal').clientWidth+1}));result.layouts.push(geometry);assert.equal(geometry.overflow,false);assert.equal(geometry.modalOverflow,false);await page.screenshot({path:path.join(out,channel+"-preview-"+width+".png")});}
  });
  await page.evaluate(()=>App.close("excelModal"));await page.setViewportSize({width:1440,height:1000});
  let singleTarget;
  await check("single-athlete creation downloads without saving blanks and opens the imported record",async()=>{
   const before=await countRecords(),athletesBefore=await page.evaluate(()=>App.getLibrary().athletes.length);
   await startEntry([people[0]],{tests:["cmj"],date:"2026-10-09",mass:"74"});
   const downloaded=await getDownload();assert.equal(await countRecords(),before);assert.equal(await page.evaluate(()=>App.getLibrary().athletes.length),athletesBefore);
   const parsed=await page.evaluate(async values=>RingsideExcel.readTemplate(new Uint8Array(values)),[...downloaded]);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.targets.length,1);singleTarget=parsed.targets[0];assert.equal(singleTarget.athleteId,people[0]);
   const book=await workbook(downloaded),ws=book.worksheets.find(s=>/CMJ/.test(s.name)&&!s.name.includes("补充")),c=columns(ws);ws.getCell(2,c.height).value=38.25;
   await upload(await bytes(book));assert.equal(await page.locator(".excel-preview-record").count(),1);await page.locator("#excelConfirm").click();await page.locator("#excelModal").waitFor({state:"hidden"});
   await page.waitForFunction(id=>App.getState()?.recordId===id,singleTarget.recordId);assert.equal(await countRecords(),before+1);assert.equal(await page.evaluate(()=>App.getState().athleteId),people[0]);assert.equal(await page.evaluate(()=>App.getState().data.cmj[0].height),38.25);assert.equal(await page.evaluate(()=>App.getState().athlete.mass),74);assert.equal(await page.locator("#reportView").isVisible(),true);assert.equal(await page.locator("#creationView").isVisible(),false);
  });
  await check("standalone HTML export removes other athletes' pending Excel preview and controls",async()=>{
   await startEntry(people);await upload(filled);assert.equal(await page.locator(".excel-preview-record").count(),2);
   const expectedRecord=await page.evaluate(()=>App.getState().recordId),otherId=people.find(id=>id!==singleTarget.athleteId),snapshot=await page.evaluate(other=>{
    const html=App.exportHTMLString(),doc=new DOMParser().parseFromString(html,"text/html"),payload=JSON.parse(doc.querySelector("#embedded-data").textContent);
    return {html,containsOther:html.includes(other),cleared:Object.fromEntries(["excelContent","excelFooter","excelError","excelTitle"].map(id=>[id,doc.getElementById(id).innerHTML===""])),recordId:payload.record?.recordId||payload.recordId};
   },otherId);
   if(snapshot.containsOther){const offset=snapshot.html.indexOf(otherId);result.exportPrivacyFailure={otherId,context:snapshot.html.slice(Math.max(0,offset-300),offset+500),expectedRecord,singleTarget};}assert.equal(snapshot.containsOther,false);assert.ok(Object.values(snapshot.cleared).every(Boolean));assert.equal(snapshot.recordId,expectedRecord);assert.equal(await page.locator(".excel-preview-record").count(),2);
   const exported=path.join(out,channel+"-preview-export.html");fs.writeFileSync(exported,snapshot.html);result.exportPrivacy={containsOther:snapshot.containsOther,cleared:snapshot.cleared};
   const exportedContext=await browser.newContext({offline:true});try{const exportedPage=await exportedContext.newPage();exportedPage.on("pageerror",e=>result.errors.push(e.message));await exportedPage.goto(pathToFileURL(exported).href);await exportedPage.waitForFunction(()=>App.ready);assert.equal(await exportedPage.evaluate(()=>App.getLibrary().athletes.length),1);assert.equal(await exportedPage.evaluate(()=>App.getState().recordId),expectedRecord);assert.equal(await exportedPage.locator("#excelContent").innerText(),"");}finally{await exportedContext.close();}
   await page.evaluate(async target=>{App.close("excelModal");await App.showReport();await App.showExcelRecord(target.athleteId,target.recordId);},singleTarget);
  });
  const legacyContext=await browser.newContext({offline:true,acceptDownloads:true});
  try{
   const legacyPage=await legacyContext.newPage();legacyPage.setDefaultTimeout(15000);legacyPage.on("pageerror",e=>result.errors.push(e.message));legacyPage.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});await legacyPage.goto(pathToFileURL(file).href);await legacyPage.waitForFunction(()=>App.ready);
   await legacyPage.evaluate(async()=>{const M=RingsideModel;await App.importPayload(M.libraryDefaults(),"replace-library");const r=M.recordFromCatalog(M.normalizeCatalog(),{name:"旧版导出验收",sport:"拳击"},{iso:true},"2026-10-09");M.setIsoDirectionSelection(r,["iso_shoulder_externalRotation","iso_wrist_flexion"]);r.data.iso.find(row=>row.id==="iso_shoulder_externalRotation").left=100;r.data.iso.find(row=>row.id==="iso_shoulder_externalRotation").right=105;r.data.iso.find(row=>row.id==="iso_wrist_flexion").left=55;M.setIsoDirectionSelection(r,["iso_shoulder_externalRotation"]);await App.importPayload(M.recordEnvelope(r));});
   await check("legacy-compatible export includes only selected supported isometric directions",async()=>{
    const wait=legacyPage.waitForEvent("download");await legacyPage.evaluate(()=>App.downloadLegacyLibrary());const download=await wait,destination=path.join(out,channel+"-legacy-selected-directions.json");await download.saveAs(destination);const exported=JSON.parse(fs.readFileSync(destination,"utf8"));assert.equal(exported.athletes.length,1);const r=exported.athletes[0].records[0];assert.deepEqual(r.data.iso.map(row=>row.id),["iso_shoulder_externalRotation"]);assert.equal(r.isoDirectionIds,undefined);assert.equal(r.data.iso[0].left,100);assert.equal(r.data.iso[0].right,105);assert.equal(r.balancePairs.length,0);assert.equal(await legacyPage.evaluate(()=>App.getState().data.iso.some(row=>row.id==="iso_wrist_flexion"&&row.left===55)),true);
   });
   await check("legacy export explicitly blocks selected new body regions without changing measurements",async()=>{
    await legacyPage.evaluate(async()=>{const repo=App.getRepository(),r=await repo.loadRecord(App.getState().recordId);RingsideModel.setIsoDirectionSelection(r,["iso_shoulder_externalRotation","iso_wrist_flexion"]);await repo.save(App.getLibrary(),[r]);await App.loadDirectory();App.refreshWorkspace();});
    const downloaded=legacyPage.waitForEvent("download",{timeout:1200}).then(()=>true,()=>false);await legacyPage.evaluate(()=>App.downloadLegacyLibrary());await legacyPage.waitForFunction(()=>document.getElementById("toast").textContent.includes("旧版不支持的部位"));assert.equal(await downloaded,false);assert.match(await legacyPage.locator("#toast").innerText(),/完整备份/);assert.equal(await legacyPage.evaluate(()=>App.getState().data.iso.find(row=>row.id==="iso_wrist_flexion").left),55);assert.equal(await legacyPage.evaluate(()=>App.getState().isoDirectionIds.includes("iso_wrist_flexion")),true);
   });
  }finally{await legacyContext.close();}
  await check("shared DSI settings are retained by default and can be adopted without replacing identical CMJ trials",async()=>{
   const original=await page.evaluate(()=>JSON.parse(JSON.stringify(App.getState().dsi)));
   await openEdit();const update=await workbook(await getDownload()),cmj=update.worksheets.find(ws=>/CMJ/.test(ws.name)&&!ws.name.includes("补充")),c=columns(cmj);cmj.getCell(2,c.height).value=42;
   const conditions=update.getWorksheet("测试条件"),keys=columns(conditions),changes={"dsi.source":"其他全身等长测试","dsi.force":2100,"dsi.protocol":"交付验收等长协议"};
   for(let row=2;row<=conditions.rowCount;row++){const key=conditions.getCell(row,keys.fieldId).value;if(Object.hasOwn(changes,key))conditions.getCell(row,keys.value).value=changes[key];}
   const input=await bytes(update);await upload(input);assert.equal(await page.locator("[data-excel-settings]").inputValue(),"keep");await page.locator('[data-excel-project="cmj"]').selectOption("replace");await page.locator("#excelConfirm").click();await page.locator("#excelModal").waitFor({state:"hidden"});assert.equal(await page.evaluate(()=>App.getState().data.cmj[0].height),42);assert.deepEqual(await page.evaluate(()=>App.getState().dsi),original);
   await openEdit();await upload(input);assert.equal(await page.locator('[data-excel-project="cmj"]').count(),0);assert.match(await page.locator("#excelContent").innerText(),/数据相同，无需更新/);
   const settings=page.locator("[data-excel-settings]");await settings.locator("xpath=ancestor::details").locator("summary").click();await settings.selectOption("replace");
   await page.setViewportSize({width:390,height:1000});await settings.scrollIntoViewIfNeeded();const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,modalOverflow:document.querySelector('.excel-modal').scrollWidth>document.querySelector('.excel-modal').clientWidth+1}));assert.equal(geometry.overflow,false);assert.equal(geometry.modalOverflow,false);result.dsiSettingsLayout=geometry;await page.screenshot({path:path.join(out,channel+"-dsi-settings-390.png"),fullPage:true});
   await page.locator("#excelConfirm").click();await page.locator("#excelModal").waitFor({state:"hidden"});const applied=await page.evaluate(()=>({dsi:App.getState().dsi,height:App.getState().data.cmj[0].height}));assert.equal(applied.height,42);assert.equal(applied.dsi.source,"manual");assert.equal(applied.dsi.force,2100);assert.equal(applied.dsi.protocol,"交付验收等长协议");
  });
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
 }catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;await page.screenshot({path:path.join(out,channel+"-failure.png"),fullPage:true}).catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,channel+"-results.json"),JSON.stringify(result,null,2));await browser.close();}
})();
