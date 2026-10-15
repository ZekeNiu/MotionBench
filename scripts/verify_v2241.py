"""Verify the exact local summary/radar polish candidate and its delivery evidence."""
from pathlib import Path
import argparse
import ast
import copy
import json
import os
import re

import verify_v224 as shared
import verify_v224_supplement as regression

ROOT = shared.ROOT
VERSION, DESKTOP_VERSION = '2.24.1', '2.24.1-desktop.1'
CHECKPOINT = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.1')
shared.VERSION, shared.DESKTOP_VERSION = VERSION, DESKTOP_VERSION
regression.VERSION = VERSION
regression.NATIVE = 'output/desktop-smoke-v2241/results.json'
require, digest, read = shared.require, shared.digest, shared.read
EXAMPLE_DATES = ['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13']
EXAMPLE_NAME = '示例运动员｜纵向比较（合成）'
EXAMPLE_PROFILE = 'evaluation_95e48616-ad55-4aca-9b42-378858e96732'
PRIVATE_RUNNER = 'tests/desktop-polish-preservation.cjs'
REOPEN_RUNNER = 'tests/desktop-polish-reopen.cjs'


def build_proof():
    html = (ROOT / 'MotionBench.html').read_text(encoding='utf-8')
    tree = ast.parse((ROOT / 'scripts/build.py').read_text(encoding='utf-8'))
    styles = next((ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'styles' for target in node.targets)), None)
    require(isinstance(styles, list) and styles and len(styles) == len(set(styles)), 'Cannot read current build style inventory')
    shell = (ROOT / 'src/ringside-shell.html').read_text(encoding='utf-8')
    require(shell.count('<!-- RINGSIDE_STYLES -->') == shell.count('<!-- RINGSIDE_SCRIPTS -->') == 1, 'Unexpected shell build markers')
    rendered = shell.replace('<!-- RINGSIDE_STYLES -->', '<style>\n' + '\n'.join((ROOT / 'src' / name).read_text(encoding='utf-8') for name in styles) + '\n</style>')
    prefix, suffix = rendered.split('<!-- RINGSIDE_SCRIPTS -->')
    require(html.startswith(prefix) and html.endswith(suffix), 'Current shell/styles differ from tested HTML')
    marker = re.search(r'window\.RingsideBuild=Object\.freeze\((\{[^\n]+\})\);', html)
    require(marker is not None and json.loads(marker.group(1)).get('version') == VERSION, 'Built HTML version differs')
    for file in (ROOT / 'src').glob('*.js'):
        code = file.read_text(encoding='utf-8').replace('</script', '<\\/script')
        require('<script>\n' + code + '\n</script>' in html, 'Current source omitted from built HTML: ' + file.name)


