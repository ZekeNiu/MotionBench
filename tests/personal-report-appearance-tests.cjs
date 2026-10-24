"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const c = vm.createContext({ console, Intl, crypto: require("node:crypto").webcrypto }); c.window = c;
for (const name of ["calc", "fvp", "sprint-fvp", "sprint-fvp-confidence", "sprint-elasticity", "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions", "generic-report", "report-appearance", "viz", "report"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/ringside-${name}.js`), "utf8"), c, { filename: name });
const V = c.RingsideViz, A = c.RingsideReportAppearance, T = A.tokens(); let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
const jumpItems = [
  { id:"cmj",label:"CMJ",value:42.4 }, { id:"sj",label:"SJ",value:36.8 },
  { id:"dj",label:"DJ",value:34.6,rsi:1.72 }, { id:"hop",label:"Hop",value:29.6,rsi:1.92 },
  { id:"cmrj",label:"CMRJ",value:39.2,rsi:1.83 }
];
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
test("approved measurement colors are distinct from unchanged assessment/pain colors", () => {
  assert.equal(T.id, "ink-teal-history-v1");
  assert.equal(V.C.neutral, "#066c64"); assert.equal(V.C.ink, "#213836");
  for (const [key, value] of Object.entries({green:"#187459",amber:"#8a5a12",red:"#b23f3d",gray:"#66707b"})) assert.equal(V.C[key], value);
  const fms = V.fms([0, 1, 2, 3].map((score, i) => ({label:"动作"+i,score})));
  for (const tone of [V.C.red,V.C.amber,V.C.green]) assert.ok(fms.includes(`fill="${tone}"`));
  const compare = V.compare([{label:"已评价指标",value:3,target:5,status:"red",unit:"m"}]);
  assert.match(compare, /fill="#b23f3d"/);
});
test("jump test IDs keep paired/trio colors after filtering and values remain above the bars", () => {
  const before = JSON.stringify(jumpItems), expected = {cmj:"#066c64",sj:"#458f86",dj:"#0e6f81",hop:"#5191a1",cmrj:"#0d5665"};
  for (const items of [jumpItems, [jumpItems[4],jumpItems[2]], [jumpItems[3]]]) {
    const html = V.jumpBars(items);
    for (const item of items) {
      const body = html.match(new RegExp(`<g class="viz-point" data-jump-test="${item.id}" data-jump-series="height"[^>]*>([\\s\\S]*?)</g>`))[1];
      const bar = attributes(body.match(/<rect[^>]*>/)[0]), label = attributes(body.match(/<text[^>]*>/)[0]);
      assert.equal(bar.fill, expected[item.id]); assert.ok(Number(label.y) < Number(bar.y));
    }
    assert.equal((html.match(/data-jump-legend=/g)||[]).length,items.length);
    for (const m of html.matchAll(/<text[^>]*data-jump-value="rsi"[^>]*>/g)) { const attrs=attributes(m[0]);assert.equal(attrs.fill,"#4e586c");assert.equal(attrs.stroke,"white");assert.equal(attrs["paint-order"],"stroke"); }
    assert.doesNotMatch(html, /<path|<polyline/); assert.match(html, /柱色：测试项目/);
  }
  assert.equal(JSON.stringify(jumpItems), before);
});
test("FVP uses one force and one power hue for all models, preserving model dashes and solver results", () => {
  const record = c.RingsideModel.defaults(); record.athlete.mass=72;record.enabled.fvp_sj=true;record.fvpConfig.fvp_sj.distanceCm=33;
  record.data.fvp_sj=[0,20,40,60,80].map((load,i)=>({id:"appearance_sj_"+i,load,height:[33,27,22,14,10][i],excluded:false}));
  const before=JSON.stringify(record), s=c.RingsideFVP.solve(record,"fvp_sj");
  assert.ok(Math.abs(s.current.F0-35.51562707103642)<1e-9);
  const graph={id:"fvp_sj",valid:s.valid,profiles:[{...s.current,kind:"current",label:"当前剖面"},{...s.optimum,kind:"optimum",label:"90° 最优"}],points:s.points.map(p=>({load:p.load,height:p.heightCm,force:p.forceRelative,velocity:p.velocity,power:p.powerRelative,n:p.n})),band:[]};
  const graphBefore=JSON.stringify(graph), html=V.jumpFvp(graph,{fv:true,pv:true,optimum:true});
  const lines=[...html.matchAll(/<polyline[^>]*data-fvp-model[^>]*>/g)].map(m=>attributes(m[0])); assert.equal(lines.length,4);
  for(const line of lines){assert.equal(line.stroke,line["data-measurement-role"]==="force"?"#066c64":"#8d662c");assert.equal(line.opacity,"1");assert.equal(line["stroke-dasharray"],line["data-fvp-model"]==="optimum"?"7 5":undefined);}
  assert.equal(JSON.stringify(record),before);assert.equal(JSON.stringify(graph),graphBefore);
});
test("ISO symmetry and lactate heart rate use power while semantic pain and threshold zones retain status colors", () => {
  const axes=["肩","膝","踝"].map((label,i)=>({label,strength:75+i,symmetry:90+i,pain:i===0,strengthSources:[],symmetrySources:[]}));
  const iso=V.isoRadar({axes});
  for(const[key,tone]of[["strength",T.force],["symmetry",T.power]]) assert.match(iso,new RegExp(`data-radar-series="${key}"[\\s\\S]*?stroke="${tone}"`));
  assert.match(iso,/fill="#b23f3d"[^>]*>肩 · 疼痛/);
  const lac=V.lactate([{speed:2,lactate:1,hr:115},{speed:3,lactate:2,hr:145},{speed:4,lactate:5,hr:170}],{lt1:2.4,lt2:3.6});
  assert.match(lac,/data-measurement-role="heart-rate"[^>]*stroke="#8d662c"[^>]*stroke-dasharray="5 4"/);
  for(const tone of[V.C.green,V.C.amber,V.C.red])assert.ok(lac.includes(`fill="${tone}" opacity=".045"`));
  assert.doesNotMatch(lac,/蓝色实线|红色虚线/);
});
test("elasticity preserves three variable roles and sprint distance gives ER a fourth hue", () => {
  const curve=[{changePct:0,deltaPct:0},{changePct:10,deltaPct:5}];
  const html=V.jumpElasticity({force:curve,velocity:curve,both:curve});
  for(const[key,tone]of[["force",T.force],["velocity",T.power],["both",T.elasticityCombined]])assert.match(html,new RegExp(`data-response-series="${key}"[\\s\\S]*?stroke="${tone}"`));
  const distance=V.sprintElasticityDistance({valid:true,points:[{distanceM:10,Fe:.7,ve:.4,EN:.8,ER:1.5},{distanceM:20,Fe:.5,ve:.6,EN:.75,ER:1}],current:{distanceM:10,Fe:.7,ve:.4,EN:.8,ER:1.5}});
  const lines=[...distance.matchAll(/<polyline[^>]*data-distance-series[^>]*>/g)].map(m=>attributes(m[0]));assert.equal(lines.length,4);
  for(const line of lines)assert.equal(line.stroke,({Fe:"#066c64",ve:"#8d662c",EN:"#945a8f",ER:"#2c7fb1"})[line["data-distance-series"]]);
  assert.equal(lines[3]["stroke-dasharray"],"5 4");assert.equal(lines[3]["data-distance-axis"],"right");
});
test("LVP action identities survive filtering and externally projected date/person colors take precedence", () => {
  const ids=["bench","landmineR","landmineL","squat","deadlift"], colors=A.colors(ids);
  const series=id=>({id,label:id,points:[{load:10,velocity:1},{load:30,velocity:.6}]});
  for(const id of ids){const html=V.lvp([series(id)],{showBand:false,showEstimate:false});assert.ok(html.includes(`stroke="${colors[id]}" stroke-width="2.5"`));}
  assert.match(V.lvp([{...series("bench"),color:"#014e47",dash:"5 3"}],{}),/stroke="#014e47" stroke-width="2.5" stroke-dasharray="5 3"/);
  const latest=V.lvp([{...series("bench"),color:"#014e47",strokeWidth:2.6,latest:true,dash:"5 3"}],{});
  assert.match(latest,/stroke="#014e47" stroke-width="2.6" stroke-dasharray="5 3"/);assert.match(latest,/fill="#014e47" font-weight="600"/);
});
test("generic trial identities are assigned before pagination and do not shift when earlier metrics lack data", () => {
  const ids=Array.from({length:9},(_,i)=>"metric_"+i), colors=A.colors(ids);
  const series=ids.map((id,i)=>({id,label:id,points:[{id:"trial_"+i,index:1,value:10+i}]}));
  for(const subset of[series,series.slice(5),[series[8]]]){
    const data={kind:"trials",available:true,categoryIds:ids,panels:[{unit:"cm",series:subset}]},before=JSON.stringify(data),html=V.generic(data);
    for(const item of subset){const mark=html.match(new RegExp(`data-generic-trial="${item.points[0].id}"[^>]*>[\\s\\S]*?<(?:circle|rect|polygon)[^>]*fill="([^"]+)"`));assert.equal(mark?.[1],colors[item.id]);}
    assert.equal(JSON.stringify(data),before);
  }
});
test("personal report rendering and repeated layout retain record facts while applying the scoped theme", () => {
  const record=c.RingsideModel.sampleRecord(),before=JSON.stringify(record),report=c.RingsideReport.build(record);c.RingsideReport.render(report);
  assert.equal(JSON.stringify(record),before);
  const variables={},container={dataset:{},style:{setProperty:(key,value)=>variables[key]=value},querySelectorAll:()=>[]};
  c.RingsideReport.layoutCharts(container);assert.equal(container.dataset.reportAppearance,T.id);assert.equal(variables["--report-appearance-ink"],T.ink);assert.equal(variables["--green"],undefined);
});
console.log(`${passed} personal report appearance checks passed`);
