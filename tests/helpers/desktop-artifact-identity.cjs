"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function desktopArtifactIdentity(root, executable, testScript) {
  const sourceHtml = fs.readFileSync(path.join(root,"MotionBench.html"));
  const runtimeFiles = fs.readdirSync(path.join(root,"desktop")).filter(name => name.endsWith(".cjs")).sort();
  const sourceHashes = Object.fromEntries(["package.json","package-lock.json","electron-builder.yml",...runtimeFiles.map(name=>"desktop/"+name)].map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
  const archive = path.join(path.dirname(executable),"resources/app.asar");
  const packaged = process.env.MOTIONBENCH_EXECUTABLE && fs.existsSync(archive);
  let runtimeHtml = sourceHtml, runtimeHashes = sourceHashes, archiveSha256 = "";
  if (packaged) {
    const asar = require("@electron/asar");runtimeHtml=asar.extractFile(archive,path.normalize("MotionBench.html"));
    runtimeHashes=Object.fromEntries(["package.json",...runtimeFiles.map(name=>"desktop/"+name)].map(file=>[file,hash(asar.extractFile(archive,path.normalize(file)))]));
    archiveSha256=hash(fs.readFileSync(archive));
  }
  return {sourceHtmlSha256:hash(sourceHtml),runtimeHtmlSha256:hash(runtimeHtml),sourceHashes,runtimeHashes,archiveSha256,
    runtimeMatchesSourceHtml:runtimeHtml.equals(sourceHtml),testScriptSha256:hash(fs.readFileSync(testScript)),identityHelperSha256:hash(fs.readFileSync(__filename))};
}
module.exports = {desktopArtifactIdentity};
