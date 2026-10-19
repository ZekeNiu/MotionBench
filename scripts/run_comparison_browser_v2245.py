"""Run each comparison/browser acceptance suite sequentially per channel."""
from pathlib import Path
import subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
channel=sys.argv[1]
assert channel in ('chrome','msedge')
flag=['--edge'] if channel=='msedge' else []
for folder,runner,equals in [('layout','longitudinal-layout-v2244-tests.cjs',True),('layout-regression','longitudinal-layout-browser-tests.cjs',True),('controls','longitudinal-controls-browser-tests.cjs',False),('app','longitudinal-browser-tests.cjs',False),('personal','report-v220-browser-tests.cjs',False),('ai','longitudinal-ai-browser-tests.cjs',False),('interaction','longitudinal-interaction-browser-tests.cjs',False)]:
 out=f'output/playwright/v2245/{folder}/{channel}'
 args=[f'--artifact-dir={out}'] if equals else ['--artifact-dir',out]
 subprocess.run(['node','tests/'+runner,*flag,*args],cwd=ROOT,check=True)
