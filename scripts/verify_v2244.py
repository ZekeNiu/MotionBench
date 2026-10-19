"""Exact source, display-state and original-data evidence for MotionBench 2.24.4."""
from pathlib import Path
import argparse
import json
import os
import re
import subprocess

import verify_v2243 as prior

shared, build, regression, physical = prior.shared, prior.build, prior.regression, prior.physical
ROOT = shared.ROOT
VERSION, DESKTOP_VERSION = '2.24.4', '2.24.4-desktop.1'
CHECKPOINT = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261019-system-before-2.24.4')
MANIFEST_SHA = '4fe4a27c202cb6e1653f0058e5adf3bef1d4de2e5d37e8cd427c97e0cf39b227'
BASELINE_ENTRY_SHA = 'd8878979128f74725d891b3d23fcc7d1038b76e3f5f367b161e3a16bf369fcd4'
BASELINE_RECEIPT_SHA = 'b1a2661496377b955ba5ea182a137a837a5cf38ad59f072eefa62d1363721255'
BASELINE_SNAPSHOT_SHA = 'bacd965b709acc59030626c7623a4159502d18a1137110ab90d936b896562649'
OUT = 'output/implementation-2.24.4/'
ENTRY, STAGES, PROTECTION = 'tests/desktop-system-v2244-current.cjs', 'tests/helpers/desktop-system-v2244-stages.cjs', 'tests/helpers/v2244-display-preservation.cjs'
REOPEN_ENTRY, REOPEN_STAGES = 'tests/desktop-system-v2244-reopened.cjs', 'tests/helpers/desktop-system-v2244-reopened-stages.cjs'
PREINSTALL_VERIFIER = 'scripts/verify_v2244_preinstall.py'
PREINSTALL_VERIFIER_SHA = 'c50f13be53c6950ebe38db91310a23916e1f7fbd9a5969b142b65917f98198e1'
DEPS = {'tests/desktop-system-v2244.cjs', 'tests/desktop-system-v2243.cjs', 'tests/desktop-system-v2242.cjs', 'tests/helpers/playwright.cjs'}
require, digest, read, linked, checks, receipt = prior.require, prior.digest, prior.read, prior.linked, prior.checks, prior.receipt
shared.VERSION, shared.DESKTOP_VERSION, build.VERSION = VERSION, DESKTOP_VERSION, VERSION
regression.VERSION, regression.NATIVE = VERSION, 'output/desktop-smoke-v2244/results.json'
prior.VERSION, prior.DESKTOP_VERSION, prior.OUT = VERSION, DESKTOP_VERSION, OUT
prior.SUPPLEMENT_RUNNER = ENTRY


