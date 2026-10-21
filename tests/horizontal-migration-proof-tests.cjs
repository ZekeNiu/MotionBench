"use strict";
const assert=require('node:assert/strict'),proof=require('./helpers/horizontal-migration-proof.cjs');
const original={catalog:{definitions:[{id:'m',direction:'higher'}]},athletes:[{id:'a',profile:{sport:'  原文专项  '},records:[{athlete:{sport:'历史专项'},definitions:[{id:'m',direction:'higher'}],data:{test:[{metrics:{m:12,resultMeaning:7}}]},narrative:{text:'原始正文'}}]}]};
const migrated=structuredClone(original);migrated.classifications={version:1,sports:[{id:'s',name:'  原文专项  '}],subdivisions:[],ageBands:[]};migrated.athletes[0].profile.sportId='s';migrated.catalog.definitions[0].resultMeaning='numeric';migrated.catalog.definitions[0].directionStatus='unconfirmed';migrated.athletes[0].records[0].definitions[0].resultMeaning='numeric';
assert.equal(proof.validate(migrated,original),true);assert.deepEqual(proof.library(migrated),original);
for(const mutate of [x=>x.classifications.sports[0].name='原文专项',x=>x.athletes[0].profile.sportId='missing',x=>x.classifications.subdivisions.push({id:'x',name:'猜测',sportId:'s'}),x=>x.horizontalReports=[{id:'unexpected'}]]){const invalid=structuredClone(migrated);mutate(invalid);assert.throws(()=>proof.validate(invalid,original));}
for(const mutate of [x=>x.athletes[0].records[0].data.test[0].metrics.resultMeaning=8,x=>x.athletes[0].records[0].definitions[0].direction='lower',x=>x.athletes[0].records[0].narrative.text='变化']){const changed=structuredClone(migrated);mutate(changed);assert.notDeepEqual(proof.library(changed),original);}
assert.equal(proof.validate(original,original,{requireClassifications:false}),true);
assert.throws(()=>proof.validate(original,original));
assert.equal(proof.validate(migrated,structuredClone(migrated)),true);
const changedRegistry=structuredClone(migrated);changedRegistry.classifications.sports[0].name='不可静默变更';
assert.throws(()=>proof.validate(changedRegistry,migrated));
const derived={id:'formula-result',formula:'a/b',dependencies:['a','b'],sourceIds:['source'],scoring:false,value:0.5,components:{a:1,b:2}};
const reportBefore={stats:{values:{a:1},derived:{results:[structuredClone(derived)]},capabilityCards:[{metrics:[{variants:[structuredClone(derived)]}]}],evaluationResults:{a:{score:80,direction:'higher'}}},derived:{results:[structuredClone(derived)]},projects:[{id:'project',selectionDirection:'higher',definitions:[{direction:'higher'}],context:{distanceCm:35}}],groups:[{projects:[{id:'project'}]}],record:{data:{a:1},narrative:{text:'原始正文'},comparisonSubjectInputs:['protected input']}};
const reportAfter=structuredClone(reportBefore);
for(const row of [reportAfter.stats.derived.results[0],reportAfter.derived.results[0],reportAfter.stats.capabilityCards[0].metrics[0].variants[0]])Object.assign(row,{resultMeaning:'numeric',directionStatus:'confirmed',direction:'none'});
reportAfter.projects[0].comparisonSubjectInputs=['distanceCm'];reportAfter.groups[0].projects[0].comparisonSubjectInputs=[];
assert.deepEqual(proof.report(reportAfter),proof.report(reportBefore),'Only newly declared comparison metadata can be projected away');
for(const mutate of [x=>x.projects[0].definitions[0].direction='lower',x=>x.projects[0].selectionDirection='lower',x=>x.stats.evaluationResults.a.direction='lower',x=>x.derived.results[0].direction='higher',x=>x.stats.capabilityCards[0].metrics[0].variants[0].direction='lower']){const changed=structuredClone(reportAfter);mutate(changed);assert.notDeepEqual(proof.report(changed),proof.report(reportBefore),'Existing and non-neutral directions remain protected');}
for(const mutate of [x=>x.stats.values.a=2,x=>x.stats.evaluationResults.a.score=81,x=>x.record.data.a=2,x=>x.record.narrative.text='变化',x=>x.derived.results[0].components.a=2,x=>x.projects[0].context.distanceCm=36,x=>x.record.comparisonSubjectInputs=['changed input']]){const changed=structuredClone(reportAfter);mutate(changed);assert.notDeepEqual(proof.report(changed),proof.report(reportBefore),'Values, scores, physical inputs and narrative remain protected');}
const historicalDirection=structuredClone(reportBefore);historicalDirection.derived.results[0].direction='none';
assert.notDeepEqual(proof.report(reportAfter),proof.report(historicalDirection),'A pre-existing direction is not discarded merely because it says none');
const undeclaredDirection=structuredClone(reportAfter);delete undeclaredDirection.derived.results[0].directionStatus;
assert.notDeepEqual(proof.report(undeclaredDirection),proof.report(reportBefore),'Neutral direction projection requires the new producer declaration');
console.log('17 horizontal migration preservation checks passed');
