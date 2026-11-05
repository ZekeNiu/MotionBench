(function(root){
  "use strict";
  const copy=value=>JSON.parse(JSON.stringify(value)), E=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid=()=>"reference-"+(root.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  const opt=(value,label,current)=>`<option value="${E(value)}"${value===current?" selected":""}>${E(label)}</option>`;
  const dates=[["","请选择日期范围"],["recent7","过去七天"],["recent14","过去十四天"],["recent30","过去三十天"],["recent90","过去九十天"],["recent12","过去一年"],["custom","自定日期"],["all","全部历史"]];
  const analysisModes=[["single","单次报告"],["horizontal","横向比较"],["longitudinal","纵向比较"]];
  const validAnalysisMode=value=>analysisModes.some(([key])=>key===value);
  const inferAnalysisMode=draft=>draft.references?.length||draft.athletes?.length>1?"horizontal":draft.athletes?.[0]?.recordIds?.length>1?"longitudinal":"single";
  function state(initial={}) {
    let draft={athletes:[],references:[],mode:"best",profileId:"",...copy(initial)},history={};
    const explicit=()=>validAnalysisMode(draft.analysisMode),analysisMode=()=>explicit()?draft.analysisMode:inferAnalysisMode(draft),multiple=()=>analysisMode()==="horizontal";
    function remember(){if(!explicit()&&!multiple())for(const person of draft.athletes)if(person.recordIds.length>1)history[person.athleteId]=[...person.recordIds];}
    function restore(){if(!explicit()&&!multiple()&&draft.athletes.length===1){const person=draft.athletes[0];if(history[person.athleteId])person.recordIds=[...history[person.athleteId]];}}
    return {
      get:()=>copy(draft), multiple,
      analysisMode(value){if(value===undefined)return analysisMode();if(!validAnalysisMode(value))return false;draft.analysisMode=value;history={};return true;},
      replace(value){draft={athletes:[],references:[],mode:"best",profileId:"",...copy(value)};history={};},
      athlete(id,selected){remember();if(selected&&!draft.athletes.some(p=>p.athleteId===id))draft.athletes.push({athleteId:id,recordIds:[]});if(!selected){draft.athletes=draft.athletes.filter(p=>p.athleteId!==id);restore();}},
      record(athleteId,recordId,selected){const person=draft.athletes.find(p=>p.athleteId===athleteId);if(!person)return;const chooseOne=explicit()?analysisMode()!=="longitudinal"&&person.recordIds.length<=1:multiple();if(chooseOne)person.recordIds=selected?[recordId]:[];else person.recordIds=selected?[...new Set([...person.recordIds,recordId])]:person.recordIds.filter(id=>id!==recordId);},
      reference(value){remember();draft.references.push(copy(value));},
      removeReference(id){draft.references=draft.references.filter(ref=>ref.id!==id);restore();},
      update(fn){fn(draft);},
      status(){
        if(explicit()){
          const mode=analysisMode();
          if(mode!=="horizontal"&&draft.references.length)return "references-not-supported";
          if(!draft.athletes.length&&!draft.references.length)return "empty";
          if(mode!=="horizontal"&&draft.athletes.length!==1)return "choose-athlete";
          if(mode==="horizontal"&&!draft.references.length&&draft.athletes.length<2)return "missing-comparison";
          if(draft.athletes.some(p=>!p.recordIds.length))return "missing-record";
          if(mode==="longitudinal"&&draft.athletes[0].recordIds.length<2)return "choose-many";
          if(mode!=="longitudinal"&&draft.athletes.some(p=>p.recordIds.length!==1))return "choose-one";
          return "ready";
        }
        if(!draft.athletes.length&&!draft.references.length)return "empty";if(draft.athletes.some(p=>!p.recordIds.length))return "missing-record";if(multiple()&&draft.athletes.some(p=>p.recordIds.length!==1))return "choose-one";return "ready";
      }
    };
  }
  function create(host){
    const selection=state(),field=(label,input)=>`<label class="field"><span>${E(label)}</span>${input}</label>`;
    let initialized=false,dirty=false,applying=0,applyingSequence=0,sequence=0,query="",group="",error="",conflicts=[],panel="",settingsOpen=false,sourceIdentity="",editingReportId=null,baseline=null,sessionActive=false;
    let referenceDraft=null,referenceError="",referenceReturnId="";
    const library=()=>host.library(),identity=()=>host.identity?.()||"",dialog=()=>root.document.getElementById("reportReferenceDialog");
    const athleteName=id=>{const a=library().athletes.find(a=>a.id===id);return a?.name||a?.profile?.name||"运动员不可用";};
    function fromConfiguration(config){
      const athletes=config.athletes?copy(config.athletes):config.participants?(config.participants||[]).map(p=>({athleteId:p.athleteId,recordIds:p.recordIds?[...p.recordIds]:p.recordId?[p.recordId]:[]})):config.athleteId?[{athleteId:config.athleteId,recordIds:[...(config.recordIds||[])]}]:[];
      const value={...copy(config),athletes,references:(config.references||[]).map(r=>({...copy(r),explicitConditions:true,window:copy(r.window||config.window||{kind:"",from:"",to:""})}))};
      value.analysisMode=validAnalysisMode(value.analysisMode)?value.analysisMode:config.participants?"horizontal":inferAnalysisMode(value);return value;
    }
    function fromCurrent(){
      const config=host.configuration?.(),single=host.current?.(),long=host.longitudinal?.();
      const profileId=long&&Object.hasOwn(long,"profileId")?long.profileId:long&&Object.hasOwn(long,"evaluationProfileId")?long.evaluationProfileId:single&&Object.hasOwn(single,"evaluationProfileId")?single.evaluationProfileId:library()?.defaultEvaluationProfileId||"";
      return config?fromConfiguration(config):fromConfiguration({athletes:long?[{athleteId:long.athleteId,recordIds:[...long.recordIds]}]:single?[{athleteId:single.athleteId,recordIds:[single.recordId]}]:[],references:[],mode:long?.mode||single?.mode||"best",profileId});
    }
    function sync(force=false){
      if(!library())return;
      if(sessionActive)return;
      if(force||!initialized||!dirty&&!applying&&!referenceDraft&&sourceIdentity!==identity()){
        selection.replace(fromCurrent());baseline=selection.get();sourceIdentity=identity();editingReportId=host.configuration?.()?host.reportId?.():null;initialized=true;
      }
    }
    function changed({preserveConflicts=false}={}){dirty=true;error="";if(!preserveConflicts)conflicts=[];sequence++;host.cancelPending?.();render();}
    function closePanel(restoreFocus=false){const previous=panel;panel="";render();if(restoreFocus&&previous)host.element?.()?.querySelector(`[data-selection-toggle="${previous}"]`)?.focus({preventScroll:true});}
    async function apply(){
      const status=selection.status();
      if(applying&&applyingSequence===sequence||referenceDraft||status!=="ready"){render();return false;}
      const ticket=++sequence,value=selection.get();applying++;applyingSequence=ticket;error="";render();
      try{
        for(const ref of value.references){if(!ref.window?.kind)throw Error("请为群体选择日期范围");ref.window=root.RingsideHorizontalSetup.dateWindow(ref.window.kind,ref.window.from,ref.window.to,ref.window.to||undefined);}
        value.references=root.RingsideHorizontalSetup.resolveReferences(value.references,{athletes:library().athletes,classifications:root.RingsideClassifications.normalize(library().classifications||{}),groups:library().groups||[]});
        const options={isCurrent:()=>ticket===sequence,reportId:editingReportId,analysisMode:value.analysisMode};
        const ok=await host.select(value,options);
        if(ticket!==sequence)return false;
        if(ok){dirty=false;error="";conflicts=[];panel="";sourceIdentity=identity();editingReportId=host.reportId?.()||null;selection.update(d=>{d.references=copy(value.references);});await host.onApplied?.(value,options);}
        else if(!conflicts.length)error="选择尚未应用，请检查提示后重试。";
        return ok;
      }catch(e){if(ticket===sequence)error=e.message||String(e);return false;}
      finally{applying--;if(ticket===sequence||!applying)render();}
    }
    function personHTML(person){
      const athlete=library().athletes.find(a=>a.id===person.athleteId),records=(athlete?.records||[]).filter(r=>!r.deletedAt&&!r.archived).sort((a,b)=>String(b.athlete?.date||"").localeCompare(a.athlete?.date||"")||a.recordId.localeCompare(b.recordId));
      const longitudinal=selection.analysisMode()==="longitudinal",incompatible=!longitudinal&&person.recordIds.length>1;
      return `<section class="selection-person" data-person="${E(person.athleteId)}"><h3>${E(athleteName(person.athleteId))}<small>${longitudinal?"请选择至少两条测试记录":"请选择一条测试记录"}</small></h3><div class="selection-records">${incompatible?'<p class="notice">已保留多条记录；请取消多余记录，保留本次使用的一条。</p>':""}${records.map(r=>`<label><input type="${longitudinal||incompatible?"checkbox":"radio"}" name="record-${E(person.athleteId)}" data-select-record="${E(r.recordId)}"${person.recordIds.includes(r.recordId)?" checked":""}><span>${E(r.athlete?.date||"未填日期")}<small>${E(r.title||"测试记录")} · ${E(r.recordId.slice(-6))}</small></span></label>`).join("")||'<p class="empty">尚无测试记录，请先录入数据。</p>'}</div></section>`;
    }
    function objectSummary(draft){
      const names=draft.athletes.map(p=>athleteName(p.athleteId)),people=names.length===1?names[0]:names.length?`${names.length} 名运动员`:"";
      return [people,draft.references.length?`${draft.references.length} 个群体`:""].filter(Boolean).join(" · ")||"选择运动员或群体参照";
    }
    function recordSummary(draft){
      if(!draft.athletes.length)return draft.references.length?"使用群体统计日期":"请先选择运动员";
      const count=draft.athletes.reduce((n,p)=>n+p.recordIds.length,0);if(!count)return "选择真实测试记录";
      if(draft.athletes.length===1&&count===1){const p=draft.athletes[0],r=library().athletes.find(a=>a.id===p.athleteId)?.records.find(r=>r.recordId===p.recordIds[0]);return r?.athlete?.date||"已选 1 条测试记录";}
      return `已选 ${count} 条测试记录`;
    }
    function render(){
      const node=host.element?.();if(!node||!library())return;sync();
      const draft=selection.get(),q=query.trim().toLocaleLowerCase(),selected=new Set(draft.athletes.map(p=>p.athleteId)),classes=root.RingsideClassifications.normalize(library().classifications||{});
      const people=library().athletes.filter(a=>!a.deletedAt&&!a.archived&&(!group||a.groupId===group)&&(!q||[a.name,a.id,root.RingsideClassifications.resolve(a.profile||{},classes).sportName].join(" ").toLocaleLowerCase().includes(q)));
      const focused=root.document.activeElement,searchFocused=focused?.dataset?.selectionSearch!==undefined,position=focused?.selectionStart;
      const status=selection.status(),currentApplying=!!applying&&applyingSequence===sequence,messages={
        "empty":draft.analysisMode==="horizontal"?"请选择至少两名运动员，或添加群体参照。":"请选择一名运动员及其测试记录。",
        "choose-athlete":"已保留所选运动员；当前分析方式只适用于一人，请移除其他运动员或切换为横向比较。",
        "references-not-supported":"已保留群体参照；当前分析方式不使用群体参照，请移除参照或切换为横向比较。",
        "missing-comparison":"横向比较需要至少两名运动员，或添加群体参照。",
        "choose-one":"已保留多条测试记录；当前分析方式每人只使用一条，请取消多余记录。",
        "choose-many":"纵向比较需要同一名运动员的至少两条测试记录。",
        "missing-record":"请展开测试记录，为每名运动员选择测试日期。"
      },note=messages[status]||(dirty?"选择尚未应用，点击“查看报告”后更新。":"");
      if(panel==="records"&&!draft.athletes.length)panel="";
      const button=(key,label,value,disabled=false)=>`<button type="button" class="selection-trigger" data-selection-toggle="${key}" aria-expanded="${panel===key}" aria-controls="reportSelection-${key}"${disabled?" disabled":""}><span>${label}</span><strong>${E(value)}</strong><i aria-hidden="true">⌄</i></button>`;
      node.innerHTML=`<div class="selection-row"><label class="selection-analysis"><span>分析方式</span><select data-analysis-mode aria-label="分析方式">${analysisModes.map(([key,label])=>opt(key,label,draft.analysisMode)).join("")}</select></label>${button("athletes","选择运动员",objectSummary(draft))}${button("records","测试记录",recordSummary(draft),!draft.athletes.length)}<div class="selection-submit"><button type="button" class="btn primary small" data-apply-selection${currentApplying||status!=="ready"?" disabled":""}>${currentApplying?"正在更新…":"查看报告"}</button><button type="button" class="btn small" data-revert-selection${!dirty?" disabled":""}>撤销选择</button><button type="button" class="btn small" data-cancel-selection>取消</button>${draft.analysisMode!=="single"?`<button type="button" class="text-btn selection-settings-toggle" data-selection-settings-toggle aria-expanded="${settingsOpen}" aria-controls="reportSelection-settings">报告设置</button>`:""}</div></div><section id="reportSelection-athletes" class="selection-panel" data-selection-panel="athletes" aria-label="选择报告对象"${panel==="athletes"?"":" hidden"}><div class="selection-panel-head"><strong>选择报告对象</strong><button type="button" class="text-btn" data-selection-close>收起</button></div><div class="selection-picked">${draft.athletes.map(p=>`<span class="selection-chip"><span>${E(athleteName(p.athleteId))}</span><button type="button" data-remove-athlete="${E(p.athleteId)}" aria-label="移除 ${E(athleteName(p.athleteId))}">×</button></span>`).join("")}${draft.references.map(ref=>`<span class="selection-chip selection-cohort"><button type="button" data-edit-reference="${E(ref.id)}">${E(ref.label||"群体参照")}</button><button type="button" data-remove-reference="${E(ref.id)}" aria-label="移除群体 ${E(ref.label||"群体参照")}">×</button></span>`).join("")}</div><button type="button" class="selection-reference-action" data-add-reference${draft.analysisMode!=="horizontal"?" hidden":""}><span>群体参照</span><small>按成员条件与统计日期配置</small><b aria-hidden="true">＋</b></button><div class="selection-search"><input type="search" data-selection-search value="${E(query)}" placeholder="搜索姓名、专项或编号" aria-label="搜索运动员"><select data-selection-group aria-label="筛选队伍">${opt("","全部队伍",group)}${(library().groups||[]).map(g=>opt(g.id,g.name,group)).join("")}</select></div><div class="selection-athletes">${people.slice(0,80).map(a=>`<label><input type="checkbox" data-select-athlete="${E(a.id)}"${selected.has(a.id)?" checked":""}><span>${E(a.name||a.profile?.name)}<small>${E(library().groups?.find(g=>g.id===a.groupId)?.name||a.id.slice(-6))}</small></span></label>`).join("")||'<p class="empty">没有匹配的运动员</p>'}</div>${people.length>80?'<p class="muted">请搜索姓名或选择队伍以缩小范围。</p>':""}</section><section id="reportSelection-records" class="selection-panel" data-selection-panel="records" aria-label="选择测试记录"${panel==="records"?"":" hidden"}><div class="selection-panel-head"><strong>选择测试记录</strong><button type="button" class="text-btn" data-selection-close>收起</button></div><div class="selection-people">${draft.athletes.map(personHTML).join("")}</div></section>${draft.analysisMode!=="single"?`<section id="reportSelection-settings" class="selection-options"${settingsOpen?"":" hidden"}>${field("统一评价方案",`<select data-profile>${opt("","不使用评价方案",draft.profileId)}${draft.profileId&&!(library().evaluationProfiles||[]).some(p=>p.id===draft.profileId)?`<option value="${E(draft.profileId)}" selected disabled>评价方案已不可用</option>`:""}${(library().evaluationProfiles||[]).filter(p=>!p.disabled||p.id===draft.profileId).map(p=>opt(p.id,p.name,draft.profileId)).join("")}</select>`)}${field("报告名称（可选）",`<input data-report-title value="${E(draft.title||"")}" placeholder="随报告重点生成">`)}</section>`:""}<p class="selection-status" role="status">${E(error||(currentApplying?"正在更新报告…":note))}</p>`;
      node.querySelector("[data-analysis-mode]").onchange=event=>{selection.analysisMode(event.target.value);changed();node.querySelector("[data-analysis-mode]")?.focus({preventScroll:true});};
      node.querySelector("[data-cancel-selection]").onclick=()=>host.onCancel?.();
      node.querySelectorAll("[data-selection-toggle]").forEach(button=>button.onclick=()=>{const key=button.dataset.selectionToggle;panel=panel===key?"":key;settingsOpen=false;render();node.querySelector(`[data-selection-toggle="${key}"]`)?.focus({preventScroll:true});});
      node.querySelectorAll("[data-selection-close]").forEach(button=>button.onclick=()=>closePanel(true));
      node.querySelector("[data-selection-search]").oninput=e=>{query=e.target.value;render();};
      node.querySelector("[data-selection-group]").onchange=e=>{group=e.target.value;render();};
      node.querySelectorAll("[data-select-athlete]").forEach(input=>input.onchange=()=>{selection.athlete(input.dataset.selectAthlete,input.checked);changed();node.querySelector(`[data-select-athlete="${input.dataset.selectAthlete}"]`)?.focus({preventScroll:true});});
      node.querySelectorAll("[data-remove-athlete]").forEach(button=>button.onclick=()=>{selection.athlete(button.dataset.removeAthlete,false);changed();});
      node.querySelectorAll("[data-select-record]").forEach(input=>input.onchange=()=>{const aid=input.closest("[data-person]").dataset.person;selection.record(aid,input.dataset.selectRecord,input.checked);changed();node.querySelector(`[data-person="${aid}"] [data-select-record="${input.dataset.selectRecord}"]`)?.focus({preventScroll:true});});
      node.querySelector("[data-add-reference]").onclick=()=>openReference();
      node.querySelectorAll("[data-edit-reference]").forEach(button=>button.onclick=()=>openReference(button.dataset.editReference));
      node.querySelectorAll("[data-remove-reference]").forEach(button=>button.onclick=()=>{selection.removeReference(button.dataset.removeReference);changed();});
      node.querySelector("[data-apply-selection]").onclick=()=>apply();node.querySelector("[data-revert-selection]").onclick=()=>reset();
      node.querySelector("[data-selection-settings-toggle]")?.addEventListener("click",()=>{settingsOpen=!settingsOpen;panel="";render();node.querySelector("[data-selection-settings-toggle]")?.focus({preventScroll:true});});
      const profile=node.querySelector("[data-profile]");if(profile)profile.onchange=()=>{selection.update(d=>{d.profileId=profile.value;});changed();};
      const title=node.querySelector("[data-report-title]");if(title)title.onchange=()=>{selection.update(d=>{d.title=title.value.trim();});changed();};
      if(searchFocused){const input=node.querySelector("[data-selection-search]");input.focus({preventScroll:true});if(position!=null)input.setSelectionRange(position,position);}
    }
    function standardsFor(ref){
      const rows=conflicts.filter(c=>c.referenceId===ref.id);
      for(const [metricKey,override] of Object.entries(ref.evaluationOverrides||{}))if(!rows.some(c=>c.metricKey===metricKey))rows.push({referenceId:ref.id,metricKey,name:override.name||override.standard.subjectId||metricKey,unit:override.standard.unit,candidates:[]});
      return rows;
    }
    function conflictHTML(conflict){
      const override=referenceDraft?.evaluationOverrides?.[conflict.metricKey]?.standard,selected=override?conflict.candidates.findIndex(c=>JSON.stringify(c.standard)===JSON.stringify(override)):-1;
      return `<fieldset class="selection-standard" data-standard="${E(conflict.metricKey)}"><legend>${E(conflict.name)} · ${E(conflict.unit||"")}</legend><label>统一评价标准<select data-standard-choice><option value="">请选择共同适用标准</option>${override&&selected<0?'<option value="custom" selected>已配置的统一标准</option>':""}${conflict.candidates.map((c,i)=>opt(String(i),`${c.standard.referenceGroup?.name||c.standard.name||"标准 "+(i+1)} · ${c.standard.target!=null?"目标 "+c.standard.target+(c.standard.unit?" "+c.standard.unit:""):"分级区间"} · 版本 ${c.standard.revision||0}`,selected===i?String(i):"custom")).join("")}</select></label>${override?`${["metric","iso"].includes(override.kind)?`<label>统一目标<input type="number" step="any" data-standard-target value="${E(override.target??"")}"></label>`:""}<small>单位：${E(override.unit||conflict.unit||"无")} · 来源版本 ${E(override.revision||0)}${override.configured?" · 自定统一标准":""}</small><div class="selection-standard-ranges">${(override.ranges||[]).map((range,i)=>`<div data-standard-range="${i}"><label>下限<input type="number" step="any" data-range-field="min" value="${E(range.min??"")}"></label><label><input type="checkbox" data-range-field="includeMin"${range.includeMin!==false?" checked":""}>包含下限</label><label>上限<input type="number" step="any" data-range-field="max" value="${E(range.max??"")}"></label><label><input type="checkbox" data-range-field="includeMax"${range.includeMax!==false?" checked":""}>包含上限</label><label>评价名称<input data-range-field="label" value="${E(range.label||"")}"></label><label>等级<select data-range-field="status">${[["green","绿色"],["amber","黄色"],["red","红色"],["gray","灰色"]].map(([v,l])=>opt(v,l,range.status)).join("")}</select></label><button type="button" class="btn small" data-remove-range="${i}">移除区间</button></div>`).join("")}${["metric","balance"].includes(override.kind)?'<button type="button" class="btn small" data-add-range>添加分级区间</button>':""}</div>`:""}</fieldset>`;
    }
    function openReference(id){
      const existing=selection.get().references.find(ref=>ref.id===id);referenceDraft=existing?copy(existing):{id:uid(),label:"",scope:"all",sex:"",explicitConditions:true,sampling:"latest",window:{kind:"",from:"",to:""}};
      referenceError="";referenceReturnId=existing?.id||"";panel="";render();renderReference();dialog().showModal();
    }
    function finishReference(restoreFocus=true){
      const returnId=referenceReturnId;referenceDraft=null;referenceError="";referenceReturnId="";dialog()?.close();render();
      if(restoreFocus){panel="athletes";render();const node=host.element?.();(returnId?node?.querySelector(`[data-edit-reference="${returnId}"]`):node?.querySelector("[data-add-reference]"))?.focus({preventScroll:true});}
    }
    function renderReference(){
      if(!referenceDraft)return;let modal=dialog();
      if(!modal){modal=root.document.createElement("dialog");modal.id="reportReferenceDialog";modal.className="selection-reference-dialog";modal.setAttribute("aria-labelledby","reportReferenceTitle");root.document.body.append(modal);modal.addEventListener("cancel",event=>{event.preventDefault();finishReference();});modal.addEventListener("click",event=>{if(event.target===modal){const b=modal.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)finishReference();}});}
      const ref=referenceDraft,classes=root.RingsideClassifications.normalize(library().classifications||{}),sport=classes.sports.find(s=>s.id===ref.sportId),choose=(key,items,current)=>`<select data-reference-field="${key}">${items.map(([v,l])=>opt(v,l,current)).join("")}</select>`,window=ref.window||{};
      modal.innerHTML=`<form class="selection-reference-form"><header class="modal-head"><h2 id="reportReferenceTitle">${selection.get().references.some(r=>r.id===ref.id)?"编辑":"添加"}群体参照</h2><button type="button" class="close" data-reference-cancel aria-label="取消群体设置">×</button></header><section class="selection-reference-body" data-reference="${E(ref.id)}"><p class="note">设置成员条件、统计日期和每人取样方式。确认后加入本次选择，再点击“查看报告”。</p><div class="form-grid">${field("群体名称",`<input data-reference-field="label" value="${E(ref.label||"")}" placeholder="按成员条件命名">`)}${field("性别",choose("sex",[["","全部性别"],["男","男"],["女","女"],["未注明","未注明"]],ref.sex||""))}${field("队伍",choose("teamId",[["","全部队伍"],...(library().groups||[]).map(g=>[g.id,g.name])],ref.teamId||""))}${field("专项",choose("sportId",[["","全部专项"],...classes.sports.filter(s=>!s.disabled||s.id===ref.sportId).map(s=>[s.id,s.name])],ref.sportId||""))}${field(sport?.subdivisionLabel||"专项细分",choose("subdivisionId",[["","全部"],...classes.subdivisions.filter(s=>s.sportId===ref.sportId&&(!s.disabled||s.id===ref.subdivisionId)).map(s=>[s.id,s.name])],ref.subdivisionId||""))}${field("年龄分组",choose("ageBandId",[["","全部年龄"],...classes.ageBands.filter(a=>!a.disabled||a.id===ref.ageBandId).map(a=>[a.id,`${a.name}（${a.min}–${a.max} 岁）`])],ref.ageBandId||""))}${field("日期范围",choose("window.kind",dates,window.kind||""))}${window.kind==="custom"?field("开始日期",`<input type="date" data-reference-field="window.from" value="${E(window.from||"")}">`)+field("结束日期",`<input type="date" data-reference-field="window.to" value="${E(window.to||"")}">`):""}${field("每人取样",choose("sampling",[["latest","最近可比测试"],["period-record","期间最佳成绩"],["period-mean","期间均值"]],ref.sampling||"latest"))}</div><div class="row"><button type="button" class="btn small" data-manage="sports">管理专项分类</button><button type="button" class="btn small" data-manage="ageBands">管理年龄分组</button></div>${standardsFor(ref).map(conflictHTML).join("")}<p class="field-error" data-reference-error role="alert">${E(referenceError)}</p></section><footer class="modal-foot"><button type="button" class="btn" data-reference-cancel>取消</button><button type="submit" class="btn primary" data-reference-confirm>确认群体</button></footer></form>`;
      modal.querySelectorAll("[data-reference-cancel]").forEach(button=>button.onclick=()=>finishReference());modal.querySelector("form").onsubmit=event=>{event.preventDefault();confirmReference();};
      modal.querySelectorAll("[data-reference-field]").forEach(input=>input.onchange=()=>{
        const key=input.dataset.referenceField,ref=referenceDraft;referenceError="";
        if(key.startsWith("window.")){ref.window||={};ref.window[key.slice(7)]=input.value;if(key==="window.kind"&&input.value&&input.value!=="custom")ref.window=root.RingsideHorizontalSetup.dateWindow(input.value);}else ref[key]=input.value;
        if(key==="label")ref.autoLabel=!input.value.trim();if(key==="sportId")ref.subdivisionId="";if(key==="ageBandId"){delete ref.ageMin;delete ref.ageMax;delete ref.ageBandName;}ref.scope=ref.teamId?"team":ref.sportId?"sport":"all";
        // Text and date fields retain focus; only dependent controls rebuild.
        if(["window.kind","sportId"].includes(key)){renderReference();modal.querySelector(`[data-reference-field="${key}"]`)?.focus({preventScroll:true});}else modal.querySelector("[data-reference-error]").textContent="";
      });
      modal.querySelectorAll("[data-manage]").forEach(button=>button.onclick=()=>{modal.close();const reopen=()=>{if(referenceDraft){renderReference();dialog().showModal();}};if(host.manage?.(button.dataset.manage,reopen)===false)reopen();});
      modal.querySelectorAll("[data-standard-choice]").forEach(input=>input.onchange=()=>{
        const key=input.closest("[data-standard]").dataset.standard,conflict=conflicts.find(c=>c.referenceId===referenceDraft.id&&c.metricKey===key),candidate=conflict?.candidates[Number(input.value)];
        if(input.value===""){if(referenceDraft.evaluationOverrides)delete referenceDraft.evaluationOverrides[key];}else if(candidate){referenceDraft.evaluationOverrides||={};referenceDraft.evaluationOverrides[key]={name:conflict.name,standard:copy(candidate.standard)};}renderReference();
      });
      function editStandard(input,change){const key=input.closest("[data-standard]").dataset.standard,standard=referenceDraft.evaluationOverrides[key].standard;change(standard);standard.configured=true;standard.configurationVersion=1;}
      modal.querySelectorAll("[data-standard-target]").forEach(input=>input.onchange=()=>{editStandard(input,s=>{s.target=input.value===""?null:Number(input.value);s.targetEnabled=s.target!==null;});});
      modal.querySelectorAll("[data-range-field]").forEach(input=>input.onchange=()=>editStandard(input,s=>{const range=s.ranges[Number(input.closest("[data-standard-range]").dataset.standardRange)],key=input.dataset.rangeField;range[key]=input.type==="checkbox"?input.checked:input.type==="number"?(input.value===""?null:Number(input.value)):input.value;}));
      modal.querySelectorAll("[data-add-range]").forEach(button=>button.onclick=()=>{editStandard(button,s=>{s.ranges||=[];s.ranges.push({min:null,max:null,includeMin:true,includeMax:true,label:"",status:"green"});});renderReference();});
      modal.querySelectorAll("[data-remove-range]").forEach(button=>button.onclick=()=>{editStandard(button,s=>s.ranges.splice(Number(button.dataset.removeRange),1));renderReference();});
    }
    function confirmReference(){
      try{
        const ref=copy(referenceDraft);ref.window=root.RingsideHorizontalSetup.dateWindow(ref.window?.kind,ref.window?.from,ref.window?.to,ref.window?.to||undefined);
        const normalized=root.RingsideHorizontalSetup.resolveReferences([ref],{athletes:library().athletes,classifications:root.RingsideClassifications.normalize(library().classifications||{}),groups:library().groups||[]})[0];
        if(conflicts.some(c=>c.referenceId===ref.id&&!normalized.evaluationOverrides?.[c.metricKey]?.standard))throw Error("请为以下指标明确选择共同适用标准。");
        if(selection.get().references.some(r=>r.id===ref.id))selection.update(d=>{d.references[d.references.findIndex(r=>r.id===ref.id)]=normalized;});else selection.reference(normalized);
        finishReference();changed({preserveConflicts:true});
      }catch(error){referenceError=error.message||String(error);dialog().querySelector("[data-reference-error]").textContent=referenceError;}
    }
    function clearDraftUI(){dirty=false;conflicts=[];error="";panel="";settingsOpen=false;referenceDraft=null;referenceError="";referenceReturnId="";dialog()?.close();}
    function begin({intent="new",configuration,analysisMode}={}){
      sequence++;host.cancelPending?.();clearDraftUI();query="";group="";sessionActive=true;
      const value=intent==="edit"?(configuration?fromConfiguration(configuration):fromCurrent()):{athletes:[],references:[],mode:"best",profileId:library()?.defaultEvaluationProfileId||"",analysisMode:"single"};
      if(validAnalysisMode(analysisMode))value.analysisMode=analysisMode;
      selection.replace(value);baseline=selection.get();sourceIdentity=identity();editingReportId=intent==="edit"?(configuration?.reportId||configuration?.id||host.reportId?.()||null):null;initialized=true;
      render();return selection.get();
    }
    function cancel(){sequence++;clearDraftUI();sessionActive=false;initialized=false;baseline=null;editingReportId=null;sourceIdentity="";selection.replace({analysisMode:"single"});return true;}
    function reset(){sequence++;host.cancelPending?.();clearDraftUI();if(sessionActive&&baseline)selection.replace(baseline);else{initialized=false;sync(true);}render();}
    root.document?.addEventListener("pointerdown",event=>{if(panel&&!host.element?.()?.contains(event.target))closePanel();});
    root.document?.addEventListener("keydown",event=>{if(event.key==="Escape"&&panel&&!dialog()?.open){event.preventDefault();closePanel(true);}});
    return {render,apply,sync,begin,cancel,state:()=>selection.get(),isPending:()=>!!applying,desktopCloseStatus:()=>({busy:!!applying,unsaved:dirty||!!referenceDraft}),
      showConflicts(value){conflicts=copy(value);error="以下指标适用多个评价标准，请明确选定群体统一标准。";render();if(conflicts.length)openReference(conflicts[0].referenceId);},
      edit(configuration){return begin({intent:"edit",configuration});},reset};
  }
  root.RingsideReportSelection={state,create};
})(typeof window!=="undefined"?window:globalThis);