def browser_proof(kind, channel, source_hash, runtime, pdf_files):
    runners = {'layout': 'tests/longitudinal-layout-v2244-tests.cjs', 'layout-regression': 'tests/longitudinal-layout-browser-tests.cjs', 'longitudinal-controls': 'tests/longitudinal-controls-browser-tests.cjs', 'app': 'tests/longitudinal-browser-tests.cjs', 'personal': 'tests/report-v220-browser-tests.cjs', 'ai': 'tests/longitudinal-ai-browser-tests.cjs', 'interaction': 'tests/longitudinal-interaction-browser-tests.cjs'}
    runner = runners[kind]
    relative = f'output/playwright/v2244/{kind}/{channel}/' + (channel + '.json' if kind == 'personal' else 'results.json')
    if kind in ('ai', 'interaction'):
        result = shared.browser_proof(relative, runner, channel, kind, source_hash, runtime, pdf_files)
        require(read(relative).get('network', []) == [], 'Unexpected browser remote traffic')
        return result
    item = read(relative)
    require(item.get('pass') is True and item.get('errors') == [] and item.get('network', []) == [] and not item.get('failure') and not item.get('closeFailure'), 'Browser verification failed: ' + relative)
    require(item.get('channel') == channel and item.get('synthetic') is True and item.get('sourceHash') == source_hash and item.get('sourceUnchanged') is True and item.get('runnerSha256') == digest(ROOT / runner), 'Browser source or producer changed')
    expected = checks(runner)
    if kind == 'app':
        expected = list(shared.expected_checks(runner, 'report', channel, False))
        require(not item.get('pdf'), 'Comparison app regression export scope differs')
    elif kind == 'personal':
        expected = [label for label in expected if not label.startswith(('actual primary PDF', 'actual mean PDF'))]
        require(item.get('pdfs') == [], 'Personal regression export scope differs')
    require(len(item.get('checks', [])) == len(expected) and set(item['checks']) == set(expected), 'Browser executed check inventory incomplete')
    if kind != 'personal':
        require(item.get('fixtureSha256') == digest(ROOT / shared.FIXTURE), 'Browser fixture changed')
    files = regression.verify_artifacts(item.get('artifacts', []), relative, pdf_files)
    require(files, 'Browser artwork/export inventory missing')
    if kind in ('layout', 'layout-regression', 'longitudinal-controls'):
        require(item.get('runnerUnchanged') is True, 'Browser producer changed during execution')
        names = ('longitudinal.js', 'longitudinal-view.js', 'longitudinal.css', 'pdf.js') if kind != 'longitudinal-controls' else ('longitudinal-views.js', 'longitudinal-store.js', 'longitudinal-controller.js', 'longitudinal-view.js', 'longitudinal.js', 'app.js', 'pdf.js')
        modules = {'src/ringside-' + name for name in names}
        require(set(item.get('moduleHashes', {})) == modules and all(item['moduleHashes'][name] == digest(ROOT / name) for name in modules), 'Browser module inventory changed')
        if kind.startswith('layout'):
            require(item.get('sourceOverlay') is False and item.get('pdfCapture'), 'Layout proof used an overlay or skipped PDF')
            pdf = f'output/playwright/v2244/{kind}/{channel}/layout.pdf'
            regression.verify_pdf({'file': pdf, 'sha256': digest(ROOT / pdf), 'diagnostics': item.get('pdfDiagnostics')}, pdf_files)
        else:
            require(item.get('modulesUnchanged') is True, 'Control modules changed during execution')
            pdf = f'output/playwright/v2244/{kind}/{channel}/comparison.pdf'
            regression.verify_pdf({'file': pdf, 'sha256': digest(ROOT / pdf), 'diagnostics': item.get('pdfDiagnostics')}, pdf_files)
            display = item.get('pdfDisplayEvidence', {})
            require(display.get('controlsRemoved') is True and display.get('chartCount', 0) > 0 and display.get('tableCount', 0) > 0 and set(display.get('selected', {})) == {'risk', 'overview', 'fms', 'fvp_sj:profile'}, 'Printed control/date evidence incomplete')
            require(item.get('saveFailureEvidence', {}).get('fired') is True and item.get('remap', {}).get('originalRecordId') != item.get('remap', {}).get('mappedRecordId'), 'Display failure/import regression evidence incomplete')
            require({'comparison.json', 'comparison.html', 'comparison.pdf', 'comparison-complete.motionbench.jsonl', 'comparison-for-remap.json', 'controls-overview.png', 'nine-dates.png'} <= {Path(file).name for file in files}, 'Display control export inventory incomplete')
    elif kind == 'app':
        require({'comparison.json', 'comparison.html', 'report-desktop.png', 'report-overview.png'} <= {Path(file).name for file in files}, 'Comparison export inventory incomplete')
    elif kind == 'personal':
        require({f'{channel}-report-{width}.png' for width in (1440, 1024, 390)} | {f'{channel}-primary.json', f'{channel}-primary.html'} == {Path(file).name for file in files}, 'Personal export inventory differs')
    return receipt(relative, runner=runner, checks=len(expected), artifacts=list(files), **{'pass': True})


def checkpoint_proof():
    original = CHECKPOINT.parent / '20261017-system-before-2.24.4'
    for file, expected in ((original / 'manifest.json', 'dfa6227ac5fedad87074f7b36ba54b663dbecd6eb06724ed1b18884c1c6fc566'), (original / 'verification/baseline/receipt.json', '281319b7b6c216cddcbd4e0ea842dd01a965ff31cb59d40907480b039ea509ba'), (original / 'verification/baseline/snapshot.json', 'c2f1bc55fb67654280e75a6ee543a0f4bfa045774e9652d30a0f4f00be9d0a1c'), (ROOT / 'tests/desktop-system-v2244.cjs', '5a506b52f56ef345f742bbdd994e0c895171080adbfca35d79626a0612ec6566')):
        require(digest(file) == expected, 'Original frozen checkpoint/producer changed')
    require(digest(CHECKPOINT / 'manifest.json') == MANIFEST_SHA, 'Original system checkpoint changed')
    manifest = read(CHECKPOINT / 'manifest.json')
    require(manifest.get('runnerSha256') == digest(ROOT / 'output/implementation-2.24.4/resume-20261019/prepare-fresh-checkpoint.ps1') and manifest.get('sourceCommit') == '09a6bf89bbd1ae70300d43f15857eadb1992b947', 'Checkpoint producer or original commit differs')
    require(manifest.get('fileCount') == 75 and len(manifest.get('programReference', {}).get('files', [])) == 74, 'Original checkpoint inventory differs')
    require(physical.same_path(manifest.get('source', {}).get('profile', ''), physical.profile_path()), 'Checkpoint belongs to another system profile')
    prior.node_check("const b=require('./tests/desktop-system-v2243.cjs');const value=b.verifyBackup(process.argv[1]);process.stdout.write(JSON.stringify({pass:true,files:value.manifest.fileCount}));", CHECKPOINT)
    return manifest


