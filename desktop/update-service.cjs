"use strict";
const { DesktopPreferences } = require("./preferences.cjs");
const REPOSITORY = "https://github.com/ZekeNiu/MotionBench";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-desktop\.(0|[1-9]\d*)$/;

function versionParts(value) {
  const match = typeof value === "string" && value.length < 80 && VERSION.exec(value);
  if (!match) throw new Error("Invalid desktop version");
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("Invalid desktop version");
  return parts;
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
function validateUpdateInfo(info) {
  versionParts(info?.version);
  const filename = `MotionBench-${info.version}-Setup-x64.exe`;
  const expectedURL = `${REPOSITORY}/releases/download/v${info.version}/${filename}`;
  if (!Array.isArray(info.files) || info.files.length !== 1) throw new Error("Invalid desktop update artifacts");
  const file = info.files[0];
  if (!file || (file.url !== filename && file.url !== expectedURL)) throw new Error("Invalid desktop installer URL");
  if (typeof file.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) || Buffer.from(file.sha512, "base64").length !== 64)
    throw new Error("Missing installer checksum");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Invalid installer size");
  if (info.path !== undefined && info.path !== filename) throw new Error("Inconsistent installer path");
  if (info.sha512 !== undefined && info.sha512 !== file.sha512) throw new Error("Inconsistent installer checksum");
  return { version: info.version, filename, sha512: file.sha512, size: file.size };
}
function releaseNotes(value) {
  const notes = Array.isArray(value) ? value.map(item => typeof item?.note === "string" ? item.note : "").join("\n\n") : typeof value === "string" ? value : "";
  const bounded = notes.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, 16000);
  // The locked GitHub provider returns Atom content as HTML. Parse only text;
  // SAX performs no DOM insertion, network requests, script or style execution.
  const parser = require("sax").parser(false, {lowercase:true}), output = [];
  let ignored = "";
  parser.ontext = text => { if (!ignored) output.push(text); };
  parser.oncdata = parser.ontext;
  parser.onscript = () => {};
  parser.onopentag = tag => {
    const name = tag.name.toLowerCase();
    if (ignored) return;
    if (name === "script" || name === "style") {ignored=name;return;}
    if (name === "li") output.push("\n• ");
    else if (/^(?:br|p|div|h[1-6]|ul|ol|blockquote|pre|table|tr)$/.test(name)) output.push("\n");
  };
  parser.onclosetag = tag => {
    const name = tag.toLowerCase();
    if (ignored) {if(name===ignored)ignored="";return;}
    if (/^(?:p|div|h[1-6]|li|ul|ol|blockquote|pre|table|tr)$/.test(name)) output.push("\n");
  };
  try { parser.write("<motionbench-release-root>" + bounded + "</motionbench-release-root>").close(); }
  catch { return ""; }
  return output.join("").replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim().slice(0,16000);
}
function configureUpdater(updater) {
  updater.channel = "desktop";
  updater.allowPrerelease = true;
  // The channel setter enables downgrades; reset it after assigning the channel.
  updater.allowDowngrade = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableWebInstaller = true;
  updater.logger = null;
  return updater;
}
function createUpdateService({ directory, version, webVersion, portable = false, enabled = true, createUpdater,
  preferences = new DesktopPreferences(directory), openExternal, prepareRestart, recoverRestart = () => {},
  timer = setTimeout, clearTimer = clearTimeout, clock = () => new Date().toISOString() }) {
  const state = { version, webVersion, portable: !!portable, checkUpdatesOnStartup: true, preferenceError: "",
    state: "idle", availableVersion: "", progress: null, releaseNotes: "", releaseUrl: "", error: "", lastCheckedAt: "" };
  const listeners = new Set(), bindings = [];
  let updater, checkPromise, downloadPromise, installBusy = false, accepted, startupTimer, disposed = false, checkResult;
  const snapshot = () => structuredClone(state);
  const emit = patch => { if (disposed) return; Object.assign(state, patch); for (const listener of listeners) { try { listener(snapshot()); } catch {} } };
  const initialized = preferences.read().then(value => emit(value)).catch(() => emit({ checkUpdatesOnStartup: false, preferenceError: "无法读取更新设置，启动检查已停用。" }));
  const cancelStartup = () => { if (startupTimer !== undefined) clearTimer(startupTimer); startupTimer = undefined; };
  const fail = (message, preserve = false) => {
    if (disposed) return snapshot();
    if (state.state === "installing") recoverRestart();
    emit({ state: preserve ? state.state : "error", error: message, progress: null });
    return snapshot();
  };
  const accept = info => {
    const result = validateUpdateInfo(info);
    if (compareVersions(result.version, version) <= 0) throw new Error("Update is not a newer desktop version");
    accepted = result;
    emit({ state: "available", availableVersion: result.version, progress: null, error: "",
      releaseUrl: `${REPOSITORY}/releases/tag/v${result.version}`, releaseNotes: releaseNotes(info.releaseNotes) });
  };
  function getUpdater() {
    if (updater) return updater;
    updater = configureUpdater(createUpdater());
    const bind = (name, listener) => { updater.on(name, listener); bindings.push([name, listener]); };
    bind("error", error => fail(error?.code === "ERR_CHECKSUM_MISMATCH" ? "更新文件校验失败，请重新下载。" : "更新未完成，请检查网络后重试。"));
    bind("download-progress", progress => {
      if (state.state !== "downloading") return;
      const number = value => Number.isFinite(value) ? Math.max(0, value) : 0;
      emit({ progress: { percent: Math.min(100, number(progress.percent)), transferred: number(progress.transferred), total: number(progress.total) } });
    });
    bind("update-downloaded", info => {
      try {
        const result = validateUpdateInfo(info);
        if (!accepted || Object.keys(result).some(key => result[key] !== accepted[key])) throw new Error("Downloaded update differs from accepted manifest");
        emit({ state: "downloaded", error: "", progress: null });
      } catch { fail("更新文件信息不匹配，请重新检查并下载。"); }
    });
    return updater;
  }
  async function checkForUpdates() {
    await initialized;
    cancelStartup();
    if (disposed) return snapshot();
    if (checkPromise) return checkPromise;
    if (downloadPromise || installBusy || state.state === "downloaded") return snapshot();
    if (!enabled) return fail("开发或测试环境不连接更新服务。");
    accepted = null;
    emit({ state: "checking", error: "", availableVersion: "", releaseUrl: "", releaseNotes: "", progress: null });
    checkPromise = (async () => {
      try {
        checkResult = await getUpdater().checkForUpdates();
        const info = checkResult?.updateInfo;
        const valid = validateUpdateInfo(info);
        emit({ lastCheckedAt: clock() });
        if (compareVersions(valid.version, version) > 0) accept(info);
        else emit({ state: "up-to-date", error: "" });
      } catch { fail("检查更新失败，请检查网络或稍后重试。"); }
      return snapshot();
    })();
    try { return await checkPromise; } finally { checkPromise = null; }
  }
  async function downloadUpdate() {
    await initialized;
    if (disposed || installBusy) return snapshot();
    if (downloadPromise) return downloadPromise;
    if (!accepted || !["available", "error"].includes(state.state)) return fail("请先检查新版本。", true);
    if (portable) {
      try { await openExternal(state.releaseUrl); emit({ error: "" }); }
      catch { fail("未能打开桌面版下载页面，请重试。", true); }
      return snapshot();
    }
    emit({ state: "downloading", error: "", progress: { percent: 0, transferred: 0, total: accepted.size } });
    downloadPromise = (async () => {
      try { await getUpdater().downloadUpdate(); if (state.state !== "downloaded") fail("新版下载未完成，请重新检查后重试。"); }
      catch (error) { fail(error?.code === "ERR_CHECKSUM_MISMATCH" ? "更新文件校验失败，请重新下载。" : "新版下载失败，请检查网络和磁盘空间后重试。"); }
      return snapshot();
    })();
    try { return await downloadPromise; } finally { downloadPromise = null; }
  }
  async function installUpdate() {
    await initialized;
    if (disposed || installBusy) return snapshot();
    if (portable) return fail("便携版请下载新版本，退出程序后替换便携程序。", true);
    if (state.state !== "downloaded" || !accepted) return fail("请先下载新版本。", true);
    installBusy = true;
    try {
      const result = await prepareRestart();
      if (!result?.ok) return fail(result?.reason || "退出前未能确认保存，请检查当前数据后重试。", true);
      emit({ state: "installing", error: "" });
      await getUpdater().quitAndInstall(true, true);
    } catch (error) { recoverRestart(); emit({ state: error?.code === "ERR_CHECKSUM_MISMATCH" ? "error" : "downloaded", error: error?.code === "ERR_CHECKSUM_MISMATCH" ? "更新文件校验失败，请重新下载。" : "更新安装未能启动，当前程序已保留，请重试。" }); }
    finally { installBusy = false; }
    return snapshot();
  }
  return {
    async getUpdateState() { await initialized; return snapshot(); },
    async setUpdatePreferences(patch) {
      await initialized;
      try { emit(await preferences.save(patch)); if (!state.checkUpdatesOnStartup) cancelStartup(); }
      catch { emit({ preferenceError: "更新设置未保存，原设置已保留。请检查本机数据目录后重试。" }); }
      return snapshot();
    },
    checkForUpdates, downloadUpdate, installUpdate,
    onUpdateState(listener) { if (typeof listener !== "function") throw new TypeError("A state listener is required"); listeners.add(listener); return () => listeners.delete(listener); },
    async scheduleStartup(ready, delay = 5000) {
      try {
        const [restored] = await Promise.all([ready, initialized]);
        if (restored !== true || !enabled || disposed || !state.checkUpdatesOnStartup || state.preferenceError) return;
        startupTimer = timer(() => { startupTimer = undefined; if (!disposed && state.checkUpdatesOnStartup) void checkForUpdates(); }, delay);
        startupTimer?.unref?.();
      } catch {}
    },
    dispose() { disposed = true; cancelStartup(); checkResult?.cancellationToken?.cancel(); for (const [name, listener] of bindings) if (name !== "error") updater.off(name, listener); listeners.clear(); },
  };
}
module.exports = { createUpdateService, configureUpdater, validateUpdateInfo, compareVersions, releaseNotes };
