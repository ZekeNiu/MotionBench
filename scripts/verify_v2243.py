"""Bind the 2.24.3 comparison restoration to its exact source and delivery proof."""
from pathlib import Path
import argparse
import json
import os
import re
import subprocess

import verify_v224 as shared
import verify_v2241 as build
import verify_v224_supplement as regression
import verify_v2242_system as physical

ROOT = shared.ROOT
VERSION, DESKTOP_VERSION = '2.24.3', '2.24.3-desktop.1'
CHECKPOINT = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261016-system-before-2.24.3')
OUT = 'output/implementation-2.24.3/'
BASE_RUNNER = 'tests/desktop-system-v2243.cjs'
SUPPLEMENT_RUNNER = 'tests/desktop-system-v2243-supplement.cjs'
PRESERVATION = 'tests/helpers/v2243-example-preservation.cjs'
PLAN = OUT + 'example-additions-plan.json'
GENERATOR = 'scripts/prepare_v2243_example_additions.cjs'
ENTRY = 'scripts/supplement_longitudinal_example.cjs'
PLAN_SHA = 'fdf701ac00711423500cbd258a2b74d2b61f9f28dcd79f6e7dd2f9ee29ed904e'
GENERATOR_SHA = '215384bd0cc7167ebf7cbd18c33837c116f71464e3536fcabbcbff8715425d12'
require, digest, read = shared.require, shared.digest, shared.read
shared.VERSION, shared.DESKTOP_VERSION, build.VERSION = VERSION, DESKTOP_VERSION, VERSION
regression.VERSION, regression.NATIVE = VERSION, 'output/desktop-smoke-v2243/results.json'


def receipt(file, **extra):
    return {'file': str(file), 'sha256': digest(ROOT / file), **extra}


def node_check(code, *args):
    run = subprocess.run(['node', '-e', code, *map(str, args)], cwd=ROOT, text=True, encoding='utf-8', capture_output=True)
    require(run.returncode == 0, 'Independent data verification failed: ' + run.stderr[-6000:])
    return json.loads(run.stdout)


def linked(entry, expected=None):
    require(isinstance(entry, dict) and isinstance(entry.get('file'), str), 'Missing linked evidence')
    target = Path(entry['file'])
    if not target.is_absolute():
        target = ROOT / target
    if expected is not None:
        require(physical.same_path(target, expected), 'Linked evidence belongs to another stage')
    require(digest(target) == entry.get('sha256'), 'Linked evidence changed: ' + str(target))
    if 'bytes' in entry:
        require(target.stat().st_size == entry['bytes'], 'Linked evidence size changed')
    return target


def checks(runner, mode=None):
    code = (ROOT / runner).read_text(encoding='utf-8')
    if mode:
        match = re.search(r'/\* VERIFY_CHECKS (\{[\s\S]*?\}) VERIFY_CHECKS \*/', code)
        require(match is not None, 'Missing closed native check inventory')
        result = json.loads(match.group(1)).get(mode)
    else:
        result = [item[1] for item in re.findall(r"await check\(\s*(['\"])(.*?)\1", code)]
    require(isinstance(result, list) and result and len(result) == len(set(result)), 'Invalid check inventory')
    return result


def package_proof(source_hash):
    runtime = shared.archive_identity(shared.DIST / 'resources/app.asar')
    require(runtime['runtimeHtmlSha256'] == source_hash and runtime['package']['version'] == DESKTOP_VERSION and runtime['package']['webVersion'] == VERSION, 'Packaged runtime differs from source/version')
    for name, value in runtime['runtimeHashes'].items():
        if name.startswith('desktop/'):
            require(value == digest(ROOT / name), 'Packaged native source changed: ' + name)
    package = read('output/desktop-package/package-check.json')
    require(package.get('version') == DESKTOP_VERSION and package.get('webVersion') == VERSION and package.get('archiveSha256') == digest(shared.DIST / 'resources/app.asar'), 'Package inspection is stale')
    require(package.get('directoryOnly') is False and package.get('updaterConfigurationPresent') is True, 'Final installer package configuration is incomplete')
    inventory = node_check("const asar=require('@electron/asar'),path=require('path');const a=process.argv[1];process.stdout.write(JSON.stringify(asar.listPackage(a).map(n=>n.replaceAll('\\\\','/').replace(/^\\//,'')).filter(n=>!asar.statFile(a,path.normalize(n)).files).sort()));", shared.DIST / 'resources/app.asar')
    require(package.get('files') == inventory and len(inventory) == len(set(inventory)), 'Actual ASAR asset inventory changed')
    return runtime, receipt('output/desktop-package/package-check.json', assets=len(inventory), archiveSha256=digest(shared.DIST / 'resources/app.asar'))