def snapshots(item, directory):
    names = ['startup-snapshot.json', 'selected-snapshot.json', 'snapshot.json']
    require([Path(row.get('file', '')).name for row in item.get('snapshots', [])] == names, 'Snapshot inventory differs')
    for entry, name, key in zip(item['snapshots'], names, ['startupSnapshotSha256', 'selectedSnapshotSha256', 'snapshotSha256']):
        require(item.get(key) == digest(linked(entry, directory / name)), 'Snapshot hash binding differs')


def identity(item, mode, manifest, source_hash=None):
    baseline, actual = mode == 'baseline', mode in ('installed', 'reopened')
    entry, stages = (REOPEN_ENTRY, REOPEN_STAGES) if mode == 'reopened' else (ENTRY, STAGES)
    directory = CHECKPOINT / 'verification' / mode
    require(item.get('mode') == mode and item.get('kind') == 'existing-data-display-preservation' and item.get('pass') is True and item.get('checks') == checks(entry if baseline else stages, mode), 'Native check inventory is incomplete: ' + mode)
    require(item.get('errors') == item.get('network') == [] and not item.get('failure') and not item.get('closeFailure'), 'Native stage contains errors')
    for key in ('normalClose', 'runnerUnchanged', 'sourceUnchanged', 'artifactUnchanged', 'dependenciesUnchanged', 'originalPreserved', 'afterSaveUnchanged', 'defaultSession'):
        require(item.get(key) is True, 'Incomplete native proof: ' + key)
    require(item.get('runnerSha256') == digest(ROOT / entry), 'Frozen entry producer changed')
    deps = DEPS if baseline else DEPS | {ENTRY, PROTECTION}
    require(set(item.get('dependencyHashes', {})) == deps and all(item['dependencyHashes'][file] == digest(ROOT / file) for file in deps), 'Native dependency inventory changed')
    if not baseline:
        require(item.get('implementationUnchanged') is True and item.get('implementationSha256') == digest(ROOT / stages), 'Native stage producer changed')
        require(item.get('baselineSnapshotSha256') == digest(CHECKPOINT / 'verification/baseline/snapshot.json') and item.get('baselineReceiptSha256') == digest(CHECKPOINT / 'verification/baseline/receipt.json'), 'Original baseline binding differs')
    require(item.get('backupManifestSha256') == MANIFEST_SHA and physical.same_path(item.get('backupManifest', ''), CHECKPOINT / 'manifest.json'), 'Native checkpoint binding differs')
    executable = (CHECKPOINT / 'program' if baseline else shared.INSTALLED if actual else shared.DIST) / 'MotionBench.exe'
    archive = executable.parent / 'resources/app.asar'
    profile = physical.profile_path() if actual else CHECKPOINT / ('system-baseline-profile' if baseline else 'system-candidate-profile')
    require(physical.same_path(item.get('executablePath', ''), executable) and physical.same_path(item.get('archivePath', ''), archive) and item.get('executableSha256') == digest(executable) and item.get('archiveSha256') == digest(archive), 'Native program identity changed')
    runtime = shared.archive_identity(archive)
    require(item.get('version') == runtime['package']['version'] == ('2.24.3-desktop.1' if baseline else DESKTOP_VERSION), 'Native runtime version differs')
    require(item.get('sourceHash') == item.get('runtimeHtmlSha256') == runtime['runtimeHtmlSha256'], 'Native runtime source differs')
    if not baseline:
        require(item.get('sourceHash') == item.get('workspaceSourceHash') == source_hash and digest(archive) == digest(shared.DIST / 'resources/app.asar'), 'Final native artifact does not match final source/package')
    require(item.get('actualProfile') is actual and item.get('normalStartup') is False and all(physical.same_path(item.get(key, ''), profile) for key in ('profilePath', 'userDataPath', 'sessionDataPath')), 'Native profile attribution differs')
    require(item.get('originURL') == 'motionbench://app/MotionBench.html' and item.get('databaseName') == 'motionbench-v3:/MotionBench.html', 'Native origin/database differs')
    if actual:
        launch = prior.actual_context_proof(item, directory, manifest)
        require(item.get('launchStartedAt') == launch.get('requestedAt'), 'Startup window must begin at the verified Explorer launch')
    else:
        require(item.get('launchArgs') == ['--motionbench-test', '--motionbench-data-dir=' + str(profile)] and item.get('profileCopy') == {'files': len(manifest['files']), 'bytes': manifest['bytes'], 'allFilesEqual': True}, 'Isolated native profile was not a complete original byte copy')
        require(item.get('hiddenWindow') is True, 'Isolated verification window was not protected from desktop interaction')
        require(item.get('closeEvidence') == {'method': 'BrowserWindow.close', 'exited': True}, 'Isolated native app did not close normally')
    require(item.get('guard', {}).get('blocked') == [] and item['guard'].get('writes', 0) > 0, 'Data preservation guard is incomplete')
    snapshots(item, directory)


