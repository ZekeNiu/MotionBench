(function(root){
  "use strict";
  const M=root.RingsideModel,T=root.RingsideTests,$=id=>document.getElementById(id),copy=v=>JSON.parse(JSON.stringify(v));
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  let session=null,serial=0,busy=false;
  const lib=()=>root.App.getLibrary();
  const personLabel=entry=>{const owner=lib().athletes.find(a=>a.id===entry.athleteId);return [entry.name,owner?.profile?.sport,entry.athleteId.slice(-6)].filter(Boolean).join(" · ");};
  const date=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  function error(message){$("excelError").textContent=message;$("excelError").hidden=!message;}
  function setBusy(value){busy=value;$("excelModal").setAttribute("aria-busy",String(value));$("excelModal").querySelectorAll("button,input,select").forEach(el=>{if(value){el.dataset.excelWasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.excelWasDisabled!==undefined){el.disabled=el.dataset.excelWasDisabled==="true";delete el.dataset.excelWasDisabled;}});}
  function importControl(){return '<label class="btn excel-file">选择填写好的 Excel<input id="excelFile" type="file" accept=".xlsx" onchange="RingsideExcelFlow.readFile(this.files[0]);this.value=\'\'"></label>';}
  function downloadControl(){return '<button type="button" class="btn primary" onclick="RingsideExcelFlow.downloadTemplate()">下载 Excel 模板</button>';}
  async function open({mode="batch",records=null}={}){
    if(busy)return;
    session={token:++serial,mode,records,stage:"setup",selected:new Set(),selection:{testIds:[],isoDirectionIds:[]},planId:"",profileId:lib().defaultEvaluationProfileId};
    error("");$("excelTitle").textContent=mode==="edit"?"补录本次测试 · Excel":mode==="creation"?"本次测试 · Excel":"多人 Excel 录入";
    renderSetup();root.App.modal("excelModal");
  }
  function renderSetup(){
    if(!session)return;session.stage="setup";
    $("excelFooter").innerHTML='<button class="btn" onclick="App.close(\'excelModal\')">取消</button><div class="row">'+importControl()+downloadControl()+'</div>';
    if(session.records){
      const record=session.records[0],projects=T.describe(record).filter(t=>record.enabled[t.id]);
      $("excelContent").innerHTML=`<p class="intro">${esc(record.athlete.name)} · ${esc(record.athlete.date)}</p><p>${projects.map(t=>esc(t.name)).join("、")}</p><p class="note">${session.mode==="edit"?"模板包含已有测量。导入时先核对变化，有数据的项目默认保留，可逐项选择替换。":"填写模板后回到这里导入。下载模板不会创建空测试记录。"}</p>${record.enabled.iso?`<p>等长力量：${M.selectedIsoRows(record).map(r=>esc((M.REG[r.region]||r.region)+" "+r.direction)).join("、")}</p>`:""}`;
      return;
    }
    $("excelContent").innerHTML=`<p class="intro">选择已建档运动员和本次项目，下载模板集中填写。</p><div class="form-grid"><label class="field"><span>队伍</span><select id="excelGroup" onchange="RingsideExcelFlow.filterPeople()"><option value="">全部队伍</option>${lib().groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select></label><label class="field"><span>搜索运动员</span><input id="excelPeopleSearch" type="search" placeholder="姓名、专项或编号" oninput="RingsideExcelFlow.filterPeople()"></label></div><div class="row"><button class="btn small" onclick="RingsideExcelFlow.selectPeople(true)">选择筛选结果</button><button class="btn small" onclick="RingsideExcelFlow.selectPeople(false)">清空名单</button><span id="excelPeopleCount" aria-live="polite"></span></div><div id="excelPeople" class="excel-people"></div><div class="form-grid"><label class="field"><span>测试日期</span><input id="excelDate" type="date" value="${date()}"></label><label class="field"><span>测试方案</span><select id="excelPlan" onchange="RingsideExcelFlow.choosePlan(this.value)"><option value="">临时选择项目</option>${lib().testPlans.filter(p=>!p.disabled).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label><label class="field"><span>评价方案</span><select id="excelProfile">${lib().evaluationProfiles.filter(p=>!p.disabled).map(p=>`<option value="${esc(p.id)}" ${p.id===session.profileId?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label></div><h3>本次测试项目</h3><div id="excelProjects"></div>`;
    filterPeople();renderPicker();
  }
  function people(){const q=($("excelPeopleSearch")?.value||"").trim().toLowerCase(),group=$("excelGroup")?.value;return lib().athletes.filter(a=>!a.deletedAt&&!a.archived&&(!group||a.groupId===group)&&(!q||[a.name,a.id,a.profile?.sport].join(" ").toLowerCase().includes(q)));}
  function filterPeople(){if(!session||!$("excelPeople"))return;$("excelPeople").innerHTML=people().map(a=>`<label class="check-line"><input type="checkbox" data-excel-person="${esc(a.id)}" ${session.selected.has(a.id)?"checked":""} onchange="RingsideExcelFlow.choosePerson(this.dataset.excelPerson,this.checked)"><span>${esc(a.name)}<small>${esc(a.profile?.sport||"未填专项")} · ${esc(a.id.slice(-6))}</small></span></label>`).join("")||'<p class="note">没有匹配的运动员，请先在运动员管理中建档。</p>';$("excelPeopleCount").textContent=`已选 ${session.selected.size} 人`;}
  function choosePerson(id,checked){if(checked)session.selected.add(id);else session.selected.delete(id);$("excelPeopleCount").textContent=`已选 ${session.selected.size} 人`;}
  function selectPeople(checked){if(checked)people().forEach(a=>session.selected.add(a.id));else session.selected.clear();filterPeople();}
  function renderPicker(){const options={source:lib().catalog,showOrder:false,context:"excel",selection:session.selection,isoRows:M.isoRows(),blockedIds:lib().catalog.conflicts.filter(c=>!c.resolved).map(c=>c.testId),onChange(next){session.selection=copy(next);}};$("excelProjects").innerHTML=root.RingsidePicker.render(options);root.RingsidePicker.bind($("excelProjects"),options);}
  function choosePlan(id){session.planId=id;const plan=lib().testPlans.find(p=>p.id===id&&!p.disabled);if(plan){session.selection={testIds:plan.testIds.filter(id=>lib().catalog.tests.some(t=>t.id===id&&!t.disabled)&&!lib().catalog.conflicts.some(c=>c.testId===id&&!c.resolved)),isoDirectionIds:plan.isoDirectionIds?[...plan.isoDirectionIds]:plan.testIds.includes("iso")?M.legacyIsoDirectionIds():[]};if(lib().evaluationProfiles.some(p=>p.id===plan.defaultEvaluationProfileId&&!p.disabled))$("excelProfile").value=plan.defaultEvaluationProfileId;renderPicker();if(session.selection.testIds.length!==plan.testIds.length)error("方案中有项目已停用或定义待确认，已排除这些项目，请核对本次选择。");}}
  async function templateRecords(){
    if(session.records)return copy(session.records);
    if(!session.selected.size)throw Error("请至少选择一名已建档运动员");
    if(!$("excelDate").value||!$("excelDate").validity.valid)throw Error("请填写有效测试日期");
    if(!session.selection.testIds.length)throw Error("请至少选择一个测试项目");
    if(session.selection.testIds.some(id=>!lib().catalog.tests.some(t=>t.id===id&&!t.disabled)||lib().catalog.conflicts.some(c=>c.testId===id&&!c.resolved)))throw Error("所选项目已停用或定义待确认，请重新选择");
    if(session.selection.testIds.includes("iso")&&!session.selection.isoDirectionIds.length)throw Error("请至少勾选一个等长力量方向");
    const profile=$("excelProfile").value;if(!lib().evaluationProfiles.some(p=>p.id===profile&&!p.disabled))throw Error("请选择在用评价方案");
    const enabled=Object.fromEntries(lib().catalog.tests.map(t=>[t.id,session.selection.testIds.includes(t.id)])),plan=lib().testPlans.find(p=>p.id===session.planId),records=[];
    for(const id of session.selected){
      const owner=lib().athletes.find(a=>a.id===id&&!a.deletedAt&&!a.archived);if(!owner)throw Error("名单中的运动员已不可用，请重新选择");
      const record=M.recordFromCatalog(lib().catalog,owner.profile,enabled,$("excelDate").value);record.athleteId=id;record.recordId=crypto.randomUUID();record.evaluationProfileId=profile;
      const latest=M.latestRecord({records:owner.records.filter(r=>!r.deletedAt&&!r.archived)}),previous=latest?await root.App.getRepository().loadRecord(latest.recordId):null;
      if(previous)record.trainingContext=copy(previous.trainingContext);
      M.setIsoDirectionSelection(record,session.selection.isoDirectionIds);
      if(plan)record.testPlanSnapshot={id:plan.id,name:plan.name,testIds:[...plan.testIds.filter(id=>enabled[id]),...session.selection.testIds.filter(id=>!plan.testIds.includes(id))],isoDirectionIds:[...record.isoDirectionIds]};
      records.push(record);
    }
    return records;
  }
  async function downloadTemplate(){
    if(busy||!session)return;const token=session.token;error("");
    try{
      setBusy(true);const records=await templateRecords();
      const result=await root.RingsideExcel.createTemplate({records,prefill:session.mode==="edit"});if(!session||session.token!==token)return;
      const url=URL.createObjectURL(new Blob([result.bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})),link=document.createElement("a");link.href=url;link.download=result.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(e){error(e.message);}finally{setBusy(false);}
  }
  async function readFile(file){
    if(!file||busy||!session)return;const token=session.token;error("");
    try{
      setBusy(true);const parsed=await root.RingsideExcel.readTemplate(await file.arrayBuffer());if(!session||session.token!==token)return;
      if(session.mode==="edit"&&parsed.targets.some(t=>t.recordId!==session.records[0].recordId))throw Error("此模板不属于当前测试记录。请从多人 Excel 录入入口导入其他记录。");
      if(session.mode==="creation"&&parsed.targets.some(t=>t.athleteId!==session.records[0].athleteId))throw Error("此模板包含其他运动员，请从多人 Excel 录入入口导入。");
      const repo=root.App.getRepository();await repo.flush();
      const targets=parsed.targets||[],stored=await Promise.all(targets.map(t=>repo.loadRecord(t.recordId))),config=await repo.get("config","library"),athletes=await Promise.all([...new Set(targets.map(t=>t.athleteId))].map(async id=>[id,await repo.get("athletes",id)]));
      const directory=await repo.directory();
      const preview=root.RingsideExcel.preview(parsed,{athletes:directory.athletes,catalog:directory.catalog,records:stored.filter(Boolean)});
      session.preview=preview;session.directory=directory;session.decisions={};session.checks={expectedConfig:JSON.stringify(config??null),expectedRecords:Object.fromEntries(targets.map((t,i)=>[t.recordId,JSON.stringify(stored[i]??null)])),expectedAthletes:Object.fromEntries(athletes.map(([id,a])=>[id,JSON.stringify(a??null)]))};
      session.fileName=file.name;renderPreview();
    }catch(e){error(e.message);}finally{setBusy(false);}
  }
  function changesList(changes){return '<ul>'+changes.map(c=>`<li>${esc(c.label)}：${esc((c.displayBefore??c.before)===""?"未填":c.displayBefore??c.before)} → ${esc((c.displayAfter??c.after)===""?"未填":c.displayAfter??c.after)}</li>`).join("")+'</ul>';}
  function settingsPreview(entry){return entry.settingsChanges?.length?`<details class="supplement"><summary>共用 DSI 设置有 ${entry.settingsChanges.length} 项差异</summary>${changesList(entry.settingsChanges)}<label class="field"><span>共用 DSI 设置</span><select data-excel-settings="${esc(entry.recordId)}" onchange="RingsideExcelFlow.decideSettings(this)"><option value="keep">保留现有设置</option><option value="replace">采用 Excel 设置</option></select></label><p class="note">共用设置单独确认，测量项目的替换选择分别保存。</p></details>`:"";}
  function renderPreview(){
    const preview=session.preview;session.stage="preview";
    const errors=(preview.errors||[]).map(e=>`<li>${esc([e.sheet,e.address||[e.row,e.column].filter(Boolean).join(":"),e.message].filter(Boolean).join(" · "))}</li>`).join("");
    $("excelContent").innerHTML=`<p class="intro">${esc(session.fileName)} · ${preview.entries.length} 条测试记录</p>${errors?`<div class="excel-errors" role="alert"><strong>请修正以下内容后重新导入，当前资料尚未更改。</strong><ul>${errors}</ul></div>`:""}<div class="excel-preview">${preview.entries.map(entry=>`<section class="excel-preview-record"><h3>${esc(personLabel(entry))} · ${esc(entry.date)} <span class="pill">${entry.existing?"核对已有记录":"新建记录"}</span></h3><table><thead><tr><th>测试项目</th><th>现有测量条数</th><th>Excel 测量条数</th><th>导入方式</th></tr></thead><tbody>${entry.projects.map(project=>`<tr><td data-label="测试项目">${esc(project.name)}${project.conditionChanges?.length?`<details class="supplement"><summary>测试条件有 ${project.conditionChanges.length} 项变化</summary>${changesList(project.conditionChanges)}<p class="note">采用 Excel 测量时一并替换这些测试条件。</p></details>`:""}</td><td data-label="现有测量">${project.oldCount}</td><td data-label="Excel 测量">${project.newCount}</td><td data-label="导入方式">${project.identical?"数据相同，无需更新":!project.hasIncoming?"空白，保留现有数据":`<select aria-label="${esc(entry.name+" "+project.name+" 导入方式")}" data-excel-record="${esc(entry.recordId)}" data-excel-project="${esc(project.id)}" onchange="RingsideExcelFlow.decideProject(this)"><option value="keep" ${project.defaultAction==="keep"?"selected":""}>保留现有</option><option value="replace" ${project.defaultAction==="replace"?"selected":""}>${project.oldCount?"替换为 Excel":"导入 Excel"}</option></select>`}</td></tr>`).join("")}</tbody></table>${entry.metadataChanges.length?`<details class="supplement"><summary>日期与身体资料有 ${entry.metadataChanges.length} 项差异</summary><ul>${entry.metadataChanges.map(c=>`<li>${esc(c.label)}：${esc(c.before===""?"未填":c.before)} → ${esc(c.after===""?"未填":c.after)}</li>`).join("")}</ul><label class="field"><span>日期与身体资料</span><select data-excel-record="${esc(entry.recordId)}" onchange="RingsideExcelFlow.decideMetadata(this)"><option value="keep">保留现有资料</option><option value="replace">采用 Excel 资料</option></select></label></details>`:""}${settingsPreview(entry)}</section>`).join("")}</div><p class="note">替换项目会采用 Excel 中的整组测量，不追加重复试次。空白项目保留原值；等长力量只替换模板选中的方向。</p>`;
    $("excelFooter").innerHTML='<button class="btn" onclick="App.close(\'excelModal\')">取消</button><div class="row">'+importControl()+`<button id="excelConfirm" class="btn primary" ${preview.errors.length?"disabled":""} onclick="RingsideExcelFlow.confirm()">确认导入</button></div>`;
  }
  function decideProject(el){((session.decisions[el.dataset.excelRecord]||={}).projects||={})[el.dataset.excelProject]=el.value;}
  function decideMetadata(el){(session.decisions[el.dataset.excelRecord]||={}).metadata=el.value;}
  function decideSettings(el){(session.decisions[el.dataset.excelSettings]||={}).settings=el.value;}
  async function confirm(){
    if(busy||!session?.preview)return;error("");
    try{
      setBusy(true);const result=root.RingsideExcel.apply(session.preview,session.decisions);await root.App.commitExcel(result,session.checks,session.directory);
      session.stage="done";const entries=session.preview.entries;
      $("excelContent").innerHTML=`<p class="intro" role="status">导入完成：新建 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped.length} 条。</p><div class="excel-results">${entries.map(entry=>{const skipped=result.skipped.find(s=>s.recordId===entry.recordId),exists=lib().athletes.find(a=>a.id===entry.athleteId)?.records.some(r=>r.recordId===entry.recordId);return `<div class="excel-result"><span>${esc(personLabel(entry))} · ${esc(entry.date)}${skipped?`<small>${esc(skipped.reason)}</small>`:""}</span>${exists?`<button class="btn" data-excel-open-record="${esc(entry.recordId)}" onclick="App.showExcelRecord('${esc(entry.athleteId)}','${esc(entry.recordId)}')">查看报告</button>`:""}</div>`;}).join("")}</div>`;
      $("excelFooter").innerHTML='<button class="btn" onclick="App.close(\'excelModal\')">完成</button>';
      if(entries.length===1&&result.records.length===1){const record=result.records[0];setBusy(false);await root.App.showExcelRecord(record.athleteId,record.recordId);}
    }catch(e){error(e.message);}finally{setBusy(false);}
  }
  function cancel(){if(busy)return false;const done=session?.stage==="done";serial++;session=null;$("excelContent").replaceChildren();$("excelFooter").replaceChildren();if(done)root.App.showReport();return true;}
  root.RingsideExcelFlow={open,cancel,isBusy:()=>busy,downloadTemplate,readFile,filterPeople,choosePerson,selectPeople,choosePlan,decideProject,decideMetadata,decideSettings,confirm};
})(window);
