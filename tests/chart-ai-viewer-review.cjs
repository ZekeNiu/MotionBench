/* Verify the delivered comparison viewer, without revisiting application workflows. */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {pathToFileURL}=require('url'),{chromium}=require('./helpers/playwright.cjs');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'output/playwright/chart-ai');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{const browser=await chromium.launch();const result={sourceHash:hash(path.join(root,'MotionBench.html')),viewerSha256:hash(path.join(dir,'comparison.html')),scenes:[],errors:[],network:[]};
try {
 const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>result.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))result.network.push(r.url());});
 await page.goto(pathToFileURL(path.join(dir,'comparison.html')).href);
 const values=await page.locator('#scene option').evaluateAll(xs=>xs.map(x=>x.value));assert.equal(values.length,12);
 for(const value of values){await page.locator('#scene').selectOption(value);await page.waitForFunction(()=>['before','after'].every(id=>{const i=document.getElementById(id);return i.complete&&i.naturalWidth>0}));result.scenes.push(value);}
 for(const mode of ['after','before','both']){await page.locator('[data-mode="'+mode+'"]').click();for(const version of ['before','after'])assert.equal(await page.locator('#'+version+'Panel').isVisible(),mode==='both'||mode===version);}
 result.modes=true;await page.locator('#afterZoom').click();assert(await page.locator('#zoom').isVisible());await page.keyboard.press('Escape');assert(!(await page.locator('#zoom').isVisible()));result.zoom=true;
 await page.setViewportSize({width:390,height:844});result.mobileNoOverflow=await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth);assert(result.mobileNoOverflow);
 assert.equal(result.errors.length,0);assert.equal(result.network.length,0);result.pass=true;
}catch(e){result.pass=false;result.errors.push(e.stack);process.exitCode=1;}finally{fs.writeFileSync(path.join(dir,'viewer-review.json'),JSON.stringify(result,null,2));await browser.close();}console.log('Comparison viewer',result.pass?'PASS':'FAIL',result.scenes.length,'scenes');})();