def baseline_proof(manifest):
    directory = CHECKPOINT / 'verification/baseline'
    require(digest(ROOT / ENTRY) == BASELINE_ENTRY_SHA and digest(directory / 'receipt.json') == BASELINE_RECEIPT_SHA and digest(directory / 'snapshot.json') == BASELINE_SNAPSHOT_SHA, 'Frozen original-library evidence changed')
    item = read(directory / 'receipt.json')
    identity(item, 'baseline', manifest)
    require(item.get('selectionPreservedData') is True and item.get('artifacts') == [] and item.get('pdfRequested') is False, 'Baseline scope differs')
    value = prior.node_check("const fs=require('fs'),path=require('path'),e=require('./tests/desktop-system-v2244-current.cjs'),read=n=>JSON.parse(fs.readFileSync(path.join(process.argv[1],n),'utf8'));const a=read('startup-snapshot.json'),b=read('selected-snapshot.json'),c=read('snapshot.json'),r=read('receipt.json'),s=e.base.example(c.library);e.base.compareLibrary(a,b,s);e.base.compareSnapshots(b,c,s);e.checkMetadata(b,a,s,r.launchStartedAt,r.completedAt);e.checkMetadata(c,a,s,r.launchStartedAt,r.completedAt);process.stdout.write(JSON.stringify({example:s,counts:{athletes:c.library.athletes.length,records:c.reports.length}}));", directory)
    require(item.get('example') == value['example'] and item.get('counts') == value['counts'], 'Baseline identity/counts differ from snapshots')
    return receipt(directory / 'receipt.json', checks=len(item['checks']), **value)


DATA_PROOF = r"""
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),e=require('./tests/desktop-system-v2244-current.cjs'),s=require('./tests/helpers/desktop-system-v2244-stages.cjs'),p=require('./tests/helpers/v2244-display-preservation.cjs'),c=require('./tests/helpers/longitudinal-fixture.cjs').context();require('./src/ringside-longitudinal-views.js');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),dir=process.argv[1],r=read(path.join(dir,'receipt.json')),original=read(process.argv[2]),sample=e.base.example(original.library),start=read(path.join(dir,'startup-snapshot.json')),selected=read(path.join(dir,'selected-snapshot.json')),final=read(path.join(dir,'snapshot.json')),reference=r.mode==='reopened'?read(path.join(dir,'../display-resumption/snapshot.json')):original;
const plain=v=>JSON.parse(JSON.stringify(v,(_k,value)=>Object.prototype.toString.call(value)==='[object Set]'?{type:'Set',values:[...value]}:Object.prototype.toString.call(value)==='[object Map]'?{type:'Map',entries:[...value]}:value));
p.same(r.startupWindow.start,r.launchStartedAt);p.require(Date.parse(r.startupWindow.end)<=Date.parse(r.completedAt),'Startup capture after completion');const initial=s.startupProof(start,reference,sample,r.startupCapture,r.startupWindow);p.same(initial.transitions,r.startupTransitions);p.same(r.guard.windowStart,r.launchStartedAt);let previous=initial.document;
const replay=p.replay(r.guard,initial.document,p.document(original.library,sample),sample,{start:r.launchStartedAt,end:r.completedAt},RingsideLongitudinalViews.patch,r.mode==='reopened');p.require(replay.documents.some(doc=>p.equal(doc,selected.activeComparison.document))||p.equal(initial.document,selected.activeComparison.document),'Selected document is absent from transition history');s.completed(final,original,sample,r.guard);p.snapshot(selected,original,sample,selected.activeComparison.document);p.same(selected.activeComparison.model,original.activeComparison.model);if(r.mode!=='reopened'){p.same(final.activeComparison.document.views.charts,replay.charts);p.same([...replay.charts['fvp_sj:profile'].recordIds].sort(),[...sample.recordIds].sort());p.require(replay.charts['fvp_sj:profile'].options.fv===true&&replay.charts['sprint_fvp:profile'].metrics.F0===true,'Final original layers/metrics not restored');}else p.same(final.activeComparison.document.views.charts,reference.activeComparison.document.views.charts);
if(r.mode==='installed')p.same(final.activeComparison.document.views.charts,read(path.join(dir,'../candidate/snapshot.json')).activeComparison.document.views.charts);
const reports=[];for(const owner of final.library.athletes)for(const record of owner.records){const effective=c.RingsideEvaluation.resolve(record,final.library.evaluationProfiles.find(x=>x.id===record.evaluationProfileId)),stats=c.RingsideModel.stats(effective);reports.push({recordId:record.recordId,values:stats.values,axes:stats.axes,evaluationResults:stats.evaluationResults,basis:c.RingsideModel.fingerprint(effective),narrative:record.narrative});}p.same(plain(reports),final.reports,'Original calculations differ from raw records');const active=final.activeComparison,owner=final.library.athletes.find(x=>x.id===active.athleteId),records=active.recordIds.map(id=>owner.records.find(row=>row.recordId===id)),latest=[...records].sort((a,b)=>a.athlete.date.localeCompare(b.athlete.date)).at(-1),model=c.RingsideLongitudinal.build(records,{athleteId:owner.id,mode:active.document.mode,profile:final.library.evaluationProfiles.find(x=>x.id===latest.evaluationProfileId),catalog:final.library.catalog});p.same(plain(model),active.model,'Complete comparison differs from exact source recalculation');process.stdout.write(JSON.stringify({example:sample,counts:{athletes:final.library.athletes.length,records:final.reports.length},independentCalculationsVerified:true,displayActions:r.guard.actions.length,displayTransitions:r.guard.transitions.length}));
"""


