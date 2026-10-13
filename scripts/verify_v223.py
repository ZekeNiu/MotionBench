"""Bind MotionBench comparison delivery evidence to the exact source and package."""
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
require(read('package.json')['version'] == '2.23.0', 'Source version differs')
require(read('package-lock.json')['version'] == '2.23.0', 'Lock version differs')
subprocess.run([sys.executable, str(ROOT / 'scripts/build.py')], cwd=ROOT, check=True)
require(digest(html_path) == source_hash, 'Rebuild differs from tested HTML')
html = html_path.read_text(encoding='utf-8')
for file in (ROOT / 'src').glob('*.js'):
    code = file.read_text(encoding='utf-8').replace('</script', '<\\/script')
    require('<script>\n' + code + '\n</script>' in html, 'Module omitted: ' + file.name)
require(re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html), 'Personal data embedded in distributable')

unit = read('output/tests/v223/final/unit-results.json')
require(unit['sourceHash'] == source_hash and unit['sourceUnchanged'], 'Stale unit evidence')
require(unit['runnerSha256'] == digest(ROOT / 'tests/run-unit-tests.cjs'), 'Unit producer differs')
suite_list = re.search(r'for \(const name of \[([\s\S]*?)\]\)', (ROOT / 'tests/run-unit-tests.cjs').read_text(encoding='utf-8'))
expected = re.findall(r'"([^"]+\.cjs)"', suite_list.group(1))
require([s['name'] for s in unit['suites']] == expected, 'Unit suite inventory incomplete')
require(set(unit['modules']) == {p.name for p in (ROOT / 'src').glob('*.js')}, 'Source inventory incomplete')
for file, sha in unit['modules'].items():
    require(digest(ROOT / 'src' / file) == sha, 'Unit input differs: ' + file)
for suite in unit['suites']:
    require(suite['exitCode'] == 0 and suite['sourceUnchanged'] and suite['sha256'] == digest(ROOT / 'tests' / suite['name']), 'Failed/changed suite: ' + suite['name'])

proofs, pdfs = {}, {}


def verify_artifact(item, proof_path):
    relative = item.get('file') or item.get('path')
    require(isinstance(relative, str) and relative, 'Artifact path missing')
    file = ROOT / relative if relative.startswith('output/') else (ROOT / proof_path).parent / relative
    require(file.is_file() and digest(file) == item['sha256'], 'Artifact differs: ' + str(file))
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
    if comparison or runner == 'tests/comparison-storage-browser-tests.cjs':
        require(data.get('fixtureSha256') == digest(ROOT / 'output/comparison-demo/团队与纵向模拟资料库.json'), 'Comparison fixture differs: ' + relative)
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
    proof(f'output/playwright/v223/comparison-ui/{channel}.json', 'tests/comparison-browser-tests.cjs', 17 if channel == 'chrome' else 15)
    proof(f'output/playwright/v223/comparison-storage/{channel}.json', 'tests/comparison-storage-browser-tests.cjs', 15)
proof('output/playwright/v223/single-generic/results.json', 'tests/generic-report-browser-tests.cjs', 17)
proof('output/playwright/v223/single-report/chrome.json', 'tests/report-v220-browser-tests.cjs', 6)
proof('output/playwright/v223/single-app/chrome-results.json', 'tests/app-v220-browser-tests.cjs', 7)
proof('output/playwright/v223/single-storage/chrome.json', 'tests/storage-v220-browser-tests.cjs', 22)
proof('output/playwright/v223/excel/chrome-results.json', 'tests/excel-workflow-browser-tests.cjs', 15)
proof('output/tests/v223-desktop/comparison/native-comparison-results.json', 'tests/desktop-comparison-tests.cjs', 10, native=True)
proof('output/tests/v223-desktop/smoke/results.json', 'tests/desktop-smoke.cjs', 16, native=True)

desktop_units = read('output/tests/v223/desktop-unit/results.json')
require(desktop_units['pass'] and desktop_units['sourceHash'] == source_hash and desktop_units['sourceUnchanged'], 'Desktop unit evidence differs')
require(desktop_units['runnerSha256'] == digest(ROOT / 'tests/run-v223-desktop-unit.cjs'), 'Desktop unit producer differs')
require(len(desktop_units['suites']) == 5, 'Desktop unit inventory incomplete')
for file, sha in desktop_units['runtimeHashes'].items():
    require(digest(ROOT / file) == sha, 'Desktop input differs')
for suite in desktop_units['suites']:
    require(suite['exitCode'] == 0 and suite['sourceUnchanged'] and digest(ROOT / 'tests' / suite['name']) == suite['sha256'], 'Desktop unit suite failed/changed')
    require(digest(ROOT / suite['log']) == suite['logSha256'], 'Desktop unit log differs')

