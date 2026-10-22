"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),arg=(key,fallback)=>process.argv.find(a=>a.startsWith(key+"="))?.slice(key.length+1)||fallback;
const dataFile=arg("--data",""),libraryFile=arg("--library",""),out=path.resolve(arg("--out",path.join(root,"output/playwright/radar-layout-compact")));
function inputs(){
 if(dataFile){assert.ok(libraryFile,"--data requires --library to preserve the selected evaluation scheme");return{data:JSON.parse(fs.readFileSync(path.resolve(dataFile))),library:JSON.parse(fs.readFileSync(path.resolve(libraryFile)))};}
 const c=require("./helpers/longitudinal-fixture.cjs").context(),M=c.RingsideModel,records=[0,1].map(i=>{
  const r=M.sampleRecord();r.demo=false;r.athleteId="radar-layout-athlete";r.recordId="radar-layout-"+i;r.athlete.name="雷达布局验收";r.athlete.date="2026-0"+(i+1)+"-01";
  r.data.iso=M.isoRows();for(const row of r.data.iso)Object.assign(row,{left:80+i,right:90+i,center:85+i,target:100});M.setIsoDirectionSelection(r,r.data.iso.map(row=>row.id));return r;
 }),profile=c.RingsideEvaluation.create(records.at(-1),"布局验收方案");records.forEach(r=>r.evaluationProfileId=profile.id);
 return{data:{records},library:{evaluationProfiles:[profile],catalog:M.mergeCatalog(null,records.at(-1))}};
}
const {data,library}=inputs(),records=data.records.filter(r=>r.athleteId===data.records[0].athleteId),profile=library.evaluationProfiles.find(p=>p.id===records[0].evaluationProfileId);
const modules=["calc","scoring","fvp","sprint-fvp","sprint-elasticity","sprint-fvp-confidence","sources","cpet-reference","iso-reference","definitions","tests","generic-report","model","evaluation","interventions","viz","report","result-display","longitudinal","longitudinal-view","horizontal-view"];
const styles=["ringside.css","ringside-workflow.css","ringside-report-refinement.css","ringside-longitudinal.css","ringside-horizontal.css"],hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out,{recursive:true});const result={runnerSha256:hash(__filename),sourceHashes:Object.fromEntries([...modules.map(n=>"ringside-"+n+".js"),...styles,"ringside-shell.html","ringside-pdf.js"].map(n=>[n,hash(path.join(root,"src",n))])),fixture:dataFile?"supplied records":"synthetic",dataSha256:dataFile?hash(dataFile):null,checks:[],layouts:[],images:[],errors:[],pass:false};
(async()=>{
 const browser=await chromium.launch({channel:"chrome"}),context=await browser.newContext({offline:true,viewport:{width:1440,height:1100}}),page=await context.newPage();page.on("pageerror",e=>result.errors.push(e.message));
 try{
  await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><body><main id="fixture" style="width:calc(100% - 40px);max-width:1100px;margin:20px auto;container-type:inline-size"></main></body></html>');
  for(const file of styles)await page.addStyleTag({path:path.join(root,"src",file)});
  for(const name of modules)await page.addScriptTag({path:path.join(root,"src/ringside-"+name+".js")});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,"src/ringside-pdf.js"),"utf8").replace("const CSS = `","const CSS = root.__radarTestPrintCSS = `")});
  await page.evaluate(({records,profile,catalog,shell})=>{
   window.radarTestRecords=records;window.radarTestOriginal=JSON.stringify(records);window.radarTestModel=RingsideLongitudinal.build(records,{profile,catalog,mode:"mean"});
   window.radarTestReport=RingsideReport.build(RingsideEvaluation.resolve(records.at(-1),profile),{catalog});
   const parsed=new DOMParser().parseFromString(shell,"text/html");window.radarTestShell=parsed.querySelector(".summary-grid").outerHTML;
   window.drawRadarTest=(kind,print=false,withAux=false)=>{
    const host=document.querySelector("#fixture");host.removeAttribute("data-longitudinal");host.removeAttribute("data-horizontal");host.className=print?"ringside-pdf-document":"";host.style.width=print?"703px":"calc(100% - 40px)";host.innerHTML=radarTestShell+'<div id="testDetails"></div>';
    document.querySelector("#radarPrintCSS")?.remove();if(print){const style=document.createElement("style");style.id="radarPrintCSS";style.textContent=__radarTestPrintCSS;document.head.append(style);}
    if(kind==="personal"){
     host.querySelector("#bodyChart").innerHTML=RingsideViz.body(radarTestReport.stats.signals.regions);
     host.querySelector("#screenItems").innerHTML='<div class="screen-item"><h4>已测项目</h4><p>保留个人筛查说明。</p></div>';
     host.querySelector("#radarChart").innerHTML=RingsideViz.radar(radarTestReport.stats.axes);
     host.querySelector("#directionMetrics").innerHTML=withAux?RingsideReport.overview(radarTestReport):"";
     if(withAux&&!host.querySelector("#directionMetrics").children.length)host.querySelector("#directionMetrics").innerHTML='<div class="aux-metric">能力小卡<strong>保留</strong></div>';
     const detail=new DOMParser().parseFromString(RingsideReport.render(radarTestReport),"text/html").querySelector("#detail-iso");host.querySelector("#testDetails").append(detail);RingsideReport.layoutCharts(host,{print});
    }else{
     host.dataset[kind]="true";const view=RingsideLongitudinalView.render(radarTestModel);
     host.querySelector("#bodyChart").innerHTML=view.body;host.querySelector("#radarChart").innerHTML=view.overview;
     const detail=new DOMParser().parseFromString(view.details,"text/html").querySelector("#detail-iso");host.querySelector("#testDetails").append(detail);
     if(print){host.querySelector(".screen-layout").classList.add("longitudinal-screen-layout");host.querySelector(".body-art").classList.add("longitudinal-risk-chart");}
     if(kind==="horizontal"){host.querySelectorAll("[data-longitudinal-chart]").forEach(node=>{node.classList.add("horizontal-curve");node.dataset.horizontalCurve=node.dataset.longitudinalChart;node.removeAttribute("data-longitudinal-chart");});RingsideHorizontalView.layout(host,{print});}
     else RingsideLongitudinalView.layout(host,{print});
    }
   };
  },{records,profile,catalog:library.catalog,shell:fs.readFileSync(path.join(root,"src/ringside-shell.html"),"utf8")});
  const counts=await page.evaluate(()=>({risk:radarTestModel.risk.axes.length,overview:radarTestModel.overview.axes.length,iso:radarTestReport.isoRadar.axes.length}));assert.deepEqual(counts,{risk:18,overview:6,iso:10});result.axes=counts;
  for(const kind of ["personal","longitudinal","horizontal"])for(const scenario of [{id:"desktop",width:1440,print:false},{id:"mobile",width:390,print:false},{id:"print",width:1440,print:true}]){
   await page.setViewportSize({width:scenario.width,height:1100});await page.evaluate(({kind,print})=>drawRadarTest(kind,print),{kind,print:scenario.print});
   if(kind==="personal"){assert.equal(await page.locator("#fixture #bodyChart svg").count(),1,"personal screening chart remains present");assert.equal(await page.locator("#fixture #radarChart svg").count(),1,"personal performance radar remains present");}
   const geometry=await page.evaluate(()=>{
    const rect=n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};},host=document.querySelector("#fixture"),cards=[...host.querySelectorAll(".summary-grid>.card")].map(rect),svgs=[...host.querySelectorAll("#bodyChart svg,#radarChart svg,#detail-iso .chart-wrap svg")].map(svg=>{
     const vb=svg.viewBox.baseVal,texts=[...svg.querySelectorAll("text")],labels=[...svg.querySelectorAll("[data-longitudinal-axis-label]")],b=n=>{const r=n.getBBox();return{x:r.x,y:r.y,w:r.width,h:r.height};},overlaps=[];
     for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){if(labels[i].dataset.longitudinalAxisLabel===labels[j].dataset.longitudinalAxisLabel)continue;const a=b(labels[i]),c=b(labels[j]);if(a.x<c.x+c.w&&a.x+a.w>c.x&&a.y<c.y+c.h&&a.y+a.h>c.y)overlaps.push([labels[i].textContent,labels[j].textContent]);}
     return{title:svg.getAttribute("aria-label"),box:rect(svg),viewBox:[vb.width,vb.height],labels:labels.map(n=>n.dataset.longitudinalAxisLabel),outside:texts.filter(n=>{const r=b(n);return r.x<vb.x-.5||r.y<vb.y-.5||r.x+r.w>vb.x+vb.width+.5||r.y+r.h>vb.y+vb.height+.5;}).map(n=>n.textContent),overlaps};
    });return{cards,svgs,auxDisplay:getComputedStyle(host.querySelector("#directionMetrics")).display,overflow:document.documentElement.scrollWidth>innerWidth+1,unchanged:JSON.stringify(radarTestRecords)===radarTestOriginal};
   });
   result.layouts.push({kind,scenario:scenario.id,...geometry});assert.equal(geometry.overflow,false);assert.equal(geometry.unchanged,true);assert.equal(geometry.auxDisplay,"none");
   for(const chart of geometry.svgs){assert.deepEqual(chart.outside,[],kind+" "+scenario.id+" "+chart.title);assert.deepEqual(chart.overlaps,[],kind+" "+scenario.id+" "+chart.title);}
   const iso=geometry.svgs.find(s=>s.title.includes("力量"));assert.ok(iso);assert.ok(iso.viewBox[1]<=330);
   if(kind!=="personal"){const [risk,overview]=geometry.svgs;assert.equal(risk.viewBox[1],overview.viewBox[1]);assert.ok(Math.abs(risk.box.height-overview.box.height)<1);if(Math.abs(geometry.cards[0].y-geometry.cards[1].y)<1)assert.ok(Math.abs(risk.box.y-overview.box.y)<.5,"side-by-side radars share the same top and center");assert.equal(new Set(risk.labels).size,18);assert.equal(new Set(iso.labels).size,10);}
   const name=kind+"-"+scenario.id,file=path.join(out,name+".png");await page.locator("#fixture .summary-grid").screenshot({path:file});result.images.push({path:path.relative(root,file),sha256:hash(file)});result.checks.push(name);console.log("PASS",name);
  }
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>drawRadarTest("personal",false,true));assert.ok(await page.locator("#directionMetrics").isVisible());assert.ok(await page.locator("#directionMetrics").evaluate(n=>n.children.length>0));result.checks.push("personal-existing-capability-cards-retained");
  assert.deepEqual(result.errors,[]);result.pass=true;
 }catch(e){result.failure=e.stack;process.exitCode=1;console.error(e.stack);}
 finally{await context.close();await browser.close();fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
