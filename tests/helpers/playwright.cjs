"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// Prefer project dependencies. The environment override and existing npx cache
// let a developer run verification without installing a second browser runtime.
const candidates = [process.env.RINGSIDE_PLAYWRIGHT_PATH, "playwright"].filter(
  Boolean,
);
const cache = path.join(os.homedir(), "AppData/Local/npm-cache/_npx");
if (fs.existsSync(cache)) {
  fs.readdirSync(cache).forEach((name) =>
    candidates.push(path.join(cache, name, "node_modules/playwright")),
  );
}
let runtime;
for (const candidate of candidates) {
  try {
    runtime = require(candidate);
    break;
  } catch {}
}
if (!runtime)
  throw new Error(
    "Install Playwright or set RINGSIDE_PLAYWRIGHT_PATH to its module directory.",
  );
module.exports = runtime;
