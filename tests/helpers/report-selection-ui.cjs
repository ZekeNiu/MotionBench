"use strict";
// Exercise the visible selector; never manufacture record choices in app state.
function selectionUI(page){
  const node=page.locator("#reportSelection"),dialog=page.locator("#reportReferenceDialog");
  const open=async kind=>{const button=node.locator('[data-selection-toggle="'+kind+'"]');if(await button.getAttribute("aria-expanded")!=="true")await button.click();};
  const chooseAthlete=async(id,checked=true)=>{await open("athletes");await node.locator('[data-select-athlete="'+id+'"]').setChecked(checked);};
  const chooseRecord=async(aid,rid,checked=true)=>{await open("records");await node.locator('[data-person="'+aid+'"] [data-select-record="'+rid+'"]').setChecked(checked);};
  const removeAthlete=async id=>{await open("athletes");await node.locator('[data-remove-athlete="'+id+'"]').click();};
  const openReference=async id=>{await open("athletes");await node.locator(id?'[data-edit-reference="'+id+'"]':'[data-add-reference]').click();await dialog.waitFor({state:"visible"});return dialog;};
  const confirmReference=async()=>{await dialog.locator("[data-reference-confirm]").click();await dialog.waitFor({state:"hidden"});};
  const apply=async()=>node.locator("[data-apply-selection]").click();
  async function applyResolvingStandards({configure}={}){
    await apply();
    for(let pass=0;pass<12;pass++){
      await page.waitForFunction(()=>document.querySelector("#reportReferenceDialog[open] [data-standard-choice]")||(!document.querySelector('#reportSelection [data-apply-selection]')?.disabled&&!document.querySelector('#reportSelection .selection-status')?.textContent.includes("正在")),null,{timeout:120000});
      if(!await dialog.isVisible())return;
      const choices=dialog.locator('[data-standard-choice]:has(option[value="0"])');
      for(let i=0;i<await choices.count();i++)await choices.nth(i).selectOption("0");
      if(configure)await configure(dialog);
      await confirmReference();await apply();
    }
    throw Error("Group standard configuration did not settle");
  }
  return {node,dialog,open,chooseAthlete,chooseRecord,removeAthlete,openReference,confirmReference,apply,applyResolvingStandards};
}
module.exports={selectionUI};
