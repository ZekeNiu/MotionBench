"""Independent evidence for the real Explorer profile, not Codex's shadow copy."""
from pathlib import Path
import copy
import json
import os
import re
import subprocess

import verify_v224 as shared
import verify_v224_supplement as regression

ROOT = shared.ROOT
CHECKPOINT = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261015-system-before-2.24.2')
SHADOW_CHECKPOINT = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261015-before-2.24.2')
RUNNER = 'tests/desktop-system-v2242.cjs'
IMPLEMENTATION = 'tests/helpers/desktop-system-installed-v2242.cjs'
BROKER = 'scripts/invoke-from-desktop.ps1'
EXAMPLE_NAME = '示例运动员｜纵向比较（合成）'
DATES = ['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13']
require, digest, read = shared.require, shared.digest, shared.read


def logical_path(value):
    return os.path.normcase(os.path.abspath(str(value).removeprefix('\\\\?\\')))


def same_path(left, right):
    return logical_path(left) == logical_path(right)


def profile_path():
    return Path(os.environ['APPDATA']) / 'MotionBench Desktop'


def broker_proof(file, *, target=None, parent=None, style=None):
    item = read(file)
    require(item.get('dispatched') is True and item.get('method') == 'ShellWindows.FindWindowSW(8,1).Document.Application.ShellExecute', 'Launch did not use the real Desktop automation object')
    require(item.get('launcherSha256') == digest(ROOT / BROKER), 'Desktop broker producer changed')
    require(same_path(item.get('desktopExecutable', ''), Path(os.environ['WINDIR']) / 'explorer.exe') and isinstance(item.get('desktopProcessId'), int) and item['desktopProcessId'] > 0, 'Desktop broker is not system Explorer')
    require(digest(item.get('targetPath', '')) == item.get('targetSha256'), 'Desktop launch target changed')
    if target is not None:
        require(same_path(item.get('targetPath', ''), target), 'Desktop launch target differs')
    if parent is not None:
        require(item['desktopProcessId'] == parent, 'Launched process is not a child of the observed Desktop Explorer')
    if style is not None:
        require(item.get('windowStyle') == style, 'Desktop launch visibility differs')
    return item


