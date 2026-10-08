(function (root) {
  "use strict";
  const T = root.RingsideTests, M = root.RingsideModel;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const copySelection = value => ({testIds:[...new Set(value?.testIds || [])],isoDirectionIds:[...new Set(value?.isoDirectionIds || [])]});
  function projects(options) {
    const selected = new Set(options.selection?.testIds || []);
    return (options.projects || T.describe(options.source)).filter(project => !project.disabled || selected.has(project.id));
  }
  const directionRows = options => options.isoRows || M.isoDirectionCatalog(options.source);
  const blocked = (options, id) => (options.blockedIds || []).includes(id) || projects(options).find(project => project.id === id)?.disabled;
  function applyAction(selection, action, options) {
    const next = copySelection(selection), available = projects({...options, selection});
    const toggle = (key, ids, checked) => {
      next[key] = checked ? [...next[key], ...ids.filter(id => !next[key].includes(id))] : next[key].filter(id => !ids.includes(id));
    };
    if (action.kind === "project") {
      if (!available.some(project => project.id === action.id) || (action.checked && blocked(options, action.id))) return next;
      toggle("testIds", [action.id], action.checked);
    } else if (action.kind === "group") {
      const groups = T.groups(available, options.source);
      const ids = groups.filter(group => action.id === "all" || group.id === action.id).flatMap(group => group.projects).filter(project => !action.checked || !blocked(options, project.id)).map(project => project.id);
      toggle("testIds", ids, action.checked);
    } else if (action.kind === "iso" || action.kind === "iso-group") {
      const rows = directionRows(options), ids = rows.filter(row => action.kind === "iso" ? row.id === action.id : action.id === "all" || row.region === action.id).map(row => row.id);
      toggle("isoDirectionIds", ids, action.checked);
    } else if (action.kind === "move") {
      const index = next.testIds.indexOf(action.id), target = index + action.offset;
      if (index >= 0 && target >= 0 && target < next.testIds.length) [next.testIds[index],next.testIds[target]] = [next.testIds[target],next.testIds[index]];
    }
    return next;
  }
  function actionButton(label, action, id, extra = "") {
    return `<button type="button" class="text-btn" data-picker-action="${action}" data-picker-id="${esc(id)}" ${extra}>${label}</button>`;
  }
  function orderMarkup(options, selection) {
    const available = options.projects || T.describe(options.source);
    return selection.testIds.map((id,index) => {
      const project = available.find(project => project.id === id);
      return `<li data-plan-project="${esc(id)}"><span>${esc(project?.name || "已移除项目")}${project?.disabled?'<small>已停用</small>':""}</span><div class="row">${actionButton("上移","up",id,index===0?"disabled":"")}${actionButton("下移","down",id,index===selection.testIds.length-1?"disabled":"")}${actionButton("移除","remove",id)}</div></li>`;
    }).join("") || '<li class="empty">请勾选本次需要的测试项目。</li>';
  }
  function isoMarkup(options, selection) {
    const regions = new Map();
    for (const row of directionRows(options)) {
      if (!regions.has(row.region)) regions.set(row.region, []);
      regions.get(row.region).push(row);
    }
    return `<section class="picker-iso-panel" data-picker-iso-panel ${selection.testIds.includes("iso")?"":"hidden"}><div class="picker-iso-heading"><div><h4>关节与运动方向</h4><p>勾选本次要测的方向；每个方向分别录入试次。</p></div><span data-picker-iso-count aria-live="polite">${selection.isoDirectionIds.length} 个方向已选</span></div>${[...regions].map(([region,rows]) => `<section class="picker-iso-region"><div class="plan-group-heading"><h5>${esc(M.REG[region] || region)}</h5>${actionButton("选择本组","iso-all",region)}${actionButton("清空本组","iso-none",region)}</div><div class="picker-direction-grid">${rows.map(row => `<label class="picker-direction"><input type="checkbox" data-picker-iso="${esc(row.id)}" value="${esc(row.id)}" aria-label="${esc((M.REG[row.region] || row.region)+" · "+row.direction)}" ${selection.isoDirectionIds.includes(row.id)?"checked":""}><span>${esc(row.direction)}<small>${esc(row.paired ? M.isoSideLabels(row).left+" / "+M.isoSideLabels(row).right : M.isoSideLabels(row).center || "单值测量")}</small></span></label>`).join("")}</div></section>`).join("")}</section>`;
  }
  function render(options) {
    const selection = copySelection(options.selection), available = projects(options), context = options.context || "plan";
    const groupMarkup = T.groups(available,options.source).map(group => `<section class="plan-group" data-plan-group="${esc(group.id)}"><div class="plan-group-heading"><h4>${esc(group.label)}</h4>${actionButton("选择本组","all",group.id)}${actionButton("清空本组","none",group.id)}</div><div class="check-grid">${group.projects.map(project => {
      const selected = selection.testIds.includes(project.id), unavailable = blocked(options, project.id), other = (project.abilities || []).filter(ability => ability !== project.primaryAbility).map(ability => T.abilityLabel(options.source,ability));
      const attribute = context === "creation" ? `data-creation-project="${esc(project.id)}"` : context === "record" ? `data-path="enabled.${esc(project.id)}"` : `data-plan-project-choice="${esc(project.id)}"`;
      return `<label class="check-tile"><input type="checkbox" data-picker-project="${esc(project.id)}" data-project-group="${esc(group.id)}" value="${esc(project.id)}" ${attribute} aria-label="${esc(project.name)}" ${selected?"checked":""} ${unavailable&&!selected?"disabled":""}><span>${esc(project.name)}${other.length?'<small class="ability-tags">'+other.map(esc).join(" · ")+"</small>":""}<small class="plan-state" data-plan-status="${esc(project.id)}">${esc(project.disabled?"已停用":unavailable?"目录定义待确认":options.statuses?.[project.id] || "")}</small></span></label>${project.id==="iso"?isoMarkup(options,selection):""}`;
    }).join("")}</div></section>`).join("");
    return `<div class="project-picker" data-project-picker="${esc(context)}"><div class="plan-tools">${actionButton("全选","all","all")}${actionButton("清空","none","all")}<span class="plan-count" data-picker-count ${context==="creation"?"data-creation-count":"data-plan-count"} aria-live="polite">${selection.testIds.length} 项已选</span></div>${groupMarkup}${options.showOrder===false?"":`<details class="picker-order"><summary>已选项目 · <span data-picker-order-count>${selection.testIds.length}</span> 项<span>调整录入顺序</span></summary><ol class="test-plan-order" data-picker-order>${orderMarkup(options,selection)}</ol></details>`}</div>`;
  }
  function bind(container, options) {
    const element = container.matches?.("[data-project-picker]") ? container : container.querySelector("[data-project-picker]");
    if (!element) throw new Error("项目选择器尚未渲染");
    element._ringsidePicker?.destroy();
    let selection = copySelection(options.selection);
    function update(next) {
      selection = copySelection(next);
      element.querySelectorAll("[data-picker-project]").forEach(control => {control.checked = selection.testIds.includes(control.dataset.pickerProject);control.disabled = !!blocked(options,control.dataset.pickerProject) && !control.checked;});
      element.querySelectorAll("[data-picker-iso]").forEach(control => {control.checked = selection.isoDirectionIds.includes(control.dataset.pickerIso);});
      element.querySelectorAll("[data-picker-count]").forEach(node => {node.textContent = selection.testIds.length+" 项已选";});
      element.querySelectorAll("[data-picker-iso-count]").forEach(node => {node.textContent = selection.isoDirectionIds.length+" 个方向已选";});
      const panel = element.querySelector("[data-picker-iso-panel]");if (panel) panel.hidden = !selection.testIds.includes("iso");
      const order = element.querySelector("[data-picker-order]");
      if (order) {
        const active = document.activeElement, restore = order.contains(active) ? {action:active.dataset.pickerAction,id:active.dataset.pickerId} : null;
        order.innerHTML = orderMarkup(options,selection);element.querySelector("[data-picker-order-count]").textContent = selection.testIds.length;
        if (restore) {
          const buttons = [...order.querySelectorAll("button:not(:disabled)")];
          (buttons.find(button => button.dataset.pickerAction===restore.action && button.dataset.pickerId===restore.id) || buttons.find(button => button.dataset.pickerId===restore.id) || buttons[0])?.focus({preventScroll:true});
        }
      }
    }
    function dispatch(action) {
      const next = applyAction(selection,action,options);
      if (options.onChange?.(copySelection(next),action) !== false) update(next);else update(selection);
    }
    function change(event) {
      const control = event.target;
      if (!control.matches("[data-picker-project],[data-picker-iso]")) return;
      event.stopPropagation();
      dispatch({kind:control.dataset.pickerProject?"project":"iso",id:control.dataset.pickerProject || control.dataset.pickerIso,checked:control.checked});
    }
    function click(event) {
      const button = event.target.closest("[data-picker-action]");if (!button || !element.contains(button)) return;
      event.preventDefault();event.stopPropagation();
      const action = button.dataset.pickerAction,id = button.dataset.pickerId;
      if (action === "up" || action === "down") dispatch({kind:"move",id,offset:action==="up"?-1:1});
      else if (action === "remove") dispatch({kind:"project",id,checked:false});
      else dispatch({kind:action.startsWith("iso-")?"iso-group":"group",id,checked:action==="all" || action==="iso-all"});
    }
    element.addEventListener("change",change);element.addEventListener("click",click);
    const controller = {update,destroy(){element.removeEventListener("change",change);element.removeEventListener("click",click);}};
    element._ringsidePicker = controller;
    return controller;
  }
  root.RingsidePicker = {render,bind,applyAction};
})(typeof window !== "undefined" ? window : globalThis);
