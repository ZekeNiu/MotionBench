"use strict";
// Exercise the visible selector; never manufacture record choices in app state.
function selectionUI(page){
  const node=page.locator("#reportSelection"),dialog=page.locator("#reportReferenceDialog");
  const ensure=async()=>{if(!await node.isVisible()){await page.evaluate(()=>App.openReportSetup("personal",{edit:!App.getTeam?.(),step:2}));await node.waitFor({state:"visible"});}};
  const step=async target=>{
    await ensure();for(let pass=0;pass<4;pass++){const current=await page.evaluate(()=>App.getReportSetup?.()?.step);if(!current||current===target)return;
      await page.locator(current>target?'#reportWorkflowBack':'#reportWorkflowNext').click();
      const next=await page.evaluate(()=>App.getReportSetup?.()?.step);if(next===current)throw Error('Report workflow could not advance: '+await page.locator('#reportWorkflowError').innerText());
    }
  };
  const mode=async value=>{await step(2);const input=node.locator("[data-analysis-mode]");if(await input.count())await input.selectOption(value);};
  const open=async kind=>{await ensure();if(await page.evaluate(()=>!!App.getReportSetup?.()?.step)){await step(kind==='athletes'?2:3);return;}const button=node.locator('[data-selection-toggle="'+kind+'"]');if(await button.getAttribute("aria-expanded")!=="true")await button.click();};
  const chooseAthlete=async(id,checked=true)=>{await open("athletes");await node.locator('[data-select-athlete="'+id+'"]').setChecked(checked);};
  const chooseRecord=async(aid,rid,checked=true)=>{await open("records");await node.locator('[data-person="'+aid+'"] [data-select-record="'+rid+'"]').setChecked(checked);};
  const removeAthlete=async id=>{await open("athletes");await node.locator('[data-remove-athlete="'+id+'"]').click();};
  const openReference=async id=>{await mode("horizontal");await open("athletes");await node.locator(id?'[data-edit-reference="'+id+'"]':'[data-add-reference]').click();await dialog.waitFor({state:"visible"});return dialog;};
  const confirmReference=async()=>{await dialog.locator("[data-reference-confirm]").click();await dialog.waitFor({state:"hidden"});};
  const apply=async()=>{await ensure();if(await page.evaluate(()=>!!App.getReportSetup?.()?.step)){await step(4);await page.locator('#reportWorkflowNext').click();}else await node.locator("[data-apply-selection]").click();};
  async function applyResolvingStandards({configure}={}){
    await apply();
    for(let pass=0;pass<12;pass++){
      await page.waitForFunction(()=>App.getReportSetup?.()===null||document.querySelector("#reportReferenceDialog[open] [data-standard-choice]")||(App.getReportSetup?.()?.step?App.getReportSetup()?.busy===false:!document.querySelector('#reportSelection [data-apply-selection]')?.disabled&&!document.querySelector('#reportSelection .selection-status')?.textContent.includes("正在")),null,{timeout:120000});
      if(!await dialog.isVisible())return;
      const choices=dialog.locator('[data-standard-choice]:has(option[value="0"])');
      for(let i=0;i<await choices.count();i++)await choices.nth(i).selectOption("0");
      if(configure)await configure(dialog);
      await confirmReference();await apply();
    }
    throw Error("Group standard configuration did not settle");
  }
  return {node,dialog,ensure,step,mode,open,chooseAthlete,chooseRecord,removeAthlete,openReference,confirmReference,apply,applyResolvingStandards};
}
module.exports={selectionUI};
