(function (root) {
  "use strict";
  const M=root.RingsideModel, Eval=root.RingsideEvaluation, T=root.RingsideTests;
  const $=id=>document.getElementById(id), clone=v=>JSON.parse(JSON.stringify(v));
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid=()=>crypto.randomUUID(), now=()=>new Date().toISOString(), lib=()=>App.getLibrary();
  const sections=[["athletes","运动员"],["records","测试记录"],["catalog","测试项目库"],["metrics","指标库"],["profiles","评价方案"],["backup","备份与恢复"]];
  let current="athletes", selected=new Set(), filters={}, editor=null, formAction=null, pendingReview=null, busy=false, filterTimer;
  const filter=()=>filters[current] ||= {q:"",group:"",sport:"",status:"active",from:"",to:"",test:"",page:1,sort:"recent"};
  function button(label,action,id="",extra="") { return `<button type="button" class="btn small" data-manager-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`; }
  const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?"selected":""}>${esc(label)}</option>`;
  const field=(label,html)=>`<label class="field"><span>${label}</span>${html}</label>`;
  function groupOptions(selected="") {return option("","未分组",selected)+lib().groups.map(g=>option(g.id,g.name,selected)).join("");}
  function profileOptions(selected="") {return lib().evaluationProfiles.filter(p=>!p.disabled||p.id===selected).map(p=>option(p.id,p.name,selected)).join("");}
  const profileName=id=>lib().evaluationProfiles.find(p=>p.id===id)?.name||"未关联";
  function navigation(){return sections.map(([id,label])=>`<button data-manager-action="section" data-id="${id}" class="${current===id?"active":""}" ${current===id?'aria-current="page"':""}>${label}</button>`).join("");}
  function open(tab="athletes"){current=sections.some(s=>s[0]===tab)?tab:"athletes";selected.clear();render();requestAnimationFrame(()=>window.scrollTo({top:filter().scroll||0,behavior:"instant"}));}
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
  function catalog() {
    const q=filter().q.trim().toLocaleLowerCase();
    const tests=lib().catalog.tests.filter(t=>!q||t.name.toLocaleLowerCase().includes(q));
    const conflicts=lib().catalog.conflicts.map((c,i)=>c.resolved?"":`<section class="notice"><h3>${esc(c.name)} · 待确认目录版本</h3><p>已有记录保留测量定义。请选择供后续新测试使用的版本。</p>${c.variants.map((v,j)=>`<div class="reference-row"><span>${esc(v.source||"导入版本")} · ${esc(v.test.name)}<small>${esc(v.protocol)} · ${esc(v.definitions.map(d=>d.name+" ("+d.unit+")").join("、"))}</small></span>${button("采用此版本","catalog-resolve",i+":"+j)}</div>`).join("")}</section>`).join("");
    return conflicts+field("搜索项目",`<input type="search" data-manager-filter="q" value="${esc(filter().q)}" placeholder="测试项目名称">`)+tests.map(t=>{
      const defs=lib().catalog.definitions.filter(d=>d.testId===t.id),fixed=["fms","iso"].includes(t.id);
      return `<article class="management-catalog-item"><div><h3>${esc(t.name)} ${t.disabled?'<span class="pill">已停用</span>':""}</h3><p class="note">${t.category==="screen"?"筛查":"运动表现"} · ${fixed?"专用测量表 · ":""}${defs.length} 个扩展或数值指标</p><p>${esc(lib().catalog.protocol[t.id]||"")}</p></div><div class="row">${button("编辑项目","catalog-edit",t.id)}${button("所属指标","project-metrics",t.id)}${button(t.disabled?"启用":"停用","catalog-toggle",t.id)}</div></article>`;
    }).join("");
  }
  function metrics() {
    const f=filter(),q=f.q.trim().toLocaleLowerCase();
    const items=lib().catalog.definitions.filter(d=>(!f.test||d.testId===f.test)&&(!q||[d.name,d.unit,d.ability].join(" ").toLocaleLowerCase().includes(q)));
    const defaults=M.defaults();
    const fixed=[...defaults.data.fms.map(r=>({id:"fms",name:r.name,unit:"分",mode:r.bilateral?"双侧录入 · 固定评分":"录入 · 固定评分",ability:"动作筛查"})),...defaults.data.iso.map(r=>({id:"iso",name:M.REG[r.region]+" · "+r.direction,unit:r.unit,mode:r.mode==="center"?"单值测量":"双侧测量",ability:"等长力量"}))].filter(d=>(!f.test||d.id===f.test)&&(!q||[d.name,d.unit,d.ability].join(" ").toLocaleLowerCase().includes(q)));
    const fixedRows=fixed.map(d=>`<tr><td data-label="指标">${esc(d.name)}</td><td data-label="所属项目">${esc(lib().catalog.tests.find(t=>t.id===d.id)?.name)}</td><td data-label="单位">${esc(d.unit)}</td><td data-label="数据方式">${esc(d.mode)}</td><td data-label="能力分类">${esc(d.ability)}</td><td data-label="操作"><span class="note">专用测量表</span></td></tr>`).join("");
    return `<div class="management-filters">${field("搜索指标",`<input type="search" data-manager-filter="q" value="${esc(f.q)}" placeholder="名称、单位或能力">`)}${field("所属项目",`<select data-manager-filter="test">${option("","全部项目",f.test)}${lib().catalog.tests.map(t=>option(t.id,t.name,f.test)).join("")}</select>`)}</div><div class="management-table-wrap"><table class="management-table"><thead><tr><th>指标</th><th>所属项目</th><th>单位</th><th>数据方式</th><th>能力分类</th><th>操作</th></tr></thead><tbody>${items.map(d=>`<tr><td data-label="指标">${esc(d.name)}</td><td data-label="所属项目">${esc(lib().catalog.tests.find(t=>t.id===d.testId)?.name)}</td><td data-label="单位">${esc(d.unit)}</td><td data-label="数据方式">${T.isManualMetric(d)?d.entryScope==="attempt"?"逐试次录入":"单次记录录入":"固定计算"}</td><td data-label="能力分类">${esc(d.ability)}</td><td data-label="操作">${button("编辑","metric-edit",d.id)}</td></tr>`).join("")+fixedRows||'<tr><td colspan="6" class="empty">没有符合条件的指标。</td></tr>'}</tbody></table></div>`;
  }
  function profiles() {
    if(editor)return profileEditor();
    return lib().evaluationProfiles.map(p=>{
      const count=lib().athletes.reduce((n,a)=>n+a.records.filter(r=>r.evaluationProfileId===p.id).length,0);
      return `<article class="management-catalog-item"><div><h3>${esc(p.name)} ${p.id===lib().defaultEvaluationProfileId?'<span class="pill">默认</span>':""}${p.disabled?'<span class="pill">已停用</span>':""}</h3><p class="note">版本 ${p.revision} · 关联 ${count} 条记录</p></div><div class="row">${button("编辑","profile-edit",p.id)}${button("复制","profile-copy",p.id)}${button("设为默认","profile-default",p.id,p.disabled?"disabled":"")}${button("关联记录","profile-records",p.id)}${button(p.disabled?"启用":"停用","profile-toggle",p.id,p.id===lib().defaultEvaluationProfileId?"disabled":"")}${p.previous?button("恢复上一版","profile-revert",p.id):""}</div></article>`;
    }).join("");
  }
  const ruleLabels={asymAmber:"不对称关注阈值 %",asymRed:"不对称重点关注阈值 %",absoluteAmber:"绝对力重点关注比例 %",scoreAmber:"目标达成关注下界 %",scoreGreen:"目标达成达标下界 %"};
  const input=(path,value,type="number")=>`<input data-profile-path="${esc(path)}" type="${type}" ${type==="number"?'step="any"':""} value="${esc(value)}">`;
  const check=(path,value,label)=>`<label class="check-line"><input type="checkbox" data-profile-path="${esc(path)}" ${value?"checked":""}>${label}</label>`;
  const select=(path,value,options)=>`<select data-profile-path="${esc(path)}">${options.map(([v,n])=>option(v,n,value)).join("")}</select>`;
  function ranges(path,value,label="评价区间：范围 | 名称 | red / amber / green") {return field(label,`<textarea rows="4" data-profile-ranges="${esc(path)}">${esc(editor.rangeDrafts[path]??Def.rangeText(value))}</textarea>`);}
  function profileEditor() {
    const r=editor.record,tab=editor.tab, tabs=[["definitions","指标标准"],["rules","筛查阈值"],["axes","能力汇总"],["iso","等长目标"],["balance","关节平衡"],["lvp","LVP 参数"]];
    let h=`<div class="profile-editor-header">${field("方案名称",`<input id="profileName" value="${esc(editor.profile.name)}" maxlength="120" ${editor.readOnly?"readonly":""}>`)}<div class="row">${button("返回方案列表","profile-close")}${editor.readOnly?button("复制为新方案","profile-copy",editor.profile.id):button("补充新增指标","profile-extend")+button("查看变更并保存","profile-review","",'class="btn primary"')}</div></div><div class="profile-tabs">${tabs.map(([id,label])=>button(label,"profile-tab",id,tab===id?'aria-current="page"':"")).join("")}</div><div id="profileEditorFields">`;
    if(tab==="definitions"){
      const i=Math.max(0,r.definitions.findIndex(d=>d.id===editor.metricId)),d=r.definitions[i];
      h+=field("指标",`<select id="profileMetricSelect">${r.definitions.map(d=>option(d.id,d.name+" · "+d.unit,editor.metricId)).join("")}</select>`);
      if(d)h+=`<p class="note">${esc(d.context?.protocol||"未记录协议")} · ${esc(d.unit)} · ${esc(d.ability)}</p><div class="form-grid">${field("评价目标",input("definitions."+i+".target",d.target))}${field("评价方向",select("definitions."+i+".direction",d.direction,[["higher","数值越高越好"],["lower","数值越低越好"]]))}${field("参考来源 / 适用人群",input("definitions."+i+".source",d.source,"text"))}</div>${check("definitions."+i+".referenceEnabled",d.referenceEnabled,"启用评价标准")}${ranges("definitions."+i+".ranges",d.ranges)}<div class="row">${d.ranges.map((x,j)=>check("definitions."+i+".ranges."+j+".advantage",x.advantage,esc(x.label)+"认定为优势")).join("")}</div>`;
    } else if(tab==="rules")h+='<div class="form-grid">'+Object.entries(ruleLabels).map(([id,label])=>field(label,input("rules."+id,r.rules[id]))).join("")+'</div><p class="note">FMS 保留固定 0–3 分及疼痛判定。</p>';
    else if(tab==="iso")h+=r.data.iso.map((row,i)=>`<div class="profile-rule-row"><b>${esc(M.REG[row.region])} · ${esc(row.direction)}</b>${field("目标 · "+esc(row.unit),input("data.iso."+i+".target",row.target))}<span class="note">${esc(row.protocol||"未记录协议")}</span></div>`).join("");
    else if(tab==="balance")h+=r.balancePairs.map((p,i)=>`<div class="profile-rule-block"><h3>${esc(p.label)}</h3><p class="note">${esc(r.data.iso.find(x=>x.id===p.numeratorId)?.direction||"未匹配方向")} / ${esc(r.data.iso.find(x=>x.id===p.denominatorId)?.direction||"未匹配方向")}</p>${check("balancePairs."+i+".referenceEnabled",p.referenceEnabled,"启用评价区间")}${field("依据",input("balancePairs."+i+".source",p.source,"text"))}${ranges("balancePairs."+i+".ranges",p.ranges)}</div>`).join("");
    else if(tab==="axes")h+=[...new Set(r.definitions.filter(d=>d.category==="performance"&&d.ability).map(d=>d.ability))].map(ability=>{
      const id=T.axisKey(ability),defs=r.definitions.filter(d=>d.ability===ability),cfg=T.axisConfig(r,ability)||{method:"primary",primary:defs[0].id};r.axes[id]=cfg;
      return `<div class="profile-rule-row"><b>${esc(ability)}</b>${field("汇总方式",`<select data-profile-axis="${esc(id)}" data-axis-field="method">${[["primary","代表指标"],["mean","平均达成"],["min","最低达成"]].map(([v,n])=>option(v,n,cfg.method)).join("")}</select>`)}${field("代表指标",`<select data-profile-axis="${esc(id)}" data-axis-field="primary">${defs.map(d=>option(d.id,d.name,cfg.primary)).join("")}</select>`)}</div>`;
    }).join("");
    else if(tab==="lvp")h+=Object.entries(r.lvp).map(([id,p])=>`<div class="profile-rule-block"><h3>${esc({bench:"卧推",squat:"深蹲",deadlift:"硬拉",landmineL:"地雷杠 L",landmineR:"地雷杠 R"}[id])}</h3><div class="form-grid">${field("适用速度口径",select("lvp."+id+".metric",p.metric,[["MV","平均速度 MV"],["MPV","平均推进速度 MPV"],["PV","峰值速度 PV"]]))}${field("MVT m/s",input("lvp."+id+".mvt",p.mvt))}${field("依据 / 设备",input("lvp."+id+".source",p.source||"","text"))}</div>${field("素质区间：下限..上限 | 名称",`<textarea rows="4" data-profile-zones="${id}">${esc(editor.zoneDrafts[id]??p.zones.map(z=>z.min+".."+z.max+" | "+z.label).join("\n"))}</textarea>`)}</div>`).join("");
    h+='</div><p id="profileEditorError" class="field-error" role="alert"></p>';
    return h;
  }
  function backup() {return `<div class="backup-grid"><article class="form-card"><h2>完整备份</h2><p>包含运动员、历次测试、队伍、回收站、项目库和评价方案。</p><button class="btn primary" onclick="App.downloadLibrary()">导出完整备份</button></article><article class="form-card"><h2>导入与恢复</h2>${field("导入方式",'<select id="backupImportMode"><option value="merge">合并到当前资料库</option><option value="replace">恢复为完整资料库</option></select>')}<button class="btn primary" onclick="document.getElementById('importFile').click()">选择备份文件</button><p class="note">支持完整 JSONL 备份、旧 JSON 和已保存的 HTML。</p>${button("恢复上次资料库","restore-library")}</article><article class="form-card"><h2>旧版兼容与迁移前资料</h2><p>旧版兼容导出包含未删除的测试记录及当前生效评价标准，不包含队伍和无测试档案。</p><div class="row"><button class="btn" onclick="App.downloadLegacyLibrary()">导出旧版兼容 JSON</button><button class="btn" onclick="App.downloadPreMigration()">下载迁移前资料</button></div></article></div>`;}
  function render() {
    if(!lib())return;
    const focused=document.activeElement, key=focused?.dataset.managerFilter, caret=focused?.selectionStart;
    const title=sections.find(([id])=>id===current)[1];
    const action=current==="athletes"?button("＋ 新建运动员","new-athlete")+button("管理队伍","groups"):current==="records"?button("＋ 新建测试","choose-new-record"):current==="catalog"?button("＋ 新建项目","new-test"):current==="metrics"?button("＋ 新增指标","new-metric"):current==="profiles"&&!editor?button("＋ 新建方案","profile-new"):"";
    $("managementContent").innerHTML=`<div class="management-heading"><div><p class="eyebrow">管理中心</p><h1>${title}</h1></div><div class="row">${action}</div></div>`+(current==="athletes"||current==="records"?lists():current==="catalog"?catalog():current==="metrics"?metrics():current==="profiles"?profiles():backup());
    if(editor?.readOnly&&current==="profiles") $("profileEditorFields")?.querySelectorAll("input,select,textarea").forEach(el=>el.disabled=true);
    if(key){const el=$("managementContent").querySelector(`[data-manager-filter="${key}"]`);el?.focus({preventScroll:true});if(caret!==null&&el?.setSelectionRange)try{el.setSelectionRange(caret,caret);}catch{}}
  }
  function showForm(title,html,action) {
    formAction=action;$("managementForm").querySelector('[type="submit"]').textContent="保存";$("managementModalTitle").textContent=title;$("managementFields").innerHTML=html;$("managementError").hidden=true;$("managementForm").querySelector('[type="submit"]').disabled=false;App.modal("managementModal");
  }
  function editAthlete(id="") {
    const a=lib().athletes.find(a=>a.id===id),p=a?.profile||{};
    showForm(a?"编辑运动员资料":"新建运动员",`<div class="form-grid">${field("姓名 / 编号",`<input name="name" required maxlength="100" value="${esc(p.name||a?.name||"")}">`)}${field("队伍 / 训练组",`<select name="groupId">${groupOptions(a?.groupId)}</select>`)}${field("专项",`<input name="sport" maxlength="100" value="${esc(p.sport)}" list="sportOptions">`)}${field("性别",`<select name="sex">${["未注明","男","女"].map(v=>option(v,v,p.sex||"未注明")).join("")}</select>`)}${field("惯用手",`<select name="dominantHand">${["未注明","右手","左手","双手"].map(v=>option(v,v,p.dominantHand||"未注明")).join("")}</select>`)}${field("级别",`<input name="sportLevel" maxlength="100" value="${esc(p.sportLevel)}">`)}</div>`,async form=>{
      const data=Object.fromEntries(new FormData(form));if(!data.name.trim())throw Error("请填写姓名或编号");
      const profile={...p,name:data.name.trim(),sport:data.sport.trim(),sex:data.sex,dominantHand:data.dominantHand,sportLevel:data.sportLevel.trim()};
      if(a){a.profile=profile;a.name=profile.name;a.groupId=data.groupId;a.updated=now();}
      else lib().athletes.push({id:uid(),name:profile.name,profile,groupId:data.groupId,archived:false,deletedAt:null,sample:false,updated:now(),records:[]});
      await App.saveLibraryChanges();
    });
  }
  function groups() {
    showForm("队伍与训练组",`<div class="group-list">${lib().groups.map(g=>`<div class="reference-row"><span>${esc(g.name)} · ${lib().athletes.filter(a=>a.groupId===g.id).length} 人</span><div class="row">${button("改名","group-edit",g.id)}${button("删除分组","group-delete",g.id)}</div></div>`).join("")}</div>${field("新队伍 / 训练组",'<input name="name" required maxlength="100" placeholder="填写分组名称">')}`,async form=>{
      const name=new FormData(form).get("name").trim();if(!name)throw Error("请填写队伍名称");if(lib().groups.some(g=>g.name===name))throw Error("队伍名称已存在");
      lib().groups.push({id:"group_"+uid(),name});await App.saveLibraryChanges();
    });
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
    const profile=lib().evaluationProfiles.find(p=>p.id===id);if(!profile)return;
    editor={profile:clone(profile),record:Eval.template(profile),tab:"definitions",metricId:profile.criteria.definitions[0]?.id,rangeDrafts:{},zoneDrafts:{},readOnly};pendingReview=null;render();
  }
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
    for(const d of next.definitions)add(d.name,metric(old.definitions.find(x=>x.id===d.id)),metric(d));
    for(const[k,label]of Object.entries(ruleLabels))add(label,old.rules[k],next.rules[k]);
    for(const row of next.iso)add(M.REG[row.region]+" · "+row.direction,old.iso.find(x=>x.id===row.id)?.target??"—",row.target);
    const balance=p=>p?`${p.referenceEnabled?"启用":"未启用"} · ${Def.rangeText(p.ranges)} · ${p.source||"未注明依据"}`:"未包含";
    for(const p of next.balance)add("关节平衡 "+p.label,balance(old.balance.find(x=>x.id===p.id)),balance(p));
    const lvp=p=>p?`${p.metric} · MVT ${p.mvt??"—"} m/s\n${(p.zones||[]).map(z=>z.min+"–"+z.max+" m/s："+z.label).join("\n")}\n${p.source||"未注明依据"}`:"未包含";
    for(const[id,p]of Object.entries(next.lvp))add("LVP "+({bench:"卧推",squat:"深蹲",deadlift:"硬拉",landmineL:"地雷杠左侧",landmineR:"地雷杠右侧"}[id]||id),lvp(old.lvp[id]),lvp(p));
    const axis=(a,c)=>a?({primary:"代表指标",mean:"平均达成",min:"最低达成"}[a.method]||a.method)+" · "+(c.definitions.find(d=>d.id===a.primary)?.name||"未选代表指标"):"未设置";
    for(const id of new Set([...Object.keys(old.axes),...Object.keys(next.axes)])){const ability=next.definitions.find(d=>T.axisKey(d.ability)===id)?.ability||"能力汇总";add(ability,axis(old.axes[id],old),axis(next.axes[id],next));}return rows;
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
      await App.saveLibraryChanges();editor=null;pendingReview=null;
    });
  }
  function getPath(obj,path){return path.split(".").reduce((v,k)=>v?.[k],obj);}
  function setPath(obj,path,value){const keys=path.split(".");if(keys.some(k=>["__proto__","constructor","prototype"].includes(k)))throw Error("无效字段");let current=obj;for(const k of keys.slice(0,-1))current=current[k];current[keys.at(-1)]=value;}
  async function action(name,id) {
    if(name==="section")return App.openManagement(id);
    if(name==="page"){filter().page=Number(id);return render();}
    if(["archive","unarchive","trash","restore","purge"].includes(name))return cleanup(name,id);
    if(name==="new-athlete"||name==="edit-athlete")return editAthlete(id);
    if(name==="new-record")return App.newTest(id);
    if(name==="choose-new-record")return showForm("选择新测试的运动员",field("运动员",`<select name="athleteId" required>${lib().athletes.filter(a=>!a.deletedAt&&!a.archived).map(a=>option(a.id,a.name+" · "+(lib().groups.find(g=>g.id===a.groupId)?.name||"未分组"))).join("")}</select>`),async form=>{const id=new FormData(form).get("athleteId");if(!id)throw Error("请先新建运动员");setTimeout(()=>App.newTest(id),0);});
    if(name==="athlete-records"){const a=lib().athletes.find(a=>a.id===id);filters.records={...filter(),q:a.id,page:1,status:"all",from:"",to:"",test:""};return App.openManagement("records");}
    if(name==="report"||name==="entry"){const a=lib().athletes.find(a=>a.records.some(r=>r.recordId===id));return App.openManagedRecord(a.id,id,name==="entry");}
    if(name==="edit-record"){
      const r=await App.getRepository().loadRecord(id);return showForm("测试名称与日期",field("名称",`<input name="title" maxlength="100" value="${esc(r.title)}">`)+field("测试日期",`<input type="date" name="date" value="${esc(r.athlete.date)}" required>`),async form=>{const data=new FormData(form);r.title=data.get("title").trim();r.athlete.date=data.get("date");r.updated=now();await App.saveLibraryChanges([r]);});
    }
    if(name==="groups")return groups();
    if(name==="group-edit"){
      const g=lib().groups.find(g=>g.id===id);return showForm("队伍名称",field("名称",`<input name="name" required maxlength="100" value="${esc(g.name)}">`),async form=>{const name=new FormData(form).get("name").trim();if(!name||lib().groups.some(x=>x.id!==id&&x.name===name))throw Error("名称为空或已存在");g.name=name;await App.saveLibraryChanges();});
    }
    if(name==="group-delete"){
      if(!confirm("删除分组后，其运动员归为未分组，资料和测试继续保留。继续？"))return;
      lib().groups=lib().groups.filter(g=>g.id!==id);lib().athletes.filter(a=>a.groupId===id).forEach(a=>a.groupId="");await App.saveLibraryChanges();return groups();
    }
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
    if(name==="new-test")return App.openCatalogItem("new-test");
    if(name==="new-metric")return App.openCatalogItem("new-metric",filter().test||"");
    if(name==="catalog-edit")return App.openCatalogItem("edit-project",id);
    if(name==="catalog-resolve"){const [i,j]=id.split(":").map(Number);await App.resolveCatalogConflict(i,j);return render();}
    if(name==="metric-edit"){const d=lib().catalog.definitions.find(d=>d.id===id);return App.openCatalogItem("edit",d.testId,d.id);}
    if(name==="project-metrics"){filters.metrics={q:"",test:id};return App.openManagement("metrics");}
    if(name==="catalog-toggle"){const test=lib().catalog.tests.find(t=>t.id===id);test.disabled=!test.disabled;await App.saveLibraryChanges();return render();}
    if(name==="profile-edit")return viewProfile(id);
    if(name==="profile-new"||name==="profile-copy"){
      const source=lib().evaluationProfiles.find(p=>p.id===(id||lib().defaultEvaluationProfileId)),profile={...clone(source),id:"evaluation_"+uid(),name:name==="profile-copy"?source.name+" 副本":"新评价方案",revision:1,disabled:false};delete profile.previous;
      editor={profile,record:Eval.template(profile),tab:"definitions",metricId:profile.criteria.definitions[0]?.id,rangeDrafts:{},zoneDrafts:{},readOnly:false};return render();
    }
    if(name==="profile-tab"){editor.tab=id;return render();}
    if(name==="profile-close"){editor=null;return render();}
    if(name==="profile-review")return reviewProfile();
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
      for(const r of candidates){const c=Eval.capture(r);for(const d of c.definitions)if(!editor.record.definitions.some(x=>x.id===d.id)){editor.record.definitions.push(d);editor.profile.criteria.definitions.push(clone(d));}for(const row of c.iso)if(!editor.record.data.iso.some(x=>x.id===row.id))editor.record.data.iso.push({...row,left:"",right:"",center:"",notes:""});}
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
      if(t.dataset.managerFilter){filter()[t.dataset.managerFilter]=t.value;filter().page=1;selected.clear();clearTimeout(filterTimer);filterTimer=setTimeout(render,100);}
      if(t.id==="profileName"&&editor)editor.profile.name=t.value;
      if(editor&&!editor.readOnly){
        if(t.dataset.profilePath) { editor.invalid ||= new Set(); if(t.validity.badInput)editor.invalid.add(t.dataset.profilePath);else editor.invalid.delete(t.dataset.profilePath); }
        if(t.dataset.profilePath)setPath(editor.record,t.dataset.profilePath,t.type==="checkbox"?t.checked:t.type==="number"&&t.value!==""?Number(t.value):t.value);
        if(t.dataset.profileRanges)editor.rangeDrafts[t.dataset.profileRanges]=t.value;
        if(t.dataset.profileZones)editor.zoneDrafts[t.dataset.profileZones]=t.value;
      }
    });
    document.addEventListener("change",event=>{
      const t=event.target;
      if(t.dataset.managerFilter){clearTimeout(filterTimer);filter()[t.dataset.managerFilter]=t.value;filter().page=1;selected.clear();render();}
      if(t.dataset.managerSelect){if(t.checked)selected.add(t.dataset.managerSelect);else selected.delete(t.dataset.managerSelect);render();}
      if(t.id==="selectManagementPage"){const f=filter();allRows().slice((f.page-1)*30,f.page*30).forEach(r=>t.checked?selected.add(r.id):selected.delete(r.id));render();}
      if(t.id==="profileMetricSelect"){editor.metricId=t.value;render();}
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
  }
  function showError(error) {
    const target=$("profileEditorError")||$("managementError");target.textContent=error.message;target.hidden=false;
    if(!target.getClientRects().length){$("saveStatus").textContent=error.message;const node=document.createElement("p");node.className="notice";node.role="alert";node.textContent=error.message;$("managementContent").prepend(node);}
  }
  function showEffective(record,profile) {
    const issues=new Map((record.evaluationIssues||[]).map(x=>[x.id,x.reason]));
    const number=n=>n===""||n==null?"—":Number(n).toLocaleString("zh-CN",{maximumFractionDigits:6});
    const interval=r=>r.min==null?(r.includeMax===false?"<":"≤")+number(r.max):r.max==null?(r.includeMin===false?">":"≥")+number(r.min):r.min===r.max?"="+number(r.min):(r.includeMin===false?"(":"[")+number(r.min)+", "+number(r.max)+(r.includeMax===false?")":"]");
    const ranges=items=>`<ul class="standard-ranges">${items.map(r=>`<li><b>${esc(r.label)}</b>：${esc(interval(r))}</li>`).join("")}</ul>`;
    const rows=record.definitions.filter(d=>record.enabled[d.testId]).map(d=>`<article class="effective-standard"><h3>${esc(d.name)}</h3><p>目标：<b title="${esc(d.target)}">${number(d.target)}</b> ${esc(d.unit)} · ${d.direction==="lower"?"数值越低越好":"数值越高越好"}</p>${issues.has(d.id)?'<p class="notice">'+esc(issues.get(d.id))+'</p>':d.referenceEnabled?ranges(d.ranges):'<p class="note">未启用评价分级</p>'}${d.source?'<p class="note">依据：'+esc(d.source)+'</p>':""}</article>`).join("");
    const iso=record.enabled.iso?'<h3>等长目标</h3>'+record.data.iso.map(r=>`<p>${esc(M.REG[r.region])} · ${esc(r.direction)}：<b>${number(r.target)}</b> ${esc(r.target?r.unit:"")}${issues.has(r.id)?' · '+esc(issues.get(r.id)):""}</p>`).join("")+'<h3>关节平衡</h3>'+record.balancePairs.map(p=>`<article class="effective-standard"><h4>${esc(p.label)}</h4>${p.referenceEnabled&&p.confirmed?ranges(p.ranges):'<p class="note">未启用分级或未确认测量条件可比</p>'}${p.source?'<p class="note">依据：'+esc(p.source)+'</p>':""}</article>`).join(""):"";
    const lvp=Object.entries(record.lvp).filter(([id])=>record.enabled[id.startsWith("landmine")?"landmine":id]).map(([id,p])=>`<article class="effective-standard"><h4>${esc({bench:"卧推",squat:"深蹲",deadlift:"硬拉",landmineL:"地雷杠左侧",landmineR:"地雷杠右侧"}[id])}</h4><p>${esc(p.metric)} · MVT ${number(p.mvt)} m/s</p>${p.zones.map(z=>'<p>'+esc(z.label)+'：'+number(z.min)+'–'+number(z.max)+' m/s</p>').join("")}${p.source?'<p class="note">依据：'+esc(p.source)+'</p>':""}</article>`).join("");
    const axes=Object.entries(record.axes).map(([id,a])=>{const ability=record.definitions.find(d=>T.axisKey(d.ability)===id)?.ability||"能力";return '<p>'+esc(ability)+'：'+esc({primary:"代表指标",mean:"平均达成",min:"最低达成"}[a.method]||a.method)+(a.method==="primary"?' · '+esc(record.definitions.find(d=>d.id===a.primary)?.name||"未选代表指标"):"")+'</p>';}).join("");
    showForm("本次生效标准",`<p>${esc(profile?.name||"未关联方案")} · v${profile?.revision||1}</p>${rows}<h3>汇总与筛查阈值</h3>${Object.entries(ruleLabels).map(([id,label])=>'<p>'+esc(label)+'：'+number(record.rules[id])+'</p>').join("")}${axes}${iso}${lvp?'<h3>LVP 参数</h3>'+lvp:""}`,async()=>{});
    $("managementForm").querySelector('[type="submit"]').textContent="关闭";
  }
  root.RingsideManagement={init,open,render,navigation,tab:()=>current,editAthlete,viewProfile,changesBetween,showEffective};
})(window);
