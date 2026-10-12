"use strict";
// The default profile is used only in the isolated CI Windows user, to exercise
// the real install identity, source and DPAPI binding across two app versions.
const assert=require("node:assert/strict"),fs=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto");
const {_electron}=require("playwright"),asar=require("@electron/asar");
const mode=process.argv[2],executable=process.env.MOTIONBENCH_EXECUTABLE,seedPath=process.env.MOTIONBENCH_CI_UPGRADE_SEED;
if(process.env.GITHUB_ACTIONS!=="true"||process.env.CI!=="true"||process.platform!=="win32")throw Error("Default-profile upgrade checks run only in the isolated GitHub Actions Windows user");
if(!["seed","verify"].includes(mode)||!executable||!seedPath)throw Error("The owned installed executable and seed file are required");
const expectedProfile=path.join(process.env.APPDATA,"MotionBench Desktop"),hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const subset=record=>Object.fromEntries(["recordId","athleteId","athlete","enabled","data","acquisition","trainingContext","projectSnapshots","testPlanSnapshot","evaluationProfileId","definitions","customValues","fvpConfig","fvpAnalysis","sprintFvpConfig","sprintFvpAnalysis"].map(key=>[key,record[key]]).filter(([,value])=>value!==undefined));
(async()=>{
  const result={synthetic:true,phase:mode,passed:false,checkedAt:new Date().toISOString(),testScriptSha256:hash(await fs.readFile(__filename))};
  let app;
  try {
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:executable,args:["--motionbench-test"],cwd:path.resolve(__dirname,".."),env,timeout:45000});
    const page=await app.firstWindow();page.setDefaultTimeout(20000);await page.waitForFunction(()=>!!window.App?.ready);assert.equal(await page.evaluate(()=>App.ready),true);await app.context().setOffline(true);
    const host=await app.evaluate(({app})=>({version:app.getVersion(),userData:app.getPath("userData")}));assert.equal(path.resolve(host.userData),path.resolve(expectedProfile));
    assert.equal(host.version,mode==="seed"?"2.19.1-desktop.1":"2.20.0-desktop.1");result.version=host.version;
    const archive=path.join(path.dirname(executable),"resources/app.asar");result.archiveSha256=hash(await fs.readFile(archive));result.runtimeHtmlSha256=hash(asar.extractFile(archive,path.normalize("MotionBench.html")));
    if(mode==="seed") {
      await page.evaluate(()=>App.importPayload(RingsideModel.libraryDefaults(),"replace-library"));
      const athlete=await page.evaluate(()=>App.createAthlete("CI 升级验证运动员（合成）"));
      const nav=page.locator('[data-workspace-nav="entry"]');if(!await nav.isVisible()||await page.locator("#sidebar").evaluate(node=>node.inert))await page.locator("#sidebarToggle").click();
      await nav.click();await page.locator(`[data-creation-athlete="${athlete}"]`).check();await page.locator("#creationNext").click();
      await page.locator('[data-picker-project="cmj"]').check();await page.locator("#creationDate").fill("2026-10-12");await page.locator("#creationSubmit").click();
      await page.waitForFunction(()=>App.getUIState().mode==="entry");await page.evaluate(()=>App.entry("athlete"));
      await page.locator('[data-path="athlete.mass"]').fill("72.5");await page.locator('[data-path="athlete.height"]').fill("178");await page.evaluate(()=>App.entry("cmj"));
      await page.locator('[data-path="data.cmj.0.height"]').fill("41.5");await page.evaluate(()=>App.entry("review"));await page.locator("#entryFinish").click();
      assert.equal(await page.evaluate(()=>App.saveNow()),true);
      const savedAI=await page.evaluate(async()=>{const status=await RingsideAISettings.status();return RingsideAISettings.save({base:"https://motionbench-ci-upgrade.invalid/v1",model:"synthetic-ci-model",key:"motionbench-ci-synthetic-key-never-used",expectedRevision:status.revision});});assert.equal(savedAI.hasKey,true);
      // The fixed 2.19.1 baseline stores input values as raw strings. Keep that
      // exact representation in the seed so verification catches type changes.
      const record=await page.evaluate(async()=>App.getRepository().loadRecord(App.getState().recordId));assert.equal(record.data.cmj[0].height,"41.5");
      const seed={synthetic:true,record:subset(record),athleteIds:await page.evaluate(()=>App.getLibrary().athletes.map(a=>a.id)),aiRevision:savedAI.revision,aiCipherSha256:hash(await fs.readFile(path.join(expectedProfile,"ai-settings.dat"))),oldArchiveSha256:result.archiveSha256,oldRuntimeHtmlSha256:result.runtimeHtmlSha256};
      await fs.mkdir(path.dirname(seedPath),{recursive:true});await fs.writeFile(seedPath,JSON.stringify(seed,null,2)+"\n");result.seedSha256=hash(await fs.readFile(seedPath));
    } else {
      const seed=JSON.parse(await fs.readFile(seedPath,"utf8"));assert.equal(seed.synthetic,true);
      const record=await page.evaluate(async()=>App.getRepository().loadRecord(App.getState().recordId));assert.deepEqual(subset(record),seed.record);
      assert.deepEqual(await page.evaluate(()=>App.getLibrary().athletes.map(a=>a.id)),seed.athleteIds);
      const status=await page.evaluate(()=>RingsideAISettings.status());assert.equal(status.hasKey,true);assert.equal(status.model,"synthetic-ci-model");assert.equal(status.revision,seed.aiRevision);
      assert.equal(hash(await fs.readFile(path.join(expectedProfile,"ai-settings.dat"))),seed.aiCipherSha256);
      result.rawMeasurementsAndIdsPreserved=true;result.dpapiCipherAndRevisionPreserved=true;result.seedSha256=hash(await fs.readFile(seedPath));
    }
    const closed=app.waitForEvent("close",{timeout:20000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;result.passed=true;
  } catch(error){result.error=error.stack||error.message;throw error;}
  finally {if(app)await app.close();await fs.mkdir(path.dirname(seedPath),{recursive:true});await fs.writeFile(path.join(path.dirname(seedPath),mode+"-results.json"),JSON.stringify(result,null,2)+"\n");}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