def browser_proof(kind, channel, source_hash, runtime, pdf_files):
    runner = {'layout': 'tests/longitudinal-layout-browser-tests.cjs', 'app': 'tests/longitudinal-browser-tests.cjs', 'personal': 'tests/report-v220-browser-tests.cjs', 'ai': 'tests/longitudinal-ai-browser-tests.cjs', 'interaction': 'tests/longitudinal-interaction-browser-tests.cjs'}[kind]
    relative = f'output/playwright/v2243/{kind}/{channel}/' + (channel + '.json' if kind == 'personal' else 'results.json')
    if kind in ('ai', 'interaction'):
        result = shared.browser_proof(relative, runner, channel, kind, source_hash, runtime, pdf_files)
        require(read(relative).get('network', []) == [], 'Unexpected remote browser traffic')
        return result
    data = read(relative)
    require(data.get('pass') is True and data.get('errors') == [] and data.get('network', []) == [] and not data.get('failure'), 'Browser verification failed: ' + relative)
    require(data.get('channel') == channel and data.get('synthetic') is True and data.get('sourceHash') == source_hash and data.get('sourceUnchanged') is True, 'Browser source/isolation attribution differs')
    require(data.get('runnerSha256') == digest(ROOT / runner), 'Browser producer changed')
    expected = checks(runner)
    if kind == 'app':
        expected = list(shared.expected_checks(runner, 'report', channel, False))
        require(not data.get('pdf'), 'Comparison app scope differs from the assigned non-PDF regression')
    elif kind == 'personal':
        expected = [label for label in expected if not label.startswith(('actual primary PDF', 'actual mean PDF'))]
        require(data.get('pdfs') == [], 'Personal regression scope differs')
    require(len(data.get('checks', [])) == len(expected) and set(data['checks']) == set(expected), 'Browser executed inventory incomplete')
    if kind != 'personal':
        require(data.get('fixtureSha256') == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs'), 'Browser fixture changed')
    files = regression.verify_artifacts(data.get('artifacts', []), relative, pdf_files)
    require(files, 'Browser artwork/export inventory missing')
    directory = Path(relative).parent.as_posix()
    if kind == 'layout':
        require(data.get('sourceOverlay') is False, 'Layout was tested against an injected source overlay')
        modules = {'src/ringside-' + name for name in ('longitudinal.js', 'longitudinal-view.js', 'longitudinal.css', 'pdf.js')}
        require(set(data.get('moduleHashes', {})) == modules and all(data['moduleHashes'][name] == digest(ROOT / name) for name in modules), 'Layout module inventory differs')
        pdf = directory + '/layout.pdf'
        regression.verify_pdf({'file': pdf, 'sha256': digest(ROOT / pdf), 'diagnostics': data.get('pdfDiagnostics')}, pdf_files)
        require(data.get('pdfCapture') and {item.get('count') for item in data.get('dateGrids', [])} == {2, 3, 4, 7} and len(data.get('longDatePrint', {}).get('ids', [])) == 12, 'Layout geometry/date evidence incomplete')
    elif kind == 'app':
        require({'comparison.json', 'comparison.html', 'report-desktop.png', 'report-overview.png'} <= {Path(file).name for file in files}, 'Comparison exports incomplete')
    else:
        require({f'{channel}-report-{width}.png' for width in (1440, 1024, 390)} | {f'{channel}-primary.json', f'{channel}-primary.html'} == {Path(file).name for file in files}, 'Personal export/screenshot inventory differs')
    return receipt(relative, runner=runner, checks=len(expected), **{'pass': True})


def checkpoint_proof():
    manifest = read(CHECKPOINT / 'manifest.json')
    require(manifest.get('runnerSha256') == digest(ROOT / 'scripts/prepare_v2243_system.ps1'), 'Checkpoint producer changed')
    require(manifest.get('sourceCommit') == 'c822c242a894a3ea96a3693870e4cb008e9709c7', 'Original installation baseline commit differs')
    source = manifest.get('source', {})
    require(physical.same_path(source.get('profile', ''), physical.profile_path()) and source.get('virtualized') is False, 'Checkpoint was not captured from the real profile')
    launch = physical.broker_proof(ROOT / (OUT + 'checkpoint-verification-launch.json'), parent=source.get('parentProcessId'), style='Hidden')
    require(str(ROOT / 'scripts/prepare_v2243_system.ps1') in launch.get('arguments', '') and '-VerifyExistingCopies' in launch['arguments'], 'Checkpoint final verification launch differs')
    node_check("const b=require('./tests/desktop-system-v2243.cjs');const result=b.verifyBackup(process.argv[1]);process.stdout.write(JSON.stringify({pass:true,files:result.manifest.files.length}));", CHECKPOINT)
    return manifest


def baseline_proof(manifest):
    directory = CHECKPOINT / 'verification/baseline'
    item, snapshot = read(directory / 'receipt.json'), read(directory / 'snapshot.json')
    require(item.get('pass') is True and item.get('checks') == checks(BASE_RUNNER, 'baseline'), 'Original-library baseline failed')
    for name in ('normalClose', 'runnerUnchanged', 'sourceUnchanged', 'artifactUnchanged', 'dependenciesUnchanged', 'originalPreserved', 'afterSaveUnchanged', 'selectionPreservedData', 'defaultSession'):
        require(item.get(name) is True, 'Incomplete baseline: ' + name)
    require(item.get('errors') == item.get('network') == [] and not item.get('failure'), 'Baseline recorded errors')
    require(item.get('mode') == 'baseline' and item.get('runnerSha256') == digest(ROOT / BASE_RUNNER), 'Baseline producer differs')
    deps = {'tests/desktop-system-v2242.cjs', 'tests/helpers/playwright.cjs'}
    require(set(item.get('dependencyHashes', {})) == deps and all(item['dependencyHashes'][name] == digest(ROOT / name) for name in deps), 'Baseline dependency changed')
    require(item.get('backupManifestSha256') == digest(CHECKPOINT / 'manifest.json') and physical.same_path(item.get('backupManifest', ''), CHECKPOINT / 'manifest.json'), 'Baseline checkpoint differs')
    profile, executable = CHECKPOINT / 'system-baseline-profile', CHECKPOINT / 'program/MotionBench.exe'
    require(item.get('actualProfile') is False and item.get('normalStartup') is False and item.get('launchArgs') == ['--motionbench-test', '--motionbench-data-dir=' + str(profile)], 'Baseline profile attribution differs')
    require(all(physical.same_path(item.get(name, ''), profile) for name in ('profilePath', 'userDataPath', 'sessionDataPath')), 'Baseline profile path differs')
    archive = executable.parent / 'resources/app.asar'
    require(physical.same_path(item.get('executablePath', ''), executable) and physical.same_path(item.get('archivePath', ''), archive) and item.get('executableSha256') == digest(executable) and item.get('archiveSha256') == digest(archive), 'Baseline program differs')
    runtime = shared.archive_identity(archive)
    require(item.get('version') == runtime['package']['version'] == '2.24.2-desktop.1' and item.get('runtimeHtmlSha256') == item.get('sourceHash') == item.get('workspaceSourceHash') == runtime['runtimeHtmlSha256'], 'Baseline source attribution differs')
    require(item.get('originURL') == 'motionbench://app/MotionBench.html' and item.get('databaseName') == 'motionbench-v3:/MotionBench.html', 'Baseline database/origin differs')
    require(item.get('profileCopy') == {'files': len(manifest['files']), 'bytes': manifest['bytes'], 'allFilesEqual': True} and item.get('artifacts') == [] and item.get('pdfRequested') is False, 'Baseline copy/export scope differs')
    require(item.get('guard', {}).get('blocked') == [] and item['guard'].get('writes', 0) > 0, 'Baseline preservation guard incomplete')
    expected = ['startup-snapshot.json', 'selected-snapshot.json', 'snapshot.json']
    require([Path(row.get('file', '')).name for row in item.get('snapshots', [])] == expected, 'Baseline snapshot inventory differs')
    for entry, name, key in zip(item['snapshots'], expected, ['startupSnapshotSha256', 'selectedSnapshotSha256', 'snapshotSha256']):
        require(item.get(key) == digest(linked(entry, directory / name)), 'Baseline snapshot binding differs')
    identity = node_check("const fs=require('fs'),path=require('path'),b=require('./tests/desktop-system-v2243.cjs');const dir=process.argv[1],read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));const start=read('startup-snapshot.json'),selected=read('selected-snapshot.json'),final=read('snapshot.json'),sample=b.example(final.library);b.compareLibrary(start,selected,sample);b.compareSnapshots(selected,final,sample);process.stdout.write(JSON.stringify({example:sample,counts:{athletes:final.library.athletes.length,records:final.reports.length}}));", directory)
    require(item.get('example') == identity['example'] and item.get('counts') == identity['counts'], 'Baseline saved identity/counts differ')
    return receipt(directory / 'receipt.json', checks=len(item['checks']), **identity), snapshot


def plan_proof():
    require(digest(ROOT / PLAN) == PLAN_SHA and digest(ROOT / GENERATOR) == GENERATOR_SHA, 'Approved supplementation plan/generator changed')
    plan = read(PLAN)
    linked(plan['provenance']['baseline'], CHECKPOINT / 'verification/baseline/snapshot.json')
    linked(plan['provenance']['generator'], ROOT / GENERATOR)
    modules = {'app', 'model', 'evaluation', 'longitudinal', 'tests', 'fvp', 'sprint-fvp', 'sprint-elasticity'}
    require(set(plan['provenance'].get('sourceModules', {})) == modules and all(plan['provenance']['sourceModules'][name] == digest(ROOT / f'src/ringside-{name}.js') for name in modules), 'Plan calculation/catalog-install source changed')
    node_check("const fs=require('fs'),assert=require('assert/strict'),p=require('./scripts/prepare_v2243_example_additions.cjs'),file=process.argv[1],original=JSON.parse(fs.readFileSync(file,'utf8'));const expected=p.buildPlan(JSON.parse(fs.readFileSync(original.provenance.baseline.file,'utf8')));delete original.provenance;assert.deepEqual(original,JSON.parse(JSON.stringify(expected)));process.stdout.write(JSON.stringify({pass:true}));", ROOT / PLAN)
    return receipt(PLAN, generatorSha256=GENERATOR_SHA, entryHelperSha256=digest(ROOT / ENTRY)), plan


def calculation_check(code, *args):
    # Electron's V8/libm matches the renderer. System Node differs at the last
    # bits of optimized FVP fits; using the same engine keeps exact equality.
    executable = ROOT / 'node_modules/electron/dist/electron.exe'
    checksum = '2529b494f4123f152bce346051f7bd855ef95006424a561953cf17c49a3d1ba8'
    require(digest(executable) == checksum, 'Independent calculation engine changed')
    prefix = "if(process.env.ELECTRON_RUN_AS_NODE!=='1'||process.versions.electron!=='44.7.0'||process.versions.v8!=='15.2.124.28-electron.0')throw Error('Wrong calculation runtime');"
    run = subprocess.run([str(executable), '-e', prefix + code, *map(str, args)], cwd=ROOT, env={**os.environ, 'ELECTRON_RUN_AS_NODE': '1'}, text=True, encoding='utf-8', capture_output=True)
    require(run.returncode == 0, 'Independent exact calculation verification failed: ' + run.stderr[-6000:])
    require(digest(executable) == checksum, 'Calculation engine changed during verification')
    return {**json.loads(run.stdout), 'calculationRuntime': {'file': str(executable), 'sha256': checksum, 'electron': '44.7.0', 'v8': '15.2.124.28-electron.0', 'runAsNode': True}}


def stage_proof(mode, source_hash, manifest, plan, pdf_files):
    directory = CHECKPOINT / 'verification' / mode
    item = read(directory / 'receipt.json')
    require(item.get('mode') == mode and item.get('pass') is True and item.get('checks') == checks(SUPPLEMENT_RUNNER, mode), 'Incomplete supplementation stage: ' + mode)
    require(item.get('errors') == item.get('network') == [] and not item.get('failure') and not item.get('closeFailure'), 'Supplementation recorded an error')
    for name in ('normalClose', 'runnerUnchanged', 'sourceUnchanged', 'artifactUnchanged', 'dependenciesUnchanged', 'planUnchanged', 'afterSaveUnchanged', 'defaultSession'):
        require(item.get(name) is True, 'Incomplete supplementation evidence: ' + name)
    require(item.get('runnerSha256') == digest(ROOT / SUPPLEMENT_RUNNER), 'Supplementation producer changed')
    deps = {BASE_RUNNER, 'tests/desktop-system-v2242.cjs', PRESERVATION, 'tests/helpers/playwright.cjs', ENTRY}
    require(set(item.get('dependencyHashes', {})) == deps and all(item['dependencyHashes'][name] == digest(ROOT / name) for name in deps), 'Supplementation dependency changed')
    require(item.get('sourceHash') == item.get('workspaceSourceHash') == item.get('runtimeHtmlSha256') == source_hash and item.get('version') == DESKTOP_VERSION, 'Supplementation runtime/source differs')
    require(item.get('planSha256') == PLAN_SHA and physical.same_path(item.get('planFile', ''), ROOT / PLAN), 'Supplementation plan changed')
    for key, file in (('baselineSnapshotSha256', 'verification/baseline/snapshot.json'), ('baselineReceiptSha256', 'verification/baseline/receipt.json'), ('backupManifestSha256', 'manifest.json')):
        require(item.get(key) == digest(CHECKPOINT / file), 'Supplementation baseline binding differs')
    require(physical.same_path(item.get('backupManifest', ''), CHECKPOINT / 'manifest.json'), 'Supplementation checkpoint path differs')
    actual = mode != 'candidate'
    executable = (shared.INSTALLED if actual else shared.DIST) / 'MotionBench.exe'
    archive, profile = executable.parent / 'resources/app.asar', physical.profile_path() if actual else CHECKPOINT / 'system-candidate-profile'
    require(physical.same_path(item.get('executablePath', ''), executable) and physical.same_path(item.get('archivePath', ''), archive) and item.get('executableSha256') == digest(executable) and item.get('archiveSha256') == digest(archive) == digest(shared.DIST / 'resources/app.asar'), 'Supplementation package identity differs')
    require(item.get('actualProfile') is actual and item.get('normalStartup') is False and all(physical.same_path(item.get(name, ''), profile) for name in ('profilePath', 'userDataPath', 'sessionDataPath')), 'Supplementation profile attribution differs')
    require(item.get('originURL') == 'motionbench://app/MotionBench.html' and item.get('databaseName') == 'motionbench-v3:/MotionBench.html', 'Supplementation origin/database differs')
    if actual:
        launch = physical.broker_proof(linked(item.get('launchReceipt'), directory / 'native-launch.json'), target=executable, parent=item.get('parentProcessId'), style='Normal')
        require(re.fullmatch(r'--remote-debugging-port=[1-9][0-9]{0,4}', launch.get('arguments', '')) and item.get('launchArgs') == [launch['arguments']] and item.get('systemContext') is True and item.get('parentName', '').lower() == 'explorer.exe', 'Actual data proof did not use the real Explorer process')
        before = item.get('physicalEvidence', {}).get('before', {})
        probe_file = linked(before, directory / 'before-physical.json')
        probe = read(probe_file)
        probe_launch = physical.broker_proof(linked(before.get('launchReceipt'), directory / 'before-physical-launch.json'), parent=probe.get('parentProcessId'), style='Hidden')
        probe_source = ROOT / 'output/implementation-2.24.2/inspect-system-profile.ps1'
        require(probe.get('runnerSha256') == digest(probe_source) and str(probe_source) in probe_launch.get('arguments', '') and str(probe_file) in probe_launch['arguments'] and probe.get('exists') is True, 'Physical probe source/destination differs')
        require(physical.same_path(probe.get('profile', ''), profile) and probe.get('parentName', '').lower() == 'explorer.exe' and probe.get('files') == len(probe.get('resolvedFiles', [])), 'Actual physical profile probe differs')
        physical.physical_files(probe.get('resolvedFiles'), complete=True)
        for name in ('ai-settings.dat', 'desktop-preferences.json'):
            old = next((row for row in manifest['files'] if row['path'] == name), None)
            current = next((row for row in probe['resolvedFiles'] if physical.same_path(row['logical'], profile / name)), None)
            require(bool(old) == bool(current) and (not old or old['sha256'] == current['sha256']), 'Protected native preference changed')
        close = item.get('closeEvidence', {})
        require(close.get('method') == 'CloseMainWindow' and close.get('requested') is True and close.get('exited') is True and close.get('processId') == item.get('processId'), 'Actual native process did not close normally')
    else:
        require(item.get('launchArgs') == ['--motionbench-test', '--motionbench-data-dir=' + str(profile)] and item.get('profileCopy') == {'files': len(manifest['files']), 'bytes': manifest['bytes'], 'allFilesEqual': True}, 'Candidate was not a complete isolated copy')
    names = ['startup-snapshot.json', 'selected-snapshot.json', 'snapshot.json']
    require([Path(row.get('file', '')).name for row in item.get('snapshots', [])] == names, 'Supplementation snapshot inventory differs')
    for entry, name, key in zip(item['snapshots'], names, ['startupSnapshotSha256', 'selectedSnapshotSha256', 'snapshotSha256']):
        require(item.get(key) == digest(linked(entry, directory / name)), 'Supplementation snapshot binding differs')
    require(item.get('guard', {}).get('blocked') == [] and item['guard'].get('writes', 0) > 0, 'Supplementation preservation guard incomplete')
    if mode == 'reopened':
        require(item.get('installedSnapshotSha256') == digest(CHECKPOINT / 'verification/installed/snapshot.json'), 'Reopened data does not match the installed saved snapshot')
    else:
        require(item.get('originalPreserved') is True and item.get('approvedChangesVerified') is True, 'Approved measurement preservation was not verified')
        if mode == 'installed':
            require(item.get('candidateSnapshotSha256') == digest(CHECKPOINT / 'verification/candidate/snapshot.json'), 'Installed measurements were not compared with the candidate')
    independent = calculation_check(DATA_PROOF, directory, ROOT / PLAN, CHECKPOINT / 'verification/baseline/snapshot.json')
    require(item.get('counts') == item.get('countsBefore') == independent['counts'], 'Supplementation added or removed a record')
    files = []
    for entry in item.get('artifacts', []):
        file = linked(entry)
        require(file.is_relative_to(ROOT / 'output/playwright/v2243/system-candidate'), 'Supplementation artifact has an unexpected destination')
        relative = file.relative_to(ROOT).as_posix()
        shared.artifact({'file': relative, 'sha256': entry['sha256']}, str(directory / 'receipt.json'), pdf_files)
        files.append(relative)
    require(len(files) == len(set(files)) and item.get('pdfRequested') is (mode == 'candidate'), 'Supplementation export scope differs')
    if mode == 'candidate':
        require({Path(file).name for file in files} == {'existing-comparison.' + ext for ext in ('json', 'html', 'pdf', 'png')}, 'Candidate exports incomplete')
        relative = next(file for file in files if file.endswith('.pdf'))
        regression.verify_pdf({'file': relative, 'sha256': digest(ROOT / relative), 'diagnostics': item.get('pdfDiagnostics')}, pdf_files)
        node_check(EXPORT_PROOF, directory / 'snapshot.json', ROOT / 'output/playwright/v2243/system-candidate')
        require(digest(ROOT / 'output/playwright/v2243/system-candidate/results.json') == digest(directory / 'receipt.json'), 'Public candidate receipt differs from the original')
    else:
        require(files == [], 'Installed/reopened verification exported additional private artifacts')
    return receipt(directory / 'receipt.json', checks=len(item['checks']), artifacts=files, **independent)


DATA_PROOF = r"""
const fs=require('fs'),path=require('path'),b=require('./tests/desktop-system-v2243.cjs'),s=require('./tests/desktop-system-v2243-supplement.cjs'),p=require('./tests/helpers/v2243-example-preservation.cjs'),c=require('./tests/helpers/longitudinal-fixture.cjs').context();
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),dir=process.argv[1],plan=read(process.argv[2]),original=read(process.argv[3]),item=read(path.join(dir,'receipt.json')),start=read(path.join(dir,'startup-snapshot.json')),selected=read(path.join(dir,'selected-snapshot.json')),final=read(path.join(dir,'snapshot.json')),identity=b.example(original.library),range={start:item.startedAt,end:item.completedAt};
const plain=v=>JSON.parse(JSON.stringify(v,(_k,value)=>Object.prototype.toString.call(value)==='[object Set]'?{type:'Set',values:[...value]}:Object.prototype.toString.call(value)==='[object Map]'?{type:'Map',entries:[...value]}:value));
function recompute(snapshot){const lib=snapshot.library,reports=[];for(const owner of lib.athletes)for(const record of owner.records){const effective=c.RingsideEvaluation.resolve(record,lib.evaluationProfiles.find(x=>x.id===record.evaluationProfileId)),stats=c.RingsideModel.stats(effective);reports.push({recordId:record.recordId,values:stats.values,axes:stats.axes,evaluationResults:stats.evaluationResults,basis:c.RingsideModel.fingerprint(effective),narrative:record.narrative});}p.same(plain(reports),snapshot.reports,'Saved report calculations do not match their actual raw records');const active=snapshot.activeComparison; p.require(active,'Missing active comparison');const owner=lib.athletes.find(x=>x.id===active.athleteId),records=active.recordIds.map(id=>owner.records.find(r=>r.recordId===id)),latest=[...records].sort((a,b)=>a.athlete.date.localeCompare(b.athlete.date)).at(-1),model=c.RingsideLongitudinal.build(records,{athleteId:active.athleteId,mode:active.document.mode,profile:lib.evaluationProfiles.find(x=>x.id===latest.evaluationProfileId),catalog:lib.catalog});p.same(plain(model),active.model,'Full comparison model differs from independent source calculations');}
b.compareSnapshots(selected,final,identity);recompute(final);
if(item.mode==='reopened'){const saved=read(path.join(dir,'../installed/snapshot.json'));b.compareSnapshots(start,saved,identity);b.compareSnapshots(start,selected,identity);}
else {const initial=s.initialDocument(start,original,plan,range);p.same(initial.transitions,item.startupDocumentTransitions,'Startup comparison transitions differ');
 const originalSample=p.sample(original.library,plan),priorById=new Map(originalSample.owner.records.map(r=>[r.recordId,r])),generated={},reserved=p.allIds(original.library);let previous=initial.document;
 p.same(item.guard.timestampStart,item.startedAt,'Guard timestamp window differs');p.require(item.guard.documentTransitions.length>0,'Missing comparison transition history');
 for(const transition of item.guard.documentTransitions){p.same(transition.basisRecords.map(r=>r.recordId),plan.recordIds,'Transition raw record inventory changed');for(const record of transition.basisRecords)p.verifyRecord(record,priorById.get(record.recordId),plan.records.find(row=>row.recordId===record.recordId),{final:false,generatedIds:generated,reservedIds:reserved,timestampRange:range});
  const latest=[...transition.basisRecords].sort((a,b)=>a.athlete.date.localeCompare(b.athlete.date)).at(-1),basis=c.RingsideLongitudinal.build(transition.basisRecords,{athleteId:plan.athleteId,mode:originalSample.document.mode,profile:original.library.evaluationProfiles.find(x=>x.id===latest.evaluationProfileId),catalog:original.library.catalog}).basis;p.same(basis,transition.expectedBasis,'Transition calculation basis differs from its saved measurements');
  const document={...p.clone(previous),basis:transition.basis,revision:transition.toRevision,views:p.clone(transition.views),updated:transition.updated},verified=p.verifyDocument(document,originalSample.document,previous,{expectedBasis:basis,timestampRange:range}),logged=p.clone(transition);delete logged.basisRecords;delete logged.expectedBasis;p.same(verified,logged,'Comparison revision/view transition log differs');previous=document;
 }
 p.same(previous,item.guard.expectedDocument,'Final comparison document differs from the exact transition replay');
 const allowedIds=plan.records.flatMap(row=>row.allowedChanges.flatMap(change=>(change.generatedIdsOnly||[]).map(id=>row.recordId+':'+change.path+'.'+id))).sort();p.same(Object.keys(item.guard.generatedIds).sort(),allowedIds,'Generated ID ledger contains missing or unapproved paths');
 s.verifyCompleted(selected,original,plan,item.guard,range);s.verifyCompleted(final,original,plan,item.guard,range);if(item.mode==='installed')s.compareCompletedAcrossRuns(final,read(path.join(dir,'../candidate/snapshot.json')),plan);}
process.stdout.write(JSON.stringify({counts:{athletes:final.library.athletes.length,records:final.reports.length},example:identity,independentCalculationsVerified:true}));
"""

EXPORT_PROOF = r"""
const fs=require('fs'),path=require('path'),b=require('./tests/desktop-system-v2243.cjs'),read=f=>JSON.parse(fs.readFileSync(f,'utf8')),saved=read(process.argv[1]),dir=process.argv[2],identity=b.example(saved.library);b.verifyExport(read(path.join(dir,'existing-comparison.json')),saved,identity);const match=fs.readFileSync(path.join(dir,'existing-comparison.html'),'utf8').match(/<script\b[^>]*\bid="embedded-data"[^>]*>([\s\S]*?)<\/script>/i);if(!match)throw Error('Missing exported HTML snapshot');b.verifyExport(JSON.parse(match[1]),saved,identity);process.stdout.write(JSON.stringify({pass:true}));
"""


def native_proof(source_hash, runtime, pdf_files):
    data = read(regression.NATIVE)
    if data.get('pass') is True:
        return regression.native_proof(source_hash, runtime, pdf_files)
    issue_file = OUT + 'known-clipboard-issue.json'
    issue = read(issue_file)
    require(issue.get('status') == 'recorded' and issue.get('sourceHash') == source_hash and issue.get('runnerSha256') == digest(ROOT / regression.NATIVE_RUNNER), 'Clipboard issue attribution differs')
    require(issue.get('decision') == '先完成纵向比较，记录剪贴板问题' and issue.get('runtimeModified') is False and issue.get('assertionUnchanged') is True and issue.get('reason'), 'Clipboard issue exceeds the prior user decision')
    linked(issue.get('receipt'), ROOT / regression.NATIVE)
    code, failure = (ROOT / regression.NATIVE_RUNNER).read_text(encoding='utf-8').splitlines(), data.get('failure', '')
    require('JSON.parse(copiedFacts)' in code[625] and failure.startswith('SyntaxError: Unexpected end of JSON input\n    at JSON.parse (<anonymous>)\n') and 'desktop-smoke.cjs:626:29' in failure and 'desktop-smoke.cjs:620:5' in failure, 'Native failure is not the exact final empty clipboard JSON assertion')
    known = receipt(issue_file, status='recorded', check=regression.CLIPBOARD, reason=issue['reason'], userDecision=issue['decision'])
    prior = regression.environment_proof
    try:
        regression.environment_proof = lambda actual: known if actual == source_hash else require(False, 'Clipboard source differs')
        result = regression.native_proof(source_hash, runtime, pdf_files)
        require(result['pass'] is False and result['checksPassing'] == 15 and result['checksExpected'] == 16, 'Clipboard exception concealed another missing assertion')
        return {**result, 'knownIssue': known}
    finally:
        regression.environment_proof = prior


def visual_proof(source_hash, producers, pdf_files, *, layout=False):
    relative = OUT + ('layout-visual-review.json' if layout else 'visual-review.json')
    item = read(relative)
    require(item.get('pass') is True and item.get('sourceHash') == source_hash and item.get('errors') == item.get('issues') == [], 'Visual review failed or is stale')
    if layout:
        require(item.get('synthetic') is True, 'Layout review must remain identified as synthetic')
    expected = {file: producer for producer in producers for file in producer['artifacts'] if file.endswith('.pdf')}
    entries = item.get('pdfs', [])
    require(len(entries) == len(expected) and {entry.get('file') for entry in entries} == set(expected), 'Visual PDF scope differs from its producers')
    for entry in entries:
        producer = expected[entry['file']]
        require(physical.same_path(entry.get('producerReceipt', ''), ROOT / producer['file']) and entry.get('producerReceiptSha256') == producer['sha256'] and entry.get('runnerSha256') == digest(ROOT / ('tests/longitudinal-layout-browser-tests.cjs' if layout else SUPPLEMENT_RUNNER)), 'Visual PDF producer changed')
        shared.artifact(entry, relative, pdf_files)
        count, pages = pdf_files[entry['file']], entry.get('pages', [])
        require(entry.get('pageCount') == count and entry.get('reviewedPages') == list(range(1, count + 1)) and len(pages) == count and sorted(page.get('page') for page in pages) == list(range(1, count + 1)) and len({page.get('file') for page in pages}) == count, 'Visual page review is incomplete or duplicated')
        for page in pages:
            require(Path(page.get('file', '')).suffix.lower() == '.png', 'Visual page artwork is not PNG')
            shared.artifact(page, relative, pdf_files)
    for key in ('screenshots', 'responsiveScreenshots', 'browserScreenshots'):
        if key in item:
            regression.verify_artifacts(item[key], relative, pdf_files)
    return receipt(relative, pages=sum(entry['pageCount'] for entry in entries), scope='synthetic layout' if layout else 'existing real-profile example', **{'pass': True})


def installation_proof(manifest):
    relative = OUT + 'system-installation.json'
    item = read(relative)
    require(item.get('pass') is True and item.get('version') == DESKTOP_VERSION and item.get('installerExitCode') == 0, 'Actual installation failed')
    require(item.get('runnerSha256') == digest(ROOT / 'scripts/install_v2243_system.ps1') and item.get('verifierSha256') == digest(Path(__file__)), 'Install-time producer/preflight verifier differs')
    require(physical.same_path(item.get('installationDirectory', ''), shared.INSTALLED) and physical.same_path(item.get('profilePath', ''), physical.profile_path()) and item.get('systemManifestSha256') == digest(CHECKPOINT / 'manifest.json'), 'Installation destination/checkpoint differs')
    require(item.get('parentName', '').lower() == 'explorer.exe' and physical.same_path(item.get('parentExecutable', ''), Path(os.environ['WINDIR']) / 'explorer.exe'), 'Installer was not run by the real Desktop Explorer')
    launch = physical.broker_proof(ROOT / (OUT + 'system-installation-launch.json'), parent=item.get('parentProcessId'), style='Hidden')
    require(str(ROOT / 'scripts/install_v2243_system.ps1') in launch.get('arguments', ''), 'Installer launch differs')
    physical.physical_files(item.get('physicalFiles'), complete=True)
    identity = lambda rows: {(physical.logical_path(row['logical']), physical.logical_path(row['physical']), row['bytes'], row['sha256']) for row in rows}
    require(len(item['physicalFiles']) == len(manifest['files']) and identity(item['physicalFiles']) == identity(manifest['files']), 'Installation original physical profile differs from the complete backup')
    require(item.get('installerSha256') == digest(ROOT / f'dist-desktop/MotionBench-{DESKTOP_VERSION}-Setup-x64.exe'), 'Installed setup artifact changed')
    inventory = item.get('checks', [])
    require(len(inventory) == 2 and {row.get('file') for row in inventory} == {'MotionBench.exe', 'resources/app.asar'}, 'Installed artifact inventory incomplete')
    for row in inventory:
        require(row.get('matchesTestedPackage') is True and row.get('sha256') == digest(shared.INSTALLED / row['file']) == digest(shared.DIST / row['file']), 'Installed package differs from the candidate')
    return receipt(relative, **{'pass': True})


def shortcut_proof(source_hash, plan, pdf_files):
    relative = OUT + 'shortcut-launch.json'
    item, executable = read(relative), shared.INSTALLED / 'MotionBench.exe'
    require(item.get('pass') is True and item.get('errors') == [] and item.get('sourceHash') == source_hash and item.get('runnerSha256') == digest(ROOT / 'scripts/check_v2243_shortcut.ps1'), 'Visible shortcut verification failed or changed')
    shortcut = Path(item.get('shortcutPath', ''))
    require(shortcut.suffix.lower() == '.lnk' and item.get('shortcutSha256') == digest(shortcut), 'User shortcut changed')
    command = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + str(shortcut).replace("'", "''") + "'); @{target=$s.TargetPath;arguments=$s.Arguments} | ConvertTo-Json -Compress"
    actual = json.loads(subprocess.check_output(['powershell', '-NoProfile', '-Command', command], text=True, encoding='utf-8-sig'))
    require(physical.same_path(actual['target'], executable) and physical.same_path(item.get('targetPath', ''), executable) and actual['arguments'] == '', 'Shortcut target/arguments differ')
    require(item.get('executableSha256') == digest(executable) and item.get('archiveSha256') == digest(shared.INSTALLED / 'resources/app.asar') and item.get('normalStartup') is True and item.get('launchArgs') == [] and physical.same_path(item.get('profilePath', ''), physical.profile_path()), 'Visible launch identity differs')
    launch = item.get('desktopLaunch', {})
    broker = physical.broker_proof(linked(launch, ROOT / (OUT + 'shortcut-desktop-launch.json')), target=shortcut, parent=launch.get('parentProcessId'), style='Normal')
    require(broker.get('arguments') == '', 'Desktop shortcut launch has extra arguments')
    window, uia = item.get('window', {}), item.get('uia', {})
    require(window.get('visible') is True and isinstance(window.get('processId'), int) and window['processId'] > 0 and window.get('title'), 'No visible application window evidence')
    require(uia.get('found') is True and uia.get('athleteName') == '示例运动员｜纵向比较（合成）' and uia.get('selectedDates') == plan['dates'] and uia.get('controlCount', 0) > 0, 'Visible saved example/dates differ')
    regression.verify_artifacts(item.get('artifacts', []), relative, pdf_files)
    return receipt(relative, **{'pass': True})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--record', action='store_true')
    group = parser.add_mutually_exclusive_group()
    for option in ('ci', 'require-candidate', 'require-private'):
        group.add_argument('--' + option, action='store_true')
    args = parser.parse_args()
    source_hash, pdf_files = digest(ROOT / 'MotionBench.html'), {}
    require(read('package.json')['version'] == VERSION, 'Wrong source version')
    build.build_proof()
    unit = shared.suite_proof('output/tests/v2243/unit-results.json', 'tests/run-unit-tests.cjs', source_hash)
    desktop = shared.suite_proof('output/tests/v2243/desktop-unit/results.json', 'tests/run-desktop-unit-tests.cjs', source_hash, desktop=True)
    runtime, package = package_proof(source_hash)
    browsers = [browser_proof(kind, channel, source_hash, runtime, pdf_files) for kind in ('layout', 'app', 'personal', 'ai', 'interaction') for channel in ('chrome', 'msedge')]
    private, native, visuals, installation, shortcut = None, None, [], None, None
    if not args.ci:
        manifest = checkpoint_proof()
        baseline, snapshot = baseline_proof(manifest)
        plan_receipt, plan = plan_proof()
        candidate = stage_proof('candidate', source_hash, manifest, plan, pdf_files)
        private = {'baseline': baseline, 'plan': plan_receipt, 'candidate': candidate}
        native = native_proof(source_hash, runtime, pdf_files)
        layout_producers = [receipt(f'output/playwright/v2243/layout/{channel}/results.json', artifacts=[f'output/playwright/v2243/layout/{channel}/layout.pdf']) for channel in ('chrome', 'msedge')]
        visuals = [visual_proof(source_hash, layout_producers, pdf_files, layout=True), visual_proof(source_hash, [candidate], pdf_files)]
        if args.require_private:
            installation = installation_proof(manifest)
            for mode in ('installed', 'reopened'):
                private[mode] = stage_proof(mode, source_hash, manifest, plan, pdf_files)
            shortcut = shortcut_proof(source_hash, plan, pdf_files)
    summary = {'version': VERSION, 'desktopVersion': DESKTOP_VERSION, 'pass': True, 'sourceHash': source_hash, 'verifierSha256': digest(Path(__file__)),
        'modelSuites': len(unit['suites']), 'modelChecks': sum(item.get('checksPassed', 0) for item in unit['suites']), 'desktopUnitSuites': len(desktop['suites']),
        'unitProof': receipt('output/tests/v2243/unit-results.json'), 'desktopUnitProof': receipt('output/tests/v2243/desktop-unit/results.json'), 'package': package, 'browsers': browsers, 'pdfFiles': pdf_files,
        'ci': args.ci, 'candidateVerified': not args.ci, 'privateVerified': args.require_private, 'private': private,
        'native': native, 'visuals': visuals, 'installation': installation, 'shortcut': shortcut}
    require(digest(ROOT / 'MotionBench.html') == source_hash, 'Source changed during verification')
    if args.record:
        (ROOT / ('docs/acceptance-2.24.3-ci.json' if args.ci else 'docs/acceptance-2.24.3.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: summary[key] for key in ('version', 'pass', 'modelSuites', 'modelChecks', 'ci', 'candidateVerified', 'privateVerified', 'sourceHash')}))


if __name__ == '__main__':
    main()
