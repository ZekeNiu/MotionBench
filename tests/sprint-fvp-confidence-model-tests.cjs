"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const repository = path.join(__dirname, ".."), context = vm.createContext({ console, Intl }); context.window = context;
const sources = ["ringside-calc.js", "ringside-sprint-fvp.js", "ringside-sprint-fvp-confidence.js"];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const moduleHashesAtStart = Object.fromEntries(sources.map(name => [name, sha256(fs.readFileSync(path.join(repository, "src", name)))]));
for (const name of sources) vm.runInContext(fs.readFileSync(path.join(repository, "src", name), "utf8"), context, { filename: name });
const F = context.RingsideSprintFVP, CI = context.RingsideSprintFVPConfidence;
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const relative = (actual, expected, tolerance = 2e-5) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance * Math.max(1e-12, Math.abs(expected)), `${actual} != ${expected}`);
const checks = [], numericEvidence = [];
function test(name, fn) {
  try { fn(); checks.push({ name, pass: true }); console.log("PASS " + name); }
  catch (error) { checks.push({ name, pass: false, error: error.stack }); console.error("FAIL " + name + ": " + error.message); }
}

// Independent NumPy/SciPy reference, calculated with least_squares(jac='3-point')
// and direct inverse(J'J). Synthetic fixed times, iid distance-residual model.
// Noise was projected orthogonal to the exact Jacobian so theta=(9,1.2) is
// stationary. These cached values do not call the production solver.
const oracles = [{
  n: 4, times: [1.1, 2, 3.2, 4.8],
  distances: [3.4313064535804343, 9.184996726013072, 18.801223830767842, 32.582781108942285],
  theta: [9.000000000004349, 1.200000000001666], sse: .005983520055717663,
  covariance: [[.002847737557679249, .0010238778834705088], [.0010238778834705088, .0003900913426082751]],
  tCritical: 4.302652729911275, seAtVelocity5: .015728452023736732, halfAtVelocity5: .0676740670346643,
}, {
  n: 6, times: [.9, 1.5, 2.2, 3.1, 4.2, 5.4],
  distances: [2.4281478448905967, 5.758636100604934, 10.780912303604943, 17.853623067729977, 27.363383716469862, 37.91085407563127],
  theta: [9.000000000000613, 1.200000000000177], sse: .010230829232440937,
  covariance: [[.0011847628642216923, .00045084024898388043], [.00045084024898388043, .00018363079493109805]],
  tCritical: 2.7764451051977987, seAtVelocity5: .012346371774460121, halfAtVelocity5: .034279023480152,
}];
function solvedFrom(oracle, K = 0, windMps = 0) {
  const points = oracle.times.map((timeS, i) => ({ timeS, distanceM: oracle.distances[i] }));
  const fit = F.fitSplits(points); assert.equal(fit.valid, true);
  const endTimeS = oracle.times.at(-1), mass = 75;
  const model = F.mechanics(fit, mass, K, windMps, endTimeS); assert.equal(model.valid, true);
  return { valid: true, fit, model, mass, atmosphere: { K }, config: { windMps }, selected: { endTimeS }, targetDistanceM: 30, optimum: { valid: true, F0: 8, V0: 12 } };
}
function exactSolved(times = [1.1, 2, 3.2, 4.8], vmax = 9, tau = 1.2) {
  const points = times.map(timeS => ({ timeS, distanceM: F.distanceAt(timeS, vmax, tau) }));
  const fit = { valid: true, vmax, tau, n: times.length, points }, endTimeS = times.at(-1);
  return { valid: true, fit, model: F.mechanics(fit, 75, 0, 0, endTimeS), mass: 75, atmosphere: { K: 0 }, config: { windMps: 0 }, selected: { endTimeS } };
}
function rejection(solved, code, options) {
  const result = CI.evaluate(solved, options); assert.equal(result.available, false); assert.equal(result.metadata.available, false);
  assert.equal(result.metadata.reasonCode, code); assert.ok(result.reason); assert.equal(result.band.length, 0); return result;
}
function analyticalSE(velocity, covariance, vmax = 9, tau = 1.2) {
  // Independent Newtonian no-drag identity: F(v)=(Vmax-v)/tau.
  const g = [1 / tau, -(vmax - velocity) / tau ** 2];
  return Math.sqrt(g[0] ** 2 * covariance[0][0] + 2 * g[0] * g[1] * covariance[0][1] + g[1] ** 2 * covariance[1][1]);
}

