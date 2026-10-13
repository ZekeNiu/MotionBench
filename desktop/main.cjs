"use strict";
const { app, BrowserWindow, protocol, session, dialog, Menu, shell, safeStorage, net, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { APP_ORIGIN, APP_URL, CSP, isAppURL, externalURL, safeFilename, exportFilters } = require("./security.cjs");
const { createAIService } = require("./ai-service.cjs");
const { createAIBridge } = require("./ai-bridge.cjs");
const { createUpdateService } = require("./update-service.cjs");
const { createUpdateBridge } = require("./update-bridge.cjs");
const { createWindowsUpdater } = require("./windows-updater.cjs");

protocol.registerSchemesAsPrivileged([{ scheme: "motionbench", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName("MotionBench Desktop");
if (process.platform === "win32") app.setAppUserModelId("com.motionbench.desktop");
const dataArgument = process.argv.find(arg => arg.startsWith("--motionbench-data-dir="));
const dataDirectory = dataArgument ? dataArgument.slice("--motionbench-data-dir=".length) : path.join(app.getPath("appData"), "MotionBench Desktop");
try {
  if (!path.isAbsolute(dataDirectory)) throw Error("MotionBench data directory must be an absolute path");
  // Electron requires a new custom path to exist before setPath. This also
  // covers a first installation, not only a previously opened user profile.
  require("node:fs").mkdirSync(dataDirectory, {recursive:true});
  app.setPath("userData", dataDirectory);
  app.setPath("sessionData", dataDirectory);
} catch {
  dialog.showErrorBox("MotionBench 启动失败", "无法创建或访问本机数据目录，请检查路径及写入权限。\n" + dataDirectory);
  app.exit(1);
}
const testMode = process.argv.includes("--motionbench-test");
const testExportDirectory = testMode && process.env.MOTIONBENCH_TEST_EXPORT_DIR ? path.resolve(process.env.MOTIONBENCH_TEST_EXPORT_DIR) : null;
let mainWindow, updateService, closing = false, allowClose = false, rendererGone = false;
const webVersion = require("../package.json").webVersion || require("../package.json").version;
const desktopVersion = app.isPackaged ? app.getVersion() : require("js-yaml").load(require("node:fs").readFileSync(path.join(__dirname,"..","electron-builder.yml"),"utf8")).extraMetadata.version;
const downloads = new Set();

function notifyExport(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(`(() => { const el=document.getElementById('toast'); if(el){el.textContent=${JSON.stringify(message)};el.style.display='block';setTimeout(()=>{el.style.display='none';},5000);} })()`).catch(() => {});
}
async function runCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed() || closing) return false;
  try { return await mainWindow.webContents.executeJavaScript(command, true) !== false; }
  catch { await dialog.showMessageBox(mainWindow, { type: "error", message: "操作未完成，请检查页面提示后重试。" }); return false; }
}
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "文件", submenu: [
      { label: "完整备份…", click: () => runCommand("window.App?.downloadLibrary()") },
      { label: "备份与恢复", click: () => runCommand("window.App?.saveMenu()") },
      { type: "separator" },
      { label: "导出当前 PDF…", accelerator: "CmdOrCtrl+Shift+P", click: () => runCommand("window.App?.downloadPDF()") },
      { label: "打印当前报告…", accelerator: "CmdOrCtrl+P", click: () => runCommand("window.App?.print()") },
      { type: "separator" }, { role: "close", label: "退出", accelerator: "Alt+F4" }
    ] },
    { label: "编辑", submenu: [{role:"undo",label:"撤销"},{role:"redo",label:"重做"},{type:"separator"},{role:"cut",label:"剪切"},{role:"copy",label:"复制"},{role:"paste",label:"粘贴"},{role:"selectAll",label:"全选"}] },
    { label: "视图", submenu: [{role:"resetZoom",label:"实际大小"},{role:"zoomIn",label:"放大"},{role:"zoomOut",label:"缩小"},{role:"togglefullscreen",label:"全屏"}] },
    { label: "帮助", submenu: [
      { label: "应用设置", click: () => runCommand("window.App?.openSettings('app')") },
      { label: "检查更新", click: async () => { if (await runCommand("window.App?.openSettings('app')")) await updateService?.checkForUpdates(); } },
      { type: "separator" },
      { label: "桌面版使用说明", click: () => shell.openExternal("https://github.com/ZekeNiu/MotionBench/blob/main/docs/windows-desktop.md") },
      { label: "打开本机数据目录", click: () => shell.openPath(dataDirectory) },
      { label: "关于 MotionBench", click: () => runCommand("window.App?.openSettings('app')") }
    ] }
  ]));
}
async function prepareExit(restarting = false) {
  if (downloads.size) return {ok:false,reason:"文件正在保存，请完成或取消文件保存后重试。"};
  await mainWindow.webContents.executeJavaScript("document.documentElement.inert=true");
  let status = await mainWindow.webContents.executeJavaScript("window.App?.prepareDesktopClose() || ({ok:false,reason:'工作台尚未准备完成，请稍后重试。'})");
  if (!status.ok && status.discardable) {
    const answer = await dialog.showMessageBox(mainWindow, {type:"question",message:status.reason,detail:"已录入的有效测试数据会先保存。尚未提交的设置或管理表单将放弃。",buttons:["返回继续编辑",restarting?"放弃表单并更新":"放弃表单并退出"],defaultId:0,cancelId:0});
    if (answer.response !== 1) return {ok:false,reason:"已返回编辑，完成设置后可重试。"};
    status = await mainWindow.webContents.executeJavaScript("window.App.prepareDesktopClose({discardSettings:true})");
  }
  if (status.ok) session.defaultSession.flushStorageData();
  return status;
}
function recoverRestart() {
  allowClose = false;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.executeJavaScript("document.documentElement.inert=false").catch(() => {});
}
async function prepareRestart() {
  if (closing || rendererGone || !mainWindow || mainWindow.isDestroyed()) return {ok:false,reason:"当前工作台无法确认保存，请稍后重试。"};
  closing = true;
  let status;
  try { status = await prepareExit(true); if (status.ok) allowClose = true; return status; }
  catch { return {ok:false,reason:"退出前未能确认保存，请检查当前数据后重试。"}; }
  finally { closing=false; if (!status?.ok) recoverRestart(); }
}
async function closeSafely(event) {
  if (allowClose) return;
  event.preventDefault();
  if (closing) return;
  closing = true;
  try {
    if (rendererGone) {
      const answer = await dialog.showMessageBox(mainWindow, {type:"warning",message:"界面进程已停止，无法确认最后的内存修改。",detail:"已保存资料仍保留在本机；重新打开后会恢复已保存数据和录入草稿。",buttons:["退出程序","暂不退出"],defaultId:0,cancelId:1});
      if (answer.response === 0) { allowClose=true;mainWindow.destroy(); }
      return;
    }
    // Freeze interaction for the short save barrier, so a new edit cannot race
    // the snapshot being committed. Native confirmation remains interactive.
    const status = await prepareExit();
    if (!status.ok) {
      await dialog.showMessageBox(mainWindow, {type:"warning",message:status.reason || "保存未完成，请重试。"});
      return;
    }
    allowClose = true;
    mainWindow.destroy();
  } catch {
    if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, {type:"error",message:"退出前未能确认保存完成。请返回检查保存状态并导出完整备份。"});
  } finally {
    closing = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.executeJavaScript("document.documentElement.inert=false").catch(() => {});
  }
}
async function start() {
  await fs.mkdir(dataDirectory, {recursive:true});
  const ses = session.defaultSession;
  const token = crypto.randomBytes(32).toString("hex");
  const isTrustedSender = event => {
    const contents = mainWindow?.webContents;
    return !!contents && !contents.isDestroyed() && event?.sender === contents &&
      event.senderFrame === contents.mainFrame && event.senderFrame?.url === APP_URL && contents.getURL() === APP_URL;
  };
  const ai = createAIService({directory:dataDirectory,safeStorage,origin:APP_ORIGIN,token,fetch:net.fetch.bind(net)});
  const aiBridge = createAIBridge({service:ai,origin:APP_ORIGIN,token,isTrustedSender});
  updateService = createUpdateService({directory:dataDirectory,version:desktopVersion,webVersion,
    portable:!!process.env.PORTABLE_EXECUTABLE_FILE,enabled:app.isPackaged && process.platform === "win32" && !testMode,
    createUpdater:() => createWindowsUpdater(require("electron-updater").NsisUpdater,{provider:"github",owner:"ZekeNiu",repo:"MotionBench",channel:"desktop",private:false}),
    openExternal:url => shell.openExternal(url),prepareRestart,recoverRestart});
  const updateBridge = createUpdateBridge({service:updateService,isTrustedSender});
  ipcMain.handle("motionbench:update",(event,...args) => updateBridge.handle(event,...args));
  updateService.onUpdateState(state => {
    const contents = mainWindow?.webContents;
    if (contents && !contents.isDestroyed() && contents.getURL() === APP_URL && contents.mainFrame.url === APP_URL) contents.send("motionbench:update-state",state);
  });
  ipcMain.handle("motionbench:ai-request", (event, ...args) => aiBridge.handle(event, ...args));
  ipcMain.on("motionbench:ai-cancel", (event, id) => aiBridge.cancel(event, id));
  const original = await fs.readFile(path.join(app.getAppPath(), "MotionBench.html"), "utf8");
  const bootstrap = `<script id="motionbench-local-bootstrap">window.MotionBenchLocal=Object.freeze({native:true});window.MotionBenchDesktop=Object.freeze({version:${JSON.stringify(desktopVersion)},webVersion:${JSON.stringify(webVersion)}});</script>`;
  const html = original.replace("<head>", "<head>" + bootstrap);
  if (html === original) throw Error("MotionBench application document has no head");
  protocol.handle("motionbench", async request => {
    if (!isAppURL(request.url)) return new Response("Forbidden", {status:403});
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return new Response("Forbidden", {status:403});
    if (url.pathname !== "/MotionBench.html" || request.method !== "GET") return new Response("Not found",{status:404});
    return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":CSP,"X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}});
  });
  ses.setPermissionRequestHandler((contents,permission,callback) => callback(permission === "clipboard-sanitized-write" && contents === mainWindow?.webContents && isAppURL(contents.getURL())));
  ses.setPermissionCheckHandler((contents,permission) => permission === "clipboard-sanitized-write" && contents === mainWindow?.webContents && isAppURL(contents.getURL()));
  ses.webRequest.onBeforeRequest((details, callback) => {
    // All renderer assets are bundled. AI networking runs only in the host.
    callback({cancel: /^(?:https?|file|ftp|wss?):/i.test(details.url) && details.webContentsId === mainWindow?.webContents.id});
  });
  ses.on("will-download", (_event, item, contents) => {
    if (contents !== mainWindow?.webContents || !isAppURL(contents.getURL())) { item.cancel(); return; }
    const filename = safeFilename(item.getFilename());
    downloads.add(item);
    if (testExportDirectory) {
      require("node:fs").mkdirSync(testExportDirectory, {recursive:true});
      item.setSavePath(path.join(testExportDirectory, filename));
    } else {
      item.setSaveDialogOptions({title:"保存 MotionBench 文件",defaultPath:path.join(app.getPath("downloads"),filename),filters:exportFilters(filename)});
    }
    item.once("done", (_event, state) => {
      downloads.delete(item);
      notifyExport(state === "completed" ? "文件已保存：" + filename : state === "cancelled" ? "已取消文件保存" : "文件保存失败，请检查路径及可用空间后重试");
    });
  });
  mainWindow = new BrowserWindow({
    width:1440,height:960,minWidth:900,minHeight:650,show:false,title:"MotionBench",backgroundColor:"#f5f6f8",
    icon:path.join(__dirname,"assets","motionbench.png"),
    webPreferences:{preload:path.join(__dirname,"preload.cjs"),nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}
  });
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    const link = externalURL(url); if(link) shell.openExternal(link).catch(() => {});
    return {action:"deny"};
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === APP_URL) return;
    event.preventDefault();const link=externalURL(url);if(link)shell.openExternal(link).catch(()=>{});
  });
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
  mainWindow.webContents.on("render-process-gone", () => {rendererGone=true;if(!allowClose)mainWindow.close();});
  mainWindow.on("close", closeSafely);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {aiBridge.cancelAll();updateService.dispose();mainWindow=null;});
  buildMenu();
  await mainWindow.loadURL(APP_URL);
  void updateService.scheduleStartup(mainWindow.webContents.executeJavaScript("window.App?.ready || false"));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
  app.whenReady().then(start).catch(async () => {await dialog.showMessageBox({type:"error",message:"MotionBench 启动失败，请核对程序文件和本机数据目录权限。"});app.exit(1);});
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", event => {if(mainWindow&&!allowClose){event.preventDefault();mainWindow.close();}});
}
