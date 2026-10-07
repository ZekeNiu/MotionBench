"use strict";
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { createHash } = require('node:crypto');
const { chromium } = require('./helpers/playwright.cjs');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'Ringside_Boxing_Assessment.html'), out = path.join(root, 'output/playwright');
const result = { sourceHash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), tests: [], errors: [], network: [], images: [] };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', offline: true });
  const page = await context.newPage();
  page.on('pageerror', e => result.errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url())) result.network.push(r.url()); });
  const check = async (id, run) => {
    try { result.tests.push({ id, pass: true, detail: await run() }); console.log('PASS ' + id); }
    catch (e) { result.tests.push({ id, pass: false, error: e.stack }); console.log('FAIL ' + id + ': ' + e.message); }
  };
  const sample = async () => page.evaluate(() => {
    const r = App.getState();
    const recordId = r.recordId, athleteId = r.athleteId;
    Object.assign(r, RingsideModel.sampleRecord(), { recordId, athleteId });
    r.data.mas.speed = 4; r.data.mss.speed = 8;
    Object.assign(r.data.ift, { speed: 5, protocol: 'shuttle', partial: 12.5 });
    for (const [id, target] of [['mas_speed', 4], ['mss_speed', 8]])
      Object.assign(r.definitions.find(d => d.id === id), { target, referenceEnabled: true });
    App.renderReport();
  });
  try {
    await page.goto(pathToFileURL(file).href); await page.waitForFunction(() => window.App?.getState);
    await sample();
    await check('approved-values-Chinese-goals-measured-MSS-and-work-rest-ratios', async () => {
      assert.equal(await page.locator('.speed-reference-table tbody tr').count(), 5);
      assert.deepEqual(await page.locator('.speed-reference-table th').allTextContents(), ['形式','生理目标','训练速度','做功时间','恢复方式与速度','恢复时间','做功∶休息参考']);
      const long = page.locator('[data-row-id="hiit-long"]'), short = page.locator('[data-row-id="hiit-short"]');
      for (const text of ['3.80–4.20 m/s','4.00–4.50 m/s','≤2.40 m/s','≤2.25 m/s','最大有氧速度（MAS）的95–105%']) assert.ok((await long.innerText()).includes(text));
      for (const text of ['4.00–4.80 m/s','4.50–5.25 m/s','折返终末速度（VIFT）的90–105%']) assert.ok((await short.innerText()).includes(text));
      for (const id of ['rst','sit']) {
        const row=page.locator(`[data-row-id="hiit-${id}"]`);
        assert.match(await row.innerText(), /全力冲刺/);
        assert.match(await row.locator('[data-speed-basis="mss"]').innerText(), /实测最大冲刺速度（MSS）\s+8\.00 m\/s/);
      }
      assert.match(await page.locator('[data-row-id="hiit-rst"] [data-label="生理目标"]').innerText(), /无氧糖酵解能力[\s\S]*神经肌肉刺激[\s\S]*有氧刺激随方案变化/);
      assert.match(await page.locator('[data-row-id="hiit-game"]').innerText(), /随比赛情境自主调节/);
      assert.deepEqual(await page.locator('.speed-work-rest strong').allTextContents(), ['2:1','1:1','2:1','1:4','1:8','2:1']);
      assert.equal(await page.locator('[data-speed-srr]').innerText(), '2.00');
      assert.equal(await page.locator('[data-speed-type]').innerText(), '速度型');
      assert.equal(await page.locator('.speed-training').evaluate(e=>!!e.lastElementChild.querySelector('.speed-reference-table')),true);
      assert.doesNotMatch(await page.locator('.test-block:has(.speed-detail)').innerText(), /[①②③④⑤⑥]|录入MAS换算|相对现有目标|80% MAS|≥MSS|95–105% vVO₂max/);
      assert.equal(await page.locator('.speed-test-info [data-label="结果"]').count(), 0);
    });
    await check('extension-geometry-and-small-zero-negative-reserves', async () => {
      const geometries = [];
      for (const values of [[4,8,10],[7.99,8,5],[4,4,5],[4,3,5]]) {
        await page.evaluate(([mas,mss,ift]) => { const r=App.getState();r.data.mas.speed=mas;r.data.mss.speed=mss;r.data.ift.speed=ift;App.renderReport(); }, values);
        const geometry = await page.evaluate(() => {
          const rect = id => document.querySelector(`[data-speed-metric="${id}"] rect`).getBoundingClientRect();
          const a=rect('mas'),s=rect('mss'),i=rect('ift'),e=document.querySelector('[data-asr-extension]')?.getBoundingClientRect();
          return { mas:a.right,mss:s.right,ift:i.right,extension:e?{left:e.left,right:e.right}:null,placement:document.querySelector('[data-asr-label]')?.dataset.asrPlacement,profile:!!document.querySelector('.speed-ratio-table') };
        });
        if(values[1]>values[0]) { assert.ok(Math.abs(geometry.extension.left-geometry.mas)<.1);assert.ok(Math.abs(geometry.extension.right-geometry.mss)<.1); }
        else assert.equal(geometry.extension,null);
        if(values[0]===7.99) assert.equal(geometry.placement,'above');
        if(values[1]<values[0]) { assert.equal(geometry.profile,false);assert.match(await page.locator('.test-block:has(.speed-detail)').innerText(),/MSS低于MAS/); }
        geometries.push({values,...geometry});
      }
      return geometries;
    });
    await check('all-missing-subsets-and-protocol-switching', async () => {
      await sample(); const subsets=[];
      for(let mask=0;mask<8;mask++) {
        await page.evaluate(mask=>{const r=App.getState();r.data.mas.speed=mask&1?4:'';r.data.mss.speed=mask&2?8:'';r.data.ift.speed=mask&4?5:'';App.renderReport();},mask);
        assert.equal(await page.locator('.speed-reference-table tbody tr').count(),mask?5:0);
        assert.equal(await page.locator('[data-row-id="hiit-long"] [data-speed-basis="mas"]').count(),mask&1?2:0);
        assert.equal(await page.locator('[data-row-id="hiit-long"] [data-speed-basis="vift"]').count(),mask&4?2:0);
        assert.equal(await page.locator('.speed-training [data-speed-basis="mss"]').count(),mask&2?2:0);
        assert.equal(await page.locator('[data-speed-type]').count(),(mask&3)===3?1:0);
        subsets.push(mask);
      }
      await page.evaluate(()=>{App.getState().data.ift.protocol='treadmill';App.renderReport();});
      assert.equal(await page.locator('.speed-training [data-speed-basis="vift"]').count(),0);
      assert.equal(await page.locator('[data-speed-metric]').count(),3);
      assert.match(await page.locator('.speed-detail').innerText(),/未完成级 12\.5 秒/);
      assert.ok(await page.locator('.speed-training [data-speed-basis="mas"]').count()>0);
      return {subsets,treadmillExcluded:true};
    });
    await check('literature-types-and-target-independent-SRR',async()=>{
      await sample();
      for(const [ratio,expected] of [[1.6999,'耐力型'],[1.7,'混合型'],[1.75,'混合型'],[1.8,'混合型'],[1.8001,'速度型']]) {
        await page.evaluate(ratio=>{App.getState().data.mss.speed=4*ratio;App.renderReport();},ratio);
        assert.equal(await page.locator('[data-speed-type]').innerText(),expected);
        assert.equal(await page.locator('[data-speed-srr]').innerText(),ratio.toFixed(2));
      }
      await sample();
      await page.evaluate(()=>{const r=App.getState();r.definitions.find(d=>d.id==='mas_speed').target=2;r.definitions.find(d=>d.id==='mss_speed').target=5;App.renderReport();});
      assert.equal(await page.locator('[data-speed-type]').innerText(),'速度型');
      await page.evaluate(()=>{App.getState().definitions.find(d=>d.id==='mss_speed').referenceEnabled=false;App.renderReport();});
      assert.equal(await page.locator('[data-speed-type]').innerText(),'速度型');
      assert.equal(await page.locator('[data-speed-srr]').innerText(),'2.00');
      assert.equal(await page.locator('[data-speed-profile]').count(),0);
    });
    await check('real-entry-updates-derived-values-and-survives-reload',async()=>{
      await sample();
      await page.locator('#editButton').click();
      await page.locator('#entryNav button[onclick*="\'mas\'"]').click();
      const input=page.locator('[data-path="data.mas.speed"]');await input.fill('4.25');await input.blur();
      await page.waitForFunction(()=>Number(App.getState().data.mas.speed)===4.25);
      await page.evaluate(()=>App.showReport(false));
      assert.match(await page.locator('[data-row-id="hiit-long"]').innerText(),/4\.04–4\.46 m\/s/);
      assert.match(await page.locator('[data-speed-asr]').textContent(),/ASR 3\.75 m\/s/);
      await page.reload();await page.waitForFunction(()=>window.App?.getState);
      assert.equal(await page.evaluate(()=>Number(App.getState().data.mas.speed)),4.25);
      assert.match(await page.locator('[data-row-id="hiit-long"]').innerText(),/4\.04–4\.46 m\/s/);
    });
    await check('four-width-reference-layouts-and-small-extension-labels',async()=>{
      await sample();const layouts=[];
      for(const width of [1440,1280,900,390]) {
        await page.setViewportSize({width,height:1000});
        await page.waitForTimeout(180);
        const layout=await page.evaluate(()=>{
          const table=document.querySelector('.speed-reference-table'), b=table.getBoundingClientRect();
          const overflow=[...table.querySelectorAll('td')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent);
          const svg=document.querySelector('.speed-detail svg'),outer=svg.getBoundingClientRect();
          const labels=[...svg.querySelectorAll('text')].filter(e=>{const b=e.getBoundingClientRect();return b.left<outer.left-1||b.right>outer.right+1||b.top<outer.top-1||b.bottom>outer.bottom+1;}).map(e=>e.textContent);
          return{width:innerWidth,scroll:document.documentElement.scrollWidth,tableWidth:b.width,tableDisplay:getComputedStyle(table).display,overflow,labels};
        });
        assert.equal(layout.scroll,width);assert.deepEqual(layout.overflow,[]);assert.deepEqual(layout.labels,[]);
        if(width===390)assert.equal(layout.tableDisplay,'block');else if(width>=1280)assert.equal(layout.tableDisplay,'table');
        const image=path.join(out,`speed-reference-${width}.png`);
        await page.locator('.test-block:has(.speed-detail)').screenshot({path:image,style:'.topbar{visibility:hidden!important}'});
        result.images.push(path.relative(root,image).replaceAll('\\','/'));layouts.push(layout);
      }
      return layouts;
    });
  } finally {
    await browser.close();result.passed=result.tests.filter(x=>x.pass).length;result.failed=result.tests.length-result.passed;
    result.pass=!result.failed&&!result.errors.length&&!result.network.length;
    fs.writeFileSync(path.join(out,'speed-reference-results.json'),JSON.stringify(result,null,2));
    if(!result.pass)process.exitCode=1;
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
