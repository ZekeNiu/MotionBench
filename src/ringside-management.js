(function (root) {
  "use strict";
  const M=root.RingsideModel, Eval=root.RingsideEvaluation, T=root.RingsideTests;
  const $=id=>document.getElementById(id), clone=v=>JSON.parse(JSON.stringify(v));
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid=()=>crypto.randomUUID(), now=()=>new Date().toISOString(), lib=()=>App.getLibrary();
  const sections=[["athletes","运动员管理"],["teams","队伍管理"],["records","测试记录"],["plans","测试方案"],["metrics","指标库"],["profiles","评价方案"],["backup","备份与恢复"]];
  let current="athletes", selected=new Set(), filters={}, editor=null, planDraft=null, formAction=null, pendingReview=null, busy=false, filterTimer;
  const filter=()=>filters[current] ||= {q:"",group:"",sport:"",status:"active",from:"",to:"",test:"",page:1,sort:"recent"};
  function button(label,action,id="",extra="") { return `<button type="button" class="btn small" data-manager-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`; }
  const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?"selected":""}>${esc(label)}</option>`;
  const field=(label,html)=>`<label class="field"><span>${label}</span>${html}</label>`;
  function groupOptions(selected="") {return option("","未分组",selected)+lib().groups.map(g=>option(g.id,g.name,selected)).join("");}
  function profileOptions(selected="") {return lib().evaluationProfiles.filter(p=>!p.disabled||p.id===selected).map(p=>option(p.id,p.name,selected)).join("");}
  const profileName=id=>lib().evaluationProfiles.find(p=>p.id===id)?.name||"未关联";
  function navigation(){return sections.map(([id,label])=>`<button data-manager-action="section" data-id="${id}" class="${current===id?"active":""}" ${current===id?'aria-current="page"':""}>${label}</button>`).join("");}
  function open(tab="athletes"){clearTimeout(filterTimer);if(tab==="catalog")tab="metrics";current=sections.some(s=>s[0]===tab)?tab:"athletes";selected.clear();render();requestAnimationFrame(()=>window.scrollTo({top:filter().scroll||0,behavior:"instant"}));}
  function visibleStatus(item,owner) {return item.deletedAt||owner?.deletedAt?"trash":item.archived||owner?.archived?"archived":"active";}
  function allRows() {
    const f=filter();let rows;
    if(current==="athletes") rows=lib().athletes.map(a=>({id:a.id,athlete:a,item:a}));
    else rows=lib().athletes.flatMap(a=>a.records.map(r=>({id:r.recordId,athlete:a,item:r})));
    const q=f.q.trim().toLocaleLowerCase();
    rows=rows.filter(({athlete:a,item:r})=>(f.status==="all"?visibleStatus(r,a)!=="trash":visibleStatus(r,a)===f.status)&&(!f.group||a.groupId===f.group)&&(!f.sport||a.profile.sport===f.sport)&&(!q||[a.name,a.profile.sport,r.title,r.athlete?.date,a.id].join(" ").toLocaleLowerCase().includes(q))&&(!f.from||(r.athlete?.date||"")>=f.from)&&(!f.to||(r.athlete?.date||"")<=f.to)&&(!f.test||r.enabled?.[f.test]));
    rows.sort((a,b)=>f.sort==="name"?a.athlete.name.localeCompare(b.athlete.name,"zh-CN")||a.id.localeCompare(b.id):(b.item.athlete?.date||b.item.updated||"").localeCompare(a.item.athlete?.date||a.item.updated||"")||a.id.localeCompare(b.id));
    return rows;
  }
  function toolbar() {
    const f=filter(),sports=[...new Set(lib().athletes.map(a=>a.profile.sport).filter(Boolean))].sort();
    return `<div class="management-filters">${field("搜索",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="姓名、编号${current==="records"?"或测试名称":"或专项"}">`)}${field("队伍",`<select data-manager-filter="group">${option("","全部队伍",f.group)}${lib().groups.map(g=>option(g.id,g.name,f.group)).join("")}</select>`)}${field("专项",`<select data-manager-filter="sport">${option("","全部专项",f.sport)}${sports.map(s=>option(s,s,f.sport)).join("")}</select>`)}${field("状态",`<select data-manager-filter="status">${[["active","在用"],["archived","已归档"],["trash","回收站"],["all","全部未删除"]].map(([v,n])=>option(v,n,f.status)).join("")}</select>`)}${field("排序",`<select data-manager-filter="sort">${option("recent","最近优先",f.sort)}${option("name","姓名顺序",f.sort)}</select>`)}${current==="records"?field("起始日期",`<input type="date" data-manager-filter="from" value="${esc(f.from)}">`)+field("结束日期",`<input type="date" data-manager-filter="to" value="${esc(f.to)}">`)+field("测试项目",`<select data-manager-filter="test">${option("","全部项目",f.test)}${lib().catalog.tests.map(t=>option(t.id,t.name,f.test)).join("")}</select>`):""}</div>`;
  }
  function lists() {
    const rows=allRows(),f=filter(),pages=Math.max(1,Math.ceil(rows.length/30));f.page=Math.min(pages,Math.max(1,f.page));
    const page=rows.slice((f.page-1)*30,f.page*30),athletes=current==="athletes";
    const actions=f.status==="trash"?button("恢复","restore")+button("永久删除","purge"):button("归档","archive")+button("恢复在用","unarchive")+button("移入回收站","trash")+(athletes?button("调整队伍","batch-group"):button("更换评价方案","batch-profile"));
    return toolbar()+`<div class="management-batch"><label><input type="checkbox" id="selectManagementPage" ${page.length&&page.every(r=>selected.has(r.id))?"checked":""}>选择本页</label><span>已选 ${selected.size} 项</span><div class="row">${actions}</div></div><div class="management-table-wrap"><table class="management-table"><thead><tr><th>选择</th><th>运动员</th><th>队伍 / 专项</th><th>${athletes?"历次测试":"日期 / 项目"}</th><th>${athletes?"状态":"评价方案"}</th><th>操作</th></tr></thead><tbody>${page.map(({id,athlete:a,item:r})=>{
      const state=visibleStatus(r,a),count=a.records.filter(x=>!x.deletedAt).length;
      const rowActions=state==="trash"?button("恢复","restore",id)+button("永久删除","purge",id):athletes?button("资料","edit-athlete",id)+button("新建测试","new-record",id)+button("测试记录","athlete-records",id):button("查看报告","report",id)+button("录入 / 编辑","entry",id)+button("名称 / 日期","edit-record",id);
      return `<tr data-managed-id="${esc(id)}"><td data-label="选择"><input type="checkbox" data-manager-select="${esc(id)}" aria-label="选择 ${esc(a.name)} ${esc(r.athlete?.date||"")}" ${selected.has(id)?"checked":""}></td><td data-label="运动员"><b>${esc(a.name)}</b><small>${esc(a.id.slice(-8))}</small></td><td data-label="队伍 / 专项">${esc(lib().groups.find(g=>g.id===a.groupId)?.name||"未分组")}<small>${esc(a.profile.sport||"未填写专项")}</small></td><td data-label="${athletes?"历次测试":"日期 / 项目"}">${athletes?count+" 条":esc(r.athlete.date||"未填日期")+`<small>${esc(r.title||Object.entries(r.enabled).filter(([,v])=>v).map(([k])=>lib().catalog.tests.find(t=>t.id===k)?.name||k).join("、"))}</small>`}</td><td data-label="${athletes?"状态":"评价方案"}">${athletes?({active:"在用",archived:"已归档",trash:"回收站"}[state]):esc(profileName(r.evaluationProfileId))}</td><td data-label="操作"><div class="row">${rowActions}</div></td></tr>`;
    }).join("")||'<tr><td colspan="6" class="empty">没有符合条件的资料。</td></tr>'}</tbody></table></div><div class="management-pagination"><span>${rows.length} 项 · 每页 30 项</span><div class="row">${button("上一页","page",String(f.page-1),f.page<=1?"disabled":"")}<span>${f.page} / ${pages}</span>${button("下一页","page",String(f.page+1),f.page>=pages?"disabled":"")}</div></div>`;
  }
  function teams() {
    const f=filter(),q=f.q.trim().toLocaleLowerCase(),team=lib().groups.find(g=>g.id===f.teamId);
    if(team){
      const members=lib().athletes.filter(a=>a.groupId===team.id&&!a.deletedAt&&(!q||[a.name,a.profile.sport,a.id].join(" ").toLocaleLowerCase().includes(q)));
      return `<div class="management-team-heading"><div><h2>${esc(team.name)}</h2><p class="note">${members.filter(a=>!a.archived).length} 名在用运动员 · ${members.filter(a=>a.archived).length} 名已归档</p></div><div class="row">${button("返回队伍列表","team-close")}${button("添加 / 转入成员","team-add",team.id)}</div></div>${field("搜索成员",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="姓名、编号或专项">`)}<div class="management-table-wrap"><table class="management-table team-members-table"><thead><tr><th>运动员</th><th>专项</th><th>状态</th><th>操作</th></tr></thead><tbody>${members.map(a=>`<tr data-team-member="${esc(a.id)}"><td data-label="运动员">${esc(a.name)}<small>${esc(a.id.slice(-8))}</small></td><td data-label="专项">${esc(a.profile.sport||"未填写")}</td><td data-label="状态">${a.archived?"已归档":"在用"}</td><td data-label="操作"><div class="row">${button("资料","edit-athlete",a.id)}${button("转队","team-transfer",a.id)}${button("移出队伍","team-remove",a.id)}</div></td></tr>`).join("")||'<tr><td colspan="4" class="empty">暂无符合条件的成员。</td></tr>'}</tbody></table></div>`;
    }
    return field("搜索队伍",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="队伍名称">`)+(lib().groups.filter(g=>!q||g.name.toLocaleLowerCase().includes(q)).map(g=>{
      const members=lib().athletes.filter(a=>a.groupId===g.id&&!a.deletedAt);
      return `<article class="management-catalog-item" data-team-id="${esc(g.id)}"><div><h3>${esc(g.name)}</h3><p class="note">${members.filter(a=>!a.archived).length} 名在用运动员 · ${members.filter(a=>a.archived).length} 名已归档</p></div><div class="row">${button("成员名单","team-open",g.id)}${button("添加 / 转入成员","team-add",g.id)}${button("改名","group-edit",g.id)}${button("删除队伍","group-delete",g.id)}</div></article>`;
    }).join("")||'<p class="empty">暂无符合条件的队伍。</p>');
  }
  function editTeam(id="") {
    const team=lib().groups.find(g=>g.id===id);
    showForm(team?"队伍名称":"新建队伍",field("名称",`<input name="name" required maxlength="100" value="${esc(team?.name||"")}" placeholder="填写队伍或训练组名称">`),async form=>{
      const name=new FormData(form).get("name").trim();if(!name||lib().groups.some(g=>g.id!==id&&g.name===name))throw Error("名称为空或已存在");
      if(team)team.name=name;else lib().groups.push({id:"group_"+uid(),name});await App.saveLibraryChanges();
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
    const f=filter(),q=f.q.trim().toLocaleLowerCase(),profile=metricProfile(),defaults=M.defaults(),record=App.getState();
    const matched=record&&profile?Eval.resolve(record,profile):null,measurement=record?Eval.capture(record):null,issues=new Map((matched?.evaluationIssues||[]).map(x=>[x.id,x.reason]));
    const abilities=T.abilityGroups(lib().catalog),projects=T.describe(lib().catalog).filter(t=>!f.test||t.id===f.test),groups=new Map(abilities.map(g=>[g.key,[]]));
    for(const t of projects){
      const ability=t.primaryAbility||"未分类",label=T.abilityLabel(lib().catalog,ability),conflicted=lib().catalog.conflicts.some(c=>c.testId===t.id&&!c.resolved);
      if(f.ability&&f.ability!==ability)continue;
      const rows=[];
      const add=(id,name,unit,mode,standard,actions)=>{if(!q||[t.name,label,name,unit].join(" ").toLocaleLowerCase().includes(q))rows.push(`<tr data-library-metric="${esc(id)}"><td data-label="项目">${esc(t.name)}</td><td data-label="指标">${esc(name)}</td><td data-label="单位">${esc(unit)}</td><td data-label="数据方式">${esc(mode)}</td><td data-label="评价标准">${standard}</td><td data-label="操作"><div class="row">${actions}</div></td></tr>`);};
      for(const d of t.definitions.filter(d=>t.id!=="imtp"||!/^imtp_(?:f|rfd)\d+$/.test(d.id))){
        const rule=profile?.criteria.definitions.find(x=>x.id===d.id);
        add(d.id,T.metricName(d),d.unit,T.isManualMetric(d)?d.entryScope==="attempt"?"逐试次录入":"单次记录录入":"固定计算",standardSummary(rule)+(issues.has(d.id)?`<small class="standard-mismatch">当前记录：${esc(issues.get(d.id))}</small>`:""),button("编辑指标","metric-edit",d.id,conflicted?"disabled":"")+button("编辑标准","standard-edit",d.id));
      }
      if(t.id==="fms")defaults.data.fms.forEach((r,i)=>add("fms_"+i,r.name,"分",r.bilateral?"双侧录入":"单项录入",'<span>固定 0–3 分；疼痛为 0 分</span>',button("查看评分","standard-fms")));
      if(t.id==="iso"){
        const iso=new Map(defaults.data.iso.map(r=>[r.id,r]));for(const r of profile?.criteria.iso||[])iso.set(r.id,r);
        for(const r of iso.values()){const rule=profile?.criteria.iso.find(x=>x.id===r.id);add(r.id,isoName(r),r.unit,r.paired?"双侧测量":"单值测量",(rule?.target!==""&&rule?.target!=null?`目标 ${esc(rule.target)} ${esc(rule.unit)}`:rule?.reference?.enabled?`<span>文献均值参考 · ${esc(rule.reference.basis)}</span><small>${esc(rule.reference.source)}</small>`:'<span class="note">未配置目标</span>')+(issues.has(r.id)?`<small class="standard-mismatch">当前记录：${esc(issues.get(r.id))}</small>`:""),button("编辑目标 / 参考","standard-iso",r.id));}
        for(const p of profile?.criteria.balance||defaults.balancePairs){const actual=measurement?.balance.find(x=>x.id===p.id),mismatch=record?.enabled.iso&&actual&&Eval.canonical(actual.contexts)!==Eval.canonical(p.contexts);add("balance_"+p.id,p.label,"比值","关节平衡",standardSummary(p)+(mismatch?'<small class="standard-mismatch">当前记录：测量条件不匹配</small>':""),button("编辑标准","standard-balance",p.id));}
      }
      if(t.id==="imtp")for(const time of imtpTimes(profile,record))for(const kind of ["force_pct_peak","rfd"]){
        const rule=profile?.criteria.imtpTimeStandards?.find(r=>r.kind===kind&&r.timeMs===time),legacy=profile?.criteria.definitions.find(d=>d.id===(kind==="rfd"?"imtp_rfd":"imtp_f")+time);
        const standard=rule?standardSummary(rule)+(record&&!Eval.imtpTimeMatches?.(record,rule)?'<small class="standard-mismatch">当前记录：测量条件不匹配</small>':""):kind==="force_pct_peak"&&legacy?'<span class="note">旧标准单位为 N；%PF 标准尚未配置</span>':standardSummary(legacy);
        add(kind+":"+time,kind==="force_pct_peak"?`${time} ms 力占峰值力比例`:`0–${time} ms 平均 RFD`,kind==="force_pct_peak"?"%PF":"N/s","逐试次录入",standard,button("编辑标准","standard-time",kind+":"+time));
      }
      for(const [id,p]of Object.entries(profile?.criteria.lvp||{}).filter(([id])=>(id.startsWith("landmine")?"landmine":id)===t.id)){const actual=measurement?.lvp[id],mismatch=record?.enabled[t.id]&&actual&&(actual.metric!==p.metric||actual.protocol!==p.protocol);add("lvp_"+id,"负荷–速度参数"+(id==="landmineL"?" · 左":id==="landmineR"?" · 右":""),"m/s",p.metric,`MVT ${esc(p.mvt||"未配置")}<small>${esc((p.zones||[]).map(z=>z.label+" "+z.min+"–"+z.max).join("；"))}</small>${mismatch?'<small class="standard-mismatch">当前记录：速度口径或协议不匹配</small>':""}`,button("编辑参数","standard-lvp",id));}
      if(!rows.length&&q&&![t.name,label].join(" ").toLocaleLowerCase().includes(q))continue;
      if(!groups.has(ability))groups.set(ability,[]);
      const otherAbilities=t.abilities.filter(a=>a!==ability).map(a=>T.abilityLabel(lib().catalog,a));
      groups.get(ability).push(`<tbody data-metric-project="${esc(t.id)}"><tr class="metric-project-heading"><th colspan="6"><div class="metric-project-header"><div><h3>${esc(t.name)} ${t.disabled?'<span class="pill">已停用</span>':""}${conflicted?'<span class="pill">待确认版本</span>':""}</h3><p class="note">${t.category==="screen"?"筛查":"运动表现"}${otherAbilities.length?" · 指标还涉及："+esc(otherAbilities.join("、")):""}</p></div><div class="row">${button("编辑项目","catalog-edit",t.id,conflicted?"disabled":"")}${button("新增指标","new-metric",t.id,conflicted?"disabled":"")}${t.id==="imtp"?button("添加时点标准","standard-time-new"):""}${button(t.disabled?"启用":"停用","catalog-toggle",t.id)}</div></div>${lib().catalog.protocol[t.id]?`<p class="metric-project-protocol">${esc(lib().catalog.protocol[t.id])}</p>`:""}</th></tr>${rows.join("")||'<tr><td colspan="6" class="empty">此项目暂无数值指标，可从项目上方新增。</td></tr>'}</tbody>`);
    }
    const sections=[...groups].filter(([key,tables])=>(!f.ability||f.ability===key)&&(tables.length||!f.test&&(!q||T.abilityLabel(lib().catalog,key).toLocaleLowerCase().includes(q)))).map(([key,tables])=>{const i=abilities.findIndex(g=>g.key===key);return `<section class="metric-ability-group" data-metric-ability="${esc(key)}"><div class="metric-ability-heading"><h2>${esc(T.abilityLabel(lib().catalog,key))}</h2><div class="row">${button("改名","ability-edit",key)}${button("上移","ability-up",key,i<=0?"disabled":"")}${button("下移","ability-down",key,i<0||i>=abilities.length-1?"disabled":"")}</div></div>${tables.length?`<div class="management-table-wrap"><table class="management-table metric-library-table"><thead><tr><th>项目</th><th>指标</th><th>单位</th><th>数据方式</th><th>评价标准</th><th>操作</th></tr></thead>${tables.join("")}</table></div>`:'<div class="metric-ability-empty"><p>此能力分类暂无项目。新建项目或编辑已有项目时，可选择此分类。</p>'+button("新建项目","new-test",key)+'</div>'}</section>`;}).join("");
    const derived=(!f.ability||f.ability==="training-analysis")&&!f.test?derivedLibrary(q):"";
    return catalogNotices()+`<div class="management-filters metrics-filters">${field("搜索",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="项目、指标或能力">`)}${field("能力分类",`<select data-manager-filter="ability">${option("","全部能力",f.ability)}${abilities.map(g=>option(g.key,g.name,f.ability)).join("")}${option("training-analysis",T.analysisLabel,f.ability)}</select>`)}${field("所属项目",`<select data-manager-filter="test">${option("","全部项目",f.test)}${lib().catalog.tests.map(t=>option(t.id,t.name+(t.disabled?"（已停用）":""),f.test)).join("")}</select>`)}${field("查看 / 编辑评价方案",`<select id="metricEvaluationProfile" data-manager-filter="profileId">${profileOptions(profile?.id)}</select>`)}</div><p class="note">分类、项目与指标定义的修改用于后续测试。${esc(profile?.name||"暂无评价方案")}中的评价标准修改会用于关联此方案的记录。</p>${sections+derived||'<p class="empty">没有符合条件的项目或指标。</p>'}`;
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
    const library=lib(),previous=library.catalog;
    catalog.revision=(Number(previous.revision)||1)+1;library.catalog=catalog;
    try{await App.saveLibraryChanges();}
    catch(error){if(lib()===library&&library.catalog===catalog)library.catalog=previous;throw error;}
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
  function metricProfile(){const f=filters.metrics||={},id=f.profileId||App.getState()?.evaluationProfileId||lib().defaultEvaluationProfileId;return lib().evaluationProfiles.find(p=>p.id===id)||lib().evaluationProfiles.find(p=>p.id===lib().defaultEvaluationProfileId);}
  function isoName(row){return M.REG[row.region]+" · "+(row.region==="neck"?row.direction.replace(/[（(](?:左\s*\/\s*右|中线)[）)]/g,""):row.direction);}
  function standardSummary(rule){if(!rule||!rule.referenceEnabled&&(rule.target===""||rule.target==null)&&!rule.ranges?.length&&!rule.referenceGroups?.length)return '<span class="note">未设置评价标准</span>';return `<span>${rule.target!==""&&rule.target!=null?"目标 "+esc(rule.target)+" · ":""}${rule.direction==="lower"?"数值越低越好":rule.direction==="higher"?"数值越高越好":""}</span>${rule.referenceEnabled?`<small>${rule.referenceGroups?esc(rule.referenceGroups.length+" 组年龄 / 性别 / 测试方式标准"):esc(Def.rangeText(rule.ranges||[]))}</small>`:'<small>未启用分级</small>'}${rule.source?`<small>${esc(rule.source)}</small>`:""}`;}
  function imtpTimes(profile,record){const times=new Set((profile?.criteria.imtpTimeStandards||[]).map(r=>r.timeMs));for(const d of profile?.criteria.definitions||[]){const match=d.id.match(/^imtp_(?:f|rfd)(\d+)$/);if(match)times.add(Number(match[1]));}for(const trial of record?.data.imtp||[])for(const p of trial.timePoints||[])if(Number(p.timeMs)>0)times.add(Number(p.timeMs));return [...times].sort((a,b)=>a-b);}
  function profiles() {
    if(editor)return profileEditor();
    return lib().evaluationProfiles.map(p=>{
      const count=lib().athletes.reduce((n,a)=>n+a.records.filter(r=>r.evaluationProfileId===p.id).length,0);
      return `<article class="management-catalog-item"><div><h3>${esc(p.name)} ${p.id===lib().defaultEvaluationProfileId?'<span class="pill">默认</span>':""}${p.disabled?'<span class="pill">已停用</span>':""}</h3><p class="note">版本 ${p.revision} · 关联 ${count} 条记录</p></div><div class="row">${button("编辑","profile-edit",p.id)}${button("复制","profile-copy",p.id)}${button("设为默认","profile-default",p.id,p.disabled?"disabled":"")}${button("关联记录","profile-records",p.id)}${button(p.disabled?"启用":"停用","profile-toggle",p.id,p.id===lib().defaultEvaluationProfileId?"disabled":"")}${p.previous?button("恢复上一版","profile-revert",p.id):""}</div></article>`;
    }).join("");
  }
  const ruleLabels={asymAmber:"不对称关注阈值 %",asymRed:"不对称重点关注阈值 %",scoreAmber:"目标达成关注下界 %",scoreGreen:"目标达成达标下界 %"};
  const input=(path,value,type="number")=>`<input data-profile-path="${esc(path)}" type="${type}" ${type==="number"?'step="any"':""} value="${esc(value)}">`;
  const check=(path,value,label)=>`<label class="check-line"><input type="checkbox" data-profile-path="${esc(path)}" ${value?"checked":""}>${label}</label>`;
  const select=(path,value,options)=>`<select data-profile-path="${esc(path)}">${options.map(([v,n])=>option(v,n,value)).join("")}</select>`;
  function ranges(path,value,label="评价区间：范围 | 名称 | red / amber / green") {return field(label,`<textarea rows="4" data-profile-ranges="${esc(path)}">${esc(editor.rangeDrafts[path]??Def.rangeText(value))}</textarea>`);}
  function referenceGroupEditor(d,index) {
    const groups=d.referenceGroups||[],base="definitions."+index+".referenceGroups";
    let html=`<section class="profile-rule-block"><h3>年龄、性别与测试方式标准</h3><p class="note">年龄按下限含、上限不含匹配；空白表示不限。分层目标留空时沿用上方目标。峰值 RER 只限制本行分级区间。</p><div class="row">${button("添加分层","profile-group-add",String(index))}</div>`;
    if(!groups.length)return html+'<p class="note">未设置分层标准。</p></section>';
    if(!groups.some(g=>g.id===editor.referenceGroupId))editor.referenceGroupId=groups[0].id;
    html+='<div class="management-table-wrap"><table class="management-table reference-groups-table"><thead><tr><th>性别</th><th>年龄下限</th><th>年龄上限</th><th>测试方式</th><th>最低峰值 RER</th><th>本组训练目标</th><th>操作</th></tr></thead><tbody>';
    html+=groups.map((g,j)=>{const path=base+"."+j;return `<tr data-reference-group="${esc(g.id)}"><td data-label="性别">${select(path+".sex",g.sex,[["any","不限"],["male","男"],["female","女"]])}</td><td data-label="年龄下限">${input(path+".ageMin",g.ageMin)}</td><td data-label="年龄上限">${input(path+".ageMax",g.ageMax)}</td><td data-label="测试方式">${select(path+".mode",g.mode,[["any","不限"],["treadmill","跑台"],["cycle","功率车"]])}</td><td data-label="最低峰值 RER">${input(path+".minPeakRER",g.minPeakRER??"")}</td><td data-label="本组训练目标">${input(path+".target",g.target??"")}</td><td><div class="row">${button("编辑区间","profile-group-select",g.id,g.id===editor.referenceGroupId?'aria-current="true"':"")}${button("复制","profile-group-copy",index+":"+j)}${button("删除","profile-group-delete",index+":"+j)}</div></td></tr>`;}).join("");
    html+='</tbody></table></div>';
    const j=groups.findIndex(g=>g.id===editor.referenceGroupId),g=groups[j],path=base+"."+j;
    html+=`<div class="form-grid">${field("本组来源 / 专项说明",input(path+".source",g.source,"text"))}</div>${g.modified?'<p class="note">本组已按用户设置修改。</p>':""}<div class="management-table-wrap"><table class="management-table reference-ranges-table"><thead><tr><th>下限</th><th>含下限</th><th>上限</th><th>含上限</th><th>名称</th><th>显示颜色</th><th>操作</th></tr></thead><tbody>`;
    html+=g.ranges.map((r,k)=>{const rangePath=path+".ranges."+k;return `<tr><td data-label="下限">${input(rangePath+".min",r.min)}</td><td data-label="含下限">${check(rangePath+".includeMin",r.includeMin!==false,"包含")}</td><td data-label="上限">${input(rangePath+".max",r.max)}</td><td data-label="含上限">${check(rangePath+".includeMax",r.includeMax!==false,"包含")}</td><td data-label="名称">${input(rangePath+".label",r.label,"text")}</td><td data-label="显示颜色">${select(rangePath+".status",r.status,[["gray","中性"],["red","红色"],["amber","黄色"],["green","绿色"]])}</td><td>${button("删除","profile-group-range-delete",index+":"+j+":"+k)}</td></tr>`;}).join("");
    return html+`</tbody></table></div><p class="note">区间端点留空表示无上限或无下限。</p>${button("添加区间","profile-group-range-add",index+":"+j)}</section>`;
  }
  function profileEditor() {
    const r=editor.record,tab=editor.tab, tabs=[["definitions","指标标准"],["imtp","IMTP 时点"],["rules","筛查阈值"],["axes","能力汇总"],["iso","等长目标"],["balance","关节平衡"],["lvp","LVP 参数"]];
    let h=`<div class="profile-editor-header">${field("方案名称",`<input id="profileName" value="${esc(editor.profile.name)}" maxlength="120" ${editor.readOnly?"readonly":""}>`)}<div class="row">${button(editor.origin==="metrics"?"返回指标库":"返回方案列表","profile-close")}${editor.readOnly?button("复制为新方案","profile-copy",editor.profile.id):button("补充新增指标","profile-extend")+button("查看变更并保存","profile-review","",'class="btn primary"')}</div></div><div class="profile-tabs">${tabs.map(([id,label])=>button(label,"profile-tab",id,tab===id?'aria-current="page"':"")).join("")}</div><div id="profileEditorFields">`;
    if(tab==="definitions"){
      const i=Math.max(0,r.definitions.findIndex(d=>d.id===editor.metricId)),d=r.definitions[i];
      h+=field("指标",`<select id="profileMetricSelect">${r.definitions.map(d=>option(d.id,T.metricName(d)+" · "+d.unit,editor.metricId)).join("")}</select>`);
      if(d)h+=`<p class="note">${esc(T.metricProtocol(d)||"未记录协议")} · ${esc(d.unit)} · ${esc(T.abilityLabel(lib().catalog,d.ability))}</p><div class="form-grid">${field(d.testId==="cpet"?"通用训练目标":"评价目标",input("definitions."+i+".target",d.target))}${field("评价方向",select("definitions."+i+".direction",d.direction,[["higher","数值越高越好"],["lower","数值越低越好"]]))}${field("参考来源 / 适用人群",input("definitions."+i+".source",d.source,"text"))}</div>${check("definitions."+i+".referenceEnabled",d.referenceEnabled,"启用评价标准")}${Array.isArray(d.referenceGroups)?referenceGroupEditor(d,i):ranges("definitions."+i+".ranges",d.ranges)+`<div class="row">${d.ranges.map((x,j)=>check("definitions."+i+".ranges."+j+".advantage",x.advantage,esc(x.label)+"认定为优势")).join("")}</div>`+(d.testId==="cpet"?button("添加年龄 / 性别 / 测试方式标准","profile-group-add",String(i)):"")}`;
    } else if(tab==="imtp")h+=imtpStandardEditor();
    else if(tab==="rules")h+='<div class="form-grid">'+Object.entries(ruleLabels).map(([id,label])=>field(label,input("rules."+id,r.rules[id]))).join("")+'</div><p class="note">FMS 保留固定 0–3 分及疼痛判定。</p>';
    else if(tab==="iso")h+='<p class="note">手填目标优先；目标留空时使用已启用的参考均值。参考数值可编辑。</p>'+r.data.iso.map((row,i)=>`<article class="profile-rule-block" data-standard-key="${esc(row.id)}"><div class="profile-rule-row"><b>${esc(isoName(row))}</b>${field("目标 · "+esc(row.unit),input("data.iso."+i+".target",row.target))}<span class="note">${esc(row.protocol||"")}</span></div>${isoReferenceEditor(row.reference,"data.iso."+i+".reference",row)}</article>`).join("");
    else if(tab==="balance")h+=r.balancePairs.map((p,i)=>`<div class="profile-rule-block" data-standard-key="${esc(p.id)}"><h3>${esc(p.label)}</h3><p class="note">${esc(r.data.iso.find(x=>x.id===p.numeratorId)?.direction||"未匹配方向")} / ${esc(r.data.iso.find(x=>x.id===p.denominatorId)?.direction||"未匹配方向")}</p>${p.ratioMigrationIssue?'<p class="notice">'+esc(p.ratioMigrationIssue)+'</p>':""}${check("balancePairs."+i+".referenceEnabled",p.referenceEnabled,"启用评价区间")}${field("依据",input("balancePairs."+i+".source",p.source,"text"))}${ranges("balancePairs."+i+".ranges",p.ranges)}${isoReferenceEditor(p.reference,"balancePairs."+i+".reference",{region:p.region,paired:true},true)}</div>`).join("");
    else if(tab==="axes")h+=[...new Set(r.definitions.filter(d=>d.category==="performance"&&d.ability).map(d=>d.ability))].map(ability=>{
      const id=T.axisKey(ability),defs=r.definitions.filter(d=>d.ability===ability),cfg=T.axisConfig(r,ability)||{method:"primary",primary:defs[0].id};r.axes[id]=cfg;
      return `<div class="profile-rule-row"><b>${esc(T.abilityLabel(lib().catalog,ability))}</b>${field("汇总方式",`<select data-profile-axis="${esc(id)}" data-axis-field="method">${[["primary","代表指标"],["mean","平均达成"],["min","最低达成"]].map(([v,n])=>option(v,n,cfg.method)).join("")}</select>`)}${field("代表指标",`<select data-profile-axis="${esc(id)}" data-axis-field="primary">${defs.map(d=>option(d.id,T.metricName(d),cfg.primary)).join("")}</select>`)}</div>`;
    }).join("");
    else if(tab==="lvp")h+=Object.entries(r.lvp).map(([id,p])=>`<div class="profile-rule-block" data-standard-key="${esc(id)}"><h3>${esc({bench:"卧推",squat:"深蹲",deadlift:"硬拉",landmineL:"地雷杠 L",landmineR:"地雷杠 R"}[id])}</h3><div class="form-grid">${field("适用速度口径",select("lvp."+id+".metric",p.metric,[["MV","平均速度 MV"],["MPV","平均推进速度 MPV"],["PV","峰值速度 PV"]]))}${field("MVT m/s",input("lvp."+id+".mvt",p.mvt))}${field("依据 / 设备",input("lvp."+id+".source",p.source||"","text"))}</div>${field("素质区间：下限..上限 | 名称",`<textarea rows="4" data-profile-zones="${id}">${esc(editor.zoneDrafts[id]??p.zones.map(z=>z.min+".."+z.max+" | "+z.label).join("\n"))}</textarea>`)}</div>`).join("");
    h+='</div><p id="profileEditorError" class="field-error" role="alert"></p>';
    return h;
  }
  function isoReferenceEditor(ref,path,row,balance=false) {
    if(!ref)return !balance?button("设置参考","profile-iso-reference-add",path):"";
    const keys=ref.sideBasis==="dominance"?["DOM","ND"]:row.paired?["L","R"]:["C"];
    const names={DOM:"优势手侧",ND:"非优势侧",L:"L",R:"R",C:"单项"};
    let h=`<details class="iso-reference-editor"><summary>${esc(ref.enabled?"参考均值":"参考均值 · 已停用")} · ${esc(ref.source)}</summary><div class="form-grid">${check(path+".enabled",ref.enabled,"启用参考均值")}${field("数值单位",select(path+".basis",ref.basis,balance?[["ratio","比值"]]:[["N","N"],["N/kg","N/kg"],["%BW","体重百分比 %BW"]]))}${field("参考来源",input(path+".source",ref.source,"text"))}</div><div class="management-table-wrap"><table class="management-table"><thead><tr><th>性别</th><th>年龄下限</th><th>年龄上限（不含）</th><th>统计方式</th>${keys.map(key=>'<th>'+names[key]+'</th>').join("")}</tr></thead><tbody>`;
    h+=ref.groups.map((g,j)=>{const p=path+".groups."+j;return `<tr><td data-label="性别">${g.sex==="male"?"男":"女"}</td><td data-label="年龄下限">${input(p+".ageMin",g.ageMin)}</td><td data-label="年龄上限">${input(p+".ageMax",g.ageMax)}</td><td data-label="统计方式">${{best:"最好值",mean:"均值",any:"通用参考"}[g.mode]}</td>${keys.map(key=>`<td data-label="${names[key]}">${input(p+".values."+key,g.values[key]??"")}</td>`).join("")}</tr>`;}).join("");
    return h+`</tbody></table></div><div class="row">${button("清除参考","profile-iso-reference-clear",path)}</div></details>`;
  }
  function imtpStandardEditor(){
    const r=editor.record;r.imtpTimeStandards||=[];
    const choices=new Set(imtpTimes(editor.profile,App.getState()).flatMap(time=>["force_pct_peak:"+time,"rfd:"+time]));for(const rule of r.imtpTimeStandards)choices.add(rule.kind+":"+rule.timeMs);if(editor.timeKey)choices.add(editor.timeKey);
    const keys=[...choices].sort((a,b)=>Number(a.split(":")[1])-Number(b.split(":")[1])||a.localeCompare(b));editor.timeKey ||= keys[0];
    const label=key=>{const[kind,time]=key.split(":");return kind==="rfd"?`0–${time} ms 平均 RFD · N/s`:`${time} ms 力占峰值力比例 · %PF`;};
    let h=`<div class="row">${field("时点指标",`<select id="imtpStandardSelect">${keys.map(key=>option(key,label(key),editor.timeKey)).join("")}</select>`)}${button("添加时点","profile-time-new")}</div>`;
    if(!editor.timeKey)return h+'<p class="empty">尚未配置时点标准。</p>';
    const[kind,time]=editor.timeKey.split(":"),timeMs=Number(time),i=r.imtpTimeStandards.findIndex(x=>x.kind===kind&&x.timeMs===timeMs),rule=r.imtpTimeStandards[i];
    if(!rule){const legacy=r.definitions.find(d=>d.id===(kind==="rfd"?"imtp_rfd":"imtp_f")+time);
      if(kind==="force_pct_peak"&&legacy)return h+`<div class="notice"><h3>旧力值标准 · ${time} ms · N</h3>${standardSummary(legacy)}<p>切换后请重新填写 %PF 目标和区间。原始力值与其他记录数据保持原样。</p>${button("切换为 %PF 并清空阈值","profile-time-create",editor.timeKey)}</div>`;
      return h+`<p class="note">尚未配置此时点标准。</p>${button("配置此时点标准","profile-time-create",editor.timeKey)}`;
    }
    const path="imtpTimeStandards."+i,unit=kind==="rfd"?"N/s":"%PF",context=rule.context;
    h+=`<p class="note">${esc(context.protocol||"未记录协议")} · ${context.force.definition==="net"?"净力":"总力"} · ${unit}</p><div class="form-grid">${field("评价目标 · "+unit,input(path+".target",rule.target))}${field("评价方向",select(path+".direction",rule.direction,[["higher","数值越高越好"],["lower","数值越低越好"]]))}${field("参考来源 / 适用人群",input(path+".source",rule.source,"text"))}</div>${check(path+".referenceEnabled",rule.referenceEnabled,"启用评价标准")}${ranges(path+".ranges",rule.ranges)}`;
    return h;
  }
  function createTimeRule(key){
    const[kind,time]=key.split(":"),timeMs=Number(time),r=editor.record;r.imtpTimeStandards||=[];
    if(r.imtpTimeStandards.some(x=>x.kind===kind&&x.timeMs===timeMs))return;
    const legacy=kind==="rfd"?r.definitions.find(d=>d.id==="imtp_rfd"+time):null;
    const source=legacy?r:App.getState()?.enabled.imtp?App.getState():r;
    r.imtpTimeStandards.push({kind,timeMs,context:Eval.imtpTimeContext(source),target:legacy?.target??null,ranges:clone(legacy?.ranges||[]),direction:legacy?.direction||"higher",referenceEnabled:!!legacy?.referenceEnabled,source:legacy?.source||""});
    editor.timeKey=key;render();
  }
  function newTimeStandard(fromLibrary=false){
    showForm("添加 IMTP 时点标准",`<div class="form-grid">${field("时间 ms",'<input name="timeMs" type="number" min="0.000001" step="any" required>')}${field("指标",'<select name="kind"><option value="force_pct_peak">力占峰值力比例 · %PF</option><option value="rfd">0–t 平均 RFD · N/s</option></select>')}</div>`,async form=>{
      const data=new FormData(form),time=Number(data.get("timeMs"));if(!Number.isFinite(time)||time<=0)throw Error("时间须为正数");const key=data.get("kind")+":"+time;
      if(fromLibrary)openStandard("time",key);else editor.timeKey=key;
      if(!editor.record.imtpTimeStandards?.some(x=>x.kind===data.get("kind")&&x.timeMs===time)&&!(data.get("kind")==="force_pct_peak"&&editor.record.definitions.some(d=>d.id==="imtp_f"+time)))createTimeRule(key);
    });
  }
  function openStandard(kind,id){
    const profile=metricProfile();if(!profile)throw Error("请先创建评价方案");if(!viewProfile(profile.id))return;App.openManagement("profiles");editor.origin="metrics";
    editor.tab=kind==="edit"?"definitions":kind==="time"?"imtp":kind;
    if(kind==="edit"){
      if(!editor.record.definitions.some(d=>d.id===id)){const source=M.recordFromCatalog(lib().catalog,{},Object.fromEntries(lib().catalog.tests.map(t=>[t.id,true]))),d=Eval.capture(source).definitions.find(d=>d.id===id);if(!d)throw Error("指标不存在");if(!Eval.hasInstalledStandard(d))Object.assign(d,{target:null,ranges:[],referenceEnabled:false,source:""});editor.record.definitions.push(clone(d));editor.profile.criteria.definitions.push(clone(d));}
      editor.metricId=id;
    }
    if(kind==="time")editor.timeKey=id;
    render();
    if(["iso","balance","lvp"].includes(kind))requestAnimationFrame(()=>{const el=[...$("profileEditorFields").querySelectorAll("[data-standard-key]")].find(n=>n.dataset.standardKey===id);el?.scrollIntoView({block:"center"});el?.querySelector("input,textarea,select")?.focus({preventScroll:true});});
  }
  function backup() {return `<div class="backup-grid"><article class="form-card"><h2>完整备份</h2><p>包含运动员、历次测试、队伍、回收站、测试方案、指标库和评价方案。</p><button class="btn primary" onclick="App.downloadLibrary()">导出完整备份</button></article><article class="form-card"><h2>导入与恢复</h2>${field("导入方式",'<select id="backupImportMode"><option value="merge">合并到当前资料库</option><option value="replace">恢复为完整资料库</option></select>')}<button class="btn primary" onclick="document.getElementById('importFile').click()">选择备份文件</button><p class="note">支持完整 JSONL 备份、旧 JSON 和已保存的 HTML。</p>${button("恢复上次资料库","restore-library")}</article><article class="form-card"><h2>旧版兼容与迁移前资料</h2><p>旧版兼容导出包含未删除的测试记录及旧版支持的生效标准；不包含队伍、无测试档案、测试方案、新增 IMTP 时点标准、独立能力分类编号与顺序快照。VIFT 方法原文保留，旧版不提供其编辑入口。峰值百分比不会写成 N 标准。</p><div class="row"><button class="btn" onclick="App.downloadLegacyLibrary()">导出旧版兼容 JSON</button><button class="btn" onclick="App.downloadPreMigration()">下载迁移前资料</button></div></article></div>`;}
  function render(options={}) {
    if(!lib())return;
    const focused=document.activeElement, key=focused?.dataset.managerFilter, caret=focused?.selectionStart;
    const title=sections.find(([id])=>id===current)[1];
    const action=current==="athletes"?button("＋ 新建运动员","new-athlete"):current==="teams"?button("＋ 新建队伍","group-new"):current==="plans"&&!planDraft?button("＋ 新建测试方案","plan-new"):current==="records"?button("＋ 新建测试","choose-new-record"):current==="metrics"?button("＋ 新建能力","ability-new")+button("＋ 新建项目","new-test")+button("＋ 新增指标","new-metric"):current==="profiles"&&!editor?button("＋ 新建方案","profile-new"):"";
    const content=$("managementContent"),html=`<div class="management-heading"><div><h1>${title}</h1></div><div class="row">${action}</div></div>`+(current==="athletes"||current==="records"?lists():current==="teams"?teams():current==="plans"?testPlans():current==="metrics"?metrics():current==="profiles"?profiles():backup());
    const filterBar=node=>{const control=node.querySelector("[data-manager-filter]");return control?.closest(".management-filters")||control?.closest(".field");};
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
    if(editor?.readOnly&&current==="profiles") $("profileEditorFields")?.querySelectorAll("input,select,textarea").forEach(el=>el.disabled=true);
    if(key){const el=$("managementContent").querySelector(`[data-manager-filter="${key}"]`);el?.focus({preventScroll:true});if(caret!==null&&el?.setSelectionRange)try{el.setSelectionRange(caret,caret);}catch{}}
  }
  function showForm(title,html,action) {
    formAction=action;$("managementForm").querySelector('[type="submit"]').textContent="保存";$("managementModalTitle").textContent=title;$("managementFields").innerHTML=html;$("managementError").hidden=true;$("managementForm").querySelector('[type="submit"]').disabled=false;App.modal("managementModal");
  }
  function editAthlete(id="") {
    const a=lib().athletes.find(a=>a.id===id)||(id?App.getAthlete?.(id):null),p=a?.profile||{};
    showForm(a?"编辑运动员资料":"新建运动员",root.RingsideProfile.render({...p,name:p.name||a?.name||""},{groups:lib().groups,groupId:a?.groupId||""}),async form=>{
      const {profile,groupId}=root.RingsideProfile.read(form);
      await App.updateAthleteProfile(id,{...p,...profile},groupId);
    });
  }
  function groups() {
    return App.openManagement("teams");
  }
  async function cleanup(action,id) {
    const ids=id?[id]:[...selected];if(!ids.length)throw Error("请先选择资料");
    const athletes=current==="athletes",selectedAthletes=athletes?lib().athletes.filter(a=>ids.includes(a.id)):[];
    const records=athletes?selectedAthletes.flatMap(a=>a.records):lib().athletes.flatMap(a=>a.records).filter(r=>ids.includes(r.recordId));
    if(action==="purge"&&!confirm(`永久删除 ${athletes?selectedAthletes.length+" 名运动员及其 ":""}${records.length} 条测试记录？此操作无法从回收站恢复。`))return;
    if(action==="trash"&&!confirm(`将 ${athletes?selectedAthletes.length+" 名运动员及其 ":""}${records.length} 条记录移入回收站？`))return;
    const changes=[],removals={};
    if(athletes){for(const a of selectedAthletes){if(action==="archive")a.archived=true;if(action==="unarchive")a.archived=false;if(action==="trash")a.deletedAt=now();if(action==="restore")a.deletedAt=null;}}
    if(!athletes||["trash","restore","purge"].includes(action))for(const summary of records){
      if(action==="purge"){(removals.records||=[]).push(summary.recordId);continue;}
      const r=await App.getRepository().loadRecord(summary.recordId);
      if(action==="archive")r.archived=true;if(action==="unarchive")r.archived=false;
      if(action==="trash"&&!r.deletedAt){r.deletedAt=now();if(athletes)r.deletedWithAthlete=r.athleteId;}
      if(action==="restore"&&(!athletes||r.deletedWithAthlete===r.athleteId)){r.deletedAt=null;delete r.deletedWithAthlete;}
      changes.push(r);
    }
    if(action==="purge"&&athletes)lib().athletes=lib().athletes.filter(a=>!ids.includes(a.id));
    if(action==="restore"&&!athletes)for(const r of changes){const a=lib().athletes.find(a=>a.id===r.athleteId);if(a?.deletedAt)throw Error("请先恢复该记录所属的运动员");}
    await App.saveLibraryChanges(changes,removals);selected.clear();render();
  }
  function viewProfile(id,readOnly=false) {
    const profile=lib().evaluationProfiles.find(p=>p.id===id);if(!profile||!discardEditor())return false;
    editor={profile:clone(profile),record:Eval.template(profile),tab:"definitions",metricId:profile.criteria.definitions[0]?.id,rangeDrafts:{},zoneDrafts:{},readOnly};editor.baseline=editorSnapshot();pendingReview=null;render();return true;
  }
  function editorSnapshot(){return editor?Eval.canonical({name:editor.profile.name,record:editor.record,ranges:editor.rangeDrafts,zones:editor.zoneDrafts}):"";}
  function editorDirty(){return !!editor&&!editor.readOnly&&(editor.isNew||editorSnapshot()!==editor.baseline);}
  function discardEditor(){if(editorDirty()&&!confirm("当前评价方案有未保存修改，放弃这些修改？"))return false;editor=null;return true;}
  function parseProfile() {
    if (editor.invalid?.size) throw Error("请修正未完成的数值输入");
    for(const [path,text] of Object.entries(editor.rangeDrafts)){
      const old=getPath(editor.record,path),ranges=Def.parseRanges(text);
      setPath(editor.record,path,ranges.map(r=>({...r,advantage:old.find(x=>x.label===r.label)?.advantage||false})));
    }
    for(const[id,text]of Object.entries(editor.zoneDrafts)) editor.record.lvp[id].zones=text.split(/\r?\n/).filter(s=>s.trim()).map(line=>{
      const [range,label]=line.split("|").map(s=>s.trim()),m=range.match(/^(\d*\.?\d+)\s*\.\.\s*(\d*\.?\d+)$/);
      if(!m||!label||Number(m[2])<=Number(m[1]))throw Error("LVP 区间请填写：下限..上限 | 名称");return {min:Number(m[1]),max:Number(m[2]),label};
    });
    const updated={...clone(editor.profile),criteria:Eval.fromTemplate(editor.record,editor.profile)};Eval.validateProfile(updated);return updated;
  }
  function changesBetween(old,next) {
    const rows=[],add=(name,a,b)=>{if(Eval.canonical(a)!==Eval.canonical(b))rows.push([name,a,b]);};
    const metric=d=>d?`${d.referenceEnabled?"启用":"未启用"} · 目标 ${d.target??"—"} ${d.unit} · ${d.direction==="higher"?"越高越好":"越低越好"}\n${Def.rangeText(d.ranges)}\n${d.source||""}`:"未包含";
    for(const d of next.definitions)add(T.metricName(d),metric(old.definitions.find(x=>x.id===d.id)),metric(d));
    const groupText=g=>g?`${{male:"男",female:"女",any:"不限性别"}[g.sex]} · 年龄 [${g.ageMin??"不限"}, ${g.ageMax??"不限"}) · ${{treadmill:"跑台",cycle:"功率车",any:"不限方式"}[g.mode]} · 最低峰值 RER ${g.minPeakRER??"不限"} · 目标 ${g.target??"沿用通用目标"}\n${Def.rangeText(g.ranges)}\n${g.source}`:"未包含";
    for(const d of next.definitions){const prior=old.definitions.find(x=>x.id===d.id),groups=d.referenceGroups||[],before=prior?.referenceGroups||[];for(const id of new Set([...before.map(g=>g.id),...groups.map(g=>g.id)]))add(T.metricName(d)+" · 分层标准 "+id,groupText(before.find(g=>g.id===id)),groupText(groups.find(g=>g.id===id)));}
    for(const rule of next.imtpTimeStandards||[]){const unit=rule.kind==="rfd"?"N/s":"%PF",prior=old.imtpTimeStandards?.find(x=>x.timeMs===rule.timeMs&&x.kind===rule.kind);add(`IMTP ${rule.timeMs} ms ${rule.kind==="rfd"?"RFD · N/s":"力占峰值力 · %PF"}`,metric(prior?{...prior,unit}:null),metric({...rule,unit}));}
    for(const[k,label]of Object.entries(ruleLabels))add(label,old.rules[k],next.rules[k]);
    const isoReference=ref=>!ref?"未配置参考":`${ref.enabled?"启用":"停用"} · ${ref.basis} · ${ref.source}\n${ref.groups.map(g=>`${g.sex==="male"?"男":"女"} [${g.ageMin},${g.ageMax}) ${g.mode}：${Object.entries(g.values).map(([k,v])=>k+" "+(v??"—")).join(" / ")}`).join("\n")}`;
    for(const row of next.iso){const prior=old.iso.find(x=>x.id===row.id);add(M.REG[row.region]+" · "+row.direction,`目标 ${prior?.target??"—"}\n${isoReference(prior?.reference)}`,`目标 ${row.target??"—"}\n${isoReference(row.reference)}`);}
    const balance=p=>p?`${p.referenceEnabled?"启用":"未启用"} · ${Def.rangeText(p.ranges)} · ${p.source||"未注明依据"}\n${isoReference(p.reference)}`:"未包含";
    for(const p of next.balance)add("关节平衡 "+p.label,balance(old.balance.find(x=>x.id===p.id)),balance(p));
    const lvp=p=>p?`${p.metric} · MVT ${p.mvt??"—"} m/s\n${(p.zones||[]).map(z=>z.min+"–"+z.max+" m/s："+z.label).join("\n")}\n${p.source||"未注明依据"}`:"未包含";
    for(const[id,p]of Object.entries(next.lvp))add("LVP "+({bench:"卧推",squat:"深蹲",deadlift:"硬拉",landmineL:"地雷杠左侧",landmineR:"地雷杠右侧"}[id]||id),lvp(old.lvp[id]),lvp(p));
    const axis=(a,c)=>a?({primary:"代表指标",mean:"平均达成",min:"最低达成"}[a.method]||a.method)+" · "+(c.definitions.find(d=>d.id===a.primary)?.name||"未选代表指标"):"未设置";
    for(const id of new Set([...Object.keys(old.axes),...Object.keys(next.axes)])){const ability=next.definitions.find(d=>T.axisKey(d.ability)===id)?.ability||"能力汇总";add(T.abilityLabel(lib().catalog,ability),axis(old.axes[id],old),axis(next.axes[id],next));}return rows;
  }
  function reviewProfile() {
    const next=parseProfile(),original=lib().evaluationProfiles.find(p=>p.id===next.id),diff=changesBetween(original?.criteria||next.criteria,next.criteria);
    const affected=lib().athletes.reduce((n,a)=>n+a.records.filter(r=>r.evaluationProfileId===next.id).length,0);
    pendingReview=next;
    showForm("保存评价方案",`<p><b>${esc(next.name)}</b> · ${affected} 条关联记录将使用此版本。</p>${diff.length?`<div class="management-table-wrap"><table class="profile-diff"><thead><tr><th>项目</th><th>原配置</th><th>新配置</th></tr></thead><tbody>${diff.map(([n,a,b])=>`<tr><td>${esc(n)}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</tbody></table></div>`:'<p>评价数值未改变；将保存方案名称或新增方案。</p>'}`,async()=>{
      const index=lib().evaluationProfiles.findIndex(p=>p.id===next.id),prior=lib().evaluationProfiles[index];
      const saved={...next,revision:prior?prior.revision+1:1,updated:now()};
      if(prior)saved.previous={name:prior.name,criteria:clone(prior.criteria),revision:prior.revision,updated:prior.updated};
      if(index<0)lib().evaluationProfiles.push(saved);else lib().evaluationProfiles[index]=saved;
      const origin=editor.origin;await App.saveLibraryChanges();editor=null;pendingReview=null;if(origin==="metrics")App.openManagement("metrics");
    });
  }
  function getPath(obj,path){return path.split(".").reduce((v,k)=>v?.[k],obj);}
  function setPath(obj,path,value){const keys=path.split(".");if(keys.some(k=>["__proto__","constructor","prototype"].includes(k)))throw Error("无效字段");let current=obj;for(const k of keys.slice(0,-1))current=current[k];current[keys.at(-1)]=value;}
  function markReferenceEdited(path){
    const iso=path.match(/^((?:data\.iso|balancePairs)\.\d+\.reference)\.(.+)$/);
    if(iso&&iso[2]!=="enabled"&&iso[2]!=="source"){const ref=getPath(editor.record,iso[1]);if(ref&&!ref.source.includes("用户调整"))ref.source+="（用户调整）";return;}
    const match=path.match(/^definitions\.(\d+)\.referenceGroups\.(\d+)\.(.+)$/);if(!match||match[3]==="target")return;
    const group=editor.record.definitions[Number(match[1])].referenceGroups[Number(match[2])];group.modified=true;
    if(group.sourceId==="friend-2022-rer110"&&match[3]!=="source"&&!group.source.includes("用户调整"))group.source+="（用户调整）";
  }
  function clearGroupInputErrors(index){if(editor.invalid)for(const path of [...editor.invalid])if(path.startsWith("definitions."+index+".referenceGroups"))editor.invalid.delete(path);}
  async function action(name,id) {
    if(name==="profile-iso-reference-clear"){if(editor.readOnly)throw Error("请先复制为新方案");setPath(editor.record,id,null);return render();}
    if(name==="profile-iso-reference-add"){
      if(editor.readOnly)throw Error("请先复制为新方案");
      const row=getPath(editor.record,id.replace(/\.reference$/,""));
      const builtin=root.RingsideIsoReferences?.defaultReference(row);
      const anatomical=["neck","trunk"].includes(row.region),keys=row.paired?anatomical?["L","R"]:["DOM","ND"]:["C"];
      setPath(editor.record,id,builtin||{enabled:true,sourceId:"user",source:"用户编辑参考",statistic:"mean",basis:"N",sideBasis:row.paired&&!anatomical?"dominance":"anatomical",groups:["male","female"].map(sex=>({sex,ageMin:0,ageMax:120,mode:"any",values:Object.fromEntries(keys.map(key=>[key,""]))}))});
      return render();
    }
    if(name==="section")return App.openManagement(id);
    if(name==="page"){filter().page=Number(id);return render();}
    if(["archive","unarchive","trash","restore","purge"].includes(name))return cleanup(name,id);
    if(name==="new-athlete"||name==="edit-athlete")return editAthlete(id);
    if(name==="new-record")return App.startDataEntry(id);
    if(name==="choose-new-record")return App.startDataEntry();
    if(name==="athlete-records"){const a=lib().athletes.find(a=>a.id===id);filters.records={...filter(),q:a.id,page:1,status:"all",from:"",to:"",test:""};return App.openManagement("records");}
    if(name==="report"||name==="entry"){const a=lib().athletes.find(a=>a.records.some(r=>r.recordId===id));return App.openManagedRecord(a.id,id,name==="entry");}
    if(name==="edit-record"){
      const r=await App.getRepository().loadRecord(id);return showForm("测试名称与日期",field("名称",`<input name="title" maxlength="100" value="${esc(r.title)}">`)+field("测试日期",`<input type="date" name="date" value="${esc(r.athlete.date)}" required>`),async form=>{const data=new FormData(form);await App.updateRecordDate(id,data.get("date"),{title:data.get("title").trim()});});
    }
    if(name==="groups")return groups();
    if(name==="group-new"||name==="group-edit")return editTeam(id);
    if(name==="team-open"||name==="team-close"){filter().teamId=name==="team-open"?id:"";filter().q="";return render();}
    if(name==="team-add"){
      const team=lib().groups.find(g=>g.id===id),athletes=lib().athletes.filter(a=>!a.deletedAt&&!a.archived&&a.groupId!==id);
      return showForm("添加 / 转入 "+team.name,`<p class="note">选择已有运动员。已属于其他队伍的运动员将转入本队。</p>${field("搜索运动员",'<input type="search" id="teamMemberSearch" placeholder="姓名、编号或专项">')}<div class="team-member-picker">${athletes.map(a=>`<label class="check-line" data-team-candidate="${esc([a.name,a.id,a.profile.sport].join(" ").toLocaleLowerCase())}"><input type="checkbox" name="athleteIds" value="${esc(a.id)}"><span>${esc(a.name)} · ${esc(a.id.slice(-8))}<small>${esc(a.profile.sport||"未填写专项")} · ${esc(lib().groups.find(g=>g.id===a.groupId)?.name||"未分组")}</small></span></label>`).join("")||'<p class="empty">暂无可添加的在用运动员。</p>'}</div>`,async form=>{const ids=new FormData(form).getAll("athleteIds");if(!ids.length)throw Error("请选择运动员");lib().athletes.filter(a=>ids.includes(a.id)).forEach(a=>a.groupId=id);await App.saveLibraryChanges();});
    }
    if(name==="team-remove"){const a=lib().athletes.find(a=>a.id===id);a.groupId="";await App.saveLibraryChanges();return render();}
    if(name==="team-transfer"){
      const a=lib().athletes.find(a=>a.id===id);return showForm("转移队伍 · "+a.name,field("新队伍",`<select name="groupId">${groupOptions(a.groupId)}</select>`),async form=>{a.groupId=new FormData(form).get("groupId");await App.saveLibraryChanges();});
    }
    if(name==="group-delete"){
      if(!confirm("删除队伍后，其运动员归为未分组，资料和测试继续保留。继续？"))return;
      lib().groups=lib().groups.filter(g=>g.id!==id);lib().athletes.filter(a=>a.groupId===id).forEach(a=>a.groupId="");await App.saveLibraryChanges();filter().teamId="";return render();
    }
    if(["plan-new","plan-edit","plan-copy"].includes(name)){
      const existing=(lib().testPlans||[]).find(p=>p.id===id);
      planDraft=existing?clone(existing):{id:"plan_"+uid(),name:"",testIds:[],isoDirectionIds:[],defaultEvaluationProfileId:lib().defaultEvaluationProfileId,disabled:false};
      if(!Array.isArray(planDraft.isoDirectionIds))planDraft.isoDirectionIds=planDraft.testIds.includes("iso")?M.legacyIsoDirectionIds():[];
      if(name==="plan-copy"){planDraft.id="plan_"+uid();planDraft.name+=" 副本";planDraft.disabled=false;}return render();
    }
    if(name==="plan-close"){planDraft=null;return render();}
    if(name==="plan-save"){
      planDraft.name=planDraft.name.trim();if(!planDraft.name)throw Error("请填写测试方案名称");if((lib().testPlans||[]).some(p=>p.id!==planDraft.id&&p.name===planDraft.name))throw Error("测试方案名称已存在");
      if(!planDraft.testIds.length)throw Error("请至少添加一个测试项目");if(planDraft.testIds.some(id=>!lib().catalog.tests.some(t=>t.id===id)))throw Error("请移除已不存在的项目");
      if(planDraft.testIds.includes("iso")&&!planDraft.isoDirectionIds.length)throw Error("请至少选择一个等长力量测试方向");
      lib().testPlans||=[];const i=lib().testPlans.findIndex(p=>p.id===planDraft.id);if(i<0)lib().testPlans.push(clone(planDraft));else lib().testPlans[i]=clone(planDraft);
      await App.saveLibraryChanges();planDraft=null;return render();
    }
    if(name==="plan-toggle"){const plan=(lib().testPlans||[]).find(p=>p.id===id);plan.disabled=!plan.disabled;await App.saveLibraryChanges();return render();}
    if(name==="plan-delete"){if(!confirm("删除这个测试方案？已经创建的测试记录继续保留。"))return;lib().testPlans=(lib().testPlans||[]).filter(p=>p.id!==id);await App.saveLibraryChanges();return render();}
    if(name==="batch-group"||name==="batch-profile"){
      if(!selected.size)throw Error("请先选择资料");
      const isGroup=name==="batch-group",ids=[...selected];
      return showForm(isGroup?"批量调整队伍":"批量更换评价方案",`<p>已选择 ${ids.length} 项。</p>`+field(isGroup?"队伍":"评价方案",`<select name="value">${isGroup?groupOptions():profileOptions(lib().defaultEvaluationProfileId)}</select>`),async form=>{
        const value=new FormData(form).get("value"),records=[];
        if(isGroup)lib().athletes.filter(a=>ids.includes(a.id)).forEach(a=>a.groupId=value);
        else for(const id of ids){const r=await App.getRepository().loadRecord(id);r.evaluationProfileId=value;r.updated=now();records.push(r);}
        await App.saveLibraryChanges(records);selected.clear();
      });
    }
    if(name==="ability-new"||name==="ability-edit")return editAbility(id);
    if(name==="ability-up"||name==="ability-down"){
      const catalog=clone(lib().catalog),groups=T.abilityGroups(catalog),i=groups.findIndex(g=>g.key===id),j=i+(name==="ability-up"?-1:1);
      if(i<0||j<0||j>=groups.length)return;
      [groups[i],groups[j]]=[groups[j],groups[i]];catalog.abilityGroups=groups;await saveCatalog(catalog);return render();
    }
    if(name==="ability-conflict-local"||name==="ability-conflict-incoming"){
      const catalog=clone(lib().catalog),i=Number(id),conflict=catalog.abilityGroupConflicts?.[i];if(!conflict)throw Error("待确认分类已变化，请重新打开指标库");
      if(name==="ability-conflict-incoming"){
        const groups=T.abilityGroups(catalog),group=groups.find(g=>g.key===conflict.key);if(!group)throw Error("能力分类不存在");group.name=conflict.incomingName;catalog.abilityGroups=groups;
        for(const c of catalog.abilityGroupConflicts)if(c.key===conflict.key)c.localName=group.name;
      }
      catalog.abilityGroupConflicts.splice(i,1);await saveCatalog(catalog);return render();
    }
    if(name==="new-test"){
      const opened=App.openCatalogItem("new-test");
      if(opened!==false&&id){if($("catalogPrimaryAbility"))$("catalogPrimaryAbility").value=id;if($("catalogAbility"))$("catalogAbility").value=id;}
      return opened;
    }
    if(name==="derived-toggle"){if(!(T.derivedDefinitions?.()||[]).some(d=>d.id===id))throw Error("派生指标不存在");const catalog=clone(lib().catalog);catalog.derivedEnabled||={};catalog.derivedEnabled[id]=catalog.derivedEnabled[id]===false;await saveCatalog(catalog);return render();}
    if(name==="new-metric")return App.openCatalogItem("new-metric",id||filter().test||"");
    if(name==="catalog-edit")return App.openCatalogItem("edit-project",id);
    if(name==="catalog-resolve"){const [i,j]=id.split(":").map(Number);await App.resolveCatalogConflict(i,j);return render();}
    if(name==="metric-edit"){const d=lib().catalog.definitions.find(d=>d.id===id);return App.openCatalogItem("edit",d.testId,d.id);}
    if(["standard-edit","standard-iso","standard-balance","standard-lvp","standard-time"].includes(name))return openStandard(name.slice(9),id);
    if(name==="standard-fms"){showForm("FMS 固定评分",'<p>每项保留 0–3 分。出现疼痛记 0 分；双侧项目分别记录左右侧，以较低侧分数计入总分。</p><p>评分规则固定，原始左右侧分数、疼痛标记与备注分别保留。</p>',async()=>{});$("managementForm").querySelector('[type="submit"]').textContent="关闭";return;}
    if(name==="standard-time-new")return newTimeStandard(true);
    if(name==="profile-time-new")return newTimeStandard();
    if(name==="profile-time-create")return createTimeRule(id);
    if(name==="project-metrics"){filters.metrics={q:"",test:id};return App.openManagement("metrics");}
    if(name==="catalog-toggle"){const catalog=clone(lib().catalog),test=catalog.tests.find(t=>t.id===id);test.disabled=!test.disabled;await saveCatalog(catalog);return render();}
    if(name==="profile-edit")return viewProfile(id);
    if(name==="profile-new"||name==="profile-copy"){
      if(!discardEditor())return;
      const source=lib().evaluationProfiles.find(p=>p.id===(id||lib().defaultEvaluationProfileId)),profile={...clone(source),id:"evaluation_"+uid(),name:name==="profile-copy"?source.name+" 副本":"新评价方案",revision:1,disabled:false};delete profile.previous;
      editor={profile,record:Eval.template(profile),tab:"definitions",metricId:profile.criteria.definitions[0]?.id,rangeDrafts:{},zoneDrafts:{},readOnly:false,isNew:true};editor.baseline=editorSnapshot();return render();
    }
    if(name==="profile-tab"){editor.tab=id;return render();}
    if(name==="profile-close"){const origin=editor.origin;if(!discardEditor())return;return origin==="metrics"?App.openManagement("metrics"):render();}
    if(name==="profile-review")return reviewProfile();
    if(name==="profile-group-select"){editor.referenceGroupId=id;return render();}
    if(name==="profile-group-add"){
      const d=editor.record.definitions[Number(id)],group={id:"reference_"+uid(),sex:"any",ageMin:null,ageMax:null,mode:"any",ranges:clone(d.ranges||[]),source:"用户配置专项标准"};
      d.referenceGroups||=[];d.referenceGroups.push(group);d.referenceMode="grouped";d.ranges=[];d.referenceEnabled=true;editor.referenceGroupId=group.id;return render();
    }
    if(["profile-group-copy","profile-group-delete","profile-group-range-add","profile-group-range-delete"].includes(name)){
      const [i,j,k]=id.split(":").map(Number),d=editor.record.definitions[i],group=d.referenceGroups[j];clearGroupInputErrors(i);
      if(name==="profile-group-copy"){const copy={...clone(group),id:"reference_"+uid()};d.referenceGroups.splice(j+1,0,copy);editor.referenceGroupId=copy.id;}
      if(name==="profile-group-delete")d.referenceGroups.splice(j,1);
      if(name==="profile-group-range-add"){group.ranges.push({min:null,max:null,includeMin:true,includeMax:false,label:"",status:"gray"});markReferenceEdited("definitions."+i+".referenceGroups."+j+".ranges");}
      if(name==="profile-group-range-delete"){group.ranges.splice(k,1);markReferenceEdited("definitions."+i+".referenceGroups."+j+".ranges");}
      return render();
    }
    if(name==="profile-default"){lib().defaultEvaluationProfileId=id;await App.saveLibraryChanges();return render();}
    if(name==="profile-toggle"){const p=lib().evaluationProfiles.find(p=>p.id===id);if(id===lib().defaultEvaluationProfileId)throw Error("请先指定其他默认方案");p.disabled=!p.disabled;await App.saveLibraryChanges();return render();}
    if(name==="profile-records"){
      const p=lib().evaluationProfiles.find(p=>p.id===id),rows=lib().athletes.flatMap(a=>a.records.filter(r=>r.evaluationProfileId===id).map(r=>({a,r})));
      return showForm(p.name+" · 关联记录",rows.map(({a,r})=>`<div class="reference-row"><span>${esc(a.name)} · ${esc(r.athlete.date)}</span>${button("查看报告","report",r.recordId)}</div>`).join("")||"暂无关联记录",async()=>{});
    }
    if(name==="profile-revert"){
      const p=lib().evaluationProfiles.find(p=>p.id===id);if(!confirm("恢复上一版标准，并重新评价所有关联记录？"))return;
      const previous={name:p.name,criteria:clone(p.criteria),revision:p.revision,updated:p.updated};Object.assign(p,p.previous,{revision:p.revision+1,updated:now(),previous});await App.saveLibraryChanges();return render();
    }
    if(name==="profile-extend"){
      const candidates=[M.recordFromCatalog(lib().catalog,{},Object.fromEntries(lib().catalog.tests.map(t=>[t.id,true])))];if(App.getState())candidates.push(App.getState());
      for(const r of candidates){const c=Eval.capture(r);for(const d of c.definitions)if(!editor.record.definitions.some(x=>x.id===d.id)){if(!Eval.hasInstalledStandard(d))Object.assign(d,{target:null,ranges:[],referenceEnabled:false,source:""});editor.record.definitions.push(d);editor.profile.criteria.definitions.push(clone(d));}for(const row of c.iso)if(!editor.record.data.iso.some(x=>x.id===row.id))editor.record.data.iso.push({...row,target:"",left:"",right:"",center:"",notes:""});}
      return render();
    }
    if(name==="restore-library"){if(confirm("切换回上次导入或迁移前保留的资料库？当前资料库仍会保留。"))await App.restorePreviousLibrary();return;}
  }
  function init() {
    document.addEventListener("click",async event=>{
      const target=event.target.closest("[data-manager-action]");if(!target||busy)return;
      event.preventDefault();busy=true;
      try{await action(target.dataset.managerAction,target.dataset.id);}catch(error){showError(error);}finally{busy=false;}
    });
    document.addEventListener("input",event=>{
      const t=event.target;
      if(t.id==="teamMemberSearch"){const q=t.value.trim().toLocaleLowerCase();$("managementFields").querySelectorAll("[data-team-candidate]").forEach(el=>el.hidden=!!q&&!el.dataset.teamCandidate.includes(q));}
      if(t.id==="testPlanName"&&planDraft)planDraft.name=t.value;
      if(t.dataset.managerFilter&&t.tagName!=="SELECT"){filter()[t.dataset.managerFilter]=t.value;filter().page=1;selected.clear();clearTimeout(filterTimer);const tab=current;filterTimer=setTimeout(()=>{if(current===tab&&App.getUIState().mode==="management")render({preserveFilters:true});},100);}
      if(t.id==="profileName"&&editor)editor.profile.name=t.value;
      if(editor&&!editor.readOnly){
        if(t.dataset.profilePath) { editor.invalid ||= new Set(); if(t.validity.badInput)editor.invalid.add(t.dataset.profilePath);else editor.invalid.delete(t.dataset.profilePath); }
        if(t.dataset.profilePath){
          const path=t.dataset.profilePath;let value=t.type==="checkbox"?t.checked:t.type==="number"&&t.value!==""?Number(t.value):t.value;
          if(path.includes(".referenceGroups.")&&t.type==="number"&&t.value==="")value=/\.(target|minPeakRER)$/.test(path)?undefined:null;
          setPath(editor.record,path,value);markReferenceEdited(path);
        }
        if(t.dataset.profileRanges)editor.rangeDrafts[t.dataset.profileRanges]=t.value;
        if(t.dataset.profileZones)editor.zoneDrafts[t.dataset.profileZones]=t.value;
      }
    });
    document.addEventListener("change",event=>{
      const t=event.target;
      if(t.dataset.managerFilter&&t.tagName==="SELECT"){clearTimeout(filterTimer);filter()[t.dataset.managerFilter]=t.value;filter().page=1;selected.clear();render({preserveFilters:true});}
      if(t.dataset.managerSelect){if(t.checked)selected.add(t.dataset.managerSelect);else selected.delete(t.dataset.managerSelect);render();}
      if(t.id==="selectManagementPage"){const f=filter();allRows().slice((f.page-1)*30,f.page*30).forEach(r=>t.checked?selected.add(r.id):selected.delete(r.id));render();}
      if(t.id==="profileMetricSelect"){editor.metricId=t.value;render();}
      if(t.id==="imtpStandardSelect"){editor.timeKey=t.value;render();}
      if(t.id==="testPlanProfile"&&planDraft)planDraft.defaultEvaluationProfileId=t.value;
      if(t.dataset.profileAxis&&editor){editor.record.axes[t.dataset.profileAxis][t.dataset.axisField]=t.value;}
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
    const axes=Object.entries(record.axes).map(([id,a])=>{const ability=record.definitions.find(d=>T.axisKey(d.ability)===id)?.ability||"能力";return '<p>'+esc(T.abilityLabel(record,ability))+'：'+esc({primary:"代表指标",mean:"平均达成",min:"最低达成"}[a.method]||a.method)+(a.method==="primary"?' · '+esc(record.definitions.find(d=>d.id===a.primary)?.name||"未选代表指标"):"")+'</p>';}).join("");
    showForm("本次生效标准",`<p>${esc(profile?.name||"未关联方案")} · v${profile?.revision||1}</p>${rows}${imtp}<h3>汇总与筛查阈值</h3>${Object.entries(ruleLabels).map(([id,label])=>'<p>'+esc(label)+'：'+number(record.rules[id])+'</p>').join("")}${axes}${iso}${lvp?'<h3>LVP 参数</h3>'+lvp:""}`,async()=>{});
    $("managementForm").querySelector('[type="submit"]').textContent="关闭";
  }
  root.RingsideManagement={init,open,render,cancelPending:()=>clearTimeout(filterTimer),navigation,tab:()=>current,editAthlete,viewProfile,changesBetween,showEffective};
})(window);
