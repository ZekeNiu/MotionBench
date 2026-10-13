(function (root) {
  "use strict";
  const copy = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const $ = id => document.getElementById(id);
  const stamp = () => new Date().toISOString();
  function create(host) {
    let selection = {groupId:"",athleteIds:[],dates:[],recordChoices:{},basis:{}}, model = null, documentValue = null;
    let inputSnapshot = null, expectedConfig = null, sequence = 0, saveQueue = Promise.resolve(true), saveTimer = null;
    let suspended = false, editing = false, dirty = false, saveError = false, switching = false, requestedSelection = null, editorRevisionSaved = false, computationToken = null;
    const uiKey = "ringside-comparison-ui-v1:" + location.pathname;
    const api = {
      get active() { return !suspended && (selection.athleteIds.length > 1 || selection.dates.length > 1); },
      get editing() { return editing; }, get switching() { return switching; },
      get selection() { return copy(selection); }, get model() { return model; }, get document() { return documentValue; },
      get saveError() { return saveError; },
      get computing() { return requestedSelection !== null || computationToken === sequence; },
    };
    const liveOwners = () => host.library()?.athletes.filter(a=>!a.deletedAt&&!a.archived) || [];
    const owner = id => host.library()?.athletes.find(a=>a.id===id);
    const records = id => (owner(id)?.records || []).filter(r=>!r.deletedAt&&!r.archived);
    const offeredRecords = id => (owner(id)?.records || []).filter(r=>!r.deletedAt&&(!r.archived||selection.recordChoices[id]?.[r.athlete.date]===r.recordId));
    const selectedIds = () => requestedSelection ? requestedSelection.athleteIds : selection.athleteIds.length ? selection.athleteIds : host.state() ? [host.state().athleteId] : [];
    const identity = value => JSON.stringify({groupId:value.groupId||"",athleteIds:[...value.athleteIds].sort(),dates:[...value.dates].sort(),recordChoices:Object.fromEntries([...value.athleteIds].sort().map(id=>[id,Object.fromEntries([...value.dates].sort().map(date=>[date,value.recordChoices?.[id]?.[date]||""]))]))});
    function remember() { try { localStorage.setItem(uiKey,JSON.stringify({selection,active:api.active,documentId:documentValue?.id,editingRecord:suspended})); } catch { saveError=true; } }
    function canonical(input) {
      const next={groupId:input.groupId||"",athleteIds:[...new Set(input.athleteIds||[])],dates:[...new Set(input.dates||[])].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort(),recordChoices:copy(input.recordChoices||{}),basis:copy(input.basis||{})};
      if (!next.dates.length && next.athleteIds.length) {
        const dates=next.athleteIds.flatMap(id=>records(id).map(r=>r.athlete.date)).filter(Boolean).sort();
        if (dates.length) next.dates=[host.state()?.athlete.date && dates.includes(host.state().athlete.date)?host.state().athlete.date:dates.at(-1)];
      }
      next.recordChoices=Object.fromEntries(next.athleteIds.map(id=>[id,Object.fromEntries(next.dates.map(date=>{
        const candidates=records(id).filter(r=>r.athlete.date===date), previous=next.recordChoices[id]?.[date];
        return [date,previous|| (candidates.length===1?candidates[0].recordId:"")];
      }))]));
      return next;
    }
    function findDocument(next) { return (host.library()?.comparisonReports||[]).find(doc=>identity(doc.selection)===identity(next)); }
    async function select(input,{restoreDocument=false,documentId="",duringTransfer=false}={}) {
      const token=++sequence;
      requestedSelection=canonical(input);
      host.saveEditor();
      if (!await flush() || !await host.persist({duringTransfer})) {if(token===sequence)requestedSelection=null;return false;}
      if (token!==sequence) return false;
      host.cancelJob();if(editing)leaveNarrative();suspended=false;computationToken=token;
      selection=requestedSelection;requestedSelection=null;
      model=null;documentValue=null;inputSnapshot=null;expectedConfig=null;
      if (!api.active) {
        model=null;documentValue=null;inputSnapshot=null;expectedConfig=null;
        const id=selection.athleteIds[0], a=owner(id), recordId=selection.recordChoices[id]?.[selection.dates[0]];
        const r=recordId?records(id).find(r=>r.recordId===recordId):selection.dates.length?null:records(id)[0];
        switching=true;
        try { await host.switchRecord(a||null,r||null); } finally {switching=false;}
        computationToken=null;remember();host.renderSelectors();return true;
      }
      host.setMode("report");
      $("startupStatus").hidden=false;$("startupStatus").textContent="正在整理所选测试…";
      try {
        const input=await host.repository().readComparisonInputs(selection);
        if(token!==sequence)return false;
        inputSnapshot=input;expectedConfig=input.expectedConfig;
        const stored=(documentId&&(host.library()?.comparisonReports||[]).find(doc=>doc.id===documentId))||findDocument(selection);
        documentValue=stored?copy(stored):{id:root.crypto.randomUUID(),title:"",selection:copy(selection),views:{projects:{},capabilityExpanded:{}},narrative:{text:"",html:"",revision:0},revisions:[],created:stamp(),updated:stamp(),inputFingerprint:""};
        if(stored && restoreDocument)selection.basis=copy(stored.selection.basis||{});
        documentValue.selection=copy(selection);
        if(!await recompute(token))return false;dirty=!stored;
        if(!host.repository().sameVersion(input.versionState,await host.repository().versionState()))throw Error("计算期间测试资料已更新，请重新选择本次报告");
        remember();host.render();
        if(model?.ready!==false)await flush();
        return true;
      } catch(error) {if(token===sequence&&error.name!=="AbortError"){model={ready:false,issues:[error.message]};host.render();host.toast("比较报告未打开："+error.message);}return false; }
      finally {if(token===sequence){computationToken=null;$("startupStatus").hidden=true;$("startupStatus").textContent="正在打开本机资料库…";}}
    }
    async function recompute(token=sequence) {
      if(!inputSnapshot)return;
      const input=root.RingsideComparison.readComparisonInputs(inputSnapshot.library,selection);
      const derived=root.RingsideComparison.deriveComparisonAsync ? await root.RingsideComparison.deriveComparisonAsync(input,{isCurrent:()=>token===sequence,onProgress:({current,total})=>{if(token===sequence)$("startupStatus").textContent=`正在计算 ${current} / ${total} 条测试记录…`;}}) : root.RingsideComparison.deriveComparison(input);
      if(token!==sequence)return false;
      model=derived;
      selection=copy(model.selection);
      documentValue.selection=copy(selection);
      documentValue.inputFingerprint=model.fingerprint;
      return true;
    }
    async function refresh() {
      if(!api.active)return;
      const token=++sequence;computationToken=token;$("startupStatus").hidden=false;
      try{
        if(!await flush())return false;
        const input=await host.repository().readComparisonInputs(selection);
        if(token!==sequence)return false;
        inputSnapshot=input;expectedConfig=input.expectedConfig;
        if(!await recompute(token))return false;
        if(!host.repository().sameVersion(input.versionState,await host.repository().versionState()))throw Error("计算期间测试资料已更新，请重新选择本次报告");
        markDirty();host.render();return true;
      }catch(error){if(token===sequence&&error.name!=="AbortError"){model={...model,ready:false,issues:[error.message]};host.render();host.toast("比较报告未更新："+error.message);}return false;}
      finally{if(token===sequence){computationToken=null;$("startupStatus").hidden=true;}}
    }
    function markDirty() { dirty=true;documentValue.updated=stamp();clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush(),250);remember(); }
    async function flush() {
      clearTimeout(saveTimer);saveTimer=null;
      if(!dirty||!documentValue||model?.ready===false)return saveQueue;
      const snapshot=copy(documentValue);dirty=false;
      const saving=saveQueue.then(async()=>{
        const current=await host.repository().get("config","library");
        // Our own original-record save barrier may update active selection only.
        if(expectedConfig!==JSON.stringify(current)) {
          const before=JSON.parse(expectedConfig||"{}");
          const unrelated=object=>Object.fromEntries(Object.entries(object).filter(([key])=>!["activeAthleteId","activeRecordId","updated"].includes(key)));
          if(JSON.stringify(unrelated(before))!==JSON.stringify(unrelated(current)))throw Error("资料库已更新，请重新打开比较报告后保存；当前正文草稿仍保留");
          expectedConfig=JSON.stringify(current);
        }
        const result=await host.repository().saveComparisonReport(snapshot,expectedConfig);
        expectedConfig=result.expectedConfig;host.acceptConfig(result.config);saveError=false;
        $("saveStatus").textContent="已保存到本机";return true;
      }).catch(error=>{dirty=true;saveError=true;$("saveStatus").textContent="保存失败 · "+error.message;try{localStorage.setItem(uiKey+":draft",JSON.stringify(snapshot));}catch{}return false;});
      saveQueue=saving;return saving;
    }
    function label() {const ids=selectedIds();return ids.length>1?`已选 ${ids.length} 名队员`:owner(ids[0])?.name||"";}
    function renderSelectors() {
      if(!host.library())return;
      if(selection.groupId&&host.library().groups.some(group=>group.id===selection.groupId))$("reportGroupFilter").value=selection.groupId;
      const ids=selectedIds();
      $("reportAthleteSearch").setAttribute("aria-label","搜索并多选队员");
      if(!$("reportAthleteOptions").hidden && document.activeElement===$("reportAthleteSearch"))return renderRecordChoices();
      $("reportAthleteSearch").value=label();
      renderRecordChoices();
    }
    function renderRecordChoices() {
      const ids=selectedIds(), dates=[...new Set([...selection.dates,...ids.flatMap(id=>offeredRecords(id).map(r=>r.athlete.date)).filter(Boolean)])].sort().reverse();
      const currentDates=selection.dates.length?selection.dates:host.state()?[host.state().athlete.date]:[];
      const container=$("reportRecordChoices");if(!container)return;
      const title=api.active?`${selection.dates.length} 个测试日期 · ${ids.length} 名队员`:host.state()?`${host.state().athlete.date} · ${host.state().title||"测试记录"}`:"选择测试记录";
      $("reportRecordSummary").textContent=title;
      $("reportRecordOptions").innerHTML=dates.length?dates.map(date=>{
        const count=ids.filter(id=>offeredRecords(id).some(r=>r.athlete.date===date)).length;
        const checked=currentDates.includes(date);
        const duplicates=checked?ids.filter(id=>{const candidates=offeredRecords(id).filter(r=>r.athlete.date===date),chosen=selection.recordChoices[id]?.[date];return candidates.length>1||chosen&&!candidates.some(r=>r.recordId===chosen);}).map(id=>{
          const candidates=offeredRecords(id).filter(r=>r.athlete.date===date),selected=selection.recordChoices[id]?.[date]||(ids.length===1&&host.state()?.athlete.date===date?host.state().recordId:"");
          return `<label class="comparison-record-conflict">${escape(owner(id)?.name||"所选队员")} · ${candidates.some(r=>r.recordId===selected)?"当日 "+candidates.length+" 条":"核对采用的记录"}<select data-report-record-person="${escape(id)}" data-report-record-date="${date}" onchange="App.chooseComparisonRecord(this.dataset.reportRecordPerson,this.dataset.reportRecordDate,this.value)"><option value="">指定本次采用的记录</option>${candidates.map(r=>`<option value="${escape(r.recordId)}" ${r.recordId===selected?"selected":""}>${escape(r.title||"测试记录")}${r.archived?"（已归档）":""} · ${escape(r.recordId.slice(-6))}</option>`).join("")}</select></label>`;
        }).join(""):"";
        const archived=ids.some(id=>offeredRecords(id).some(r=>r.athlete.date===date&&(r.archived||owner(id)?.archived)));
        return `<div class="comparison-date-option"><label><input type="checkbox" data-report-date="${date}" ${checked?"checked":""} onchange="App.toggleComparisonDate(this.dataset.reportDate,this.checked)"><span>${date}</span><small>${count} / ${ids.length} 人有记录${archived?" · 含已归档资料":""}</small></label>${duplicates}</div>`;
      }).join(""):'<p class="note">所选队员暂无有日期的测试记录。</p>';
      $("recordSelect").classList.add("sr-only");$("recordSelect").setAttribute("aria-hidden","true");
      $("recordSelect").tabIndex=-1;
    }
    function athleteOptions(rows) {
      const ids=selectedIds();
      return `<div class="comparison-chooser-tools"><button type="button" class="btn small" onclick="App.selectAllReportAthletes()">全选当前结果</button><button type="button" class="btn small" onclick="App.clearReportSelection()">清空</button></div>`+rows.map((a,i)=>`<button type="button" id="reportAthleteOption-${i}" class="athlete-option" role="option" aria-selected="${ids.includes(a.id)}" data-athlete-choice="${escape(a.id)}" onclick="App.toggleReportAthlete(this.dataset.athleteChoice)"><span class="comparison-check">${ids.includes(a.id)?"✓":""}</span><span>${escape(host.athleteLabel(a))}</span></button>`).join("");
    }
    async function toggleAthlete(id) {
      const ids=selectedIds(),next=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];
      return select({...requestedSelection||selection,groupId:$("reportGroupFilter").value,athleteIds:next});
    }
    function toggleDate(date,checked) {
      const draft=requestedSelection||selection, ids=selectedIds(),dates=draft.dates.length?[...draft.dates]:host.state()?[host.state().athlete.date]:[];
      const chosen=checked?[...dates,date]:dates.filter(d=>d!==date);
      const recordChoices=copy(draft.recordChoices);
      if(ids.length===1&&host.state())(recordChoices[ids[0]]||={})[host.state().athlete.date]=host.state().recordId;
      return select({...draft,athleteIds:ids,dates:chosen,recordChoices});
    }
    async function chooseRecord(id,date,recordId) {const next=copy(selection);next.athleteIds=selectedIds();(next.recordChoices[id]||={})[date]=recordId;return select(next);}
    function render() {
      if(!api.active)return false;
      renderSelectors();const R=root.RingsideComparisonReport;
      $("reportView").classList.add("comparison-report-view");
      $("reportTitle").textContent=title();$("athleteMeta").innerHTML=[selection.dates.length===1?selection.dates[0]:`${selection.dates[0]} — ${selection.dates.at(-1)}`,`${selection.athleteIds.length} 名队员`,model?.entries?.length?`${model.entries.length} 条测试记录`:""].filter(Boolean).map(x=>`<span>${escape(x)}</span>`).join("");
      $("aggMode").closest("label").hidden=true;$("migrationReviewNotice").hidden=true;
      $("editButton").textContent="选择记录编辑";$("comparisonNarrativeButton").hidden=false;
      $("sampleLabel").classList.toggle("hidden",!model?.entries?.every(e=>e.record?.demo));
      $("recordContext").textContent=title();$("dataCount").textContent=`${selection.dates.length} 个测试日期`;
      if(!model||model.ready===false){$("microCards").innerHTML="";$("bodyChart").innerHTML="";$("radarChart").innerHTML="";$("screenItems").innerHTML="";$("directionMetrics").innerHTML="";$("detailContent").innerHTML=`<div class="card comparison-issues"><h3>核对本次采用的记录</h3>${(model?.issues||[]).map(issue=>`<p>${escape(typeof issue==="string"?issue:issue.message||issue.reason||JSON.stringify(issue))}</p>`).join("")}<p>请在上方测试记录选择区指定同日记录。</p></div>`;return true;}
      $("microCards").innerHTML=R.summary(model);$("bodyChart").innerHTML=R.body(model,{bodyImage:root.RingsideBodyImage,views:documentValue.views});
      $("screenItems").innerHTML=R.screenItems(model,{views:documentValue.views});$("radarChart").innerHTML=R.radar(model,documentValue.views);
      $("referenceLabel").textContent="个人系列 · 均值 ± SD";$("radarLegend").textContent="每个能力轴按有效队员计算";
      $("screenPill").className="pill gray";$("screenPill").textContent="队员分布";
      $("directionMetrics").innerHTML=R.overview(model);
      const callbacks={model,prefs:documentValue.views,onPreferences(next){if(api.computing||!documentValue)return;documentValue.views=copy(next);markDirty();host.render();},onEditRecord:editRecord,onBasis:changeBasis};
      $("detailContent").innerHTML=R.render(model,documentValue.views,{bodyImage:root.RingsideBodyImage});
      R.bind($("detailContent"),callbacks);R.bindOverview?.($("reportView"),callbacks);
      renderNarrative();return true;
    }
    function title() {const group=host.library()?.groups.find(g=>g.id===selection.groupId)?.name||"所选队员";return selection.athleteIds.length===1?`${owner(selection.athleteIds[0])?.name||"运动员"} · 纵向比较`:`${group} · ${selection.dates.length>1?"团队纵向比较":"团队报告"}`;}
    function renderNarrative() {
      if(!api.active||!documentValue)return;
      const n=documentValue.narrative||{},stale=!!n.text&&n.basis!==model?.fingerprint;
      $("interpState").textContent=stale?"数据已更新 · 待复核":n.text?(n.origin==="AI"?"AI稿":"已填写"):"尚未填写";
      $("interpState").className="pill no-print "+(stale?"amber":"gray");
      $("narrativeView").innerHTML=n.text?root.RingsideModel.sanitizeHTML(n.html||root.RingsideModel.textToHTML(n.text)):'<div class="empty">本次比较尚未填写解读与建议。</div>';
      $("comparisonEditorState").textContent=$("interpState").textContent;
      if(editing&&document.activeElement!==$("comparisonEditor"))$("comparisonEditor").value=n.text||"";
    }
    async function editRecord(recordId) {
      if(api.computing)return host.toast("比较报告正在计算，请完成后编辑记录");
      if(!await flush())return;
      const entry=model?.entries.find(e=>e.recordId===recordId);if(!entry)return;
      const a=owner(entry.athleteId),r=a?.records.find(r=>r.recordId===recordId);
      if(!a||a.deletedAt||!r||r.deletedAt)return host.toast("绑定的队员或记录已不存在，请核对本次比较选择");
      suspended=true;editing=false;switching=true;
      try{await host.switchRecord(a,r,{edit:true});}finally{switching=false;}remember();
    }
    async function resume() {if(!suspended)return false;suspended=false;host.setMode("report");await refresh();remember();return true;}
    function resetForSingle(a,r) {if(switching)return;sequence++;suspended=false;editing=false;model=null;documentValue=null;inputSnapshot=null;selection={groupId:$("reportGroupFilter")?.value||"",athleteIds:a?[a.id]:[],dates:r?.athlete.date?[r.athlete.date]:[],recordChoices:a&&r?{[a.id]:{[r.athlete.date]:r.recordId}}:{},basis:{}};remember();}
    async function changeBasis({key,value}) {if(api.computing)return host.toast("比较报告正在计算，请完成后切换判断依据");const token=++sequence;computationToken=token;selection.basis[key]=value;documentValue.selection=copy(selection);host.cancelJob();$("startupStatus").hidden=false;try{if(await recompute(token)){markDirty();host.render();}}catch(error){if(token===sequence&&error.name!=="AbortError"){model={...model,ready:false,issues:[error.message]};host.render();host.toast(error.message);}}finally{if(token===sequence){computationToken=null;$("startupStatus").hidden=true;}}}
    function setNarrative(text,origin="manual",html=null) {if(!documentValue)return;const old=copy(documentValue.narrative||{});if(old.text&&(origin!=="manual"||!editorRevisionSaved))(documentValue.revisions||=[]).push(old);if(origin==="manual")editorRevisionSaved=true;documentValue.narrative={text,html:html||root.RingsideModel.textToHTML(text),origin,updated:stamp(),revision:(old.revision||0)+1,basis:model.fingerprint};markDirty();renderNarrative();}
    function updateEditor() {if(editing&&$("comparisonEditor").value!==(documentValue.narrative?.text||""))setNarrative($("comparisonEditor").value);}
    function openNarrative() {if(api.computing)return host.toast("比较报告正在计算，请完成后编辑解读");if(!api.active||!model||model.ready===false)return;editing=true;editorRevisionSaved=false;$("comparisonEditor").value=documentValue.narrative?.text||"";$("comparisonAIStatusMount").append($("aiProgress"));host.modal("comparisonNarrativeModal");renderNarrative();host.renderAIStatus();}
    async function closeNarrative() {updateEditor();if(!await flush())return false;editing=false;$("reportView").before($("aiProgress"));host.close("comparisonNarrativeModal");host.renderAIStatus();return true;}
    function snapshot() {return {comparisonId:documentValue?.id,basis:model?.fingerprint,revision:documentValue?.narrative?.revision||0};}
    function matches(binding) {return !api.computing&&api.active&&binding?.comparisonId===documentValue?.id;}
    const scalars=value=>Object.fromEntries(Object.entries(value||{}).filter(([,item])=>item===null||["string","number","boolean"].includes(typeof item)));
    function compactResults() {
      return {
        metrics:model.metrics.map(metric=>({...scalars(metric),identity:copy(metric.identity),cohortIds:[...metric.cohortIds],
          observations:metric.observations.map(scalars),
          periods:metric.periods.map(period=>({...scalars(period),...(period.distribution?{distribution:copy(period.distribution)}:{})})),
          changes:metric.changes.map(scalars),trend:{...scalars(metric.trend),points:(metric.trend?.points||[]).map(scalars)}})),
        summary:{periods:model.summary.periods.map(period=>({...scalars(period),red:copy(period.red),amber:copy(period.amber),advantage:copy(period.advantage),
          regions:Object.fromEntries(Object.entries(period.regions||{}).map(([key,region])=>[key,{...scalars(region),members:region.members.map(scalars)}]))})),latest:scalars(model.summary.latest),transitions:model.summary.transitions.map(scalars)},
        capabilities:model.capabilities.map(capability=>({...scalars(capability),cohortIds:capability.cohortIds||[],periods:capability.periods.map(period=>({...scalars(period),groups:copy(period.groups||[]),members:(period.members||[]).map(scalars),parameters:(period.parameters||[]).map(scalars)})),transitions:(capability.transitions||[]).map(scalars)})),
      };
    }
    function envelope() {
      if(api.computing)throw Error("比较报告正在计算，请完成后导出");
      if(!api.active||model?.ready===false)throw Error("请先完成记录选择");
      const library=copy(inputSnapshot.library);library.comparisonReports=[copy(documentValue)];
      const selected=new Set(model.entries.map(e=>e.recordId));library.athletes.forEach(a=>a.records=a.records.filter(r=>selected.has(r.recordId)));
      const profileIds=new Set(library.athletes.flatMap(a=>a.records.map(r=>r.evaluationProfileId||library.defaultEvaluationProfileId)));
      if(!profileIds.size)profileIds.add(library.defaultEvaluationProfileId);
      library.evaluationProfiles=library.evaluationProfiles.filter(profile=>profileIds.has(profile.id));
      if(!profileIds.has(library.defaultEvaluationProfileId))library.defaultEvaluationProfileId=library.evaluationProfiles[0].id;
      const groupIds=new Set([selection.groupId,...library.athletes.map(a=>a.groupId)]);library.groups=library.groups.filter(group=>groupIds.has(group.id));
      library.activeAthleteId=model.entries[0]?.athleteId||"";library.activeRecordId=model.entries[0]?.recordId||"";
      return {kind:"comparison-report",schema:1,library,report:copy(documentValue),statistics:copy(model.statistics||{}),
        displayRules:{screening:{scale:"ordinal",maximum:3,statusLevels:{green:3,amber:2,red:1},unknown:null,
          date:model.dates.includes(documentValue.views.screeningDate)?documentValue.views.screeningDate:model.dates.at(-1)}},results:compactResults()};
    }
    function facts() {
      if(api.computing)throw Error("比较报告正在计算，请完成后生成解读");
      const frozen=compactResults();
      const athletes=selection.athleteIds, dates=selection.dates, reasons=[""], statuses=[""], titles=[], subjects=[];
      const intern=(dictionary,value)=>{value=value??"";let index=dictionary.indexOf(value);if(index<0){index=dictionary.length;dictionary.push(value);}return index;};
      const row=values=>{while(values.length&&values.at(-1)===null)values.pop();return values;};
      const summary={...frozen.summary,transitionColumns:["athleteIndex","fromDateIndex","toDateIndex","subjectIndex","titleIndex","fromStatusIndex","toStatusIndex","state","reasonIndex"],
        transitions:frozen.summary.transitions.map(t=>[athletes.indexOf(t.athleteId),dates.indexOf(t.fromDate),dates.indexOf(t.toDate),intern(subjects,t.key),intern(titles,t.title),intern(statuses,t.from),intern(statuses,t.to),t.state,intern(reasons,t.reason)])};
      const metrics=frozen.metrics.map((m,index)=>({key:"metric-"+index,label:m.label,unit:m.unit,direction:m.direction,identity:m.identity,cohortAthleteIndices:m.cohortIds.map(id=>athletes.indexOf(id)),
        observations:m.observations.map(o=>row([athletes.indexOf(o.athleteId),dates.indexOf(o.date),o.value,intern(reasons,o.reason),o.pain??null,o.status?intern(statuses,o.status):null,o.notes||null])),periods:m.periods,changes:m.changes,trend:m.trend}));
      return {factsVersion:1,reportType:model.kind,title:title(),dates,baseline:dates[0],statistics:model.statistics,
        indexing:{observationColumns:["athleteIndex","dateIndex","value","reasonIndex","pain","statusIndex","notes"],reasons,statuses,transitionSubjects:subjects,transitionTitles:titles,
          selectedRecordIds:athletes.map(id=>dates.map(date=>selection.recordChoices[id]?.[date]||null)),explanation:"数组按columns读取，Index从0开始，athleteIndex对应athletes，dateIndex对应dates，尾部省略项为null。reasonIndex/statusIndex/subjectIndex/titleIndex分别查对应字典。不要把数组索引当成测量值。"},
        summary,trainingDirections:frozen.capabilities,metrics,
        athletes:selection.athleteIds.map(id=>{const a=owner(id),entries=model.entries.filter(e=>e.athleteId===id),last=entries.at(-1);return {id,name:a.name,profile:a.profile,testContext:last?.record.athlete,trainingContext:last?.record.trainingContext,directions:entries.map(e=>({date:e.date,directions:e.directions}))};}),
        existingIndividualPlans:individualPlans(),
        interpretation:"采用已计算数值，按共同重点、方向分组、具体安排和复测条件组织；方向转变按原含义表述，统计显著性不等于训练价值。每个指标只用全程完整的固定队员，n是队员人数。"};
    }
    function individualPlans() {
      return model.entries.filter(entry=>entry.date===model.dates.at(-1)).map(entry=>{
        const plan=root.RingsideInterventions.build(entry.record,entry.stats);
        return {athleteId:entry.athleteId,name:owner(entry.athleteId)?.name,context:plan.context,items:plan.items.map(item=>({title:item.title,evidence:item.evidence,actions:item.actions,note:item.note,rank:item.rank})),execution:plan.execution};
      });
    }
    function localText() {
      const lines=["## 主要发现",`${title()}，测试日期：${selection.dates.join("、")}。`];
      for(const metric of model.metrics.filter(m=>m.periods?.some(p=>p.n)).slice(0,8)){const latest=metric.periods.at(-1),change=metric.changes?.at(-1);lines.push(`${metric.label}：${root.Calc.num(latest.mean)===null?"待测":latest.mean.toFixed(2)} ${metric.unit}，有效 ${latest.n} 人${change&&root.Calc.num(change.delta)!==null?`，较基线变化 ${change.delta.toFixed(2)} ${metric.unit}`:""}。`);}
      lines.push("## 共同重点与分组安排");
      for(const capability of model.capabilities||[]){const latest=capability.periods?.at(-1);for(const group of latest?.groups||latest?.categories||[]){const names=(group.athleteIds||group.members||[]).map(id=>typeof id==="string"?owner(id)?.name:id.name).filter(Boolean);lines.push(`${capability.title}：${group.label||group.judgment||group.direction}，${names.join("、")||group.count+" 人"}。`);}}
      const groups=new Map();
      for(const plan of individualPlans())for(const item of plan.items)for(const action of item.actions){
        const {id,sourceIds,...prescription}=action,key=JSON.stringify(prescription),group=groups.get(key)||{action:prescription,athletes:[],rank:item.rank};
        if(!group.athletes.includes(plan.name))group.athletes.push(plan.name);groups.set(key,group);
      }
      const prescriptions=[...groups.values()].sort((a,b)=>b.athletes.length-a.athletes.length||a.rank-b.rank);
      if(prescriptions.length)lines.push("## 具体执行安排");
      for(const {action:a,athletes} of prescriptions){lines.push(`${athletes.join("、")}：${a.exercise}${a.side?"（"+a.side+"）":""}，${a.load}，${a.sets}组×${a.repsMin}${a.repsMax!==a.repsMin?"–"+a.repsMax:""}次${a.holdSec?"，每次保持"+a.holdSec+"秒":""}，组间休息${a.restSec}秒，每周${a.weekly}次。${a.progression||""}`);}
      return lines.join("\n\n");
    }
    async function restore() {
      let saved=null;try{saved=JSON.parse(localStorage.getItem(uiKey)||"null");}catch{}
      const embeddedId=root.RingsideEmbeddedComparisonId;
      const doc=(host.library()?.comparisonReports||[]).find(d=>d.id===embeddedId);
      if(doc)return select(doc.selection,{restoreDocument:true,documentId:doc.id});
      if(saved?.active&&!saved.editingRecord)return select(saved.selection,{restoreDocument:true,documentId:saved.documentId});
      resetForSingle(owner(host.state()?.athleteId),host.state());return false;
    }
    function leaveNarrative(){updateEditor();editing=false;$("reportView").before($("aiProgress"));$("comparisonNarrativeModal").classList.remove("show");flush();}
    Object.assign(api,{select,refresh,flush,label,renderSelectors,athleteOptions,toggleAthlete,toggleDate,chooseRecord,render,renderNarrative,editRecord,resume,resetForSingle,changeBasis,setNarrative,updateEditor,openNarrative,closeNarrative,leaveNarrative,snapshot,matches,envelope,facts,localText,restore,title,
      clear:()=>select({groupId:$("reportGroupFilter").value,athleteIds:[],dates:[],recordChoices:{},basis:{}}),
      selectAll:rows=>select({...selection,groupId:$("reportGroupFilter").value,athleteIds:rows.map(a=>a.id)}),
      selectGroup:groupId=>select({...selection,groupId,athleteIds:selectedIds().filter(id=>!groupId||owner(id)?.groupId===groupId),dates:[],recordChoices:{}}),
      filename:ext=>`MotionBench_${title().replace(/[<>:"/\\|?*\s]/g,"_")}_${selection.dates[0]}_${selection.dates.at(-1)}.${ext}`,
    });return api;
  }
  root.RingsideComparisonController={create};
})(window);