for (const oracle of oracles) {
  test(`${oracle.n} actual splits give df=${oracle.n - 2} and small-sample Student-t`, () => {
    const result = CI.evaluate(solvedFrom(oracle)); assert.equal(result.available, true);
    assert.equal(result.metadata.n, oracle.n); assert.equal(result.metadata.df, oracle.n - 2);
    assert.equal(result.metadata.version, "sprint-fvp-pointwise-delta-v1"); assert.equal(result.metadata.level, .95);
    assert.equal(result.metadata.currentCurveOnly, true); near(result.metadata.tCritical, oracle.tCritical, 1e-10);
    assert.ok(result.metadata.tCritical > 1.96); assert.equal(result.band.length, 49);
  });
  test(`${oracle.n} split covariance and SSE match independent SciPy reference`, () => {
    const solved = solvedFrom(oracle), result = CI.evaluate(solved);
    near(solved.fit.vmax, oracle.theta[0]); near(solved.fit.tau, oracle.theta[1]); relative(result.metadata.sse, oracle.sse);
    relative(result.metadata.residualVariance, oracle.sse / (oracle.n - 2));
    for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) relative(result.metadata.covariance[row][column], oracle.covariance[row][column]);
    numericEvidence.push({ n: oracle.n, df: result.metadata.df, fit: { vmax: solved.fit.vmax, tau: solved.fit.tau }, sse: result.metadata.sse,
      covariance: plain(result.metadata.covariance), independentSciPyCovariance: oracle.covariance, tCritical: result.metadata.tCritical,
      scaledConditionNumber: result.metadata.scaledConditionNumber, independentSEAtVelocity5: oracle.seAtVelocity5 });
  });
  test(`${oracle.n} split current FV mean intervals match independent no-drag delta formula`, () => {
    const result = CI.evaluate(solvedFrom(oracle));
    for (const point of result.band) {
      const expectedSE = analyticalSE(point.velocity, oracle.covariance), center = (9 - point.velocity) / 1.2;
      relative(point.standardError, expectedSE); near(point.y, center); near(point.low, center - oracle.tCritical * expectedSE); near(point.high, center + oracle.tCritical * expectedSE);
      assert.ok(point.high > point.low); assert.equal(point.x, point.velocity);
    }
    relative(analyticalSE(5, oracle.covariance), oracle.seAtVelocity5);
    relative(oracle.tCritical * analyticalSE(5, oracle.covariance), oracle.halfAtVelocity5);
  });
  test(`${oracle.n} split PV endpoints are the same fixed velocity times the FV endpoints`, () => {
    const result = CI.evaluate(solvedFrom(oracle));
    for (const point of result.band) { assert.equal(point.powerLow, point.velocity * point.low); assert.equal(point.powerHigh, point.velocity * point.high); }
  });
}

