"""Independent synthetic-only science review; does not modify product sources."""
import json
import math
import subprocess
import hashlib
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, least_squares, minimize_scalar

ROOT = Path(__file__).resolve().parents[1]
REVIEW_MODULES = ["ringside-calc.js", "ringside-sprint-fvp.js"]
module_hashes = {name: hashlib.sha256((ROOT/'src'/name).read_bytes()).hexdigest()
                 for name in REVIEW_MODULES}


def t_at_x(x, v, tau):
    return brentq(lambda t: v * (t + tau * math.expm1(-t / tau)) - x,
                  1e-12, x / v + tau, xtol=1e-13)


def independent_performance(p, slope, k, x):
    f, u = 2 * math.sqrt(-p * slope), 2 * math.sqrt(-p / slope)
    tau = u / (k * u * u + f)
    v = f * tau
    return {"F0": f, "V0": u, "tau": tau, "vmax": v,
            "timeS": t_at_x(x, v, tau)}


def independent_optimum(p, x, k):
    result = minimize_scalar(lambda a: independent_performance(p, -a, k, x)["timeS"],
                             bounds=(.03, 1.9), method="bounded",
                             options={"xatol": 1e-12})
    magnitude = float(result.x)
    return {"slope": -magnitude, **independent_performance(p, -magnitude, k, x)}


fixture = [{"distanceM": x, "timeS": t_at_x(x, 9.1, 1.12)} for x in [5, 10, 20, 30, 40]]
noisy = [{**p, "timeS": p["timeS"] + noise}
         for p, noise in zip(fixture, [.009, -.007, .012, -.014, .006])]
times = np.array([p["timeS"] for p in noisy])
distances = np.array([p["distanceM"] for p in noisy])


def residual(logpars):
    v, tau = np.exp(logpars)
    return v * (times + tau * np.expm1(-times / tau)) - distances


fits = [least_squares(residual, np.log([v, tau]),
                      bounds=(np.log([.01, .001]), np.log([10000, 1000])),
                      xtol=1e-13, ftol=1e-13, gtol=1e-13)
        for v, tau in [(5, .5), (10, 1), (15, 3)]]
fit = min(fits, key=lambda result: np.sum(result.fun**2))
independent_fit = {"vmax": float(np.exp(fit.x[0])), "tau": float(np.exp(fit.x[1])),
                   "sse": float(np.sum(fit.fun**2))}

node_program = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const root = vm.createContext({console});
root.window=root;
for (const file of ['ringside-calc.js','ringside-sprint-fvp.js'])
  vm.runInContext(fs.readFileSync('src/'+file,'utf8'),root,{filename:file});
const F=root.RingsideSprintFVP;
const mechanics=F.mechanics({vmax:9.1,tau:1.12},75,0,0,5.5);
const record={athlete:{mass:75,height:181},sprintFvpConfig:F.defaultsConfig(),
  sprintFvpAnalysis:F.defaultsAnalysis(),data:{sprint_fvp:[{id:'a',splits:input.fixture}]}};
const solved=F.solve(record);
const interval=JSON.parse(JSON.stringify(record));
interval.sprintFvpConfig.inputTimeMode='interval';
interval.sprintFvpConfig.timeCorrectionS=.1;
interval.data.sprint_fvp[0].splits.forEach((point,i)=>point.timeS=input.fixture[i].timeS-(i?input.fixture[i-1].timeS:0));
const intervalSolved=F.solve(interval);
const signal=JSON.parse(JSON.stringify(record));
signal.sprintFvpConfig.timingStart='signal';
signal.sprintFvpConfig.timeCorrectionS=-.2;
signal.data.sprint_fvp[0].splits.forEach(p=>p.timeS+=.2);
const signalSolved=F.solve(signal);
const wind=JSON.parse(JSON.stringify(record));
wind.sprintFvpConfig.windMps=1;
const windSolved=F.solve(wind);
const compare=JSON.parse(JSON.stringify(record));
compare.data.sprint_fvp.push({id:'b',splits:input.fixture.map((p,i)=>({...p,timeS:p.timeS+[.03,-.03,.03,-.03,.1][i]}))});
const multi=F.solve(compare);
const atmosphere=F.airResistance(75,1.81,20,998);
const cases=input.cases.map(p=>({input:p,actual:F.optimum(...p)}));
process.stdout.write(JSON.stringify({fit:F.fitSplits(input.noisy),exactFit:F.fitSplits(input.fixture),
 mechanics,atmosphere,cases,solved:{valid:solved.valid,target:solved.targetDistanceM,model:solved.model,
 fit:solved.fit,imbalance:solved.imbalance},
 interval:{raw:interval.data.sprint_fvp[0].splits,adjusted:intervalSolved.selected?.splits},
 signal:{valid:signalSolved.valid,reason:signalSolved.reason},
 wind:{valid:windSolved.valid,optimum:windSolved.optimum,optimumReason:windSolved.optimumReason},
 multi:{selected:multi.selectedTrialId,points:multi.points},
 boundary:F.optimum(20,10000,0)}));
