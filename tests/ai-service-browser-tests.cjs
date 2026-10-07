"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{pathToFileURL}=require("node:url"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/ai/motionbench");
const secret="sk-synthetic-secret-for-browser-verification-only";
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),synthetic:true,checks:[],errors:[],pass:false};
fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:"chrome"});try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on("pageerror",e=>result.errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  assert.equal(await page.evaluate(()=>App.ready),true);
  await page.evaluate(()=>App.loadDemo());
  await page.evaluate(()=>{const r=App.getState();r.narrative={text:"保留教练原稿",html:"<p>保留教练原稿</p>",revision:1};App.openEntry("narrative");});
  await page.locator("[data-ai-generate]").click();
  assert.equal(await page.locator("#aiProgress").getAttribute("data-state"),"error");
  assert.match(await page.locator("#aiProgressDetail").textContent(),/密钥/);
  await page.locator("#apiURL").fill("https://ai-test.invalid/v1/chat/completions");await page.locator("#apiKey").fill(secret);await page.locator("#apiModel").fill("wrong-model");
  let mode="hold",held=[],calls=0;
  await page.route("https://ai-test.invalid/**",async route=>{
    if(route.request().url().endsWith("/models"))return route.fulfill({json:{data:[{id:"image-only"},{id:"chat-model"}]}});
    calls++;
    if(mode==="hold"){held.push(route);return;}
    if(mode==="401")return route.fulfill({status:401,json:{error:{message:"invalid token "+secret}}});
    if(mode==="nonjson")return route.fulfill({status:200,contentType:"text/html",body:"<html>Error</html>"});
    if(mode==="network")return route.abort("failed");
    if(mode==="long") { mode="success"; return route.fulfill({json:{choices:[{message:{content:("## 重复说明\n\n"+"这一段测试超长正文，应由模型重写而不是直接截掉内容。".repeat(10)+"\n\n").repeat(30)}}]}}); }
    return route.fulfill({json:{choices:[{message:{content:"## 综合判断\n\n依据相关指标安排训练，并用下次训练反应验证。\n\n周六分腿蹲 3 组 6 次，组间休息 2 分钟。"},finish_reason:mode==="truncated"?"length":"stop"}]}});
  });
  await page.locator("#modelButton").click();await page.waitForFunction(()=>!document.querySelector("#modelButton").disabled);
  assert.equal(await page.locator("#apiModel").inputValue(),"chat-model");result.checks.push("missing-config-persistent-status-model-list-selects-chat-and-normalizes-url");
  await page.evaluate(async()=>{await App.showReport();App.openEntry("narrative");});
  await page.locator("[data-ai-generate]").click();await page.waitForTimeout(1100);
  assert.equal(await page.locator("[data-ai-generate]").isDisabled(),true);
  assert.equal(await page.locator("[data-local-draft]").isDisabled(),true);
  assert.match(await page.locator("#aiProgressDetail").textContent(),/已等待 [1-9]/);
  await page.screenshot({path:path.join(out,"generating-desktop.png")});
  await page.locator("#aiCancelButton").click();assert.equal(await page.locator("#aiProgress").getAttribute("data-state"),"cancelled");
  assert.equal(await page.evaluate(()=>App.getState().narrative.text),"保留教练原稿");
  for(const r of held.splice(0))await r.fulfill({json:{choices:[{message:{content:"迟到的结果"}}]}}).catch(()=>{});
  assert.equal(await page.locator("#previewModal").isVisible(),false);result.checks.push("elapsed-progress-disable-duplicate-cancel-ignore-late-response");
  mode="401";await page.locator("#aiRetryButton").click();await page.waitForFunction(()=>document.querySelector("#aiProgress").dataset.state==="error");
  assert.match(await page.locator("#aiProgressDetail").textContent(),/401/);assert.ok(!(await page.locator("#aiProgressDetail").textContent()).includes(secret));
  await page.waitForTimeout(4000);assert.equal(await page.locator("#aiProgress").isVisible(),true);
  await page.screenshot({path:path.join(out,"failure-desktop.png")});result.checks.push("http-details-persist-after-toast-with-secret-redacted");
  for(const kind of ["nonjson","network","truncated"]){
    mode=kind;await page.locator("#aiRetryButton").click();await page.waitForFunction(()=>document.querySelector("#aiProgress").dataset.state==="error");
    assert.equal(await page.evaluate(()=>App.getState().narrative.text),"保留教练原稿");
  }
  result.checks.push("nonjson-network-cors-and-truncated-errors-preserve-original");
  const beforeShortening=calls;mode="long";await page.locator("#aiRetryButton").click();await page.locator("#previewModal.show").waitFor();
  assert.equal(calls-beforeShortening,2);assert.ok(await page.evaluate(()=>RingsidePDF.measureNarrative(document.querySelector('#aiPreview').innerHTML)<=2));
  await page.locator("#previewModal button.close").click();
  assert.equal(await page.evaluate(()=>App.getState().narrative.text),"保留教练原稿");result.checks.push("actual-a4-preflight-rewrites-long-draft-once-without-truncation");
  await page.evaluate(()=>{const native=setTimeout;window.setTimeout=(fn,ms,...args)=>native(fn,ms===300000?50:ms,...args);});
  mode="hold";await page.locator("[data-ai-generate]").click();await page.waitForFunction(()=>document.querySelector("#aiProgress").dataset.state==="error");
  assert.match(await page.locator("#aiProgressDetail").textContent(),/300 秒/);
  for(const r of held.splice(0))await r.abort().catch(()=>{});result.checks.push("timeout-distinct-from-user-cancellation");
  mode="success";await page.locator("#aiRetryButton").click();await page.locator("#previewModal.show").waitFor();
  assert.equal(await page.evaluate(()=>App.getState().narrative.text),"保留教练原稿");
  await page.locator("#previewModal button.close").click();await page.locator("#aiReviewButton").click();
  await page.locator("#aiPreview").fill("核对后的具体训练安排");await page.locator("#applyDraftButton").click();
  assert.equal(await page.evaluate(()=>App.getState().previousNarrative.text),"保留教练原稿");assert.equal(await page.evaluate(()=>App.getState().narrative.text),"核对后的具体训练安排");
  assert.equal(await page.locator("#aiProgress").getAttribute("data-state"),"applied");result.checks.push("retry-preview-reopen-edit-apply-preserves-previous-version");
  const exported=await page.evaluate(()=>({html:App.exportHTMLString(),storage:JSON.stringify({...localStorage}),session:JSON.stringify({...sessionStorage})}));
  for(const value of Object.values(exported))assert.ok(!value.includes(secret));result.checks.push("credential-absent-from-export-and-browser-storage");
  const frames=[];
  for(const width of [1920,1440,1280,900,390]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(120);
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,brand:document.querySelector('.brand').textContent}));
    assert.ok(!layout.overflow);assert.match(layout.brand,/MotionBench/);frames.push({width,...layout});
    if(width===390)await page.screenshot({path:path.join(out,"ai-mobile.png"),fullPage:true});
  }
  result.widths=frames;result.checks.push("five-widths-brand-and-ai-controls-without-page-overflow");
  assert.deepEqual(result.errors,[]);result.pass=true;console.log("PASS",result.checks.length,"AI service/browser workflows");
}catch(e){result.failure=e.stack;process.exitCode=1;console.error(e.message);}finally{
  fs.writeFileSync(path.join(out,"browser-results.json"),JSON.stringify(result,null,2));await browser.close();
}})();
