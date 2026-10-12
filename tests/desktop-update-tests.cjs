"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const yaml = require("js-yaml");
const { DesktopPreferences } = require("../desktop/preferences.cjs");
const { createUpdateService, configureUpdater, validateUpdateInfo, releaseNotes } = require("../desktop/update-service.cjs");
const { createUpdateBridge } = require("../desktop/update-bridge.cjs");
const { createWindowsUpdater } = require("../desktop/windows-updater.cjs");
const version = "2.19.1-desktop.1", nextVersion = "2.19.2-desktop.1";
const checks = [];
const check = async (name, action) => { await action(); checks.push(name); console.log("PASS", name); };
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); };
const info = (next = nextVersion) => ({ version: next, releaseNotes: "新版说明 <script>literal text</script>", files: [{
  url: `MotionBench-${next}-Setup-x64.exe`, size: 128, sha512: Buffer.alloc(64, 7).toString("base64"),
}] });
class FakeUpdater extends EventEmitter {
  constructor() { super(); this.checks = 0; this.downloads = 0; this.installs = []; this.info = info(); }
  set channel(value) { this._channel = value; this.allowDowngrade = true; }
  get channel() { return this._channel; }
  async checkForUpdates() { this.checks++; if (this.checkFailure) throw this.checkFailure; return {updateInfo:this.info}; }
  async downloadUpdate() {
    this.downloads++;
    if (this.downloadFailure) { this.emit("error",this.downloadFailure); throw this.downloadFailure; }
    this.emit("download-progress",{percent:40,total:128,transferred:51});
    this.emit("update-downloaded",this.downloadedInfo || this.info);
    return ["synthetic-installer"];
  }
  quitAndInstall(...args) { if (this.installFailure) throw this.installFailure; this.installs.push(args); }
}
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motionbench-update-tests-"));
  const services = [];
  const fixture = (options = {}) => {
    const updater = new FakeUpdater(), opened = [], saved = {calls:0}, recovered = {calls:0};
    const service = createUpdateService({directory:path.join(directory,"profiles",String(services.length)),version,webVersion:"2.19.1",createUpdater:() => updater,
      openExternal:async url => opened.push(url),prepareRestart:async () => {saved.calls++;return {ok:true};},recoverRestart:() => recovered.calls++,...options});
    services.push(service); return {service,updater,opened,saved,recovered};
  };
  try {
    await check("first installation defaults to checking; preference writes persist separately from library and credentials",async () => {
      const store = new DesktopPreferences(path.join(directory,"preferences"));
      assert.deepEqual(await store.read(),{checkUpdatesOnStartup:true,preferenceError:""});
      await store.save({checkUpdatesOnStartup:false});
      assert.deepEqual(await new DesktopPreferences(store.directory).read(),{checkUpdatesOnStartup:false,preferenceError:""});
      const files = await fs.readdir(store.directory); assert.deepEqual(files,["desktop-preferences.json"]);
      const raw = JSON.parse(await fs.readFile(store.file,"utf8"));assert.deepEqual(raw,{schema:1,checkUpdatesOnStartup:false});
      await Promise.all([store.save({checkUpdatesOnStartup:true}),store.save({checkUpdatesOnStartup:false})]);
      assert.equal((await store.read()).checkUpdatesOnStartup,false,"queued writes finish in order");
      for (const patch of [null,{}, {checkUpdatesOnStartup:1}, {checkUpdatesOnStartup:true,path:"C:\\private"}]) await assert.rejects(store.save(patch));
    });
    await check("corrupt, unknown-version and oversized settings disable startup checks and remain untouched",async () => {
      for (const content of ["{broken",JSON.stringify({schema:2,checkUpdatesOnStartup:true}),"x".repeat(16385)]) {
        const store = new DesktopPreferences(path.join(directory,"corrupt"));await fs.mkdir(store.directory,{recursive:true});await fs.writeFile(store.file,content);
        const settings = await store.read(); assert.equal(settings.checkUpdatesOnStartup,false);assert.ok(settings.preferenceError);
        await assert.rejects(store.save({checkUpdatesOnStartup:true}));assert.equal(await fs.readFile(store.file,"utf8"),content);
      }
    });
    await check("failed atomic replacement preserves the previous setting and removes only its own temporary file",async () => {
      const store = new DesktopPreferences(path.join(directory,"write-failure"));await store.save({checkUpdatesOnStartup:false});
      const original = await fs.readFile(store.file,"utf8");
      const failing = new DesktopPreferences(store.directory,{...fs,rename:async () => {throw new Error("synthetic locked file");}});
      await assert.rejects(failing.save({checkUpdatesOnStartup:true}));assert.equal(await fs.readFile(store.file,"utf8"),original);
      assert.deepEqual(await fs.readdir(store.directory),["desktop-preferences.json"]);
    });
    await check("updater is pinned to desktop with no downgrade, automatic download, quit installation or web installer",async () => {
      const updater = configureUpdater(new FakeUpdater());
      assert.equal(updater.channel,"desktop");assert.equal(updater.allowPrerelease,true);assert.equal(updater.allowDowngrade,false);
      assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.disableWebInstaller,true);
    });
    await check("installer metadata rejects HTML, beta, foreign URLs, portable assets and missing or conflicting checksums",async () => {
      assert.equal(validateUpdateInfo(info()).version,nextVersion);
      const invalid = [info("2.19.2"),info("2.19.2-beta.1"),info("2.19.2-desktop.01"),info("2.19.2-desktop.999999999999999999999")];
      for (const patch of [{url:"https://attacker.example/installer.exe"},{url:"../MotionBench-2.19.2-desktop.1-Setup-x64.exe"},
        {url:`MotionBench-${nextVersion}-Portable-x64.exe`},{sha512:""},{size:0}]) {
        const modified = info();Object.assign(modified.files[0],patch);invalid.push(modified);
      }
      invalid.push({...info(),files:[...info().files,...info().files]},{...info(),path:"other.exe"},{...info(),sha512:Buffer.alloc(64,8).toString("base64")});
      for (const candidate of invalid) assert.throws(() => validateUpdateInfo(candidate));
    });
    await check("the actual locked GitHub provider skips interleaved HTML and beta releases and requests desktop.yml",async () => {
      const {GitHubProvider} = require("electron-updater/out/providers/GitHubProvider");
      const semver = require(require.resolve("semver",{paths:[require.resolve("electron-updater")]}));
      const requested = [], tags = ["v2.20.0","v2.20.0-beta.1","v"+nextVersion,"v"+version];
      const feed = `<feed>${tags.map(tag=>`<entry><title>${tag}</title><link href="https://github.com/ZekeNiu/MotionBench/releases/tag/${tag}"/><content>release</content></entry>`).join("")}</feed>`;
      const updater = configureUpdater(new FakeUpdater());updater.currentVersion = new semver.SemVer(version);
      const provider = new GitHubProvider({provider:"github",owner:"ZekeNiu",repo:"MotionBench",channel:"desktop"},updater,{platform:"win32",executor:{request:async options => {
        requested.push(options.path);return options.path.endsWith(".atom")?feed:yaml.dump(info());
      }}});
      const result = await provider.getLatestVersion();assert.equal(result.version,nextVersion);
      assert.ok(requested.some(url=>url.includes(`/v${nextVersion}/desktop.yml`)));
      assert.ok(!requested.some(url=>/latest\.yml|beta\.yml/.test(url)));
      // GitHub's own latest.yml fallback must not bypass the application gate.
      assert.throws(()=>validateUpdateInfo(info("2.20.0")));
    });
    await check("GitHub Atom HTML becomes plain release text with paragraphs, lists and entities, never script or style",async () => {
      const {parseXml}=require("builder-util-runtime"),{computeReleaseNotes}=require("electron-updater/out/providers/GitHubProvider");
      const feed=parseXml('<feed><entry><content type="html">&lt;p&gt;A &amp;amp; B&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&amp;#x4e2d; note&lt;/li&gt;&lt;/ul&gt;</content></entry></feed>');
      const atomNotes=computeReleaseNotes({},false,feed,feed.element("entry"));assert.ok(atomNotes.includes("<p>"),"the locked provider retains HTML");
      assert.equal(releaseNotes(atomNotes),"A & B\n\n• 中 note");
      const cleaned=releaseNotes('<style>secret-css</style><p>Visible &lt;code&gt; &quot;quoted&quot; &nbsp; &#38;</p><script>secret-script()</script><ol><li>One<br>Two</li></ol>');
      assert.ok(!cleaned.includes("secret")&&!cleaned.includes("<p>"));assert.ok(cleaned.includes('Visible <code> "quoted"   &'));assert.match(cleaned,/• One\nTwo/);
      assert.equal(releaseNotes("普通说明\n- 项目一\n- 项目二"),"普通说明\n- 项目一\n- 项目二");
    });
    await check("startup waits for successful restore, delays once, and never downloads or opens a popup",async () => {
      let resolveReady;const ready = new Promise(resolve=>{resolveReady=resolve;});const timers=[];
      const f = fixture({timer:(callback,delay)=>{timers.push({callback,delay});return 1;},clearTimer:()=>{}});
      const scheduled = f.service.scheduleStartup(ready);await tick();assert.equal(timers.length,0);
      resolveReady(true);await scheduled;assert.equal(timers.length,1);assert.equal(timers[0].delay,5000);
      timers[0].callback();await tick();const state = await f.service.getUpdateState();
      assert.equal(f.updater.checks,1);assert.equal(f.updater.downloads,0);assert.deepEqual(f.opened,[]);assert.equal(state.state,"available");
    });
    await check("turning startup checks off while restore or its timer is pending prevents networking and survives restart",async () => {
      let resolveReady;const ready = new Promise(resolve=>{resolveReady=resolve;});const timers=[];let clears=0;
      const f = fixture({timer:callback=>{timers.push(callback);return 1;},clearTimer:()=>{clears++;}});
      const scheduled=f.service.scheduleStartup(ready);await f.service.setUpdatePreferences({checkUpdatesOnStartup:false});resolveReady(true);await scheduled;
      assert.equal(timers.length,0);assert.equal(f.updater.checks,0);
      await f.service.setUpdatePreferences({checkUpdatesOnStartup:true});await f.service.scheduleStartup(Promise.resolve(true));
      assert.equal(timers.length,1);await f.service.setUpdatePreferences({checkUpdatesOnStartup:false});assert.equal(clears,1);
      timers[0]();await tick();assert.equal(f.updater.checks,0);
      const restarted=new DesktopPreferences(path.join(directory,"profiles",String(services.indexOf(f.service))));assert.equal((await restarted.read()).checkUpdatesOnStartup,false);
    });
    await check("failed restore and development/test mode do not schedule automatic network access",async () => {
      let schedules=0;const f=fixture({timer:()=>{schedules++;}});await f.service.scheduleStartup(Promise.resolve(false));await f.service.scheduleStartup(Promise.reject(new Error("restore failed")));
      const dev=fixture({enabled:false,timer:()=>{schedules++;}});await dev.service.scheduleStartup(Promise.resolve(true));await dev.service.checkForUpdates();
      assert.equal(schedules,0);assert.equal(dev.updater.checks,0);assert.ok((await dev.service.getUpdateState()).error);
    });
    await check("manual check works while startup preference is off; duplicate checks share one request",async () => {
      let release;const f=fixture();f.updater.checkForUpdates=async()=>{f.updater.checks++;return new Promise(resolve=>{release=()=>resolve({updateInfo:info()});});};
      await f.service.setUpdatePreferences({checkUpdatesOnStartup:false});const a=f.service.checkForUpdates(),b=f.service.checkForUpdates();await tick();
      assert.equal(f.updater.checks,1);release();await Promise.all([a,b]);assert.equal((await f.service.getUpdateState()).state,"available");
    });
    await check("no update or a server downgrade cannot create an installable update",async () => {
      for (const published of [version,"2.19.0-desktop.1"]) {
        const f=fixture();f.updater.info=info(published);assert.equal((await f.service.checkForUpdates()).state,"up-to-date");
        await f.service.downloadUpdate();await f.service.installUpdate();assert.equal(f.updater.downloads,0);assert.equal(f.saved.calls,0);assert.deepEqual(f.updater.installs,[]);
      }
    });
    await check("network failures are confined to safe update state and a later check can recover",async () => {
      const f=fixture();f.updater.checkFailure=new Error("https://private.example/token synthetic-provider-key C:\\private");
      let state=await f.service.checkForUpdates();assert.equal(state.state,"error");assert.ok(!JSON.stringify(state).includes("private"));assert.ok(!JSON.stringify(state).includes("synthetic-provider-key"));
      f.updater.checkFailure=null;state=await f.service.checkForUpdates();assert.equal(state.state,"available");assert.equal(f.updater.checks,2);
    });
    await check("download progress, subscriptions, unsubscription and save-before-install ordering work",async () => {
      const order=[],updates=[];const f=fixture({prepareRestart:async()=>{order.push("save");return {ok:true};}});
      const unsubscribe=f.service.onUpdateState(state=>updates.push(state));await f.service.checkForUpdates();
      f.updater.quitAndInstall=(...args)=>{order.push("install");f.updater.installs.push(args);};
      assert.equal((await f.service.downloadUpdate()).state,"downloaded");assert.ok(updates.some(state=>state.progress?.percent===40));
      const count=updates.length;unsubscribe();await f.service.installUpdate();assert.equal(updates.length,count);
      assert.deepEqual(order,["save","install"]);assert.deepEqual(f.updater.installs,[[true,true]]);
      assert.equal((await f.service.getUpdateState()).state,"installing");
    });
    await check("save failure and unfinished forms keep the downloaded update and the running program",async () => {
      for (const reason of ["资料导入仍在进行","当前数据尚未保存","有尚未提交的设置"]) {
        const f=fixture({prepareRestart:async()=>({ok:false,reason})});await f.service.checkForUpdates();await f.service.downloadUpdate();
        const state=await f.service.installUpdate();assert.equal(state.state,"downloaded");assert.equal(state.error,reason);assert.deepEqual(f.updater.installs,[]);
      }
    });
    await check("checksum and metadata mismatches cannot reach installation",async () => {
      const f=fixture();await f.service.checkForUpdates();f.updater.downloadFailure=Object.assign(new Error("private checksum trace"),{code:"ERR_CHECKSUM_MISMATCH"});
      assert.match((await f.service.downloadUpdate()).error,/校验失败/);await f.service.installUpdate();assert.equal(f.saved.calls,0);
      f.updater.downloadFailure=null;f.updater.downloadedInfo=info("2.19.3-desktop.1");await f.service.downloadUpdate();
      assert.equal((await f.service.getUpdateState()).state,"error");await f.service.installUpdate();assert.equal(f.saved.calls,0);
    });
    await check("installation launch failure restores the save guard and permits a retry",async () => {
      const f=fixture();await f.service.checkForUpdates();await f.service.downloadUpdate();f.updater.installFailure=new Error("synthetic spawn failure");
      assert.equal((await f.service.installUpdate()).state,"downloaded");assert.equal(f.recovered.calls,1);
      f.updater.installFailure=null;await f.service.installUpdate();assert.equal(f.updater.installs.length,1);
    });
    await check("portable updates open the precise desktop release without downloading or running Setup",async () => {
      const f=fixture({portable:true});await f.service.checkForUpdates();await f.service.downloadUpdate();await f.service.installUpdate();
      assert.deepEqual(f.opened,[`https://github.com/ZekeNiu/MotionBench/releases/tag/v${nextVersion}`]);assert.equal(f.updater.downloads,0);assert.equal(f.saved.calls,0);assert.equal(f.updater.installs.length,0);
    });
    await check("Windows installer launch waits for the spawn event before quitting, with fixed silent per-user arguments",async () => {
      const bytes=Buffer.from("synthetic installer bytes; never executed"),installer=path.join(directory,"synthetic-Setup.exe");await fs.writeFile(installer,bytes);
      const metadata=info();metadata.files[0].size=bytes.length;metadata.files[0].sha512=require("node:crypto").createHash("sha512").update(bytes).digest("base64");
      let quits=0,launch;
      class Base {constructor(){this.downloadedUpdateHelper={file:installer,versionInfo:metadata,downloadedFileInfo:{isAdminRightsRequired:false}};this.app={quit:()=>{quits++;}};}get installerPath(){return this.downloadedUpdateHelper.file;}}
      const adapter=createWindowsUpdater(Base,{}, {spawn:(file,args,options)=>{const child=new EventEmitter();child.unref=()=>{launch.unreferenced=true;};launch={file,args,options,child};return child;}});
      const installing=adapter.quitAndInstall(true,true);const deadline=Date.now()+3000;while(!launch){assert.ok(Date.now()<deadline);await tick();}
      assert.equal(quits,0,"the app remains running before the child actually starts");assert.equal(launch.file,installer);
      assert.deepEqual(launch.args,["--updated","/S","--force-run"]);assert.deepEqual(launch.options,{windowsHide:true,shell:false,stdio:"ignore",detached:true});
      launch.child.emit("spawn");await installing;assert.equal(quits,1);assert.equal(launch.unreferenced,true);
    });
    await check("asynchronous Windows spawn failure leaves the old application running and releases the retry latch",async () => {
      const bytes=Buffer.from("synthetic fail fixture"),installer=path.join(directory,"synthetic-failure.exe");await fs.writeFile(installer,bytes);
      const metadata=info();metadata.files[0].size=bytes.length;metadata.files[0].sha512=require("node:crypto").createHash("sha512").update(bytes).digest("base64");
      let quits=0,child;
      class Base {constructor(){this.downloadedUpdateHelper={file:installer,versionInfo:metadata,downloadedFileInfo:{isAdminRightsRequired:false}};this.app={quit:()=>{quits++;}};}get installerPath(){return this.downloadedUpdateHelper.file;}}
      const adapter=createWindowsUpdater(Base,{}, {spawn:()=>{child=new EventEmitter();child.unref=()=>{};return child;}});
      const installing=adapter.quitAndInstall(true,true);const rejection=assert.rejects(installing);const deadline=Date.now()+3000;while(!child){assert.ok(Date.now()<deadline);await tick();}
      child.emit("error",Object.assign(new Error("synthetic process launch failure"),{code:"EACCES"}));await rejection;
      assert.equal(quits,0);assert.equal(adapter.quitAndInstallCalled,false);
    });
    await check("cached installer corruption detected immediately before launch clears the update cache and never quits",async () => {
      const installer=path.join(directory,"corrupt-Setup.exe"),bytes=Buffer.from("untampered cache");await fs.writeFile(installer,Buffer.from("tamperedxx cache"));
      const metadata=info();metadata.files[0].size=bytes.length;metadata.files[0].sha512=require("node:crypto").createHash("sha512").update(bytes).digest("base64");
      let quits=0,spawns=0,clears=0;
      class Base {constructor(){this.downloadedUpdateHelper={file:installer,versionInfo:metadata,downloadedFileInfo:{isAdminRightsRequired:false},clear:async()=>{clears++;}};this.app={quit:()=>{quits++;}};}get installerPath(){return this.downloadedUpdateHelper.file;}}
      const adapter=createWindowsUpdater(Base,{}, {spawn:()=>{spawns++;throw new Error("must not spawn");}});
      await assert.rejects(adapter.quitAndInstall(true,true),{code:"ERR_CHECKSUM_MISMATCH"});assert.equal(clears,1);assert.equal(spawns,0);assert.equal(quits,0);
    });
    await check("update IPC rejects foreign windows, frames, unknown operations and extra arguments before effects",async () => {
      const f=fixture(),sender={},frame={},event={sender,senderFrame:frame};
      const bridge=createUpdateBridge({service:f.service,isTrustedSender:e=>e?.sender===sender&&e?.senderFrame===frame});
      for (const source of [null,{sender:{},senderFrame:frame},{sender,senderFrame:{}}]) await assert.rejects(bridge.handle(source,"checkForUpdates"));
      for (const operation of ["openExternal","shell","__proto__","dispose"]) await assert.rejects(bridge.handle(event,operation));
      await assert.rejects(bridge.handle(event,"checkForUpdates","https://attacker.example"));
      await assert.rejects(bridge.handle(event,"setUpdatePreferences",{checkUpdatesOnStartup:true,path:"C:\\private"}));
      assert.equal(f.updater.checks,0);const state=await bridge.handle(event,"setUpdatePreferences",{checkUpdatesOnStartup:false});assert.equal(state.checkUpdatesOnStartup,false);
    });
    await check("actual sandbox preload exposes named methods and subscriptions without exposing IPC events",async () => {
      const bus=new EventEmitter(),calls=[];let native;
      vm.runInNewContext(await fs.readFile(path.join(__dirname,"../desktop/preload.cjs"),"utf8"),{require:name=>{
        assert.equal(name,"electron");return {contextBridge:{exposeInMainWorld:(_name,value)=>{native=value;}},ipcRenderer:Object.assign(bus,{invoke:(...args)=>{calls.push(args);return Promise.resolve({state:"idle"});},send:(...args)=>calls.push(args)})};
      }});
      assert.deepEqual(Object.keys(native).sort(),["cancelAI","checkForUpdates","downloadUpdate","getUpdateState","installUpdate","onUpdateState","requestAI","setUpdatePreferences"]);
      const received=[];const unsub=native.onUpdateState(state=>received.push(state));bus.emit("motionbench:update-state",{secret:"never forwarded"},{state:"available"});unsub();bus.emit("motionbench:update-state",{}, {state:"downloaded"});
      assert.deepEqual(received,[{state:"available"}]);await native.getUpdateState();await native.setUpdatePreferences({checkUpdatesOnStartup:false});
      assert.equal(calls[0][0],"motionbench:update");assert.equal(calls[0][1],"getUpdateState");assert.equal(calls[1][1],"setUpdatePreferences");
    });
    const out=path.resolve(process.env.MOTIONBENCH_UPDATE_UNIT_ARTIFACT_DIR || path.resolve(__dirname,"../output/tests/v2191-desktop"));await fs.mkdir(out,{recursive:true});
    const sha256=bytes=>require("node:crypto").createHash("sha256").update(bytes).digest("hex"),sourceHashes={};
    for(const file of ["desktop/preferences.cjs","desktop/update-service.cjs","desktop/update-bridge.cjs","desktop/windows-updater.cjs","desktop/preload.cjs"])sourceHashes[file]=sha256(await fs.readFile(path.resolve(__dirname,"..",file)));
    await fs.writeFile(path.join(out,"update-unit-results.json"),JSON.stringify({synthetic:true,passed:true,checkedAt:new Date().toISOString(),checks,sourceHashes,testScriptSha256:sha256(await fs.readFile(__filename)),updater:require("electron-updater/package.json").version},null,2)+"\n");
    console.log(`Desktop update, preferences and IPC: ${checks.length} scenario groups passed`);
  } finally {
    for(const service of services)service.dispose();
    const resolved=path.resolve(directory),temporary=path.resolve(os.tmpdir())+path.sep;
    assert.ok(resolved.startsWith(temporary)&&path.basename(resolved).startsWith("motionbench-update-tests-"));
    await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