test("grid density and derived sampling counts never become independent sample size", () => {
  const solved = solvedFrom(oracles[0]), sparse = CI.evaluate(solved, { count: 17 });
  solved.model.sampleCount = 200000; solved.model.rfSampleCount = 100000;
  const dense = CI.evaluate(solved, { count: 65 });
  assert.equal(sparse.metadata.n, 4); assert.equal(dense.metadata.df, 2);
  assert.deepEqual(plain(sparse.metadata.covariance), plain(dense.metadata.covariance));
  assert.deepEqual(plain(sparse.band[8]), plain(dense.band[32]));
});
test("band domain is the actual mechanics velocity range", () => {
  const solved = solvedFrom(oracles[0]), result = CI.evaluate(solved);
  assert.equal(result.band[0].velocity, solved.model.samples[0].velocity);
  near(result.band.at(-1).velocity, solved.model.samples.at(-1).velocity, 1e-15);
  assert.equal(result.metadata.velocityRange.basis, "mechanics-sample-velocities");
  assert.ok(result.band[0].velocity > 0); assert.ok(result.band.at(-1).velocity < solved.model.V0);
});
test("zero residual SSE produces exactly zero covariance and interval width without invented noise", () => {
  const result = CI.evaluate(exactSolved()); assert.equal(result.available, true); assert.equal(result.metadata.sse, 0);
  assert.ok(result.metadata.covariance.every(row => row.every(value => value === 0)));
  for (const point of result.band) { assert.equal(point.standardError, 0); assert.equal(point.high, point.low); assert.equal(point.powerHigh, point.powerLow); }
});
test("negative lower confidence bounds remain negative rather than clipped", () => {
  const oracle = oracles[0], distances = oracle.times.map((timeS, i) => {
    const exact = 9 * (timeS - 1.2 * (1 - Math.exp(-timeS / 1.2)));
    return exact + 12 * (oracle.distances[i] - exact);
  });
  const result = CI.evaluate(solvedFrom({ times: oracle.times, distances })); assert.equal(result.available, true);
  assert.ok(result.band.some(point => point.low < 0));
  for (const point of result.band) assert.equal(point.powerLow, point.low * point.velocity);
});
test("adding or changing the distance optimum never creates an optimum band or changes the current CI", () => {
  const solved = solvedFrom(oracles[0]), before = plain(CI.evaluate(solved));
  solved.optimum = { valid: true, F0: 200, V0: 200, timeS: 1 }; solved.targetDistanceM = 200;
  solved.analysis = { targetDistanceM: 200 }; solved.view = { confidence: false, optimum: false };
  const after = CI.evaluate(solved); assert.deepEqual(plain(after), before);
  assert.equal(after.metadata.currentCurveOnly, true); assert.equal(after.optimalBand, undefined); assert.equal(after.optimumBand, undefined);
});
test("CI evaluation leaves the solved snapshot and point estimates unchanged", () => {
  const solved = solvedFrom(oracles[1], .3, 1), before = JSON.stringify(solved);
  assert.equal(CI.evaluate(solved).available, true); assert.equal(JSON.stringify(solved), before);
});
test("drag and wind are propagated through the existing full mechanics pipeline", () => {
  const calm = CI.evaluate(solvedFrom(oracles[0])), drag = CI.evaluate(solvedFrom(oracles[0], .3)), windy = CI.evaluate(solvedFrom(oracles[0], .3, 1));
  assert.equal(drag.available, true); assert.equal(windy.available, true);
  assert.deepEqual(plain(calm.metadata.covariance), plain(windy.metadata.covariance));
  assert.ok(calm.band.some((point, i) => Math.abs(point.standardError - drag.band[i].standardError) > 1e-6));
  // At a fixed velocity, changing fixed wind adds a deterministic linear FV
  // term K/m*(w^2-2*w*v); it shifts the fitted center but not its theta gradient.
  for (let i = 0; i < drag.band.length; i++) {
    near(windy.band[i].y - drag.band[i].y, .3 / 75 * (1 - 2 * drag.band[i].velocity));
    relative(windy.band[i].standardError, drag.band[i].standardError);
  }
});
test("invalid or missing point fits have no drawable interval", () => { rejection(null, "invalid-fit"); const solved = solvedFrom(oracles[0]); solved.valid = false; rejection(solved, "invalid-fit"); });
test("two split points have no residual degrees of freedom", () => {
  const solved = solvedFrom(oracles[0]); solved.fit.points = solved.fit.points.slice(0, 2); solved.fit.n = 2;
  const result = rejection(solved, "insufficient-splits"); assert.equal(result.metadata.n, 2); assert.equal(result.metadata.df, 0);
});
test("the split count cannot be replaced by a solver or sampling counter", () => { const solved = solvedFrom(oracles[0]); solved.fit.n = 100; rejection(solved, "insufficient-splits"); });
test("nonfinite and nonmonotonic observations are rejected without deleting points", () => {
  for (const mutate of [s => { s.fit.points[1].timeS = s.fit.points[0].timeS; }, s => { s.fit.points[1].distanceM = NaN; }, s => { s.fit.points[1].distanceM = 0; }]) {
    const solved = solvedFrom(oracles[0]); mutate(solved); const before = JSON.stringify(solved); rejection(solved, "invalid-splits"); assert.equal(JSON.stringify(solved), before);
  }
});
test("parameter boundary fits do not acquire a one-sided or clipped interval", () => {
  for (const tau of [.001, 1000, Infinity]) { const solved = solvedFrom(oracles[0]); solved.fit.tau = tau; rejection(solved, "boundary-fit"); }
});
test("numerically inseparable parameter columns are rejected without a pseudoinverse", () => {
  const result = rejection(exactSolved([100, 100.00001, 100.00002, 100.00003]), "ill-conditioned");
  assert.ok(result.metadata.scaledConditionNumber > 1e10 || !Number.isFinite(result.metadata.scaledConditionNumber)); assert.equal(result.metadata.covariance, null);
});
test("a nonstationary parameter snapshot fails the independent objective-neighborhood check", () => {
  const solved = solvedFrom(oracles[0]); solved.fit.vmax *= 1.01; solved.model = F.mechanics(solved.fit, 75, 0, 0, solved.selected.endTimeS);
  rejection(solved, "unconverged-fit");
});
test("missing fixed environmental conditions prevent unsupported propagation", () => { const solved = solvedFrom(oracles[0]); delete solved.atmosphere.K; rejection(solved, "invalid-conditions"); });
test("a degenerate chart velocity domain has no interval", () => { const solved = solvedFrom(oracles[0]); solved.model.samples = [{ velocity: 5 }, { velocity: 5 }]; rejection(solved, "invalid-range"); });
test("invalid grid requests are rejected instead of changing the statistical sample", () => { for (const count of [1, 402, 2.5]) rejection(solvedFrom(oracles[0]), "invalid-grid", { count }); });
test("failed perturbed mechanics produce an explicit unavailable interval", () => {
  const solved = solvedFrom(oracles[0]);
  try { context.RingsideSprintFVP = { ...F, mechanics: () => ({ valid: false }) }; rejection(solved, "invalid-gradient"); } finally { context.RingsideSprintFVP = F; }
});
test("nonfinite propagation is never replaced by clipped, approximate or fixed-percentage bounds", () => {
  const solved = solvedFrom(oracles[0]);
  try { context.RingsideSprintFVP = { ...F, mechanics: () => ({ valid: true, F0: Infinity, slope: -1 }) }; rejection(solved, "invalid-gradient"); } finally { context.RingsideSprintFVP = F; }
});

