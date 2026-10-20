"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"src/ringside-app.js"),"utf8");
const start=source.indexOf("  function renderNarrativeStatus() {"),end=source.indexOf("  function saveEditor() {",start);
assert.ok(start>=0&&end>start);
const nodes={},node=id=>nodes[id]||=( {textContent:"",innerHTML:"",className:"",hidden:false} );
const c=vm.createContext({
  state:{narrative:{}},comparison:{narrative:{}},isComparison:false,job:null,library:{evaluationProfiles:[]},
  directionStatus:{changed:false,ruleOnly:false},document:{activeElement:null},$:node,
  renderAIStatus:()=>{},recordBasis:()=>"current-measurements",effectiveRecord:()=>({}),
  M:{fingerprintMatchesExceptAge:()=>false,sanitizeHTML:value=>value,textToHTML:value=>"<p>"+value+"</p>"},
});
vm.runInContext("const longitudinal={active:()=>isComparison};const narrativeOwner=()=>isComparison?comparison:state;const narrativeDirectionStatus=()=>directionStatus;"+source.slice(start,end),c);
let checks=0;
function render(narrative,{comparison=false,directions={changed:false,ruleOnly:false},running=false}={}){
  c.state.narrative={text:"single-source-body",basis:"current-measurements"};
  c.comparison.narrative={text:"comparison-source-body",basis:"current-measurements"};
  c.isComparison=comparison;c.directionStatus=directions;c.job=running?{}:null;
  (comparison?c.comparison:c.state).narrative=JSON.parse(JSON.stringify(narrative));
  const before=JSON.stringify([c.state,c.comparison]);
  vm.runInContext("renderNarrativeStatus()",c);
  assert.equal(JSON.stringify([c.state,c.comparison]),before,"rendering must not alter either saved owner or narrative metadata");
}
for(const comparison of [false,true]){
  const owner=comparison?"comparison":"personal";
  render({text:"",html:"",revision:4,updated:"2026-10-19T12:00:00Z"},{comparison});
  assert.equal(nodes.interpState.textContent,"");assert.equal(nodes.interpState.hidden,true);
  assert.equal(nodes.editorState.textContent,"");assert.equal(nodes.editorState.hidden,true);
  assert.equal(nodes.narrativeView.innerHTML,"");checks++;console.log("PASS "+owner+" empty narrative has no redundant state or body notice");
  render({text:"",origin:"AI"},{comparison,directions:{changed:true,ruleOnly:true}});
  assert.equal(nodes.interpState.textContent,"");assert.equal(nodes.interpState.hidden,true);checks++;
  render({text:"教练正文含有尚未填写，不得删改。",html:"<p>教练正文含有尚未填写，不得删改。</p>",basis:"current-measurements",origin:"manual"},{comparison});
  assert.equal(nodes.interpState.hidden,false);assert.equal(nodes.interpState.textContent,"已填写");
  assert.equal(nodes.narrativeView.innerHTML,"<p>教练正文含有尚未填写，不得删改。</p>");checks++;
  render({text:"需复核的原稿",basis:"earlier-measurements",origin:"manual"},{comparison});
  assert.equal(nodes.interpState.hidden,false);assert.equal(nodes.interpState.textContent,"数据已更新 · 待复核");
  assert.equal(nodes.interpState.className,"pill no-print amber");checks++;console.log("PASS "+owner+" real prose and stale-data warning remain intact");
}
render({text:"人工正文",basis:"current-measurements",origin:"manual"},{directions:{changed:true,ruleOnly:false}});
assert.equal(nodes.interpState.textContent,"分析依据已更新 · 待复核");checks++;
render({text:"",migrationReview:{required:true}});
assert.equal(nodes.interpState.hidden,false);assert.equal(nodes.interpState.textContent,"旧速度文字待复核");checks++;
render({text:"",basis:"current-measurements"},{running:true});
assert.equal(nodes.interpState.hidden,true);assert.equal(nodes.editorState.hidden,false);assert.equal(nodes.editorState.textContent,"AI正在生成");checks++;
render({text:"AI正文",basis:"current-measurements",origin:"AI"});
assert.equal(nodes.interpState.hidden,false);assert.equal(nodes.interpState.textContent,"AI稿");checks++;
console.log(`${checks} narrative status checks passed`);
