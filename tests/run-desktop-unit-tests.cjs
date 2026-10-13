"use strict";
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),arg=process.argv.indexOf('--artifact-dir'),out=path.resolve(root,arg>=0?process.argv[arg+1]:'output/tests/v'+require('../package.json').version+'/desktop-unit');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');fs.mkdirSync(out,{recursive:true});
const source=path.join(root,'MotionBench.html'),runtime=fs.readdirSync(path.join(root,'desktop')).filter(name=>name.endsWith('.cjs'));
const result={sourceHash:hash(source),runnerSha256:hash(__filename),runtimeHashes:Object.fromEntries(runtime.map(name=>['desktop/'+name,hash(path.join(root,'desktop',name))])),suites:[],pass:false};
for(const name of ['desktop-security-tests.cjs','desktop-ai-tests.cjs','desktop-ai-bridge-tests.cjs','desktop-bridge-tests.cjs','desktop-update-tests.cjs']){
 const file=path.join(__dirname,name),sha256=hash(file),run=spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8'}),log=path.join(out,name+'.txt');
 fs.writeFileSync(log,(run.stdout||'')+(run.stderr||''));result.suites.push({name,sha256,exitCode:run.status,sourceUnchanged:hash(file)===sha256,log:path.relative(root,log).replaceAll('\\','/'),logSha256:hash(log)});console.log((run.status===0?'PASS ':'FAIL ')+name);
}
result.sourceUnchanged=hash(source)===result.sourceHash&&Object.entries(result.runtimeHashes).every(([file,digest])=>hash(path.join(root,file))===digest);
result.pass=result.sourceUnchanged&&result.suites.every(s=>s.exitCode===0&&s.sourceUnchanged);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
