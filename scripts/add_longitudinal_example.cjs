"use strict";
// One-off normal-entry automation. This is not a product feature or data importer.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium,_electron}=require("../tests/helpers/playwright.cjs");
const ROOT=path.resolve(__dirname,".."),NAME="示例运动员｜纵向比较（合成）",PROFILE="evaluation_95e48616-ad55-4aca-9b42-378858e96732";
const PROJECTS=["cmj","sj","dj","imtp","mss","mas","iso","fms","pushup","mb"];
const ISO=["iso_shoulder_externalRotation","iso_hip_abduction","iso_knee_extension","iso_ankle_dorsiflexion"];
const PERIODS=[
  {date:"2026-09-01",stage:"首次测试",cmj:32,sj:27,imtp:2200,mss:8.0,mas:4.4,contact:230,pushup:55,mb:9.5,iso:[[185,200],[280,300],[650,700],[240,250]]},
  {date:"2026-09-15",stage:"第二次复测",cmj:35,sj:29,imtp:2350,mss:8.1,mas:4.5,contact:215,pushup:57,mb:10,iso:[[200,210],[315,320],[700,720],[260,265]]},
  {date:"2026-09-29",stage:"第三次复测",cmj:34,sj:29,imtp:2300,mss:7.9,mas:4.5,contact:240,pushup:52,mb:9.7,iso:[[175,210],[315,320],[560,720],[260,265]]},
  {date:"2026-10-13",stage:"第四次复测",cmj:38,sj:null,imtp:2450,mss:7.8,mas:4.7,contact:205,pushup:60,mb:10.8,iso:[[165,210],[345,350],[740,750],[280,285]]},
];
const hash=value=>crypto.createHash("sha256").update(value).digest("hex"),fileHash=file=>hash(fs.readFileSync(file));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const stable=value=>JSON.stringify(canonical(value));
function sameData(actual,expected,message){
  if(hash(stable(actual))===hash(stable(expected)))return;
  const first=(a,b,p="library")=>{
    if(Object.is(a,b))return null;
    if(!a||!b||typeof a!=="object"||typeof b!=="object")return p;
    for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const mismatch=first(a[k],b[k],p+"."+k);if(mismatch)return mismatch;}
    return null;
  };
  throw Error(message+"; first differing field: "+first(actual,expected));
}
function originalCore(library,ids){
  const value=structuredClone(library);for(const key of ["version","updated","activeAthleteId","activeRecordId"])delete value[key];
  value.athletes=value.athletes.filter(owner=>ids.includes(owner.id));
  value.longitudinalReports=(value.longitudinalReports||[]).filter(document=>ids.includes(document.athleteId));
  return value;
}
function verifyBackup(checkpoint){
  assert.ok(path.isAbsolute(checkpoint),"Use the explicit absolute external checkpoint path");
  const manifestFile=path.join(checkpoint,"manifest.json"),manifest=JSON.parse(fs.readFileSync(manifestFile,"utf8").replace(/^\uFEFF/,""));
  assert.equal(manifest.complete,true);assert.ok(manifest.files.length>0);
  for(const entry of manifest.files){assert.ok(["program","userdata"].includes(entry.kind));const file=path.resolve(checkpoint,entry.kind,entry.path);assert.ok(file.startsWith(path.resolve(checkpoint)+path.sep));assert.equal(fileHash(file),entry.sha256);assert.equal(fs.statSync(file).size,entry.bytes);}
  return {file:manifestFile,sha256:fileHash(manifestFile),files:manifest.files.length};
}
async function installWriteGuard(page,baseline){
  return page.evaluate(({baselineJSON,name})=>{
    const baseline=JSON.parse(baselineJSON);
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
    const originalRecords=new Map(baseline.athletes.flatMap(a=>a.records.map(r=>[r.recordId,r]))),owners=new Map(baseline.athletes.map(a=>[a.id,a]));
    const metadata=a=>{const copy=JSON.parse(JSON.stringify(a));delete copy.records;return copy;};
    const repo=App.getRepository();window.__exampleGuard={writes:0,blocked:[],name,originalIds:[...owners.keys()],newAthleteId:""};
    const reject=message=>{window.__exampleGuard.blocked.push(message);throw Error(message);};
    const checkRecord=r=>{
      if(originalRecords.has(r.recordId)){if(!same(r,originalRecords.get(r.recordId)))reject("Attempted change to an original record: "+r.recordId);}
      else if(owners.has(r.athleteId)||r.athlete.name!==name||r.athleteId!==window.__exampleGuard.newAthleteId)reject("Unexpected owner of newly written example record");
    };
    const checkOwners=list=>{for(const a of list||[])if(owners.has(a.id)){if(!same(metadata(a),metadata(owners.get(a.id))))reject("Attempted change to an original athlete: "+a.id);}else if(a.profile?.name!==name||a.id!==window.__exampleGuard.newAthleteId)reject("Unexpected new athlete");};
    const checkDocuments=docs=>{
      if(docs===undefined)return;
      const old=(baseline.longitudinalReports||[]),existing=docs.filter(d=>owners.has(d.athleteId));
      if(!same(old,existing)||docs.some(d=>!owners.has(d.athleteId)&&d.athleteId!==window.__exampleGuard.newAthleteId))reject("Attempted change to an original comparison document");
    };
    const saveRecords=repo.saveRecords.bind(repo);repo.saveRecords=async function(records,checks,options={}){
      records.forEach(checkRecord);checkOwners(options.newAthletes);checkDocuments(options.longitudinalReports);window.__exampleGuard.writes++;return saveRecords(records,checks,options);
    };
    const save=repo.save.bind(repo);repo.save=async function(library,records=[],removals={},checks={}){
      if(Object.values(removals||{}).some(list=>Array.isArray(list)&&list.length))reject("Deletion is not part of adding an example");
      checkOwners(library.athletes);records.forEach(checkRecord);checkDocuments(library.longitudinalReports);
      for(const key of ["groups","evaluationProfiles","catalog","testPlans","defaultEvaluationProfileId"])if(!same(library[key],baseline[key]))reject("Attempted change to existing configuration: "+key);
      window.__exampleGuard.writes++;return save(library,records,removals,checks);
    };
    return {athletes:owners.size,records:originalRecords.size};
  },{baselineJSON:JSON.stringify(baseline),name:NAME});
}
async function enterExample(page,baseline,receipt){
  page.setDefaultTimeout(30000);
  assert.equal(await page.evaluate(()=>App.ready),true);
  const before=JSON.parse(await page.evaluate(async()=>JSON.stringify(await App.getRepository().exportLibrary()))),originalIds=baseline.athletes.map(a=>a.id);
  sameData(originalCore(before,originalIds),originalCore(baseline,originalIds),"Original library must match the pre-write baseline");
  assert.equal(before.athletes.some(a=>a.profile?.name===NAME),false,"Example already exists; this script never duplicates or rewrites it");
  const profile=before.evaluationProfiles.find(p=>p.id===PROFILE&&!p.disabled);assert.ok(profile,"Existing everyday evaluation scheme must be available; no scheme will be created or modified");assert.equal(profile.name,"原有评价方案 1");assert.ok(!Object.keys(profile.aggregations||{}).some(key=>/模拟能力|合成通用/.test(key)));
  receipt.original=await installWriteGuard(page,before);receipt.originalCoreSha256=hash(stable(originalCore(before,originalIds)));
  console.log("Original library checked; protected normal entry starts");
  const field=p=>page.locator(`[data-path="${p}"]`);
  const fill=async(p,value)=>{const control=field(p);await control.fill(String(value));await control.press("Tab");};
  const entry=tab=>page.evaluate(tab=>App.entry(tab),tab);
  const rows=async(project,count)=>{for(let i=await page.evaluate(project=>App.getState().data[project].length,project);i<count;i++)await page.locator(`#entryContent button[onclick="App.addRow('${project}')"]`).first().click();};
  let athleteId;const recordIds=[];
  for(const [index,p] of PERIODS.entries()){
    await page.evaluate(({id,newOwner})=>App.startDataEntry(id||"",newOwner),{id:athleteId,newOwner:index===0});
    await page.waitForFunction(()=>App.getUIState().mode==="creation");
    if(index===0){
      await page.locator("#newAthleteName").fill(NAME);await page.locator("#newAthleteSex").selectOption("男");await page.locator("#newAthleteSport").fill("篮球");await page.locator("#newAthleteBirthDate").fill("2000-02-15");
      const optional=page.locator("#creationProfileFields details").first();if(!await optional.evaluate(node=>node.open))await optional.locator("summary").click();
      await page.locator("#newAthleteHand").selectOption("右手");await page.locator("#newAthleteInjuryHistory").fill("合成示例档案，用于查看多期报告；并非真实受试者。");
    }
    await page.locator("#creationNext").click();await page.locator("#creationTestStep").waitFor({state:"visible"});
    await page.locator("#creationDate").fill(p.date);await page.locator("#creationDate").dispatchEvent("change");
    await page.locator("#creationMass").fill("75");await page.locator("#creationHeight").fill("180");await page.locator("#creationInjury").fill(index===2?"合成情景：本期左膝伸膝时疼痛，下一期缓解。":"合成情景：本次无疼痛主诉。");
    await page.locator("#creationEvaluationProfile").selectOption(PROFILE);
    for(const id of await page.locator("#creationProjects [data-picker-project]:checked").evaluateAll(nodes=>nodes.map(n=>n.dataset.pickerProject)))if(!PROJECTS.includes(id))await page.locator(`#creationProjects [data-picker-project="${id}"]`).uncheck();
    for(const id of PROJECTS)await page.locator(`#creationProjects [data-picker-project="${id}"]`).check();
    for(const id of await page.locator("#creationProjects [data-picker-iso]:checked").evaluateAll(nodes=>nodes.map(n=>n.dataset.pickerIso)))if(!ISO.includes(id))await page.locator(`#creationProjects [data-picker-iso="${id}"]`).uncheck();
    for(const id of ISO)await page.locator(`#creationProjects [data-picker-iso="${id}"]`).check();
    await page.locator("#creationSubmit").click();await page.waitForFunction(()=>App.getUIState().mode==="entry");
    const ids=await page.evaluate(name=>{const r=App.getState();if(r.athlete.name!==name)throw Error("Wrong entry owner");window.__exampleGuard.newAthleteId=r.athleteId;return{athleteId:r.athleteId,recordId:r.recordId};},NAME);
    athleteId=ids.athleteId;recordIds.push(ids.recordId);
    for(const project of ["cmj","sj"]){
      await entry(project);await rows(project,3);
      for(let j=0;j<3;j++)await fill(`data.${project}.${j}.height`,p[project]===null?"":p[project]+j-1);
    }
    await entry("dj");await rows("dj",3);
    for(let j=0;j<3;j++){await fill(`data.dj.${j}.height`,29+j);await fill(`data.dj.${j}.contactTimeMs`,p.contact);await fill(`data.dj.${j}.dropHeightCm`,30);}
    await entry("imtp");await rows("imtp",3);
    for(let j=0;j<3;j++)await fill(`data.imtp.${j}.peakForce`,p.imtp+(j-1)*50);
    for(const project of ["mss","mas"]){await entry(project);await fill(`data.${project}.speed`,p[project]);await fill(`data.${project}.method`,project==="mss"?"合成示例：固定飞跑距离，电子计时":"合成示例：相同场地与递增跑协议");}
    await entry("pushup");await fill("data.pushup.reps",p.pushup);await fill("data.pushup.notes","合成示例：相同动作标准，60秒有效次数。");
    await entry("mb");assert.equal(await field("protocol.mb").inputValue(),before.catalog.protocol.mb);await field("data.mb.0.side").selectOption("D");await fill("data.mb.0.distance",p.mb);
    await entry("iso");
    for(const [position,id] of ISO.entries()){
      const rowIndex=await page.evaluate(id=>App.getState().data.iso.findIndex(r=>r.id===id),id);
      await fill(`data.iso.${rowIndex}.left`,p.iso[position][0]);await fill(`data.iso.${rowIndex}.right`,p.iso[position][1]);
      await field(`data.iso.${rowIndex}.painLeft`).setChecked(index===2&&id==="iso_knee_extension");
    }
    await entry("fms");
    const fms=await page.evaluate(()=>App.getState().data.fms.map(r=>({bilateral:r.bilateral})));
    for(const [j,item] of fms.entries()){
      const left=j===3?(index<2?2:1):j===2&&index===2?0:3,right=j===3?2:3;
      if(item.bilateral){await field(`data.fms.${j}.left`).selectOption(String(left));await field(`data.fms.${j}.right`).selectOption(String(right));}
      else await field(`data.fms.${j}.score`).selectOption(String(j===0&&index===0?2:3));
      await field(`data.fms.${j}.pain`).setChecked(j===2&&index===2);
      if(j===3||j===2)await field(`data.fms.${j}.location`).selectOption(j===3?"shoulder_l":"knee_l");
    }
    await entry("narrative");await page.locator("#interpEditor").fill(`合成示例 · ${p.stage}（${p.date}）。此记录用于查看纵向比较。${index===3?"末次 CMJ、IMTP 和 MAS 提高，MSS 与肩部灵活性下降；SJ 本期缺测。":index===2?"本期模拟阶段性回落与左膝疼痛；疼痛为示例标记。":"测量条件与后续各期保持一致。"}`);
    await page.locator("#entryFinish").click();await page.waitForFunction(()=>App.getUIState().mode==="report");
    await page.locator("#aggMode").selectOption("mean");assert.equal(await page.evaluate(()=>App.saveNow()),true);
    console.log(`Saved synthetic example ${index+1}/${PERIODS.length}`);
  }
  const menu=page.locator("#recordChoiceMenu");if(!await menu.evaluate(node=>node.open))await page.locator("#recordChoiceLabel").click();
  for(const id of recordIds){const checkbox=page.locator(`[data-record-choice="${id}"]`);if(!await checkbox.isChecked()){await checkbox.check();await page.waitForFunction(()=>!!App.getLongitudinal()&&!document.getElementById("saveStatus").textContent.includes("正在保存"));}}
  await page.waitForFunction(()=>App.getLongitudinal()?.periods.length===4);await page.keyboard.press("Escape");
  await page.evaluate(()=>App.openEntry("narrative"));await page.locator("#interpEditor").fill("这是一组用于查看界面的合成复测数据。首末对比中，CMJ、IMTP 和 MAS 提高；MSS 与肩部灵活性下降。SJ 末次缺测，因此不计算首末变化。第三期左膝疼痛、末次缓解；肩部和踝部仍保留不同筛查状态。请结合每期原始试次和测量条件阅读各项变化。");
  await page.locator("#entryFinish").click();await page.waitForFunction(()=>App.getUIState().mode==="report"&&App.getLongitudinal()?.periods.length===4);assert.equal(await page.evaluate(()=>App.saveNow()),true);
  const after=JSON.parse(await page.evaluate(async()=>JSON.stringify(await App.getRepository().exportLibrary())));
  sameData(originalCore(after,originalIds),originalCore(before,originalIds),"Adding the example must preserve all original data and configuration exactly");
  assert.equal(after.athletes.length,before.athletes.length+1);const owner=after.athletes.find(a=>a.id===athleteId);assert.equal(owner.records.length,4);assert.equal(owner.profile.name,NAME);
  for(const [index,p] of PERIODS.entries()){
    const record=owner.records.find(r=>r.athlete.date===p.date);assert.ok(record);assert.equal(record.evaluationProfileId,PROFILE);assert.equal(Number(record.athlete.age),26);assert.equal(Number(record.athlete.mass),75);
    for(const project of ["cmj","sj"])assert.deepEqual(record.data[project].map(row=>row.height===""?null:Number(row.height)),p[project]===null?[null,null,null]:[p[project]-1,p[project],p[project]+1]);
    assert.deepEqual(record.data.imtp.map(row=>Number(row.peakForce)),[p.imtp-50,p.imtp,p.imtp+50]);
    assert.equal(Number(record.data.mss.speed),p.mss);assert.equal(Number(record.data.mas.speed),p.mas);assert.deepEqual(record.data.dj.map(row=>Number(row.contactTimeMs)),[p.contact,p.contact,p.contact]);assert.deepEqual(record.data.dj.map(row=>Number(row.height)),[29,30,31]);
    assert.equal(Number(record.data.pushup.reps),p.pushup);assert.equal(Number(record.data.mb.find(row=>row.side==="D").distance),p.mb);assert.equal(record.protocol.mb,before.catalog.protocol.mb);assert.deepEqual(Object.keys(record.enabled).filter(key=>record.enabled[key]).sort(),[...PROJECTS].sort());
    for(const [position,id] of ISO.entries()){const row=record.data.iso.find(row=>row.id===id);assert.deepEqual([Number(row.left),Number(row.right)],p.iso[position]);assert.equal(row.painLeft,index===2&&id==="iso_knee_extension");}
    assert.equal(Number(record.data.fms[3].left),index<2?2:1);assert.equal(record.data.fms[2].pain,index===2);
  }
  const observation=await page.evaluate(()=>{const m=App.getLongitudinal();return{axes:m.overview.rows.length,axisLabels:m.overview.rows.map(row=>row.name),projects:m.projects.map(p=>p.name),risk:m.risk.rows.map(row=>({id:row.id,values:row.cells.map(c=>c?.value??null)})),guard:window.__exampleGuard,summary:document.getElementById("microCards").innerText,changeSummary:m.changeSummary,missingSJ:m.projects.find(p=>p.id==="sj")?.metrics.find(row=>row.metricId==="sj_height")?.changes.overall};});
  assert.deepEqual(observation.guard.blocked,[]);assert.deepEqual([...observation.axisLabels].sort(),["下肢爆发力","力量耐力","旋转投掷能力"].sort(),"Use the three existing everyday abilities and their existing standards");assert.ok(![...observation.axisLabels,...observation.projects].some(name=>/模拟能力|合成通用/.test(name)));assert.ok(observation.changeSummary.improved.length>0);assert.ok(observation.changeSummary.declined.length>0);
  assert.ok(observation.risk.length>=6);assert.equal(observation.risk.find(row=>row.id==="shoulder_l").values.at(-1),1);assert.equal(observation.risk.find(row=>row.id==="knee_l").values[2],1);assert.ok(new Set(observation.risk.map(row=>row.values.at(-1))).size>1);assert.equal(observation.missingSJ.available,false);assert.equal(observation.missingSJ.reason,"端点缺测");
  assert.ok(observation.changeSummary.improved.some(row=>row.metricId==="cmj_height"));assert.ok(observation.changeSummary.declined.some(row=>row.metricId==="fms:3"));
  receipt.created={athleteId,name:NAME,recordIds,dates:PERIODS.map(p=>p.date),evaluationProfileId:PROFILE};receipt.guard={writes:observation.guard.writes,blocked:observation.guard.blocked};receipt.summary=observation.summary;receipt.observation={...observation,guard:undefined};receipt.originalDataPreserved=true;receipt.after={athletes:after.athletes.length,records:after.athletes.reduce((sum,a)=>sum+a.records.length,0)};
  return receipt;
}
async function main(){
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];},checkpoint=arg("--checkpoint");
  assert.ok(checkpoint,"An explicit verified external backup is required");const backup=verifyBackup(checkpoint);
  const baselinePath=path.join(checkpoint,"verification/baseline/snapshot.json"),baseline=JSON.parse(fs.readFileSync(baselinePath,"utf8")).library;
  const browserMode=process.argv.includes("--browser"),profile=arg("--profile"),actual=process.argv.includes("--actual-profile"),pdf=process.argv.includes("--pdf");
  const receiptDir=path.join(checkpoint,"verification",browserMode?"example-browser":actual?"example-installed":"example-candidate"),out=path.resolve(arg("--artifact-dir")||receiptDir);fs.mkdirSync(out,{recursive:true});fs.mkdirSync(receiptDir,{recursive:true});
  const receipt={pass:false,syntheticAddition:true,mode:browserMode?"isolated-browser":actual?"actual-profile":"copied-profile",runnerSha256:fileHash(__filename),sourceHash:fileHash(path.join(ROOT,"MotionBench.html")),backup,baselineSnapshotSha256:fileHash(baselinePath),errors:[],network:[],artifacts:[],pdfRequested:pdf};
  let browser,electron,page;
  const artifact=file=>{const item={file,sha256:fileHash(file),bytes:fs.statSync(file).size};receipt.artifacts.push(item);return item;};
  const download=async kind=>{
    const file=path.join(out,"example-comparison."+kind.toLowerCase());
    if(electron){
      const index=await electron.evaluate(()=>__exampleDownloads.length);await page.evaluate(kind=>App["download"+kind](),kind);let item;const end=Date.now()+900000;
      while(Date.now()<end){item=await electron.evaluate((_e,{index,kind})=>__exampleDownloads.slice(index).find(d=>d.name.toLowerCase().endsWith("."+kind.toLowerCase())),{index,kind});if(item)break;await page.waitForTimeout(100);}
      assert.ok(item,"Native export finished");assert.equal(item.state,"completed");fs.copyFileSync(item.path,file);
    }else{const pending=page.waitForEvent("download",{timeout:900000});pending.catch(()=>{});await page.evaluate(kind=>App["download"+kind](),kind);const d=await pending;assert.equal(await d.failure(),null);await d.saveAs(file);}
    if(kind==="PDF")assert.equal(await page.evaluate(()=>RingsidePDF.lastDiagnostics?.status),"complete");artifact(file);console.log("Exported synthetic comparison "+kind);return file;
  };
  try{
    let entryBaseline=baseline;
    if(browserMode){browser=await chromium.launch({channel:"chrome",headless:true});const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}});page=await context.newPage();await page.goto(pathToFileURL(path.join(ROOT,"MotionBench.html")).href);await page.waitForFunction(()=>App.ready);console.log("Isolated browser ready; restoring baseline through normal import service");await page.evaluate(async libraryJSON=>{await App.importPayload(JSON.parse(libraryJSON),"replace-library");await App.showReport(false);},JSON.stringify(baseline));console.log("Isolated baseline restored; checking before entry");entryBaseline=JSON.parse(await page.evaluate(async()=>JSON.stringify(await App.getRepository().exportLibrary())));receipt.seedImportRemapped=true;}
    else{
      assert.ok(profile&&path.isAbsolute(profile),"An explicit prepared native profile is required");const normal=path.join(process.env.APPDATA,"MotionBench Desktop");
      assert.equal(path.resolve(profile)===path.resolve(normal),actual,"Actual user data requires the explicit --actual-profile flag");if(actual)assert.ok(process.argv.includes("--write-confirmed"),"Actual writes require root's explicit authorization and --write-confirmed");else assert.ok(path.resolve(profile).startsWith(path.resolve(checkpoint)+path.sep));
      const executable=arg("--executable")||arg("--exe");assert.ok(executable&&path.isAbsolute(executable));const env={...process.env,MOTIONBENCH_TEST_EXPORT_DIR:path.join(out,"downloads")};delete env.ELECTRON_RUN_AS_NODE;
      const archive=path.join(path.dirname(executable),"resources/app.asar"),asar=require("@electron/asar");receipt.identity={executable,executableSha256:fileHash(executable),archive,archiveSha256:fileHash(archive),runtimeHtmlSha256:hash(asar.extractFile(archive,path.normalize("MotionBench.html"))),sourceHtmlSha256:receipt.sourceHash};assert.equal(receipt.identity.runtimeHtmlSha256,receipt.sourceHash,"Native runtime must match current reviewed source");
      electron=await _electron.launch({executablePath:executable,args:["--motionbench-test","--motionbench-data-dir="+profile],cwd:ROOT,env,timeout:60000});await electron.context().setOffline(true);page=await electron.firstWindow();await page.waitForFunction(()=>window.App?.ready,null,{timeout:60000});receipt.userDataPath=path.resolve(await electron.evaluate(({app})=>app.getPath("userData")));receipt.profilePath=path.resolve(profile);assert.equal(receipt.userDataPath,receipt.profilePath);receipt.version=await page.evaluate(()=>MotionBenchDesktop.version);
      await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1440,1000);globalThis.__exampleDownloads=[];w.webContents.session.on("will-download",(_e,item)=>item.once("done",(_e,state)=>__exampleDownloads.push({path:item.getSavePath(),name:item.getFilename(),state})));});
    }
    page.on("pageerror",error=>{receipt.errors.push(error.message);(receipt.errorStacks||=[]).push(error.stack);console.error(error.stack);});page.on("request",request=>{if(/^https?:/.test(request.url()))receipt.network.push(request.url());});page.on("dialog",dialog=>dialog.dismiss());
    await enterExample(page,entryBaseline,receipt);assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.network,[]);
    const screenshot=path.join(out,"example-comparison.png");await page.screenshot({path:screenshot,fullPage:false});receipt.screenshot=artifact(screenshot);
    const overviewScreenshot=path.join(out,"example-overview.png");await page.locator("#radarChart").locator("xpath=ancestor::section[1]").screenshot({path:overviewScreenshot});artifact(overviewScreenshot);
    const jsonFile=await download("JSON");await download("HTML");if(pdf)await download("PDF");
    const exported=JSON.parse(fs.readFileSync(jsonFile,"utf8"));assert.equal(exported.kind,"longitudinal-report");assert.equal(exported.library.athletes.length,1);assert.equal(exported.library.athletes[0].id,receipt.created.athleteId);assert.deepEqual([...exported.selection.recordIds].sort(),[...receipt.created.recordIds].sort());assert.deepEqual(exported.library.evaluationProfiles.map(profile=>profile.id),[PROFILE]);assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.network,[]);
    if(electron){assert.equal((await page.evaluate(()=>App.prepareDesktopClose())).ok,true);const closed=electron.waitForEvent("close",{timeout:60000});await electron.evaluate(({BrowserWindow})=>setImmediate(()=>BrowserWindow.getAllWindows()[0].close()));await closed;electron=null;receipt.normalClose=true;}
    receipt.pass=true;
  }catch(error){receipt.failure=error.stack;receipt.failureState=await page?.evaluate(()=>({guard:window.__exampleGuard?{writes:__exampleGuard.writes,blocked:__exampleGuard.blocked}:null,mode:window.App?.getUIState().mode,toast:document.getElementById("toast")?.textContent,creationError:document.getElementById("creationError")?.textContent})).catch(()=>null);console.error(error.stack);process.exitCode=1;}
  finally{await browser?.close();await electron?.close().catch(()=>{});receipt.sourceUnchanged=fileHash(path.join(ROOT,"MotionBench.html"))===receipt.sourceHash;receipt.runnerUnchanged=fileHash(__filename)===receipt.runnerSha256;for(const dir of new Set([receiptDir,out]))fs.writeFileSync(path.join(dir,"results.json"),JSON.stringify(receipt,null,2));console.log(JSON.stringify({pass:receipt.pass,mode:receipt.mode,original:receipt.original,after:receipt.after,summary:receipt.summary}));}
}
module.exports={enterExample,PERIODS,NAME,PROFILE,originalCore,verifyBackup};
if(require.main===module)main();