EXPORT_PROOF = r"""
const fs=require('fs'),path=require('path'),e=require('./tests/desktop-system-v2244-current.cjs'),s=require('./tests/helpers/desktop-system-v2244-stages.cjs'),read=f=>JSON.parse(fs.readFileSync(f,'utf8')),directory=process.argv[1],out=process.argv[2],saved=read(path.join(directory,'selected-snapshot.json')),receipt=read(path.join(directory,'receipt.json')),sample=e.base.example(saved.library),window={start:receipt.launchStartedAt,end:receipt.completedAt};s.verifyExport(read(path.join(out,'existing-comparison.json')),saved,sample,window);const embedded=fs.readFileSync(path.join(out,'existing-comparison.html'),'utf8').match(/<script\b[^>]*\bid="embedded-data"[^>]*>([\s\S]*?)<\/script>/i);if(!embedded)throw Error('Missing saved HTML snapshot');s.verifyExport(JSON.parse(embedded[1]),saved,sample,window);process.stdout.write(JSON.stringify({pass:true}));
"""


def stage_proof(mode, source_hash, manifest, pdf_files):
    directory = CHECKPOINT / 'verification' / mode
    item = read(directory / 'receipt.json')
    identity(item, mode, manifest, source_hash)
    if mode in ('installed', 'reopened'):
        key, previous = ('candidateSnapshotSha256', 'candidate') if mode == 'installed' else ('installedSnapshotSha256', 'installed')
        require(item.get(key) == digest(CHECKPOINT / f'verification/{previous}/snapshot.json'), 'Saved display-state stage binding differs')
    if mode == 'reopened':
        require(item.get('displayResumptionSnapshotSha256') == digest(CHECKPOINT / 'verification/display-resumption/snapshot.json'), 'Resumed display reference differs')
    value = prior.calculation_check(DATA_PROOF, directory, CHECKPOINT / 'verification/baseline/snapshot.json')
    require(item.get('example') == value['example'] and item.get('counts') == value['counts'], 'Native original inventory changed')
    files = []
    for entry in item.get('artifacts', []):
        file = linked(entry)
        require(file.is_relative_to(ROOT / 'output/playwright/v2244/system-candidate'), 'Unexpected private artifact destination')
        relative = file.relative_to(ROOT).as_posix()
        shared.artifact({'file': relative, 'sha256': entry['sha256']}, str(directory / 'receipt.json'), pdf_files)
        files.append(relative)
    require(len(files) == len(set(files)) and item.get('pdfRequested') is (mode == 'candidate'), 'Native export scope differs')
    if mode == 'candidate':
        require({Path(file).name for file in files} == {'existing-comparison.' + ext for ext in ('json', 'html', 'pdf', 'png')}, 'Native exports incomplete')
        pdf = next(file for file in files if file.endswith('.pdf'))
        regression.verify_pdf({'file': pdf, 'sha256': digest(ROOT / pdf), 'diagnostics': item.get('pdfDiagnostics')}, pdf_files)
        prior.node_check(EXPORT_PROOF, directory, ROOT / 'output/playwright/v2244/system-candidate')
        require(digest(ROOT / 'output/playwright/v2244/system-candidate/results.json') == digest(directory / 'receipt.json'), 'Public/private candidate receipts differ')
    else:
        require(files == [], 'Actual-profile verification exported private artifacts')
    return receipt(directory / 'receipt.json', checks=len(item['checks']), artifacts=files, **value)