test("all loaded source modules remain unchanged during this scientific run", () => {
  for (const name of sources) assert.equal(sha256(fs.readFileSync(path.join(repository, "src", name))), moduleHashesAtStart[name]);
});
const failures = checks.filter(check => !check.pass), artifactPath = path.join(repository, "output/verify/v2175-sprint-confidence-model-results.json");
const htmlPath = path.join(repository, "MotionBench.html");
const evidence = { generatedAt: new Date().toISOString(), synthetic: true, pass: !failures.length, exitCode: failures.length ? 1 : 0,
  runnerPath: "tests/sprint-fvp-confidence-model-tests.cjs", runnerSha256: sha256(fs.readFileSync(__filename)),
  moduleSha256: moduleHashesAtStart, sourceModulesUnchanged: checks.at(-1).pass,
  sourceHtmlAtRunSha256: fs.existsSync(htmlPath) ? sha256(fs.readFileSync(htmlPath)) : null, htmlWasAcceptanceSource: false,
  methodVersion: CI.version, confidenceLevel: CI.level, checks: checks.length, passed: checks.length - failures.length, failures, results: checks,
  independentReference: { producer: "existing NumPy/SciPy least_squares(jac='3-point'), covariance inv(J'J); independently cached synthetic numerical reference",
    conditionalAssumptions: "fixed split times; independent equal-variance distance residuals; only selected raw split observations count toward n", oracles },
  numericEvidence, exclusions: ["no individual prediction interval", "no simultaneous band", "no optimum band", "no fabricated residual noise", "no pseudoinverse", "no fixed-percentage band", "no derived-sample n", "no clipping of negative lower bounds"],
  sources: ["https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.curve_fit.html", "https://www.mathworks.com/help/stats/nlpredci.html", "https://pmc.ncbi.nlm.nih.gov/articles/PMC6027739/"] };
fs.mkdirSync(path.dirname(artifactPath), { recursive: true }); fs.writeFileSync(artifactPath, JSON.stringify(evidence, null, 2) + "\n");
console.log(`${checks.length - failures.length} sprint FVP confidence model checks passed${failures.length ? `; ${failures.length} failed` : ""}`);
process.exitCode = failures.length ? 1 : 0;
