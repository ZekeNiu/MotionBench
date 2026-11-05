(function(root){
  "use strict";
  const copy=v=>JSON.parse(JSON.stringify(v)),E=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const stamp=()=>new Date().toISOString(),id=()=>"team-"+(root.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  const stable=d=>JSON.stringify({...d,revision:0,updated:""});
  function create(host){
    let document=null,suspended=false,loading=false,ticket=0,queue=Promise.resolve(),savedRevision=null,savedBody="",displayBarrier=null,displayPending=0,displayTicket=0,committedViews={};
    const active=()=>!!document&&!suspended,model=()=>document?.snapshot,owner=()=>active()?"team:"+document.id:"";
    const error=e=>host.error?.(e.message||String(e));
    function clear(){ticket++;displayTicket++;document=null;savedRevision=null;savedBody="";committedViews={};suspended=loading=false;}
    function touch(){document.updated=stamp();}
    function enqueue(operation){const task=queue.then(operation);queue=task.then(()=>{},()=>{});return task;}
    async function saveCurrent(current,guard){
      if(guard&&!guard())return false;if(!current||document!==current)return true;const snapshot=root.RingsideTeamStore.normalize(document),body=stable(snapshot);if(body===savedBody)return true;
      try{const result=await host.repository().saveTeamReport(snapshot,{expectedRevision:savedRevision});if(document===current){savedRevision=result.revision;document.revision=result.revision;savedBody=stable(result);committedViews=copy(result.views||{});}return true;}catch(e){error(e);return false;}
    }
    function save({guard}={}){const current=document;return current?enqueue(()=>saveCurrent(current,guard)):Promise.resolve(true);}
    function setNarrative(value,previous=false){if(!active())return false;if(previous)document.previousNarrative=copy(document.narrative);document.narrative=copy(value);touch();return true;}
    function setViews(value,replace=false){if(!active())return false;const next=replace?copy(value):{...document.views,...copy(value)};if(JSON.stringify(next)===JSON.stringify(document.views))return false;document.views=next;touch();return true;}
    async function updateViews(delta){
      if(!active()||loading)return false;host.captureView?.();const current=document,sequence=++displayTicket;
      if(!displayBarrier){let resolve;const promise=new Promise(done=>{resolve=done;});displayBarrier={promise,resolve};}displayPending++;
      try{setViews(delta);host.render();host.remember?.();const ok=await save();if(!ok&&document===current&&sequence===displayTicket){for(const key of Object.keys(delta)){if(Object.hasOwn(committedViews,key))document.views[key]=copy(committedViews[key]);else delete document.views[key];}touch();host.render();}return ok;}finally{displayPending--;if(!displayPending){const settled=displayBarrier;displayBarrier=null;settled.resolve();}}
    }
    function candidate(next){
      return root.RingsideTeamStore.normalize({...next,...(document?.id===next.id?{revision:document.revision,views:{...copy(next.views||{}),...compatibleViews(document)},narrative:copy(document.narrative),...(document.previousNarrative?{previousNarrative:copy(document.previousNarrative)}:{})}:{})});
    }
    async function undoCommit(commit){
      const repository=host.repository(),stored=await repository.getTeamReport(commit.result.id);
      // Only undo the revision written by this request. A later save belongs to
      // its own owner and must survive cancellation of this request.
      if(!stored||stored.revision!==commit.result.revision)return false;
      if(!commit.backup){await repository.deleteTeamReport(stored.id,{expectedRevision:stored.revision});return true;}
      const restore=document?.id===stored.id?copy(document):copy(commit.backup),saved=await repository.saveTeamReport(restore,{expectedRevision:stored.revision});
      if(document?.id===stored.id){document.revision=saved.revision;savedRevision=saved.revision;savedBody=stable(saved);committedViews=copy(saved.views||{});}
      return true;
    }
    async function undoCurrentCommit(commit){
      try{return await undoCommit(commit);}catch(e){const latest=await host.repository().getTeamReport(commit.result.id);if(latest?.revision===commit.result.revision)error(e);return false;}
    }
    function cancelCommit(commit){return enqueue(()=>undoCurrentCommit(commit));}
    async function stageCurrent(next,guard,priorCommit=null){
      if(guard&&!guard())return null;
      const prepared=candidate(next),same=document?.id===prepared.id,expectedRevision=same?savedRevision:priorCommit?.result.revision||prepared.revision||null;
      if(priorCommit&&expectedRevision===priorCommit.result.revision&&stable(prepared)===stable(priorCommit.result))return priorCommit;
      const backup=priorCommit?priorCommit.backup:expectedRevision===null?null:same?copy(document):await host.repository().getTeamReport(prepared.id);
      const result=await host.repository().saveTeamReport(prepared,{expectedRevision}),commit={result,backup};
      if(guard&&!guard()){await undoCurrentCommit(commit);return null;}
      // The editor continues to own its old snapshot until activation. Its
      // saves must nevertheless compare against the revision just committed.
      if(same){document.revision=result.revision;savedRevision=result.revision;}
      return commit;
    }
    function stage(next,guard,priorCommit=null){return enqueue(()=>stageCurrent(next,guard,priorCommit));}
    async function activate(next,{persist=false,flush=true,duringTransfer=false,guard}={}){
      const sequence=ticket,allowed=()=>sequence===ticket&&(!guard||guard());
      if(flush){if(host.saveEditor)host.saveEditor();if(!await host.save({duringTransfer}))return false;}
      if(!allowed())return false;
      const selected=next.configuration.participants.find(p=>p.recordId),lib=host.library(),athlete=selected&&lib.athletes.find(a=>a.id===selected.athleteId&&!a.deletedAt),indexed=athlete?.records.find(r=>r.recordId===selected.recordId&&!r.deletedAt),record=indexed&&(host.repository().loadRecord?await host.repository().loadRecord(selected.recordId):indexed),live=record&&!record.deletedAt;if(!allowed())return false;
      let commit=persist?await stage(next,allowed):null;if(persist&&!commit)return false;
      const rollback=async()=>{if(commit)await cancelCommit(commit);host.render();return false;};
      try{
      if(!allowed())return rollback();
      // switchRecord can save the editor more than once. Keep both the visible
      // editor and its owner on the prior report throughout those awaits.
      if(live&&host.switchRecord&&!await host.switchRecord(athlete,record,{team:true,duringTransfer}))return rollback();
      if(!allowed())return rollback();
      return await enqueue(async()=>{
        const rollbackCurrent=async()=>{if(commit)await undoCurrentCommit(commit);host.render();return false;};
        for(;;){
          if(!allowed())return rollbackCurrent();
          host.saveEditor?.();
          if((!persist||document?.id!==next.id)&&!await saveCurrent(document,allowed))return rollbackCurrent();
          if(!allowed())return rollbackCurrent();
          let adopted;
          if(persist){const updated=await stageCurrent(next,allowed,commit);if(!updated)return false;commit=updated;adopted=commit.result;}
          else{adopted=await host.repository().getTeamReport(next.id);if(!adopted)throw Error("此团队报告已不存在");}
          host.saveEditor?.();
          if(!allowed())return rollbackCurrent();
          const unsettled=persist&&document?.id===next.id?stable(candidate(commit.result))!==stable(commit.result):document&&stable(root.RingsideTeamStore.normalize(document))!==savedBody;
          if(unsettled)continue;
          // Commit and owner adoption share one queue operation. Old-owner saves
          // queued during the commit cannot write its snapshot after adoption.
          document=root.RingsideTeamStore.normalize(adopted);savedRevision=document.revision;savedBody=stable(document);committedViews=copy(document.views||{});suspended=false;
          host.cancelAI?.();host.activate?.({detached:!live});host.restoreView?.(document.views);host.render();host.remember?.();return true;
        }
      });
      }catch(e){await rollback();throw e;}
    }
    function progress(prepared){const node=root.document?.querySelector?.("[data-team-progress]");if(node){node.hidden=false;node.textContent=prepared===undefined?"正在读取测试记录…":`已处理 ${prepared} 条测试`;}}
    function compatibleViews(prior){
      if(!prior)return {};
      const views=copy(prior.views||{}),mappings=prior.sourceMappings||{};
      if(views.overviewAthleteIds)views.overviewAthleteIds=views.overviewAthleteIds.map(id=>mappings.athleteMap?.[id]||id);
      return views;
    }
    async function build(configuration,{prior=document,isCurrent=()=>true}={}){
      loading=true;const sequence=++ticket,current=()=>sequence===ticket&&isCurrent();progress();
      try{
        host.saveEditor?.();if(!await host.save()||!current())return false;
        const participants=configuration.participants||[],athleteIds=configuration.athleteIds||participants.map(p=>p.athleteId);
        const source=await host.repository().loadTeamSources({window:configuration.window||{},athleteIds,recordIds:participants.map(p=>p.recordId).filter(Boolean)});if(!current())return false;
        const lib=source.library,profileId=Object.hasOwn(configuration,"profileId")?configuration.profileId:lib.defaultEvaluationProfileId;
        const profile=profileId===""?null:lib.evaluationProfiles.find(p=>p.id===profileId);if(typeof profileId!=="string"||profileId&&!profile)throw Error("请选择可用的评价方案");
        const frozen=copy(configuration);frozen.profileId=profileId;frozen.profileSnapshot=copy(profile);
        const priorViews=compatibleViews(prior),modelOptions={...frozen,profile,catalog:lib.catalog,athletes:lib.athletes,groups:lib.groups,classifications:lib.classifications,views:priorViews};
        const snapshot=root.RingsideTeam.buildAsync?await root.RingsideTeam.buildAsync(source.records,modelOptions,{isCancelled:()=>!current(),onProgress:({prepared})=>{if(current())progress(prepared);}}):root.RingsideTeam.build(source.records,modelOptions);if(!snapshot||!current())return false;
        snapshot.sourceRevision=source.revision;snapshot.sourceGeneration=source.generation;snapshot.classifications=copy(lib.classifications||{});snapshot.groups=copy(lib.groups||[]);snapshot.libraryVersion=lib.version;
        const neededProfiles=new Set((snapshot.participants||snapshot.people||[]).map(p=>p.record?.evaluationProfileId).concat(profile?.id).filter(Boolean));
        snapshot.evaluationProfiles=lib.evaluationProfiles.filter(p=>neededProfiles.has(p.id)).map(p=>root.RingsideEvaluation.serializeProfile(p));
        const resolved={...frozen,...copy(snapshot.configuration||{}),profileId,profileSnapshot:copy(profile)};
        const now=stamp(),next=root.RingsideTeamStore.normalize({version:1,id:prior?.id||id(),title:configuration.title||prior?.title||"团队报告",configuration:resolved,snapshot,narrative:prior?.narrative||{text:"",html:"",revision:0,basis:"",origin:"manual"},...(prior?.previousNarrative?{previousNarrative:prior.previousNarrative}:{}),views:priorViews,basis:snapshot.fingerprint||snapshot.basis,created:prior?.created||now,updated:now,revision:prior?.revision||0});
        if(!current())return false;return await activate(next,{persist:true,flush:false,guard:current});
      }catch(e){error(e);return false;}finally{if(sequence===ticket)loading=false;}
    }
    async function restore(value,options={}){const reportId=typeof value==="string"?value:value?.id;if(!reportId)return false;const sequence=ticket,current=()=>sequence===ticket&&(!options.guard||options.guard()),next=await host.repository().getTeamReport(reportId);if(!current())return false;if(!next)throw Error("此团队报告已不存在");return activate(next,{...options,guard:current});}
    async function refresh(){if(!document)return false;return build(document.configuration,{prior:document});}
    async function changeMode(mode){if(!["best","mean"].includes(mode)||!document)return false;return build({...copy(document.configuration),mode},{prior:document});}
    function render(){
      if(!active())return false;
      const $=id=>root.document.getElementById(id),m=model(),out=root.RingsideTeamView.render(m,{views:document.views}),view=$("reportView");
      for(const key of ["horizontal","horizontalOwner","horizontalLayout","longitudinal","longitudinalOwner"])delete view.dataset[key];
      view.dataset.team="true";view.dataset.teamOwner=owner();view.dataset.reportKind="team";
      for(const [element,key]of[["microCards","summary"],["bodyChart","body"],["screenItems","screenItems"],["radarChart","overview"],["radarLegend","legend"],["detailContent","details"]])if($(element))$(element).innerHTML=out[key]||"";
      const people=m.participants||m.people||[],group=m.groups?.find(g=>g.id===document.configuration.groupId),groupName=group?.name||m.groupName||"团队";
      $("reportTitle").textContent=document.configuration.titleAuto?groupName+" · 团队报告":document.title||"团队报告";
      $("athleteMeta").innerHTML=[groupName,people.length+" 名运动员",m.profile?.name].filter(Boolean).map(value=>`<span>${E(value)}</span>`).join("");
      if($("horizontalReportControls")){$("horizontalReportControls").innerHTML="";$("horizontalReportControls").hidden=true;}
      for(const [element,value]of[["recordContext",people.length+" 名运动员 · 团队报告"],["screenPill",out.screenPill],["referenceLabel",out.referenceLabel],["dataCount","团队排名与全部指标"],["editButton","编辑团队配置"]])if($(element))$(element).textContent=value||"";
      if($("aggMode"))$("aggMode").value=m.mode||document.configuration.mode||"best";
      if($("screenPill"))$("screenPill").className="pill";
      if($("directionMetrics"))$("directionMetrics").hidden=true;
      if($("migrationReviewNotice"))$("migrationReviewNotice").hidden=true;
      const exportSummary=$("reportExportMenu")?.querySelector("summary");if(exportSummary)exportSummary.textContent="导出团队报告";
      view.__teamViews=copy(document.views);
      root.RingsideTeamView.bind?.(view,m,document.views,{updateViews});root.RingsideTeamView.layout?.(view,{print:false});
      view.querySelectorAll("details[id]").forEach(node=>{if(document.views.detailOpen?.[node.id]!==undefined)node.open=document.views.detailOpen[node.id];});
      const refreshButton=view.querySelector("[data-team-refresh]");if(refreshButton)refreshButton.onclick=async()=>{refreshButton.disabled=true;try{await refresh();}finally{if(refreshButton.isConnected)refreshButton.disabled=false;}};
      return true;
    }
    function payload(){
      if(!document)return null;
      const m=model(),people=m.participants||m.people||[],records=people.filter(p=>p.record).map(p=>copy(p.record));
      const owners=people.map(p=>({id:p.athleteId,name:p.name||p.athlete?.name||p.label||p.athleteId,profile:copy(p.athlete||{name:p.name||p.athleteId}),groupId:p.groupId||"",archived:false,deletedAt:null,records:records.filter(r=>r.athleteId===p.athleteId)}));
      const profiles=[...new Map([...(m.evaluationProfiles||[]),...(m.profile?[m.profile]:[])].map(p=>[p.id,root.RingsideEvaluation.serializeProfile(p)])).values()];
      const exported=copy(document);
      if(exported.sourceMappings){exported.configuration.participants=people.map(p=>({athleteId:p.athleteId,recordId:p.recordId||""}));if(exported.configuration.athleteIds)exported.configuration.athleteIds=people.map(p=>p.athleteId);exported.configuration.groupId=m.configuration?.groupId||"";exported.configuration.profileId=m.profile?.id||"";exported.configuration.profileSnapshot=copy(m.profile||null);}
      delete exported.sourceMappings;
      const groupIds=new Set([...owners.map(a=>a.groupId),exported.configuration.groupId].filter(Boolean));
      return {schema:1,kind:"team-report",document:exported,library:{schema:3,kind:"athlete-library",version:m.libraryVersion||root.RingsideBuild?.version,catalog:copy(m.catalog),classifications:copy(m.classifications||{}),testPlans:[],groups:copy((m.groups||[]).filter(g=>groupIds.has(g.id))),evaluationProfiles:profiles,defaultEvaluationProfileId:m.profile?.id||profiles[0]?.id||"",athletes:owners,activeAthleteId:owners[0]?.id||"",activeRecordId:records.find(r=>r.athleteId===owners[0]?.id)?.recordId||"",updated:stamp()}};
    }
    async function importPayload(value){const sequence=ticket;let incoming=root.RingsideTeamStore.normalize(value.document),prior=await host.repository().getTeamReport(incoming.id);if(sequence!==ticket)return false;if(prior)incoming={...incoming,id:id(),revision:0};const saved=await host.repository().saveTeamReport(incoming,{expectedRevision:null});return activate(saved,{guard:()=>sequence===ticket});}
    async function deleteReport(reportId){if(loading)return false;try{if(displayBarrier)await displayBarrier.promise;await queue;if(document?.id===reportId){host.saveEditor?.();if(!await save())return false;}const stored=await host.repository().getTeamReport(reportId);if(!stored)return false;if(!host.confirmDeleteReport)throw Error("报告删除确认暂不可用");if(!await host.confirmDeleteReport({id:stored.id,title:stored.title,revision:stored.revision}))return false;await host.repository().deleteTeamReport(reportId,{expectedRevision:stored.revision});if(document?.id===reportId){clear();host.render();host.remember?.();}return true;}catch(e){error(e);return false;}}
    function listReports(){return host.listReports?.();}
    function openSetup(initial=undefined){const config=initial?.configuration||initial||(initial===null?null:document?.configuration);return host.editSelection?.(config);}    return {active,model,document:()=>document,narrative:()=>document?.narrative,setNarrative,setViews,updateViews,payload,facts:()=>root.RingsideTeam.facts(model(),document?.views||{}),owner,basis:()=>document?.basis||"",save,clear,suspend:()=>{suspended=true;},resume:async()=>{if(document){suspended=false;host.render();}return !!document;},restore,openSetup,listReports,deleteReport,refresh,render,edit:()=>openSetup(),selection:()=>document?{id:document.id}:null,cancelPending:()=>{ticket++;loading=false;},changeMode,isLoading:()=>loading||!!displayBarrier,pendingDisplaySave:()=>displayBarrier?.promise||null,importPayload,configure:build,createReport:configuration=>build(configuration,{prior:null})};
  }
  root.RingsideTeamController={create};
})(typeof window!=="undefined"?window:globalThis);

