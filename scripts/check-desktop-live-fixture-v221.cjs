"use strict";
// This baseline is the immutable public 2.20.0 release, not a rebuilt fixture.
const fs=require("node:fs/promises"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto"),asar=require("@electron/asar"),yaml=require("js-yaml");
if(process.env.GITHUB_ACTIONS!=="true"||process.env.CI!=="true"||process.platform!=="win32")throw Error("Public baseline installation validation runs only in an isolated Windows Actions user");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/desktop-live-update-v221"),oldVersion="2.20.0-desktop.1",targetVersion="2.20.1-desktop.1";
const expected={installerSha256:"08e2107de7865f656b8c24e36d9eb9d37e3631f9e342a7e1a42b123984d6b566",installerBytes:113625774,archiveSha256:"5f4dfe16d72d34b84baaa8a65f12494a08fac2c55318f36b007d13cb62a32a84",htmlSha256:"9fdac139dcad46a4f533877296f9000abdf9a91ec2d68fae1164453f9d19beae"};
const installer=path.join(out,`baseline/MotionBench-${oldVersion}-Setup-x64.exe`),receipt=path.join(out,"fixture-package.json"),hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
(async()=>{
  await fs.mkdir(path.dirname(installer),{recursive:true});
  const args=process.argv.slice(2);assert.ok(args.length===0||args.length===2&&args[0]==="--installed","Use no arguments to download, or --installed <owned executable>");
  const packageJSON=JSON.parse(await fs.readFile(path.join(root,"package.json"),"utf8")),production=yaml.load(await fs.readFile(path.join(root,"electron-builder.yml"),"utf8"));
  assert.equal(packageJSON.version,"2.20.1");assert.equal(production.extraMetadata.version,targetVersion);assert.equal(production.extraMetadata.webVersion,"2.20.1");
  const sourceFiles=["MotionBench.html",...(await fs.readdir(path.join(root,"desktop"))).filter(name=>name.endsWith(".cjs")).map(name=>"desktop/"+name)],sourceHashes={};
  for(const file of sourceFiles)sourceHashes[file]=hash(await fs.readFile(path.join(root,file)));
  const url=`https://github.com/ZekeNiu/MotionBench/releases/download/v${oldVersion}/MotionBench-${oldVersion}-Setup-x64.exe`;
  if(!args.length){const response=await fetch(url);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,expected.installerBytes);assert.equal(hash(bytes),expected.installerSha256);await fs.writeFile(installer,bytes);}
  const installerBytes=await fs.readFile(installer);assert.equal(installerBytes.length,expected.installerBytes);assert.equal(hash(installerBytes),expected.installerSha256);
  const result={synthetic:true,publicBaseline:true,baselinePublished:true,passed:true,version:oldVersion,webVersion:"2.20.0",targetVersion,targetWebVersion:"2.20.1",baselineInstallerURL:url,sourceHashes,installerSha256:expected.installerSha256,installerBytes:expected.installerBytes,archiveSha256:expected.archiveSha256,runtimeHtmlSha256:expected.htmlSha256,updaterCacheDirName:"motionbench-updater",scriptSha256:hash(await fs.readFile(__filename)),installedArchiveVerified:false};
  if(args.length){
    assert.ok(process.env.RUNNER_TEMP);const exe=path.resolve(args[1]);assert.ok(exe.toLowerCase().startsWith(path.resolve(process.env.RUNNER_TEMP).toLowerCase()+path.sep));
    const archive=path.join(path.dirname(exe),"resources/app.asar");assert.equal(hash(await fs.readFile(archive)),expected.archiveSha256);
    const runtime=file=>asar.extractFile(archive,path.normalize(file)),metadata=JSON.parse(runtime("package.json"));assert.equal(metadata.version,oldVersion);assert.equal(metadata.webVersion,"2.20.0");assert.equal(metadata.name,packageJSON.name);assert.equal(hash(runtime("MotionBench.html")),expected.htmlSha256);
    const configuration=yaml.load(await fs.readFile(path.join(path.dirname(archive),"app-update.yml"),"utf8"));assert.equal(configuration.provider,"github");assert.equal(configuration.owner,"ZekeNiu");assert.equal(configuration.repo,"MotionBench");assert.equal(configuration.channel,"desktop");assert.equal(configuration.updaterCacheDirName,result.updaterCacheDirName);
    result.installedArchiveVerified=true;
  }
  await fs.writeFile(receipt,JSON.stringify(result,null,2)+"\n");console.log(args.length?"Installed public baseline bytes and update channel verified":"Real public baseline installer downloaded and pinned; target production source identified");
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
