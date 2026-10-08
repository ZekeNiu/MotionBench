"use strict";
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/tests');fs.mkdirSync(out,{recursive:true});
const result={sourceHash:createHash('sha256').update(fs.readFileSync(path.join(root,'MotionBench.html'))).digest('hex'),suites:[],pass:false};
const suites=[
 ['unified-entry-browser-tests.cjs',false],['unified-entry-browser-tests.cjs',true],
 ['excel-workflow-browser-tests.cjs',false],['excel-workflow-browser-tests.cjs',true],
 ['refinement-workflow-browser-tests.cjs',false],['refinement-race-browser-tests.cjs',false],
 ['report-toolbar-browser-tests.cjs',false],['isometric-selection-browser-tests.cjs',false],
 ['management-resilience-tests.cjs',false],['chart-ai-browser-tests.cjs',false],
 ['capability-report-browser-tests.cjs',false],['ai-narrative-browser-tests.cjs',false],
];
if(process.argv.includes('--resume')){
 const previous=JSON.parse(fs.readFileSync(path.join(out,'v214-browser-regression.json'),'utf8'));
 if(previous.sourceHash!==result.sourceHash)throw Error('Cannot resume checks for a different HTML artifact');
 for(let index=0;index<previous.suites.length;index++){
  const item=previous.suites[index],expected=suites[index];
  if(!expected||item.name!==expected[0]+(expected[1]?' (Edge)':''))throw Error('Regression suite order changed');
  if(item.exitCode!==0)break;
  result.suites.push(item);
 }
 result.previousFailures=[...(previous.previousFailures||[]),...previous.suites.filter(s=>s.exitCode!==0)];
}
for(const [name,edge]of suites.slice(result.suites.length)){
 console.log('RUN',name,edge?'Edge':'Chrome');
 const execution=spawnSync(process.execPath,[path.join(__dirname,name),...(edge?['--edge']:[])],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:12*1024*1024});
 process.stdout.write(execution.stdout||'');process.stderr.write(execution.stderr||'');
 result.suites.push({name:name+(edge?' (Edge)':''),exitCode:execution.status,checksPassed:(execution.stdout.match(/^PASS\b/gm)||[]).length,stdout:execution.stdout,stderr:execution.stderr});
 fs.writeFileSync(path.join(out,'v214-browser-regression.json'),JSON.stringify(result,null,2));
 if(execution.error||execution.status!==0){process.exitCode=1;break;}
}
result.pass=result.suites.length===suites.length&&result.suites.every(s=>s.exitCode===0);
fs.writeFileSync(path.join(out,'v214-browser-regression.json'),JSON.stringify(result,null,2));
