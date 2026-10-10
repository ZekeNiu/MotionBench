"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {pathToFileURL}=require("node:url"),{createHash}=require("node:crypto"),{chromium}=require("./helpers/playwright.cjs");
const root=path.resolve(__dirname,".."),file=path.join(root,"MotionBench.html"),out=path.join(root,"output/playwright",process.argv.includes("--candidate")?"report-v216-candidate":"report-v216");
const channel=process.argv.includes("--edge")?"msedge":"chrome",hash=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const result={sourceHash:hash(file),channel,synthetic:true,checks:[],errors:[],network:[],images:[],layouts:[],pdfs:[],pass:false};
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel,headless:true});
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000},reducedMotion:"reduce",acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on("pageerror",error=>result.errors.push(error.message));page.on("request",request=>{if(/^https?:/.test(request.url()))result.network.push(request.url());});page.on("dialog",dialog=>dialog.accept());
  const artifact=(p,extra={})=>({path:path.relative(root,p).replaceAll("\\","/"),sha256:hash(p),...extra});
  const check=async(name,run)=>{await run();result.checks.push(name);console.log("PASS",name);};
  const ready=async()=>{await page.waitForFunction(()=>!!window.App?.ready);assert.equal(await page.evaluate(()=>App.ready),true);};
  const save=async()=>assert.equal(await page.evaluate(()=>App.saveNow()),true);
  const screenshot=async(name,selector)=>{
    const p=path.join(out,`${channel}-${name}.png`);
    if(selector){await page.locator(selector).scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(250);await page.locator(selector).screenshot({path:p,animations:"disabled",style:".topbar,#tooltip,#bodyRegionTooltip{visibility:hidden!important}.workspace{transition:none!important}"});}else await page.screenshot({path:p});
    result.images.push(artifact(p));
  };
  const fixture=()=>page.evaluate(async()=>{
    await App.importPayload(RingsideModel.libraryDefaults(),"replace-library");
    const r=RingsideModel.sampleRecord();r.recordId="report-v216-acceptance";r.athleteId="report-v216-athlete";
    r.demo=false;r.athlete.name="2.16 报告验收（模拟数据）";r.athlete.mass=72;r.athlete.birthDate="1996-01-01";r.athlete.dominantHand="右手";
    for(const [id,left,right] of [["iso_shoulder_internalRotation",358,242],["iso_hip_internalRotation",400,410],["iso_hip_externalRotation",280,320]]){
      const row=r.data.iso.find(item=>item.id===id);Object.assign(row,{left,right});
      if(Array.isArray(r.isoDirectionIds)&&!r.isoDirectionIds.includes(id))r.isoDirectionIds.push(id);
    }
    const shoulderPair=r.balancePairs.find(pair=>pair.id==="shoulder_IR_ER");
    shoulderPair.reference=RingsideIsoReferences.defaultBalanceReference(shoulderPair);
    shoulderPair.ranges=Def.parseRanges("<0.6 | 模拟严重 | red\n[0.6..0.85) | 模拟关注 | amber\n>=0.85 | 模拟达标 | green");
    shoulderPair.referenceEnabled=true;shoulderPair.confirmed=true;shoulderPair.source="模拟验收区间（用于验证分级显示）";
    r.data.cmj[0].height=36;r.data.sj[0].height=35;
    for(const id of ["fvp_sj","fvp_cmj"]){
      r.enabled[id]=true;r.fvpConfig[id].distanceCm=33;
      r.data[id]=[0,20,40,60,80].map((load,index)=>({id:`${id}-${index}`,load,height:[33,27,22,14,10][index]+(id==="fvp_cmj"?2:0),notes:"模拟验证",excluded:false,exclusionReason:""}));
    }
    r.fvpAnalysis.fvp_cmj.angle=30;
    for(const row of r.data.iso.filter(item=>["neck","shoulder","hip","knee"].includes(item.region))){
      if(![row.left,row.right,row.center].some(value=>RingsideModel.positive(value)!==null))continue;
      row.trials=[0,1,2].map(index=>({id:`${row.id}-trial-${index}`,left:row.left===""?"":Number(row.left)+index,right:row.right===""?"":Number(row.right)+index,center:row.center===""?"":Number(row.center)+index,painLeft:false,painRight:false,painCenter:false,notes:"重复测试"}));
    }
    await App.importPayload(RingsideModel.recordEnvelope(r));await App.showReport();return r.recordId;
  });
  const pdf=async name=>{
    await page.evaluate(()=>{
      window.__v216Pages=[];window.__v216BodyMarkers=[];window.__v216Canvas=window.html2canvas;window.__v216Serialize=XMLSerializer.prototype.serializeToString;
      XMLSerializer.prototype.serializeToString=function(node){
        if(node.matches?.('svg[aria-label="身体区域筛查"]'))window.__v216BodyMarkers.push([...node.querySelectorAll(".viz-region")].map(item=>item.dataset.region));
        return window.__v216Serialize.call(this,node);
      };
      window.html2canvas=async(node,options)=>{
        const content=node.querySelector(".ringside-pdf-content"),bounds=content.getBoundingClientRect();
        const cells=[...content.querySelectorAll("th,td")],cellOverflow=[];
        for(const cell of cells){
          const box=cell.getBoundingClientRect(),walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
          let textNode;
          while((textNode=walker.nextNode())){
            if(!textNode.textContent.trim()||textNode.parentElement.closest("th,td")!==cell)continue;
            const range=document.createRange();range.selectNodeContents(textNode);
            for(const rect of range.getClientRects())if(rect.width&&rect.height&&(rect.left<box.left-.8||rect.right>box.right+.8||rect.top<box.top-.8||rect.bottom>box.bottom+.8))
              cellOverflow.push({row:cell.parentElement.dataset.rowId||"",column:cell.cellIndex,text:textNode.textContent.trim(),cell:[box.left,box.top,box.right,box.bottom],textBounds:[rect.left,rect.top,rect.right,rect.bottom]});
          }
          for(const badge of cell.querySelectorAll(".pill")){
            const rect=badge.getBoundingClientRect();
            if(rect.left<box.left-.8||rect.right>box.right+.8||rect.top<box.top-.8||rect.bottom>box.bottom+.8)
              cellOverflow.push({row:cell.parentElement.dataset.rowId||"",column:cell.cellIndex,text:badge.textContent.trim(),kind:"badge",cell:[box.left,box.top,box.right,box.bottom],textBounds:[rect.left,rect.top,rect.right,rect.bottom]});
          }
        }
        window.__v216Pages.push({text:node.innerText,
          charts:[...node.querySelectorAll("[data-chart-kind]")].map(chart=>({kind:chart.dataset.chartKind,input:chart.dataset.chartInput})),
          rows:[...node.querySelectorAll("tr[data-row-id]")].map(row=>row.dataset.rowId),
          overview:[...node.querySelectorAll("[data-overview-metric]")].map(item=>({id:item.dataset.overviewMetric,x:item.getBoundingClientRect().x})),
          columnGroups:[...node.querySelectorAll(".iso-results.with-repeat-columns")].map(table=>({groups:table.querySelectorAll(":scope > colgroup").length,cols:table.querySelectorAll(":scope > colgroup > col").length})),
          isometricAssessments:[...node.querySelectorAll(".iso-results tbody tr[data-row-id]")].map(row=>({id:row.dataset.rowId,assessments:[...row.querySelectorAll(".iso-status")].map(badge=>({label:badge.querySelector(".iso-status-label")?.textContent||"",status:["red","amber","green","gray"].find(status=>badge.classList.contains(status))}))})),
          jointBalances:[...node.querySelectorAll(".iso-results [data-balance-id]")].map(item=>({id:item.dataset.balanceId,text:item.innerText,labels:[...item.querySelectorAll(".iso-status-label")].map(label=>label.textContent),statuses:[...item.querySelectorAll(".iso-status")].map(badge=>["red","amber","green","gray"].find(status=>badge.classList.contains(status)))})),
          cellCount:cells.length,cellOverflow,
          overflow:[...content.children].filter(child=>child.getBoundingClientRect().bottom>bounds.bottom+.7).map(child=>child.className)});
        return window.__v216Canvas(node,options);
      };
    });
    const before=await page.evaluate(()=>JSON.stringify(App.getState()));
    await page.locator("#reportExportMenu").evaluate(node=>node.open=true);
    const pending=page.waitForEvent("download",{timeout:240000});
    await page.locator("#reportExportMenu").getByRole("button",{name:"报告 PDF",exact:true}).click();
    const download=await pending,p=path.join(out,`${channel}-${name}.pdf`);assert.equal(await download.failure(),null);await download.saveAs(p);
    const captured=await page.evaluate(()=>({diagnostics:RingsidePDF.lastDiagnostics,pages:window.__v216Pages,state:JSON.stringify(App.getState()),bodyMarkerSnapshots:window.__v216BodyMarkers}));
    result.pdfs.push(artifact(p,{name,diagnostics:captured.diagnostics,pages:captured.pages,bodyMarkerSnapshots:captured.bodyMarkerSnapshots}));
    assert.equal(captured.diagnostics.status,"complete");
    for(const key of ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])assert.deepEqual(captured.diagnostics[key],[],key);
    assert.ok(captured.pages.every(item=>!item.overflow.length));assert.equal(captured.state,before);assert.ok(fs.statSync(p).size>15000);
    assert.deepEqual(captured.pages.flatMap((item,index)=>item.cellOverflow.map(issue=>({page:index+1,...issue}))),[],"PDF cell text and badges must stay inside their cells without overlapping neighboring columns");
    assert.ok(captured.pages.flatMap(item=>item.columnGroups).every(group=>group.groups===1&&group.cols===7));
    await page.evaluate(()=>{window.html2canvas=window.__v216Canvas;XMLSerializer.prototype.serializeToString=window.__v216Serialize;});return captured;
  };
  try{
    await page.goto(pathToFileURL(file).href);await ready();
    await check("body shows only measured regions including zero pain and a partial FMS result",async()=>{
      await page.evaluate(async()=>{
        await App.importPayload(RingsideModel.libraryDefaults(),"replace-library");const r=RingsideModel.defaults();r.recordId="body-empty-acceptance";r.athleteId="body-acceptance-athlete";r.athlete.name="人体圈验收（模拟）";r.demo=false;
        Object.keys(r.enabled).forEach(id=>r.enabled[id]=["iso","fms"].includes(id));await App.importPayload(RingsideModel.recordEnvelope(r));await App.showReport();
      });
      const body=page.locator("#bodyChart");assert.equal(await body.locator(".viz-region").count(),0);assert.equal(await body.locator("image").count(),1);await screenshot("body-empty","#bodyChart");
      await page.evaluate(async()=>{
        const r=RingsideModel.defaults();r.recordId="body-measured-acceptance";r.athleteId="body-acceptance-athlete";r.athlete.name="人体圈验收（模拟）";r.demo=false;
        Object.keys(r.enabled).forEach(id=>r.enabled[id]=["iso","fms"].includes(id));
        const neck=r.data.iso.find(row=>row.region==="neck"&&row.directionCode==="flexion");Object.assign(neck,{center:0,target:null,reference:null});
        r.data.iso.find(row=>row.region==="shoulder"&&row.directionCode==="externalRotation").painLeft=true;
        const partial=r.data.fms.find(row=>row.bilateral);Object.assign(partial,{left:0,right:"",location:"scapula_l"});
        await App.importPayload(RingsideModel.recordEnvelope(r));await App.showReport();
      });
      const keys=await body.locator(".viz-region").evaluateAll(nodes=>nodes.map(node=>node.dataset.region));assert.deepEqual(keys,["neck","shoulder_l","scapula_l"]);
      assert.equal(await body.locator("circle").count(),6);assert.equal(await body.locator('line[stroke-dasharray="4 3"]').count(),1);
      const recorded=await body.locator('[data-region="neck"]').getAttribute("data-body-detail");assert.equal(JSON.parse(recorded).hasMeasured,true);assert.equal(JSON.parse(recorded).status,"gray");
      assert.match(await body.locator('[data-region="scapula_l"]').getAttribute("aria-label"),/已测/);await screenshot("body-recorded-regions","#bodyChart");
    });
    await fixture();
    await check("overview shows both valid profiles first and EUR gives the intended training direction",async()=>{
      const ids=await page.locator("#directionMetrics [data-overview-metric]").evaluateAll(nodes=>nodes.map(node=>node.dataset.overviewMetric));
      assert.deepEqual(ids.slice(0,4),["fvp_sj","fvp_sj_elasticity","fvp_cmj","fvp_cmj_elasticity"]);
      assert.match(await page.locator('[data-overview-metric="eur"]').innerText(),/发展 SSC 能力/);
      assert.doesNotMatch(await page.locator("#directionMetrics").innerText(),/CMJ 垂直跳跃高度较 SJ|未测|待录入/);
    });
    await check("three response curves can be selected in all eight combinations without changing calculations",async()=>{
      const basis=await page.evaluate(()=>App.recordBasis()),keys=["responseForce","responseVelocity","responseBoth"];
      for(let mask=0;mask<8;mask++){
        for(const [index,key] of keys.entries())await page.locator(`[data-fvp-view="${key}"]`).setChecked(!!(mask&(1<<index)));
        const series=await page.locator('[data-chart-kind="jumpElasticity"] [data-response-series]').evaluateAll(nodes=>nodes.map(node=>node.dataset.responseSeries));
        assert.deepEqual(series,["force","velocity","both"].filter((key,index)=>mask&(1<<index)));
        if(!mask)assert.match(await page.locator('[data-chart-kind="jumpElasticity"]').innerText(),/勾选曲线查看表现响应/);
        assert.equal(await page.evaluate(()=>App.recordBasis()),basis);
      }
    });
    await check("EN keeps its norm formula and local joint gain remains a separate result",async()=>{
      const values=await page.evaluate(()=>{const solved=RingsideFVP.solve(App.getState(),"fvp_sj");return{norm:solved.elasticity.EN,joint:solved.elasticity.Fe+solved.elasticity.ve,both5:solved.sensitivity.both.find(point=>point.changePct===5).deltaPct};});
      assert.ok(Math.abs(values.norm-1.399316517032993)<1e-8);assert.ok(Math.abs(values.joint-1.9575382858659407)<1e-8);assert.ok(Math.abs(values.both5-9.884770691771871)<1e-8);
      assert.match(await page.locator(".fvp-scenario-table").innerText(),/弹性范数 EN/);assert.match(await page.locator(".fvp-scenario-table").innerText(),/双端各提高 1%.*1\.96\s*%/s);
      assert.doesNotMatch(await page.locator("#trainingAnalysisDetail").innerText(),/归一弹性 EN|选择负荷点可对应查看/);
    });
    await check("load selection still reveals the current measured result and clears its hint with Escape",async()=>{
      assert.equal(await page.locator("[data-fvp-selection-summary]").isVisible(),false);
      await page.locator('.viz-point[data-fvp-load="20"]').first().focus();await page.keyboard.press("Enter");
      assert.equal(await page.locator("[data-fvp-selection-summary]").isVisible(),true);assert.match(await page.locator("[data-fvp-selection-summary]").innerText(),/20(?:\.0)? kg/);
      await page.keyboard.press("Escape");assert.equal(await page.locator("[data-fvp-selection-summary]").isVisible(),false);
    });
    await check("four capability cards retain independent real results and visible speed endpoints",async()=>{
      assert.equal(await page.locator("[data-capability-card]").count(),4);
      for(const id of ["srr","mss_speed","mas_speed","asr"])assert.equal(await page.locator(`[data-capability-card="speed"] [data-capability-metric="${id}"]`).count(),1);
      const expected=await page.evaluate(()=>App.stats().capabilityCards.flatMap(card=>card.metrics.map(metric=>metric.id)));
      const actual=await page.locator("[data-capability-metric]").evaluateAll(nodes=>nodes.map(node=>node.dataset.capabilityMetric));assert.deepEqual(actual.sort(),expected.sort());
    });
    await check("isometric report uses L/R and the agreed fixed column proportions",async()=>{
      const iso=page.locator(".iso-results.with-repeat-columns");assert.equal(await iso.count(),1);
      const widths=await iso.locator(":scope > colgroup > col").evaluateAll(nodes=>nodes.map(node=>node.style.width));assert.deepEqual(widths,["14%","20%","23%","7%","12%","9%","15%"]);
      assert.doesNotMatch(await iso.innerText(),/左向|右向|向较弱|L较弱|R较弱/);assert.match(await iso.innerText(),/左侧更弱|右侧更弱/);
      assert.match(await iso.innerText(),/参考目标/);assert.match(await iso.innerText(),/达标|关注/);
      assert.doesNotMatch(await iso.innerText(),/达到参考目标|低于参考目标/);
      assert.ok(await iso.locator(".iso-status.green").count()>0);assert.ok(await iso.locator(".iso-status.amber").count()>0);
      const references=await page.evaluate(()=>App.stats().isoAnalyses.flatMap(row=>row.sides.filter(side=>side.targetKind==="reference"&&side.value!==null&&side.target>0).map(side=>({id:row.id,value:side.value,target:side.target,status:side.status}))));
      assert.ok(references.some(side=>side.value>=side.target&&side.status==="green"),"an effective literature target reached by a side must have the green target assessment");
      assert.ok(references.some(side=>side.value<side.target&&side.status==="amber"),"an effective literature target below its target must have the amber attention assessment");
      const untargetedWeak=await page.evaluate(()=>App.stats().isoAnalyses.find(row=>row.region==="hip"&&row.sides.some(side=>side.target===null&&side.status==="amber"))?.id);assert.ok(untargetedWeak);
      assert.ok(await iso.locator(`[data-row-id="${untargetedWeak}"] [data-label="评价"] .iso-status.amber`).count()>0,"an untargeted weak side must retain its asymmetry assessment");
      const shoulder=iso.locator('[data-balance-id="shoulder_IR_ER"]'),hip=iso.locator('[data-balance-id="hip_IR_ER"]');
      assert.match(await shoulder.innerText(),/ER:IR/);assert.match(await shoulder.innerText(),/参考目标/);
      assert.ok(await shoulder.locator(".iso-status.red").count()>0);assert.ok(await shoulder.locator(".iso-status.green").count()>0);
      assert.doesNotMatch(await hip.innerText(),/参考目标/);assert.equal(await hip.locator(".iso-status.gray").count(),2);
    });
    await check("SJ and CMJ response choices persist independently after saving and refresh",async()=>{
      for(const [key,value] of Object.entries({responseForce:false,responseVelocity:false,responseBoth:true}))await page.locator(`[data-fvp-view="${key}"]`).setChecked(value);
      await page.locator("[data-fvp-protocol]").selectOption("fvp_cmj");
      for(const [key,value] of Object.entries({responseForce:true,responseVelocity:false,responseBoth:false}))await page.locator(`[data-fvp-view="${key}"]`).setChecked(value);
      await save();await page.reload();await ready();await page.evaluate(()=>App.showReport());
      assert.equal(await page.locator('[data-fvp-view="responseForce"]').isChecked(),true);assert.equal(await page.locator('[data-fvp-view="responseBoth"]').isChecked(),false);
      await page.locator("[data-fvp-protocol]").selectOption("fvp_sj");
      assert.equal(await page.locator('[data-fvp-view="responseForce"]').isChecked(),false);assert.equal(await page.locator('[data-fvp-view="responseBoth"]').isChecked(),true);
      assert.equal(await page.locator("#directionMetrics [data-overview-metric]").count(),7);
    });
    await check("1440, 1280, 900 and 390 layouts keep the overview, tables and capability cards inside the page",async()=>{
      for(const width of [1440,1280,900,390]){
        await page.setViewportSize({width,height:1000});await page.waitForTimeout(350);
        const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,overviewColumns:getComputedStyle(document.querySelector("#directionMetrics")).gridTemplateColumns.split(" ").length,
          overviewOverflow:[...document.querySelectorAll("#directionMetrics > .aux-metric")].filter(item=>{const parent=item.parentElement.getBoundingClientRect(),bounds=item.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(item);return [bounds,...range.getClientRects()].some(rect=>rect.left<parent.left-.6||rect.right>parent.right+.6||rect.top<parent.top-.6||rect.bottom>parent.bottom+.6);}).map(item=>item.dataset.overviewMetric),
          isoWidth:document.querySelector(".iso-results").getBoundingClientRect().width,
          charts:[...document.querySelectorAll("#trainingAnalysisDetail svg")].map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))}));
        assert.equal(geometry.overflow,false);assert.deepEqual(geometry.overviewOverflow,[]);assert.equal(geometry.overviewColumns,width>1000?3:1);assert.ok(geometry.charts.every(chart=>chart.width>100&&chart.height>100));result.layouts.push(geometry);
        await screenshot(`overview-${width}`,"#directionMetrics");await screenshot(`isometric-${width}`,".iso-detail");
        await screenshot(`capabilities-${width}`,".capability-results");await screenshot(`response-${width}`,'[data-fvp-elasticity="fvp_sj"]');
      }
      await page.setViewportSize({width:1440,height:1000});
    });
    await check("actual downloaded PDF keeps both protocols, selected response curves and every results table",async()=>{
      const captured=await pdf("complete-report"),text=captured.pages.map(item=>item.text).join("\n");
      assert.match(text,/FVP的不平衡性/);assert.match(text,/弹性范数 EN/);assert.match(text,/发展 SSC 能力/);assert.doesNotMatch(text,/归一弹性 EN|选择负荷点可对应查看/);
      assert.match(text,/参考目标/);assert.match(text,/达标|关注/);
      const curves=captured.pages.flatMap(item=>item.charts).filter(chart=>chart.kind==="jumpElasticity").map(chart=>JSON.parse(chart.input)[0]);assert.equal(curves.length,2);
      assert.deepEqual(curves.map(item=>[item.id,item.responseForce,item.responseVelocity,item.responseBoth]),[["fvp_sj",false,false,true],["fvp_cmj",true,false,false]]);
      const overview=captured.pages.flatMap(item=>item.overview);assert.equal(overview.length,7);assert.equal(new Set(overview.map(item=>Math.round(item.x))).size,2);
      const bodyMarkers=await page.locator("#bodyChart .viz-region").evaluateAll(nodes=>nodes.map(node=>node.dataset.region));assert.equal(captured.bodyMarkerSnapshots.length,1);assert.deepEqual(captured.bodyMarkerSnapshots[0].sort(),bodyMarkers.sort());
      const isoAssessments=captured.pages.flatMap(item=>item.isometricAssessments).flatMap(row=>row.assessments);
      assert.ok(isoAssessments.some(assessment=>assessment.status==="green"&&assessment.label==="达标"));
      assert.ok(isoAssessments.some(assessment=>assessment.status==="amber"&&assessment.label==="关注"));
      assert.ok(isoAssessments.every(assessment=>["严重","关注","达标",""] .includes(assessment.label)));
      const untargetedWeak=await page.evaluate(()=>App.stats().isoAnalyses.find(row=>row.region==="hip"&&row.sides.some(side=>side.target===null&&side.status==="amber"))?.id);
      assert.ok(captured.pages.flatMap(item=>item.isometricAssessments).find(row=>row.id===untargetedWeak)?.assessments.some(side=>side.status==="amber"&&side.label==="关注"),"the actual PDF must retain the untargeted side's asymmetry grade");
      const balances=captured.pages.flatMap(item=>item.jointBalances),shoulder=balances.find(pair=>pair.id==="shoulder_IR_ER"),hip=balances.find(pair=>pair.id==="hip_IR_ER");
      assert.ok(shoulder&&hip);assert.match(shoulder.text,/ER:IR/);assert.match(shoulder.text,/参考目标/);
      assert.deepEqual(shoulder.statuses,["red","green"]);assert.deepEqual(shoulder.labels,["严重","达标"]);
      assert.match(hip.text,/ER:IR/);assert.doesNotMatch(hip.text,/参考目标/);assert.deepEqual(hip.statuses,["gray","gray"]);
    });
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
  }catch(error){result.failure=error.stack;console.error(error.stack);process.exitCode=1;await screenshot("failure").catch(()=>{});}
  finally{result.sourceUnchanged=hash(file)===result.sourceHash;if(!result.sourceUnchanged){result.pass=false;process.exitCode=1;}fs.writeFileSync(path.join(out,`${channel}-results.json`),JSON.stringify(result,null,2));await context.close();await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
