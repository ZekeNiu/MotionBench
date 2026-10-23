(function(root){
  "use strict";
  const E=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const N=value=>root.Calc.num(value), F=(value,digits=2)=>N(value)===null?"—":Number(value).toLocaleString("zh-CN",{maximumFractionDigits:digits});
  const copy=value=>JSON.parse(JSON.stringify(value));
  const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
  const label=p=>p.label||((p.athlete?.name||p.athleteId)+" · "+p.date);
  const personName=p=>p.athlete?.name||String(p.label||p.athleteId||"").replace(/\s*·\s*\d{4}-\d{2}-\d{2}$/,""),personHeader=p=>`<span class="horizontal-person-name"><i class="horizontal-person-dot" style="background:${E(p.color||"#355e86")}"></i>${E(personName(p))}</span><small>${E(p.date||"")}</small>`;
  const meaning=row=>row.meaning||(row.measurementScale==="ordinal"?"ordinal":"numeric");
  const precision=row=>{if(Number.isInteger(row.digits))return row.digits;if(meaning(row)==="ordinal"&&row.aggregation?.mean!==true)return 0;const id=row.metricId||row.id||"";if(/^lvp-fit:.*:slope$/.test(id))return 4;if(/^lvp-fit:.*:(intercept|r2)$/.test(id)||/fvp|elasticity/.test(id)&&/(?:_|:)(?:v0|V0|slope|r2|Fe|fe|ve|ER|er|EN|en|Vmax|Vopt|endVelocity|timeS)$/.test(id))return 3;return 2;};
  const differenceMagnitude=(value,digits=2)=>{const absolute=Math.abs(value),places=absolute&&absolute<10**-digits?Math.min(20,Math.max(digits,Math.ceil(-Math.log10(absolute))+1)):digits;return absolute&&Number(absolute.toFixed(places))===0?absolute.toExponential(2):F(absolute,places);};
  const references=model=>model.references?.length?model.references:[{id:"direct",label:"运动员对照",projects:model.projects||[],overview:model.overview,risk:model.risk,capability:model.capability}];
  function activeReference(model,views={}){return references(model).find(r=>r.id===views.activeReferenceId)||references(model)[0];}
  function conditions(reference,model){
    const s=reference.spec||reference, classifications=model.classifications||{},find=(type,id)=>(classifications[type]||[]).find(v=>v.id===id)?.name;
    const window=s.window||model.window,dates=window?.from?[window.from,window.to].filter(Boolean).join(" — "):window?.kind==="all"?"全部历史":"";
    return [s.scope==="team"?s.teamName||model.groups?.find(g=>g.id===s.teamId)?.name:s.scope==="sport"?find("sports",s.sportId):s.id==="direct"?null:"本机数据库",s.sex,find("sports",s.sportId),find("subdivisions",s.subdivisionId),s.ageBandName||find("ageBands",s.ageBandId)||(s.ageMin!==undefined&&s.ageMin!==null?`${s.ageMin}–${s.ageMax} 岁`:null),s.sampling==="period-record"?"期间最佳成绩":s.sampling==="period-mean"?"期间均值":s.id==="direct"?null:"最近可比测试",s.id==="direct"?null:dates].filter((s,i,a)=>s&&a.indexOf(s)===i).join(" · ");
  }
  function distribution(value){
    const items=Array.isArray(value)?value:Object.entries(value||{}).map(([value,count])=>({value,count}));
    return items.map(v=>`${E(v.label??v.value??v.category)}：${F(v.n??v.count,0)} 人`).join("；")||"—";
  }
  function difference(fact,row){
    if(meaning(row)==="category"||!fact?.available||fact.isBaseline||N(fact.delta)===null)return "";
    const delta=fact.delta,d=precision(row),suffix=fact.kind==="percentage-point"?" 个百分点":row.unit?" "+E(row.unit):"";
    const relative=N(fact.percent)!==null?`（${delta>0?"+":""}${F(fact.percent,1)}%）`:"";
    return `<small class="horizontal-difference">${delta===0?"持平":delta>0?"高于":"低于"} ${delta===0?"":differenceMagnitude(delta,d)+suffix+relative}</small>`;
  }
  function cellHTML(cell,row,delta){
    if(!cell)return '<span class="longitudinal-unavailable">—</span>';
    const numeric=N(cell.value)!==null,display=cell.display||{},assessment=cell.assessment||{},grade=cell.evaluation?.grade||{},gradeLabel=display.label||assessment.label||grade.label;
    const show=display.visible===true,status=display.status||assessment.status||grade.status||"gray";
    const stat=cell.statistics,details=numeric&&stat?.n>=3?`<small>${F(stat.mean,precision(row))} ± ${F(stat.sd,precision(row))}${N(stat.cv)!==null?" · CV "+F(stat.cv)+"%":""}</small>`:"",sourceNotes=Array.isArray(cell.displayNotes)?cell.displayNotes:[...(Array.isArray(cell.notes)?cell.notes:String(cell.notes||"").split("；")),...(cell.diagnosticNotes||[])],notes=[...new Set([...sourceNotes,...(cell.pain?["疼痛"]:[])].filter(note=>String(note).trim()&&(!show||note!==gradeLabel)))].join("；");
    return `<span class="longitudinal-result-value"><strong>${numeric?F(cell.value,precision(row)):E(cell.value??cell.label??"—")}</strong>${show?`<span class="pill ${["red","amber","green","gray"].includes(status)?status:"gray"} longitudinal-assessment">${E(gradeLabel)}</span>`:""}</span>${details}${numeric?difference(delta,row):""}${notes?`<small>${E(notes)}</small>`:""}`;
  }
  function contextLabels(rows){
    const flatten=(value,prefix="",result={})=>{for(const [key,item]of Object.entries(value||{})){const field=prefix?prefix+"."+key:key;if(item&&typeof item==="object"&&!Array.isArray(item))flatten(item,field,result);else if(!/(^|\.)(?:id|definitionId|testId)$/.test(field))result[field]=Array.isArray(item)?JSON.stringify(item):String(item??"");}return result;},labels={protocol:"协议",method:"方法",metric:"速度口径",velocity:"速度口径",velocityMetrics:"速度口径",definition:"结果定义",unit:"单位",minimumVelocity:"MVT",thresholdMethod:"阈值方法",dropHeights:"落高",angle:"角度",targetDistanceM:"目标距离",deltaForcePct:"F₀ 改变",deltaVelocityPct:"V₀ 改变",protocols:"测试流程",version:"协议版本",measurementScale:"量表",meaning:"数值含义"},groups=new Map();
    rows.forEach(row=>{const key=(row.testId||"")+":"+(row.metricId||row.id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);});
    return rows.map(row=>{const peers=groups.get((row.testId||"")+":"+(row.metricId||row.id));if(peers.length<2||!row.context)return row;const contexts=peers.map(r=>flatten({...r.context,unit:r.unit,measurementScale:r.measurementScale,meaning:r.meaning})),fields=[...new Set(contexts.flatMap(c=>Object.keys(c)))].filter(key=>new Set(contexts.map(c=>c[key])).size>1),current=contexts[peers.indexOf(row)],details=fields.map(key=>current[key]?`${labels[key.split(".").at(-1)]||key.split(".").at(-1)} ${current[key].replace(/"(?:id|metric|inputMode|selectionBasis)":/g,"").replace(/[\[\]{}\"]/g,"")}`:"").filter(Boolean);return details.length?{...row,contextLabel:(row.contextLabel||"测量条件")+"（"+details.join("；")+"）"}:row;});
  }
  function benchmarkHTML(row){
    const b=row.benchmark;if(!b)return "";
    const numerical=meaning(row)==="numeric"||row.aggregation?.mean===true;
    if(!numerical)return `<strong>${distribution(b.distribution)}</strong><small>${N(b.best)!==null?"最佳 "+F(b.best,precision(row))+" · ":""}n = ${F(b.n,0)}</small>${b.samplingLabel?`<small>${E(b.samplingLabel)}</small>`:""}`;
    return `${cellHTML({value:b.mean,display:b.display,assessment:b.assessment},row,b.difference)}<small>${N(b.best)!==null?`${E(b.sampling==="period-mean"?"最佳个人期均":"最佳")} ${F(b.best,precision(row))} · `:""}n = ${F(b.n,0)}</small>${b.samplingLabel?`<small>${E(b.samplingLabel)}</small>`:""}`;
  }
  function table(rows,participants,{views={},print=false,wrapped=true,focusAthleteId="",referenceLabel="",referenceFocused=false}={}){
    if(!rows?.length)return "";rows=contextLabels(rows);
    const hasBenchmark=rows.some(r=>r.benchmark),groups=participants.length?chunks(participants.map((p,i)=>({p,i})),print?3:participants.length):[[]];
    const html=groups.map(group=>`<div class="table-wrap"><table class="longitudinal-results horizontal-results"${print?"":` style="min-width:${190+group.length*160+(hasBenchmark?180:0)}px"`}><colgroup><col class="horizontal-metric-column">${group.map(()=>'<col class="horizontal-person-column">').join("")}${hasBenchmark?'<col class="horizontal-reference-column">':""}</colgroup><thead><tr><th scope="col">指标</th>${group.map(({p})=>`<th scope="col"${p.athleteId===focusAthleteId?' class="horizontal-focus"':""}>${personHeader(p)}</th>`).join("")}${hasBenchmark?`<th scope="col" class="horizontal-reference${referenceFocused?" horizontal-focus":""}">${E(referenceLabel)}<small>群体结果</small></th>`:""}</tr></thead><tbody>${rows.map(row=>`<tr data-horizontal-metric="${E(row.id)}"><th scope="row">${E(row.name)}${row.unit?`<small>${E(row.unit)}</small>`:""}${row.contextLabel?`<small>${E(row.contextLabel)}</small>`:""}</th>${group.map(({p,i})=>`<td data-record-id="${E(p.recordId||p.id)}"${p.athleteId===focusAthleteId?' class="horizontal-focus"':""}>${cellHTML(row.cells?.[i],row,row.differences?.[i])}</td>`).join("")}${hasBenchmark?`<td class="horizontal-reference${referenceFocused?" horizontal-focus":""}">${benchmarkHTML(row)}</td>`:""}</tr>`).join("")}</tbody></table></div>`).join("");
    if(!wrapped)return html;
    const compactRows=rows.map(row=>({...Object.fromEntries(["id","metricId","name","unit","measurementScale","meaning","aggregation","digits","contextLabel"].filter(key=>row[key]!==undefined).map(key=>[key,row[key]])),cells:(row.cells||[]).map(cell=>cell?Object.fromEntries(["value","label","display","statistics","assessment","notes","displayNotes","diagnosticNotes","pain"].filter(key=>cell[key]!==undefined).map(key=>[key,cell[key]])):null),...(row.benchmark?{benchmark:Object.fromEntries(["n","mean","best","distribution","sampling","samplingLabel","display","assessment","difference"].filter(key=>row.benchmark[key]!==undefined).map(key=>[key,row.benchmark[key]]))}:{}),differences:row.differences})),compactPeople=participants.map(p=>({...Object.fromEntries(["id","recordId","athleteId","label","date","color"].map(key=>[key,p[key]])),athlete:{name:personName(p)}}));
    return `<div class="horizontal-table" data-horizontal-table="${E(JSON.stringify({rows:compactRows,participants:compactPeople,options:{focusAthleteId,referenceLabel,referenceFocused}}))}">${html}</div>`;
  }
  function bars(spec,width=560){
    const left=Math.min(190,Math.max(110,width*.28)),right=width-70,max=Math.max(0,...spec.values.map(v=>v.value)),min=Math.min(0,...spec.values.map(v=>v.value)),span=max-min||1,x=v=>left+(v-min)/span*(right-left);
    const wrap=value=>{const result=[];let line="",used=0;for(const char of Array.from(value)){const size=/[\u2e80-\u9fff\uff00-\uffef]/.test(char)?10:6;if(line&&used+size>left-14){result.push(line);line="";used=0;}line+=char;used+=size;}if(line)result.push(line);return result;};let offset=8;
    const content=spec.values.map(v=>{const date=String(v.label).match(/\s*·\s*(\d{4}-\d{2}-\d{2})$/),lines=wrap(date?String(v.label).slice(0,date.index):String(v.label));if(date)lines.push(date[1]);const center=offset+lines.length*13/2,label=lines.map((line,i)=>`<tspan x="2" y="${offset+10+i*13}">${E(line)}</tspan>`).join("");offset+=Math.max(44,lines.length*13+16);return `<text x="2" font-size="10" fill="#263747">${label}<title>${E(v.label)}</title></text>${v.reference?`<line x1="${x(v.value)}" x2="${x(v.value)}" y1="${center-7}" y2="${center+7}" stroke="${v.color}" stroke-width="3"${v.best?' stroke-dasharray="3 2"':""}/>`:`<rect x="${Math.min(x(0),x(v.value))}" y="${center-7}" width="${Math.max(1,Math.abs(x(v.value)-x(0)))}" height="14" rx="3" fill="${v.color}"/>`}<text x="${right+8}" y="${center+4}" font-size="11" fill="#263747">${F(v.value,spec.digits)}</text>`;}).join(""),h=offset+12;
    return `<p class="longitudinal-chart-title">${E(spec.title)}${spec.unit?" · "+E(spec.unit):""}</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${E(spec.title)}" data-pixel-layout="true" style="font-family:Microsoft YaHei,Segoe UI,sans-serif">${content}</svg>`;
  }
  function reconstructed(model){
    return model.participants.map(p=>{const report=root.RingsideReport.build(copy(p.record),{catalog:model.catalog});return {...p,id:p.recordId||p.id,date:p.date,label:label(p),record:report.record,report,stats:report.stats,rawHTML:root.RingsideReport.render(report)+root.RingsideReport.renderCapabilityAnalysis(report,{print:true})};});
  }
  function curvePanel(spec,model,views){
    const config=views.charts?.[spec.chartId]||{},ids=model.participants.map(p=>p.recordId),saved=(config.recordIds||ids).filter(id=>ids.includes(id)),selected=new Set(saved.length?saved:ids),hidden=new Set(views.hiddenParticipantIds||[]),allowed=new Set(model.participants.filter(p=>selected.has(p.recordId)&&!hidden.has(p.athleteId)).map(p=>p.recordId));
    const keep=id=>!id||allowed.has(id)||model.participants.some(p=>allowed.has(p.recordId)&&String(id).startsWith(p.recordId+":")),data={...spec,subjectKind:"athlete",...(spec.series?{series:spec.series.filter(s=>s.reference||keep(s.recordId||s.id))}:{}),...(spec.horizontalMarkers?{horizontalMarkers:spec.horizontalMarkers.filter(s=>keep(s.recordId))}:{}),...(spec.markers?{markers:spec.markers.filter(s=>keep(s.recordId))}:{})};
    if(spec.periods){const indexes=spec.periods.map((p,i)=>p.kind==="reference"||allowed.has(p.id)?i:-1).filter(i=>i>=0);data.periods=indexes.map(i=>spec.periods[i]);data.values=indexes.map(i=>spec.values[i]);}
    if(spec.scaleValues)data.scaleValues=spec.scaleValues.filter(v=>keep(v?.recordId));
    const options=root.RingsideLongitudinalView.optionControls(spec,{namespace:"horizontal"});
    const controls=`<div class="horizontal-curve-controls no-print" data-horizontal-chart="${E(spec.chartId)}">${model.participants.length?`<details><summary>图中运动员</summary>${model.participants.map(p=>`<label><input type="checkbox" data-horizontal-chart-person="${E(p.recordId)}"${selected.has(p.recordId)?" checked":""}>${E(label(p))}</label>`).join("")}</details>`:""}${options}</div>`;
    const empty=data.periods?!data.values.some(value=>N(value?.value)!==null||N(value?.rsi)!==null):data.series?!data.series.some(series=>series.values?.some(value=>N(value)!==null)||(data.kind==="lvp"?series.points?.length:series.points?.some(point=>N(point?.y)!==null)))&&!data.horizontalMarkers?.length:false;
    return `<div class="horizontal-curve-panel">${controls}${empty?'<p class="longitudinal-empty" role="status">所选运动员暂无可显示的数据或曲线。</p>':`<div class="horizontal-curve" data-horizontal-curve="${E(JSON.stringify(data))}"></div>`}</div>`;
  }
  function withReference(spec,project,reference,model){
    if(reference.id==="direct")return spec;
    const rows=project.metrics||[],benchmark=id=>rows.find(row=>row.id===id)?.benchmark?.mean??null;
    if(["columns","bars"].includes(spec.kind)){
      const first=spec.values?.find(value=>value?.heightRowId||value?.rsiRowId),value=spec.metricRowId?benchmark(spec.metricRowId):first?benchmark(first.heightRowId):null,rsi=first?benchmark(first.rsiRowId):null;
      if(N(value)===null&&N(rsi)===null)return spec;
      const entry={value,rsi,reference:true},period={id:reference.id,kind:"reference",label:reference.label+" · 群体均值",date:"",color:"#65717c"};
      return {...spec,periods:[...spec.periods,period],values:[...spec.values,entry],...(spec.scaleValues?{scaleValues:[...spec.scaleValues,entry]}:{})};
    }
    if(spec.kind==="radar"){
      const aggregate=aggregateFigures(project,reference,model).find(figure=>figure.kind==="radar");if(!aggregate)return spec;
      const axes=spec.axes.map(axis=>aggregate.axes.findIndex(item=>item.key===axis.key||item.label===axis.label)),series=aggregate.series.map(series=>({...series,reference:true,values:axes.map(index=>index<0?null:series.values[index]),dash:series.dash||"6 4"}));
      return {...spec,max:Math.max(spec.max||0,aggregate.max||0),series:[...spec.series,...series]};
    }
    return spec;
  }
  function individualFigures(project,model,views,periods,reference){
    if(!root.RingsideLongitudinalView?.projectFigures)return "";
    const hidden=new Set(views.hiddenParticipantIds||[]),chosen=periods.filter(p=>!hidden.has(p.athleteId));if(!chosen.length)return "";
    const original=chosen.flatMap(p=>p.report.projects).find(p=>p.id===project.id),renderer=project.renderer||original?.renderer;
    const indexes=chosen.map(p=>model.participants.findIndex(q=>q.recordId===p.recordId)),metrics=(project.metrics||[]).map(r=>({...r,cells:indexes.map(i=>r.cells?.[i]?{...r.cells[i],comparableToPrevious:false}:null)}));
    const specs=root.RingsideLongitudinalView.projectFigures({...original,...project,renderer,metrics},{...model,periods:chosen,displayRecord:model.displayRecord,projects:[{...original,...project,renderer,metrics}],capability:{cards:[],analyses:[]}},{specsOnly:true,views:{charts:views.charts||{}}});
    return specs.filter(s=>s.kind!=="notice").map(s=>curvePanel(withReference(s,project,reference,model),model,views)).join("");
  }
  function aggregateFigures(project,reference,model){
    const supplied=reference.aggregateFigures?.[project.id];if(supplied?.length)return supplied;
    const rows=project.metrics||[],value=row=>N(row?.benchmark?.mean),period={id:reference.id,label:reference.label,date:"",color:"#7895ad",kind:"reference"};
    const scalar=(row,kind)=>({kind,subjectKind:"athlete",chartId:"aggregate:"+row.id,title:row.name,unit:row.unit,periods:[period],values:[{value:value(row)}]});
    if(project.renderer==="jumps"){
      const height=rows.find(row=>row.metricId===project.id+"_height"),rsi=rows.find(row=>row.metricId===project.id+"_rsi");
      return value(height)!==null||value(rsi)!==null?[{kind:"columns",subjectKind:"athlete",chartId:"aggregate:"+project.id,title:project.name,unit:"垂直跳跃高度 · cm",rsi:value(rsi)!==null,periods:[period],values:[{value:value(height),rsi:value(rsi)}]}]:[];
    }
    if(project.renderer==="speed")return rows.filter(row=>["mas_speed","mss_speed","ift_speed","ift_shuttle","ift_treadmill"].includes(row.metricId)&&value(row)!==null).map(row=>scalar(row,"bars"));
    if(project.renderer==="ball")return rows.filter(row=>value(row)!==null).map(row=>scalar(row,"bars"));
    if(project.renderer==="scalar"){
      const view=project.reportView||model.catalog?.reportViews?.[project.id];
      if(["bar","target","column"].includes(view?.kind))return rows.filter(row=>view.metricIds.includes(row.metricId)&&value(row)!==null&&meaning(row)==="numeric").map(row=>scalar(row,view.kind==="column"?"columns":"bars"));
      if(view?.kind==="radar"){
        const selected=rows.filter(row=>view.metricIds.includes(row.metricId));
        return selected.length?[{kind:"radar",chartId:"aggregate:"+project.id,title:project.name+" · 评分雷达",max:100,axes:selected.map(row=>({key:row.id,label:row.name})),series:[{id:reference.id,label:reference.label,color:period.color,values:selected.map(row=>N(row.benchmark?.score))}]}]:[];
      }
    }
    // Averaging fitted parameters cannot reconstruct a measured curve or trial cloud.
    return [];
  }
  function rawTrials(project,participants,periods,views){
    const disclosure=(html,key)=>{let index=0;return html.replace(/<details\b([^>]*)>/g,(_tag,attrs)=>{const id=attrs.match(/\bid="([^"]*)"/)?.[1]||key+"-"+index++;attrs=attrs.replace(/\sopen(?:="[^"]*")?/g,"");return `<details${attrs}${/\bid=/.test(attrs)?"":` id="${E(id)}"`}${views.detailOpen?.[id]?" open":""}>`;});};
    const native=periods.map(p=>{const source=p.rawHTML,blocks=[],re=/<details\b[^>]*data-raw-trials="([^"]+)"[^>]*>/g;let match;
      while((match=re.exec(source))){if(match[1]!==project.id)continue;const start=match.index,tags=/<\/?details\b[^>]*>/g;tags.lastIndex=re.lastIndex;let depth=1,end=re.lastIndex,next;while(depth&&(next=tags.exec(source))){depth+=next[0].startsWith("</")?-1:1;end=tags.lastIndex;}if(depth)continue;let block=source.slice(start,end).replace(/<details\b/,`<details data-horizontal-raw-key="${E(p.id+":"+project.id+":"+blocks.length)}"`).replace(/\sid="([^"]*)"/g,(_,id)=>` id="horizontal-raw-${E(p.id)}-${E(id)}"`).replace(/data-trial-title="([^"]*)"/,(_,title)=>`data-trial-title="${E(label(p))} · ${title}"`).replace(/(<summary[^>]*>)/,`$1${E(label(p))} · `);blocks.push(disclosure(block,"horizontal-raw-"+p.id+"-"+project.id+"-"+blocks.length));re.lastIndex=end;}return blocks.join("");}).join("");
    if(native)return `<div class="horizontal-raw">${native}</div>`;
    const rows=(project.metrics||[]).filter(r=>r.cells?.some(c=>c?.rawTrials?.length));if(!rows.length)return "";
    const fallbackId="horizontal-raw-"+project.id;return `<details id="${E(fallbackId)}" class="attempt-details horizontal-raw"${views.detailOpen?.[fallbackId]?" open":""}><summary>展开原始试次数据</summary>${participants.map((p,i)=>{const seen=new Set(),items=rows.flatMap(r=>{const trials=r.cells?.[i]?.rawTrials||[],key=JSON.stringify(trials);if(!trials.length||seen.has(key))return[];seen.add(key);return[{name:r.name,trials}];});return items.length?`<section><h5>${E(label(p))}</h5>${items.map(item=>{const keys=[...new Set(item.trials.flatMap(t=>Object.keys(t)))].filter(k=>!["id","selected","valid"].includes(k)&&item.trials.some(t=>t[k]!==null&&t[k]!==undefined&&typeof t[k]!=="object"));return `<div class="table-wrap"><table><caption>${E(item.name)}</caption><thead><tr><th>试次</th>${keys.map(k=>`<th>${E(({height:"高度",value:"结果",notes:"备注",load:"负荷",velocity:"速度",peakForce:"峰值力",rsiModified:"RSI-mod",rsi:"RSI",contactTime:"触地时间",validity:"有效性",label:"项目",name:"名称"})[k]||k)}</th>`).join("")}</tr></thead><tbody>${item.trials.map((t,j)=>`<tr><td>${j+1}</td>${keys.map(k=>`<td>${E(t[k]??"—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;}).join("")}</section>`:"";}).join("")}</details>`;
  }
  function details(model,reference,views,{print=false,periods}={}){
    const focus=model.presentation?.focus||views.focus||{},projects=reference.projects||model.projects||[],participantOptions={views,print,focusAthleteId:focus.kind==="athlete"?focus.id:"",referenceFocused:focus.kind==="reference"&&focus.id===reference.id,referenceLabel:reference.id==="direct"?"":reference.label};
    const renderer=project=>project.renderer||periods.flatMap(p=>p.report.projects).find(p=>p.id===project.id)?.renderer,isAnalysis=project=>["fvp","sprint-fvp"].includes(renderer(project));
    const section=category=>projects.filter(p=>category==="screen"?p.category==="screen":category==="capability"?isAnalysis(p):p.category!=="screen"&&!isAnalysis(p)).map(project=>{
      const figureSpecs=aggregateFigures({...project,renderer:renderer(project)},reference,model),charts=model.participants.length?individualFigures(project,model,views,periods,reference):figureSpecs.map(spec=>`<div class="horizontal-curve" data-horizontal-curve="${E(JSON.stringify(spec))}"></div>`).join("");
      const tables=root.RingsideLongitudinalView.projectTableSections({...project,renderer:renderer(project)}).map(part=>part.id?`<section class="longitudinal-iso-section" data-iso-section="${E(part.id)}"><h5 class="longitudinal-table-caption">${E(part.title)}</h5>${table(part.rows,model.participants,participantOptions)}</section>`:table(part.rows,model.participants,participantOptions)).join("");
      const content=!model.participants.length&&charts?`<div class="detail-pair" data-pdf-pair><div class="chart-wrap">${charts}</div><div class="detail-data">${tables}</div></div>`:`${charts?`<div class="horizontal-figures">${charts}</div>`:""}${tables}`;
      return `<article class="test-block horizontal-test" id="horizontal-${E(reference.id)}-${E(project.id)}"><div class="test-title"><h4>${E(project.name)}</h4></div>${content}${rawTrials(project,model.participants,periods,views)}</article>`;
    }).join("");
    const screen=section("screen"),performance=section("performance"),capability=(reference.capability?.cards||[]).filter(card=>card.metrics?.length).map(card=>`<article class="test-block"><div class="test-title"><h4>${E(card.title)}</h4></div>${table(card.metrics,model.participants,participantOptions)}</article>`).join("")+section("capability");
    const description=model.participants.length?model.references?.length?"个人结果与群体参照":"运动员对照":"群体结果评价";
    return `${screen?`<details class="details-group" id="horizontal-screen-${E(reference.id)}" open><summary>损伤风险筛查<span>${description}</span></summary><div class="quality-group">${screen}</div></details>`:""}${performance?`<details class="details-group" id="horizontal-performance-${E(reference.id)}" open><summary>运动表现测试<span>${description}</span></summary><div class="quality-group">${performance}</div></details>`:""}${capability?`<details class="details-group" id="horizontal-capability-${E(reference.id)}" open><summary>能力结构分析<span>${description}</span></summary><div class="quality-group">${capability}</div></details>`:""}`;
  }
  function overview(data,title,views,participants,risk=false){
    if(!data?.axes?.length)return '<p class="longitudinal-empty">尚无已测维度</p>';
    const hidden=new Set(views.hiddenParticipantIds||[]),byId=new Map(participants.map(p=>[p.recordId||p.id,p])),series=(data.series||[]).filter(s=>!hidden.has(byId.get(s.recordId||s.id)?.athleteId)).map(s=>({...s,label:byId.has(s.recordId||s.id)?label(byId.get(s.recordId||s.id)):s.label}));
    const mean=data.mean||data.benchmark?.values;if(Array.isArray(mean)&&mean.some(v=>N(v)!==null))series.push({id:"cohort-mean",label:data.benchmark?.label||"群体结果评价",color:"#65717c",dash:"6 4",values:mean});
    return `<div class="horizontal-curve" data-horizontal-curve="${E(JSON.stringify({kind:"radar",subjectKind:"athlete",title,showTitle:false,axes:data.axes,series,max:risk?3:100,risk,overview:!risk}))}"></div>`;
  }
  function presentationControls(model,views,ref){
    const people=model.participants||[],refs=model.references||[],p=model.presentation||{},focus=p.focus||views.focus||{kind:"all"},baseline=p.baseline||views.baseline||{kind:"none"};
    const select=(key,title,items,value)=>`<label><span>${E(title)}</span><select data-horizontal-view="${key}" aria-label="${E(title)}">${items.map(([id,name])=>`<option value="${E(id)}"${id===value?" selected":""}>${E(name)}</option>`).join("")}</select></label>`;
    const focusOptions=people.length?[["all","全部对象"],...people.map(person=>["athlete:"+person.athleteId,personName(person)])]:[["reference:"+ref.id,ref.label]],baselineOptions=[["none","无"],...people.map(person=>["athlete:"+person.athleteId,personName(person)+" · "+person.date]),...(refs.length?[["reference:mean","当前群体均值"],["reference:best","当前群体最佳"]]:[])];
    return `<div class="horizontal-controls no-print">${select("focus","报告重点",focusOptions,focus.kind==="all"?"all":focus.kind+":"+focus.id)}${select("baseline","比较基准",baselineOptions,baseline.kind==="reference"?"reference:"+(baseline.statistic||"mean"):baseline.kind==="athlete"?"athlete:"+baseline.id:"none")}${refs.length>1?select("activeReferenceId","当前群体",refs.map(reference=>[reference.id,reference.label]),ref.id):""}${people.length?`<details><summary>图中运动员</summary>${people.map(person=>`<label><input type="checkbox" data-horizontal-person="${E(person.athleteId)}"${!(views.hiddenParticipantIds||[]).includes(person.athleteId)?" checked":""}>${E(label(person))}</label>`).join("")}</details>`:""}</div>`;
  }
  function summaryCards(model,ref){
    const presentation=model.presentation||{},focus=presentation.focus||{kind:"all"},baseline=presentation.baseline||{kind:"none"},summary=model.summary||{},people=model.participants||[],selected=focus.kind==="athlete"?people.filter(person=>person.athleteId===focus.id):focus.kind==="reference"?[]:people,group=focus.kind==="reference"?references(model).find(item=>item.id===focus.id)||ref:!people.length?ref:null;
    const card=(id,title,body)=>`<article class="micro-card horizontal-summary-card" data-horizontal-summary="${id}"><div class="micro-head"><h3>${title}</h3></div>${body}</article>`;
    const info=group?`<div class="micro-value text">${E(group.label)}</div><p>${F(group.eligibleAthletes,0)} 名符合条件的运动员</p><p>${E(conditions(group,model))}</p>`:`<ul class="horizontal-summary-list">${selected.map(person=>`<li><strong>${E(personName(person))}</strong>${[person.athlete?.sex,N(person.athlete?.age)!==null?person.athlete.age+" 岁":"",person.athlete?.sport].filter(Boolean).length?`<small>${E([person.athlete?.sex,N(person.athlete?.age)!==null?person.athlete.age+" 岁":"",person.athlete?.sport].filter(Boolean).join(" · "))}</small>`:""}</li>`).join("")}</ul>`;
    const dateReference=group||ref.id!=="direct"&&ref,sources=dateReference?(dateReference.projects||[]).flatMap(project=>project.metrics.flatMap(row=>(row.benchmark?.contributors||[]).flatMap(person=>person.sources?.length?person.sources:[person]))):[],dates=[...new Set(sources.map(source=>source.date).filter(Boolean))].sort(),window=dateReference?.spec?.window||model.window,sampling=dateReference?.spec?.sampling,groupDates=dateReference?`<div class="horizontal-group-dates"><strong>${E(dateReference.label)}</strong><span>统计范围：${E(window?.kind==="all"?"全部历史":[window?.from,window?.to].filter(Boolean).join(" — ")||"未设置")}</span><span>${sampling==="period-mean"?"期间均值":sampling==="period-record"?"期间最佳成绩":"最近可比测试"}</span><small>实际测试：${E(dates.length?dates.length===1?dates[0]:dates[0]+" — "+dates.at(-1):"暂无有效测试")}</small></div>`:"",dateBody=(group?"":`<ul class="horizontal-summary-list">${selected.map(person=>`<li><strong>${E(person.date||"未填写日期")}</strong><small>${E(personName(person))}</small></li>`).join("")}</ul>`)+groupDates;
    const changes=(items,empty)=>{
      if(!items?.length)return `<p class="horizontal-summary-empty">${empty}</p>`;
      const groups=new Map();for(const item of items.slice(0,3)){const name=item.projectName||"测试结果";if(!groups.has(name))groups.set(name,[]);groups.get(name).push(item);}
      return `<ul class="horizontal-summary-list horizontal-summary-results">${[...groups].map(([project,values])=>`<li><strong>${E(project)}</strong>${values.map(item=>`<span>${E(item.name)}${focus.kind==="all"?" · "+E(item.subjectLabel):""}</span>${N(item.delta)!==null?`<small>${item.delta>0?"高于":"低于"} ${differenceMagnitude(item.delta)}${item.difference?.kind==="percentage-point"?" 个百分点":item.unit?" "+E(item.unit):""}${N(item.percent)!==null?`（${item.percent>0?"+":""}${F(item.percent,1)}%）`:""}</small>`:""}`).join("")}</li>`).join("")}</ul><p>相对 ${E(summary.baselineLabel||"所选基准")}${items.length>3?` · 另 ${items.length-3} 项见具体数据`:""}</p>`;
    };
    return card("information","基本信息",info)+card("dates","测试日期",dateBody)+(baseline.kind!=="none"?card("advantages","相对优势",changes(summary.advantages,"暂无可判定的相对优势"))+card("disadvantages","相对不足",changes(summary.disadvantages,"暂无可判定的相对不足")):"");
  }
  function sampleData(row,referenceId,views){
    if(!row?.benchmark)return '<p class="empty">暂无参照样本</p>';
    const b=row.benchmark,sourceTable=sources=>`<div class="table-wrap"><table><thead><tr><th>测试日期</th><th>记录</th><th>本次代表结果</th></tr></thead><tbody>${sources.map(source=>`<tr><td>${E(source.date)}</td><td>${E(source.recordId)}</td><td>${F(source.value,precision(row))}${row.unit?" "+E(row.unit):""}</td></tr>`).join("")}</tbody></table></div>`;
    const contributors=(b.contributors||[]).map(person=>{const sources=person.sources?.length?person.sources:[person],dates=[...new Set(sources.map(source=>source.date).filter(Boolean))].sort();return {person,sources,dates,id:"horizontal-source-"+referenceId+"-"+row.id+"-"+person.athleteId};});
    return `<p class="horizontal-sample-caption">${E(row.name)} · ${E(b.samplingLabel)} · ${b.n} 人</p><div class="table-wrap"><table class="horizontal-samples-table"><thead><tr><th>运动员</th><th>实际测试日期</th><th>个人贡献${row.unit?" · "+E(row.unit):""}</th></tr></thead><tbody>${contributors.map(({person,dates})=>`<tr><th scope="row">${E(person.name||person.athleteId)}</th><td>${E(dates.length>1?dates[0]+" — "+dates.at(-1):dates[0]||"")}</td><td>${meaning(row)==="category"?E(person.value):F(person.value,precision(row))}</td></tr>`).join("")}</tbody></table></div>${contributors.filter(item=>item.sources.length>1).map(({person,sources,id})=>`<details class="horizontal-contribution-sources" id="${E(id)}"${views.detailOpen?.[id]?" open":""}><summary>${E(person.name||person.athleteId)} · 查看 ${sources.length} 次测试</summary>${sourceTable(sources)}</details>`).join("")}`;
  }
  function samples(reference,views){
    const metrics=(reference.projects||[]).flatMap(project=>(project.metrics||[]).filter(row=>row.benchmark).map(row=>({...row,projectName:project.name}))),selected=metrics.find(row=>row.id===views.sampleMetrics?.[reference.id])||metrics[0],id="horizontal-samples-"+reference.id;
    return `<details id="${E(id)}" class="horizontal-sample-details" data-horizontal-samples="${E(reference.id)}"${views.detailOpen?.[id]?" open":""}><summary>查看参照样本</summary><label class="field no-print"><span>指标</span><select data-horizontal-sample-metric>${metrics.map(row=>`<option value="${E(row.id)}"${row===selected?" selected":""}>${E(row.projectName+" · "+row.name+(row.contextLabel?" · "+row.contextLabel:""))}</option>`).join("")}</select></label><div data-horizontal-sample-data>${sampleData(selected,reference.id,views)}</div></details>`;
  }
  function render(input,{views={},print=false}={}){
    const model={...(root.RingsideHorizontal?.present?root.RingsideHorizontal.present(input,views):input),displayRecord:input.participants?.at(-1)?.record};
    const ref=activeReference(model,{...views,activeReferenceId:model.presentation?.activeReferenceId||views.activeReferenceId}),people=model.participants||[],periods=reconstructed(model),controls=print?"":presentationControls(model,views,ref);
    const content=`<section class="horizontal-reference-section" data-horizontal-reference="${E(ref.id)}">${ref.id!=="direct"?`<div class="horizontal-reference-heading"><h3>${E(ref.label)}</h3><p>${E(conditions(ref,model))}</p></div>`:""}${details(model,ref,views,{print,periods})}${ref.id!=="direct"?samples(ref,views):""}</section>`;
    const tools=print?"":`<div class="horizontal-report-tools no-print"><span role="status" data-horizontal-progress hidden></span>${model.references?.length?'<button type="button" class="btn small" data-horizontal-refresh>更新群体数据</button>':""}</div>`;
    const signals=people.length?[]:(ref.risk?.rows||[]).filter(row=>row.benchmark?.display?.visible&&["red","amber"].includes(row.benchmark.display.status)).sort((a,b)=>Number(b.benchmark.display.status==="red")-Number(a.benchmark.display.status==="red")),signalItem=row=>`<div class="screen-item"><h4>${E(row.name)} <span class="pill ${E(row.benchmark.display.status)}">${E(row.benchmark.display.label)}</span></h4><p>${(row.benchmark.members||[]).filter(member=>member.hasMeasured).map(member=>E(member.name)+" "+F(member.value)+(member.unit?" "+E(member.unit):"")).join("；")}${row.context?.bilateral?" · 群体结果未定位到单侧":""}</p></div>`,moreId="horizontal-risk-more-"+ref.id,screenItems=signals.slice(0,3).map(signalItem).join("")+(signals.length>3?`<details id="${E(moreId)}"${views.detailOpen?.[moreId]?" open":""}><summary>另有 ${signals.length-3} 项</summary>${signals.slice(3).map(signalItem).join("")}</details>`:"");
    return {layout:people.length?"comparison":"group",controls,summary:summaryCards(model,ref),body:!people.length&&ref.aggregateRiskRegions?root.RingsideViz.body(ref.aggregateRiskRegions,root.RingsideBodyImage):overview(ref.risk||model.risk,"损伤风险筛查",views,people,true),screenItems,screenPill:people.length?"运动员对照":"群体结果评价",overview:!people.length&&ref.aggregateOverviewAxes?root.RingsideViz.radar(ref.aggregateOverviewAxes):overview(ref.overview||model.overview,"运动表现概览",views,people),referenceLabel:model.profile?.name||"统一评价方案",legend:"",details:tools+content};
  }
  function layout(container,{print=false}={}){
    container.querySelectorAll("[data-horizontal-table]").forEach(node=>{if(print&&!node.dataset.horizontalPrint){const data=JSON.parse(node.dataset.horizontalTable);node.innerHTML=table(data.rows,data.participants,{...data.options,print:true,wrapped:false});node.dataset.horizontalPrint="true";}});
    container.querySelectorAll("[data-horizontal-bars]").forEach(node=>{const w=Math.max(280,Math.round(node.getBoundingClientRect().width||560));node.innerHTML=bars(JSON.parse(node.dataset.horizontalBars),w);});
    container.querySelectorAll("[data-horizontal-curve]").forEach(node=>{const w=Math.max(250,Math.round(node.getBoundingClientRect().width||450));node.innerHTML=root.RingsideLongitudinalView.draw(JSON.parse(node.dataset.horizontalCurve),w,print);});
  }
  const handlers=new WeakMap();let observer;
  function mount(container,model,{onChange}={}){
    observer?.disconnect();if(handlers.has(container))container.removeEventListener("change",handlers.get(container));
    const change=event=>{const t=event.target,panel=t.closest("[data-horizontal-chart]"),current=container.__horizontalViews||{};
      if(panel&&(t.dataset.horizontalChartPerson||t.dataset.horizontalOption||t.dataset.horizontalAction)){
        const id=t.closest("[data-horizontal-options-panel]")?.dataset.horizontalOptionsPanel||panel.dataset.horizontalChart,charts=copy(current.charts||{});charts[id] ||= {};
        if(t.dataset.horizontalChartPerson){const ids=[...panel.querySelectorAll("[data-horizontal-chart-person]:checked")].map(n=>n.dataset.horizontalChartPerson);if(!ids.length){t.checked=true;return;}charts[id].recordIds=ids;}
        else if(t.dataset.horizontalAction){const selected=[...panel.querySelectorAll("[data-horizontal-action]:checked")].map(n=>n.dataset.horizontalAction);charts[id].options={...charts[id].options,selected};}
        else charts[id].options={...charts[id].options,[t.dataset.horizontalOption]:t.type==="checkbox"?t.checked:t.value};
        onChange?.({charts});
      }else if(t.dataset.horizontalView){
        const key=t.dataset.horizontalView,reference=activeReference(model,current),[kind,...tail]=t.value.split(":"),value=tail.join(":");
        if(key==="focus"){const delta={focus:kind==="all"?{kind}:{kind,id:value}};if(kind==="reference"){delta.activeReferenceId=value;if(current.baseline?.kind==="reference")delta.baseline={...current.baseline,id:value};}onChange?.(delta);}
        else if(key==="baseline")onChange?.({baseline:kind==="none"?{kind}:kind==="reference"?{kind,id:reference.id,statistic:value}:{kind,id:value}});
        else if(key==="activeReferenceId"){const delta={activeReferenceId:t.value};if(current.baseline?.kind==="reference")delta.baseline={...current.baseline,id:t.value};if(current.focus?.kind==="reference")delta.focus={...current.focus,id:t.value};onChange?.(delta);}
        else onChange?.({[key]:t.value});
      }else if(t.dataset.horizontalPerson){const hidden=[...container.querySelectorAll("[data-horizontal-person]:not(:checked)")].map(n=>n.dataset.horizontalPerson);if(hidden.length===model.participants.length){t.checked=true;return;}onChange?.({hiddenParticipantIds:hidden});}
      else if(t.hasAttribute("data-horizontal-sample-metric")){const referenceId=t.closest("[data-horizontal-samples]").dataset.horizontalSamples;onChange?.({sampleMetrics:{...current.sampleMetrics,[referenceId]:t.value}});}
    };
    container.addEventListener("change",change);handlers.set(container,change);layout(container);
    if(typeof root.ResizeObserver!=="undefined"){let scheduled=false;observer=new root.ResizeObserver(()=>{if(!scheduled){scheduled=true;root.requestAnimationFrame(()=>{scheduled=false;if(container.isConnected)layout(container);});}});observer.observe(container);}
  }
  function preparePrint(container,model,views={}){
    // The clone already contains the frozen screen state. Rebuilding it here
    // would change the active group, chart choices and disclosure state.
    container.querySelectorAll("details:not([open])").forEach(node=>node.remove());
    container.querySelector("#directionMetrics")?.remove();container.querySelector("#radarLegend")?.closest(".card-foot")?.remove();
    if(model.participants?.length){container.querySelectorAll(".screen-layout").forEach(node=>node.classList.add("longitudinal-screen-layout"));container.querySelectorAll(".body-art").forEach(node=>node.classList.add("longitudinal-risk-chart"));}container.querySelectorAll(".horizontal-reference-heading").forEach(node=>node.classList.add("longitudinal-table-caption"));
    container.querySelectorAll(".no-print").forEach(node=>node.remove());layout(container,{print:true});
  }
  function prepareBrowserPrint(container,model,views={}){
    const clone=container.cloneNode(true);clone.removeAttribute("id");clone.removeAttribute("hidden");clone.className="report-view horizontal-browser-print";
    root.document.body.appendChild(clone);preparePrint(clone,model,views);root.document.body.classList.add("horizontal-print-active");
    let cleaned=false;return ()=>{if(cleaned)return;cleaned=true;clone.remove();root.document.body.classList.remove("horizontal-print-active");};
  }
  root.RingsideHorizontalView={render,layout,mount,table,bars,activeReference,preparePrint,prepareBrowserPrint,conditions};
})(typeof window!=="undefined"?window:globalThis);
