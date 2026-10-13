"""Bind personal longitudinal delivery evidence to exact source, package and public proofs."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--record', action='store_true')
parser.add_argument('--require-private', action='store_true')
args = parser.parse_args()


def require(ok, message):
    if not ok:
        raise SystemExit(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(relative):
    path = ROOT / relative
    require(path.is_file(), 'Missing evidence: ' + str(relative))
    return json.loads(path.read_text(encoding='utf-8-sig'))


html_path = ROOT / 'MotionBench.html'
source_hash = digest(html_path)
require(read('package.json')['version'] == '2.23.1', 'Source version differs')
require(read('package-lock.json')['version'] == '2.23.1', 'Lock version differs')
subprocess.run([sys.executable, str(ROOT / 'scripts/build.py')], cwd=ROOT, check=True)
require(digest(html_path) == source_hash, 'Rebuild differs from tested HTML')
html = html_path.read_text(encoding='utf-8')
for file in (ROOT / 'src').glob('*.js'):
    code = file.read_text(encoding='utf-8').replace('</script', '<\\/script')
    require('<script>\n' + code + '\n</script>' in html, 'Module omitted: ' + file.name)
require(re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html), 'Personal data embedded in distributable')

unit = read('output/tests/v2231/final/unit-results.json')
require(unit['sourceHash'] == source_hash and unit['sourceUnchanged'], 'Stale unit evidence')
require(unit['runnerSha256'] == digest(ROOT / 'tests/run-unit-tests.cjs'), 'Unit producer differs')
suite_list = re.search(r'for \(const name of \[([\s\S]*?)\]\)', (ROOT / 'tests/run-unit-tests.cjs').read_text(encoding='utf-8'))
expected = re.findall(r'"([^"]+\.cjs)"', suite_list.group(1))
require(len(expected) == 61 and [s['name'] for s in unit['suites']] == expected, 'Unit suite inventory incomplete')
helper_files = {p.relative_to(ROOT).as_posix(): digest(p) for p in (ROOT / 'tests/helpers').glob('*.cjs')}
require(unit.get('helperHashes') == helper_files, 'Unit helper inputs missing or changed')
for name, minimum in [('comparison-model-tests.cjs', 45), ('comparison-store-model-tests.cjs', 8), ('comparison-render-model-tests.cjs', 30), ('comparison-controller-facts-tests.cjs', 6)]:
    suite = next(s for s in unit['suites'] if s['name'] == name)
    passed = len(re.findall(r'^PASS ', suite['stdout'], re.MULTILINE)) if name == 'comparison-store-model-tests.cjs' else suite['checksPassed']
    require(passed >= minimum, 'Personal unit checks incomplete: ' + name)
store_unit_path = 'output/tests/v2231/comparison-store-model.json'
store_unit = read(store_unit_path)
require(store_unit['pass'] is True and store_unit['sourceUnchanged'] and len(store_unit['checks']) == 8, 'Personal Store unit receipt incomplete')
require(store_unit['runnerSha256'] == digest(ROOT / 'tests/comparison-store-model-tests.cjs'), 'Personal Store unit producer differs')
for file, sha in store_unit['sourceHashes'].items():
    require(digest(ROOT / file) == sha, 'Personal Store unit input differs: ' + file)
store_driver_count = next(s['checksPassed'] for s in unit['suites'] if s['name'] == 'comparison-store-model-tests.cjs')
verified_model_checks = sum(s['checksPassed'] for s in unit['suites']) + max(0, len(store_unit['checks']) - store_driver_count)
require(set(unit['modules']) == {p.name for p in (ROOT / 'src').glob('*.js')}, 'Source inventory incomplete')
for file, sha in unit['modules'].items():
    require(digest(ROOT / 'src' / file) == sha, 'Unit input differs: ' + file)
for suite in unit['suites']:
    require(suite['exitCode'] == 0 and suite['sourceUnchanged'] and suite['sha256'] == digest(ROOT / 'tests' / suite['name']), 'Failed/changed suite: ' + suite['name'])

proofs, pdfs = {store_unit_path: {'sha256': digest(ROOT / store_unit_path), 'checks': len(store_unit['checks'])}}, {}


def verify_artifact(item, proof_path):
    relative = item.get('file') or item.get('path')
    require(isinstance(relative, str) and relative, 'Artifact path missing')
    file = ROOT / relative if relative.startswith('output/') else (ROOT / proof_path).parent / relative
    file = file.resolve()
    require(file.is_relative_to(ROOT / 'output') and not any(part.lower() in {'userdata', 'user-data', 'verification', 'private', 'private-data'} for part in file.relative_to(ROOT).parts), 'Private/outside artifact path')
    require(file.is_file() and digest(file) == item['sha256'], 'Artifact differs: ' + str(file))
    if 'bytes' in item:
        require(file.stat().st_size == item['bytes'], 'Artifact byte size differs')
    if file.suffix.lower() == '.pdf':
        from pypdf import PdfReader
        pdfs[file.relative_to(ROOT).as_posix()] = len(PdfReader(file).pages)


def proof(relative, runner, minimum, native=False):
    data = read(relative)
    require(data.get('pass') is True and not data.get('errors') and not data.get('network'), 'Failed check: ' + relative)
    require(len(data.get('checks', [])) >= minimum, 'Checks incomplete: ' + relative)
    comparison = runner in ('tests/comparison-browser-tests.cjs', 'tests/desktop-comparison-tests.cjs')
    for key, helper in [('pdfBoundsHelperSha256', 'tests/helpers/comparison-pdf-bounds.cjs'),
                        ('screeningHelperSha256', 'tests/helpers/comparison-screening.cjs')]:
        if comparison:
            require(key in data, 'Check helper attribution missing: ' + relative)
        if key in data:
            require(data[key] == digest(ROOT / helper), 'Check helper changed: ' + relative)
    if comparison:
        require(data.get('scope') == 'personal-longitudinal-only', 'Personal report attribution missing')
        require(data.get('fixtureSha256') == digest(ROOT / 'output/comparison-demo/个人纵向模拟资料库.json'), 'Comparison fixture differs: ' + relative)
    if not native:
        require(data['sourceHash'] == source_hash and data['sourceUnchanged'], 'Stale evidence: ' + relative)
        require(data['runnerSha256'] == digest(ROOT / runner), 'Producer changed: ' + relative)
    else:
        identity = data['identity']
        require(data.get('packaged') is True and identity['runtimeMatchesSourceHtml'] is True, 'Native check did not exercise package')
        require(identity['runtimeHtmlSha256'] == identity['sourceHtmlSha256'] == source_hash, 'Native HTML differs')
        require(identity['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Native archive differs')
        require(identity['executableSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/MotionBench.exe'), 'Native executable differs')
        require(identity['testScriptSha256'] == digest(ROOT / runner), 'Native producer changed')
        require(identity['identityHelperSha256'] == digest(ROOT / 'tests/helpers/desktop-artifact-identity.cjs'), 'Native attribution helper changed')
        for file, sha in identity['sourceHashes'].items():
            require(digest(ROOT / file) == sha, 'Native input differs: ' + file)
        require(data.get('artifactUnchanged') is True or data.get('finalIdentity') == identity, 'Native artifact changed during run')
        for file, sha in identity['runtimeHashes'].items():
            if file.startswith('desktop/'):
                require(identity['sourceHashes'][file] == sha, 'Native module differs: ' + file)
        require(not data['cleanup']['errors'] and data['cleanup']['temporaryProfileRemoved'], 'Native cleanup incomplete')
    for item in data.get('artifacts', []):
        verify_artifact(item, relative)
    reports = data.get('pdfs', [])
    if data.get('pdf'):
        reports = reports + [data['pdf']]
    for item in reports:
        diagnostics = item.get('diagnostics', item)
        require(diagnostics.get('status') == 'complete', 'PDF incomplete: ' + relative)
        for key in ('missingRows', 'duplicateRows', 'changedRows', 'missingCharts', 'duplicateCharts'):
            require(not diagnostics[key], 'PDF content failure: ' + key)
        if comparison:
            require(len(item['pages']) == diagnostics['pageCount'], 'PDF page evidence incomplete')
            for page in item['pages']:
                require('bounds' in page, 'PDF physical bounds missing')
                for image in page['bounds']['images']:
                    require(image['loaded'] and image['insideContent'] and not image['clippingAncestors'], 'PDF artwork clipped/incomplete')
                for facet in page['bounds']['facets']:
                    require(facet['contained'] and facet['scrollWidth'] <= facet['width'] + 2, 'PDF screening facets clipped')
    if comparison and (native or data['channel'] == 'chrome'):
        require(len(reports) == (1 if native else 2), 'Comparison PDF inventory incomplete')
    proofs[relative] = {'sha256': digest(ROOT / relative), 'checks': len(data['checks'])}
    return data


for channel in ('chrome', 'msedge'):
    proof(f'output/playwright/v2231/comparison-ui/{channel}.json', 'tests/comparison-browser-tests.cjs', 18 if channel == 'chrome' else 16)
    proof(f'output/playwright/v2231/store/{channel}.json', 'tests/comparison-storage-browser-tests.cjs', 15)
proof('output/playwright/v2231/single-generic/results.json', 'tests/generic-report-browser-tests.cjs', 17)
proof('output/playwright/v2231/single-report/chrome.json', 'tests/report-v220-browser-tests.cjs', 6)
proof('output/playwright/v2231/single-app/chrome-results.json', 'tests/app-v220-browser-tests.cjs', 7)
proof('output/playwright/v2231/single-storage/chrome.json', 'tests/storage-v220-browser-tests.cjs', 22)
proof('output/playwright/v2231/excel/chrome-results.json', 'tests/excel-workflow-browser-tests.cjs', 15)
proof('output/tests/v2231-desktop/comparison/native-comparison-results.json', 'tests/desktop-comparison-tests.cjs', 10, native=True)
proof('output/tests/v2231-desktop/smoke/results.json', 'tests/desktop-smoke.cjs', 16, native=True)

desktop_units = read('output/tests/v2231/desktop-unit/results.json')
require(desktop_units['pass'] and desktop_units['sourceHash'] == source_hash and desktop_units['sourceUnchanged'], 'Desktop unit evidence differs')
require(desktop_units['runnerSha256'] == digest(ROOT / 'tests/run-v223-desktop-unit.cjs'), 'Desktop unit producer differs')
require(len(desktop_units['suites']) == 5, 'Desktop unit inventory incomplete')
for file, sha in desktop_units['runtimeHashes'].items():
    require(digest(ROOT / file) == sha, 'Desktop input differs')
for suite in desktop_units['suites']:
    require(suite['exitCode'] == 0 and suite['sourceUnchanged'] and digest(ROOT / 'tests' / suite['name']) == suite['sha256'], 'Desktop unit suite failed/changed')
    require(digest(ROOT / suite['log']) == suite['logSha256'], 'Desktop unit log differs')

package = read('output/desktop-package/package-check.json')
require(package['version'] == '2.23.1-desktop.1' and package['webVersion'] == '2.23.1', 'Package version differs')
require(package['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Package archive differs')
fixture_path = ROOT / 'output/comparison-demo/个人纵向模拟资料库.json'
fixture = read('output/comparison-demo/个人纵向模拟资料库.json')
require(digest(fixture_path) == 'af4197335feb1e12c0c1404b423c38c81ae3683c45f569a1ec064a84db24b1f9', 'Approved synthetic fixture changed')
require(len(fixture['athletes']) == 24 and sum(len(a['records']) for a in fixture['athletes']) == 144, 'Synthetic raw records incomplete')
require(len(fixture['comparisonReports']) == 3, 'Personal presets incomplete')
for document in fixture['comparisonReports']:
    selection = document['selection']
    require(len(selection['athleteIds']) == 1 and len(set(selection['dates'])) == 6, 'A preset is not personal longitudinal')
    require(document['inputFingerprint'] == document['narrative']['basis'] == document['narrative']['inputFingerprint'], 'Preset text/input binding differs')
generation = read('output/comparison-demo/generation-evidence.json')
require(generation['deterministic'] is True and generation['athletes'] == 24 and generation['records'] == 144 and generation['reports'] == 3, 'Synthetic generation is unverified')
require(generation['sha256'] == digest(fixture_path) and generation['jsonlSha256'] == digest(ROOT / 'output/comparison-demo/个人纵向模拟资料库.jsonl'), 'Synthetic export differs')
require(generation['sourceSha'] == digest(ROOT / 'src/ringside-comparison.js') and all(item['current'] for item in generation['presetBindings']), 'Synthetic generator input/binding differs')
preservation = read('output/implementation-2.23.1/demo-raw-preservation.json')
require(preservation['wholeRecordIdentical'] and preservation['rawDataIdentical'] and preservation['idsIdentical'] and not preservation['changedRecordIds'] and not preservation['changedRawDataIds'], 'Original synthetic records changed')
require(preservation['newFixtureSha256'] == digest(fixture_path) and preservation['oldRecordsSha256'] == preservation['newRecordsSha256'] == 'sha256:fedede5c77f8ef9095978fc87b351f2f78af33c8a091b87f58c1d0bdceb3a921', 'Synthetic baseline differs')
raw_hash_script = """const fs=require('fs'),{loadComparisonContext}=require('./tests/helpers/comparison-fixtures.cjs');const C=loadComparisonContext().RingsideComparison;
const library=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const records=library.athletes.flatMap(a=>a.records).sort((a,b)=>a.recordId.localeCompare(b.recordId));console.log(C.hash(Object.fromEntries(records.map(r=>[r.recordId,r]))));"""
raw_hash = subprocess.check_output(['node', '-e', raw_hash_script, str(fixture_path)], cwd=ROOT, text=True).strip()
require(raw_hash == preservation['newRecordsSha256'], 'Synthetic records no longer match preserved baseline')
facts = read('output/playwright/v2231/ai-facts-diagnostic/controller-full-proof.json')
require(facts.get('pass') is True and facts['factsVersion'] == 2 and facts['sourceUnchanged'], 'Personal AI facts checks missing/stale')
require(facts['controllerSha256'] == digest(ROOT / 'src/ringside-comparison-controller.js') and facts['modelSha256'] == digest(ROOT / 'src/ringside-comparison.js'), 'AI facts source differs')
require(facts['testSha256'] == digest(ROOT / 'tests/comparison-controller-facts-tests.cjs') and facts['fixtureSha256'] == digest(fixture_path), 'AI facts producer/input differs')
require(facts['people'] == 1 and facts['dates'] == 6 and facts['records'] == 6 and facts['metrics'] == 351, 'Personal AI fixture incomplete')
require(facts['exactRoundTrip'] == {'observations': 2106, 'transitions': 1100} and facts['requestBytes'] < 8 * 1024 * 1024, 'Personal AI facts round trip/request capacity failed')
render_path = 'output/implementation-2.23.1/final-source-render/render-review.json'
render = read(render_path)
require(render['pass'] and render['sourceHash'] == source_hash and render['sourceUnchanged'], 'Render checks missing/stale')
require(render['runnerHash'] == digest(ROOT / 'tests/comparison-render-model-tests.cjs'), 'Render producer changed')
require(render['modelChecks'] >= 30 and render['browserChecks'] == 30 and all(render['embedding'].values()), 'Render checks incomplete')
require(render['fixtureHash'] == digest(fixture_path) and (ROOT / 'output/implementation-2.23.1/verify-render-frozen.cjs').is_file(), 'Render fixture/wrapper missing')
for file, sha in render['moduleHashes'].items():
    require(digest(ROOT / file) == sha, 'Render input differs: ' + file)
for item in render['artifacts']:
    verify_artifact(item, render_path)
visual = read('output/implementation-2.23.1/visual-review.json')
require(visual.get('pass') is True and visual['sourceHash'] == source_hash, 'Visual review missing/stale')
for item in visual.get('images', []):
    verify_artifact(item, 'output/implementation-2.23.1/visual-review.json')
for item in visual.get('pdfs', []):
    verify_artifact(item, 'output/implementation-2.23.1/visual-review.json')
    require(item['reviewedPages'] == list(range(1, item['pageCount'] + 1)), 'Unreviewed PDF pages')
    require(pdfs[item['file']] == item['pageCount'], 'PDF visual count differs')
    for page in item['images']:
        verify_artifact(page, 'output/implementation-2.23.1/visual-review.json')
require(set(pdfs) <= {item['file'] for item in visual['pdfs']}, 'A tested PDF lacks visual review')

def verify_private_delivery(package_evidence, html_sha256):
    """Verify protected receipts locally without placing private data in acceptance."""
    checkpoint = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261013-before-2.23.0')
    previous = json.loads((checkpoint / 'manifest.json').read_text(encoding='utf-8-sig'))
    require(previous['complete'] is True and previous['sourceVersion'] == '2.22.0-desktop.1', 'Original rollback checkpoint incomplete')
    for item in previous['files']:
        saved = (checkpoint / item['kind'] / item['relative']).resolve()
        require(saved.is_relative_to(checkpoint) and saved.is_file() and saved.stat().st_size == item['length'] and digest(saved) == item['sha256'], 'Original rollback copy differs')
    base = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261013-before-2.23.1')
    backup = json.loads((base / 'userdata-manifest.json').read_text(encoding='utf-8-sig'))
    require(backup['complete'] is True and backup['sourceVersion'] == '2.23.0-desktop.1', 'Current rollback checkpoint incomplete')
    for item in backup['files']:
        saved = (base / 'userdata' / item['relative']).resolve()
        require(saved.is_relative_to(base / 'userdata') and saved.is_file() and saved.stat().st_size == item['length'] and digest(saved) == item['sha256'], 'Current rollback copy differs')
    baseline_file = base / 'current-business.json'
    baseline = json.loads(baseline_file.read_text(encoding='utf-8-sig'))
    expected = {'athletes': 26, 'records': 146, 'profiles': 4, 'groups': 1, 'projects': 28, 'metrics': 106, 'reportBodies': 3}
    counts = {'athletes': len(baseline['athletes']), 'records': sum(len(a['records']) for a in baseline['athletes']),
              'profiles': len(baseline['evaluationProfiles']), 'groups': len(baseline['groups']),
              'projects': len(baseline['catalog']['tests']), 'metrics': len(baseline['catalog']['definitions']),
              'reportBodies': len(baseline['comparisonReports'])}
    require(counts == expected, 'Protected baseline entity inventory differs')
    result = {}
    for mode in ('before', 'candidate', 'installed', 'reopened'):
        file = base / (mode + '-verification.json')
        data = json.loads(file.read_text(encoding='utf-8-sig'))
        require(data['pass'] is True and data['mode'] == mode and len(data['checks']) >= (2 if mode == 'before' else 4), 'Private checks incomplete: ' + mode)
        require(data['runnerSha256'] == digest(ROOT / 'scripts/verify_private_v2231.cjs') and data['baselineSha256'] == digest(baseline_file), 'Private producer/baseline differs: ' + mode)
        require(data['actualData'] == (mode in ('installed', 'reopened')) and data['testArguments'] == (mode != 'reopened'), 'Private run attribution differs: ' + mode)
        if mode == 'before':
            require(data['version'] == '2.23.0-desktop.1' and data['counts'] == {key: expected[key] for key in ('athletes', 'records', 'profiles', 'reportBodies')}, 'Current checkpoint version/count differs')
            require(data['archiveSha256'] == '859e526f5576f86a1873c84fe22e63d56f5585c46f1900eb4eed56c2e65221dd'
                    and data['executableSha256'] == '2be47e713178d68993f28a06e335018eadc5eea9b618706235433d7ab90ad9d4', 'Before checkpoint did not exercise the prior installed package')
        else:
            require(data['version'] == '2.23.1-desktop.1' and data['archiveSha256'] == package_evidence['archiveSha256']
                    and data['executableSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/MotionBench.exe'), 'Private package differs: ' + mode)
            require(data['preservation'] == expected and data['preservationAfterSave'] == expected, 'Current measurements, settings or report bodies changed: ' + mode)
            require(data['personalReport'] == {'ready': True, 'kind': 'personal-longitudinal', 'people': 1, 'dates': 6}, 'Installed personal report unavailable: ' + mode)
        result[mode] = {'sha256': digest(file), 'checks': len(data['checks']), 'preservation': data.get('preservation', data.get('counts'))}
    installed_root = Path(r'D:\Application\Strength&Conditioning\MotionBench')
    installation = read('output/implementation-2.23.1/local-installation.json')
    require(installation['pass'] is True and installation['installerExitCode'] == 0 and installation['version'] == '2.23.1-desktop.1', 'Installation failed')
    require(Path(installation['installationDirectory']).resolve() == installed_root.resolve(), 'Installation directory differs')
    require(installation['installerSha256'] == digest(ROOT / 'dist-desktop/MotionBench-2.23.1-desktop.1-Setup-x64.exe'), 'Installed Setup differs')
    require({'MotionBench.exe', 'resources/app.asar'} <= {item['file'].replace('\\', '/') for item in installation['checks']}, 'Installed executable/archive checks incomplete')
    for item in installation['checks']:
        target = (installed_root / item['file']).resolve()
        require(target.is_relative_to(installed_root) and item['matchesTestedPackage']
                and digest(target) == item['sha256'] == digest(ROOT / 'dist-desktop/win-unpacked' / item['file']), 'Installed file differs')
    for name in ('ai-settings.dat', 'desktop-preferences.json'):
        saved, actual = base / 'userdata' / name, Path(os.environ['APPDATA']) / 'MotionBench Desktop' / name
        require(saved.exists() == actual.exists() and (not saved.exists() or digest(saved) == digest(actual)), 'Saved desktop configuration differs: ' + name)
    result['sourceHash'] = html_sha256
    return result


private = verify_private_delivery(package, source_hash) if args.require_private else {}
summary = {'pass': True, 'version': '2.23.1', 'desktopVersion': '2.23.1-desktop.1', 'sourceHash': source_hash,
           'modelSuites': len(unit['suites']), 'modelChecks': verified_model_checks,
           'proofs': proofs, 'pdfs': pdfs, 'pdfPages': sum(pdfs.values()), 'package': package,
           'visualReviewSha256': digest(ROOT / 'output/implementation-2.23.1/visual-review.json'),
           'factsProofSha256': digest(ROOT / 'output/playwright/v2231/ai-facts-diagnostic/controller-full-proof.json'),
           'renderReviewSha256': digest(ROOT / render_path), 'renderBrowserChecks': render['browserChecks'], 'privateVerified': args.require_private, 'private': private,
           'fixtureSha256': digest(fixture_path), 'fixtureHelperSha256': digest(ROOT / 'tests/helpers/comparison-fixtures.cjs'),
           'generatorSha256': digest(ROOT / 'scripts/create_comparison_demo.cjs'), 'verifierSha256': digest(Path(__file__)),
           'renderWrapperSha256': digest(ROOT / 'output/implementation-2.23.1/verify-render-frozen.cjs')}
if args.record:
    (ROOT / 'docs/acceptance-2.23.1.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: summary[k] for k in ('pass', 'version', 'modelSuites', 'modelChecks', 'pdfPages', 'sourceHash')}))
