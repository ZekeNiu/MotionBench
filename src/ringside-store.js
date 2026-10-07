(function (root) {
  "use strict";
  const M = root.RingsideModel, E = root.RingsideEvaluation;
  const clone = v => JSON.parse(JSON.stringify(v)), uid = () => root.crypto.randomUUID();
  const tables = ["athletes", "records", "recordIndex", "groups", "profiles", "config"];
  const request = r => new Promise((resolve,reject) => { r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
  const completed = tx => new Promise((resolve,reject) => { tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error || Error("保存事务已取消")); tx.onerror=()=>{}; });
  const keyRange = generation => IDBKeyRange.bound([generation, ""], [generation, "\uffff"]);
  function summary(r) {
    return { _summary:true, recordId:r.recordId, athleteId:r.athleteId, athlete:{date:r.athlete.date,name:r.athlete.name}, updated:r.updated,
      title:r.title || "", enabled:clone(r.enabled), demo:!!r.demo, archived:!!r.archived, deletedAt:r.deletedAt || null, evaluationProfileId:r.evaluationProfileId || "" };
  }
  function athleteMetadata(a) { const {records, ...metadata}=a; return clone(metadata); }
  function configuration(lib) {
    return {schema:3,kind:"athlete-library",catalog:clone(lib.catalog),defaultEvaluationProfileId:lib.defaultEvaluationProfileId,
      activeAthleteId:lib.activeAthleteId||"",activeRecordId:lib.activeRecordId||"",updated:lib.updated,version:"2.8.0"};
  }
  function validateEntity(type, value) {
    const safe = id => typeof id === "string" && id.length > 0 && id.length < 250 && !["__proto__","prototype","constructor"].includes(id);
    if (type === "record") { M.validateRecord(value); if (!safe(value.evaluationProfileId)) throw Error("测试缺少评价方案关联"); }
    else if (type === "profile") E.validateProfile(value);
    else if (type === "athlete") {
      if (!safe(value.id) || typeof value.name !== "string" || !value.profile || typeof value.profile !== "object" || Array.isArray(value.profile)) throw Error("运动员资料无效");
    } else if (type === "group") { if (!safe(value.id) || typeof value.name !== "string" || !value.name.trim()) throw Error("队伍信息无效"); }
    else if (type === "config") { M.validateCatalog(value.catalog); if (!safe(value.defaultEvaluationProfileId)) throw Error("默认评价方案无效"); }
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
      const lib={...config,athletes:[...owners.values()],groups,evaluationProfiles:profiles};
      this.metadataHashes.clear();
      for(const [table,items] of [["athletes",athletes],["groups",groups],["profiles",profiles],["config",[{...config,id:"library"}]]])
        for(const item of items) this.metadataHashes.set(table+":"+item.id,JSON.stringify(item));
      return lib;
    }
    loadRecord(id) { return this.get("records",id); }
    enqueue(operation) { const task=this.queue.then(operation); this.queue=task.catch(()=>{});return task; }
    flush() { return this.queue; }
    save(lib,records=[],removals={}) {
      const generation=this.generation, writes=[], nextHashes=new Map(this.metadataHashes);
      for(const [table,items] of [["athletes",lib.athletes.map(athleteMetadata)],["groups",lib.groups],["profiles",lib.evaluationProfiles],["config",[{...configuration(lib),id:"library"}]]]) {
        const known=new Set();
        for(const item of items) { const key=table+":"+item.id, encoded=JSON.stringify(item); known.add(key); if(nextHashes.get(key)!==encoded){writes.push([table,item.id,clone(item)]);nextHashes.set(key,encoded);} }
        for(const key of [...nextHashes.keys()]) if(key.startsWith(table+":")&&!known.has(key)){ (removals[table] ||= []).push(key.slice(table.length+1));nextHashes.delete(key); }
      }
      for(const r of records){validateEntity("record",r);writes.push(["records",r.recordId,clone(r)],["recordIndex",r.recordId,summary(r)]);}
      for(const id of removals.records||[]) (removals.recordIndex ||= []).push(id);
      // Hashes are installed only after commit; failure leaves the unsaved payload available to retry.
      return this.enqueue(async()=>{
        if((await this.meta("active"))?.value!==generation) throw Error("资料库已在另一个页面切换，请先备份未保存内容再重新打开");
        const names=[...new Set(writes.map(w=>w[0]).concat(Object.keys(removals)))];
        if(!names.length) return;
        const tx=this.db.transaction(names,"readwrite"),done=completed(tx);
        for(const [table,id,value] of writes) tx.objectStore(table).put({generation,id,value});
        for(const [table,ids] of Object.entries(removals)) for(const id of ids) tx.objectStore(table).delete([generation,id]);
        await done;this.metadataHashes=nextHashes;
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
    async exportLibrary() {
      await this.flush();const lib=await this.directory(), owners=new Map(lib.athletes.map(a=>{a.records=[];return[a.id,a];}));
      for await(const batch of this.batches("records"))for(const r of batch)owners.get(r.athleteId).records.push(r);
      return lib;
    }
    async importLibrary(lib,options={}) {return this.importRows(libraryRows(lib),options);}
    importRows(iterable,options={}) { return this.enqueue(() => this.stageImport(iterable,options)); }
    async stageImport(iterable,{merge=false,onProgress=()=>{}}={}) {
      const generation="generation_"+uid(),oldGeneration=this.generation;
      const mapTable={athlete:"athletes",record:"records",group:"groups",profile:"profiles",config:"config"};
      const seen=new Map(Object.keys(mapTable).map(k=>[k,new Set()])),references=[],owners=new Map(),profiles=new Map(),groups=new Map(),profileMap=new Map(),groupMap=new Map();
      let config=null,header=false,ended=false,pending=[], imported=0,seeded=false;
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
          const row={type:raw.type,value:clone(raw.value)},v=row.value;validateEntity(row.type,v);
          const incomingId=row.type==="record"?v.recordId:row.type==="config"?"library":v.id;
          if(seen.get(row.type).has(incomingId))throw Error("备份包含重复 ID："+incomingId);
          seen.get(row.type).add(incomingId);counts[row.type]++;
          if(counts.athlete>2000||counts.record>10000)throw Error("备份超过 2000 名运动员或 10000 条记录");
          if(row.type==="config") {
            v.defaultEvaluationProfileId=profileMap.get(v.defaultEvaluationProfileId)||v.defaultEvaluationProfileId;
            if(seeded){const incoming=v.catalog;for(const t of incoming.tests)if(!config.catalog.tests.some(x=>x.id===t.id)){config.catalog.tests.push(t);config.catalog.definitions.push(...incoming.definitions.filter(d=>d.testId===t.id));config.catalog.protocol[t.id]=incoming.protocol[t.id]||"";}continue;}
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
            v.groupId=groupMap.get(v.groupId)||v.groupId||"";
            if(owners.has(v.id)&&seeded)continue;
            delete v.records;owners.set(v.id,v);
          }
          if(row.type==="record"){
            v.evaluationProfileId=profileMap.get(v.evaluationProfileId)||v.evaluationProfileId;
            references.push([v.athleteId,v.evaluationProfileId]);
            if(seeded){const old=await this.get("records",v.recordId,generation);if(old){if(old.athleteId!==v.athleteId)throw Error("测试 ID 已属于另一运动员");if(E.canonical(old)===E.canonical(v))continue;v.recordId=uid();v.title=(v.title||v.athlete.date||"测试")+"（导入副本）";}}
            imported++;if(imported%100===0)onProgress(imported);
          }
          pending.push(row);if(pending.length>=40)await flush();
        }
        if(!header||!ended||counts.config!==1)throw Error("备份不完整，原资料库保持不变");
        for(const [athleteId,profileId] of references)if(!owners.has(athleteId)||!profiles.has(profileId))throw Error("测试的运动员或评价方案不存在");
        for(const a of owners.values())if(a.groupId&&!groups.has(a.groupId))throw Error("运动员所属队伍不存在");
        config.defaultEvaluationProfileId=profileMap.get(config.defaultEvaluationProfileId)||config.defaultEvaluationProfileId;
        if(!profiles.has(config.defaultEvaluationProfileId))throw Error("默认评价方案不存在");
        config.activeAthleteId=owners.has(config.activeAthleteId)?config.activeAthleteId:"";
        if(config.activeRecordId){await flush();const active=await this.get("records",config.activeRecordId,generation);if(!active||active.athleteId!==config.activeAthleteId)config.activeRecordId="";}
        pending.push({type:"config",value:config});await flush();
        const actual=[await this.values("athletes",generation),await this.values("recordIndex",generation)];
        if(actual[0].length>2000||actual[1].length>10000)throw Error("合并后资料超过容量边界");
        const tx=this.db.transaction("meta","readwrite"),done=completed(tx);
        tx.objectStore("meta").put({id:"active",value:generation});
        tx.objectStore("meta").put({id:"previous",value:oldGeneration});await done;
        this.generation=generation;this.metadataHashes.clear();return{added:imported,skipped:counts.record-imported};
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
  root.RingsideStore={Repository,summary,athleteMetadata,configuration,validateEntity,libraryRows,fileRows};
})(typeof window!=="undefined"?window:globalThis);
