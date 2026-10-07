"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require("./helpers/playwright.cjs");
const root = path.resolve(__dirname, ".."), file = path.join(root, "MotionBench.html");
const out = path.join(root, "output/playwright/silver-ui");
fs.mkdirSync(out, { recursive: true });
const result = { sourceHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"), checks: [], layouts: [], errors: [], network: [], pass: false };
const sizes = [[1366,768], [390,667], [844,390], [1440,720], [1440,721], [1024,768], [1920,1000], [1280,900], [900,900]];
(async () => {
  const browser = await chromium.launch({ channel: "chrome" }); let page;
  try {
    for (const [width,height] of sizes) {
      const context = await browser.newContext({ viewport: {width,height}, offline: true, reducedMotion: "reduce" });
      page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on("pageerror", e => result.errors.push(e.message));
      page.on("request", r => { if (/^https?:/.test(r.url())) result.network.push(r.url()); });
      await page.goto(pathToFileURL(file).href);
      const mobile = width <= 900;
      async function open() {
        if (await page.locator("#sidebar").evaluate(n => n.inert)) await page.locator("#sidebarToggle").click();
        await page.waitForTimeout(50);
      }
      async function activeVisible() {
        await page.waitForTimeout(60);
        const rect = await page.evaluate(() => {
          const s = document.querySelector("#sidebar"), d = s.querySelector(".sidebar-directory");
          const nav = [...s.querySelectorAll("nav")].find(n => !n.hidden && n.querySelector(".active"));
          const item = nav?.querySelector(".active")?.getBoundingClientRect();
          const box = (innerHeight <= 720 ? s : d).getBoundingClientRect();
          const top = innerHeight <= 720 ? s.querySelector(".brand").getBoundingClientRect().bottom : box.top;
          return { top, bottom: box.bottom, itemTop: item?.top, itemBottom: item?.bottom, scrollY };
        });
        assert.ok(rect.itemTop >= rect.top - 1 && rect.itemBottom <= rect.bottom + 1, JSON.stringify(rect));
        return rect;
      }
      await open(); await activeVisible();
      const layout = await page.evaluate(() => {
        const s = document.querySelector("#sidebar"), d = s.querySelector(".sidebar-directory"), b = s.querySelector(".brand");
        return { width: innerWidth, height: innerHeight, sidebarWidth:s.clientWidth, directoryHeight:d.clientHeight,
          sidebarScroll:s.scrollHeight>s.clientHeight, directoryOverflow:getComputedStyle(d).overflowY,
          pageOverflow:document.documentElement.scrollWidth>innerWidth+1, brandHeight:b.clientHeight,
          closeSize:s.querySelector('.sidebar-close').getBoundingClientRect().height,
          cards:document.querySelectorAll('#microCards > .micro-card').length };
      });
      assert.equal(layout.pageOverflow,false); assert.equal(layout.cards,4);
      if(height<=720) { assert.equal(layout.sidebarScroll,true); assert.equal(layout.directoryOverflow,"visible"); }
      else assert.ok(layout.directoryHeight>180, "Directory has usable height");
      if(width<=600) assert.ok(layout.closeSize>=44);
      result.layouts.push(layout);
      await page.screenshot({path:path.join(out,`sidebar-${width}x${height}.png`)});

      if (height<=720) {
        // Walk the scroll range and ensure every navigation/tool entry is reachable below the sticky brand.
        const unreachable = await page.evaluate(() => {
          const s=document.querySelector('#sidebar'), controls=[...s.querySelectorAll('nav button,.sidebar-bottom button')].filter(n=>n.getClientRects().length);
          const seen=new Set();
          for(let y=0;y<=s.scrollHeight+80;y+=80) {
            s.scrollTop=y; const top=s.querySelector('.brand').getBoundingClientRect().bottom;
            controls.forEach((n,i)=>{const r=n.getBoundingClientRect();if(r.top>=top && r.bottom<=innerHeight)seen.add(i);});
          }
          return controls.filter((n,i)=>!seen.has(i)).map(n=>n.textContent);
        });
        assert.deepEqual(unreachable,[]);
        const close = await page.locator(".sidebar-close").boundingBox(); assert.ok(close.y>=0 && close.y+close.height<height);
        await page.locator(".sidebar-close").click();
        assert.equal(await page.evaluate(()=>document.activeElement.id),"sidebarToggle");
        await open(); await activeVisible();
      }

      await page.locator("#editButton").click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),"entryProjectTitle");
      assert.equal(await page.locator("#entryProjectTitle").textContent(),"运动员与背景");
      // The footer next button drives navigation even when its sidebar target is initially out of view.
      for(let i=0;i<4;i++) await page.locator("#entryNext").click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),"entryProjectTitle");
      await open(); await activeVisible();
      await page.locator('[data-entry-tab="narrative"]').click();
      if(mobile) assert.equal(await page.locator("#sidebarScrim").isVisible(),false);
      assert.equal(await page.evaluate(()=>document.activeElement.id),"entryProjectTitle");
      await open(); const pos=await activeVisible();
      assert.equal(pos.scrollY,0,"Revealing navigation must not move the document");
      const valid = page.locator('.entry-status-pill[title="已有有效结果"]').first();
      assert.equal(await valid.textContent(),"有结果");
      assert.match(await valid.locator("..").getAttribute("aria-label"),/已有有效结果/);

      // Manually move away from the current navigation item, then type in the editor.
      if(mobile) await page.locator(".sidebar-close").click();
      await page.evaluate(()=>{const s=document.querySelector(innerHeight<=720?'#sidebar':'.sidebar-directory');s.scrollTop=0;});
      await page.locator("#interpEditor").fill("键盘焦点与目录位置回归（模拟）");
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector(innerHeight<=720?'#sidebar':'.sidebar-directory').scrollTop),0);
      assert.equal(await page.evaluate(()=>document.activeElement.id),"interpEditor");
      await open();
      // Desktop was already open; close/open explicitly must reveal the current item too.
      await page.locator(".sidebar-close").click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),"sidebarToggle");
      await open(); await activeVisible();

      await page.locator('[data-settings-open="record"]').click();
      await open();
      assert.equal(await page.locator('[data-settings-open="record"]').getAttribute('aria-current'),"true");
      await page.locator('[data-settings-tab="lvp"]').click();
      assert.equal(await page.evaluate(()=>document.activeElement.textContent),"MVT与素质区间");
      await open(); await activeVisible();
      await page.locator('[data-settings-open="app"]').click(); await open();
      await page.locator('[data-settings-tab="references"]').click();
      assert.equal(await page.evaluate(()=>document.activeElement.textContent),"参考与方法");
      assert.equal(await page.locator('[data-settings-open="app"]').getAttribute('aria-current'),"true");
      assert.equal(await page.locator('[data-settings-open="record"]').getAttribute('aria-current'),null);
      await page.locator("#workspaceBack").click();
      assert.equal(await page.evaluate(()=>App.getUIState().entryTab),"narrative");
      assert.equal(await page.evaluate(()=>document.activeElement.id),"entryProjectTitle");
      await page.locator("#workspaceBack").click();
      assert.equal(await page.evaluate(()=>App.getUIState().mode),"report");
      assert.equal(await page.locator('.sidebar-scope-active').count(),0);
      if(mobile) {
        await open();
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.evaluate(()=>document.querySelector('#sidebar').contains(document.activeElement)),true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator('#sidebarScrim').isVisible(),false);
        assert.equal(await page.evaluate(()=>document.activeElement.id),'sidebarToggle');
        await open(); await page.locator('#sidebarScrim').click({position:{x:width-20,y:20}});
        assert.equal(await page.locator('#sidebarScrim').isVisible(),false);
      }
      result.checks.push(`${width}x${height}: reachability, active visibility, scroll retention, focus, scope, return paths, drawer`);
      await context.close(); console.log("PASS sidebar",`${width}x${height}`);
    }
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.network,[]);result.pass=true;
  } catch(e) {
    result.failure=e.stack;process.exitCode=1;console.error(e.message);
    if(page)await page.screenshot({path:path.join(out,'sidebar-failure.png')}).catch(()=>{});
  } finally {
    fs.writeFileSync(path.join(out,'sidebar.json'),JSON.stringify(result,null,2));await browser.close();
  }
})();
