(function (root) {
  "use strict";
  const M = root.RingsideModel, E = root.RingsideEvaluation;
  const clone = v => JSON.parse(JSON.stringify(v)), uid = () => root.crypto.randomUUID();
  const tables = ["athletes", "records", "recordIndex", "groups", "profiles", "config"];
  const request = r => new Promise((resolve,reject) => { r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
  const completed = tx => new Promise((resolve,reject) => { tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error || Error("保存事务已取消")); tx.onerror=()=>{}; });
  const keyRange = generation => IDBKeyRange.bound([generation, ""], [generation, "\uffff"]);
  function longitudinalReports(value) {
    if (value === undefined) return [];
    if (!root.RingsideLongitudinalStore) { if (Array.isArray(value) && !value.length) return []; throw Error("纵向报告存储模块尚未加载"); }
    return root.RingsideLongitudinalStore.normalizeList(value);
  }
  function summary(r) {
    return { _summary:true, recordId:r.recordId, athleteId:r.athleteId, athlete:Object.fromEntries(["date","name","age","mass","height","cycle","injury"].map(k=>[k,r.athlete[k]??""])), updated:r.updated,
      title:r.title || "", enabled:clone(r.enabled), demo:!!r.demo, archived:!!r.archived, deletedAt:r.deletedAt || null, evaluationProfileId:r.evaluationProfileId || "" };
  }
  function athleteMetadata(a) { const {records, ...metadata}=a; return clone(metadata); }
  function mergeCatalog(local, incoming) {
    Object.assign(local,M.normalizeCatalog(local));
    incoming=M.normalizeCatalog(incoming);
    const groups = root.RingsideTests.abilityGroups(local).map(clone);
    const conflicts = local.abilityGroupConflicts || [];
    const addGroup = group => {
      const current = groups.find(item => item.key === group.key);
      if (!current) groups.push(clone(group));
      else if (current.name !== group.name && !conflicts.some(item => item.key === group.key && item.incomingName === group.name))
        conflicts.push({key:group.key,localName:current.name,incomingName:group.name});
    };
    root.RingsideTests.abilityGroups(incoming).forEach(addGroup);
    for (const conflict of incoming.abilityGroupConflicts || []) addGroup({key:conflict.key,name:conflict.incomingName});
    local.abilityGroups = groups;
    local.abilityGroupConflicts = conflicts;
    const variant=(catalog,id,source)=>({test:clone(catalog.tests.find(t=>t.id===id)),definitions:clone(catalog.definitions.filter(d=>d.testId===id)).sort((a,b)=>a.id.localeCompare(b.id)),protocol:catalog.protocol[id]||"",protocolIdentity:catalog.protocolIdentities?.[id],source});
    const comparable = value => {
      // Both full catalogues have already applied legacy collision detection.
      // Keep that provenance when normalizing a project-sized comparison.
      const id=value.test.id,normalized=M.normalizeCatalog({capabilityVersion:1,fvpVersion:1,sprintFvpVersion:1,tests:[value.test],definitions:value.definitions,protocol:{[id]:value.protocol||""},protocolIdentities:value.protocolIdentity?{[id]:value.protocolIdentity}:{},conflicts:[]});
      const result=variant(normalized,id,"");
      result.protocol=M.canonicalProtocolText(id,result.protocol);
      result.definitions=result.definitions.map(d=>({...d,name:root.RingsideTests.metricName(d),protocol:root.Def.viftProtocol(d.id,d.protocol)}));
      if(id==="ift"&&result.test.name==="30–15 IFT")result.test.name="30-15VIFT";
      if(["fms","iso"].includes(id)&&!result.test.primaryAbility)result.test.primaryAbility=id==="fms"?"动作筛查":"等长力量";
      return result;
    };
    const same=(a,b)=>E.canonical(comparable(a))===E.canonical(comparable(b));
    for(const t of incoming.tests){
      if(!local.tests.some(x=>x.id===t.id)){local.tests.push(clone(t));local.definitions.push(...clone(incoming.definitions.filter(d=>d.testId===t.id)));local.protocol[t.id]=incoming.protocol[t.id]||"";local.protocolIdentities||={};if(incoming.protocolIdentities?.[t.id])local.protocolIdentities[t.id]=clone(incoming.protocolIdentities[t.id]);continue;}
      const candidate=variant(incoming,t.id,"导入项目库"),current=variant(local,t.id,"本机项目库");
      if(!same(current,candidate)){
        let conflict=local.conflicts.find(c=>c.testId===t.id&&!c.resolved);
        if(!conflict){conflict={id:t.id,testId:t.id,name:t.name,resolved:false,variants:[current]};local.conflicts.push(conflict);}
        if(!conflict.variants.some(v=>same(v,candidate)))conflict.variants.push(candidate);
      }
    }
    for(const c of incoming.conflicts.filter(c=>!c.resolved)){
      let target=local.conflicts.find(x=>x.testId===c.testId&&!x.resolved);
      if(!target){target=clone(c);local.conflicts.push(target);}else for(const v of c.variants)if(!target.variants.some(x=>same(x,v)))target.variants.push(clone(v));
    }
    // Presentation settings never participate in measurement conflicts. A local
    // explicit selection (including none) wins over an imported library style.
    for (const [id, view] of Object.entries(incoming.reportViews || {})) {
      if (Object.hasOwn(local.reportViews || {}, id) || !root.RingsideGenericReport?.compatible(view, local, id)) continue;
      local.reportViews ||= {};
      local.reportViews[id] = clone(view);
    }
    M.validateCatalog(local);
  }
  function validateTestPlans(plans, catalog) {
    if (plans === undefined) return;
    if (!Array.isArray(plans) || plans.length > 2000) throw Error("测试方案格式无效");
    const ids = new Set(), tests = new Set(catalog.tests.map(t=>t.id));
    for (const plan of plans) {
      if (!plan || typeof plan.id !== "string" || !plan.id || plan.id.length > 249 || ["__proto__","constructor","prototype"].includes(plan.id) || ids.has(plan.id)) throw Error("测试方案编号无效或重复");
      ids.add(plan.id);
      if (typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 120 || !Array.isArray(plan.testIds) || !plan.testIds.length || plan.testIds.length > 1000 || new Set(plan.testIds).size !== plan.testIds.length || plan.testIds.some(id=>!tests.has(id))) throw Error("测试方案名称或项目无效");
      if (typeof plan.defaultEvaluationProfileId !== "string" || !plan.defaultEvaluationProfileId) throw Error("测试方案缺少推荐评价方案");
      if (plan.disabled !== undefined && typeof plan.disabled !== "boolean") throw Error("测试方案状态无效");
      M.validateIsoDirectionIds(plan.isoDirectionIds, M.isoRows(), !plan.testIds.includes("iso"));
    }
  }
  function configuration(lib) {
    validateTestPlans(lib.testPlans, lib.catalog);
    // Producer identity is separate from data schemas and calculation methods.
    // Source-only consumers retain the existing producer, including future versions.
    const version = root.RingsideBuild?.version || lib.version;
    return {schema:3,kind:"athlete-library",catalog:clone(lib.catalog),testPlans:clone(lib.testPlans||[]),defaultEvaluationProfileId:lib.defaultEvaluationProfileId,
      activeAthleteId:lib.activeAthleteId||"",activeRecordId:lib.activeRecordId||"",updated:lib.updated,version,
      ...(lib.longitudinalReports !== undefined ? {longitudinalReports:longitudinalReports(lib.longitudinalReports)} : {})};
  }
  function validateEntity(type, value) {
    const safe = id => typeof id === "string" && id.length > 0 && id.length < 250 && !["__proto__","prototype","constructor"].includes(id);
    if (type === "record") { M.validateRecord(value); if (!safe(value.evaluationProfileId)) throw Error("测试缺少评价方案关联"); }
    else if (type === "profile") E.validateProfile(value);
    else if (type === "athlete") {
      if (!safe(value.id) || typeof value.name !== "string" || !value.profile || typeof value.profile !== "object" || Array.isArray(value.profile)) throw Error("运动员资料无效");
    } else if (type === "group") { if (!safe(value.id) || typeof value.name !== "string" || !value.name.trim()) throw Error("队伍信息无效"); }
    else if (type === "config") { M.validateCatalog(value.catalog); validateTestPlans(value.testPlans,value.catalog); longitudinalReports(value.longitudinalReports); if (!safe(value.defaultEvaluationProfileId)) throw Error("默认评价方案无效"); }
    else throw Error("备份包含未知资料类型");
    if (type !== "record" && type !== "config" && !safe(value.id)) throw Error("资料 ID 无效");
  }
  class Repository {
    constructor(db) { this.db=db; this.generation=""; this.queue=Promise.resolve(); this.metadataHashes=new Map(); }
    static async open(pathname=root.location.pathname) {
      const r=indexedDB.open("motionbench-v3:"+pathname,1);
      r.onupgradeneeded=()=>{
        r.result.createObjectStore("meta",{keyPath:"id"});
        for(const name of tables) r.result.createObjectStore(name,{keyPath:["generation","id"]});
      };
      const db=await new Promise((resolve,reject)=>{
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
        r.onblocked=()=>reject(Error("数据库被其他页面占用，请关闭其他 MotionBench 页面后重试"));
      });
      const repo=new Repository(db); repo.generation=(await repo.meta("active"))?.value || "";
      db.onversionchange=()=>db.close(); return repo;
    }
    async meta(id) { return request(this.db.transaction("meta").objectStore("meta").get(id)); }
    async versionState() {
      const tx=this.db.transaction("meta"),store=tx.objectStore("meta");
      const [active,previous,revision]=await Promise.all(["active","previous","revision"].map(id=>request(store.get(id))));
      return {active:active?.value||"",previous:previous?.value||"",revision:revision?.value};
    }
    sameVersion(left,right) { return left.active===right.active && left.previous===right.previous && left.revision===right.revision; }
    async stableRead(generation,operation,{requireActive=generation===this.generation}={}) {
      const before=await this.versionState();
      if(requireActive && before.active!==generation)throw Error("资料库已在其他页面切换，请重新打开后再导出");
      if(!generation || !await this.get("config","library",generation))throw Error("待读取的资料库配置缺失，请核对后重试");
      const value=await operation();
      if(!this.sameVersion(before,await this.versionState()))throw Error("资料在读取期间已被其他页面修改，请停止其他页面的操作后重新备份或导出");
      return value;
    }
    async get(table,id,generation=this.generation) { return (await request(this.db.transaction(table).objectStore(table).get([generation,id])))?.value; }
    async values(table,generation=this.generation) { return (await request(this.db.transaction(table).objectStore(table).getAll(keyRange(generation)))).map(row=>row.value); }
    async directory(generation=this.generation) {
      const [config,athletes,index,groups,profiles]=await Promise.all([this.get("config","library",generation),this.values("athletes",generation),this.values("recordIndex",generation),this.values("groups",generation),this.values("profiles",generation)]);
      if(!config) throw Error("资料库配置缺失");
      const owners=new Map(athletes.map(a=>[a.id,{...a,records:[]} ]));
      for(const r of index) owners.get(r.athleteId)?.records.push(r);
      const lib={...config,testPlans:config.testPlans||[],athletes:[...owners.values()],groups,evaluationProfiles:profiles};
      if(generation===this.generation){
        this.metadataHashes.clear();
        for(const [table,items] of [["athletes",athletes],["groups",groups],["profiles",profiles],["config",[{...config,id:"library"}]]])
          for(const item of items) this.metadataHashes.set(table+":"+item.id,JSON.stringify(table==="config"?config:item));
      }
      return lib;
    }
    loadRecord(id) { return this.get("records",id); }
    enqueue(operation) { const task=this.queue.then(operation); this.queue=task.catch(()=>{});return task; }
    flush() { return this.queue; }
    saveRecords(records=[],checks={},options={}) {
      const generation=this.generation,expected=clone(checks),selection=options.selection?clone(options.selection):null,updated=options.updated;
      const reports=options.longitudinalReports === undefined ? null : longitudinalReports(options.longitudinalReports);
      if(reports && typeof expected.expectedLongitudinalReports!=="string")throw Error("保存纵向报告缺少原正文校验依据");
      const snapshots=records.map(record=>{validateEntity("record",record);return clone(record);});
      const newAthletes=(options.newAthletes||[]).map(owner=>{const value=athleteMetadata(owner);validateEntity("athlete",value);return value;});
      const recordIds=new Set(),ownerIds=new Set();
      for(const record of snapshots){
        if(recordIds.has(record.recordId))throw Error("测试编号重复");recordIds.add(record.recordId);
        if(typeof expected.expectedRecords?.[record.recordId]!=="string")throw Error("保存测试缺少原记录校验依据，请重新打开后保存");
      }
      for(const owner of newAthletes){if(ownerIds.has(owner.id))throw Error("运动员编号重复");ownerIds.add(owner.id);if(!snapshots.some(record=>record.athleteId===owner.id))throw Error("新运动员需要随首次测试一起保存");}
      if(selection && (typeof selection.activeAthleteId!=="string" || typeof selection.activeRecordId!=="string"))throw Error("当前资料选择无效");
      return this.enqueue(async()=>{
        const tx=this.db.transaction(["meta","records","recordIndex","athletes","profiles","groups","config"],"readwrite"),done=completed(tx);
        try {
          if((await request(tx.objectStore("meta").get("active")))?.value!==generation)throw Error("资料库已在其他页面切换，请重新打开后保存");
          const storedConfig=(await request(tx.objectStore("config").get([generation,"library"])))?.value;
          if(!storedConfig)throw Error("资料库配置缺失");
          const owners=new Map();
          for(const owner of newAthletes){
            if(await request(tx.objectStore("athletes").get([generation,owner.id])))throw Error("运动员已在其他页面建立，请重新核对后保存");
            if(owner.groupId && !await request(tx.objectStore("groups").get([generation,owner.groupId])))throw Error("运动员所属队伍已不存在，请重新选择");
            owners.set(owner.id,owner);
          }
          for(const record of snapshots){
            const stored=(await request(tx.objectStore("records").get([generation,record.recordId])))?.value;
            if(JSON.stringify(stored??null)!==expected.expectedRecords[record.recordId])throw Error("此记录已在其他页面修改或删除，当前输入已保留，请核对后重新打开记录");
            const owner=owners.get(record.athleteId)||(await request(tx.objectStore("athletes").get([generation,record.athleteId])))?.value;
            if(!owner || owner.deletedAt)throw Error("运动员已不存在，请重新打开后保存");
            if(!stored && owner.archived)throw Error("运动员已在其他页面归档，请恢复档案后再创建测试");
            if((owner.profile?.birthDate||"")!==(record.athlete.birthDate||""))throw Error("运动员生日已更新，请重新打开本次记录后保存");
            if(!await request(tx.objectStore("profiles").get([generation,record.evaluationProfileId])))throw Error("测试的评价方案已不存在，请重新选择");
          }
          const nextConfig={...storedConfig};
          if(reports){
            if(JSON.stringify(storedConfig.longitudinalReports||[])!==expected.expectedLongitudinalReports)throw Error("纵向报告已在其他页面修改，请重新打开并核对后保存");
            for(const document of reports){
              const owner=owners.get(document.athleteId)||(await request(tx.objectStore("athletes").get([generation,document.athleteId])))?.value;
              const selected=[];
              for(const id of document.recordIds)selected.push(snapshots.find(record=>record.recordId===id)||(await request(tx.objectStore("records").get([generation,id])))?.value);
              if(selected.some(record=>!record))throw Error("纵向报告的测试记录已不存在");
              const profile=document.evaluationProfileId?(await request(tx.objectStore("profiles").get([generation,document.evaluationProfileId])))?.value:null;
              root.RingsideLongitudinalStore.validateReferences(document,{athletes:owner?[{...owner,records:selected}]:[],evaluationProfiles:profile?[profile]:[]});
            }
            nextConfig.longitudinalReports=reports;
          }
          if(selection){
            const selectedRecord=snapshots.find(record=>record.recordId===selection.activeRecordId)||(selection.activeRecordId?(await request(tx.objectStore("records").get([generation,selection.activeRecordId])))?.value:null);
            const selectedOwner=owners.get(selection.activeAthleteId)||(selection.activeAthleteId?(await request(tx.objectStore("athletes").get([generation,selection.activeAthleteId])))?.value:null);
            if(selection.activeAthleteId && (!selectedOwner || selectedOwner.deletedAt) || selection.activeRecordId && (!selectedRecord || selectedRecord.deletedAt || selectedRecord.athleteId!==selection.activeAthleteId))throw Error("当前运动员或记录已不存在，请重新打开");
            nextConfig.activeAthleteId=selection.activeAthleteId;nextConfig.activeRecordId=selection.activeRecordId;
          }
          if(snapshots.length||reports){nextConfig.updated=updated||new Date().toISOString();nextConfig.version=root.RingsideBuild?.version||storedConfig.version;}
          const configChanged=JSON.stringify(nextConfig)!==JSON.stringify(storedConfig);
          for(const owner of newAthletes)tx.objectStore("athletes").put({generation,id:owner.id,value:owner});
          for(const record of snapshots){tx.objectStore("records").put({generation,id:record.recordId,value:record});tx.objectStore("recordIndex").put({generation,id:record.recordId,value:summary(record)});}
          if(configChanged)tx.objectStore("config").put({generation,id:"library",value:nextConfig});
          if(snapshots.length||newAthletes.length||configChanged)tx.objectStore("meta").put({id:"revision",value:uid()});
          await done;
          for(const owner of newAthletes)this.metadataHashes.set("athletes:"+owner.id,JSON.stringify(owner));
          // Do not adopt unrelated metadata from another page as this caller's
          // baseline: later management edits must still detect its stale view.
          const baseline=this.metadataHashes.get("config:library");
          if(baseline===JSON.stringify(storedConfig))this.metadataHashes.set("config:library",JSON.stringify(nextConfig));
        }catch(error){try{tx.abort();}catch(_){}await done.catch(()=>{});throw error;}
      });
    }
    save(lib,records=[],removals={},checks={}) {
      const generation=this.generation;
      const config=configuration(lib);
      if(config.longitudinalReports&&(removals.athletes?.length||removals.records?.length))config.longitudinalReports=config.longitudinalReports.filter(document=>!removals.athletes?.includes(document.athleteId)&&!document.recordIds.some(id=>removals.records?.includes(id)));
      const metadata=[["athletes",lib.athletes.map(athleteMetadata)],["groups",lib.groups],["profiles",lib.evaluationProfiles.map(p=>E.serializeProfile ? E.serializeProfile(p) : p)],["config",[{...config,id:"library"}]]].map(([table,items])=>[table,clone(items)]);
      for(const [table,items] of metadata){
        const ids=new Set();
        for(const item of items){if(ids.has(item.id))throw Error("资料包含重复编号");ids.add(item.id);validateEntity({athletes:"athlete",groups:"group",profiles:"profile",config:"config"}[table],item);}
      }
      const owners=new Set(lib.athletes.map(a=>a.id)),profileIds=new Set(lib.evaluationProfiles.map(p=>p.id)),groupIds=new Set(lib.groups.map(g=>g.id));
      if(lib.athletes.some(a=>a.groupId&&!groupIds.has(a.groupId)))throw Error("运动员所属队伍不存在");
      if(!profileIds.has(lib.defaultEvaluationProfileId)||records.some(r=>!owners.has(r.athleteId)||!profileIds.has(r.evaluationProfileId)))throw Error("测试关联的运动员或评价方案不存在");
      const snapshots=records.map(r=>{validateEntity("record",r);return clone(r);}),deletions=clone(removals),expected=clone(checks);
      // Capture caller values now, but compare metadata only after preceding writes commit.
      return this.enqueue(async()=>{
        if((await this.meta("active"))?.value!==generation) throw Error("资料库已在另一个页面切换，请先备份未保存内容再重新打开");
        const writes=[],nextHashes=new Map(this.metadataHashes);
        for(const [table,items] of metadata){
          const known=new Set();
          for(const item of items){const key=table+":"+item.id,value=table==="config"?Object.fromEntries(Object.entries(item).filter(([key])=>key!=="id")):item,encoded=JSON.stringify(value);known.add(key);if(nextHashes.get(key)!==encoded){writes.push([table,item.id,value]);nextHashes.set(key,encoded);}}
          for(const key of [...nextHashes.keys()])if(key.startsWith(table+":")&&!known.has(key)){(deletions[table] ||= []).push(key.slice(table.length+1));nextHashes.delete(key);}
        }
        for(const r of snapshots)writes.push(["records",r.recordId,r],["recordIndex",r.recordId,summary(r)]);
        for(const id of deletions.records||[])(deletions.recordIndex ||= []).push(id);
        if((deletions.records?.length||deletions.athletes?.length)&&!writes.some(([table])=>table==="config"))writes.push(["config","library",clone(config)]);
        const guarded = expected.expectedConfig !== undefined || expected.expectedRecords || expected.expectedAthletes || expected.expectedProfiles || expected.expectedGroups || expected.expectedOwnerRecordIds;
        const names=[...new Set(writes.map(w=>w[0]).concat(Object.keys(deletions), ["meta"], guarded ? ["records","athletes","config"] : [], expected.expectedProfiles ? ["profiles"] : [], expected.expectedGroups ? ["groups"] : [], expected.expectedOwnerRecordIds ? ["recordIndex"] : [], snapshots.length ? ["athletes"] : []))];
        if(!writes.length&&!Object.keys(deletions).length&&!guarded)return;
        const tx=this.db.transaction(names,"readwrite"),done=completed(tx);
        try {
          const active = await request(tx.objectStore("meta").get("active"));
          if (active?.value !== generation) throw Error("资料库已在另一个页面切换，请重新打开并重新预览");
          const comparisons = [];
          for (const [table, entries] of [["records", expected.expectedRecords], ["athletes", expected.expectedAthletes], ["profiles", expected.expectedProfiles], ["groups", expected.expectedGroups]])
            for (const [id, encoded] of Object.entries(entries || {})) comparisons.push(request(tx.objectStore(table).get([generation,id])).then(row => JSON.stringify(row?.value ?? null) === encoded));
          if (expected.expectedConfig !== undefined) comparisons.push(request(tx.objectStore("config").get([generation,"library"])).then(row => JSON.stringify(row?.value ?? null) === expected.expectedConfig));
          if ((await Promise.all(comparisons)).some(matches => !matches)) throw Error("资料已在其他页面修改，请重新打开并核对后保存");
          if(expected.expectedOwnerRecordIds){
            const index=await request(tx.objectStore("recordIndex").getAll(keyRange(generation)));
            for(const [ownerId,ids] of Object.entries(expected.expectedOwnerRecordIds)){
              const actual=index.filter(row=>row.value.athleteId===ownerId).map(row=>row.value.recordId).sort();
              if(JSON.stringify(actual)!==JSON.stringify([...ids].sort()))throw Error("运动员测试记录已在其他页面修改，请重新打开档案后保存");
            }
          }
          const changedOwners=new Map(writes.filter(([table])=>table==="athletes").map(([,id,value])=>[id,value]));
          for(const [id,owner] of changedOwners){
            const current=(await request(tx.objectStore("athletes").get([generation,id])))?.value;
            if(current&&(current.profile?.birthDate||"")!==(owner.profile?.birthDate||"")&&!expected.expectedAthletes?.[id])throw Error("运动员生日已更新，请重新打开档案后保存");
          }
          for(const record of snapshots){
            const owner=changedOwners.get(record.athleteId)||(await request(tx.objectStore("athletes").get([generation,record.athleteId])))?.value;
            if(owner&&(owner.profile?.birthDate||"")!==(record.athlete.birthDate||""))throw Error("运动员生日已更新，请重新打开本次记录后保存");
          }
          const configWrite=writes.find(([table])=>table==="config");
          if(configWrite){
            const callerConfig=clone(configWrite[2]);
            const stored=(await request(tx.objectStore("config").get([generation,"library"])))?.value;
            const baseline=JSON.parse(this.metadataHashes.get("config:library")||"null");
            const before=JSON.stringify(baseline?.longitudinalReports||[]),current=JSON.stringify(stored?.longitudinalReports||[]),desired=JSON.stringify(configWrite[2].longitudinalReports||[]);
            // Unrelated management changes must retain comparison text saved
            // by another page. Intentional document edits still use CAS.
            if(desired===before){if(stored?.longitudinalReports!==undefined)configWrite[2].longitudinalReports=clone(stored.longitudinalReports);}
            else if(current!==before)throw Error("纵向报告已在其他页面修改，请重新打开并核对后保存");
            if(configWrite[2].longitudinalReports)configWrite[2].longitudinalReports=configWrite[2].longitudinalReports.filter(document=>!deletions.athletes?.includes(document.athleteId)&&!document.recordIds.some(id=>deletions.records?.includes(id)));
            // The caller has not read another page's documents. Keep that
            // field's old baseline until directory() refreshes its local copy.
            nextHashes.set("config:library",JSON.stringify(desired===before&&current!==before?callerConfig:configWrite[2]));
          }
          for(const [table,id,value] of writes)tx.objectStore(table).put({generation,id,value});
          for(const [table,ids] of Object.entries(deletions))for(const id of ids)tx.objectStore(table).delete([generation,id]);
          tx.objectStore("meta").put({id:"revision",value:uid()});
          await done;this.metadataHashes=nextHashes;
        } catch (error) {
          try { tx.abort(); } catch (_) {}
          await done.catch(()=>{}); throw error;
        }
      });
    }
    async *batches(table,generation=this.generation,size=40) {
      let last=null;
      while(true){
        const range=last===null?keyRange(generation):IDBKeyRange.bound([generation,last],[generation,"\uffff"],true,false);
        const rows=await request(this.db.transaction(table).objectStore(table).getAll(range,size));
        if(!rows.length)return;
        yield rows.map(row=>row.value);last=rows.at(-1).id;
      }
    }
    async *rows(generation=this.generation) {
      yield {type:"header",format:"motionbench-backup",schema:3,created:new Date().toISOString()};
      const counts={athlete:0,record:0,group:0,profile:0,config:0};
      for(const [table,type] of [["config","config"],["groups","group"],["profiles","profile"],["athletes","athlete"],["records","record"]]) {
        for await(const batch of this.batches(table,generation)) for(const value of batch){counts[type]++;yield {type,value};}
      }
      yield {type:"end",counts};
    }
    backupBlob(onProgress=()=>{}) { return this.enqueue(() => this.createBackupBlob(onProgress)); }
    async createBackupBlob(onProgress=()=>{},generation=this.generation) {
      return this.stableRead(generation,async()=>{
        const chunks=[];let records=0;
        for await(const row of this.rows(generation)) {chunks.push(new Blob([JSON.stringify(row)+"\n"],{type:"application/x-ndjson"}));if(row.type==="record"&&++records%100===0)onProgress(records);}
        return new Blob(chunks,{type:"application/x-ndjson"});
      });
    }
    exportLibrary() { return this.enqueue(() => this.createLibrary()); }
    async createLibrary(generation=this.generation) {
      return this.stableRead(generation,async()=>{
        const lib=await this.directory(generation),owners=new Map(lib.athletes.map(a=>{a.records=[];return[a.id,a];}));
        for await(const batch of this.batches("records",generation))for(const record of batch){
          const owner=owners.get(record.athleteId);if(!owner)throw Error("资料在读取期间已更改或记录归属缺失，请核对资料后重新导出");owner.records.push(record);
        }
        return lib;
      });
    }
    upgradeMeasurementContract() {
      return this.enqueue(async()=>{
        const config=await this.get("config","library"), profiles=await this.values("profiles");
        if(config?.catalog?.measurementPolicyVersion>=1 && profiles.every(profile=>profile.formatVersion===2))return null;
        const expectedRevision=(await this.meta("revision"))?.value;
        const before=await this.createLibrary(),after=E.migrate(clone(before));
        const checkpoint={created:new Date().toISOString(),fromVersion:before.version||"unknown",toVersion:"2.19.0",report:E.migrationReport?E.migrationReport(before,after):null};
        await this.stageImport(libraryRows(after),{upgradeCheckpoint:checkpoint,expectedRevision});
        return checkpoint;
      });
    }
    async upgradeBackupBlob() {
      await this.flush();
      const checkpoint=(await this.meta("upgrade-2.19.0"))?.value;
      if(!checkpoint?.generation)throw Error("没有升级前资料备份");
      return this.createBackupBlob(()=>{},checkpoint.generation);
    }
    async rollbackRecoveryBackupBlob() {
      await this.flush();
      const checkpoint=(await this.meta("upgrade-2.19.0"))?.value;
      const generation=checkpoint?.rollbackGenerations?.at(-1)?.generation;
      if(!generation||!await this.get("config","library",generation))throw Error("没有回退前的新版资料副本");
      return this.createBackupBlob(()=>{},generation);
    }
    restoreUpgradeCheckpoint() {
      return this.enqueue(async()=>{
        const expected=await this.versionState(),checkpoint=(await this.meta("upgrade-2.19.0"))?.value,target=checkpoint?.generation;
        if(expected.active!==this.generation)throw Error("资料库已在其他页面切换，请重新打开后恢复");
        const targetConfig=target?await this.get("config","library",target):null;
        if(!targetConfig)throw Error("没有可恢复的升级前资料");
        await this.restorePointers(expected,target,targetConfig,checkpoint,true);
      });
    }
    async restorePointers(expected,target,targetConfig,checkpoint,upgrade=false) {
      if(target===expected.active)throw Error("目标资料库与当前资料库相同，无需恢复");
      const tx=this.db.transaction(["meta","config"],"readwrite"),done=completed(tx);
      try {
        const [active,previous,revision,actualCheckpoint,actualConfig]=await Promise.all([
          ...["active","previous","revision","upgrade-2.19.0"].map(id=>request(tx.objectStore("meta").get(id))),
          request(tx.objectStore("config").get([target,"library"]))
        ]);
        const actual={active:active?.value||"",previous:previous?.value||"",revision:revision?.value};
        if(!this.sameVersion(expected,actual)||JSON.stringify(actualCheckpoint?.value??null)!==JSON.stringify(checkpoint??null)||JSON.stringify(actualConfig?.value??null)!==JSON.stringify(targetConfig))throw Error("资料库已在其他页面修改，请重新打开并核对后恢复");
        if(upgrade){const rollbackGenerations=[...(checkpoint.rollbackGenerations||[])];if(!rollbackGenerations.some(item=>item.generation===actual.active))rollbackGenerations.push({generation:actual.active,created:new Date().toISOString()});tx.objectStore("meta").put({id:"upgrade-2.19.0",value:{...checkpoint,rollbackGenerations}});}
        tx.objectStore("meta").put({id:"active",value:target});tx.objectStore("meta").put({id:"previous",value:actual.active});tx.objectStore("meta").put({id:"revision",value:uid()});
        await done;this.generation=target;this.metadataHashes.clear();
      }catch(error){try{tx.abort();}catch(_){}await done.catch(()=>{});throw error;}
    }
    async importLibrary(lib,options={}) {return this.importRows(libraryRows(lib),options);}
    importRows(iterable,options={}) { return this.enqueue(() => this.stageImport(iterable,options)); }
    async stageImport(iterable,{merge=false,onProgress=()=>{},upgradeCheckpoint=null,expectedRevision,expectedState}={}) {
      const generation="generation_"+uid(),oldGeneration=this.generation,initial=await this.versionState(),obsoleteGeneration=initial.previous,revision=initial.revision;
      if(initial.active!==oldGeneration || expectedState&&!this.sameVersion(initial,expectedState) || expectedRevision!==undefined&&revision!==expectedRevision)throw Error("资料已在其他页面修改，请重新打开后升级或导入");
      const mapTable={athlete:"athletes",record:"records",group:"groups",profile:"profiles",config:"config"};
      const seen=new Map(Object.keys(mapTable).map(k=>[k,new Set()])),references=[],owners=new Map(),profiles=new Map(),groups=new Map(),profileMap=new Map(),groupMap=new Map(),recordMap={};
      let config=null,header=false,ended=false,pending=[], imported=0,seeded=false,lastType=-1;
      let incomingPlans=[],incomingReports=[],plansMerged=false;const planMap=new Map();
      const mergePlans=()=>{
        if(plansMerged)return;plansMerged=true;
        const merged=seeded?clone(config.testPlans||[]):[];
        for(const item of incomingPlans){
          const plan=clone(item);plan.defaultEvaluationProfileId=profileMap.get(plan.defaultEvaluationProfileId)||plan.defaultEvaluationProfileId;
          const existing=merged.find(p=>p.id===plan.id);
          if(existing&&E.canonical(existing)===E.canonical(plan))continue;
          if(existing){const id="plan_"+uid();planMap.set(plan.id,id);plan.id=id;plan.name=plan.name.slice(0,116)+"（导入）";}
          merged.push(plan);
        }
        config.testPlans=merged;
      };
      const counts={athlete:0,record:0,group:0,profile:0,config:0};
      const flush=async()=>{
        if(!pending.length)return;const rows=pending;pending=[];
        const tx=this.db.transaction(tables,"readwrite"),done=completed(tx);
        for(const row of rows){const table=mapTable[row.type],id=row.type==="record"?row.value.recordId:row.type==="config"?"library":row.value.id;
          tx.objectStore(table).put({generation,id,value:row.value});
          if(row.type==="record")tx.objectStore("recordIndex").put({generation,id,value:summary(row.value)});
        }await done;
      };
      try{
        if(merge&&oldGeneration){
          for await(const row of this.rows(oldGeneration))if(mapTable[row.type]){
            pending.push(row);
            if(row.type==="athlete")owners.set(row.value.id,row.value);
            if(row.type==="profile")profiles.set(row.value.id,row.value);
            if(row.type==="group")groups.set(row.value.id,row.value);
            if(row.type==="config")config=row.value;
            if(pending.length>=40)await flush();
          }await flush();seeded=true;
        }
        for await(const raw of iterable){
          if(ended)throw Error("备份结束标记后仍有内容");
          if(!header){if(raw.type!=="header"||raw.format!=="motionbench-backup"||raw.schema!==3)throw Error("不是 MotionBench 3 版备份");header=true;continue;}
          if(raw.type==="end"){
            if(E.canonical(raw.counts)!==E.canonical(counts))throw Error("备份条数校验失败");ended=true;continue;
          }
          if(!mapTable[raw.type])throw Error("备份包含未知类型");
          const order=["config","group","profile","athlete","record"].indexOf(raw.type);
          if(order<lastType)throw Error("备份资料顺序无效");lastType=order;
          const row={type:raw.type,value:raw.type==="profile"&&E.serializeProfile?E.serializeProfile(raw.value):clone(raw.value)},v=row.value;validateEntity(row.type,v);
          const incomingId=row.type==="record"?v.recordId:row.type==="config"?"library":v.id;
          if(seen.get(row.type).has(incomingId))throw Error("备份包含重复 ID："+incomingId);
          seen.get(row.type).add(incomingId);counts[row.type]++;
          if(counts.athlete>2000||counts.record>10000)throw Error("备份超过 2000 名运动员或 10000 条记录");
          if(row.type==="config") {
            incomingPlans=clone(v.testPlans||[]);
            incomingReports=longitudinalReports(v.longitudinalReports);
            v.defaultEvaluationProfileId=profileMap.get(v.defaultEvaluationProfileId)||v.defaultEvaluationProfileId;
            if(seeded){mergeCatalog(config.catalog,v.catalog);continue;}
            config=v;
          }
          if(row.type==="profile"){
            const old=profiles.get(v.id);if(old&&E.canonical(E.serializeProfile(old))!==E.canonical(E.serializeProfile(v))){const next="evaluation_"+uid();profileMap.set(v.id,next);v.id=next;v.name+="（导入）";}
            else if(old)continue;
            profiles.set(v.id,v);
          }
          if(row.type==="group"){
            if(groups.has(v.id)&&groups.get(v.id).name!==v.name){const next="group_"+uid();groupMap.set(v.id,next);v.id=next;}
            groups.set(v.id,v);
          }
          if(row.type==="athlete"){
            mergePlans();
            v.groupId=groupMap.get(v.groupId)||v.groupId||"";
            if(owners.has(v.id)&&seeded)continue;
            delete v.records;owners.set(v.id,v);
          }
          if(row.type==="record"){
            mergePlans();
            if(v.testPlanSnapshot&&planMap.has(v.testPlanSnapshot.id))v.testPlanSnapshot.id=planMap.get(v.testPlanSnapshot.id);
            v.evaluationProfileId=profileMap.get(v.evaluationProfileId)||v.evaluationProfileId;
            references.push([v.athleteId,v.evaluationProfileId]);
            if(seeded){const old=await this.get("records",v.recordId,generation);if(old){if(old.athleteId!==v.athleteId)throw Error("测试 ID 已属于另一运动员");if(E.canonical(old)===E.canonical(v))continue;v.recordId=uid();recordMap[incomingId]=v.recordId;v.title=(v.title||v.athlete.date||"测试")+"（导入副本）";}}
            imported++;if(imported%100===0)onProgress(imported);
          }
          pending.push(row);if(pending.length>=40)await flush();
        }
        if(!header||!ended||counts.config!==1)throw Error("备份不完整，原资料库保持不变");
        mergePlans(); validateTestPlans(config.testPlans,config.catalog);
        for(const plan of config.testPlans)if(!profiles.has(plan.defaultEvaluationProfileId))throw Error("测试方案的推荐评价方案不存在");
        for(const [athleteId,profileId] of references)if(!owners.has(athleteId)||!profiles.has(profileId))throw Error("测试的运动员或评价方案不存在");
        for(const a of owners.values())if(a.groupId&&!groups.has(a.groupId))throw Error("运动员所属队伍不存在");
        if(!seeded)config.defaultEvaluationProfileId=profileMap.get(config.defaultEvaluationProfileId)||config.defaultEvaluationProfileId;
        if(!profiles.has(config.defaultEvaluationProfileId))throw Error("默认评价方案不存在");
        if(incomingReports.length || config.longitudinalReports !== undefined){
          config.longitudinalReports=root.RingsideLongitudinalStore.merge(seeded?config.longitudinalReports:[],incomingReports,{recordMap,profileMap});
          await flush();
          for(const document of config.longitudinalReports){
            const owner=owners.get(document.athleteId), records=[];
            for(const id of document.recordIds)records.push(await this.get("records",id,generation));
            if(records.some(record=>!record))throw Error("纵向报告的测试记录不存在");
            root.RingsideLongitudinalStore.validateReferences(document,{athletes:owner?[{...owner,records}]:[],evaluationProfiles:[...profiles.values()]});
          }
        }
        config.activeAthleteId=owners.has(config.activeAthleteId)?config.activeAthleteId:"";
        if(config.activeRecordId){await flush();const active=await this.get("records",config.activeRecordId,generation);if(!active||active.athleteId!==config.activeAthleteId)config.activeRecordId="";}
        pending.push({type:"config",value:config});await flush();
        const actual=[await this.values("athletes",generation),await this.values("recordIndex",generation)];
        if(actual[0].length>2000||actual[1].length>10000)throw Error("合并后资料超过容量边界");
        const tx=this.db.transaction("meta","readwrite"),done=completed(tx);
        try {
          const [active,previous,currentRevision]=await Promise.all(["active","previous","revision"].map(id=>request(tx.objectStore("meta").get(id))));
          if(!this.sameVersion(initial,{active:active?.value||"",previous:previous?.value||"",revision:currentRevision?.value})) throw Error("资料已在其他页面修改，请重新预览后导入");
        } catch(error) { try {tx.abort();} catch(_) {} await done.catch(()=>{}); throw error; }
        tx.objectStore("meta").put({id:"active",value:generation});
        tx.objectStore("meta").put({id:"revision",value:uid()});
        if(upgradeCheckpoint){const prior=(await request(tx.objectStore("meta").get("upgrade-2.19.0")))?.value;tx.objectStore("meta").put({id:"upgrade-2.19.0",value:{...upgradeCheckpoint,generation:oldGeneration,upgradedGeneration:generation,rollbackGenerations:prior?.rollbackGenerations||[]}});}
        tx.objectStore("meta").put({id:"previous",value:oldGeneration});await done;
        this.generation=generation;this.metadataHashes.clear();
        if(obsoleteGeneration&&obsoleteGeneration!==oldGeneration)await this.discardGeneration(obsoleteGeneration).catch(()=>{});
        return{added:imported,skipped:counts.record-imported,recordMap,profileMap:Object.fromEntries(profileMap)};
      }catch(error){await this.discardGeneration(generation).catch(()=>{});throw error;}
    }
    async discardGeneration(generation) {
      if(!generation)return false;
      const tx=this.db.transaction(["meta",...tables],"readwrite"),done=completed(tx);
      try {
        const [active,previous,storedCheckpoint]=await Promise.all(["active","previous","upgrade-2.19.0"].map(id=>request(tx.objectStore("meta").get(id)))),checkpoint=storedCheckpoint?.value;
        const protectedGenerations=new Set([active?.value,previous?.value,checkpoint?.generation,checkpoint?.upgradedGeneration,...(checkpoint?.rollbackGenerations||[]).map(item=>item.generation)].filter(Boolean));
        if(protectedGenerations.has(generation)){await done;return false;}
        for(const table of tables)tx.objectStore(table).delete(keyRange(generation));await done;return true;
      }catch(error){try{tx.abort();}catch(_){}await done.catch(()=>{});throw error;}
    }
    restorePrevious() {
      return this.enqueue(async()=>{
        const expected=await this.versionState();
        if(expected.active!==this.generation)throw Error("资料库已在其他页面切换，请重新打开后恢复");
        const previous=expected.previous,targetConfig=previous?await this.get("config","library",previous):null,checkpoint=(await this.meta("upgrade-2.19.0"))?.value;
        if(!targetConfig)throw Error("没有可恢复的迁移前资料库");
        if(previous===expected.active)throw Error("目标资料库与当前资料库相同，无需恢复");
        if(checkpoint?.generation===previous){
          const before=await this.createLibrary(previous);
          return this.stageImport(libraryRows(E.migrate(before)),{expectedState:expected});
        }
        await this.restorePointers(expected,previous,targetConfig,checkpoint);
      });
    }
    close(){this.db.close();}
  }
  async function *libraryRows(lib){
    yield{type:"header",format:"motionbench-backup",schema:3};
    const counts={athlete:0,record:0,group:0,profile:0,config:1};
    yield{type:"config",value:configuration(lib)};
    for(const value of lib.groups||[]){counts.group++;yield{type:"group",value};}
    for(const value of lib.evaluationProfiles){counts.profile++;yield{type:"profile",value:E.serializeProfile?E.serializeProfile(value):value};}
    for(const a of lib.athletes){counts.athlete++;yield{type:"athlete",value:athleteMetadata(a)};}
    for(const a of lib.athletes)for(const value of a.records){counts.record++;yield{type:"record",value};}
    yield{type:"end",counts};
  }
  async function *fileRows(file){
    const reader=file.stream().getReader(),decoder=new TextDecoder("utf-8",{fatal:true});let buffer="",line=0;
    try{while(true){const{done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let p;
      while((p=buffer.indexOf("\n"))>=0){const text=buffer.slice(0,p).trim();buffer=buffer.slice(p+1);line++;if(text){try{yield JSON.parse(text);}catch{throw Error("备份第 "+line+" 行不是有效 JSON");}}}
      if(buffer.length>16*1024*1024)throw Error("单条备份记录过大");if(done)break;
    }if(buffer.trim()){line++;yield JSON.parse(buffer);}}finally{reader.releaseLock();}
  }
  root.RingsideStore={Repository,summary,athleteMetadata,configuration,validateEntity,validateTestPlans,libraryRows,fileRows};
})(typeof window!=="undefined"?window:globalThis);
