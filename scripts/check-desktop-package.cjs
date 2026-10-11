'use strict';

// Inspect the actual packaged archive, rather than trusting the file glob config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const appDirectory = path.resolve(process.argv[2] || path.join(root, 'dist-desktop', 'win-unpacked'));
const archive = path.join(appDirectory, 'resources', 'app.asar');
assert.ok(fs.existsSync(archive), `Missing packaged archive: ${archive}`);
const names = asar.listPackage(archive).map(name => name.replace(/\\/g, '/').replace(/^\//, ''));
const archiveFiles = names.filter(name => !asar.statFile(archive, name).files);
const allowed = /^(?:package\.json|MotionBench\.html|desktop\/[a-z0-9-]+\.cjs|desktop\/assets\/motionbench\.(?:ico|png)|vendor\/[a-z0-9-]+\.LICENSE\.txt|vendor\/versions\.json)$/;
for (const name of archiveFiles) {
  assert.ok(allowed.test(name), `Unexpected file in application archive: ${name}`);
}
for (const name of ['package.json', 'MotionBench.html', 'desktop/main.cjs', 'desktop/security.cjs', 'desktop/ai-service.cjs', 'desktop/assets/motionbench.ico']) {
  assert.ok(archiveFiles.includes(name), `Missing packaged runtime asset: ${name}`);
}
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packagedPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(packagedPackage.name, sourcePackage.name);
assert.equal(packagedPackage.version, sourcePackage.version);
assert.equal(packagedPackage.main, 'desktop/main.cjs');
const sourceHtml = fs.readFileSync(path.join(root, 'MotionBench.html'));
const packagedHtml = asar.extractFile(archive, 'MotionBench.html');
assert.deepEqual(packagedHtml, sourceHtml, 'Packaged HTML is stale or differs from the verified build');
assert.ok(packagedHtml.toString('utf8').includes(sourcePackage.version), 'Missing current build version');

// Chromium and Node ship with the application; no installed browser/runtime is needed.
for (const name of ['MotionBench.exe', 'resources.pak', 'icudtl.dat', 'LICENSE.electron.txt']) {
  assert.ok(fs.existsSync(path.join(appDirectory, name)), `Missing bundled runtime: ${name}`);
}
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const evidence = {
  version: sourcePackage.version,
  electron: sourcePackage.devDependencies.electron,
  electronBuilder: sourcePackage.devDependencies['electron-builder'],
  archiveSha256: hash,
  files: archiveFiles.sort(),
  verifiedAt: new Date().toISOString()
};
const evidenceDirectory = path.join(root, 'output', 'desktop-package');
fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(path.join(evidenceDirectory, 'package-check.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Verified ${archiveFiles.length} runtime assets in MotionBench ${sourcePackage.version}; archive SHA256 ${hash}`);
