(function(root){
  "use strict";
  const number=value=>root.Calc.num(value),clone=value=>JSON.parse(JSON.stringify(value));
  const plain=value=>!!value&&Object.getPrototypeOf(value)!==null&&Object.prototype.toString.call(value)==="[object Object]";
  const safe=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,249}$/.test(value)&&!["__proto__","constructor","prototype"].includes(value);
  const keys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
  const calculated=d=>!!d?.calculation;
  const deficit=d=>d?.calculation?.kind==="cod-deficit";
  const defs=source=>source.definitions||[];
  function validateDefinitions(source){
    for(const d of defs(source)){
      if(d.distanceM!==undefined&&(!(number(d.distanceM)>0)||typeof d.distanceM!=="number"||d.unit!=="s"))throw Error("计时距离须为正数，单位须为 s");
      if(!calculated(d))continue;
      const c=d.calculation;
      if(!plain(c)||c.version!==1||d.unit!=="s"||!keys(c,c.kind==="sum"?["version","kind","inputMetricIds"]:["version","kind","timeMetricId","referenceDistanceM"]))throw Error("计算指标格式无效");
      if(c.kind==="sum"){
        if(d.entryScope!=="attempt"||!Array.isArray(c.inputMetricIds)||c.inputMetricIds.length<2||c.inputMetricIds.length>16||new Set(c.inputMetricIds).size!==c.inputMetricIds.length||c.inputMetricIds.some(id=>!safe(id)||!defs(source).some(input=>input.id===id&&input.testId===d.testId&&input.unit==="s"&&input.entryScope==="attempt"&&!calculated(input))))throw Error("合计时间须选择同项目的至少两个原始试次计时指标");
      }else if(c.kind==="cod-deficit"){
        if(d.entryScope!=="record"||!safe(c.timeMetricId)||!(c.referenceDistanceM>0)||!Number.isFinite(c.referenceDistanceM)||!defs(source).some(input=>input.id===c.timeMetricId&&input.testId===d.testId&&input.unit==="s"&&!deficit(input)))throw Error("变向差值须指定本项目时间和有效参照距离");
      }else throw Error("不支持的计算方式");
      if(root.RingsideTests&&root.RingsideTests.isNative(source,d.testId))throw Error("计算指标仅用于通用测试项目");
    }
  }
  function validateBindings(bindings,source,testIds){
    if(bindings===undefined)return;
    if(!plain(bindings)||Object.keys(bindings).length>300)throw Error("直线参照配置无效");
    for(const [id,b]of Object.entries(bindings)){
      const d=defs(source).find(d=>d.id===id),ref=defs(source).find(d=>d.id===b?.metricId&&d.testId===b?.testId);
      if(!deficit(d)||!plain(b)||!keys(b,["testId","metricId","distanceM"])||!safe(b.testId)||!safe(b.metricId)||!ref||ref.unit!=="s"||defs(source).some(other=>deficit(other)&&other.testId===b.testId)||b.testId===d.testId||b.distanceM!==d.calculation.referenceDistanceM||ref.distanceM!==b.distanceM||testIds&&(!testIds.includes(d.testId)||!testIds.includes(b.testId)))throw Error("直线参照须来自方案内另一非变向项目的同距离计时指标");
    }
  }
  function attemptValue(record,definition,row){
    const c=definition.calculation;
    if(c?.kind!=="sum")return number(row.metrics?.[definition.id]);
    const values=c.inputMetricIds.map(id=>number(row.metrics?.[id]));
    const sum=values.every(value=>value!==null&&value>0)?values.reduce((a,b)=>a+b,0):null;
    return Number.isFinite(sum)?sum:null;
  }
  function evaluate(record,values){
    const results={};
    for(const d of defs(record).filter(d=>d.calculation?.kind==="sum"&&record.enabled[d.testId]))results[d.id]={kind:"sum",value:number(values[d.id]),reason:number(values[d.id])===null?"缺少完整有效分段试次":""};
    const bindings=record.testPlanSnapshot?.calculationBindings||record.calculationBindings||{};
    for(const d of defs(record).filter(d=>deficit(d)&&record.enabled[d.testId])){
      const c=d.calculation,b=bindings[d.id],time=number(values[c.timeMetricId]);
      const ref=b&&record.enabled[b.testId]?number(values[b.metricId]):null;
      const reason=!(time>0)?"缺少有效变向总时间":!b?"尚未绑定直线参照":!record.enabled[b.testId]?"本次记录未包含直线参照项目":!(ref>0)?"缺少有效直线参照时间":"";
      const value=reason?null:time-ref;
      results[d.id]={kind:"cod-deficit",value,time,reference:ref,referenceDistanceM:c.referenceDistanceM,referenceTestId:b?.testId||"",referenceMetricId:b?.metricId||"",reason};
      values[d.id]=value;
    }
    return results;
  }
  function context(d){
    const distance=d.distanceM!==undefined?{distanceM:d.distanceM}:{};
    if(!calculated(d))return distance;
    return deficit(d)?{...distance,calculation:{version:1,kind:"cod-deficit",referenceDistanceM:d.calculation.referenceDistanceM}}:{...distance,calculation:clone(d.calculation)};
  }
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function editor(source,testId,d){
    if(root.RingsideTests.isNative(source,testId))return "";
    const c=d?.calculation||{},inputs=defs(source).filter(x=>x.testId===testId&&x.id!==d?.id&&x.unit==="s"&&!deficit(x));
    return `<div class="field wide" data-calculation-editor><label>结果方式<select id="calculationKind"><option value="">直接录入</option><option value="sum"${c.kind==="sum"?" selected":""}>同试次分段时间相加</option><option value="cod-deficit"${c.kind==="cod-deficit"?" selected":""}>变向时间减直线参照时间</option></select></label><div data-calculation-sum${c.kind!=="sum"?" hidden":""}><p>只有各段完整且大于零的试次参与合计和代表成绩。</p>${inputs.filter(x=>!calculated(x)&&x.entryScope==="attempt").map(x=>`<label class="check-line"><input type="checkbox" data-calculation-input value="${esc(x.id)}"${c.inputMetricIds?.includes(x.id)?" checked":""}>${esc(x.name)}</label>`).join("")}</div><div data-calculation-cod${c.kind!=="cod-deficit"?" hidden":""}><label>本项目变向时间<select id="calculationTime">${inputs.map(x=>`<option value="${esc(x.id)}"${c.timeMetricId===x.id?" selected":""}>${esc(x.name)}</option>`).join("")}</select></label><label>直线参照距离 m<input id="calculationReferenceDistance" type="number" min="0" step="any" value="${esc(c.referenceDistanceM||"")}"></label><p>直线参照在测试方案中选择，使用本次记录已有代表成绩。</p></div><label>该计时指标距离 m（可留空）<input id="calculationDistance" type="number" min="0" step="any" value="${esc(d?.distanceM||"")}"></label></div>`;
  }
  function readEditor(d){
    const get=id=>root.document.getElementById(id),kind=get("calculationKind")?.value;
    if(!get("calculationKind"))return d;
    delete d.calculation;delete d.distanceM;
    if(get("calculationDistance").value!=="")d.distanceM=Number(get("calculationDistance").value);
    if(kind){d.unit="s";d.scoring=false;d.target=null;d.ranges=[];d.referenceEnabled=false;
      d.entryScope=kind==="sum"?"attempt":"record";
      d.direction="lower";d.directionStatus="confirmed";d.resultMeaning="numeric";
      d.calculation=kind==="sum"?{version:1,kind,inputMetricIds:[...root.document.querySelectorAll("[data-calculation-input]:checked")].map(el=>el.value)}:{version:1,kind,timeMetricId:get("calculationTime").value,referenceDistanceM:Number(get("calculationReferenceDistance").value)};
      if(kind==="cod-deficit"){d.measurementScale="interval";d.ratioEligible=false;d.cvEligible=false;}
    }
    return d;
  }
  function bindingEditor(source,plan){
    return defs(source).filter(d=>deficit(d)&&plan.testIds.includes(d.testId)).map(d=>{
      const candidates=defs(source).filter(ref=>plan.testIds.includes(ref.testId)&&ref.testId!==d.testId&&ref.unit==="s"&&!defs(source).some(other=>deficit(other)&&other.testId===ref.testId)&&ref.distanceM===d.calculation.referenceDistanceM),b=plan.calculationBindings?.[d.id];
      return `<label class="field"><span>${esc(d.name)} · ${d.calculation.referenceDistanceM} m 直线参照</span><select data-calculation-binding="${esc(d.id)}"><option value="">暂不绑定</option>${candidates.map(ref=>`<option value="${esc(ref.id)}"${b?.metricId===ref.id?" selected":""}>${esc(source.tests.find(t=>t.id===ref.testId)?.name)} · ${esc(ref.name)}</option>`).join("")}</select></label>`;
    }).join("");
  }
  if(root.document)root.document.addEventListener("change",event=>{
    if(event.target.id!=="calculationKind")return;
    const kind=event.target.value,host=event.target.closest("[data-calculation-editor]");
    host.querySelector("[data-calculation-sum]").hidden=kind!=="sum";host.querySelector("[data-calculation-cod]").hidden=kind!=="cod-deficit";
    if(kind){const scope=root.document.getElementById("catalogEntryScope"),unit=root.document.getElementById("catalogUnit");if(scope)scope.value=kind==="sum"?"attempt":"record";if(unit)unit.value="s";}
  });
  if(root.document){
    let pending=false;
    const refresh=event=>{if(!event.target.closest?.("#entryContent")||!root.document.querySelector("[data-calculation-output]")||pending)return;pending=true;root.setTimeout(()=>{pending=false;const record=root.App?.getState();if(!record)return;const computed=root.RingsideModel.stats(record);for(const output of root.document.querySelectorAll("[data-calculation-output]")){const id=output.dataset.calculationOutput,d=record.definitions.find(d=>d.id===id),value=number(computed.values[id]);output.textContent=(value===null?"—":value.toFixed(2))+" "+(d?.unit||"");}for(const reason of root.document.querySelectorAll("[data-calculation-reason]"))reason.textContent=computed.calculationResults?.[reason.dataset.calculationReason]?.reason||"";},0);};
    root.document.addEventListener("input",refresh);root.document.addEventListener("change",refresh);
  }
  root.RingsideCalculations={calculated,deficit,validateDefinitions,validateBindings,attemptValue,evaluate,context,editor,readEditor,bindingEditor};
})(typeof window!=="undefined"?window:globalThis);
