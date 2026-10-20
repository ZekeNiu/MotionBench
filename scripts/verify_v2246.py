"""Verify final-source receipts and gate 2.24.6 installation/publication."""
from pathlib import Path
import argparse,hashlib,json
ROOT=Path(__file__).resolve().parents[1]
BASE='output/comparison-trend/release-v2246-pdf-isolated'
LOCAL='output/implementation-2.24.6/resumed'
CP=Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261020-system-before-2.24.6')
MANIFEST='0ded40a90e6a4f2419936e60028e8668736f22f24bf116ae96029cf2c713bea5'
GUARD='cf0f3ca402aebbaf9fdefa7eb2e48eab489eea139d6387e2ccd3ed3013681f02'
VERSION,DESKTOP='2.24.6','2.24.6-desktop.1'
def digest(file):return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def read(file):return json.loads(Path(file).read_text(encoding='utf-8-sig'))
def require(ok,message):
 if not ok:raise AssertionError(message)
def evidence(file):return {'file':str(file).replace('\\','/'),'sha256':digest(ROOT/file)}
def receipt(file,producer,source,count):
 item=read(ROOT/file)
 require(item.get('pass') and item.get('sourceHash',item.get('identity',{}).get('runtimeHtmlSha256'))==source,'Receipt/source failed: '+file)
 require(not item.get('errors') and not item.get('failure'),'Receipt has errors: '+file)
 require(item.get('runnerSha256',item.get('identity',{}).get('runnerSha256'))==digest(ROOT/producer),'Producer changed: '+file)
 require(len(item['checks'])==count,'Check inventory changed: '+file)
 if 'fixtureSha256' in item:require(item['fixtureSha256']==digest(ROOT/'tests/helpers/longitudinal-fixture.cjs'),'Fixture changed')
 for name,h in item.get('moduleHashes',{}).items():require(digest(ROOT/name)==h,'Module changed: '+name)
 for entry in item.get('artifacts',[]):
  name=entry.get('file')
  if name and 'sha256' in entry:require(digest(ROOT/name)==entry['sha256'],'Export changed: '+name)
 return {**evidence(file),'checks':count},item
def public(ci=False):
 source=digest(ROOT/'MotionBench.html');require(read(ROOT/'package.json')['version']==VERSION,'Wrong source version')
 unit_path='output/tests/v2.24.6-delivery/unit-results.json';unit=read(ROOT/unit_path)
 require(unit['sourceHash']==source and unit['sourceUnchanged'],'Unit source changed')
 require(unit['runnerSha256']==digest(ROOT/'tests/run-unit-tests.cjs'),'Unit producer changed')
 for name,h in unit['modules'].items():require(digest(ROOT/'src'/name)==h,'Unit module changed: '+name)
 for suite in unit['suites']:require(suite['exitCode']==0 and suite['sourceUnchanged'] and suite['sha256']==digest(ROOT/'tests'/suite['name']),'Unit suite failed/changed: '+suite['name'])
 require(len(unit['suites'])==64 and sum(s['checksPassed'] for s in unit['suites'])==1020,'Unit inventory differs')
 desktop_path='output/tests/v2.24.6-delivery/desktop-unit/results.json';desktop=read(ROOT/desktop_path)
 require(desktop['pass'] and desktop['sourceHash']==source and desktop['sourceUnchanged'] and len(desktop['suites'])==5,'Desktop module proof failed')
 require(desktop['runnerSha256']==digest(ROOT/'tests/run-desktop-unit-tests.cjs'),'Desktop producer changed')
 for name,h in desktop['runtimeHashes'].items():require(digest(ROOT/name)==h,'Desktop runtime changed')
 for s in desktop['suites']:require(s['exitCode']==0 and s['sha256']==digest(ROOT/'tests'/s['name']),'Desktop suite changed')
 matrix={'page-isolation':('pdf-page-isolation-browser-tests.cjs',2),'chrome':('comparison-trend-browser-tests.cjs',11),'edge':('comparison-trend-browser-tests.cjs',9),'controls':('longitudinal-controls-browser-tests.cjs',13),'layout':('longitudinal-layout-v2244-tests.cjs',7),'layout-regression':('longitudinal-layout-browser-tests.cjs',13),'followup':('longitudinal-followup-browser-tests.cjs',7),'ai':('longitudinal-ai-browser-tests.cjs',11),'interaction':('longitudinal-interaction-browser-tests.cjs',8),'tooltip':('comparison-trend-interaction-tests.cjs',3),'balance-pdf':('comparison-trend-pdf-edgecases.cjs',2),'app':('longitudinal-browser-tests.cjs',10),'personal':('report-v220-browser-tests.cjs',6)}
 browsers={}
 for name,(runner,count) in matrix.items():
  file=f'{BASE}/{name}/'+('chrome.json' if name=='personal' else 'results.json')
  browsers[name],_=receipt(file,'tests/'+runner,source,count)
 isolation=read(ROOT/BASE/'page-isolation/results.json')
 native,item=receipt(BASE+'/native/results.json','tests/longitudinal-browser-tests.cjs',source,11)
 require(item['identity']['runtimeHtmlSha256']==source,'Native package source differs')
 smoke=read(ROOT/LOCAL/'native-smoke-isolated/results.json')
 require(smoke['pass'] and len(smoke['checks'])==16 and not smoke['errors'],'Native smoke failed')
 require(smoke['identity']['runtimeHtmlSha256']==source and smoke['identity']['testScriptSha256']==digest(ROOT/'tests/desktop-smoke.cjs'),'Native smoke identity changed')
 package=read(ROOT/'output/desktop-package/package-check.json')
 require(package['version']==DESKTOP and package['webVersion']==VERSION and len(package['files'])==271 and not package['directoryOnly'] and package['updaterConfigurationPresent'],'Runtime inventory differs')
 require(package['archiveSha256']==digest(ROOT/'dist-desktop/win-unpacked/resources/app.asar'),'Archive changed')
 result={'version':VERSION,'desktopVersion':DESKTOP,'sourceHash':source,'pass':True,'model':{**evidence(unit_path),'suites':64,'checks':1020},'desktopUnit':{**evidence(desktop_path),'suites':5},'browsers':browsers,'native':native,'nativeSmoke':{**evidence(LOCAL+'/native-smoke-isolated/results.json'),'checks':16},'package':{'archiveSha256':package['archiveSha256'],'assets':271},'userAccepted':False,'scope':'Synthetic isolated Chrome/Edge, emulated mobile/touch/zoom and simulated AI responses. Local actual-library protection is separately recorded. No physical printer/mobile or live AI-provider acceptance.'}
 result['renderIsolation']={'samples':isolation['samples'],'pixelsEqual':all(s['pixelsEqual'] for s in isolation['samples'])}
 if not ci:
  build=read(ROOT/LOCAL/'build-verification.json');require(build['identical'] and build['sourceHash']==source,'Final source rebuild differs')
  result['rebuild']=evidence(LOCAL+'/build-verification.json')
  qa=read(ROOT/BASE/'visual-qa.json');require(qa['complete'] and qa['sourceHash']==source,'Final PDF review incomplete')
  for pdf in qa['pdfs']:
   require(digest(ROOT/pdf['path'])==pdf['sha256'] and pdf['contactsReviewed'] and pdf['manualReviewedPages'],'PDF review changed')
   for png in pdf['renderedPages']:require(digest(ROOT/png['path'])==png['sha256'],'PDF rendering changed')
  result['pdfReview']={**evidence(BASE+'/visual-qa.json'),'pages':sum(p['pages'] for p in qa['pdfs']),'documents':len(qa['pdfs'])}
 return result
