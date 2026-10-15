"""Verify the exact 2.24.2 summary-only candidate, saved library and local launch."""
from pathlib import Path
import argparse
import copy
import json
import os
import re
import subprocess

import verify_v224 as shared
import verify_v2241 as prior
import verify_v224_supplement as regression
import verify_v2242_system as system

ROOT = shared.ROOT
VERSION, DESKTOP_VERSION = '2.24.2', '2.24.2-desktop.1'
CHECKPOINT = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.2')
RUNNER = 'tests/desktop-summary-v2242.cjs'
EXAMPLE_NAME = '示例运动员｜纵向比较（合成）'
DATES = ['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13']
shared.VERSION, shared.DESKTOP_VERSION = VERSION, DESKTOP_VERSION
prior.VERSION = VERSION
regression.VERSION, regression.NATIVE = VERSION, 'output/desktop-smoke-v2242/results.json'
require, digest, read = shared.require, shared.digest, shared.read


def document_snapshot(document, identity):
    value = copy.deepcopy(document)
    if value and value.get('athleteId') == identity['athleteId'] and value.get('key') == identity['documentKey']:
        value.pop('updated', None)
    return value


def canonical_snapshot(snapshot, identity):
    value = copy.deepcopy(snapshot)
    for key in ('version', 'updated', 'activeAthleteId', 'activeRecordId'):
        value['library'].pop(key, None)
    value['library']['longitudinalReports'] = [document_snapshot(document, identity) for document in value['library'].get('longitudinalReports', [])]
    if value.get('activeComparison'):
        value['activeComparison']['document'] = document_snapshot(value['activeComparison'].get('document'), identity)
    return value


def canonical_data_snapshot(snapshot, identity):
    return canonical_snapshot({'library': snapshot['library'], 'reports': snapshot['reports']}, identity)


def snapshot_identity(snapshot):
    owners = snapshot['library']['athletes']
    records = [record for owner in owners for record in owner['records']]
    require(len({owner['id'] for owner in owners}) == len(owners), 'Duplicate saved athlete identity')
    require(len({record['recordId'] for record in records}) == len(records), 'Duplicate saved record identity')
    require(all(record['athleteId'] == owner['id'] for owner in owners for record in owner['records']), 'Saved record owner differs')
    require([row['recordId'] for row in snapshot['reports']] == [record['recordId'] for record in records], 'Saved calculation inventory differs')
    samples = [owner for owner in owners if owner['profile'].get('name') == EXAMPLE_NAME]
    require(len(samples) == 1 and len(samples[0]['records']) == 4, 'Existing example is missing or duplicated')
    owner = samples[0]
    ids = [record['recordId'] for record in owner['records']]
    require(sorted(record['athlete']['date'] for record in owner['records']) == DATES, 'Existing example dates changed')
    active = snapshot.get('activeComparison') or {}
    document = active.get('document') or {}
    key = json.dumps([owner['id'], sorted(ids)], separators=(',', ':'), ensure_ascii=False)
    ordered_ids = [record['recordId'] for record in sorted(owner['records'], key=lambda record: record['athlete']['date'])]
    identity = {'athleteId': owner['id'], 'recordIds': ordered_ids, 'dates': DATES, 'documentKey': key}
    require(active.get('athleteId') == owner['id'] and active.get('recordIds') == ordered_ids and active.get('dates') == DATES, 'Active example four-record selection differs')
    require(document.get('athleteId') == owner['id'] and document.get('key') == key and sorted(document.get('recordIds', [])) == sorted(ids), 'Active comparison document identity differs')
    require(document_snapshot(document, identity) in [document_snapshot(stored, identity) for stored in snapshot['library'].get('longitudinalReports', [])], 'Active document differs from its saved content')
    require(active.get('model') is not None, 'Missing complete current comparison model')
    return identity, (len(owners), len(records))


