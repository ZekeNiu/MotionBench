(function(root){
  "use strict";
  const copy=v=>JSON.parse(JSON.stringify(v)),E=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const stamp=()=>new Date().toISOString(),id=()=>"horizontal-"+(root.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  const stable=d=>JSON.stringify({...d,revision:0,updated:""});
  function create(host){
    let document=null,suspended=false,loading=false,ticket=0,queue=Promise.resolve(),savedRevision=null,savedBody="",displayBarrier=null,displayPending=0,displayTicket=0,committedViews={};
    const active=()=>!!document&&!suspended,model=()=>document?.snapshot,owner=()=>active()?"horizontal:"+document.id:"";
    const error=e=>host.error?.(e.message||String(e));
    function clear(){ticket++;displayTicket++;document=null;savedRevision=null;savedBody="";committedViews={};suspended=loading=false;}
    function touch(){document.updated=stamp();}
    async function save({guard}={}){
      const current=document;if(!current)return true;
      const operation=async()=>{if(guard&&!guard())return false;if(document!==current)return true;const snapshot=root.RingsideHorizontalStore.normalize(document),body=stable(snapshot);if(body===savedBody)return true;
        try{const result=await host.repository().saveHorizontalReport(snapshot,{expectedRevision:savedRevision});if(document===current){savedRevision=result.revision;document.revision=result.revision;savedBody=stable(result);committedViews=copy(result.views||{});}return true;}catch(e){error(e);return false;}};
      const task=queue.then(operation);queue=task.then(()=>{},()=>{});return task;
    }
    function setNarrative(value,previous=false){if(!active())return false;if(previous)document.previousNarrative=copy(document.narrative);document.narrative=copy(value);touch();return true;}
    function setViews(value,replace=false){if(!active())return false;const next=replace?copy(value):{...document.views,...copy(value)};if(JSON.stringify(next)===JSON.stringify(document.views))return false;document.views=next;touch();return true;}
    async function updateViews(delta){
      if(!active()||loading)return false;host.captureView?.();const current=document,sequence=++displayTicket;
      if(!displayBarrier){let resolve;const promise=new Promise(done=>{resolve=done;});displayBarrier={promise,resolve};}displayPending++;
      try{setViews(delta);host.render();host.remember?.();const ok=await save();if(!ok&&document===current&&sequence===displayTicket){for(const key of Object.keys(delta)){if(Object.hasOwn(committedViews,key))document.views[key]=copy(committedViews[key]);else delete document.views[key];}touch();host.render();}return ok;}finally{displayPending--;if(!displayPending){const settled=displayBarrier;displayBarrier=null;settled.resolve();}}
    }
    function candidate(next){
      return root.RingsideHorizontalStore.normalize({...next,...(document?.id===next.id?{revision:document.revision,views:{...copy(next.views||{}),...compatibleViews(document)},narrative:copy(document.narrative),...(document.previousNarrative?{previousNarrative:copy(document.previousNarrative)}:{})}:{})});
    }
    async function undoCommit(commit){
      const repository=host.repository(),stored=await repository.getHorizontalReport(commit.result.id);
      // Only undo the revision written by this request. A later save belongs to
      // its own owner and must survive cancellation of this request.
      if(!stored||stored.revision!==commit.result.revision)return false;
      if(!commit.backup){await repository.deleteHorizontalReport(stored.id,{expectedRevision:stored.revision});return true;}
      const restore=document?.id===stored.id?copy(document):copy(commit.backup),saved=await repository.saveHorizontalReport(restore,{expectedRevision:stored.revision});
      if(document?.id===stored.id){document.revision=saved.revision;savedRevision=saved.revision;savedBody=stable(saved);committedViews=copy(saved.views||{});}
      return true;
    }
    async function cancelCommit(commit){
      const operation=async()=>{try{return await undoCommit(commit);}catch(e){const latest=await host.repository().getHorizontalReport(commit.result.id);if(latest?.revision===commit.result.revision)error(e);return false;}};
      const task=queue.then(operation);queue=task.then(()=>{},()=>{});return task;
    }
    async function stage(next,guard,priorCommit=null){
      const operation=async()=>{
        if(guard&&!guard())return null;
        const prepared=candidate(next),same=document?.id===prepared.id,expectedRevision=same?savedRevision:priorCommit?.result.revision||prepared.revision||null;
        if(priorCommit&&expectedRevision===priorCommit.result.revision&&stable(prepared)===stable(priorCommit.result))return priorCommit;
        const backup=priorCommit?priorCommit.backup:expectedRevision===null?null:same?copy(document):await host.repository().getHorizontalReport(prepared.id);
        const result=await host.repository().saveHorizontalReport(prepared,{expectedRevision}),commit={result,backup};
        if(guard&&!guard()){try{await undoCommit(commit);}catch(e){const latest=await host.repository().getHorizontalReport(result.id);if(latest?.revision===result.revision)error(e);}return null;}
        // The editor continues to own its old snapshot until activation. Its
        // saves must nevertheless compare against the revision just committed.
        if(same){document.revision=result.revision;savedRevision=result.revision;}
        return commit;
      };
      const task=queue.then(operation);queue=task.then(()=>{},()=>{});return task;
    }
    async function activate(next,{persist=false,flush=true,duringTransfer=false,guard}={}){
      if(flush){if(host.saveEditor)host.saveEditor();if(!await host.save({duringTransfer}))return false;}
      if(guard&&!guard())return false;
      const selected=next.configuration.participants.find(p=>p.athleteId===next.configuration.focusAthleteId)||next.configuration.participants[0],lib=host.library(),athlete=selected&&lib.athletes.find(a=>a.id===selected.athleteId&&!a.deletedAt),indexed=athlete?.records.find(r=>r.recordId===selected.recordId&&!r.deletedAt),record=indexed&&(host.repository().loadRecord?await host.repository().loadRecord(selected.recordId):indexed),live=record&&!record.deletedAt;if(guard&&!guard())return false;
      let commit=persist?await stage(next,guard):null;if(persist&&!commit)return false;
      const rollback=async()=>{if(commit)await cancelCommit(commit);host.render();return false;};
      try{
      if(guard&&!guard())return rollback();
      // switchRecord can save the editor more than once. Keep both the visible
      // editor and its owner on the prior report throughout those awaits.
      if(live&&host.switchRecord&&!await host.switchRecord(athlete,record,{horizontal:true,duringTransfer}))return rollback();
      if(guard&&!guard())return rollback();
      if(persist){
        for(;;){
          host.saveEditor?.();
          if(document?.id!==next.id&&!await save())return rollback();
          if(guard&&!guard())return rollback();
          const updated=await stage(next,guard,commit);if(!updated)return false;commit=updated;
          host.saveEditor?.();
          if(guard&&!guard())return rollback();
          const unsettled=document?.id===next.id?stable(candidate(commit.result))!==stable(commit.result):document&&stable(root.RingsideHorizontalStore.normalize(document))!==savedBody;
          if(!unsettled)break;
        }
      }
      }catch(e){await rollback();throw e;}
      document=root.RingsideHorizontalStore.normalize(commit?.result||next);savedRevision=document.revision;savedBody=stable(document);committedViews=copy(document.views||{});suspended=false;
      host.cancelAI?.();host.activate?.({detached:!live});host.restoreView?.(document.views);host.render();host.remember?.();return true;
    }
    function progress(prepared){const node=root.document?.getElementById?.("horizontalDialog")?.querySelector("[data-horizontal-progress]")||root.document?.querySelector?.("[data-horizontal-progress]");if(node){node.hidden=false;node.textContent=prepared===undefined?"正在读取测试记录…":`已处理 ${prepared} 条测试`;}}
    function compatibleViews(prior){
      if(!prior)return {};
      const views=copy(prior.views||{}),presentation=root.RingsideHorizontal.present?.(prior.snapshot,views)?.presentation;
      if(presentation){views.focus??=presentation.focus;views.baseline??=presentation.baseline;views.activeReferenceId??=presentation.activeReferenceId;}
      const mappings=prior.sourceMappings||{},athlete=id=>mappings.athleteMap?.[id]||id,record=id=>mappings.recordMap?.[id]||id;
      for(const field of ["focus","baseline"])if(views[field]?.kind==="athlete")views[field].id=athlete(views[field].id);
      if(views.hiddenParticipantIds)views.hiddenParticipantIds=views.hiddenParticipantIds.map(athlete);
      for(const chart of Object.values(views.charts||{}))if(chart.recordIds)chart.recordIds=chart.recordIds.map(record);
      return views;
    }
    async function build(configuration,{prior=document,isCurrent=()=>true}={}){
      loading=true;const sequence=++ticket,current=()=>sequence===ticket&&isCurrent();progress();
      try{
        host.saveEditor?.();if(!await host.save()||!current())return false;
        const windows=(configuration.references||[]).map(ref=>ref.window||configuration.window||{kind:"all"}),bounded=windows.length&&windows.every(w=>w.kind!=="all"&&w.from&&w.to),window=bounded?{from:windows.map(w=>w.from).sort()[0],to:windows.map(w=>w.to).sort().at(-1)}:{};
        const source=await host.repository().loadHorizontalSources({window,recordIds:configuration.participants.map(p=>p.recordId)});if(!current())return false;
        const lib=source.library,profile=lib.evaluationProfiles.find(p=>p.id===configuration.profileId)||configuration.profileSnapshot;if(!profile)throw Error("请选择可用的评价方案");
        const frozen=copy(configuration);frozen.profileSnapshot=copy(profile);
        frozen.references=root.RingsideHorizontalSetup.resolveReferences(frozen.references||[],{perspective:frozen.perspective,focus:frozen.participants.find(p=>p.athleteId===frozen.focusAthleteId)||frozen.participants[0],athletes:lib.athletes,classifications:root.RingsideClassifications.normalize(lib.classifications||{}),groups:lib.groups});
        frozen.window=root.RingsideHorizontal.normalizeWindow(frozen.window||{kind:"all"});frozen.references.forEach(reference=>{reference.window=root.RingsideHorizontal.normalizeWindow(reference.window||frozen.window);});
        const priorViews=compatibleViews(prior),modelOptions={...frozen,profile,catalog:lib.catalog,athletes:lib.athletes,groups:lib.groups,classifications:lib.classifications,views:priorViews},snapshot=root.RingsideHorizontal.buildAsync?await root.RingsideHorizontal.buildAsync(source.records,modelOptions,{isCancelled:()=>!current(),onProgress:({prepared})=>{if(current())progress(prepared);}}):root.RingsideHorizontal.build(source.records,modelOptions);if(!snapshot||!current())return false;
        if(snapshot.evaluationConflicts?.length){host.evaluationConflicts?.(snapshot.evaluationConflicts);if(!host.evaluationConflicts)error(Error("群体存在不同评价标准，请先指定统一标准"));return false;}
        snapshot.sourceRevision=source.revision;snapshot.sourceGeneration=source.generation;snapshot.classifications=copy(lib.classifications||{});snapshot.groups=copy(lib.groups||[]);snapshot.libraryVersion=lib.version;
        snapshot.participants.forEach(p=>{p.groupId=lib.athletes.find(a=>a.id===p.athleteId)?.groupId||"";});
        const neededProfiles=new Set(snapshot.participants.map(p=>p.record.evaluationProfileId).concat(profile.id));snapshot.evaluationProfiles=lib.evaluationProfiles.filter(p=>neededProfiles.has(p.id)).map(p=>root.RingsideEvaluation.serializeProfile(p));
        const now=stamp(),next=root.RingsideHorizontalStore.normalize({version:1,id:prior?.id||id(),title:configuration.title||prior?.title||"横向比较报告",configuration:frozen,snapshot,narrative:prior?.narrative||{text:"",html:"",revision:0,basis:"",origin:"manual"},...(prior?.previousNarrative?{previousNarrative:prior.previousNarrative}:{}),views:priorViews,basis:snapshot.fingerprint||snapshot.basis,created:prior?.created||now,updated:now,revision:prior?.revision||0});
        if(!current())return false;return await activate(next,{persist:true,flush:false,guard:current});
      }catch(e){error(e);return false;}finally{if(sequence===ticket)loading=false;}
    }
    async function restore(value,options={}){const reportId=typeof value==="string"?value:value?.id;if(!reportId)return false;const next=await host.repository().getHorizontalReport(reportId);if(!next)throw Error("此横向报告已不存在");return activate(next,options);}
    async function refresh(){if(!document)return false;return build(document.configuration,{prior:document});}
    async function changeMode(mode){if(!["best","mean"].includes(mode)||!document)return false;return build({...copy(document.configuration),mode},{prior:document});}
    function render(){
      if(!active())return false;const $=id=>root.document.getElementById(id),m=model(),out=root.RingsideHorizontalView.render(m,{views:document.views}),view=$("reportView");view.dataset.horizontal="true";view.dataset.horizontalLayout=out.layout;view.dataset.horizontalOwner=owner();view.dataset.reportKind="horizontal";delete view.dataset.longitudinal;delete view.dataset.longitudinalOwner;
      for(const [element,key]of[["microCards","summary"],["bodyChart","body"],["screenItems","screenItems"],["radarChart","overview"],["radarLegend","legend"],["detailContent","details"]])if($(element))$(element).innerHTML=out[key]||"";
      const shown=root.RingsideHorizontal.present?.(m,document.views)||m,focus=shown.presentation?.focus,focusPerson=focus?.kind==="athlete"?m.participants.find(p=>p.athleteId===focus.id):null,group=m.references.find(r=>r.id===shown.presentation?.activeReferenceId)||m.references[0],groupOnly=!m.participants.length;
      $("reportTitle").textContent=document.configuration.titleAuto?(focusPerson?(focusPerson.athlete?.name||focusPerson.name)+" · 横向比较报告":groupOnly?(group?.spec?.label||group?.label||"群体")+" · 群体报告":"运动表现与损伤风险横向比较"):document.title||"运动表现与损伤风险横向比较";
      $("athleteMeta").innerHTML=[groupOnly?(group?.spec?.label||group?.label||"群体报告"):m.participants.length+" 名运动员",m.profile?.name].filter(Boolean).map(v=>`<span>${E(v)}</span>`).join("");
      if($("horizontalReportControls")){ $("horizontalReportControls").innerHTML=out.controls||"";$("horizontalReportControls").hidden=!out.controls; }
      for(const [element,value]of[["recordContext",m.participants.length+" 名运动员 · 横向比较"],["screenPill",out.screenPill],["referenceLabel",out.referenceLabel],["dataCount",groupOnly?"群体结果与实际取样来源":m.references.length?"个人代表成绩与已保存群体参照":m.perspective==="focus"?"个人代表成绩 · 差值相对比较主角":"个人代表成绩并列对照"],["editButton","编辑比较配置"]])if($(element))$(element).textContent=value;
      if(groupOnly&&$("recordContext"))$("recordContext").textContent=(group?.spec?.label||group?.label||"群体")+" · 群体报告";
      if($("aggMode"))$("aggMode").value=m.mode;if($("screenPill"))$("screenPill").className="pill";if($("directionMetrics"))$("directionMetrics").hidden=true;if($("migrationReviewNotice"))$("migrationReviewNotice").hidden=true;
      $("reportExportMenu")?.querySelector("summary")&&( $("reportExportMenu").querySelector("summary").textContent=groupOnly?"导出群体报告":"导出横向报告");
      view.__horizontalViews=copy(document.views);root.RingsideHorizontalView.mount(view,m,{onChange:updateViews});const refreshButton=view.querySelector("[data-horizontal-refresh]");if(refreshButton)refreshButton.onclick=async()=>{refreshButton.disabled=true;refreshButton.textContent="正在更新…";try{await refresh();}finally{if(refreshButton.isConnected){refreshButton.disabled=false;refreshButton.textContent="更新参照数据";}}};view.querySelectorAll("details[id]").forEach(node=>{if(document.views.detailOpen?.[node.id]!==undefined)node.open=document.views.detailOpen[node.id];});return true;
    }
    function payload(){
      if(!document)return null;const m=model(),records=m.participants.map(p=>copy(p.record)),owners=m.participants.map(p=>({id:p.athleteId,name:p.athlete.name,profile:copy(p.athlete),groupId:p.groupId||"",archived:false,deletedAt:null,records:records.filter(r=>r.athleteId===p.athleteId)})),profiles=[...new Map([...(m.evaluationProfiles||[]),...(m.profile?[m.profile]:[])].map(p=>[p.id,root.RingsideEvaluation.serializeProfile(p)])).values()];
      const exported=copy(document);if(exported.sourceMappings){exported.configuration.participants=m.participants.map(p=>({athleteId:p.athleteId,recordId:p.recordId}));exported.configuration.focusAthleteId=m.focusAthleteId;exported.configuration.references=m.references.map(r=>copy(r.spec));exported.configuration.profileId=m.profile?.id||"";exported.configuration.profileSnapshot=copy(m.profile);}delete exported.sourceMappings;
      const groupIds=new Set([...owners.map(a=>a.groupId),...m.references.map(r=>r.spec.teamId)].filter(Boolean));
      return {schema:1,kind:"horizontal-report",document:exported,library:{schema:3,kind:"athlete-library",version:m.libraryVersion||"2.25.0",catalog:copy(m.catalog),classifications:copy(m.classifications||{}),testPlans:[],groups:copy((m.groups||[]).filter(g=>groupIds.has(g.id))),evaluationProfiles:profiles,defaultEvaluationProfileId:m.profile?.id||profiles[0]?.id||"",athletes:owners,activeAthleteId:owners[0]?.id||"",activeRecordId:records[0]?.recordId||"",updated:stamp()}};
    }
    async function importPayload(value){let incoming=root.RingsideHorizontalStore.normalize(value.document),prior=await host.repository().getHorizontalReport(incoming.id);if(prior)incoming={...incoming,id:id(),revision:0};const saved=await host.repository().saveHorizontalReport(incoming,{expectedRevision:null});return activate(saved);}
    async function deleteReport(reportId){if(loading)return false;try{if(displayBarrier)await displayBarrier.promise;await queue;if(document?.id===reportId){host.saveEditor?.();if(!await save())return false;}const stored=await host.repository().getHorizontalReport(reportId);if(!stored)return false;if(!host.confirmDeleteReport)throw Error("报告删除确认暂不可用");if(!await host.confirmDeleteReport({id:stored.id,title:stored.title,revision:stored.revision}))return false;await host.repository().deleteHorizontalReport(reportId,{expectedRevision:stored.revision});if(document?.id===reportId){clear();host.render();host.remember?.();}return true;}catch(e){error(e);return false;}}
    function listReports(){return host.listReports?.();}
    function openSetup(initial=undefined){const config=initial?.configuration||initial||(initial===null?null:document?.configuration);return host.editSelection?.(config);}    return {active,model,document:()=>document,narrative:()=>document?.narrative,setNarrative,setViews,updateViews,payload,facts:()=>root.RingsideHorizontal.facts(model(),document?.views||{}),owner,basis:()=>document?(document.basis+":"+root.RingsideComparison.contentHash(JSON.stringify({focus:document.views.focus,baseline:document.views.baseline,activeReferenceId:document.views.activeReferenceId}))):"",save,clear,suspend:()=>{suspended=true;},resume:async()=>{if(document){suspended=false;host.render();}return !!document;},restore,openSetup,listReports,deleteReport,refresh,render,edit:()=>openSetup(),selection:()=>document?{id:document.id}:null,cancelPending:()=>{ticket++;loading=false;},changeMode,isLoading:()=>loading||!!displayBarrier,pendingDisplaySave:()=>displayBarrier?.promise||null,importPayload,configure:build,createReport:configuration=>build(configuration,{prior:null})};
  }
  root.RingsideHorizontalController={create};
})(typeof window!=="undefined"?window:globalThis);
