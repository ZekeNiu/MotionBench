"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-report-appearance.js"),"utf8"),context);
const A=context.RingsideReportAppearance,T=A.theme,plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;function test(name,run){run();passed++;console.log("PASS "+name);}
const periods=count=>Array.from({length:count},(_,i)=>({id:"record-"+String(i+1).padStart(3,"0"),date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),label:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),color:"#b76735"}));
function contrast(color){const [r,g,b]=[1,3,5].map(i=>{const v=parseInt(color.slice(i,i+2),16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return 1.05/(.2126*r+.7152*g+.0722*b+.05);}
function deepFreeze(object){if(object&&typeof object==="object"){Object.values(object).forEach(deepFreeze);Object.freeze(object);}return object;}

test("one fixed theme separates measured channels from status colors",()=>{
 assert.equal(T.id,"ink-teal-history-v1");assert.equal(A.tokens(),T);assert.equal(Object.isFrozen(T.jumps),true);
 assert.deepEqual(plain(T.jumps),{cmj:"#066c64",sj:"#458f86",dj:"#0e6f81",hop:"#5191a1",cmrj:"#0d5665"});
 assert.equal(T.rsi,"#4e586c");assert.equal(T.force,"#066c64");assert.equal(T.power,"#8d662c");assert.equal(T.elasticityCombined,"#945a8f");assert.equal(T.er,"#2c7fb1");assert.equal(A.testColor("dj"),T.jumps.dj);
});
test("two and three natural-day reports use the continuous history endpoints and newest-day focus",()=>{
 const two=A.dates(periods(2)),three=A.dates(periods(3));
 assert.deepEqual(Object.values(two.byRecord).map(x=>x.color),[T.historicalAnchors7[0],T.latest]);
 assert.deepEqual(Object.values(three.byRecord).map(x=>x.color),[T.historicalAnchors7[0],T.historicalAnchors7[6],T.latest]);
 assert.deepEqual(Object.values(three.byRecord).map(x=>x.strokeWidth),[1.8,1.8,2.6]);
});
test("eight days reproduce the approved seven historical anchors and latest ink teal exactly",()=>{
 const result=A.dates(periods(8));assert.deepEqual(Object.values(result.byRecord).map(x=>x.color),[...T.historicalAnchors7,T.latest]);
 assert.equal(result.latestDay,"2026-01-08");
});
test("seventeen days retain all records and generate intermediate historical colors without cycling eight bins",()=>{
 const result=A.dates(periods(17)),entries=Object.values(result.byRecord);assert.equal(entries.length,17);assert.equal(new Set(entries.map(x=>x.color)).size,17);
 assert.ok(entries.slice(0,-1).some(x=>!T.historicalAnchors7.includes(x.color)));assert.ok(entries.every(x=>contrast(x.color)>=3));assert.equal(entries.filter(x=>x.latest).length,1);
});
test("same-day records share one date color and expose true titles plus unambiguous short IDs",()=>{
 const input=[{id:"first-same-tail",date:"2026-03-02",title:"上午原测",label:"2026-03-02 · 1 上午原测",created:"2099"},{id:"second-same-tail",date:"2026-03-02",title:"下午复测",label:"2026-03-02 · 2 下午复测",created:"2000"}],result=A.dates(input),a=result.byRecord[input[0].id],b=result.byRecord[input[1].id];
 assert.equal(a.color,T.latest);assert.equal(b.color,T.latest);assert.equal(a.strokeWidth,2.6);assert.equal(b.strokeWidth,2.6);
 assert.match(a.label,/上午原测 #/);assert.match(b.label,/下午复测 #/);assert.notEqual(a.label.match(/#(.+)$/)[1],b.label.match(/#(.+)$/)[1]);assert.doesNotMatch(a.label,/· 1/);assert.doesNotMatch(b.label,/· 2/);
});
test("calendar day alone determines the newest day regardless of input ordering or IDs",()=>{
 const input=periods(3).reverse();input[0].id="a-old-id";input[2].id="z-new-id";const result=A.dates(input);
 assert.equal(result.byRecord["a-old-id"].latest,true);assert.equal(result.byRecord["z-new-id"].latest,false);
 assert.equal(A.dates([{id:"invalid",date:"2026-02-30"}]).latestDay,"");
});
test("eight, sixteen and thirty-two identities have stable distinct colors with sufficient white contrast",()=>{
 const ids=Array.from({length:32},(_,i)=>"athlete-"+i),eight=A.colors(ids.slice(0,8)),sixteen=A.colors(ids.slice(0,16)),all=A.colors(ids);
 assert.deepEqual(Object.values(eight),plain(T.persons8));
 assert.deepEqual(Object.values(sixteen).slice(8),["#aa5a78","#01869a","#aa6237","#268b64","#5476b8","#8965a9","#6c8130","#917415"]);
 assert.equal(new Set(Object.values(all)).size,32);assert.ok(Object.values(all).every(color=>contrast(color)>=3));ids.slice(0,8).forEach(id=>assert.equal(all[id],eight[id]));
});
test("identity dictionaries safely retain repeated IDs and prototype-like names",()=>{
 const result=A.colors(["__proto__","constructor","__proto__","a"]);assert.equal(Object.keys(result).length,3);assert.equal(result.__proto__,T.persons8[0]);assert.equal(result.constructor,T.persons8[1]);
});
test("projection preserves frozen facts, callable fits and calculation identities while updating derived presentation",()=>{
 const ci=value=>value*2,p=periods(2),record={title:"原始记录",athlete:{date:p[0].date},data:{cmj:[{height:31}]}},stats={ci,raw:{status:"green",color:"#187459"}},profile={name:"原评价",color:"#b23f3d"},catalog={version:1};
 p[0].record=record;p[0].stats=stats;p[1].record={athlete:{date:p[1].date}};
 const model=deepFreeze({kind:"longitudinal",basis:"unchanged-basis",fingerprint:"unchanged-fingerprint",periods:p,records:[record],profile,catalog,risk:{series:p.map(x=>({id:x.id,recordId:x.id,label:x.label,color:x.color,values:[1,2]}))}}),before=JSON.stringify(model),out=A.project(model);
 assert.equal(JSON.stringify(model),before);assert.notEqual(out,model);assert.notEqual(out.periods[0],model.periods[0]);assert.equal(out.periods[0].record,record);assert.equal(out.periods[0].stats,stats);assert.equal(out.periods[0].stats.ci,ci);assert.equal(out.periods[0].stats.ci(3),6);assert.equal(out.profile,profile);assert.equal(out.catalog,catalog);assert.equal(out.basis,model.basis);assert.equal(out.fingerprint,model.fingerprint);
 assert.equal(out.risk.series[0].color,T.historicalAnchors7[0]);assert.equal(out.risk.series[1].color,T.latest);assert.equal(record.data.cmj[0].height,31);assert.equal(stats.raw.color,"#187459");
});
test("same-day display labels change only in the projection including dated metric suffixes",()=>{
 const p=periods(2);p[1].date=p[0].date;p[0].label=p[0].date+" · 1 原测";p[1].label=p[1].date+" · 2 复测";
 const model={kind:"longitudinal",periods:p,records:p.map((x,i)=>({recordId:x.id,title:i?"复测":"原测"})),risk:{series:p.map(x=>({id:x.id+":strength",recordId:x.id,label:x.label+" · 力量",color:x.color,values:[1]}))}},before=JSON.stringify(model),out=A.project(model);
 assert.equal(JSON.stringify(model),before);assert.equal(out.periods[0].label,p[0].label);assert.match(out.periods[0].displayLabel,/原测 #/);assert.match(out.periods[1].displayLabel,/复测 #/);assert.match(out.risk.series[0].displayLabel,/原测 #.+ · 力量$/);
});
test("a filtered projected date view retains the complete original date map and newest day",()=>{
 const input={kind:"longitudinal",periods:periods(8)},full=A.project(input),filtered=A.project({...full,periods:[full.periods[0],full.periods[3]]});
 assert.equal(Object.keys(filtered.appearance.byDate).length,8);assert.equal(filtered.appearance.latestDay,"2026-01-08");assert.equal(filtered.periods[1].color,full.periods[3].color);assert.equal(filtered.periods[1].latest,false);assert.equal(filtered.periods[1].strokeWidth,1.8);
});
test("horizontal focus reordering and chart filtering never reinterpret persons as dates",()=>{
 const participants=Array.from({length:16},(_,i)=>({id:"r"+i,recordId:"r"+i,athleteId:"a"+i,date:"2026-03-02",label:"队员"+i+" · 2026-03-02",color:"#b76735"}));
 const model={kind:"horizontal",participants,overview:{series:participants.map(x=>({id:x.id,recordId:x.id,label:x.label,color:x.color,values:[1,2]}))}},before=JSON.stringify(model),full=A.project(model),reordered=A.project({...full,participants:[full.participants[15],full.participants[0]],periods:[full.participants[15],full.participants[0]]});
 assert.equal(JSON.stringify(model),before);assert.equal(new Set(full.participants.map(x=>x.color)).size,16);assert.equal(reordered.participants[0].color,full.participants[15].color);assert.equal(reordered.periods[0].color,full.participants[15].color);assert.ok(reordered.periods.every(x=>!x.latest&&x.strokeWidth===1.8));
});
test("series measurement dashes and shapes survive projection after the eighth record",()=>{
 const p=periods(17),model={kind:"longitudinal",periods:p,figures:[{series:p.map(x=>({id:x.id+":symmetry",recordId:x.id,label:x.label,color:x.color,values:[1],dash:"5 3",shape:"diamond"}))}]},out=A.project(model);
 assert.equal(out.figures[0].series.length,17);assert.ok(out.figures[0].series.every(x=>x.dash==="5 3"&&x.shape==="diamond"&&!x.dateDash));
});
console.log(`report appearance: ${passed} groups passed`);
