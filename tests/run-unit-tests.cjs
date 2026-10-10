"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, '..');
const artifactIndex = process.argv.indexOf('--artifact-dir');
const artifactArg = process.argv.find(arg => arg.startsWith('--artifact-dir='))?.slice(15);
const artifactDir = artifactArg || (artifactIndex >= 0 ? process.argv[artifactIndex + 1] : 'output/tests/v2.18.0-dual-elasticity-final');
if (!artifactDir || artifactDir.startsWith('--')) throw Error('--artifact-dir requires a directory');
const resultDir = path.resolve(root, artifactDir);
const outputRelative = path.relative(path.join(root, 'output'), resultDir);
if (!outputRelative || outputRelative.startsWith('..') || path.isAbsolute(outputRelative)) throw Error('Artifacts must stay in a subdirectory of output');
fs.mkdirSync(resultDir, { recursive: true });
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const moduleFiles = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js'));
const summary = { sourceHash: digest(path.join(root, 'Ringside_Boxing_Assessment.html')), runnerSha256: digest(__filename),
  modules: Object.fromEntries(moduleFiles.map(name => [name, digest(path.join(root, 'src', name))])), suites: [] };
for (const name of [
  "model-tests.cjs",
  "athlete-context-model-tests.cjs",
  "athlete-context-excel-tests.cjs",
  "athlete-context-report-tests.cjs",
  "fvp-model-tests.cjs",
  "dual-elasticity-model-tests.cjs",
  "dual-elasticity-report-model-tests.cjs",
  "sprint-elasticity-model-tests.cjs",
  "sprint-fvp-model-tests.cjs",
  "sprint-fvp-display-model-tests.cjs",
  "sprint-fvp-display-report-model-tests.cjs",
  "sprint-fvp-entry-controls-tests.cjs",
  "sprint-fvp-confidence-model-tests.cjs",

  "sprint-fvp-usability-model-tests.cjs",
  "sprint-capability-report-model-tests.cjs",
  "capability-directions-model-tests.cjs",
  "sprint-fvp-excel-model-tests.cjs",
  "fvp-report-model-tests.cjs",
  "report-v216-model-tests.cjs",
  "report-v2161-model-tests.cjs",
  "dsi-v2161-model-tests.cjs",
  "fvp-excel-model-tests.cjs",
  "entry-session-model-tests.cjs",
  "entry-session-save-model-tests.cjs",
  "ordinary-save-model-tests.cjs",
  "isometric-selection-model-tests.cjs",
  "picker-model-tests.cjs",
  "excel-model-tests.cjs",
  "excel-v216-tests.cjs",
  "derived-jump-model-tests.cjs",
  "v216-direction-model-tests.cjs",
  "isometric-reference-model-tests.cjs",
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
  const suiteSha256 = digest(path.join(__dirname, name));
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], {
    encoding: "utf8",
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  summary.suites.push({ name, sha256: suiteSha256, sourceUnchanged: digest(path.join(__dirname, name)) === suiteSha256, exitCode: result.status, checksPassed: Number(result.stdout?.match(/(\d+) [^\n]*checks passed/)?.[1] || result.stdout?.match(/PASS (\d+) athlete context (?:model|Excel) scenarios/)?.[1] || 0), stdout: result.stdout, stderr: result.stderr });
  fs.writeFileSync(path.join(resultDir, 'unit-results.json'), JSON.stringify(summary, null, 2));
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
summary.sourceUnchanged = digest(path.join(root, 'Ringside_Boxing_Assessment.html')) === summary.sourceHash &&
  digest(__filename) === summary.runnerSha256 && moduleFiles.every(name => digest(path.join(root, 'src', name)) === summary.modules[name]) &&
  summary.suites.every(suite => digest(path.join(__dirname, suite.name)) === suite.sha256);
fs.writeFileSync(path.join(resultDir, 'unit-results.json'), JSON.stringify(summary, null, 2));
if (!summary.sourceUnchanged || summary.suites.some(suite => !suite.sourceUnchanged)) throw Error('Unit test inputs changed during execution');
