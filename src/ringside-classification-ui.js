(function(root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  function create(host) {
    let draft, baseline, draftBaseline, selected = '', busy = false, tab = 'sports', container = null, message = '';
    function capture() {
      if (!draft || !container?.isConnected) return;
      for (const input of container.querySelectorAll('[data-class-field]')) {
        const [collection, itemId, key] = JSON.parse(input.dataset.classField);
        const item = draft[collection].find(value=>value.id===itemId);
        if (item) item[key] = input.type==='number' ? input.value===''?null:Number(input.value) : input.value;
      }
    }
    function dirty() { capture(); return !!draft && JSON.stringify(draft)!==draftBaseline; }
    function reset() {
      baseline=JSON.stringify(host.library().classifications);
      draft=root.RingsideClassifications.normalize(host.library().classifications);
      draftBaseline=JSON.stringify(draft);message='';
    }
    function input(collection,item,key,type='text') {
      return '<input type="'+type+'" '+(type==='number'?'min="0" max="150" step="1"':key==='subdivisionLabel'?'maxlength="100"':'maxlength="200"')+' aria-label="'+esc({name:'名称',subdivisionLabel:'细分称谓',min:'起始年龄',max:'结束年龄'}[key])+'" value="'+esc(item[key])+'" data-class-field="'+esc(JSON.stringify([collection,item.id,key]))+'">';
    }
    function toggle(collection,item) {
      return '<button class="btn small" type="button" data-class-toggle="'+esc(JSON.stringify([collection,item.id]))+'">'+(item.disabled?'启用':'停用')+'</button>';
    }
    function sportList() {
      return '<div class="row"><button class="btn primary" type="button" data-class-add="sports">＋ 添加专项</button></div>'+
        (draft.sports.map(item=>'<article class="management-catalog-item" data-class-sport="'+esc(item.id)+'"><div><h2>'+esc(item.name||'新专项')+(item.disabled?' <span class="pill">已停用</span>':'')+'</h2><p class="note">'+esc(item.subdivisionLabel||'细分')+' · '+draft.subdivisions.filter(child=>child.sportId===item.id).length+' 个选项</p></div><div class="row"><button class="btn small" type="button" data-class-select="'+esc(item.id)+'">查看与编辑</button>'+toggle('sports',item)+'</div></article>').join('')||'<p class="empty">暂无专项。添加后可在专项内设置细分选项。</p>');
    }
    function sportDetail(sport) {
      const children=draft.subdivisions.filter(item=>item.sportId===sport.id);
      return '<div class="catalog-detail-back"><button class="btn small" type="button" data-class-back>返回专项列表</button></div><section class="form-card" data-class-detail="'+esc(sport.id)+'"><h2>'+esc(sport.name||'新专项')+(sport.disabled?' <span class="pill">已停用</span>':'')+'</h2><div class="form-grid"><label class="field"><span>专项名称</span>'+input('sports',sport,'name')+'</label><label class="field"><span>细分称谓</span>'+input('sports',sport,'subdivisionLabel')+'</label></div><section class="catalog-definition-block" aria-labelledby="classificationSubdivisionsTitle"><h3 id="classificationSubdivisionsTitle">'+esc(sport.subdivisionLabel||'细分')+'选项</h3><div class="management-table-wrap"><table class="management-table"><thead><tr><th>名称</th><th>状态</th><th>操作</th></tr></thead><tbody>'+(children.map(item=>'<tr><td>'+input('subdivisions',item,'name')+'</td><td>'+(item.disabled?'已停用':'在用')+'</td><td>'+toggle('subdivisions',item)+'</td></tr>').join('')||'<tr><td colspan="3" class="empty">暂无细分选项。</td></tr>')+'</tbody></table></div><button class="btn small" type="button" data-class-add="subdivisions">添加细分</button></section></section>';
    }
    function ages() {
      return '<p class="note">按每次测试时的周岁筛选，包含起始和结束年龄。</p><div class="management-table-wrap"><table class="management-table"><thead><tr><th>名称</th><th>起始周岁</th><th>结束周岁</th><th>状态</th><th>操作</th></tr></thead><tbody>'+(draft.ageBands.map(item=>'<tr><td>'+input('ageBands',item,'name')+'</td><td>'+input('ageBands',item,'min','number')+'</td><td>'+input('ageBands',item,'max','number')+'</td><td>'+(item.disabled?'已停用':'在用')+'</td><td>'+toggle('ageBands',item)+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">暂无年龄分组。</td></tr>')+'</tbody></table></div><button class="btn small" type="button" data-class-add="ageBands">添加年龄组</button>';
    }
    function render(target=container) {
      capture();container=target;if(!container||!draft)return;
      const sport=draft.sports.find(item=>item.id===selected);
      container.innerHTML='<form class="classification-editor" data-class-page="'+tab+'">'+(tab==='ageBands'?ages():sport?sportDetail(sport):sportList())+'<p class="field-error" role="alert"'+(message?'':' hidden')+'>'+esc(message)+'</p><div class="row"><button class="btn primary" type="submit">保存</button><button class="btn" type="button" data-class-cancel>撤销未保存修改</button><span class="note" role="status" data-class-status></span></div></form>';
      container.querySelectorAll('[data-class-select]').forEach(button=>button.onclick=()=>{capture();selected=button.dataset.classSelect;render();});
      const back=container.querySelector('[data-class-back]');if(back)back.onclick=()=>{capture();selected='';render();};
      container.querySelectorAll('[data-class-toggle]').forEach(button=>button.onclick=()=>{if(busy)return;capture();const[collection,itemId]=JSON.parse(button.dataset.classToggle);const item=draft[collection].find(value=>value.id===itemId);item.disabled=!item.disabled;render();});
      container.querySelectorAll('[data-class-add]').forEach(button=>button.onclick=()=>{
        if(busy)return;capture();const collection=button.dataset.classAdd,item={id:crypto.randomUUID(),name:''};
        if(collection==='sports'){item.subdivisionLabel='主要细分';selected=item.id;}
        if(collection==='subdivisions')item.sportId=selected;
        if(collection==='ageBands'){item.min=null;item.max=null;}
        draft[collection].push(item);render();
        [...container.querySelectorAll('[data-class-field]')].find(node=>JSON.parse(node.dataset.classField)[1]===item.id)?.focus();
      });
      container.querySelector('[data-class-cancel]').onclick=()=>{if(busy||dirty()&&!root.confirm('放弃尚未保存的分类修改？'))return;container=null;reset();if(!draft.sports.some(item=>item.id===selected))selected='';render(target);};
      container.querySelector('form').onsubmit=save;
      container.querySelectorAll('input,button').forEach(control=>control.disabled=busy);
    }
    async function save(event) {
      event?.preventDefault();if(busy)return false;capture();busy=true;message='';render();
      let saved=false;
      try {
        const normalized=root.RingsideClassifications.normalize(draft);
        await host.commit(next=>{
          if(JSON.stringify(next.classifications)!==baseline)throw Error('专项或年龄分组已被修改，请重新打开后核对。');
          next.classifications=clone(normalized);
        });
        const target=container;container=null;reset();container=target;saved=true;
      } catch(error) { message=error.message; }
      finally { busy=false;render();if(saved)container?.querySelector('[data-class-status]')?.replaceChildren(document.createTextNode('已保存')); }
      return saved;
    }
    function open(nextTab='sports') { if(busy)return false;container=null;tab=nextTab==='ageBands'?'ageBands':'sports';selected='';reset();return true; }
    function beforeLeave() { if(busy)return false;if(dirty()&&!root.confirm('分类设置有未保存修改，放弃这些修改？'))return false;container=null;draft=null;return true; }
    return {open,render,save,beforeLeave,isOpen:()=>!!draft,isBusy:()=>busy,isDirty:dirty,desktopCloseStatus:()=>({busy,unsaved:dirty()})};
  }
  root.RingsideClassificationUI={create};
})(window);
