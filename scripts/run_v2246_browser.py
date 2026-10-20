"""Run source-bound synthetic browser acceptance without shared output paths."""
from pathlib import Path
import subprocess,sys,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'output/comparison-trend/release-v2246-pdf-isolated'
MATRIX={
 'page-isolation':('pdf-page-isolation-browser-tests.cjs',[]),
 'edge':('comparison-trend-browser-tests.cjs',['--edge','--skip-pdf']),
 'controls':('longitudinal-controls-browser-tests.cjs',['--skip-pdf']),
 'layout':('longitudinal-layout-v2244-tests.cjs',['--skip-pdf']),
 'layout-regression':('longitudinal-layout-browser-tests.cjs',[]),
 'followup':('longitudinal-followup-browser-tests.cjs',['--skip-pdf']),
 'ai':('longitudinal-ai-browser-tests.cjs',[]),
 'interaction':('longitudinal-interaction-browser-tests.cjs',[]),
 'tooltip':('comparison-trend-interaction-tests.cjs',[]),
 'balance-pdf':('comparison-trend-pdf-edgecases.cjs',[]),
 'personal':('report-v220-browser-tests.cjs',[]),
 'app':('longitudinal-browser-tests.cjs',[]),
}
EQUALS={'edge','layout','layout-regression','followup','tooltip','balance-pdf'}
def main():
 kinds=sys.argv[1:] or list(MATRIX)
 BASE.mkdir(parents=True,exist_ok=True)
 for kind in kinds:
  runner,args=MATRIX[kind];out=BASE/kind;out.mkdir(exist_ok=True)
  assert not (out/'results.json').exists(),kind+' already has evidence'
  cli=['--artifact-dir='+str(out)] if kind in EQUALS else ['--artifact-dir',str(out)]
  with (out/'producer.log').open('w',encoding='utf-8') as log:
   run=subprocess.run(['node',str(ROOT/'tests'/runner),*args,*cli],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
  print(kind,run.returncode,flush=True)
  if run.returncode:sys.exit(run.returncode)
if __name__=='__main__':main()
