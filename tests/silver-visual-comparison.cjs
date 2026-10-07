"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/playwright/silver-ui/comparison");
fs.mkdirSync(out,{recursive:true});
const current=path.join(root,"MotionBench.html"),baseline=path.join(root,"output/backups/silver-ai-sidebar-20261007/MotionBench.html");
const hash=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const fixture=JSON.parse(fs.readFileSync(path.join(root,"examples/three-trials.json")));
const record=fixture.record||fixture;
const result={sourceHash:hash(current),baselineHash:hash(baseline),fixtureHash:hash(path.join(root,"examples/three-trials.json")),checks:[],images:[],comparisons:[],errors:[],pass:false};
const scenes=[
  {id:"report",label:"报告首页 · 四张摘要卡片",width:1366,height:900},
  {id:"table",label:"测试结果 · 白底表格",width:1366,height:900},
  {id:"entry",label:"运动员与背景 · 原有表单排列",width:1366,height:900},
  {id:"plan",label:"本次测试计划 · 选中状态",width:1366,height:900},
  {id:"narrative",label:"解读编辑 · 按钮与文字层次",width:1366,height:900},
  {id:"settings",label:"本次评价设置 · 分类高亮",width:1366,height:900},
  {id:"mobile-report",label:"手机报告 · 390 × 667",width:390,height:667},
  {id:"mobile-sidebar",label:"手机侧栏 · 390 × 667",width:390,height:667},
  {id:"landscape-sidebar",label:"低矮横屏 · 844 × 390",width:844,height:390},
  {id:"mobile-table",label:"手机重复试次表格",width:390,height:844},
];
async function importRecord(page){
  await page.evaluate(()=>App.saveMenu());
  await page.locator("#importFile").setInputFiles({name:"comparison.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({schema:2,kind:"report",record}))});
  await page.waitForFunction(id=>App.getState().recordId===id,record.recordId);
  if(await page.locator("#saveModal").isVisible())await page.locator("#saveModal .close").click();
  await page.evaluate(()=>App.showReport());
  await page.locator("#toast").waitFor({state:"hidden"});
}
async function comparisonValues(page){
  return page.evaluate(()=>{
    const encode=x=>JSON.stringify(x,(k,v)=>v instanceof Set?[...v].sort():v instanceof Map?[...v.entries()]:v);
    const r=App.getState(),original=JSON.parse(JSON.stringify(r)),cases=[];
    for(const partial of [false,true]){
      if(partial){
        r.data.cmj[0].height="";
        r.data.iso[0].trials.forEach(t=>{t.right="";});
        r.data.iso[0].trials[0].painLeft=true;
      }
      for(const mode of ["best","mean"]){r.mode=mode;cases.push({id:(partial?"missing-pain":"complete-repeats")+"-"+mode,stats:encode(App.stats()),facts:encode(App.facts())});}
    }
    Object.assign(r,original);App.showReport();return cases;
  });
}
(async()=>{
  const browser=await chromium.launch({channel:"chrome"});
  try{
    let before;
    for(const [version,file] of [["before",baseline],["after",current]]){
      const context=await browser.newContext({viewport:{width:1366,height:900},offline:true,reducedMotion:"reduce",locale:"zh-CN",timezoneId:"Asia/Shanghai"});
      const page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",e=>result.errors.push(e.message));
      await page.clock.setFixedTime(new Date("2026-10-07T02:00:00Z"));
      await page.goto(pathToFileURL(file).href);await importRecord(page);
      const values=await comparisonValues(page);
      if(version==="before")before=values;
      else {assert.deepEqual(values,before);result.comparisons=values.map(c=>({case:c.id,statsSha256:createHash("sha256").update(c.stats).digest("hex"),factsSha256:createHash("sha256").update(c.facts).digest("hex"),equal:true}));}
      for(const scene of scenes){
        await page.setViewportSize({width:scene.width,height:scene.height});
        await page.evaluate(()=>{App.showReport(false);scrollTo({top:0,behavior:"instant"});});
        if(scene.id==="entry")await page.evaluate(()=>App.openEntry("athlete"));
        if(scene.id==="plan")await page.evaluate(()=>App.openEntry("plan"));
        if(scene.id==="narrative")await page.evaluate(()=>App.openEntry("narrative"));
        if(scene.id==="settings")await page.evaluate(()=>App.openSettings("lvp"));
        if(scene.id.includes("table"))await page.evaluate(()=>{
          const item=document.querySelector('#detail-iso');
          let node=item;while(node){if(node.matches('details'))node.open=true;node=node.parentElement;}
          scrollTo({top:scrollY+item.getBoundingClientRect().top-88,behavior:'instant'});
        });
        if(scene.id.includes("sidebar"))await page.locator('#sidebarToggle').click();
        await page.evaluate(()=>document.activeElement?.blur());
        await page.mouse.move(scene.width-5,5);await page.waitForTimeout(250);
        if(version==="after"){
          const style=await page.evaluate(()=>{
            const rows=[...document.querySelectorAll('.workspace-view:not([hidden]) tbody tr')].filter(n=>n.getClientRects().length);
            return {overflow:document.documentElement.scrollWidth>innerWidth+1,colors:[...new Set(rows.map(n=>getComputedStyle(n).backgroundColor))],cards:document.querySelectorAll('#microCards > .micro-card').length};
          });
          assert.equal(style.overflow,false,scene.id);assert.equal(style.cards,4);
          assert.ok(style.colors.every(x=>x==='rgb(255, 255, 255)'),JSON.stringify(style));
        }
        const dest=path.join(out,`${scene.id}-${version}.png`);await page.screenshot({path:dest});
        result.images.push({path:path.relative(root,dest).replaceAll('\\','/'),sha256:hash(dest),scene:scene.id,version});
        if(await page.locator('#sidebarScrim').isVisible())await page.evaluate(()=>App.toggleSidebar(false));
      }
      await context.close();
    }
    assert.deepEqual(result.errors,[]);result.checks.push('same-data-best-mean-complete-missing-pain-results-and-ai-facts-unchanged','four-cards-and-no-horizontal-page-overflow','white-data-rows-across-report-and-entry');
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MotionBench 2.7.1 · 前后对比</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#262a30;font:15px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1600px;margin:auto;padding:40px 28px}h1{margin:0;font-size:28px;font-weight:650}p{color:#636b76}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}a{color:#365b7a}nav a{padding:6px 12px;border:1px solid #dce2e7;border-radius:7px;background:white;text-decoration:none}section{padding:24px 0;border-top:1px solid #dde2e7}h2{font-size:19px;font-weight:600}figure{margin:0;min-width:0}figcaption{color:#636b76;padding:10px 0}img{display:block;max-width:100%;height:auto;border:1px solid #dde2e7;border-radius:8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.phone img{max-width:390px}@media(max-width:800px){.pair{grid-template-columns:1fr}main{padding:24px 16px}}</style><main><h1>MotionBench · 银灰精修</h1><p>同一份三试次示例，原版 2.7.0 与新版 2.7.1。点击图片查看原尺寸。</p><nav>${scenes.map(s=>`<a href="#${s.id}">${s.label.split(' · ')[0]}</a>`).join('')}</nav>${scenes.map(s=>`<section id="${s.id}"><h2>${s.label}</h2><div class="pair ${s.width<500?'phone':''}">${['before','after'].map(v=>`<figure><figcaption>${v==='before'?'原版 · 2.7.0':'新版 · 2.7.1'}</figcaption><a href="${s.id}-${v}.png"><img loading="lazy" src="${s.id}-${v}.png" alt="${s.label} ${v==='before'?'原版':'新版'}"></a></figure>`).join('')}</div></section>`).join('')}</main></html>`;
    fs.writeFileSync(path.join(out,'index.html'),html);result.pass=true;
    console.log('PASS',result.comparisons.length,'identical data comparisons and',scenes.length,'visual pairs');
  }catch(e){result.failure=e.stack;process.exitCode=1;console.error(e.stack);}
  finally{fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(result,null,2));await browser.close();}
})();
