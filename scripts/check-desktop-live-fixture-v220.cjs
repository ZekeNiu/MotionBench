"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto"),asar=require("@electron/asar"),yaml=require("js-yaml");
if(process.env.GITHUB_ACTIONS!=="true"||process.env.CI!=="true"||process.platform!=="win32")throw Error("The unpublished live-update fixture runs only on an isolated Windows CI worker");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/desktop-live-update-v220"),archive=path.join(out,"fixture-build/win-unpacked/resources/app.asar"),hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const runtime=file=>asar.extractFile(archive,path.normalize(file));
const metadata=JSON.parse(runtime("package.json"));assert.equal(metadata.version,"2.20.0-desktop.0");assert.equal(metadata.webVersion,"2.20.0");
const sourcePackage=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")),productionConfig=yaml.load(fs.readFileSync(path.join(root,"electron-builder.yml"),"utf8")),fixtureConfig=yaml.load(fs.readFileSync(path.join(out,"fixture-config.yml"),"utf8"));
assert.equal(sourcePackage.version,"2.20.0");assert.equal(productionConfig.extraMetadata.version,"2.20.0-desktop.1");assert.equal(productionConfig.extraMetadata.webVersion,"2.20.0");
const expectedFixture=structuredClone(productionConfig);expectedFixture.extraMetadata.version="2.20.0-desktop.0";expectedFixture.directories.output="output/desktop-live-update-v220/fixture-build";
assert.deepEqual(fixtureConfig,expectedFixture,"Fixture configuration may change only the desktop version and owned build output");
assert.equal(metadata.name,sourcePackage.name);
const sourceFiles=["MotionBench.html",...fs.readdirSync(path.join(root,"desktop")).filter(name=>name.endsWith(".cjs")).map(name=>"desktop/"+name)];
const sourceHashes={};for(const file of sourceFiles){const bytes=fs.readFileSync(path.join(root,file));assert.ok(runtime(file).equals(bytes),"Fixture changes production source: "+file);sourceHashes[file]=hash(bytes);}
const configuration=yaml.load(fs.readFileSync(path.join(path.dirname(archive),"app-update.yml"),"utf8"));assert.equal(configuration.provider,"github");assert.equal(configuration.owner,"ZekeNiu");assert.equal(configuration.repo,"MotionBench");assert.equal(configuration.channel,"desktop");
assert.match(configuration.updaterCacheDirName,/^[A-Za-z0-9_-]+$/);
const installer=path.join(out,"fixture-build/MotionBench-2.20.0-desktop.0-Setup-x64.exe");assert.ok(fs.statSync(installer).size>0);
const result={synthetic:true,unpublished:true,passed:true,version:metadata.version,webVersion:metadata.webVersion,targetVersion:productionConfig.extraMetadata.version,productionConfigurationMatched:true,sourceHashes,archiveSha256:hash(fs.readFileSync(archive)),installerSha256:hash(fs.readFileSync(installer)),updaterCacheDirName:configuration.updaterCacheDirName,fixtureConfigSha256:hash(fs.readFileSync(path.join(out,"fixture-config.yml"))),scriptSha256:hash(fs.readFileSync(__filename))};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"fixture-package.json"),JSON.stringify(result,null,2)+"\n");console.log("Unpublished .0 fixture preserves all production host and HTML bytes");
