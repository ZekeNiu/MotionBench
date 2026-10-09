"use strict";
const path = require("node:path"), assert = require("node:assert/strict"), { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), channel = process.argv.includes("--edge") ? "msedge" : "chrome";

(async () => {
  const browser = await chromium.launch({ channel }), context = await browser.newContext({ offline:true }), page = await context.newPage();
  const errors = [], checks = [];
  page.on("pageerror", error => errors.push(error.message));
  const check = async (name, action) => { await action(); checks.push(name); console.log("PASS", name); };
  async function fixture() {
    await page.setContent('<style>.modal-backdrop{display:none}.modal-backdrop.show{display:block}.field{display:block}</style><datalist id="sportOptions"></datalist><div id="managementContent"></div><div id="managementModal" class="modal-backdrop"><h2 id="managementModalTitle"></h2><form id="managementForm"><div id="managementFields"></div><p id="managementError" hidden></p><button type="submit">保存</button></form></div><p id="saveStatus"></p><div id="scratch"></div>');
    await page.evaluate(() => {
      const profile = { name:"原运动员", sex:"女", sport:"拳击", dominantHand:"右手", sportLevel:"省级", birthDate:"2000-10-10", experienceYears:"3.5", injuryHistory:"既往左膝伤病" };
      const record = { recordId:"r1", athleteId:"a1", title:"原测试", athlete:{ name:profile.name, date:"2026-10-09", age:25 }, enabled:{ cmj:true }, evaluationProfileId:"p1", updated:"2026-10-09" };
      window.fixtureLibrary = { athletes:[{ id:"a1", name:profile.name, profile, groupId:"g1", records:[record] }], groups:[{id:"g1",name:"一队"}], evaluationProfiles:[{id:"p1",name:"默认"}], catalog:{tests:[{id:"cmj",name:"CMJ"}]} };
      window.fixtureCalls = []; window.fixtureFailure = ""; window.fixtureGate = null;
      window.App = {
        getLibrary:()=>fixtureLibrary, getUIState:()=>({mode:"management"}),
        getRepository:()=>({loadRecord:async()=>record}),
        modal:id=>document.getElementById(id).classList.add("show"), close:id=>document.getElementById(id).classList.remove("show"),
        refreshWorkspace:()=>{}, saveLibraryChanges:()=>{throw Error("不得绕过原子资料接口");},
        updateAthleteProfile:async(id,next,groupId)=>{
          fixtureCalls.push({kind:"profile",id,profile:structuredClone(next),groupId});
          if(fixtureGate)await fixtureGate;
          if(fixtureFailure==="profile")throw Error("模拟档案事务失败");
          const owner=fixtureLibrary.athletes.find(a=>a.id===id);
          if(owner)Object.assign(owner,{name:next.name,profile:structuredClone(next),groupId});
          else fixtureLibrary.athletes.push({id:"created",name:next.name,profile:structuredClone(next),groupId,records:[]});
          return id||"created";
        },
        updateRecordDate:async(id,date,options)=>{
          fixtureCalls.push({kind:"date",id,date,options:structuredClone(options)});
          if(fixtureGate)await fixtureGate;
          if(fixtureFailure==="date")throw Error("模拟日期事务失败");
          record.athlete.date=date;record.title=options.title;
        },
      };
    });
    await page.addScriptTag({path:path.join(root,"src/ringside-profile.js")});
    await page.addScriptTag({path:path.join(root,"src/ringside-management.js")});
    await page.evaluate(()=>{RingsideManagement.init();RingsideManagement.open("athletes");});
  }
  const openOptional = async () => page.locator("#managementFields .athlete-profile-more summary").click();
  const submit = async () => page.locator('#managementForm [type="submit"]').click();
  try {
    await fixture();
    await check("shared profile preserves creation IDs, optional fields, empty team and escaped text", async () => {
      await page.evaluate(()=>{document.getElementById("scratch").innerHTML=RingsideProfile.render({name:'<A & B>',injuryHistory:'<script>unsafe</script>'},{creation:true,groups:fixtureLibrary.groups});});
      for(const id of ["Name","Sex","Sport","Hand","Level","Group","BirthDate","ExperienceYears","InjuryHistory"])
        assert.equal(await page.locator("#newAthlete"+id).count(),1);
      assert.equal(await page.locator("#scratch [required]").count(),1);
      assert.equal(await page.locator("#newAthleteName").inputValue(),"<A & B>");
      assert.equal(await page.locator("#scratch script").count(),0);
      assert.equal(await page.locator("#newAthleteGroup").inputValue(),"");
      assert.equal(await page.locator("#scratch details").evaluate(node=>node.open),false);
      const parsed=await page.evaluate(()=>RingsideProfile.read(document.getElementById("scratch"),{creation:true}));
      assert.equal(parsed.profile.birthDate,"");assert.equal(parsed.profile.experienceYears,"");assert.equal(parsed.profile.injuryHistory,"<script>unsafe</script>");
    });
    await check("profile read rejects blank names and invalid optional experience without a transaction", async () => {
      await page.evaluate(()=>RingsideManagement.editAthlete("a1"));
      await page.locator('#managementForm [name="name"]').fill("  ");
      await submit();await page.waitForFunction(()=>!document.getElementById("managementError").hidden);
      assert.match(await page.locator("#managementError").innerText(),/姓名或编号/);
      assert.equal(await page.evaluate(()=>fixtureCalls.length),0);
      await page.locator('#managementForm [name="name"]').fill("姓名");
      await openOptional();await page.locator('#managementForm [name="experienceYears"]').fill("81");
      const rejected=await page.evaluate(()=>{try{RingsideProfile.read(document.getElementById("managementForm"));return false;}catch{return true;}});
      assert.equal(rejected,true);assert.equal(await page.evaluate(()=>fixtureCalls.length),0);
    });
    await fixture();
    await check("pending or failed profile updates leave the library untouched and the entered form open", async () => {
      await page.evaluate(()=>{window.beforeProfile=JSON.stringify(fixtureLibrary);fixtureFailure="profile";fixtureGate=new Promise(resolve=>window.releaseFixture=resolve);RingsideManagement.editAthlete("a1");});
      await page.locator('#managementForm [name="name"]').fill("修改姓名");
      await page.locator('#managementForm [name="birthDate"]').fill("2001-01-01");
      await openOptional();await page.locator('#managementForm [name="experienceYears"]').fill("4.5");
      await page.locator('#managementForm [name="injuryHistory"]').fill("  长期病史更新  ");
      await submit();await page.waitForFunction(()=>fixtureCalls.length===1);
      assert.equal(await page.evaluate(()=>JSON.stringify(fixtureLibrary)===beforeProfile),true);
      assert.equal(await page.locator('#managementForm [type="submit"]').isDisabled(),true);
      await page.evaluate(()=>releaseFixture());await page.waitForFunction(()=>!document.getElementById("managementError").hidden);
      assert.equal(await page.evaluate(()=>JSON.stringify(fixtureLibrary)===beforeProfile),true);
      assert.equal(await page.locator("#managementModal").isVisible(),true);
      assert.equal(await page.locator('#managementForm [name="birthDate"]').inputValue(),"2001-01-01");
      const call=await page.evaluate(()=>fixtureCalls[0]);assert.equal(call.id,"a1");assert.equal(call.profile.experienceYears,"4.5");assert.equal(call.profile.injuryHistory,"长期病史更新");
      await page.evaluate(()=>{fixtureFailure="";fixtureGate=null;});await submit();await page.locator("#managementModal").waitFor({state:"hidden"});
      assert.equal(await page.evaluate(()=>fixtureLibrary.athletes[0].profile.birthDate),"2001-01-01");
    });
    await check("ordinary athlete creation uses the same profile API with optional long-term fields", async () => {
      await page.evaluate(()=>RingsideManagement.editAthlete());
      assert.equal(await page.locator('#managementForm [name="birthDate"]').inputValue(),"");
      await page.locator('#managementForm [name="name"]').fill("仅姓名运动员");await submit();await page.locator("#managementModal").waitFor({state:"hidden"});
      const call=await page.evaluate(()=>fixtureCalls.at(-1));assert.equal(call.id,"");assert.equal(call.groupId,"");assert.equal(call.profile.birthDate,"");assert.equal(call.profile.experienceYears,"");
      assert.equal(await page.evaluate(()=>fixtureLibrary.athletes.find(a=>a.id==="created").name),"仅姓名运动员");
    });
    await check("record name and date route together through the date transaction without early mutation", async () => {
      await page.evaluate(()=>{fixtureFailure="date";fixtureGate=new Promise(resolve=>window.releaseFixture=resolve);window.beforeRecord=JSON.stringify(fixtureLibrary.athletes[0].records[0]);RingsideManagement.open("records");});
      await page.locator('[data-manager-action="edit-record"][data-id="r1"]').click();
      await page.locator('#managementForm [name="title"]').fill("修改测试");await page.locator('#managementForm [name="date"]').fill("2026-10-10");
      await submit();await page.waitForFunction(()=>fixtureCalls.at(-1).kind==="date");
      assert.equal(await page.evaluate(()=>JSON.stringify(fixtureLibrary.athletes[0].records[0])===beforeRecord),true);
      const call=await page.evaluate(()=>fixtureCalls.at(-1));assert.deepEqual(call,{kind:"date",id:"r1",date:"2026-10-10",options:{title:"修改测试"}});
      await page.evaluate(()=>releaseFixture());await page.waitForFunction(()=>!document.getElementById("managementError").hidden);
      assert.equal(await page.evaluate(()=>JSON.stringify(fixtureLibrary.athletes[0].records[0])===beforeRecord),true);
      assert.equal(await page.locator("#managementModal").isVisible(),true);
      await page.evaluate(()=>{fixtureFailure="";fixtureGate=null;});await submit();await page.locator("#managementModal").waitFor({state:"hidden"});
      assert.equal(await page.evaluate(()=>fixtureLibrary.athletes[0].records[0].athlete.date),"2026-10-10");
      assert.equal(await page.evaluate(()=>fixtureLibrary.athletes[0].records[0].title),"修改测试");
    });
    assert.deepEqual(errors,[]);console.log(`PASS ${checks.length} isolated ${channel} profile/management checks`);
  } catch(error) { console.error(error.stack);process.exitCode=1; }
  finally { await browser.close(); }
})();
