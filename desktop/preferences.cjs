"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

// Preferences are separate from the assessment library and encrypted AI settings.
class DesktopPreferences {
  constructor(directory, io = fs) {
    if (!path.isAbsolute(directory)) throw new TypeError("An absolute preferences directory is required");
    this.directory = directory;
    this.file = path.join(directory, "desktop-preferences.json");
    this.io = io;
    this.queue = Promise.resolve();
  }
  async read() {
    let handle;
    try {
      handle = await this.io.open(this.file, "r");
      const stat = await handle.stat();
      if (stat.size > 16384) throw new Error("oversized preferences");
      const raw = await handle.readFile("utf8");
      const value = JSON.parse(raw);
      if (!value || value.schema !== 1 || typeof value.checkUpdatesOnStartup !== "boolean") throw new Error("invalid preferences");
      return { checkUpdatesOnStartup: value.checkUpdatesOnStartup, preferenceError: "" };
    } catch (error) {
      if (error.code === "ENOENT") return { checkUpdatesOnStartup: true, preferenceError: "" };
      return { checkUpdatesOnStartup: false, preferenceError: "无法读取更新设置，启动检查已停用。请保留原设置文件并检查本机数据目录。" };
    } finally { await handle?.close(); }
  }
  save(patch) {
    if (!patch || Object.getPrototypeOf(patch) !== Object.prototype || Object.keys(patch).length !== 1 || typeof patch.checkUpdatesOnStartup !== "boolean")
      return Promise.reject(new TypeError("Invalid update preferences"));
    // Do not let a caller mutate an object while its write is waiting in the queue.
    const enabled = patch.checkUpdatesOnStartup;
    const operation = this.queue.then(async () => {
      const current = await this.read();
      if (current.preferenceError) throw new Error("Existing preferences are unreadable");
      await this.io.mkdir(this.directory, { recursive: true });
      const temporary = this.file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
      let handle;
      try {
        handle = await this.io.open(temporary, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ schema: 1, checkUpdatesOnStartup: enabled }) + "\n", "utf8");
        await handle.sync();
        await handle.close(); handle = null;
        await this.io.rename(temporary, this.file);
      } finally {
        await handle?.close();
        await this.io.unlink(temporary).catch(() => {});
      }
      return { checkUpdatesOnStartup: enabled, preferenceError: "" };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
module.exports = { DesktopPreferences };
