(function (root) {
  "use strict";
  const M = root.RingsideModel, E = root.RingsideEvaluation;
  const clone = v => JSON.parse(JSON.stringify(v)), uid = () => root.crypto.randomUUID();
  const tables = ["athletes", "records", "recordIndex", "groups", "profiles", "config"];
  const request = r => new Promise((resolve,reject) => { r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
  const completed = tx => new Promise((resolve,reject) => { tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error || Error("保存事务已取消")); tx.onerror=()=>{}; });
  const keyRange = generation => IDBKeyRange.bound([generation, ""], [generation, "\uffff"]);
  function summary(r) {
    return { _summary:true, recordId:r.recordId, athleteId:r.athleteId, athlete:Object.fromEntries(["date","name","age","mass","height","cycle","injury"].map(k=>[k,r.athlete[k]??""])), updated:r.updated,
      title:r.title || "", enabled:clone(r.enabled), demo:!!r.demo, archived:!!r.archived, deletedAt:r.deletedAt || null, evaluationProfileId:r.evaluationProfileId || "" };
  }
  function athleteMetadata(a) { const {records, ...metadata}=a; return clone(metadata); }
  function mergeCatalog(local, incoming) {
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
    const variant=(catalog,id,source)=>({test:clone(catalog.tests.find(t=>t.id===id)),definitions:clone(catalog.definitions.filter(d=>d.testId===id)).sort((a,b)=>a.id.localeCompare(b.id)),protocol:catalog.protocol[id]||"",source});
    const comparable = value => ({...value,source:"",
      test:{...value.test,name:value.test.id==="ift"&&value.test.name==="30–15 IFT"?"30-15VIFT":value.test.name,
        ...(["fms","iso"].includes(value.test.id)&&(value.test.primaryAbility===""||value.test.primaryAbility===undefined)
          ? {primaryAbility:value.test.id==="fms"?"动作筛查":"等长力量"} : {})},
      definitions:value.definitions.map(d=>({...d,name:root.RingsideTests.metricName(d),protocol:root.Def.viftProtocol(d.id,d.protocol)}))});
    const same=(a,b)=>E.canonical(comparable(a))===E.canonical(comparable(b));
    for(const t of incoming.tests){
      if(!local.tests.some(x=>x.id===t.id)){local.tests.push(clone(t));local.definitions.push(...clone(incoming.definitions.filter(d=>d.testId===t.id)));local.protocol[t.id]=incoming.protocol[t.id]||"";continue;}
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
    return {schema:3,kind:"athlete-library",catalog:clone(lib.catalog),testPlans:clone(lib.testPlans||[]),defaultEvaluationProfileId:lib.defaultEvaluationProfileId,
      activeAthleteId:lib.activeAthleteId||"",activeRecordId:lib.activeRecordId||"",updated:lib.updated,version:"2.16.0"};
  }
  function validateEntity(type, value) {
    const safe = id => typeof id === "string" && id.length > 0 && id.length < 250 && !["__proto__","prototype","constructor"].includes(id);
    if (type === "record") { M.validateRecord(value); if (!safe(value.evaluationProfileId)) throw Error("测试缺少评价方案关联"); }
    else if (type === "profile") E.validateProfile(value);
    else if (type === "athlete") {
      if (!safe(value.id) || typeof value.name !== "string" || !value.profile || typeof value.profile !== "object" || Array.isArray(value.profile)) throw Error("运动员资料无效");
    } else if (type === "group") { if (!safe(value.id) || typeof value.name !== "string" || !value.name.trim()) throw Error("队伍信息无效"); }
    else if (type === "config") { M.validateCatalog(value.catalog); validateTestPlans(value.testPlans,value.catalog); if (!safe(value.defaultEvaluationProfileId)) throw Error("默认评价方案无效"); }
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
    async get(table,id,generation=this.generation) { return (await request(this.db.transaction(table).objectStore(table).get([generation,id])))?.value; }
    async values(table,generation=this.generation) { return (await request(this.db.transaction(table).objectStore(table).getAll(keyRange(generation)))).map(row=>row.value); }
    async directory() {
      const [config,athletes,index,groups,profiles]=await Promise.all([this.get("config","library"),this.values("athletes"),this.values("recordIndex"),this.values("groups"),this.values("profiles")]);
      if(!config) throw Error("资料库配置缺失");
      const owners=new Map(athletes.map(a=>[a.id,{...a,records:[]} ]));
      for(const r of index) owners.get(r.athleteId)?.records.push(r);
      const lib={...config,testPlans:config.testPlans||[],athletes:[...owners.values()],groups,evaluationProfiles:profiles};
      this.metadataHashes.clear();
      for(const [table,items] of [["athletes",athletes],["groups",groups],["profiles",profiles],["config",[{...config,id:"library"}]]])
        for(const item of items) this.metadataHashes.set(table+":"+item.id,JSON.stringify(item));
      return lib;
    }
    loadRecord(id) { return this.get("records",id); }
    enqueue(operation) { const task=this.queue.then(operation); this.queue=task.catch(()=>{});return task; }
    flush() { return this.queue; }
    save(lib,records=[],removals={},checks={}) {
      const generation=this.generation;
      const metadata=[["athletes",lib.athletes.map(athleteMetadata)],["groups",lib.groups],["profiles",lib.evaluationProfiles],["config",[{...configuration(lib),id:"library"}]]].map(([table,items])=>[table,clone(items)]);
      const snapshots=records.map(r=>{validateEntity("record",r);return clone(r);}),deletions=clone(removals),expected=clone(checks);
      // Capture caller values now, but compare metadata only after preceding writes commit.
      return this.enqueue(async()=>{
        if((await this.meta("active"))?.value!==generation) throw Error("资料库已在另一个页面切换，请先备份未保存内容再重新打开");
        const writes=[],nextHashes=new Map(this.metadataHashes);
        for(const [table,items] of metadata){
          const known=new Set();
          for(const item of items){const key=table+":"+item.id,encoded=JSON.stringify(item);known.add(key);if(nextHashes.get(key)!==encoded){writes.push([table,item.id,item]);nextHashes.set(key,encoded);}}
          for(const key of [...nextHashes.keys()])if(key.startsWith(table+":")&&!known.has(key)){(deletions[table] ||= []).push(key.slice(table.length+1));nextHashes.delete(key);}
        }
        for(const r of snapshots)writes.push(["records",r.recordId,r],["recordIndex",r.recordId,summary(r)]);
        for(const id of deletions.records||[])(deletions.recordIndex ||= []).push(id);
        const guarded = expected.expectedConfig !== undefined || expected.expectedRecords || expected.expectedAthletes || expected.expectedProfiles || expected.expectedOwnerRecordIds;
        const names=[...new Set(writes.map(w=>w[0]).concat(Object.keys(deletions), ["meta"], guarded ? ["records","athletes","config"] : [], expected.expectedProfiles ? ["profiles"] : [], expected.expectedOwnerRecordIds ? ["recordIndex"] : [], snapshots.length ? ["athletes"] : []))];
        if(!writes.length&&!Object.keys(deletions).length&&!guarded)return;
        const tx=this.db.transaction(names,"readwrite"),done=completed(tx);
        try {
          const active = await request(tx.objectStore("meta").get("active"));
          if (active?.value !== generation) throw Error("资料库已在另一个页面切换，请重新打开并重新预览");
          const comparisons = [];
          for (const [table, entries] of [["records", expected.expectedRecords], ["athletes", expected.expectedAthletes], ["profiles", expected.expectedProfiles]])
            for (const [id, encoded] of Object.entries(entries || {})) comparisons.push(request(tx.objectStore(table).get([generation,id])).then(row => JSON.stringify(row?.value ?? null) === encoded));
          if (expected.expectedConfig !== undefined) comparisons.push(request(tx.objectStore("config").get([generation,"library"])).then(row => JSON.stringify(row?.value ?? null) === expected.expectedConfig));
          if ((await Promise.all(comparisons)).some(matches => !matches)) throw Error("导入预览已过期：资料已被其他页面修改，请重新预览后再导入");
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
          for(const [table,id,value] of writes)tx.objectStore(table).put({generation,id,value});
          for(const [table,ids] of Object.entries(deletions))for(const id of ids)tx.objectStore(table).delete([generation,id]);
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
    async createBackupBlob(onProgress) {
      const chunks=[];let records=0;
      for await(const row of this.rows()) {chunks.push(new Blob([JSON.stringify(row)+"\n"],{type:"application/x-ndjson"}));if(row.type==="record"&&++records%100===0)onProgress(records);}
      return new Blob(chunks,{type:"application/x-ndjson"});
    }
    exportLibrary() { return this.enqueue(() => this.createLibrary()); }
    async createLibrary() {
      const lib=await this.directory(), owners=new Map(lib.athletes.map(a=>{a.records=[];return[a.id,a];}));
      for await(const batch of this.batches("records"))for(const r of batch)owners.get(r.athleteId).records.push(r);
      return lib;
    }
    async importLibrary(lib,options={}) {return this.importRows(libraryRows(lib),options);}
    importRows(iterable,options={}) { return this.enqueue(() => this.stageImport(iterable,options)); }
    async stageImport(iterable,{merge=false,onProgress=()=>{}}={}) {
      const generation="generation_"+uid(),oldGeneration=this.generation,obsoleteGeneration=(await this.meta("previous"))?.value;
      const mapTable={athlete:"athletes",record:"records",group:"groups",profile:"profiles",config:"config"};
      const seen=new Map(Object.keys(mapTable).map(k=>[k,new Set()])),references=[],owners=new Map(),profiles=new Map(),groups=new Map(),profileMap=new Map(),groupMap=new Map(),recordMap={};
      let config=null,header=false,ended=false,pending=[], imported=0,seeded=false,lastType=-1;
      let incomingPlans=[],plansMerged=false;const planMap=new Map();
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
          const row={type:raw.type,value:clone(raw.value)},v=row.value;validateEntity(row.type,v);
          const incomingId=row.type==="record"?v.recordId:row.type==="config"?"library":v.id;
          if(seen.get(row.type).has(incomingId))throw Error("备份包含重复 ID："+incomingId);
          seen.get(row.type).add(incomingId);counts[row.type]++;
          if(counts.athlete>2000||counts.record>10000)throw Error("备份超过 2000 名运动员或 10000 条记录");
          if(row.type==="config") {
            incomingPlans=clone(v.testPlans||[]);
            v.defaultEvaluationProfileId=profileMap.get(v.defaultEvaluationProfileId)||v.defaultEvaluationProfileId;
            if(seeded){mergeCatalog(config.catalog,v.catalog);continue;}
            config=v;
          }
          if(row.type==="profile"){
            const old=profiles.get(v.id);if(old&&E.signature(old.criteria)!==E.signature(v.criteria)){const next="evaluation_"+uid();profileMap.set(v.id,next);v.id=next;v.name+="（导入）";}
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
        config.activeAthleteId=owners.has(config.activeAthleteId)?config.activeAthleteId:"";
        if(config.activeRecordId){await flush();const active=await this.get("records",config.activeRecordId,generation);if(!active||active.athleteId!==config.activeAthleteId)config.activeRecordId="";}
        pending.push({type:"config",value:config});await flush();
        const actual=[await this.values("athletes",generation),await this.values("recordIndex",generation)];
        if(actual[0].length>2000||actual[1].length>10000)throw Error("合并后资料超过容量边界");
        const tx=this.db.transaction("meta","readwrite"),done=completed(tx);
        tx.objectStore("meta").put({id:"active",value:generation});
        tx.objectStore("meta").put({id:"previous",value:oldGeneration});await done;
        this.generation=generation;this.metadataHashes.clear();
        if(obsoleteGeneration&&obsoleteGeneration!==oldGeneration)await this.discardGeneration(obsoleteGeneration).catch(()=>{});
        return{added:imported,skipped:counts.record-imported,recordMap};
      }catch(error){await this.discardGeneration(generation);throw error;}
    }
    async discardGeneration(generation) {
      if(!generation||generation===this.generation)return;
      const tx=this.db.transaction(tables,"readwrite"),done=completed(tx);
      for(const table of tables)tx.objectStore(table).delete(keyRange(generation));await done;
    }
    async restorePrevious() {
      await this.flush();const previous=(await this.meta("previous"))?.value;
      if(!previous||!await this.get("config","library",previous))throw Error("没有可恢复的迁移前资料库");
      const tx=this.db.transaction("meta","readwrite"),done=completed(tx);
      tx.objectStore("meta").put({id:"active",value:previous});tx.objectStore("meta").put({id:"previous",value:this.generation});await done;this.generation=previous;this.metadataHashes.clear();
    }
    close(){this.db.close();}
  }
  async function *libraryRows(lib){
    yield{type:"header",format:"motionbench-backup",schema:3};
    const counts={athlete:0,record:0,group:0,profile:0,config:1};
    yield{type:"config",value:configuration(lib)};
    for(const value of lib.groups||[]){counts.group++;yield{type:"group",value};}
    for(const value of lib.evaluationProfiles){counts.profile++;yield{type:"profile",value};}
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