def physical_files(entries, *, complete=False):
    require(isinstance(entries, list) and entries, 'Missing physical profile file evidence')
    root = logical_path(profile_path()) + os.sep
    seen = set()
    for item in entries:
        logical = logical_path(item.get('logical', ''))
        require(logical.startswith(root) and logical not in seen, 'Physical profile evidence has an invalid or duplicate logical path')
        seen.add(logical)
        require(logical_path(item.get('physical', '')) == logical and 'openai.codex' not in item.get('physical', '').lower(), 'Profile file is redirected to a shadow location')
        require(re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')) is not None, 'Missing physical profile file digest')
    require(any('indexeddb' in name for name in seen) or not complete, 'No physical IndexedDB file was observed')


def checkpoint_proof():
    file = CHECKPOINT / 'manifest.json'
    item = read(file)
    entries, source = item.get('files'), item.get('source', {})
    require(item.get('complete') is True and item.get('kind') == 'system-profile-checkpoint' and item.get('schema') == 1, 'Independent system checkpoint incomplete')
    require(isinstance(entries, list) and entries and item.get('fileCount') == len(entries) and item.get('bytes') == sum(row['bytes'] for row in entries), 'System checkpoint inventory totals differ')
    require(item.get('sourceCommit') == '9935d08e1c70ea5a9fd3d705000faf5e6d2de197', 'System program baseline commit differs')
    require(source.get('virtualized') is False and source.get('parentName', '').lower() == 'explorer.exe' and same_path(source.get('profile', ''), profile_path()), 'System checkpoint was not captured from the actual profile')
    require(same_path(source.get('parentExecutable', ''), Path(os.environ['WINDIR']) / 'explorer.exe') and isinstance(source.get('parentProcessId'), int), 'System backup parent is not Explorer')
    producer = ROOT / 'output/implementation-2.24.2/backup-system-profile.ps1'
    require(item.get('runnerSha256') == digest(producer), 'System backup producer changed')
    launch = broker_proof(ROOT / 'output/implementation-2.24.2/system-backup-final-verification-launch.json', parent=source['parentProcessId'], style='Hidden')
    require(str(producer) in launch.get('arguments', '') and '-VerifyExistingCopies' in launch['arguments'], 'System backup final verification launch differs')
    require(len({row['path'].lower() for row in entries}) == len(entries), 'Duplicate system backup path')
    physical_files(entries, complete=True)
    for row in entries:
        require(row.get('kind') == 'userdata' and same_path(row['logical'], profile_path() / row['path']), 'System backup source identity differs')
        target = (CHECKPOINT / 'system-userdata' / row['path']).resolve()
        require(target.is_relative_to((CHECKPOINT / 'system-userdata').resolve()) and digest(target) == row['sha256'] and target.stat().st_size == row['bytes'], 'Immutable system backup changed')
    reference = item.get('programReference', {})
    require(same_path(reference.get('installationDirectory', ''), shared.INSTALLED) and same_path(reference.get('checkpoint', ''), SHADOW_CHECKPOINT), 'Original program reference differs')
    old = read(SHADOW_CHECKPOINT / 'manifest.json')
    require(reference.get('manifestSha256') == digest(SHADOW_CHECKPOINT / 'manifest.json') and reference.get('files') == [entry for entry in old['files'] if entry['kind'] == 'program'], 'Original program inventory differs')
    for entry in reference['files']:
        original = (SHADOW_CHECKPOINT / 'program' / entry['path']).resolve()
        require(original.is_relative_to((SHADOW_CHECKPOINT / 'program').resolve()) and digest(original) == entry['sha256'] and original.stat().st_size == entry['bytes'], 'Original program backup changed')
    return item


def example(snapshot):
    owners = [owner for owner in snapshot['library']['athletes'] if owner.get('name') == EXAMPLE_NAME and not owner.get('deletedAt')]
    require(len(owners) <= 1, 'Duplicate system example')
    if not owners:
        return {'present': False, 'athleteId': None, 'recordIds': [], 'dates': []}
    owner = owners[0]
    return {'present': True, 'athleteId': owner['id'], 'recordIds': sorted(record['recordId'] for record in owner['records']), 'dates': sorted(record['athlete']['date'] for record in owner['records'])}


def document_key(sample):
    return json.dumps([sample['athleteId'], sample['recordIds']], ensure_ascii=False, separators=(',', ':')) if sample.get('present') else None


def projection(snapshot, sample):
    value = copy.deepcopy(snapshot)
    for key in ('version', 'updated', 'activeAthleteId', 'activeRecordId'):
        value['library'].pop(key, None)
    # The schema omits the list until its first comparison is saved. Empty and
    # absent containers express the same collection; no document is discarded.
    value['library'].setdefault('longitudinalReports', [])
    key = document_key(sample)
    documents = value['library'].get('longitudinalReports', [])[:]
    if value.get('activeComparison') and value['activeComparison'].get('document'):
        documents.append(value['activeComparison']['document'])
    for document in documents:
        if key and document.get('key') == key and document.get('athleteId') == sample['athleteId']:
            document.pop('updated', None)
    return value


def snapshot_inventory(snapshot):
    owners = snapshot['library']['athletes']
    records = [record for owner in owners for record in owner['records']]
    require(len({owner['id'] for owner in owners}) == len(owners) and len({record['recordId'] for record in records}) == len(records), 'System snapshot contains duplicate identities')
    require(all(record['athleteId'] == owner['id'] for owner in owners for record in owner['records']), 'System record owner differs')
    require([row['recordId'] for row in snapshot['reports']] == [record['recordId'] for record in records], 'System calculation inventory differs')
    return {'athletes': len(owners), 'records': len(records)}


def check_inventory(mode):
    if mode == 'candidate':
        match = re.search(r'/\* VERIFY_CANDIDATE_CHECKS (\[[\s\S]*?\]) VERIFY_CANDIDATE_CHECKS \*/', (ROOT / IMPLEMENTATION).read_text(encoding='utf-8'))
        require(match is not None, 'System candidate lacks its closed check inventory')
        values = json.loads(match.group(1))
        require(values and len(values) == len(set(values)), 'System candidate check inventory invalid')
        return values
    match = re.search(r'/\* VERIFY_CHECKS (\{[\s\S]*?\}) VERIFY_CHECKS \*/', (ROOT / RUNNER).read_text(encoding='utf-8'))
    require(match is not None, 'System producer lacks its closed check inventory')
    values = json.loads(match.group(1)).get(mode)
    require(isinstance(values, list) and values and len(values) == len(set(values)), 'System check inventory invalid')
    return values


def precise_reopen_io_failure(item):
    expected_file = str(CHECKPOINT / 'verification/reopened/after-physical.json')
    failure = item.get('failure', '')
    require(item.get('mode') == 'reopened' and item.get('pass') is False and item.get('checks') == check_inventory('reopened')[:-1], 'Only the recorded reopened-stage final I/O failure may be completed separately')
    require(failure.startswith("Error: EBUSY: resource busy or locked, open '" + expected_file + "'\n") and 'at Object.readFileSync (node:fs:441:20)' in failure and 'desktop-system-v2242.cjs:9:147' in failure and 'desktop-system-installed-v2242.cjs:11:558' in failure and 'desktop-system-installed-v2242.cjs:25:663' in failure and 'desktop-system-v2242.cjs:29:330' in failure, 'Reopen failure is not the exact recorded after-physical read race')
    require(item.get('errors') == [] and item.get('network') == [] and not item.get('closeFailure') and item.get('normalClose') is True and item.get('closeEvidence', {}).get('exited') is True, 'An unrelated reopened failure cannot be completed')
    require(set(item.get('physicalEvidence', {})) == {'before'} and item.get('implementationUnchanged') is None and item.get('protectedPreferencesUnchanged') is None, 'Reopen failure did not occur at the expected evidence-read boundary')


def receipt_base(mode, source_hash, manifest, *, _building_io_completion=False):
    directory = CHECKPOINT / 'verification' / mode
    item = read(directory / 'receipt.json')
    io_completion = mode == 'reopened' and item.get('pass') is False
    if io_completion:
        precise_reopen_io_failure(item)
        if not _building_io_completion:
            reopen_completion_proof(source_hash, manifest)
    else:
        require(not _building_io_completion and item.get('pass') is True and item.get('errors') == [] and item.get('network') == [] and not item.get('failure') and not item.get('closeFailure'), 'System stage failed: ' + mode)
    require(item.get('mode') == mode and item.get('checks') == check_inventory(mode)[:(-1 if io_completion else None)], 'System executed check inventory differs: ' + mode)
    require(item.get('runnerSha256') == digest(ROOT / RUNNER) and item.get('runnerUnchanged') is True and item.get('sourceUnchanged') is True and item.get('artifactUnchanged') is True and item.get('normalClose') is True, 'System stage attribution or normal close differs')
    require(item.get('workspaceSourceHash') == source_hash and item.get('backupManifestSha256') == digest(CHECKPOINT / 'manifest.json') and same_path(item.get('backupManifest', ''), CHECKPOINT / 'manifest.json'), 'System source/checkpoint attribution differs')
    require(item.get('originURL') == 'motionbench://app/MotionBench.html' and item.get('databaseName') == 'motionbench-v3:/MotionBench.html' and item.get('defaultSession') is True, 'System origin/session database differs')
    startup_file, final_file = directory / 'startup-snapshot.json', directory / 'snapshot.json'
    names = ['startup-snapshot.json', 'snapshot.json'] + (['selected-snapshot.json'] if mode in ('candidate', 'installed') else [])
    expected = {(str(directory / name), digest(directory / name)) for name in names}
    require(len(item.get('snapshots', [])) == len(names) and {(str(Path(entry['file'])), entry['sha256']) for entry in item['snapshots']} == expected, 'System snapshot file inventory differs')
    if mode in ('candidate', 'installed'):
        require(item.get('selectedSnapshotSha256') == digest(directory / 'selected-snapshot.json'), 'System selection snapshot changed')
    require(item.get('startupSnapshotSha256') == digest(startup_file) and item.get('snapshotSha256') == digest(final_file), 'System snapshot changed')
    startup, final = read(startup_file), read(final_file)
    require(item.get('counts') == snapshot_inventory(final), 'System saved counts differ')
    require(item.get('example') == example(final), 'System saved example identity differs')
    return item, startup, final


def baseline_proof(source_hash, manifest):
    item, startup, final = receipt_base('baseline', source_hash, manifest)
    sample = example(final)
    require(item.get('originalPreserved') is True and item.get('guard', {}).get('blocked') == [] and item.get('guard', {}).get('writes', 0) > 0, 'System baseline preservation guard did not complete')
    require(projection(startup, sample) == projection(final, sample), 'System baseline save changed original data')
    original = SHADOW_CHECKPOINT / 'program/MotionBench.exe'
    archive = original.parent / 'resources/app.asar'
    runtime = shared.archive_identity(archive)
    require(same_path(item.get('executablePath', ''), original) and same_path(item.get('archivePath', ''), archive), 'System baseline did not use the original program backup')
    require(item.get('executableSha256') == digest(original) and item.get('archiveSha256') == digest(archive) and item.get('runtimeHtmlSha256') == item.get('sourceHash') == runtime['runtimeHtmlSha256'] and item.get('version') == '2.24.1-desktop.1', 'System baseline runtime differs')
    profile = CHECKPOINT / 'system-baseline-profile'
    require(all(same_path(item.get(key, ''), profile) for key in ('profilePath', 'userDataPath', 'sessionDataPath')) and item.get('launchArgs') == ['--motionbench-test', '--motionbench-data-dir=' + str(profile)], 'System baseline did not use its isolated verified copy')
    return {'file': str(CHECKPOINT / 'verification/baseline/receipt.json'), 'sha256': digest(CHECKPOINT / 'verification/baseline/receipt.json'), 'counts': item['counts'], 'example': sample, 'checks': len(item['checks']), 'snapshotSha256': item['snapshotSha256']}, final


def linked_file(entry, expected=None):
    require(isinstance(entry, dict) and entry.get('file') and entry.get('sha256'), 'Missing linked evidence identity')
    file = Path(entry['file'])
    if not file.is_absolute():
        file = ROOT / file
    require(expected is None or same_path(file, expected), 'Linked evidence path differs')
    require(digest(file) == entry['sha256'], 'Linked evidence changed')
    return file


def original_preserved(actual, baseline):
    original = copy.deepcopy(actual)
    owners = {owner['id'] for owner in baseline['library']['athletes']}
    records = {record['recordId'] for record in baseline['reports']}
    docs = {document['key'] for document in baseline['library'].get('longitudinalReports', [])}
    original['library']['athletes'] = [owner for owner in original['library']['athletes'] if owner['id'] in owners]
    original['library']['longitudinalReports'] = [document for document in original['library'].get('longitudinalReports', []) if document['key'] in docs]
    original['reports'] = [record for record in original['reports'] if record['recordId'] in records]
    original.pop('activeComparison', None)
    expected = {key: value for key, value in baseline.items() if key != 'activeComparison'}
    require(projection(original, example(baseline)) == projection(expected, example(baseline)), 'An original system record, calculation, scheme, default, or comparison changed')


def approved_example(snapshot, payload, baseline):
    snapshot_inventory(snapshot)
    sample = example(snapshot)
    owner = payload['library']['athletes'][0]
    expected_owner_ids = {item['id'] for item in baseline['library']['athletes']} | {owner['id']}
    require({item['id'] for item in snapshot['library']['athletes']} == expected_owner_ids, 'Unexpected system athlete addition/deletion')
    actual = next(item for item in snapshot['library']['athletes'] if item['id'] == owner['id'])
    # Export orders the new sample's records by document ID. The record values,
    # identity and all original owners remain exact; only this array is keyed.
    def keyed_owner(value):
        value = copy.deepcopy(value)
        value['records'] = sorted(value['records'], key=lambda record: record['recordId'])
        return value
    require(keyed_owner(actual) == keyed_owner(owner), 'Approved example measurements, metadata or single-record narratives changed')
    require(sample['present'] and sample['dates'] == DATES and sample['athleteId'] == owner['id'] and sample['recordIds'] == sorted(payload['selection']['recordIds']), 'System example identity differs')
    active = snapshot.get('activeComparison') or {}
    ordered = [record['recordId'] for record in sorted(owner['records'], key=lambda record: record['athlete']['date'])]
    require(active.get('athleteId') == owner['id'] and active.get('recordIds') == ordered and active.get('dates') == DATES and active.get('model'), 'System current four-date comparison differs')
    key = document_key(sample)
    documents = snapshot['library'].get('longitudinalReports', [])
    require({doc['key'] for doc in documents} == {doc['key'] for doc in baseline['library'].get('longitudinalReports', [])} | {key} and len(documents) == len(baseline['library'].get('longitudinalReports', [])) + 1, 'Unexpected system comparison addition or duplicate')
    def doc_value(doc):
        require(doc.get('key') == key and doc.get('athleteId') == owner['id'], 'System comparison owner/key differs')
        value = copy.deepcopy(doc); value.pop('updated', None); return value
    expected_doc = payload['library']['longitudinalReports'][0]
    require(doc_value(active['document']) == doc_value(next(doc for doc in documents if doc['key'] == key)) == doc_value(expected_doc), 'System comparison content, revision, basis or views changed')
    model = active['model']
    require(model['basis'] == expected_doc['basis'] == expected_doc['narrative']['basis'] and model['mode'] == expected_doc['mode'] and model['profile'] == expected_doc['profileSnapshot'] and model['catalog'] == baseline['library']['catalog'], 'System comparison calculation basis differs')
    original_preserved(snapshot, baseline)
    return sample


def clean_payload_proof(source_hash, baseline):
    directory = ROOT / 'output/implementation-2.24.2/system-example'
    proof_file, payload_file = directory / 'preparation-proof.json', directory / 'example-comparison-clean.json'
    proof, payload = read(proof_file), read(payload_file)
    require(proof.get('pass') is True and proof.get('productSourceHash') == source_hash, 'Clean example preparation failed or used another product')
    linked_file(proof.get('runner'), ROOT / 'scripts/prepare_v2242_system_example.cjs')
    linked_file(proof.get('baseline'), CHECKPOINT / 'verification/baseline/snapshot.json')
    old = read(linked_file(proof.get('source'), ROOT / 'output/playwright/v2241/example-installed/example-comparison.json'))
    linked_file(proof.get('payload'), payload_file); linked_file(proof.get('facts'), directory / 'example-model-facts.json')
    library, real = payload['library'], baseline['library']
    require(payload.get('kind') == 'longitudinal-report' and len(library['athletes']) == 1 and len(library.get('longitudinalReports', [])) == 1, 'Clean example inventory differs')
    require(library['catalog'] == real['catalog'] and library['evaluationProfiles'] == real['evaluationProfiles'] and library['defaultEvaluationProfileId'] == real['defaultEvaluationProfileId'], 'Clean example changed a real catalog/profile/default')
    require(library.get('testPlans') == [] and library.get('groups') == [], 'Clean example introduced shared entries')
    old_owner, owner = old['library']['athletes'][0], library['athletes'][0]
    require({key: value for key, value in owner.items() if key != 'records'} == {key: value for key, value in old_owner.items() if key != 'records'}, 'Clean example owner changed')
    old_records = {record['recordId']: record for record in old_owner['records']}
    tests = {'fms', 'iso', 'cmj', 'sj', 'dj', 'imtp', 'pushup', 'mb', 'mas', 'mss'}
    require(len(owner['records']) == 4 and {record['recordId'] for record in owner['records']} == set(old_records) and sorted(record['athlete']['date'] for record in owner['records']) == DATES, 'Clean example records or dates changed')
    for record in owner['records']:
        original = old_records[record['recordId']]
        require(record['athleteId'] == owner['id'] and record['athlete'] == original['athlete'] and record['mode'] == original['mode'], 'Clean example measurement subject/date/mode changed')
        require({key for key, value in record['enabled'].items() if value} == tests and record['customTests'] == [], 'Clean example includes unapproved projects')
        require(all(record['data'][test] == original['data'][test] and record['protocolIdentities'][test] == original['protocolIdentities'][test] and record['protocol'][test] == original['protocol'][test] for test in tests), 'Clean example raw trials or protocols changed')
        require(all(record.get(key) == original.get(key) for key in ('cmjConfig', 'imtpConfig', 'impulseConfig', 'imtpTimeStandards', 'isoDirectionIds')), 'Clean example measurement config changed')
        require(record['evaluationProfileId'] == 'evaluation_59e27dd9-a441-4ed8-8d6d-1798325c635e', 'Clean example scheme differs')
    require('demo_generic_' not in json.dumps(payload, ensure_ascii=False), 'Shadow-only test definitions leaked into clean example')
    require(all(proof.get(key) is True for key in ('catalogEqual', 'profilesEqual', 'noNewSharedDefinitions', 'rawMeasurementsEqual', 'importNormalizationUnchanged')), 'Clean preparation assertions incomplete')
    require(proof.get('basis') == library['longitudinalReports'][0]['basis'] and proof.get('defaultEvaluationProfileId') == real['defaultEvaluationProfileId'], 'Clean preparation calculation/default identity differs')
    return {'file': str(payload_file), 'sha256': digest(payload_file), 'proofFile': str(proof_file), 'proofSha256': digest(proof_file)}, payload


def helper_identity(item, source_hash, *, _completing_io=False):
    if _completing_io:
        precise_reopen_io_failure(item)
    require(item.get('implementationSha256') == digest(ROOT / IMPLEMENTATION) and (item.get('implementationUnchanged') is True or _completing_io) and same_path(item.get('implementationFile', ''), ROOT / IMPLEMENTATION), 'System implementation changed')
    require(item.get('sourceHash') == item.get('runtimeHtmlSha256') == source_hash and item.get('version') == '2.24.2-desktop.1', 'System runtime differs from final source')
    require(item.get('baselineSnapshotSha256') == digest(CHECKPOINT / 'verification/baseline/snapshot.json'), 'System stage baseline changed')
    require(item.get('originalPreserved') is True and item.get('guard', {}).get('blocked') == [] and item.get('guard', {}).get('writes', 0) > 0, 'System original-data guard incomplete')


def exported_artifacts(item, snapshot, baseline, pdf_files):
    directory = (ROOT / 'output/playwright/v2242/system-candidate').resolve()
    files = []
    for entry in item.get('artifacts', []):
        file = linked_file(entry).resolve()
        require(file.is_relative_to(directory) and file not in files and file.stat().st_size == entry.get('bytes'), 'System export path, size or duplication differs')
        shared.artifact({'file': file.relative_to(ROOT).as_posix(), 'sha256': entry['sha256']}, '', pdf_files)
        files.append(file)
    require(len(files) == 5 and all(sum(file.suffix == suffix for file in files) == count for suffix, count in (('.json', 1), ('.html', 1), ('.pdf', 1), ('.png', 2))), 'System export inventory incomplete')
    json_file = next(file for file in files if file.suffix == '.json'); exported = read(json_file)
    require(exported.get('kind') == 'longitudinal-report' and len(exported['library']['athletes']) == len(exported['library']['longitudinalReports']) == 1, 'System export contains another library')
    approved_example(snapshot, exported, baseline)
    require(exported['library']['catalog'] == baseline['library']['catalog'], 'Exported system catalog changed')
    needed = {record['evaluationProfileId'] for record in exported['library']['athletes'][0]['records']}
    require(exported['library']['evaluationProfiles'] == [profile for profile in baseline['library']['evaluationProfiles'] if profile['id'] in needed], 'Exported system schemes changed')
    embedded = re.search(r'<script\b[^>]*\bid="embedded-data"[^>]*>([\s\S]*?)</script>', next(file for file in files if file.suffix == '.html').read_text(encoding='utf-8'), re.I)
    require(embedded is not None and json.loads(embedded.group(1)) == exported, 'System editable HTML differs from JSON')
    pdf = next(file for file in files if file.suffix == '.pdf')
    require(item.get('pdfRequested') is True, 'Clean system PDF was not exported')
    regression.verify_pdf({'file': pdf.relative_to(ROOT).as_posix(), 'sha256': digest(pdf), 'diagnostics': item.get('pdfDiagnostics')}, pdf_files)
    return [file.relative_to(ROOT).as_posix() for file in files], exported, json_file


def candidate_proof(source_hash, manifest, baseline, clean, payload, pdf_files):
    item, startup, final = receipt_base('candidate', source_hash, manifest)
    helper_identity(item, source_hash); linked_file(item.get('cleanPayload'), clean['file'])
    require(projection(startup, example(baseline)) == projection(baseline, example(baseline)) and item.get('countsBefore') == snapshot_inventory(baseline), 'System candidate did not start with the real baseline')
    profile = CHECKPOINT / 'system-candidate-profile'
    require(all(same_path(item.get(key, ''), profile) for key in ('profilePath', 'userDataPath', 'sessionDataPath')) and item.get('launchArgs') == ['--motionbench-test', '--motionbench-data-dir=' + str(profile)], 'System candidate did not use its isolated real-data copy')
    require(same_path(item.get('executablePath', ''), shared.DIST / 'MotionBench.exe') and same_path(item.get('archivePath', ''), shared.DIST / 'resources/app.asar') and item.get('executableSha256') == digest(shared.DIST / 'MotionBench.exe') and item.get('archiveSha256') == digest(shared.DIST / 'resources/app.asar'), 'System candidate package differs')
    copied = item.get('profileCopy', {})
    require(same_path(copied.get('profile', ''), profile) and same_path(copied.get('source', ''), CHECKPOINT / 'system-userdata') and copied.get('fileCount') == manifest['fileCount'] and copied.get('bytes') == manifest['bytes'] and copied.get('verifiedFiles') == [{key: entry[key] for key in ('path', 'sha256', 'bytes')} for entry in manifest['files']], 'System candidate original copy evidence differs')
    selected = read(CHECKPOINT / 'verification/candidate/selected-snapshot.json')
    sample = approved_example(final, payload, baseline); approved_example(selected, payload, baseline)
    require(projection(selected, sample) == projection(final, sample), 'System export/save changed selected data or calculations')
    require(item.get('imported') is True and item.get('importResult', {}).get('added') == 4 and item.get('importResult', {}).get('recordMap') == {} and item.get('importResult', {}).get('profileMap') == {} and item.get('guard', {}).get('imports') == 1, 'System candidate import remapped identities or added unexpected records')
    files, exported, json_file = exported_artifacts(item, final, baseline, pdf_files)
    file = CHECKPOINT / 'verification/candidate/receipt.json'
    return {'file': str(file), 'sha256': digest(file), 'checks': len(item['checks']), 'counts': item['counts'], 'example': sample, 'artifacts': files, 'snapshotSha256': item['snapshotSha256'], 'implementationSha256': item['implementationSha256']}, final, exported, json_file


def physical_probe(entry, directory, label, manifest):
    file = linked_file(entry, directory / (label + '-physical.json'))
    value = read(file)
    producer = ROOT / 'output/implementation-2.24.2/inspect-system-profile.ps1'
    require(value.get('runnerSha256') == entry.get('runnerSha256') == digest(producer) and same_path(value.get('profile', ''), profile_path()), 'Physical profile probe producer/profile differs')
    require(value.get('parentName', '').lower() == 'explorer.exe', 'Physical probe did not run under Explorer')
    launch = broker_proof(linked_file(entry.get('launchReceipt'), directory / (label + '-physical-launch.json')), parent=value.get('parentProcessId'), style='Hidden')
    require(str(producer) in launch.get('arguments', '') and str(file) in launch['arguments'], 'Physical probe launch does not identify its helper/output')
    physical_files(value.get('resolvedFiles'), complete=True)
    for name in ('ai-settings.dat', 'desktop-preferences.json'):
        prior = [row for row in manifest['files'] if row['path'].lower() == name]
        current = [row for row in value['resolvedFiles'] if same_path(row['logical'], profile_path() / name)]
        require(len(prior) == len(current) and (not prior or prior[0]['sha256'] == current[0]['sha256'] and prior[0]['bytes'] == current[0]['bytes']), 'Original connection/preferences file changed')
    return value


def system_runtime(item, source_hash):
    executable, archive = shared.INSTALLED / 'MotionBench.exe', shared.INSTALLED / 'resources/app.asar'
    require(same_path(item.get('executablePath', ''), executable) and same_path(item.get('archivePath', ''), archive) and item.get('executableSha256') == digest(executable) == digest(shared.DIST / 'MotionBench.exe') and item.get('archiveSha256') == digest(archive) == digest(shared.DIST / 'resources/app.asar'), 'Actual installed executable differs from the final package')
    require(all(same_path(item.get(key, ''), profile_path()) for key in ('profilePath', 'userDataPath', 'sessionDataPath')) and item.get('actualProfile') is True and item.get('systemContext') is True and item.get('normalStartup') is False, 'Actual system profile attribution differs')
    args = item.get('launchArgs', [])
    require(len(args) == 1 and re.fullmatch(r'--remote-debugging-port=\d+', args[0]) and '--motionbench-' not in item.get('commandLine', '') and args[0] in item.get('commandLine', ''), 'Actual system launch uses test data or unexpected arguments')
    require(item.get('parentName', '').lower() == 'explorer.exe' and same_path(item.get('parentExecutable', ''), Path(os.environ['WINDIR']) / 'explorer.exe'), 'Actual application parent is not Explorer')
    launch = broker_proof(linked_file(item.get('launchReceipt')), target=executable, parent=item['parentProcessId'], style='Normal')
    require(launch.get('arguments') == args[0] and item.get('brokerSha256') == digest(ROOT / BROKER), 'Actual application launch attribution differs')
    evidence = item.get('defaultSessionEvidence', {})
    require(evidence.get('method') == 'Default CDP browser context and archived BrowserWindow session selection' and evidence.get('contextCount') == 1 and evidence.get('nonDefaultContextIds') == [] and evidence.get('target', {}).get('url') == item.get('originURL') and evidence.get('target', {}).get('type') == 'page', 'Actual default session evidence incomplete')
    code = "const fs=require('@electron/asar'),c=require('node:crypto'),s=fs.extractFile(process.argv[1],require('node:path').normalize('desktop/main.cjs')).toString('utf8');process.stdout.write(JSON.stringify({sha256:c.createHash('sha256').update(s).digest('hex'),preferences:s.match(/webPreferences\\s*:\\s*\\{([^}]+)\\}/g)}));"
    main = json.loads(subprocess.check_output(['node', '-e', code, str(archive)], cwd=ROOT, text=True, encoding='utf-8'))
    require(evidence.get('mainSha256') == main['sha256'] and evidence.get('webPreferences') == main['preferences'] and main['preferences'] and all(not re.search(r'(?:session|partition)\s*:', block) for block in main['preferences']), 'Archived application does not substantiate the default session claim')
    close = item.get('closeEvidence', {})
    require(close.get('processId') == item.get('processId') and close.get('method') == 'System.Diagnostics.Process.CloseMainWindow' and close.get('requested') is True and close.get('exited') is True, 'Actual application did not complete its normal close')


def installation_proof(manifest):
    file = ROOT / 'output/implementation-2.24.2/system-installation.json'
    item = read(file)
    require(item.get('pass') is True and item.get('version') == '2.24.2-desktop.1' and item.get('installerExitCode') == 0, 'Actual system installation failed')
    require(item.get('runnerSha256') == digest(ROOT / 'scripts/install_v2242_system.ps1') and item.get('verifierSha256') == digest(ROOT / 'scripts/verify_v2242.py'), 'Actual installation producer or main preflight verifier changed')
    archived = install_preflight_producer_proof(file)
    require(item.get('systemVerifierSha256') == archived['sha256'], 'Actual installation is not bound to its preserved install-time system verifier')
    require(same_path(item.get('installationDirectory', ''), shared.INSTALLED) and same_path(item.get('profilePath', ''), profile_path()) and item.get('systemManifestSha256') == digest(CHECKPOINT / 'manifest.json'), 'Actual installation directory or backup differs')
    require(item.get('parentName', '').lower() == 'explorer.exe' and same_path(item.get('parentExecutable', ''), Path(os.environ['WINDIR']) / 'explorer.exe'), 'Installer helper did not run from Explorer')
    launch = broker_proof(ROOT / 'output/implementation-2.24.2/system-installation-launch.json', parent=item.get('parentProcessId'), style='Hidden')
    require(str(ROOT / 'scripts/install_v2242_system.ps1') in launch.get('arguments', ''), 'Actual installer helper launch differs')
    physical_files(item.get('physicalFiles'), complete=True)
    actual = {(logical_path(row['logical']), logical_path(row['physical']), row['bytes'], row['sha256']) for row in item['physicalFiles']}
    expected = {(logical_path(row['logical']), logical_path(row['physical']), row['bytes'], row['sha256']) for row in manifest['files']}
    require(len(item['physicalFiles']) == len(manifest['files']) and actual == expected, 'Installation did not preserve the exact original physical profile before upgrade')
    require(item.get('installerSha256') == digest(ROOT / 'dist-desktop/MotionBench-2.24.2-desktop.1-Setup-x64.exe'), 'Actual installer artifact changed')
    checks = item.get('checks', [])
    require(len(checks) == 2 and {row.get('file') for row in checks} == {'MotionBench.exe', 'resources/app.asar'}, 'Installed package identity inventory incomplete')
    for row in checks:
        require(row.get('matchesTestedPackage') is True and row.get('sha256') == digest(shared.INSTALLED / row['file']) == digest(shared.DIST / row['file']), 'Actual installed package differs')
    return {'file': str(file), 'sha256': digest(file), 'pass': True, 'systemPreflightProducer': archived}


def install_preflight_producer_proof(installation_receipt):
    manifest_file = CHECKPOINT / 'verification/install-preflight-producer.json'
    manifest = read(manifest_file)
    archive = CHECKPOINT / 'verification/install-preflight-producer.py'
    original_hash = '7de36b77fdf1d5b43e5b3ab941e9a11dba7fe7ef80c86409a75ffb6846a8ad19'
    require(manifest.get('schema') == 1 and manifest.get('kind') == 'install-preflight-producer' and same_path(manifest.get('sourceFile', ''), ROOT / 'scripts/verify_v2242_system.py') and same_path(manifest.get('archiveFile', ''), archive), 'Install-time verifier archive attribution differs')
    require(manifest.get('sha256') == manifest.get('installationSystemVerifierSha256') == digest(archive) == original_hash, 'Install-time verifier was not preserved byte for byte')
    linked_file(manifest.get('installationReceipt'), installation_receipt)
    return {'file': str(archive), 'sha256': original_hash, 'manifestFile': str(manifest_file), 'manifestSha256': digest(manifest_file)}


REOPEN_COMPLETION_CHECKS = [
    'Original failed receipt retained with exactly three successful data checks and the final after-physical EBUSY read',
    'Installed package source runner helper and completed normal close identities remain exact',
    'Startup and saved snapshots retain every original and example record result narrative scheme and four-date selection',
    'Completed after-probe JSON has the expected Explorer parent real physical Roaming files and unchanged protected preferences',
    'Original failure snapshot probe launch and installation-time verifier files are hash bound without rewriting them',
]


def build_reopen_completion(source_hash, manifest):
    """Read-only completion of this one producer I/O race; no app is launched."""
    item, startup, final = receipt_base('reopened', source_hash, manifest, _building_io_completion=True)
    helper_identity(item, source_hash, _completing_io=True); system_runtime(item, source_hash)
    installed, _, expected = receipt_base('installed', source_hash, manifest)
    helper_identity(installed, source_hash)
    baseline = read(CHECKPOINT / 'verification/baseline/snapshot.json')
    baseline_receipt = read(CHECKPOINT / 'verification/baseline/receipt.json')
    require(baseline_receipt.get('pass') is True and baseline_receipt.get('snapshotSha256') == digest(CHECKPOINT / 'verification/baseline/snapshot.json'), 'Reopen completion baseline differs')
    candidate_file = linked_file(item.get('candidateReceipt'), CHECKPOINT / 'verification/candidate/receipt.json')
    candidate = read(candidate_file)
    require(candidate.get('pass') is True and candidate.get('sourceHash') == source_hash and candidate.get('implementationSha256') == digest(ROOT / IMPLEMENTATION), 'Reopen completion candidate differs')
    payload_file = linked_file(item.get('exampleSource'))
    require(any(same_path(entry.get('file', ''), payload_file) and entry.get('sha256') == digest(payload_file) for entry in candidate.get('artifacts', [])), 'Reopen completion is not bound to the approved actual-catalog export')
    payload = read(payload_file)
    sample = approved_example(final, payload, baseline); approved_example(startup, payload, baseline); approved_example(expected, payload, baseline)
    require(item.get('reopened') is True and item.get('presentBefore') is True and item.get('imported') is False and item.get('artifacts') == [], 'Reopen completion changed the actual operation')
    require(projection(startup, sample) == projection(expected, sample) == projection(final, sample), 'Reopen completion found changed measurements results bodies views revision or selection')
    directory = CHECKPOINT / 'verification/reopened'
    before = physical_probe(item['physicalEvidence']['before'], directory, 'before', manifest)
    require(item.get('physicalFiles') == before['resolvedFiles'], 'Failed receipt before-probe evidence changed')
    after_entry = {'file': str(directory / 'after-physical.json'), 'sha256': digest(directory / 'after-physical.json'),
                   'launchReceipt': {'file': str(directory / 'after-physical-launch.json'), 'sha256': digest(directory / 'after-physical-launch.json')},
                   'runnerSha256': digest(ROOT / 'output/implementation-2.24.2/inspect-system-profile.ps1')}
    after = physical_probe(after_entry, directory, 'after', manifest)
    require(after.get('files') == len(after['resolvedFiles']) and after.get('bytes') == sum(row['length'] for row in after['resolvedFiles']), 'Completed physical probe inventory is truncated')
    original_preferences = next(row for row in manifest['files'] if row['path'] == 'Preferences')
    for probe in (before, after):
        preferences = [row for row in probe['resolvedFiles'] if same_path(row['logical'], profile_path() / 'Preferences')]
        require(len(preferences) == 1 and preferences[0]['sha256'] == original_preferences['sha256'] and preferences[0]['length'] == original_preferences['bytes'], 'Original Chromium Preferences changed')
    original_hash = digest(directory / 'receipt.json')
    require(original_hash == '21659932706106474df2636e8a2f4f554939c4efb2e9b97f5bb622135813b092', 'This completion applies only to the preserved original reopened failure')
    archived = install_preflight_producer_proof(ROOT / 'output/implementation-2.24.2/system-installation.json')
    producer = ROOT / 'scripts/complete_v2242_system_reopen.py'
    return {'schema': 1, 'kind': 'reopen-io-completion', 'pass': True, 'readOnly': True, 'nativeLaunched': False, 'checks': REOPEN_COMPLETION_CHECKS,
            'sourceHash': source_hash, 'systemVerifierSha256': digest(Path(__file__)), 'producer': {'file': str(producer), 'sha256': digest(producer)},
            'primaryReceipt': {'file': str(directory / 'receipt.json'), 'sha256': original_hash, 'pass': False, 'checksPassed': 3, 'checksExpected': 4},
            'installedReceipt': {'file': str(CHECKPOINT / 'verification/installed/receipt.json'), 'sha256': digest(CHECKPOINT / 'verification/installed/receipt.json')},
            'snapshots': item['snapshots'], 'baselineSnapshotSha256': item['baselineSnapshotSha256'], 'exampleSource': item['exampleSource'], 'candidateReceipt': item['candidateReceipt'],
            'normalClose': item['normalClose'], 'closeEvidence': item['closeEvidence'], 'counts': item['counts'], 'example': item['example'],
            'afterPhysical': after_entry, 'protectedPreferencesUnchanged': True, 'physicalProfile': manifest['source']['profile'], 'physicalFiles': after['files'],
            'installPreflightProducer': archived, 'originalFailureRetained': True}


def reopen_completion_proof(source_hash, manifest):
    file = CHECKPOINT / 'verification/reopened/completion.json'
    actual, expected = read(file), build_reopen_completion(source_hash, manifest)
    require(actual == expected, 'Separate reopened completion is missing stale or changed')
    return actual


def installed_proof(source_hash, manifest, baseline, candidate, candidate_snapshot, exported, json_file):
    output, prior_final = {}, None
    for mode in ('installed', 'reopened'):
        item, startup, final = receipt_base(mode, source_hash, manifest)
        completion = reopen_completion_proof(source_hash, manifest) if mode == 'reopened' and item.get('pass') is False else None
        helper_identity(item, source_hash, _completing_io=completion is not None); system_runtime(item, source_hash)
        directory = CHECKPOINT / 'verification' / mode
        linked_file(item.get('candidateReceipt'), candidate['file']); linked_file(item.get('exampleSource'), json_file)
        before = physical_probe(item.get('physicalEvidence', {}).get('before'), directory, 'before', manifest)
        after = physical_probe(completion['afterPhysical'] if completion else item.get('physicalEvidence', {}).get('after'), directory, 'after', manifest)
        if completion:
            require(item.get('physicalFiles') == before['resolvedFiles'] and completion.get('protectedPreferencesUnchanged') is True, 'Separately completed physical profile evidence differs')
        else:
            require(item.get('physicalFiles') == after['resolvedFiles'] and item.get('protectedPreferencesUnchanged') is True, 'Saved physical profile evidence differs')
        sample = approved_example(final, exported, baseline)
        if mode == 'installed':
            require(projection(startup, example(baseline)) == projection(baseline, example(baseline)) and item.get('countsBefore') == snapshot_inventory(baseline), 'Installed application did not open the original real library')
            require(item.get('presentBefore') is False and item.get('imported') is True and item.get('importResult', {}).get('added') == 4 and item.get('importResult', {}).get('recordMap') == {} and item.get('importResult', {}).get('profileMap') == {} and item.get('guard', {}).get('imports') == 1, 'Actual import added/remapped unexpected data')
            selected = read(directory / 'selected-snapshot.json'); approved_example(selected, exported, baseline)
            require(projection(selected, sample) == projection(final, sample), 'Actual import/save changed approved content')
            # Compare complete recomputed sample results/model against the native
            # real-catalog candidate; original report ordering stays strict above.
            ids = set(sample['recordIds'])
            actual_reports = sorted((row for row in final['reports'] if row['recordId'] in ids), key=lambda row: row['recordId'])
            candidate_reports = sorted((row for row in candidate_snapshot['reports'] if row['recordId'] in ids), key=lambda row: row['recordId'])
            require(actual_reports == candidate_reports and final['activeComparison']['model'] == candidate_snapshot['activeComparison']['model'], 'Actual example calculations differ from the real-catalog candidate')
        else:
            require(item.get('reopened') is True and item.get('presentBefore') is True and item.get('imported') is False, 'System reopen did not reuse the saved example')
            require(projection(startup, sample) == projection(prior_final, sample) == projection(final, sample), 'Normal system reopen changed data, selection, narratives or model')
            require(startup.get('activeComparison') is not None, 'System reopen did not restore the saved four-date comparison')
        require(item.get('artifacts') == [], 'Actual installation/reopen stage unexpectedly exported private reports')
        file = directory / 'receipt.json'
        output[mode] = {'file': str(file), 'sha256': digest(file), 'checks': len(item['checks']), 'counts': item['counts'], 'snapshotSha256': item['snapshotSha256'], 'physicalProbeSha256': digest(directory / 'after-physical.json'), 'example': sample}
        if completion:
            completion_file = directory / 'completion.json'
            output[mode].update({'primaryPass': False, 'completedWithSeparateEvidence': True, 'completion': {'file': str(completion_file), 'sha256': digest(completion_file), 'pass': True, 'checks': len(completion['checks'])}})
        prior_final = final
    return output


def proof(source_hash, pdf_files, *, candidate_only):
    manifest = checkpoint_proof()
    baseline_receipt, baseline = baseline_proof(source_hash, manifest)
    clean, payload = clean_payload_proof(source_hash, baseline)
    candidate, candidate_snapshot, exported, json_file = candidate_proof(source_hash, manifest, baseline, clean, payload, pdf_files)
    receipts = {'baseline': baseline_receipt, 'candidate': candidate}
    installation = None
    if not candidate_only:
        installation = installation_proof(manifest)
        receipts.update(installed_proof(source_hash, manifest, baseline, candidate, candidate_snapshot, exported, json_file))
    return {'pass': True, 'candidateOnly': candidate_only, 'checkpointManifestSha256': digest(CHECKPOINT / 'manifest.json'), 'checkpointFiles': len(manifest['files']), 'physicalContext': 'Explorer / unredirected Roaming', 'baselineCounts': snapshot_inventory(baseline), 'example': candidate['example'], 'countsAfterExample': candidate['counts'], 'cleanPayload': clean, 'receipts': receipts, 'installation': installation}
