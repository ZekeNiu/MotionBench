(function(root){
  "use strict";
  const clone=value=>JSON.parse(JSON.stringify(value)), empty=value=>value===undefined||value===null||value==="";
  const get=(object,path)=>path.split(".").reduce((value,key)=>value?.[key],object);
  const field=(key,label,type="number",choices)=>({key,label,type,...(choices?{choices}:{})});
  const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  function attemptMetrics(record,id){return root.RingsideTests.repeatPolicy(record,id).fields.map(d=>({...field("metrics."+d.id,d.name+(d.unit?" "+d.unit:"")),id:d.id,unit:d.unit,scope:"attempt",role:"measurement"}));}
  function hopSets(record){return root.RingsideModel.repeatRows(record,"hop");}
  const historicalHopSets=record=>hopSets(record).filter(set=>set.inputMode==="jumps");
  const hopEditableSets=record=>hopSets(record).filter(set=>set.inputMode!=="jumps");
  const hopHasData=set=>Object.values(set.metrics||{}).some(value=>!empty(value))||["rsi","height","contactTimeMs","flightTimeMs","flightTimeRatio","activeStiffness","suppliedCount","validCount","selectedCount","notes"].some(key=>!empty(set.summary?.[key]))||!empty(set.notes)||set.jumps?.some(jump=>["height","contactTimeMs","flightTimeMs","notes"].some(key=>!empty(jump[key])));
  // A compact change detector, not a signature or a copy of historical measurements.
  const hopFingerprint=set=>{let hash=14695981039346656037n;for(const char of canonical(set)){hash^=BigInt(char.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(16).padStart(16,"0");};
  function timeIdentity(value){const number=Number(value);if(empty(value)||!Number.isFinite(number)||number<=0)throw Error("时间点须为大于 0 的有限数值");return String(number);}
  function timeField(timeMs,kind){const time=Number(timeIdentity(timeMs));if(!["force","rfd"].includes(kind))throw Error("未知的 IMTP 时点字段");return {...field("time:"+String(time).replace(".","p")+":"+kind,kind==="force"?time+" ms 实测力 N":"0–"+time+" ms 平均RFD N/s"),fieldId:kind==="force"?"imtp_time_force":"imtp_time_rfd",timeMs:time,kind,unit:kind==="force"?"N":"N/s",scope:"attempt",role:"measurement"};}
  function parseTimeHeader(header){const value=String(header||"").trim();let m=/^(\d+(?:\.\d+)?)\s*ms\s*实测力\s*N$/.exec(value);if(m)return timeField(m[1],"force");m=/^0[–—-](\d+(?:\.\d+)?)\s*ms\s*平均\s*RFD\s*N\/s$/.exec(value);return m?timeField(m[1],"rfd"):null;}
  function imtpTimeColumns(record){const times=new Set([100,200]);for(const row of record.data?.imtp||[])for(const point of row.timePoints||[])if(!empty(point.timeMs))times.add(Number(timeIdentity(point.timeMs)));for(const value of record.imtpConfig?.entryTimeMs||[])times.add(Number(timeIdentity(value)));return [...times].sort((a,b)=>a-b).flatMap(time=>[timeField(time,"force"),timeField(time,"rfd")]);}
  function addIMTPTime(record,timeMs){const time=Number(timeIdentity(timeMs));record.imtpConfig||={};record.imtpConfig.entryTimeMs=[...new Set([...(record.imtpConfig.entryTimeMs||[]),time])].sort((a,b)=>a-b);for(const row of record.data.imtp||[])if(!(row.timePoints||[]).some(point=>Number(point.timeMs)===time)){row.timePoints||=[];row.timePoints.push({id:"imtp_point_"+root.crypto.randomUUID().replace(/-/g,""),timeMs:time,force:"",rfd:""});}return time;}
  function parameterRole(key){if(/^(?:views\.|fvpView\.|sprintFvpView\.)/.test(key))return "display";if(/(?:methodVersion|MethodVersion|sampleStepS|rfAfterS|samplingWindow|startConvention)$/.test(key))return "internal";if(/^(?:fvpAnalysis\.|sprintFvpAnalysis\.)/.test(key))return "analysis";return "condition";}
  function project(record,id){
    const T=root.RingsideTests, descriptor=T.describe(record).find(test=>test.id===id),native=T.isNative(record,id),extra=attemptMetrics(record,id);
    const txt=(key,label,choices)=>field(key,label,"text",choices), flag=(key,label)=>field(key,label,"boolean",["否","是"]), notes=txt("notes","备注");
    const stiffness=(prefix="")=>[field(prefix+"activeStiffness","设备 Active Stiffness"),txt(prefix+"activeStiffnessInputUnit","刚度单位",["kN/m","N/m"])];
    let kind="attempt",fields=[],parameters=[txt("protocol."+id,"协议 / 设备")];
    if(!native)fields=extra;
    else if(id==="fms"){kind="fms";fields=[field("action","动作序号"),txt("actionName","动作"),field("left","左分 0–3"),field("right","右分 0–3"),field("score","单项分 0–3"),flag("pain","疼痛"),txt("location","疼痛位置")];}
    else if(id==="iso"){kind="iso";fields=[txt("directionId","方向编号"),txt("directionName","关节 / 运动方向"),field("attempt","试次"),field("left","左侧 / 左向"),field("right","右侧 / 右向"),field("center","中线"),txt("unit","力单位",["N","kgf","Nm"]),flag("painLeft","左侧 / 左向疼痛"),flag("painRight","右侧 / 右向疼痛"),flag("painCenter","中线疼痛"),txt("directionProtocol","方向测试条件")];}
    else if(id==="hop"){kind="hop";fields=[field("attempt","完整测试组"),...[["rsi","平均 RSI m/s"],["height","平均垂直跳跃高度 cm"],["contactTimeMs","平均触地时间 ms"],["flightTimeMs","平均腾空时间 ms"],["flightTimeRatio","平均腾空 / 触地时间比"],["suppliedCount","采集跳数"],["validCount","有效跳数"],["selectedCount","采用跳数"]].map(([key,label])=>field("summary."+key,label)),txt("summary.selectionBasis","筛选依据",["unknown","height_rsi","flight_ratio"]),...stiffness("summary."),txt("summary.notes","汇总结果备注"),...extra];}
    else if(id==="cpet"){kind="cpet";fields=[txt("phase","阶段",["peak","first","second"]),txt("label","原报告名称",["VO2peak","VO2max","VT1","LT1","VT2","LT2"]),field("vo2","摄氧量"),txt("vo2Unit","摄氧量单位",["ml/kg/min","l/min"]),field("hr","心率 bpm"),field("rer","峰值 RER"),field("speed","阈值速度 m/s"),field("power","阈值功率 W")];}
    else if(id==="sprint_fvp"){kind="sprintSplits";fields=[field("attempt","试次"),field("split","分段序号"),field("distanceM","累计距离 m"),field("timeS","原始时间 s（依计时方式）"),txt("excluded","排除此试次",["是","否"]),txt("exclusionReason","排除原因（首段填写）")];}
    else if(["fvp_sj","fvp_cmj"].includes(id))fields=[field("load","附加负荷 kg"),field("height","垂直跳跃高度 cm"),field("distanceCm","本次蹬伸距离 cm（留空沿用统一值）"),flag("excluded","排除本次"),txt("exclusionReason","排除原因"),...extra];
    else if(id==="imtp")fields=[field("peakForce","峰值力 N"),field("baselineForce","起点力 N"),field("peakTimeMs","峰值时间 ms"),field("impulse250","0–250 ms 冲量 N·s"),field("matchedImpulse","匹配时窗冲量 N·s"),field("matchedDurationMs","匹配时窗 ms"),...imtpTimeColumns(record),...extra];
    else if(["cmj","sj","dj","cmrj"].includes(id))fields=T.attemptFields(record,id).filter(f=>!f.computed&&f.key!=="activeStiffness").map(f=>field(f.key||"metrics."+f.id,f.label+" "+f.unit)).concat(["dj","cmrj"].includes(id)?stiffness():[]);
    else if(["landmine","squat","bench","deadlift"].includes(id))fields=[...(id==="landmine"?[txt("side","侧别",["L","R"])]:[]),field("load","负荷 kg"),field("velocity","速度 m/s"),...extra];
    else if(id==="mb")fields=[txt("side","侧别",["D","ND"]),field("distance","距离 m"),...extra];
    else if(id==="lactate")fields=[field("speed","速度 m/s"),field("lactate","乳酸 mmol/L"),field("hr","心率 bpm")];
    else if(id==="pushup")fields=[field("reps","60 秒有效次数"),...extra];
    else fields=[field("speed",(id==="ift"?"VIFT":"速度")+" m/s"),...(id==="ift"?[field("partial","末级未完成秒数")]:[]),...extra];
    if(kind==="attempt")fields.unshift(field("attempt",id==="lactate"?"阶段":"试次"));
    if(kind!=="cpet")fields.push(notes);
    if(native){
      if(["mas","mss","ift"].includes(id))parameters.push(txt("data."+id+".method","测试方法 / 计时距离 / 设备"));
      if(id==="pushup")parameters.push(txt("data.pushup.notes","动作标准 / 补充说明"));
      if(["cmj","imtp"].includes(id)){parameters.push(txt(id+"Config.definition","设备输出力定义",["gross","net"]),txt(id+"Config.impulseDefinition","冲量口径",["gross","net"]));if(id==="cmj")parameters.push(txt("dsi.source","DSI 等长来源",["imtp","manual"]),field("dsi.force","其他全身等长峰值力 N"),txt("dsi.protocol","其他等长测试名称"),txt("dsi.definition","其他等长力定义",["gross","net"]));}
      if(["landmine","squat","bench","deadlift"].includes(id))for(const key of id==="landmine"?["landmineL","landmineR"]:[id])parameters.push(txt("lvp."+key+".metric",(key==="landmineL"?"左侧 ":key==="landmineR"?"右侧 ":"")+"设备速度口径",["MV","MPV","PV"]));
      if(id==="lactate")parameters.push(field("thresholds.lt1","第一乳酸阈值速度 m/s"),field("thresholds.lt2","第二乳酸阈值速度 m/s"),txt("thresholds.method","阈值识别方法"));
      if(id==="cpet")parameters.push(txt("data.cpet.modality","CPET 测试方式",["treadmill","cycle"]),txt("data.cpet.protocol","CPET 协议 / 设备"));
      if(["fvp_sj","fvp_cmj"].includes(id)){const base="fvpConfig."+id+".";parameters.push(txt(base+"device","测量设备"),txt(base+"method","跳跃高度测量方法"),txt(base+"posture","动作姿势 / 下蹲深度"),field(base+"distanceCm","统一蹬伸距离 cm"),txt(base+"distanceSource","蹬伸距离来源"),field("fvpAnalysis."+id+".angle","最优剖面角度 °","number",[90,30]));}
      if(id==="sprint_fvp"){const base="sprintFvpConfig.";parameters.push(txt(base+"device","冲刺计时设备"),field(base+"heightCm","模型身高 cm（留空沿用运动员身高）"),field(base+"temperatureC","温度 °C"),field(base+"pressureHpa","气压 hPa"),field(base+"windMps","风速 m/s（顺风为正）"),txt(base+"inputTimeMode","原始时间方式",["cumulative","interval"]),txt(base+"timingStart","计时起点",["first_propulsive_action","gate_crossing","start_signal","other"]),field(base+"timeCorrectionS","确定的累计时间修正 s"),field(base+"positionStartM","空间起点距出发线 m"),field("sprintFvpAnalysis.targetDistanceM","专项目标距离 m（留空跟随末段）"));}
    }
    parameters=parameters.map(f=>({...f,scope:"project",role:parameterRole(f.key)}));
    if(["cmj","imtp"].includes(id)&&native)parameters.push({...flag("dsi.confirmed","确认峰值力单位、定义及协议可比"),role:"confirmation",scope:"record"},{...flag("impulseConfig.confirmed","确认冲量口径、推进期及发力起点可比"),role:"confirmation",scope:"record"});
    const sections=[{id,kind,fields,renderer:descriptor?.renderer}],manual=(record.definitions||[]).filter(d=>d.testId===id&&T.isManualMetric(d)&&!T.isAttemptMetric(d));
    if(manual.length)sections.push({id,kind:"custom",fields:[txt("metricId","指标编号"),txt("metricName","指标"),field("value","结果"),txt("unit","单位"),notes]});
    return {id,name:descriptor?.name||id,parameters,sections,attemptMetrics:extra};
  }
  function readiness(record,id){
    const M=root.RingsideModel,T=root.RingsideTests,issues=[];
    const add=(code,message,fields=[])=>issues.push({code,message,fields});
    if(!T.isNative(record,id))return issues;
    if(["fvp_sj","fvp_cmj"].includes(id)){
      const measured=(record.data[id]||[]).filter(row=>!empty(row.height)&&!row.excluded);
      if(measured.length){if(!(Number(record.athlete.mass)>0))add("body_mass","填写本次体重后才能计算 FVP",["athlete.mass"]);if(measured.some(row=>!(Number(row.distanceCm||record.fvpConfig?.[id]?.distanceCm)>0)))add("propulsion_distance","填写统一蹬伸距离，或为每个已测试次填写蹬伸距离",["fvpConfig."+id+".distanceCm"]);const result=root.RingsideFVP?.solve(record,id);if(result&&!result.valid&&!issues.length)add("fvp_incomplete",result.reason);}
    }
    if(id==="sprint_fvp"&&(record.data[id]||[]).some(row=>row.splits?.some(split=>!empty(split.timeS)))){const result=root.RingsideSprintFVP?.solve(record);if(result&&!result.valid)add("sprint_incomplete",result.reason);}
    if(id==="hop")for(const [index,set]of hopEditableSets(record).entries()){const summary=set.summary||{};if(Object.values(summary).some(value=>typeof value==="number")&&!(Number(summary.rsi)>0))add("hop_primary","第 "+(index+1)+" 次完整测试：填写平均 RSI 后才能选定代表测试",["summary.rsi"]);}
    if(["cmj","imtp"].includes(id)&&(record.data[id]||[]).some(row=>!empty(row.force)||!empty(row.peakForce)||!empty(row.propulsiveImpulse)||!empty(row.impulse250))){if(record.dsi?.confirmed!==true)add("dsi_confirmation","DSI 尚待确认峰值力单位、定义及协议可比",["dsi.confirmed"]);if(record.impulseConfig?.confirmed!==true)add("impulse_confirmation","iDSI 尚待确认冲量口径与发力起点可比",["impulseConfig.confirmed"]);}
    return issues;
  }
  function validateHopBaseline(record,baseline){
    if(!baseline?.length)return "";if(!record)return "此模板包含历史逐跳记录的补录关系，须在原资料库中导入";
    const existing=new Map(historicalHopSets(record).map(set=>[set.id,hopFingerprint(set)]));
    return baseline.every(item=>existing.get(item.id)===item.fingerprint)?"":"历史逐跳记录在模板导出后已有变化，请重新下载模板";
  }
  function mergeHop(existing,incoming){const old=existing?historicalHopSets(existing):[],fresh=hopEditableSets(incoming);return {...clone(incoming.data.hop),trials:[...clone(old),...clone(fresh)]};}
  root.RingsideAcquisition=Object.freeze({project,hopHasData,attemptMetrics,parameterRole,readiness,historicalHopSets,hopEditableSets,hopFingerprint,validateHopBaseline,mergeHop,imtpTimeColumns,addIMTPTime,timeField,parseTimeHeader,timeIdentity,get,canonical});
})(typeof window!=="undefined"?window:globalThis);
