(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validDate = value => root.RingsideLongitudinalStore.validDate(value);
  const order = (a,b) => String(a.athlete.date).localeCompare(String(b.athlete.date)) || String(a.created || '').localeCompare(String(b.created || '')) || a.recordId.localeCompare(b.recordId);
  function create(host) {
    let selection = null, model = null, document = null, rawRecords = [], sequence = 0, suspended = false, loading = false, pendingIds = null;
    let chartSequence = 0, chartPending = 0, chartSaveBarrier = null, savedCharts;
    root.document.addEventListener('pointerdown', event => { const menu=root.document.getElementById('recordChoiceMenu');if(menu?.open&&!menu.contains(event.target))menu.open=false; });
    root.document.addEventListener('keydown', event => { const menu=root.document.getElementById('recordChoiceMenu');if(event.key==='Escape'&&menu?.open){menu.open=false;root.document.getElementById('recordChoiceLabel').focus();event.preventDefault();} });
    const active = () => !!model && !!selection && selection.recordIds.length > 1 && !suspended && host.state()?.athleteId === selection.athleteId && selection.recordIds.includes(host.state()?.recordId);
    const currentSelection = () => selection ? clone(selection) : null;
    function clear() { sequence++; chartSequence++; selection = model = document = null; rawRecords = []; pendingIds = null; savedCharts = undefined; suspended = loading = false; }
    function cancelPending() { sequence++; pendingIds = null; loading = false; }
    function recordIds() { return selection?.recordIds || (host.state() ? [host.state().recordId] : []); }
    function renderPicker() {
      const menu = root.document.getElementById('recordChoices'), summary = root.document.getElementById('recordChoiceLabel');
      if (!menu || !summary) return;
      const focused = root.document.activeElement?.dataset.recordChoice;
      const a = host.library()?.athletes.find(a => a.id === host.library().activeAthleteId), ids = pendingIds || recordIds();
      const rows = (a?.records || []).filter(r => !r.archived && !r.deletedAt).sort((a,b) => -order(a,b));
      summary.textContent = ids.length > 1 ? `已选择 ${ids.length} 条测试记录` : rows.find(r => r.recordId === ids[0])?.athlete.date || '选择测试记录';
      menu.innerHTML = rows.map(r => `<label class="longitudinal-record-option"><input type="checkbox" data-record-choice="${esc(r.recordId)}" ${ids.includes(r.recordId)?'checked':''}><span>${esc(r.athlete.date || '未填日期')}<small>${esc(r.title || '测试记录')} · ${esc(r.recordId.slice(-6))}</small></span></label>`).join('') || '<p class="empty">尚无测试记录</p>';
      menu.querySelectorAll('[data-record-choice]').forEach(input => input.addEventListener('change', () => {
        const next = [...menu.querySelectorAll('[data-record-choice]:checked')].map(input => input.dataset.recordChoice);
        select(next).catch(error => { host.error(error.message); renderPicker(); });
      }));
      if(focused&&root.document.getElementById('recordChoiceMenu').open)[...menu.querySelectorAll('[data-record-choice]')].find(input=>input.dataset.recordChoice===focused)?.focus({preventScroll:true});
    }
    async function select(ids, options = {}) {
      ids = [...new Set(ids)];
      const lib = host.library(), athleteId = options.athleteId || lib.activeAthleteId;
      const a = lib.athletes.find(a => a.id === athleteId && !a.deletedAt && !a.archived);
      if (!a) return false;
      const summaries = ids.map(id => a.records.find(r => r.recordId === id && !r.deletedAt && !r.archived));
      if (summaries.some(r => !r)) throw Error('所选测试记录已不存在，请重新选择。');
      if (ids.length > 1 && summaries.some(r => !validDate(r.athlete.date))) throw Error('请先补齐所选记录的有效测试日期。');
      const ticket = ++sequence;
      pendingIds = ids; loading = true;
      try {
      host.saveEditor();
      if (ids.length > 1) host.prepareAnchor?.();
      if (!options.restoring && !await host.save()) { renderPicker(); return false; }
      if (ticket !== sequence) return false;
      if (ids.length < 2) { clear(); await host.switchRecord(a, summaries[0] || null); host.remember(); return true; }
        const records = await Promise.all(ids.map(id => host.repository().loadRecord(id)));
        if (ticket !== sequence) return false;
        if (records.some(r => !r || r.deletedAt || r.archived || r.athleteId !== athleteId)) throw Error('所选测试记录已变化，请重新选择。');
        records.sort(order);
        const latest = records.at(-1), store = root.RingsideLongitudinalStore;
        const saved = store.get(lib, athleteId, ids);
        const mode = options.mode || saved?.mode || latest.mode;
        const profile = lib.evaluationProfiles.find(p => p.id === latest.evaluationProfileId);
        const built = root.RingsideLongitudinal.build(records, {athleteId, mode, profile, catalog:lib.catalog, views:saved?.views || {}});
        if (ticket !== sequence) return false;
        host.cancelAI();
        const stamp = new Date().toISOString();
        const nextSelection = {athleteId, recordIds:records.map(r => r.recordId), mode};
        const nextDocument = store.normalize({...saved, version:1, key:store.key(athleteId,ids), athleteId, recordIds:nextSelection.recordIds, mode,
          evaluationProfileId:latest.evaluationProfileId, profileSnapshot:profile ? clone(profile) : null, views:saved?.views || {},
          narrative:saved?.narrative || {text:'',html:'',revision:0,basis:'',origin:'manual'}, basis:built.fingerprint || built.basis,
          created:saved?.created || stamp, updated:stamp, revision:saved?.revision || 0});
        store.put(lib, nextDocument);
        if (!options.restoring && !await host.save()) {
          if (ticket === sequence) { saved ? store.put(lib,saved) : store.remove(lib,nextDocument.key); }
          return false;
        }
        if (ticket !== sequence) return false;
        if (!options.restoring && host.state()?.recordId !== latest.recordId && !await host.switchRecord(a, latest, {longitudinal:true})) return false;
        if (ticket !== sequence) return false;
        selection = nextSelection; document = nextDocument; rawRecords = records; model = built; suspended = false;
        savedCharts = document.views.charts === undefined ? undefined : clone(document.views.charts);
        host.prepareAnchor?.();
        host.restoreView?.(document.views);
        host.render(); host.remember(); return true;
      } finally { if (ticket === sequence) { loading = false; pendingIds = null; renderPicker(); } }
    }
    async function refresh() {
      if (!selection) return;
      const athlete = host.library().athletes.find(a => a.id === selection.athleteId && !a.archived && !a.deletedAt);
      if (!athlete || selection.recordIds.some(id => !athlete.records.some(r => r.recordId === id && !r.archived && !r.deletedAt))) { clear(); return false; }
      return select(selection.recordIds, {...selection, restoring:true});
    }
    async function changeMode(mode) {
      if (!['best','mean'].includes(mode) || !selection) return;
      return select(selection.recordIds, {...selection, mode});
    }
    function putDocument() {
      if (!document) return;
      document.updated = new Date().toISOString(); document.revision = (document.revision || 0) + 1;
      root.RingsideLongitudinalStore.put(host.library(), document);
    }
    function setNarrative(value, previous = false) {
      if (!active()) return false;
      if (previous) document.previousNarrative = clone(document.narrative);
      document.narrative = clone(value); putDocument(); return true;
    }
    function setViews(value, replace = false) {
      if (!active()) return;
      const next = root.RingsideLongitudinalViews.normalize(replace ? clone(value) : {...document.views, ...clone(value)}, selection.recordIds);
      if (JSON.stringify(next) === JSON.stringify(document.views)) return;
      const analysisIdentity = views => JSON.stringify(Object.entries(views.charts || {}).filter(([, chart]) => chart.analysis).map(([id, chart]) => [id, chart.analysis]));
      if (analysisIdentity(next) !== analysisIdentity(document.views)) {
        const built = root.RingsideLongitudinal.build(rawRecords, {...selection, profile:document.profileSnapshot, catalog:host.library().catalog, views:next});
        host.cancelAI(); model = built; document.basis = built.basis;
      }
      document.views = next; putDocument(); return true;
    }
    async function updateChartView(chartId, delta) {
      if (!active() || loading) return false;
      const owner = document;
      let next;
      try {
        host.captureView?.();
        next = root.RingsideLongitudinalViews.patch(document.views, chartId, delta, selection.recordIds);
      } catch (error) { host.error(error.message); host.renderDisplay ? host.renderDisplay() : render(); return false; }
      const ticket = ++chartSequence;
      // Ordinary saves must wait before capturing optimistic chart choices.
      // Rendering can emit disclosure events and enqueue an ordinary save.
      if (!chartSaveBarrier) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        chartSaveBarrier = {promise, resolve};
      }
      chartPending++;
      try {
        setViews(next);
        host.renderDisplay ? host.renderDisplay() : render();
        host.remember();
        let saved = false;
        try { saved = await host.save({longitudinalDisplay:true}); }
        catch (error) { host.error(error.message); }
        if (document !== owner) return saved;
        if (saved) savedCharts = next.charts === undefined ? undefined : clone(next.charts);
        else if (ticket === chartSequence) {
          // Revert only chart choices. Later narrative/disclosure changes and
          // other comparisons must never be replaced by an older failed save.
          const reverted = clone(document.views);
          if (savedCharts === undefined) delete reverted.charts;
          else reverted.charts = clone(savedCharts);
          setViews(reverted, true);
          if (active()) { host.renderDisplay ? host.renderDisplay() : render(); host.remember(); }
        }
        return saved;
      } finally {
        chartPending--;
        if (!chartPending) {
          const settled = chartSaveBarrier;
          chartSaveBarrier = null;
          settled.resolve();
        }
      }
    }
    function render() {
      if (!active()) return false;
      const $ = id => root.document.getElementById(id), out = root.RingsideLongitudinalView.render(model, {views:document.views});
      $('reportView').dataset.longitudinal = 'true';
      $('reportView').dataset.longitudinalOwner = document.key;
      $('reportTitle').textContent = '运动表现与损伤风险纵向比较';
      $('athleteMeta').innerHTML = [host.state()?.athlete.name, `${selection.recordIds.length} 次测试`, `${model.periods[0].date} — ${model.periods.at(-1).date}`, document.profileSnapshot?.name].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join('');
      $('recordContext').textContent = `${host.state()?.athlete.name || ''} · ${selection.recordIds.length} 次测试`;
      $('aggMode').value = selection.mode;
      $('migrationReviewNotice').hidden = true;
      $('microCards').innerHTML = out.summary || '';
      $('bodyChart').innerHTML = out.body || '';
      $('screenItems').innerHTML = out.screenItems || '';
      $('screenPill').textContent = out.screenPill || '各期筛查'; $('screenPill').className = 'pill';
      $('radarChart').innerHTML = out.overview || '';
      $('referenceLabel').textContent = out.referenceLabel || document.profileSnapshot?.name || '';
      $('radarLegend').innerHTML = out.legend || '';
      $('directionMetrics').hidden = true;
      $('detailContent').innerHTML = out.details || '';
      $('dataCount').textContent = `${selection.recordIds.length} 次测试 · 统一代表成绩与评价方案`;
      $('editButton').textContent = '编辑测试记录';
      $('reportExportMenu').querySelector('summary').textContent = '导出比较报告';
      root.RingsideLongitudinalView.mount?.($('reportView'), model, {onChange:updateChartView});
      $('reportView').querySelectorAll('details[id]').forEach(node => { if (document.views.detailOpen?.[node.id] !== undefined) node.open = document.views.detailOpen[node.id]; });
      return true;
    }
    function edit() {
      if (!active()) return false;
      const box = root.document.getElementById('longitudinalEditChoices');
      box.innerHTML = rawRecords.map(r => `<button type="button" class="btn" data-longitudinal-edit="${esc(r.recordId)}">${esc(r.athlete.date)} · ${esc(r.title || r.recordId.slice(-6))}</button>`).join('');
      box.querySelectorAll('[data-longitudinal-edit]').forEach(button => button.addEventListener('click', async () => {
        host.close('longitudinalEditModal');
        const a = host.library().athletes.find(a => a.id === selection.athleteId), record = a.records.find(r => r.recordId === button.dataset.longitudinalEdit);
        suspended = true;
        await host.switchRecord(a, record, {longitudinal:true, edit:true});
        host.remember();
      }));
      host.modal('longitudinalEditModal'); return true;
    }
    function payload() {
      if (!active()) return null;
      return {schema:1, kind:'longitudinal-report', library:root.RingsideLongitudinalStore.exportLibrary(host.library(),document,rawRecords), selection:currentSelection()};
    }
    return {active, clear, cancelPending, select, refresh, changeMode, render, renderPicker, edit, payload, setNarrative, setViews, updateChartView,
      selection:currentSelection, model:() => model, document:() => document, isLoading:() => loading || chartPending > 0,
      pendingDisplaySave:() => chartSaveBarrier?.promise || null,
      narrative:() => document?.narrative, basis:() => model?.fingerprint || model?.basis || '',
      owner:() => active() ? document.key : '', facts:() => root.RingsideLongitudinal.facts(model),
      suspend:()=>{suspended=true;},
      restore:async value => { if(value?.recordIds?.length>1) return select(value.recordIds,{...value,restoring:true}); },
      resume:async () => { if(selection) { suspended=false;return refresh(); } }};
  }
  root.RingsideLongitudinalController = {create,validDate};
})(window);
