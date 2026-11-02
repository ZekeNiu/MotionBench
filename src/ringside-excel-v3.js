(function(root){
  "use strict";
  const A=root.RingsideAcquisition, X=root.RingsideExcel, L=X.legacyAdapter, M=root.RingsideModel;
  const clone=value=>JSON.parse(JSON.stringify(value)), empty=value=>value===undefined||value===null||value==="";
  const get=A.get, safe=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,249}$/.test(value)&&!["__proto__","constructor","prototype"].includes(value);
  const text=(key,label)=>({key,label,type:"text"}), numeric=(key,label)=>({key,label,type:"number"});
  function put(object,path,value){const parts=path.split(".");if(parts.some(key=>["__proto__","prototype","constructor"].includes(key)))throw Error("无效字段");const key=parts.pop();let parent=object;for(const part of parts)parent=parent[part]||=(/^[0-9]+$/.test(part)?[]:{});parent[key]=value;}
  function manifest(book){let value="";book.getWorksheet("_MotionBench").eachRow(row=>value+=row.getCell(2).value);return JSON.parse(value);}
  function writeManifest(book,value){const ws=book.addWorksheet("_MotionBench",{state:"veryHidden"}),encoded=JSON.stringify(value);for(let i=0;i<encoded.length;i+=16000)ws.addRow([i/16000,encoded.slice(i,i+16000)]);}
  function fieldHeader(f){return f.label;}
  function addTable(book,ws,name,start,fields,rows){
    const used=new Set(),columns=fields.map(f=>{let label=fieldHeader(f),index=2;while(used.has(label))label=fieldHeader(f)+" ("+(index++)+")";used.add(label);return {...f,header:label};});
    const values=rows.map(row=>columns.map(f=>L.writeValue(get(row,f.key),f)));
    ws.addTable({name,ref:"A"+start,headerRow:true,totalsRow:false,columns:columns.map(f=>({name:f.header,filterButton:true})),rows:values.length?values:[columns.map(()=>null)],style:{theme:"TableStyleMedium2",showRowStripes:true}});
    columns.forEach((f,index)=>{ws.getColumn(index+1).width=Math.max(ws.getColumn(index+1).width||0,index===0?35:/notes|Protocol|protocol/.test(f.key)?28:21);});
    for(let r=start+1;r<=start+Math.max(rows.length,1);r++){ws.getRow(r).height=30;for(const [i,f]of columns.entries()){const cell=ws.getCell(r,i+1);cell.alignment={vertical:"middle",wrapText:true};if(f.type==="number")cell.numFmt="0.########";if(f.choices)cell.dataValidation={type:"list",allowBlank:true,formulae:['"'+f.choices.map(v=>L.displayChoice(f,v)).join(",")+'"'],showErrorMessage:true,errorTitle:"请选择列表值",error:"请使用下拉选项"};}}
    if(book.getWorksheet("_MotionBench_Lists")){const col=columns.findIndex(f=>f.key==="recordRef")+1;if(col)ws.dataValidations.add(ws.getCell(start+1,col).address+":"+ws.getCell(Math.min(start+Math.max(rows.length,1)+1000,100000),col).address,{type:"list",allowBlank:true,formulae:["MB3_RECORDS"],showErrorMessage:true,errorTitle:"请选择运动员",error:"请选择本模板中的运动员 / 测试"});}
    ws.getRow(start).height=45;ws.getRow(start).alignment={wrapText:true,vertical:"middle"};
    return {name,columns:columns.map(({key,header,type,timeMs,kind,fieldId})=>({key,header,type,...(timeMs!==undefined?{timeMs,kind,fieldId}:{})})),start,end:start+Math.max(rows.length,1)};
  }
  async function createTemplate({records,prefill=false}){
    // The old exporter validates record ownership, snapshot contracts and size limits.
    const oldExport=await X.createTemplate({records,prefill:false,schema:2}),oldBook=new root.ExcelJS.Workbook();await oldBook.xlsx.load(oldExport.bytes);
    const old=manifest(oldBook),sources=records.map(record=>M.normalizeRecord(clone(record))),refs=L.recordReferences(sources),book=new root.ExcelJS.Workbook();book.creator="MotionBench";
    const out={format:"motionbench-test-template",schema:3,templateId:old.templateId,records:old.records,recordRefs:refs,sheets:[],hopBaselines:[],editableHopIds:[]};
    const lists=book.addWorksheet("_MotionBench_Lists",{state:"veryHidden"});refs.forEach(ref=>lists.addRow([ref.label]));book.definedNames.add("'_MotionBench_Lists'!$A$1:$A$"+refs.length,"MB3_RECORDS");
    const guide=book.addWorksheet("填写说明");guide.columns=[{width:26},{width:115}];
    [["MotionBench 测试录入","每个项目一页；先填写本页测试参数，再填写测量。"],["未测与零值","未测留空，真实零填写 0。请粘贴数值，不使用公式。"],["新增试次","在项目测量表末尾新增行；单人可留空运动员，多人请选择对应运动员。"],["IMTP 时间点","同一试次一行。新增列使用“125 ms 实测力 N”或“0–125 ms 平均RFD N/s”等标题，可使用任意正数时间。"],["Hop","每行是一次完整测试的汇总结果；平均 RSI 和平均 FT/CT 按原报告填写，不能用各项均值相除。"],["历史逐跳","历史逐跳仅在原资料库中保留和查看；本模板只补录整次结果，不包含或替换历史逐跳。"],["导入核对","测量与测试参数分别核对；已有测量默认保留。计算所缺条件会在导入预览显示。"]].forEach(row=>guide.addRow(row));guide.eachRow(row=>{row.height=36;row.alignment={wrapText:true,vertical:"middle"};});
    const meta=book.addWorksheet("本次测试"),metaFields=[text("recordRef","运动员 / 测试"),...L.metaFields],metaRows=sources.map(record=>({recordRef:refs.find(ref=>ref.recordId===record.recordId).label,...Object.fromEntries(L.metaFields.map(f=>[f.key,record.athlete[f.key]??""]))}));
    out.sheets.push({name:meta.name,testId:null,blocks:[{kind:"metadata",...addTable(book,meta,"MB3_META",1,metaFields,metaRows)}]});meta.views=[{state:"frozen",xSplit:1,ySplit:1}];
    const ids=[...new Set(sources.flatMap(record=>L.selectedTests(record).map(test=>test.id)))];
    for(const [index,id]of ids.entries()){
      const active=sources.filter(record=>record.enabled[id]),contract=A.project(active[0],id),ws=book.addWorksheet((String(index+1).padStart(2,"0")+"_"+contract.name).replace(/[\\/*?:\[\]]/g,"_").slice(0,31));
      const sheet={name:ws.name,testId:id,blocks:[]};let row=1;
      ws.getCell(row++,1).value=contract.name+" · 测试参数";
      if(contract.parameters.length){const fields=[text("recordRef","运动员 / 测试"),...contract.parameters],rows=active.map(record=>({recordRef:refs.find(ref=>ref.recordId===record.recordId).label,...Object.fromEntries(contract.parameters.map(f=>[f.key,get(record,f.key)??""]))})).map(flat=>{const nested={};for(const [key,value]of Object.entries(flat))put(nested,key,value);return nested;});const block=addTable(book,ws,"MB3_"+index+"_PARAM",row,fields,rows);sheet.blocks.push({kind:"parameters",...block});row=block.end+3;}
      for(const [sectionIndex,section]of contract.sections.entries()){
        ws.getCell(row++,1).value=section.kind==="custom"?"本次测试补充指标":"测量记录";
        let fields=section.fields.slice();if(id==="imtp"&&section.kind==="attempt"){const times=new Map(active.flatMap(A.imtpTimeColumns).map(f=>[f.key,f]));fields=fields.filter(f=>!f.key.startsWith("time:")).concat([...times.values()].sort((a,b)=>a.timeMs-b.timeMs||a.kind.localeCompare(b.kind)));}
        if(id==="hop"&&section.kind==="hop")fields.push(text("hopSetId","测试组编号"));
        fields=[text("recordRef","运动员 / 测试"),...fields];const rows=[];
        for(const source of active){let record=source;if(id==="hop"&&section.kind==="hop"){const historical=A.historicalHopSets(source);if(historical.length)out.hopBaselines.push({recordId:source.recordId,groups:historical.map(set=>({id:set.id,fingerprint:A.hopFingerprint(set)}))});const editable=A.hopEditableSets(source);out.editableHopIds.push({recordId:source.recordId,ids:editable.map(set=>set.id)});record=clone(source);record.data.hop={...record.data.hop,trials:editable};}
          const spec=L.makeSpecs([record]).find(spec=>spec.id===id&&spec.kind===section.kind),count=section.kind==="hop"?A.hopEditableSets(record).length:L.countProject(record,id);
          const data=L.dataRows(spec,record,prefill&&!!count);
          for(const [i,item]of data.entries()){const result={...item,recordRef:refs.find(ref=>ref.recordId===record.recordId).label};if(id==="hop"&&section.kind==="hop"){const set=prefill?A.hopEditableSets(record)[i]:null;result.hopSetId=set?.id||"";result.metrics=clone(set?.metrics||{});delete result.inputMode;}
            if(id==="imtp"&&section.kind==="attempt")for(const f of fields.filter(f=>f.timeMs!==undefined))result[f.key]=(item.timePoints||[]).find(point=>Number(point.timeMs)===f.timeMs)?.[f.kind]??"";
            rows.push(result);
          }
        }
        const block=addTable(book,ws,"MB3_"+index+"_DATA_"+sectionIndex,row,fields,rows);sheet.blocks.push({kind:section.kind,...block});row=block.end+3;
      }
      ws.views=[{state:"frozen",xSplit:1,ySplit:sheet.blocks[0]?.start||1}];out.sheets.push(sheet);
    }
    writeManifest(book,out);return {bytes:await book.xlsx.writeBuffer(),templateId:out.templateId,fileName:"MotionBench_测试录入_"+sources[0].athlete.date+"_"+sources.length+"人.xlsx"};
  }
  function error(errors,ws,row,column,message){errors.push({sheet:ws?.name||"",row:row||0,column:column||0,address:ws&&row&&column?ws.getCell(row,column).address:"",message});}
  function tableBounds(ws,block){const table=ws.getTable(block.name);if(!table)throw Error("缺少测量表："+block.name);const model=table.table||table,range=/^[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/.exec(model.tableRef||model.ref||"");const start=range?Number(range[1]):block.start;return {table:model,start,end:range?.[2]?Number(range[2]):start+(model.rows?.length??block.end-block.start)};}
  function readBlock(ws,block,fields,errors,allowTime){
    const {table,start,end}=tableBounds(ws,block),known=new Map(block.columns.map(column=>[column.header,column])),descriptors=new Map(fields.map(f=>[f.key,f])),columns=[],seen=new Set();
    const width=Math.max(table.columns?.length||0,block.columns.length);
    for(let col=1;col<=width;col++){const header=ws.getCell(start,col).value,mapped=known.get(header),dynamic=!mapped&&allowTime?A.parseTimeHeader(header):null,f=mapped?descriptors.get(mapped.key):dynamic;if(!f){error(errors,ws,start,col,"未知或已修改的表头："+String(header??""));continue;}if(seen.has(f.key)){error(errors,ws,start,col,"重复指标列："+f.label);continue;}seen.add(f.key);columns.push({f,col});}
    for(const f of fields)if(!seen.has(f.key))error(errors,ws,start,1,"缺少指标列："+f.label);
    const rows=[];for(let r=start+1;r<=end;r++){const values={};let present=false;for(const {f,col}of columns){const cell=ws.getCell(r,col);if(!empty(cell.value))present=true;put(values,f.key,L.cellValue(cell,f,errors));}if(present)rows.push({values,row:r,columns});}return rows;
  }
  async function readWorkbook(book,info){
    if(info.format!=="motionbench-test-template"||info.schema!==3||!safe(info.templateId)||!Array.isArray(info.records)||!info.records.length||info.records.length>300||!Array.isArray(info.sheets)||!Array.isArray(info.recordRefs)||!Array.isArray(info.hopBaselines)||!Array.isArray(info.editableHopIds))throw Error("模板版本或字段合同无效");
    for(const item of info.hopBaselines)if(!safe(item.recordId)||!Array.isArray(item.groups)||item.groups.some(group=>typeof group.id!=="string"||!/^[a-f0-9]{16}$/.test(group.fingerprint)))throw Error("历史测试关联无效");
    const errors=[],legacyExport=await X.createTemplate({records:info.records,prefill:false,schema:2}),legacyBook=new root.ExcelJS.Workbook();await legacyBook.xlsx.load(legacyExport.bytes);const legacy=manifest(legacyBook),records=new Map(info.records.map(record=>[record.recordId,record])),parameterChanges=new Map(),extraByRecord=new Map(),hopIds=new Map(),timeSchemas=new Map();
    if(A.canonical(info.recordRefs)!==A.canonical(L.recordReferences(info.records)))throw Error("运动员映射损坏");
    const expectedIds=[...new Set(info.records.flatMap(record=>L.selectedTests(record).map(test=>test.id)))].sort(),actualIds=info.sheets.filter(sheet=>sheet.testId!==null).map(sheet=>sheet.testId).sort();
    if(A.canonical(expectedIds)!==A.canonical(actualIds)||info.sheets.filter(sheet=>sheet.testId===null).length!==1||new Set(info.sheets.map(sheet=>sheet.name)).size!==info.sheets.length)throw Error("项目工作表合同不完整");
    for(const sheet of info.sheets){const source=info.records.find(record=>sheet.testId===null||record.enabled[sheet.testId]),contract=sheet.testId===null?null:A.project(source,sheet.testId),expected=contract?[...(contract.parameters.length?["parameters"]:[]),...contract.sections.map(section=>section.kind)]:["metadata"];if(!Array.isArray(sheet.blocks)||A.canonical(sheet.blocks.map(block=>block.kind))!==A.canonical(expected)||sheet.blocks.some(block=>!safe(block.name)||!Array.isArray(block.columns)||new Set(block.columns.map(col=>col.key)).size!==block.columns.length))throw Error("项目字段合同损坏");}
    function owner(row,ws){let ref=info.recordRefs.find(ref=>ref.label===row.values.recordRef);if(!ref&&empty(row.values.recordRef)&&info.recordRefs.length===1)ref=info.recordRefs[0];if(!ref){error(errors,ws,row.row,1,"请选择本次模板中的运动员 / 测试");return null;}return records.get(ref.recordId);}
    const legacySheet=(id,kind)=>{const spec=legacy.sheets.find(sheet=>sheet.testId===id&&sheet.kind===kind);return spec?{ws:legacyBook.getWorksheet(spec.name),spec}:null;};
    const sourceLocations=new Map(),location=(ws,row,col)=>({sheet:ws.name,row,column:col,address:ws.getCell(row,col).address}),origin=(ws,row)=>({ws,row:row.row,columns:Object.fromEntries(row.columns.map(c=>[c.f.key,c.col]))});
    const pending=new Map(),append=(id,kind,record,values,source)=>{const target=legacySheet(id,kind);if(!target)return;if(!pending.has(target.ws.name))pending.set(target.ws.name,[]);const ref=legacy.recordRefs.find(ref=>ref.recordId===record.recordId),identity={recordRef:ref.label,recordId:record.recordId,athleteId:record.athleteId,name:record.athlete.name+" · "+(record.athlete.sport||"未填专项")+" · "+record.athleteId.slice(-6),...(kind==="iso"?{directionRef:legacy.directionRefs.find(ref=>ref.directionId===values.directionId)?.label}:{})};pending.get(target.ws.name).push({...values,...identity,_source:source});};
    const conditionSheet=legacySheet(null,"settings"),conditionColumns=Object.fromEntries(conditionSheet.spec.columns.map((f,i)=>[f.key,i+1]));
    const setCondition=(record,key,value,source)=>{for(let r=2;r<=conditionSheet.ws.rowCount;r++)if(conditionSheet.ws.getCell(r,conditionColumns.recordId).value===record.recordId&&conditionSheet.ws.getCell(r,conditionColumns.fieldId).value===key){conditionSheet.ws.getCell(r,conditionColumns.value).value=value;sourceLocations.set(conditionSheet.ws.name+":"+r+":"+conditionColumns.value,source);return;}};
    const seenParameters=new Map();
    for(const sheet of info.sheets){const ws=book.getWorksheet(sheet.name);if(!ws){error(errors,null,0,0,"缺少工作表："+sheet.name);continue;}if(!Array.isArray(sheet.blocks)){error(errors,ws,1,1,"工作表合同损坏");continue;}
      const source=info.records.find(record=>!sheet.testId||record.enabled[sheet.testId]);if(!source){error(errors,ws,1,1,"项目不属于本次测试");continue;}
      const contract=sheet.testId?A.project(source,sheet.testId):null;
      for(const block of sheet.blocks){let fields;
        if(block.kind==="metadata")fields=[text("recordRef","运动员 / 测试"),...L.metaFields];
        else if(block.kind==="parameters")fields=[text("recordRef","运动员 / 测试"),...contract.parameters];
        else{const section=contract.sections.find(section=>section.kind===block.kind);if(!section){error(errors,ws,block.start,1,"不支持的项目表格");continue;}fields=[text("recordRef","运动员 / 测试"),...section.fields.filter(f=>!f.key.startsWith("time:"))];if(sheet.testId==="imtp"&&block.kind==="attempt")fields.push(...block.columns.filter(f=>f.timeMs!==undefined).map(f=>A.timeField(f.timeMs,f.kind)));if(sheet.testId==="hop"&&block.kind==="hop")fields.push(text("hopSetId","测试组编号"));}
        let rows;try{rows=readBlock(ws,block,fields,errors,sheet.testId==="imtp"&&block.kind==="attempt");}catch(e){error(errors,ws,block.start,1,e.message);continue;}
        if(sheet.testId==="imtp"&&block.kind==="attempt"){const bounds=tableBounds(ws,block),times=[...new Set((bounds.table.columns||[]).map((_,i)=>A.parseTimeHeader(ws.getCell(bounds.start,i+1).value)?.timeMs).filter(time=>time!==undefined))];for(const record of info.records.filter(record=>record.enabled.imtp))timeSchemas.set(record.recordId,times);}
        const maxAttempts=new Map(),attemptGroup=row=>(row.values.recordRef||info.recordRefs[0]?.label||"")+":"+(block.kind==="iso"?row.values.directionId:"");
        for(const row of rows)if(Number.isInteger(row.values.attempt)&&row.values.attempt>0)maxAttempts.set(attemptGroup(row),Math.max(maxAttempts.get(attemptGroup(row))||0,row.values.attempt));
        for(const row of rows){const record=owner(row,ws);if(!record)continue;const values=row.values,sourceRow=origin(ws,row);
          if(block.kind==="metadata"){append(null,"metadata",record,values,sourceRow);continue;}
          if(!record.enabled[sheet.testId]){error(errors,ws,row.row,1,"此运动员未选择该项目");continue;}
          if(block.kind==="parameters"){let supplied=parameterChanges.get(record.recordId);if(!supplied)parameterChanges.set(record.recordId,supplied={});for(const f of fields.slice(1)){const value=get(values,f.key),key=record.recordId+":"+f.key;if(seenParameters.has(key)&&A.canonical(seenParameters.get(key))!==A.canonical(value)){error(errors,ws,row.row,row.columns.find(c=>c.f.key===f.key)?.col||1,"同一记录的共用参数填写不一致："+f.label);continue;}seenParameters.set(key,value);supplied[f.key]=value;setCondition(record,f.key,f.type==="boolean"?(value?"是":"否"):value,location(ws,row.row,sourceRow.columns[f.key]));}continue;}
          if(["attempt","iso","hop"].includes(block.kind)&&empty(values.attempt)){const key=attemptGroup(row),next=(maxAttempts.get(key)||0)+1;maxAttempts.set(key,next);values.attempt=next;}
          if(sheet.testId==="hop"&&block.kind==="hop"){
            values.inputMode="summary";const id=values.hopSetId,allowed=info.editableHopIds.find(item=>item.recordId===record.recordId)?.ids||[];if(!empty(id)&&!allowed.includes(id)){error(errors,ws,row.row,1,"测试组编号不属于可编辑的整次结果");continue;}
            let list=hopIds.get(record.recordId);if(!list)hopIds.set(record.recordId,list=[]);if(!empty(id)&&list.some(item=>item.id===id)){error(errors,ws,row.row,1,"完整测试组编号重复");continue;}list.push({attempt:Number(values.attempt),id:id||null});
          }
          append(sheet.testId,block.kind,record,values,sourceRow);
          if(sheet.testId==="imtp"&&block.kind==="attempt")for(const {f}of row.columns.filter(c=>c.f.timeMs!==undefined)){const value=values[f.key];if(empty(value))continue;append("imtp","timePoints",record,{attempt:values.attempt,timeMs:f.timeMs,[f.kind]:value},{...sourceRow,columns:{...sourceRow.columns,timeMs:sourceRow.columns[f.key],[f.kind]:sourceRow.columns[f.key]}});}
          if(sheet.testId==="hop"&&block.kind==="hop"){let list=extraByRecord.get(record.recordId);if(!list)extraByRecord.set(record.recordId,list=[]);list.push({attempt:Number(values.attempt),metrics:clone(values.metrics||{})});}
        }
      }
    }
    // Force/RFD columns at one time belong to one row in the legacy nested adapter.
    const points=legacySheet("imtp","timePoints");if(points&&pending.has(points.ws.name)){const groups=new Map();for(const vals of pending.get(points.ws.name)){const key=vals.recordRef+":"+vals.attempt+":"+vals.timeMs;if(!groups.has(key))groups.set(key,vals);else for(const kind of ["force","rfd"])if(!empty(vals[kind])){groups.get(key)[kind]=vals[kind];groups.get(key)._source.columns[kind]=vals._source.columns[kind];}}pending.set(points.ws.name,[...groups.values()]);}
    for(const spec of legacy.sheets){if(!pending.has(spec.name))continue;const ws=legacyBook.getWorksheet(spec.name),rows=pending.get(spec.name).map((values,index)=>spec.columns.map((f,col)=>{const source=values._source,sourceCol=source?.columns[f.key]||(f.key==="directionRef"?source?.columns.directionId:null)||source?.columns.recordRef;if(sourceCol)sourceLocations.set(spec.name+":"+(index+2)+":"+(col+1),location(source.ws,source.row,sourceCol));return get(values,f.key)??null;}));for(let r=2;r<=ws.rowCount;r++)ws.getRow(r).values=[];if(spec.tableName){ws.removeTable(spec.tableName);ws.addTable({name:spec.tableName,ref:"A1",headerRow:true,totalsRow:false,columns:spec.columns.map(f=>({name:f.header})),rows:rows.length?rows:[spec.columns.map(()=>null)]});}else rows.forEach((values,i)=>ws.getRow(i+2).values=values);}
    const parsed=await X.readTemplate(await legacyBook.xlsx.writeBuffer());parsed.templateId=info.templateId;parsed.schema=3;parsed.errors=parsed.errors.map(issue=>({...issue,...(sourceLocations.get(issue.sheet+":"+issue.row+":"+issue.column)||{})}));parsed.errors.push(...errors);
    for(const entry of parsed.entries){const id=entry.record.recordId,supplied=parameterChanges.get(id)||{};for(const [key,value]of Object.entries(supplied))put(entry.record,key,value);const ordered=(hopIds.get(id)||[]).sort((a,b)=>a.attempt-b.attempt);for(const [index,row]of (entry.record.data.hop?.trials||[]).entries()){const source=ordered[index],extra=extraByRecord.get(id)?.find(item=>item.attempt===source?.attempt);if(source)row.id=source.id||"hop_summary_"+root.crypto.randomUUID().replace(/-/g,"");if(extra)row.metrics=extra.metrics;row.jumps=[];row.inputMode="summary";}
      if(entry.record.data.hop?.trials){entry.record.data.hop.trials=entry.record.data.hop.trials.filter(A.hopHasData);if(entry.record.data.hop.trials.length&&!entry.incoming.includes("hop"))entry.incoming.push("hop");}
      if(timeSchemas.has(id)){entry.record.imtpConfig.entryTimeMs=timeSchemas.get(id);for(const row of entry.record.data.imtp||[])for(const timeMs of timeSchemas.get(id))if(!row.timePoints.some(point=>Number(point.timeMs)===timeMs))row.timePoints.push({id:"imtp_point_"+root.crypto.randomUUID().replace(/-/g,""),timeMs,force:"",rfd:""});}
      entry.acquisition={schema:3,parameters:supplied,hopBaseline:info.hopBaselines.find(item=>item.recordId===id)?.groups||[]};
    }
    return parsed;
  }
  root.RingsideExcelV3=Object.freeze({createTemplate,readWorkbook});
})(typeof window!=="undefined"?window:globalThis);
