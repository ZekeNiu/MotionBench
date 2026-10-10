(function(root){
  "use strict";
  const M=root.RingsideModel,T=root.RingsideTests,$=id=>document.getElementById(id),copy=v=>JSON.parse(JSON.stringify(v));
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  let session=null,serial=0,busy=false;
  const lib=()=>root.App.getLibrary();
  const personLabel=entry=>{const owner=lib().athletes.find(a=>a.id===entry.athleteId);return [entry.name,owner?.profile?.sport,entry.athleteId.slice(-6)].filter(Boolean).join(" · ");};
  function error(message){$("excelError").textContent=message;$("excelError").hidden=!message;}
  function setBusy(value){busy=value;$("excelModal").setAttribute("aria-busy",String(value));document.querySelectorAll("#excelModal button,#excelModal input,#excelModal select,[data-entry-excel-action]").forEach(el=>{if(value){el.dataset.excelWasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.excelWasDisabled!==undefined){el.disabled=el.dataset.excelWasDisabled==="true";delete el.dataset.excelWasDisabled;}});}
  function importControl(){return '<label class="btn primary excel-file">选择 Excel 文件<input id="excelFile" type="file" accept=".xlsx" onchange="RingsideExcelFlow.readFile(this.files[0]);this.value=\'\'"></label>';}
  function openImport({mode="entry",records=[]}={}){
    if(busy)return false;
    if(!records.length)throw Error("请先选择本次测试记录");
    session={token:++serial,mode,records:copy(records),stage:"setup"};
    error("");$("excelTitle").textContent="导入 Excel 文件";
    renderImportSetup();root.App.modal("excelModal");return true;
  }
  function renderImportSetup(){
    const records=session.records;session.stage="setup";
    $("excelContent").innerHTML=`<p class="intro">本次录入 ${records.length} 名运动员</p><div class="excel-import-summary">${records.map(record=>`<section><h3>${esc(personLabel({athleteId:record.athleteId,name:record.athlete.name}))} · ${esc(record.athlete.date)}</h3><p>${T.describe(record).filter(t=>record.enabled[t.id]).map(t=>esc(t.name)).join("、")}</p>${record.enabled.iso?`<p class="note">等长力量：${M.selectedIsoRows(record).map(r=>esc((M.REG[r.region]||r.region)+" "+r.direction)).join("、")}</p>`:""}</section>`).join("")}</div><p class="note">选择填写好的 .xlsx 文件，核对变化后再保存。已有测量默认保留，可逐项选择替换。</p>`;
    $("excelFooter").innerHTML='<button type="button" class="btn" onclick="App.close(\'excelModal\')">取消</button>'+importControl();
  }
  async function downloadTemplate({records=[],prefill=true}={}){
    if(busy)return false;
    if(!records.length)throw Error("请先选择本次测试记录");
    try{
      setBusy(true);const result=await root.RingsideExcel.createTemplate({records:copy(records),prefill});
      const url=URL.createObjectURL(new Blob([result.bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})),link=document.createElement("a");link.href=url;link.download=result.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return result;
    }finally{setBusy(false);}
  }
  async function readFile(file){
    if(!file||busy||!session)return;const token=session.token;error("");
    delete session.preview;delete session.checks;delete session.directory;delete session.fileName;session.decisions={};renderImportSetup();
    try{
      setBusy(true);const parsed=await root.RingsideExcel.readTemplate(await file.arrayBuffer());if(!session||session.token!==token)return;
      if(session.mode==="edit"&&parsed.targets.some(t=>t.recordId!==session.records[0].recordId))throw Error("此模板不属于当前测试记录。请进入对应记录的按项目录入页面导入。");
      const athleteIds=new Set(session.records.map(record=>record.athleteId));
      if(session.mode==="entry"&&parsed.targets.some(t=>!athleteIds.has(t.athleteId)))throw Error("此文件包含本次名单之外的运动员，请返回选择运动员步骤后重新选择。");
      const repo=root.App.getRepository();await repo.flush();
      const targets=parsed.targets||[],stored=await Promise.all(targets.map(t=>repo.loadRecord(t.recordId))),config=await repo.get("config","library"),athletes=await Promise.all([...new Set(targets.map(t=>t.athleteId))].map(async id=>[id,await repo.get("athletes",id)]));
      const directory=await repo.directory();if(!session||session.token!==token)return;
      const preview=root.RingsideExcel.preview(parsed,{athletes:directory.athletes,catalog:directory.catalog,records:stored.filter(Boolean)});
      session.preview=preview;session.directory=directory;session.decisions={};session.checks={expectedConfig:JSON.stringify(config??null),expectedRecords:Object.fromEntries(targets.map((t,i)=>[t.recordId,JSON.stringify(stored[i]??null)])),expectedAthletes:Object.fromEntries(athletes.map(([id,a])=>[id,JSON.stringify(a??null)]))};
      session.fileName=file.name;renderPreview();
    }catch(e){error(e.message);}finally{setBusy(false);}
  }
  function changesList(changes){return '<ul>'+changes.map(c=>`<li>${esc(c.label)}：${esc((c.displayBefore??c.before)===""?"未填":c.displayBefore??c.before)} → ${esc((c.displayAfter??c.after)===""?"未填":c.displayAfter??c.after)}</li>`).join("")+'</ul>';}
  function settingsPreview(entry){return entry.settingsChanges?.length?`<details class="supplement"><summary>共用参数与显示设置有 ${entry.settingsChanges.length} 项差异</summary>${changesList(entry.settingsChanges)}<label class="field"><span>共用参数与显示设置</span><select data-excel-settings="${esc(entry.recordId)}" onchange="RingsideExcelFlow.decideSettings(this)"><option value="keep">保留现有设置</option><option value="replace">采用 Excel 设置</option></select></label><p class="note">共用设置单独确认，测量项目的替换选择分别保存。</p></details>`:"";}
  function conditionsPreview(entry,project){
    const changes=project.conditionChanges||[],issues=project.readiness||[];
    const conditions=changes.length?`<details class="supplement"><summary>测试参数有 ${changes.length} 项变化</summary>${changesList(changes)}${entry.acquisition?`<label class="field"><span>测试参数</span><select data-excel-record="${esc(entry.recordId)}" data-excel-project="${esc(project.id)}" onchange="RingsideExcelFlow.decideConditions(this)"><option value="keep">保留现有参数</option><option value="replace">采用 Excel 参数</option></select></label><p class="note">参数可单独更新，不替换测量。</p>`:'<p class="note">采用 Excel 测量时一并替换这些测试条件。</p>'}</details>`:"";
    return conditions+(issues.length?`<details class="supplement" open><summary>尚缺计算条件</summary><ul>${issues.map(issue=>`<li>${esc(issue.message)}</li>`).join("")}</ul><p class="note">可先保存原始测量，补全后再计算。</p></details>`:"");
  }
  function renderPreview(){
    const preview=session.preview;session.stage="preview";
    const errors=(preview.errors||[]).map(e=>`<li>${esc([e.sheet,e.address||[e.row,e.column].filter(Boolean).join(":"),e.message].filter(Boolean).join(" · "))}</li>`).join("");
    $("excelContent").innerHTML=`<p class="intro">${esc(session.fileName)} · ${preview.entries.length} 条测试记录</p>${errors?`<div class="excel-errors" role="alert"><strong>请修正以下内容后重新导入，当前资料尚未更改。</strong><ul>${errors}</ul></div>`:""}<div class="excel-preview">${preview.entries.map(entry=>`<section class="excel-preview-record"><h3>${esc(personLabel(entry))} · ${esc(entry.date)} <span class="pill">${entry.existing?"核对已有记录":"新建记录"}</span></h3><table><thead><tr><th>测试项目</th><th>现有测量条数</th><th>Excel 测量条数</th><th>导入方式</th></tr></thead><tbody>${entry.projects.map(project=>`<tr><td data-label="测试项目">${esc(project.name)}${conditionsPreview(entry,project)}</td><td data-label="现有测量">${project.oldCount}</td><td data-label="Excel 测量">${project.newCount}</td><td data-label="导入方式">${project.identical?"数据相同，无需更新":!project.hasIncoming?"空白，保留现有数据":`<select aria-label="${esc(entry.name+" "+project.name+" 导入方式")}" data-excel-record="${esc(entry.recordId)}" data-excel-project="${esc(project.id)}" onchange="RingsideExcelFlow.decideProject(this)"><option value="keep" ${project.defaultAction==="keep"?"selected":""}>保留现有</option><option value="replace" ${project.defaultAction==="replace"?"selected":""}>${project.oldCount?"替换为 Excel":"导入 Excel"}</option></select>`}</td></tr>`).join("")}</tbody></table>${entry.metadataChanges.length?`<details class="supplement"><summary>日期与身体资料有 ${entry.metadataChanges.length} 项差异</summary><ul>${entry.metadataChanges.map(c=>`<li>${esc(c.label)}：${esc(c.before===""?"未填":c.before)} → ${esc(c.after===""?"未填":c.after)}</li>`).join("")}</ul><label class="field"><span>日期与身体资料</span><select data-excel-record="${esc(entry.recordId)}" onchange="RingsideExcelFlow.decideMetadata(this)"><option value="keep">保留现有资料</option><option value="replace">采用 Excel 资料</option></select></label></details>`:""}${settingsPreview(entry)}</section>`).join("")}</div><p class="note">替换项目会采用 Excel 中的整组测量，不追加重复试次。空白项目保留原值；等长力量只替换模板选中的方向。</p>`;
    $("excelFooter").innerHTML='<button class="btn" onclick="App.close(\'excelModal\')">取消</button><div class="row">'+importControl()+`<button id="excelConfirm" class="btn primary" ${preview.errors.length?"disabled":""} onclick="RingsideExcelFlow.confirm()">确认导入</button></div>`;
  }
  function decideProject(el){((session.decisions[el.dataset.excelRecord]||={}).projects||={})[el.dataset.excelProject]=el.value;}
  function decideConditions(el){((session.decisions[el.dataset.excelRecord]||={}).conditions||={})[el.dataset.excelProject]=el.value;}
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
  function cancel(){if(busy)return false;serial++;session=null;$("excelContent").replaceChildren();$("excelFooter").replaceChildren();error("");return true;}
  root.RingsideExcelFlow={open:openImport,openImport,cancel,isBusy:()=>busy,downloadTemplate,readFile,decideProject,decideConditions,decideMetadata,decideSettings,confirm};
})(window);
