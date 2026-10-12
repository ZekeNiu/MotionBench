"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Named application operations only. No Node, filesystem, credentials or
// generic IPC API reach the renderer. Main validates every sender and argument.
contextBridge.exposeInMainWorld("MotionBenchNative", {
  requestAI: (route, body, requestId) => ipcRenderer.invoke("motionbench:ai-request", route, body, requestId),
  cancelAI: requestId => ipcRenderer.send("motionbench:ai-cancel", requestId),
  getUpdateState: () => ipcRenderer.invoke("motionbench:update", "getUpdateState"),
  setUpdatePreferences: patch => ipcRenderer.invoke("motionbench:update", "setUpdatePreferences", patch),
  checkForUpdates: () => ipcRenderer.invoke("motionbench:update", "checkForUpdates"),
  downloadUpdate: () => ipcRenderer.invoke("motionbench:update", "downloadUpdate"),
  installUpdate: () => ipcRenderer.invoke("motionbench:update", "installUpdate"),
  onUpdateState: listener => {
    if (typeof listener !== "function") throw new TypeError("A state listener is required");
    const receive = (_event, state) => listener(state);
    ipcRenderer.on("motionbench:update-state", receive);
    return () => ipcRenderer.removeListener("motionbench:update-state", receive);
  },
});
