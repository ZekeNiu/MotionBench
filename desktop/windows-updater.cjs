"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn: spawnProcess } = require("node:child_process");
const { validateUpdateInfo } = require("./update-service.cjs");

// Adapter for the locked electron-updater 6.8.9: its original NSIS method quits
// before the asynchronous installer spawn has succeeded. Keep the official
// downloader/cache, but wait for the Windows process before quitting our app.
function createWindowsUpdater(NsisUpdater, options, { spawn = spawnProcess } = {}) {
  return new (class extends NsisUpdater {
    async quitAndInstall(isSilent, isForceRunAfter) {
      if (this.quitAndInstallCalled || isSilent !== true || isForceRunAfter !== true) throw new Error("Invalid installer launch state");
      this.quitAndInstallCalled = true;
      try {
        const helper = this.downloadedUpdateHelper, installer = this.installerPath;
        const expected = validateUpdateInfo(helper?.versionInfo);
        if (!installer || helper.packageFile || helper.downloadedFileInfo?.isAdminRightsRequired) throw new Error("Invalid per-user installer");
        const stat = await fs.promises.stat(installer), digest = crypto.createHash("sha512");
        for await (const bytes of fs.createReadStream(installer)) digest.update(bytes);
        if (!stat.isFile() || stat.size !== expected.size || digest.digest("base64") !== expected.sha512) {
          await helper.clear();
          throw Object.assign(new Error("Installer checksum mismatch"), {code:"ERR_CHECKSUM_MISMATCH"});
        }
        const args = ["--updated", "/S", "--force-run"];
        // InstallationDirectory is host-owned. No renderer method accepts it.
        if (this.installDirectory) args.push(`/D=${this.installDirectory}`);
        await new Promise((resolve, reject) => {
          const child = spawn(installer, args, {windowsHide:true,shell:false,stdio:"ignore",detached:true});
          child.once("error", reject);
          child.once("spawn", () => { child.unref(); resolve(); });
        });
        this.app.quit();
      } catch (error) { this.quitAndInstallCalled=false; throw error; }
    }
  })(options);
}
module.exports = { createWindowsUpdater };