def private(result,complete):
 require(digest(CP/'manifest.json')==MANIFEST,'Physical checkpoint changed')
 manifest=read(CP/'manifest.json');require(manifest['complete'] and not manifest['source']['virtualized'] and manifest['source']['parentName']=='explorer.exe','Actual backup incomplete')
 for folder,entries in [('system-userdata',manifest['files']),('program',manifest['programReference']['files'])]:
  for e in entries:require(digest(CP/folder/e['path'])==e['sha256'],'Backup changed')
 stages={};baseline=read(CP/'verification/baseline/receipt.json')
 for mode in (('baseline','candidate','installed','reopened') if complete else ('baseline','candidate')):
  item=read(CP/'verification'/mode/'receipt.json');runner='tests/desktop-system-v2246'+('-reopened' if mode=='reopened' else '')+'.cjs'
  require(item['pass'] and item['normalClose'] and not item['errors'] and not item['guard']['blocked'],'Actual-data stage failed: '+mode)
  require(item['runnerSha256']==digest(ROOT/runner) and item['manifestSha256']==MANIFEST and item['guardSha256']==GUARD,'Private producer/backup changed')
  require(item['snapshotSha256']==digest(CP/'verification'/mode/'snapshot.json') and item['counts']==baseline['counts'],'Private snapshot/count differs')
  require(len(item['checks'])==(3 if mode=='baseline' else 5),'Private check inventory differs')
  if mode!='baseline':require(item['runtimeHtmlSha256']==result['sourceHash'] and item['archiveSha256']==result['package']['archiveSha256'],'Private runtime changed')
  stages[mode]={'pass':True,'checks':len(item['checks']),'normalClose':True,'receiptSha256':digest(CP/'verification'/mode/'receipt.json')}
 result['private']={'stages':stages,'counts':baseline['counts'],'checkpointSha256':MANIFEST};result['privateVerified']=complete
 if complete:
  item=read(ROOT/LOCAL/'system-installation.json');require(item['pass'] and item['version']==DESKTOP and item['systemManifestSha256']==MANIFEST and item['verifierSha256']==digest(__file__),'Installation gate changed')
  require(item['runnerSha256']==digest(ROOT/'scripts/install_v2246_system.ps1') and all(e['matchesTestedPackage'] for e in item['checks']),'Installed bytes differ')
  shortcut=read(ROOT/LOCAL/'shortcut-check.json');require(shortcut['pass'] and shortcut['normalStartup'] and shortcut['launchArgs']==[] and shortcut['uia']['found'] and shortcut['window']['visible'],'Ordinary shortcut failed')
  require(shortcut['sourceHash']==result['sourceHash'] and shortcut['archiveSha256']==result['package']['archiveSha256'] and shortcut['runnerSha256']==digest(ROOT/'scripts/check_v2246_shortcut.ps1'),'Shortcut package changed')
  result['installation']=evidence(LOCAL+'/system-installation.json');result['shortcut']=evidence(LOCAL+'/shortcut-check.json')
def main():
 p=argparse.ArgumentParser();p.add_argument('--ci',action='store_true');p.add_argument('--require-candidate',action='store_true');p.add_argument('--require-private',action='store_true');p.add_argument('--record',action='store_true');a=p.parse_args()
 result=public(a.ci)
 if a.require_candidate or a.require_private:private(result,a.require_private)
 if a.record:(ROOT/'docs/acceptance-2.24.6.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'pass':True,'sourceHash':result['sourceHash'],'privateVerified':result.get('privateVerified',False)}))
if __name__=='__main__':main()
