(function(root){
  "use strict";
  const E=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),copy=v=>JSON.parse(JSON.stringify(v));
  const uid=()=>"reference-"+(root.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  const option=(value,name,selected)=>`<option value="${E(value)}"${value===selected?" selected":""}>${E(name)}</option>`;
  function dateWindow(kind,from,to,today=new Date().toLocaleDateString("sv-SE")){
    if(!["all","recent7","recent14","recent30","recent90","recent12","custom"].includes(kind))throw Error("请选择统计时间窗");
    if(kind==="all")return {kind,from:"",to:""};
    if(kind==="recent12"){const end=new Date(today+"T00:00:00Z"),start=new Date(end);start.setUTCFullYear(start.getUTCFullYear()-1);return {kind,from:start.toISOString().slice(0,10),to:today};}
    if(/^recent\d+$/.test(kind)){const start=new Date(today+"T00:00:00Z");start.setUTCDate(start.getUTCDate()-(Number(kind.slice(6))-1));return {kind,from:start.toISOString().slice(0,10),to:today};}
    if(!root.RingsideLongitudinalStore.validDate(from)||!root.RingsideLongitudinalStore.validDate(to)||from>to)throw Error("请填写有效且先后正确的起止日期");
    return {kind,from,to};
  }
  function resolveReferences(refs,{perspective,focus,athletes,classifications,groups}){
    const owner=athletes.find(a=>a.id===focus?.athleteId),profile=owner?.profile||{},resolved=root.RingsideClassifications.resolve(profile,classifications);
    return refs.map(ref=>{const automatic=ref.autoLabel??!ref.label?.trim(),legacy=!ref.explicitConditions&&!ref.sex,out={...copy(ref),id:ref.id,label:automatic?"":ref.label?.trim()||"",autoLabel:automatic,scope:ref.scope||"all",sampling:ref.sampling||"latest",sex:legacy&&perspective==="focus"?profile.sex||"未注明":ref.sex||"",sportId:ref.sportId||"",subdivisionId:ref.subdivisionId||"",ageBandId:ref.ageBandId||"",teamId:ref.teamId||"",explicitConditions:true};
      if(legacy&&perspective==="focus"&&ref.matchSport)out.sportId=resolved.sportId;if(legacy&&perspective==="focus"&&ref.matchSubdivision){out.sportId=resolved.sportId;out.subdivisionId=resolved.subdivisionId;if(!out.subdivisionId)throw Error("主角尚未设置主要细分，请完善档案或取消同细分条件");}
      delete out.matchSport;delete out.matchSubdivision;
      if(out.scope==="sport"&&!out.sportId)throw Error("请为专项参照选择专项");if(out.scope==="team"&&!out.teamId)throw Error("请为队伍参照选择队伍");
      const sport=classifications.sports.find(s=>s.id===out.sportId),sub=classifications.subdivisions.find(s=>s.id===out.subdivisionId),age=classifications.ageBands.find(a=>a.id===out.ageBandId),team=groups.find(g=>g.id===out.teamId);
      if(out.sportId&&!sport)throw Error("所选专项已不存在");if(out.subdivisionId&&(!sub||sub.sportId!==out.sportId))throw Error("主要细分与专项不匹配");if(out.ageBandId&&!age)throw Error("所选年龄组已不存在");
      if(age){out.ageMin=age.min;out.ageMax=age.max;out.ageBandName=age.name;}if(team)out.teamName=team.name;
      out.label ||= [out.scope==="team"?team?.name:out.scope==="sport"?sport?.name:"本机数据库",out.sex,out.scope!=="sport"?sport?.name:"",sub?.name,age?.name].filter(Boolean).join(" · ");return out;
    });
  }
  // The home selector owns the configuration draft. Kept as an API adapter for
  // callers opening a saved report; there is no second creation dialog.
  function open(options) { return root.App?.editReportSelection?.(options.configuration); }
  root.RingsideHorizontalSetup={open,dateWindow,resolveReferences};
})(typeof window!=="undefined"?window:globalThis);
