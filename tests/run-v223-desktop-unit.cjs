"use strict";
const fs = require("node:fs"), path = require("node:path"), {spawnSync} = require("node:child_process"), {createHash} = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/tests/v223/desktop-unit");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out, {recursive:true});
const source = path.join(root, "MotionBench.html");
const runtimeFiles = fs.readdirSync(path.join(root,"desktop")).filter(name => name.endsWith(".cjs"));
const runtimeHashes = Object.fromEntries(runtimeFiles.map(name => ["desktop/"+name,hash(path.join(root,"desktop",name))]));
const result = {sourceHash:hash(source), runnerSha256:hash(__filename), runtimeHashes, suites:[], pass:false};
for (const name of ["desktop-security-tests.cjs", "desktop-ai-tests.cjs", "desktop-ai-bridge-tests.cjs", "desktop-bridge-tests.cjs", "desktop-update-tests.cjs"]) {
  const file = path.join(__dirname, name), digest = hash(file);
  const run = spawnSync(process.execPath, [file], {cwd:root, encoding:"utf8"});
  const log = path.join(out, name + ".txt"); fs.writeFileSync(log, (run.stdout || "") + (run.stderr || ""));
  const suite = {name,sha256:digest,exitCode:run.status,sourceUnchanged:hash(file) === digest,log:path.relative(root,log).replaceAll("\\","/"),logSha256:hash(log)};
  result.suites.push(suite); console.log(`${run.status === 0 ? "PASS" : "FAIL"} ${name}`);
}
result.sourceUnchanged = hash(source) === result.sourceHash && Object.entries(runtimeHashes).every(([file,digest]) => hash(path.join(root,file)) === digest);
result.pass = result.sourceUnchanged && result.suites.every(suite => suite.exitCode === 0 && suite.sourceUnchanged);
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result,null,2));
if (!result.pass) process.exitCode = 1;
