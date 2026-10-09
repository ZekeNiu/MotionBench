"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const context = vm.createContext({console, Intl, crypto:require("node:crypto").webcrypto});
context.window = context;
for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "model", "evaluation"]) vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/ringside-"+name+".js"),"utf8"),context);
const M = context.RingsideModel, copy = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
function record(profile = {}) { return M.recordFromCatalog(M.normalizeCatalog(), {name:"测试运动员", ...profile}, {cmj:true}, "2026-10-09"); }

test("completed years change on the birthday and use the test date", () => {
  assert.equal(M.ageAtDate("2000-10-09", "2026-10-08"),25);
  assert.equal(M.ageAtDate("2000-10-09", "2026-10-09"),26);
  assert.equal(M.ageAtDate("2000-10-09", "2026-10-10"),26);
  assert.equal(M.ageAtDate("2000-10-09", "2020-10-09"),20);
  assert.equal(M.ageAtDate("2000-10-09", "2000-10-09"),0);
});
test("February 29 birthdays advance on March 1 in nonleap years", () => {
  assert.equal(M.ageAtDate("2004-02-29", "2026-02-28"),21);
  assert.equal(M.ageAtDate("2004-02-29", "2026-03-01"),22);
  assert.equal(M.ageAtDate("2004-02-29", "2024-02-29"),20);
  assert.equal(M.ageAtDate("2004-02-29", "2024-02-28"),19);
});
test("invalid dates and tests before birth have no computed age", () => {
  for (const date of ["", "2001-02-29", "2026-13-01", "2026-10-09T00:00:00Z", "0000-01-01", 20001009]) assert.equal(M.ageAtDate(date,"2026-10-09"),null);
  assert.equal(M.ageAtDate("2000-10-09","1999-01-01"),null);
  assert.equal(M.ageAtDate("2000-10-09","2026-02-30"),null);
});
test("age application preserves manual fallback and does not mutate on invalid birth", () => {
  const r = record(); r.athlete.age = 17.5;
  M.applyAge(r); assert.equal(r.athlete.age,17.5);
  M.applyAge(r,"2000-10-09"); assert.equal(r.athlete.age,26);
  const before = copy(r); assert.throws(()=>M.applyAge(r,"2026-02-30"),/生日/); assert.deepEqual(copy(r),before);
  assert.throws(()=>M.applyAge(r,"2027-10-09"),/测试日期/); assert.deepEqual(copy(r),before);
  M.applyAge(r,""); assert.equal(r.athlete.birthDate,""); assert.equal(r.athlete.age,26);
});
test("profile snapshots retain history and place experience in training context", () => {
  const r = record({birthDate:"2000-10-09",injuryHistory:"右踝既往扭伤",experienceYears:"3.5"});
  assert.equal(r.athlete.age,26); assert.equal(r.athlete.birthDate,"2000-10-09"); assert.equal(r.athlete.injuryHistory,"右踝既往扭伤");
  assert.equal(r.athlete.injury,""); assert.equal(r.trainingContext.experienceYears,"3.5"); assert.equal(r.athlete.experienceYears,undefined);
  assert.equal(M.profileFromRecord(r).experienceYears,"3.5"); assert.equal(M.profileFromRecord(r).injuryHistory,"右踝既往扭伤");
  assert.equal(M.validateRecord(r),true);
});
test("legacy mixed injury text is preserved without inventing history or birth", () => {
  const r = record(); delete r.athlete.birthDate; delete r.athlete.injuryHistory;
  r.athlete.age=18; r.athlete.injury="旧踝伤，今天仍疼痛"; r.trainingContext.experienceYears=2;
  const normalized = M.normalizeRecord(r), p = M.profileFromRecord(normalized);
  assert.equal(normalized.athlete.injury,r.athlete.injury); assert.equal(normalized.athlete.age,18);
  assert.equal(p.birthDate,""); assert.equal(p.injuryHistory,""); assert.equal(p.experienceYears,"2");
});
test("library and standalone import preserve additive profile fields", () => {
  const r = record({birthDate:"2000-10-09",injuryHistory:"既往右膝伤",experienceYears:"4"});
  const p = M.profileFromRecord(r), lib = M.libraryDefaults();
  lib.athletes=[{id:r.athleteId,name:p.name,profile:p,records:[r]}];
  assert.deepEqual(copy(M.normalizeLibrary(lib).athletes[0].profile),copy(p));
  assert.deepEqual(copy(M.normalizeLibrary(M.recordEnvelope(r,p)).athletes[0].profile),copy(p));
  assert.throws(()=>M.normalizeLibrary(M.recordEnvelope(r,{...p,birthDate:"2999-01-01"})),/今天/);
});
test("different birthdays produce different ages in the same test batch", () => {
  const first=record({birthDate:"2000-10-09"}),second=record({birthDate:"2000-10-10"});
  assert.equal(first.athlete.age,26); assert.equal(second.athlete.age,25);
  first.athlete.date=second.athlete.date="2026-10-10";M.applyAge(first);M.applyAge(second);
  assert.equal(first.athlete.age,26);assert.equal(second.athlete.age,26);
});
test("competition intervals use calendar days including leap days and same day", () => {
  const r = record();r.athlete.date="2024-03-01";
  r.trainingContext.previousCompetitionDate="2024-02-28";r.trainingContext.nextCompetitionDate="2024-03-03";
  assert.deepEqual(copy(M.competitionContext(r)),{daysSincePrevious:2,daysUntilNext:2});
  r.trainingContext.previousCompetitionDate=r.trainingContext.nextCompetitionDate=r.athlete.date;
  assert.deepEqual(copy(M.competitionContext(r)),{daysSincePrevious:0,daysUntilNext:0});
  r.trainingContext.previousCompetitionDate="";r.trainingContext.nextCompetitionDate="";
  assert.deepEqual(copy(M.competitionContext(r)),{daysSincePrevious:null,daysUntilNext:null});
});
test("invalid competition positions are rejected for field and record validation", () => {
  const r=record();r.trainingContext.previousCompetitionDate="2026-10-10";
  assert.match(M.validateField(r,"trainingContext.previousCompetitionDate",r.trainingContext.previousCompetitionDate),/上一场/);
  assert.throws(()=>M.validateRecord(r),/上一场/);
  r.trainingContext.previousCompetitionDate="2026-10-01";r.trainingContext.nextCompetitionDate="2026-10-08";
  assert.throws(()=>M.validateRecord(r),/下一场/);
  r.trainingContext.nextCompetitionDate="2026-10-20";
  assert.match(M.validateField(r,"athlete.date","2026-09-30"),/上一场/);
  assert.match(M.validateField(r,"athlete.date","2026-10-21"),/下一场/);
  r.trainingContext.nextCompetitionDate="2026-02-30";assert.throws(()=>M.validateRecord(r),/日期/);
});
test("profile validation rejects future birth dates and invalid experience", () => {
  assert.equal(M.validateAthleteProfile({birthDate:"",injuryHistory:"",experienceYears:""}),true);
  assert.throws(()=>M.validateAthleteProfile({birthDate:"2999-01-01"}),/今天/);
  assert.throws(()=>M.validateAthleteProfile({birthDate:"2001-02-29"}),/生日/);
  for (const experienceYears of ["abc","-1","81",3]) assert.throws(()=>M.validateAthleteProfile({experienceYears}),/年限|档案/);
  const r=record({birthDate:"2000-10-09"});assert.match(M.validateField(r,"athlete.date","1999-10-09"),/生日/);
});
test("new empty defaults do not invalidate legacy narrative fingerprints", () => {
  const r=record();delete r.athlete.birthDate;delete r.athlete.injuryHistory;
  delete r.trainingContext.previousCompetitionDate;delete r.trainingContext.nextCompetitionDate;
  assert.equal(M.fingerprint(r),M.fingerprint(M.normalizeRecord(r)));
  const basis=M.fingerprint(r);r.athlete.birthDate="2000-10-09";
  assert.equal(M.fingerprint(r),basis);
  r.athlete.injuryHistory="膝部既往手术";assert.notEqual(M.fingerprint(r),basis);
});
test("age-only fingerprint comparison does not hide other context or measurement changes", () => {
  const r=record();r.athlete.age=17;const basis=M.fingerprint(r);
  M.applyAge(r,"2000-10-09");assert.notEqual(M.fingerprint(r),basis);assert.equal(M.fingerprintMatchesExceptAge(basis,r),true);
  assert.equal(M.fingerprintMatchesExceptAge("not-json",r),false);
  r.trainingContext.nextCompetitionDate="2026-10-15";assert.equal(M.fingerprintMatchesExceptAge(basis,r),false);
  r.trainingContext.nextCompetitionDate="";r.data.cmj[0].height=30;assert.equal(M.fingerprintMatchesExceptAge(basis,r),false);
});
test("age-only fingerprint comparison includes CPET age-group changes without hiding measurement changes", () => {
  const r=record();r.athlete.age=29;r.athlete.sex="男";r.athlete.mass=70;r.enabled.cpet=true;
  Object.assign(r.data.cpet,{modality:"treadmill",vo2:45.4,vo2Unit:"ml/kg/min",rer:1.1});
  const E=context.RingsideEvaluation,p=E.create(r),basis=M.fingerprint(E.resolve(r,p));
  r.athlete.age=30;
  assert.equal(M.fingerprintMatchesExceptAge(basis,E.resolve(r,p)),false);
  assert.equal(M.fingerprintMatchesExceptAge(basis,E.resolve(r,p),p),true);
  r.data.cpet.vo2=50;assert.equal(M.fingerprintMatchesExceptAge(basis,E.resolve(r,p),p),false);
});
test("Hop presence ignores defaults counts and notes but retains measured zero", () => {
  const set=M.newHopSet();set.notes="准备测试";set.summary.suppliedCount=10;
  assert.equal(M.hasMeaningfulHopSet(set),false);set.summary.rsi=0;assert.equal(M.hasMeaningfulHopSet(set),true);
  set.summary.rsi="";set.jumps[0].height=20;assert.equal(M.hasMeaningfulHopSet(set),true);
});
console.log("PASS "+passed+" athlete context model scenarios");