RESUMPTION_PROOF = r"""
const fs=require('fs'),path=require('path'),e=require('./tests/desktop-system-v2244-current.cjs'),s=require('./tests/helpers/desktop-system-v2244-stages.cjs'),p=require('./tests/helpers/v2244-display-preservation.cjs');require('./src/ringside-longitudinal-views.js');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),dir=process.argv[1],r=read(path.join(dir,'receipt.json')),before=read(path.join(dir,'observed-snapshot.json')),pre=read(path.join(dir,'pre-close-snapshot.json')),after=read(path.join(dir,'snapshot.json')),original=read(path.join(dir,'../baseline/snapshot.json')),installed=read(path.join(dir,'../installed/snapshot.json')),sample=e.base.example(original.library),old=p.document(original.library,sample);
p.library(before.library,original.library,sample,p.document(before.library,sample));p.same(before.reports,original.reports);p.same(before.activeComparison.model,original.activeComparison.model);p.same(r.initialDocument,before.activeComparison.document);
for(const doc of[p.document(before.library,sample),before.activeComparison.document]){const protectedCopy=p.clone(doc);for(const k of['views','revision','updated'])protectedCopy[k]=p.clone(old[k]);p.same(protectedCopy,old,'Protected comparison content changed during user display use');p.same(doc.views.charts,installed.activeComparison.document.views.charts);p.require(Number.isSafeInteger(doc.revision)&&doc.revision>=old.revision&&Number.isFinite(Date.parse(doc.updated))&&Date.parse(doc.updated)<=Date.parse(r.startedAt),'Invalid observed display metadata');}
const preReplay=p.replay(r.preCloseGuard,r.initialDocument,old,sample,{start:r.startedAt,end:r.completedAt},RingsideLongitudinalViews.patch,true);s.completed(pre,original,sample,r.preCloseGuard);p.same(pre.activeComparison.document,preReplay.document);p.same(r.guard.transitions.slice(0,r.preCloseGuard.transitions.length),r.preCloseGuard.transitions,'Close history lost an earlier guarded transition');const replay=p.replay(r.guard,r.initialDocument,old,sample,{start:r.startedAt,end:r.completedAt},RingsideLongitudinalViews.patch,true);s.completed(after,original,sample,r.guard);p.same(after.activeComparison.document,replay.document);pre.library.longitudinalReports[pre.library.longitudinalReports.findIndex(d=>d.key===sample.documentKey)]=p.clone(replay.document);pre.activeComparison.document=p.clone(replay.document);p.same(pre,after,'Expected saved state contains an unobserved change');p.same(after.activeComparison.document.views.charts,installed.activeComparison.document.views.charts);p.same(after.activeComparison.document.views.reportScroll,0);process.stdout.write(JSON.stringify({counts:{athletes:after.library.athletes.length,records:after.reports.length},protectedOriginalsVerified:true,displayActions:r.guard.actions.length,displayTransitions:r.guard.transitions.length}));
"""


def resumption_proof(source_hash, manifest):
    directory = CHECKPOINT / 'verification/display-resumption'
    item = read(directory / 'receipt.json')
    require(item.get('pass') is True and item.get('normalClose') is True and item.get('userConfirmedInterveningDisplayUse') is True, 'Display resumption incomplete')
    require(item.get('sourceHash') == source_hash and item.get('runnerSha256') == digest(ROOT / 'tests/desktop-system-v2244-display-resumption.cjs'), 'Display resumption producer differs')
    require(item.get('implementationSha256') == digest(ROOT / REOPEN_STAGES) and item.get('snapshotKind') == 'observed-data-with-guarded-close-document', 'Display close producer or reference semantics differ')
    prior.actual_context_proof(item, directory, manifest)
    require(digest(ROOT / PROTECTION) == 'cf0f3ca402aebbaf9fdefa7eb2e48eab489eea139d6387e2ccd3ed3013681f02', 'Frozen original-data protection changed')
    for key, file in [('observedSnapshotSha256', directory / 'observed-snapshot.json'), ('preCloseSnapshotSha256', directory / 'pre-close-snapshot.json'), ('snapshotSha256', directory / 'snapshot.json'), ('baselineSnapshotSha256', directory.parent / 'baseline/snapshot.json'), ('installedSnapshotSha256', directory.parent / 'installed/snapshot.json')]:
        require(item.get(key) == digest(file), 'Display resumption snapshot binding differs')
    value = prior.node_check(RESUMPTION_PROOF, directory)
    require(item.get('counts') == value['counts'] and value['displayActions'] == 0, 'Resumption inventory differs')
    return receipt(directory / 'receipt.json', **value)