def checkpoint_proof():
    manifest = read(CHECKPOINT / 'manifest.json')
    entries = manifest.get('files')
    require(manifest.get('complete') is True and isinstance(entries, list) and entries, 'Original checkpoint incomplete')
    require({entry.get('kind') for entry in entries} == {'program', 'userdata'}, 'Checkpoint program/userdata inventory incomplete')
    require(len({(entry.get('kind'), entry.get('path')) for entry in entries}) == len(entries), 'Duplicate checkpoint entry')
    for entry in entries:
        target = (CHECKPOINT / entry['kind'] / entry['path']).resolve()
        require(target.is_relative_to((CHECKPOINT / entry['kind']).resolve()) and digest(target) == entry.get('sha256') and target.stat().st_size == entry.get('bytes'), 'Checkpoint file changed')
    return manifest


def polish_proof(channel, source_hash, pdf_files):
    relative = f'output/playwright/v2242/polish/{channel}/results.json'
    runner = 'tests/longitudinal-polish-browser-tests.cjs'
    data = read(relative)
    require(data.get('pass') is True and data.get('errors') == [] and not data.get('failure'), 'Polish checks failed')
    require(data.get('channel') == channel and data.get('synthetic') is True and data.get('sourceHash') == source_hash and data.get('sourceUnchanged') is True, 'Polish browser/source attribution differs')
    require(data.get('runnerSha256') == digest(ROOT / runner) and data.get('fixtureSha256') == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs'), 'Polish producer changed')
    modules = {'src/ringside-' + name for name in ('longitudinal.js', 'longitudinal-view.js', 'longitudinal.css', 'viz.js', 'pdf.js')}
    require(set(data.get('moduleHashes', {})) == modules and all(data['moduleHashes'][name] == digest(ROOT / name) for name in modules), 'Polish source module changed')
    labels = [match[1] for match in re.findall(r"await check\(\s*(['\"])(.*?)\1", (ROOT / runner).read_text(encoding='utf-8'))]
    require(labels and len(labels) == len(set(labels)) and len(data.get('checks', [])) == len(labels) and set(data['checks']) == set(labels), 'Polish executed inventory incomplete')
    files = regression.verify_artifacts(data.get('artifacts', []), relative, pdf_files)
    require(files, 'Missing real polish screenshots')
    return {'file': relative, 'sha256': digest(ROOT / relative), 'checks': len(labels), 'pass': True}


def stage_artifacts(mode, receipt, snapshot, identity, pdf_files):
    entries = receipt.get('artifacts')
    require(isinstance(entries, list) and entries, 'Missing native example exports: ' + mode)
    seen, files = set(), []
    directory = (ROOT / f'output/playwright/v2242/summary/{mode}').resolve()
    for entry in entries:
        value = Path(entry.get('file', ''))
        target = (value if value.is_absolute() else ROOT / value).resolve()
        require(target.is_relative_to(directory) and target not in seen, 'Native export path is outside its assigned output or duplicated')
        seen.add(target)
        require(digest(target) == entry.get('sha256') and target.stat().st_size == entry.get('bytes'), 'Native export changed')
        normalized = {'file': target.relative_to(ROOT).as_posix(), 'sha256': entry['sha256']}
        shared.artifact(normalized, '', pdf_files)
        files.append(target)
    suffixes = ('.json', '.html', '.pdf') if mode == 'copied' else ('.json', '.html')
    require(all(sum(file.suffix.lower() == suffix for file in files) == 1 for suffix in suffixes) and any(file.suffix.lower() == '.png' for file in files), 'Native export/screenshot inventory incomplete')
    require(sum(file.suffix.lower() == '.pdf' for file in files) == int(mode == 'copied'), 'Unexpected native PDF inventory')
    exported = read(next(file for file in files if file.suffix.lower() == '.json'))
    require(exported.get('kind') == 'longitudinal-report' and len(exported['library']['athletes']) == 1, 'Export is not the isolated existing example report')
    owner = exported['library']['athletes'][0]
    stored_owner = next(owner for owner in snapshot['library']['athletes'] if owner['id'] == identity['athleteId'])
    require(owner['id'] == exported['selection'].get('athleteId') == identity['athleteId'] and sorted(exported['selection']['recordIds']) == sorted(identity['recordIds']) and len(owner['records']) == 4, 'Export owner/selection differs')
    require(sorted(owner['records'], key=lambda record: record['recordId']) == sorted(stored_owner['records'], key=lambda record: record['recordId']), 'Exported measurements or single-record narratives changed')
    require(len(exported['library'].get('longitudinalReports', [])) == 1 and document_snapshot(exported['library']['longitudinalReports'][0], identity) == document_snapshot(snapshot['activeComparison']['document'], identity), 'Exported comparison document differs')
    profile_ids = {record['evaluationProfileId'] for record in stored_owner['records']}
    require(exported['library'].get('evaluationProfiles') == [profile for profile in snapshot['library']['evaluationProfiles'] if profile['id'] in profile_ids], 'Exported evaluation profiles changed')
    html = next(file for file in files if file.suffix.lower() == '.html').read_text(encoding='utf-8')
    embedded = re.search(r'<script\b[^>]*\bid="embedded-data"[^>]*>([\s\S]*?)</script>', html, re.IGNORECASE)
    require(embedded is not None and json.loads(embedded.group(1)) == exported, 'Editable HTML differs from its complete JSON report export')
    if mode != 'copied':
        require(receipt.get('pdfRequested') is False and not receipt.get('pdfDiagnostics'), 'Installed normal-startup stage unexpectedly requested a PDF')
        return [file.relative_to(ROOT).as_posix() for file in files]
    pdf = next(file for file in files if file.suffix.lower() == '.pdf')
    name = pdf.relative_to(ROOT).as_posix()
    require(receipt.get('pdfRequested') is True, 'Native PDF export was not requested')
    regression.verify_pdf({'file': name, 'sha256': digest(pdf), 'diagnostics': receipt.get('pdfDiagnostics', {})}, pdf_files)
    return [file.relative_to(ROOT).as_posix() for file in files]


def private_proof(source_hash, pdf_files, *, candidate_only):
    require(candidate_only is True, 'The old checkpoint is a shadow-profile regression; actual installation requires independent system proof')
    manifest = checkpoint_proof()
    old_archive = CHECKPOINT / 'program/resources/app.asar'
    old_runtime = shared.archive_identity(old_archive)
    require(old_runtime['package'].get('version') == '2.24.1-desktop.1', 'Wrong installed baseline version')
    baseline_file = CHECKPOINT / 'verification/baseline/snapshot.json'
    baseline = read(baseline_file)
    identity, counts = snapshot_identity(baseline)
    require(counts == (27, 150), 'This release baseline inventory differs from the 27-athlete/150-record checkpoint')
    receipts = {}
    for mode in (('baseline', 'copied') if candidate_only else ('baseline', 'copied', 'installed')):
        file = CHECKPOINT / 'verification' / mode / 'receipt.json'
        item = read(file)
        require(item.get('pass') is True and item.get('errors') == [] and item.get('network') == [] and not item.get('failure'), 'Saved library stage failed: ' + mode)
        require(item.get('mode') == mode and item.get('runnerSha256') == digest(ROOT / RUNNER) and item.get('runnerUnchanged') is True and item.get('artifactUnchanged') is True and item.get('normalClose') is True, 'Saved library producer or close identity differs: ' + mode)
        expected_checks = stage_checks(mode)
        require(item.get('checks') == expected_checks, 'Saved library executed check inventory differs: ' + mode)
        require(item.get('backup', {}).get('sha256') == digest(CHECKPOINT / 'manifest.json') and item.get('backup', {}).get('files') == len(manifest['files']), 'Saved library checkpoint identity differs')
        snapshot_file, startup_file, selected_file = file.parent / 'snapshot.json', file.parent / 'startup-snapshot.json', file.parent / 'selected-snapshot.json'
        require(item.get('snapshotSha256') == digest(snapshot_file) and item.get('startupSnapshotSha256') == digest(startup_file) and item.get('selectedSnapshotSha256') == digest(selected_file), 'Saved library snapshot changed')
        snapshot, startup, selected = read(snapshot_file), read(startup_file), read(selected_file)
        actual_identity, actual_counts = snapshot_identity(snapshot)
        require(actual_identity == identity and actual_counts == counts == (item.get('athletes'), item.get('records')) and item.get('example') == identity, 'Saved library count/example identity differs')
        require(canonical_snapshot(snapshot, identity) == canonical_snapshot(baseline, identity), 'Original library, results or current example changed: ' + mode)
        require(canonical_data_snapshot(startup, identity) == canonical_data_snapshot(selected, identity) and item.get('selectionPreservedData') is True, 'Selecting the existing example changed saved data: ' + mode)
        require(canonical_snapshot(selected, identity) == canonical_snapshot(snapshot, identity) and item.get('afterSaveUnchanged') is True, 'Normal selection/export/close changed data: ' + mode)
        require(item.get('guard', {}).get('blocked') == [] and item.get('guard', {}).get('writes', 0) > 0, 'Existing-data preservation guard did not complete')
        actual = mode == 'installed'
        executable = (shared.DIST if mode == 'copied' else shared.INSTALLED) / 'MotionBench.exe'
        profile = Path(os.environ['APPDATA']) / 'MotionBench Desktop' if actual else CHECKPOINT / (mode + '-profile')
        require(Path(item.get('executablePath', '')).resolve() == executable.resolve() and Path(item.get('archivePath', '')).resolve() == (executable.parent / 'resources/app.asar').resolve(), 'Native executable/archive path differs')
        require(Path(item.get('profilePath', '')).resolve() == Path(item.get('userDataPath', '')).resolve() == profile.resolve(), 'Native user profile differs')
        require(Path(item.get('sessionDataPath', '')).resolve() == profile.resolve() and item.get('defaultSession') is True and item.get('originURL') == 'motionbench://app/MotionBench.html' and item.get('databaseName') == 'motionbench-v3:/MotionBench.html', 'Native session origin or database differs')
        require(item.get('actualProfile') is actual and item.get('normalStartup') is actual, 'Native profile/startup attribution differs')
        require(item.get('launchArgs') == ([] if actual else ['--motionbench-test', '--motionbench-data-dir=' + str(profile)]), 'Native launch arguments differ')
        require(item.get('version') == ('2.24.1-desktop.1' if mode == 'baseline' else DESKTOP_VERSION), 'Native stage version differs')
        require(item.get('executableSha256') == digest(CHECKPOINT / 'program/MotionBench.exe' if mode == 'baseline' else executable), 'Native executable changed')
        require(item.get('archiveSha256') == digest(old_archive if mode == 'baseline' else shared.DIST / 'resources/app.asar') and item.get('runtimeHtmlSha256') == (old_runtime['runtimeHtmlSha256'] if mode == 'baseline' else source_hash), 'Native runtime differs from the verified package')
        outputs = []
        if mode != 'baseline':
            require(item.get('sourceHash') == item.get('workspaceSourceHash') == source_hash and item.get('sourceUnchanged') is True and item.get('baselineSha256') == digest(baseline_file), 'Native source/baseline identity differs')
            outputs = stage_artifacts(mode, item, snapshot, identity, pdf_files)
        else:
            require(item.get('sourceHash') == old_runtime['runtimeHtmlSha256'] and item.get('workspaceSourceHash') == source_hash and item.get('sourceUnchanged') is True and item.get('artifacts') == [], 'Baseline source attribution or private artwork inventory differs')
        receipts[mode] = {'file': str(file), 'sha256': digest(file), 'checks': len(expected_checks), 'artifacts': outputs}
    installation = None
    if not candidate_only:
        installation = installation_proof()
        for name in ('ai-settings.dat', 'desktop-preferences.json'):
            before, after = CHECKPOINT / 'userdata' / name, Path(os.environ['APPDATA']) / 'MotionBench Desktop' / name
            require(before.exists() == after.exists() and (not before.exists() or digest(before) == digest(after)), 'Connection or desktop preferences changed')
    return {'pass': True, 'candidateOnly': candidate_only, 'checkpointManifestSha256': digest(CHECKPOINT / 'manifest.json'), 'checkpointFiles': len(manifest['files']), 'baselineSnapshotSha256': digest(baseline_file), 'athletes': counts[0], 'records': counts[1], 'example': identity, 'receipts': receipts, 'installation': installation}


def stage_checks(mode):
    # Closed stage inventories are supplied by the dedicated native producer.
    code = (ROOT / RUNNER).read_text(encoding='utf-8')
    match = re.search(r'/\* VERIFY_CHECKS (\{[\s\S]*?\}) VERIFY_CHECKS \*/', code)
    require(match is not None, 'Missing dedicated native check inventory')
    checks = json.loads(match.group(1)).get(mode)
    require(isinstance(checks, list) and checks and len(checks) == len(set(checks)), 'Invalid dedicated native check inventory')
    return checks


def installation_proof():
    relative = 'output/implementation-2.24.2/local-installation.json'
    item = read(relative)
    require(item.get('pass') is True and item.get('installerExitCode') == 0 and item.get('version') == DESKTOP_VERSION, 'Local installation failed')
    require(Path(item.get('installationDirectory', '')).resolve() == shared.INSTALLED.resolve(), 'Installation directory differs')
    require(item.get('installerSha256') == digest(ROOT / f'dist-desktop/MotionBench-{DESKTOP_VERSION}-Setup-x64.exe'), 'Installed setup changed')
    checks = item.get('checks', [])
    require(len(checks) == 2 and {check.get('file') for check in checks} == {'MotionBench.exe', 'resources/app.asar'}, 'Installation identity inventory incomplete')
    for check in checks:
        require(check.get('matchesTestedPackage') is True and check.get('sha256') == digest(shared.INSTALLED / check['file']) == digest(shared.DIST / check['file']), 'Installed files differ from tested package')
    return {'file': relative, 'sha256': digest(ROOT / relative), 'pass': True}


def visual_proof(source_hash, system_proof, pdf_files, *, shadow=False):
    relative = 'output/implementation-2.24.2/' + ('shadow-visual-review.json' if shadow else 'visual-review.json')
    data = read(relative)
    require(data.get('pass') is True and data.get('sourceHash') == source_hash and data.get('errors') == [] and data.get('issues') == [], 'Final visual review incomplete')
    entries = data.get('pdfs', [])
    producer = system_proof['receipts']['copied' if shadow else 'candidate']
    copied_pdfs = {file for file in producer['artifacts'] if file.endswith('.pdf')}
    require(len(entries) == len(copied_pdfs) and {entry.get('file') for entry in entries} == copied_pdfs, 'Real-catalog example PDF review inventory differs')
    for entry in entries:
        require(Path(entry.get('producerReceipt', '')).resolve() == Path(producer['file']).resolve() and entry.get('producerReceiptSha256') == producer['sha256'] and entry.get('runnerSha256') == digest(ROOT / (RUNNER if shadow else system.RUNNER)), 'Visual PDF producer differs')
        if not shadow:
            require(entry.get('implementationSha256') == digest(ROOT / system.IMPLEMENTATION), 'Visual PDF implementation differs')
        shared.artifact(entry, relative, pdf_files)
        count, pages = pdf_files[entry['file']], entry.get('pages', [])
        require(entry.get('pageCount') == count and entry.get('reviewedPages') == list(range(1, count + 1)) and len(pages) == count and sorted(page.get('page') for page in pages) == entry['reviewedPages'], 'Visual PDF page review incomplete')
        require(len({page.get('file') for page in pages}) == count, 'Duplicate visual page artwork')
        for page in pages:
            require(Path(page.get('file', '')).suffix.lower() == '.png', 'Visual page is not a PNG')
            shared.artifact(page, relative, pdf_files)
    for key in ('screenshots', 'responsiveScreenshots', 'browserScreenshots'):
        if key in data:
            regression.verify_artifacts(data[key], relative, pdf_files)
    return {'file': relative, 'sha256': digest(ROOT / relative), 'pages': sum(entry['pageCount'] for entry in entries), 'scope': 'isolated shadow-profile regression' if shadow else 'real-catalog example candidate', 'pass': True}


def shortcut_proof(source_hash, identity, pdf_files):
    relative = 'output/implementation-2.24.2/shortcut-launch.json'
    data = read(relative)
    executable = shared.INSTALLED / 'MotionBench.exe'
    shortcut = Path(data.get('shortcutPath', ''))
    require(data.get('pass') is True and data.get('errors') == [] and data.get('sourceHash') == source_hash, 'Shortcut visible-launch evidence failed')
    require(data.get('runnerSha256') == digest(ROOT / 'scripts/check_v2242_shortcut.ps1') and system.same_path(data.get('profilePath', ''), system.profile_path()), 'Shortcut producer/profile identity differs')
    require(shortcut.is_file() and shortcut.suffix.lower() == '.lnk' and data.get('shortcutSha256') == digest(shortcut), 'Shortcut changed')
    command = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + str(shortcut).replace("'", "''") + "'); @{target=$s.TargetPath;arguments=$s.Arguments} | ConvertTo-Json -Compress"
    actual = json.loads(subprocess.check_output(['powershell', '-NoProfile', '-Command', command], text=True, encoding='utf-8-sig'))
    require(Path(actual['target']).resolve() == Path(data.get('targetPath', '')).resolve() == executable.resolve() and actual['arguments'] == '', 'Shortcut does not launch the installed app normally')
    require(data.get('executableSha256') == digest(executable) and data.get('archiveSha256') == digest(shared.INSTALLED / 'resources/app.asar') and data.get('normalStartup') is True and data.get('launchArgs') == [], 'Shortcut process identity differs')
    launched = data.get('desktopLaunch', {})
    broker = system.broker_proof(system.linked_file(launched, ROOT / 'output/implementation-2.24.2/shortcut-desktop-launch.json'), target=shortcut, parent=launched.get('parentProcessId'), style='Normal')
    require(broker.get('arguments') == '', 'Visible shortcut launch has extra arguments')
    window, uia = data.get('window', {}), data.get('uia', {})
    require(window.get('visible') is True and isinstance(window.get('processId'), int) and window['processId'] > 0 and window.get('title'), 'No visible installed window evidence')
    require(uia.get('found') is True and uia.get('athleteName') == EXAMPLE_NAME and uia.get('selectedDates') == identity['dates'], 'Visible example selection differs')
    regression.verify_artifacts(data.get('artifacts', []), relative, pdf_files)
    return {'file': relative, 'sha256': digest(ROOT / relative), 'pass': True}


def native_proof(source_hash, runtime, pdf_files):
    final_file = 'output/desktop-smoke-v2242/results.json'
    if read(final_file).get('pass') is True:
        return regression.native_proof(source_hash, runtime, pdf_files)
    issue_file = 'output/implementation-2.24.2/known-clipboard-issue.json'
    issue = read(issue_file)
    require(issue.get('status') == 'recorded' and issue.get('sourceHash') == source_hash and issue.get('runnerSha256') == digest(ROOT / regression.NATIVE_RUNNER), 'Clipboard exception source/runner attribution differs')
    require(issue.get('decision') == '先完成纵向比较，记录剪贴板问题' and issue.get('runtimeModified') is False and issue.get('assertionUnchanged') is True, 'Clipboard exception exceeds the existing user decision')
    code = (ROOT / regression.NATIVE_RUNNER).read_text(encoding='utf-8').splitlines()
    require('JSON.parse(copiedFacts)' in code[625], 'Known clipboard failure location changed')
    expected = ['output/desktop-smoke-v2242-codex-clipboard-failure/results.json', final_file]
    require([entry.get('file') for entry in issue.get('receipts', [])] == expected, 'Clipboard exception context inventory differs')
    for entry in issue['receipts']:
        item = read(system.linked_file(entry, ROOT / entry['file']))
        failure = item.get('failure', '')
        require(item.get('pass') is False and failure.startswith('SyntaxError: Unexpected end of JSON input\n    at JSON.parse (<anonymous>)\n') and 'desktop-smoke.cjs:626:29' in failure and 'desktop-smoke.cjs:620:5' in failure, 'Failure is not the recorded final clipboard JSON parse assertion')
    result_file = system.linked_file(issue.get('explorerResult'), ROOT / 'output/implementation-2.24.2/native-smoke-system-result.json')
    result = read(result_file)
    require(result.get('pass') is False and result.get('exitCode') == 1 and result.get('runnerSha256') == digest(ROOT / 'output/implementation-2.24.2/run-native-smoke-system.ps1') and system.same_path(result.get('parentExecutable', ''), Path(os.environ['WINDIR']) / 'explorer.exe'), 'Native clipboard retry context differs')
    launch = system.broker_proof(system.linked_file(issue.get('explorerLaunch'), ROOT / 'output/implementation-2.24.2/native-smoke-system-retry-launch.json'), parent=result.get('parentProcessId'), style='Hidden')
    require(str(ROOT / 'output/implementation-2.24.2/run-native-smoke-system.ps1') in launch.get('arguments', ''), 'Clipboard retry producer differs')
    known = {'file': issue_file, 'sha256': digest(ROOT / issue_file), 'status': 'recorded', 'check': regression.CLIPBOARD, 'reason': issue.get('reason'), 'userDecision': issue['decision']}
    prior_native, prior_environment = regression.NATIVE, regression.environment_proof
    results = []
    try:
        regression.environment_proof = lambda actual_source: known if actual_source == source_hash else require(False, 'Clipboard source changed')
        for file in expected:
            regression.NATIVE = file
            proof = regression.native_proof(source_hash, runtime, pdf_files)
            require(proof['pass'] is False and proof['checksPassing'] == 15 and proof['checksExpected'] == 16, 'Clipboard exception concealed another missing assertion')
            results.append(proof)
    finally:
        regression.NATIVE, regression.environment_proof = prior_native, prior_environment
    return {**results[-1], 'knownIssue': known, 'priorContextReceipt': results[0]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--record', action='store_true')
    stage = parser.add_mutually_exclusive_group()
    stage.add_argument('--require-candidate', action='store_true')
    stage.add_argument('--require-private', action='store_true')
    args = parser.parse_args()
    source_hash, pdf_files = digest(ROOT / 'MotionBench.html'), {}
    require(read('package.json')['version'] == VERSION, 'Wrong source version')
    prior.build_proof()
    unit = shared.suite_proof('output/tests/v2242/unit-results.json', 'tests/run-unit-tests.cjs', source_hash)
    desktop = shared.suite_proof('output/tests/v2242/desktop-unit/results.json', 'tests/run-desktop-unit-tests.cjs', source_hash, desktop=True)
    runtime = shared.archive_identity(shared.DIST / 'resources/app.asar')
    require(runtime['runtimeHtmlSha256'] == source_hash and runtime['package']['version'] == DESKTOP_VERSION and runtime['package']['webVersion'] == VERSION, 'Packaged runtime differs')
    polish = [polish_proof(channel, source_hash, pdf_files) for channel in ('chrome', 'msedge')]
    native = native_proof(source_hash, runtime, pdf_files)
    private = private_proof(source_hash, pdf_files, candidate_only=True)
    shadow_visual = visual_proof(source_hash, private, pdf_files, shadow=True)
    actual = system.proof(source_hash, pdf_files, candidate_only=not args.require_private)
    visual = visual_proof(source_hash, actual, pdf_files)
    shortcut = shortcut_proof(source_hash, actual['example'], pdf_files) if args.require_private else None
    summary = {'version': VERSION, 'desktopVersion': DESKTOP_VERSION, 'pass': True, 'passedWithRecordedEnvironmentIssue': native['pass'] is False, 'sourceHash': source_hash, 'verifierSha256': digest(Path(__file__)), 'systemVerifierSha256': digest(ROOT / 'scripts/verify_v2242_system.py'), 'sharedVerifierSha256': digest(ROOT / 'scripts/verify_v224.py'), 'buildVerifierSha256': digest(ROOT / 'scripts/verify_v2241.py'), 'regressionVerifierSha256': digest(ROOT / 'scripts/verify_v224_supplement.py'), 'modelSuites': len(unit['suites']), 'modelChecks': sum(item.get('checksPassed', 0) for item in unit['suites']), 'desktopUnitSuites': len(desktop['suites']), 'polish': polish, 'native': native, 'visual': visual, 'shadowRegression': private, 'system': actual, 'candidateVerified': True, 'privateVerified': args.require_private, 'shortcut': shortcut, 'pdfFiles': pdf_files, 'archiveSha256': digest(shared.DIST / 'resources/app.asar')}
    summary['shadowVisual'] = shadow_visual
    require(digest(ROOT / 'MotionBench.html') == source_hash, 'Source changed during verification')
    if args.record:
        (ROOT / 'docs/acceptance-2.24.2.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: summary[key] for key in ('version', 'pass', 'modelSuites', 'modelChecks', 'candidateVerified', 'privateVerified', 'sourceHash')}))


if __name__ == '__main__':
    main()
