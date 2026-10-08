"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, '..');
const resultDir = path.join(root, 'output/tests');
fs.mkdirSync(resultDir, { recursive: true });
const summary = { sourceHash: createHash('sha256').update(fs.readFileSync(path.join(root, 'Ringside_Boxing_Assessment.html'))).digest('hex'), suites: [] };
for (const name of [
  "model-tests.cjs",
  "isometric-selection-model-tests.cjs",
  "picker-model-tests.cjs",
  "excel-model-tests.cjs",
  "derived-jump-model-tests.cjs",
  "cpet-reference-tests.cjs",
  "capability-cpet-model-tests.cjs",
  "force-model-tests.cjs",
  "viz-tests.cjs",
  "workflow-model-tests.cjs",
  "core-model-tests.cjs",
  "report-v2-model-tests.cjs",
  "chart-ai-model-tests.cjs",
  "repeat-model-tests.cjs",
  "management-model-tests.cjs",
  "imtp-standards-model-tests.cjs",
  "report-refinement-model-tests.cjs",
  "catalog-body-vift-model-tests.cjs",
  "store-catalog-model-tests.cjs",
  "report-v210-model-tests.cjs",
  "report-v211-model-tests.cjs",
]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], {
    encoding: "utf8",
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  summary.suites.push({ name, exitCode: result.status, checksPassed: Number(result.stdout?.match(/(\d+) [^\n]*checks passed/)?.[1] || 0), stdout: result.stdout, stderr: result.stderr });
  fs.writeFileSync(path.join(resultDir, 'unit-results.json'), JSON.stringify(summary, null, 2));
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
