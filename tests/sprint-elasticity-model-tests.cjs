"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = vm.createContext({});
["ringside-calc.js", "ringside-sprint-fvp.js", "ringside-sprint-elasticity.js"].forEach(name =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", name), "utf8"), context, { filename: name }));
const E = context.RingsideSprintElasticity, F = context.RingsideSprintFVP;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/sprint-elasticity-author-2026-10-11.json"), "utf8"));
const params = (extra = {}) => ({ F0: 8, V0: 8, massKg: 70, heightCm: 170, temperatureC: 20, pressureHpa: 1013.25,
  windMs: 0, targetDistanceM: 5, deltaForcePct: 0, deltaVelocityPct: 0, ...extra });
const json = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Number.isFinite(actual) &&
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}; tolerance ${tolerance}`);
let passed = 0, maxAuthorTimeErrorS = 0, maxAuthorElasticityError = 0, maxRk4TimeErrorS = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }

// Independent integration of the force-line ODE. This deliberately does not
// call the production coefficients, displacement, root solver, or derivatives.
// The author's calculator uses RK4 velocity, trapezoidal position and a linear
// final crossing. Smaller steps test the continuous solution independently.
function integratedTime(F0, V0, k, distanceM, dt = .001) {
  const acceleration = v => F0 - F0 * v / V0 - k * v * v;
  let velocity = 0, position = 0, time = 0;
  for (let i = 0; i < 2000000; i++) {
    const a = acceleration(velocity), b = acceleration(velocity + dt * a / 2);
    const c = acceleration(velocity + dt * b / 2), d = acceleration(velocity + dt * c);
    const nextVelocity = velocity + dt * (a + 2 * b + 2 * c + d) / 6;
    const nextPosition = position + dt * (velocity + nextVelocity) / 2;
    if (nextPosition >= distanceM) return time + dt * (distanceM - position) / (nextPosition - position);
    velocity = nextVelocity; position = nextPosition; time += dt;
  }
  throw Error("Independent integrator did not reach distance");
}

test("source fixture records executable primary-source provenance and 24 cases", () => {
  assert.equal(fixture.sourceUrl, "https://www.lzqf3ng.com/sprint/");
  assert.equal(fixture.htmlSha256, "b4468f9fbc597e17f959fd48c8189c5301a60af0be8bdf85e284a80e3cd6ef16");
  assert.equal(fixture.coreSha256, "b7267346c3473599032db06176aeb774626a4a82359e7386189854f05e45fc44");
  assert.equal(fixture.dtS, .001); assert.equal(fixture.versionPinnedToPaper, false); assert.equal(fixture.cases.length, 24);
});
test("closed-form time and author's +1% elasticities agree within integration error", () => {
  for (const sample of fixture.cases) {
    const actual = E.elasticity(sample.F0, sample.V0, sample.k, sample.distanceM);
    assert.equal(actual.valid, true); near(actual.timeS, sample.t, sample.k ? 6e-7 : 2e-13);
    for (const field of ["Fe", "ve", "EN", "ER"]) {
      // At 0.5 m, dt=.001 crossing interpolation is amplified by division
      // by the 1% perturbation. Convergence is tested below, not hidden.
      const tolerance = !sample.k ? 2e-12 : sample.distanceM < 1 ? (field === "ER" ? 6e-4 : 1e-4) : 4e-6;
      near(actual[field], sample[field], tolerance);
      if (field !== "ER") maxAuthorElasticityError = Math.max(maxAuthorElasticityError, Math.abs(actual[field] - sample[field]));
    }
    maxAuthorTimeErrorS = Math.max(maxAuthorTimeErrorS, Math.abs(actual.timeS - sample.t));
    assert.equal(actual.differenceMethod, sample.k ? "forward-relative-1pct" : "analytic-no-drag");
  }
});
test("short-distance +1% difference converges as the independent integration step shrinks", () => {
  const actual = E.elasticity(10, 7, .0038, .5);
  for (const dt of [.001, .0001]) {
    const t = integratedTime(10, 7, .0038, .5, dt);
    const Fe = -(integratedTime(10.1, 7, .0038, .5, dt) - t) / t / .01;
    const ve = -(integratedTime(10, 7.07, .0038, .5, dt) - t) / t / .01;
    if (dt === .001) { assert.ok(Math.abs(Fe - actual.Fe) > 6e-5); assert.ok(Math.abs(ve - actual.ve) > 4e-5); }
    else { near(Fe, actual.Fe, 1e-6); near(ve, actual.ve, 1e-6); }
  }
});
test("independent RK4 reproduces the author's frozen numerical cases", () => {
  for (const sample of fixture.cases.filter(c => c.k > 0)) {
    near(integratedTime(sample.F0, sample.V0, sample.k, sample.distanceM), sample.t, 2e-13);
  }
});
test("RK4 convergence independently verifies the continuous ODE across distances and profiles", () => {
  for (const [F0, V0] of [[6, 9], [8, 8], [10, 7]]) for (const k of [0, .0001, .0038, .02]) {
    for (const distanceM of [.5, 5, 10, 30, 40]) {
      const exact = E.performance(F0, V0, k, distanceM);
      assert.equal(exact.valid, true); near(exact.predictedDistanceM, distanceM, 1e-12);
      const coarse = integratedTime(F0, V0, k, distanceM, .001);
      const fine = integratedTime(F0, V0, k, distanceM, .00025);
      near(fine, exact.timeS, 5e-8);
      assert.ok(Math.abs(fine - exact.timeS) < Math.abs(coarse - exact.timeS) + 1e-11);
      maxRk4TimeErrorS = Math.max(maxRk4TimeErrorS, Math.abs(fine - exact.timeS));
    }
  }
});
test("air coefficient matches existing sprint units and standard atmosphere", () => {
  const air = E.airResistance(70, 170, 20, 1013.25), previous = F.airResistance(70, 1.7, 20, 1013.25);
  near(air.density, 1.204740614334471); near(air.frontalArea, .4814473484459392); near(air.k, .003728694692162977);
  for (const key of ["density", "frontalArea", "K"]) near(air[key], previous[key], 1e-14);
  near(E.airResistance(70, 170, 0, 1013.25).density, 1.293);
  assert.equal(E.airResistance(70, 170, -273, 1013.25), null);
});
test("standard case agrees with independent SciPy displacement roots", () => {
  const independent = [[5, 1.3754762380844707, .38623244122557576, .21894822798341762],
    [10, 2.1442246669392238, .33228921385877186, .3260036834373814],
    [15, 2.839598205614739, .29027311856265614, .40939465950272647],
    [30, 4.811115675826692, .20535185136579814, .578344354075544]];
  for (const [distanceM, timeS, Fe, ve] of independent) {
    const actual = E.compute(params({ targetDistanceM: distanceM })).elasticity;
    near(actual.timeS, timeS, 1e-12); near(actual.Fe, Fe, 2e-10); near(actual.ve, ve, 2e-10);
  }
});
test("no-drag analytic invariants and characteristic distances are retained", () => {
  for (const [F0, V0] of [[6, 9], [8, 8], [10, 7]]) {
    const out = E.compute(params({ F0, V0, k: 0 }));
    assert.equal(out.valid, true); near(2 * out.elasticity.Fe + out.elasticity.ve, 1, 1e-13);
    near(out.constraint.valley.distanceM, .5222453037474273 * V0 * V0 / F0);
    near(out.constraint.valley.Fe, .4); near(out.constraint.valley.ve, .2);
    near(out.constraint.valley.EN, Math.sqrt(.2)); near(out.constraint.valley.ER, 2);
    near(out.constraint.balance.distanceM, 1.2657118326651715 * V0 * V0 / F0);
    near(out.constraint.balance.ER, 1);
  }
});
test("finite 1% EN valley is minimized independently of ER=2 and balance", () => {
  const out = E.compute(params()), valley = out.constraint.valley, balance = out.constraint.balance;
  assert.equal(valley.valid, true); assert.equal(balance.valid, true);
  near(valley.distanceM, 4.245992022126175, 2e-5); near(balance.distanceM, 10.225639380747136, 1e-9);
  assert.ok(valley.distanceM < balance.distanceM); assert.ok(Math.abs(valley.ER - 2) > .01);
  assert.ok(valley.EN < Math.sqrt(.2)); assert.ok(Math.abs(out.elasticity.conservation - 1) > .005);
  for (const offset of [-.01, .01]) assert.ok(E.elasticity(8, 8, out.k, valley.distanceM + offset).EN > valley.EN);
  near(balance.ER, 1, 1e-10);
});
test("zero, positive, negative and mixed scenarios recompute performance and elasticity", () => {
  const base = E.compute(params());
  for (const [deltaForcePct, deltaVelocityPct] of [[0, 0], [10, 0], [0, 10], [10, 10], [-20, 0], [0, -20], [-10, 10]]) {
    const out = E.compute(params({ deltaForcePct, deltaVelocityPct })), next = out.scenario;
    assert.equal(next.valid, true);
    const independent = integratedTime(8 * (1 + deltaForcePct / 100), 8 * (1 + deltaVelocityPct / 100), out.k, 5, .00025);
    near(next.timeS, independent, 5e-8); near(next.deltaTimeS, next.timeS - base.current.timeS);
    near(next.deltaPct, (next.timeS / base.current.timeS - 1) * 100); near(next.timeGainPct, -next.deltaPct);
    near(next.elasticity.timeS, next.timeS);
    if (!deltaForcePct && !deltaVelocityPct) { near(next.deltaPct, 0); near(next.deltaTimeS, 0); }
  }
  assert.ok(E.compute(params({ deltaForcePct: 10 })).scenario.timeGainPct > 0);
  assert.ok(E.compute(params({ deltaVelocityPct: -10 })).scenario.timeGainPct < 0);
  const finite = E.compute(params({ deltaForcePct: 20 })).scenario;
  assert.ok(Math.abs(finite.deltaPct + base.elasticity.Fe * 20) > .1);
});
test("invalid scenario keeps current analysis and rejects blank or nonfinite deltas", () => {
  for (const value of [-100, -150, "", "  ", null, Infinity, NaN, "bad"]) {
    const out = E.compute(params({ deltaForcePct: value }));
    assert.equal(out.valid, true); assert.equal(out.current.valid, true); assert.equal(out.scenario.valid, false);
    assert.equal(out.scenario.timeS, null); assert.equal(out.scenario.elasticity, null); assert.ok(out.scenario.reason);
  }
  assert.equal(E.compute(params({ deltaForcePct: -99.9 })).scenario.valid, true);
});
test("invalid profiles, distance, atmosphere, wind and method produce explicit unavailable results", () => {
  for (const change of [{ F0: 0 }, { V0: -1 }, { F0: NaN }, { F0: Infinity }, { targetDistanceM: 0 },
    { targetDistanceM: "" }, { targetDistanceM: null }, { massKg: 0 }, { heightCm: "" }, { temperatureC: -273 },
    { pressureHpa: 0 }, { windMs: .1 }, { windMs: -1 }, { windMs: "" }, { k: -1 },
    { elasticityMethodVersion: "future-v9" }, { elasticityMethodVersion: null }]) {
    const out = E.compute(params(change)); assert.equal(out.valid, false); assert.ok(out.reason); assert.equal(out.current, null);
  }
  assert.equal(E.performance(1e308, 1e308, .0038, 5).valid, false);
});
test("distance and response interfaces preserve study-domain resolution and the target", () => {
  const out = E.compute(params({ targetDistanceM: 10000 })), points = out.constraint.points;
  assert.equal(out.valid, true); assert.equal(out.withinStudyDistance, false);
  const studyPoints = points.filter(p => p.distanceM <= 30);
  assert.ok(studyPoints.length >= 101);
  assert.ok(studyPoints.slice(1).every((p, i) => p.distanceM - studyPoints[i].distanceM <= .295000001));
  assert.equal(points[0].distanceM, .5); assert.equal(points.at(-1).distanceM, 10000);
  assert.ok(points.every(p => p.valid));
  assert.ok(points.filter(p => p.distanceM > 30).length >= 40);
  for (const marker of [out.constraint.valley, out.constraint.balance]) {
    assert.ok(points.some(p => p.distanceM === marker.distanceM));
  }
  const selected = E.distanceSeries(params(), [30, 5, 10, 5]); assert.deepEqual(json(selected.map(p => p.distanceM)), [5, 10, 30]);
  const response = E.responseSeries(params(), [-10, 0, 10]);
  for (const key of ["force", "velocity", "both"]) {
    assert.deepEqual(json(response[key].map(p => p.changePct)), [-10, 0, 10]);
    assert.ok(response[key].every(p => p.valid && p.elasticity.valid));
  }
});
test("short distances and tiny drag approach the accurate no-drag limit", () => {
  for (const distanceM of [1e-8, .0001, .5, 30]) {
    const base = E.performance(8, 8, 0, distanceM), small = E.performance(8, 8, 1e-14, distanceM);
    assert.equal(base.valid, true); assert.equal(small.valid, true); near(small.timeS, base.timeS, 1e-10);
  }
  near(E.distanceAt(.000001, 8, 8, .0038), 4e-12, 1e-17);
  assert.equal(E.distanceAt(0, 8, 8, .0038), 0); assert.equal(E.velocityAt(0, 8, 8, .0038), 0);
});
test("ODE scaling law holds without imposing a local-derivative theorem on the finite differences", () => {
  for (const k of [0, .0038]) {
    const current = E.performance(8, 8, k, 10), a = 1.1, scaled = E.performance(8 * a * a, 8 * a, k, 10);
    near(scaled.timeS, current.timeS / a, 1e-12);
  }
});
test("solve uses existing FVP units and atmosphere without depending on the 2022 optimum", () => {
  const sprint = { valid: true, reason: "", mass: 70, heightCm: 170, model: { valid: true, F0: 8, V0: 8, mass: 70 },
    config: F.defaultsConfig(), analysis: { targetDistanceM: 5 }, targetDistanceM: 5,
    atmosphere: F.airResistance(70, 1.7, 20, 1013.25), optimum: null };
  const before = JSON.stringify(sprint), out = E.solve(sprint, { deltaForcePct: 5, deltaVelocityPct: -5 });
  assert.equal(out.valid, true); near(out.k, sprint.atmosphere.K / sprint.mass); assert.equal(out.scenario.valid, true);
  assert.equal(JSON.stringify(sprint), before);
  assert.equal(E.solve(sprint, { elasticityMethodVersion: "unknown-v2" }).valid, false);
  sprint.config.windMps = 1; assert.equal(E.solve(sprint).valid, false); assert.equal(sprint.valid, true);
});
test("memoized results cannot be contaminated by chart or caller mutation", () => {
  const first = E.compute(params()), expected = first.constraint.valley.EN;
  first.constraint.valley.EN = 99; first.constraint.points.length = 0; first.scenario.elasticity.Fe = 99;
  const second = E.compute(params()); near(second.constraint.valley.EN, expected);
  assert.ok(second.constraint.points.length > 100); assert.ok(second.scenario.elasticity.Fe < 1);
});
console.log(JSON.stringify({ authorCases: fixture.cases.length, independentRk4Cases: 60, maxAuthorTimeErrorS,
  maxAuthorElasticityError, maxFineRk4TimeErrorS: maxRk4TimeErrorS }));
console.log(`${passed} sprint elasticity model checks passed`);