def visual_proof(source_hash, producers, pdf_files, layout=False):
    relative = OUT + ('layout-visual-review.json' if layout else 'visual-review.json')
    item = read(relative)
    require(item.get('pass') is True and item.get('sourceHash') == source_hash and item.get('errors') == item.get('issues') == [], 'Visual review incomplete or stale')
    require(not layout or item.get('synthetic') is True, 'Synthetic review scope not identified')
    expected = {file: producer for producer in producers for file in producer.get('artifacts', []) if file.endswith('.pdf')}
    require(len(item.get('pdfs', [])) == len(expected) and {row.get('file') for row in item['pdfs']} == set(expected), 'Visual PDF inventory differs')
    for row in item['pdfs']:
        producer = expected[row['file']]
        runner = producer.get('runner', ENTRY)
        require(physical.same_path(row.get('producerReceipt', ''), ROOT / producer['file']) and row.get('producerReceiptSha256') == producer['sha256'] and row.get('runnerSha256') == digest(ROOT / runner), 'Visual producer differs')
        if not layout:
            require(row.get('implementationSha256') == digest(ROOT / STAGES), 'Native visual stage producer differs')
        shared.artifact(row, relative, pdf_files)
        count, pages = pdf_files[row['file']], row.get('pages', [])
        require(row.get('pageCount') == count and row.get('reviewedPages') == list(range(1, count + 1)) and len(pages) == count and sorted(page.get('page') for page in pages) == list(range(1, count + 1)) and len({page.get('file') for page in pages}) == count, 'Visual review omitted or duplicated a page')
        for page in pages:
            require(Path(page.get('file', '')).suffix.lower() == '.png', 'Visual page must be a rendered PNG')
            shared.artifact(page, relative, pdf_files)
    for key in ('screenshots', 'responsiveScreenshots', 'browserScreenshots'):
        if key in item:
            regression.verify_artifacts(item[key], relative, pdf_files)
    return receipt(relative, pages=sum(row['pageCount'] for row in item['pdfs']), **{'pass': True})


def installation_proof(manifest):
    relative = OUT + 'system-installation.json'
    item = read(relative)
    require(item.get('pass') is True and item.get('version') == DESKTOP_VERSION and item.get('installerExitCode') == 0, 'System installation failed')
    require(digest(ROOT / PREINSTALL_VERIFIER) == PREINSTALL_VERIFIER_SHA, 'Frozen preinstallation verifier changed')
    require(item.get('runnerSha256') == digest(ROOT / 'scripts/install_v2244_system.ps1') and item.get('verifierSha256') == PREINSTALL_VERIFIER_SHA, 'Installation/preflight producer changed')
    require(physical.same_path(item.get('installationDirectory', ''), shared.INSTALLED) and physical.same_path(item.get('profilePath', ''), physical.profile_path()) and item.get('systemManifestSha256') == MANIFEST_SHA, 'Installed destination/checkpoint differs')
    require(item.get('parentName', '').lower() == 'explorer.exe' and physical.same_path(item.get('parentExecutable', ''), Path(os.environ['WINDIR']) / 'explorer.exe'), 'Installer did not run through real Desktop Explorer')
    launch = physical.broker_proof(ROOT / (OUT + 'system-installation-launch.json'), parent=item.get('parentProcessId'), style='Hidden')
    require(str(ROOT / 'scripts/install_v2244_system.ps1') in launch.get('arguments', ''), 'Installer launch target differs')
    physical.physical_files(item.get('physicalFiles'), complete=True)
    keys = lambda rows: {(physical.logical_path(row['logical']), physical.logical_path(row['physical']), row['bytes'], row['sha256']) for row in rows}
    require(len(item['physicalFiles']) == len(manifest['files']) and keys(item['physicalFiles']) == keys(manifest['files']), 'Installation original data differs from the full backup')
    require(item.get('installerSha256') == digest(ROOT / f'dist-desktop/MotionBench-{DESKTOP_VERSION}-Setup-x64.exe'), 'Installer artifact changed')
    require(len(item.get('checks', [])) == 2 and {row.get('file') for row in item['checks']} == {'MotionBench.exe', 'resources/app.asar'}, 'Installed package inventory incomplete')
    for row in item['checks']:
        require(row.get('matchesTestedPackage') is True and row.get('sha256') == digest(shared.INSTALLED / row['file']) == digest(shared.DIST / row['file']), 'Installed program differs from candidate')
    return receipt(relative, **{'pass': True})


