(function(root){
  "use strict";
  const copy=v=>JSON.parse(JSON.stringify(v)),E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]));
  const option=(v,label,current)=>`<option value="${E(v)}"${v===current?' selected':''}>${E(label)}</option>`,eligible=a=>!!a&&!a.deletedAt&&!a.deleted&&!a.archived&&!a.demo&&!a.sample;
  const uid=()=>"team-object-"+(root.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  const modes=[["single","单次报告"],["horizontal","横向比较"],["longitudinal","纵向比较"]],defaultTitle="损伤风险筛查与运动表现测试报告";
  const field=(label,html)=>`<label class="field"><span>${E(label)}</span>${html}</label>`;
  function validDate(value){return root.RingsideLongitudinalStore?.validDate?.(value)??(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value)));}
  function candidates(athlete,window={}){
    const from=window?.from||"",to=window?.to||"";if(from&&!validDate(from)||to&&!validDate(to)||from&&to&&from>to)return [];
    return (athlete?.records||[]).filter(r=>eligible(r)&&validDate(r.athlete?.date)&&(!from||r.athlete.date>=from)&&(!to||r.athlete.date<=to)).sort((a,b)=>b.athlete.date.localeCompare(a.athlete.date)||String(a.recordId).localeCompare(String(b.recordId)));
  }
  function resolveSelection(athlete,window,recordId=""){
    const records=candidates(athlete,window),kept=records.find(r=>r.recordId===recordId);if(kept)return {recordId:kept.recordId,records,ambiguous:false};
    const latest=records.filter(r=>r.athlete.date===records[0]?.athlete.date);return {recordId:latest.length===1?latest[0].recordId:"",records,ambiguous:latest.length>1};
  }
  function memberGroups(athletes,groups=[],groupId="",query=""){
    const q=query.trim().toLocaleLowerCase(),known=new Set(groups.map(g=>g.id)),people=athletes.filter(a=>eligible(a)&&(!q||[a.name||a.profile?.name,a.id].join(' ').toLocaleLowerCase().includes(q)));
    return [...groups.filter(g=>g.id===groupId),...groups.filter(g=>g.id!==groupId),{id:'',name:'未分组'}].map(group=>({...group,own:!!groupId&&group.id===groupId,people:people.filter(a=>group.id?a.groupId===group.id:!known.has(a.groupId))})).filter(group=>group.people.length);
  }
  function create(host){
    let node=null,draft=null,editingId=null,busy=false,query="",error="",ticket=0,panel="members",step=null,objectId="",referenceEditor=null,conflicts=[];
    const library=()=>host.library(),available=()=>(library().athletes||[]).filter(eligible),analysis=()=>draft?.analysisMode||"single",name=a=>a?.name||a?.profile?.name||'人员不可用';
    const activeObject=()=>draft?.objects?.find(object=>object.id===objectId&&object.kind==="team")||null,memberOwner=()=>analysis()==="horizontal"?activeObject():draft;
    const references=()=>draft?.objects?.filter(object=>object.kind==="reference").map(object=>({...object.reference,id:object.id}))||[];
    function number(id,people){const short=id.slice(-6);return people.filter(a=>a.id.slice(-6)===short).length>1?id:short;}
    function notify(){host.onChange?.({step,status:busy?"busy":validation(draft,available(),step||4)?.message||"ready"});}
    function changed(){error="";conflicts=[];ticket++;host.cancelPending?.();render();notify();}
    function syncLongitudinal(){
      const ids=(draft.participants||[]).map(person=>person.athleteId),prior=draft.dateParticipants||[];draft.athleteIds=ids;
      draft.dates=(draft.dates||[]).filter(date=>(!draft.window.from||date>=draft.window.from)&&(!draft.window.to||date<=draft.window.to)).sort();
      draft.dateParticipants=draft.dates.map(date=>({date,participants:ids.map(athleteId=>{const person=prior.find(item=>item.date===date)?.participants.find(item=>item.athleteId===athleteId),rows=candidates(available().find(a=>a.id===athleteId),{from:date,to:date});return {athleteId,recordId:person&&rows.some(row=>row.recordId===person.recordId)?person.recordId:rows.length===1?rows[0].recordId:""};})}));
    }
    function syncRecords(){for(const owner of [draft,...(draft.objects||[]).filter(object=>object.kind==="team")])for(const person of owner.participants||[])person.recordId=resolveSelection(available().find(a=>a.id===person.athleteId),draft.window,person.recordId).recordId;if(analysis()==="longitudinal")syncLongitudinal();}
    function cancel(){ticket++;busy=false;referenceEditor?.cancel();draft=null;editingId=null;query="";error="";panel="members";objectId="";conflicts=[];step=null;if(node)node.innerHTML="";node=null;return true;}
    async function userCancel(){if(!draft)return false;cancel();await host.onCancel?.();return true;}
    function validation(value,people,at=4){
      if(!value)return {message:"请选择报告内容。",panel:"members"};const kind=value.analysisMode||"single",objects=value.objects||[],roster=kind==="horizontal"?objects.filter(object=>object.kind==="team").flatMap(object=>object.participants||[]):value.participants||[];
      if(kind==="horizontal"){
        if(!objects.length)return {message:"请添加队伍、当前成员组或参考群体。",panel:"members"};
        if(!objects.some(object=>object.kind==="reference")&&objects.length<2)return {message:"横向比较请添加至少两个团队对象，或添加参考群体。",panel:"members"};
        if(objects.some(object=>object.kind==="team"&&!object.participants?.length))return {message:"请为每个团队对象选择成员。",panel:"members"};
      }else if(!roster.length)return {message:"请至少选择一名运动员。",panel:"members"};
      if(roster.some(person=>!people.some(a=>a.id===person.athleteId)))return {message:"部分成员已归档或移除，请调整报告名单。",panel:"members"};if(at===2)return null;
      const from=value.window?.from||"",to=value.window?.to||"";if(from&&!validDate(from)||to&&!validDate(to)||from&&to&&from>to)return {message:"请检查日期范围，开始日期不能晚于结束日期。",panel:"records"};
      if(kind==="longitudinal"){
        if((value.dates||[]).length<2)return {message:"纵向比较请至少选择两个测试日期。",panel:"records"};
        for(const date of value.dates)for(const person of value.dateParticipants?.find(item=>item.date===date)?.participants||[]){const rows=candidates(people.find(a=>a.id===person.athleteId),{from:date,to:date});if(rows.length>1&&!person.recordId)return {message:"同一天有多条测试记录，请为该成员明确选择一条。",panel:"records"};if(person.recordId&&!rows.some(row=>row.recordId===person.recordId))return {message:"部分测试记录已不可用，请重新选择。",panel:"records"};}
      }else if(roster.some(person=>{const rows=candidates(people.find(a=>a.id===person.athleteId),value.window);return rows.length&&!person.recordId||person.recordId&&!rows.some(row=>row.recordId===person.recordId);}))return {message:"请为有测试记录的运动员指定一条有效记录。",panel:"records"};return null;
    }
    function validateStep(value=step){const issue=validation(draft,available(),value||4);if(issue){error=issue.message;render();}return {valid:!issue,message:issue?.message||""};}
    function setStep(value){if(![2,3,4].includes(value))return false;step=value;panel=value===2?"members":"records";error="";render();return true;}
    function editor(){
      if(!referenceEditor)referenceEditor=root.RingsideReportSelection.createReferenceEditor({library,referenceDialogId:"teamReportReferenceDialog",manage:host.manage,onChange:refs=>{
        if(!draft)return;const pending=new Map(refs.map(reference=>[reference.id,reference]));draft.objects=(draft.objects||[]).map(object=>{if(object.kind!=="reference")return object;const reference=pending.get(object.id);pending.delete(object.id);return reference?{...object,label:reference.label||"参考群体",reference}:null;}).filter(Boolean);draft.objects.push(...[...pending.values()].map(reference=>({id:reference.id,kind:"reference",label:reference.label||"参考群体",reference})));changed();
      }});return referenceEditor;
    }
    function showConflicts(value){conflicts=copy(value||[]);if(conflicts.length){error="请为参考群体选择共同适用的评价标准。";render();editor().showConflicts(conflicts,references());}return !!conflicts.length;}
    async function apply(){
      if(!draft||busy)return false;const value=copy(draft),issue=validation(value,available());if(issue){error=issue.message;panel=issue.panel;render();return false;}
      const sequence=++ticket,reportId=editingId,current=()=>!!draft&&ticket===sequence;busy=true;error="";render();notify();value.reportTitle=(value.reportTitle??value.title??"").trim();
      try{
        if(value.analysisMode==="horizontal")for(const object of value.objects||[])if(object.kind==="reference")object.reference=root.RingsideHorizontalSetup.resolveReferences([{...object.reference,id:object.id}],{athletes:library().athletes,classifications:root.RingsideClassifications.normalize(library().classifications||{}),groups:library().groups||[]})[0];
        const ok=await host.select(value,{reportId,isCurrent:current});if(!current())return false;if(!ok){if(!conflicts.length)error="报告尚未生成，请检查页面提示后重试。";return false;}await host.onApplied?.();if(current())cancel();return true;
      }catch(e){if(current())error=e.message||String(e);return false;}finally{if(current()){busy=false;render();notify();}}
    }
    function memberHTML(people,groups,disabled){
      const owner=memberOwner();if(!owner)return "";const chosen=new Set((owner.participants||[]).map(person=>person.athleteId));
      return `<div class="team-member-search">${field('队伍',`<select data-team-field="groupId"${disabled}>${option('','自选成员',owner.groupId||'')}${groups.map(group=>option(group.id,group.name,owner.groupId)).join('')}</select>`)}${field('搜索成员',`<input type="search" data-team-search value="${E(query)}" placeholder="搜索姓名或编号" aria-label="搜索团队报告成员">`)}</div>`+memberGroups(people,groups,owner.groupId,query).map(group=>`<section class="team-member-group" data-team-member-group="${E(group.id)}"${group.own?' data-team-own-group="true"':''}><h3>${E(group.name)} <small>${group.people.length} 人${group.own?' · 本队':''}</small></h3><div class="team-member-options">${group.people.map(a=>`<label><input type="checkbox" data-team-person="${E(a.id)}"${chosen.has(a.id)?' checked':''}${disabled}><span>${E(name(a))}<small>编号 ${E(number(a.id,people))}</small></span></label>`).join('')}</div></section>`).join('');
    }
    function recordHTML(people,owner,disabled,date=""){
      return (owner.participants||[]).map(person=>{const a=people.find(a=>a.id===person.athleteId),resolved=resolveSelection(a,date?{from:date,to:date}:draft.window,person.recordId),attributes=`data-team-record="${E(person.athleteId)}"${date?` data-team-date="${E(date)}"`:""}${owner.id?` data-team-object="${E(owner.id)}"`:""}`;
        return `<section class="team-record-person"><div class="team-record-heading"><h3>${E(name(a))}<small>编号 ${E(number(person.athleteId,people))}</small></h3></div>${resolved.records.length?field('测试记录',`<select ${attributes} aria-label="${E(name(a))}${date?' '+E(date):''}的测试记录"${disabled}>${option('',resolved.ambiguous?'同日有多条记录，请选择':'请选择记录',person.recordId)}${resolved.records.map(record=>option(record.recordId,`${record.athlete.date} · ${record.title||'测试记录'} · ${record.recordId.slice(-6)}`,person.recordId)).join('')}</select>`):'<p class="note">无测试记录，报告中保留缺测。</p>'}</section>`;
      }).join('');
    }
    function objectHTML(groups,disabled){
      return `<div class="team-object-actions">${field('添加已有队伍',`<select data-team-add-group${disabled}>${option('','请选择队伍','')}${groups.map(group=>option(group.id,group.name,'')).join('')}</select>`)}<button type="button" class="btn" data-team-add-custom${disabled}>添加当前成员组</button><button type="button" class="btn" data-team-add-reference${disabled}>添加参考群体</button></div><div class="team-object-list">${(draft.objects||[]).map(object=>`<article class="team-object${object.id===objectId?' active':''}"><button type="button" class="team-object-open" data-team-open-object="${E(object.id)}"><strong>${E(object.label||'未命名成员组')}</strong><span>${object.kind==='reference'?'参考群体 · '+E({latest:'最近可比测试','period-record':'期间最佳成绩','period-mean':'期间均值'}[object.reference?.sampling]||'最近可比测试'):(object.participants?.length||0)+' 名成员'}</span></button><button type="button" class="text-btn" data-team-remove-object="${E(object.id)}" aria-label="移除 ${E(object.label||'成员组')}">移除</button></article>`).join('')||'<p class="empty">添加本次要比较的队伍、成员组或参考群体。</p>'}</div>${activeObject()?field('成员组名称',`<input data-team-object-label value="${E(activeObject().label||'')}"${disabled}>`):''}`;
    }
    function render(){
      if(!node||!draft)return;const focused=root.document.activeElement,keys=['data-team-field','data-team-person','data-team-record','data-team-search','data-report-title','data-team-object-label'],focusKey=node.contains?.(focused)?keys.find(key=>focused.hasAttribute(key)):null,focusValue=focusKey?focused.getAttribute(focusKey):null,position=focused?.selectionStart;
      const scroll=node.querySelector('.team-selection-content')?.scrollTop||0,people=available(),groups=library().groups||[],disabled=busy?' disabled':'',kind=analysis(),issue=validation(draft,people,step||4),status=error||(busy?'正在生成团队报告…':step?'':issue?.message||'测试记录已选定。');
      const dateFields=`<div class="team-selection-settings team-date-fields">${field('开始日期',`<input type="date" data-team-field="from" value="${E(draft.window.from)}"${disabled}>`)}${field('结束日期',`<input type="date" data-team-field="to" value="${E(draft.window.to)}"${disabled}>`)}</div>`;
      let records="";
      if(kind==='longitudinal'){
        const dates=[...new Set(draft.participants.flatMap(person=>candidates(people.find(a=>a.id===person.athleteId),draft.window).map(record=>record.athlete.date)))].sort();
        records=`<div class="team-date-options">${dates.map(date=>`<label><input type="checkbox" data-team-select-date="${E(date)}"${draft.dates.includes(date)?' checked':''}${disabled}><span>${E(date)}</span></label>`).join('')||'<p class="empty">所选成员暂无测试记录。</p>'}</div><p class="note">选择至少两个测试日期；缺测成员保留在名单中。</p>`+draft.dateParticipants.map(item=>`<section class="team-date-records"><h3>${E(item.date)}</h3><div class="team-record-options">${recordHTML(people,item,disabled,item.date)}</div></section>`).join('');
      }else if(kind==='horizontal')records=(draft.objects||[]).map(object=>object.kind==='reference'?`<section class="selection-review-item"><strong>${E(object.label||'参考群体')}</strong><span>${E([object.reference?.window?.from,object.reference?.window?.to].filter(Boolean).join(' — ')||'全部历史')} · ${E({latest:'最近可比测试','period-record':'期间最佳成绩','period-mean':'期间均值'}[object.reference?.sampling]||'最近可比测试')}</span><button type="button" class="text-btn" data-team-open-object="${E(object.id)}">修改群体</button></section>`:`<section class="team-date-records"><h3>${E(object.label||'成员组')}</h3><div class="team-record-options">${recordHTML(people,object,disabled)}</div></section>`).join('');
      else records=`<div class="team-record-options">${recordHTML(people,draft,disabled)}</div>`;
      const review=kind==='horizontal'?(draft.objects||[]).map(object=>`<div class="selection-review-item"><strong>${E(object.label||'成员组')}</strong><span>${object.kind==='reference'?'参考群体':(object.participants?.length||0)+' 名成员'}</span></div>`).join(''):`<div class="selection-review-item"><span>报告成员</span><strong>${draft.participants.length} 人</strong></div><div class="selection-review-item"><span>${kind==='longitudinal'?'测试日期':'测试记录'}</span><strong>${E(kind==='longitudinal'?draft.dates.join('、'):draft.participants.filter(person=>person.recordId).length+' 人已选，'+draft.participants.filter(person=>!person.recordId).length+' 人缺测')}</strong></div>`;
      const settings=`<section class="team-review-settings" data-team-panel="review"${step===4?'':' hidden'}><h2>核对报告内容</h2><div class="selection-review-item"><span>分析方式</span><strong>${E(modes.find(([id])=>id===kind)?.[1])}</strong></div>${review}<div class="team-selection-settings">${field('代表结果',`<select data-team-field="mode"${disabled}>${option('best','最佳试次',draft.mode)}${option('mean','试次均值',draft.mode)}</select>`)}${field('评价方案',`<select data-team-field="profileId"${disabled}>${option('','不使用评价方案',draft.profileId)}${(library().evaluationProfiles||[]).filter(profile=>!profile.disabled||profile.id===draft.profileId).map(profile=>option(profile.id,profile.name,draft.profileId)).join('')}</select>`)}${field('报告名称',`<input data-report-title data-team-field="title" value="${E(draft.reportTitle??draft.title??'')}" placeholder="${defaultTitle}"${disabled}>`)}</div></section>`;
      node.innerHTML=`<form novalidate class="team-selection-form${step?' report-selection-stepped':''}" aria-label="团队报告选择"><div class="team-selection-actions"${step?' hidden':''}><div class="selection-row"><button type="button" class="selection-trigger" data-team-toggle="members">队伍与成员</button><button type="button" class="selection-trigger" data-team-toggle="records">测试记录</button><div class="selection-submit"><button type="submit" class="btn primary small" data-team-apply${disabled}>查看团队报告</button><button type="button" class="btn small" data-team-cancel>取消</button></div></div></div><div class="team-selection-content"><section class="selection-panel" data-team-panel="members"${step?step===2?'':' hidden':panel==='members'?'':' hidden'}><div class="team-analysis-field">${field('分析方式',`<select data-team-analysis aria-label="分析方式">${modes.map(([id,label])=>option(id,label,kind)).join('')}</select>`)}</div>${kind==='horizontal'?objectHTML(groups,disabled):''}${memberHTML(people,groups,disabled)}</section><section class="selection-panel" data-team-panel="records"${step?step===3?'':' hidden':panel==='records'?'':' hidden'}><h2>测试记录</h2>${dateFields}${records}</section>${settings}</div><p class="selection-status${error?' field-error':''}" role="status" aria-live="polite" data-team-selection-error>${E(status)}</p></form>`;
      node.querySelectorAll('[data-team-cancel]').forEach(el=>el.onclick=userCancel);node.querySelectorAll('[data-team-toggle]').forEach(el=>el.onclick=()=>{panel=el.dataset.teamToggle;render();});
      node.querySelector('[data-team-analysis]')?.addEventListener('change',event=>{if(busy)return;draft.analysisMode=event.target.value;if(analysis()==='longitudinal')syncLongitudinal();changed();});
      node.querySelectorAll('[data-team-field]').forEach(el=>el.onchange=()=>{
        if(busy||!draft)return;const key=el.dataset.teamField;
        if(key==='from'||key==='to'){draft.window[key]=el.value;syncRecords();}
        else if(key==='groupId'){const owner=memberOwner();if(!owner)return;const previous=new Map(owner.participants.map(person=>[person.athleteId,person]));owner.groupId=el.value;if(el.value)owner.participants=people.filter(a=>a.groupId===el.value).map(a=>previous.get(a.id)||{athleteId:a.id,recordId:''});if(owner!==draft&&el.value)owner.label=groups.find(group=>group.id===el.value)?.name||owner.label;syncRecords();}
        else if(key==='title'){draft.reportTitle=el.value.trim();}else draft[key]=el.value;changed();
      });
      const search=node.querySelector('[data-team-search]');if(search)search.oninput=event=>{query=event.target.value;render();};
      node.querySelectorAll('[data-team-person]').forEach(el=>el.onchange=()=>{if(busy||!draft)return;const owner=memberOwner();if(!owner)return;const id=el.dataset.teamPerson;if(el.checked&&!owner.participants.some(person=>person.athleteId===id))owner.participants.push({athleteId:id,recordId:resolveSelection(people.find(a=>a.id===id),draft.window).recordId});else if(!el.checked)owner.participants=owner.participants.filter(person=>person.athleteId!==id);if(kind==='longitudinal')syncLongitudinal();changed();});
      node.querySelectorAll('[data-team-record]').forEach(el=>el.onchange=()=>{if(busy||!draft)return;const owner=el.dataset.teamDate?draft.dateParticipants.find(item=>item.date===el.dataset.teamDate):el.dataset.teamObject?draft.objects.find(item=>item.id===el.dataset.teamObject):draft,person=owner?.participants.find(item=>item.athleteId===el.dataset.teamRecord);if(person)person.recordId=el.value;changed();});
      node.querySelectorAll('[data-team-select-date]').forEach(el=>el.onchange=()=>{if(busy)return;draft.dates=el.checked?[...new Set([...draft.dates,el.dataset.teamSelectDate])]:draft.dates.filter(date=>date!==el.dataset.teamSelectDate);syncLongitudinal();changed();});
      function addObject(groupId=''){const group=groups.find(item=>item.id===groupId),object={id:uid(),kind:'team',label:group?.name||'当前成员组',groupId,participants:group?people.filter(a=>a.groupId===groupId).map(a=>({athleteId:a.id,recordId:resolveSelection(a,draft.window).recordId})):[]};draft.objects.push(object);objectId=object.id;query='';changed();}
      node.querySelector('[data-team-add-group]')?.addEventListener('change',event=>{if(event.target.value&&!busy)addObject(event.target.value);});node.querySelector('[data-team-add-custom]')?.addEventListener('click',()=>{if(!busy)addObject();});node.querySelector('[data-team-add-reference]')?.addEventListener('click',()=>{if(!busy)editor().open(references());});
      node.querySelectorAll('[data-team-open-object]').forEach(button=>button.onclick=()=>{const object=draft.objects.find(item=>item.id===button.dataset.teamOpenObject);if(object.kind==='reference')editor().open(references(),object.id);else{objectId=object.id;query='';render();}});
      node.querySelectorAll('[data-team-remove-object]').forEach(button=>button.onclick=()=>{if(busy)return;draft.objects=draft.objects.filter(object=>object.id!==button.dataset.teamRemoveObject);if(objectId===button.dataset.teamRemoveObject)objectId='';changed();});
      const objectLabel=node.querySelector('[data-team-object-label]');if(objectLabel)objectLabel.onchange=()=>{if(activeObject())activeObject().label=objectLabel.value.trim();changed();};const form=node.querySelector('form');if(form)form.onsubmit=event=>{event.preventDefault();return apply();};const content=node.querySelector('.team-selection-content');if(content)content.scrollTop=scroll;
      if(focusKey){const escaped=String(focusValue).replace(/["\\]/g,'\\$&'),restored=node.querySelector(`[${focusKey}="${escaped}"]`);restored?.focus({preventScroll:true});if(position!=null&&typeof restored?.setSelectionRange==='function'&&['search','text'].includes(restored.type))restored.setSelectionRange(position,position);}
    }
    async function open(configuration=null,{reportId=null,step:requestedStep=null}={}){
      cancel();const target=host.element?.();if(!target)return false;node=target;draft=configuration?copy(configuration):{groupId:'',participants:[],window:{kind:'custom',from:'',to:''},mode:'best',profileId:library().defaultEvaluationProfileId||'',title:''};
      editingId=reportId;step=[2,3,4].includes(requestedStep)?requestedStep:null;draft.window={kind:'custom',from:'',to:'',...draft.window};draft.participants||=(draft.athleteIds||[]).map(athleteId=>({athleteId,recordId:''}));draft.title||='';draft.reportTitle=draft.reportTitle??draft.views?.reportTitle??(draft.titleAuto===false?draft.title:null)??root.RingsideReportTitle?.defaultTitle??defaultTitle;draft.objects||=[];draft.dates||=[];draft.dateParticipants||=[];objectId=draft.objects.find(object=>object.kind==='team')?.id||'';if(analysis()==='longitudinal')syncLongitudinal();render();return true;
    }
    return {open,cancel,close:cancel,apply,render,setStep,validateStep,getStep:()=>step,showConflicts,state:()=>draft?copy(draft):null,get:()=>draft?copy(draft):null,isOpen:()=>!!draft,isPending:()=>busy,desktopCloseStatus:()=>({busy,dirty:!!draft})};
  }
  root.RingsideTeamSelection={create,candidates,resolveSelection,memberGroups};
})(window);
