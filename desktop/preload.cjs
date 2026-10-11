"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Two named AI operations only. The renderer receives no Node, filesystem,
// credential, or generic IPC API. Main validates the sender and every request.
contextBridge.exposeInMainWorld("MotionBenchNative", {
  requestAI: (route, body, requestId) => ipcRenderer.invoke("motionbench:ai-request", route, body, requestId),
  cancelAI: requestId => ipcRenderer.send("motionbench:ai-cancel", requestId),
});
