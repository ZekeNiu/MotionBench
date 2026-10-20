"use strict";
// Explicit release identity; the shared runner preserves the complete strict guard.
process.env.MOTIONBENCH_RELEASE_CONFIG = require("node:path").join(__dirname, "../scripts/release-v2249.json");
require("./desktop-system-display.cjs");
