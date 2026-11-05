(function(root){
  "use strict";
  const copy=v=>JSON.parse(JSON.stringify(v)), E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]));
  const option=(value,label,current)=>`<option value="${E(value)}"${value===current?' selected':''}>${E(label)}</option>`;
  function candidates(athlete,window){
    if(!window?.from||!window?.to||window.from>window.to)return [];
    return (athlete?.records||[]).filter(r=>!r.deletedAt&&!r.deleted&&!r.archived&&!r.demo&&!r.sample&&r.athlete?.date>=window.from&&r.athlete.date<=window.to)
      .sort((a,b)=>b.athlete.date.localeCompare(a.athlete.date)||String(a.recordId).localeCompare(String(b.recordId)));
  }
  function resolveSelection(athlete,window,recordId=""){
    const records=candidates(athlete,window),kept=records.find(r=>r.recordId===recordId);
    if(kept)return {recordId:kept.recordId,records,ambiguous:false};
    const latest=records.filter(r=>r.athlete.date===records[0]?.athlete.date);
    return {recordId:latest.length===1?latest[0].recordId:"",records,ambiguous:latest.length>1};
  }
  function create(host){
    let dialog=null,draft=null,editingId=null,busy=false,query="",error="",ticket=0;
    const library=()=>host.library(),available=()=>library().athletes.filter(a=>!a.deletedAt&&!a.deleted&&!a.archived&&!a.demo&&!a.sample);
    function syncRecords(reset=false){for(const p of draft.participants){const a=available().find(a=>a.id===p.athleteId);p.recordId=resolveSelection(a,draft.window,reset?"":p.recordId).recordId;}}
    function close(){if(busy)return false;ticket++;dialog?.close();dialog?.remove();dialog=null;draft=null;host.onClose?.();return true;}
    function render(){
      if(!dialog||!draft)return;
      const focused=root.document.activeElement,key=focused?.dataset?.teamField,search=focused?.hasAttribute('data-team-search'),position=focused?.selectionStart;
      const people=available(),chosen=new Set(draft.participants.map(p=>p.athleteId)),q=query.trim().toLocaleLowerCase(),group=library().groups.find(g=>g.id===draft.groupId);
      const field=(label,html)=>`<label class="field"><span>${label}</span>${html}</label>`;
      dialog.innerHTML=`<form class="team-selection-form"><header class="modal-head"><h2>团队报告</h2><button type="button" class="close" data-team-cancel aria-label="关闭">×</button></header><section class="team-selection-body"><div class="form-grid">${field('队伍',`<select data-team-field="groupId">${option('','请选择队伍',draft.groupId)}${library().groups.map(g=>option(g.id,g.name,draft.groupId)).join('')}</select>`)}${field('报告名称',`<input data-team-field="title" value="${E(draft.title)}" placeholder="${E((group?.name||'团队')+' · 团队报告')}">`)}${field('开始日期',`<input type="date" required data-team-field="from" value="${E(draft.window.from)}">`)}${field('结束日期',`<input type="date" required data-team-field="to" value="${E(draft.window.to)}">`)}${field('代表结果',`<select data-team-field="mode">${option('best','最佳',draft.mode)}${option('mean','均值',draft.mode)}</select>`)}${field('评价方案',`<select data-team-field="profileId">${option('','不使用评价方案',draft.profileId)}${library().evaluationProfiles.map(p=>option(p.id,p.name,draft.profileId)).join('')}</select>`)}</div><div class="team-selection-members"><section><h3>报告成员 <small>${chosen.size} 人</small></h3><input type="search" data-team-search value="${E(query)}" placeholder="搜索姓名或编号，补选成员" aria-label="搜索团队报告成员"><div class="team-member-options">${people.filter(a=>!q||[a.name,a.id].join(' ').toLocaleLowerCase().includes(q)).map(a=>`<label><input type="checkbox" data-team-person="${E(a.id)}"${chosen.has(a.id)?' checked':''}><span>${E(a.name)}<small>${E(library().groups.find(g=>g.id===a.groupId)?.name||'未分组')} · ${E(a.id.slice(-6))}</small></span></label>`).join('')||'<p class="empty">没有匹配的运动员</p>'}</div></section><section><h3>所选测试记录</h3><p class="note">每人使用一条记录；缺少的指标保留为空。同日多条记录需手动选择。</p><div class="team-record-options">${draft.participants.map(p=>{const a=people.find(a=>a.id===p.athleteId)||library().athletes.find(a=>a.id===p.athleteId),resolved=resolveSelection(a,draft.window,p.recordId);return `<label class="field"><span>${E(a?.name||'人员不可用')} <small>${E(p.athleteId.slice(-6))}${people.some(a=>a.id===p.athleteId)?'':' · 已归档或移除'}</small><button type="button" class="text-btn" data-team-remove="${E(p.athleteId)}" aria-label="移除 ${E(a?.name||p.athleteId)}">移除</button></span>${resolved.records.length?`<select data-team-record="${E(p.athleteId)}">${option('',resolved.ambiguous?'同日有多条记录，请选择':'请选择记录',p.recordId)}${resolved.records.map(r=>option(r.recordId,`${r.athlete.date} · ${r.title||'测试记录'} · ${r.recordId.slice(-6)}`,p.recordId)).join('')}</select>`:`<span class="note">${draft.window.from&&draft.window.to?'日期范围内无测试记录':'请先选择日期范围'}</span>`}</label>`;}).join('')||'<p class="empty">选择队伍或勾选成员</p>'}</div></section></div><p class="field-error" role="alert" data-team-selection-error>${E(error)}</p></section><footer class="modal-foot"><button type="button" class="btn" data-team-cancel${busy?' disabled':''}>取消</button><button type="submit" class="btn primary"${busy?' disabled':''}>${busy?'正在生成…':editingId?'更新团队报告':'查看团队报告'}</button></footer></form>`;
      dialog.querySelectorAll('[data-team-cancel]').forEach(el=>el.onclick=close);
      dialog.querySelectorAll('[data-team-field]').forEach(el=>el.onchange=()=>{
        const name=el.dataset.teamField;if(name==='from'||name==='to'){draft.window[name]=el.value;if(name==='from'&&!draft.window.to)draft.window.to=el.value;syncRecords(true);}
        else if(name==='groupId'){draft.groupId=el.value;draft.participants=people.filter(a=>a.groupId===el.value&&el.value).map(a=>({athleteId:a.id,recordId:''}));syncRecords(true);}
        else draft[name]=el.value;error='';render();
      });
      dialog.querySelector('[data-team-search]').oninput=event=>{query=event.target.value;render();};
      dialog.querySelectorAll('[data-team-person]').forEach(el=>el.onchange=()=>{const id=el.dataset.teamPerson;if(el.checked&&!chosen.has(id))draft.participants.push({athleteId:id,recordId:resolveSelection(people.find(a=>a.id===id),draft.window).recordId});else if(!el.checked)draft.participants=draft.participants.filter(p=>p.athleteId!==id);error='';render();});
      dialog.querySelectorAll('[data-team-remove]').forEach(el=>el.onclick=event=>{event.preventDefault();draft.participants=draft.participants.filter(p=>p.athleteId!==el.dataset.teamRemove);error='';render();});
      dialog.querySelectorAll('[data-team-record]').forEach(el=>el.onchange=()=>{draft.participants.find(p=>p.athleteId===el.dataset.teamRecord).recordId=el.value;error='';});
      dialog.querySelector('form').onsubmit=async event=>{
        event.preventDefault();if(busy)return;
        const value=copy(draft),valid=root.RingsideLongitudinalStore.validDate;
        if(!valid(value.window.from)||!valid(value.window.to)||value.window.from>value.window.to)error='请选择有效的起止日期。';
        else if(!value.participants.length)error='请至少选择一名运动员。';
        else if(value.participants.some(p=>!people.some(a=>a.id===p.athleteId)))error='部分成员已归档或移除，请调整报告名单。';
        else if(value.participants.some(p=>candidates(people.find(a=>a.id===p.athleteId),value.window).length&&!p.recordId))error='请为有多条记录的运动员指定一条测试记录。';
        if(error){render();return;}
        const sequence=++ticket;busy=true;render();
        value.titleAuto=!value.title.trim();value.title=value.title.trim()||(group?.name||'团队')+' · 团队报告';
        try{const ok=await host.select(value,{reportId:editingId,isCurrent:()=>ticket===sequence});if(ok){busy=false;close();}else error='报告尚未生成，请检查页面提示后重试。';}
        catch(e){error=e.message||String(e);}finally{busy=false;render();}
      };
      if(search){const node=dialog.querySelector('[data-team-search]');node.focus({preventScroll:true});node.setSelectionRange(position,position);}else if(key)dialog.querySelector(`[data-team-field="${key}"]`)?.focus({preventScroll:true});
    }
    async function open(configuration=null,{reportId=null}={}){
      if(busy)return false;if(host.beforeOpen&&!await host.beforeOpen())return false;
      close();draft=configuration?copy(configuration):{groupId:'',participants:[],window:{kind:'custom',from:'',to:''},mode:'best',profileId:library().defaultEvaluationProfileId||'',title:''};
      editingId=reportId;query='';error='';draft.window={kind:'custom',from:'',to:'',...draft.window};draft.participants||=[];
      dialog=root.document.createElement('dialog');dialog.id='teamReportDialog';dialog.className='team-selection-dialog';dialog.setAttribute('aria-label','团队报告设置');root.document.body.append(dialog);
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});render();dialog.showModal();return true;
    }
    return {open,close,isOpen:()=>!!dialog,desktopCloseStatus:()=>({busy,dirty:!!dialog})};
  }
  root.RingsideTeamSelection={create,candidates,resolveSelection};
})(window);