def shortcut_proof(source_hash, sample, pdf_files):
    relative = OUT + 'shortcut-launch.json'
    item, executable = read(relative), shared.INSTALLED / 'MotionBench.exe'
    require(item.get('pass') is True and item.get('errors') == [] and item.get('sourceHash') == source_hash and item.get('runnerSha256') == digest(ROOT / 'scripts/check_v2244_shortcut.ps1'), 'Visible shortcut verification incomplete')
    shortcut = Path(item.get('shortcutPath', ''))
    require(shortcut.suffix.lower() == '.lnk' and item.get('shortcutSha256') == digest(shortcut), 'User shortcut changed')
    command = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + str(shortcut).replace("'", "''") + "'); @{target=$s.TargetPath;arguments=$s.Arguments} | ConvertTo-Json -Compress"
    actual = json.loads(subprocess.check_output(['powershell', '-NoProfile', '-Command', command], text=True, encoding='utf-8-sig'))
    require(physical.same_path(actual['target'], executable) and physical.same_path(item.get('targetPath', ''), executable) and actual['arguments'] == '', 'Shortcut target/arguments differ')
    require(item.get('executableSha256') == digest(executable) and item.get('archiveSha256') == digest(shared.INSTALLED / 'resources/app.asar') and item.get('normalStartup') is True and item.get('launchArgs') == [] and physical.same_path(item.get('profilePath', ''), physical.profile_path()), 'Visible app identity differs')
    launch = item.get('desktopLaunch', {})
    broker = physical.broker_proof(linked(launch, ROOT / (OUT + 'shortcut-desktop-launch.json')), target=shortcut, parent=launch.get('parentProcessId'), style='Normal')
    require(broker.get('arguments') == '', 'Desktop shortcut launch contains additional flags')
    window, uia = item.get('window', {}), item.get('uia', {})
    require(window.get('visible') is True and isinstance(window.get('processId'), int) and window['processId'] > 0 and window.get('title'), 'Actual window was not visibly open')
    require(uia.get('found') is True and uia.get('athleteName') == '示例运动员｜纵向比较（合成）' and uia.get('selectedDates') == sample['dates'] and uia.get('controlCount', 0) > 0, 'Visible saved example or dates differ')
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
    unit = shared.suite_proof('output/tests/v2.24.4/unit-results.json', 'tests/run-unit-tests.cjs', source_hash)
    preservation = next((item for item in unit['suites'] if item['name'] == 'v2244-display-preservation-tests.cjs'), None)
    require(preservation is not None, 'Missing display-preservation negative tests')
    dependency_line = re.search(r'^V2244_PRESERVATION_DEPENDENCIES (\{.*\})$', preservation.get('stdout', ''), re.M)
    require(dependency_line is not None, 'Missing preservation test dependency binding')
    dependencies = json.loads(dependency_line.group(1))
    require(set(dependencies) == DEPS | {ENTRY, STAGES, PROTECTION, 'src/ringside-longitudinal-views.js'} and all(dependencies[file] == digest(ROOT / file) for file in dependencies), 'Preservation tests ran against different helpers')
    desktop = shared.suite_proof('output/tests/v2.24.4/desktop-unit/results.json', 'tests/run-desktop-unit-tests.cjs', source_hash, desktop=True)
    runtime, package = prior.package_proof(source_hash)
    browsers = [browser_proof(kind, channel, source_hash, runtime, pdf_files) for kind in ('layout', 'layout-regression', 'longitudinal-controls', 'app', 'personal', 'ai', 'interaction') for channel in ('chrome', 'msedge')]
    private, native, visuals, installation, shortcut, resumption = None, None, [], None, None, None
    if not args.ci:
        manifest = checkpoint_proof()
        baseline = baseline_proof(manifest)
        candidate = stage_proof('candidate', source_hash, manifest, pdf_files)
        private = {'baseline': baseline, 'candidate': candidate}
        native = prior.native_proof(source_hash, runtime, pdf_files)
        visuals = [visual_proof(source_hash, [item for item in browsers if item['runner'] in ('tests/longitudinal-layout-v2244-tests.cjs', 'tests/longitudinal-layout-browser-tests.cjs')], pdf_files, layout=True), visual_proof(source_hash, [candidate], pdf_files)]
        if args.require_private:
            installation = installation_proof(manifest)
            resumption = resumption_proof(source_hash, manifest)
            for mode in ('installed', 'reopened'):
                private[mode] = stage_proof(mode, source_hash, manifest, pdf_files)
            shortcut = shortcut_proof(source_hash, baseline['example'], pdf_files)
    summary = {'version': VERSION, 'desktopVersion': DESKTOP_VERSION, 'pass': True, 'sourceHash': source_hash, 'verifierSha256': digest(Path(__file__)), 'modelSuites': len(unit['suites']), 'modelChecks': sum(item.get('checksPassed', 0) for item in unit['suites']), 'desktopUnitSuites': len(desktop['suites']), 'unitProof': receipt('output/tests/v2.24.4/unit-results.json'), 'desktopUnitProof': receipt('output/tests/v2.24.4/desktop-unit/results.json'), 'package': package, 'browsers': browsers, 'pdfFiles': pdf_files, 'ci': args.ci, 'candidateVerified': not args.ci, 'privateVerified': args.require_private, 'private': private, 'native': native, 'visuals': visuals, 'installation': installation, 'shortcut': shortcut}
    summary['displayResumption'] = resumption
    require(digest(ROOT / 'MotionBench.html') == source_hash, 'Source changed during verification')
    if args.record:
        (ROOT / ('docs/acceptance-2.24.4-ci.json' if args.ci else 'docs/acceptance-2.24.4.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: summary[key] for key in ('version', 'pass', 'modelSuites', 'modelChecks', 'ci', 'candidateVerified', 'privateVerified', 'sourceHash')}))


if __name__ == '__main__':
    main()
