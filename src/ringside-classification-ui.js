(function(root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  function create(host) {
    let draft, baseline, selected = '', busy = false;
    const id = 'classificationModal';
    function element() {
      let dialog = document.getElementById(id);
      if (!dialog) {
        dialog = document.createElement('div'); dialog.id = id; dialog.className = 'modal-backdrop';
        dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','classificationTitle');
        document.body.appendChild(dialog);
      }
      return dialog;
    }
    function capture() {
      for(const input of element().querySelectorAll('[data-class-field]')) {
        const [collection, itemId, key] = JSON.parse(input.dataset.classField);
        const item = draft[collection].find(value=>value.id===itemId);
        if(item)item[key] = input.type==='number' ? input.value===''?null:Number(input.value) : input.value;
      }
    }
    function input(collection,item,key,type='text') {
      return `<input type="${type}" ${type==='number'?'min="0" max="150" step="1"':key==='subdivisionLabel'?'maxlength="100"':'maxlength="200"'} aria-label="${esc({name:'名称',subdivisionLabel:'细分称谓',min:'起始年龄',max:'结束年龄'}[key])}" value="${esc(item[key])}" data-class-field="${esc(JSON.stringify([collection,item.id,key]))}">`;
    }
    function toggle(collection,item) {
      return `<button class="btn small" type="button" data-class-toggle="${esc(JSON.stringify([collection,item.id]))}">${item.disabled?'启用':'停用'}</button>`;
    }
    function render() {
      const dialog=element(),sport=draft.sports.find(item=>item.id===selected);
      dialog.innerHTML=`<div class="modal"><header class="modal-head"><h2 id="classificationTitle">专项与年龄分组</h2><button class="close" type="button" aria-label="关闭">×</button></header><form class="modal-form"><div class="settings-content">
        <h3>专项</h3><div class="management-table-wrap"><table class="management-table"><thead><tr><th>专项名称</th><th>细分称谓</th><th>操作</th></tr></thead><tbody>${draft.sports.map(item=>`<tr><td>${input('sports',item,'name')}</td><td>${input('sports',item,'subdivisionLabel')}</td><td><button class="btn small" type="button" data-class-select="${esc(item.id)}" ${item.id===selected?'aria-pressed="true"':''}>管理细分</button>${toggle('sports',item)}</td></tr>`).join('')}</tbody></table></div><button class="btn small" type="button" data-class-add="sports">添加专项</button>
        ${sport?`<h3>${esc(sport.name||'所选专项')} · ${esc(sport.subdivisionLabel||'主要细分')}</h3><div class="management-table-wrap"><table class="management-table"><thead><tr><th>细分名称</th><th>操作</th></tr></thead><tbody>${draft.subdivisions.filter(item=>item.sportId===selected).map(item=>`<tr><td>${input('subdivisions',item,'name')}</td><td>${toggle('subdivisions',item)}</td></tr>`).join('')}</tbody></table></div><button class="btn small" type="button" data-class-add="subdivisions">添加细分</button>`:''}
        <h3>年龄分组</h3><div class="management-table-wrap"><table class="management-table"><thead><tr><th>名称</th><th>起始周岁</th><th>结束周岁</th><th>操作</th></tr></thead><tbody>${draft.ageBands.map(item=>`<tr><td>${input('ageBands',item,'name')}</td><td>${input('ageBands',item,'min','number')}</td><td>${input('ageBands',item,'max','number')}</td><td>${toggle('ageBands',item)}</td></tr>`).join('')}</tbody></table></div><button class="btn small" type="button" data-class-add="ageBands">添加年龄组</button>
        </div><p class="field-error" role="alert" hidden></p><footer class="modal-foot"><button class="btn" type="button" data-class-cancel>取消</button><button class="btn primary" type="submit">保存</button></footer></form></div>`;
      dialog.querySelector('.close').onclick=dialog.querySelector('[data-class-cancel]').onclick=()=>{if(!busy)host.close(id);};
      dialog.querySelectorAll('[data-class-select]').forEach(button=>button.onclick=()=>{capture();selected=button.dataset.classSelect;render();});
      dialog.querySelectorAll('[data-class-toggle]').forEach(button=>button.onclick=()=>{capture();const[collection,itemId]=JSON.parse(button.dataset.classToggle);const item=draft[collection].find(value=>value.id===itemId);item.disabled=!item.disabled;render();});
      dialog.querySelectorAll('[data-class-add]').forEach(button=>button.onclick=()=>{
        capture();const collection=button.dataset.classAdd,item={id:crypto.randomUUID(),name:''};
        if(collection==='sports'){item.subdivisionLabel='主要细分';selected=item.id;}
        if(collection==='subdivisions')item.sportId=selected;
        if(collection==='ageBands'){item.min=null;item.max=null;}
        draft[collection].push(item);render();
        [...dialog.querySelectorAll('[data-class-field]')].find(node=>JSON.parse(node.dataset.classField)[1]===item.id)?.focus();
      });
      dialog.querySelector('form').onsubmit=async event=>{
        event.preventDefault();if(busy)return;capture();busy=true;dialog.querySelectorAll('input,button').forEach(control=>control.disabled=true);
        try{
          const normalized=root.RingsideClassifications.normalize(draft);
          await host.commit(next=>{
            if(JSON.stringify(next.classifications)!==baseline)throw Error('专项或年龄分组已被修改，请重新打开后核对。');
            next.classifications=clone(normalized);
          });
          host.close(id);
        }catch(error){const message=dialog.querySelector('[role="alert"]');message.hidden=false;message.textContent=error.message;}
        finally{busy=false;dialog.querySelectorAll('input,button').forEach(control=>control.disabled=false);}
      };
    }
    function open(){baseline=JSON.stringify(host.library().classifications);draft=root.RingsideClassifications.normalize(host.library().classifications);selected=draft.sports[0]?.id||'';render();host.modal(id);}
    return {open,isBusy:()=>busy,isOpen:()=>element().classList.contains('show')};
  }
  root.RingsideClassificationUI={create};
})(window);
