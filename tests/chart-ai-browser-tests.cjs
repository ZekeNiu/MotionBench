"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const { chartFixture } = require("./helpers/chart-ai-fixture.cjs");
const root = path.resolve(__dirname,".."), out = path.join(root,"output/playwright/chart-ai");
const baseline = "output/backups/chart-ai-pre-implementation-20261007/Ringside_Boxing_Assessment.html";
const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { sourceHash:digest(path.join(root,"Ringside_Boxing_Assessment.html")), baselineHash:digest(path.join(root,baseline)), layouts:[], images:[], checks:[], errors:[], network:[] };
const scenes = [["#detail-fms","fms"],["#detail-iso","isometric"],["#detail-imtp","imtp"],["#detail-lactate","lactate"],[".test-block:has(.speed-detail)","speed"],["#lvp-upper","lvp"]];
async function geometry(page, width, scenario) {
  const figures = await page.locator("[data-chart-kind]").evaluateAll(nodes=>nodes.map(n=>{
    const svg = n.querySelector("svg"), box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const labels = [...svg.querySelectorAll("text")].filter(t=>{const b=t.getBBox(); return b.x<-.5 || b.y<-.5 || b.x+b.width>vb.width+.5 || b.y+b.height>vb.height+.5;}).map(t=>t.textContent);
    const main = [...n.closest(".detail-pair").querySelectorAll(":scope > .detail-data > .table-wrap")].map(t=>t.getBoundingClientRect());
    return {kind:n.dataset.chartKind,width:box.width,height:box.height,viewWidth:vb.width,viewHeight:vb.height,labelsOutside:labels,
      tableHeight: main.length ? Math.max(...main.map(r=>r.bottom))-Math.min(...main.map(r=>r.top)):0};
  }));
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  result.layouts.push({width,scenario,figures,overflow});
  assert.ok(!overflow, `${scenario}/${width}: horizontal overflow`);
  for (const f of figures) {
    assert.ok(Math.abs(f.width/f.height-f.viewWidth/f.viewHeight)<.01, `${f.kind}: SVG stretched`);
    assert.deepEqual(f.labelsOutside,[],`${scenario}/${width}/${f.kind}: labels outside viewBox`);
  }
}
async function shot(page, version, selector, name) {
  await page.locator(selector).evaluate(n=>window.scrollTo({top:n.getBoundingClientRect().top+scrollY-110,behavior:"instant"}));
  await page.waitForTimeout(180);
  const file=path.join(out,version,name+".png");fs.mkdirSync(path.dirname(file),{recursive:true});
  await page.screenshot({path:file});result.images.push({version,name,path:path.relative(root,file),sha256:digest(file)});
}
(async()=>{
  const browser=await chromium.launch();
  try {
    for (const [version,file] of [["before",baseline],["after","Ringside_Boxing_Assessment.html"]]) {
      const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},locale:"zh-CN",timezoneId:"Asia/Shanghai"});
      const page=await context.newPage();page.setDefaultTimeout(10000);
      page.on("pageerror",e=>result.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});
      await page.clock.setFixedTime(new Date("2026-10-06T15:43:00Z"));
      await page.goto(pathToFileURL(path.join(root,file)).href);await page.waitForFunction(()=>window.App?.getState);
      await page.evaluate(async()=>{await App.ready;if(!App.getState())await App.loadDemo();});
      await page.evaluate(chartFixture);
      for(const width of [1920,1440,1280,900,390]) {
        await page.setViewportSize({width,height:width===390?844:1000});await page.waitForTimeout(380);
        if(version==="after")await geometry(page,width,"complete");
        if([1440,390].includes(width))for(const [selector,name] of scenes)await shot(page,version,selector,name+"-"+width);
      }
      if(version==="after") {
        await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(300);
        const before=await page.locator("#detail-imtp svg").getAttribute("viewBox");
        await page.locator("#detail-imtp .attempt-details summary").click();await page.waitForTimeout(250);
        assert.equal(await page.locator("#detail-imtp svg").getAttribute("viewBox"),before,"raw trial expansion must not change the plot height");result.checks.push("raw-trials-excluded");
        const basis=await page.evaluate(()=>RingsideModel.fingerprint(App.getState()));
        const control=page.getByRole("combobox",{name:"IMTP 纵轴"});await control.selectOption("force");
        await page.waitForFunction(()=>document.querySelector("#detail-imtp svg")?.textContent.includes("力 / N"));
        assert.equal(await page.evaluate(()=>RingsideModel.fingerprint(App.getState())),basis);
        await page.reload();await page.evaluate(()=>App.ready);await page.waitForFunction(()=>App.getState());
        assert.equal(await page.evaluate(()=>App.getState().views.imtp.yAxis),"force");
        await page.getByRole("combobox",{name:"IMTP 纵轴"}).selectOption("percent");
        await page.locator("#aggMode").selectOption("mean");await page.waitForTimeout(350);
        const mean=await page.locator('[data-force-time="100"]').getAttribute("data-force-percent");assert.ok(Math.abs(Number(mean)-(800/2800+700/2400)/2*100)<1e-8);
        result.checks.push("axis-save-reload-fingerprint-mean");
        await page.evaluate(()=>{const r=App.getState();r.athlete.name="很长的运动员姓名与编号用于完整换行检查".repeat(3);r.data.fms[0].notes="备注保留完整内容。".repeat(30);r.data.iso=Array.from({length:30},(_,i)=>({...r.data.iso[i%r.data.iso.length],id:"long"+i}));App.renderReport();});
        await page.waitForTimeout(200);await geometry(page,1440,"long");
        assert.ok((await page.locator('#detail-iso svg').boundingBox()).height<=440.1);result.checks.push("long-table-clamped");
        for(const width of [390,900]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);await geometry(page,width,"long");}
        await page.evaluate(()=>{App.getState().data.imtp=[{id:"peak",peakForce:2800,timePoints:[]}];App.renderReport();});
        await page.waitForTimeout(200);assert.ok((await page.locator('#detail-imtp svg').boundingBox()).height<=211);result.checks.push("peak-only-compact");
        await page.evaluate(()=>{const r=App.getState();r.definitions.forEach(d=>{d.referenceEnabled=false;});r.data.fms[0].pain=true;r.data.imtp=[{id:"conflict",peakForce:1000,timePoints:[{id:"x",timeMs:100,force:1200}]}];App.renderReport();});
        assert.doesNotMatch(await page.locator("#reportView").innerText(),/未启用评价标准|未设等级区间/);
        assert.match(await page.locator("#detail-fms").innerText(),/疼痛/);
        assert.ok(await page.evaluate(()=>App.stats().qualityIssues.length>0));
        assert.equal(await page.locator('#detail-imtp th').filter({hasText:/^评价$/}).count(),0);result.checks.push("configuration-hidden-pain-conflicts-retained");
      }
      await context.close();
    }
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
    console.log("PASS chart coordination, five widths, original data and display preference");
  }catch(e){result.pass=false;result.failure=e.stack;process.exitCode=1;console.error(e.message);}
  finally{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"review.json"),JSON.stringify(result,null,2));await browser.close();}
})();
