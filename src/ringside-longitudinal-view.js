(function (root) {
  "use strict";
  const N = value => root.Calc.num(value), E = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const F = (value, digits = 2) => N(value) === null ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
  const coordinate = value => Number(value).toFixed(2);
  const C = { ink:"#263747", grid:"#dbe2e8", muted:"#667684", blue:"#7895ad", green:"#176b68", red:"#bd514b", amber:"#ac7a21" };
  const FONT = "Microsoft YaHei,Segoe UI,sans-serif";
  const text = (x,y,value,attrs="") => `<text x="${coordinate(x)}" y="${coordinate(y)}" font-family="${FONT}" font-size="11" fill="${C.ink}" ${attrs}>${E(value)}</text>`;
  const line = (x1,y1,x2,y2,attrs="") => `<line x1="${coordinate(x1)}" y1="${coordinate(y1)}" x2="${coordinate(x2)}" y2="${coordinate(y2)}" stroke="${C.grid}" ${attrs}/>`;
  const dot = (x,y,color,tip,r=3.7,attrs="") => `<circle cx="${coordinate(x)}" cy="${coordinate(y)}" r="${r}" fill="${color}" stroke="white" stroke-width="1.3" ${attrs}><title>${E(tip)}</title></circle>`;
  const markerPoint = (x,y,color,tip,shape,r=4) => shape==="diamond"?`<path d="M${x} ${y-r} L${x+r} ${y} L${x} ${y+r} L${x-r} ${y}Z" fill="${color}" stroke="white"><title>${E(tip)}</title></path>`:shape==="triangle"?`<path d="M${x} ${y-r} L${x+r} ${y+r} L${x-r} ${y+r}Z" fill="${color}" stroke="white"><title>${E(tip)}</title></path>`:dot(x,y,color,tip,r);
  const points = list => list.map(point => point.map(v => Number(v).toFixed(2)).join(",")).join(" ");
  const polyline = (list,color,attrs="") => list.length > 1 ? `<polyline points="${points(list)}" fill="none" stroke="${color}" stroke-width="1.8" ${attrs}/>` : "";
  const svg = (w,h,title,body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${E(title)}" data-pixel-layout="true"><title>${E(title)}</title>${body}</svg>`;
  const chunks = (items, count, overlap = false) => { const result=[]; for(let i=0;i<items.length;i+=Math.max(1,count-(overlap?1:0))){ result.push(items.slice(i,i+count)); if(i+count>=items.length)break; } return result; };
  const range = (values, zero=true) => { const list=values.map(N).filter(v=>v!==null); let min=zero?Math.min(0,...list):Math.min(...list),max=Math.max(zero?0:-Infinity,...list); if(!list.length)return{min:0,max:1}; if(max===min){min=zero?Math.min(0,min):min-Math.max(1,Math.abs(min)*.1);max+=Math.max(1,Math.abs(max)*.1);} const span=max-min;return{min:min<0?min-span*.08:min,max:max+span*.13}; };
  const periodLabel = period => period.label || period.date || period.id;
  const periodIds = periods => periods.map(p=>p.id || p.recordId);
  const dateStyles = (series,periods) => series.map(s=>{const index=periods.findIndex(p=>p.id===s.recordId||p.id===s.id||String(s.id).startsWith(p.id+":")),cycle=Math.floor(Math.max(0,index)/8),pattern=["","12 3","2 3","12 3 2 3"][cycle%4];return cycle?{...s,dateDash:pattern,dash:[pattern,s.dash].filter(Boolean).join(" ")}:s;});
  const swatch = series => {const color=series.color||C.blue,segments=String(series.dash||"").split(/\s+/).map(Number).filter(n=>n>0),stops=[];let offset=0,index=0;while(segments.length&&offset<28){const ink=index%2?"transparent":color;stops.push(ink+" "+offset+"px");offset+=segments[index%segments.length];stops.push(ink+" "+offset+"px");index++;}return `<i aria-hidden="true" style="width:28px;height:2px;border:0;border-radius:0;flex-shrink:0;background:${E(stops.length?'linear-gradient(to right,'+stops.join(',')+')':color)}"></i>`;};
  const legend = periods => `<div class="longitudinal-legend">${periods.map(p=>`<span>${swatch(p)}${E(periodLabel(p))}</span>`).join("")}</div>`;
  const empty = message => `<p class="longitudinal-empty">${E(message || "暂无可绘制的结果")}</p>`;
  const printPanel = (html,print) => print?`<div class="longitudinal-print-panel">${html}</div>`:html;
  function pathsWithGaps(list, color, attrs="") { let out="", run=[]; for(const point of [...list,null]){if(point)run.push(point);else{out+=polyline(run,color,attrs);run=[];}}return out; }
  function axis(w,h,{xRange,yRange,rightRange,xLabel,yLabel,rightLabel,top=w<380&&rightRange?58:43,bottom=h-65,left=56,right=w-(rightRange?56:20)}) {
    const x = value => left+(value-xRange.min)/(xRange.max-xRange.min)*(right-left), y = value => bottom-(value-yRange.min)/(yRange.max-yRange.min)*(bottom-top);
    const y2 = value => bottom-(value-rightRange.min)/(rightRange.max-rightRange.min)*(bottom-top);
    let out=text(left,20,yLabel)+text((left+right)/2,h-17,xLabel,'text-anchor="middle"');
    for(let i=0;i<=4;i++){const value=yRange.min+(yRange.max-yRange.min)*i/4;out+=line(left,y(value),right,y(value))+text(left-8,y(value)+4,F(value,1),'text-anchor="end"');}
    for(let i=0;i<=4;i++){const value=xRange.min+(xRange.max-xRange.min)*i/4;out+=text(x(value),bottom+21,F(value,2),'text-anchor="middle"');}
    if(rightRange){out+=text(right,w<380?36:20,rightLabel,'text-anchor="end"');for(let i=0;i<=4;i++){const value=rightRange.min+(rightRange.max-rightRange.min)*i/4;out+=text(right+7,y2(value)+4,F(value,1));}}
    out+=line(left,bottom,right,bottom,`stroke="${C.muted}"`);return{out,x,y,y2,left,right,top,bottom};
  }
  function xy(spec, width, print) {
    const w=Math.max(250,Math.round(width)), h=print?290:330, series=spec.series || [], all=spec.scaleSeries || series;
    const axisValues=right=>all.filter(s=>!!s.right===right).flatMap(s=>s.points.map(p=>p?.y).concat((s.band||[]).flatMap(p=>[p.low,p.high])));
    const xr=spec.xRange || range(all.flatMap(s=>s.points.map(p=>p?.x)),spec.zeroX!==false),yr=spec.yRange || range(axisValues(false).concat((spec.scaleHorizontalMarkers||spec.horizontalMarkers||[]).map(m=>m.y)),spec.zeroY!==false);
    const secondary=all.some(s=>s.right),rr=secondary?spec.rightRange || range(axisValues(true),spec.zeroRight!==false):null;
    const a=axis(w,h,{xRange:xr,yRange:yr,rightRange:rr,xLabel:spec.xLabel,yLabel:spec.yLabel,rightLabel:spec.rightLabel});let out=a.out;
    for(const s of series){const color=s.color || C.blue,scale=s.right?a.y2:a.y;
      if(s.band?.length){const band=s.band.filter(p=>[p.x,p.low,p.high].every(v=>N(v)!==null));out+=`<polygon points="${points(band.map(p=>[a.x(p.x),scale(p.high)]).concat(band.slice().reverse().map(p=>[a.x(p.x),scale(p.low)])))}" fill="${color}" fill-opacity=".08"><title>${E(s.label+" · 原剖面拟合区间")}</title></polygon>`;}
      const list=s.points.map(p=>p&&N(p.x)!==null&&N(p.y)!==null?[a.x(p.x),scale(p.y)]:null);
      if(s.connect!==false){
        if(s.points.some(p=>p?.derived))for(let i=1;i<list.length;i++){if(list[i-1]&&list[i])out+=polyline([list[i-1],list[i]],color,`${s.points[i-1]?.derived||s.points[i]?.derived?'stroke-dasharray="5 4"':""} data-longitudinal-series="${E(s.id || s.label)}"`);}
        else out+=pathsWithGaps(list,color,`${s.dash?'stroke-dasharray="'+E(s.dash)+'"':""} data-longitudinal-series="${E(s.id || s.label)}"`);
      }
      if(s.pointsVisible!==false)s.points.forEach((p,i)=>{if(list[i])out+=markerPoint(...list[i],color,`${s.label} · ${spec.xLabel} ${F(p.x)} · ${s.right?spec.rightLabel:spec.yLabel} ${F(p.y)}${p.note?" · "+p.note:""}`,p.shape||s.shape||(p.derived?"diamond":"circle"),s.connect===false?4:3);});
    }
    for(const marker of spec.markers || [])if(N(marker.x)!==null&&marker.x>=xr.min&&marker.x<=xr.max){out+=line(a.x(marker.x),a.top,a.x(marker.x),a.bottom,`stroke="${marker.color || C.muted}" stroke-dasharray="4 4"`)+text(a.x(marker.x)+3,a.top+12,E(marker.label),'font-size="9"');}
    for(const marker of spec.horizontalMarkers || [])if(N(marker.y)!==null){out+=line(a.left,a.y(marker.y),a.right,a.y(marker.y),`stroke="${marker.color || C.muted}" stroke-dasharray="6 4"`)+text(a.right,a.y(marker.y)-6,marker.label,'text-anchor="end" font-size="9"');}
    const key=`<div class="longitudinal-curve-key">${series.map(s=>`<span>${swatch(s)}${E(s.label)}</span>`).join("")}</div>`;
    return svg(w,h,spec.title,out)+key+(spec.note?`<p class="longitudinal-chart-note">${E(spec.note)}</p>`:"");
  }
  function radar(spec,width,print) {
    const axes=spec.axes || [], series=spec.series || [], w=Math.max(250,Math.round(width)), count=axes.length;
    if(!count)return empty("尚无已测维度");
    const h=count>12?(print?440:500):count>8?(print?370:410):print?295:330, cx=w/2,cy=h/2-5,r=Math.max(35,Math.min(w/2-(count>10?70:65),h/2-52)),max=spec.max || 100;
    const polar=(index,value)=>{const a=-Math.PI/2+index*2*Math.PI/Math.max(3,count);return[cx+Math.cos(a)*r*value/max,cy+Math.sin(a)*r*value/max];};
    if(count<=2){
      let out=""; const left=40,right=w-30,spread=Math.max(12,series.length*5),rowHeight=Math.max(100,spread*2+65);
      axes.forEach((a,i)=>{const y=40+spread+i*rowHeight;out+=text(left,y-spread-15,a.label);if(spec.risk)for(const [score,color]of[[1,"#f5dcd9"],[2,"#f8edcf"],[3,"#e9f1ec"]])out+=`<rect x="${left+(score-1)/3*(right-left)}" y="${y-spread-6}" width="${(right-left)/3}" height="${spread*2+12}" fill="${color}"/>`;for(let tick=0;tick<=max;tick+=max===3?1:25){const x=left+tick/max*(right-left);out+=line(x,y-8,x,y+8)+text(x,y+spread+24,tick,'text-anchor="middle"');}out+=line(left,y,right,y,`stroke="${C.muted}"`);series.forEach((s,j)=>{const value=N(s.values[i]);if(value!==null)out+=dot(left+value/max*(right-left),y+(j-(series.length-1)/2)*10,s.color,`${s.label} · ${a.label} ${F(value)} / ${max}`,4.5);});});
      return svg(w,count*rowHeight+25,spec.title,out)+legend(series)+(spec.risk?'<p class="longitudinal-chart-note">1 预警 · 2 关注 · 3 达标</p>':"");
    }
    let out="";
    if(spec.risk){for(const [value,color]of[[3,"#e9f1ec"],[2,"#f8edcf"],[1,"#f5dcd9"]])out+=`<polygon points="${points(axes.map((_,i)=>polar(i,value)))}" fill="${color}" stroke="white"/>`;}
    for(const value of max===3?[1,2,3]:[25,50,75,100])out+=`<polygon points="${points(axes.map((_,i)=>polar(i,value)))}" fill="none" stroke="${C.grid}"/>`+text(cx+5,cy-r*value/max+10,value,'font-size="9"');
    axes.forEach((a,i)=>{const edge=polar(i,max);out+=line(cx,cy,...edge);const p=polar(i,max*(1+22/r)),anchor=p[0]<cx-8?"end":p[0]>cx+8?"start":"middle",label=Array.from(String(a.label||a.key)),font=count>10?10:11,room=anchor==="end"?p[0]-6:anchor==="start"?w-p[0]-6:2*Math.min(p[0]-6,w-p[0]-6),length=Math.max(1,Math.floor(room/font)),parts=chunks(label,length).map(part=>part.join(""));parts.forEach((part,j)=>out+=text(p[0],p[1]+(j-(parts.length-1)/2)*14,part,`text-anchor="${anchor}" style="font-size:${font}px" data-longitudinal-axis-label="${E(a.key||a.id||i)}"`));});
    for(const s of series){const list=axes.map((_,i)=>N(s.values[i])===null?null:polar(i,s.values[i]));if(list.every(Boolean))out+=`<polygon points="${points(list)}" fill="${s.color}" fill-opacity=".035" stroke="${s.color}" stroke-width="1.8"${s.dash?' stroke-dasharray="'+s.dash+'"':""}/>`;else out+=pathsWithGaps([...list,list[0]],s.color,s.dash?'stroke-dasharray="'+s.dash+'"':"");list.forEach((p,i)=>{if(p)out+=dot(...p,s.color,`${s.label} · ${axes[i].label} ${F(s.values[i])} / ${max}${s.cells?.[i]?.pain?" · 疼痛":""}`,3.6);});}
    return svg(w,h,spec.title,out)+legend(series)+(spec.risk?'<p class="longitudinal-chart-note">1 预警 · 2 关注 · 3 达标</p>':spec.fms?'<p class="longitudinal-chart-note">0 疼痛 · 1 未完成 · 2 代偿完成 · 3 无代偿完成</p>':"");
  }
  function columns(spec,width,print) {
    const w=Math.max(250,Math.round(width)),h=(print?285:330)+(spec.grouped?30:0),left=48,right=w-(spec.rsi?48:20),top=40,bottom=h-(spec.grouped?104:74),periods=spec.periods,values=spec.values,all=spec.scaleValues || values;
    const yr=range(all.map(v=>v?.value).concat(all.map(v=>v?.target)),true), rr=spec.rsi?range(all.map(v=>v?.rsi),true):null,y=v=>bottom-(v-yr.min)/(yr.max-yr.min)*(bottom-top),y2=v=>bottom-v/rr.max*(bottom-top),slot=(right-left)/periods.length,x=i=>left+slot*(i+.5),bw=Math.min(42,slot*.5);
    let out=text(left,18,spec.unit || "结果");for(let i=0;i<=4;i++){const v=yr.min+(yr.max-yr.min)*i/4;out+=line(left,y(v),right,y(v))+text(left-7,y(v)+4,F(v,1),'text-anchor="end"');if(rr)out+=text(right+6,y2(rr.max*i/4)+4,F(rr.max*i/4,2),'fill="'+C.green+'"');}
    if(rr)out+=text(right,18,"RSI · m/s",'text-anchor="end" fill="'+C.green+'"');
    // A mismatch breaks only its incoming segment; subsequent comparable results still join.
    for(let i=1;i<values.length;i++)if(values[i]?.groupId===values[i-1]?.groupId&&values[i]?.comparableToPrevious!==false&&N(values[i-1]?.value)!==null&&N(values[i]?.value)!==null)out+=line(x(i-1),y(values[i-1].value),x(i),y(values[i].value),`stroke="${C.blue}" stroke-width="1.6" data-observed-change="result"`);
    if(rr)for(let i=1;i<values.length;i++)if(values[i]?.groupId===values[i-1]?.groupId&&values[i]?.rsiComparableToPrevious!==false&&N(values[i-1]?.rsi)!==null&&N(values[i]?.rsi)!==null)out+=line(x(i-1),y2(values[i-1].rsi),x(i),y2(values[i].rsi),`stroke="${C.green}" stroke-width="1.6" data-observed-change="rsi"`);
    values.forEach((value,i)=>{const v=N(value?.value),date=periods[i].date || periodLabel(periods[i]),resultY=v===null?null:v>=0?y(v)-9:y(v)+16;if(v!==null){out+=`<rect x="${x(i)-bw/2}" y="${Math.min(y(v),y(0))}" width="${bw}" height="${Math.abs(y(v)-y(0))}" rx="3" fill="${C.blue}" data-record-id="${E(periods[i].id)}"><title>${E(periodLabel(periods[i])+" · "+spec.title+" "+F(v)+" "+spec.unit)}</title></rect>`+text(x(i),resultY,F(v,1),'text-anchor="middle" data-result-label="'+i+'"');}else out+=text(x(i),bottom-10,"—",'text-anchor="middle"');
      if(rr&&N(value?.rsi)!==null){let labelY=y2(value.rsi)+18;if(resultY!==null&&Math.abs(labelY-resultY)<18)labelY=resultY+(labelY>=resultY?18:-18);out+=dot(x(i),y2(value.rsi),C.green,`${periodLabel(periods[i])} · RSI ${F(value.rsi)} m/s`,5)+text(x(i),labelY,F(value.rsi),'text-anchor="middle" fill="'+C.green+'" data-rsi-label="'+i+'"');}
      if(N(value?.target)!==null)out+=line(x(i)-bw,y(value.target),x(i)+bw,y(value.target),`stroke="${C.muted}" stroke-dasharray="4 3"`);
      out+=text(x(i),bottom+20,String(date).slice(0,4),'text-anchor="middle" font-size="10"')+text(x(i),bottom+36,String(date).slice(5),'text-anchor="middle" font-size="11"');if(periods[i].label&&periods[i].label!==periods[i].date)out+=text(x(i),bottom+51,"#"+String(periods[i].id).slice(-4),'text-anchor="middle" font-size="9"');
    });
    if(spec.grouped){let start=0;while(start<values.length){let end=start+1;while(end<values.length&&values[end]?.groupId===values[start]?.groupId)end++;if(start)out+=line(left+slot*start,top,left+slot*start,bottom,'stroke-dasharray="3 5"');out+=text((x(start)+x(end-1))/2,bottom+75,values[start]?.groupLabel||values[start]?.groupId,'text-anchor="middle" font-size="11"');start=end;}}
    return svg(w,h,spec.title,out)+`<p class="longitudinal-chart-note">${E(spec.title)}${rr?" · 柱：高度（左轴）；点：RSI（右轴）":""} · 连线为相邻实测变化</p>`;
  }
  function bars(spec,width,print) {
    const w=Math.max(250,Math.round(width)),row=spec.grouped?(print?64:70):print?47:52,h=63+spec.periods.length*row,left=94,right=w-48,bottom=h-35,all=spec.scaleValues || spec.values,xr=range(all.flatMap(v=>[v?.value,v?.target,v?.asrEnd]),true),x=v=>left+(v-xr.min)/(xr.max-xr.min)*(right-left);let out="";
    for(let i=0;i<=4;i++){const v=xr.min+(xr.max-xr.min)*i/4;out+=line(x(v),15,x(v),bottom)+text(x(v),bottom+21,F(v,1),'text-anchor="middle"');}
    spec.values.forEach((cell,i)=>{const y=(spec.grouped?43:28)+i*row,v=N(cell?.value),p=spec.periods[i];if(spec.grouped&&(i===0||cell?.groupId!==spec.values[i-1]?.groupId))out+=text(4,y-22,cell?.groupLabel||cell?.groupId,'font-size="10" font-weight="600"');out+=text(4,y-2,p.date || p.label,'font-size="10"');if(p.label&&p.label!==p.date)out+=text(4,y+12,"#"+p.id.slice(-4),'font-size="9"');if(v!==null){out+=`<rect x="${Math.min(x(0),x(v))}" y="${y-11}" width="${Math.abs(x(v)-x(0))}" height="20" rx="3" fill="${C.blue}"/><title>${E(periodLabel(p)+" · "+(cell?.groupLabel||spec.title)+" "+F(v))}</title>`+text(right+4,y+4,F(v));if(i&&cell?.groupId===spec.values[i-1]?.groupId&&cell.comparableToPrevious!==false&&N(spec.values[i-1]?.value)!==null)out+=line(x(spec.values[i-1].value),y-row,x(v),y,`stroke="${C.blue}" stroke-width="1.8" data-observed-change="result"`);}else out+=text(left+8,y+4,"—");if(N(cell?.target)!==null)out+=line(x(cell.target),y-15,x(cell.target),y+15,`stroke="${C.muted}" stroke-dasharray="4 3"`);if(N(cell?.asrEnd)!==null&&v!==null&&cell.asrEnd>=v)out+=`<rect x="${x(v)}" y="${y-11}" width="${x(cell.asrEnd)-x(v)}" height="20" fill="none" stroke="${C.muted}" stroke-dasharray="4 3"/>`+text(x(v),y+28,"ASR "+F(cell.asrEnd-v)+" m/s",'font-size="9"');});
    return svg(w,h,spec.title,out)+`<p class="longitudinal-chart-note">${E(spec.title+" · "+(spec.unit||""))} · 连线为相邻实测变化</p>`;
  }
  function draw(spec,width=450,print=false) {
    const title=spec.showTitle===false?"":`<p class="longitudinal-chart-title">${E(spec.title)}</p>`;
    if(spec.kind==="radar")return title+(print?chunks(spec.series,4,true):[spec.series]).map(series=>printPanel(radar({...spec,series},width,print),print)).join("");
    if(["columns","bars"].includes(spec.kind)){
      const capacity=spec.kind==="columns"?Math.max(2,Math.floor((width-(spec.rsi?96:68))/56)):5,items=spec.periods.map((p,i)=>({p,v:spec.values[i]})),groups=print?chunks(items,capacity,true):[items];
      const chartWidth=!print&&spec.kind==="columns"?Math.max(width,(spec.rsi?96:68)+spec.periods.length*56):width;
      const content=groups.map(group=>printPanel(spec.kind==="columns"?columns({...spec,periods:group.map(x=>x.p),values:group.map(x=>x.v),scaleValues:spec.values},chartWidth,print):bars({...spec,periods:group.map(x=>x.p),values:group.map(x=>x.v),scaleValues:spec.values},chartWidth,print),print)).join("");
      return title+(!print&&chartWidth>width?`<div class="longitudinal-chart-scroll"><div style="width:${chartWidth}px">${content}</div></div>`:content);
    }
    if(spec.kind==="lvp"){
      const all=spec.series,loads=all.flatMap(s=>s.points.map(p=>p.load)),velocities=all.flatMap(s=>s.points.map(p=>p.velocity)),bandHigh=[];
      for(const s of all){const fit=s.fit;if(fit?.b<0&&fit.a>0)loads.push(-fit.a/fit.b);if(N(s.est?.load)!==null)loads.push(s.est.load);if(fit?.a>0)velocities.push(fit.a);if(fit?.n>=3&&fit.sxx>0&&N(fit.s)!==null){const min=Math.min(...s.points.map(p=>p.load)),max=Math.max(...s.points.map(p=>p.load));for(let i=0;i<=48;i++){const load=min+(max-min)*i/48;bandHigh.push((fit.a+fit.b*load+(fit.tcrit || 2)*fit.s*Math.sqrt(1/fit.n+(load-fit.meanX)**2/fit.sxx))*1.06);}}}
      const axisMax={load:Math.max(5,...loads)*1.065,velocity:Math.max(Math.max(.4,...velocities)*1.13,...bandHigh)};
      return title+(print?chunks(all,4,true):[all]).map(series=>printPanel(root.RingsideViz.lvp(series,{...spec.options,axisMax},{width,height:Math.max(print?310:360,280+Math.ceil(series.length/(width>=440?2:1))*24),print}),print)).join("");
    }
    if(spec.kind==="xy"){const ids=[...new Set(spec.series.map(s=>s.recordId).concat((spec.horizontalMarkers||[]).map(m=>m.recordId)))];return title+(print?chunks(ids,spec.rich?2:4,true):[ids]).map(group=>printPanel(xy({...spec,series:spec.series.filter(s=>group.includes(s.recordId)),scaleSeries:spec.series,scaleHorizontalMarkers:spec.horizontalMarkers,markers:(spec.markers||[]).filter(m=>!m.recordId||group.includes(m.recordId)),horizontalMarkers:(spec.horizontalMarkers||[]).filter(m=>!m.recordId||group.includes(m.recordId))},width,print),print)).join("");}
    return empty(spec.reason);
  }
  function figure(spec) { return spec.kind==="notice"?empty(spec.reason):`<div class="chart-wrap longitudinal-chart" data-longitudinal-chart="${E(JSON.stringify(spec))}">${draw(spec)}</div>`; }
  function resultPrecision(row) {
    if(N(row.digits)!==null)return row.digits;
    if(row.measurementScale==="ordinal")return 0;
    const id=row.metricId||row.id||"";
    if(/^lvp-fit:.*:slope$/.test(id))return 4;
    if(/^lvp-fit:.*:(intercept|r2)$/.test(id))return 3;
    if(/fvp|elasticity/.test(id)&&/(?:_|:)(?:v0|V0|slope|r2|Fe|fe|ve|ER|er|EN|en|Vmax|Vopt|endVelocity|timeS)$/.test(id))return 3;
    return 2;
  }
  function changeNumber(value,digits=2) {
    if(N(value)===null)return "";
    const magnitude=Math.abs(value);if(magnitude&&magnitude<.000001)return Number(value.toPrecision(2)).toExponential();
    return F(value,magnitude?Math.min(6,Math.max(digits,Math.ceil(-Math.log10(magnitude))+1)):digits);
  }
  function changeText(change,row) {
    if(!change?.available)return "";
    if(change.kind==="ordinal")return `${F(change.from?.value,0)} → ${F(change.to?.value,0)}`;
    const delta=N(change.delta),signed=delta>0?"+":"",unit=change.kind==="percentage-point"?"百分点":row.unit;
    return `<span class="longitudinal-change ${E(change.improvement || "")}">${signed}${changeNumber(delta,resultPrecision(row))} ${E(unit || "")}${N(change.percent)!==null?`<small>${change.percent>0?"+":""}${changeNumber(change.percent)}%</small>`:""}</span>`;
  }
  function cellHTML(cell,row) {
    if(!cell||N(cell.value)===null)return '<span class="longitudinal-unavailable">—</span>';
    const stat=cell.statistics,rawLabel=cell.evaluation?.grade?.label || cell.evaluation?.label,evalLabel=["未启用评价标准","未设等级区间","未启用标准"].includes(rawLabel)?"":rawLabel,notes=Array.isArray(cell.notes)?cell.notes.join("；"):cell.notes;
    return `<strong>${F(cell.value,resultPrecision(row))}${cell.unit&&cell.unit!==row.unit?" "+E(cell.unit):""}</strong>${stat?.n>=3?`<small>${F(stat.mean,resultPrecision(row))} ± ${F(stat.sd,resultPrecision(row))}${N(stat.cv)!==null?" · CV "+F(stat.cv)+"%":""}</small>`:""}${evalLabel?`<small>${E(evalLabel)}</small>`:""}${cell.pain?'<small class="red">疼痛</small>':""}${notes?`<small>${E(notes)}</small>`:""}`;
  }
  function table(rows,periods,{print=false,wrapped=true}={}) {
    if(!rows.length)return "";
    rows=rows.flatMap(row=>{
      const keys=[...new Set(row.cells.filter(Boolean).map(cell=>cell.contextKey).filter(Boolean))];if(keys.length<2)return[row];
      const flatten=(object,prefix="",result={})=>{for(const [key,value]of Object.entries(object||{})){const field=prefix?prefix+"."+key:key;if(value&&typeof value==="object"&&!Array.isArray(value))flatten(value,field,result);else result[field]=Array.isArray(value)?JSON.stringify(value):String(value??"");}return result;};
      const contexts=keys.map(key=>flatten(row.cells.find(cell=>cell?.contextKey===key)?.context||{})),fields=[...new Set(contexts.flatMap(c=>Object.keys(c)))].filter(field=>new Set(contexts.map(c=>c[field])).size>1&&!/(^|\.)id$/.test(field));
      const labels={protocol:"协议",method:"方法",metric:"速度口径",velocity:"速度口径",velocityMetrics:"速度口径",definition:"结果定义",unit:"单位",minimumVelocity:"MVT",thresholdMethod:"阈值方法",dropHeights:"落高",distanceCm:"蹬伸距离",angle:"角度",targetDistanceM:"目标距离",deltaForcePct:"F₀ 改变",deltaVelocityPct:"V₀ 改变",protocols:"测试流程",version:"协议版本"};
      return keys.map((key,index)=>{const context=contexts[index],details=fields.map(field=>{const value=context[field];if(!value)return"";const name=field.split(".").at(-1);return(labels[name]||name)+" "+value.replace(/\"(?:id|metric|inputMode|selectionBasis)\":/g,"").replace(/[\[\]{}\"]/g,"");}).filter(Boolean);if(!details.length){const version=Object.entries(context).find(([field])=>/protocolIdentity\.version$/.test(field));if(version)details.push("协议版本 "+version[1]);}
        const cells=row.cells.map(cell=>cell?.contextKey===key?cell:null),available=change=>change?.available&&cells[periods.findIndex(p=>p.id===change.from?.recordId)]&&cells[periods.findIndex(p=>p.id===change.to?.recordId)];
        return{...row,id:row.id+":context:"+index,name:row.name+" · 口径 "+(index+1)+(details.length?"（"+details.join("；")+"）":""),cells,changes:{overall:available(row.changes?.overall)?row.changes.overall:{available:false},recent:available(row.changes?.recent)?row.changes.recent:{available:false}}};
      });
    });
    const changeColumns=[["overall","首末变化"],...(periods.length>2?[["recent","近期变化"]]:[])].filter(([key])=>rows.some(row=>row.changes?.[key]?.available));
    const html=chunks(periods.map((p,i)=>({p,i})),print?(changeColumns.length>1?3:4):periods.length).map((group,index,groups)=>{
      const changes=index===groups.length-1?changeColumns:[],headers=["指标",...group.map(x=>periodLabel(x.p)),...changes.map(([,label])=>label)];
      return `${groups.length>1?`<p class="longitudinal-table-caption">${E(periodLabel(group[0].p))} — ${E(periodLabel(group.at(-1).p))}</p>`:""}<div class="table-wrap"><table class="longitudinal-results"${print?"":` style="min-width:${140+periods.length*105+changes.length*92}px"`}><thead><tr>${headers.map(h=>`<th scope="col">${E(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr data-metric-id="${E(row.id)}"><td data-label="指标">${E(row.name)}${row.unit?`<small>${E(row.unit)}</small>`:""}</td>${group.map(({p,i})=>`<td data-label="${E(periodLabel(p))}" data-record-id="${E(p.id)}">${cellHTML(row.cells[i],row)}</td>`).join("")}${changes.map(([key,label])=>`<td data-label="${E(label)}">${changeText(row.changes?.[key],row)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }).join("");
    if(!wrapped)return html;
    const compactRows=rows.map(row=>({id:row.id,name:row.name,unit:row.unit,digits:resultPrecision(row),measurementScale:row.measurementScale,changes:row.changes,cells:row.cells.map(cell=>cell?{value:cell.value,unit:cell.unit,statistics:cell.statistics,notes:cell.notes,pain:cell.pain,evaluation:cell.evaluation?{label:cell.evaluation.label,grade:cell.evaluation.grade}:null}:null)}));
    return `<div class="longitudinal-table" data-longitudinal-table="${E(JSON.stringify({rows:compactRows,periods:periods.map(p=>({id:p.id,date:p.date,label:p.label}))}))}">${html}</div>`;
  }
  function extractDetails(html,testIds,period) {
    let result="",re=/<details\b[^>]*data-raw-trials="([^"]+)"[^>]*>/g,match;
    while((match=re.exec(html))){if(!testIds.includes(match[1]))continue;const start=match.index,tag=/<\/?details\b[^>]*>/g;tag.lastIndex=re.lastIndex;let depth=1,end=re.lastIndex,next;while(depth&&(next=tag.exec(html))){depth+=next[0].startsWith("</")?-1:1;end=tag.lastIndex;}if(depth)continue;let block=html.slice(start,end);block=block.replace(/\sid="([^"]*)"/g,(_,id)=>` id="long-${E(period.id)}-${id}"`).replace(/data-trial-title="([^"]*)"/,(_,title)=>`data-trial-title="${E(periodLabel(period))} · ${title}"`).replace(/(<summary[^>]*>)/,`$1${E(periodLabel(period))} · `);result+=block;re.lastIndex=end;}return result;
  }
  function fmsRaw(period) {
    const list=period.record.data.fms || [];if(!period.record.enabled.fms)return "";return `<details class="attempt-details" data-raw-trials="fms" data-trial-title="${E(periodLabel(period))} · FMS 原始记录"><summary>${E(periodLabel(period))} · FMS 原始记录</summary><div class="table-wrap"><table><thead><tr><th>动作</th><th>左／右或单项</th><th>疼痛</th><th>备注</th></tr></thead><tbody>${list.map(item=>`<tr><td>${E(item.name)}</td><td>${item.bilateral?F(item.left,0)+" / "+F(item.right,0):F(item.score,0)}</td><td>${item.pain||(!item.bilateral&&N(item.score)===0)||(item.bilateral&&[N(item.left),N(item.right)].includes(0))?"疼痛":"—"}</td><td>${E(item.notes || "—")}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
  const rowSpec = (row,periods,kind="columns",extra={}) => ({kind,title:row.name,unit:row.unit,periods:periods.map(p=>({id:p.id,date:p.date,label:p.label,color:p.color})),values:row.cells.map(c=>c?{value:c.value,target:c.evaluation?.target,comparableToPrevious:c.comparableToPrevious}:null),...extra});
  function xySeries(period,label,points,extra={}) {return{id:period.id+":"+label,recordId:period.id,label:periodLabel(period)+" · "+label,color:period.color || C.blue,points,...extra};}
  function fvpSpec(periods,id) {
    const series=[];for(const p of periods){const solved=id==="sprint_fvp"?p.stats.sprintFvp:p.stats.fvp?.[id];if(!solved?.valid)continue;const view=id==="sprint_fvp"?p.record.sprintFvpView:p.record.fvpView?.[id] || {},profiles=[{profile:solved.current || solved.model,label:"实测剖面"},{profile:solved.optimum || solved.optimal,label:"最优剖面",dash:"7 4"},...(id!=="sprint_fvp"&&view.comparison?[{profile:solved.comparison,label:"角度参照",dash:"2 4"}]:[])];for(const {profile,label,dash} of profiles){if(!profile||N(profile.F0)===null||N(profile.V0)===null||label==="最优剖面"&&view.optimum===false)continue;const sampled=Array.from({length:61},(_,i)=>{const x=profile.V0*i/60,y=profile.F0*(1-x/profile.V0);return{x,y};});if(view.fv!==false)series.push(xySeries(p,label+" F–V",sampled,{dash,pointsVisible:false}));if(view.pv!==false)series.push(xySeries(p,label+" P–V",sampled.map(q=>({x:q.x,y:q.x*q.y})),{right:true,dash:dash||"3 2",pointsVisible:false}));}
      if(id!=="sprint_fvp"&&view.points!==false){const measured=(solved.points||[]).map(q=>({x:q.velocity,y:q.forceRelative??q.force,note:"负荷 "+F(q.load)+" kg"}));if(view.fv!==false)series.push(xySeries(p,"实测负荷点 F–V",measured,{connect:false}));if(view.pv!==false)series.push(xySeries(p,"实测负荷点 P–V",measured.map(q=>({...q,y:q.x*q.y})),{connect:false,right:true,shape:"diamond"}));}
      let band=[];
      if(view.confidence!==false&&id!=="sprint_fvp"&&typeof solved.ci==="function"&&solved.points?.length){const xs=solved.points.map(q=>q.velocity),a=Math.min(...xs),b=Math.max(...xs);band=Array.from({length:31},(_,i)=>solved.ci(a+(b-a)*i/30)).filter(q=>q&&N(q.low)!==null);}
      if(id==="sprint_fvp"&&view.confidence===true&&p.report.sprintFvpConfidence?.available)band=p.report.sprintFvpConfidence.band;
      for(const kind of["F–V","P–V"]){const target=series.find(s=>s.recordId===p.id&&s.label.endsWith("实测剖面 "+kind));if(target&&band.length)target.band=band.map(q=>({x:q.x,low:kind==="F–V"?q.low:q.powerLow??q.x*q.low,high:kind==="F–V"?q.high:q.powerHigh??q.x*q.high}));}
      const current=solved.current || solved.model;if(view.pv!==false&&N(current?.Pmax)!==null)series.push(xySeries(p,"Pmax · V₀/2",[{x:current.V0/2,y:current.Pmax}],{right:true,connect:false,shape:"triangle"}));
    }
    const powerOnly=series.length>0&&series.every(s=>s.right);if(powerOnly)series.forEach(s=>s.right=false);
    return{kind:"xy",section:"profile",rich:true,title:id==="sprint_fvp"?"冲刺FVP":"跳跃FVP · "+(id==="fvp_cmj"?"CMJ":"SJ"),xLabel:"速度 V · m/s",yLabel:powerOnly?"功率 P · W/kg":"力 F · N/kg",rightLabel:"功率 P · W/kg",series};
  }
  function elasticitySpec(periods,id) {
    const series=[],sprint=id==="sprint_fvp",latest=periods.at(-1).record,view=sprint?latest.sprintFvpView || {}:latest.fvpView?.[id] || {},kind=view.elasticityView;
    for(const p of periods){const solved=sprint?p.stats.sprintElasticity:p.stats.fvp?.[id];if(!solved?.valid)continue;
      if(sprint&&kind==="distance"){
        const data=solved.constraint || {};
        for(const [key,label,right,dash]of[["Fe","Fₑ",false,""],["ve","vₑ",false,"5 3"],["EN","EN",false,"2 3"],["ER","ER",true,"7 3"]]){series.push(xySeries(p,label,(data.points||[]).filter(q=>q.valid!==false).map(q=>({x:q.distanceM,y:q[key]})).sort((a,b)=>a.x-b.x),{right,dash,pointsVisible:false}));if(N(data.current?.[key])!==null)series.push(xySeries(p,"当前目标 · "+label,[{x:data.current.distanceM,y:data.current[key]}],{right,connect:false}));}
        for(const [key,label,metric,shape]of[["valley","EN 最低点","EN","diamond"],["balance","ER = 1","ER","triangle"]])if(data[key]?.valid!==false&&N(data[key]?.[metric])!==null)series.push(xySeries(p,label,[{x:data[key].distanceM,y:data[key][metric]}],{right:metric==="ER",connect:false,shape}));
      }
      else if(!sprint&&kind==="constraint"){
        const data=solved.elasticityConstraint || {};series.push(xySeries(p,"固定高度 ER–EN",(data.points||[]).map(q=>({x:q.ER,y:q.EN})).sort((a,b)=>a.x-b.x),{pointsVisible:false}));
        for(const [key,label,shape]of[["current","当前剖面","circle"],["valley","EN 最低点","diamond"],["balance","ER = 1","triangle"]])if(N(data[key]?.ER)!==null&&N(data[key]?.EN)!==null)series.push(xySeries(p,label,[{x:data[key].ER,y:data[key].EN}],{connect:false,shape}));
      }
      else for(const [key,label,dash]of[["force","F₀ 改变",""],["velocity","V₀ 改变","5 3"],["both","F₀ 与 V₀ 同时改变","2 3"]]){if(view[{force:"responseForce",velocity:"responseVelocity",both:"responseBoth"}[key]]===false)continue;series.push(xySeries(p,label,(solved.sensitivity?.[key]||[]).map(q=>q.valid===false?null:{x:q.changePct,y:sprint?(q.timeGainPct??-q.deltaPct):q.deltaPct}),{dash,pointsVisible:false}));}}
    return{kind:"xy",section:"elasticity",rich:true,title:sprint?"冲刺FVP弹性框架":"跳跃FVP弹性框架 · "+(id==="fvp_cmj"?"CMJ":"SJ"),xLabel:kind==="distance"?"目标距离 · m":kind==="constraint"?"弹性比 ER":"参数改变 · %",yLabel:kind==="distance"?"Fₑ / vₑ / EN":kind==="constraint"?"弹性范数 EN":sprint?"预测冲刺时间改善 · %":"预测跳跃高度改变 · %",rightLabel:"ER",series};
  }
  function projectFigures(project,model,{specsOnly=false}={}) {
    const periods=model.periods,rows=project.metrics || [],id=project.id,kind=project.renderer,specs=[];
    if(kind==="fms"){specs.push({kind:"radar",title:"FMS 动作表现",max:3,fms:true,axes:root.RingsideTests.fmsAbilities.map((label,i)=>({key:String(i),label})),series:periods.map(p=>({id:p.id,label:periodLabel(p),color:p.color,values:p.record.enabled.fms?p.stats.raw.fms?.scores || []:Array(7).fill(null)}))});}
    else if(kind==="iso"){const axes=[...new Map(periods.flatMap(p=>(p.report.isoRadar?.axes||[]).map(a=>[a.key || a.id || a.label,a]))).values()];specs.push({kind:"radar",title:"等长力量 · 力量水平与双侧对称性",max:Math.max(100,...periods.flatMap(p=>(p.report.isoRadar?.axes||[]).flatMap(a=>[N(a.strength)||0,N(a.symmetry)||0]))),axes:axes.map(a=>({key:a.key || a.id || a.label,label:a.label})),series:periods.flatMap(p=>[["strength","力量水平"],["symmetry","双侧对称性"]].map(([field,label])=>({id:p.id+":"+field,recordId:p.id,label:periodLabel(p)+" · "+label,color:p.color,dash:field==="symmetry"?"5 3":"",values:axes.map(a=>{const found=p.report.isoRadar?.axes.find(q=>(q.key||q.id||q.label)===(a.key||a.id||a.label));return found?.[field]??null;})})))});}
    else if(kind==="jumps"){
      const peers=project.peers||[project],entries=peers.flatMap(peer=>{const height=peer.metrics.find(row=>row.metricId===peer.id+"_height"),rsi=peer.metrics.find(row=>row.metricId===peer.id+"_rsi");return height||rsi?periods.map((p,i)=>({period:p,value:{groupId:peer.id,groupLabel:peer.name.replace(/10\/5 Hop Test.*/,"10/5 Hop").replace(/CMRJ .*/,"CMRJ").replace(/DJ .*/,"DJ"),value:height?.cells[i]?.value??null,rsi:rsi?.cells[i]?.value??null,comparableToPrevious:height?.cells[i]?.comparableToPrevious!==false,rsiComparableToPrevious:rsi?.cells[i]?.comparableToPrevious!==false}})):[];});
      if(entries.length)specs.push({kind:"columns",title:peers.length>1?"跳跃测试":project.name,grouped:peers.length>1,unit:"垂直跳跃高度 · cm",rsi:rows.some(r=>/_rsi$/.test(r.metricId)),periods:entries.map(e=>({id:e.period.id,date:e.period.date,label:e.period.label,color:e.period.color})),values:entries.map(e=>e.value)});
    }
    else if(kind==="speed"){
      const speedRows=rows.filter(r=>["mas_speed","mss_speed","ift_speed","ift_shuttle","ift_treadmill"].includes(r.metricId)),units=[...new Set(speedRows.map(r=>r.unit))];
      for(const unit of units){const entries=speedRows.filter(r=>r.unit===unit).flatMap(row=>periods.map((p,i)=>({period:p,value:{groupId:row.id,groupLabel:row.name,value:row.cells[i]?.value??null,target:row.cells[i]?.evaluation?.target,comparableToPrevious:row.cells[i]?.comparableToPrevious,asrEnd:row.metricId==="mas_speed"&&p.stats.raw.asr>=0?p.stats.values.mss_speed:null}})));specs.push({kind:"bars",title:"速度与储备",grouped:true,unit,periods:entries.map(e=>({id:e.period.id,date:e.period.date,label:e.period.label,color:e.period.color})),values:entries.map(e=>e.value)});}
    }
    else if(kind==="ball"){for(const row of rows)specs.push(rowSpec(row,periods,"bars"));}
    else if(kind==="imtp"){
      const percent=periods.at(-1).record.views?.imtp?.yAxis!=="force",series=[],horizontalMarkers=[];
      for(const p of periods){
        if(!p.record.enabled.imtp)continue;const data=p.stats.raw.forceTime || {},rawUnit=p.record.imtpConfig?.unit || "N",factor=root.RingsideModel.unitFactor(rawUnit,"N"),forceUnit=factor===null?rawUnit:"N",force=value=>N(value)===null?null:N(value)*(factor??1),peak=force(data.peakForce),validPeak=peak>0;
        const percentage=(force,supplied)=>N(supplied)!==null?N(supplied):validPeak?force/peak*100:null;
        const known=(data.points||[]).filter(q=>N(q.timeMs)>0&&N(q.force)!==null&&q.force>=0).map(q=>({x:q.timeMs,y:percent?percentage(force(q.force),q.percent):force(q.force),derived:!!q.derived,note:(q.derived?"含 RFD 推算":"实测")+" · "+F(force(q.force))+" "+forceUnit}));
        if(N(data.baselineForce)!==null&&data.baselineForce>=0)known.unshift({x:0,y:percent?percentage(force(data.baselineForce),data.baselinePercent):force(data.baselineForce),note:"起始基线"});
        if(N(data.peakTimeMs)>0&&validPeak&&!known.some(q=>q.x===data.peakTimeMs))known.push({x:data.peakTimeMs,y:percent?100:peak,note:"峰值时间点"});
        known.sort((a,b)=>a.x-b.x);const currentSeries=xySeries(p,"力时曲线",percent&&!validPeak?[]:known),peakMarker=validPeak?{recordId:p.id,y:percent?100:peak,color:p.color,label:periodLabel(p)+" · 峰值 "+F(peak,0)+" "+forceUnit}:null;
        if(!percent&&factor===null){specs.push({kind:"xy",title:"IMTP 力时曲线 · "+forceUnit,xLabel:"时间 · ms",yLabel:"力 · "+forceUnit,series:[currentSeries],horizontalMarkers:peakMarker?[peakMarker]:[]});continue;}
        series.push(currentSeries);if(peakMarker)horizontalMarkers.push(peakMarker);
      }
      specs.push({kind:"xy",title:"IMTP 力时曲线",xLabel:"时间 · ms",yLabel:percent?"占峰值力 · %":"力 · N",series,horizontalMarkers,note:"圆点为实测力，菱形为 RFD 推算；连线只连接已知时间点。"});
    }
    else if(kind==="lactate"){const series=[],markers=[];for(const p of periods){if(!p.record.enabled.lactate)continue;const raw=p.stats.raw.lactate||[];series.push(xySeries(p,"乳酸",raw.map(q=>({x:q.speed,y:q.lactate}))));series.push(xySeries(p,"心率",raw.map(q=>({x:q.speed,y:q.hr})),{right:true,dash:"5 3"}));for(const key of["lt1","lt2"]){const v=p.stats.values[key];if(N(v)!==null)markers.push({x:v,label:key.toUpperCase(),color:p.color,recordId:p.id});}}specs.push({kind:"xy",rich:true,title:project.name,xLabel:"阶段速度 · m/s",yLabel:"乳酸 · mmol/L",rightLabel:"心率 · bpm",zeroX:false,series,markers});}
    else if(kind==="lvp"){const series=periods.flatMap(p=>p.stats.lvpSeries.filter(s=>(project.testIds||[id]).includes(s.testId)&&s.points.length).map(s=>({...s,recordId:p.id,id:p.id+":"+s.id,estimate:s.est,label:periodLabel(p)+" · "+s.label,color:p.color,shape:({landmineR:"diamond",landmineL:"triangle",deadlift:"square"})[s.id]||"circle",dash:({landmineR:"5 3",landmineL:"2 3",deadlift:"6 3"})[s.id]||""})));specs.push({kind:"lvp",title:project.name+" · 负荷速度曲线",series,options:{showPoints:true,showBand:true,showEstimate:true}});}
    else if(kind==="fvp"||kind==="sprint-fvp"){specs.push(fvpSpec(periods,id),elasticitySpec(periods,id));}
    else if(kind==="scalar"){
      const models=periods.map(p=>{const test=p.report.projects.find(t=>t.id===id);return test?root.RingsideGenericReport?.buildChart(p.report,test):null;}),latest=models.filter(Boolean).at(-1);if(latest?.kind&&latest.kind!=="none"){
        const valid=models.map(m=>m?.available&&m.kind===latest.kind?m:null);
        if(["bar","target","column"].includes(latest.kind)){
          const chosen=new Set(valid.flatMap(m=>m?.panels?.flatMap(panel=>(panel.items||[]).map(item=>item.id))||[]));
          for(const row of rows.filter(r=>chosen.has(r.metricId))){const cells=row.cells.map((cell,i)=>valid[i]?.panels.some(panel=>panel.items?.some(item=>item.id===row.metricId))?cell:null);specs.push(rowSpec({...row,cells},periods,latest.kind==="column"?"columns":"bars"));}
        }
        else if(latest.kind==="radar"){
          const axes=[...new Map(valid.flatMap(m=>m?.panels?.flatMap(panel=>(panel.axes||[]).map(axis=>[axis.id,axis]))||[])).values()];
          if(axes.length)specs.push({kind:"radar",title:project.name+" · 评分雷达",max:100,axes:axes.map(a=>({key:a.id,label:a.label})),series:periods.map((p,i)=>({id:p.id,label:p.label,color:p.color,values:axes.map(a=>valid[i]?.panels.flatMap(panel=>panel.axes||[]).find(q=>q.id===a.id)?.value??null)}))});
        }
        else if(latest.kind==="scatter"){
          const key=panel=>JSON.stringify([panel.xAxis?.id,panel.xAxis?.unit,panel.yAxis?.id,panel.yAxis?.unit]),panels=[...new Map(valid.flatMap(m=>(m?.panels||[]).map(panel=>[key(panel),panel]))).values()];
          for(const panel of panels){const series=periods.map((p,i)=>xySeries(p,project.name,valid[i]?.panels.find(candidate=>key(candidate)===key(panel))?.points || [],{connect:false}));specs.push({kind:"xy",title:project.name,xLabel:panel.xAxis.label+" · "+panel.xAxis.unit,yLabel:panel.yAxis.label+" · "+panel.yAxis.unit,zeroX:false,zeroY:false,series});}
        }
        else if(latest.kind==="trials"){const units=[...new Set(valid.flatMap(m=>m?.panels?.map(p=>p.unit)||[]))];for(const unit of units){const series=periods.flatMap((p,i)=>(valid[i]?.panels||[]).filter(q=>q.unit===unit).flatMap(q=>(q.series||[]).map(s=>xySeries(p,s.label,s.points.map(point=>({x:point.index,y:point.value})),{connect:false}))));specs.push({kind:"xy",title:project.name+" · 试次点图",xLabel:"试次",yLabel:unit,zeroX:false,zeroY:false,series});}}
        const reasons=models.flatMap((m,i)=>m?.reason?[periodLabel(periods[i])+" · "+m.reason]:[]);if(reasons.length)specs.push({kind:"notice",reason:reasons.join("；")});
      }
    }
    const available=specs.filter(spec=>spec.kind!=="xy" || spec.series.some(s=>s.points.some(p=>p&&N(p.y)!==null)) || spec.horizontalMarkers?.some(m=>N(m.y)!==null)).map(spec=>spec.series?{...spec,series:dateStyles(spec.series,periods)}:spec);
    return specsOnly?available:available.map(figure).join("");
  }
  function render(model) {
    const periods=model.periods,first=periods[0],last=periods.at(-1),sourceHTML=new Map(periods.map(p=>[p.id,root.RingsideReport.render(p.report)]));
    const merge=(peers,id,name)=>{const metrics=peers.flatMap(p=>p.metrics);if(peers[0].renderer==="speed")for(const row of model.capability?.cards.find(card=>card.id==="speed")?.metrics || [])if(["asr","srr"].includes(row.metricId)&&!metrics.some(item=>item.metricId===row.metricId))metrics.push(row.metricId==="srr"?{...row,cells:row.cells.map((cell,index)=>cell?{...cell,notes:[cell.notes,periods[index].report.speedReference?.athleteType].filter(Boolean).join("；")}:null)}:row);return{...peers[0],id,name,peers,testIds:peers.flatMap(p=>p.testIds||[p.id]),metrics};};
    const projectHTML=project=>{
      const specifications=projectFigures(project,model,{specsOnly:true}),raw=periods.map(p=>project.renderer==="fms"?fmsRaw(p):extractDetails(project.renderer==="fvp"?root.RingsideReport.renderFVPAnalysis(p.report,{print:true}):sourceHTML.get(p.id),project.testIds || [project.id],p)).join("");
      const pair=(charts,data)=>charts?`<div class="detail-pair longitudinal-pair" data-pdf-pair><div class="longitudinal-figures">${charts}</div><div class="detail-data">${data}</div></div>`:data;
      const content=["fvp","sprint-fvp"].includes(project.renderer)?["profile","elasticity"].map(section=>{
        const metrics=(project.metrics||[]).filter(row=>section==="profile"?!["elasticity","scenario"].includes(row.section):["elasticity","scenario"].includes(row.section));
        return pair(specifications.filter(s=>s.section===section).map(figure).join(""),table(metrics,periods));
      }).join(""):pair(specifications.map(figure).join(""),table(project.metrics||[],periods));
      const training=project.renderer==="speed"?periods.map(p=>{const section=sourceHTML.get(p.id).match(/<section class="speed-training">[\s\S]*?<\/section>/)?.[0];return section?`<details class="longitudinal-training"><summary>${E(periodLabel(p))} · 训练速度参考</summary>${section}</details>`:"";}).join(""):"";
      return `<article class="test-block longitudinal-test" id="detail-${E(project.id)}" data-test-ids="${E((project.testIds||[project.id]).join(" "))}">${(project.testIds||[]).filter(id=>id!==project.id).map(id=>`<span class="test-anchor" id="detail-${E(id)}"></span>`).join("")}<div class="test-title"><h4>${E(project.name)}</h4></div>${content}${training}${raw?`<div class="longitudinal-raw">${raw}</div>`:""}</article>`;
    };
    const screening=model.projects.filter(p=>p.category==="screen").map(projectHTML).join(""),isProfile=p=>["fvp","sprint-fvp"].includes(p.renderer),consumed=new Set(),performanceGroups=[];
    for(const group of model.groups.filter(g=>g.category!=="screen")){
      let html="";for(const project of group.projects){
        if(consumed.has(project.id)||isProfile(project)||project.renderer==="lvp")continue;
        if(["jumps","speed"].includes(project.renderer)){
          const peers=model.projects.filter(p=>p.renderer===project.renderer);peers.forEach(p=>consumed.add(p.id));
          const block=projectHTML(merge(peers,project.renderer,project.renderer==="jumps"?"跳跃测试":"速度与储备"));
          if(project.renderer==="speed")performanceGroups.push({id:root.RingsideTests.groupId("速度与储备"),label:"速度与储备",html:block});else html+=block;
        }else{consumed.add(project.id);html+=projectHTML(project);}
      }
      if(html)performanceGroups.push({...group,html});
    }
    const lvp=model.projects.filter(p=>p.renderer==="lvp");if(lvp.length){const html=[["upper","上肢 LVP",["bench","landmine"]],["lower","下肢 LVP",["squat","deadlift"]]].map(([limb,label,ids])=>{const peers=lvp.filter(p=>ids.includes(p.id));return peers.length?projectHTML(merge(peers,"lvp-"+limb,label)):"";}).join("");performanceGroups.push({id:"ability-lvp",label:"负荷速度曲线",html});}
    const performance=performanceGroups.map(group=>`<div class="quality-group" id="${E(group.id)}"><div class="quality-heading"><h3>${E(group.label)}</h3></div>${group.html}</div>`).join("");
    const directions=periods.map(p=>root.RingsideModel.capabilityDirections(p.record,p.stats));
    const directionKeys=[...new Set(directions.flatMap(list=>list.filter(d=>d.hasData).map(d=>d.id)))];
    const directionCards=directionKeys.map(key=>{const samples=directions.map(list=>list.find(d=>d.id===key&&d.hasData)),latest=samples.slice().reverse().find(Boolean),card=model.capability?.cards.find(c=>c.id===(key==="endurance"?"cardio":key));
      return `<article class="capability-direction-card longitudinal-capability" data-capability-direction="${E(key)}"><div class="capability-card-summary"><h4>${E(latest.title)}</h4>${samples.map((d,i)=>d?`<section class="longitudinal-direction-period"><p class="longitudinal-direction-date"><i style="background:${E(periods[i].color)}"></i>${E(periodLabel(periods[i]))}</p><p class="capability-direction-judgment ${E(d.status || "gray")}">${E(d.judgment)}</p><p class="capability-direction-basis">${E(d.label)}</p><p class="capability-direction-value">${F(d.value,3)} ${E(d.unit && d.unit!=="比值"?d.unit:"")}</p>${d.context?.angle?`<p class="capability-direction-context">${F(d.context.angle,0)}° 目标方向</p>`:""}${N(d.context?.targetDistanceM)!==null?`<p class="capability-direction-context">目标距离 ${F(d.context.targetDistanceM,1)} m</p>`:""}</section>`:`<section class="longitudinal-direction-period"><p class="longitudinal-direction-date">${E(periodLabel(periods[i]))}</p><p>—</p></section>`).join("")}</div>${card?`<details id="longitudinal-capability-parameters-${E(key)}" class="capability-card-parameters longitudinal-capability-parameters" data-capability-parameters="${E(key)}"><summary><span>查看相关参数</span><small>${card.metrics.length} 项</small></summary>${table(card.metrics,periods)}</details>`:""}</article>`;}).join("");
    const profiles=model.projects.filter(isProfile).map(projectHTML).join("");
    const capability=(directionCards?`<div class="capability-direction-grid" data-capability-analysis>${directionCards}</div>`:"")+profiles;
    const chartSeries=data=>dateStyles(data.series.map(s=>({id:s.id,recordId:s.recordId,label:s.label,color:s.color,values:s.values,cells:s.cells?.map(c=>c?{pain:c.pain}:null)})),periods);
    const riskSpec={kind:"radar",title:"损伤风险筛查",showTitle:false,max:3,risk:true,axes:model.risk.axes,series:chartSeries(model.risk)},overviewSpec={kind:"radar",title:"运动表现概览",showTitle:false,max:100,axes:model.overview.axes,series:chartSeries(model.overview)};
    const count=model.projects.flatMap(p=>p.metrics||[]).filter(row=>row.changes?.overall?.available).length;
    const riskTable=model.risk.rows.length?`<article class="test-block longitudinal-regions"><div class="test-title"><h4>各区域筛查等级</h4></div>${table(model.risk.rows,periods)}</article>`:"";
    return{summary:`<article class="micro-card athlete-summary"><div class="micro-head"><h3>运动员信息</h3></div><div class="micro-value text">${E(model.athlete?.name || last.record.athlete.name)}</div><p>${E(last.record.athlete.sport || "")}</p></article><article class="micro-card"><h3>比较记录</h3><div class="micro-value">${periods.length}<small> 次</small></div><p>${E(first.date)} — ${E(last.date)}</p></article><article class="micro-card"><h3>可比指标</h3><div class="micro-value">${count}<small> 项</small></div><p>首末记录均有可比结果</p></article><article class="micro-card"><h3>代表成绩</h3><div class="micro-value text">${model.mode==="mean"?"试次均值":"最佳试次"}</div><p>${E(model.profile?.name || "当前评价方案")}</p></article>`,body:figure(riskSpec),overview:figure(overviewSpec),legend:"",screenPill:model.risk.axes.length+" 个区域",referenceLabel:model.overview.axes.length+" 个能力维度",screenItems:"",details:`<details class="details-group" id="screenDetail" open><summary>损伤风险筛查<span>按测试日期比较</span></summary><div class="quality-group">${riskTable}${screening || empty("尚无筛查结果")}</div></details><details class="details-group" id="performanceDetail" open><summary>运动表现测试<span>按测试日期比较</span></summary><div class="quality-group">${performance || empty("尚无运动表现结果")}</div></details>${capability?`<details class="details-group" id="capabilityDetail" open><summary>能力结构分析<span>各次参数与变化</span></summary><div class="quality-group capability-analysis-content">${capability}</div></details>`:""}`};
  }
  function layout(container,{print=false}={}) {
    if(print)container.querySelectorAll("[data-longitudinal-table]").forEach(node=>{if(node.dataset.longitudinalPrintTable)return;const data=JSON.parse(node.dataset.longitudinalTable);node.innerHTML=table(data.rows,data.periods,{print:true,wrapped:false});node.dataset.longitudinalPrintTable="true";});
    container.querySelectorAll("[data-longitudinal-chart]").forEach(node=>{const width=Math.max(250,Math.round(node.getBoundingClientRect().width || 450)),key=width+":"+print;if(node.dataset.longitudinalLayout===key)return;node.innerHTML=draw(JSON.parse(node.dataset.longitudinalChart),width,print);node.dataset.longitudinalLayout=key;});
  }
  let observer;
  function mount(container) { observer?.disconnect();layout(container);if(typeof ResizeObserver!=="undefined"){let scheduled=false;observer=new ResizeObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(container.isConnected)layout(container);});});observer.observe(container);} }
  root.RingsideLongitudinalView={render,layout,mount,draw,table,projectFigures};
})(typeof window!=="undefined"?window:globalThis);
