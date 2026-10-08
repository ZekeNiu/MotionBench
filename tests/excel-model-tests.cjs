"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
global.window=global;global.ExcelJS=require("../vendor/exceljs.min.js");
for(const name of ["calc","cpet-reference","definitions","tests","model","evaluation","interventions","excel"])vm.runInThisContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"));
const M=global.RingsideModel,X=global.RingsideExcel,copy=x=>JSON.parse(JSON.stringify(x));let passed=0;
async function test(name,run){await run();passed++;console.log("PASS "+name);}
const cat=()=>M.normalizeCatalog();
function seed(ids=["cmj"]){const r=M.recordFromCatalog(cat(),{name:"同名运动员",sex:"男",sport:"拳击"},Object.fromEntries(ids.map(id=>[id,true])),"2026-10-08");r.evaluationProfileId="evaluation_test";r.athlete.mass=70;return r;}
const athlete=r=>({id:r.athleteId,name:r.athlete.name,profile:M.profileFromRecord(r),records:[]});
async function workbook(records,prefill=false){const exported=await X.createTemplate({records,prefill}),book=new ExcelJS.Workbook();await book.xlsx.load(exported.bytes);return {book,exported};}
const sheet=(book,text)=>book.worksheets.find(s=>s.name.endsWith("_"+text));
const col=(ws,key)=>{let found;ws.getRow(2).eachCell((c,i)=>{if(c.value===key)found=i;});if(!found)throw Error("Missing "+key);return found;};
const set=(ws,row,key,value)=>ws.getCell(row,col(ws,key)).value=value;
const parse=book=>book.xlsx.writeBuffer().then(bytes=>X.readTemplate(bytes));
const review=(parsed,rs,records=[],catalog=cat())=>X.preview(parsed,{athletes:rs.map(athlete),records,catalog});
const allReplace=review=>Object.fromEntries(review.entries.map(e=>[e.recordId,{projects:Object.fromEntries(e.projects.map(p=>[p.id,"replace"])),metadata:"replace"}]));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function setCondition(book,key,value){const ws=book.getWorksheet("测试条件");for(let row=3;row<=ws.rowCount;row++)if(ws.getCell(row,col(ws,"fieldId")).value===key){set(ws,row,"value",value);return;}throw Error("Missing condition "+key);}

