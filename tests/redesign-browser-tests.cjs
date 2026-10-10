'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

function playwright() {
  const candidates = [process.env.RINGSIDE_PLAYWRIGHT_PATH, 'playwright', path.join(os.homedir(), 'AppData/Local/npm-cache/_npx/0b9ff77863cb6e9f/node_modules/playwright')].filter(Boolean);
  const cache = path.join(os.homedir(), 'AppData/Local/npm-cache/_npx');
  if (fs.existsSync(cache)) fs.readdirSync(cache).forEach(name => candidates.push(path.join(cache, name, 'node_modules/playwright')));
  for (const candidate of candidates) { try { return require(candidate); } catch {} }
  throw new Error('Playwright not found; set RINGSIDE_PLAYWRIGHT_PATH to the installed module.');
}
const { chromium } = playwright();
const root = path.resolve(__dirname, '..'), artifactDir = path.join(root, 'output/playwright');
const source = path.join(root, 'MotionBench.html');
const fixture = path.join(__dirname, 'fixtures/verification-v1-original-demo.json');
const legacyHTMLFixture = path.join(__dirname, 'fixtures/legacy-v1-exported.html');
const original = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/verification-expected.json'), 'utf8'));
const only = (process.argv.find(x => x.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const htmlSource = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
const modelSource = fs.readFileSync(path.join(root, 'src/ringside-model.js'), 'utf8').replace(/\r\n/g, '\n').trim();
const expectedModel = modelSource.replaceAll('</script', '<\\/script');
const embeddedModel = Array.from(htmlSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)).map(match => match[1].trim()).find(code => code.includes('RingsideModel requires Calc and Def.')) || '';
const hash = text => createHash('sha256').update(text).digest('hex');
const results = { started: new Date().toISOString(), sourceHash: createHash('sha256').update(fs.readFileSync(source)).digest('hex'), compiledModel: { sourceFile: 'src/ringside-model.js', sourceHash: hash(modelSource), expectedEmbeddedHash: hash(expectedModel), embeddedHash: hash(embeddedModel), matchesSource: embeddedModel === expectedModel }, isolation: 'Fresh non-persistent browser contexts; no user browser profile or storage used.', aiVerification: 'Locally intercepted simulated responses only; no live model call.', tests: [], browserErrors: [], consoleErrors: [], artifacts: [] };
fs.mkdirSync(artifactDir, { recursive: true });
const near = (a, b, e = 1e-8) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= e, `${a} != ${b}`);
let browser, serverInfo;