package = read('output/desktop-package/package-check.json')
require(package['version'] == '2.23.0-desktop.1' and package['webVersion'] == '2.23.0', 'Package version differs')
require(package['archiveSha256'] == digest(ROOT / 'dist-desktop/win-unpacked/resources/app.asar'), 'Package archive differs')
facts = read('output/playwright/v223/ai-facts-diagnostic/controller-full-proof.json')
require(facts['sourceUnchanged'] and facts['controllerSha256'] == digest(ROOT / 'src/ringside-comparison-controller.js'), 'AI facts input differs')
require(facts['testSha256'] == digest(ROOT / 'tests/comparison-controller-facts-tests.cjs'), 'AI facts producer differs')
require(facts['fixtureSha256'] == digest(ROOT / 'output/comparison-demo/团队与纵向模拟资料库.json'), 'AI facts fixture differs')
require(facts['people'] == 24 and facts['dates'] == 6 and facts['records'] == 143 and facts['metrics'] == 363, 'AI full-team fixture incomplete')
require(facts['exactRoundTrip'] == {'observations': 52272, 'transitions': 26481} and facts['requestBytes'] < 8 * 1024 * 1024, 'AI facts round trip/request capacity failed')
render_path = 'output/implementation-2.23.0/final-source-render/render-review.json'
render = read(render_path)
require(render['pass'] and render['sourceHash'] == source_hash and render['sourceUnchanged'], 'Render checks missing/stale')
require(render['runnerHash'] == digest(ROOT / 'tests/comparison-render-model-tests.cjs'), 'Render producer changed')
require(render['modelChecks'] >= 28 and render['browserChecks'] == 28 and all(render['embedding'].values()), 'Render checks incomplete')
for file, sha in render['moduleHashes'].items():
    require(digest(ROOT / file) == sha, 'Render input differs: ' + file)
visual = read('output/implementation-2.23.0/visual-review.json')
require(visual.get('pass') is True and visual['sourceHash'] == source_hash, 'Visual review missing/stale')
for item in visual.get('images', []):
    verify_artifact(item, 'output/implementation-2.23.0/visual-review.json')
for item in visual.get('pdfs', []):
    verify_artifact(item, 'output/implementation-2.23.0/visual-review.json')
    require(item['reviewedPages'] == list(range(1, item['pageCount'] + 1)), 'Unreviewed PDF pages')
    require(pdfs[item['file']] == item['pageCount'], 'PDF visual count differs')
    for page in item['images']:
        verify_artifact(page, 'output/implementation-2.23.0/visual-review.json')
require(set(pdfs) <= {item['file'] for item in visual['pdfs']}, 'A tested PDF lacks visual review')

private = {}
if args.require_private:
    base = Path(r'D:\Application\Strength&Conditioning\MotionBench-backups\20261013-before-2.23.0')
    backup = json.loads((base / 'manifest.json').read_text(encoding='utf-8'))
    require(backup['complete'] is True and backup['sourceVersion'] == '2.22.0-desktop.1', 'Rollback checkpoint incomplete')
    for item in backup['files']:
        saved = base / item['kind'] / item['relative']
        require(saved.is_file() and saved.stat().st_size == item['length'] and digest(saved) == item['sha256'], 'Rollback copy differs')
    installed_root = Path(r'D:\Application\Strength&Conditioning\MotionBench')
    installation = read('output/implementation-2.23.0/local-installation.json')
    require(installation['pass'] and installation['installerExitCode'] == 0 and installation['version'] == '2.23.0-desktop.1', 'Installation failed')
    require(Path(installation['installationDirectory']) == installed_root, 'Installation path differs')
    require(installation['installerSha256'] == digest(ROOT / 'dist-desktop/MotionBench-2.23.0-desktop.1-Setup-x64.exe'), 'Setup differs')
    for item in installation['checks']:
        require(item['matchesTestedPackage'] and digest(installed_root / item['file']) == item['sha256'] == digest(ROOT / 'dist-desktop/win-unpacked' / item['file']), 'Installed file differs')
    for mode in ('candidate', 'installed', 'reopened'):
        file = base / 'verification' / (mode + '-verification.json')
        data = json.loads(file.read_text(encoding='utf-8'))
        require(data['pass'] and data['version'] == '2.23.0-desktop.1' and data['checks'], 'Private verification failed: ' + mode)
        require(data['runnerSha256'] == digest(ROOT / 'scripts/verify_private_v223.cjs'), 'Private producer changed')
        require(data['archiveSha256'] == package['archiveSha256'], 'Private artifact differs')
        require(data['baselineSha256'] == digest(base / 'verification/original-business.json'), 'Private baseline differs')
        require(data['actualData'] == (mode != 'candidate') and data['testArguments'] == (mode != 'reopened'), 'Private run attribution differs')
        private[mode] = {'sha256': digest(file), 'checks': len(data['checks']), 'preservation': data['preservation']}
    for name in ('ai-settings.dat', 'desktop-preferences.json'):
        old, current = base / 'userdata' / name, Path(os.environ['APPDATA']) / 'MotionBench Desktop' / name
        require(old.exists() == current.exists() and (not old.exists() or digest(old) == digest(current)), 'Saved desktop configuration differs: ' + name)

summary = {'pass': True, 'version': '2.23.0', 'desktopVersion': '2.23.0-desktop.1', 'sourceHash': source_hash,
           'modelSuites': len(unit['suites']), 'modelChecks': sum(s['checksPassed'] for s in unit['suites']),
           'proofs': proofs, 'pdfs': pdfs, 'pdfPages': sum(pdfs.values()), 'package': package,
           'visualReviewSha256': digest(ROOT / 'output/implementation-2.23.0/visual-review.json'),
           'factsProofSha256': digest(ROOT / 'output/playwright/v223/ai-facts-diagnostic/controller-full-proof.json'),
           'renderReviewSha256': digest(ROOT / render_path), 'renderBrowserChecks': render['browserChecks'], 'private': private}
if args.record:
    (ROOT / 'docs/acceptance-2.23.0.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: summary[k] for k in ('pass', 'version', 'modelSuites', 'modelChecks', 'pdfPages', 'sourceHash')}))
