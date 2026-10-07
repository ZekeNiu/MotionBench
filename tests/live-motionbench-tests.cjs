"use strict";
// Real provider calls through the shipped launcher, using isolated synthetic data.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const {chartFixture}=require("./helpers/chart-ai-fixture.cjs");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/ai/motionbench");
const key=process.env.RINGSIDE_AI_KEY,model=process.env.RINGSIDE_AI_MODEL||"gpt-6.1-sol";
if(!key)throw Error("Provide RINGSIDE_AI_KEY in the process environment");
const result={sourceHash:createHash("sha256").update(fs.readFileSync(path.join(root,"MotionBench.html"))).digest("hex"),transport:"shipped-local-launcher",service:"https://api.apikey.fan",model,synthetic:true,cases:[],pass:false};
fs.mkdirSync(out,{recursive:true});
const safe=s=>s.replaceAll(key,"[redacted]");
function save(){fs.writeFileSync(path.join(out,"live-"+model+".json"),safe(JSON.stringify(result,null,2)));}
async function setup(page,id){
  await page.goto("http://127.0.0.1:8765/MotionBench.html");await page.evaluate(chartFixture);
  await page.evaluate(id=>{
    const r=App.getState();r.athlete.name="AI 验收（模拟数据）";
    r.narrative={text:"验收前保留正文",html:"<p>验收前保留正文</p>",revision:1};
    if(["basketball-one-session","pain-partial","background-missing"].includes(id)){
      Object.keys(r.enabled).forEach(k=>r.enabled[k]=["fms","cmj","sj","imtp"].includes(k));
      Object.assign(r.athlete,{sport:"篮球",sportLevel:"校队",injury:"",notes:"周五没有体能训练时间"});
      r.trainingContext={experienceYears:2,weeklySessions:1,equipment:"仅自重，没有杠铃、哑铃或药球",weeklySchedule:"周二、周四球场训练；周六一次体能训练，周日休息"};
      r.data.fms.forEach(x=>{x.score="";x.left="";x.right="";x.pain=false;x.notes="";});
      r.data.cmj=[{id:"cmj",height:25}];r.data.sj=[{id:"sj",height:23}];
      r.data.imtp=[{id:"partial",peakForce:2000,timePoints:[{id:"t150",timeMs:150,force:"",rfd:4321}]}];
    }
    if(id==="standards-disabled"){
      Object.assign(r.athlete,{sport:"中长跑",sportLevel:"业余竞技",injury:"",notes:""});
      r.trainingContext={experienceYears:3,weeklySessions:1,equipment:"杠铃与跑道",weeklySchedule:"周二、周四专项间歇，周六一次力量训练"};
      r.definitions.forEach(d=>d.referenceEnabled=false);r.data.iso.forEach(x=>x.target="");r.balancePairs.forEach(x=>x.referenceEnabled=false);
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
  await page.locator("#apiURL").fill(result.service);await page.locator("#apiKey").fill(key);await page.locator("#apiModel").fill(model);
  await page.locator("#modelButton").click();await page.waitForFunction(()=>!document.querySelector("#modelButton").disabled,null,{timeout:65000});
  assert.match(await page.locator("#apiMessage").textContent(),/已读取/);
  await page.evaluate(()=>{App.showReport();App.openEntry("narrative");});
}
(async()=>{const browser=await chromium.launch({channel:"chrome"});try{
  const ids=process.env.RINGSIDE_AI_CASES?.split(",")||["boxing-complete","basketball-one-session","standards-disabled","background-missing","pain-partial"];
  async function run(id){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    const item={id,pass:false,errors:[]};page.on("pageerror",e=>item.errors.push(safe(e.message)));
    try{
      await setup(page,id);const start=Date.now();await page.locator("[data-ai-generate]").click();
      assert.equal(await page.locator("#aiProgress").getAttribute("data-state"),"running");
      await page.waitForFunction(()=>["ready","error"].includes(document.querySelector("#aiProgress").dataset.state),null,{timeout:310000});
      item.elapsedMs=Date.now()-start;
      assert.equal(await page.locator("#aiProgress").getAttribute("data-state"),"ready",await page.locator("#aiProgressDetail").textContent());
      item.text=await page.locator("#aiPreview").innerText();assert.ok(item.text.length>200);
      assert.equal(await page.evaluate(()=>App.getState().narrative.text),"验收前保留正文");
      await page.locator("#applyDraftButton").click();
      assert.equal(await page.evaluate(()=>App.getState().previousNarrative.text),"验收前保留正文");
      assert.equal(await page.locator("#aiProgress").getAttribute("data-state"),"applied");
      item.markdown=await page.evaluate(()=>App.getState().narrative.text);
      item.narrativePages=await page.evaluate(()=>RingsidePDF.measureNarrative(App.getState().narrative.html));
      assert.ok(item.narrativePages<=2,"Advice exceeds two A4 pages");
      const exported=await page.evaluate(()=>App.exportHTMLString());assert.ok(!exported.includes(key));assert.ok(!exported.includes('id="motionbench-local-bootstrap"'));
      item.applied=true;item.exportWithoutCredentials=true;item.pass=!item.errors.length;
      fs.writeFileSync(path.join(out,id+".md"),safe(item.markdown));
      await page.screenshot({path:path.join(out,id+".png")});
    }catch(e){item.error=safe(e.message);}
    finally{await context.close();}
    result.cases.push(item);save();console.log(id,item.pass?"PASS live preview/apply":"FAIL",item.elapsedMs||0,item.error||"");
  }
  for(let first=0;first<ids.length;first+=2)await Promise.all(ids.slice(first,first+2).map(run));
  result.cases.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
  result.pass=result.cases.length===ids.length&&result.cases.every(x=>x.pass);save();if(!result.pass)process.exitCode=1;
}finally{await browser.close();}})().catch(e=>{console.error(safe(e.message));process.exitCode=1;});
