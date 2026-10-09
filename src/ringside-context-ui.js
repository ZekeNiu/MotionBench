(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fields = [
    ["athlete.age","本次年龄","number","creationAge"],
    ["athlete.mass","本次体重 kg","number","creationMass"],
    ["athlete.height","本次身高 cm","number","creationHeight"],
    ["athlete.injury","当前伤病、症状与训练限制","textarea","creationInjury"],
    ["trainingContext.previousCompetitionDate","上一场比赛日期","date","creationPreviousCompetitionDate"],
    ["trainingContext.nextCompetitionDate","下一场比赛日期","date","creationNextCompetitionDate"],
    ["athlete.cycle","训练周期","text","creationCycle"],
    ["trainingContext.weeklySessions","每周体能训练次数","number","creationWeeklySessions"],
    ["trainingContext.equipment","可用器械","text","creationEquipment"],
    ["trainingContext.weeklySchedule","周训练安排","textarea","creationWeeklySchedule"],
    ["athlete.notes","补充说明","textarea","creationNotes"],
  ];
  const get = (record, path) => path.split(".").reduce((value,key) => value?.[key],record) ?? "";
  function control(record, specification, creation) {
    const [path,label,type,id]=specification, value=get(record,path);
    const attr=creation?`id="${id}" data-creation-context="${path}"`:`data-path="${path}"`;
    const readonly=path==="athlete.age"&&record.athlete.birthDate;
    const numeric=type==="number"?`min="0" step="${path==="trainingContext.weeklySessions"?"1":"any"}" ${path==="athlete.age"?'max="100"':path==="trainingContext.weeklySessions"?'max="14"':""}`:"";
    const input=type==="textarea"?`<textarea ${attr} rows="2" aria-label="${esc(label)}">${esc(value)}</textarea>`:`<input ${attr} type="${type}" value="${esc(value)}" aria-label="${esc(label)}" ${numeric} ${readonly?'readonly aria-readonly="true"':""}>`;
    return `<label class="field ${type==="textarea"?"wide":""}"><span>${esc(label)}</span>${input}</label>`;
  }
  function intervals(record) {
    const context=root.RingsideModel.competitionContext(record);
    return [context.daysSincePrevious===null?"":`距上一场 ${context.daysSincePrevious} 天`,context.daysUntilNext===null?"":`距下一场 ${context.daysUntilNext} 天`].filter(Boolean).join(" · ");
  }
  function render(record,{creation=false,source=null}={}) {
    let result=creation?"":`<div class="form-grid"><label class="field"><span>测试日期</span><input type="date" data-path="athlete.date" value="${esc(record.athlete.date)}" aria-label="测试日期" required></label></div>`;
    result+=`<div class="form-grid">${fields.slice(0,6).map(spec=>control(record,spec,creation)).join("")}</div><p class="note" data-competition-interval>${esc(intervals(record))}</p>`;
    result+=`<details class="supplement"><summary>本次训练安排（可选）</summary>`;
    if(source)result+=`<p class="note">上次测试：${esc(source.athlete.date)}</p><button type="button" class="btn small" onclick="App.${creation?"reuseCreationTraining":"reusePreviousTraining"}()">沿用上次训练安排</button>`;
    result+=`<div class="form-grid">${fields.slice(6).map(spec=>control(record,spec,creation)).join("")}</div></details>`;
    return result;
  }
  function read(container,record) {
    const result=JSON.parse(JSON.stringify(record));
    for(const [path] of fields){
      const node=container.querySelector(`[data-creation-context="${path}"]`);
      if(!node)continue;
      const [section,key]=path.split(".");result[section][key]=node.value;
    }
    root.RingsideModel.applyAge(result);return result;
  }
  function refresh(record,container) {
    const age=container.querySelector('[data-path="athlete.age"],[data-creation-context="athlete.age"]');
    if(age){age.readOnly=!!record.athlete.birthDate;age.setAttribute("aria-readonly",String(age.readOnly));if(age.readOnly)age.value=record.athlete.age;}
    const interval=container.querySelector("[data-competition-interval]");if(interval)interval.textContent=intervals(record);
  }
  root.RingsideContextUI={render,read,refresh};
})(window);