async function startServer() {
  const server = http.createServer((request, response) => {
    let filename;
    try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)); } catch { response.writeHead(400).end(); return; }
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    fs.readFile(filename, (error, content) => {
      if (error) { response.writeHead(404).end(); return; }
      const mime = filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.png') ? 'image/png' : 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }).end(content);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/MotionBench.html` };
}
async function boot(url = serverInfo.url, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', acceptDownloads: true });
  const page = await context.newPage(), requests = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => results.browserErrors.push({ url, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push({ url, message: message.text() }); });
  page.on('request', request => requests.push(request.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.App && window.RingsideModel && window.RingsideViz && document.getElementById('reportView'));
  return { context, page, requests };
}
async function shot(page, label, fullPage = true) {
  const filename = path.join(artifactDir, 'redesign-' + label + '.png');
  await page.screenshot({ path: filename, fullPage }); results.artifacts.push(filename); return filename;
}
async function check(id, name, operation) {
  if (only.length && !only.includes(id)) return;
  let session;
  try {
    session = await boot();
    const detail = await operation(session.page, session);
    results.tests.push({ id, name, pass: true, detail }); console.log('PASS ' + name);
  } catch (error) {
    results.tests.push({ id, name, pass: false, error: error.stack || String(error) }); console.log('FAIL ' + name + ': ' + error.message);
    if (session) { try { await shot(session.page, 'failure-' + id); } catch {} }
  } finally { if (session) await session.context.close(); }
}
async function seed(page) {
  await page.evaluate(data => App.importPayload(data, 'replace'), original);
  await page.waitForFunction(id => App.getState().recordId === id, original.recordId);
  await page.evaluate(() => App.showReport());
}
async function entry(page, tab) {
  await page.evaluate(tab => App.openEntry(tab), tab);
  await page.waitForFunction(tab => App.getUIState().mode === 'entry' && App.getUIState().entryTab === tab, tab);
  assert.equal(await page.locator('#entryView').isVisible(), true);
}
const input = (page, dataPath) => page.locator(`[data-path="${dataPath}"]`);
async function saved(page) {
  await page.waitForTimeout(260);
  return page.evaluate(() => App.getState());
}
async function createAthlete(page, name, projects = ['cmj']) {
  const before = await page.evaluate(() => ({ athleteId: App.getState().athleteId, recordId: App.getState().recordId }));
  await page.getByRole('button', { name: '新建运动员', exact: true }).click();
  await page.locator('#newAthleteName').fill(name);
  await page.locator('#newAthleteSex').selectOption('男');
  await page.locator('#newAthleteSport').fill('散打');
  await page.locator('#newAthleteHand').selectOption('左手');
  await page.locator('#newAthleteLevel').fill('67 kg级');
  await page.locator('#creationNext').click();
  assert.equal(await page.locator('#creationProjects input:checked').count(), 0, 'A new athlete must start with an empty test selection.');
  assert.deepEqual(await page.evaluate(() => ({ athleteId: App.getState().athleteId, recordId: App.getState().recordId })), before, 'Creation drafts must not create or select a record.');
  for (const project of projects) await page.locator(`[data-creation-project="${project}"]`).check();
  await page.locator('#creationSubmit').click();
  await page.waitForFunction(name => App.getState().athlete.name === name && !document.getElementById('newAthleteModal').classList.contains('show'), name);
  const state = await page.evaluate(() => App.getState());
  assert.equal((await page.evaluate(() => App.getUIState())).entryTab, projects[0]);
  assert.equal(await page.locator('#entryView').isVisible(), true);
  return state;
}
async function createTest(page) {
  const before = await page.evaluate(() => App.getState().recordId);
  await page.getByRole('button', { name: '新建测试记录', exact: true }).click();
  assert.equal(await page.evaluate(() => App.getState().recordId), before, 'Opening a test draft must not create a record.');
  assert.equal(await page.locator('#creationProfileStep').isVisible(), false);
  assert.equal(await page.locator('#creationTestStep').isVisible(), true);
  const selected = await page.locator('#creationProjects input:checked').evaluateAll(inputs => inputs.map(input => input.dataset.creationProject));
  assert.ok(selected.length > 0, 'The previous record selection should be carried forward.');
  await page.locator('#creationSubmit').click();
  await page.waitForFunction(before => App.getState().recordId !== before && !document.getElementById('newAthleteModal').classList.contains('show'), before);
  assert.equal((await page.evaluate(() => App.getUIState())).entryTab, selected[0]);
  assert.equal(await page.locator('#entryView').isVisible(), true);
  return page.evaluate(() => App.getState());
}
async function configureAI(page) {
  await page.evaluate(() => App.openSettings('ai'));
  await page.locator('#apiURL').fill('https://ringside-tests.invalid');
  await page.locator('#apiKey').fill('local-test-secret');
  await page.locator('#apiModel').fill('simulated-model');
  await page.locator('#workspaceBack').click();
  await entry(page, 'narrative');
}
async function download(page, buttonName, filename) {
  await page.evaluate(() => App.saveMenu());
  const pending = page.waitForEvent('download');
  await page.locator('#saveModal').getByRole('button', { name: buttonName, exact: true }).click();
  const file = await pending, target = path.join(artifactDir, filename);
  await file.saveAs(target); results.artifacts.push(target);
  await page.locator('#saveModal').getByRole('button', { name: '关闭保存', exact: true }).click();
  return target;
}
async function run() {
  await check('workspace', '统一报告和编辑入口、报告正文只读', async page => {
    for (const name of ['showReport', 'back', 'toggleSidebar', 'navigate', 'getUIState']) assert.equal(await page.evaluate(name => typeof App[name], name), 'function');
    assert.equal(await page.locator('#reportView').isVisible(), true); assert.equal(await page.locator('#entryView').isVisible(), false);
    assert.equal(await page.locator('#settingsView').isVisible(), false); assert.equal(await page.locator('#narrativeView').getAttribute('contenteditable'), null);
    assert.equal(await page.locator('#editButton').count(), 1); assert.equal(await page.locator('#pdfButton').count(), 1);
    assert.equal(await page.locator('#reportView button').filter({ hasText: /^编辑$/ }).count(), 0);
    await page.locator('#editButton').click(); assert.equal(await page.locator('#entryView').isVisible(), true);
    assert.equal(await page.locator('#entryNav').isVisible(), true); assert.equal(await page.locator('#reportNav').isVisible(), false);
    await page.locator('#workspaceBack').click(); assert.equal(await page.locator('#reportView').isVisible(), true);
  });
  await check('new-records', '真实新建运动员与空白历史测试', async page => {
    const before = await page.evaluate(() => App.getLibrary().athletes.map(a => ({ id: a.id, records: a.records.map(r => r.recordId) })));
    await page.getByRole('button', { name: '新建运动员', exact: true }).click();
    await page.locator('#newAthleteName').fill('取消创建的运动员'); await page.locator('#creationNext').click();
    await page.locator('#newAthleteModal').getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => App.getLibrary().athletes.map(a => ({ id: a.id, records: a.records.map(r => r.recordId) }))), before);
    const first = await createAthlete(page, '浏览器回归运动员'); assert.equal(first.athlete.name, '浏览器回归运动员'); assert.equal(first.demo, false);
    assert.equal(first.athlete.sport, '散打'); assert.equal(first.athlete.dominantHand, '左手');
    assert.equal(await input(page, 'data.cmj.0.height').getAttribute('aria-label'), 'CMJ · 尝试 1 · 高度 cm');
    assert.equal(await page.evaluate(() => App.stats().validTests.size), 0);
    await input(page, 'data.cmj.0.height').fill('43.25'); await saved(page);
    await page.getByRole('button', { name: '新建测试记录', exact: true }).click();
    assert.equal(await page.locator('[data-creation-project="cmj"]').isChecked(), true);
    await page.locator('#newAthleteModal').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => App.getState().recordId), first.recordId);
    const second = await createTest(page); assert.equal(second.athleteId, first.athleteId); assert.notEqual(second.recordId, first.recordId);
    assert.equal(second.data.cmj[0].height, ''); assert.equal(second.narrative.text, ''); assert.equal(await page.evaluate(() => App.stats().validTests.size), 0);
    await page.locator('#recordSelect').selectOption(first.recordId); near(await page.evaluate(() => App.stats().values.cmj_height), 43.25);
    return { firstRecord: first.recordId, secondRecord: second.recordId };
  });
  await check('focus-save', '连续录入自动保留、保持焦点且不重建编辑节点', async page => {
    await seed(page); await entry(page, 'cmj'); const field = input(page, 'data.cmj.0.height');
    await field.evaluate(el => { window.__testInput = el; window.__testForm = document.getElementById('entryContent').firstElementChild; });
    await field.fill('43.25'); await saved(page);
    const nodes = await page.evaluate(() => ({ inputSame: window.__testInput === document.querySelector('[data-path="data.cmj.0.height"]'), formSame: window.__testForm === document.getElementById('entryContent').firstElementChild, focusSame: document.activeElement === window.__testInput }));
    assert.deepEqual(nodes, { inputSame: true, formSame: true, focusSame: true });
    await page.reload(); await page.waitForFunction(() => window.App); assert.equal(await page.evaluate(() => App.getState().data.cmj[0].height), '43.25');
    return nodes;
  });
  await check('scroll-details', '从编辑返回报告恢复滚动与折叠状态', async page => {
    await seed(page); await page.locator('#screenDetail > summary').click();
    await page.mouse.wheel(0, 1300); await page.waitForTimeout(100);
    const before = await page.evaluate(() => ({ scroll: scrollY, open: document.getElementById('screenDetail').open })); assert.ok(before.scroll > 300); assert.equal(before.open, false);
    await entry(page, 'cmj'); await input(page, 'data.cmj.0.height').fill('43.3'); await saved(page); await page.locator('#workspaceBack').click();
    await page.waitForTimeout(100); const after = await page.evaluate(() => ({ scroll: scrollY, open: document.getElementById('screenDetail').open }));
    assert.equal(after.open, false); assert.ok(Math.abs(after.scroll - before.scroll) <= 20, JSON.stringify({ before, after })); return { before, after };
  });
  await check('settings-back', '评价设置返回原编辑项目、再返回报告', async page => {
    await seed(page); await entry(page, 'cmj'); await page.evaluate(() => App.openSettings('lvp'));
    assert.equal(await page.locator('#settingsView').isVisible(), true); await input(page, 'lvp.squat.mvt').fill('0.31'); await saved(page);
    await page.locator('#workspaceBack').click(); const first = await page.evaluate(() => App.getUIState()); assert.equal(first.mode, 'entry'); assert.equal(first.entryTab, 'cmj');
    assert.equal(await page.locator('#entryView').isVisible(), true); await page.locator('#workspaceBack').click(); assert.equal(await page.locator('#reportView').isVisible(), true);
    await page.evaluate(() => App.openSettings('references')); await page.locator('#workspaceBack').click(); assert.equal(await page.evaluate(() => App.getUIState().mode), 'report');
    return { entryReturn: first.entryTab };
  });
  await check('legacy-import', '旧JSON和实际v1导出HTML隔离导入、单位值与原正文一致', async page => {
    await page.evaluate(() => App.saveMenu()); await page.locator('#importFile').setInputFiles(fixture);
    await page.waitForFunction(id => App.getState().recordId === id, original.recordId);
    const state = await page.evaluate(() => App.getState()), stats = await page.evaluate(() => App.stats());
    assert.equal(state.schema, 2); near(stats.values.imtp_peak_force, expected.imtp); near(stats.raw.asr, expected.asr); near(stats.raw.dsi, expected.dsiBestComplete);
    assert.equal(state.narrative.legacyTexts.interpretation, original.narratives.interpretation.text); assert.equal(state.narrative.legacyTexts.recommendations, original.narratives.recommendations.text);
    assert.ok(state.data.imtp.every(r => Array.isArray(r.timePoints)));
    const htmlSession = await boot();
    try {
      await htmlSession.page.evaluate(() => App.saveMenu()); await htmlSession.page.locator('#importFile').setInputFiles(legacyHTMLFixture);
      await htmlSession.page.waitForFunction(id => App.getState().recordId === id, original.recordId);
      const htmlState = await htmlSession.page.evaluate(() => App.getState()), htmlStats = await htmlSession.page.evaluate(() => App.stats());
      assert.equal(htmlState.schema, 2); assert.equal(htmlState.recordId, original.recordId); assert.equal(htmlState.athleteId, state.athleteId);
      assert.deepEqual(htmlStats.values, stats.values); near(htmlStats.raw.asr, expected.asr); near(htmlStats.raw.dsi, expected.dsiBestComplete);
      for (const test of ['mas', 'mss', 'ift']) { assert.equal(htmlState.data[test].unit, 'm/s'); assert.deepEqual(htmlState.data[test], state.data[test]); }
      assert.equal(htmlState.thresholds.unit, 'm/s'); near(htmlState.thresholds.lt1, expected.lt1); near(htmlState.thresholds.lt2, expected.lt2);
      assert.deepEqual(htmlState.data.lactate, state.data.lactate); assert.deepEqual(htmlState.definitions.map(d => ({ id: d.id, unit: d.unit, target: d.target, ranges: d.ranges })), state.definitions.map(d => ({ id: d.id, unit: d.unit, target: d.target, ranges: d.ranges })));
      assert.equal(htmlState.narrative.legacyTexts.interpretation, original.narratives.interpretation.text); assert.equal(htmlState.narrative.legacyTexts.recommendations, original.narratives.recommendations.text);
      assert.equal(htmlState.narrative.text, state.narrative.text); assert.equal(htmlState.narrative.html, state.narrative.html);
      return { recordId: state.recordId, jsonAndActualV1HTMLMatch: true, legacyHTMLFixture: { bytes: fs.statSync(legacyHTMLFixture).size, sha256: hash(fs.readFileSync(legacyHTMLFixture)) } };
    } finally { await htmlSession.context.close(); }
  });
  await check('manual-switch', '手写正文即时切换不串记录、重开保留', async page => {
    await seed(page); const oldId = original.recordId;
    const otherId = (await createAthlete(page, '另一位回归运动员')).athleteId;
    const oldAthlete = await page.evaluate(id => App.getLibrary().athletes.find(a => a.records.some(r => r.recordId === id)).id, oldId);
    await page.locator('#athleteSelect').selectOption(oldAthlete); await entry(page, 'narrative');
    await page.locator('#interpEditor').fill('仅属于原测试的手写训练重点'); await page.locator('#athleteSelect').selectOption(otherId); await saved(page);
    const out = await page.evaluate(oldId => ({ old: App.getLibrary().athletes.flatMap(a => a.records).find(r => r.recordId === oldId).narrative.text, current: App.getState().narrative.text, id: App.getState().recordId }), oldId);
    assert.ok(out.old.includes('仅属于原测试')); assert.equal(out.current, ''); await page.reload(); await page.waitForFunction(() => window.App); assert.equal(await page.evaluate(() => App.getState().recordId), out.id); return out;
  });
  await check('rich-text', '真实富文本编辑和返回报告显示保留', async page => {
    await seed(page); await entry(page, 'narrative'); await page.locator('#interpEditor').fill('明确训练重点与执行方式');
    await page.locator('#interpEditor').evaluate(el => { el.focus(); const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    // The imported first block is a heading; change it to a paragraph before toggling bold.
    await page.locator('#narrativeEditorPanel').getByRole('button', { name: '正文', exact: true }).click();
    await page.locator('#narrativeEditorPanel').getByRole('button', { name: '加粗', exact: true }).click();
    assert.ok(/<(strong|b)>/.test(await page.evaluate(() => App.getState().narrative.html)));
    await page.locator('#workspaceBack').click(); assert.ok((await page.locator('#narrativeView').innerText()).includes('明确训练重点'));
    await page.reload(); await page.waitForFunction(() => window.App); assert.ok((await page.locator('#narrativeView').innerHTML()).includes('明确训练重点'));
  });
  await check('draft-revision', '草稿生成后人工编辑、拒绝覆盖时保留正文', async page => {
    await seed(page); await entry(page, 'narrative'); await page.getByRole('button', { name: '生成本地草稿', exact: true }).click();
    assert.equal(await page.locator('#previewModal').isVisible(), true);
    await page.locator('#interpEditor').evaluate(el => { el.innerHTML = '<p>生成后新增人工建议</p>'; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); });
    let prompted = false; page.once('dialog', async dialog => { prompted = true; await dialog.dismiss(); });
    await page.locator('#applyDraftButton').click(); assert.equal(prompted, true); assert.ok((await page.evaluate(() => App.getState().narrative.text)).includes('生成后新增人工建议'));
  });
  await check('draft-stale', '数据变化后的旧草稿不能覆盖正文', async page => {
    await seed(page); await entry(page, 'narrative'); const before = await page.evaluate(() => App.getState().narrative.html);
    await page.getByRole('button', { name: '生成本地草稿', exact: true }).click();
    // Simulate another data-writing event while the preview is open; apply must compare its basis.
    await page.evaluate(() => { App.getState().athlete.mass = Number(App.getState().athlete.mass) + .1; App.applyAI(); });
    assert.equal(await page.evaluate(() => App.getState().narrative.html), before); assert.ok((await page.locator('#toast').innerText()).includes('数据已更新'));
  });
  await check('ai-switch', '模拟AI迟回在运动员切换后不能写入或打开预览', async page => {
    await seed(page); const otherId = (await createAthlete(page, 'AI竞态隔离运动员')).athleteId;
    const oldAthlete = await page.evaluate(id => App.getLibrary().athletes.find(a => a.records.some(r => r.recordId === id)).id, original.recordId);
    await page.locator('#athleteSelect').selectOption(oldAthlete); await configureAI(page);
    let release, signal; const gate = new Promise(resolve => release = resolve), requested = new Promise(resolve => signal = resolve); let requestBody;
    await page.route('https://ringside-tests.invalid/**', async route => { requestBody = route.request().postDataJSON(); signal(); await gate; try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '### 主要发现\n旧运动员迟回正文' } }] }) }); } catch {} });
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    await Promise.race([requested, new Promise((_, reject) => setTimeout(() => reject(new Error('AI request not intercepted')), 6000))]);
    await page.locator('#athleteSelect').selectOption(otherId); const before = await page.evaluate(() => App.getState().narrative.html); release(); await page.waitForTimeout(220);
    assert.equal(await page.evaluate(() => App.getState().narrative.html), before); assert.equal(await page.locator('#previewModal').isVisible(), false);
    assert.ok(!JSON.stringify(requestBody).includes('AI竞态隔离运动员')); assert.ok(!JSON.stringify(requestBody).includes('"name":"示例运动员"'));
    return { model: 'locally simulated', delayedResult: 'discarded after record switch' };
  });
  await check('medicine-grade', '药球保留原良好绿等级、评价目标明确显示差距', async page => {
    await seed(page); const text = await page.locator('#detail-mb').innerText();
    assert.ok(text.includes('良好')); assert.ok(text.includes('距目标 1.2 m') && text.includes('距目标 1.7 m') && text.includes('达成比例')); assert.ok(text.includes('11.8') && text.includes('10.3'));
    const graphics = await page.locator('#detail-mb').innerHTML(); assert.ok(graphics.includes('目标 13 m') && graphics.includes('目标 12 m')); assert.ok(graphics.includes('stroke-dasharray="3 3"')); assert.ok(graphics.includes(await page.evaluate(() => RingsideViz.C.green)));
    const grades = await page.evaluate(() => { const s = App.stats(), r = App.getState(); return ['mb_dom', 'mb_non'].map(id => ({ value: s.values[id], grade: RingsideModel.evaluation(s.values[id], r.definitions.find(d => d.id === id), r) })); });
    assert.ok(grades.every(x => x.grade.label === '良好' && x.grade.status === 'green')); return grades;
  });
  await check('force-edit', '力时点录入推算、删除同步、负原值保留与核对提示', async page => {
    await seed(page); await entry(page, 'imtp'); await input(page, 'data.imtp.0.baselineForce').fill('500');
    await page.evaluate(() => App.addForcePoint(0)); await input(page, 'data.imtp.0.timePoints.0.timeMs').fill('100'); await input(page, 'data.imtp.0.timePoints.0.rfd').fill('9000'); await saved(page);
    let state = await page.evaluate(() => App.getState()); assert.equal(Number(state.data.imtp[0].rfd100), 9000); near((await page.evaluate(() => App.stats().raw.forceTime)).points[0].force, 1400);
    await input(page, 'data.imtp.0.timePoints.0.force').fill('1400'); await saved(page); assert.equal(Number((await page.evaluate(() => App.getState())).data.imtp[0].f100), 1400);
    await page.evaluate(() => App.addForcePoint(0)); await input(page, 'data.imtp.0.timePoints.1.timeMs').fill('200'); await input(page, 'data.imtp.0.timePoints.1.force').fill('2200'); await saved(page);
    const pendingForce = input(page, 'data.imtp.0.timePoints.1.force'), forceError = pendingForce.locator('xpath=..').locator('.field-error');
    await pendingForce.focus(); await pendingForce.press('Control+A'); await pendingForce.press('e'); await saved(page);
    const unfinishedNumber = await pendingForce.evaluate(el => ({ value: el.value, badInput: el.validity.badInput }));
    assert.equal(unfinishedNumber.badInput, true, JSON.stringify(unfinishedNumber)); assert.equal(unfinishedNumber.value, '');
    state = await page.evaluate(() => App.getState()); assert.equal(Number(state.data.imtp[0].timePoints[1].force), 2200); assert.equal(Number(state.data.imtp[0].f200), 2200);
    assert.equal(await pendingForce.getAttribute('aria-invalid'), 'true'); assert.equal(await forceError.isVisible(), true); assert.ok((await forceError.innerText()).includes('此值未保存'));
    await pendingForce.fill('2200'); await saved(page); assert.equal(await pendingForce.evaluate(el => el.validity.badInput), false);
    assert.equal(await pendingForce.getAttribute('aria-invalid'), null); assert.equal(await forceError.count(), 0);
    const secondTime = input(page, 'data.imtp.0.timePoints.1.timeMs'), secondError = secondTime.locator('xpath=..').locator('.field-error');
    await secondTime.fill('100'); await saved(page);
    state = await page.evaluate(() => App.getState()); assert.equal(Number(state.data.imtp[0].timePoints[1].timeMs), 200); assert.equal(Number(state.data.imtp[0].f200), 2200);
    assert.equal(await secondTime.getAttribute('aria-invalid'), 'true'); assert.equal(await secondError.isVisible(), true); assert.ok((await secondError.innerText()).includes('此值未保存'));
    assert.ok((await page.locator('#entrySave').innerText()).includes('部分输入未保存'));
    await secondTime.fill('200'); await saved(page); assert.equal(await secondTime.getAttribute('aria-invalid'), null); assert.equal(await secondError.count(), 0);
    assert.ok((await page.locator('#entrySave').innerText()).includes('已保留当前修改'));
    await page.locator('#workspaceBack').click(); assert.equal(await page.locator('#detail-imtp [data-force-time="100"]').count(), 1); assert.equal(await page.locator('#detail-imtp [data-force-time="200"]').count(), 1);
    await entry(page, 'imtp'); const pointRow = input(page, 'data.imtp.0.timePoints.0.timeMs').locator('xpath=ancestor::tr'); await pointRow.getByRole('button').click(); await saved(page);
    state = await page.evaluate(() => App.getState()); assert.equal(state.data.imtp[0].f100, ''); assert.equal(state.data.imtp[0].rfd100, ''); assert.equal(Number(state.data.imtp[0].f200), 2200);
    await page.reload(); await page.waitForFunction(() => window.App); assert.equal((await page.evaluate(() => App.getState())).data.imtp[0].timePoints.length, 1);
    await entry(page, 'imtp');
    await input(page, 'data.imtp.0.baselineForce').fill('-500');
    await input(page, 'data.imtp.0.timePoints.0.force').fill('-600');
    await input(page, 'data.imtp.0.timePoints.0.rfd').fill('-8000');
    await input(page, 'data.imtp.0.peakForce').fill(''); await saved(page);
    let negative = await page.evaluate(() => ({ row: App.getState().data.imtp[0], curve: App.stats().raw.forceTime, valid: RingsideModel.validateRecord(App.getState()) }));
    assert.equal(Number(negative.row.baselineForce), -500); assert.equal(Number(negative.row.f200), -600); assert.equal(Number(negative.row.rfd200), -8000);
    assert.equal(negative.curve.points.length, 0); assert.equal(negative.curve.peakForce, null); assert.equal(negative.valid, true);
    let warning = await page.locator('[data-force-warnings="0"]').innerText();
    assert.ok(warning.includes('基线力为负') && warning.includes('力为负') && warning.includes('RFD 为负'));
    await input(page, 'data.imtp.0.peakForce').fill('-3000'); await saved(page);
    warning = await page.locator('[data-force-warnings="0"]').innerText(); assert.ok(warning.includes('峰值力为负'));
    await page.reload(); await page.waitForFunction(() => window.App);
    negative = await page.evaluate(() => ({ row: App.getState().data.imtp[0], curve: App.stats().raw.forceTime, valid: RingsideModel.validateRecord(App.getState()) }));
    assert.equal(Number(negative.row.peakForce), -3000); assert.equal(Number(negative.row.baselineForce), -500);
    assert.equal(Number(negative.row.timePoints[0].force), -600); assert.equal(Number(negative.row.timePoints[0].rfd), -8000);
    assert.equal(negative.curve.points.length, 0); assert.equal(negative.valid, true);
  });
  await check('lvp-mvt', '所有LVP显示预估1RM、地雷杠有MVT才产生估计', async page => {
    await seed(page); assert.ok((await page.locator('#lvp-upper').innerText()).includes('预估1RM')); assert.ok((await page.locator('#lvp-lower').innerText()).includes('预估1RM'));
    let estimate = await page.evaluate(() => App.stats().lvpSeries.find(s => s.id === 'landmineR').est); assert.equal(estimate.valid, false);
    await page.evaluate(() => App.openSettings('lvp')); await input(page, 'lvp.landmineR.mvt').fill('1'); await saved(page); await page.locator('#workspaceBack').click();
    estimate = await page.evaluate(() => App.stats().lvpSeries.find(s => s.id === 'landmineR').est); assert.equal(estimate.valid, true); assert.ok(estimate.load > 0);
    await page.evaluate(() => App.openSettings('lvp')); await input(page, 'lvp.landmineR.mvt').fill(''); await saved(page); await page.locator('#workspaceBack').click();
    assert.equal(await page.evaluate(() => App.stats().lvpSeries.find(s => s.id === 'landmineR').est.valid), false); return { withMVTLoad: estimate.load };
  });
  await check('json-library', '当前JSON与整库实际下载、隔离环境恢复记录', async page => {
    await seed(page); await createAthlete(page, '备份回归运动员'); await createTest(page);
    const snapshot = await page.evaluate(() => ({ report: App.reportPayload(), library: App.libraryPayload() }));
    const currentFile = await download(page, '导出当前报告 JSON', 'redesign-current-report.json'); const libraryFile = await download(page, '备份整个运动员库 JSON', 'redesign-library-backup.json');
    const report = JSON.parse(fs.readFileSync(currentFile, 'utf8')), library = JSON.parse(fs.readFileSync(libraryFile, 'utf8')); assert.equal(report.record.recordId, snapshot.report.record.recordId); assert.equal(report.athletes, undefined);
    const sourceIds = snapshot.library.athletes.flatMap(a => a.records.map(r => r.recordId));
    const restore = await boot(); try { await restore.page.locator('#importFile').setInputFiles(libraryFile); await restore.page.waitForFunction(id => App.getLibrary().athletes.some(a => a.records.some(r => r.recordId === id)), snapshot.report.record.recordId); const ids = await restore.page.evaluate(() => App.getLibrary().athletes.flatMap(a => a.records.map(r => r.recordId))); sourceIds.forEach(id => assert.ok(ids.includes(id))); } finally { await restore.context.close(); }
    assert.ok(library.athletes.length >= 2); return { restoredRecords: sourceIds.length };
  });
  await check('html-offline', 'HTML实际下载仅含当前测试、移动后离线可编辑', async page => {
    await seed(page); await createAthlete(page, '另一个不会导出的运动员'); const oldAthlete = await page.evaluate(id => App.getLibrary().athletes.find(a => a.records.some(r => r.recordId === id)).id, original.recordId); await page.locator('#athleteSelect').selectOption(oldAthlete);
    const filename = await download(page, '保存当前可编辑 HTML 报告', 'redesign-portable-report.html'); const html = fs.readFileSync(filename, 'utf8');
    assert.ok(!html.includes('另一个不会导出的运动员')); assert.ok(!html.includes('local-test-secret'));
    const payload = JSON.parse(html.match(/<script id="embedded-data" type="application\/json">([^]*?)<\/script>/)[1]); assert.equal(payload.record.recordId, original.recordId); assert.equal(payload.athletes, undefined);
    const offline = await boot(pathToFileURL(filename).href); try {
      const lib = await offline.page.evaluate(() => App.getLibrary()); assert.equal(lib.athletes.length, 1); assert.equal(lib.athletes[0].records.length, 1);
      near((await offline.page.evaluate(() => App.stats())).raw.asr, expected.asr); assert.equal(offline.requests.filter(url => /^https?:/.test(url)).length, 0);
      await entry(offline.page, 'cmj'); await input(offline.page, 'data.cmj.0.height').fill('44.8'); await saved(offline.page); assert.equal(await offline.page.evaluate(() => App.getState().data.cmj[0].height), '44.8'); await offline.page.locator('#workspaceBack').click(); await shot(offline.page, 'offline-report');
    } finally { await offline.context.close(); }
    const importer = await boot(); try { await importer.page.locator('#importFile').setInputFiles(filename); await importer.page.waitForFunction(id => App.getState().recordId === id, original.recordId); near((await importer.page.evaluate(() => App.stats())).raw.dsi, expected.dsiBestComplete); } finally { await importer.context.close(); }
  });
  await check('import-security', '非法数据与HTML事件导入被隔离、不部分写库', async page => {
    await seed(page);
    const invalid = await page.evaluate(() => { const before = JSON.stringify(App.getLibrary()), bad = JSON.parse('{"schema":2,"kind":"athlete-library","athletes":[],"__proto__":{"x":1}}'); let error = ''; try { App.importPayload(bad); } catch(e) { error = e.message; } return { error, unchanged: before === JSON.stringify(App.getLibrary()) }; }); assert.ok(invalid.error); assert.equal(invalid.unchanged, true);
    const incoming = JSON.parse(JSON.stringify(original)); incoming.recordId = 'redesign_malicious_import'; incoming.athlete.name = 'HTML事件导入验收';
    const filename = path.join(artifactDir, 'redesign-malicious-import.html'); fs.writeFileSync(filename, '<!doctype html><html><body><img src=x onerror="window.__importXSS=1"><script>window.__importXSS=2</script><script id="embedded-data" type="application/json">' + JSON.stringify(incoming).replace(/</g, '\\u003c') + '</script></body></html>');
    await page.evaluate(() => window.__importXSS = 0); await page.locator('#importFile').setInputFiles(filename); await page.waitForFunction(() => App.getState().recordId === 'redesign_malicious_import'); assert.equal(await page.evaluate(() => window.__importXSS), 0);
    return { unsafeDataRejected: true, inertHTMLImport: true };
  });
  await check('responsive', '桌面和移动抽屉交互、报告编辑设置无页面横向越界', async page => {
    await seed(page); await shot(page, 'desktop-report'); await entry(page, 'imtp'); await shot(page, 'desktop-edit'); await page.locator('#workspaceBack').click();
    const widths = [];
    for (const width of [1440, 1280, 900, 820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(() => App.showReport()); await page.waitForTimeout(400);
      const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width + 1, JSON.stringify(size)); widths.push(size);
      assert.equal(await page.locator('#recordContext').isVisible(), true);
    }
    assert.equal(await page.locator('#sidebarScrim').isVisible(), false); await page.locator('#sidebarToggle').click(); assert.equal(await page.locator('#sidebarScrim').isVisible(), true); await shot(page, 'mobile-drawer', false);
    await page.locator('#reportNav').locator('a,button').filter({ hasText: '具体数据' }).first().click(); assert.equal(await page.locator('#sidebarScrim').isVisible(), false);
    await page.evaluate(() => App.navigate('summary')); await shot(page, 'mobile-report');
    await entry(page, 'imtp'); await shot(page, 'mobile-edit'); const editSize = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(editSize.scroll <= editSize.width + 1, JSON.stringify(editSize));
    await page.evaluate(() => App.openSettings('definitions')); const settingsSize = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(settingsSize.scroll <= settingsSize.width + 1, JSON.stringify(settingsSize)); await shot(page, 'mobile-settings'); return { reportWidths: widths, edit: editSize, settings: settingsSize };
  });
}

(async () => {
  try {
    assert.equal(results.compiledModel.matchesSource, true, 'Compiled model differs from current src/ringside-model.js; rebuild the standalone HTML before browser verification.');
    serverInfo = await startServer(); browser = await chromium.launch({ headless: true }); await run();
  } catch (error) { results.fatal = error.stack || String(error); console.error(error); }
  finally {
    if (browser) await browser.close(); if (serverInfo) await new Promise(resolve => serverInfo.server.close(resolve));
    results.finished = new Date().toISOString(); results.passed = results.tests.filter(x => x.pass).length; results.failed = results.tests.filter(x => !x.pass).length;
    fs.writeFileSync(path.join(artifactDir, 'redesign-verification-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ passed: results.passed, failed: results.failed, browserErrors: results.browserErrors.length, results: 'output/playwright/redesign-verification-results.json' }));
    process.exitCode = results.failed || results.browserErrors.length || results.fatal ? 1 : 0;
  }
})();
