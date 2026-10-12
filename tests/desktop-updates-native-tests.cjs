"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {_electron} = require("playwright");
const {desktopArtifactIdentity} = require("./helpers/desktop-artifact-identity.cjs");
const root = path.resolve(__dirname,"..");
const expectedWebVersion = require(path.join(root,"package.json")).version;
const expectedDesktopVersion = require("js-yaml").load(require("node:fs").readFileSync(path.join(root,"electron-builder.yml"),"utf8")).extraMetadata.version;
const out = path.resolve(process.env.MOTIONBENCH_UPDATE_NATIVE_ARTIFACT_DIR || path.join(root,"output/tests/v2191-desktop/native-updates"));
const result = {synthetic:true,packaged:!!process.env.MOTIONBENCH_EXECUTABLE,checks:[],passed:false};
const executablePath=process.env.MOTIONBENCH_EXECUTABLE || require("electron");
result.identity=desktopArtifactIdentity(root,executablePath,__filename);
const check = async (name,action) => {await action();result.checks.push(name);console.log("PASS",name);};
(async () => {
  await fs.mkdir(out,{recursive:true});
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),"motionbench-native-updates-"));
  let electron;
  const start = async () => {
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    electron=await _electron.launch({executablePath,args:[...(process.env.MOTIONBENCH_EXECUTABLE?[]:[root]),"--motionbench-test",`--motionbench-data-dir=${directory}`],cwd:root,env,timeout:45000});
    const page=await electron.firstWindow();await page.waitForFunction(()=>!!window.App?.ready);assert.equal(await page.evaluate(()=>App.ready),true);return page;
  };
  const close = async () => {
    const exited=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Native save guard did not close within 20 seconds")),20000);electron.once("close",()=>{clearTimeout(timeout);resolve();});});
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await exited;electron=null;
  };
  try {
    let page=await start();
    await check("actual preload and host return matching desktop and web versions after storage/draft restore",async()=>{
      const state=await page.evaluate(()=>MotionBenchNative.getUpdateState());
      const marker=await page.evaluate(()=>({desktop:MotionBenchDesktop.version,web:MotionBenchDesktop.webVersion,build:RingsideBuild.version}));
      assert.equal(state.version,expectedDesktopVersion);assert.equal(state.version,marker.desktop);assert.equal(state.webVersion,expectedWebVersion);assert.equal(state.webVersion,marker.web);assert.equal(marker.build,expectedWebVersion);
      assert.equal(state.checkUpdatesOnStartup,true);assert.equal(state.state,"idle");result.versions=marker;
    });
    await check("native state subscription forwards only snapshots and cleanup stops later preference events",async()=>{
      const captured=await page.evaluate(async()=>{
        const states=[],stop=MotionBenchNative.onUpdateState(state=>states.push(state));await MotionBenchNative.setUpdatePreferences({checkUpdatesOnStartup:false});await new Promise(resolve=>setTimeout(resolve,30));const first=states.length;
        stop();await MotionBenchNative.setUpdatePreferences({checkUpdatesOnStartup:true});await new Promise(resolve=>setTimeout(resolve,30));return {first,after:states.length,keys:Object.keys(states[0]).sort()};
      });
      assert.equal(captured.first,1);assert.equal(captured.after,1);assert.ok(captured.keys.includes("checkUpdatesOnStartup"));assert.ok(!captured.keys.includes("sender"));
    });
    await check("the real native help menu opens application settings before reporting a manual check result",async()=>{
      await electron.evaluate(async({Menu})=>{const help=Menu.getApplicationMenu().items.find(item=>item.label==="帮助");await help.submenu.items.find(item=>item.label==="检查更新").click();});
      await page.waitForFunction(()=>document.getElementById("desktopUpdateError")?.textContent.includes("测试环境"));
      assert.equal(await page.locator("#settingsTitle").textContent(),"应用设置");assert.equal(await page.locator(".desktop-app-settings").isVisible(),true);
      assert.equal(await page.locator("#reportView").isVisible(),false);await page.screenshot({path:path.join(out,"settings-native.png")});
    });
    await check("another actual BrowserWindow cannot read or write desktop preferences through the preload",async()=>{
      const rejected=await electron.evaluate(async({BrowserWindow,app})=>{
        const separator=process.platform==="win32"?"\\":"/",probe=new BrowserWindow({show:false,webPreferences:{preload:app.getAppPath()+separator+"desktop"+separator+"preload.cjs",contextIsolation:true,sandbox:true,nodeIntegration:false}});
        try {await probe.loadURL("data:text/html,<title>isolated update sender probe</title>");return await probe.webContents.executeJavaScript("Promise.all([MotionBenchNative.getUpdateState(),MotionBenchNative.setUpdatePreferences({checkUpdatesOnStartup:false})].map(p=>p.then(()=>false,()=>true)))");}
        finally {probe.destroy();}
      });assert.deepEqual(rejected,[true,true]);assert.equal((await page.evaluate(()=>MotionBenchNative.getUpdateState())).checkUpdatesOnStartup,true);
    });
    await check("user startup preference survives the real save barrier and a separate Electron process",async()=>{
      await page.evaluate(()=>MotionBenchNative.setUpdatePreferences({checkUpdatesOnStartup:false}));
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,"desktop-preferences.json"),"utf8")),{schema:1,checkUpdatesOnStartup:false});
      await close();page=await start();assert.equal((await page.evaluate(()=>MotionBenchNative.getUpdateState())).checkUpdatesOnStartup,false);await close();
    });
    result.passed=true;
  } catch(error) {result.error=error.stack||error.message;throw error;}
  finally {
    result.finalIdentity=desktopArtifactIdentity(root,executablePath,__filename);result.artifactUnchanged=JSON.stringify(result.identity)===JSON.stringify(result.finalIdentity);
    if(!result.artifactUnchanged || !result.identity.runtimeMatchesSourceHtml) {result.passed=false;process.exitCode=1;}
    await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,"native-update-results.json"),JSON.stringify(result,null,2)+"\n");
    if(electron)await electron.close();
    const resolved=path.resolve(directory),temporary=path.resolve(os.tmpdir())+path.sep;assert.ok(resolved.startsWith(temporary)&&path.basename(resolved).startsWith("motionbench-native-updates-"));
    await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
