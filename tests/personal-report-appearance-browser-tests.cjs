"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),channel=process.argv.includes("--edge")?"msedge":"chrome",index=process.argv.indexOf("--artifact-dir");
const out=index>=0?path.resolve(process.argv[index+1]):path.join(root,"output/playwright/personal-appearance",channel);
fs.mkdirSync(out,{recursive:true});const hash=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files=["src/ringside-report-appearance.js","src/ringside-viz.js","src/ringside.css","src/ringside-report-refinement.css"],sourceHashes=Object.fromEntries(files.map(file=>[file,hash(path.join(root,file))]));
const result={channel,runnerSha256:hash(__filename),sourceHashes,checks:[],screenshots:[],errors:[],pass:false};
(async()=>{
  const browser=await chromium.launch({channel,headless:true}),page=await browser.newPage({viewport:{width:1200,height:850}});page.on("pageerror",error=>result.errors.push(error.message));
  try{
    await page.setContent(`<style>${fs.readFileSync(path.join(root,"src/ringside.css"),"utf8")}\n${fs.readFileSync(path.join(root,"src/ringside-report-refinement.css"),"utf8")}\nbody{padding:20px;background:white}#reportView{padding:16px;max-width:none}#chart{background:white}.quality-heading{margin:0 0 12px}</style><div id="management"><div class="quality-heading"><h3>管理区域</h3></div></div><main id="reportView"><div class="quality-heading"><h3>跳跃测试</h3></div><div id="chart"></div></main>`);
    for(const file of files.slice(0,2))await page.addScriptTag({path:path.join(root,file)});
    const scoped=await page.evaluate(()=>{const report=document.querySelector("#reportView"),outside=document.querySelector("#management h3"),before=getComputedStyle(outside).color;RingsideReportAppearance.apply(report);const wrappers=["ringside-pdf-stage","ringside-pdf-document","ringside-pdf-page","horizontal-browser-print"].map(className=>{const clone=report.cloneNode(true);clone.removeAttribute("id");clone.className=className;clone.querySelector("#chart").remove();RingsideReportAppearance.apply(clone);document.body.appendChild(clone);const item={className,attribute:clone.dataset.reportAppearance,ink:getComputedStyle(clone).color,band:getComputedStyle(clone.querySelector(".quality-heading")).backgroundColor,statusGreen:getComputedStyle(clone).getPropertyValue("--green").trim()};clone.remove();return item;});return{before,after:getComputedStyle(outside).color,reportInk:getComputedStyle(report).color,band:getComputedStyle(report.querySelector(".quality-heading")).backgroundColor,statusGreen:getComputedStyle(report).getPropertyValue("--green").trim(),attribute:report.dataset.reportAppearance,wrappers};});
    assert.equal(scoped.before,scoped.after);assert.equal(scoped.reportInk,"rgb(33, 56, 54)");assert.equal(scoped.band,"rgb(246, 249, 248)");assert.equal(scoped.statusGreen,"#187459");assert.equal(scoped.attribute,"ink-teal-history-v1");result.scope=scoped;
    for(const wrapper of scoped.wrappers){assert.equal(wrapper.ink,scoped.reportInk);assert.equal(wrapper.band,scoped.band);assert.equal(wrapper.attribute,scoped.attribute);assert.equal(wrapper.statusGreen,scoped.statusGreen);}
    for(const fixture of["representative","equal-height-rsi","missing-height"])for(const width of[240,320,479,480,740,960])for(const print of[false,true]){
      const evidence=await page.evaluate(({fixture,width,print})=>{
        const chart=document.querySelector("#chart");chart.style.width=width+"px";
        let items=[{id:"cmj",label:"CMJ",value:42.4},{id:"sj",label:"SJ",value:36.8},{id:"dj",label:"DJ",value:34.6,rsi:1.72},{id:"hop",label:"Hop",value:29.6,rsi:1.92},{id:"cmrj",label:"CMRJ",value:39.2,rsi:1.83}];
        if(fixture==="equal-height-rsi")items=items.map(item=>({...item,value:35,...(item.rsi?{rsi:1.8}:{})}));
        if(fixture==="missing-height")items=[{id:"dj",label:"DJ",value:34.6,rsi:1.72},{id:"hop",label:"Hop",rsi:1.92}];
        const before=JSON.stringify(items);chart.innerHTML=RingsideViz.jumpBars(items,{width,height:print?273:390,print});
        const svg=chart.querySelector("svg"),bounds=svg.getBoundingClientRect();
        const box=node=>{const r=node.getBoundingClientRect();return{left:r.left-bounds.left,right:r.right-bounds.left,top:r.top-bounds.top,bottom:r.bottom-bounds.top};};
        const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.75&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.75;
        const bars=[...svg.querySelectorAll('[data-jump-series="height"] rect')].map(node=>({id:node.parentNode.dataset.jumpTest,...box(node)}));
        const values=[...svg.querySelectorAll("[data-jump-value]")].map(node=>({id:node.parentNode.dataset.jumpTest,kind:node.dataset.jumpValue,text:node.textContent,fill:node.getAttribute("fill"),stroke:node.getAttribute("stroke"),paintOrder:node.getAttribute("paint-order"),...box(node)}));
        const clipping=[...svg.querySelectorAll("text")].map(node=>({text:node.textContent,...box(node)})).filter(r=>r.left<-.75||r.right>bounds.width+.75||r.top<-.75||r.bottom>bounds.height+.75);
        const valueCollisions=values.flatMap((value,i)=>values.slice(i+1).filter(other=>overlap(value,other)).map(other=>({value,other})));
        const heightInBars=values.filter(value=>value.kind==="height"&&bars.some(bar=>overlap(value,bar)));
        const dots=[...svg.querySelectorAll('[data-jump-series="rsi"] circle')].map(box),valueMarkerCollisions=values.filter(value=>dots.some(dot=>overlap(value,dot)));
        return{fixture,width,print,values,bars,clipping,valueCollisions,heightInBars,valueMarkerCollisions,inputUnchanged:JSON.stringify(items)===before,heightCount:items.filter(item=>item.value!=null).length,rsiCount:items.filter(item=>item.rsi!=null).length,legendCount:svg.querySelectorAll("[data-jump-legend]").length};
      },{fixture,width,print});
      result.checks.push(evidence);const context=JSON.stringify({fixture,width,print});assert.deepEqual(evidence.clipping,[],context+" clipping");assert.deepEqual(evidence.valueCollisions,[],context+" value collision");assert.deepEqual(evidence.heightInBars,[],context+" height label inside filled bar");assert.equal(evidence.inputUnchanged,true);assert.equal(evidence.values.filter(value=>value.kind==="height").length,evidence.heightCount);assert.equal(evidence.values.filter(value=>value.kind==="rsi").length,evidence.rsiCount);assert.equal(evidence.legendCount,fixture==="missing-height"?2:5);
      assert.deepEqual(evidence.valueMarkerCollisions,[],context+" value covered by an RSI marker");
      for(const value of evidence.values.filter(value=>value.kind==="rsi")){assert.equal(value.fill,"#4e586c");assert.equal(value.stroke,"white");assert.equal(value.paintOrder,"stroke");}
      if(fixture==="representative"&&[240,740].includes(width)){const file=path.join(out,`jump-${width}-${print?"print":"screen"}.png`);await page.locator("#chart").screenshot({path:file});result.screenshots.push({path:path.relative(root,file),sha256:hash(file)});}
    }
    assert.deepEqual(result.errors,[]);result.pass=true;console.log(`PASS ${result.checks.length} native SVG readability and theme-scope checks (${channel})`);
  }catch(error){result.failure=error.stack;console.error(error.stack);await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});process.exitCode=1;}
  finally{result.sourceUnchanged=files.every(file=>hash(path.join(root,file))===sourceHashes[file]);result.pass=result.pass&&result.sourceUnchanged;fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
