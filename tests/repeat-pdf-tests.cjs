"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs");
const {spawn}=require("node:child_process");
const {argument,artifactDirectory,ready,showReport,downloadFromReport}=require("./helpers/pdf-browser.cjs");
const root=path.resolve(__dirname,".."),out=artifactDirectory(root,"output/pdf/v2.17.2-work/repeat-pdf"),source=path.join(root,"MotionBench.html");
fs.mkdirSync(out,{recursive:true});
const hash=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const explicitFixture=argument("fixture-dir"),fixtureDir=path.resolve(root,explicitFixture||path.join(out,"repeat-fixture"));
async function prepareFixture(){
 const review=path.join(fixtureDir,"review.json"),record=path.join(fixtureDir,"record.json");
 let usable=false;
 if(fs.existsSync(review)&&fs.existsSync(record)){const old=JSON.parse(fs.readFileSync(review));usable=old.pass===true&&old.sourceHash===hash(source)&&Array.isArray(old.downloads)&&old.downloads.some(item=>path.basename(item.path)==="record.json"&&item.sha256===hash(record));}
 if(!usable&&!explicitFixture){
  console.log("PREPARE UI-created repeat fixture for the current HTML source");
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,"tests/repeat-browser-tests.cjs"),"--artifact-dir",fixtureDir],{cwd:root,stdio:"inherit",windowsHide:true});child.once("error",reject);child.once("close",code=>code===0?resolve():reject(Error("Repeat fixture producer failed with exit "+code)));});
 }
 assert.ok(fs.existsSync(review)&&fs.existsSync(record),"Repeat fixture is missing: run tests/repeat-browser-tests.cjs --artifact-dir <fixture-dir> first");
 const flow=JSON.parse(fs.readFileSync(review,"utf8"));
 assert.ok(flow.pass,"Repeat fixture must come from a passing UI workflow");assert.equal(flow.sourceHash,hash(source),"Repeat fixture HTML source hash must match this build");
 const saved=flow.downloads.find(item=>path.basename(item.path)==="record.json");assert.ok(saved,"Producer must record its actual JSON download");assert.equal(saved.sha256,hash(record),"Repeat JSON must match the producer download hash");
 return {flow,fixture:JSON.parse(fs.readFileSync(record,"utf8"))};
}
(async()=>{
const {flow,fixture}=await prepareFixture();
// Start with the actual UI-created record, then add explicit stress rows for pagination.
fixture.record.data.cmj=Array.from({length:60},(_,i)=>({id:"pdf-jump-"+i,height:38+2*(i%3),notes:"CMJ-RAW-"+String(i+1).padStart(3,"0")}));
fixture.record.data.imtp=[0,1,2].map(i=>({id:"pdf-force-"+i,peakForce:2000+i*100,baselineForce:100,timePoints:[{id:"point-"+i,timeMs:100,force:600+i*100}],notes:"IMTP-RAW-"+i}));
fixture.record.data.mb=["D","ND"].flatMap((side,s)=>[0,1,2].map(i=>({id:"pdf-ball-"+side+i,side,distance:4+s+i*.2,notes:"BALL-RAW-"+side+i})));
fixture.record.narrative={text:"教练保留正文：继续按既定计划执行。",html:"<p>教练保留正文：继续按既定计划执行。</p>",origin:"manual",revision:1,basis:"manual"};
const fixturePath=path.join(out,"repeat-pagination-fixture.json");fs.writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
const result={sourceHash:hash(source),fixtureHash:hash(fixturePath),producerSourceHash:flow.sourceHash,producerFixtureDir:fixtureDir,syntheticPaginationRows:true,cases:[],pass:false};
 for(const config of [{id:"repeat-collapsed",width:1440,open:false},{id:"repeat-expanded-mobile",width:390,open:true}]){
  const browser=await chromium.launch({channel:"chrome",headless:true}),ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:config.width,height:1000},locale:"zh-CN"}),page=await ctx.newPage();
  const item={...config,errors:[],network:[],pass:false};
  page.on("pageerror",e=>item.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))item.network.push(r.url());});
  try{
   await page.goto(pathToFileURL(source).href);await ready(page);
   await page.evaluate(payload=>App.importPayload(payload),fixture);await showReport(page);
   assert.equal(await page.evaluate(()=>App.getState().data.cmj.length),60);
   await page.evaluate(open=>{document.querySelectorAll("[data-raw-trials]").forEach(n=>n.open=open);window.__repeatPages=[];const render=window.html2canvas;window.html2canvas=async(node,opts)=>{window.__repeatPages.push({text:node.innerText,tables:[...node.querySelectorAll("table")].map(t=>({head:t.tHead?.innerText||"",rows:[...t.querySelectorAll("tbody tr")].map(r=>r.innerText)}))});return render(node,opts);};},config.open);
   const before=await page.evaluate(()=>({data:JSON.stringify(App.getState()),open:[...document.querySelectorAll("[data-raw-trials]")].map(n=>n.open)}));
   const dl=await downloadFromReport(page,"downloadPDF"),dest=path.join(out,config.id+".pdf");await dl.saveAs(dest);await page.waitForFunction(()=>!document.querySelector("#reportExportMenu [data-pdf-action]").disabled);
   const after=await page.evaluate(()=>({data:JSON.stringify(App.getState()),open:[...document.querySelectorAll("[data-raw-trials]")].map(n=>n.open),diagnostics:RingsidePDF.lastDiagnostics,pages:window.__repeatPages,stages:document.querySelectorAll(".ringside-pdf-stage").length}));
   assert.equal(after.data,before.data);assert.deepEqual(after.open,before.open);assert.equal(after.stages,0);
   assert.equal(after.diagnostics.status,"complete");for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(after.diagnostics[key],[]);
   const text=after.pages.map(p=>p.text).join("\n"),appendix=text.indexOf("附录 · 原始试次");assert.ok(appendix>text.indexOf("教练保留正文"));assert.ok(text.indexOf("均值 ± SD")>=0 && text.indexOf("均值 ± SD")<appendix);
   for(const marker of [...Array.from({length:60},(_,i)=>"CMJ-RAW-"+String(i+1).padStart(3,"0")),...Array.from({length:3},(_,i)=>"IMTP-RAW-"+i),...['D','ND'].flatMap(s=>[0,1,2].map(i=>"BALL-RAW-"+s+i))]){assert.equal(text.split(marker).length-1,1,marker);assert.ok(text.indexOf(marker)>appendix);}
   const continued=after.pages.flatMap((p,i)=>p.tables.filter(t=>t.rows.some(r=>r.includes("CMJ-RAW-"))).map(t=>({page:i+1,head:t.head,rows:t.rows.length})));assert.ok(new Set(continued.map(x=>x.page)).size>=2);assert.ok(continued.every(x=>x.head.includes("试次")&&x.head.includes("垂直跳跃高度")));
   assert.deepEqual(item.errors,[]);assert.deepEqual(item.network,[]);
   Object.assign(item,{pass:true,diagnostics:after.diagnostics,pages:after.pages,continued,pdfSha256:hash(dest)});console.log("PASS "+config.id+" "+after.pages.length+" pages");
  }catch(e){item.failure=e.stack;console.error(e.stack);process.exitCode=1;}
  finally{result.cases.push(item);fs.writeFileSync(path.join(out,"repeat-download-verification.json"),JSON.stringify(result,null,2));await browser.close();}
 }
 if(result.cases.every(c=>c.pass)){assert.deepEqual(result.cases[0].pages,result.cases[1].pages);result.foldStateIndependent=true;result.pass=true;}
 fs.writeFileSync(path.join(out,"repeat-download-verification.json"),JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
