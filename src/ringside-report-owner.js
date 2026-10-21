(function(root) {
  'use strict';
  function create({controllers, state}) {
    const current = () => controllers.find(controller => controller.active()) || null;
    const binding = () => current() ? {reportOwner:current().owner()} : {reportOwner:'',athleteId:state()?.athleteId,recordId:state()?.recordId};
    return {
      controller: current,
      active: () => !!current(),
      hasContent: () => !!current() || !!state(),
      binding,
      matchesBinding: value => {
        if(!value)return false;
        const selected=binding();
        return selected.reportOwner ? selected.reportOwner===value.reportOwner : !value.reportOwner && !!state() && selected.athleteId===value.athleteId && selected.recordId===value.recordId;
      },
      document: () => current()?.document() || state(),
      owner: () => current()?.owner() || '',
      basis: () => current()?.basis() || '',
      facts: () => current()?.facts(),
      payload: () => current()?.payload(),
      render: () => current()?.render(),
      edit: () => current()?.edit(),
      changeMode: value => current()?.changeMode(value),
      setNarrative: (...args) => current()?.setNarrative(...args),
      setViews: (...args) => current()?.setViews(...args),
      isLoading: () => controllers.some(controller => controller.isLoading()),
      pendingDisplaySave: () => {
        const pending = controllers.map(controller => controller.pendingDisplaySave?.()).filter(Boolean);
        return pending.length ? Promise.all(pending) : null;
      },
      clear: () => controllers.forEach(controller => controller.clear()),
      cancelPending: () => controllers.forEach(controller => controller.cancelPending?.()),
    };
  }
  root.RingsideReportOwner = {create};
})(window);
