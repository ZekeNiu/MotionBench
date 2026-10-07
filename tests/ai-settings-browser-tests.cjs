"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawn}=require("node:child_process"),{once}=require("node:events"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright/ai-settings");
const secret="synthetic-browser-v211-credential",replacement="synthetic-browser-v211-replacement";
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),serverHash:createHash("sha256").update(fs.readFileSync(path.join(root,"scripts/serve.py"))).digest("hex"),credentialStoreHash:createHash("sha256").update(fs.readFileSync(path.join(root,"scripts/ai_credentials.py"))).digest("hex"),synthetic:true,pass:false,cases:[]};
fs.mkdirSync(out,{recursive:true});
async function start(directory,port=0){
 const child=spawn("python",["-B",path.join(root,"tests/helpers/ai-launcher-fixture.py"),"--config-dir",directory,"--port",String(port)],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
 let stdout="",stderr="";
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Synthetic launcher did not start: "+stderr)),10000);
  child.stdout.on("data",chunk=>{stdout+=chunk.toString();const line=stdout.split(/\r?\n/)[0];if(stdout.includes("\n")){clearTimeout(timer);try{resolve(JSON.parse(line));}catch(error){reject(error);}}});
  child.stderr.on("data",chunk=>{stderr+=chunk.toString();});
  child.once("error",error=>{clearTimeout(timer);reject(error);});
  child.once("exit",code=>{clearTimeout(timer);reject(Error("Synthetic launcher exited "+code+": "+stderr));});
 });
 const value=await ready;return {child,port:value.port};
}
async function stop(server){if(!server||server.child.exitCode!==null)return;const closed=once(server.child,"exit");server.child.kill();await closed;}
async function run(channel){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"motionbench-ai-browser-"));
 const configDir=path.join(directory,"encrypted-config"),profile=path.join(directory,"browser");
 const item={channel,checks:[],errors:[],pass:false};let server,context;
 const protectedResponses=[],relayRequests=[];
 async function launch(userDirectory=profile,{prepare,waitForAI=true}={}){
  context=await chromium.launchPersistentContext(userDirectory,{channel,headless:true,viewport:{width:1440,height:1000}});
  const page=context.pages()[0]||await context.newPage();
  page.on("pageerror",error=>item.errors.push(error.message));
  page.on("dialog",dialog=>dialog.accept());
  page.on("request",request=>{if(request.url().endsWith("/api/relay"))relayRequests.push(request.postDataJSON());});
  page.on("response",response=>{if(response.url().includes("/api/"))protectedResponses.push(response.text().then(text=>!text.includes(secret)&&!text.includes(replacement)).catch(()=>true));});
  if(prepare)await prepare(page);
  await page.goto(`http://127.0.0.1:${server.port}/MotionBench.html`);
  assert.equal(await page.evaluate(()=>App.ready),true);
  if(waitForAI)await page.evaluate(()=>App.loadAISettings());
  return page;
 }
 try{
  server=await start(configDir);
  let releaseStatus,statusIntercepted;
  const statusGate=new Promise(resolve=>{releaseStatus=resolve;}),statusReady=new Promise(resolve=>{statusIntercepted=resolve;});
  let page=await launch(profile,{waitForAI:false,prepare:async page=>{
   let first=true;
   await page.route("**/api/ai-settings",async route=>{
    if(first&&route.request().postDataJSON().action==="status"){first=false;const response=await route.fetch();statusIntercepted();await statusGate;return route.fulfill({response});}
    return route.continue();
   });
  }});
  await statusReady;await page.evaluate(()=>App.openSettings("ai"));
  await page.locator("#apiURL").fill("https://ai-test.invalid/v1/chat/completions");await page.locator("#apiKey").fill(secret);
  releaseStatus();await page.waitForFunction(()=>!document.querySelector("#saveAISettingsButton").disabled);
  assert.equal(await page.locator("#apiKey").inputValue(),secret);
  assert.equal(await page.locator("#apiURL").inputValue(),"https://ai-test.invalid/v1/chat/completions");
  await page.unroute("**/api/ai-settings");
  item.checks.push("typing-before-initial-config-load-preserves-input-and-enables-save");
  await page.evaluate(()=>App.openSettings("references"));
  assert.equal(await page.locator("#settingsTitle").textContent(),"参考资料与方法");
  assert.ok(await page.locator(".source-reference a").count()>=17);
  assert.ok(!(await page.locator("#settingsContent").textContent()).includes("原表空档和边界保留"));
  assert.equal(await page.locator("#apiKey").count(),0);
  item.checks.push("independent-references-with-citations-and-data-before-any-record");
  await page.evaluate(()=>App.openSettings("ai"));
  await page.locator("#apiURL").fill("https://ai-test.invalid/v1/chat/completions");
  await page.locator("#apiKey").fill(secret);
  await page.locator("#saveAISettingsButton").click();
  await page.waitForFunction(()=>document.querySelector("#apiKey").value===""&&!document.querySelector("#saveAISettingsButton").disabled);
  assert.match(await page.locator("#aiConfigStatus").textContent(),/密钥已加密保存/);
  await page.locator("#modelButton").click();
  await page.waitForFunction(()=>document.querySelector("#apiModel").value==="chat-model");
  await page.locator("#saveAISettingsButton").click();
  await page.waitForFunction(()=>document.querySelector("#aiConfigStatus").textContent.includes("已加密保存")&&!document.querySelector("#saveAISettingsButton").disabled);
  assert.equal(await page.locator("#apiURL").inputValue(),"https://ai-test.invalid/v1");
  assert.equal(await page.locator("#apiKey").inputValue(),"");
  assert.ok(!fs.readFileSync(path.join(configDir,"ai-settings.dat")).includes(Buffer.from(secret)));
  let releaseModels,modelsIntercepted;
  const modelsGate=new Promise(resolve=>{releaseModels=resolve;}),modelsReady=new Promise(resolve=>{modelsIntercepted=resolve;});
  await page.route("**/api/relay",async route=>{if(route.request().postDataJSON().path==="/models"){const response=await route.fetch();modelsIntercepted();await modelsGate;return route.fulfill({response});}return route.continue();});
  await page.evaluate(()=>{window.__pendingModels=App.models();});await modelsReady;
  await page.evaluate(()=>{App.openSettings("references");App.openSettings("ai");});
  await page.locator("#apiModel").fill("manually-typed-model");releaseModels();await page.evaluate(()=>window.__pendingModels);
  assert.equal(await page.locator("#apiModel").inputValue(),"manually-typed-model");
  await page.unroute("**/api/relay");await page.locator("#apiModel").fill("chat-model");await page.locator("#saveAISettingsButton").click();
  await page.waitForFunction(()=>!document.querySelector("#saveAISettingsButton").disabled);
  item.checks.push("late-model-list-cannot-overwrite-new-settings-after-navigation");
  await page.evaluate(async()=>{await App.loadDemo();App.getState().narrative={text:"加密配置测试保留原稿",html:"<p>加密配置测试保留原稿</p>",revision:1};await App.saveNow();});
  item.checks.push("save-real-dpapi-read-models-clear-browser-key");
  const port=server.port;await context.close();context=null;await stop(server);server=await start(configDir,port);page=await launch();
  await page.evaluate(()=>App.openSettings("ai"));
  assert.equal(await page.locator("#apiKey").inputValue(),"");
  assert.equal(await page.locator("#apiModel").inputValue(),"chat-model");
  assert.equal(await page.locator("#apiURL").inputValue(),"https://ai-test.invalid/v1");
  await page.locator("#modelButton").click();await page.waitForFunction(()=>document.querySelector("#apiMessage").textContent.includes("已读取"));
  assert.equal(await page.evaluate(()=>App.getState().narrative.text),"加密配置测试保留原稿");
  await page.evaluate(()=>App.openEntry("narrative"));await page.locator("[data-ai-generate]").click();
  await page.locator("#previewModal.show").waitFor();assert.equal(await page.evaluate(()=>App.getState().narrative.text),"加密配置测试保留原稿");
  await page.locator("#applyDraftButton").click();assert.match(await page.evaluate(()=>App.getState().narrative.text),/分腿蹲/);
  assert.equal(await page.evaluate(()=>App.getState().previousNarrative.text),"加密配置测试保留原稿");
  item.checks.push("browser-and-launcher-restart-models-generate-preview-apply-without-key-entry");
  await page.evaluate(()=>App.openSettings("ai"));
  const artifacts=await page.evaluate(()=>({html:App.exportHTMLString(),json:JSON.stringify(App.reportPayload()),storage:JSON.stringify({...localStorage}),session:JSON.stringify({...sessionStorage})}));
  const status=await page.evaluate(()=>RingsideAISettings.status());assert.equal(Object.hasOwn(status,"key"),false);
  const downloadPromise=page.waitForEvent("download");await page.evaluate(()=>App.downloadLibrary());const download=await downloadPromise;
  const backup=await fs.promises.readFile(await download.path(),"utf8");
  for(const value of [...Object.values(artifacts).filter(value=>typeof value==="string"),backup,JSON.stringify(status)]){assert.ok(!value.includes(secret));assert.ok(!value.includes(replacement));}
  assert.ok(!artifacts.html.includes('id="motionbench-local-bootstrap"'));
  item.checks.push("actual-full-backup-json-html-storage-and-metadata-exclude-credentials");
  await page.evaluate(async()=>{const saved=await RingsideAISettings.status();await RingsideAISettings.save({base:saved.base,model:saved.model,key:"",expectedRevision:saved.revision});App.openEntry("narrative");});
  await page.locator("[data-ai-generate]").click();
  await page.waitForFunction(()=>document.querySelector("#aiProgress").dataset.state==="error",null,{timeout:10000});
  assert.match(await page.locator("#aiProgressDetail").textContent(),/409|配置.*变更|设置.*更新/);
  await page.evaluate(()=>App.openSettings("ai"));
  item.checks.push("changed-config-revision-shows-actionable-generation-error");
  await page.locator("#apiURL").fill("https://other-test.invalid");await page.locator("#saveAISettingsButton").click();
  await page.waitForFunction(()=>document.querySelector("#aiProgress").dataset.state==="error");
  assert.match(await page.locator("#aiProgressDetail").textContent(),/密钥/);
  assert.equal((await page.evaluate(()=>RingsideAISettings.status())).base,"https://ai-test.invalid/v1");
  let releaseSave,saveIntercepted;
  const saveGate=new Promise(resolve=>{releaseSave=resolve;}),saveReady=new Promise(resolve=>{saveIntercepted=resolve;});
  await page.route("**/api/ai-settings",async route=>{if(route.request().postDataJSON().action==="save"){const response=await route.fetch();saveIntercepted();await saveGate;return route.fulfill({response});}return route.continue();});
  await page.locator("#apiURL").fill("https://ai-test.invalid/v1");await page.locator("#apiKey").fill(replacement);await page.locator("#saveAISettingsButton").click();await saveReady;
  for(const field of ["#apiURL","#apiKey","#apiModel"])assert.equal(await page.locator(field).isDisabled(),true);
  releaseSave();
  await page.waitForFunction(()=>document.querySelector("#apiKey").value===""&&!document.querySelector("#saveAISettingsButton").disabled);
  await page.unroute("**/api/ai-settings");
  item.checks.push("save-in-flight-disables-inputs-until-acknowledged");
  item.checks.push("changed-address-requires-new-key-replacement-clears-input");
  for(const width of [1440,900,390]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(out,`${channel}-ai-${width}.png`),fullPage:true});
   await page.evaluate(()=>App.openSettings("references"));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(out,`${channel}-references-${width}.png`),fullPage:true});
   await page.evaluate(()=>App.openSettings("ai"));
  }
  item.checks.push("ai-and-reference-layout-desktop-tablet-mobile");
  await context.close();context=null;page=await launch(path.join(directory,"fresh-browser"));
  await page.evaluate(()=>App.openSettings("ai"));
  assert.equal(await page.locator("#apiKey").inputValue(),"");assert.equal((await page.evaluate(()=>RingsideAISettings.status())).hasKey,true);
  await page.locator("#modelButton").click();await page.waitForFunction(()=>document.querySelector("#apiMessage").textContent.includes("已读取"));
  item.checks.push("fresh-browser-profile-reuses-local-encrypted-config");
  await page.locator("#forgetAIKeyButton").click();await page.waitForFunction(()=>document.querySelector("#aiConfigStatus").textContent.includes("尚未保存密钥"));
  assert.equal((await page.evaluate(()=>RingsideAISettings.status())).hasKey,false);
  await page.reload();await page.evaluate(()=>App.ready);await page.evaluate(()=>App.loadAISettings());await page.evaluate(()=>App.openSettings("ai"));
  assert.equal(await page.locator("#apiKey").inputValue(),"");assert.match(await page.locator("#aiConfigStatus").textContent(),/尚未保存密钥/);
  item.checks.push("forget-persists-after-reload");
  assert.ok(relayRequests.length>=3);assert.ok(relayRequests.every(request=>!Object.hasOwn(request,"key")&&!Object.hasOwn(request,"base")&&typeof request.configRevision==="string"));
  assert.ok((await Promise.all(protectedResponses)).every(Boolean));assert.deepEqual(item.errors,[]);
  item.checks.push("server-responses-never-return-key-relay-requests-only-reference-config");
  item.pass=true;console.log("PASS",channel,item.checks.length,"encrypted AI workflows");
 }catch(error){item.failure=String(error.stack).replaceAll(secret,"[redacted]").replaceAll(replacement,"[redacted]");console.error(item.failure);process.exitCode=1;}
 finally{if(context)await context.close();await stop(server);result.cases.push(item);}
}
(async()=>{for(const channel of ["chrome","msedge"])await run(channel);result.pass=result.cases.every(item=>item.pass);fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));})().catch(error=>{console.error(error.message);process.exitCode=1;});