def report_proof(channel, source_hash, runtime, pdf_files):
    relative = f'output/playwright/v2241/longitudinal/{channel}/results.json'
    data, runner = read(relative), 'tests/longitudinal-browser-tests.cjs'
    require(data.get('pass') is True and data.get('sourceUnchanged') is True and data.get('errors') == [] and not data.get('failure'), 'Incomplete comparison regression: ' + channel)
    require(data.get('channel') == channel and data.get('synthetic') is True and data.get('sourceHash') == source_hash, 'Comparison attribution differs: ' + channel)
    require(data.get('runnerSha256') == digest(ROOT / runner) and data.get('fixtureSha256') == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs'), 'Comparison producer changed')
    require(set(data.get('checks', [])) == shared.expected_checks(runner, 'report', channel, False), 'Comparison check inventory incomplete')
    require(len(data['checks']) == len(set(data['checks'])), 'Duplicate comparison checks')
    if channel == 'desktop':
        shared.native_identity(data, runner, source_hash, runtime)
    for entry in data.get('artifacts', []):
        shared.artifact(entry, relative, pdf_files)
    require({'comparison.json', 'comparison.html', 'report-desktop.png', 'report-overview.png'} <= {Path(item.get('file', '')).name for item in data.get('artifacts', [])}, 'Missing comparison outputs')
    return {'file': relative, 'sha256': digest(ROOT / relative), 'checks': len(data['checks']), 'pass': True}


def polish_proof(channel, source_hash, pdf_files):
    relative = f'output/playwright/v2241/polish/{channel}/results.json'
    runner = 'tests/longitudinal-polish-browser-tests.cjs'
    data = read(relative)
    require(data.get('pass') is True and data.get('errors') == [] and not data.get('failure'), 'Polish checks incomplete')
    require(data.get('sourceHash') == source_hash and data.get('sourceUnchanged') is True and data.get('runnerSha256') == digest(ROOT / runner), 'Polish producer/source changed')
    require(data.get('channel') == channel and data.get('synthetic') is True and data.get('checks'), 'Missing polish browser check attribution')
    require(data.get('fixtureSha256') == digest(ROOT / 'tests/helpers/longitudinal-fixture.cjs'), 'Polish fixture changed')
    modules = {'src/ringside-' + name for name in ('longitudinal.js', 'longitudinal-view.js', 'longitudinal.css', 'viz.js')}
    require(set(data.get('moduleHashes', {})) == modules and all(data['moduleHashes'][name] == digest(ROOT / name) for name in modules), 'Polish module attribution changed')
    labels = [item[1] for item in re.findall(r"await check\(\s*(['\"])(.*?)\1", (ROOT / runner).read_text(encoding='utf-8'))]
    require(labels and len(labels) == len(set(labels)) and len(data['checks']) == len(set(data['checks'])) and set(data['checks']) == set(labels), 'Incomplete executed polish check inventory')
    for entry in data.get('artifacts', []):
        shared.artifact(entry, relative, pdf_files)
    require(data.get('artifacts'), 'Missing actual polish artwork')
    return {'file': relative, 'sha256': digest(ROOT / relative), 'checks': len(data['checks']), 'pass': True}


def library_core(library, baseline=None):
    value = copy.deepcopy(library)
    for key in ('version', 'updated', 'activeAthleteId', 'activeRecordId', 'longitudinalReports'):
        value.pop(key, None)
    if baseline is not None:
        ids = {owner['id'] for owner in baseline['athletes']}
        value['athletes'] = [owner for owner in value['athletes'] if owner['id'] in ids]
    for owner in value['athletes']:
        owner.pop('updated', None)
        for record in owner['records']:
            record.pop('updated', None)
    return value


def snapshot_counts(snapshot):
    owners = snapshot['library']['athletes']
    records = [record for owner in owners for record in owner['records']]
    ids = [record['recordId'] for record in records]
    require(len({owner['id'] for owner in owners}) == len(owners) and len(set(ids)) == len(ids), 'Duplicate private athlete/record identity')
    require(all(record['athleteId'] == owner['id'] for owner in owners for record in owner['records']), 'Private record owner mismatch')
    require([report['recordId'] for report in snapshot['reports']] == ids, 'Missing or reordered private calculation inventory')
    return len(owners), len(records)


def document_snapshot(document, example_athlete_id, document_key):
    value = copy.deepcopy(document)
    if value and value.get('athleteId') == example_athlete_id and value.get('key') == document_key:
        value.pop('updated', None)
    return value


def active_snapshot(active, example_athlete_id, document_key):
    value = copy.deepcopy(active)
    if value and value.get('document'):
        value['document'] = document_snapshot(value['document'], example_athlete_id, document_key)
    return value


def verify_snapshot(mode, item, snapshot, baseline, saved_example=None):
    baseline_counts = snapshot_counts(baseline)
    counts = snapshot_counts(snapshot)
    require((item.get('athletes'), item.get('records')) == counts, 'Receipt/snapshot counts differ: ' + mode)
    examples = mode in ('examples', 'reopened') or mode == 'candidate' and item.get('allowExamples') is True
    require(item.get('allowExamples') is examples, 'Unexpected example allowance: ' + mode)
    require(counts == (baseline_counts[0] + int(examples), baseline_counts[1] + 4 * int(examples)), 'Private inventory delta differs: ' + mode)
    if mode == 'baseline':
        require(snapshot == baseline, 'Baseline snapshot differs')
        return None
    original_ids = {owner['id'] for owner in baseline['library']['athletes']}
    original_record_ids = {report['recordId'] for report in baseline['reports']}
    require(library_core(snapshot['library'], baseline['library']) == library_core(baseline['library']), 'Original raw data/shared configuration changed: ' + mode)
    require([record for owner in snapshot['library']['athletes'] if owner['id'] in original_ids for record in owner['records']] == [record for owner in baseline['library']['athletes'] for record in owner['records']], 'Complete original records changed: ' + mode)
    require([report for report in snapshot['reports'] if report['recordId'] in original_record_ids] == baseline['reports'], 'Original calculations or narratives changed: ' + mode)
    require([doc for doc in snapshot['library'].get('longitudinalReports', []) if doc['athleteId'] in original_ids] == baseline['library'].get('longitudinalReports', []), 'Original comparison documents changed: ' + mode)
    extra = [owner for owner in snapshot['library']['athletes'] if owner['id'] not in original_ids]
    require(len(extra) == int(examples), 'Unexpected additional athlete: ' + mode)
    if examples:
        owner = extra[0]
        ids = [record['recordId'] for record in owner['records']]
        require(owner['profile']['name'] == EXAMPLE_NAME and len(ids) == 4 and sorted(record['athlete']['date'] for record in owner['records']) == EXAMPLE_DATES, 'Synthetic athlete dates differ: ' + mode)
        require(item.get('exampleAthleteId') == owner['id'] and item.get('exampleRecordIds') == ids, 'Example receipt owner/record identity differs: ' + mode)
        active = snapshot.get('activeComparison') or {}
        require(active.get('athleteId') == owner['id'] and sorted(active.get('recordIds', [])) == sorted(ids) and active.get('dates') == EXAMPLE_DATES, 'Active four-date comparison differs: ' + mode)
        require(active.get('improved', 0) > 0 and active.get('declined', 0) > 0, 'Example lacks both change categories')
        document = active.get('document') or {}
        require(document.get('athleteId') == owner['id'] and sorted(document.get('recordIds', [])) == sorted(ids) and document_snapshot(document, owner['id'], document.get('key')) in [document_snapshot(stored, owner['id'], document.get('key')) for stored in snapshot['library'].get('longitudinalReports', [])], 'Active comparison is not the saved document')
        profile = next((profile for profile in baseline['library'].get('evaluationProfiles', []) if profile.get('id') == EXAMPLE_PROFILE), None)
        require(profile is not None and document.get('mode') == 'mean' and document.get('evaluationProfileId') == EXAMPLE_PROFILE and document.get('profileSnapshot') == profile and all(record.get('mode') == 'mean' and record.get('evaluationProfileId') == EXAMPLE_PROFILE for record in owner['records']), 'Example representative mode or existing evaluation scheme differs')
        require(bool(document.get('narrative', {}).get('text', '').strip()) and all(record.get('narrative', {}).get('text', '').strip() for record in owner['records']), 'Missing example body')
    if mode == 'reopened':
        require(saved_example is not None and library_core(snapshot['library']) == library_core(saved_example['library']), 'Restart changed example raw data or bodies')
        require([record for owner in snapshot['library']['athletes'] for record in owner['records']] == [record for owner in saved_example['library']['athletes'] for record in owner['records']], 'Restart changed complete records')
        document_key = saved_example['activeComparison']['document']['key']
        require(snapshot['reports'] == saved_example['reports'] and [document_snapshot(document, extra[0]['id'], document_key) for document in snapshot['library'].get('longitudinalReports', [])] == [document_snapshot(document, extra[0]['id'], document_key) for document in saved_example['library'].get('longitudinalReports', [])] and active_snapshot(snapshot.get('activeComparison'), extra[0]['id'], document_key) == active_snapshot(saved_example.get('activeComparison'), extra[0]['id'], document_key), 'Restart changed calculations comparison body or active selection')
    return extra[0] if examples else None


def private_checks(mode, examples):
    checks = ['Captured current installed original library and single-report results'] if mode == 'baseline' else [
        'Every original record, shared definition and manual body preserved', 'Every original single-report result and comparison narrative preserved']
    if examples:
        checks.append('Requested four-date synthetic athlete restores active comparison with improvements and declines')
    if mode == 'reopened':
        checks.append('Normal restart preserves saved example measurements single bodies comparison body and active dates')
    return checks + ['Native save barrier and normal window close passed']


def example_proof(mode, owner, baseline, source_hash):
    actual = mode == 'installed'
    file = CHECKPOINT / 'verification' / ('example-installed' if actual else 'example-candidate') / 'results.json'
    data, runner = read(file), 'scripts/add_longitudinal_example.cjs'
    require(data.get('pass') is True and data.get('errors') == [] and data.get('network') == [] and not data.get('failure'), 'Example entry incomplete: ' + mode)
    require(data.get('mode') == ('actual-profile' if actual else 'copied-profile') and data.get('syntheticAddition') is True and data.get('normalClose') is True, 'Example entry profile/close attribution differs')
    require(data.get('sourceHash') == source_hash and data.get('sourceUnchanged') is True and data.get('runnerUnchanged') is True and data.get('runnerSha256') == digest(ROOT / runner) and data.get('baselineSnapshotSha256') == digest(CHECKPOINT / 'verification/baseline/snapshot.json'), 'Example entry producer/baseline changed')
    counts = snapshot_counts(baseline)
    require(data.get('original') == {'athletes': counts[0], 'records': counts[1]} and data.get('after') == {'athletes': counts[0] + 1, 'records': counts[1] + 4}, 'Example entry inventory delta differs')
    require(data.get('originalDataPreserved') is True and data.get('guard', {}).get('blocked') == [] and data.get('guard', {}).get('writes', 0) > 0, 'Example preservation guard incomplete')
    require(data.get('observation', {}).get('axes') == 3, 'Example must retain the three measured axes of the existing scheme')
    created = data.get('created', {})
    require(created.get('athleteId') == owner['id'] and created.get('name') == EXAMPLE_NAME and sorted(created.get('recordIds', [])) == sorted(record['recordId'] for record in owner['records']) and created.get('dates') == EXAMPLE_DATES, 'Created example differs from saved private snapshot')
    require(created.get('evaluationProfileId') == EXAMPLE_PROFILE and all(record.get('evaluationProfileId') == EXAMPLE_PROFILE for record in owner['records']), 'Example evaluation scheme differs')
    require(data.get('backup', {}).get('sha256') == digest(CHECKPOINT / 'manifest.json'), 'Example checkpoint attribution changed')
    executable = (shared.INSTALLED if actual else shared.DIST) / 'MotionBench.exe'
    profile = Path(os.environ['APPDATA']) / 'MotionBench Desktop' if actual else CHECKPOINT / 'candidate-profile'
    require(Path(data.get('profilePath', '')).resolve() == Path(data.get('userDataPath', '')).resolve() == profile.resolve(), 'Example entry user profile differs')
    identity = data.get('identity', {})
    require(data.get('version') == DESKTOP_VERSION and Path(identity.get('executable', '')).resolve() == executable.resolve() and Path(identity.get('archive', '')).resolve() == (executable.parent / 'resources/app.asar').resolve(), 'Example runtime path/version differs')
    require(identity.get('executableSha256') == digest(executable) and identity.get('archiveSha256') == digest(executable.parent / 'resources/app.asar') and identity.get('runtimeHtmlSha256') == identity.get('sourceHtmlSha256') == source_hash, 'Example runtime hashes differ')
    return {'sha256': digest(file), 'runnerSha256': data['runnerSha256'], 'pass': True}


def visual_proof(source_hash, pdf_files):
    relative = 'output/implementation-2.24.1/visual-review.json'
    visual = read(relative)
    require(visual.get('pass') is True and visual.get('sourceHash') == source_hash and visual.get('issues') == [] and visual.get('errors') == [], 'Final visual review incomplete')
    entries = visual.get('pdfs')
    require(isinstance(entries, list) and entries and len({entry.get('file') for entry in entries}) == len(entries), 'Missing or duplicate final example PDF review')
    runner = 'scripts/add_longitudinal_example.cjs'
    for entry in entries:
        require(isinstance(entry, dict) and Path(entry.get('file', '')).suffix.lower() == '.pdf', 'Visual review entry is not a PDF')
        shared.artifact(entry, relative, pdf_files)
        target = shared.relative_file(entry.get('file'))
        producer_path = Path(entry.get('producerReceipt', ''))
        producer_path = (producer_path if producer_path.is_absolute() else ROOT / producer_path).resolve()
        require(producer_path.is_relative_to((ROOT / 'output/playwright/v2241').resolve()) or producer_path.is_relative_to((CHECKPOINT / 'verification').resolve()), 'Visual producer is outside this release evidence')
        producer = read(producer_path)
        require(entry.get('producerReceiptSha256') == digest(producer_path) and entry.get('runnerSha256') == producer.get('runnerSha256') == digest(ROOT / runner), 'Visual producer attribution changed')
        require(producer.get('pass') is True and producer.get('errors') == [] and producer.get('network') == [] and not producer.get('failure') and producer.get('sourceHash') == source_hash and producer.get('sourceUnchanged') is True and producer.get('runnerUnchanged') is True and producer.get('pdfRequested') is True, 'Visual PDF producer incomplete or stale')
        require(producer.get('syntheticAddition') is True and producer.get('mode') in ('isolated-browser', 'copied-profile', 'actual-profile'), 'Unexpected visual PDF producer')
        if producer['mode'] != 'isolated-browser':
            identity = producer.get('identity', {})
            require(identity.get('runtimeHtmlSha256') == identity.get('sourceHtmlSha256') == source_hash and identity.get('archiveSha256') == digest(shared.DIST / 'resources/app.asar') and identity.get('executableSha256') == digest(shared.DIST / 'MotionBench.exe'), 'Visual PDF native runtime differs')
        outputs = []
        for output in producer.get('artifacts', []):
            value = Path(output.get('file', ''))
            if (value if value.is_absolute() else ROOT / value).resolve() == target:
                outputs.append(output)
        require(len(outputs) == 1 and outputs[0].get('sha256') == entry['sha256'] and outputs[0].get('bytes') == target.stat().st_size, 'Reviewed PDF is not the actual producer output')
        pages, count = entry.get('pages', []), pdf_files[target.relative_to(ROOT).as_posix()]
        require(entry.get('pageCount') == count and entry.get('reviewedPages') == list(range(1, count + 1)) and len(pages) == count and sorted(page.get('page') for page in pages) == entry['reviewedPages'], 'Example PDF page review incomplete')
        require(len({page.get('file') for page in pages}) == count, 'Repeated page artwork')
        for page in pages:
            require(Path(page.get('file', '')).suffix.lower() == '.png', 'Visual page evidence is not a PNG')
            shared.artifact(page, relative, pdf_files)
    return visual


def private_proof(source_hash, *, candidate_only=False):
    manifest = read(CHECKPOINT / 'manifest.json')
    entries = manifest.get('files', [])
    require(manifest.get('complete') is True and isinstance(entries, list) and entries, 'Original checkpoint incomplete')
    require(len({(entry.get('kind'), entry.get('path')) for entry in entries}) == len(entries), 'Duplicate checkpoint inventory')
    require({entry.get('kind') for entry in entries} == {'program', 'userdata'}, 'Incomplete program/userdata checkpoint')
    for entry in entries:
        file = (CHECKPOINT / entry['kind'] / entry['path']).resolve()
        require(file.is_relative_to((CHECKPOINT / entry['kind']).resolve()) and digest(file) == entry['sha256'] and entry.get('bytes') == file.stat().st_size, 'Original backup changed')
    old_archive = CHECKPOINT / 'program/resources/app.asar'
    old_runtime = shared.archive_identity(old_archive)
    require(old_runtime['package'].get('version') == '2.24.0-desktop.1', 'Wrong original installed version')
    baseline_file = CHECKPOINT / 'verification/baseline/snapshot.json'
    baseline = read(baseline_file)
    require(snapshot_counts(baseline) == (26, 146), 'This release original inventory differs from the recorded 26-athlete/146-record checkpoint')
    saved_example = None if candidate_only else read(CHECKPOINT / 'verification/examples/snapshot.json')
    receipts, example_receipts, actual_data = {}, {}, Path(os.environ['APPDATA']) / 'MotionBench Desktop'
    modes = ('baseline', 'candidate') if candidate_only else ('baseline', 'candidate', 'installed', 'examples', 'reopened')
    for mode in modes:
        file = CHECKPOINT / 'verification' / mode / 'receipt.json'
        item = read(file)
        require(item.get('pass') is True and not item.get('failure') and item.get('errors') == [] and item.get('artifactUnchanged') is True, 'Private data verification incomplete: ' + mode)
        require(item.get('mode') == mode and item.get('checks') == private_checks(mode, item.get('allowExamples') is True), 'Private mode/check inventory differs: ' + mode)
        require(item.get('runnerSha256') == digest(ROOT / (REOPEN_RUNNER if mode == 'reopened' else PRIVATE_RUNNER)), 'Private producer changed')
        require(item.get('snapshotSha256') == digest(file.parent / 'snapshot.json'), 'Private snapshot changed')
        owner = verify_snapshot(mode, item, read(file.parent / 'snapshot.json'), baseline, saved_example)
        if mode == 'candidate' and owner is not None:
            example_receipts['candidate'] = example_proof('candidate', owner, baseline, source_hash)
        elif mode == 'examples':
            example_receipts['installed'] = example_proof('installed', owner, baseline, source_hash)
        require(item.get('version') == ('2.24.0-desktop.1' if mode == 'baseline' else DESKTOP_VERSION), 'Private runtime version differs')
        executable = (shared.DIST if mode == 'candidate' else shared.INSTALLED) / 'MotionBench.exe'
        profile = actual_data if mode in ('installed', 'examples', 'reopened') else CHECKPOINT / (mode + '-profile')
        require(Path(item.get('executablePath', '')).resolve() == executable.resolve() and Path(item.get('profilePath', '')).resolve() == Path(item.get('userDataPath', '')).resolve() == profile.resolve(), 'Private executable/profile path differs: ' + mode)
        require(item.get('executableSha256') == digest(CHECKPOINT / 'program/MotionBench.exe' if mode == 'baseline' else executable), 'Private executable changed: ' + mode)
        require(item.get('runtimeHtmlSha256') == (old_runtime['runtimeHtmlSha256'] if mode == 'baseline' else source_hash) and item.get('archiveSha256') == digest(old_archive if mode == 'baseline' else shared.DIST / 'resources/app.asar'), 'Private runtime differs from tested artifact')
        if mode != 'baseline':
            require(item.get('baselineSha256') == digest(baseline_file), 'Private baseline changed')
        if mode == 'reopened':
            require(item.get('examplesSha256') == digest(CHECKPOINT / 'verification/examples/snapshot.json'), 'Restart attribution differs from saved example')
        require(item.get('actualProfile') == (mode in ('installed', 'examples', 'reopened')) and item.get('normalStartup') == (mode == 'reopened'), 'Private startup/profile attribution differs')
        receipts[mode] = {'sha256': digest(file), 'checks': len(item['checks']), 'athletes': item['athletes'], 'records': item['records']}
    require(set(example_receipts) == ({'candidate'} if candidate_only else {'candidate', 'installed'}), 'Required normal example entry evidence is incomplete')
    if candidate_only:
        return {'pass': True, 'candidateOnly': True, 'checkpointManifestSha256': digest(CHECKPOINT / 'manifest.json'), 'checkpointFiles': len(entries), 'baselineSnapshotSha256': digest(baseline_file), 'receipts': receipts, 'exampleEntryReceipts': example_receipts,
                'originalAthletes': len(baseline['library']['athletes']), 'originalRecords': len(baseline['reports'])}
    installation = read('output/implementation-2.24.1/local-installation.json')
    require(installation.get('pass') is True and installation.get('installerExitCode') == 0 and installation.get('version') == DESKTOP_VERSION, 'Installation incomplete')
    require(Path(installation.get('installationDirectory', '')).resolve() == shared.INSTALLED.resolve(), 'Installation directory differs')
    require(installation.get('installerSha256') == digest(ROOT / f'dist-desktop/MotionBench-{DESKTOP_VERSION}-Setup-x64.exe'), 'Installed setup changed')
    checks = installation.get('checks', [])
    require(len(checks) == 2 and {check.get('file') for check in checks} == {'MotionBench.exe', 'resources/app.asar'}, 'Installed identity inventory incomplete')
    for check in checks:
        require(check.get('matchesTestedPackage') is True and check.get('sha256') == digest(shared.INSTALLED / check['file']) == digest(shared.DIST / check['file']), 'Installed program differs from tested package')
    for name in ('ai-settings.dat', 'desktop-preferences.json'):
        before, after = CHECKPOINT / 'userdata' / name, Path(os.environ['APPDATA']) / 'MotionBench Desktop' / name
        require(before.exists() == after.exists() and (not before.exists() or digest(before) == digest(after)), 'Connection or desktop preference changed')
    return {'pass': True, 'checkpointManifestSha256': digest(CHECKPOINT / 'manifest.json'), 'checkpointFiles': len(entries), 'installationProofSha256': digest(ROOT / 'output/implementation-2.24.1/local-installation.json'), 'baselineSnapshotSha256': digest(baseline_file), 'receipts': receipts, 'exampleEntryReceipts': example_receipts,
            'originalAthletes': len(baseline['library']['athletes']), 'originalRecords': len(baseline['reports'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--record', action='store_true')
    private_stage = parser.add_mutually_exclusive_group()
    private_stage.add_argument('--require-private', action='store_true')
    private_stage.add_argument('--require-candidate', action='store_true')
    args = parser.parse_args()
    source_hash, pdf_files = digest(ROOT / 'MotionBench.html'), {}
    require(read('package.json')['version'] == VERSION, 'Wrong candidate version')
    build_proof()
    unit = shared.suite_proof('output/tests/v2241/unit-results.json', 'tests/run-unit-tests.cjs', source_hash)
    desktop = shared.suite_proof('output/tests/v2241/desktop-unit/results.json', 'tests/run-desktop-unit-tests.cjs', source_hash, desktop=True)
    runtime = shared.archive_identity(shared.DIST / 'resources/app.asar')
    require(runtime['runtimeHtmlSha256'] == source_hash and runtime['package']['version'] == DESKTOP_VERSION and runtime['package']['webVersion'] == VERSION, 'Packaged runtime differs')
    proofs = [report_proof(channel, source_hash, runtime, pdf_files) for channel in ('chrome', 'msedge', 'desktop')]
    proofs += [polish_proof(channel, source_hash, pdf_files) for channel in ('chrome', 'msedge')]
    regressions = [regression.regression_proof(f'output/playwright/v2241/{folder}/{name}', runner, kind, count, source_hash, pdf_files)
                   for folder, name, runner, kind, count in (
                       ('app', 'chrome-results.json', 'tests/app-v220-browser-tests.cjs', 'app', 7),
                       ('generic', 'results.json', 'tests/generic-report-browser-tests.cjs', 'generic', 17))]
    native = regression.native_proof(source_hash, runtime, pdf_files)
    require(native['pass'], 'Native regression incomplete')
    visual = visual_proof(source_hash, pdf_files)
    private = private_proof(source_hash, candidate_only=args.require_candidate) if args.require_private or args.require_candidate else None
    summary = {'version': VERSION, 'desktopVersion': DESKTOP_VERSION, 'pass': True, 'sourceHash': source_hash,
               'verifierSha256': digest(Path(__file__)), 'sharedVerifierSha256': digest(ROOT / 'scripts/verify_v224.py'),
               'regressionVerifierSha256': digest(ROOT / 'scripts/verify_v224_supplement.py'),
               'modelSuites': len(unit['suites']), 'modelChecks': sum(item.get('checksPassed', 0) for item in unit['suites']),
               'desktopUnitSuites': len(desktop['suites']), 'proofs': proofs, 'regressions': regressions, 'native': native,
               'visualSha256': digest(ROOT / 'output/implementation-2.24.1/visual-review.json'), 'pdfFiles': pdf_files,
               'archiveSha256': digest(shared.DIST / 'resources/app.asar'), 'privateVerified': args.require_private, 'candidateVerified': args.require_private or args.require_candidate, 'private': private}
    require(digest(ROOT / 'MotionBench.html') == source_hash, 'Candidate changed during verification')
    if args.record:
        (ROOT / 'docs/acceptance-2.24.1.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: summary[key] for key in ('version', 'pass', 'modelSuites', 'modelChecks', 'desktopUnitSuites', 'privateVerified', 'candidateVerified', 'sourceHash')}))


if __name__ == '__main__':
    main()
