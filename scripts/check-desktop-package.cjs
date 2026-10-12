'use strict';

// Inspect the actual packaged archive, rather than trusting the file glob config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const appDirectory = path.resolve(process.argv[2] || path.join(root, 'dist-desktop', 'win-unpacked'));
const archive = path.join(appDirectory, 'resources', 'app.asar');
const directoryOnly = process.argv.includes('--dir-only');
assert.ok(fs.existsSync(archive), `Missing packaged archive: ${archive}`);
const names = asar.listPackage(archive).map(name => name.replace(/\\/g, '/').replace(/^\//, ''));
// ASAR's lookup APIs split on the host path separator. Keep the manifest
// portable, but convert names back to native paths at the API boundary.
const archiveFiles = names.filter(name => !asar.statFile(archive, path.normalize(name)).files);
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const productionPackages = Object.entries(lock.packages).filter(([name, metadata]) => name.startsWith('node_modules/') && !metadata.dev && !metadata.devOptional);
const lockedInventory = new Set(productionPackages.map(([name, metadata]) => name.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/)[1] + '@' + metadata.version));
const packagedDependencies = new Map();
const allowed = /^(?:package\.json|MotionBench\.html|desktop\/[a-z0-9-]+\.cjs|desktop\/assets\/motionbench\.(?:ico|png)|vendor\/[a-z0-9-]+\.LICENSE\.txt|vendor\/versions\.json)$/;
for (const name of archiveFiles) {
  if (allowed.test(name)) continue;
  assert.ok(name.startsWith('node_modules/'), `Unexpected file in application archive: ${name}`);
  // Builder hoists production-only modules. Verify their actual name/version,
  // rather than requiring npm's development-time nested installation path.
  const index = name.lastIndexOf('node_modules/'), tail = name.slice(index + 13).split('/');
  const dependency = tail[0].startsWith('@') ? tail.slice(0, 2).join('/') : tail[0];
  const packageRoot = name.slice(0, index) + 'node_modules/' + dependency;
  if (!packagedDependencies.has(packageRoot)) {
    const manifest = packageRoot + '/package.json';
    assert.ok(archiveFiles.includes(manifest), `Missing production manifest: ${name}`);
    const metadata = JSON.parse(asar.extractFile(archive, path.normalize(manifest)).toString('utf8'));
    assert.equal(metadata.name, dependency, `Unexpected production package identity: ${manifest}`);
    assert.ok(lockedInventory.has(dependency + '@' + metadata.version), `Unlisted production dependency/version: ${manifest}`);
    packagedDependencies.set(packageRoot, {name:dependency,version:metadata.version});
  }
}
for (const name of ['package.json', 'MotionBench.html', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/security.cjs', 'desktop/ai-service.cjs', 'desktop/ai-bridge.cjs', 'desktop/preferences.cjs', 'desktop/update-service.cjs', 'desktop/update-bridge.cjs', 'desktop/windows-updater.cjs', 'desktop/assets/motionbench.ico', 'node_modules/electron-updater/package.json']) {
  assert.ok(archiveFiles.includes(name), `Missing packaged runtime asset: ${name}`);
}
assert.deepEqual(new Set([...packagedDependencies.values()].map(metadata => metadata.name + '@' + metadata.version)), lockedInventory, 'Bundled dependency inventory differs from the production lock');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builder = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
const packagedPackage = JSON.parse(asar.extractFile(archive, path.normalize('package.json')).toString('utf8'));
assert.equal(packagedPackage.name, sourcePackage.name);
assert.equal(packagedPackage.version, builder.extraMetadata.version);
assert.equal(packagedPackage.webVersion, sourcePackage.version);
assert.equal(builder.extraMetadata.webVersion, sourcePackage.version);
assert.equal(packagedPackage.main, 'desktop/main.cjs');
const sourceHtml = fs.readFileSync(path.join(root, 'MotionBench.html'));
const packagedHtml = asar.extractFile(archive, path.normalize('MotionBench.html'));
assert.deepEqual(packagedHtml, sourceHtml, 'Packaged HTML is stale or differs from the verified build');
const buildMarker = /window\.RingsideBuild=Object\.freeze\((\{[^\n]+\})\);/.exec(packagedHtml.toString('utf8'));
assert.ok(buildMarker, 'Missing shared build version');
assert.equal(JSON.parse(buildMarker[1]).version, sourcePackage.version);
const updaterConfigPath = path.join(appDirectory, 'resources', 'app-update.yml');
const updaterConfigurationPresent = fs.existsSync(updaterConfigPath);
if (updaterConfigurationPresent) {
  const updaterConfig = yaml.load(fs.readFileSync(updaterConfigPath, 'utf8'));
  for (const [key, expected] of Object.entries({provider:'github',owner:'ZekeNiu',repo:'MotionBench',channel:'desktop'})) assert.equal(updaterConfig[key],expected,`Wrong update ${key}`);
} else assert.ok(directoryOnly, 'Missing installer update configuration; --dir-only is only for a directory build');

// Chromium and Node ship with the application; no installed browser/runtime is needed.
for (const name of ['MotionBench.exe', 'resources.pak', 'icudtl.dat', 'LICENSE.electron.txt']) {
  assert.ok(fs.existsSync(path.join(appDirectory, name)), `Missing bundled runtime: ${name}`);
}
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const evidence = {
  version: packagedPackage.version,
  webVersion: sourcePackage.version,
  directoryOnly,
  updaterConfigurationPresent,
  productionDependencies: [...packagedDependencies.values()].sort((a,b) => a.name.localeCompare(b.name)),
  electron: sourcePackage.devDependencies.electron,
  electronBuilder: sourcePackage.devDependencies['electron-builder'],
  archiveSha256: hash,
  files: archiveFiles.sort(),
  verifiedAt: new Date().toISOString()
};
const evidenceDirectory = path.join(root, 'output', 'desktop-package');
fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(path.join(evidenceDirectory, 'package-check.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Verified ${archiveFiles.length} runtime assets in MotionBench ${packagedPackage.version}; archive SHA256 ${hash}`);
