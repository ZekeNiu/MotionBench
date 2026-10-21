"use strict";
function createMigrationProof(){
 const clone=value=>JSON.parse(JSON.stringify(value));
 function definitions(rows){for(const row of rows||[]){delete row.resultMeaning;delete row.directionStatus;}}
 function profile(value){if(value){delete value.sportId;delete value.subdivisionId;}}
 function library(input){
  const out=clone(input);delete out.classifications;delete out.horizontalReports;definitions(out.catalog?.definitions);
  for(const athlete of out.athletes||[]){profile(athlete.profile);for(const record of athlete.records||[]){profile(record.athlete);definitions(record.definitions);}}
  return out;
 }
 function report(input){
  const out=clone(input);
  // These are producer declarations added in 2.25, not stored score rules or
  // physical inputs. Keep the projection tied to their exact report paths.
  function projects(rows){for(const row of rows||[])if(Array.isArray(row.comparisonSubjectInputs)&&row.comparisonSubjectInputs.every(key=>typeof key==='string'))delete row.comparisonSubjectInputs;}
  function derived(rows){for(const row of rows||[])if(row.scoring===false&&row.resultMeaning==='numeric'&&row.directionStatus==='confirmed'&&row.direction==='none'&&typeof row.formula==='string'&&Array.isArray(row.dependencies)&&Array.isArray(row.sourceIds))delete row.direction;}
  projects(out.projects);for(const group of out.groups||[])projects(group.projects);
  derived(out.derived?.results);derived(out.stats?.derived?.results);
  for(const card of out.stats?.capabilityCards||[])for(const metric of card.metrics||[])derived(metric.variants);
  return JSON.parse(JSON.stringify(out,(key,value)=>['resultMeaning','directionStatus','canonicalDefinition','performanceDirection','sportId','subdivisionId'].includes(key)?undefined:value));
 }
 function validate(actual,reference,{requireClassifications=true}={}){
  const fail=message=>{throw Error(message);};
  if(reference.classifications){
   if(JSON.stringify(actual.classifications)!==JSON.stringify(reference.classifications)||JSON.stringify(actual.horizontalReports||[])!==JSON.stringify(reference.horizontalReports||[]))fail('Saved classifications or horizontal reports changed during preservation verification');
   return true;
  }
  if(!actual.classifications&&!requireClassifications)return true;
  const registry=actual.classifications;if(!registry||registry.version!==1)fail('Missing additive classification migration');
  const names=[...new Set((reference.athletes||[]).map(a=>a.profile?.sport).filter(s=>typeof s==='string'&&s.trim()))].sort();
  if(JSON.stringify(registry.sports.map(s=>s.name).sort())!==JSON.stringify(names)||registry.subdivisions.length||registry.ageBands.length)fail('Migration invented or merged classification values');
  if(new Set(registry.sports.map(s=>s.id)).size!==registry.sports.length)fail('Migration reused classification identities');
  for(const owner of reference.athletes||[]){const current=actual.athletes.find(a=>a.id===owner.id);if(!current)fail('Migration removed an athlete');
   if(current.profile.subdivisionId)fail('Migration inferred a subdivision');
   if(owner.profile?.sport?.trim()&&!registry.sports.some(s=>s.id===current.profile.sportId&&s.name===owner.profile.sport))fail('Migration changed exact sport membership');
  }
  if(actual.horizontalReports?.length)fail('Migration created a report without a request');
  return true;
 }
 return {library,report,validate};
}
module.exports={createMigrationProof,...createMigrationProof()};
