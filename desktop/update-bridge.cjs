"use strict";
const OPERATIONS = new Set(["getUpdateState", "setUpdatePreferences", "checkForUpdates", "downloadUpdate", "installUpdate"]);
function createUpdateBridge({ service, isTrustedSender }) {
  return {
    async handle(event, operation, ...args) {
      if (!isTrustedSender(event)) throw new Error("Untrusted update sender");
      if (!OPERATIONS.has(operation)) throw new Error("Invalid update operation");
      if (operation === "setUpdatePreferences") {
        const patch = args[0];
        if (args.length !== 1 || !patch || Object.getPrototypeOf(patch) !== Object.prototype || Object.keys(patch).length !== 1 || typeof patch.checkUpdatesOnStartup !== "boolean")
          throw new Error("Invalid update preferences");
      } else if (args.length) throw new Error("Unexpected update arguments");
      return service[operation](...args);
    },
  };
}
module.exports = { createUpdateBridge };