(async()=>{
 await test("actual XLSX preserves every native project's calculated results",async()=>{
  const r=M.sampleRecord();r.evaluationProfileId="evaluation_test";r.athlete.mass=70;
  const p=await X.readTemplate((await X.createTemplate({records:[r],prefill:true})).bytes);assert.deepEqual(p.errors,[]);
  const result=X.apply(review(p,[r])).records[0];assert.ok(result);const profile=RingsideEvaluation.create(r),before=M.stats(RingsideEvaluation.resolve(r,profile)),after=M.stats(RingsideEvaluation.resolve(result,profile));
  for(const [key,value]of Object.entries(before.values))if(Number.isFinite(value)&&!key.includes("dsi"))near(after.values[key],value);
  assert.equal(result.data.fms.length,r.data.fms.length);assert.equal(result.data.fms[0].score,r.data.fms[0].score);
  assert.equal(result.data.cpet.oxygenLabel,r.data.cpet.oxygenLabel);assert.equal(result.data.hop.trials[0].summary.rsi,r.data.hop.summary.rsi);
 });
 await test("same-name athletes bind by stable IDs and receive separate records",async()=>{
  const a=seed(),b=seed(),{book}=await workbook([a,b]),ws=sheet(book,"CMJ");set(ws,3,"height",31);set(ws,6,"height",41);
  assert.notEqual(ws.getCell(3,col(ws,"name")).value,ws.getCell(6,col(ws,"name")).value);assert.ok(ws.getCell(3,col(ws,"name")).value.includes(a.athleteId.slice(-6)));assert.ok(ws.getCell(3,col(ws,"name")).value.includes("拳击"));
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const result=X.apply(review(parsed,[a,b]));assert.equal(result.created,2);
  assert.equal(result.records.find(r=>r.athleteId===a.athleteId).data.cmj[0].height,31);assert.equal(result.records.find(r=>r.athleteId===b.athleteId).data.cmj[0].height,41);
 });
 await test("blank batch rows skip people and do not turn into zero measurements",async()=>{
  const a=seed(["cmj","imtp","hop","fms","iso","cpet"]),{book}=await workbook([a]);const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);
  assert.equal(X.apply(review(parsed,[a])).records.length,0);
 });
 await test("prefilled unmeasured projects reserve three attempts and aligned IMTP and Hop detail groups",async()=>{
  const r=seed(["cmj","sj","imtp","hop","iso","mb","landmine"]);M.setIsoDirectionSelection(r,["iso_shoulder_externalRotation","iso_wrist_flexion"]);r.dsi.force=2100;
  const original=JSON.stringify(r),{book}=await workbook([r],true);assert.equal(JSON.stringify(r),original);
  for(const name of ["CMJ","SJ","IMTP"])assert.equal(sheet(book,name).rowCount-2,3);
  assert.equal(sheet(book,"药球反手投掷").rowCount-2,6);assert.equal(sheet(book,"地雷杠出拳投掷").rowCount-2,6);
  assert.equal(sheet(book,"各方位等长力量").rowCount-2,6);
  const imtp=book.worksheets.find(s=>s.name.endsWith("_时间点")),hop=book.worksheets.find(s=>/Hop/.test(s.name)&&!s.name.endsWith("_逐跳")),jumps=book.worksheets.find(s=>s.name.endsWith("_逐跳"));
  assert.equal(hop.rowCount-2,3);assert.equal(imtp.rowCount-2,6);assert.equal(jumps.rowCount-2,30);
  for(const ws of [imtp,jumps])assert.deepEqual([...new Set(Array.from({length:ws.rowCount-2},(_,i)=>ws.getCell(i+3,col(ws,"attempt")).value))],[1,2,3]);
  const conditions=book.getWorksheet("测试条件");assert.ok(Array.from({length:conditions.rowCount-2},(_,i)=>i+3).some(row=>conditions.getCell(row,col(conditions,"fieldId")).value==="dsi.force"&&conditions.getCell(row,col(conditions,"value")).value===2100));
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);assert.ok(parsed.entries[0].record.data.cmj.every(row=>row.height===""));
 });
 await test("prefilled mixed isometric directions keep measured attempts and reserve three blank attempts per unmeasured direction",async()=>{
  const r=seed(["iso"]);M.setIsoDirectionSelection(r,["iso_shoulder_externalRotation","iso_wrist_flexion"]);
  const measured=r.data.iso.find(row=>row.id==="iso_shoulder_externalRotation");measured.trials=[{id:"left1",left:0,right:110,painLeft:true},{id:"left2",left:101,right:112}];
  const blank=r.data.iso.find(row=>row.id==="iso_wrist_flexion");blank.protocol="腕中立位";
  const {book}=await workbook([r],true),ws=sheet(book,"各方位等长力量"),rows=Array.from({length:ws.rowCount-2},(_,i)=>i+3);
  assert.equal(rows.filter(row=>ws.getCell(row,col(ws,"directionId")).value===measured.id).length,2);
  const blankRows=rows.filter(row=>ws.getCell(row,col(ws,"directionId")).value===blank.id);assert.equal(blankRows.length,3);
  assert.ok(blankRows.every(row=>ws.getCell(row,col(ws,"left")).value===null&&ws.getCell(row,col(ws,"right")).value===null&&ws.getCell(row,col(ws,"directionProtocol")).value==="腕中立位"));
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const restored=parsed.entries[0].record.data.iso.find(row=>row.id===measured.id);assert.equal(restored.trials.length,2);assert.equal(restored.trials[0].left,0);assert.equal(restored.trials[0].painLeft,true);
 });
 await test("prefilled measured repeated projects preserve original group counts and associated detail rows",async()=>{
  const r=seed(["cmj","imtp","hop"]);r.data.cmj=[{id:"cmj1",height:31},{id:"cmj2",height:32}];r.data.imtp=[{id:"imtp1",peakForce:2200,timePoints:[{timeMs:125,force:1100}]}];
  r.data.hop.inputMode="jumps";r.data.hop.jumps=[{id:"hop1",height:20,contactTimeMs:150},{id:"hop2",height:21,contactTimeMs:160}];
  const {book}=await workbook([r],true);assert.equal(sheet(book,"CMJ").rowCount-2,2);assert.equal(sheet(book,"IMTP").rowCount-2,1);
  assert.equal(book.worksheets.find(s=>s.name.endsWith("_时间点")).rowCount-2,1);assert.equal(book.worksheets.find(s=>/Hop/.test(s.name)&&!s.name.endsWith("_逐跳")).rowCount-2,1);assert.equal(book.worksheets.find(s=>s.name.endsWith("_逐跳")).rowCount-2,2);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.entries[0].record.data.cmj.length,2);assert.equal(parsed.entries[0].record.data.imtp[0].timePoints[0].force,1100);assert.equal(parsed.entries[0].record.data.hop.trials[0].jumps.length,2);
 });
 await test("zero FMS, zero force baseline and signed RFD remain explicit",async()=>{
  const r=seed(["fms","imtp"]),{book}=await workbook([r]);set(sheet(book,"FMS 动作筛查"),3,"score",0);set(sheet(book,"IMTP"),3,"baselineForce",0);
  const points=book.worksheets.find(s=>s.name.endsWith("_时间点"));set(points,3,"force",0);set(points,3,"rfd",-2);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const result=X.apply(review(parsed,[r])).records[0];assert.equal(result.data.fms[0].score,0);assert.equal(result.data.imtp[0].baselineForce,0);assert.equal(result.data.imtp[0].timePoints[0].force,0);assert.equal(result.data.imtp[0].timePoints[0].rfd,-2);
 });
 await test("arbitrary IMTP time points and added attempts survive",async()=>{
  const r=seed(["imtp"]),{book}=await workbook([r]),ws=sheet(book,"IMTP"),points=book.worksheets.find(s=>s.name.endsWith("_时间点"));
  set(ws,3,"peakForce",2500);set(points,3,"timeMs",125);set(points,3,"force",1300);set(points,4,"timeMs",350);set(points,4,"rfd",2800);
  ws.addRow(ws.getRow(3).values);set(ws,6,"attempt",4);set(ws,6,"peakForce",2700);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const result=X.apply(review(parsed,[r])).records[0];assert.equal(result.data.imtp.length,2);assert.deepEqual(result.data.imtp[0].timePoints.map(p=>p.timeMs),[125,350]);
 });
 await test("Hop raw jumps retain groups while summary RSI remains a supplied mean",async()=>{
  const r=seed(["hop"]),{book}=await workbook([r]),ws=sheet(book,"10/5 Hop Test 连续反应跳")||book.worksheets.find(s=>/Hop/.test(s.name)&&!s.name.endsWith("_逐跳")),jumps=book.worksheets.find(s=>s.name.endsWith("_逐跳"));
  set(ws,3,"inputMode","jumps");for(let i=0;i<10;i++){set(jumps,3+i,"height",20+i);set(jumps,3+i,"contactTimeMs",150);}
  set(ws,4,"summary.height",25);set(ws,4,"summary.contactTimeMs",200);set(ws,4,"summary.rsi",1.75);set(ws,4,"summary.selectionBasis","flight_ratio");
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const result=X.apply(review(parsed,[r])).records[0];assert.equal(result.data.hop.trials[0].jumps.length,10);assert.equal(result.data.hop.trials[1].summary.rsi,1.75);
  assert.equal(M.hopSetSummary(result.data.hop.trials[1]).row.rsi,1.75);
 });
 await test("device stiffness N/m normalizes once and round-trips its display unit",async()=>{
  const r=seed(["dj","hop"]),{book}=await workbook([r]),dj=sheet(book,"DJ 下落跳"),hop=book.worksheets.find(s=>/Hop/.test(s.name)&&!s.name.endsWith("_逐跳"));
  set(dj,3,"activeStiffness",32000);set(dj,3,"activeStiffnessInputUnit","N/m");set(hop,3,"summary.activeStiffness",25000);set(hop,3,"summary.activeStiffnessInputUnit","N/m");
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const result=X.apply(review(parsed,[r])).records[0];assert.equal(result.data.dj[0].activeStiffness,32);assert.equal(result.data.hop.trials[0].summary.activeStiffness,25);
  const again=await X.readTemplate((await X.createTemplate({records:[result],prefill:true})).bytes);assert.equal(again.entries[0].record.data.dj[0].activeStiffness,32);
 });
 await test("CPET raw labels, modality, absolute units and threshold outputs survive",async()=>{
  const r=seed(["cpet"]),{book}=await workbook([r]),ws=sheet(book,"CPET 心肺运动测试");set(ws,3,"label","VO2peak");set(ws,3,"vo2",4.1);set(ws,3,"vo2Unit","l/min");set(ws,3,"rer",1.12);set(ws,4,"label","LT1");set(ws,4,"vo2",2.5);set(ws,4,"vo2Unit","l/min");set(ws,4,"power",180);
  const conditions=book.getWorksheet("测试条件");for(let i=3;i<=conditions.rowCount;i++)if(conditions.getCell(i,col(conditions,"fieldId")).value==="data.cpet.modality")set(conditions,i,"value","cycle");
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const result=X.apply(review(parsed,[r])).records[0];assert.equal(result.data.cpet.thresholds.first.label,"LT1");assert.equal(result.data.cpet.modality,"cycle");near(M.stats(result).values.cpet_vo2_relative,4.1*1000/70);
 });
 await test("custom record and attempt metrics preserve independent values and notes",async()=>{
  const catalog=cat();catalog.tests.push({id:"custom_excel",name:"自定义测试",category:"performance",primaryAbility:"最大力量"});
  for(const [id,scope]of [["excel_record","record"],["excel_attempt","attempt"]])catalog.definitions.push({id,testId:"custom_excel",name:id,unit:"N",ability:"最大力量",category:"performance",direction:"higher",target:null,referenceEnabled:false,ranges:[],entryScope:scope});
  const r=M.recordFromCatalog(catalog,{name:"自定义运动员"},{custom_excel:true},"2026-10-08");r.evaluationProfileId="evaluation_test";
  const {book}=await workbook([r]),ws=sheet(book,"自定义测试"),extra=book.worksheets.find(s=>s.name.endsWith("_补充指标"));set(ws,3,"metrics.excel_attempt",-2);set(ws,4,"metrics.excel_attempt",4);set(extra,3,"value",0);set(extra,3,"notes","原始备注");
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const result=X.apply(review(parsed,[r],[],catalog)).records[0];assert.equal(result.data.custom_excel[0].metrics.excel_attempt,-2);assert.equal(result.customValues.excel_record.value,0);assert.equal(result.customValues.excel_record.notes,"原始备注");
 });
 await test("formulas and invalid numeric cells report precise sheet and address",async()=>{
  const r=seed(),{book}=await workbook([r]),ws=sheet(book,"CMJ");set(ws,3,"height",{formula:"1+2",result:3});set(ws,4,"height","三十");const parsed=await parse(book);
  assert.ok(parsed.errors.some(e=>e.sheet===ws.name&&e.address===ws.getCell(3,col(ws,"height")).address&&/公式/.test(e.message)));assert.ok(parsed.errors.some(e=>e.row===4&&e.address&&/有限数值/.test(e.message)));assert.throws(()=>X.apply(review(parsed,[r])),/错误/);
 });
 await test("duplicate attempt numbers and invalid dates are blocking errors",async()=>{
  const r=seed(),{book}=await workbook([r]),ws=sheet(book,"CMJ");set(ws,3,"height",30);set(ws,4,"height",31);set(ws,4,"attempt",1);set(book.getWorksheet("本次测试"),3,"date","2026-02-30");
  const parsed=await parse(book);assert.ok(parsed.errors.some(e=>/编号重复/.test(e.message)));assert.ok(parsed.errors.some(e=>/日期/.test(e.message)));
 });
 await test("changed identity, unknown athletes and changed field units cannot be imported",async()=>{
  const r=seed(),{book}=await workbook([r]),ws=sheet(book,"CMJ");set(ws,3,"height",30);set(ws,3,"athleteId","wrong_person");assert.ok((await parse(book)).errors.some(e=>/编号/.test(e.message)));
  set(ws,3,"athleteId",r.athleteId);const parsed=await parse(book);assert.ok(X.preview(parsed,{athletes:[],catalog:cat()}).errors.length);
  const old=copy(r);old.dsi.cmjUnit="kgf";assert.ok(review(parsed,[r],[old]).errors.some(e=>/单位/.test(e.message)));
 });
 await test("supplement keeps old values by default and replacement swaps complete attempts",async()=>{
  const old=seed(["cmj","sj"]);old.data.cmj=[{id:"a",height:25},{id:"b",height:26}];old.data.sj=[{id:"s",height:20}];old.narrative.html="人工建议保留";
  const {book}=await workbook([old]),ws=sheet(book,"CMJ");set(ws,3,"height",35);set(book.getWorksheet("本次测试"),3,"mass",75);
  const parsed=await parse(book),p=review(parsed,[old],[old]);assert.deepEqual(p.errors,[]);assert.equal(p.entries[0].projects.find(x=>x.id==="cmj").defaultAction,"keep");assert.equal(X.apply(p).records.length,0);
  const updated=X.apply(p,{[old.recordId]:{projects:{cmj:"replace"}}}).records[0];assert.equal(updated.data.cmj.length,1);assert.equal(updated.data.cmj[0].height,35);assert.equal(updated.data.sj[0].height,20);assert.equal(updated.athlete.mass,70);assert.equal(updated.narrative.html,"人工建议保留");
  assert.equal(X.apply(p,{[old.recordId]:{projects:{cmj:"replace"},metadata:"replace"}}).records[0].athlete.mass,75);
 });
 await test("blank project replacement never erases current measurements",async()=>{
  const r=seed();r.data.cmj=[{id:"old",height:30}];const parsed=await parse((await workbook([r])).book),p=review(parsed,[r],[r]);assert.equal(X.apply(p,allReplace(p)).records.length,0);
 });
 await test("shared DSI settings default to keep and can be replaced independently of CMJ measurements",async()=>{
  const old=seed();old.data.cmj=[{id:"cmj-old",height:30}];Object.assign(old.dsi,{source:"manual",force:2000,protocol:"原等长协议",definition:"gross",confirmed:true});old.impulseConfig.confirmed=true;
  const {book}=await workbook([old],true);set(sheet(book,"CMJ"),3,"height",35);
  for(const [key,value]of Object.entries({"dsi.source":"imtp","dsi.force":2200,"dsi.protocol":"新等长协议","dsi.definition":"net"}))setCondition(book,key,value);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const p=review(parsed,[old],[old]),entry=p.entries[0];
  assert.deepEqual(entry.settingsChanges.map(c=>c.field).sort(),["dsi.source","dsi.force","dsi.protocol","dsi.definition"].sort());assert.equal(entry.settingsChanges.find(c=>c.field==="dsi.source").displayAfter,"IMTP 汇总结果");assert.deepEqual(entry.projects[0].conditionChanges,[]);
  const defaultSettings=X.apply(p,{[old.recordId]:{projects:{cmj:"replace"}}}).records[0];assert.equal(defaultSettings.data.cmj[0].height,35);assert.deepEqual(defaultSettings.dsi,old.dsi);
  const settingsOnly=X.apply(p,{[old.recordId]:{settings:"replace"}}).records[0];assert.equal(settingsOnly.data.cmj[0].height,30);assert.equal(settingsOnly.dsi.force,2200);assert.equal(settingsOnly.dsi.source,"imtp");assert.equal(settingsOnly.dsi.protocol,"新等长协议");assert.equal(settingsOnly.dsi.definition,"net");assert.equal(settingsOnly.dsi.confirmed,false);assert.equal(settingsOnly.impulseConfig.confirmed,true);
 });
 await test("DSI-only changes do not mark CMJ trials as different and a blank shared force cannot erase a prior value",async()=>{
  const old=seed();old.data.cmj=[{id:"old",height:30}];Object.assign(old.dsi,{source:"manual",force:2000,protocol:"旧协议"});
  const {book}=await workbook([old],true);setCondition(book,"dsi.force",null);setCondition(book,"dsi.protocol","新协议");
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const p=review(parsed,[old],[old]);assert.equal(p.entries[0].projects[0].identical,true);assert.equal(p.entries[0].projects[0].oldCount,1);assert.equal(p.entries[0].projects[0].newCount,1);assert.deepEqual(p.entries[0].settingsChanges.map(c=>c.field),["dsi.protocol"]);assert.equal(X.apply(p).records.length,0);
  const updated=X.apply(p,{[old.recordId]:{settings:"replace"}}).records[0];assert.equal(updated.dsi.force,2000);assert.equal(updated.dsi.protocol,"新协议");assert.equal(updated.data.cmj[0].height,30);
 });
 await test("project protocols, force and speed definitions and selected isometric units are disclosed and follow replacement",async()=>{
  const old=seed(["cmj","bench","iso"]);old.data.cmj=[{id:"cmj-old",height:30}];old.data.bench=[{id:"bench-old",load:60,velocity:.6}];M.setIsoDirectionSelection(old,["iso_shoulder_externalRotation"]);const direction=old.data.iso.find(r=>r.id==="iso_shoulder_externalRotation");direction.left=100;direction.right=110;direction.protocol="原角度";
  const {book}=await workbook([old],true);setCondition(book,"protocol.cmj","新测力台协议");setCondition(book,"cmjConfig.definition","net");setCondition(book,"lvp.bench.metric","MPV");const iso=sheet(book,"各方位等长力量");set(iso,3,"unit","kgf");set(iso,3,"directionProtocol","新角度");set(iso,3,"left",11);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const p=review(parsed,[old],[old]),projects=p.entries[0].projects;assert.deepEqual(p.entries[0].settingsChanges,[]);assert.equal(projects.find(p=>p.id==="cmj").conditionChanges.find(c=>c.field==="cmjConfig.definition").displayAfter,"净力");assert.ok(projects.find(p=>p.id==="bench").conditionChanges.some(c=>c.field==="lvp.bench.metric"&&c.after==="MPV"));
  const isoChanges=projects.find(p=>p.id==="iso").conditionChanges;assert.equal(isoChanges.length,2);assert.ok(isoChanges.every(c=>c.directionId===direction.id));assert.ok(isoChanges.some(c=>c.after==="kgf"));assert.ok(isoChanges.some(c=>c.after==="新角度"));
  assert.equal(X.apply(p).records.length,0);const updated=X.apply(p,allReplace(p)).records[0];assert.equal(updated.protocol.cmj,"新测力台协议");assert.equal(updated.cmjConfig.definition,"net");assert.equal(updated.lvp.bench.metric,"MPV");assert.equal(updated.data.iso.find(r=>r.id===direction.id).unit,"kgf");assert.equal(updated.data.iso.find(r=>r.id===direction.id).trials[0].left,11);
 });
 await test("a supplied shared force is retained in a new record without inventing CMJ attempts",async()=>{
  const r=seed(),{book}=await workbook([r]);setCondition(book,"dsi.source","manual");setCondition(book,"dsi.force",2100);setCondition(book,"dsi.protocol","全身等长测试");
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const first=X.apply(review(parsed,[r]));assert.equal(first.created,1);assert.equal(first.records[0].dsi.force,2100);assert.ok(first.records[0].data.cmj.every(row=>row.height===""&&row.force===""));
  const p=review(parsed,[r],first.records);assert.equal(p.entries[0].projects[0].hasIncoming,false);assert.equal(X.apply(p,allReplace(p)).records.length,0);
 });
 await test("same template target prevents duplicate records on repeated imports",async()=>{
  const r=seed(),{book}=await workbook([r]);set(sheet(book,"CMJ"),3,"height",31);const parsed=await parse(book),first=X.apply(review(parsed,[r]));assert.equal(first.created,1);
  const second=review(parsed,[r],first.records);assert.equal(second.entries[0].existing,true);assert.equal(X.apply(second).created,0);assert.equal(X.apply(second).records.length,0);
 });
 await test("isometric subset replacement preserves all unselected directions",async()=>{
  const old=seed(["iso"]),all=M.isoRows();M.setIsoDirectionSelection(old,[all[0].id,all[1].id]);old.data.iso.find(r=>r.id===all[0].id).center=100;old.data.iso.find(r=>r.id===all[1].id).center=200;
  const template=copy(old);M.setIsoDirectionSelection(template,[all[0].id]);const {book}=await workbook([template]),ws=sheet(book,"各方位等长力量");set(ws,3,"center",150);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const p=review(parsed,[old],[old]),result=X.apply(p,allReplace(p)).records[0];
  assert.equal(result.data.iso.find(r=>r.id===all[0].id).trials[0].center,150);assert.equal(result.data.iso.find(r=>r.id===all[1].id).center,200);assert.ok(result.isoDirectionIds.includes(all[1].id));
 });
 await test("export carries no scoring overrides in editable worksheets",async()=>{
  const r=seed(),{book}=await workbook([r]);for(const ws of book.worksheets.filter(s=>s.state!=="veryHidden"))assert.ok(!ws.getRow(2).values.some(v=>/^(rules|definitions|evaluationProfileId)/.test(String(v))));
 });
 await test("workbook dropdowns display Chinese choices and accept their original codes",async()=>{
  const r=seed(["hop","cmj","cpet","mb"]),{book}=await workbook([r]),hop=book.worksheets.find(s=>/Hop/.test(s.name)&&!s.name.endsWith("_逐跳")),cpet=sheet(book,"CPET 心肺运动测试"),conditions=book.getWorksheet("测试条件");
  assert.equal(hop.getCell(3,col(hop,"inputMode")).value,"设备汇总");assert.equal(cpet.getCell(3,col(cpet,"phase")).value,"峰值");
  assert.match(hop.getCell(3,col(hop,"inputMode")).dataValidation.formulae[0],/设备汇总,逐跳/);
  for(let i=3;i<=conditions.rowCount;i++){const key=conditions.getCell(i,col(conditions,"fieldId")).value;if(key==="cmjConfig.definition")assert.equal(conditions.getCell(i,col(conditions,"value")).value,"总力");if(key==="data.cpet.modality")set(conditions,i,"value","功率车");}
  set(hop,3,"summary.rsi",2);set(cpet,3,"vo2",50);const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.entries[0].record.data.cpet.modality,"cycle");assert.equal(parsed.entries[0].record.data.hop.trials[0].inputMode,"summary");
 });
 await test("Hop summary keeps inactive supplied jumps without interpreting them as another test",async()=>{
  const r=seed(["hop"]);r.data.hop.inputMode="summary";r.data.hop.summary.rsi=1.8;r.data.hop.jumps=[{id:"raw1",height:30,contactTimeMs:150}];
  const parsed=await X.readTemplate((await X.createTemplate({records:[r],prefill:true})).bytes);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.entries[0].record.data.hop.trials[0].summary.rsi,1.8);assert.equal(parsed.entries[0].record.data.hop.trials[0].jumps[0].height,30);
 });
 await test("plan order, inherited training context and existing comparability are retained",async()=>{
  const r=seed(["cmj","imtp"]);r.testPlanSnapshot={id:"plan_excel",name:"力量先测",testIds:["imtp","cmj"]};r.trainingContext.weeklySchedule="周一力量，周三专项";r.dsi.confirmed=true;r.impulseConfig.confirmed=true;r.data.cmj[0].height=30;
  const {book}=await workbook([r],true);assert.equal(book.worksheets.find(s=>s.name.startsWith("01_")).name,"01_IMTP");set(sheet(book,"CMJ"),3,"height",32);
  const parsed=await parse(book);assert.deepEqual(parsed.errors,[]);const p=review(parsed,[r],[r]),updated=X.apply(p,{[r.recordId]:{projects:{cmj:"replace"}}}).records[0];assert.equal(updated.dsi.confirmed,true);assert.equal(updated.impulseConfig.confirmed,true);
  assert.equal(X.apply(review(parsed,[r])).records[0].trainingContext.weeklySchedule,r.trainingContext.weeklySchedule);
 });
 await test("missing measurement side or unit is rejected with a cell address",async()=>{
  const r=seed(["mb","iso"]);M.setIsoDirectionSelection(r,[M.isoRows()[0].id]);const {book}=await workbook([r]);const mb=sheet(book,"药球反手投掷"),iso=sheet(book,"各方位等长力量");set(mb,3,"distance",5);set(mb,3,"side",null);set(iso,3,"center",100);set(iso,3,"unit",null);
  const parsed=await parse(book);assert.ok(parsed.errors.some(e=>/侧别/.test(e.message)&&e.address));assert.ok(parsed.errors.some(e=>/力单位/.test(e.message)&&e.address));
 });
 const dir=path.join(__dirname,"../output/excel-native");
 if(process.argv.includes("--prepare-native")){
  fs.mkdirSync(dir,{recursive:true});const nativeSeed=seed(["cmj","imtp","hop","fms","iso","cpet"]);M.setIsoDirectionSelection(nativeSeed,[M.isoRows()[0].id]);
  fs.writeFileSync(path.join(dir,"template.xlsx"),Buffer.from((await X.createTemplate({records:[nativeSeed]})).bytes));fs.writeFileSync(path.join(dir,"seed.json"),JSON.stringify(nativeSeed,null,2));
 }
 if(process.argv.includes("--verify-native")){
  await test("native Microsoft Excel save can be parsed and measured values match",async()=>{
   const original=JSON.parse(fs.readFileSync(path.join(dir,"native-seed.json"),"utf8"));const parsed=await X.readTemplate(fs.readFileSync(path.join(dir,"excel-saved.xlsx")));assert.deepEqual(parsed.errors,[]);
   const result=X.apply(review(parsed,[original])).records[0];assert.equal(result.data.cmj[0].height,37.25);assert.equal(result.data.imtp[0].peakForce,2450);assert.equal(result.data.fms[0].score,0);assert.equal(result.athlete.mass,72.5);assert.equal(result.data.cpet.vo2,4.2);
  });
 }
 console.log(`${passed} Excel model checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
