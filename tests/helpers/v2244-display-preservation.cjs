"use strict";
// Exact data protection: only the current comparison's observed display changes
// are permitted. Raw records, calculation basis and every narrative stay exact.
function createProof(){
 const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
 const canonical=value=>JSON.stringify(value,function(_key,item){return item&&!Array.isArray(item)&&typeof item==="object"?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item;});
 const equal=(a,b)=>canonical(a)===canonical(b),require=(ok,message)=>{if(!ok)throw Error(message);},same=(a,b,message)=>require(equal(a,b),message);
 function document(library,sample){const found=library.longitudinalReports?.find(item=>item.athleteId===sample.athleteId&&item.key===sample.documentKey);require(found,"The original comparison document is missing");return found;}
 function timestamp(actual,previous,window){if(actual===previous)return;const time=Date.parse(actual);require(Number.isFinite(time)&&time>=Date.parse(window.start)&&time<=Date.parse(window.end),"Comparison timestamp is outside the verified launch window");require(new Date(time).toISOString()===actual,"Comparison timestamp is not canonical");}
 function transition(actual,original,previous,{capture,window,allowedCharts=[]}){
  require(actual.key===original.key&&actual.athleteId===original.athleteId,"Comparison identity changed");
  const views=actual.views||{},oldViews=previous.views||{},expected=clone(oldViews),captured={...oldViews.detailOpen,...capture.detailOpen};
  same(Object.keys(views).filter(key=>key!=="charts").sort(),Object.keys(oldViews).filter(key=>key!=="charts").sort(),"Unexpected comparison display field");
  require(equal(views.charts,oldViews.charts)||allowedCharts.some(charts=>equal(charts,views.charts)),"Unrequested chart date metric or option change");
  require(equal(views.detailOpen,oldViews.detailOpen)||equal(views.detailOpen,captured),"Disclosure state differs from its observed controls");
  require(views.reportScroll===oldViews.reportScroll||views.reportScroll===capture.reportScroll,"Report scroll differs from the observed window");
  expected.charts=views.charts;expected.detailOpen=views.detailOpen;expected.reportScroll=views.reportScroll;if(views.charts===undefined)delete expected.charts;
  same(views,expected,"Another comparison display setting changed");
  same(actual.revision,previous.revision+(equal(views,oldViews)?0:1),"Revision does not match the exact display transition");timestamp(actual.updated,previous.updated,window);
  const restored=clone(actual);for(const key of["views","revision","updated"])restored[key]=clone(original[key]);same(restored,original,"Comparison body basis mode selection or another protected field changed");
  return{document:clone(actual),capture:clone(capture)};
 }
 function library(actual,original,sample,expectedDocument){
  const restored=clone(actual),oldDocs=original.longitudinalReports||[],documents=actual.longitudinalReports||[];
  same(documents.map(item=>item.key),oldDocs.map(item=>item.key),"Comparison inventory or ordering changed");
  documents.forEach((item,index)=>same(item,item.key===sample.documentKey?expectedDocument:oldDocs[index],"An unrelated comparison or unproved current document changed"));
  restored.longitudinalReports=clone(original.longitudinalReports);for(const key of["version","updated","activeAthleteId","activeRecordId"])restored[key]=clone(original[key]);same(restored,original,"An original record timestamp narrative owner catalog or evaluation scheme changed");
 }
 function snapshot(actual,original,sample,expectedDocument){library(actual.library,original.library,sample,expectedDocument);same(actual.reports,original.reports,"A single-report calculation or narrative changed");if(actual.activeComparison){same(actual.activeComparison.athleteId,sample.athleteId,"Active owner changed");same(actual.activeComparison.recordIds,sample.recordIds,"Report record selection changed");same(actual.activeComparison.dates,sample.dates,"Report dates changed");same(actual.activeComparison.document,expectedDocument,"Active comparison document differs from the stored proof");}}
 function actions(sample){return[{panel:"fvp_sj:profile",kind:"date",key:sample.recordIds[0],checked:false},{panel:"fvp_sj:profile",kind:"date",key:sample.recordIds[0],checked:true},{panel:"fvp_sj:profile",kind:"option",key:"fv",checked:false},{panel:"fvp_sj:profile",kind:"option",key:"fv",checked:true},{panel:"sprint_fvp:profile",kind:"metric",key:"F0",checked:false},{panel:"sprint_fvp:profile",kind:"metric",key:"F0",checked:true}];}
 function replay(log,initial,original,sample,window,patch,reopened=false){
  same(log.actions.map(({panel,kind,key,checked})=>({panel,kind,key,checked})),reopened?[]:actions(sample),"Requested display action inventory differs");let views=clone(initial.views);
  for(const action of log.actions){const chart=views.charts?.[action.panel]||{},delta=action.kind==="date"?{recordIds:action.checked?[...new Set([...(chart.recordIds||sample.recordIds),action.key])]:(chart.recordIds||sample.recordIds).filter(id=>id!==action.key)}:action.kind==="option"?{options:{[action.key]:action.checked}}:{metrics:{[action.key]:action.checked}};same(action.delta,delta,"Action changes an unrequested setting");views=patch(views,action.panel,delta,sample.recordIds);same(action.expectedCharts,views.charts,"Action chart state differs from source display rules");}
  let previous=initial,index=0;const documents=[],applied=new Set();for(const item of log.transitions){require(Number.isInteger(item.actionIndex)&&item.actionIndex>=index&&item.actionIndex<=log.actions.length,"Invalid display action ordering");index=item.actionIndex;const result=transition(item.document,original,previous,{capture:item.capture,window,allowedCharts:index?[log.actions[index-1].expectedCharts]:[]});same({...result,actionIndex:index},item,"Recorded transition differs from its exact replay");previous=result.document;documents.push(previous);if(index&&equal(previous.views.charts,log.actions[index-1].expectedCharts))applied.add(index);}
  same([...applied],log.actions.map((_value,index)=>index+1),"A requested display action has no matching saved document transition");same(previous,log.expectedDocument,"Final document differs from the exact display replay");return{document:clone(previous),documents,charts:views.charts};
 }
 return{clone,canonical,equal,require,same,document,timestamp,transition,library,snapshot,actions,replay};
}
async function capture(page){return page.evaluate(()=>({reportScroll:window.scrollY,detailOpen:Object.fromEntries([...document.querySelectorAll("#reportView .details-group,#reportView [data-raw-trials],#reportView [data-sprint-fvp-display-settings],#reportView .longitudinal-capability-parameters")].filter(node=>node.id).map(node=>[node.id,node.open]))}));}
async function installGuard(page,original,sample,initialDocument,windowStart){
 await page.evaluate(({source,original,sample,initialDocument,windowStart})=>{
  const P=(0,eval)("("+source+")")(),prior=P.document(original,sample),records=new Map(original.athletes.flatMap(owner=>owner.records.map(record=>[record.recordId,record])));
  const state=window.__displayPreservation2244={writes:0,blocked:[],actions:[],transitions:[],expectedDocument:P.clone(initialDocument),windowStart};
  const reject=error=>{state.blocked.push(error.message||String(error));throw error;};
  const capture=()=>({reportScroll:window.scrollY,detailOpen:Object.fromEntries([...document.querySelectorAll("#reportView .details-group,#reportView [data-raw-trials],#reportView [data-sprint-fvp-display-settings],#reportView .longitudinal-capability-parameters")].filter(node=>node.id).map(node=>[node.id,node.open]))});
  const checkRecords=values=>{for(const record of values)P.same(record,records.get(record.recordId),"Existing raw record or narrative would change");};
  const checkDocs=documents=>{if(documents===undefined)return;const expected=original.longitudinalReports.map(doc=>doc.key===sample.documentKey?state.expectedDocument:doc);P.same(documents,expected,"Saved comparison differs from verified display transitions");};
  const store=RingsideLongitudinalStore,put=store.put.bind(store);
  store.put=(library,document)=>{try{if(document.key!==sample.documentKey)P.same(document,original.longitudinalReports.find(doc=>doc.key===document.key),"An unrelated comparison would change");else{const proof=P.transition(document,prior,state.expectedDocument,{capture:capture(),window:{start:windowStart,end:new Date().toISOString()},allowedCharts:state.actions.length?[state.actions.at(-1).expectedCharts]:[]});state.transitions.push({...proof,actionIndex:state.actions.length});state.expectedDocument=P.clone(document);}return put(library,document);}catch(error){return reject(error);}};
  const repo=App.getRepository(),save=repo.save.bind(repo),saveRecords=repo.saveRecords.bind(repo);
  repo.saveRecords=async(values,checks,options={})=>{try{checkRecords(values);checkDocs(options.longitudinalReports);P.require(!options.newAthletes?.length,"Adding an athlete is not display verification");state.writes++;return await saveRecords(values,checks,options);}catch(error){return reject(error);}};
  repo.save=async(next,values=[],removals={},checks={})=>{try{checkRecords(values);checkDocs(next.longitudinalReports);P.require(!Object.values(removals).some(value=>Array.isArray(value)&&value.length),"Deleting data is not display verification");const full=P.clone(next);P.same(full.athletes.map(owner=>owner.id),original.athletes.map(owner=>owner.id),"Athlete inventory changed");full.athletes.forEach((owner,index)=>{P.same(owner.records.map(record=>record.recordId),original.athletes[index].records.map(record=>record.recordId),"Record inventory changed");owner.records=P.clone(original.athletes[index].records);});P.library(full,original,sample,state.expectedDocument);state.writes++;return await save(next,values,removals,checks);}catch(error){return reject(error);}};
  for(const name of["importLibrary","importRows","stageImport","restorePrevious"])if(typeof repo[name]==="function")repo[name]=async()=>reject(Error("Imports and restores are prohibited during display verification"));
 },{source:createProof.toString(),original,sample,initialDocument,windowStart});
}
module.exports={createProof,capture,installGuard,...createProof()};
