(function (root) {
  "use strict";
  const M = root.RingsideModel, T = root.RingsideTests;
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => "xlsx_" + root.crypto.randomUUID().replace(/-/g, "");
  const empty = value => value === "" || value === null || value === undefined;
  const safe = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,249}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
  const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
  function put(object, path, value) {
    const parts = path.split(".");
    if (parts.some(key => ["__proto__", "prototype", "constructor"].includes(key))) throw Error("无效字段");
    const key = parts.pop(); let parent = object;
    for (const part of parts) parent = parent[part] ||= {};
    parent[key] = value;
  }
  const canonical = value => JSON.stringify(value, (key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().filter(k => k !== "id").map(k => [k, item[k]]));
    return item;
  });
  const field = (key, label, type = "number", choices) => ({key, label, type, ...(choices ? {choices} : {})});
  const text = (key, label, choices) => field(key, label, "text", choices);
  const bool = (key, label) => field(key, label, "boolean", ["否", "是"]);
  function choiceLabels(f) {
    const key=f.key.split(".").at(-1);
    if(key==="inputMode")return {summary:"设备汇总",jumps:"逐跳"};
    if(key==="phase")return {peak:"峰值",first:"第一阈值",second:"第二阈值"};
    if(key==="modality")return {treadmill:"跑台",cycle:"功率车"};
    if(key==="definition")return {gross:"总力",net:"净力"};
    if(key==="impulseDefinition")return {gross:"总力积分",net:"净力积分（扣除体重）"};
    if(key==="source")return {imtp:"IMTP 汇总结果",manual:"其他全身等长测试"};
    if(key==="selectionBasis")return {unknown:"未注明",height_rsi:"按 RSI 筛选",flight_ratio:"按腾空 / 触地时间比筛选"};
    if(key==="side")return {L:"左侧",R:"右侧",D:"优势侧",ND:"非优势侧"};
    if(key==="vo2Unit")return {"ml/kg/min":"mL·kg⁻¹·min⁻¹","l/min":"L/min"};
    if(key==="label")return {VO2peak:"VO₂peak",VO2max:"VO₂max"};
    return {};
  }
  const displayChoice=(f,value)=>choiceLabels(f)[value]??value;
  const metaFields = [field("date", "测试日期 YYYY-MM-DD", "date"), field("age", "本次年龄 岁"), field("mass", "本次体重 kg"), field("height", "本次身高 cm")];
  const prefix = [text("recordId", "测试编号"), text("athleteId", "运动员编号"), text("name", "运动员")];
  const notes = text("notes", "备注");
  const isoRows = record => M.selectedIsoRows ? M.selectedIsoRows(record) : record.data.iso;
  const selectedTests = record => {
    const tests=T.describe(record).filter(test=>record.enabled[test.id]),order=record.testPlanSnapshot?.testIds||[];
    const ranks=new Map(tests.map((test,index)=>[test.id,order.includes(test.id)?order.indexOf(test.id):order.length+index]));
    return tests.sort((a,b)=>ranks.get(a.id)-ranks.get(b.id));
  };
  const stiffness = () => [field("activeStiffness", "设备 Active Stiffness"), text("activeStiffnessInputUnit", "刚度单位", ["kN/m", "N/m"])];
  function attemptFields(record, id) {
    const extra = T.repeatPolicy(record, id).fields.map(d => field("metrics." + d.id, d.name + " " + d.unit));
    let fields;
    if (!T.isNative(record, id)) fields = extra;
    else if (["cmj", "sj", "dj", "cmrj"].includes(id)) fields = T.attemptFields(record, id).filter(f => !f.computed && f.key !== "activeStiffness").map(f => field(f.key || "metrics." + f.id, f.label + " " + f.unit)).concat(["dj", "cmrj"].includes(id) ? stiffness() : []);
    else if (id === "imtp") fields = [field("peakForce", "峰值力 N"), field("baselineForce", "起点力 N"), field("peakTimeMs", "峰值时间 ms"), field("impulse250", "0–250 ms 冲量 N·s"), field("matchedImpulse", "匹配时窗冲量 N·s"), field("matchedDurationMs", "匹配时窗 ms"), ...extra];
    else if (["landmine", "squat", "bench", "deadlift"].includes(id)) fields = [...(id === "landmine" ? [text("side", "侧别", ["L", "R"])] : []), field("load", "负荷 kg"), field("velocity", "速度 m/s"), ...extra];
    else if (id === "mb") fields = [text("side", "侧别", ["D", "ND"]), field("distance", "距离 m"), ...extra];
    else if (id === "lactate") fields = [field("speed", "速度 m/s"), field("lactate", "乳酸 mmol/L"), field("hr", "心率 bpm")];
    else if (id === "pushup") fields = [field("reps", "60 秒有效次数"), ...extra];
    else fields = [field("speed", (id === "ift" ? "VIFT" : "速度") + " m/s"), ...(id === "ift" ? [field("partial", "末级未完成秒数")] : []), ...extra];
    return fields.concat(notes);
  }
  function settings(record, id) {
    const rows = [text("protocol." + id, "协议 / 设备")];
    if (["mas", "mss", "ift"].includes(id)) rows.push(text("data." + id + ".method", "测试方法 / 计时距离 / 设备"));
    if (id === "pushup") rows.push(text("data.pushup.notes", "动作标准 / 补充说明"));
    if (["cmj", "imtp"].includes(id)) {
      const key = id + "Config";
      rows.push(text(key + ".definition", "设备输出力定义", ["gross", "net"]), text(key + ".impulseDefinition", "冲量口径", ["gross", "net"]));
      if (id === "cmj") rows.push(text("dsi.source", "DSI 等长来源", ["imtp", "manual"]), field("dsi.force", "其他全身等长峰值力 N"), text("dsi.protocol", "其他等长测试名称"), text("dsi.definition", "其他等长力定义", ["gross", "net"]));
    }
    if (["landmine", "squat", "bench", "deadlift"].includes(id)) for (const key of id === "landmine" ? ["landmineL", "landmineR"] : [id]) rows.push(text("lvp." + key + ".metric", (key === "landmineL" ? "左侧 " : key === "landmineR" ? "右侧 " : "") + "设备速度口径", ["MV", "MPV", "PV"]));
    if (id === "lactate") rows.push(field("thresholds.lt1", "第一乳酸阈值速度 m/s"), field("thresholds.lt2", "第二乳酸阈值速度 m/s"), text("thresholds.method", "阈值识别方法"));
    if (id === "cpet" && T.isNative(record, id)) rows.push(text("data.cpet.modality", "CPET 测试方式", ["treadmill", "cycle"]), text("data.cpet.protocol", "CPET 协议 / 设备"));
    return rows;
  }
  const isSharedSetting = f => f.key.startsWith("dsi.");
  const sharedSettings = record => [...new Map(selectedTests(record).flatMap(test=>settings(record,test.id)).filter(isSharedSetting).map(f=>[f.key,f])).values()];
  function change(f,before,after,extra={}) {
    return {field:f.key,label:f.label,before:before??"",after:after??"",displayBefore:displayChoice(f,before??""),displayAfter:displayChoice(f,after??""),...extra};
  }
  function projectConditions(previous,incoming,id) {
    if(!previous)return [];
    const changes=settings(incoming,id).filter(f=>!isSharedSetting(f)&&String(get(previous,f.key)??"")!==String(get(incoming,f.key)??"")).map(f=>change(f,get(previous,f.key),get(incoming,f.key)));
    if(id==="iso")for(const direction of isoRows(incoming)){
      const prior=previous.data.iso.find(row=>row.id===direction.id);if(!prior)continue;
      const label=(M.REG[direction.region]||direction.region)+" · "+direction.direction;
      for(const [key,name]of [["unit","力单位"],["protocol","测试条件"]])if(String(prior[key]??"")!==String(direction[key]??""))changes.push(change(text("data.iso."+direction.id+"."+key,label+" · "+name),prior[key],direction[key],{directionId:direction.id}));
    }
    return changes;
  }
  function contract(record, id) {
    const descriptor = T.describe(record).find(t => t.id === id);
    return {renderer: descriptor?.renderer, definitions: record.definitions.filter(d => d.testId === id && T.isManualMetric(d)).map(d => ({id:d.id, unit:d.unit, entryScope:d.entryScope || "record"})).sort((a,b) => a.id.localeCompare(b.id)), fields: attemptFields(record, id).map(f => [f.key, f.label.match(/ (N|kgf|N\/kg)$/)?.[1] || ""])};
  }
  function blankRecord(input) {
    const record = M.normalizeRecord(clone(input));
    record.narrative = M.defaults().narrative;
    record.customValues = {};
    const defaults = M.defaults();
    record.data = clone(defaults.data);
    for(const id of ["ift","mas","mss"])for(const key of ["protocol","unit","method"])if(input.data[id]?.[key]!==undefined)record.data[id][key]=input.data[id][key];
    record.data.iso = input.data.iso.map(row => ({...clone(row), left:"", right:"", center:"", painLeft:false, painRight:false, painCenter:false, notes:"", trials:[]}));
    for (const test of record.customTests) record.data[test.id] = [];
    record.thresholds = {...record.thresholds, lt1:"", lt2:""};
    record.dsi = {...record.dsi, force:"", confirmed:false};
    record.impulseConfig = {confirmed:false};
    delete record.excelImport;
    return record;
  }
  function makeSpecs(records) {
    const specs = [{name:"本次测试", kind:"metadata", fields:prefix.concat(metaFields)}];
    const ids = [...new Set(records.flatMap(record => selectedTests(record).map(t => t.id)))];
    ids.forEach((id, index) => {
      const sources = records.filter(r => r.enabled[id]), source = sources[0], descriptor = T.describe(source).find(t => t.id === id);
      if (sources.some(record => canonical(contract(record,id)) !== canonical(contract(source,id)))) throw Error(descriptor.name + " 的字段或单位不一致，请分别下载模板");
      const label = ((index + 1).toString().padStart(2, "0") + "_" + descriptor.name).replace(/[\\/*?:\[\]]/g, "_").slice(0, 26);
      const add = (kind, suffix, fields) => specs.push({id, name:label + suffix, kind, fields:prefix.concat(fields)});
      if (id === "fms") add("fms", "", [field("action", "动作序号"), text("actionName", "动作"), field("left", "左分 0–3"), field("right", "右分 0–3"), field("score", "单项分 0–3"), bool("pain", "疼痛"), text("location", "疼痛位置"), notes]);
      else if (id === "iso") add("iso", "", [text("directionId", "方向编号"), text("directionName", "关节 / 运动方向"), field("attempt", "试次"), field("left", "左侧 / 左向"), field("right", "右侧 / 右向"), field("center", "中线"), text("unit", "力单位", ["N", "kgf", "Nm"]), bool("painLeft", "左侧 / 左向疼痛"), bool("painRight", "右侧 / 右向疼痛"), bool("painCenter", "中线疼痛"), text("directionProtocol", "方向测试条件"), notes]);
      else if (id === "hop" && T.isNative(source,id)) {
        add("hop", "", [field("attempt", "完整测试组"), text("inputMode", "录入方式", ["summary", "jumps"]), ...["rsi", "height", "contactTimeMs", "flightTimeMs", "flightTimeRatio", "suppliedCount", "validCount", "selectedCount"].map((key,i) => field("summary."+key,["设备平均 RSI m/s","平均跳高 cm","平均触地 ms","平均腾空 ms","平均腾空/触地比","设备录入跳数","设备有效跳数","设备采用跳数"][i])), text("summary.selectionBasis", "设备筛选依据", ["unknown","height_rsi","flight_ratio"]), ...stiffness().map(f => ({...f,key:"summary."+f.key})), text("summary.notes", "设备汇总备注"), notes]);
        add("hopJumps", "_逐跳", [field("attempt", "完整测试组"), field("jump", "跳次"), field("height", "垂直跳高 cm"), field("contactTimeMs", "触地 ms"), field("flightTimeMs", "腾空 ms"), notes]);
      } else if (id === "cpet" && T.isNative(source,id)) add("cpet", "", [text("phase", "阶段", ["peak", "first", "second"]), text("label", "原报告名称", ["VO2peak", "VO2max", "VT1", "LT1", "VT2", "LT2"]), field("vo2", "摄氧量"), text("vo2Unit", "摄氧量单位", ["ml/kg/min","l/min"]), field("hr", "心率 bpm"), field("rer", "峰值 RER"), field("speed", "阈值速度 m/s"), field("power", "阈值功率 W")]);
      else add("attempt", "", [field("attempt", id === "lactate" ? "阶段" : "试次"), ...attemptFields(source,id)]);
      if (id === "imtp") add("timePoints", "_时间点", [field("attempt", "试次"), field("timeMs", "时间 ms"), field("force", "实测力 N"), field("rfd", "0–t 平均 RFD N/s")]);
      const manual = source.definitions.filter(d => d.testId === id && T.isManualMetric(d) && !T.isAttemptMetric(d));
      if (manual.length) add("custom", "_补充指标", [text("metricId", "指标编号"), text("metricName", "指标"), field("value", "结果"), text("unit", "单位"), notes]);
    });
    specs.push({name:"测试条件", kind:"settings", fields:prefix.concat([text("testId","项目编号"), text("testName","项目"), text("fieldId","条件编号"), text("fieldName","条件"), text("value","填写值"), text("choices","可选值 / 单位说明")])});
    return specs;
  }
  const identity = record => ({recordId:record.recordId,athleteId:record.athleteId,name:record.athlete.name+" · "+(record.athlete.sport||"未填专项")+" · "+record.athleteId.slice(-6)});
  function writeValue(value, descriptor) {
    if (descriptor.type === "boolean") return value ? "是" : "否";
    return empty(value) ? null : displayChoice(descriptor,value);
  }
  function dataRows(spec, record, prefill) {
    const raw = record.data[spec.id], result = [], push = row => result.push({...row, ...identity(record)});
    const fill = value => prefill ? clone(value) : {};
    if (spec.kind === "metadata") { push(Object.fromEntries(metaFields.map(f => [f.key,record.athlete[f.key] ?? ""]))); return result; }
    if (spec.kind === "settings") {
      for (const test of selectedTests(record)) for (const f of settings(record,test.id)) push({testId:test.id,testName:test.name,fieldId:f.key,fieldName:f.label,value:(!prefill && ["dsi.force","thresholds.lt1","thresholds.lt2"].includes(f.key)) ? "" : get(record,f.key) ?? "",choices:f.choices?.map(value=>displayChoice(f,value)).join(" / ") || (f.type === "number" ? "数值；未知留空" : "文字；可留空")});
      return result;
    }
    if (!record.enabled[spec.id]) return result;
    if (spec.kind === "fms") raw.forEach((row,i) => push({...fill(row),action:i+1,actionName:row.name}));
    else if (spec.kind === "iso") for (const direction of isoRows(record)) {
      const trials = prefill ? M.repeatRows(record,"iso",record.data.iso.findIndex(r => r.id === direction.id)) : Array.from({length:3},()=>({}));
      trials.forEach((row,i) => push({...clone(row),directionId:direction.id,directionName:(M.REG[direction.region] || direction.region)+" · "+direction.direction,attempt:i+1,unit:direction.unit,directionProtocol:direction.protocol || ""}));
    } else if (spec.kind === "hop" || spec.kind === "hopJumps") {
      const sets = prefill ? M.repeatRows(record,"hop") : Array.from({length:3},()=>M.newHopSet());
      sets.forEach((set,i) => {
        if (spec.kind === "hop") {
          const row = clone(set); if (row.summary.activeStiffnessInputUnit === "N/m" && !empty(row.summary.activeStiffness)) row.summary.activeStiffness *= 1000;
          row.summary.activeStiffnessInputUnit ||= "kN/m"; push({...row,attempt:i+1});
        } else (prefill ? set.jumps : Array.from({length:10},()=>({}))).forEach((jump,j) => push({...clone(jump),attempt:i+1,jump:j+1}));
      });
    } else if (spec.kind === "cpet") for (const phase of ["peak","first","second"]) {
      const data = phase === "peak" ? raw : raw.thresholds[phase];
      push({...fill(data),phase,label:phase === "peak" ? raw.oxygenLabel : data.label,vo2Unit:data.vo2Unit,hr:prefill ? (phase === "peak" ? raw.peakHr : data.hr) : ""});
    } else if (spec.kind === "custom") for (const d of record.definitions.filter(d => d.testId === spec.id && T.isManualMetric(d) && !T.isAttemptMetric(d))) push({...fill(record.customValues[d.id] || {}),metricId:d.id,metricName:d.name,unit:d.unit});
    else if (spec.kind === "timePoints") {
      const attempts = prefill ? raw : Array.from({length:3},()=>({timePoints:[{timeMs:100},{timeMs:200}]}));
      attempts.forEach((row,i) => (row.timePoints || []).forEach(point => push({...clone(point),attempt:i+1})));
    } else {
      let rows = prefill ? M.repeatRows(record,spec.id) : Array.from({length:spec.id === "lactate" ? 1 : 3},()=>({}));
      if (!prefill && ["landmine","mb"].includes(spec.id)) rows = (spec.id === "landmine" ? ["L","R"] : ["D","ND"]).flatMap(side => Array.from({length:3},()=>({side})));
      rows.forEach((row,i) => {
        row = clone(row); if (row.activeStiffnessInputUnit === "N/m" && !empty(row.activeStiffness)) row.activeStiffness *= 1000;
        if (["dj","cmrj"].includes(spec.id)) row.activeStiffnessInputUnit ||= "kN/m";
        push({...row,attempt:i+1});
      });
    }
    return result;
  }
  function requireExcel() { if (!root.ExcelJS?.Workbook) throw Error("Excel 离线组件尚未加载，请使用完整版本重新打开"); }
  async function createTemplate({records, prefill = false}) {
    requireExcel();
    if (!Array.isArray(records) || !records.length || records.length > 300) throw Error("请选择 1–300 名已有运动员");
    const ids = new Set(); records = records.map(input => {
      const record = M.normalizeRecord(clone(input)); M.validateRecord(record);
      if (!safe(record.athleteId) || !safe(record.recordId) || ids.has(record.recordId)) throw Error("运动员或目标测试编号无效 / 重复");
      if (!selectedTests(record).length) throw Error("请至少选择一个测试项目");
      ids.add(record.recordId); return record;
    });
    const templateId = uid(), specs = makeSpecs(records), book = new root.ExcelJS.Workbook();
    book.creator = "MotionBench"; book.created = new Date();
    const guide = book.addWorksheet("填写说明"); guide.columns = [{width:24},{width:110}];
    [
      ["MotionBench 测试数据模板", "按工作表填写原始测试结果，然后回到软件导入。"],
      ["人员与日期", "只使用已预选的运动员；姓名和隐藏编号请勿改动。日期填写 YYYY-MM-DD。"],
      ["空白与零", "未知或未测留空；真实的零填写 0。空白项目不会清除现有结果。"],
      ["增加测量", "复制本人的完整数据行（包含隐藏编号列），修改试次 / 阶段 / 跳次编号后填写；同一组编号不可重复。"],
      ["补录", "导入时按项目选择保留现有或替换。替换采用本表完整试次，不自动追加。再次导入同一模板不会新建第二条记录。"],
      ["测试条件", "协议、单位及输入口径在对应项目页或测试条件页填写；评价标准由软件统一管理。"],
      ["等长力量", "只填写所选方向；双侧方向填写左 / 右，中线方向填写中线，保留疼痛。"],
      ["Hop", "先在组表选择设备汇总或逐跳。设备平均 RSI 按报告原值填写；逐跳数据在对应明细表填写。"],
      ["选项与单位", "录入方式、测试方式、力口径及侧别使用下拉菜单选择；数值单位见列标题或单位列。"],
      ["公式", "填写数值或文字，不使用公式；如从计算表复制，请粘贴为值。"],
      ["工作表结构", "请保留工作表、表头和隐藏信息。整份文件通过校验后才会保存。"],
    ].forEach(row => guide.addRow(row));
    guide.getRow(1).font = {bold:true,size:16,color:{argb:"FF153B39"}};
    guide.eachRow(row => {row.alignment={vertical:"middle",wrapText:true};row.height=34;});
    for (const spec of specs) {
      const ws = book.addWorksheet(spec.name);
      ws.columns = spec.fields.map(f => ({width:f.key === "name" ? 36 : /notes|Protocol|value/.test(f.key) ? 28 : 19}));
      ws.addRow(spec.fields.map(f => f.label)); ws.addRow(spec.fields.map(f => f.key)); ws.getRow(2).hidden = true;
      ws.getColumn(1).hidden = true; ws.getColumn(2).hidden = true;
      for (const key of ["directionId","metricId","testId","fieldId"]) {const i=spec.fields.findIndex(f=>f.key===key);if(i>=0)ws.getColumn(i+1).hidden=true;}
      ws.views = [{state:"frozen",xSplit:3,ySplit:2}];
      for (const record of records) for (const data of dataRows(spec,record,prefill)) {
        const effectiveFields=spec.fields.map(f=>spec.kind==="settings"&&f.key==="value"?{...settings(record,data.testId).find(setting=>setting.key===data.fieldId),key:"value",optionKey:data.fieldId}:f);
        const forValue=f=>f.optionKey?{...f,key:f.optionKey}:f;
        const row = ws.addRow(effectiveFields.map(f => writeValue(get(data,f.key),forValue(f))));
        row.alignment = {vertical:"middle",wrapText:true}; row.height=28;
        effectiveFields.forEach((f,i) => {
          const cell=row.getCell(i+1); cell.protection={locked:i<3};
          if (i<3) cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF0F3F2"}};
          else cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:row.number%2?"FFF1F8F5":"FFFFFFFF"}};
          if (f.type === "date") cell.numFmt="@";
          if (f.type === "number") cell.numFmt="0.########";
          if(f.choices)cell.dataValidation={type:"list",allowBlank:true,formulae:['"'+f.choices.map(value=>displayChoice(forValue(f),value)).join(",")+'"'],showErrorMessage:true,errorTitle:"请选择列表中的值",error:"请使用下拉菜单中的值。"};
        });
      }
      ws.getRow(1).height=42;ws.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
      ws.getRow(1).alignment={vertical:"middle",wrapText:true};ws.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF245C54"}};
      ws.autoFilter={from:{row:1,column:3},to:{row:Math.max(3,ws.rowCount),column:spec.fields.length}};
    }
    const info = book.addWorksheet("_MotionBench",{state:"veryHidden"});
    const manifest = {format:"motionbench-test-template",schema:1,templateId,records:records.map(blankRecord)};
    const encoded = JSON.stringify(manifest);
    for(let i=0;i<encoded.length;i+=16000) info.addRow([i/16000,encoded.slice(i,i+16000)]);
    return {bytes:await book.xlsx.writeBuffer(),templateId,fileName:"MotionBench_测试录入_"+records[0].athlete.date+"_"+records.length+"人.xlsx"};
  }
  function issue(errors, sheet, row, column, message) {
    const address = sheet && row && column ? sheet.getCell(row,column).address : "";
    errors.push({sheet:sheet?.name || "",row:row || 0,column:column || 0,address,message});
  }
  function cellValue(cell, f, errors) {
    let value=cell.value;
    if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {issue(errors,cell.worksheet,cell.row,cell.col,"不接受公式，请粘贴为值");return "";}
    if (value && typeof value === "object" && !(value instanceof Date) && Object.prototype.toString.call(value)!=="[object Date]") {
      if(value.richText)value=value.richText.map(x=>x.text).join("");
      else {issue(errors,cell.worksheet,cell.row,cell.col,"请填写普通数值或文字");return "";}
    }
    if(empty(value))return f.type === "boolean" ? false : "";
    if(f.type === "date") {
      if(Object.prototype.toString.call(value)==="[object Date]")value=value.toISOString().slice(0,10);
      value=String(value).trim();const parsed=new Date(value+"T00:00:00Z");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)issue(errors,cell.worksheet,cell.row,cell.col,"日期须为有效的 YYYY-MM-DD");
      return value;
    }
    if(f.type === "number") {
      const normalized=typeof value==="string"?value.trim():value;
      if(typeof normalized==="boolean"||!((typeof normalized==="number"&&Number.isFinite(normalized))||(typeof normalized==="string"&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)&&Number.isFinite(Number(normalized))))) {issue(errors,cell.worksheet,cell.row,cell.col,"请填写有限数值；未测请留空");return "";}
      return Number(normalized);
    }
    if(f.type === "boolean") {
      if(value===true||value===1||["是","true","TRUE"].includes(value))return true;
      if(value===false||value===0||["否","false","FALSE"].includes(value))return false;
      issue(errors,cell.worksheet,cell.row,cell.col,"疼痛标记请填是 / 否");return false;
    }
    value=String(value).trim();
    value=Object.entries(choiceLabels(f)).find(([,label])=>label===value)?.[0]??value;
    if(f.choices&&!f.choices.includes(value))issue(errors,cell.worksheet,cell.row,cell.col,"可选值："+f.choices.join(" / "));
    return value;
  }
  const meaningful = (row, keys) => keys.some(key => {const v=get(row,key);return !empty(v)&&v!==false;});
  function rawKeys(spec) {
    const skip = new Set(["recordId","athleteId","name","attempt","action","actionName","directionId","directionName","unit","directionProtocol","side","inputMode","phase","label","vo2Unit","metricId","metricName","jump","timeMs","activeStiffnessInputUnit","summary.activeStiffnessInputUnit","summary.selectionBasis"]);
    return spec.fields.map(f=>f.key).filter(key=>!skip.has(key));
  }
  async function readTemplate(bytes) {
    requireExcel();
    if((bytes?.byteLength || bytes?.length || 0)>25*1024*1024)throw Error("Excel 文件超过 25 MB，请拆分测试批次");
    const book=new root.ExcelJS.Workbook();
    try {await book.xlsx.load(bytes);}catch(_){throw Error("无法读取 XLSX 文件，请选择系统生成的 Excel 模板");}
    const errors=[],info=book.getWorksheet("_MotionBench");if(!info)throw Error("缺少 MotionBench 模板信息，请重新下载模板");
    let encoded="";info.eachRow((row,i)=>{if(row.getCell(1).value!==i-1)throw Error("模板信息顺序不完整");const v=row.getCell(2).value;if(typeof v!=="string")throw Error("模板信息损坏");encoded+=v;});
    let manifest;try{manifest=JSON.parse(encoded);}catch(_){throw Error("模板信息损坏");}
    if(manifest.format!=="motionbench-test-template"||manifest.schema!==1||!safe(manifest.templateId)||!Array.isArray(manifest.records)||!manifest.records.length||manifest.records.length>300)throw Error("模板版本或测试列表无效");
    const targets=new Map(), entries=[];
    for(const raw of manifest.records){M.validateRecord(raw);if(targets.has(raw.recordId))throw Error("模板目标测试编号重复");const record=blankRecord(raw);targets.set(raw.recordId,record);entries.push({record,locations:new Map(),seen:new Set(),groups:new Map(),incoming:new Set(),metadataSeen:false});}
    const byId=new Map(entries.map(e=>[e.record.recordId,e])),specs=makeSpecs(manifest.records),known=new Set(["填写说明","_MotionBench",...specs.map(s=>s.name)]);
    let totalRows=0;
    book.eachSheet(ws=>{
      if(ws.rowCount>100000||ws.columnCount>400)throw Error("工作表超出支持的行列数量");totalRows+=ws.rowCount;
      if(totalRows>200000)throw Error("模板数据过多，请拆分测试批次");
      ws.eachRow(row=>row.eachCell(cell=>{if(cell.value&&typeof cell.value==="object"&&("formula" in cell.value||"sharedFormula" in cell.value))issue(errors,ws,cell.row,cell.col,"不接受公式，请粘贴为值");}));
      if(!known.has(ws.name)&&ws.actualRowCount)issue(errors,ws,1,1,"未知工作表，请使用原模板结构");
    });
    for(const spec of specs){
      const ws=book.getWorksheet(spec.name);if(!ws){issue(errors,null,0,0,"缺少工作表："+spec.name);continue;}
      const columns=new Map();ws.getRow(2).eachCell((cell,i)=>{if(typeof cell.value==="string"){if(columns.has(cell.value))issue(errors,ws,2,i,"字段编号重复");columns.set(cell.value,i);}});
      if(spec.fields.some(f=>!columns.has(f.key))){issue(errors,ws,2,1,"字段结构不完整，请保留模板表头");continue;}
      for(const [key,col]of columns)if(!spec.fields.some(f=>f.key===key))issue(errors,ws,2,col,"未知字段："+key);
      for(let i=3;i<=ws.rowCount;i++){
        const excelRow=ws.getRow(i);if(!excelRow.values.some(v=>!empty(v)))continue;
        const row={};for(const f of spec.fields)put(row,f.key,cellValue(excelRow.getCell(columns.get(f.key)),f,errors));
        const entry=byId.get(row.recordId),record=entry?.record;
        if(!record||row.athleteId!==record.athleteId||row.name!==identity(record).name){issue(errors,ws,i,columns.get("name"),"运动员 / 测试编号与模板不符；请勿改名或复制其他人的编号");continue;}
        if(spec.id&&!record.enabled[spec.id]){issue(errors,ws,i,columns.get("name"),"该运动员未选择此项目");continue;}
        const error=(key,message)=>issue(errors,ws,i,columns.get(key)||1,message);
        const set=(path,value,key)=>{put(record,path,value);entry.locations.set(path,{sheet:ws,row:i,column:columns.get(key)||1});};
        const seen=key=>{if(entry.seen.has(key)){error("attempt","同一测试内编号重复："+key);return true;}entry.seen.add(key);return false;};
        const attempt=()=>{if(!Number.isInteger(row.attempt)||row.attempt<1||row.attempt>1000){error("attempt","试次编号须为 1–1000 的整数");return false;}return true;};
        if(spec.kind==="metadata"){
          if(entry.metadataSeen){error("name","本次测试信息重复");continue;}entry.metadataSeen=true;
          for(const f of metaFields)set("athlete."+f.key,row[f.key],f.key);
          if(!row.date)error("date","请填写测试日期");continue;
        }
        if(spec.kind==="settings"){
          const f=settings(record,row.testId).find(f=>f.key===row.fieldId);
          if(!record.enabled[row.testId]||!f){error("fieldId","项目条件编号不属于本模板");continue;}
          if(seen("settings:"+row.fieldId))continue;
          const value=cellValue(excelRow.getCell(columns.get("value")),f,errors);set(f.key,value,"value");
          if(f.choices&&empty(value)&&f.key!=="data.cpet.modality")error("value","请选择 "+f.label);
          if(["thresholds.lt1","thresholds.lt2"].includes(f.key)&&!empty(value))entry.incoming.add(row.testId);
          continue;
        }
        const hasRaw=meaningful(row,rawKeys(spec));
        if(!hasRaw&&spec.kind!=="hop")continue;
        if(hasRaw)entry.incoming.add(spec.id);
        if(spec.kind==="custom"){
          const d=record.definitions.find(d=>d.id===row.metricId&&d.testId===spec.id&&T.isManualMetric(d)&&!T.isAttemptMetric(d));
          if(!d||d.unit!==row.unit){error("metricId","指标编号或单位与模板不符");continue;}if(seen("custom:"+d.id))continue;
          set("customValues."+d.id+".value",row.value,"value");set("customValues."+d.id+".notes",row.notes,"notes");continue;
        }
        if(spec.kind==="fms"){
          const item=record.data.fms[row.action-1];if(!item||item.name!==row.actionName){error("action","动作编号或名称无效");continue;}if(seen("fms:"+row.action))continue;
          if(item.bilateral&&!empty(row.score)||!item.bilateral&&(!empty(row.left)||!empty(row.right))){error("score","请按动作填写左右分或单项分");continue;}
          for(const f of spec.fields.slice(5))set("data.fms."+(row.action-1)+"."+f.key,row[f.key],f.key);continue;
        }
        if(spec.kind==="cpet"){
          if(!["peak","first","second"].includes(row.phase)||!row.vo2Unit){error("phase","请选择阶段及摄氧量单位");continue;}
          if(seen("cpet:"+row.phase))continue;const peak=row.phase==="peak",base=peak?"data.cpet":"data.cpet.thresholds."+row.phase;
          if(!(peak?["VO2peak","VO2max"]:row.phase==="first"?["VT1","LT1"]:["VT2","LT2"]).includes(row.label)){error("label","原报告名称与所选阶段不匹配");continue;}
          if(peak&&(!empty(row.speed)||!empty(row.power))||!peak&&!empty(row.rer)){error(peak?"speed":"rer","峰值行填写 RER；阈值行填写速度 / 功率");continue;}
          set(base+"."+(peak?"oxygenLabel":"label"),row.label,"label");
          for(const key of ["vo2","vo2Unit"])set(base+"."+key,row[key],key);
          set(base+"."+(peak?"peakHr":"hr"),row.hr,"hr");
          for(const key of peak?["rer"]:["speed","power"])set(base+"."+key,row[key],key);continue;
        }
        if(!attempt())continue;
        if(spec.kind==="iso"){
          const directions=isoRows(record),direction=directions.find(r=>r.id===row.directionId),index=record.data.iso.findIndex(r=>r.id===row.directionId);
          if(!direction){error("directionId","方向不属于本次选择");continue;}
          if(!row.unit){error("unit","请选择力单位");continue;}
          if(direction.paired&&!empty(row.center)||!direction.paired&&(!empty(row.left)||!empty(row.right))){error("center","请按方向填写左右或中线值");continue;}
          if(seen("iso:"+row.directionId+":"+row.attempt))continue;
          const key="iso-settings:"+row.directionId,current=entry.groups.get(key),setting=JSON.stringify([row.unit,row.directionProtocol]);
          if(current&&current!==setting){error("unit","同一方向的各试次须使用相同单位和测试条件");continue;}entry.groups.set(key,setting);
          direction.unit=row.unit;direction.protocol=row.directionProtocol;const n=direction.trials.length;direction.trials.push({id:"excel_"+row.attempt});
          for(const key of ["left","right","center","painLeft","painRight","painCenter","notes"])set("data.iso."+index+".trials."+n+"."+key,row[key],key);continue;
        }
        const groupKey=spec.id+":"+row.attempt;
        let holder=entry.groups.get(groupKey);
        if(!holder){
          if(spec.id==="hop"&&T.isNative(record,"hop"))holder={id:"excel_"+row.attempt,...M.newHopSet(),jumps:[],summary:{...M.newHopSet().summary},_attempt:row.attempt};
          else holder={id:"excel_"+row.attempt,metrics:{},notes:"",...(spec.id==="imtp"?{timePoints:[]}:{}),_attempt:row.attempt};
          entry.groups.set(groupKey,holder);
        }
        if(spec.kind==="timePoints"){
          if(!(row.timeMs>0)){error("timeMs","时间点须大于 0 ms");continue;}if(seen(groupKey+":time:"+row.timeMs))continue;
          holder.timePoints.push({id:"excel_t_"+holder.timePoints.length,timeMs:row.timeMs,force:row.force,rfd:row.rfd,_location:{sheet:ws,row:i,columns}});
          continue;
        }
        if(spec.kind==="hopJumps"){
          if(!Number.isInteger(row.jump)||row.jump<1||row.jump>1000){error("jump","跳次须为 1–1000 的整数");continue;}if(seen(groupKey+":jump:"+row.jump))continue;
          holder.jumps.push({id:"excel_j_"+row.jump,height:row.height,contactTimeMs:row.contactTimeMs,flightTimeMs:row.flightTimeMs,notes:row.notes,_jump:row.jump,_location:{sheet:ws,row:i,columns}});continue;
        }
        if(seen(groupKey+":main"))continue;
        if(["landmine","mb"].includes(spec.id)&&empty(row.side)){error("side","请选择本次测量侧别");continue;}
        holder._location={sheet:ws,row:i,columns};
        for(const f of spec.fields.slice(4))put(holder,f.key,get(row,f.key));
        const stiffnessRow=spec.kind==="hop"?holder.summary:holder;
        if(stiffnessRow.activeStiffnessInputUnit==="N/m"&&!empty(stiffnessRow.activeStiffness))stiffnessRow.activeStiffness/=1000;
      }
    }
    for(const entry of entries){
      const record=entry.record;
      if(!entry.metadataSeen)issue(errors,null,0,0,record.athlete.name+" 缺少本次测试信息行");
      for(const test of selectedTests(record)){
        if(["fms","iso","cpet"].includes(test.id)&&T.isNative(record,test.id))continue;
        const holders=[...entry.groups.entries()].filter(([key])=>key.startsWith(test.id+":")&&/^\d+$/.test(key.slice(test.id.length+1))).map(([,row])=>row).sort((a,b)=>a._attempt-b._attempt);
        holders.forEach((row,index)=>{
          const location=row._location;
          if(test.id==="hop"&&T.isNative(record,"hop")){
            if(row.jumps.length&&(!location||row.inputMode!=="jumps"&&!meaningful(row.summary,["height","rsi","contactTimeMs","flightTimeMs","flightTimeRatio"])))issue(errors,location?.sheet,location?.row,location?.columns.get("inputMode"),record.athlete.name+"：仅填写逐跳数据时，请在对应完整测试组选择“逐跳”");
            row.jumps.sort((a,b)=>a._jump-b._jump).forEach((jump,j)=>{const cell=jump._location;for(const key of ["height","contactTimeMs","flightTimeMs"])entry.locations.set("data.hop.trials."+index+".jumps."+j+"."+key,{sheet:cell.sheet,row:cell.row,column:cell.columns.get(key)});delete jump._jump;delete jump._location;});
          }
          if(test.id==="imtp")row.timePoints.forEach((point,j)=>{const cell=point._location;for(const key of ["timeMs","force","rfd"])entry.locations.set("data.imtp."+index+".timePoints."+j+"."+key,{sheet:cell.sheet,row:cell.row,column:cell.columns.get(key)});delete point._location;});
          if(location)for(const f of specs.find(s=>s.id===test.id&&["attempt","hop"].includes(s.kind))?.fields.slice(4)||[])entry.locations.set("data."+test.id+"."+(["hop","pushup","mas","mss","ift"].includes(test.id)?"trials.":"")+index+"."+f.key,{sheet:location.sheet,row:location.row,column:location.columns.get(f.key)});
          delete row._attempt;delete row._location;
        });
        if(["hop","pushup","mas","mss","ift"].includes(test.id)&&T.isNative(record,test.id))record.data[test.id].trials=holders;
        else record.data[test.id]=holders;
      }
      try {
        const walk=(value,path="")=>{if(value&&typeof value==="object"){for(const [key,child]of Object.entries(value))walk(child,path?path+"."+key:key);return;}const message=M.validateField(record,path,value);if(message){const location=entry.locations.get(path);issue(errors,location?.sheet,location?.row,location?.column,record.athlete.name+"："+message+"（"+path+"）");}};
        walk(record);
        M.validateRecord(record);
      }catch(error){issue(errors,null,0,0,record.athlete.name+"："+error.message);}
    }
    return {templateId:manifest.templateId,targets:[...targets.values()].map(({athleteId,recordId})=>({athleteId,recordId})),entries:entries.map(e=>({record:e.record,incoming:[...e.incoming]})),errors};
  }
  function projectData(record,id,selectedDirections) {
    const data=id==="iso"?(selectedDirections||isoRows(record).map(r=>r.id)).map(key=>record.data.iso.find(r=>r.id===key)).filter(Boolean):record.data[id];
    const custom=Object.fromEntries(record.definitions.filter(d=>d.testId===id&&T.isManualMetric(d)&&!T.isAttemptMetric(d)).map(d=>[d.id,record.customValues[d.id]||{value:"",notes:""}]));
    // Optional blank fields added by a workbook are not changed measurements.
    const comparable=value=>{
      if(empty(value)||value===false)return undefined;
      if(Array.isArray(value)){const rows=value.map(comparable).filter(row=>row!==undefined);return rows.length?rows:undefined;}
      if(value&&typeof value==="object"){const object=Object.fromEntries(Object.entries(value).filter(([key])=>key!=="id").map(([key,item])=>[key,comparable(item)]).filter(([,item])=>item!==undefined));return Object.keys(object).length?object:undefined;}
      return value;
    };
    return comparable({data,custom,settings:settings(record,id).filter(f=>!isSharedSetting(f)).map(f=>[f.key,get(record,f.key)??""])});
  }
  function countProject(record,id,selection) {
    if(!record.enabled[id])record={...record,enabled:{...record.enabled,[id]:true}};
    const spec=makeSpecs([record]).find(s=>s.id===id&&!["custom","timePoints","hopJumps"].includes(s.kind));
    if(!spec)return 0;
    let count=dataRows(spec,record,true).filter(row=>meaningful(row,rawKeys(spec))&&(!selection||id!=="iso"||selection.includes(row.directionId))).length;
    if(id==="hop"&&T.isNative(record,id))count=M.repeatRows(record,id).filter(set=>meaningful(set,["summary.height","summary.rsi","summary.contactTimeMs","summary.activeStiffness","notes"])||set.jumps?.some(j=>meaningful(j,["height","contactTimeMs","flightTimeMs","notes"]))).length;
    if(id==="imtp")count=M.repeatRows(record,id).filter(row=>meaningful(row,attemptFields(record,id).map(f=>f.key))||row.timePoints?.some(p=>!empty(p.force)||!empty(p.rfd))).length;
    return count+record.definitions.filter(d=>d.testId===id&&T.isManualMetric(d)&&!T.isAttemptMetric(d)&&!empty(record.customValues[d.id]?.value)).length+settings(record,id).filter(f=>["thresholds.lt1","thresholds.lt2"].includes(f.key)&&!empty(get(record,f.key))).length;
  }
  function preview(parsed,{athletes,catalog,records=[]}) {
    const errors=clone(parsed.errors||[]),entries=[],owners=new Map(athletes.map(a=>[a.id,a])),existing=new Map(records.map(r=>[r.recordId,r]));
    for(const item of parsed.entries){
      const incoming=clone(item.record),previous=existing.get(incoming.recordId),owner=owners.get(incoming.athleteId);
      if(!owner||owner.deletedAt||owner.archived){issue(errors,null,0,0,incoming.athlete.name+"：运动员不在当前在用档案中");continue;}
      if(previous&&(previous.athleteId!==incoming.athleteId||previous.deletedAt||previous.archived)){issue(errors,null,0,0,incoming.athlete.name+"：目标记录不属于此运动员或已归档 / 删除");continue;}
      const current=previous||M.recordFromCatalog(catalog,owner.profile,incoming.enabled,incoming.athlete.date);
      const projects=selectedTests(incoming).map(test=>{
        const catalogTest=catalog.tests.find(t=>t.id===test.id);
        if(!previous&&(!catalogTest||catalogTest.disabled||catalog.conflicts.some(c=>c.testId===test.id&&!c.resolved)))issue(errors,null,0,0,test.name+"：项目已停用或存在未解决定义冲突，请重新下载模板");
        if(canonical(contract(current,test.id))!==canonical(contract(incoming,test.id)))issue(errors,null,0,0,test.name+"：指标字段或单位已变化，请重新下载模板");
        const directions=test.id==="iso"?isoRows(incoming).map(r=>r.id):null,oldCount=previous?countProject(previous,test.id,directions):0,newCount=countProject(incoming,test.id,directions),hasIncoming=item.incoming.includes(test.id),identical=!!previous&&canonical(projectData(previous,test.id,directions))===canonical(projectData(incoming,test.id,directions));
        return {id:test.id,name:test.name,oldCount,newCount,hasIncoming,identical,conditionChanges:projectConditions(previous,incoming,test.id),defaultAction:hasIncoming&&!identical&&!oldCount?"replace":"keep"};
      });
      const metadataChanges=previous?metaFields.filter(f=>String(previous.athlete[f.key]??"")!==String(incoming.athlete[f.key]??"")).map(f=>({field:f.key,label:f.label,before:previous.athlete[f.key]??"",after:incoming.athlete[f.key]??""})):[];
      const settingsChanges=previous?sharedSettings(incoming).filter(f=>!empty(get(incoming,f.key))&&String(get(previous,f.key)??"")!==String(get(incoming,f.key))).map(f=>change(f,get(previous,f.key),get(incoming,f.key))):[];
      entries.push({recordId:incoming.recordId,athleteId:incoming.athleteId,name:owner.name,date:incoming.athlete.date,existing:!!previous,projects,metadataChanges,settingsChanges,incoming,previous:previous?clone(previous):null,base:previous?null:current});
    }
    return {templateId:parsed.templateId,entries,errors};
  }
  function apply(review, decisions={}) {
    if(review.errors?.length)throw Error("请先修正 Excel 中的全部错误，再重新导入");
    const records=[],skipped=[];let created=0,updated=0;
    for(const entry of review.entries){
      const decision=decisions[entry.recordId]||{},incoming=entry.incoming,record=clone(entry.previous||entry.base),chosen=entry.projects.filter(p=>p.hasIncoming&&(decision.projects?.[p.id]||p.defaultAction)==="replace"),shared=sharedSettings(incoming),hasSharedMeasurement=shared.some(f=>f.key==="dsi.force"&&!empty(get(incoming,f.key)));
      if(!entry.existing&&!entry.projects.some(p=>p.hasIncoming)&&!hasSharedMeasurement){skipped.push({recordId:entry.recordId,name:entry.name,reason:"未填写测试数据"});continue;}
      record.athleteId=entry.athleteId;record.recordId=entry.recordId;
      if(!entry.existing||decision.metadata==="replace")for(const f of metaFields)record.athlete[f.key]=incoming.athlete[f.key];
      for(const project of chosen){
        const id=project.id;record.enabled[id]=true;
        const priorContext=JSON.stringify([record.protocol[id],record[id+"Config"],record.dsi.source,record.dsi.protocol,record.dsi.definition,record.dsi.cmjUnit]);
        if(id==="iso"){
          const selected=isoRows(incoming),ids=new Set(selected.map(r=>r.id));
          record.data.iso=record.data.iso.map(row=>ids.has(row.id)?clone(selected.find(r=>r.id===row.id)):row);
          for(const row of selected)if(!record.data.iso.some(r=>r.id===row.id))record.data.iso.push(clone(row));
          const next=[...new Set([...isoRows(record).map(r=>r.id),...selected.map(r=>r.id)])];
          if(M.setIsoDirectionSelection)M.setIsoDirectionSelection(record,next);else record.isoDirectionIds=next;
        }else record.data[id]=clone(incoming.data[id]);
        for(const d of incoming.definitions.filter(d=>d.testId===id&&T.isManualMetric(d)&&!T.isAttemptMetric(d)))record.customValues[d.id]=clone(incoming.customValues[d.id]||{value:"",notes:""});
        for(const f of settings(incoming,id).filter(f=>!isSharedSetting(f)))put(record,f.key,clone(get(incoming,f.key)??""));
        if(id==="cmj"){record.cmjConfig=clone(incoming.cmjConfig);record.dsi.cmjUnit=incoming.dsi.cmjUnit;}
        if(id==="imtp")record.imtpConfig=clone(incoming.imtpConfig);
        const nextContext=JSON.stringify([record.protocol[id],record[id+"Config"],record.dsi.source,record.dsi.protocol,record.dsi.definition,record.dsi.cmjUnit]);
        if(["cmj","imtp"].includes(id)&&priorContext!==nextContext){record.dsi.confirmed=false;record.impulseConfig.confirmed=false;}
      }
      if(!entry.existing||decision.settings==="replace"){
        const before=JSON.stringify([record.dsi.source,record.dsi.protocol,record.dsi.definition]);
        for(const f of shared)if(!empty(get(incoming,f.key)))put(record,f.key,clone(get(incoming,f.key)));
        if(before!==JSON.stringify([record.dsi.source,record.dsi.protocol,record.dsi.definition]))record.dsi.confirmed=false;
      }
      if(!entry.existing){
        record.evaluationProfileId=incoming.evaluationProfileId;
        record.trainingContext=clone(incoming.trainingContext);
        if(incoming.testPlanSnapshot)record.testPlanSnapshot=clone(incoming.testPlanSnapshot);
        if(incoming.isoDirectionIds!==undefined&&record.enabled.iso&&M.setIsoDirectionSelection)M.setIsoDirectionSelection(record,incoming.isoDirectionIds);
      }
      if(entry.existing&&canonical(record)===canonical(entry.previous)){skipped.push({recordId:entry.recordId,name:entry.name,reason:"保留现有数据 / 无变化"});continue;}
      if(!entry.existing&&!chosen.length&&!hasSharedMeasurement){skipped.push({recordId:entry.recordId,name:entry.name,reason:"未选择导入项目"});continue;}
      record.updated=new Date().toISOString();record.excelImport={templateId:review.templateId};
      M.validateRecord(record);records.push(record);if(entry.existing)updated++;else created++;
    }
    return {records,skipped,created,updated};
  }
  root.RingsideExcel=Object.freeze({createTemplate,readTemplate,preview,apply});
})(typeof window!=="undefined"?window:globalThis);
