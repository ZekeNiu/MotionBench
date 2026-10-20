"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium}=require('./helpers/playwright.cjs'),{createFixture}=require('./helpers/longitudinal-fixture.cjs');
const root=path.resolve(__dirname,'..'),arg=process.argv.indexOf('--artifact-dir'),out=path.resolve(arg>=0?process.argv[arg+1]:'output/pdf-page-isolation');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const result={sourceHash:hash(path.join(root,'MotionBench.html')),runnerSha256:hash(__filename),fixtureSha256:hash(path.join(__dirname,'helpers/longitudinal-fixture.cjs')),synthetic:true,checks:[],errors:[],pass:false};
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,'MotionBench.html')).href);await page.waitForFunction(()=>window.App?.ready);
  await page.addScriptTag({content:'window.makePageFixture='+createFixture.toString()});
  const proof=await page.evaluate(async()=>{
   const f=makePageFixture(window,3),m=RingsideLongitudinal.build(f.records,f),host=document.createElement('main');
   host.style='width:1160px';const view=RingsideLongitudinalView.render(m);host.innerHTML='<div class="micro-cards">'+view.summary+'</div>'+view.details;document.body.append(host);RingsideLongitudinalView.mount(host,m);RingsideLongitudinalView.layout(host);
   const before=JSON.stringify(f),html=host.outerHTML,original=html2canvas,samples=[];
   window.html2canvas=async(node,options)=>{
    if(typeof options.ignoreElements!=='function')throw Error('Production page isolation is missing');
    const start=performance.now(),filtered=await original(node,options),filteredMs=performance.now()-start,t=performance.now(),baseline=await original(node,{...options,ignoreElements:undefined}),baselineMs=performance.now()-t;
    const digest=async canvas=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data))).map(n=>n.toString(16).padStart(2,'0')).join('');
    samples.push({baselineMs,filteredMs,pixelsEqual:baseline.width===filtered.width&&baseline.height===filtered.height&&await digest(baseline)===await digest(filtered),pageNodes:node.querySelectorAll('*').length,bodyNodes:document.body.querySelectorAll('*').length});
    baseline.width=baseline.height=1;
    if(samples.length===2)throw Error('REPRESENTATIVE_CAPTURES_COMPLETE');return filtered;
   };
   try{await RingsidePDF.build({...m.periods.at(-1).record,longitudinal:true},host);throw Error('Capture stop was not reached');}
   catch(e){if(e.message!=='REPRESENTATIVE_CAPTURES_COMPLETE')throw e;}
   finally{window.html2canvas=original;}
   return{samples,unchanged:before===JSON.stringify(f)&&html===host.outerHTML};
  });
  assert.equal(proof.samples.length,2);assert.ok(proof.samples.every(p=>p.pixelsEqual));result.checks.push('production page isolation preserves every pixel on two representative report pages');
  assert.equal(proof.unchanged,true);assert.deepEqual(result.errors,[]);result.checks.push('representative captures leave the complete fixture and visible report unchanged');
  result.samples=proof.samples;assert.equal(hash(path.join(root,'MotionBench.html')),result.sourceHash);assert.equal(hash(__filename),result.runnerSha256);result.pass=true;
 }catch(e){result.failure=e.stack;console.error(e.stack);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));await browser.close();}
 console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,samples:result.samples}));
})();
