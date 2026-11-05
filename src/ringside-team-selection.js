(function(root){
  "use strict";
  const copy=v=>JSON.parse(JSON.stringify(v)), E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]));
  const option=(value,label,current)=>`<option value="${E(value)}"${value===current?' selected':''}>${E(label)}</option>`;
  const eligible=a=>!a.deletedAt&&!a.deleted&&!a.archived&&!a.demo&&!a.sample;
  function candidates(athlete,window){
    if(!window?.from||!window?.to||window.from>window.to)return [];
    return (athlete?.records||[]).filter(r=>eligible(r)&&r.athlete?.date>=window.from&&r.athlete.date<=window.to)
      .sort((a,b)=>b.athlete.date.localeCompare(a.athlete.date)||String(a.recordId).localeCompare(String(b.recordId)));
  }
  function resolveSelection(athlete,window,recordId=""){
    const records=candidates(athlete,window),kept=records.find(r=>r.recordId===recordId);
    if(kept)return {recordId:kept.recordId,records,ambiguous:false};
    const latest=records.filter(r=>r.athlete.date===records[0]?.athlete.date);
    return {recordId:latest.length===1?latest[0].recordId:"",records,ambiguous:latest.length>1};
  }
  function memberGroups(athletes,groups=[],groupId="",query=""){
    const q=query.trim().toLocaleLowerCase(),known=new Set(groups.map(g=>g.id));
    const people=athletes.filter(a=>eligible(a)&&(!q||[a.name||a.profile?.name,a.id].join(' ').toLocaleLowerCase().includes(q)));
    const ordered=[...groups.filter(g=>g.id===groupId),...groups.filter(g=>g.id!==groupId),{id:'',name:'未分组'}];
    return ordered.map(group=>({...group,own:!!groupId&&group.id===groupId,people:people.filter(a=>group.id?a.groupId===group.id:!known.has(a.groupId))})).filter(group=>group.people.length);
  }
  function create(host){
    let node=null,draft=null,editingId=null,busy=false,query="",error="",ticket=0,panel="members";
    const library=()=>host.library(),available=()=>(library().athletes||[]).filter(eligible);
    const name=a=>a?.name||a?.profile?.name||'人员不可用';
    function number(id,people){const short=id.slice(-6);return people.filter(a=>a.id.slice(-6)===short).length>1?id:short;}
    function syncRecords(reset=false){for(const p of draft.participants){const a=available().find(a=>a.id===p.athleteId);p.recordId=resolveSelection(a,draft.window,reset?"":p.recordId).recordId;}}
    function cancel(){
      ticket++;busy=false;draft=null;editingId=null;query='';error='';panel='members';
      if(node)node.innerHTML='';node=null;return true;
    }
    async function userCancel(){if(!draft)return false;cancel();await host.onCancel?.();return true;}
    function validation(value,people){
      const valid=root.RingsideLongitudinalStore.validDate;
      if(!valid(value.window.from)||!valid(value.window.to)||value.window.from>value.window.to)return {message:'请选择有效的起止日期。',panel:'records'};
      if(!value.participants.length)return {message:'请至少选择一名运动员。',panel:'members'};
      if(value.participants.some(p=>!people.some(a=>a.id===p.athleteId)))return {message:'部分成员已归档或移除，请调整报告名单。',panel:'members'};
      if(value.participants.some(p=>candidates(people.find(a=>a.id===p.athleteId),value.window).length&&!p.recordId))return {message:'请为有多条记录的运动员指定一条测试记录。',panel:'records'};
      return null;
    }
    async function apply(){
      if(!draft||busy)return false;
      const value=copy(draft),issue=validation(value,available());
      if(issue){error=issue.message;panel=issue.panel;render();return false;}
      const sequence=++ticket,reportId=editingId,current=()=>!!draft&&ticket===sequence;
      busy=true;error='';render();
      const group=(library().groups||[]).find(g=>g.id===value.groupId);
      value.titleAuto=!value.title.trim();value.title=value.title.trim()||(group?.name||'团队')+' · 团队报告';
      try{
        const ok=await host.select(value,{reportId,isCurrent:current});
        if(!current())return false;
        if(!ok){error='报告尚未生成，请检查页面提示后重试。';return false;}
        await host.onApplied?.();
        if(current())cancel();
        return true;
      }catch(e){if(current())error=e.message||String(e);return false;}
      finally{if(current()){busy=false;render();}}
    }
    function render(){
      if(!node||!draft)return;
      const focused=root.document.activeElement,focusKeys=['data-team-field','data-team-person','data-team-record','data-team-search','data-team-toggle','data-team-remove'];
      const focusKey=node.contains?.(focused)?focusKeys.find(key=>focused.hasAttribute(key)):null,focusValue=focusKey?focused.getAttribute(focusKey):null,position=focused?.selectionStart;
      const scroll=node.querySelector('.team-selection-content')?.scrollTop||0,people=available(),chosen=new Set(draft.participants.map(p=>p.athleteId)),groups=library().groups||[],group=groups.find(g=>g.id===draft.groupId);
      const field=(label,html)=>`<label class="field"><span>${E(label)}</span>${html}</label>`,disabled=busy?' disabled':'';
      const missing=draft.participants.filter(p=>!candidates(people.find(a=>a.id===p.athleteId),draft.window).length).length;
      const issue=validation(draft,people),status=error||(busy?'正在生成团队报告…':issue?.message||`${chosen.size} 名成员${missing?'，'+missing+' 人在此日期范围内无记录，将保留缺测。':'，测试记录已选定。'}`);
      const dates=draft.window.from&&draft.window.to?(draft.window.from===draft.window.to?draft.window.from:draft.window.from+' — '+draft.window.to):'请选择起止日期';
      const trigger=(key,label,value)=>`<button type="button" class="selection-trigger" data-team-toggle="${key}" aria-expanded="${panel===key}" aria-controls="teamSelection-${key}"><span>${label}</span><strong>${E(value)}</strong><i aria-hidden="true">⌄</i></button>`;
      const memberHTML=memberGroups(people,groups,draft.groupId,query).map(g=>`<section class="team-member-group" data-team-member-group="${E(g.id)}"${g.own?' data-team-own-group="true"':''}><h3>${E(g.name)} <small>${g.people.length} 人${g.own?' · 本队':''}</small></h3><div class="team-member-options">${g.people.map(a=>`<label><input type="checkbox" data-team-person="${E(a.id)}"${chosen.has(a.id)?' checked':''}${disabled}><span>${E(name(a))}<small>编号 ${E(number(a.id,people))}</small></span></label>`).join('')}</div></section>`).join('');
      const recordHTML=draft.participants.map(p=>{
        const a=people.find(a=>a.id===p.athleteId)||(library().athletes||[]).find(a=>a.id===p.athleteId),resolved=resolveSelection(a,draft.window,p.recordId);
        return `<section class="team-record-person"><div class="team-record-heading"><h3>${E(name(a))}<small>编号 ${E(number(p.athleteId,people))}${people.some(a=>a.id===p.athleteId)?'':' · 已归档或移除'}</small></h3><button type="button" class="text-btn" data-team-remove="${E(p.athleteId)}" aria-label="移除 ${E(name(a))}，编号 ${E(number(p.athleteId,people))}"${disabled}>移除</button></div>${resolved.records.length?`<label class="field"><span class="team-record-label">测试记录</span><select data-team-record="${E(p.athleteId)}" aria-label="${E(name(a))}，编号 ${E(number(p.athleteId,people))}的测试记录"${disabled}>${option('',resolved.ambiguous?'同日有多条记录，请选择':'请选择记录',p.recordId)}${resolved.records.map(r=>option(r.recordId,`${r.athlete.date} · ${r.title||'测试记录'} · ${r.recordId.slice(-6)}`,p.recordId)).join('')}</select></label>`:`<p class="note">${draft.window.from&&draft.window.to?'日期范围内无测试记录，报告中保留缺测。':'请先选择日期范围。'}</p>`}</section>`;
      }).join('');
      node.innerHTML=`<form novalidate class="team-selection-form" aria-label="团队报告选择"><div class="team-selection-actions"><div class="selection-row">${trigger('members','队伍与成员',(group?.name||'选择报告成员')+' · '+chosen.size+' 人')}${trigger('records','测试记录',dates)}<div class="selection-submit"><button type="submit" class="btn primary small" data-team-apply${disabled}>${busy?'正在生成…':editingId?'更新团队报告':'查看团队报告'}</button><button type="button" class="btn small" data-team-cancel>取消</button></div></div><p class="selection-status${error?' field-error':''}" role="status" aria-live="polite" data-team-selection-error>${E(status)}</p></div><div class="team-selection-content"><section id="teamSelection-members" class="selection-panel" data-team-panel="members" aria-label="选择队伍与报告成员"${panel==='members'?'':' hidden'}><div class="selection-panel-head"><strong>队伍与成员</strong><button type="button" class="text-btn" data-team-collapse="members">收起</button></div><div class="team-member-search">${field('队伍',`<select data-team-field="groupId"${disabled}>${option('','请选择队伍',draft.groupId)}${groups.map(g=>option(g.id,g.name,draft.groupId)).join('')}</select>`)}${field('搜索成员',`<input type="search" data-team-search value="${E(query)}" placeholder="搜索姓名或编号" aria-label="搜索团队报告成员">`)}</div><p class="note">可增减本队成员，也可从其他队伍补选。</p>${memberHTML||'<p class="empty">没有匹配的运动员</p>'}</section><section id="teamSelection-records" class="selection-panel" data-team-panel="records" aria-label="选择团队测试记录"${panel==='records'?'':' hidden'}><div class="selection-panel-head"><strong>测试记录与报告设置</strong><button type="button" class="text-btn" data-team-collapse="records">收起</button></div><div class="team-selection-settings">${field('开始日期',`<input type="date" required data-team-field="from" value="${E(draft.window.from)}"${disabled}>`)}${field('结束日期',`<input type="date" required data-team-field="to" value="${E(draft.window.to)}"${disabled}>`)}${field('代表结果',`<select data-team-field="mode"${disabled}>${option('best','最佳',draft.mode)}${option('mean','均值',draft.mode)}</select>`)}${field('评价方案',`<select data-team-field="profileId"${disabled}>${option('','不使用评价方案',draft.profileId)}${(library().evaluationProfiles||[]).map(p=>option(p.id,p.name,draft.profileId)).join('')}</select>`)}${field('报告名称',`<input data-team-field="title" value="${E(draft.title)}" placeholder="${E((group?.name||'团队')+' · 团队报告')}"${disabled}>`)}</div><p class="note">每人使用一条记录；缺少的指标保留为空。同日多条记录需手动选择。</p><div class="team-record-options">${recordHTML||'<p class="empty">请先选择队伍或勾选成员。</p>'}</div></section></div></form>`;
      node.querySelectorAll('[data-team-cancel]').forEach(el=>el.onclick=userCancel);
      node.querySelectorAll('[data-team-toggle]').forEach(el=>el.onclick=()=>{panel=panel===el.dataset.teamToggle?'':el.dataset.teamToggle;render();});
      node.querySelectorAll('[data-team-collapse]').forEach(el=>el.onclick=()=>{const previous=panel;panel='';render();node?.querySelector(`[data-team-toggle="${previous}"]`)?.focus({preventScroll:true});});
      node.querySelectorAll('[data-team-field]').forEach(el=>el.onchange=()=>{
        if(busy||!draft)return;
        const key=el.dataset.teamField;
        if(key==='from'||key==='to'){draft.window[key]=el.value;if(key==='from'&&!draft.window.to)draft.window.to=el.value;syncRecords(true);}
        else if(key==='groupId'){draft.groupId=el.value;draft.participants=people.filter(a=>a.groupId===el.value&&el.value).map(a=>({athleteId:a.id,recordId:''}));syncRecords(true);}
        else draft[key]=el.value;
        error='';render();
      });
      const search=node.querySelector('[data-team-search]');if(search)search.oninput=event=>{query=event.target.value;render();};
      node.querySelectorAll('[data-team-person]').forEach(el=>el.onchange=()=>{
        if(busy||!draft)return;
        const id=el.dataset.teamPerson;
        if(el.checked&&!chosen.has(id))draft.participants.push({athleteId:id,recordId:resolveSelection(people.find(a=>a.id===id),draft.window).recordId});
        else if(!el.checked)draft.participants=draft.participants.filter(p=>p.athleteId!==id);
        error='';render();
      });
      node.querySelectorAll('[data-team-remove]').forEach(el=>el.onclick=()=>{if(busy||!draft)return;draft.participants=draft.participants.filter(p=>p.athleteId!==el.dataset.teamRemove);error='';render();});
      node.querySelectorAll('[data-team-record]').forEach(el=>el.onchange=()=>{if(busy||!draft)return;draft.participants.find(p=>p.athleteId===el.dataset.teamRecord).recordId=el.value;error='';render();});
      const form=node.querySelector('form');if(form)form.onsubmit=event=>{event.preventDefault();return apply();};
      const content=node.querySelector('.team-selection-content');if(content)content.scrollTop=scroll;
      if(focusKey){
        const escaped=String(focusValue).replace(/["\\]/g,'\\$&'),restored=node.querySelector(`[${focusKey}="${escaped}"]`);
        restored?.focus({preventScroll:true});if(position!=null&&typeof restored?.setSelectionRange==='function'&&['search','text'].includes(restored.type))restored.setSelectionRange(position,position);
      }
    }
    async function open(configuration=null,{reportId=null}={}){
      cancel();const target=host.element?.();if(!target)return false;
      node=target;draft=configuration?copy(configuration):{groupId:'',participants:[],window:{kind:'custom',from:'',to:''},mode:'best',profileId:library().defaultEvaluationProfileId||'',title:''};
      editingId=reportId;draft.window={kind:'custom',from:'',to:'',...draft.window};draft.participants||=[];draft.title||='';
      render();return true;
    }
    return {open,cancel,close:cancel,apply,render,state:()=>draft?copy(draft):null,isOpen:()=>!!draft,desktopCloseStatus:()=>({busy,dirty:!!draft})};
  }
  root.RingsideTeamSelection={create,candidates,resolveSelection,memberGroups};
})(window);