"""

cases = [[p, x, k] for p in [10, 20, 30] for x in [5, 15, 30] for k in [0, .004]]
run = subprocess.run(['node', '-e', node_program], cwd=ROOT,
                     input=json.dumps({'fixture': fixture, 'noisy': noisy, 'cases': cases}),
                     text=True, encoding='utf-8', capture_output=True, check=True)
js = json.loads(run.stdout)
checks = []


def check(name, actual, expected, atol=1e-7):
    actual, expected = float(actual), float(expected)
    error = abs(actual - expected)
    passed = error <= atol
    checks.append({'check': name, 'passed': passed, 'actual': actual,
                   'expected': expected, 'absoluteError': error})


for key, value in independent_fit.items():
    check('distance-SSE fit '+key, js['fit'][key], value)
check('exact synthetic Vmax', js['exactFit']['vmax'], 9.1)
check('exact synthetic tau', js['exactFit']['tau'], 1.12)
check('no-drag F0/m', js['mechanics']['F0'], 9.1/1.12)
check('no-drag relative slope', js['mechanics']['slope'], -1/1.12)
check('no-drag V0=Vmax', js['mechanics']['V0'], 9.1)
check('no-drag Pmax', js['mechanics']['Pmax'], 9.1**2/1.12/4)
check('RF first retained time', next(p['timeS'] for p in js['mechanics']['samples'] if p['timeS'] > .3+1e-9), .4)
accel = 9.1/1.12*math.exp(-.4/1.12)
check('RFmax is .4s force ratio', js['mechanics']['RFmax'], accel/math.hypot(accel, 9.81))
velocities = np.array([9.1*(1-math.exp(-i*.1/1.12)) for i in range(4,56)])
accels = np.array([9.1/1.12*math.exp(-i*.1/1.12) for i in range(4,56)])
ratios = accels / np.hypot(accels,9.81)
check('DRF independent numpy polynomial fit, percentage points once', js['mechanics']['DRF'],
      float(np.polynomial.polynomial.polyfit(velocities,ratios,1)[1])*100)
check('hPa correct density', js['atmosphere']['density'], 1.293*(998/1013.25)*273/293)
check('default target follows full trial', js['solved']['target'], 40)
for index, point in enumerate(js['interval']['adjusted']):
    check(f'interval correction applied once point {index}', point['timeS'],fixture[index]['timeS']+.1)

# A separate no-drag nondimensional stationary equation supplies an analytic
# optimum check, with no discrete slope search or time minimizer.
zstar = brentq(lambda z: z-3+(3+2*z)*math.exp(-z),.1,5)
for case in js['cases']:
    p,x,k = case['input']
    actual = case['actual']
    expected = independent_optimum(p,x,k)
    if not actual['valid']:
        checks.append({'check': f'independently confirmed boundary p={p},x={x},k={k}',
                       'passed': min(abs(expected['slope']+.03),abs(expected['slope']+1.9))<1e-6,
                       'actual':actual,'independentBoundedSlope':expected['slope']})
        continue
    check(f'SciPy optimum slope p={p},x={x},k={k}', actual['slope'],expected['slope'],2e-7)
    check(f'SciPy optimum time p={p},x={x},k={k}', actual['timeS'],expected['timeS'])
    check(f'fixed-power identity p={p},x={x},k={k}', actual['F0']*actual['V0']/4,p)
    check(f'distance substitution p={p},x={x},k={k}',
          actual['vmax']*(actual['timeS']+actual['tau']*math.expm1(-actual['timeS']/actual['tau'])),x)
    a=-actual['slope']
    neighbor_times=[independent_performance(p,-a*factor,k,x)['timeS'] for factor in [.995,1.005]]
    checks.append({'check':f'independent neighboring slopes p={p},x={x},k={k}',
                   'passed': all(t>=actual['timeS']-1e-9 for t in neighbor_times),
                   'actual':actual['timeS'],'neighbors':neighbor_times})
    if k == 0:
        analytic_a=(2*math.sqrt(p)*(zstar-1+math.exp(-zstar))/x)**(2/3)
        check(f'no-drag analytic optimum slope p={p},x={x}',actual['slope'],-analytic_a,2e-7)

checks.append({'check':'single whole trial selected, no segment splicing',
               'passed':js['multi']['selected']=='a' and
               all(abs(q['timeS']-p['timeS'])<1e-12 for q,p in zip(js['multi']['points'],fixture))})
checks.append({'check':'nonzero wind does not invent optimum',
               'passed':js['wind']['valid'] and js['wind']['optimum'] is None})
checks.append({'check':'out-of-boundary optimum has no valid deficit result',
               'passed':not js['boundary']['valid']})

output={'independentTool':'SciPy '+__import__('scipy').__version__,
        'passed':sum(c['passed'] for c in checks),'total':len(checks),
        'checks':checks, 'observedSignalCorrectionBug':js['signal'],
        'observedEntryFitKeys':list(js['solved']['fit']),
        'analyticNoDragDimensionlessOptimumTime':zstar,
        'moduleSha256':module_hashes,
        'scriptPath':Path(__file__).absolute().relative_to(ROOT).as_posix(),
        'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'notes':'Synthetic records only. Product sources were not changed.'}
assert module_hashes == {name: hashlib.sha256((ROOT/'src'/name).read_bytes()).hexdigest()
                         for name in REVIEW_MODULES}, 'Modules changed during independent review'
(ROOT/'output'/'science-review-results.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':output['passed'],'total':output['total'],
                  'failed':[c for c in checks if not c['passed']],
                  'signalCorrection':js['signal'],
                  'fitKeys':output['observedEntryFitKeys']},ensure_ascii=False,indent=2))
