(function (root) {
  "use strict";
  const M=root.RingsideModel, Eval=root.RingsideEvaluation, T=root.RingsideTests;
  const $=id=>document.getElementById(id), clone=v=>JSON.parse(JSON.stringify(v));
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid=()=>crypto.randomUUID(), now=()=>new Date().toISOString(), lib=()=>App.getLibrary();
  const sections=[["athletes","运动员管理"],["teams","队伍管理"],["records","测试记录"],["plans","测试方案"],["metrics","指标库"],["profiles","评价方案"],["backup","备份与恢复"]];
  let current="athletes", selected=new Set(), selections={}, filters={}, editor=null, planDraft=null, planBaseline="", formBaseline="", formAction=null, pendingReview=null, busy=false, filterTimer;
  const pathKey=value=>encodeURIComponent(value).replace(/\./g,"%2E");
  const freshFilters=()=>({q:"",group:"",sport:"",status:"active",from:"",to:"",test:"",page:1,sort:"recent",athleteId:"",advanced:false});
  const filter=()=>filters[current] ||= freshFilters();
  const athleteView=()=>current==="athletes"||current==="teams";
  const commit=mutator=>App.commitLibraryChange(mutator);
  function more(content,label="更多"){return `<details class="management-more"><summary>${esc(label)}</summary><div class="management-more-menu">${content}</div></details>`;}
  function stateActions(state,id=""){return state==="trash"?button("恢复","restore",id)+button("永久删除","purge",id):(state==="archived"?button("恢复在用","unarchive",id):button("归档","archive",id))+button("移入回收站","trash",id);}
  function button(label,action,id="",extra="") { return `<button type="button" class="btn small" data-manager-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`; }
  const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?"selected":""}>${esc(label)}</option>`;
  const field=(label,html)=>`<label class="field"><span>${label}</span>${html}</label>`;
  function groupOptions(selected="") {return option("","未分组",selected)+lib().groups.map(g=>option(g.id,g.name,selected)).join("");}
  function profileOptions(selected="") {return lib().evaluationProfiles.filter(p=>!p.disabled||p.id===selected).map(p=>option(p.id,p.name,selected)).join("");}
  const profileName=id=>lib().evaluationProfiles.find(p=>p.id===id)?.name||"未关联";
  function navigation(){return sections.map(([id,label])=>`<button data-manager-action="section" data-id="${id}" class="${current===id?"active":""}" ${current===id?'aria-current="page"':""}>${label}</button>`).join("");}
  function open(tab="athletes"){selections[current]=selected;clearTimeout(filterTimer);if(tab==="catalog")tab="metrics";current=sections.some(s=>s[0]===tab)?tab:"athletes";selected=selections[current] ||= new Set();render();requestAnimationFrame(()=>window.scrollTo({top:filter().scroll||0,behavior:"instant"}));}
  function visibleStatus(item,owner) {return item.deletedAt||owner?.deletedAt?"trash":item.archived||owner?.archived?"archived":"active";}
  function allRows() {
    const f=filter();let rows;
    if(athleteView()) rows=lib().athletes.map(a=>({id:a.id,athlete:a,item:a}));
    else rows=lib().athletes.flatMap(a=>a.records.map(r=>({id:r.recordId,athlete:a,item:r})));
    const q=f.q.trim().toLocaleLowerCase();
    rows=rows.filter(({athlete:a,item:r})=>(f.status==="all"?visibleStatus(r,a)!=="trash":visibleStatus(r,a)===f.status)&&(!f.athleteId||a.id===f.athleteId)&&(!(current==="teams"?f.teamId:f.group)||a.groupId===(current==="teams"?f.teamId:f.group))&&(!f.sport||a.profile.sport===f.sport)&&(!q||[a.name,a.profile.sport,r.title,r.athlete?.date,a.id].join(" ").toLocaleLowerCase().includes(q))&&(!f.from||(r.athlete?.date||"")>=f.from)&&(!f.to||(r.athlete?.date||"")<=f.to)&&(!f.test||r.enabled?.[f.test])&&(!f.evaluationProfileId||r.evaluationProfileId===f.evaluationProfileId));
    rows.sort((a,b)=>f.sort==="name"?a.athlete.name.localeCompare(b.athlete.name,"zh-CN")||a.id.localeCompare(b.id):(b.item.athlete?.date||b.item.updated||"").localeCompare(a.item.athlete?.date||a.item.updated||"")||a.id.localeCompare(b.id));
    return rows;
  }
  function toolbar() {
    const f=filter(),sports=[...new Set(lib().athletes.map(a=>a.profile.sport).filter(Boolean))].sort(),records=!athleteView();
    const scope=f.athleteId?lib().athletes.find(a=>a.id===f.athleteId):null,scopeTitle=scope?scope.name+(records?"的测试记录":"的资料"):f.evaluationProfileId?"关联方案："+profileName(f.evaluationProfileId):"";
    const count=[f.sport,f.from,f.to,f.test,f.evaluationProfileId,f.sort!=="recent"].filter(Boolean).length;
    return (scopeTitle?`<div class="management-scope"><span>${esc(scopeTitle)}</span>${button(records?"查看全部记录":"查看全部运动员","clear-scope")}${button(f.originTab==="teams"?"返回队伍成员":f.originTab==="profiles"?"返回评价方案":f.originTab==="records"?"返回测试记录":"返回运动员列表","scope-back")}</div>`:"")+`<div class="manager-filter-shell"><div class="management-filters management-primary-filters">${field("搜索",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="姓名、编号${records?"或测试名称":"或专项"}">`)}${current!=="teams"?field("队伍",`<select data-manager-filter="group">${option("","全部队伍",f.group)}${lib().groups.map(g=>option(g.id,g.name,f.group)).join("")}</select>`):""}${field("状态",`<select data-manager-filter="status">${[["active","在用"],["archived","已归档"],["trash","回收站"],["all","全部未删除"]].map(([v,n])=>option(v,n,f.status)).join("")}</select>`)}</div><details class="management-advanced" ${f.advanced?"open":""}><summary>筛选与排序${count?` · 已设置 ${count} 项`:""}</summary><div class="management-filters">${field("专项",`<select data-manager-filter="sport">${option("","全部专项",f.sport)}${sports.map(x=>option(x,x,f.sport)).join("")}</select>`)}${field("排序",`<select data-manager-filter="sort">${option("recent","最近优先",f.sort)}${option("name","姓名顺序",f.sort)}</select>`)}${records?field("起始日期",`<input type="date" data-manager-filter="from" value="${esc(f.from)}">`)+field("结束日期",`<input type="date" data-manager-filter="to" value="${esc(f.to)}">`)+field("测试项目",`<select data-manager-filter="test">${option("","全部项目",f.test)}${lib().catalog.tests.map(t=>option(t.id,t.name,f.test)).join("")}</select>`):""}</div>${button("清除筛选","clear-filters")}</details></div>`;
  }
  function lists() {
    const rows=allRows(),f=filter(),pages=Math.max(1,Math.ceil(rows.length/30));f.page=Math.min(pages,Math.max(1,f.page));
    const allowed=new Set(rows.map(r=>r.id));for(const id of selected)if(!allowed.has(id))selected.delete(id);
    const page=rows.slice((f.page-1)*30,f.page*30),athletes=athleteView(),selectedRows=rows.filter(r=>selected.has(r.id));
    const states=new Set(selectedRows.map(r=>visibleStatus(r.item,r.athlete))),actions=states.has("trash")?button("恢复","restore")+button("永久删除","purge"):(states.has("active")?button("归档","archive"):"")+(states.has("archived")?button("恢复在用","unarchive"):"")+(athletes?button("调整队伍","batch-group"):button("更换评价方案","batch-profile"))+more(button("移入回收站","trash"));
    const selectedOnPage=page.filter(r=>selected.has(r.id)).length;
    return toolbar()+(selected.size?`<div class="management-batch" role="region" aria-label="已选项目操作"><b>已选 ${selected.size} 项${selected.size!==selectedOnPage?`（本页 ${selectedOnPage} 项）`:""}</b>${button("取消选择","clear-selection")}<div class="row">${athletes&&selectedRows.every(r=>visibleStatus(r.item,r.athlete)==="active")?button("开始测试","batch-new-record"):""}${actions}</div></div>`:"")+`<div class="management-table-wrap"><table class="management-table"><thead><tr><th><label class="management-select-all"><input type="checkbox" id="selectManagementPage" aria-label="选择本页" ${page.length&&page.every(r=>selected.has(r.id))?"checked":""}>本页</label></th><th>运动员</th><th>队伍 / 专项</th><th>${athletes?"历次测试":"日期 / 项目"}</th><th>${athletes?"状态":"评价方案"}</th><th>操作</th></tr></thead><tbody>${page.map(({id,athlete:a,item:r})=>{
      const state=visibleStatus(r,a),count=a.records.filter(x=>!x.deletedAt).length;
      const rowActions=state==="trash"?(!athletes&&a.deletedAt?button("恢复所属运动员","owner-manage",a.id):button("恢复","restore",id))+more(button("永久删除","purge",id)):athletes?(state==="active"?button("新建测试","new-record",id):button("测试记录","athlete-records",id))+more(button("资料","edit-athlete",id)+(state==="active"?button("测试记录","athlete-records",id):"")+(current==="teams"?button("转队","team-transfer",id)+button("移出队伍","team-remove",id):"")+stateActions(state,id)):button("查看报告","report",id)+button("录入 / 编辑","entry",id)+more(button("名称 / 日期","edit-record",id)+button("更换评价方案","record-profile",id)+(a.archived?button("恢复所属运动员","owner-manage",a.id)+button("移入回收站","trash",id):stateActions(state,id)));
      const names=Object.entries(r.enabled||{}).filter(([,v])=>v).map(([k])=>lib().catalog.tests.find(t=>t.id===k)?.name||k);
      return `<tr data-managed-id="${esc(id)}" ${current==="teams"?`data-team-member="${esc(id)}"`:""}><td data-label="选择"><input type="checkbox" data-manager-select="${esc(id)}" aria-label="选择 ${esc(a.name)} ${esc(r.athlete?.date||"")}" ${selected.has(id)?"checked":""}></td><td data-label="运动员">${athletes?button(esc(a.name),"athlete-records",a.id):`<b>${esc(a.name)}</b>`}<small>${esc(a.id.slice(-8))}</small></td><td data-label="队伍 / 专项">${esc(lib().groups.find(g=>g.id===a.groupId)?.name||"未分组")}<small>${esc(a.profile.sport||"未填写专项")}</small></td><td data-label="${athletes?"历次测试":"日期 / 项目"}">${athletes?count+" 条":esc(r.athlete.date||"未填日期")+`<small>${esc(r.title||names.slice(0,3).join("、"))}${!r.title&&names.length>3?`等 ${names.length} 项`:""}</small>`}</td><td data-label="${athletes?"状态":"评价方案"}">${athletes?({active:"在用",archived:"已归档",trash:"回收站"}[state]):esc(profileName(r.evaluationProfileId))+(a.deletedAt?'<small>所属运动员在回收站</small>':a.archived?'<small>所属运动员已归档</small>':"" )}</td><td data-label="操作"><div class="row">${rowActions}</div></td></tr>`;
    }).join("")||'<tr><td colspan="6" class="empty">没有符合条件的资料。</td></tr>'}</tbody></table></div><div class="management-pagination"><span>${rows.length} 项 · 每页 30 项</span><div class="row">${button("上一页","page",String(f.page-1),f.page<=1?"disabled":"")}<span>${f.page} / ${pages}</span>${button("下一页","page",String(f.page+1),f.page>=pages?"disabled":"")}</div></div>`;
  }
  function teams() {
    const f=filter(),q=f.q.trim().toLocaleLowerCase(),team=lib().groups.find(g=>g.id===f.teamId);
    if(team){
      const members=lib().athletes.filter(a=>a.groupId===team.id&&!a.deletedAt);
      return `<div class="management-team-heading"><div>${button("返回队伍列表","team-close")}<h2>${esc(team.name)}</h2><p class="note">${members.filter(a=>!a.archived).length} 名在用运动员 · ${members.filter(a=>a.archived).length} 名已归档</p></div><div class="row">${button("添加成员","team-add",team.id)}${more(button("新建运动员并加入","team-new-athlete",team.id)+button("改名","group-edit",team.id)+button("删除队伍","group-delete",team.id))}</div></div>${lists()}`;
    }
    return field("搜索队伍",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="队伍名称">`)+(lib().groups.filter(g=>!q||g.name.toLocaleLowerCase().includes(q)).map(g=>{
      const members=lib().athletes.filter(a=>a.groupId===g.id&&!a.deletedAt);
      return `<article class="management-catalog-item" data-team-id="${esc(g.id)}"><div><h3>${esc(g.name)}</h3><p class="note">${members.filter(a=>!a.archived).length} 名在用运动员 · ${members.filter(a=>a.archived).length} 名已归档</p></div><div class="row">${button("成员名单","team-open",g.id)}${more(button("添加成员","team-add",g.id)+button("改名","group-edit",g.id)+button("删除队伍","group-delete",g.id))}</div></article>`;
    }).join("")||'<p class="empty">暂无符合条件的队伍。</p>');
  }
  function editTeam(id="") {
    const team=lib().groups.find(g=>g.id===id);
    showForm(team?"队伍名称":"新建队伍",field("名称",`<input name="name" required maxlength="100" value="${esc(team?.name||"")}" placeholder="填写队伍或训练组名称">`),async form=>{
      const name=new FormData(form).get("name").trim();if(!name||lib().groups.some(g=>g.id!==id&&g.name===name))throw Error("名称为空或已存在");
      await commit(candidate=>{if(team){const currentTeam=candidate.groups.find(g=>g.id===id);if(!currentTeam)throw Error("队伍已不存在");currentTeam.name=name;}else candidate.groups.push({id:"group_"+uid(),name});});
    });
  }
  function testPlans() {
    if(planDraft){
      return `<div class="test-plan-editor"><div class="form-grid">${field("方案名称",`<input id="testPlanName" maxlength="100" value="${esc(planDraft.name)}">`)}${field("推荐评价方案",`<select id="testPlanProfile">${profileOptions(planDraft.defaultEvaluationProfileId)}</select>`)}</div><h2>选择测试项目</h2><div id="testPlanPicker">${root.RingsidePicker.render(planPickerOptions())}</div><p id="testPlanError" class="field-error" role="alert"></p><div class="row">${button("保存测试方案","plan-save")}${button("取消","plan-close")}</div></div>`;
    }
    const q=filter().q.trim().toLocaleLowerCase(),plans=(lib().testPlans||[]).filter(p=>!q||p.name.toLocaleLowerCase().includes(q));
    return field("搜索测试方案",`<input type="search" data-manager-filter="q" value="${esc(filter().q)}" placeholder="方案名称">`)+(plans.map(p=>`<article class="management-catalog-item" data-test-plan="${esc(p.id)}"><div><h3>${esc(p.name)} ${p.disabled?'<span class="pill">已停用</span>':""}</h3><p>${p.testIds.map(id=>esc(lib().catalog.tests.find(t=>t.id===id)?.name||"已移除项目")).join(" → ")}</p><p class="note">默认评价：${esc(profileName(p.defaultEvaluationProfileId))}</p></div><div class="row">${button("编辑","plan-edit",p.id)}${button("复制","plan-copy",p.id)}${button(p.disabled?"启用":"停用","plan-toggle",p.id)}${button("删除","plan-delete",p.id)}</div></article>`).join("")||'<p class="empty">暂无测试方案。保存常用项目组合，录入时即可复用。</p>');
  }
  function catalogNotices() {
    const conflicts=lib().catalog.conflicts.map((c,i)=>c.resolved?"":`<section class="notice" data-catalog-conflict="${esc(c.testId)}"><h3>${esc(c.name)} · 待确认目录版本</h3><p>已有记录保留测量定义。请选择供后续新测试使用的版本。</p>${c.variants.map((v,j)=>`<div class="reference-row"><span>${esc(v.source||"导入版本")} · ${esc(v.test.name)}<small>${esc(v.protocol)} · ${esc(v.definitions.map(d=>T.metricName(d)+" ("+d.unit+")").join("、"))}</small></span>${button("采用此版本","catalog-resolve",i+":"+j)}</div>`).join("")}</section>`).join("");
    return conflicts+(lib().catalog.abilityGroupConflicts||[]).map((c,i)=>`<section class="notice" data-ability-conflict="${esc(c.key)}"><h3>能力分类名称待确认</h3><p>本机名称：<b>${esc(T.abilityLabel(lib().catalog,c.key))}</b> · 导入名称：<b>${esc(c.incomingName)}</b></p><p>当前沿用本机名称。选择只影响后续测试，已有记录保留各自名称。</p><div class="row">${button("保留本机名称","ability-conflict-local",String(i))}${button("采用导入名称","ability-conflict-incoming",String(i))}</div></section>`).join("");
  }
  function metrics() {
    const f=filter(),q=f.q.trim().toLocaleLowerCase(),abilities=T.abilityGroups(lib().catalog),projects=T.describe(lib().catalog);
    for(const t of projects){const key=t.primaryAbility||"unclassified";if(!abilities.some(g=>g.key===key))abilities.push({key,name:t.primaryAbility?T.abilityLabel(lib().catalog,t.primaryAbility):"未分类",synthetic:true});}
    const project=projects.find(t=>t.id===f.test);
    if(project){
      const conflicted=lib().catalog.conflicts.some(c=>c.testId===project.id&&!c.resolved),definitions=project.definitions;
      const rows=definitions.map(d=>`<tr data-library-metric="${esc(d.id)}"><td data-label="指标"><b>${esc(T.metricName(d))}</b></td><td data-label="单位">${esc(d.unit||"—")}</td><td data-label="数据方式">${T.isManualMetric(d)?d.entryScope==="attempt"?"逐试次录入":"本次测试汇总":"计算结果"}</td><td data-label="操作">${button("编辑指标","metric-edit",d.id,conflicted?"disabled":"")}</td></tr>`).join("");
      const fixed=project.id==="fms"?'<p class="note">七项动作保留左右侧分数、疼痛和备注；0–3 分及双侧取低规则固定。</p>':project.id==="iso"?'<p class="note">测量按部位、方向和侧别保存。目标、参考值和关节比值分级在评价方案中设置。</p>':"";
      return catalogNotices()+`<div class="management-scope">${button("返回项目列表","catalog-back")}</div><article class="catalog-project-detail" data-metric-project="${esc(project.id)}"><div class="metric-project-header"><div><h2>${esc(project.name)}</h2><p class="note">${esc(T.abilityLabel(lib().catalog,project.primaryAbility))} · ${project.category==="screen"?"筛查":"运动表现"}${project.disabled?" · 已停用":""}</p></div><div class="row">${button("编辑项目","catalog-edit",project.id,conflicted?"disabled":"")}${button("新增指标","new-metric",project.id,conflicted?"disabled":"")}${more(button(project.disabled?"启用":"停用","catalog-toggle",project.id))}</div></div><section class="catalog-definition-block"><h3>测量协议</h3><p class="metric-project-protocol">${esc(lib().catalog.protocol[project.id]||"尚未填写协议")}</p></section><section class="catalog-definition-block"><h3>测量内容</h3>${fixed}<div class="catalog-input-list">${(project.dataContract?.fields||[]).map(([key,label])=>`<span>${esc(label)}</span>`).join("")}</div></section><section class="catalog-definition-block"><h3>结果指标</h3>${rows?`<div class="management-table-wrap"><table class="management-table catalog-results"><thead><tr><th>指标</th><th>单位</th><th>数据方式</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="note">本项目使用固定测量结构。</p>'}</section><p class="note">定义修改用于后续测试，已有记录保留测量快照。</p>${button("配置评价标准","project-standards",project.id)}</article>`;
    }
    const filtered=projects.filter(t=>(!f.ability||(t.primaryAbility||"unclassified")===f.ability)&&(!q||[t.name,T.abilityLabel(lib().catalog,t.primaryAbility),...t.definitions.map(T.metricName)].join(" ").toLocaleLowerCase().includes(q)));
    const groups=abilities.filter(g=>!f.ability||f.ability===g.key).map((g,i)=>{
      const items=filtered.filter(t=>(t.primaryAbility||"unclassified")===g.key);if(q&&!items.length)return "";
      return `<section class="metric-ability-group" data-metric-ability="${esc(g.key)}"><div class="metric-ability-heading"><h2>${esc(g.name)}</h2>${g.synthetic?"":more(button("改名","ability-edit",g.key)+button("上移","ability-up",g.key,i===0?"disabled":"")+button("下移","ability-down",g.key,i===abilities.length-1?"disabled":""),"管理分类")}</div><div class="catalog-project-grid">${items.map(t=>`<article class="catalog-project-card" data-metric-project="${esc(t.id)}"><h3>${esc(t.name)}</h3><p>${t.definitions.length} 个结果指标${t.disabled?" · 已停用":""}</p>${button("查看项目","catalog-open",t.id)}</article>`).join("")||`<p class="note">此分类暂无项目。${button("新建项目","new-test",g.synthetic?"":g.key)}</p>`}</div></section>`;
    }).join("");
    return catalogNotices()+`<div class="management-filters catalog-filters">${field("搜索",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="项目或指标名称">`)}${field("能力分类",`<select data-manager-filter="ability">${option("","全部能力",f.ability)}${abilities.map(g=>option(g.key,g.name,f.ability)).join("")}${option("training-analysis",T.analysisLabel,f.ability)}</select>`)}</div>${f.ability==="training-analysis"?derivedLibrary(q):groups||'<p class="empty">没有符合条件的项目。</p>'}`;
  }
  function planPickerOptions() {
    return {source:lib().catalog,selection:planDraft,isoRows:M.isoRows(),context:"plan",showOrder:true,blockedIds:lib().catalog.conflicts.filter(conflict=>!conflict.resolved).map(conflict=>conflict.testId),onChange(next){planDraft.testIds=next.testIds;planDraft.isoDirectionIds=next.isoDirectionIds;const error=$("testPlanError");if(error)error.textContent="";}};
  }
  function derivedLibrary(q="") {
    const definitions=(T.derivedDefinitions?.()||[]).filter(d=>!q||[T.analysisLabel,d.name,d.id,d.formula].join(" ").toLocaleLowerCase().includes(q));
    if(!definitions.length)return "";
    return `<section class="metric-ability-group" data-metric-ability="training-analysis"><div class="metric-ability-heading"><h2>${esc(T.analysisLabel)}</h2></div><div class="management-table-wrap"><table class="management-table metric-library-table"><thead><tr><th>关联测试</th><th>指标</th><th>单位</th><th>数据方式</th><th>计算公式</th><th>操作</th></tr></thead><tbody>${definitions.map(d=>{const enabled=lib().catalog.derivedEnabled?.[d.id]!==false;return `<tr data-derived-definition="${esc(d.id)}"><td data-label="关联测试">${esc(d.dependencies.map(id=>id.toUpperCase()).join(" / "))}</td><td data-label="指标">${esc(d.name)}${enabled?"":' <span class="pill">已停用</span>'}</td><td data-label="单位">${esc(d.unit||"比值")}</td><td data-label="数据方式">跨测试计算</td><td data-label="计算公式">${esc(d.formula)}</td><td data-label="操作"><div class="row">${button(enabled?"停用":"启用","derived-toggle",d.id,`aria-pressed="${enabled}"`)}</div></td></tr>`;}).join("")}</tbody></table></div></section>`;
  }
  function derivedSources(ids) {
    return (root.RingsideSources?.forIds(ids||[])||[]).map(source=>`<a class="source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.authors)}（${esc(source.year)}） · ${esc(source.title)}</a>`).join("");
  }
  async function saveCatalog(catalog) {
    M.validateCatalog(catalog);
    await commit(candidate=>{catalog.revision=(Number(candidate.catalog.revision)||1)+1;candidate.catalog=clone(catalog);});
  }
  function editAbility(key="") {
    const existing=T.abilityGroups(lib().catalog).find(g=>g.key===key);
    if(key&&!existing)throw Error("能力分类不存在，请刷新后重试");
    showForm(existing?"修改能力分类名称":"新建能力分类",field("能力名称",`<input name="name" required maxlength="120" value="${esc(existing?.name||"")}">`)+'<p class="note">用于后续测试。已有记录保留其创建时的分类名称与顺序。</p>',async form=>{
      const name=new FormData(form).get("name").trim(),catalog=clone(lib().catalog),groups=T.abilityGroups(catalog);
      if(!name)throw Error("请填写能力分类名称");
      if(existing?.name!==name&&groups.some(g=>g.key!==key&&g.name===name))throw Error("能力分类名称已存在，请使用不同名称");
      if(existing){const group=groups.find(g=>g.key===key);if(!group)throw Error("能力分类已不存在，请重新打开");group.name=name;for(const c of catalog.abilityGroupConflicts||[])if(c.key===key)c.localName=name;}
      else groups.push({key:"ability_"+uid(),name});
      catalog.abilityGroups=groups;await saveCatalog(catalog);
    });
  }
  function isoName(row){return M.REG[row.region]+" · "+(row.region==="neck"?row.direction.replace(/[（(](?:左\s*\/\s*右|中线)[）)]/g,""):row.direction);}
  const ruleLabels={asymAmber:"双侧差异关注阈值 %",asymRed:"双侧差异预警阈值 %",scoreAmber:"目标达成关注下界 %",scoreGreen:"目标达成达标下界 %"};
  const input=(path,value,type="number",extra="")=>`<input data-profile-path="${esc(path)}" type="${type}" ${type==="number"?'step="any"':""} value="${esc(value)}" ${extra}>`;
  const check=(path,value,label)=>`<label class="check-line"><input type="checkbox" data-profile-path="${esc(path)}" ${value?"checked":""}>${label}</label>`;
  const select=(path,value,options)=>`<select data-profile-path="${esc(path)}">${options.map(([v,n])=>option(v,n,value)).join("")}</select>`;
  function profiles() {
    if(editor)return profileEditor();
    const q=filter().q.trim().toLocaleLowerCase();
    return field("搜索评价方案",`<input type="search" data-manager-filter="q" value="${esc(filter().q)}" placeholder="方案名称">`)+lib().evaluationProfiles.filter(p=>!q||p.name.toLocaleLowerCase().includes(q)).map(p=>{
      const count=lib().athletes.reduce((n,a)=>n+a.records.filter(r=>r.evaluationProfileId===p.id).length,0);
      return `<article class="management-catalog-item" data-evaluation-profile="${esc(p.id)}"><div><h3>${esc(p.name)} ${p.id===lib().defaultEvaluationProfileId?'<span class="pill">默认</span>':""}${p.disabled?'<span class="pill">已停用</span>':""}</h3><p class="note">版本 ${p.revision} · 关联 ${count} 条记录</p></div><div class="row">${button("编辑","profile-edit",p.id)}${more(button("复制","profile-copy",p.id)+button("设为默认","profile-default",p.id,p.disabled?"disabled":"")+button("关联记录","profile-records",p.id)+button(p.disabled?"启用":"停用","profile-toggle",p.id,p.id===lib().defaultEvaluationProfileId?"disabled":"")+(p.previous||p.releases?.length?button("版本历史","profile-history",p.id)+button("恢复上一版","profile-revert",p.id):""))}</div></article>`;
    }).join("");
  }
  function structuredRanges(path,items=[],scores=false) {
    return `<div class="management-table-wrap structured-ranges"><table class="management-table"><thead><tr><th>下限</th><th>含下限</th><th>上限</th><th>含上限</th>${scores?'<th>转换分数</th>':'<th>等级名称</th><th>显示颜色</th>'}<th>操作</th></tr></thead><tbody>${items.map((r,i)=>{const p=path+"."+i;return `<tr><td data-label="下限">${input(p+".min",r.min)}</td><td data-label="含下限">${check(p+".includeMin",r.includeMin!==false,"包含")}</td><td data-label="上限">${input(p+".max",r.max)}</td><td data-label="含上限">${check(p+".includeMax",r.includeMax!==false,"包含")}</td>${scores?`<td data-label="转换分数">${input(p+".score",r.score)}</td>`:`<td data-label="等级名称">${input(p+".label",r.label,"text")}</td><td data-label="显示颜色">${select(p+".status",r.status,[["gray","中性"],["red","红色"],["amber","黄色"],["green","绿色"]])}</td>`}<td data-label="操作">${button("删除","rule-range-delete",p)}</td></tr>`;}).join("")||`<tr><td colspan="${scores?6:7}">尚未设置区间。</td></tr>`}</tbody></table></div><div class="rule-range-footer"><small>端点留空表示不限制；边界是否包含分别设置。</small>${button("添加区间",scores?"score-range-add":"rule-range-add",path)}</div>`;
  }
  const formatRanges=ranges=>ranges.map(r=>`${r.includeMin===false?"(":"["}${r.min??"−∞"}, ${r.max??"+∞"}${r.includeMax===false?")":"]"} ${r.label??r.score??""}`).join("；");
  function conditionsEditor(path,value={},fixedSex=false){
    return `<div class="form-grid">${field("性别",select(path+".sex",value.sex||"any",fixedSex?[["male","男"],["female","女"]]:[["any","不限"],["male","男"],["female","女"]]))}${field("年龄下限（含）",input(path+".ageMin",value.ageMin))}${field("年龄上限（不含）",input(path+".ageMax",value.ageMax))}</div>`;
  }
  function referenceGroupEditor(rule,index,subject) {
    const groups=rule.referenceGroups||[],base="standards."+index+".referenceGroups";
    return `<details class="rule-conditions" ${groups.length?"open":""}><summary>按年龄 / 性别设置不同标准${groups.length?` · ${groups.length} 组`:""}</summary>${groups.map((g,j)=>{const path=base+"."+j;return `<section class="profile-rule-block"><div class="rule-section-heading"><h4>条件标准 ${j+1}</h4>${more(button("复制","profile-group-copy",index+":"+j)+button("删除","profile-group-delete",index+":"+j))}</div>${conditionsEditor(path,g)}${subject.testId==="cpet"?`<div class="form-grid">${field("测试方式",select(path+".mode",g.mode||"any",[["any","不限"],["treadmill","跑台"],["cycle","功率车"]]))}${field("分级要求的最低峰值 RER",input(path+".minPeakRER",g.minPeakRER))}</div>`:""}<div class="form-grid">${field("本组目标（留空沿用通用目标）",input(path+".target",g.target))}${field("参考来源",input(path+".source",g.source,"text"))}</div>${structuredRanges(path+".ranges",g.ranges||[])}</section>`;}).join("")}${button("添加条件标准","profile-group-add",String(index))}</details>`;
  }
  function isoReferenceEditor(ref,path,subject) {
    if(!ref)return button("添加参考均值","profile-reference-add",subject.id);
    const keys=ref.sideBasis==="dominance"?["DOM","ND"]:Object.keys(ref.groups?.[0]?.values||{}).length?Object.keys(ref.groups[0].values):["C"],names={DOM:"优势侧",ND:"非优势侧",L:"左",R:"右",C:"数值"};
    return `<details class="iso-reference-editor"><summary>参考均值${ref.enabled?"":" · 未启用"}</summary><div class="form-grid">${check(path+".enabled",ref.enabled,"显示参考均值")}${field("参考单位",select(path+".basis",ref.basis,subject.kind==="balance"?[["ratio","比值"]]:[["N","N"],["N/kg","N/kg"],["%BW","体重百分比 %BW"]]))}${field("参考来源",input(path+".source",ref.source,"text"))}</div>${(ref.groups||[]).map((g,j)=>{const p=path+".groups."+j;return `<section class="reference-condition-row"><div class="rule-section-heading"><h4>参考组 ${j+1}</h4>${more(button("复制","reference-row-copy",p)+button("删除","rule-range-delete",p))}</div>${conditionsEditor(p,g,true)}<div class="form-grid">${field("统计口径",select(p+".mode",g.mode||"any",[["any","不限"],["best","最好值"],["mean","均值"]]))}${keys.map(k=>field(names[k]||k,input(p+".values."+k,g.values?.[k]))).join("")}</div></section>`;}).join("")}<div class="row">${button("添加参考组","reference-row-add",path)}</div><p class="note">参考均值单独展示，不自动作为训练目标或分级界值。</p>${button("移除参考均值","profile-reference-clear",path)}</details>`;
  }
  function standardEditor(subject) {
    const index=editor.profile.standards.findIndex(r=>r.id===subject.id),rule=editor.profile.standards[index];
    if(subject.locked&&subject.historical)return `<div class="profile-standard-detail"><h3>${esc(subject.name)}</h3><p>旧版绝对力标准保留供历史结果核对。新的时点标准分别配置力占峰值力比例（%PF）或平均 RFD。</p>${rule?`<dl><dt>参考目标</dt><dd>${rule.enabled!==false&&rule.targetEnabled!==false&&rule.target!=null?esc(rule.target)+" "+esc(subject.unit):"未启用"}</dd><dt>分级区间</dt><dd>${esc(formatRanges(rule.ranges||[]))||"未配置"}</dd><dt>来源</dt><dd>${esc(rule.source||"未填写")}</dd></dl>`:'<p class="note">本方案没有旧版绝对力标准。</p>'}</div>`;
    if(subject.locked)return `<div class="profile-standard-detail"><h3>${esc(subject.name)}</h3><p>固定 0–3 分。疼痛为 0 分，双侧项目保留原始左右侧得分并取低侧计分。</p><p class="note">固定测量规则不作为可编辑评价标准。</p></div>`;
    if(!rule)return `<div class="profile-standard-detail"><h3>${esc(subject.name)}</h3><p class="note">尚未为此结果设置评价标准。实测结果正常保留。</p>${button("配置本项标准","profile-standard-add",subject.id)}</div>`;
    const path="standards."+index,caps=subject.capabilities||{target:subject.kind!=="balance",ranges:subject.kind!=="iso",reference:["iso","balance"].includes(subject.kind),conditions:true};
    const target=caps.target?`<section class="rule-component"><h4>参考目标</h4>${check(path+".targetEnabled",rule.targetEnabled!==false,"启用目标比较")}<div class="form-grid">${field("目标 · "+(subject.unit||"数值"),input(path+".target",rule.target))}${subject.kind!=="iso"?field("评价方向",select(path+".direction",rule.direction||"higher",[["higher","数值越高越好"],["lower","数值越低越好"]])):""}</div></section>`:"";
    const ranges=caps.ranges?`<section class="rule-component"><h4>分级区间</h4>${check(path+".rangesEnabled",rule.rangesEnabled!==false,"启用区间分级")}${structuredRanges(path+".ranges",rule.ranges||[])}</section>`:"";
    return `<div class="profile-standard-detail" data-standard-subject="${esc(subject.id)}"><div class="rule-section-heading"><h3>${esc(subject.name)}</h3>${more(button("移除此项标准","profile-standard-remove",subject.id))}</div><p class="note">${esc(subject.unit||"无单位")} · ${esc(subject.context?.protocol||"使用项目测量协议")}</p>${check(path+".enabled",rule.enabled!==false,"使用本项标准")}${target}${ranges}<div class="form-grid">${field("参考来源 / 说明",input(path+".source",rule.source||"","text"))}</div><details class="rule-conditions"><summary>适用条件（可选）${rule.referenceGroups?.length?` · ${rule.referenceGroups.length} 组条件标准`:""}</summary><h4>通用条件</h4>${conditionsEditor(path+".conditions",rule.conditions||{})}<details class="rule-conditions"><summary>分别设置目标与分级的条件</summary>${caps.target?`<h4>目标比较</h4>${conditionsEditor(path+".targetConditions",rule.targetConditions||{})}`:""}${caps.ranges?`<h4>区间分级</h4>${conditionsEditor(path+".rangesConditions",rule.rangesConditions||{})}`:""}</details>${subject.kind==="metric"||caps.referenceGroups?referenceGroupEditor(rule,index,subject):""}</details>${caps.reference?isoReferenceEditor(rule.reference,path+".reference",subject):""}</div>`;
  }
  function lvpSettings(projectId) {
    const items=Object.entries(editor.profile.settings.lvp||{}).filter(([id])=>(id.startsWith("landmine")?"landmine":id)===projectId);
    if(!["bench","squat","deadlift","landmine"].includes(projectId))return "";
    return `<details class="project-analysis-settings" ${editor.analysisOpen?"open":""}><summary>分析设置 · MVT 与速度训练区间</summary><p class="note">这些参数用于推算负荷，不改变实测负荷、速度或代表试次。</p>${items.map(([id,c])=>{const p="settings.lvp."+id;return `<section class="profile-rule-block"><h4>${esc(id==="landmineL"?"左侧":id==="landmineR"?"右侧":"负荷–速度分析")}</h4><div class="form-grid">${field("适用速度口径",select(p+".metric",c.metric,[["MV","平均速度 MV"],["MPV","平均推进速度 MPV"],["PV","峰值速度 PV"]]))}${field("MVT m/s",input(p+".mvt",c.mvt))}${field("依据 / 设备",input(p+".source",c.source||"","text"))}</div><div class="management-table-wrap"><table class="management-table"><thead><tr><th>速度下限 m/s</th><th>速度上限 m/s</th><th>名称</th><th>操作</th></tr></thead><tbody>${(c.zones||[]).map((z,i)=>`<tr><td data-label="下限">${input(p+".zones."+i+".min",z.min)}</td><td data-label="上限">${input(p+".zones."+i+".max",z.max)}</td><td data-label="名称">${input(p+".zones."+i+".label",z.label,"text")}</td><td>${button("删除","rule-range-delete",p+".zones."+i)}</td></tr>`).join("")}</tbody></table></div>${button("添加速度区间","lvp-zone-add",p+".zones")}</section>`;}).join("")||button("配置分析参数","lvp-settings-add",projectId)}</details>`;
  }
  function previewScore(subject,transform,value) {
    if(value===""||value===undefined)return "输入实测值查看转换结果";
    const rule=editor.profile.standards.find(r=>r.id===subject.id);if(!rule)return "请先为此结果设置评价标准";const result=Eval.previewTransform(rule,transform,Number(value),subject);
    return result.valid?`转换分数：${Number(result.score.toFixed(4))}`:result.reason||"无法转换";
  }
  function transformEditor(axis,subject,transform) {
    const path="aggregations."+pathKey(axis)+".transforms."+pathKey(subject.id),value=editor.previewValues?.[axis+"/"+subject.id]??"";
    let h=`<section class="score-transform" data-transform-subject="${esc(subject.id)}"><h4>${esc(subject.name)} · ${esc(subject.unit)}</h4>${field("转换方式",select(path+".kind",transform.kind,[...(subject.measurementScale==="ratio"||transform.kind==="ratio"?[["ratio","相对参考目标"]]:[]),["anchors","数值与分数对应点"],["table","分数区间表"]]))}`;
    if(transform.kind==="ratio")h+=field("转换方向",select(path+".direction",transform.direction||"higher",[["higher","数值越高分数越高"],["lower","数值越低分数越高"]]));
    if(transform.kind==="anchors")h+=field("分数变化",select(path+".shape",transform.shape||"higher",[["higher","随数值递增"],["lower","随数值递减"],["range","中间范围较高"]]))+`<div class="score-anchor-list">${(transform.points||[]).map((p,i)=>`<div class="row">${field("实测值",input(path+".points."+i+".value",p.value))}${field("对应分数",input(path+".points."+i+".score",p.score))}${button("删除","rule-range-delete",path+".points."+i)}</div>`).join("")}</div>${button("添加对应点","score-anchor-add",path+".points")}`;
    if(transform.kind==="table")h+=structuredRanges(path+".ranges",transform.ranges||[],true);
    return h+`<div class="score-preview">${field("试算实测值",`<input type="number" step="any" data-score-preview-axis="${esc(axis)}" data-score-preview-subject="${esc(subject.id)}" value="${esc(value)}">`)}<output data-score-output-axis="${esc(axis)}" data-score-output-subject="${esc(subject.id)}">${esc(previewScore(subject,transform,value))}</output></div></section>`;
  }
  function aggregationsEditor(subjects) {
    const eligible=subjects.filter(s=>!s.locked&&s.ability&&s.kind!=="iso"&&s.kind!=="balance"),abilities=[...new Set(eligible.map(s=>s.ability))];
    return `<section class="profile-aggregations"><p class="note">代表指标缺测时不替换为其他指标。平均分只使用明确选定的成员，全部成员有效后才计算。</p><div class="form-grid">${["scoreAmber","scoreGreen"].map(k=>field(ruleLabels[k],input("settings.thresholds."+k,editor.profile.settings.thresholds[k]))).join("")}</div>${abilities.map(ability=>{const axis=T.axisKey(ability),cfg=editor.profile.aggregations[axis]||{method:"disabled"},available=eligible.filter(s=>s.ability===ability),path="aggregations."+pathKey(axis);
      let h=`<details class="ability-aggregation" ${cfg.method!=="disabled"?"open":""}><summary>${esc(T.abilityLabel(lib().catalog,ability))} · ${{primary:"代表指标",mean:"固定成员平均分",disabled:"未启用"}[cfg.method]||"待配置"}</summary>${cfg.migrationIssue?`<p class="notice">${esc(cfg.migrationIssue)}</p>`:""}${field("汇总方式",select(path+".method",cfg.method,[["disabled","不显示此能力"],["primary","代表指标"],["mean","固定成员平均分"]]))}`;
      if(cfg.method==="primary")h+=field("代表指标",select(path+".primary",cfg.primary||"",[["","请选择代表指标"],...available.map(s=>[s.id,s.name+" · "+s.unit])]));
      if(cfg.method==="mean")h+=`<div class="aggregation-members">${available.map(s=>`<label class="check-line"><input type="checkbox" data-aggregation-axis="${esc(axis)}" data-aggregation-member="${esc(s.id)}" ${(cfg.members||[]).includes(s.id)?"checked":""}>${esc(s.name)} · ${esc(s.unit)}</label>`).join("")}</div>${(cfg.members||[]).map(id=>{const subject=subjects.find(s=>s.id===id);return subject?transformEditor(axis,subject,cfg.transforms?.[id]||{kind:"ratio",direction:"higher"}):`<p class="notice">未找到成员 ${esc(id)}</p>`;}).join("")}<details class="rule-conditions"><summary>平均分的分级区间（可选）</summary>${structuredRanges(path+".ranges",cfg.ranges||[])}</details>`;
      return h+'</details>';
    }).join("")}</section>`;
  }
  function profileEditor() {
    const p=editor.profile,subjects=Eval.ruleSubjects(lib().catalog,p),projects=T.describe(lib().catalog),ids=[...new Set(subjects.map(s=>s.testId))];
    if(!ids.includes(editor.projectId))editor.projectId=ids[0]||"";
    const projectSubjects=subjects.filter(s=>s.testId===editor.projectId);if(!projectSubjects.some(s=>s.id===editor.subjectId))editor.subjectId=projectSubjects[0]?.id;
    const active=projectSubjects.find(s=>s.id===editor.subjectId);
    let h=`<div class="profile-editor-header">${field("方案名称",`<input id="profileName" value="${esc(p.name)}" maxlength="120" ${editor.readOnly?"readonly":""}>`)}<div class="row">${button("返回方案列表","profile-close")}${!editor.readOnly?button("查看变更并保存","profile-review"):button("复制为新方案","profile-copy",p.id)}</div></div><div class="profile-workspace-nav">${button("项目标准","profile-view","projects",editor.view!=="aggregations"?'aria-current="page"':"")}${button("能力图与目标达成","profile-view","aggregations",editor.view==="aggregations"?'aria-current="page"':"")}</div><div id="profileEditorFields">`;
    if(editor.view==="aggregations")h+=aggregationsEditor(subjects);
    else h+=`<div class="profile-project-select">${field("测试项目",`<select id="profileProjectSelect">${ids.map(id=>option(id,(projects.find(t=>t.id===id)?.name||id)+` · ${p.standards.filter(s=>s.testId===id).length} 项标准`,editor.projectId)).join("")}</select>`)}</div>${editor.projectId==="imtp"?`<div class="row">${button("添加时点标准","profile-time-new")}</div>`:""}${editor.projectId==="iso"?`<details class="project-analysis-settings"><summary>双侧差异评价</summary><div class="form-grid">${["asymAmber","asymRed"].map(k=>field(ruleLabels[k],input("settings.thresholds."+k,p.settings.thresholds[k]))).join("")}</div></details>`:""}<div class="profile-project-workspace"><nav class="profile-result-list" aria-label="项目结果">${projectSubjects.map(s=>button(`${esc(s.name)}<small>${esc(s.unit||"固定评分")} · ${s.locked?(s.historical?"历史标准 · 只读":"固定规则"):p.standards.some(r=>r.id===s.id)?"已配置":"未配置"}</small>`,"profile-subject",s.id,s.id===editor.subjectId?'aria-current="true"':"")).join("")}</nav><div>${active?standardEditor(active):'<p class="empty">此项目暂无可配置结果。</p>'}${lvpSettings(editor.projectId)}</div></div>`;
    return h+'</div><p id="profileEditorError" class="field-error" role="alert"></p>';
  }
  function openStandard(kind,id){
    const profile=lib().evaluationProfiles.find(p=>p.id===lib().defaultEvaluationProfileId);if(!profile)throw Error("请先创建评价方案");if(!viewProfile(profile.id))return;App.openManagement("profiles");
    const subject=Eval.ruleSubjects(lib().catalog,editor.profile).find(s=>s.id===id||s.metricId===id);if(subject){editor.subjectId=subject.id;editor.projectId=subject.testId;}render();
  }
  function backup() {
    return `<div class="backup-grid"><article class="form-card"><h2>完整备份</h2><p>包含运动员、历次测试、队伍、回收站、测试方案、指标库和评价方案。</p><button class="btn primary" onclick="App.downloadLibrary()">导出完整备份</button></article><article class="form-card"><h2>导入与恢复</h2>${field("导入方式",'<select id="backupImportMode"><option value="merge">合并到当前资料库</option><option value="replace">恢复为完整资料库</option></select>')}<button class="btn primary" onclick="document.getElementById('importFile').click()">选择备份文件</button><p class="note">支持完整 JSONL 备份、旧 JSON 和已保存的 HTML。</p>${button("恢复上次资料库","restore-library")}</article><article class="form-card"><h2>升级资料</h2><p>查看本次升级前保留的资料和迁移核对结果。</p><div class="row"><button class="btn" onclick="App.downloadUpgradeBackup()">导出升级前资料</button><button class="btn" onclick="App.downloadMigrationReport()">迁移核对清单</button></div><details class="rule-conditions"><summary>回退到升级前版本</summary><p>先下载当前完整备份。回退会恢复升级前的资料并结束本页面，再使用已备份的旧版程序。</p><div class="row"><button class="btn" onclick="App.downloadLibrary()">下载当前完整备份</button><button class="btn" onclick="App.downloadUpgradeBackup()">下载升级前备份</button><button class="btn" onclick="App.downloadRollbackRecoveryBackup()">导出回退前新版资料</button><button class="btn" onclick="App.prepareVersionRollback()">恢复升级前资料并结束页面</button></div></details></article></div><details class="rule-conditions"><summary>旧版兼容导出</summary><p>旧版兼容格式不包含新评价方案中的完整计分配置；需要完整恢复时使用升级前备份。</p><div class="row"><button class="btn" onclick="App.downloadLegacyLibrary()">导出旧版兼容 JSON</button><button class="btn" onclick="App.downloadPreMigration()">下载旧格式迁移前资料</button></div></details>`;
  }
  function render(options={}) {
    if(!lib())return;
    const focused=document.activeElement, key=focused?.dataset.managerFilter, caret=focused?.selectionStart;
    const title=sections.find(([id])=>id===current)[1];
    const action=current==="athletes"?button("＋ 新建运动员","new-athlete"):current==="teams"&&!filter().teamId?button("＋ 新建队伍","group-new"):current==="plans"&&!planDraft?button("＋ 新建测试方案","plan-new"):current==="records"?button("＋ 新建测试","choose-new-record"):current==="metrics"&&!filter().test?button("＋ 新建项目","new-test")+more(button("新建能力分类","ability-new"),"管理分类"):current==="profiles"&&!editor?button("＋ 新建方案","profile-new"):"";
    const content=$("managementContent"),html=`<div class="management-heading"><div><h1>${title}</h1></div><div class="row">${action}</div></div>`+(current==="athletes"||current==="records"?lists():current==="teams"?teams():current==="plans"?testPlans():current==="metrics"?metrics():current==="profiles"?profiles():backup());
    const filterBar=node=>{const control=node.querySelector("[data-manager-filter]");return control?.closest(".manager-filter-shell")||control?.closest(".management-filters")||control?.closest(".field");};
    const retained=options.preserveFilters&&filterBar(content);
    if(retained?.parentNode===content){
      const draft=document.createElement("div");draft.innerHTML=html;
      const incoming=filterBar(draft);
      if(incoming?.parentNode===draft){
        // An open native select must stay connected. Replace only its siblings.
        [...content.children].filter(node=>node!==retained).forEach(node=>node.remove());
        let after=false;
        for(const node of [...draft.children]){if(node===incoming){after=true;continue;}if(after)content.append(node);else content.insertBefore(node,retained);}
      }else content.innerHTML=html;
    }else content.innerHTML=html;
    if(current==="plans"&&planDraft)root.RingsidePicker.bind($("testPlanPicker"),planPickerOptions());
    if(editor?.readOnly&&current==="profiles") $("profileEditorFields")?.querySelectorAll("input,select,textarea,button").forEach(el=>{if(el.id!=="profileProjectSelect"&&el.dataset.managerAction!=="profile-subject")el.disabled=true;});
    if(key){const el=$("managementContent").querySelector(`[data-manager-filter="${key}"]`);el?.focus({preventScroll:true});if(caret!==null&&el?.setSelectionRange)try{el.setSelectionRange(caret,caret);}catch{}}
  }
  function formSnapshot() {
    return JSON.stringify([...$("managementFields").querySelectorAll("input,select,textarea")]
      .filter(control=>!control.disabled&&!control.readOnly&&control.type!=="search"&&!['submit','button','reset'].includes(control.type))
      .map((control,index)=>[control.name||control.id||index,control.type,
        ['checkbox','radio'].includes(control.type)?control.checked:control.multiple?[...control.selectedOptions].map(option=>option.value):control.value,
        !!control.validity?.badInput]));
  }
  function showForm(title,html,action) {
    formAction=action;$("managementForm").querySelector('[type="submit"]').textContent="保存";$("managementModalTitle").textContent=title;$("managementFields").innerHTML=html;$("managementError").hidden=true;$("managementForm").querySelector('[type="submit"]').disabled=false;App.modal("managementModal");
    formBaseline=formSnapshot();
  }
  function editAthlete(id="",groupId="") {
    const a=lib().athletes.find(a=>a.id===id)||(id?App.getAthlete?.(id):null),p=a?.profile||{};
    showForm(a?"编辑运动员资料":"新建运动员",root.RingsideProfile.render({...p,name:p.name||a?.name||""},{groups:lib().groups,groupId:a?.groupId||groupId}),async form=>{
      const {profile,groupId}=root.RingsideProfile.read(form);
      await App.updateAthleteProfile(id,{...p,...profile},groupId);
    });
  }
  function groups() {
    return App.openManagement("teams");
  }
  async function cleanup(action,id) {
    const ids=id?[id]:[...selected];if(!ids.length)throw Error("请先选择资料");
    const athletes=athleteView();if(!athletes&&action==="unarchive"&&lib().athletes.some(a=>a.archived&&a.records.some(r=>ids.includes(r.recordId))))throw Error("所选记录的运动员已归档。请先在该运动员的资料中恢复在用，再恢复单独归档的记录。");
    const owners=athletes?lib().athletes.filter(a=>ids.includes(a.id)):[],summaries=athletes?owners.flatMap(a=>a.records):lib().athletes.flatMap(a=>a.records).filter(r=>ids.includes(r.recordId));
    if(action==="purge"&&!confirm(`永久删除 ${athletes?owners.length+" 名运动员及其 ":""}${summaries.length} 条测试记录？此操作无法从回收站恢复。`))return;
    if(action==="trash"&&!confirm(`将 ${athletes?owners.length+" 名运动员及其 ":""}${summaries.length} 条记录移入回收站？`))return;
    await commit(async(candidate,{loadRecord})=>{
      const selectedAthletes=athletes?candidate.athletes.filter(a=>ids.includes(a.id)):[],records=athletes?selectedAthletes.flatMap(a=>a.records):candidate.athletes.flatMap(a=>a.records).filter(r=>ids.includes(r.recordId)),changes=[],removals={};
      if(athletes)for(const a of selectedAthletes){if(action==="archive")a.archived=true;if(action==="unarchive")a.archived=false;if(action==="trash")a.deletedAt=now();if(action==="restore")a.deletedAt=null;}
      if(!athletes||["trash","restore","purge"].includes(action))for(const summary of records){
        const stored=await loadRecord(summary.recordId);if(!stored)throw Error("记录已不存在，请刷新列表");const r=clone(stored);
        if(action==="purge"){(removals.records||=[]).push(r.recordId);continue;}
        if(action==="archive")r.archived=true;if(action==="unarchive")r.archived=false;
        if(action==="trash"&&!r.deletedAt){r.deletedAt=now();if(athletes)r.deletedWithAthlete=r.athleteId;}
        if(action==="restore"&&(!athletes||r.deletedWithAthlete===r.athleteId)){r.deletedAt=null;delete r.deletedWithAthlete;}
        if(action==="restore"&&!athletes&&candidate.athletes.find(a=>a.id===r.athleteId)?.deletedAt)throw Error("请先恢复该记录所属的运动员");
        changes.push(r);
      }
      if(action==="purge"&&athletes)candidate.athletes=candidate.athletes.filter(a=>!ids.includes(a.id));
      return {records:changes,removals};
    });selected.clear();render();
  }
  function makeEditor(profile,options={}) {
    const draft=Eval.normalizeProfile(clone(profile),lib().catalog);
    editor={profile:draft,view:"projects",projectId:"",subjectId:"",previewValues:{},invalid:new Set(),...options};editor.baseline=editorSnapshot();return editor;
  }
  function viewProfile(id,readOnly=false) {
    const profile=lib().evaluationProfiles.find(p=>p.id===id);if(!profile||!discardEditor())return false;
    makeEditor(profile,{readOnly,baseRevision:profile.revision});pendingReview=null;render();return true;
  }
  function editorSnapshot(){return editor?Eval.canonical(Eval.serializeProfile(editor.profile)):"";}
  function editorDirty(){return !!editor&&!editor.readOnly&&(editor.isNew||editorSnapshot()!==editor.baseline);}
  function desktopCloseStatus() {
    const modalOpen=$("managementModal")?.classList.contains("show"), submit=$("managementForm")?.querySelector('[type="submit"]');
    return {busy:busy||!!(modalOpen&&submit?.disabled),
      unsaved:editorDirty()||!!(!editor?.readOnly&&editor?.invalid?.size)||!!(planDraft&&Eval.canonical(planDraft)!==planBaseline)||!!(modalOpen&&formSnapshot()!==formBaseline)};
  }
  function discardEditor(){if(editorDirty()&&!confirm("当前评价方案有未保存修改，放弃这些修改？"))return false;editor=null;return true;}
  function parseProfile() {
    if(editor.invalid?.size)throw Error("请修正未完成的数值输入");
    const profile=Eval.serializeProfile(editor.profile);Eval.validateProfile(profile);return profile;
  }
  function changesBetween(old,next){return Eval.changesBetween?Eval.changesBetween(old,next):Eval.canonical(old)===Eval.canonical(next)?[]:[["评价配置",JSON.stringify(old),JSON.stringify(next)]];}
  function profileSnapshot(profile){const snapshot=Eval.serializeProfile(Eval.normalizeProfile(clone(profile),lib().catalog));delete snapshot.previous;delete snapshot.releases;return snapshot;}
  function profileHistory(profile){
    const versions=new Map((profile.releases||[]).map(p=>[p.revision,profileSnapshot({...p,id:profile.id})]));
    if(profile.previous&&!versions.has(profile.previous.revision))versions.set(profile.previous.revision,profileSnapshot({...profile.previous,id:profile.id}));
    return [...versions.values()].sort((a,b)=>a.revision-b.revision);
  }
  function diffTable(diff){
    const labels={...ruleLabels,enabled:"使用标准",targetEnabled:"目标比较",rangesEnabled:"区间分级",target:"参考目标",ranges:"分级区间",direction:"评价方向",source:"来源 / 说明",context:"测量条件",protocol:"测量协议",unit:"单位",selectionDirection:"代表试次选取",aggregation:"汇总口径",metric:"速度口径",conditions:"通用条件",targetConditions:"目标适用条件",rangesConditions:"分级适用条件",sex:"性别",ageMin:"年龄下限",ageMax:"年龄上限",minPeakRER:"最低峰值 RER",referenceGroups:"条件标准",reference:"参考均值",groups:"参考组",basis:"参考单位",statistic:"统计口径",sideBasis:"侧别口径",values:"参考值",mode:"测试 / 统计方式",min:"下限",max:"上限",includeMin:"含下限",includeMax:"含上限",label:"名称",status:"颜色",method:"汇总方式",kind:"类型",region:"部位",directionCode:"方向",members:"固定成员",primary:"代表指标",transforms:"分数转换",points:"数值对应点",value:"实测值",score:"转换分数",shape:"分数变化",mvt:"MVT",zones:"速度区间",DOM:"优势侧",ND:"非优势侧",L:"左侧",R:"右侧",C:"数值",paired:"双侧测量",timeMs:"时间 ms",measureKind:"时点结果",migrationIssue:"待确认事项"};
    const names=new Map(Eval.ruleSubjects(lib().catalog,editor?.profile).map(s=>[s.id,s.name])),hidden=new Set(["id","testId","metricId","directionId","pairId","protocolIdentity","sourceId","legacy"]),words={higher:"数值越高越好",lower:"数值越低越好",range:"中间范围较高",primary:"代表指标",mean:"固定成员平均分",disabled:"未启用",ratio:"相对参考目标",anchors:"数值与分数对应点",table:"分数区间表",male:"男",female:"女",any:"不限",green:"绿色",amber:"黄色",red:"红色",gray:"中性",dominance:"优势侧 / 非优势侧",anatomical:"左 / 右",force_pct_peak:"力占峰值力比例",rfd:"平均 RFD"};
    const parse=v=>{if(typeof v!=="string"||!v.startsWith("{"))return v;try{return JSON.parse(v);}catch{return v;}},value=(v,key)=>v===undefined||v===null||v===""?"未设置":typeof v==="boolean"?v?"是":"否":key==="basis"&&v==="ratio"?"比值":key==="mode"?({any:"不限",best:"最好值",mean:"均值",treadmill:"跑台",cycle:"功率车"}[v]||String(v)):names.get(v)||words[v]||String(v),rows=[];
    const walk=(name,a,b,keyName)=>{
      if(Eval.canonical(a)===Eval.canonical(b))return;
      if(a&&typeof a==="object"||b&&typeof b==="object"){
        const left=a&&typeof a==="object"?a:{},right=b&&typeof b==="object"?b:{},keys=new Set([...Object.keys(left),...Object.keys(right)]);
        if(!keys.size){rows.push([name,value(a),value(b)]);return;}
        for(const key of keys)if(!hidden.has(key))walk(name+" · "+(names.get(key)||labels[key]||(/^\d+$/.test(key)?String(Number(key)+1):key)),left[key],right[key],key);
      }else rows.push([name,value(a,keyName),value(b,keyName)]);
    };
    diff.forEach(([name,a,b])=>walk(name,parse(a),parse(b)));
    return rows.length?`<div class="management-table-wrap"><table class="profile-diff"><thead><tr><th>变更内容</th><th>原配置</th><th>新配置</th></tr></thead><tbody>${rows.map(([name,a,b])=>`<tr><td data-label="变更内容">${esc(name)}</td><td data-label="原配置">${esc(a)}</td><td data-label="新配置">${esc(b)}</td></tr>`).join("")}</tbody></table></div>`:'<p>没有改变评价数值。</p>';
  }
  async function publishProfile(next,baseRevision){
    await commit(candidate=>{
      const index=candidate.evaluationProfiles.findIndex(p=>p.id===next.id),prior=candidate.evaluationProfiles[index];
      if(prior&&prior.revision!==baseRevision)throw Error("方案已在其他页面更新。请保留当前内容，重新载入最新方案后再保存。");
      const saved={...clone(next),revision:prior?prior.revision+1:1,updated:now()};
      if(prior){saved.previous=profileSnapshot(prior);saved.releases=[...profileHistory(prior),saved.previous];}
      else saved.releases=[];
      if(index<0)candidate.evaluationProfiles.push(saved);else candidate.evaluationProfiles[index]=saved;
    });
  }
  function reviewProfile() {
    const next=parseProfile(),original=lib().evaluationProfiles.find(p=>p.id===next.id),diff=changesBetween(original||{...next,standards:[],aggregations:{},settings:{thresholds:{},lvp:{}}},next),baseRevision=editor.baseRevision;
    const affected=lib().athletes.reduce((n,a)=>n+a.records.filter(r=>r.evaluationProfileId===next.id).length,0);pendingReview=next;
    showForm("保存评价方案",`<p><b>${esc(next.name)}</b> · ${affected} 条关联记录将使用此版本。</p>${diffTable(diff)}`,async()=>{await publishProfile(next,baseRevision);editor=null;pendingReview=null;});
  }
  function reviewHistory(id,latest=false){
    const profile=lib().evaluationProfiles.find(p=>p.id===id),versions=profileHistory(profile);if(!versions.length)throw Error("暂无历史版本");
    const affected=lib().athletes.reduce((n,a)=>n+a.records.filter(r=>r.evaluationProfileId===id).length,0),selected=versions.at(-1).revision;
    showForm(latest?"恢复上一版评价方案":"评价方案版本历史",`<p><b>${esc(profile.name)}</b> · 当前版本 ${profile.revision} · ${affected} 条关联记录</p>${field("历史版本",`<select id="profileHistoryVersion" name="revision">${[...versions].reverse().map(p=>option(String(p.revision),`版本 ${p.revision} · ${(p.updated||"").slice(0,10)} · ${p.name}`,String(selected))).join("")}</select>`)}<p class="note">恢复将发布一个新版本，已有发布历史继续保留。</p><div id="profileHistoryDiff"></div>`,async form=>{
      const revision=Number(new FormData(form).get("revision")),version=versions.find(p=>p.revision===revision);if(!version)throw Error("历史版本已变化");
      const next={...clone(version),id,disabled:profile.disabled};Eval.validateProfile(next);await publishProfile(next,profile.revision);editor=null;
    });
    const update=()=>{$("profileHistoryDiff").innerHTML=diffTable(changesBetween(profile,versions.find(p=>p.revision===Number($("profileHistoryVersion").value))));};$("profileHistoryVersion").addEventListener("change",update);update();$("managementForm").querySelector('[type="submit"]').textContent="恢复并发布新版本";
  }
  function getPath(obj,path){return path.split(".").map(decodeURIComponent).reduce((v,k)=>v?.[k],obj);}
  function setPath(obj,path,value){const keys=path.split(".").map(decodeURIComponent);if(keys.some(k=>["__proto__","constructor","prototype"].includes(k)))throw Error("无效字段");let current=obj;for(const k of keys.slice(0,-1)){if(!current[k]||typeof current[k]!=="object")current[k]={};current=current[k];}current[keys.at(-1)]=value;}
  function removeDraftRow(path,index){
    getPath(editor.profile,path).splice(index,1);
    editor.invalid=new Set([...editor.invalid].flatMap(key=>{if(!key.startsWith(path+"."))return [key];const parts=key.slice(path.length+1).split("."),row=Number(parts[0]);if(row===index)return [];if(row>index)parts[0]=String(row-1);return [path+"."+parts.join(".")];}));
  }
  function updateScorePreviews(){
    if(!editor)return;const subjects=Eval.ruleSubjects(lib().catalog,editor.profile);
    document.querySelectorAll('[data-score-output-axis]').forEach(node=>{const axis=node.dataset.scoreOutputAxis,id=node.dataset.scoreOutputSubject,subject=subjects.find(s=>s.id===id);if(subject)node.textContent=previewScore(subject,editor.profile.aggregations[axis]?.transforms?.[id],editor.previewValues[axis+"/"+id]);});
  }
  async function action(name,id) {
    if(name==="section")return App.openManagement(id);
    if(name==="page"){filter().page=Number(id);return render();}
    if(name==="clear-selection"){selected.clear();return render();}
    if(name==="clear-filters"){const old=filter();filters[current]={...freshFilters(),teamId:old.teamId,athleteId:old.athleteId,originTab:old.originTab};selected.clear();return render();}
    if(name==="clear-scope"){filter().athleteId="";filter().evaluationProfileId="";filter().page=1;return render();}
    if(name==="scope-back")return App.openManagement(filter().originTab||"athletes");
    if(name==="owner-manage"){const owner=lib().athletes.find(a=>a.id===id);if(!owner)throw Error("运动员已不存在");filters.athletes={...freshFilters(),athleteId:id,status:owner.deletedAt?"trash":owner.archived?"archived":"active",originTab:"records"};selections.athletes=new Set();return App.openManagement("athletes");}
    if(["archive","unarchive","trash","restore","purge"].includes(name))return cleanup(name,id);
    if(name==="new-athlete"||name==="edit-athlete")return editAthlete(id);
    if(name==="team-new-athlete")return editAthlete("",id);
    if(name==="new-record")return App.startDataEntry(id);
    if(name==="batch-new-record")return App.startTeamDataEntry([...selected],current==="teams"?filter().teamId:filter().group);
    if(name==="choose-new-record")return App.startDataEntry(filter().athleteId||"");
    if(name==="athlete-records"){filters.records={...freshFilters(),athleteId:id,status:"all",originTab:current};selections.records=new Set();return App.openManagement("records");}
    if(name==="report"||name==="entry"){const a=lib().athletes.find(a=>a.records.some(r=>r.recordId===id));if(a)return App.openManagedRecord(a.id,id,name==="entry");return;}
    if(name==="edit-record"){
      const r=await App.getRepository().loadRecord(id);return showForm("测试名称与日期",field("名称",`<input name="title" maxlength="100" value="${esc(r.title)}">`)+field("测试日期",`<input type="date" name="date" value="${esc(r.athlete.date)}" required>`),async form=>{const data=new FormData(form);await App.updateRecordDate(id,data.get("date"),{title:data.get("title").trim()});});
    }
    if(name==="groups")return App.openManagement("teams");
    if(name==="group-new"||name==="group-edit")return editTeam(id);
    if(name==="team-open"||name==="team-close"){filters.teams={...freshFilters(),teamId:name==="team-open"?id:""};selected.clear();return render();}
    if(name==="team-add"){
      const team=lib().groups.find(g=>g.id===id),athletes=lib().athletes.filter(a=>!a.deletedAt&&!a.archived&&a.groupId!==id);
      return showForm("添加成员 · "+team.name,`<p class="note">已有队伍的运动员会转入本队，测试记录继续保留。</p>${field("搜索运动员",'<input type="search" id="teamMemberSearch" placeholder="姓名、编号或专项">')}<div class="team-member-picker">${athletes.map(a=>`<label class="check-line" data-team-candidate="${esc([a.name,a.id,a.profile.sport].join(" ").toLocaleLowerCase())}"><input type="checkbox" name="athleteIds" value="${esc(a.id)}"><span>${esc(a.name)} · ${esc(a.id.slice(-8))}<small>${esc(a.profile.sport||"未填写专项")} · ${esc(lib().groups.find(g=>g.id===a.groupId)?.name||"未分组")}</small></span></label>`).join("")||'<p class="empty">暂无可添加的在用运动员。</p>'}</div>`,async form=>{const ids=new FormData(form).getAll("athleteIds");if(!ids.length)throw Error("请选择运动员");await commit(candidate=>{if(!candidate.groups.some(g=>g.id===id))throw Error("队伍已不存在");for(const a of candidate.athletes.filter(a=>ids.includes(a.id))){if(a.deletedAt||a.archived)throw Error("部分运动员状态已变化，请重新选择");a.groupId=id;}});});
    }
    if(name==="team-remove"){await commit(candidate=>{const a=candidate.athletes.find(a=>a.id===id);if(a)a.groupId="";});return render();}
    if(name==="team-transfer"){
      const a=lib().athletes.find(a=>a.id===id);return showForm("转移队伍 · "+a.name,field("新队伍",`<select name="groupId">${groupOptions(a.groupId)}</select>`),async form=>{const value=new FormData(form).get("groupId");await commit(candidate=>{const athlete=candidate.athletes.find(a=>a.id===id);if(!athlete)throw Error("运动员已不存在");athlete.groupId=value;});});
    }
    if(name==="group-delete"){
      if(!confirm("删除队伍后，其运动员归为未分组，资料和测试继续保留。继续？"))return;
      await commit(candidate=>{candidate.groups=candidate.groups.filter(g=>g.id!==id);candidate.athletes.filter(a=>a.groupId===id).forEach(a=>a.groupId="");});filter().teamId="";return render();
    }
    if(["plan-new","plan-edit","plan-copy"].includes(name)){
      const existing=(lib().testPlans||[]).find(p=>p.id===id);planDraft=existing?clone(existing):{id:"plan_"+uid(),name:"",testIds:[],isoDirectionIds:[],defaultEvaluationProfileId:lib().defaultEvaluationProfileId,disabled:false};
      if(!Array.isArray(planDraft.isoDirectionIds))planDraft.isoDirectionIds=planDraft.testIds.includes("iso")?M.legacyIsoDirectionIds():[];
      planBaseline=Eval.canonical(planDraft);
      if(name==="plan-copy"){planDraft.id="plan_"+uid();planDraft.name+=" 副本";planDraft.disabled=false;}return render();
    }
    if(name==="plan-close"){planDraft=null;planBaseline="";return render();}
    if(name==="plan-save"){
      const draft=clone(planDraft);draft.name=draft.name.trim();if(!draft.name)throw Error("请填写测试方案名称");
      if(!draft.testIds.length)throw Error("请至少添加一个测试项目");if(draft.testIds.some(id=>!lib().catalog.tests.some(t=>t.id===id)))throw Error("请移除已不存在的项目");
      if(draft.testIds.includes("iso")&&!draft.isoDirectionIds.length)throw Error("请至少选择一个等长力量测试方向");
      await commit(candidate=>{candidate.testPlans||=[];if(candidate.testPlans.some(p=>p.id!==draft.id&&p.name===draft.name))throw Error("测试方案名称已存在");const i=candidate.testPlans.findIndex(p=>p.id===draft.id);if(i<0)candidate.testPlans.push(draft);else candidate.testPlans[i]=draft;});planDraft=null;planBaseline="";return render();
    }
    if(name==="plan-toggle"){await commit(candidate=>{const p=candidate.testPlans.find(p=>p.id===id);p.disabled=!p.disabled;});return render();}
    if(name==="plan-delete"){if(!confirm("删除这个测试方案？已经创建的测试记录继续保留。"))return;await commit(candidate=>{candidate.testPlans=candidate.testPlans.filter(p=>p.id!==id);});return render();}
    if(["batch-group","batch-profile","record-profile"].includes(name)){
      const ids=name==="record-profile"?[id]:[...selected],isGroup=name==="batch-group";if(!ids.length)throw Error("请先选择资料");
      return showForm(isGroup?"调整队伍":"更换评价方案",`<p>已选择 ${ids.length} 项。</p>`+field(isGroup?"队伍":"评价方案",`<select name="value">${isGroup?groupOptions():profileOptions(lib().defaultEvaluationProfileId)}</select>`),async form=>{
        const value=new FormData(form).get("value");await commit(async(candidate,{loadRecord})=>{const records=[];
          if(isGroup)candidate.athletes.filter(a=>ids.includes(a.id)).forEach(a=>a.groupId=value);
          else for(const recordId of ids){const r=clone(await loadRecord(recordId));r.evaluationProfileId=value;r.updated=now();records.push(r);}
          return {records};
        });selected.clear();
      });
    }
    if(name==="ability-new"||name==="ability-edit")return editAbility(id);
    if(name==="ability-up"||name==="ability-down"){
      const catalog=clone(lib().catalog),groups=T.abilityGroups(catalog),i=groups.findIndex(g=>g.key===id),j=i+(name==="ability-up"?-1:1);if(i<0||j<0||j>=groups.length)return;
      [groups[i],groups[j]]=[groups[j],groups[i]];catalog.abilityGroups=groups;await saveCatalog(catalog);return render();
    }
    if(name==="ability-conflict-local"||name==="ability-conflict-incoming"){
      const catalog=clone(lib().catalog),i=Number(id),conflict=catalog.abilityGroupConflicts?.[i];if(!conflict)throw Error("待确认分类已变化，请重新打开指标库");
      if(name==="ability-conflict-incoming"){const groups=T.abilityGroups(catalog),group=groups.find(g=>g.key===conflict.key);if(!group)throw Error("能力分类不存在");group.name=conflict.incomingName;catalog.abilityGroups=groups;for(const c of catalog.abilityGroupConflicts)if(c.key===conflict.key)c.localName=group.name;}
      catalog.abilityGroupConflicts.splice(i,1);await saveCatalog(catalog);return render();
    }
    if(name==="new-test"){const opened=App.openCatalogItem("new-test");if(opened!==false&&id){if($("catalogPrimaryAbility"))$("catalogPrimaryAbility").value=id;if($("catalogAbility"))$("catalogAbility").value=id;}return opened;}
    if(name==="derived-toggle"){const catalog=clone(lib().catalog);catalog.derivedEnabled||={};catalog.derivedEnabled[id]=catalog.derivedEnabled[id]===false;await saveCatalog(catalog);return render();}
    if(name==="catalog-open"||name==="project-metrics"){filter().test=id;return render();}
    if(name==="catalog-back"){filter().test="";return render();}
    if(name==="new-metric")return App.openCatalogItem("new-metric",id||filter().test||"");
    if(name==="catalog-edit")return App.openCatalogItem("edit-project",id);
    if(name==="catalog-resolve"){await App.resolveCatalogConflict(...id.split(":").map(Number));return render();}
    if(name==="metric-edit"){const d=lib().catalog.definitions.find(d=>d.id===id);return App.openCatalogItem("edit",d.testId,d.id);}
    if(name==="catalog-toggle"){const catalog=clone(lib().catalog),test=catalog.tests.find(t=>t.id===id);test.disabled=!test.disabled;await saveCatalog(catalog);return render();}
    if(name==="project-standards"){
      return showForm("选择评价方案",field("评价方案",`<select name="profile">${profileOptions(lib().defaultEvaluationProfileId)}</select>`),async form=>{const profileId=new FormData(form).get("profile");if(viewProfile(profileId)){editor.projectId=id;App.openManagement("profiles");}});
    }
    if(name==="profile-edit")return viewProfile(id);
    if(name==="profile-new"||name==="profile-copy"){
      if(!discardEditor())return;
      const source=name==="profile-copy"?lib().evaluationProfiles.find(p=>p.id===id):null,profile=source?Eval.serializeProfile(Eval.normalizeProfile(source)):{formatVersion:2,standards:[],aggregations:{},settings:{thresholds:clone(M.defaults().rules),lvp:{}}};
      Object.assign(profile,{id:"evaluation_"+uid(),name:source?source.name+" 副本":"新评价方案",revision:1,updated:now(),disabled:false});delete profile.previous;delete profile.releases;makeEditor(profile,{isNew:true,baseRevision:null});return render();
    }
    if(name==="profile-close"){if(discardEditor())render();return;}
    if(name==="profile-view"){editor.view=id;return render();}
    if(name==="profile-review")return reviewProfile();
    if(name==="profile-subject"){editor.subjectId=id;return render();}
    if(name==="profile-standard-add"){
      const subject=Eval.ruleSubjects(lib().catalog,editor.profile).find(s=>s.id===id);if(!subject)throw Error("结果定义已变化，请重新打开项目");Eval.ensureStandard(editor.profile,subject);return render();
    }
    if(name==="profile-standard-remove"){const index=editor.profile.standards.findIndex(r=>r.id===id);if(index>=0)removeDraftRow("standards",index);return render();}
    if(["rule-range-add","score-range-add","score-anchor-add","lvp-zone-add"].includes(name)){
      let rows=getPath(editor.profile,id);if(!Array.isArray(rows)){rows=[];setPath(editor.profile,id,rows);}
      rows.push(name==="score-anchor-add"?{value:null,score:null}:name==="lvp-zone-add"?{min:null,max:null,label:""}:{min:null,max:null,includeMin:true,includeMax:false,...(name==="score-range-add"?{score:null}:{label:"",status:"gray"})});return render();
    }
    if(name==="rule-range-delete"){const keys=id.split("."),index=Number(keys.pop());removeDraftRow(keys.join("."),index);return render();}
    if(name==="reference-row-copy"){const keys=id.split("."),index=Number(keys.pop()),rows=getPath(editor.profile,keys.join("."));rows.push(clone(rows[index]));return render();}
    if(name==="reference-row-add"){const ref=getPath(editor.profile,id),rule=editor.profile.standards[Number(id.split(".")[1])],keys=ref.sideBasis==="dominance"?["DOM","ND"]:rule.context?.paired?["L","R"]:["C"];ref.groups||=[];ref.groups.push({sex:"male",ageMin:null,ageMax:null,mode:"any",values:Object.fromEntries((keys.length?keys:["C"]).map(k=>[k,null]))});return render();}
    if(name==="profile-group-add"){
      const rule=editor.profile.standards[Number(id)];rule.referenceGroups||=[];rule.referenceGroups.push({id:"reference_"+uid(),sex:"any",ageMin:null,ageMax:null,mode:"any",ranges:[],source:""});return render();
    }
    if(name==="profile-group-copy"||name==="profile-group-delete"){
      const [i,j]=id.split(":").map(Number),groups=editor.profile.standards[i].referenceGroups;
      if(name==="profile-group-delete")removeDraftRow("standards."+i+".referenceGroups",j);else groups.push({...clone(groups[j]),id:"reference_"+uid()});return render();
    }
    if(name==="profile-reference-clear"){setPath(editor.profile,id,null);editor.invalid=new Set([...editor.invalid].filter(p=>!p.startsWith(id+".")));return render();}
    if(name==="profile-reference-add"){
      const subjects=Eval.ruleSubjects(lib().catalog,editor.profile),subject=subjects.find(s=>s.id===id),rule=editor.profile.standards.find(r=>r.id===id),row=M.defaults().data.iso.find(r=>r.id===subject.directionId),basis=subject.kind==="balance"?"ratio":"N",anatomical=row&&["neck","trunk"].includes(row.region),keys=row?.paired?anatomical?["L","R"]:["DOM","ND"]:["C"];
      rule.reference=clone(subject.defaultRule?.reference||{enabled:true,basis,sourceId:"user",source:"",statistic:"mean",sideBasis:row?.paired&&!anatomical?"dominance":"anatomical",groups:["male","female"].map(sex=>({sex,ageMin:0,ageMax:120,mode:"any",values:Object.fromEntries(keys.map(k=>[k,""]))}))});rule.reference.enabled=true;return render();
    }
    if(name==="lvp-settings-add"){
      const defaults=M.defaults();for(const [key,value]of Object.entries(defaults.lvp))if((key.startsWith("landmine")?"landmine":key)===id)editor.profile.settings.lvp[key]={...clone(value),protocol:lib().catalog.protocol[id]||"",source:""};editor.analysisOpen=true;return render();
    }
    if(name==="profile-time-new"){
      return showForm("添加 IMTP 时点标准",field("时间 ms",'<input name="timeMs" type="number" min="0.000001" step="any" required>')+field("结果",'<select name="kind"><option value="force_pct_peak">力占峰值力比例 · %PF</option><option value="rfd">0–t 平均 RFD · N/s</option></select>'),async form=>{
        const data=new FormData(form),timeMs=Number(data.get("timeMs")),measureKind=data.get("kind"),subjects=Eval.ruleSubjects(lib().catalog,editor.profile),prior=subjects.find(s=>s.kind==="imtp-time"&&s.measureKind===measureKind);
        if(!prior)throw Error("未找到 IMTP 测量定义，请先确认指标库中的项目");const subject={...clone(prior),id:"imtp-time:"+measureKind+":"+timeMs,timeMs,name:measureKind==="rfd"?`0–${timeMs} ms 平均 RFD`:`${timeMs} ms 力占峰值力比例`};delete subject.defaultRule;Eval.ensureStandard(editor.profile,subject);editor.subjectId=subject.id;
      });
    }
    if(name==="profile-default"){await commit(candidate=>{if(candidate.evaluationProfiles.find(p=>p.id===id)?.disabled)throw Error("请先启用方案");candidate.defaultEvaluationProfileId=id;});return render();}
    if(name==="profile-toggle"){await commit(candidate=>{if(id===candidate.defaultEvaluationProfileId)throw Error("请先指定其他默认方案");const p=candidate.evaluationProfiles.find(p=>p.id===id);p.disabled=!p.disabled;});return render();}
    if(name==="profile-records"){filters.records={...freshFilters(),status:"all",evaluationProfileId:id,originTab:"profiles"};selections.records=new Set();return App.openManagement("records");}
    if(name==="profile-revert"||name==="profile-history")return reviewHistory(id,name==="profile-revert");
    if(name==="restore-library"){if(confirm("切换回上次导入或迁移前保留的资料库？当前资料库仍会保留。"))await App.restorePreviousLibrary();return;}
  }
  function profileInput(control){
    if(!editor||editor.readOnly||!control.dataset.profilePath)return;
    const path=control.dataset.profilePath;let value=control.type==="checkbox"?control.checked:control.type==="number"?control.value===""?null:Number(control.value):control.value;
    if(control.validity.badInput)editor.invalid.add(path);else editor.invalid.delete(path);setPath(editor.profile,path,value);
    const segments=path.split(".").map(decodeURIComponent);
    if(segments[0]==="aggregations"){
      const cfg=editor.profile.aggregations[segments[1]];delete cfg.migrationIssue;
      if(segments.at(-1)==="method"){if(value==="mean"){cfg.members||=[];cfg.transforms||={};}if(value==="primary")cfg.primary||="";delete cfg.migrationIssue;}
      if(segments.at(-1)==="kind"){const transform=getPath(editor.profile,path.slice(0,-5));if(value==="anchors"){transform.points||=[];transform.shape||="higher";}if(value==="table")transform.ranges||=[];if(value==="ratio")transform.direction||="higher";}
    }
    updateScorePreviews();
  }
  function init() {
    document.addEventListener("click",async event=>{
      const target=event.target.closest("[data-manager-action]");if(!target||busy)return;
      event.preventDefault();target.closest(".management-more")?.removeAttribute("open");busy=true;
      try{await action(target.dataset.managerAction,target.dataset.id);}catch(error){showError(error);}finally{busy=false;}
    });
    document.addEventListener("toggle",event=>{
      const detail=event.target;
      if(detail.matches?.('.management-advanced'))filter().advanced=detail.open;
      if(detail.matches?.('.management-more')&&detail.open){
        document.querySelectorAll('.management-more[open]').forEach(other=>{if(other!==detail)other.open=false;});
        const menu=detail.querySelector('.management-more-menu'),rect=detail.querySelector('summary').getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
        menu.style.left=Math.max(12,Math.min(innerWidth-width-12,rect.right-width))+"px";menu.style.top=Math.max(12,rect.bottom+height+8>innerHeight?rect.top-height-6:rect.bottom+6)+"px";
      }
    },true);
    document.addEventListener("pointerdown",event=>document.querySelectorAll('.management-more[open]').forEach(detail=>{if(!detail.contains(event.target))detail.open=false;}));
    document.addEventListener("keydown",event=>{if(event.key==="Escape")document.querySelectorAll('.management-more[open]').forEach(detail=>{detail.open=false;detail.querySelector('summary').focus();});});
    document.addEventListener("input",event=>{
      const t=event.target;
      if(t.id==="teamMemberSearch"){const q=t.value.trim().toLocaleLowerCase();$("managementFields").querySelectorAll("[data-team-candidate]").forEach(el=>el.hidden=!!q&&!el.dataset.teamCandidate.includes(q));}
      if(t.id==="testPlanName"&&planDraft)planDraft.name=t.value;
      if(t.dataset.managerFilter&&t.tagName!=="SELECT"){filter()[t.dataset.managerFilter]=t.value;filter().page=1;selected.clear();clearTimeout(filterTimer);const tab=current;filterTimer=setTimeout(()=>{if(current===tab&&App.getUIState().mode==="management")render({preserveFilters:true});},140);}
      if(t.id==="profileName"&&editor)editor.profile.name=t.value;
      profileInput(t);
      if(t.dataset.scorePreviewSubject&&editor){editor.previewValues[t.dataset.scorePreviewAxis+"/"+t.dataset.scorePreviewSubject]=t.value;updateScorePreviews();}
    });
    document.addEventListener("change",event=>{
      const t=event.target;
      if(t.dataset.managerFilter&&t.tagName==="SELECT"){clearTimeout(filterTimer);filter()[t.dataset.managerFilter]=t.value;filter().page=1;selected.clear();render({preserveFilters:true});}
      if(t.dataset.managerSelect){if(t.checked)selected.add(t.dataset.managerSelect);else selected.delete(t.dataset.managerSelect);render();}
      if(t.id==="selectManagementPage"){const f=filter();allRows().slice((f.page-1)*30,f.page*30).forEach(r=>t.checked?selected.add(r.id):selected.delete(r.id));render();}
      if(t.id==="profileProjectSelect"){editor.projectId=t.value;editor.subjectId="";render();}
      if(t.id==="testPlanProfile"&&planDraft)planDraft.defaultEvaluationProfileId=t.value;
      if(t.dataset.profilePath&&t.tagName==="SELECT"){profileInput(t);if(/\.(method|kind|shape)$/.test(t.dataset.profilePath))render();}
      if(t.dataset.aggregationMember&&editor){
        const axis=t.dataset.aggregationAxis,id=t.dataset.aggregationMember,cfg=editor.profile.aggregations[axis];cfg.members||=[];cfg.transforms||={};
        if(t.checked){if(!cfg.members.includes(id))cfg.members.push(id);const subject=Eval.ruleSubjects(lib().catalog,editor.profile).find(s=>s.id===id),rule=editor.profile.standards.find(r=>r.id===id);cfg.transforms[id]||=subject?.measurementScale==="ratio"?{kind:"ratio",direction:rule?.direction||"higher"}:{kind:"anchors",shape:"higher",points:[]};}
        else cfg.members=cfg.members.filter(x=>x!==id);delete cfg.migrationIssue;render();
      }
    });
    $("managementForm").addEventListener("submit",async event=>{
      event.preventDefault();const form=event.target,submit=form.querySelector('[type="submit"]');if(submit.disabled)return;
      if(!form.reportValidity())return;submit.disabled=true;
      try{await formAction(form);App.close("managementModal");render();App.refreshWorkspace();}
      catch(error){$("managementError").textContent=error.message;$("managementError").hidden=false;}
      finally{submit.disabled=false;}
    });
    window.addEventListener("scroll",()=>{if(App.getUIState().mode==="management")filter().scroll=scrollY;},{passive:true});
    window.addEventListener("beforeunload",event=>{if(editorDirty()){event.preventDefault();event.returnValue="";}});
  }
  function showError(error) {
    const target=$("testPlanError")||$("profileEditorError")||$("managementError");target.textContent=error.message;target.hidden=false;
    if(!target.getClientRects().length){$("saveStatus").textContent=error.message;const node=document.createElement("p");node.className="notice";node.role="alert";node.textContent=error.message;$("managementContent").prepend(node);}
  }
  function showEffective(record,profile) {
    const issues=new Map((record.evaluationIssues||[]).map(x=>[x.id,x.reason]));
    const number=n=>n===""||n==null?"—":Number(n).toLocaleString("zh-CN",{maximumFractionDigits:6});
    const interval=r=>r.min==null?(r.includeMax===false?"<":"≤")+number(r.max):r.max==null?(r.includeMin===false?">":"≥")+number(r.min):r.min===r.max?"="+number(r.min):(r.includeMin===false?"(":"[")+number(r.min)+", "+number(r.max)+(r.includeMax===false?")":"]");
    const ranges=items=>`<ul class="standard-ranges">${items.map(r=>`<li><b>${esc(r.label)}</b>：${esc(interval(r))}</li>`).join("")}</ul>`;
    const rows=record.definitions.filter(d=>record.enabled[d.testId]&&!(record.imtpTimeStandards||[]).some(rule=>d.id==="imtp_"+(rule.kind==="force_pct_peak"?"f":"rfd")+rule.timeMs)).map(d=>`<article class="effective-standard"><h3>${esc(T.metricName(d))}</h3><p>目标：<b title="${esc(d.target)}">${number(d.target)}</b> ${esc(d.unit)} · ${d.direction==="lower"?"数值越低越好":"数值越高越好"}</p>${issues.has(d.id)?'<p class="notice">'+esc(issues.get(d.id))+'</p>':d.referenceEnabled?ranges(d.ranges):'<p class="note">未启用评价分级</p>'}${d.source?'<p class="note">依据：'+esc(d.source)+'</p>':""}</article>`).join("");
    const imtp=record.enabled.imtp?(record.imtpTimeStandards||[]).map(rule=>`<article class="effective-standard"><h3>IMTP ${rule.timeMs} ms ${rule.kind==="rfd"?"平均 RFD":"力占峰值力比例"}</h3>${rule.matched===false?'<p class="notice">时点标准与本次测量条件不匹配</p>':`<p>目标：<b>${number(rule.target)}</b> ${rule.kind==="rfd"?"N/s":"%PF"}</p>${rule.referenceEnabled?ranges(rule.ranges):'<p class="note">未启用评价分级</p>'}`}${rule.source?'<p class="note">依据：'+esc(rule.source)+'</p>':""}</article>`).join(""):"";
    const isoIds=new Set(M.selectedIsoRows(record).map(row=>row.id));
    const iso=record.enabled.iso?'<h3>等长目标</h3>'+M.selectedIsoRows(record).map(r=>{const targets=(r.paired?["L","R"]:[""]).map(side=>{const t=M.effectiveIsoTarget(record,r,side);return `${side?side+" ":""}${t.kind==="reference"?"参考 ":"目标 "}${number(t.target)}${t.target===null?"":" "+r.unit}${t.reason?" · "+t.reason:""}`;});return `<p>${esc(M.REG[r.region])} · ${esc(r.direction)}：<b>${esc(targets.join(" / "))}</b>${issues.has(r.id)?' · '+esc(issues.get(r.id)):""}</p>`;}).join("")+'<h3>关节平衡</h3>'+record.balancePairs.filter(pair=>isoIds.has(pair.numeratorId)&&isoIds.has(pair.denominatorId)).map(p=>`<article class="effective-standard"><h4>${esc(p.label)}</h4>${p.ratioMigrationIssue?'<p class="notice">'+esc(p.ratioMigrationIssue)+'</p>':""}${p.referenceEnabled&&p.confirmed?ranges(p.ranges):'<p class="note">未启用分级或未确认测量条件可比</p>'}${p.source?'<p class="note">依据：'+esc(p.source)+'</p>':""}${p.reference?.enabled?'<p class="note">均值参考：'+esc(p.reference.source)+'</p>':""}</article>`).join(""):"";
    const lvp=Object.entries(record.lvp).filter(([id])=>record.enabled[id.startsWith("landmine")?"landmine":id]).map(([id,p])=>`<article class="effective-standard"><h4>${esc({bench:"卧推",squat:"深蹲",deadlift:"硬拉",landmineL:"地雷杠左侧",landmineR:"地雷杠右侧"}[id])}</h4><p>${esc(p.metric)} · MVT ${number(p.mvt)} m/s</p>${p.zones.map(z=>'<p>'+esc(z.label)+'：'+number(z.min)+'–'+number(z.max)+' m/s</p>').join("")}${p.source?'<p class="note">依据：'+esc(p.source)+'</p>':""}</article>`).join("");
    const axes=Object.entries(record.axes).map(([id,a])=>{const ability=record.definitions.find(d=>T.axisKey(d.ability)===id)?.ability||"能力";return '<p>'+esc(T.abilityLabel(record,ability))+'：'+esc({primary:"代表指标",mean:"固定成员平均分",disabled:"未启用"}[a.method]||a.method)+(a.method==="primary"?' · '+esc(record.definitions.find(d=>"metric:"+d.id===a.primary||d.id===a.primary)?.name||"未选代表指标"):"")+'</p>';}).join("");
    showForm("本次生效标准",`<p>${esc(profile?.name||"未关联方案")} · v${profile?.revision||1}</p>${rows}${imtp}<h3>目标达成与双侧差异</h3>${Object.entries(ruleLabels).map(([id,label])=>'<p>'+esc(label)+'：'+number(record.rules[id])+'</p>').join("")}${axes}${iso}${lvp?'<h3>LVP 参数</h3>'+lvp:""}`,async()=>{});
    $("managementForm").querySelector('[type="submit"]').textContent="关闭";
  }
  root.RingsideManagement={init,open,render,cancelPending:()=>clearTimeout(filterTimer),navigation,tab:()=>current,editAthlete,viewProfile,changesBetween,showEffective,desktopCloseStatus};
})(window);
