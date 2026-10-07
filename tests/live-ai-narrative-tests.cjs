"use strict";
// Live provider evidence. The key stays in the launching environment and isolated
// browser memory; neither request headers nor credentials enter saved evidence.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{createHash}=require("node:crypto"),{pathToFileURL}=require("node:url");
const {chromium}=require("./helpers/playwright.cjs"),{chartFixture}=require("./helpers/chart-ai-fixture.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"Ringside_Boxing_Assessment.html"),out=path.join(root,"output/ai/chart-ai");
const replay=process.env.RINGSIDE_AI_NARRATIVE_REPLAY ? JSON.parse(fs.readFileSync(process.env.RINGSIDE_AI_NARRATIVE_REPLAY,"utf8")) : null;
const key=replay ? "replay-no-key" : process.env.RINGSIDE_AI_KEY,service=process.env.RINGSIDE_AI_URL||"https://api.apikey.fan",model=process.env.RINGSIDE_AI_MODEL||"gpt-5.6-sol";
if(!key)throw Error("Set RINGSIDE_AI_KEY in the process environment");
const redact=v=>String(v).replaceAll(key,"[redacted]");
const runLabel=process.env.RINGSIDE_AI_RUN_LABEL||"live";
const result={sourceHash:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),service,model,cases:[],direct:null,qualityReviewed:false};
fs.mkdirSync(out,{recursive:true});
function save(){fs.writeFileSync(path.join(out,replay?"replay-results.json":runLabel+"-results.json"),redact(JSON.stringify(result,null,2)));}
function vendor(body){return new Promise(resolve=>{
  const child=spawn("python",["-c",`import json,os,sys,urllib.request,urllib.error
body=sys.stdin.buffer.read()
base=os.environ.get('RINGSIDE_AI_URL','https://api.apikey.fan').rstrip('/')
request=urllib.request.Request(base+'/v1/chat/completions',data=body,headers={'Authorization':'Bearer '+os.environ['RINGSIDE_AI_KEY'],'Content-Type':'application/json'})
try:
 with urllib.request.urlopen(request,timeout=175) as response: result={'status':response.status,'body':response.read().decode('utf-8')}
except urllib.error.HTTPError as e: result={'status':e.code,'body':e.read().decode('utf-8',errors='replace')}
except Exception as e: result={'status':504,'body':json.dumps({'error':type(e).__name__})}
sys.stdout.buffer.write(json.dumps(result,ensure_ascii=True).encode('utf-8'))`],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
  let data="";child.stdout.on("data",x=>data+=x);child.on("error",()=>resolve({status:504,body:'{"error":"transport failed"}'}));
  child.on("close",()=>{try{resolve(JSON.parse(data));}catch{resolve({status:504,body:'{"error":"invalid transport response"}'});}});
  child.stdin.end(JSON.stringify(body));
});}
async function setup(page,id){
  await page.goto(pathToFileURL(file).href);await page.evaluate(chartFixture);
  await page.evaluate(id=>{
    const r=App.getState();r.narrative={text:"验收前保留正文",html:"<p>验收前保留正文</p>",revision:1};
    if(["basketball-one-session","pain-partial","background-missing"].includes(id)){
      Object.keys(r.enabled).forEach(k=>r.enabled[k]=["fms","cmj","sj","imtp"].includes(k));
      r.athlete.sport="篮球";r.athlete.injury="";r.athlete.notes="周五没有体能训练时间";
      r.trainingContext={experienceYears:2,weeklySessions:1,equipment:"仅自重，没有杠铃、哑铃或药球",weeklySchedule:"周二、周四球场训练；周六一次体能训练，周日休息"};
      r.data.fms.forEach(x=>{x.score="";x.left="";x.right="";x.pain=false;x.notes="";});
      r.data.cmj=[{id:"cmj",height:25}];r.data.sj=[{id:"sj",height:23}];
      r.data.imtp=[{id:"partial",peakForce:2000,timePoints:[{id:"t150",timeMs:150,force:"",rfd:4321}]}];
    }
    if(id==="standards-disabled"){
      r.athlete.sport="中长跑";r.athlete.injury="";
      r.trainingContext={experienceYears:3,weeklySessions:1,equipment:"杠铃与跑道",weeklySchedule:"周二、周四专项间歇，周六一次力量训练"};
      r.definitions.forEach(d=>{d.referenceEnabled=false;});r.data.iso.forEach(x=>x.target="");r.balancePairs.forEach(x=>x.referenceEnabled=false);
    }
    if(id==="background-missing"){
      Object.assign(r.athlete,{age:"",sport:"",sportLevel:"",cycle:"",injury:"",notes:""});
      r.trainingContext={experienceYears:"",weeklySessions:"",equipment:"",weeklySchedule:""};r.definitions.forEach(d=>d.referenceEnabled=false);
    }
    if(id==="pain-partial"){
      r.athlete.injury="左膝下蹲时疼痛，原因尚未明确";r.data.fms[0].pain=true;r.data.fms[0].location="knee_l";
    }
    App.renderReport();App.openSettings("ai");
  },id);
  await page.locator("#apiURL").fill(service);await page.locator("#apiKey").fill(key);await page.locator("#apiModel").fill(model);
  await page.evaluate(()=>{App.showReport();App.openEntry("narrative");});
}
async function run(browser,id,bridge){
  const context=await browser.newContext({offline:!!replay,viewport:{width:1440,height:1000}}),page=await context.newPage();
  const item={id,transport:replay?"recorded-response-replay":bridge?"http-test-bridge":"browser-direct",pass:false,errors:[],consoleErrors:[],requestFailures:[]};let pending;
  try{
    page.on("pageerror",e=>item.errors.push(redact(e.message)));page.on("console",m=>{if(m.type()==="error")item.consoleErrors.push(redact(m.text()));});
    page.on("requestfailed",r=>item.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));
    page.on("request",r=>{if(r.url().endsWith("/chat/completions")&&r.method()==="POST")item.requestBody=r.postDataJSON();});
    page.on("response",async r=>{if(r.url().endsWith("/chat/completions"))item.response=await r.json().catch(()=>null);});
    if(bridge)await page.route(service+"/v1/chat/completions",async route=>{
      if(replay) {
        const recorded=replay.cases.find(x=>x.id===id), normalize=x=>JSON.stringify(x).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,"[row-id]");
        item.requestMatches=normalize(route.request().postDataJSON())===normalize(recorded.requestBody);
        item.recordedResponseHash=createHash("sha256").update(JSON.stringify(recorded.response)).digest("hex");
        return route.fulfill({status:item.requestMatches?200:409,contentType:"application/json",body:JSON.stringify(item.requestMatches?recorded.response:{error:"request differs from original"})});
      }
      pending=vendor(route.request().postDataJSON());const response=await pending;
      item.httpStatus=response.status;try{item.response=JSON.parse(response.body);}catch{}
      await route.fulfill({status:response.status,contentType:"application/json",body:response.body}).catch(()=>{});
    });
    await setup(page,id);const started=Date.now();await page.locator('[data-ai-generate]').click();
    await page.waitForFunction(()=>document.querySelector("#previewModal").classList.contains("show")||/未收到|失败|超时|返回|正文/.test(document.querySelector("#toast")?.textContent||""),null,{timeout:190000});
    item.elapsedMs=Date.now()-started;
    assert.ok(await page.locator("#previewModal").isVisible(),await page.locator("#toast").textContent());
    item.previewText=await page.locator("#aiPreview").innerText();
    assert.equal(await page.evaluate(()=>App.getState().narrative.text),"验收前保留正文");
    await page.locator("#applyDraftButton").click();item.applied=await page.evaluate(()=>App.getState().narrative);
    assert.ok(item.applied.text.length>0);item.pass=true;
    if(!replay){fs.writeFileSync(path.join(out,id+".md"),redact(item.applied.text));
    await page.screenshot({path:path.join(out,id+".png")});}
  }catch(e){item.failure=redact(e.message);}
  finally{if(pending)await pending;await context.close();}
  return item;
}
(async()=>{const browser=await chromium.launch();try{
  result.direct=replay?replay.direct:process.env.RINGSIDE_AI_SKIP_DIRECT ? {pass:false,skipped:true,reason:"CORS failure already captured in initial-live-results.json"}:await run(browser,"boxing-complete",false);
  if(replay)result.responseSourceHash=replay.sourceHash;save();console.log("Direct browser:",result.direct.pass?"PASS":"FAIL");
  const ids=replay?replay.cases.map(c=>c.id):process.env.RINGSIDE_AI_CASES?process.env.RINGSIDE_AI_CASES.split(","):["boxing-complete","basketball-one-session","standards-disabled","background-missing","pain-partial"];
  for(const id of ids){
    const item=!replay&&id==="boxing-complete"&&result.direct.pass?result.direct:await run(browser,id,replay||!result.direct.pass);
    result.cases.push(item);save();console.log(id,item.pass?"PASS workflow":"FAIL",item.elapsedMs||0);
  }
  result.flowPass=result.cases.length===ids.length&&result.cases.every(x=>x.pass);save();
}finally{await browser.close();}})().catch(e=>{console.error(redact(e.message));process.exitCode=1;});
